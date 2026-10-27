/**
 * v6 `hacd ingest` (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §4): the offline pipeline around the v5 input records.
 *
 *   hacd ingest template <kind>                       example worksheet of a kind (topology | fault-rates | mechanisms | mechanism-proposal | device-fit | koujing-mapping)
 *   hacd ingest fields <kind> [--json] [--vocab]      the field paths and closed vocabularies a worksheet or a model may use
 *   hacd ingest worksheet <ws.md>… [--out dir] [--base <set id|path>]       worksheets → staged records (JSON) under <out>/{records,fault-rates,mechanism-sets,…}
 *   hacd ingest normalize --devices <ws.md|json> --mapping <ws.md|json> --id <override id> [--source txt] [--out dir]   device FIT × 口径 mapping → failure-rate override
 *   hacd ingest import-fit <book.xlsx|csv> --id <table id> [--sheet name] [--columns device=Part,value=2,…] [--unit FIT] [--source-type vendor] [--row-source txt] [--header-row n] [--out dir]
 *   hacd ingest validate <dir|staged.json>… [--envelope 0.1,10] [--json]   schema, vocabulary, provenance, plausibility, consistency, id collisions; exit 1 on errors
 *   hacd ingest dry-run --record <id|path> [--rates <id|path>] [--mechanisms <id|path>] [--scales 10000,100000] [--target 0.985] [--trials 400] [--seed 1] [--json]
 *   hacd ingest diff [--record <id|path>] [--before-record] [--after-record] [--before-rates] [--after-rates] [--before-set] [--after-set] [--scales] [--target] [--trials] [--seed] [--out dir] [--json]
 *   hacd ingest promote <dir|staged.json>… [--data <dir>] [--force]      copy validated records into the data folder under their own ids; CHANGELOG entry
 *   hacd ingest extract <doc.txt|md>… --kind topology|device-fit|mechanisms --provider openai-compatible|mock|none [--base-url] [--model] [--api-key-env NAME] [--mode json_schema|guided_json|fenced] [--passes 2] [--chunk 2500] [--overlap 200] [--source-type vendor] [--id x] [--template a950-ub2] [--out dir]
 *   hacd ingest run --staging <dir> [--worksheets <dir>] [--record] [--rates] [--mechanisms] [--before-record] [--scales] [--trials] [--permutations] [--out] [--promote] [--no-report] [--json]   the whole chain as one call for a program or an on-prem model: run.json + SUMMARY.md; exit 0 ok / 2 needs-input / 3 failed
 *
 * Every number comes from @hac-d/core; the worksheets from @hac-d/importers; the review page from @hac-d/reports; the model step from
 * @hac-d/agent (loaded only by `extract`). Internal records get their own ids: an id of a public record is refused.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { basename, dirname, join, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseTopologyRecord, parseFaultRateOverride, parseMechanismSet, parseDeviceFitTable, parseKoujingMapping, parseMechanismProposal, parseExtensionRequest,
  BUILTIN_TOPOLOGY_RECORDS, DEFAULT_MECHANISM_SET, normalizeFaultRates, validateInputs, countIssues, hasErrors, deltaDocument, budgetFromRecords, kpiRow,
  fieldSpecs, vocabularies, WORKSHEET_KINDS, mechanismProposalRequest, extensionRequestFromError, extensionRequestMarkdown, SOURCE_TYPES, DEVICE_RATE_UNITS,
  type TopologyRecord, type FaultRateOverride, type MechanismSet, type Issue, type ExtensionRequest, type WorksheetKind, type DeviceFitTable, type KoujingMapping, type MechanismProposal, type DeltaInputs, type DeviceRateUnit, type SourceType,
} from '@hac-d/core';
import { parseWorksheet, worksheetTemplate, readWorkbook, deviceTableFromSheet, faultRateOverrideToWorksheet, deviceTableToWorksheet, proposalIntoSet, type DeviceColumn } from '@hac-d/importers';
import { deltaHtml, deltaMarkdown } from '@hac-d/reports';
import { argsOf, resolveRecord, resolveSet, resolveRates, DATA, dataIds, engine } from './pipeline.js';
import { runPipeline } from './run.js';
import { protocol } from './protocol.js';

type Args = ReturnType<typeof argsOf>;
function fail(msg: string): never { console.error(`hacd ingest: ${msg}`); process.exit(1); }
const readText = (p: string) => readFileSync(p, 'utf8');
const readJson = (p: string): unknown => JSON.parse(readText(p));
const writeJson = (p: string, v: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1) + '\n'); };
const writeText = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const nums = (s: string | undefined, d: number[]) => { const v = list(s).map(Number); if (v.some((x) => !(x > 0))) fail(`bad number list '${s}'`); return v.length ? v : d; };
const today = () => new Date().toISOString().slice(0, 10);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const BOOL = new Set(['--json', '--force', '--vocab', '--no-html']);
const positional = (rest: string[]) => rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--') || BOOL.has(rest[i - 1])));
const log = (m: string) => console.error(m);
const pad = (rows: (string | number)[][]) => { const w = rows[0].map((_c, j) => Math.max(...rows.map((x) => String(x[j] ?? '').length))); return rows.map((x) => x.map((c, j) => String(c ?? '').padEnd(w[j])).join('  ').trimEnd()).join('\n'); };

/** ids shipped with HAC-D: an internal record may never take one of them */
const PUBLIC_IDS = { records: [...Object.keys(BUILTIN_TOPOLOGY_RECORDS), 'a960e'], sets: [DEFAULT_MECHANISM_SET.id], rates: ['remap-per-card-2026-10-09'] };
const existingIds = (data = DATA) => ({ records: idsIn(join(data, 'records')), rates: idsIn(join(data, 'fault-rates')), sets: idsIn(join(data, 'mechanism-sets')) });
const idsIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);

