// examples/meal-plan — M1: the SAME core loop, a totally different domain.
// The artifact is plain DATA (a weekly plan object), the verifier runs IN-PROCESS
// against named predicates, and one constraint is a SCORED (soft) claim. Nothing
// in packages/core changed to support this — that's the proof the loop generalizes.
//
//   node examples/meal-plan/run.ts

import {
  type Event,
  runLoop,
  type Solver,
  type SpecAuthor,
} from "../../packages/core/src/index.ts";
import { type Predicate, PredicateVerifier } from "../../packages/verify-predicate/src/index.ts";

type Day = { day: string; main: string; calories: number };
type Plan = { days: Day[] };
type Task = { name: string; description: string };

const DAYS = 7;
const CAP = 700; // hard per-dinner calorie cap
const LIGHT = 600; // a dinner is "light" under this

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const task: Task = {
  name: "meal-plan",
  description:
    "A 7-day dinner plan: each dinner ≤700 cal, no repeated main, and prefer light dinners.",
};

// SpecAuthor — written from the task alone, returns predicates over the data.
const specAuthor: SpecAuthor<Task, Predicate<Plan>[]> = {
  async author() {
    return [
      {
        id: "shape",
        check: (p) => {
          assert(Array.isArray(p?.days), "plan must have a days array");
          for (const d of p.days)
            assert(
              typeof d.main === "string" && typeof d.calories === "number",
              `each day needs a string main and numeric calories: ${JSON.stringify(d)}`,
            );
        },
      },
      {
        id: "seven_days",
        check: (p) => assert(p.days.length === DAYS, `need ${DAYS} days, got ${p.days.length}`),
      },
      {
        id: "calorie_cap",
        check: (p) => {
          for (const d of p.days)
            assert(d.calories <= CAP, `${d.day} is ${d.calories} cal, over the ${CAP} cap`);
        },
      },
      {
        id: "no_repeat_main",
        check: (p) => {
          const seen = new Set<string>();
          for (const d of p.days) {
            assert(!seen.has(d.main), `repeated main: ${d.main}`);
            seen.add(d.main);
          }
        },
      },
      // a SCORED claim: fraction of dinners that are light. Contributes to the
      // budget (θ=0.9) rather than being pass/fail.
      {
        id: "lightness",
        kind: "score",
        score: (p) => p.days.filter((d) => d.calories <= LIGHT).length / DAYS,
      },
    ];
  },
};

const day = (day: string, main: string, calories: number): Day => ({ day, main, calories });

const ATTEMPTS: Plan[] = [
  // attempt 0: repeats a main (Pasta ×2) and blows the cap on Sat (820)
  {
    days: [
      day("Mon", "Stir-fry", 540),
      day("Tue", "Pasta", 560),
      day("Wed", "Curry", 590),
      day("Thu", "Salmon", 480),
      day("Fri", "Pasta", 600),
      day("Sat", "Risotto", 820),
      day("Sun", "Soup", 430),
    ],
  },
  // attempt 1: 7 unique mains, all light
  {
    days: [
      day("Mon", "Stir-fry", 540),
      day("Tue", "Tacos", 560),
      day("Wed", "Curry", 590),
      day("Thu", "Salmon", 480),
      day("Fri", "Pasta", 580),
      day("Sat", "Risotto", 560),
      day("Sun", "Soup", 430),
    ],
  },
];

const solver: Solver<Task, Plan> = {
  async solve(_task, attempt) {
    return ATTEMPTS[Math.min(attempt, ATTEMPTS.length - 1)];
  },
};

// A negative control: an empty plan. A good contract MUST reject it.
const negativeControls: Plan[] = [{ days: [] }];

function badge(v: string): string {
  return v === "accept" ? "✓ ACCEPT" : v === "inconclusive" ? "? INCONCLUSIVE" : "✗ REJECT";
}

function printEvent(e: Event): void {
  switch (e.t) {
    case "spec.authored":
      console.log("· contract authored (spec sees only the task)\n");
      break;
    case "negative-control":
      console.log(
        `· negative control #${e.index}: ${e.rejected ? "✓ rejected (good contract)" : "✗ ACCEPTED — bad contract!"}\n`,
      );
      break;
    case "attempt.start":
      console.log(`· attempt ${e.n}: solving (sees only task + prior witness)…`);
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
}

const result = await runLoop<Task, Predicate<Plan>[], Plan>({
  task,
  specAuthor,
  solver,
  verifier: new PredicateVerifier<Plan>(),
  negativeControls,
  onEvent: printEvent,
});

if (result.status === "accepted") {
  console.log(
    `\nclosed loop in ${result.attempts} attempts — assurance: ${result.decision?.assurance}\n`,
  );
  for (const d of result.artifact?.days ?? [])
    console.log(`    ${d.day}  ${d.main.padEnd(10)} ${d.calories} cal`);
} else {
  console.log(`\nfinal witness:`);
  for (const c of result.witness.claims) {
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
