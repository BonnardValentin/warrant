// @warrant/core — the loop (Layers 2 & 4).
// Author the contract once; solve → verify → retry until accepted, exhausted,
// stalled, or inconclusive. Independence is enforced at the TYPE level: Solver.solve
// has no contract parameter, so a solver literally cannot read the contract.

import { type Witness, type Claim, claimStatus, DEFAULT_QUORUM } from "./witness.ts";
import { type Verifier } from "./verifier.ts";
import { type Policy, type Decision, standard } from "./policy.ts";

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

// Solver feedback reveals only claims with revealed !== false (Layer 4·H).
function buildFeedback(attempt: number, w: Witness, prevFailed: Set<string>): Feedback {
  const visible = w.claims.filter((c) => c.revealed !== false);
  const failed = visible
    .filter((c) => claimStatus(c) === "fail")
    .map((c) => ({ id: c.id, detail: detailOf(c) }));
  const held = visible.filter((c) => claimStatus(c) === "hold").map((c) => c.id);
  const regressed = failed.filter((f) => !prevFailed.has(f.id)).map((f) => f.id);
  return { attempt, failed, held, regressed, progress: `${held.length}/${visible.length} visible claims hold` };
}

// Determinism is VERIFIED, not trusted (Layer 4·G): run a deterministic verifier
// twice; if the witnesses differ, quarantine it as inconclusive.
async function verifyChecked<A, C>(v: Verifier<A, C>, artifact: A, contract: C, seed: number): Promise<Witness> {
  const w = await v.verify(artifact, contract, seed);
  if (v.cls !== "deterministic" || w.loadError) return w;
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
          evidence: { kind: "score", value: 0.5, of: 1, samples: { n: DEFAULT_QUORUM.n, agree: 2 } },
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
  maxAttempts?: number;
  stallK?: number;
  negativeControls?: A[];
  onEvent?: (e: Event) => void;
  seed?: number;
}

export async function runLoop<T, C, A>(cfg: RunConfig<T, C, A>): Promise<LoopResult<A>> {
  const policy = cfg.policy ?? standard();
  const maxAttempts = cfg.maxAttempts ?? 5;
  const stallK = cfg.stallK ?? 2;
  const seed = cfg.seed ?? 1;
  const emit = cfg.onEvent ?? (() => {});

  const contract = await cfg.specAuthor.author(cfg.task);
  emit({ t: "spec.authored" });

  // Layer 4·H — negative controls: the contract MUST reject deliberately-wrong artifacts.
  for (let i = 0; i < (cfg.negativeControls?.length ?? 0); i++) {
    const w = await verifyChecked(cfg.verifier, cfg.negativeControls![i], contract, seed);
    const d = policy(w.claims);
    const rejected = d.verdict !== "accept";
    emit({ t: "negative-control", index: i, rejected });
    if (!rejected) {
      emit({ t: "loop.done", status: "bad-contract" });
      return { status: "bad-contract", witness: w, decision: d, attempts: 0 };
    }
  }

  let prevFailed = new Set<string>();
  let stall = 0;
  let feedback: Feedback | undefined;
  let last: Witness = { schema: "warrant/v1", claims: [] };
  let lastDecision: Decision | undefined;

  for (let n = 1; n <= maxAttempts; n++) {
    emit({ t: "attempt.start", n });
    const artifact = await cfg.solver.solve(cfg.task, n - 1, feedback);
    const w = await verifyChecked(cfg.verifier, artifact, contract, seed);
    const d = policy(w.claims);
    last = w;
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

    // reject → feedback diff + stall detection (Layer 2·B/C)
    feedback = buildFeedback(n, w, prevFailed);
    const failedSet = new Set(feedback.failed.map((f) => f.id));
    const sameAsPrev =
      failedSet.size === prevFailed.size && [...failedSet].every((id) => prevFailed.has(id));
    stall = sameAsPrev ? stall + 1 : 0;
    prevFailed = failedSet;
    if (stall >= stallK) {
      emit({ t: "loop.done", status: "stalled" });
      return { status: "stalled", artifact, witness: w, decision: d, attempts: n };
    }
  }

  emit({ t: "loop.done", status: "rejected-exhausted" });
  return { status: "rejected-exhausted", witness: last, decision: lastDecision, attempts: maxAttempts };
}
