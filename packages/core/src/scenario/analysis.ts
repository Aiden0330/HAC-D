/**
 * Scenario-level analyses used by the UI, CLI and MCP: option comparison, tornado sensitivity,
 * allocation from a goodput or availability target, and quick option variants.
 */
import { type TrainingLedger, evaluateScenario, type EvaluationResult } from './evaluate.js';
import { computeCounts, componentInstances } from './build.js';
import type { Scenario } from './schema.js';
import { tornado, type TornadoRow } from '../sensitivity/index.js';
import {
  goodputBudget, allocateRecoveryStages, allocateUnavailability, equalApportionment, arinc, agree, feasibilityOfImprovement, minimumEffort, costOptimal,
  type Subsystem, type AllocationResult, type GoodputBudgetResult, type UnavailabilityRow,
} from '../allocation/index.js';
import { composeMttr } from '../mttr/index.js';
import { resolveRecovery, resolvePipeline } from './evaluate.js';

/* ------------------------------ comparison ------------------------------ */

export interface CompareRow {
  id: string;
  name: string;
  availability: number;
  capacityAvailability: number;
  mtbfHours: number;
  mtbiHours?: number;
  recoveryS?: number;
  /** job-level operational availability M/(M + R) (training workloads) */
  operationalAvailability?: number;
  goodput?: number;
  effectiveGoodput?: number;
  /** v3 delivered (correct) goodput over the job window */
  deliveredGoodput?: number;
  wastedGpuHoursPerDay?: number;
  lostDollarsPerDay?: number;
  blockedProbability?: number;
  hotSparesRequired?: number;
  capacityAvailabilityInference?: number;
  kRequired?: number;
  checklistWarnings: number;
  /** v2 measures */
  originalAvailability: number;
  strictAvailability: number;
  performability: number;
  humanFraction: number;
  switchoverPenalty: number;
  result: EvaluationResult;
}

export interface Comparison {
  rows: CompareRow[];
  /** per metric: best row id (higher is better unless noted) */
  best: Record<string, string>;
}

