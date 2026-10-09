import { describe, it, expect } from 'vitest';
import { Ctmc, kOfNRepairable, standby, degradedUnit, sdcLatentUnit, birthDeathSteadyState } from '../src/ctmc/index.js';
import { binomCdf } from '../src/math/special.js';

describe('CTMC core', () => {
  it('two-state steady state and transient', () => {
    const lam = 0.01;
    const mu = 0.5;
    const c = new Ctmc([{ id: 'up', up: true, capacity: 1 }, { id: 'down', up: false, capacity: 0 }], [
      { from: 0, to: 1, rate: lam },
      { from: 1, to: 0, rate: mu },
    ]);
    const pi = c.steadyState();
    expect(pi[0]).toBeCloseTo(mu / (lam + mu), 12);
    expect(c.failureFrequency(pi)).toBeCloseTo((mu / (lam + mu)) * lam, 12);
    const t = 3;
    const pt = c.transient(new Float64Array([1, 0]), t);
    expect(pt[0]).toBeCloseTo(mu / (lam + mu) + (lam / (lam + mu)) * Math.exp(-(lam + mu) * t), 8);
    expect(c.meanTimeToAbsorption(new Set([1]), 0)).toBeCloseTo(1 / lam, 10);
  });
  it('birth-death steady state is binomial for independent units', () => {
    const n = 5;
    const lam = 0.02;
    const mu = 0.2;
    const lambdas = Array.from({ length: n }, (_, j) => (n - j) * lam);
    const mus = Array.from({ length: n + 1 }, (_, j) => j * mu);
    const pi = birthDeathSteadyState(lambdas, mus);
    const u = lam / (lam + mu);
    for (let j = 0; j <= n; j++) {
      const pmf = binomCdf(n, j, u) - (j > 0 ? binomCdf(n, j - 1, u) : 0);
      expect(pi[j]).toBeCloseTo(pmf, 10);
    }
  });
});

describe('k-of-n repairable (textbook results, survey Fig. 4-3)', () => {
  const lam = 0.01;
  it('two hot units without repair: MTTF = 3/(2λ)', () => {
    expect(kOfNRepairable(2, 1, lam, 0).mttfFromNew).toBeCloseTo(3 / (2 * lam), 9);
  });
  it('two units with one repairman: MTTF = (3λ+μ)/(2λ²)', () => {
    const mu = 0.1;
    expect(kOfNRepairable(2, 1, lam, mu, 1).mttfFromNew).toBeCloseTo((3 * lam + mu) / (2 * lam * lam), 6);
  });
  it('k = n reduces to a series system: MTTF = 1/(Nλ)', () => {
    expect(kOfNRepairable(100, 100, lam, 0.5).mttfFromNew).toBeCloseTo(1 / (100 * lam), 9);
  });
  it('steady-state availability equals the binomial sum (survey Fig. 4-1b)', () => {
    const n = 1032;
    const k = 1024;
    const l = 11.6e-6;
    const mttr = 24;
    const r = kOfNRepairable(n, k, l, 1 / mttr);
    const u = (l * mttr) / (1 + l * mttr);
    expect(r.availability).toBeCloseTo(binomCdf(n, n - k, u), 12);
    expect(r.expectedFailed).toBeCloseTo(n * u, 9);
    expect(r.mttfFromNew).toBeGreaterThan(1 / (n * l));
  });
  it('proportional capacity for inference replicas', () => {
    const r = kOfNRepairable(4, 2, 0.1, 1, Infinity, 'proportional');
    expect(r.capacity).toBeLessThanOrEqual(r.availability + 1e-12);
    expect(r.capacity).toBeGreaterThan(0);
  });
});

describe('standby', () => {
  const lam = 0.01;
  it('cold standby without repair: MTTF = 2/λ; hot: 3/(2λ); switch p_s: (1+p_s)/λ', () => {
    expect(standby(2, lam, 0, 0, 1).mttfFromNew).toBeCloseTo(2 / lam, 8);
    expect(standby(2, lam, 0, 1, 1).mttfFromNew).toBeCloseTo(3 / (2 * lam), 8);
    expect(standby(2, lam, 0, 0, 0.9).mttfFromNew).toBeCloseTo(1.9 / lam, 8);
    expect(standby(3, lam, 0, 0, 1).mttfFromNew).toBeCloseTo(3 / lam, 8);
  });
  it('with repair, availability is below 1 and above the single-unit value', () => {
    const r = standby(2, lam, 0.1, 0, 1);
    expect(r.availability).toBeGreaterThan(0.1 / (lam + 0.1));
    expect(r.availability).toBeLessThan(1);
  });
});

describe('degraded and latent units', () => {
  it('degraded unit with no degradation reduces to two-state', () => {
    const d = degradedUnit(0.01, 0.5, 0, 1, 0.5);
    expect(d.availability).toBeCloseTo(0.5 / 0.51, 10);
    expect(d.capacity).toBeCloseTo(d.availability, 10);
  });
  it('degraded time lowers capacity but not availability', () => {
    const d = degradedUnit(0.001, 0.5, 0.01, 1.2, 0.33);
    expect(d.availability).toBeGreaterThan(d.capacity);
    expect(d.piDegraded).toBeCloseTo(0.01 * 1.2 * d.piUp, 2);
  });
  it('SDC latent fraction ≈ λ_sdc · T_expose for small rates', () => {
    const s = sdcLatentUnit(1e-4, 0.5, 1e-5, 10);
    expect(s.latentFraction).toBeCloseTo(1e-5 * 10, 5);
    expect(s.piUp + s.piLatent + s.piRepair + s.piDown).toBeCloseTo(1, 12);
  });
});
