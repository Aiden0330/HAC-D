/**
 * Regression tests of the fifth model review (docs/markdown/MODEL_REVIEW_2026-10-27.md, resolved 2026-10-27): D1 audited
 * mechanisms through the project editor, D3 the set's recovery baseline, D4 the MTTR split with per-class stages, D5 the derated
 * twin in recorded order and the commuting silent-corruption detectors, D6 formula (2) when B ≤ 0, D7 the smallest window count,
 * D8 the project report's study parameters and fixed mechanisms, D9 the scale-out toggle, M1 / M2 formula (3), R2 the predictor's
 * applicability. Every scenario is a built-in public one.
 */
import { describe, it, expect } from 'vitest';
import { topologyScenario, unitFaultLibrary } from '../src/topology/index.js';
import { editMechanisms, setScenarioFields, scenarioVocabulary, mechanismDefaults } from '../src/project/edit.js';
import { applyMechanisms, applyMechanismsInOrder, stripMechanisms, DEFAULT_PLAYERS } from '../src/mechanisms/index.js';
import { applyLevers, allocateStrategy, DEFAULT_LEVERS } from '../src/strategy/index.js';
import { DERATE_DEFAULT } from '../src/mechanisms/plan.js';
import { deratedOf, recommendPlan } from '../src/strategy/window.js';
import { requirement } from '../src/strategy/requirement.js';
import { mttrDecomposition, classChainSplits } from '../src/mttr/decompose.js';
import { resolveMechanismSet, DEFAULT_MECHANISM_SET, parseMechanismSet } from '../src/records/mechanismSet.js';
import { recordScenario, hierarchicalBudget } from '../src/budget/index.js';
import { reportFromScenario } from '../src/budget/report.js';
import { studyOfBuild } from '../src/study/archStudy.js';
import { withSize } from '../src/study/index.js';
import { BUILTIN_TOPOLOGY_RECORDS } from '../src/records/topologyRecord.js';
import { minWindowTrials } from '../src/math/stats.js';
import { trainingOf, kpiForm } from '../src/budget/kpiForm.js';
import { byLayer, unavailabilityByLayer, DEFAULT_LAYERS } from '../src/layers/index.js';
import { computeCounts, componentInstances, classSdcCoverage } from '../src/scenario/build.js';
import { catalogScenario } from '../src/scenario/examples.js';
import { REFERENCE_EVENTS } from '../src/scenario/referenceEvents.js';
import type { Scenario } from '../src/scenario/schema.js';

const SET = resolveMechanismSet(DEFAULT_MECHANISM_SET);
const aOp = (s: Scenario) => trainingOf(s).operationalAvailability;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('D1 — audited mechanisms through the project editor', () => {
  const s = topologyScenario('a3-ub384', 10000);
  it('applies with the default set’s parameters (the report’s), records it and changes the KPIs', () => {
    for (const id of ['R-LINK-LOCAL', 'H-CONTROL-CONTINUITY', 'D-RECOVERY-CLASSIFY', 'R-RUNTIME-SNAPSHOT', 'D-SDC-FP8', 'H-SDC-SCREEN']) {
      const e = editMechanisms(s, { apply: { [id]: {} } });
      expect(e.changed, id).toEqual([`+${id}`]);
      expect(e.scenario.mechanisms.applied?.[id]?.parameters, id).toEqual(mechanismDefaults(id));
      expect(mechanismDefaults(id), id).toMatchObject(SET.parameters[id]);
    }
    const e = editMechanisms(s, { apply: { 'R-LINK-LOCAL': {} } });
    expect(aOp(e.scenario)).toBeGreaterThan(aOp(s));
    // the set's integration keys may be overridden; the vocabulary lists them with nothing missing
    const o = editMechanisms(s, { apply: { 'R-LINK-LOCAL': { eligibleShare: 0.5, success: 0.8 } } });
    expect(o.scenario.mechanisms.applied!['R-LINK-LOCAL'].parameters).toMatchObject({ eligibleShare: 0.5, success: 0.8 });
    const v = scenarioVocabulary(s).mechanisms.find((m) => m.id === 'R-LINK-LOCAL')!;
    expect(v.keys).toEqual(expect.arrayContaining(['eligibleShare', 'success', 'failureSeconds', 'successSeconds']));
    expect(v.needs).toEqual([]);
    expect(v.inSet).toBe(true);
    expect(v.effort).toBe(SET.efforts['R-LINK-LOCAL']);
  });
  it('refuses an unknown key and a mechanism whose requirement is not applied; a plain library mechanism keeps its defaults', () => {
    expect(() => editMechanisms(s, { apply: { 'R-LINK-LOCAL': { nope: 1 } } })).toThrow(/no parameter 'nope'/);
    const noElastic = stripMechanisms(s, ['R-ELASTIC']);
    expect(() => editMechanisms(noElastic, { apply: { 'R-HCCL-ELASTIC': {} } })).toThrow(/requires R-ELASTIC/);
    expect(editMechanisms(s, { apply: { 'R-HCCL-ELASTIC': {} } }).changed).toEqual(['+R-HCCL-ELASTIC']);
    expect(mechanismDefaults('C-MEM')).toEqual({ computeSeconds: 60, saveSeconds: 0.5, loadSavingSeconds: 60, overhead: 0.01 });
  });
});

