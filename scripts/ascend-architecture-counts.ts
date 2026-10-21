/**
 * Unit counts per scale-up domain for the Ascend architecture page (docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html, 2026-10-20 revision),
 * from HAC-D v4.3's topology templates (computeCounts / topologyBom; six default mechanisms, proportional fill, no hot spares):
 *  - A2 server (a2-roce, one 8-NPU server), CloudMatrix384 (a3-ub384, one 384-NPU supernode), Atlas 950 at 1,024 NPUs (product-page
 *    spec, a950-ub2 default) and at 8,192 NPUs (roadmap, variant a950-8k), SuperPoD Flex / UBL128 (scripts/ascend950-archs.ts; 4 pods
 *    so that the shared switch cabinet is whole, reported per pod; scale-out as the a950-ub2 template), Atlas 960E (a960e-ub, 4,032 NPUs);
 *  - the hard FIT per NPU of each design at 10,000 NPUs and the share of the UB fabric in it.
 * Usage: node --import tsx scripts/ascend-architecture-counts.ts [--out docs/ascend-architecture/counts.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyScenario, topologyBom, applySuperpodVariant, TOPOLOGY_TEMPLATES } from '../packages/core/src/topology/index.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { scenarioOf, SO } from './ascend950-archs.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/ascend-architecture/counts.json';

type Design = { id: string; label: { zh: string; en: string }; npus: number; per: number; make: (n: number) => Scenario };
const DESIGNS: Design[] = [
  { id: 'a2', label: { zh: 'A2 · Atlas 800T A2 服务器', en: 'A2 · Atlas 800T A2 server' }, npus: 8, per: 1, make: (n) => topologyScenario('a2-roce', n) },
  { id: 'cm384', label: { zh: 'A3 · CloudMatrix384', en: 'A3 · CloudMatrix384' }, npus: 384, per: 1, make: (n) => topologyScenario('a3-ub384', n) },
  { id: 'a950', label: { zh: 'Atlas 950 · 1,024（现行规格）', en: 'Atlas 950 · 1,024 (current spec)' }, npus: 1024, per: 1, make: (n) => topologyScenario('a950-ub2', n) },
  { id: 'a950-8k', label: { zh: 'Atlas 950 · 8,192（路线图）', en: 'Atlas 950 · 8,192 (roadmap)' }, npus: 8192, per: 1, make: (n) => applySuperpodVariant(topologyScenario('a950-ub2', n), 'a950-8k') },
  { id: 'ubl128', label: { zh: 'SuperPoD Flex / UBL128', en: 'SuperPoD Flex / UBL128' }, npus: 512, per: 4, make: (n) => scenarioOf('ubl128', n, SO.hacd.so) }, // the a950-ub2 template's scale-out, so only the SuperPoD differs
  { id: 'a960e', label: { zh: 'Atlas 960E · 4,032（媒体推断）', en: 'Atlas 960E · 4,032 (media inference)' }, npus: 4032, per: 1, make: (n) => topologyScenario('a960e-ub', n) },
];

const out: Record<string, unknown> = { generated: new Date().toISOString(), designs: {} as Record<string, unknown> };
for (const d of DESIGNS) {
  const bom = topologyBom(d.make(d.npus));
  const c = bom.counts;
  const k = 1 / d.per; // per scale-up domain
  const at10k = topologyBom(d.make(10000));
  const ubFit = (at10k.hardFitPerNpu['ub-switch'] ?? 0) + (at10k.hardFitPerNpu['ub-link'] ?? 0);
  (out.designs as Record<string, unknown>)[d.id] = {
    label: d.label,
    template: bom.template,
    domainNpus: d.npus * k,
    perDomain: {
      nodes: c.nodes * k, cpus: c.cpus * k, racks: c.racks * k, commRacks: c.commRacks * k,
      l1: c.l1Switches * k, l2: c.l2Switches * k, rackSwitches: c.rackSwitches * k, podSwitches: c.podSwitches * k, ubSwitches: c.ubSwitches * k,
      meshLinks: c.meshLinks * k, opticalLinks: c.opticalLinks * k, transceivers: c.transceivers * k, opticalEngines: c.opticalEngines * k,
      scaleOutPorts: c.scaleOutPorts * k,
    },
    npusPerRack: c.gpus / Math.max(1, c.racks),
    at10k: { hardFitPerNpu: at10k.hardFitPerNpuTotal, ubFitPerNpu: ubFit, byUnit: at10k.hardFitPerNpu, scaleOut: at10k.counts.scaleOutSwitches, tiers: at10k.counts.scaleOutTiers },
    summary: bom.template ? TOPOLOGY_TEMPLATES[bom.template].summary : null,
  };
  console.log(`${d.id.padEnd(8)} per domain ${JSON.stringify((out.designs as Record<string, { perDomain: unknown }>)[d.id].perDomain)} | 10k FIT/NPU ${at10k.hardFitPerNpuTotal.toFixed(1)} (UB ${ubFit.toFixed(1)})`);
}
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`written ${OUT}`);
