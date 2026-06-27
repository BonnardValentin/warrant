// The Vercel AI SDK adapter — ONE way to provide a `Complete`, not the only way.
// Provider-NEUTRAL: it depends on `ai` but NOT on any specific provider. You pass
// the model, built with whatever provider you installed — anthropic("…"),
// openai("…"), a local model, etc. Import from `@warrant/agents/complete` instead
// for the role builders with zero SDK dependency and your own backend.

import type { LanguageModel } from "ai";
import { generateText } from "ai";
import { type Complete, makeCritic, makeSolver, makeSpecAuthor } from "./complete.ts";

export type { CodeTask } from "./complete.ts";

/** Build a `Complete` from any Vercel AI SDK model (you bring the provider). */
export function aiComplete(model: LanguageModel): Complete {
  return async ({ system, prompt }) => (await generateText({ model, system, prompt })).text;
}

export const aiSpecAuthor = (model: LanguageModel) => makeSpecAuthor(aiComplete(model));
export const aiSolver = (model: LanguageModel) => makeSolver(aiComplete(model));
export const aiCritic = (model: LanguageModel) => makeCritic(aiComplete(model));
