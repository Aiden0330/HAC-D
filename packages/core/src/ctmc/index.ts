/**
 * Continuous-time Markov chains for repairable systems (survey §4.2):
 * birth–death chains for k-of-n blocks and spare pools, general small chains
 * for degraded (fail-slow), SDC-latent and standby-with-switch models.
 * Rates are per hour unless stated otherwise.
 */
import { solveDense, solveTridiagonal } from '../math/linalg.js';

export interface CtmcState {
  id: string;
  /** whether the system is considered available in this state */
  up: boolean;
  /** delivered capacity in [0, 1] (1 = full); 0 for down states */
  capacity: number;
}

export interface Transition {
  from: number;
  to: number;
  rate: number;
}

export class Ctmc {
  readonly n: number;
  readonly Q: Float64Array;

  constructor(readonly states: CtmcState[], transitions: Transition[]) {
    this.n = states.length;
    this.Q = new Float64Array(this.n * this.n);
    for (const t of transitions) {
      if (t.from === t.to || !(t.rate > 0)) continue;
      this.Q[t.from * this.n + t.to] += t.rate;
      this.Q[t.from * this.n + t.from] -= t.rate;
    }
  }

  /** Steady-state distribution π with πQ = 0, Σπ = 1 (dense solve; fine for n ≲ 1500). */
  steadyState(): Float64Array {
    const n = this.n;
    if (n === 1) return new Float64Array([1]);
    // Build A = Qᵀ with the last row replaced by the normalisation constraint.
    const A = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = this.Q[j * n + i];
    for (let j = 0; j < n; j++) A[(n - 1) * n + j] = 1;
    const b = new Float64Array(n);
    b[n - 1] = 1;
    const pi = solveDense(A, b, n);
    for (let i = 0; i < n; i++) if (pi[i] < 0 && pi[i] > -1e-12) pi[i] = 0;
    return pi;
  }

  availability(pi: Float64Array): number {
    let a = 0;
    for (let i = 0; i < this.n; i++) if (this.states[i].up) a += pi[i];
    return a;
  }

  /** Performability: Σ π_s · c_s. */
  capacityAvailability(pi: Float64Array): number {
    let a = 0;
    for (let i = 0; i < this.n; i++) a += pi[i] * this.states[i].capacity;
    return a;
  }

  /** Steady-state frequency (per hour) of transitions from up states into down states. */
  failureFrequency(pi: Float64Array): number {
    let f = 0;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (!this.states[i].up) continue;
      for (let j = 0; j < n; j++) {
        if (i === j || this.states[j].up) continue;
        f += pi[i] * this.Q[i * n + j];
      }
    }
    return f;
  }

  /**
   * Mean time to reach any state in `absorbing` starting from `start`
   * (first-passage time; the absorbing states are made absorbing for this computation).
   */
  meanTimeToAbsorption(absorbing: Set<number>, start: number): number {
    const transient: number[] = [];
    for (let i = 0; i < this.n; i++) if (!absorbing.has(i)) transient.push(i);
    if (absorbing.has(start)) return 0;
    const m = transient.length;
    const idx = new Map<number, number>();
    transient.forEach((s, k) => idx.set(s, k));
    // (−Q_TT) t = 1
    const A = new Float64Array(m * m);
    for (let r = 0; r < m; r++) {
      const i = transient[r];
      for (let c = 0; c < m; c++) A[r * m + c] = -this.Q[i * this.n + transient[c]];
    }
    const b = new Float64Array(m).fill(1);
    const t = solveDense(A, b, m);
    return t[idx.get(start)!];
  }

  /** Transient distribution at time t via uniformization (Poisson-weighted DTMC powers). */
  transient(pi0: Float64Array, t: number, eps = 1e-12): Float64Array {
    const n = this.n;
    let lam = 0;
    for (let i = 0; i < n; i++) lam = Math.max(lam, -this.Q[i * n + i]);
    if (lam === 0 || t === 0) return new Float64Array(pi0);
    const q = lam * 1.02 + 1e-12;
    // P = I + Q/q
    const P = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) P[i * n + j] = this.Q[i * n + j] / q;
      P[i * n + i] += 1;
    }
    const qt = q * t;
    // Poisson weights
    let logw = -qt;
    let w = Math.exp(logw);
    const result = new Float64Array(n);
    let v = new Float64Array(pi0);
    let cum = 0;
    const kMax = Math.ceil(qt + 10 * Math.sqrt(qt + 1) + 20);
    for (let k = 0; k <= kMax; k++) {
      if (k > 0) {
        // v = v P
        const nv = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const vi = v[i];
          if (vi === 0) continue;
          for (let j = 0; j < n; j++) nv[j] += vi * P[i * n + j];
        }
        v = nv;
        logw += Math.log(qt / k);
        w = Math.exp(logw);
      }
      for (let i = 0; i < n; i++) result[i] += w * v[i];
      cum += w;
      if (k > qt && 1 - cum < eps) break;
    }
    return result;
  }
}