export function compareScenarios(scenarios: Scenario[]): Comparison {
  const rows: CompareRow[] = scenarios.map((s) => {
    const r = evaluateScenario(s);
    return {
      id: s.meta.id ?? s.meta.name,
      name: s.meta.name,
      availability: r.system.availability,
      capacityAvailability: r.system.capacityAvailability,
      mtbfHours: r.system.mtbfHours,
      mtbiHours: r.training?.mtbiHours,
      recoveryS: r.training?.recoveryS,
      operationalAvailability: r.training?.operationalAvailability,
      goodput: r.training?.firstOrder.goodput,
      effectiveGoodput: r.training?.effectiveGoodput,
      deliveredGoodput: r.training?.deliveredGoodput,
      wastedGpuHoursPerDay: r.training?.wastedGpuHoursPerDay,
      lostDollarsPerDay: r.training?.lostDollarsPerDay,
      blockedProbability: r.training?.blockedProbability,
      hotSparesRequired: r.spares?.hotSparesBinomial,
      capacityAvailabilityInference: r.inference?.capacityAvailability,
      kRequired: r.inference?.kRequiredForTarget,
      checklistWarnings: r.checklist.filter((c) => c.status === 'warn' || c.status === 'fail').length,
      originalAvailability: r.system.measures.original.availability,
      strictAvailability: r.system.measures.strict,
      performability: r.system.measures.performability,
      humanFraction: r.system.humanFraction,
      switchoverPenalty: r.system.measures.switchoverPenalty,
      result: r,
    };
  });
  const best: Record<string, string> = {};
  const pick = (key: keyof CompareRow, higher: boolean) => {
    let bestRow: CompareRow | undefined;
    for (const r of rows) {
      const v = r[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const bv = bestRow ? (bestRow[key] as number) : undefined;
      if (bv === undefined || (higher ? v > bv : v < bv)) bestRow = r;
    }
    if (bestRow) best[key] = bestRow.id;
  };
  pick('availability', true);
  pick('effectiveGoodput', true);
  pick('deliveredGoodput', true);
  pick('lostDollarsPerDay', false);
  pick('mtbiHours', true);
  pick('recoveryS', false);
  pick('blockedProbability', false);
  pick('capacityAvailabilityInference', true);
  return { rows, best };
}

/* ------------------------------ variants ------------------------------ */

/** Deep-clone a scenario (plain JSON). */
export function cloneScenario(s: Scenario): Scenario {
  return JSON.parse(JSON.stringify(s)) as Scenario;
}

/** Multiply every component failure rate by `factor`. */
export function scaleAllRates(s: Scenario, factor: number): Scenario {
  const c = cloneScenario(s);
  for (const comp of c.components) comp.failure.value *= factor;
  return c;
}

/** Multiply every recovery stage (or ladder rung) value (seconds) by `factor` (resolves a preset into an explicit pipeline / ladder). */
export function scaleRecovery(s: Scenario, factor: number): Scenario {
  const c = cloneScenario(s);
  if (c.recovery.mode === 'mixture') {
    const r = c.recovery;
    c.recovery = { ...r, detection: { ...r.detection, autoSeconds: r.detection.autoSeconds * factor, timeoutSeconds: r.detection.timeoutSeconds * factor }, automatic: { ...r.automatic, seconds: r.automatic.seconds * factor }, manual: { seconds: r.manual.seconds * factor } };
    return c;
  }
  if (c.recovery.mode === 'ladder') {
    const l = resolveRecovery(c).ladder!;
    c.recovery = { mode: 'ladder', preset: l.id, rungs: l.rungs.map((r) => ({ ...r, timeS: typeof r.timeS === 'number' ? r.timeS * factor : r.timeS })) as Extract<Scenario['recovery'], { mode: 'ladder' }>['rungs'] };
    return c;
  }
  const p = resolvePipeline(c);
  c.recovery = {
    mode: 'pipeline',
    stages: p.stages.map((st) => ({ ...st, value: typeof st.value === 'number' ? st.value * factor : st.value })) as Scenario['recovery'] extends { mode: 'pipeline'; stages: infer S } ? S : never,
  };
  return c;
}

export function withCheckpointDelta(s: Scenario, deltaS: number): Scenario {
  const c = cloneScenario(s);
  if (c.workload.type === 'training') c.workload.deltaS = deltaS;
  return c;
}

export function withHotSpares(s: Scenario, hotSpareNodes: number): Scenario {
  const c = cloneScenario(s);
  if (c.workload.type === 'training') {
    c.workload.hotSpareNodes = hotSpareNodes;
    if (hotSpareNodes > 0 && c.structure.mode === 'template' && c.structure.template === 'training-series') c.structure = { mode: 'template', template: 'training-hot-spares' };
  }
  return c;
}

export function withCcfBeta(s: Scenario, factor: number): Scenario {
  const c = cloneScenario(s);
  for (const comp of c.components) if (comp.ccf) comp.ccf.beta = Math.min(1, comp.ccf.beta * factor);
  return c;
}

/* ------------------------------ tornado ------------------------------ */

export type TornadoMetric = 'goodput' | 'delivered' | 'availability' | 'lostDollarsPerDay' | 'mtbiHours';

export function metricOf(r: EvaluationResult, metric: TornadoMetric): number {
  switch (metric) {
    case 'goodput':
      return r.training?.effectiveGoodput ?? r.system.capacityAvailability;
    case 'delivered':
      return r.training?.deliveredGoodput ?? r.training?.effectiveGoodput ?? r.system.capacityAvailability;
    case 'availability':
      return r.system.availability;
    case 'lostDollarsPerDay':
      return r.training?.lostDollarsPerDay ?? 0;
    case 'mtbiHours':
      return r.training?.mtbiHours ?? r.system.mtbfHours;
  }
}

/** Standard one-at-a-time sensitivity: each component's rate, the recovery time, δ, β, hot spares. */
export function tornadoForScenario(s: Scenario, metric: TornadoMetric = 'goodput', factor = 2): TornadoRow[] {
  const params: Parameters<typeof tornado<Scenario>>[1] = [];
  for (const comp of s.components.filter((c) => c.enabled)) {
    params.push({
      id: `rate:${comp.id}`,
      name: `${comp.name?.en ?? comp.id} failure rate ×${1 / factor} / ×${factor}`,
      low: (b) => {
        const c = cloneScenario(b);
        c.components.find((x) => x.id === comp.id)!.failure.value /= factor;
        return c;
      },
      high: (b) => {
        const c = cloneScenario(b);
        c.components.find((x) => x.id === comp.id)!.failure.value *= factor;
        return c;
      },
      lowLabel: `×${1 / factor}`,
      highLabel: `×${factor}`,
    });
  }
  params.push({ id: 'recovery', name: `recovery time ×${1 / factor} / ×${factor}`, low: (b) => scaleRecovery(b, 1 / factor), high: (b) => scaleRecovery(b, factor), lowLabel: `×${1 / factor}`, highLabel: `×${factor}` });
  if (s.workload.type === 'training') {
    const d = s.workload.deltaS;
    params.push({ id: 'delta', name: `checkpoint save δ ×${1 / factor} / ×${factor}`, low: (b) => withCheckpointDelta(b, d / factor), high: (b) => withCheckpointDelta(b, d * factor), lowLabel: `×${1 / factor}`, highLabel: `×${factor}` });
    const hs = s.workload.hotSpareNodes;
    // a pool that is too small for the job blocks on replenishment, so the "high" variant uses the P99 requirement when none are configured
    const required = evaluateScenario(s).spares?.hotSparesBinomial ?? 1;
    const high = hs > 0 ? hs * 2 : Math.max(1, required);
    params.push({ id: 'hotSpares', name: `hot spares 0 / ${high}`, low: (b) => withHotSpares(b, 0), high: (b) => withHotSpares(b, high), lowLabel: '0', highLabel: `${high}` });
  }
  if (s.components.some((c) => c.ccf && c.ccf.beta > 0)) params.push({ id: 'beta', name: `common-cause β ×${1 / factor} / ×${factor}`, low: (b) => withCcfBeta(b, 1 / factor), high: (b) => withCcfBeta(b, factor), lowLabel: `×${1 / factor}`, highLabel: `×${factor}` });
  return tornado(s, params, (sc) => metricOf(evaluateScenario(sc), metric));
}

/* ------------------------------ allocation ------------------------------ */

export type AllocationMethod = 'equal' | 'arinc' | 'agree' | 'feasibility' | 'minimum-effort' | 'cost-optimal';

/** v3.5 loss budget over the window ledger (docs/MODEL_REFERENCE.md §7): (1 − G*) split over the loss lines by weight. */
export type LedgerLossLine = Exclude<keyof TrainingLedger, 'delivered'>;
export const LEDGER_LOSS_LINES: LedgerLossLine[] = ['downtime', 'save', 'rollback', 'slowdown', 'local', 'blocked', 'overhead', 'sdcRollback', 'terminal'];
export type LossBudgetMethod = 'proportional' | 'equal' | 'custom';
export const LOSS_LEVERS: Record<LedgerLossLine, string> = {
  downtime: 'detection coverage and time (D-HARD); automatic recovery time and success (R-CKPT, C-MEM); rungs that avoid the global recovery (R-REPLAY, R-NETFAIL, R-HOTSWAP, R-ELASTIC, P-PREDICT); lower interruption rates (H-RELIABILITY, H-LEMON)',
  save: 'checkpoint save time δ and interval τ (C-FAST, C-MEM)',
  rollback: 'checkpoint interval τ (C-FAST); rungs without rollback (R-REPLAY, R-NETFAIL, R-HOTSWAP, R-ELASTIC)',
  slowdown: 'sub-health detection and isolation (D-SLOW); fewer and shorter episodes (H-SWEEP)',
  local: 'elastic domain count and recovery time (R-ELASTIC)',
  blocked: 'hot-spare pool size and replenishment time',
  overhead: 'fault-free overhead of the enabled mechanisms (C-MEM, D-SDC-DMR)',
  sdcRollback: 'immediate silent-corruption detection (D-SDC, D-SDC-DMR) and step recovery (R-SDC)',
  terminal: 'immediate detection coverage and the fallback discovery delay (D-SDC); the terminal rule',
};
export interface LossBudgetRow {
  line: LedgerLossLine;
  /** current loss (fraction of the window, and hours) */
  current: number;
  currentHours: number;
  weight: number;
  allowed: number;
  allowedHours: number;
  /** current − allowed (positive: over budget) */
  excess: number;
  excessHours: number;
  lever: string;
}
export interface LossBudget {
  target: number;
  windowHours: number;
  method: LossBudgetMethod;
  totalAllowed: number;
  totalAllowedHours: number;
  totalCurrent: number;
  totalCurrentHours: number;
  rows: LossBudgetRow[];
  notes: string[];
}

export function lossBudget(ledger: TrainingLedger, target: number, windowHours: number, opts: { method?: LossBudgetMethod; weights?: Partial<Record<LedgerLossLine, number>> } = {}): LossBudget {
  const notes: string[] = [];
  const current = Object.fromEntries(LEDGER_LOSS_LINES.map((k) => [k, Math.max(0, ledger[k])])) as Record<LedgerLossLine, number>;
  const totalCurrent = LEDGER_LOSS_LINES.reduce((a, k) => a + current[k], 0);
  const totalAllowed = Math.max(0, 1 - target);
  let method: LossBudgetMethod = opts.method ?? 'proportional';
  const equalWeights = () => {
    const active = LEDGER_LOSS_LINES.filter((k) => current[k] > 0);
    const set = active.length ? active : LEDGER_LOSS_LINES;
    return Object.fromEntries(LEDGER_LOSS_LINES.map((k) => [k, set.includes(k) ? 1 / set.length : 0])) as Record<LedgerLossLine, number>;
  };
  let weights: Record<LedgerLossLine, number> = equalWeights();
  if (method === 'custom') {
    const raw = Object.fromEntries(LEDGER_LOSS_LINES.map((k) => [k, Math.max(0, opts.weights?.[k] ?? 0)])) as Record<LedgerLossLine, number>;
    const sum = LEDGER_LOSS_LINES.reduce((a, k) => a + raw[k], 0);
    if (sum > 0) weights = Object.fromEntries(LEDGER_LOSS_LINES.map((k) => [k, raw[k] / sum])) as Record<LedgerLossLine, number>;
    else {
      method = 'proportional';
      notes.push('custom weights sum to zero: proportional weights used instead');
    }
  }
  if (method === 'proportional') {
    if (totalCurrent > 0) weights = Object.fromEntries(LEDGER_LOSS_LINES.map((k) => [k, current[k] / totalCurrent])) as Record<LedgerLossLine, number>;
    else notes.push('no current loss: equal weights over every line');
  }
  const rows: LossBudgetRow[] = LEDGER_LOSS_LINES.map((k) => {
    const allowed = totalAllowed * weights[k];
    return { line: k, current: current[k], currentHours: current[k] * windowHours, weight: weights[k], allowed, allowedHours: allowed * windowHours, excess: current[k] - allowed, excessHours: (current[k] - allowed) * windowHours, lever: LOSS_LEVERS[k] };
  });
  notes.push(`loss budget (1 − ${(target * 100).toFixed(2)} %) = ${(totalAllowed * 100).toFixed(2)} % of the ${windowHours} h window = ${(totalAllowed * windowHours).toFixed(1)} h, split ${method === 'proportional' ? 'in proportion to the current ledger' : method === 'equal' ? 'equally over the lines with a current loss' : 'by the given weights'}; the lines are mutually exclusive shares of the window (closed-form ledger), so the split is an accounting target, not a proof that each line can be reached independently`);
  if (totalCurrent > totalAllowed) notes.push(`current losses ${(totalCurrent * 100).toFixed(2)} % exceed the budget by ${((totalCurrent - totalAllowed) * windowHours).toFixed(1)} h; the lines over their allowance point at the levers to use first`);
  else notes.push(`current losses ${(totalCurrent * 100).toFixed(2)} % are within the budget: lines under their allowance may degrade by the slack shown`);
  return { target, windowHours, method, totalAllowed, totalAllowedHours: totalAllowed * windowHours, totalCurrent, totalCurrentHours: totalCurrent * windowHours, rows, notes };
}

export interface ScenarioAllocation {
  target: { goodput?: number; availability?: number };
  /** v3.5 loss budget over the window ledger (training, delivered target) */
  lossBudget?: LossBudget;
  /** v3.3 methods that coincide for this scenario's weights */
  coincide?: AllocationMethod[];
  /** goodput-budget split (training) */
  goodput?: GoodputBudgetResult;
  /** allocation of the required job interruption rate across component classes (fix R, tighten λ) */
  rateAllocation?: AllocationResult;
  /** allocation of the required recovery time across pipeline stages (fix λ, tighten R) */
  stageAllocation?: { name: string; currentS: number; budgetS: number; improvementFactor: number }[];
  /** availability-target split across subsystems */
  unavailability?: { rows: UnavailabilityRow[]; unavailabilityBudget: number };
  /** v3: delivered-goodput basis (silent corruption): target conversion, feasibility by hardware alone, required detection */
  sdc?: SdcAllocation;
  notes: string[];
}

function subsystemsFrom(s: Scenario): Subsystem[] {
  const counts = computeCounts(s);
  return s.components
    .filter((c) => c.enabled)
    .map((c) => {
      const ci = componentInstances(c, counts);
      const w = c.allocation ?? {};
      return {
        id: c.id,
        name: c.name?.en ?? c.name?.zh ?? c.id,
        count: ci.total,
        currentLambda: ci.lambda,
        importance: w.importance ?? 1,
        duty: w.duty ?? 1,
        feasibilityWeight: w.feasibilityWeight ?? (c.failure.provenance?.confidence === 'assumed' ? 2 : 1),
        cost: { a: w.costA ?? 1, b: w.costB ?? 1 },
        minLambda: ci.lambda * (w.minLambdaFactor ?? 0.05),
        mttr: ci.mttr,
        fixed: w.fixed ?? false,
      };
    });
}

/** Methods that give the same split for these subsystems (same counts / importance / duty → AGREE = equal; same feasibility weights → feasibility = equal). */
export function coincidingMethods(subs: Subsystem[]): AllocationMethod[] {
  const free = subs.filter((x) => !x.fixed);
  if (free.length < 2) return [];
  const same = (f: (x: Subsystem) => number) => free.every((x) => Math.abs(f(x) - f(free[0])) < 1e-12 * Math.max(1, Math.abs(f(free[0]))));
  const out: AllocationMethod[] = ['equal'];
  if (same((x) => x.count) && same((x) => x.importance ?? 1) && same((x) => x.duty ?? 1)) out.push('agree');
  if (same((x) => x.feasibilityWeight ?? 1)) out.push('feasibility');
  return out.length > 1 ? out : [];
}

function runMethod(method: AllocationMethod, subs: Subsystem[], lambdaSystem: number): AllocationResult {
  switch (method) {
    case 'equal':
      return equalApportionment(subs, lambdaSystem);
    case 'arinc':
      return arinc(subs, lambdaSystem);
    case 'agree':
      // AGREE's R_i = 1 − (1 − R*^{n_i/N})/w_i needs R* close to 1: pick the horizon so that λ*·T ≤ 0.1 (the result is rescaled to Σλ_i = λ* anyway)
      return agree(subs, lambdaSystem, Math.min(24, 0.1 / Math.max(lambdaSystem, 1e-12)));
    case 'feasibility':
      return feasibilityOfImprovement(subs, lambdaSystem);
    case 'minimum-effort':
      return minimumEffort(subs, lambdaSystem);
    case 'cost-optimal':
      return costOptimal(subs, lambdaSystem);
  }
}

export type AllocationBasis = 'effective' | 'delivered';

export interface SdcAllocation {
  basis: 'delivered';
  deliveredTarget: number;
  currentDelivered: number;
  currentEffective: number;
  /** delivered / effective of the scenario the budget was computed on */
  factor: number;
  /** effective and headline goodput targets implied by the delivered target */
  effectiveTarget: number;
  headlineTarget: number;
  /** delivered goodput if the hardware never failed, with the current silent-corruption policy */
  maxDeliveredByHardware: number;
  feasibleByHardware: boolean;
  /** smallest immediate detection coverage that reaches the target with the current hardware (undefined: not even 100 %) */
  requiredCoverage?: number;
  /** longest fallback delay that reaches the target with the current hardware and coverage (undefined: not even 0.01 h) */
  requiredFallbackDelayH?: number;
  /** coverage used for the rate / stage budgets below (raised to requiredCoverage when the hardware alone cannot reach the target) */
  coverageUsed: number;
}

function withCoverage(s: Scenario, q: number): Scenario {
  const c = cloneScenario(s);
  c.sdc = { ...c.sdc, detection: { ...c.sdc.detection, coverage: q } };
  return c;
}
function withFallback(s: Scenario, hours: number): Scenario {
  const c = cloneScenario(s);
  c.sdc = { ...c.sdc, fallbackDelayHours: hours };
  return c;
}
function deliveredOf(s: Scenario): number {
  return evaluateScenario(s).training?.deliveredGoodput ?? 0;
}
/** smallest x in [lo, hi] with f(x) ≥ target for an increasing f (undefined when f(hi) < target) */
function bisectUp(f: (x: number) => number, lo: number, hi: number, target: number): number | undefined {
  if (f(hi) < target) return undefined;
  if (f(lo) >= target) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}
/** largest x in [lo, hi] with f(x) ≥ target for a decreasing f (undefined when f(lo) < target) */
function bisectDown(f: (x: number) => number, lo: number, hi: number, target: number): number | undefined {
  if (f(lo) < target) return undefined;
  if (f(hi) >= target) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function allocateScenario(s: Scenario, opts: { goodputTarget?: number; availabilityTarget?: number; method?: AllocationMethod; restartShare?: number; basis?: AllocationBasis; lossMethod?: LossBudgetMethod; lossWeights?: Partial<Record<LedgerLossLine, number>> } = {}): ScenarioAllocation {
  const method = opts.method ?? 'arinc';
  let r = evaluateScenario(s);
  const notes: string[] = [];
  const out: ScenarioAllocation = { target: { goodput: opts.goodputTarget ?? s.targets.goodput, availability: opts.availabilityTarget ?? s.targets.availability }, notes };
  // v3.5 loss budget on the current (unmodified) ledger: the ledger closes on the delivered goodput, so it is compared with the
  // delivered target (the effective basis with silent corruption would mix two 口径 and is skipped)
  if (s.workload.type === 'training' && r.training && out.target.goodput !== undefined && (opts.basis === 'delivered' || !r.training.sdc)) {
    out.lossBudget = lossBudget(r.training.ledger, out.target.goodput, s.workload.durationDays * 24, { method: opts.lossMethod, weights: opts.lossWeights });
  }
  const subs = subsystemsFrom(s);
  out.coincide = coincidingMethods(subs);
  let budgetScenario = s;
  let goodputTarget = out.target.goodput;
  if (s.workload.type === 'training' && r.training && goodputTarget !== undefined && opts.basis === 'delivered') {
    const tr = r.training;
    if (!tr.sdc) {
      notes.push('delivered basis: the scenario has no silent corruption, so the delivered goodput equals the effective goodput');
    } else {
      const Gd = goodputTarget;
      // upper bound reachable by hardware alone: failure rates → 0 with the current silent-corruption policy
      const noHw = cloneScenario(s);
      for (const c of noHw.components) c.failure = { ...c.failure, value: c.failure.value * 1e-6 };
      const maxByHardware = deliveredOf(noHw);
      const feasibleByHardware = maxByHardware >= Gd;
      const q0 = s.sdc.detection.coverage;
      const requiredCoverage = tr.deliveredGoodput >= Gd ? q0 : bisectUp((q) => deliveredOf(withCoverage(s, q)), q0, 1, Gd);
      const requiredFallback = tr.deliveredGoodput >= Gd ? s.sdc.fallbackDelayHours : bisectDown((D) => deliveredOf(withFallback(s, D)), 0.01, s.sdc.fallbackDelayHours, Gd);
      let coverageUsed = q0;
      if (!feasibleByHardware) {
        if (requiredCoverage !== undefined) {
          coverageUsed = requiredCoverage;
          budgetScenario = withCoverage(s, requiredCoverage);
          r = evaluateScenario(budgetScenario);
          notes.push(`delivered ${(Gd * 100).toFixed(1)} % is out of reach of the hardware alone (at most ${(maxByHardware * 100).toFixed(2)} % with the current silent-corruption policy): the budgets below assume immediate silent-corruption detection raised to ${(requiredCoverage * 100).toFixed(2)} %`);
        } else notes.push(`delivered ${(Gd * 100).toFixed(1)} % is out of reach even with 100 % immediate detection; shorten the fallback delay or the recovery`);
      }
      const tr2 = r.training!;
      const factor = tr2.effectiveGoodput > 0 ? tr2.deliveredGoodput / tr2.effectiveGoodput : 1;
      const phiOther = tr2.headlineGoodput > 0 ? tr2.effectiveGoodput / tr2.headlineGoodput : 1;
      const effectiveTarget = Math.min(0.9999, Gd / Math.max(factor, 1e-9));
      const headlineTarget = Math.min(0.9999, effectiveTarget / Math.max(phiOther, 1e-9));
      out.sdc = { basis: 'delivered', deliveredTarget: Gd, currentDelivered: tr.deliveredGoodput, currentEffective: tr.effectiveGoodput, factor, effectiveTarget, headlineTarget, maxDeliveredByHardware: maxByHardware, feasibleByHardware, requiredCoverage, requiredFallbackDelayH: requiredFallback, coverageUsed };
      notes.push(`delivered target ${(Gd * 100).toFixed(1)} % ÷ delivery factor ${factor.toFixed(4)} = effective target ${(effectiveTarget * 100).toFixed(2)} %; ÷ sub-health / spares / local factor ${phiOther.toFixed(4)} = headline (interruption) target ${(headlineTarget * 100).toFixed(2)} %`);
      goodputTarget = headlineTarget;
    }
  }
  if (s.workload.type === 'training' && r.training && goodputTarget !== undefined) {
    const w = budgetScenario.workload as Extract<Scenario['workload'], { type: 'training' }>;
    const gb = goodputBudget({
      goodputTarget,
      nGpus: w.nGpus,
      deltaS: w.deltaS,
      recoveryS: r.training.recoveryS,
      lambdaPerGpuHour: r.training.interruptionRatePerHour / w.nGpus,
      restartShare: opts.restartShare,
    });
    out.goodput = gb;
    notes.push(...gb.notes);
    const lambdaJobRequired = 3600 / gb.fixRecovery.requiredMtbiS; // per hour
    if (Number.isFinite(lambdaJobRequired) && lambdaJobRequired > 0) {
      try {
        out.rateAllocation = runMethod(method, subs, lambdaJobRequired);
        if (lambdaJobRequired >= r.training.interruptionRatePerHour) notes.push('current interruption rate already meets the goodput target at the current recovery time: the rate table shows how far each class may degrade (allowed rates above the current ones, improvement factors below 1); minimum-effort and cost-optimal keep the current rates in this case');
        const co = coincidingMethods(subs);
        if (co.length) notes.push(`methods that give the same split for this scenario: ${co.join(', ')} (identical unit counts, importance and feasibility weights across classes; edit the class weights to differentiate them)`);
      } catch (e) {
        notes.push(`rate allocation (${method}) failed: ${(e as Error).message}`);
      }
    }
    if (r.training.chain.active) notes.push('a mechanism chain is active: the budget uses the global recovery time and the hardware interruption rate; pause-only outcomes (replay, elastic) make the real loss smaller than the first-order budget');
    const composed = resolveRecovery(budgetScenario).compose(w.nGpus);
    const stages = composed.stages.filter((st) => st.name !== 'recompute').map((st) => ({ name: st.name, currentS: st.meanS, floorS: Math.min(st.meanS, st.name === 'detect' ? 5 : st.name === 'localize' ? 5 : 0) }));
    if (gb.fixRate.requiredRecoveryS > 0) {
      out.stageAllocation = allocateRecoveryStages(stages, gb.fixRate.requiredRecoveryS).map((b, i) => ({ name: b.name, currentS: stages[i].currentS, budgetS: b.budgetS, improvementFactor: b.improvementFactor }));
      if (gb.fixRate.requiredRecoveryS >= r.training.recoveryS) notes.push('current recovery time already meets the goodput target at the current interruption rate: stage budgets show the allowed times');
    }
  }
  if (out.target.availability !== undefined) {
    out.unavailability = allocateUnavailability(subs, out.target.availability);
  }
  return out;
}
