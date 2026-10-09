/**
 * Checkpoint-interval and goodput models (survey §6.1 and Table 6-1):
 * Young 1974, Daly 2006 (lowest-order, three-term, exact Lambert-W), Saxena et al. 2024
 * (availability objective), Meta RSC Daly-Young interval, first-order goodput with
 * explicit validity flags, TrainMover ETTR(N), Epoch time-lost model.
 * All times in seconds unless the name says otherwise.
 */
import { lambertW0 } from '../math/special.js';

/** Young: T_c ≈ √(2 T_s T_f). */
export function youngInterval(deltaS: number, mtbiS: number): number {
  if (!(mtbiS > 0) || !(deltaS >= 0)) return Infinity;
  return Math.sqrt(2 * deltaS * mtbiS);
}

/** Daly lowest-order solution √(2δM) − δ. */
export function dalyLowestOrder(deltaS: number, mtbiS: number): number {
  return Math.sqrt(2 * deltaS * mtbiS) - deltaS;
}

/**
 * Daly three-term estimate (FGCS 2006, eq. 37):
 * τ̃ = √(2δM)·[1 + (1/3)(δ/2M)^{1/2} + (1/9)(δ/2M)] − δ for δ < 2M, else τ = M.
 * Total-wall-time error ≤ 0.2 % within its range.
 */
export function dalyThreeTerm(deltaS: number, mtbiS: number): number {
  if (!(mtbiS > 0)) return Infinity;
  if (deltaS >= 2 * mtbiS) return mtbiS;
  const x = deltaS / (2 * mtbiS);
  return Math.sqrt(2 * deltaS * mtbiS) * (1 + Math.sqrt(x) / 3 + x / 9) - deltaS;
}

/**
 * Daly exact optimum: solve (1 − τ/M)·e^{(τ+δ)/M} = 1 for the computation interval τ.
 * Equivalent to η = 2ξ² + 1 + W0(−e^{−2ξ²−1}), ξ = √(δ/2M), τ = ηM − δ.
 * The restart time R does not enter the optimality condition.
 */
export function dalyExact(deltaS: number, mtbiS: number): number {
  if (!(mtbiS > 0)) return Infinity;
  if (deltaS <= 0) return 0;
  if (deltaS >= 2 * mtbiS) return mtbiS;
  const xi2 = deltaS / (2 * mtbiS);
  const eta0 = 2 * xi2 + 1 + lambertW0(-Math.exp(-2 * xi2 - 1));
  let tau = eta0 * mtbiS - deltaS;
  // Newton polish on f(τ) = (1 − τ/M) e^{(τ+δ)/M} − 1
  for (let i = 0; i < 50; i++) {
    const e = Math.exp((tau + deltaS) / mtbiS);
    const f = (1 - tau / mtbiS) * e - 1;
    const fp = (e / mtbiS) * (1 - tau / mtbiS) - e / mtbiS; // d/dτ
    if (fp === 0) break;
    const step = f / fp;
    tau -= step;
    if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(tau))) break;
  }
  return tau;
}

/**
 * Daly's expected total wall time for a solve time T_s, computation interval τ,
 * dump time δ, restart R and MTBI M (δ ≪ T_s approximation, FGCS 2006 eq. 20):
 * T_w = M·e^{R/M}·(e^{(τ+δ)/M} − 1)·T_s/τ.
 * Returns the ratio T_w/T_s; goodput under this model is its reciprocal.
 */
export function dalyWallTimeRatio(tauS: number, deltaS: number, mtbiS: number, restartS: number): number {
  if (!(tauS > 0)) return Infinity;
  return (mtbiS * Math.exp(restartS / mtbiS) * (Math.exp((tauS + deltaS) / mtbiS) - 1)) / tauS;
}

/** Goodput under Daly's full expected-time model = 1 / (T_w/T_s). */
export function dalyGoodput(tauS: number, deltaS: number, mtbiS: number, restartS: number): number {
  return 1 / dalyWallTimeRatio(tauS, deltaS, mtbiS, restartS);
}

/**
 * Saxena et al. 2024 availability objective:
 * A(T_c) = (T_f − T_f·T_s/T_c) / (T_f + T_c/2 + T_r), T_c the full period (incl. T_s).
 */
export function saxenaAvailability(tcS: number, tfS: number, tsS: number, trS: number): number {
  return (tfS - (tfS * tsS) / tcS) / (tfS + tcS / 2 + trS);
}

/** Saxena et al. 2024 availability-optimal period T_c* = T_s + √(2(T_f + T_r)T_s + T_s²). */
export function saxenaOptimalPeriod(tfS: number, tsS: number, trS: number): number {
  return tsS + Math.sqrt(2 * (tfS + trS) * tsS + tsS * tsS);
}

/** Meta RSC Daly-Young interval Δt* = √(2 w_cp / (N_nodes · r_f)); r_f per node per hour → seconds. */
export function metaRscInterval(wcpS: number, nNodes: number, rfPerNodeHour: number): number {
  const mtbiS = 3600 / (nNodes * rfPerNodeHour);
  return Math.sqrt(2 * wcpS * mtbiS);
}

