/** v5 input records: topology record ≡ the v4.4 scenario builders, the per-card failure-rate override ≡ the reference catalog, the ReMAP-latest mechanism set ≡ the former script constant. */
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TOPOLOGY_RECORDS, scenarioFromRecord, parseTopologyRecord, topologyRecordJsonSchema, recordSuperpod, recordPodNpus, recordScaleOut,
  applyFaultRates, applyFaultRatesDetailed, parseFaultRateOverride, REMAP_PER_CARD_RATES, faultRateOverrideJsonSchema,
  DEFAULT_MECHANISM_SET, resolveMechanismSet, applyMechanismSet, mechanismMetadata, withRecoveryBaseline, parseMechanismSet, mechanismSetJsonSchema,
  type TopologyRecord,
} from '../src/records/index.js';
import { topologyScenario, fitOverrides, unitFaultLibrary } from '../src/topology/index.js';
import { referenceCatalog } from '../src/scenario/examples.js';
import { evaluateScenario } from '../src/scenario/evaluate.js';
import { computeCounts } from '../src/scenario/build.js';
import { MECHANISM_LIBRARY, DEFAULT_PLAYERS, mechanismById, stripMechanisms } from '../src/mechanisms/index.js';
import { DEFAULT_LEVERS } from '../src/strategy/index.js';
import { DERATE_DEFAULT } from '../src/mechanisms/plan.js';
import { toPerHour } from '../src/units/index.js';
import * as A950 from '../../../scripts/ascend950-archs.js';
import * as A910 from '../../../scripts/ascend910c-archs.js';
/** CANDIDATES of scripts/ascend-allocation-data.ts (that script runs on import, so the list is copied) */
const CANDIDATES = ['D-HARD', 'D-RECOVERY-CLASSIFY', 'R-LINK-LOCAL', 'R-RUNTIME-SNAPSHOT', 'H-CONTROL-CONTINUITY', 'C-LOSSLESS', 'R-FABRIC-DEGRADE'];

const tr = (s: Parameters<typeof evaluateScenario>[0]) => evaluateScenario(s, { structure: false }).training!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

type Builder = { build: (n: number, so?: A950.ScaleOut) => ReturnType<typeof A950.scenarioOf>; SO: Record<string, { so: A950.ScaleOut }> };
const BUILDERS: Record<keyof typeof BUILTIN_TOPOLOGY_RECORDS, Builder> = {
  native950: { build: (n, so) => A950.scenarioOf('native', n, so), SO: A950.SO },
  ubl128: { build: (n, so) => A950.scenarioOf('ubl128', n, so), SO: A950.SO },
  cm384: { build: (n, so) => A910.scenarioOf('cm384', n, so), SO: A910.SO },
  a3server: { build: (n, so) => A910.scenarioOf('a3server', n, so), SO: A910.SO },
};

