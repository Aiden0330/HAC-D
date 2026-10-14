/** Example scenarios mirroring the survey's worked examples (Tables 6-5 to 6-8) and an NVL72 design. */
import { parseScenario, type Scenario, type ScenarioInput } from './schema.js';
import { REFERENCE_EVENTS, type ReferenceEvent } from './referenceEvents.js';

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
const hpn = (what: string) => ({ source: 'Alibaba HPN: A Data Center Network for Large Language Model Training', org: 'Alibaba', venue: 'SIGCOMM 2024', year: 2024, url: 'https://ennanzhai.github.io/pub/sigcomm24-hpn.pdf', confidence: 'paper-reported' as const, derivation: `${what} (library records nic_optics.nic_tor_link_failure_rate.hpn / switch.tor_critical_error_rate.hpn used as the scale-out analogue)` });

/** Scale-out (RDMA / RoCE) tier between supernodes: per-die 400G links, leaf and spine switches per supernode (2-tier, 4-plane Clos per Huawei; counts assumed). */
function scaleOutComponents(scaleOutCommShare = 0.15): ScenarioInput['components'] {
  const planePerf = 1 / (1 + scaleOutCommShare / 3); // one of 4 scale-out planes lost ≈ 0.952 at f = 0.15
  return [
    {
      id: 'scaleout_link',
      name: { zh: 'Scale-out 光链路（每 die 一个 400G 口，含光模块）', en: 'Scale-out optical link (one 400G port per die, incl. transceivers)' },
      subsystem: 'network',
      countRule: { per: 'gpu', factor: 2 },
      failure: { value: 0.057 / 100 / (30 * 24), unit: 'per_h', koujing: { event: 'link_failure', denominator: 'link_h', level: 'component' }, provenance: hpn('0.057 % of NIC–ToR links fail per month → 7.9e-7 /h') },
      repair: { auto: { coverage: 0.9, successProbability: 0.95, mttrHours: 0.02 }, manual: { mttrHours: 4 }, provenance: assumed('link flaps recovered by HCCL retransmission / path switch in ~1 min; hard faults need a module swap') },
    },
    {
      id: 'scaleout_leaf',
      name: { zh: 'Scale-out 叶交换机（每超节点 24 台，假设）', en: 'Scale-out leaf switch (24 per supernode, assumed)' },
      subsystem: 'network',
      countRule: { per: 'supernode', factor: 24 },
      failure: { value: 0.1 * (0.051 / 100 / (30 * 24)), unit: 'per_h', koujing: { event: 'switch_failure_job_interrupting', denominator: 'switch_h', level: 'component' }, provenance: hpn('0.051 % of ToR switches hit a critical error per month → 7.1e-7 /h; 10 % assumed job-interrupting, 90 % degrade one of 4 planes (sub-health)') },
      repair: { mttrHours: 4 },
      subhealth: { ratePerHour: 0.9 * (0.051 / 100 / (30 * 24)), durationHours: 4, performance: planePerf, escalationMultiplier: 1, policy: 'tolerate' },
    },
    {
      id: 'scaleout_spine',
      name: { zh: 'Scale-out 骨干交换机（每超节点 8 台，假设）', en: 'Scale-out spine switch (8 per supernode, assumed)' },
      subsystem: 'network',
      countRule: { per: 'supernode', factor: 8 },
      failure: { value: 0.1 * (0.051 / 100 / (30 * 24)), unit: 'per_h', koujing: { event: 'switch_failure_job_interrupting', denominator: 'switch_h', level: 'component' }, provenance: hpn('ToR critical-error rate used for spines (no public spine data); 10 % job-interrupting, 90 % sub-health') },
      repair: { mttrHours: 4 },
      subhealth: { ratePerHour: 0.9 * (0.051 / 100 / (30 * 24)), durationHours: 4, performance: planePerf, escalationMultiplier: 1, policy: 'tolerate' },
    },
  ];
}

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

/**
 * SuperCluster sizing: `npus` NPUs served as N + k CloudMatrix384 supernodes (capacity availability).
 * Each supernode is one replica unit that fails when any of its NPUs, CPUs, UB fabric parts, power or
 * cooling fails (classes with declared redundancy enter through their group's equivalent rate).
 */
