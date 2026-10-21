/**
 * Ascend 910C in its two deployment forms — the Atlas 900 A3 SuperPoD / CloudMatrix384 (384-NPU UB domain) and Atlas 800T A3 servers
 * (8-NPU UB domain) on RoCE — at the built-in 10k / 100k / 200k / 500k NPUs, for docs/ASCEND910C_SCALING_RELIABILITY.{zh,en}.html:
 *  - bill of materials per architecture and size (HAC-D topologyBom on the a3-ub384 template; 800T A3 = the same node board used
 *    stand-alone: no L2 tier, no UB optics, no communication cabinets);
 *  - reliability with the six default mechanisms: A_op, MTBF and MTTR of the hardware interruptions, the other event classes kept
 *    apart, rate and downtime by hardware unit and by catalog domain, where each unit's interruptions end on the mechanism chain;
 *  - what one UB domain (CM384 pod or 800T A3 server), compute cabinet, node and NPU contain (mapping tables) with the hard FIT of each level;
 *  - sensitivities: scale-out designs, two servers per cabinet for the air-cooled 800T A3, and the CM384 without scale-out network
 *    (= the repositories' per-card catalog);
 *  - the MTBF and FIT per NPU each size needs for A_op 98.5 % and 99 % at today's MTTR, and the checkpoint regime;
 *  - cross-checks: the model's per-pod counts against the paper and press, the other "950 与 910C" report's 910C column.
 * Usage: node --import tsx scripts/ascend910c-scaling.ts [--out docs/ascend910c-scaling/results.json]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { topologyBom, TOPOLOGY_SCALES } from '../packages/core/src/topology/index.js';
import { ARCHS, SO, scenarioOf, type ArchId } from './ascend910c-archs.js';
import { scaleOutCounts, computeCounts } from '../packages/core/src/scenario/build.js';
import { mechanismById, DEFAULT_PLAYERS, applyMechanisms } from '../packages/core/src/mechanisms/index.js';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { tr, kpi, breakdown, crossing as crossingOf } from './scaling-common.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/ascend910c-scaling/results.json';
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const ARCH_IDS: ArchId[] = ['cm384', 'a3server'];

/* ---------------- per-size result ---------------- */
const HBM_GB = 128; // 910C: 2 dies, 8 HBM stacks, 128 GB per NPU (Atlas 800 A3: 8 NPUs × 128 GB)
const SWITCHES_PER_RACK = 16; // assumption: 64-port scale-out switches are 1–2U boxes, about 16 per network rack with cabling
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
  const scaleOutRacks = Math.ceil(c.scaleOutSwitches / SWITCHES_PER_RACK);
  return {
    npus: n,
    rows: bom.rows.map((r) => ({ id: r.id, name: r.name, level: r.level, count: r.count, perNpu: r.perNpu, faultUnit: r.faultUnit ?? null, fitPerUnit: r.fit?.hard ?? null, hardPerHour: r.hardPerHour ?? null, blastRadiusNpus: r.blastRadiusNpus ?? null, confidence: r.confidence, geometryCount: r.geometryCount ?? null })),
    counts: c,
    hardFitPerNpu: bom.hardFitPerNpu,
    hardFitPerNpuTotal: bom.hardFitPerNpuTotal,
    hardPerHourBom: bom.hardPerHour,
    notes: bom.notes,
    derived: { hbmTB: (n * HBM_GB) / 1000, ubDomains: Math.ceil(n / ARCHS[arch].domainNpus), qingtian: c.nodes, scaleOutRacks, racksTotal: c.racks + c.commRacks + scaleOutRacks },
    kpi: k,
    breakdown: b,
    required,
    regime: { tauS: tau, deltaS: delta, mtbiS: M, tauRatio: (tau + delta) / M, recoveryRatio: k.mttrS / M, globalRatio: k.globalS / M },
  };
}

