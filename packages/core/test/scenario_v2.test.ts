/**
 * Scenario-level v2 tests: schema compatibility, dual repair, switchover, sub-health policies,
 * recovery ladder, original vs compensated measures, Monte Carlo adapter with dual repair.
 */
import { describe, it, expect } from 'vitest';
import { parseScenario, evaluateScenario, resolveRecovery, compareScenarios, scaleRecovery, workedExample1, workedExample4, ascendSupercluster, EXAMPLES, type ScenarioInput } from '../src/index.js';
import { mcSpecFromScenario } from '../src/mc/fromScenario.js';
import { mean as distMean } from '../src/math/distributions.js';

function base(): ScenarioInput {
  return {
    meta: { name: 'v2 test' },
    topology: { gpusPerNode: 8, nodesPerRack: 4 },
    components: [
      { id: 'gpu', subsystem: 'compute', countRule: { per: 'gpu' }, failure: { value: 1e-5, unit: 'per_h' }, repair: { auto: { coverage: 0.9, successProbability: 0.95, mttrHours: 0.1 }, manual: { mttrHours: 6 } } },
      { id: 'nic', subsystem: 'network', countRule: { per: 'node' }, failure: { value: 2e-5, unit: 'per_h' }, repair: { mttrHours: 4 }, subhealth: { ratePerHour: 1e-4, durationHours: 2, performance: 0.6, escalationMultiplier: 2, policy: 'tolerate' } },
      { id: 'psu', subsystem: 'power', countRule: { per: 'rack', factor: 2 }, failure: { value: 1e-5, unit: 'per_h' }, repair: { mttrHours: 8 }, redundancy: { scheme: 'parallel', switchover: { successProbability: 0.98, outageS: 10, failureRecoveryHours: 1 } } },
    ],
    workload: { type: 'training', nGpus: 1024, deltaS: 30 },
    recovery: { mode: 'ladder', preset: 'mindcluster-a3' },
  };
}

describe('v2 scenario schema', () => {
  it('accepts v1 scenarios unchanged and defaults the measures block', () => {
    const s = workedExample1();
    expect(s.measures.subhealthThreshold).toBe(0.7);
    const r = evaluateScenario(s);
    expect(r.training!.firstOrder.goodput).toBeCloseTo(0.9551, 3);
    expect(r.system.measures.compensated.availability).toBeCloseTo(r.system.availability, 12);
    expect(r.system.waterfall).toHaveLength(4);
    expect(r.system.humanFraction).toBe(1);
  });
  it('rejects a repair without any mean time', () => {
    const s = base();
    (s.components[0] as { repair: unknown }).repair = { auto: { coverage: 0.5, mttrHours: 1 } };
    expect(() => parseScenario(s)).toThrow();
  });
  it('resolves dual repair, sub-health and switchover', () => {
    const s = parseScenario(base());
    const r = evaluateScenario(s);
    const gpu = r.components.find((c) => c.id === 'gpu')!;
    expect(gpu.autoCoverage).toBe(0.9);
    expect(gpu.mttrHours).toBeCloseTo(0.9 * 0.1 + (1 - 0.9 * 0.95) * 6, 12);
    const nic = r.components.find((c) => c.id === 'nic')!;
    expect(nic.subhealthProbability).toBeGreaterThan(0);
    expect(nic.subhealthPolicy).toBe('tolerate');
    expect(r.system.humanFraction).toBeLessThan(1);
    expect(r.system.autoDowntimeShare).toBeGreaterThan(0);
    expect(r.training!.subhealth).toBeDefined();
    expect(r.training!.subhealth!.pSlowed).toBeGreaterThan(0);
    expect(r.training!.effectiveGoodput).toBeLessThan(r.training!.firstOrder.goodput);
    expect(r.training!.recoveryKind).toBe('ladder');
    expect(r.training!.ladder!.pManual).toBeGreaterThan(0);
    expect(r.training!.recovery.stages.length).toBe(6);
    // psu group is 1-of-2 with switchover: micro-outage reported on the block
    const psu = findBlock(r.structure.result, 'psu');
    expect(psu).toBeDefined();
  });
});

function findBlock(r: { id: string; children: unknown[] }, id: string): unknown {
  if (r.id === id) return r;
  for (const ch of r.children as { id: string; children: unknown[] }[]) {
    const f = findBlock(ch, id);
    if (f) return f;
  }
  return undefined;
}

