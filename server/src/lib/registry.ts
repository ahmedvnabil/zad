// زاد — Registry: a thin layer over models.dev (the catalog opencode uses).
// Exposes 140 providers / ~5,140 models for one-click "discover & add".
// Cache: in-memory + disk; refreshed periodically and on-demand.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, '../../data/registry.json');
const SOURCE_URL = process.env.REGISTRY_URL || 'https://models.dev/api.json';
const REFRESH_MS = Number(process.env.REGISTRY_REFRESH_MS || 6 * 60 * 60 * 1000); // 6 h

// ---------- types (mirror of models.dev schema) ----------

export interface RegistryModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  attachment?: boolean; // vision
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: { input?: string[]; output?: string[] };
  open_weights?: boolean;
}

export interface RegistryProvider {
  id: string;
  name: string;
  env?: string[];
  npm?: string;
  api?: string | null;
  doc?: string;
  models: Record<string, RegistryModel>;
}

export type RegistryDoc = Record<string, RegistryProvider>;

// ---------- cache ----------

let cache: RegistryDoc | null = null;
let cachedAt = 0;
let inFlight: Promise<RegistryDoc> | null = null;

async function loadDiskCache(): Promise<RegistryDoc | null> {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf-8');
    const stat = await fs.stat(CACHE_PATH);
    cachedAt = stat.mtimeMs;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveDiskCache(doc: RegistryDoc): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(doc), 'utf-8');
}

async function fetchRemote(): Promise<RegistryDoc> {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`registry: HTTP ${res.status} from ${SOURCE_URL}`);
  const doc = (await res.json()) as RegistryDoc;
  if (typeof doc !== 'object' || doc === null) throw new Error('registry: invalid JSON');
  return doc;
}

/**
 * Returns the registry, using the in-memory cache when fresh,
 * the disk cache when warm, and falling back to a network fetch
 * (with disk write) when cold or stale.
 */
export async function getRegistry(opts: { force?: boolean } = {}): Promise<RegistryDoc> {
  const now = Date.now();
  if (!opts.force && cache && now - cachedAt < REFRESH_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (!opts.force) {
        const disk = await loadDiskCache();
        if (disk && now - cachedAt < REFRESH_MS) {
          cache = disk;
          return disk;
        }
      }
      const remote = await fetchRemote();
      cache = remote;
      cachedAt = Date.now();
      // best-effort persist; don't block on failure
      saveDiskCache(remote).catch(() => {});
      return remote;
    } catch (e) {
      // fall back to whatever we have on disk if remote fails
      if (!cache) {
        const disk = await loadDiskCache();
        if (disk) { cache = disk; return disk; }
      }
      if (cache) return cache;
      throw e;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// ---------- query helpers ----------

export interface ProviderSummary {
  id: string;
  name: string;
  model_count: number;
  has_api: boolean;       // has a base URL we can hit directly (OpenAI-compatible)
  is_openai_compat: boolean;
  env: string[];
  doc?: string;
  api?: string | null;
}

export async function listProviders(q?: string): Promise<ProviderSummary[]> {
  const reg = await getRegistry();
  const query = (q || '').toLowerCase().trim();
  const all: ProviderSummary[] = Object.values(reg).map((p) => ({
    id: p.id,
    name: p.name,
    model_count: Object.keys(p.models || {}).length,
    has_api: Boolean(p.api),
    is_openai_compat: p.npm === '@ai-sdk/openai-compatible' || Boolean(p.api),
    env: p.env || [],
    doc: p.doc,
    api: p.api ?? null,
  }));
  if (!query) return all.sort((a, b) => b.model_count - a.model_count);
  return all
    .filter((p) => p.id.toLowerCase().includes(query) || p.name.toLowerCase().includes(query))
    .sort((a, b) => b.model_count - a.model_count);
}

export async function getProvider(id: string): Promise<RegistryProvider | null> {
  const reg = await getRegistry();
  return reg[id] || null;
}

export interface CacheStats {
  providers: number;
  models: number;
  cached_at: number | null;
  age_seconds: number | null;
  source_url: string;
  refresh_ms: number;
}

export async function stats(): Promise<CacheStats> {
  const reg = await getRegistry();
  const models = Object.values(reg).reduce((n, p) => n + Object.keys(p.models || {}).length, 0);
  return {
    providers: Object.keys(reg).length,
    models,
    cached_at: cachedAt || null,
    age_seconds: cachedAt ? Math.round((Date.now() - cachedAt) / 1000) : null,
    source_url: SOURCE_URL,
    refresh_ms: REFRESH_MS,
  };
}

// ---------- ranking heuristic (for "auto" model selection later) ----------

/**
 * A coarse 1-15 intelligence rank from a registry model — used when
 * importing into the local catalog so the "auto" router has a sane order.
 * Higher cost ≈ smarter (a rough but useful proxy); reasoning + vision bump it.
 */
export function inferIntelligenceRank(m: RegistryModel): number {
  const out = m.cost?.output ?? 0;
  let base = 12;
  if (out >= 60) base = 1;           // GPT-5/Opus-class
  else if (out >= 20) base = 2;
  else if (out >= 10) base = 3;
  else if (out >= 5) base = 4;
  else if (out >= 2) base = 6;
  else if (out >= 1) base = 8;
  else if (out > 0) base = 10;
  if (m.reasoning) base = Math.max(1, base - 1);
  if (m.attachment) base = Math.max(1, base - 1);
  if (m.cost?.output === 0) base = 12; // free-tier defaults to mid-low
  return Math.min(15, Math.max(1, base));
}

export function inferSpeedRank(m: RegistryModel): number {
  // smaller context window = usually a smaller, faster model
  const ctx = m.limit?.context ?? 0;
  if (ctx <= 8192) return 1;
  if (ctx <= 32_768) return 3;
  if (ctx <= 128_000) return 5;
  if (ctx <= 262_144) return 6;
  return 7;
}

export function inferSizeLabel(m: RegistryModel): string {
  const ctx = m.limit?.context;
  if (!ctx) return 'Unknown';
  if (ctx >= 1_000_000) return 'Long Context';
  if (ctx >= 200_000) return 'Large';
  if (ctx >= 100_000) return 'Medium';
  return 'Small';
}
