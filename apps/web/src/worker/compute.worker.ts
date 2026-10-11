/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import {
  evaluateScenario, compareScenarios, tornadoForScenario, allocateScenario, buildMcRun, finishMcRun, simulateReplications, summarize,
  mechanismReport, buildLedgerRun, finishLedgerRun, simulateLedgerReplications, summarizeLedger, planToTarget,
  type Scenario, type TornadoMetric, type AllocationMethod, type McReplication, type AttributionMetric, type LedgerReplication, type PlanOptions,
} from '@hac-d/core';

export interface ComputeApi {
  evaluate(s: Scenario): ReturnType<typeof evaluateScenario>;
  compare(ss: Scenario[]): ReturnType<typeof compareScenarios>;
  tornado(s: Scenario, metric: TornadoMetric, factor?: number): ReturnType<typeof tornadoForScenario>;
  allocate(s: Scenario, opts: { goodputTarget?: number; availabilityTarget?: number; method?: AllocationMethod; restartShare?: number }): ReturnType<typeof allocateScenario>;
  simulate(s: Scenario, opts: { replications: number; seed: number | string; workHours?: number; intervalS?: number }, onProgress?: (done: number, total: number) => void): ReturnType<typeof finishMcRun>;
  mechanisms(s: Scenario, players: string[], opts: { metric?: AttributionMetric; parameters?: Record<string, Record<string, number>> }): ReturnType<typeof mechanismReport>;
  ledger(s: Scenario, opts: { trials: number; seed: number | string; target?: number }, onProgress?: (done: number, total: number) => void): ReturnType<typeof finishLedgerRun>;
  plan(s: Scenario, opts: PlanOptions): ReturnType<typeof planToTarget>;
}

const api: ComputeApi = {
  evaluate: (s) => evaluateScenario(s),
  compare: (ss) => compareScenarios(ss),
  tornado: (s, metric, factor) => tornadoForScenario(s, metric, factor),
  allocate: (s, opts) => allocateScenario(s, opts),
  simulate: (s, opts, onProgress) => {
    const run = buildMcRun(s, opts);
    const rows: McReplication[] = [];
    const chunk = Math.max(1, Math.min(10, Math.ceil(run.replications / 20)));
    for (let from = 0; from < run.replications; from += chunk) {
      const n = Math.min(chunk, run.replications - from);
      rows.push(...simulateReplications(run.spec, from, n, run.seed));
      onProgress?.(rows.length, run.replications);
    }
    const r = finishMcRun(run, summarize(rows, run.seed));
    // functions cannot be structured-cloned across the worker boundary
    return { ...r, spec: { ...r.spec, recoverySampler: undefined as unknown as typeof r.spec.recoverySampler } };
  },
  mechanisms: (s, players, opts) => mechanismReport(s, players, opts),
  plan: (s, opts) => planToTarget(s, opts),
  ledger: (s, opts, onProgress) => {
    const run = buildLedgerRun(s, opts);
    const rows: LedgerReplication[] = [];
    const chunk = Math.max(1, Math.min(25, Math.ceil(run.trials / 20)));
    for (let from = 0; from < run.trials; from += chunk) {
      const n = Math.min(chunk, run.trials - from);
      rows.push(...simulateLedgerReplications(run.spec, from, n, run.seed));
      onProgress?.(rows.length, run.trials);
    }
    return finishLedgerRun(run, summarizeLedger(rows, run.seed, run.target));
  },
};

Comlink.expose(api);
