/** v3 allocation: delivered-goodput basis with silent corruption (target conversion, hardware feasibility, required detection). */
import { describe, it, expect } from 'vitest';
import { allocateScenario, referenceThreeClasses, referenceBaseline, applyMechanisms, evaluateScenario } from '../src/index.js';

describe('allocation on the delivered-goodput basis', () => {
  const three = referenceThreeClasses(50000);
  it('finds the detection coverage and fallback delay needed for 90 % at 50k cards', () => {
    const a = allocateScenario(three, { goodputTarget: 0.9, method: 'arinc', basis: 'delivered' });
    expect(a.sdc).toBeDefined();
    const sdc = a.sdc!;
    expect(sdc.currentDelivered).toBeCloseTo(0.7667, 3);
    expect(sdc.feasibleByHardware).toBe(false);
    expect(sdc.maxDeliveredByHardware).toBeLessThan(0.9);
    expect(sdc.requiredCoverage).toBeCloseTo(0.7154, 3);
    expect(sdc.requiredFallbackDelayH).toBeCloseTo(32.0, 0);
    expect(sdc.coverageUsed).toBeCloseTo(sdc.requiredCoverage!, 9);
    // the budget scenario (coverage raised) reaches the target exactly, so the interruption budget has slack
    expect(a.goodput!.lossBudget).toBeGreaterThan(a.goodput!.current.loss);
    expect(a.rateAllocation).toBeDefined();
    expect(a.rateAllocation!.rows).toHaveLength(4);
    for (const r of a.rateAllocation!.rows) expect(r.improvementFactor!).toBeLessThan(1);
    expect(a.stageAllocation).toBeDefined();
    expect(a.notes.some((n) => n.includes('out of reach of the hardware alone'))).toBe(true);
    // the required coverage indeed delivers 90 %
    const check = applyMechanisms(three, ['D-SDC'], { 'D-SDC': { coverage: sdc.requiredCoverage!, detectSeconds: 1 } });
    expect(evaluateScenario(check).training!.deliveredGoodput).toBeCloseTo(0.9, 3);
  });
  it('with the reference detection (95 %) the target is reachable by hardware and the rate table shows the slack', () => {
    const a = allocateScenario(applyMechanisms(three, ['D-SDC']), { goodputTarget: 0.9, method: 'arinc', basis: 'delivered' });
    expect(a.sdc!.feasibleByHardware).toBe(true);
    expect(a.sdc!.currentDelivered).toBeGreaterThan(0.95);
    expect(a.sdc!.requiredCoverage).toBeCloseTo(0.95, 9);
    expect(a.sdc!.effectiveTarget).toBeCloseTo(0.9 / a.sdc!.factor, 9);
    expect(a.goodput!.fixRecovery.improvementFactor).toBeLessThan(1);
    expect(a.rateAllocation!.rows.every((r) => r.lambdaAggregate > (r.currentAggregate ?? 0))).toBe(true);
  });
  it('without silent corruption the delivered basis reduces to the effective basis', () => {
    const hard = referenceBaseline(50000);
    const d = allocateScenario(hard, { goodputTarget: 0.9, basis: 'delivered' });
    const e = allocateScenario(hard, { goodputTarget: 0.9 });
    expect(d.sdc).toBeUndefined();
    expect(d.goodput!.fixRecovery.requiredMtbiS).toBeCloseTo(e.goodput!.fixRecovery.requiredMtbiS, 9);
    expect(d.notes.some((n) => n.includes('no silent corruption'))).toBe(true);
    // slack case still produces the allowed-rate table
    expect(e.rateAllocation!.rows).toHaveLength(4);
  });
});

describe('allocation method weights (v3.3)', () => {
  const base = referenceBaseline(100000);
  const tight = { goodputTarget: 0.97, method: 'arinc' as const };
  const rows = (s: ReturnType<typeof referenceBaseline>, method: 'equal' | 'arinc' | 'agree' | 'feasibility' | 'minimum-effort' | 'cost-optimal') => allocateScenario(s, { ...tight, method }).rateAllocation!.rows.map((r) => r.lambdaAggregate);
  it('equal, AGREE and feasibility coincide on the reference example and the report says so', () => {
    const a = allocateScenario(base, tight);
    expect(a.coincide).toEqual(['equal', 'agree', 'feasibility']);
    expect(rows(base, 'equal')).toEqual(rows(base, 'agree').map((v) => expect.closeTo(v, 12)));
    expect(rows(base, 'arinc')[0]).not.toBeCloseTo(rows(base, 'equal')[0], 6);
  });
  it('importance and feasibility weights differentiate the methods; a fixed class keeps its rate; cost coefficients move the cost-optimal split', () => {
    const w = JSON.parse(JSON.stringify(base)) as typeof base;
    w.components[0].allocation = { importance: 0.5, feasibilityWeight: 4, costA: 3, costB: 2 };
    w.components[2].allocation = { fixed: true }; // the network class keeps its rate
    const a = allocateScenario(w, tight);
    expect(a.coincide).toEqual([]);
    const agree = rows(w, 'agree');
    const equal = rows(w, 'equal');
    expect(agree[0]).not.toBeCloseTo(equal[0], 6);
    const feas = rows(w, 'feasibility');
    expect(feas[0] / feas[1]).toBeCloseTo(4 / 2, 9); // weight 4 vs the default 2 for assumed rates
    const current = base.components[2].failure.value * 100000;
    for (const m of ['equal', 'arinc', 'agree', 'feasibility', 'minimum-effort', 'cost-optimal'] as const) expect(rows(w, m)[2]).toBeCloseTo(current, 12);
    const costW = rows(w, 'cost-optimal');
    const costBase = rows(base, 'cost-optimal');
    expect(costW[0] / costW[1]).not.toBeCloseTo(costBase[0] / costBase[1], 4);
  });
  it('cost-optimal respects the 5 % floors and reports an infeasible budget instead of allocating below them', () => {
    const a = allocateScenario(base, { goodputTarget: 0.98, method: 'cost-optimal' });
    expect(a.rateAllocation).toBeDefined();
    for (const r of a.rateAllocation!.rows) expect(r.lambdaAggregate).toBeGreaterThanOrEqual((r.currentAggregate ?? 0) * 0.05 - 1e-15);
    const b = allocateScenario(base, { goodputTarget: 0.995, method: 'cost-optimal' });
    expect(b.rateAllocation).toBeUndefined();
    expect(b.notes.some((n) => n.includes('Budget below the sum of best-known achievable rates'))).toBe(true);
  });
});

describe('v3.6: target out of reach of detection alone', () => {
  it('budgets at q = 1 with a meaningful interruption budget and an explicit note', async () => {
    const { EXAMPLES } = await import('../src/index.js');
    const a = allocateScenario(EXAMPLES['ref-catalog-100k'](), { goodputTarget: 0.95, basis: 'delivered', method: 'arinc' });
    expect(a.sdc).toBeDefined();
    expect(a.sdc!.feasibleByHardware).toBe(false);
    expect(a.sdc!.requiredCoverage).toBeUndefined();
    expect(a.sdc!.coverageUsed).toBe(1);
    expect(a.sdc!.effectiveTarget).toBeLessThan(0.96);
    expect(a.notes.some((n) => n.includes('out of reach even with 100 % immediate detection') && n.includes('assume q = 1'))).toBe(true);
    const factor = a.rateAllocation!.rows.find((r) => r.id === 'CORE-hard')!.improvementFactor!;
    expect(factor).toBeGreaterThan(1);
    expect(factor).toBeLessThan(2);
  });
});
