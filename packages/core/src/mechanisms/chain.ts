/**
 * Mechanism chain for one hard interruption (docs/MODEL_REFERENCE.md §19).
 * Mirrors the audited ai-cluster-reliability engine: a transient fault is first re-executed (replay),
 * then handled by DP-domain elasticity, then by process rescheduling, and finally by the global
 * checkpoint recovery with its manual fallback. Each rung applies to a fraction of the class's events,
 * succeeds with its own probability, charges a different time on failure than on success, and either
 * rolls the job back to the last checkpoint (process, global) or not (replay, elastic).
 * Times in seconds.
 */

export interface ReplayParams {
  success: number;
  successSeconds: number;
  failureSeconds: number;
}
export interface ProcessParams {
  success: number;
  successSeconds: number;
  failureSeconds: number;
}
export interface ElasticParams {
  domains: number;
  success: number;
  /** domain unavailable after the fault (seconds) while the other domains keep training */
  recoverSeconds: number;
  failureSeconds: number;
  /** short global coordination pause on success */
  syncSeconds: number;
}
/** failure prediction with pre-emptive migration: a share `recall` of the class's interruptions is pre-empted by a planned migration */
export interface PredictParams {
  recall: number;
  /** precision of the predictor; false alarms add migration pauses at rate λ·recall·(1 − precision)/precision */
  precision: number;
  migrationSeconds: number;
}
/** network failover inside the collective (multi-NIC, fault-tolerant routing): absorbed within an iteration */
export interface NetfailParams {
  success: number;
  successSeconds: number;
  failureSeconds: number;
}
/** hot-swap of the failed device from a spare with a near-zero-overhead checkpoint: no rollback */
export interface HotswapParams {
  success: number;
  successSeconds: number;
  failureSeconds: number;
}
/** v3.7 custom rung (mechanism audit): `transparent` rungs are tried right after network failover without the detection delay unless `detectionDelay`, `delayed` rungs after the configured detection-delayed rungs */
export interface CustomRungParams {
  success: number;
  successSeconds: number;
  failureSeconds: number;
  rollback: boolean;
  detectionDelay: boolean;
  /** compute lost outside the pause on success (degraded running), seconds of job time per event */
  localLossSeconds: number;
  /** wall time over which that compute is lost (the ledger simulation runs a throughput factor 1 − ℓ/T for T seconds after the pause); absent: booked at the event */
  localLossDurationSeconds?: number;
  position: 'transparent' | 'delayed';
}
export interface ChainParams {
  /** v3.7 custom rungs keyed by id, tried in the canonical order of `orderCustomRungs` (v5.5; before: insertion order) */
  custom?: Record<string, CustomRungParams>;
  predict?: PredictParams;
  netfail?: NetfailParams;
  replay?: ReplayParams;
  hotswap?: HotswapParams;
  elastic?: ElasticParams;
  process?: ProcessParams;
}

/** Fraction of a class's hard events each mechanism can act on (the reference catalog's per-event flags aggregated). */
export interface Applicability {
  replay?: number;
  process?: number;
  elastic?: number;
  predict?: number;
  netfail?: number;
  hotswap?: number;
  /** v3.7 fraction of the class's events each custom rung applies to */
  custom?: Record<string, number>;
}

/**
 * v5.5 the order custom rungs are tried in, whatever the order they were applied in (recheck of the fifth review, D5): the
 * library's audited rungs first — link-local recovery, fabric re-route, control-plane continuity — then any other id in insertion
 * order. The closed form, the MTTR split and the window ledger all use it, so a design's chain does not depend on the order of
 * application; the reports apply them in library order, which is this order.
 */
export const CUSTOM_RUNG_ORDER = ['R-LINK-LOCAL', 'R-FABRIC-DEGRADE', 'H-CONTROL-CONTINUITY'];
export function orderCustomRungs<T>(custom: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!custom) return custom;
  const ids = Object.keys(custom);
  const rank = (id: string) => { const i = CUSTOM_RUNG_ORDER.indexOf(id); return i < 0 ? CUSTOM_RUNG_ORDER.length + ids.indexOf(id) : i; };
  const sorted = [...ids].sort((a, b) => rank(a) - rank(b));
  return sorted.every((id, i) => id === ids[i]) ? custom : Object.fromEntries(sorted.map((id) => [id, custom[id]]));
}

