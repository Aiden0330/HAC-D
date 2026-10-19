/**
 * v3.7 cross-scale allocation study (docs/AVAILABILITY_ALLOCATION_98P5.zh.html generalised): for each cluster size the
 * hardware-only and recovery-only budgets (uniform factors by bisection, ARINC and minimum-effort class allocation, stage
 * budgets), the mechanism planner (exact up to 10 candidates, greedy forward selection beyond), the attribution (exact Shapley
 * up to 12 players, permutation sampling with a Student-t half-width beyond), the decomposition of the residual loss by domain
 * group, the recovery-parameter levers beyond the library, a window-ledger verification of the plan and metric-vs-N curves
 * with the largest size each mechanism set supports. Metric: A_op (default), delivered or effective goodput.
 */
import type { Scenario } from '../scenario/schema.js';
import { evaluateScenario, type TrainingLedger } from '../scenario/evaluate.js';
import { cloneScenario, scaleAllRates, scaleRecovery } from '../scenario/analysis.js';
import { computeCounts, componentInstances, classSdcCoverage } from '../scenario/build.js';
import { arinc, minimumEffort, allocateRecoveryStages, type Subsystem, type AllocationResult } from '../allocation/index.js';
import { planToTarget, DERATE_DEFAULT, derateParameters, type DerateSpec, type MechanismPlan, type PlanCoalition } from '../mechanisms/plan.js';
import { mechanismReport, applyMechanisms, stripMechanisms, mechanismById, mechanismValues, type AttributionMetric, type MechanismValues } from '../mechanisms/index.js';
import { provisionalParameters } from '../mechanisms/auditLibrary.js';
import { buildLedgerRun, simulateLedgerReplications } from '../mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict, summaryStat, type SummaryStat } from '../math/stats.js';
import { Rng } from '../math/rng.js';

export type StudyMetric = AttributionMetric;
export type StudyPhase = 'sizes' | 'curves';
export interface StudyOptions {
  sizes?: number[];
  target?: number;
  metric?: StudyMetric;
  players?: string[];
  parameters?: Record<string, Record<string, number>>;
  /** fill the audited mechanisms' null integration fields with the provisional assumptions */
  provisional?: boolean;
  trials?: number;
  seed?: number;
  derate?: DerateSpec | null;
  levers?: boolean;
  curves?: boolean;
  curveGrid?: number[];
  /** permutations of the sampled Shapley when more than 12 players are given */
  permutations?: number;
  onProgress?: (done: number, total: number, phase: StudyPhase) => void;
}

/** domain groups of the reference catalog; other scenarios group by `component.subsystem` */
export const CATALOG_GROUPS: Record<string, string[]> = {
  npu: ['CORE', 'SRAM', 'IOD', 'MODULE', 'MEMT', 'MEMP'],
  network: ['NIC', 'OPT', 'BOXIO', 'FABRIC'],
  host: ['CPU', 'DDR', 'SSD'],
  facility: ['POWER', 'COOL', 'MGMT'],
  storageSoftware: ['STORAGE', 'UNKNOWN'],
};
export const GROUP_LABELS: Record<string, { zh: string; en: string }> = {
  npu: { zh: 'NPU 芯片与内存', en: 'NPU chip and memory' }, network: { zh: '网络', en: 'Network' }, host: { zh: '主机', en: 'Host' }, facility: { zh: '机房设施', en: 'Facility' }, storageSoftware: { zh: '存储 / 软件 / 未归因', en: 'Storage / software / unknown' },
  compute: { zh: '计算', en: 'Compute' }, interconnect: { zh: '互联', en: 'Interconnect' }, storage: { zh: '存储', en: 'Storage' }, power: { zh: '供电', en: 'Power' }, cooling: { zh: '冷却', en: 'Cooling' }, software: { zh: '软件', en: 'Software' }, other: { zh: '其他', en: 'Other' },
  isolation: { zh: '亚健康隔离', en: 'Sub-health isolation' }, sdcPause: { zh: '静默错误暂停', en: 'Silent-corruption pauses' },
  falseAlarm: { zh: '预测误报迁移', en: 'Predictor false alarms' }, sdcDetected: { zh: '静默错误即时检出', en: 'Detected silent corruption' },
};
/** non-domain lines of the decomposition (pause-only events and episode pauses that belong to no hardware class) */
export const NON_DOMAIN_GROUPS = ['isolation', 'sdcPause', 'falseAlarm', 'sdcDetected'];
/** catalog domain of a component id (`CORE-hard`, v4 per-unit `FABRIC-hard@roce`) */
export const domainOf = (id: string) => id.replace(/@.*$/, '').replace(/-(hard|slow|sdc)$/, '');
export function groupOf(c: Scenario['components'][number]): string {
  const d = domainOf(c.id);
  for (const [g, ids] of Object.entries(CATALOG_GROUPS)) if (ids.includes(d)) return g;
  return c.subsystem ?? 'other';
}

