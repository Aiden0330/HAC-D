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
import { buildLedgerRun, finishLedgerRun, simulateLedgerReplications, summarizeLedger, type LedgerReplication } from '../mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict } from '../math/stats.js';
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

/**
 * Worsen a mechanism's target parameters for the second (derated) evaluation. Capabilities move towards no effect: coverage,
 * detection targets and shares (eligible share, risk share) lose `coverageDelta`, success / recall / precision lose
 * `successDelta`, times and overheads grow by `timeFactor`, the manual-fallback probability and the fabric-degrade exposure
 * get worse, reductions and compression ratios shrink. Design choices (checkpoint compute interval, domain count, the lemon
 * population share) and "before" reference values stay.
 */
export function derateParameters(p: Record<string, number>, d: DerateSpec = DERATE_DEFAULT): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) {
    const key = k.toLowerCase();
    if (key.includes('coverage') || key.includes('detection') || key === 'eligibleshare' || key === 'riskshare') out[k] = Math.max(0, v - d.coverageDelta);
    else if (key === 'success') out[k] = Math.max(0, v - d.successDelta);
    else if (key === 'reduction' || key === 'occurrencereduction') out[k] = v * d.reductionFactor;
    else if (key === 'overhead') out[k] = Math.min(0.99, v * d.timeFactor);
    else if (key === 'recall' || key === 'precision') out[k] = Math.max(0, v - d.successDelta);
    else if (key === 'ratefactor' || key === 'durationfactor') out[k] = Math.min(1, v + d.coverageDelta);
    else if (key === 'manualprobabilitytarget') out[k] = Math.min(1, v * d.timeFactor);
    else if (key === 'compressionratio') out[k] = Math.max(1, 1 + (v - 1) / d.timeFactor);
    else if (key === 'exposedcommunicationfraction') out[k] = Math.min(1, v + d.coverageDelta);
    else if (key === 'remainingbandwidthratio') out[k] = Math.max(0.01, v - d.coverageDelta);
    else if (key === 'share') out[k] = v;
    else if (key === 'loadsavingseconds') out[k] = v / d.timeFactor;
    else if (key === 'computeseconds' || key === 'domains' || key.endsWith('beforeseconds')) out[k] = v;
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
  /** v3.5 no-fault upper bound of the value with this coalition's checkpoint settings (finite window); 1 for A_op */
  bound: number;
}

/**
 * v3.5 checkpoint bounds (docs/MODEL_REFERENCE.md §22.2): without any fault the window still pays the saves, so goodput
 * ≤ (⌊S/L⌋τ + min(S mod L, τ))/S over a window of S seconds (L = τ + δ), and ≤ τ/L in the long run (the duty cycle). In
 * HAC-D's models step recovery never skips a save, so the bound holds for every mechanism set with these settings.
 */
export function checkpointBounds(tauS: number, deltaS: number, horizonH: number): { dutyCycle: number; finiteWindow: number } {
  const L = tauS + deltaS;
  if (!(L > 0) || !(tauS > 0)) return { dutyCycle: 1, finiteWindow: 1 };
  const S = horizonH * 3600;
  if (!(S > 0)) return { dutyCycle: tauS / L, finiteWindow: tauS / L };
  const full = Math.floor(S / L);
  return { dutyCycle: tauS / L, finiteWindow: (full * tauS + Math.min(S - full * L, tauS)) / S };
}

export interface PlanScanCell {
  coverage: number;
  recoverySeconds: number;
  value: number;
}

export interface PlanVerification {
  trials: number;
  mean: number;
  /** Student-t 95 % half-width of the mean */
  ci95: number;
  p05: number;
  pAtLeastTarget: number;
  /** v3.5 Wilson 95 % bounds of P(window ≥ target) */
  pLow: number;
  pHigh: number;
  confidence: number;
  /** point estimate ≥ confidence */
  passes: boolean;
  /** supported: the Wilson lower bound reaches the confidence; below: the upper bound misses it; uncertain: more windows needed */
  verdict: 'supported' | 'uncertain' | 'below';
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
  /** v3.5 no-fault bounds of the best checkpoint settings among the coalitions: a target above the finite-window bound is proven infeasible */
  bounds: { bestIds: string[]; dutyCycle: number; finiteWindow: number; provenInfeasible: boolean };
  derate: DerateSpec | null;
  scan?: { coverages: number[]; recoverySeconds: number[]; cells: PlanScanCell[]; basis: string };
  verification?: PlanVerification;
  notes: string[];
}

