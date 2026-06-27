// Proves the role layer is backend-agnostic: the generic builders (zero SDK)
// driven by a plain `Complete` stub — could just as well be a local model, a raw
// fetch, or a human — compose with the real FunctionVerifier and core to close
// the loop. No LLM, no network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runLoop } from "../../core/src/index.ts";
import { FunctionVerifier } from "../../verify-fn/src/index.ts";
import { type CodeTask, makeCritic, makeSolver, makeSpecAuthor } from "../src/complete.ts";

test("generic role builders work with any Complete (here, a non-LLM stub)", async () => {
  const specComplete = async () =>
    `function properties() {
       return [
         { id: "dedup", severity: "required", test: () => {
             assert(JSON.stringify(dedupe([1, 1, 2])) === JSON.stringify([1, 2]), "removes dups");
             assert(JSON.stringify(dedupe([3, 1, 2, 1, 3, 2])) === JSON.stringify([3, 1, 2]), "keeps order");
         } },
       ];
     }`;
  const solveComplete = async () => "function dedupe(xs) { return [...new Set(xs)]; }";
  const criticComplete = async () => "NONE";

  const task: CodeTask = {
    description: "dedupe an array, keep first-seen order",
    functionName: "dedupe",
  };
  const r = await runLoop<CodeTask, string, string>({
    task,
    specAuthor: makeSpecAuthor(specComplete),
    solver: makeSolver(solveComplete),
    critic: makeCritic(criticComplete),
    verifier: new FunctionVerifier(),
    negativeControls: ["function dedupe(xs) { return xs; }"],
  });

  assert.equal(r.status, "accepted");
  assert.equal(r.decision?.assurance, "tested");
});
