/**
 * A_op ≥ 98.5 % at 500,000 NPUs for the Ascend architectures of the two scaling reports, allocated with ARINC on the hardware and
 * mechanisms (plus recovery levers) on the recovery side, for docs/ARCH_ALLOCATION_98P5_500K.{zh,en}.html:
 *  - architectures: Atlas 900 A3 SuperPoD / CloudMatrix384 and Atlas 800T A3 servers (scripts/ascend910c-archs.ts, main scale-out),
 *    native Atlas 950 SuperPoD and SuperPoD Flex / UBL128 (scripts/ascend950-archs.ts, main scale-out); the HAC-D templates A2 and
 *    Atlas 960E as reference rows;
 *  - yardstick of the HAC-D strategies: the target must hold nominally and with every mechanism derated (coverage −5 pt, success
 *    −8 pt, times ×1.5; the scenario's six defaults included), over the 30-day window, on the engine;
 *  - per architecture: the gap (pause budget B against the pause contributions Σ c_i), the ARINC factor with hardware alone, the
 *    design with every candidate mechanism and lever (no hardware), the three strategies with the ARINC split
 *    (hardware first = ARINC alone, MTTR-preferred = mechanisms first then ARINC, optimal = least total effort) and the optimal plan
 *    with the minimum-effort split for comparison, the ledger verification of the optimal ARINC design, the allowed FIT and MTBF per
 *    hardware unit, where the residual downtime sits, and the iso-target curve (ARINC factor against the automatic recovery time).
 * ARINC here = one factor x on every interruption class (λ_i* = x·λ_i; HAC-D hardwareSplit 'arinc'): with the pause budget
 * B = 3600·((1 − φ)/A* − 1) − F and Σ c_i = Σ λ_i·t̄_i, x = B / Σ c_i, i.e. λ*_hw = B / MTTR_hw and λ_i* = (λ_i/λ_hw)·λ*_hw.
 * Usage: node --import tsx scripts/arch-allocation-500k.ts [--npus 500000] [--target 0.985] [--trials 400] [--out docs/arch-allocation-500k/results.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { topologyScenario, topologyBom } from '../packages/core/src/topology/index.js';
import { allocateStrategy, applyLevers, withHardwareFactors, DEFAULT_LEVERS, DEFAULT_STRATEGY_CANDIDATES, LEVER_NAMES, type StrategyResult, type HardwareSplit, type StrategyId } from '../packages/core/src/strategy/index.js';
import { applyMechanisms, stripMechanisms, mechanismById } from '../packages/core/src/mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { cloneScenario } from '../packages/core/src/scenario/analysis.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { scenarioOf as scen910 } from './ascend910c-archs.js';
import { scenarioOf as scen950 } from './ascend950-archs.js';
import { tr, kpi, breakdown } from './scaling-common.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/arch-allocation-500k/results.json';
const N = Number(flag('npus') ?? 500000);
const TARGET = Number(flag('target') ?? 0.985);
const TRIALS = Number(flag('trials') ?? 400);
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

type L = { zh: string; en: string };
const ARCHS: { id: string; gen: string; ref?: boolean; name: L; scenario: () => Scenario }[] = [
  { id: 'cm384', gen: '910C', name: { zh: '910C · Atlas 900 A3 超节点 / CloudMatrix384', en: '910C · Atlas 900 A3 SuperPoD / CloudMatrix384' }, scenario: () => scen910('cm384', N) },
  { id: 'a3server', gen: '910C', name: { zh: '910C · Atlas 800T A3 服务器集群', en: '910C · Atlas 800T A3 server cluster' }, scenario: () => scen910('a3server', N) },
  { id: 'native950', gen: '950', name: { zh: '950 · 华为原生 Atlas 950 超节点', en: '950 · Huawei native Atlas 950 SuperPoD' }, scenario: () => scen950('native', N) },
  { id: 'ubl128', gen: '950', name: { zh: '950 · SuperPoD Flex / UBL128', en: '950 · SuperPoD Flex / UBL128' }, scenario: () => scen950('ubl128', N) },
  { id: 'a2', gen: '910B', ref: true, name: { zh: '910B · A2 8 卡服务器 + RoCE（模板默认）', en: '910B · A2 8-NPU servers + RoCE (template default)' }, scenario: () => topologyScenario('a2-roce', N) },
  { id: 'a960e', gen: '960', ref: true, name: { zh: '960 · Atlas 960E 超节点（模板默认）', en: '960 · Atlas 960E SuperPoD (template default)' }, scenario: () => topologyScenario('a960e-ub', N) },
];

/** the derated design: every applied mechanism re-applied with derated parameters (the strategies' yardstick) */
function deratedOf(sc: Scenario): Scenario {
  const ids = Object.entries(sc.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  const rec = Object.fromEntries(Object.entries(sc.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, DERATE_DEFAULT)]));
  return ids.length ? applyMechanisms(stripMechanisms(sc, ids), ids, rec) : sc;
}
/** pause budget and contributions of a design: x = B / Σc is the ARINC factor that meets the target exactly */
function gap(sc: Scenario) {
  const k = kpi(sc);
  const B = 3600 * ((1 - k.phi) / TARGET - 1) - k.F;
  return { aOp: k.aOp, aRun: k.aRun, phi: k.phi, F: k.F, sumC: k.sumLP, B, x: B / k.sumLP, lamHw: k.lamHw, mtbfHwH: k.mtbfHwH, mttrS: k.mttrS, delivered: k.delivered, mttrReqS: B / k.lamHw, lamStar: B / k.mttrS };
}
/** every candidate mechanism and every lever at its limit, hardware unchanged (not a ceiling: some candidates lower A_op) */
function allOn(s: Scenario, cands: string[]) {
  const baseIds = Object.entries(s.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  const baseRec = Object.fromEntries(Object.entries(s.mechanisms.applied ?? {}).map(([id, r]) => [id, r.parameters]));
  const derParams = Object.fromEntries([...baseIds.map((id) => [id, derateParameters(baseRec[id], DERATE_DEFAULT)]), ...cands.map((id) => [id, derateParameters(mechanismById(id).parameters, DERATE_DEFAULT)])]);
  const nom = applyLevers(applyMechanisms(s, cands), DEFAULT_LEVERS, null);
  const der = applyLevers(applyMechanisms(stripMechanisms(s, baseIds), [...baseIds, ...cands], derParams), DEFAULT_LEVERS, DERATE_DEFAULT);
  return { aOp: tr(nom).operationalAvailability, aOpDerated: tr(der).operationalAvailability, mechanisms: cands, levers: DEFAULT_LEVERS.map((l) => l.id) };
}
const strip = (r: StrategyResult) => {
  const { scenario: _s, hardware, ...rest } = r;
  void _s;
  const factors = [...new Set(hardware.rows.map((h) => +h.factor.toFixed(9)))];
  // a uniform (ARINC) result lists one factor; a non-uniform split lists the classes it improves
  const improvedRows = factors.length > 1 ? hardware.rows.filter((h) => h.factor < 1).map((h) => ({ id: h.id, factor: h.factor, currentFit: h.currentFit, allowedFit: h.allowedFit, count: h.count })) : [];
  return { ...rest, hardware: { effort: hardware.effort, needed: hardware.needed, atFloors: hardware.atFloors, slackFactor: hardware.slackFactor, factors, classes: hardware.rows.length, improved: hardware.rows.filter((h) => h.factor < 1).length, improvedRows } };
};
/** the uniform factor of an ARINC result (1 when no hardware step) */
const factorOf = (r: StrategyResult) => (r.hardware.needed ? Math.min(...r.hardware.rows.map((h) => h.factor)) : 1);

const UNIT_ORDER = ['npu', 'job', 'node', 'cpu', 'cabinet', 'ub-switch', 'ub-link', 'roce-switch', 'roce-link'];
const results: Record<string, unknown> = {};
for (const a of ARCHS) {
  const s = a.scenario();
  const sDer = deratedOf(s);
  const bom = topologyBom(s);
  const nominal = gap(s), derated = gap(sDer);
  log(`${a.id}: A_op ${(nominal.aOp * 100).toFixed(3)} / derated ${(derated.aOp * 100).toFixed(3)} %, FIT/NPU ${bom.hardFitPerNpuTotal.toFixed(1)}, B ${nominal.B.toFixed(1)} / ${derated.B.toFixed(1)} s/h, Σc ${nominal.sumC.toFixed(1)} / ${derated.sumC.toFixed(1)}, x ${nominal.x.toFixed(4)} / ${derated.x.toFixed(4)}`);
  // per-unit FIT (current) from the bill of materials
  const units = UNIT_ORDER.filter((u) => (bom.hardFitPerNpu as Record<string, number>)[u] > 0).map((u) => {
    const rows = bom.rows.filter((r) => r.faultUnit === u && r.count > 0);
    const count = rows.reduce((x, r) => x + r.count, 0);
    const fitPerNpu = (bom.hardFitPerNpu as Record<string, number>)[u];
    return { unit: u, count, fitPerUnit: (fitPerNpu * N) / count, fitPerNpu };
  });
  // strategies with the ARINC split, and the optimal plan with the minimum-effort split for comparison
  const run = (strategy: StrategyId, split: HardwareSplit, extra: Partial<Parameters<typeof allocateStrategy>[1]> = {}) => allocateStrategy(s, { strategy, target: TARGET, hardwareSplit: split, ...extra });
  const hwOnly = run('mttf-first', 'arinc', { candidates: [], levers: false });
  const mttrFirst = run('mttr-first', 'arinc');
  const optimal = run('optimal', 'arinc', { verify: { trials: TRIALS, seed: 1 } });
  const optimalMin = run('optimal', 'min-effort');
  for (const [k, r] of Object.entries({ hwOnly, mttrFirst, optimal, optimalMin })) log(`  ${k}: ${r.feasible ? 'feasible' : 'NOT'} [${r.mechanisms.join('+')}] [${r.levers.join('+')}] x ${factorOf(r).toFixed(4)} effort ${r.effort.total.toFixed(2)} (hw ${r.effort.hardware.toFixed(2)}) → ${(r.final.aOp * 100).toFixed(3)} / ${(r.final.derated * 100).toFixed(3)} %${r.verification ? ` P ${(r.verification.pAtLeastTarget * 100).toFixed(1)} % ${r.verification.verdict}` : ''}`);
  const allCandidates = allOn(s, DEFAULT_STRATEGY_CANDIDATES);
  // each candidate and lever alone on top of the six defaults: the A_op gain nominally and derated (why it is or is not chosen)
  const singles = (() => {
    const baseIds = Object.entries(s.mechanisms.applied ?? {}).sort((x, y) => x[1].order - y[1].order).map(([id]) => id);
    const baseDer = Object.fromEntries(Object.entries(s.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, DERATE_DEFAULT)]));
    const stripped = stripMechanisms(s, baseIds);
    const out: Record<string, { nominal: number; derated: number }> = {};
    for (const id of DEFAULT_STRATEGY_CANDIDATES) {
      const nom = tr(applyMechanisms(s, [id])).operationalAvailability;
      const der = tr(applyMechanisms(stripped, [...baseIds, id], { ...baseDer, [id]: derateParameters(mechanismById(id).parameters, DERATE_DEFAULT) })).operationalAvailability;
      out[id] = { nominal: nom - nominal.aOp, derated: der - derated.aOp };
    }
    for (const l of DEFAULT_LEVERS) out[`lever:${l.id}`] = { nominal: tr(applyLevers(s, [l], null)).operationalAvailability - nominal.aOp, derated: tr(applyLevers(sDer, [l], DERATE_DEFAULT)).operationalAvailability - derated.aOp };
    return out;
  })();
  // the optimal ARINC design: KPIs and where the residual downtime sits (nominal), plus the derated design's KPIs
  const fin = optimal.scenario;
  const finT = tr(fin);
  const finK = kpi(fin, finT);
  const finB = breakdown(fin, finT);
  // the derated twin of the final design, built as the strategy builds it: the original design's mechanisms and the added ones
  // re-applied with derated parameters, the levers derated against today's recovery (times ×1.5 on the limit, never worse than
  // today), then the same hardware factors
  const finDer = (() => {
    const baseIds = Object.entries(s.mechanisms.applied ?? {}).sort((x, y) => x[1].order - y[1].order).map(([id]) => id);
    const params = Object.fromEntries([...Object.entries(s.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, DERATE_DEFAULT)]), ...optimal.mechanisms.map((id) => [id, derateParameters(mechanismById(id).parameters, DERATE_DEFAULT)])]);
    let d = applyMechanisms(stripMechanisms(s, baseIds), [...baseIds, ...optimal.mechanisms], params);
    d = applyLevers(d, DEFAULT_LEVERS.filter((l) => optimal.levers.includes(l.id)), DERATE_DEFAULT);
    d = withHardwareFactors(d, Object.fromEntries(optimal.hardware.rows.map((h) => [h.id, h.factor])));
    const k = kpi(d);
    if (Math.abs(k.aOp - optimal.final.derated) > 1e-9) throw new Error(`derated twin does not reproduce the strategy: ${k.aOp} vs ${optimal.final.derated}`);
    return k;
  })();
  const factor = factorOf(optimal);
  const hwFactor = factorOf(hwOnly);
  const mttrFactor = factorOf(mttrFirst);
  results[a.id] = {
    id: a.id, gen: a.gen, ref: !!a.ref, name: a.name, npus: N,
    fitPerNpu: bom.hardFitPerNpuTotal,
    counts: { racks: bom.counts.racks, commRacks: bom.counts.commRacks, ubSwitches: bom.counts.ubSwitches, opticalLinks: bom.counts.opticalLinks, scaleOutSwitches: bom.counts.scaleOutSwitches, scaleOutLinks: bom.counts.scaleOutLinks },
    nominal, derated,
    units: units.map((u) => ({ ...u, share: u.fitPerNpu / bom.hardFitPerNpuTotal, mtbfUnitH: 1e9 / u.fitPerUnit, allowedHwOnly: u.fitPerUnit * hwFactor, allowedMttrFirst: u.fitPerUnit * mttrFactor, allowedOptimal: u.fitPerUnit * factor, mtbfHwOnlyH: 1e9 / (u.fitPerUnit * hwFactor), mtbfOptimalH: 1e9 / (u.fitPerUnit * factor) })),
    allCandidates,
    singles,
    strategies: { hwOnly: { ...strip(hwOnly), factor: hwFactor }, mttrFirst: { ...strip(mttrFirst), factor: mttrFactor }, optimal: { ...strip(optimal), factor }, optimalMinEffort: { ...strip(optimalMin), factor: factorOf(optimalMin) } },
    final: {
      aOp: finK.aOp, aOpDerated: finDer.aOp, phi: finK.phi, phiDerated: finDer.phi, mtbfHwH: finK.mtbfHwH, mttrS: finK.mttrS, mtbfHwDerH: finDer.mtbfHwH, mttrDerS: finDer.mttrS, delivered: finK.delivered, lamHw: finK.lamHw, fitPerNpu: (finK.lamHw / N) * 1e9,
      other: finK.other, globalS: finK.globalS + finK.detectS,
      units: Object.fromEntries(Object.entries(finB.units).map(([u, v]) => [u, { lam: v.lam, lp: v.lp, mttrS: v.mttrS, ends: v.ends }])),
      sumLP: finK.sumLP, ends: finB.ends, mttrParts: finB.mttrParts,
      recovery: fin.recovery,
    },
    // ARINC factor (nominal, six defaults, hardware only) against the automatic recovery attempt time: the iso-target curve
    curve: [30, 45, 60, 90, 120, 150, 180].map((sec) => {
      const c = cloneScenario(s);
      if (c.recovery.mode === 'mixture') c.recovery.automatic = { ...c.recovery.automatic, seconds: sec };
      const g = gap(c);
      return { autoS: sec, x: g.x, mttrS: g.mttrS, globalS: kpi(c).globalS + kpi(c).detectS };
    }),
  };
  // confirm the closed-form ARINC factor against the strategy's hardware-only closure (binding side)
  const closed = Math.min(nominal.x, derated.x);
  if (Math.abs(closed - hwFactor) > 2e-3 * closed) log(`  note: closed-form x ${closed.toFixed(5)} vs strategy ${hwFactor.toFixed(5)}`);
}

const lib = (id: string) => { const m = mechanismById(id); return { id, name: m.name, kind: m.kind, effort: m.effort, change: m.change, nominal: m.parameters, derated: derateParameters(m.parameters, DERATE_DEFAULT), requires: m.requires ?? [] }; };
const s0 = ARCHS[0].scenario();
const out = {
  generated: new Date().toISOString(),
  npus: N, target: TARGET, trials: TRIALS,
  derate: DERATE_DEFAULT,
  candidates: DEFAULT_STRATEGY_CANDIDATES.map(lib),
  defaults: Object.keys(s0.mechanisms.applied ?? {}).map(lib),
  levers: DEFAULT_LEVERS.map((l) => ({ ...l, name: LEVER_NAMES[l.id], current: s0.recovery.mode === 'mixture' ? (l.id === 'auto' ? s0.recovery.automatic.seconds : l.id === 'success' ? s0.recovery.automatic.successProbability : s0.recovery.manual.seconds) : null, deratedLimit: l.id === 'success' ? Math.max(0, l.limit - DERATE_DEFAULT.successDelta) : l.limit * DERATE_DEFAULT.timeFactor })),
  baseline: { recovery: s0.recovery, workload: s0.workload },
  archs: results,
};
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
