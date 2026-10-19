/**
 * Top-down availability in MTBF / MTTR terms (docs/MTBF_MTTR_TOPDOWN.{en,zh}.html): for the three topology templates at the
 * built-in 10k / 100k / 200k / 500k NPUs (six default mechanisms, A_op target = the scenario default 98.5 %):
 *  - the job-level formula A_op = (1 − φ_SDC) / (1 + MTTR_hw/MTBF_hw + Σ_k MTTR_k/MTBF_k) with every event class kept apart
 *    (hardware interruptions through the mechanism chain; isolation of detected sub-healthy units; detected silent corruption;
 *    predictor false alarms), checked against the engine's running fraction;
 *  - the requirement: MTTR_hw/MTBF_hw ≤ B = 3600·((1 − φ)/A* − 1) − F on the derated design (the binding one), the MTBF needed at
 *    today's MTTR and the MTTR needed at today's MTBF;
 *  - the recommended split (v4 optimal: least effort over mechanisms, recovery levers and class FIT) and the hardware-only split,
 *    their MTBF_hw / MTTR_hw, the allowed FIT and MTBF per hardware unit, and the MTTR of the chain split by mechanism with the
 *    parameter values (nominal and derated). Every split of MTTR closes exactly on the engine's mean pause per event.
 * Usage: node --import tsx scripts/mtbf-mttr-topdown.ts [--out docs/mtbf-mttr-topdown/results.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyScenario, unitFaultLibrary, TOPOLOGY_SCALES, TOPOLOGY_TEMPLATE_IDS, TOPOLOGY_TEMPLATES, type TopologyTemplate, type FaultUnit } from '../packages/core/src/topology/index.js';
import { allocateStrategy, applyLevers, withHardwareFactors, DEFAULT_LEVERS, type StrategyResult } from '../packages/core/src/strategy/index.js';
import { evaluateScenario, type TrainingKpis } from '../packages/core/src/scenario/evaluate.js';
import { applyMechanisms, stripMechanisms, mechanismById } from '../packages/core/src/mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { rungOrder, type ChainParams, type Applicability } from '../packages/core/src/mechanisms/chain.js';
import { computeCounts, componentInstances } from '../packages/core/src/scenario/build.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/mtbf-mttr-topdown/results.json';
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const tr = (sc: Scenario): TrainingKpis => evaluateScenario(sc, { structure: false }).training!;
const LIB = new Map(unitFaultLibrary().map((f) => [f.id, f]));

/** every applied mechanism re-applied with derated parameters */
function deratedMechanisms(sc: Scenario): Scenario {
  const ids = Object.keys(sc.mechanisms.applied ?? {});
  const rec = Object.fromEntries(Object.entries(sc.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, DERATE_DEFAULT)]));
  return ids.length ? applyMechanisms(stripMechanisms(sc, ids), ids, rec) : sc;
}

/* ---------------- MTBF / MTTR form of A_op, per event class ---------------- */
function kpi(sc: Scenario) {
  const t = tr(sc);
  const rows = t.chain.rows;
  const lamHw = rows.reduce((a, r) => a + r.ratePerHour, 0);
  const sumLP = rows.reduce((a, r) => a + r.ratePerHour * r.meanPauseS, 0);
  const g = t.globalRecoveryS;
  const other = [
    { id: 'isolation', ratePerHour: t.subhealth ? t.subhealth.isolationInterruptionsPerHour : 0, pauseS: g },
    { id: 'sdcDetected', ratePerHour: t.sdc?.detectedRatePerHour ?? 0, pauseS: sc.sdc.stepRecovery ? sc.sdc.detection.detectSeconds + sc.sdc.stepRecovery.recoverSeconds + sc.sdc.stepRecovery.stepSeconds : sc.sdc.detection.detectSeconds + g },
    { id: 'falseAlarm', ratePerHour: t.falseAlarmRatePerHour, pauseS: sc.mechanisms.predict?.migrationSeconds ?? 0 },
  ].map((o) => ({ ...o, mtbfH: o.ratePerHour > 0 ? 1 / o.ratePerHour : null, sPerH: o.ratePerHour * o.pauseS }));
  const F = other.reduce((a, o) => a + o.sPerH, 0);
  const aRunFormula = 1 / (1 + (sumLP + F) / 3600);
  if (Math.abs(aRunFormula - t.runningFraction) > 1e-9) throw new Error(`running fraction does not close: ${aRunFormula} vs ${t.runningFraction}`);
  const phi = 1 - t.operationalAvailability / t.runningFraction;
  return { aOp: t.operationalAvailability, aRun: t.runningFraction, phi, lamHw, mtbfHwH: 1 / lamHw, mttrS: sumLP / lamHw, sumLP, other, F, mtbiH: t.mtbiHours, delivered: t.deliveredGoodput, detectS: t.chain.detectS, globalS: t.chain.globalS };
}