export type PlanPhase = 'coalitions' | 'scan' | 'verify';

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
  /** progress per phase: coalitions evaluated (nominal + derated count as one), scan cells, ledger windows */
  onProgress?: (done: number, total: number, phase: PlanPhase) => void;
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
  const step = Math.max(1, Math.floor(total / 64));
  for (let mask = 0; mask < total; mask++) {
    const sel = ids.filter((_, i) => mask & (1 << i));
    const nominal = mechanismValues(applyMechanisms(base, sel, nominalParams));
    const value = nominal[metric];
    const derated = derate ? mechanismValues(applyMechanisms(base, sel, deratedParams))[metric] : value;
    const effort = sel.reduce((a, id) => a + effortOf(id), 0);
    const bound = metric === 'aOp' ? 1 : checkpointBounds(nominal.tauS, nominal.deltaS, nominal.horizonH).finiteWindow;
    coalitions.push({ ids: sel, effort, value, derated, feasible: value >= target && derated >= target, margin: value - target, bound });
    if (opts.onProgress && ((mask + 1) % step === 0 || mask + 1 === total)) opts.onProgress(mask + 1, total, 'coalitions');
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
  // no-fault bounds: the coalition with the best checkpoint settings caps what any mechanism set can deliver
  const bestBound = coalitions.reduce((a, c) => (c.bound > a.bound ? c : a), coalitions[0]);
  const bestNominal = mechanismValues(applyMechanisms(base, bestBound.ids, nominalParams));
  const bb = metric === 'aOp' ? { dutyCycle: 1, finiteWindow: 1 } : checkpointBounds(bestNominal.tauS, bestNominal.deltaS, bestNominal.horizonH);
  const provenInfeasible = target > bb.finiteWindow + 1e-12;
  const bounds = { bestIds: bestBound.ids, dutyCycle: bb.dutyCycle, finiteWindow: bb.finiteWindow, provenInfeasible };
  if (provenInfeasible) notes.push(`proven infeasible: even without any fault the checkpoint saves cap the window at ${(bb.finiteWindow * 100).toFixed(3)} % (duty cycle τ/(τ+δ) = ${(bb.dutyCycle * 100).toFixed(3)} % with the best checkpoint settings, ${bestBound.ids.join(' + ') || 'baseline'}); the target ${(target * 100).toFixed(2)} % needs a longer interval or a shorter save (C-FAST, C-MEM, a different checkpoint design) before any fault-management mechanism can help`);
  if (!plan) notes.push(`no coalition of ${ids.join(', ')} reaches ${(target * 100).toFixed(1)} % (best ${(all.value * 100).toFixed(2)} % nominal, ${(all.derated * 100).toFixed(2)} % derated with every player on)${provenInfeasible ? '' : ': not a proof of infeasibility (no-fault bound ' + (bb.finiteWindow * 100).toFixed(2) + ' %); raise detection coverage or shorten recovery beyond the library targets (see the scan), or change the hardware / checkpoint parameters'}`);
  else {
    notes.push(`cheapest feasible set: ${plan.ids.join(' + ') || '(none needed)'} at effort ${plan.effort}: ${(plan.value * 100).toFixed(2)} % nominal, ${(plan.derated * 100).toFixed(2)} % derated vs target ${(target * 100).toFixed(1)} %`);
    if (necessary.length) notes.push(`necessary (in every feasible set): ${necessary.join(', ')}`);
    const rejectedByDerate = coalitions.filter((c) => c.value >= target && c.derated < target);
    if (rejectedByDerate.length) notes.push(`${rejectedByDerate.length} coalition(s) meet the target nominally but not after derating the assumed parameters (coverage, detection targets and shares −${(derate!.coverageDelta * 100).toFixed(0)} pts, success −${(derate!.successDelta * 100).toFixed(0)} pts, times ×${derate!.timeFactor}, reductions ×${derate!.reductionFactor})`);
  }
  if (derate) notes.push('derating applies to the mechanism parameters of the library (targets and priors in the reference catalog); the scenario\'s own baseline values are not derated');
  const out: MechanismPlan = { target, metric, players: ids, baseline, coalitions, feasibleCount: feasible.length, plan, necessary, pareto, maxValue: all.value, maxDerated: all.derated, bounds, derate, notes };
  if (opts.scan) {
    const grid = typeof opts.scan === 'object' ? opts.scan : { coverages: [0.9, 0.95, 0.99, 0.995, 1], recoverySeconds: [180, 120, 60, 30, 0] };
    const planIds = plan ? plan.ids : ids;
    const planned = applyMechanisms(base, planIds, nominalParams);
    const cells: PlanScanCell[] = [];
    const isMixture = planned.recovery.mode === 'mixture';
    const scanTotal = grid.coverages.length * (isMixture ? grid.recoverySeconds.length : 1);
    for (const q of grid.coverages)
      for (const sec of isMixture ? grid.recoverySeconds : [NaN]) {
        const c = cloneScenario(planned);
        c.sdc = { ...c.sdc, detection: { ...c.sdc.detection, coverage: q } };
        if (isMixture && c.recovery.mode === 'mixture') c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, seconds: sec } };
        // v5.7 the goodputs on the exact renewal model, as `mechanismValues` (the plan's own values) reads them
        cells.push({ coverage: q, recoverySeconds: sec, value: evaluateScenario(c, { structure: false }).training![metric === 'delivered' ? 'deliveredGoodputExact' : metric === 'effective' ? 'effectiveGoodputExact' : 'operationalAvailability'] });
        opts.onProgress?.(cells.length, scanTotal, 'scan');
      }
    out.scan = { coverages: grid.coverages, recoverySeconds: isMixture ? grid.recoverySeconds : [], cells, basis: `${planIds.join(' + ') || 'baseline'}; immediate silent-corruption detection coverage × automatic recovery attempt (s)${isMixture ? '' : ' (recovery axis needs the MTTR mixture)'}` };
  }
  if (opts.verify && plan) {
    const planned = applyMechanisms(base, plan.ids, nominalParams);
    const run = buildLedgerRun(planned, { trials: opts.verify.trials, seed: opts.verify.seed ?? 1, target });
    const rows: LedgerReplication[] = [];
    const chunk = Math.max(1, Math.min(25, Math.ceil(run.trials / 20)));
    for (let from = 0; from < run.trials; from += chunk) {
      const n = Math.min(chunk, run.trials - from);
      rows.push(...simulateLedgerReplications(run.spec, from, n, run.seed));
      opts.onProgress?.(rows.length, run.trials, 'verify');
    }
    const sim = finishLedgerRun(run, summarizeLedger(rows, run.seed, run.target));
    const confidence = opts.verify.confidence ?? 0.9;
    const p = sim.summary.pAtLeastTarget ?? 0;
    const est = sim.summary.pAtLeastTargetInterval ?? proportionEstimate(Math.round(p * opts.verify.trials), opts.verify.trials);
    const verdict = proportionVerdict(est, confidence);
    out.verification = { trials: opts.verify.trials, mean: sim.summary.delivered.mean, ci95: sim.summary.delivered.ci95, p05: sim.summary.delivered.p05, pAtLeastTarget: p, pLow: est.low, pHigh: est.high, confidence, passes: p >= confidence, verdict };
    notes.push(`ledger simulation of the plan (${opts.verify.trials} windows): mean ${(sim.summary.delivered.mean * 100).toFixed(2)} % ± ${(sim.summary.delivered.ci95 * 100).toFixed(2)} (Student-t), P(window ≥ target) ${(p * 100).toFixed(1)} % [Wilson ${(est.low * 100).toFixed(1)}–${(est.high * 100).toFixed(1)} %] vs ${(confidence * 100).toFixed(0)} % confidence: ${verdict}${verdict === 'uncertain' ? ' (more windows needed to decide)' : ''}`);
  }
  return out;
}

export { MECHANISM_LIBRARY };
