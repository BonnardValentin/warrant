import assert from "node:assert/strict";
import { test } from "node:test";
import { type Feedback, runLoop, type Solver, type SpecAuthor } from "../src/index.ts";
import type { Verifier } from "../src/verifier.ts";
import type { Witness } from "../src/witness.ts";

type Task = { id: string };

const passW = (): Witness => ({
  schema: "warrant/v1",
  claims: [{ id: "ok", severity: "required", evidence: { kind: "binary", ok: true } }],
});
const failW = (): Witness => ({
  schema: "warrant/v1",
  claims: [
    { id: "ok", severity: "required", evidence: { kind: "binary", ok: false, detail: "nope" } },
  ],
});
const loadErrW = (): Witness => ({ schema: "warrant/v1", loadError: "did not run", claims: [] });

const author: SpecAuthor<Task, null> = {
  async author() {
    return null;
  },
};

function fakeVerifier(
  map: (artifact: string) => Witness,
  cls: "deterministic" | "stochastic" | "proof" = "deterministic",
): Verifier<string, null> {
  return { cls, verify: (a) => Promise.resolve(map(a)) };
}

function solverFrom(attempts: string[], seen?: (Feedback | undefined)[]): Solver<Task, string> {
  return {
    async solve(_t, i, fb) {
      seen?.push(fb);
      return attempts[Math.min(i, attempts.length - 1)] ?? "";
    },
  };
}

test("accept on the first attempt", async () => {
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: solverFrom(["a"]),
    verifier: fakeVerifier(() => passW()),
  });
  assert.equal(r.status, "accepted");
  assert.equal(r.attempts, 1);
});

test("reject → retry → accept, and the solver gets the failure as feedback", async () => {
  const seen: (Feedback | undefined)[] = [];
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: solverFrom(["bad", "good"], seen),
    verifier: fakeVerifier((a) => (a === "good" ? passW() : failW())),
  });
  assert.equal(r.status, "accepted");
  assert.equal(r.attempts, 2);
  assert.equal(seen[0], undefined); // first attempt: no feedback
  assert.equal(seen[1]?.failed[0]?.id, "ok"); // second attempt told what failed
});

test("a contract that accepts a negative control → bad-contract", async () => {
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: solverFrom(["a"]),
    verifier: fakeVerifier(() => passW()), // passes everything, so it passes the control too
    negativeControls: ["garbage"],
  });
  assert.equal(r.status, "bad-contract");
});

test("a rejected negative control lets the loop proceed", async () => {
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: solverFrom(["good"]),
    verifier: fakeVerifier((a) => (a === "control" ? failW() : passW())),
    negativeControls: ["control"],
  });
  assert.equal(r.status, "accepted");
});

test("an artifact that didn't run (loadError) retries instead of terminating", async () => {
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: solverFrom(["x", "y"]),
    verifier: fakeVerifier((a) => (a === "y" ? passW() : loadErrW())),
  });
  assert.equal(r.status, "accepted");
  assert.equal(r.attempts, 2);
});

test("stall after K identical failing attempts", async () => {
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: solverFrom(["a"]),
    verifier: fakeVerifier(() => failW()),
    maxAttempts: 10,
    stallK: 2,
  });
  assert.equal(r.status, "stalled");
  assert.equal(r.attempts, 3); // attempt1 sets baseline, 2 → stall1, 3 → stall2 → stop
});

test("a nondeterministic deterministic-class verifier is quarantined → inconclusive", async () => {
  let calls = 0;
  const flaky: Verifier<string, null> = {
    cls: "deterministic",
    verify: () => {
      calls += 1;
      return Promise.resolve(calls % 2 === 1 ? passW() : failW()); // differs across the replay double-run
    },
  };
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: solverFrom(["a"]),
    verifier: flaky,
  });
  assert.equal(r.status, "inconclusive");
});

test("rejected-exhausted keeps the last artifact", async () => {
  const r = await runLoop<Task, null, string>({
    task: { id: "t" },
    specAuthor: author,
    solver: {
      async solve(_t, i) {
        return `art${i}`;
      },
    }, // distinct each time
    verifier: fakeVerifier(() => failW()),
    maxAttempts: 3,
    stallK: 5,
  });
  assert.equal(r.status, "rejected-exhausted");
  assert.equal(r.artifact, "art2");
});

// --- agnosticism: the core assumes nothing about the domain types ---

test("the loop is generic over non-string Task / Contract / Artifact types", async () => {
  type NumTask = { target: number };
  type NumContract = { min: number };
  type NumArtifact = { value: number };
  const r = await runLoop<NumTask, NumContract, NumArtifact>({
    task: { target: 42 },
    specAuthor: {
      async author(t) {
        return { min: t.target };
      },
    },
    solver: {
      async solve() {
        return { value: 50 };
      },
    },
    verifier: {
      cls: "deterministic",
      verify: (a, c) =>
        Promise.resolve({
          schema: "warrant/v1",
          claims: [
            {
              id: "meets_min",
              severity: "required",
              evidence: { kind: "binary", ok: a.value >= c.min },
            },
          ],
        }),
    },
  });
  assert.equal(r.status, "accepted");
  assert.deepEqual(r.artifact, { value: 50 });
});

// --- critic (M3) ---

// a verifier whose verdict depends on BOTH the artifact and the contract
function byContract(
  pass: (artifact: string, contract: string) => boolean,
): Verifier<string, string> {
  return {
    cls: "deterministic",
    verify: (a, c) => Promise.resolve(pass(a, c) ? passW() : failW()),
  };
}
const weakAuthor: SpecAuthor<Task, string> = {
  async author() {
    return "weak";
  },
};

test("critic strengthens the contract, breaks a too-weak accept, and the loop recovers", async () => {
  const r = await runLoop<Task, string, string>({
    task: { id: "t" },
    specAuthor: weakAuthor,
    solver: solverFrom(["ok", "great"]), // "ok" passes weak but not strong; "great" passes both
    verifier: byContract((a, c) => (c === "strong" ? a === "great" : a === "ok" || a === "great")),
    critic: {
      async propose(_t, c) {
        return c === "weak" ? "strong" : null;
      },
    },
  });
  assert.equal(r.status, "accepted");
  assert.equal(r.attempts, 2); // attempt1's weak accept is broken by the critic; attempt2 passes strong
});

test("a critic that finds no gap lets the accept stand on the first attempt", async () => {
  const r = await runLoop<Task, string, string>({
    task: { id: "t" },
    specAuthor: weakAuthor,
    solver: solverFrom(["great"]),
    verifier: byContract(() => true),
    critic: {
      async propose() {
        return null;
      },
    },
  });
  assert.equal(r.status, "accepted");
  assert.equal(r.attempts, 1);
});

test("a throwing critic does not turn a real accept into a non-accept", async () => {
  const r = await runLoop<Task, string, string>({
    task: { id: "t" },
    specAuthor: weakAuthor,
    solver: solverFrom(["great"]),
    verifier: byContract(() => true),
    critic: {
      async propose() {
        throw new Error("critic boom");
      },
    },
  });
  assert.equal(r.status, "accepted");
  assert.equal(r.attempts, 1);
});
