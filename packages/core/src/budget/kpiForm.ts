/**
 * v5 A_op in its MTBF / MTTR form with every event class kept apart (docs/ASCEND_ALLOCATION_METHODOLOGY.html formula (1);
 * previously scripts/scaling-common.ts `kpi`):
 *
 *   A_op = (1 − φ) / (1 + (Σ_i λ_i t̄_i + F) / 3600),   F = Σ_k λ_k t_k
 *
 * v5.6 the loss form of the effective goodput on the same classes (docs/markdown/MODEL_REFERENCE.md §30; the report's acceptance
 * metric since 2026-10-28), first order on the event clock:
 *
 *   G_eff = Φ' · (1 − δ/τ − (Σ_i λ_i r_i + F + Q_other) / 3600),   r_i = t̄_i + P_rb,i · W,   Φ' = (1 − p_sdc)(1 − P_blocked) φ_perf (1 − ℓ_local)(1 − o)
 *
 * r_i is the loss per hard interruption of class i (its pause plus the recompute W of the rollbacks it causes), Q_other the
 * recompute of detected silent corruption rolled back without step recovery, p_sdc the episode pauses of silent corruption, and Φ'
 * the throughput factors. The hardware side is MTBF_hw = 1/Σλ_i and the loss per interruption R_eff = Σλ_i r_i / Σλ_i = MTTR_hw +
 * P̄_rb W. The form closes on the engine (|Δ| ≤ 1e-9) while the headline model is the first-order one; with the exact renewal
 * headline the engine value stands and the form is the first-order budget (as formula (4) is for k).
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

/** v5.6 the acceptance metric of the report pipeline: A_op (running availability) or the effective goodput (performance goodput) */
export type BudgetMetric = 'aOp' | 'effective';
export const BUDGET_METRICS: BudgetMetric[] = ['aOp', 'effective'];
/** the metric's value in the engine's training KPIs */
export const metricValue = (t: TrainingKpis, m: BudgetMetric): number => (m === 'aOp' ? t.operationalAvailability : t.effectiveGoodput);
/** the metric's value in a KPI form */
export const metricOfForm = (k: KpiForm, m: BudgetMetric): number => (m === 'aOp' ? k.aOp : k.effective);
/** names of the metrics for messages (the reports have their own bilingual labels) */
export const METRIC_NAME: Record<BudgetMetric, { zh: string; en: string; symbol: string }> = {
  aOp: { zh: '运行可用度 A_op', en: 'operational availability A_op', symbol: 'A_op' },
  effective: { zh: '有效 goodput G_eff', en: 'effective goodput G_eff', symbol: 'G_eff' },
};

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
  /* ---- v5.6 the loss form of the effective goodput ---- */
  /** the effective (performance) goodput: headline checkpoint model × throughput factors, silent-corruption pauses counted as downtime */
  effective: number;
  /** recompute per rollback event W, seconds (τ/2 plus the durable lag, or the measured / one-step value) */
  recomputeS: number;
  /** Σ_i λ_i P_rb,i W: recompute caused by the hardware classes, seconds per hour */
  hardRecomputeSPerH: number;
  /** Σ_i λ_i r_i = Σλ_i t̄_i + Σλ_i P_rb,i W: pause plus recompute of the hardware classes, seconds per hour */
  sumLoss: number;
  /** rate-weighted loss per hard interruption R_eff = MTTR_hw + P̄_rb W, seconds */
  lossS: number;
  /** recompute of detected silent corruption rolled back without step recovery, seconds per hour (0 with step recovery) */
  otherRecomputeSPerH: number;
  /** checkpoint save share δ/τ of the window */
  saveFrac: number;
  /** episode pauses of silent corruption, fraction of the window */
  pauseFrac: number;
  /** throughput factor Φ = (1 − P_blocked) · φ_perf · (1 − ℓ_local) · (1 − o) */
  factor: number;
  headlineModel: TrainingKpis['headlineModel'];
  /** the engine's closed-form window ledger (fractions of the window) */
  ledger: TrainingKpis['ledger'];
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
  // v5.6 the loss form of the effective goodput: pause plus recompute per hard class, the other classes' recompute, saves, factors
  const W = t.recomputePerInterruptionS;
  const hardRecompute = rows.reduce((a, r) => a + r.ratePerHour * r.pRollback * W, 0);
  const otherRecompute = sc.sdc.stepRecovery ? 0 : (t.sdc?.detectedRatePerHour ?? 0) * W;
  const pauseFrac = t.sdc?.delivery.pauseFraction ?? 0;
  const factor = (1 - t.blockedProbability) * (t.subhealth?.performanceFactor ?? 1) * (1 - t.localLossFraction) * (1 - t.overheadFraction);
  const saveFrac = t.firstOrder.terms.save;
  if (t.headlineModel === 'first-order') {
    const formula = (1 - pauseFrac) * factor * (1 - saveFrac - (sumLP + hardRecompute + F + otherRecompute) / 3600);
    if (Math.abs(formula - t.effectiveGoodput) > 1e-9) throw new Error(`effective goodput does not close: ${formula} vs ${t.effectiveGoodput}`);
  }
  return {
    aOp: t.operationalAvailability, aRun: t.runningFraction, phi, lamHw, mtbfHwH: 1 / lamHw, mttrS: sumLP / lamHw, sumLP, other, F, mtbiH: t.mtbiHours, delivered: t.deliveredGoodput, detectS: t.chain.detectS, globalS: t.chain.globalS,
    effective: t.effectiveGoodput, recomputeS: W, hardRecomputeSPerH: hardRecompute, sumLoss: sumLP + hardRecompute, lossS: (sumLP + hardRecompute) / lamHw, otherRecomputeSPerH: otherRecompute, saveFrac, pauseFrac, factor, headlineModel: t.headlineModel, ledger: t.ledger,
  };
}
