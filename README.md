# warrant

A small, in-the-loop, **witness-carrying** harness for AI agents. Every action
emits a machine-checkable witness; an independent verifier turns "the agent
acted" into "the agent succeeded" — and the accept/reject becomes the reward
signal. The witness is a versioned JSON wire format, so a Rust runtime and a TS
runtime can share one contract.

> Status: **M0** — the spine + a deterministic JS verifier + a runnable example.
> The full design (4 locked layers, SOTA decisions, milestones) lives in
> [`PLAN.md`](./PLAN.md).

## What's here

```
packages/core/        # the spine: witness model, policy, loop, verifier/sandbox interfaces. zero deps.
packages/verify-js/   # a deterministic verifier: runs impl vs property tests in a sandbox.
examples/dedupe/      # the loop closing on a code task (reject → accept).
PLAN.md               # the design — read this.
```

## Run it (zero install)

Needs Node ≥ 22.6 (runs TypeScript directly via type-stripping):

```sh
node examples/dedupe/run.ts     # or: npm run demo
```

You'll see the contract authored, a negative-control check (a deliberately-wrong
artifact the contract must reject), then attempt 1 rejected with a witness,
attempt 2 accepted — with an **assurance level** on the accept.

## The core in one screen

- **Witness = claims + typed evidence** (`binary | score | proof`); acceptance is
  a **separate policy**, so binary tests, judge panels, and formal proofs all
  compose without touching verifiers.
- **Independence is structural** — `Solver.solve` has no contract parameter, so a
  solver cannot read its own tests.
- **Three-valued verdict** (`accept | reject | inconclusive`) + an **assurance
  level** (`proven > tested > judged`) — a judge can never pose as a proof, and a
  flaky verifier is caught by a replay self-check and quarantined.

## Status / roadmap

M0 (here) → M1 prove the core unchanged on a second, non-code domain → M2 real
Claude solver → M3 freeze the `warrant/v1` JSON schema + a Rust bridge → M4
adversarial critic → M5 package. See [`PLAN.md`](./PLAN.md).
