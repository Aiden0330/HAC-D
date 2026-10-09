/** Lifetime / repair-time distributions shared by closed forms and the simulator. */
import { gammaFn, normalQuantile, normalCdf } from './special.js';
import type { Rng } from './rng.js';

export type Distribution =
  | { type: 'point'; value: number }
  | { type: 'exponential'; rate: number }
  | { type: 'weibull'; shape: number; scale: number }
  | { type: 'lognormal'; mu: number; sigma: number }
  /** v2 dual-path repair time: with probability c·s Exp(mean T_a); with c(1−s) Exp(T_a) + Exp(T_m); with 1−c Exp(T_m) */
  | { type: 'dual-repair'; coverage: number; successProbability: number; autoMean: number; manualMean: number };

type DualRepairDist = Extract<Distribution, { type: 'dual-repair' }>;

function dualBranches(d: DualRepairDist): { pAuto: number; pEsc: number; pManual: number; a: number; b: number } {
  const c = d.coverage;
  const s = d.successProbability;
  return { pAuto: c * s, pEsc: c * (1 - s), pManual: 1 - c, a: 1 / Math.max(d.autoMean, 1e-12), b: 1 / Math.max(d.manualMean, 1e-12) };
}

/** CDF of Exp(a) + Exp(b) (hypoexponential; Erlang-2 when a = b). */
function hypoCdf(a: number, b: number, t: number): number {
  if (Math.abs(a - b) < 1e-9 * a) return 1 - Math.exp(-a * t) * (1 + a * t);
  return 1 - (b * Math.exp(-a * t) - a * Math.exp(-b * t)) / (b - a);
}

function hypoPdf(a: number, b: number, t: number): number {
  if (Math.abs(a - b) < 1e-9 * a) return a * a * t * Math.exp(-a * t);
  return ((a * b) / (b - a)) * (Math.exp(-a * t) - Math.exp(-b * t));
}

function dualCdf(d: DualRepairDist, t: number): number {
  const { pAuto, pEsc, pManual, a, b } = dualBranches(d);
  return pAuto * (1 - Math.exp(-a * t)) + pEsc * hypoCdf(a, b, t) + pManual * (1 - Math.exp(-b * t));
}

function dualPdf(d: DualRepairDist, t: number): number {
  const { pAuto, pEsc, pManual, a, b } = dualBranches(d);
  return pAuto * a * Math.exp(-a * t) + pEsc * hypoPdf(a, b, t) + pManual * b * Math.exp(-b * t);
}

