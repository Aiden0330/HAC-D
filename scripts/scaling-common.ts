/**
 * Shared engine read-outs of the scaling reports (scripts/ascend950-scaling.ts, scripts/ascend910c-scaling.ts) and the
 * architecture allocation study (scripts/arch-allocation-500k.ts):
 *  - kpi: A_op in its MTBF / MTTR form with every event class kept apart (hardware interruptions; isolation of sub-healthy units,
 *    detected silent corruption, false alarms), checked against the engine's running fraction (as scripts/mtbf-mttr-topdown.ts);
 *  - chainSplit: one fault class's path down the mechanism chain (mirrors chainOutcome) — where its interruptions end and what each
 *    rung contributes to its mean pause;
 *  - breakdown: rate, downtime and chain outcome by hardware unit and by catalog domain (hard interruptions only);
 *  - recommendDesign / windowCheck: the allocation summary's design rule — HAC-D's optimal plan that also passes the window check.
 */
import { unitFaultLibrary } from '../packages/core/src/topology/index.js';
import { evaluateScenario, type TrainingKpis } from '../packages/core/src/scenario/evaluate.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { rungOrder, type ChainParams, type Applicability } from '../packages/core/src/mechanisms/chain.js';
import { applyMechanisms, stripMechanisms, mechanismById } from '../packages/core/src/mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { applyLevers, withHardwareFactors, DEFAULT_LEVERS, type LeverId } from '../packages/core/src/strategy/index.js';
import { buildLedgerRun, simulateLedgerReplications } from '../packages/core/src/mc/ledgerFromScenario.js';
import { proportionEstimate, proportionVerdict, summaryStat } from '../packages/core/src/math/stats.js';

export const LIB = new Map(unitFaultLibrary().map((f) => [f.id, f]));
export const tr = (sc: Scenario): TrainingKpis => evaluateScenario(sc, { structure: false }).training!;

