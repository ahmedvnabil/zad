import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';

async function request(app: Express, method: string, path: string, body?: any) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('Fallback API', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  it('GET /api/fallback returns fallback chain', async () => {
    const { status, body } = await request(app, 'GET', '/api/fallback');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Should be sorted by priority
    for (let i = 1; i < body.length; i++) {
      expect(body[i].priority).toBeGreaterThanOrEqual(body[i - 1].priority);
    }
  });

  it('GET /api/fallback entries have expected fields', async () => {
    const { body } = await request(app, 'GET', '/api/fallback');
    const first = body[0];
    expect(first).toHaveProperty('modelDbId');
    expect(first).toHaveProperty('priority');
    expect(first).toHaveProperty('enabled');
    expect(first).toHaveProperty('platform');
    expect(first).toHaveProperty('displayName');
    expect(first).toHaveProperty('intelligenceRank');
  });

  it('GET /api/fallback entries expose model metadata for the UI', async () => {
    const { body } = await request(app, 'GET', '/api/fallback');
    const first = body[0];
    expect(first).toHaveProperty('contextWindow');
    expect(first).toHaveProperty('inputModalities');
    expect(first).toHaveProperty('outputModalities');
    expect(first).toHaveProperty('capabilities');
    expect(first.capabilities).toHaveProperty('text');
    expect(first.capabilities).toHaveProperty('toolCalling');
    expect(first.capabilities).toHaveProperty('imageInput');
    expect(first.capabilities).toHaveProperty('imageOutput');
    expect(first.capabilities).toHaveProperty('audioInput');
    expect(first.capabilities).toHaveProperty('audioOutput');
    expect(first).toHaveProperty('features');
  });

  it('PUT /api/fallback updates order', async () => {
    const { body: original } = await request(app, 'GET', '/api/fallback');

    // Reverse the order
    const reversed = original.map((e: any, i: number) => ({
      modelDbId: e.modelDbId,
      priority: original.length - i,
      enabled: e.enabled,
    }));

    const { status } = await request(app, 'PUT', '/api/fallback', reversed);
    expect(status).toBe(200);

    // Verify order changed
    const { body: after } = await request(app, 'GET', '/api/fallback');
    expect(after[0].modelDbId).toBe(original[original.length - 1].modelDbId);

    // Restore original order
    const restore = original.map((e: any, i: number) => ({
      modelDbId: e.modelDbId,
      priority: i + 1,
      enabled: e.enabled,
    }));
    await request(app, 'PUT', '/api/fallback', restore);
  });

  it('POST /api/fallback/sort/intelligence sorts by intelligence', async () => {
    const { status } = await request(app, 'POST', '/api/fallback/sort/intelligence');
    expect(status).toBe(200);

    const { body } = await request(app, 'GET', '/api/fallback');
    // Should be sorted ascending by intelligence rank
    for (let i = 1; i < body.length; i++) {
      expect(body[i].intelligenceRank).toBeGreaterThanOrEqual(body[i - 1].intelligenceRank);
    }
  });

  it('POST /api/fallback/sort/speed sorts by speed', async () => {
    const { status } = await request(app, 'POST', '/api/fallback/sort/speed');
    expect(status).toBe(200);

    const { body } = await request(app, 'GET', '/api/fallback');
    // Should be sorted ascending by speed rank
    for (let i = 1; i < body.length; i++) {
      expect(body[i].speedRank).toBeGreaterThanOrEqual(body[i - 1].speedRank);
    }
  });

  it('POST /api/fallback/sort/invalid returns 400', async () => {
    const { status } = await request(app, 'POST', '/api/fallback/sort/invalid');
    expect(status).toBe(400);
  });

  it('GET /api/fallback/optimize returns a complete order plus tips', async () => {
    const { status, body } = await request(app, 'GET', '/api/fallback/optimize');
    expect(status).toBe(200);
    expect(Array.isArray(body.order)).toBe(true);
    expect(Array.isArray(body.tips)).toBe(true);

    // Every model is assigned exactly one contiguous priority 1..N.
    const { body: chain } = await request(app, 'GET', '/api/fallback');
    expect(body.order.length).toBe(chain.length);
    const priorities = body.order.map((o: any) => o.priority).sort((a: number, b: number) => a - b);
    expect(priorities).toEqual(Array.from({ length: chain.length }, (_, i) => i + 1));
    const ids = new Set(body.order.map((o: any) => o.modelDbId));
    expect(ids.size).toBe(chain.length);

    // Each order entry has the shape the PUT endpoint accepts.
    for (const o of body.order) {
      expect(o).toHaveProperty('modelDbId');
      expect(o).toHaveProperty('priority');
      expect(typeof o.enabled).toBe('boolean');
    }
    // Tips, when present, carry a severity level and text.
    for (const t of body.tips) {
      expect(['good', 'warn', 'info']).toContain(t.level);
      expect(typeof t.text).toBe('string');
    }
  });
});
