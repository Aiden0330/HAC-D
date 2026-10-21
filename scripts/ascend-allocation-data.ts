/**
 * Data of the Ascend allocation report set (docs/ASCEND_ALLOCATION_METHODOLOGY.html, docs/ASCEND_ALLOCATION_FINDINGS_*.html):
 * for the four architectures (native Atlas 950 SuperPoD, SuperPoD Flex / UBL128, Atlas 900 A3 SuperPoD / CloudMatrix384, Atlas 800T
 * A3 servers + RoCE) at 10k / 100k / 200k / 500k NPUs, on HAC-D's per-unit basis (topology templates, unit fault library):
 *  - today: the six ReMAP reference mechanisms on the baseline recovery; A_op nominal / derated; the MTBF / MTTR form of A_op with
 *    every event class apart (hardware interruptions through the chain; isolation; detected silent corruption; false alarms); the
 *    per-layer split (six layers by fault unit: cluster = job, scale-out network = RoCE switches + links, SuperPoD = UB switches +
 *    optics, cabinet, node = node + CPU, NPU); the window check (400 × 30-day windows);
 *  - the requirement: MTTR_hw / MTBF_hw ≤ B = 3600·((1 − φ)/A* − 1) − F on the derated design; the MTBF needed at today's MTTR and
 *    the MTTR needed at today's MTBF;
 *  - reference ①: hardware alone (ARINC, mttf-first); the recommended plan: HAC-D's optimal strategy over the 7 A_op-relevant ReMAP
 *    extensions (scripts/ascend-mechanism-hierarchy.ts) and the 3 recovery levers, ARINC hardware, then the window check with
 *    escalation (scaling-common recommendPlan); the final design decomposed by layer, by hardware unit (allowed FIT and MTBF per
 *    unit), by chain rung and recovery stage (MTTR composition, custom rungs included), with every mechanism's parameters nominal
 *    and derated, and the pause each applied mechanism removes per layer (removed from the final design, nominal).
 * Usage: node --import tsx scripts/ascend-allocation-data.ts [--trials 400] [--out docs/backup/ascend-allocation/results.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyBom, type FaultUnit } from '../packages/core/src/topology/index.js';
import { allocateStrategy, applyLevers, withHardwareFactors, DEFAULT_LEVERS } from '../packages/core/src/strategy/index.js';
import { applyMechanisms, stripMechanisms, mechanismById, DEFAULT_PLAYERS } from '../packages/core/src/mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { automaticStages } from '../packages/core/src/scenario/evaluate.js';
import { computeCounts, componentInstances } from '../packages/core/src/scenario/build.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import type { TrainingKpis } from '../packages/core/src/scenario/evaluate.js';
import { REMAP_LATEST_PARAMS } from './remap-latest-params.js';
import { scenarioOf as s950, ARCHS as A950 } from './ascend950-archs.js';
import { scenarioOf as s910, ARCHS as A910 } from './ascend910c-archs.js';
import { tr, kpi, chainSplit, deratedOf, windowCheck, recommendPlan, LIB } from './scaling-common.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/backup/ascend-allocation/results.json';
const TRIALS = Number(flag('trials') ?? 400);
const SIZES = [10000, 100000, 200000, 500000];
const MAIN = 500000;
const TARGET = 0.985;
/** the A_op-relevant ReMAP extensions (A_op Shapley ≥ 0.15 pt at 500k on every architecture, not dominated on a shared recovery stage; scripts/ascend-mechanism-hierarchy.ts) */
export const CANDIDATES = ['D-HARD', 'D-RECOVERY-CLASSIFY', 'R-LINK-LOCAL', 'R-RUNTIME-SNAPSHOT', 'H-CONTROL-CONTINUITY', 'C-LOSSLESS', 'R-FABRIC-DEGRADE'];
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