export function ascendSupercluster(npus = 100000, spareSupernodes = 3): Scenario {
  const supernode = 384;
  const required = Math.ceil(npus / supernode);
  const input: ScenarioInput = {
    meta: {
      id: `ascend-supercluster-${Math.round(npus / 1000)}k`,
      name: `SuperCluster — ${npus.toLocaleString('en-US')} NPUs as ${required} + ${spareSupernodes} CloudMatrix384 supernodes`,
      basis: ['arXiv 2506.12708 §3.3 (supernode topology)', 'Huawei Connect 2025 (2-tier, 4-plane scale-out Clos)', 'Alibaba HPN SIGCOMM 2024 (scale-out analogues)', 'docs/ASCEND_SOURCES.md'],
      description: `Capacity availability of a ${npus.toLocaleString('en-US')}-NPU cluster: ${required} supernodes required, ${spareSupernodes} spare; change "Cluster size" or "Spare replicas" to re-size. Scale-out switch counts and all failure rates are analogues tagged assumed / paper-reported.`,
    },
    topology: { gpusPerNode: 8, nodesPerRack: 4, racksPerZone: 16, nvlinkDomainGpus: supernode, networkPlanes: 7, superpod: { preset: 'cloudmatrix384' } },
    components: [...ascendComponents(0.3), ...scaleOutComponents(0.15)],
    structure: { mode: 'template', template: 'inference-nk' },
    workload: { type: 'inference', replicasRequired: required, gpusPerReplica: supernode, spareReplicas: spareSupernodes, capacityTarget: 0.999, windowHours: 24 },
    recovery: { mode: 'ladder', preset: 'mindcluster-a3' },
    measures: { subhealthThreshold: 0.7, primary: 'compensated', commShare: 0.3 },
    assumptions: ['one supernode = one replica unit: any job-interrupting fault inside it takes the supernode out until repaired (rate-weighted MTTR of its classes)', 'scale-out leaf / spine counts per supernode are assumptions (768 NPU ports at 32 downlinks per 64-port switch; 2-tier, 4-plane Clos)', ASCEND_NOTE],
  };
  return parseScenario(input);
}


/**
 * The ai-cluster-reliability-main confirmed baseline (catalogs/review-2026-10-09): 10,000-card hard-interruption
 * MTBF 30 h with linear scaling, checkpoint 300 s compute + 4 s save, detection 95 % in 10 s else 60 s timeout,
 * automatic recovery 180 s with 99 % success else +2 h manual. Hard interruptions only (stage 0 of the comparison in
 * docs/REFERENCE_COMPARISON_100K_500K.md); add sub-health to the card class for stage 1. Silent corruption is not modelled.
 */
/**
 * Mechanism applicability of the four sources, aggregated from the reference's 54-event catalog
 * (catalogs/review-2026-10-09/inputs.json, FIT-weighted per source): the share of a source's interruptions that
 * replay / process rescheduling / DP elasticity can act on, and each source's share of the silent-corruption budget
 * (AI Core carries 85 % of it, so 87 % of the silent events sit in the accelerator source). v3.2: predict = share of persistent
 * card / server faults (what ECC-trend and health-score predictors target), netfail = network class, hotswap = card / server scope.
 */
export const REFERENCE_SOURCES = [
  { id: 'hbm', subsystem: 'memory', share: 0.172, sdcShare: 0.0, mechanisms: { replay: 0.698, process: 1, elastic: 1, predict: 0.302, netfail: 0, hotswap: 1 }, name: { zh: 'HBM / 片上内存（17.2 %）', en: 'HBM / on-package memory (17.2 %)' } },
  { id: 'gpu', subsystem: 'compute', share: 0.301, sdcShare: 0.87134, mechanisms: { replay: 0.831, process: 1, elastic: 1, predict: 0.169, netfail: 0, hotswap: 1 }, name: { zh: '加速卡本体（30.1 %）', en: 'Faulty accelerator (30.1 %)' } },
  { id: 'network', subsystem: 'network', share: 0.084, sdcShare: 0.04443, mechanisms: { replay: 0.595, process: 0.357, elastic: 0.357, predict: 0, netfail: 1, hotswap: 0.357 }, name: { zh: '网络交换机 / 线缆（8.4 %）', en: 'Network switch / cable (8.4 %)' } },
  { id: 'other', subsystem: 'other', share: 0.443, sdcShare: 0.08423, mechanisms: { replay: 0, process: 0.361, elastic: 0.361, predict: 0.361, netfail: 0, hotswap: 0.361 }, name: { zh: '其他来源（44.3 %）', en: 'Other sources (44.3 %)' } },
] as const;

