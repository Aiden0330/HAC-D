/**
 * v4 allocation strategies (docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §8): reach an A_op or delivered-goodput target over the job window,
 * nominally and with the mechanism parameters derated, by combining three kinds of moves on top of the scenario's own mechanisms:
 *
 *  - mechanisms from the library (effort = library effort, editable),
 *  - recovery levers moved to a limit (automatic attempt time, automatic success, manual recovery time; effort per lever),
 *  - hardware: the interruption FIT of each fault class multiplied by x_i ∈ [floor_i, 1]; effort e_i · log2(1/x_i) (e_i = effort of
 *    halving that class's FIT).
 *
 * Hardware split for a level L (one parameter, found by bisection on the engine): x_i·c_i = clamp(w_i·L, floor_i·c_i, c_i), where
 * c_i = λ_i·p̄_i is the class's pause contribution (rate × mean pause per event of its mechanism chain) and the weight w_i is
 *   'min-effort'  e_i        — minimises Σ e_i log2(1/x_i) for the A_op budget (KKT: x_i c_i ∝ e_i), Albert's minimum effort for equal e_i;
 *   'agree'       n_i·E_i    — AGREE complexity (units of the class) × importance, with the slack of the under-budget classes reallocated;
 *   'arinc'       c_i        — one uniform factor (ARINC).
 * For A_op the running fraction is exactly A_run = 1/(1 + (Σ x_i c_i + F)/3600) (F: isolation, false-alarm and detected-silent-corruption
 * pauses) and A_op = A_run·(1 − φ_sdc), which gives the level in closed form; the engine confirms it.
 *
 * Strategies
 *  - 'mttr-first'  recovery side first: add the mechanism / lever with the largest gain per effort until the target holds or nothing
 *                  gains; the remaining gap goes to hardware.
 *  - 'mttf-first'  hardware first: close the gap with hardware down to the floors; only if the floors are not enough add mechanisms
 *                  (physical, then recovery side) evaluated with the hardware at its floors, then relax the hardware again.
 *  - 'optimal'     minimum total effort (mechanisms + levers + hardware) over the subsets of the candidate moves: exact enumeration
 *                  (A_op: up to 10 moves, delivered: up to 6), greedy descent on the total effort beyond.
 */
import type { Scenario } from '../scenario/schema.js';
import { evaluateScenario, type TrainingKpis as TrainingResult } from '../scenario/evaluate.js';
import { cloneScenario } from '../scenario/analysis.js';
import { computeCounts, componentInstances } from '../scenario/build.js';
import { mechanismById, applyMechanisms, applyMechanismsInOrder, stripMechanisms } from '../mechanisms/index.js';
import { STAGE_MECHANISM_IDS } from '../mechanisms/auditLibrary.js';
import { DERATE_DEFAULT, derateParameters, type DerateSpec } from '../mechanisms/plan.js';
import { buildLedgerRun, simulateLedgerReplications } from '../mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict, summaryStat, type SummaryStat } from '../math/stats.js';
import { withSize } from '../study/index.js';

export type StrategyId = 'optimal' | 'mttr-first' | 'mttf-first';
export const STRATEGY_IDS: StrategyId[] = ['optimal', 'mttr-first', 'mttf-first'];
/** the value function of a strategy: A_op, the delivered goodput, or v5.6 the effective goodput (the report's metric) */
export type StrategyMetric = 'aOp' | 'delivered' | 'effective';
export type HardwareSplit = 'min-effort' | 'agree' | 'arinc';
export type LeverId = 'auto' | 'success' | 'manual';
export interface RecoveryLever { id: LeverId; limit: number; effort: number }
/** recovery limits of the MTTR side (automatic attempt ≥ 60 s, automatic success ≤ 99.9 %, manual recovery ≥ 30 min; efforts assumed) */
export const DEFAULT_LEVERS: RecoveryLever[] = [{ id: 'auto', limit: 60, effort: 3 }, { id: 'success', limit: 0.999, effort: 3 }, { id: 'manual', limit: 1800, effort: 2 }];
export const LEVER_NAMES: Record<LeverId, { zh: string; en: string }> = {
  auto: { zh: '自动恢复尝试时间 → 下限', en: 'automatic attempt time → limit' },
  success: { zh: '自动恢复成功率 → 上限', en: 'automatic success → limit' },
  manual: { zh: '人工恢复时间 → 下限', en: 'manual recovery time → limit' },
};
/** short labels for result tables */
export const LEVER_SHORT: Record<LeverId, { zh: string; en: string }> = {
  auto: { zh: '自动尝试时间', en: 'auto attempt' },
  success: { zh: '自动成功率', en: 'auto success' },
  manual: { zh: '人工恢复时间', en: 'manual time' },
};
/** mechanisms the strategies may add by default (recovery side, ready without integration parameters) */
export const DEFAULT_STRATEGY_CANDIDATES = ['D-HARD', 'D-SLOW', 'P-PREDICT', 'R-NETFAIL', 'R-HOTSWAP', 'C-MEM'];
export const DEFAULT_EFFORT_PER_HALVING = 2;
export const DEFAULT_FLOOR = 0.05;

