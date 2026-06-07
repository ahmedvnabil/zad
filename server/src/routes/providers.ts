import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  hasProvider,
  registerOpenAICompat,
  unregisterProvider,
} from '../providers/index.js';
import { assertPublicUrl } from '../lib/demo.js';

export const providersRouter = Router();

// Adding/removing a provider is privileged — gate behind INGEST_TOKEN when set.
function authorized(req: Request): boolean {
  const required = process.env.INGEST_TOKEN?.trim();
  if (!required) return true; // open on trusted LAN
  return (req.header('x-ingest-token') ?? '').trim() === required;
}

const modelSchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  contextWindow: z.number().int().positive().optional(),
  rpm: z.number().int().nonnegative().optional(),
  rpd: z.number().int().nonnegative().optional(),
  intelligenceRank: z.number().int().optional(),
  speedRank: z.number().int().optional(),
  sizeLabel: z.string().optional(),
});

const addProviderSchema = z.object({
  platform: z.string().regex(/^[a-z0-9][a-z0-9-]{1,29}$/, 'platform لازم يكون slug صغير (a-z 0-9 -)'),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiFormat: z.literal('openai').optional(),
  extraHeaders: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
  models: z.array(modelSchema).optional(),
});

// List custom (dynamically-added) providers with model + key counts.
providersRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT cp.platform, cp.name, cp.base_url, cp.timeout_ms, cp.enabled, cp.created_at,
           (SELECT COUNT(*) FROM models m WHERE m.platform = cp.platform) AS model_count,
           (SELECT COUNT(*) FROM api_keys k WHERE k.platform = cp.platform AND k.enabled = 1) AS key_count
    FROM custom_providers cp
    ORDER BY cp.created_at DESC
  `).all() as any[];
  res.json(rows.map(r => ({
    platform: r.platform,
    name: r.name,
    baseUrl: r.base_url,
    timeoutMs: r.timeout_ms,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    modelCount: r.model_count,
    keyCount: r.key_count,
    active: hasProvider(r.platform),
  })));
});

// Add a new OpenAI-compatible provider (+ optional models), register it live.
providersRouter.post('/', (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({ error: { message: 'unauthorized' } });
    return;
  }

  const parsed = addProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { platform, name, models } = parsed.data;
  const baseUrl = parsed.data.baseUrl.replace(/\/+$/, '');
  const extraHeaders = parsed.data.extraHeaders;
  const timeoutMs = parsed.data.timeoutMs;

  // SSRF guard: never let a user-supplied base URL point at an internal host.
  try {
    assertPublicUrl(baseUrl);
  } catch (e) {
    res.status(400).json({ error: { message: (e as Error).message, code: 'BLOCKED_URL' } });
    return;
  }

  if (hasProvider(platform)) {
    res.status(409).json({ error: { message: `المزوّد "${platform}" موجود بالفعل`, code: 'PROVIDER_EXISTS' } });
    return;
  }

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO custom_providers (platform, name, base_url, api_format, extra_headers, timeout_ms, enabled)
      VALUES (?, ?, ?, 'openai', ?, ?, 1)
    `).run(platform, name, baseUrl, extraHeaders ? JSON.stringify(extraHeaders) : null, timeoutMs ?? null);

    // Register live so it's usable immediately, no restart.
    registerOpenAICompat({ platform, name, baseUrl, extraHeaders, timeoutMs });

    // Seed models (if any) so the provider is routable right away.
    let modelCount = 0;
    if (models && models.length) {
      const upsert = db.prepare(`
        INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
                            rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', ?, 1)
        ON CONFLICT(platform, model_id) DO UPDATE SET
          display_name = excluded.display_name,
          context_window = excluded.context_window,
          rpm_limit = excluded.rpm_limit,
          rpd_limit = excluded.rpd_limit,
          enabled = 1
      `);
      const tx = db.transaction((list: typeof models) => {
        for (const m of list) {
          upsert.run(
            platform, m.modelId, m.displayName,
            m.intelligenceRank ?? 60, m.speedRank ?? 60, m.sizeLabel ?? '',
            m.rpm ?? null, m.rpd ?? null, m.contextWindow ?? null,
          );
        }
      });
      tx(models);
      modelCount = models.length;
    }

    res.status(201).json({
      ok: true,
      data: { platform, name, baseUrl, modelCount, active: true },
      error: null,
    });
  } catch (e) {
    res.status(500).json({ error: { message: e instanceof Error ? e.message : 'add provider failed' } });
  }
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
});

// Update a custom provider (base URL / name / enabled) and re-register it live.
providersRouter.patch('/:platform', (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({ error: { message: 'unauthorized' } });
    return;
  }
  const platform = String(req.params.platform);
  const db = getDb();
  const row = db.prepare('SELECT * FROM custom_providers WHERE platform = ?').get(platform) as any;
  if (!row) {
    res.status(404).json({ error: { message: 'مزوّد مخصّص غير موجود' } });
    return;
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const name = parsed.data.name ?? row.name;
  const baseUrl = (parsed.data.baseUrl ?? row.base_url).replace(/\/+$/, '');
  const enabled = parsed.data.enabled ?? row.enabled === 1;
  const timeoutMs = parsed.data.timeoutMs ?? row.timeout_ms;

  // SSRF guard on the (possibly updated) base URL.
  try {
    assertPublicUrl(baseUrl);
  } catch (e) {
    res.status(400).json({ error: { message: (e as Error).message, code: 'BLOCKED_URL' } });
    return;
  }

  db.prepare('UPDATE custom_providers SET name = ?, base_url = ?, enabled = ?, timeout_ms = ? WHERE platform = ?')
    .run(name, baseUrl, enabled ? 1 : 0, timeoutMs ?? null, platform);

  // Re-register live with the new config (or unregister if disabled).
  unregisterProvider(platform);
  if (enabled) {
    let headers: Record<string, string> | undefined;
    try { headers = row.extra_headers ? JSON.parse(row.extra_headers) : undefined; } catch { headers = undefined; }
    registerOpenAICompat({ platform, name, baseUrl, extraHeaders: headers, timeoutMs: timeoutMs ?? undefined });
  }

  res.json({ ok: true, data: { platform, name, baseUrl, enabled, active: hasProvider(platform) }, error: null });
});

// Remove a custom provider: deregister + drop its models and keys.
providersRouter.delete('/:platform', (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({ error: { message: 'unauthorized' } });
    return;
  }
  const platform = String(req.params.platform);
  const db = getDb();
  const result = db.prepare('DELETE FROM custom_providers WHERE platform = ?').run(platform);
  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'مزوّد مخصّص غير موجود (المزوّدون المدمجون لا يُحذفون)' } });
    return;
  }
  unregisterProvider(platform);
  db.prepare('DELETE FROM models WHERE platform = ?').run(platform);
  db.prepare('DELETE FROM api_keys WHERE platform = ?').run(platform);
  res.json({ ok: true, data: { platform, removed: true }, error: null });
});
