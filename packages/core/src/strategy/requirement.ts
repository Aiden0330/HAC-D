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
 * 口径: as the KPI form.
 */
import type { Scenario } from '../scenario/schema.js';
import { DERATE_DEFAULT, type DerateSpec } from '../mechanisms/plan.js';
import { kpiForm, type KpiForm } from '../budget/kpiForm.js';
import { deratedOf } from './window.js';

export interface Requirement {
  /** hardware pause budget, seconds per job hour (≤ 0: out of reach by hardware alone) */
  B: number;
  /** 3600 · (1/A* − 1): the whole unavailability budget in seconds per hour (before φ and F) */
  totalBudget: number;
  /** B > 0: a hardware MTBF / MTTR requirement exists; false when F and φ alone exceed the budget */
  reachable: boolean;
  /** MTBF_hw needed at today's MTTR, hours (null when not reachable) */
  mtbfAtTodayMttrH: number | null;
  /** MTTR_hw allowed at today's MTBF, seconds (null when not reachable) */
  mttrAtTodayMtbfS: number | null;
  /** today's MTTR_hw (s) / MTBF_hw (h) */
  ratioToday: number;
  /** improvement factors on one quantity alone: MTBF × mtbfFactor, or MTTR × mttrFactor (null when not reachable) */
  mtbfFactor: number | null;
  mttrFactor: number | null;
}

/** the requirement from a KPI form (pass the derated design's form) */
export function requirementFromKpi(kD: KpiForm, target: number): Requirement {
  const B = 3600 * ((1 - kD.phi) / target - 1) - kD.F;
  const reachable = B > 0;
  return {
    B, totalBudget: 3600 * (1 / target - 1), reachable,
    mtbfAtTodayMttrH: reachable ? kD.mttrS / B : null, mttrAtTodayMtbfS: reachable ? B * kD.mtbfHwH : null, ratioToday: kD.mttrS / kD.mtbfHwH,
    mtbfFactor: reachable ? kD.mttrS / B / kD.mtbfHwH : null, mttrFactor: reachable ? (B * kD.mtbfHwH) / kD.mttrS : null,
  };
}

/** the sentence of the unreachable case, for every surface that prints formula (2) */
export const UNREACHABLE_TEXT = {
  zh: (q: Requirement, F: number, phi: number) => `B = ${q.B.toFixed(1)} s/h ≤ 0：仅靠硬件不可达——其他事件类（隔离、已检出静默、误报）F = ${F.toFixed(1)} s/h 与未检出静默损失 φ = ${(phi * 100).toFixed(3)} % 已占满全部预算 ${q.totalBudget.toFixed(1)} s/h；需先降低 F 或 φ（检测 / 恢复机制），再谈 MTBF / MTTR 要求`,
  en: (q: Requirement, F: number, phi: number) => `B = ${q.B.toFixed(1)} s/h ≤ 0: out of reach by hardware alone — the other event classes (isolation, detected silent corruption, false alarms) F = ${F.toFixed(1)} s/h and the undetected-corruption loss φ = ${(phi * 100).toFixed(3)} % take the whole budget of ${q.totalBudget.toFixed(1)} s/h; F or φ must fall first (detection / recovery mechanisms) before an MTBF / MTTR requirement exists`,
};

/** the requirement of a design: every applied mechanism derated, then formula (2) */
export function requirement(sc: Scenario, target: number, derate: DerateSpec = DERATE_DEFAULT): Requirement & { kpiDerated: KpiForm } {
  const kD = kpiForm(deratedOf(sc, derate));
  return { ...requirementFromKpi(kD, target), kpiDerated: kD };
}
