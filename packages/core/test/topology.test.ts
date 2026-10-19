/** v4 topology templates: calibration against the per-card catalog, default mechanisms, fill rules, per-unit classes and mechanism attachment. */
import { describe, it, expect } from 'vitest';
import { topologyScenario, calibrationScenario, topologyBom, bomAtSizes, unitFaultLibrary, templateUnits, fitOverrides, switchTopologyTemplate, resizeTopology, scaleLabel, bomRowsAcross, TOPOLOGY_TEMPLATE_IDS, TOPOLOGY_TEMPLATES, TOPOLOGY_SCALES } from '../src/topology/index.js';
import { referenceCatalog, EXAMPLES, REFERENCE_FIXTURES, RETIRED_EXAMPLES } from '../src/scenario/examples.js';
import { evaluateScenario } from '../src/scenario/evaluate.js';
import { computeCounts, closCounts } from '../src/scenario/build.js';
import { activeMechanisms, stripMechanisms, applyMechanisms, DEFAULT_PLAYERS, mechanismValues, editBase, mechanismOwner } from '../src/mechanisms/index.js';
import { provisionalParameters } from '../src/mechanisms/auditLibrary.js';
import { withSize, groupOf, decompose } from '../src/study/index.js';
import { parseScenario } from '../src/scenario/schema.js';

const tr = (s: Parameters<typeof evaluateScenario>[0]) => evaluateScenario(s, { structure: false }).training!;