/** A_op = (1 − φ_SDC) / (1 + (Σ λᵢ t̄ᵢ + Σ_k λ_k t_k) / 3600) with the hardware classes and the other event classes apart */
export function kpi(sc: Scenario, t: TrainingKpis = tr(sc)) {
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
export type Kpi = ReturnType<typeof kpi>;

/* ---------------- one class's path down the chain (mirrors chainOutcome; as in scripts/mtbf-mttr-topdown.ts) ---------------- */
type Split = Record<string, number>;
export function chainSplit(detectS: number, globalS: number, autoS: number, params: ChainParams, a: Applicability, order?: readonly string[]) {
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
  // v3.7 custom rungs (the mechanism audit's link-local recovery, fabric degrade, control-plane continuity …): transparent ones
  // before the detection-delayed rungs, delayed ones after them; keyed `custom:<id>` (mirrors chainOutcome)
  const customStage = (position: 'transparent' | 'delayed') => {
    for (const [id, cr] of Object.entries(params.custom ?? {})) {
      if ((cr.position ?? 'transparent') !== position) continue;
      const frac = clamp(a.custom?.[id]);
      if (frac <= 0) continue;
      stage(frac, clamp(cr.success), `custom:${id}`, { ...(cr.detectionDelay ? { detect: detectS } : {}), [`custom:${id}`]: cr.successSeconds }, cr.failureSeconds ?? 0);
    }
  };
  if (pd && clamp(a.predict) > 0) stage(clamp(a.predict), clamp(pd.recall), 'predict', { predict: pd.migrationSeconds }, 0);
  if (nf && clamp(a.netfail) > 0) stage(clamp(a.netfail), clamp(nf.success), 'netfail', { netfail: nf.successSeconds }, nf.failureSeconds);
  customStage('transparent');
  for (const rung of rungOrder(order)) {
    if (rung === 'replay' && rp && clamp(a.replay) > 0) stage(clamp(a.replay), clamp(rp.success), 'replay', { detect: detectS, replay: rp.successSeconds }, rp.failureSeconds);
    else if (rung === 'hotswap' && hs && clamp(a.hotswap) > 0) stage(clamp(a.hotswap), clamp(hs.success), 'hotswap', { detect: detectS, hotswap: hs.successSeconds }, hs.failureSeconds);
    else if (rung === 'elastic' && el && clamp(a.elastic) > 0) stage(clamp(a.elastic), clamp(el.success), 'elastic', { elastic: el.syncSeconds }, el.failureSeconds);
    else if (rung === 'process' && pr && clamp(a.process) > 0) stage(clamp(a.process), clamp(pr.success), 'process', { detect: detectS, process: pr.successSeconds }, pr.failureSeconds);
  }
  customStage('delayed');
  for (const n of nodes) if (n.p > 0) end(n, 'global', { detect: detectS, globalAuto: autoS, globalManual: globalS - autoS });
  return { contrib, probs, meanS: Object.values(contrib).reduce((x, y) => x + y, 0) };
}

/** rate, downtime and the chain's outcome by hardware unit and by catalog domain (hard interruptions only) */
export function breakdown(sc: Scenario, t: TrainingKpis) {
  if (sc.recovery.mode !== 'mixture') throw new Error('mixture recovery expected');
  const autoS = sc.recovery.automatic.seconds;
  type Acc = { lam: number; lp: number; lamGlobal: number; ends: Split; mttrParts: Split; classes: string[] };
  const units: Record<string, Acc> = {};
  const domains: Record<string, Acc & { unit: string }> = {};
  const mttrParts: Split = {};
  const ends: Split = {};
  let lam = 0;
  for (const r of t.chain.rows) {
    const f = LIB.get(r.id);
    if (!f) throw new Error(`no unit for ${r.id}`);
    const o = chainSplit(t.chain.detectS, t.chain.globalS, autoS, t.chain.params, r.applicable, sc.mechanisms.order);
    if (Math.abs(o.meanS - r.meanPauseS) > 1e-9 * Math.max(1, r.meanPauseS)) throw new Error(`MTTR split does not close for ${r.id}: ${o.meanS} vs ${r.meanPauseS}`);
    const dkey = f.analogue ? `${f.domainId}@${f.unit}` : f.domainId;
    const u = (units[f.unit] ??= { lam: 0, lp: 0, lamGlobal: 0, ends: {}, mttrParts: {}, classes: [] });
    const d = (domains[dkey] ??= { lam: 0, lp: 0, lamGlobal: 0, ends: {}, mttrParts: {}, classes: [], unit: f.unit });
    for (const acc of [u, d]) {
      acc.lam += r.ratePerHour;
      acc.lp += r.ratePerHour * r.meanPauseS;
      acc.lamGlobal += r.ratePerHour * (o.probs.global ?? 0);
      for (const [k, v] of Object.entries(o.probs)) acc.ends[k] = (acc.ends[k] ?? 0) + r.ratePerHour * v;
      for (const [k, v] of Object.entries(o.contrib)) acc.mttrParts[k] = (acc.mttrParts[k] ?? 0) + r.ratePerHour * v;
      acc.classes.push(r.id);
    }
    for (const [k, v] of Object.entries(o.probs)) ends[k] = (ends[k] ?? 0) + r.ratePerHour * v;
    for (const [k, v] of Object.entries(o.contrib)) mttrParts[k] = (mttrParts[k] ?? 0) + r.ratePerHour * v;
    lam += r.ratePerHour;
  }
  const norm = (m: Split, by: number) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / by]));
  const finish = (a: Acc) => ({ ...a, mttrS: a.lp / a.lam, pGlobal: a.lamGlobal / a.lam, ends: norm(a.ends, a.lam), mttrParts: norm(a.mttrParts, a.lam) });
  return {
    units: Object.fromEntries(Object.entries(units).map(([k, a]) => [k, finish(a)])),
    domains: Object.fromEntries(Object.entries(domains).map(([k, a]) => [k, { ...finish(a), unit: a.unit, name: LIB.get(a.classes[0])!.domain }])),
    ends: norm(ends, lam),
    mttrParts: norm(mttrParts, lam),
  };
}

