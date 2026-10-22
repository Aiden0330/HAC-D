/**
 * v6 validation gates beyond the record schemas (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.5): vocabulary (class ids, units,
 * mechanism parameter keys, count rows), provenance completeness, plausibility against the unit library, structural consistency of
 * a topology record, and id collisions with the public records. Every issue carries a level, a code, a path and a bilingual
 * message; the schemas themselves (parseTopologyRecord, parseFaultRateOverride, parseMechanismSet) run first and are not repeated.
 */
import { recordSuperpod, type TopologyRecord } from '../records/topologyRecord.js';
import type { FaultRateOverride } from '../records/faultRates.js';
import type { MechanismSet } from '../records/mechanismSet.js';
import { unitFaultLibrary, templateUnits, type UnitFaultType, type TopologyTemplate } from '../topology/index.js';
import { COUNT_ROWS, SCALEOUT_FIELDS, mechanismParameterKeys } from './fields.js';

export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue { level: IssueLevel; code: string; path: string; message: { zh: string; en: string } }
export const issue = (level: IssueLevel, code: string, path: string, zh: string, en: string): Issue => ({ level, code, path, message: { zh, en } });
export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.level === 'error');
export const countIssues = (issues: Issue[]): Record<IssueLevel, number> => ({ error: issues.filter((i) => i.level === 'error').length, warning: issues.filter((i) => i.level === 'warning').length, info: issues.filter((i) => i.level === 'info').length });

let LIB: Map<string, UnitFaultType> | undefined;
const lib = () => (LIB ??= new Map(unitFaultLibrary().map((f) => [f.id, f])));

/** provenance completeness and structural consistency of a topology record */
export function validateTopologyRecord(r: TopologyRecord): Issue[] {
  const out: Issue[] = [];
  const prov = r.provenance ?? {};
  const has = (...keys: string[]) => keys.some((k) => k in prov);
  const sp = recordSuperpod(r);
  const over = Object.keys(r.superpod).filter((k) => k !== 'base');
  if (r.superpod.base && !has('superpod.base', 'superpod')) out.push(issue('warning', 'provenance-missing', 'superpod.base', '预设的来源未注明', 'the preset has no provenance entry'));
  for (const k of over) if (!has(`superpod.${k}`, 'superpod')) out.push(issue('warning', 'provenance-missing', `superpod.${k}`, `几何字段 ${k} 无来源 / 置信`, `geometry field ${k} has no provenance entry (field or group)`));
  if (!has('scaleOut', ...SCALEOUT_FIELDS.map((f) => `scaleOut.${f}`))) out.push(issue('warning', 'provenance-missing', 'scaleOut', 'scale-out 设计无来源 / 置信', 'the scale-out design has no provenance entry'));
  for (const row of Object.keys(r.countOverrides ?? {})) {
    if (!COUNT_ROWS.includes(row)) out.push(issue('error', 'unknown-count-row', `countOverrides.${row}`, `未知计数行 ${row}（已知：${COUNT_ROWS.join(', ')}）`, `unknown count row '${row}' (known: ${COUNT_ROWS.join(', ')})`));
    if (!has(`countOverrides.${row}`, 'countOverrides')) out.push(issue('warning', 'provenance-missing', `countOverrides.${row}`, `计数 ${row} 无来源 / 置信`, `count ${row} has no provenance entry`));
  }
  if (r.domainNpus !== undefined && !has('domainNpus')) out.push(issue('warning', 'provenance-missing', 'domainNpus', 'UB 域规模无来源 / 置信', 'domainNpus has no provenance entry'));
  if (!has('layers', 'layers.superpod', 'layers.cabinet', 'layers.node')) out.push(issue('info', 'provenance-missing', 'layers', '层实例规则无来源（通常由几何推出）', 'the layer rule has no provenance entry (usually derived from the geometry)'));
  const cab = sp.npusPerNode * sp.nodesPerRack, pod = cab * sp.computeRacks;
  if (r.layers.node.npus !== sp.npusPerNode) out.push(issue('error', 'layer-mismatch', 'layers.node.npus', `节点层 ${r.layers.node.npus} NPU ≠ 几何 npusPerNode ${sp.npusPerNode}`, `node layer ${r.layers.node.npus} NPUs ≠ geometry npusPerNode ${sp.npusPerNode}`));
  if (r.layers.cabinet.npus !== cab) out.push(issue('error', 'layer-mismatch', 'layers.cabinet.npus', `机柜层 ${r.layers.cabinet.npus} NPU ≠ npusPerNode × nodesPerRack = ${cab}`, `cabinet layer ${r.layers.cabinet.npus} NPUs ≠ npusPerNode × nodesPerRack = ${cab}`));
  const spExpected = r.layers.superpod.unit === 'supernodes' ? r.domainNpus ?? pod : sp.npusPerNode;
  if (r.layers.superpod.npus !== spExpected) out.push(issue('error', 'layer-mismatch', 'layers.superpod.npus', `SuperPoD 层 ${r.layers.superpod.npus} NPU ≠ ${r.layers.superpod.unit === 'supernodes' ? (r.domainNpus !== undefined ? 'domainNpus' : 'pod = npusPerNode × nodesPerRack × computeRacks') : 'npusPerNode'} = ${spExpected}`, `SuperPoD layer ${r.layers.superpod.npus} NPUs ≠ ${r.layers.superpod.unit === 'supernodes' ? (r.domainNpus !== undefined ? 'domainNpus' : 'pod = npusPerNode × nodesPerRack × computeRacks') : 'npusPerNode'} = ${spExpected}`));
  if (r.domainNpus !== undefined && pod % r.domainNpus !== 0 && r.domainNpus % pod !== 0) out.push(issue('warning', 'domain-pod', 'domainNpus', `UB 域 ${r.domainNpus} 与 pod ${pod} 不成整数倍`, `UB domain ${r.domainNpus} and pod ${pod} are not integer multiples`));
  for (const v of r.variants) if (v.scaleOut.planes > v.scaleOut.portsPerNpu) out.push(issue('info', 'planes-ports', `variants.${v.id}.scaleOut`, `平面数 ${v.scaleOut.planes} 多于每 NPU 端口 ${v.scaleOut.portsPerNpu}`, `${v.scaleOut.planes} planes exceed ${v.scaleOut.portsPerNpu} ports per NPU`));
  return out;
}

