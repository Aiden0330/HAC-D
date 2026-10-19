/**
 * AGREE-method allocation study at a 98.5 % A_op target on the 54-event reference catalog (1 万 / 10 万 / 20 万 / 50 万卡),
 * for four mechanism sets: ReMAP's original mechanisms (8 with transforms), the 16 audited new mechanisms (15 with transforms,
 * provisional integration assumptions), both together, and the latest ReMAP's set (original + 16 extensions at ReMAP's explicit
 * scenario, scripts/remap-latest-params.ts).
 *
 * AGREE (series system): subsystem i with n_i modules, importance E_i = P(system fails | i fails) and duty t_i/T receives
 *   R_i = 1 − (1 − R*^{n_i/N}) / E_i,  λ_i = −ln R_i / t_i   (packages/core/src/allocation/index.ts `agree`).
 * Applied to an availability target the same weights split the unavailability budget: with every hard interruption stopping the
 * job (E_i = 1) and every class exposed over the whole window (t_i = T), the first-order form is
 *   pt_i* = (1 − A* − Σ non-domain pauses) · n_i / N,       λ_i* = pt_i* · 3600 / (A* · p̄_i),       k_i = λ_i / λ_i*,
 * where p̄_i is the class's mean pause per event under the mechanism set (the chain's expected pause) and the non-domain lines
 * (sub-health isolation, detected silent corruption, predictor false alarms, silent-corruption pauses) are fixed subsystems
 * deducted first. The reference catalog states every class per card-hour, so n_i = N for all classes and AGREE coincides with
 * equal apportionment over the 18 hard classes (HAC-D's `coincidingMethods`); a physical-unit variant (n_i = cards / nodes /
 * racks / zones by the class's scope, assumed) is computed as a sensitivity.
 *
 * Per size and set: (1) hardware-only allocation (ARINC uniform factor, AGREE equal and physical-unit variants, Albert minimum
 * effort); (2) AGREE-driven mechanism selection — at each step the mechanism with the largest removal of over-budget excess per
 * unit effort (class-weighted) is added until the target holds nominally and derated (the planner's stopping rule), the strict
 * continuation (until no class excess can be removed) is recorded too; (3) per-class residuals k_i (strict) and k_i′ after the
 * slack of the under-budget classes is reallocated to the over-budget ones with the same weights (no class may get worse),
 * allowed FIT, required mean pause, key mechanism and the parameter level it would need to close the class alone;
 * (4) closure attribution per mechanism (single and last-removed excess reduction); (5) engine re-evaluation of the allocated
 * rates (closure check), curves A_op(N) with the largest feasible N, and a window-ledger verification (Wilson interval).
 * Usage: node --import tsx scripts/agree-allocation-98p5.ts [--trials 400] [--out docs/agree-allocation-98p5/results.json]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { computeCounts, componentInstances } from '../packages/core/src/scenario/build.js';
import { cloneScenario } from '../packages/core/src/scenario/analysis.js';
import { MECHANISM_LIBRARY, mechanismById, applyMechanisms } from '../packages/core/src/mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { provisionalParameters } from '../packages/core/src/mechanisms/auditLibrary.js';
import { agree, arinc, minimumEffort, type Subsystem } from '../packages/core/src/allocation/index.js';
import { decompose, withSize, groupOf, NON_DOMAIN_GROUPS, type StudyDecomposition } from '../packages/core/src/study/index.js';
import { buildLedgerRun, simulateLedgerReplications } from '../packages/core/src/mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict, summaryStat } from '../packages/core/src/math/stats.js';
import { REMAP_LATEST_PARAMS } from './remap-latest-params.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const TRIALS = Number(flag('trials') ?? 400);
const OUT = flag('out') ?? 'docs/agree-allocation-98p5/results.json';
const SIZES = [10000, 100000, 200000, 500000];
const TARGET = 0.985;
const BUDGET = 1 - TARGET;
const SEED = 1;
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

const ORIGINAL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
const EXT = MECHANISM_LIBRARY.filter((m) => m.audit && m.apply).map((m) => m.id);
type SetKey = 'remap' | 'new' | 'combined' | 'latest';
const SETS: Record<SetKey, { label: { zh: string; en: string }; players: string[]; params: Record<string, Record<string, number>>; ref: string }> = {
  remap: { label: { zh: 'ReMAP 原有机制', en: 'ReMAP original mechanisms' }, players: ORIGINAL, params: {}, ref: 'docs/remap-allocation-98p5/results.json' },
  new: { label: { zh: '新增 16 项机制（临时假设）', en: '16 new mechanisms (provisional)' }, players: EXT, params: provisionalParameters(EXT), ref: 'docs/mechanism-comparison-98p5/results.json' },
  combined: { label: { zh: '原有 + 新增（临时假设）', en: 'ReMAP + new (provisional)' }, players: [...ORIGINAL, ...EXT], params: provisionalParameters(EXT), ref: 'docs/mechanism-comparison-98p5/results.json' },
  latest: { label: { zh: 'ReMAP 最新机制集（显式情景）', en: 'Latest ReMAP set (explicit scenario)' }, players: [...ORIGINAL, ...EXT], params: REMAP_LATEST_PARAMS, ref: 'docs/remap-latest-allocation-98p5/results.json' },
};
/** physical-unit scope of each hard class for the AGREE complexity variant (assumed from the class description) */
const SCOPE: Record<string, 'gpu' | 'node' | 'rack' | 'zone'> = { CORE: 'gpu', SRAM: 'gpu', IOD: 'gpu', MODULE: 'gpu', MEMT: 'gpu', MEMP: 'gpu', NIC: 'gpu', OPT: 'gpu', BOXIO: 'node', CPU: 'node', DDR: 'node', SSD: 'node', MGMT: 'node', UNKNOWN: 'node', FABRIC: 'rack', POWER: 'rack', COOL: 'rack', STORAGE: 'zone' };
/** the parameter a mechanism would move to close a class on its own: 'down' = smaller is better (searched in [0, nominal]), 'up' = larger is better (searched in [nominal, max]) */
const PRIMARY: Record<string, { key: string; dir: 'down' | 'up'; max?: number }> = {
  'D-HARD': { key: 'detectSeconds', dir: 'down' }, 'D-SLOW': { key: 'detectSeconds', dir: 'down' }, 'D-SDC': { key: 'coverage', dir: 'up', max: 1 }, 'R-SDC': { key: 'recoverSeconds', dir: 'down' },
  'R-REPLAY': { key: 'successSeconds', dir: 'down' }, 'R-PROCESS': { key: 'successSeconds', dir: 'down' }, 'R-ELASTIC': { key: 'recoverSeconds', dir: 'down' }, 'C-FAST': { key: 'saveSeconds', dir: 'down' },
  'R-NETFAIL': { key: 'successSeconds', dir: 'down' }, 'R-HOTSWAP': { key: 'successSeconds', dir: 'down' }, 'C-MEM': { key: 'loadSavingSeconds', dir: 'up', max: 180 }, 'P-PREDICT': { key: 'recall', dir: 'up', max: 1 },
  'H-LEMON': { key: 'reduction', dir: 'up', max: 1 }, 'H-SWEEP': { key: 'rateFactor', dir: 'down' }, 'H-RELIABILITY': { key: 'reduction', dir: 'up', max: 1 }, 'D-SDC-DMR': { key: 'coverage', dir: 'up', max: 1 },
  'R-LINK-LOCAL': { key: 'successSeconds', dir: 'down' }, 'R-FABRIC-DEGRADE': { key: 'switchSeconds', dir: 'down' }, 'H-CONTROL-CONTINUITY': { key: 'pauseSeconds', dir: 'down' }, 'R-WARM-PROCESS': { key: 'startupTargetSeconds', dir: 'down' },
  'R-RUNTIME-SNAPSHOT': { key: 'startupTargetSeconds', dir: 'down' }, 'R-CANN-GRAPH': { key: 'graphTargetSeconds', dir: 'down' }, 'C-ASYNC': { key: 'blockingTargetSeconds', dir: 'down' }, 'C-LOSSLESS': { key: 'compressionRatio', dir: 'up', max: 8 },
  'D-RECOVERY-CLASSIFY': { key: 'manualProbabilityTarget', dir: 'down' }, 'D-SDC-FP8': { key: 'detectionTarget', dir: 'up', max: 1 }, 'D-SDC-FP4': { key: 'detectionTarget', dir: 'up', max: 1 }, 'D-ABFT': { key: 'upstreamDetection', dir: 'up', max: 1 },
  'D-NET-SDC': { key: 'detectionTarget', dir: 'up', max: 1 }, 'H-SDC-SCREEN': { key: 'occurrenceReduction', dir: 'up', max: 1 }, 'R-HCCL-ELASTIC': { key: 'communicationTargetSeconds', dir: 'down' },
};

