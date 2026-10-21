/**
 * Atlas 950 SuperPoD (Huawei's native 1,024-NPU design) and SuperPoD Flex / UBL128 (the 128-NPU single-layer UB switching scheme
 * Huawei and DeepSeek defined jointly) at the built-in 10k / 100k / 200k / 500k NPUs, for docs/ASCEND950_SCALING_RELIABILITY.{zh,en}.html:
 *  - bill of materials per architecture and size (HAC-D topologyBom on the a950-ub2 template; UBL128 = the same template with a
 *    2-cabinet pod, no in-cabinet LRS, 4 × 800G per NPU into 4 radix-128 switches, one switch cabinet per 4 pods, tray mesh only —
 *    every UBL128 value beyond "128 NPUs, 3.2 Tb/s, single-layer switch, two-tier scale-out" is an assumption);
 *  - reliability with the six default mechanisms: A_op, MTBF and MTTR of the hardware interruptions from the engine, the other event
 *    classes (isolation of sub-healthy units, detected silent corruption) kept apart, rate and downtime by hardware unit and by
 *    catalog domain, the share of each unit's events that ends in global recovery;
 *  - what one SuperPoD, compute cabinet, node and NPU contain (mapping tables) with the hard FIT of each level;
 *  - sensitivities: scale-out designs (planes, tiers, radix, oversubscription) and UBL128 with the 72 LRS of the Atlas 950 cabinet kept;
 *  - the MTBF and FIT per NPU each size needs for A_op 98.5 % and 99 % at today's MTTR, and the checkpoint regime;
 *  - the attached report's 512,000-NPU bill of materials recomputed with the same geometry (cross-check).
 * Usage: node --import tsx scripts/ascend950-scaling.ts [--out docs/ascend950-scaling/results.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyBom, TOPOLOGY_SCALES } from '../packages/core/src/topology/index.js';
import { ARCHS, SO, scenarioOf, type ArchId } from './ascend950-archs.js';
import { scaleOutCounts, computeCounts } from '../packages/core/src/scenario/build.js';
import { mechanismById, DEFAULT_PLAYERS, applyMechanisms } from '../packages/core/src/mechanisms/index.js';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { tr, kpi, breakdown, crossing as crossingOf } from './scaling-common.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/ascend950-scaling/results.json';
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

/* ---------------- per-size result ---------------- */
const HBM_GB = 96; // product page: 96 GB per 950DT in the 1,024-NPU configuration
const CABINET_KW = 100; // product page: ≈ 100 kW per compute cabinet (interconnect cabinets not stated)
const SWITCHES_PER_RACK = 2; // assumption: a radix-1,024 scale-out switch is a chassis of about half a rack (form factor not published)
function sizeResult(arch: ArchId, n: number) {
  const sc = scenarioOf(arch, n);
  const t = tr(sc);
  const k = kpi(sc, t);
  const bom = topologyBom(sc);
  const b = breakdown(sc, t);
  const c = bom.counts;
  const required = [0.985, 0.99].map((target) => {
    const B = 3600 * ((1 - k.phi) / target - 1) - k.F;
    const mtbfReqH = B > 0 ? k.mttrS / B : null;
    return { target, B, mtbfReqH, mttrReqS: B > 0 ? B * k.mtbfHwH : null, fitPerNpuBudget: mtbfReqH ? 1e9 / (mtbfReqH * n) : null, mtbfFactor: mtbfReqH ? mtbfReqH / k.mtbfHwH : null, feasibleToday: k.aOp >= target };
  });
  const tau = sc.workload.type === 'training' ? sc.workload.intervalS ?? 0 : 0;
  const delta = sc.workload.type === 'training' ? sc.workload.deltaS : 0;
  const M = k.mtbiH * 3600;
  return {
    npus: n,
    rows: bom.rows.map((r) => ({ id: r.id, name: r.name, level: r.level, count: r.count, perNpu: r.perNpu, faultUnit: r.faultUnit ?? null, fitPerUnit: r.fit?.hard ?? null, hardPerHour: r.hardPerHour ?? null, blastRadiusNpus: r.blastRadiusNpus ?? null, confidence: r.confidence, geometryCount: r.geometryCount ?? null })),
    counts: c,
    hardFitPerNpu: bom.hardFitPerNpu,
    hardFitPerNpuTotal: bom.hardFitPerNpuTotal,
    hardPerHourBom: bom.hardPerHour,
    notes: bom.notes,
    derived: { hbmTB: (n * HBM_GB) / 1000, computeCabinetMW: (c.racks * CABINET_KW) / 1000, podsOf8k: Math.ceil(n / 8192), scaleOutRacks: Math.ceil(c.scaleOutSwitches / SWITCHES_PER_RACK), racksTotal: c.racks + c.commRacks + Math.ceil(c.scaleOutSwitches / SWITCHES_PER_RACK) },
    kpi: k,
    breakdown: b,
    required,
    regime: { tauS: tau, deltaS: delta, mtbiS: M, tauRatio: (tau + delta) / M, recoveryRatio: k.mttrS / M, globalRatio: k.globalS / M },
  };
}

