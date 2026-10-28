/**
 * v6.4 `hacd scenario …`: the web pages' operations on a project file, for a program or a model (the operator tools
 * hacd_scenario_* and the MCP tools scenario_* call the same core functions, packages/core/src/project/edit.ts):
 *
 *   hacd scenario new (--template <id> | --record <id|path>) --npus N [--variant <id>] [--id <id>] [--name <name>] --out <file.json> [--json]
 *   hacd scenario show <file.json> [--json]                                    the inputs as set, mechanisms, FIT overrides, the KPI strip
 *   hacd scenario fields [<file.json>] [--json]                                the settable fields; with a file its fault types and mechanisms
 *   hacd scenario set <file.json> --set <path>=<value>… [--out <file.json>] [--json]
 *   hacd scenario fit <file.json> --set <class>=<FIT>… [--reset <class>|all] [--out <file.json>] [--json]
 *   hacd scenario mechanisms <file.json> [--apply <ID>[:k=v,…]]… [--remove <ID>]… [--out <file.json>] [--json]
 *   hacd scenario report <file.json> --out <dir> [--scales N,…] [--trials 400] [--permutations 300] [--seed 1] [--target] [--id <id>] [--json]
 *
 * A file is a bare scenario JSON (`hacd example`, the web's Export JSON) or a project bundle (`*.hacd.json`, version hacd-project-1):
 * it is written back in the same form, in place unless --out names another file. Exit 0 on success, 1 with the reason on stderr.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  parseScenario, topologyScenario, applySuperpodVariant, SUPERPOD_VARIANTS, TOPOLOGY_TEMPLATES, TOPOLOGY_TEMPLATE_IDS,
  setScenarioFields, setFaultFit, editMechanisms, scenarioSummary, scenarioVocabulary, SCENARIO_FIELDS, recordScenario, DEFAULT_MECHANISM_SET, UNREACHABLE_TEXT,
  type Scenario, type TopologyTemplate, type ScenarioSummary,
} from '@hac-d/core';
import { renderScenarioReport } from './report.js';
import { resolveRecord } from './pipeline.js';

const USAGE = `usage: hacd scenario <new | show | fields | set | fit | mechanisms | report> …
  new (--template <${TOPOLOGY_TEMPLATE_IDS.join('|')}> | --record <public id | path>) --npus N [--variant <id>] [--id <id>] [--name <name>] --out <file.json>
  show <file.json> [--json]
  fields [<file.json>] [--json]
  set <file.json> --set <path>=<value> [--set …] [--out <file.json>]
  fit <file.json> --set <class>=<FIT> [--set …] [--reset <class>|all] [--out <file.json>]
  mechanisms <file.json> [--apply <ID>[:k=v,…]]… [--remove <ID>]… [--out <file.json>]
  report <file.json> --out <dir> [--scales N,…] [--trials 400] [--permutations 300] [--seed 1] [--target 0.985] [--id <id>]
  (--json on any command prints the result as JSON; hacd scenario fields lists the settable paths)`;

const fail = (m: string): never => { console.error(`hacd scenario: ${m}`); process.exit(1); };
const flag = (rest: string[], name: string): string | undefined => { const i = rest.indexOf(`--${name}`); return i >= 0 && i + 1 < rest.length && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined; };
/** every value after each occurrence of --name up to the next flag (`--set a=1 b=2` and `--set a=1 --set b=2` alike; the tool manifest passes arrays) */
const flagAll = (rest: string[], name: string): string[] => { const out: string[] = []; for (let i = 0; i < rest.length; i++) if (rest[i] === `--${name}`) for (let j = i + 1; j < rest.length && !rest[j].startsWith('--'); j++) out.push(rest[j]); return out; };
/** a literal value: JSON when it parses (numbers, true / false / null), else the string itself */
const literal = (v: string): unknown => { try { return JSON.parse(v); } catch { return v; } };
const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

interface ProjectFile { path: string; scenario: Scenario; bundle?: Record<string, unknown> }
const BUNDLE_VERSION = 'hacd-project-1';
function readProject(path: string | undefined): ProjectFile {
  if (!path) fail(`a project file is required\n${USAGE}`);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path!, 'utf8')); } catch (e) { fail(`cannot read ${path}: ${(e as Error).message}`); }
  const obj = raw as Record<string, unknown>;
  try {
    if (obj && typeof obj === 'object' && obj.version === BUNDLE_VERSION && 'scenario' in obj) return { path: path!, scenario: parseScenario(obj.scenario), bundle: obj };
    return { path: path!, scenario: parseScenario(raw) };
  } catch (e) { return fail(`${path} is not a valid scenario: ${(e as Error).message}`); }
}
function writeProject(p: ProjectFile, s: Scenario, out: string | undefined): string {
  const target = out ?? p.path;
  mkdirSync(dirname(target) || '.', { recursive: true });
  writeFileSync(target, JSON.stringify(p.bundle ? { ...p.bundle, scenario: s } : s, null, 2) + '\n');
  return target;
}