/* ---------------------------------------------------------------------- */
/* Birth–death chains (closed forms, O(n))                                 */
/* ---------------------------------------------------------------------- */

/**
 * Steady state of a birth–death chain on states 0..m with up-rates
 * lambdas[j] (j → j+1, j = 0..m−1) and down-rates mus[j] (j → j−1, j = 1..m).
 */
export function birthDeathSteadyState(lambdas: ArrayLike<number>, mus: ArrayLike<number>): Float64Array {
  const m = lambdas.length; // states 0..m
  const logPi = new Float64Array(m + 1);
  logPi[0] = 0;
  for (let j = 1; j <= m; j++) {
    const up = lambdas[j - 1];
    const dn = mus[j];
    logPi[j] = up > 0 && dn > 0 ? logPi[j - 1] + Math.log(up) - Math.log(dn) : up > 0 ? Infinity : -Infinity;
  }
  let max = -Infinity;
  for (let j = 0; j <= m; j++) if (logPi[j] > max) max = logPi[j];
  const pi = new Float64Array(m + 1);
  let sum = 0;
  for (let j = 0; j <= m; j++) {
    pi[j] = Number.isFinite(logPi[j]) ? Math.exp(logPi[j] - max) : logPi[j] === Infinity ? 1 : 0;
    sum += pi[j];
  }
  for (let j = 0; j <= m; j++) pi[j] /= sum;
  return pi;
}

/**
 * Mean first-passage time from state 0 to state m of a birth–death chain
 * (states 0..m−1 transient). Solves (a_j + b_j)T_j = 1 + a_j T_{j+1} + b_j T_{j−1}, T_m = 0
 * — the recurrence of survey Fig. 4-3.
 */
export function birthDeathMeanTimeToAbsorb(lambdas: ArrayLike<number>, mus: ArrayLike<number>): number {
  const m = lambdas.length;
  if (m === 0) return 0;
  const sub = new Float64Array(m);
  const diag = new Float64Array(m);
  const sup = new Float64Array(m);
  const rhs = new Float64Array(m).fill(1);
  for (let j = 0; j < m; j++) {
    const a = lambdas[j];
    const b = j > 0 ? mus[j] : 0;
    diag[j] = a + b;
    sup[j] = -a; // T_{j+1}; for j = m−1 the term is T_m = 0 (dropped)
    sub[j] = -b;
  }
  sup[m - 1] = 0;
  const T = solveTridiagonal(sub, diag, sup, rhs);
  return T[0];
}

/* ---------------------------------------------------------------------- */
/* Model builders                                                          */
/* ---------------------------------------------------------------------- */

export interface KofNRepairableResult {
  /** steady-state availability (system up when failed units ≤ n − k) */
  availability: number;
  /** expected capacity when 'proportional' (min(1, up/k)) or 'fractional' (up/n while up) */
  capacity: number;
  /** steady-state frequency of system failures (per hour) */
  failureFrequency: number;
  /** mean time from all-up to the first system failure (hours) */
  mttfFromNew: number;
  /** steady-state distribution over failed-unit count */
  pi: Float64Array;
  /** expected number of failed (in-repair) units */
  expectedFailed: number;
}

/**
 * n identical units, system up while at least k work; unit failure rate λ (per h),
 * repair rate μ = 1/MTTR; `crews` parallel repairers (Infinity = unlimited).
 * Units keep failing and being repaired independently of system state, which
 * reproduces the binomial steady state A = Σ_{j≤n−k} C(n,j) u^j (1−u)^{n−j}
 * when crews are unlimited (survey Fig. 4-1b).
 */
