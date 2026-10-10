/**
 * Scenario-level analyses used by the UI, CLI and MCP: option comparison, tornado sensitivity,
 * allocation from a goodput or availability target, and quick option variants.
 */
import { evaluateScenario, type EvaluationResult } from './evaluate.js';
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

export type TornadoMetric = 'goodput' | 'availability' | 'lostDollarsPerDay' | 'mtbiHours';

export function metricOf(r: EvaluationResult, metric: TornadoMetric): number {
  switch (metric) {
    case 'goodput':
      return r.training?.effectiveGoodput ?? r.system.capacityAvailability;
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

export interface ScenarioAllocation {
  target: { goodput?: number; availability?: number };
  /** goodput-budget split (training) */
  goodput?: GoodputBudgetResult;
  /** allocation of the required job interruption rate across component classes (fix R, tighten λ) */
  rateAllocation?: AllocationResult;
  /** allocation of the required recovery time across pipeline stages (fix λ, tighten R) */
  stageAllocation?: { name: string; currentS: number; budgetS: number; improvementFactor: number }[];
  /** availability-target split across subsystems */
  unavailability?: { rows: UnavailabilityRow[]; unavailabilityBudget: number };
  notes: string[];
}

function subsystemsFrom(s: Scenario): Subsystem[] {
  const counts = computeCounts(s);
  return s.components
    .filter((c) => c.enabled)
    .map((c) => {
      const ci = componentInstances(c, counts);
      return {
        id: c.id,
        name: c.name?.en ?? c.name?.zh ?? c.id,
        count: ci.total,
        currentLambda: ci.lambda,
        importance: 1,
        feasibilityWeight: c.failure.provenance?.confidence === 'assumed' ? 2 : 1,
        cost: { a: 1, b: 1 },
        mttr: ci.mttr,
        fixed: false,
      };
    });
}

function runMethod(method: AllocationMethod, subs: Subsystem[], lambdaSystem: number): AllocationResult {
  switch (method) {
    case 'equal':
      return equalApportionment(subs, lambdaSystem);
    case 'arinc':
      return arinc(subs, lambdaSystem);
    case 'agree':
      return agree(subs, lambdaSystem);
    case 'feasibility':
      return feasibilityOfImprovement(subs, lambdaSystem);
    case 'minimum-effort':
      return minimumEffort(subs, lambdaSystem);
    case 'cost-optimal':
      return costOptimal(subs, lambdaSystem);
  }
}

export function allocateScenario(s: Scenario, opts: { goodputTarget?: number; availabilityTarget?: number; method?: AllocationMethod; restartShare?: number } = {}): ScenarioAllocation {
  const method = opts.method ?? 'arinc';
  const r = evaluateScenario(s);
  const notes: string[] = [];
  const out: ScenarioAllocation = { target: { goodput: opts.goodputTarget ?? s.targets.goodput, availability: opts.availabilityTarget ?? s.targets.availability }, notes };
  const subs = subsystemsFrom(s);
  if (s.workload.type === 'training' && r.training && out.target.goodput !== undefined) {
    const gb = goodputBudget({
      goodputTarget: out.target.goodput,
      nGpus: s.workload.nGpus,
      deltaS: s.workload.deltaS,
      recoveryS: r.training.recoveryS,
      lambdaPerGpuHour: r.training.interruptionRatePerHour / s.workload.nGpus,
      restartShare: opts.restartShare,
    });
    out.goodput = gb;
    notes.push(...gb.notes);
    const lambdaJobRequired = 3600 / gb.fixRecovery.requiredMtbiS; // per hour
    if (lambdaJobRequired < r.training.interruptionRatePerHour) {
      try {
        out.rateAllocation = runMethod(method, subs, lambdaJobRequired);
      } catch (e) {
        notes.push(`rate allocation (${method}) failed: ${(e as Error).message}`);
      }
    } else notes.push('current interruption rate already meets the goodput target at the current recovery time');
    const composed = resolveRecovery(s).compose(s.workload.nGpus);
    const stages = composed.stages.filter((st) => st.name !== 'recompute').map((st) => ({ name: st.name, currentS: st.meanS, floorS: Math.min(st.meanS, st.name === 'detect' ? 5 : st.name === 'localize' ? 5 : 0) }));
    if (gb.fixRate.requiredRecoveryS > 0 && gb.fixRate.requiredRecoveryS < r.training.recoveryS) {
      out.stageAllocation = allocateRecoveryStages(stages, gb.fixRate.requiredRecoveryS).map((b, i) => ({ name: b.name, currentS: stages[i].currentS, budgetS: b.budgetS, improvementFactor: b.improvementFactor }));
    } else notes.push('current recovery time already meets the goodput target at the current interruption rate');
  }
  if (out.target.availability !== undefined) {
    out.unavailability = allocateUnavailability(subs, out.target.availability);
  }
  return out;
}
