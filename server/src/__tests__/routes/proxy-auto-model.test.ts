import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb, getUnifiedApiKey } from '../../db/index.js';

async function request(app: Express, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${getUnifiedApiKey()}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.text();
  server.close();

  let json: any = null;
  try { json = JSON.parse(data); } catch {}

  return { status: res.status, body: json, headers: res.headers, raw: data };
}

function authHeaders() {
  return { Authorization: `Bearer ${getUnifiedApiKey()}` };
}

describe('Virtual "auto" model', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  beforeEach(async () => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM requests').run();

    const addKey = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_auto_model_test',
      label: 'auto-model',
    });
    expect(addKey.status).toBe(201);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists "auto" as the first /v1/models entry', async () => {
    const { status, body } = await request(app, 'GET', '/v1/models');
    expect(status).toBe(200);
    expect(body.object).toBe('list');
    expect(body.data[0]).toMatchObject({
      id: 'auto',
      object: 'model',
      owned_by: 'zad',
    });
    // Real catalog models still follow.
    expect(body.data.length).toBeGreaterThan(1);
  });

  it('exposes capability metadata for /v1/models entries', async () => {
    const { status, body } = await request(app, 'GET', '/v1/models');
    expect(status).toBe(200);

    const autoModel = body.data.find((m: any) => m.id === 'auto');
    expect(autoModel).toMatchObject({
      input_modalities: ['text'],
      output_modalities: ['text'],
      capabilities: {
        text: true,
        tool_calling: true,
        image_input: false,
        image_output: false,
        audio_input: false,
        audio_output: false,
      },
    });
    expect(autoModel.features).toContain('auto-routing');

    // Skip the virtual auto/auto:<profile> entries — pick a real catalog model.
    const realModel = body.data.find((m: any) => !String(m.id).startsWith('auto'));
    expect(realModel.context_window).toBeTypeOf('number');
    expect(realModel).toHaveProperty('input_modalities');
    expect(realModel).toHaveProperty('output_modalities');
    expect(realModel).toHaveProperty('capabilities');
    expect(realModel).toHaveProperty('features');
    expect(realModel.capabilities).toHaveProperty('tool_calling');

    // Virtual capability/ordering profiles are advertised too.
    const tools = body.data.find((m: any) => m.id === 'auto:tools');
    expect(tools?.capabilities?.tool_calling).toBe(true);
    expect(body.data.some((m: any) => m.id === 'auto:cheap')).toBe(true);
  });

  it('treats model:"auto" as auto-route instead of a 400', async () => {
    const origFetch = global.fetch;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-auto',
            object: 'chat.completion',
            created: 123,
            model: 'openai/gpt-oss-120b',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'routed via auto' },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/chat/completions', {
      model: 'auto',
      messages: [{ role: 'user', content: 'hello' }],
    }, authHeaders());

    expect(status).toBe(200);
    expect(body.choices[0].message.content).toBe('routed via auto');
  });

  it('still rejects an unknown model with model_not_found', async () => {
    const { status, body } = await request(app, 'POST', '/v1/chat/completions', {
      model: 'definitely-not-a-real-model',
      messages: [{ role: 'user', content: 'hello' }],
    }, authHeaders());

    expect(status).toBe(400);
    expect(body.error.code).toBe('model_not_found');
  });
});
