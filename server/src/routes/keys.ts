import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';
import { checkKeyHealth } from '../services/health.js';
import { notifyKeyResult } from '../services/notifications.js';
import { hasProvider } from '../providers/index.js';

export const keysRouter = Router();

// Active providers — must match providers/index.ts registrations + shared/types.ts Platform.
// Hugging Face, Moonshot, and MiniMax direct integrations were dropped in V4
// (see migrateModelsV4 comment block).
const PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'meridian', 'cliproxyapi',
] as const;

const addKeySchema = z.object({
  // Any registered provider (built-in or custom) — validated via hasProvider().
  platform: z.string().min(1),
  key: z.string().min(1),
  label: z.string().optional(),
});

type Platform = (typeof PLATFORMS)[number];

// Best-effort provider detection from a key's distinctive prefix/shape.
// Returns null for providers with no reliable signature (caller must pass platform).
function detectPlatform(key: string): Platform | null {
  const k = key.trim();
  if (/^gsk_/.test(k)) return 'groq';
  if (/^sk-or-/.test(k)) return 'openrouter';
  if (/^AIza[\w-]{20,}/.test(k)) return 'google';
  if (/^nvapi-/.test(k)) return 'nvidia';
  if (/^csk-/.test(k)) return 'cerebras';
  if (/^(ghp_|github_pat_)/.test(k)) return 'github';
  if (/^[a-f0-9]{32}:[\w-]{20,}$/.test(k)) return 'cloudflare'; // account_id:token
  return null;
}

const ingestSchema = z.object({
  key: z.string().min(1),
  // Any registered provider (built-in or custom); omit to auto-detect built-ins.
  platform: z.string().optional(),
  label: z.string().optional(),
});

// Quick key ingest: POST { key, platform?, label? }. Auto-detects the provider
// from the key shape when platform is omitted, stores it, validates it live,
// and returns the verdict. Gated by INGEST_TOKEN (header x-ingest-token) when
// that env var is set; open otherwise (LAN single-user).
keysRouter.post('/ingest', async (req: Request, res: Response) => {
  const required = process.env.INGEST_TOKEN?.trim();
  if (required) {
    const provided = (req.header('x-ingest-token') ?? '').trim();
    if (provided !== required) {
      res.status(401).json({ error: { message: 'unauthorized' } });
      return;
    }
  }

  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const key = parsed.data.key.trim();
  const platform = parsed.data.platform ?? detectPlatform(key);
  if (!platform) {
    res.status(422).json({
      error: { message: 'تعذّر اكتشاف المزوّد من شكل المفتاح — حدّد platform صراحةً.', code: 'PLATFORM_UNDETECTED' },
    });
    return;
  }
  if (!hasProvider(platform)) {
    res.status(422).json({
      error: { message: `مزوّد غير معروف: "${platform}" — أضِفه أولاً عبر /api/providers.`, code: 'UNKNOWN_PROVIDER' },
    });
    return;
  }

  try {
    const { encrypted, iv, authTag } = encrypt(key);
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, 'unknown', 1)
    `).run(platform, parsed.data.label ?? '', encrypted, iv, authTag);

    const id = Number(result.lastInsertRowid);
    const masked = maskKey(key);

    // Validate immediately so the caller gets a verdict, not just "stored".
    let status = 'unknown';
    try {
      status = await checkKeyHealth(id);
    } catch {
      status = 'error';
    }

    notifyKeyResult(platform, masked, status);

    res.status(201).json({
      ok: true,
      data: { id, platform, maskedKey: masked, status, detected: !parsed.data.platform },
      error: null,
    });
  } catch (e) {
    res.status(500).json({ error: { message: e instanceof Error ? e.message : 'ingest failed' } });
  }
});

// List all keys (masked)
keysRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as any[];

  const keys = rows.map(row => {
    let maskedKey = '****';
    try {
      const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      maskedKey = maskKey(realKey);
    } catch {
      maskedKey = '[decrypt failed]';
    }
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      maskedKey,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
    };
  });

  res.json(keys);
});

// Add a key
keysRouter.post('/', (req: Request, res: Response) => {
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  if (!hasProvider(parsed.data.platform)) {
    res.status(400).json({ error: { message: `مزوّد غير معروف: "${parsed.data.platform}"` } });
    return;
  }

  const { platform, key, label } = parsed.data;
  const { encrypted, iv, authTag } = encrypt(key);

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, ?, ?, ?, ?, 'unknown', 1)
  `).run(platform, label ?? '', encrypted, iv, authTag);

  res.status(201).json({
    id: result.lastInsertRowid,
    platform,
    label: label ?? '',
    maskedKey: maskKey(key),
    status: 'unknown',
    enabled: true,
  });
});

// Delete a key
keysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  res.json({ success: true });
});

// Toggle enable/disable
keysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  res.json({ success: true, enabled });
});
