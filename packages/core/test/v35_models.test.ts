/**
 * v3.5 unit tests: silent-corruption terminal rule (closed form vs brute force and vs the ledger simulation), configurable
 * rung order, Student-t / Wilson statistics, loss budget, planner checkpoint bounds, incident-rate estimation.
 */
import { describe, it, expect } from 'vitest';
import { EXAMPLES, evaluateScenario, sdcDelivery, simulateScenarioLedger, lossBudget, planToTarget, chainOutcome, checkpointBounds, rateFromCounts, unitRateFromCounts, summaryStat, proportionEstimate, proportionVerdict, cloneScenario, DEFAULT_CHAIN, parseScenario } from '../src/index.js';
import { Rng } from '../src/math/rng.js';

/** brute force of the discard-all rule: Exp(ν) clean periods, deterministic episodes of length c; delivered = g·clean − U·N when the window ends clean, else 0 */
function bruteForceDiscardAll(T: number, nu: number, c: number, g: number, U: number, trials: number, seed = 11): { mean: number; se: number; pUnresolved: number } {
  const rng = new Rng(`discard-${seed}`);
  let sum = 0;
  let sumSq = 0;
  let unresolved = 0;
  for (let i = 0; i < trials; i++) {
    let t = 0;
    let clean = 0;
    let n = 0;
    let delivered = 0;
    for (;;) {
      const x = rng.exponential(nu);
      if (t + x >= T) {
        clean += T - t;
        delivered = Math.max(0, g * clean - U * n) / T;
        break;
      }
      clean += x;
      n++;
      t += x + c;
      if (t > T) {
        unresolved++;
        delivered = 0;
        break;
      }
    }
    sum += delivered;
    sumSq += delivered * delivered;
  }
  const mean = sum / trials;
  const sd = Math.sqrt(Math.max(0, sumSq / trials - mean * mean));
  return { mean, se: sd / Math.sqrt(trials), pUnresolved: unresolved / trials };
}

