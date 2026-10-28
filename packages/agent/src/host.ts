/**
 * The operator host (v6.1, docs/markdown/AGENT_OPERATOR.md §2): the program that runs an on-prem, OpenAI-compatible model as the
 * HAC-D input operator. It sends the system prompt (OPERATOR_PROMPT), the task and the tool manifest (HACD_TOOLS plus read_file /
 * write_file / list_files), executes the model's tool calls — every hacd_* tool is one command line of the CLI, run by the caller's
 * `runHacd` — and feeds the results back until the model answers without a tool call. Guards, not trust: files are read only under
 * the work folder and the input documents, written only under <work>/ws/, hacd arguments that name a folder stay inside the work
 * folder, an argument that starts with a dash is refused (so --force, --promote and --data can never reach the CLI), and the loop
 * stops after `maxSteps` model turns. Every exchange is logged without the API key. The host computes nothing: a tool result is the
 * CLI's stdout / stderr / exit code or a file's text, as it is.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { HACD_TOOLS, OPERATOR_PROMPT } from './operator.js';

export interface HacdRun { exitCode: number | null; stdout: string; stderr: string }
export interface OperatorHostOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  lang?: 'zh' | 'en';
  /** the work folder (<work>/ws, <work>/staging, <work>/out); created when missing */
  work: string;
  /** input documents the model may read: files or folders */
  docs?: string[];
  /** the task, as the user message after the system prompt */
  task: string;
  /** runs one command line of the CLI (arguments after `hacd`) and returns its outputs */
  runHacd: (args: string[]) => HacdRun;
  maxSteps?: number;
  temperature?: number;
  seed?: number;
  /** per model call */
  timeoutMs?: number;
  /** longest tool result handed to the model (characters); longer outputs are cut with a note */
  maxToolOutputChars?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  log?: (entry: Record<string, unknown>) => void;
  onProgress?: (message: string) => void;
}
export interface ToolCallRecord {
  step: number;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  seconds: number;
  command?: string[];
  exitCode?: number | null;
  error?: string;
}
export interface OperatorHostResult {
  finalMessage: string | null;
  stopped: 'final' | 'max-steps' | 'model-error';
  error?: string;
  /** model turns */
  steps: number;
  toolCalls: ToolCallRecord[];
  /** files written through write_file (absolute) */
  writes: string[];
  /** hacd command lines run (arguments after `hacd`) */
  commands: string[][];
  /** the last `hacd ingest run` of the session: its exit code and the manifest's status */
  lastRun: { status: string | null; exitCode: number | null; manifest: unknown } | null;
  usage: { promptTokens: number; completionTokens: number };
}

type Json = Record<string, unknown>;
interface ToolCall { id: string; type?: string; function: { name: string; arguments: string } }
interface AssistantMessage { role: 'assistant'; content?: string | null; tool_calls?: ToolCall[] }
interface ChatResponse { choices?: { message?: AssistantMessage; finish_reason?: string }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; error?: unknown }

const HOST_TOOLS = [
  { name: 'read_file', description: 'Read a UTF-8 text file under the work folder or among the input documents. Returns the text.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write a UTF-8 text file under <work>/ws/ (worksheets only; nothing else may be written). Parent folders are created.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_files', description: 'List the files under a folder of the work folder or of the input documents, recursively, as relative paths.', parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] } },
] as const;

/** the tools in the OpenAI function-calling shape: one per HACD_TOOLS entry (its command in the description) plus the three file tools */
export function toolsForModel(): Json[] {
  return [
    ...HACD_TOOLS.tools.map((t) => ({ type: 'function', function: { name: t.name, description: `${t.description} Runs: ${t.command}. Returns: ${t.returns}.`, parameters: t.parameters } })),
    ...HOST_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
  ];
}

