/**
 * `hacd ingest operate` (v6.1, docs/markdown/AGENT_OPERATOR.md §2): the reference host that runs an on-prem, OpenAI-compatible
 * model as the HAC-D input operator. The model receives the operator prompt, the tool manifest and a task written from the flags
 * and the owner's brief; every hacd_* tool call becomes a child process of this CLI (the bundle's `bin/hacd` and the repo's
 * `node --import tsx main.ts` both work), file reads stay under the work folder and the documents, writes under <work>/ws/.
 * Outputs: the model's final message on stdout, <work>/operator-log.jsonl (every model turn and tool call, no key) and
 * <work>/operator-result.json. Exit code: that of the last `hacd ingest run` the model made (0 ok, 2 needs-input, 3 failed) when
 * the model finished with a final message; 1 when it did not finish or never ran the pipeline.
 *
 *   hacd ingest operate --base-url http://host:8000/v1 --model <name> [--api-key-env NAME] --work <dir> --docs <file|dir>…
 *                       [--brief <file.md>] [--before-record <public id>] [--scales 100000] [--trials 400] [--permutations 300]
 *                       [--lang zh|en] [--max-steps 60] [--temperature 0] [--seed n] [--timeout-ms 300000] [--task "<text>"]
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runOperatorHost, type HacdRun, type OperatorHostResult } from '@hac-d/agent';

type Args = { flag: (name: string) => string | undefined; has: (name: string) => boolean; command: string };
const log = (m: string) => console.error(`hacd ingest operate: ${m}`);
const fail = (m: string): never => { console.error(`hacd ingest operate: ${m}`); process.exit(1); };

/** every value after each occurrence of --name (a flag may repeat; a value may be a comma list) */
function flagAll(rest: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === `--${name}`) for (let j = i + 1; j < rest.length && !rest[j].startsWith('--'); j++) out.push(...rest[j].split(',').map((s) => s.trim()).filter(Boolean));
  return out;
}

const describe = (p: string): string => {
  const b = basename(p).toLowerCase();
  if (statSync(p).isDirectory()) return 'folder of documents';
  if (/mapping|口径/.test(b)) return '口径 mapping (device → fault unit, class, devices per unit, impact factor), reviewed';
  if (/\.(csv|xlsx|xlsm|xls)$/.test(b)) return 'failure-data table (device FIT / MTBF / AFR)';
  if (/mechanism|机制/.test(b)) return 'mechanism parameters';
  if (/design|topolog|拓扑|设计/.test(b)) return 'topology design document (prose)';
  return 'document';
};

/** the task (user message) from the flags and the brief, in the prompt's language */
export function operatorTask(o: { lang: 'zh' | 'en'; work: string; docs: string[]; brief?: string; beforeRecord?: string; scales: string; trials: string; permutations: string; baseUrl: string; model: string; task?: string }): string {
  const docLines = o.docs.map((d) => `- ${d} — ${describe(d)}`).join('\n');
  const en = [
    'Task: produce the HAC-D availability allocation report from the inputs below, following your procedure (A inputs → B run → C read run.json). Do not promote.',
    `Work folder: ${o.work} (ws/ for your worksheets, staging/ and out/ are written by HAC-D).`,
    'Input documents (read-only):',
    docLines,
    `Baseline public record for the delta: ${o.beforeRecord ?? '(none)'}. Scales: ${o.scales}. Trials: ${o.trials}. Permutations: ${o.permutations}.`,
    `Model endpoint for hacd_ingest_extract: base URL ${o.baseUrl}, model ${o.model}.`,
    ...(o.brief ? ['', "Owner's brief:", o.brief.trim()] : []),
    ...(o.task ? ['', o.task.trim()] : []),
  ];
  const zh = [
    '任务：按你的流程（A 输入 → B 运行 → C 读 run.json）从下列输入生成 HAC-D 可用性分配报告。不要 promote。',
    `工作目录：${o.work}（ws/ 放你的工作表，staging/ 与 out/ 由 HAC-D 写入）。`,
    '输入文档（只读）：',
    docLines,
    `差异对比的公开基线记录：${o.beforeRecord ?? '（无）'}。规模：${o.scales}。窗口数（trials）：${o.trials}。置换数（permutations）：${o.permutations}。`,
    `hacd_ingest_extract 使用的模型端点：base URL ${o.baseUrl}，model ${o.model}。`,
    ...(o.brief ? ['', '负责人说明：', o.brief.trim()] : []),
    ...(o.task ? ['', o.task.trim()] : []),
  ];
  return (o.lang === 'zh' ? zh : en).join('\n');
}

