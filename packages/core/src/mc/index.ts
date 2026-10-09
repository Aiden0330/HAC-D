/**
 * Monte Carlo discrete-event simulation of a synchronous training job (survey §4.2, AIReSim-style).
 * Relaxes the closed-form assumptions: Weibull / lognormal lifetimes and repairs with age tracking,
 * lemon units and infant mortality, β-factor common-cause events with a blast radius, a finite hot-spare
 * pool with replenishment (or cluster requeue), redundant infrastructure groups, fail-slow degradation,
 * periodic checkpoints with recompute, and recovery times drawn from the MTTR pipeline.
 * Time unit inside the simulator: hours.
 */
import { Rng } from '../math/rng.js';
import { sample, sampleResidual, weibullFromMean, exponentialFromMean, type Distribution } from '../math/distributions.js';

export type BlastRadius = 'unit' | 'node' | 'rack' | 'zone' | 'cluster';

export interface McUnitClass {
  id: string;
  /** total units of this class */
  count: number;
  /** lifetime distribution (hours) of a new unit */
  lifetime: Distribution;
  /** repair / replacement time distribution (hours) */
  repair: Distribution;
  /** scope of one instance (per gpu, per node, per rack, per zone, or fixed = cluster-wide) */
  scope: 'gpu' | 'node' | 'rack' | 'zone' | 'fixed';
  /** redundancy inside one scope instance: `size` units of which `required` must work; omitted = series */
  group?: { size: number; required: number };
  ccf?: { beta: number; radius: BlastRadius };
  lemon?: { fraction: number; multiplier: number };
  infant?: { multiplier: number; durationHours: number };
  failslow?: { ratePerHour: number; durationHours: number; capacity: number };
}

export interface McJobSpec {
  nGpus: number;
  gpusPerNode: number;
  nodesPerRack: number;
  racksPerZone: number;
  /** useful work to complete, hours */
  workHours: number;
  /** checkpoint interval (s) and exposed save time (s) */
  intervalS: number;
  deltaS: number;
  /** recovery time (s) per interruption excluding recompute (detect + localize + remediate + restart + load) */
  recoverySampler: (rng: Rng, nGpus: number) => number;
  spares: { policy: 'cluster-requeue' | 'hot-pool'; hotSpareNodes: number; replenish: Distribution };
  classes: McUnitClass[];
  /** 'checkpoint' = redo work since the last checkpoint; 'replica' = redo one step */
  recovery: 'checkpoint' | 'replica';
  stepTimeS?: number;
}

export interface McReplication {
  wallHours: number;
  usefulHours: number;
  goodput: number;
  interruptions: number;
  blockedHours: number;
  recoveryHours: number;
  recomputeHours: number;
  infraWaitHours: number;
  checkpointOverheadHours: number;
  degradedLossHours: number;
  peakSparesInUse: number;
  ccfEvents: number;
  failuresByClass: Record<string, number>;
}

export interface Stat {
  mean: number;
  sd: number;
  /** 95 % confidence half-width of the mean */
  ci95: number;
  p05: number;
  p50: number;
  p95: number;
}

export interface McSummary {
  replications: number;
  seed: number | string;
  goodput: Stat;
  mtbiHours: Stat;
  interruptionsPerDay: Stat;
  blockedFraction: Stat;
  recoveryFraction: Stat;
  recomputeFraction: Stat;
  degradedLossFraction: Stat;
  peakSparesInUse: Stat & { p99: number };
  ccfEventsPerReplication: Stat;
  failuresByClass: Record<string, number>;
  rows: McReplication[];
}

export function stat(xs: number[]): Stat {
  const n = xs.length;
  if (n === 0) return { mean: NaN, sd: NaN, ci95: NaN, p05: NaN, p50: NaN, p95: NaN };
  const mean = xs.reduce((a, x) => a + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return { mean, sd, ci95: (1.96 * sd) / Math.sqrt(n), p05: q(0.05), p50: q(0.5), p95: q(0.95) };
}

/* ------------------------------ event heap ------------------------------ */

interface Ev {
  t: number;
  kind: 'fail' | 'repairDone';
  unit: number;
}

class Heap {
  private readonly a: Ev[] = [];
  get size(): number {
    return this.a.length;
  }
  peek(): Ev | undefined {
    return this.a[0];
  }
  push(e: Ev): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].t <= a[i].t) break;
      const tmp = a[p];
      a[p] = a[i];
      a[i] = tmp;
      i = p;
    }
  }
  pop(): Ev | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].t < a[m].t) m = l;
        if (r < a.length && a[r].t < a[m].t) m = r;
        if (m === i) break;
        const tmp = a[m];
        a[m] = a[i];
        a[i] = tmp;
        i = m;
      }
    }
    return top;
  }
}

