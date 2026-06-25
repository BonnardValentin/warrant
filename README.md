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

Node 22.6+ (it runs the TypeScript directly, no build step):

```
node examples/dedupe/run.ts
```

The example asks for a humble function — remove duplicates from a list, keep the
order things first appeared. You'll watch it write the criteria, reject a
deliberately-broken stand-in to prove those criteria actually bite, reject the
first real attempt and say exactly why, then accept the second and tell you how
strong that acceptance is.

## Inside

| Path                  | What                                                            |
| --------------------- | --------------------------------------------------------------- |
| `packages/core`       | the loop and the witness model. zero dependencies.              |
| `packages/verify-js`  | a verifier that runs code against property tests in a sandbox.  |
| `examples/dedupe`     | the run above.                                                  |
| `PLAN.md`             | the full design, with the reasoning behind every decision.      |

If you want to know how it really works — how evidence is modelled, how
acceptance composes, how a dishonest checker gets caught — read
[`PLAN.md`](./PLAN.md). It's written to be read, not skimmed.

## Status

An early cut (M0): the spine works, one real verifier exists, the loop closes end
to end. The surface will still move. Next is proving the core survives a second,
very different kind of task; then a real model as the agent; then an adversarial
critic whose only job is to find the gaps in the success criteria.

<div align="center">
<sub>Built in the open. Issues and ideas welcome.</sub>
</div>
