/**
 * v5.12 the goodput tiers of a design (tool review 2026-11-09, recommendation 1: three targets on three quantities instead of one
 * number on a quantity that mixes them). The allocation of the report runs on the operational availability A_op (hardware MTBF and
 * recovery MTTR: formulas 1–6); a design then has two more values, each with its own owner and its own requirement:
 *
 *  - the CHECKPOINT tier — the effective goodput G_eff. It depends on the checkpoint policy, which A_op does not: the design as it
 *    is (a fixed period, e.g. C-FAST's 60 s) and the same design with the period by Young's rule τ = √(2δ·M_rb) on the design's
 *    save time δ (`withYoungInterval`, the edit of the library mechanism C-YOUNG without its record). Against a floor G_eff ≥ F_eff
 *    the requirement is the save time: the δ at which the derated design's G_eff equals the floor (bisection on the engine's exact
 *    value), and the ceiling of G_eff as δ → 0 (pauses and throughput factors only) — below the floor no save time is enough.
 *  - the DELIVERED tier — the delivered goodput G_del (the effective goodput less the loss to undetected silent corruption). Against
 *    a floor G_del ≥ F_del the requirement is the detection: the joint immediate-detection coverage at which the derated design's
 *    G_del equals the floor (every class's miss probability scaled by one factor), or the discovery delay at which it does at
 *    today's coverage — the two ends of one requirement, as MTBF and MTTR are for A_op. The tier is evaluated on the checkpoint
 *    tier's basis (Young's interval by default) and, when the mechanism set lists delivered-only mechanisms, once more with them
 *    applied.
 *
 * Every value is the engine's (exact renewal goodput, the closed-form delivery model); the solvers only move one input. 口径: G_eff and
 * G_del of one synchronous job over the window, nominal and derated; the derated value is the one the floors are checked on, a
 * requirement is quoted as the derated value the design must hold and as the nominal parameter that derates to it.
 */
import type { Scenario } from '../scenario/schema.js';
import { trainingOf } from './kpiForm.js';

export interface TierFloors {
  /** floor of the effective goodput (null: no floor, values only) */
  effective: number | null;
  /** floor of the delivered goodput (null: no floor) */
  delivered: number | null;
}
/**
 * the default floors: G_eff ≥ 97 % (the 1.5 points of pause the A_op target allows, 1 point for the checkpoint and 0.5 point for
 * the throughput factors) and G_del ≥ 90 % (the scenario documents' long-standing `targets.goodput`)
 */
export const DEFAULT_TIER_FLOORS: TierFloors = { effective: 0.97, delivered: 0.9 };

export interface Pair { nominal: number; derated: number }
export type CheckpointPolicy = 'fixed' | 'young' | 'daly3' | 'dalyExact' | 'saxena';

export interface CheckpointRow {
  /** 'fixed': the design's own fixed period; else the interval model the period follows */
  policy: CheckpointPolicy;
  tauS: Pair;
  /** shares of the window in the exact ledger: checkpoint saves and the recompute after rollbacks */
  save: Pair;
  recompute: Pair;
  effective: Pair;
  delivered: Pair;
}
export interface CheckpointTier {
  /** the design's save time, seconds */
  deltaS: Pair;
  asDesigned: CheckpointRow;
  /** the same design with the period by Young's rule; absent when the design's own period already follows the rollback interval */
  young?: CheckpointRow;
  /** the row the tier's value, its requirement and the delivered tier refer to */
  basis: 'asDesigned' | 'young';
  floor: number | null;
  /** nominal and derated value at or above the floor (null without a floor) */
  met: boolean | null;
  /** G_eff of the derated design as the save time goes to zero */
  ceiling: number;
  /** the save time at which the derated design meets the floor exactly (it may exceed today's: slack) and the nominal parameter that derates to it; null without a floor or when the ceiling is below it */
  saveAllowedS: Pair | null;
}
export interface DeliveredRow {
  /** joint immediate-detection coverage, rate-weighted over the classes */
  coverage: Pair;
  /** silent corruptions that escape immediate detection, per job hour */
  undetectedPerHour: Pair;
  effective: Pair;
  delivered: Pair;
}
export interface DeliveredTier {
  /** silent-corruption rate of the job, per hour (0: the tier is empty, G_del = G_eff) */
  ratePerHour: number;
  /** discovery delay of an undetected corruption, hours */
  fallbackDelayH: number;
  /** the window, hours (the cap of `delayAllowedH`: a delay of the whole window means any delay meets the floor) */
  horizonH: number;
  asAllocated: DeliveredRow;
  /** the design with the set's delivered-only mechanisms applied on top (absent when there are none to add) */
  withDetectors?: DeliveredRow & { mechanisms: string[]; met: boolean | null };
  floor: number | null;
  met: boolean | null;
  /** G_del of the derated design with every corruption detected at once */
  ceiling: number;
  /**
   * the joint coverage at which the derated design meets the floor exactly — `derated` the value the design must hold, `nominal` the
   * value that derates to it by the design's own margin (above 1: one detector with this margin cannot, compounding detectors can);
   * null without a floor, without silent corruption, or when the ceiling is below the floor
   */
  coverageNeeded: Pair | null;
  /** the discovery delay at which the derated design meets the floor at its coverage, hours (capped at the window); null when no delay does */
  delayAllowedH: number | null;
}
export interface GoodputTiers { checkpoint: CheckpointTier; delivered: DeliveredTier }