/* ---------------- mapping: what one UB domain, cabinet, node and NPU contain ---------------- */
// UB-side counts from a 3,072-NPU build (8 whole CM384 pods; 384 servers = 96 cabinets); scale-out shares at 500k (4 tiers at radix 64)
function mapping(arch: ArchId) {
  const n = 3072;
  const sc = scenarioOf(arch, n);
  const bom = topologyBom(sc);
  const c = bom.counts;
  const dom = ARCHS[arch].domainNpus;
  const domains = n / dom, racks = c.racks, nodes = c.nodes;
  const N5 = 500000;
  const so = scaleOutCounts(N5, SO.main.so);
  const row = (id: string) => bom.rows.find((r) => r.id === id);
  const fitOf = (id: string) => row(id)?.fit?.hard ?? 0;
  const per = (count: number) => ({ total: count, perDomain: count / domains, perRack: count / racks, perNode: count / nodes, perNpu: count / n });
  const perSo = (count: number) => { const x = count / N5; return { total: count, perDomain: x * dom, perRack: x * (n / racks), perNode: x * (n / nodes), perNpu: x }; };
  const items = {
    computeRack: per(c.racks), networkRack: per(c.commRacks), node: per(c.nodes), npu: per(n), cpu: per(c.cpus), qingtian: per(row('qingtian')?.count ?? c.nodes),
    l1: per(c.l1Switches), l2: per(c.l2Switches), opticalLink: per(c.opticalLinks), transceiver: per(c.transceivers),
    soPort: perSo(so.ports), soLeaf: perSo(so.perTier[0]), soTop: perSo(so.perTier[so.perTier.length - 1]), soSwitch: perSo(so.switches), soLink: perSo(so.links), soTransceiver: perSo(so.transceivers),
    hbmGB: per(n * HBM_GB),
  };
  const ubSwitchFit = fitOf('ubL1') || fitOf('ubL2');
  const fit = { npu: fitOf('npu'), node: fitOf('node'), cpu: fitOf('cpu'), cabinet: fitOf('cabinet'), ubSwitch: ubSwitchFit, ubLink: fitOf('ubLink'), job: fitOf('job'), soSwitch: fitOf('roceTier1'), soLink: fitOf('roceLink') };
  // hard FIT contained at each level (job-level services and scale-out are cluster-level and listed apart)
  const npuL = fit.npu;
  const nodeL = 8 * fit.npu + fit.node + items.cpu.perNode * fit.cpu + items.l1.perNode * fit.ubSwitch;
  const rackL = items.node.perRack * nodeL + fit.cabinet + items.opticalLink.perRack * fit.ubLink;
  const domL = dom === 8 ? nodeL : items.computeRack.perDomain * rackL + items.l2.perDomain * fit.ubSwitch;
  const levels = [
    { id: 'npu', npus: 1, fit: npuL }, { id: 'node', npus: 8, fit: nodeL }, { id: 'rack', npus: n / racks, fit: rackL }, { id: 'domain', npus: dom, fit: domL },
  ].map((x) => ({ ...x, mtbfH: 1e9 / x.fit, fitPerNpu: x.fit / x.npus }));
  const cluster = { jobPerNpu: fit.job, scaleOutPerNpu: (so.switches * fit.soSwitch + so.links * fit.soLink) / N5 };
  return { npus: n, domainNpus: dom, domains, items, fit, levels, cluster, scaleOut: { npus: N5, tiers: so.tiers, perTier: so.perTier } };
}