export interface StudyDomain { id: string; name: string; fit: number; group: string; flags: Record<string, number>; slowFit: number; sdcFit: number; sdcCoverage?: number }
export interface StudyDecomposition {
  aOp: number; aRun: number; lambdaJob: number; hardware: number; isolation: number; meanPauseS: number; recoveryS: number; detectS: number; globalS: number; mtbiHours: number;
  delivered: number; effective: number; value: number; ledger: TrainingLedger; byGroup: Record<string, number>; byDomain: Record<string, { ratePerHour: number; meanPauseS: number; points: number; share: number }>;
  stages: { name: string; meanS: number }[]; overhead: number; falseAlarms: number;
}
export interface StudyVerification { trials: number; seed: number; value: SummaryStat; aOp: SummaryStat; delivered: SummaryStat; pAtLeastTarget: number; wilson: [number, number]; verdict: 'supported' | 'uncertain' | 'below'; counts: Record<string, number> }
export interface StudyLever { id: string; patch: { autoSeconds?: number; success?: number; manualSeconds?: number }; value: number; valueDerated: number; recoveryS: number; meanPauseS: number; residualFactor: number }
export interface StudyPlan { feasible: boolean; ids: string[]; effort: number; nominal: number; derated: number; necessary: string[]; feasibleCount: number; maxValue: number; maxDerated: number; pareto: { ids: string[]; effort: number; value: number; derated: number }[]; notes: string[]; method: 'exact' | 'greedy'; best: { ids: string[]; effort: number; value: number; derated: number } }
export interface StudyGain { id: string; byMetric: Record<AttributionMetric, { single: number; lastAdded: number; shapley: number }>; halfWidth?: number }
export interface StudySize {
  N: number; baseline: StudyDecomposition; unavailabilityBudget: number;
  hardwareOnly: { factor: number; lambdaStar: number; mtbiStarHours: number; arinc?: { id: string; name: string; currentFit: number; allowedFit: number; improvementFactor: number }[]; minimumEffort?: { notes: string[]; rows: { id: string; currentFit: number; allowedFit: number; improvementFactor: number }[] } };
  recoveryOnly: { factor: number; recoveryStarS: number; stages?: { name: string; currentS: number; budgetS: number; improvementFactor: number }[] };
  plan: StudyPlan; planned: StudyDecomposition; plannedDerated: StudyDecomposition; allOn: StudyDecomposition; allOnDerated: StudyDecomposition;
  residualFactor: { plan: number; planDerated: number; allOn: number; allOnDerated: number };
  residualArinc?: { id: string; currentFit: number; allowedFit: number; improvementFactor: number }[];
  gains: StudyGain[]; attribution: { method: 'exact' | 'sampled'; coalitions?: number; permutations?: number };
  verification?: StudyVerification; verificationBaseline?: StudyVerification; levers?: StudyLever[];
}
export interface StudyCurve { ids: string[]; points: { N: number; value: number }[]; maxN: number }
export interface StudyResult {
  target: number; metric: StudyMetric; sizes: number[]; players: string[]; derate: DerateSpec | null; provisional: boolean; generated: string;
  scenario: { id?: string; name?: string; windowH: number; recoveryMixture: boolean };
  groups: Record<string, string[]>; groupLabels: Record<string, { zh: string; en: string }>; domains: StudyDomain[];
  perSize: Record<number, StudySize>; curves: Record<string, StudyCurve>; curveGrid: number[];
  library: Record<string, { name: { zh: string; en: string }; effort: number; parameters: Record<string, number>; derated: Record<string, number>; confidence: string; kind: string; scope: string; provisional?: Record<string, number> }>;
  notes: string[];
}

