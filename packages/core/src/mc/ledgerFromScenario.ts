/** Build the finite-window ledger simulation from a scenario and compare it with the closed forms. */
import type { Scenario } from '../scenario/schema.js';
import { computeCounts, componentInstances, classSdcCoverage } from '../scenario/build.js';
import { evaluateScenario, resolveRecovery, automaticStages, type TrainingKpis } from '../scenario/evaluate.js';
import type { Rng } from '../math/rng.js';
import { simulateLedger, simulateLedgerReplications, summarizeLedger, type LedgerSpec, type LedgerClassSpec, type LedgerSummary, type LedgerReplication } from './ledger.js';

export interface LedgerRunOptions {
  trials?: number;
  seed?: number | string;
  /** delivered-goodput target for P(≥ target) */
  target?: number;
}

export interface LedgerRun {
  spec: LedgerSpec;
  trials: number;
  seed: number | string;
  target?: number;
  closedForm: { delivered: number; effective: number; operationalAvailability: number; ledger: TrainingKpis['ledger'] };
}

export interface LedgerComparison {
  summary: LedgerSummary;
  closedForm: LedgerRun['closedForm'];
  delta: { delivered: number; operationalAvailability: number };
  /** true when the closed-form delivered goodput is outside 2 × the 95 % CI half-width and more than 1 point away */
  disagrees: boolean;
}

export function ledgerSpecFromScenario(s: Scenario, tauS?: number): LedgerSpec {
  if (s.workload.type !== 'training') throw new Error('the ledger simulation needs a training workload');
  const counts = computeCounts(s);
  const w = s.workload;
  const N = w.nGpus;
  const model = resolveRecovery(s);
  let detection: LedgerSpec['detection'] = null;
  let globalRecovery: LedgerSpec['globalRecovery'];
  let autoS = 0;
  if (s.recovery.mode === 'mixture') {
    const r = s.recovery;
    detection = { coverage: r.detection.coverage, autoSeconds: r.detection.autoSeconds, timeoutSeconds: r.detection.timeoutSeconds };
    autoS = model.meanS(N) - (r.detection.coverage * r.detection.autoSeconds + (1 - r.detection.coverage) * r.detection.timeoutSeconds) - (1 - r.automatic.successProbability) * r.manual.seconds;
    globalRecovery = (rng: Rng) => () => autoS + (rng.uniform() < r.automatic.successProbability ? 0 : r.manual.seconds);
  } else {
    globalRecovery = (rng: Rng) => model.sampler(N, rng);
  }
  // v3.7 per-class automatic stage overrides (mechanism audit budget): the class draws its own automatic time, scaled like the attempt
  const stagesDefault = s.recovery.mode === 'mixture' ? automaticStages(s.recovery) : undefined;
  const autoDefaultS = stagesDefault ? stagesDefault.startup + stagesDefault.read + stagesDefault.communication : 0;
  let sdcWeighted = 0;
  let sdcTotal = 0;
  const classes: LedgerClassSpec[] = s.components
    .filter((c) => c.enabled)
    .map((c) => {
      const ci = componentInstances(c, counts, s.measures.subhealthThreshold);
      const cls: LedgerClassSpec = {
        id: c.id,
        name: c.name?.en ?? c.name?.zh ?? c.id,
        hardRatePerHour: ci.lambda * ci.total,
        sdcRatePerHour: ci.sdcLambda * ci.total,
        applicable: ci.applicable,
      };
      sdcTotal += cls.sdcRatePerHour;
      sdcWeighted += cls.sdcRatePerHour * classSdcCoverage(ci, s.sdc.detection.coverage);
      if (s.recovery.mode === 'mixture' && stagesDefault && autoDefaultS > 0 && ci.recoveryStages) {
        const r = s.recovery;
        const classAuto = (ci.recoveryStages.startup ?? stagesDefault.startup) + (ci.recoveryStages.read ?? stagesDefault.read) + (ci.recoveryStages.communication ?? stagesDefault.communication);
        const scaled = Math.max(0, autoS * (classAuto / autoDefaultS));
        cls.globalRecovery = (rng: Rng) => () => scaled + (rng.uniform() < r.automatic.successProbability ? 0 : r.manual.seconds);
      }
      if (ci.subhealth && ci.subhealth.ratePerHour > 0) {
        cls.slow = {
          ratePerHour: ci.subhealth.ratePerHour * ci.total,
          detectProbability: ci.subhealth.detection?.probability ?? 0,
          detectDelayH: ci.subhealth.detection?.delayH ?? 0,
          lifetimeH: ci.subhealth.durationH,
          performance: ci.subhealth.performance,
          policy: ci.subhealth.policy ?? 'tolerate',
        };
      }
      return cls;
    });
  const ev = evaluateScenario(s).training!;
  return {
    horizonH: w.durationDays * 24,
    tauS: tauS ?? ev.tauS,
    deltaS: w.deltaS,
    detection,
    globalRecovery,
    chain: { custom: s.mechanisms.custom, predict: s.mechanisms.predict, netfail: s.mechanisms.netfail, replay: s.mechanisms.replay, hotswap: s.mechanisms.hotswap, elastic: s.mechanisms.elastic, process: s.mechanisms.process },
    chainOrder: s.mechanisms.order,
    rollbackLagH: (w.rollbackLagS ?? 0) / 3600,
    overhead: Object.values(s.mechanisms.overheads ?? {}).reduce((a, b) => a + b, 0),
    blocked: ev.blockedProbability,
    sdc: { coverage: sdcTotal > 0 ? sdcWeighted / sdcTotal : s.sdc.detection.coverage, detectSeconds: s.sdc.detection.detectSeconds, fallbackDelayHours: s.sdc.fallbackDelayHours, terminalRule: s.sdc.terminalRule, step: s.sdc.stepRecovery },
    classes,
  };
}

export function buildLedgerRun(s: Scenario, opts: LedgerRunOptions = {}): LedgerRun {
  const ev = evaluateScenario(s, { structure: false });
  if (!ev.training) throw new Error('the ledger simulation needs a training workload');
  const tr = ev.training;
  return {
    spec: ledgerSpecFromScenario(s, tr.tauS),
    trials: opts.trials ?? 200,
    seed: opts.seed ?? 1,
    target: opts.target ?? s.targets.goodput,
    // v5.7 the closed-form values of the simulation's own (exact renewal) model
    closedForm: { delivered: tr.deliveredGoodputExact, effective: tr.effectiveGoodputExact, operationalAvailability: tr.operationalAvailability, ledger: tr.ledgerExact },
  };
}

export function finishLedgerRun(run: LedgerRun, summary: LedgerSummary): LedgerComparison {
  const d = summary.delivered.mean - run.closedForm.delivered;
  return {
    summary,
    closedForm: run.closedForm,
    delta: { delivered: d, operationalAvailability: summary.operationalAvailability.mean - run.closedForm.operationalAvailability },
    disagrees: Math.abs(d) > Math.max(0.01, 2 * summary.delivered.ci95),
  };
}

export function simulateScenarioLedger(s: Scenario, opts: LedgerRunOptions = {}): LedgerComparison {
  const run = buildLedgerRun(s, opts);
  return finishLedgerRun(run, simulateLedger(run.spec, run.trials, run.seed, run.target));
}

export { simulateLedgerReplications, summarizeLedger };
export type { LedgerReplication };
