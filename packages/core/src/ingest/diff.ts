/**
 * v6 delta (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.6): what changed between two sets of inputs and what it does to the
 * results. Field-level changes of the three records (each with the source and confidence the new record states), per-class
 * failure-rate changes on one basis, and the KPI table of the budget at the given scales before and after — A_op nominal and
 * derated, delivered goodput, MTBF_hw and MTTR_hw (formula 1), the window probability, the hardware factor k and the recommended
 * mechanisms and levers (formula 6). The engine produces every number here; this module only arranges them.
 */
import type { TopologyRecord } from '../records/topologyRecord.js';
import type { FaultRateOverride } from '../records/faultRates.js';
import type { MechanismSet } from '../records/mechanismSet.js';
import type { BudgetMetric } from '../budget/kpiForm.js';
import { budgetFromRecords, type BudgetResult } from '../budget/index.js';
import { unitFaultLibrary } from '../topology/index.js';
import type { Issue } from './validate.js';
import type { ExtensionRequest } from './extension.js';

export interface FieldChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
  /** provenance the new record states for the path (the longest matching key) */
  source?: string;
  confidence?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** path → leaf value; arrays by index, object keys in sorted order */
export function flatten(v: unknown, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(v)) { if (!v.length) out.set(prefix, []); v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out)); }
  else if (isObj(v)) { const ks = Object.keys(v).sort(); if (!ks.length) out.set(prefix, {}); for (const k of ks) flatten(v[k], prefix ? `${prefix}.${k}` : k, out); }
  else out.set(prefix, v);
  return out;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** field changes between two JSON values, paths starting with any of `skip` ignored */
