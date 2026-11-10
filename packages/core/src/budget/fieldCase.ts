/**
 * v5.12 the field-level case of a report (tool review 2026-11-09, recommendation 3): the same hierarchical budget — target, metric,
 * candidates, levers, split, derating, windows, seed — with a failure-rate override that puts the interruption classes at a
 * measured field level (data/fault-rates/field-llama3-2026-11.json), reduced to the rows of the Findings table that sets it beside
 * the catalog's result. It answers how much of a conclusion is the catalog: the requirement (formula 2) is absolute, so the allowed
 * FIT per NPU barely moves, while the gap to today — the hardware factor k — moves with the basis.
 * 口径: as the budget; `allowedFitPerNpu` = k × the case's hard FIT per NPU (business-impact interruptions per 10⁹ NPU-hours).
 */
import type { BudgetDocument, BudgetResult } from './index.js';
import type { BudgetMetric } from './kpiForm.js';
import type { GoodputTiers } from './tiers.js';
import type { LeverId } from '../strategy/index.js';
import type { Requirement } from '../strategy/requirement.js';
import type { FaultRateOverride } from '../records/faultRates.js';

export interface FieldCaseRow {
  npus: number;
  /** the reference design under the case's rates, derated: hard FIT per NPU, MTBF_hw (h), MTTR_hw (s), the metric, A_op and the goodputs on the tiers' basis */
  today: { hardFitPerNpu: number; mtbfHwH: number | null; mttrS: number; value: number; aOp: number; effective: number; delivered: number };
  required: Pick<Requirement, 'B' | 'reachable' | 'mtbfAtTodayMttrH' | 'mttrAtTodayMtbfS' | 'interval'>;
  recommended: {
    feasible: boolean; cause?: NonNullable<BudgetResult['recommended']['cause']>;
    mechanisms: string[]; levers: LeverId[]; k: number;
    /** the metric and A_op of the design, derated; its window shares (nominal design, and the derated twin of a feasible plan) */
    value: number; aOp: number; pWindow: number; pWindowDerated: number | null;
    /** not feasible: the metric with perfect hardware (derated), and with every class at its floor when the constraints bind */
    ceiling: number | null; constrained: number | null;
    /** the interruption FIT per NPU the design allows: k × the case's hard FIT per NPU (null when no plan is feasible) */
    allowedFitPerNpu: number | null;
    tiers: GoodputTiers;
  };
}
export interface FieldCase {
  /** the failure-rate override of the case */
  id: string;
  source: string;
  metric: BudgetMetric;
  archs: Record<string, FieldCaseRow[]>;
}

const basisRow = (t: GoodputTiers) => (t.checkpoint.basis === 'young' && t.checkpoint.young ? t.checkpoint.young : t.checkpoint.asDesigned);

/** the rows of the field-level case: `doc` the budget document computed with `rates` */
export function fieldCaseSummary(rates: FaultRateOverride, doc: BudgetDocument): FieldCase {
  const archs: Record<string, FieldCaseRow[]> = {};
  for (const [arch, A] of Object.entries(doc.archs)) {
    archs[arch] = doc.sizes.map((n) => {
      const z = A.sizes[String(n)];
      if (!z) throw new Error(`field case ${rates.id}: no budget of ${arch} at ${n} NPUs`);
      const k = z.today.kpiDerated, q = z.required, rc = z.recommended, f = rc.final.kpiDerated;
      const feasible = rc.feasible !== false;
      return {
        npus: n,
        today: { hardFitPerNpu: z.hardFitPerNpuTotal, mtbfHwH: Number.isFinite(k.mtbfHwH) ? k.mtbfHwH : null, mttrS: k.mttrS, value: z.today.valueDerated, aOp: k.aOp, effective: basisRow(z.today.tiers).effective.derated, delivered: z.today.tiers.delivered.asAllocated.delivered.derated },
        required: { B: q.B, reachable: q.reachable, mtbfAtTodayMttrH: q.mtbfAtTodayMttrH, mttrAtTodayMtbfS: q.mttrAtTodayMtbfS, ...(q.interval ? { interval: q.interval } : {}) },
        recommended: {
          feasible, ...(rc.cause ? { cause: rc.cause } : {}),
          mechanisms: [...rc.mechanisms], levers: [...rc.levers], k: rc.k,
          value: doc.metric === 'aOp' ? f.aOp : f.effective, aOp: f.aOp, pWindow: rc.window.pAtLeastTarget, pWindowDerated: rc.windowDerated ? rc.windowDerated.pAtLeastTarget : null,
          ceiling: rc.ceiling ? rc.ceiling.derated : null, constrained: rc.ceiling?.constrained ? rc.ceiling.constrained.derated : null,
          allowedFitPerNpu: feasible ? rc.k * z.hardFitPerNpuTotal : null,
          tiers: rc.tiers,
        },
      };
    });
  }
  return { id: rates.id, source: rates.source ?? rates.id, metric: doc.metric, archs };
}
