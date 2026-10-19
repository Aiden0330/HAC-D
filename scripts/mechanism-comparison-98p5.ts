/**
 * Mechanism-family comparison at a 98.5 % A_op target on the 54-event reference catalog (10k / 100k / 200k / 500k cards):
 * ReMAP's original mechanisms (the reference catalog's twelve, eight of which have transforms) vs the 16 mechanisms of the
 * audit of 2026-10-14 (15 with transforms, provisional integration assumptions) vs both together. Each set runs the full
 * allocation study (budgets, planner, Shapley, residual by domain group, levers, verification, curves).
 * Usage: node --import tsx scripts/mechanism-comparison-98p5.ts [--trials 200] [--permutations 300] [--out docs/mechanism-comparison-98p5/results.json]
 */
import { writeFileSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { MECHANISM_LIBRARY } from '../packages/core/src/mechanisms/index.js';
import { allocationStudy, type StudyResult } from '../packages/core/src/study/index.js';
import { provisionalParameters } from '../packages/core/src/mechanisms/auditLibrary.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const TRIALS = Number(flag('trials') ?? 200);
const PERMS = Number(flag('permutations') ?? 300);
const OUT = flag('out') ?? 'docs/mechanism-comparison-98p5/results.json';
const SIZES = [10000, 100000, 200000, 500000];
const TARGET = 0.985;
const REMAP = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
const REMAP_ALL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'R-CKPT', 'R-MANUAL', 'C-FAST', 'H-PROTECT', 'H-RELIABILITY'];
const NEW = MECHANISM_LIBRARY.filter((m) => m.audit && m.apply).map((m) => m.id);
const NEW_ALL = MECHANISM_LIBRARY.filter((m) => m.audit).map((m) => m.id);
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const sets: Record<string, { label: { zh: string; en: string }; players: string[]; all: string[] }> = {
  remap: { label: { zh: 'ReMAP 原有机制', en: 'ReMAP original mechanisms' }, players: REMAP, all: REMAP_ALL },
  new: { label: { zh: '新增 16 项机制', en: '16 new mechanisms' }, players: NEW, all: NEW_ALL },
  combined: { label: { zh: '原有 + 新增', en: 'ReMAP + new' }, players: [...REMAP, ...NEW], all: [...REMAP_ALL, ...NEW_ALL] },
};
const out: { generated: string; target: number; sizes: number[]; provisional: Record<string, Record<string, number>>; sets: Record<string, { label: { zh: string; en: string }; players: string[]; all: string[]; study: StudyResult }> } = { generated: new Date().toISOString(), target: TARGET, sizes: SIZES, provisional: provisionalParameters(NEW), sets: {} };
for (const [key, def] of Object.entries(sets)) {
  log(`study ${key}: ${def.players.length} players`);
  const study = allocationStudy(referenceCatalog(100000), { sizes: SIZES, target: TARGET, metric: 'aOp', players: def.players, provisional: true, trials: TRIALS, seed: 1, levers: key === 'combined', curves: true, permutations: PERMS, onProgress: (d, t, ph) => log(`  ${key} ${ph} ${d}/${t}`) });
  for (const N of SIZES) { const z = study.perSize[N]; log(`  ${key} N=${N}: plan ${z.plan.feasible ? '' : '[infeasible] '}${z.plan.ids.join('+') || '∅'} effort ${z.plan.effort} nominal ${(z.plan.nominal * 100).toFixed(3)} derated ${(z.plan.derated * 100).toFixed(3)} residual hw ×${z.residualFactor.plan.toFixed(3)} P ${z.verification ? (z.verification.pAtLeastTarget * 100).toFixed(1) : '-'} ${z.verification?.verdict ?? ''}`); }
  log(`  ${key} max N: ${Object.entries(study.curves).filter(([k]) => !k.endsWith('Derated')).map(([k, c]) => `${k} ${c.maxN}`).join(' · ')}`);
  out.sets[key] = { ...def, study };
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
