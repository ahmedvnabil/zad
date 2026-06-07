import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { getAllPenalties } from '../services/router.js';
import { getModelMetadata } from '../lib/capabilities.js';

export const fallbackRouter = Router();

// Get fallback chain (with dynamic penalties)
fallbackRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT fc.model_db_id, fc.priority, fc.enabled,
           m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.speed_rank, m.size_label, m.rpm_limit, m.rpd_limit,
           m.monthly_token_budget, m.context_window
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id
    ORDER BY fc.priority ASC
  `).all() as any[];

  // Count enabled keys per platform
  const keyCounts = db.prepare(`
    SELECT platform, COUNT(*) as count
    FROM api_keys WHERE enabled = 1
    GROUP BY platform
  `).all() as { platform: string; count: number }[];
  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));

  // Get current dynamic penalties
  const penalties = getAllPenalties();
  const penaltyMap = new Map(penalties.map(p => [p.modelDbId, p]));

  // Per-provider pool budget + this-month usage → "budget exhausted" flag, so
  // the UI can show when a model is off because its provider ran out of credit.
  const poolBudget = new Map<string, number>();
  for (const r of rows) {
    poolBudget.set(r.platform, Math.max(poolBudget.get(r.platform) ?? 0, parseBudgetTokens(r.monthly_token_budget)));
  }
  const usageRows = db.prepare(`
    SELECT platform, COALESCE(SUM(input_tokens + output_tokens), 0) AS used
    FROM requests WHERE created_at >= datetime('now', 'start of month')
    GROUP BY platform
  `).all() as { platform: string; used: number }[];
  const usedByPlatform = new Map(usageRows.map(u => [u.platform, u.used]));

  res.json(rows.map(r => {
    const penalty = penaltyMap.get(r.model_db_id);
    const metadata = getModelMetadata(r.platform, r.model_id);
    const budget = poolBudget.get(r.platform) ?? 0;
    const budgetExhausted = budget > 0 && (usedByPlatform.get(r.platform) ?? 0) >= budget;
    return {
      modelDbId: r.model_db_id,
      priority: r.priority,
      effectivePriority: r.priority + (penalty?.penalty ?? 0),
      penalty: penalty?.penalty ?? 0,
      rateLimitHits: penalty?.count ?? 0,
      enabled: r.enabled === 1,
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name,
      intelligenceRank: r.intelligence_rank,
      speedRank: r.speed_rank,
      sizeLabel: r.size_label,
      rpmLimit: r.rpm_limit,
      rpdLimit: r.rpd_limit,
      monthlyTokenBudget: r.monthly_token_budget,
      contextWindow: r.context_window,
      ...metadata,
      budgetExhausted,
      keyCount: keyCountMap.get(r.platform) ?? 0,
    };
  }));
});

// Parse a fuzzy monthly-budget label ('~50-100M', '~6M', 'local', 'credits-based')
// into a token count. Uses the high end of a range; non-numeric labels (local /
// credits-based) → 0, i.e. "no metered budget".
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

function formatTokensShort(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

interface OptimizeTip {
  level: 'good' | 'warn' | 'info';
  text: string;
}

/**
 * Suggest a fallback ordering that drains free monthly credits before they
 * reset, while keeping quality reasonable. Deterministic — derived purely from
 * the catalog, this month's usage, key availability, and live rate-limit
 * penalties. Returns a proposed order (the UI previews it, then Saves/Discards)
 * plus human-readable tips explaining the reasoning.
 *
 * Credits are treated as a *per-provider pool*: many providers list the same
 * shared budget on every model (OpenRouter ':free' ≈ 6M shared, Mistral
 * Experiment pool, Cloudflare Neurons), so the pool size is the max budget
 * across a provider's models, not their sum.
 */
export function buildOptimization(): {
  order: Array<{ modelDbId: number; priority: number; enabled: boolean }>;
  tips: OptimizeTip[];
} {
  const db = getDb();
  const models = db.prepare(`
    SELECT m.id, m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.rpm_limit, m.monthly_token_budget, fc.enabled
    FROM models m JOIN fallback_config fc ON fc.model_db_id = m.id
  `).all() as Array<{
    id: number; platform: string; model_id: string; display_name: string;
    intelligence_rank: number; rpm_limit: number | null;
    monthly_token_budget: string; enabled: number;
  }>;

  const keyCounts = db.prepare(`
    SELECT platform, COUNT(*) as count FROM api_keys WHERE enabled = 1 GROUP BY platform
  `).all() as { platform: string; count: number }[];
  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));

  const usageRows = db.prepare(`
    SELECT platform, COALESCE(SUM(input_tokens + output_tokens), 0) as used
    FROM requests
    WHERE created_at >= datetime('now', 'start of month')
    GROUP BY platform
  `).all() as { platform: string; used: number }[];
  const usedByPlatform = new Map(usageRows.map(u => [u.platform, u.used]));

  const penaltyMap = new Map(getAllPenalties().map(p => [p.modelDbId, p]));

  // Per-provider shared pool budget = max model budget within the provider.
  const poolBudget = new Map<string, number>();
  for (const m of models) {
    const b = parseBudgetTokens(m.monthly_token_budget);
    poolBudget.set(m.platform, Math.max(poolBudget.get(m.platform) ?? 0, b));
  }
  const remainingFor = (platform: string): number => {
    const b = poolBudget.get(platform) ?? 0;
    if (b <= 0) return 0;
    return Math.max(0, b - (usedByPlatform.get(platform) ?? 0));
  };

  const maxRemaining = Math.max(1, ...models.map(m => remainingFor(m.platform)));
  const maxRank = Math.max(1, ...models.map(m => m.intelligence_rank));

  // Capability richness, normalized 0..1 (tools weighted highest since this is
  // an agentic router). Precomputed because the sort comparator calls score()
  // many times per model.
  const capById = new Map<number, number>();
  for (const m of models) {
    const meta = getModelMetadata(m.platform, m.model_id);
    const c = meta.capabilities;
    let pts = 0;
    pts += c.toolCalling === true ? 1.0 : c.toolCalling === 'unknown' ? 0.3 : 0;
    pts += c.imageInput === true ? 0.5 : 0;
    pts += c.audioInput === true ? 0.3 : 0;
    if (meta.features.includes('reasoning')) pts += 0.4;
    capById.set(m.id, pts / 2.2); // 2.2 = max possible points
  }

  // Score: higher = earlier in the chain. Capability-rich models (tools / vision
  // / reasoning) float up the most, then models with remaining credit, then
  // intelligence; exhausted / rate-limited get demoted; local (unmetered)
  // providers sit just above no-key ones as infinite fallback; no-key providers
  // sink to the bottom (the UI hides them anyway).
  function score(m: typeof models[number]): number {
    const keyCount = keyCountMap.get(m.platform) ?? 0;
    const intel = (maxRank + 1 - m.intelligence_rank) / maxRank; // 0..1, higher = smarter
    const cap = capById.get(m.id) ?? 0;                          // 0..1, higher = more capable
    if (keyCount === 0) return -1000 + intel;
    const budget = poolBudget.get(m.platform) ?? 0;
    if (budget <= 0) return 0.05 * (0.6 * cap + 0.4 * intel); // local: order by capability/intel
    const remShare = remainingFor(m.platform) / maxRemaining; // 0..1
    const usedPct = (usedByPlatform.get(m.platform) ?? 0) / budget;
    const penalty = penaltyMap.get(m.id)?.penalty ?? 0;
    let s = 0.40 * cap + 0.35 * remShare + 0.25 * intel;
    if (usedPct >= 0.95) s -= 0.5;                       // nearly exhausted
    s -= 0.15 * (Math.min(penalty, 3) / 3);              // recently rate-limited
    if (m.rpm_limit && m.rpm_limit <= 2) s -= 0.05;      // tight rpm drains slowly
    return s + 1; // keep all metered models above local/no-key tiers
  }

  const order = [...models]
    .sort((a, b) => score(b) - score(a))
    .map((m, i) => ({ modelDbId: m.id, priority: i + 1, enabled: m.enabled === 1 }));

  // ── Tips (data-driven; only emitted when their condition holds) ───────────
  const tips: OptimizeTip[] = [];
  const providers = [...new Set(models.map(m => m.platform))];

  for (const p of providers) {
    const keyCount = keyCountMap.get(p) ?? 0;
    if (keyCount === 0) continue;
    const budget = poolBudget.get(p) ?? 0;
    if (budget <= 0) continue;
    const usedPct = (usedByPlatform.get(p) ?? 0) / budget;

    if (budget >= 10_000_000 && usedPct < 0.10) {
      tips.push({ level: 'good', text: `${p}: free pool ~${formatTokensShort(budget)}/mo is only ${Math.round(usedPct * 100)}% used — promoted to drain it before the monthly reset.` });
    } else if (usedPct >= 0.95) {
      tips.push({ level: 'warn', text: `${p}: ~${Math.round(usedPct * 100)}% of the monthly budget is used — demoted; consider disabling it until it resets.` });
    }

    const enabledKeyed = models.filter(m => m.platform === p && m.enabled === 1);
    const distinctBudgets = new Set(enabledKeyed.map(m => m.monthly_token_budget));
    if (enabledKeyed.length >= 4 && distinctBudgets.size === 1) {
      tips.push({ level: 'info', text: `${p}: ${enabledKeyed.length} models share one ~${formatTokensShort(budget)} pool — stacking them doesn't add capacity; diversify providers for more total credits.` });
    }
  }

  // Disabled models that still have a key and budget left (top 2 by remaining).
  models
    .filter(m => m.enabled === 0 && (keyCountMap.get(m.platform) ?? 0) > 0 && remainingFor(m.platform) > 1_000_000)
    .sort((a, b) => remainingFor(b.platform) - remainingFor(a.platform))
    .slice(0, 2)
    .forEach(m => tips.push({ level: 'info', text: `${m.display_name} is disabled, but ${m.platform} has a key and ~${formatTokensShort(remainingFor(m.platform))} left — enable it to use that budget.` }));

  // Models currently penalized for hitting rate limits (top 3).
  models
    .filter(m => (penaltyMap.get(m.id)?.penalty ?? 0) > 0)
    .sort((a, b) => (penaltyMap.get(b.id)!.penalty) - (penaltyMap.get(a.id)!.penalty))
    .slice(0, 3)
    .forEach(m => {
      const pen = penaltyMap.get(m.id)!;
      tips.push({ level: 'warn', text: `${m.display_name} hit rate limits ${pen.count}× (penalty −${pen.penalty}) — demoted below alternatives.` });
    });

  const localProviders = [...new Set(
    models.filter(m => (poolBudget.get(m.platform) ?? 0) === 0 && (keyCountMap.get(m.platform) ?? 0) > 0).map(m => m.platform)
  )];
  if (localProviders.length) {
    tips.push({ level: 'info', text: `Local providers (${localProviders.join(', ')}) have no metered budget — placed last as an unlimited fallback.` });
  }

  const noKeyProviders = providers.filter(p => (keyCountMap.get(p) ?? 0) === 0);
  if (noKeyProviders.length) {
    tips.push({ level: 'info', text: `${noKeyProviders.length} provider(s) have no keys (${noKeyProviders.slice(0, 4).join(', ')}${noKeyProviders.length > 4 ? '…' : ''}) — adding keys unlocks more free budget.` });
  }

  tips.push({ level: 'info', text: 'Ranking favors more capable models (tool calling, vision, reasoning) first, then remaining credit and intelligence.' });

  // Surface positive (good) and cautionary (warn) tips first, then info.
  const rank = { good: 0, warn: 1, info: 2 };
  tips.sort((a, b) => rank[a.level] - rank[b.level]);

  return { order, tips: tips.slice(0, 8) };
}

