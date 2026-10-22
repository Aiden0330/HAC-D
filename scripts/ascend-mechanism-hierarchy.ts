/**
 * The ReMAP mechanism set (8 original + 15 latest extensions + the I-CONTAIN capability) categorised for the allocation report set
 * (deployment layer, acted-on layers, parameters nominal / derated, Shapley values per architecture, verdict) — v5: a thin wrapper
 * over the core's `mechanismHierarchy` with the default mechanism set (packages/core/data/mechanism-sets/remap-latest-2026-10.json)
 * and the stored arch studies (docs/backup/arch-mechanism-shapley/*.json). The set's verdict lists are checked against the pruning
 * rule on the Shapley data; a mismatch throws (`hac-d prune` re-derives the lists).
 * Usage: node --import tsx scripts/ascend-mechanism-hierarchy.ts [--set path.json] [--shapley-dir docs/backup/arch-mechanism-shapley] [--out docs/backup/ascend-allocation/mechanisms.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { mechanismHierarchy, type StoredStudy } from '../packages/core/src/study/hierarchy.js';
import { DEFAULT_MECHANISM_SET, parseMechanismSet } from '../packages/core/src/records/mechanismSet.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/backup/ascend-allocation/mechanisms.json';
const SHAPLEY_DIR = flag('shapley-dir') ?? 'docs/backup/arch-mechanism-shapley';
const ARCHS = (flag('archs') ?? 'native950,ubl128,cm384,a3server').split(',');
const set = flag('set') ? parseMechanismSet(JSON.parse(readFileSync(flag('set')!, 'utf8'))) : DEFAULT_MECHANISM_SET;
const studies: Record<string, StoredStudy> = Object.fromEntries(ARCHS.map((a) => [a, JSON.parse(readFileSync(`${SHAPLEY_DIR}/${a}.json`, 'utf8')) as StoredStudy]));
const perms = (Object.values(studies)[0] as unknown as { permutations?: number }).permutations;
const out = mechanismHierarchy(set, studies, { permutations: perms, basis: `bare architecture scenario, HAC-D per-unit FIT, ${set.id}` });
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify({ ...out, source: { dir: SHAPLEY_DIR, ...out.source } }, null, 1));
const rows = out.mechanisms;
console.error(`written ${OUT}: ${rows.length} mechanisms; candidates ${out.candidates.join(', ')}; goodput ${rows.filter((r) => r.verdict === 'goodput').map((r) => r.id).join(', ')}; pruned ${rows.filter((r) => r.verdict === 'pruned').map((r) => r.id).join(', ')}`);
