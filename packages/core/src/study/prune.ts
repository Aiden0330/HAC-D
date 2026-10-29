/**
 * v5 pruning of a mechanism set by its Shapley values (docs/ASCEND_ALLOCATION_METHODOLOGY.html §4 and Table 2; previously the
 * verdict rule of scripts/ascend-mechanism-hierarchy.ts). Verdict per mechanism:
 *   capability  — not appliable on its own (no transform; e.g. I-CONTAIN, the enabling capability of R-ELASTIC);
 *   reference   — the baseline set, kept as is in every design;
 *   pruned      — dominated on a shared recovery stage by a mechanism with the shorter time (a stage takes the minimum, never the
 *                 sum), or below the threshold on both metrics on at least one architecture;
 *   candidate   — Shapley ≥ threshold on the rule's metric (A_op, or v5.6 the effective goodput: `metric`) at the decision scale on every architecture;
 *   goodput     — delivered-goodput Shapley ≥ threshold on every architecture (kept for the delivered goodput, outside the allocation).
 * The threshold (0.15 pt) sits above the sampled Shapley half-width at 500k (≤ 0.25 pt / 2 permutations), so a borderline
 * verdict must be re-checked when parameters change. 口径: Shapley values in fractions of A_op / delivered goodput at one scale.
 */
import { mechanismById } from '../mechanisms/index.js';

export type MechanismVerdict = 'reference' | 'candidate' | 'goodput' | 'pruned' | 'capability';
/** the metric the candidate rule reads (v5.6) */
export type PruneMetric = 'aOp' | 'effective';
export interface ShapleyPair { aOp: number; delivered: number; /** v5.6 effective-goodput Shapley (absent or NaN in a study without it) */ effective?: number }
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
    const main = metric === 'effective' ? effective : aOp;
    const dominatedBy = opts.dominated?.[id] ?? null;
    const verdict: MechanismVerdict = !appliable(id) ? 'capability' : reference.includes(id) ? 'reference' : dominatedBy ? 'pruned' : missing.length ? 'pruned' : main.min >= threshold ? 'candidate' : delivered.min >= threshold ? 'goodput' : 'pruned';
    verdicts[id] = { id, verdict, aOp, effective, delivered, dominatedBy, missing };
  }
  const of = (v: MechanismVerdict) => ids.filter((id) => verdicts[id].verdict === v);
  return { threshold, metric, archs, verdicts, reference: of('reference'), candidates: of('candidate'), goodput: of('goodput'), pruned: of('pruned'), capability: of('capability') };
}

/** one mechanism's Shapley values in a stored study: `StudyGain` (byMetric.aOp.shapley) or the arch-study file's `{ aOp: { shapley }, delivered: { shapley } }` */
export interface StoredGain { id: string; halfWidth?: number; byMetric?: Record<string, { shapley: number }>; aOp?: { shapley: number }; effective?: { shapley: number }; delivered?: { shapley: number } }
export const gainPair = (g: StoredGain): ShapleyPair & { effective: number; halfWidth?: number } => ({ aOp: (g.byMetric?.aOp ?? g.aOp)?.shapley ?? NaN, delivered: (g.byMetric?.delivered ?? g.delivered)?.shapley ?? NaN, effective: (g.byMetric?.effective ?? g.effective)?.shapley ?? NaN, halfWidth: g.halfWidth });

/** Shapley values at one scale from allocation-study results per architecture (`perSize[N].gains[]`) */
export function shapleyAtScale(studies: Record<string, { perSize: Record<string, { gains: StoredGain[] }> }>, scale: number): ShapleyByArch {
  return Object.fromEntries(Object.entries(studies).map(([arch, st]) => {
    const z = st.perSize[String(scale)];
    if (!z) throw new Error(`no study at ${scale} NPUs for ${arch}`);
    return [arch, Object.fromEntries(z.gains.map((g) => { const p = gainPair(g); return [g.id, { aOp: p.aOp, delivered: p.delivered, effective: p.effective }]; }))];
  }));
}
