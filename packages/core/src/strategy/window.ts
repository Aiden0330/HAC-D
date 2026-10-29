/**
 * v5 the window rule of the allocation (docs/ASCEND_ALLOCATION_METHODOLOGY.html formula (6) and the procedure of Figure 1;
 * previously `deratedOf`, `windowCheck`, `recommendDesign`, `recommendPlan` of scripts/scaling-common.ts).
 *
 * A design is accepted when A_op ≥ A* holds in the mean, nominally and with every mechanism derated (HAC-D's derated yardstick:
 * coverage −5 pt, success −8 pt, times ×1.5, rate improvements ×0.5), and when the window ledger (400 × 30-day windows, fixed
 * seed) supports P(A_op ≥ A*) ≥ 90 % by the Wilson lower bound. The hardware moves by one uniform factor k on every interruption
 * class (ARINC): k_mean is the mean-value limit, the root of A_op,der(k) = A* found by bisection on the engine (φ moves with k
 * through the silent-corruption window, so the closed form k = B / Σc_i of Methodology formula (4), with φ at k = 1, is first order
 * and agrees with the root to about 1e-5 relative — golden G5); the plan's design (k_plan = min(k_mean, 1)) must be supported per
 * window, else the cheapest unused move — a candidate mechanism (its library effort) or a recovery lever — is added and the limit
 * re-solved. Where k_mean > 1 (headroom) the allowed factor is the largest k ≤ k_mean that keeps a supported window
 * check (bisection, 14 steps); where k_mean < 1 it is k_mean itself. Effort E = Σ mechanism effort + Σ lever effort +
 * Σ_i e_i·log2(1/x_i) over the hardware classes (plan §7 of PLAN_V4).
 * v5.8 (method & code review 2026-10-29): k is the ARINC level under the classes' constraints, as in the optimal strategy — a fixed
 * class keeps its FIT, an improvement stops at the class's floor (x_i = max(floor_i, k)), the effort is Σ e_i log2(1/x_i) with the
 * class's own effort per halving, and a plan is feasible only if the target holds with every class at its floor (P1-①); the frozen
 * design's window verdict comes from replications the search never drew (trials … 2·trials − 1 of the same seed), the search's own
 * check at the chosen k is kept as `search` (P2-④).
 * 口径: A_op over the 30-day job window; k multiplies the business-impact interruption FIT of every hardware class that is not fixed.
 */
import type { Scenario } from '../scenario/schema.js';
import { applyMechanisms, applyMechanismsInOrder, stripMechanisms, mechanismById } from '../mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters, type DerateSpec } from '../mechanisms/plan.js';
import { buildLedgerRun, simulateLedgerReplications } from '../mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict, summaryStat, minWindowTrials, type SummaryStat } from '../math/stats.js';
import { applyLevers, withHardwareFactors, hardwareClasses, freeClasses, arincFactors, hardwareEffortOf, DEFAULT_LEVERS, type LeverId, type RecoveryLever, type HardwareClass, type StrategyOptions } from './index.js';
import { trainingOf, metricValue, type BudgetMetric } from '../budget/kpiForm.js';

/** the acceptance metric of a design (v5.6: A_op or the effective goodput) */
const valueOf = (sc: Scenario, metric: BudgetMetric) => metricValue(trainingOf(sc), metric);

/** the message of a window check that can never be supported (fewer windows than `minWindowTrials`) */
export const windowTrialsError = (who: string, trials: number, required: number): string => `${who}: ${trials} windows cannot support P(A_op ≥ A*) ≥ ${required} per window — the Wilson 95 % lower bound of an all-passing sample is n/(n + z²) < ${required}; use at least ${minWindowTrials(required)} windows (formula 6)`;