/* ---------------- staged files ---------------- */
type StagedKind = 'record' | 'rates' | 'set' | 'device-fit' | 'mapping' | 'proposal' | 'extension' | 'unknown';
const kindOf = (o: unknown): StagedKind => {
  if (!o || typeof o !== 'object') return 'unknown';
  const x = o as Record<string, unknown>;
  if (typeof x.version === 'string' && x.version.startsWith('hacd-extension-request')) return 'extension';
  if ('template' in x && 'variants' in x) return 'record';
  if ('rates' in x && 'basis' in x) return 'rates';
  if ('baseline' in x && 'metadata' in x) return 'set';
  if ('kind' in x && 'stage' in x && 'acts' in x) return 'proposal';
  const rows = x.rows as Record<string, unknown>[] | undefined;
  if (Array.isArray(rows) && rows[0]) return 'impactFactor' in rows[0] ? 'mapping' : 'sourceType' in rows[0] ? 'device-fit' : 'unknown';
  return 'unknown';
};
interface Staged { records: { path: string; value: TopologyRecord }[]; rates: { path: string; value: FaultRateOverride }[]; sets: { path: string; value: MechanismSet }[]; proposals: { path: string; value: MechanismProposal }[]; requests: { path: string; value: ExtensionRequest }[]; schemaIssues: Issue[]; others: string[] }
const walk = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : p.endsWith('.json') && !p.endsWith('.report.json') ? [p] : []);
function loadStaged(paths: string[]): Staged {
  const out: Staged = { records: [], rates: [], sets: [], proposals: [], requests: [], schemaIssues: [], others: [] };
  for (const p of paths.flatMap((x) => (existsSync(x) ? walk(x) : fail(`no such file or folder: ${x}`)))) {
    let raw: unknown;
    try { raw = readJson(p); } catch (e) { out.schemaIssues.push({ level: 'error', code: 'json', path: p, message: { zh: `JSON 无法解析：${(e as Error).message}`, en: `not valid JSON: ${(e as Error).message}` } }); continue; }
    const k = kindOf(raw);
    try {
      if (k === 'record') out.records.push({ path: p, value: parseTopologyRecord(raw) });
      else if (k === 'rates') out.rates.push({ path: p, value: parseFaultRateOverride(raw) });
      else if (k === 'set') out.sets.push({ path: p, value: parseMechanismSet(raw) });
      else if (k === 'proposal') out.proposals.push({ path: p, value: parseMechanismProposal(raw) });
      else if (k === 'extension') out.requests.push({ path: p, value: parseExtensionRequest(raw) });
      else if (k === 'device-fit' || k === 'mapping') { /* inputs of normalize, not records */ }
      else out.others.push(p);
    } catch (e) { out.schemaIssues.push({ level: 'error', code: 'schema', path: p, message: { zh: (e as Error).message, en: (e as Error).message } }); }
  }
  return out;
}
const printIssues = (issues: Issue[]) => {
  if (!issues.length) { console.log('no issues'); return; }
  const order = { error: 0, warning: 1, info: 2 } as const;
  const rows: (string | number)[][] = [['level', 'path', 'code', 'message'], ...[...issues].sort((a, b) => order[a.level] - order[b.level]).map((i) => [i.level, i.path, i.code, i.message.en])];
  console.log(pad(rows));
  const c = countIssues(issues);
  console.log(`\n${c.error} errors, ${c.warning} warnings, ${c.info} notes`);
};
const stageDir = (kind: StagedKind | 'worksheets' | 'extension-requests' | 'proposals') => ({ record: 'records', rates: 'fault-rates', set: 'mechanism-sets', 'device-fit': 'device-fit', mapping: 'koujing-mapping', proposal: 'proposals', extension: 'extension-requests', unknown: 'other', worksheets: 'worksheets', 'extension-requests': 'extension-requests', proposals: 'proposals' })[kind];

