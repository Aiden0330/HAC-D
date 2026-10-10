/**
 * Finite-window ledger simulation of one synchronous training job with three fault classes
 * (docs/MODEL_REFERENCE.md §21): hard interruptions handled by the mechanism chain, sub-health slow-downs with
 * detection, and silent data corruption with immediate detection, fallback discovery, clean-checkpoint rollback
 * and terminal discard. Every hour of the window is booked exactly once:
 * delivered + downtime + save + rollback + slowdown + local loss + terminal discard = T.
 * Semantics follow the audited ai-cluster-reliability engine (catalogs/review-2026-10-09/engine.cjs) so the two
 * tools can be cross-checked on one scenario. Time unit inside: hours; faults arrive on the running clock.
 */
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
  applicable: { replay: number; process: number; elastic: number };
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
  sdc: { coverage: number; detectSeconds: number; fallbackDelayHours: number; step?: { stepSeconds: number; recoverSeconds: number } };
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
  counts: { hard: number; slow: number; sdc: number; manual: number; sdcEpisodes: number; replay: number; elastic: number; process: number; global: number; isolations: number };
  byClass: Record<string, LedgerClassAccount>;
  unresolvedAtEnd: boolean;
}

function emptyAccount(): LedgerClassAccount {
  return { events: 0, recoveries: 0, downtime: 0, rollback: 0, slowdown: 0, localLoss: 0, terminalInvalid: 0 };
}

/** One replication. `rng` drives arrivals and detection, `tech` the mechanism outcomes (common random numbers across coalitions). */
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
  const recovery = spec.globalRecovery(rng);
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
  let downUntil = 0;
  const slows: { cls: number; detected: boolean; until: number }[] = [];
  const locals: { domain: number; until: number; cls: number }[] = [];
  const ledger: LedgerAccount = { downtime: 0, save: 0, slowdown: 0, rollback: 0, rollbackHard: 0, rollbackSdc: 0, terminalInvalid: 0, localLoss: 0 };
  const counts = { hard: 0, slow: 0, sdc: 0, manual: 0, sdcEpisodes: 0, replay: 0, elastic: 0, process: 0, global: 0, isolations: 0 };
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
  const pause = (delayS: number, seconds: number | null) => {
    acct(current).recoveries++;
    let s = seconds;
    if (s === null) {
      s = recovery();
      counts.global++;
    }
    globalPause(delayS + s);
  };
  const rollback = (to: number, kind: 'hard' | 'sdc') => {
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
    if (ch.replay && cls.applicable.replay > 0 && tech.uniform() < cls.applicable.replay) {
      if (tech.uniform() < ch.replay.success) {
        counts.replay++;
        pause(delayS, failed + ch.replay.successSeconds);
        return;
      }
      failed += ch.replay.failureSeconds;
    }
    if (ch.elastic && cls.applicable.elastic > 0 && tech.uniform() < cls.applicable.elastic) {
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
    }
    if (ch.process && cls.applicable.process > 0 && tech.uniform() < cls.applicable.process) {
      if (tech.uniform() < ch.process.success) {
        counts.process++;
        rollback(cp, 'hard');
        if (!cpDirty) dirty = null;
        pause(delayS, failed + ch.process.successSeconds);
        return;
      }
      failed += ch.process.failureSeconds;
    }
    rollback(cp, 'hard');
    // a rollback before the first dirty checkpoint was written clears the corruption
    if (!cpDirty) dirty = null;
    pause(delayS + failed, null);
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
    const factor = slowFactor * localFactor;
    if (commits) {
      cp = progress + (commits * tau - Math.min(phase, tau)) * factor;
      cpDirty = !!dirty;
      if (!dirty) cleanCp = cp;
    }
    progress += compute * factor;
    ledger.save += Math.max(0, dt - compute);
    const slowLoss = compute * (1 - slowFactor);
    const localLoss = compute * slowFactor * (1 - localFactor);
    ledger.slowdown += slowLoss;
    ledger.localLoss += localLoss;
    for (const s of slows) acct(s.cls).slowdown += slowLoss / slows.length;
    for (const l of locals) acct(l.cls).localLoss += localLoss / locals.length;
    phase = Math.max(0, end - commits * L);
    remaining = Math.max(0, remaining - dt);
  };

  let guard = 0;
  while (t < T - 1e-9 && guard++ < 50_000_000) {
    const up = t >= downUntil - 1e-9;
    const nextFault = up ? t + remaining : Infinity;
    let next = Math.min(T, nextFault, up ? Infinity : downUntil, dirty ? dirty.discover : Infinity);
    for (const s of slows) next = Math.min(next, s.until);
    for (const l of locals) next = Math.min(next, l.until);
    advance(Math.max(0, next - t));
    t = next;
    if (t >= T - 1e-9) break;
    if (dirty && dirty.discover <= t + 1e-9) {
      current = dirty.cls;
      rollback(cleanCp, 'sdc');
      cp = cleanCp;
      cpDirty = false;
      dirty = null;
      counts.sdcEpisodes++;
      pause(0, null);
    }
    for (let i = locals.length - 1; i >= 0; i--) if (locals[i].until <= t + 1e-9) locals.splice(i, 1);
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
  const correct = dirty ? cleanCp : progress;
  ledger.terminalInvalid = progress - correct;
  if (dirty) acct(dirty.cls).terminalInvalid += ledger.terminalInvalid;
  const accounted = correct + ledger.downtime + ledger.save + ledger.slowdown + ledger.rollback + ledger.terminalInvalid + ledger.localLoss;
  if (Math.abs(accounted - T) > 1e-6 * Math.max(1, T)) throw new Error(`ledger does not conserve time: ${accounted - T}`);
  return {
    horizonH: T,
    delivered: correct / T,
    correctH: correct,
    operationalAvailability: 1 - ledger.downtime / T,
    ledger,
    counts,
    byClass,
    unresolvedAtEnd: !!dirty,
  };
}

export interface LedgerStat {
  mean: number;
  sd: number;
  ci95: number;
  p05: number;
  p50: number;
  p95: number;
}

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
  target?: number;
  values: number[];
}

function statOf(xs: number[]): LedgerStat {
  const n = xs.length;
  if (!n) return { mean: NaN, sd: NaN, ci95: NaN, p05: NaN, p50: NaN, p95: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return { mean, sd, ci95: (1.96 * sd) / Math.sqrt(n), p05: q(0.05), p50: q(0.5), p95: q(0.95) };
}

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
  const keys: (keyof LedgerAccount)[] = ['downtime', 'save', 'slowdown', 'rollback', 'rollbackHard', 'rollbackSdc', 'terminalInvalid', 'localLoss'];
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
    target,
    values,
  };
}

export function simulateLedger(spec: LedgerSpec, trials: number, seed: number | string = 1, target?: number): LedgerSummary {
  return summarizeLedger(simulateLedgerReplications(spec, 0, trials, seed), seed, target);
}