/* ------------------------------ helpers ------------------------------ */

interface Unit {
  cls: number;
  node: number; // −1 when not node-scoped
  rack: number;
  zone: number;
  groupId: number; // −1 when in series
  up: boolean;
  lifetime: Distribution;
  installedAt: number;
}

export function withMultiplier(d: Distribution, m: number): Distribution {
  switch (d.type) {
    case 'exponential':
      return { type: 'exponential', rate: d.rate * m };
    case 'weibull':
      return { type: 'weibull', shape: d.shape, scale: d.scale / Math.pow(m, 1 / d.shape) };
    case 'lognormal':
      return { type: 'lognormal', mu: d.mu - Math.log(m), sigma: d.sigma };
    case 'point':
      return { type: 'point', value: d.value / m };
  }
}

/** Residual lifetime from the current age, with an infant-mortality multiplier during the first `durationHours`. */
function sampleLifetime(u: Unit, cls: McUnitClass, rng: Rng, age: number): number {
  const inf = cls.infant;
  if (!inf || age >= inf.durationHours) return sampleResidual(u.lifetime, age, rng);
  const first = sampleResidual(withMultiplier(u.lifetime, inf.multiplier), age, rng);
  if (age + first <= inf.durationHours) return first;
  return inf.durationHours - age + sampleResidual(u.lifetime, inf.durationHours, rng);
}

function blastNodes(radius: BlastRadius, spec: McJobSpec, nodes: number): number {
  switch (radius) {
    case 'unit':
    case 'node':
      return 1;
    case 'rack':
      return Math.min(spec.nodesPerRack, nodes);
    case 'zone':
      return Math.min(spec.nodesPerRack * spec.racksPerZone, nodes);
    case 'cluster':
      return nodes;
  }
}

/** Exponential or mean-matched Weibull lifetime from a per-hour rate. */
export function lifetimeFromRate(ratePerHour: number, weibullShape?: number): Distribution {
  if (weibullShape && weibullShape !== 1) return weibullFromMean(1 / ratePerHour, weibullShape);
  return exponentialFromMean(1 / ratePerHour);
}

/* ------------------------------ simulator ------------------------------ */

export function simulateJob(spec: McJobSpec, replications: number, seed: number | string = 1): McSummary {
  const rows: McReplication[] = [];
  const failuresByClass: Record<string, number> = {};
  for (let r = 0; r < replications; r++) {
    const rng = new Rng(typeof seed === 'number' ? (seed + r * 7919) >>> 0 : `${seed}:${r}`);
    const rep = runOnce(spec, rng);
    rows.push(rep);
    for (const [k, v] of Object.entries(rep.failuresByClass)) failuresByClass[k] = (failuresByClass[k] ?? 0) + v;
  }
  const peak = rows.map((x) => x.peakSparesInUse);
  const sortedPeak = [...peak].sort((a, b) => a - b);
  return {
    replications,
    seed,
    goodput: stat(rows.map((x) => x.goodput)),
    mtbiHours: stat(rows.map((x) => (x.interruptions > 0 ? x.wallHours / x.interruptions : x.wallHours))),
    interruptionsPerDay: stat(rows.map((x) => (24 * x.interruptions) / x.wallHours)),
    blockedFraction: stat(rows.map((x) => x.blockedHours / x.wallHours)),
    recoveryFraction: stat(rows.map((x) => x.recoveryHours / x.wallHours)),
    recomputeFraction: stat(rows.map((x) => x.recomputeHours / x.wallHours)),
    degradedLossFraction: stat(rows.map((x) => x.degradedLossHours / x.wallHours)),
    peakSparesInUse: { ...stat(peak), p99: sortedPeak[Math.min(sortedPeak.length - 1, Math.floor(0.99 * (sortedPeak.length - 1)))] },
    ccfEventsPerReplication: stat(rows.map((x) => x.ccfEvents)),
    failuresByClass,
    rows,
  };
}