/** is `p` the root or inside it (after resolving)? */
export function insidePath(p: string, root: string): boolean {
  const r = relative(resolve(root), resolve(p));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** the parameter schema of a manifest tool, checked the way a strict server would: type, enum, pattern, minimum, required */
function checkArgs(schema: Json, args: Json): string | null {
  const props = (schema.properties ?? {}) as Record<string, Json>;
  for (const r of (schema.required as string[] | undefined) ?? []) if (args[r] === undefined || args[r] === null || args[r] === '') return `missing required argument '${r}'`;
  for (const [k, v] of Object.entries(args)) {
    const s = props[k];
    if (!s) return `unknown argument '${k}' (allowed: ${Object.keys(props).join(', ')})`;
    if (v === undefined || v === null) continue;
    if (s.type === 'array') {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return `argument '${k}' must be an array of strings`;
      continue;
    }
    if (s.type === 'integer') {
      if (typeof v !== 'number' || !Number.isInteger(v)) return `argument '${k}' must be an integer`;
      if (typeof s.minimum === 'number' && v < s.minimum) return `argument '${k}' must be ≥ ${s.minimum}`;
      continue;
    }
    if (typeof v !== 'string') return `argument '${k}' must be a string`;
    if (Array.isArray(s.enum) && !s.enum.includes(v)) return `argument '${k}' must be one of ${(s.enum as string[]).join(', ')}`;
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(v)) return `argument '${k}' does not match ${s.pattern}`;
  }
  return null;
}

/**
 * The command line of a manifest tool from its command template and the arguments: `{name}` placeholders are filled, `[...]`
 * groups are kept only when every placeholder inside has a value, an array value expands to several arguments. The leading `hacd`
 * is dropped. Every filled value must not start with a dash.
 */
export function commandArgs(command: string, args: Json): string[] {
  const present = (n: string) => { const v = args[n]; return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0); };
  const value = (n: string): string[] => {
    const v = args[n];
    const items = Array.isArray(v) ? v.map(String) : [String(v)];
    for (const s of items) if (/^\s*-/.test(s)) throw new Error(`argument '${n}' must not start with a dash (${s})`);
    return items;
  };
  const expand = (tok: string): string[] => {
    const whole = /^\{(\w+)\}$/.exec(tok);
    if (whole) return value(whole[1]);
    return [tok.replace(/\{(\w+)\}/g, (_, n: string) => value(n).join(','))];
  };
  const out: string[] = [];
  for (const tok of command.match(/\[[^\]]*\]|\S+/g) ?? []) {
    const names = [...tok.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (tok.startsWith('[') && tok.endsWith(']')) {
      if (names.length && names.every(present)) for (const t of tok.slice(1, -1).trim().split(/\s+/)) out.push(...expand(t));
      continue;
    }
    if (names.some((n) => !present(n))) throw new Error(`missing argument ${names.filter((n) => !present(n)).join(', ')}`);
    out.push(...expand(tok));
  }
  if (out[0] === 'hacd') out.shift();
  return out;
}