export type ChainOutcomeKind = 'predict' | 'netfail' | 'replay' | 'hotswap' | 'elastic' | 'process' | 'global' | 'custom';

/** The detection-delayed rungs whose order can be configured (prediction and network failover act before detection and always come first). */
export type ChainRung = 'replay' | 'hotswap' | 'elastic' | 'process';
export const DEFAULT_RUNG_ORDER: readonly ChainRung[] = ['replay', 'hotswap', 'elastic', 'process'];

/** Order in which the rungs are tried: the given rungs first (unknown names and duplicates ignored), then the missing ones in the default order, so every rung is tried once. */
export function rungOrder(order?: readonly string[]): ChainRung[] {
  const out: ChainRung[] = [];
  for (const r of order ?? []) if ((DEFAULT_RUNG_ORDER as readonly string[]).includes(r) && !out.includes(r as ChainRung)) out.push(r as ChainRung);
  for (const r of DEFAULT_RUNG_ORDER) if (!out.includes(r)) out.push(r);
  return out;
}

export interface ChainPath {
  kind: ChainOutcomeKind;
  /** custom rung id when kind = 'custom' */
  id?: string;
  probability: number;
  /** global pause of the job for this path, seconds (detection delay and failed rungs included) */
  pauseS: number;
  rollback: boolean;
  /** compute lost in the degraded domain, seconds of job time × (1/domains) — elastic only */
  localLossS: number;
}

export interface ChainOutcome {
  /** probability of each terminal rung */
  pPredict: number;
  pNetfail: number;
  pReplay: number;
  pHotswap: number;
  pElastic: number;
  pProcess: number;
  pGlobal: number;
  /** v3.7 probability of each custom rung (by id) */
  pCustom: Record<string, number>;
  /** probability that the event rolls the job back to the last checkpoint */
  pRollback: number;
  /** expected global pause per event, seconds */
  meanPauseS: number;
  /** E[pause · 1{rollback}] and E[pause · 1{no rollback}] (seconds, per event) */
  pauseRollbackS: number;
  pauseNoRollbackS: number;
  /** expected local capacity loss per event, seconds of job compute */
  localLossS: number;
  paths: ChainPath[];
  /** true when no mechanism applies: the event goes straight to the global recovery */
  trivial: boolean;
}

export const DEFAULT_CHAIN: Required<Omit<ChainParams, 'custom'>> = {
  predict: { recall: 0.5, precision: 0.8, migrationSeconds: 180 },
  netfail: { success: 0.95, successSeconds: 2, failureSeconds: 10 },
  hotswap: { success: 0.9, successSeconds: 180, failureSeconds: 60 },
  replay: { success: 0.9, successSeconds: 5, failureSeconds: 10 },
  elastic: { domains: 50, success: 0.98, recoverSeconds: 180, failureSeconds: 120, syncSeconds: 1 },
  process: { success: 0.95, successSeconds: 60, failureSeconds: 120 },
};

