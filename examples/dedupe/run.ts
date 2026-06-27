// examples/dedupe — M0 end-to-end: the loop closing on the SOTA witness model.
// A code-domain task: spec-author writes property tests, solver writes the impl,
// the deterministic JS verifier produces a witness, the loop retries on reject.
//
//   node examples/dedupe/run.ts

import { runLoop, type Solver, type SpecAuthor } from "@warrant/core";
import { FunctionVerifier } from "@warrant/verify-fn";
import { makePrinter, nth, printWitness } from "../_shared.ts";

type Task = { name: string; signature: string; description: string };

const task: Task = {
  name: "dedupe",
  signature: "function dedupe(xs) -> array",
  description: "Remove duplicates from an array, preserving the order of first appearance.",
};

// SpecAuthor — authored from the task ALONE. Emits JS source defining property
// tests + `properties()`. Uses the injected `__seed` so inputs are deterministic.
const specAuthor: SpecAuthor<Task, string> = {
  async author() {
    return `
function rng(seed, n, hi) {
  let s = (seed >>> 0) || 1; const out = [];
  for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 7; s ^= s << 17; s >>>= 0; out.push(s % hi); }
  return out;
}
function cases() {
  const v = [[], [1, 1, 1], [3, 1, 2, 1, 3, 2]];
  for (let i = 0; i < 200; i++) v.push(rng(__seed + i + 1, i % 12, 6));
  return v;
}
function properties() {
  return [
    { id: "returns_array", severity: "required", test: () => {
        assert(Array.isArray(dedupe([1, 2, 2])), "must return an array");
    } },
    { id: "no_duplicates", severity: "required", test: () => {
        for (const xs of cases()) {
          const o = dedupe(xs.slice()); const seen = new Set();
          for (const x of o) { assert(!seen.has(x), "duplicate " + x + " in " + JSON.stringify(o) + " for " + JSON.stringify(xs)); seen.add(x); }
        }
    } },
    { id: "preserves_first_seen_order", severity: "required", test: () => {
        for (const xs of cases()) {
          const o = dedupe(xs.slice()); const exp = []; const seen = new Set();
          for (const x of xs) if (!seen.has(x)) { seen.add(x); exp.push(x); }
          assert(JSON.stringify(o) === JSON.stringify(exp), "order wrong on " + JSON.stringify(xs) + ": got " + JSON.stringify(o) + " want " + JSON.stringify(exp));
        }
    } },
    { id: "idempotent", severity: "required", test: () => {
        for (const xs of cases()) {
          const once = dedupe(xs.slice());
          assert(JSON.stringify(dedupe(once.slice())) === JSON.stringify(once), "not idempotent on " + JSON.stringify(xs));
        }
    } },
  ];
}
`;
  },
};

// Solver — sees only the task + prior witness, NEVER the contract source.
const ATTEMPTS = [
  // attempt 0: plausible but wrong — lastIndexOf keeps the LAST occurrence → wrong order
  `function dedupe(xs) { return xs.filter((x, i) => xs.lastIndexOf(x) === i); }`,
  // attempt 1: correct — Set preserves first-seen insertion order in JS
  `function dedupe(xs) { return [...new Set(xs)]; }`,
];
const solver: Solver<Task, string> = {
  async solve(_task, attempt) {
    return nth(ATTEMPTS, attempt);
  },
};

// A negative control: identity. A good contract MUST reject it (it keeps dups).
const negativeControls = [`function dedupe(xs) { return xs; }`];

const result = await runLoop<Task, string, string>({
  task,
  specAuthor,
  solver,
  verifier: new FunctionVerifier(),
  negativeControls,
  onEvent: makePrinter(),
});

if (result.status === "accepted") {
  console.log(
    `\nclosed loop in ${result.attempts} attempts — assurance: ${result.decision?.assurance}`,
  );
  console.log("\naccepted artifact:\n");
  console.log(`    ${(result.artifact ?? "").trim()}`);
} else {
  printWitness(result.witness);
}
