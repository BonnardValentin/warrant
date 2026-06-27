<div align="center">

# warrant

### A witness-carrying verification loop for AI agents

Turn *“the agent acted”* into *“the agent succeeded”* — automatically, and with evidence.

</div>

---

Most of the effort in making an AI agent useful isn't getting it to *do*
something. It's knowing whether what it did was actually right, without a person
checking every step.

warrant is a small library for that. An agent produces a result; warrant runs an
independent check and hands back a **witness** — a concrete, inspectable record
of what was verified and what held. If the witness says the work passed, you have
a reason to trust it. If it didn't, the same witness tells the agent exactly what
broke, and it tries again.

The part that makes it work: the checker is kept honest. Whoever writes the
success criteria never sees the agent's answer, so the agent can't quietly tune
its output to slip past its own test.

## How it works

```
   ┌────────┐     ┌──────────┐     ┌────────┐     ┌─────────┐     ┌────────┐
   │ solver │ ──▶ │ artifact │ ──▶ │ verify │ ──▶ │ witness │ ──▶ │ accept │
   └────────┘     └──────────┘     └───┬────┘     └─────────┘     └────────┘
        ▲                              │
        │                         ┌────┴─────┐
        │                         │ contract │   (written without seeing the artifact)
        │                         └──────────┘
        └─ on reject, the witness says exactly what failed — the solver retries.
```

Author the success criteria once. Solve, verify, and on a reject the witness
feeds back the exact claims that failed — including which ones *newly* broke, so
the agent stops oscillating between fixes. Repeat until it passes, gives up, or
stalls.

## The end goal

Agents that improve themselves. The moment *“the agent acted”* can be turned into
*“the agent succeeded”* — automatically, and in a way you can actually trust —
that judgment stops being a human reading output or an eval run long after the
fact. It becomes a signal a system can learn from while the work is still
happening.

warrant deliberately stops short of being a framework. It doesn't decide how your
agent thinks or which model it calls. It owns one question: *did this pass, and
how sure are we?* You bring the verifier for your domain; warrant runs the loop
around it.

## Not all evidence is equal

A passing test and a language model's opinion are not the same kind of evidence,
and warrant never lets the weaker one dress up as the stronger. Every accept
carries an assurance level:

| Level      | What backs it                                                         |
| ---------- | --------------------------------------------------------------------- |
| `proven`   | a re-checkable proof — the verifier re-checks it rather than re-runs   |
| `tested`   | passed an independent suite of property tests                          |
| `judged`   | a model's assessment — the weakest evidence, and labelled as such      |

A flaky checker can't hide either: anything claiming to be deterministic is run
twice and quarantined if it disagrees with itself.

## Try it

Node 22.6+ (it runs the TypeScript directly, no build step). The first two need
no install:

```
node examples/dedupe/run.ts      # verify code   (subprocess, property tests)
node examples/meal-plan/run.ts   # verify data   (in-process, with a scored constraint)
```

The first asks for a humble function — remove duplicates from a list, keep the
order things first appeared. The second asks for a week of dinners under a calorie
cap with no repeated main. They look nothing alike — one verifies *code* in a
subprocess, the other verifies a plain *data* object in-process with a soft
"prefer light dinners" score — yet both run through the **identical** loop, with
no changes to `packages/core`. In each you'll watch it write the criteria, reject
a deliberately-broken stand-in to prove those criteria bite, reject the first real
attempt and say exactly why, then accept the second with an assurance level.

To solve with a real model instead of scripted attempts (`npm install` first, set
a key):

```
ANTHROPIC_API_KEY=… node examples/dedupe-ai/run.ts
```

The model writes the property tests *and* the implementation as two independent
calls — it never sees its own tests. A third independent role, an **adversarial
critic**, then tries to strengthen the contract after the accept: the solution
has to survive new properties it never trained against, or the loop reopens. All
built on the Vercel AI SDK, so it's provider-agnostic: the default is
`claude-opus-4-8`, but pass any AI SDK model to swap providers in one line.

## Inside

| Path                       | What                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `packages/core`            | the loop and the witness model. zero dependencies.                |
| `packages/verify-fn`       | verify a function: runs it against property tests in a sandbox.    |
| `packages/verify-predicate`| verify a data value: runs named predicates in-process.            |
| `packages/solver-ai`       | model-backed spec-author, solver & adversarial critic (Vercel AI SDK).|
| `examples/dedupe`          | the code run above (scripted).                                    |
| `examples/meal-plan`       | the data run above (scripted).                                    |
| `examples/dedupe-ai`       | the code run, solved by a real model.                             |
| `PLAN.md`                  | the full design, with the reasoning behind every decision.        |

If you want to know how it really works — how evidence is modelled, how
acceptance composes, how a dishonest checker gets caught — read
[`PLAN.md`](./PLAN.md). It's written to be read, not skimmed.

## Status

Early, but past its first real tests. The loop closes end to end (M0); the core
ran a second, structurally different domain — data instead of code, in-process
instead of sandboxed, with a scored constraint — with **zero changes** to
`packages/core` (M1); a real model drives the loop through a provider-agnostic
solver (M2); and an adversarial critic strengthens the contract after each accept,
so a solution has to survive properties it never trained against (M3). Backed by
strict type-checking, a `node:test` suite, and CI. The role layer is
backend-agnostic — `@warrant/agents/complete` needs no SDK; bring any LLM, a local
model, a raw fetch, a stub, or a human (M4). Packages build to dual ESM + `.d.ts`
via tsdown with a real `@warrant/*` dependency graph; the publish flip (drop
`private`, add publint/attw) is the only thing left.

<div align="center">
<sub>Built in the open. Issues and ideas welcome.</sub>
</div>