export interface RateValidationOptions {
  /** plausibility envelope around the unit library's value, as ratios (default ×0.1 … ×10) */
  envelope?: [number, number];
  /** the record's template: classes on units the template does not carry are reported */
  template?: TopologyTemplate;
}

/** vocabulary, derivation and plausibility of a failure-rate override */
export function validateFaultRateOverride(o: FaultRateOverride, opts: RateValidationOptions = {}): Issue[] {
  const out: Issue[] = [];
  const [lo, hi] = opts.envelope ?? [0.1, 10];
  const units = opts.template ? templateUnits(opts.template) : undefined;
  for (const [cls, e] of Object.entries(o.rates)) {
    const f = lib().get(cls);
    if (!f) { out.push(issue('error', 'unknown-class', `rates.${cls}`, `故障类 ${cls} 不在单元库中（不会被应用）`, `class '${cls}' is not in the unit library (it would never be applied)`)); continue; }
    if (e.unit && e.unit !== f.unit) out.push(issue('error', 'unit-mismatch', `rates.${cls}.unit`, `单元 ${e.unit} ≠ 库单元 ${f.unit}`, `unit '${e.unit}' differs from the library unit '${f.unit}'`));
    if (e.confidence === 'derived' && !e.derivation) out.push(issue('warning', 'derivation-missing', `rates.${cls}`, '置信为 derived 但无算式', "confidence 'derived' without a derivation"));
    if (units && !units.includes(f.unit)) out.push(issue('info', 'class-not-in-template', `rates.${cls}`, `模板 ${opts.template} 不含单元 ${f.unit}`, `template ${opts.template} does not carry unit ${f.unit}`));
    const perUnit = o.basis === 'per-card' ? e.fit * f.cardsPerUnit : e.fit;
    if (perUnit === 0) out.push(issue('info', 'zero-rate', `rates.${cls}.fit`, '速率为 0', 'rate is zero'));
    else if (f.fitPerUnit > 0) {
      const ratio = perUnit / f.fitPerUnit;
      if (ratio < lo || ratio > hi) out.push(issue('warning', 'implausible', `rates.${cls}.fit`, `${perUnit.toPrecision(4)} FIT/单元·h 是单元库值 ${f.fitPerUnit.toPrecision(4)} 的 ${ratio.toPrecision(3)} 倍（范围 ${lo}–${hi}）`, `${perUnit.toPrecision(4)} FIT per unit-hour is ${ratio.toPrecision(3)} × the unit library's ${f.fitPerUnit.toPrecision(4)} (envelope ${lo}–${hi})`));
    }
  }
  if (!o.source) out.push(issue('info', 'source-missing', 'source', '覆盖文件无 source', 'the override has no file-level source'));
  if (!o.catalog) out.push(issue('info', 'catalog-missing', 'catalog', '无 catalog 块（版本 / 哈希 / 口径）', 'no catalog block (revision, hash, rate basis)'));
  return out;
}

