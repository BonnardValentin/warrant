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

  const contract = await cfg.specAuthor.author(cfg.task);
  emit({ t: "spec.authored" });

  let replayChecked = false;
  const verify = async (artifact: A): Promise<Witness> => {
    const w = await verifyChecked(cfg.verifier, artifact, contract, seed, !replayChecked);
    replayChecked = true;
    return w;
  };

  // Negative controls: the contract MUST actively reject deliberately-wrong
  // artifacts. Anything short of a "reject" verdict (including inconclusive) means
  // we can't trust the contract.
  for (const [i, control] of (cfg.negativeControls ?? []).entries()) {
    const w = await verify(control);
    const d = policy(w.claims);
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
    const artifact = await cfg.solver.solve(cfg.task, n - 1, feedback);
    const w = await verify(artifact);
    const d = policy(w.claims);
    lastArtifact = artifact;
    lastWitness = w;
    lastDecision = d;
    emit({ t: "attempt.verdict", n, decision: d });

    if (d.verdict === "accept") {
      emit({ t: "loop.done", status: "accepted" });
      return { status: "accepted", artifact, witness: w, decision: d, attempts: n };
    }
    if (d.verdict === "inconclusive") {
      emit({ t: "loop.done", status: "inconclusive" });
      return { status: "inconclusive", artifact, witness: w, decision: d, attempts: n };
    }

    // reject → solver feedback, then stall detection on the FULL failing set
    // (including held-out claims), so hidden progress isn't mistaken for a stall.
    feedback = buildFeedback(n, w, prevFailed, quorum);
    const failing = new Set(
      w.claims.filter((c) => claimStatus(c, quorum) === "fail").map((c) => c.id),
    );
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