fallbackRouter.get('/optimize', (_req: Request, res: Response) => {
  res.json(buildOptimization());
});

/** Apply the optimized ordering to fallback_config (priority only — never
 *  touches the enabled flags). Used by the scheduled auto-optimizer. */
export function applyOptimization(): number {
  const { order } = buildOptimization();
  const db = getDb();
  const update = db.prepare('UPDATE fallback_config SET priority = ? WHERE model_db_id = ?');
  const tx = db.transaction(() => {
    for (const o of order) update.run(o.priority, o.modelDbId);
  });
  tx();
  return order.length;
}

const updateSchema = z.array(z.object({
  modelDbId: z.number(),
  priority: z.number(),
  enabled: z.boolean(),
}));

// Update fallback chain (full replace)
fallbackRouter.put('/', (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const db = getDb();
  const update = db.prepare(`
    UPDATE fallback_config SET priority = ?, enabled = ? WHERE model_db_id = ?
  `);

  const updateAll = db.transaction(() => {
    for (const entry of parsed.data) {
      update.run(entry.priority, entry.enabled ? 1 : 0, entry.modelDbId);
    }
  });
  updateAll();

  res.json({ success: true });
});

// Sort presets — `orderBy` is selected from a fixed whitelist, never from
// user input directly, so the interpolation below is safe.
const SORT_PRESETS: Record<string, string> = {
  intelligence: 'm.intelligence_rank ASC',
  speed: 'm.speed_rank ASC',
  budget: "CASE m.monthly_token_budget WHEN '~120M' THEN 1 WHEN '~50-100M' THEN 2 WHEN '~30M' THEN 3 WHEN '~18-45M' THEN 4 WHEN '~18M' THEN 5 WHEN '~15M' THEN 6 WHEN '~12M' THEN 7 WHEN '~6M' THEN 8 WHEN '~5-10M' THEN 9 WHEN '~4M' THEN 10 ELSE 11 END ASC",
};

