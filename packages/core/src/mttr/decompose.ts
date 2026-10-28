/**
 * v5 MTTR decomposition of the mechanism chain (docs/ASCEND_ALLOCATION_METHODOLOGY.html formula (5); previously
 * scripts/scaling-common.ts `chainSplit` and scripts/ascend-allocation-data.ts `mttrSplit`).
 *
 * One fault class's path down the chain mirrors `chainOutcome` (docs/MODEL_REFERENCE.md §19): prediction and network failover,
 * the transparent custom rungs, the detection-delayed rungs in the configured order, the delayed custom rungs, and the global
 * recovery (detection + automatic attempt + the manual share). For every terminal the pause is split into the time each rung
 * contributed — a failed rung's attempt time is booked under `failed:<rung>`, a successful rung's own time under its id, the
 * detection delay under `detect` and the global attempt into `globalAuto` (= the automatic attempt, split into its serial stages
 * startup / read / communication by `automaticStages`) and `globalManual` (= (1 − p_success) · t_manual). The contributions sum
 * to the class's mean pause t̄_i exactly (asserted to 1e-9 relative); the job's MTTR is their rate-weighted sum.
 * v5.5 (fifth review D4): a class with its own recovery stages (§24.2, R-RUNTIME-SNAPSHOT / R-WARM-PROCESS / R-CANN-GRAPH) runs its
 * chain on its own global recovery g_i and automatic attempt A_i — the engine's chain row carries both — and its global attempt is
 * split by its own stages; the job's values are used for every other class, so the split closes for every design.
 * 口径: seconds of job time per interruption of the hardware classes; isolation, detected-silent and false-alarm pauses are not
 * part of this MTTR (they are the F of formula (1)).
 */
import type { Scenario, RecoveryStages } from '../scenario/schema.js';
import { automaticStages, type TrainingKpis } from '../scenario/evaluate.js';
import { rungOrder, orderCustomRungs, type ChainParams, type Applicability } from '../mechanisms/chain.js';
import { trainingOf } from '../budget/kpiForm.js';

export type Split = Record<string, number>;

export interface ClassChainSplit {
  /** seconds per event by contributor: detect, predict, netfail, replay, hotswap, elastic, process, custom:<id>, failed:<rung>, globalAuto, globalManual */
  contrib: Split;
  /** probability of each terminal: predict, netfail, replay, hotswap, elastic, process, custom:<id>, global */
  probs: Split;
  /** Σ contributions = the class's mean pause */
  meanS: number;
}

/** one class's path down the chain: where its interruptions end and what each rung contributes to its mean pause */
export function chainSplit(detectS: number, globalS: number, autoS: number, params: ChainParams, a: Applicability, order?: readonly string[]): ClassChainSplit {
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
  // v3.7 custom rungs (link-local recovery, fabric degrade, control-plane continuity …): transparent ones before the
  // detection-delayed rungs, delayed ones after them; keyed `custom:<id>` (mirrors chainOutcome, in its canonical order)
  const customStage = (position: 'transparent' | 'delayed') => {
    for (const [id, cr] of Object.entries(orderCustomRungs(params.custom) ?? {})) {
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

export interface MttrDecomposition {
  /** rate-weighted mean pause of the hardware classes, seconds (= MTTR_hw of the KPI form) */
  mttrS: number;
  /** rate-weighted contributions by rung (seconds per interruption); Σ = mttrS */
  contrib: Split;
  /** rate-weighted terminal probabilities */
  probs: Split;
  /** the global attempt's share split into its serial stages (each class by its own stages, rate-weighted), and the manual share */
  stages: { startup: number; read: number; communication: number; manual: number };
  recovery: {
    detection: { coverage: number; autoSeconds: number; timeoutSeconds: number };
    /** mean detection delay charged before any delayed rung, seconds */
    tDetS: number;
    automatic: { seconds: number; successProbability: number; stages: RecoveryStages & { graphWithinStartup: number } };
    manualS: number;
    /** the job's global recovery after detection: automatic + (1 − p_success) · manual, seconds (the detection delay is `tDetS`; a class with its own stages has its g_i on its chain row) */
    globalS: number;
  };
  custom: Scenario['mechanisms']['custom'] | null;
}

/** every class's own split (id, rate, mean pause, contributions and terminals) — each class on its own global recovery and attempt (§24.2) */
export function classChainSplits(sc: Scenario, t: TrainingKpis = trainingOf(sc)): { id: string; ratePerHour: number; meanPauseS: number; split: ClassChainSplit }[] {
  if (sc.recovery.mode !== 'mixture') throw new Error('classChainSplits needs the MTTR mixture recovery model');
  return t.chain.rows.map((r) => ({ id: r.id, ratePerHour: r.ratePerHour, meanPauseS: r.meanPauseS, split: chainSplit(t.chain.detectS, r.globalS, r.autoS, t.chain.params, r.applicable, sc.mechanisms.order) }));
}

/** MTTR of the chain split by rung (custom rungs included) and the global attempt by recovery stage, rate-weighted over the classes */
export function mttrDecomposition(sc: Scenario, t: TrainingKpis = trainingOf(sc)): MttrDecomposition {
  if (sc.recovery.mode !== 'mixture') throw new Error('mttrDecomposition needs the MTTR mixture recovery model');
  const rec = sc.recovery;
  const autoS = rec.automatic.seconds;
  const lam = t.chain.rows.reduce((a, r) => a + r.ratePerHour, 0);
  const contrib: Split = {}, probs: Split = {};
  const st = automaticStages(rec);
  const stages = { startup: 0, read: 0, communication: 0, manual: 0 };
  for (const r of t.chain.rows) {
    // the class's own global recovery and attempt (the job's unless the class has per-class stages, §24.2)
    const o = chainSplit(t.chain.detectS, r.globalS, r.autoS, t.chain.params, r.applicable, sc.mechanisms.order);
    if (Math.abs(o.meanS - r.meanPauseS) > 1e-9 * Math.max(1, r.meanPauseS)) throw new Error(`MTTR split does not close for ${r.id}: ${o.meanS} vs ${r.meanPauseS}`);
    const w = r.ratePerHour / lam;
    for (const [k, v] of Object.entries(o.contrib)) contrib[k] = (contrib[k] ?? 0) + w * v;
    for (const [k, v] of Object.entries(o.probs)) probs[k] = (probs[k] ?? 0) + w * v;
    // the class's global attempt split by its own stages: p_global,i · t_stage,i (= globalAuto_i · t_stage,i / A_i)
    const si = r.stages ?? st;
    const Ai = si.startup + si.read + si.communication;
    const ga = o.contrib.globalAuto ?? 0;
    if (Ai > 0) { stages.startup += w * ga * si.startup / Ai; stages.read += w * ga * si.read / Ai; stages.communication += w * ga * si.communication / Ai; }
  }
  stages.manual = contrib.globalManual ?? 0;
  return {
    mttrS: Object.values(contrib).reduce((x, y) => x + y, 0), contrib, probs, stages,
    recovery: { detection: rec.detection, tDetS: t.chain.detectS, automatic: { seconds: autoS, successProbability: rec.automatic.successProbability, stages: st }, manualS: rec.manual.seconds, globalS: t.chain.globalS },
    custom: sc.mechanisms.custom ?? null,
  };
}
