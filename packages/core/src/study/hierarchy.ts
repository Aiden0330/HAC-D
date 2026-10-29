/**
 * v5 the mechanism hierarchy of a report set (docs/ASCEND_ALLOCATION_METHODOLOGY.html §4, Figure 2 and Table 2; previously
 * scripts/ascend-mechanism-hierarchy.ts): every mechanism of a set categorised — origin (ReMAP original / extension), deployment
 * layer and the layers it acts on, the quantity it changes, parameters nominal and derated, effort, the A_op and delivered-goodput
 * Shapley values per architecture at the report scales, and the verdict (reference / candidate / goodput / pruned / capability).
 * The set's verdict lists are checked against the pruning rule on the Shapley data (`pruneByShapley`); a mismatch throws, so a set
 * whose parameters changed must be re-pruned (`hac-d prune`) before it feeds a report.
 * 口径: Shapley values in fractions of A_op / delivered goodput, sampled (permutations and half-width as stored in the study).
 */
import { MECHANISM_LIBRARY, mechanismById, type MechanismKind, type MechanismMetadata } from '../mechanisms/index.js';
import { AUDIT_CATALOG } from '../mechanisms/auditCatalog.js';
import { derateParameters } from '../mechanisms/plan.js';
import { resolveMechanismSet, type MechanismSet } from '../records/mechanismSet.js';
import { pruneByShapley, shapleyAtScale, gainPair, type MechanismVerdict, type StoredGain, type PruneMetric } from './prune.js';

type L = { zh: string; en: string };
/** one architecture's stored Shapley study (scripts/arch-mechanism-shapley.ts output, or allocationStudy results) */
type ByMetric = Record<'aOp' | 'effective' | 'delivered', number>;
export interface StoredStudy { perSize: Record<string, { baseline: number | { value: number }; allOn: number | { value: number }; allOnDerated: number | { value: number }; baselineBy?: ByMetric; allOnBy?: ByMetric; allOnDeratedBy?: ByMetric; plan: unknown; gains: StoredGain[] }> }
export interface HierarchyGain { aOp: number; halfWidth: number | undefined; delivered: number; /** v5.6 effective-goodput Shapley (NaN in a study without it) */ effective: number }
export interface HierarchyRow {
  id: string; name: L; kind: MechanismKind; origin: 'original' | 'extension'; remapCategory: string; eventCandidates: unknown;
  change: L; effort: number; requires: string[]; appliable: boolean;
  deploy: MechanismMetadata['deploy']; how: L; acts: MechanismMetadata['acts']; changes: L; stage: MechanismMetadata['stage'];
  nominal: Record<string, number>; derated: Record<string, number>;
  /** arch → scale → values (null where the study has none) */
  shapley: Record<string, Record<string, HierarchyGain | null>>;
  aOp500: { min: number; max: number }; delivered500: { min: number; max: number }; /** v5.6 */ effective500: { min: number; max: number };
  verdict: MechanismVerdict; reason: L | null; dominatedBy: string | null;
}
export interface MechanismHierarchy {
  generated: string;
  threshold: number;
  /** v5.6 the metric of the candidate rule (the set's prune.metric, default A_op) */
  metric: PruneMetric;
  rule: L;
  archs: string[];
  /** per architecture and scale: A_op of the bare and all-on designs (nominal, derated); v5.6 `*By` the three metrics where the study has them */
  studies: Record<string, { baseline: Record<string, number>; allOn: Record<string, number>; allOnDerated: Record<string, number>; baselineBy?: Record<string, ByMetric>; allOnBy?: Record<string, ByMetric>; allOnDeratedBy?: Record<string, ByMetric>; plan: Record<string, unknown> }>;
  source: { players: number; permutations?: number; basis: string; set: string };
  mechanisms: HierarchyRow[];
  candidates: string[];
}
export interface HierarchyOptions {
  /** decision scale of the pruning rule (default: the largest scale in the studies) */
  scale?: number;
  /** scales whose values are listed per mechanism (default: the two largest) */
  scales?: number[];
  /** check the set's verdict lists against the rule (default true; a mismatch throws) */
  check?: boolean;
  permutations?: number;
  basis?: string;
}

/** the library ids the hierarchy covers by default and their row order: the eight ReMAP originals, then every audited extension in library order */
export const HIERARCHY_DEFAULT_IDS = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST', ...MECHANISM_LIBRARY.filter((m) => m.audit).map((m) => m.id)];
const num = (v: number | { value: number }) => (typeof v === 'number' ? v : v.value);
const DEFAULT_RULE: L = { zh: '参考集原样保留；同一恢复阶段上被更短机制支配的剪除；其余：最大规模上各拓扑的 A_op Shapley 均 ≥ 阈值 → A_op 候选，有效产出 Shapley 均 ≥ 阈值 → 只保有效产出，否则剪除', en: 'reference set kept as is; a mechanism dominated by a shorter one on the same recovery stage is pruned; otherwise A_op Shapley ≥ threshold at the largest scale on every architecture → A_op candidate, delivered Shapley ≥ threshold → goodput-only, else pruned' };

