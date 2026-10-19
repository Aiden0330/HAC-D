/**
 * Worked example and version comparison of the allocation methods (docs/ALLOCATION_STRATEGY_V4.{en,zh}.html, manual §7.1–7.2):
 *  1. the v4 strategies on one case — A3 · CloudMatrix384 at 500,000 NPUs (the largest built-in scale) with the six default
 *     mechanisms, target A_op ≥ 98.5 % (the scenario default) nominally and derated over the 30-day window: the baseline with the
 *     per-class pause contributions c_i = λ_i·p̄_i, the parameters of every move, the three strategies, the three hardware splits,
 *     the uniform factors and a delivered-goodput case;
 *  2. the three versions' allocation methods on the same cases at the built-in 10k / 100k / 200k / 500k for the three templates:
 *     v3.0 classic (first-order budget with the global recovery time, rates split by ARINC / AGREE / Albert / equal), v3.7 study
 *     (planner over the same candidates, the residual uniform hardware factor on its derated plan) and v4.0 (optimal /
 *     MTTR-preferred / MTTF-preferred). Every design is re-evaluated on the engine with one yardstick (nominal, and every mechanism
 *     — the scenario's own and the added ones — derated) and one effort metric (library effort + lever effort + Σ 2·log2(1/x_i)).
 * Usage: node --import tsx scripts/allocation-strategy-v4-example.ts [--npus 500000] [--target 0.985] [--out docs/allocation-strategy-v4/results.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyScenario, topologyBom, TOPOLOGY_SCALES, TOPOLOGY_TEMPLATE_IDS, type TopologyTemplate } from '../packages/core/src/topology/index.js';
import { allocateStrategy, applyLevers, withHardwareFactors, DEFAULT_LEVERS, DEFAULT_STRATEGY_CANDIDATES, STRATEGY_IDS, type StrategyResult, type HardwareSplit } from '../packages/core/src/strategy/index.js';
import { evaluateScenario, type TrainingKpis } from '../packages/core/src/scenario/evaluate.js';
import { scaleAllRates, scaleRecovery } from '../packages/core/src/scenario/analysis.js';
import { applyMechanisms, stripMechanisms, mechanismById } from '../packages/core/src/mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { computeCounts, componentInstances } from '../packages/core/src/scenario/build.js';
import { groupOf, withSize, allocationStudy } from '../packages/core/src/study/index.js';
import { equalApportionment, arinc, agree, minimumEffort, goodputBudget, type Subsystem } from '../packages/core/src/allocation/index.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/allocation-strategy-v4/results.json';
const N = Number(flag('npus') ?? 500000);
const TEMPLATE: TopologyTemplate = 'a3-ub384';
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

const s = topologyScenario(TEMPLATE, N);
const TARGET = Number(flag('target') ?? s.targets.operational ?? 0.985);
const tr = (sc: Scenario): TrainingKpis => evaluateScenario(sc, { structure: false }).training!;
const aop = (sc: Scenario) => tr(sc).operationalAvailability;
/** the derated design: every applied mechanism re-applied with derated parameters (the strategies' yardstick) */
function deratedOf(sc: Scenario): Scenario {
  const ids = Object.keys(sc.mechanisms.applied ?? {});
  const rec = Object.fromEntries(Object.entries(sc.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, DERATE_DEFAULT)]));
  return ids.length ? applyMechanisms(stripMechanisms(sc, ids), ids, rec) : sc;
}
const values = (t: TrainingKpis) => ({ aOp: t.operationalAvailability, delivered: t.deliveredGoodput, effective: t.effectiveGoodput, mtbiHours: t.mtbiHours, meanPauseS: t.meanPauseS, recoveryS: t.recoveryS, runningFraction: t.runningFraction, eventsPerDay: t.interruptionsPerDay, lambdaJob: t.interruptionRatePerHour });
const hwEffort = (x: Record<string, number>) => Object.values(x).reduce((acc, f) => acc + (f < 1 ? 2 * Math.log2(1 / f) : 0), 0);
const strip = (r: StrategyResult) => { const { scenario: _s, ...rest } = r; void _s; return rest; };

