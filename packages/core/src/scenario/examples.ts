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


/* ---------------------------------------------------------------------- */
/* Ascend / CloudMatrix384 (v2)                                             */
/* ---------------------------------------------------------------------- */

const ASCEND_NOTE = 'No public Ascend failure data: class analogues with explicit multipliers, see docs/ASCEND_SOURCES.md';
const assumed = (derivation: string) => ({ source: 'HAC-D analogue assumption', org: 'HAC-D', year: 2026, confidence: 'assumed' as const, derivation: `${derivation}. ${ASCEND_NOTE}` });
const paper = (derivation: string) => ({ source: 'Serving Large Language Models on Huawei CloudMatrix384', org: 'Huawei', venue: 'arXiv 2506.12708 v3', year: 2025, url: 'https://arxiv.org/abs/2506.12708', confidence: 'derived' as const, derivation });

/** Component classes of a CloudMatrix384-style supernode; `commShare` sets the plane-loss performance factors. */
function ascendComponents(commShare: number): ScenarioInput['components'] {
  const planeLoss = (planes: number, lost: number) => 1 / (1 + (commShare * lost) / (planes - lost)); // §15 generalised to `lost` of `planes`
  const subplanePerf = planeLoss(7, 1); // one of 7 UB sub-planes ≈ 0.952 at f_comm = 0.3
  const linkPerf = planeLoss(112, 1); // one of 7 × 16 uplinks of a node ≈ 0.997
  return [
    {
      id: 'npu',
      name: { zh: '昇腾 910C NPU（含 HBM）', en: 'Ascend 910C NPU (incl. HBM)' },
      subsystem: 'compute',
      countRule: { per: 'gpu', factor: 1 },
      failure: { value: 1.2e-5, unit: 'per_h', koujing: { event: 'npu_fault_job_interrupting', denominator: 'npu_h', level: 'job' }, provenance: assumed('Llama 3 per-GPU interruption rate 1.973e-5/h × 0.587 GPU share (survey Table 3-2) as the NPU analogue') },
      repair: { auto: { coverage: 0.85, successProbability: 0.9, mttrHours: 0.1 }, manual: { mttrHours: 6 }, provenance: assumed('MindCluster process-level rescheduling covers most NPU faults when a spare server exists; 6 min automatic, 6 h manual') },
      subhealth: { ratePerHour: 5e-5, durationHours: 1, performance: 0.7, escalationMultiplier: 2, policy: 'isolate', detection: { probability: 0.9, delayHours: 0.025 } },
    },
    {
      id: 'cpu',
      name: { zh: '鲲鹏 CPU', en: 'Kunpeng CPU' },
      subsystem: 'host',
      countRule: { per: 'node', factor: 4 },
      failure: { value: 1e-6, unit: 'per_h', koujing: { event: 'cpu_fault', denominator: 'cpu_h', level: 'component' }, provenance: assumed('server-CPU class ≈ 1000 FIT') },
      repair: { mttrHours: 4 },
    },
    {
      id: 'ub_l1_switch',
      name: { zh: 'UB 一级交换芯片（节点内，7/节点）', en: 'UB L1 switch chip (on-board, 7 per node)' },
      subsystem: 'interconnect',
      countRule: { per: 'l1_switch', factor: 1 },
      failure: { value: 2e-7, unit: 'per_h', koujing: { event: 'switch_chip_fault_node_down', denominator: 'chip_h', level: 'component' }, provenance: assumed('NVSwitch-class ASIC ≈ 1000 FIT; 20 % of chip faults take the node down, 80 % remove one of 7 uplink planes (sub-health)') },
      repair: { mttrHours: 4 },
      subhealth: { ratePerHour: 8e-7, durationHours: 4, performance: subplanePerf, escalationMultiplier: 1, policy: 'tolerate' },
    },
    {
      id: 'ub_optical_link',
      name: { zh: 'UB 光链路（L1–L2，含两端光模块）', en: 'UB optical link (L1–L2, both transceivers)' },
      subsystem: 'interconnect',
      countRule: { per: 'optical_link', factor: 1 },
      failure: { value: 2e-8, unit: 'per_h', koujing: { event: 'link_fault_node_down', denominator: 'link_h', level: 'component' }, provenance: assumed('2 × 500 FIT transceivers = 1e-6/h per link; 2 % hang the node, the rest remove one of 112 uplinks (sub-health)') },
      repair: { mttrHours: 2 },
      subhealth: { ratePerHour: 9.8e-7, durationHours: 2, performance: linkPerf, escalationMultiplier: 1, policy: 'tolerate' },
    },
    {
      id: 'ub_l2_switch',
      name: { zh: 'UB 二级交换芯片（7 子平面 × 16）', en: 'UB L2 switch chip (7 sub-planes × 16)' },
      subsystem: 'interconnect',
      countRule: { per: 'l2_switch', factor: 1 },
      failure: { value: 1e-7, unit: 'per_h', koujing: { event: 'switch_chip_fault', denominator: 'chip_h', level: 'component' }, provenance: assumed('NVSwitch-class ASIC ≈ 1000 FIT; 10 % job-interrupting, 90 % remove one link per node in one sub-plane (sub-health)') },
      repair: { mttrHours: 4 },
      subhealth: { ratePerHour: 9e-7, durationHours: 4, performance: linkPerf, escalationMultiplier: 1, policy: 'tolerate' },
    },
    {
      id: 'ub_subplane',
      name: { zh: 'UB 子平面（共因）', en: 'UB sub-plane (common cause)' },
      subsystem: 'interconnect',
      countRule: { per: 'subplane', factor: 1 },
      failure: { value: 0, unit: 'per_h', provenance: assumed('plane-level control faults degrade bandwidth by 1/7 rather than stopping the job') },
      repair: { mttrHours: 2 },
      subhealth: { ratePerHour: 1e-7, durationHours: 2, performance: subplanePerf, escalationMultiplier: 1, policy: 'tolerate' },
    },
    {
      id: 'rdma_nic',
      name: { zh: 'RDMA 网口（每 NPU 2 个，跨超节点）', en: 'RDMA port (2 per NPU, scale-out)' },
      subsystem: 'network',
      countRule: { per: 'gpu', factor: 2 },
      failure: { value: 2e-6, unit: 'per_h', koujing: { event: 'nic_or_link_fault', denominator: 'port_h', level: 'component' }, provenance: assumed('400G NIC + link flap class from the survey network data') },
      repair: { auto: { coverage: 0.7, successProbability: 0.95, mttrHours: 0.02 }, manual: { mttrHours: 4 }, provenance: assumed('operator-level HCCL retransmission recovers most link flaps in ~1 min') },
    },
    {
      id: 'vpc_nic',
      name: { zh: '擎天卡（VPC 平面）', en: 'Qingtian card (VPC plane)' },
      subsystem: 'network',
      countRule: { per: 'node', factor: 1 },
      failure: { value: 2e-6, unit: 'per_h', koujing: { event: 'nic_fault', denominator: 'nic_h', level: 'component' }, provenance: assumed('SmartNIC class') },
      repair: { auto: { coverage: 0.5, successProbability: 0.9, mttrHours: 0.05 }, manual: { mttrHours: 4 } },
    },
    {
      id: 'rack_power',
      name: { zh: '计算机柜供电（1+1）', en: 'Compute rack power shelf (1+1)' },
      subsystem: 'power',
      countRule: { per: 'rack', factor: 2 },
      failure: { value: 5e-6, unit: 'per_h', koujing: { event: 'power_shelf_fault', denominator: 'shelf_h', level: 'component' }, provenance: assumed('PSU class') },
      repair: { mttrHours: 8 },
      redundancy: { scheme: 'parallel', switchover: { successProbability: 0.99, outageS: 0, failureRecoveryHours: 2 } },
    },
    {
      id: 'comm_rack_power',
      name: { zh: '通信机柜供电（1+1）', en: 'Communication rack power shelf (1+1)' },
      subsystem: 'power',
      countRule: { per: 'comm_rack', factor: 2 },
      failure: { value: 5e-6, unit: 'per_h', koujing: { event: 'power_shelf_fault', denominator: 'shelf_h', level: 'component' }, provenance: assumed('PSU class') },
      repair: { mttrHours: 8 },
      redundancy: { scheme: 'parallel', switchover: { successProbability: 0.99, outageS: 0, failureRecoveryHours: 2 } },
    },
    {
      id: 'cdu',
      name: { zh: '液冷 CDU（1+1）', en: 'Liquid-cooling CDU (1+1)' },
      subsystem: 'cooling',
      countRule: { per: 'supernode', factor: 2 },
      failure: { value: 1e-5, unit: 'per_h', koujing: { event: 'cdu_fault', denominator: 'cdu_h', level: 'component' }, provenance: assumed('CDU / pump class') },
      repair: { mttrHours: 12 },
      redundancy: { scheme: 'parallel', switchover: { successProbability: 0.98, outageS: 0, failureRecoveryHours: 1 } },
    },
  ];
}

