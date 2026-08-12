/**
 * The control plane is closed.
 *
 * Every `/api/*` route used to be unauthenticated: anyone who could reach the
 * port could list provider keys, add their own, or read the unified key out of
 * settings. These tests exist so that never silently comes back — a missing
 * `requireOwner` on a new router shows up here as a 200 where a 401 belongs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getUnifiedApiKey } from '../../db/index.js';

async function head(app: Express, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const addr = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { headers });
  await res.text();
  server.close();
  return res.headers;
}

async function request(app: Express, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const addr = server.address() as { port: number };
  // `/api/events` is an open SSE stream: with a valid key the body never ends,
  // so reading it to completion would hang the test rather than fail it.
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    headers,
    signal: controller.signal,
  });
  let json: any = null;
  if (STREAMING.has(path) && res.ok) {
    controller.abort();
  } else {
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  }
  server.close();
  return { status: res.status, body: json };
}

// Every mounted control-plane router. Add new ones here.
const GUARDED = [
  '/api/keys',
  '/api/models',
  '/api/fallback',
  '/api/analytics/summary',
  '/api/health',
  '/api/settings/api-key',
  '/api/events',
  '/api/integrations',
  '/api/providers',
  '/api/registry/stats',
  '/api/whoami',
];

const STREAMING = new Set(['/api/events']);

let app: Express;
let apiKey: string;

beforeAll(() => {
  initDb(':memory:');
  app = createApp();
  apiKey = getUnifiedApiKey();
});

describe('control plane authentication', () => {
  it('rejects every /api route without a key', async () => {
    for (const path of GUARDED) {
      const res = await request(app, path);
      expect(res.status, `${path} should require a key`).toBe(401);
    }
  });

  it('rejects a wrong key', async () => {
    for (const path of GUARDED) {
      const res = await request(app, path, { Authorization: 'Bearer zad-not-the-real-key' });
      expect(res.status, `${path} should reject a bad key`).toBe(401);
    }
  });

  it('lets the real key through', async () => {
    for (const path of GUARDED) {
      const res = await request(app, path, { Authorization: `Bearer ${apiKey}` });
      expect(res.status, `${path} should accept the unified key`).not.toBe(401);
    }
  });

  it('never leaks the unified key to an unauthenticated caller', async () => {
    const res = await request(app, '/api/settings/api-key');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });
});

describe('public endpoints stay public', () => {
  it('serves /api/ping without a key, including the demo flag', async () => {
    const res = await request(app, '/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('demoMode');
    // It is a liveness probe, not a back door.
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });
});

describe('whoami backs the dashboard sign-in screen', () => {
  it('answers 401 without a key and 200 with one', async () => {
    expect((await request(app, '/api/whoami')).status).toBe(401);
    const ok = await request(app, '/api/whoami', { Authorization: `Bearer ${apiKey}` });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ signedIn: true });
  });
});

describe('security headers', () => {
  it('sends a CSP that allows only what index.html actually loads', async () => {
    const csp = (await head(app, '/')).get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");

    // Scripts: same origin plus the analytics host in index.html. Inline and
    // eval must never be allowed here — that is the whole point of the policy.
    expect(csp).toContain("script-src 'self' https://um.zad.tools");
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src ')) ?? '';
    expect(scriptSrc).not.toContain ("'unsafe-inline'");
    expect(scriptSrc).not.toContain ("'unsafe-eval'");

    // Fonts are self-hosted, so no external font origin should be trusted.
    // If someone re-adds a CDN font, this fails and they have to decide
    // deliberately to widen the policy again.
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('fonts.gstatic.com');
    expect(csp).toContain("font-src 'self'");

    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    // Would break font loading for anyone self-hosting over plain HTTP.
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('sends HSTS only when the request actually arrived over TLS', async () => {
    // Plain HTTP — the default localhost deployment. Sending HSTS here would
    // pin the browser to https://localhost and break every local dev server.
    expect((await head(app, '/')).get('strict-transport-security')).toBeNull();

    // Behind a TLS-terminating reverse proxy.
    const viaProxy = await head(app, '/', { 'X-Forwarded-Proto': 'https' });
    expect(viaProxy.get('strict-transport-security')).toMatch(/max-age=\d+/);
  });
});
