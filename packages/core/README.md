# @warrant/core

The spine of [warrant](https://github.com/BonnardValentin/warrant): the
verification loop, the witness model, and the role/verifier interfaces. **Zero
dependencies.**

`runLoop` is generic over your `Task` / `Contract` / `Artifact` types — it assumes
nothing about your domain. You bring a `Verifier` (and a `Solver` + `SpecAuthor`,
optionally a `Critic`); it runs author → solve → verify → critic-hardened accept
and returns a `Witness` with a three-valued verdict (`accept` / `reject` /
`inconclusive`) and an assurance level (`proven` / `tested` / `judged`).

```ts
import { runLoop, standard } from "@warrant/core";

const result = await runLoop({ task, specAuthor, solver, verifier });
if (result.status === "accepted") { /* result.decision.assurance */ }
```

See the [main README](../../README.md) and [PLAN.md](../../PLAN.md) for the design.