const DEFAULT_SIZES = [10000, 100000, 200000, 500000];
export const DEFAULT_STUDY_PLAYERS = ['D-HARD', 'R-REPLAY', 'R-NETFAIL', 'R-HOTSWAP', 'R-ELASTIC', 'R-PROCESS', 'P-PREDICT', 'C-MEM', 'H-LEMON', 'H-SWEEP'];

export function withSize(s: Scenario, N: number): Scenario {
  const c = cloneScenario(s);
  if (c.workload.type === 'training') c.workload = { ...c.workload, nGpus: Math.max(1, Math.round(N)) };
  else if (c.workload.type === 'inference') c.workload = { ...c.workload, nGpus: Math.max(1, Math.round(N)) } as typeof c.workload;
  return c;
}
const metricKey = (m: StudyMetric): 'operationalAvailability' | 'deliveredGoodput' | 'effectiveGoodput' => (m === 'aOp' ? 'operationalAvailability' : m === 'delivered' ? 'deliveredGoodput' : 'effectiveGoodput');
function valueOf(s: Scenario, metric: StudyMetric): number {
  const t = evaluateScenario(s, { structure: false }).training;
  if (!t) throw new Error('the allocation study needs a training workload');
  return t[metricKey(metric)];
}
/** largest factor f (all hard rates × f) that still meets the target when the scenario meets it (slack ≥ 1), else the factor < 1 needed; 0 / Infinity when out of range */
function bisectFactor(f: (x: number) => number, target: number): number {
  let lo: number, hi: number;
  if (f(1) >= target) {
    lo = 1; hi = 1;
    while (f(hi) >= target && hi < 1e4) hi *= 2;
    if (hi >= 1e4) return Infinity;
  } else {
    lo = 1e-4; hi = 1;
    if (f(lo) < target) return 0;
  }
  for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (f(mid) >= target) lo = mid; else hi = mid; }
  return lo;
}
const rateFactorFor = (s: Scenario, metric: StudyMetric, target: number) => bisectFactor((x) => valueOf(scaleAllRates(s, x), metric), target);
const recoveryFactorFor = (s: Scenario, metric: StudyMetric, target: number) => bisectFactor((x) => valueOf(scaleRecovery(s, x), metric), target);

function hardSubsystems(s: Scenario): { subs: Subsystem[]; fit: Record<string, number> } {
  const counts = computeCounts(s);
  const subs: Subsystem[] = [];
  const fit: Record<string, number> = {};
  for (const c of s.components) {
    if (!c.enabled) continue;
    const ci = componentInstances(c, counts, s.measures.subhealthThreshold);
    if (ci.lambda <= 0) continue;
    subs.push({ id: c.id, name: c.name?.zh ?? c.name?.en ?? c.id, count: ci.total, currentLambda: ci.lambda });
    fit[c.id] = ci.lambda * 1e9;
  }
  return { subs, fit };
}
const fitRows = (r: AllocationResult) => r.rows.map((x) => ({ id: x.id, name: x.name, currentFit: ((x.currentAggregate ?? 0) / x.count) * 1e9, allowedFit: x.lambdaPerUnit * 1e9, improvementFactor: x.improvementFactor ?? 1 }));