/** the manifest parameters that name a folder HAC-D writes (must stay in the work folder) and the inputs it reads (work or documents) */
const WRITE_DIR_PARAMS = new Set(['out', 'staging', 'worksheets']);
const READ_PATH_PARAMS = new Set(['file', 'docs', 'devices', 'mapping', 'scenario']);

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}\n…[${s.length - max} characters cut]` : s);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const parseManifest = (stdout: string): unknown => { const i = stdout.indexOf('{'), j = stdout.lastIndexOf('}'); try { return i >= 0 && j > i ? JSON.parse(stdout.slice(i, j + 1)) : null; } catch { return null; } };

/**
 * one POST, retried twice on a transport failure (not on an HTTP status): a tool call such as `hacd ingest run` can take minutes,
 * and a server that closed the idle keep-alive connection meanwhile makes the next request fail once
 */
async function postWithRetry(f: typeof fetch, url: string, headers: Record<string, string>, body: string, signal: AbortSignal, note: (m: string) => void): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await f(url, { method: 'POST', headers, body, signal });
    } catch (e) {
      lastError = e;
      if (signal.aborted || attempt === 3) break;
      note(`attempt ${attempt} failed (${(e as Error).message}); retrying`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function listFiles(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, root));
    else out.push(relative(root, p));
  }
  return out;
}

export async function runOperatorHost(o: OperatorHostOptions): Promise<OperatorHostResult> {
  if (!o.baseUrl) throw new Error('operator host: baseUrl is required');
  if (!o.model) throw new Error('operator host: model is required');
  const work = resolve(o.work);
  const ws = join(work, 'ws');
  mkdirSync(ws, { recursive: true });
  const docRoots = (o.docs ?? []).map((d) => resolve(d));
  const maxSteps = o.maxSteps ?? 60, maxOut = o.maxToolOutputChars ?? 200_000, timeoutMs = o.timeoutMs ?? 300_000;
  const f = o.fetchImpl ?? globalThis.fetch;
  if (typeof f !== 'function') throw new Error('operator host: no fetch available (Node ≥ 20 has a global fetch)');
  const url = `${o.baseUrl.trim().replace(/\/+$/, '')}${/\/chat\/completions$/.test(o.baseUrl.trim().replace(/\/+$/, '')) ? '' : '/chat/completions'}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(o.headers ?? {}) };
  if (o.apiKey) headers.Authorization = `Bearer ${o.apiKey}`;
  const log = (e: Record<string, unknown>) => o.log?.({ ts: new Date().toISOString(), ...e });

  const readable = (p: string): boolean => insidePath(p, work) || docRoots.some((r) => (existsSync(r) && statSync(r).isFile() ? resolve(p) === r : insidePath(p, r)));
  const abs = (p: string) => (isAbsolute(p) ? resolve(p) : resolve(work, p));
  const byName = new Map(HACD_TOOLS.tools.map((t) => [t.name, t]));

  const result: OperatorHostResult = { finalMessage: null, stopped: 'max-steps', steps: 0, toolCalls: [], writes: [], commands: [], lastRun: null, usage: { promptTokens: 0, completionTokens: 0 } };

  /** one tool call → the text handed back to the model */
  const execute = (step: number, call: ToolCall): string => {
    const name = call.function?.name ?? '';
    let args: Json = {};
    const t0 = Date.now();
    const rec: ToolCallRecord = { step, name, args, ok: false, seconds: 0 };
    result.toolCalls.push(rec);
    const done = (text: string, ok: boolean, extra: Partial<ToolCallRecord> = {}) => {
      rec.ok = ok; rec.seconds = (Date.now() - t0) / 1000; Object.assign(rec, extra);
      log({ step, tool: name, args, ok, seconds: rec.seconds, exitCode: rec.exitCode ?? null, outputChars: text.length, ...(rec.error ? { error: rec.error } : {}) });
      return text;
    };
    try { args = JSON.parse(call.function?.arguments || '{}') as Json; rec.args = args; } catch (e) { rec.error = `arguments are not JSON: ${(e as Error).message}`; return done(`error: ${rec.error}`, false); }
    try {
      if (name === 'read_file') {
        const p = abs(String(args.path ?? ''));
        if (!readable(p)) throw new Error(`read refused: ${p} is outside the work folder and the input documents`);
        if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`no such file: ${p}`);
        return done(cut(readFileSync(p, 'utf8'), maxOut), true);
      }
      if (name === 'write_file') {
        const p = abs(String(args.path ?? ''));
        if (!insidePath(p, ws)) throw new Error(`write refused: ${p} is outside ${ws}`);
        if (typeof args.content !== 'string') throw new Error('content must be a string');
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, args.content);
        result.writes.push(p);
        return done(`written: ${p} (${Buffer.byteLength(args.content)} bytes)`, true);
      }
      if (name === 'list_files') {
        const p = abs(String(args.dir ?? ''));
        if (!readable(p)) throw new Error(`list refused: ${p} is outside the work folder and the input documents`);
        if (!existsSync(p)) return done(JSON.stringify({ dir: p, files: [] }), true);
        const files = statSync(p).isDirectory() ? listFiles(p) : [p];
        return done(cut(JSON.stringify({ dir: p, files }), maxOut), true);
      }
      const tool = byName.get(name);
      if (!tool) throw new Error(`unknown tool '${name}'`);
      const bad = checkArgs(tool.parameters as Json, args);
      if (bad) throw new Error(bad);
      for (const [k, v] of Object.entries(args)) {
        const items = Array.isArray(v) ? v.map(String) : [String(v)];
        if (WRITE_DIR_PARAMS.has(k)) for (const p of items) if (!insidePath(abs(p), work)) throw new Error(`argument '${k}' must be inside the work folder ${work} (got ${p})`);
        if (READ_PATH_PARAMS.has(k)) for (const p of items) if (!readable(abs(p))) throw new Error(`argument '${k}' must be inside the work folder or the input documents (got ${p})`);
      }
      const cmd = commandArgs(tool.command, args);
      rec.command = cmd;
      result.commands.push(cmd);
      o.onProgress?.(`step ${step}: hacd ${cmd.join(' ')}`);
      const r = o.runHacd(cmd);
      rec.exitCode = r.exitCode;
      // the pipeline run and the project report both end a session: their manifest is the result the host reports (v6.4)
      if (name === 'hacd_ingest_run' || name === 'hacd_scenario_report') {
        const manifest = parseManifest(r.stdout) as { status?: string } | null;
        result.lastRun = { status: manifest?.status ?? null, exitCode: r.exitCode, manifest };
      }
      return done(JSON.stringify({ exitCode: r.exitCode, stdout: cut(r.stdout, maxOut), stderr: cut(r.stderr.trim().split('\n').slice(-40).join('\n'), 20_000) }), r.exitCode === 0 || name === 'hacd_ingest_run');
    } catch (e) {
      rec.error = (e as Error).message;
      return done(`error: ${rec.error}`, false, { error: rec.error });
    }
  };

  const messages: Json[] = [{ role: 'system', content: OPERATOR_PROMPT[o.lang ?? 'zh'] }, { role: 'user', content: o.task }];
  const tools = toolsForModel();
  for (let step = 1; step <= maxSteps; step++) {
    result.steps = step;
    const body: Json = { model: o.model, messages, tools, tool_choice: 'auto', temperature: o.temperature ?? 0 };
    if (o.seed !== undefined) body.seed = o.seed;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const t0 = Date.now();
    let res: Response;
    try {
      res = await postWithRetry(f, url, headers, JSON.stringify(body), ctl.signal, (m) => log({ step, retry: m }));
    } catch (e) {
      clearTimeout(timer);
      result.stopped = 'model-error';
      result.error = ctl.signal.aborted ? `model call to ${url} timed out after ${timeoutMs} ms` : `model call to ${url} failed: ${(e as Error).message}`;
      log({ step, error: result.error });
      return result;
    }
    clearTimeout(timer);
    if (!res.ok) {
      result.stopped = 'model-error';
      result.error = `model call to ${url} returned HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
      log({ step, error: result.error });
      return result;
    }
    const json = (await res.json()) as ChatResponse;
    const msg = json.choices?.[0]?.message;
    if (!msg) {
      result.stopped = 'model-error';
      result.error = `model call to ${url}: the response has no choices[0].message`;
      log({ step, error: result.error });
      return result;
    }
    result.usage.promptTokens += num(json.usage?.prompt_tokens);
    result.usage.completionTokens += num(json.usage?.completion_tokens);
    const calls = msg.tool_calls ?? [];
    log({ step, model: o.model, durationMs: Date.now() - t0, toolCalls: calls.map((c) => c.function?.name), content: calls.length ? undefined : msg.content ?? '', finishReason: json.choices?.[0]?.finish_reason ?? null });
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      result.finalMessage = msg.content ?? '';
      result.stopped = 'final';
      o.onProgress?.(`step ${step}: final message (${result.finalMessage.length} characters)`);
      return result;
    }
    o.onProgress?.(`step ${step}: ${calls.map((c) => c.function?.name).join(', ')}`);
    for (const c of calls) messages.push({ role: 'tool', tool_call_id: c.id, content: execute(step, c) });
  }
  result.stopped = 'max-steps';
  result.error = `the model did not finish within ${maxSteps} steps`;
  return result;
}
