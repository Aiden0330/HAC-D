/**
 * v2 repairable-unit models (docs/MODEL_REFERENCE.md §10–§14):
 * dual-path repair (automatic vs manual), k-of-n groups with dual repair and imperfect
 * switchover, and sub-health (亚健康) units with strict / tolerant / performance-weighted measures.
 * Rates per hour, times in hours unless the name says seconds.
 */
import { Ctmc, birthDeathSteadyState, kOfNRepairable, type CtmcState, type Transition } from './index.js';

/* ---------------------------------------------------------------------- */
/* Repair paths                                                             */
/* ---------------------------------------------------------------------- */

export interface DualRepair {
  /** share of failures that take the automatic path first (自动恢复覆盖率) */
  coverage: number;
  /** probability that the automatic attempt succeeds; otherwise it escalates to the manual path */
  successProbability: number;
  /** mean automatic recovery time, hours */
  autoMttrH: number;
  /** mean manual repair time, hours (人工修复) */
  manualMttrH: number;
}

/** Legacy single-MTTR input: everything goes through the manual path. */
export function manualOnly(mttrH: number): DualRepair {
  return { coverage: 0, successProbability: 1, autoMttrH: 0, manualMttrH: mttrH };
}

export function isDual(r: DualRepair | undefined): boolean {
  return !!r && r.coverage > 0;
}

/** E[R] = c·T_a + (1 − c·s)·T_m */
export function meanRepairH(r: DualRepair): number {
  return r.coverage * r.autoMttrH + (1 - r.coverage * r.successProbability) * r.manualMttrH;
}

/** Share of failures that reach a person: 1 − c·s */
export function humanFraction(r: DualRepair): number {
  return 1 - r.coverage * r.successProbability;
}

/** Share of the unit's downtime spent on the automatic path: c·T_a / E[R] */
export function autoDowntimeShare(r: DualRepair): number {
  const m = meanRepairH(r);
  return m > 0 ? (r.coverage * r.autoMttrH) / m : 0;
}

/** instantaneous recoveries are clamped to 3.6 ms to keep the generator finite */
const MIN_T = 1e-6;

export interface DualRepairUnitResult {
  availability: number;
  failureFrequency: number;
  meanRepairH: number;
  piUp: number;
  piDownAuto: number;
  piDownManual: number;
  autoDowntimeShare: number;
  humanFraction: number;
}

/** Single unit with two repair paths (§10): U → D_a (λc) / D_m (λ(1−c)); D_a → U (s/T_a) / D_m ((1−s)/T_a); D_m → U (1/T_m). */
export function dualRepairUnit(lambda: number, r: DualRepair): DualRepairUnitResult {
  const Ta = Math.max(r.autoMttrH, MIN_T);
  const Tm = Math.max(r.manualMttrH, MIN_T);
  const c = r.coverage;
  const s = r.successProbability;
  const states: CtmcState[] = [
    { id: 'up', up: true, capacity: 1 },
    { id: 'down_manual', up: false, capacity: 0 },
  ];
  const tr: Transition[] = [
    { from: 0, to: 1, rate: lambda * (1 - c) },
    { from: 1, to: 0, rate: 1 / Tm },
  ];
  if (c > 0) {
    states.push({ id: 'down_auto', up: false, capacity: 0 });
    tr.push({ from: 0, to: 2, rate: lambda * c }, { from: 2, to: 0, rate: s / Ta }, { from: 2, to: 1, rate: (1 - s) / Ta });
  }
  const chain = new Ctmc(states, tr);
  const pi = chain.steadyState();
  const piDa = c > 0 ? pi[2] : 0;
  const down = pi[1] + piDa;
  return {
    availability: pi[0],
    failureFrequency: chain.failureFrequency(pi),
    meanRepairH: meanRepairH(r),
    piUp: pi[0],
    piDownAuto: piDa,
    piDownManual: pi[1],
    autoDowntimeShare: down > 0 ? piDa / down : autoDowntimeShare(r),
    humanFraction: humanFraction(r),
  };
}

/* ---------------------------------------------------------------------- */
/* k-of-n with dual repair and switchover                                   */
/* ---------------------------------------------------------------------- */

export interface Switchover {
  /** probability that the group keeps running after an active-unit failure (倒换成功率) */
  successProbability: number;
  /** outage of a successful switchover, seconds (counted first order) */
  outageS?: number;
  /** time to clear a failed switchover (manual), hours; default = manual MTTR of the unit */
  failureRecoveryHours?: number;
}

export type CapacityMode = 'binary' | 'proportional' | 'fractional';

