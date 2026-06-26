// @warrant/solver-ai — a model-backed SpecAuthor + Solver for the CODE domain,
// built on the Vercel AI SDK so it's provider-agnostic. Pass any AI SDK model; it
// defaults to Anthropic claude-opus-4-8. The model is an implementation detail of
// these two roles — warrant's core imports no SDK — and you can always implement
// Solver/SpecAuthor yourself with a raw provider SDK for full control.

import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { generateObject } from "ai";
import { z } from "zod";
import type { Critic, Solver, SpecAuthor } from "../../core/src/index.ts";

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
          "You will NOT see the implementation — write the properties from the spec alone.\n\n" +
          "Output JavaScript source with one function `properties()` returning an array of " +
          "{ id: string, severity: 'required' | 'scored', test: () => void }. Strict contract:\n" +
          "- `test` takes NO arguments.\n" +
          "- Inside `test`, call the function under test by its name (already defined in scope); " +
          "do NOT redeclare, import, or require it.\n" +
          "- Check with `assert(condition, message)` — `assert` is ALREADY a global function; " +
          "do NOT import, require, or redefine it. On violation `assert` throws; include a clear " +
          "message with a counterexample.\n" +
          "- `severity` must be exactly the string 'required' or 'scored'.\n" +
          "- Use the in-scope integer `__seed` for deterministic randomized inputs across many cases.\n" +
          "- No imports, no top-level code other than function declarations, no markdown fences.\n\n" +
          "Example shape:\n" +
          "function properties() {\n" +
          "  return [\n" +
          `    { id: "returns_array", severity: "required", test: () => { assert(Array.isArray(${task.functionName}([1,2,2])), "must return an array"); } },\n` +
          "  ];\n" +
          "}",
        prompt: `Task: ${task.description}\nThe function under test is named \`${task.functionName}\`.`,
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

const CRITIQUE = z.object({ foundGap: z.boolean(), code: z.string() });

// The critic sees the task and the current test suite — never an implementation.
// It hunts for a property the suite misses and returns the FULL strengthened suite,
// or null when it finds no gap. Returning the whole suite keeps the core's merge
// trivial (it just swaps the contract).
export function aiCritic(model: LanguageModel = defaultModel()): Critic<CodeTask, string> {
  return {
    async propose(task, contract) {
      const { object } = await generateObject({
        model,
        schema: CRITIQUE,
        system:
          "You are an adversarial reviewer of a property-test SUITE for a function. You see the task " +
          "and the CURRENT suite — never any implementation. Find ONE important property the suite " +
          "MISSES: an input class, edge case, or invariant that a plausible-but-wrong solution could " +
          "satisfy the current suite while still violating. If you find one, return foundGap=true and " +
          "`code` = the FULL suite (every existing property UNCHANGED, plus your new one) in the exact " +
          "same format and harness contract (one `properties()` returning { id, severity, test }; each " +
          "`test` is zero-arg, calls the function by name, uses the global `assert(cond, msg)`, severity " +
          "is exactly 'required' or 'scored', deterministic inputs from the in-scope `__seed`; no imports, " +
          "no fences). Do NOT weaken or remove existing properties. If the suite already covers the task " +
          "thoroughly, return foundGap=false and code=''.",
        prompt: `Task: ${task.description}\nFunction under test: \`${task.functionName}\`.\nCurrent suite:\n\n${contract}`,
      });
      return object.foundGap ? unfence(object.code) : null;
    },
  };
}
