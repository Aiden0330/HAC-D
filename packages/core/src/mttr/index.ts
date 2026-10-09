/**
 * MTTR as a pipeline of stages (survey §5, Fig. 5-1, Table 5-1):
 * T_unprod = T_detect + T_localize + T_remediate + T_restart + T_load (+ T_recompute + T_warmup).
 * Each stage has a mean (or distribution) measured at a reference scale and a scale law
 * describing how it grows with the number of GPUs N (restart and localization are not scale-free).
 */
import { mean as distMean, sample, type Distribution } from '../math/distributions.js';
import type { Rng } from '../math/rng.js';

export type StageName = 'detect' | 'localize' | 'remediate' | 'restart' | 'load' | 'recompute' | 'warmup';

export type ScaleLaw =
  | { type: 'constant' }
  /** value × (N / refN) */
  | { type: 'linear'; refN: number }
  /** value × (N / refN)^exponent */
  | { type: 'power'; refN: number; exponent: number }
  /** value × (1 + slope · ln(N / refN)) — slow logarithmic growth (Mycroft, Holmes) */
  | { type: 'log'; refN: number; slope: number }
  /** slowest-of-N: value × (1 + cv · (√(2 ln N) − √(2 ln refN))) — expected maximum of N similar durations (BootSeer) */
  | { type: 'order-statistic'; refN: number; cv: number }
  /** data volume / bandwidth; bandwidth grows with N when storage is local or peer-to-peer */
  | { type: 'bandwidth'; sizeGB: number; bandwidthGBps: number; bandwidthScalesWithN: boolean; refN: number };

export interface Stage {
  name: StageName;
  /** mean seconds at the reference scale, or a distribution of seconds */
  value: number | Distribution;
  scale?: ScaleLaw;
  /** provenance / note shown in reports */
  note?: string;
}

export interface Pipeline {
  id: string;
  name?: string;
  stages: Stage[];
}

export interface StageTime {
  /** a pipeline stage name, or a recovery-ladder rung id */
  name: StageName | (string & {});
  meanS: number;
  share: number;
  note?: string;
}

export interface ComposedMttr {
  totalS: number;
  stages: StageTime[];
  dominant: StageName | (string & {}) | null;
  /** stages usually counted in MTTR (①–⑤) vs the loss-only stages (recompute, warm-up) */
  mttrS: number;
  lossOnlyS: number;
}

function scaleFactor(law: ScaleLaw | undefined, n: number, baseS: number): number {
  if (!law || law.type === 'constant') return 1;
  switch (law.type) {
    case 'linear':
      return n / law.refN;
    case 'power':
      return Math.pow(n / law.refN, law.exponent);
    case 'log':
      return Math.max(0, 1 + law.slope * Math.log(n / law.refN));
    case 'order-statistic': {
      const g = (m: number) => (m > 1 ? Math.sqrt(2 * Math.log(m)) : 0);
      return Math.max(0, 1 + law.cv * (g(n) - g(law.refN)));
    }
    case 'bandwidth': {
      const bw = law.bandwidthScalesWithN ? law.bandwidthGBps * (n / law.refN) : law.bandwidthGBps;
      const t = law.sizeGB / bw;
      return baseS > 0 ? t / baseS : 1;
    }
  }
}

/** Mean seconds of a stage at scale n. */
export function stageMeanS(stage: Stage, n: number): number {
  const base = typeof stage.value === 'number' ? stage.value : distMean(stage.value);
  return base * scaleFactor(stage.scale, n, base);
}

const MTTR_STAGES: StageName[] = ['detect', 'localize', 'remediate', 'restart', 'load'];

/** Compose the pipeline at scale n. */
export function composeMttr(pipeline: Pipeline, n: number): ComposedMttr {
  const stages: StageTime[] = pipeline.stages.map((s) => ({ name: s.name, meanS: stageMeanS(s, n), share: 0, note: s.note }));
  const totalS = stages.reduce((a, s) => a + s.meanS, 0);
  let dominant: StageName | (string & {}) | null = null;
  let best = -1;
  for (const s of stages) {
    s.share = totalS > 0 ? s.meanS / totalS : 0;
    if (s.meanS > best) {
      best = s.meanS;
      dominant = s.name;
    }
  }
  const mttrS = stages.filter((s) => MTTR_STAGES.includes(s.name as StageName)).reduce((a, s) => a + s.meanS, 0);
  return { totalS, stages, dominant, mttrS, lossOnlyS: totalS - mttrS };
}

/** Recovery time R(N) used by the goodput models = stages ①–⑤ (+ warm-up if present); recompute is τ/2 and handled separately. */
export function recoveryTimeS(pipeline: Pipeline, n: number): number {
  return pipeline.stages
    .filter((s) => s.name !== 'recompute')
    .reduce((a, s) => a + stageMeanS(s, n), 0);
}