function clamp01(x: number | undefined): number {
  if (x === undefined || !Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Enumerate the chain for one event. `detectS` is the detection delay before any rung (the mixture's T_det),
 * `globalS` the mean time of the global recovery once reached (automatic attempt plus the manual fallback share).
 * Order and timing follow the reference engine: replay (pause d + f + t_rp on success), elastic (global pause
 * f + sync on success, the domain stays out for d + f + t_el), process (pause d + f + t_pr, rollback), global
 * (pause d + f + globalS, rollback), where f accumulates the failure times of the rungs tried before.
 */
export function chainOutcome(detectS: number, globalS: number, params: ChainParams, applicable: Applicability = {}, order?: readonly string[]): ChainOutcome {
  const paths: ChainPath[] = [];
  type Node = { p: number; failedS: number };
  const stage = (nodes: Node[], frac: number, success: number, onSuccess: (n: Node) => ChainPath, failureS: number): Node[] => {
    const next: Node[] = [];
    for (const n of nodes) {
      if (frac > 0) {
        const tried = n.p * frac;
        if (success > 0) paths.push(onSuccess({ p: tried * success, failedS: n.failedS }));
        if (success < 1) next.push({ p: tried * (1 - success), failedS: n.failedS + failureS });
      }
      if (frac < 1) next.push({ p: n.p * (1 - frac), failedS: n.failedS });
    }
    return next;
  };
  let nodes: Node[] = [{ p: 1, failedS: 0 }];
  const pd = params.predict;
  const nf = params.netfail;
  const rp = params.replay;
  const hs = params.hotswap;
  const el = params.elastic;
  const pr = params.process;
  const aPd = pd ? clamp01(applicable.predict) : 0; // missing flag = not predictable, like every other rung
  const aNf = nf ? clamp01(applicable.netfail) : 0;
  const aRp = rp ? clamp01(applicable.replay) : 0;
  const aHs = hs ? clamp01(applicable.hotswap) : 0;
  const aEl = el ? clamp01(applicable.elastic) : 0;
  const aPr = pr ? clamp01(applicable.process) : 0;
  const customRungs = Object.entries(orderCustomRungs(params.custom) ?? {});
  const customStage = (position: 'transparent' | 'delayed') => {
    for (const [id, cr] of customRungs) {
      if ((cr.position ?? 'transparent') !== position) continue;
      const a = clamp01(applicable.custom?.[id]);
      if (a <= 0) continue;
      nodes = stage(nodes, a, clamp01(cr.success), (n) => ({ kind: 'custom', id, probability: n.p, pauseS: (cr.detectionDelay ? detectS : 0) + n.failedS + cr.successSeconds, rollback: !!cr.rollback, localLossS: Math.max(0, cr.localLossSeconds ?? 0) }), cr.failureSeconds ?? 0);
    }
  };
  // prediction pre-empts the failure: a planned migration without detection delay or rollback
  if (pd && aPd > 0) nodes = stage(nodes, aPd, clamp01(pd.recall), (n) => ({ kind: 'predict', probability: n.p, pauseS: n.failedS + pd.migrationSeconds, rollback: false, localLossS: 0 }), 0);
  // network failover is absorbed inside the collective: no detection delay
  if (nf && aNf > 0) nodes = stage(nodes, aNf, clamp01(nf.success), (n) => ({ kind: 'netfail', probability: n.p, pauseS: n.failedS + nf.successSeconds, rollback: false, localLossS: 0 }), nf.failureSeconds);
  // v3.7 transparent custom rungs (link-local recovery, fabric degrade, control-plane continuity): before the detection-delayed rungs
  customStage('transparent');
  // the detection-delayed rungs in the configured order (default replay → hotswap → elastic → process)
  for (const rung of rungOrder(order)) {
    if (rung === 'replay' && rp && aRp > 0) nodes = stage(nodes, aRp, clamp01(rp.success), (n) => ({ kind: 'replay', probability: n.p, pauseS: detectS + n.failedS + rp.successSeconds, rollback: false, localLossS: 0 }), rp.failureSeconds);
    else if (rung === 'hotswap' && hs && aHs > 0) nodes = stage(nodes, aHs, clamp01(hs.success), (n) => ({ kind: 'hotswap', probability: n.p, pauseS: detectS + n.failedS + hs.successSeconds, rollback: false, localLossS: 0 }), hs.failureSeconds);
    else if (rung === 'elastic' && el && aEl > 0) {
      const domains = Math.max(1, el.domains);
      nodes = stage(nodes, aEl, clamp01(el.success), (n) => ({ kind: 'elastic', probability: n.p, pauseS: n.failedS + el.syncSeconds, rollback: false, localLossS: Math.max(0, detectS + el.recoverSeconds - el.syncSeconds) / domains }), el.failureSeconds);
    } else if (rung === 'process' && pr && aPr > 0) nodes = stage(nodes, aPr, clamp01(pr.success), (n) => ({ kind: 'process', probability: n.p, pauseS: detectS + n.failedS + pr.successSeconds, rollback: true, localLossS: 0 }), pr.failureSeconds);
  }
  // v3.7 delayed custom rungs: after the ordered rungs, before the global recovery
  customStage('delayed');
  for (const n of nodes) if (n.p > 0) paths.push({ kind: 'global', probability: n.p, pauseS: detectS + n.failedS + globalS, rollback: true, localLossS: 0 });
  // merge identical terminal kinds for a compact report while keeping the exact expectations
  let pPredict = 0, pNetfail = 0, pReplay = 0, pHotswap = 0, pElastic = 0, pProcess = 0, pGlobal = 0, pRollback = 0, meanPauseS = 0, pauseRollbackS = 0, pauseNoRollbackS = 0, localLossS = 0;
  const pCustom: Record<string, number> = {};
  for (const p of paths) {
    if (p.kind === 'custom') pCustom[p.id!] = (pCustom[p.id!] ?? 0) + p.probability;
    else if (p.kind === 'predict') pPredict += p.probability;
    else if (p.kind === 'netfail') pNetfail += p.probability;
    else if (p.kind === 'replay') pReplay += p.probability;
    else if (p.kind === 'hotswap') pHotswap += p.probability;
    else if (p.kind === 'elastic') pElastic += p.probability;
    else if (p.kind === 'process') pProcess += p.probability;
    else pGlobal += p.probability;
    meanPauseS += p.probability * p.pauseS;
    localLossS += p.probability * p.localLossS;
    if (p.rollback) {
      pRollback += p.probability;
      pauseRollbackS += p.probability * p.pauseS;
    } else pauseNoRollbackS += p.probability * p.pauseS;
  }
  const trivial = paths.length === 1 && paths[0].kind === 'global';
  return { pPredict, pNetfail, pReplay, pHotswap, pElastic, pProcess, pGlobal, pCustom, pRollback, meanPauseS, pauseRollbackS, pauseNoRollbackS, localLossS, paths, trivial };
}

/** Aggregate several event classes (rate-weighted) into job-level rollback / pause-only rates. */
export interface MixedRates {
  /** events per hour that roll the job back to the last checkpoint */
  rollbackRatePerHour: number;
  /** events per hour that only pause the job */
  pauseRatePerHour: number;
  /** mean pause of a rollback event and of a pause-only event, seconds */
  rollbackPauseS: number;
  pauseOnlyS: number;
  /** compute lost in degraded domains, seconds per hour of job time */
  localLossSPerHour: number;
}

export function emptyMixedRates(): MixedRates {
  return { rollbackRatePerHour: 0, pauseRatePerHour: 0, rollbackPauseS: 0, pauseOnlyS: 0, localLossSPerHour: 0 };
}

/** Add `ratePerHour` events with the given outcome to the accumulator (means are rate-weighted). */
export function addOutcome(acc: MixedRates, ratePerHour: number, o: ChainOutcome): MixedRates {
  const rb = ratePerHour * o.pRollback;
  const po = ratePerHour * (1 - o.pRollback);
  const rbPause = acc.rollbackRatePerHour * acc.rollbackPauseS + ratePerHour * o.pauseRollbackS;
  const poPause = acc.pauseRatePerHour * acc.pauseOnlyS + ratePerHour * o.pauseNoRollbackS;
  const rollbackRatePerHour = acc.rollbackRatePerHour + rb;
  const pauseRatePerHour = acc.pauseRatePerHour + po;
  return {
    rollbackRatePerHour,
    pauseRatePerHour,
    rollbackPauseS: rollbackRatePerHour > 0 ? rbPause / rollbackRatePerHour : 0,
    pauseOnlyS: pauseRatePerHour > 0 ? poPause / pauseRatePerHour : 0,
    localLossSPerHour: acc.localLossSPerHour + ratePerHour * o.localLossS,
  };
}

/** Add a plain event class: every event rolls back (rollback = true) or only pauses, with a fixed pause. */
export function addPlainEvents(acc: MixedRates, ratePerHour: number, pauseS: number, rollback: boolean): MixedRates {
  return addOutcome(acc, ratePerHour, {
    pPredict: 0, pNetfail: 0, pReplay: 0, pHotswap: 0, pElastic: 0, pProcess: 0, pGlobal: rollback ? 1 : 0, pCustom: {}, pRollback: rollback ? 1 : 0,
    meanPauseS: pauseS, pauseRollbackS: rollback ? pauseS : 0, pauseNoRollbackS: rollback ? 0 : pauseS, localLossS: 0, paths: [], trivial: true,
  });
}
