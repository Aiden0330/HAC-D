/** Build a Monte Carlo job specification from a scenario and run it, with the closed-form comparison. */
import type { Scenario } from '../scenario/schema.js';
import { computeCounts, componentInstances } from '../scenario/build.js';
import { evaluateScenario, resolvePipeline } from '../scenario/evaluate.js';
import { recoverySampler } from '../mttr/index.js';
import { exponentialFromMean, type Distribution } from '../math/distributions.js';
import { simulateJob, lifetimeFromRate, type McJobSpec, type McUnitClass, type McSummary, type BlastRadius } from './index.js';

export interface McRunOptions {
  replications?: number;
  seed?: number | string;
  /** override the checkpoint interval (s); default: the analytic optimum used by evaluateScenario */
  intervalS?: number;
  /** cap the simulated work (hours) to bound runtime; default: the job duration */
  workHours?: number;
}

export interface McComparison {
  summary: McSummary;
  closedForm: { goodput: number; mtbiHours: number; interruptionsPerDay: number; blockedProbability: number };
  delta: { goodput: number; goodputRelative: number; mtbiRelative: number };
  /** true when the Monte Carlo mean goodput is outside the closed form by more than 2 % absolute or outside the CI */
  disagrees: boolean;
  spec: McJobSpec;
}

function radiusFor(domain: string, s: Scenario): BlastRadius {
  switch (domain) {
    case 'gpu':
      return 'unit';
    case 'node':
      return 'node';
    case 'nvlink_domain':
      return s.topology.nvlinkDomainGpus > s.topology.gpusPerNode ? 'rack' : 'node';
    case 'rack':
    case 'tor':
      return 'rack';
    case 'power_zone':
    case 'cdu':
    case 'zone':
      return 'zone';
    default:
      return 'cluster';
  }
}

export function mcSpecFromScenario(s: Scenario, intervalS: number, workHours?: number): McJobSpec {
  if (s.workload.type !== 'training') throw new Error('Monte Carlo job simulation needs a training workload');
  const counts = computeCounts(s);
  const w = s.workload;
  const classes: McUnitClass[] = s.components
    .filter((c) => c.enabled)
    .map((c) => {
      const ci = componentInstances(c, counts);
      const repair: Distribution = c.repair.distribution ?? exponentialFromMean(Math.max(c.repair.mttrHours, 1e-6));
      const cls: McUnitClass = {
        id: c.id,
        count: ci.total,
        lifetime: lifetimeFromRate(ci.lambda, c.failure.weibullShape),
        repair,
        scope: c.countRule.per,
      };
      if (c.redundancy && c.redundancy.scheme !== 'series') {
        const size = c.redundancy.n ?? ci.unitsPerInstance;
        const required = c.redundancy.scheme === 'kofn' ? c.redundancy.k ?? size - 1 : 1;
        cls.group = { size, required };
      }
      if (c.ccf && c.ccf.beta > 0) cls.ccf = { beta: c.ccf.beta, radius: radiusFor(c.ccf.domain, s) };
      if (c.lemon) cls.lemon = { fraction: c.lemon.fraction, multiplier: c.lemon.multiplier };
      if (c.infant) cls.infant = { multiplier: c.infant.multiplier, durationHours: c.infant.durationHours };
      if (c.failslow) cls.failslow = { ratePerHour: c.failslow.ratePerHour, durationHours: c.failslow.durationHours, capacity: c.failslow.capacity };
      return cls;
    });
  const pipeline = resolvePipeline(s);
  return {
    nGpus: w.nGpus,
    gpusPerNode: s.topology.gpusPerNode,
    nodesPerRack: s.topology.nodesPerRack,
    racksPerZone: s.topology.racksPerZone,
    workHours: workHours ?? w.durationDays * 24,
    intervalS,
    deltaS: w.deltaS,
    recoverySampler: (rng, n) => recoverySampler(pipeline, n, rng)(),
    spares: {
      policy: w.hotSpareNodes > 0 ? 'hot-pool' : 'cluster-requeue',
      hotSpareNodes: w.hotSpareNodes,
      replenish: exponentialFromMean(w.spareReplenishHours),
    },
    classes,
    recovery: w.recovery,
    stepTimeS: w.stepTimeS,
  };
}

export interface McRun {
  spec: McJobSpec;
  closedForm: McComparison['closedForm'];
  replications: number;
  seed: number | string;
}

/** Prepare a run (spec + closed-form reference) so a worker can execute replications in chunks. */
export function buildMcRun(s: Scenario, opts: McRunOptions = {}): McRun {
  const ev = evaluateScenario(s);
  if (!ev.training) throw new Error('Monte Carlo job simulation needs a training workload');
  const intervalS = opts.intervalS ?? ev.training.tauS;
  const spec = mcSpecFromScenario(s, intervalS, opts.workHours);
  return {
    spec,
    closedForm: {
      goodput: ev.training.effectiveGoodput,
      mtbiHours: ev.training.mtbiHours,
      interruptionsPerDay: ev.training.interruptionsPerDay,
      blockedProbability: ev.training.blockedProbability,
    },
    replications: opts.replications ?? 100,
    seed: opts.seed ?? 1,
  };
}

/** Finish a run from its summary. */
export function finishMcRun(run: McRun, summary: McSummary): McComparison {
  const closed = run.closedForm;
  const dg = summary.goodput.mean - closed.goodput;
  const disagrees = Math.abs(dg) > Math.max(0.02, summary.goodput.ci95 * 2);
  return {
    summary,
    closedForm: closed,
    delta: { goodput: dg, goodputRelative: dg / closed.goodput, mtbiRelative: summary.mtbiHours.mean / closed.mtbiHours - 1 },
    disagrees,
    spec: run.spec,
  };
}

export function simulateScenario(s: Scenario, opts: McRunOptions = {}): McComparison {
  const run = buildMcRun(s, opts);
  return finishMcRun(run, simulateJob(run.spec, run.replications, run.seed));
}