/**
 * every applied mechanism re-applied with derated parameters (HAC-D's derated yardstick), in the design's recorded order of
 * application (v5.5: the twin of a design whose mechanisms were applied in another order than the library's is still that
 * design; not every pair of transforms commutes). Order when building a derated design by hand: applyMechanisms → deratedOf →
 * applyLevers(levers, derate) → withHardwareFactors — deratedOf strips and re-applies the recorded mechanisms, so applied after
 * the levers it restores the pre-lever recovery block.
 */
export function deratedOf(sc: Scenario, derate: DerateSpec = DERATE_DEFAULT): Scenario {
  const ids = Object.entries(sc.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  const rec = Object.fromEntries(Object.entries(sc.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, derate)]));
  return ids.length ? applyMechanismsInOrder(stripMechanisms(sc, ids), ids, rec) : sc;
}

export interface WindowCheck {
  trials: number;
  seed: number;
  /** v5.8 the first replication of the sample (absent = 0): the acceptance of a searched plan draws `trials … 2·trials − 1` */
  from?: number;
  value: SummaryStat;
  pAtLeastTarget: number;
  wilson: [number, number];
  verdict: 'supported' | 'uncertain' | 'below';
}
/** window ledger of a nominal design: P(metric ≥ target) over 30-day windows (A_op, or v5.6 the window's effective goodput), supported when the Wilson lower bound ≥ `required` (90 %); replications `from … from + trials − 1` of the seed */
export function windowCheck(sc: Scenario, target: number, trials = 400, seed = 1, required = 0.9, metric: BudgetMetric = 'aOp', from = 0): WindowCheck {
  const run = buildLedgerRun(sc, { trials, seed, target });
  const vals = simulateLedgerReplications(run.spec, from, trials, seed).map((r) => (metric === 'aOp' ? r.operationalAvailability : r.effective));
  const k = vals.filter((v) => v >= target).length;
  const est = proportionEstimate(k, trials);
  return { trials, seed, ...(from ? { from } : {}), value: summaryStat(vals), pAtLeastTarget: k / trials, wilson: [est.low, est.high], verdict: proportionVerdict(est, required) };
}

/**
 * v5.8 the hardware side of the window rule: the classes with their constraints, the factors at a level k (fixed classes kept, floors
 * respected), the lowest level that still moves a class (every free class at its floor) and the "perfect hardware" factors of the ceiling
 * (every free class → 10⁻³ of today, the fixed classes kept)
 */
function hardwareSide(s: Scenario, o: Pick<StrategyOptions, 'constraints' | 'defaultFloor' | 'defaultEffortPerHalving'>) {
  const classes = hardwareClasses(s, o);
  const free = freeClasses(classes);
  return {
    classes, free,
    factorsAt: (k: number) => arincFactors(classes, k),
    kFloor: free.length ? Math.max(1e-3, Math.min(...free.map((h) => h.floor))) : 1,
    perfect: Object.fromEntries(classes.map((h) => [h.id, free.includes(h) ? 1e-3 : 1])) as Record<string, number>,
  };
}
/** the mean-value limit of a design family by bisection on k: ≥ 1 an acceptance ceiling, < 1 an improvement down to the floors; null when even the floors miss the target */
function meanLimitOf(meets: (k: number) => boolean, free: HardwareClass[], kFloor: number): number | null {
  if (!free.length) return meets(1) ? 1 : null;
  let lo: number, hi: number;
  if (meets(1)) { lo = 1; hi = 2; while (meets(hi) && hi < 1e4) { lo = hi; hi *= 2; } }
  else { lo = kFloor; hi = 1; if (!meets(lo)) return null; }
  for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (meets(mid)) lo = mid; else hi = mid; }
  return lo;
}

