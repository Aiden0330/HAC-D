/**
 * Unit counts and per-device rate conversions for the Ascend architecture page (docs/ASCEND_CLUSTER_ARCHITECTURE.{zh,en}.html).
 * - Counts per SuperPoD and at 100,000 NPUs from `computeCounts` with the `cloudmatrix384` preset (paper geometry) and the
 *   `atlas950` preset (vendor totals, fabric geometry assumed from CloudMatrix384), hot spares set to 0 for comparability;
 *   the 8-NPU-server column uses the reference catalog's topology (8 NPUs per node).
 * - The 18 hard-interruption domains of the 54-event reference catalog with their FIT per card-hour, mechanism flags and
 *   per-device conversions under the CloudMatrix384 geometry (business-impact FIT per device, assuming every event of the
 *   class originates in that device type — derived, for orientation only).
 * Usage: node --import tsx scripts/ascend-architecture-counts.ts [--out docs/ascend-architecture/counts.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { cloudMatrix384Training, atlas950Training, referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { computeCounts, componentInstances } from '../packages/core/src/scenario/build.js';
import { withSize, groupOf } from '../packages/core/src/study/index.js';
import { SUPERPOD_PRESETS, type Scenario } from '../packages/core/src/scenario/schema.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/ascend-architecture/counts.json';
const N = 100000;
const noSpares = (s: Scenario): Scenario => (s.workload.type === 'training' ? { ...s, workload: { ...s.workload, hotSpareNodes: 0 } } : s);
const cm = noSpares(cloudMatrix384Training());
const a950 = noSpares(atlas950Training());
const perPod = { cm384: computeCounts(withSize(cm, 384)), atlas950: computeCounts(withSize(a950, 8192)) };
const at100k = { server8: computeCounts(referenceCatalog(N)), cm384: computeCounts(withSize(cm, N)), atlas950: computeCounts(withSize(a950, N)) };

const cat = referenceCatalog(N);
const counts = computeCounts(cat);
const pod = perPod.cm384; // 384 cards, 48 nodes, 12 compute racks, 336 L1, 112 L2, 5,376 links, 10,752 ends
const cardsPerCabinet = { cm384: pod.gpus / pod.racks, atlas950: perPod.atlas950.gpus / perPod.atlas950.racks };
const domains = cat.components.filter((c) => c.id.endsWith('-hard')).map((c) => {
  const ci = componentInstances(c, counts, cat.measures.subhealthThreshold);
  const fit = ci.lambda * 1e9;
  const d = c.id.replace(/-hard$/, '');
  const perDevice: Record<string, number> = {};
  if (d === 'OPT') { perDevice.perL1L2Link = (fit * pod.gpus) / pod.opticalLinks; perDevice.perLinkEnd = (fit * pod.gpus) / pod.transceivers; }
  if (d === 'FABRIC') { perDevice.perUbChip = (fit * pod.gpus) / (pod.l1Switches + pod.l2Switches); perDevice.perL2ChipOnly = (fit * pod.gpus) / pod.l2Switches; }
  if (d === 'BOXIO' || d === 'MGMT') perDevice.perNode = fit * pod.gpusPerNode;
  if (d === 'CPU') perDevice.perCpu = (fit * pod.gpusPerNode) / 4;
  if (d === 'POWER' || d === 'COOL' || d === 'MGMT') { perDevice.perComputeCabinetCm384 = fit * cardsPerCabinet.cm384; perDevice.perComputeCabinetAtlas950 = fit * cardsPerCabinet.atlas950; }
  if (d === 'STORAGE' || d === 'UNKNOWN') perDevice.clusterEventsPerHourAt100k = fit * 1e-9 * N;
  return { id: d, name: c.name?.zh ?? d, group: groupOf(c), fit, flags: ci.applicable, perDevice };
});
const out = {
  generated: new Date().toISOString(),
  presets: { cloudmatrix384: SUPERPOD_PRESETS.cloudmatrix384, atlas950: SUPERPOD_PRESETS.atlas950 },
  perPod, at100k, cardsPerCabinet, domains,
  opticsVendor: { traditionalAfr: 0.004, traditionalFit: (0.004 / 8760) * 1e9, channelLossResistantAfr: 0.0004, channelLossResistantFit: (0.0004 / 8760) * 1e9 },
  notes: [
    'perPod.cm384 = paper geometry (arXiv 2506.12708 §3.3); perPod.atlas950 = vendor totals (8,192 NPUs, 128 + 32 cabinets, 64 NPUs per cabinet) with the CloudMatrix384 fabric radix assumed',
    'at100k.server8 = the reference catalog topology (8 NPUs per node); its rack and zone counts are HAC-D defaults, not an Ascend fact',
    'per-device FIT: business-impact rate per device if every event of the class originates in that device type (derived); the catalog states rates per card-hour',
  ],
};
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ perPod, at100k, cardsPerCabinet }, null, 0));
for (const d of domains) console.log(d.id.padEnd(8), d.fit.toFixed(1).padStart(7), JSON.stringify(d.flags), JSON.stringify(Object.fromEntries(Object.entries(d.perDevice).map(([k, v]) => [k, +v.toFixed(2)]))));
console.log('optics vendor', JSON.stringify(out.opticsVendor));
console.log(`written ${OUT}`);
