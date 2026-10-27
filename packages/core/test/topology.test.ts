/** v4 topology templates: calibration against the per-card catalog, default mechanisms, fill rules, per-unit classes and mechanism attachment. */
import { describe, it, expect } from 'vitest';
import { topologyScenario, calibrationScenario, topologyBom, bomAtSizes, unitFaultLibrary, templateUnits, fitOverrides, switchTopologyTemplate, resizeTopology, scaleLabel, bomRowsAcross, TOPOLOGY_TEMPLATE_IDS, TOPOLOGY_TEMPLATES, TOPOLOGY_SCALES, SUPERPOD_VARIANTS, superpodVariantOf, applySuperpodVariant, withFabric, faultUnitName } from '../src/topology/index.js';
import { referenceCatalog, EXAMPLES, REFERENCE_FIXTURES, RETIRED_EXAMPLES } from '../src/scenario/examples.js';
import { RECORD_EXAMPLES, BUILTIN_TOPOLOGY_RECORDS, scenarioFromRecord } from '../src/records/topologyRecord.js';
import { evaluateScenario } from '../src/scenario/evaluate.js';
import { computeCounts, closCounts, scaleOutCounts, componentInstances } from '../src/scenario/build.js';
import { activeMechanisms, stripMechanisms, applyMechanisms, DEFAULT_PLAYERS, mechanismValues, editBase, mechanismOwner } from '../src/mechanisms/index.js';
import { provisionalParameters } from '../src/mechanisms/auditLibrary.js';
import { withSize, groupOf, decompose } from '../src/study/index.js';
import { parseScenario, SUPERPOD_PRESETS, COUNT_RULE_PERS } from '../src/scenario/schema.js';
import { mcSpecFromScenario } from '../src/mc/fromScenario.js';

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

  it('v4.2 example registry = the four topology templates at the first built-in scale (v5.3: the Atlas 950 example is the native950 record, UBL128 and the A3 server cluster added); resizing keeps a generated name in step', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(['topology-a2-roce', 'topology-a3-ub384', 'topology-a3server', 'topology-a950-ub2', 'topology-a960e-ub', 'topology-ub-generic', 'topology-ubl128']);
    expect(Object.keys(RECORD_EXAMPLES).sort()).toEqual(['topology-a3server', 'topology-a950-ub2', 'topology-ubl128']);
    // the page's Atlas 950 = the record's geometry (scale-out 4 ports / 4 planes / radix 1024), under the page id and the template name
    const a950 = EXAMPLES['topology-a950-ub2']();
    expect(a950.meta.id).toBe('topology-a950-ub2');
    expect(a950.meta.name).toBe('Atlas 950 · UB 2.0 SuperPoD — 10,000 NPUs');
    expect(a950.topology.scaleOut).toEqual(scenarioFromRecord(BUILTIN_TOPOLOGY_RECORDS.native950, 10000).topology.scaleOut);
    expect(a950.topology.scaleOut?.portsPerNpu).toBe(4);
    expect(EXAMPLES['topology-ubl128']().meta.id).toBe('topology-ubl128');
    expect(EXAMPLES['topology-a3server']().meta.name).toBe('Atlas 800T A3 server cluster (8 NPUs per server, RoCE between servers) — 10,000 NPUs');
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
    for (const t of ['a3-ub384', 'a950-ub2', 'a960e-ub', 'ub-generic'] as const) {
      for (const N of [1000, 8192, 12345, 50000]) {
        const p = computeCounts(topologyScenario(t, N, { mechanisms: [] }));
        const f = computeCounts(topologyScenario(t, N, { mechanisms: [], topology: { fabricFill: 'full-pod' } }));
        expect(p.l2Switches).toBeLessThanOrEqual(f.l2Switches);
        expect(p.podSwitches).toBeLessThanOrEqual(f.podSwitches); // v4.2 mesh / blade fabrics: the pod-tier switches follow the fill
        expect(p.commRacks).toBeLessThanOrEqual(f.commRacks);
        expect(p.opticalLinks).toBe(f.opticalLinks);
      }
      const whole = TOPOLOGY_TEMPLATES[t].podNpus * 2;
      const p = computeCounts(topologyScenario(t, whole, { mechanisms: [] }));
      const f = computeCounts(topologyScenario(t, whole, { mechanisms: [], topology: { fabricFill: 'full-pod' } }));
      expect(p.l2Switches).toBe(f.l2Switches);
      expect(p.podSwitches).toBe(f.podSwitches);
      expect(p.commRacks).toBe(f.commRacks);
    }
    // a partial Atlas 950 pod: 12,345 NPUs = 12 whole pods + 57 NPUs → ⌈57 × 2 / 128⌉ = 1 pod switch proportional, 16 full-pod
    const pp = computeCounts(topologyScenario('a950-ub2', 12345, { mechanisms: [] }));
    const pf = computeCounts(topologyScenario('a950-ub2', 12345, { mechanisms: [], topology: { fabricFill: 'full-pod' } }));
    expect([pp.podSwitches, pf.podSwitches]).toEqual([12 * 16 + 1, 13 * 16]);
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
    // Atlas 950: 2 Kunpeng per 8-NPU tray (16 per 64-NPU cabinet)
    expect(big.cpus).toBe(12500);
    expect(big.scaleOutPorts).toBe(100000);
    expect(big.ubSwitches).toBe(big.rackSwitches + big.podSwitches);
    const a3 = computeCounts(withSize(topologyScenario('a3-ub384', 1000), 50000));
    expect(a3.ubSwitches).toBe(a3.l1Switches + a3.l2Switches);
  });

  it('v4.2 Atlas 950 as shipped: 16 + 4 cabinets, cabinet mesh with 72 LRS, 2 × 800G per NPU into 16 pod switches, 4,096 modules', () => {
    const k = computeCounts(topologyScenario('a950-ub2', 1024, { mechanisms: [] }));
    expect([k.supernodes, k.racks, k.commRacks, k.cpus]).toEqual([1, 16, 4, 256]);
    expect(k.fabric).toBe('mesh-clos');
    expect(k.rackSwitches).toBe(16 * 72);
    expect(k.meshLinks).toBe(16 * 448); // 8 trays × C(8,2) + 8 × C(8,2) per cabinet
    expect(k.podSwitches).toBe(16); // 4 per interconnect cabinet
    expect(k.opticalLinks).toBe(2048);
    expect(k.transceivers).toBe(4096); // LightCounting: 4,096 × 800G incl. the switch side
    expect([k.l1Switches, k.l2Switches]).toEqual([0, 0]);
  });

  it('v4.2 Atlas 950 roadmap pod and the UB-Mesh paper variant at 8,192 NPUs', () => {
    const p8 = { ...SUPERPOD_PRESETS['atlas950-8k'].values };
    const k = computeCounts(topologyScenario('a950-ub2', 8192, { mechanisms: [], topology: { superpod: p8 } }));
    expect([k.racks, k.commRacks, k.rackSwitches, k.podSwitches, k.transceivers]).toEqual([128, 32, 9216, 128, 32768]); // Hot Chips 2025: 128 × 100T switches
    const d = computeCounts(topologyScenario('a950-ub2', 8192, { mechanisms: [], topology: { superpod: { ...p8, fabric: 'mesh-4d', podUplinksPerNpu: 0.5, podSwitchRadix: 64 } } }));
    expect(d.podSwitches).toBe(64); // x4 lanes per NPU into x512 HRS
    expect(d.rackMeshLinks).toBe(8 * 48); // 8 pods of 4 × 4 cabinets, 6 links per cabinet
    expect(d.opticalLinks).toBe(4096);
    // the SuperCluster: 64 roadmap pods = 524,288 NPUs = 128³ / 4, three tiers per scale-out plane at radix 128
    const sc = computeCounts(topologyScenario('a950-ub2', 524288, { mechanisms: [], topology: { superpod: p8 } }));
    expect(sc.supernodes).toBe(64);
    expect(sc.scaleOutTiers).toBe(3);
    expect(sc.scaleOutSwitches).toBe(2 * (8192 + 8192 + 4096));
  });

  it('v4.2 Atlas 960E: 56 + 14 cabinets of 72 NPUs, 126 LinkDevices per pod, NPO engines, four-plane two-tier scale-out to 500k', () => {
    const k = computeCounts(topologyScenario('a960e-ub', 4032, { mechanisms: [] }));
    expect([k.supernodes, k.racks, k.commRacks, k.cpus]).toEqual([1, 56, 14, 1008]);
    expect(k.podSwitches).toBe(126); // 4,032 × 5.5 / 176 → 9 per interconnect cabinet
    expect(k.opticalEngines).toBe(Math.ceil((4032 * 5500) / 4096));
    expect(k.meshLinks).toBe(0);
    expect(k.transceivers).toBe(0); // NPO, no pluggable modules
    const big = computeCounts(topologyScenario('a960e-ub', 500000, { mechanisms: [] }));
    expect(big.supernodes).toBe(125);
    expect(big.scaleOutTiers).toBe(2);
    expect(big.scaleOutPerTier.length).toBe(2);
    expect(big.scaleOutPorts).toBe(4 * 500000);
  });

  it('v4.2 SuperPoD variants: the selector round-trips and each variant gives its source counts', () => {
    const s = topologyScenario('a950-ub2', 8192, { mechanisms: [] });
    expect(superpodVariantOf(s)).toBe('a950-1k');
    const want: Record<string, [number, number]> = { 'a950-1k': [16 * 72 * 8, 128], 'a950-8k': [9216, 128], 'a950-4d': [9216, 64], 'a950-2l': [0, 0] };
    for (const v of SUPERPOD_VARIANTS['a950-ub2']!) {
      const x = applySuperpodVariant(s, v.id);
      expect(superpodVariantOf(x)).toBe(v.id);
      const k = computeCounts(x);
      expect([k.rackSwitches, k.podSwitches]).toEqual(want[v.id]);
      expect(x.topology.nvlinkDomainGpus).toBe(x.topology.superpod!.npusPerNode * x.topology.superpod!.nodesPerRack * x.topology.superpod!.computeRacks);
      // at a size that is not a whole pod the pod count, the interconnect cabinets and the optical links follow the variant's geometry
      const k10 = computeCounts(applySuperpodVariant(topologyScenario('a950-ub2', 10000, { mechanisms: [] }), v.id));
      const pod = x.topology.superpod!.npusPerNode * x.topology.superpod!.nodesPerRack * x.topology.superpod!.computeRacks;
      expect(k10.supernodes).toBe(Math.ceil(10000 / pod));
      expect(k10.opticalLinks).toBe(v.id === 'a950-2l' ? Math.ceil(10000 / 8) * 7 * 16 : 10000 * x.topology.superpod!.podUplinksPerNpu);
    }
    const two = computeCounts(applySuperpodVariant(s, 'a950-2l'));
    expect(two.l1Switches).toBe(8 * 128 * 7);
    expect(superpodVariantOf({ ...s, topology: { ...s.topology, superpod: { ...s.topology.superpod!, rackSwitches: 70 } } })).toBeUndefined();
  });

  it('v4.2 NPO fields belong to blade-clos: switching the fabric never inherits them', () => {
    const e = topologyScenario('a960e-ub', 4032, { mechanisms: [] });
    const asMesh = { ...e, topology: { ...e.topology, superpod: { ...e.topology.superpod!, fabric: 'mesh-clos' as const, podUplinksPerNpu: 2, transceiversPerLink: 2 } } };
    const k = computeCounts(asMesh);
    expect([k.opticalLinks, k.opticalEngines, k.transceivers]).toEqual([8064, 0, 16128]);
    const a = topologyScenario('a950-ub2', 1024, { mechanisms: [] });
    const asBlade = computeCounts({ ...a, topology: { ...a.topology, superpod: { ...a.topology.superpod!, fabric: 'blade-clos' as const } } });
    expect(asBlade.transceivers).toBe(0); // NPO: no pluggable modules
    const rows = topologyBom(e).rows;
    expect(rows.find((r) => r.id === 'pod')!.confidence).toBe('assumed'); // 4,032 is the media split, the vendor figure is 4,096
    expect(rows.find((r) => r.id === 'npoEngine')!.confidence).toBe('derived');
    expect(rows.find((r) => r.id === 'rocePort')!.confidence).toBe('assumed');
    expect(topologyBom(a).rows.find((r) => r.id === 'rocePort')!.confidence).toBe('vendor'); // 2 × 400G UBoE per chip (white paper)
  });

  it('v4.2 switching the UB fabric applies its reference geometry; scale-out units on the UB templates read UBoE / RoCE', () => {
    const a3 = topologyScenario('a3-ub384', 10000, { mechanisms: [] });
    for (const f of ['mesh-clos', 'mesh-4d', 'blade-clos'] as const) {
      const k = computeCounts({ ...a3, topology: { ...a3.topology, superpod: withFabric(a3.topology.superpod!, f) } });
      expect(k.rackSwitches).toBeGreaterThan(0);
      expect(k.podSwitches).toBeGreaterThan(0);
      expect(k.opticalLinks).toBeGreaterThan(0);
    }
    // 32-NPU CloudMatrix384 cabinets get 72 × 32 / 64 = 36 LRS; back to two-level keeps the paper geometry
    expect(withFabric(a3.topology.superpod!, 'mesh-clos').rackSwitches).toBe(36);
    expect(withFabric(withFabric(a3.topology.superpod!, 'mesh-clos'), 'two-level').l2PerSubPlane).toBe(16);
    const a950 = topologyScenario('a950-ub2', 10000, { mechanisms: [] });
    expect(JSON.stringify(a950.components.find((c) => c.id.endsWith('@roce'))!.name)).toMatch(/"en":"UBoE \/ RoCE/);
    expect(faultUnitName('roce-switch', 'a2-roce').en).toMatch(/^RoCE/);
  });

  it('v4.3 a user count replaces one row everywhere (evaluator, bill of materials, picture counts) and scales with N', () => {
    const base = topologyScenario('a950-ub2', 10000);
    const s = { ...base, topology: { ...base.topology, countOverrides: { ubPodSwitch: { count: 200, npus: 10000 } } } };
    const g = computeCounts(base);
    const k = computeCounts(s);
    expect([g.podSwitches, k.podSwitches]).toEqual([157, 200]);
    expect(k.ubSwitches).toBe(k.rackSwitches + 200);
    expect([k.commRacks, k.opticalLinks, k.rackSwitches]).toEqual([g.commRacks, g.opticalLinks, g.rackSwitches]); // nothing else moves
    const b = topologyBom(s);
    const row = b.rows.find((r) => r.id === 'ubPodSwitch')!;
    expect([row.count, row.geometryCount, row.confidence]).toEqual([200, 157, 'user']);
    expect(b.notes.some((n) => n.startsWith('user count ubPodSwitch: 200 (geometry 157'))).toBe(true);
    // the evaluator reads the same counts: its hardware interruption rate equals the table's
    const ev = (x: Parameters<typeof evaluateScenario>[0]) => evaluateScenario(x, { structure: false }).training!.subhealth!.hardwareInterruptionsPerHour;
    expect(ev(s)).toBeCloseTo(b.hardPerHour, 12);
    expect(ev(s) - ev(base)).toBeCloseTo((43 * 400) / 7 / 1e9, 15); // 43 more switches × 57.14 FIT
    // per-NPU ratio kept at the other sizes; resizing keeps the override
    expect(computeCounts(withSize(s, 100000)).podSwitches).toBe(2000);
    expect(bomAtSizes(s).map((x) => x.bom.rows.find((r) => r.id === 'ubPodSwitch')!.count)).toEqual([200, 2000, 4000, 10000]);
    expect(resizeTopology(s, 500000).topology.countOverrides).toEqual({ ubPodSwitch: { count: 200, npus: 10000 } });
    // the scenario file keeps it
    expect(parseScenario(JSON.parse(JSON.stringify(s))).topology.countOverrides).toEqual(s.topology.countOverrides);
  });

  it('v4.3 overrides that do not apply are ignored and noted; tiers apply only where they exist', () => {
    const a950 = topologyScenario('a950-ub2', 10000, { mechanisms: [] });
    const x = { ...a950, topology: { ...a950.topology, countOverrides: { ubL1: { count: 999, npus: 10000 }, bogus: { count: 1, npus: 1 } } } };
    expect(computeCounts(x)).toEqual(computeCounts(a950));
    const notes = topologyBom(x).notes.join(' | ');
    expect(notes).toMatch(/user count ubL1 ignored: no such unit in this topology \(fabric mesh-clos\)/);
    expect(notes).toMatch(/user count bogus ignored: not an overridable row/);
    const a2 = topologyScenario('a2-roce', 10000, { mechanisms: [] });
    const t4 = { ...a2, topology: { ...a2.topology, countOverrides: { roceTier4: { count: 10, npus: 10000 } } } };
    expect(computeCounts(t4).scaleOutTiers).toBe(3);
    expect(computeCounts(t4).scaleOutSwitches).toBe(computeCounts(a2).scaleOutSwitches);
    const big = computeCounts(withSize(t4, 100000));
    expect(big.scaleOutPerTier[3]).toBe(100);
    expect(big.scaleOutSwitches).toBe(3125 * 3 + 100);
    expect(topologyBom(a2).rows.filter((r) => r.overridable).map((r) => r.id)).toEqual(['node', 'cpu', 'cabinet', 'rocePort', 'roceTier1', 'roceTier2', 'roceTier3', 'roceLink', 'roceTransceiver']);
  });

  it('v4.3 a component counted outside the template units still enters the table rate, as in the evaluator', () => {
    const s0 = topologyScenario('a3-ub384', 10000, { mechanisms: [] });
    const id = s0.components.find((c) => c.id === 'POWER-hard')!.id;
    // the scenario editor sets the cabinet power class to a fixed count of 100 (seeded with its current units there)
    const s = { ...s0, components: s0.components.map((c) => (c.id === id ? { ...c, countRule: { per: 'fixed' as const, count: 100 } } : c)) };
    const b = topologyBom(s);
    const other = b.rows.find((r) => r.id === 'otherComponents')!;
    expect(other.noCount).toBe(true); // a rate-only row: its classes may count different kinds of units
    const power = s0.components.find((c) => c.id === id)!;
    expect(other.hardPerHour).toBeCloseTo((100 * power.failure.value) / 1e9, 15);
    expect(b.hardFitPerNpuOther).toBeCloseTo((other.hardPerHour! / 10000) * 1e9, 9);
    expect(Object.values(b.hardFitPerNpu).reduce((a, v) => a + v!, 0) + b.hardFitPerNpuOther).toBeCloseTo(b.hardFitPerNpuTotal, 9);
    expect(b.hardPerHour).toBeCloseTo(evaluateScenario(s, { structure: false }).training!.subhealth!.hardwareInterruptionsPerHour, 12);
    // the new scopes count the mesh / blade units
    const e = topologyScenario('a960e-ub', 4032, { mechanisms: [] });
    const k = computeCounts(e);
    const mk = (per: 'rack_switch' | 'pod_switch' | 'npo_engine') => componentInstances({ ...e.components[0], countRule: { per, factor: 1 } }, k).total;
    expect([mk('rack_switch'), mk('pod_switch'), mk('npo_engine')]).toEqual([k.rackSwitches, k.podSwitches, k.opticalEngines]);
    expect(COUNT_RULE_PERS).toEqual(expect.arrayContaining(['cpu', 'ub_switch', 'roce_port', 'roce_switch', 'roce_link', 'rack_switch', 'pod_switch', 'npo_engine', 'fixed']));
    expect(COUNT_RULE_PERS.length).toBe(20);
  });

  it('v4.3 review fixes: zero counts keep their row, tier roles, variant changes, spares, Monte Carlo units', () => {
    // a user count of 0 keeps the row (and its reset) at every size
    const a3 = topologyScenario('a3-ub384', 10000, { mechanisms: [] });
    const z = { ...a3, topology: { ...a3.topology, countOverrides: { cpu: { count: 0, npus: 10000 } } } };
    const zr = topologyBom(z).rows.find((r) => r.id === 'cpu')!;
    expect([zr.count, zr.confidence]).toEqual([0, 'user']);
    expect(bomAtSizes(z).every((x) => x.bom.rows.some((r) => r.id === 'cpu'))).toBe(true);
    // a top-tier override entered with 3 tiers stays on the top tier where the Clos has 4
    const a2 = topologyScenario('a2-roce', 10000, { mechanisms: [] });
    const top = { ...a2, topology: { ...a2.topology, countOverrides: { roceTier3: { count: 200, npus: 10000, tiers: 3 } } } };
    expect(computeCounts(top).scaleOutPerTier).toEqual([313, 313, 200]);
    const big = computeCounts(withSize(top, 100000));
    expect(big.scaleOutPerTier).toEqual([3125, 3125, 3125, 2000]);
    expect(topologyBom(withSize(top, 100000)).rows.find((r) => r.id === 'roceTier4')!.confidence).toBe('user');
    // without the recorded tier count the tier is taken by index (the goldens' rule)
    expect(computeCounts(withSize({ ...a2, topology: { ...a2.topology, countOverrides: { roceTier3: { count: 200, npus: 10000 } } } }, 100000)).scaleOutPerTier[2]).toBe(2000);
    // a SuperPoD variant change drops the counts of SuperPoD rows (they belonged to other devices) and keeps the rest
    const a950 = topologyScenario('a950-ub2', 10000, { mechanisms: [] });
    const withO = { ...a950, topology: { ...a950.topology, countOverrides: { ubPodSwitch: { count: 2000, npus: 10000 }, node: { count: 2500, npus: 10000 } } } };
    expect(applySuperpodVariant(withO, 'a950-4d').topology.countOverrides).toEqual({ node: { count: 2500, npus: 10000 } });
    // the Qingtian card follows the geometry node count
    const q = { ...a3, topology: { ...a3.topology, countOverrides: { node: { count: 2500, npus: 10000 } } } };
    expect(topologyBom(q).rows.find((r) => r.id === 'qingtian')!.count).toBe(1250);
    // spares: more nodes, more spare demand (the per-node rate and the node count come from the same count)
    const sp = (x: Parameters<typeof evaluateScenario>[0]) => evaluateScenario(x).spares!;
    expect(sp(q).nodes).toBe(2500);
    expect(sp(q).nodes * sp(q).nodeLambdaPerHour).toBeGreaterThan(sp(a3).nodes * sp(a3).nodeLambdaPerHour);
    expect(sp(a3).nodes).toBe(1250);
    // Monte Carlo builds exactly the closed form's units for a node count that is not a multiple of the geometry
    const spec = mcSpecFromScenario(q, 300);
    const ddr = spec.classes.find((c) => c.id === 'DDR-hard')!;
    expect(ddr.count).toBe(2500);
  });

  it('v4.2 multi-plane scale-out = planes × one plane', () => {
    const one = closCounts(250000, 128, 1, 2);
    const two = scaleOutCounts(250000, { portsPerNpu: 2, planes: 2, radix: 128, oversubscription: 1, transceiversPerLink: 2 });
    expect(two.switches).toBe(2 * one.switches);
    expect(two.links).toBe(2 * one.links);
    expect(two.tiers).toBe(one.tiers);
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
