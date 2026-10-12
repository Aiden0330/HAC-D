/**
 * Regression tests for the second model review (2026-10-12, v3.2 code):
 *  1. scale-table rows carry the fault-free overhead factor;
 *  2. library transforms are exact inverses under strip (applied records) and never compound on re-application;
 *  3. prediction applies only where a class declares a predict flag;
 *  4. the predictor's false alarms leave the ledger simulation's fault history untouched (common random numbers);
 *  5. C-MEM shortens the checkpoint-load stage of pipeline recoveries;
 *  6. AGREE's infeasibility message points at the importance weight.
 */
import { describe, it, expect } from 'vitest';
import { chainOutcome, DEFAULT_CHAIN } from '../src/mechanisms/chain.js';
import { agree } from '../src/allocation/index.js';
import {
  evaluateScenario, parseScenario, referenceThreeClasses, referenceBaseline, EXAMPLES, applyMechanisms, stripMechanisms, mechanismReport,
  activeMechanisms, isStrippable, ledgerSpecFromScenario, simulateLedgerReplications, type Scenario,
} from '../src/index.js';

const relClose = (a: number, b: number, rel = 1e-14) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1e-300, Math.abs(b)));

describe('fix 1: scale rows carry the overhead factor', () => {
  it('a row with D-SDC-DMR equals a direct evaluation at that size', () => {
    const t = evaluateScenario(applyMechanisms(referenceThreeClasses(100000), ['D-SDC-DMR'])).training!;
    expect(t.overheadFraction).toBeCloseTo(0.08, 12);
    for (const n of [8192, 262144]) {
      const row = t.scale.find((r) => r.nGpus === n)!;
      const d = evaluateScenario(applyMechanisms(referenceThreeClasses(n), ['D-SDC-DMR'])).training!;
      expect(row.effective!, `${n} effective`).toBeCloseTo(d.effectiveGoodput, 9);
      expect(row.delivered!, `${n} delivered`).toBeCloseTo(d.deliveredGoodput, 9);
    }
  });
});

describe('fix 2: applied records make remove the exact inverse of apply', () => {
  const s = referenceThreeClasses(100000);
  const auto = (x: Scenario) => (x.recovery.mode === 'mixture' ? x.recovery.automatic.seconds : NaN);
  const interval = (x: Scenario) => (x.workload.type === 'training' ? x.workload.intervalS : NaN);
  it('C-MEM: strip restores interval, save time and recovery; re-apply replaces instead of compounding', () => {
    const once = applyMechanisms(s, ['C-MEM']);
    expect(auto(once)).toBe(120);
    expect(once.mechanisms.applied!['C-MEM'].parameters.loadSavingSeconds).toBe(60);
    const twice = applyMechanisms(once, ['C-MEM']);
    expect(auto(twice)).toBe(120);
    const back = stripMechanisms(twice, ['C-MEM']);
    expect(auto(back)).toBe(180);
    expect(interval(back)).toBe(300);
    expect(back.workload.type === 'training' && back.workload.deltaS).toBe(4);
    expect(back.mechanisms.overheads).toBeUndefined();
    expect(back.mechanisms.applied).toBeUndefined();
    expect(evaluateScenario(back).training!.deliveredGoodput).toBeCloseTo(evaluateScenario(s).training!.deliveredGoodput, 12);
  });
  it('H-LEMON, H-SWEEP, D-SDC-DMR and C-FAST are undone exactly whatever the order of application; removing one keeps the others', () => {
    const all = applyMechanisms(applyMechanisms(s, ['H-SWEEP', 'D-SDC-DMR']), ['H-LEMON', 'C-FAST']);
    expect(activeMechanisms(all)).toEqual(expect.arrayContaining(['H-LEMON', 'H-SWEEP', 'D-SDC-DMR', 'C-FAST']));
    const back = stripMechanisms(all, ['H-LEMON', 'H-SWEEP', 'D-SDC-DMR', 'C-FAST']);
    s.components.forEach((c, i) => {
      relClose(back.components[i].failure.value, c.failure.value);
      if (c.subhealth) {
        relClose(back.components[i].subhealth!.ratePerHour!, c.subhealth.ratePerHour!);
        expect(back.components[i].subhealth!.durationHours).toBe(c.subhealth.durationHours);
      }
    });
    expect(back.sdc.detection.coverage).toBe(0);
    expect(interval(back)).toBe(300);
    expect(back.mechanisms.applied).toBeUndefined();
    const noLemon = stripMechanisms(all, ['H-LEMON']);
    relClose(noLemon.components[0].failure.value, s.components[0].failure.value);
    expect(noLemon.sdc.detection.coverage).toBeCloseTo(0.999, 12);
    expect(noLemon.mechanisms.overheads!['D-SDC-DMR']).toBe(0.08);
    expect(interval(noLemon)).toBe(60);
    expect(Object.keys(noLemon.mechanisms.applied!).sort()).toEqual(['C-FAST', 'D-SDC-DMR', 'H-SWEEP']);
  });
  it('the attribution baseline of a scenario that already carries C-MEM equals the plain baseline', () => {
    const plain = mechanismReport(s, ['C-MEM', 'R-REPLAY'], { metric: 'aOp' });
    const applied = mechanismReport(applyMechanisms(s, ['C-MEM']), ['C-MEM', 'R-REPLAY'], { metric: 'aOp' });
    expect(applied.baseline.aOp).toBeCloseTo(plain.baseline.aOp, 12);
    expect(applied.gains[0].single).toBeCloseTo(plain.gains[0].single, 12);
    expect(applied.notes.some((n) => n.includes('restored exactly'))).toBe(true);
    expect(isStrippable(applyMechanisms(s, ['H-LEMON']), 'H-LEMON')).toBe(true);
    expect(isStrippable(s, 'H-LEMON')).toBe(false);
    expect(isStrippable(s, 'R-REPLAY')).toBe(true);
  });
});

