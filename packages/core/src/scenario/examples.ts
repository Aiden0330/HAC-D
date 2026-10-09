/** Example scenarios mirroring the survey's worked examples (Tables 6-5 to 6-8) and an NVL72 design. */
import { parseScenario, type Scenario, type ScenarioInput } from './schema.js';

const LLAMA3_GPU_PROVENANCE = {
  source: 'The Llama 3 Herd of Models (interruption table) / Epoch AI reverse-inference',
  org: 'Meta / Epoch AI',
  venue: 'arXiv tech report / online report',
  year: 2024,
  url: 'https://arxiv.org/abs/2407.21783',
  surveyRef: 'Table 3-2, Table 2-2, worked example 1',
  confidence: 'derived' as const,
  derivation: '419 unplanned interruptions / (54 d × 24 h × 16,384 GPU) = 1/50,680 GPU·h',
};

/** Worked example 1: 16,384 H100, Llama 3 unplanned interruption rate, δ = 2.43 s, R = 4.45 min. */
export function workedExample1(): Scenario {
  const input: ScenarioInput = {
    meta: { id: 'survey-ex1', name: 'Worked example 1 — 16,384 H100 synchronous training (Llama 3 rate)', basis: ['survey §6 Table 6-5'] },
    topology: { gpusPerNode: 8, nodesPerRack: 4, racksPerZone: 64, nvlinkDomainGpus: 8 },
    components: [
      {
        id: 'gpu',
        name: { zh: 'GPU（作业级中断折算到每 GPU·h）', en: 'GPU (job interruptions per GPU·h)' },
        subsystem: 'compute',
        countRule: { per: 'gpu', factor: 1 },
        failure: { value: 1 / 50680, unit: 'per_h', koujing: { event: 'job_interruption_unplanned', denominator: 'gpu_h', level: 'job', includesPlanned: false }, provenance: LLAMA3_GPU_PROVENANCE },
        repair: { mttrHours: 0.1 },
      },
    ],
    structure: { mode: 'template', template: 'training-series' },
    workload: { type: 'training', nGpus: 16384, durationDays: 54, deltaS: 2.43, intervalModel: 'young' },
    recovery: { mode: 'pipeline', stages: [{ name: 'restart', value: 4.45 * 60, note: 'TrainMover framework initialisation 4.45 min (8192-GPU production job)' }] },
    spares: { hardwareReplacementFraction: 0.587, turnaroundHours: 72, quantile: 0.99 },
    assumptions: ['all 419 interruptions attributed to GPUs (survey: ≈ 78 % hardware, GPU class 58.7 %)'],
  };
  return parseScenario(input);
}

/** Worked example 3: 1,024-node job, r_f = 2.3 per 1000 node·day, hot spares at P99. */
export function workedExample3(hotSpares = 7): Scenario {
  const input: ScenarioInput = {
    meta: { id: 'survey-ex3', name: 'Worked example 3 — 1,024 nodes with hot spares', basis: ['survey §6 Table 6-7'] },
    topology: { gpusPerNode: 8, nodesPerRack: 4, racksPerZone: 64, nvlinkDomainGpus: 8 },
    components: [
      {
        id: 'node',
        name: { zh: '服务器节点', en: 'Server node' },
        subsystem: 'host',
        countRule: { per: 'node', factor: 1 },
        failure: { value: 2.3, unit: 'per_1000_node_day', koujing: { event: 'node_failure', denominator: 'node_day', level: 'node' }, provenance: { source: 'Meta FT-HSDP (≈32K GPU production job)', org: 'Meta', year: 2026, surveyRef: 'Table 6-7', confidence: 'measured' } },
        repair: { mttrHours: 8 },
      },
    ],
    structure: { mode: 'template', template: 'training-hot-spares' },
    workload: { type: 'training', nGpus: 8192, durationDays: 30, deltaS: 10, hotSpareNodes: hotSpares, spareReplenishHours: 24 },
    recovery: { mode: 'preset', preset: 'automated-probe-standby' },
    spares: { hardwareReplacementFraction: 1, turnaroundHours: 8, quantile: 0.99 },
  };
  return parseScenario(input);
}