/* ---------------- sensitivities ---------------- */
function scaleOutSensitivity() {
  const out: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(SO)) {
    out[id] = {
      name: v.name, basis: v.basis, so: v.so,
      sizes: Object.fromEntries(TOPOLOGY_SCALES.map((n) => {
        const c = scaleOutCounts(n, v.so);
        const res: Record<string, unknown> = { tiers: c.tiers, perTier: c.perTier, switches: c.switches, links: c.links, transceivers: c.transceivers, capacity: c.capacity, ports: c.ports };
        for (const arch of ARCH_IDS) {
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
/** the air-cooled 800T A3 at two servers (16 NPUs) per cabinet: twice the cabinets, the same per-cabinet FIT (assumption) */
function twoPerCabinet() {
  return Object.fromEntries(TOPOLOGY_SCALES.map((n) => {
    const sc = scenarioOf('a3server', n, SO.main.so, { nodesPerRack: 2 });
    const bom = topologyBom(sc);
    const k = kpi(sc);
    return [n, { racks: bom.counts.racks, cabinetFitPerNpu: bom.hardFitPerNpu.cabinet ?? 0, totalFitPerNpu: bom.hardFitPerNpuTotal, aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS }];
  }));
}
/** CloudMatrix384 without the scale-out network: the calibration geometry, which returns the repositories' per-card catalog */
function cm384NoScaleOut() {
  return Object.fromEntries(TOPOLOGY_SCALES.map((n) => {
    const base = scenarioOf('cm384', n);
    const sc = { ...base, topology: { ...base.topology, scaleOut: undefined }, components: base.components.filter((x) => !x.id.includes('@roce')) };
    const bom = topologyBom(sc as typeof base);
    const k = kpi(sc as typeof base);
    return [n, { totalFitPerNpu: bom.hardFitPerNpuTotal, aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS }];
  }));
}

/* ---------------- cross-checks ---------------- */
function crossChecks() {
  // per CloudMatrix384 pod: the model at 384 NPUs against the paper (arXiv 2506.12708 v3 §3.3) and the press
  const c = computeCounts(scenarioOf('cm384', 384));
  const pod = { nodes: c.nodes, npus: c.gpus, cpus: c.cpus, l1: c.l1Switches, l2: c.l2Switches, links: c.opticalLinks, transceivers: c.transceivers, racks: c.racks, commRacks: c.commRacks, rdmaPorts: c.scaleOutPorts };
  const published = { nodes: 48, npus: 384, cpus: 192, l1: 336, l2: 112, links: 5376, racks: 12, commRacks: 4, transceiversSemiAnalysis: 6912, rdmaPorts: 768, maxClusterNpus: 165000 };
  // the other "950 与 910C" report (HAC-D v4.3 dd1fc99, template defaults), transcribed in docs/hacd-remap-comparison/results.json
  let other: { file: string; rows: Record<string, { aOp: number; mtbfHwH: number; mttrS: number; delivered: number }>; ours: Record<string, { aOp: number; mtbfHwH: number; mttrS: number; delivered: number }>; maxRel: number } | null = null;
  const f = 'docs/hacd-remap-comparison/results.json';
  if (existsSync(f)) {
    const o = JSON.parse(readFileSync(f, 'utf8')).other;
    if (o?.a3tpl) {
      const ours: Record<string, { aOp: number; mtbfHwH: number; mttrS: number; delivered: number }> = {};
      let maxRel = 0;
      for (const n of TOPOLOGY_SCALES) {
        const k = kpi(scenarioOf('cm384', n));
        ours[n] = { aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS, delivered: k.delivered };
        const r = o.a3tpl[String(n)];
        // the other report prints 6 significant digits: compare at its rounding
        for (const key of ['aOp', 'mtbfHwH', 'mttrS', 'delivered'] as const) maxRel = Math.max(maxRel, Math.abs(ours[n][key] - r[key]) / Math.abs(r[key]));
      }
      other = { file: o.file, rows: Object.fromEntries(TOPOLOGY_SCALES.map((n) => [n, o.a3tpl[String(n)]])), ours, maxRel };
    }
  }
  return { pod, published, podsAtMax: Math.ceil(published.maxClusterNpus / 384), other };
}

/* ---------------- run ---------------- */
const archs: Record<string, unknown> = {};
for (const arch of ARCH_IDS) {
  const sizes: Record<number, unknown> = {};
  for (const n of TOPOLOGY_SCALES) {
    const r = sizeResult(arch, n);
    sizes[n] = r;
    log(`${arch} ${n}: domains ${r.derived.ubDomains}, racks ${r.counts.racks} + ${r.counts.commRacks}, L1 ${r.counts.l1Switches} L2 ${r.counts.l2Switches}, links ${r.counts.opticalLinks}, SO sw ${r.counts.scaleOutSwitches} (${r.counts.scaleOutTiers} tiers) | FIT/NPU ${r.hardFitPerNpuTotal.toFixed(1)} | A_op ${(r.kpi.aOp * 100).toFixed(4)} % MTBF ${r.kpi.mtbfHwH.toFixed(3)} h MTTR ${r.kpi.mttrS.toFixed(2)} s`);
  }
  const of = (f: (k: ReturnType<typeof kpi>) => number) => (n: number) => f(kpi(scenarioOf(arch, n)));
  const thresholds = { aOp99: crossingOf(of((k) => k.aOp), 0.99), aOp985: crossingOf(of((k) => k.aOp), 0.985), aOp98: crossingOf(of((k) => k.aOp), 0.98), mtbf1h: crossingOf(of((k) => k.mtbfHwH), 1), mtbf2h: crossingOf(of((k) => k.mtbfHwH), 2) };
  archs[arch] = { name: ARCHS[arch].name, short: ARCHS[arch].short, superpod: { ...ARCHS[arch].superpod }, domainNpus: ARCHS[arch].domainNpus, assumed: ARCHS[arch].assumed, sizes, mapping: mapping(arch), thresholds };
  log(`${arch} thresholds ${JSON.stringify(thresholds)}`);
}
const s0 = scenarioOf('cm384', TOPOLOGY_SCALES[0]);
const mechanisms = DEFAULT_PLAYERS.map((id) => { const m = mechanismById(id); return { id, name: m.name, kind: m.kind, change: m.change, parameters: m.parameters }; });
const cross = crossChecks();
log(`cross-check: pod ${JSON.stringify(cross.pod)}; other report max relative difference ${cross.other ? cross.other.maxRel.toExponential(2) : 'n/a'}`);
const out = {
  generated: new Date().toISOString(),
  sizes: TOPOLOGY_SCALES,
  mechanisms,
  baseline: { recovery: s0.recovery, workload: s0.workload, sdc: s0.sdc },
  scaleOut: Object.fromEntries(Object.entries(SO).map(([k, v]) => [k, { name: v.name, basis: v.basis, so: v.so }])),
  archs,
  sensitivity: { scaleOut: scaleOutSensitivity(), twoPerCabinet: twoPerCabinet(), cm384NoScaleOut: cm384NoScaleOut() },
  // the two repositories' arithmetic: the 54-event catalog per card (no topology conversion) with the same six mechanisms
  repoPerCard: Object.fromEntries(TOPOLOGY_SCALES.map((n) => { const k = kpi(applyMechanisms(referenceCatalog(n), DEFAULT_PLAYERS)); return [n, { aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS, delivered: k.delivered, hardFitPerNpu: (k.lamHw / n) * 1e9 }]; })),
  // A_op and MTBF over N (log-spaced 5,000 … 600,000) for the chart
  curve: Object.fromEntries(ARCH_IDS.map((arch) => [arch, Array.from({ length: 31 }, (_, i) => Math.round(5000 * Math.pow(600000 / 5000, i / 30))).map((n) => { const k = kpi(scenarioOf(arch, n)); return { n, aOp: k.aOp, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS }; })])),
  crossCheck: cross,
  constants: { hbmGBPerNpu: HBM_GB, scaleOutSwitchesPerRack: SWITCHES_PER_RACK },
};
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