export function diffFlat(a: unknown, b: unknown, skip: readonly string[] = []): FieldChange[] {
  const A = flatten(a), B = flatten(b);
  const skipped = (p: string) => skip.some((s) => p === s || p.startsWith(`${s}.`) || p.startsWith(`${s}[`));
  const out: FieldChange[] = [];
  for (const [p, va] of A) { if (skipped(p)) continue; if (!B.has(p)) out.push({ path: p, kind: 'removed', before: va }); else if (!same(va, B.get(p))) out.push({ path: p, kind: 'changed', before: va, after: B.get(p) }); }
  for (const [p, vb] of B) if (!skipped(p) && !A.has(p)) out.push({ path: p, kind: 'added', after: vb });
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

/** the provenance entry of a record for a path: the longest provenance key that is the path or one of its prefixes */
export function provenanceFor(prov: Record<string, { source: string; confidence: string }> | undefined, path: string): { source: string; confidence: string } | undefined {
  if (!prov) return undefined;
  let best: string | undefined;
  for (const k of Object.keys(prov)) if ((path === k || path.startsWith(`${k}.`) || path.startsWith(`${k}[`)) && (!best || k.length > best.length)) best = k;
  return best ? prov[best] : undefined;
}
const withProv = (c: FieldChange, prov: Record<string, { source: string; confidence: string }> | undefined): FieldChange => { const p = provenanceFor(prov, c.path); return p ? { ...c, source: p.source, confidence: p.confidence } : c; };

export const diffRecords = (a: TopologyRecord | undefined, b: TopologyRecord | undefined): FieldChange[] =>
  diffFlat(a ?? {}, b ?? {}, ['provenance', 'assumed', 'schematic']).map((c) => withProv(c, b?.provenance));
export const diffSets = (a: MechanismSet | undefined, b: MechanismSet | undefined): FieldChange[] =>
  diffFlat(a ?? {}, b ?? {}, ['provenance', 'metadata', 'verdicts']).map((c) => withProv(c, b?.provenance));

export interface RateChange {
  class: string;
  unit?: string;
  /** business-impact FIT per unit-hour (per-card values converted × cards per unit) */
  before: number | null;
  after: number | null;
  ratio: number | null;
  confidence?: string;
  source?: string;
  derivation?: string;
}
/** per-class changes of the failure rates, both overrides brought to the per-unit basis */
export function diffRates(a: FaultRateOverride | undefined, b: FaultRateOverride | undefined): RateChange[] {
  const lib = new Map(unitFaultLibrary().map((f) => [f.id, f]));
  const perUnit = (o: FaultRateOverride, cls: string): number => { const e = o.rates[cls]; return o.basis === 'per-card' ? e.fit * (lib.get(cls)?.cardsPerUnit ?? 1) : e.fit; };
  const classes = [...new Set([...Object.keys(a?.rates ?? {}), ...Object.keys(b?.rates ?? {})])].sort();
  const out: RateChange[] = [];
  for (const cls of classes) {
    const before = a?.rates[cls] ? perUnit(a, cls) : null, after = b?.rates[cls] ? perUnit(b, cls) : null;
    if (before !== null && after !== null && Math.abs(before - after) <= 1e-12 * Math.max(1, Math.abs(before))) continue;
    const e = b?.rates[cls];
    out.push({ class: cls, unit: e?.unit ?? a?.rates[cls]?.unit ?? lib.get(cls)?.unit, before, after, ratio: before && after !== null ? after / before : null, ...(e ? { confidence: e.confidence, source: e.source, ...(e.derivation ? { derivation: e.derivation } : {}) } : {}) });
  }
  return out;
}

export interface KpiRow {
  scale: number;
  aOp: number; aOpDerated: number; delivered: number;
  /** v5.6 the effective goodput nominal / derated (the report's metric; v5.7 on the exact renewal model) */
  effective: number; effectiveDerated: number;
  mtbfHwH: number; mttrS: number;
  windowP: number; verdict: string;
  /** requirement: the hardware budget B in seconds per job hour — pause on the A_op basis (formula 2), pause plus recompute on the effective-goodput basis (formula 2′) */
  B: number;
  k: number;
  mechanisms: string[]; levers: string[];
  recommendedAop: number; recommendedAopDerated: number; recommendedEffective: number; recommendedEffectiveDerated: number; recommendedWindowP: number;
  /** v5.6 false when no move set reaches the target (the recommended row is then every move on at k = 1) */
  feasible: boolean;
  effort: number;
}
/** one row of the KPI table from a budget result (today's design and the window rule's recommendation) */
export function kpiRow(z: BudgetResult, scale: number): KpiRow {
  const r = z.recommended, f = r.final;
  return {
    scale, aOp: z.today.aOp, aOpDerated: z.today.aOpDerated, delivered: z.today.kpiDerated.delivered, effective: z.today.kpi.effective, effectiveDerated: z.today.kpiDerated.effective,
    mtbfHwH: z.today.kpiDerated.mtbfHwH, mttrS: z.today.kpiDerated.mttrS,
    windowP: z.today.window.pAtLeastTarget, verdict: z.today.window.verdict, B: z.required.B,
    k: r.k, mechanisms: [...r.mechanisms], levers: [...r.levers],
    recommendedAop: f.kpi.aOp, recommendedAopDerated: f.kpiDerated.aOp, recommendedEffective: f.kpi.effective, recommendedEffectiveDerated: f.kpiDerated.effective, recommendedWindowP: r.window.pAtLeastTarget, feasible: r.feasible !== false, effort: r.effort.total,
  };
}
export interface KpiDeltaRow {
  scale: number;
  dAop: number; dAopDerated: number; dDelivered: number;
  /** v5.6 */
  dEffective: number; dEffectiveDerated: number;
  mtbfRatio: number; mttrRatio: number;
  dK: number;
  mechanismsAdded: string[]; mechanismsRemoved: string[]; leversAdded: string[]; leversRemoved: string[];
  dEffort: number;
}
export function kpiDelta(before: KpiRow, after: KpiRow): KpiDeltaRow {
  const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  return {
    scale: after.scale, dAop: after.aOp - before.aOp, dAopDerated: after.aOpDerated - before.aOpDerated, dDelivered: after.delivered - before.delivered, dEffective: after.effective - before.effective, dEffectiveDerated: after.effectiveDerated - before.effectiveDerated,
    mtbfRatio: before.mtbfHwH > 0 ? after.mtbfHwH / before.mtbfHwH : NaN, mttrRatio: before.mttrS > 0 ? after.mttrS / before.mttrS : NaN, dK: after.k - before.k,
    mechanismsAdded: minus(after.mechanisms, before.mechanisms), mechanismsRemoved: minus(before.mechanisms, after.mechanisms),
    leversAdded: minus(after.levers, before.levers), leversRemoved: minus(before.levers, after.levers), dEffort: after.effort - before.effort,
  };
}

export interface DeltaInputs { record: TopologyRecord; set: MechanismSet; rates?: FaultRateOverride }
export interface DeltaIds { record?: { id: string; name: { zh: string; en: string } }; set?: { id: string }; rates?: { id: string; basis: string } }
export interface DeltaDocument {
  version: 'hacd-delta-1';
  /** v5.6 the acceptance metric of the KPI rows' budgets */
  metric: BudgetMetric;
  generated: string;
  target: number; scales: number[]; trials: number; seed: number;
  before: DeltaIds; after: DeltaIds;
  changes: { record: FieldChange[]; rates: RateChange[]; set: FieldChange[] };
  kpi: { before: KpiRow[] | null; after: KpiRow[]; delta: KpiDeltaRow[] | null };
  issues: Issue[];
  extensionRequests: ExtensionRequest[];
  /** free-form notes of the run (normalisation summary, worksheet files) */
  notes: string[];
}
export interface DeltaOptions {
  scales: number[];
  target: number;
  /** v5.6 the acceptance metric of the budgets (default the effective goodput) */
  metric?: BudgetMetric;
  trials?: number;
  seed?: number;
  /** the page date: supplied by the caller so that a run is reproducible */
  generated: string;
  issues?: Issue[];
  extensionRequests?: ExtensionRequest[];
  notes?: string[];
  onProgress?: (arch: string, n: number, step: string) => void;
}
const ids = (x: DeltaInputs | null): DeltaIds => (x ? { record: { id: x.record.id, name: x.record.name }, set: { id: x.set.id }, ...(x.rates ? { rates: { id: x.rates.id, basis: x.rates.basis } } : {}) } : {});

/** the delta document: input changes and the KPI table before (when there is a before) and after */
export function deltaDocument(before: DeltaInputs | null, after: DeltaInputs, o: DeltaOptions): DeltaDocument {
  const trials = o.trials ?? 400, seed = o.seed ?? 1;
  const metric: BudgetMetric = o.metric ?? 'effective';
  const run = (x: DeltaInputs) => { const d = budgetFromRecords([x.record], x.set, { sizes: o.scales, target: o.target, metric, trials, seed, rates: x.rates, onProgress: o.onProgress }); return o.scales.map((n) => kpiRow(d.archs[x.record.id].sizes[String(n)], n)); };
  const kAfter = run(after), kBefore = before ? run(before) : null;
  return {
    version: 'hacd-delta-1', generated: o.generated, target: o.target, metric, scales: o.scales, trials, seed,
    before: ids(before), after: ids(after),
    changes: { record: diffRecords(before?.record, after.record), rates: diffRates(before?.rates, after.rates), set: diffSets(before?.set, after.set) },
    kpi: { before: kBefore, after: kAfter, delta: kBefore ? kAfter.map((r, i) => kpiDelta(kBefore[i], r)) : null },
    issues: o.issues ?? [], extensionRequests: o.extensionRequests ?? [], notes: o.notes ?? [],
  };
}
