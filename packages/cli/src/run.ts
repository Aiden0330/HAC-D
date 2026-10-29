/**
 * `hacd ingest run` (v6.1): the whole input pipeline as one call, written for an operator that is a program or a small on-prem model
 * rather than a person at the terminal (docs/markdown/AGENT_OPERATOR.md). It runs, in order, worksheets → staged JSON (optional),
 * validate (gates), dry-run (KPI rows), diff against a baseline (optional), promote (optional, never with --force) and the Findings
 * report, each as a child process of this same CLI so that every step keeps its own exit code and JSON output; then it writes a
 * machine-readable manifest `run.json` and a short bilingual `SUMMARY.md`. Nothing in the data folder changes unless --promote is given.
 *
 * Exit codes: 0 report written · 2 the inputs need a fix (schema or gate errors, or no single record in the staging folder; the manifest
 * lists every issue with its path and code) · 3 the engine or the report failed (the manifest carries the step's stderr tail) · 1 usage.
 * Status in run.json: 'ok' | 'needs-input' | 'failed'. The operator's rule: on 2 edit the named worksheet rows and run again; on 3 lower
 * nothing — hand the manifest to a person.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DATA } from './pipeline.js';

type Args = { flag: (name: string) => string | undefined; has: (name: string) => boolean; command: string };
interface Issue { level: 'error' | 'warning' | 'info'; code: string; path: string; message: { zh: string; en: string } }
interface Step { name: string; ok: boolean; exitCode: number | null; seconds: number; command: string[]; outputs?: Record<string, unknown>; issues?: Issue[]; stderrTail?: string }
interface Manifest {
  version: 1; status: 'ok' | 'needs-input' | 'failed'; exitCode: number; startedAt: string; finishedAt: string; command: string;
  options: Record<string, unknown>; inputs: { record: { id: string; path: string } | null; rates: { id: string; path: string } | null; set: { id: string; path: string } | null };
  steps: Step[]; kpi: Record<string, unknown>[]; report: { dir: string; files: string[] } | null; delta: { dir: string; files: string[] } | null; promoted: string[];
  nextAction: { zh: string; en: string };
}

const writeJson = (p: string, v: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1) + '\n'); };
const writeText = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const log = (m: string) => console.error(`hacd ingest run: ${m}`);
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.report.json')).map((f) => join(dir, f)) : []);
const idOf = (p: string): string => { try { return String((readJson(p) as { id?: string }).id ?? basename(p, '.json')); } catch { return basename(p, '.json'); } };

/** one child process of this CLI (same runtime flags: `node --import tsx main.ts` in the repo, `node hacd.mjs` in the bundle) */
function cli(args: string[], o: { json?: boolean } = {}): { code: number | null; stdout: string; stderr: string; seconds: number } {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env });
  const seconds = (Date.now() - t0) / 1000;
  if (r.stderr) for (const line of r.stderr.split('\n').filter(Boolean)) console.error(`  │ ${line}`);
  if (!o.json && r.stdout) for (const line of r.stdout.split('\n').filter(Boolean)) console.error(`  │ ${line}`);
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', seconds };
}
/** write everything to a file descriptor before process.exit: on macOS a pipe is asynchronous and a single writeSync may be partial */
function writeAllSync(fd: number, text: string): void {
  const buf = Buffer.from(text);
  let off = 0;
  while (off < buf.length) {
    try { off += writeSync(fd, buf, off, buf.length - off); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // the pipe is full: give the reader 5 ms
    }
  }
}
const parseJsonOut = (s: string): unknown => { const i = s.indexOf('{'); const j = s.lastIndexOf('}'); return i >= 0 && j > i ? JSON.parse(s.slice(i, j + 1)) : null; };
const tail = (s: string, n = 12) => s.trim().split('\n').slice(-n).join('\n');