export function decompose(s: Scenario, metric: StudyMetric): StudyDecomposition {
  const t = evaluateScenario(s, { structure: false }).training;
  if (!t) throw new Error('the allocation study needs a training workload');
  // every term of 1 − A_run = Σ λ p̄ / (1 + Σ λ p̄): the hard classes through their chain, the isolation of detected sub-healthy
  // units (pause G), the predictor's false alarms (pause t_mig) and detected silent corruption (t_d + G, or the step recovery)
  const iso = t.subhealth ? t.subhealth.isolationInterruptionsPerHour * t.globalRecoveryS : 0;
  const falseAlarmS = t.falseAlarmRatePerHour * (s.mechanisms.predict?.migrationSeconds ?? 0);
  const sdcDetectedPauseS = s.sdc.stepRecovery ? s.sdc.detection.detectSeconds + s.sdc.stepRecovery.recoverSeconds + s.sdc.stepRecovery.stepSeconds : s.sdc.detection.detectSeconds + t.globalRecoveryS;
  const sdcDetS = (t.sdc?.detectedRatePerHour ?? 0) * sdcDetectedPauseS;
  const sumLP = t.chain.rows.reduce((a, r) => a + r.ratePerHour * r.meanPauseS, 0) + iso + falseAlarmS + sdcDetS;
  const unRun = 1 - t.runningFraction;
  const byGroup: Record<string, number> = {};
  const byDomain: StudyDecomposition['byDomain'] = {};
  const comps = Object.fromEntries(s.components.map((c) => [c.id, c]));
  for (const r of t.chain.rows) {
    const pts = sumLP > 0 ? (unRun * (r.ratePerHour * r.meanPauseS)) / sumLP : 0;
    byDomain[r.id] = { ratePerHour: r.ratePerHour, meanPauseS: r.meanPauseS, points: pts, share: 1 - t.operationalAvailability > 0 ? pts / (1 - t.operationalAvailability) : 0 };
    const g = comps[r.id] ? groupOf(comps[r.id]) : 'other';
    byGroup[g] = (byGroup[g] ?? 0) + pts;
  }
  byGroup.isolation = sumLP > 0 ? (unRun * iso) / sumLP : 0;
  byGroup.falseAlarm = sumLP > 0 ? (unRun * falseAlarmS) / sumLP : 0;
  byGroup.sdcDetected = sumLP > 0 ? (unRun * sdcDetS) / sumLP : 0;
  byGroup.sdcPause = t.runningFraction * (t.sdc ? t.sdc.delivery.pauseFraction : 0);
  return { aOp: t.operationalAvailability, aRun: t.runningFraction, lambdaJob: t.interruptionRatePerHour, hardware: t.subhealth?.hardwareInterruptionsPerHour ?? t.interruptionRatePerHour, isolation: t.subhealth?.isolationInterruptionsPerHour ?? 0, meanPauseS: t.meanPauseS, recoveryS: t.recoveryS, detectS: t.detectS, globalS: t.globalRecoveryS, mtbiHours: t.mtbiHours, delivered: t.deliveredGoodput, effective: t.effectiveGoodput, value: t[metricKey(metric)], ledger: t.ledger, byGroup, byDomain, stages: t.recovery.stages.map((st) => ({ name: st.name, meanS: st.meanS })), overhead: t.overheadFraction, falseAlarms: t.falseAlarmRatePerHour };
}

function verify(s: Scenario, metric: StudyMetric, target: number, trials: number, seed: number): StudyVerification {
  const run = buildLedgerRun(s, { trials, seed, target });
  const rows = simulateLedgerReplications(run.spec, 0, trials, seed);
  const vals = rows.map((r) => (metric === 'aOp' ? r.operationalAvailability : r.delivered));
  const k = vals.filter((x) => x >= target).length;
  const est = proportionEstimate(k, trials);
  const counts: Record<string, number> = {};
  for (const r of rows) for (const [kk, v] of Object.entries(r.counts)) counts[kk] = (counts[kk] ?? 0) + v / trials;
  return { trials, seed, value: summaryStat(vals), aOp: summaryStat(rows.map((r) => r.operationalAvailability)), delivered: summaryStat(rows.map((r) => r.delivered)), pAtLeastTarget: k / trials, wilson: [est.low, est.high], verdict: proportionVerdict(est, 0.9), counts };
}