export async function operate(a: Args, rest: string[]): Promise<void> {
  const baseUrl = a.flag('base-url'), model = a.flag('model'), workFlag = a.flag('work');
  if (!baseUrl || !model || !workFlag) fail('usage: hacd ingest operate --base-url <url> --model <name> --work <dir> --docs <file|dir>… [--brief <file.md>] [--before-record <id>] [--scales] [--trials] [--permutations] [--lang zh|en] [--api-key-env NAME] [--max-steps] [--task "<text>"]');
  const work = resolve(workFlag!);
  const docs = flagAll(rest, 'docs').map((d) => resolve(d));
  for (const d of docs) if (!existsSync(d)) fail(`document not found: ${d}`);
  const keyEnv = a.flag('api-key-env');
  const apiKey = keyEnv ? process.env[keyEnv] : undefined;
  if (keyEnv && !apiKey) fail(`environment variable ${keyEnv} is not set`);
  const lang = (a.flag('lang') ?? 'zh') as 'zh' | 'en';
  if (lang !== 'zh' && lang !== 'en') fail('--lang must be zh or en');
  const briefPath = a.flag('brief');
  const brief = briefPath ? readFileSync(briefPath, 'utf8') : undefined;
  const scales = a.flag('scales') ?? '10000,100000', trials = a.flag('trials') ?? '400', permutations = a.flag('permutations') ?? '300';
  mkdirSync(join(work, 'ws'), { recursive: true });
  const logPath = join(work, 'operator-log.jsonl');
  writeFileSync(logPath, '');
  const task = operatorTask({ lang, work, docs, brief, beforeRecord: a.flag('before-record'), scales, trials, permutations, baseUrl: baseUrl!, model: model!, task: a.flag('task') });
  appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), task }) + '\n');

  /** one child process of this CLI (same runtime flags: `node --import tsx main.ts` in the repo, `node hacd.mjs` in the bundle) */
  const runHacd = (args: string[]): HacdRun => {
    // the parent's cwd is kept: the repo's `--import tsx` and the bundle's hacd.mjs resolve from there; every path the model sees is absolute
    const r = spawnSync(process.execPath, [...process.execArgv, resolve(process.argv[1]), ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env });
    return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? r.error.message : '') };
  };

  const startedAt = new Date().toISOString(), t0 = Date.now();
  log(`${model} at ${baseUrl}; work ${work}; ${docs.length} document(s); lang ${lang}`);
  const result: OperatorHostResult = await runOperatorHost({
    baseUrl: baseUrl!, model: model!, apiKey, lang, work, docs, task, runHacd,
    maxSteps: Number(a.flag('max-steps') ?? 60), temperature: Number(a.flag('temperature') ?? 0), seed: a.flag('seed') !== undefined ? Number(a.flag('seed')) : undefined,
    timeoutMs: Number(a.flag('timeout-ms') ?? 300_000),
    log: (e) => appendFileSync(logPath, JSON.stringify(e) + '\n'),
    onProgress: (m) => log(m),
  });
  const finishedAt = new Date().toISOString();
  const summary = {
    version: 1, startedAt, finishedAt, seconds: (Date.now() - t0) / 1000, baseUrl, model, lang, work, docs, brief: briefPath ?? null,
    options: { beforeRecord: a.flag('before-record') ?? null, scales, trials, permutations },
    stopped: result.stopped, error: result.error ?? null, steps: result.steps, usage: result.usage,
    toolCalls: result.toolCalls, writes: result.writes, commands: result.commands,
    lastRun: result.lastRun ? { status: result.lastRun.status, exitCode: result.lastRun.exitCode } : null,
    finalMessage: result.finalMessage,
  };
  writeFileSync(join(work, 'operator-result.json'), JSON.stringify(summary, null, 1) + '\n');
  if (result.finalMessage !== null) console.log(result.finalMessage);
  const runs = result.commands.filter((c) => (c[0] === 'ingest' && c[1] === 'run') || (c[0] === 'scenario' && c[1] === 'report')).length;
  log(`${result.stopped}${result.error ? ` (${result.error})` : ''}: ${result.steps} model turns, ${result.toolCalls.length} tool calls, ${result.writes.length} file(s) written, ${runs} pipeline run(s)${result.lastRun ? `, last run ${result.lastRun.status ?? '?'} (exit ${result.lastRun.exitCode})` : ''}; operator-result.json and operator-log.jsonl in ${work}`);
  if (result.stopped !== 'final') process.exit(1);
  if (!result.lastRun) { log('the model finished without running the pipeline or a project report'); process.exit(1); }
  process.exit(result.lastRun.exitCode ?? 1);
}
