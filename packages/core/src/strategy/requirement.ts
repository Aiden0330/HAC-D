/**
 * v5 the system-level requirement behind an A_op target (docs/ASCEND_ALLOCATION_METHODOLOGY.html formula (2); previously the
 * `required` block of scripts/ascend-allocation-data.ts). From the MTBF / MTTR form, A_op ≥ A* is equivalent to a budget on the
 * hardware side:
 *
 *   Σ_i λ_i t̄_i ≤ B = 3600 · ((1 − φ) / A* − 1) − F       (seconds of hardware pause per job hour)
 *   ⇔ MTTR_hw / MTBF_hw ≤ B / 3600 … written as MTTR_hw (s) ≤ B · MTBF_hw (h)
 *
 * so that at today's MTTR the MTBF must reach MTTR/B hours, and at today's MTBF the MTTR must fall to B·MTBF seconds. φ and F are
 * taken from the derated design (HAC-D's yardstick), which is what the allocation must satisfy. When B ≤ 0 the other event
 * classes F and the undetected-corruption loss φ take the whole budget: no hardware MTBF or MTTR meets the target and the two
 * ends are null (`reachable` false) — a ratio MTTR/B would be a negative number without meaning (fifth review D6).
 *
 * v5.6 the same requirement on the effective-goodput basis (MODEL_REFERENCE.md §30, formula (2′)): from the loss form of
 * kpiForm, G_eff ≥ G* is equivalent to a budget on the hardware loss (pause plus recompute):
 *
 *   Σ_i λ_i r_i ≤ B = 3600 · (1 − δ/τ − G* / Φ′) − F − Q_other       (seconds of hardware loss per job hour)
 *   ⇔ R_eff (s) ≤ B · MTBF_hw (h),   R_eff = MTTR_hw + P̄_rb W
 *
 * with Φ′ = (1 − p_sdc)·Φ the throughput factors of the derated design; the ends are MTBF_hw ≥ R_eff/B at today's loss per
 * interruption and R_eff ≤ B · MTBF_hw at today's MTBF. B ≤ 0 means the checkpoint saves, the other classes and the factors take the
 * whole loss budget 1 − G*; `terms` says how much each consumed.
 * v5.7 (sixth review F1): Φ′ is the product of the factors (kpiForm `factor` and `pauseFrac`), never G_eff/(1 − S): in the
 * exact-renewal regime that ratio exceeds 1 (1.02–1.17 at 500k with 2–4× the record rates), inflated B and printed an unreachable
 * target as reachable. (2′) is the first-order budget at the target, where the losses are small (1 − G*), whatever regime today's
 * design is in; the acceptance itself is the engine's (the window rule's root on the exact value). (M1) The episode pauses of
 * undetected corruption, p_sdc, are booked with the other event classes as in formula (3′): `terms.other` = F + Q_other +
 * 3600·G*·p_sdc/((1 − p_sdc)Φ), `terms.factors` = 3600·G*(1/Φ − 1).
 * 口径: as the KPI form.
 */
import type { Scenario } from '../scenario/schema.js';
import { DERATE_DEFAULT, type DerateSpec } from '../mechanisms/plan.js';
import { kpiForm, type KpiForm, type BudgetMetric } from '../budget/kpiForm.js';
import { deratedOf } from './window.js';

export interface Requirement {
  /** v5.6 the basis of the requirement: A_op (formula 2) or the effective goodput (formula 2′) */
  metric: BudgetMetric;
  /** hardware pause (A_op) or hardware loss (effective goodput) budget, seconds per job hour (≤ 0: out of reach by hardware alone) */
  B: number;
  /** the whole budget in seconds per hour before the non-hardware terms: 3600 · (1/A* − 1), or 3600 · (1 − G*) on the goodput basis */
  totalBudget: number;
  /** B > 0: a hardware MTBF / MTTR requirement exists; false when the non-hardware terms alone exceed the budget */
  reachable: boolean;
  /** MTBF_hw needed at today's loss per interruption (MTTR_hw, or MTTR_hw + P̄_rb W), hours (null when not reachable) */
  mtbfAtTodayMttrH: number | null;
  /** loss per interruption allowed at today's MTBF (MTTR_hw, or MTTR_hw + P̄_rb W), seconds (null when not reachable) */
  mttrAtTodayMtbfS: number | null;
  /** today's loss per interruption (s) / MTBF_hw (h) */
  ratioToday: number;
  /** improvement factors on one quantity alone: MTBF × mtbfFactor, or the loss per interruption × mttrFactor (null when not reachable) */
  mtbfFactor: number | null;
  mttrFactor: number | null;
  /** today's loss per hard interruption the two ends refer to: MTTR_hw on the A_op basis, R_eff = MTTR_hw + P̄_rb W on the goodput basis (seconds) */
  todayLossS: number;
  /** what the non-hardware terms consume of `totalBudget`, seconds per job hour: checkpoint saves, the other event classes (F, their recompute and, on the goodput basis, the episode pauses of undetected corruption), the throughput factors (φ on the A_op basis); B = totalBudget − Σ terms */
  terms: { save: number; other: number; factors: number };
}