/* ---------------- commands ---------------- */
function template(rest: string[]): void {
  const kind = rest[0] as WorksheetKind;
  if (!(WORKSHEET_KINDS as readonly string[]).includes(kind)) fail(`usage: hacd ingest template <${WORKSHEET_KINDS.join(' | ')}>`);
  process.stdout.write(worksheetTemplate(kind));
}
function fields(a: Args, rest: string[]): void {
  if (a.has('vocab')) { const v = vocabularies(); if (a.has('json')) console.log(JSON.stringify(v, null, 1)); else for (const [k, xs] of Object.entries(v)) console.log(`${k} (${xs.length}): ${xs.join(', ')}`); return; }
  const kind = rest[0] as WorksheetKind;
  if (!(WORKSHEET_KINDS as readonly string[]).includes(kind)) fail(`usage: hacd ingest fields <${WORKSHEET_KINDS.join(' | ')}> [--json] | --vocab`);
  const specs = fieldSpecs(kind);
  if (a.has('json')) { console.log(JSON.stringify(specs, null, 1)); return; }
  console.log(pad([['path', 'type', 'values / about'], ...specs.map((f) => [f.path, f.type, f.values ? f.values.join(' | ') : f.about.en])]));
}
const resolveSetArg = (spec: string | undefined, data = DATA): MechanismSet => (spec && existsSync(spec) ? parseMechanismSet(readJson(spec)) : (spec && !existsSync(spec) && !existsSync(join(data, 'mechanism-sets', `${spec}.json`)) && spec !== DEFAULT_MECHANISM_SET.id ? fail(`unknown mechanism set '${spec}'`) : resolveSet(spec)));

function worksheet(a: Args, rest: string[]): void {
  const files = positional(rest);
  if (!files.length) fail('usage: hacd ingest worksheet <worksheet.md>… [--out data-staging/staged] [--base <set id|path>]');
  const out = a.flag('out') ?? join('data-staging', 'staged');
  const baseSet = resolveSetArg(a.flag('base'));
  const date = today();
  for (const f of files) {
    const text = readText(f);
    try {
      const w = parseWorksheet(text, { baseSet });
      const dir = { topology: 'records', 'fault-rates': 'fault-rates', mechanisms: 'mechanism-sets', 'mechanism-proposal': 'proposals', 'device-fit': 'device-fit', 'koujing-mapping': 'koujing-mapping' }[w.kind];
      const id = (w.value as { id: string }).id;
      const target = join(out, dir, `${id}.json`);
      writeJson(target, w.value);
      writeText(join(out, 'worksheets', basename(f)), text);
      let extra = '';
      if (w.kind === 'mechanism-proposal') {
        const p = w.value;
        if (p.mapsTo) { const s = proposalIntoSet(p, baseSet); s.id = `${baseSet.id}--${p.id}`; writeJson(join(out, 'mechanism-sets', `${s.id}.json`), s); extra = ` → mechanism set ${s.id} (mapped onto ${p.mapsTo})`; }
        else { const r = mechanismProposalRequest(p, { requestedAt: date, source: basename(f) }); writeJson(join(out, 'extension-requests', `${r.id}.json`), r); writeText(join(out, 'extension-requests', `${r.id}.md`), extensionRequestMarkdown(r, 'en')); extra = ` → extension request ${r.id} (no mapsTo)`; }
      }
      log(`${f}: ${w.kind} ${id} → ${target}${extra}`);
    } catch (e) {
      const msg = (e as Error).message;
      const req = extensionRequestFromError(msg, { id: basename(f), requestedAt: date, source: basename(f) });
      if (req) { writeJson(join(out, 'extension-requests', `${req.id}.json`), req); writeText(join(out, 'extension-requests', `${req.id}.md`), extensionRequestMarkdown(req, 'en')); log(`${f}: not a data update — extension request ${req.id} written (${msg})`); }
      else fail(`${f}: ${msg}`);
    }
  }
}

