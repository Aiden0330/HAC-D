import { describe, it, expect } from 'vitest';
import { simulateJob, lifetimeFromRate, type McJobSpec } from '../src/mc/index.js';
import { simulateScenario } from '../src/mc/fromScenario.js';
import { workedExample1, workedExample3, nvl72Design, parseScenario } from '../src/scenario/index.js';
import { goodputFirstOrder, youngInterval } from '../src/checkpoint/index.js';
import { exponentialFromMean } from '../src/math/distributions.js';

function baseSpec(nGpus: number, lambdaPerGpuHour: number, recoveryS: number, deltaS = 2.43, workHours = 24 * 10): McJobSpec {
  const M = 3600 / (nGpus * lambdaPerGpuHour);
  return {
    nGpus,
    gpusPerNode: 8,
    nodesPerRack: 4,
    racksPerZone: 64,
    workHours,
    intervalS: youngInterval(deltaS, M),
    deltaS,
    recoverySampler: () => recoveryS,
    spares: { policy: 'cluster-requeue', hotSpareNodes: 0, replenish: exponentialFromMean(24) },
    classes: [{ id: 'gpu', count: nGpus, lifetime: lifetimeFromRate(lambdaPerGpuHour), repair: exponentialFromMean(1), scope: 'gpu' }],
    recovery: 'checkpoint',
  };
}

describe('Monte Carlo job simulator', () => {
  it('reproduces the first-order goodput for exponential inputs (worked example 1 at 4,096 GPUs)', () => {
    const lam = 1 / 50680;
    const spec = baseSpec(4096, lam, 4.45 * 60);
    const r = simulateJob(spec, 60, 11);
    const M = 3600 / (4096 * lam);
    const cf = goodputFirstOrder(spec.deltaS, spec.intervalS, M, 4.45 * 60).goodput;
    expect(Math.abs(r.goodput.mean - cf)).toBeLessThan(0.01);
    expect(Math.abs(r.mtbiHours.mean / (M / 3600) - 1)).toBeLessThan(0.15);
    expect(r.rows.every((x) => x.usefulHours >= spec.workHours - 1e-6)).toBe(true);
  });
  it('is deterministic for a given seed', () => {
    const spec = baseSpec(1024, 1 / 50680, 120, 2.43, 24 * 3);
    const a = simulateJob(spec, 5, 'abc');
    const b = simulateJob(spec, 5, 'abc');
    expect(a.goodput.mean).toBe(b.goodput.mean);
    expect(a.rows[0].interruptions).toBe(b.rows[0].interruptions);
  });
  it('longer recovery lowers goodput; replica recovery removes the recompute term', () => {
    const slow = simulateJob(baseSpec(4096, 1 / 50680, 600), 30, 3);
    const fast = simulateJob(baseSpec(4096, 1 / 50680, 20), 30, 3);
    expect(fast.goodput.mean).toBeGreaterThan(slow.goodput.mean);
    const replica = simulateJob({ ...baseSpec(4096, 1 / 50680, 20), recovery: 'replica', stepTimeS: 10 }, 30, 3);
    expect(replica.recomputeFraction.mean).toBeLessThan(fast.recomputeFraction.mean);
  });
  it('Weibull k < 1 with age tracking changes the interruption count only modestly in steady state', () => {
    const exp = simulateJob(baseSpec(2048, 1 / 50680, 120), 30, 5);
    const spec = baseSpec(2048, 1 / 50680, 120);
    spec.classes[0].lifetime = lifetimeFromRate(1 / 50680, 0.7);
    const wb = simulateJob(spec, 30, 5);
    // from-new Weibull units with k<1 fail more in the first days, so more interruptions early
    expect(wb.interruptionsPerDay.mean).toBeGreaterThan(exp.interruptionsPerDay.mean * 0.8);
    expect(wb.goodput.mean).toBeGreaterThan(0.8);
  });
  it('hot-spare pool: peak usage is small and blocking appears when the pool is tiny', () => {
    const spec = baseSpec(8192, 1 / 50680, 20, 2.43, 24 * 10);
    spec.classes = [{ id: 'node', count: 1024, lifetime: lifetimeFromRate(2.3 / 1000 / 24), repair: exponentialFromMean(8), scope: 'node' }];
    spec.spares = { policy: 'hot-pool', hotSpareNodes: 7, replenish: exponentialFromMean(8) };
    const r = simulateJob(spec, 40, 9);
    expect(r.peakSparesInUse.p99).toBeLessThanOrEqual(7);
    expect(r.blockedFraction.mean).toBeLessThan(0.01);
    spec.spares = { policy: 'hot-pool', hotSpareNodes: 1, replenish: exponentialFromMean(8) };
    const tiny = simulateJob(spec, 40, 9);
    expect(tiny.blockedFraction.mean).toBeGreaterThan(r.blockedFraction.mean);
  });
  it('infrastructure redundancy group only interrupts when fewer than k units remain', () => {
    const spec = baseSpec(1024, 1e-9, 60, 2.43, 24 * 20);
    spec.classes = [
      { id: 'feed', count: 2, lifetime: lifetimeFromRate(1 / 100), repair: exponentialFromMean(4), scope: 'fixed', group: { size: 2, required: 1 } },
    ];
    const r = simulateJob(spec, 40, 2);
    // single feeds fail ~ 20×24×2/100 ≈ 9.6 times per replication; both down simultaneously is rare
    expect(r.failuresByClass.feed / 40).toBeGreaterThan(5);
    expect(r.interruptionsPerDay.mean).toBeLessThan(0.3);
  });
  it('fail-slow degradation reduces goodput through the capacity factor', () => {
    const spec = baseSpec(1024, 1e-9, 60, 2.43, 24 * 10);
    spec.classes = [{ id: 'gpu', count: 1024, lifetime: lifetimeFromRate(1e-9), repair: exponentialFromMean(1), scope: 'gpu', failslow: { ratePerHour: 1e-5, durationHours: 1.2, capacity: 0.5 } }];
    const r = simulateJob(spec, 20, 4);
    expect(r.degradedLossFraction.mean).toBeGreaterThan(0);
    expect(r.goodput.mean).toBeLessThan(0.999);
  });
});

describe('scenario → Monte Carlo', () => {
  it('worked example 1 at reduced scale agrees with the closed form', () => {
    const s = parseScenario({ ...workedExample1(), workload: { ...workedExample1().workload, nGpus: 4096, durationDays: 10 } });
    const r = simulateScenario(s, { replications: 40, seed: 2 });
    expect(r.disagrees).toBe(false);
    expect(Math.abs(r.delta.goodput)).toBeLessThan(0.015);
  });
  it('runs the hot-spare and NVL72 scenarios', () => {
    const r3 = simulateScenario(workedExample3(7), { replications: 10, seed: 3, workHours: 24 * 5 });
    expect(r3.summary.peakSparesInUse.mean).toBeGreaterThanOrEqual(0);
    const r = simulateScenario(nvl72Design(), { replications: 6, seed: 4, workHours: 24 * 3 });
    expect(r.summary.goodput.mean).toBeGreaterThan(0.5);
    expect(r.spec.classes.find((c) => c.id === 'tor')!.group).toEqual({ size: 2, required: 1 });
    expect(r.spec.classes.find((c) => c.id === 'cdu')!.group).toEqual({ size: 6, required: 5 });
  });
});
