/**
 * HAC-D against the two upstream reliability repositories and against the 2026-10-20 “950 与 910C” report
 * (~/Documents/projects/output/HAC-D-950-910C-default-six.html), for docs/HACD_REMAP_COMPARISON.{zh,en}.html:
 *  1. the repository values check (scripts/check-reference-values.ts --json);
 *  2. HAC-D closed forms (A_op, A_run, MTBF_hw, MTTR_hw, delivered goodput, ledger) for five designs at 10k / 100k / 200k / 500k
 *     with the six default mechanisms — the repository catalog per card (no topology, = the repositories' arithmetic), the
 *     CloudMatrix384 template (910C), the Atlas 950 template default, the Atlas 950 main case of docs/ASCEND950_SCALING_RELIABILITY
 *     and UBL128 — plus the per-unit decomposition of the FIT per NPU against the catalog;
 *  3. ReMAP's review engine (the repositories' Monte Carlo, `training.retained-clean-progress`) on the same event rates through
 *     scripts/remap-bridge.ts (2,000 windows of 720 h each, ReMAP's seed policy);
 *  4. the other report's published numbers (transcribed below) against the HAC-D re-run.
 * Usage: node --import tsx scripts/hacd-remap-comparison.ts [--trials 2000] [--out docs/hacd-remap-comparison/results.json]
 */
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { topologyScenario, topologyBom, TOPOLOGY_SCALES, DOMAIN_UNIT } from '../packages/core/src/topology/index.js';
import { REFERENCE_EVENTS } from '../packages/core/src/scenario/referenceEvents.js';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { applyMechanisms, DEFAULT_PLAYERS } from '../packages/core/src/mechanisms/index.js';
import { evaluateScenario } from '../packages/core/src/scenario/evaluate.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { scenarioOf } from './ascend950-archs.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/hacd-remap-comparison/results.json';
const TRIALS = Number(flag('trials') ?? 2000);
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

/* ---------------- 1. repository values ---------------- */
const tmp = mkdtempSync(join(tmpdir(), 'hacd-remap-'));
let refcheck: unknown;
try {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/check-reference-values.ts', '--json', join(tmp, 'refcheck.json')], { stdio: ['ignore', 'pipe', 'inherit'] });
  refcheck = JSON.parse(readFileSync(join(tmp, 'refcheck.json'), 'utf8'));
} catch (e) { refcheck = { error: String(e) }; }
const git = (dir: string) => { try { return execFileSync('git', ['-C', dir, 'log', '-1', '--format=%H %cI %s'], { encoding: 'utf8' }).trim(); } catch { return null; } };

