// Equivalent commercial token pricing.
//
// zad runs only free-tier models, so "cost" here is hypothetical: what
// the same token volume would cost on a comparable *paid* API. It powers the
// "estimated savings" figure — money avoided by routing to free providers.
//
// priceFor() prefers LiteLLM's real per-model rate (see litellm-pricing.ts);
// the tiers below are the conservative fallback for models LiteLLM doesn't list.

import { rateFor } from './litellm-pricing.js';

export interface TokenPrice {
  input: number;  // USD per 1M input tokens
  output: number; // USD per 1M output tokens
}

const FRONTIER: TokenPrice = { input: 5, output: 15 };   // Opus / GPT-5 / Gemini Pro class
const STRONG: TokenPrice = { input: 1, output: 3 };      // Sonnet / GPT-4o / large open models
const MID: TokenPrice = { input: 0.5, output: 1.5 };     // ~70B / coder / mid-tier
const SMALL: TokenPrice = { input: 0.1, output: 0.4 };   // 8B / mini / lite / nano

/**
 * Pick an equivalent-quality commercial price tier for a model, by family.
 * Ordered most-specific → general; first match wins. Defaults to MID so the
 * savings estimate stays grounded rather than over-stated.
 */
/**
 * Coarse fallback tier for a model LiteLLM doesn't list. Family heuristic over
 * the normalized id; conservative so the savings estimate stays grounded.
 */
export function heuristicPriceFor(modelId: string): TokenPrice {
  const id = modelId.toLowerCase();

  // Frontier reasoning / flagship tier.
  if (/opus|gpt-5|gemini.*pro|pro-preview|deepseek-v4|m2\.7|675b/.test(id)) return FRONTIER;

  // Small / cheap tier (checked before mid so e.g. "gpt-4o-mini" lands here).
  if (/haiku|-mini|mini$|flash-lite|lite-preview|[-/]8b|3\.1-8b|8b-instant|[-/]9b|1\.2b|qwen3-4b|ministral|nano|lfm|liquid|small/.test(id)) return SMALL;

  // Mid tier (~70B, coders, flash-class, gemma).
  if (/scout|oss-20b|[-/]20b|qwen3?-?32b|32b|codestral|devstral|gemma|glm.*flash|nemotron.*nano|llama-?3\.?[13]-70b|3\.3-70b|flash(?!.*pro)/.test(id)) return MID;

  // Everything else is treated as a strong general model.
  return STRONG;
}

/**
 * Equivalent commercial price for a model. Prefers LiteLLM's real per-model
 * rate; falls back to the family heuristic when the model isn't listed (or the
 * pricing table hasn't loaded yet).
 */
export function priceFor(_platform: string, modelId: string): TokenPrice {
  const real = rateFor(modelId);
  if (real) return { input: real.input, output: real.output };
  return heuristicPriceFor(modelId);
}

/** Hypothetical paid cost (USD) for a given input/output token split. */
export function estimateCostUsd(platform: string, modelId: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(platform, modelId);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
