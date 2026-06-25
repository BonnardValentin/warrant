// @warrant/verify-predicate — verify a plain DATA value against named predicates,
// in-process (no subprocess, no sandbox). It implements the same Verifier
// interface as verify-fn, which is the point: the core loop is domain-agnostic.
// code vs data, subprocess vs in-process, binary vs scored evidence — all run
// through the identical runLoop, unchanged.

import type { Verifier } from "../../core/src/verifier.ts";
import type { Claim, Severity, Witness } from "../../core/src/witness.ts";

// A binary predicate throws on failure; a score predicate returns a number in [0,1].
export type Predicate<A> =
  | {
      id: string;
      kind?: "binary";
      severity?: Severity;
      revealed?: boolean;
      check: (value: A) => void;
    }
  | {
      id: string;
      kind: "score";
      severity?: Severity;
      weight?: number;
      score: (value: A) => number;
    };

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export class PredicateVerifier<A> implements Verifier<A, Predicate<A>[]> {
  readonly cls = "deterministic" as const;

  verify(value: A, predicates: Predicate<A>[], seed: number): Promise<Witness> {
    const claims: Claim[] = predicates.map((p) => {
      if (p.kind === "score") {
        // A throwing score() contributes 0 rather than aborting the whole map —
        // the other (often required) claims still get recorded and can reject.
        let scored = 0;
        try {
          scored = clamp01(p.score(value));
        } catch {
          scored = 0;
        }
        return {
          id: p.id,
          severity: p.severity ?? "scored",
          weight: p.weight,
          evidence: { kind: "score", value: scored, of: 1 },
        };
      }
      try {
        p.check(value);
        return {
          id: p.id,
          severity: p.severity ?? "required",
          revealed: p.revealed,
          evidence: { kind: "binary", ok: true },
        };
      } catch (e) {
        return {
          id: p.id,
          severity: p.severity ?? "required",
          revealed: p.revealed,
          evidence: {
            kind: "binary",
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          },
        };
      }
    });
    return Promise.resolve({ schema: "warrant/v1", seed, claims });
  }
}