describe('fix 3: prediction needs a declared applicability', () => {
  it('does nothing on a scenario without predict flags, and in the chain without the flag', () => {
    const s = EXAMPLES['ascend-cm384']();
    const base = evaluateScenario(s).training!;
    const pred = evaluateScenario(applyMechanisms(s, ['P-PREDICT'])).training!;
    expect(pred.operationalAvailability).toBeCloseTo(base.operationalAvailability, 12);
    expect(pred.pRollback).toBeCloseTo(base.pRollback, 12);
    expect(pred.falseAlarmRatePerHour).toBe(0);
    const o = chainOutcome(12.5, 252, DEFAULT_CHAIN, { replay: 1, elastic: 1, process: 1 });
    expect(o.pPredict).toBe(0);
    expect(o.pNetfail).toBe(0);
    expect(o.pHotswap).toBe(0);
  });
});

describe('fix 4: false alarms do not touch the fault history of the ledger simulation', () => {
  it('fault counts per replication agree with and without the predictor up to the window end', () => {
    const s = referenceThreeClasses(100000);
    const a = ledgerSpecFromScenario(s);
    const b = ledgerSpecFromScenario(applyMechanisms(s, ['P-PREDICT']));
    const n = 20;
    let sumAbs = 0;
    let alarms = 0;
    for (let i = 0; i < n; i++) {
      const ra = simulateLedgerReplications(a, i, 1, 5)[0];
      const rb = simulateLedgerReplications(b, i, 1, 5)[0];
      sumAbs += Math.abs(ra.counts.hard + ra.counts.slow + ra.counts.sdc - (rb.counts.hard + rb.counts.slow + rb.counts.sdc));
      alarms += rb.counts.falseAlarms;
    }
    expect(alarms).toBeGreaterThan(0);
    expect(sumAbs / n).toBeLessThan(2); // independent arrival streams would differ by about √(2 × 250) ≈ 22 events per window
  });
});

describe('fix 5: C-MEM shortens the checkpoint-load stage of a pipeline recovery', () => {
  it('resolves the preset, cuts the load stage by the saving, and strip restores the preset', () => {
    const s = parseScenario({ ...referenceBaseline(100000), recovery: { mode: 'preset', preset: 'baseline-timeout-manual' } });
    const mem = applyMechanisms(s, ['C-MEM']);
    expect(mem.recovery.mode).toBe('pipeline');
    const load = mem.recovery.mode === 'pipeline' ? mem.recovery.stages.find((st) => st.name === 'load') : undefined;
    expect(load && typeof load.value === 'number' ? load.value : NaN).toBeCloseTo(1.56 * 60 - 60, 9);
    expect(evaluateScenario(mem).training!.recoveryS).toBeCloseTo(evaluateScenario(s).training!.recoveryS - 60, 6);
    expect(stripMechanisms(mem, ['C-MEM']).recovery).toEqual(s.recovery);
  });
});

describe('fix 6: AGREE infeasibility message', () => {
  it('tells the user to raise the importance weight', () => {
    expect(() => agree([{ id: 'a', count: 1, importance: 0.01 }, { id: 'b', count: 1 }], 0.1, 24)).toThrow(/raise its importance/);
  });
});
