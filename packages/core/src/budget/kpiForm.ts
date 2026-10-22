/**
 * v5 A_op in its MTBF / MTTR form with every event class kept apart (docs/ASCEND_ALLOCATION_METHODOLOGY.html formula (1);
 * previously scripts/scaling-common.ts `kpi`):
 *
 *   A_op = (1 − φ) / (1 + (Σ_i λ_i t̄_i + F) / 3600),   F = Σ_k λ_k t_k
 *
 * The hardware interruption classes i run through the mechanism chain (λ_i job interruptions per hour, t̄_i mean pause in seconds
 * of job time per event); the other classes k are the isolation of detected sub-healthy units (one global-recovery pause each),
 * detected silent corruption (detection + step recovery, or detection + global recovery) and the predictor's false alarms (one
 * migration pause each); φ is the loss of undetected silent corruption so that A_op = A_run · (1 − φ). MTBF_hw = 1 / Σλ_i (hours)
 * and MTTR_hw = Σλ_i t̄_i / Σλ_i (seconds) are the hardware side of the form; the other classes are never added to them.
 * The form is asserted against the engine's running fraction (|Δ| ≤ 1e-9) — a scenario on which it does not close throws.
 * 口径: job-level events per hour, pauses in seconds of job time, A_op over the job window.
 */
import { evaluateScenario, type TrainingKpis } from '../scenario/evaluate.js';
import type { Scenario } from '../scenario/schema.js';

/** the engine's training KPIs of a scenario (structure skipped) */
export const trainingOf = (sc: Scenario): TrainingKpis => {
  const t = evaluateScenario(sc, { structure: false }).training;
  if (!t) throw new Error('kpiForm needs a training workload');
  return t;
};

export interface OtherEventClass {
  /** 'isolation' (sub-health isolation), 'sdcDetected' (detected silent corruption), 'falseAlarm' (predictor false alarms) */
  id: 'isolation' | 'sdcDetected' | 'falseAlarm';
  ratePerHour: number;
  /** pause per event, seconds */
  pauseS: number;
  mtbfH: number | null;
  /** λ_k t_k, seconds of pause per job hour */
  sPerH: number;
}

export interface KpiForm {
  aOp: number;
  aRun: number;
  /** undetected-silent-corruption loss: A_op = A_run (1 − φ) */
  phi: number;
  /** Σλ_i of the hardware interruption classes, per hour */
  lamHw: number;
  mtbfHwH: number;
  /** rate-weighted mean pause of the hardware classes, seconds */
  mttrS: number;
  /** Σλ_i t̄_i, seconds per hour */
  sumLP: number;
  other: OtherEventClass[];
  /** Σ over the other classes, seconds per hour */
  F: number;
  mtbiH: number;
  delivered: number;
  detectS: number;
  globalS: number;
}

/** A_op = (1 − φ) / (1 + (Σλ_i t̄_i + F) / 3600) with the hardware classes and the other event classes apart */
export function kpiForm(sc: Scenario, t: TrainingKpis = trainingOf(sc)): KpiForm {
  const rows = t.chain.rows;
  const lamHw = rows.reduce((a, r) => a + r.ratePerHour, 0);
  const sumLP = rows.reduce((a, r) => a + r.ratePerHour * r.meanPauseS, 0);
  const g = t.globalRecoveryS;
  const other: OtherEventClass[] = [
    { id: 'isolation' as const, ratePerHour: t.subhealth ? t.subhealth.isolationInterruptionsPerHour : 0, pauseS: g },
    { id: 'sdcDetected' as const, ratePerHour: t.sdc?.detectedRatePerHour ?? 0, pauseS: sc.sdc.stepRecovery ? sc.sdc.detection.detectSeconds + sc.sdc.stepRecovery.recoverSeconds + sc.sdc.stepRecovery.stepSeconds : sc.sdc.detection.detectSeconds + g },
    { id: 'falseAlarm' as const, ratePerHour: t.falseAlarmRatePerHour, pauseS: sc.mechanisms.predict?.migrationSeconds ?? 0 },
  ].map((o) => ({ ...o, mtbfH: o.ratePerHour > 0 ? 1 / o.ratePerHour : null, sPerH: o.ratePerHour * o.pauseS }));
  const F = other.reduce((a, o) => a + o.sPerH, 0);
  const aRunFormula = 1 / (1 + (sumLP + F) / 3600);
  if (Math.abs(aRunFormula - t.runningFraction) > 1e-9) throw new Error(`running fraction does not close: ${aRunFormula} vs ${t.runningFraction}`);
  const phi = 1 - t.operationalAvailability / t.runningFraction;
  return { aOp: t.operationalAvailability, aRun: t.runningFraction, phi, lamHw, mtbfHwH: 1 / lamHw, mttrS: sumLP / lamHw, sumLP, other, F, mtbiH: t.mtbiHours, delivered: t.deliveredGoodput, detectS: t.chain.detectS, globalS: t.chain.globalS };
}
