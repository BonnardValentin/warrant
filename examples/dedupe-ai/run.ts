// examples/dedupe-ai — M2: the dedupe loop solved by a REAL model.
// Same loop, same verifier as examples/dedupe — but the spec-author and solver
// are now model-backed (@warrant/solver-ai, Vercel AI SDK). Default model is
// Anthropic claude-opus-4-8; pass any AI SDK provider to aiSolver/aiSpecAuthor to
// swap (e.g. openai("…")). Needs an API key for the chosen provider.
//
//   ANTHROPIC_API_KEY=… node examples/dedupe-ai/run.ts

import { type Event, runLoop } from "../../packages/core/src/index.ts";
import { aiSolver, aiSpecAuthor, type CodeTask } from "../../packages/solver-ai/src/index.ts";
import { FunctionVerifier } from "../../packages/verify-fn/src/index.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log(
    "Set ANTHROPIC_API_KEY to run the real-model solver (default model: claude-opus-4-8).\n" +
      'To use another provider, edit this file to pass an AI SDK model, e.g. aiSolver(openai("…")).',
  );
  process.exit(0);
}

const task: CodeTask = {
  description: "Remove duplicates from an array, preserving the order of first appearance.",
  functionName: "dedupe",
};

// A negative control: identity. A good contract MUST reject it (it keeps dups).
const negativeControls = ["function dedupe(xs) { return xs; }"];

function badge(v: string): string {
  return v === "accept" ? "✓ ACCEPT" : v === "inconclusive" ? "? INCONCLUSIVE" : "✗ REJECT";
}

function printEvent(e: Event): void {
  switch (e.t) {
    case "spec.authored":
      console.log("· contract authored by the model (spec sees only the task)\n");
      break;
    case "negative-control":
      console.log(
        `· negative control #${e.index}: ${e.rejected ? "✓ rejected (good contract)" : "✗ ACCEPTED — bad contract!"}\n`,
      );
      break;
    case "attempt.start":
      console.log(`· attempt ${e.n}: model solving (sees only task + prior witness)…`);
      break;
    case "attempt.verdict":
      console.log(
        `  verdict: ${badge(e.decision.verdict)}  [assurance: ${e.decision.assurance}]  — ${e.decision.rationale}`,
      );
      break;
    case "loop.done":
      console.log(`\n══ ${e.status} ══`);
      break;
  }
}

const result = await runLoop<CodeTask, string, string>({
  task,
  specAuthor: aiSpecAuthor(),
  solver: aiSolver(),
  verifier: new FunctionVerifier(),
  negativeControls,
  onEvent: printEvent,
  maxAttempts: 4,
});

if (result.status === "accepted") {
  console.log(
    `\nclosed loop in ${result.attempts} attempts — assurance: ${result.decision?.assurance}\n`,
  );
  console.log(`    ${(result.artifact ?? "").trim()}`);
} else {
  console.log(`\nfinal witness:`);
  for (const c of result.witness.claims) {
    const e = c.evidence;
    const mark = e.kind === "binary" ? (e.ok ? "✓" : "✗") : "·";
    console.log(`  ${mark} ${c.id}${e.kind === "binary" && e.detail ? `  — ${e.detail}` : ""}`);
  }
}