export interface ClassConstraint {
  /** lowest factor of the current interruption FIT this class can reach (default component.allocation.minLambdaFactor ?? 0.05) */
  floor?: number;
  /** effort of halving the class's FIT (default component.allocation.effortPerHalving ?? 2) */
  effortPerHalving?: number;
  /** keep the class at its current FIT */
  fixed?: boolean;
}

export interface StrategyOptions {
  strategy: StrategyId;
  target: number;
  metric?: StrategyMetric;
  /** mechanisms the strategy may add (ids already in the scenario are skipped) */
  candidates?: string[];
  /** parameter overrides of the candidate mechanisms */
  parameters?: Record<string, Record<string, number>>;
  /** effort overrides by mechanism id */
  efforts?: Record<string, number>;
  /** recovery levers (false: none) */
  levers?: RecoveryLever[] | false;
  hardwareSplit?: HardwareSplit;
  constraints?: Record<string, ClassConstraint>;
  defaultFloor?: number;
  defaultEffortPerHalving?: number;
  /** derating of the mechanism parameters and levers (null: nominal only) */
  derate?: DerateSpec | null;
  verify?: { trials: number; seed?: number };
  onProgress?: (done: number, total: number) => void;
}

export interface StrategyValues { value: number; aOp: number; delivered: number; effective: number; mtbiHours: number; meanPauseS: number; recoveryS: number }
export interface StrategyHardwareRow {
  id: string; name: string; count: number;
  /** current interruption FIT per unit, allowed FIT per unit, factor x = allowed / current */
  currentFit: number; allowedFit: number; factor: number; floor: number; atFloor: boolean;
  effortPerHalving: number; effort: number;
  /** unavailability points (A_op) of the class before and after the hardware step (derated scenario of the final moves) */
  pointsBefore: number; pointsAfter: number;
  /** allowed MTBF per unit, hours */
  mtbfHours: number;
}
export interface StrategyStep { kind: 'mechanism' | 'lever' | 'hardware'; id: string; effort: number; value: number; derated: number }
export interface StrategyPlan { mechanisms: string[]; levers: LeverId[]; effort: { mechanisms: number; levers: number; hardware: number; total: number }; value: number; derated: number; feasible: boolean }
export interface StrategyResult {
  strategy: StrategyId; metric: StrategyMetric; target: number; hardwareSplit: HardwareSplit; derate: DerateSpec | null;
  npus: number;
  feasible: boolean;
  /** the scenario's own design (its mechanisms, current hardware) */
  baseline: StrategyValues & { derated: number };
  /** moves the strategy added */
  mechanisms: string[];
  levers: LeverId[];
  hardware: { rows: StrategyHardwareRow[]; effort: number; needed: boolean; atFloors: string[]; slackFactor?: number };
  effort: { mechanisms: number; levers: number; hardware: number; total: number };
  final: StrategyValues & { derated: number };
  steps: StrategyStep[];
  /** optimal: the cheapest plans found (best first) */
  alternatives?: StrategyPlan[];
  verification?: { trials: number; seed: number; value: SummaryStat; pAtLeastTarget: number; wilson: [number, number]; verdict: 'supported' | 'uncertain' | 'below' };
  /** the final design: the scenario with the added mechanisms, the levers and the allowed FIT */
  scenario: Scenario;
  evaluations: number;
  notes: string[];
}

type Move = { kind: 'mechanism'; id: string; effort: number; physical: boolean } | { kind: 'lever'; id: LeverId; effort: number; lever: RecoveryLever; physical: false };
interface State { mechs: string[]; levers: LeverId[] }
interface HwClass { id: string; name: string; count: number; fit: number; floor: number; e: number; importance: number; fixed: boolean }

const keyOf = (st: State) => `${[...st.mechs].sort().join('+')}|${[...st.levers].sort().join('+')}`;

