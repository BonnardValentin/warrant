# @warrant/verify-fn

A [warrant](https://github.com/BonnardValentin/warrant) `Verifier` for a single
**function** (the artifact): it runs the function against independently-authored
property tests in a sandbox and returns a witness. A verifier, not a test suite —
it runs at loop time and the loop gates on its verdict.

```ts
import { FunctionVerifier } from "@warrant/verify-fn";
const verifier = new FunctionVerifier(); // pass a custom Sandbox to harden isolation
```

The contract is JS source defining `properties()`; the artifact is JS source
defining the function under test. Today the sandbox bounds time + memory (a
subprocess); capability isolation (fs/net) is the job of a stronger sandbox.