function dualQuantile(d: DualRepairDist, p: number): number {
  if (p <= 0) return 0;
  let hi = Math.max(d.autoMean, d.manualMean);
  while (dualCdf(d, hi) < p && hi < 1e12) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (dualCdf(d, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function mean(d: Distribution): number {
  switch (d.type) {
    case 'point':
      return d.value;
    case 'exponential':
      return 1 / d.rate;
    case 'weibull':
      return d.scale * gammaFn(1 + 1 / d.shape);
    case 'lognormal':
      return Math.exp(d.mu + (d.sigma * d.sigma) / 2);
    case 'dual-repair':
      return d.coverage * d.autoMean + (1 - d.coverage * d.successProbability) * d.manualMean;
  }
}

export function median(d: Distribution): number {
  switch (d.type) {
    case 'point':
      return d.value;
    case 'exponential':
      return Math.LN2 / d.rate;
    case 'weibull':
      return d.scale * Math.pow(Math.LN2, 1 / d.shape);
    case 'lognormal':
      return Math.exp(d.mu);
    case 'dual-repair':
      return dualQuantile(d, 0.5);
  }
}

export function variance(d: Distribution): number {
  switch (d.type) {
    case 'point':
      return 0;
    case 'exponential':
      return 1 / (d.rate * d.rate);
    case 'weibull': {
      const g1 = gammaFn(1 + 1 / d.shape);
      const g2 = gammaFn(1 + 2 / d.shape);
      return d.scale * d.scale * (g2 - g1 * g1);
    }
    case 'lognormal': {
      const s2 = d.sigma * d.sigma;
      return (Math.exp(s2) - 1) * Math.exp(2 * d.mu + s2);
    }
    case 'dual-repair': {
      const { pAuto, pEsc, pManual } = dualBranches(d);
      const Ta = d.autoMean;
      const Tm = d.manualMean;
      const m2 = pAuto * 2 * Ta * Ta + pEsc * (2 * Ta * Ta + 2 * Tm * Tm + 2 * Ta * Tm) + pManual * 2 * Tm * Tm;
      const m1 = mean(d);
      return Math.max(0, m2 - m1 * m1);
    }
  }
}

export function quantile(d: Distribution, p: number): number {
  switch (d.type) {
    case 'point':
      return d.value;
    case 'exponential':
      return -Math.log1p(-p) / d.rate;
    case 'weibull':
      return d.scale * Math.pow(-Math.log1p(-p), 1 / d.shape);
    case 'lognormal':
      return Math.exp(d.mu + d.sigma * normalQuantile(p));
    case 'dual-repair':
      return dualQuantile(d, p);
  }
}

export function cdf(d: Distribution, t: number): number {
  if (t <= 0) return 0;
  switch (d.type) {
    case 'point':
      return t >= d.value ? 1 : 0;
    case 'exponential':
      return 1 - Math.exp(-d.rate * t);
    case 'weibull':
      return 1 - Math.exp(-Math.pow(t / d.scale, d.shape));
    case 'lognormal':
      return normalCdf((Math.log(t) - d.mu) / d.sigma);
    case 'dual-repair':
      return dualCdf(d, t);
  }
}

/** Hazard function h(t). */
export function hazard(d: Distribution, t: number): number {
  switch (d.type) {
    case 'point':
      return t >= d.value ? Infinity : 0;
    case 'exponential':
      return d.rate;
    case 'weibull':
      return (d.shape / d.scale) * Math.pow(t / d.scale, d.shape - 1);
    case 'lognormal': {
      const z = (Math.log(t) - d.mu) / d.sigma;
      const pdf = Math.exp(-0.5 * z * z) / (t * d.sigma * Math.sqrt(2 * Math.PI));
      return pdf / (1 - normalCdf(z));
    }
    case 'dual-repair': {
      const sf = 1 - dualCdf(d, t);
      return sf > 0 ? dualPdf(d, t) / sf : Infinity;
    }
  }
}

export function sample(d: Distribution, rng: Rng): number {
  switch (d.type) {
    case 'point':
      return d.value;
    case 'exponential':
      return rng.exponential(d.rate);
    case 'weibull':
      return rng.weibull(d.shape, d.scale);
    case 'lognormal':
      return rng.lognormal(d.mu, d.sigma);
    case 'dual-repair': {
      const u = rng.uniform();
      const c = d.coverage;
      const s = d.successProbability;
      if (u < c * s) return rng.exponential(1 / Math.max(d.autoMean, 1e-12));
      if (u < c) return rng.exponential(1 / Math.max(d.autoMean, 1e-12)) + rng.exponential(1 / Math.max(d.manualMean, 1e-12));
      return rng.exponential(1 / Math.max(d.manualMean, 1e-12));
    }
  }
}

/**
 * Conditional residual-life sample given the unit has survived to age `age`
 * (needed for age-tracking in simulation). Uses inverse-CDF conditioning.
 */
export function sampleResidual(d: Distribution, age: number, rng: Rng): number {
  if (age <= 0) return sample(d, rng);
  switch (d.type) {
    case 'point':
      return Math.max(0, d.value - age);
    case 'exponential':
      return rng.exponential(d.rate);
    case 'weibull': {
      // (T − age | T > age): T = scale * ( (age/scale)^k − ln U )^(1/k)
      const u = rng.uniformOpen();
      const t = d.scale * Math.pow(Math.pow(age / d.scale, d.shape) - Math.log(u), 1 / d.shape);
      return t - age;
    }
    case 'lognormal': {
      const sAge = 1 - cdf(d, age);
      const u = rng.uniform();
      const p = 1 - sAge * (1 - u); // uniform on [F(age), 1)
      return quantile(d, Math.min(p, 1 - 1e-16)) - age;
    }
    case 'dual-repair': {
      const sAge = 1 - dualCdf(d, age);
      const u = rng.uniform();
      const p = 1 - sAge * (1 - u);
      return dualQuantile(d, Math.min(p, 1 - 1e-16)) - age;
    }
  }
}

/** Weibull with given mean and shape (mean-matched to an exponential 1/λ when mean = 1/λ). */
export function weibullFromMean(meanValue: number, shape: number): Distribution {
  return { type: 'weibull', shape, scale: meanValue / gammaFn(1 + 1 / shape) };
}

/** Lognormal with given mean and median (e.g. LANL repair: mean 355 min, median 54 min). */
export function lognormalFromMeanMedian(meanValue: number, medianValue: number): Distribution {
  const sigma = Math.sqrt(2 * Math.log(meanValue / medianValue));
  return { type: 'lognormal', mu: Math.log(medianValue), sigma };
}

/** Lognormal with given mean and coefficient of variation. */
export function lognormalFromMeanCv(meanValue: number, cv: number): Distribution {
  const s2 = Math.log(1 + cv * cv);
  return { type: 'lognormal', mu: Math.log(meanValue) - s2 / 2, sigma: Math.sqrt(s2) };
}

/** Exponential with the given mean. */
export function exponentialFromMean(meanValue: number): Distribution {
  return { type: 'exponential', rate: 1 / meanValue };
}

/**
 * Minimum of N i.i.d. Weibull(shape, scale) lifetimes is Weibull(shape, scale·N^(−1/shape)).
 * For shape = 1 this is the exponential 1/N law.
 */
export function weibullSeriesOfN(d: Distribution & { type: 'weibull' }, n: number): Distribution {
  return { type: 'weibull', shape: d.shape, scale: d.scale * Math.pow(n, -1 / d.shape) };
}