/* ---------------- MTTR of the chain split by mechanism (mirrors chainOutcome, tracks each rung's time) ---------------- */
type Split = Record<string, number>;
function chainSplit(detectS: number, globalS: number, autoS: number, params: ChainParams, a: Applicability, order?: readonly string[]) {
  if (Object.keys(params.custom ?? {}).length) throw new Error('custom rungs are not split here');
  const contrib: Split = {};
  const probs: Split = {};
  const add = (m: Split, k: string, v: number) => { m[k] = (m[k] ?? 0) + v; };
  type Node = { p: number; failed: Split };
  let nodes: Node[] = [{ p: 1, failed: {} }];
  const end = (n: Node, kind: string, own: Split) => {
    add(probs, kind, n.p);
    for (const [k, v] of Object.entries(n.failed)) add(contrib, `failed:${k}`, n.p * v);
    for (const [k, v] of Object.entries(own)) add(contrib, k, n.p * v);
  };
  const clamp = (x?: number) => (x === undefined || !Number.isFinite(x) ? 0 : Math.min(1, Math.max(0, x)));
  const stage = (frac: number, success: number, kind: string, own: Split, failureS: number) => {
    const next: Node[] = [];
    for (const n of nodes) {
      if (frac > 0) {
        const tried = n.p * frac;
        if (success > 0) end({ p: tried * success, failed: n.failed }, kind, own);
        if (success < 1) next.push({ p: tried * (1 - success), failed: { ...n.failed, [kind]: (n.failed[kind] ?? 0) + failureS } });
      }
      if (frac < 1) next.push({ p: n.p * (1 - frac), failed: n.failed });
    }
    nodes = next;
  };
  const { predict: pd, netfail: nf, replay: rp, hotswap: hs, elastic: el, process: pr } = params;
  if (pd && clamp(a.predict) > 0) stage(clamp(a.predict), clamp(pd.recall), 'predict', { predict: pd.migrationSeconds }, 0);
  if (nf && clamp(a.netfail) > 0) stage(clamp(a.netfail), clamp(nf.success), 'netfail', { netfail: nf.successSeconds }, nf.failureSeconds);
  for (const rung of rungOrder(order)) {
    if (rung === 'replay' && rp && clamp(a.replay) > 0) stage(clamp(a.replay), clamp(rp.success), 'replay', { detect: detectS, replay: rp.successSeconds }, rp.failureSeconds);
    else if (rung === 'hotswap' && hs && clamp(a.hotswap) > 0) stage(clamp(a.hotswap), clamp(hs.success), 'hotswap', { detect: detectS, hotswap: hs.successSeconds }, hs.failureSeconds);
    else if (rung === 'elastic' && el && clamp(a.elastic) > 0) stage(clamp(a.elastic), clamp(el.success), 'elastic', { elastic: el.syncSeconds }, el.failureSeconds);
    else if (rung === 'process' && pr && clamp(a.process) > 0) stage(clamp(a.process), clamp(pr.success), 'process', { detect: detectS, process: pr.successSeconds }, pr.failureSeconds);
  }
  for (const n of nodes) if (n.p > 0) end(n, 'global', { detect: detectS, globalAuto: autoS, globalManual: globalS - autoS });
  return { contrib, probs, meanS: Object.values(contrib).reduce((x, y) => x + y, 0) };
}
function mttrSplit(sc: Scenario) {
  const t = tr(sc);
  if (sc.recovery.mode !== 'mixture') throw new Error('mixture recovery expected');
  const autoS = sc.recovery.automatic.seconds;
  const lam = t.chain.rows.reduce((a, r) => a + r.ratePerHour, 0);
  const contrib: Split = {}, probs: Split = {};
  for (const r of t.chain.rows) {
    const o = chainSplit(t.chain.detectS, t.chain.globalS, autoS, t.chain.params, r.applicable, sc.mechanisms.order);
    if (Math.abs(o.meanS - r.meanPauseS) > 1e-9 * Math.max(1, r.meanPauseS)) throw new Error(`MTTR split does not close for ${r.id}: ${o.meanS} vs ${r.meanPauseS}`);
    const w = r.ratePerHour / lam;
    for (const [k, v] of Object.entries(o.contrib)) contrib[k] = (contrib[k] ?? 0) + w * v;
    for (const [k, v] of Object.entries(o.probs)) probs[k] = (probs[k] ?? 0) + w * v;
  }
  const rec = sc.recovery;
  return {
    mttrS: Object.values(contrib).reduce((x, y) => x + y, 0), contrib, probs,
    recovery: { detectionCoverage: rec.detection.coverage, detectAutoS: rec.detection.autoSeconds, timeoutS: rec.detection.timeoutSeconds, tDetS: t.chain.detectS, autoS: rec.automatic.seconds, success: rec.automatic.successProbability, manualS: rec.manual.seconds, globalS: t.chain.globalS },
    chain: t.chain.params,
  };
}

