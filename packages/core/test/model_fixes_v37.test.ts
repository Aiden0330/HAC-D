/**
 * Regression tests for the third model review (2026-10-15, v3.5–v3.7 code):
 *  1. derating reaches the audited mechanisms' parameter names;
 *  2. per-class silent-corruption detectors compound order-independently (D-SDC before or after D-ABFT);
 *  3. explicit recovery stages are rescaled to the attempt;
 *  4. the async-save lag applies to rollback events, not to fallback discoveries;
 *  5. the study decomposition carries false alarms and detected corruption as their own lines;
 *  6. a custom rung's local loss runs as a throughput factor over its duration in the ledger simulation.
 */
import { describe, it, expect } from 'vitest';
import { derateParameters, DERATE_DEFAULT } from '../src/mechanisms/plan.js';
import { AUDIT_MECHANISM_DEFS, provisionalParameters } from '../src/mechanisms/auditLibrary.js';
import { applyMechanisms, stripMechanisms } from '../src/mechanisms/index.js';
import { evaluateScenario, automaticStages } from '../src/scenario/evaluate.js';
import { computeCounts, componentInstances, classSdcCoverage } from '../src/scenario/build.js';
import { referenceCatalog } from '../src/scenario/examples.js';
import { decompose } from '../src/study/index.js';
import { ledgerSpecFromScenario } from '../src/mc/ledgerFromScenario.js';
import { runLedgerOnce, simulateLedgerReplications, type LedgerSpec } from '../src/mc/ledger.js';
import { Rng } from '../src/math/rng.js';
import { summaryStat } from '../src/math/stats.js';

describe('fix 1: derating reaches the audited parameters', () => {
  it('derates shares, detection targets, the manual-fallback probability, the compression ratio and the fabric exposure', () => {
    const d = derateParameters({ eligibleShare: 1, riskShare: 1 / 3, detectionTarget: 0.95, upstreamDetection: 0.95, conditionalMissDetection: 0.9, manualProbabilityTarget: 0.001, occurrenceReduction: 0.25, compressionRatio: 2, exposedCommunicationFraction: 0.3, remainingBandwidthRatio: 0.75, communicationBeforeSeconds: 60, communicationTargetSeconds: 15 }, DERATE_DEFAULT);
    expect(d.eligibleShare).toBeCloseTo(0.95, 12);
    expect(d.riskShare).toBeCloseTo(1 / 3 - 0.05, 12);
    expect(d.detectionTarget).toBeCloseTo(0.9, 12);
    expect(d.upstreamDetection).toBeCloseTo(0.9, 12);
    expect(d.conditionalMissDetection).toBeCloseTo(0.85, 12);
    expect(d.manualProbabilityTarget).toBeCloseTo(0.0015, 12);
    expect(d.occurrenceReduction).toBeCloseTo(0.125, 12);
    expect(d.compressionRatio).toBeCloseTo(1 + 1 / 1.5, 12);
    expect(d.exposedCommunicationFraction).toBeCloseTo(0.35, 12);
    expect(d.remainingBandwidthRatio).toBeCloseTo(0.7, 12);
    expect(d.communicationBeforeSeconds).toBe(60); // a reference value, not a capability
    expect(d.communicationTargetSeconds).toBeCloseTo(22.5, 12);
  });
  it('every audited mechanism with a transform has a derated parameter and never improves under derating', () => {
    const prov = provisionalParameters(AUDIT_MECHANISM_DEFS.map((m) => m.id));
    const base = applyMechanisms(referenceCatalog(100000), ['R-ELASTIC']); // R-HCCL-ELASTIC needs elasticity
    for (const m of AUDIT_MECHANISM_DEFS) {
      if (!m.apply) continue;
      const nominal = { ...m.parameters, ...(prov[m.id] ?? {}) };
      const derated = derateParameters(nominal, DERATE_DEFAULT);
      expect(Object.keys(nominal).some((k) => derated[k] !== nominal[k]), `${m.id} has no derated parameter`).toBe(true);
      const vn = evaluateScenario(applyMechanisms(base, [m.id], { [m.id]: nominal }), { structure: false }).training!;
      const vd = evaluateScenario(applyMechanisms(base, [m.id], { [m.id]: derated }), { structure: false }).training!;
      expect(vd.deliveredGoodput, `${m.id} derated delivered goodput`).toBeLessThanOrEqual(vn.deliveredGoodput + 1e-12);
      // A_op is blind to silent corruption: a derated detector catches fewer corruptions immediately (each an immediate pause of
      // t_d + G) and leaves more to rare late discovery, so A_op rises while the delivered goodput falls; likewise a longer
      // blocking save or durable lag (C-*) lengthens the recompute inside a corruption cycle, which is running time. The
      // delivered goodput is the monotone metric for those; A_op is checked for the hard-interruption mechanisms only.
      if (m.kind !== 'detect' && !m.id.startsWith('C-')) expect(vd.operationalAvailability, `${m.id} derated A_op`).toBeLessThanOrEqual(vn.operationalAvailability + 1e-12);
    }
  });
});