interface ClassInfo { id: string; name: string; group: string; count: number; physCount: number; scope: string; fit: number; lambda: number; flags: Record<string, number> }
interface ClassBudget { pts: number; weight: number }
interface Budget { fixed: number; free: number; classes: Record<string, ClassBudget> }

const s0 = referenceCatalog(100000);
const scaleClassRates = (s: Scenario, f: Record<string, number>): Scenario => { const c = cloneScenario(s); for (const comp of c.components) if (f[comp.id] !== undefined) comp.failure = { ...comp.failure, value: comp.failure.value * f[comp.id] }; return c; };
const aOpOf = (s: Scenario) => decompose(s, 'aOp').aOp;
const effortOf = (id: string) => mechanismById(id).effort;
const nominalParams = (players: string[], params: Record<string, Record<string, number>>) => Object.fromEntries(players.map((id) => [id, { ...mechanismById(id).parameters, ...(params[id] ?? {}) }]));
const deratedParams = (players: string[], params: Record<string, Record<string, number>>) => Object.fromEntries(players.map((id) => [id, derateParameters({ ...mechanismById(id).parameters, ...(params[id] ?? {}) }, DERATE_DEFAULT)]));

function classesOf(s: Scenario): ClassInfo[] {
  const counts = computeCounts(s);
  const out: ClassInfo[] = [];
  for (const c of s.components) {
    if (!c.enabled) continue;
    const ci = componentInstances(c, counts, s.measures.subhealthThreshold);
    if (ci.lambda <= 0) continue;
    const dom = c.id.replace(/-(hard|slow|sdc)$/, '');
    const scope = SCOPE[dom] ?? 'gpu';
    const physCount = scope === 'gpu' ? counts.gpus : scope === 'node' ? counts.nodes : scope === 'rack' ? counts.racks : counts.zones;
    out.push({ id: c.id, name: c.name?.zh ?? c.name?.en ?? c.id, group: groupOf(c), count: ci.total, physCount, scope, fit: ci.lambda * 1e9, lambda: ci.lambda * ci.total, flags: { replay: ci.applicable.replay, process: ci.applicable.process, elastic: ci.applicable.elastic, netfail: ci.applicable.netfail, hotswap: ci.applicable.hotswap, predict: ci.applicable.predict } });
  }
  return out;
}
const weightsOf = (classes: ClassInfo[], variant: 'equal' | 'physical') => { const n = classes.map((c) => (variant === 'equal' ? c.count : c.physCount)); const tot = n.reduce((a, b) => a + b, 0); return Object.fromEntries(classes.map((c, i) => [c.id, n[i] / tot])); };
const fixedOf = (d: StudyDecomposition) => NON_DOMAIN_GROUPS.reduce((a, g) => a + (d.byGroup[g] ?? 0), 0);
function budgetOf(d: StudyDecomposition, classes: ClassInfo[], w: Record<string, number>): Budget {
  const fixed = fixedOf(d);
  const free = Math.max(0, BUDGET - fixed);
  return { fixed, free, classes: Object.fromEntries(classes.map((c) => [c.id, { pts: free * w[c.id], weight: w[c.id] }])) };
}
const ptsOf = (d: StudyDecomposition, id: string) => d.byDomain[id]?.points ?? 0;
const excessOf = (d: StudyDecomposition, b: Budget, classes: ClassInfo[]) => classes.reduce((a, c) => a + Math.max(0, ptsOf(d, c.id) - b.classes[c.id].pts), 0);
/** allowed aggregate rate per hour at the class's current mean pause: pt* = A* λ* p̄ / 3600 */
const lambdaStarOf = (pts: number, pauseS: number) => (pauseS > 0 ? (pts * 3600) / (TARGET * pauseS) : Infinity);