export interface WindowRuleOptions {
  target: number;
  /** mechanism candidates the plan may add (library ids) and their parameter overrides */
  candidates: string[];
  parameters?: Record<string, Record<string, number>>;
  /** effort overrides by mechanism id (default: library effort) */
  efforts?: Record<string, number>;
  /** the optimal strategy's plan to start from */
  mechanisms: string[];
  leverIds: LeverId[];
  /** recovery levers available (default DEFAULT_LEVERS) */
  levers?: RecoveryLever[];
  derate?: DerateSpec;
  trials?: number;
  seed?: number;
  /** required P(metric ≥ target) per window (default 0.9) */
  required?: number;
  /** v5.6 the acceptance metric (default A_op) */
  metric?: BudgetMetric;
  /**
   * v5.6 when no move set meets the target even with every candidate and lever: throw (default), or return the all-moves design at
   * k = 1 with `feasible` false and the `ceiling` the metric reaches with perfect hardware (k → 0) — the report prints the gap
   */
  onInfeasible?: 'throw' | 'best';
  /** v5.8 class constraints over the components' own `allocation` fields (as in allocateStrategy) */
  constraints?: StrategyOptions['constraints'];
  defaultFloor?: number;
  defaultEffortPerHalving?: number;
  onProgress?: (step: string) => void;
}
export interface WindowRuleTrial { mechanisms: string[]; levers: LeverId[]; kMean: number | null; kPlan: number | null; pAtLeastTarget: number | null; verdict: string | null }
export interface WindowRulePlan {
  mechanisms: string[];
  levers: LeverId[];
  /** the allowed uniform hardware factor (≥ 1: acceptance ceiling; < 1: delivery task); 1 when not feasible */
  k: number;
  /** v5.8 the factor of each hardware class at k under its constraints: fixed classes 1, an improvement stopped at the class's floor */
  factors: Record<string, number>;
  /** the mean-value limit and the plan's factor; null when no factor meets the target (not feasible) */
  kMean: number | null;
  kPlan: number | null;
  /** what fixed k: the mean-value limit or the window check; 'none' when not feasible */
  binding: 'window' | 'mean' | 'none';
  /** v5.6 false when no move set meets the target (then every move is on, k = 1, and `ceiling` holds the metric at k → 0) */
  feasible: boolean;
  /**
   * v5.8 why no move set meets the target (absent when feasible): 'ceiling' — not even perfect hardware (k → 0) reaches it; 'constraints'
   * — perfect hardware would, the classes' floors and fixed classes do not (`ceiling.constrained` is the metric with every class at its
   * floor); 'window' — the mean is reachable but no design passes the window check
   */
  cause?: 'ceiling' | 'constraints' | 'window';
  ceiling: { nominal: number; derated: number; constrained?: { nominal: number; derated: number } } | null;
  /** v5.8 a feasible plan: the acceptance check of the frozen design on replications the search never drew; else the check of the all-moves design */
  window: WindowCheck;
  /** v5.8 a feasible plan: the search's own check at the chosen k (the sample that selected it) */
  search?: WindowCheck;
  windowPlan: WindowCheck | null;
  tried: WindowRuleTrial[];
  escalated: boolean;
  effort: { mechanisms: number; levers: number; hardware: number; total: number };
  /** the final design nominal and derated, and the plan's design (k_plan) nominal and derated */
  nom: Scenario;
  der: Scenario;
  planNom: Scenario;
  planDer: Scenario;
  /** interruption classes the factor k acts on (v5.8: the classes that are not fixed and whose floor is below 1) */
  hardwareClasses: string[];
  /** v5.8 classes kept at today's FIT (fixed, or a floor of 1) */
  fixedClasses: string[];
}

/**
 * HAC-D's optimal plan (mechanisms + recovery levers, least effort, target met nominally and derated) that also passes the window
 * check; escalation adds the cheapest unused move — a candidate mechanism or a lever — and re-solves the uniform hardware factor k.
 */