const loadTableOrWorksheet = <T>(p: string, kind: 'device-fit' | 'koujing-mapping', parseJson: (v: unknown) => T): T => {
  if (p.endsWith('.json')) return parseJson(readJson(p));
  const w = parseWorksheet(readText(p));
  if (w.kind !== kind) fail(`${p}: expected a ${kind} worksheet, got ${w.kind}`);
  return w.value as unknown as T;
};
function normalize(a: Args): void {
  const dev = a.flag('devices'), map = a.flag('mapping'), id = a.flag('id');
  if (!dev || !map || !id) fail('usage: hacd ingest normalize --devices <device-fit.md|json> --mapping <koujing-mapping.md|json> --id <override id> [--source txt] [--unmapped warn] [--out data-staging/staged]');
  const table = loadTableOrWorksheet(dev, 'device-fit', parseDeviceFitTable), mapping = loadTableOrWorksheet(map, 'koujing-mapping', parseKoujingMapping);
  const out = a.flag('out') ?? join('data-staging', 'staged');
  const { override, report } = normalizeFaultRates(table, mapping, { id, source: a.flag('source'), unmapped: a.flag('unmapped') === 'warn' ? 'warn' : 'error' });
  writeJson(join(out, 'fault-rates', `${id}.json`), override);
  writeText(join(out, 'fault-rates', `${id}.md`), faultRateOverrideToWorksheet(override));
  writeJson(join(out, 'fault-rates', `${id}.report.json`), report);
  console.log(`# ${id}: ${report.classes.length} classes from ${table.rows.length} devices through mapping ${mapping.id}${mapping.version ? ` ${mapping.version}` : ''} (business-impact FIT per unit-hour)`);
  console.log(pad([['class', 'unit', 'FIT/unit-h', 'confidence', 'terms'], ...report.classes.map((c) => [c.class, c.unit, c.fit.toPrecision(6), c.confidence, c.terms.map((t) => `${t.device} ${t.contribution.toPrecision(4)}`).join(' + ')])]));
  for (const w of report.warnings) log(`warning: ${w}`);
  log(`written: ${join(out, 'fault-rates', `${id}.json`)} (+ .md worksheet, .report.json)`);
}
function importFit(a: Args, rest: string[]): void {
  const file = positional(rest)[0], id = a.flag('id');
  if (!file || !id) fail('usage: hacd ingest import-fit <book.xlsx|csv> --id <table id> [--sheet name] [--columns device=Part,value=2,unit=Unit,source=…,loc=…,sourceType=…,note=…] [--unit FIT|per_1e6_h|per_h|mtbf_h|afr] [--source-type field|vendor|prediction|paper|assumed] [--row-source txt] [--header-row n] [--source txt] [--out dir]');
  const wb = readWorkbook(new Uint8Array(readFileSync(file)), basename(file));
  const sheet = a.flag('sheet') ? wb.sheets.find((s) => s.name === a.flag('sheet')) ?? fail(`no sheet '${a.flag('sheet')}' (sheets: ${wb.sheets.map((s) => s.name).join(', ')})`) : wb.sheets[0];
  const columns: Partial<Record<DeviceColumn, number | string>> = {};
  for (const kv of list(a.flag('columns'))) { const [k, v] = kv.split('='); if (!k || v === undefined) fail(`bad --columns entry '${kv}'`); columns[k as DeviceColumn] = /^\d+$/.test(v) ? Number(v) : v; }
  const unit = a.flag('unit') as DeviceRateUnit | undefined, sourceType = a.flag('source-type') as SourceType | undefined;
  if (unit && !(DEVICE_RATE_UNITS as readonly string[]).includes(unit)) fail(`--unit must be one of ${DEVICE_RATE_UNITS.join(', ')}`);
  if (sourceType && !(SOURCE_TYPES as readonly string[]).includes(sourceType)) fail(`--source-type must be one of ${SOURCE_TYPES.join(', ')}`);
  const hr = a.flag('header-row');
  const r = deviceTableFromSheet(sheet, { id, source: a.flag('source') ?? `${basename(file)} / ${sheet.name}`, columns, unit, sourceType, rowSource: a.flag('row-source'), headerRow: hr !== undefined ? Number(hr) - 1 : undefined });
  const out = a.flag('out') ?? join('data-staging', 'staged');
  writeJson(join(out, 'device-fit', `${id}.json`), r.table);
  writeText(join(out, 'device-fit', `${id}.md`), deviceTableToWorksheet(r.table));
  console.log(`# ${id}: ${r.table.rows.length} devices from ${basename(file)} / ${sheet.name}, header row ${r.headerRow + 1}, columns ${JSON.stringify(r.columns)}`);
  console.log(pad([['device', 'value', 'unit', 'sourceType', 'source'], ...r.table.rows.map((x) => [x.device, x.value, x.unit, x.sourceType, x.source])]));
  for (const s of r.skipped) log(`skipped row ${s.row}: ${s.reason}`);
  log(`written: ${join(out, 'device-fit', `${id}.md`)} (+ .json) — review it, then write the 口径 mapping and run hacd ingest normalize`);
}