/** the size at which a design falls below a level (bisection on N; A_op and MTBF decrease with N) */
export function crossing(of: (n: number) => number, level: number, lo = 1000, hi = 2_000_000): number {
  const below = (n: number) => of(n) < level;
  if (below(lo) || !below(hi)) return NaN;
  while (hi - lo > 100) { const mid = Math.round((lo + hi) / 2); if (below(mid)) hi = mid; else lo = mid; }
  return Math.round((lo + hi) / 2);
}

/* ---------------- the allocation summary's design rule ---------------- */
/** every applied mechanism re-applied with derated parameters (HAC-D's derated yardstick) */
export function deratedOf(sc: Scenario): Scenario {
  const ids = Object.entries(sc.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  const rec = Object.fromEntries(Object.entries(sc.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, DERATE_DEFAULT)]));
  return ids.length ? applyMechanisms(stripMechanisms(sc, ids), ids, rec) : sc;
}
/** window ledger of a nominal design (as allocateStrategy's verification): P(A_op ≥ target) over 30-day windows, supported at 90 % */
export function windowCheck(sc: Scenario, target: number, trials = 400, seed = 1) {
  const run = buildLedgerRun(sc, { trials, seed, target });
  const vals = simulateLedgerReplications(run.spec, 0, trials, seed).map((r) => r.operationalAvailability);
  const k = vals.filter((v) => v >= target).length;
  const est = proportionEstimate(k, trials);
  return { trials, seed, value: summaryStat(vals), pAtLeastTarget: k / trials, wilson: [est.low, est.high] as [number, number], verdict: proportionVerdict(est, 0.9) };
}
export type WindowCheck = ReturnType<typeof windowCheck>;
/**
 * HAC-D's optimal plan (least effort; A_op target met nominally and with every mechanism derated) that also passes the window check.
 * Hardware moves by one uniform factor k on every interruption class (ARINC). Rule: take the optimal plan's levers and the mean-value
 * limit k_mean; the plan's design (levers, hardware at min(k_mean, 1)) must be supported per window, else the cheapest unused lever is
 * added and the limit re-solved. Where k_mean > 1 (headroom) the allowed factor is the largest k ≤ k_mean that keeps a supported
 * window check (bisection, 14 steps); where k_mean < 1 it is k_mean itself (a supported check there is required).
 */