const pct = (x: number, d = 3) => `${(x * 100).toFixed(d)} %`;
function printSummary(sum: ScenarioSummary, file?: string): void {
  const sp = sum.topology.superpod;
  console.log(`# ${sum.name}${sum.id ? ` (${sum.id})` : ''}${file ? ` — ${file}` : ''}`);
  console.log(`template ${sum.template ?? 'custom'}${sum.variant ? ` · variant ${sum.variant}` : ''} · ${sum.npus.toLocaleString('en-US')} NPUs · ${sum.counts.nodes.toLocaleString('en-US')} nodes · ${sum.counts.cabinets.toLocaleString('en-US')} compute cabinets${sum.counts.supernodes ? ` · ${sum.counts.supernodes.toLocaleString('en-US')} SuperPoDs` : ''}`);
  if (sp) console.log(`superpod: fabric ${sp.fabric} · ${sp.npusPerNode} NPUs × ${sp.nodesPerRack} nodes × ${sp.computeRacks} compute + ${sp.commRacks} comm. cabinets · ${sp.cpusPerNode} CPUs per node · UB domain ${sum.topology.nvlinkDomainGpus ?? '?'} NPUs`);
  else console.log(`servers: ${sum.topology.gpusPerNode} NPUs + ${sum.topology.cpusPerNode ?? 0} CPUs, ${sum.topology.nodesPerRack} per cabinet`);
  const so = sum.topology.scaleOut;
  console.log(`scale-out: ${so ? `${so.portsPerNpu} ports per NPU · ${so.planes} planes · radix ${so.radix} · ${so.oversubscription}:1 · ${sum.counts.scaleOutSwitches.toLocaleString('en-US')} switches` : 'off'}`);
  if (sum.topology.countOverrides.length) console.log(`user counts: ${sum.topology.countOverrides.map((c) => `${c.id} ${c.count} (geometry ${c.geometry})`).join(', ')}`);
  const fo = Object.entries(sum.fit.overrides);
  console.log(`FIT overrides: ${fo.length ? fo.map(([id, v]) => `${id} ${v.fit} (library ${Number(v.library.toPrecision(4))})`).join(', ') : 'none'} · hard FIT per NPU ${sum.fit.hardFitPerNpuTotal.toFixed(1)} · ${sum.fit.classes} fault types`);
  console.log(`mechanisms: ${sum.mechanisms.length ? sum.mechanisms.map((m) => `${m.id}{${Object.entries(m.parameters).map(([k, v]) => `${k}=${v}`).join(',')}}`).join(' ') : 'none'}`);
  if (sum.workload) console.log(`workload: ${sum.workload.durationDays} d · τ ${sum.workload.intervalS ?? 'optimal'} s · δ ${sum.workload.deltaS} s${sum.workload.ownedBy ? ` (owned by ${sum.workload.ownedBy})` : ''} · targets A_op ${sum.targets.operational ?? 0.985}, delivered ${sum.targets.goodput ?? 0.9}`);
  if (sum.kpi) console.log(`KPI: A_op ${pct(sum.kpi.aOp)} / ${pct(sum.kpi.aOpDerated)} derated (target ${pct(sum.kpi.target, 1)}) · delivered ${pct(sum.kpi.delivered, 2)} · MTBF_hw ${sum.kpi.mtbfHwH.toFixed(3)} h · MTTR_hw ${sum.kpi.mttrS.toFixed(1)} / ${sum.kpi.mttrDeratedS.toFixed(1)} s`);
  console.log(`口径: ${sum.koujing}`);
}

const out = (v: unknown) => console.log(JSON.stringify(v, null, 1));

