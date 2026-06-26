// @warrant/solver-ai — a model-backed SpecAuthor + Solver for the CODE domain,
// built on the Vercel AI SDK so it's provider-agnostic. Pass any AI SDK model; it
// defaults to Anthropic claude-opus-4-8. The model is an implementation detail of
// these two roles — warrant's core imports no SDK — and you can always implement
// Solver/SpecAuthor yourself with a raw provider SDK for full control.

import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { generateObject } from "ai";
import { z } from "zod";
import type { Solver, SpecAuthor } from "../../core/src/index.ts";

export type CodeTask = {
  description: string;
  functionName: string;
};

const CODE = z.object({ code: z.string() });

// Models often wrap code in a markdown fence despite instructions not to; strip
// it so a formatting slip doesn't turn into an un-runnable artifact.
function unfence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/);
  return (m?.[1] ?? t).trim();
}

const defaultModel = (): LanguageModel => anthropic("claude-opus-4-8");

// The spec-author sees ONLY the task. It returns JS source defining the property
// tests the verify-fn harness runs (`properties()`, `assert`, and `__seed` are in
// scope when the harness executes them).
export function aiSpecAuthor(model: LanguageModel = defaultModel()): SpecAuthor<CodeTask, string> {
  return {
    async author(task) {
      const { object } = await generateObject({
        model,
        schema: CODE,
        system:
          "You author property-based tests that pin down what a correct solution must satisfy. " +
          "You will NOT see the implementation — write the properties from the spec alone. " +
          "Output JavaScript source defining `function properties()` that returns an array of " +
          "`{ id, severity, test }`, where each `test` is a zero-arg function that calls the candidate " +
          "function directly and throws via the provided `assert(cond, msg)` on a violation, with a clear " +
          "message and counterexample. Use the injected integer `__seed` to generate deterministic " +
          "randomized inputs across many cases. Do not define the implementation; do not import anything.",
        prompt: `Task: ${task.description}\nThe implementation is a function named \`${task.functionName}\`.`,
      });
      return unfence(object.code);
    },
  };
}

// The solver sees ONLY the task and the prior witness's failed claims — never the
// spec source — so it cannot tailor code to the exact tests.
export function aiSolver(model: LanguageModel = defaultModel()): Solver<CodeTask, string> {
  return {
    async solve(task, _attempt, feedback) {
      let prompt =
        `Task: ${task.description}\nDefine a JavaScript function named \`${task.functionName}\`. ` +
        "Output only the function source.";
      if (feedback) {
        const failed = feedback.failed.map((f) => `- ${f.id}: ${f.detail}`).join("\n");
        prompt +=
          "\n\nYour previous attempt was rejected by an independent verifier. These named checks " +
          `failed (you are NOT shown the tests themselves):\n${failed}\n` +
          `Keep what already passed (${feedback.held.join(", ") || "none"}). Fix the failures.`;
      }
      const { object } = await generateObject({
        model,
        schema: CODE,
        system:
          "You write correct, self-contained JavaScript. Output ONLY the implementation source " +
          "defining the requested function — no prose, no tests, no imports, no markdown fences.",
        prompt,
      });
      return unfence(object.code);
    },
  };
}
