/** v3.1 mechanism planner: cheapest feasible coalition, necessary mechanisms, derating, scan, verification. */
import { describe, it, expect } from 'vitest';
import { planToTarget, derateParameters, DERATE_DEFAULT, referenceThreeClasses, MECHANISM_LIBRARY, evaluateScenario, applyMechanisms } from '../src/index.js';

describe('mechanism planner', () => {
  it('derates coverage, success and times but not design choices', () => {
    const d = derateParameters({ coverage: 0.95, success: 0.98, detectSeconds: 1, successSeconds: 5, computeSeconds: 60, saveSeconds: 1, domains: 50, reduction: 0.4 }, DERATE_DEFAULT);
    expect(d.coverage).toBeCloseTo(0.9, 12);
    expect(d.success).toBeCloseTo(0.9, 12);
    expect(d.detectSeconds).toBeCloseTo(1.5, 12);
    expect(d.successSeconds).toBeCloseTo(7.5, 12);
    expect(d.computeSeconds).toBe(60);
    expect(d.saveSeconds).toBeCloseTo(1.5, 12);
    expect(d.domains).toBe(50);
    expect(d.reduction).toBeCloseTo(0.2, 12);
  });
  it('library entries carry effort scores', () => {
    for (const m of MECHANISM_LIBRARY) expect(m.effort).toBeGreaterThanOrEqual(0);
    expect(MECHANISM_LIBRARY.find((m) => m.id === 'D-SDC')!.effort).toBe(5);
    expect(MECHANISM_LIBRARY.find((m) => m.id === 'R-REPLAY')!.effort).toBe(2);
  });
  it('90 % at 50k cards: D-SDC alone is the cheapest feasible set and is necessary', () => {
    const p = planToTarget(referenceThreeClasses(50000), { target: 0.9, scan: true });
    expect(p.coalitions).toHaveLength(64);
    expect(p.plan).toBeDefined();
    expect(p.plan!.ids).toEqual(['D-SDC']);
    expect(p.plan!.value).toBeGreaterThan(0.95);
    expect(p.plan!.derated).toBeGreaterThan(0.9);
    expect(p.necessary).toEqual(['D-SDC']);
    expect(p.feasibleCount).toBe(32); // every coalition containing D-SDC
    expect(p.pareto.length).toBeGreaterThan(1);
    for (let i = 1; i < p.pareto.length; i++) expect(p.pareto[i].effort).toBeGreaterThanOrEqual(p.pareto[i - 1].effort);
    expect(p.scan!.cells).toHaveLength(25);
    // value at coverage 0.95 / 180 s in the scan equals the evaluated plan
    const cell = p.scan!.cells.find((c) => c.coverage === 0.95 && c.recoverySeconds === 180)!;
    expect(cell.value).toBeCloseTo(p.plan!.value, 9);
    expect(p.notes.some((n) => n.startsWith('cheapest feasible set'))).toBe(true);
  });
  it('90 % at 500k cards is out of reach with the library targets; the scan shows what coverage is needed', () => {
    const p = planToTarget(referenceThreeClasses(500000), { target: 0.9, scan: true, verify: undefined });
    expect(p.plan).toBeUndefined();
    expect(p.maxValue).toBeLessThan(0.9);
    expect(p.notes.some((n) => n.includes('no coalition'))).toBe(true);
    const best = p.scan!.cells.reduce((a, c) => (c.value > a.value ? c : a));
    expect(best.coverage).toBe(1);
    expect(best.value).toBeGreaterThan(0.9);
  });
  it('derating can reject a nominally feasible set; disabling it keeps the nominal decision', () => {
    const s = referenceThreeClasses(50000);
    const tight = planToTarget(s, { target: 0.93, players: ['D-SDC', 'R-REPLAY'], parameters: { 'D-SDC': { coverage: 0.86, detectSeconds: 1 } } });
    const nominalOnly = planToTarget(s, { target: 0.93, players: ['D-SDC', 'R-REPLAY'], parameters: { 'D-SDC': { coverage: 0.86, detectSeconds: 1 } }, derate: null });
    expect(nominalOnly.plan).toBeDefined();
    expect(tight.feasibleCount).toBeLessThanOrEqual(nominalOnly.feasibleCount);
    const dsdc = tight.coalitions.find((c) => c.ids.join() === 'D-SDC')!;
    expect(dsdc.derated).toBeLessThan(dsdc.value);
  });
  it('verification runs the ledger simulation on the chosen plan', () => {
    const p = planToTarget(referenceThreeClasses(50000), { target: 0.9, players: ['D-SDC'], verify: { trials: 60, seed: 5, confidence: 0.5 } });
    expect(p.verification).toBeDefined();
    expect(p.verification!.trials).toBe(60);
    expect(Math.abs(p.verification!.mean - p.plan!.value)).toBeLessThan(0.03);
    const planned = applyMechanisms(p.players.length ? referenceThreeClasses(50000) : referenceThreeClasses(50000), p.plan!.ids);
    // v5.7 the planner's values are the exact-renewal goodputs (mechanismValues)
    expect(evaluateScenario(planned).training!.deliveredGoodputExact).toBeCloseTo(p.plan!.value, 9);
  });
});
