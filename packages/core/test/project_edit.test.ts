/**
 * v6.4 editing a project the way the pages do (src/project/edit.ts): fields of the Topology page (geometry, scale-out, variant,
 * user counts, size), targets and workload under the applied mechanisms, the FIT of the fault types, the mechanisms (apply with
 * parameters, remove), the summary and the vocabulary a model reads; every invalid input refused with the allowed values named.
 */
import { describe, it, expect } from 'vitest';
import { topologyScenario, fitOverrides } from '../src/topology/index.js';
import { computeCounts } from '../src/scenario/build.js';
import { setScenarioFields, setFaultFit, editMechanisms, scenarioSummary, scenarioVocabulary, SCENARIO_FIELDS } from '../src/project/edit.js';

describe('v6.4 project edits', () => {
  const s0 = topologyScenario('a950-ub2', 10000);
  const applied = (s: typeof s0) => Object.keys(s.mechanisms.applied ?? {}).sort();

  it('sets geometry, targets, user counts, the scale-out network and the size; refuses unknown paths and bad values', () => {
    const { scenario: s, changed } = setScenarioFields(s0, { 'topology.superpod.nodesPerRack': 9, 'targets.operational': 0.99, 'counts.cabinet': 400 });
    expect(changed.sort()).toEqual(['counts.cabinet', 'targets.operational', 'topology.superpod.nodesPerRack']);
    expect(s.topology.superpod!.nodesPerRack).toBe(9);
    expect(s.topology.nodesPerRack).toBe(9);
    expect(s.targets.operational).toBe(0.99);
    expect(computeCounts(s).racks).toBe(400);
    expect(applied(s)).toEqual(applied(s0));
    const off = setScenarioFields(s, { 'topology.scaleOut': 'off' }).scenario;
    expect(off.topology.scaleOut).toBeUndefined();
    expect(off.components.some((c) => c.id.includes('@roce'))).toBe(false);
    const on = setScenarioFields(off, { 'topology.scaleOut.planes': 4, 'topology.scaleOut': true }).scenario;
    expect(on.topology.scaleOut?.planes).toBe(4);
    expect(on.components.some((c) => c.id.includes('@roce'))).toBe(true);
    expect(setScenarioFields(s, { npus: '20000' }).scenario.workload).toMatchObject({ nGpus: 20000 });
    const v8k = setScenarioFields(s0, { 'topology.variant': 'a950-8k' }).scenario;
    expect(computeCounts(v8k).supernodes).toBe(2);
    expect(setScenarioFields(s0, { 'topology.fabric': 'blade-clos' }).scenario.topology.superpod?.fabric).toBe('blade-clos');
    expect(() => setScenarioFields(s, { 'topology.superpod.bogus': 1 })).toThrow(/unknown field/);
    expect(() => setScenarioFields(s, { 'topology.fabric': 'ring' })).toThrow(/one of/);
    expect(() => setScenarioFields(s, { 'topology.variant': 'a950-99k' })).toThrow(/variants/);
    expect(() => setScenarioFields(s, { 'targets.operational': 2 })).toThrow(/≤ 0.99999/);
    expect(() => setScenarioFields(s, { 'counts.nope': 3 })).toThrow(/rows are/);
    expect(() => setScenarioFields(s, { 'topology.superpod.nodesPerRack': 'nine' })).toThrow(/number is required/);
    expect(() => setScenarioFields(s, { 'topology.gpusPerNode': 16 })).toThrow(/set topology.superpod.npusPerNode/);
  });

  it('a setting an applied mechanism owns is refused; other base settings keep the mechanisms applied', () => {
    expect(() => setScenarioFields(s0, { 'workload.deltaS': 2 })).toThrow(/owned by the applied mechanism C-FAST/);
    const s = setScenarioFields(s0, { 'targets.goodput': 0.95, 'workload.durationDays': 14, 'recovery.automatic.seconds': 120 }).scenario;
    expect(applied(s)).toEqual(applied(s0));
    expect(s.targets.goodput).toBe(0.95);
    expect(s.workload).toMatchObject({ durationDays: 14 });
    expect(s.recovery.mode === 'mixture' && s.recovery.automatic.seconds).toBe(120);
  });

  it('FIT edits: set and reset through the unit library; unknown or absent classes refused', () => {
    const { scenario: s, changed } = setFaultFit(s0, { 'CORE-hard': 500, 'MEMT-hard': 380 });
    expect(changed).toEqual(['CORE-hard', 'MEMT-hard']);
    expect(fitOverrides(s)['CORE-hard']).toBeCloseTo(500);
    expect(applied(s)).toEqual(applied(s0));
    const back = setFaultFit(s, { 'CORE-hard': null }).scenario;
    expect(fitOverrides(back)['CORE-hard']).toBeUndefined();
    expect(fitOverrides(back)['MEMT-hard']).toBeCloseTo(380);
    expect(() => setFaultFit(s0, { 'NOPE-hard': 1 })).toThrow(/unknown fault type/);
    expect(() => setFaultFit(topologyScenario('a2-roce', 1000), { 'FABRIC-hard': 10 })).toThrow(/not carried/);
    expect(() => setFaultFit(s0, { 'CORE-hard': -1 })).toThrow(/≥ 0/);
  });

  it('mechanisms: apply with parameters, remove, and the errors', () => {
    const { scenario: s, changed } = editMechanisms(s0, { apply: { 'D-HARD': { detectSeconds: 20 } }, remove: ['R-ELASTIC'] });
    expect(changed).toEqual(['-R-ELASTIC', '+D-HARD']);
    expect(s.mechanisms.applied?.['D-HARD']?.parameters.detectSeconds).toBe(20);
    expect(s.mechanisms.applied?.['R-ELASTIC']).toBeUndefined();
    const again = editMechanisms(s, { apply: { 'D-HARD': { detectSeconds: 5 } } }).scenario;
    expect(again.mechanisms.applied?.['D-HARD']?.parameters.detectSeconds).toBe(5);
    expect(() => editMechanisms(s0, { apply: { 'D-HARD': { nope: 1 } } })).toThrow(/no parameter 'nope'/);
    expect(() => editMechanisms(s0, { remove: ['D-HARD'] })).toThrow(/not applied/);
    expect(() => editMechanisms(s0, { apply: { NOPE: {} } })).toThrow(/unknown mechanism/);
  });

  it('the summary and the vocabulary read the state back', () => {
    const sum = scenarioSummary(setFaultFit(s0, { 'CORE-hard': 500 }).scenario);
    expect(sum.template).toBe('a950-ub2');
    expect(sum.variant).toBe('a950-1k');
    expect(sum.npus).toBe(10000);
    expect(sum.fit.overrides['CORE-hard']).toMatchObject({ fit: 500, unit: 'npu' });
    expect(sum.mechanisms.map((m) => m.id)).toContain('C-FAST');
    expect(sum.workload?.ownedBy).toBe('C-FAST');
    expect(sum.kpi).not.toBeNull();
    expect(sum.kpi!.aOp).toBeGreaterThan(0.9);
    expect(sum.kpi!.aOpDerated).toBeLessThanOrEqual(sum.kpi!.aOp);
    const v = scenarioVocabulary(s0);
    expect(v.fields).toBe(SCENARIO_FIELDS);
    expect(v.classes!.length).toBeGreaterThan(30);
    expect(v.classes!.find((c) => c.id === 'CORE-hard')).toMatchObject({ unit: 'npu', type: 'hard' });
    expect(v.mechanisms.some((m) => m.id === 'D-HARD' && !m.applied)).toBe(true);
    expect(v.mechanisms.some((m) => m.id === 'C-FAST' && m.applied)).toBe(true);
  });
});