export async function scenario(rest: string[]): Promise<void> {
  const [sub, ...args] = rest;
  const json = args.includes('--json');
  // the project file comes right after the subcommand, before any flag
  const firstFlag = args.findIndex((a) => a.startsWith('--'));
  const positional = args.slice(0, firstFlag < 0 ? undefined : firstFlag);
  const file = positional[0];
  const command = ['hacd', 'scenario', ...rest].map(quote).join(' ');
  const result = (p: ProjectFile, s: Scenario, changed: string[], written: string) => {
    const summary = scenarioSummary(s);
    if (json) out({ ok: true, file: written, changed, summary });
    else { console.error(`hacd scenario: ${changed.length ? `changed ${changed.join(', ')}` : 'nothing changed'} → ${written}`); printSummary(summary, written); }
  };
  try {
    switch (sub) {
      case 'new': {
        const tpl = flag(args, 'template') as TopologyTemplate | undefined;
        const rec = flag(args, 'record');
        if ((!tpl && !rec) || (tpl && !TOPOLOGY_TEMPLATES[tpl])) fail(`--template is one of ${TOPOLOGY_TEMPLATE_IDS.join(', ')}, or --record a public record id or path\n${USAGE}`);
        const npus = Number(flag(args, 'npus') ?? 10000);
        if (!(npus >= 1)) fail('--npus must be a whole number ≥ 1');
        const o = flag(args, 'out');
        if (!o) fail('--out <file.json> is required');
        const variant = flag(args, 'variant');
        if (variant && tpl && !SUPERPOD_VARIANTS[tpl]?.some((v) => v.id === variant)) fail(`variant ${variant} does not belong to ${tpl} (${(SUPERPOD_VARIANTS[tpl] ?? []).map((v) => v.id).join(', ') || 'none'})`);
        const id = flag(args, 'id'), name = flag(args, 'name');
        if (id && !/^[a-z0-9-]+$/.test(id)) fail('--id uses lowercase letters, digits and hyphens only');
        let s: Scenario;
        if (rec) {
          // a record's scenario at N with the default set's baseline mechanisms and parameters — what the web's built-in projects are
          if (variant) fail('--variant applies to a template; a record carries its own scale-out variants');
          const r = resolveRecord(rec);
          s = recordScenario(r, DEFAULT_MECHANISM_SET, Math.round(npus));
          s = { ...s, meta: { ...s.meta, ...(id ? { id } : {}), ...(name ? { name } : {}) } };
        } else {
          s = topologyScenario(tpl!, Math.round(npus), { id, name });
          if (variant) s = applySuperpodVariant(s, variant);
        }
        const written = writeProject({ path: o!, scenario: s }, s, o);
        result({ path: o!, scenario: s }, s, ['new'], written);
        return;
      }
      case 'show': {
        const p = readProject(file);
        const summary = scenarioSummary(p.scenario);
        if (json) out({ ok: true, file: p.path, summary }); else printSummary(summary, p.path);
        return;
      }
      case 'fields': {
        const p = file ? readProject(file) : undefined;
        const v = scenarioVocabulary(p?.scenario);
        if (json) { out(v); return; }
        console.log('# settable fields (hacd scenario set --set <path>=<value>)');
        for (const f of SCENARIO_FIELDS) console.log(`${f.path.padEnd(40)} ${f.kind}${f.values ? ` (${f.values.join(' | ')})` : ''}${f.min !== undefined ? ` ≥ ${f.min}` : ''}${f.max !== undefined ? ` ≤ ${f.max}` : ''} — ${f.note}`);
        if (v.classes) { console.log(`\n# fault types of ${p!.path} (hacd scenario fit --set <id>=<FIT per unit-hour>)`); for (const c of v.classes) console.log(`${c.id.padEnd(24)} ${c.unit.padEnd(12)} ${c.type.padEnd(5)} now ${c.fit} (library ${c.library}) — ${c.description.en}`); }
        console.log('\n# mechanisms (hacd scenario mechanisms --apply <ID>[:param=value,…] | --remove <ID>)');
        for (const m of v.mechanisms) console.log(`${m.id.padEnd(24)} ${m.applied ? 'applied' : '       '} effort ${m.effort} ${Object.entries(m.parameters).map(([k, x]) => `${k}=${x}`).join(' ') || '(no parameters)'} — ${m.name.en}`);
        return;
      }
      case 'set': {
        const p = readProject(file);
        const sets = flagAll(args, 'set');
        if (!sets.length) fail(`--set <path>=<value> is required (hacd scenario fields lists the paths)\n${USAGE}`);
        const entries: Record<string, unknown> = {};
        for (const kv of sets) { const i = kv.indexOf('='); if (i <= 0) fail(`bad --set item '${kv}': use <path>=<value>`); entries[kv.slice(0, i).trim()] = literal(kv.slice(i + 1).trim()); }
        const r = setScenarioFields(p.scenario, entries);
        result(p, r.scenario, r.changed, writeProject(p, r.scenario, flag(args, 'out')));
        return;
      }
      case 'fit': {
        const p = readProject(file);
        const fits: Record<string, number | null> = {};
        for (const kv of flagAll(args, 'set')) { const i = kv.indexOf('='); if (i <= 0) fail(`bad --set item '${kv}': use <class>=<FIT>`); const v = Number(kv.slice(i + 1)); if (!Number.isFinite(v) || v < 0) fail(`bad FIT in '${kv}'`); fits[kv.slice(0, i).trim()] = v; }
        for (const c of flagAll(args, 'reset')) { if (c === 'all') for (const id of Object.keys(scenarioVocabulary(p.scenario).classes ? Object.fromEntries(scenarioVocabulary(p.scenario).classes!.filter((x) => Math.abs(x.fit - x.library) > 1e-9).map((x) => [x.id, 0])) : {})) fits[id] = null; else fits[c] = null; }
        if (!Object.keys(fits).length) fail(`--set <class>=<FIT> or --reset <class>|all is required\n${USAGE}`);
        const r = setFaultFit(p.scenario, fits);
        result(p, r.scenario, r.changed, writeProject(p, r.scenario, flag(args, 'out')));
        return;
      }
      case 'mechanisms': {
        const p = readProject(file);
        const apply: Record<string, Record<string, number>> = {};
        for (const item of flagAll(args, 'apply')) {
          const [id, params] = item.split(':');
          const ps: Record<string, number> = {};
          for (const kv of (params ?? '').split(',').map((x) => x.trim()).filter(Boolean)) { const i = kv.indexOf('='); if (i <= 0) fail(`bad parameter '${kv}' in --apply ${item}: use k=v`); const v = Number(kv.slice(i + 1)); if (!Number.isFinite(v)) fail(`bad number in '${kv}'`); ps[kv.slice(0, i).trim()] = v; }
          apply[id.trim()] = ps;
        }
        const remove = flagAll(args, 'remove');
        if (!Object.keys(apply).length && !remove.length) fail(`--apply <ID>[:k=v,…] or --remove <ID> is required\n${USAGE}`);
        const r = editMechanisms(p.scenario, { apply, remove });
        result(p, r.scenario, r.changed, writeProject(p, r.scenario, flag(args, 'out')));
        return;
      }
      case 'report': {
        const p = readProject(file);
        const dir = flag(args, 'out');
        if (!dir) fail('--out <dir> is required');
        const sizes = flag(args, 'scales') ? flag(args, 'scales')!.split(',').map(Number).filter((x) => x > 0) : undefined;
        const n = (name: string) => (flag(args, name) !== undefined ? Number(flag(args, name)) : undefined);
        const m = renderScenarioReport(p.scenario, { id: flag(args, 'id'), outDir: dir!, sizes, trials: n('trials'), permutations: n('permutations'), seed: n('seed'), target: n('target'), command, onProgress: (x) => console.error(`hacd scenario report: ${x}`) });
        if (json) { out(m); return; }
        console.log(`# ${m.name} — report written to ${m.files.dir} in ${m.seconds.toFixed(1)} s`);
        console.log(`files: ${m.files.findings}; ${m.files.methodology}; bundle ${m.files.bundle}; sidecar ${m.files.data}`);
        console.log(`口径: ${m.koujing}`);
        const rows: string[][] = [['scale', 'row', 'A_op nominal', 'A_op derated', 'MTBF_hw (derated)', 'MTTR_hw (derated)', 'P(window)', 'plan']];
        const h = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${x.toFixed(3)} h`);
        for (const k of m.kpi) {
          rows.push([k.scale.toLocaleString('en-US'), 'today', pct(k.today.aOp), pct(k.today.aOpDerated), h(k.today.mtbfHwH), `${k.today.mttrS.toFixed(1)} s`, `${pct(k.today.pWindow, 1)} ${k.today.verdict}`, '—']);
          const q = k.required;
          rows.push(['', 'required', '', pct(m.target, 1), q.reachable ? `≥ ${h(q.mtbfAtTodayMttrH)} at today's MTTR` : '—', q.reachable ? `≤ ${(q.mttrAtTodayMtbfS ?? 0).toFixed(1)} s at today's MTBF` : '—', '', q.reachable ? `B = ${q.B.toFixed(1)} s/h` : UNREACHABLE_TEXT.en({ ...q, ratioToday: 0, mtbfFactor: null, mttrFactor: null }, q.F, q.phi)]);
          rows.push(['', 'recommended', pct(k.recommended.aOp), pct(k.recommended.aOpDerated), h(k.recommended.mtbfHwH), `${k.recommended.mttrS.toFixed(1)} s`, `${pct(k.recommended.pWindow, 1)} ${k.recommended.verdict}`, `${k.recommended.mechanisms.join('+') || '—'} | ${k.recommended.levers.join('+') || '—'} · k ${k.recommended.k.toFixed(3)} (${k.recommended.binding}${k.recommended.escalated ? ', escalated' : ''})`]);
        }
        const w = rows[0].map((_c, j) => Math.max(...rows.map((r) => r[j].length)));
        for (const r of rows) console.log(r.map((c, j) => c.padEnd(w[j])).join('  '));
        return;
      }
      default:
        fail(USAGE);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}
