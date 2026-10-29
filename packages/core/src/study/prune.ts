/**
 * v5 pruning of a mechanism set by its Shapley values (docs/ASCEND_ALLOCATION_METHODOLOGY.html §4 and Table 2; previously the
 * verdict rule of scripts/ascend-mechanism-hierarchy.ts). Verdict per mechanism:
 *   capability  — not appliable on its own (no transform; e.g. I-CONTAIN, the enabling capability of R-ELASTIC);
 *   reference   — the baseline set, kept as is in every design;
 *   pruned      — dominated on a shared recovery stage by a mechanism with the shorter time (a stage takes the minimum, never the
 *                 sum), or below the threshold on both metrics on at least one architecture;
 *   candidate   — Shapley ≥ threshold on the rule's metric (A_op, or v5.6 the effective goodput: `metric`) at the decision scale on every
 *                 architecture, and (v5.7, sixth review F3) a gain on top of the reference set on every architecture — the designs the
 *                 allocation builds always hold the reference set, while the Shapley value also averages over coalitions without it
 *                 (C-ASYNC earned 0.17–0.20 pt where C-FAST was absent and lowers G_eff wherever C-FAST is present);
 *   goodput     — delivered-goodput Shapley ≥ threshold on every architecture with a delivered gain on top of the reference set (kept for
 *                 the delivered goodput, outside the allocation).
 * v5.7 (sixth review F6): each verdict states whether its deciding comparison is resolved — the Shapley value at the deciding
 * architecture lies farther from the threshold than its sampled 95 % half-width (stored per metric since v5.7); an unresolved verdict
 * is listed (`unresolved`) and needs more permutations. A study without half-widths or reference gains (written before v5.7) skips
 * those two tests. 口径: Shapley values and reference gains in fractions of the metric at one scale.
 */
import { mechanismById } from '../mechanisms/index.js';

export type MechanismVerdict = 'reference' | 'candidate' | 'goodput' | 'pruned' | 'capability';
/** the metric the candidate rule reads (v5.6) */
export type PruneMetric = 'aOp' | 'effective';
export interface ShapleyPair {
  aOp: number;
  delivered: number;
  /** v5.6 effective-goodput Shapley (absent or NaN in a study without it) */
  effective?: number;
  /** the 95 % half-width of the sampled A_op Shapley (as stored since v5) */
  halfWidth?: number;
  /** v5.7 the 95 % half-widths of the three sampled values (absent in a study written before v5.7) */
  halfWidthBy?: { aOp: number; effective: number; delivered: number };
  /** v5.7 the gain on top of the reference set (absent before v5.7, null for a reference mechanism) */
  onReference?: { aOp: number; effective: number; delivered: number } | null;
}
/** Shapley values at the decision scale: architecture → mechanism id → values */
export type ShapleyByArch = Record<string, Record<string, ShapleyPair>>;

export interface PruneOptions {
  /** minimum Shapley value (fraction) on every architecture; default 0.0015 = 0.15 pt */
  threshold?: number;
  /** mechanisms dominated on a shared stage → the dominating one */
  dominated?: Record<string, string>;
  /** the reference set (default: none) */
  reference?: string[];
  /** whether a mechanism is appliable (default: the library has a transform for it) */
  appliable?: (id: string) => boolean;
  /** v5.6 the metric of the candidate rule (default A_op) */
  metric?: PruneMetric;
}
export interface PruneVerdict {
  id: string;
  verdict: MechanismVerdict;
  aOp: { min: number; max: number };
  effective: { min: number; max: number };
  delivered: { min: number; max: number };
  dominatedBy: string | null;
  /** architectures without a value for this mechanism */
  missing: string[];
  /** v5.7 the smallest gain on top of the reference set over the architectures, per metric (NaN when the studies carry none) */
  onReference: { aOp: number; effective: number; delivered: number };
  /** v5.7 true when the verdict failed the reference-gain test (a Shapley value at or above the threshold, no gain on the reference set) */
  noReferenceGain: boolean;
  /** v5.7 whether the deciding Shapley comparisons clear their sampled half-widths (true for a verdict decided without sampling) */
  resolved: boolean;
  /** v5.7 the deciding comparison's distance to the threshold in half-widths (Infinity when exact or not sampled) */
  margin: number;
}
export interface PruneResult {
  threshold: number;
  metric: PruneMetric;
  archs: string[];
  verdicts: Record<string, PruneVerdict>;
  reference: string[];
  candidates: string[];
  goodput: string[];
  pruned: string[];
  capability: string[];
  /** v5.7 verdicts whose deciding Shapley comparison lies within its sampled half-width */
  unresolved: string[];
}

const minMax = (xs: number[]) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: NaN, max: NaN });

