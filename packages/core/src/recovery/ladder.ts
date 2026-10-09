/**
 * Recovery ladder (docs/MODEL_REFERENCE.md §16): ordered rungs, each tried in turn until one succeeds;
 * the last rung is manual and always succeeds. Generalises the v1 MTTR pipeline for platforms such as
 * MindCluster (operator-level → process-level online recovery → process-level / pod-level / job-level
 * rescheduling → elastic scale-in → manual repair).
 */
import { stageMeanS, type ScaleLaw } from '../mttr/index.js';
import { mean as distMean, sample, type Distribution } from '../math/distributions.js';
import type { Rng } from '../math/rng.js';

export interface Rung {
  id: string;
  name?: { zh?: string; en?: string };
  kind: 'auto' | 'manual';
  /** probability that this rung resolves the failure */
  successProbability: number;
  /** time spent on this rung (seconds at the reference scale) or a distribution of seconds */
  timeS: number | Distribution;
  scale?: ScaleLaw;
  /** what the rung handles, provenance */
  note?: string;
  confidence?: 'measured' | 'paper-reported' | 'vendor' | 'derived' | 'assumed';
}

export interface Ladder {
  id: string;
  name?: { zh?: string; en?: string };
  rungs: Rung[];
  note?: string;
}

export interface RungResult {
  id: string;
  kind: 'auto' | 'manual';
  /** P(reach rung i) = Π_{j<i}(1 − s_j) */
  reachProbability: number;
  /** mean time of the rung at scale N, seconds */
  meanS: number;
  /** reach × mean */
  contributionS: number;
  share: number;
  successProbability: number;
}

export interface LadderResult {
  meanS: number;
  rungs: RungResult[];
  /** probability that a person is needed = P(reach first manual rung) */
  pManual: number;
  autoMeanS: number;
  manualMeanS: number;
}

function rungMeanS(r: Rung, n: number): number {
  const base = typeof r.timeS === 'number' ? r.timeS : distMean(r.timeS);
  return stageMeanS({ name: 'restart', value: base, scale: r.scale }, n);
}

/** Expected recovery time and per-rung contributions at scale n. */
export function ladderExpectation(l: Ladder, n: number): LadderResult {
  let reach = 1;
  let total = 0;
  let pManual = 0;
  let autoS = 0;
  let manualS = 0;
  const rungs: RungResult[] = [];
  const last = l.rungs.length - 1;
  l.rungs.forEach((r, i) => {
    const s = i === last ? 1 : Math.min(1, Math.max(0, r.successProbability));
    const m = rungMeanS(r, n);
    const contribution = reach * m;
    if (r.kind === 'manual' && pManual === 0) pManual = reach;
    if (r.kind === 'auto') autoS += contribution;
    else manualS += contribution;
    rungs.push({ id: r.id, kind: r.kind, reachProbability: reach, meanS: m, contributionS: contribution, share: 0, successProbability: s });
    total += contribution;
    reach *= 1 - s;
  });
  for (const r of rungs) r.share = total > 0 ? r.contributionS / total : 0;
  return { meanS: total, rungs, pManual, autoMeanS: autoS, manualMeanS: manualS };
}

/** Sampler of one recovery time (seconds) at scale n: walk the rungs until one succeeds. */
export function ladderSampler(l: Ladder, n: number, rng: Rng): () => number {
  const parts = l.rungs.map((r, i) => {
    const base = typeof r.timeS === 'number' ? r.timeS : distMean(r.timeS);
    const f = base > 0 ? rungMeanS(r, n) / base : 1;
    return { r, f, s: i === l.rungs.length - 1 ? 1 : r.successProbability };
  });
  return () => {
    let t = 0;
    for (const { r, f, s } of parts) {
      t += (typeof r.timeS === 'number' ? r.timeS : sample(r.timeS, rng)) * f;
      if (rng.uniform() < s) break;
    }
    return t;
  };
}

/* ---------------------------------------------------------------------- */
/* Presets                                                                   */
/* ---------------------------------------------------------------------- */

const ASSUMED = 'Huawei publishes no rung times or success rates; values are assumptions to be replaced by measurements.';

export const LADDER_PRESETS: Record<string, Ladder> = {
  /** MindCluster 7.3 resumable-training ladder (hiascend.com, Fault Handling Description). */
  'mindcluster-a3': {
    id: 'mindcluster-a3',
    name: { zh: 'MindCluster 分级恢复（Atlas A3）', en: 'MindCluster fault-handling ladder (Atlas A3)' },
    note: ASSUMED,
    rungs: [
      { id: 'operator-online', kind: 'auto', successProbability: 0.2, timeS: 20, note: 'operator-level online recovery: HCCL retransmission for processor-network and UnifiedBus faults', confidence: 'assumed' },
      { id: 'process-online', kind: 'auto', successProbability: 0.3, timeS: 120, note: 'process-level online recovery: on-chip memory and network faults; peers resend the checkpoint over the parameter plane', confidence: 'assumed' },
      { id: 'process-reschedule', kind: 'auto', successProbability: 0.8, timeS: 300, scale: { type: 'log', refN: 4096, slope: 0.1 }, note: 'process-level rescheduling (recover / recover-in-place); needs a spare server', confidence: 'assumed' },
      { id: 'job-reschedule', kind: 'auto', successProbability: 0.9, timeS: 900, scale: { type: 'order-statistic', refN: 4096, cv: 0.2 }, note: 'pod-level / job-level rescheduling from the last checkpoint (rank-0 failures start here)', confidence: 'assumed' },
      { id: 'elastic-scale-in', kind: 'auto', successProbability: 0.5, timeS: 600, note: 'elastic training: continue with fewer servers when no spare is available', confidence: 'assumed' },
      { id: 'manual-repair', kind: 'manual', successProbability: 1, timeS: 4 * 3600, note: 'operator intervention and hardware repair', confidence: 'assumed' },
    ],
  },
  /** Generic Kubernetes training platform: automatic restart then a person. */
  'generic-auto-restart': {
    id: 'generic-auto-restart',
    name: { zh: '通用：自动重启 → 人工', en: 'Generic: automatic restart → manual' },
    note: ASSUMED,
    rungs: [
      { id: 'auto-restart', kind: 'auto', successProbability: 0.7, timeS: 600, scale: { type: 'order-statistic', refN: 4096, cv: 0.2 }, note: 'health check, node cordon, job restart from checkpoint', confidence: 'assumed' },
      { id: 'manual-repair', kind: 'manual', successProbability: 1, timeS: 4 * 3600, confidence: 'assumed' },
    ],
  },
};