type L = { zh: string; en: string };
export type LayerId = 'cluster' | 'scaleout' | 'superpod' | 'cabinet' | 'node' | 'npu';
/** the six layers of the per-unit basis, top-down, by fault unit */
export const LAYERS: { id: LayerId; units: FaultUnit[]; name: L; instance: L }[] = [
  { id: 'cluster', units: ['job'], name: { zh: '集群级', en: 'Cluster' }, instance: { zh: '整个作业', en: 'the whole job' } },
  { id: 'scaleout', units: ['roce-switch', 'roce-link'], name: { zh: '跨超节点网络', en: 'Scale-out network' }, instance: { zh: '整张网络', en: 'the whole network' } },
  { id: 'superpod', units: ['ub-switch', 'ub-link'], name: { zh: '超节点（UB 域）', en: 'SuperPoD (UB domain)' }, instance: { zh: '一个超节点', en: 'one SuperPoD' } },
  { id: 'cabinet', units: ['cabinet'], name: { zh: '计算柜', en: 'Compute cabinet' }, instance: { zh: '一个计算柜', en: 'one cabinet' } },
  { id: 'node', units: ['node', 'cpu'], name: { zh: '节点', en: 'Node' }, instance: { zh: '一个节点', en: 'one node' } },
  { id: 'npu', units: ['npu'], name: { zh: 'NPU', en: 'NPU' }, instance: { zh: '一张卡', en: 'one card' } },
];
const unitOf = (id: string): FaultUnit => { const f = LIB.get(id); if (!f) throw new Error(`no unit for ${id}`); return f.unit; };
const layerOf = (id: string): LayerId => { const u = unitOf(id); const l = LAYERS.find((x) => x.units.includes(u)); if (!l) throw new Error(`no layer for unit ${u}`); return l.id; };

const ARCHS: Record<string, { build: (n: number) => Scenario; name: L; short: L; family: '950' | '910C'; assumed: string[] }> = {
  native950: { build: (n) => s950('native', n), name: A950.native.name, short: A950.native.short, family: '950', assumed: A950.native.assumed },
  ubl128: { build: (n) => s950('ubl128', n), name: A950.ubl128.name, short: A950.ubl128.short, family: '950', assumed: A950.ubl128.assumed },
  cm384: { build: (n) => s910('cm384', n), name: A910.cm384.name, short: A910.cm384.short, family: '910C', assumed: A910.cm384.assumed },
  a3server: { build: (n) => s910('a3server', n), name: A910.a3server.name, short: A910.a3server.short, family: '910C', assumed: A910.a3server.assumed },
};