/* ---------------- 1. the worked example ---------------- */
const baseIds = Object.keys(s.mechanisms.applied ?? {});
const recorded = Object.fromEntries(Object.entries(s.mechanisms.applied ?? {}).map(([id, r]) => [id, r.parameters]));
const deratedRec = Object.fromEntries(Object.entries(recorded).map(([id, p]) => [id, derateParameters(p, DERATE_DEFAULT)]));
const sDer = deratedOf(s);
const nom = tr(s), der = tr(sDer);
const counts = computeCounts(s);
const sumC = der.chain.rows.reduce((a, r) => a + r.ratePerHour * r.meanPauseS, 0);
const Ftot = 3600 * (1 / der.runningFraction - 1) - sumC;
const phi = 1 - der.operationalAvailability / der.runningFraction;
const B = 3600 * ((1 - phi) / TARGET - 1) - Ftot;
const classes = der.chain.rows.map((r) => {
  const comp = s.components.find((c) => c.id === r.id)!;
  const ci = componentInstances(comp, counts, s.measures.subhealthThreshold);
  const c = r.ratePerHour * r.meanPauseS;
  return { id: r.id, group: groupOf(comp), units: ci.total, fitPerUnit: ci.lambda * 1e9, ratePerHour: r.ratePerHour, meanPauseS: r.meanPauseS, c, share: c / sumC, points: (1 - der.runningFraction) * c / (sumC + Ftot), pGlobal: r.pGlobal, pRollback: r.pRollback };
}).sort((a, b) => b.c - a.c);
log(`${TEMPLATE} ${N}: A_op ${(nom.operationalAvailability * 100).toFixed(3)} / ${(der.operationalAvailability * 100).toFixed(3)} %, Σc ${sumC.toFixed(1)} s/h, F ${Ftot.toFixed(2)}, φ ${phi.toExponential(2)}, budget B ${B.toFixed(1)} s/h, target ${TARGET}`);

const lib = (id: string) => mechanismById(id);
const moves = {
  scenario: baseIds.map((id) => ({ id, name: lib(id).name, kind: lib(id).kind, effort: lib(id).effort, nominal: recorded[id], derated: deratedRec[id] })),
  candidates: DEFAULT_STRATEGY_CANDIDATES.map((id) => ({ id, name: lib(id).name, kind: lib(id).kind, effort: lib(id).effort, nominal: lib(id).parameters, derated: derateParameters(lib(id).parameters, DERATE_DEFAULT), change: lib(id).change })),
  levers: DEFAULT_LEVERS.map((l) => {
    const cur = s.recovery.mode === 'mixture' ? s.recovery : undefined;
    const pick = (sc: Scenario) => (sc.recovery.mode === 'mixture' ? (l.id === 'auto' ? sc.recovery.automatic.seconds : l.id === 'success' ? sc.recovery.automatic.successProbability : sc.recovery.manual.seconds) : NaN);
    return { id: l.id, limit: l.limit, effort: l.effort, current: cur ? (l.id === 'auto' ? cur.automatic.seconds : l.id === 'success' ? cur.automatic.successProbability : cur.manual.seconds) : NaN, nominalValue: pick(applyLevers(s, [l], null)), deratedValue: pick(applyLevers(s, [l], DERATE_DEFAULT)) };
  }),
  derate: DERATE_DEFAULT,
};

const results: Record<string, ReturnType<typeof strip>> = {};
for (const st of STRATEGY_IDS) {
  const r = allocateStrategy(s, { strategy: st, target: TARGET });
  results[st] = strip(r);
  log(`${st}: ${r.feasible ? 'feasible' : 'NOT'} ${r.mechanisms.join('+')} | ${r.levers.join('+')} | effort ${r.effort.total.toFixed(2)} (hw ${r.effort.hardware.toFixed(2)}) | ${(r.final.value * 100).toFixed(3)} / ${(r.final.derated * 100).toFixed(3)} %`);
}
const splits: Record<string, ReturnType<typeof strip>> = {};
for (const sp of ['min-effort', 'agree', 'arinc'] as HardwareSplit[]) {
  const r = allocateStrategy(s, { strategy: 'mttf-first', target: TARGET, hardwareSplit: sp });
  splits[sp] = strip(r);
  log(`hardware only, ${sp}: effort ${r.effort.hardware.toFixed(2)}, at floor ${r.hardware.atFloors.length}, ${r.hardware.rows.filter((h) => h.factor < 1).length} classes`);
}
const bisect = (f: (x: number) => number) => {
  let lo: number, hi: number;
  if (f(1) >= TARGET) { lo = 1; hi = 1; while (f(hi) >= TARGET && hi < 1e4) hi *= 2; if (hi >= 1e4) return Infinity; } else { lo = 1e-4; hi = 1; if (f(lo) < TARGET) return 0; }
  for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (f(mid) >= TARGET) lo = mid; else hi = mid; }
  return lo;
};
const uniform = {
  hardwareNominal: bisect((x) => aop(scaleAllRates(s, x))),
  hardwareDerated: bisect((x) => Math.min(aop(scaleAllRates(s, x)), aop(scaleAllRates(sDer, x)))),
  recoveryNominal: bisect((x) => aop(scaleRecovery(s, x))),
  recoveryDerated: bisect((x) => Math.min(aop(scaleRecovery(s, x)), aop(scaleRecovery(sDer, x)))),
};
log(`uniform factors: hw ×${uniform.hardwareNominal.toFixed(3)} (derated ×${uniform.hardwareDerated.toFixed(3)}), recovery ×${uniform.recoveryNominal.toFixed(3)} (derated ×${uniform.recoveryDerated.toFixed(3)})`);
const delivered = allocateStrategy(s, { strategy: 'optimal', target: s.targets.goodput ?? 0.9, metric: 'delivered' });
log(`delivered ≥ ${s.targets.goodput}: ${delivered.feasible ? 'feasible' : 'NOT'} ${(delivered.final.value * 100).toFixed(2)} / ${(delivered.final.derated * 100).toFixed(2)} %, effort ${delivered.effort.total.toFixed(2)}`);