/** Worked example 4: 64 required single-node replicas, node availability 0.993 (Delta H100), N+k. */
export function workedExample4(spareReplicas = 4): Scenario {
  const mttr = 2.2;
  const u = 0.007;
  const lambda = u / (mttr * (1 - u)); // per node-hour such that A = 0.993
  const input: ScenarioInput = {
    meta: { id: 'survey-ex4', name: 'Worked example 4 — inference service N+k (64 nodes, p = 0.993)', basis: ['survey §6 Table 6-8'] },
    topology: { gpusPerNode: 8, nodesPerRack: 4, racksPerZone: 64, nvlinkDomainGpus: 8 },
    components: [
      {
        id: 'node',
        name: { zh: '推理节点（8 GPU）', en: 'Inference node (8 GPU)' },
        subsystem: 'compute',
        countRule: { per: 'node', factor: 1 },
        failure: { value: lambda, unit: 'per_h', koujing: { event: 'error_event', denominator: 'node_h', level: 'node', dedup: '5 s critical XID' }, provenance: { source: 'Story of Two GPUs (NCSA Delta, SC 2025)', org: 'UIUC / NCSA', venue: 'SC 2025', year: 2025, surveyRef: 'Table 6-8', confidence: 'derived', derivation: 'A = 0.993 with MTTR 2.2 h → λ = 0.007/(2.2 × 0.993) per h' } },
        repair: { mttrHours: mttr },
      },
    ],
    structure: { mode: 'template', template: 'inference-nk' },
    workload: { type: 'inference', replicasRequired: 64, gpusPerReplica: 8, spareReplicas, capacityTarget: 0.999, windowHours: 24, replicaRecoveryHours: mttr },
    recovery: { mode: 'preset', preset: 'automated-probe-standby' },
  };
  return parseScenario(input);
}

