/** v3.2 library entries: prediction, network failover, hot-swap, in-memory checkpoints, DMR, lemon eviction, sweeps; overhead factor; per-metric Shapley. */
import { describe, it, expect } from 'vitest';
import { chainOutcome, DEFAULT_CHAIN } from '../src/mechanisms/chain.js';
import { referenceCatalog, referenceThreeClasses, evaluateScenario, applyMechanisms, stripMechanisms, activeMechanisms, mechanismReport, simulateScenarioLedger, derateParameters, DERATE_DEFAULT } from '../src/index.js';

describe('v3.2 chain rungs', () => {
  it('prediction and network failover come before detection; hot-swap after replay; probabilities sum to one', () => {
    const o = chainOutcome(12.5, 252, DEFAULT_CHAIN, { predict: 1, netfail: 1, replay: 1, hotswap: 1, elastic: 1, process: 1 });
    expect(o.pPredict + o.pNetfail + o.pReplay + o.pHotswap + o.pElastic + o.pProcess + o.pGlobal).toBeCloseTo(1, 12);
    expect(o.pPredict).toBeCloseTo(0.5, 12);
    expect(o.pNetfail).toBeCloseTo(0.5 * 0.95, 12);
    // predicted and failover paths carry no detection delay
    const pred = o.paths.find((p) => p.kind === 'predict')!;
    expect(pred.pauseS).toBe(180);
    expect(pred.rollback).toBe(false);
    const nf = o.paths.find((p) => p.kind === 'netfail')!;
    expect(nf.pauseS).toBe(2);
    const hs = o.paths.filter((p) => p.kind === 'hotswap');
    expect(hs.every((p) => !p.rollback && p.pauseS >= 12.5 + 180)).toBe(true);
    expect(o.pRollback).toBeLessThan(0.01);
  });
});

