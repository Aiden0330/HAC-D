/**
 * v5 the system-level requirement behind an A_op target (docs/ASCEND_ALLOCATION_METHODOLOGY.html formula (2); previously the
 * `required` block of scripts/ascend-allocation-data.ts). From the MTBF / MTTR form, A_op ≥ A* is equivalent to a budget on the
 * hardware side:
 *
 *   Σ_i λ_i t̄_i ≤ B = 3600 · ((1 − φ) / A* − 1) − F       (seconds of hardware pause per job hour)
 *   ⇔ MTTR_hw / MTBF_hw ≤ B / 3600 … written as MTTR_hw (s) ≤ B · MTBF_hw (h)
 *
 * so that at today's MTTR the MTBF must reach MTTR/B hours, and at today's MTBF the MTTR must fall to B·MTBF seconds. φ and F are
 * taken from the derated design (HAC-D's yardstick), which is what the allocation must satisfy. 口径: as the KPI form.
 */
import type { Scenario } from '../scenario/schema.js';
import { DERATE_DEFAULT, type DerateSpec } from '../mechanisms/plan.js';
import { kpiForm, type KpiForm } from '../budget/kpiForm.js';
import { deratedOf } from './window.js';

export interface Requirement {
  /** hardware pause budget, seconds per job hour */
  B: number;
  /** 3600 · (1/A* − 1): the whole unavailability budget in seconds per hour (before φ and F) */
  totalBudget: number;
  /** MTBF_hw needed at today's MTTR, hours */
  mtbfAtTodayMttrH: number;
  /** MTTR_hw allowed at today's MTBF, seconds */
  mttrAtTodayMtbfS: number;
  /** today's MTTR_hw (s) / MTBF_hw (h) */
  ratioToday: number;
  /** improvement factors on one quantity alone: MTBF × mtbfFactor, or MTTR × mttrFactor */
  mtbfFactor: number;
  mttrFactor: number;
}

/** the requirement from a KPI form (pass the derated design's form) */
export function requirementFromKpi(kD: KpiForm, target: number): Requirement {
  const B = 3600 * ((1 - kD.phi) / target - 1) - kD.F;
  return { B, totalBudget: 3600 * (1 / target - 1), mtbfAtTodayMttrH: kD.mttrS / B, mttrAtTodayMtbfS: B * kD.mtbfHwH, ratioToday: kD.mttrS / kD.mtbfHwH, mtbfFactor: kD.mttrS / B / kD.mtbfHwH, mttrFactor: (B * kD.mtbfHwH) / kD.mttrS };
}

/** the requirement of a design: every applied mechanism derated, then formula (2) */
export function requirement(sc: Scenario, target: number, derate: DerateSpec = DERATE_DEFAULT): Requirement & { kpiDerated: KpiForm } {
  const kD = kpiForm(deratedOf(sc, derate));
  return { ...requirementFromKpi(kD, target), kpiDerated: kD };
}