/* ---------------- 2. HAC-D closed forms ---------------- */
const DESIGNS: { id: string; make: (n: number) => Scenario }[] = [
  { id: 'refcat', make: (n) => applyMechanisms(referenceCatalog(n), DEFAULT_PLAYERS) },
  { id: 'a3tpl', make: (n) => topologyScenario('a3-ub384', n) },
  { id: 'a950tpl', make: (n) => topologyScenario('a950-ub2', n) },
  { id: 'a950main', make: (n) => scenarioOf('native', n) },
  { id: 'ubl128main', make: (n) => scenarioOf('ubl128', n) },
];
function kpis(s: Scenario) {
  const t = evaluateScenario(s, { structure: false }).training!;
  const rows = t.chain.rows;
  const lam = rows.reduce((a, r) => a + r.ratePerHour, 0);
  const lp = rows.reduce((a, r) => a + r.ratePerHour * r.meanPauseS, 0);
  const iso = t.subhealth ? t.subhealth.isolationInterruptionsPerHour : 0;
  const sdcDet = t.sdc?.detectedRatePerHour ?? 0;
  const sdcPause = s.sdc.stepRecovery ? s.sdc.detection.detectSeconds + s.sdc.stepRecovery.recoverSeconds + s.sdc.stepRecovery.stepSeconds : s.sdc.detection.detectSeconds + t.globalRecoveryS;
  const F = iso * t.globalRecoveryS + sdcDet * sdcPause;
  const aRun = 1 / (1 + (lp + F) / 3600);
  if (Math.abs(aRun - t.runningFraction) > 1e-9) throw new Error('running fraction does not close');
  const allRate = lam + iso + sdcDet;
  return {
    aOp: t.operationalAvailability, aRun: t.runningFraction, phi: 1 - t.operationalAvailability / t.runningFraction,
    lamHw: lam, mtbfHwH: 1 / lam, mttrS: lp / lam, isoPerH: iso, isoPauseS: t.globalRecoveryS, sdcDetPerH: sdcDet, sdcDetPauseS: sdcPause,
    mtbiAllH: 1 / allRate, meanPauseAllS: (lp + F) / allRate, mtbiUiH: t.mtbiHours,
    delivered: t.deliveredGoodput, goodputModel: t.headlineModel, ledger: t.ledger, tauS: s.workload.type === 'training' ? s.workload.intervalS : null,
  };
}
// the catalog's interruption FIT per card grouped by the hardware unit HAC-D attaches each domain to (the repositories' values)
const catalogByUnit: Record<string, number> = {};
for (const e of REFERENCE_EVENTS) if (e.type === 'hard') catalogByUnit[DOMAIN_UNIT[e.domainId]] = (catalogByUnit[DOMAIN_UNIT[e.domainId]] ?? 0) + e.fit;
const results: Record<string, Record<number, unknown>> = {};
const fitBreakdown: Record<string, unknown> = {};
for (const d of DESIGNS) {
  results[d.id] = {};
  for (const n of TOPOLOGY_SCALES) {
    const s = d.make(n);
    const k = kpis(s);
    const bom = s.topology.template ? topologyBom(s) : null;
    const hardFitPerNpu = bom ? bom.hardFitPerNpuTotal : k.lamHw / n * 1e9;
    results[d.id][n] = { ...k, hardFitPerNpu, byUnit: bom?.hardFitPerNpu ?? null, scaleOutSwitches: bom?.counts.scaleOutSwitches ?? 0, scaleOutTiers: bom?.counts.scaleOutTiers ?? 0, scaleOutLinks: bom?.counts.scaleOutLinks ?? 0 };
    if (n === TOPOLOGY_SCALES[0] && bom) fitBreakdown[d.id] = bom.hardFitPerNpu;
  }
  log(`${d.id}: A_op ${TOPOLOGY_SCALES.map((n) => ((results[d.id][n] as { aOp: number }).aOp * 100).toFixed(4)).join(' / ')} %`);
}

/* ---------------- 3. ReMAP's review engine on the same event rates ---------------- */
const engine: Record<string, Record<number, unknown>> = {};
for (const d of DESIGNS) {
  engine[d.id] = {};
  for (const n of TOPOLOGY_SCALES) {
    const f = join(tmp, `${d.id}-${n}.json`);
    writeFileSync(f, JSON.stringify(d.make(n)));
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/remap-bridge.ts', f, '--engine', 'review', '--trials', String(TRIALS), '--remap', 'remap/remap-latest', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const r = JSON.parse(out);
    engine[d.id][n] = { hacdClosedForm: { aOp: r.hacdClosedForm.aOp, delivered: r.hacdClosedForm.delivered, ledger: r.hacdClosedForm.ledger }, review: { engine: r.review.engine, trials: r.review.trials, aOp: r.review.aOp, delivered: r.review.delivered, ledger: r.review.ledger, counts: r.review.counts }, hacdLedgerSim: r.hacdLedger ? { aOp: r.hacdLedger.aOp, delivered: r.hacdLedger.delivered } : null, classFitPerCardHour: r.classFitPerCardHour };
  }
  log(`${d.id}: ReMAP review engine done`);
}
rmSync(tmp, { recursive: true, force: true });

