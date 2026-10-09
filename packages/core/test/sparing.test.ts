import { describe, it, expect } from 'vitest';
import { hotSparesBinomial, hotSparesPoisson, blockedProbabilityPoisson, blockedProbabilityBinomial, repairPipelineSpares, sparesForBlockedTarget, blockMtbfHours } from '../src/sparing/index.js';
import { binomSf, binomQuantile } from '../src/math/special.js';

describe('worked example 3 (survey Table 6-7)', () => {
  it('binomial P99 / P99.9 hot spares', () => {
    expect(hotSparesBinomial(1024, 2.3 / 1000, 0.99)).toBe(7);
    expect(hotSparesBinomial(1024, 2.3 / 1000, 0.999)).toBe(8);
    expect(hotSparesBinomial(1024, 6.5 / 1000, 0.99)).toBe(13);
    expect(hotSparesBinomial(1024, 6.5 / 1000, 0.999)).toBe(16);
  });
  it('Poisson (Meta) spares for MTTR 8 h and 2.2 h', () => {
    expect(hotSparesPoisson(1024, 2.3 / 1000 / 24, 8)).toBe(3);
    expect(hotSparesPoisson(1024, 2.3 / 1000 / 24, 2.2)).toBe(2);
    expect(hotSparesPoisson(1024, 6.5 / 1000 / 24, 8)).toBe(6);
    expect(hotSparesPoisson(1024, 6.5 / 1000 / 24, 2.2)).toBe(3);
  });
});

describe('blocked probability', () => {
  it('Poisson and binomial forms agree when R ≪ L and both fall with R', () => {
    const p = blockedProbabilityPoisson(256, 24, 1000, 22);
    const b = blockedProbabilityBinomial(256, 24, 1000, 22);
    expect(p).toBeLessThan(1e-4);
    expect(b).toBeLessThan(1e-4);
    // Poisson uses m = L·MTTR/MTBF (6.14), the exact form a binomial with mean L·u (6.0): same order, Poisson heavier
    expect(p).toBeGreaterThan(b);
    expect(p / b).toBeLessThan(5);
    expect(blockedProbabilityPoisson(256, 24, 1000, 5)).toBeGreaterThan(p);
    expect(sparesForBlockedTarget(256, 24, 1000, 1e-6)).toBeGreaterThanOrEqual(sparesForBlockedTarget(256, 24, 1000, 1e-3));
  });
  it('block MTBF for Meta demo parameters', () => {
    expect(blockMtbfHours(18, 20000, 10000)).toBeCloseTo(1000, 9);
  });
});

describe('ByteRobust and Ironwood inferences', () => {
  it('p_daily ≈ 0.1 % gives 4 hot spares for 1,024 machines', () => {
    expect(binomQuantile(1024, 0.001, 0.99)).toBe(4);
    expect(binomQuantile(512, 0.0012, 0.99)).toBe(3);
    expect(binomQuantile(256, 0.0012, 0.99)).toBe(2);
  });
  it('Ironwood: P(X ≥ 130 of 144) = 0.95 implies p ≈ 0.93–0.94 and k99 ≈ 127–128', () => {
    const f = (p: number) => binomSf(144, 130, p);
    let lo = 0.9;
    let hi = 0.99;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < 0.95) lo = mid;
      else hi = mid;
    }
    const p95 = (lo + hi) / 2;
    expect(p95).toBeGreaterThan(0.93);
    expect(p95).toBeLessThan(0.94);
    let k99 = 144;
    while (k99 > 0 && binomSf(144, k99, p95) < 0.99) k99--;
    expect([127, 128]).toContain(k99);
  });
  it('repair pipeline quantile', () => {
    const r = repairPipelineSpares(16384, 1 / 50680, 0.587, 24 * 3, 0.99);
    expect(r.mean).toBeCloseTo((16384 / 50680) * 0.587 * 72, 6);
    expect(r.quantile).toBeGreaterThan(r.mean);
  });
});
