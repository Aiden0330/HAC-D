/**
 * Scenario evaluation orchestrator: structure → availability KPIs; workload → goodput / N+k KPIs;
 * recovery pipeline → R(N); spares; cost; importance; cut sets; design-review checklist.
 * Every KPI is returned together with the formula that produced it.
 */
import { evaluate as evalRbd, importance, cutSets, listBlocks, compensationWaterfall, type Block, type BlockResult, type ImportanceRow, type CutSetResult, type CompensationResult, type WaterfallStep } from '../rbd/index.js';
import { composeMttr, recoveryTimeS, recoverySampler as pipelineSampler, PIPELINE_PRESETS, type Pipeline, type ComposedMttr, type StageTime } from '../mttr/index.js';
import { subhealthUnit, humanFraction as repairHumanFraction, isDual } from '../ctmc/repair.js';
import { ladderExpectation, ladderSampler, LADDER_PRESETS, type Ladder, type LadderResult } from '../recovery/ladder.js';
import type { Rng } from '../math/rng.js';
import { youngInterval, dalyThreeTerm, dalyExact, saxenaOptimalPeriod, goodputFirstOrder, dalyGoodput, scaleTable, type GoodputFirstOrder, type ScaleRow } from '../checkpoint/index.js';
import { hotSparesBinomial, hotSparesPoisson, repairPipelineSpares, replacementsOverJob } from '../sparing/index.js';
import { binomCdf } from '../math/special.js';
import { lostDollarsPerDay, wastedGpuHoursPerDay } from '../cost/index.js';
import { computeCounts, buildStructure, interruptionRatePerHour, type Counts, type ComponentInstances } from './build.js';
import { designReviewChecklist, type ChecklistItem } from './checklist.js';
import type { Scenario } from './schema.js';

export interface ComponentRow {
  id: string;
  name: string;
  subsystem: string;
  count: number;
  lambdaPerUnitPerHour: number;
  lambdaAggregatePerHour: number;
  /** share of the synchronous-job interruption rate */
  interruptionShare: number;
  /** mean repair time E[R] over both paths, hours */
  mttrHours: number;
  mttrAutoHours?: number;
  mttrManualHours?: number;
  autoCoverage?: number;
  autoSuccess?: number;
  /** P(sub-healthy | not down) per unit */
  subhealthProbability?: number;
  subhealthPerformance?: number;
  subhealthPolicy?: string;
  confidence?: string;
  koujing?: string;
}

/** one availability measure of the system */
export interface Measure {
  availability: number;
  unavailability: number;
  mtbfHours: number;
  equivalentMttrHours: number;
  failureFrequencyPerHour: number;
  capacityAvailability: number;
}

export interface SystemKpis {
  availability: number;
  capacityAvailability: number;
  unavailability: number;
  failureFrequencyPerHour: number;
  mtbfHours: number;
  equivalentMttrHours: number;
  failuresPerYear: number;
  weakestBlock: { id: string; name: string } | null;
  /** v2: original (inherent) vs compensated (after fault tolerance) and the sub-health measures */
  measures: {
    original: Measure;
    compensated: Measure;
    strict: number;
    tolerant: number;
    performability: number;
    switchoverPenalty: number;
    gain: CompensationResult['gain'];
  };
  waterfall: WaterfallStep[];
  /** share of system downtime spent on the automatic repair path (undefined without dual repair) */
  autoDowntimeShare?: number;
  /** share of failure events that reach a person: Σ n_i λ_i (1 − c_i s_i) / Σ n_i λ_i */
  humanFraction: number;
  /** a first-order or reduced model was used somewhere in the structure */
  approximate: boolean;
}