/** Sampler of a full recovery time at scale n (sum of stage samples, scaled). */
export function recoverySampler(pipeline: Pipeline, n: number, rng: Rng): () => number {
  const parts = pipeline.stages
    .filter((s) => s.name !== 'recompute')
    .map((s) => {
      const base = typeof s.value === 'number' ? s.value : distMean(s.value);
      const f = scaleFactor(s.scale, n, base);
      return { s, f };
    });
  return () => {
    let t = 0;
    for (const { s, f } of parts) t += (typeof s.value === 'number' ? s.value : sample(s.value, rng)) * f;
    return t;
  };
}

/* ---------------------------------------------------------------------- */
/* Presets from survey Table 5-1 (values at their measured scale)          */
/* ---------------------------------------------------------------------- */

export const PIPELINE_PRESETS: Record<string, Pipeline> = {
  /** Default timeouts and manual localization — the un-automated baseline (ByteRobust Table 3, Minder, Unicron). */
  'baseline-timeout-manual': {
    id: 'baseline-timeout-manual',
    name: 'Timeout detection, manual localization, requeue',
    stages: [
      { name: 'detect', value: 10 * 60, note: 'PyTorch-Distributed timeout ≈ 10 min (ByteRobust Table 3); NCCL 30/60 min' },
      { name: 'localize', value: 30 * 60, note: 'manual localization > 30 min on average (Minder)' },
      { name: 'remediate', value: 600, note: 'requeue 454–768 s (ByteRobust microbenchmark)' },
      { name: 'restart', value: (0.52 + 1.5 + 4.45 - 1.56) * 60, scale: { type: 'power', refN: 8192, exponent: 0.5 }, note: 'TrainMover 8192-GPU production restart minus checkpoint load; grows with N (FlashRecovery 231→1,115 s)' },
      { name: 'load', value: 1.56 * 60, note: 'checkpoint load 1.56 min (TrainMover Table 1)' },
    ],
  },
  /** Production automation circa 2025 (ByteRobust probes, Mycroft RCA, warm standby, TrainMover-style restart). */
  'automated-probe-standby': {
    id: 'automated-probe-standby',
    name: 'Active probes, automatic RCA, warm standby, incremental CCL',
    stages: [
      { name: 'detect', value: 60, note: 'explicit failures ≈ 60 s; probes 2–60 s (ByteRobust); Mycroft trigger 90 % ≤ 15 s' },
      { name: 'localize', value: 60, scale: { type: 'log', refN: 2048, slope: 0.5 }, note: 'Mycroft RCA ≤ 1 min; Holmes 15.5 → 30.3 s from 2048 → 8192 GPU' },
      { name: 'remediate', value: 21, note: 'warm standby takeover ≈ 20 s (TrainMover, 1024 GPU)' },
      { name: 'restart', value: 16, scale: { type: 'log', refN: 1024, slope: 0.3 }, note: 'TrainMover 221 → 16 s incremental CCL + sandbox warm-up' },
      { name: 'load', value: 8, note: 'peer-to-peer state transfer 6–9 s (TrainMover) / in-memory checkpoint (GEMINI)' },
    ],
  },
  /** TrainMover's measured 8192-GPU production restart (0.52 + 1.5 + 4.45 min), detection and localization assumed instantaneous. */
  'trainmover-8192-restart': {
    id: 'trainmover-8192-restart',
    name: 'TrainMover 8192-GPU production restart (restart only)',
    stages: [
      { name: 'remediate', value: 0.52 * 60, note: 'stop and clean 0.52 min' },
      { name: 'restart', value: (1.5 + 1.09 + 1.8) * 60, scale: { type: 'power', refN: 8192, exponent: 0.5 }, note: 'reschedule 1.5 min + NCCL 1.09 min + warm-up 1.80 min' },
      { name: 'load', value: 1.56 * 60, note: 'checkpoint load 1.56 min (35.1 % of init)' },
    ],
  },
  /** Elastic / replica recovery: tens of seconds per interruption (Gemini 2.5 slice elasticity, FlashRecovery). */
  'elastic-replica': {
    id: 'elastic-replica',
    name: 'Slice elasticity / replica recovery (tens of seconds)',
    stages: [
      { name: 'detect', value: 10, note: 'heartbeat / device plugin 4–11 s (FlashRecovery)' },
      { name: 'localize', value: 5, note: 'implicit in membership change' },
      { name: 'remediate', value: 0, note: 'continue with N−1 slices (Gemini 2.5)' },
      { name: 'restart', value: 30, note: 'reconfiguration tens of seconds (Gemini 2.5)' },
      { name: 'load', value: 0, note: 'state copied from replicas; no checkpoint read' },
    ],
  },
};
