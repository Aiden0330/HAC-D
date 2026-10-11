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
