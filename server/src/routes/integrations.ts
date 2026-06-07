import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  isTelegramEnabled,
  sendTelegram,
  getTelegramState,
  saveTelegramConfig,
  getEventToggles,
  setEventOn,
  type TelegramEvent,
} from '../lib/telegram.js';
import { demoBlock } from '../lib/demo.js';

export const integrationsRouter = Router();

const EVENTS: TelegramEvent[] = ['keys', 'providers', 'digest', 'errors'];

// Whether Telegram notifications are configured (no secrets exposed).
integrationsRouter.get('/telegram/status', (_req: Request, res: Response) => {
  res.json({ enabled: isTelegramEnabled() });
});

// Full config for the settings UI — never returns the token itself.
integrationsRouter.get('/telegram/config', (_req: Request, res: Response) => {
  const s = getTelegramState();
  res.json({
    master: s.master,
    connected: s.connected,
    hasToken: s.hasToken,
    chatId: s.chatId,
    events: getEventToggles(),
  });
});

// Save config from the UI. botToken: omit to keep current, '' to clear.
integrationsRouter.put('/telegram/config', demoBlock, (req: Request, res: Response) => {
  const b = req.body ?? {};
  saveTelegramConfig({
    botToken: typeof b.botToken === 'string' ? b.botToken : undefined,
    chatId: typeof b.chatId === 'string' ? b.chatId : undefined,
    enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
  });
  if (b.events && typeof b.events === 'object') {
    for (const ev of EVENTS) {
      if (typeof b.events[ev] === 'boolean') setEventOn(ev, b.events[ev]);
    }
  }
  const s = getTelegramState();
  res.json({ master: s.master, connected: s.connected, hasToken: s.hasToken, chatId: s.chatId, events: getEventToggles() });
});

// Send a test message to verify the bot token + chat id are wired correctly.
integrationsRouter.post('/telegram/test', demoBlock, async (_req: Request, res: Response) => {
  if (!isTelegramEnabled()) {
    res.status(400).json({ error: { message: 'تليجرام غير مُعدّ — احفظ التوكن و chat id وفعّل الإشعارات أولاً.' } });
    return;
  }
  const ok = await sendTelegram('✅ <b>زاد</b> — تم ربط إشعارات تليجرام بنجاح.');
  if (ok) res.json({ ok: true });
  else res.status(502).json({ error: { message: 'فشل إرسال رسالة الاختبار — راجع التوكن و chat id.' } });
});
