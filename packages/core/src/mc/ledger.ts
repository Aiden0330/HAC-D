/**
 * Finite-window ledger simulation of one synchronous training job with three fault classes
 * (docs/MODEL_REFERENCE.md §21): hard interruptions handled by the mechanism chain, sub-health slow-downs with
 * detection, and silent data corruption with immediate detection, fallback discovery, clean-checkpoint rollback
 * and terminal discard. Every hour of the window is booked exactly once:
 * delivered + downtime + save + rollback + slowdown + local loss + terminal discard = T.
 * Semantics follow the audited ai-cluster-reliability engine (catalogs/review-2026-10-09/engine.cjs) so the two
 * tools can be cross-checked on one scenario. Time unit inside: hours; faults arrive on the running clock.
 */
import { rungOrder, orderCustomRungs } from '../mechanisms/chain.js';
import { summaryStat, proportionEstimate, type SummaryStat, type ProportionEstimate } from '../math/stats.js';
import type { SdcTerminalRule } from '../sdc/index.js';
import { Rng } from '../math/rng.js';
import type { ChainParams } from '../mechanisms/chain.js';

export interface LedgerSlowSpec {
  /** job-level onset rate per running hour */
  ratePerHour: number;
  detectProbability: number;
  detectDelayH: number;
  /** undetected slow-down ends by itself after this time */
  lifetimeH: number;
  /** performance while slowed (multiplicative across concurrent slow units) */
  performance: number;
  /** isolate: on detection, save progress and pause for the global recovery; tolerate: keep running slow */
  policy: 'isolate' | 'tolerate';
}

export interface LedgerClassSpec {
  id: string;
  name?: string;
  /** job-level hard-interruption rate per running hour */
  hardRatePerHour: number;
  /** job-level silent-corruption rate per running hour */
  sdcRatePerHour: number;
  slow?: LedgerSlowSpec;
  applicable: { replay: number; process: number; elastic: number; predict: number; netfail: number; hotswap: number; custom?: Record<string, number> };
  /** v3.7 per-class global recovery sampler (per-class automatic stage overrides); default: the spec's sampler */
  globalRecovery?: (rng: Rng) => () => number;
}

export interface LedgerSpec {
  horizonH: number;
  tauS: number;
  deltaS: number;
  /** detection of a hard interruption: coverage detected after autoSeconds, the rest after timeoutSeconds; null = instantaneous */
  detection: { coverage: number; autoSeconds: number; timeoutSeconds: number } | null;
  /** global recovery sampler factory: seconds for one recovery once reached (automatic attempt and manual fallback) */
  globalRecovery: (rng: Rng) => () => number;
  chain: ChainParams;
  /** fault-free throughput overhead of the enabled mechanisms (fraction of compute) */
  overhead?: number;
  sdc: { coverage: number; detectSeconds: number; fallbackDelayHours: number; step?: { stepSeconds: number; recoverSeconds: number }; terminalRule?: SdcTerminalRule };
  /** v3.5 order of the detection-delayed rungs (default replay → hotswap → elastic → process) */
  chainOrder?: readonly string[];
  /** v3.7 durable lag of asynchronous saves (hours): every rollback returns this much below the checkpoint */
  rollbackLagH?: number;
  classes: LedgerClassSpec[];
}

export interface LedgerAccount {
  downtime: number;
  save: number;
  slowdown: number;
  rollback: number;
  /** hard-interruption rollbacks (part of rollback) */
  rollbackHard: number;
  /** silent-corruption rollbacks at discovery (part of rollback) */
  rollbackSdc: number;
  terminalInvalid: number;
  localLoss: number;
  /** fault-free overhead of mechanisms */
  overhead: number;
}

export interface LedgerClassAccount {
  events: number;
  recoveries: number;
  downtime: number;
  rollback: number;
  slowdown: number;
  localLoss: number;
  terminalInvalid: number;
}

export interface LedgerReplication {
  horizonH: number;
  /** correct retained progress / T */
  delivered: number;
  correctH: number;
  /** 1 − downtime/T */
  operationalAvailability: number;
  ledger: LedgerAccount;
  counts: { hard: number; slow: number; sdc: number; manual: number; sdcEpisodes: number; replay: number; elastic: number; process: number; global: number; isolations: number; predicted: number; falseAlarms: number; netfail: number; hotswap: number; custom: number };
  byClass: Record<string, LedgerClassAccount>;
  unresolvedAtEnd: boolean;
}

