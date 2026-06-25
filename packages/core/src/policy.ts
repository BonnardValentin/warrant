// Acceptance policy: maps claims → a decision. Kept OUT of verifiers, so
// quorum/weighting/critic compose without touching them. `standard(θ)` is the default.

import {
  type Assurance,
  type Claim,
  claimStatus,
  DEFAULT_QUORUM,
  type Quorum,
  scoreFraction,
  type Verdict,
} from "./witness.ts";

export interface Decision {
  verdict: Verdict;
  assurance: Assurance;
  rationale: string;
}

export type Policy = (claims: Claim[]) => Decision;

// Assurance = the WEAKEST evidence backing a REQUIRED claim. An accept is only
// as trustworthy as its weakest required guarantee, so a judge-only required
// claim caps the whole accept at "judged" — it can never pose as "proven".
const RANK = { score: 0, binary: 1, proof: 2 } as const; // weakest → strongest
const ORDER: Assurance[] = ["judged", "tested", "proven"];

export function assuranceOf(claims: Claim[]): Assurance {
  const required = claims.filter((c) => c.severity === "required");
  if (required.length === 0) return "none";
  return ORDER[Math.min(...required.map((c) => RANK[c.evidence.kind]))];
}

export function standard(theta = 0.9, quorum: Quorum = DEFAULT_QUORUM): Policy {
  return (claims) => {
    const assurance = assuranceOf(claims);
    const required = claims.filter((c) => c.severity === "required");
    const scored = claims.filter((c) => c.severity === "scored");

    // honesty first: an inconclusive required claim makes the whole verdict inconclusive
    if (required.some((c) => claimStatus(c, quorum) === "inconclusive"))
      return { verdict: "inconclusive", assurance, rationale: "a required claim is inconclusive" };

    const failed = required.filter((c) => claimStatus(c, quorum) === "fail");
    if (failed.length)
      return {
        verdict: "reject",
        assurance,
        rationale: `${failed.length} required claim(s) failed`,
      };

    if (scored.some((c) => claimStatus(c, quorum) === "inconclusive"))
      return { verdict: "inconclusive", assurance, rationale: "a scored claim is inconclusive" };

    const totalW = scored.reduce((s, c) => s + (c.weight ?? 1), 0);
    const budget =
      totalW === 0
        ? 1
        : scored.reduce((s, c) => s + scoreFraction(c) * (c.weight ?? 1), 0) / totalW;

    if (budget >= theta)
      return {
        verdict: "accept",
        assurance,
        rationale: scored.length
          ? `budget ${budget.toFixed(2)} ≥ θ ${theta}`
          : "all required claims hold",
      };
    return { verdict: "reject", assurance, rationale: `budget ${budget.toFixed(2)} < θ ${theta}` };
  };
}