/** Fault-class shares of the reference baseline: interruption 96.6 %, sub-health 2 %, silent 1.4 % of all events. */
export const REFERENCE_SHARES = { hard: 0.966, slow: 0.02, sdc: 0.014 } as const;

function referenceComponents(lamCard: number, withSlow: boolean, withSdc: boolean): ScenarioInput['components'] {
  return REFERENCE_SOURCES.map((src) => ({
    id: src.id,
    name: src.name,
    subsystem: src.subsystem,
    countRule: { per: 'gpu' as const, factor: 1 },
    failure: { value: lamCard * src.share, unit: 'per_h' as const, koujing: { event: 'hard_interruption', denominator: 'card_h', level: 'job' as const }, provenance: { source: 'ai-cluster-reliability-main confirmed baseline: 10,000-card hard MTBF 30 h (3,333 FIT per card) × Llama 3 Table 5 category share', org: 'user baseline / Meta', year: 2026, url: 'https://arxiv.org/abs/2407.21783', confidence: 'assumed' as const, derivation: `${src.share} × 1/(10,000 × 30 h) per card-hour; shares borrowed from Llama 3, not measured on this cluster` } },
    repair: { auto: { coverage: 1, successProbability: 0.99, mttrHours: (12.5 + 180) / 3600 }, manual: { mttrHours: 2 } },
    mechanisms: { ...src.mechanisms },
    ...(withSlow
      ? { subhealth: { ratePerHour: (lamCard * src.share * REFERENCE_SHARES.slow) / REFERENCE_SHARES.hard, durationHours: 24, performance: 0.95, escalationMultiplier: 1, policy: 'isolate' as const, detection: { probability: 0.95, delayHours: 5 / 60 } } }
      : {}),
    ...(withSdc && src.sdcShare > 0
      ? { sdc: { ratePerHour: (lamCard * REFERENCE_SHARES.sdc * src.sdcShare) / REFERENCE_SHARES.hard, provenance: { source: 'reference catalog: silent events are 1.4 % of all events; per-source split from the 54-event catalog (AI Core 85 % of the silent budget)', confidence: 'assumed' as const, derivation: `${src.sdcShare} × 0.014/0.966 × λ_card` } } }
      : {}),
  }));
}

export function referenceBaseline(npus = 100000): Scenario {
  const lamCard = 1 / (10000 * 30);
  const input: ScenarioInput = {
    meta: {
      id: `ref-baseline-${Math.round(npus / 1000)}k`,
      name: `Reference baseline — ${npus.toLocaleString('en-US')} cards, MTBF 30 h @ 10k, τ 300 s, R 264.5 s`,
      basis: ['ai-cluster-reliability-main catalogs/review-2026-10-09 (user-confirmed baseline)', 'docs/REFERENCE_COMPARISON_100K_500K.md'],
      description: 'Hard interruptions only, as in the like-for-like comparison; the per-card rate is split into HBM / GPU / network / other with the Llama 3 shares so that targets can be allocated to sources, and each source carries the mechanism applicability fractions of the reference catalog. The three-class variant (sub-health and silent corruption) is the example "Reference baseline, three fault classes".',
    },
    topology: { gpusPerNode: 8, nodesPerRack: 32, racksPerZone: 64, nvlinkDomainGpus: 8 },
    components: referenceComponents(lamCard, false, false),
    structure: { mode: 'template', template: 'training-series' },
    workload: { type: 'training', nGpus: npus, durationDays: 30, deltaS: 4, intervalS: 300, intervalModel: 'young' },
    recovery: { mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { successProbability: 0.99, seconds: 180 }, manual: { seconds: 7200 } },
    assumptions: ['fixed checkpoint interval 300 s (not the Young optimum) to match the reference', 'recovery: MTTR mixture R = T_det + T_auto + (1 − p_s)·T_manual = 12.5 + 180 + 72 = 264.5 s'],
  };
  return parseScenario(input);
}

/**
 * The reference's confirmed three-class baseline: interruptions 96.6 %, sub-health 2 % (24 h, −5 %, 95 % detected in
 * 5 min, isolated after saving progress) and silent corruption 1.4 % (no immediate detection, discovered after
 * 120 h, rollback to the last clean checkpoint, terminal discard at day 30). Reproduces the reference's
 * 正确有效产出 (delivered goodput) and is the starting point of the Mechanisms page.
 */
