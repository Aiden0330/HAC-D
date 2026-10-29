/**
 * v5.7 the sixth model review (docs/markdown/MODEL_REVIEW_2026-10-29.md) — regression tests of its fixes:
 *  F1 formula (2′) takes Φ′ from the product of the throughput factors (never G_eff/(1 − S), which exceeds 1 in the exact-renewal regime)
 *  F3 a candidate needs a gain on top of the reference set (C-ASYNC loses where C-FAST already sets the save)
 *  F4 the acceptance value is the exact-renewal effective goodput, which the window ledger reproduces
 *  F5 the straggler law over classes charges each slowed unit its own class's φ
 *  F6 verdicts within the sampled half-width are listed as unresolved
 *  M1 the episode pauses of undetected corruption are booked with the other classes in (2′), as in (3′)
 *  M2 the window ledger books the spare-pool blocking the closed form applies
 */
import { describe, it, expect } from 'vitest';
import { recordScenario } from '../src/budget/index.js';
import { BUILTIN_TOPOLOGY_RECORDS } from '../src/records/topologyRecord.js';
import { DEFAULT_MECHANISM_SET } from '../src/records/mechanismSet.js';
import { kpiForm, trainingOf, metricValue } from '../src/budget/kpiForm.js';
import { requirement, requirementFromKpi } from '../src/strategy/requirement.js';
import { withHardwareFactors } from '../src/strategy/index.js';
import { deratedOf } from '../src/strategy/window.js';
import { DERATE_DEFAULT } from '../src/mechanisms/plan.js';
import { stragglerLaw, stragglerLawClasses } from '../src/ctmc/repair.js';
import { pruneByShapley, type ShapleyByArch } from '../src/study/prune.js';
import { applyMechanisms } from '../src/mechanisms/index.js';
import { buildLedgerRun } from '../src/mc/ledgerFromScenario.js';
import { simulateLedgerReplications, summarizeLedger } from '../src/mc/ledger.js';
import { atlas950Training, workedExample3 } from '../src/scenario/examples.js';
import type { Scenario } from '../src/scenario/schema.js';

const rec = (id: string, n: number) => recordScenario(BUILTIN_TOPOLOGY_RECORDS[id], DEFAULT_MECHANISM_SET, n);
const atK = (s: Scenario, k: number) => withHardwareFactors(s, Object.fromEntries(s.components.filter((c) => c.enabled && c.failure.value > 0).map((c) => [c.id, k])));
const ledgerMean = (s: Scenario, trials: number) => summarizeLedger(simulateLedgerReplications(buildLedgerRun(s, { trials, seed: 1 }).spec, 0, trials, 1), 1);

describe('F1 formula (2′) with the product of the throughput factors', () => {
  it('an unreachable target stays unreachable when today’s derated design is in the exact-renewal regime', () => {
    const s = atK(rec('cm384', 500000), 4);
    const q = requirement(s, 0.985, DERATE_DEFAULT, 'effective');
    expect(q.kpiDerated.headlineModel).toBe('exact-renewal');
    expect(q.reachable).toBe(false);
    expect(q.mtbfAtTodayMttrH).toBeNull();
    expect(q.terms.factors).toBeGreaterThanOrEqual(0);
    // the derated design reaches far less than the goal even with perfect hardware
    expect(trainingOf(atK(deratedOf(s, DERATE_DEFAULT), 1e-3 / 4)).effectiveGoodputExact).toBeLessThan(0.985);
  });
  it('in the first-order regime B equals the former G_eff/(1 − S) form to 1e-9', () => {
    const k = kpiForm(deratedOf(rec('native950', 500000), DERATE_DEFAULT));
    expect(k.headlineModel).toBe('first-order');
    const S = k.saveFrac + (k.sumLoss + k.F + k.otherRecomputeSPerH) / 3600;
    const phiFormer = k.effectiveFirstOrder / (1 - S);
    const bFormer = 3600 * (1 - k.saveFrac - 0.985 / phiFormer) - k.F - k.otherRecomputeSPerH;
    expect(Math.abs(requirementFromKpi(k, 0.985, 'effective').B - bFormer)).toBeLessThan(1e-9);
  });
  it('a reachable target: the two ends and the terms add up (B = total − Σ terms)', () => {
    const k = kpiForm(deratedOf(rec('native950', 10000), DERATE_DEFAULT));
    const q = requirementFromKpi(k, 0.95, 'effective');
    expect(q.reachable).toBe(true);
    expect(Math.abs(q.totalBudget - q.terms.save - q.terms.other - q.terms.factors - q.B)).toBeLessThan(1e-9);
    expect(Math.abs(q.mtbfAtTodayMttrH! - k.lossS / q.B)).toBeLessThan(1e-12);
  });
});