/** CloudMatrix384 (Atlas 900 A3 SuperPoD): one supernode, 384 NPUs, MindCluster recovery ladder, sub-health isolation. */
export function cloudMatrix384Training(): Scenario {
  const input: ScenarioInput = {
    meta: {
      id: 'ascend-cm384',
      name: 'CloudMatrix384 — 384-NPU synchronous training (one supernode)',
      basis: ['arXiv 2506.12708 §3.3 (topology)', 'MindCluster 7.3 fault handling (ladder)', 'docs/ASCEND_SOURCES.md'],
      description: 'Topology from the Huawei paper (48 nodes × 8 NPU, 7 UB sub-planes × 16 L2 chips, 5,376 optical links); failure rates are analogues tagged assumed.',
    },
    topology: { gpusPerNode: 8, nodesPerRack: 4, racksPerZone: 16, nvlinkDomainGpus: 384, networkPlanes: 7, superpod: { preset: 'cloudmatrix384' } },
    components: ascendComponents(0.3),
    structure: { mode: 'template', template: 'training-series' },
    workload: { type: 'training', nGpus: 384, durationDays: 30, deltaS: 30, intervalModel: 'young' },
    recovery: { mode: 'ladder', preset: 'mindcluster-a3' },
    measures: { subhealthThreshold: 0.7, primary: 'compensated', commShare: 0.3 },
    assumptions: ['UB plane / link losses degrade the step time by f_comm × lost share instead of stopping the job (§15)', 'NPU sub-health is isolated by MindCluster slow-node detection (30 % drop, 3 × 30 s) and handled through the recovery ladder', ASCEND_NOTE],
  };
  return parseScenario(input);
}

