// The Vercel AI SDK adapter — ONE way to provide a `Complete`, not the only way.
// Provider-agnostic by virtue of the AI SDK (default Anthropic claude-opus-4-8;
// pass any AI SDK model to swap). Import from `@warrant/agents/complete` instead
// if you want the role builders with zero SDK dependency and your own backend.

import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { generateText } from "ai";
import { type Complete, makeCritic, makeSolver, makeSpecAuthor } from "./complete.ts";

export type { CodeTask } from "./complete.ts";

/** Build a `Complete` from any Vercel AI SDK model. */
export function aiComplete(model: LanguageModel = anthropic("claude-opus-4-8")): Complete {
  return async ({ system, prompt }) => (await generateText({ model, system, prompt })).text;
}

export const aiSpecAuthor = (model?: LanguageModel) => makeSpecAuthor(aiComplete(model));
export const aiSolver = (model?: LanguageModel) => makeSolver(aiComplete(model));
export const aiCritic = (model?: LanguageModel) => makeCritic(aiComplete(model));