describe('v4 topology templates', () => {
  it('a CloudMatrix384 cluster without scale-out network reproduces the per-card catalog (hard, sub-health, silent)', () => {
    for (const N of [384, 3840, 38400]) {
      const a = tr(calibrationScenario(N));
      const b = tr(referenceCatalog(N));
      // hard rates agree exactly; the isolation of detected sub-health differs by < 1e-7 relative because the occupancy of a unit
      // that is already sub-healthy is nonlinear in its per-unit rate (a node carries 8 cards' entry rate)
      expect(a.subhealth!.hardwareInterruptionsPerHour).toBeCloseTo(b.subhealth!.hardwareInterruptionsPerHour, 15);
      expect(Math.abs(a.interruptionRatePerHour / b.interruptionRatePerHour - 1)).toBeLessThan(1e-7);
      expect(Math.abs(a.operationalAvailability - b.operationalAvailability)).toBeLessThan(1e-9);
      expect(Math.abs(a.deliveredGoodput - b.deliveredGoodput)).toBeLessThan(1e-9);
      expect(a.sdc!.ratePerHour).toBeCloseTo(b.sdc!.ratePerHour, 12);
    }
  });

  it('applies the six ReMAP default mechanisms through the library, exactly removable', () => {
    const s = topologyScenario('a3-ub384', 10000);
    for (const id of DEFAULT_PLAYERS) expect(activeMechanisms(s)).toContain(id);
    const bare = topologyScenario('a3-ub384', 10000, { mechanisms: [] });
    expect(JSON.stringify(stripMechanisms(s, DEFAULT_PLAYERS))).toBe(JSON.stringify(bare));
    // the mechanisms raise the delivered goodput (silent-corruption detection and step recovery) and A_op (replay, elasticity, process rescheduling)
    expect(tr(s).deliveredGoodput).toBeGreaterThan(tr(bare).deliveredGoodput);
    expect(tr(s).operationalAvailability).toBeGreaterThan(tr(bare).operationalAvailability);
  });

  it('the topology changes the job interruption rate through the hardware mix', () => {
    const fit = Object.fromEntries(TOPOLOGY_TEMPLATE_IDS.map((t) => [t, topologyBom(topologyScenario(t, 10000, { mechanisms: [] })).hardFitPerNpuTotal]));
    expect(fit['a2-roce']).toBeLessThan(fit['a950-ub2']);
    expect(fit['a950-ub2']).toBeLessThan(fit['a3-ub384']);
    // A2 has no UB fabric; 64-NPU cabinets halve the facility FIT per NPU of the 32-NPU CloudMatrix384 cabinets
    const a2 = topologyBom(topologyScenario('a2-roce', 10240, { mechanisms: [] }));
    const a3 = topologyBom(topologyScenario('a3-ub384', 10368, { mechanisms: [] }));
    expect(a2.hardFitPerNpu['ub-switch']).toBeUndefined();
    expect(a2.hardFitPerNpu.cabinet! * 2).toBeCloseTo(a3.hardFitPerNpu.cabinet!, 6);
  });

  it('counts follow the template geometry at 1k / 10k / 20k / 50k', () => {
    const sizes = [1000, 10000, 20000, 50000];
    const rows = bomAtSizes(topologyScenario('a3-ub384', 1000), sizes);
    expect(rows.map((r) => r.bom.counts.supernodes)).toEqual([3, 27, 53, 131]);
    expect(rows.map((r) => r.bom.counts.l1Switches)).toEqual([875, 8750, 17500, 43750]);
    const a2 = bomAtSizes(topologyScenario('a2-roce', 1000), sizes);
    expect(a2.map((r) => r.bom.counts.racks)).toEqual([16, 157, 313, 782]);
    expect(a2.map((r) => r.bom.counts.scaleOutTiers)).toEqual([2, 3, 3, 3]);
  });

  it('v4.1 built-in scales 10k / 100k / 200k / 500k are the default bill-of-materials columns', () => {
    expect(TOPOLOGY_SCALES).toEqual([10000, 100000, 200000, 500000]);
    expect(TOPOLOGY_SCALES.map(scaleLabel)).toEqual(['10k', '100k', '200k', '500k']);
    const rows = bomAtSizes(topologyScenario('a3-ub384', 10000));
    expect(rows.map((r) => r.npus)).toEqual(TOPOLOGY_SCALES);
    // 384 NPUs per SuperPoD, 8 NPUs and 7 L1 UB chips per node (paper geometry)
    expect(rows.map((r) => r.bom.counts.supernodes)).toEqual(TOPOLOGY_SCALES.map((n) => Math.ceil(n / 384)));
    expect(rows.map((r) => r.bom.counts.l1Switches)).toEqual(TOPOLOGY_SCALES.map((n) => (7 * n) / 8));
    // A2: 64 NPUs per cabinet; the RoCE Clos needs a fourth tier beyond 32 · 64 · 32 = 65,536 ports at radix 64
    const a2 = bomAtSizes(topologyScenario('a2-roce', 10000));
    expect(a2.map((r) => r.bom.counts.racks)).toEqual(TOPOLOGY_SCALES.map((n) => Math.ceil(n / 64)));
    expect(a2.map((r) => r.bom.counts.scaleOutTiers)).toEqual([3, 4, 4, 4]);
  });

  it('the bill of materials across sizes keeps rows that exist only at other sizes (fourth Clos tier from 100k at radix 64)', () => {
    const s = topologyScenario('a2-roce', 10000);
    const at = bomAtSizes(s);
    const rows = bomRowsAcross(topologyBom(s), at);
    const ids = rows.map((r) => r.id);
    expect(ids.filter((id) => id.startsWith('roceTier'))).toEqual(['roceTier1', 'roceTier2', 'roceTier3', 'roceTier4']);
    expect(ids.indexOf('roceTier4')).toBe(ids.indexOf('roceTier3') + 1);
    const t4 = rows.find((r) => r.id === 'roceTier4')!;
    expect(t4.count).toBe(0);
    expect(t4.name.en).toBe('RoCE switch (tier 4, 64 ports)');
    expect(rows.find((r) => r.id === 'roceTier1')!.name.en).toBe('RoCE leaf switch (tier 1, 64 ports)');
    expect(at.map((z) => z.bom.rows.find((r) => r.id === 'roceTier4')?.count ?? null)).toEqual([null, 1563, 3125, 7813]);
  });

  it('v4.1 example registry = the three topology templates at the first built-in scale; resizing keeps a generated name in step', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(['topology-a2-roce', 'topology-a3-ub384', 'topology-a950-ub2']);
    for (const make of Object.values(EXAMPLES)) {
      const s = make();
      expect(s.topology.template).toBeDefined();
      expect(s.workload.type === 'training' && s.workload.nGpus).toBe(TOPOLOGY_SCALES[0]);
    }
    for (const id of Object.keys(RETIRED_EXAMPLES)) expect(EXAMPLES[id]).toBeUndefined();
    expect(Object.keys(REFERENCE_FIXTURES).every((id) => id in RETIRED_EXAMPLES)).toBe(true);
    const s = EXAMPLES['topology-a3-ub384']();
    const big = resizeTopology(s, 500000);
    expect(big.meta.name).toBe('A3 · CloudMatrix384 UB supernode — 500,000 NPUs');
    expect(big.meta.id).toBe(s.meta.id);
    expect(computeCounts(big).nodes).toBe(62500);
    expect(topologyBom(big).hardPerHour).toBeCloseTo(topologyBom(withSize(s, 500000)).hardPerHour, 12);
    const named = resizeTopology({ ...s, meta: { ...s.meta, name: 'my design' } }, 100000);
    expect(named.meta.name).toBe('my design');
  });

  it('port-count fill of a partly populated SuperPoD never exceeds the full-pod fill and equals it for whole pods', () => {
    for (const t of ['a3-ub384', 'a950-ub2'] as const) {
      for (const N of [1000, 8192, 12345, 50000]) {
        const p = computeCounts(topologyScenario(t, N, { mechanisms: [] }));
        const f = computeCounts(topologyScenario(t, N, { mechanisms: [], topology: { fabricFill: 'full-pod' } }));
        expect(p.l2Switches).toBeLessThanOrEqual(f.l2Switches);
        expect(p.commRacks).toBeLessThanOrEqual(f.commRacks);
        expect(p.opticalLinks).toBe(f.opticalLinks);
      }
      const whole = TOPOLOGY_TEMPLATES[t].podNpus * 2;
      const p = computeCounts(topologyScenario(t, whole, { mechanisms: [] }));
      const f = computeCounts(topologyScenario(t, whole, { mechanisms: [], topology: { fabricFill: 'full-pod' } }));
      expect(p.l2Switches).toBe(f.l2Switches);
      expect(p.commRacks).toBe(f.commRacks);
    }
    // the v2 default stays full-pod
    expect(parseScenario({ meta: { name: 'x' }, components: [{ id: 'x', countRule: { per: 'gpu', factor: 1 }, failure: { value: 0, unit: 'per_h' }, repair: { mttrHours: 1 } }], workload: { type: 'training', nGpus: 8, deltaS: 1 } }).topology.fabricFill).toBe('full-pod');
  });

  it('a folded Clos carries its ports and every tier has enough ports', () => {
    for (const P of [10, 64, 65, 1000, 2048, 2049, 10000, 65536, 65537, 200000]) {
      for (const k of [32, 64, 128]) {
        const c = closCounts(P, k, 1, 2);
        expect(c.capacity).toBeGreaterThanOrEqual(P);
        if (c.tiers >= 2) {
          expect(c.perTier[0] * (k / 2)).toBeGreaterThanOrEqual(P);
          expect(c.perTier[c.tiers - 1] * k).toBeGreaterThanOrEqual(P);
          expect(c.links).toBe(P * c.tiers);
        }
      }
    }
  });

  it('per-unit classes keep the catalog domains: groups and audited mechanisms attach to the RoCE analogues', () => {
    const s = topologyScenario('a2-roce', 10000, { mechanisms: [] });
    expect(s.components.some((c) => c.id === 'FABRIC-hard@roce')).toBe(true);
    expect(s.components.some((c) => c.id === 'FABRIC-hard')).toBe(false);
    expect(groupOf(s.components.find((c) => c.id === 'OPT-hard@roce')!)).toBe('network');
    const withLink = applyMechanisms(s, ['R-LINK-LOCAL'], provisionalParameters(['R-LINK-LOCAL']));
    expect(withLink.components.find((c) => c.id === 'OPT-hard@roce')!.mechanisms?.custom?.['R-LINK-LOCAL']).toBe(1);
    expect(mechanismValues(withLink).aOp).toBeGreaterThan(mechanismValues(s).aOp);
    expect(Object.keys(decompose(s, 'aOp').byGroup)).toContain('network');
  });

  it('library: 54 catalog events plus 6 RoCE analogues; FIT overrides replace the default per unit', () => {
    const lib = unitFaultLibrary();
    expect(lib.length).toBe(60);
    expect(lib.filter((f) => f.analogue).map((f) => f.id).sort()).toEqual(['FABRIC-hard@roce', 'FABRIC-sdc@roce', 'FABRIC-slow@roce', 'OPT-hard@roce', 'OPT-sdc@roce', 'OPT-slow@roce']);
    expect(templateUnits('a2-roce')).not.toContain('ub-link');
    expect(templateUnits('a3-ub384', false)).not.toContain('roce-switch');
    const base = topologyScenario('a3-ub384', 3840, { mechanisms: [] });
    const halved = topologyScenario('a3-ub384', 3840, { mechanisms: [], fit: { 'CORE-hard': lib.find((f) => f.id === 'CORE-hard')!.fitPerUnit / 2 } });
    const dl = tr(base).interruptionRatePerHour - tr(halved).interruptionRatePerHour;
    expect(dl * 1e9 / 3840).toBeCloseTo(466.6666666666666 / 2, 6);
  });

  it('withSize rescales every count rule of a topology scenario', () => {
    const s = topologyScenario('a950-ub2', 1000);
    const big = computeCounts(withSize(s, 50000));
    expect(big.cpus).toBe(25000);
    expect(big.scaleOutPorts).toBe(100000);
    expect(big.ubSwitches).toBe(big.l1Switches + big.l2Switches);
  });

  it('editing the design under the mechanisms keeps them applied; owned settings stay with their mechanism', () => {
    const s = topologyScenario('a3-ub384', 10000);
    expect(mechanismOwner(s, 'workload.deltaS')).toBe('C-FAST');
    expect(mechanismOwner(s, 'sdc.detection')).toBe('D-SDC');
    expect(mechanismOwner(s, 'recovery.detection')).toBeUndefined();
    const e = editBase(s, (b) => ({ ...b, workload: { ...b.workload, deltaS: 9 } as typeof b.workload, components: b.components.map((c) => (c.id === 'CORE-hard' ? { ...c, failure: { ...c.failure, value: 100 } } : c)) }));
    expect(e.workload.type === 'training' && e.workload.deltaS).toBe(1);
    expect(stripMechanisms(e, ['C-FAST']).workload.type === 'training' && (stripMechanisms(e, ['C-FAST']).workload as { deltaS: number }).deltaS).toBe(9);
    expect(activeMechanisms(e)).toEqual(activeMechanisms(s));
    expect(fitOverrides(e)).toEqual({ 'CORE-hard': 100 });
  });

  it('switching template keeps N, job settings, FIT edits and mechanisms', () => {
    const s = editBase(topologyScenario('a3-ub384', 12000), (b) => ({ ...b, components: b.components.map((c) => (c.id === 'MEMT-hard' ? { ...c, failure: { ...c.failure, value: 200 } } : c)), recovery: b.recovery.mode === 'mixture' ? { ...b.recovery, manual: { seconds: 3600 } } : b.recovery }));
    const a2 = switchTopologyTemplate(s, 'a2-roce');
    expect(a2.topology.template).toBe('a2-roce');
    expect(a2.meta.id).toBe('topology-a2-roce');
    expect(a2.workload.type === 'training' && a2.workload.nGpus).toBe(12000);
    expect(fitOverrides(a2)).toEqual({ 'MEMT-hard': 200 });
    expect(a2.recovery.mode === 'mixture' && a2.recovery.manual.seconds).toBe(3600);
    expect(activeMechanisms(a2).sort()).toEqual(activeMechanisms(s).sort());
    expect(a2.components.some((c) => c.id === 'FABRIC-hard')).toBe(false);
    const back = switchTopologyTemplate(a2, 'a3-ub384');
    expect(topologyBom(back).hardPerHour).toBeCloseTo(topologyBom(s).hardPerHour, 12);
  });

  it('the bill of materials of a per-card scenario keeps every class on the NPU (count rule wins over the domain)', () => {
    const b = topologyBom(referenceCatalog(100000));
    expect(b.hardFitPerNpuTotal).toBeCloseTo(3333.3333, 3);
    expect(Object.keys(b.hardFitPerNpu).sort()).toEqual(['job', 'npu']);
  });
});
