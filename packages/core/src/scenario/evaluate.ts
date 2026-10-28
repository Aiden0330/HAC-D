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
import { youngInterval, dalyThreeTerm, dalyExact, saxenaOptimalPeriod, goodputFirstOrder, dalyGoodput, scaleTable, headlineGoodput, renewalGoodputMixed, type GoodputFirstOrder, type ScaleRow, type MixedRenewalResult } from '../checkpoint/index.js';
import { hotSparesBinomial, hotSparesPoisson, repairPipelineSpares, replacementsOverJob } from '../sparing/index.js';
import { binomCdf } from '../math/special.js';
import { lostDollarsPerDay, wastedGpuHoursPerDay } from '../cost/index.js';
import { chainOutcome, emptyMixedRates, addOutcome, addPlainEvents, type ChainParams, type MixedRates } from '../mechanisms/chain.js';
import { sdcDelivery, pClearedBeforePersist, type SdcDeliveryResult } from '../sdc/index.js';
import { computeCounts, buildStructure, interruptionRatePerHour, sdcRatePerHour, replicaComposition, classSdcCoverage, workingNodeCount, type Counts, type ComponentInstances, type ScopeLevel } from './build.js';
import { designReviewChecklist, type ChecklistItem } from './checklist.js';
import type { Scenario, RecoveryStages } from './schema.js';

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
  recoveryKind: 'pipeline' | 'ladder' | 'mixture';
  /** v2 goodput models (docs/TRAINING_AVAILABILITY_FORMULAS_AND_COMPARISON.md): */
  operationalAvailability: number;
  renewalGoodput: number;
  productGoodput: number;
  /** E[min(X, τ) | X < τ+δ]: the rollback implied by the exact renewal model, seconds */
  impliedRecomputeS: number;
  /** headline goodput before blocked spares and sub-health: first order while valid, else exact renewal */
  headlineGoodput: number;
  headlineModel: 'first-order' | 'exact-renewal';
  recomputeSource: 'tau/2' | 'measured' | 'step';
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
  /* ---- v3: mechanism chain, pause-only events, silent corruption ---- */
  /** detection delay charged before any mechanism, and the global recovery that follows (seconds) */
  detectS: number;
  globalRecoveryS: number;
  /** all events that stop the job (rollback + pause-only), per hour */
  eventRatePerHour: number;
  rollbackRatePerHour: number;
  pauseOnlyRatePerHour: number;
  /** probability that an event rolls the job back to the last checkpoint */
  pRollback: number;
  /** rate-weighted pause per event R̄ and per class of event (seconds) */
  meanPauseS: number;
  rollbackPauseS: number;
  pauseOnlyS: number;
  /** compute lost in degraded DP domains (elastic recovery), fraction of job time */
  localLossFraction: number;
  /** v3.2 fault-free throughput overhead of the enabled mechanisms (Σ scenario.mechanisms.overheads) */
  overheadFraction: number;
  /** v3.2 planned migrations that were false alarms of the predictor, per hour */
  falseAlarmRatePerHour: number;
  /** running-time share A_run = 1/(1 + λ_rb R_rb + λ_p R_p) (operational availability before SDC episode pauses) */
  runningFraction: number;
  mixedRenewal: MixedRenewalResult;
  chain: { active: boolean; params: ChainParams; rows: ChainRow[]; detectS: number; globalS: number };
  sdc?: SdcKpis;
  /** correct (delivered, 正确有效) goodput over the job window; equals the effective goodput without silent corruption */
  deliveredGoodput: number;
  /** closed-form window ledger (fractions of the job duration) */
  ledger: TrainingLedger;
}

export interface ChainRow {
  id: string;
  name: string;
  ratePerHour: number;
  share: number;
  applicable: { replay: number; process: number; elastic: number; predict: number; netfail: number; hotswap: number };
  pPredict: number;
  pNetfail: number;
  pReplay: number;
  pHotswap: number;
  pElastic: number;
  pProcess: number;
  pGlobal: number;
  pRollback: number;
  /** v3.7 probability of each custom rung (by id) */
  pCustom: Record<string, number>;
  meanPauseS: number;
  localLossS: number;
  /**
   * v5.5 the class's own global recovery g_i (§24.2: the job's global recovery minus the stage time its per-class recovery
   * stages save, scaled like the attempt) and the automatic attempt inside it, seconds; the job's values for a class without
   * own stages. The MTTR split (formula 5) runs each class's chain on these, not on the job's.
   */
  globalS: number;
  autoS: number;
  /** v5.5 the class's automatic stages at this scale (startup / read / communication, seconds; Σ = autoS); absent outside the MTTR mixture */
  stages?: { startup: number; read: number; communication: number };
}

export interface SdcKpis {
  ratePerHour: number;
  coverage: number;
  detectedRatePerHour: number;
  undetectedRatePerHour: number;
  pClearedBeforePersist: number;
  /** undetected, persisted corruption episodes per wall-clock hour while clean */
  episodeRatePerWallHour: number;
  fallbackDelayH: number;
  episodePauseS: number;
  stepRecovery: boolean;
  /** v3.5 terminal rule of the window (retain the last clean checkpoint, or discard the whole window when it ends unresolved) */
  terminalRule: 'retain-last-clean' | 'discard-all';
  delivery: SdcDeliveryResult;
}

export interface TrainingLedger {
  downtime: number;
  save: number;
  rollback: number;
  slowdown: number;
  local: number;
  blocked: number;
  /** v3.2 fault-free overhead of mechanisms (redundant computation, integrity checks) */
  overhead: number;
  sdcRollback: number;
  terminal: number;
  delivered: number;
}

