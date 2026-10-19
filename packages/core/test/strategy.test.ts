/** v4 allocation strategies: target closure, floors, effort ordering, hardware splits, slack. */
import { describe, it, expect } from 'vitest';
import { topologyScenario } from '../src/topology/index.js';
import { allocateStrategy, strategyAcrossSizes, withHardwareFactors, applyLevers, DEFAULT_LEVERS } from '../src/strategy/index.js';
import { evaluateScenario } from '../src/scenario/evaluate.js';

const s = topologyScenario('a3-ub384', 20000);
const aOp = (sc: typeof s) => evaluateScenario(sc, { structure: false }).training!.operationalAvailability;

describe('v4 allocation strategies', () => {
  const T = 0.999;
  const opt = allocateStrategy(s, { strategy: 'optimal', target: T });
  const mttr = allocateStrategy(s, { strategy: 'mttr-first', target: T });
  const mttf = allocateStrategy(s, { strategy: 'mttf-first', target: T });

  it('every strategy reaches the target nominally and derated, and the final design re-evaluates to it', () => {
    for (const r of [opt, mttr, mttf]) {
      expect(r.feasible).toBe(true);
      expect(r.final.value).toBeGreaterThanOrEqual(T);
      expect(r.final.derated).toBeGreaterThanOrEqual(T - 1e-12);
      expect(aOp(r.scenario)).toBeCloseTo(r.final.value, 12);
    }
    expect(opt.baseline.value).toBeLessThan(T);
  });

  it('optimal is never more expensive than the preferred strategies', () => {
    expect(opt.effort.total).toBeLessThanOrEqual(mttr.effort.total + 0.05);
    expect(opt.effort.total).toBeLessThanOrEqual(mttf.effort.total + 0.05);
  });

  it('MTTF-preferred uses hardware only while the floors suffice; MTTR-preferred moves the recovery side first', () => {
    expect(mttf.mechanisms).toEqual([]);
    expect(mttf.levers).toEqual([]);
    expect(mttf.hardware.effort).toBeGreaterThan(mttr.hardware.effort);
    expect(mttr.mechanisms.length + mttr.levers.length).toBeGreaterThan(0);
  });

  it('hardware factors respect the floors and the split rule', () => {
    for (const r of [opt, mttr, mttf]) for (const h of r.hardware.rows) { expect(h.factor).toBeGreaterThanOrEqual(h.floor - 1e-12); expect(h.factor).toBeLessThanOrEqual(1); }
    // min-effort with equal effort weights: improved classes above their floor end at one common contribution level
    const cut = mttf.hardware.rows.filter((h) => h.factor < 1 && !h.atFloor);
    const pts = cut.map((h) => h.pointsAfter);
    expect(Math.max(...pts) / Math.min(...pts)).toBeLessThan(1.0001);
    // ARINC: one uniform factor over the classes that are not at a floor
    const arinc = allocateStrategy(s, { strategy: 'mttf-first', target: T, hardwareSplit: 'arinc' });
    const f = arinc.hardware.rows.filter((h) => !h.atFloor).map((h) => h.factor);
    expect(Math.max(...f) - Math.min(...f)).toBeLessThan(1e-9);
    expect(arinc.hardware.effort).toBeGreaterThan(mttf.hardware.effort);
    const agree = allocateStrategy(s, { strategy: 'mttf-first', target: T, hardwareSplit: 'agree' });
    expect(agree.feasible).toBe(true);
  });

  it('a met target needs no moves and reports the hardware slack', () => {
    const r = allocateStrategy(s, { strategy: 'mttr-first', target: 0.99 });
    expect(r.mechanisms).toEqual([]);
    expect(r.hardware.needed).toBe(false);
    expect(r.hardware.slackFactor!).toBeGreaterThan(1);
    expect(aOp(withHardwareFactors(s, Object.fromEntries(s.components.map((c) => [c.id, r.hardware.slackFactor! * 0.999]))))).toBeGreaterThanOrEqual(0.99);
  });

  it('out-of-reach targets are reported as infeasible with the hardware at its floors', () => {
    const r = allocateStrategy(s, { strategy: 'mttf-first', target: 0.99999, levers: false, candidates: [] });
    expect(r.feasible).toBe(false);
    expect(r.hardware.atFloors.length).toBeGreaterThan(0);
  });

  it('levers move the mixture recovery to their limits, derated limits never worse than the current value', () => {
    const l = applyLevers(s, DEFAULT_LEVERS, null);
    expect(l.recovery.mode === 'mixture' && l.recovery.automatic.seconds).toBe(60);
    const d = applyLevers(s, DEFAULT_LEVERS, { coverageDelta: 0.05, successDelta: 0.08, timeFactor: 10, reductionFactor: 0.5 });
    expect(d.recovery.mode === 'mixture' && d.recovery.automatic.seconds).toBe(180);
    expect(d.recovery.mode === 'mixture' && d.recovery.automatic.successProbability).toBe(0.99);
  });

  it('cross-scale: the hardware effort grows with the cluster size', () => {
    const rows = strategyAcrossSizes(s, [1000, 10000, 50000], { strategy: 'mttr-first', target: T });
    expect(rows.map((r) => r.npus)).toEqual([1000, 10000, 50000]);
    expect(rows[0].effort.total).toBeLessThanOrEqual(rows[2].effort.total);
  });
});