describe('v5 topology record', () => {
  it('the four built-in records reproduce the v4.4 scenario builders at 10k–500k NPUs', () => {
    for (const [id, b] of Object.entries(BUILDERS)) {
      const rec = BUILTIN_TOPOLOGY_RECORDS[id as keyof typeof BUILDERS];
      for (const N of [10000, 100000, 200000, 500000]) expect(JSON.stringify(scenarioFromRecord(rec, N)), `${id} @ ${N}`).toBe(JSON.stringify(b.build(N)));
    }
  });

  it('every scale-out variant reproduces the builder with that design (100k), and main is the record’s own scaleOut', () => {
    for (const [id, b] of Object.entries(BUILDERS)) {
      const rec = BUILTIN_TOPOLOGY_RECORDS[id as keyof typeof BUILDERS];
      expect(rec.variants.map((v) => v.id).sort()).toEqual(Object.keys(b.SO).sort());
      for (const v of rec.variants) expect(JSON.stringify(scenarioFromRecord(rec, 100000, v.id)), `${id} / ${v.id}`).toBe(JSON.stringify(b.build(100000, b.SO[v.id].so)));
      expect(recordScaleOut(rec, 'main')).toEqual(rec.scaleOut);
      expect(() => scenarioFromRecord(rec, 100000, 'nope')).toThrow(/no scale-out variant 'nope'/);
    }
  });

  it('records keep the builders’ names, assumptions and a layers block consistent with the geometry and the counts', () => {
    const arch = { native950: A950.ARCHS.native, ubl128: A950.ARCHS.ubl128, cm384: A910.ARCHS.cm384, a3server: A910.ARCHS.a3server };
    for (const [id, a] of Object.entries(arch)) {
      const rec = BUILTIN_TOPOLOGY_RECORDS[id as keyof typeof arch];
      expect(rec.name).toEqual(a.name);
      expect(rec.short).toEqual(a.short);
      // v5 reconciliation: the records carry bilingual assumption items (the builders' field notes live in `provenance`)
      expect(rec.assumed.length).toBeGreaterThan(0);
      for (const x of rec.assumed) expect(typeof x === 'string' || (typeof x === 'object' && !!x.zh && !!x.en)).toBe(true);
      expect(recordSuperpod(rec)).toEqual(a.superpod);
      const sp = recordSuperpod(rec);
      expect(rec.layers.cabinet.npus).toBe(sp.npusPerNode * sp.nodesPerRack);
      expect(rec.layers.node.npus).toBe(sp.npusPerNode);
      expect(rec.layers.superpod.npus).toBe(rec.layers.superpod.unit === 'nodes' ? sp.npusPerNode : recordPodNpus(rec));
      for (const p of Object.values(rec.provenance)) expect(p.source.length).toBeGreaterThan(0);
      // the instance count the layer model reads (ascend-allocation-data.ts instancesOf)
      const c = computeCounts(scenarioFromRecord(rec, 100000));
      const inst = rec.layers.superpod.unit === 'nodes' ? c.nodes : c.supernodes;
      expect(inst).toBe(id === 'a3server' ? c.nodes : c.supernodes);
    }
    expect(BUILTIN_TOPOLOGY_RECORDS.a3server.layers.superpod.unit).toBe('nodes');
    expect(Object.values(BUILTIN_TOPOLOGY_RECORDS).filter((r) => r.layers.superpod.unit === 'nodes').map((r) => r.id)).toEqual(['a3server']);
  });

  it('a geometry patch and dropped count overrides follow the builder’s optional arguments', () => {
    const rec = BUILTIN_TOPOLOGY_RECORDS.ubl128;
    expect(JSON.stringify(scenarioFromRecord(rec, 100000, undefined, { superpod: { cpusPerNode: 4 }, dropOverrides: ['commCabinet'] }))).toBe(JSON.stringify(A950.scenarioOf('ubl128', 100000, A950.SO.main.so, { cpusPerNode: 4 }, ['commCabinet'])));
  });

  it('a malformed record fails loudly; an unknown template or unit names the two extension points', () => {
    const base = clone(BUILTIN_TOPOLOGY_RECORDS.native950) as unknown as Record<string, unknown>;
    expect(() => parseTopologyRecord({ ...base, template: 'a990-npo' })).toThrow(/unknown topology template.*unitFaultLibrary.*topologyBom/);
    expect(() => parseTopologyRecord({ ...base, faultUnits: ['npu', 'npo-engine'] })).toThrow(/unknown fault unit 'npo-engine'.*unitFaultLibrary.*topologyBom/);
    expect(() => parseTopologyRecord({ ...base, faultUnits: ['npu', 'roce-link', 'ub-link'] })).not.toThrow();
    expect(() => parseTopologyRecord({ ...base, template: 'a2-roce', faultUnits: ['ub-switch'] })).toThrow(/not carried by template a2-roce.*unitFaultLibrary.*topologyBom/);
    expect(() => parseTopologyRecord({ ...base, superpod: { base: 'atlas950-1k', computeRack: 2 } })).toThrow(/superpod/);
    expect(() => parseTopologyRecord({ ...base, superpod: { base: 'atlas999' } })).toThrow(/superpod\.base/);
    expect(() => parseTopologyRecord({ ...base, variants: (base.variants as { id: string }[]).filter((v) => v.id !== 'main') })).toThrow(/main/);
    expect(() => parseTopologyRecord({ ...base, scaleOut: { ...(base.scaleOut as object), radix: 512 } })).toThrow(/variant 'main' must equal/);
    expect(() => parseTopologyRecord({ ...base, provenance: { 'superpod.x': { source: 's', confidence: 'guess' } } })).toThrow(/provenance/);
    // a record bypassing the schema still fails in the loader
    expect(() => scenarioFromRecord({ ...BUILTIN_TOPOLOGY_RECORDS.native950, template: 'a990' } as unknown as TopologyRecord, 1000)).toThrow(/unitFaultLibrary.*topologyBom/);
  });

  it('a custom geometry without a preset base is filled by the schema defaults; the JSON Schema exports', () => {
    const rec = parseTopologyRecord({ ...clone(BUILTIN_TOPOLOGY_RECORDS.cm384), superpod: { computeRacks: 12 } });
    expect(recordSuperpod(rec).l2PerSubPlane).toBe(16);
    expect(scenarioFromRecord(rec, 3840).workload).toMatchObject({ nGpus: 3840 });
    const js = topologyRecordJsonSchema() as { properties: Record<string, unknown> };
    expect(Object.keys(js.properties)).toEqual(expect.arrayContaining(['template', 'superpod', 'variants', 'layers', 'provenance']));
  });
});

