import assert from "node:assert/strict";
import { test } from "node:test";
import { type Claim, claimStatus, scoreFraction } from "../src/witness.ts";

const bin = (ok: boolean): Claim => ({
  id: "b",
  severity: "required",
  evidence: { kind: "binary", ok },
});
const score = (value: number, of = 1, samples?: { n: number; agree: number }): Claim => ({
  id: "s",
  severity: "scored",
  evidence: { kind: "score", value, of, samples },
});

test("claimStatus: binary", () => {
  assert.equal(claimStatus(bin(true)), "hold");
  assert.equal(claimStatus(bin(false)), "fail");
});

test("claimStatus: single-shot score uses 0.5 threshold", () => {
  assert.equal(claimStatus(score(0.6)), "hold");
  assert.equal(claimStatus(score(0.4)), "fail");
});

test("claimStatus: score with of===0 is inconclusive (nothing measured)", () => {
  assert.equal(claimStatus(score(0, 0)), "inconclusive");
});

test("claimStatus: sampled quorum is a fraction (default 4/5 = 0.8)", () => {
  assert.equal(claimStatus(score(0, 1, { n: 5, agree: 4 })), "hold");
  assert.equal(claimStatus(score(0, 1, { n: 5, agree: 1 })), "fail");
  assert.equal(claimStatus(score(0, 1, { n: 5, agree: 3 })), "inconclusive");
});

test("claimStatus: sampled n===0 is inconclusive", () => {
  assert.equal(claimStatus(score(0, 1, { n: 0, agree: 0 })), "inconclusive");
});

test("scoreFraction: guards a 0 denominator (no NaN / Infinity)", () => {
  assert.equal(scoreFraction(score(1, 0)), 0);
  assert.equal(scoreFraction(score(0.5, 0, { n: 0, agree: 0 })), 0);
});

test("scoreFraction: uses the sampled agreement fraction", () => {
  assert.equal(scoreFraction(score(0, 1, { n: 5, agree: 4 })), 4 / 5);
});