export function recommendDesign(s: Scenario, optimalLevers: LeverId[], target: number, trials = 400, seed = 1) {
  const sDer = deratedOf(s);
  const hw = s.components.filter((c) => c.enabled && c.failure.value > 0).map((c) => c.id);
  const design = (ids: LeverId[], k: number) => {
    const L = DEFAULT_LEVERS.filter((l) => ids.includes(l.id));
    const xs = Object.fromEntries(hw.map((id) => [id, k]));
    return { nom: withHardwareFactors(applyLevers(s, L, null), xs), der: withHardwareFactors(applyLevers(sDer, L, DERATE_DEFAULT), xs) };
  };
  const meets = (ids: LeverId[], k: number) => { const d = design(ids, k); return tr(d.nom).operationalAvailability >= target && tr(d.der).operationalAvailability >= target; };
  const meanLimit = (ids: LeverId[]) => {
    let lo: number, hi: number;
    if (meets(ids, 1)) { lo = 1; hi = 2; while (meets(ids, hi) && hi < 1e4) { lo = hi; hi *= 2; } }
    else { lo = 1e-3; hi = 1; if (!meets(ids, lo)) return null; }
    for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (meets(ids, mid)) lo = mid; else hi = mid; }
    return lo;
  };
  const supported = (ids: LeverId[], k: number) => windowCheck(design(ids, k).nom, target, trials, seed);
  const tried: { levers: LeverId[]; kMean: number | null; kPlan: number | null; pAtLeastTarget: number | null; verdict: string | null }[] = [];
  let ids: LeverId[] = [...optimalLevers];
  for (;;) {
    const kMean = meanLimit(ids);
    const kPlan = kMean === null ? null : Math.min(kMean, 1);
    const wPlan = kPlan === null ? null : supported(ids, kPlan);
    tried.push({ levers: [...ids], kMean, kPlan, pAtLeastTarget: wPlan?.pAtLeastTarget ?? null, verdict: wPlan?.verdict ?? null });
    if (kMean !== null && kPlan !== null && wPlan?.verdict === 'supported') {
      let k = kMean, w = kMean > 1 ? supported(ids, kMean) : wPlan;
      if (w.verdict !== 'supported') {
        let lo = 1, hi = kMean;
        for (let i = 0; i < 14; i++) { const mid = Math.sqrt(lo * hi); if (supported(ids, mid).verdict === 'supported') lo = mid; else hi = mid; }
        k = lo; w = supported(ids, k);
      }
      const d = design(ids, k), dPlan = design(ids, kPlan);
      return { levers: ids, leverEffort: DEFAULT_LEVERS.filter((l) => ids.includes(l.id)).reduce((a, l) => a + l.effort, 0), escalated: tried.length > 1, tried, kMean, kPlan, k, binding: k < kMean ? 'window' as const : 'mean' as const, window: w, windowPlan: wPlan, nom: d.nom, der: d.der, planNom: dPlan.nom, planDer: dPlan.der };
    }
    const next = DEFAULT_LEVERS.filter((l) => !ids.includes(l.id)).sort((a, b) => a.effort - b.effort)[0];
    if (!next) throw new Error('recommendDesign: no lever set meets the target with a supported window check');
    ids = [...ids, next.id];
  }
}

/* ---------------- the same rule with mechanisms as moves (the allocation report with the ReMAP extensions) ---------------- */
export interface RecommendPlanOptions {
  /** mechanism candidates the plan may add (ids in the library) and their parameter overrides */
  candidates: string[];
  parameters: Record<string, Record<string, number>>;
  /** the optimal strategy's plan to start from */
  mechanisms: string[];
  leverIds: LeverId[];
  target: number;
  trials?: number;
  seed?: number;
}
/**
 * HAC-D's optimal plan (mechanisms + recovery levers, least effort, target met nominally and derated) that also passes the window
 * check; escalation adds the cheapest unused move — a candidate mechanism (library effort) or a lever — and re-solves the uniform
 * hardware factor k (ARINC on every interruption class). Where k_mean > 1 the allowed factor is the largest k that keeps a supported
 * window check; where k_mean < 1 it is k_mean itself (a supported check there is required).
 */
