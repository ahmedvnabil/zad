// Outbound-only Telegram notifications. Config comes from the DB settings
// (set via the in-app Notifications page) with env vars as a fallback. No-op
// when unconfigured or the master switch is off. Fire-and-forget — a failed
// send never throws into the caller. Never logs or returns the raw token.

import { getSetting, setSetting } from '../db/index.js';
import { encrypt, decrypt } from './crypto.js';

const API = 'https://api.telegram.org';

/** Stored bot token (decrypted) or env fallback. */
function readToken(): string | undefined {
  const raw = getSetting('telegram_bot_token');
  if (raw) {
    try {
      const p = JSON.parse(raw) as { encrypted: string; iv: string; authTag: string };
      return decrypt(p.encrypted, p.iv, p.authTag);
    } catch {
      /* fall through to env */
    }
  }
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
}

function readChatId(): string | undefined {
  return (getSetting('telegram_chat_id') || process.env.TELEGRAM_CHAT_ID || '').trim() || undefined;
}

/** Master switch — default ON when creds exist (only 'false' disables). */
function masterOn(): boolean {
  return getSetting('telegram_enabled') !== 'false';
}

function cfg(): { token: string; chatId: string } | null {
  if (!masterOn()) return null;
  const token = readToken();
  const chatId = readChatId();
  return token && chatId ? { token, chatId } : null;
}

export function isTelegramEnabled(): boolean {
  return cfg() !== null;
}

/** Safe state for the settings UI — never exposes the token itself. */
export function getTelegramState(): { master: boolean; hasToken: boolean; chatId: string; connected: boolean } {
  const hasToken = !!getSetting('telegram_bot_token') || !!process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = readChatId() ?? '';
  return { master: masterOn(), hasToken, chatId, connected: isTelegramEnabled() };
}

/** Persist config from the UI. Token is encrypted at rest; '' clears it. */
export function saveTelegramConfig(opts: { botToken?: string; chatId?: string; enabled?: boolean }): void {
  if (opts.botToken !== undefined) {
    const t = opts.botToken.trim();
    setSetting('telegram_bot_token', t === '' ? '' : JSON.stringify(encrypt(t)));
  }
  if (opts.chatId !== undefined) setSetting('telegram_chat_id', opts.chatId.trim());
  if (opts.enabled !== undefined) setSetting('telegram_enabled', opts.enabled ? 'true' : 'false');
}

/** Per-event notification toggles (default ON). */
export type TelegramEvent = 'keys' | 'providers' | 'digest' | 'errors';
export function isEventOn(ev: TelegramEvent): boolean {
  return getSetting(`telegram_ev_${ev}`) !== 'false';
}
export function setEventOn(ev: TelegramEvent, on: boolean): void {
  setSetting(`telegram_ev_${ev}`, on ? 'true' : 'false');
}
export function getEventToggles(): Record<TelegramEvent, boolean> {
  return { keys: isEventOn('keys'), providers: isEventOn('providers'), digest: isEventOn('digest'), errors: isEventOn('errors') };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Send an HTML-formatted message to the configured chat. Swallows all errors. */
export async function sendTelegram(text: string): Promise<boolean> {
  const c = cfg();
  if (!c) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${API}/bot${c.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: c.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.error(`[Telegram] sendMessage HTTP ${res.status}`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error('[Telegram] send failed:', (e as Error).message);
    return false;
  }
}
