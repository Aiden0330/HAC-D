/**
 * v5 report pipeline commands of the hacd CLI (docs/markdown/PLAN_V5_REPORT_PIPELINE.md §4): topology record + failure-rate
 * override + mechanism set + scales and target → the hierarchical budget (results.json), the Shapley studies (<record>.json), the
 * mechanism hierarchy (mechanisms.json), the BOM (bom.json) and the bilingual Findings / Methodology / BOM reports, with no code
 * change for a new record. The numbers are the core's (@hac-d/core); the HTML is the @hac-d/reports recipes', whose footer echoes
 * the command, the record / set / override ids, the run options and the engine version (`provenance`).
 *
 * Inputs are resolved by id or path: a record is a built-in id (BUILTIN_TOPOLOGY_RECORDS), a JSON path, or
 * packages/core/data/records/<id>.json; a mechanism set the default id, a path, or packages/core/data/mechanism-sets/<id>.json; a
 * failure-rate override a path or packages/core/data/fault-rates/<id>.json. Sidecar JSON goes to --data-out (default <out>/data).
 * v6.3: the sidecar also holds `records.json` (the records as resolved for the run: the Findings pages draw their Figure 1 from
 * them), and `hacd findings --data` accepts a bundle file (`<id>-findings-data.json` of the web app's Report tab: results,
 * mechanisms, provenance, studies and records in one JSON) as well as a folder.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  BUILTIN_TOPOLOGY_RECORDS, parseTopologyRecord, recordSuperpod, topologyRecordJsonSchema, type TopologyRecord,
  DEFAULT_MECHANISM_SET, parseMechanismSet, resolveMechanismSet, mechanismSetJsonSchema, type MechanismSet,
  parseFaultRateOverride, faultRateOverrideJsonSchema, type FaultRateOverride,
  budgetFromRecords, bomDocument, mechanismHierarchy, archStudy, pruneByShapley, shapleyAtScale, HIERARCHY_DEFAULT_IDS,
  type StoredStudy, type ArchStudy, type BudgetDocument, type MechanismVerdict,
} from '@hac-d/core';
import { findingsHtml, methodologyHtml, bomHtml, FINDINGS_FILES, type ReportProvenance } from '@hac-d/reports';

const CORE = fileURLToPath(new URL('../../core/', import.meta.url));
/** the data folder of the records (HACD_DATA overrides it: the offline bundle ships the folder beside the executable) */
export const DATA = process.env.HACD_DATA ? resolve(process.env.HACD_DATA) : join(CORE, 'data');
const DEFAULT_SCALES = [10000, 100000, 200000, 500000];

/* ---------------- arguments ---------------- */
type Args = { flag: (name: string) => string | undefined; has: (name: string) => boolean; command: string };
export function argsOf(cmd: string, rest: string[]): Args {
  const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  return {
    flag: (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 && i + 1 < rest.length && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined; },
    has: (name) => rest.includes(`--${name}`),
    command: ['hacd', cmd, ...rest].map(quote).join(' '),
  };
}
const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const nums = (s: string | undefined, dflt: number[]) => { const v = list(s).map(Number); if (v.some((x) => !(x > 0))) fail(`bad number list '${s}'`); return v.length ? v : dflt; };
function fail(msg: string): never { console.error(`hacd: ${msg}`); process.exit(1); }
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p: string, v: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1)); };
const writeText = (p: string, v: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, v); };
/** what the recipes read: the data as it is in the sidecar files */
const asFile = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v));
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

