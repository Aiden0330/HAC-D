/**
 * Mechanism planner (docs/ALLOCATION_PRACTICE.md, MODEL_REFERENCE §22.2): choose the fault-management
 * mechanisms that reach a goodput target. Every coalition of the candidate mechanisms is evaluated with the
 * closed forms, nominally and with the mechanism parameters derated for their uncertainty; the cheapest
 * feasible coalition (by effort score) is the plan, the mechanisms present in every feasible coalition are
 * necessary, and the effort–value Pareto front shows the alternatives. A coverage × recovery-time scan
 * (the reference tool's target analysis) and an optional ledger simulation of P(window ≥ target) complete it.
 */
import type { Scenario } from '../scenario/schema.js';
import { evaluateScenario } from '../scenario/evaluate.js';
import { cloneScenario } from '../scenario/analysis.js';
import { simulateScenarioLedger } from '../mc/ledgerFromScenario.js';
import { MECHANISM_LIBRARY, DEFAULT_PLAYERS, mechanismById, applyMechanisms, stripMechanisms, mechanismValues, type AttributionMetric, type MechanismValues } from './index.js';

export interface DerateSpec {
  /** subtracted from coverage-like parameters (detection coverage) */
  coverageDelta: number;
  /** subtracted from success probabilities */
  successDelta: number;
  /** multiplies times (detect, success / failure / recover / sync / save seconds) */
  timeFactor: number;
  /** multiplies the H-RELIABILITY rate reduction */
  reductionFactor: number;
}

export const DERATE_DEFAULT: DerateSpec = { coverageDelta: 0.05, successDelta: 0.08, timeFactor: 1.5, reductionFactor: 0.5 };

/** Worsen a mechanism's target parameters for the second (derated) evaluation; checkpoint compute interval and domain counts are design choices and stay. */
export function derateParameters(p: Record<string, number>, d: DerateSpec = DERATE_DEFAULT): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) {
    const key = k.toLowerCase();
    if (key.includes('coverage')) out[k] = Math.max(0, v - d.coverageDelta);
    else if (key === 'success') out[k] = Math.max(0, v - d.successDelta);
    else if (key === 'reduction') out[k] = v * d.reductionFactor;
    else if (key === 'overhead') out[k] = Math.min(0.99, v * d.timeFactor);
    else if (key === 'recall' || key === 'precision') out[k] = Math.max(0, v - d.successDelta);
    else if (key === 'ratefactor' || key === 'durationfactor') out[k] = Math.min(1, v + d.coverageDelta);
    else if (key === 'share') out[k] = v;
    else if (key === 'loadsavingseconds') out[k] = v / d.timeFactor;
    else if (key === 'computeseconds' || key === 'domains') out[k] = v;
    else if (key.endsWith('seconds')) out[k] = v * d.timeFactor;
    else out[k] = v;
  }
  return out;
}

export interface PlanCoalition {
  ids: string[];
  effort: number;
  value: number;
  derated: number;
  feasible: boolean;
  /** value − target (nominal) */
  margin: number;
}

export interface PlanScanCell {
  coverage: number;
  recoverySeconds: number;
  value: number;
}

export interface PlanVerification {
  trials: number;
  mean: number;
  ci95: number;
  p05: number;
  pAtLeastTarget: number;
  confidence: number;
  passes: boolean;
}

export interface MechanismPlan {
  target: number;
  metric: AttributionMetric;
  players: string[];
  baseline: MechanismValues;
  coalitions: PlanCoalition[];
  feasibleCount: number;
  /** cheapest feasible coalition (ties: larger nominal margin), undefined when none is feasible */
  plan?: PlanCoalition;
  /** mechanisms present in every feasible coalition */
  necessary: string[];
  /** effort–value Pareto front over all coalitions (nominal value) */
  pareto: PlanCoalition[];
  /** the best value reachable with every player on */
  maxValue: number;
  maxDerated: number;
  derate: DerateSpec | null;
  scan?: { coverages: number[]; recoverySeconds: number[]; cells: PlanScanCell[]; basis: string };
  verification?: PlanVerification;
  notes: string[];
}

export interface PlanOptions {
  target?: number;
  players?: string[];
  metric?: AttributionMetric;
  /** parameter overrides per mechanism */
  parameters?: Record<string, Record<string, number>>;
  /** effort overrides per mechanism */
  effort?: Record<string, number>;
  /** derating spec, null to disable */
  derate?: DerateSpec | null;
  /** coverage × recovery-seconds scan on top of the plan; default grid when true */
  scan?: boolean | { coverages: number[]; recoverySeconds: number[] };
  /** ledger simulation of the plan: P(window ≥ target) must be ≥ confidence */
  verify?: { trials: number; seed?: number | string; confidence?: number };
}

function paramsFor(id: string, overrides?: Record<string, Record<string, number>>): Record<string, number> {
  const m = mechanismById(id);
  return { ...m.parameters, ...(overrides?.[id] ?? {}) };
}

