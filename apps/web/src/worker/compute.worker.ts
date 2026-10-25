/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import {
  evaluateScenario, compareScenarios, tornadoForScenario, allocateScenario, buildMcRun, finishMcRun, simulateReplications, summarize,
  mechanismReport, buildLedgerRun, finishLedgerRun, simulateLedgerReplications, summarizeLedger, auditMechanisms,
  allocateStrategy, strategyAcrossSizes, type StrategyOptions,
  hierarchicalBudget, type BudgetOptions, type BudgetResult,
  type AuditOptions,
  type Scenario, type TornadoMetric, type AllocationMethod, type McReplication, type AttributionMetric, type LedgerReplication,
} from '@hac-d/core';

export interface ComputeApi {
  evaluate(s: Scenario): ReturnType<typeof evaluateScenario>;
  compare(ss: Scenario[]): ReturnType<typeof compareScenarios>;
  tornado(s: Scenario, metric: TornadoMetric, factor?: number): ReturnType<typeof tornadoForScenario>;
  allocate(s: Scenario, opts: { goodputTarget?: number; availabilityTarget?: number; method?: AllocationMethod; restartShare?: number }): ReturnType<typeof allocateScenario>;
  simulate(s: Scenario, opts: { replications: number; seed: number | string; workHours?: number; intervalS?: number }, onProgress?: (done: number, total: number) => void): ReturnType<typeof finishMcRun>;
  mechanisms(s: Scenario, players: string[], opts: { metric?: AttributionMetric; parameters?: Record<string, Record<string, number>> }, onProgress?: (done: number, total: number) => void): ReturnType<typeof mechanismReport>;
  ledger(s: Scenario, opts: { trials: number; seed: number | string; target?: number }, onProgress?: (done: number, total: number) => void): ReturnType<typeof finishLedgerRun>;
  /** v3.7 single-point benefit audit of selected mechanisms */
  audit(s: Scenario, opts: AuditOptions): ReturnType<typeof auditMechanisms>;
  /** v4 allocation strategy (optimal / MTTR-preferred / MTTF-preferred) */
  strategy(s: Scenario, opts: Omit<StrategyOptions, 'onProgress'>, onProgress?: (done: number, total: number) => void): ReturnType<typeof allocateStrategy>;
  /** v4 the strategy at several sizes */
  strategySizes(s: Scenario, sizes: number[], opts: Omit<StrategyOptions, 'onProgress'>, onProgress?: (done: number, total: number) => void): ReturnType<typeof strategyAcrossSizes>;
  /**
   * v5.3 the report budget of one scenario at its own size (hierarchicalBudget: today / required / hardware alone / optimal /
   * window rule, the rows of `hacd budget`); `onProgress(step)` gets the step names. BudgetResult is plain data (no Scenario, no
   * functions: the window rule's nom / der designs are summarised in `recommended.final`), so it crosses the worker boundary as is.
   */
  budget(s: Scenario, opts: Omit<BudgetOptions, 'onProgress'>, onProgress?: (step: string) => void): BudgetResult;
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
  mechanisms: (s, players, opts, onProgress) => mechanismReport(s, players, { ...opts, onProgress }),
  audit: (s, opts) => auditMechanisms(s, opts),
  strategy: (s, opts, onProgress) => allocateStrategy(s, { ...opts, onProgress }),
  strategySizes: (s, sizes, opts, onProgress) => strategyAcrossSizes(s, sizes, { ...opts, onProgress }),
  budget: (s, opts, onProgress) => hierarchicalBudget(s, { ...opts, onProgress: onProgress ? (step) => { void onProgress(step); } : undefined }),
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
