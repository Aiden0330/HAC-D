/**
 * Availability (A_op) allocation study on the 54-event reference catalog at 10k / 100k / 200k / 500k cards for a 98.5 % target:
 * hardware-only and recovery-only budgets, ARINC / minimum-effort class allocation, mechanism planner (A_op metric, derated),
 * exact Shapley attribution (A_op and delivered side by side), residual hardware factor with the plan, unavailability
 * decomposition by domain group, A_op vs N curves, and a window-ledger verification of the plan.
 * Usage: node --import tsx scripts/availability-allocation-98p5.ts [--trials 200] [--out docs/availability-98p5/results.json]
 */
import { writeFileSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { REFERENCE_EVENTS } from '../packages/core/src/scenario/referenceEvents.js';
import { evaluateScenario } from '../packages/core/src/scenario/evaluate.js';
import { scaleAllRates, scaleRecovery, cloneScenario } from '../packages/core/src/scenario/analysis.js';
import { arinc, minimumEffort, allocateRecoveryStages, type Subsystem } from '../packages/core/src/allocation/index.js';
import { planToTarget, DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { mechanismReport, applyMechanisms, MECHANISM_LIBRARY } from '../packages/core/src/mechanisms/index.js';
import { buildLedgerRun, simulateLedgerReplications } from '../packages/core/src/mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict, summaryStat } from '../packages/core/src/math/stats.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const TRIALS = Number(flag('trials') ?? 200);
const OUT = flag('out') ?? 'docs/availability-98p5/results.json';
const TARGET = 0.985;
const SIZES = [10000, 100000, 200000, 500000];
const PLAYERS = ['D-HARD', 'R-REPLAY', 'R-NETFAIL', 'R-HOTSWAP', 'R-ELASTIC', 'R-PROCESS', 'P-PREDICT', 'C-MEM', 'H-LEMON', 'H-SWEEP'];
const GROUPS: Record<string, string[]> = {
  npu: ['CORE', 'SRAM', 'IOD', 'MODULE', 'MEMT', 'MEMP'],
  network: ['NIC', 'OPT', 'BOXIO', 'FABRIC'],
  host: ['CPU', 'DDR', 'SSD'],
  facility: ['POWER', 'COOL', 'MGMT'],
  storageSoftware: ['STORAGE', 'UNKNOWN'],
};
const groupOf = (domainId: string) => Object.entries(GROUPS).find(([, ids]) => ids.includes(domainId))?.[0] ?? 'other';
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

const aOpOf = (s: Scenario) => evaluateScenario(s, { structure: false }).training!.operationalAvailability;
/** largest factor f (rates × f) with A_op ≥ target when the scenario meets it (slack, f ≥ 1), else the factor < 1 needed */
function rateFactorFor(s: Scenario, target = TARGET): number {
  const f = (x: number) => aOpOf(scaleAllRates(s, x));
  let lo: number, hi: number;
  if (f(1) >= target) { lo = 1; hi = 1; while (f(hi) >= target && hi < 1e4) hi *= 2; if (hi >= 1e4) return Infinity; }
  else { lo = 1e-4; hi = 1; if (f(lo) < target) return 0; }
  for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (f(mid) >= target) lo = mid; else hi = mid; }
  return lo;
}
/** recovery-time factor g (all stages × g) that reaches the target with the current rates */
function recoveryFactorFor(s: Scenario, target = TARGET): number {
  const f = (x: number) => aOpOf(scaleRecovery(s, x));
  let lo: number, hi: number;
  if (f(1) >= target) { lo = 1; hi = 1; while (f(hi) >= target && hi < 1e4) hi *= 2; if (hi >= 1e4) return Infinity; }
  else { lo = 1e-4; hi = 1; if (f(lo) < target) return 0; }
  for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (f(mid) >= target) lo = mid; else hi = mid; }
  return lo;
}
const hardSubs = (N: number): Subsystem[] => REFERENCE_EVENTS.filter((e) => e.type === 'hard').map((e) => ({ id: e.domainId, name: e.domain, count: N, currentLambda: e.fit / 1e9 }));
const fitOf = (lambdaPerUnit: number) => lambdaPerUnit * 1e9;