describe('v3.5 silent-corruption terminal rule', () => {
  it('discard-all closed form matches a brute-force simulation; retain-last-clean is unchanged', () => {
    for (const [nu, D, Rc] of [[4.647e-3, 119.93, 0.07], [0.02, 23.5, 0.5], [1e-3, 119.93, 0.07]] as const) {
      const retained = sdcDelivery({ horizonH: 720, nuPerWallHour: nu, fallbackDelayH: D, episodePauseH: Rc, cleanGoodput: 0.9, preEpisodeLossH: 0.04 });
      const discard = sdcDelivery({ horizonH: 720, nuPerWallHour: nu, fallbackDelayH: D, episodePauseH: Rc, cleanGoodput: 0.9, preEpisodeLossH: 0.04, terminalRule: 'discard-all' });
      expect(retained.terminalRule).toBe('retain-last-clean');
      expect(retained.delivered).toBe(retained.deliveredRetained);
      expect(discard.delivered).toBe(discard.deliveredDiscardAll);
      expect(discard.deliveredRetained).toBeCloseTo(retained.delivered, 12);
      expect(discard.delivered).toBeLessThanOrEqual(retained.delivered + 1e-12);
      const bf = bruteForceDiscardAll(720, nu, D + Rc, 0.9, 0.04, 60000);
      expect(Math.abs(discard.delivered - bf.mean), `ν=${nu}: closed ${discard.delivered} vs brute ${bf.mean} ± ${bf.se}`).toBeLessThan(4 * bf.se + 1e-4);
      expect(Math.abs(discard.pUnresolvedAtEnd - bf.pUnresolved)).toBeLessThan(0.01);
      // the ledger still closes: delivered + rollback + terminal = g·(1 − pause) under either rule
      expect(discard.delivered + discard.rollbackFraction + discard.terminalDiscardFraction).toBeCloseTo(0.9 * (1 - discard.pauseFraction), 9);
      expect(discard.terminalDiscardFraction).toBeGreaterThanOrEqual(retained.terminalDiscardFraction - 1e-12);
    }
  });

  it('P(unresolved at end) agrees with the Poisson-count identity and vanishes without corruption', () => {
    const d = sdcDelivery({ horizonH: 720, nuPerWallHour: 0.01, fallbackDelayH: 50, episodePauseH: 1, cleanGoodput: 0.9, preEpisodeLossH: 0.04, terminalRule: 'discard-all' });
    expect(d.pUnresolvedAtEnd).toBeGreaterThan(d.pDirtyAtEnd - 1e-12); // the recovery pause counts as unresolved
    expect(d.pUnresolvedAtEnd).toBeLessThan(1);
    const none = sdcDelivery({ horizonH: 720, nuPerWallHour: 0, fallbackDelayH: 50, episodePauseH: 1, cleanGoodput: 0.9, preEpisodeLossH: 0.04, terminalRule: 'discard-all' });
    expect(none.delivered).toBe(0.9);
    expect(none.pUnresolvedAtEnd).toBe(0);
  });

  it('the scenario rule flows into the evaluation and the ledger simulation, which agree', () => {
    const s = EXAMPLES['ref-three-classes-100k']();
    const base = evaluateScenario(s).training!;
    expect(base.sdc!.terminalRule).toBe('retain-last-clean');
    expect(base.deliveredGoodput).toBeCloseTo(0.6261, 2);
    const d = cloneScenario(s);
    d.sdc = { ...d.sdc, terminalRule: 'discard-all' };
    const tr = evaluateScenario(d).training!;
    expect(tr.sdc!.terminalRule).toBe('discard-all');
    expect(tr.deliveredGoodput).toBeLessThan(base.deliveredGoodput);
    expect(tr.sdc!.delivery.deliveredRetained).toBeCloseTo(base.deliveredGoodput, 9);
    const l = tr.ledger;
    expect(l.downtime + l.save + l.rollback + l.slowdown + l.local + l.blocked + l.overhead + l.sdcRollback + l.terminal + l.delivered).toBeCloseTo(1, 9);
    const sim = simulateScenarioLedger(d, { trials: 300, seed: 5 });
    expect(Math.abs(sim.summary.delivered.mean - tr.deliveredGoodput), `sim ${sim.summary.delivered.mean} ± ${sim.summary.delivered.ci95} vs closed ${tr.deliveredGoodput}`).toBeLessThan(3 * sim.summary.delivered.ci95 + 0.01);
    expect(Math.abs(sim.summary.pUnresolvedAtEnd - tr.sdc!.delivery.pUnresolvedAtEnd)).toBeLessThan(0.1);
    // every unresolved window delivered nothing
    for (const v of sim.summary.values) expect(v).toBeGreaterThanOrEqual(0);
    expect(sim.summary.values.filter((v) => v === 0).length / sim.summary.values.length).toBeCloseTo(sim.summary.pUnresolvedAtEnd, 6);
    expect(sim.summary.delivered.ciMethod).toBe('student-t');
    expect(sim.summary.pAtLeastTargetInterval).toBeDefined();
  });
});