interface ClassRow {
  id: string; pts: number; ptsDerated: number; budget: number; weight: number; pauseS: number; pauseStarS: number; lambda: number; lambdaStar: number; k: number; allowedFit: number;
  realloc: { pts: number; k: number; allowedFit: number }; over: boolean; overRealloc: boolean; key?: { id: string; lastRemoved: number }; requirement?: { param: string; dir: 'down' | 'up'; nominal: number; needed?: number; closable: boolean; note: string };
}
/** strict AGREE rows and the slack reallocation (under-budget classes keep their current points; the rest is split over the over-budget classes by weight) */
function classRows(d: StudyDecomposition, dD: StudyDecomposition, b: Budget, classes: ClassInfo[]): { rows: ClassRow[]; realloc: { remaining: number; overIds: string[] } } {
  const rows: ClassRow[] = classes.map((c) => {
    const pts = ptsOf(d, c.id);
    const pauseS = d.byDomain[c.id]?.meanPauseS ?? 0;
    const lambda = d.byDomain[c.id]?.ratePerHour ?? c.lambda;
    const budget = b.classes[c.id].pts;
    const lambdaStar = lambdaStarOf(budget, pauseS);
    const k = lambda / lambdaStar;
    return { id: c.id, pts, ptsDerated: ptsOf(dD, c.id), budget, weight: b.classes[c.id].weight, pauseS, pauseStarS: lambda > 0 ? (budget * 3600) / (TARGET * lambda) : Infinity, lambda, lambdaStar, k, allowedFit: (lambdaStar / c.count) * 1e9, realloc: { pts: budget, k, allowedFit: (lambdaStar / c.count) * 1e9 }, over: k > 1, overRealloc: k > 1 };
  });
  // iterative reallocation (water-filling): a class whose share of the remaining budget covers its current points keeps those points
  // and leaves the pool; the pool is re-split over the classes still over budget by the same weights until the set is stable
  let overSet = rows.filter((r) => r.over).map((r) => r.id);
  let remaining = b.free;
  for (let it = 0; it <= rows.length && overSet.length; it++) {
    remaining = b.free - rows.filter((r) => !overSet.includes(r.id)).reduce((a, r) => a + r.pts, 0);
    const wOver = rows.filter((r) => overSet.includes(r.id)).reduce((a, r) => a + r.weight, 0);
    const drop = overSet.filter((id) => { const r = rows.find((x) => x.id === id)!; return (remaining * r.weight) / wOver >= r.pts; });
    if (!drop.length) break;
    overSet = overSet.filter((id) => !drop.includes(id));
  }
  const wOver = rows.filter((r) => overSet.includes(r.id)).reduce((a, r) => a + r.weight, 0);
  for (const r of rows) {
    const count = classes.find((c) => c.id === r.id)!.count;
    if (!overSet.includes(r.id)) { r.realloc = { pts: r.pts, k: 1, allowedFit: (r.lambda / count) * 1e9 }; r.overRealloc = false; continue; }
    const pts = wOver > 0 ? (remaining * r.weight) / wOver : r.budget;
    const lam = lambdaStarOf(pts, r.pauseS);
    r.realloc = { pts, k: r.lambda / lam, allowedFit: (lam / count) * 1e9 };
    r.overRealloc = r.realloc.k > 1 + 1e-9;
  }
  return { rows, realloc: { remaining, overIds: overSet } };
}

