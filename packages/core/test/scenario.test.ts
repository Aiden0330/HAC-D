import { describe, it, expect } from 'vitest';
import { evaluateScenario, workedExample1, workedExample3, workedExample4, nvl72Design, parseScenario, scenarioJsonSchema } from '../src/scenario/index.js';

describe('scenario: worked example 1', () => {
  const r = evaluateScenario(workedExample1());
  it('reproduces MTBI, interval and goodput of Table 6-5', () => {
    expect(r.training).toBeDefined();
    const t = r.training!;
    expect(t.mtbiHours * 60).toBeCloseTo(185.6, 1);
    expect(t.tauS).toBeCloseTo(232.6, 1);
    expect(t.firstOrder.goodput).toBeCloseTo(0.955, 3);
    expect(t.recoveryS).toBeCloseTo(4.45 * 60, 6);
    expect(t.firstOrder.regime).toBe('restart-dominated');
    expect(t.scale.find((x) => x.nGpus === 65536)!.goodput.goodput).toBeCloseTo(0.862, 3);
    expect(t.lostDollarsPerDay).toBeGreaterThan(0);
  });
  it('produces components, importance, cut sets and a checklist', () => {
    expect(r.components[0].id).toBe('gpu');
    expect(r.components[0].interruptionShare).toBeCloseTo(1, 12);
    expect(r.checklist.length).toBeGreaterThanOrEqual(10);
    expect(r.checklist.find((c) => c.id === 'first-order-validity')!.status).toBe('pass');
    expect(r.cutSets.cutSets.length).toBe(1);
    expect(Object.keys(r.formulas)).toContain('goodput');
  });
});

describe('scenario: worked example 3 (hot spares)', () => {
  it('sizes hot spares at P99 = 7 and builds the k-of-n pool', () => {
    const r = evaluateScenario(workedExample3(7));
    expect(r.spares!.hotSparesBinomial).toBe(7);
    expect(r.spares!.nodes).toBe(1024);
    expect(r.training!.blockedProbability).toBeGreaterThan(0);
    expect(r.training!.blockedProbability).toBeLessThan(0.01);
    expect(r.structure.root.kind).toBe('series');
    expect(r.structure.result.children[0].kind).toBe('kofn');
    const fewer = evaluateScenario(workedExample3(1));
    expect(fewer.training!.blockedProbability).toBeGreaterThan(r.training!.blockedProbability);
    expect(fewer.checklist.find((c) => c.id === 'spares-quantile')!.status).toBe('warn');
  });
});

describe('scenario: worked example 4 (inference N+k)', () => {
  it('reproduces Table 6-8', () => {
    const r = evaluateScenario(workedExample4(4));
    const inf = r.inference!;
    expect(inf.replicaUnavailability).toBeCloseTo(0.007, 9);
    expect(inf.curve[0].capacityAvailability).toBeCloseTo(0.638, 3);
    expect(inf.curve[1].capacityAvailability).toBeCloseTo(0.924, 3);
    expect(inf.curve[4].capacityAvailability).toBeCloseTo(0.99988, 5);
    expect(inf.kRequiredForTarget).toBe(4);
    expect(inf.capacityAvailability).toBeCloseTo(0.99988, 5);
    expect(r.system.capacityAvailability).toBeLessThanOrEqual(r.system.availability + 1e-12);
    const short = evaluateScenario(workedExample4(2));
    expect(short.warnings.some((w) => w.includes('below'))).toBe(true);
  });
});

describe('scenario: NVL72 design', () => {
  it('evaluates a heterogeneous structure with redundancy and CCF', () => {
    const r = evaluateScenario(nvl72Design());
    expect(r.system.availability).toBeGreaterThan(0.5);
    expect(r.system.availability).toBeLessThan(1);
    expect(r.training!.firstOrder.goodput).toBeGreaterThan(0.9);
    const ids = r.structure.result.children.map((c) => c.id);
    expect(ids).toContain('node-pool');
    expect(ids).toContain('ccf:power_zone');
    expect(ids).toContain('tor');
    expect(r.importance.length).toBeGreaterThan(5);
    expect(r.checklist.find((c) => c.id === 'spare-granularity')!.status).toBe('warn');
    expect(r.checklist.find((c) => c.id === 'own-rates')!.status).toBe('warn');
    expect(r.components.map((c) => c.id)).toContain('gpu');
  });
});

describe('schema', () => {
  it('rejects invalid input and exports JSON schema', () => {
    expect(() => parseScenario({ meta: { name: 'x' }, components: [], workload: { type: 'training', nGpus: 1, deltaS: 1 } })).toThrow();
    const js = scenarioJsonSchema() as { type?: string };
    expect(js.type).toBe('object');
  });
});