export function recommendPlan(s: Scenario, o: WindowRuleOptions): WindowRulePlan {
  const trials = o.trials ?? 400, seed = o.seed ?? 1, required = o.required ?? 0.9, metric = o.metric ?? 'aOp';
  if (trials < minWindowTrials(required)) throw new Error(windowTrialsError('recommendPlan', trials, required));
  const LEVERS = o.levers ?? DEFAULT_LEVERS;
  const derate = o.derate ?? DERATE_DEFAULT;
  const params = o.parameters ?? {};
  const H = hardwareSide(s, o);
  const effortOfMechanism = (id: string) => o.efforts?.[id] ?? mechanismById(id).effort;
  const paramsOf = (mechs: string[]) => Object.fromEntries(mechs.map((id) => [id, { ...mechanismById(id).parameters, ...(params[id] ?? {}) }]));
  const designAt = (mechs: string[], levers: LeverId[], x: Record<string, number>, derated: boolean) => {
    let d = mechs.length ? applyMechanisms(s, mechs, paramsOf(mechs)) : s;
    if (derated) d = deratedOf(d, derate);
    d = applyLevers(d, LEVERS.filter((l) => levers.includes(l.id)), derated ? derate : null);
    return withHardwareFactors(d, x);
  };
  const design = (mechs: string[], levers: LeverId[], k: number, derated: boolean) => designAt(mechs, levers, H.factorsAt(k), derated);
  const meetsX = (mechs: string[], levers: LeverId[], x: Record<string, number>) => valueOf(designAt(mechs, levers, x, false), metric) >= o.target && valueOf(designAt(mechs, levers, x, true), metric) >= o.target;
  const meets = (mechs: string[], levers: LeverId[], k: number) => meetsX(mechs, levers, H.factorsAt(k));
  const meanLimit = (mechs: string[], levers: LeverId[]) => meanLimitOf((k) => meets(mechs, levers, k), H.free, H.kFloor);
  const check = (mechs: string[], levers: LeverId[], k: number, from = 0) => windowCheck(design(mechs, levers, k, false), o.target, trials, seed, required, metric, from);
  const effortOf = (move: { kind: 'mechanism' | 'lever'; id: string }) => (move.kind === 'mechanism' ? effortOfMechanism(move.id) : LEVERS.find((l) => l.id === move.id)!.effort);
  const sides = { hardwareClasses: H.free.map((h) => h.id), fixedClasses: H.classes.filter((h) => !H.free.includes(h)).map((h) => h.id) };
  let mechs = [...o.mechanisms], levers: LeverId[] = [...o.leverIds];
  const tried: WindowRuleTrial[] = [];
  for (;;) {
    o.onProgress?.(`mean limit: ${mechs.join('+') || '—'} | ${levers.join('+') || '—'}`);
    const kMean = meanLimit(mechs, levers);
    const kPlan = kMean === null ? null : Math.min(kMean, 1);
    const wPlan = kPlan === null ? null : check(mechs, levers, kPlan);
    tried.push({ mechanisms: [...mechs], levers: [...levers], kMean, kPlan, pAtLeastTarget: wPlan?.pAtLeastTarget ?? null, verdict: wPlan?.verdict ?? null });
    if (kMean !== null && kPlan !== null && wPlan?.verdict === 'supported') {
      let k = kMean, w = kMean > 1 ? check(mechs, levers, kMean) : wPlan;
      if (w.verdict !== 'supported') {
        let lo = 1, hi = kMean;
        for (let i = 0; i < 14; i++) { const mid = Math.sqrt(lo * hi); if (check(mechs, levers, mid).verdict === 'supported') lo = mid; else hi = mid; }
        k = lo; w = check(mechs, levers, k);
      }
      // v5.8 (P2-④) the design is frozen here; its verdict comes from the next `trials` replications, which no check of the search drew
      const acceptance = check(mechs, levers, k, trials);
      const factors = H.factorsAt(k);
      const effort = { mechanisms: mechs.reduce((a, id) => a + effortOfMechanism(id), 0), levers: levers.reduce((a, id) => a + LEVERS.find((l) => l.id === id)!.effort, 0), hardware: hardwareEffortOf(H.classes, factors) };
      return { mechanisms: mechs, levers, k, factors, kMean, kPlan, binding: k < kMean ? 'window' : 'mean', feasible: true, ceiling: null, window: acceptance, search: w, windowPlan: wPlan, tried, escalated: tried.length > 1, effort: { ...effort, total: effort.mechanisms + effort.levers + effort.hardware }, nom: design(mechs, levers, k, false), der: design(mechs, levers, k, true), planNom: design(mechs, levers, kPlan, false), planDer: design(mechs, levers, kPlan, true), ...sides };
    }
    const moves = [...o.candidates.filter((id) => !mechs.includes(id) && (mechanismById(id).requires ?? []).every((r) => mechs.includes(r) || Object.keys(s.mechanisms.applied ?? {}).includes(r))).map((id) => ({ kind: 'mechanism' as const, id })), ...LEVERS.filter((l) => !levers.includes(l.id)).map((l) => ({ kind: 'lever' as const, id: l.id }))];
    const next = moves.sort((a, b) => effortOf(a) - effortOf(b) || a.id.localeCompare(b.id))[0];
    if (!next) {
      if (o.onInfeasible !== 'best') throw new Error('recommendPlan: no move set meets the target with a supported window check');
      // v5.6 every eligible candidate and every lever is on and still no factor meets the target: the all-moves design at k = 1, the
      // ceiling with perfect hardware (k → 0 on every class that is not fixed: the non-hardware losses alone), the window check of that
      // design (a description, not an acceptance: the design is reported as not feasible)
      o.onProgress?.(`not feasible: ${mechs.join('+') || '—'} | ${levers.join('+') || '—'} at k = 1`);
      const w = check(mechs, levers, 1);
      const effort = { mechanisms: mechs.reduce((a, id) => a + effortOfMechanism(id), 0), levers: levers.reduce((a, id) => a + LEVERS.find((l) => l.id === id)!.effort, 0), hardware: 0 };
      const ceiling = { nominal: valueOf(designAt(mechs, levers, H.perfect, false), metric), derated: valueOf(designAt(mechs, levers, H.perfect, true), metric) };
      // v5.8 the cause: perfect hardware short of the target, the constraints (every class at its floor) short of it, or the window check
      const perfectMeets = ceiling.nominal >= o.target && ceiling.derated >= o.target;
      const atFloors = meets(mechs, levers, H.kFloor);
      const cause: WindowRulePlan['cause'] = !perfectMeets ? 'ceiling' : !atFloors ? 'constraints' : 'window';
      const constrained = cause === 'constraints' ? { nominal: valueOf(design(mechs, levers, H.kFloor, false), metric), derated: valueOf(design(mechs, levers, H.kFloor, true), metric) } : undefined;
      return { mechanisms: mechs, levers, k: 1, factors: H.factorsAt(1), kMean: null, kPlan: null, binding: 'none', feasible: false, cause, ceiling: constrained ? { ...ceiling, constrained } : ceiling, window: w, windowPlan: null, tried, escalated: tried.length > 1, effort: { ...effort, total: effort.mechanisms + effort.levers }, nom: design(mechs, levers, 1, false), der: design(mechs, levers, 1, true), planNom: design(mechs, levers, 1, false), planDer: design(mechs, levers, 1, true), ...sides };
    }
    if (next.kind === 'mechanism') mechs = [...mechs, next.id]; else levers = [...levers, next.id as LeverId];
  }
}