export interface TierOptions {
  floors?: Partial<TierFloors>;
  /** the checkpoint basis of the tiers: Young's interval on the design's save time (default), or the design as it is */
  basis?: 'young' | 'asDesigned';
  /** the design with the delivered-only mechanisms applied (nominal and derated twins, built by the caller) */
  detectors?: { mechanisms: string[]; nom: Scenario; der: Scenario };
}

type Training = Extract<Scenario['workload'], { type: 'training' }>;
const training = (s: Scenario): Training => { if (s.workload.type !== 'training') throw new Error('goodputTiers needs a training workload'); return s.workload; };

/** the design with the checkpoint period by Young's rule on its own save time (the edit of C-YOUNG, without the applied record) */
export function withYoungInterval(s: Scenario): Scenario {
  const w = { ...training(s) };
  delete w.intervalS;
  return { ...s, workload: { ...w, intervalModel: 'young' } };
}
/** the design with another save time (the period stays fixed, or follows the interval model) */
export function withSaveTime(s: Scenario, deltaS: number): Scenario {
  return { ...s, workload: { ...training(s), deltaS } };
}
/** the design with another discovery delay of undetected corruption */
export function withFallbackDelay(s: Scenario, hours: number): Scenario {
  return { ...s, sdc: { ...s.sdc, fallbackDelayHours: hours } };
}
/**
 * the design with every class's miss probability of the immediate detection multiplied by `m` (≥ 0; a class's miss is capped at 1):
 * each class gets its absolute coverage 1 − m·(1 − q_i)·Π(1 − c_k) and its conditional detectors are folded into it
 */
export function withMissFactor(s: Scenario, m: number): Scenario {
  const q0 = s.sdc.detection.coverage;
  return {
    ...s,
    components: s.components.map((c) => {
      if (!c.sdc || !(c.sdc.ratePerHour > 0)) return c;
      const miss = (1 - (c.sdc.coverage ?? q0)) * Object.values(c.sdc.extraDetection ?? {}).reduce((a, g) => a * (1 - Math.min(1, Math.max(0, g))), 1);
      const { extraDetection: _dropped, ...rest } = c.sdc;
      return { ...c, sdc: { ...rest, coverage: Math.min(1, Math.max(0, 1 - m * miss)) } };
    }),
  };
}

const policyOf = (s: Scenario): CheckpointPolicy => { const w = training(s); return w.intervalS !== undefined ? 'fixed' : w.intervalModel ?? 'young'; };
const pair = (nominal: number, derated: number): Pair => ({ nominal, derated });
const geff = (s: Scenario) => trainingOf(s).effectiveGoodputExact;
const gdel = (s: Scenario) => trainingOf(s).deliveredGoodputExact;

function checkpointRow(nom: Scenario, der: Scenario): CheckpointRow {
  const a = trainingOf(nom), d = trainingOf(der);
  return { policy: policyOf(nom), tauS: pair(a.tauS, d.tauS), save: pair(a.ledgerExact.save, d.ledgerExact.save), recompute: pair(a.ledgerExact.rollback, d.ledgerExact.rollback), effective: pair(a.effectiveGoodputExact, d.effectiveGoodputExact), delivered: pair(a.deliveredGoodputExact, d.deliveredGoodputExact) };
}
function deliveredRow(nom: Scenario, der: Scenario): DeliveredRow {
  const a = trainingOf(nom), d = trainingOf(der);
  return { coverage: pair(a.sdc?.coverage ?? 1, d.sdc?.coverage ?? 1), undetectedPerHour: pair(a.sdc?.undetectedRatePerHour ?? 0, d.sdc?.undetectedRatePerHour ?? 0), effective: pair(a.effectiveGoodputExact, d.effectiveGoodputExact), delivered: pair(a.deliveredGoodputExact, d.deliveredGoodputExact) };
}

