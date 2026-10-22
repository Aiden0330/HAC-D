/**
 * Component counts (bill of materials) at 100k NPUs of the alternative topology designs, for docs/ASCEND_BOM_100K.html — v5: a thin
 * wrapper over the core's `bomDocument` with the four built-in topology records (packages/core/data/records/*.json) and every
 * scale-out variant each record lists, plus the counts of every main design at 10k–500k.
 * Usage: node --import tsx scripts/ascend-bom-100k.ts [--npus 100000] [--records a.json,b.json] [--out docs/backup/ascend-allocation/bom.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { bomDocument } from '../packages/core/src/budget/bom.js';
import { BUILTIN_TOPOLOGY_RECORDS, parseTopologyRecord } from '../packages/core/src/records/topologyRecord.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/backup/ascend-allocation/bom.json';
const N = Number(flag('npus') ?? 100000);
const records = flag('records') ? flag('records')!.split(',').map((p) => parseTopologyRecord(JSON.parse(readFileSync(p, 'utf8')))) : Object.values(BUILTIN_TOPOLOGY_RECORDS);
const out = bomDocument(records, N);
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.error(`written ${OUT}: ${out.designs.length} designs at ${N.toLocaleString('en-US')} NPUs`);
for (const d of out.designs) console.error(`${d.id.padEnd(20)} UB sw ${d.counts.ubSwitches} · UB links ${d.counts.opticalLinks} · SO sw ${d.counts.scaleOutSwitches} (tiers ${d.counts.scaleOutTiers}) · SO links ${d.counts.scaleOutLinks} · transceivers ${d.counts.transceivers + d.counts.scaleOutTransceivers} | FIT/NPU ${d.hardFitPerNpuTotal.toFixed(1)} | A_op ${(d.aOp * 100).toFixed(3)} %`);
