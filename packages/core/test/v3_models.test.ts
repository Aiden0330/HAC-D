/**
 * v3 unit tests: mechanism chain, mixed renewal, silent-corruption delivery (closed form vs a brute-force
 * simulation of the alternating renewal process), the finite-window ledger simulator (conservation, limits,
 * agreement with the closed forms and with the reference engine's published means), and the mechanism report.
 */
import { describe, it, expect } from 'vitest';
import { chainOutcome, addOutcome, addPlainEvents, emptyMixedRates, DEFAULT_CHAIN } from '../src/mechanisms/chain.js';
import { renewalGoodputMixed, renewalGoodput } from '../src/checkpoint/index.js';
import { sdcDelivery, pClearedBeforePersist } from '../src/sdc/index.js';
import { Rng } from '../src/math/rng.js';
import { simulateLedger, runLedgerOnce, type LedgerSpec } from '../src/mc/ledger.js';
import { ledgerSpecFromScenario, simulateScenarioLedger } from '../src/mc/ledgerFromScenario.js';
import { MECHANISM_LIBRARY, mechanismReport, applyMechanisms, DEFAULT_PLAYERS } from '../src/mechanisms/index.js';
import { referenceThreeClasses, referenceBaseline, evaluateScenario, parseScenario, compareScenarios, EXAMPLES } from '../src/scenario/index.js';

describe('mechanism chain', () => {
  it('probabilities sum to one and the trivial chain is the global recovery', () => {
    const o = chainOutcome(12.5, 252, {}, { replay: 1, process: 1, elastic: 1 });
    expect(o.trivial).toBe(true);
    expect(o.pGlobal).toBe(1);
    expect(o.pRollback).toBe(1);
    expect(o.meanPauseS).toBeCloseTo(264.5, 12);
    const full = chainOutcome(12.5, 252, DEFAULT_CHAIN, { replay: 0.831, process: 1, elastic: 1 });
    expect(full.pReplay + full.pElastic + full.pProcess + full.pGlobal).toBeCloseTo(1, 12);
    expect(full.pReplay).toBeCloseTo(0.831 * 0.9, 12);
    expect(full.pElastic).toBeCloseTo((1 - 0.831 * 0.9) * 0.98, 12);
    expect(full.pRollback).toBeCloseTo(full.pProcess + full.pGlobal, 12);
    expect(full.pauseRollbackS + full.pauseNoRollbackS).toBeCloseTo(full.meanPauseS, 12);
    // a failed replay charges 10 s before the next rung; a successful elastic pause excludes the detection delay
    const el = full.paths.filter((p) => p.kind === 'elastic');
    expect(el.map((p) => p.pauseS).sort()).toEqual([1, 11]);
    expect(el[0].localLossS).toBeCloseTo((12.5 + 180 - 1) / 50, 12);
  });
  it('applicability fractions scale the rung probabilities', () => {
    const half = chainOutcome(0, 300, { replay: DEFAULT_CHAIN.replay }, { replay: 0.5 });
    expect(half.pReplay).toBeCloseTo(0.45, 12);
    expect(half.pGlobal).toBeCloseTo(0.55, 12);
    expect(half.meanPauseS).toBeCloseTo(0.45 * 5 + 0.5 * 0.1 * 310 + 0.5 * 300, 10);
  });
  it('rate aggregation is rate-weighted', () => {
    let m = emptyMixedRates();
    m = addOutcome(m, 1, chainOutcome(0, 100, {}, {}));
    m = addPlainEvents(m, 3, 10, false);
    expect(m.rollbackRatePerHour).toBe(1);
    expect(m.pauseRatePerHour).toBe(3);
    expect(m.rollbackPauseS).toBe(100);
    expect(m.pauseOnlyS).toBe(10);
  });
});