/** Atlas 950 SuperPoD (8,192 NPUs) with hot spares; fabric geometry assumed from CloudMatrix384. */
export function atlas950Training(): Scenario {
  const input: ScenarioInput = {
    meta: {
      id: 'ascend-atlas950',
      name: 'Atlas 950 SuperPoD — 8,064-NPU training with 16 hot-spare nodes (one 8,192-NPU supernode)',
      basis: ['Huawei Connect 2025 press (8,192 NPUs, 160 cabinets)', 'docs/ASCEND_SOURCES.md'],
      description: 'Public: 8,192 NPUs, 128 compute + 32 communication cabinets (secondary). Fabric tiers, per-node composition and all failure rates are assumptions.',
    },
    topology: { gpusPerNode: 8, nodesPerRack: 8, racksPerZone: 160, nvlinkDomainGpus: 8192, networkPlanes: 7, superpod: { preset: 'atlas950', nodesPerRack: 8, computeRacks: 128, commRacks: 32, l2PerSubPlane: Math.ceil((1024 * 16) / 48) } },
    components: ascendComponents(0.3),
    structure: { mode: 'template', template: 'training-hot-spares' },
    // 1,008 working nodes + 16 hot spares = 1,024 nodes = one supernode (128 cabinets × 8 nodes)
    workload: { type: 'training', nGpus: 8064, durationDays: 30, deltaS: 60, intervalModel: 'young', hotSpareNodes: 16, spareReplenishHours: 24 },
    recovery: { mode: 'ladder', preset: 'mindcluster-a3' },
    measures: { subhealthThreshold: 0.7, primary: 'compensated', commShare: 0.3 },
    assumptions: ['fabric geometry (7 planes, 16 links per L1 chip, 48-port L2 chips) copied from CloudMatrix384 and scaled to 1,024 nodes', ASCEND_NOTE],
  };
  return parseScenario(input);
}

export const EXAMPLES: Record<string, () => Scenario> = {
  'ascend-cm384': cloudMatrix384Training,
  'ascend-atlas950': atlas950Training,
  'survey-ex1': workedExample1,
  'survey-ex3': () => workedExample3(),
  'survey-ex4': () => workedExample4(),
  'nvl72-16k': nvl72Design,
};
