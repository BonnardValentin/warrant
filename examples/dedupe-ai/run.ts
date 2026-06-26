// examples/dedupe-ai — M2: the dedupe loop solved by a REAL model.
// Same loop, same verifier as examples/dedupe — but the spec-author and solver
// are now model-backed (@warrant/solver-ai, Vercel AI SDK). Default model is
// Anthropic claude-opus-4-8; pass any AI SDK provider to aiSolver/aiSpecAuthor to
// swap (e.g. openai("…")). Needs an API key for the chosen provider.
//
//   ANTHROPIC_API_KEY=… node examples/dedupe-ai/run.ts

import { runLoop } from "../../packages/core/src/index.ts";
import {
  aiCritic,
  aiSolver,
  aiSpecAuthor,
  type CodeTask,
} from "../../packages/solver-ai/src/index.ts";
import { FunctionVerifier } from "../../packages/verify-fn/src/index.ts";
import { makePrinter, printWitness } from "../_shared.ts";

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

const result = await runLoop<CodeTask, string, string>({
  task,
  specAuthor: aiSpecAuthor(),
  solver: aiSolver(),
  verifier: new FunctionVerifier(),
  critic: aiCritic(),
  negativeControls,
  onEvent: makePrinter({
    authored: "contract authored by the model (spec sees only the task)",
    solving: "model solving (sees only task + prior witness)…",
  }),
  maxAttempts: 4,
});

if (result.status === "accepted") {
  console.log(
    `\nclosed loop in ${result.attempts} attempts — assurance: ${result.decision?.assurance}\n`,
  );
  console.log(`    ${(result.artifact ?? "").trim()}`);
} else {
  printWitness(result.witness);
}