function training(s: Scenario): TrainingResult {
  const t = evaluateScenario(s, { structure: false }).training;
  if (!t) throw new Error('allocation strategies need a training workload');
  return t;
}
/** v5.7 the goodput metrics on the exact renewal model (the window ledger's model, which also verifies the plans) */
const metricOf = (t: TrainingResult, metric: StrategyMetric): number => (metric === 'aOp' ? t.operationalAvailability : metric === 'effective' ? t.effectiveGoodputExact : t.deliveredGoodputExact);
const valuesOf = (t: TrainingResult, metric: StrategyMetric): StrategyValues => ({ value: metricOf(t, metric), aOp: t.operationalAvailability, delivered: t.deliveredGoodputExact, effective: t.effectiveGoodputExact, mtbiHours: t.mtbiHours, meanPauseS: t.meanPauseS, recoveryS: t.recoveryS });

/**
 * Move the mixture recovery to the lever limits (derated limits never worse than the current value). The levers act after the
 * design's mechanisms (a mechanism's job-level stage saving is absorbed when the lever's attempt is shorter). v5.5 (second recheck
 * N4): the same-stage mechanisms (`STAGE_MECHANISM_IDS`) store a class's stage as absolute seconds computed against the job's stage
 * when they were applied; when the automatic-attempt lever shortens the attempt, the job's stages shrink with it, so those
 * mechanisms are stripped before the lever and re-applied over the new attempt in their recorded order (as `editBase` does for a
 * recovery edit) — a class's stage is then the same-stage expectation over the levered job stage, never longer than the job's.
 */
export function applyLevers(s: Scenario, levers: RecoveryLever[], derate?: DerateSpec | null): Scenario {
  if (s.recovery.mode !== 'mixture' || !levers.length) return s;
  const staged = levers.some((l) => l.id === 'auto') ? Object.entries(s.mechanisms.applied ?? {}).filter(([id]) => STAGE_MECHANISM_IDS.includes(id)).sort((a, b) => a[1].order - b[1].order) : [];
  const c = staged.length ? stripMechanisms(s, staged.map(([id]) => id)) : cloneScenario(s);
  if (c.recovery.mode !== 'mixture') return c;
  const r = c.recovery;
  for (const l of levers) {
    if (l.id === 'auto') r.automatic = { ...r.automatic, seconds: Math.min(r.automatic.seconds, derate ? l.limit * derate.timeFactor : l.limit) };
    // the success lever is derated on its failure probability (× timeFactor, as the manual-fallback probability of
    // derateParameters): 1 − 0.1 % × 1.5 = 99.85 %; the former −8 pt (91.9 %) fell below today's 99 % and made the lever dead (R1)
    else if (l.id === 'success') r.automatic = { ...r.automatic, successProbability: Math.max(r.automatic.successProbability, Math.min(1, derate ? 1 - (1 - l.limit) * derate.timeFactor : l.limit)) };
    else if (l.id === 'manual') r.manual = { seconds: Math.min(r.manual.seconds, derate ? l.limit * derate.timeFactor : l.limit) };
  }
  return staged.length ? applyMechanismsInOrder(c, staged.map(([id]) => id), Object.fromEntries(staged.map(([id, rec]) => [id, rec.parameters]))) : c;
}

/** Multiply the interruption FIT of the given classes. */
export function withHardwareFactors(s: Scenario, x: Record<string, number>): Scenario {
  const c = cloneScenario(s);
  for (const comp of c.components) if (x[comp.id] !== undefined && x[comp.id] !== 1) comp.failure = { ...comp.failure, value: comp.failure.value * x[comp.id] };
  return c;
}

