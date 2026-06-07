import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb, getUnifiedApiKey, regenerateUnifiedKey, getSetting, setSetting } from '../db/index.js';

export const settingsRouter = Router();

// Get the unified API key
settingsRouter.get('/api-key', (_req: Request, res: Response) => {
  res.json({ apiKey: getUnifiedApiKey() });
});

// Regenerate the unified API key
settingsRouter.post('/api-key/regenerate', (_req: Request, res: Response) => {
  const newKey = regenerateUnifiedKey();
  res.json({ apiKey: newKey });
});

// Auto-optimize: when on, a background job re-applies the credit/capability
// optimal fallback order periodically (see services/autoOptimize.ts).
settingsRouter.get('/auto-optimize', (_req: Request, res: Response) => {
  res.json({ enabled: getSetting('auto_optimize') === 'true' });
});

settingsRouter.put('/auto-optimize', (req: Request, res: Response) => {
  const enabled = req.body?.enabled === true;
  setSetting('auto_optimize', enabled ? 'true' : 'false');
  res.json({ enabled });
});

// Capture content: when on, the proxy stores each request's full messages (for
// replay) and a truncated response preview. Off by default (privacy + size).
settingsRouter.get('/capture-content', (_req: Request, res: Response) => {
  res.json({ enabled: getSetting('capture_content') === 'true' });
});

settingsRouter.put('/capture-content', (req: Request, res: Response) => {
  const enabled = req.body?.enabled === true;
  setSetting('capture_content', enabled ? 'true' : 'false');
  res.json({ enabled });
});

// Wipe any stored request/response content (keeps the rows + metrics).
settingsRouter.post('/clear-request-content', (_req: Request, res: Response) => {
  const info = getDb().prepare('UPDATE requests SET request_messages = NULL, response_preview = NULL').run();
  res.json({ cleared: info.changes });
});

// Budget guard: when on, a background job auto-disables providers that have
// burned through their estimated monthly free budget, and re-enables them when
// they recover (see services/budgetGuard.ts).
settingsRouter.get('/budget-guard', (_req: Request, res: Response) => {
  res.json({ enabled: getSetting('budget_guard') === 'true' });
});

settingsRouter.put('/budget-guard', (req: Request, res: Response) => {
  const enabled = req.body?.enabled === true;
  setSetting('budget_guard', enabled ? 'true' : 'false');
  res.json({ enabled });
});
