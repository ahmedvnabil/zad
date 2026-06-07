import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, getDb, setSetting } from '../../db/index.js';
import { applyBudgetGuard } from '../../services/budgetGuard.js';

const cohereEnabled = () =>
  (getDb().prepare(`
    SELECT COUNT(*) AS c FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id
    WHERE m.platform = 'cohere' AND fc.enabled = 1
  `).get() as { c: number }).c;

describe('budget guard', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM requests').run();
    db.prepare("UPDATE fallback_config SET enabled = 1").run();
    setSetting('budget_guard_disabled', '[]');
  });

  it('disables a provider that exceeded its monthly budget, re-enables on recovery', () => {
    const db = getDb();
    expect(cohereEnabled()).toBeGreaterThan(0);

    // Cohere's pool is ~1-2M tokens/mo; log 5M used this month → over budget.
    db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms)
      VALUES ('cohere', 'command-r-plus-08-2024', 'success', 5000000, 0, 10)
    `).run();

    const r1 = applyBudgetGuard();
    expect(r1.disabled).toBeGreaterThan(0);
    expect(cohereEnabled()).toBe(0); // all cohere entries disabled

    // Recovery (monthly reset simulated by clearing usage) → guard re-enables.
    db.prepare("DELETE FROM requests WHERE platform = 'cohere'").run();
    const r2 = applyBudgetGuard();
    expect(r2.reenabled).toBeGreaterThan(0);
    expect(cohereEnabled()).toBeGreaterThan(0);
  });

  it('does not re-enable models it never disabled (respects manual choices)', () => {
    const db = getDb();
    // Manually disable a cohere model; guard must leave it off on recovery.
    const m = db.prepare("SELECT id FROM models WHERE platform = 'cohere' LIMIT 1").get() as { id: number };
    db.prepare('UPDATE fallback_config SET enabled = 0 WHERE model_db_id = ?').run(m.id);

    applyBudgetGuard(); // nothing over budget, no usage
    const stillOff = (db.prepare('SELECT enabled FROM fallback_config WHERE model_db_id = ?').get(m.id) as { enabled: number }).enabled;
    expect(stillOff).toBe(0);
  });
});