/* ---------------- 2. the three versions on the same cases ---------------- */
type Check = { aOp: number; aOpDerated: number; meets: boolean; meetsNominal: boolean };
const check = (sc: Scenario): Check => { const a = aop(sc), ad = aop(deratedOf(sc)); return { aOp: a, aOpDerated: ad, meets: a >= TARGET - 1e-9 && ad >= TARGET - 1e-9, meetsNominal: a >= TARGET - 1e-9 }; };
const hwSubs = (sc: Scenario) => {
  const cnt = computeCounts(sc);
  const rows = sc.components.filter((c) => c.enabled).map((c) => ({ c, ci: componentInstances(c, cnt, sc.measures.subhealthThreshold) })).filter((x) => x.ci.lambda > 0);
  const subs: Subsystem[] = rows.map(({ c, ci }) => ({ id: c.id, name: c.id, count: ci.total, currentLambda: ci.lambda, importance: 1, duty: 1 }));
  return { subs, lamHw: rows.reduce((a, { ci }) => a + ci.lambda * ci.total, 0) };
};
function v30(sc: Scenario) {
  const t = tr(sc);
  const w = sc.workload as Extract<Scenario['workload'], { type: 'training' }>;
  // the classic first-order budget (v3 Classic methods tab: fix R = the global recovery time, tighten λ) on the A_op 口径: no checkpoint term
  const gb = goodputBudget({ goodputTarget: TARGET, nGpus: w.nGpus, deltaS: 0, recoveryS: t.recoveryS, lambdaPerGpuHour: t.interruptionRatePerHour / w.nGpus });
  const lamStar = 3600 / gb.fixRecovery.requiredMtbiS;
  const { subs, lamHw } = hwSubs(sc);
  const out: Record<string, unknown> = {};
  const tStart = Date.now();
  for (const [name, fn] of [['arinc', () => arinc(subs, lamStar)], ['agree', () => agree(subs, lamStar, Math.min(24, 0.1 / Math.max(lamStar, 1e-12)))], ['minimum-effort', () => minimumEffort(subs, lamStar)], ['equal', () => equalApportionment(subs, lamStar)]] as const) {
    const r = fn();
    const x = Object.fromEntries(r.rows.map((row) => [row.id, row.currentAggregate ? row.lambdaAggregate / row.currentAggregate : 1]));
    // classes the split allows to get worse are kept at today's FIT for the design check (an allocation is a ceiling, not a request to degrade)
    const xi = Object.fromEntries(Object.entries(x).map(([id, f]) => [id, Math.min(1, f)]));
    const c = check(withHardwareFactors(sc, xi));
    out[name] = { ...c, effort: hwEffort(xi), improved: Object.values(xi).filter((f) => f < 1).length, minFactor: Math.min(...Object.values(xi)), relaxed: Object.values(x).filter((f) => f > 1.0001).length };
  }
  return { lambdaJob: t.interruptionRatePerHour, lambdaHw: lamHw, lambdaStar: lamStar, recoveryS: t.recoveryS, firstOrderAOp: 1 / (1 + (t.interruptionRatePerHour * t.recoveryS) / 3600), uniformFactor: lamStar / lamHw, ms: Date.now() - tStart, splits: out };
}
function v37(sc: Scenario, z: ReturnType<typeof allocationStudy>['perSize'][number], ms: number) {
  const plan = z.plan;
  const f = Math.min(1, z.residualFactor.planDerated);
  const planned = plan.ids.length ? applyMechanisms(sc, plan.ids) : sc;
  const { subs } = hwSubs(sc);
  const x = Object.fromEntries(subs.map((q) => [q.id, f]));
  const design = f < 1 ? withHardwareFactors(planned, x) : planned;
  const c = check(design);
  return { ...c, plan: { ids: plan.ids, feasible: plan.feasible, nominal: plan.nominal, derated: plan.derated, effort: plan.effort, method: plan.method }, residual: z.residualFactor, hardwareFactor: f, hardwareClasses: f < 1 ? subs.length : 0, effort: { mechanisms: plan.effort, levers: 0, hardware: f < 1 ? hwEffort(x) : 0, total: plan.effort + (f < 1 ? hwEffort(x) : 0) }, hardwareOnlyFactor: z.hardwareOnly.factor, levers: (z.levers ?? []).map((l) => ({ id: l.id, value: l.value, valueDerated: l.valueDerated, residualFactor: l.residualFactor })), ms };
}
const v4row = (r: StrategyResult, ms: number) => ({ feasible: r.feasible, aOp: r.final.value, aOpDerated: r.final.derated, mechanisms: r.mechanisms, levers: r.levers, effort: r.effort, slack: r.hardware.slackFactor ?? null, improved: r.hardware.rows.filter((h) => h.factor < 1).length, atFloors: r.hardware.atFloors.length, top: r.hardware.rows.filter((h) => h.factor < 1).sort((a, b) => a.factor - b.factor).slice(0, 3).map((h) => ({ id: h.id, factor: h.factor })), ms });