export interface LeverRuleResult {
  levers: LeverId[];
  leverEffort: number;
  escalated: boolean;
  tried: { levers: LeverId[]; kMean: number | null; kPlan: number | null; pAtLeastTarget: number | null; verdict: string | null }[];
  kMean: number;
  kPlan: number;
  k: number;
  /** v5.8 the factor of each hardware class at k under its constraints */
  factors: Record<string, number>;
  binding: 'window' | 'mean';
  /** v5.8 the acceptance check of the frozen design on replications the search never drew; `search` the search's own check at k */
  window: WindowCheck;
  search: WindowCheck;
  windowPlan: WindowCheck | null;
  nom: Scenario;
  der: Scenario;
  planNom: Scenario;
  planDer: Scenario;
}
/**
 * The window rule with the recovery levers as the only moves (the reference-mechanism reports): the optimal plan's levers and the
 * mean-value limit k_mean; the plan's design must be supported per window, else the cheapest unused lever is added. v5.8: the classes'
 * constraints and the independent acceptance sample as in `recommendPlan`.
 */
export function recommendLevers(s: Scenario, optimalLevers: LeverId[], target: number, trials = 400, seed = 1, levers: RecoveryLever[] = DEFAULT_LEVERS, derate: DerateSpec = DERATE_DEFAULT, required = 0.9, metric: BudgetMetric = 'aOp', constraints: Pick<StrategyOptions, 'constraints' | 'defaultFloor' | 'defaultEffortPerHalving'> = {}): LeverRuleResult {
  if (trials < minWindowTrials(required)) throw new Error(windowTrialsError('recommendLevers', trials, required));
  const sDer = deratedOf(s, derate);
  const H = hardwareSide(s, constraints);
  const design = (ids: LeverId[], k: number) => {
    const L = levers.filter((l) => ids.includes(l.id));
    const xs = H.factorsAt(k);
    return { nom: withHardwareFactors(applyLevers(s, L, null), xs), der: withHardwareFactors(applyLevers(sDer, L, derate), xs) };
  };
  const meets = (ids: LeverId[], k: number) => { const d = design(ids, k); return valueOf(d.nom, metric) >= target && valueOf(d.der, metric) >= target; };
  const meanLimit = (ids: LeverId[]) => meanLimitOf((k) => meets(ids, k), H.free, H.kFloor);
  const supported = (ids: LeverId[], k: number, from = 0) => windowCheck(design(ids, k).nom, target, trials, seed, required, metric, from);
  const tried: LeverRuleResult['tried'] = [];
  let ids: LeverId[] = [...optimalLevers];
  for (;;) {
    const kMean = meanLimit(ids);
    const kPlan = kMean === null ? null : Math.min(kMean, 1);
    const wPlan = kPlan === null ? null : supported(ids, kPlan);
    tried.push({ levers: [...ids], kMean, kPlan, pAtLeastTarget: wPlan?.pAtLeastTarget ?? null, verdict: wPlan?.verdict ?? null });
    if (kMean !== null && kPlan !== null && wPlan?.verdict === 'supported') {
      let k = kMean, w = kMean > 1 ? supported(ids, kMean) : wPlan;
      if (w.verdict !== 'supported') {
        let lo = 1, hi = kMean;
        for (let i = 0; i < 14; i++) { const mid = Math.sqrt(lo * hi); if (supported(ids, mid).verdict === 'supported') lo = mid; else hi = mid; }
        k = lo; w = supported(ids, k);
      }
      const d = design(ids, k), dPlan = design(ids, kPlan);
      return { levers: ids, leverEffort: levers.filter((l) => ids.includes(l.id)).reduce((a, l) => a + l.effort, 0), escalated: tried.length > 1, tried, kMean, kPlan, k, factors: H.factorsAt(k), binding: k < kMean ? 'window' : 'mean', window: supported(ids, k, trials), search: w, windowPlan: wPlan, nom: d.nom, der: d.der, planNom: dPlan.nom, planDer: dPlan.der };
    }
    const next = levers.filter((l) => !ids.includes(l.id)).sort((a, b) => a.effort - b.effort)[0];
    if (!next) throw new Error('recommendLevers: no lever set meets the target with a supported window check');
    ids = [...ids, next.id];
  }
}
