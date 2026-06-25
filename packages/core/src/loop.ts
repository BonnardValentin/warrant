// The loop. Author the contract once; solve → verify → retry until accepted,
// exhausted, stalled, or inconclusive. Independence is enforced at the TYPE level:
// Solver.solve has no contract parameter, so a solver cannot read the contract.

import { type Decision, type Policy, standard } from "./policy.ts";
import type { Verifier } from "./verifier.ts";
import { type Claim, claimStatus, DEFAULT_QUORUM, type Quorum, type Witness } from "./witness.ts";

export interface SpecAuthor<T, C> {
  author(task: T): Promise<C>;
}

// NOTE: no contract parameter — that's the structural independence guarantee.
export interface Solver<T, A> {
  solve(task: T, attempt: number, feedback?: Feedback): Promise<A>;
}

export interface Feedback {
  attempt: number;
  failed: { id: string; detail: string }[];
  held: string[];
  regressed: string[]; // newly broke vs. last attempt → anti-oscillation
  progress: string;
}

export type LoopStatus =
  | "accepted"
  | "rejected-exhausted"
  | "stalled"
  | "inconclusive"
  | "bad-contract";

export interface LoopResult<A> {
  status: LoopStatus;
  artifact?: A;
  witness: Witness;
  decision?: Decision;
  attempts: number;
}

export type Event =
  | { t: "spec.authored" }
  | { t: "negative-control"; index: number; rejected: boolean }
  | { t: "attempt.start"; n: number }
  | { t: "attempt.verdict"; n: number; decision: Decision }
  | { t: "loop.done"; status: LoopStatus };

