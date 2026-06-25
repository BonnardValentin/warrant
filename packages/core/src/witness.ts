// @warrant/core — the witness model (Layer 1).
// A witness is claims, each carrying typed evidence. Acceptance is a separate
// policy (see policy.ts). This file has zero dependencies and is the canonical
// shape that serializes to `warrant/v1` JSON across TS and Rust.

export type Evidence =
  | { kind: "binary"; ok: boolean; detail?: string }
  | { kind: "score"; value: number; of: number; samples?: { n: number; agree: number } }
  | { kind: "proof"; system: "replay" | "lean" | "attestation"; artifact: string; checked: boolean };

export type Severity = "required" | "scored";

export interface Claim {
  id: string;
  severity: Severity;
  weight?: number;
  /** default true; false = held out of solver feedback (anti-gaming, Layer 4·H) */
  revealed?: boolean;
  evidence: Evidence;
}

export interface Witness {
  schema: "warrant/v1";
  loadError?: string;
  seed?: number;
  claims: Claim[];
}

export type Verdict = "accept" | "reject" | "inconclusive";
export type Assurance = "proven" | "tested" | "judged" | "none";

export type Quorum = { n: number; agree: number };
export const DEFAULT_QUORUM: Quorum = { n: 5, agree: 4 };

export type ClaimStatus = "hold" | "fail" | "inconclusive";

/** Three-valued per-claim status (Layer 4·G). */
export function claimStatus(c: Claim, quorum: Quorum = DEFAULT_QUORUM): ClaimStatus {
  const e = c.evidence;
  switch (e.kind) {
    case "binary":
      return e.ok ? "hold" : "fail";
    case "proof":
      return e.checked ? "hold" : "fail";
    case "score":
      if (e.samples) {
        if (e.samples.agree >= quorum.agree) return "hold";
        if (e.samples.n - e.samples.agree >= quorum.agree) return "fail";
        return "inconclusive"; // judges split → honest "don't know"
      }
      return e.value / e.of >= 0.5 ? "hold" : "fail";
  }
}

export function scoreFraction(c: Claim): number {
  const e = c.evidence;
  if (e.kind === "score") return e.value / e.of;
  if (e.kind === "binary") return e.ok ? 1 : 0;
  return e.checked ? 1 : 0;
}