describe('mixed renewal goodput', () => {
  it('reduces to the classic form without pause-only events and to τ/(τ+δ)/(1 + λ_p R_p) without rollbacks', () => {
    const M = 3 * 3600;
    const a = renewalGoodputMixed({ tauS: 300, deltaS: 4, rollbackRatePerS: 1 / M, rollbackPauseS: 264.5, pauseRatePerS: 0, pauseS: 0 });
    expect(a.goodput).toBeCloseTo(renewalGoodput(300, 4, M, 264.5), 12);
    expect(a.runningFraction).toBeCloseTo(M / (M + 264.5), 12);
    const b = renewalGoodputMixed({ tauS: 300, deltaS: 4, rollbackRatePerS: 0, rollbackPauseS: 0, pauseRatePerS: 1 / 3600, pauseS: 36 });
    expect(b.goodput).toBeCloseTo((300 / 304) / 1.01, 12);
    expect(b.rollbackFraction).toBeCloseTo(0, 12);
  });
  it('pause-only events cost less than rollback events of the same pause', () => {
    const rb = renewalGoodputMixed({ tauS: 300, deltaS: 4, rollbackRatePerS: 1 / 3600, rollbackPauseS: 60, pauseRatePerS: 0, pauseS: 0 });
    const po = renewalGoodputMixed({ tauS: 300, deltaS: 4, rollbackRatePerS: 0, rollbackPauseS: 0, pauseRatePerS: 1 / 3600, pauseS: 60 });
    expect(po.goodput).toBeGreaterThan(rb.goodput);
  });
});

/** brute-force alternating renewal: Exp(ν) clean, deterministic dirty D then pause Rc; returns mean delivered share */
function bruteForce(T: number, nu: number, D: number, Rc: number, g: number, U: number, trials: number, seed = 3): { mean: number; se: number } {
  const rng = new Rng(seed);
  const xs: number[] = [];
  for (let k = 0; k < trials; k++) {
    let t = 0;
    let clean = 0;
    let episodes = 0;
    while (t < T) {
      const x = rng.exponential(nu);
      if (t + x >= T) {
        clean += T - t;
        break;
      }
      clean += x;
      episodes++;
      t += x + D + Rc;
    }
    xs.push((g * clean - U * episodes) / T);
  }
  const mean = xs.reduce((a, b) => a + b, 0) / trials;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (trials - 1));
  return { mean, se: sd / Math.sqrt(trials) };
}

describe('silent-corruption delivery', () => {
  it('matches a brute-force simulation of the alternating renewal process', () => {
    for (const [nu, D, Rc] of [[4.647e-3, 120, 0.07], [0.02, 24, 0.5], [0.05, 6, 0.05]]) {
      const d = sdcDelivery({ horizonH: 720, nuPerWallHour: nu, fallbackDelayH: D, episodePauseH: Rc, cleanGoodput: 0.9, preEpisodeLossH: 0.04 });
      const bf = bruteForce(720, nu, D, Rc, 0.9, 0.04, 40000);
      expect(Math.abs(d.delivered - bf.mean), `ν=${nu} D=${D}`).toBeLessThan(4 * bf.se + 1e-4);
      expect(d.method).toBe('exact-renewal-sum');
    }
  });
  it('limits: ν → 0 gives g; an infinite fallback gives g·(1 − e^{−νT})/(νT); the ledger closes', () => {
    const none = sdcDelivery({ horizonH: 720, nuPerWallHour: 0, fallbackDelayH: 120, episodePauseH: 0.1, cleanGoodput: 0.95, preEpisodeLossH: 0.04 });
    expect(none.delivered).toBe(0.95);
    const inf = sdcDelivery({ horizonH: 720, nuPerWallHour: 0.01, fallbackDelayH: 1e6, episodePauseH: 0, cleanGoodput: 0.95, preEpisodeLossH: 0 });
    expect(inf.delivered).toBeCloseTo(0.95 * inf.cTimeNoRecovery, 9);
    expect(inf.pDirtyAtEnd).toBeCloseTo(1 - Math.exp(-0.01 * 720), 9);
    const d = sdcDelivery({ horizonH: 720, nuPerWallHour: 0.02, fallbackDelayH: 24, episodePauseH: 0.5, cleanGoodput: 0.9, preEpisodeLossH: 0.04 });
    expect(d.cleanTimeFraction + d.dirtyTimeFraction + d.pauseFraction).toBeCloseTo(1, 9);
    expect(d.delivered + d.rollbackFraction + d.terminalDiscardFraction).toBeCloseTo(0.9 * (1 - d.pauseFraction), 9);
    expect(d.expectedDiscovered).toBeLessThanOrEqual(d.expectedEpisodes);
  });
  it('falls back to the stationary fractions when cycles are very short', () => {
    const d = sdcDelivery({ horizonH: 720, nuPerWallHour: 5, fallbackDelayH: 0.01, episodePauseH: 0.001, cleanGoodput: 0.9, preEpisodeLossH: 0 });
    expect(d.method).toBe('stationary');
    expect(d.cleanTimeFraction).toBeCloseTo(1 / (1 + 5 * 0.011), 9);
  });
  it('P(cleared before persist) is 1 − (1 − e^{−x})/x', () => {
    expect(pClearedBeforePersist(1 / 3, 304 / 3600)).toBeCloseTo(1 - (1 - Math.exp(-304 / 3600 / 3)) / (304 / 3600 / 3), 12);
    expect(pClearedBeforePersist(1e-9, 1)).toBeCloseTo(5e-10, 15);
  });
});