export interface InferenceKpis {
  replicasRequired: number;
  spareReplicas: number;
  /** physical scope of one replica (node, rack, supernode, zone) */
  replicaScope: ScopeLevel;
  /** GPUs / NPUs in the whole pool: (N + k) × GPUs per replica */
  clusterGpus: number;
  /** supernodes per replica and in total (0 without a supernode preset) */
  supernodesPerReplica: number;
  supernodesTotal: number;
  /** classes folded into the replica unit */
  replicaMembers: string[];
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

export interface ScenarioEvaluateOptions {
  /**
   * false: skip the block-structure evaluation (RBD, compensation waterfall, importance measures, cut sets) and return
   * only the workload-level results (`training`, `inference`, `spares`, `components`, checklist, formulas). The mechanism
   * attribution, the planner and the ledger simulation read `training` only; on the 54-event catalog this is several
   * times faster than the full evaluation. The numbers that are returned are identical to the full evaluation.
   */
  structure?: boolean;
}

/** `evaluateScenario(s, { structure: false })`: everything except the block-structure results. */
export type WorkloadEvaluation = Omit<EvaluationResult, 'structure' | 'system' | 'importance' | 'cutSets'>;

export const SCALE_SIZES = [1024, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 1000000];

export function resolvePipeline(s: Scenario): Pipeline {
  if (s.recovery.mode === 'preset') {
    const p = PIPELINE_PRESETS[s.recovery.preset];
    if (!p) throw new Error(`unknown recovery preset '${s.recovery.preset}'`);
    return p;
  }
  if (s.recovery.mode === 'ladder' || s.recovery.mode === 'mixture') throw new Error('recovery is a ladder / mixture: use resolveRecovery()');
  return { id: 'custom', name: 'Custom pipeline', stages: s.recovery.stages.map((st) => ({ ...st })) as Pipeline['stages'] };
}

/** Recovery model shared by the pipeline (v1) and the ladder (v2): R(N), stage/rung breakdown, sampler. */
export interface RecoveryModel {
  kind: 'pipeline' | 'ladder' | 'mixture';
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

/** The MTTR mixture expressed as a three-rung ladder: detection (never resolves), automatic attempt, manual. */
export function mixtureLadder(r: Extract<Scenario['recovery'], { mode: 'mixture' }>): Ladder {
  const tDet = r.detection.coverage * r.detection.autoSeconds + (1 - r.detection.coverage) * r.detection.timeoutSeconds;
  return {
    id: 'mixture',
    name: { zh: 'MTTR 混合（检测 + 自动 + 人工）', en: 'MTTR mixture (detection + automatic + manual)' },
    rungs: [
      { id: 'detection', kind: 'auto', successProbability: 0, timeS: tDet, note: `coverage ${r.detection.coverage}: ${r.detection.autoSeconds} s automatic, else ${r.detection.timeoutSeconds} s timeout` },
      { id: 'automatic', kind: 'auto', successProbability: r.automatic.successProbability, timeS: r.automatic.seconds, scale: r.automatic.scale, note: `automatic attempt, success ${r.automatic.successProbability}; a failed attempt still costs its time` },
      { id: 'manual', kind: 'manual', successProbability: 1, timeS: r.manual.seconds, note: 'manual recovery after a failed automatic attempt' },
    ],
  };
}

/**
 * v3.7 the automatic attempt's stage budget: explicit stages when given, else an engineering split of the attempt
 * (startup 1/3 with the graph preparation as half of it, checkpoint-state read 1/3, communication rebuild 1/3 — the mechanism
 * audit's 60 / 60 / 60 s of 180 s). Serial, so the sum is the attempt; per-class overrides replace single stages.
 */
export function automaticStages(r: Extract<Scenario['recovery'], { mode: 'mixture' }>): RecoveryStages & { graphWithinStartup: number } {
  const st = r.automatic.stages;
  if (st) {
    // explicit stages are shares of the attempt: when their sum differs from automatic.seconds they are rescaled to it, so the
    // attempt (the number every recovery model uses) always wins and a per-class stage saving is never scaled by the mismatch
    const sum = st.startup + st.read + st.communication;
    const k = sum > 0 ? r.automatic.seconds / sum : 1;
    return { startup: st.startup * k, graphWithinStartup: (st.graphWithinStartup ?? st.startup / 2) * k, read: st.read * k, communication: st.communication * k };
  }
  const third = r.automatic.seconds / 3;
  return { startup: third, graphWithinStartup: third / 2, read: third, communication: third };
}

export function resolveLadder(s: Scenario): Ladder | undefined {
  if (s.recovery.mode === 'mixture') return mixtureLadder(s.recovery);
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
      kind: s.recovery.mode === 'mixture' ? 'mixture' : 'ladder',
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

function componentRows(items: ComponentInstances[], totalRate: number, subhealthOf: (ci: ComponentInstances) => ReturnType<typeof subhealthUnit> | undefined): ComponentRow[] {
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
      subhealthProbability: subhealthOf(ci)?.pSubhealthGivenNotDown,
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
    .reduce((a, ci) => a + (counts.nodes > 0 ? (ci.lambda * ci.total) / counts.nodes : 0), 0);
}

export function evaluateScenario(s: Scenario): EvaluationResult;
export function evaluateScenario(s: Scenario, opts: { structure: false }): WorkloadEvaluation;
export function evaluateScenario(s: Scenario, opts: ScenarioEvaluateOptions): EvaluationResult | WorkloadEvaluation;
export function evaluateScenario(s: Scenario, opts: ScenarioEvaluateOptions = {}): EvaluationResult | WorkloadEvaluation {
  const withStructure = opts.structure !== false;
  const warnings: string[] = [];
  const formulas: Record<string, string> = {};
  const counts = computeCounts(s);
  const built = buildStructure(s, counts);
  const root = built.root;
  const result = withStructure ? evalRbd(root) : undefined;
  const items = built.items;
  const hardwareRate = interruptionRatePerHour(items);
  // the unit-level sub-health chain is solved once per class (component rows, straggler law and isolation rate share it)
  const subhealthCache = new Map<ComponentInstances, ReturnType<typeof subhealthUnit>>();
  const subhealthOf = (ci: ComponentInstances) => {
    if (!ci.subhealth) return undefined;
    let r = subhealthCache.get(ci);
    if (!r) {
      r = subhealthUnit(ci.lambda, ci.repair, ci.subhealth);
      subhealthCache.set(ci, r);
    }
    return r;
  };
  const components = componentRows(items, hardwareRate, subhealthOf);

  // v2: sub-health at unit level (straggler law, isolation interruptions) and repair-path accounting
  let pNotSlowed = 1;
  let isolationRate = 0;
  let minPerformance = 1;
  let anySubhealth = false;
  for (const ci of items) {
    if (!ci.subhealth) continue;
    anySubhealth = true;
    const r = subhealthOf(ci)!;
    pNotSlowed *= Math.pow(1 - r.pSubhealthGivenNotDown, ci.total);
    isolationRate += r.isolationFrequency * ci.total;
    minPerformance = Math.min(minPerformance, ci.subhealth.performance);
  }
  const pSlowed = 1 - pNotSlowed;
  const performanceFactor = 1 - pSlowed * (1 - minPerformance);
  const totalRate = hardwareRate + isolationRate;
  const lambdaWeighted = items.reduce((a, ci) => a + ci.lambda * ci.total, 0);
  const humanFraction = lambdaWeighted > 0 ? items.reduce((a, ci) => a + ci.lambda * ci.total * repairHumanFraction(ci.repair), 0) / lambdaWeighted : 1;

  const comp = withStructure ? compensationWaterfall(root) : undefined;
  const system: SystemKpis | undefined = result && comp ? {
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
  } : undefined;
  formulas.availability = 'A_sys = Π A_i (series); k-of-n: Σ_{j≤n−k} C(n,j) u^j (1−u)^{n−j}, u = λ·MTTR/(1+λ·MTTR); parallel: 1 − Π(1−A_i)';
  formulas.mtbf = 'MTBF = A_sys / ν_sys, ν_sys = steady-state system failure frequency; equivalent MTTR = (1 − A_sys)/ν_sys';
  formulas.measures = 'original (原始): every unit fault is an outage repaired manually, λ_o = λ + λ_sh, E[R_o] = (λT_m + λ_sh D)/(λ + λ_sh), redundancy removed; compensated (补偿后): redundancy, switchover, automatic recovery and the sub-health policy as configured; waterfall enables them in that order';
  formulas.repair = 'E[R] = c·T_a + (1 − c·s)·T_m (c = automatic coverage, s = automatic success); A = 1/(1 + λ·E[R]); automatic share of downtime = c·T_a/E[R]; human fraction = 1 − c·s';
  formulas.switchover = 'k-of-n: exact chain over (in automatic repair, in manual repair, switch-failed); micro-outage U_sw = Σ π·w·λ·p_sw·t_sw/3600; a failed switchover (1 − p_sw) is cleared in T_sf';
  formulas.subhealth = 'A_strict = π_U; A_tolerant = π_U + π_H; performability = π_U + φ·π_H; sub-health counts as down when φ < threshold; job: P(slowed) = 1 − Π_i (1 − p_H,i)^{n_i}, φ_job = 1 − P(slowed)·(1 − φ_min); isolate: ν_iso = π_H·p_d/T_d adds interruptions';

  const recoveryModel = resolveRecovery(s);
  const assumptions = [...s.assumptions, ...built.notes, 'failures of different components are independent (common cause only through declared β factors)', 'closed forms assume exponential lifetimes and repairs; non-exponential inputs need the Monte Carlo module'];
  if (anySubhealth) assumptions.push('job-level sub-health uses the straggler law with the lowest performance factor among sub-healthy classes (conservative)');
  if (system?.approximate) warnings.push('a first-order switchover correction or a reduced repair model was used in at least one block (see block notes)');

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
    const lambdaJob = totalRate; // hardware failures and detected isolations interrupt a synchronous job
    const mtbiHours = lambdaJob > 0 ? 1 / lambdaJob : Infinity;
    const mtbiS = mtbiHours * 3600;
    const recovery = recoveryModel.compose(N);
    const recoveryS = recoveryModel.meanS(N);
    // v3: split the recovery at scale n into the detection delay (charged before any mechanism) and the global recovery that
    // follows; evaluated per scale-table row so that the recovery scale laws reach every N
    const tDetMixture = s.recovery.mode === 'mixture' ? s.recovery.detection.coverage * s.recovery.detection.autoSeconds + (1 - s.recovery.detection.coverage) * s.recovery.detection.timeoutSeconds : undefined;
    type RecoveryAt = { recoveryS: number; detectS: number; globalS: number; autoS?: number };
    const recoveryAt = (n: number): RecoveryAt => {
      const R = n === N ? recoveryS : recoveryModel.meanS(n);
      const composed = n === N ? recovery : recoveryModel.compose(n);
      let d = 0;
      if (tDetMixture !== undefined) d = tDetMixture;
      else if (recoveryModel.kind === 'pipeline') d = composed.stages.find((st) => st.name === 'detect')?.meanS ?? 0;
      const autoS = tDetMixture !== undefined ? composed.stages.find((st) => st.name === 'automatic')?.meanS : undefined;
      return { recoveryS: R, detectS: d, globalS: Math.max(0, R - d), autoS };
    };
    const rrN = recoveryAt(N);
    const { detectS, globalS } = rrN;
    // v3.7 per-class automatic recovery: the mechanism audit's stage budget (startup / checkpoint read / communication rebuild)
    // with per-class overrides; the class's global recovery is the job's minus the saved stage time (scaled like the attempt)
    const stagesDefault = s.recovery.mode === 'mixture' ? automaticStages(s.recovery) : undefined;
    const autoDefaultS = stagesDefault ? stagesDefault.startup + stagesDefault.read + stagesDefault.communication : 0;
    const classAutoS = (ci: ComponentInstances): number => (stagesDefault ? (ci.recoveryStages?.startup ?? stagesDefault.startup) + (ci.recoveryStages?.read ?? stagesDefault.read) + (ci.recoveryStages?.communication ?? stagesDefault.communication) : autoDefaultS);
    const gOf = (ci: ComponentInstances, rr: RecoveryAt): number => (rr.autoS !== undefined && autoDefaultS > 0 && ci.recoveryStages ? Math.max(0, rr.globalS - (autoDefaultS - classAutoS(ci)) * (rr.autoS / autoDefaultS)) : rr.globalS);

    // v3: mechanism chain per class → rollback vs pause-only event classes; `f` scales every event class with N (scale table)
    const chainParams: ChainParams = { custom: s.mechanisms.custom, predict: s.mechanisms.predict, netfail: s.mechanisms.netfail, replay: s.mechanisms.replay, hotswap: s.mechanisms.hotswap, elastic: s.mechanisms.elastic, process: s.mechanisms.process };
    const chainActive = !!(s.mechanisms.replay || s.mechanisms.elastic || s.mechanisms.process || s.mechanisms.predict || s.mechanisms.netfail || s.mechanisms.hotswap || Object.keys(s.mechanisms.custom ?? {}).length);
    const overheadFraction = Math.min(0.99, Object.values(s.mechanisms.overheads ?? {}).reduce((a, b) => a + b, 0));
    const sdcTotal = sdcRatePerHour(items);
    // v3.7 per-class coverage (absolute override compounded with the class's conditional detectors) is rate-weighted into the
    // job-level immediate detection coverage (Poisson thinning is additive)
    const sdcCoverage = sdcTotal > 0 ? items.reduce((a, ci) => a + ci.total * ci.sdcLambda * classSdcCoverage(ci, s.sdc.detection.coverage), 0) / sdcTotal : s.sdc.detection.coverage;
    const sdcDetectedRate = sdcTotal * sdcCoverage;
    // false alarms of the predictor: planned migrations that were not needed (pause-only), r(1 − p)/p per predicted-applicable interruption
    const falseAlarmRate = s.mechanisms.predict
      ? items.reduce((a, ci) => a + ci.lambda * ci.total * ci.applicable.predict * s.mechanisms.predict!.recall * (1 - s.mechanisms.predict!.precision) / Math.max(s.mechanisms.predict!.precision, 0.01), 0)
      : 0;
    const mixedRatesAt = (f: number, rr: RecoveryAt): MixedRates => {
      const d = rr.detectS;
      const g = rr.globalS;
      let m = emptyMixedRates();
      for (const ci of items) {
        const rate = ci.lambda * ci.total * f;
        if (rate <= 0) continue;
        m = addOutcome(m, rate, chainOutcome(d, gOf(ci, rr), chainParams, ci.applicable, s.mechanisms.order));
      }
      if (falseAlarmRate > 0 && s.mechanisms.predict) m = addPlainEvents(m, falseAlarmRate * f, s.mechanisms.predict.migrationSeconds, false);
      // a detected sub-healthy unit is switched out after saving the current progress: a pause without rollback
      if (isolationRate > 0) m = addPlainEvents(m, isolationRate * f, g, false);
      // immediately detected silent corruption: rollback to the last checkpoint, or redo one step with step recovery
      if (sdcDetectedRate > 0) {
        if (s.sdc.stepRecovery) m = addPlainEvents(m, sdcDetectedRate * f, s.sdc.detection.detectSeconds + s.sdc.stepRecovery.recoverSeconds + s.sdc.stepRecovery.stepSeconds, false);
        else m = addPlainEvents(m, sdcDetectedRate * f, s.sdc.detection.detectSeconds + g, true);
      }
      return m;
    };
    const mixed = mixedRatesAt(1, rrN);
    const chainRows: ChainRow[] = [];
    for (const ci of items) {
      const rate = ci.lambda * ci.total;
      if (rate <= 0) continue;
      const g = gOf(ci, rrN);
      const o = chainOutcome(detectS, g, chainParams, ci.applicable, s.mechanisms.order);
      // the class's automatic attempt and stages at N (the stage saving scaled like the attempt, as in gOf), for the MTTR split
      const fAuto = rrN.autoS !== undefined && autoDefaultS > 0 ? rrN.autoS / autoDefaultS : 1;
      const stages = stagesDefault ? { startup: (ci.recoveryStages?.startup ?? stagesDefault.startup) * fAuto, read: (ci.recoveryStages?.read ?? stagesDefault.read) * fAuto, communication: (ci.recoveryStages?.communication ?? stagesDefault.communication) * fAuto } : undefined;
      const autoS = stages ? stages.startup + stages.read + stages.communication : rrN.autoS ?? 0;
      chainRows.push({ id: ci.component.id, name: ci.component.name?.en ?? ci.component.name?.zh ?? ci.component.id, ratePerHour: rate, share: hardwareRate > 0 ? rate / hardwareRate : 0, applicable: ci.applicable, pPredict: o.pPredict, pNetfail: o.pNetfail, pReplay: o.pReplay, pHotswap: o.pHotswap, pElastic: o.pElastic, pProcess: o.pProcess, pGlobal: o.pGlobal, pRollback: o.pRollback, pCustom: o.pCustom, meanPauseS: o.meanPauseS, localLossS: o.localLossS, globalS: g, autoS, ...(stages ? { stages } : {}) });
    }
    const eventRate = mixed.rollbackRatePerHour + mixed.pauseRatePerHour;
    const mtbiEventS = eventRate > 0 ? 3600 / eventRate : Infinity;
    const mtbiRollbackS = mixed.rollbackRatePerHour > 0 ? 3600 / mixed.rollbackRatePerHour : Infinity;
    const meanPauseS = eventRate > 0 ? (mixed.rollbackRatePerHour * mixed.rollbackPauseS + mixed.pauseRatePerHour * mixed.pauseOnlyS) / eventRate : recoveryS;
    const pRollback = eventRate > 0 ? mixed.rollbackRatePerHour / eventRate : 1;
    const localLossFraction = Math.min(1, mixed.localLossSPerHour / 3600);

    // checkpoint interval: protects against rollback events only (chosen against the rollback MTBI, per scale-table row too)
    const intervalFor = (mtbiRb: number, pauseRb: number): number => {
      let tau: number;
      if (w.intervalS !== undefined) tau = w.intervalS;
      else if (w.intervalModel === 'daly3') tau = dalyThreeTerm(w.deltaS, mtbiRb);
      else if (w.intervalModel === 'dalyExact') tau = dalyExact(w.deltaS, mtbiRb);
      else if (w.intervalModel === 'saxena') tau = Math.max(1e-9, saxenaOptimalPeriod(mtbiRb, w.deltaS, pauseRb) - w.deltaS);
      else tau = youngInterval(w.deltaS, mtbiRb);
      if (!Number.isFinite(tau) || tau <= 0) tau = w.intervalS ?? 3600;
      return tau;
    };
    const tauS = intervalFor(mtbiRollbackS, mixed.rollbackPauseS);
    const recomputeSource: 'tau/2' | 'measured' | 'step' = w.measuredRecomputeS !== undefined ? 'measured' : w.recovery === 'replica' ? 'step' : 'tau/2';
    // v3.7 asynchronous checkpoint durable lag: the recovery point trails the save, so every rollback loses `lag` more seconds
    const lagS = w.rollbackLagS ?? 0;
    const recompute = (recomputeSource === 'measured' ? w.measuredRecomputeS! : recomputeSource === 'step' ? (w.stepTimeS ?? 0) : tauS / 2) + lagS;
    const recomputeEffective = pRollback * recompute;
    if (lagS > 0) assumptions.push(`asynchronous checkpoint durable lag ${lagS} s is added to the rollback of every rollback event (first-order; the exact renewal goodput is corrected by λ_rb·lag on the running clock)`);
    // first order on the event clock: 1 − δ/τ − (P_rb·W + R̄)/M_ev
    const fo = goodputFirstOrder(deltaS, tauS, mtbiEventS, meanPauseS);
    if (recomputeSource !== 'tau/2' || pRollback < 1 || lagS > 0) {
      fo.terms.recompute = Number.isFinite(mtbiEventS) ? recomputeEffective / mtbiEventS : 0;
      fo.terms.total = fo.terms.save + fo.terms.recompute + fo.terms.restart;
      fo.goodput = Math.max(0, 1 - fo.terms.total);
      if (recomputeSource !== 'tau/2') assumptions.push(recomputeSource === 'step' ? 'replica recovery: recompute per interruption = one step (JIT / FlashRecovery), save term unchanged' : `measured lost computation per failure (${recompute.toFixed(0)} s) replaces τ/2 in the first-order and product forms`);
    }
    const mixedRenewal = renewalGoodputMixed({ tauS, deltaS, rollbackRatePerS: mixed.rollbackRatePerHour / 3600, rollbackPauseS: mixed.rollbackPauseS, pauseRatePerS: mixed.pauseRatePerHour / 3600, pauseS: mixed.pauseOnlyS });
    const lagFrac = lagS > 0 ? (mixed.rollbackRatePerHour / 3600) * lagS * mixedRenewal.runningFraction : 0;
    const renewal = Math.max(0, mixedRenewal.goodput - lagFrac);
    const pauseOnlyFactor = 1 / (1 + (mixed.pauseRatePerHour / 3600) * mixed.pauseOnlyS);
    const dg = Number.isFinite(mtbiRollbackS) ? dalyGoodput(tauS, deltaS, mtbiRollbackS, mixed.rollbackPauseS) * pauseOnlyFactor : (tauS / (tauS + deltaS)) * pauseOnlyFactor;
    const implied = mixedRenewal.impliedRecomputeS;
    const aRun = mixedRenewal.runningFraction;
    const product = Number.isFinite(mtbiEventS) ? Math.max(0, aRun * (tauS / (tauS + deltaS)) * (1 - recomputeEffective / mtbiEventS)) : tauS / (tauS + deltaS);
    const head = headlineGoodput(fo, renewal);
    if (head.model === 'exact-renewal') warnings.push(`first-order goodput flags ${fo.validity}: the headline uses the exact renewal model (${(renewal * 100).toFixed(2)} % vs first-order ${(fo.goodput * 100).toFixed(2)} %)`);
    // P_blocked = unavailability of the hot-spare node pool; without the full structure evaluation only that block is solved
    const poolBlock = result ? undefined : listBlocks(root).find((b) => b.id === 'node-pool');
    const pool = result ? findBlock(result, 'node-pool') : poolBlock ? evalRbd(poolBlock) : undefined;
    const blocked = pool ? pool.unavailability : 0;
    const effective = head.goodput * (1 - blocked) * performanceFactor * (1 - localLossFraction) * (1 - overheadFraction);
    smallParameter = fo.smallParameter;
    restartRatio = fo.restartRatio;
    warnings.push(...fo.warnings);

    // v3: undetected silent corruption over the job window
    const horizonH = w.durationDays * 24;
    const periodH = (tauS + deltaS) / 3600;
    const preEpisodeLossH = ((tauS * tauS) / 2 + tauS * deltaS) / (tauS + deltaS) / 3600;
    let sdc: SdcKpis | undefined;
    let delivered = effective;
    let aOp = aRun;
    if (sdcTotal > 0) {
      const undetected = sdcTotal * (1 - sdcCoverage);
      const pClear = pClearedBeforePersist(mixed.rollbackRatePerHour, periodH);
      const nu = undetected * aRun * (1 - pClear);
      const d = sdcDelivery({ horizonH, nuPerWallHour: nu, fallbackDelayH: s.sdc.fallbackDelayHours, episodePauseH: globalS / 3600, cleanGoodput: effective, preEpisodeLossH, terminalRule: s.sdc.terminalRule });
      delivered = d.delivered;
      aOp = aRun * (1 - d.pauseFraction);
      sdc = { ratePerHour: sdcTotal, coverage: sdcCoverage, detectedRatePerHour: sdcDetectedRate, undetectedRatePerHour: undetected, pClearedBeforePersist: pClear, episodeRatePerWallHour: nu, fallbackDelayH: s.sdc.fallbackDelayHours, episodePauseS: globalS, stepRecovery: !!s.sdc.stepRecovery, terminalRule: s.sdc.terminalRule, delivery: d };
      if (s.sdc.terminalRule === 'discard-all') assumptions.push('terminal rule discard-all (reference V4 / ReMAP legacy delivery): a window that ends inside a corruption episode delivers nothing; the retain-last-clean value is reported alongside and the two are different metrics');
      if (sdcCoverage <= 0) warnings.push(`silent corruption is not detected immediately: ${(d.expectedEpisodes).toFixed(2)} expected episodes in ${horizonH} h, each discovered after ${s.sdc.fallbackDelayHours} h; delivered goodput ${(delivered * 100).toFixed(2)} % vs performance goodput ${(effective * 100).toFixed(2)} %`);
      assumptions.push('silent corruption: Poisson on the running clock; the first undetected event opens an episode (later ones change nothing); clean durations exponential on the wall clock, discovery after a fixed delay; the job keeps the rate-weighted recovery for the episode pause; a rollback before the first dirty checkpoint clears the corruption');
    }
    // closed-form ledger over the window (fractions of T), decomposed with the headline model so that it closes on the delivered goodput
    const pauseFrac = sdc ? sdc.delivery.pauseFraction : 0;
    const nonPause = 1 - pauseFrac;
    const dec = head.model === 'first-order'
      ? { running: 1 - fo.terms.restart, save: fo.terms.save, rollback: fo.terms.recompute, goodput: fo.goodput }
      : { running: mixedRenewal.runningFraction, save: mixedRenewal.saveFraction, rollback: mixedRenewal.rollbackFraction + lagFrac, goodput: renewal };
    const computeFrac = nonPause * dec.goodput;
    const ledger: TrainingLedger = {
      downtime: nonPause * (1 - dec.running) + pauseFrac,
      save: nonPause * dec.save,
      rollback: nonPause * dec.rollback,
      slowdown: computeFrac * (1 - performanceFactor),
      local: computeFrac * performanceFactor * localLossFraction,
      blocked: computeFrac * performanceFactor * (1 - localLossFraction) * blocked,
      overhead: computeFrac * performanceFactor * (1 - localLossFraction) * (1 - blocked) * overheadFraction,
      sdcRollback: sdc ? sdc.delivery.rollbackFraction : 0,
      terminal: sdc ? sdc.delivery.terminalDiscardFraction : 0,
      delivered,
    };

    const lambdaPerGpu = lambdaJob / N;
    const scale = scaleTable(lambdaPerGpu, deltaS, (n) => recoveryModel.meanS(n), SCALE_SIZES, w.intervalModel === 'daly3' ? 'daly3' : w.intervalModel === 'dalyExact' ? 'dalyExact' : 'young');
    for (const row of scale) {
      // every event class scales with N; the recovery R(N) (detection and global recovery from the scale laws), the chain,
      // the pause-only events, the checkpoint interval, the straggler law and the silent-corruption window are re-evaluated
      // per row exactly as for the configured size; only the spare-pool blocking stays as configured
      const f = row.nGpus / N;
      const rr = recoveryAt(row.nGpus);
      const mx = mixedRatesAt(f, rr);
      const evRow = mx.rollbackRatePerHour + mx.pauseRatePerHour;
      const mEv = evRow > 0 ? 3600 / evRow : Infinity;
      const mRb = mx.rollbackRatePerHour > 0 ? 3600 / mx.rollbackRatePerHour : Infinity;
      const pauseRow = evRow > 0 ? (mx.rollbackRatePerHour * mx.rollbackPauseS + mx.pauseRatePerHour * mx.pauseOnlyS) / evRow : rr.recoveryS;
      const pRbRow = evRow > 0 ? mx.rollbackRatePerHour / evRow : 1;
      const tauRow = intervalFor(mRb, mx.rollbackPauseS);
      const foRow = goodputFirstOrder(deltaS, tauRow, mEv, pauseRow);
      if (recomputeSource !== 'tau/2' || pRbRow < 1 || lagS > 0) {
        foRow.terms.recompute = Number.isFinite(mEv) ? (pRbRow * (recomputeSource === 'tau/2' ? tauRow / 2 + lagS : recompute)) / mEv : 0;
        foRow.terms.total = foRow.terms.save + foRow.terms.recompute + foRow.terms.restart;
        foRow.goodput = Math.max(0, 1 - foRow.terms.total);
      }
      const mrRow = renewalGoodputMixed({ tauS: tauRow, deltaS, rollbackRatePerS: mx.rollbackRatePerHour / 3600, rollbackPauseS: mx.rollbackPauseS, pauseRatePerS: mx.pauseRatePerHour / 3600, pauseS: mx.pauseOnlyS });
      const lagRow = lagS > 0 ? (mx.rollbackRatePerHour / 3600) * lagS * mrRow.runningFraction : 0;
      const h = headlineGoodput(foRow, Math.max(0, mrRow.goodput - lagRow));
      row.tauS = tauRow;
      row.goodput = foRow;
      row.renewalGoodput = Math.max(0, mrRow.goodput - lagRow);
      row.headline = h.goodput;
      row.headlineModel = h.model;
      const perfRow = 1 - (1 - Math.pow(pNotSlowed, f)) * (1 - minPerformance);
      const localRow = Math.min(1, mx.localLossSPerHour / 3600);
      const eff = row.headline * (1 - blocked) * perfRow * (1 - localRow) * (1 - overheadFraction);
      row.effective = eff;
      if (sdcTotal > 0) {
        const nuRow = sdcTotal * f * (1 - sdcCoverage) * mrRow.runningFraction * (1 - pClearedBeforePersist(mx.rollbackRatePerHour, (tauRow + deltaS) / 3600));
        row.delivered = sdcDelivery({ horizonH, nuPerWallHour: nuRow, fallbackDelayH: s.sdc.fallbackDelayHours, episodePauseH: rr.globalS / 3600, cleanGoodput: eff, preEpisodeLossH: ((tauRow * tauRow) / 2 + tauRow * deltaS) / (tauRow + deltaS) / 3600, terminalRule: s.sdc.terminalRule }).delivered;
      } else row.delivered = eff;
    }
    const nGpuEff = N;
    training = {
      nGpus: N,
      interruptionRatePerHour: lambdaJob,
      mtbiHours,
      mtbiS,
      recoveryS,
      recovery,
      recoveryKind: recoveryModel.kind,
      operationalAvailability: aOp,
      renewalGoodput: renewal,
      productGoodput: product,
      impliedRecomputeS: implied,
      headlineGoodput: head.goodput,
      headlineModel: head.model,
      recomputeSource,
      recoveryId: recoveryModel.id,
      ladder: recoveryModel.ladderResult?.(N),
      subhealth: anySubhealth ? { pSlowed, performanceFactor, minPerformance, isolationInterruptionsPerHour: isolationRate, hardwareInterruptionsPerHour: hardwareRate } : undefined,
      intervalModel: w.intervalS !== undefined ? 'fixed' : w.intervalModel,
      tauS,
      recomputePerInterruptionS: recompute,
      lossPerInterruptionS: recomputeEffective + meanPauseS,
      firstOrder: fo,
      dalyGoodput: dg,
      blockedProbability: blocked,
      effectiveGoodput: effective,
      interruptionsPerDay: 24 * lambdaJob,
      expectedInterruptions: w.durationDays * 24 * lambdaJob,
      pNoInterruption24h: Math.exp(-24 * lambdaJob),
      wallClockDays: effective > 0 ? w.durationDays / effective : Infinity,
      wastedGpuHoursPerDay: wastedGpuHoursPerDay(nGpuEff, delivered),
      lostDollarsPerDay: lostDollarsPerDay({ nGpus: nGpuEff, pricePerGpuHour: s.costs.pricePerGpuHour }, delivered),
      scale,
      // v3
      detectS,
      globalRecoveryS: globalS,
      eventRatePerHour: eventRate,
      rollbackRatePerHour: mixed.rollbackRatePerHour,
      pauseOnlyRatePerHour: mixed.pauseRatePerHour,
      pRollback,
      meanPauseS,
      rollbackPauseS: mixed.rollbackPauseS,
      pauseOnlyS: mixed.pauseOnlyS,
      localLossFraction,
      overheadFraction,
      falseAlarmRatePerHour: falseAlarmRate,
      runningFraction: aRun,
      mixedRenewal,
      chain: { active: chainActive, params: chainParams, rows: chainRows, detectS, globalS },
      sdc,
      deliveredGoodput: delivered,
      ledger,
    };
    formulas.mtbi = 'λ_job = Σ n_i λ_i (all components, synchronous job); MTBI = 1/λ_job';
    formulas.interval = w.intervalModel === 'young' ? 'τ = √(2δM_rb) (Young / Daly-Young; M_rb = MTBI of rollback events)' : w.intervalModel === 'daly3' ? 'τ = √(2δM)[1 + (1/3)(δ/2M)^{1/2} + (1/9)(δ/2M)] − δ (Daly three-term)' : w.intervalModel === 'dalyExact' ? '(1 − τ/M)e^{(τ+δ)/M} = 1 (Daly exact)' : 'T_c* = T_s + √(2(T_f+T_r)T_s + T_s²) (Saxena, availability objective)';
    formulas.goodput = 'first order: 1 − δ/τ − (P_rb·W + R̄)/M_ev with W = τ/2 (or one step / measured), R̄ = rate-weighted pause per event; exact renewal (mixed): λ_rb τ/[(e^{λ_rb(τ+δ)} − 1)(1 + λ_rb R_rb + λ_p R_p)] (pause-only events do not restart the interval); Daly full: τ/(M e^{R/M}(e^{(τ+δ)/M} − 1)) × 1/(1 + λ_p R_p); product: A_run·τ/(τ+δ)·(1 − P_rb W/M_ev), A_run = 1/(1 + λ_rb R_rb + λ_p R_p); headline = first order while (τ+δ)/M and R/M are small, else exact renewal';
    formulas.mttr = recoveryModel.kind === 'mixture' ? 'R = T_det + T_auto + (1 − p_s)·T_manual, T_det = p_d·t_auto + (1 − p_d)·t_timeout (detection by automation or timeout; a failed automatic attempt is charged before manual recovery)' : recoveryModel.kind === 'ladder' ? 'R = Σ_i P_i·t_i, P_i = Π_{j<i}(1 − s_j)' : 'R = Σ stages with scale laws';
    formulas.recovery = recoveryModel.kind === 'ladder' ? 'R(N) = E[T] = Σ_i P_i·t_i(N), P_i = Π_{j<i}(1 − s_j) (recovery ladder; last rung manual); recompute = τ/2 (periodic checkpoint) or one step (replica)' : 'R(N) = Σ stages ①–⑤ with scale laws; recompute = τ/2 (periodic checkpoint) or one step (replica)';
    if (anySubhealth) formulas.goodputSubhealth = 'effective goodput = goodput × (1 − P_blocked) × φ_job × (1 − ℓ_local) × (1 − o_mech); a detected sub-healthy unit is isolated after saving progress: ν_iso pause-only events (R_global, no rollback)';
    formulas.chain = 'per class (detection-delayed rungs in the configured order, default replay → hotswap → elastic → process): predict (recall r: planned migration t_mig, no detection delay, no rollback; false alarms r(1 − p)/p per interruption) → netfail (a_nf, s_nf: pause f + t_nf inside the collective, no rollback) → replay (a_rp, s_rp: pause d + f + t_rp, no rollback) → hotswap (a_hs, s_hs: pause d + f + t_hs, no rollback) → elastic (a_el, s_el: pause f + t_sync, domain out (d + t_el)/n_dom, no rollback) → process (a_pr, s_pr: pause d + f + t_pr, rollback) → global (pause d + f + R_global, rollback); a_x = applicable fraction, f = failure times of the rungs tried before; λ_rb = Σ λ_i P_rb,i, λ_p = Σ λ_i (1 − P_rb,i)';
    formulas.sdc = 'ν = λ_sdc (1 − q) · A_run · (1 − P_clear), P_clear = 1 − (1 − e^{−λ_rb L})/(λ_rb L); clean ~ Exp(ν), dirty + pause = D + R_c; delivered = [g·E(clean time) − U·E(episodes)]/T with E(clean) = T − Σ_k ∫ P(S_k ≤ T − x)dx, S_k = Γ(k, ν) + (k − 1)(D + R_c); detected corruption (q): rollback + pause t_d + R_global, or with step recovery a pause t_d + t_rec + t_step without rollback; terminal rule retain-last-clean: the undiscovered tail is discarded; discard-all: delivered = Σ_n Poisson(n; ν(T − nc))·[g(T − nc) − U n]/T (the window delivers nothing unless it ends clean)';
    formulas.ledger = 'window shares: downtime + save + rollback + slowdown + local + blocked + overhead + SDC rollback + terminal discard + delivered = 1; overhead = fault-free throughput cost of the enabled mechanisms';
    formulas.scale = 'MTBI(N) = 1/(N·λ_GPU-equivalent), λ_GPU-equivalent = λ_job/N at the configured size (fixed components scaled proportionally); per row: R(N) from the recovery scale laws, the chain and pause-only events, the checkpoint interval against the rollback MTBI, the straggler law 1 − (1 − p_H)^N and the silent-corruption window; the spare pool stays as configured';
    formulas.cost = 'wasted GPU·h/day = N × 24 × (1 − delivered goodput); $/day = wasted GPU·h × price';

    // spares at node granularity
    const lamNode = nodeLambda(items, counts);
    const pDaily = 1 - Math.exp(-lamNode * 24);
    const workingNodes = workingNodeCount(s, counts);
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
    const comp = replicaComposition(s, counts, items, total, w.gpusPerReplica, w.replicaRecoveryHours);
    const lamRep = comp.lambdaPerReplica;
    const mttrRep = comp.mttrH;
    const sp = s.topology.superpod;
    const supernodeSize = sp ? sp.npusPerNode * sp.nodesPerRack * sp.computeRacks : 0;
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
      replicaScope: comp.scope,
      clusterGpus: total * w.gpusPerReplica,
      supernodesPerReplica: supernodeSize > 0 ? w.gpusPerReplica / supernodeSize : 0,
      supernodesTotal: supernodeSize > 0 ? Math.ceil((total * w.gpusPerReplica) / supernodeSize) : 0,
      replicaMembers: comp.members.map((m) => m.ci.component.id),
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
    formulas.inference = 'u_r = λ_r·MTTR_r/(1 + λ_r·MTTR_r) with λ_r = Σ (classes at or below the replica scope) and MTTR_r = Σλ_iT_i/Σλ_i; A_any = 1 − u_r^{n+k}; A_cap = Σ_{j≤k} C(n+k, j) u_r^j (1−u_r)^{n+k−j}';
    if (w.spareReplicas < kReq) warnings.push(`configured spare replicas (${w.spareReplicas}) below the ${kReq} needed for the ${(w.capacityTarget * 100).toFixed(3)} % capacity target`);
  }

  const imp = withStructure ? importance(root) : undefined;
  const cs = withStructure ? cutSets(root, 2000) : undefined;
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
  if (withStructure && listBlocks(root).length > 400) warnings.push('large structure: importance measures evaluated for every block may be slow');

  const workload: WorkloadEvaluation = { scenarioName: s.meta.name, counts, components, training, inference, spares, checklist, assumptions, warnings, formulas };
  if (!withStructure || !result || !system || !imp || !cs) return workload;
  return { ...workload, structure: { root, result, notes: built.notes }, system, importance: imp, cutSets: cs };
}