describe('D3 — the mechanism set’s recovery baseline reaches a record-built scenario', () => {
  it('a set with its own recovery changes the scenario; the default set equals the template', () => {
    const slow = parseMechanismSet({ ...clone(DEFAULT_MECHANISM_SET), id: 'what-if', recovery: { ...clone(DEFAULT_MECHANISM_SET.recovery), automatic: { seconds: 90, successProbability: 0.995 }, manual: { seconds: 3600 } } });
    const a = recordScenario(BUILTIN_TOPOLOGY_RECORDS.cm384, slow, 10000);
    expect(a.recovery).toMatchObject({ mode: 'mixture', automatic: { seconds: 90, successProbability: 0.995 }, manual: { seconds: 3600 } });
    const b = recordScenario(BUILTIN_TOPOLOGY_RECORDS.cm384, DEFAULT_MECHANISM_SET, 10000);
    expect(b.recovery).toMatchObject({ mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { seconds: 180, successProbability: 0.99 }, manual: { seconds: 7200 } });
    expect(aOp(a)).toBeGreaterThan(aOp(b));
    // D-HARD of the set's baseline still acts on top of the written recovery
    const withHard = parseMechanismSet({ ...clone(slow), baseline: [...slow.baseline, 'D-HARD'], candidates: slow.candidates.filter((x) => x !== 'D-HARD'), verdicts: { ...clone(slow.verdicts), 'D-HARD': { verdict: 'reference', reason: { zh: '测试', en: 'test' } } } });
    const c = recordScenario(BUILTIN_TOPOLOGY_RECORDS.cm384, withHard, 10000);
    expect(c.recovery).toMatchObject({ detection: { coverage: 0.999, autoSeconds: 1 }, automatic: { seconds: 90 } });
  });
});

describe('D4 — the MTTR split with per-class recovery stages', () => {
  const base = topologyScenario('a3-ub384', 10000);
  it('closes for every class and the stage split keeps its identity', () => {
    for (const id of ['R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH', 'R-WARM-PROCESS']) {
      const s = applyMechanisms(base, [id], SET.parameters);
      const t = trainingOf(s);
      const own = t.chain.rows.filter((r) => r.globalS < t.chain.globalS - 1e-9);
      expect(own.length, id).toBeGreaterThan(0);
      const d = mttrDecomposition(s, t);
      expect(d.mttrS).toBeCloseTo(kpiForm(s, t).mttrS, 9);
      expect(d.stages.startup + d.stages.read + d.stages.communication + d.stages.manual).toBeCloseTo((d.contrib.globalAuto ?? 0) + (d.contrib.globalManual ?? 0), 9);
      for (const row of classChainSplits(s, t)) expect(row.split.meanS, `${id} ${row.id}`).toBeCloseTo(row.meanPauseS, 9);
      // a class with its own stages: g_i = G − (A − A_i), autoS_i = A_i, the manual share unchanged
      const r = own[0];
      expect(r.autoS).toBeCloseTo(r.stages!.startup + r.stages!.read + r.stages!.communication, 9);
      expect(r.globalS - r.autoS).toBeCloseTo(t.chain.globalS - (s.recovery.mode === 'mixture' ? s.recovery.automatic.seconds : 0), 9);
    }
  });
  it('a budget of a design with such a mechanism no longer throws', () => {
    const s = applyMechanisms(base, ['R-RUNTIME-SNAPSHOT'], SET.parameters);
    const b = hierarchicalBudget(s, { target: 0.985, candidates: [], parameters: SET.parameters, levers: SET.levers, reference: [...DEFAULT_PLAYERS, 'R-RUNTIME-SNAPSHOT'], derate: SET.derate, trials: 40 });
    expect(b.today.mttr.nom.mttrS).toBeCloseTo(b.today.kpi.mttrS, 9);
  }, 300_000);
});