function toySpec(over: Partial<LedgerSpec> = {}): LedgerSpec {
  return {
    horizonH: 720,
    tauS: 300,
    deltaS: 4,
    detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 },
    globalRecovery: (rng) => () => 180 + (rng.uniform() < 0.99 ? 0 : 7200),
    chain: {},
    sdc: { coverage: 0, detectSeconds: 1, fallbackDelayHours: 120 },
    classes: [{ id: 'card', hardRatePerHour: 1 / 3, sdcRatePerHour: (1 / 3) * (0.014 / 0.966), applicable: { replay: 0, process: 0, elastic: 0 }, slow: { ratePerHour: (1 / 3) * (0.02 / 0.966), detectProbability: 0.95, detectDelayH: 5 / 60, lifetimeH: 24, performance: 0.95, policy: 'isolate' } }],
    ...over,
  };
}

describe('finite-window ledger simulation', () => {
  it('conserves time and books every class', () => {
    const r = runLedgerOnce(toySpec(), new Rng(1), new Rng(2));
    const l = r.ledger;
    expect(r.correctH + l.downtime + l.save + l.slowdown + l.rollback + l.terminalInvalid + l.localLoss).toBeCloseTo(720, 6);
    expect(l.rollbackHard + l.rollbackSdc).toBeCloseTo(l.rollback, 9);
    expect(r.byClass.card.events).toBe(r.counts.hard + r.counts.slow + r.counts.sdc);
  });
  it('without faults only the periodic saves are lost', () => {
    const r = runLedgerOnce(toySpec({ classes: [{ id: 'x', hardRatePerHour: 0, sdcRatePerHour: 0, applicable: { replay: 0, process: 0, elastic: 0 } }] }), new Rng(1), new Rng(2));
    expect(r.correctH).toBeCloseTo(720 - Math.floor((720 * 3600) / 304) * (4 / 3600), 6);
    expect(r.operationalAvailability).toBe(1);
  });
  it('step recovery alone has no effect; full immediate detection leaves no terminal discard', () => {
    const base = runLedgerOnce(toySpec(), new Rng(5), new Rng(6));
    const step = runLedgerOnce(toySpec({ sdc: { coverage: 0, detectSeconds: 1, fallbackDelayHours: 120, step: { stepSeconds: 1, recoverSeconds: 1 } } }), new Rng(5), new Rng(6));
    expect(step.correctH).toBe(base.correctH);
    for (let i = 0; i < 20; i++) {
      const full = runLedgerOnce(toySpec({ sdc: { coverage: 1, detectSeconds: 1, fallbackDelayHours: 120 } }), new Rng(100 + i), new Rng(200 + i));
      expect(full.ledger.terminalInvalid).toBe(0);
      expect(full.unresolvedAtEnd).toBe(false);
    }
  });
  it('agrees with the closed forms on the reference three-class baseline at 100k cards', () => {
    const s = referenceThreeClasses(100000);
    const spec = ledgerSpecFromScenario(s);
    expect(spec.classes).toHaveLength(4);
    expect(spec.classes.reduce((a, c) => a + c.hardRatePerHour, 0)).toBeCloseTo(1 / 3, 9);
    expect(spec.classes.reduce((a, c) => a + c.sdcRatePerHour, 0)).toBeCloseTo((1 / 3) * (0.014 / 0.966), 7);
    const mc = simulateScenarioLedger(s, { trials: 300, seed: 11 });
    // reference engine (4000 trials): 62.56 % ± 0.46; HAC-D closed form 62.6 %
    expect(Math.abs(mc.summary.delivered.mean - mc.closedForm.delivered)).toBeLessThan(3 * mc.summary.delivered.ci95 + 0.005);
    expect(Math.abs(mc.summary.delivered.mean - 0.6256)).toBeLessThan(3 * mc.summary.delivered.ci95 + 0.005);
    expect(Math.abs(mc.summary.operationalAvailability.mean - 0.9756)).toBeLessThan(0.003);
    expect(mc.summary.ledger.save).toBeCloseTo(0.01265, 3);
  });
  it('mechanisms reduce downtime in the simulation as in the closed form', () => {
    const base = referenceThreeClasses(100000);
    const withChain = applyMechanisms(base, ['R-REPLAY', 'R-ELASTIC', 'R-PROCESS']);
    const a = simulateLedger(ledgerSpecFromScenario(base), 150, 21);
    const b = simulateLedger(ledgerSpecFromScenario(withChain), 150, 21);
    expect(b.operationalAvailability.mean).toBeGreaterThan(a.operationalAvailability.mean);
    expect(b.counts.replay + b.counts.elastic + b.counts.process).toBeGreaterThan(0);
    expect(b.ledger.localLoss).toBeGreaterThan(0);
  });
});