const SET_PROVENANCE_KEYS = ['baseline', 'candidates', 'goodputOnly', 'pruned', 'capability', 'levers', 'derate', 'prune.threshold'] as const;

/** parameter keys against the library (a misspelt key would be a silent no-op), provenance completeness, verdicts */
export function validateMechanismSet(s: MechanismSet): Issue[] {
  const out: Issue[] = [];
  for (const [id, params] of Object.entries(s.parameters)) {
    let keys: string[];
    try { keys = mechanismParameterKeys(id); } catch { continue; }
    for (const k of Object.keys(params)) if (!keys.includes(k)) out.push(issue('error', 'unknown-parameter', `parameters.${id}.${k}`, `${id} 没有参数 ${k}（有：${keys.join(', ')}）`, `'${k}' is not a parameter of ${id} (keys: ${keys.join(', ')}); it would change nothing`));
  }
  const prov = s.provenance ?? {};
  const has = (k: string) => k in prov || Object.keys(prov).some((p) => p.startsWith(`${k}.`));
  if (Object.keys(s.parameters).length && !has('parameters')) out.push(issue('warning', 'provenance-missing', 'parameters', '参数无来源 / 置信', 'the parameters have no provenance entry'));
  if (s.efforts && !has('efforts')) out.push(issue('warning', 'provenance-missing', 'efforts', '工作量无来源 / 置信', 'the efforts have no provenance entry'));
  for (const k of SET_PROVENANCE_KEYS) {
    const v = k === 'prune.threshold' ? s.prune.threshold : s[k as Exclude<typeof k, 'prune.threshold'>];
    if ((Array.isArray(v) ? v.length > 0 : v !== undefined) && !has(k)) out.push(issue('warning', 'provenance-missing', k, `${k} 无来源 / 置信`, `${k} has no provenance entry`));
  }
  if (!s.verdicts) out.push(issue('info', 'verdicts-missing', 'verdicts', '无 verdicts（报告读取判定理由）', 'no verdicts (the reports read the verdict reasons)'));
  return out;
}

/** an internal id must not be a public record's id; an existing data-folder id would be overwritten by promote */
export function validateId(kind: 'record' | 'rates' | 'set', id: string, publicIds: readonly string[], existingIds: readonly string[] = []): Issue[] {
  const out: Issue[] = [];
  if (publicIds.includes(id)) out.push(issue('error', 'id-collision', 'id', `${kind} id '${id}' 是公开记录的 id；内部记录用自己的 id`, `${kind} id '${id}' is a public record's id; internal records get their own ids`));
  else if (existingIds.includes(id)) out.push(issue('warning', 'id-exists', 'id', `${kind} id '${id}' 已在数据目录中，promote 会覆盖`, `${kind} id '${id}' already exists in the data folder; promote would overwrite it`));
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) out.push(issue('warning', 'id-format', 'id', `id '${id}' 含不宜用于文件名的字符`, `id '${id}' has characters unsuitable for a file name`));
  return out;
}

export interface ValidateInputsOptions extends RateValidationOptions {
  publicIds?: { records?: readonly string[]; rates?: readonly string[]; sets?: readonly string[] };
  existingIds?: { records?: readonly string[]; rates?: readonly string[]; sets?: readonly string[] };
}

/** all gates over a set of staged inputs (any subset), ids checked against the public and existing ids when given */
export function validateInputs(inputs: { record?: TopologyRecord; rates?: FaultRateOverride; set?: MechanismSet }, o: ValidateInputsOptions = {}): Issue[] {
  const out: Issue[] = [];
  const pre = (p: string, xs: Issue[]) => xs.map((i) => ({ ...i, path: `${p}.${i.path}` }));
  if (inputs.record) {
    out.push(...pre('record', validateTopologyRecord(inputs.record)));
    out.push(...pre('record', validateId('record', inputs.record.id, o.publicIds?.records ?? [], o.existingIds?.records ?? [])));
  }
  if (inputs.rates) {
    out.push(...pre('override', validateFaultRateOverride(inputs.rates, { ...o, template: o.template ?? inputs.record?.template })));
    out.push(...pre('override', validateId('rates', inputs.rates.id, o.publicIds?.rates ?? [], o.existingIds?.rates ?? [])));
  }
  if (inputs.set) {
    out.push(...pre('set', validateMechanismSet(inputs.set)));
    out.push(...pre('set', validateId('set', inputs.set.id, o.publicIds?.sets ?? [], o.existingIds?.sets ?? [])));
  }
  return out;
}
