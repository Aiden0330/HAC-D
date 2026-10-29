/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import {
  evaluateScenario, compareScenarios, tornadoForScenario, allocateScenario, buildMcRun, finishMcRun, simulateReplications, summarize,
  mechanismReport, buildLedgerRun, finishLedgerRun, simulateLedgerReplications, summarizeLedger, auditMechanisms,
  allocateStrategy, type StrategyOptions,
  hierarchicalBudget, type BudgetOptions, type BudgetResult,
  reportFromScenario, DEFAULT_MECHANISM_SET, CORE_VERSION, type ScenarioReportOptions, type ScenarioReport,
  type AuditOptions,
  type Scenario, type TornadoMetric, type AllocationMethod, type McReplication, type AttributionMetric, type LedgerReplication,
} from '@hac-d/core';
import { findingsHtml, methodologyHtml, FINDINGS_FILES, type ReportProvenance } from '@hac-d/reports/browser';
import { ensureKatexCss } from './katexCss.js';

/** v6.3 the Report tab's run: the sidecar (what hacd findings writes next to its reports), the two pages and their file names */
export type ReportRunOptions = Omit<ScenarioReportOptions, 'onProgress' | 'set'>;
export interface ReportRun {
  sidecar: ScenarioReport & { provenance: ReportProvenance };
  html: { findings: string; methodology: string };
  files: { findings: string; methodology: string; data: string };
}

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
  /**
   * v5.3 the report budget of one scenario at its own size (hierarchicalBudget: today / required / hardware alone / optimal /
   * window rule, the rows of `hacd budget`); `onProgress(step)` gets the step names. BudgetResult is plain data (no Scenario, no
   * functions: the window rule's nom / der designs are summarised in `recommended.final`), so it crosses the worker boundary as is.
   */
  budget(s: Scenario, opts: Omit<BudgetOptions, 'onProgress'>, onProgress?: (step: string) => void): BudgetResult;
  /**
   * v6.3 the Findings report of the scenario (Allocation › Report): reportFromScenario, then the Findings and Methodology pages
   * rendered with the report recipes (the KaTeX fonts are fetched once). `onProgress(stage, n, detail)`: study / budget per scale,
   * hierarchy, render.
   */
  report(s: Scenario, opts: ReportRunOptions, onProgress?: (stage: string, n: number, detail: string) => void): Promise<ReportRun>;
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
  budget: (s, opts, onProgress) => hierarchicalBudget(s, { ...opts, onProgress: onProgress ? (step) => { void onProgress(step); } : undefined }),
  report: async (s, opts, onProgress) => {
    await ensureKatexCss();
    const r = reportFromScenario(s, { ...opts, onProgress: onProgress ? (stage, n, d) => { void onProgress(stage, n, d); } : undefined });
    void onProgress?.('render', opts.main ?? opts.sizes[opts.sizes.length - 1], '');
    const set = DEFAULT_MECHANISM_SET;
    const provenance: ReportProvenance = {
      command: `HAC-D web · Allocation › Report · project ${opts.id}`,
      records: [{ id: opts.id, name: opts.name }],
      set: { id: set.id, source: set.source },
      options: { scales: opts.sizes, target: opts.target, trials: opts.trials ?? 400, seed: opts.seed ?? 1, permutations: opts.permutations ?? 300 },
      engine: { version: CORE_VERSION, commit: __HACD_COMMIT__ },
    };
    // what the recipes read: the data as it is in the sidecar files
    const asFile = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v));
    const R = asFile(r.results), MX = asFile(r.mechanisms);
    const suffix = (FINDINGS_FILES as Record<string, string>)[opts.id] ?? opts.id.toUpperCase();
    const findings = findingsHtml(opts.id, { results: R, mechanisms: MX, shapley: asFile(r.studies[opts.id]), record: asFile(r.records[opts.id]), provenance });
    const methodology = methodologyHtml({ results: R, mechanisms: MX, provenance });
    return { sidecar: { ...r, provenance }, html: { findings, methodology }, files: { findings: `ASCEND_ALLOCATION_FINDINGS_${suffix}.html`, methodology: 'ASCEND_ALLOCATION_METHODOLOGY.html', data: `${opts.id}-findings-data.json` } };
  },
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