export function runPipeline(a: Args, rest: string[]): void {
  const staging = a.flag('staging');
  if (!staging) {
    console.error('usage: hacd ingest run --staging <dir> [--worksheets <dir|ws.md…>] [--record <id|path>] [--rates <id|path>] [--mechanisms <id|path>] [--before-record <id|path>] [--before-rates <id|path>] [--scales 10000,100000] [--target 0.985] [--trials 400] [--seed 1] [--permutations 300] [--out <dir>] [--data <dir>] [--promote] [--no-report] [--json]');
    process.exit(1);
  }
  const startedAt = new Date().toISOString();
  const out = resolve(a.flag('out') ?? join(staging, 'run'));
  const scales = a.flag('scales') ?? '10000,100000', target = a.flag('target') ?? '0.985', trials = a.flag('trials') ?? '400', seed = a.flag('seed') ?? '1', permutations = a.flag('permutations') ?? '300';
  const data = a.flag('data') ?? DATA;
  const m: Manifest = {
    version: 1, status: 'ok', exitCode: 0, startedAt, finishedAt: startedAt, command: a.command,
    options: { staging: resolve(staging), out, scales, target, trials, seed, permutations, data, promote: a.has('promote'), report: !a.has('no-report'), beforeRecord: a.flag('before-record') ?? null },
    inputs: { record: null, rates: null, set: null }, steps: [], kpi: [], report: null, delta: null, promoted: [], nextAction: { zh: '', en: '' },
  };
  const finish = (status: Manifest['status'], exitCode: number, next: { zh: string; en: string }): never => {
    m.status = status; m.exitCode = exitCode; m.finishedAt = new Date().toISOString(); m.nextAction = next;
    writeJson(join(out, 'run.json'), m);
    writeText(join(out, 'SUMMARY.md'), summary(m));
    log(`${status} · run.json and SUMMARY.md in ${out}`);
    // synchronous: console.log to a pipe is asynchronous and process.exit would cut a manifest of this size short
    if (rest.includes('--json')) writeAllSync(1, JSON.stringify(m, null, 1) + '\n');
    process.exit(exitCode);
  };
  const step = (name: string, args: string[], o: { json?: boolean } = {}): Step & { stdout: string; stderr: string } => {
    log(`step ${name}: hacd ${args.join(' ')}`);
    const r = cli(args, o);
    const s: Step & { stdout: string; stderr: string } = { name, ok: r.code === 0, exitCode: r.code, seconds: Number(r.seconds.toFixed(1)), command: ['hacd', ...args], stdout: r.stdout, stderr: r.stderr };
    if (!s.ok) s.stderrTail = tail(r.stderr + (o.json ? '' : '\n' + r.stdout));
    m.steps.push(s);
    return s;
  };
  const stripStdout = () => { for (const s of m.steps) { delete (s as { stdout?: string }).stdout; delete (s as { stderr?: string }).stderr; } };

  // 1. worksheets → staged JSON (optional)
  const ws = a.flag('worksheets');
  if (ws) {
    const files = existsSync(ws) && readdirSync(ws, { withFileTypes: true }).length >= 0 && !ws.endsWith('.md') ? readdirSync(ws).filter((f) => f.endsWith('.md')).map((f) => join(ws, f)) : [ws];
    if (!files.length) { stripStdout(); finish('needs-input', 2, { zh: `工作表目录 ${ws} 中没有 .md 文件`, en: `no .md worksheet in ${ws}` }); }
    // the staged files of the previous conversion go first, so a renamed id or a removed worksheet leaves no stale record behind
    const ledger = join(staging, 'worksheets', '.outputs.ledger'); // not .json: validate scans every *.json under staging
    if (existsSync(ledger)) {
      let previous: string[] = [];
      try { previous = (readJson(ledger) as { files?: string[] }).files ?? []; } catch { previous = []; }
      for (const p of previous) if (p.startsWith(resolve(staging)) && existsSync(p)) unlinkSync(p);
    }
    const s = step('worksheets', ['ingest', 'worksheet', ...files, '--out', staging]);
    const produced = [...s.stderr.matchAll(/→ (\S+\.json)/g)].map((x) => resolve(x[1]));
    if (s.ok || produced.length) writeJson(ledger, { files: produced });
    s.outputs = { files, produced };
    if (!s.ok) { stripStdout(); finish('needs-input', 2, { zh: '工作表无法解析：改正 stderr 中点名的行后重跑', en: 'a worksheet did not parse: fix the row named in the step’s stderr and run again' }); }
  }

  // 2. gates
  const v = step('validate', ['ingest', 'validate', staging, '--json'], { json: true });
  const vj = parseJsonOut(v.stdout) as { files?: Record<string, number>; issues?: Issue[] } | null;
  v.issues = vj?.issues ?? [];
  v.outputs = { files: vj?.files ?? null };
  const errors = v.issues.filter((i) => i.level === 'error');
  if (!v.ok || errors.length) { stripStdout(); finish('needs-input', 2, { zh: `门禁有 ${errors.length} 个错误：按 run.json 中每条 issue 的 path 与 code 改正工作表对应行，然后重跑`, en: `${errors.length} gate error(s): fix the worksheet row named by each issue’s path and code in run.json, then run again` }); }

  // 3. the inputs of the run: one record, at most one override and one set, from the flags or the staging folder
  const pick = (flag: string | undefined, dir: string, what: string): { id: string; path: string } | null | 'ambiguous' => {
    if (flag) return { id: existsSync(flag) ? idOf(flag) : flag, path: flag };
    const fs = jsonFiles(join(staging, dir));
    if (fs.length === 1) return { id: idOf(fs[0]), path: fs[0] };
    if (fs.length === 0) return null;
    log(`${fs.length} ${what} files in ${join(staging, dir)}: pass one with the flag`);
    return 'ambiguous';
  };
  const rec = pick(a.flag('record'), 'records', 'record'), rates = pick(a.flag('rates'), 'fault-rates', 'override'), set = pick(a.flag('mechanisms'), 'mechanism-sets', 'mechanism set');
  if (rec === 'ambiguous' || rates === 'ambiguous' || set === 'ambiguous' || !rec) { stripStdout(); finish('needs-input', 2, { zh: '需要恰好一条拓扑记录（records/ 中一个文件或 --record），覆盖与机制集最多各一个', en: 'exactly one topology record is needed (one file in records/ or --record); at most one override and one mechanism set' }); }
  type In = { id: string; path: string };
  const R = rec as In, RATES = rates as In | null, SET = set as In | null; // narrowed above (finish never returns)
  m.inputs = { record: R, rates: RATES, set: SET };
  const withInputs = (args: string[]) => [...args, '--record', R.path, ...(RATES ? ['--rates', RATES.path] : []), ...(SET ? ['--mechanisms', SET.path] : [])];
  const common = ['--scales', scales, '--target', target, '--trials', trials, '--seed', seed];

  // 4. dry run: the KPI rows and the content gates
  const d = step('dry-run', withInputs(['ingest', 'dry-run', ...common, '--json']), { json: true });
  const dj = parseJsonOut(d.stdout) as { rows?: Record<string, unknown>[]; issues?: Issue[] } | null;
  d.issues = dj?.issues ?? []; m.kpi = dj?.rows ?? [];
  if (!d.ok) { stripStdout(); finish('failed', 3, { zh: '干跑失败（引擎错误，见该步骤的 stderrTail）：不要改数字，把 run.json 交给负责人', en: 'the dry run failed (engine error, see the step’s stderrTail): change no number, hand run.json to the owner' }); }
  if (d.issues.some((i) => i.level === 'error')) { stripStdout(); finish('needs-input', 2, { zh: '干跑的门禁有错误：按 issue 的 path 与 code 改正后重跑', en: 'the dry run’s gates report errors: fix the rows named by path and code, then run again' }); }

  // 5. delta against a baseline (optional)
  const before = a.flag('before-record');
  if (before) {
    const deltaDir = join(out, 'delta');
    const dd = step('diff', ['ingest', 'diff', '--before-record', before, '--after-record', R.path, ...(a.flag('before-rates') ? ['--before-rates', a.flag('before-rates')!] : []), ...(RATES ? ['--after-rates', RATES.path] : []), ...(SET ? ['--after-set', SET.path] : []), ...common, '--out', deltaDir, '--json'], { json: true });
    if (!dd.ok) { stripStdout(); finish('failed', 3, { zh: '差异报告失败（见 stderrTail）', en: 'the delta failed (see stderrTail)' }); }
    m.delta = { dir: deltaDir, files: existsSync(deltaDir) ? readdirSync(deltaDir) : [] };
    dd.outputs = { dir: deltaDir };
  }

  // 6. promote (optional; never --force from here)
  if (a.has('promote')) {
    const p = step('promote', ['ingest', 'promote', staging, '--data', data]);
    if (!p.ok) { stripStdout(); finish('needs-input', 2, { zh: 'promote 被拒绝（公共 id、已存在的 id 或门禁错误）：换 id 或交给负责人，不要用 --force', en: 'promote refused (public id, existing id or gate error): change the id or hand it to the owner; never use --force' }); }
    m.promoted = [R.id, ...(RATES ? [RATES.id] : []), ...(SET ? [SET.id] : [])];
  }

  // 7. the Findings report (+ Methodology) on the inputs
  if (!a.has('no-report')) {
    const reportDir = join(out, 'report');
    const f = step('findings', withInputs(['findings', ...common, '--permutations', permutations, '--out', reportDir, '--data-out', join(reportDir, 'data')]));
    if (!f.ok) { stripStdout(); finish('failed', 3, { zh: '报告生成失败（见 stderrTail；少于 35 个窗口时逐窗口校核永远无法判定为支持）', en: 'the report failed (see stderrTail; fewer than 35 windows can never give a supported window check)' }); }
    m.report = { dir: reportDir, files: existsSync(reportDir) ? readdirSync(reportDir).filter((x) => x.endsWith('.html')) : [] };
    f.outputs = { dir: reportDir, files: m.report.files };
  }
  stripStdout();
  finish('ok', 0, {
    zh: `完成。交给可靠性负责人签署：${m.delta ? 'delta/delta.html（输入差异与 KPI 前后）与 ' : ''}report/ 下的 Findings 页面；run.json 列出全部步骤与 KPI 行${a.has('promote') ? '；记录已 promote' : '；记录未 promote（加 --promote 才写入数据目录）'}。`,
    en: `Done. Hand to the reliability owner for sign-off: ${m.delta ? 'delta/delta.html (input changes and KPI before / after) and ' : ''}the Findings page(s) under report/; run.json lists every step and the KPI rows${a.has('promote') ? '; the records were promoted' : '; nothing was promoted (add --promote to write the data folder)'}.`,
  });
}

