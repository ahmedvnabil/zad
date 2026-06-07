import { getDb, getSetting, setSetting } from '../db/index.js';

// How often to check provider budgets while the guard is on.
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INITIAL_DELAY_MS = 45 * 1000;

const BUDGET_RE = /~?\s*([\d.]+)\s*(?:-\s*([\d.]+))?\s*([KMB])?/i;
function parseBudgetTokens(value: string | null | undefined): number {
  if (!value) return 0;
  const m = String(value).match(BUDGET_RE);
  if (!m) return 0;
  const amount = parseFloat(m[2] ?? m[1]);
  if (!Number.isFinite(amount)) return 0;
  const unit = (m[3] ?? '').toUpperCase();
  const mult = unit === 'B' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
  return Math.round(amount * mult);
}

/**
 * Disable fallback entries whose provider has burned through its estimated
 * monthly free budget, and re-enable the ones the guard previously disabled
 * once the provider recovers (e.g. after the monthly reset). Only ever touches
 * models the guard itself disabled — manual enable/disable choices are left
 * alone. Returns how many it changed.
 */
export function applyBudgetGuard(): { disabled: number; reenabled: number } {
  const db = getDb();

  // Per-provider pool budget = max model budget within the provider.
  const models = db.prepare('SELECT platform, monthly_token_budget FROM models').all() as { platform: string; monthly_token_budget: string }[];
  const poolBudget = new Map<string, number>();
  for (const m of models) {
    poolBudget.set(m.platform, Math.max(poolBudget.get(m.platform) ?? 0, parseBudgetTokens(m.monthly_token_budget)));
  }

  const usageRows = db.prepare(`
    SELECT platform, COALESCE(SUM(input_tokens + output_tokens), 0) AS used
    FROM requests
    WHERE created_at >= datetime('now', 'start of month')
    GROUP BY platform
  `).all() as { platform: string; used: number }[];
  const usedByPlatform = new Map(usageRows.map(u => [u.platform, u.used]));

  const isOverBudget = (platform: string): boolean => {
    const budget = poolBudget.get(platform) ?? 0;
    return budget > 0 && (usedByPlatform.get(platform) ?? 0) >= budget;
  };

  const guardDisabled = new Set<number>(JSON.parse(getSetting('budget_guard_disabled') || '[]'));

  const entries = db.prepare(`
    SELECT fc.model_db_id, fc.enabled, m.platform
    FROM fallback_config fc JOIN models m ON m.id = fc.model_db_id
  `).all() as { model_db_id: number; enabled: number; platform: string }[];

  const setEnabled = db.prepare('UPDATE fallback_config SET enabled = ? WHERE model_db_id = ?');
  let disabled = 0;
  let reenabled = 0;

  const tx = db.transaction(() => {
    for (const e of entries) {
      const over = isOverBudget(e.platform);
      if (over && e.enabled === 1) {
        setEnabled.run(0, e.model_db_id);
        guardDisabled.add(e.model_db_id);
        disabled++;
      } else if (!over && guardDisabled.has(e.model_db_id)) {
        // Provider recovered — re-enable only what the guard turned off.
        setEnabled.run(1, e.model_db_id);
        guardDisabled.delete(e.model_db_id);
        reenabled++;
      }
    }
    setSetting('budget_guard_disabled', JSON.stringify([...guardDisabled]));
  });
  tx();

  return { disabled, reenabled };
}

function tick() {
  try {
    if (getSetting('budget_guard') !== 'true') return;
    const { disabled, reenabled } = applyBudgetGuard();
    if (disabled || reenabled) {
      console.log(`[budget-guard] disabled ${disabled}, re-enabled ${reenabled} models`);
    }
  } catch (err) {
    console.error('[budget-guard] failed:', err);
  }
}

/** Start the background budget guard (no-op unless the setting is on). */
export function startBudgetGuard() {
  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, INTERVAL_MS);
}