/* ---------------- per hardware unit: FIT and MTBF ---------------- */
function unitTable(sc: Scenario, x?: Record<string, number>, slack?: number) {
  const cnt = computeCounts(sc);
  const units: Partial<Record<FaultUnit, { unit: FaultUnit; count: number; fit: number; fitAllowed: number; classes: string[] }>> = {};
  let lamHw = 0;
  for (const c of sc.components) {
    if (!c.enabled) continue;
    const ci = componentInstances(c, cnt, sc.measures.subhealthThreshold);
    if (!(ci.lambda > 0)) continue;
    const u = LIB.get(c.id)?.unit;
    if (!u) throw new Error(`no unit for ${c.id}`);
    const fit = ci.lambda * 1e9;
    const f = x?.[c.id] ?? 1;
    const row = (units[u] ??= { unit: u, count: ci.total, fit: 0, fitAllowed: 0, classes: [] });
    row.fit += fit;
    row.fitAllowed += fit * f * (slack ?? 1);
    row.classes.push(c.id);
    lamHw += ci.lambda * ci.total;
  }
  return Object.values(units).map((r) => ({ ...r!, mtbfH: 1e9 / r!.fit, mtbfAllowedH: 1e9 / r!.fitAllowed, share: (r!.count * r!.fit * 1e-9) / lamHw }));
}

/* ---------------- designs of a strategy result ---------------- */
function designs(s: Scenario, r: StrategyResult) {
  const x = Object.fromEntries(r.hardware.rows.map((h) => [h.id, h.factor]));
  const levers = DEFAULT_LEVERS.filter((l) => r.levers.includes(l.id));
  const withMech = r.mechanisms.length ? applyMechanisms(s, r.mechanisms) : s;
  const nom = withHardwareFactors(applyLevers(withMech, levers, null), x);
  const der = withHardwareFactors(applyLevers(deratedMechanisms(withMech), levers, DERATE_DEFAULT), x);
  const kn = kpi(nom), kd = kpi(der);
  if (Math.abs(kn.aOp - r.final.value) > 1e-6 || Math.abs(kd.aOp - r.final.derated) > 1e-6) throw new Error(`design does not reproduce the strategy result: ${kn.aOp} / ${kd.aOp} vs ${r.final.value} / ${r.final.derated}`);
  return { x, nom, der, kn, kd };
}