interface Step { id: string; phase: 1 | 2; closure: number; score: number; aOp: number; derated: number; excess: number; overCount: number }
/**
 * AGREE-driven selection in two phases. Phase 1 (close the classes): add the mechanism removing the most over-budget excess per
 * unit effort until every class is within its budget or no mechanism removes any excess. Phase 2 (create slack): if the target does
 * not hold nominally and derated after phase 1, the remaining over-budget classes have no closer of their own, so mechanisms acting
 * on the other classes are added by A_op gain per effort — their slack is handed to the over-budget classes by the reallocation.
 * The returned set is the state at which the target first held (phase 1 may continue closing classes: `strict`).
 */
function agreeSelect(s: Scenario, classes: ClassInfo[], w: Record<string, number>, players: string[], nom: Record<string, Record<string, number>>, der: Record<string, Record<string, number>>) {
  const ids = players.filter((id) => !!mechanismById(id).apply);
  const ev = (sel: string[], prm: Record<string, Record<string, number>>) => decompose(applyMechanisms(s, sel, prm), 'aOp');
  const selected: string[] = [];
  let cur = ev([], nom);
  let curD = ev([], der);
  const steps: Step[] = [];
  const state = () => { const b = budgetOf(cur, classes, w); return { excess: excessOf(cur, b, classes), overCount: classes.filter((c) => ptsOf(cur, c.id) > b.classes[c.id].pts).length }; };
  let systemIds: string[] | undefined;
  let systemStep = -1;
  const feasibleNow = () => cur.aOp >= TARGET && curD.aOp >= TARGET;
  if (feasibleNow()) { systemIds = []; systemStep = 0; }
  const allowed = (id: string) => { if (selected.includes(id)) return false; const req = mechanismById(id).requires ?? []; return !req.some((r) => !selected.includes(r) && ids.includes(r)); };
  const take = (best: { id: string; closure: number; score: number; d: StudyDecomposition }, phase: 1 | 2) => {
    selected.push(best.id);
    cur = best.d;
    curD = ev(selected, der);
    steps.push({ id: best.id, phase, closure: best.closure, score: best.score, aOp: cur.aOp, derated: curD.aOp, ...state() });
    if (systemIds === undefined && feasibleNow()) { systemIds = [...selected]; systemStep = steps.length; }
  };
  for (let it = 0; it < ids.length; it++) {
    const b = budgetOf(cur, classes, w);
    const over = classes.filter((c) => ptsOf(cur, c.id) > b.classes[c.id].pts);
    if (!over.length) break;
    let best: { id: string; closure: number; score: number; d: StudyDecomposition } | undefined;
    for (const id of ids) {
      if (!allowed(id)) continue;
      const d = ev([...selected, id], nom);
      const bd = budgetOf(d, classes, w);
      let closure = 0;
      for (const c of over) closure += Math.max(0, ptsOf(cur, c.id) - Math.max(ptsOf(d, c.id), bd.classes[c.id].pts));
      // a mechanism that enlarges the fixed lines (detected silent-corruption pauses, isolation) shrinks every class budget: count that against it
      closure -= Math.max(0, bd.fixed - b.fixed);
      if (closure <= 1e-9) continue;
      const score = closure / Math.max(1, effortOf(id));
      if (!best || score > best.score) best = { id, closure, score, d };
    }
    if (!best) break;
    take(best, 1);
  }
  const phase1 = { ids: [...selected], effort: selected.reduce((a, id) => a + effortOf(id), 0), aOp: cur.aOp, derated: curD.aOp, ...state() };
  let phase2Steps = 0;
  while (!feasibleNow()) {
    let best: { id: string; closure: number; score: number; d: StudyDecomposition } | undefined;
    for (const id of ids) {
      if (!allowed(id)) continue;
      const d = ev([...selected, id], nom);
      const gain = d.aOp - cur.aOp;
      if (gain <= 1e-9) continue;
      const score = gain / Math.max(1, effortOf(id));
      if (!best || score > best.score) best = { id, closure: gain, score, d };
    }
    if (!best) break;
    take(best, 2);
    phase2Steps++;
  }
  const sysIds = systemIds ?? [...selected];
  return { ids: sysIds, feasible: systemIds !== undefined, effort: sysIds.reduce((a, id) => a + effortOf(id), 0), steps, systemStep, phase1, phase2Steps, final: { ids: [...selected], aOp: cur.aOp, derated: curD.aOp, ...state() } };
}

