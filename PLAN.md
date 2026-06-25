# warrant — plan

> Working name: **warrant** ("every action carries its warrant"). Swappable.
> A small, in-the-loop, witness-carrying harness for AI agents. TypeScript.

## Thesis

Most of the 2026 ecosystem is **offline eval** (score a dataset after the fact),
**hosted** (Anthropic Outcomes), or **formal verification of graphs**. The gap:
a plain, embeddable library whose unit of work is `(action, witness)` and whose
job is to **verify witnesses and gate acceptance inside a live loop** — the
accept/reject becoming the reward signal. Independence of the checker is a
structural guarantee, not a convention.

**What it is:** a tiny generic core + pluggable verifiers.
**What it is NOT:** an agent framework, a prompt library, an eval dashboard, or a
hosted service. It sits *under* those.

## Core design (the whole bet)

Generic over three domain types — the core never inspects them:

```
SpecAuthor(task)              -> Contract     (sees ONLY the task)
Solver(task[, prior witness]) -> Artifact      (sees ONLY the task)
Verifier(artifact, contract)  -> Witness        (deterministic; no model)
runLoop: author once -> solve -> verify -> retry-on-reject -> accept
```

### LOCKED — Layer 1 foundations (SOTA trio)

**claims + evidence + policy · structural isolation (critic deferred) · tiered classes.**
These three lock together — one design, not three: evidence-kind (witness) and
verifier-class (runtime) are the same binary/score/proof axis; the wire-format
witness is what makes structural isolation nearly free; composition (quorum,
critic) lives in policy, never in verifiers.

1. **Witness = claims + typed evidence; acceptance = a separate, composable policy.**
   A strict superset of binary / graded / proof-carrying — each is just an
   evidence kind, and they can mix in one witness.

```ts
type Evidence =
  | { kind: "binary"; ok: boolean; detail?: string }
  | { kind: "score";  value: number; of: number; samples?: { n: number; agree: number } }
  | { kind: "proof";  system: "replay" | "lean" | "attestation"; artifact: string; checked: boolean };

type Claim   = { id: string; weight?: number; evidence: Evidence };
type Witness = { schema: "warrant/v1"; loadError?: string; claims: Claim[] };

// acceptance is NOT baked into the witness — it's a swappable object
type Policy  = (claims: Claim[]) => { accepted: boolean; rationale: string };
// combinators: allHardClaimsHold · quorum(m,n) · and(...) · or(...) · weighted(θ)
```

2. **Structural isolation.** SpecAuthor / Solver / Verifier run in separate
   processes/workers, speaking ONLY the serialized Witness. Solver sees
   `task + prior witness` (failed claims + detail), never the contract source.
   Critic role + N-of-M quorum are *designed-for* but deferred to M4.

3. **Tiered verifier classes** — the runtime twin of the evidence kinds:

```ts
interface Verifier {
  readonly cls: "deterministic" | "stochastic" | "proof";
  verify(artifact: unknown, contract: unknown): Promise<Witness>;
}
// deterministic → seeded, replayable, cached
// stochastic    → run N times, attach {n, agree}, confidence policy (judge panel)
// proof         → verify the proof object, mark checked, never re-run
```

**The whole tax of going SOTA:** ~150 lines of core instead of ~40, and the
discipline that **policy never leaks into verifiers**.

4. **Witness is a wire format, not just a TS type** — versioned JSON (`warrant/v1`),
   so a Rust runtime and a TS runtime share one witness contract. This invariant
   is also what buys structural isolation for free.

### LOCKED — Layer 2 verification model

**A · Policy & severity.** Each claim carries a `severity` (`required` | `scored`),
authored by the spec-author; a single generic policy interprets it. Defaults:
`proof`/`binary` → required, `score` → scored (overridable).

```ts
type Severity = "required" | "scored";
type Claim = { id: string; severity: Severity; weight?: number; evidence: Evidence };

const standard = (θ = 0.9): Policy => (claims) => {
  const required = claims.filter(c => c.severity === "required");
  const scored   = claims.filter(c => c.severity === "scored");
  const hardOK   = required.every(passed);                          // every correctness claim holds
  const quorumOK = claims.filter(isStochastic).every(meetsQuorum);  // judges meet agreement
  const budget   = weightedMean(scored.map(scoreOf));               // soft quality
  return { accepted: hardOK && quorumOK && budget >= θ, rationale: /* … */ };
};
```

**B · Feedback shape.** On reject the solver receives the witness *diff* — never
the contract source. The `held`/`regressed` fields kill cross-claim oscillation.

