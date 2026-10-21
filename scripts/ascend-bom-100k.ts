/**
 * Component counts (bill of materials) at 100k NPUs of the alternative topology designs, for docs/ASCEND_BOM_100K.html:
 * the four architectures (native Atlas 950 SuperPoD, SuperPoD Flex / UBL128, Atlas 900 A3 SuperPoD / CloudMatrix384, Atlas 800T A3
 * servers + RoCE) with every scale-out design of their family (950: 4-plane main case, 2-plane, HAC-D radix-128, the attachments'
 * 1 × 800G scheme, 2:1 leaves; 910C: 2 × 200G radix-64 main case, 256 × 200G, 128 × 400G, 2:1 leaves), as HAC-D's topologyBom rows
 * (count, per NPU, fault unit, hard FIT per unit, job interruption rate), plus the counts of every architecture at 10k–500k.
 * Usage: node --import tsx scripts/ascend-bom-100k.ts [--npus 100000] [--out docs/backup/ascend-allocation/bom.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyBom } from '../packages/core/src/topology/index.js';
import { scenarioOf as s950, ARCHS as A950, SO as SO950 } from './ascend950-archs.js';
import { scenarioOf as s910, ARCHS as A910, SO as SO910 } from './ascend910c-archs.js';
import { tr } from './scaling-common.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/backup/ascend-allocation/bom.json';
const N = Number(flag('npus') ?? 100000);
const SIZES = [10000, 100000, 200000, 500000];

const designs: unknown[] = [];
const push = (family: '950' | '910C', arch: string, so: string, name: { zh: string; en: string }, short: { zh: string; en: string }, soName: { zh: string; en: string }, basis: { zh: string; en: string }, build: () => ReturnType<typeof s950>, assumed: string[]) => {
  const s = build();
  const b = topologyBom(s);
  const t = tr(s);
  designs.push({
    id: `${arch}-${so}`, family, arch, so, name, short, soName, basis, assumed, main: so === 'main',
    counts: b.counts, rows: b.rows.map((r) => ({ id: r.id, name: r.name, level: r.level, count: r.count, perNpu: r.perNpu, faultUnit: r.faultUnit ?? null, fitHard: r.fit?.hard ?? null, fitSlow: r.fit?.slow ?? null, fitSdc: r.fit?.sdc ?? null, hardPerHour: r.hardPerHour ?? null, impact: r.impact, blastRadiusNpus: r.blastRadiusNpus ?? null, confidence: r.confidence })),
    hardFitPerNpu: b.hardFitPerNpu, hardFitPerNpuTotal: b.hardFitPerNpuTotal, hardFitPerNpuOther: b.hardFitPerNpuOther, hardPerHour: b.hardPerHour, mtbiH: b.hardPerHour > 0 ? 1 / b.hardPerHour : null,
    aOp: t.operationalAvailability, delivered: t.deliveredGoodput,
    scaleOut: s.topology.scaleOut,
  });
};
for (const arch of ['native', 'ubl128'] as const) for (const [so, d] of Object.entries(SO950)) push('950', arch === 'native' ? 'native950' : 'ubl128', so, A950[arch].name, A950[arch].short, d.name, d.basis, () => s950(arch, N, d.so), A950[arch].assumed);
for (const arch of ['cm384', 'a3server'] as const) for (const [so, d] of Object.entries(SO910)) push('910C', arch, so, A910[arch].name, A910[arch].short, d.name, d.basis, () => s910(arch, N, d.so), A910[arch].assumed);

// the main design of every architecture at the four scales (counts only)
const scales: Record<string, Record<number, unknown>> = {};
for (const [arch, build] of [['native950', (n: number) => s950('native', n)], ['ubl128', (n: number) => s950('ubl128', n)], ['cm384', (n: number) => s910('cm384', n)], ['a3server', (n: number) => s910('a3server', n)]] as const) {
  scales[arch] = {};
  for (const n of SIZES) { const b = topologyBom(build(n)); scales[arch][n] = { counts: b.counts, rows: b.rows.map((r) => ({ id: r.id, count: r.count })), hardFitPerNpuTotal: b.hardFitPerNpuTotal, hardPerHour: b.hardPerHour }; }
}
const out = { generated: new Date().toISOString(), npus: N, sizes: SIZES, designs, scales, scaleOutDesigns: { '950': SO950, '910C': SO910 } };
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.error(`written ${OUT}: ${designs.length} designs at ${N.toLocaleString('en-US')} NPUs`);
for (const d of designs as { id: string; counts: Record<string, number>; hardFitPerNpuTotal: number; aOp: number }[]) console.error(`${d.id.padEnd(20)} UB sw ${d.counts.ubSwitches} · UB links ${d.counts.opticalLinks} · SO sw ${d.counts.scaleOutSwitches} (tiers ${d.counts.scaleOutTiers}) · SO links ${d.counts.scaleOutLinks} · transceivers ${d.counts.transceivers + d.counts.scaleOutTransceivers} | FIT/NPU ${d.hardFitPerNpuTotal.toFixed(1)} | A_op ${(d.aOp * 100).toFixed(3)} %`);
