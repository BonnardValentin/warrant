# warrant

Most of the effort in making an AI agent useful isn't getting it to *do*
something. It's knowing whether what it did was actually right, without a person
checking every step.

warrant is a small library for that. An agent produces a result; warrant runs an
independent check and hands back a **witness** — a concrete, inspectable record
of what was verified and what held. If the witness says the work passed, you have
a reason to trust it. If it didn't, the same witness tells the agent exactly what
broke, and it tries again.

Do, check, get told why, retry. That loop is the whole idea. The part that makes
it work is that the checker is kept honest: whoever writes the success criteria
never sees the agent's answer, so the agent can't quietly tune its output to slip
past its own test.

## Why this exists

The goal is agents that can improve themselves. The moment "the agent acted" can
be turned into "the agent succeeded" — automatically, and in a way you can
actually trust — that judgment stops being a human reading output or an eval run
long after the fact. It becomes a signal a system can learn from while the work
is still happening.

warrant deliberately stops short of being a framework. It doesn't decide how your
agent thinks or which model it calls. It owns one question: *did this pass, and
how sure are we?* You bring the verifier for your domain; warrant runs the loop
around it.

## See it

You'll need Node 22.6+ (it runs the TypeScript directly, no build step):

```
node examples/dedupe/run.ts
```

The example asks for a humble function: remove duplicates from a list, keep the
order things first appeared. Watch what happens:

- it writes the success criteria from the task alone,
- it throws a deliberately-broken stand-in at those criteria first, to prove they
  actually bite,
- it rejects the first real attempt (which scrambles the order) and says exactly
  why,
- it accepts the second, and tells you how strong that acceptance is.

That last part matters. A passing test and a language model's opinion are not the
same kind of evidence, and warrant never lets the weaker one dress up as the
stronger. Every accept carries an assurance level: *proven*, *tested*, or merely
*judged*.

## What's inside

```
packages/core/       the loop and the witness model. zero dependencies.
packages/verify-js/  a verifier that runs code against property tests in a sandbox.
examples/dedupe/     the run above.
PLAN.md              the full design, with the reasoning behind every decision.
```

If you want to know how it really works — how evidence is modeled, how acceptance
composes, how a flaky or dishonest checker gets caught — read `PLAN.md`. It's
written to be read, not skimmed.

## Where it is

This is an early cut (M0): the spine works, one real verifier exists, the loop
closes end to end. The surface will still move. From here the plan is to prove the
core survives a second, very different kind of task; plug in a real model as the
agent; add an adversarial critic whose only job is to find the gaps in the success
criteria; then package it for others to use.

Built in the open. Issues and ideas welcome.