```ts
type Feedback = {
  attempt: number;
  failed:    { id: string; detail: string }[];  // fix these
  held:      string[];                           // do NOT break these
  regressed: string[];                           // newly broke vs. last attempt
  progress:  string;                             // "3/4 required claims hold"
};
```

**C · Stopping & stall-escalation.** Stalls are signal, not just budget.

```
stop when:  accepted ✓ | attempt == max ✗ | STALLED (same failing-claim-set for K attempts)
on stall →  1. raise solver effort / force re-plan   (now)
            2. invoke Critic — contract may be wrong   (M4)
            3. hand to human with full witness          (now)
```

**Mechanical defaults (locked).**
- Deterministic witnesses cached by `sha256(artifact ‖ contract ‖ seed)`; replay
  must reproduce a byte-identical witness (a self-check the harness runs on itself).
- Stochastic default **N=5, quorum 4/5** (agreement ≥ 0.8), overridable per verifier.
- Core supplies the seed to verifiers and records it in the witness → every
  deterministic witness is replayable.

### LOCKED — Layer 3 architecture

**D · Two-layer isolation.** Keep epistemic isolation (role independence) and
security isolation (artifact safety) separate.

- *Role independence:* the three roles run as **separate processes**; the
  orchestrator routes and never hands the contract to the solver process. No
  shared memory ⇒ structurally can't peek.
- *Artifact safety:* a pluggable `Sandbox` runs untrusted model-generated code.

```ts
interface Sandbox {
  run(entry: string, input: unknown, limits: { ms: number; memMb: number; net: false }): Promise<Result>;
}
// now:  SubprocessSandbox (child + rlimits, net disabled)
// SOTA: WasmSandbox (QuickJS/Javy for JS; wasmtime for compiled langs)
```
verify-js never hardcodes the mechanism, so hardening isolation doesn't touch verifiers.

**E · Wire protocol + schema source-of-truth (cross-language keystone).**

- Transport between roles: **JSON-RPC 2.0 over stdio** — methods `author`,
  `solve`, `verify`. Language-agnostic (a role can be a Rust binary). May *also*
  expose verifiers as MCP tools later for reach; not the core transport.
- **`warrant/v1` defined once as JSON Schema**; TS types and Rust `serde` structs
  are **generated** from it (`json-schema-to-typescript` + `schemars`/`typify`).
  One source of truth ⇒ the Rust and TS types cannot drift.

```
warrant.schema.json ──┬──► types.ts    (TS verifiers)
                      └──► witness.rs   (Rust verifiers & reward sink)
```

**F · Execution model: streaming + lifecycle.**