export function kOfNRepairable(
  n: number,
  k: number,
  lambda: number,
  mu: number,
  crews: number = Infinity,
  capacityMode: 'binary' | 'proportional' | 'fractional' = 'binary',
): KofNRepairableResult {
  if (!(n >= 1) || !(k >= 1) || k > n) throw new RangeError(`kOfNRepairable: need 1 ≤ k ≤ n, got k=${k}, n=${n}`);
  const lambdas = new Float64Array(n);
  const mus = new Float64Array(n + 1);
  for (let j = 0; j < n; j++) lambdas[j] = (n - j) * lambda;
  for (let j = 1; j <= n; j++) mus[j] = Math.min(j, crews) * mu;
  const pi = mu > 0 ? birthDeathSteadyState(lambdas, mus) : (() => { const p = new Float64Array(n + 1); p[n] = 1; return p; })();
  const maxFailed = n - k;
  let availability = 0;
  let capacity = 0;
  let expectedFailed = 0;
  for (let j = 0; j <= n; j++) {
    expectedFailed += j * pi[j];
    if (j <= maxFailed) {
      availability += pi[j];
      const upUnits = n - j;
      const c = capacityMode === 'binary' ? 1 : capacityMode === 'proportional' ? Math.min(1, upUnits / k) : upUnits / n;
      capacity += pi[j] * c;
    }
  }
  const failureFrequency = pi[maxFailed] * k * lambda;
  // MTTF from all-up: absorbing at n−k+1 failed
  const mttfFromNew = lambda > 0 ? birthDeathMeanTimeToAbsorb(lambdas.subarray(0, maxFailed + 1), mus.subarray(0, maxFailed + 2)) : Infinity;
  return { availability, capacity, failureFrequency, mttfFromNew, pi, expectedFailed };
}

export interface StandbyResult {
  availability: number;
  failureFrequency: number;
  mttfFromNew: number;
  /** successful switchovers per hour (active failure while a standby exists) */
  switchFrequency: number;
  /** probability of sitting in a switch-failed state */
  switchFailedProbability: number;
}

/**
 * 1-of-n standby: one active unit (rate λ) and n−1 standbys failing at factor·λ
 * (factor 0 = cold, 1 = hot). On an active failure with a standby left the switch
 * succeeds with probability pSwitch; a failed switch leaves the system down until the
 * switch-failed state is cleared (rate switchRepairRate, default μ). The failure of the
 * last working unit has no standby to switch to and takes the system straight to the
 * all-failed state. Repairs of failed units proceed with `crews` repairers.
 */
export function standby(
  n: number,
  lambda: number,
  mu: number,
  standbyFactor = 0,
  pSwitch = 1,
  crews: number = Infinity,
  /** rate at which a failed switchover is cleared (v2: 1/T_sf); default μ (v1 behaviour) */
  switchRepairRate?: number,
): StandbyResult {
  if (!(n >= 1)) throw new RangeError('standby: n ≥ 1');
  // States: j = failed units (0..n) → index j; switch-down states SW_j (j = 0..n−2, a switch happens only while a
  // standby exists; docs/MODEL_REFERENCE.md §13) → index n+1+j
  const states: CtmcState[] = [];
  for (let j = 0; j <= n; j++) states.push({ id: `failed_${j}`, up: j <= n - 1, capacity: j <= n - 1 ? 1 : 0 });
  const sw = pSwitch < 1 ? Math.max(0, n - 1) : 0;
  for (let j = 0; j < sw; j++) states.push({ id: `switch_down_${j}`, up: false, capacity: 0 });
  const tr: Transition[] = [];
  for (let j = 0; j < n; j++) {
    const standbyRate = (n - 1 - j) * standbyFactor * lambda;
    if (standbyRate > 0) tr.push({ from: j, to: j + 1, rate: standbyRate });
    if (j < sw) {
      tr.push({ from: j, to: j + 1, rate: lambda * pSwitch });
      tr.push({ from: j, to: n + 1 + j, rate: lambda * (1 - pSwitch) });
    } else tr.push({ from: j, to: j + 1, rate: lambda }); // perfect switch, or the last working unit: no switch to attempt
  }
  for (let j = 1; j <= n; j++) tr.push({ from: j, to: j - 1, rate: Math.min(j, crews) * mu });
  const swRate = switchRepairRate ?? mu;
  for (let j = 0; j < sw; j++) tr.push({ from: n + 1 + j, to: j + 1, rate: swRate }); // switch repaired; the failed unit is now counted
  const chain = new Ctmc(states, tr);
  let availability = 1;
  let failureFrequency = 0;
  let switchFrequency = 0;
  let switchFailedProbability = 0;
  if (mu > 0) {
    const pi = chain.steadyState();
    availability = chain.availability(pi);
    failureFrequency = chain.failureFrequency(pi);
    for (let j = 0; j <= n - 2; j++) switchFrequency += pi[j] * lambda * pSwitch;
    for (let j = 0; j < sw; j++) switchFailedProbability += pi[n + 1 + j];
  } else {
    availability = 0;
  }
  const absorbing = new Set<number>();
  absorbing.add(n);
  for (let j = 0; j < sw; j++) absorbing.add(n + 1 + j);
  const mttfFromNew = lambda > 0 ? chain.meanTimeToAbsorption(absorbing, 0) : Infinity;
  return { availability, failureFrequency, mttfFromNew, switchFrequency, switchFailedProbability };
}