/* ---------------- mapping: what one SuperPoD, cabinet, node and NPU contain (from an 8,192-NPU build: whole pods of both) ---------------- */
function mapping(arch: ArchId) {
  const n = 8192;
  const sc = scenarioOf(arch, n);
  const bom = topologyBom(sc);
  const c = bom.counts;
  const pods = c.supernodes, racks = c.racks, nodes = c.nodes;
  const so = scaleOutCounts(n, SO.main.so);
  const row = (id: string) => bom.rows.find((r) => r.id === id);
  const fitOf = (id: string) => row(id)?.fit?.hard ?? 0;
  const per = (count: number) => ({ total: count, perPod: count / pods, perRack: count / racks, perNode: count / nodes, perNpu: count / n });
  const items = {
    computeRack: per(c.racks), networkRack: per(c.commRacks), node: per(c.nodes), npu: per(n), cpu: per(c.cpus), qingtian: per(row('qingtian')?.count ?? 0),
    lrs: per(c.rackSwitches), podSwitch: per(c.podSwitches), meshLink: per(c.meshLinks), opticalLink: per(c.opticalLinks), transceiver: per(c.transceivers),
    soPort: per(so.ports), soLeaf: per(so.perTier[0]), soSpine: per(so.perTier[so.perTier.length - 1]), soLink: per(so.links), soTransceiver: per(so.transceivers),
    hbmGB: per(n * HBM_GB), cabinetKW: per(c.racks * CABINET_KW),
  };
  const fit = { npu: fitOf('npu'), node: fitOf('node'), cpu: fitOf('cpu'), cabinet: fitOf('cabinet'), ubSwitch: fitOf('ubPodSwitch') || fitOf('ubRackSwitch'), ubLink: fitOf('ubLink'), job: fitOf('job'), soSwitch: fitOf('roceTier1'), soLink: fitOf('roceLink') };
  // hard FIT contained at each level (job-level services and scale-out are cluster-level and listed apart)
  const npuL = fit.npu;
  const nodeL = 8 * fit.npu + fit.node + items.cpu.perNode * fit.cpu;
  const rackL = items.node.perRack * nodeL + fit.cabinet + items.lrs.perRack * fit.ubSwitch + items.opticalLink.perRack * fit.ubLink;
  const podL = items.computeRack.perPod * rackL + items.podSwitch.perPod * fit.ubSwitch;
  const levels = [
    { id: 'npu', npus: 1, fit: npuL }, { id: 'node', npus: 8, fit: nodeL }, { id: 'rack', npus: n / racks, fit: rackL }, { id: 'pod', npus: n / pods, fit: podL },
  ].map((x) => ({ ...x, mtbfH: 1e9 / x.fit, fitPerNpu: x.fit / x.npus }));
  const cluster = { jobPerNpu: fit.job, scaleOutPerNpu: (so.switches * fit.soSwitch + so.links * fit.soLink) / n };
  return { npus: n, pods, items, fit, levels, cluster, scaleOut: { tiers: so.tiers, perTier: so.perTier } };
}