export interface TrainingKpis {
  nGpus: number;
  interruptionRatePerHour: number;
  mtbiHours: number;
  mtbiS: number;
  recoveryS: number;
  recovery: ComposedMttr;
  recoveryKind: 'pipeline' | 'ladder';
  recoveryId: string;
  ladder?: LadderResult;
  /** v2 sub-health at job level: straggler law and isolation interruptions */
  subhealth?: {
    pSlowed: number;
    performanceFactor: number;
    minPerformance: number;
    isolationInterruptionsPerHour: number;
    hardwareInterruptionsPerHour: number;
  };
  intervalModel: string;
  tauS: number;
  recomputePerInterruptionS: number;
  lossPerInterruptionS: number;
  firstOrder: GoodputFirstOrder;
  /** goodput from Daly's full expected-time model at the same interval */
  dalyGoodput: number;
  /** probability that hot spares are exhausted (pool template), else 0 */
  blockedProbability: number;
  effectiveGoodput: number;
  interruptionsPerDay: number;
  expectedInterruptions: number;
  pNoInterruption24h: number;
  wallClockDays: number;
  wastedGpuHoursPerDay: number;
  lostDollarsPerDay: number;
  scale: ScaleRow[];
}

export interface InferenceKpis {
  replicasRequired: number;
  spareReplicas: number;
  replicaLambdaPerHour: number;
  replicaMtbfHours: number;
  replicaMttrHours: number;
  replicaUnavailability: number;
  serviceUpAvailability: number;
  capacityAvailability: number;
  kRequiredForTarget: number;
  curve: { k: number; capacityAvailability: number }[];
  replicaFailuresPerDay: number;
  pNoReplicaFailureInWindow: number;
  expectedDownReplicas: number;
  idleSpareGpuHoursPerDay: number;
  spareDollarsPerDay: number;
}

export interface SparesKpis {
  nodes: number;
  nodeLambdaPerHour: number;
  nodeDailyFailureProbability: number;
  quantile: number;
  hotSparesBinomial: number;
  hotSparesPoissonReplenish: number;
  configuredHotSpares: number;
  repairPipeline: { mean: number; quantile: number; fraction: number };
  replacementsOverJob: { mean: number; quantile: number };
}

export interface EvaluationResult {
  scenarioName: string;
  counts: Counts;
  structure: { root: Block; result: BlockResult; notes: string[] };
  system: SystemKpis;
  components: ComponentRow[];
  training?: TrainingKpis;
  inference?: InferenceKpis;
  spares?: SparesKpis;
  importance: ImportanceRow[];
  cutSets: CutSetResult;
  checklist: ChecklistItem[];
  assumptions: string[];
  warnings: string[];
  formulas: Record<string, string>;
}

export const SCALE_SIZES = [1024, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 1000000];

export function resolvePipeline(s: Scenario): Pipeline {
  if (s.recovery.mode === 'preset') {
    const p = PIPELINE_PRESETS[s.recovery.preset];
    if (!p) throw new Error(`unknown recovery preset '${s.recovery.preset}'`);
    return p;
  }
  if (s.recovery.mode === 'ladder') throw new Error('recovery is a ladder: use resolveRecovery()');
  return { id: 'custom', name: 'Custom pipeline', stages: s.recovery.stages.map((st) => ({ ...st })) as Pipeline['stages'] };
}

/** Recovery model shared by the pipeline (v1) and the ladder (v2): R(N), stage/rung breakdown, sampler. */
export interface RecoveryModel {
  kind: 'pipeline' | 'ladder';
  id: string;
  name?: string;
  pipeline?: Pipeline;
  ladder?: Ladder;
  /** mean recovery time R(N) in seconds (recompute excluded) */
  meanS(n: number): number;
  compose(n: number): ComposedMttr;
  ladderResult?(n: number): LadderResult;
  sampler(n: number, rng: Rng): () => number;
}

export function resolveLadder(s: Scenario): Ladder | undefined {
  if (s.recovery.mode !== 'ladder') return undefined;
  if (s.recovery.rungs) return { id: s.recovery.preset ?? 'custom-ladder', rungs: s.recovery.rungs as Ladder['rungs'] };
  const l = LADDER_PRESETS[s.recovery.preset ?? ''];
  if (!l) throw new Error(`unknown recovery ladder preset '${s.recovery.preset}'`);
  return l;
}