const versions: Record<string, Record<number, unknown>> = {};
for (const tpl of TOPOLOGY_TEMPLATE_IDS) {
  versions[tpl] = {};
  const base = topologyScenario(tpl, TOPOLOGY_SCALES[0]);
  const ts = Date.now();
  const study = allocationStudy(base, { sizes: TOPOLOGY_SCALES, target: TARGET, metric: 'aOp', players: DEFAULT_STRATEGY_CANDIDATES, trials: 0, curves: false, levers: true });
  const studyMs = (Date.now() - ts) / TOPOLOGY_SCALES.length;
  for (const n of TOPOLOGY_SCALES) {
    const sc = withSize(base, n);
    const b = check(sc);
    const row: Record<string, unknown> = { npus: n, baseline: b, hardFitPerNpu: topologyBom(sc).hardFitPerNpuTotal, v30: v30(sc), v37: v37(sc, study.perSize[n], studyMs), v4: {} };
    for (const st of STRATEGY_IDS) { const t1 = Date.now(); const r = allocateStrategy(sc, { strategy: st, target: TARGET }); (row.v4 as Record<string, unknown>)[st] = v4row(r, Date.now() - t1); }
    versions[tpl][n] = row;
    const v3 = row.v30 as ReturnType<typeof v30>, v7 = row.v37 as ReturnType<typeof v37>, o = (row.v4 as Record<string, ReturnType<typeof v4row>>).optimal;
    const sp = v3.splits as Record<string, { meets: boolean; effort: number }>;
    log(`${tpl} ${n}: base ${(b.aOp * 100).toFixed(3)}/${(b.aOpDerated * 100).toFixed(3)} | v3.0 ARINC ${sp.arinc.meets ? '✓' : '✕'} ${sp.arinc.effort.toFixed(1)} AGREE ${sp.agree.meets ? '✓' : '✕'} ${sp.agree.effort.toFixed(1)} Albert ${sp['minimum-effort'].meets ? '✓' : '✕'} ${sp['minimum-effort'].effort.toFixed(1)} | v3.7 ${v7.meets ? '✓' : '✕'} [${v7.plan.ids.join('+')}] f ${v7.hardwareFactor.toFixed(3)} eff ${v7.effort.total.toFixed(1)} | v4 opt ${o.feasible ? '✓' : '✕'} ${o.effort.total.toFixed(2)} [${[...o.mechanisms, ...o.levers].join('+')}]`);
  }
}

const out = {
  generated: new Date().toISOString(),
  scenario: { template: TEMPLATE, npus: N, target: TARGET, goodputTarget: s.targets.goodput, mechanisms: baseIds, window: (s.workload as { durationDays: number }).durationDays, sizes: TOPOLOGY_SCALES },
  baseline: { nominal: values(nom), derated: values(der), sumC, F: Ftot, phi, budgetB: B, hardFitPerNpu: topologyBom(s).hardFitPerNpuTotal },
  classes, moves, results, splits, uniform, delivered: strip(delivered), versions,
};
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