/** exact planner up to 10 candidates; greedy forward selection by value gain per effort beyond */
function planFor(s: Scenario, metric: StudyMetric, target: number, players: string[], params: Record<string, Record<string, number>>, derate: DerateSpec | null): StudyPlan {
  const ids = players.filter((id) => !!mechanismById(id).apply);
  const effortOf = (id: string) => mechanismById(id).effort;
  const nominal: Record<string, Record<string, number>> = {};
  const derated: Record<string, Record<string, number>> = {};
  for (const id of ids) {
    nominal[id] = { ...mechanismById(id).parameters, ...(params[id] ?? {}) };
    derated[id] = derate ? derateParameters(nominal[id], derate) : nominal[id];
  }
  if (ids.length <= 10) {
    const p: MechanismPlan = planToTarget(s, { target, metric, players: ids, parameters: params, derate });
    const best = p.pareto.reduce((a, c) => (c.value > a.value ? c : a), p.pareto[0]);
    const chosen: PlanCoalition | undefined = p.plan;
    return { feasible: !!chosen, ids: chosen?.ids ?? best.ids, effort: chosen?.effort ?? best.effort, nominal: chosen?.value ?? best.value, derated: chosen?.derated ?? best.derated, necessary: p.necessary, feasibleCount: p.feasibleCount, maxValue: p.maxValue, maxDerated: p.maxDerated, pareto: p.pareto.map((c) => ({ ids: c.ids, effort: c.effort, value: c.value, derated: c.derated })), notes: p.notes, method: 'exact', best: { ids: best.ids, effort: best.effort, value: best.value, derated: best.derated } };
  }
  const base = stripMechanisms(s, ids);
  const v = (sel: string[], prm: Record<string, Record<string, number>>) => mechanismValues(applyMechanisms(base, sel, prm))[metric];
  const v0 = v([], nominal);
  const path: StudyPlan['pareto'] = [{ ids: [], effort: 0, value: v0, derated: v0 }];
  const selected: string[] = [];
  let cur = v0;
  let curD = v0;
  const notes = [`greedy forward selection (${ids.length} candidates > 10): at each step the mechanism with the largest nominal gain per effort is added until the target holds nominally and derated, or no mechanism gains`];
  while (!(cur >= target && curD >= target)) {
    let bestId: string | undefined;
    let bestScore = 0;
    let bestV = cur;
    let bestD = curD;
    for (const id of ids) {
      if (selected.includes(id)) continue;
      const req = mechanismById(id).requires ?? [];
      if (req.some((r) => !selected.includes(r) && ids.includes(r))) continue;
      const val = v([...selected, id], nominal);
      const score = (val - cur) / Math.max(1, effortOf(id));
      if (score > bestScore) { bestScore = score; bestId = id; bestV = val; bestD = v([...selected, id], derated); }
    }
    if (!bestId) break;
    selected.push(bestId);
    cur = bestV;
    curD = bestD;
    path.push({ ids: [...selected], effort: selected.reduce((a, id) => a + effortOf(id), 0), value: cur, derated: curD });
  }
  const feasible = cur >= target && curD >= target;
  const all = { ids, effort: ids.reduce((a, id) => a + effortOf(id), 0), value: v(ids, nominal), derated: v(ids, derated) };
  const best = path.reduce((a, c) => (c.value > a.value ? c : a), path[0]);
  return { feasible, ids: feasible ? selected : best.ids, effort: feasible ? path[path.length - 1].effort : best.effort, nominal: feasible ? cur : best.value, derated: feasible ? curD : best.derated, necessary: [], feasibleCount: feasible ? 1 : 0, maxValue: all.value, maxDerated: all.derated, pareto: path, notes, method: 'greedy', best };
}