describe('v5 failure-rate override', () => {
  it('the per-card catalog (ReMAP basis) on the CloudMatrix384 calibration cluster reproduces referenceCatalog(N)', () => {
    expect(Object.keys(REMAP_PER_CARD_RATES.rates)).toHaveLength(54);
    expect(Object.keys(REMAP_PER_CARD_RATES.analogues ?? {})).toHaveLength(6);
    for (const N of [384, 38400]) {
      const s = topologyScenario('a3-ub384', N, { scaleOut: false, mechanisms: [] });
      const r = applyFaultRatesDetailed(s, REMAP_PER_CARD_RATES);
      expect(r.warnings).toEqual([]);
      expect(r.changes).toHaveLength(54);
      expect(fitOverrides(r.scenario)).toEqual({});
      const a = tr(r.scenario), b = tr(referenceCatalog(N));
      expect(a.subhealth!.hardwareInterruptionsPerHour).toBeCloseTo(b.subhealth!.hardwareInterruptionsPerHour, 15);
      expect(Math.abs(a.interruptionRatePerHour / b.interruptionRatePerHour - 1)).toBeLessThan(1e-7);
      expect(Math.abs(a.operationalAvailability - b.operationalAvailability)).toBeLessThan(1e-9);
      expect(Math.abs(a.deliveredGoodput - b.deliveredGoodput)).toBeLessThan(1e-9);
      expect(a.sdc!.ratePerHour).toBeCloseTo(b.sdc!.ratePerHour, 12);
    }
  });

  it('the per-card catalog leaves a full topology scenario (RoCE analogues, mechanisms) at the library values', () => {
    const s = topologyScenario('a950-ub2', 100000);
    const r = applyFaultRatesDetailed(s, REMAP_PER_CARD_RATES);
    expect(r.warnings).toEqual([]);
    expect(r.changes).toHaveLength(60);
    expect(fitOverrides(r.scenario)).toEqual({});
    expect(r.scenario.mechanisms.applied).toEqual(s.mechanisms.applied);
    expect(r.changes.find((c) => c.id === 'OPT-hard@roce')!.from).toBe('OPT-hard');
  });

  it('one measured class changes exactly that class, keeps the applied mechanisms and carries its confidence', () => {
    const s = topologyScenario('a950-ub2', 100000);
    const libPower = unitFaultLibrary().find((f) => f.id === 'POWER-hard')!.fitPerUnit;
    const o = parseFaultRateOverride({ id: 'fleet-2026q4', basis: 'per-unit', rates: { 'POWER-hard': { unit: 'cabinet', fit: 0.6 * libPower, source: 'fleet measurement 2026-Q4', confidence: 'measured' } } });
    const r = applyFaultRatesDetailed(s, o);
    expect(r.warnings).toEqual([]);
    const t = r.scenario;
    expect(t.mechanisms.applied).toEqual(s.mechanisms.applied);
    expect(Object.keys(t.mechanisms.applied ?? {}).sort()).toEqual([...DEFAULT_PLAYERS].sort());
    const val = (x: typeof s, id: string) => { const c = x.components.find((y) => y.id === id)!; return [toPerHour(c.failure.value, c.failure.unit), c.subhealth?.ratePerHour ?? null, c.sdc?.ratePerHour ?? null]; };
    for (const c of s.components) {
      if (c.id === 'POWER-hard') continue;
      expect(val(t, c.id), c.id).toEqual(val(s, c.id));
    }
    const p = t.components.find((c) => c.id === 'POWER-hard')!;
    expect(p.failure.unit).toBe('FIT');
    expect(p.failure.value).toBeCloseTo(0.6 * libPower, 9);
    expect(p.failure.provenance!.confidence).toBe('measured');
    expect(p.failure.provenance!.source).toBe('fleet measurement 2026-Q4');
    expect(p.failure.koujing).toEqual(s.components.find((c) => c.id === 'POWER-hard')!.failure.koujing);
    expect(fitOverrides(t)).toEqual({ 'POWER-hard': 0.6 * libPower });
    // the rate change reaches the KPIs and nothing else is touched outside the components
    expect(tr(t).interruptionRatePerHour).toBeLessThan(tr(s).interruptionRatePerHour);
    expect(stripMechanisms(t, DEFAULT_PLAYERS).recovery).toEqual(stripMechanisms(s, DEFAULT_PLAYERS).recovery);
    expect(applyFaultRates(s, o)).toEqual(t);
  });

  it('silent and sub-health classes write their own rate and provenance; absent classes are reported, not dropped', () => {
    const s = topologyScenario('a3-ub384', 3840);
    const r = applyFaultRatesDetailed(s, parseFaultRateOverride({
      id: 'x', basis: 'per-card',
      rates: {
        'CORE-sdc': { fit: 10, source: 'test', confidence: 'derived' },
        'DDR-slow': { fit: 2, source: 'test', confidence: 'vendor' },
        'NOPE-hard': { fit: 1, source: 'test', confidence: 'assumed' },
      },
    }));
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/NOPE-hard.*not in scenario/);
    const sdc = r.scenario.components.find((c) => c.id === 'CORE-sdc')!;
    expect(sdc.sdc!.ratePerHour).toBeCloseTo(10 / 1e9, 20); // per card = per NPU
    expect(sdc.sdc!.provenance!.confidence).toBe('derived');
    const slow = r.scenario.components.find((c) => c.id === 'DDR-slow')!;
    const k = unitFaultLibrary().find((f) => f.id === 'DDR-slow')!.cardsPerUnit;
    expect(slow.subhealth!.ratePerHour).toBeCloseTo((2 * k) / 1e9, 20);
    expect(slow.failure.provenance!.confidence).toBe('vendor');
    expect(Object.keys(fitOverrides(r.scenario)).sort()).toEqual(['CORE-sdc', 'DDR-slow']);
    expect(() => parseFaultRateOverride({ id: 'y', basis: 'per-unit', rates: {}, analogues: { 'A@roce': 'A' } })).toThrow(/analogue/);
    expect(faultRateOverrideJsonSchema()).toBeTruthy();
  });
});