describe('scenario-level v3 (reference three-class baseline)', () => {
  it('reproduces the reference delivered goodput and operational availability at four scales', () => {
    // audited reference engine, 4000 30-day trials each (results.json): mean ± 95 % CI half-width
    const ref = [
      { n: 10000, delivered: 0.93332, ci: 0.00256, aOp: 0.99749 },
      { n: 100000, delivered: 0.62559, ci: 0.00458, aOp: 0.97556 },
      { n: 200000, delivered: 0.4587, ci: 0.00395, aOp: 0.95235 },
      { n: 500000, delivered: 0.25244, ci: 0.00262, aOp: 0.8888 },
    ];
    for (const r of ref) {
      const t = evaluateScenario(referenceThreeClasses(r.n)).training!;
      expect(Math.abs(t.deliveredGoodput - r.delivered), `${r.n} delivered`).toBeLessThan(r.ci);
      expect(Math.abs(t.operationalAvailability - r.aOp), `${r.n} A_op`).toBeLessThan(0.0005);
      expect(t.sdc).toBeDefined();
      expect(t.deliveredGoodput).toBeLessThan(t.effectiveGoodput);
      const l = t.ledger;
      expect(l.downtime + l.save + l.rollback + l.slowdown + l.local + l.blocked + l.sdcRollback + l.terminal + l.delivered).toBeCloseTo(1, 9);
    }
  });
  it('the hard-only baseline is unchanged by the v3 machinery', () => {
    const t = evaluateScenario(referenceBaseline(100000)).training!;
    expect(t.operationalAvailability).toBeCloseTo(0.9761, 3);
    expect(t.renewalGoodput).toBeCloseTo(0.9498, 3);
    expect(t.deliveredGoodput).toBe(t.effectiveGoodput);
    expect(t.sdc).toBeUndefined();
    expect(t.chain.active).toBe(false);
    expect(t.pRollback).toBe(1);
  });
  it('single mechanisms move the closed form the way the reference moves (100k cards)', () => {
    const s = referenceThreeClasses(100000);
    const v = (ids: string[]) => evaluateScenario(applyMechanisms(s, ids)).training!.deliveredGoodput;
    const base = v([]);
    // reference paired deltas (points): sdcDetect +30.06 ± 0.47, replay +0.56 ± 0.09, process +0.43 ± 0.07, elastic +1.50 ± 0.58, fast +0.26 ± 0.07, combined +32.16 ± 0.49
    expect((v(['D-SDC']) - base) * 100).toBeGreaterThan(29);
    expect((v(['D-SDC']) - base) * 100).toBeLessThan(31);
    expect((v(['R-REPLAY']) - base) * 100).toBeGreaterThan(0.4);
    expect((v(['R-PROCESS']) - base) * 100).toBeGreaterThan(0.3);
    expect((v(['R-ELASTIC']) - base) * 100).toBeGreaterThan(0.9);
    expect((v(['C-FAST']) - base) * 100).toBeGreaterThan(0.15);
    expect((v(DEFAULT_PLAYERS) - base) * 100).toBeGreaterThan(31.5);
    expect((v(DEFAULT_PLAYERS) - base) * 100).toBeLessThan(33);
    // step recovery needs immediate detection
    expect(v(['R-SDC'])).toBeCloseTo(base, 12);
    expect(v(['D-SDC', 'R-SDC'])).toBeGreaterThan(v(['D-SDC']));
  });
  it('isolation of a detected sub-healthy unit is a pause without rollback', () => {
    const t = evaluateScenario(referenceThreeClasses(100000)).training!;
    expect(t.pauseOnlyRatePerHour).toBeGreaterThan(0);
    expect(t.pRollback).toBeLessThan(1);
    expect(t.subhealth!.isolationInterruptionsPerHour).toBeCloseTo(t.pauseOnlyRatePerHour, 9);
  });
  it('schema: sdc and mechanisms default to inert values and round-trip', () => {
    const s = parseScenario({ meta: { name: 'x' }, components: [{ id: 'g', subsystem: 'compute', countRule: { per: 'gpu' }, failure: { value: 1e-5, unit: 'per_h' }, repair: { mttrHours: 1 } }], workload: { type: 'training', nGpus: 1000, deltaS: 10 } });
    expect(s.sdc.detection.coverage).toBe(0);
    expect(s.sdc.fallbackDelayHours).toBe(120);
    expect(s.mechanisms.replay).toBeUndefined();
    const r = evaluateScenario(s).training!;
    expect(r.sdc).toBeUndefined();
    expect(r.deliveredGoodput).toBe(r.effectiveGoodput);
    expect(EXAMPLES['ref-three-classes-100k']).toBeDefined();
    const cmp = compareScenarios([referenceBaseline(100000), referenceThreeClasses(100000)]);
    expect(cmp.rows[1].deliveredGoodput).toBeLessThan(cmp.rows[0].deliveredGoodput!);
    expect(cmp.best.deliveredGoodput).toBe(cmp.rows[0].id);
  });
});