/** exact Shapley up to 12 players (all coalitions), permutation sampling beyond */
function gainsFor(s: Scenario, metric: StudyMetric, players: string[], params: Record<string, Record<string, number>>, permutations: number, seed: number): { gains: StudyGain[]; attribution: StudySize['attribution'] } {
  const ids = players.filter((id) => !!mechanismById(id).apply);
  if (ids.length <= 12) {
    const rep = mechanismReport(s, ids, { metric, parameters: params });
    return { gains: rep.gains.map((g) => ({ id: g.id, byMetric: g.byMetric })), attribution: { method: 'exact', coalitions: rep.coalitions } };
  }
  const base = stripMechanisms(s, ids);
  const metrics: AttributionMetric[] = ['delivered', 'effective', 'aOp'];
  const cache = new Map<string, MechanismValues>();
  const val = (sel: string[]): MechanismValues => {
    const key = [...sel].sort().join('|');
    let v = cache.get(key);
    if (!v) { v = mechanismValues(applyMechanisms(base, sel, params)); cache.set(key, v); }
    return v;
  };
  const v0 = val([]);
  const vAll = val(ids);
  const rng = new Rng(seed);
  const contrib: Record<string, Record<AttributionMetric, number[]>> = Object.fromEntries(ids.map((id) => [id, { delivered: [], effective: [], aOp: [] }]));
  for (let p = 0; p < permutations; p++) {
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.uniform() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let prev = v0;
    const sel: string[] = [];
    for (const id of order) {
      sel.push(id);
      const cur = val(sel);
      for (const m of metrics) contrib[id][m].push(cur[m] - prev[m]);
      prev = cur;
    }
  }
  const gains: StudyGain[] = ids.map((id) => {
    const byMetric = {} as StudyGain['byMetric'];
    for (const m of metrics) {
      const st = summaryStat(contrib[id][m]);
      byMetric[m] = { single: val([id])[m] - v0[m], lastAdded: vAll[m] - val(ids.filter((x) => x !== id))[m], shapley: st.mean };
    }
    return { id, byMetric, halfWidth: summaryStat(contrib[id][metric]).ci95 };
  });
  return { gains, attribution: { method: 'sampled', permutations } };
}

