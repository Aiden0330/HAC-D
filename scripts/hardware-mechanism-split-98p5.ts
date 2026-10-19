/**
 * Hardware-versus-mechanism split of the 98.5 % A_op budget on the 54-event reference catalog (1 万 / 10 万 / 20 万 / 50 万卡),
 * companion of the AGREE study (docs/agree-allocation-98p5/results.json): for each size the hardware-only factor f (all hard
 * rates × f, bisection), the recovery-only factor g (all recovery stages × g, bisection), the iso-target curve f(g) (the pairs that
 * just meet the target), the effective recovery factor and residual hardware factor of each mechanism set (ReMAP original AGREE set,
 * latest ReMAP AGREE set, the planner's set of the earlier report, all mechanisms), the same for the recovery levers beyond the library
 * (automatic attempt 60 s, success 99.9 %, manual 30 min) on top of the latest AGREE set, and the budget ledger (baseline
 * unavailability → removed by the mechanisms → residual → slack or hardware task). Per-class MTBF values are derived in the builder
 * from the FIT values (MTBF_card = 1e9 / FIT h, cluster-level MTBF = MTBF_card / N).
 * Usage: node --import tsx scripts/hardware-mechanism-split-98p5.ts [--out docs/hardware-mechanism-split-98p5/results.json]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { cloneScenario, scaleAllRates, scaleRecovery } from '../packages/core/src/scenario/analysis.js';
import { applyMechanisms } from '../packages/core/src/mechanisms/index.js';
import { decompose, withSize, type StudyDecomposition } from '../packages/core/src/study/index.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/hardware-mechanism-split-98p5/results.json';
const AGREE = JSON.parse(readFileSync('docs/agree-allocation-98p5/results.json', 'utf8'));
const load = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const PREV_LATEST = load('docs/remap-latest-allocation-98p5/results.json')?.aOp ?? null;
const PREV_REMAP = load('docs/remap-allocation-98p5/results.json')?.study ?? null;
const TARGET = 0.985;
const SIZES = [10000, 100000, 200000, 500000];
const s0 = referenceCatalog(100000);
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

const aOp = (s: Scenario) => decompose(s, 'aOp').aOp;
function bisect(f: (x: number) => number): number {
  let lo: number, hi: number;
  if (f(1) >= TARGET) { lo = 1; hi = 1; while (f(hi) >= TARGET && hi < 1e4) hi *= 2; if (hi >= 1e4) return Infinity; } else { lo = 1e-4; hi = 1; if (f(lo) < TARGET) return 0; }
  for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (f(mid) >= TARGET) lo = mid; else hi = mid; }
  return lo;
}
const hwFactor = (s: Scenario) => bisect((x) => aOp(scaleAllRates(s, x)));
const recFactor = (s: Scenario) => bisect((x) => aOp(scaleRecovery(s, x)));
function withRecovery(sc: Scenario, patch: { autoSeconds?: number; success?: number; manualSeconds?: number }): Scenario {
  const c = cloneScenario(sc);
  if (c.recovery.mode !== 'mixture') return c;
  c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, seconds: patch.autoSeconds ?? c.recovery.automatic.seconds, successProbability: patch.success ?? c.recovery.automatic.successProbability }, manual: { ...c.recovery.manual, seconds: patch.manualSeconds ?? c.recovery.manual.seconds } };
  return c;
}
const summary = (d: StudyDecomposition, base: StudyDecomposition) => ({ aOp: d.aOp, unavailability: 1 - d.aOp, meanPauseS: d.meanPauseS, recoveryS: d.recoveryS, lambdaJob: d.lambdaJob, hardware: d.hardware, mtbiHours: d.mtbiHours, recoveryFactorEff: d.meanPauseS / base.meanPauseS, removedPts: base.aOp < d.aOp ? d.aOp - base.aOp : 0, byGroup: d.byGroup });

const out: Record<string, unknown> = { generated: new Date().toISOString(), target: TARGET, sizes: SIZES, notes: [
  'hardware factor f: every hard event rate × f (ARINC: identical factor per class) with the recovery of the row; allowed FIT = current × f; f > 1 = slack (acceptance limit above the current value), f < 1 = improvement task',
  'recovery factor g: detection, automatic attempt and manual stages × g with the baseline hardware; effective recovery factor of a mechanism set = its job-level mean pause ÷ the baseline mean pause',
  'iso-target curve: for each g the hardware factor f(g) at which A_op = 98.5 % (bisection on the full engine, not the first-order product)',
  'per-class MTBF (builder): MTBF_card,i = 1e9 / FIT_i hours per card for that event class (business-impact rate after the existing protection), cluster-level MTBF_i(N) = MTBF_card,i / N, hardware MTBI = 1 / Σ λ_i',
] };
const perSize: Record<number, unknown> = {};
const G_GRID = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2];
for (const N of SIZES) {
  const s = withSize(s0, N);
  const base = decompose(s, 'aOp');
  const f = hwFactor(s);
  const g = recFactor(s);
  const iso = G_GRID.map((gg) => ({ g: gg, f: hwFactor(scaleRecovery(s, gg)), meanPauseS: decompose(scaleRecovery(s, gg), 'aOp').meanPauseS }));
  const sets: Record<string, { label: string; ids: string[]; params: Record<string, Record<string, number>> }> = {};
  const az = (k: string) => AGREE.sets[k].perSize[N];
  sets.remapAgree = { label: 'ReMAP 原有机制 · AGREE 集', ids: az('remap').agree.ids, params: AGREE.sets.remap.nominal };
  sets.latestAgree = { label: 'ReMAP 最新机制集 · AGREE 集', ids: az('latest').agree.ids, params: AGREE.sets.latest.nominal };
  if (PREV_LATEST) sets.latestPlanner = { label: 'ReMAP 最新机制集 · 规划器集', ids: PREV_LATEST.perSize[N].plan.ids, params: AGREE.sets.latest.nominal };
  if (PREV_REMAP) sets.remapPlanner = { label: 'ReMAP 原有机制 · 规划器集', ids: PREV_REMAP.perSize[N].plan.ids, params: AGREE.sets.remap.nominal };
  sets.latestAll = { label: 'ReMAP 最新机制集 · 全部 23 项', ids: AGREE.sets.latest.players, params: AGREE.sets.latest.nominal };
  const setRows: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(sets)) {
    const sc = applyMechanisms(s, def.ids, def.params);
    const d = decompose(sc, 'aOp');
    setRows[key] = { ...def, ...summary(d, base), hardwareFactor: hwFactor(sc), recoveryFactorUniform: recFactor(sc) };
  }
  // recovery levers beyond the library on top of the latest AGREE set
  const latestSc = applyMechanisms(s, sets.latestAgree.ids, sets.latestAgree.params);
  const levers = [
    { id: 'auto60', label: '自动尝试 180 → 60 s', patch: { autoSeconds: 60 } }, { id: 'ps999', label: '自动成功率 99 → 99.9 %', patch: { success: 0.999 } }, { id: 'manual30', label: '人工 120 → 30 min', patch: { manualSeconds: 1800 } },
    { id: 'all3', label: '三项同时', patch: { autoSeconds: 60, success: 0.999, manualSeconds: 1800 } },
  ].map((l) => { const sc = withRecovery(latestSc, l.patch); const d = decompose(sc, 'aOp'); return { ...l, ...summary(d, base), hardwareFactor: hwFactor(sc) }; });
  const budget = 1 - TARGET;
  const ledger = (row: { unavailability: number; hardwareFactor: number }) => ({ baselineU: 1 - base.aOp, budget, removedByMechanisms: (1 - base.aOp) - row.unavailability, residualU: row.unavailability, gap: row.unavailability - budget, hardwareFactor: row.hardwareFactor, hardwareShareOfReduction: (1 - base.aOp) - budget > 0 ? Math.max(0, row.unavailability - budget) / ((1 - base.aOp) - budget) : 0, mechanismShareOfReduction: (1 - base.aOp) - budget > 0 ? Math.min(1, ((1 - base.aOp) - row.unavailability) / ((1 - base.aOp) - budget)) : 0 });
  perSize[N] = { N, baseline: { aOp: base.aOp, unavailability: 1 - base.aOp, meanPauseS: base.meanPauseS, recoveryS: base.recoveryS, lambdaJob: base.lambdaJob, hardware: base.hardware, mtbiHours: base.mtbiHours, stages: base.stages, byGroup: base.byGroup }, hardwareOnly: { factor: f }, recoveryOnly: { factor: g, recoveryStarS: base.recoveryS * g, meanPauseStarS: base.meanPauseS * g }, iso, sets: setRows, levers, ledgers: Object.fromEntries(Object.entries(setRows).map(([k, r]) => [k, ledger(r as { unavailability: number; hardwareFactor: number })])) };
  log(`N=${N}: baseline ${(base.aOp * 100).toFixed(3)} %, hw-only ×${f.toFixed(3)}, rec-only ×${g.toFixed(3)} (R̄* ${(base.recoveryS * g).toFixed(0)} s); ${Object.entries(setRows).map(([k, r]) => { const x = r as { aOp: number; recoveryFactorEff: number; hardwareFactor: number }; return `${k} ${(x.aOp * 100).toFixed(2)} % g_eff ${x.recoveryFactorEff.toFixed(3)} f_req ×${x.hardwareFactor.toFixed(3)}`; }).join('; ')}; levers ${levers.map((l) => `${l.id} ${(l.aOp * 100).toFixed(2)} ×${l.hardwareFactor.toFixed(2)}`).join(', ')}`);
}
out.perSize = perSize;
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
