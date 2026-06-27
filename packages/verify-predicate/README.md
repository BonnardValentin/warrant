# @warrant/verify-predicate

A [warrant](https://github.com/BonnardValentin/warrant) `Verifier` for a plain
**data value** (the artifact): it runs named predicates **in-process** (no
sandbox) and returns a witness. Predicates can be binary (throw to fail) or scored
(return 0–1), so it exercises both hard constraints and soft quality.

```ts
import { PredicateVerifier, type Predicate } from "@warrant/verify-predicate";

const contract: Predicate<Plan>[] = [
  { id: "seven_days", check: (p) => assert(p.days.length === 7, "need 7 days") },
  { id: "lightness", kind: "score", score: (p) => light(p) / 7 },
];
const verifier = new PredicateVerifier<Plan>();
```

Same `Verifier` interface as `@warrant/verify-fn` — proof the core loop is
domain-agnostic.
