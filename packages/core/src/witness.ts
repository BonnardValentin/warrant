// The witness model. A witness is claims, each carrying typed evidence;
// acceptance is a separate policy (policy.ts). Zero dependencies.

export type Evidence =
  | { kind: "binary"; ok: boolean; detail?: string }
  | { kind: "score"; value: number; of: number; samples?: { n: number; agree: number } }
  | {
      kind: "proof";
      system: "replay" | "lean" | "attestation";
      artifact: string;
      checked: boolean;
    };

export type Severity = "required" | "scored";

export interface Claim {
  id: string;
  severity: Severity;
  weight?: number;
  /** default true; false = held out of solver feedback (anti-gaming) */
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

/** Three-valued per-claim status: holds, fails, or can't tell. */
export function claimStatus(c: Claim, quorum: Quorum = DEFAULT_QUORUM): ClaimStatus {
  const e = c.evidence;
  switch (e.kind) {
    case "binary":
      return e.ok ? "hold" : "fail";
    case "proof":
      return e.checked ? "hold" : "fail";
    case "score": {
      if (e.samples) {
        const { n, agree } = e.samples;
        if (n === 0) return "inconclusive";
        const need = quorum.agree / quorum.n; // agreement fraction, panel-size independent
        if (agree / n >= need) return "hold";
        if ((n - agree) / n >= need) return "fail";
        return "inconclusive"; // judges split → honest "don't know"
      }
      if (e.of === 0) return "inconclusive"; // nothing measured
      return e.value / e.of >= 0.5 ? "hold" : "fail";
    }
  }
}

export function scoreFraction(c: Claim): number {
  const e = c.evidence;
  if (e.kind === "score") return e.value / e.of;
  if (e.kind === "binary") return e.ok ? 1 : 0;
  return e.checked ? 1 : 0;
}
