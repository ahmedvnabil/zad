// Public-demo helpers: feature flag, SSRF guard for user-supplied URLs,
// and a middleware that blocks sensitive mutations when running as a demo.
import type { Request, Response, NextFunction } from 'express';

export const DEMO_MODE = process.env.DEMO_MODE === 'true';

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.internal$/i,
  /\.local$/i,
  /^metadata\.google\.internal$/i,
];

function isBlockedIp(host: string): boolean {
  // IPv6 loopback / unique-local / link-local
  if (host === '::1' || /^f[cd]/i.test(host) || /^fe80/i.test(host)) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 127 || a === 10) return true;            // this-host, loopback, private
  if (a === 169 && b === 254) return true;                       // link-local + cloud metadata (169.254.169.254)
  if (a === 192 && b === 168) return true;                       // private
  if (a === 172 && b >= 16 && b <= 31) return true;              // private
  if (a >= 224) return true;                                     // multicast / reserved
  return false;
}

/**
 * Throws if the URL targets a private / loopback / link-local / metadata host.
 * Best-effort SSRF guard on user-supplied provider base URLs (literal-IP + known names).
 */
export function assertPublicUrl(rawUrl: string): void {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw new Error('رابط غير صالح');
  }
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host)) || isBlockedIp(host)) {
    throw new Error('غير مسموح بعنوان داخلي/خاص — استخدم رابطاً عامّاً فقط');
  }
}

/** Express middleware: 403s the request when running as a public demo. */
export function demoBlock(_req: Request, res: Response, next: NextFunction): void {
  if (DEMO_MODE) {
    res.status(403).json({
      ok: false,
      data: null,
      error: 'هذه العملية معطّلة في النسخة التجريبية العامة',
      code: 'DEMO_DISABLED',
    });
    return;
  }
  next();
}
