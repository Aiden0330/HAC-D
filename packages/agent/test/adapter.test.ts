/**
 * v6 extraction worker (PLAN_V6 §6): the OpenAI-compatible adapter's request per output mode, the Authorization header only with a
 * key, base-URL normalisation, the timeout and errors on non-2xx — with an injected fetch, no network.
 */
import { describe, it, expect } from 'vitest';
import { openaiCompatibleAdapter, adapterFromSpec, mockAdapter, chatCompletionsUrl } from '../src/index.js';

interface Call { url: string; init: RequestInit; body: Record<string, unknown>; headers: Record<string, string> }
function stub(status = 200, payload: unknown = { model: 'served-model', choices: [{ message: { content: '{"cards":[]}' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const req = { system: 'SYS', user: 'USR', jsonSchema: { type: 'object' } };

describe('openaiCompatibleAdapter', () => {
  it('json_schema mode: response_format with the schema, temperature 0, no Authorization without a key', async () => {
    const s = stub();
    const a = openaiCompatibleAdapter({ baseUrl: 'http://host:8000/v1/', model: 'qwen', fetchImpl: s.fetchImpl });
    const r = await a.complete(req);
    expect(r).toMatchObject({ text: '{"cards":[]}', model: 'served-model', usage: { promptTokens: 12, completionTokens: 3 } });
    expect(s.calls[0].url).toBe('http://host:8000/v1/chat/completions');
    expect(s.calls[0].init.method).toBe('POST');
    expect(s.calls[0].body).toEqual({
      model: 'qwen', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }], temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'evidence_cards', schema: { type: 'object' }, strict: true } },
    });
    expect(Object.keys(s.calls[0].headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(a.name).toBe('openai-compatible');
    expect(a.temperature).toBe(0);
  });
  it('guided_json mode: the schema as a top-level field; seed, max_tokens and the bearer key when given', async () => {
    const s = stub();
    const a = openaiCompatibleAdapter({ baseUrl: 'http://host:8000/v1/chat/completions', model: 'm', mode: 'guided_json', apiKey: 'sk-test', seed: 7, temperature: 0.2, headers: { 'X-Run': 'r1' }, fetchImpl: s.fetchImpl });
    await a.complete({ ...req, maxTokens: 512 });
    expect(s.calls[0].url).toBe('http://host:8000/v1/chat/completions');
    expect(s.calls[0].body).toEqual({ model: 'm', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }], temperature: 0.2, seed: 7, max_tokens: 512, guided_json: { type: 'object' } });
    expect(s.calls[0].headers.Authorization).toBe('Bearer sk-test');
    expect(s.calls[0].headers['X-Run']).toBe('r1');
    expect(a.seed).toBe(7);
  });
  it('fenced mode: nothing beyond the messages', async () => {
    const s = stub();
    await openaiCompatibleAdapter({ baseUrl: 'http://h/v1', model: 'm', mode: 'fenced', fetchImpl: s.fetchImpl }).complete(req);
    expect(Object.keys(s.calls[0].body).sort()).toEqual(['messages', 'model', 'temperature']);
  });
  it('throws on non-2xx with the status and the first 300 characters of the body, never the key', async () => {
    const s = stub(503, 'x'.repeat(1000));
    const a = openaiCompatibleAdapter({ baseUrl: 'http://h/v1', model: 'm', apiKey: 'sk-secret', fetchImpl: s.fetchImpl });
    const err = await a.complete(req).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/HTTP 503/);
    expect(err?.message).toContain('x'.repeat(300));
    expect(err?.message).not.toContain('x'.repeat(301));
    expect(err?.message).not.toContain('sk-secret');
  });
  it('throws when the response has no message content, and on timeout', async () => {
    const s = stub(200, { choices: [] });
    await expect(openaiCompatibleAdapter({ baseUrl: 'http://h', model: 'm', fetchImpl: s.fetchImpl }).complete(req)).rejects.toThrow(/no choices\[0\]\.message\.content/);
    const hang = ((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))); })) as typeof fetch;
    await expect(openaiCompatibleAdapter({ baseUrl: 'http://h', model: 'm', timeoutMs: 20, fetchImpl: hang }).complete(req)).rejects.toThrow(/timed out after 20 ms/);
  });
  it('normalises the base URL', () => {
    expect(chatCompletionsUrl('http://h:8000/v1')).toBe('http://h:8000/v1/chat/completions');
    expect(chatCompletionsUrl('http://h:8000/v1///')).toBe('http://h:8000/v1/chat/completions');
    expect(chatCompletionsUrl('http://h:8000/v1/chat/completions/')).toBe('http://h:8000/v1/chat/completions');
  });
});

describe('adapterFromSpec', () => {
  it('builds none, mock and openai-compatible adapters and checks their options', async () => {
    const none = adapterFromSpec({ provider: 'none' });
    expect(none.name).toBe('none');
    await expect(none.complete(req)).rejects.toThrow(/no model configured/);
    const mock = adapterFromSpec({ provider: 'mock', model: 'm1', mock: (r) => r.user.toUpperCase() });
    expect(await mock.complete(req)).toEqual({ text: 'USR', model: 'm1' });
    expect(adapterFromSpec({ provider: 'openai-compatible', baseUrl: 'http://h/v1', model: 'm' }).name).toBe('openai-compatible');
    expect(() => adapterFromSpec({ provider: 'openai-compatible', model: 'm' })).toThrow(/baseUrl/);
    expect(() => adapterFromSpec({ provider: 'mock' })).toThrow(/mock function/);
    expect((await mockAdapter(async () => 'x').complete(req)).model).toBe('mock');
  });
});
