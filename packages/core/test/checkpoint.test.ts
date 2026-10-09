import { describe, it, expect } from 'vitest';
import {
  youngInterval, dalyLowestOrder, dalyThreeTerm, dalyExact, dalyGoodput, saxenaOptimalPeriod, saxenaAvailability,
  goodputFirstOrder, trainMoverEttr, scaleTable, epochTimeLost, metaRscInterval,
} from '../src/checkpoint/index.js';

const M1 = 11135; // s, worked example 1 (MTBI 185.6 min)
const delta = 2.43;

describe('worked example 1 (survey Table 6-5)', () => {
  it('intervals', () => {
    expect(youngInterval(delta, M1)).toBeCloseTo(232.6, 1);
    expect(dalyLowestOrder(delta, M1)).toBeCloseTo(230.2, 1);
    expect(dalyThreeTerm(delta, M1)).toBeCloseTo(231.0, 1);
    expect(dalyExact(delta, M1)).toBeCloseTo(dalyThreeTerm(delta, M1), 0);
  });
  it('goodput for R = 0 / 4.45 min / 6.47 min', () => {
    const tau = youngInterval(delta, M1);
    expect(goodputFirstOrder(delta, tau, M1, 0).goodput).toBeCloseTo(0.979, 3);
    expect(goodputFirstOrder(delta, tau, M1, 4.45 * 60).goodput).toBeCloseTo(0.955, 3);
    expect(goodputFirstOrder(delta, tau, M1, 6.47 * 60).goodput).toBeCloseTo(0.944, 3);
  });
  it('availability-optimal interval (Saxena) 237.8 s', () => {
    expect(saxenaOptimalPeriod(M1, delta, 4.45 * 60)).toBeCloseTo(237.8, 1);
  });
});

describe('worked example 2 (survey Table 6-6) and regime flags', () => {
  it('scale table reproduces M, τ and goodput', () => {
    const lam = 1 / 50680;
    const rows = scaleTable(lam, delta, () => 4.45 * 60, [16384, 65536, 131072]);
    expect(rows[0].mtbiS / 60).toBeCloseTo(185.6, 1);
    expect(rows[1].mtbiS / 60).toBeCloseTo(46.4, 1);
    expect(rows[2].mtbiS / 60).toBeCloseTo(23.2, 1);
    expect(rows[1].tauS).toBeCloseTo(116.3, 1);
    expect(rows[2].tauS).toBeCloseTo(82.2, 1);
    expect(rows[1].goodput.goodput).toBeCloseTo(0.862, 3);
    expect(rows[2].goodput.goodput).toBeCloseTo(0.749, 3);
    const rows10 = scaleTable(lam, delta, () => 600, [65536, 131072]);
    expect(rows10[0].goodput.goodput).toBeCloseTo(0.743, 3);
    expect(rows10[1].goodput.goodput).toBeCloseTo(0.51, 2);
    expect(rows10[1].goodput.restartRatio).toBeCloseTo(0.43, 2);
    expect(rows10[1].goodput.validity).toBe('invalid');
    expect(rows[0].goodput.validity).toBe('ok');
  });
  it('restart-dominated regime is detected', () => {
    const g = goodputFirstOrder(2.43, 232.6, 11135, 267);
    expect(g.regime).toBe('restart-dominated');
    expect(g.terms.restart).toBeGreaterThan(g.terms.save + g.terms.recompute);
  });
});

describe('Daly 2006 figures', () => {
  it('M = 24 h / 6 h / 15 min with δ = 5 min → 117 / 57 / 9.1 min', () => {
    expect(dalyThreeTerm(300, 24 * 3600) / 60).toBeCloseTo(117, 0);
    expect(dalyThreeTerm(300, 6 * 3600) / 60).toBeCloseTo(57, 0);
    expect(dalyThreeTerm(300, 900) / 60).toBeCloseTo(9.1, 1);
    expect(dalyExact(300, 24 * 3600) / 60).toBeCloseTo(117, 0);
    expect(dalyExact(300, 900) / 60).toBeCloseTo(9.1, 0);
  });
  it('exact optimum minimises the full wall-time model', () => {
    const M = 900;
    const d = 300;
    const tau = dalyExact(d, M);
    const g0 = dalyGoodput(tau, d, M, 600);
    expect(dalyGoodput(tau * 0.9, d, M, 600)).toBeLessThan(g0);
    expect(dalyGoodput(tau * 1.1, d, M, 600)).toBeLessThan(g0);
  });
  it('δ ≥ 2M gives τ = M', () => {
    expect(dalyThreeTerm(2000, 900)).toBe(900);
    expect(dalyExact(2000, 900)).toBe(900);
  });
});

describe('Saxena 2024', () => {
  it('availability-optimal vs Young', () => {
    expect(saxenaOptimalPeriod(3600, 30, 16 * 60) / 60).toBeCloseTo(9.23, 2);
    expect(youngInterval(30, 3600) / 60).toBeCloseTo(7.74, 1);
    expect(saxenaOptimalPeriod(3600, 1, 240) / 60).toBeCloseTo(1.477, 2);
    expect(youngInterval(1, 3600) / 60).toBeCloseTo(1.414, 2);
    const aOpt = saxenaAvailability(saxenaOptimalPeriod(3600, 30, 960), 3600, 30, 960);
    const aYoung = saxenaAvailability(youngInterval(30, 3600), 3600, 30, 960);
    expect(aOpt).toBeGreaterThan(aYoung);
    expect(aOpt - aYoung).toBeLessThan(0.002);
  });
});

describe('other closed forms', () => {
  it('TrainMover ETTR(N)', () => {
    const D = 4.45 * 60;
    const expected = [[216, 0.9794], [108, 0.9588], [54, 0.9176], [27, 0.8352], [14, 0.6821]] as const;
    for (const [m, e] of expected) expect(trainMoverEttr(D, m * 60).ettr).toBeCloseTo(e, 3);
    expect(trainMoverEttr(D, 216 * 60, 8192).wastedGpus).toBeCloseTo(169, 0);
  });
  it('Lablup Young interval 44.9 min', () => {
    expect(youngInterval(18, 56.2 * 3600) / 60).toBeCloseTo(44.9, 0);
  });
  it('Epoch time-lost model: t* ≈ 4 min, loss ≈ 2.1 %', () => {
    const r = epochTimeLost(2.43, 16384, 1 / (50000 * 3600));
    expect(r.tStar / 60).toBeCloseTo(4.0, 0);
    expect(r.lossAtOptimum).toBeCloseTo(0.021, 2);
  });
  it('Meta RSC interval equals Young with M = 1/(N r_f)', () => {
    expect(metaRscInterval(300, 2048, 6.5 / 1000 / 24)).toBeCloseTo(youngInterval(300, 3600 / (2048 * 6.5 / 1000 / 24)), 9);
  });
});