function emptyAccount(): LedgerClassAccount {
  return { events: 0, recoveries: 0, downtime: 0, rollback: 0, slowdown: 0, localLoss: 0, terminalInvalid: 0 };
}

/** One replication. `rng` drives arrivals and detection only; `tech` drives the mechanism outcomes, the global recovery draws and (through a derived stream) the predictor's false alarms, so that coalitions share the fault history (common random numbers). */
export function runLedgerOnce(spec: LedgerSpec, rng: Rng, tech: Rng): LedgerReplication {
  const T = spec.horizonH;
  const tau = spec.tauS / 3600;
  const save = spec.deltaS / 3600;
  const L = tau + save;
  const classes = spec.classes;
  const hardRates = classes.map((c) => Math.max(0, c.hardRatePerHour));
  const slowRates = classes.map((c) => Math.max(0, c.slow?.ratePerHour ?? 0));
  const sdcRates = classes.map((c) => Math.max(0, c.sdcRatePerHour));
  const hardTotal = hardRates.reduce((a, b) => a + b, 0);
  const slowTotal = slowRates.reduce((a, b) => a + b, 0);
  const sdcTotal = sdcRates.reduce((a, b) => a + b, 0);
  const rate = hardTotal + slowTotal + sdcTotal;
  // the global recovery draws come from the mechanism stream: a rung that avoids a global recovery must not shift the arrivals
  const recovery = spec.globalRecovery(tech);
  // v3.7 per-class samplers (automatic stage overrides) share the mechanism stream
  const classRecovery = classes.map((c) => (c.globalRecovery ? c.globalRecovery(tech) : recovery));
  const pick = (rates: number[], total: number): number => {
    let v = rng.uniform() * total;
    for (let i = 0; i < rates.length; i++) {
      v -= rates[i];
      if (v < 0) return i;
    }
    return rates.length - 1;
  };
  const arrival = () => (rate > 0 ? rng.exponential(rate) : Infinity);

  let remaining = arrival();
  let t = 0;
  let progress = 0;
  let cp = 0;
  let cleanCp = 0;
  let cpDirty = false;
  let phase = 0;
  let dirty: { discover: number; cls: number } | null = null;
  let sdcRecoveryUntil = 0; // end of the recovery pause of the last discovered episode (discard-all counts it as unresolved)
  let downUntil = 0;
  const slows: { cls: number; detected: boolean; until: number }[] = [];
  const locals: { domain: number; until: number; cls: number }[] = [];
  // v3.7 degraded running after a custom rung (fabric re-route): a throughput factor until the repair ends
  const degrades: { factor: number; until: number; cls: number }[] = [];
  const ledger: LedgerAccount = { downtime: 0, save: 0, slowdown: 0, rollback: 0, rollbackHard: 0, rollbackSdc: 0, terminalInvalid: 0, localLoss: 0, overhead: 0 };
  const counts = { hard: 0, slow: 0, sdc: 0, manual: 0, sdcEpisodes: 0, replay: 0, elastic: 0, process: 0, global: 0, isolations: 0, predicted: 0, falseAlarms: 0, netfail: 0, hotswap: 0, custom: 0 };
  const lagH = Math.max(0, spec.rollbackLagH ?? 0);
  const overheadFrac = Math.min(0.99, Math.max(0, spec.overhead ?? 0));
  // false alarms of the predictor: a separate Poisson stream of planned migrations on the running clock
  const pd = spec.chain.predict;
  const falseAlarmRate = pd ? classes.reduce((a, c) => a + c.hardRatePerHour * c.applicable.predict * pd.recall * (1 - pd.precision) / Math.max(pd.precision, 0.01), 0) : 0;
  // the alarms get their own stream (seeded from the mechanism stream, one draw whether or not a predictor is on) so that the
  // arrival stream, i.e. the fault history, is identical across coalitions with and without the predictor
  const alarmRng = new Rng(tech.nextU32());
  let nextFalseAlarm = falseAlarmRate > 0 ? alarmRng.exponential(falseAlarmRate) : Infinity;
  const byClass: Record<string, LedgerClassAccount> = {};
  const acct = (i: number) => (byClass[classes[i].id] ??= emptyAccount());
  let current = 0;

  const globalPause = (seconds: number) => {
    const until = t + seconds / 3600;
    const added = Math.max(0, Math.min(T, until) - Math.min(T, Math.max(t, downUntil)));
    acct(current).downtime += added;
    downUntil = Math.max(downUntil, until);
  };
  /** pause of `seconds` after a delay; `seconds === null` draws the global recovery */
  const pause = (delayS: number, seconds: number | null, perClass = false) => {
    acct(current).recoveries++;
    let s = seconds;
    if (s === null) {
      s = (perClass ? classRecovery[current] : recovery)();
      counts.global++;
    }
    globalPause(delayS + s);
  };
  /** rollback to `to0`; the durable lag of asynchronous saves applies to rollback events (hard, detected corruption), not to a fallback discovery that returns to the clean checkpoint itself */
  const rollback = (to0: number, kind: 'hard' | 'sdc', withLag = true) => {
    const to = Math.max(0, to0 - (withLag ? lagH : 0));
    const loss = Math.max(0, progress - to);
    ledger.rollback += loss;
    if (kind === 'hard') ledger.rollbackHard += loss;
    else ledger.rollbackSdc += loss;
    acct(current).rollback += loss;
    progress = to;
    phase = 0;
  };
  const snapshot = () => {
    cp = progress;
    cpDirty = !!dirty;
    if (!dirty) cleanCp = cp;
    phase = 0;
  };
  const chainRecovery = (delayS: number, cls: LedgerClassSpec) => {
    let failed = 0;
    const ch = spec.chain;
    if (ch.predict && cls.applicable.predict > 0 && tech.uniform() < cls.applicable.predict && tech.uniform() < ch.predict.recall) {
      counts.predicted++;
      pause(0, ch.predict.migrationSeconds);
      return;
    }
    if (ch.netfail && cls.applicable.netfail > 0 && tech.uniform() < cls.applicable.netfail) {
      if (tech.uniform() < ch.netfail.success) {
        counts.netfail++;
        pause(0, failed + ch.netfail.successSeconds);
        return;
      }
      failed += ch.netfail.failureSeconds;
    }
    // v3.7 custom rungs: transparent ones before the detection-delayed rungs, delayed ones after them (v5.5: in the chain's canonical order)
    const tryCustom = (position: 'transparent' | 'delayed'): boolean => {
      for (const [id, cr] of Object.entries(orderCustomRungs(ch.custom) ?? {})) {
        if ((cr.position ?? 'transparent') !== position) continue;
        const a = cls.applicable.custom?.[id] ?? 0;
        if (a <= 0 || tech.uniform() >= a) continue;
        if (tech.uniform() < cr.success) {
          counts.custom++;
          if (cr.rollback) {
            rollback(cp, 'hard');
            if (!cpDirty) dirty = null;
          }
          if (cr.localLossSeconds > 0) {
            const dur = cr.localLossDurationSeconds ?? 0;
            if (dur > 0) {
              // degraded running after the pause (fabric re-route): throughput factor 1 − ℓ/T over the repair time T, booked as local loss as it happens
              const pauseEnd = Math.max(t, downUntil) + ((cr.detectionDelay ? delayS : 0) + failed + cr.successSeconds) / 3600;
              degrades.push({ factor: Math.max(0, 1 - cr.localLossSeconds / dur), until: pauseEnd + dur / 3600, cls: current });
            } else {
              // no duration given: progress lost at the event (checkpoint pointers lowered so that the window identity holds)
              const take = Math.min(cr.localLossSeconds / 3600, progress);
              progress -= take;
              cp = Math.min(cp, progress);
              cleanCp = Math.min(cleanCp, progress);
              ledger.localLoss += take;
              acct(current).localLoss += take;
            }
          }
          pause(cr.detectionDelay ? delayS : 0, failed + cr.successSeconds);
          return true;
        }
        failed += cr.failureSeconds ?? 0;
      }
      return false;
    };
    if (tryCustom('transparent')) return;
    // the detection-delayed rungs in the configured order (default replay → hotswap → elastic → process)
    for (const rung of rungOrder(spec.chainOrder)) {
      if (rung === 'replay' && ch.replay && cls.applicable.replay > 0 && tech.uniform() < cls.applicable.replay) {
        if (tech.uniform() < ch.replay.success) {
          counts.replay++;
          pause(delayS, failed + ch.replay.successSeconds);
          return;
        }
        failed += ch.replay.failureSeconds;
      } else if (rung === 'hotswap' && ch.hotswap && cls.applicable.hotswap > 0 && tech.uniform() < cls.applicable.hotswap) {
        if (tech.uniform() < ch.hotswap.success) {
          counts.hotswap++;
          pause(delayS, failed + ch.hotswap.successSeconds);
          return;
        }
        failed += ch.hotswap.failureSeconds;
      } else if (rung === 'elastic' && ch.elastic && cls.applicable.elastic > 0 && tech.uniform() < cls.applicable.elastic) {
        if (tech.uniform() < ch.elastic.success) {
          counts.elastic++;
          acct(current).recoveries++;
          const domain = Math.floor(tech.uniform() * Math.max(1, ch.elastic.domains));
          const until = t + (delayS + failed + ch.elastic.recoverSeconds) / 3600;
          const active = locals.find((x) => x.domain === domain);
          if (active) {
            if (until > active.until) active.until = until;
          } else locals.push({ domain, until, cls: current });
          globalPause(failed + ch.elastic.syncSeconds);
          return;
        }
        failed += ch.elastic.failureSeconds;
      } else if (rung === 'process' && ch.process && cls.applicable.process > 0 && tech.uniform() < cls.applicable.process) {
        if (tech.uniform() < ch.process.success) {
          counts.process++;
          rollback(cp, 'hard');
          if (!cpDirty) dirty = null;
          pause(delayS, failed + ch.process.successSeconds);
          return;
        }
        failed += ch.process.failureSeconds;
      }
    }
    if (tryCustom('delayed')) return;
    rollback(cp, 'hard');
    // a rollback before the first dirty checkpoint was written clears the corruption
    if (!cpDirty) dirty = null;
    pause(delayS + failed, null, true);
  };
  const domains = Math.max(1, spec.chain.elastic?.domains ?? 1);
  const advance = (dt: number) => {
    if (dt <= 0) return;
    if (t < downUntil - 1e-9) {
      ledger.downtime += dt;
      return;
    }
    const end = phase + dt;
    const commits = Math.floor((end + 1e-10) / L);
    const train = (x: number) => Math.floor(x / L) * tau + Math.min(x % L, tau);
    const compute = Math.max(0, train(end) - train(phase));
    let slowFactor = 1;
    for (const s of slows) slowFactor *= classes[s.cls].slow!.performance;
    const localFactor = 1 - locals.length / domains;
    let degradeFactor = 1;
    for (const d of degrades) degradeFactor *= d.factor;
    const factor = slowFactor * localFactor * degradeFactor * (1 - overheadFrac);
    if (commits) {
      cp = progress + (commits * tau - Math.min(phase, tau)) * factor;
      cpDirty = !!dirty;
      if (!dirty) cleanCp = cp;
    }
    progress += compute * factor;
    ledger.save += Math.max(0, dt - compute);
    const slowLoss = compute * (1 - slowFactor);
    const localLoss = compute * slowFactor * (1 - localFactor);
    const degradeLoss = compute * slowFactor * localFactor * (1 - degradeFactor);
    ledger.overhead += compute * slowFactor * localFactor * degradeFactor * overheadFrac;
    ledger.slowdown += slowLoss;
    ledger.localLoss += localLoss + degradeLoss;
    for (const s of slows) acct(s.cls).slowdown += slowLoss / slows.length;
    for (const l of locals) acct(l.cls).localLoss += localLoss / locals.length;
    for (const d of degrades) acct(d.cls).localLoss += degradeLoss / degrades.length;
    phase = Math.max(0, end - commits * L);
    remaining = Math.max(0, remaining - dt);
  };

  let guard = 0;
  while (t < T - 1e-9 && guard++ < 50_000_000) {
    const up = t >= downUntil - 1e-9;
    const nextFault = up ? t + remaining : Infinity;
    const nextAlarm = up ? t + nextFalseAlarm : Infinity;
    let next = Math.min(T, nextFault, nextAlarm, up ? Infinity : downUntil, dirty ? dirty.discover : Infinity);
    for (const s of slows) next = Math.min(next, s.until);
    for (const l of locals) next = Math.min(next, l.until);
    for (const d of degrades) next = Math.min(next, d.until);
    const dtAdv = Math.max(0, next - t);
    advance(dtAdv);
    if (t >= downUntil - 1e-9 && Number.isFinite(nextFalseAlarm)) nextFalseAlarm = Math.max(0, nextFalseAlarm - dtAdv);
    t = next;
    if (t >= T - 1e-9) break;
    if (nextAlarm <= t + 1e-9 && pd) {
      counts.falseAlarms++;
      pause(0, pd.migrationSeconds);
      nextFalseAlarm = alarmRng.exponential(falseAlarmRate);
    }
    if (dirty && dirty.discover <= t + 1e-9) {
      current = dirty.cls;
      rollback(cleanCp, 'sdc', false);
      cp = cleanCp;
      cpDirty = false;
      dirty = null;
      counts.sdcEpisodes++;
      pause(0, null);
      sdcRecoveryUntil = downUntil;
    }
    for (let i = locals.length - 1; i >= 0; i--) if (locals[i].until <= t + 1e-9) locals.splice(i, 1);
    for (let i = degrades.length - 1; i >= 0; i--) if (degrades[i].until <= t + 1e-9) degrades.splice(i, 1);
    let isolate = false;
    for (let i = slows.length - 1; i >= 0; i--) {
      if (slows[i].until <= t + 1e-9) {
        const s = slows[i];
        if (s.detected && classes[s.cls].slow!.policy === 'isolate') {
          isolate = true;
          current = s.cls;
        }
        slows.splice(i, 1);
      }
    }
    if (isolate) {
      // the sub-healthy unit can still save: keep the current progress, then pause for the global recovery
      counts.isolations++;
      snapshot();
      pause(0, null);
    }
    if (nextFault <= t + 1e-9) {
      const r = rng.uniform() * rate;
      if (r < hardTotal) {
        const i = pick(hardRates, hardTotal);
        current = i;
        acct(i).events++;
        counts.hard++;
        const d = spec.detection ? (rng.uniform() < spec.detection.coverage ? spec.detection.autoSeconds : spec.detection.timeoutSeconds) : 0;
        chainRecovery(d, classes[i]);
      } else if (r < hardTotal + slowTotal) {
        const i = pick(slowRates, slowTotal);
        current = i;
        acct(i).events++;
        counts.slow++;
        const sl = classes[i].slow!;
        const detected = rng.uniform() < sl.detectProbability;
        slows.push({ cls: i, detected, until: t + (detected ? sl.detectDelayH : sl.lifetimeH) });
      } else {
        const i = pick(sdcRates, sdcTotal);
        current = i;
        acct(i).events++;
        counts.sdc++;
        if (spec.sdc.coverage > 0 && tech.uniform() < spec.sdc.coverage) {
          if (!dirty) {
            const step = spec.sdc.step;
            const target = step ? Math.max(cp, progress - step.stepSeconds / 3600) : cp;
            const oldPhase = phase;
            rollback(target, 'sdc');
            if (step) phase = oldPhase; // volatile step state keeps the checkpoint phase
          }
          // an existing undetected corruption is not cleaned by detecting a new event
          pause(spec.sdc.detectSeconds, spec.sdc.step ? spec.sdc.step.recoverSeconds : null);
        } else if (!dirty) dirty = { discover: t + spec.sdc.fallbackDelayHours, cls: i };
      }
      remaining = arrival();
    }
  }
  // terminal rule: retain-last-clean keeps the last clean checkpoint of a window that ends dirty; discard-all delivers nothing
  // when the window ends inside an episode (dirty, or still in the recovery pause of the last discovery)
  const discardAll = spec.sdc.terminalRule === 'discard-all';
  const unresolved = !!dirty || sdcRecoveryUntil > T + 1e-9;
  const correct = dirty ? (discardAll ? 0 : cleanCp) : discardAll && unresolved ? 0 : progress;
  ledger.terminalInvalid = progress - correct;
  if (dirty) acct(dirty.cls).terminalInvalid += ledger.terminalInvalid;
  else if (ledger.terminalInvalid > 0) acct(current).terminalInvalid += ledger.terminalInvalid;
  const accounted = correct + ledger.downtime + ledger.save + ledger.slowdown + ledger.rollback + ledger.terminalInvalid + ledger.localLoss + ledger.overhead;
  if (Math.abs(accounted - T) > 1e-6 * Math.max(1, T)) throw new Error(`ledger does not conserve time: ${accounted - T}`);
  return {
    horizonH: T,
    delivered: correct / T,
    correctH: correct,
    operationalAvailability: 1 - ledger.downtime / T,
    ledger,
    counts,
    byClass,
    unresolvedAtEnd: unresolved,
  };
}

