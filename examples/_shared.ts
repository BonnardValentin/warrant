// Shared console reporting for the examples. Not part of the library — it just
// keeps the three demos from copy-pasting the same printers.

import type { Event, Witness } from "../packages/core/src/index.ts";

export function badge(verdict: string): string {
  return verdict === "accept"
    ? "✓ ACCEPT"
    : verdict === "inconclusive"
      ? "? INCONCLUSIVE"
      : "✗ REJECT";
}

// The only per-example variation is two log strings, so parameterize those.
export type Labels = { authored?: string; solving?: string };

export function makePrinter(labels: Labels = {}): (e: Event) => void {
  const authored = labels.authored ?? "contract authored (spec sees only the task)";
  const solving = labels.solving ?? "solving (sees only task + prior witness)…";
  return (e: Event): void => {
    switch (e.t) {
      case "spec.authored":
        console.log(`· ${authored}\n`);
        break;
      case "negative-control":
        console.log(
          `· negative control #${e.index}: ${e.rejected ? "✓ rejected (good contract)" : "✗ ACCEPTED — bad contract!"}\n`,
        );
        break;
      case "attempt.start":
        console.log(`· attempt ${e.n}: ${solving}`);
        break;
      case "attempt.verdict":
        console.log(
          `  verdict: ${badge(e.decision.verdict)}  [assurance: ${e.decision.assurance}]  — ${e.decision.rationale}`,
        );
        break;
      case "loop.done":
        console.log(`\n══ ${e.status} ══`);
        break;
    }
  };
}

// Pick the i-th item, clamped to the last (for scripted attempt lists). Typed to
// return T (not T | undefined) so call sites stay clean under strict indexing.
export function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[Math.min(Math.max(i, 0), arr.length - 1)];
  if (v === undefined) throw new Error("nth: empty array");
  return v;
}

export function printWitness(w: Witness): void {
  console.log("\nfinal witness:");
  for (const c of w.claims) {
    const e = c.evidence;
    const mark = e.kind === "binary" ? (e.ok ? "✓" : "✗") : "·";
    const note =
      e.kind === "binary" && e.detail
        ? `  — ${e.detail}`
        : e.kind === "score"
          ? `  (${e.value.toFixed(2)})`
          : "";
    console.log(`  ${mark} ${c.id}${note}`);
  }
}
