/**
 * Allocation study at a 98.5 % A_op target on the 54-event reference catalog with ReMAP's original mechanisms as the only
 * candidates (the reference catalog's twelve; the eight with parameter transforms participate: D-HARD, D-SLOW, D-SDC, R-SDC,
 * R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST; R-CKPT / R-MANUAL are the baseline, H-PROTECT / H-RELIABILITY carry no increment).
 * Usage: node --import tsx scripts/remap-allocation-98p5.ts [--trials 200] [--out docs/remap-allocation-98p5/results.json]
 */
import { writeFileSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { allocationStudy } from '../packages/core/src/study/index.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const TRIALS = Number(flag('trials') ?? 200);
const OUT = flag('out') ?? 'docs/remap-allocation-98p5/results.json';
const REMAP = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
const REMAP_ALL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'R-CKPT', 'R-MANUAL', 'C-FAST', 'H-PROTECT', 'H-RELIABILITY'];
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const study = allocationStudy(referenceCatalog(100000), { sizes: [10000, 100000, 200000, 500000], target: 0.985, metric: 'aOp', players: REMAP, trials: TRIALS, seed: 1, levers: true, curves: true, onProgress: (d, t, ph) => log(`${ph} ${d}/${t}`) });
for (const N of study.sizes) { const z = study.perSize[N]; log(`N=${N}: plan ${z.plan.feasible ? '' : '[infeasible] '}${z.plan.ids.join('+') || '∅'} effort ${z.plan.effort} nominal ${(z.plan.nominal * 100).toFixed(3)} derated ${(z.plan.derated * 100).toFixed(3)} residual hw ×${z.residualFactor.plan.toFixed(3)} P ${z.verification ? (z.verification.pAtLeastTarget * 100).toFixed(1) : '-'} ${z.verification?.verdict ?? ''} | levers ${z.levers?.map((l) => `${l.id} ${(l.value * 100).toFixed(2)}`).join(', ')}`); }
log(`max N: ${Object.entries(study.curves).filter(([k]) => !k.endsWith('Derated')).map(([k, c]) => `${k} ${c.maxN}`).join(' · ')}`);
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), players: REMAP, all: REMAP_ALL, study }, null, 1));
log(`written ${OUT}`);