export function referenceThreeClasses(npus = 100000): Scenario {
  const lamCard = 1 / (10000 * 30);
  const input: ScenarioInput = {
    meta: {
      id: `ref-three-classes-${Math.round(npus / 1000)}k`,
      name: `Reference baseline, three fault classes — ${npus.toLocaleString('en-US')} cards (interruption / sub-health / silent)`,
      basis: ['ai-cluster-reliability-main catalogs/review-2026-10-09 (confirmed baseline, results.json)', 'docs/MODEL_REFERENCE.md §19–§22'],
      description: 'Interruptions 96.6 %, sub-health 2 % and silent corruption 1.4 % of all events on the 10,000-card MTBF 30 h anchor; τ 300 s / δ 4 s; detection 95 % in 10 s else 60 s; automatic recovery 180 s at 99 % else + 2 h manual. Silent corruption is not detected immediately (0 %) and is discovered after 120 h. Reference 30-day delivered goodput: 93.3 % at 10k, 62.6 % at 100k, 45.9 % at 200k, 25.2 % at 500k cards.',
    },
    topology: { gpusPerNode: 8, nodesPerRack: 32, racksPerZone: 64, nvlinkDomainGpus: 8 },
    components: referenceComponents(lamCard, true, true),
    structure: { mode: 'template', template: 'training-series' },
    workload: { type: 'training', nGpus: npus, durationDays: 30, deltaS: 4, intervalS: 300, intervalModel: 'young' },
    recovery: { mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { successProbability: 0.99, seconds: 180 }, manual: { seconds: 7200 } },
    sdc: { detection: { coverage: 0, detectSeconds: 1 }, fallbackDelayHours: 120 },
    targets: { goodput: 0.9 },
    assumptions: ['fixed checkpoint interval 300 s to match the reference', 'sub-health: a detected slow unit is isolated after saving the current progress (no rollback), undetected units slow the job for 24 h', 'silent corruption: the first undetected event opens an episode discovered after 120 h; work since the last clean checkpoint is rolled back; still-dirty state at day 30 is discarded'],
  };
  return parseScenario(input);
}

/**
 * The reference baseline at catalog granularity: one component class per audited event (54 = 18 domains × three classes),
 * each hard event carrying its own replay / process / elastic flags. Use it for mechanism combinations: the four-source example
 * treats the applicability fractions of a source as independent, which over-credits coalitions (0.2 pt A_op at 100k cards,
 * 0.9 pt at 500k); the catalog build reproduces the reference's combined scenario exactly.
 */
export interface CatalogScenarioOptions {
  npus?: number;
  id?: string;
  name?: string;
  description?: string;
  basis?: string[];
  /** provenance source written on every class */
  source?: string;
  confidence?: 'measured' | 'paper-reported' | 'vendor' | 'derived' | 'assumed' | 'scan-level';
  /** reference-engine baseline settings (300 s / 4 s checkpoints, 95 % @ 10 s detection, 180 s @ 99 % + 2 h recovery, 120 h fallback) unless overridden */
  intervalS?: number;
  deltaS?: number;
  goodputTarget?: number;
}

/**
 * v3.6: a scenario at catalog granularity (one class per event with its own replay / process / elastic flags) from any event
 * list in the reference catalog's shape — the built-in audited catalog, or a re-calibrated catalog exported by ReMAP
 * (`importRemapCatalog`). FIT is per card-hour equivalent (business-impact events after the existing protection).
 */