function runOnce(spec: McJobSpec, rng: Rng): McReplication {
  const nodes = Math.ceil(spec.nGpus / spec.gpusPerNode);
  const racks = Math.ceil(nodes / spec.nodesPerRack);
  const zones = Math.ceil(racks / spec.racksPerZone);
  const units: Unit[] = [];
  const groups: { size: number; required: number; failed: number }[] = [];

  spec.classes.forEach((c, ci) => {
    const scopeCount = c.scope === 'gpu' ? spec.nGpus : c.scope === 'node' ? nodes : c.scope === 'rack' ? racks : c.scope === 'zone' ? zones : 1;
    const perInstance = Math.max(1, Math.round(c.count / scopeCount));
    for (let inst = 0; inst < scopeCount; inst++) {
      let groupId = -1;
      if (c.group) {
        groupId = groups.length;
        groups.push({ size: c.group.size, required: c.group.required, failed: 0 });
      }
      const node = c.scope === 'gpu' ? Math.floor(inst / spec.gpusPerNode) : c.scope === 'node' ? inst : -1;
      const rack = c.scope === 'rack' ? inst : node >= 0 ? Math.floor(node / spec.nodesPerRack) : -1;
      const zone = c.scope === 'zone' ? inst : rack >= 0 ? Math.floor(rack / spec.racksPerZone) : -1;
      for (let j = 0; j < perInstance; j++) {
        let lifetime = c.lifetime;
        if (c.lemon && rng.bernoulli(c.lemon.fraction)) lifetime = withMultiplier(lifetime, c.lemon.multiplier);
        units.push({ cls: ci, node, rack, zone, groupId, up: true, lifetime, installedAt: 0 });
      }
    }
  });

  const heap = new Heap();
  const schedFail = (idx: number, now: number) => {
    const u = units[idx];
    heap.push({ t: now + sampleLifetime(u, spec.classes[u.cls], rng, now - u.installedAt), kind: 'fail', unit: idx });
  };
  units.forEach((_u, i) => schedFail(i, 0));

  // fail-slow onsets as class-level Poisson streams; active degradations as {until, capacity}
  const nextOnset: number[] = spec.classes.map((c) => (c.failslow && c.failslow.ratePerHour > 0 ? rng.exponential(c.failslow.ratePerHour * c.count) : Infinity));
  const degradations: { until: number; capacity: number }[] = [];
  const currentSpeed = (now: number) => {
    let s = 1;
    for (let i = degradations.length - 1; i >= 0; i--) {
      if (degradations[i].until <= now) degradations.splice(i, 1);
      else s = Math.min(s, degradations[i].capacity);
    }
    return s;
  };

  // job state (hours)
  let t = 0;
  let useful = 0;
  let sinceCkpt = 0;
  const interval = spec.intervalS / 3600;
  const delta = spec.deltaS / 3600;
  let sparesInUse = 0;
  let peakSpares = 0;
  let blockedHours = 0;
  let recoveryHours = 0;
  let recomputeHours = 0;
  let infraWaitHours = 0;
  let ckptOverhead = 0;
  let degradedLoss = 0;
  let interruptions = 0;
  let ccfEvents = 0;
  const failuresByClass: Record<string, number> = {};

  /** Run the job for at most dtMax wall hours at `speed`, taking checkpoints; returns wall time used. */
  const advance = (dtMax: number, speed: number): number => {
    let remaining = dtMax;
    let used = 0;
    while (remaining > 1e-12 && useful < spec.workHours) {
      const workLeft = spec.workHours - useful;
      const toCkpt = Math.min(interval - sinceCkpt, workLeft) / speed; // wall time to next checkpoint or finish
      if (toCkpt <= remaining) {
        const w = toCkpt * speed;
        useful += w;
        degradedLoss += toCkpt - w;
        sinceCkpt += w;
        remaining -= toCkpt;
        used += toCkpt;
        if (useful >= spec.workHours - 1e-12) break;
        if (sinceCkpt >= interval - 1e-12) {
          sinceCkpt = 0;
          const save = Math.min(delta, remaining);
          ckptOverhead += save;
          remaining -= save;
          used += save;
        }
      } else {
        const w = remaining * speed;
        useful += w;
        degradedLoss += remaining - w;
        sinceCkpt += w;
        used += remaining;
        remaining = 0;
      }
    }
    return used;
  };

  let guard = 0;
  while (useful < spec.workHours - 1e-12 && guard++ < 10_000_000) {
    const speed = currentSpeed(t);
    let nextT = heap.peek()?.t ?? Infinity;
    for (const v of nextOnset) if (v < nextT) nextT = v;
    for (const d of degradations) if (d.until < nextT) nextT = d.until;
    if (nextT > t) {
      // run until the next event or until the work is done
      const used = advance(nextT - t, speed);
      t += used;
      if (useful >= spec.workHours - 1e-12) break;
      if (t < nextT - 1e-12) continue; // should not happen, defensive
    }
    // process the earliest event at or before t (events earlier than t happened during an outage)
    let onsetClass = -1;
    let onsetT = Infinity;
    nextOnset.forEach((v, i) => {
      if (v < onsetT) {
        onsetT = v;
        onsetClass = i;
      }
    });
    const ev = heap.peek();
    if (onsetClass >= 0 && onsetT <= t + 1e-12 && (!ev || onsetT <= ev.t)) {
      const c = spec.classes[onsetClass];
      degradations.push({ until: onsetT + c.failslow!.durationHours, capacity: c.failslow!.capacity });
      nextOnset[onsetClass] = onsetT + rng.exponential(c.failslow!.ratePerHour * c.count);
      continue;
    }
    if (!ev || ev.t > t + 1e-12) continue; // a degradation ended; loop recomputes speed
    heap.pop();
    const u = units[ev.unit];
    const c = spec.classes[u.cls];
    if (ev.kind === 'repairDone') {
      u.up = true;
      u.installedAt = ev.t;
      if (u.groupId >= 0) groups[u.groupId].failed--;
      if (u.node >= 0 && spec.spares.policy === 'hot-pool' && sparesInUse > 0) sparesInUse--;
      schedFail(ev.unit, ev.t);
      continue;
    }
    if (!u.up) continue;
    // failure at time ev.t (≤ t)
    u.up = false;
    failuresByClass[c.id] = (failuresByClass[c.id] ?? 0) + 1;
    const isCcf = !!c.ccf && c.ccf.beta > 0 && rng.bernoulli(c.ccf.beta);
    if (isCcf) ccfEvents++;
    const repairT = sample(c.repair, rng);
    heap.push({ t: ev.t + repairT, kind: 'repairDone', unit: ev.unit });
    let interrupts = true;
    if (u.groupId >= 0) {
      const g = groups[u.groupId];
      g.failed++;
      interrupts = g.size - g.failed < g.required;
    }
    const duringOutage = ev.t < t - 1e-12;
    // spare accounting (compute-side units)
    let spareWait = 0;
    if (u.node >= 0 && spec.spares.policy === 'hot-pool') {
      const affected = isCcf ? blastNodes(c.ccf!.radius, spec, nodes) : 1;
      for (let k = 0; k < affected; k++) {
        if (sparesInUse < spec.spares.hotSpareNodes) {
          sparesInUse++;
          peakSpares = Math.max(peakSpares, sparesInUse);
        } else {
          spareWait += sample(spec.spares.replenish, rng);
        }
      }
    }
    if (!interrupts) continue;
    if (duringOutage) {
      // the job is already down; an infrastructure failure may prolong the outage
      if (u.node < 0) {
        const end = ev.t + repairT;
        if (end > t) {
          infraWaitHours += end - t;
          t = end;
        }
      } else if (spareWait > 0) {
        blockedHours += spareWait;
        t += spareWait;
      }
      continue;
    }
    // a new interruption
    interruptions++;
    const recompute = spec.recovery === 'replica' ? (spec.stepTimeS ?? 0) / 3600 : sinceCkpt;
    useful -= recompute; // progress since the last checkpoint is lost
    recomputeHours += recompute;
    sinceCkpt = 0;
    const rec = spec.recoverySampler(rng, spec.nGpus) / 3600;
    recoveryHours += rec;
    let wait = 0;
    if (u.node < 0) {
      wait = repairT; // infrastructure: wait for the repair
      infraWaitHours += wait;
    } else if (spareWait > 0) {
      wait = spareWait;
      blockedHours += wait;
    }
    t = ev.t + rec + wait;
    // keep time monotone when the failure happened slightly before t
    if (t < ev.t) t = ev.t;
  }
  const wallHours = t;
  return {
    wallHours,
    usefulHours: useful,
    goodput: wallHours > 0 ? Math.min(1, useful / wallHours) : 0,
    interruptions,
    blockedHours,
    recoveryHours,
    recomputeHours,
    infraWaitHours,
    checkpointOverheadHours: ckptOverhead,
    degradedLossHours: degradedLoss,
    peakSparesInUse: peakSpares,
    ccfEvents,
    failuresByClass,
  };
}