/** the literal table of scripts/remap-latest-params.ts before it became a re-export (2026-10-21), so that the record cannot drift silently */
const REMAP_LATEST_PARAMS_OLD: Record<string, Record<string, number>> = {
  'R-LINK-LOCAL': { successSeconds: 2, eligibleShare: 1, success: 0.95, failureSeconds: 0, overhead: 0 },
  'R-FABRIC-DEGRADE': { switchSeconds: 2, exposedCommunicationFraction: 0.3, remainingBandwidthRatio: 0.75, repairSeconds: 1800, eligibleShare: 1, success: 0.95, failureSeconds: 0, overhead: 0 },
  'H-CONTROL-CONTINUITY': { pauseSeconds: 1, eligibleShare: 1, success: 0.95, failureSeconds: 0, overhead: 0 },
  'R-WARM-PROCESS': { startupTargetSeconds: 20, eligibleShare: 0.95 },
  'R-RUNTIME-SNAPSHOT': { startupTargetSeconds: 15, eligibleShare: 0.95 },
  'R-CANN-GRAPH': { graphTargetSeconds: 7.5, eligibleShare: 0.95 },
  'C-ASYNC': { blockingTargetSeconds: 4 * 0.05 + 1 * 0.95, durableLagSeconds: 10 },
  'C-LOSSLESS': { compressionRatio: 2, decompressSeconds: 10, share: 0.95 },
  'D-RECOVERY-CLASSIFY': { manualProbabilityTarget: 0.001, eligibleShare: 1, success: 0.95 },
  'D-SDC-FP8': { detectionTarget: 0.95, detectSeconds: 1, riskShare: 0.5 * 0.95 },
  'D-SDC-FP4': { detectionTarget: 0.95, detectSeconds: 1, riskShare: 0.5 * 0.95 },
  'D-ABFT': { upstreamDetection: 0.95, conditionalMissDetection: 0.9 * 0.95, overhead: 0.001 },
  'D-NET-SDC': { detectionTarget: 0.95 * 0.95, detectSeconds: 1 },
  'H-SDC-SCREEN': { occurrenceReduction: 0.25, eligibleShare: 0.95 },
  'R-HCCL-ELASTIC': { communicationBeforeSeconds: 60, communicationTargetSeconds: 15, share: 0.95 },
};
const ORIGINAL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];