export function resolveRecovery(s: Scenario): RecoveryModel {
  const l = resolveLadder(s);
  if (l) {
    return {
      kind: 'ladder',
      id: l.id,
      name: l.name?.en ?? l.id,
      ladder: l,
      meanS: (n) => ladderExpectation(l, n).meanS,
      compose: (n) => {
        const r = ladderExpectation(l, n);
        const stages: StageTime[] = r.rungs.map((x) => ({ name: x.id, meanS: x.contributionS, share: x.share, note: `${x.kind}: reach ${(x.reachProbability * 100).toPrecision(3)} %, success ${x.successProbability}, ${x.meanS.toFixed(0)} s when reached` }));
        let dominant: StageTime | undefined;
        for (const st of stages) if (!dominant || st.meanS > dominant.meanS) dominant = st;
        return { totalS: r.meanS, stages, dominant: dominant?.name ?? null, mttrS: r.meanS, lossOnlyS: 0 };
      },
      ladderResult: (n) => ladderExpectation(l, n),
      sampler: (n, rng) => ladderSampler(l, n, rng),
    };
  }
  const p = resolvePipeline(s);
  return {
    kind: 'pipeline',
    id: p.id,
    name: p.name,
    pipeline: p,
    meanS: (n) => recoveryTimeS(p, n),
    compose: (n) => composeMttr(p, n),
    sampler: (n, rng) => pipelineSampler(p, n, rng),
  };
}

function measureOf(r: BlockResult): Measure {
  return { availability: r.availability, unavailability: r.unavailability, mtbfHours: r.mtbf, equivalentMttrHours: r.equivalentMttr, failureFrequencyPerHour: r.failureFrequency, capacityAvailability: r.capacity };
}

function componentRows(items: ComponentInstances[], totalRate: number): ComponentRow[] {
  return items
    .map((ci) => ({
      id: ci.component.id,
      name: ci.component.name?.en ?? ci.component.name?.zh ?? ci.component.id,
      subsystem: ci.component.subsystem,
      count: ci.total,
      lambdaPerUnitPerHour: ci.lambda,
      lambdaAggregatePerHour: ci.lambda * ci.total,
      interruptionShare: totalRate > 0 ? (ci.lambda * ci.total) / totalRate : 0,
      mttrHours: ci.mttr,
      mttrAutoHours: isDual(ci.repair) ? ci.repair.autoMttrH : undefined,
      mttrManualHours: ci.repair.manualMttrH,
      autoCoverage: isDual(ci.repair) ? ci.repair.coverage : undefined,
      autoSuccess: isDual(ci.repair) ? ci.repair.successProbability : undefined,
      subhealthProbability: ci.subhealth ? subhealthUnit(ci.lambda, ci.repair, ci.subhealth).pSubhealthGivenNotDown : undefined,
      subhealthPerformance: ci.subhealth?.performance,
      subhealthPolicy: ci.subhealth?.policy,
      confidence: ci.component.failure.provenance?.confidence,
      koujing: ci.component.failure.koujing ? `${ci.component.failure.koujing.event} / ${ci.component.failure.koujing.denominator} / ${ci.component.failure.koujing.level}` : undefined,
    }))
    .sort((a, b) => b.lambdaAggregatePerHour - a.lambdaAggregatePerHour);
}

function weakest(result: BlockResult): { id: string; name: string } | null {
  if (result.children.length === 0) return null;
  let best: BlockResult | null = null;
  for (const ch of result.children) if (!best || ch.failureFrequency > best.failureFrequency) best = ch;
  return best ? { id: best.id, name: best.name } : null;
}

function findBlock(result: BlockResult, id: string): BlockResult | undefined {
  if (result.id === id) return result;
  for (const ch of result.children) {
    const f = findBlock(ch, id);
    if (f) return f;
  }
  return undefined;
}

/** Per-node failure rate from per-GPU and per-node component classes (without redundancy). */
function nodeLambda(items: ComponentInstances[], counts: Counts): number {
  return items
    .filter((ci) => (ci.component.countRule.per === 'gpu' || ci.component.countRule.per === 'node') && !ci.component.redundancy)
    .reduce((a, ci) => a + (ci.lambda * ci.total) / counts.nodes, 0);
}

