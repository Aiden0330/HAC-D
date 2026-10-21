/**
 * The inputs of docs/ASCEND_AVAILABILITY_ALLOCATION.html that the earlier reports do not hold:
 *  - instance sizes of the three topologies — native Atlas 950 SuperPoD (1,024 NPUs, 64 per cabinet), SuperPoD Flex / UBL128
 *    (128 NPUs, 64 per cabinet), Atlas 900 A3 SuperPoD / CloudMatrix384 (384 NPUs, 32 per cabinet) — and their instance counts
 *    (SuperPoDs, compute cabinets, nodes) at 10k / 100k / 200k / 500k NPUs;
 *  - a sensitivity on HAC-D's per-unit FIT (topology templates of the scaling reports; the six reference mechanisms only, the
 *    recovery levers, ARINC): A_op today, hardware-only ARINC factor, the least-effort plan and the recommended design (the
 *    least-effort plan that also passes the window check, scaling-common recommendDesign) per topology and size.
 * The allocation itself (ReMAP per-card FIT, ReMAP reference mechanisms, HAC-D methods) is docs/a950-level-allocation/results.json
 * (scripts/a950-level-allocation.ts); per-card results there do not depend on the topology.
 * Usage: node --import tsx scripts/allocation-summary.ts [--out docs/allocation-summary/results.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyBom } from '../packages/core/src/topology/index.js';
import { allocateStrategy, DEFAULT_LEVERS } from '../packages/core/src/strategy/index.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { scenarioOf as scen950 } from './ascend950-archs.js';
import { scenarioOf as scen910 } from './ascend910c-archs.js';
import { tr, deratedOf, recommendDesign, windowCheck } from './scaling-common.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/allocation-summary/results.json';
const SIZES = [10000, 100000, 200000, 500000];
const TARGET = 0.985;
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

const TOPOS: Record<string, { scen: (n: number) => Scenario; podNpus: number; cabinetNpus: number; nodeNpus: number }> = {
  native950: { scen: (n) => scen950('native', n), podNpus: 1024, cabinetNpus: 64, nodeNpus: 8 },
  ubl128: { scen: (n) => scen950('ubl128', n), podNpus: 128, cabinetNpus: 64, nodeNpus: 8 },
  cm384: { scen: (n) => scen910('cm384', n), podNpus: 384, cabinetNpus: 32, nodeNpus: 8 },
};
const factorOf = (r: ReturnType<typeof allocateStrategy>) => (r.hardware.needed ? Math.min(...r.hardware.rows.map((h) => h.factor)) : null);

const out: Record<string, unknown> = {};
for (const [id, t] of Object.entries(TOPOS)) {
  const sizes: Record<number, unknown> = {};
  for (const n of SIZES) {
    const s = t.scen(n);
    const bom = topologyBom(s);
    const c = bom.counts;
    const p1 = allocateStrategy(s, { strategy: 'mttf-first', target: TARGET, candidates: [], levers: false, hardwareSplit: 'arinc' });
    const p3 = allocateStrategy(s, { strategy: 'optimal', target: TARGET, candidates: [], levers: DEFAULT_LEVERS, hardwareSplit: 'arinc' });
    const rec = recommendDesign(s, p3.levers, TARGET);
    const todayW = windowCheck(s, TARGET);
    sizes[n] = {
      instances: { superpod: c.supernodes, cabinet: c.racks, node: c.nodes, npu: n, commRacks: c.commRacks },
      fitPerNpu: bom.hardFitPerNpuTotal,
      aOp: tr(s).operationalAvailability, aOpDerated: tr(deratedOf(s)).operationalAvailability,
      p1: { needed: p1.hardware.needed, factor: factorOf(p1), slack: p1.hardware.slackFactor ?? null },
      p3: { levers: p3.levers, needed: p3.hardware.needed, factor: factorOf(p3), slack: p3.hardware.slackFactor ?? null, final: p3.final.value, finalDerated: p3.final.derated, effort: p3.effort.total },
      todayWindow: { pAtLeastTarget: todayW.pAtLeastTarget, wilson: todayW.wilson, verdict: todayW.verdict },
      recommended: { levers: rec.levers, escalated: rec.escalated, kMean: rec.kMean, k: rec.k, binding: rec.binding, pAtLeastTarget: rec.window.pAtLeastTarget, wilson: rec.window.wilson, verdict: rec.window.verdict, aOp: tr(rec.nom).operationalAvailability, aOpDerated: tr(rec.der).operationalAvailability },
    };
    log(`${id} ${n}: FIT/NPU ${bom.hardFitPerNpuTotal.toFixed(1)} A_op ${(tr(s).operationalAvailability * 100).toFixed(3)} | P1 ${p1.hardware.needed ? `×${factorOf(p1)!.toFixed(3)}` : `slack ×${(p1.hardware.slackFactor ?? 0).toFixed(2)}`} | P3 ${p3.levers.join('+') || '—'} ${p3.hardware.needed ? `×${factorOf(p3)!.toFixed(3)}` : `slack ×${(p3.hardware.slackFactor ?? 0).toFixed(2)}`} → ${(p3.final.value * 100).toFixed(2)} / ${(p3.final.derated * 100).toFixed(2)} % | today P ${(todayW.pAtLeastTarget * 100).toFixed(1)} % | rec ${rec.levers.join('+') || '—'} k ${rec.k.toFixed(3)} (mean ${rec.kMean.toFixed(3)}, ${rec.binding}) P ${(rec.window.pAtLeastTarget * 100).toFixed(1)} % ${rec.window.verdict}`);
  }
  out[id] = { podNpus: t.podNpus, cabinetNpus: t.cabinetNpus, nodeNpus: t.nodeNpus, sizes };
}
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), sizes: SIZES, target: TARGET, topologies: out }, null, 1));
log(`written ${OUT}`);
