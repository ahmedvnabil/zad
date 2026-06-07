import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { hasProvider } from '../providers/index.js';
import { priceFor } from '../lib/pricing.js';
import { getPricingMeta, rateFor } from '../lib/litellm-pricing.js';

export const modelsRouter = Router();

// Pricing source freshness: how many catalog models got a real LiteLLM rate
// vs. the heuristic fallback, plus when the table was last refreshed.
modelsRouter.get('/pricing-meta', (_req: Request, res: Response) => {
  const db = getDb();
  const ids = db.prepare(`SELECT model_id FROM models`).all() as { model_id: string }[];
  const total = ids.length;
  const matched = ids.filter(r => rateFor(r.model_id) != null).length;
  res.json({ ...getPricingMeta(), source_url: 'BerriAI/litellm', totalModels: total, matchedModels: matched });
});

// List all models with availability info
modelsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const models = db.prepare(`
    SELECT m.*, fc.priority, fc.enabled as fallback_enabled
    FROM models m
    LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
    ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC
  `).all() as any[];

  // Count keys per platform
  const keyCounts = db.prepare(`
    SELECT platform, COUNT(*) as count
    FROM api_keys
    WHERE enabled = 1
    GROUP BY platform
  `).all() as { platform: string; count: number }[];

  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));

  const result = models.map(m => ({
    id: m.id,
    platform: m.platform,
    modelId: m.model_id,
    displayName: m.display_name,
    intelligenceRank: m.intelligence_rank,
    speedRank: m.speed_rank,
    sizeLabel: m.size_label,
    rpmLimit: m.rpm_limit,
    rpdLimit: m.rpd_limit,
    tpmLimit: m.tpm_limit,
    tpdLimit: m.tpd_limit,
    monthlyTokenBudget: m.monthly_token_budget,
    contextWindow: m.context_window,
    enabled: m.enabled === 1,
    priority: m.priority,
    fallbackEnabled: m.fallback_enabled === 1,
    hasProvider: hasProvider(m.platform),
    keyCount: keyCountMap.get(m.platform) ?? 0,
    // Hypothetical commercial price for an equivalent-quality model, USD/1M
    // tokens. Free here is $0 — this is what the same model class would cost
    // on a comparable paid API, powering the "free vs paid" overview.
    paidEquivalent: priceFor(m.platform, m.model_id),
  }));

  res.json(result);
});
