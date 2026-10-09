/**
 * v2 model tests: dual-path repair, k-of-n with dual repair / switchover, sub-health units,
 * straggler and plane-loss laws, recovery ladder, original-vs-compensated transforms.
 * Reductions to the v1 models are exact; closed forms from docs/MODEL_REFERENCE.md §10–§17.
 */
import { describe, it, expect } from 'vitest';
import { kOfNRepairable, degradedUnit, standby } from '../src/ctmc/index.js';
import {
  dualRepairUnit, manualOnly, meanRepairH, kOfNGroup, subhealthUnit, stragglerLaw, planeLossPerformance, subhealthRateFromProbability,
} from '../src/ctmc/repair.js';
import { ladderExpectation, ladderSampler, LADDER_PRESETS } from '../src/recovery/ladder.js';
import { Rng } from '../src/math/rng.js';
import { evaluate, transformCompensation, compensationWaterfall, indexResults, type Block } from '../src/rbd/index.js';

const A = { coverage: 0.9, successProbability: 0.95, autoMttrH: 0.1, manualMttrH: 6 };

describe('dual-path repair unit (§10)', () => {
  it('matches the alternating-renewal closed form', () => {
    const lambda = 1e-3;
    const r = dualRepairUnit(lambda, A);
    const ER = 0.9 * 0.1 + (1 - 0.9 * 0.95) * 6;
    expect(meanRepairH(A)).toBeCloseTo(ER, 12);
    expect(r.availability).toBeCloseTo(1 / (1 + lambda * ER), 12);
    expect(r.failureFrequency).toBeCloseTo(lambda * r.availability, 12);
    expect(r.autoDowntimeShare).toBeCloseTo((0.9 * 0.1) / ER, 10);
    expect(r.humanFraction).toBeCloseTo(1 - 0.9 * 0.95, 12);
  });
  it('legacy manual-only input reproduces the two-state unit', () => {
    const r = dualRepairUnit(2e-4, manualOnly(24));
    expect(r.availability).toBeCloseTo(1 / (1 + 2e-4 * 24), 12);
    expect(r.piDownAuto).toBe(0);
  });
});

describe('k-of-n group with dual repair and switchover (§11)', () => {
  it('reduces to the v1 birth–death chain when c = 0 and switchover is perfect', () => {
    const v1 = kOfNRepairable(3, 2, 1e-3, 1 / 6, 1, 'proportional');
    const v2 = kOfNGroup({ n: 3, k: 2, lambda: 1e-3, repair: manualOnly(6), crews: 1, capacityMode: 'proportional' });
    expect(v2.availability).toBeCloseTo(v1.availability, 12);
    expect(v2.failureFrequency).toBeCloseTo(v1.failureFrequency, 12);
    expect(v2.mttfFromNew).toBeCloseTo(v1.mttfFromNew, 6);
    expect(v2.capacity).toBeCloseTo(v1.capacity, 12);
    expect(v2.approximate).toBe(false);
  });
  it('dual repair with equal auto and manual times equals a single-path chain with that time', () => {
    const same = { coverage: 0.7, successProbability: 1, autoMttrH: 4, manualMttrH: 4 };
    const v1 = kOfNRepairable(4, 2, 2e-3, 1 / 4, Infinity, 'binary');
    const v2 = kOfNGroup({ n: 4, k: 2, lambda: 2e-3, repair: same });
    expect(v2.availability).toBeCloseTo(v1.availability, 12);
    expect(v2.failureFrequency).toBeCloseTo(v1.failureFrequency, 12);
  });
  it('imperfect switchover lowers availability and adds switch-failed probability', () => {
    const perfect = kOfNGroup({ n: 2, k: 1, lambda: 1e-3, repair: manualOnly(8) });
    const imperfect = kOfNGroup({ n: 2, k: 1, lambda: 1e-3, repair: manualOnly(8), switchover: { successProbability: 0.9, failureRecoveryHours: 2, outageS: 30 } });
    expect(imperfect.availability).toBeLessThan(perfect.availability);
    expect(imperfect.switchFailedProbability).toBeGreaterThan(0);
    expect(imperfect.switchoverOutage).toBeCloseTo(imperfect.switchoverFrequency * (30 / 3600), 12);
    expect(imperfect.availabilityEffective).toBeCloseTo(imperfect.availability - imperfect.switchoverOutage, 12);
    // switch-failed probability ≈ (frequency of failed switches) × T_sf
    const failedFreq = imperfect.switchoverFrequency * (0.1 / 0.9);
    expect(imperfect.switchFailedProbability).toBeCloseTo(failedFreq * 2, 6);
  });
  it('falls back to the mean-repair chain for very large groups and flags it', () => {
    const r = kOfNGroup({ n: 60, k: 58, lambda: 1e-3, repair: A, switchover: { successProbability: 0.99 } });
    expect(r.approximate).toBe(true);
    expect(r.availability).toBeGreaterThan(0.9);
    expect(r.availability).toBeLessThan(1);
  });
});