function verify(s: Scenario, trials: number, seed: number) {
  const run = buildLedgerRun(s, { trials, seed, target: TARGET });
  const rows = simulateLedgerReplications(run.spec, 0, trials, seed);
  const vals = rows.map((r) => r.operationalAvailability);
  const k = vals.filter((x) => x >= TARGET).length;
  const est = proportionEstimate(k, trials);
  return { trials, seed, value: summaryStat(vals), pAtLeastTarget: k / trials, wilson: [est.low, est.high] as [number, number], verdict: proportionVerdict(est, 0.9) };
}
function bisectFactor(f: (x: number) => number): number {
  let lo: number, hi: number;
  if (f(1) >= TARGET) { lo = 1; hi = 1; while (f(hi) >= TARGET && hi < 1e4) hi *= 2; if (hi >= 1e4) return Infinity; } else { lo = 1e-4; hi = 1; if (f(lo) < TARGET) return 0; }
  for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (f(mid) >= TARGET) lo = mid; else hi = mid; }
  return lo;
}
const uniformRateFactor = (s: Scenario) => bisectFactor((x) => aOpOf(scaleClassRates(s, Object.fromEntries(s.components.map((c) => [c.id, x])))));
const fitRows = (r: ReturnType<typeof arinc>, classes: ClassInfo[]) => r.rows.map((x) => { const c = classes.find((q) => q.id === x.id)!; return { id: x.id, allowedFit: (x.lambdaAggregate / c.count) * 1e9, improvementFactor: x.currentAggregate !== undefined && x.lambdaAggregate > 0 ? x.currentAggregate / x.lambdaAggregate : 1 }; });

/** the parameter level of mechanism `id` (inside the set) at which class `cid` just meets its budget */
function requirement(s: Scenario, classes: ClassInfo[], w: Record<string, number>, sel: string[], nom: Record<string, Record<string, number>>, id: string, cid: string) {
  const pr = PRIMARY[id];
  if (!pr) return undefined;
  const nominal = nom[id]?.[pr.key];
  if (nominal === undefined) return undefined;
  const at = (x: number) => { const prm = { ...nom, [id]: { ...nom[id], [pr.key]: x } }; const d = decompose(applyMechanisms(s, sel, prm), 'aOp'); const b = budgetOf(d, classes, w); return ptsOf(d, cid) - b.classes[cid].pts; };
  const lo = pr.dir === 'down' ? 0 : nominal;
  const hi = pr.dir === 'down' ? nominal : (pr.max ?? nominal * 10);
  const best = pr.dir === 'down' ? lo : hi;
  const gapNominal = at(nominal);
  if (gapNominal <= 0) return { param: pr.key, dir: pr.dir, nominal, needed: nominal, closable: true, note: 'closed at the nominal value' };
  if (at(best) > 0) return { param: pr.key, dir: pr.dir, nominal, closable: false, note: pr.dir === 'down' ? 'not closed even at 0' : `not closed even at ${best}` };
  let a = lo, b = hi; // monotone: down → f(lo) ≤ 0 < f(hi); up → f(lo) > 0 ≥ f(hi)
  for (let i = 0; i < 40; i++) { const mid = (a + b) / 2; const g = at(mid); if (pr.dir === 'down') { if (g <= 0) a = mid; else b = mid; } else { if (g <= 0) b = mid; else a = mid; } }
  return { param: pr.key, dir: pr.dir, nominal, needed: pr.dir === 'down' ? a : b, closable: true, note: pr.dir === 'down' ? `must drop from ${nominal} to ≤ ${(pr.dir === 'down' ? a : b).toPrecision(3)}` : `must rise from ${nominal} to ≥ ${b.toPrecision(3)}` };
}