export interface KofNGroupOptions {
  n: number;
  k: number;
  /** per-unit failure rate */
  lambda: number;
  repair: DualRepair;
  /** manual repair crews (automatic recoveries are not crew-limited) */
  crews?: number;
  capacityMode?: CapacityMode;
  switchover?: Switchover;
  /** state-count limit before falling back to the one-dimensional chain with E[R] */
  maxStates?: number;
}

export interface KofNGroupResult {
  /** Σ π over up states (exact chain) */
  availability: number;
  /** first-order unavailability from successful switchovers: Σ π·w·λ·p_sw·t_sw */
  switchoverOutage: number;
  /** availability − switchoverOutage */
  availabilityEffective: number;
  /** up → down flux per hour */
  failureFrequency: number;
  /** successful switchovers per hour */
  switchoverFrequency: number;
  /** failure frequency + switchovers (when t_sw > 0 each is a short interruption) */
  failureFrequencyEffective: number;
  mttfFromNew: number;
  /** Σ π·capacity (performability) */
  capacity: number;
  /** probability of sitting in a switch-failed state */
  switchFailedProbability: number;
  /** share of unit repairs in progress that are on the automatic path */
  autoRepairShare: number;
  states: number;
  approximate: boolean;
  notes: string[];
  /** steady-state distribution over (units in automatic repair, in manual repair, switch-failed) — exact chain only */
  distribution?: { auto: number; manual: number; switchFailed: boolean; working: number; up: boolean; probability: number }[];
}

/** same convention as the v1 kOfNRepairable: proportional = min(1, up/k), fractional = up/n (while up) */
function capOf(mode: CapacityMode, w: number, n: number, k: number): number {
  switch (mode) {
    case 'proportional':
      return Math.min(1, k > 0 ? w / k : 1);
    case 'fractional':
      return w / n;
    default:
      return 1;
  }
}

/** k-of-n group of identical active units with dual-path repair and switchover (§11). */
export function kOfNGroup(o: KofNGroupOptions): KofNGroupResult {
  const { n, k, lambda } = o;
  if (!(n >= 1) || !(k >= 1) || k > n) throw new RangeError('kOfNGroup: need 1 ≤ k ≤ n');
  const r = o.repair;
  const c = r.coverage;
  const s = r.successProbability;
  const Ta = Math.max(r.autoMttrH, MIN_T);
  const Tm = Math.max(r.manualMttrH, MIN_T);
  const crews = o.crews ?? Infinity;
  const mode = o.capacityMode ?? 'binary';
  const p = o.switchover?.successProbability ?? 1;
  const tsw = (o.switchover?.outageS ?? 0) / 3600;
  const Tsf = Math.max(o.switchover?.failureRecoveryHours ?? r.manualMttrH, MIN_T);
  const maxStates = o.maxStates ?? 700;
  const notes: string[] = [];

  // ---- state space (a, m, switchFailed) ----
  const idx = new Map<string, number>();
  const states: CtmcState[] = [];
  const meta: { a: number; m: number; sw: boolean }[] = [];
  const key = (a: number, m: number, sw: boolean) => `${a},${m},${sw ? 1 : 0}`;
  const add = (a: number, m: number, sw: boolean) => {
    const w = n - a - m;
    const up = !sw && w >= k;
    idx.set(key(a, m, sw), states.length);
    states.push({ id: key(a, m, sw), up, capacity: up ? capOf(mode, w, n, k) : 0 });
    meta.push({ a, m, sw });
  };
  for (let a = 0; a <= n; a++) {
    for (let m = 0; m <= n - a; m++) {
      add(a, m, false);
      if (p < 1 && n - a - m - 1 >= k) add(a, m, true);
    }
  }

  if (states.length > maxStates) return kOfNGroupApprox(o, notes);

  const tr: Transition[] = [];
  const at = (a: number, m: number, sw = false) => idx.get(key(a, m, sw))!;
  for (let i = 0; i < states.length; i++) {
    const { a, m, sw } = meta[i];
    if (sw) {
      tr.push({ from: i, to: at(a, m + 1), rate: 1 / Tsf });
      continue;
    }
    const w = n - a - m;
    if (w >= 1) {
      const survivable = w - 1 >= k;
      const psw = survivable ? p : 1;
      tr.push({ from: i, to: at(a + 1, m), rate: w * lambda * c * psw });
      tr.push({ from: i, to: at(a, m + 1), rate: w * lambda * (1 - c) * psw });
      if (survivable && p < 1) tr.push({ from: i, to: at(a, m, true), rate: w * lambda * (1 - p) });
    }
    if (a >= 1) {
      tr.push({ from: i, to: at(a - 1, m), rate: (a * s) / Ta });
      tr.push({ from: i, to: at(a - 1, m + 1), rate: (a * (1 - s)) / Ta });
    }
    if (m >= 1) tr.push({ from: i, to: at(a, m - 1), rate: Math.min(m, crews) / Tm });
  }
  const chain = new Ctmc(states, tr);
  const pi = chain.steadyState();
  const A = chain.availability(pi);
  const nu = chain.failureFrequency(pi);
  let swFreq = 0;
  let swFailed = 0;
  let repairsAuto = 0;
  let repairsAll = 0;
  for (let i = 0; i < states.length; i++) {
    const { a, m, sw } = meta[i];
    if (sw) {
      swFailed += pi[i];
      continue;
    }
    const w = n - a - m;
    if (w >= k && w - 1 >= k) swFreq += pi[i] * w * lambda * p;
    repairsAuto += pi[i] * a;
    repairsAll += pi[i] * (a + m);
  }
  const Usw = swFreq * tsw;
  if (Usw > 0.1 * (1 - A)) notes.push('switchover micro-outage is not small relative to the group unavailability (first-order correction)');
  const absorbing = new Set<number>();
  for (let i = 0; i < states.length; i++) if (!states[i].up) absorbing.add(i);
  const mttf = lambda > 0 ? chain.meanTimeToAbsorption(absorbing, at(0, 0)) : Infinity;
  return {
    availability: A,
    switchoverOutage: Usw,
    availabilityEffective: Math.max(0, A - Usw),
    failureFrequency: nu,
    switchoverFrequency: swFreq,
    failureFrequencyEffective: nu + (tsw > 0 ? swFreq : 0),
    mttfFromNew: mttf,
    capacity: chain.capacityAvailability(pi) - Usw,
    switchFailedProbability: swFailed,
    autoRepairShare: repairsAll > 0 ? repairsAuto / repairsAll : 0,
    states: states.length,
    approximate: false,
    notes,
    distribution: meta.map((x, i) => ({ auto: x.a, manual: x.m, switchFailed: x.sw, working: n - x.a - x.m, up: states[i].up, probability: pi[i] })),
  };
}