export type Regime = 'checkpoint-dominated' | 'restart-dominated' | 'first-order-invalid';

export interface GoodputFirstOrder {
  /** interval used (s) */
  tauS: number;
  goodput: number;
  /** loss terms as fractions of wall time */
  terms: { save: number; recompute: number; restart: number; total: number };
  /** (τ + δ)/M — must be ≪ 1 for the first-order model */
  smallParameter: number;
  /** R/M */
  restartRatio: number;
  /** δ ≥ 2M means no interval can protect progress (Daly) */
  dalyApplicable: boolean;
  regime: Regime;
  /** 'ok' | 'caution' | 'invalid' for the first-order approximation */
  validity: 'ok' | 'caution' | 'invalid';
  warnings: string[];
}

/**
 * First-order goodput ≈ 1 − δ/τ − (τ/2 + R)/M (survey §6, used by all four worked examples).
 * Flags the regime and whether the approximation is trustworthy.
 */
export function goodputFirstOrder(deltaS: number, tauS: number, mtbiS: number, restartS: number): GoodputFirstOrder {
  const warnings: string[] = [];
  const save = tauS > 0 ? deltaS / tauS : Infinity;
  const recompute = mtbiS > 0 ? tauS / (2 * mtbiS) : Infinity;
  const restart = mtbiS > 0 ? restartS / mtbiS : Infinity;
  const total = save + recompute + restart;
  const smallParameter = (tauS + deltaS) / mtbiS;
  const restartRatio = restartS / mtbiS;
  const dalyApplicable = deltaS < 2 * mtbiS;
  let validity: GoodputFirstOrder['validity'] = 'ok';
  if (smallParameter > 0.3 || restartRatio > 0.3 || total >= 1) validity = 'invalid';
  else if (smallParameter > 0.1 || restartRatio > 0.1) validity = 'caution';
  if (!dalyApplicable) warnings.push('δ ≥ 2M: checkpointing can no longer protect progress; τ = M (Daly).');
  if (smallParameter > 0.1) warnings.push(`(τ+δ)/M = ${smallParameter.toFixed(2)} is not ≪ 1; use the full Daly model.`);
  if (restartRatio > 0.1) warnings.push(`R/M = ${restartRatio.toFixed(2)}: restart-dominated regime; recovery time is the lever (SPARe, FT-HSDP).`);
  if (total >= 1) warnings.push('Loss terms sum to ≥ 1: the job cannot make progress under these parameters.');
  let regime: Regime = restart > save + recompute ? 'restart-dominated' : 'checkpoint-dominated';
  if (validity === 'invalid') regime = 'first-order-invalid';
  return {
    tauS,
    goodput: Math.max(0, 1 - total),
    terms: { save, recompute, restart, total },
    smallParameter,
    restartRatio,
    dalyApplicable,
    regime,
    validity,
    warnings,
  };
}

/** TrainMover: ETTR(N) = 1 − D/MTTF(N); wasted GPUs = N·D/MTTF(N). */
export function trainMoverEttr(restartS: number, mttfS: number, nGpus?: number): { ettr: number; wastedGpus?: number } {
  const ettr = 1 - restartS / mttfS;
  return nGpus !== undefined ? { ettr, wastedGpus: (nGpus * restartS) / mttfS } : { ettr };
}

/** Epoch AI: L(t) = c/t + gλt/2, t* = √(2c/(gλ)); λ per GPU-second, c seconds. */
export function epochTimeLost(cS: number, gpus: number, lambdaPerGpuS: number, tS?: number): { tStar: number; lossAtOptimum: number; lossAtT?: number } {
  const gl = gpus * lambdaPerGpuS;
  const tStar = Math.sqrt((2 * cS) / gl);
  const lossAtOptimum = cS / tStar + (gl * tStar) / 2;
  return tS !== undefined ? { tStar, lossAtOptimum, lossAtT: cS / tS + (gl * tS) / 2 } : { tStar, lossAtOptimum };
}

export interface ScaleRow {
  nGpus: number;
  mtbiS: number;
  tauS: number;
  goodput: GoodputFirstOrder;
  interruptionsPerDay: number;
}

/**
 * Extrapolate a per-GPU interruption rate (per GPU-hour) across job sizes with the 1/N law.
 * `restartFn` lets the recovery time grow with N (survey §5: restart is not scale-free).
 */
export function scaleTable(
  lambdaPerGpuHour: number,
  deltaS: number,
  restartFn: (nGpus: number) => number,
  sizes: number[],
  intervalModel: 'young' | 'daly3' | 'dalyExact' = 'young',
): ScaleRow[] {
  return sizes.map((n) => {
    const mtbiS = 3600 / (n * lambdaPerGpuHour);
    const tauS = intervalModel === 'young' ? youngInterval(deltaS, mtbiS) : intervalModel === 'daly3' ? dalyThreeTerm(deltaS, mtbiS) : dalyExact(deltaS, mtbiS);
    return { nGpus: n, mtbiS, tauS, goodput: goodputFirstOrder(deltaS, tauS, mtbiS, restartFn(n)), interruptionsPerDay: 86400 / mtbiS };
  });
}
