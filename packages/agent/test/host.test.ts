/**
 * The operator host (v6.1, docs/markdown/AGENT_OPERATOR.md §2): the command line of a manifest tool from its template, the path
 * guards, and one scripted session through a fake fetch — the model reads a document, writes a worksheet, is refused a write
 * outside ws/, a read outside the roots and a dashed argument, runs a "pipeline" (a stub runHacd) and ends with a final message.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandArgs, insidePath, toolsForModel, runOperatorHost, HACD_TOOLS } from '../src/index.js';

describe('commandArgs: the manifest template → argv', () => {
  const run = HACD_TOOLS.tools.find((t) => t.name === 'hacd_ingest_run')!.command;
  it('fills placeholders, keeps optional groups only when every value is present, drops the leading hacd', () => {
    expect(commandArgs(run, { worksheets: '/w/ws', staging: '/w/staging', out: '/w/out' })).toEqual(['ingest', 'run', '--worksheets', '/w/ws', '--staging', '/w/staging', '--out', '/w/out', '--json']);
    expect(commandArgs(run, { worksheets: '/w/ws', staging: '/w/staging', out: '/w/out', beforeRecord: 'a3server', scales: '100000', trials: 400, permutations: 300 }))
      .toEqual(['ingest', 'run', '--worksheets', '/w/ws', '--staging', '/w/staging', '--before-record', 'a3server', '--out', '/w/out', '--scales', '100000', '--trials', '400', '--permutations', '300', '--json']);
  });
  it('expands an array value to several arguments and refuses a dashed value', () => {
    const extract = HACD_TOOLS.tools.find((t) => t.name === 'hacd_ingest_extract')!.command;
    const argv = commandArgs(extract, { docs: ['/d/a.md', '/d/b.md'], kind: 'topology', baseUrl: 'http://h/v1', model: 'm', out: '/w/ws/extract' });
    expect(argv.slice(0, 4)).toEqual(['ingest', 'extract', '/d/a.md', '/d/b.md']);
    expect(argv).toContain('--provider');
    expect(argv).not.toContain('--source-type');
    expect(() => commandArgs(run, { worksheets: '/w/ws', staging: '--force', out: '/w/out' })).toThrow(/dash/);
    expect(() => commandArgs(run, { worksheets: '/w/ws' })).toThrow(/missing argument/);
  });
  it('insidePath accepts the root and its children only', () => {
    expect(insidePath('/w/ws/a.md', '/w/ws')).toBe(true);
    expect(insidePath('/w/ws', '/w/ws')).toBe(true);
    expect(insidePath('/w/ws/../staging/x.json', '/w/ws')).toBe(false);
    expect(insidePath('/w/wsx/a.md', '/w/ws')).toBe(false);
  });
  it('toolsForModel lists the six hacd tools and the three file tools in the function-calling shape', () => {
    const tools = toolsForModel() as { type: string; function: { name: string; parameters: unknown } }[];
    expect(tools.map((t) => t.function.name)).toEqual([...HACD_TOOLS.tools.map((t) => t.name), 'read_file', 'write_file', 'list_files']);
    expect(tools.every((t) => t.type === 'function' && t.function.parameters)).toBe(true);
  });
});

describe('runOperatorHost: a scripted session through a fake model', () => {
  it('reads, writes under ws/ only, refuses what the rules forbid, runs the pipeline and returns the final message', async () => {
    const work = mkdtempSync(join(tmpdir(), 'hacd-host-'));
    const docs = mkdtempSync(join(tmpdir(), 'hacd-docs-'));
    writeFileSync(join(docs, 'note.md'), 'Each server carries 8 NPUs.');
    mkdirSync(join(work, 'secret'));
    writeFileSync(join(work, 'secret', 'x.txt'), 'inside work, readable');
    writeFileSync(join(tmpdir(), 'hacd-host-outside.txt'), 'outside');
    const turns: unknown[][] = [
      [{ name: 'read_file', args: { path: join(docs, 'note.md') } }, { name: 'read_file', args: { path: join(tmpdir(), 'hacd-host-outside.txt') } }],
      [{ name: 'write_file', args: { path: join(work, 'ws', 'topology.md'), content: '---\nworksheet: topology\n---\n' } }, { name: 'write_file', args: { path: join(work, 'staging', 'x.json'), content: '{}' } }],
      [{ name: 'hacd_ingest_run', args: { worksheets: join(work, 'ws'), staging: join(work, 'staging'), out: join(work, 'out'), trials: 10 } }],
      [{ name: 'hacd_ingest_run', args: { worksheets: join(work, 'ws'), staging: '/elsewhere', out: join(work, 'out') } }],
      [{ name: 'hacd_ingest_run', args: { worksheets: join(work, 'ws'), staging: join(work, 'staging'), out: join(work, 'out'), trials: 40 } }],
      [{ name: 'hacd_ingest_run', args: { worksheets: join(work, 'ws'), staging: join(work, 'staging'), out: join(work, 'out'), trials: 400 } }],
    ];
    const seen: { messages: { role: string; content?: string; tool_calls?: unknown[] }[] }[] = [];
    let n = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content?: string }[]; tools: unknown[] };
      seen.push(body as never);
      const turn = turns[n++];
      const message = turn
        ? { role: 'assistant', content: null, tool_calls: (turn as { name: string; args: unknown }[]).map((c, i) => ({ id: `c${n}-${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
        : { role: 'assistant', content: 'status: ok\nrun: hacd ingest run …' };
      return new Response(JSON.stringify({ choices: [{ message, finish_reason: turn ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const commands: string[][] = [];
    const runHacd = (args: string[]) => {
      commands.push(args);
      const trials = args[args.indexOf('--trials') + 1];
      return trials === '40'
        ? { exitCode: 2, stdout: JSON.stringify({ status: 'needs-input', steps: [] }), stderr: 'a gate failed' }
        : { exitCode: 0, stdout: JSON.stringify({ status: 'ok', steps: [{ name: 'validate', ok: true }] }), stderr: '' };
    };
    const log: Record<string, unknown>[] = [];
    const r = await runOperatorHost({ baseUrl: 'http://fake/v1', model: 'fake', lang: 'en', work, docs: [docs], task: 'do the thing', runHacd, fetchImpl, log: (e) => log.push(e), maxSteps: 10 });

    expect(r.stopped).toBe('final');
    expect(r.finalMessage).toMatch(/^status: ok/);
    expect(r.steps).toBe(7);
    expect(r.usage).toEqual({ promptTokens: 70, completionTokens: 35 });
    // the model saw the system prompt, the task and the tools
    expect(seen[0].messages[0].role).toBe('system');
    expect(seen[0].messages[1]).toEqual({ role: 'user', content: 'do the thing' });
    expect((seen[0] as unknown as { tools: unknown[] }).tools.length).toBe(HACD_TOOLS.tools.length + 3);
    // tool results, in order
    const results = seen[6].messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
    expect(results[0]).toBe('Each server carries 8 NPUs.');
    expect(results[1]).toMatch(/^error: read refused/);
    expect(results[2]).toMatch(/^written: .*ws\/topology\.md/);
    expect(results[3]).toMatch(/^error: write refused/);
    expect(results[4]).toMatch(/^error: argument 'trials' must be ≥ 35/); // the manifest's minimum, checked by the host before anything runs
    expect(results[5]).toMatch(/^error: argument 'staging' must be inside the work folder/);
    expect(JSON.parse(results[6])).toMatchObject({ exitCode: 2 });
    expect(JSON.parse(results[7])).toMatchObject({ exitCode: 0 });
    // what happened on disk and in the records
    expect(readFileSync(join(work, 'ws', 'topology.md'), 'utf8')).toContain('worksheet: topology');
    expect(existsSync(join(work, 'staging', 'x.json'))).toBe(false);
    expect(r.writes).toEqual([join(work, 'ws', 'topology.md')]);
    expect(commands).toHaveLength(2);
    expect(commands[0].slice(0, 2)).toEqual(['ingest', 'run']);
    expect(commands.every((c) => !c.includes('--force') && !c.includes('--promote'))).toBe(true);
    expect(r.lastRun).toMatchObject({ status: 'ok', exitCode: 0 });
    expect(r.toolCalls.filter((c) => !c.ok).map((c) => c.name)).toEqual(['read_file', 'write_file', 'hacd_ingest_run', 'hacd_ingest_run']);
    expect(log.some((e) => e.tool === 'hacd_ingest_run' && e.exitCode === 0)).toBe(true);
    expect(JSON.stringify(log)).not.toContain('Authorization');
  });

  it('stops with model-error on a transport failure and with max-steps when the model never finishes', async () => {
    const work = mkdtempSync(join(tmpdir(), 'hacd-host-'));
    const failing = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const r1 = await runOperatorHost({ baseUrl: 'http://fake/v1', model: 'fake', work, task: 't', runHacd: () => ({ exitCode: 0, stdout: '', stderr: '' }), fetchImpl: failing, maxSteps: 3 });
    expect(r1.stopped).toBe('model-error');
    expect(r1.error).toMatch(/fetch failed/);
    const looping = (async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'list_files', arguments: JSON.stringify({ dir: work }) } }] } }] }), { status: 200 })) as unknown as typeof fetch;
    const r2 = await runOperatorHost({ baseUrl: 'http://fake/v1', model: 'fake', work, task: 't', runHacd: () => ({ exitCode: 0, stdout: '', stderr: '' }), fetchImpl: looping, maxSteps: 3 });
    expect(r2.stopped).toBe('max-steps');
    expect(r2.steps).toBe(3);
    expect(r2.toolCalls).toHaveLength(3);
  });
});