/** the short bilingual summary a reviewer or an operator reads first */
function summary(m: Manifest): string {
  const pct = (x: unknown) => (typeof x === 'number' ? `${(100 * x).toFixed(2)} %` : '—');
  const num = (x: unknown, d = 1) => (typeof x === 'number' ? x.toFixed(d) : '—');
  const rows = m.kpi.map((r) => `| ${r.scale} | ${pct(r.effective)} / ${pct(r.effectiveDerated)} | ${pct(r.delivered)} | ${pct(r.aOpDerated)} | ${num(r.mtbfHwH, 2)} h | ${num(r.mttrS, 0)} s | ${pct(r.windowP)} ${r.verdict ?? ''} | ${r.feasible === false ? '— (not feasible)' : num(r.k, 3)} | ${Array.isArray(r.mechanisms) ? (r.mechanisms as string[]).join('+') || '—' : '—'} \\| ${Array.isArray(r.levers) ? (r.levers as string[]).join('+') || '—' : '—'} |`).join('\n');
  const issues = m.steps.flatMap((s) => (s.issues ?? []).map((i) => ({ step: s.name, ...i }))).filter((i) => i.level !== 'info');
  const issueLines = issues.length ? issues.map((i) => `- ${i.level} · ${i.step} · \`${i.path}\` · ${i.code} — ${i.message.en} / ${i.message.zh}`).join('\n') : '- none';
  const failed = m.steps.find((s) => !s.ok);
  const stepLines = m.steps.map((s) => `| ${s.name} | ${s.ok ? 'ok' : `exit ${s.exitCode}`} | ${s.seconds} s | \`${s.command.join(' ')}\` |`).join('\n');
  return `# hacd ingest run — ${m.status} (exit ${m.exitCode})

状态 / Status: **${m.status}** · ${m.startedAt} → ${m.finishedAt}
输入 / Inputs: record \`${m.inputs.record?.id ?? '—'}\`${m.inputs.rates ? ` · override \`${m.inputs.rates.id}\`` : ''}${m.inputs.set ? ` · set \`${m.inputs.set.id}\`` : ' · default mechanism set'}
下一步 / Next: ${m.nextAction.zh}
Next: ${m.nextAction.en}