describe('sub-health unit (§14)', () => {
  it('reduces to the v1 degraded unit for tolerate / m = 1 / manual repair / counted as up', () => {
    const d = degradedUnit(1e-3, 1 / 4, 2e-3, 1.5, 0.5);
    const s = subhealthUnit(1e-3, manualOnly(4), { ratePerHour: 2e-3, durationH: 1.5, performance: 0.5, escalationMultiplier: 1, policy: 'tolerate', threshold: 0 });
    expect(s.tolerant).toBeCloseTo(d.availability, 12);
    expect(s.performability).toBeCloseTo(d.capacity, 12);
    expect(s.availability).toBeCloseTo(d.availability, 12);
    expect(s.failureFrequency).toBeCloseTo(d.failureFrequency, 12);
  });
  it('threshold rule: below-threshold sub-health counts as down', () => {
    const s = subhealthUnit(1e-3, manualOnly(4), { ratePerHour: 5e-3, durationH: 2, performance: 0.6, escalationMultiplier: 2 });
    expect(s.countsAsDown).toBe(true);
    expect(s.availability).toBeCloseTo(s.strict, 12);
    expect(s.tolerant).toBeGreaterThan(s.strict);
    expect(s.performability).toBeGreaterThan(s.strict);
    expect(s.performability).toBeLessThan(s.tolerant);
    const t = subhealthUnit(1e-3, manualOnly(4), { ratePerHour: 5e-3, durationH: 2, performance: 0.8, escalationMultiplier: 2 });
    expect(t.countsAsDown).toBe(false);
    expect(t.availability).toBeCloseTo(t.tolerant, 12);
  });
  it('isolate policy converts detected sub-health into interruptions', () => {
    const tol = subhealthUnit(1e-3, A, { ratePerHour: 5e-3, durationH: 2, performance: 0.6, escalationMultiplier: 2, policy: 'tolerate' });
    const iso = subhealthUnit(1e-3, A, { ratePerHour: 5e-3, durationH: 2, performance: 0.6, escalationMultiplier: 2, policy: 'isolate', detection: { probability: 0.9, delayH: 0.05 } });
    expect(iso.isolationFrequency).toBeGreaterThan(0);
    expect(iso.piSubhealth).toBeLessThan(tol.piSubhealth);
    expect(iso.piIsolated).toBeGreaterThan(0);
    const total = iso.piUp + iso.piSubhealth + iso.piIsolated + iso.piDownAuto + iso.piDownManual;
    expect(total).toBeCloseTo(1, 10);
  });
  it('converts a steady-state probability into an entry rate', () => {
    const { ratePerHour } = subhealthRateFromProbability(0.01, 2);
    expect(ratePerHour).toBeCloseTo(0.01 / (0.99 * 2), 12);
    const s = subhealthUnit(0, manualOnly(1), { ratePerHour, durationH: 2, performance: 0.5, escalationMultiplier: 1 });
    expect(s.piSubhealth).toBeCloseTo(0.01, 10);
  });
});

describe('straggler and plane-loss laws (§14–§15)', () => {
  it('straggler law', () => {
    const r = stragglerLaw(1000, 1e-3, 0.6);
    expect(r.pSlowed).toBeCloseTo(1 - Math.pow(1 - 1e-3, 1000), 12);
    expect(r.performanceFactor).toBeCloseTo(1 - r.pSlowed * 0.4, 12);
  });
  it('plane loss', () => {
    const r = planeLossPerformance(7, 0.3);
    expect(r.stepTimeFactor).toBeCloseTo(1 + 0.3 / 6, 12);
    expect(r.performance).toBeCloseTo(1 / (1 + 0.05), 12);
  });
});

describe('recovery ladder (§16)', () => {
  const ladder = { id: 't', rungs: [
    { id: 'a', kind: 'auto' as const, successProbability: 0.2, timeS: 20 },
    { id: 'b', kind: 'auto' as const, successProbability: 0.3, timeS: 120 },
    { id: 'c', kind: 'auto' as const, successProbability: 0.8, timeS: 300 },
    { id: 'd', kind: 'auto' as const, successProbability: 0.9, timeS: 900 },
    { id: 'm', kind: 'manual' as const, successProbability: 1, timeS: 14400 },
  ] };
  it('expectation and reach probabilities', () => {
    const r = ladderExpectation(ladder, 4096);
    const reach = [1, 0.8, 0.8 * 0.7, 0.8 * 0.7 * 0.2, 0.8 * 0.7 * 0.2 * 0.1];
    r.rungs.forEach((x, i) => expect(x.reachProbability).toBeCloseTo(reach[i], 12));
    const E = 20 + 0.8 * 120 + 0.56 * 300 + 0.112 * 900 + 0.0112 * 14400;
    expect(r.meanS).toBeCloseTo(E, 9);
    expect(r.pManual).toBeCloseTo(0.0112, 12);
    expect(r.rungs.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 12);
  });
  it('sampler mean agrees with the expectation', () => {
    const rng = new Rng(7);
    const s = ladderSampler(ladder, 4096, rng);
    let sum = 0;
    let sq = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const x = s();
      sum += x;
      sq += x * x;
    }
    const mean = sum / n;
    const se = Math.sqrt((sq / n - mean * mean) / n);
    expect(Math.abs(mean - ladderExpectation(ladder, 4096).meanS)).toBeLessThan(4 * se);
  });
  it('MindCluster preset is well formed', () => {
    const l = LADDER_PRESETS['mindcluster-a3'];
    expect(l.rungs[l.rungs.length - 1].kind).toBe('manual');
    const r = ladderExpectation(l, 384 * 8);
    expect(r.meanS).toBeGreaterThan(0);
    expect(r.pManual).toBeLessThan(0.05);
  });
});

