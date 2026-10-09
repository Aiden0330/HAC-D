import { describe, it, expect } from 'vitest';
import { composeMttr, recoveryTimeS, recoverySampler, PIPELINE_PRESETS, stageMeanS } from '../src/mttr/index.js';
import { Rng } from '../src/math/rng.js';
import { trainMoverCostPerDay, lostDollarsPerDay, AWS_CAPACITY_BLOCK_PRICE_PER_GPU_HOUR, compareOptionCosts } from '../src/cost/index.js';
import { tornado, sweep2D, elasticity, logspace } from '../src/sensitivity/index.js';
import { goodputFirstOrder, youngInterval } from '../src/checkpoint/index.js';

describe('MTTR pipeline', () => {
  it('TrainMover preset totals 6.47 min at 8192 GPUs', () => {
    const c = composeMttr(PIPELINE_PRESETS['trainmover-8192-restart'], 8192);
    expect(c.totalS / 60).toBeCloseTo(6.47, 2);
    expect(c.dominant).toBe('restart');
  });
  it('scale laws grow and shrink as expected', () => {
    const p = PIPELINE_PRESETS['baseline-timeout-manual'];
    expect(recoveryTimeS(p, 32768)).toBeGreaterThan(recoveryTimeS(p, 8192));
    expect(recoveryTimeS(p, 1024)).toBeLessThan(recoveryTimeS(p, 8192));
    const auto = PIPELINE_PRESETS['automated-probe-standby'];
    expect(recoveryTimeS(auto, 16384)).toBeLessThan(recoveryTimeS(p, 16384) / 10);
  });
  it('bandwidth and order-statistic laws', () => {
    expect(stageMeanS({ name: 'load', value: 100, scale: { type: 'bandwidth', sizeGB: 4860, bandwidthGBps: 2000, bandwidthScalesWithN: false, refN: 1 } }, 5)).toBeCloseTo(2.43, 6);
    const os = { name: 'restart' as const, value: 100, scale: { type: 'order-statistic' as const, refN: 1024, cv: 0.2 } };
    expect(stageMeanS(os, 1024)).toBeCloseTo(100, 9);
    expect(stageMeanS(os, 16384)).toBeGreaterThan(100);
  });
  it('sampler mean matches the composed mean', () => {
    const p = PIPELINE_PRESETS['automated-probe-standby'];
    const s = recoverySampler(p, 4096, new Rng(3));
    let acc = 0;
    for (let i = 0; i < 1000; i++) acc += s();
    expect(acc / 1000).toBeCloseTo(recoveryTimeS(p, 4096), 6);
  });
});

describe('cost', () => {
  it('TrainMover $/day at 64K and 128K GPUs ≈ $0.95M and $3.63M', () => {
    expect(trainMoverCostPerDay(65536, 0.8352) / 1e6).toBeCloseTo(0.95, 1);
    expect(trainMoverCostPerDay(131072, 0.6821) / 1e6).toBeCloseTo(3.66, 1);
    expect(lostDollarsPerDay({ nGpus: 65536, pricePerGpuHour: AWS_CAPACITY_BLOCK_PRICE_PER_GPU_HOUR }, 0.8352) / 1e6).toBeCloseTo(0.95, 1);
  });
  it('option comparison deltas are relative to the first option', () => {
    const rows = compareOptionCosts({ nGpus: 16384, pricePerGpuHour: 3 }, [
      { id: 'a', name: 'base', goodput: 0.95, spareGpus: 0 },
      { id: 'b', name: 'spares', goodput: 0.97, spareGpus: 64 },
    ]);
    expect(rows[0].deltaVsBase).toBe(0);
    expect(rows[1].deltaVsBase).toBeLessThan(0);
  });
});

describe('sensitivity', () => {
  type P = { delta: number; M: number; R: number };
  const metric = (p: P) => goodputFirstOrder(p.delta, youngInterval(p.delta, p.M), p.M, p.R).goodput;
  const base: P = { delta: 2.43, M: 11135, R: 267 };
  it('tornado ranks recovery time above δ for worked example 1', () => {
    const rows = tornado(base, [
      { id: 'R', low: (b) => ({ ...b, R: b.R / 2 }), high: (b) => ({ ...b, R: b.R * 2 }) },
      { id: 'delta', low: (b) => ({ ...b, delta: b.delta / 2 }), high: (b) => ({ ...b, delta: b.delta * 2 }) },
      { id: 'M', low: (b) => ({ ...b, M: b.M / 2 }), high: (b) => ({ ...b, M: b.M * 2 }) },
    ], metric);
    expect(rows[0].id === 'M' || rows[0].id === 'R').toBe(true);
    expect(rows.find((r) => r.id === 'delta')!.swing).toBeLessThan(rows.find((r) => r.id === 'R')!.swing);
  });
  it('elasticity of loss to λ is between 0.5 and 1 (√ for checkpoint term, linear for restart)', () => {
    const loss = (p: P) => 1 - metric(p);
    const e = elasticity(base, (b, f) => ({ ...b, M: b.M / f }), loss);
    expect(e).toBeGreaterThan(0.5);
    expect(e).toBeLessThan(1);
  });
  it('2-D sweep shape', () => {
    const g = sweep2D(base, logspace(60, 600, 4), [1000, 10000], (b, x, y) => ({ ...b, R: x, M: y }), metric);
    expect(g.values.length).toBe(2);
    expect(g.values[0].length).toBe(4);
    expect(g.values[1][0]).toBeGreaterThan(g.values[0][0]);
  });
});