```ts
type Event =
  | { t: "spec.authored"; claims: number }
  | { t: "attempt.start"; n: number }
  | { t: "verify.progress"; claim: string }
  | { t: "attempt.verdict"; n: number; accepted: boolean; witness: Witness }
  | { t: "loop.done"; status: "accepted" | "exhausted" | "stalled" };
```
- Loop emits an event stream (observability / live UIs); still returns `LoopResult`.
- **Solver process persists across attempts** within a run → keeps the model
  client + prompt cache warm (retries don't re-pay a cold cache); killed at loop end.
- **Verifier execution is ephemeral per verify** for deterministic verifiers →
  clean state, which is what makes the replay guarantee hold.

### LOCKED — Layer 4 edge cases

**G · Three-valued verdict + assurance level.** Be honest where evidence is weak.

```ts
type Verdict   = "accept" | "reject" | "inconclusive";       // not just two
type Assurance = "proven" | "tested" | "judged";             // strongest evidence behind the REQUIRED claims
```
- Assurance is always reported; a judge-only accept is labeled `judged` and can
  never masquerade as `proven`/`tested`.
- `inconclusive` fires when a stochastic claim splits (agreement between the
  reject- and accept-thresholds) or a `deterministic` verifier fails its **replay
  self-check** (run twice → differ → quarantine, downgrade to stochastic, flag).
  Inconclusive → escalate (Layer 2·C), never silently accept.
- Determinism is **verified, not trusted** — the replay self-check enforces the class.

**H · Anti-gaming primitives (ship now; Critic at M4 amplifies).**

```ts
type Claim = { id; severity; weight?; evidence; revealed?: boolean };  // revealed:false → held out of feedback
negativeControls: Artifact[];  // contract must REJECT all of these, or the contract itself is rejected
```
- *Held-out claims:* feedback reveals failures from a subset, holds some back.
  Passing revealed but failing held-out = overfitting signal.
- *Negative controls:* at author time, probe the contract with deliberately-wrong
  artifacts (empty / identity / random). A contract that accepts garbage is a bad
  contract — a verifier for the spec-author. Catches vacuous specs; the stall→critic
  path catches contradictory ones.

**I · Multi-step composition — design-for, defer past M5.** A plan-witness is
`composition(step witnesses) + cross-step invariant claims` with a plan-level
policy. No core change needed — a claim may reference multiple artifacts already.

## Architecture (monorepo, plugins)

```
warrant/
  packages/
    core/            # types, runLoop, Witness wire schema. ZERO deps.
    verify-js/       # run impl vs property tests in a sandboxed subprocess
    verify-predicate/# in-process predicate checks over plain data
    verify-judge/    # LLM-as-judge verifier (soft, non-binary) — later
    solver-claude/   # SpecAuthor + Solver via @anthropic-ai/sdk
    bridge-rust/      # (later) read/write the witness wire format from Rust
  examples/
    dedupe/          # code domain  (proves the subprocess verifier)
    meal-plan/       # data domain  (proves the in-process verifier)
```

`core` knows nothing about any of the others. Generality is proven when `core`
runs **both** `verify-js` and `verify-predicate` unchanged.

## Tech stack (with rationale)

| Choice | What | Why |
|---|---|---|
| Language | TypeScript, strict | Where the harness-engineering audience is |
| Runtime (dev) | Node 24 native type-stripping | `node x.ts` runs with zero build step |
| Modules | ESM only | Modern default; clean subpath exports |
| Core deps | **none** | The spine must stay legible and portable |
| Monorepo | pnpm workspaces | Core + plugins + examples, independently versioned |
| Tests | `node:test` built-in | No test-framework dep; dogfood-able |
| Build/publish | tsc (types) + tsdown | Dual-safe ESM packages when we publish |
| Sandbox (verify-js) | child process + timeout now; **WASM/worker isolation later** | Start simple, harden when it's real |
| Model adapter | `@anthropic-ai/sdk`, `claude-opus-4-8`, adaptive thinking, structured outputs | First-class, not curl |

## Milestones

- **M0 — spine + one domain.** `core` + `verify-js` + `examples/dedupe`. The
  dedupe loop closes (reject→accept) on scripted backends. *Done = the demo runs.*
- **M1 — prove generality.** `verify-predicate` + `examples/meal-plan`, run
  through the **identical** `runLoop`. *Done = core unchanged across 2 domains.*
  (If the core bent, the abstraction was wrong — fix it here, before anything else.)
- **M2 — real model.** `solver-claude` (SpecAuthor + Solver). *Done = both
  examples solve with real Claude, key-gated.*
- **M3 — witness wire format + Rust bridge.** Freeze `warrant/v1` JSON schema;
  `bridge-rust` round-trips it. *Done = a Rust-produced witness validates in TS.*
- **M4 — adversarial critic (third role).** An independent agent that hunts for
  a property the SpecAuthor missed and appends it to the Contract. *Done = it
  catches a real gap in the meal-plan contract.* (This is what starts making the
  witness hard to game.)
- **M5 — package + docs.** Publishable `@warrant/*`, README per package, one
  "write your own verifier in 30 lines" guide.

The Rust bridge is M3+: the accept/reject signal is a reward a learning loop can
train on — turning "acted" into a gradient. That's the self-improving verifier
loop, and it's a big part of the reason to build this at all.

## Open decisions (your call)

1. **Name** — `warrant`? (alts: `attest`, `vouch`, `witnessd`). Placeholder for now.
2. **OSS or internal-first** — publish `@warrant/*`, or keep it private as the
   substrate until M3? Affects how much API-surface polish M0–M2 need.
3. **Second domain** — meal-plan (ties to Plato, fully deterministic) vs. SQL
   invariant vs. LLM-judge. I recommend meal-plan for M1 (no key, unlike the code
   domain in shape) and add verify-judge at M4 alongside the critic.

## Where it gets hard (carry forward from proofloop)

- Verification as hard as the task → that's where `verify-judge` and the critic
  earn their keep; binary witnesses won't cover it.
- Gaming the contract → independence helps; the M4 critic is the real defense.
- Composability → single-artifact witnesses are easy; witnesses for multi-step
  plans are the actual prize and aren't in this plan yet (post-M5).

## First step on "go"

M0 only: `packages/core/core.ts`, `packages/verify-js/`, `examples/dedupe/`, and
a runnable demo. ~150 lines. Everything else waits until the dedupe loop closes
and M1 proves the core survives a second domain.