/* ---------------- inputs by id or path ---------------- */
export const dataIds = (dir: string) => (existsSync(join(DATA, dir)) ? readdirSync(join(DATA, dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
export function resolveRecord(spec: string): TopologyRecord {
  const b = (BUILTIN_TOPOLOGY_RECORDS as Record<string, TopologyRecord>)[spec];
  if (b) return b;
  const p = existsSync(spec) ? spec : join(DATA, 'records', `${spec}.json`);
  if (!existsSync(p)) fail(`unknown topology record '${spec}' (built-in: ${Object.keys(BUILTIN_TOPOLOGY_RECORDS).join(', ')}; in ${join(DATA, 'records')}: ${dataIds('records').join(', ')}; or a JSON path)`);
  try { return parseTopologyRecord(readJson(p)); } catch (e) { fail((e as Error).message); }
}
export function resolveSet(spec: string | undefined): MechanismSet {
  if (!spec || spec === DEFAULT_MECHANISM_SET.id) return DEFAULT_MECHANISM_SET;
  const p = existsSync(spec) ? spec : join(DATA, 'mechanism-sets', `${spec}.json`);
  if (!existsSync(p)) fail(`unknown mechanism set '${spec}' (default ${DEFAULT_MECHANISM_SET.id}; in ${join(DATA, 'mechanism-sets')}: ${dataIds('mechanism-sets').join(', ')}; or a JSON path)`);
  try { return parseMechanismSet(readJson(p)); } catch (e) { fail((e as Error).message); }
}
export function resolveRates(spec: string | undefined): FaultRateOverride | undefined {
  if (!spec) return undefined;
  const p = existsSync(spec) ? spec : join(DATA, 'fault-rates', `${spec}.json`);
  if (!existsSync(p)) fail(`unknown failure-rate override '${spec}' (in ${join(DATA, 'fault-rates')}: ${dataIds('fault-rates').join(', ')}; or a JSON path)`);
  try { return parseFaultRateOverride(readJson(p)); } catch (e) { fail((e as Error).message); }
}
/** the record with its SuperPoD geometry resolved over the preset (what the overlay schematic reads) */
const resolvedRecord = (r: TopologyRecord) => asFile({ ...r, superpod: recordSuperpod(r) });

/** engine version (packages/core/package.json) and the short git hash, '-dirty' when tracked files are modified */
export function engine(): ReportProvenance['engine'] {
  let version = process.env.HACD_VERSION ?? '';
  if (!version) { try { version = (readJson(join(CORE, 'package.json')) as { version: string }).version; } catch { version = '?'; } }
  try {
    const git = (a: string[]) => execFileSync('git', a, { cwd: CORE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const hash = git(['rev-parse', '--short', 'HEAD']);
    return { version, commit: `${hash}${git(['status', '--porcelain', '--untracked-files=no']) ? '-dirty' : ''}` };
  } catch { return { version }; }
}
function provenanceOf(a: Args, records: TopologyRecord[], set: MechanismSet, rates: FaultRateOverride | undefined, options: ReportProvenance['options'], command = a.command): ReportProvenance {
  return { command, records: records.map((r) => ({ id: r.id, name: r.name })), set: { id: set.id, source: set.source }, ...(rates ? { rates: { id: rates.id, basis: rates.basis } } : {}), options, engine: engine() };
}

/* ---------------- Shapley studies: reuse a stored one when it fits, else compute ---------------- */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));
/** null when the stored study was computed for this record, set (players and parameters), override, target and the given sizes; else why not */
function studyMismatch(st: ArchStudy & { rates?: string | null }, rec: TopologyRecord, set: MechanismSet, rates: FaultRateOverride | undefined, sizes: number[], target: number): string | null {
  const players = resolveMechanismSet(set).players;
  if (st.arch !== rec.id) return `study of '${st.arch}'`;
  if ([...st.players].sort().join() !== [...players].sort().join()) return 'different players';
  if (canon(st.parameters ?? {}) !== canon(set.parameters ?? {})) return 'different mechanism parameters';
  if ((st.rates ?? null) !== (rates?.id ?? null)) return `failure rates ${st.rates ?? 'library'} vs ${rates?.id ?? 'library'}`;
  if (st.target !== target) return `target ${st.target}`;
  const miss = sizes.filter((n) => !st.perSize[String(n)]);
  if (miss.length) return `no values at ${miss.join(', ')}`;
  return null;
}
/** the study restricted to the report's sizes (Findings Table 7 needs sizes = results.sizes) */
const studyAt = (st: ArchStudy, sizes: number[]): ArchStudy => ({ ...st, sizes, perSize: Object.fromEntries(sizes.map((n) => [String(n), st.perSize[String(n)]])) });
function computeStudy(rec: TopologyRecord, set: MechanismSet, rates: FaultRateOverride | undefined, sizes: number[], target: number, permutations: number, seed: number) {
  const t = Date.now();
  log(`${rec.id}: computing the Shapley study (${resolveMechanismSet(set).players.length} players, ${permutations} permutations, ${sizes.join(' / ')} NPUs)…`);
  const st = archStudy(rec, set, { sizes, target, permutations, seed, rates, onProgress: (n, i, k) => log(`${rec.id}: study at ${n} done (${i} / ${k})`) });
  log(`${rec.id}: study took ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return { ...st, remap: set.remap ?? null, rates: rates?.id ?? null };
}

/* ---------------- verdict lists of the set vs the pruning rule ---------------- */
function pruneOf(set: MechanismSet, studies: Record<string, StoredStudy>, scale?: number) {
  const listed = [...set.baseline, ...set.candidates, ...set.goodputOnly, ...set.pruned, ...set.capability];
  const ids = [...HIERARCHY_DEFAULT_IDS.filter((id) => listed.includes(id)), ...listed.filter((id) => !HIERARCHY_DEFAULT_IDS.includes(id))];
  const scales = [...new Set(Object.values(studies).flatMap((s) => Object.keys(s.perSize).map(Number)))].sort((a, b) => a - b);
  const at = scale ?? scales[scales.length - 1];
  const p = pruneByShapley(shapleyAtScale(studies, at), ids, { threshold: set.prune.threshold, dominated: set.prune.dominated, reference: set.baseline });
  const listOf = (id: string): MechanismVerdict => set.baseline.includes(id) ? 'reference' : set.candidates.includes(id) ? 'candidate' : set.goodputOnly.includes(id) ? 'goodput' : set.pruned.includes(id) ? 'pruned' : 'capability';
  const mismatches = ids.filter((id) => p.verdicts[id].verdict !== listOf(id)).map((id) => ({ id, rule: p.verdicts[id].verdict, set: listOf(id), v: p.verdicts[id] }));
  return { ids, scale: at, result: p, mismatches, listOf };
}
const pt = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(3)} pt` : '—');

/* ---------------- commands ---------------- */

/**
 * hacd findings --record a,b [--rates] [--mechanisms] [--scales] [--main] [--target] [--trials] [--seed] [--study-dir] [--permutations] [--reuse-studies] [--strict-prune] [--out] [--data-out] [--no-methodology]
 * hacd findings --data <dir | bundle.json> [--record a,b] [--out docs] [--study-dir <dir>] [--no-methodology]   re-render the reports from a stored sidecar (no engine run)
 */
export function findings(a: Args): void {
  if (a.flag('data')) { renderFindings(a); return; }
  const specs = list(a.flag('record') ?? a.flag('records'));
  if (!specs.length) fail('usage: hacd findings --record <id|path>[,<id|path>…] [--rates f.json] [--mechanisms m.json] [--scales 10000,100000,200000,500000] [--main N] [--target 0.985] [--trials 400] [--seed 1] [--study-dir <dir>] [--permutations 300] [--reuse-studies] [--strict-prune] [--out docs] [--data-out <out>/data] [--no-methodology] | hacd findings --data <dir> [--record a,b] [--out docs] [--no-methodology]');
  const records = specs.map(resolveRecord);
  const set = resolveSet(a.flag('mechanisms')), rates = resolveRates(a.flag('rates'));
  const sizes = nums(a.flag('scales'), DEFAULT_SCALES);
  const main = a.flag('main') ? Number(a.flag('main')) : undefined;
  if (main !== undefined && !sizes.includes(main)) fail(`--main ${main} is not one of --scales ${sizes.join(',')}`);
  const target = Number(a.flag('target') ?? 0.985), trials = Number(a.flag('trials') ?? 400), seed = Number(a.flag('seed') ?? 1), permutations = Number(a.flag('permutations') ?? 300);
  const outDir = a.flag('out') ?? 'docs', dataOut = a.flag('data-out') ?? join(outDir, 'data'), studyDir = a.flag('study-dir') ?? dataOut;
  log(`records ${records.map((r) => r.id).join(', ')} · set ${set.id}${rates ? ` · override ${rates.id} (${rates.basis})` : ''} · ${sizes.join(' / ')} NPUs · target ${target} · ${trials} windows · seed ${seed}`);

  // 1. Shapley studies (Table 7 and the hierarchy): stored when it fits, else computed and written to the data dir
  const studies: Record<string, ArchStudy> = {};
  for (const rec of records) {
    const p = join(studyDir, `${rec.id}.json`);
    let st: ArchStudy | undefined;
    if (existsSync(p)) {
      const s = readJson(p) as ArchStudy;
      const why = studyMismatch(s, rec, set, rates, sizes, target);
      if (!why || a.has('reuse-studies')) { st = s; log(`${rec.id}: Shapley study from ${p}${why ? ` (reused although: ${why})` : ''}`); }
      else log(`${rec.id}: stored study ${p} does not fit (${why}); recomputing`);
    }
    const computed = !st;
    st ??= computeStudy(rec, set, rates, sizes, target, permutations, seed);
    studies[rec.id] = st;
    // a computed study is written next to the data; a stored one stays where it is (mechanisms.source.dir records the folder)
    if (computed) writeJson(join(dataOut, `${rec.id}.json`), st);
  }

  // 2. the hierarchical budget of every record at every scale
  const results = budgetFromRecords(records, set, { sizes, target, main, trials, seed, rates, onProgress: (arch, n, step) => { if (step === 'today') log(`budget ${arch} ${n}`); } }) as BudgetDocument;
  for (const [arch, A] of Object.entries(results.archs)) for (const [n, z] of Object.entries(A.sizes)) {
    const r = z.recommended;
    log(`${arch} ${n}: today A_op ${(z.today.aOp * 100).toFixed(3)} / ${(z.today.aOpDerated * 100).toFixed(3)} % · recommended ${r.mechanisms.join('+') || '—'} | ${r.levers.join('+') || '—'} k ${r.k.toFixed(3)} → ${(r.final.kpiDerated.aOp * 100).toFixed(2)} % derated, P ${(r.window.pAtLeastTarget * 100).toFixed(1)} %`);
  }

  // 3. the mechanism hierarchy (verdict lists of the set, checked against the pruning rule on these studies)
  const pr = pruneOf(set, studies as unknown as Record<string, StoredStudy>);
  if (pr.mismatches.length) {
    const msg = `the set's verdict lists differ from the pruning rule at ${pr.scale} NPUs on ${Object.keys(studies).join(', ')}: ${pr.mismatches.map((m) => `${m.id} (set ${m.set}, rule ${m.rule}; A_op min ${pt(m.v.aOp.min)}, delivered min ${pt(m.v.delivered.min)})`).join('; ')} — the reports keep the set's lists; 'hacd prune' re-derives them`;
    if (a.has('strict-prune')) fail(msg);
    console.error(`hacd: warning: ${msg}`);
  }
  const perms = [...new Set(Object.values(studies).map((s) => s.permutations))];
  const mechanisms = mechanismHierarchy(set, studies as unknown as Record<string, StoredStudy>, { permutations: perms.length === 1 ? perms[0] : undefined, basis: `bare architecture scenario, ${rates ? `failure-rate override ${rates.id}` : 'HAC-D per-unit FIT'}, ${set.id}`, check: false });

  // 4. sidecar JSON and the reports
  const prov = provenanceOf(a, records, set, rates, { scales: sizes, target, trials, seed, permutations: perms.length === 1 ? perms[0] : permutations });
  writeJson(join(dataOut, 'results.json'), results);
  writeJson(join(dataOut, 'mechanisms.json'), { ...mechanisms, source: { dir: studyDir, ...mechanisms.source } });
  writeJson(join(dataOut, 'provenance.json'), prov);
  writeJson(join(dataOut, 'records.json'), Object.fromEntries(records.map((r) => [r.id, resolvedRecord(r)])));
  const R = asFile(results), MX = asFile({ ...mechanisms, source: { dir: studyDir, ...mechanisms.source } });
  for (const rec of records) {
    const file = join(outDir, `ASCEND_ALLOCATION_FINDINGS_${(FINDINGS_FILES as Record<string, string>)[rec.id] ?? rec.id.toUpperCase()}.html`);
    writeText(file, findingsHtml(rec.id, { results: R, mechanisms: MX, shapley: asFile(studyAt(studies[rec.id], sizes)), record: resolvedRecord(rec), provenance: prov }));
    log(`written ${file}`);
  }
  if (!a.has('no-methodology')) {
    const file = join(outDir, 'ASCEND_ALLOCATION_METHODOLOGY.html');
    writeText(file, methodologyHtml({ results: R, mechanisms: MX, provenance: prov }));
    log(`written ${file}`);
  }
  log(`sidecar JSON in ${dataOut}: results.json, mechanisms.json, provenance.json, records.json; studies in ${studyDir}`);
}

/** v6.3 a stored sidecar: a folder (results.json, mechanisms.json, provenance.json, records.json, <id>.json studies) or one bundle file */
interface Sidecar {
  where: string;
  results: BudgetDocument;
  mechanisms: { source?: { dir?: string; set?: string } } & Record<string, unknown>;
  provenance: ReportProvenance;
  study: (id: string) => ArchStudy | undefined;
  records: Record<string, Record<string, unknown>>;
  /** a folder without records.json: the records resolved now are written back so the next render (and reproduce.mjs) uses them */
  writeRecords?: (recs: Record<string, Record<string, unknown>>) => void;
}
/** the bundle file of the web app's Report tab (`<id>-findings-data.json`): results, mechanisms, provenance, studies and records in one JSON */
interface SidecarBundle { results: BudgetDocument; mechanisms: Sidecar['mechanisms']; provenance?: ReportProvenance; studies?: Record<string, ArchStudy>; records?: Record<string, Record<string, unknown>> }
function readSidecar(spec: string, studyDirFlag?: string): Sidecar {
  if (!existsSync(spec)) fail(`${spec} not found: --data takes the sidecar folder of a findings run or its bundle file (<id>-findings-data.json)`);
  if (spec.endsWith('.json')) {
    const b = readJson(spec) as SidecarBundle;
    if (!b.results || !b.mechanisms) fail(`${spec}: a sidecar bundle needs results and mechanisms (and provenance, studies, records)`);
    if (!b.provenance) fail(`${spec}: the bundle carries no provenance`);
    return { where: spec, results: b.results, mechanisms: b.mechanisms, provenance: b.provenance, study: (id) => b.studies?.[id], records: b.records ?? {} };
  }
  const dir = spec;
  const results = readJson(join(dir, 'results.json')) as BudgetDocument;
  const mechanisms = readJson(join(dir, 'mechanisms.json')) as Sidecar['mechanisms'];
  const studyDir = studyDirFlag ?? mechanisms.source?.dir ?? dir;
  const pp = join(dir, 'provenance.json');
  if (!existsSync(pp)) fail(`${pp} not found: a render-only run needs the provenance the hacd run stored next to the data`);
  const rp = join(dir, 'records.json');
  const stored = existsSync(rp) ? (readJson(rp) as Record<string, Record<string, unknown>>) : undefined;
  return {
    where: dir, results, mechanisms, provenance: readJson(pp) as ReportProvenance,
    study: (id) => { const sp = existsSync(join(dir, `${id}.json`)) ? join(dir, `${id}.json`) : join(studyDir, `${id}.json`); return existsSync(sp) ? (readJson(sp) as ArchStudy) : undefined; },
    records: stored ?? {},
    ...(stored ? {} : { writeRecords: (recs) => { writeJson(rp, recs); log(`written ${rp} (the records as resolved now; the Findings pages draw Figure 1 from them)`); } }),
  };
}

/**
 * Render-only: the Findings pages (and the Methodology unless --no-methodology) from a stored sidecar — a folder (results.json,
 * mechanisms.json, provenance.json, records.json, the <record>.json studies there or in --study-dir / mechanisms.source.dir) or the
 * bundle file the web app's Report tab downloads — after a change to a recipe in @hac-d/reports. The stored provenance is used
 * unchanged, so the output equals what `node packages/reports/test/reproduce.mjs` renders and compares with the committed docs/*.html.
 * --record restricts the architectures (default: every one in results.json). A folder without records.json gets one from the
 * records resolved now (built-in or the data folder's).
 */
function renderFindings(a: Args): void {
  const sc = readSidecar(a.flag('data')!, a.flag('study-dir'));
  const { results } = sc;
  const outDir = a.flag('out') ?? 'docs';
  const ids = a.flag('record') || a.flag('records') ? list(a.flag('record') ?? a.flag('records')) : Object.keys(results.archs);
  const R = asFile(results), MX = asFile(sc.mechanisms);
  const resolvedNow: Record<string, Record<string, unknown>> = {};
  for (const id of ids) {
    if (!results.archs[id]) fail(`results.json has no architecture '${id}' (${Object.keys(results.archs).join(', ')})`);
    const st = sc.study(id);
    if (!st) fail(`no Shapley study for '${id}' in ${sc.where}`);
    let record = sc.records[id];
    if (!record) {
      const rec = (BUILTIN_TOPOLOGY_RECORDS as Record<string, TopologyRecord>)[id] ?? (existsSync(join(DATA, 'records', `${id}.json`)) ? parseTopologyRecord(readJson(join(DATA, 'records', `${id}.json`))) : undefined);
      if (!rec) fail(`no topology record for '${id}': not in ${sc.where} (records.json), not built in, not in ${join(DATA, 'records')}`);
      record = resolvedNow[id] = resolvedRecord(rec);
    }
    const file = join(outDir, `ASCEND_ALLOCATION_FINDINGS_${(FINDINGS_FILES as Record<string, string>)[id] ?? id.toUpperCase()}.html`);
    writeText(file, findingsHtml(id, { results: R, mechanisms: MX, shapley: asFile(studyAt(st, results.sizes)), record, provenance: sc.provenance }));
    log(`written ${file} (from ${sc.where})`);
  }
  if (sc.writeRecords && Object.keys(resolvedNow).length === Object.keys(results.archs).length) sc.writeRecords(resolvedNow);
  if (!a.has('no-methodology')) {
    const file = join(outDir, 'ASCEND_ALLOCATION_METHODOLOGY.html');
    writeText(file, methodologyHtml({ results: R, mechanisms: MX, provenance: sc.provenance }));
    log(`written ${file} (from ${sc.where})`);
  }
}

/** hacd methodology --data <dir> [--out docs/ASCEND_ALLOCATION_METHODOLOGY.html] */
export function methodology(a: Args): void {
  const dir = a.flag('data');
  if (!dir) fail('usage: hacd methodology --data <dir with results.json, mechanisms.json[, provenance.json]> [--out docs/ASCEND_ALLOCATION_METHODOLOGY.html]');
  const results = readJson(join(dir, 'results.json')) as BudgetDocument & Record<string, unknown>;
  const mechanisms = readJson(join(dir, 'mechanisms.json')) as { source: { set: string } } & Record<string, unknown>;
  const out = a.flag('out') ?? 'docs/ASCEND_ALLOCATION_METHODOLOGY.html';
  const pp = join(dir, 'provenance.json');
  const prov: ReportProvenance = existsSync(pp)
    ? (() => { const p = readJson(pp) as ReportProvenance; return { ...p, command: `${p.command} → ${a.command}` }; })()
    : { command: a.command, records: Object.entries(results.archs).map(([id, x]) => ({ id, name: x.name })), set: { id: mechanisms.source.set }, rates: { id: 'not recorded', basis: 'no provenance.json in the data folder' }, options: { scales: results.sizes, target: results.target, trials: results.trials }, engine: engine() };
  if (!existsSync(pp)) console.error(`hacd: warning: ${pp} not found; the footer names what results.json records`);
  writeText(out, methodologyHtml({ results, mechanisms, provenance: prov }));
  log(`written ${out}`);
}

/** hacd bom --records a,b [--npus 100000] [--sizes …] [--out docs/ASCEND_BOM_100K.html] [--data-out <dir of out>/data] */
export function bom(a: Args): void {
  const specs = list(a.flag('records') ?? a.flag('record'));
  const records = specs.length ? specs.map(resolveRecord) : Object.values(BUILTIN_TOPOLOGY_RECORDS);
  const npus = Number(a.flag('npus') ?? 100000);
  const sizes = a.flag('sizes') ? nums(a.flag('sizes'), DEFAULT_SCALES) : undefined;
  const out = a.flag('out') ?? 'docs/ASCEND_BOM_100K.html', dataOut = a.flag('data-out') ?? join(dirname(out), 'data');
  const doc = bomDocument(records, npus, sizes);
  writeJson(join(dataOut, 'bom.json'), doc);
  log(`written ${join(dataOut, 'bom.json')}: ${doc.designs.length} designs at ${npus.toLocaleString('en-US')} NPUs`);
  const prov = provenanceOf(a, records, DEFAULT_MECHANISM_SET, undefined, { npus, scales: sizes ?? DEFAULT_SCALES });
  writeJson(join(dataOut, 'bom-provenance.json'), prov);
  writeText(out, bomHtml({ bom: asFile(doc), provenance: prov }));
  log(`written ${out}`);
}

/** hacd budget --record <id|path> --scale N [--rates] [--mechanisms] [--target] [--trials] [--seed] [--json] */
export function budget(a: Args, json: boolean): void {
  const spec = a.flag('record'), scale = Number(a.flag('scale') ?? NaN);
  if (!spec || !(scale > 0)) fail('usage: hacd budget --record <id|path> --scale 500000 [--rates f.json] [--mechanisms m.json] [--target 0.985] [--trials 400] [--seed 1] [--json]');
  const rec = resolveRecord(spec), set = resolveSet(a.flag('mechanisms')), rates = resolveRates(a.flag('rates'));
  const target = Number(a.flag('target') ?? 0.985), trials = Number(a.flag('trials') ?? 400), seed = Number(a.flag('seed') ?? 1);
  const d = budgetFromRecords([rec], set, { sizes: [scale], target, trials, seed, rates, onProgress: (_x, _n, step) => log(step) });
  const z = d.archs[rec.id].sizes[String(scale)];
  if (json) { console.log(JSON.stringify(z, null, 1)); return; }
  const p = (x: number, k = 3) => `${(x * 100).toFixed(k)} %`, h = (x: number | null) => (x === null ? '—' : `${x.toFixed(3)} h`), s = (x: number) => `${x.toFixed(1)} s`;
  const r = z.recommended, f = r.final;
  console.log(`# ${rec.name.en} — ${scale.toLocaleString('en-US')} NPUs · target A_op ≥ ${p(target, 1)} · set ${set.id}${rates ? ` · override ${rates.id}` : ''}`);
  console.log('口径: A_op of one synchronous job per cluster-hour; MTBF_hw = 1/Σλ of hard interruptions, MTTR_hw = rate-weighted mean pause (formula 1); isolation and silent corruption counted apart; P = share of 30-day windows with A_op ≥ target (formula 6)');
  const rows: (string | number)[][] = [['', 'A_op nominal', 'A_op derated', 'MTBF_hw (derated)', 'MTTR_hw (derated)', 'P(window)', 'plan'],
    ['today', p(z.today.aOp), p(z.today.aOpDerated), h(z.today.kpiDerated.mtbfHwH), s(z.today.kpiDerated.mttrS), p(z.today.window.pAtLeastTarget, 1), z.today.window.verdict],
    ['required', '', p(target, 1), `≥ ${h(z.required.mtbfAtTodayMttrH)} at today's MTTR`, `≤ ${s(z.required.mttrAtTodayMtbfS)} at today's MTBF`, '', `B = ${z.required.B.toFixed(1)} s/h (formula 2)`],
    ['recommended', p(f.kpi.aOp), p(f.kpiDerated.aOp), h(f.kpiDerated.mtbfHwH), s(f.kpiDerated.mttrS), p(r.window.pAtLeastTarget, 1), `${r.mechanisms.join('+') || '—'} | ${r.levers.join('+') || '—'} · hardware k ${r.k.toFixed(3)} (${r.binding}${r.escalated ? ', escalated' : ''})`]];
  const w = rows[0].map((_c, j) => Math.max(...rows.map((x) => String(x[j]).length)));
  for (const x of rows) console.log(x.map((c, j) => String(c).padEnd(w[j])).join('  '));
}

/** hacd study --record <id|path> [--mechanisms] [--rates] [--scales] [--target] [--permutations 300] [--seed 1] [--out-dir docs/data] */
export function studyRecord(a: Args): void {
  const rec = resolveRecord(a.flag('record')!), set = resolveSet(a.flag('mechanisms')), rates = resolveRates(a.flag('rates'));
  const sizes = nums(a.flag('scales') ?? a.flag('sizes'), DEFAULT_SCALES);
  const st = computeStudy(rec, set, rates, sizes, Number(a.flag('target') ?? 0.985), Number(a.flag('permutations') ?? 300), Number(a.flag('seed') ?? 1));
  for (const [n, z] of Object.entries(st.perSize)) {
    const top = z.gains.slice().sort((x, y) => y.aOp.shapley - x.aOp.shapley).slice(0, 4).map((g) => `${g.id} ${(g.aOp.shapley * 100).toFixed(2)}`).join(', ');
    log(`${n}: baseline (bare) ${(z.baseline * 100).toFixed(3)} % · all on ${(z.allOn * 100).toFixed(3)} / ${(z.allOnDerated * 100).toFixed(3)} % · top A_op Shapley (pt) ${top}`);
  }
  const p = join(a.flag('out-dir') ?? 'docs/data', `${rec.id}.json`);
  writeJson(p, st);
  log(`written ${p}`);
}

/** hacd prune [--mechanisms m.json] --study-dir <dir> [--records a,b] [--scale N] [--out pruned.json] [--json] */
export function prune(a: Args, json: boolean): void {
  const set = resolveSet(a.flag('mechanisms')), dir = a.flag('study-dir');
  if (!dir) fail('usage: hacd prune [--mechanisms m.json] --study-dir <dir> [--records native950,ubl128,cm384,a3server] [--scale 500000] [--out pruned.json] [--json]');
  const ids = list(a.flag('records') ?? a.flag('record'));
  const recs = ids.length ? ids : Object.keys(BUILTIN_TOPOLOGY_RECORDS);
  const studies = Object.fromEntries(recs.map((id) => { const p = join(dir, `${id}.json`); if (!existsSync(p)) fail(`no study ${p} (hacd study --record ${id} --out-dir ${dir})`); return [id, readJson(p) as StoredStudy]; }));
  const pr = pruneOf(set, studies, a.flag('scale') ? Number(a.flag('scale')) : undefined);
  const P = pr.result;
  // the lists of the rule, keeping the set's order for the mechanisms that stay in a list (baseline and capability unchanged)
  const ruleList: Record<'candidates' | 'goodputOnly' | 'pruned', MechanismVerdict> = { candidates: 'candidate', goodputOnly: 'goodput', pruned: 'pruned' };
  const movable = pr.ids.filter((id) => !set.baseline.includes(id) && !set.capability.includes(id));
  const newList = (L: keyof typeof ruleList) => [...set[L].filter((id) => P.verdicts[id].verdict === ruleList[L]), ...movable.filter((id) => P.verdicts[id].verdict === ruleList[L] && !set[L].includes(id))];
  const VN: Record<MechanismVerdict, { zh: string; en: string }> = { reference: { zh: '参考', en: 'reference' }, candidate: { zh: 'A_op 候选', en: 'A_op candidate' }, goodput: { zh: '只保有效产出', en: 'goodput-only' }, pruned: { zh: '剪除', en: 'pruned' }, capability: { zh: '能力', en: 'capability' } };
  const archs = P.archs.join(', ');
  const reason = (id: string) => {
    const v = P.verdicts[id], th = `${(P.threshold * 100).toFixed(2)}`;
    const why = v.dominatedBy ? { zh: `在同一恢复阶段上被 ${v.dominatedBy} 支配`, en: `dominated by ${v.dominatedBy} on the same recovery stage` }
      : v.missing.length ? { zh: `在 ${v.missing.join('、')} 上没有 Shapley 值`, en: `no Shapley value on ${v.missing.join(', ')}` }
      : { zh: `A_op Shapley 最小 ${pt(v.aOp.min)}、有效产出 Shapley 最小 ${pt(v.delivered.min)}（阈值 ${th} 点）`, en: `minimum A_op Shapley ${pt(v.aOp.min)}, minimum delivered Shapley ${pt(v.delivered.min)} (threshold ${th} pt)` };
    return { zh: `hacd prune 重新判定为${VN[v.verdict].zh}：${(pr.scale / 10000).toLocaleString('en-US')} 万卡、${archs} 上${why.zh}。`, en: `re-derived by hacd prune as ${VN[v.verdict].en}: at ${pr.scale.toLocaleString('en-US')} NPUs on ${archs}, ${why.en}.` };
  };
  const changed = movable.filter((id) => P.verdicts[id].verdict !== pr.listOf(id));
  const verdicts = set.verdicts ? Object.fromEntries(Object.entries(set.verdicts).map(([id, v]) => [id, changed.includes(id) ? { verdict: P.verdicts[id].verdict, reason: reason(id) } : v])) : undefined;
  const out = parseMechanismSet({ ...set, candidates: newList('candidates'), goodputOnly: newList('goodputOnly'), pruned: newList('pruned'), ...(verdicts ? { verdicts } : {}) });
  const same = ['candidates', 'goodputOnly', 'pruned'].every((L) => JSON.stringify(out[L as 'pruned']) === JSON.stringify(set[L as 'pruned']));
  if (a.flag('out')) { writeJson(a.flag('out')!, out); log(`written ${a.flag('out')}`); }
  if (json) { console.log(JSON.stringify({ scale: pr.scale, archs: P.archs, threshold: P.threshold, changed, candidates: out.candidates, goodputOnly: out.goodputOnly, pruned: out.pruned, verdicts: P.verdicts }, null, 1)); return; }
  console.log(`# pruning rule on ${archs} at ${pr.scale.toLocaleString('en-US')} NPUs (threshold ${(P.threshold * 100).toFixed(2)} pt; 口径: sampled Shapley of A_op / delivered goodput on the bare scenario)`);
  for (const L of ['candidates', 'goodputOnly', 'pruned'] as const) console.log(`${L}: ${out[L].join(', ') || '—'}`);
  console.log(same ? `the set's lists already follow the rule (set ${set.id})` : `changed: ${changed.map((id) => `${id} ${pr.listOf(id)} → ${P.verdicts[id].verdict}`).join('; ')}`);
  if (!a.flag('out')) console.log('- add --out pruned.json to write the set with these lists');
}

/** hacd records */
export function records(): void {
  console.log('# topology records (hacd findings --record <id>)');
  for (const r of Object.values(BUILTIN_TOPOLOGY_RECORDS)) console.log(`${r.id}\tbuilt-in\t${r.template}\t${r.name.en}`);
  for (const id of dataIds('records').filter((x) => !(x in BUILTIN_TOPOLOGY_RECORDS))) {
    try { const r = parseTopologyRecord(readJson(join(DATA, 'records', `${id}.json`))); console.log(`${r.id}\tdata\t${r.template}\t${r.name.en}`); } catch (e) { console.log(`${id}\tINVALID\t${(e as Error).message}`); }
  }
  console.log(`\n# mechanism sets (--mechanisms <id|path>)\n${DEFAULT_MECHANISM_SET.id}\tdefault\t${DEFAULT_MECHANISM_SET.source}`);
  for (const id of dataIds('mechanism-sets').filter((x) => x !== DEFAULT_MECHANISM_SET.id)) console.log(`${id}\tdata`);
  console.log('\n# failure-rate overrides (--rates <id|path>)');
  for (const id of dataIds('fault-rates')) { const o = parseFaultRateOverride(readJson(join(DATA, 'fault-rates', `${id}.json`))); console.log(`${o.id}\t${o.basis}\t${Object.keys(o.rates).length} classes`); }
  console.log(`\nrecord files: ${join(DATA, 'records')} · JSON schemas: hacd schema --record | --mechanisms | --rates`);
}

/** hacd schema --record | --mechanisms | --rates (JSON schema of the v5 input records); false when no such flag */
export function schemaV5(a: Args): boolean {
  const s = a.has('record') ? topologyRecordJsonSchema() : a.has('mechanisms') ? mechanismSetJsonSchema() : a.has('rates') ? faultRateOverrideJsonSchema() : undefined;
  if (s === undefined) return false;
  console.log(JSON.stringify(s, null, 2));
  return true;
}