fallbackRouter.post('/sort/:preset', (req: Request, res: Response) => {
  const preset = String(req.params.preset);
  const orderBy = SORT_PRESETS[preset];
  if (!orderBy) {
    res.status(400).json({ error: { message: `Unknown preset: ${preset}. Use: intelligence, speed, budget` } });
    return;
  }

  const db = getDb();
  const models = db.prepare(`SELECT m.id FROM models m ORDER BY ${orderBy}`).all() as { id: number }[];

  const update = db.prepare('UPDATE fallback_config SET priority = ? WHERE model_db_id = ?');
  const reorder = db.transaction(() => {
    for (let i = 0; i < models.length; i++) {
      update.run(i + 1, models[i].id);
    }
  });
  reorder();

  res.json({ success: true, preset });
});

// Token usage per model for the stacked bar
fallbackRouter.get('/token-usage', (_req: Request, res: Response) => {
  const db = getDb();

  // Get platforms that have enabled keys
  const platforms = db.prepare(`
    SELECT DISTINCT ak.platform
    FROM api_keys ak
    WHERE ak.enabled = 1
  `).all() as { platform: string }[];
  const platformSet = new Set(platforms.map(p => p.platform));

  // Get monthly budget per model, ordered by fallback priority
  const models = db.prepare(`
    SELECT m.platform, m.model_id, m.display_name, m.monthly_token_budget,
           fc.priority
    FROM models m
    JOIN fallback_config fc ON fc.model_db_id = m.id
    WHERE m.enabled = 1
    ORDER BY fc.priority ASC
  `).all() as { platform: string; model_id: string; display_name: string; monthly_token_budget: string; priority: number }[];

  function parseBudget(s: string): number {
    const m = s.match(/~?([\d.]+)(?:-([\d.]+))?([MK])?/);
    if (!m) return 0;
    const high = parseFloat(m[2] ?? m[1]);
    const unit = m[3] === 'M' ? 1_000_000 : m[3] === 'K' ? 1_000 : 1;
    return high * unit;
  }

  // Build per-model breakdown (only platforms with keys)
  const modelBudgets = models
    .filter(m => platformSet.has(m.platform))
    .map(m => ({
      displayName: m.display_name,
      platform: m.platform,
      budget: parseBudget(m.monthly_token_budget),
    }));

  const totalBudget = modelBudgets.reduce((s, m) => s + m.budget, 0);

  // Tokens used this month
  const usage = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_used
    FROM requests
    WHERE created_at >= datetime('now', 'start of month')
  `).get() as { total_used: number };

  res.json({
    totalBudget,
    totalUsed: usage.total_used,
    models: modelBudgets,
  });
});