describe('v5 mechanism set', () => {
  const set = DEFAULT_MECHANISM_SET;
  const all = [...set.baseline, ...set.candidates, ...set.goodputOnly, ...set.pruned, ...set.capability];

  it('the ReMAP-latest set carries the former script constant, the baseline, the candidates and the library levers / derating', () => {
    expect(set.parameters).toEqual(REMAP_LATEST_PARAMS_OLD);
    const r = resolveMechanismSet(set);
    for (const id of all) expect(r.parameters[id], id).toEqual({ ...mechanismById(id).parameters, ...(REMAP_LATEST_PARAMS_OLD[id] ?? {}) });
    expect(set.baseline).toEqual(DEFAULT_PLAYERS);
    expect(set.candidates).toEqual(CANDIDATES);
    expect(set.goodputOnly).toEqual(['D-SDC-FP8', 'D-SDC-FP4', 'D-ABFT', 'D-NET-SDC', 'H-SDC-SCREEN']);
    expect([...set.pruned].sort()).toEqual(['C-ASYNC', 'D-SLOW', 'R-CANN-GRAPH', 'R-HCCL-ELASTIC', 'R-WARM-PROCESS']);
    expect(set.capability).toEqual(['I-CONTAIN']);
    expect(r.players).toHaveLength(23);
    expect(r.players).not.toContain('I-CONTAIN');
    expect(set.levers).toEqual(DEFAULT_LEVERS);
    expect(set.derate).toEqual(DERATE_DEFAULT);
    expect(set.prune.threshold).toBe(0.0015);
    expect(set.prune.dominated).toEqual({ 'R-WARM-PROCESS': 'R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH': 'R-RUNTIME-SNAPSHOT' });
    expect(set.remap).toMatchObject({ repo: 'https://github.com/lzq0927/remap', commit: 'f53ab7e' });
    for (const id of all) expect(r.efforts[id]).toBe(mechanismById(id).effort);
  });

  it('metadata covers the audited extensions plus the 8 originals, and every verdict sits in its list', () => {
    const want = [...ORIGINAL, ...MECHANISM_LIBRARY.filter((m) => m.audit).map((m) => m.id)];
    expect(Object.keys(set.metadata).sort()).toEqual([...want].sort());
    expect(Object.keys(set.metadata)).toHaveLength(24);
    expect(all.sort()).toEqual([...want].sort());
    expect(mechanismMetadata(set, 'R-LINK-LOCAL')).toMatchObject({ deploy: 'superpod', acts: ['superpod', 'scaleout', 'npu'], stage: 'rung' });
    expect(mechanismMetadata(set, 'R-RUNTIME-SNAPSHOT').stage).toBe('automatic');
    expect(set.verdicts!['D-SLOW'].verdict).toBe('pruned');
    expect(set.verdicts!['I-CONTAIN'].verdict).toBe('capability');
  });

  it('the schema rejects inconsistent sets', () => {
    const j = clone(set) as unknown as Record<string, unknown>;
    expect(() => parseMechanismSet({ ...j, candidates: [...set.candidates, 'R-REPLAY'] })).toThrow(/'R-REPLAY' is in both 'baseline' and 'candidates'/);
    expect(() => parseMechanismSet({ ...j, pruned: set.pruned.filter((x) => x !== 'D-SLOW'), candidates: [...set.candidates, 'D-SLOW'] })).toThrow(/'D-SLOW' has verdict 'pruned' but is listed in 'candidates'/);
    expect(() => parseMechanismSet({ ...j, candidates: [...set.candidates, 'X-NEW'] })).toThrow(/unknown mechanism 'X-NEW'/);
    expect(() => parseMechanismSet({ ...j, capability: [], candidates: [...set.candidates, 'I-CONTAIN'] })).toThrow(/no scenario transform/);
    const md = { ...set.metadata }; delete md['C-FAST'];
    expect(() => parseMechanismSet({ ...j, metadata: md })).toThrow(/no metadata for 'C-FAST'/);
    expect(() => parseMechanismSet({ ...j, stages: { startup: 60, read: 60, communication: 30 } })).toThrow(/stages sum/);
    expect(() => parseMechanismSet({ ...j, stages: { startup: 60, read: 60, communication: 60 } })).not.toThrow();
    expect(mechanismSetJsonSchema()).toBeTruthy();
  });

  it('applying the baseline with the set’s parameters equals the topology scenario with the six defaults', () => {
    const bare = topologyScenario('a950-ub2', 10000, { mechanisms: [] });
    expect(JSON.stringify(applyMechanismSet(bare, set))).toBe(JSON.stringify(topologyScenario('a950-ub2', 10000)));
    const withCand = applyMechanismSet(bare, set, [...set.baseline, 'R-LINK-LOCAL']);
    expect(withCand.mechanisms.applied!['R-LINK-LOCAL'].parameters).toEqual(resolveMechanismSet(set).parameters['R-LINK-LOCAL']);
    expect(() => applyMechanismSet(bare, set, ['I-CONTAIN'])).toThrow(/cannot apply I-CONTAIN/);
  });

  it('the recovery baseline of the set is the topology default and survives an applied D-HARD', () => {
    const s = topologyScenario('a3-ub384', 10000);
    expect(JSON.stringify(withRecoveryBaseline(s, set))).toBe(JSON.stringify(s));
    expect(set.recovery.provenance.confidence).toBe('assumed');
    const slow = parseMechanismSet({ ...clone(set), recovery: { ...clone(set.recovery), manual: { seconds: 3600 } }, stages: { startup: 60, read: 60, communication: 60 } });
    const d = applyMechanismSet(s, set, ['D-HARD', ...set.baseline]);
    const t = withRecoveryBaseline(d, slow);
    expect(t.recovery).toMatchObject({ mode: 'mixture', manual: { seconds: 3600 }, automatic: { seconds: 180, stages: { startup: 60, read: 60, communication: 60 } }, detection: { coverage: 0.999, autoSeconds: 1 } });
    expect(stripMechanisms(t, ['D-HARD']).recovery).toMatchObject({ detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 } });
  });
});
