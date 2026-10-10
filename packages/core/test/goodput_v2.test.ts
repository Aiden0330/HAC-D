/**
 * v2 goodput models: exact renewal, implied rollback, product form, headline rule, MTTR mixture recovery.
 * Reference values computed in Python (docs/TRAINING_AVAILABILITY_FORMULAS_AND_COMPARISON.md §1.3) on the
 * ai-cluster baseline: 10k-card hard MTBF 30 h with linear scaling, τ = 300 s, δ = 4 s,
 * R = 12.5 + 180 + 0.01 × 7200 = 264.5 s.
 */
import { describe, it, expect } from 'vitest';
import { renewalGoodput, expectedRollbackS, operationalAvailability, productGoodput, headlineGoodput, goodputFirstOrder, dalyGoodput, scaleTable } from '../src/checkpoint/index.js';
import { parseScenario, evaluateScenario, resolveRecovery, mixtureLadder, workedExample1, scaleAllRates } from '../src/index.js';

const R = 12.5 + 180 + 0.01 * 7200;
const cases = [
  { n: 10000, M: 30 * 3600, aOp: 0.9976, first: 0.9828, product: 0.9831, exact: 0.983, daly: 0.983, W: 151.9 },
  { n: 100000, M: 3 * 3600, aOp: 0.9761, first: 0.9483, product: 0.9499, exact: 0.9498, daly: 0.9495, W: 151.3 },
  { n: 500000, M: 0.6 * 3600, aOp: 0.8909, first: 0.7948, product: 0.8181, exact: 0.8188, daly: 0.8131, W: 148.4 },
];

describe('goodput models on the ai-cluster baseline', () => {
  for (const c of cases) {
    it(`${c.n} cards`, () => {
      expect(operationalAvailability(c.M, R)).toBeCloseTo(c.aOp, 4);
      const fo = goodputFirstOrder(4, 300, c.M, R);
      expect(fo.goodput).toBeCloseTo(c.first, 4);
      expect(productGoodput(300, 4, c.M, R, 150)).toBeCloseTo(c.product, 4);
      expect(renewalGoodput(300, 4, c.M, R)).toBeCloseTo(c.exact, 4);
      expect(dalyGoodput(300, 4, c.M, R)).toBeCloseTo(c.daly, 4);
      expect(expectedRollbackS(300, 4, c.M)).toBeCloseTo(c.W, 1);
    });
  }
  it('limits: λ → 0 gives τ/(τ+δ) and W → (τ²/2 + τδ)/(τ+δ) (τ/2 when δ = 0)', () => {
    expect(renewalGoodput(300, 4, 1e12, 100)).toBeCloseTo(300 / 304, 9);
    expect(expectedRollbackS(300, 4, 1e12)).toBeCloseTo((300 * 300 / 2 + 300 * 4) / 304, 5);
    expect(expectedRollbackS(300, 0, 1e12)).toBeCloseTo(150, 5);
  });
  it('headline rule switches to the exact form when the first-order flags fire', () => {
    const ok = goodputFirstOrder(4, 300, 30 * 3600, R);
    expect(headlineGoodput(ok, 0.5).model).toBe('first-order');
    const bad = goodputFirstOrder(4, 300, 0.6 * 3600, R);
    expect(bad.validity).not.toBe('ok');
    expect(headlineGoodput(bad, 0.8188).goodput).toBeCloseTo(0.8188, 9);
    const rows = scaleTable(1 / (10000 * 30), 4, () => R, [10000, 500000]);
    expect(rows[0].headlineModel).toBe('first-order');
    expect(rows[1].headlineModel).toBe('exact-renewal');
    // the row uses the Young-optimal interval, so compare with the exact form at that interval
    expect(rows[1].headline).toBeCloseTo(renewalGoodput(rows[1].tauS, 4, rows[1].mtbiS, R), 12);
    expect(rows[1].headline).toBeGreaterThan(rows[1].goodput.goodput);
  });
});

describe('MTTR mixture recovery', () => {
  const base = workedExample1();
  it('R = T_det + T_auto + (1 − p_s)·T_manual and shows the three rungs', () => {
    const s = parseScenario({ ...base, recovery: { mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { successProbability: 0.99, seconds: 180 }, manual: { seconds: 7200 } } });
    const m = resolveRecovery(s);
    expect(m.kind).toBe('mixture');
    expect(m.meanS(16384)).toBeCloseTo(R, 9);
    const composed = m.compose(16384);
    expect(composed.stages.map((x) => x.name)).toEqual(['detection', 'automatic', 'manual']);
    expect(composed.stages[2].meanS).toBeCloseTo(72, 9);
    const l = mixtureLadder(s.recovery as Extract<typeof s.recovery, { mode: 'mixture' }>);
    expect(l.rungs[0].successProbability).toBe(0);
    const r = evaluateScenario(s);
    expect(r.training!.recoveryKind).toBe('mixture');
    expect(r.training!.recoveryS).toBeCloseTo(R, 6);
    expect(r.training!.ladder!.pManual).toBeCloseTo(0.01, 9);
    expect(r.formulas.mttr).toMatch(/T_det \+ T_auto/);
  });
  it('defaults apply when only the mode is given', () => {
    const s = parseScenario({ ...base, recovery: { mode: 'mixture' } });
    expect(resolveRecovery(s).meanS(16384)).toBeCloseTo(R, 9);
  });
  it('measured recompute replaces τ/2 in the first-order and product forms', () => {
    const s = parseScenario({ ...base, workload: { ...base.workload, measuredRecomputeS: 30 } });
    const r = evaluateScenario(s).training!;
    expect(r.recomputeSource).toBe('measured');
    expect(r.recomputePerInterruptionS).toBe(30);
    expect(r.firstOrder.terms.recompute).toBeCloseTo(30 / r.mtbiS, 12);
  });
  it('the headline switches to the exact renewal model for a heavily loaded job', () => {
    const ok = evaluateScenario(base).training!;
    expect(ok.headlineModel).toBe('first-order');
    expect(ok.effectiveGoodput).toBeCloseTo(ok.firstOrder.goodput, 9);
    const heavy = evaluateScenario(scaleAllRates(base, 40)).training!;
    expect(heavy.firstOrder.validity).not.toBe('ok');
    expect(heavy.headlineModel).toBe('exact-renewal');
    expect(heavy.headlineGoodput).toBeCloseTo(heavy.renewalGoodput, 12);
    expect(heavy.renewalGoodput).toBeGreaterThan(heavy.firstOrder.goodput);
  });
});