export function planToTarget(s: Scenario, opts: PlanOptions = {}): MechanismPlan {
  const metric = opts.metric ?? 'delivered';
  const target = opts.target ?? s.targets.goodput ?? 0.9;
  const ids = (opts.players ?? DEFAULT_PLAYERS).filter((id) => !!mechanismById(id).apply);
  if (ids.length > 10) throw new Error('at most 10 candidate mechanisms (1,024 coalitions)');
  const derate = opts.derate === undefined ? DERATE_DEFAULT : opts.derate;
  const notes: string[] = [];
  const base = stripMechanisms(s, ids);
  const nominalParams: Record<string, Record<string, number>> = {};
  const deratedParams: Record<string, Record<string, number>> = {};
  for (const id of ids) {
    nominalParams[id] = paramsFor(id, opts.parameters);
    deratedParams[id] = derate ? derateParameters(nominalParams[id], derate) : nominalParams[id];
  }
  const effortOf = (id: string) => opts.effort?.[id] ?? mechanismById(id).effort;
  const n = ids.length;
  const total = 1 << n;
  const baseline = mechanismValues(base);
  const coalitions: PlanCoalition[] = [];
  for (let mask = 0; mask < total; mask++) {
    const sel = ids.filter((_, i) => mask & (1 << i));
    const value = mechanismValues(applyMechanisms(base, sel, nominalParams))[metric];
    const derated = derate ? mechanismValues(applyMechanisms(base, sel, deratedParams))[metric] : value;
    const effort = sel.reduce((a, id) => a + effortOf(id), 0);
    coalitions.push({ ids: sel, effort, value, derated, feasible: value >= target && derated >= target, margin: value - target });
  }
  const feasible = coalitions.filter((c) => c.feasible);
  feasible.sort((a, b) => a.effort - b.effort || b.margin - a.margin);
  const plan = feasible[0];
  const necessary = plan ? ids.filter((id) => feasible.every((c) => c.ids.includes(id))) : [];
  // Pareto front: no other coalition has both ≤ effort and ≥ value
  const pareto = coalitions
    .filter((c) => !coalitions.some((o) => o !== c && o.effort <= c.effort && o.value >= c.value && (o.effort < c.effort || o.value > c.value)))
    .sort((a, b) => a.effort - b.effort);
  const all = coalitions[total - 1];
  if (!plan) notes.push(`no coalition of ${ids.join(', ')} reaches ${(target * 100).toFixed(1)} % (best ${(all.value * 100).toFixed(2)} % nominal, ${(all.derated * 100).toFixed(2)} % derated with every player on): raise detection coverage or shorten recovery beyond the library targets (see the scan), or change the hardware / checkpoint parameters`);
  else {
    notes.push(`cheapest feasible set: ${plan.ids.join(' + ') || '(none needed)'} at effort ${plan.effort}: ${(plan.value * 100).toFixed(2)} % nominal, ${(plan.derated * 100).toFixed(2)} % derated vs target ${(target * 100).toFixed(1)} %`);
    if (necessary.length) notes.push(`necessary (in every feasible set): ${necessary.join(', ')}`);
    const rejectedByDerate = coalitions.filter((c) => c.value >= target && c.derated < target);
    if (rejectedByDerate.length) notes.push(`${rejectedByDerate.length} coalition(s) meet the target nominally but not after derating the assumed parameters (coverage −${(derate!.coverageDelta * 100).toFixed(0)} pts, success −${(derate!.successDelta * 100).toFixed(0)} pts, times ×${derate!.timeFactor})`);
  }
  if (derate) notes.push('derating applies to the mechanism parameters of the library (targets and priors in the reference catalog); the scenario\'s own baseline values are not derated');
  const out: MechanismPlan = { target, metric, players: ids, baseline, coalitions, feasibleCount: feasible.length, plan, necessary, pareto, maxValue: all.value, maxDerated: all.derated, derate, notes };
  if (opts.scan) {
    const grid = typeof opts.scan === 'object' ? opts.scan : { coverages: [0.9, 0.95, 0.99, 0.995, 1], recoverySeconds: [180, 120, 60, 30, 0] };
    const planIds = plan ? plan.ids : ids;
    const planned = applyMechanisms(base, planIds, nominalParams);
    const cells: PlanScanCell[] = [];
    const isMixture = planned.recovery.mode === 'mixture';
    for (const q of grid.coverages)
      for (const sec of isMixture ? grid.recoverySeconds : [NaN]) {
        const c = cloneScenario(planned);
        c.sdc = { ...c.sdc, detection: { ...c.sdc.detection, coverage: q } };
        if (isMixture && c.recovery.mode === 'mixture') c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, seconds: sec } };
        cells.push({ coverage: q, recoverySeconds: sec, value: evaluateScenario(c).training![metric === 'delivered' ? 'deliveredGoodput' : metric === 'effective' ? 'effectiveGoodput' : 'operationalAvailability'] });
      }
    out.scan = { coverages: grid.coverages, recoverySeconds: isMixture ? grid.recoverySeconds : [], cells, basis: `${planIds.join(' + ') || 'baseline'}; immediate silent-corruption detection coverage × automatic recovery attempt (s)${isMixture ? '' : ' (recovery axis needs the MTTR mixture)'}` };
  }
  if (opts.verify && plan) {
    const planned = applyMechanisms(base, plan.ids, nominalParams);
    const sim = simulateScenarioLedger(planned, { trials: opts.verify.trials, seed: opts.verify.seed ?? 1, target });
    const confidence = opts.verify.confidence ?? 0.9;
    const p = sim.summary.pAtLeastTarget ?? 0;
    out.verification = { trials: opts.verify.trials, mean: sim.summary.delivered.mean, ci95: sim.summary.delivered.ci95, p05: sim.summary.delivered.p05, pAtLeastTarget: p, confidence, passes: p >= confidence };
    notes.push(`ledger simulation of the plan (${opts.verify.trials} windows): mean ${(sim.summary.delivered.mean * 100).toFixed(2)} % ± ${(sim.summary.delivered.ci95 * 100).toFixed(2)}, P(window ≥ target) ${(p * 100).toFixed(1)} % ${p >= confidence ? '≥' : '<'} ${(confidence * 100).toFixed(0)} % confidence`);
  }
  return out;
}

export { MECHANISM_LIBRARY };
