import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { seedDemoKeys } from '../../lib/demo-seed.js';
import { initEncryptionKey, decrypt } from '../../lib/crypto.js';

// Minimal schema mirror (just the tables seedDemoKeys touches).
function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL, model_id TEXT NOT NULL, display_name TEXT NOT NULL,
      intelligence_rank INTEGER NOT NULL, speed_rank INTEGER NOT NULL,
      size_label TEXT NOT NULL DEFAULT '', rpm_limit INTEGER, rpd_limit INTEGER,
      tpm_limit INTEGER, tpd_limit INTEGER, monthly_token_budget TEXT NOT NULL DEFAULT '',
      context_window INTEGER, enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(platform, model_id)
    );
    CREATE TABLE api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '', encrypted_key TEXT NOT NULL, iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown',
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked_at TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE fallback_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT, model_db_id INTEGER NOT NULL REFERENCES models(id),
      priority INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, UNIQUE(model_db_id)
    );
  `);
  process.env.ENCRYPTION_KEY = '0'.repeat(64);
  initEncryptionKey(db);
  return db;
}

const ORIG = { ...process.env };
afterEach(() => {
  process.env.DEMO_MODE = ORIG.DEMO_MODE;
  delete process.env.DEMO_GROQ_KEY;
  delete process.env.DEMO_CEREBRAS_KEY;
});

describe('seedDemoKeys', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('is a no-op when DEMO_MODE is off', () => {
    process.env.DEMO_MODE = 'false';
    process.env.DEMO_GROQ_KEY = 'gsk_demo_abc';
    seedDemoKeys(db);
    expect(db.prepare('SELECT COUNT(*) n FROM api_keys').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM models').get()).toMatchObject({ n: 0 });
  });

  it('is a no-op when the env key is absent even in DEMO_MODE', () => {
    process.env.DEMO_MODE = 'true';
    // no DEMO_GROQ_KEY / DEMO_CEREBRAS_KEY
    seedDemoKeys(db);
    expect(db.prepare('SELECT COUNT(*) n FROM api_keys').get()).toMatchObject({ n: 0 });
  });

  it('seeds an encrypted key + curated models when DEMO_MODE + key present', () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_GROQ_KEY = 'gsk_demo_secret_value';
    seedDemoKeys(db);

    const keys = db.prepare("SELECT * FROM api_keys WHERE platform='groq'").all() as any[];
    expect(keys).toHaveLength(1);
    // stored encrypted (not plaintext) and round-trips back
    expect(keys[0].encrypted_key).not.toContain('gsk_demo_secret_value');
    expect(decrypt(keys[0].encrypted_key, keys[0].iv, keys[0].auth_tag)).toBe('gsk_demo_secret_value');

    const models = db.prepare("SELECT * FROM models WHERE platform='groq'").all() as any[];
    expect(models.length).toBeGreaterThanOrEqual(3);
    // every seeded model has a fallback entry
    const fb = db.prepare('SELECT COUNT(*) n FROM fallback_config').get() as { n: number };
    expect(fb.n).toBe(models.length);
  });

  it('is idempotent — second run adds nothing', () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_CEREBRAS_KEY = 'csk-demo-xyz';
    seedDemoKeys(db);
    const after1 = db.prepare('SELECT COUNT(*) n FROM api_keys').get() as { n: number };
    seedDemoKeys(db);
    const after2 = db.prepare('SELECT COUNT(*) n FROM api_keys').get() as { n: number };
    expect(after2.n).toBe(after1.n);
    expect(after1.n).toBe(1);
  });

  it('only seeds providers whose env key is set', () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_GROQ_KEY = 'gsk_only_groq';
    // cerebras key intentionally absent
    seedDemoKeys(db);
    const platforms = (db.prepare('SELECT DISTINCT platform FROM api_keys').all() as any[]).map((r) => r.platform);
    expect(platforms).toEqual(['groq']);
  });
});