describe('M1 the episode pauses with the other classes in (2′)', () => {
  it('terms.other = F + Q_other + 3600 G* p/((1 − p)Φ), terms.factors = 3600 G*(1/Φ − 1)', () => {
    const k = kpiForm(deratedOf(rec('cm384', 500000), DERATE_DEFAULT));
    expect(k.pauseFrac).toBeGreaterThan(0);
    const q = requirementFromKpi(k, 0.985, 'effective');
    const p = k.pauseFrac;
    expect(Math.abs(q.terms.other - (k.F + k.otherRecomputeSPerH + (3600 * 0.985 * p) / ((1 - p) * k.factor)))).toBeLessThan(1e-9);
    expect(Math.abs(q.terms.factors - 3600 * 0.985 * (1 / k.factor - 1))).toBeLessThan(1e-9);
  });
});

describe('F4 the acceptance value on the exact renewal model', () => {
  it('the metric, the KPI form and the identities', () => {
    const s = rec('native950', 500000);
    const t = trainingOf(s), k = kpiForm(s, t);
    expect(metricValue(t, 'effective')).toBe(t.effectiveGoodputExact);
    expect(k.effective).toBe(t.effectiveGoodputExact);
    expect(k.delivered).toBe(t.deliveredGoodputExact);
    const phiPrime = (1 - k.pauseFrac) * k.factor;
    expect(Math.abs(t.effectiveGoodputExact - phiPrime * t.renewalGoodput)).toBeLessThan(1e-12);
    // the loss form closes on the engine's first-order value; the first-order headline sits below the exact value at 500k
    expect(Math.abs(k.effectiveFirstOrder - phiPrime * t.firstOrder.goodput)).toBeLessThan(1e-12);
    expect(t.headlineModel).toBe('first-order');
    expect(t.effectiveGoodputExact - t.effectiveGoodput).toBeGreaterThan(0.002);
    // the exact ledger's loss lines add up to 1 − G_eff (exact) and the delivered line closes it
    const L = t.ledgerExact;
    expect(Math.abs(L.downtime + L.save + L.rollback + L.slowdown + L.local + L.blocked + L.overhead - (1 - t.effectiveGoodputExact))).toBeLessThan(1e-12);
    expect(Math.abs(L.downtime + L.save + L.rollback + L.slowdown + L.local + L.blocked + L.overhead + L.sdcRollback + L.terminal + L.delivered - 1)).toBeLessThan(1e-9);
  });
  it('the window ledger reproduces the exact value (the window rule and the mean rule test the same number)', () => {
    const s = rec('native950', 500000);
    const t = trainingOf(s);
    const m = ledgerMean(s, 200);
    expect(Math.abs(m.effective.mean - t.effectiveGoodputExact)).toBeLessThan(3 * m.effective.ci95 + 2e-4);
    expect(Math.abs(m.effective.mean - t.effectiveGoodputExact)).toBeLessThan(Math.abs(m.effective.mean - t.effectiveGoodput));
  });
});

describe('F5 the straggler law over classes', () => {
  it('one class (or classes sharing one φ) is the single-class law', () => {
    const one = stragglerLaw(1000, 1e-3, 0.6), multi = stragglerLawClasses([{ n: 1000, p: 1e-3, performance: 0.6 }]);
    expect(Math.abs(multi.performanceFactor - one.performanceFactor)).toBeLessThan(1e-12);
    expect(Math.abs(multi.pSlowed - one.pSlowed)).toBeLessThan(1e-12);
    const split = stragglerLawClasses([{ n: 600, p: 1e-3, performance: 0.6 }, { n: 400, p: 1e-3, performance: 0.6 }]);
    expect(Math.abs(split.performanceFactor - one.performanceFactor)).toBeLessThan(1e-12);
  });
  it('each slowed class at its own φ: the slowest slowed unit sets the step', () => {
    // two classes: q_a = 0.9 at φ 0.5, q_b = 0.8 at φ 0.9 → E = 0.72 + 0.5·0.1 + 0.9·0.2·0.9
    const r = stragglerLawClasses([{ n: 1, p: 0.2, performance: 0.9 }, { n: 1, p: 0.1, performance: 0.5 }]);
    expect(Math.abs(r.performanceFactor - (0.72 + 0.05 + 0.162))).toBeLessThan(1e-12);
  });
  it('heterogeneous classes: the closed-form slowdown matches the ledger (atlas950Training, was 6.91 % against 1.45 %)', () => {
    const s = atlas950Training();
    const t = trainingOf(s), m = ledgerMean(s, 150);
    expect(Math.abs(t.ledgerExact.slowdown - m.ledger.slowdown)).toBeLessThan(0.002);
    expect(Math.abs(m.effective.mean - t.effectiveGoodputExact)).toBeLessThan(0.006);
  });
});