describe('original vs compensated (§17)', () => {
  const unit: Block = { kind: 'leaf', id: 'x', lambda: 1e-3, mttr: 6, repair: A, subhealth: { ratePerHour: 2e-3, durationH: 1, performance: 0.5, escalationMultiplier: 1, policy: 'tolerate' } };
  const tree: Block = {
    kind: 'series', id: 'sys', children: [
      { kind: 'kofn', id: 'g1', n: 3, k: 2, unit },
      { kind: 'leaf', id: 'b', lambda: 5e-5, mttr: 24 },
      { kind: 'parallel', id: 'g2', children: [{ kind: 'leaf', id: 'c1', lambda: 2e-4, mttr: 8 }, { kind: 'leaf', id: 'c2', lambda: 2e-4, mttr: 8 }], switchover: { successProbability: 0.95, failureRecoveryHours: 2 } },
    ],
  };
  it('level 0 strips every mechanism and the waterfall ends at the configured result', () => {
    const o = transformCompensation(tree, { level: 0 }) as Extract<Block, { kind: 'series' }>;
    expect(o.children[0].kind).toBe('repeat');
    expect(o.children[2].kind).toBe('series');
    const w = compensationWaterfall(tree);
    expect(w.steps).toHaveLength(4);
    expect(w.compensated.availability).toBeCloseTo(evaluate(tree).availability, 12);
    expect(w.original.availability).toBeLessThan(w.compensated.availability);
    expect(w.gain.deltaAvailability).toBeGreaterThan(0);
    expect(w.switchoverPenalty).toBeGreaterThan(0);
    // redundancy and automatic recovery each help
    expect(w.steps[1].availability).toBeGreaterThan(w.steps[0].availability);
    expect(w.steps[2].availability).toBeGreaterThan(w.steps[1].availability);
    // ids are preserved for block-by-block comparison
    const orig = indexResults(w.original);
    const comp = indexResults(w.compensated);
    for (const id of ['g1', 'b', 'g2']) {
      expect(orig.has(id)).toBe(true);
      expect(comp.has(id)).toBe(true);
    }
  });
  it('original leaf folds sub-health into the failure rate', () => {
    const o = transformCompensation(unit, { level: 0 }) as Extract<Block, { kind: 'leaf' }>;
    expect(o.lambda).toBeCloseTo(3e-3, 12);
    expect(o.mttr).toBeCloseTo((1e-3 * 6 + 2e-3 * 1) / 3e-3, 12);
    expect(o.repair).toBeUndefined();
    expect(o.subhealth).toBeUndefined();
  });
  it('a tree without v2 features has an identical waterfall at every level ≥ 1', () => {
    const plain: Block = { kind: 'series', id: 's', children: [{ kind: 'kofn', id: 'k', n: 3, k: 2, unit: { kind: 'leaf', id: 'u', lambda: 1e-3, mttr: 6 } }, { kind: 'leaf', id: 'l', lambda: 1e-4, mttr: 10 }] };
    const w = compensationWaterfall(plain);
    expect(w.steps[1].availability).toBeCloseTo(w.steps[3].availability, 12);
    expect(w.steps[2].availability).toBeCloseTo(w.steps[3].availability, 12);
    expect(w.switchoverPenalty).toBeCloseTo(0, 12);
  });
});

describe('standby with v2 switchover (§13)', () => {
  it('keeps the v1 result when no v2 fields are given', () => {
    const r = standby(2, 1e-3, 0.2, 0, 0.95, Infinity);
    const blk: Block = { kind: 'standby', id: 's', n: 2, unit: { kind: 'leaf', id: 'u', lambda: 1e-3, mttr: 5 }, switchProbability: 0.95 };
    expect(evaluate(blk).availability).toBeCloseTo(r.availability, 12);
    expect(r.switchFrequency).toBeGreaterThan(0);
  });
  it('micro-outage lowers availability first order', () => {
    const base: Block = { kind: 'standby', id: 's', n: 2, unit: { kind: 'leaf', id: 'u', lambda: 1e-3, mttr: 5 }, switchover: { successProbability: 0.95, failureRecoveryHours: 1 } };
    const withOutage: Block = { ...base, switchover: { successProbability: 0.95, failureRecoveryHours: 1, outageS: 60 } };
    const a = evaluate(base);
    const b = evaluate(withOutage);
    expect(b.availability).toBeLessThan(a.availability);
    expect(b.switchover!.outage).toBeCloseTo(a.switchover!.frequency * (60 / 3600), 12);
  });
});