describe('v3.2 library mechanisms on the reference catalog', () => {
  const s = referenceCatalog(100000);
  const base = evaluateScenario(s).training!;
  it('prediction converts interruptions into planned migrations and charges false alarms', () => {
    const t = evaluateScenario(applyMechanisms(s, ['P-PREDICT'])).training!;
    expect(t.chain.active).toBe(true);
    expect(t.falseAlarmRatePerHour).toBeGreaterThan(0);
    expect(t.pRollback).toBeLessThan(base.pRollback);
    expect(t.operationalAvailability).toBeGreaterThan(base.operationalAvailability);
    // worthless predictor (precision → tiny) costs availability through false alarms
    const bad = evaluateScenario(applyMechanisms(s, ['P-PREDICT'], { 'P-PREDICT': { recall: 0.5, precision: 0.05, migrationSeconds: 180 } })).training!;
    expect(bad.operationalAvailability).toBeLessThan(base.operationalAvailability);
  });
  it('network failover acts only on network-class events; hot-swap on card / server events', () => {
    const nf = evaluateScenario(applyMechanisms(s, ['R-NETFAIL'])).training!;
    const rows = nf.chain.rows;
    expect(rows.filter((r) => r.pNetfail > 0).every((r) => /^(NIC|OPT|BOXIO|FABRIC)-/.test(r.id))).toBe(true);
    expect(nf.operationalAvailability).toBeGreaterThan(base.operationalAvailability);
    const hs = evaluateScenario(applyMechanisms(s, ['R-HOTSWAP'])).training!;
    expect(hs.chain.rows.some((r) => r.pHotswap > 0)).toBe(true);
    expect(hs.operationalAvailability).toBeGreaterThan(nf.operationalAvailability);
  });
  it('overhead lowers effective and delivered goodput but not A_op, and the ledger closes', () => {
    const dmr = evaluateScenario(applyMechanisms(s, ['D-SDC-DMR'])).training!;
    expect(dmr.overheadFraction).toBeCloseTo(0.08, 12);
    expect(dmr.sdc!.coverage).toBeCloseTo(0.999, 12);
    expect(dmr.effectiveGoodput).toBeLessThan(base.effectiveGoodput);
    expect(dmr.deliveredGoodput).toBeGreaterThan(base.deliveredGoodput); // detection outweighs the 8 % cost at 100k cards
    expect(Math.abs(dmr.operationalAvailability - base.operationalAvailability)).toBeLessThan(0.002);
    const l = dmr.ledger;
    expect(l.overhead).toBeGreaterThan(0.07);
    expect(l.downtime + l.save + l.rollback + l.slowdown + l.local + l.blocked + l.overhead + l.sdcRollback + l.terminal + l.delivered).toBeCloseTo(1, 9);
    const mem = applyMechanisms(s, ['C-MEM']);
    expect(mem.workload.type === 'training' && mem.workload.deltaS).toBe(0.5);
    expect(mem.recovery.mode === 'mixture' && mem.recovery.automatic.seconds).toBe(120);
    expect(mem.mechanisms.overheads!['C-MEM']).toBe(0.01);
  });
  it('lemon eviction and sweeps scale rates; strip and active round-trip; overhead keys are stripped', () => {
    const lemon = applyMechanisms(s, ['H-LEMON']);
    expect(lemon.components[0].failure.value).toBeCloseTo(s.components[0].failure.value * 0.93, 15);
    const sweep = applyMechanisms(s, ['H-SWEEP']);
    const sh = sweep.components.find((c) => c.subhealth)!.subhealth!;
    expect(sh.durationHours).toBe(12);
    const all = applyMechanisms(s, ['P-PREDICT', 'R-NETFAIL', 'R-HOTSWAP', 'C-MEM', 'D-SDC-DMR']);
    expect(activeMechanisms(all)).toEqual(expect.arrayContaining(['P-PREDICT', 'R-NETFAIL', 'R-HOTSWAP', 'C-MEM', 'D-SDC-DMR']));
    const stripped = stripMechanisms(all, ['P-PREDICT', 'R-NETFAIL', 'R-HOTSWAP', 'C-MEM', 'D-SDC-DMR']);
    expect(stripped.mechanisms.predict).toBeUndefined();
    expect(Object.keys(stripped.mechanisms.overheads ?? {})).toHaveLength(0);
  });
  it('the report carries Shapley values for A_op and delivered side by side, each summing to its combined gain', () => {
    const rep = mechanismReport(s, ['R-REPLAY', 'R-HOTSWAP', 'P-PREDICT', 'D-SDC-DMR'], { metric: 'delivered' });
    for (const m of ['aOp', 'delivered', 'effective'] as const) {
      const sum = rep.gains.reduce((a, g) => a + g.byMetric[m].shapley, 0);
      expect(sum).toBeCloseTo(rep.combined[m] - rep.baseline[m], 10);
    }
    expect(rep.gains.find((g) => g.id === 'D-SDC-DMR')!.byMetric.aOp.shapley).toBeLessThan(0.001);
    expect(rep.gains.find((g) => g.id === 'D-SDC-DMR')!.byMetric.delivered.shapley).toBeGreaterThan(0.2);
  });
  it('the ledger simulation handles the new rungs, false alarms and overhead and conserves time', () => {
    const planned = applyMechanisms(referenceThreeClasses(100000), ['P-PREDICT', 'R-NETFAIL', 'R-HOTSWAP', 'D-SDC-DMR']);
    const mc = simulateScenarioLedger(planned, { trials: 120, seed: 9 });
    expect(mc.summary.counts.predicted).toBeGreaterThan(0);
    expect(mc.summary.counts.falseAlarms).toBeGreaterThan(0);
    expect(mc.summary.counts.hotswap + mc.summary.counts.netfail).toBeGreaterThan(0);
    expect(mc.summary.ledger.overhead).toBeGreaterThan(0.05);
    expect(Math.abs(mc.summary.delivered.mean - mc.closedForm.delivered)).toBeLessThan(3 * mc.summary.delivered.ci95 + 0.01);
  });
  it('derating worsens overhead, recall and precision', () => {
    const d = derateParameters({ overhead: 0.08, recall: 0.5, precision: 0.8, rateFactor: 0.5 }, DERATE_DEFAULT);
    expect(d.overhead).toBeCloseTo(0.12, 12);
    expect(d.recall).toBeCloseTo(0.42, 12);
    expect(d.precision).toBeCloseTo(0.72, 12);
    expect(d.rateFactor).toBeCloseTo(0.55, 12);
  });
});