function decompose(s: Scenario) {
  const t = evaluateScenario(s, { structure: false }).training!;
  const rows = t.chain.rows;
  const iso = t.subhealth ? t.subhealth.isolationInterruptionsPerHour * t.pauseOnlyS : 0;
  const sumLP = rows.reduce((a, r) => a + r.ratePerHour * r.meanPauseS, 0) + iso;
  const unRun = 1 - t.runningFraction;
  const byGroup: Record<string, number> = {};
  const byDomain: Record<string, { ratePerHour: number; meanPauseS: number; points: number; share: number }> = {};
  for (const r of rows) {
    const pts = unRun * (r.ratePerHour * r.meanPauseS) / sumLP;
    byDomain[r.id.replace(/-hard$/, '')] = { ratePerHour: r.ratePerHour, meanPauseS: r.meanPauseS, points: pts, share: pts / (1 - t.operationalAvailability) };
    const g = groupOf(r.id.replace(/-hard$/, ''));
    byGroup[g] = (byGroup[g] ?? 0) + pts;
  }
  byGroup.isolation = unRun * iso / sumLP;
  byGroup.sdcPause = t.runningFraction * (t.sdc ? t.sdc.delivery.pauseFraction : 0);
  return { aOp: t.operationalAvailability, aRun: t.runningFraction, lambdaJob: t.interruptionRatePerHour, hardware: t.subhealth?.hardwareInterruptionsPerHour ?? t.interruptionRatePerHour, isolation: t.subhealth?.isolationInterruptionsPerHour ?? 0, meanPauseS: t.meanPauseS, recoveryS: t.recoveryS, detectS: t.detectS, globalS: t.globalRecoveryS, mtbiHours: t.mtbiHours, delivered: t.deliveredGoodput, effective: t.effectiveGoodput, ledger: t.ledger, byGroup, byDomain, stages: t.recovery.stages.map((st: any) => ({ name: st.name, meanS: st.meanS })), overhead: t.overheadFraction, falseAlarms: t.falseAlarmRatePerHour };
}

function verify(s: Scenario, trials: number, seed = 1) {
  const run = buildLedgerRun(s, { trials, seed, target: TARGET });
  const rows = simulateLedgerReplications(run.spec, 0, trials, seed);
  const a = rows.map((r) => r.operationalAvailability);
  const k = a.filter((x) => x >= TARGET).length;
  const est = proportionEstimate(k, trials);
  const st = summaryStat(a);
  const d = summaryStat(rows.map((r) => r.delivered));
  return { trials, seed, aOp: st, delivered: d, pAtLeastTarget: k / trials, wilson: [est.low, est.high], verdict: proportionVerdict(est, 0.9), counts: rows.reduce((acc: Record<string, number>, r) => { for (const [kk, v] of Object.entries(r.counts)) acc[kk] = (acc[kk] ?? 0) + v / trials; return acc; }, {}) };
}

const out: any = { target: TARGET, sizes: SIZES, players: PLAYERS, derate: DERATE_DEFAULT, groups: GROUPS, generated: new Date().toISOString(), domains: [], perSize: {}, curves: {}, library: {} };
for (const m of MECHANISM_LIBRARY) if (PLAYERS.includes(m.id)) out.library[m.id] = { name: m.name, effort: m.effort, parameters: m.parameters, derated: derateParameters(m.parameters, DERATE_DEFAULT), confidence: m.confidence, kind: m.kind, scope: m.scope };
for (const e of REFERENCE_EVENTS) if (e.type === 'hard') out.domains.push({ id: e.domainId, domain: e.domain, description: e.description, fit: e.fit, scope: e.scope, persistence: e.persistence, replay: e.replay, process: e.process, elastic: e.elastic, group: groupOf(e.domainId), slowFit: REFERENCE_EVENTS.find((x) => x.domainId === e.domainId && x.type === 'slow')?.fit ?? 0, sdcFit: REFERENCE_EVENTS.find((x) => x.domainId === e.domainId && x.type === 'sdc')?.fit ?? 0 });

