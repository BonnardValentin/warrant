import { defineConfig } from "tsdown";

// Build each package to its own dist/ (ESM + .d.ts). @warrant/* and the AI SDK
// stay EXTERNAL so the published packages depend on each other rather than
// inlining — the real dependency graph is preserved.
const neverBundle = [/^@warrant\//, /^node:/, "ai", "@ai-sdk/anthropic"];

const lib = (dir: string, entry: Record<string, string>) =>
  defineConfig({
    entry,
    outDir: `packages/${dir}/dist`,
    format: "esm",
    dts: true,
    clean: true,
    deps: { neverBundle },
  });

export default [
  lib("core", { index: "packages/core/src/index.ts" }),
  lib("verify-fn", { index: "packages/verify-fn/src/index.ts" }),
  lib("verify-predicate", { index: "packages/verify-predicate/src/index.ts" }),
  lib("agents", {
    index: "packages/agents/src/index.ts",
    complete: "packages/agents/src/complete.ts",
    "ai-sdk": "packages/agents/src/ai-sdk.ts",
  }),
];