function detailOf(c: Claim): string {
  const e = c.evidence;
  if (e.kind === "binary") return e.detail ?? "failed";
  if (e.kind === "score") return `score ${e.value}/${e.of}`;
  return `proof ${e.system} unverified`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function infraWitness(reason: string, seed: number): Witness {
  return { schema: "warrant/v1", seed, loadError: reason, claims: [] };
}

// A witness we couldn't produce or trust (the artifact didn't run, the verifier
// threw, a timeout) is INCONCLUSIVE — never accept. Without this, a loadError
// witness has empty claims and policy([]) would vacuously accept.
function decide(w: Witness, policy: Policy): Decision {
  if (w.loadError) return { verdict: "inconclusive", assurance: "none", rationale: w.loadError };
  return policy(w.claims);
}

// Feedback reveals only claims with revealed !== false (anti-gaming).
function buildFeedback(
  attempt: number,
  w: Witness,
  prevFailed: Set<string>,
  quorum: Quorum,
): Feedback {
  const visible = w.claims.filter((c) => c.revealed !== false);
  const failed = visible
    .filter((c) => claimStatus(c, quorum) === "fail")
    .map((c) => ({ id: c.id, detail: detailOf(c) }));
  const held = visible.filter((c) => claimStatus(c, quorum) === "hold").map((c) => c.id);
  const regressed = failed.filter((f) => !prevFailed.has(f.id)).map((f) => f.id);
  return {
    attempt,
    failed,
    held,
    regressed,
    progress: `${held.length}/${visible.length} visible claims hold`,
  };
}

// Determinism is VERIFIED, not trusted: the first time we use a deterministic
// verifier in this run, run it twice and quarantine it as inconclusive if the two
// witnesses disagree. A verifier stable on first use is trusted thereafter, so we
// don't pay the double-run on every attempt.
async function verifyChecked<A, C>(
  v: Verifier<A, C>,
  artifact: A,
  contract: C,
  seed: number,
  checkReplay: boolean,
): Promise<Witness> {
  const w = await v.verify(artifact, contract, seed);
  if (!checkReplay || v.cls !== "deterministic" || w.loadError) return w;
  const w2 = await v.verify(artifact, contract, seed);
  if (JSON.stringify(w.claims) !== JSON.stringify(w2.claims)) {
    // split-sample score → policy reads this as inconclusive (quarantine)
    return {
      schema: "warrant/v1",
      seed,
      claims: [
        {
          id: "__determinism__",
          severity: "required",
          evidence: {
            kind: "score",
            value: 0.5,
            of: 1,
            samples: { n: DEFAULT_QUORUM.n, agree: 2 },
          },
        },
      ],
    };
  }
  return w;
}

export interface RunConfig<T, C, A> {
  task: T;
  specAuthor: SpecAuthor<T, C>;
  solver: Solver<T, A>;
  verifier: Verifier<A, C>;
  policy?: Policy;
  quorum?: Quorum;
  maxAttempts?: number;
  stallK?: number;
  negativeControls?: A[];
  onEvent?: (e: Event) => void;
  seed?: number;
}

export async function runLoop<T, C, A>(cfg: RunConfig<T, C, A>): Promise<LoopResult<A>> {
  const quorum = cfg.quorum ?? DEFAULT_QUORUM;
  const policy = cfg.policy ?? standard(0.9, quorum);
  const maxAttempts = cfg.maxAttempts ?? 5;
  const stallK = cfg.stallK ?? 2;
  const seed = cfg.seed ?? 1;
  const emit = cfg.onEvent ?? (() => {});

  let contract: C;
  try {
    contract = await cfg.specAuthor.author(cfg.task);
  } catch (e) {
    // Can't even author the contract — nothing to verify against.
    const w = infraWitness(`spec author threw: ${errMsg(e)}`, seed);
    emit({ t: "loop.done", status: "inconclusive" });
    return { status: "inconclusive", witness: w, decision: decide(w, policy), attempts: 0 };
  }
  emit({ t: "spec.authored" });

  let replayChecked = false;
  // Infra failures (sandbox spawn, verifier throw) become an inconclusive
  // witness — they must never crash the loop or be mistaken for a verdict.
  const verify = async (artifact: A, checkReplay: boolean): Promise<Witness> => {
    try {
      return await verifyChecked(cfg.verifier, artifact, contract, seed, checkReplay);
    } catch (e) {
      return infraWitness(`verifier threw: ${errMsg(e)}`, seed);
    }
  };

  // Negative controls: the contract MUST actively reject deliberately-wrong
  // artifacts. Anything short of a "reject" verdict (including inconclusive) means
  // we can't trust the contract.
  for (const [i, control] of (cfg.negativeControls ?? []).entries()) {
    // Controls don't consume the determinism replay-check — that's spent on the
    // first real attempt, where it actually matters.
    const w = await verify(control, false);
    const d = decide(w, policy);
    const rejected = d.verdict === "reject";
    emit({ t: "negative-control", index: i, rejected });
    if (!rejected) {
      emit({ t: "loop.done", status: "bad-contract" });
      return { status: "bad-contract", witness: w, decision: d, attempts: 0 };
    }
  }

  let prevFailed = new Set<string>();
  let stall = 0;
  let feedback: Feedback | undefined;
  let lastArtifact: A | undefined;
  let lastWitness: Witness = { schema: "warrant/v1", claims: [] };
  let lastDecision: Decision | undefined;

  for (let n = 1; n <= maxAttempts; n++) {
    emit({ t: "attempt.start", n });
    let artifact: A;
    try {
      artifact = await cfg.solver.solve(cfg.task, n - 1, feedback);
    } catch (e) {
      const w = infraWitness(`solver threw: ${errMsg(e)}`, seed);
      const d = decide(w, policy);
      emit({ t: "attempt.verdict", n, decision: d });
      emit({ t: "loop.done", status: "inconclusive" });
      return { status: "inconclusive", witness: w, decision: d, attempts: n };
    }
    const w = await verify(artifact, !replayChecked);
    replayChecked = true;
    lastArtifact = artifact;
    lastWitness = w;

    let d: Decision;
    let failing: Set<string>;
    if (w.loadError) {
      // The artifact didn't run / couldn't be verified. Never accept — but this is
      // recoverable, so feed the error back and let the solver try again.
      d = { verdict: "inconclusive", assurance: "none", rationale: w.loadError };
      emit({ t: "attempt.verdict", n, decision: d });
      feedback = {
        attempt: n,
        failed: [{ id: "did_not_run", detail: w.loadError }],
        held: [],
        regressed: prevFailed.has("did_not_run") ? [] : ["did_not_run"],
        progress: "artifact did not run",
      };
      failing = new Set(["did_not_run"]);
    } else {
      d = decide(w, policy);
      emit({ t: "attempt.verdict", n, decision: d });
      if (d.verdict === "accept") {
        emit({ t: "loop.done", status: "accepted" });
        return { status: "accepted", artifact, witness: w, decision: d, attempts: n };
      }
      if (d.verdict === "inconclusive") {
        // genuine ambiguity (e.g. a quarantined nondeterministic verifier) → escalate
        emit({ t: "loop.done", status: "inconclusive" });
        return { status: "inconclusive", artifact, witness: w, decision: d, attempts: n };
      }
      // reject → solver feedback + stall detection on the FULL failing set
      // (including held-out claims), so hidden progress isn't mistaken for a stall.
      feedback = buildFeedback(n, w, prevFailed, quorum);
      failing = new Set(w.claims.filter((c) => claimStatus(c, quorum) === "fail").map((c) => c.id));
    }
    lastDecision = d;

    const sameAsPrev =
      failing.size > 0 &&
      failing.size === prevFailed.size &&
      [...failing].every((id) => prevFailed.has(id));
    stall = sameAsPrev ? stall + 1 : 0;
    prevFailed = failing;
    if (stall >= stallK) {
      emit({ t: "loop.done", status: "stalled" });
      return { status: "stalled", artifact, witness: w, decision: d, attempts: n };
    }
  }

  emit({ t: "loop.done", status: "rejected-exhausted" });
  return {
    status: "rejected-exhausted",
    artifact: lastArtifact,
    witness: lastWitness,
    decision: lastDecision,
    attempts: maxAttempts,
  };
}