describe('original vs compensated at scenario level', () => {
  it('original availability is lower and the waterfall ends at the compensated value', () => {
    const r = evaluateScenario(parseScenario(base()));
    const m = r.system.measures;
    expect(m.original.availability).toBeLessThan(m.compensated.availability);
    expect(r.system.waterfall[3].availability).toBeCloseTo(m.compensated.availability, 10);
    expect(m.gain.deltaAvailability).toBeGreaterThan(0);
    expect(m.strict).toBeLessThanOrEqual(m.tolerant);
    expect(m.performability).toBeLessThanOrEqual(m.tolerant + 1e-12);
  });
  it('isolate policy adds interruptions and reduces the slowed fraction', () => {
    const tol = parseScenario(base());
    const isoIn = base();
    (isoIn.components[1] as { subhealth: Record<string, unknown> }).subhealth = { ratePerHour: 1e-4, durationHours: 2, performance: 0.6, escalationMultiplier: 2, policy: 'isolate', detection: { probability: 0.9, delayHours: 0.05 } };
    const iso = parseScenario(isoIn);
    const a = evaluateScenario(tol).training!;
    const b = evaluateScenario(iso).training!;
    expect(b.subhealth!.isolationInterruptionsPerHour).toBeGreaterThan(0);
    expect(b.interruptionRatePerHour).toBeGreaterThan(a.interruptionRatePerHour);
    expect(b.subhealth!.pSlowed).toBeLessThan(a.subhealth!.pSlowed);
  });
});

describe('recovery ladder in scenarios', () => {
  it('scaleRecovery scales rung times and resolveRecovery exposes the ladder', () => {
    const s = parseScenario(base());
    const m = resolveRecovery(s);
    expect(m.kind).toBe('ladder');
    const slow = resolveRecovery(scaleRecovery(s, 2));
    expect(slow.meanS(1024)).toBeCloseTo(2 * m.meanS(1024), 9);
  });
  it('explicit rungs work and the comparison carries the v2 measures', () => {
    const s = base();
    s.recovery = { mode: 'ladder', rungs: [{ id: 'auto', kind: 'auto', successProbability: 0.8, timeS: 300 }, { id: 'manual', kind: 'manual', successProbability: 1, timeS: 7200 }] };
    const parsed = parseScenario(s);
    expect(resolveRecovery(parsed).meanS(1024)).toBeCloseTo(300 + 0.2 * 7200, 9);
    const cmp = compareScenarios([parsed, parseScenario(base())]);
    expect(cmp.rows[0].originalAvailability).toBeLessThan(cmp.rows[0].availability);
    expect(cmp.rows[0].humanFraction).toBeLessThan(1);
  });
});

describe('Monte Carlo adapter with v2 inputs', () => {
  it('builds dual-repair distributions and a ladder sampler', () => {
    const s = parseScenario(base());
    const spec = mcSpecFromScenario(s, 600);
    const gpu = spec.classes.find((c) => c.id === 'gpu')!;
    expect(gpu.repair.type).toBe('dual-repair');
    expect(distMean(gpu.repair)).toBeCloseTo(0.9 * 0.1 + (1 - 0.9 * 0.95) * 6, 9);
    const nic = spec.classes.find((c) => c.id === 'nic')!;
    expect(nic.failslow?.capacity).toBe(0.6);
    expect(typeof spec.recoverySampler).toBe('function');
  });
});

describe('examples still evaluate', () => {
  it('every example evaluates with measures', () => {
    for (const [, make] of Object.entries(EXAMPLES)) {
      const r = evaluateScenario(make());
      expect(r.system.measures.original.availability).toBeLessThanOrEqual(r.system.measures.compensated.availability + 1e-12);
    }
  });
});

describe('supercluster sizing (N + k supernodes)', () => {
  it('folds supernode-scoped classes into the supernode unit and sizes the pool from the cluster size', () => {
    const s = ascendSupercluster(100000, 3);
    const r = evaluateScenario(s);
    const i = r.inference!;
    expect(i.replicasRequired).toBe(Math.ceil(100000 / 384));
    expect(i.replicaScope).toBe('supernode');
    expect(i.supernodesTotal).toBe(264);
    for (const id of ['npu', 'cpu', 'ub_l1_switch', 'ub_l2_switch', 'ub_optical_link', 'rack_power', 'cdu', 'scaleout_leaf']) expect(i.replicaMembers).toContain(id);
    expect(i.replicaUnavailability).toBeGreaterThan(0);
    expect(i.kRequiredForTarget).toBeGreaterThan(3);
    // more NPUs → more supernodes → more spares needed for the same capacity target
    const big = evaluateScenario(ascendSupercluster(500000, 3)).inference!;
    expect(big.replicasRequired).toBe(Math.ceil(500000 / 384));
    expect(big.kRequiredForTarget).toBeGreaterThan(i.kRequiredForTarget);
  });
  it('worked example 4 keeps its survey value (node-scope replicas, no fabric classes)', () => {
    const r = evaluateScenario(workedExample4());
    expect(r.inference!.replicaScope).toBe('node');
    expect(r.inference!.capacityAvailability).toBeCloseTo(0.99988, 4);
  });
});
