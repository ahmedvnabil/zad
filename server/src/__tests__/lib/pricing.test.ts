import { describe, it, expect } from 'vitest';
import { priceFor, estimateCostUsd } from '../../lib/pricing.js';

describe('equivalent paid pricing', () => {
  it('tiers models by family', () => {
    expect(priceFor('meridian', 'claude-opus-4-7').input).toBe(5);        // frontier
    expect(priceFor('google', 'gemini-3.1-pro-preview').input).toBe(5);   // frontier
    expect(priceFor('meridian', 'claude-sonnet-4-6').input).toBe(1);      // strong
    expect(priceFor('groq', 'llama-3.3-70b-versatile').input).toBe(0.5);  // mid
    expect(priceFor('groq', 'llama-3.1-8b-instant').input).toBe(0.1);     // small
    expect(priceFor('cliproxyapi', 'openai-gpt-4o-mini').input).toBe(0.1);// small (mini)
  });

  it('frontier models are priced above small models', () => {
    expect(priceFor('x', 'claude-opus-4-7').output).toBeGreaterThan(priceFor('x', 'llama-3.1-8b-instant').output);
  });

  it('estimates cost from a token split', () => {
    // 1M input + 1M output on a strong model ($1 in / $3 out) = $4.
    expect(estimateCostUsd('x', 'mistral-large-latest', 1_000_000, 1_000_000)).toBeCloseTo(4, 5);
    expect(estimateCostUsd('x', 'anything', 0, 0)).toBe(0);
  });
});
