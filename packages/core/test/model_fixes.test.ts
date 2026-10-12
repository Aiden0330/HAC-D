/**
 * Regression tests for the model-review fixes of 2026-10-11:
 *  1. the scale table re-evaluates R(N) from the recovery scale laws, the chain and the straggler law per row;
 *  2. the MTTF from new of a sub-health leaf is the first passage from U into the down set;
 *  3. the Monte Carlo commits a checkpoint only when its save completes;
 *  4. the standby chain has no switch-failed state when no standby is left;
 *  5. the silent-corruption stationary fallback ledger closes.
 */
import { describe, it, expect } from 'vitest';
import { Ctmc, standby, type CtmcState, type Transition } from '../src/ctmc/index.js';
import { evaluate } from '../src/rbd/index.js';
import { simulateJob, type McJobSpec } from '../src/mc/index.js';
import { exponentialFromMean } from '../src/math/distributions.js';
import { renewalGoodput } from '../src/checkpoint/index.js';
import { sdcDelivery } from '../src/sdc/index.js';
import { evaluateScenario, parseScenario, referenceBaseline, referenceThreeClasses } from '../src/scenario/index.js';
import { resolveRecovery } from '../src/scenario/evaluate.js';

describe('fix 1: scale table rows follow the recovery scale laws and the straggler law', () => {
  it('hard-only rows use R(N) from the pipeline preset even with a fixed interval', () => {
    const s = parseScenario({ ...referenceBaseline(100000), recovery: { mode: 'preset', preset: 'baseline-timeout-manual' } });
    const t = evaluateScenario(s).training!;
    const model = resolveRecovery(s);
    const seen = new Set<number>();
    for (const row of t.scale) {
      // no chain: the rate-weighted pause of the row is the pipeline's R(N); restartRatio = R̄/M_ev and M_ev = the row's MTBI
      const R = row.goodput.restartRatio * row.mtbiS;
      expect(R, `N = ${row.nGpus}`).toBeCloseTo(model.meanS(row.nGpus), 6);
      seen.add(Math.round(R));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
  it('with replay on, the rate-weighted pause per row still grows with N as the restart stage does', () => {
    const s = parseScenario({ ...referenceBaseline(100000), recovery: { mode: 'preset', preset: 'baseline-timeout-manual' }, mechanisms: { replay: { success: 0.9, successSeconds: 5, failureSeconds: 10 } } });
    const t = evaluateScenario(s).training!;
    expect(t.chain.active).toBe(true);
    const pauses = t.scale.map((row) => row.goodput.restartRatio * row.mtbiS);
    for (let i = 1; i < pauses.length; i++) expect(pauses[i]).toBeGreaterThan(pauses[i - 1]);
  });
  it('a row of the three-class reference equals a direct evaluation at that size', () => {
    const t = evaluateScenario(referenceThreeClasses(100000)).training!;
    for (const n of [8192, 262144, 1000000]) {
      const row = t.scale.find((r) => r.nGpus === n)!;
      const direct = evaluateScenario(referenceThreeClasses(n)).training!;
      expect(row.headline, `${n} headline`).toBeCloseTo(direct.headlineGoodput, 9);
      expect(row.effective!, `${n} effective`).toBeCloseTo(direct.effectiveGoodput, 9);
      expect(row.delivered!, `${n} delivered`).toBeCloseTo(direct.deliveredGoodput, 9);
    }
  });
});

describe('fix 2: MTTF from new of a sub-health leaf', () => {
  const sh = { ratePerHour: 2e-3, durationH: 4, performance: 0.9, escalationMultiplier: 3, policy: 'isolate' as const, detection: { probability: 0.9, delayH: 0.1 }, threshold: 0.7 };
  it('is the first passage from U into the down set: shorter than 1/λ and equal to the mean up time of one unit', () => {
    const r = evaluate({ kind: 'leaf', id: 'x', lambda: 1e-3, mttr: 2, subhealth: sh });
    expect(r.mttfFromNew).toBeLessThan(1000);
    expect(r.mttfFromNew / r.mtbf).toBeCloseTo(1, 9); // every repair returns to U, so MTTF from new = A/ν
  });
  it('is 1/(λ + λ_sh) when sub-health counts as down, 1/λ for the v1 degraded alias, and MTTF/c for c units', () => {
    const down = evaluate({ kind: 'leaf', id: 'y', lambda: 1e-3, mttr: 2, subhealth: { ...sh, performance: 0.5 } });
    expect(down.mttfFromNew).toBeCloseTo(1 / 3e-3, 9);
    const v1 = evaluate({ kind: 'leaf', id: 'z', lambda: 1e-3, mttr: 2, degraded: { lambda: 2e-3, durationH: 4, capacity: 0.8 } });
    expect(v1.mttfFromNew).toBeCloseTo(1000, 6);
    const one = evaluate({ kind: 'leaf', id: 'x', lambda: 1e-3, mttr: 2, subhealth: sh });
    const three = evaluate({ kind: 'leaf', id: 'w', count: 3, lambda: 1e-3, mttr: 2, subhealth: sh });
    expect(three.mttfFromNew * 3).toBeCloseTo(one.mttfFromNew, 9);
  });
});

describe('fix 3: the Monte Carlo commits a checkpoint only when its save completes', () => {
  it('matches the exact renewal goodput for exponential failures when failures often hit the save', () => {
    const M = 3600;
    const tau = 300;
    const delta = 60; // one failure in six lands in the save
    const spec: McJobSpec = {
      nGpus: 1, gpusPerNode: 1, nodesPerRack: 1, racksPerZone: 1, workHours: 2000, intervalS: tau, deltaS: delta,
      recoverySampler: () => 0,
      spares: { policy: 'cluster-requeue', hotSpareNodes: 0, replenish: exponentialFromMean(1) },
      classes: [{ id: 'u', count: 1, lifetime: exponentialFromMean(M / 3600), repair: exponentialFromMean(1e-6), scope: 'fixed' }],
      recovery: 'checkpoint',
    };
    const mc = simulateJob(spec, 30, 3);
    const ren = renewalGoodput(tau, delta, M, 0);
    expect(Math.abs(mc.goodput.mean - ren)).toBeLessThan(2 * mc.goodput.ci95 + 0.002); // before the fix the gap was 0.013
    expect(mc.rows[0].checkpointOverheadHours).toBeGreaterThan(0);
  });
});

describe('fix 4: a standby group has no switch to fail when no standby is left', () => {
  it('n = 1 is a two-state unit for any p_sw; n = 2 matches the explicit four-state chain', () => {
    const lam = 1e-2;
    const mu = 0.5;
    const p = 0.9;
    const Tsf = 4;
    const one = standby(1, lam, mu, 0, 0.5, Infinity, 1 / Tsf);
    expect(one.availability).toBeCloseTo(1 / (1 + lam / mu), 12);
    expect(one.switchFailedProbability).toBe(0);
    expect(one.switchFrequency).toBe(0);
    // states 0, 1 (failed units, up), 2 (all failed), SW_0 (switch failed while a standby existed)
    const states: CtmcState[] = [{ id: '0', up: true, capacity: 1 }, { id: '1', up: true, capacity: 1 }, { id: '2', up: false, capacity: 0 }, { id: 'sw0', up: false, capacity: 0 }];
    const tr: Transition[] = [
      { from: 0, to: 1, rate: lam * p }, { from: 0, to: 3, rate: lam * (1 - p) }, { from: 3, to: 1, rate: 1 / Tsf },
      { from: 1, to: 2, rate: lam }, { from: 1, to: 0, rate: mu }, { from: 2, to: 1, rate: 2 * mu },
    ];
    const ch = new Ctmc(states, tr);
    const pi = ch.steadyState();
    const r = standby(2, lam, mu, 0, p, Infinity, 1 / Tsf);
    expect(r.availability).toBeCloseTo(ch.availability(pi), 12);
    expect(r.failureFrequency).toBeCloseTo(ch.failureFrequency(pi), 12);
    expect(r.switchFailedProbability).toBeCloseTo(pi[3], 12);
    expect(r.mttfFromNew).toBeCloseTo(ch.meanTimeToAbsorption(new Set([2, 3]), 0), 9);
  });
});

describe('fix 5: silent-corruption stationary fallback ledger closes', () => {
  it('delivered + rollback + terminal = g·(1 − pause)', () => {
    const d = sdcDelivery({ horizonH: 720, nuPerWallHour: 5, fallbackDelayH: 0.01, episodePauseH: 0.001, cleanGoodput: 0.9, preEpisodeLossH: 0.002 });
    expect(d.method).toBe('stationary');
    expect(d.delivered + d.rollbackFraction + d.terminalDiscardFraction).toBeCloseTo(0.9 * (1 - d.pauseFraction), 12);
  });
});