const load = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
function plannerRef(key: SetKey, N: number): { ids: string[]; effort: number; nominal: number; derated: number; feasible: boolean } | undefined {
  const j = load(SETS[key].ref);
  if (!j) return undefined;
  const st = key === 'remap' ? j.study : key === 'latest' ? j.aOp : j.sets?.[key]?.study;
  const z = st?.perSize?.[N];
  if (!z) return undefined;
  return { ids: z.plan.ids, effort: z.plan.effort, nominal: z.plan.nominal, derated: z.plan.derated, feasible: z.plan.feasible };
}

/* ------------------------------------------------------------------ run ------------------------------------------------------------------ */
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
const grid = Array.from({ length: 15 }, (_, i) => Math.round(Math.exp(Math.log(5000) + (i / 14) * Math.log(1000000 / 5000))));
const common: Record<number, unknown> = {};
const classesBySize: Record<number, ClassInfo[]> = {};
for (const N of SIZES) {
  const s = withSize(s0, N);
  const classes = classesOf(s);
  classesBySize[N] = classes;
  const d = decompose(s, 'aOp');
  const wEq = weightsOf(classes, 'equal');
  const wPh = weightsOf(classes, 'physical');
  const bEq = budgetOf(d, classes, wEq);
  const bPh = budgetOf(d, classes, wPh);
  const f = uniformRateFactor(s);
  const lambdaStar = d.hardware * f;
  const subs: Subsystem[] = classes.map((c) => ({ id: c.id, name: c.name, count: c.count, currentLambda: c.lambda / c.count }));
  const subsPh: Subsystem[] = classes.map((c) => ({ id: c.id, name: c.name, count: c.physCount, currentLambda: c.lambda / c.physCount }));
  const rowsEq = classRows(d, d, bEq, classes);
  const rowsPh = classRows(d, d, bPh, classes);
  // closure checks: every class at its strict AGREE rate (slack classes may degrade) → A_op should sit at the target; reallocated rates (no degradation) → ≥ target
  const strictCheck = aOpOf(scaleClassRates(s, Object.fromEntries(rowsEq.rows.map((r) => [r.id, 1 / r.k]))));
  const reallocCheck = aOpOf(scaleClassRates(s, Object.fromEntries(rowsEq.rows.map((r) => [r.id, r.overRealloc ? 1 / r.realloc.k : 1]))));
  const horizon = Math.min(24, 0.1 / Math.max(lambdaStar, 1e-12));
  common[N] = {
    N, counts: computeCounts(s), classes: classes.map((c) => ({ id: c.id, name: c.name, group: c.group, count: c.count, physCount: c.physCount, scope: c.scope, fit: c.fit, lambda: c.lambda, flags: c.flags })),
    baseline: { aOp: d.aOp, aRun: d.aRun, lambdaJob: d.lambdaJob, hardware: d.hardware, mtbiHours: d.mtbiHours, recoveryS: d.recoveryS, meanPauseS: d.meanPauseS, byGroup: d.byGroup, fixed: fixedOf(d) },
    budget: { total: BUDGET, fixed: bEq.fixed, free: bEq.free, perClassEqual: bEq.free / classes.length, weightsEqual: wEq, weightsPhysical: wPh },
    hardwareOnly: {
      uniformFactor: f, lambdaStar, mtbiStarHours: lambdaStar + d.isolation > 0 ? 1 / (lambdaStar + d.isolation) : Infinity,
      arinc: fitRows(arinc(subs, lambdaStar), classes), agreeCore: { notes: agree(subs, lambdaStar, horizon).notes, rows: fitRows(agree(subs, lambdaStar, horizon), classes) },
      agreePhysicalCore: { notes: agree(subsPh, lambdaStar, horizon).notes, rows: agree(subsPh, lambdaStar, horizon).rows.map((x) => { const c = classes.find((q) => q.id === x.id)!; return { id: x.id, allowedFit: (x.lambdaAggregate / c.count) * 1e9, improvementFactor: c.lambda / x.lambdaAggregate }; }) },
      minimumEffort: { notes: minimumEffort(subs, lambdaStar).notes, rows: fitRows(minimumEffort(subs, lambdaStar), classes) },
      agreeEqual: { rows: rowsEq.rows, realloc: rowsEq.realloc, excess: excessOf(d, bEq, classes), overCount: rowsEq.rows.filter((r) => r.over).length, check: { strict: strictCheck, realloc: reallocCheck } },
      agreePhysical: { rows: rowsPh.rows, realloc: rowsPh.realloc, excess: excessOf(d, bPh, classes), overCount: rowsPh.rows.filter((r) => r.over).length },
    },
    verificationBaseline: TRIALS > 0 ? verify(s, TRIALS, SEED) : undefined,
  };
  log(`N=${N}: baseline ${(d.aOp * 100).toFixed(3)} %, fixed ${(bEq.fixed * 100).toFixed(3)} pt, per-class budget ${(bEq.free / classes.length * 100).toFixed(4)} pt, over ${rowsEq.rows.filter((r) => r.over).length}/${classes.length}, uniform ×${f.toFixed(3)}, strict check ${(strictCheck * 100).toFixed(3)} %, realloc check ${(reallocCheck * 100).toFixed(3)} %`);
}