/** Fallback for large groups: one-dimensional chain with the mean repair time; switchover terms first order. */
function kOfNGroupApprox(o: KofNGroupOptions, notes: string[]): KofNGroupResult {
  const { n, k, lambda } = o;
  const r = o.repair;
  const ER = Math.max(meanRepairH(r), MIN_T);
  const mu = 1 / ER;
  const crews = o.crews ?? Infinity;
  const p = o.switchover?.successProbability ?? 1;
  const tsw = (o.switchover?.outageS ?? 0) / 3600;
  const Tsf = Math.max(o.switchover?.failureRecoveryHours ?? r.manualMttrH, MIN_T);
  const base = kOfNRepairable(n, k, lambda, mu, crews, o.capacityMode ?? 'binary');
  const lambdas = new Float64Array(n);
  const mus = new Float64Array(n + 1);
  for (let j = 0; j < n; j++) lambdas[j] = (n - j) * lambda;
  for (let j = 1; j <= n; j++) mus[j] = Math.min(j, crews) * mu;
  const pi = birthDeathSteadyState(lambdas, mus);
  let swFreq = 0;
  for (let j = 0; j <= n - k - 1; j++) swFreq += pi[j] * (n - j) * lambda * p;
  let failFreq = 0;
  for (let j = 0; j <= n - k - 1; j++) failFreq += pi[j] * (n - j) * lambda * (1 - p);
  const Usf = failFreq * Tsf;
  const Usw = swFreq * tsw;
  const A = Math.max(0, base.availability - Usf);
  notes.push(`group has more than ${o.maxStates ?? 700} states: repair mixture replaced by its mean E[R] = ${ER.toPrecision(4)} h and switchover terms added first order`);
  return {
    availability: A,
    switchoverOutage: Usw,
    availabilityEffective: Math.max(0, A - Usw),
    failureFrequency: base.failureFrequency + failFreq,
    switchoverFrequency: swFreq,
    failureFrequencyEffective: base.failureFrequency + failFreq + (tsw > 0 ? swFreq : 0),
    mttfFromNew: p < 1 ? 1 / (1 / base.mttfFromNew + (n * lambda * (1 - p))) : base.mttfFromNew,
    capacity: Math.max(0, base.capacity - Usf - Usw),
    switchFailedProbability: Usf,
    autoRepairShare: autoDowntimeShare(r),
    states: n + 1,
    approximate: true,
    notes,
  };
}

