# @warrant/agents

Model-backed roles (`SpecAuthor`, `Solver`, `Critic`) for
[warrant](https://github.com/BonnardValentin/warrant)'s code domain — **backend
agnostic.** The generic builders take ONE primitive, so any backend works: any LLM
SDK, a local model, a raw `fetch`, a stub, or a human.

```ts
// Zero-dependency: bring your own backend.
import { makeSolver, makeSpecAuthor, makeCritic, type Complete } from "@warrant/agents/complete";
const complete: Complete = async ({ system, prompt }) => myBackend(system, prompt);
const solver = makeSolver(complete);
```

```ts
// Or the Vercel AI SDK adapter (provider-agnostic; default claude-opus-4-8).
import { aiSolver, aiSpecAuthor, aiCritic } from "@warrant/agents/ai-sdk";
```

Importing `@warrant/agents/complete` pulls **no** SDK; the AI SDK lives only behind
`@warrant/agents/ai-sdk`.