describe('v3.5 rung order', () => {
  it('a configurable order changes which rung handles the event; unknown names and duplicates are ignored', () => {
    const app = { replay: 1, process: 1 };
    const def = chainOutcome(12.5, 252, DEFAULT_CHAIN, app);
    expect(def.pReplay).toBeCloseTo(0.9, 12);
    expect(def.pProcess).toBeCloseTo(0.1 * 0.95, 12);
    const first = chainOutcome(12.5, 252, DEFAULT_CHAIN, app, ['process', 'replay']);
    expect(first.pProcess).toBeCloseTo(0.95, 12);
    expect(first.pReplay).toBeCloseTo(0.05 * 0.9, 12);
    expect(first.pRollback).toBeGreaterThan(def.pRollback);
    const same = chainOutcome(12.5, 252, DEFAULT_CHAIN, app, ['replay', 'bogus', 'replay']);
    expect(same.meanPauseS).toBeCloseTo(def.meanPauseS, 12);
  });

  it('the ledger simulation follows the scenario order', () => {
    const s = EXAMPLES['ref-three-classes-100k']();
    const on = parseScenario({ ...s, mechanisms: { ...s.mechanisms, replay: DEFAULT_CHAIN.replay, process: DEFAULT_CHAIN.process }, components: s.components.map((c) => ({ ...c, mechanisms: { ...(c.mechanisms ?? {}), replay: 1, process: 1 } })) });
    const a = simulateScenarioLedger(on, { trials: 20, seed: 2 }).summary.counts;
    const b = simulateScenarioLedger(parseScenario({ ...on, mechanisms: { ...on.mechanisms, order: ['process', 'replay'] } }), { trials: 20, seed: 2 }).summary.counts;
    expect(a.replay).toBeGreaterThan(a.process);
    expect(b.process).toBeGreaterThan(b.replay);
  });
});

describe('v3.5 statistics', () => {
  it('summary statistics use Student-t half-widths and type-7 quantiles', () => {
    const st = summaryStat([1, 2, 3, 4, 5]);
    expect(st.mean).toBe(3);
    expect(st.sd).toBeCloseTo(Math.sqrt(2.5), 12);
    expect(st.ci95).toBeCloseTo((2.776445105 * Math.sqrt(2.5)) / Math.sqrt(5), 6);
    expect(st.p05).toBeCloseTo(1.2, 12);
    expect(st.p50).toBe(3);
    expect(st.ciMethod).toBe('student-t');
  });
  it('Wilson verdicts', () => {
    const est = proportionEstimate(173, 200);
    expect(est.p).toBeCloseTo(0.865, 12);
    expect(est.low).toBeLessThan(0.865);
    expect(est.high).toBeGreaterThan(0.865);
    expect(proportionVerdict(est, 0.8)).toBe('supported');
    expect(proportionVerdict(est, 0.92)).toBe('below');
    expect(proportionVerdict(est, 0.9)).toBe('uncertain');
  });
});

describe('v3.5 loss budget', () => {
  const ledger = { downtime: 0.02, save: 0.013, rollback: 0.03, slowdown: 0.004, local: 0, blocked: 0, overhead: 0, sdcRollback: 0.2, terminal: 0.1, delivered: 0.633 };
  it('splits (1 − target) over the lines and reports excess per line', () => {
    const b = lossBudget(ledger, 0.9, 720);
    expect(b.method).toBe('proportional');
    expect(b.totalAllowed).toBeCloseTo(0.1, 12);
    expect(b.totalAllowedHours).toBeCloseTo(72, 9);
    expect(b.rows.reduce((a, r) => a + r.allowed, 0)).toBeCloseTo(0.1, 12);
    expect(b.rows.reduce((a, r) => a + r.excess, 0)).toBeCloseTo(b.totalCurrent - 0.1, 12);
    expect(b.rows.find((r) => r.line === 'sdcRollback')!.weight).toBeCloseTo(0.2 / 0.367, 9);
    const eq = lossBudget(ledger, 0.9, 720, { method: 'equal' });
    expect(eq.rows.filter((r) => r.weight > 0).length).toBe(6);
    expect(eq.rows.find((r) => r.line === 'local')!.weight).toBe(0);
    const custom = lossBudget(ledger, 0.9, 720, { method: 'custom', weights: { downtime: 0.25, save: 0.2, rollback: 0.35, terminal: 0.1, slowdown: 0.05, local: 0.05 } });
    expect(custom.rows.find((r) => r.line === 'rollback')!.allowedHours).toBeCloseTo(72 * 0.35, 9);
    const bad = lossBudget(ledger, 0.9, 720, { method: 'custom', weights: {} });
    expect(bad.method).toBe('proportional');
  });
  it('is attached to the allocation on the delivered basis', async () => {
    const { allocateScenario } = await import('../src/scenario/analysis.js');
    const a = allocateScenario(EXAMPLES['ref-three-classes-100k'](), { goodputTarget: 0.9, basis: 'delivered' });
    expect(a.lossBudget).toBeDefined();
    expect(a.lossBudget!.totalCurrent).toBeGreaterThan(a.lossBudget!.totalAllowed);
    const eff = allocateScenario(EXAMPLES['ref-three-classes-100k'](), { goodputTarget: 0.9, basis: 'effective' });
    expect(eff.lossBudget).toBeUndefined();
  });
});