export interface DegradedUnitResult {
  availability: number;
  capacity: number;
  piUp: number;
  piDegraded: number;
  piDown: number;
  failureFrequency: number;
}

/**
 * Three-state unit: up → down (λ), up → degraded (λ_deg), degraded → up (1/duration),
 * degraded → down (λ), down → up (μ). Capacity in the degraded state is cDeg ∈ (0, 1).
 * Models fail-slow as a degraded state (survey §4.3).
 */
export function degradedUnit(lambda: number, mu: number, lambdaDeg: number, degDurationH: number, cDeg: number): DegradedUnitResult {
  const states: CtmcState[] = [
    { id: 'up', up: true, capacity: 1 },
    { id: 'degraded', up: true, capacity: cDeg },
    { id: 'down', up: false, capacity: 0 },
  ];
  const tr: Transition[] = [
    { from: 0, to: 2, rate: lambda },
    { from: 0, to: 1, rate: lambdaDeg },
    { from: 1, to: 0, rate: degDurationH > 0 ? 1 / degDurationH : 0 },
    { from: 1, to: 2, rate: lambda },
    { from: 2, to: 0, rate: mu },
  ];
  const chain = new Ctmc(states, tr);
  const pi = chain.steadyState();
  return {
    availability: chain.availability(pi),
    capacity: chain.capacityAvailability(pi),
    piUp: pi[0],
    piDegraded: pi[1],
    piDown: pi[2],
    failureFrequency: chain.failureFrequency(pi),
  };
}

export interface SdcLatentResult {
  piUp: number;
  piLatent: number;
  piRepair: number;
  piDown: number;
  /** availability counting latent (corrupted) time as unavailable */
  effectiveAvailability: number;
  /** fraction of time in the latent state — work produced then must be discarded */
  latentFraction: number;
}

/**
 * Four-state unit with a silent-data-corruption latent state (survey §7):
 * up → latent (λ_sdc), latent → repair (1/T_expose), repair → up (μ),
 * up → down (λ), down → up (μ).
 */
export function sdcLatentUnit(lambda: number, mu: number, lambdaSdc: number, exposeTimeH: number): SdcLatentResult {
  const states: CtmcState[] = [
    { id: 'up', up: true, capacity: 1 },
    { id: 'latent', up: false, capacity: 0 },
    { id: 'repair', up: false, capacity: 0 },
    { id: 'down', up: false, capacity: 0 },
  ];
  const tr: Transition[] = [
    { from: 0, to: 1, rate: lambdaSdc },
    { from: 1, to: 2, rate: exposeTimeH > 0 ? 1 / exposeTimeH : 0 },
    { from: 2, to: 0, rate: mu },
    { from: 0, to: 3, rate: lambda },
    { from: 3, to: 0, rate: mu },
  ];
  const chain = new Ctmc(states, tr);
  const pi = chain.steadyState();
  return {
    piUp: pi[0],
    piLatent: pi[1],
    piRepair: pi[2],
    piDown: pi[3],
    effectiveAvailability: pi[0],
    latentFraction: pi[1],
  };
}
