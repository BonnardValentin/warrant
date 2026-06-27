// Generic role builders for the CODE domain (an artifact that is a function
// defined as JS source), parameterized by ONE minimal primitive: a text
// completion. ZERO dependencies — back it with any LLM SDK, a local model, a raw
// fetch, a stub, or a human at a keyboard. Bring a `Complete`; get a SpecAuthor,
// Solver, and Critic that plug straight into @warrant/core's runLoop.

import type { Critic, Solver, SpecAuthor } from "@warrant/core";

/** The one thing a backend must provide: turn a (system, prompt) into text. */
export type CompleteRequest = { system: string; prompt: string };
export type Complete = (req: CompleteRequest) => Promise<string>;

export type CodeTask = { description: string; functionName: string };

// Strip a markdown fence if the backend wrapped the output in one.
function unfence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/);
  return (m?.[1] ?? t).trim();
}

// The exact harness contract a property suite must follow. Shared by the
// spec-author and the critic so they can never drift (a mismatch would make the
// verifier unable to run the suite).
export const SUITE_RULES =
  "Harness contract — output JavaScript source with one function `properties()` returning an array " +
  "of { id: string, severity: 'required' | 'scored', test: () => void }:\n" +
  "- `test` takes NO arguments.\n" +
  "- Inside `test`, call the function under test by its name (already defined in scope); do NOT " +
  "redeclare, import, or require it.\n" +
  "- Check with `assert(condition, message)` — `assert` is ALREADY a global function; do NOT import, " +
  "require, or redefine it. On violation it throws; include a clear message with a counterexample.\n" +
  "- `severity` must be exactly the string 'required' or 'scored'.\n" +
  "- Use the in-scope integer `__seed` for deterministic randomized inputs across many cases.\n" +
  "- No imports, no top-level code other than function declarations, no markdown fences.";

// Sees ONLY the task. Returns the property-test suite the verify-fn harness runs.
export function makeSpecAuthor(complete: Complete): SpecAuthor<CodeTask, string> {
  return {
    async author(task) {
      const code = await complete({
        system:
          "You author property-based tests that pin down what a correct solution must satisfy. " +
          "You will NOT see the implementation — write the properties from the spec alone.\n\n" +
          `${SUITE_RULES}\n\nExample shape:\n` +
          "function properties() {\n" +
          "  return [\n" +
          `    { id: "returns_array", severity: "required", test: () => { assert(Array.isArray(${task.functionName}([1,2,2])), "must return an array"); } },\n` +
          "  ];\n" +
          "}",
        prompt: `Task: ${task.description}\nThe function under test is named \`${task.functionName}\`.`,
      });
      return unfence(code);
    },
  };
}

// Sees ONLY the task and the prior witness's failed claims — never the suite —
// so it cannot tailor code to the exact tests.
export function makeSolver(complete: Complete): Solver<CodeTask, string> {
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
      const code = await complete({
        system:
          "You write correct, self-contained JavaScript. Output ONLY the implementation source " +
          "defining the requested function — no prose, no tests, no imports, no markdown fences.",
        prompt,
      });
      return unfence(code);
    },
  };
}

// Sees the task and the current suite — never an implementation. Returns the FULL
// strengthened suite, or null (the backend says "NONE") when it finds no gap.
export function makeCritic(complete: Complete): Critic<CodeTask, string> {
  return {
    async propose(task, contract) {
      const out = await complete({
        system:
          "You are an adversarial reviewer of a property-test SUITE for a function. You see the task " +
          "and the CURRENT suite — never any implementation. Find ONE important property the suite " +
          "MISSES: an input class, edge case, or invariant a plausible-but-wrong solution could satisfy " +
          "the current suite while still violating. If the suite already covers the task thoroughly, " +
          "output exactly NONE. Otherwise output the FULL suite — every existing property UNCHANGED, " +
          `plus your new one. Do NOT weaken or remove existing properties.\n\n${SUITE_RULES}`,
        prompt: `Task: ${task.description}\nFunction under test: \`${task.functionName}\`.\nCurrent suite:\n\n${contract}`,
      });
      return /^NONE\b/i.test(out.trim()) ? null : unfence(out);
    },
  };
}
