/**
 * Summary statistics of Monte Carlo samples (docs/MODEL_REFERENCE.md §21): mean, sample sd, a Student-t 95 %
 * half-width (n − 1 degrees of freedom; the normal 1.96 for large n), type-7 quantiles (linear interpolation, as R,
 * NumPy and the ReMAP tool), and the Wilson score interval for a probability estimated as a share of samples.
 * The intervals cover the sampling error of the simulation only, never the uncertainty of the inputs.
 */
import { studentTQuantile, wilsonInterval } from './special.js';

export interface SummaryStat {
  mean: number;
  sd: number;
  /** half-width of the 95 % confidence interval of the mean */
  ci95: number;
  p05: number;
  p50: number;
  p95: number;
  n: number;
  ciMethod: 'student-t' | 'none';
}

/** Type-7 quantile of a sorted sample. */
export function quantileType7(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function summaryStat(xs: number[]): SummaryStat {
  const n = xs.length;
  if (!n) return { mean: NaN, sd: NaN, ci95: NaN, p05: NaN, p50: NaN, p95: NaN, n: 0, ciMethod: 'none' };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const s = [...xs].sort((a, b) => a - b);
  const ci95 = n > 1 ? (studentTQuantile(0.975, n - 1) * sd) / Math.sqrt(n) : 0;
  return { mean, sd, ci95, p05: quantileType7(s, 0.05), p50: quantileType7(s, 0.5), p95: quantileType7(s, 0.95), n, ciMethod: n > 1 ? 'student-t' : 'none' };
}

export interface ProportionEstimate {
  p: number;
  low: number;
  high: number;
  k: number;
  n: number;
  confidence: number;
  method: 'wilson';
}

/** Share of samples meeting a condition with its Wilson interval. */
export function proportionEstimate(k: number, n: number, confidence = 0.95): ProportionEstimate {
  const { low, high } = wilsonInterval(k, n, confidence);
  return { p: n > 0 ? k / n : NaN, low, high, k, n, confidence, method: 'wilson' };
}

/** Verdict of "P(window ≥ target) ≥ confidence" from the Wilson bounds: supported when the lower bound reaches it, below when the upper bound misses it, uncertain otherwise. */
export function proportionVerdict(est: ProportionEstimate, required: number): 'supported' | 'uncertain' | 'below' {
  if (est.low >= required) return 'supported';
  if (est.high < required) return 'below';
  return 'uncertain';
}

/**
 * The smallest sample size at which "supported" is reachable at all: with every sample passing the Wilson lower bound is
 * n / (n + z²), so n ≥ required · z² / (1 − required) — 35 windows for P ≥ 0.9 at 95 %. Fewer windows can only give
 * 'uncertain' or 'below' (fifth review D7).
 */
export function minWindowTrials(required = 0.9, confidence = 0.95): number {
  for (let n = 1; n <= 1_000_000; n++) if (wilsonInterval(n, n, confidence).low >= required) return n;
  return Infinity;
}