function validateCmd(a: Args, rest: string[]): void {
  const paths = positional(rest);
  if (!paths.length) fail('usage: hacd ingest validate <dir|staged.json>… [--envelope 0.1,10] [--json]');
  const st = loadStaged(paths);
  const env = list(a.flag('envelope')).map(Number);
  const envelope = env.length === 2 ? ([env[0], env[1]] as [number, number]) : undefined;
  const issues: Issue[] = [...st.schemaIssues];
  const ex = existingIds();
  const pre = (p: string, xs: Issue[]) => xs.map((i) => ({ ...i, path: `${basename(p)}: ${i.path}` }));
  for (const r of st.records) issues.push(...pre(r.path, validateInputs({ record: r.value }, { publicIds: PUBLIC_IDS, existingIds: ex, envelope })));
  for (const o of st.rates) issues.push(...pre(o.path, validateInputs({ rates: o.value }, { publicIds: PUBLIC_IDS, existingIds: ex, envelope, template: st.records[0]?.value.template })));
  for (const s of st.sets) issues.push(...pre(s.path, validateInputs({ set: s.value }, { publicIds: PUBLIC_IDS, existingIds: ex })));
  for (const p of st.others) issues.push({ level: 'info', code: 'not-a-record', path: p, message: { zh: '不是记录文件', en: 'not a record file (skipped)' } });
  if (a.has('json')) console.log(JSON.stringify({ files: { records: st.records.length, rates: st.rates.length, sets: st.sets.length, proposals: st.proposals.length, requests: st.requests.length }, issues }, null, 1));
  else { console.log(`${st.records.length} records, ${st.rates.length} overrides, ${st.sets.length} sets, ${st.proposals.length} proposals, ${st.requests.length} extension requests\n`); printIssues(issues); }
  if (hasErrors(issues)) process.exit(1);
}
const resolveRecordArg = (spec: string): TopologyRecord => (existsSync(spec) ? parseTopologyRecord(readJson(spec)) : resolveRecord(spec));
/**
 * the gates over a dry run's or a diff's inputs: content gates for every input, id checks only for inputs given as staged files
 * (an input resolved by id from the data folder is a record in use, not one being promoted)
 */
function gateIssues(inputs: { record: TopologyRecord; rates?: FaultRateOverride; set: MechanismSet }, specs: { record: string; rates?: string; set?: string }): Issue[] {
  const ex = existingIds();
  const fromFile = (s?: string) => !!s && existsSync(s);
  const idsIf = (file: boolean) => (file ? { publicIds: PUBLIC_IDS, existingIds: ex } : {});
  return [
    ...validateInputs({ record: inputs.record }, idsIf(fromFile(specs.record))),
    ...(inputs.rates ? validateInputs({ rates: inputs.rates }, { ...idsIf(fromFile(specs.rates)), template: inputs.record.template }) : []),
    ...validateInputs({ set: inputs.set }, idsIf(fromFile(specs.set))),
  ];
}
const resolveRatesArg = (spec: string | undefined): FaultRateOverride | undefined => (spec && existsSync(spec) ? parseFaultRateOverride(readJson(spec)) : resolveRates(spec));

