// زاد — /api/registry
// One-click "discover & add" for the 140 providers / 5,140 models in models.dev
// (the registry that powers opencode and many other AI tools).
//
// Endpoints:
//   GET  /api/registry/stats                — provider/model totals + cache age
//   GET  /api/registry/providers?q=...      — list + search (condensed)
//   GET  /api/registry/providers/:id        — full provider info incl. all models
//   POST /api/registry/import/:id           — create custom_provider + seed models (gated by INGEST_TOKEN)
//   POST /api/registry/refresh              — force-refresh disk cache (gated by INGEST_TOKEN)

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { hasProvider, registerOpenAICompat } from '../providers/index.js';
import { assertPublicUrl } from '../lib/demo.js';
import {
  getRegistry,
  getProvider as registryGetProvider,
  listProviders as registryListProviders,
  stats as registryStats,
  inferIntelligenceRank,
  inferSpeedRank,
  inferSizeLabel,
  type RegistryProvider,
  type RegistryModel,
} from '../lib/registry.js';

export const registryRouter = Router();

function authorized(req: Request): boolean {
  const required = process.env.INGEST_TOKEN?.trim();
  if (!required) return true;
  return (req.header('x-ingest-token') ?? '').trim() === required;
}

function platformSlug(id: string): string {
  // models.dev IDs are mostly slug-safe already, but normalize for safety
  return id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

/**
 * Many big providers ARE OpenAI-compatible in practice but the models.dev
 * registry leaves `api: null` (it tracks SDK packages, not REST endpoints).
 * Map their known OpenAI-compatible base URLs so import works one-click.
 * Override per-request with `baseUrlOverride` for anything not listed.
 */
const KNOWN_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
  anthropic: 'https://api.anthropic.com/v1',
  cohere: 'https://api.cohere.com/compatibility/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  'fireworks-ai': 'https://api.fireworks.ai/inference/v1',
  together: 'https://api.together.xyz/v1',
  'together-ai': 'https://api.together.xyz/v1',
  perplexity: 'https://api.perplexity.ai',
  'novita-ai': 'https://api.novita.ai/v3/openai',
  nebius: 'https://api.studio.nebius.com/v1',
  hyperbolic: 'https://api.hyperbolic.xyz/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  'alibaba-cn': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
};

// --- public reads ---

registryRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    res.json(await registryStats());
  } catch (e: any) {
    res.status(503).json({ error: { message: e?.message || 'registry unavailable' } });
  }
});

registryRouter.get('/providers', async (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined) ?? '';
  try {
    const list = await registryListProviders(q);
    res.json(list);
  } catch (e: any) {
    res.status(503).json({ error: { message: e?.message || 'registry unavailable' } });
  }
});

registryRouter.get('/providers/:id', async (req: Request, res: Response) => {
  try {
    const p = await registryGetProvider(req.params.id as string);
    if (!p) return res.status(404).json({ error: { message: 'provider not in registry' } });
    res.json(p);
  } catch (e: any) {
    res.status(503).json({ error: { message: e?.message || 'registry unavailable' } });
  }
});

/**
 * Emit a ready-to-paste snippet for opencode (https://opencode.ai) — that lets
 * opencode talk to this zad instance as a single unified provider. Users paste
 * it into ~/.config/opencode/opencode.json and they get the best of both worlds:
 * opencode's UX + zad's 140-provider fallback routing.
 */
registryRouter.get('/opencode-snippet', (req: Request, res: Response) => {
  // pick the public-ish base URL the client called us on
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3001';
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0];
  const baseURL = `${proto}://${host}/v1`;

  // grab a snapshot of enabled models in this zad so opencode shows them in its picker
  const db = getDb();
  const rows = db.prepare(`
    SELECT platform, model_id, display_name, context_window
    FROM models
    WHERE enabled = 1
    ORDER BY platform, model_id
  `).all() as any[];

  const models: Record<string, any> = {};
  for (const r of rows) {
    const id = `${r.platform}/${r.model_id}`;
    models[id] = {
      name: r.display_name || r.model_id,
      ...(r.context_window ? { limit: { context: r.context_window } } : {}),
    };
  }

  const config = {
    provider: {
      zad: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Zad — Free LLM router',
        options: { baseURL },
        models,
      },
    },
  };

  res.json({
    ok: true,
    baseURL,
    model_count: rows.length,
    instructions: [
      'Get your zad unified key from /api/settings/api-key',
      'Set it as OPENAI_API_KEY before running opencode (any name works; opencode reads it from env)',
      'Paste the `config` object into ~/.config/opencode/opencode.json',
      'Run opencode and pick any zad/* model — fallback and analytics happen on the zad side',
    ],
    config,
  });
});