describe('M2 the spare-pool blocking in the window ledger', () => {
  it('workedExample3: the ledger books P_blocked and the per-window value matches the exact closed form', () => {
    const s = workedExample3();
    const t = trainingOf(s);
    expect(t.blockedProbability).toBeGreaterThan(0.002);
    const m = ledgerMean(s, 200);
    expect(Math.abs(m.ledger.blocked - t.ledgerExact.blocked)).toBeLessThan(2e-4);
    expect(Math.abs(m.effective.mean - t.effectiveGoodputExact)).toBeLessThan(3 * m.effective.ci95 + 2e-4);
  });
});

describe('F3 a candidate needs a gain on top of the reference set', () => {
  it('C-ASYNC lowers G_eff on the reference set at 500k (C-FAST already sets the save to 1 s)', () => {
    const s = rec('cm384', 500000);
    const g = (x: Scenario) => trainingOf(x).effectiveGoodputExact;
    expect(s.workload.type === 'training' && s.workload.deltaS).toBe(1);
    expect(g(applyMechanisms(s, ['C-ASYNC'], { 'C-ASYNC': DEFAULT_MECHANISM_SET.parameters['C-ASYNC'] })) - g(s)).toBeLessThan(-0.001);
  });
  it('the rule prunes a mechanism whose Shapley value reaches the threshold but which loses on the reference set', () => {
    const v = (eff: number, ref: number, dlv = 0.0005) => ({ aOp: 0, effective: eff, delivered: dlv, onReference: { aOp: 0, effective: ref, delivered: ref }, halfWidthBy: { aOp: 0, effective: 0.0001, delivered: 0.0001 } });
    const values: ShapleyByArch = { a: { 'C-ASYNC': v(0.002, -0.001), 'R-LINK-LOCAL': v(0.004, 0.002) }, b: { 'C-ASYNC': v(0.0019, -0.0012), 'R-LINK-LOCAL': v(0.005, 0.003) } };
    const r = pruneByShapley(values, ['C-ASYNC', 'R-LINK-LOCAL'], { metric: 'effective' });
    expect(r.verdicts['C-ASYNC'].verdict).toBe('pruned');
    expect(r.verdicts['C-ASYNC'].noReferenceGain).toBe(true);
    expect(r.verdicts['R-LINK-LOCAL'].verdict).toBe('candidate');
    expect(r.verdicts['R-LINK-LOCAL'].noReferenceGain).toBe(false);
  });
});

describe('F6 verdicts within the sampled half-width', () => {
  it('a candidate 0.45 half-widths above the threshold is unresolved; one 10 half-widths above is not', () => {
    const v = (eff: number, hw: number) => ({ aOp: 0, effective: eff, delivered: 0, onReference: { aOp: 0, effective: 0.001, delivered: 0 }, halfWidthBy: { aOp: 0, effective: hw, delivered: 0.0001 } });
    const values: ShapleyByArch = { a: { 'C-LOSSLESS': v(0.0017, 0.00045), 'D-HARD': v(0.0025, 0.0001) }, b: { 'C-LOSSLESS': v(0.0020, 0.00045), 'D-HARD': v(0.003, 0.0001) } };
    const r = pruneByShapley(values, ['C-LOSSLESS', 'D-HARD'], { metric: 'effective' });
    expect(r.verdicts['C-LOSSLESS'].verdict).toBe('candidate');
    expect(r.verdicts['C-LOSSLESS'].resolved).toBe(false);
    expect(r.verdicts['C-LOSSLESS'].margin).toBeCloseTo((0.0017 - 0.0015) / 0.00045, 12);
    expect(r.verdicts['D-HARD'].resolved).toBe(true);
    expect(r.unresolved).toEqual(['C-LOSSLESS']);
  });
});
