// Verifier + Sandbox interfaces. A Verifier declares its class (how repeatable/
// trustworthy it is); a Sandbox isolates untrusted artifact execution. Verifiers
// take a Sandbox rather than hardcode one, so isolation can harden (subprocess →
// WASM) without touching them.

import type { Witness } from "./witness.ts";

export type VerifierClass = "deterministic" | "stochastic" | "proof";

export interface Verifier<A = unknown, C = unknown> {
  /** deterministic → replay-checked & cacheable · stochastic → judge panel · proof → re-check, don't re-run */
  readonly cls: VerifierClass;
  verify(artifact: A, contract: C, seed: number): Promise<Witness>;
}

// The subprocess sandbox bounds TIME and MEMORY only. It does NOT isolate
// capabilities (filesystem, network, child processes) — that needs a stronger
// sandbox (WASM), which is the planned artifact-safety boundary. Treat artifacts
// as only as contained as the Sandbox in use actually guarantees.
export interface SandboxLimits {
  ms: number;
  memMb: number;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs model-generated code under resource bounds (see SandboxLimits). */
export interface Sandbox {
  run(entryFile: string, limits: SandboxLimits): Promise<SandboxResult>;
}