/** the hierarchy table of a mechanism set over the architectures' Shapley studies */
export function mechanismHierarchy(set: MechanismSet, studies: Record<string, StoredStudy>, o: HierarchyOptions = {}): MechanismHierarchy {
  const r = resolveMechanismSet(set);
  const archs = Object.keys(studies);
  const allScales = [...new Set(archs.flatMap((a) => Object.keys(studies[a].perSize).map(Number)))].sort((x, y) => x - y);
  const scale = o.scale ?? allScales[allScales.length - 1];
  const scales = o.scales ?? allScales.slice(-2);
  // row order: the eight ReMAP originals, then the audited extensions in library order, then anything else the set lists
  const listed = [...set.baseline, ...set.candidates, ...set.goodputOnly, ...set.pruned, ...set.capability];
  const ids = [...HIERARCHY_DEFAULT_IDS.filter((id) => listed.includes(id)), ...listed.filter((id) => !HIERARCHY_DEFAULT_IDS.includes(id))];
  const at = shapleyAtScale(studies, scale);
  const metric: PruneMetric = set.prune.metric ?? 'aOp';
  const prune = pruneByShapley(at, ids, { threshold: set.prune.threshold, dominated: set.prune.dominated, reference: set.baseline, metric });
  const listOf = (id: string): MechanismVerdict => set.baseline.includes(id) ? 'reference' : set.candidates.includes(id) ? 'candidate' : set.goodputOnly.includes(id) ? 'goodput' : set.pruned.includes(id) ? 'pruned' : 'capability';
  if (o.check !== false) for (const id of ids) if (prune.verdicts[id].verdict !== listOf(id)) throw new Error(`verdict rule mismatch for ${id}: rule ${prune.verdicts[id].verdict}, set ${listOf(id)} (${metric === 'effective' ? 'effective-goodput' : 'A_op'} min ${metric === 'effective' ? prune.verdicts[id].effective.min : prune.verdicts[id].aOp.min}, delivered min ${prune.verdicts[id].delivered.min} at ${scale})`);
  const studiesOut: MechanismHierarchy['studies'] = {};
  for (const a of archs) {
    studiesOut[a] = { baseline: {}, allOn: {}, allOnDerated: {}, plan: {} };
    for (const [n, z] of Object.entries(studies[a].perSize)) {
      studiesOut[a].baseline[n] = num(z.baseline); studiesOut[a].allOn[n] = num(z.allOn); studiesOut[a].allOnDerated[n] = num(z.allOnDerated); studiesOut[a].plan[n] = z.plan;
      if (z.baselineBy) (studiesOut[a].baselineBy ??= {})[n] = z.baselineBy;
      if (z.allOnBy) (studiesOut[a].allOnBy ??= {})[n] = z.allOnBy;
      if (z.allOnDeratedBy) (studiesOut[a].allOnDeratedBy ??= {})[n] = z.allOnDeratedBy;
    }
  }
  const rows: HierarchyRow[] = ids.map((id) => {
    const m = mechanismById(id), c = AUDIT_CATALOG.mechanisms.find((x) => x.id === id), meta = r.metadata[id] ?? m.metadata;
    if (!meta) throw new Error(`mechanism set '${set.id}' has no metadata for ${id}`);
    const v = prune.verdicts[id];
    const nominal = r.parameters[id];
    const appliable = !!m.apply;
    const sh = Object.fromEntries(archs.map((a) => [a, Object.fromEntries(scales.map((n) => { const g = studies[a].perSize[String(n)]?.gains.find((x) => x.id === id); if (!g) return [String(n), null]; const p = gainPair(g); return [String(n), { aOp: p.aOp, halfWidth: p.halfWidth, delivered: p.delivered, effective: p.effective }]; }))]));
    return {
      id, name: m.name, kind: m.kind, origin: m.audit ? 'extension' : 'original', remapCategory: c?.category ?? (set.baseline.includes(id) ? '参考机制' : 'ReMAP 基线扩展'), eventCandidates: c?.eventCandidates ?? null,
      change: m.change, effort: r.efforts[id], requires: m.requires ?? [], appliable,
      deploy: meta.deploy, how: meta.how, acts: meta.acts, changes: meta.changes, stage: meta.stage,
      nominal, derated: appliable ? derateParameters(nominal, r.derate) : nominal,
      shapley: sh, aOp500: v.aOp, delivered500: v.delivered, effective500: v.effective,
      verdict: listOf(id), reason: set.verdicts?.[id]?.reason ?? null, dominatedBy: set.prune.dominated[id] ?? null,
    };
  });
  return {
    generated: new Date().toISOString(), threshold: set.prune.threshold, metric, rule: set.prune.rule ?? DEFAULT_RULE, archs, studies: studiesOut,
    source: { players: ids.filter((id) => !!mechanismById(id).apply).length, permutations: o.permutations, basis: o.basis ?? `bare architecture scenario, HAC-D per-unit FIT, mechanism set ${set.id}`, set: set.id },
    mechanisms: rows, candidates: rows.filter((x) => x.verdict === 'candidate').map((x) => x.id),
  };
}