const out: Record<string, unknown> = { generated: new Date().toISOString(), sizes: TOPOLOGY_SCALES, window: 30, derate: DERATE_DEFAULT, templates: {} as Record<string, unknown> };
for (const tpl of TOPOLOGY_TEMPLATE_IDS as TopologyTemplate[]) {
  const sizes: Record<number, unknown> = {};
  let target = 0.985;
  for (const N of TOPOLOGY_SCALES) {
    const s = topologyScenario(tpl, N);
    target = s.targets.operational ?? 0.985;
    const sDer = deratedMechanisms(s);
    const kn = kpi(s), kd = kpi(sDer);
    // requirement on the derated (binding) design: MTTR_hw [s] / MTBF_hw [h] ≤ B [s/h]
    const B = 3600 * ((1 - kd.phi) / target - 1) - kd.F;
    const required = { B, totalBudget: 3600 * (1 / target - 1), mtbfAtTodayMttrH: kd.mttrS / B, mttrAtTodayMtbfS: B * kd.mtbfHwH, mtbfFactor: kd.mttrS / B / kd.mtbfHwH, mttrFactor: (B * kd.mtbfHwH) / kd.mttrS, ratioToday: kd.mttrS / kd.mtbfHwH };
    const opt = allocateStrategy(s, { strategy: 'optimal', target });
    const hw = allocateStrategy(s, { strategy: 'mttf-first', target });
    const dOpt = designs(s, opt), dHw = designs(s, hw);
    const slackOpt = opt.hardware.slackFactor ?? undefined;
    const row = {
      npus: N, target,
      today: { nom: kn, der: kd, mttr: { nom: mttrSplit(s), der: mttrSplit(sDer) }, units: unitTable(s) },
      required,
      optimal: { feasible: opt.feasible, mechanisms: opt.mechanisms, levers: opt.levers, effort: opt.effort, slack: slackOpt ?? null, nom: dOpt.kn, der: dOpt.kd, mttr: { nom: mttrSplit(dOpt.nom), der: mttrSplit(dOpt.der) }, units: unitTable(s, dOpt.x, slackOpt), hwRows: opt.hardware.rows.filter((h) => h.factor < 1).map((h) => ({ id: h.id, factor: h.factor, currentFit: h.currentFit, allowedFit: h.allowedFit, count: h.count })) },
      hardwareOnly: { feasible: hw.feasible, effort: hw.effort, slack: hw.hardware.slackFactor ?? null, nom: dHw.kn, der: dHw.kd, units: unitTable(s, dHw.x, hw.hardware.slackFactor ?? undefined), atFloors: hw.hardware.atFloors },
    };
    sizes[N] = row;
    log(`${tpl} ${N}: MTBF_hw ${kd.mtbfHwH.toFixed(3)} h, MTTR ${kn.mttrS.toFixed(1)} / ${kd.mttrS.toFixed(1)} s, B ${B.toFixed(1)} s/h → MTBF ≥ ${required.mtbfAtTodayMttrH.toFixed(2)} h or MTTR ≤ ${required.mttrAtTodayMtbfS.toFixed(1)} s | optimal [${[...opt.mechanisms, ...opt.levers].join('+')}] MTBF ${dOpt.kd.mtbfHwH.toFixed(3)} h MTTR ${dOpt.kd.mttrS.toFixed(1)} s (${(dOpt.kd.aOp * 100).toFixed(3)} %) | hw-only MTBF ${dHw.kd.mtbfHwH.toFixed(3)} h`);
  }
  (out.templates as Record<string, unknown>)[tpl] = { name: TOPOLOGY_TEMPLATES[tpl].name, target, sizes };
}
// mechanism parameters: the six defaults as applied, the candidates the recommended designs add, nominal and derated
const ids = ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST', 'D-HARD', 'R-NETFAIL', 'D-SLOW'];
out.mechanisms = Object.fromEntries(ids.map((id) => { const m = mechanismById(id); return [id, { name: m.name, kind: m.kind, effort: m.effort, nominal: m.parameters, derated: derateParameters(m.parameters, DERATE_DEFAULT) }]; }));
out.levers = DEFAULT_LEVERS;
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
