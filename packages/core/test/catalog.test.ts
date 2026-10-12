/** The 54-event reference catalog example: totals equal the four-source example; mechanism combinations match the reference engine. */
import { describe, it, expect } from 'vitest';
import { REFERENCE_EVENTS, referenceCatalog, referenceThreeClasses, evaluateScenario, applyMechanisms } from '../src/index.js';

describe('reference catalog (54 events)', () => {
  it('carries the class budgets of the audited catalog', () => {
    const sum = (t: string) => REFERENCE_EVENTS.filter((e) => e.type === t).reduce((a, e) => a + e.fit, 0);
    expect(REFERENCE_EVENTS).toHaveLength(54);
    expect(sum('hard')).toBeCloseTo(1e9 / (10000 * 30), 6);
    expect(sum('slow') / (sum('hard') + sum('slow') + sum('sdc'))).toBeCloseTo(0.02, 9);
    expect(sum('sdc') / (sum('hard') + sum('slow') + sum('sdc'))).toBeCloseTo(0.014, 9);
  });
  it('matches the four-source example at job level and with single mechanisms', () => {
    for (const N of [100000, 500000]) {
      const a = evaluateScenario(referenceCatalog(N)).training!;
      const b = evaluateScenario(referenceThreeClasses(N)).training!;
      expect(a.operationalAvailability).toBeCloseTo(b.operationalAvailability, 6);
      expect(a.deliveredGoodput).toBeCloseTo(b.deliveredGoodput, 6);
      for (const id of ['R-REPLAY', 'R-PROCESS', 'R-ELASTIC']) {
        const ta = evaluateScenario(applyMechanisms(referenceCatalog(N), [id])).training!;
        const tb = evaluateScenario(applyMechanisms(referenceThreeClasses(N), [id])).training!;
        expect(ta.operationalAvailability).toBeCloseTo(tb.operationalAvailability, 4);
      }
    }
  });
  it('reproduces the reference combined scenario (per-event flags), where the four-source fractions over-credit', () => {
    const six = ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
    // reference results.json: combined A_op 99.098 / 95.665 %, delivered 94.718 ± 0.192 / 82.791 ± 0.344 % at 100k / 500k cards
    const ref = { 100000: { aOp: 0.99098, delivered: 0.94718, ci: 0.00192 }, 500000: { aOp: 0.95665, delivered: 0.82791, ci: 0.00344 } } as const;
    for (const N of [100000, 500000] as const) {
      const cat = evaluateScenario(applyMechanisms(referenceCatalog(N), six)).training!;
      const four = evaluateScenario(applyMechanisms(referenceThreeClasses(N), six)).training!;
      expect(Math.abs(cat.operationalAvailability - ref[N].aOp)).toBeLessThan(0.0002);
      expect(Math.abs(cat.deliveredGoodput - ref[N].delivered)).toBeLessThan(ref[N].ci + 0.001);
      expect(four.operationalAvailability).toBeGreaterThan(cat.operationalAvailability + 0.001);
    }
  });
});
