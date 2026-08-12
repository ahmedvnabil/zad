/**
 * Gateway authentication.
 *
 * The control plane used to be wide open: every `/api/*` route was
 * unauthenticated, so anyone who could reach the port could read or add
 * provider keys. That is the hole this closes.
 *
 * There is exactly one kind of caller — the operator, holding the unified API
 * key printed at first boot (and shown on the Keys page). It is presented as
 * `Authorization: Bearer <key>` and it gates the whole dashboard API.
 */

import type { NextFunction, Request, Response } from 'express';
import { getUnifiedApiKey } from '../db/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set when the caller presented the unified key. */
      isOwner?: boolean;
    }
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

/** Resolve the caller without rejecting; routes decide what they require. */
export function identify(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) return next();

  const unified = getUnifiedApiKey();
  if (unified && timingSafeStringEqual(token, unified)) req.isOwner = true;
  next();
}

/** Everything under /api: dashboard, provider keys, settings, analytics. */
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.isOwner) return next();
  res.status(401).json({ error: { message: 'API key required', type: 'authentication_error' } });
}
