// Demo-only key + model seeder.
//
// On a public demo instance (DEMO_MODE=true) this reads light, rate-limited
// provider keys from env vars and seeds them — encrypted — into the api_keys
// table, plus a small curated set of fast/free models per provider, so that
// visitors can actually fire a test request and watch the router + analytics
// light up. On a normal self-hosted instance this is a no-op.
//
// The keys themselves are NEVER committed — they live only in the demo
// instance's environment (DEMO_GROQ_KEY / DEMO_CEREBRAS_KEY). The provider
// signup tiers used here are the free ones, so quota exhaustion just makes the
// router fall back, which is itself a nice thing for visitors to see.
import type Database from 'better-sqlite3';
import { encrypt } from './crypto.js';

interface DemoModel {
  model_id: string;
  display_name: string;
  intelligence_rank: number;
  speed_rank: number;
  size_label: string;
  context_window: number;
}

interface DemoProvider {
  platform: string;
  envVar: string;
  label: string;
  models: DemoModel[];
}

// Curated: small + fast + tool-capable, the cheapest tier to keep demo quota alive.
const DEMO_PROVIDERS: DemoProvider[] = [
  {
    platform: 'groq',
    envVar: 'DEMO_GROQ_KEY',
    label: 'Demo Groq (free tier)',
    models: [
      { model_id: 'llama-3.1-8b-instant', display_name: 'Llama 3.1 8B Instant (Groq)', intelligence_rank: 10, speed_rank: 1, size_label: '8B', context_window: 131072 },
      { model_id: 'llama-3.3-70b-versatile', display_name: 'Llama 3.3 70B Versatile (Groq)', intelligence_rank: 5, speed_rank: 2, size_label: '70B', context_window: 131072 },
      { model_id: 'gemma2-9b-it', display_name: 'Gemma2 9B (Groq)', intelligence_rank: 12, speed_rank: 1, size_label: '9B', context_window: 8192 },
    ],
  },
  {
    platform: 'cerebras',
    envVar: 'DEMO_CEREBRAS_KEY',
    label: 'Demo Cerebras (free tier)',
    models: [
      { model_id: 'llama3.1-8b', display_name: 'Llama 3.1 8B (Cerebras)', intelligence_rank: 11, speed_rank: 1, size_label: '8B', context_window: 32000 },
      { model_id: 'gpt-oss-120b', display_name: 'GPT-OSS 120B (Cerebras)', intelligence_rank: 4, speed_rank: 2, size_label: '120B', context_window: 131072 },
    ],
  },
];

/**
 * Seed demo provider keys + curated models. No-op unless DEMO_MODE is on AND
 * the matching env var is present. Idempotent: skips a provider that already
 * has any key row.
 */
export function seedDemoKeys(db: Database.Database): void {
  // Read at call-time (not a frozen module const) so it reflects the live env
  // and is unit-testable.
  if (process.env.DEMO_MODE !== 'true') return;

  const hasKey = db.prepare('SELECT 1 FROM api_keys WHERE platform = ? LIMIT 1');
  const insertKey = db.prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, ?, ?, ?, ?, 'unknown', 1)
  `);
  const upsertModel = db.prepare(`
    INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', ?, 1)
    ON CONFLICT(platform, model_id) DO UPDATE SET
      display_name = excluded.display_name,
      intelligence_rank = excluded.intelligence_rank,
      speed_rank = excluded.speed_rank,
      size_label = excluded.size_label,
      context_window = excluded.context_window,
      enabled = 1
  `);
  const findModel = db.prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?');
  const addFallback = db.prepare(`
    INSERT OR IGNORE INTO fallback_config (model_db_id, priority, enabled)
    VALUES (?, (SELECT COALESCE(MAX(priority), 0) + 1 FROM fallback_config), 1)
  `);

  let seeded = 0;
  const tx = db.transaction(() => {
    for (const prov of DEMO_PROVIDERS) {
      const rawKey = process.env[prov.envVar];
      if (!rawKey || !rawKey.trim()) continue;        // no key configured → skip provider
      if (hasKey.get(prov.platform)) continue;         // already seeded → idempotent

      const { encrypted, iv, authTag } = encrypt(rawKey.trim());
      insertKey.run(prov.platform, prov.label, encrypted, iv, authTag);

      for (const m of prov.models) {
        upsertModel.run(
          prov.platform, m.model_id, m.display_name,
          m.intelligence_rank, m.speed_rank, m.size_label, m.context_window
        );
        const row = findModel.get(prov.platform, m.model_id) as { id: number } | undefined;
        if (row) addFallback.run(row.id);
      }
      seeded++;
    }
  });
  tx();

  if (seeded > 0) {
    // eslint-disable-next-line no-console
    console.log(`[demo] seeded ${seeded} demo provider(s) with curated models`);
  }
}
