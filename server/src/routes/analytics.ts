import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { estimateCostUsd } from '../lib/pricing.js';

export const analyticsRouter = Router();

function parseBudgetTokens(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/~?([\d.]+)(?:-([\d.]+))?\s*([KMB])?/i);
  if (!match) return null;

  const amount = parseFloat(match[2] ?? match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = (match[3] ?? '').toUpperCase();
  const multiplier = unit === 'B' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

// Map range to a JS-computed ISO timestamp passed as a bind parameter,
// so the SQL string never includes user-controlled fragments.
function getSinceTimestamp(range: string): string {
  const now = Date.now();
  switch (range) {
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    case '7d':
    default:
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
}

// Summary stats
analyticsRouter.get('/summary', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      AVG(latency_ms) as avg_latency_ms
    FROM requests
    WHERE created_at >= ?
  `).get(since) as any;

  const totalRequests = stats.total_requests ?? 0;
  const successRate = totalRequests > 0 ? (stats.success_count / totalRequests) * 100 : 0;

  // Estimate cost savings using per-model equivalent paid pricing instead of one
  // flat rate, so a month of 8B traffic isn't valued like GPT-class traffic.
  const perModel = db.prepare(`
    SELECT platform, model_id,
           SUM(input_tokens) as input_tokens,
           SUM(output_tokens) as output_tokens
    FROM requests
    WHERE created_at >= ?
    GROUP BY platform, model_id
  `).all(since) as { platform: string; model_id: string; input_tokens: number; output_tokens: number }[];

  const estimatedCostSavings = perModel.reduce(
    (sum, r) => sum + estimateCostUsd(r.platform, r.model_id, r.input_tokens ?? 0, r.output_tokens ?? 0),
    0,
  );

  res.json({
    totalRequests,
    successRate: Math.round(successRate * 10) / 10,
    totalInputTokens: stats.total_input_tokens ?? 0,
    totalOutputTokens: stats.total_output_tokens ?? 0,
    avgLatencyMs: Math.round(stats.avg_latency_ms ?? 0),
    estimatedCostSavings: Math.round(estimatedCostSavings * 100) / 100,
  });
});

// Build a WHERE clause + bound params from the request-log filters. `status`,
// `platform`, and `model` are exact matches; `q` is a free-text LIKE across
// model / provider / error / response preview. All values are bound, never
// interpolated.
function buildRequestFilter(query: any): { where: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];
  const status = query.status ? String(query.status) : '';
  const platform = query.platform ? String(query.platform) : '';
  const model = query.model ? String(query.model) : '';
  const q = query.q ? String(query.q).slice(0, 200) : '';
  if (status && status !== 'all') { clauses.push('r.status = ?'); params.push(status); }
  if (platform) { clauses.push('r.platform = ?'); params.push(platform); }
  if (model) { clauses.push('r.model_id = ?'); params.push(model); }
  if (q) {
    clauses.push('(r.model_id LIKE ? OR m.display_name LIKE ? OR r.platform LIKE ? OR r.error LIKE ? OR r.response_preview LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function mapRequestRow(r: any) {
  const inputTokens = r.input_tokens ?? 0;
  const outputTokens = r.output_tokens ?? 0;
  let requestMessages: any[] | null = null;
  if (r.request_messages) { try { requestMessages = JSON.parse(r.request_messages); } catch { /* keep null */ } }
  // Prompt preview: last user message, truncated for the table/detail view.
  let promptPreview: string | null = null;
  if (requestMessages) {
    const lastUser = [...requestMessages].reverse().find((m: any) => m.role === 'user');
    const c = lastUser?.content;
    if (typeof c === 'string') promptPreview = c.slice(0, 2000);
  }
  return {
    id: r.id,
    platform: r.platform,
    modelId: r.model_id,
    displayName: r.display_name ?? r.model_id,
    status: r.status,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: Math.round(estimateCostUsd(r.platform, r.model_id, inputTokens, outputTokens) * 1e6) / 1e6,
    latencyMs: r.latency_ms ?? 0,
    error: r.error ?? null,
    createdAt: r.created_at,
    requestedModel: r.requested_model ?? null,
    messageCount: r.message_count ?? null,
    hadTools: r.had_tools === null || r.had_tools === undefined ? null : r.had_tools === 1,
    streamed: r.streamed === null || r.streamed === undefined ? null : r.streamed === 1,
    attempts: r.attempts ?? null,
    finishReason: r.finish_reason ?? null,
    requestMessages,
    promptPreview,
    responsePreview: r.response_preview ?? null,
  };
}

const REQUEST_COLUMNS = `
  r.id, r.platform, r.model_id, m.display_name, r.status,
  r.input_tokens, r.output_tokens, r.latency_ms, r.error, r.created_at,
  r.requested_model, r.message_count, r.had_tools, r.streamed,
  r.attempts, r.finish_reason, r.request_messages, r.response_preview
`;

// Reliability & quality metrics derived from the captured request metadata.
analyticsRouter.get('/quality', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const latencies = (db.prepare(`
    SELECT latency_ms FROM requests
    WHERE created_at >= ? AND status = 'success'
    ORDER BY latency_ms ASC LIMIT 50000
  `).all(since) as { latency_ms: number }[]).map(r => r.latency_ms ?? 0);
  const pct = (p: number) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] : 0;

  const att = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN attempts <= 1 THEN 1 ELSE 0 END) AS first_try
    FROM requests WHERE created_at >= ? AND attempts IS NOT NULL
  `).get(since) as { total: number; first_try: number };
  const firstTryRate = att.total > 0 ? Math.round((att.first_try / att.total) * 1000) / 10 : null;

  const finishReasons = (db.prepare(`
    SELECT finish_reason AS reason, COUNT(*) AS count
    FROM requests WHERE created_at >= ? AND finish_reason IS NOT NULL
    GROUP BY finish_reason ORDER BY count DESC
  `).all(since) as { reason: string; count: number }[]);

  res.json({
    p50LatencyMs: pct(50),
    p95LatencyMs: pct(95),
    firstTryRate,
    finishReasons,
  });
});

