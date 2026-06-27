// examples/dedupe-ai — M2: the dedupe loop solved by a REAL model.
// Same loop, same verifier as examples/dedupe — but the spec-author, solver, and
// critic are model-backed (@warrant/agents). The PROVIDER is chosen here, not in
// the package: this example picks Anthropic, but swap the two lines below for
// openai("…") (or any AI SDK model) to use a different one.
//
//   ANTHROPIC_API_KEY=… node examples/dedupe-ai/run.ts

import { anthropic } from "@ai-sdk/anthropic";
import { aiCritic, aiSolver, aiSpecAuthor, type CodeTask } from "@warrant/agents/ai-sdk";
import { runLoop } from "@warrant/core";
import { FunctionVerifier } from "@warrant/verify-fn";
import { makePrinter, printWitness } from "../_shared.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log(
    "Set ANTHROPIC_API_KEY to run this example, or edit it to use a different AI SDK provider.",
  );
  process.exit(0);
}

const model = anthropic("claude-opus-4-8"); // ← the only provider-specific line

const task: CodeTask = {
  description: "Remove duplicates from an array, preserving the order of first appearance.",
  functionName: "dedupe",
};

// A negative control: identity. A good contract MUST reject it (it keeps dups).
const negativeControls = ["function dedupe(xs) { return xs; }"];

const result = await runLoop<CodeTask, string, string>({
  task,
  specAuthor: aiSpecAuthor(model),
  solver: aiSolver(model),
  verifier: new FunctionVerifier(),
  critic: aiCritic(model),
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