/** verdict per mechanism from the Shapley values on every architecture */
export function pruneByShapley(values: ShapleyByArch, ids: string[], opts: PruneOptions = {}): PruneResult {
  const threshold = opts.threshold ?? 0.0015, metric = opts.metric ?? 'aOp';
  const archs = Object.keys(values);
  const reference = opts.reference ?? [];
  const appliable = opts.appliable ?? ((id: string) => !!mechanismById(id).apply);
  const verdicts: Record<string, PruneVerdict> = {};
  for (const id of ids) {
    const have = archs.filter((a) => values[a][id] !== undefined);
    const missing = archs.filter((a) => values[a][id] === undefined);
    const aOp = minMax(have.map((a) => values[a][id].aOp)), delivered = minMax(have.map((a) => values[a][id].delivered)), effective = minMax(have.map((a) => values[a][id].effective ?? NaN));
    const mainKey: 'aOp' | 'effective' = metric === 'effective' ? 'effective' : 'aOp';
    const main = metric === 'effective' ? effective : aOp;
    const dominatedBy = opts.dominated?.[id] ?? null;
    // v5.7 the smallest gain on top of the reference set (NaN when no study carries it: the test is skipped)
    const refMin = (k: 'aOp' | 'effective' | 'delivered') => { const xs = have.map((a) => values[a][id].onReference?.[k]).filter((x): x is number => typeof x === 'number'); return xs.length ? Math.min(...xs) : NaN; };
    const onReference = { aOp: refMin('aOp'), effective: refMin('effective'), delivered: refMin('delivered') };
    /**
     * one test of the rule on metric k: Shapley ≥ threshold on every architecture and a gain on top of the reference set. A failed
     * reference test decides without sampling; otherwise the Shapley comparison at the deciding architecture (the minimum) is resolved
     * when it lies at least one sampled half-width from the threshold.
     */
    const test = (k: 'aOp' | 'effective' | 'delivered', sh: { min: number }) => {
      const refOk = !(onReference[k] <= 0);
      let margin = Infinity;
      if (refOk) {
        let at = -1, v = Infinity;
        have.forEach((a, i) => { const x = k === 'effective' ? values[a][id].effective ?? NaN : values[a][id][k]; if (x < v) { v = x; at = i; } });
        const hw = at >= 0 ? values[have[at]][id].halfWidthBy?.[k] : undefined;
        if (hw !== undefined && hw > 0) margin = Math.abs(v - threshold) / hw;
      }
      return { pass: sh.min >= threshold && refOk, refFail: sh.min >= threshold && !refOk, margin, resolved: !(margin < 1) };
    };
    let verdict: MechanismVerdict, noReferenceGain = false, resolved = true, margin = Infinity;
    if (!appliable(id)) verdict = 'capability';
    else if (reference.includes(id)) verdict = 'reference';
    else if (dominatedBy || missing.length) verdict = 'pruned';
    else {
      const tm = test(mainKey, main), td = test('delivered', delivered);
      if (tm.pass) { verdict = 'candidate'; resolved = tm.resolved; margin = tm.margin; }
      else {
        verdict = td.pass ? 'goodput' : 'pruned';
        resolved = tm.resolved && td.resolved;
        margin = Math.min(tm.margin, td.margin);
        noReferenceGain = tm.refFail || (!td.pass && td.refFail);
      }
    }
    verdicts[id] = { id, verdict, aOp, effective, delivered, dominatedBy, missing, onReference, noReferenceGain, resolved, margin };
  }
  const of = (v: MechanismVerdict) => ids.filter((id) => verdicts[id].verdict === v);
  return { threshold, metric, archs, verdicts, reference: of('reference'), candidates: of('candidate'), goodput: of('goodput'), pruned: of('pruned'), capability: of('capability'), unresolved: ids.filter((id) => !verdicts[id].resolved) };
}

/** one mechanism's Shapley values in a stored study: `StudyGain` (byMetric.aOp.shapley) or the arch-study file's `{ aOp: { shapley }, delivered: { shapley } }` */
export interface StoredGain { id: string; halfWidth?: number; halfWidthBy?: { aOp: number; effective: number; delivered: number }; byMetric?: Record<string, { shapley: number }>; aOp?: { shapley: number }; effective?: { shapley: number }; delivered?: { shapley: number }; onReference?: { aOp: number; effective: number; delivered: number } | null }
export const gainPair = (g: StoredGain): ShapleyPair & { effective: number } => ({ aOp: (g.byMetric?.aOp ?? g.aOp)?.shapley ?? NaN, delivered: (g.byMetric?.delivered ?? g.delivered)?.shapley ?? NaN, effective: (g.byMetric?.effective ?? g.effective)?.shapley ?? NaN, halfWidth: g.halfWidth, ...(g.halfWidthBy ? { halfWidthBy: g.halfWidthBy } : {}), ...(g.onReference !== undefined ? { onReference: g.onReference } : {}) });

/** Shapley values at one scale from allocation-study results per architecture (`perSize[N].gains[]`) */
export function shapleyAtScale(studies: Record<string, { perSize: Record<string, { gains: StoredGain[] }> }>, scale: number): ShapleyByArch {
  return Object.fromEntries(Object.entries(studies).map(([arch, st]) => {
    const z = st.perSize[String(scale)];
    if (!z) throw new Error(`no study at ${scale} NPUs for ${arch}`);
    return [arch, Object.fromEntries(z.gains.map((g) => [g.id, gainPair(g)]))];
  }));
}
