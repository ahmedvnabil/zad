import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { fallbackRouter } from './routes/fallback.js';
import { analyticsRouter } from './routes/analytics.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { eventsRouter } from './routes/events.js';
import { integrationsRouter } from './routes/integrations.js';
import { providersRouter } from './routes/providers.js';
import { registryRouter } from './routes/registry.js';
import { errorHandler } from './middleware/errorHandler.js';
import { identify, requireOwner } from './middleware/auth.js';
import { DEMO_MODE } from './lib/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The only third-party origin the SPA loads (see client/index.html). Fonts are
// self-hosted, so this list is one entry. Keep it in step with that file — a
// CSP that lies just breaks the page.
const ANALYTICS_ORIGIN = 'https://um.zad.tools';

const DEFAULT_DASHBOARD_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
];

function getAllowedCorsOrigins() {
  const configuredOrigins = (process.env.DASHBOARD_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_DASHBOARD_ORIGINS, ...configuredOrigins]);
}

export function createApp() {
  const app = express();
  const allowedCorsOrigins = getAllowedCorsOrigins();

  // Content-Security-Policy.
  //
  // This was off for a long time with a comment saying the SPA's inline styles
  // and hashed assets made it impossible. They don't — the policy just has to
  // name what index.html actually loads, which is exactly three third parties:
  // the Google Fonts stylesheet, the font files it points at, and the Umami
  // analytics script. Everything else is same-origin.
  //
  // 'unsafe-inline' is in style-src only, never script-src: the component
  // library emits inline style attributes, but no inline <script> exists.
  //
  // Deliberately NOT set: upgrade-insecure-requests. The default deployment is
  // http://localhost, where upgrading would break the very font requests this
  // policy is allowing.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", ANALYTICS_ORIGIN],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'", 'data:'],
        'img-src': ["'self'", 'data:'],
        // Same-origin covers /api, /v1 and the SSE stream; Umami posts its
        // own beacons back to itself.
        'connect-src': ["'self'", ANALYTICS_ORIGIN],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    // Set per-request below instead — see the note there.
    hsts: false,
  }));

  // HSTS, but only for requests that actually arrived over TLS.
  //
  // Sending it unconditionally would be actively harmful: the default
  // deployment is http://localhost:3001, and a browser that sees HSTS there
  // pins *all* of localhost to https for months, breaking this and every other
  // local dev server on the machine. So it keys off the real protocol —
  // req.secure when Express terminates TLS, or the forwarded header when a
  // reverse proxy does.
  //
  // includeSubDomains is left off on purpose: self-hosters serve this from all
  // sorts of places, and asserting HSTS for an entire parent domain from one
  // app is not this app's call to make.
  app.use((req, res, next) => {
    const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
    if (req.secure || forwarded === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    }
    next();
  });
  app.use(cors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, !origin || allowedCorsOrigins.has(origin));
    },
  }));
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));

  // API routes
  // Every caller is identified once; routes then decide what they require.
  app.use(identify);

  // The control plane. These were unauthenticated until the key gate landed.
  app.use('/api/keys', requireOwner, keysRouter);
  app.use('/api/models', requireOwner, modelsRouter);
  app.use('/api/fallback', requireOwner, fallbackRouter);
  app.use('/api/analytics', requireOwner, analyticsRouter);
  app.use('/api/health', requireOwner, healthRouter);
  app.use('/api/settings', requireOwner, settingsRouter);
  app.use('/api/events', requireOwner, eventsRouter);
  app.use('/api/integrations', requireOwner, integrationsRouter);
  app.use('/api/providers', requireOwner, providersRouter);
  app.use('/api/registry', requireOwner, registryRouter);

  // OpenAI-compatible proxy
  app.use('/v1', proxyRouter);

  // Liveness + the one thing the dashboard needs before it has a key: whether
  // this deployment is the public demo. Deliberately unauthenticated.
  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', demoMode: DEMO_MODE, timestamp: new Date().toISOString() });
  });

  // Key check for the dashboard's sign-in screen: 200 with a valid key, 401
  // without. Cheaper and clearer than probing a real data route.
  app.get('/api/whoami', requireOwner, (_req, res) => {
    res.json({ signedIn: true });
  });

  // Error handler (for API routes)
  app.use(errorHandler);

  // Serve client static files (after API error handler)
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for non-API routes
  app.use((req, res, next) => {
    // API/proxy paths fall through to their routers; ACME challenges must 404
    // here so the reverse proxy serves them from disk during certificate
    // issuance and renewal, instead of getting the SPA shell.
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/v1/') ||
      req.path.startsWith('/.well-known/')
    ) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