for (const N of SIZES) {
  log(`N = ${N}: baseline`);
  const s = referenceCatalog(N);
  const base = decompose(s);
  const U = (1 - TARGET) / TARGET;
  // hardware-only and recovery-only budgets
  const fHw = rateFactorFor(s);
  const gRec = recoveryFactorFor(s);
  const lambdaStar = base.hardware * fHw;
  const subs = hardSubs(N);
  const arincRows = Number.isFinite(fHw) ? arinc(subs, lambdaStar) : undefined;
  const albert = Number.isFinite(fHw) ? minimumEffort(subs, lambdaStar) : undefined;
  const Rstar = base.recoveryS * gRec;
  const stages = Number.isFinite(gRec) ? allocateRecoveryStages(base.stages.map((st) => ({ name: st.name, currentS: st.meanS, floorS: st.name === 'detection' ? 5 : 0 })), Rstar) : undefined;
  log(`  A_op ${(base.aOp * 100).toFixed(3)} %; hardware factor ${fHw.toFixed(4)}, recovery factor ${gRec.toFixed(4)}`);
  // planner
  log('  planner (1024 coalitions × 2)');
  const plan = planToTarget(s, { target: TARGET, metric: 'aOp', players: PLAYERS, derate: DERATE_DEFAULT });
  const bestCoalition = plan.pareto.reduce((a, c) => (c.value > a.value ? c : a), plan.pareto[0]);
  const planIds = plan.plan?.ids ?? bestCoalition.ids;
  const planned = applyMechanisms(s, planIds);
  const allOn = applyMechanisms(s, PLAYERS);
  const deratedParams = Object.fromEntries(PLAYERS.map((id) => [id, derateParameters(MECHANISM_LIBRARY.find((m) => m.id === id)!.parameters, DERATE_DEFAULT)]));
  const allOnDerated = applyMechanisms(s, PLAYERS, deratedParams);
  const plannedDerated = applyMechanisms(s, planIds, deratedParams);
  const dPlan = decompose(planned);
  const dAll = decompose(allOn);
  const dAllDer = decompose(allOnDerated);
  const dPlanDer = decompose(plannedDerated);
  const fPlan = rateFactorFor(planned);
  const fPlanDer = rateFactorFor(plannedDerated);
  const fAll = rateFactorFor(allOn);
  const fAllDer = rateFactorFor(allOnDerated);
  log(`  plan ${plan.plan ? planIds.join('+') + ' effort ' + plan.plan.effort : 'NONE'}: A_op ${(dPlan.aOp * 100).toFixed(3)} (derated ${(dPlanDer.aOp * 100).toFixed(3)}); all-on ${(dAll.aOp * 100).toFixed(3)} / derated ${(dAllDer.aOp * 100).toFixed(3)}; residual hw factor plan ${fPlan.toFixed(3)} all ${fAll.toFixed(3)} allDer ${fAllDer.toFixed(3)}`);
  // attribution
  log('  Shapley (1024 coalitions)');
  const rep = mechanismReport(s, PLAYERS, { metric: 'aOp' });
  const gains = rep.gains.map((g: any) => ({ id: g.id, aOp: g.byMetric.aOp, delivered: g.byMetric.delivered, effective: g.byMetric.effective }));
  // ARINC residual allocation under the plan (uniform factor on hard rates)
  const residualArinc = Number.isFinite(fPlan) ? arinc(subs, base.hardware * fPlan) : undefined;
  // levers beyond the library (recovery mixture parameters) on top of the plan
  const withRecovery = (sc: Scenario, patch: { autoSeconds?: number; success?: number; manualSeconds?: number }): Scenario => {
    const c = cloneScenario(sc);
    if (c.recovery.mode !== 'mixture') return c;
    c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, seconds: patch.autoSeconds ?? c.recovery.automatic.seconds, successProbability: patch.success ?? c.recovery.automatic.successProbability }, manual: { ...c.recovery.manual, seconds: patch.manualSeconds ?? c.recovery.manual.seconds } };
    return c;
  };
  const leverSpecs: { id: string; patch: { autoSeconds?: number; success?: number; manualSeconds?: number } }[] = [
    { id: 'plan', patch: {} }, { id: 'auto60', patch: { autoSeconds: 60 } }, { id: 'ps999', patch: { success: 0.999 } }, { id: 'manual30', patch: { manualSeconds: 1800 } }, { id: 'auto60+ps999', patch: { autoSeconds: 60, success: 0.999 } }, { id: 'auto60+manual30', patch: { autoSeconds: 60, manualSeconds: 1800 } }, { id: 'ps999+manual30', patch: { success: 0.999, manualSeconds: 1800 } }, { id: 'all3', patch: { autoSeconds: 60, success: 0.999, manualSeconds: 1800 } },
  ];
  const levers = leverSpecs.map((l) => { const sc = withRecovery(planned, l.patch); const d = decompose(sc); return { id: l.id, patch: l.patch, aOp: d.aOp, recoveryS: d.recoveryS, meanPauseS: d.meanPauseS, residualFactor: rateFactorFor(sc), aOpDerated: decompose(withRecovery(plannedDerated, l.patch)).aOp }; });
  log(`  levers: ${levers.map((l) => `${l.id} ${(l.aOp * 100).toFixed(3)} (hw ×${l.residualFactor.toFixed(3)})`).join(' | ')}`);
  // verification
  log(`  ledger verification (${TRIALS} windows) of the plan`);
  const ver = verify(planned, TRIALS);
  log(`  P(A_op ≥ target) ${(ver.pAtLeastTarget * 100).toFixed(1)} % [${(ver.wilson[0] * 100).toFixed(1)}–${(ver.wilson[1] * 100).toFixed(1)}] mean ${(ver.aOp.mean * 100).toFixed(3)} ± ${(ver.aOp.ci95 * 100).toFixed(3)} → ${ver.verdict}`);
  const verBase = verify(s, TRIALS);
  out.perSize[N] = {
    baseline: base, unavailabilityBudget: U,
    hardwareOnly: { factor: fHw, lambdaStar, mtbiStarHours: 1 / (lambdaStar + base.isolation), arinc: arincRows?.rows.map((r) => ({ id: r.id, name: r.name, currentFit: fitOf(r.currentAggregate! / N), allowedFit: fitOf(r.lambdaPerUnit), improvementFactor: r.improvementFactor })), minimumEffort: albert ? { notes: albert.notes, rows: albert.rows.map((r) => ({ id: r.id, currentFit: fitOf(r.currentAggregate! / N), allowedFit: fitOf(r.lambdaPerUnit), improvementFactor: r.improvementFactor })) } : undefined },
    recoveryOnly: { factor: gRec, recoveryStarS: Rstar, stages },
    plan: { feasible: !!plan.plan, ids: planIds, effort: plan.plan?.effort ?? bestCoalition.effort, nominal: plan.plan?.value ?? bestCoalition.value, derated: plan.plan?.derated ?? bestCoalition.derated, best: { ids: bestCoalition.ids, effort: bestCoalition.effort, value: bestCoalition.value, derated: bestCoalition.derated }, necessary: plan.necessary, feasibleCount: plan.feasibleCount, maxValue: plan.maxValue, maxDerated: plan.maxDerated, pareto: plan.pareto.map((c) => ({ ids: c.ids, effort: c.effort, value: c.value, derated: c.derated })), notes: plan.notes },
    planned: dPlan, plannedDerated: dPlanDer, allOn: dAll, allOnDerated: dAllDer,
    residualFactor: { plan: fPlan, planDerated: fPlanDer, allOn: fAll, allOnDerated: fAllDer },
    residualArinc: residualArinc?.rows.map((r) => ({ id: r.id, currentFit: fitOf(r.currentAggregate! / N), allowedFit: fitOf(r.lambdaPerUnit), improvementFactor: r.improvementFactor })),
    gains, attributionBaseline: rep.baseline, verification: ver, verificationBaseline: verBase, levers,
  };
}
// A_op vs N curves for fixed mechanism sets
log('curves');
const grid = [5000, 7000, 10000, 15000, 20000, 30000, 50000, 70000, 100000, 150000, 200000, 300000, 500000, 700000, 1000000];
const sets: Record<string, string[]> = { baseline: [], plan100k: out.perSize[100000].plan.ids, plan200k: out.perSize[200000].plan.ids, plan500k: out.perSize[500000].plan.ids, allOn: PLAYERS };
const deratedParamsAll = Object.fromEntries(PLAYERS.map((id) => [id, derateParameters(MECHANISM_LIBRARY.find((m) => m.id === id)!.parameters, DERATE_DEFAULT)]));
for (const [name, ids] of Object.entries(sets)) {
  out.curves[name] = { ids, points: grid.map((N) => ({ N, aOp: aOpOf(applyMechanisms(referenceCatalog(N), ids)) })) };
  out.curves[name + 'Derated'] = { ids, points: grid.map((N) => ({ N, aOp: aOpOf(applyMechanisms(referenceCatalog(N), ids, deratedParamsAll)) })) };
  // largest N with A_op ≥ target (nominal and derated)
  const maxN = (params?: Record<string, Record<string, number>>) => { let lo = 1000, hi = 4e6; if (aOpOf(applyMechanisms(referenceCatalog(hi), ids, params)) >= TARGET) return hi; for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (aOpOf(applyMechanisms(referenceCatalog(Math.round(mid)), ids, params)) >= TARGET) lo = mid; else hi = mid; } return Math.round(lo); };
  out.curves[name].maxN = maxN();
  out.curves[name + 'Derated'].maxN = maxN(deratedParamsAll);
  log(`  ${name}: max N ${out.curves[name].maxN} (derated ${out.curves[name + 'Derated'].maxN})`);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
