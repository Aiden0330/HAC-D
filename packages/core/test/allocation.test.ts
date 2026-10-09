import { describe, it, expect } from 'vitest';
import {
  equalApportionment, arinc, agree, feasibilityOfImprovement, minimumEffort, costOptimal,
  allocateUnavailability, goodputBudget, allocateRecoveryStages, type Subsystem,
} from '../src/allocation/index.js';
import { goodputFirstOrder, youngInterval } from '../src/checkpoint/index.js';

const subs: Subsystem[] = [
  { id: 'gpu', count: 16384, currentLambda: 11.6e-6, importance: 1, feasibilityWeight: 1, cost: { a: 10, b: 1 }, minLambda: 2e-6 },
  { id: 'nic', count: 16384, currentLambda: 2e-6, importance: 1, feasibilityWeight: 2, cost: { a: 2, b: 1 }, minLambda: 0.5e-6 },
  { id: 'host', count: 2048, currentLambda: 5e-6, importance: 1, feasibilityWeight: 1, cost: { a: 1, b: 1 }, minLambda: 1e-6 },
  { id: 'switch', count: 256, currentLambda: 1e-6, importance: 1, feasibilityWeight: 3, cost: { a: 1, b: 1 }, minLambda: 0.2e-6 },
];
const currentTotal = subs.reduce((a, s) => a + s.currentLambda! * s.count, 0);
const budget = currentTotal / 2;
const sum = (rows: { lambdaAggregate: number }[]) => rows.reduce((a, r) => a + r.lambdaAggregate, 0);

describe('series failure-rate allocation methods', () => {
  it('all methods meet the budget exactly', () => {
    for (const r of [equalApportionment(subs, budget), arinc(subs, budget), agree(subs, budget), feasibilityOfImprovement(subs, budget), minimumEffort(subs, budget), costOptimal(subs, budget)]) {
      expect(sum(r.rows)).toBeCloseTo(budget, 12);
      for (const row of r.rows) expect(row.lambdaAggregate).toBeGreaterThanOrEqual(0);
    }
  });
  it('ARINC halves every subsystem when the budget is half the current total', () => {
    const r = arinc(subs, budget);
    for (const row of r.rows) expect(row.improvementFactor).toBeCloseTo(2, 9);
  });
  it('AGREE gives larger shares to subsystems with more modules', () => {
    const r = agree(subs, budget);
    const gpu = r.rows.find((x) => x.id === 'gpu')!;
    const sw = r.rows.find((x) => x.id === 'switch')!;
    expect(gpu.lambdaAggregate).toBeGreaterThan(sw.lambdaAggregate);
    expect(gpu.lambdaPerUnit).toBeCloseTo(sw.lambdaPerUnit, 9); // equal per-module allocation with equal importance and duty
  });
  it('minimum effort leaves the best subsystems untouched', () => {
    const r = minimumEffort(subs, budget);
    const sw = r.rows.find((x) => x.id === 'switch')!;
    expect(sw.lambdaAggregate).toBeCloseTo(1e-6 * 256, 15);
    const gpu = r.rows.find((x) => x.id === 'gpu')!;
    expect(gpu.lambdaAggregate).toBeLessThan(11.6e-6 * 16384);
  });
  it('cost-optimal respects floors and never exceeds current rates', () => {
    const r = costOptimal(subs, budget);
    for (const row of r.rows) {
      const s = subs.find((x) => x.id === row.id)!;
      expect(row.lambdaPerUnit).toBeLessThanOrEqual(s.currentLambda! + 1e-18);
      expect(row.lambdaPerUnit).toBeGreaterThanOrEqual(s.minLambda! - 1e-18);
    }
    expect(r.rows.find((x) => x.id === 'gpu')!.feasibility).toBe('ok');
  });
  it('fixed subsystems are not reallocated', () => {
    const fixed = subs.map((s) => (s.id === 'switch' ? { ...s, fixed: true } : s));
    const r = arinc(fixed, budget);
    expect(r.rows.find((x) => x.id === 'switch')!.lambdaAggregate).toBeCloseTo(1e-6 * 256, 15);
    expect(sum(r.rows)).toBeCloseTo(budget, 12);
  });
});

describe('unavailability allocation', () => {
  it('splits ln A* by weights and converts to λ or MTTR', () => {
    const r = allocateUnavailability(
      [
        { id: 'compute', count: 1, mttr: 0.5 },
        { id: 'power', count: 1, mttr: 4, currentLambda: 1e-5 },
      ],
      0.999,
      [3, 1],
    );
    const prod = r.rows.reduce((a, x) => a * x.availability, 1);
    expect(prod).toBeCloseTo(0.999, 12);
    expect(r.rows[0].unavailability).toBeGreaterThan(r.rows[1].unavailability);
    expect(r.rows[0].lambdaAggregate).toBeDefined();
    expect(r.rows[1].mttrImplied).toBeDefined();
  });
});

describe('goodput-budget allocation (worked example 1 shape)', () => {
  const input = { goodputTarget: 0.97, nGpus: 16384, deltaS: 2.43, recoveryS: 4.45 * 60, lambdaPerGpuHour: 1 / 50680 };
  it('reproduces the current loss decomposition', () => {
    const r = goodputBudget(input);
    expect(r.current.mtbiS / 60).toBeCloseTo(185.6, 1);
    expect(r.current.loss).toBeCloseTo(1 - 0.955, 3);
  });
  it('fixing R yields an MTBI at which the first-order goodput hits the target', () => {
    const r = goodputBudget(input);
    const M = r.fixRecovery.requiredMtbiS;
    const tau = youngInterval(input.deltaS, M);
    expect(goodputFirstOrder(input.deltaS, tau, M, input.recoveryS).goodput).toBeCloseTo(0.97, 6);
    expect(r.fixRecovery.improvementFactor).toBeGreaterThan(1);
  });
  it('fixing λ yields a recovery time at which the target is met', () => {
    const r = goodputBudget(input);
    const R = r.fixRate.requiredRecoveryS;
    const tau = youngInterval(input.deltaS, r.current.mtbiS);
    expect(goodputFirstOrder(input.deltaS, tau, r.current.mtbiS, R).goodput).toBeCloseTo(0.97, 6);
    expect(R).toBeLessThan(input.recoveryS);
  });
  it('balanced split meets the target too', () => {
    const r = goodputBudget({ ...input, restartShare: 0.4 });
    const tau = youngInterval(input.deltaS, r.balanced.mtbiS);
    expect(goodputFirstOrder(input.deltaS, tau, r.balanced.mtbiS, r.balanced.recoveryS).goodput).toBeCloseTo(0.97, 6);
  });
  it('recovery stage budgets sum to the budget and respect floors', () => {
    const rows = allocateRecoveryStages(
      [
        { name: 'detect', currentS: 600, floorS: 10 },
        { name: 'localize', currentS: 1800, floorS: 20 },
        { name: 'restart', currentS: 300, floorS: 15 },
      ],
      120,
    );
    expect(rows.reduce((a, r) => a + r.budgetS, 0)).toBeCloseTo(120, 9);
    for (const r of rows) expect(r.budgetS).toBeGreaterThanOrEqual(10);
  });
});