/* ---------------------------------------------------------------------- */
/* Sub-health                                                               */
/* ---------------------------------------------------------------------- */

export interface Subhealth {
  /** entry rate into sub-health, per hour */
  ratePerHour: number;
  /** mean time in sub-health until recovery or escalation, hours */
  durationH: number;
  /** delivered performance while sub-healthy, (0, 1) */
  performance: number;
  /** failure-rate multiplier while sub-healthy (fail-slow → fail-stop); default 1 */
  escalationMultiplier?: number;
  /** tolerate = keep running slow; isolate = detected sub-health is handled as a failure */
  policy?: 'tolerate' | 'isolate';
  detection?: { probability: number; delayH: number };
  /** sub-health counts as down when performance < threshold (default 0.7) */
  threshold?: number;
}

export const SUBHEALTH_THRESHOLD_DEFAULT = 0.7;

/** λ_sh from a steady-state sub-health probability and mean duration (escalation neglected). */
export function subhealthRateFromProbability(pSh: number, durationH: number): { ratePerHour: number; warning?: string } {
  if (!(pSh >= 0 && pSh < 1)) throw new RangeError('p_sh must be in [0, 1)');
  const rate = durationH > 0 ? pSh / ((1 - pSh) * durationH) : 0;
  return { ratePerHour: rate };
}

export interface SubhealthUnitResult {
  piUp: number;
  /** H + H′ */
  piSubhealth: number;
  /** H: sub-healthy before the detection decision (all of the sub-health time under tolerate) */
  piSubhealthPending: number;
  /** H′: sub-healthy and undetected (isolate policy only) */
  piSubhealthUndetected: number;
  piIsolated: number;
  piDownAuto: number;
  piDownManual: number;
  strict: number;
  tolerant: number;
  performability: number;
  /** availability by the threshold rule (reported availability) */
  availability: number;
  countsAsDown: boolean;
  /** flux from the threshold up-set into its complement */
  failureFrequency: number;
  /** detected isolations per hour (policy isolate) */
  isolationFrequency: number;
  /** P(sub-healthy | not down) */
  pSubhealthGivenNotDown: number;
  /** mean first passage from U into the down set of the threshold rule, hours (1/(λ + λ_sh) when sub-health counts as down) */
  mttfFromNew: number;
  warnings: string[];
}

/** Sub-health unit (§14): states U, H, H′, I, D_a, D_m. */
export function subhealthUnit(lambda: number, repair: DualRepair, sh: Subhealth): SubhealthUnitResult {
  const warnings: string[] = [];
  const c = repair.coverage;
  const s = repair.successProbability;
  const Ta = Math.max(repair.autoMttrH, MIN_T);
  const Tm = Math.max(repair.manualMttrH, MIN_T);
  const m = sh.escalationMultiplier ?? 1;
  const D = Math.max(sh.durationH, MIN_T);
  const phi = sh.performance;
  const thr = sh.threshold ?? SUBHEALTH_THRESHOLD_DEFAULT;
  const countsAsDown = phi < thr;
  const isolate = sh.policy === 'isolate';
  const pd = isolate ? sh.detection?.probability ?? 1 : 0;
  const Td = Math.max(sh.detection?.delayH ?? 0, MIN_T);
  if (m * lambda * D > 0.1) warnings.push('escalation during sub-health is not negligible (m·λ·D > 0.1): p_sh ↔ λ_sh conversion is approximate');
  const upH = !countsAsDown;
  // only reachable states are instantiated (unreachable states would make the generator singular)
  const states: CtmcState[] = [];
  const push = (st: CtmcState) => states.push(st) - 1;
  const U = push({ id: 'up', up: true, capacity: 1 });
  const H = push({ id: 'subhealth', up: upH, capacity: phi });
  const Hp = isolate ? push({ id: 'subhealth_undetected', up: upH, capacity: phi }) : -1;
  const I = isolate ? push({ id: 'isolated', up: false, capacity: 0 }) : -1;
  const Da = c > 0 || isolate ? push({ id: 'down_auto', up: false, capacity: 0 }) : -1;
  const Dm = push({ id: 'down_manual', up: false, capacity: 0 });
  const tr: Transition[] = [];
  const down = (from: number, rate: number) => {
    if (Da >= 0) tr.push({ from, to: Da, rate: rate * c });
    tr.push({ from, to: Dm, rate: rate * (1 - c) });
  };
  tr.push({ from: U, to: H, rate: sh.ratePerHour });
  down(U, lambda);
  tr.push({ from: H, to: U, rate: 1 / D });
  down(H, m * lambda);
  if (isolate) {
    tr.push({ from: H, to: I, rate: pd / Td });
    tr.push({ from: H, to: Hp, rate: (1 - pd) / Td });
    tr.push({ from: Hp, to: U, rate: 1 / D });
    down(Hp, m * lambda);
    tr.push({ from: I, to: U, rate: s / Ta });
    tr.push({ from: I, to: Dm, rate: (1 - s) / Ta });
  }
  if (Da >= 0) {
    tr.push({ from: Da, to: U, rate: s / Ta });
    tr.push({ from: Da, to: Dm, rate: (1 - s) / Ta });
  }
  tr.push({ from: Dm, to: U, rate: 1 / Tm });
  const chain = new Ctmc(states, tr);
  const pi = chain.steadyState();
  const at = (i: number) => (i >= 0 ? pi[i] : 0);
  const piSh = at(H) + at(Hp);
  const notDown = at(U) + piSh;
  // MTTF from new: first passage from U into the down set (escalated failures and detected isolations shorten it below 1/λ)
  const downSet = new Set<number>();
  states.forEach((st, i) => {
    if (!st.up) downSet.add(i);
  });
  let mttfFromNew = Infinity;
  if (downSet.size > 0 && (lambda > 0 || (sh.ratePerHour > 0 && (countsAsDown || isolate)))) {
    try {
      mttfFromNew = chain.meanTimeToAbsorption(downSet, U);
    } catch {
      mttfFromNew = Infinity;
    }
  }
  return {
    piUp: at(U),
    piSubhealth: piSh,
    piSubhealthPending: at(H),
    piSubhealthUndetected: at(Hp),
    piIsolated: at(I),
    piDownAuto: at(Da),
    piDownManual: at(Dm),
    strict: at(U),
    tolerant: at(U) + piSh,
    performability: at(U) + phi * piSh,
    availability: chain.availability(pi),
    countsAsDown,
    failureFrequency: chain.failureFrequency(pi),
    isolationFrequency: isolate ? (at(H) * pd) / Td : 0,
    pSubhealthGivenNotDown: notDown > 0 ? piSh / notDown : 0,
    mttfFromNew,
    warnings,
  };
}