describe('D5 — the derated twin keeps the recorded order; the detectors commute', () => {
  const s0 = topologyScenario('a3-ub384', 10000, { mechanisms: ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC'] });
  it('C-MEM then C-FAST: the twin derates the last-applied checkpoint design, not the library order', () => {
    const s = applyMechanisms(applyMechanisms(s0, ['C-MEM']), ['C-FAST']);
    const w = (x: Scenario) => (x.workload.type === 'training' ? x.workload.deltaS : NaN);
    expect(w(s)).toBe(1);
    expect(w(deratedOf(s))).toBeCloseTo(1.5, 12);
    // applyMechanismsInOrder reproduces the design from the bare scenario; library order does not
    const ids = Object.entries(s.mechanisms.applied!).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
    const params = Object.fromEntries(Object.entries(s.mechanisms.applied!).map(([id, r]) => [id, r.parameters]));
    expect(w(applyMechanismsInOrder(stripMechanisms(s, ids), ids, params))).toBe(1);
    expect(w(applyMechanisms(stripMechanisms(s, ids), ids, params))).toBe(0.5);
  });
  it('D-SDC and D-SDC-DMR give the same coverage in either order, nominal and derated', () => {
    const t0 = topologyScenario('a3-ub384', 10000, { mechanisms: ['R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'] });
    const a = applyMechanisms(applyMechanisms(t0, ['D-SDC-DMR']), ['D-SDC']);
    const b = applyMechanisms(applyMechanisms(t0, ['D-SDC']), ['D-SDC-DMR']);
    expect(a.sdc.detection.coverage).toBe(0.999);
    expect(b.sdc.detection.coverage).toBe(0.999);
    expect(deratedOf(a).sdc.detection.coverage).toBeCloseTo(0.949, 12);
    expect(deratedOf(b).sdc.detection.coverage).toBeCloseTo(0.949, 12);
    expect(stripMechanisms(a, ['D-SDC']).sdc.detection.coverage).toBe(0.999);
    expect(stripMechanisms(a, ['D-SDC', 'D-SDC-DMR']).sdc.detection.coverage).toBe(0);
  });
  it('the budget’s rebuild closes for a project whose reference mechanisms were applied in another order', () => {
    const t0 = topologyScenario('a3-ub384', 1000, { mechanisms: ['R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'] });
    const p = applyMechanisms(applyMechanisms(t0, ['D-SDC-DMR']), ['D-SDC']);
    const ref = Object.keys(p.mechanisms.applied!);
    const b = hierarchicalBudget(p, { target: 0.985, candidates: ['D-HARD'], parameters: SET.parameters, levers: SET.levers, reference: ref, derate: SET.derate, trials: 40 });
    expect(b.recommended.final.kpi.aOp).toBeGreaterThan(0.9);
  }, 300_000);
});

describe('D6 — formula (2) when F and φ take the whole budget', () => {
  const s = topologyScenario('a3-ub384', 500000);
  it('B ≤ 0 gives no MTBF / MTTR requirement instead of negative ones', () => {
    const ok = requirement(s, 0.985);
    expect(ok.reachable).toBe(true);
    expect(ok.mtbfAtTodayMttrH! * ok.B).toBeCloseTo(ok.kpiDerated.mttrS, 9);
    const no = requirement(s, 0.998);
    expect(no.B).toBeLessThan(0);
    expect(no.reachable).toBe(false);
    expect(no.mtbfAtTodayMttrH).toBeNull();
    expect(no.mttrAtTodayMtbfS).toBeNull();
    expect(no.mtbfFactor).toBeNull();
    expect(no.mttrFactor).toBeNull();
    expect(no.totalBudget).toBeCloseTo(3600 * (1 / 0.998 - 1), 9);
  });
});

describe('D7 — the smallest window count of a supportable check', () => {
  it('35 windows for P ≥ 0.9 at 95 %; fewer are refused with the minimum named', () => {
    expect(minWindowTrials(0.9)).toBe(35);
    expect(minWindowTrials(0.95)).toBe(73);
    expect(minWindowTrials(0.5)).toBe(4);
    const s = topologyScenario('a3-ub384', 1000);
    expect(() => recommendPlan(s, { target: 0.985, candidates: [], mechanisms: [], leverIds: [], trials: 34 })).toThrow(/at least 35 windows/);
    expect(() => hierarchicalBudget(s, { target: 0.985, candidates: [], trials: 20 })).toThrow(/at least 35 windows/);
    expect(() => reportFromScenario(s, { id: 'x', name: { zh: 'x', en: 'x' }, short: { zh: 'x', en: 'x' }, sizes: [1000], target: 0.985, trials: 20 })).toThrow(/at least 35 windows/);
  });
});

describe('D8 — the project report’s study runs with the project’s parameters', () => {
  const base = topologyScenario('a3-ub384', 1000);
  const build = (s: Scenario) => (n: number) => withSize(s, n);
  it('a project D-SDC at coverage 0.6 is studied at 0.6; a mechanism outside the set is listed as fixed', () => {
    const low = applyMechanisms(base, ['D-SDC'], { 'D-SDC': { coverage: 0.6, detectSeconds: 1 } });
    const params = { ...SET.parameters, 'D-SDC': { ...SET.parameters['D-SDC'], coverage: 0.6 } };
    const a = studyOfBuild('low', build(low), DEFAULT_MECHANISM_SET, { sizes: [1000], permutations: 4, seed: 1, parameters: params });
    const b = studyOfBuild('ref', build(base), DEFAULT_MECHANISM_SET, { sizes: [1000], permutations: 4, seed: 1 });
    expect(a.projectParameters).toEqual({ 'D-SDC': { coverage: 0.6, detectSeconds: 1 } });
    expect(a.parameters).toEqual(DEFAULT_MECHANISM_SET.parameters);
    expect(b.projectParameters).toBeUndefined();
    const gain = (st: typeof a) => st.perSize['1000'].gains.find((g) => g.id === 'D-SDC')!.delivered.shapley;
    expect(gain(a)).toBeLessThan(gain(b));
    expect(a.fixed).toBeUndefined();
    const withMem = applyMechanisms(base, ['C-MEM']);
    const c = studyOfBuild('mem', build(withMem), DEFAULT_MECHANISM_SET, { sizes: [1000], permutations: 4, seed: 1 });
    expect(c.fixed).toEqual(['C-MEM']);
  }, 300_000);
  it('reportFromScenario passes the merged parameters and names the changed and the fixed mechanisms in the hierarchy’s basis', () => {
    const low = applyMechanisms(applyMechanisms(base, ['D-SDC'], { 'D-SDC': { coverage: 0.6, detectSeconds: 1 } }), ['C-MEM']);
    const r = reportFromScenario(low, { id: 'low', name: { zh: 'x', en: 'x' }, short: { zh: 'x', en: 'x' }, sizes: [1000], target: 0.985, trials: 40, permutations: 4 });
    expect(r.studies.low.projectParameters?.['D-SDC']).toEqual({ coverage: 0.6, detectSeconds: 1 });
    expect(r.studies.low.fixed).toEqual(['C-MEM']);
    expect(r.mechanisms.source.basis).toMatch(/the project's parameters for D-SDC/);
    expect(r.mechanisms.source.basis).toMatch(/fixed in the base.*C-MEM/);
  }, 300_000);
});

describe('D9 — the scale-out toggle keeps per-class mechanism effects', () => {
  it('R-LINK-LOCAL still acts on the restored @roce classes after off then on', () => {
    const s = applyMechanisms(topologyScenario('a3-ub384', 10000), ['R-LINK-LOCAL'], SET.parameters);
    const rung = (x: Scenario) => x.components.filter((c) => c.id.includes('@roce') && c.mechanisms?.custom?.['R-LINK-LOCAL']).length;
    const off = setScenarioFields(s, { 'topology.scaleOut': false }).scenario;
    expect(off.components.some((c) => c.id.includes('@roce'))).toBe(false);
    expect(off.mechanisms.applied?.['R-LINK-LOCAL']).toBeDefined();
    const on = setScenarioFields(off, { 'topology.scaleOut': true }).scenario;
    expect(rung(on)).toBe(rung(s));
    expect(aOp(on)).toBeCloseTo(aOp(s), 12);
  });
});

describe('M1 / M2 — formula (3): the denominator with F, the detected-corruption split', () => {
  it('U_ℓ uses D = 1 + (ΣC + F)/3600 with the predictor’s false alarms in F', () => {
    const s = applyMechanisms(topologyScenario('a3-ub384', 10000), ['P-PREDICT']);
    const x = byLayer(s);
    expect(x.k.other[2].sPerH).toBeGreaterThan(0);
    const D = 1 + (x.k.sumLP + x.k.F) / 3600;
    const u = unavailabilityByLayer(x);
    expect(u.hard).toBeCloseTo(DEFAULT_LAYERS.reduce((a, l) => a + (100 * x.levels[l.id].c) / (3600 * D), 0), 12);
  });
  it('the detected-corruption pause is split by λ_sdc,i q_i, not by the raw silent rate', () => {
    const s = applyMechanisms(topologyScenario('a3-ub384', 10000), ['D-SDC', 'D-ABFT'], SET.parameters);
    const x = byLayer(s);
    const cnt = computeCounts(s);
    let det = 0, raw = 0, detNpu = 0, rawNpu = 0;
    const lib = new Map(unitFaultLibrary().map((f) => [f.id, f.unit]));
    for (const c of s.components) {
      const ci = componentInstances(c, cnt, s.measures.subhealthThreshold);
      const r = (c.sdc?.ratePerHour ?? 0) * ci.total, q = classSdcCoverage(ci, s.sdc.detection.coverage);
      det += r * q; raw += r;
      if (lib.get(c.id) === 'npu') { detNpu += r * q; rawNpu += r; }
    }
    expect(detNpu / det).not.toBeCloseTo(rawNpu / raw, 4);
    expect(x.levels.npu.sdc).toBeCloseTo(x.k.other[1].sPerH * detNpu / det, 12);
    expect(x.levels.npu.sdcDetectedRate).toBeCloseTo(detNpu, 12);
    expect(DEFAULT_LAYERS.reduce((a, l) => a + x.levels[l.id].sdc, 0)).toBeCloseTo(x.k.other[1].sPerH, 12);
  });
});

describe('R2 — the predictor’s applicability follows the catalog’s scope rule', () => {
  it('every topology class carries the catalog’s predict flag (BOXIO-hard: scope rack → 0)', () => {
    const cat = catalogScenario(REFERENCE_EVENTS, { npus: 10000 });
    const catPredict = new Map(cat.components.map((c) => [c.id, c.mechanisms?.predict ?? 0]));
    for (const tpl of ['a3-ub384', 'a950-ub2', 'a2-roce', 'a960e-ub'] as const) {
      const s = topologyScenario(tpl, 10000);
      for (const c of s.components) if (c.failure.value > 0) expect(c.mechanisms?.predict ?? 0, `${tpl} ${c.id}`).toBe(catPredict.get(c.id.replace(/@.*$/, '')));
    }
    expect(unitFaultLibrary().find((f) => f.id === 'BOXIO-hard')!.scope).toBe('rack');
    expect(topologyScenario('a3-ub384', 10000).components.find((c) => c.id === 'BOXIO-hard')!.mechanisms!.predict).toBe(0);
  });
});

/* ---------------- recheck of the fifth review (2026-10-27): the same-stage rule and the custom-rung order are order-independent ---------------- */
import { simulateScenarioLedger } from '../src/index.js';
import { sameStageValue } from '../src/mechanisms/auditLibrary.js';

describe('recheck D5 — the same-stage rule is the per-event expectation, independent of the order of application', () => {
  const s = topologyScenario('a3-ub384', 100000);
  const startup = (x: Scenario, id = 'UNKNOWN-hard') => x.components.find((c) => c.id === id)!.recoveryStages?.startup;
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  it('the formula: one mechanism is the old sequential rule; several sort by candidate; a candidate at or above the base adds nothing', () => {
    expect(sameStageValue(60, [{ c: 20, a: 0.95 }])).toBeCloseTo(22, 12);
    expect(sameStageValue(60, [{ c: 20, a: 0.95 }, { c: 15, a: 0.95 }])).toBeCloseTo(15.35, 12);
    expect(sameStageValue(60, [{ c: 15, a: 0.95 }, { c: 20, a: 0.95 }])).toBeCloseTo(15.35, 12);
    expect(sameStageValue(60, [{ c: 37.5, a: 0.95 }, { c: 20, a: 0.95 }, { c: 15, a: 0.95 }])).toBeCloseTo(15.2965625, 12);
    expect(sameStageValue(60, [{ c: 20, a: 1 }, { c: 15, a: 1 }, { c: 37.5, a: 1 }])).toBe(15);
    expect(sameStageValue(60, [{ c: 70, a: 1 }])).toBe(60);
  });
  it('the startup trio gives the same class stage and the same A_op in all six orders (set parameters, shares 0.95)', () => {
    const ids = ['R-WARM-PROCESS', 'R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH'];
    const values = perms(ids).map((order) => { const x = applyMechanismsInOrder(s, order, SET.parameters); return { order: order.join('→'), startup: startup(x)!, aOp: aOp(x) }; });
    for (const v of values) { expect(v.startup, v.order).toBeCloseTo(15.2965625, 9); expect(v.aOp, v.order).toBeCloseTo(values[0].aOp, 12); }
    // pairs in both orders, singles as before
    for (const [a, b, want] of [['R-WARM-PROCESS', 'R-RUNTIME-SNAPSHOT', 15.35], ['R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH', 16.18125], ['R-WARM-PROCESS', 'R-CANN-GRAPH', 20.93125]] as const) {
      expect(startup(applyMechanismsInOrder(s, [a, b], SET.parameters)), `${a}→${b}`).toBeCloseTo(want, 9);
      expect(startup(applyMechanismsInOrder(s, [b, a], SET.parameters)), `${b}→${a}`).toBeCloseTo(want, 9);
    }
    expect(startup(applyMechanisms(s, ['R-WARM-PROCESS'], SET.parameters))).toBeCloseTo(22, 12);
    expect(startup(applyMechanisms(s, ['R-RUNTIME-SNAPSHOT'], SET.parameters))).toBeCloseTo(17.25, 12);
    expect(startup(applyMechanisms(s, ['R-CANN-GRAPH'], SET.parameters))).toBeCloseTo(38.625, 12);
    // a class outside a mechanism's candidates keeps the others' expectation; one outside all three keeps the job's stage
    expect(startup(applyMechanisms(s, ids, SET.parameters), 'POWER-hard')).toBeUndefined();
  });
  it('removal is the exact inverse whatever the order: stripping one of three equals applying the other two', () => {
    const three = applyMechanismsInOrder(s, ['R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH', 'R-WARM-PROCESS'], SET.parameters);
    const two = stripMechanisms(three, ['R-RUNTIME-SNAPSHOT']);
    expect(startup(two)).toBeCloseTo(20.93125, 9);
    expect(aOp(two)).toBeCloseTo(aOp(applyMechanisms(s, ['R-WARM-PROCESS', 'R-CANN-GRAPH'], SET.parameters)), 12);
    const none = stripMechanisms(three, ['R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH', 'R-WARM-PROCESS']);
    expect(startup(none)).toBeUndefined();
    expect(aOp(none)).toBeCloseTo(aOp(s), 12);
  });
});

describe('recheck D5 — custom rungs are tried in the canonical order whatever the order of application', () => {
  it('R-LINK-LOCAL and R-FABRIC-DEGRADE in either order: the same closed form, MTTR split and window ledger', () => {
    const s = topologyScenario('a3-ub384', 10000);
    const a = applyMechanismsInOrder(s, ['R-LINK-LOCAL', 'R-FABRIC-DEGRADE'], SET.parameters);
    const b = applyMechanismsInOrder(s, ['R-FABRIC-DEGRADE', 'R-LINK-LOCAL'], SET.parameters);
    expect(Object.keys(b.mechanisms.custom!)).toEqual(['R-FABRIC-DEGRADE', 'R-LINK-LOCAL']);
    const ta = trainingOf(a), tb = trainingOf(b);
    expect(tb.operationalAvailability).toBeCloseTo(ta.operationalAvailability, 14);
    expect(tb.deliveredGoodput).toBeCloseTo(ta.deliveredGoodput, 14);
    expect(mttrDecomposition(b, tb).mttrS).toBeCloseTo(mttrDecomposition(a, ta).mttrS, 12);
    expect(simulateScenarioLedger(b, { trials: 20, seed: 2 }).summary.counts).toEqual(simulateScenarioLedger(a, { trials: 20, seed: 2 }).summary.counts);
  }, 120_000);
});

/* ---------------- second recheck (2026-10-28, MODEL_REVIEW_2026-10-28_RECHECK2.md): stage mechanisms under the automatic-attempt lever (N4) ---------------- */

describe('second recheck N4 — the automatic-attempt lever re-applies the per-class stage mechanisms over the shorter attempt', () => {
  const s = topologyScenario('a3-ub384', 100000);
  const auto = DEFAULT_LEVERS.filter((l) => l.id === 'auto');
  const row = (x: Scenario, id: string) => trainingOf(x).chain.rows.find((r) => r.id === id)!;
  const startup = (x: Scenario, id: string) => x.components.find((c) => c.id === id)!.recoveryStages?.startup;
  it('a stage mechanism never lengthens a class’s recovery under the lever: its stage is the expectation over the levered job stage', () => {
    const lever = applyLevers(s, auto, null);
    expect(row(lever, 'CORE-hard').globalS).toBeCloseTo(60 + 0.01 * 7200, 9);
    // R-CANN-GRAPH on the 20 s startup (graph 10 s → 7.5 s): candidate 17.5 s, share 0.95 → 17.625 s; it lengthened CORE-hard by 18.6 s before
    const cann = applyLevers(applyMechanisms(s, ['R-CANN-GRAPH'], SET.parameters), auto, null);
    expect(startup(cann, 'CORE-hard')).toBeCloseTo(sameStageValue(20, [{ c: 17.5, a: 0.95 }]), 12);
    expect(row(cann, 'CORE-hard').globalS).toBeCloseTo(132 - 0.95 * 2.5, 9);
    expect(aOp(cann)).toBeGreaterThan(aOp(lever));
    // R-RUNTIME-SNAPSHOT: 0.95 × 15 + 0.05 × 20 = 15.25 s (17.25 s before, against the 60 s startup of the 180 s attempt)
    const snap = applyLevers(applyMechanisms(s, ['R-RUNTIME-SNAPSHOT'], SET.parameters), auto, null);
    expect(startup(snap, 'UNKNOWN-hard')).toBeCloseTo(15.25, 12);
    expect(row(snap, 'UNKNOWN-hard').globalS).toBeCloseTo(132 - 4.75, 9);
    // R-WARM-PROCESS: its 20 s target equals the levered startup, so it adds nothing — and never a longer recovery
    const warm = applyLevers(applyMechanisms(s, ['R-WARM-PROCESS'], SET.parameters), auto, null);
    expect(row(warm, 'UNKNOWN-hard').globalS).toBeCloseTo(132, 9);
    // the success and manual levers leave the stages alone (no strip / re-apply)
    const other = applyLevers(applyMechanisms(s, ['R-RUNTIME-SNAPSHOT'], SET.parameters), DEFAULT_LEVERS.filter((l) => l.id !== 'auto'), null);
    expect(startup(other, 'UNKNOWN-hard')).toBeCloseTo(17.25, 12);
  });
  it('derated twin, idempotence and exact removal', () => {
    const d = applyMechanisms(s, ['R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH'], SET.parameters);
    const once = applyLevers(d, auto, null);
    expect(aOp(applyLevers(once, auto, null))).toBeCloseTo(aOp(once), 14);
    // the strategies' derated design: mechanisms → deratedOf → levers (derated: 60 s × 1.5 = 90 s, job startup 30 s, graph 15 s)
    const der = applyLevers(deratedOf(d), auto, DERATE_DEFAULT);
    const rec = der.mechanisms.applied!;
    const cS = rec['R-RUNTIME-SNAPSHOT'].parameters.startupTargetSeconds, aS = rec['R-RUNTIME-SNAPSHOT'].parameters.eligibleShare;
    const cG = 30 - Math.max(0, 15 - rec['R-CANN-GRAPH'].parameters.graphTargetSeconds), aG = rec['R-CANN-GRAPH'].parameters.eligibleShare;
    expect(startup(der, 'CORE-hard')).toBeCloseTo(sameStageValue(30, [{ c: cS, a: aS }, { c: cG, a: aG }]), 12);
    expect(startup(der, 'CORE-hard')!).toBeLessThan(30);
    expect(aOp(stripMechanisms(once, ['R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH']))).toBeCloseTo(aOp(applyLevers(s, auto, null)), 12);
  });
});

/* ---------------- fourth review R1 / R4 (fixed 2026-10-28) ---------------- */

describe('R1 — the automatic-success lever is derated on its failure probability', () => {
  const s = topologyScenario('a3-ub384', 500000);
  const success = DEFAULT_LEVERS.filter((l) => l.id === 'success');
  const p = (x: Scenario) => (x.recovery.mode === 'mixture' ? x.recovery.automatic.successProbability : NaN);
  it('derated 1 − 0.1 % × 1.5 = 99.85 % (not 99.9 − 8 = 91.9 %, which fell below today’s 99 % and made the lever dead); never worse than today', () => {
    expect(p(applyLevers(s, success, null))).toBeCloseTo(0.999, 12);
    expect(p(applyLevers(s, success, DERATE_DEFAULT))).toBeCloseTo(1 - 0.001 * DERATE_DEFAULT.timeFactor, 12);
    expect(p(applyLevers(s, success, { ...DERATE_DEFAULT, timeFactor: 20 }))).toBeCloseTo(0.99, 12);
  });
  it('the lever now gains on the derated side, so a strategy with it as the only move selects it', () => {
    const r = allocateStrategy(s, { strategy: 'mttr-first', target: 0.985, candidates: [], levers: success });
    expect(r.levers).toEqual(['success']);
    expect(r.steps[0].derated).toBeGreaterThan(r.baseline.derated);
  }, 120_000);
});

describe('R4 — a derated detector never falls below the detection it replaces', () => {
  const s = topologyScenario('a3-ub384', 100000);
  const det = (x: Scenario) => (x.recovery.mode === 'mixture' ? x.recovery.detection : undefined);
  it('D-HARD derated (0.949 in 1.5 s) keeps the baseline 0.95 with its faster time; the nominal target is unchanged; removal restores the baseline', () => {
    const nom = applyMechanisms(s, ['D-HARD']);
    expect(det(nom)).toMatchObject({ coverage: 0.999, autoSeconds: 1 });
    const der = deratedOf(nom);
    expect(det(der)!.coverage).toBeCloseTo(0.95, 12);
    expect(det(der)!.autoSeconds).toBeCloseTo(1.5, 12);
    expect(det(stripMechanisms(der, ['D-HARD']))).toMatchObject({ coverage: 0.95, autoSeconds: 10 });
    // the derated design is never worse than the scenario without the detector
    expect(aOp(der)).toBeGreaterThan(aOp(deratedOf(s)));
  });
  it('D-SLOW derated (0.94 in 45 s) keeps each class’s baseline probability 0.95 and takes the faster delay', () => {
    const der = deratedOf(applyMechanisms(s, ['D-SLOW']));
    for (const c of der.components.filter((x) => x.subhealth)) {
      expect(c.subhealth!.detection!.probability).toBeCloseTo(0.95, 12);
      expect(c.subhealth!.detection!.delayHours).toBeCloseTo(45 / 3600, 12);
    }
    const nom = applyMechanisms(s, ['D-SLOW']);
    for (const c of nom.components.filter((x) => x.subhealth)) expect(c.subhealth!.detection).toMatchObject({ probability: 0.99, delayHours: 30 / 3600 });
  });
});
