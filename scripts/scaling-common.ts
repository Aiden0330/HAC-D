/**
 * Shared engine read-outs of the scaling reports (scripts/ascend950-scaling.ts, scripts/ascend910c-scaling.ts) and the
 * architecture allocation study (scripts/arch-allocation-500k.ts):
 *  - kpi: A_op in its MTBF / MTTR form with every event class kept apart (hardware interruptions; isolation of sub-healthy units,
 *    detected silent corruption, false alarms), checked against the engine's running fraction (as scripts/mtbf-mttr-topdown.ts);
 *  - chainSplit: one fault class's path down the mechanism chain (mirrors chainOutcome) — where its interruptions end and what each
 *    rung contributes to its mean pause;
 *  - breakdown: rate, downtime and chain outcome by hardware unit and by catalog domain (hard interruptions only);
 *  - recommendDesign / windowCheck / recommendPlan: the window rule (v5: core strategy/window; re-exported here).
 */
import type { TrainingKpis } from '../packages/core/src/scenario/evaluate.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import { kpiForm, trainingOf, type KpiForm } from '../packages/core/src/budget/kpiForm.js';
import { chainSplit } from '../packages/core/src/mttr/decompose.js';
import { unitLibrary } from '../packages/core/src/layers/index.js';
import { deratedOf, windowCheck, recommendLevers, recommendPlan, type WindowCheck, type WindowRuleOptions } from '../packages/core/src/strategy/window.js';

// v5: the read-outs moved into the core (packages/core/src/budget, mttr/decompose, layers, strategy/window); these names stay for the scripts
export const LIB = unitLibrary();
export const tr = trainingOf;
export const kpi = kpiForm;
export type Kpi = KpiForm;
export { chainSplit, deratedOf, windowCheck, recommendPlan };
export type { WindowCheck };
export type RecommendPlanOptions = WindowRuleOptions;
export const recommendDesign = recommendLevers;
type Split = Record<string, number>;

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