function dryRun(a: Args, json: boolean): void {
  const spec = a.flag('record');
  if (!spec) fail('usage: hacd ingest dry-run --record <id|path> [--rates <id|path>] [--mechanisms <id|path>] [--scales 10000,100000] [--target 0.985] [--trials 400] [--seed 1] [--json]');
  const rec = resolveRecordArg(spec), set = resolveSetArg(a.flag('mechanisms')), rates = resolveRatesArg(a.flag('rates'));
  const scales = nums(a.flag('scales'), [10000, 100000]), target = Number(a.flag('target') ?? 0.985), trials = Number(a.flag('trials') ?? 400), seed = Number(a.flag('seed') ?? 1);
  const issues = gateIssues({ record: rec, rates, set }, { record: spec, rates: a.flag('rates'), set: a.flag('mechanisms') });
  const t0 = Date.now();
  const d = budgetFromRecords([rec], set, { sizes: scales, target, trials, seed, rates, onProgress: (_x, n, step) => log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${n} ${step}`) });
  const rows = scales.map((n) => kpiRow(d.archs[rec.id].sizes[String(n)], n));
  if (json) { console.log(JSON.stringify({ record: rec.id, set: set.id, rates: rates?.id ?? null, target, trials, seed, rows, issues }, null, 1)); return; }
  const p = (x: number) => `${(x * 100).toFixed(3)} %`;
  console.log(`# dry run ${rec.name.en} · set ${set.id}${rates ? ` · override ${rates.id} (${rates.basis})` : ' · unit-library rates'} · target A_op ≥ ${(target * 100).toFixed(1)} % · ${trials} windows · seed ${seed}`);
  console.log('口径: A_op of one synchronous job per cluster-hour; MTBF_hw = 1/Σλ (hard), MTTR_hw = rate-weighted mean pause (formula 1); P = share of 30-day windows with A_op ≥ A*; k = uniform hardware factor of the window rule (formula 6)');
  console.log(pad([['scale', 'A_op', 'A_op derated', 'delivered', 'MTBF_hw', 'MTTR_hw', 'P(window)', 'B s/h', 'k', 'recommended', 'effort'], ...rows.map((r) => [r.scale, p(r.aOp), p(r.aOpDerated), p(r.delivered), `${r.mtbfHwH.toFixed(2)} h`, `${r.mttrS.toFixed(1)} s`, `${(r.windowP * 100).toFixed(1)} % ${r.verdict}`, r.B.toFixed(1), r.k.toFixed(3), `${r.mechanisms.join('+') || '—'} | ${r.levers.join('+') || '—'}`, r.effort.toFixed(1)])]));
  console.log('');
  printIssues(issues);
}

function diff(a: Args, json: boolean): void {
  const common = a.flag('record');
  const afterSpec = a.flag('after-record') ?? common, beforeSpec = a.flag('before-record') ?? (a.flag('after-record') ? undefined : common);
  if (!afterSpec) fail('usage: hacd ingest diff --record <id|path> | --after-record <id|path> [--before-record <id|path>] [--before-rates] [--after-rates] [--before-set] [--after-set] [--scales 10000,100000] [--target 0.985] [--trials 400] [--seed 1] [--out data-staging/delta-<date>] [--json]');
  const after: DeltaInputs = { record: resolveRecordArg(afterSpec), set: resolveSetArg(a.flag('after-set')), rates: resolveRatesArg(a.flag('after-rates')) };
  const before: DeltaInputs | null = beforeSpec ? { record: resolveRecordArg(beforeSpec), set: resolveSetArg(a.flag('before-set')), rates: resolveRatesArg(a.flag('before-rates')) } : null;
  const scales = nums(a.flag('scales'), [10000, 100000]), target = Number(a.flag('target') ?? 0.985), trials = Number(a.flag('trials') ?? 400), seed = Number(a.flag('seed') ?? 1);
  const issues = gateIssues(after, { record: afterSpec, rates: a.flag('after-rates'), set: a.flag('after-set') });
  const t0 = Date.now();
  const delta = deltaDocument(before, after, { scales, target, trials, seed, generated: today(), issues, onProgress: (_x, n, step) => log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${n} ${step}`) });
  const out = a.flag('out') ?? join('data-staging', `delta-${today()}`);
  const provenance = { command: a.command, engine: engine() };
  const data = delta as unknown as Record<string, unknown>;
  writeJson(join(out, 'delta.json'), delta);
  writeText(join(out, 'delta.md'), deltaMarkdown(data, 'en'));
  writeText(join(out, 'delta.zh.md'), deltaMarkdown(data, 'zh'));
  if (!a.has('no-html')) writeText(join(out, 'delta.html'), deltaHtml({ delta: data, provenance }));
  writeJson(join(out, 'provenance.json'), provenance);
  if (json) console.log(JSON.stringify(delta, null, 1)); else process.stdout.write(deltaMarkdown(data, 'en'));
  log(`written: ${out}/delta.{json,md,zh.md${a.has('no-html') ? '' : ',html'}}`);
}

function promote(a: Args, rest: string[]): void {
  const paths = positional(rest);
  if (!paths.length) fail('usage: hacd ingest promote <dir|staged.json>… [--data <dir>] [--force]');
  const data = a.flag('data') ?? DATA;
  const st = loadStaged(paths);
  if (st.schemaIssues.length) { printIssues(st.schemaIssues); fail('schema errors: nothing promoted'); }
  const ex = existingIds(data);
  const items: { kind: 'record' | 'rates' | 'set'; id: string; path: string; value: unknown; issues: Issue[] }[] = [
    ...st.records.map((r) => ({ kind: 'record' as const, id: r.value.id, path: r.path, value: r.value, issues: validateInputs({ record: r.value }, { publicIds: PUBLIC_IDS, existingIds: ex }) })),
    ...st.rates.map((o) => ({ kind: 'rates' as const, id: o.value.id, path: o.path, value: o.value, issues: validateInputs({ rates: o.value }, { publicIds: PUBLIC_IDS, existingIds: ex }) })),
    ...st.sets.map((s) => ({ kind: 'set' as const, id: s.value.id, path: s.path, value: s.value, issues: validateInputs({ set: s.value }, { publicIds: PUBLIC_IDS, existingIds: ex }) })),
  ];
  if (!items.length) fail('nothing to promote (no records, overrides or sets among the inputs)');
  const all = items.flatMap((x) => x.issues.map((i) => ({ ...i, path: `${basename(x.path)}: ${i.path}` })));
  printIssues(all);
  if (hasErrors(all)) fail('errors: nothing promoted');
  const exists = items.filter((x) => x.issues.some((i) => i.code === 'id-exists'));
  if (exists.length && !a.has('force')) fail(`ids already in ${data}: ${exists.map((x) => x.id).join(', ')} — pass --force to overwrite`);
  const dirOf = { record: 'records', rates: 'fault-rates', set: 'mechanism-sets' } as const;
  const changelog = join(data, 'CHANGELOG.md');
  if (!existsSync(changelog)) writeText(changelog, '# Data changelog\n\nPromoted by `hacd ingest promote` (date · kind · id · sha256 of the file · staged source).\n\n');
  for (const x of items) {
    const target = join(data, dirOf[x.kind], `${x.id}.json`);
    const text = JSON.stringify(x.value, null, 1) + '\n';
    writeText(target, text);
    appendFileSync(changelog, `- ${today()} · ${x.kind} · \`${x.id}\` · ${sha(text).slice(0, 16)} · from ${x.path}\n`);
    log(`promoted ${x.kind} ${x.id} → ${target}`);
  }
  log(`next: npm test · node packages/reports/test/reproduce.mjs · hacd findings --record ${items.find((x) => x.kind === 'record')?.id ?? '<id>'} ${items.some((x) => x.kind === 'rates') ? `--rates ${items.find((x) => x.kind === 'rates')!.id} ` : ''}--out <dir>`);
}

/* ---------------- extract (the model step, @hac-d/agent) ---------------- */
interface AgentModule {
  adapterFromSpec(spec: Record<string, unknown>): unknown;
  extractDocuments(o: Record<string, unknown>): Promise<{ accepted: unknown[]; disputed: unknown[]; rejected: unknown[]; chunks: number; calls: number; model: string; log: unknown[]; reviewMarkdown: string }>;
  draftWorksheet(kind: string, cards: unknown[], o: Record<string, unknown>): string;
}
async function extract(a: Args, rest: string[]): Promise<void> {
  const docs = positional(rest), kind = a.flag('kind'), provider = a.flag('provider') ?? 'none';
  if (!docs.length || !kind || !['topology', 'device-fit', 'mechanisms'].includes(kind)) fail('usage: hacd ingest extract <doc.txt|md>… --kind topology|device-fit|mechanisms --provider openai-compatible|mock|none [--base-url http://host:8000/v1] [--model name] [--api-key-env NAME] [--mode json_schema|guided_json|fenced] [--passes 2] [--chunk 2500] [--overlap 200] [--source-type field|vendor|prediction|paper|assumed] [--id x] [--template a950-ub2] [--family 950] [--out data-staging/extract-<date>]');
  if (provider === 'none') fail("a model is needed for extraction: --provider openai-compatible --base-url … --model … (the deterministic steps — worksheet, normalize, validate, dry-run, diff, promote — need no model)");
  for (const d of docs) if (extname(d).toLowerCase() === '.pdf') fail(`${d}: convert PDFs to text first (pdftotext -layout file.pdf file.txt); the extractor reads .txt / .md`);
  let agent: AgentModule;
  try { agent = (await import('@hac-d/agent')) as unknown as AgentModule; } catch (e) { return fail(`@hac-d/agent is not available (${(e as Error).message})`); }
  const keyEnv = a.flag('api-key-env');
  const apiKey = keyEnv ? process.env[keyEnv] : undefined;
  if (keyEnv && !apiKey) fail(`environment variable ${keyEnv} is not set`);
  // --provider mock: a model that finds nothing, to test the plumbing (chunking, files, review page) without an endpoint
  const adapter = agent.adapterFromSpec({ provider, baseUrl: a.flag('base-url'), model: a.flag('model'), apiKey, mode: a.flag('mode'), temperature: a.flag('temperature') !== undefined ? Number(a.flag('temperature')) : undefined, seed: a.flag('seed') !== undefined ? Number(a.flag('seed')) : undefined, ...(provider === 'mock' ? { mock: () => '{"cards":[]}' } : {}) });
  const out = a.flag('out') ?? join('data-staging', `extract-${today()}`);
  mkdirSync(out, { recursive: true });
  const logPath = join(out, 'log.jsonl');
  const t0 = Date.now();
  const result = await agent.extractDocuments({
    docs: docs.map((p) => ({ name: basename(p), text: readText(p) })), kind, adapter,
    passes: Number(a.flag('passes') ?? 2), chunkChars: Number(a.flag('chunk') ?? 2500), overlapChars: Number(a.flag('overlap') ?? 200),
    log: (e: unknown) => appendFileSync(logPath, JSON.stringify(e) + '\n'),
    onProgress: (m: string) => log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`),
  });
  writeJson(join(out, 'cards.json'), result.accepted);
  writeJson(join(out, 'disputed.json'), result.disputed);
  writeJson(join(out, 'rejected.json'), result.rejected);
  writeText(join(out, 'review.md'), result.reviewMarkdown);
  const sourceType = a.flag('source-type');
  if (sourceType) {
    if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) fail(`--source-type must be one of ${SOURCE_TYPES.join(', ')}`);
    const id = a.flag('id') ?? `internal-${basename(docs[0]).replace(/\.[^.]+$/, '')}`;
    const draft = agent.draftWorksheet(kind, result.accepted, { id, sourceType, template: a.flag('template'), family: a.flag('family'), source: docs.map((d) => basename(d)).join(', ') });
    writeText(join(out, `${kind}.md`), draft);
    log(`draft worksheet: ${join(out, `${kind}.md`)} — complete it, then hacd ingest worksheet`);
  } else log('no --source-type given: cards written, no draft worksheet (the confidence policy needs the source type)');
  log(`${result.chunks} chunks, ${result.calls} calls to ${result.model}: ${result.accepted.length} accepted, ${result.disputed.length} disputed, ${result.rejected.length} rejected → ${out}/{cards,disputed,rejected}.json, review.md, log.jsonl`);
}

const HELP = `hacd ingest — worksheets → staged records → gates → KPI delta → promote (docs/markdown/PLAN_V6_INPUT_MIGRATION.md)
  template <kind>                      example worksheet (${WORKSHEET_KINDS.join(' | ')})
  fields <kind> [--json] | --vocab     field paths of a kind, or every closed vocabulary
  worksheet <ws.md>… [--out dir] [--base set]        worksheets → staged JSON records
  normalize --devices f --mapping f --id x [--out]   device FIT × 口径 mapping → failure-rate override (+ worksheet, report)
  import-fit <book> --id x [--sheet] [--columns] [--unit] [--source-type] [--out]   spreadsheet → device table worksheet
  validate <dir|file>… [--envelope lo,hi] [--json]   gates; exit 1 on errors
  dry-run --record r [--rates] [--mechanisms] [--scales] [--target] [--trials] [--seed] [--json]
  diff --record r | --after-record r [--before-record] [--before-rates] [--after-rates] [--before-set] [--after-set] [--scales] [--target] [--trials] [--seed] [--out] [--json]
  promote <dir|file>… [--data dir] [--force]        copy validated records into the data folder (own ids only); CHANGELOG
  extract <docs>… --kind k --provider p …           model step (@hac-d/agent): evidence cards, review queue, draft worksheet
  run --staging dir [--worksheets dir] [--before-record r] [--promote] [--out dir] …   v6.1 one call: worksheets → validate → dry-run → diff → promote → findings; run.json + SUMMARY.md (docs/markdown/AGENT_OPERATOR.md)
  protocol [--lang zh|en] [--tools] [--fix-table]   the operator protocol for an on-prem model: system prompt, tool manifest, fix table
Data folder: ${DATA}${process.env.HACD_DATA ? ' (HACD_DATA)' : ''}`;

export async function ingest(rest: string[]): Promise<void> {
  const [sub, ...args] = rest;
  const a = argsOf(`ingest ${sub ?? ''}`.trim(), args);
  const json = args.includes('--json');
  switch (sub) {
    case 'template': return template(args);
    case 'fields': return fields(a, args);
    case 'worksheet': return worksheet(a, args);
    case 'normalize': return normalize(a);
    case 'import-fit': return importFit(a, args);
    case 'validate': return validateCmd(a, args);
    case 'dry-run': return dryRun(a, json);
    case 'diff': return diff(a, json);
    case 'promote': return promote(a, args);
    case 'extract': return extract(a, args);
    case 'run': return runPipeline(a, args);
    case 'protocol': return protocol(a);
    case 'help': case undefined: case '--help': console.log(HELP); return;
    default: fail(`unknown subcommand '${sub}'\n${HELP}`);
  }
}