/* ---------------- sensitivities ---------------- */
function scaleOutSensitivity() {
  const out: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(SO)) {
    out[id] = {
      name: v.name, basis: v.basis, so: v.so,
      sizes: Object.fromEntries(TOPOLOGY_SCALES.map((n) => {
        const c = scaleOutCounts(n, v.so);
        const res: Record<string, unknown> = { tiers: c.tiers, perTier: c.perTier, switches: c.switches, links: c.links, transceivers: c.transceivers, capacityPerPlane: c.capacity / Math.max(1, v.so.planes ?? 1), portsPerPlane: c.ports / Math.max(1, v.so.planes ?? 1) };
        for (const arch of ['native', 'ubl128'] as ArchId[]) {
          const sc = scenarioOf(arch, n, v.so);
          const bom = topologyBom(sc);
          const k = kpi(sc);
          res[arch] = { soFitPerNpu: (bom.hardFitPerNpu['roce-switch'] ?? 0) + (bom.hardFitPerNpu['roce-link'] ?? 0), totalFitPerNpu: bom.hardFitPerNpuTotal, aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS };
        }
        return [n, res];
      })),
    };
  }
  return out;
}
function ubl128LrsSensitivity() {
  return Object.fromEntries(TOPOLOGY_SCALES.map((n) => {
    const sc = scenarioOf('ubl128', n, SO.main.so, { rackSwitches: 72 }, ['ubMeshLink']);
    const bom = topologyBom(sc);
    const k = kpi(sc);
    return [n, { ubFitPerNpu: (bom.hardFitPerNpu['ub-switch'] ?? 0) + (bom.hardFitPerNpu['ub-link'] ?? 0), totalFitPerNpu: bom.hardFitPerNpuTotal, rackSwitches: bom.counts.rackSwitches, meshLinks: bom.counts.meshLinks, aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS }];
  }));
}

/* ---------------- the attached report's 512,000-NPU table recomputed ---------------- */
function crossCheck512k() {
  const out: Record<string, unknown> = {};
  for (const n of [512000, 524288]) {
    const r: Record<string, unknown> = {};
    for (const arch of ['native', 'ubl128'] as ArchId[]) {
      const c = computeCounts(scenarioOf(arch, n));
      r[arch] = { pods: c.supernodes, racks: c.racks, commRacks: c.commRacks, nodes: c.nodes, cpus: c.cpus, rackSwitches: c.rackSwitches, podSwitches: c.podSwitches, opticalLinks: c.opticalLinks, transceivers: c.transceivers };
    }
    for (const [id, v] of Object.entries(SO)) {
      const c = scaleOutCounts(n, v.so);
      r[`so:${id}`] = { tiers: c.tiers, perTier: c.perTier, switches: c.switches, links: c.links, transceivers: c.transceivers };
    }
    out[n] = r;
  }
  // what the attachments list for architecture 1 (Huawei native) and 2 (DeepSeek UBL128) at 512,000 NPUs
  out.attachment = {
    native: { pods: 500, computeRacks: 8000, ubCabinets: 2000, leaf: 16000, leafPorts: 64, spine: 4000, spinePorts: 128, core: 0, switches: 20000, optics800G: 2048000, scaleUpOptics: 1024000, racksTotal: 10240, powerMW: '850–900' },
    ubl128: { pods: 4000, computeRacks: 8000, ubCabinets: 1000, leaf: 16000, leafPorts: 64, spine: 4000, spinePorts: 128, core: 0, switches: 20000, optics800G: 2048000, scaleUpOptics: 512000, racksTotal: 9200, powerMW: '820–880' },
  };
  return out;
}

