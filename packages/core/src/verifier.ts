// @warrant/core — verifier + sandbox interfaces (Layer 3·D).
// Two separable concerns: a Verifier declares its CLASS (how trustworthy/repeatable
// it is), and a Sandbox isolates the untrusted artifact execution. verify-js never
// hardcodes a sandbox, so hardening isolation (subprocess → WASM) never touches it.

import { type Witness } from "./witness.ts";

export type VerifierClass = "deterministic" | "stochastic" | "proof";

export interface Verifier<A = unknown, C = unknown> {
  /** deterministic → replay-checked & cacheable · stochastic → judge panel · proof → re-check, don't re-run */
  readonly cls: VerifierClass;
  verify(artifact: A, contract: C, seed: number): Promise<Witness>;
}

export interface SandboxLimits {
  ms: number;
  memMb: number;
  net: false;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs untrusted, model-generated code. The artifact-safety boundary. */
export interface Sandbox {
  run(entryFile: string, limits: SandboxLimits): Promise<SandboxResult>;
}
