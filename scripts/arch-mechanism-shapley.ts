/**
 * Shapley contribution of the latest ReMAP's mechanism set to A_op for the four architectures of the scaling reports
 * (docs/ASCEND950_SCALING_RELIABILITY and docs/ASCEND910C_SCALING_RELIABILITY), at 10k / 100k / 200k / 500k NPUs, and the
 * recommended set that reaches A_op ≥ 98.5 % with derated parameters — the heatmap of docs/REMAP_LATEST_ALLOCATION_98P5 (Figure 3)
 * redone on each architecture's topology scenario instead of the per-card catalog.
 *  - players: ReMAP's 8 original mechanisms with parameter transforms (D-HARD, D-SLOW, D-SDC, R-SDC, R-REPLAY, R-PROCESS,
 *    R-ELASTIC, C-FAST — the six HAC-D defaults among them) + the 15 audited extensions with a transform, at ReMAP's explicit
 *    `extensionScenario()` parameters (scripts/remap-latest-params.ts; packages/contracts/src/audit-extensions.ts is unchanged
 *    between ReMAP eaacb05 and f53ab7e);
 *  - base: the architecture's scenario with no mechanism applied (the six defaults are players, not part of the base);
 *  - HAC-D allocationStudy: sampled Shapley (permutations, 95 % half-width), single and last-added gains, the greedy planner's
 *    cheapest set meeting the target nominally and derated (coverage −5 pt, success −8 pt, times ×1.5).
 * Usage: node --import tsx scripts/arch-mechanism-shapley.ts --arch native950|ubl128|cm384|a3server [--permutations 300] [--out-dir docs/arch-mechanism-shapley]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { MECHANISM_LIBRARY, DEFAULT_PLAYERS, stripMechanisms } from '../packages/core/src/mechanisms/index.js';
import { allocationStudy } from '../packages/core/src/study/index.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { REMAP_LATEST_PARAMS } from './remap-latest-params.js';
import { scenarioOf as scen910 } from './ascend910c-archs.js';
import { scenarioOf as scen950 } from './ascend950-archs.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const ARCH = flag('arch') ?? 'native950';
const PERMS = Number(flag('permutations') ?? 300);
const OUT_DIR = flag('out-dir') ?? 'docs/arch-mechanism-shapley';
const SIZES = [10000, 100000, 200000, 500000];
const TARGET = 0.985;
const ORIGINAL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
const EXT = MECHANISM_LIBRARY.filter((m) => m.audit && m.apply).map((m) => m.id);
const players = [...ORIGINAL, ...EXT];
const t0 = Date.now();
const log = (m: string) => console.error(`[${ARCH} ${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

const BUILD: Record<string, (n: number) => Scenario> = {
  native950: (n) => scen950('native', n), ubl128: (n) => scen950('ubl128', n), cm384: (n) => scen910('cm384', n), a3server: (n) => scen910('a3server', n),
};
if (!BUILD[ARCH]) throw new Error(`unknown --arch ${ARCH}`);
const bare = (n: number) => stripMechanisms(BUILD[ARCH](n), DEFAULT_PLAYERS);

const perSize: Record<number, unknown> = {};
let library: unknown = null;
for (const N of SIZES) {
  // one size per study: each size is built from the architecture's own geometry (count overrides scale with N)
  const study = allocationStudy(bare(N), { sizes: [N], target: TARGET, metric: 'aOp', players, parameters: REMAP_LATEST_PARAMS, trials: 0, seed: 1, levers: false, curves: false, permutations: PERMS });
  const z = study.perSize[N];
  library ??= study.library;
  perSize[N] = {
    baseline: z.baseline.value,
    plan: { ids: z.plan.ids, feasible: z.plan.feasible, effort: z.plan.effort, nominal: z.plan.nominal, derated: z.plan.derated },
    allOn: z.allOn.value, allOnDerated: z.allOnDerated.value,
    gains: z.gains.map((g) => ({ id: g.id, halfWidth: g.halfWidth, aOp: g.byMetric.aOp, delivered: { shapley: g.byMetric.delivered.shapley } })),
    attribution: z.attribution,
  };
  const top = z.gains.slice().sort((a, b) => b.byMetric.aOp.shapley - a.byMetric.aOp.shapley).slice(0, 4).map((g) => `${g.id} ${(g.byMetric.aOp.shapley * 100).toFixed(2)}`).join(', ');
  log(`N=${N}: baseline ${(z.baseline.value * 100).toFixed(3)} % | plan ${z.plan.feasible ? '' : '[infeasible] '}${z.plan.ids.join('+')} effort ${z.plan.effort} → ${(z.plan.nominal * 100).toFixed(3)} / ${(z.plan.derated * 100).toFixed(3)} % | all-on ${(z.allOn.value * 100).toFixed(3)} | top ${top}`);
}
mkdirSync(OUT_DIR, { recursive: true });
const out = { generated: new Date().toISOString(), arch: ARCH, sizes: SIZES, target: TARGET, permutations: PERMS, players, original: ORIGINAL, extensions: EXT, parameters: REMAP_LATEST_PARAMS, remap: { repo: 'https://github.com/lzq0927/remap', commit: 'f53ab7e', note: 'extension definitions unchanged since eaacb05' }, library, perSize };
writeFileSync(`${OUT_DIR}/${ARCH}.json`, JSON.stringify(out, null, 1));
log(`written ${OUT_DIR}/${ARCH}.json`);