export function recommendPlan(s: Scenario, o: RecommendPlanOptions) {
  const trials = o.trials ?? 400, seed = o.seed ?? 1;
  const hw = s.components.filter((c) => c.enabled && c.failure.value > 0).map((c) => c.id);
  const paramsOf = (mechs: string[]) => Object.fromEntries(mechs.map((id) => [id, { ...mechanismById(id).parameters, ...(o.parameters[id] ?? {}) }]));
  const design = (mechs: string[], levers: LeverId[], k: number, derated: boolean) => {
    let d = mechs.length ? applyMechanisms(s, mechs, paramsOf(mechs)) : s;
    if (derated) d = deratedOf(d);
    d = applyLevers(d, DEFAULT_LEVERS.filter((l) => levers.includes(l.id)), derated ? DERATE_DEFAULT : null);
    return withHardwareFactors(d, Object.fromEntries(hw.map((id) => [id, k])));
  };
  const meets = (mechs: string[], levers: LeverId[], k: number) => tr(design(mechs, levers, k, false)).operationalAvailability >= o.target && tr(design(mechs, levers, k, true)).operationalAvailability >= o.target;
  const meanLimit = (mechs: string[], levers: LeverId[]) => {
    let lo: number, hi: number;
    if (meets(mechs, levers, 1)) { lo = 1; hi = 2; while (meets(mechs, levers, hi) && hi < 1e4) { lo = hi; hi *= 2; } }
    else { lo = 1e-3; hi = 1; if (!meets(mechs, levers, lo)) return null; }
    for (let i = 0; i < 50; i++) { const mid = Math.sqrt(lo * hi); if (meets(mechs, levers, mid)) lo = mid; else hi = mid; }
    return lo;
  };
  const check = (mechs: string[], levers: LeverId[], k: number) => windowCheck(design(mechs, levers, k, false), o.target, trials, seed);
  const effortOf = (move: { kind: 'mechanism' | 'lever'; id: string }) => (move.kind === 'mechanism' ? mechanismById(move.id).effort : DEFAULT_LEVERS.find((l) => l.id === move.id)!.effort);
  let mechs = [...o.mechanisms], levers: LeverId[] = [...o.leverIds];
  const tried: { mechanisms: string[]; levers: LeverId[]; kMean: number | null; kPlan: number | null; pAtLeastTarget: number | null; verdict: string | null }[] = [];
  for (;;) {
    const kMean = meanLimit(mechs, levers);
    const kPlan = kMean === null ? null : Math.min(kMean, 1);
    const wPlan = kPlan === null ? null : check(mechs, levers, kPlan);
    tried.push({ mechanisms: [...mechs], levers: [...levers], kMean, kPlan, pAtLeastTarget: wPlan?.pAtLeastTarget ?? null, verdict: wPlan?.verdict ?? null });
    if (kMean !== null && kPlan !== null && wPlan?.verdict === 'supported') {
      let k = kMean, w = kMean > 1 ? check(mechs, levers, kMean) : wPlan;
      if (w.verdict !== 'supported') {
        let lo = 1, hi = kMean;
        for (let i = 0; i < 14; i++) { const mid = Math.sqrt(lo * hi); if (check(mechs, levers, mid).verdict === 'supported') lo = mid; else hi = mid; }
        k = lo; w = check(mechs, levers, k);
      }
      const effort = { mechanisms: mechs.reduce((a, id) => a + mechanismById(id).effort, 0), levers: levers.reduce((a, id) => a + DEFAULT_LEVERS.find((l) => l.id === id)!.effort, 0), hardware: k < 1 ? hw.length * 2 * Math.log2(1 / k) : 0 };
      return { mechanisms: mechs, levers, k, kMean, kPlan, binding: k < kMean ? 'window' as const : 'mean' as const, window: w, windowPlan: wPlan, tried, escalated: tried.length > 1, effort: { ...effort, total: effort.mechanisms + effort.levers + effort.hardware }, nom: design(mechs, levers, k, false), der: design(mechs, levers, k, true), planNom: design(mechs, levers, kPlan, false), planDer: design(mechs, levers, kPlan, true), hardwareClasses: hw };
    }
    const moves = [...o.candidates.filter((id) => !mechs.includes(id) && (mechanismById(id).requires ?? []).every((r) => mechs.includes(r) || Object.keys(s.mechanisms.applied ?? {}).includes(r))).map((id) => ({ kind: 'mechanism' as const, id })), ...DEFAULT_LEVERS.filter((l) => !levers.includes(l.id)).map((l) => ({ kind: 'lever' as const, id: l.id }))];
    const next = moves.sort((a, b) => effortOf(a) - effortOf(b) || a.id.localeCompare(b.id))[0];
    if (!next) throw new Error('recommendPlan: no move set meets the target with a supported window check');
    if (next.kind === 'mechanism') mechs = [...mechs, next.id]; else levers = [...levers, next.id as LeverId];
  }
}