/* ---------------- per-layer read-out of one design ---------------- */
function levels(sc: Scenario, t: TrainingKpis = tr(sc)) {
  const k = kpi(sc, t);
  const cnt = computeCounts(sc);
  const out: Record<LayerId, { lam: number; c: number; iso: number; sdc: number; slowRate: number; sdcRate: number; rows: { id: string; unit: FaultUnit; ratePerHour: number; meanPauseS: number; pGlobal: number }[] }> = Object.fromEntries(LAYERS.map((l) => [l.id, { lam: 0, c: 0, iso: 0, sdc: 0, slowRate: 0, sdcRate: 0, rows: [] }])) as never;
  for (const r of t.chain.rows) {
    const lv = out[layerOf(r.id)];
    lv.lam += r.ratePerHour; lv.c += r.ratePerHour * r.meanPauseS;
    lv.rows.push({ id: r.id, unit: unitOf(r.id), ratePerHour: r.ratePerHour, meanPauseS: r.meanPauseS, pGlobal: r.pGlobal });
  }
  // the other event classes, split by each layer's sub-health and silent rates (job level, per hour)
  for (const c of sc.components) {
    if (!c.enabled) continue;
    const ci = componentInstances(c, cnt, sc.measures.subhealthThreshold);
    if (!(ci.total > 0)) continue;
    const lv = out[layerOf(c.id)];
    lv.slowRate += (c.subhealth?.ratePerHour ?? 0) * ci.total;
    lv.sdcRate += (c.sdc?.ratePerHour ?? 0) * ci.total;
  }
  const slowTot = LAYERS.reduce((a, l) => a + out[l.id].slowRate, 0), sdcTot = LAYERS.reduce((a, l) => a + out[l.id].sdcRate, 0);
  for (const l of LAYERS) { out[l.id].iso = slowTot > 0 ? k.other[0].sPerH * out[l.id].slowRate / slowTot : 0; out[l.id].sdc = sdcTot > 0 ? k.other[1].sPerH * out[l.id].sdcRate / sdcTot : 0; }
  return { k, levels: out };
}
/** MTTR of the chain split by rung (custom rungs included) and the global attempt by recovery stage, rate-weighted over the classes */
function mttrSplit(sc: Scenario, t: TrainingKpis = tr(sc)) {
  if (sc.recovery.mode !== 'mixture') throw new Error('mixture recovery expected');
  const rec = sc.recovery;
  const autoS = rec.automatic.seconds;
  const lam = t.chain.rows.reduce((a, r) => a + r.ratePerHour, 0);
  const contrib: Record<string, number> = {}, probs: Record<string, number> = {};
  for (const r of t.chain.rows) {
    const o = chainSplit(t.chain.detectS, t.chain.globalS, autoS, t.chain.params, r.applicable, sc.mechanisms.order);
    if (Math.abs(o.meanS - r.meanPauseS) > 1e-9 * Math.max(1, r.meanPauseS)) throw new Error(`MTTR split does not close for ${r.id}: ${o.meanS} vs ${r.meanPauseS}`);
    const w = r.ratePerHour / lam;
    for (const [k, v] of Object.entries(o.contrib)) contrib[k] = (contrib[k] ?? 0) + w * v;
    for (const [k, v] of Object.entries(o.probs)) probs[k] = (probs[k] ?? 0) + w * v;
  }
  const st = automaticStages(rec);
  const ga = contrib.globalAuto ?? 0;
  const stages = { startup: ga * st.startup / autoS, read: ga * st.read / autoS, communication: ga * st.communication / autoS, manual: contrib.globalManual ?? 0 };
  return {
    mttrS: Object.values(contrib).reduce((x, y) => x + y, 0), contrib, probs, stages,
    recovery: { detection: rec.detection, tDetS: t.chain.detectS, automatic: { seconds: autoS, successProbability: rec.automatic.successProbability, stages: st }, manualS: rec.manual.seconds, globalS: t.chain.globalS },
    custom: sc.mechanisms.custom ?? null,
  };
}
/** the hardware units of the BOM with today's FIT and the allowed FIT at a uniform factor k */
function unitTable(sc: Scenario, k: number) {
  const bom = topologyBom(sc);
  return bom.rows.filter((r) => r.faultUnit && r.fit && r.fit.hard > 0).map((r) => ({ id: r.id, name: r.name, level: r.level, faultUnit: r.faultUnit, count: r.count, perNpu: r.perNpu, fitToday: r.fit!.hard, fitAllowed: r.fit!.hard * k, mtbfTodayH: 1e9 / r.fit!.hard, mtbfAllowedH: 1e9 / (r.fit!.hard * k), hardPerHourToday: r.hardPerHour ?? 0, hardPerHourAllowed: (r.hardPerHour ?? 0) * k, blastRadiusNpus: r.blastRadiusNpus ?? null, confidence: r.confidence }));
}
const instancesOf = (arch: string, n: number, counts: ReturnType<typeof computeCounts>): Record<LayerId, number> => ({ cluster: 1, scaleout: 1, superpod: arch === 'a3server' ? counts.nodes : counts.supernodes, cabinet: counts.racks, node: counts.nodes, npu: n });
const paramsOf = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { ...mechanismById(id).parameters, ...(REMAP_LATEST_PARAMS[id] ?? {}) }]));
/** per-layer summary of a design (nominal and derated twins) */
function summary(arch: string, n: number, base: Scenario, nom: Scenario, der: Scenario, counts: ReturnType<typeof computeCounts>, k: number) {
  const N = levels(nom), D = levels(der);
  const inst = instancesOf(arch, n, counts);
  const layers = Object.fromEntries(LAYERS.map((l) => {
    const a = N.levels[l.id], d = D.levels[l.id];
    return [l.id, { lam: a.lam, c: a.c, iso: a.iso, sdc: a.sdc, mttrS: a.lam > 0 ? a.c / a.lam : 0, cDerated: d.c, isoDerated: d.iso, sdcDerated: d.sdc, mttrDeratedS: d.lam > 0 ? d.c / d.lam : 0, instances: inst[l.id], mtbfH: a.lam > 0 ? 1 / a.lam : null, mtbfInstanceH: a.lam > 0 ? inst[l.id] / a.lam : null, rows: a.rows }];
  }));
  return { kpi: N.k, kpiDerated: D.k, layers, mttr: { nom: mttrSplit(nom), der: mttrSplit(der) }, units: unitTable(base, k), k };
}

