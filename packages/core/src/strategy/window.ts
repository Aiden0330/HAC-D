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
 * Σ_i 2·log2(1/k) over the hardware classes (plan §7 of PLAN_V4).
 * 口径: A_op over the 30-day job window; k multiplies the business-impact interruption FIT of every hardware class.
 */
import type { Scenario } from '../scenario/schema.js';
import { applyMechanisms, stripMechanisms, mechanismById } from '../mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters, type DerateSpec } from '../mechanisms/plan.js';
import { buildLedgerRun, simulateLedgerReplications } from '../mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict, summaryStat, type SummaryStat } from '../math/stats.js';
import { applyLevers, withHardwareFactors, DEFAULT_LEVERS, type LeverId, type RecoveryLever } from './index.js';
import { trainingOf } from '../budget/kpiForm.js';

const aOpOf = (sc: Scenario) => trainingOf(sc).operationalAvailability;

/**
 * every applied mechanism re-applied with derated parameters (HAC-D's derated yardstick). Order when building a derated design by
 * hand: applyMechanisms → deratedOf → applyLevers(levers, derate) → withHardwareFactors — deratedOf strips and re-applies the
 * recorded mechanisms, so applied after the levers it restores the pre-lever recovery block.
 */
export function deratedOf(sc: Scenario, derate: DerateSpec = DERATE_DEFAULT): Scenario {
  const ids = Object.entries(sc.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  const rec = Object.fromEntries(Object.entries(sc.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, derate)]));
  return ids.length ? applyMechanisms(stripMechanisms(sc, ids), ids, rec) : sc;
}

export interface WindowCheck {
  trials: number;
  seed: number;
  value: SummaryStat;
  pAtLeastTarget: number;
  wilson: [number, number];
  verdict: 'supported' | 'uncertain' | 'below';
}
/** window ledger of a nominal design: P(A_op ≥ target) over 30-day windows, supported when the Wilson lower bound ≥ `required` (90 %) */
export function windowCheck(sc: Scenario, target: number, trials = 400, seed = 1, required = 0.9): WindowCheck {
  const run = buildLedgerRun(sc, { trials, seed, target });
  const vals = simulateLedgerReplications(run.spec, 0, trials, seed).map((r) => r.operationalAvailability);
  const k = vals.filter((v) => v >= target).length;
  const est = proportionEstimate(k, trials);
  return { trials, seed, value: summaryStat(vals), pAtLeastTarget: k / trials, wilson: [est.low, est.high], verdict: proportionVerdict(est, required) };
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
  /** required P(A_op ≥ target) per window (default 0.9) */
  required?: number;
  onProgress?: (step: string) => void;
}
export interface WindowRuleTrial { mechanisms: string[]; levers: LeverId[]; kMean: number | null; kPlan: number | null; pAtLeastTarget: number | null; verdict: string | null }
export interface WindowRulePlan {
  mechanisms: string[];
  levers: LeverId[];
  /** the allowed uniform hardware factor (≥ 1: acceptance ceiling; < 1: delivery task) */
  k: number;
  kMean: number;
  kPlan: number;
  /** what fixed k: the mean-value limit or the window check */
  binding: 'window' | 'mean';
  window: WindowCheck;
  windowPlan: WindowCheck | null;
  tried: WindowRuleTrial[];
  escalated: boolean;
  effort: { mechanisms: number; levers: number; hardware: number; total: number };
  /** the final design nominal and derated, and the plan's design (k_plan) nominal and derated */
  nom: Scenario;
  der: Scenario;
  planNom: Scenario;
  planDer: Scenario;
  /** interruption classes the factor k acts on */
  hardwareClasses: string[];
}

/**
 * HAC-D's optimal plan (mechanisms + recovery levers, least effort, target met nominally and derated) that also passes the window
 * check; escalation adds the cheapest unused move — a candidate mechanism or a lever — and re-solves the uniform hardware factor k.
 */