// Recent request log (newest first), filterable + paginated, for the live view.
analyticsRouter.get('/requests', (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
  const db = getDb();
  const { where, params } = buildRequestFilter(req.query);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM requests r LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`
    SELECT ${REQUEST_COLUMNS}
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    ${where}
    ORDER BY r.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  res.json({ total, limit, offset, requests: rows.map(mapRequestRow) });
});

// Export the filtered request log as CSV or JSON (capped at 5000 rows).
analyticsRouter.get('/requests/export', (req: Request, res: Response) => {
  const format = String(req.query.format ?? 'csv').toLowerCase();
  const db = getDb();
  const { where, params } = buildRequestFilter(req.query);
  const rows = (db.prepare(`
    SELECT ${REQUEST_COLUMNS}
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    ${where}
    ORDER BY r.id DESC
    LIMIT 5000
  `).all(...params) as any[]).map(mapRequestRow);

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="requests.json"');
    res.json(rows);
    return;
  }

  const cols = ['id', 'createdAt', 'status', 'platform', 'modelId', 'requestedModel', 'attempts', 'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostUsd', 'latencyMs', 'finishReason', 'hadTools', 'streamed', 'error'];
  const esc = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc((r as any)[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="requests.csv"');
  res.send(csv);
});

// Stats grouped by model
analyticsRouter.get('/by-model', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      r.platform,
      r.model_id,
      m.display_name,
      COUNT(*) as requests,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(r.latency_ms) as avg_latency_ms,
      SUM(r.input_tokens) as total_input_tokens,
      SUM(r.output_tokens) as total_output_tokens
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    WHERE r.created_at >= ?
    GROUP BY r.platform, r.model_id
    ORDER BY requests DESC
  `).all(since) as any[];

  res.json(rows.map(r => ({
    platform: r.platform,
    modelId: r.model_id,
    displayName: r.display_name ?? r.model_id,
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

// Stats grouped by platform
analyticsRouter.get('/by-platform', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      platform,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(latency_ms) as avg_latency_ms,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens
    FROM requests
    WHERE created_at >= ?
    GROUP BY platform
    ORDER BY requests DESC
  `).all(since) as any[];

  res.json(rows.map(r => ({
    platform: r.platform,
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

// Monthly usage vs catalog budgets, grouped by provider.
analyticsRouter.get('/provider-usage', (_req: Request, res: Response) => {
  const db = getDb();

  const modelRows = db.prepare(`
    SELECT platform, monthly_token_budget
    FROM models
    WHERE enabled = 1
  `).all() as { platform: string; monthly_token_budget: string }[];

  const usageRows = db.prepare(`
    SELECT
      platform,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens
    FROM requests
    WHERE created_at >= datetime('now', 'start of month')
    GROUP BY platform
  `).all() as any[];

  const keyRows = db.prepare(`
    SELECT
      platform,
      COUNT(*) as key_count,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_key_count,
      SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy_key_count
    FROM api_keys
    GROUP BY platform
  `).all() as any[];

  const platforms = new Set<string>();
  const budgets = new Map<string, { tokens: number; labels: Set<string> }>();
  for (const row of modelRows) {
    platforms.add(row.platform);
    const parsed = parseBudgetTokens(row.monthly_token_budget);
    if (parsed === null) continue;
    const entry = budgets.get(row.platform) ?? { tokens: 0, labels: new Set<string>() };
    entry.tokens += parsed;
    entry.labels.add(row.monthly_token_budget);
    budgets.set(row.platform, entry);
  }

  const usage = new Map(usageRows.map(row => [row.platform, row]));
  const keys = new Map(keyRows.map(row => [row.platform, row]));
  for (const row of usageRows) platforms.add(row.platform);
  for (const row of keyRows) platforms.add(row.platform);

  const result = Array.from(platforms).sort().map(platform => {
    const u = usage.get(platform) ?? {};
    const k = keys.get(platform) ?? {};
    const inputTokens = u.input_tokens ?? 0;
    const outputTokens = u.output_tokens ?? 0;
    const usedTokens = inputTokens + outputTokens;
    const budget = budgets.get(platform);
    const budgetTokens = budget?.tokens ?? null;
    const remainingTokens = budgetTokens === null ? null : Math.max(0, budgetTokens - usedTokens);
    const usedPercent = budgetTokens && budgetTokens > 0
      ? Math.min(100, Math.round((usedTokens / budgetTokens) * 1000) / 10)
      : null;

    return {
      platform,
      requests: u.requests ?? 0,
      successCount: u.success_count ?? 0,
      inputTokens,
      outputTokens,
      usedTokens,
      budgetTokens,
      remainingTokens,
      usedPercent,
      budgetLabels: budget ? Array.from(budget.labels).sort() : [],
      keyCount: k.key_count ?? 0,
      enabledKeyCount: k.enabled_key_count ?? 0,
      healthyKeyCount: k.healthy_key_count ?? 0,
    };
  });

  res.json(result);
});

// Timeline data
analyticsRouter.get('/timeline', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const interval = (req.query.interval as string) ?? (range === '24h' ? 'hour' : 'day');
  const since = getSinceTimestamp(range);
  const db = getDb();

  // dateFormat is a hardcoded whitelist — never user-controlled.
  const dateFormat = interval === 'hour' ? '%Y-%m-%dT%H:00:00' : '%Y-%m-%d';

  const rows = db.prepare(`
    SELECT
      strftime('${dateFormat}', created_at) as timestamp,
      COUNT(*) as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failure_count
    FROM requests
    WHERE created_at >= ?
    GROUP BY strftime('${dateFormat}', created_at)
    ORDER BY timestamp ASC
  `).all(since) as any[];

  res.json(rows.map(r => ({
    timestamp: r.timestamp,
    requests: r.requests,
    successCount: r.success_count,
    failureCount: r.failure_count,
  })));
});

// Error distribution (grouped by error type and platform)
analyticsRouter.get('/error-distribution', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  // Group errors by category (extract the key part of the error message)
  const rows = db.prepare(`
    SELECT
      platform,
      model_id,
      CASE
        WHEN error LIKE '%429%' OR error LIKE '%rate limit%' OR error LIKE '%too many%' OR error LIKE '%quota%' THEN 'Rate Limited (429)'
        WHEN error LIKE '%401%' OR error LIKE '%unauthorized%' OR error LIKE '%invalid.*key%' THEN 'Auth Error (401)'
        WHEN error LIKE '%403%' OR error LIKE '%forbidden%' THEN 'Forbidden (403)'
        WHEN error LIKE '%404%' OR error LIKE '%not found%' THEN 'Not Found (404)'
        WHEN error LIKE '%timeout%' OR error LIKE '%ETIMEDOUT%' OR error LIKE '%ECONNREFUSED%' THEN 'Timeout/Connection'
        WHEN error LIKE '%500%' OR error LIKE '%internal server%' THEN 'Server Error (500)'
        WHEN error LIKE '%503%' OR error LIKE '%unavailable%' THEN 'Unavailable (503)'
        ELSE 'Other'
      END as error_category,
      COUNT(*) as count
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    GROUP BY platform, error_category
    ORDER BY count DESC
  `).all(since) as any[];

  // Also get totals by category
  const byCategory = db.prepare(`
    SELECT
      CASE
        WHEN error LIKE '%429%' OR error LIKE '%rate limit%' OR error LIKE '%too many%' OR error LIKE '%quota%' THEN 'Rate Limited (429)'
        WHEN error LIKE '%401%' OR error LIKE '%unauthorized%' OR error LIKE '%invalid.*key%' THEN 'Auth Error (401)'
        WHEN error LIKE '%403%' OR error LIKE '%forbidden%' THEN 'Forbidden (403)'
        WHEN error LIKE '%404%' OR error LIKE '%not found%' THEN 'Not Found (404)'
        WHEN error LIKE '%timeout%' OR error LIKE '%ETIMEDOUT%' OR error LIKE '%ECONNREFUSED%' THEN 'Timeout/Connection'
        WHEN error LIKE '%500%' OR error LIKE '%internal server%' THEN 'Server Error (500)'
        WHEN error LIKE '%503%' OR error LIKE '%unavailable%' THEN 'Unavailable (503)'
        ELSE 'Other'
      END as category,
      COUNT(*) as count
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    GROUP BY category
    ORDER BY count DESC
  `).all(since) as any[];

  // Errors by platform
  const byPlatform = db.prepare(`
    SELECT platform, COUNT(*) as count
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    GROUP BY platform
    ORDER BY count DESC
  `).all(since) as any[];

  res.json({
    byCategory,
    byPlatform,
    detailed: rows,
  });
});

// Recent errors
analyticsRouter.get('/errors', (req: Request, res: Response) => {
  const range = (req.query.range as string) ?? '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();

  const rows = db.prepare(`
    SELECT id, platform, model_id, error, latency_ms, created_at
    FROM requests
    WHERE status = 'error' AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(since) as any[];

  res.json(rows.map(r => ({
    id: r.id,
    platform: r.platform,
    modelId: r.model_id,
    error: r.error,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  })));
});