const out: Record<string, unknown> = { generated: new Date().toISOString(), target: TARGET, sizes: SIZES, main: MAIN, trials: TRIALS, derate: DERATE_DEFAULT, candidates: CANDIDATES, levers: DEFAULT_LEVERS, reference: DEFAULT_PLAYERS, layers: LAYERS, archs: {} };
for (const [arch, A] of Object.entries(ARCHS)) {
  const sizes: Record<number, unknown> = {};
  for (const n of SIZES) {
    const s = A.build(n), t = tr(s), sDer = deratedOf(s);
    const bom = topologyBom(s), counts = bom.counts;
    const today = summary(arch, n, s, s, sDer, counts, 1);
    const kD = today.kpiDerated;
    const B = 3600 * ((1 - kD.phi) / TARGET - 1) - kD.F;
    const required = { B, totalBudget: 3600 * (1 / TARGET - 1), mtbfAtTodayMttrH: kD.mttrS / B, mttrAtTodayMtbfS: B * kD.mtbfHwH, ratioToday: kD.mttrS / kD.mtbfHwH, mtbfFactor: kD.mttrS / B / kD.mtbfHwH, mttrFactor: (B * kD.mtbfHwH) / kD.mttrS };
    const todayWindow = windowCheck(s, TARGET, TRIALS);
    const hwOnly = allocateStrategy(s, { strategy: 'mttf-first', target: TARGET, candidates: [], levers: false, hardwareSplit: 'arinc' });
    const hwFactor = hwOnly.hardware.needed ? Math.min(...hwOnly.hardware.rows.map((h) => h.factor)) : null;
    const opt = allocateStrategy(s, { strategy: 'optimal', target: TARGET, candidates: CANDIDATES, parameters: REMAP_LATEST_PARAMS, levers: DEFAULT_LEVERS, hardwareSplit: 'arinc', verify: { trials: TRIALS, seed: 1 } });
    const optFactor = opt.hardware.needed ? Math.min(...opt.hardware.rows.map((h) => h.factor)) : null;
    const rec = recommendPlan(s, { candidates: CANDIDATES, parameters: REMAP_LATEST_PARAMS, mechanisms: opt.mechanisms, leverIds: opt.levers, target: TARGET, trials: TRIALS });
    const fin = summary(arch, n, s, rec.nom, rec.der, counts, rec.k);
    // the design's mechanisms with their parameters, nominal and derated
    const applied = Object.entries(rec.nom.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id, r]) => ({ id, order: r.order, kind: mechanismById(id).kind, effort: mechanismById(id).effort, nominal: r.parameters, derated: rec.der.mechanisms.applied?.[id]?.parameters ?? derateParameters(r.parameters, DERATE_DEFAULT) }));
    const leverValues = { nominal: rec.nom.recovery.mode === 'mixture' ? { autoSeconds: rec.nom.recovery.automatic.seconds, success: rec.nom.recovery.automatic.successProbability, manualSeconds: rec.nom.recovery.manual.seconds } : null, derated: rec.der.recovery.mode === 'mixture' ? { autoSeconds: rec.der.recovery.automatic.seconds, success: rec.der.recovery.automatic.successProbability, manualSeconds: rec.der.recovery.manual.seconds } : null };
    // pause each applied mechanism removes per layer (nominal, removed from the final design; R-SDC goes with D-SDC)
    const bare = stripMechanisms(s, [...DEFAULT_PLAYERS]);
    const allIds = applied.map((a) => a.id);
    const kFactors = Object.fromEntries(rec.hardwareClasses.map((id) => [id, rec.k]));
    const rebuild = (keep: string[]) => withHardwareFactors(applyLevers(applyMechanisms(bare, keep, paramsOf(keep)), DEFAULT_LEVERS.filter((l) => rec.levers.includes(l.id)), null), kFactors);
    { const a = tr(rebuild(allIds)).operationalAvailability; if (Math.abs(a - fin.kpi.aOp) > 1e-9) throw new Error(`rebuilt final design differs: ${a} vs ${fin.kpi.aOp}`); }
    const removal = Object.fromEntries(allIds.map((id) => {
      const keep = allIds.filter((x) => x !== id && !(id === 'D-SDC' && x === 'R-SDC'));
      const lv = levels(rebuild(keep));
      const base = fin.layers;
      return [id, { byLayer: Object.fromEntries(LAYERS.map((l) => [l.id, (lv.levels[l.id].c + lv.levels[l.id].iso + lv.levels[l.id].sdc) - (base[l.id].c + base[l.id].iso + base[l.id].sdc)])), aOp: fin.kpi.aOp - lv.k.aOp, delivered: fin.kpi.delivered - lv.k.delivered }];
    }));
    sizes[n] = {
      npus: n, counts, instances: instancesOf(arch, n, counts), bomRows: bom.rows.map((r) => ({ id: r.id, name: r.name, level: r.level, count: r.count, perNpu: r.perNpu, faultUnit: r.faultUnit ?? null, fitHard: r.fit?.hard ?? null, hardPerHour: r.hardPerHour ?? null, confidence: r.confidence })), hardFitPerNpu: bom.hardFitPerNpu, hardFitPerNpuTotal: bom.hardFitPerNpuTotal, hardPerHour: bom.hardPerHour,
      today: { ...today, window: todayWindow, aOp: today.kpi.aOp, aOpDerated: today.kpiDerated.aOp },
      required,
      hardwareOnly: { needed: hwOnly.hardware.needed, factor: hwFactor, slack: hwOnly.hardware.slackFactor ?? null, final: hwOnly.final.value, finalDerated: hwOnly.final.derated, effort: hwOnly.effort.total },
      optimal: { feasible: opt.feasible, mechanisms: opt.mechanisms, levers: opt.levers, needed: opt.hardware.needed, factor: optFactor, slack: opt.hardware.slackFactor ?? null, final: opt.final.value, finalDerated: opt.final.derated, effort: opt.effort, verification: opt.verification ?? null, alternatives: (opt.alternatives ?? []).slice(0, 6).map((p) => ({ mechanisms: p.mechanisms, levers: p.levers, effort: p.effort.total, value: p.value, derated: p.derated, feasible: p.feasible })), evaluations: opt.evaluations },
      recommended: { mechanisms: rec.mechanisms, levers: rec.levers, k: rec.k, kMean: rec.kMean, kPlan: rec.kPlan, binding: rec.binding, escalated: rec.escalated, tried: rec.tried, window: rec.window, windowPlan: rec.windowPlan, effort: rec.effort, applied, leverValues, plan: { aOp: tr(rec.planNom).operationalAvailability, aOpDerated: tr(rec.planDer).operationalAvailability }, final: fin, removal },
    };
    log(`${arch} ${n}: today ${(today.kpi.aOp * 100).toFixed(3)} / ${(kD.aOp * 100).toFixed(3)} % (MTBF ${kD.mtbfHwH.toFixed(3)} h, MTTR ${kD.mttrS.toFixed(1)} s, P ${(todayWindow.pAtLeastTarget * 100).toFixed(0)} %) | B ${B.toFixed(1)} s/h → MTBF ≥ ${required.mtbfAtTodayMttrH.toFixed(2)} h or MTTR ≤ ${required.mttrAtTodayMtbfS.toFixed(1)} s | hw-only ${hwFactor ? `×${hwFactor.toFixed(3)}` : `slack ×${(hwOnly.hardware.slackFactor ?? 0).toFixed(2)}`} | optimal ${opt.mechanisms.join('+') || '—'} | ${opt.levers.join('+') || '—'} ${optFactor ? `×${optFactor.toFixed(3)}` : `slack ×${(opt.hardware.slackFactor ?? 0).toFixed(2)}`} → ${(opt.final.value * 100).toFixed(2)} / ${(opt.final.derated * 100).toFixed(2)} % P ${((opt.verification?.pAtLeastTarget ?? 0) * 100).toFixed(1)} % | recommended ${rec.mechanisms.join('+') || '—'} | ${rec.levers.join('+') || '—'} k ${rec.k.toFixed(3)} (${rec.binding}${rec.escalated ? ', escalated' : ''}) → ${(fin.kpi.aOp * 100).toFixed(2)} / ${(fin.kpiDerated.aOp * 100).toFixed(2)} % P ${(rec.window.pAtLeastTarget * 100).toFixed(1)} % | MTBF ${fin.kpiDerated.mtbfHwH.toFixed(3)} h MTTR ${fin.kpiDerated.mttrS.toFixed(1)} s`);
  }
  (out.archs as Record<string, unknown>)[arch] = { name: A.name, short: A.short, family: A.family, assumed: A.assumed, sizes };
}
out.mechanismLibrary = Object.fromEntries([...DEFAULT_PLAYERS, ...CANDIDATES].map((id) => { const m = mechanismById(id); const p = { ...m.parameters, ...(REMAP_LATEST_PARAMS[id] ?? {}) }; return [id, { name: m.name, kind: m.kind, effort: m.effort, change: m.change, requires: m.requires ?? [], nominal: p, derated: derateParameters(p, DERATE_DEFAULT) }]; }));
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
