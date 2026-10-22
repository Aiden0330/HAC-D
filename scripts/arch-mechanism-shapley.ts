/**
 * Shapley contribution of the mechanism set to A_op and delivered goodput on one architecture at 10k / 100k / 200k / 500k NPUs
 * (the heat-map of the Findings' Table 7 and the hierarchy's Shapley columns) — v5: a thin wrapper over the core's `archStudy`
 * with a built-in (or given) topology record and the default (or given) mechanism set.
 * Usage: node --import tsx scripts/arch-mechanism-shapley.ts --arch native950|ubl128|cm384|a3server [--record r.json] [--set m.json] [--permutations 300] [--sizes 10000,100000,200000,500000] [--out-dir docs/arch-mechanism-shapley]
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { archStudy } from '../packages/core/src/study/archStudy.js';
import { BUILTIN_TOPOLOGY_RECORDS, parseTopologyRecord } from '../packages/core/src/records/topologyRecord.js';
import { DEFAULT_MECHANISM_SET, parseMechanismSet } from '../packages/core/src/records/mechanismSet.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const ARCH = flag('arch') ?? 'native950';
const record = flag('record') ? parseTopologyRecord(JSON.parse(readFileSync(flag('record')!, 'utf8'))) : BUILTIN_TOPOLOGY_RECORDS[ARCH as keyof typeof BUILTIN_TOPOLOGY_RECORDS];
if (!record) throw new Error(`unknown --arch ${ARCH} (built-in: ${Object.keys(BUILTIN_TOPOLOGY_RECORDS).join(', ')}); or give --record r.json`);
const set = flag('set') ? parseMechanismSet(JSON.parse(readFileSync(flag('set')!, 'utf8'))) : DEFAULT_MECHANISM_SET;
const PERMS = Number(flag('permutations') ?? 300);
const SIZES = (flag('sizes') ?? '10000,100000,200000,500000').split(',').map(Number);
const OUT_DIR = flag('out-dir') ?? 'docs/arch-mechanism-shapley';
const t0 = Date.now();
const log = (m: string) => console.error(`[${record.id} ${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const out = archStudy(record, set, { sizes: SIZES, permutations: PERMS, onProgress: (N, done, total) => log(`N=${N} done (${done}/${total})`) });
for (const [N, z] of Object.entries(out.perSize)) {
  const top = z.gains.slice().sort((a, b) => b.aOp.shapley - a.aOp.shapley).slice(0, 4).map((g) => `${g.id} ${(g.aOp.shapley * 100).toFixed(2)}`).join(', ');
  log(`N=${N}: baseline ${(z.baseline * 100).toFixed(3)} % | plan ${z.plan.feasible ? '' : '[infeasible] '}${z.plan.ids.join('+')} effort ${z.plan.effort} → ${(z.plan.nominal * 100).toFixed(3)} / ${(z.plan.derated * 100).toFixed(3)} % | all-on ${(z.allOn * 100).toFixed(3)} | top ${top}`);
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/${record.id}.json`, JSON.stringify({ ...out, remap: set.remap ?? null }, null, 1));
log(`written ${OUT_DIR}/${record.id}.json`);
