import assert from "node:assert/strict";
import { test } from "node:test";
import { assuranceOf, standard } from "../src/policy.ts";
import type { Claim } from "../src/witness.ts";

const req = (ok: boolean): Claim => ({
  id: "r",
  severity: "required",
  evidence: { kind: "binary", ok },
});
const sc = (value: number): Claim => ({
  id: "s",
  severity: "scored",
  evidence: { kind: "score", value, of: 1 },
});
const proof = (checked: boolean): Claim => ({
  id: "p",
  severity: "required",
  evidence: { kind: "proof", system: "replay", artifact: "x", checked },
});

test("empty claims → inconclusive, not a vacuous accept", () => {
  assert.equal(standard()([]).verdict, "inconclusive");
});

test("all required hold → accept, assurance tested", () => {
  const d = standard()([req(true)]);
  assert.equal(d.verdict, "accept");
  assert.equal(d.assurance, "tested");
});

test("a failing required claim → reject", () => {
  assert.equal(standard()([req(true), req(false)]).verdict, "reject");
});

test("scored budget below θ → reject; at/above → accept", () => {
  assert.equal(standard(0.9)([req(true), sc(0.5)]).verdict, "reject");
  assert.equal(standard(0.9)([req(true), sc(1)]).verdict, "accept");
});

test("an inconclusive required claim → inconclusive", () => {
  const split: Claim = {
    id: "x",
    severity: "required",
    evidence: { kind: "score", value: 0.5, of: 1, samples: { n: 5, agree: 3 } },
  };
  assert.equal(standard()([split]).verdict, "inconclusive");
});

test("assurance is the weakest-link of required claims", () => {
  assert.equal(assuranceOf([proof(true)]), "proven");
  assert.equal(assuranceOf([req(true)]), "tested");
  // a required score drags a proven+tested set down to judged
  const reqScore: Claim = {
    id: "rs",
    severity: "required",
    evidence: { kind: "score", value: 1, of: 1 },
  };
  assert.equal(assuranceOf([proof(true), reqScore]), "judged");
  assert.equal(assuranceOf([sc(1)]), "none"); // no required claims
});
