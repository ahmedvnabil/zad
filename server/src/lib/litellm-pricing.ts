// Real per-model commercial pricing, mirrored from LiteLLM's public table
// (BerriAI/litellm model_prices_and_context_window.json). This upgrades the
// coarse 4-tier heuristic in pricing.ts to actual vendor prices, so the
// "free vs paid" / savings figures reflect what each model class really costs.
//
// Lookup precedence is handled in pricing.ts: real rate (here) first, then the
// heuristic fallback for models LiteLLM doesn't list.
//
// Source freshness: a normalized snapshot is cached to disk on the first
// successful fetch; each boot fires a non-blocking refresh. If the network is
// down the disk cache (or, failing that, the heuristic) stays in effect.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../data/litellm-pricing.json');
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

export interface Rate {
  input: number;  // USD per 1M input tokens
  output: number; // USD per 1M output tokens
}

interface LiteLlmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

interface CacheFile {
  updatedAt: string;
  entries: number;
  rates: Record<string, Rate>;
}

// normalized model key → rate
let RATES = new Map<string, Rate>();
let meta: { updatedAt: string | null; entries: number; source: 'none' | 'cache' | 'live' } = {
  updatedAt: null,
  entries: 0,
  source: 'none',
};

export function getPricingMeta() {
  return { ...meta, loaded: RATES.size };
}

/**
 * Normalize a model id to a comparison key so Zad ids (which often carry
 * a host prefix or a `:free` suffix) line up with LiteLLM keys for the same
 * underlying model. Lowercase, drop everything before the last '/', strip a
 * trailing date and `:free`/`:latest`-style suffixes.
 */
export function normKey(id: string): string {
  let s = id.toLowerCase().trim();
  const slash = s.lastIndexOf('/');
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/:.*$/, '');          // drop :free, :latest, …
  s = s.replace(/-\d{6,8}$/, '');     // drop trailing date (20250101 / 250101)
  s = s.replace(/-(latest|preview)$/, '');
  return s;
}

/** Round a per-1M rate to 6 decimals to scrub float artifacts (0.1×1M=0.0999…). */
function r6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function buildRates(data: Record<string, LiteLlmEntry>): Map<string, Rate> {
  const m = new Map<string, Rate>();
  for (const [k, v] of Object.entries(data)) {
    if (v?.input_cost_per_token == null || v?.output_cost_per_token == null) continue;
    const nk = normKey(k);
    if (!nk || m.has(nk)) continue; // first entry for a normalized key wins
    m.set(nk, {
      input: r6(v.input_cost_per_token * 1_000_000),
      output: r6(v.output_cost_per_token * 1_000_000),
    });
  }
  return m;
}

/** Real per-model rate, or null if LiteLLM doesn't list it (→ heuristic). */
export function rateFor(modelId: string): Rate | null {
  if (!RATES.size) return null;
  return RATES.get(normKey(modelId)) ?? null;
}

/** Synchronously populate from the on-disk cache (called at boot, before listen). */
export function loadFromCache(): void {
  try {
    if (!existsSync(CACHE_PATH)) return;
    const c = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as CacheFile;
    if (c?.rates) {
      RATES = new Map(Object.entries(c.rates));
      meta = { updatedAt: c.updatedAt ?? null, entries: c.entries ?? RATES.size, source: 'cache' };
    }
  } catch {
    // malformed cache — fall through to heuristic until refresh succeeds
  }
}

/** Fire-and-forget: fetch the live table, rebuild the map, persist to disk. */
export async function refreshRates(timeoutMs = 10_000): Promise<{ entries: number; error?: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let data: Record<string, LiteLlmEntry>;
    try {
      const res = await fetch(LITELLM_URL, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as Record<string, LiteLlmEntry>;
    } finally {
      clearTimeout(timer);
    }

    const m = buildRates(data);
    if (m.size === 0) return { entries: 0, error: 'no priced entries in response' };

    RATES = m;
    const updatedAt = new Date().toISOString();
    meta = { updatedAt, entries: m.size, source: 'live' };

    try {
      mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      const payload: CacheFile = { updatedAt, entries: m.size, rates: Object.fromEntries(m) };
      writeFileSync(CACHE_PATH, JSON.stringify(payload));
    } catch {
      // in-memory map is live even if we can't persist
    }
    return { entries: m.size };
  } catch (e) {
    return { entries: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