/** Straggler law for a synchronous job of N units (§14): P(slowed) = 1 − (1 − p_H)^N, φ_job = 1 − P·(1 − φ). */
export function stragglerLaw(n: number, pSubhealth: number, performance: number): { pSlowed: number; performanceFactor: number } {
  const pSlowed = 1 - Math.pow(1 - pSubhealth, n);
  return { pSlowed, performanceFactor: 1 - pSlowed * (1 - performance) };
}

/** one class of the multi-class straggler law: n units, each slowed with probability p, running at φ while slowed */
export interface StragglerClass { n: number; p: number; performance: number }
/**
 * Straggler law over several classes (v5.7, sixth review F5): the synchronous step runs at the slowest slowed unit, so with the
 * classes sorted by φ ascending and q_c = (1 − p_c)^{n_c} the probability that no unit of class c is slowed,
 *   E[φ_job] = Π_c q_c + Σ_j φ_(j) (1 − q_(j)) Π_{i<j} q_(i)          (independent units)
 * — with one φ for every class this is the single-class law 1 − P(slowed)(1 − φ) exactly. Before v5.7 every slowed state was
 * charged at the worst class's φ, which overstated the slowdown when the classes differ (`atlas950Training`: 7.9 % against the
 * ledger's 1.45 %). `scale` multiplies every n (the scale table's N/N₀).
 */
export function stragglerLawClasses(classes: StragglerClass[], scale = 1): { pSlowed: number; performanceFactor: number } {
  const rows = classes
    .filter((c) => c.n > 0 && c.p > 0)
    .map((c) => ({ logQ: c.n * scale * Math.log1p(-Math.min(c.p, 1 - 1e-15)), phi: c.performance }))
    .sort((a, b) => a.phi - b.phi);
  let logNone = 0; // log Π_{i<j} q_(i)
  let perf = 0;
  for (const r of rows) {
    const none = Math.exp(logNone);
    perf += r.phi * none * -Math.expm1(r.logQ);
    logNone += r.logQ;
  }
  const pNone = Math.exp(logNone);
  return { pSlowed: 1 - pNone, performanceFactor: pNone + perf };
}

/** Plane-loss performance factor (§15): φ = 1 / (1 + f_comm/(P − 1)). */
export function planeLossPerformance(planes: number, commShare: number): { performance: number; stepTimeFactor: number } {
  if (!(planes >= 2)) return { performance: 0, stepTimeFactor: Infinity };
  const f = 1 + commShare / (planes - 1);
  return { performance: 1 / f, stepTimeFactor: f };
}