/** the requirement from a KPI form (pass the derated design's form) on the given basis */
export function requirementFromKpi(kD: KpiForm, target: number, metric: BudgetMetric = 'aOp'): Requirement {
  let B: number, totalBudget: number, lossS: number, terms: Requirement['terms'];
  if (metric === 'aOp') {
    B = 3600 * ((1 - kD.phi) / target - 1) - kD.F;
    totalBudget = 3600 * (1 / target - 1);
    lossS = kD.mttrS;
    terms = { save: 0, other: kD.F, factors: (3600 * kD.phi) / target };
  } else {
    // Φ′ = (1 − p_sdc)·Φ, the product of the throughput factors (v5.7: never G_eff/(1 − S), which exceeds 1 in the exact-renewal regime)
    const phi = kD.factor, p = kD.pauseFrac;
    const phiPrime = (1 - p) * phi;
    B = phiPrime > 0 ? 3600 * (1 - kD.saveFrac - target / phiPrime) - kD.F - kD.otherRecomputeSPerH : -Infinity;
    totalBudget = 3600 * (1 - target);
    lossS = kD.lossS;
    // the episode pauses p_sdc go with the other event classes (as in formula 3′), the rest of 3600·G*(1/Φ′ − 1) with the factors
    const pausePart = phiPrime > 0 ? (3600 * target * p) / ((1 - p) * phi) : Infinity;
    terms = { save: 3600 * kD.saveFrac, other: kD.F + kD.otherRecomputeSPerH + pausePart, factors: phi > 0 ? 3600 * target * (1 / phi - 1) : Infinity };
  }
  const reachable = B > 0;
  // v5.8 without hard interruptions (Σλ = 0: MTBF ∞, loss 0) the two ends of the requirement are not defined: null, never NaN or ∞
  const hard = kD.lamHw > 0 && lossS > 0;
  return {
    metric, B, totalBudget, reachable,
    mtbfAtTodayMttrH: reachable && hard ? lossS / B : null, mttrAtTodayMtbfS: reachable && hard ? B * kD.mtbfHwH : null, ratioToday: hard ? lossS / kD.mtbfHwH : 0,
    mtbfFactor: reachable && hard ? lossS / B / kD.mtbfHwH : null, mttrFactor: reachable && hard ? (B * kD.mtbfHwH) / lossS : null,
    todayLossS: lossS, terms,
  };
}

/** the sentence of the unreachable case, for every surface that prints formula (2) / (2′); `F` and `phi` are the derated form's */
export const UNREACHABLE_TEXT = {
  zh: (q: Requirement, F: number, phi: number) => q.metric === 'effective'
    ? `B = ${q.B.toFixed(1)} s/h ≤ 0：仅靠硬件不可达——检查点保存 δ/τ（${q.terms.save.toFixed(1)} s/h）、其他事件类（隔离、已检出静默、误报、未检出静默的事件暂停）${q.terms.other.toFixed(1)} s/h 与吞吐系数（亚健康降速、局部损失、备机阻塞、机制开销）${q.terms.factors.toFixed(1)} s/h 已占满全部损失预算 1 − G* = ${q.totalBudget.toFixed(1)} s/h；需先改变检查点周期 / 保存时间或目标，再谈 MTBF / 每次中断损失的要求`
    : `B = ${q.B.toFixed(1)} s/h ≤ 0：仅靠硬件不可达——其他事件类（隔离、已检出静默、误报）F = ${F.toFixed(1)} s/h 与未检出静默损失 φ = ${(phi * 100).toFixed(3)} % 已占满全部预算 ${q.totalBudget.toFixed(1)} s/h；需先降低 F 或 φ（检测 / 恢复机制），再谈 MTBF / MTTR 要求`,
  en: (q: Requirement, F: number, phi: number) => q.metric === 'effective'
    ? `B = ${q.B.toFixed(1)} s/h ≤ 0: out of reach by hardware alone — the checkpoint saves δ/τ (${q.terms.save.toFixed(1)} s/h), the other event classes (isolation, detected silent corruption, false alarms, episode pauses of undetected corruption) ${q.terms.other.toFixed(1)} s/h and the throughput factors (sub-health slowdown, local loss, blocked spares, mechanism overhead) ${q.terms.factors.toFixed(1)} s/h take the whole loss budget 1 − G* = ${q.totalBudget.toFixed(1)} s/h; the checkpoint period / save time or the target must change before an MTBF / loss-per-interruption requirement exists`
    : `B = ${q.B.toFixed(1)} s/h ≤ 0: out of reach by hardware alone — the other event classes (isolation, detected silent corruption, false alarms) F = ${F.toFixed(1)} s/h and the undetected-corruption loss φ = ${(phi * 100).toFixed(3)} % take the whole budget of ${q.totalBudget.toFixed(1)} s/h; F or φ must fall first (detection / recovery mechanisms) before an MTBF / MTTR requirement exists`,
};

/** the requirement of a design: every applied mechanism derated, then formula (2) / (2′) */
export function requirement(sc: Scenario, target: number, derate: DerateSpec = DERATE_DEFAULT, metric: BudgetMetric = 'aOp'): Requirement & { kpiDerated: KpiForm } {
  const kD = kpiForm(deratedOf(sc, derate));
  return { ...requirementFromKpi(kD, target, metric), kpiDerated: kD };
}