/* ---------------- 4. the other report (transcribed from its Tables 1 and 4) ---------------- */
const OTHER = {
  file: '~/Documents/projects/output/HAC-D-950-910C-default-six.html (HAC-D v4.3 dd1fc99, 2026-10-20)',
  a950tpl: { 10000: { aOp: 0.999197, mtbfHwH: 32.340989, mttrS: 88.6182, delivered: 0.979799, mtbiAllH: 31.282922, meanPauseAllS: 90.3861, mtbiUiH: 31.738909 }, 100000: { aOp: 0.992031, mtbfHwH: 3.235056, mttrS: 88.5662, delivered: 0.949014, mtbiAllH: 3.129216, meanPauseAllS: 90.335, mtbiUiH: 3.174839 }, 200000: { aOp: 0.98419, mtbfHwH: 1.617562, mttrS: 88.5625, delivered: 0.916818, mtbiAllH: 1.564641, meanPauseAllS: 90.3314, mtbiUiH: 1.587453 }, 500000: { aOp: 0.961395, mtbfHwH: 0.647022, mttrS: 88.5632, delivered: 0.831058, mtbiAllH: 0.625854, meanPauseAllS: 90.3321, mtbiUiH: 0.634979 } },
  a3tpl: { 10000: { aOp: 0.999081, mtbfHwH: 29.662358, mttrS: 93.0236, delivered: 0.979663, mtbiAllH: 28.704885, meanPauseAllS: 94.8688, mtbiUiH: 29.088807 }, 100000: { aOp: 0.990853, mtbfHwH: 2.955144, mttrS: 93.0419, delivered: 0.947648, mtbiAllH: 2.85977, meanPauseAllS: 94.8956, mtbiUiH: 2.897903 }, 200000: { aOp: 0.981873, mtbfHwH: 1.477572, mttrS: 93.0419, delivered: 0.914215, mtbiAllH: 1.429885, meanPauseAllS: 94.8956, mtbiUiH: 1.448952 }, 500000: { aOp: 0.955886, mtbfHwH: 0.591029, mttrS: 93.0419, delivered: 0.825352, mtbiAllH: 0.571954, meanPauseAllS: 94.8955, mtbiUiH: 0.579581 } },
  hardware500k: { a950tpl: { scaleOutSwitches: 39066, scaleOutTiers: 3, scaleOutLinks: 3000000 }, a3tpl: { scaleOutSwitches: 109375, scaleOutTiers: 4, scaleOutLinks: 4000000 } },
};
const repro: unknown[] = [];
for (const id of ['a950tpl', 'a3tpl'] as const) for (const n of TOPOLOGY_SCALES) {
  const theirs = (OTHER[id] as Record<number, Record<string, number>>)[n];
  const mine = results[id][n] as Record<string, number>;
  for (const [k, v] of Object.entries(theirs)) {
    const dec = k === 'aOp' || k === 'delivered' ? 6 : k.endsWith('S') ? 4 : 6;
    const ok = Math.abs(mine[k] - v) <= 0.6 * Math.pow(10, -dec) * (k === 'aOp' || k === 'delivered' ? 1 : 1);
    repro.push({ design: id, npus: n, key: k, theirs: v, hacd: mine[k], ok });
  }
}
const reproOk = (repro as { ok: boolean }[]).every((r) => r.ok);
log(`other report reproduced: ${reproOk} (${(repro as { ok: boolean }[]).filter((r) => r.ok).length} / ${repro.length} values)`);

const out = {
  generated: new Date().toISOString(), trials: TRIALS, sizes: TOPOLOGY_SCALES,
  repositories: { remap: { dir: 'remap/remap-latest', head: git('remap/remap-latest') }, reference: { dir: 'ai-cluster-reliability-main', note: 'zip copy, identical to github.com/zy009197/ai-cluster-reliability 683afe8 (checked 2026-10-20 by a fresh clone)' } },
  refcheck, catalogByUnit, results, fitBreakdown, engine, other: OTHER, reproduction: { ok: reproOk, rows: repro },
};
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