describe('v3.5 planner checkpoint bounds', () => {
  it('finite-window and duty-cycle bounds', () => {
    const b = checkpointBounds(300, 4, 720);
    expect(b.dutyCycle).toBeCloseTo(300 / 304, 12);
    expect(b.finiteWindow).toBeGreaterThanOrEqual(b.dutyCycle);
    expect(b.finiteWindow).toBeCloseTo((Math.floor((720 * 3600) / 304) * 300 + Math.min((720 * 3600) % 304, 300)) / (720 * 3600), 12);
    expect(checkpointBounds(300, 4, 1 / 3600).finiteWindow).toBe(1);
  });
  it('a target above the no-fault bound is proven infeasible; a reachable target is not', () => {
    const s = EXAMPLES['ref-three-classes-100k']();
    const slow = cloneScenario(s);
    slow.workload = { ...slow.workload, deltaS: 40, intervalS: 300 } as typeof slow.workload;
    const p = planToTarget(slow, { target: 0.9, players: ['D-SDC', 'R-SDC', 'R-REPLAY'], scan: false });
    expect(p.bounds.provenInfeasible).toBe(true);
    expect(p.bounds.dutyCycle).toBeCloseTo(300 / 340, 9);
    expect(p.plan).toBeUndefined();
    expect(p.notes.some((n) => n.startsWith('proven infeasible'))).toBe(true);
    const ok = planToTarget(s, { target: 0.9, players: ['D-SDC', 'R-SDC', 'R-REPLAY'], scan: false, verify: { trials: 40, confidence: 0.5 } });
    expect(ok.bounds.provenInfeasible).toBe(false);
    expect(ok.bounds.finiteWindow).toBeGreaterThan(0.98);
    expect(ok.verification).toBeDefined();
    expect(ok.verification!.pLow).toBeLessThanOrEqual(ok.verification!.pAtLeastTarget);
    expect(ok.verification!.pHigh).toBeGreaterThanOrEqual(ok.verification!.pAtLeastTarget);
    expect(['supported', 'uncertain', 'below']).toContain(ok.verification!.verdict);
    for (const c of ok.coalitions) expect(c.value).toBeLessThanOrEqual(c.bound + 1e-9);
  });
});

describe('v3.5 incident-rate estimation', () => {
  it('zero events give the one-sided bound −ln(1 − c)/E, two events in a million hours 2000 FIT', () => {
    const z = rateFromCounts(0, 1e6, 0.95);
    expect(z.method).toBe('zero-event-upper-bound');
    expect(z.fit).toBe(0);
    expect(z.upper.fit).toBeCloseTo(2995.73227355, 6);
    expect(z.upper.ratePerHour).toBeCloseTo(-Math.log(0.05) / 1e6, 15);
    const two = rateFromCounts(2, 1e6, 0.95);
    expect(two.method).toBe('garwood-exact');
    expect(two.fit).toBeCloseTo(2000, 9);
    expect(two.lower.fit).toBeLessThan(2000);
    expect(two.upper.fit).toBeGreaterThan(2000);
    expect(two.mtbfHours).toBeCloseTo(5e5, 6);
    const u = unitRateFromCounts(3, 1000, 720, 0.9);
    expect(u.exposureHours).toBe(720000);
    expect(u.ratePerHour).toBeCloseTo(3 / 720000, 15);
    expect(() => rateFromCounts(1.5, 100)).toThrow();
    expect(() => rateFromCounts(1, 0)).toThrow();
  });
});