export function recommendPlan(s: Scenario, o: WindowRuleOptions): WindowRulePlan {
  const trials = o.trials ?? 400, seed = o.seed ?? 1, required = o.required ?? 0.9;
  const LEVERS = o.levers ?? DEFAULT_LEVERS;
  const derate = o.derate ?? DERATE_DEFAULT;
  const params = o.parameters ?? {};
  const hw = s.components.filter((c) => c.enabled && c.failure.value > 0).map((c) => c.id);
  const effortOfMechanism = (id: string) => o.efforts?.[id] ?? mechanismById(id).effort;
  const paramsOf = (mechs: string[]) => Object.fromEntries(mechs.map((id) => [id, { ...mechanismById(id).parameters, ...(params[id] ?? {}) }]));
  const design = (mechs: string[], levers: LeverId[], k: number, derated: boolean) => {
    let d = mechs.length ? applyMechanisms(s, mechs, paramsOf(mechs)) : s;
    if (derated) d = deratedOf(d, derate);
    d = applyLevers(d, LEVERS.filter((l) => levers.includes(l.id)), derated ? derate : null);
    return withHardwareFactors(d, Object.fromEntries(hw.map((id) => [id, k])));
  };
  const meets = (mechs: string[], levers: LeverId[], k: number) => aOpOf(design(mechs, levers, k, false)) >= o.target && aOpOf(design(mechs, levers, k, true)) >= o.target;
  const meanLimit = (mechs: string[], levers: LeverId[]) => {
    let lo: number, hi: number;
    if (meets(mechs, levers, 1)) { lo = 1; hi = 2; while (meets(mechs, levers, hi) && hi < 1e4) { lo = hi; hi *= 2; } }
    else { lo = 1e-3; hi = 1; if (!meets(mechs, levers, lo)) return null; }
    for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (meets(mechs, levers, mid)) lo = mid; else hi = mid; }
    return lo;
  };
  const check = (mechs: string[], levers: LeverId[], k: number) => windowCheck(design(mechs, levers, k, false), o.target, trials, seed, required);
  const effortOf = (move: { kind: 'mechanism' | 'lever'; id: string }) => (move.kind === 'mechanism' ? effortOfMechanism(move.id) : LEVERS.find((l) => l.id === move.id)!.effort);
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
      const effort = { mechanisms: mechs.reduce((a, id) => a + effortOfMechanism(id), 0), levers: levers.reduce((a, id) => a + LEVERS.find((l) => l.id === id)!.effort, 0), hardware: k < 1 ? hw.length * 2 * Math.log2(1 / k) : 0 };
      return { mechanisms: mechs, levers, k, kMean, kPlan, binding: k < kMean ? 'window' : 'mean', window: w, windowPlan: wPlan, tried, escalated: tried.length > 1, effort: { ...effort, total: effort.mechanisms + effort.levers + effort.hardware }, nom: design(mechs, levers, k, false), der: design(mechs, levers, k, true), planNom: design(mechs, levers, kPlan, false), planDer: design(mechs, levers, kPlan, true), hardwareClasses: hw };
    }
    const moves = [...o.candidates.filter((id) => !mechs.includes(id) && (mechanismById(id).requires ?? []).every((r) => mechs.includes(r) || Object.keys(s.mechanisms.applied ?? {}).includes(r))).map((id) => ({ kind: 'mechanism' as const, id })), ...LEVERS.filter((l) => !levers.includes(l.id)).map((l) => ({ kind: 'lever' as const, id: l.id }))];
    const next = moves.sort((a, b) => effortOf(a) - effortOf(b) || a.id.localeCompare(b.id))[0];
    if (!next) throw new Error('recommendPlan: no move set meets the target with a supported window check');
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
  binding: 'window' | 'mean';
  window: WindowCheck;
  windowPlan: WindowCheck | null;
  nom: Scenario;
  der: Scenario;
  planNom: Scenario;
  planDer: Scenario;
}
/**
 * The window rule with the recovery levers as the only moves (the reference-mechanism reports): the optimal plan's levers and the
 * mean-value limit k_mean; the plan's design must be supported per window, else the cheapest unused lever is added.
 */
export function recommendLevers(s: Scenario, optimalLevers: LeverId[], target: number, trials = 400, seed = 1, levers: RecoveryLever[] = DEFAULT_LEVERS, derate: DerateSpec = DERATE_DEFAULT, required = 0.9): LeverRuleResult {
  const sDer = deratedOf(s, derate);
  const hw = s.components.filter((c) => c.enabled && c.failure.value > 0).map((c) => c.id);
  const design = (ids: LeverId[], k: number) => {
    const L = levers.filter((l) => ids.includes(l.id));
    const xs = Object.fromEntries(hw.map((id) => [id, k]));
    return { nom: withHardwareFactors(applyLevers(s, L, null), xs), der: withHardwareFactors(applyLevers(sDer, L, derate), xs) };
  };
  const meets = (ids: LeverId[], k: number) => { const d = design(ids, k); return aOpOf(d.nom) >= target && aOpOf(d.der) >= target; };
  const meanLimit = (ids: LeverId[]) => {
    let lo: number, hi: number;
    if (meets(ids, 1)) { lo = 1; hi = 2; while (meets(ids, hi) && hi < 1e4) { lo = hi; hi *= 2; } }
    else { lo = 1e-3; hi = 1; if (!meets(ids, lo)) return null; }
    for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (meets(ids, mid)) lo = mid; else hi = mid; }
    return lo;
  };
  const supported = (ids: LeverId[], k: number) => windowCheck(design(ids, k).nom, target, trials, seed, required);
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
      return { levers: ids, leverEffort: levers.filter((l) => ids.includes(l.id)).reduce((a, l) => a + l.effort, 0), escalated: tried.length > 1, tried, kMean, kPlan, k, binding: k < kMean ? 'window' : 'mean', window: w, windowPlan: wPlan, nom: d.nom, der: d.der, planNom: dPlan.nom, planDer: dPlan.der };
    }
    const next = levers.filter((l) => !ids.includes(l.id)).sort((a, b) => a.effort - b.effort)[0];
    if (!next) throw new Error('recommendLevers: no lever set meets the target with a supported window check');
    ids = [...ids, next.id];
  }
}
