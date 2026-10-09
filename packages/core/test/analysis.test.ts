import { describe, it, expect } from 'vitest';
import { compareScenarios, tornadoForScenario, allocateScenario, withHotSpares, scaleRecovery, workedExample1, nvl72Design, evaluateScenario } from '../src/scenario/index.js';
import { simulateJob, simulateReplications, summarize, lifetimeFromRate } from '../src/mc/index.js';
import { exponentialFromMean } from '../src/math/distributions.js';
import { youngInterval } from '../src/checkpoint/index.js';

describe('comparison and variants', () => {
  it('compares options and picks the best per metric', () => {
    const base = workedExample1();
    const fast = scaleRecovery(base, 0.25);
    fast.meta = { ...fast.meta, id: 'fast', name: 'fast recovery' };
    const spares = withHotSpares(base, 8);
    spares.meta = { ...spares.meta, id: 'spares', name: 'with spares' };
    const cmp = compareScenarios([base, fast, spares]);
    expect(cmp.rows.length).toBe(3);
    expect(cmp.best.effectiveGoodput).toBe('fast');
    expect(cmp.rows[1].goodput!).toBeGreaterThan(cmp.rows[0].goodput!);
    expect(cmp.rows[2].result.structure.result.children[0].kind).toBe('kofn');
  });
  it('tornado ranks recovery and the dominant component rate first', () => {
    const rows = tornadoForScenario(nvl72Design(), 'goodput');
    expect(rows.length).toBeGreaterThan(5);
    expect(['recovery', 'rate:gpu', 'rate:software']).toContain(rows[0].id);
    expect(rows[0].swing).toBeGreaterThan(rows[rows.length - 1].swing);
  });
});

describe('scenario allocation', () => {
  it('derives rate and stage budgets from a goodput target', () => {
    const s = nvl72Design();
    const a = allocateScenario(s, { goodputTarget: 0.98, method: 'arinc' });
    expect(a.goodput).toBeDefined();
    expect(a.goodput!.lossBudget).toBeCloseTo(0.02, 12);
    if (a.rateAllocation) {
      const sum = a.rateAllocation.rows.reduce((x, r) => x + r.lambdaAggregate, 0);
      expect(sum).toBeCloseTo(a.rateAllocation.lambdaSystem, 9);
      expect(a.rateAllocation.rows.every((r) => (r.improvementFactor ?? 1) >= 1 - 1e-9)).toBe(true);
    }
    if (a.stageAllocation) {
      const total = a.stageAllocation.reduce((x, r) => x + r.budgetS, 0);
      expect(total).toBeCloseTo(a.goodput!.fixRate.requiredRecoveryS, 6);
    }
    const u = allocateScenario(s, { availabilityTarget: 0.999 });
    expect(u.unavailability!.rows.reduce((p, r) => p * r.availability, 1)).toBeCloseTo(0.999, 9);
  });
  it('all methods run on the NVL72 design', () => {
    for (const m of ['equal', 'arinc', 'agree', 'feasibility', 'minimum-effort', 'cost-optimal'] as const) {
      const a = allocateScenario(nvl72Design(), { goodputTarget: 0.985, method: m });
      expect(a.notes.some((n) => n.includes('failed'))).toBe(false);
    }
  });
});

describe('monte carlo chunking', () => {
  it('chunked replications reproduce simulateJob exactly', () => {
    const spec = {
      nGpus: 1024, gpusPerNode: 8, nodesPerRack: 4, racksPerZone: 64, workHours: 48, intervalS: youngInterval(2.43, 3600 / (1024 / 50680)), deltaS: 2.43,
      recoverySampler: () => 120, spares: { policy: 'cluster-requeue' as const, hotSpareNodes: 0, replenish: exponentialFromMean(24) },
      classes: [{ id: 'gpu', count: 1024, lifetime: lifetimeFromRate(1 / 50680), repair: exponentialFromMean(1), scope: 'gpu' as const }], recovery: 'checkpoint' as const,
    };
    const whole = simulateJob(spec, 8, 5);
    const rows = [...simulateReplications(spec, 0, 3, 5), ...simulateReplications(spec, 3, 5, 5)];
    const chunked = summarize(rows, 5);
    expect(chunked.goodput.mean).toBe(whole.goodput.mean);
    expect(chunked.rows.map((r) => r.interruptions)).toEqual(whole.rows.map((r) => r.interruptions));
  });
});