// --- writes (gated) ---

registryRouter.post('/refresh', async (req: Request, res: Response) => {
  if (!authorized(req)) return res.status(401).json({ error: { message: 'unauthorized' } });
  try {
    await getRegistry({ force: true });
    res.json({ ok: true, ...(await registryStats()) });
  } catch (e: any) {
    res.status(502).json({ error: { message: e?.message || 'fetch failed' } });
  }
});

const importBody = z.object({
  // override the base URL when the registry entry has `api: null`
  baseUrlOverride: z.string().url().optional(),
  // a different local platform slug (when there's a collision with an existing provider)
  platformOverride: z.string().regex(/^[a-z0-9][a-z0-9-]{1,29}$/).optional(),
  // limit which models to seed (omit = all enabled by capability)
  modelIds: z.array(z.string()).optional(),
  // only seed text-chat models (filter out audio/image-only)
  textOnly: z.boolean().default(true),
});

/**
 * Import a provider from the registry into zad's catalog.
 * Creates a custom_providers row, registers it live, then upserts each model.
 */
registryRouter.post('/import/:id', async (req: Request, res: Response) => {
  if (!authorized(req)) return res.status(401).json({ error: { message: 'unauthorized' } });

  const parsed = importBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
  }
  const { baseUrlOverride, platformOverride, modelIds, textOnly } = parsed.data;

  let provider: RegistryProvider | null;
  try {
    provider = await registryGetProvider(req.params.id as string);
  } catch (e: any) {
    return res.status(503).json({ error: { message: e?.message || 'registry unavailable' } });
  }
  if (!provider) return res.status(404).json({ error: { message: 'provider not in registry' } });

  const baseUrl = (baseUrlOverride || provider.api || KNOWN_BASE_URLS[provider.id] || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return res.status(400).json({
      error: {
        message: `provider "${provider.id}" has no public API URL — pass baseUrlOverride`,
        code: 'NO_BASE_URL',
      },
    });
  }

  // SSRF guard (same one we use for /api/providers)
  try {
    assertPublicUrl(baseUrl);
  } catch (e) {
    return res.status(400).json({ error: { message: (e as Error).message, code: 'BLOCKED_URL' } });
  }

  const platform = platformSlug(platformOverride || provider.id);
  if (!platform) return res.status(400).json({ error: { message: 'invalid platform slug' } });
  if (hasProvider(platform)) {
    return res.status(409).json({ error: { message: `provider "${platform}" already exists`, code: 'PROVIDER_EXISTS' } });
  }

  // pick models
  const allModels = Object.entries(provider.models || {});
  const filtered = allModels.filter(([id, m]) => {
    if (modelIds && !modelIds.includes(id)) return false;
    if (textOnly) {
      const inputs = m.modalities?.input || ['text'];
      const outputs = m.modalities?.output || ['text'];
      // require both sides to include text (drop audio-only / image-only)
      if (!inputs.includes('text') || !outputs.includes('text')) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return res.status(400).json({ error: { message: 'no models match the import filter' } });
  }

  try {
    const db = getDb();

    // 1) create custom_providers row
    db.prepare(`
      INSERT INTO custom_providers (platform, name, base_url, api_format, extra_headers, timeout_ms, enabled)
      VALUES (?, ?, ?, 'openai', NULL, NULL, 1)
    `).run(platform, provider.name, baseUrl);

    // 2) register live (no restart needed)
    registerOpenAICompat({ platform, name: provider.name, baseUrl });

    // 3) seed models (mirrors providers.ts shape)
    // monthly_token_budget is NOT NULL DEFAULT '' in schema; pass '' explicitly
    const upsert = db.prepare(`
      INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
                          rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', ?, 1)
      ON CONFLICT(platform, model_id) DO UPDATE SET
        display_name = excluded.display_name,
        intelligence_rank = excluded.intelligence_rank,
        speed_rank = excluded.speed_rank,
        size_label = excluded.size_label,
        context_window = excluded.context_window,
        enabled = 1
    `);

    const tx = db.transaction(() => {
      for (const [mid, m] of filtered) {
        const displayName = m.name || mid;
        const ir = inferIntelligenceRank(m);
        const sr = inferSpeedRank(m);
        const sl = inferSizeLabel(m);
        const ctx = m.limit?.context ?? null;
        upsert.run(platform, mid, displayName, ir, sr, sl, ctx);
      }
    });
    tx();

    res.status(201).json({
      ok: true,
      platform,
      name: provider.name,
      baseUrl,
      modelCount: filtered.length,
      env: provider.env || [],
      doc: provider.doc,
    });
  } catch (e: any) {
    res.status(500).json({ error: { message: e?.message || 'import failed' } });
  }
});