/* ---------------- the scale at which a design falls below a level (bisection on N; A_op and MTBF decrease with N) ---------------- */
function crossing(arch: ArchId, f: (k: ReturnType<typeof kpi>) => number, level: number): number {
  return crossingOf((n) => f(kpi(scenarioOf(arch, n))), level);
}
function thresholds(arch: ArchId) {
  return { aOp99: crossing(arch, (k) => k.aOp, 0.99), aOp985: crossing(arch, (k) => k.aOp, 0.985), aOp98: crossing(arch, (k) => k.aOp, 0.98), mtbf1h: crossing(arch, (k) => k.mtbfHwH, 1), mtbf2h: crossing(arch, (k) => k.mtbfHwH, 2) };
}

/* ---------------- run ---------------- */
const archs: Record<string, unknown> = {};
for (const arch of ['native', 'ubl128'] as ArchId[]) {
  const sizes: Record<number, unknown> = {};
  for (const n of TOPOLOGY_SCALES) {
    const r = sizeResult(arch, n);
    sizes[n] = r;
    log(`${arch} ${n}: pods ${r.counts.supernodes}, racks ${r.counts.racks} + ${r.counts.commRacks}, UB sw ${r.counts.rackSwitches} + ${r.counts.podSwitches}, links ${r.counts.opticalLinks}, SO sw ${r.counts.scaleOutSwitches} (${r.counts.scaleOutTiers} tiers) | FIT/NPU ${r.hardFitPerNpuTotal.toFixed(1)} | A_op ${(r.kpi.aOp * 100).toFixed(3)} % MTBF ${r.kpi.mtbfHwH.toFixed(3)} h MTTR ${r.kpi.mttrS.toFixed(1)} s`);
  }
  archs[arch] = { name: ARCHS[arch].name, short: ARCHS[arch].short, superpod: { ...ARCHS[arch].superpod }, overrides: ARCHS[arch].overrides ?? null, assumed: ARCHS[arch].assumed, sizes, mapping: mapping(arch), thresholds: thresholds(arch) };
  log(`${arch} thresholds ${JSON.stringify((archs[arch] as { thresholds: unknown }).thresholds)}`);
}
const s0 = scenarioOf('native', TOPOLOGY_SCALES[0]);
const mechanisms = DEFAULT_PLAYERS.map((id) => { const m = mechanismById(id); return { id, name: m.name, kind: m.kind, change: m.change, parameters: m.parameters }; });
const out = {
  generated: new Date().toISOString(),
  sizes: TOPOLOGY_SCALES,
  mechanisms,
  baseline: { recovery: s0.recovery, workload: s0.workload, sdc: s0.sdc },
  scaleOut: Object.fromEntries(Object.entries(SO).map(([k, v]) => [k, { name: v.name, basis: v.basis, so: v.so }])),
  archs,
  sensitivity: { scaleOut: scaleOutSensitivity(), ubl128Lrs: ubl128LrsSensitivity() },
  // the two repositories' arithmetic: the 54-event catalog per card (no topology conversion) with the same six mechanisms
  repoPerCard: Object.fromEntries(TOPOLOGY_SCALES.map((n) => { const k = kpi(applyMechanisms(referenceCatalog(n), DEFAULT_PLAYERS)); return [n, { aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS, delivered: k.delivered, hardFitPerNpu: (k.lamHw / n) * 1e9 }]; })),
  // A_op and MTBF over N (log-spaced 5,000 … 600,000) for the chart
  curve: Object.fromEntries((['native', 'ubl128'] as ArchId[]).map((arch) => [arch, Array.from({ length: 31 }, (_, i) => Math.round(5000 * Math.pow(600000 / 5000, i / 30))).map((n) => { const k = kpi(scenarioOf(arch, n)); return { n, aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS }; })])),
  crossCheck512k: crossCheck512k(),
  constants: { hbmGBPerNpu: HBM_GB, computeCabinetKW: CABINET_KW, scaleOutSwitchesPerRack: SWITCHES_PER_RACK },
};
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