/** the largest x in [lo, hi] with ok(x) for a predicate that holds at lo and fails at hi (geometric bisection, 80 steps) */
function lastTrue(ok: (x: number) => boolean, lo: number, hi: number): number {
  for (let i = 0; i < 80; i++) { const mid = Math.sqrt(lo * hi); if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}
const TINY = 1e-6;

/** The two goodput tiers of a design: `nom` and `der` are its nominal and derated twins (as the budget builds them). */
export function goodputTiers(nom: Scenario, der: Scenario, o: TierOptions = {}): GoodputTiers {
  const floors: TierFloors = { ...DEFAULT_TIER_FLOORS, ...(o.floors ?? {}) };
  const wN = training(nom), wD = training(der);
  /* ---- checkpoint tier ---- */
  const asDesigned = checkpointRow(nom, der);
  const optimised = asDesigned.policy !== 'fixed';
  const young = optimised ? undefined : checkpointRow(withYoungInterval(nom), withYoungInterval(der));
  const basis: CheckpointTier['basis'] = young && (o.basis ?? 'young') === 'young' ? 'young' : 'asDesigned';
  const onBasis = (s: Scenario) => (basis === 'young' ? withYoungInterval(s) : s);
  const bN = onBasis(nom), bD = onBasis(der);
  const row = basis === 'young' ? young! : asDesigned;
  const Fe = floors.effective;
  const ceiling = geff(withSaveTime(bD, TINY));
  let saveAllowedS: Pair | null = null;
  if (Fe !== null && ceiling >= Fe) {
    const ok = (x: number) => geff(withSaveTime(bD, x)) >= Fe;
    let hi = Math.max(wD.deltaS, TINY) * 2;
    while (ok(hi) && hi < 1e6) hi *= 2;
    const x = hi >= 1e6 && ok(hi) ? Infinity : lastTrue(ok, TINY, hi);
    // the nominal parameter that derates to x: the design's own ratio of derated to nominal save time
    const ratio = wN.deltaS > 0 && wD.deltaS > 0 ? wD.deltaS / wN.deltaS : 1;
    saveAllowedS = pair(x / ratio, x);
  }
  const checkpoint: CheckpointTier = {
    deltaS: pair(wN.deltaS, wD.deltaS), asDesigned, ...(young ? { young } : {}), basis, floor: Fe,
    met: Fe === null ? null : row.effective.nominal >= Fe && row.effective.derated >= Fe, ceiling, saveAllowedS,
  };
  /* ---- delivered tier (on the checkpoint basis) ---- */
  const tD = trainingOf(bD);
  const rate = tD.sdc?.ratePerHour ?? 0;
  const asAllocated = deliveredRow(bN, bD);
  const Fd = floors.delivered;
  const horizonH = wD.durationDays * 24;
  const metOf = (r: DeliveredRow) => (Fd === null ? null : r.delivered.nominal >= Fd && r.delivered.derated >= Fd);
  let coverageNeeded: Pair | null = null, delayAllowedH: number | null = null;
  const ceilingDel = rate > 0 ? gdel(withMissFactor(bD, 0)) : asAllocated.delivered.derated;
  if (Fd !== null && rate > 0) {
    if (ceilingDel >= Fd) {
      // misses scaled by m: m = 1 is the design; the root may lie on either side (a requirement, or slack down to no detection)
      const ok = (m: number) => gdel(withMissFactor(bD, m)) >= Fd;
      const missJoint = 1 - asAllocated.coverage.derated;
      const mMax = missJoint > 0 ? 1 / missJoint : 1e6; // every class's coverage at or near 0
      const m = ok(mMax) ? mMax : lastTrue(ok, TINY, ok(1) ? mMax : 1);
      const q = trainingOf(withMissFactor(bD, m)).sdc?.coverage ?? 1;
      coverageNeeded = pair(q + (asAllocated.coverage.nominal - asAllocated.coverage.derated), q);
    }
    const okD = (h: number) => gdel(withFallbackDelay(bD, h)) >= Fd;
    if (okD(TINY)) delayAllowedH = okD(horizonH) ? horizonH : lastTrue(okD, TINY, horizonH);
  }
  let withDetectors: DeliveredTier['withDetectors'];
  if (o.detectors && o.detectors.mechanisms.length) {
    const r = deliveredRow(onBasis(o.detectors.nom), onBasis(o.detectors.der));
    withDetectors = { ...r, mechanisms: [...o.detectors.mechanisms], met: metOf(r) };
  }
  const delivered: DeliveredTier = {
    ratePerHour: rate, fallbackDelayH: der.sdc.fallbackDelayHours, horizonH, asAllocated, ...(withDetectors ? { withDetectors } : {}),
    floor: Fd, met: metOf(asAllocated), ceiling: ceilingDel, coverageNeeded, delayAllowedH,
  };
  return { checkpoint, delivered };
}
