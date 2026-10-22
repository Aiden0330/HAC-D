/**
 * Model adapters of the v6 extraction worker (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §6): an OpenAI-compatible chat-completions
 * client for the on-prem server (vLLM, SGLang, llama.cpp server) with three ways of constraining the output — `json_schema`
 * (response_format), `guided_json` (vLLM's extra field) and `fenced` (prompt only, the parser and the retry do the rest) — a mock
 * adapter for tests and dry runs, and a `none` adapter that refuses every call so that the deterministic steps run without a model.
 * Only the global `fetch` is used; the API key goes into the Authorization header and nowhere else.
 */
import type { Adapter, AdapterSpec, CompletionRequest, CompletionResult } from './types.js';

export type OutputMode = 'json_schema' | 'guided_json' | 'fenced';
export interface OpenAICompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  mode?: OutputMode;
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/** `${baseUrl}/chat/completions`, trailing slashes stripped; a base URL that already ends with /chat/completions is used as is */
export function chatCompletionsUrl(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
}

/** the request body of one call (exported for tests and for logging the shape without the key) */
export function chatCompletionsBody(o: Pick<OpenAICompatibleOptions, 'model' | 'mode' | 'temperature' | 'seed'>, req: CompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: o.model,
    messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
    temperature: req.temperature ?? o.temperature ?? 0,
  };
  const seed = req.seed ?? o.seed;
  if (seed !== undefined) body.seed = seed;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  const mode = o.mode ?? 'json_schema';
  if (req.jsonSchema !== undefined) {
    if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'evidence_cards', schema: req.jsonSchema, strict: true } };
    else if (mode === 'guided_json') body.guided_json = req.jsonSchema;
  }
  return body;
}

interface ChatResponse { model?: unknown; choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

export function openaiCompatibleAdapter(o: OpenAICompatibleOptions): Adapter {
  if (!o.baseUrl) throw new Error('openai-compatible adapter: baseUrl is required');
  if (!o.model) throw new Error('openai-compatible adapter: model is required');
  const url = chatCompletionsUrl(o.baseUrl);
  const timeoutMs = o.timeoutMs ?? 120_000;
  return {
    name: 'openai-compatible',
    model: o.model,
    temperature: o.temperature ?? 0,
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const f = o.fetchImpl ?? globalThis.fetch;
      if (typeof f !== 'function') throw new Error('openai-compatible adapter: no fetch available (Node ≥ 20 has a global fetch)');
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(o.headers ?? {}) };
      if (o.apiKey) headers.Authorization = `Bearer ${o.apiKey}`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await f(url, { method: 'POST', headers, body: JSON.stringify(chatCompletionsBody(o, req)), signal: ctl.signal });
      } catch (e) {
        if (ctl.signal.aborted) throw new Error(`model call to ${url} timed out after ${timeoutMs} ms`);
        throw new Error(`model call to ${url} failed: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`model call to ${url} returned HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as ChatResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error(`model call to ${url}: the response has no choices[0].message.content`);
      const promptTokens = num(json.usage?.prompt_tokens), completionTokens = num(json.usage?.completion_tokens);
      return {
        text: content,
        model: typeof json.model === 'string' && json.model ? json.model : o.model,
        ...(json.usage ? { usage: { ...(promptTokens !== undefined ? { promptTokens } : {}), ...(completionTokens !== undefined ? { completionTokens } : {}) } } : {}),
        raw: json,
      };
    },
  };
}

/** an adapter answering from a function (tests, replays of recorded outputs, dry runs) */
export function mockAdapter(fn: (req: CompletionRequest) => string | Promise<string>, model = 'mock'): Adapter {
  return { name: 'mock', model, complete: async (req) => ({ text: await fn(req), model }) };
}

/** an adapter that refuses every call: the CLI uses it to run the deterministic steps without a model */
export function noneAdapter(): Adapter {
  return {
    name: 'none',
    model: 'none',
    complete: () => Promise.reject(new Error('no model configured (provider none): configure --provider openai-compatible --base-url … --model … to extract')),
  };
}

export function adapterFromSpec(spec: AdapterSpec): Adapter {
  switch (spec.provider) {
    case 'none': return noneAdapter();
    case 'mock':
      if (!spec.mock) throw new Error("adapter spec: provider 'mock' needs a mock function");
      return mockAdapter(spec.mock, spec.model ?? 'mock');
    case 'openai-compatible':
      if (!spec.baseUrl || !spec.model) throw new Error("adapter spec: provider 'openai-compatible' needs baseUrl and model");
      return openaiCompatibleAdapter({
        baseUrl: spec.baseUrl, model: spec.model, apiKey: spec.apiKey, mode: spec.mode, temperature: spec.temperature, seed: spec.seed,
        timeoutMs: spec.timeoutMs, headers: spec.headers,
      });
    default: throw new Error(`adapter spec: unknown provider '${String((spec as { provider: unknown }).provider)}' (openai-compatible, mock, none)`);
  }
}