/** A richer NVL72-based design: 16,384 GPUs, per-class rates, dual ToR, 8 planes, 2N power, 5-of-6 CDU, β CCF. */
export function nvl72Design(): Scenario {
  const assumed = (what: string) => ({ source: `assumed — no public rate for ${what} (survey Table 4-2)`, confidence: 'assumed' as const });
  const input: ScenarioInput = {
    meta: { id: 'nvl72-16k', name: 'NVL72 design — 16,384 GPU training job', basis: ['survey §4 worked diagrams 1, 3, 5'] },
    topology: { gpusPerNode: 4, nodesPerRack: 18, racksPerZone: 64, nvlinkDomainGpus: 72, networkPlanes: 8, torMode: 'dual', power: '2N', cooling: { modules: 6, required: 5 } },
    components: [
      { id: 'gpu', name: { en: 'GPU incl. HBM', zh: 'GPU（含 HBM）' }, subsystem: 'compute', countRule: { per: 'gpu', factor: 1 }, failure: { value: 11.6, unit: 'per_1e6_h', koujing: { event: 'job_interruption_unplanned', denominator: 'gpu_h', level: 'job' }, provenance: { ...LLAMA3_GPU_PROVENANCE, derivation: '19.7 per 1e6 GPU·h × 58.7 % GPU-class share' } }, repair: { mttrHours: 24 }, failslow: { ratePerHour: 1e-6, durationHours: 1.2, capacity: 0.5 } },
      { id: 'nvswitch-tray', name: { en: 'NVSwitch tray', zh: 'NVSwitch tray' }, subsystem: 'interconnect', countRule: { per: 'rack', factor: 9 }, failure: { value: 5, unit: 'per_1e6_h', provenance: assumed('NVSwitch trays') }, repair: { mttrHours: 1, provenance: { source: 'assumed — the job moves to a spare rack; tray repair itself takes longer', confidence: 'assumed' } }, blastRadius: 'nvlink_domain', ccf: { domain: 'nvlink_domain', beta: 0.1 } },
      { id: 'nic-optics', name: { en: 'NIC + optical module', zh: '网卡与光模块' }, subsystem: 'network', countRule: { per: 'gpu', factor: 1 }, failure: { value: 2, unit: 'per_1e6_h', provenance: assumed('NIC optics') }, repair: { mttrHours: 24 } },
      { id: 'host', name: { en: 'Host (CPU, DRAM, PSU)', zh: '主机（CPU、内存、电源）' }, subsystem: 'host', countRule: { per: 'node', factor: 1 }, failure: { value: 5, unit: 'per_1e6_h', provenance: { source: 'IBM Vela ≈ 2 % hosts/month ≈ 28 per 1e6 h (order of magnitude)', confidence: 'derived' } }, repair: { mttrHours: 24 } },
      { id: 'tor', name: { en: 'ToR switch (dual, non-stacked)', zh: 'ToR 交换机（双上联）' }, subsystem: 'network', countRule: { per: 'rack', factor: 2 }, failure: { value: 1, unit: 'per_1e6_h', provenance: assumed('switches') }, repair: { mttrHours: 4 }, redundancy: { scheme: 'parallel' } },
      { id: 'plane', name: { en: 'Network plane (leaf+spine)', zh: '网络平面' }, subsystem: 'network', countRule: { per: 'fixed', count: 8 }, failure: { value: 20, unit: 'per_1e6_h', provenance: assumed('network planes') }, repair: { mttrHours: 4 }, redundancy: { scheme: 'kofn', n: 8, k: 7, capacityMode: 'fractional' } },
      { id: 'ckpt-storage', name: { en: 'Checkpoint storage (mirrored)', zh: '检查点存储（镜像）' }, subsystem: 'storage', countRule: { per: 'fixed', count: 2 }, failure: { value: 100, unit: 'per_1e6_h', provenance: assumed('storage') }, repair: { mttrHours: 8 }, redundancy: { scheme: 'parallel' } },
      { id: 'power-feed', name: { en: 'Power feed (2N)', zh: '供电馈线（2N）' }, subsystem: 'power', countRule: { per: 'fixed', count: 2 }, failure: { value: 10, unit: 'per_1e6_h', provenance: assumed('power feeds') }, repair: { mttrHours: 4 }, redundancy: { scheme: 'parallel' }, ccf: { domain: 'power_zone', beta: 0.05 } },
      { id: 'cdu', name: { en: 'CDU module (5-of-6)', zh: '冷却 CDU（N+1）' }, subsystem: 'cooling', countRule: { per: 'fixed', count: 6 }, failure: { value: 20, unit: 'per_1e6_h', provenance: assumed('CDU modules') }, repair: { mttrHours: 8 }, redundancy: { scheme: 'kofn', n: 6, k: 5 }, ccf: { domain: 'cdu', beta: 0.05 } },
      { id: 'software', name: { en: 'Framework / orchestration', zh: '软件框架与编排' }, subsystem: 'software', countRule: { per: 'fixed', count: 1 }, failure: { value: 50, unit: 'per_1e6_h', provenance: { source: 'ByteRobust: CUDA error 36.1 %, job hang 9.9 % of incidents (order of magnitude)', confidence: 'derived' } }, repair: { mttrHours: 0.5 } },
    ],
    structure: { mode: 'template', template: 'training-hot-spares' },
    workload: { type: 'training', nGpus: 16384, durationDays: 30, deltaS: 2.43, intervalModel: 'daly3', hotSpareNodes: 36, spareReplenishHours: 24 },
    recovery: { mode: 'preset', preset: 'automated-probe-standby' },
    spares: { hardwareReplacementFraction: 0.587, turnaroundHours: 72, quantile: 0.99 },
    targets: { goodput: 0.97 },
  };
  return parseScenario(input);
}

export const EXAMPLES: Record<string, () => Scenario> = {
  'survey-ex1': workedExample1,
  'survey-ex3': () => workedExample3(),
  'survey-ex4': () => workedExample4(),
  'nvl72-16k': nvl72Design,
};
