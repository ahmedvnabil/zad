// Telegram notification orchestration (outbound only). Wires four event types:
//   1) new key added + validation result        (called from the ingest route)
//   2) provider down / recovered                (called from the health checker)
//   3) daily digest                             (scheduled)
//   4) error spike                              (scheduled, de-duped)
// Everything is a no-op when Telegram isn't configured.

import { getDb } from '../db/index.js';
import { estimateCostUsd } from '../lib/pricing.js';
import { sendTelegram, isTelegramEnabled, escapeHtml, isEventOn } from '../lib/telegram.js';

// ---- 1) new key result ----------------------------------------------------

export function notifyKeyResult(platform: string, masked: string, status: string): void {
  if (!isTelegramEnabled() || !isEventOn('keys')) return;
  const ok = status === 'healthy';
  const emoji = ok ? '✅' : status === 'invalid' ? '❌' : '⚠️';
  const verdict = ok ? 'يعمل' : status === 'invalid' ? 'غير صالح' : 'تعذّر التحقق';
  void sendTelegram(
    `🔑 <b>مفتاح جديد</b>\n` +
    `المزوّد: <b>${escapeHtml(platform)}</b>\n` +
    `المفتاح: <code>${escapeHtml(masked)}</code>\n` +
    `الحالة: ${emoji} ${verdict}`,
  );
}

// ---- 2) provider down / recovered -----------------------------------------

// Per-platform "has at least one healthy enabled key" — notify only on flips.
const platformHealthy = new Map<string, boolean>();

export function notifyKeyStatusChange(platform: string, prev: string, next: string): void {
  if (!isTelegramEnabled() || !isEventOn('providers') || prev === next) return;
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM api_keys WHERE platform = ? AND enabled = 1 AND status = 'healthy'")
    .get(platform) as { c: number };
  const nowHealthy = row.c > 0;

  const was = platformHealthy.get(platform);
  if (was === undefined) {
    // First observation per platform — set baseline, don't notify (avoids boot spam).
    platformHealthy.set(platform, nowHealthy);
    return;
  }
  if (was !== nowHealthy) {
    platformHealthy.set(platform, nowHealthy);
    void sendTelegram(
      nowHealthy
        ? `🟢 <b>مزوّد رجع يعمل</b>: ${escapeHtml(platform)}`
        : `🔴 <b>مزوّد توقف</b>: ${escapeHtml(platform)} — مفيش مفاتيح صالحة دلوقتي`,
    );
  }
}

// ---- 3) daily digest + 4) error spike (scheduled) -------------------------

const DIGEST_HOUR = Number(process.env.TELEGRAM_DIGEST_HOUR ?? 9); // local hour
let lastDigestDate = '';          // YYYY-MM-DD already sent
let lastSpikeAt = 0;              // epoch ms of last spike alert (1/hour cap)

function buildDigest(): string {
  const db = getDb();
  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success
    FROM requests WHERE created_at >= datetime('now', '-1 day')
  `).get() as { total: number; success: number };

  const total = totals.total ?? 0;
  const success = totals.success ?? 0;
  const rate = total > 0 ? Math.round((success / total) * 1000) / 10 : 0;

  // Estimated savings vs paid, per (platform, model) over the last day.
  const perModel = db.prepare(`
    SELECT platform, model_id,
           SUM(COALESCE(input_tokens, 0)) AS inTok,
           SUM(COALESCE(output_tokens, 0)) AS outTok
    FROM requests
    WHERE created_at >= datetime('now', '-1 day') AND status = 'success'
    GROUP BY platform, model_id
  `).all() as { platform: string; model_id: string; inTok: number; outTok: number }[];
  const savings = perModel.reduce(
    (s, m) => s + estimateCostUsd(m.platform, m.model_id, m.inTok, m.outTok),
    0,
  );

  const topProviders = db.prepare(`
    SELECT platform, COUNT(*) AS c
    FROM requests WHERE created_at >= datetime('now', '-1 day')
    GROUP BY platform ORDER BY c DESC LIMIT 3
  `).all() as { platform: string; c: number }[];

  const top = topProviders.length
    ? topProviders.map(p => `• ${escapeHtml(p.platform)} — ${p.c}`).join('\n')
    : '—';

  return (
    `📊 <b>ملخص زاد اليومي</b> (آخر 24 ساعة)\n\n` +
    `الطلبات: <b>${total}</b>\n` +
    `نسبة النجاح: <b>${rate}%</b>\n` +
    `التوفير التقديري: <b>$${savings.toFixed(2)}</b>\n\n` +
    `أعلى المزوّدين:\n${top}`
  );
}

function dailyDigestTick(now: Date): void {
  if (!isTelegramEnabled() || !isEventOn('digest')) return;
  const date = now.toISOString().slice(0, 10);
  if (now.getHours() === DIGEST_HOUR && lastDigestDate !== date) {
    lastDigestDate = date;
    void sendTelegram(buildDigest());
  }
}

function errorSpikeTick(nowMs: number): void {
  if (!isTelegramEnabled() || !isEventOn('errors')) return;
  const db = getDb();
  const r = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS failed
    FROM requests WHERE created_at >= datetime('now', '-30 minutes')
  `).get() as { total: number; failed: number };

  const total = r.total ?? 0;
  const failed = r.failed ?? 0;
  if (total < 20) return; // not enough traffic to judge
  const rate = (failed / total) * 100;
  if (rate < 40) return;
  if (nowMs - lastSpikeAt < 60 * 60 * 1000) return; // at most once/hour
  lastSpikeAt = nowMs;
  void sendTelegram(
    `🚨 <b>طفرة أخطاء</b>\n` +
    `آخر 30 دقيقة: <b>${Math.round(rate)}%</b> فشل (${failed}/${total} طلب).`,
  );
}

let started = false;

export function startNotificationJobs(): void {
  if (started) return;
  started = true;
  if (!isTelegramEnabled()) {
    console.log('[Notify] Telegram not configured — notifications disabled.');
    return;
  }
  console.log('[Notify] Telegram notifications enabled.');
  // Daily digest: re-check each hour, send once when the hour matches.
  setInterval(() => dailyDigestTick(new Date()), 60 * 60 * 1000);
  // Error spike: poll every 15 min (1/hour cap on alerts).
  setInterval(() => errorSpikeTick(Date.now()), 15 * 60 * 1000);
}