## 步骤 / Steps
| step | result | time | command |
|---|---|---|---|
${stepLines}
${failed?.stderrTail ? `\nLast lines of the failed step:\n\`\`\`\n${failed.stderrTail}\n\`\`\`\n` : ''}
## KPI（干跑 / dry run; 口径: G_eff = effective goodput of one synchronous job over the 30-day window, nominal / derated (the report target, formula 2′); delivered = silent-corruption loss removed (derated); A_op derated (formula 1); MTBF_hw and MTTR_hw of formula 1; P = share of ${m.options.trials} 30-day windows ≥ target; k = uniform hardware factor, — when no move set reaches the target）
| scale | G_eff nominal / derated | delivered | A_op derated | MTBF_hw | MTTR_hw | P(window) | k | recommended mechanisms \\| levers |
|---|---|---|---|---|---|---|---|---|
${rows || '| — | | | | | | | | |'}

## 门禁问题 / Gate issues (errors and warnings)
${issueLines}

## 文件 / Files
- run.json: this run (steps, issues, KPI rows, paths)
${m.delta ? `- delta: ${m.delta.dir} (${m.delta.files.join(', ')})` : '- delta: not run (no --before-record)'}
${m.report ? `- report: ${m.report.dir} (${m.report.files.join(', ')}; data/ holds the sidecar JSON; \`hacd findings --data ${join(m.report.dir, 'data')}\` re-renders)` : '- report: not run'}
${m.promoted.length ? `- promoted: ${m.promoted.join(', ')}` : '- promoted: nothing (the data folder is unchanged)'}
`;
}