export function allocationStudy(s0: Scenario, opts: StudyOptions = {}): StudyResult {
  if (s0.workload.type !== 'training') throw new Error('the allocation study needs a training workload');
  const metric = opts.metric ?? 'aOp';
  const target = opts.target ?? (metric === 'aOp' ? 0.985 : s0.targets.goodput ?? 0.9);
  const sizes = (opts.sizes ?? DEFAULT_SIZES).map((n) => Math.round(n)).filter((n) => n > 0);
  const players = (opts.players ?? DEFAULT_STUDY_PLAYERS).filter((id) => !!mechanismById(id).apply);
  const derate = opts.derate === undefined ? DERATE_DEFAULT : opts.derate;
  const trials = opts.trials ?? 200;
  const seed = opts.seed ?? 1;
  const params: Record<string, Record<string, number>> = { ...(opts.provisional ? provisionalParameters(players) : {}) };
  for (const [id, p] of Object.entries(opts.parameters ?? {})) params[id] = { ...(params[id] ?? {}), ...p };
  const deratedParams: Record<string, Record<string, number>> = Object.fromEntries(players.map((id) => [id, derate ? derateParameters({ ...mechanismById(id).parameters, ...(params[id] ?? {}) }, derate) : { ...mechanismById(id).parameters, ...(params[id] ?? {}) }]));
  const mixture = s0.recovery.mode === 'mixture';
  const total = sizes.length + (opts.curves === false ? 0 : 1);
  let done = 0;
  const tick = (phase: StudyPhase) => opts.onProgress?.(++done, total, phase);

  const domains: StudyDomain[] = [];
  {
    const counts = computeCounts(s0);
    for (const c of s0.components) {
      if (!c.enabled) continue;
      const ci = componentInstances(c, counts, s0.measures.subhealthThreshold);
      if (ci.lambda <= 0 && !c.sdc && !c.subhealth) continue;
      const flags: Record<string, number> = { replay: ci.applicable.replay, process: ci.applicable.process, elastic: ci.applicable.elastic, predict: ci.applicable.predict, netfail: ci.applicable.netfail, hotswap: ci.applicable.hotswap, ...(ci.applicable.custom ?? {}) };
      domains.push({ id: c.id, name: c.name?.zh ?? c.name?.en ?? c.id, fit: ci.lambda * 1e9, group: groupOf(c), flags, slowFit: (ci.subhealth?.ratePerHour ?? 0) * 1e9, sdcFit: ci.sdcLambda * 1e9, sdcCoverage: c.sdc ? classSdcCoverage(ci, s0.sdc.detection.coverage) : undefined });
    }
  }
  const library: StudyResult['library'] = {};
  for (const id of players) {
    const m = mechanismById(id);
    const p = { ...m.parameters, ...(params[id] ?? {}) };
    library[id] = { name: m.name, effort: m.effort, parameters: p, derated: deratedParams[id], confidence: m.confidence, kind: m.kind, scope: m.scope, provisional: opts.provisional && m.provisional ? m.provisional : undefined };
  }

  const perSize: Record<number, StudySize> = {};
  for (const N of sizes) {
    const s = withSize(s0, N);
    const baseline = decompose(s, metric);
    const fHw = rateFactorFor(s, metric, target);
    const gRec = recoveryFactorFor(s, metric, target);
    const { subs } = hardSubsystems(s);
    const lambdaStar = baseline.hardware * fHw;
    const arincRows = Number.isFinite(fHw) && fHw > 0 && subs.length ? arinc(subs, lambdaStar) : undefined;
    const albert = Number.isFinite(fHw) && fHw > 0 && subs.length ? minimumEffort(subs, lambdaStar) : undefined;
    const Rstar = baseline.recoveryS * gRec;
    const stages = Number.isFinite(gRec) && gRec > 0 ? allocateRecoveryStages(baseline.stages.map((st) => ({ name: st.name, currentS: st.meanS, floorS: st.name === 'detection' || st.name === 'detect' ? Math.min(st.meanS, 5) : 0 })), Rstar).map((b, i) => ({ name: b.name, currentS: baseline.stages[i].meanS, budgetS: b.budgetS, improvementFactor: b.improvementFactor })) : undefined;
    const plan = planFor(s, metric, target, players, params, derate);
    const planned = applyMechanisms(s, plan.ids, params);
    const plannedDerated = applyMechanisms(s, plan.ids, deratedParams);
    const allOn = applyMechanisms(s, players, params);
    const allOnDerated = applyMechanisms(s, players, deratedParams);
    const residualFactor = { plan: rateFactorFor(planned, metric, target), planDerated: rateFactorFor(plannedDerated, metric, target), allOn: rateFactorFor(allOn, metric, target), allOnDerated: rateFactorFor(allOnDerated, metric, target) };
    const { gains, attribution } = gainsFor(s, metric, players, params, opts.permutations ?? 200, seed);
    const size: StudySize = {
      N, baseline, unavailabilityBudget: (1 - target) / target,
      hardwareOnly: { factor: fHw, lambdaStar, mtbiStarHours: lambdaStar + baseline.isolation > 0 ? 1 / (lambdaStar + baseline.isolation) : Infinity, arinc: arincRows ? fitRows(arincRows) : undefined, minimumEffort: albert ? { notes: albert.notes, rows: fitRows(albert) } : undefined },
      recoveryOnly: { factor: gRec, recoveryStarS: Rstar, stages },
      plan, planned: decompose(planned, metric), plannedDerated: decompose(plannedDerated, metric), allOn: decompose(allOn, metric), allOnDerated: decompose(allOnDerated, metric),
      residualFactor, residualArinc: Number.isFinite(residualFactor.plan) && residualFactor.plan > 0 && subs.length ? fitRows(arinc(subs, baseline.hardware * residualFactor.plan)) : undefined,
      gains, attribution,
    };
    if (opts.levers !== false && mixture) {
      const withRecovery = (sc: Scenario, patch: StudyLever['patch']): Scenario => {
        const c = cloneScenario(sc);
        if (c.recovery.mode !== 'mixture') return c;
        c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, seconds: patch.autoSeconds ?? c.recovery.automatic.seconds, successProbability: patch.success ?? c.recovery.automatic.successProbability }, manual: { ...c.recovery.manual, seconds: patch.manualSeconds ?? c.recovery.manual.seconds } };
        return c;
      };
      const specs: { id: string; patch: StudyLever['patch'] }[] = [
        { id: 'plan', patch: {} }, { id: 'auto60', patch: { autoSeconds: 60 } }, { id: 'ps999', patch: { success: 0.999 } }, { id: 'manual30', patch: { manualSeconds: 1800 } },
        { id: 'auto60+ps999', patch: { autoSeconds: 60, success: 0.999 } }, { id: 'auto60+manual30', patch: { autoSeconds: 60, manualSeconds: 1800 } }, { id: 'ps999+manual30', patch: { success: 0.999, manualSeconds: 1800 } }, { id: 'all3', patch: { autoSeconds: 60, success: 0.999, manualSeconds: 1800 } },
      ];
      size.levers = specs.map((l) => { const sc = withRecovery(planned, l.patch); const d = decompose(sc, metric); return { id: l.id, patch: l.patch, value: d.value, valueDerated: decompose(withRecovery(plannedDerated, l.patch), metric).value, recoveryS: d.recoveryS, meanPauseS: d.meanPauseS, residualFactor: rateFactorFor(sc, metric, target) }; });
    }
    if (trials > 0) {
      size.verification = verify(planned, metric, target, trials, seed);
      size.verificationBaseline = verify(s, metric, target, trials, seed);
    }
    perSize[N] = size;
    tick('sizes');
  }

  const curves: Record<string, StudyCurve> = {};
  const lo = Math.min(...sizes), hi = Math.max(...sizes);
  const grid = opts.curveGrid ?? Array.from({ length: 15 }, (_, i) => Math.round(Math.exp(Math.log(lo / 2) + (i / 14) * Math.log((hi * 2) / (lo / 2)))));
  if (opts.curves !== false) {
    const sets: Record<string, string[]> = { baseline: [] };
    for (const N of sizes) {
      const ids = perSize[N].plan.ids;
      const key = ids.join('+');
      if (ids.length && !Object.values(sets).some((x) => x.join('+') === key)) sets[`plan${N}`] = ids;
    }
    if (!Object.values(sets).some((x) => x.join('+') === players.join('+'))) sets.allOn = players;
    const maxN = (ids: string[], prm: Record<string, Record<string, number>>) => {
      let a = Math.max(1, Math.round(lo / 10)), b = hi * 8;
      if (valueOf(applyMechanisms(withSize(s0, b), ids, prm), metric) >= target) return b;
      if (valueOf(applyMechanisms(withSize(s0, a), ids, prm), metric) < target) return a;
      for (let i = 0; i < 40; i++) { const mid = Math.sqrt(a * b); if (valueOf(applyMechanisms(withSize(s0, Math.round(mid)), ids, prm), metric) >= target) a = mid; else b = mid; }
      return Math.round(a);
    };
    for (const [name, ids] of Object.entries(sets)) {
      curves[name] = { ids, points: grid.map((N) => ({ N, value: valueOf(applyMechanisms(withSize(s0, N), ids, params), metric) })), maxN: maxN(ids, params) };
      curves[`${name}Derated`] = { ids, points: grid.map((N) => ({ N, value: valueOf(applyMechanisms(withSize(s0, N), ids, deratedParams), metric) })), maxN: maxN(ids, deratedParams) };
    }
    tick('curves');
  }
  const notes = [
    `metric ${metric}, target ${(target * 100).toFixed(2)} %, window ${(s0.workload.durationDays * 24).toFixed(0)} h; hardware-only and recovery-only factors by bisection on a uniform scale of all hard rates / all recovery stages (ARINC: identical improvement factor per class)`,
    `planner: exact over 2^n coalitions up to 10 candidates, greedy forward selection beyond; attribution: exact Shapley up to 12 players, ${opts.permutations ?? 200} permutations beyond`,
    derate ? `derating of the mechanism parameters: coverage, detection targets and shares −${(derate.coverageDelta * 100).toFixed(0)} pt, success −${(derate.successDelta * 100).toFixed(0)} pt, times and overheads ×${derate.timeFactor}, reductions ×${derate.reductionFactor}` : 'no derating',
    opts.provisional ? 'audited mechanisms use the provisional integration assumptions (tagged assumed)' : 'audited mechanisms without integration parameters have no effect (audit only)',
  ];
  return { target, metric, sizes, players, derate, provisional: !!opts.provisional, generated: new Date().toISOString(), scenario: { id: s0.meta.id, name: s0.meta.name, windowH: s0.workload.durationDays * 24, recoveryMixture: mixture }, groups: CATALOG_GROUPS, groupLabels: GROUP_LABELS, domains, perSize, curves, curveGrid: grid, library, notes };
}