const sets: Record<string, unknown> = {};
for (const key of Object.keys(SETS) as SetKey[]) {
  const def = SETS[key];
  const players = def.players.filter((id) => !!mechanismById(id).apply);
  const nom = nominalParams(players, def.params);
  const der = deratedParams(players, def.params);
  const perSize: Record<number, unknown> = {};
  const curveSets: Record<string, string[]> = {};
  for (const N of SIZES) {
    const s = withSize(s0, N);
    const classes = classesBySize[N];
    const w = weightsOf(classes, 'equal');
    const sel = agreeSelect(s, classes, w, players, nom, der);
    const planned = applyMechanisms(s, sel.ids, nom);
    const d = decompose(planned, 'aOp');
    const dD = decompose(applyMechanisms(s, sel.ids, der), 'aOp');
    const b = budgetOf(d, classes, w);
    const rows = classRows(d, dD, b, classes);
    // key mechanism per over-budget class (largest return of its points when removed from the set) and the parameter it would need
    for (const r of rows.rows) {
      const baseOver = ptsOf(decompose(s, 'aOp'), r.id) > budgetOf(decompose(s, 'aOp'), classes, w).classes[r.id].pts;
      if (!baseOver && !r.over) continue;
      let best: { id: string; lastRemoved: number } | undefined;
      for (const id of sel.ids) {
        const dm = decompose(applyMechanisms(s, sel.ids.filter((x) => x !== id), nom), 'aOp');
        const back = ptsOf(dm, r.id) - r.pts;
        if (back > 1e-9 && (!best || back > best.lastRemoved)) best = { id, lastRemoved: back };
      }
      if (best) { r.key = best; r.requirement = requirement(s, classes, w, sel.ids, nom, best.id, r.id); }
    }
    const strictCheck = aOpOf(applyMechanisms(scaleClassRates(s, Object.fromEntries(rows.rows.map((r) => [r.id, 1 / r.k]))), sel.ids, nom));
    const reallocCheck = aOpOf(applyMechanisms(scaleClassRates(s, Object.fromEntries(rows.rows.map((r) => [r.id, r.overRealloc ? 1 / r.realloc.k : 1]))), sel.ids, nom));
    // closure attribution: single (from the baseline) and last-removed (from the set) reduction of the over-budget excess, plus the A_op change
    const d0 = decompose(s, 'aOp');
    const b0 = budgetOf(d0, classes, w);
    const ex0 = excessOf(d0, b0, classes);
    const exS = excessOf(d, b, classes);
    const importance = players.map((id) => {
      const d1 = decompose(applyMechanisms(s, [id], nom), 'aOp');
      const b1 = budgetOf(d1, classes, w);
      const single = ex0 - excessOf(d1, b1, classes);
      let lastRemoved: number | undefined;
      let aOpLast: number | undefined;
      if (sel.ids.includes(id)) { const dm = decompose(applyMechanisms(s, sel.ids.filter((x) => x !== id), nom), 'aOp'); const bm = budgetOf(dm, classes, w); lastRemoved = excessOf(dm, bm, classes) - exS; aOpLast = d.aOp - dm.aOp; }
      return { id, inSet: sel.ids.includes(id), single, aOpSingle: d1.aOp - d0.aOp, lastRemoved, aOpLast, closedClasses: classes.filter((c) => ptsOf(d0, c.id) > b0.classes[c.id].pts && ptsOf(d1, c.id) <= b1.classes[c.id].pts).map((c) => c.id) };
    });
    const uniformResidual = uniformRateFactor(planned);
    const ref = plannerRef(key, N);
    let refRows: { excess: number; overCount: number; overRealloc: string[]; maxK: number } | undefined;
    if (ref) { const dr = decompose(applyMechanisms(s, ref.ids, nom), 'aOp'); const br = budgetOf(dr, classes, w); const rr = classRows(dr, dr, br, classes); refRows = { excess: excessOf(dr, br, classes), overCount: rr.rows.filter((r) => r.over).length, overRealloc: rr.rows.filter((r) => r.overRealloc).map((r) => r.id), maxK: Math.max(...rr.rows.map((r) => r.realloc.k)) }; }
    perSize[N] = {
      N, agree: sel, planned: { aOp: d.aOp, aRun: d.aRun, lambdaJob: d.lambdaJob, hardware: d.hardware, mtbiHours: d.mtbiHours, recoveryS: d.recoveryS, meanPauseS: d.meanPauseS, byGroup: d.byGroup, stages: d.stages, globalS: d.globalS, detectS: d.detectS, ledger: d.ledger },
      plannedDerated: { aOp: dD.aOp, byGroup: dD.byGroup, meanPauseS: dD.meanPauseS, recoveryS: dD.recoveryS },
      budget: { fixed: b.fixed, free: b.free, perClass: b.free / classes.length }, excess: exS, excessBaseline: ex0, overCount: rows.rows.filter((r) => r.over).length, overReallocIds: rows.rows.filter((r) => r.overRealloc).map((r) => r.id),
      classes: rows.rows, realloc: rows.realloc, check: { strict: strictCheck, realloc: reallocCheck }, importance, uniformResidual, plannerRef: ref ? { ...ref, agreeView: refRows } : undefined,
      verification: TRIALS > 0 ? verify(planned, TRIALS, SEED) : undefined,
    };
    const ck = sel.ids.join('+');
    if (sel.ids.length && !Object.values(curveSets).some((x) => x.join('+') === ck)) curveSets[`agree${N}`] = sel.ids;
    log(`  ${key} N=${N}: AGREE set ${sel.feasible ? '' : '[infeasible] '}${sel.ids.join('+') || '∅'} effort ${sel.effort} → ${(d.aOp * 100).toFixed(3)} / ${(dD.aOp * 100).toFixed(3)} %, over ${rows.rows.filter((r) => r.over).length} (realloc ${rows.rows.filter((r) => r.overRealloc).length}), excess ${(exS * 100).toFixed(3)} pt, phase1 ${sel.phase1.ids.length} items over ${sel.phase1.overCount}, phase2 +${sel.phase2Steps}; planner ${ref ? `${ref.ids.join('+') || '∅'} ${(ref.nominal * 100).toFixed(3)}` : '-'}; uniform residual ×${uniformResidual.toFixed(3)}; P ${perSize[N] && (perSize[N] as { verification?: { pAtLeastTarget: number } }).verification ? ((perSize[N] as { verification: { pAtLeastTarget: number } }).verification.pAtLeastTarget * 100).toFixed(1) : '-'}`);
  }
  curveSets.baseline = [];
  if (!Object.values(curveSets).some((x) => x.join('+') === players.join('+'))) curveSets.allOn = players;
  const maxN = (ids: string[], prm: Record<string, Record<string, number>>) => {
    let a = 1000, b = 4000000;
    if (aOpOf(applyMechanisms(withSize(s0, b), ids, prm)) >= TARGET) return b;
    if (aOpOf(applyMechanisms(withSize(s0, a), ids, prm)) < TARGET) return a;
    for (let i = 0; i < 40; i++) { const mid = Math.sqrt(a * b); if (aOpOf(applyMechanisms(withSize(s0, Math.round(mid)), ids, prm)) >= TARGET) a = mid; else b = mid; }
    return Math.round(a);
  };
  const curves: Record<string, unknown> = {};
  for (const [name, ids] of Object.entries(curveSets)) {
    curves[name] = { ids, points: grid.map((N) => ({ N, value: aOpOf(applyMechanisms(withSize(s0, N), ids, nom)) })), maxN: maxN(ids, nom) };
    curves[`${name}Derated`] = { ids, points: grid.map((N) => ({ N, value: aOpOf(applyMechanisms(withSize(s0, N), ids, der)) })), maxN: maxN(ids, der) };
  }
  sets[key] = { label: def.label, players, params: def.params, nominal: nom, derated: der, library: Object.fromEntries(players.map((id) => { const m = mechanismById(id); return [id, { name: m.name, effort: m.effort, kind: m.kind, scope: m.scope, requires: m.requires ?? [] }]; })), perSize, curves, curveGrid: grid };
  log(`  ${key} max N: ${Object.entries(curves).filter(([k]) => !k.endsWith('Derated')).map(([k, c]) => `${k} ${(c as { maxN: number }).maxN}`).join(' · ')}`);
}

const out = {
  generated: new Date().toISOString(), target: TARGET, budgetPts: BUDGET, sizes: SIZES, trials: TRIALS, seed: SEED, derate: DERATE_DEFAULT,
  method: {
    weights: 'equal (n_i = N for every class of the per-card catalog; E_i = 1, t_i = T)', scopeVariant: SCOPE,
    formulas: ['pt_i* = (1 − A* − Σ non-domain pauses) · n_i / Σ n', 'λ_i* = pt_i* · 3600 / (A* · p̄_i)  [per hour, p̄_i = mean pause per event of the class under the mechanism set]', 'k_i = λ_i / λ_i*  (> 1: the class must improve; < 1: slack)', 'reallocation: under-budget classes keep their current points; the remaining budget is split over the over-budget classes by the same weights → k_i′', 'selection: add the mechanism with the largest Σ_i∈over max(0, pt_i − max(pt_i^new, pt_i*)) − Δfixed per unit effort until A_op ≥ A* nominally and derated'],
  },
  original: ORIGINAL, extensions: EXT, remap: { repo: 'https://github.com/lzq0927/remap', commit: 'eaacb0578a30027c480046de6b91e6f434dfa15e', date: '2026-10-15' },
  common, sets,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