export function evaluateScenario(s: Scenario): EvaluationResult {
  const warnings: string[] = [];
  const formulas: Record<string, string> = {};
  const counts = computeCounts(s);
  const built = buildStructure(s, counts);
  const root = built.root;
  const result = evalRbd(root);
  const items = built.items;
  const hardwareRate = interruptionRatePerHour(items);
  const components = componentRows(items, hardwareRate);

  // v2: sub-health at unit level (straggler law, isolation interruptions) and repair-path accounting
  let pNotSlowed = 1;
  let isolationRate = 0;
  let minPerformance = 1;
  let anySubhealth = false;
  for (const ci of items) {
    if (!ci.subhealth) continue;
    anySubhealth = true;
    const r = subhealthUnit(ci.lambda, ci.repair, ci.subhealth);
    pNotSlowed *= Math.pow(1 - r.pSubhealthGivenNotDown, ci.total);
    isolationRate += r.isolationFrequency * ci.total;
    minPerformance = Math.min(minPerformance, ci.subhealth.performance);
  }
  const pSlowed = 1 - pNotSlowed;
  const performanceFactor = 1 - pSlowed * (1 - minPerformance);
  const totalRate = hardwareRate + isolationRate;
  const lambdaWeighted = items.reduce((a, ci) => a + ci.lambda * ci.total, 0);
  const humanFraction = lambdaWeighted > 0 ? items.reduce((a, ci) => a + ci.lambda * ci.total * repairHumanFraction(ci.repair), 0) / lambdaWeighted : 1;

  const comp = compensationWaterfall(root);
  const system: SystemKpis = {
    availability: result.availability,
    capacityAvailability: result.capacity,
    unavailability: result.unavailability,
    failureFrequencyPerHour: result.failureFrequency,
    mtbfHours: result.mtbf,
    equivalentMttrHours: result.equivalentMttr,
    failuresPerYear: result.failureFrequency * 8760,
    weakestBlock: weakest(result),
    measures: {
      original: measureOf(comp.original),
      compensated: measureOf(result),
      strict: result.strict ?? result.availability,
      tolerant: result.tolerant ?? result.availability,
      performability: result.capacity,
      switchoverPenalty: comp.switchoverPenalty,
      gain: comp.gain,
    },
    waterfall: comp.steps,
    autoDowntimeShare: result.autoDowntimeShare,
    humanFraction,
    approximate: !!result.approximate,
  };
  formulas.availability = 'A_sys = Π A_i (series); k-of-n: Σ_{j≤n−k} C(n,j) u^j (1−u)^{n−j}, u = λ·MTTR/(1+λ·MTTR); parallel: 1 − Π(1−A_i)';
  formulas.mtbf = 'MTBF = A_sys / ν_sys, ν_sys = steady-state system failure frequency; equivalent MTTR = (1 − A_sys)/ν_sys';
  formulas.measures = 'original (原始): every unit fault is an outage repaired manually, λ_o = λ + λ_sh, E[R_o] = (λT_m + λ_sh D)/(λ + λ_sh), redundancy removed; compensated (补偿后): redundancy, switchover, automatic recovery and the sub-health policy as configured; waterfall enables them in that order';
  formulas.repair = 'E[R] = c·T_a + (1 − c·s)·T_m (c = automatic coverage, s = automatic success); A = 1/(1 + λ·E[R]); automatic share of downtime = c·T_a/E[R]; human fraction = 1 − c·s';
  formulas.switchover = 'k-of-n: exact chain over (in automatic repair, in manual repair, switch-failed); micro-outage U_sw = Σ π·w·λ·p_sw·t_sw/3600; a failed switchover (1 − p_sw) is cleared in T_sf';
  formulas.subhealth = 'A_strict = π_U; A_tolerant = π_U + π_H; performability = π_U + φ·π_H; sub-health counts as down when φ < threshold; job: P(slowed) = 1 − Π_i (1 − p_H,i)^{n_i}, φ_job = 1 − P(slowed)·(1 − φ_min); isolate: ν_iso = π_H·p_d/T_d adds interruptions';

  const recoveryModel = resolveRecovery(s);
  const assumptions = [...s.assumptions, ...built.notes, 'failures of different components are independent (common cause only through declared β factors)', 'closed forms assume exponential lifetimes and repairs; non-exponential inputs need the Monte Carlo module'];
  if (anySubhealth) assumptions.push('job-level sub-health uses the straggler law with the lowest performance factor among sub-healthy classes (conservative)');
  if (system.approximate) warnings.push('a first-order switchover correction or a reduced repair model was used in at least one block (see block notes)');

  let training: TrainingKpis | undefined;
  let inference: InferenceKpis | undefined;
  let spares: SparesKpis | undefined;
  let smallParameter: number | undefined;
  let restartRatio: number | undefined;
  let deltaS: number | undefined;

  if (s.workload.type === 'training') {
    const w = s.workload;
    const N = w.nGpus;
    deltaS = w.deltaS;
    const lambdaJob = totalRate; // every failure (and every detected isolation) interrupts a synchronous job
    const mtbiHours = lambdaJob > 0 ? 1 / lambdaJob : Infinity;
    const mtbiS = mtbiHours * 3600;
    const recovery = recoveryModel.compose(N);
    const recoveryS = recoveryModel.meanS(N);
    let tauS: number;
    if (w.intervalS !== undefined) tauS = w.intervalS;
    else if (w.intervalModel === 'daly3') tauS = dalyThreeTerm(deltaS, mtbiS);
    else if (w.intervalModel === 'dalyExact') tauS = dalyExact(deltaS, mtbiS);
    else if (w.intervalModel === 'saxena') tauS = Math.max(1e-9, saxenaOptimalPeriod(mtbiS, deltaS, recoveryS) - deltaS);
    else tauS = youngInterval(deltaS, mtbiS);
    const recompute = w.recovery === 'replica' ? (w.stepTimeS ?? 0) : tauS / 2;
    const fo = goodputFirstOrder(deltaS, tauS, mtbiS, recoveryS);
    if (w.recovery === 'replica') {
      // replica recovery: recompute is one step instead of τ/2; adjust the first-order terms
      fo.terms.recompute = recompute / mtbiS;
      fo.terms.total = fo.terms.save + fo.terms.recompute + fo.terms.restart;
      fo.goodput = Math.max(0, 1 - fo.terms.total);
      assumptions.push('replica recovery: recompute per interruption = one step (JIT / FlashRecovery), save term unchanged');
    }
    const dg = dalyGoodput(tauS, deltaS, mtbiS, recoveryS);
    const pool = findBlock(result, 'node-pool');
    const blocked = pool ? pool.unavailability : 0;
    const effective = fo.goodput * (1 - blocked) * performanceFactor;
    smallParameter = fo.smallParameter;
    restartRatio = fo.restartRatio;
    warnings.push(...fo.warnings);
    const lambdaPerGpu = lambdaJob / N;
    const scale = scaleTable(lambdaPerGpu, deltaS, (n) => recoveryModel.meanS(n), SCALE_SIZES, w.intervalModel === 'daly3' ? 'daly3' : w.intervalModel === 'dalyExact' ? 'dalyExact' : 'young');
    const nGpuEff = N;
    training = {
      nGpus: N,
      interruptionRatePerHour: lambdaJob,
      mtbiHours,
      mtbiS,
      recoveryS,
      recovery,
      recoveryKind: recoveryModel.kind,
      recoveryId: recoveryModel.id,
      ladder: recoveryModel.ladderResult?.(N),
      subhealth: anySubhealth ? { pSlowed, performanceFactor, minPerformance, isolationInterruptionsPerHour: isolationRate, hardwareInterruptionsPerHour: hardwareRate } : undefined,
      intervalModel: w.intervalS !== undefined ? 'fixed' : w.intervalModel,
      tauS,
      recomputePerInterruptionS: recompute,
      lossPerInterruptionS: recompute + recoveryS,
      firstOrder: fo,
      dalyGoodput: dg,
      blockedProbability: blocked,
      effectiveGoodput: effective,
      interruptionsPerDay: 24 * lambdaJob,
      expectedInterruptions: w.durationDays * 24 * lambdaJob,
      pNoInterruption24h: Math.exp(-24 * lambdaJob),
      wallClockDays: effective > 0 ? w.durationDays / effective : Infinity,
      wastedGpuHoursPerDay: wastedGpuHoursPerDay(nGpuEff, effective),
      lostDollarsPerDay: lostDollarsPerDay({ nGpus: nGpuEff, pricePerGpuHour: s.costs.pricePerGpuHour }, effective),
      scale,
    };
    formulas.mtbi = 'λ_job = Σ n_i λ_i (all components, synchronous job); MTBI = 1/λ_job';
    formulas.interval = w.intervalModel === 'young' ? 'τ = √(2δM) (Young / Daly-Young)' : w.intervalModel === 'daly3' ? 'τ = √(2δM)[1 + (1/3)(δ/2M)^{1/2} + (1/9)(δ/2M)] − δ (Daly three-term)' : w.intervalModel === 'dalyExact' ? '(1 − τ/M)e^{(τ+δ)/M} = 1 (Daly exact)' : 'T_c* = T_s + √(2(T_f+T_r)T_s + T_s²) (Saxena, availability objective)';
    formulas.goodput = 'goodput ≈ 1 − δ/τ − (τ/2 + R)/M (first order); Daly full: τ / (M e^{R/M}(e^{(τ+δ)/M} − 1))';
    formulas.recovery = recoveryModel.kind === 'ladder' ? 'R(N) = E[T] = Σ_i P_i·t_i(N), P_i = Π_{j<i}(1 − s_j) (recovery ladder; last rung manual); recompute = τ/2 (periodic checkpoint) or one step (replica)' : 'R(N) = Σ stages ①–⑤ with scale laws; recompute = τ/2 (periodic checkpoint) or one step (replica)';
    if (anySubhealth) formulas.goodputSubhealth = 'effective goodput = goodput × (1 − P_blocked) × φ_job; isolation interruptions ν_iso enter λ_job';
    formulas.scale = 'MTBI(N) = 1/(N·λ_GPU-equivalent), λ_GPU-equivalent = λ_job/N at the configured size (fixed components scaled proportionally)';
    formulas.cost = 'wasted GPU·h/day = N × 24 × (1 − goodput); $/day = wasted GPU·h × price';

    // spares at node granularity
    const lamNode = nodeLambda(items, counts);
    const pDaily = 1 - Math.exp(-lamNode * 24);
    const workingNodes = Math.ceil(N / s.topology.gpusPerNode);
    spares = {
      nodes: workingNodes,
      nodeLambdaPerHour: lamNode,
      nodeDailyFailureProbability: pDaily,
      quantile: s.spares.quantile,
      hotSparesBinomial: hotSparesBinomial(workingNodes, pDaily, s.spares.quantile),
      hotSparesPoissonReplenish: hotSparesPoisson(workingNodes, lamNode, w.spareReplenishHours, s.spares.quantile),
      configuredHotSpares: w.hotSpareNodes,
      repairPipeline: repairPipelineSpares(workingNodes, lamNode, s.spares.hardwareReplacementFraction, s.spares.turnaroundHours, s.spares.quantile),
      replacementsOverJob: replacementsOverJob(workingNodes, lamNode, s.spares.hardwareReplacementFraction, w.durationDays * 24, s.spares.quantile),
    };
    formulas.spares = 'hot spares: smallest k with P(Binomial(N_nodes, p_daily) ≤ k) ≥ q (ByteRobust); Poisson(N·λ·T_replenish) quantile (Meta); repair pipeline: Poisson(N·λ·f_hw·L) quantile';
  }

  if (s.workload.type === 'inference') {
    const w = s.workload;
    const total = w.replicasRequired + w.spareReplicas;
    const members = items.filter((ci) => (ci.component.countRule.per === 'gpu' || ci.component.countRule.per === 'node') && !ci.component.redundancy);
    const lamRep = members.reduce((a, ci) => a + (ci.lambdaIndependent * ci.total) / total, 0);
    const mttrRep = w.replicaRecoveryHours ?? Math.max(...members.map((m) => m.mttr), 0.1);
    const u = (lamRep * mttrRep) / (1 + lamRep * mttrRep);
    const capAt = (k: number) => binomCdf(w.replicasRequired + k, k, u);
    let kReq = 0;
    while (kReq < 5000 && capAt(kReq) < w.capacityTarget) kReq++;
    const kMax = Math.max(kReq, w.spareReplicas) + 3;
    const curve = Array.from({ length: kMax + 1 }, (_, k) => ({ k, capacityAvailability: capAt(k) }));
    const idle = w.spareReplicas * w.gpusPerReplica * 24;
    inference = {
      replicasRequired: w.replicasRequired,
      spareReplicas: w.spareReplicas,
      replicaLambdaPerHour: lamRep,
      replicaMtbfHours: lamRep > 0 ? 1 / lamRep : Infinity,
      replicaMttrHours: mttrRep,
      replicaUnavailability: u,
      serviceUpAvailability: 1 - Math.pow(u, total),
      capacityAvailability: capAt(w.spareReplicas),
      kRequiredForTarget: kReq,
      curve,
      replicaFailuresPerDay: total * lamRep * 24,
      pNoReplicaFailureInWindow: Math.exp(-total * lamRep * w.windowHours),
      expectedDownReplicas: total * u,
      idleSpareGpuHoursPerDay: idle,
      spareDollarsPerDay: idle * (s.costs.spareUnitCostPerHour ?? s.costs.pricePerGpuHour),
    };
    formulas.inference = 'u_r = gλ·MTTR/(1 + gλ·MTTR); A_any = 1 − u_r^{n+k}; A_cap = Σ_{j≤k} C(n+k, j) u_r^j (1−u_r)^{n+k−j}';
    if (w.spareReplicas < kReq) warnings.push(`configured spare replicas (${w.spareReplicas}) below the ${kReq} needed for the ${(w.capacityTarget * 100).toFixed(3)} % capacity target`);
  }

  const imp = importance(root);
  const cs = cutSets(root, 2000);
  const stageNames = new Set(recoveryModel.pipeline ? recoveryModel.pipeline.stages.map((st) => st.name) : ['detect', 'localize', 'remediate', 'restart', 'load']);
  const checklist = designReviewChecklist(s, {
    smallParameter,
    restartRatio,
    deltaS,
    hasLoadStage: stageNames.has('load'),
    stageCount: recoveryModel.pipeline ? recoveryModel.pipeline.stages.length : recoveryModel.ladder!.rungs.length,
    hotSparesConfigured: s.workload.type === 'training' ? s.workload.hotSpareNodes : s.workload.spareReplicas,
    hotSparesRequired: spares ? spares.hotSparesBinomial : inference ? inference.kRequiredForTarget : undefined,
    anyNonExponential: items.some((ci) => (ci.component.failure.weibullShape !== undefined && ci.component.failure.weibullShape !== 1) || !!ci.component.lemon || !!ci.component.infant || !!ci.component.repair.distribution),
    anyCcf: items.some((ci) => !!ci.component.ccf && ci.component.ccf.beta > 0),
    anyFailslow: items.some((ci) => !!ci.subhealth),
    monetised: s.costs.pricePerGpuHour > 0,
  });
  if (listBlocks(root).length > 400) warnings.push('large structure: importance measures evaluated for every block may be slow');

  return { scenarioName: s.meta.name, counts, structure: { root, result, notes: built.notes }, system, components, training, inference, spares, importance: imp, cutSets: cs, checklist, assumptions, warnings, formulas };
}