export function catalogScenario(events: ReferenceEvent[], opts: CatalogScenarioOptions = {}): Scenario {
  const npus = opts.npus ?? 100000;
  const source = opts.source ?? 'ai-cluster-reliability audited catalog (review-2026-10-09): business-impact FIT per card-hour, class budgets fixed, priors to be audited';
  const confidence = opts.confidence ?? 'assumed';
  const components: ScenarioInput['components'] = events.map((e) => {
    const rate = e.fit / 1e9;
    const base = { id: e.id, name: { zh: `${e.domain} · ${e.description}`, en: `${e.domainId} ${e.type} · ${e.description}` }, subsystem: 'other' as const, countRule: { per: 'gpu' as const, factor: 1 } };
    const provenance = { source, confidence, derivation: `${e.fit.toFixed(3)} FIT → ${rate.toExponential(3)} per card-hour` };
    if (e.type === 'hard') return { ...base, failure: { value: rate, unit: 'per_h' as const, koujing: { event: 'hard_interruption', denominator: 'card_h', level: 'job' as const }, provenance }, repair: { auto: { coverage: 1, successProbability: 0.99, mttrHours: (12.5 + 180) / 3600 }, manual: { mttrHours: 2 } }, mechanisms: { replay: e.replay ? 1 : 0, process: e.process ? 1 : 0, elastic: e.elastic ? 1 : 0, predict: e.persistence === 'persistent' && (e.scope === 'card' || e.scope === 'server') ? 1 : 0, netfail: ['NIC', 'OPT', 'BOXIO', 'FABRIC'].includes(e.domainId) ? 1 : 0, hotswap: e.elastic ? 1 : 0 } };
    if (e.type === 'slow') return { ...base, failure: { value: 0, unit: 'per_h' as const, provenance }, repair: { mttrHours: 1 }, subhealth: { ratePerHour: rate, durationHours: 24, performance: 0.95, escalationMultiplier: 1, policy: 'isolate' as const, detection: { probability: 0.95, delayHours: 5 / 60 } } };
    return { ...base, failure: { value: 0, unit: 'per_h' as const, provenance }, repair: { mttrHours: 1 }, sdc: { ratePerHour: rate, provenance } };
  });
  return parseScenario({
    meta: {
      id: opts.id ?? `catalog-${Math.round(npus / 1000)}k`,
      name: opts.name ?? `Event catalog, ${events.length} events — ${npus.toLocaleString('en-US')} cards (per-event mechanism flags)`,
      basis: opts.basis ?? [source],
      description: opts.description ?? `${events.length} events at catalog granularity: one class per event with its own replay / process / elastic applicability; FIT per card-hour equivalent.`,
    },
    topology: { gpusPerNode: 8, nodesPerRack: 32, racksPerZone: 64, nvlinkDomainGpus: 8 },
    components,
    structure: { mode: 'template', template: 'training-series' },
    workload: { type: 'training', nGpus: npus, durationDays: 30, deltaS: opts.deltaS ?? 4, intervalS: opts.intervalS ?? 300, intervalModel: 'young' },
    recovery: { mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { successProbability: 0.99, seconds: 180 }, manual: { seconds: 7200 } },
    sdc: { detection: { coverage: 0, detectSeconds: 1 }, fallbackDelayHours: 120 },
    targets: { goodput: opts.goodputTarget ?? 0.9 },
    assumptions: ['fixed checkpoint interval to match the reference', 'event FITs are business-impact rates after the existing protection (no double credit for H-PROTECT)', 'sub-health and silent events are attached to classes without an interruption rate of their own'],
  });
}

export function referenceCatalog(npus = 100000): Scenario {
  return catalogScenario(REFERENCE_EVENTS, {
    npus,
    id: `ref-catalog-${Math.round(npus / 1000)}k`,
    name: `Reference catalog, 54 events — ${npus.toLocaleString('en-US')} cards (per-event mechanism flags)`,
    basis: ['ai-cluster-reliability-main catalogs/review-2026-10-09 inputs.json (54 events, class budgets, mechanism flags)', 'docs/MECHANISM_CONTRIBUTIONS.md'],
    description: 'The three-class reference baseline at the granularity of the audited catalog: 18 hardware domains × (interruption, sub-health, silent), each interruption event with its own replay / process / elastic applicability. Same job-level totals as the four-source example; reproduces the reference tool\'s mechanism combinations exactly because the flags are per event rather than independent fractions per source.',
  });
}

export const EXAMPLES: Record<string, () => Scenario> = {
  'ref-baseline-100k': () => referenceBaseline(100000),
  'ref-three-classes-100k': () => referenceThreeClasses(100000),
  'ref-catalog-100k': () => referenceCatalog(100000),
  'ascend-cm384': cloudMatrix384Training,
  'ascend-atlas950': atlas950Training,
  'ascend-supercluster-100k': () => ascendSupercluster(100000, 3),
  'survey-ex1': workedExample1,
  'survey-ex3': () => workedExample3(),
  'survey-ex4': () => workedExample4(),
  'nvl72-16k': nvl72Design,
};
