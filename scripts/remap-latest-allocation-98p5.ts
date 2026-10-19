/**
 * Allocation study at a 98.5 % target on the 54-event reference catalog with the latest ReMAP's mechanism set
 * (remap/remap-latest, commit eaacb05 of 2026-10-15): the original twelve (eight with transforms) plus the sixteen extensions
 * (fifteen with transforms) at the explicit scenario parameters of ReMAP's `extensionScenario()` — eligible share 100 % of the
 * candidate events (FP8 / FP4: 50 % of the CORE silent risk each), success 95 %, failure attempt 0 s, overhead 0 (ABFT 0.1 %),
 * with the per-mechanism targets of its parameter sets. Eligibility × success is folded into HAC-D's parameters where the
 * transform is deterministic (expected-value equivalence). Two runs: A_op (the 口径 of the previous reports) and delivered
 * goodput (ReMAP's own "可用度" = retained clean progress). Usage: node --import tsx scripts/remap-latest-allocation-98p5.ts [--trials 200] [--permutations 300]
 */
import { writeFileSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { MECHANISM_LIBRARY } from '../packages/core/src/mechanisms/index.js';
import { allocationStudy } from '../packages/core/src/study/index.js';
import { REMAP_LATEST_PARAMS } from './remap-latest-params.js';
export { REMAP_LATEST_PARAMS };

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const TRIALS = Number(flag('trials') ?? 200);
const PERMS = Number(flag('permutations') ?? 300);
const OUT = flag('out') ?? 'docs/remap-latest-allocation-98p5/results.json';
const SIZES = [10000, 100000, 200000, 500000];
const ORIGINAL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
const EXT = MECHANISM_LIBRARY.filter((m) => m.audit && m.apply).map((m) => m.id);
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const players = [...ORIGINAL, ...EXT];
const out: Record<string, unknown> = { generated: new Date().toISOString(), remap: { repo: 'https://github.com/lzq0927/remap', commit: 'eaacb0578a30027c480046de6b91e6f434dfa15e', date: '2026-10-15' }, players, original: ORIGINAL, extensions: EXT, parameters: REMAP_LATEST_PARAMS };
for (const metric of ['aOp', 'delivered'] as const) {
  log(`study ${metric}: ${players.length} players`);
  const study = allocationStudy(referenceCatalog(100000), { sizes: SIZES, target: 0.985, metric, players, parameters: REMAP_LATEST_PARAMS, trials: TRIALS, seed: 1, levers: true, curves: true, permutations: PERMS, onProgress: (d, t, ph) => log(`  ${metric} ${ph} ${d}/${t}`) });
  for (const N of SIZES) { const z = study.perSize[N]; log(`  ${metric} N=${N}: baseline ${(z.baseline.value * 100).toFixed(3)} plan ${z.plan.feasible ? '' : '[infeasible] '}${z.plan.ids.join('+') || '∅'} effort ${z.plan.effort} nominal ${(z.plan.nominal * 100).toFixed(3)} derated ${(z.plan.derated * 100).toFixed(3)} residual hw ×${z.residualFactor.plan.toFixed(3)} P ${z.verification ? (z.verification.pAtLeastTarget * 100).toFixed(1) : '-'} ${z.verification?.verdict ?? ''}`); }
  log(`  ${metric} max N: ${Object.entries(study.curves).filter(([k]) => !k.endsWith('Derated')).map(([k, c]) => `${k} ${c.maxN}`).join(' · ')}`);
  out[metric] = study;
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