/** mean, sample sd, Student-t 95 % half-width, type-7 quantiles (docs/MODEL_REFERENCE.md §21) */
export type LedgerStat = SummaryStat;

export interface LedgerSummary {
  trials: number;
  seed: number | string;
  horizonH: number;
  delivered: LedgerStat;
  operationalAvailability: LedgerStat;
  /** mean ledger as fractions of T */
  ledger: Record<keyof LedgerAccount, number> & { delivered: number };
  counts: Record<keyof LedgerReplication['counts'], number>;
  byClass: Record<string, LedgerClassAccount & { name?: string }>;
  pUnresolvedAtEnd: number;
  /** share of replications with delivered ≥ target (when a target is given) */
  pAtLeastTarget?: number;
  /** v3.5 Wilson 95 % interval of that share */
  pAtLeastTargetInterval?: ProportionEstimate;
  target?: number;
  values: number[];
}

const statOf = summaryStat;

/** Seeds of replication i: arrivals and mechanism outcomes use separate streams so coalitions share the fault history. */
export function ledgerSeeds(seed: number | string, i: number): { rng: Rng; tech: Rng } {
  const base = typeof seed === 'number' ? seed : [...String(seed)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return { rng: new Rng(`ledger-${base}-${i}`), tech: new Rng(`ledger-tech-${base}-${i}`) };
}

export function simulateLedgerReplications(spec: LedgerSpec, from: number, count: number, seed: number | string): LedgerReplication[] {
  const out: LedgerReplication[] = [];
  for (let i = from; i < from + count; i++) {
    const { rng, tech } = ledgerSeeds(seed, i);
    out.push(runLedgerOnce(spec, rng, tech));
  }
  return out;
}

export function summarizeLedger(rows: LedgerReplication[], seed: number | string, target?: number): LedgerSummary {
  const n = rows.length;
  const T = rows[0]?.horizonH ?? 0;
  const keys: (keyof LedgerAccount)[] = ['downtime', 'save', 'slowdown', 'rollback', 'rollbackHard', 'rollbackSdc', 'terminalInvalid', 'localLoss', 'overhead'];
  const ledger = Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + r.ledger[k], 0) / (n * T || 1)])) as LedgerSummary['ledger'];
  ledger.delivered = rows.reduce((a, r) => a + r.delivered, 0) / (n || 1);
  const countKeys = Object.keys(rows[0]?.counts ?? {}) as (keyof LedgerReplication['counts'])[];
  const counts = Object.fromEntries(countKeys.map((k) => [k, rows.reduce((a, r) => a + r.counts[k], 0) / (n || 1)])) as LedgerSummary['counts'];
  const byClass: LedgerSummary['byClass'] = {};
  for (const r of rows)
    for (const [id, a] of Object.entries(r.byClass)) {
      const acc = (byClass[id] ??= emptyAccount());
      acc.events += a.events / n;
      acc.recoveries += a.recoveries / n;
      acc.downtime += a.downtime / (n * T);
      acc.rollback += a.rollback / (n * T);
      acc.slowdown += a.slowdown / (n * T);
      acc.localLoss += a.localLoss / (n * T);
      acc.terminalInvalid += a.terminalInvalid / (n * T);
    }
  const values = rows.map((r) => r.delivered);
  return {
    trials: n,
    seed,
    horizonH: T,
    delivered: statOf(values),
    operationalAvailability: statOf(rows.map((r) => r.operationalAvailability)),
    ledger,
    counts,
    byClass,
    pUnresolvedAtEnd: rows.filter((r) => r.unresolvedAtEnd).length / (n || 1),
    pAtLeastTarget: target !== undefined ? values.filter((v) => v >= target).length / (n || 1) : undefined,
    pAtLeastTargetInterval: target !== undefined && n > 0 ? proportionEstimate(values.filter((v) => v >= target).length, n) : undefined,
    target,
    values,
  };
}

export function simulateLedger(spec: LedgerSpec, trials: number, seed: number | string = 1, target?: number): LedgerSummary {
  return summarizeLedger(simulateLedgerReplications(spec, 0, trials, seed), seed, target);
}