export function allocateStrategy(s0: Scenario, opts: StrategyOptions): StrategyResult {
  if (s0.workload.type !== 'training') throw new Error('allocation strategies need a training workload');
  const metric: StrategyMetric = opts.metric ?? 'aOp';
  const T = opts.target;
  const split: HardwareSplit = opts.hardwareSplit ?? 'min-effort';
  const derate = opts.derate === undefined ? DERATE_DEFAULT : opts.derate;
  const notes: string[] = [];
  let evaluations = 0;
  const evalT = (s: Scenario) => { evaluations++; return training(s); };

  // ---- moves ----
  const baseApplied = Object.entries(s0.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order);
  const baseIds = baseApplied.map(([id]) => id);
  const candidates = (opts.candidates ?? DEFAULT_STRATEGY_CANDIDATES).filter((id) => !baseIds.includes(id) && !!mechanismById(id).apply);
  const leverList = opts.levers === false ? [] : (opts.levers ?? DEFAULT_LEVERS);
  if (leverList.length && s0.recovery.mode !== 'mixture') notes.push('recovery levers need the MTTR mixture recovery model; skipped');
  const moves: Move[] = [
    ...candidates.map((id): Move => ({ kind: 'mechanism', id, effort: opts.efforts?.[id] ?? mechanismById(id).effort, physical: mechanismById(id).kind === 'physical' })),
    ...(s0.recovery.mode === 'mixture' ? leverList.map((l): Move => ({ kind: 'lever', id: l.id, effort: l.effort, lever: l, physical: false })) : []),
  ];
  const nominalParams: Record<string, Record<string, number>> = {};
  const deratedParams: Record<string, Record<string, number>> = {};
  for (const [id, rec] of baseApplied) { nominalParams[id] = { ...rec.parameters }; deratedParams[id] = derate ? derateParameters(rec.parameters, derate) : { ...rec.parameters }; }
  for (const id of candidates) { const p = { ...mechanismById(id).parameters, ...(opts.parameters?.[id] ?? {}) }; nominalParams[id] = p; deratedParams[id] = derate ? derateParameters(p, derate) : p; }
  const baseStripped = baseIds.length ? stripMechanisms(s0, baseIds) : s0;
  const requiresOk = (id: string, mechs: string[]) => (mechanismById(id).requires ?? []).every((r) => mechs.includes(r) || baseIds.includes(r));

  // ---- scenarios and values per state (cached) ----
  const scCache = new Map<string, { nom: Scenario; der: Scenario }>();
  const scenariosOf = (st: State) => {
    const k = keyOf(st);
    let v = scCache.get(k);
    if (!v) {
      const levers = leverList.filter((l) => st.levers.includes(l.id));
      const nom = applyLevers(st.mechs.length ? applyMechanisms(s0, st.mechs, nominalParams) : s0, levers, null);
      // the derated twin keeps the scenario's recorded order for its own mechanisms (v5.5, fifth review D5) and appends the added ones in library order, as the nominal design does
      const der = derate ? applyLevers(applyMechanisms(applyMechanismsInOrder(baseStripped, baseIds, deratedParams), st.mechs, deratedParams), levers, derate) : nom;
      v = { nom, der };
      scCache.set(k, v);
    }
    return v;
  };
  const valCache = new Map<string, { nom: TrainingResult; der: TrainingResult }>();
  const valuesAt = (st: State) => {
    const k = keyOf(st);
    let v = valCache.get(k);
    if (!v) {
      const sc = scenariosOf(st);
      const nom = evalT(sc.nom);
      v = { nom, der: derate ? evalT(sc.der) : nom };
      valCache.set(k, v);
    }
    return v;
  };
  const mv = (t: TrainingResult) => metricOf(t, metric);
  const effortOf = (st: State) => st.mechs.reduce((a, id) => a + (moves.find((m) => m.kind === 'mechanism' && m.id === id)?.effort ?? 0), 0) + st.levers.reduce((a, id) => a + (leverList.find((l) => l.id === id)?.effort ?? 0), 0);
  const mechEffort = (st: State) => st.mechs.reduce((a, id) => a + (moves.find((m) => m.kind === 'mechanism' && m.id === id)?.effort ?? 0), 0);
  const leverEffort = (st: State) => st.levers.reduce((a, id) => a + (leverList.find((l) => l.id === id)?.effort ?? 0), 0);

  // ---- hardware classes ----
  const counts = computeCounts(s0);
  const hw: HwClass[] = [];
  for (const c of s0.components) {
    if (!c.enabled) continue;
    const ci = componentInstances(c, counts, s0.measures.subhealthThreshold);
    if (!(ci.lambda > 0) || ci.total <= 0) continue;
    const k = opts.constraints?.[c.id] ?? {};
    hw.push({ id: c.id, name: c.name?.zh ?? c.name?.en ?? c.id, count: ci.total, fit: ci.lambda * 1e9, floor: Math.min(1, Math.max(0, k.floor ?? c.allocation?.minLambdaFactor ?? opts.defaultFloor ?? DEFAULT_FLOOR)), e: Math.max(1e-6, k.effortPerHalving ?? c.allocation?.effortPerHalving ?? opts.defaultEffortPerHalving ?? DEFAULT_EFFORT_PER_HALVING), importance: c.allocation?.importance ?? 1, fixed: !!(k.fixed ?? c.allocation?.fixed) });
  }
  const free = hw.filter((h) => !h.fixed && h.floor < 1);
  const hwEffort = (x: Record<string, number>) => free.reduce((a, h) => a + (x[h.id] !== undefined && x[h.id] < 1 ? h.e * Math.log2(1 / x[h.id]) : 0), 0);

  /**
   * contributions c_i (s/h) per class from an evaluation: the pause λ_i t̄_i on A_op; v5.7 (sixth review M3) the loss λ_i r_i =
   * λ_i (t̄_i + P_rb,i W) on the goodput metrics (formula 1′), so that the min-effort and AGREE splits weight a class by what it costs
   * the metric (ARINC is unaffected: its weights are the contributions themselves)
   */
  const contributions = (t: TrainingResult) => Object.fromEntries(t.chain.rows.map((r) => [r.id, r.ratePerHour * (r.meanPauseS + (metric === 'aOp' ? 0 : r.pRollback * t.recomputePerInterruptionS))]));
  const weightsOf = (c: Record<string, number>) => Object.fromEntries(free.map((h) => [h.id, split === 'min-effort' ? h.e : split === 'agree' ? h.count * h.importance : (c[h.id] ?? 0)]));
  const xAt = (L: number, c: Record<string, number>, w: Record<string, number>) => {
    const x: Record<string, number> = {};
    for (const h of free) {
      const ci = c[h.id] ?? 0;
      if (!(ci > 0)) { x[h.id] = 1; continue; }
      x[h.id] = Math.min(1, Math.max(h.floor, (w[h.id] * L) / ci));
    }
    return x;
  };
  const lMaxOf = (c: Record<string, number>, w: Record<string, number>) => free.reduce((a, h) => ((c[h.id] ?? 0) > 0 && w[h.id] > 0 ? Math.max(a, (c[h.id] ?? 0) / w[h.id]) : a), 0);

  interface Closure { x: Record<string, number>; feasible: boolean; effort: number; needed: boolean; nom?: TrainingResult; der?: TrainingResult }
  /** A_op closed form: the level that meets the target on the binding scenario (no engine call beyond `t`) */
  const analyticLevel = (t: TrainingResult, c: Record<string, number>, w: Record<string, number>): number | undefined => {
    const sumC = Object.values(c).reduce((a, b) => a + b, 0);
    const F = 3600 * (1 / t.runningFraction - 1) - sumC;
    const phi = t.runningFraction > 0 ? 1 - t.operationalAvailability / t.runningFraction : 0;
    const B = 3600 * ((1 - phi) / T - 1) - F;
    const fixedC = hw.filter((h) => !free.includes(h)).reduce((a, h) => a + (c[h.id] ?? 0), 0);
    const S = (L: number) => fixedC + free.reduce((a, h) => a + (c[h.id] ?? 0) * xAt(L, c, w)[h.id], 0);
    const Lmax = lMaxOf(c, w);
    if (S(Lmax) <= B) return Lmax;
    if (S(0) > B) return undefined;
    let lo = 0, hi = Lmax;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (S(mid) <= B) lo = mid; else hi = mid; }
    return lo;
  };
  /** hardware closure on the state's scenarios: largest level (least improvement) meeting the target nominally and derated */
  const closure = (st: State, exact: boolean): Closure => {
    const v = valuesAt(st);
    const sc = scenariosOf(st);
    if (mv(v.nom) >= T && mv(v.der) >= T) return { x: {}, feasible: true, effort: 0, needed: false, nom: v.nom, der: v.der };
    if (!free.length) return { x: {}, feasible: false, effort: 0, needed: true };
    const binding = mv(v.der) <= mv(v.nom) ? 'der' : 'nom';
    const tB = v[binding];
    const c = contributions(tB);
    const w = weightsOf(c);
    const Lmax = lMaxOf(c, w);
    const okAt = (L: number) => { const x = xAt(L, c, w); const nom = evalT(withHardwareFactors(sc.nom, x)); const der = derate ? evalT(withHardwareFactors(sc.der, x)) : nom; return { ok: mv(nom) >= T && mv(der) >= T, nom, der, x }; };
    if (metric === 'aOp' && !exact) {
      const L = analyticLevel(tB, c, w);
      if (L === undefined) return { x: xAt(0, c, w), feasible: false, effort: hwEffort(xAt(0, c, w)), needed: true };
      const x = xAt(L, c, w);
      return { x, feasible: true, effort: hwEffort(x), needed: true };
    }
    const floorCheck = okAt(0);
    if (!floorCheck.ok) return { x: floorCheck.x, feasible: false, effort: hwEffort(floorCheck.x), needed: true, nom: floorCheck.nom, der: floorCheck.der };
    let lo = 0, hi = Lmax;
    let best = floorCheck;
    if (metric === 'aOp') {
      const La = analyticLevel(tB, c, w);
      if (La !== undefined) {
        const a = okAt(La * 0.999);
        if (a.ok) { lo = La * 0.999; best = a; const b = okAt(Math.min(Lmax, La * 1.001)); if (!b.ok) hi = Math.min(Lmax, La * 1.001); else { lo = Math.min(Lmax, La * 1.001); best = b; } }
        else hi = La * 0.999;
      }
    }
    for (let i = 0; i < (metric === 'aOp' ? 14 : 34); i++) {
      const mid = (lo + hi) / 2;
      const r = okAt(mid);
      if (r.ok) { lo = mid; best = r; } else hi = mid;
    }
    return { x: best.x, feasible: true, effort: hwEffort(best.x), needed: true, nom: best.nom, der: best.der };
  };

  const steps: StrategyStep[] = [];
  const pushStep = (kind: StrategyStep['kind'], id: string, effort: number, st: State) => { const v = valuesAt(st); steps.push({ kind, id, effort, value: mv(v.nom), derated: mv(v.der) }); };
  const feasibleNow = (st: State) => { const v = valuesAt(st); return mv(v.nom) >= T && mv(v.der) >= T; };
  const withMove = (st: State, m: Move): State => (m.kind === 'mechanism' ? { mechs: [...st.mechs, m.id], levers: st.levers } : { mechs: st.mechs, levers: [...st.levers, m.id] });
  const usable = (st: State, m: Move) => (m.kind === 'mechanism' ? !st.mechs.includes(m.id) && requiresOk(m.id, st.mechs) : !st.levers.includes(m.id));
  /** greedy forward selection by binding-value gain per effort (optionally evaluated with fixed hardware factors) */
  const greedy = (start: State, pool: Move[], x?: Record<string, number>): State => {
    let st = start;
    const val = (s: State) => {
      if (!x) { const v = valuesAt(s); return Math.min(mv(v.nom), mv(v.der)); }
      const sc = scenariosOf(s);
      const nom = mv(evalT(withHardwareFactors(sc.nom, x)));
      return derate ? Math.min(nom, mv(evalT(withHardwareFactors(sc.der, x)))) : nom;
    };
    let cur = val(st);
    for (let guard = 0; guard < pool.length && cur < T; guard++) {
      let best: { m: Move; v: number; score: number } | undefined;
      for (const m of pool) {
        if (!usable(st, m)) continue;
        const v = val(withMove(st, m));
        const score = (v - cur) / Math.max(1, m.effort);
        if (v > cur + 1e-12 && (!best || score > best.score)) best = { m, v, score };
      }
      if (!best) break;
      st = withMove(st, best.m);
      cur = best.v;
      pushStep(best.m.kind, best.m.id, best.m.effort, st);
      opts.onProgress?.(steps.length, pool.length + 2);
    }
    return st;
  };

  const empty: State = { mechs: [], levers: [] };
  const base = valuesAt(empty);
  let state: State = empty;
  let hwc: Closure = { x: {}, feasible: feasibleNow(empty), effort: 0, needed: false };
  let alternatives: StrategyPlan[] | undefined;
  const recoverySide = moves.filter((m) => !m.physical);
  const physicalSide = moves.filter((m) => m.physical);

  if (opts.strategy === 'mttr-first') {
    state = greedy(empty, recoverySide);
    hwc = closure(state, true);
    if (physicalSide.length) notes.push('MTTR-preferred uses only recovery-side moves before the hardware; physical mechanisms in the candidates are left to the other strategies');
  } else if (opts.strategy === 'mttf-first') {
    hwc = closure(empty, true);
    if (!hwc.feasible) {
      notes.push('the hardware floors alone do not reach the target: mechanisms are added with the hardware at its floors, then the hardware is relaxed again');
      const floors = hwc.x;
      state = greedy(empty, physicalSide, floors);
      state = greedy(state, recoverySide, floors);
      hwc = closure(state, true);
    }
  } else {
    const maxExact = metric === 'aOp' ? 10 : 6;
    const plans: StrategyPlan[] = [];
    const planOf = (st: State, exact: boolean): StrategyPlan => {
      const c = closure(st, exact);
      const v = valuesAt(st);
      return { mechanisms: st.mechs, levers: st.levers, effort: { mechanisms: mechEffort(st), levers: leverEffort(st), hardware: c.effort, total: effortOf(st) + c.effort }, value: mv(v.nom), derated: mv(v.der), feasible: c.feasible };
    };
    if (moves.length <= maxExact) {
      const n = moves.length;
      for (let mask = 0; mask < 1 << n; mask++) {
        let st: State = empty;
        let ok = true;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) st = withMove(st, moves[i]);
        for (const id of st.mechs) if (!requiresOk(id, st.mechs)) ok = false;
        if (!ok) continue;
        plans.push(planOf(st, false));
        opts.onProgress?.(mask + 1, 1 << n);
      }
      notes.push(`optimal: all ${plans.length} admissible subsets of ${n} moves evaluated${metric === 'aOp' ? ' (hardware level in closed form, the chosen plan confirmed on the engine)' : ' (hardware level by bisection on the engine)'}`);
    } else {
      // greedy descent on the total effort
      let st = empty;
      let cur = planOf(st, false);
      plans.push(cur);
      for (let guard = 0; guard < moves.length; guard++) {
        let best: { st: State; p: StrategyPlan } | undefined;
        for (const m of moves) {
          if (!usable(st, m)) continue;
          const s2 = withMove(st, m);
          const p = planOf(s2, false);
          plans.push(p);
          const better = (a: StrategyPlan, b: StrategyPlan) => (a.feasible && !b.feasible) || (a.feasible === b.feasible && (a.feasible ? a.effort.total < b.effort.total - 1e-9 : a.derated > b.derated));
          if (better(p, best?.p ?? cur)) best = { st: s2, p };
        }
        if (!best) break;
        st = best.st;
        cur = best.p;
        opts.onProgress?.(guard + 1, moves.length);
      }
      notes.push(`optimal: ${moves.length} moves > ${maxExact}: greedy descent on the total effort (mechanisms + levers + hardware), ${plans.length} plans evaluated`);
    }
    const rank = (a: StrategyPlan, b: StrategyPlan) => (a.feasible === b.feasible ? (a.feasible ? a.effort.total - b.effort.total || b.derated - a.derated : b.derated - a.derated) : a.feasible ? -1 : 1);
    plans.sort(rank);
    const uniq: StrategyPlan[] = [];
    for (const p of plans) if (!uniq.some((q) => keyOf({ mechs: q.mechanisms, levers: q.levers }) === keyOf({ mechs: p.mechanisms, levers: p.levers }))) uniq.push(p);
    // confirm the best few on the engine and keep the cheapest confirmed plan
    const confirmed = uniq.slice(0, 3).map((p) => { const st = { mechs: p.mechanisms, levers: p.levers }; const c = closure(st, true); return { p: { ...p, effort: { ...p.effort, hardware: c.effort, total: effortOf(st) + c.effort }, feasible: c.feasible }, c, st }; });
    confirmed.sort((a, b) => rank(a.p, b.p));
    alternatives = [...confirmed.map((x) => x.p), ...uniq.slice(3, 8)];
    state = confirmed[0]?.st ?? empty;
    hwc = confirmed[0]?.c ?? closure(empty, true);
    for (const id of state.mechs) pushStep('mechanism', id, moves.find((m) => m.kind === 'mechanism' && m.id === id)?.effort ?? 0, { mechs: state.mechs.slice(0, state.mechs.indexOf(id) + 1), levers: [] });
    for (const id of state.levers) pushStep('lever', id, leverList.find((l) => l.id === id)?.effort ?? 0, { mechs: state.mechs, levers: state.levers.slice(0, state.levers.indexOf(id) + 1) });
  }

  // ---- final design ----
  const sc = scenariosOf(state);
  const x = hwc.x;
  const finalNom = Object.keys(x).length ? withHardwareFactors(sc.nom, x) : sc.nom;
  const finalDer = Object.keys(x).length ? withHardwareFactors(sc.der, x) : sc.der;
  const tNom = evalT(finalNom);
  const tDer = derate ? evalT(finalDer) : tNom;
  const feasible = mv(tNom) >= T - 1e-12 && mv(tDer) >= T - 1e-12;
  if (hwc.needed) steps.push({ kind: 'hardware', id: split, effort: hwc.effort, value: mv(tNom), derated: mv(tDer) });
  // hardware rows: points before / after on the derated scenario of the final moves
  const vState = valuesAt(state);
  const unRunOf = (t: TrainingResult) => 1 - t.runningFraction;
  const ptsOf = (t: TrainingResult) => { const sumLP = 3600 * (1 / t.runningFraction - 1); return Object.fromEntries(t.chain.rows.map((r) => [r.id, sumLP > 0 ? (unRunOf(t) * r.ratePerHour * r.meanPauseS) / sumLP : 0])); };
  const before = ptsOf(vState.der);
  const after = ptsOf(tDer);
  const rows: StrategyHardwareRow[] = hw.map((h) => {
    const f = x[h.id] ?? 1;
    return { id: h.id, name: h.name, count: h.count, currentFit: h.fit, allowedFit: h.fit * f, factor: f, floor: h.fixed ? 1 : h.floor, atFloor: !h.fixed && f <= h.floor + 1e-12 && f < 1, effortPerHalving: h.e, effort: f < 1 ? h.e * Math.log2(1 / f) : 0, pointsBefore: before[h.id] ?? 0, pointsAfter: after[h.id] ?? 0, mtbfHours: h.fit * f > 0 ? 1e9 / (h.fit * f) : Infinity };
  });
  // slack: uniform factor on every class at which the target is just met (acceptance limit) when no hardware is needed
  let slackFactor: number | undefined;
  if (!hwc.needed && feasible) {
    const ok = (k: number) => { const xs = Object.fromEntries(hw.map((h) => [h.id, k])); return mv(evalT(withHardwareFactors(sc.nom, xs))) >= T && (!derate || mv(evalT(withHardwareFactors(sc.der, xs))) >= T); };
    let lo = 1, hi = 2;
    while (ok(hi) && hi < 1e4) { lo = hi; hi *= 2; }
    if (hi < 1e4) { for (let i = 0; i < 30; i++) { const mid = Math.sqrt(lo * hi); if (ok(mid)) lo = mid; else hi = mid; } slackFactor = lo; }
    else slackFactor = Infinity;
  }
  const effort = { mechanisms: mechEffort(state), levers: leverEffort(state), hardware: hwc.effort, total: effortOf(state) + hwc.effort };
  let verification: StrategyResult['verification'];
  if (opts.verify && opts.verify.trials > 0) {
    const seed = opts.verify.seed ?? 1;
    const run = buildLedgerRun(finalNom, { trials: opts.verify.trials, seed, target: T });
    const reps = simulateLedgerReplications(run.spec, 0, opts.verify.trials, seed);
    const vals = reps.map((r) => (metric === 'aOp' ? r.operationalAvailability : metric === 'effective' ? r.effective : r.delivered));
    const k = vals.filter((v) => v >= T).length;
    const est = proportionEstimate(k, opts.verify.trials);
    verification = { trials: opts.verify.trials, seed, value: summaryStat(vals), pAtLeastTarget: k / opts.verify.trials, wilson: [est.low, est.high], verdict: proportionVerdict(est, 0.9) };
  }
  if (!feasible) notes.push(hwc.needed ? 'the target is out of reach with these candidates, levers and hardware floors: the result shows the best design found (hardware at its floors where needed)' : 'the target is out of reach with these candidates and levers');
  notes.push(`hardware split ${split}: x_i·c_i = clamp(w_i·L, floor_i·c_i, c_i) with w_i = ${split === 'min-effort' ? 'effort per halving (minimum total log2 effort)' : split === 'agree' ? 'units × importance (AGREE complexity)' : 'current contribution (ARINC, uniform factor)'}; factors act on the interruption FIT only (sub-health and silent-corruption rates stay)`);
  notes.push(derate ? `derating: coverage −${(derate.coverageDelta * 100).toFixed(0)} pt, success −${(derate.successDelta * 100).toFixed(0)} pt, times ×${derate.timeFactor} on every mechanism (the scenario's own and the added ones; a derated detector never below the detection it replaces) and on the levers (the automatic-success lever on its failure probability, ×${derate.timeFactor}); the target must hold nominally and derated` : 'nominal parameters only (no derating)');
  return {
    strategy: opts.strategy, metric, target: T, hardwareSplit: split, derate: derate ?? null, npus: s0.workload.nGpus, feasible,
    baseline: { ...valuesOf(base.nom, metric), derated: mv(base.der) },
    mechanisms: state.mechs, levers: state.levers,
    hardware: { rows, effort: hwc.effort, needed: hwc.needed, atFloors: rows.filter((r) => r.atFloor).map((r) => r.id), slackFactor },
    effort,
    final: { ...valuesOf(tNom, metric), derated: mv(tDer) },
    steps, alternatives, verification, scenario: finalNom, evaluations, notes,
  };
}

/** the strategy at several sizes (the cross-scale tab): one result per size, without the scenarios */
export function strategyAcrossSizes(s: Scenario, sizes: number[], opts: StrategyOptions): (Omit<StrategyResult, 'scenario'> & { npus: number })[] {
  return sizes.map((n, i) => {
    const r = allocateStrategy(withSize(s, n), { ...opts, onProgress: undefined });
    opts.onProgress?.(i + 1, sizes.length);
    const { scenario: _drop, ...rest } = r;
    void _drop;
    return { ...rest, npus: n };
  });
}