describe('fix 2: per-class detectors compound order-independently', () => {
  it('D-ABFT then D-SDC equals D-SDC then D-ABFT, CORE-sdc reaches 0.995, and D-SDC raises an absolute override', () => {
    const s = referenceCatalog(100000);
    const prov = provisionalParameters(['D-ABFT']);
    const a = applyMechanisms(s, ['D-SDC', 'D-ABFT'], prov);
    const b = applyMechanisms(applyMechanisms(s, ['D-ABFT'], prov), ['D-SDC'], prov);
    const ta = evaluateScenario(a, { structure: false }).training!;
    const tb = evaluateScenario(b, { structure: false }).training!;
    expect(tb.sdc!.coverage).toBeCloseTo(ta.sdc!.coverage, 12);
    expect(tb.deliveredGoodput).toBeCloseTo(ta.deliveredGoodput, 12);
    const core = b.components.find((c) => c.id === 'CORE-sdc')!;
    expect(core.sdc!.extraDetection!['D-ABFT']).toBeCloseTo(0.9, 12);
    expect(classSdcCoverage(componentInstances(core, computeCounts(b)), b.sdc.detection.coverage)).toBeCloseTo(0.995, 12);
    // an absolute per-class override below the scenario-level detector is raised to it, and restored on removal
    const over = JSON.parse(JSON.stringify(s)) as typeof s;
    over.components.find((c) => c.id === 'CORE-sdc')!.sdc!.coverage = 0.5;
    const raised = applyMechanisms(over, ['D-SDC']);
    expect(raised.components.find((c) => c.id === 'CORE-sdc')!.sdc!.coverage).toBeCloseTo(0.95, 12);
    expect(stripMechanisms(raised, ['D-SDC']).components.find((c) => c.id === 'CORE-sdc')!.sdc!.coverage).toBeCloseTo(0.5, 12);
  });
});

describe('fix 3: explicit recovery stages are rescaled to the attempt', () => {
  it('stages 30/30/30 under a 180 s attempt behave like 60/60/60', () => {
    const s = referenceCatalog(100000);
    const odd = JSON.parse(JSON.stringify(s)) as typeof s;
    if (odd.recovery.mode !== 'mixture') throw new Error('mixture expected');
    odd.recovery = { ...odd.recovery, automatic: { ...odd.recovery.automatic, stages: { startup: 30, read: 30, communication: 30 } } };
    expect(automaticStages(odd.recovery)).toEqual({ startup: 60, graphWithinStartup: 30, read: 60, communication: 60 });
    const prov = provisionalParameters(['R-WARM-PROCESS']);
    const a = evaluateScenario(applyMechanisms(s, ['R-WARM-PROCESS'], prov), { structure: false }).training!;
    const b = evaluateScenario(applyMechanisms(odd, ['R-WARM-PROCESS'], prov), { structure: false }).training!;
    expect(b.operationalAvailability).toBeCloseTo(a.operationalAvailability, 12);
    expect(b.chain.rows.find((r) => r.id === 'UNKNOWN-hard')!.meanPauseS).toBeCloseTo(a.chain.rows.find((r) => r.id === 'UNKNOWN-hard')!.meanPauseS, 9);
  });
});

describe('fix 4: the durable lag applies to rollback events only', () => {
  it('a fallback discovery returns to the clean checkpoint itself, lag or not', () => {
    const spec: LedgerSpec = {
      horizonH: 400, tauS: 300, deltaS: 4, detection: null, globalRecovery: () => () => 180, chain: {},
      sdc: { coverage: 0, detectSeconds: 1, fallbackDelayHours: 10 },
      classes: [{ id: 'x', hardRatePerHour: 0, sdcRatePerHour: 0.05, applicable: { replay: 0, process: 0, elastic: 0, predict: 0, netfail: 0, hotswap: 0 } }],
    };
    const r0 = runLedgerOnce({ ...spec, rollbackLagH: 0 }, new Rng(3), new Rng(4));
    const r1 = runLedgerOnce({ ...spec, rollbackLagH: 100 / 3600 }, new Rng(3), new Rng(4));
    expect(r1.counts.sdcEpisodes).toBeGreaterThan(0);
    expect(r1.ledger.rollbackSdc).toBeCloseTo(r0.ledger.rollbackSdc, 12);
    expect(r1.delivered).toBeCloseTo(r0.delivered, 12);
  });
});

describe('fix 5: the decomposition carries false alarms and detected corruption', () => {
  it('sums to 1 − A_op with separate lines for the predictor and detected silent corruption', () => {
    const s = applyMechanisms(referenceCatalog(100000), ['P-PREDICT', 'D-SDC']);
    const d = decompose(s, 'aOp');
    const sum = Object.values(d.byGroup).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1 - d.aOp, 12);
    expect(d.byGroup.falseAlarm).toBeGreaterThan(0);
    expect(d.byGroup.sdcDetected).toBeGreaterThan(0);
    expect(d.byGroup.isolation).toBeGreaterThan(0);
  });
});

describe('fix 6: fabric degrade runs as a throughput factor over the repair time', () => {
  it('books the local loss over the repair window and keeps the closed form within the simulation interval', () => {
    const s = applyMechanisms(referenceCatalog(100000), ['R-FABRIC-DEGRADE'], provisionalParameters(['R-FABRIC-DEGRADE']));
    expect(s.mechanisms.custom!['R-FABRIC-DEGRADE'].localLossDurationSeconds).toBe(1800);
    const spec = ledgerSpecFromScenario(s);
    const rows = simulateLedgerReplications(spec, 0, 100, 5);
    const t = evaluateScenario(s, { structure: false }).training!;
    expect(rows.some((r) => r.ledger.localLoss > 0)).toBe(true);
    const local = summaryStat(rows.map((r) => r.ledger.localLoss / r.horizonH));
    expect(Math.abs(local.mean - t.ledger.local)).toBeLessThan(3 * local.ci95 + 2e-4);
    const aop = summaryStat(rows.map((r) => r.operationalAvailability));
    expect(Math.abs(aop.mean - t.operationalAvailability)).toBeLessThan(3 * aop.ci95 + 2e-4);
    for (const r of rows) {
      const l = r.ledger;
      expect(Math.abs(r.correctH + l.downtime + l.save + l.slowdown + l.rollback + l.terminalInvalid + l.localLoss + l.overhead - r.horizonH)).toBeLessThan(1e-6);
    }
  });
});