describe('mechanism library and attribution', () => {
  it('has the twelve reference mechanisms with transforms for the eight parameterised ones', () => {
    expect(MECHANISM_LIBRARY.map((m) => m.id)).toEqual(['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'R-CKPT', 'R-MANUAL', 'C-FAST', 'H-PROTECT', 'H-RELIABILITY']);
    expect(MECHANISM_LIBRARY.filter((m) => m.apply).map((m) => m.id)).toEqual(['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST', 'H-RELIABILITY']);
  });
  it('Shapley values sum to the combined gain; single gains carry an interaction term', () => {
    const rep = mechanismReport(referenceThreeClasses(100000));
    expect(rep.coalitions).toBe(64);
    expect(Math.abs(rep.residual)).toBeLessThan(1e-12);
    expect(rep.gains.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 9);
    const sdc = rep.gains.find((g) => g.id === 'D-SDC')!;
    expect(sdc.shapley).toBeGreaterThan(0.29);
    expect(sdc.single).toBeGreaterThan(0.29);
    const step = rep.gains.find((g) => g.id === 'R-SDC')!;
    expect(step.single).toBeCloseTo(0, 12);
    expect(step.shapley).toBeGreaterThan(0);
    expect(rep.notes.some((n) => n.includes('coalitions'))).toBe(true);
    // the other metrics are available for every coalition
    const aop = mechanismReport(referenceThreeClasses(100000), ['R-REPLAY', 'R-ELASTIC'], { metric: 'aOp' });
    expect(aop.delta).toBeGreaterThan(0);
    expect(aop.gains.find((g) => g.id === 'R-ELASTIC')!.shapley).toBeGreaterThan(aop.gains.find((g) => g.id === 'R-REPLAY')!.shapley);
  });
  it('parameter overrides and the H-RELIABILITY reduction factor apply', () => {
    const s = referenceThreeClasses(100000);
    const base = evaluateScenario(s).training!.deliveredGoodput;
    const half = evaluateScenario(applyMechanisms(s, ['H-RELIABILITY'], { 'H-RELIABILITY': { reduction: 0.5 } })).training!;
    expect(half.interruptionRatePerHour).toBeLessThan(evaluateScenario(s).training!.interruptionRatePerHour);
    expect(half.deliveredGoodput).toBeGreaterThan(base);
    const fast = applyMechanisms(s, ['C-FAST'], { 'C-FAST': { computeSeconds: 120, saveSeconds: 2 } });
    expect(fast.workload.type === 'training' && fast.workload.intervalS).toBe(120);
    expect(applyMechanisms(s, ['R-CKPT', 'H-PROTECT'])).toBe(s);
  });
});
