import { describe, it, expect } from 'vitest';
import {
  lgamma, choose, binomCdf, binomSf, binomQuantile, poissonCdf, poissonQuantile, lambertW0,
  normalCdf, normalQuantile, erf,
} from '../src/math/special.js';
import { Rng } from '../src/math/rng.js';
import { mean, median, weibullFromMean, lognormalFromMeanMedian, weibullSeriesOfN, quantile, sampleResidual } from '../src/math/distributions.js';
import { solveDense, solveTridiagonal } from '../src/math/linalg.js';

describe('special functions', () => {
  it('lgamma matches known values', () => {
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lgamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(lgamma(1)).toBeCloseTo(0, 12);
    expect(lgamma(2.4285714)).toBeCloseTo(Math.log(1.265), 2);
  });
  it('choose and binomial tails', () => {
    expect(choose(10, 3)).toBeCloseTo(120, 9);
    expect(binomCdf(10, 3, 0.5)).toBeCloseTo(176 / 1024, 12);
    expect(binomSf(10, 4, 0.5)).toBeCloseTo(1 - 176 / 1024, 12);
    expect(binomCdf(5, 5, 0.3)).toBe(1);
    expect(binomCdf(5, -1, 0.3)).toBe(0);
    // large-n stability
    expect(binomCdf(100000, 50000, 0.5)).toBeCloseTo(0.5, 2);
  });
  it('binomial quantiles reproduce worked example 3 (ByteRobust-style P99)', () => {
    expect(binomQuantile(1024, 2.3 / 1000, 0.99)).toBe(7);
    expect(binomQuantile(1024, 2.3 / 1000, 0.999)).toBe(8);
    expect(binomQuantile(1024, 6.5 / 1000, 0.99)).toBe(13);
    expect(binomQuantile(1024, 6.5 / 1000, 0.999)).toBe(16);
    expect(binomQuantile(1024, 0.001, 0.99)).toBe(4);
  });
  it('poisson quantiles reproduce worked example 3 (Meta Poisson spares)', () => {
    expect(poissonQuantile(1024 * (2.3 / 1000) * (8 / 24), 0.99)).toBe(3);
    expect(poissonQuantile(1024 * (2.3 / 1000) * (2.2 / 24), 0.99)).toBe(2);
    expect(poissonQuantile(1024 * (6.5 / 1000) * (8 / 24), 0.99)).toBe(6);
    expect(poissonQuantile(1024 * (6.5 / 1000) * (2.2 / 24), 0.99)).toBe(3);
    expect(poissonCdf(2, 2)).toBeCloseTo(Math.exp(-2) * (1 + 2 + 2), 12);
  });
  it('Lambert W principal branch', () => {
    expect(lambertW0(0)).toBe(0);
    expect(lambertW0(1)).toBeCloseTo(0.5671432904097838, 12);
    expect(lambertW0(Math.E)).toBeCloseTo(1, 12);
    expect(lambertW0(-1 / Math.E)).toBe(-1);
    for (const z of [-0.36, -0.3, -0.1, 0.01, 0.5, 2, 10, 1e3]) {
      const w = lambertW0(z);
      expect(w * Math.exp(w)).toBeCloseTo(z, 10);
    }
    // near the branch point: identity holds to full precision and W ≈ −1 + p − p²/3, p = √(2(ez+1))
    const eps = 1e-4;
    const z = -Math.exp(-1 - eps);
    const w = lambertW0(z);
    expect(w * Math.exp(w)).toBeCloseTo(z, 14);
    const p = Math.sqrt(2 * (Math.E * z + 1));
    expect(w).toBeCloseTo(-1 + p - (p * p) / 3, 6);
  });
  it('normal distribution helpers', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 7);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 9);
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(erf(1)).toBeCloseTo(0.8427007929497149, 12);
  });
});

describe('distributions', () => {
  it('weibull mean-matching and median/mean ratio for k = 0.7 ≈ 0.47 (SIGMA)', () => {
    const d = weibullFromMean(100, 0.7);
    expect(mean(d)).toBeCloseTo(100, 9);
    expect(median(d) / mean(d)).toBeCloseTo(0.468, 2);
  });
  it('lognormal from mean and median (LANL repair 355 / 54 min)', () => {
    const d = lognormalFromMeanMedian(355, 54);
    expect(mean(d)).toBeCloseTo(355, 6);
    expect(median(d)).toBeCloseTo(54, 9);
    expect(quantile(d, 0.5)).toBeCloseTo(54, 6);
  });
  it('weibull series of N reduces to 1/N for shape 1', () => {
    const d = weibullSeriesOfN({ type: 'weibull', shape: 1, scale: 1000 }, 10);
    expect(d.type === 'weibull' && d.scale).toBeCloseTo(100, 9);
  });
  it('residual sampling for exponential is memoryless and deterministic by seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const d = { type: 'exponential', rate: 0.1 } as const;
    expect(sampleResidual(d, 5, a)).toBeCloseTo(sampleResidual(d, 5, b), 12);
  });
});

describe('rng', () => {
  it('is deterministic and uniform in [0,1)', () => {
    const r1 = new Rng('seed');
    const r2 = new Rng('seed');
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const u = r1.uniform();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(u).toBe(r2.uniform());
      sum += u;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });
  it('exponential and weibull samples have the right mean', () => {
    const r = new Rng(7);
    let s = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) s += r.exponential(0.5);
    expect(s / n).toBeCloseTo(2, 1);
    s = 0;
    for (let i = 0; i < n; i++) s += r.weibull(2, 1);
    expect(s / n).toBeCloseTo(Math.sqrt(Math.PI) / 2, 1);
  });
});

describe('linalg', () => {
  it('solves dense and tridiagonal systems', () => {
    const A = new Float64Array([4, 1, 0, 1, 4, 1, 0, 1, 4]);
    const b = new Float64Array([1, 2, 3]);
    const x = solveDense(A, b, 3);
    expect(4 * x[0] + x[1]).toBeCloseTo(1, 12);
    expect(x[0] + 4 * x[1] + x[2]).toBeCloseTo(2, 12);
    expect(x[1] + 4 * x[2]).toBeCloseTo(3, 12);
    const y = solveTridiagonal(new Float64Array([0, 1, 1]), new Float64Array([4, 4, 4]), new Float64Array([1, 1, 0]), new Float64Array([1, 2, 3]));
    expect(y[0]).toBeCloseTo(x[0], 12);
    expect(y[2]).toBeCloseTo(x[2], 12);
  });
});
