/**
 * v4 topology templates (docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §2): three typical Ascend cluster topologies turned into a hardware
 * bill of materials and a scenario whose fault types sit on the hardware units, so that the topology changes the job's
 * interruption rate.
 *
 *  - `a2-roce`  · A2: Atlas 800T A2 servers (8 × 910B, 4 × Kunpeng 920, 8 × 200GE RoCE ports direct from the NPUs), 8 servers per
 *                 Atlas 900 A2 PoD cabinet, RoCE folded Clos (radix and oversubscription assumed).
 *  - `a3-ub384` · A3 / CloudMatrix384: 48 nodes × (8 NPU + 4 CPU + 7 L1 UB chips), 12 compute + 4 communication cabinets,
 *                 7 sub-planes × 16 L2 chips (arXiv 2506.12708 §3.3), RDMA scale-out plane (Clos assumed).
 *  - `a950-ub2` · Atlas 950 SuperPoD: 8,192 NPUs, 128 + 32 cabinets, 64 NPUs per compute cabinet (vendor); fabric radix copied
 *                 from CloudMatrix384 (assumed); scale-out as A3.
 *
 * Fault types: the 54 events of the audited reference catalog state a business-impact FIT per card-hour. Each event is attached to
 * the hardware unit it belongs to and converted under the CloudMatrix384 geometry, where the catalog and the paper's unit counts
 * agree: FIT_unit = FIT_card × 384 / (units in one 384-NPU pod). A CloudMatrix384 cluster without scale-out network therefore
 * reproduces the catalog exactly; A2 and Atlas 950 change the rate through their hardware mix. RoCE switches and links carry the
 * per-unit FIT of the UB switch chip and the UB link (analogue, assumed). Every value keeps its 口径 (business-impact events per
 * unit-hour) and its provenance.
 */
import { parseScenario, SUPERPOD_PRESETS, type Scenario, type ScenarioInput, type Topology } from '../scenario/schema.js';
import { REFERENCE_EVENTS, type ReferenceEvent } from '../scenario/referenceEvents.js';
import { EXAMPLES } from '../scenario/examples.js';
import { computeCounts, type Counts } from '../scenario/build.js';
import { applyMechanisms, stripMechanisms, mechanismById, DEFAULT_PLAYERS } from '../mechanisms/index.js';
import { toPerHour } from '../units/index.js';
import { withSize } from '../study/index.js';

export type TopologyTemplate = 'a2-roce' | 'a3-ub384' | 'a950-ub2';
export const TOPOLOGY_TEMPLATE_IDS: TopologyTemplate[] = ['a2-roce', 'a3-ub384', 'a950-ub2'];
/** v4.1 built-in scales (NPUs in the job) of the topology page, the bill-of-materials columns, the cross-scale tabs, the CLI and MCP; any N is allowed */
export const TOPOLOGY_SCALES = [10000, 100000, 200000, 500000];
/** compact label of a scale: 10k, 100k, 1.2M */
export function scaleLabel(n: number): string {
  return n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);
}

type L = { zh: string; en: string };
export type FaultUnit = 'npu' | 'job' | 'cpu' | 'node' | 'cabinet' | 'ub-switch' | 'ub-link' | 'roce-switch' | 'roce-link';
export const FAULT_UNITS: FaultUnit[] = ['npu', 'job', 'cpu', 'node', 'cabinet', 'ub-switch', 'ub-link', 'roce-switch', 'roce-link'];
type CountPer = 'gpu' | 'cpu' | 'node' | 'rack' | 'ub_switch' | 'optical_link' | 'roce_switch' | 'roce_link';
const UNIT_RULE: Record<FaultUnit, CountPer> = { npu: 'gpu', job: 'gpu', cpu: 'cpu', node: 'node', cabinet: 'rack', 'ub-switch': 'ub_switch', 'ub-link': 'optical_link', 'roce-switch': 'roce_switch', 'roce-link': 'roce_link' };
/** component-id suffix of the units whose events also exist on another unit type (the RoCE analogues of FABRIC and OPT) */
const UNIT_SUFFIX: Partial<Record<FaultUnit, string>> = { 'roce-switch': '@roce', 'roce-link': '@roce' };

export const FAULT_UNIT_NAMES: Record<FaultUnit, L> = {
  npu: { zh: 'NPU（含 HBM、片上网口）', en: 'NPU (incl. HBM and on-die ports)' },
  job: { zh: '作业级服务（按 NPU 计）', en: 'Job-level services (per NPU)' },
  cpu: { zh: '鲲鹏 CPU', en: 'Kunpeng CPU' },
  node: { zh: '服务器 / 计算节点（DDR、SSD、板级 IO、BMC）', en: 'Server / compute node (DDR, SSD, board IO, BMC)' },
  cabinet: { zh: '计算机柜（供电、液冷）', en: 'Compute cabinet (power, liquid cooling)' },
  'ub-switch': { zh: 'UB 交换芯片（L1 + L2）', en: 'UB switch chip (L1 + L2)' },
  'ub-link': { zh: 'UB 光链路（L1–L2，两端光模块）', en: 'UB optical link (L1–L2, two transceivers)' },
  'roce-switch': { zh: 'RoCE 交换机（叶 / 脊 / 核心）', en: 'RoCE switch (leaf / spine / core)' },
  'roce-link': { zh: 'RoCE 光链路（两端光模块）', en: 'RoCE optical link (two transceivers)' },
};

/** catalog domain → hardware unit; FABRIC and OPT also sit on the RoCE units when the template has a scale-out network */
export const DOMAIN_UNIT: Record<string, FaultUnit> = {
  CORE: 'npu', SRAM: 'npu', IOD: 'npu', MODULE: 'npu', MEMT: 'npu', MEMP: 'npu', NIC: 'npu',
  STORAGE: 'job', UNKNOWN: 'job',
  CPU: 'cpu',
  DDR: 'node', SSD: 'node', BOXIO: 'node', MGMT: 'node',
  POWER: 'cabinet', COOL: 'cabinet',
  FABRIC: 'ub-switch', OPT: 'ub-link',
};
const ROCE_ANALOGUE: Record<string, FaultUnit> = { FABRIC: 'roce-switch', OPT: 'roce-link' };

export const DOMAIN_NAMES: Record<string, L> = {
  CORE: { zh: 'AI Core 计算单元', en: 'AI Core compute units' }, SRAM: { zh: '片内 SRAM / 缓存', en: 'On-chip SRAM / cache' }, IOD: { zh: '芯片内 IO Die / D2D', en: 'On-chip IO die / D2D' },
  MODULE: { zh: 'HiAM 模组 / 板级连接', en: 'HiAM module / board connection' }, MEMT: { zh: 'NPU 内存可恢复瞬态', en: 'NPU memory, recoverable transient' }, MEMP: { zh: 'NPU 内存持续失效', en: 'NPU memory, persistent failure' },
  NIC: { zh: 'UB 网卡 / RoCE 接口', en: 'UB NIC / RoCE interface' }, OPT: { zh: '光模块 / 光纤保护组', en: 'Optics / fibre protection group' }, BOXIO: { zh: '框内 IO 转换 / 交换板', en: 'In-chassis IO conversion / switch board' },
  FABRIC: { zh: 'L1 / L2 互联设备', en: 'L1 / L2 interconnect devices' }, CPU: { zh: 'CPU 计算刀片', en: 'CPU compute blade' }, DDR: { zh: 'CPU DDR 内存', en: 'CPU DDR memory' },
  SSD: { zh: '本地 SSD / 系统盘', en: 'Local SSD / system disk' }, POWER: { zh: '柜级供电残余故障', en: 'Cabinet power (residual after protection)' }, COOL: { zh: '液冷 / 风扇 / 热管理', en: 'Liquid cooling / fans / thermal' },
  MGMT: { zh: '管理刀片 / BMC / UBM', en: 'Management blade / BMC / UBM' }, STORAGE: { zh: '共享检查点 / 存储服务', en: 'Shared checkpoint / storage service' }, UNKNOWN: { zh: '未知 / 软件 / 未归因', en: 'Unknown / software / unattributed' },
};
const EVENT_EN: Record<string, string> = {
  'CORE-hard': 'runtime exception / operator abort', 'CORE-slow': 'on-chip DVFS throttling', 'CORE-sdc': 'wrong results without an alarm',
  'SRAM-hard': 'uncorrectable cache error', 'SRAM-slow': 'slowdown from retries', 'SRAM-sdc': 'undetected cache data error',
  'IOD-hard': 'D2D / IO path failure', 'IOD-slow': 'retransmission or reduced path bandwidth', 'IOD-sdc': 'residual silent error on the data path',
  'MODULE-hard': 'module or connection fault', 'MODULE-slow': 'marginal contact or supply slows the card', 'MODULE-sdc': 'unlocalised data anomaly in the module',
  'MEMT-hard': 'recoverable UCE candidate (check the error code)', 'MEMT-slow': 'slowdown from correction / access retries', 'MEMT-sdc': 'corruption escaping memory protection',
  'MEMP-hard': 'persistent UCE / device failure', 'MEMP-slow': 'slowdown after capacity isolation', 'MEMP-sdc': 'persistent residual data corruption',
  'NIC-hard': 'interface / connection loss', 'NIC-slow': 'bandwidth degradation and retransmission', 'NIC-sdc': 'corruption escaping end-to-end checks',
  'OPT-hard': 'link loss after the protection fails', 'OPT-slow': 'bandwidth drop after a 2 + 2 switchover', 'OPT-sdc': 'physical bit errors (no SDC event)',
  'BOXIO-hard': 'protocol-conversion or switch-board failure', 'BOXIO-slow': 'degraded forwarding', 'BOXIO-sdc': 'data anomaly escaping checks',
  'FABRIC-hard': 'residual plane outage after protection', 'FABRIC-slow': 'plane capacity loss / congestion', 'FABRIC-sdc': 'residual corruption in switched data',
  'CPU-hard': 'processor / host interruption', 'CPU-slow': 'host throttling / starvation', 'CPU-sdc': 'host computation corruption',
  'DDR-hard': 'memory UCE stops the process / host', 'DDR-slow': 'slowdown from correction / isolation', 'DDR-sdc': 'corruption escaping memory protection',
  'SSD-hard': 'disk failure or IO timeout', 'SSD-slow': 'rising IO latency', 'SSD-sdc': 'data escaping checksums',
  'POWER-hard': 'power loss after protection', 'POWER-slow': 'power capping', 'POWER-sdc': 'no direct SDC',
  'COOL-hard': 'over-temperature trip / leak isolation', 'COOL-slow': 'thermal throttling', 'COOL-sdc': 'no direct SDC',
  'MGMT-hard': 'control-plane fault hits the job', 'MGMT-slow': 'management fault blocks indirectly', 'MGMT-sdc': 'residual state / configuration error',
  'STORAGE-hard': 'storage unavailable to training', 'STORAGE-slow': 'degraded save / load', 'STORAGE-sdc': 'checkpoint escaping verification',
  'UNKNOWN-hard': 'unattributed interruption', 'UNKNOWN-slow': 'unattributed slowdown', 'UNKNOWN-sdc': 'unattributed corruption',
};
const SUBSYSTEM: Record<string, Scenario['components'][number]['subsystem']> = {
  CORE: 'compute', SRAM: 'compute', IOD: 'compute', MODULE: 'compute', MEMT: 'memory', MEMP: 'memory', NIC: 'network', OPT: 'network', BOXIO: 'interconnect', FABRIC: 'interconnect',
  CPU: 'host', DDR: 'host', SSD: 'host', MGMT: 'host', POWER: 'power', COOL: 'cooling', STORAGE: 'storage', UNKNOWN: 'software',
};

/* ---------------------------------------------------------------------- */
/* Templates                                                                */
/* ---------------------------------------------------------------------- */

export interface TemplateInfo {
  id: TopologyTemplate;
  name: L;
  /** chip name for labels */
  chip: string;
  /** NPUs in one scale-up domain */
  scaleUpNpus: number;
  /** NPUs in one SuperPoD (= scale-up domain for A3 / 950; one cabinet for A2) */
  podNpus: number;
  summary: L;
  /** topology input of the scenario */
  topology: NonNullable<ScenarioInput['topology']>;
  /** geometry fields that are assumptions, not public facts */
  assumed: string[];
  sources: { label: string; url?: string; confidence: 'paper' | 'vendor' | 'derived' | 'assumed' | 'scan-level'; note: L }[];
}

const SCALE_OUT_DEFAULT = { radix: 64, oversubscription: 1, transceiversPerLink: 2 };

export const TOPOLOGY_TEMPLATES: Record<TopologyTemplate, TemplateInfo> = {
  'a2-roce': {
    id: 'a2-roce',
    name: { zh: 'A2 · 8 卡服务器 + RoCE', en: 'A2 · 8-NPU servers + RoCE' },
    chip: 'Ascend 910B',
    scaleUpNpus: 8,
    podNpus: 64,
    summary: { zh: '每台 Atlas 800T A2 服务器 8 × 910B（HCCS）、4 × 鲲鹏 920、8 × 200GE RoCE 口直出；每柜 8 台（64 NPU）；RoCE 叶脊 Clos 为参数面', en: 'Atlas 800T A2 servers: 8 × 910B (HCCS), 4 × Kunpeng 920, 8 × 200GE RoCE ports direct; 8 servers (64 NPUs) per cabinet; RoCE leaf–spine Clos as the parameter plane' },
    topology: { gpusPerNode: 8, nodesPerRack: 8, racksPerZone: 64, nvlinkDomainGpus: 8, networkPlanes: 8, cpusPerNode: 4, template: 'a2-roce', fabricFill: 'proportional', scaleOut: { portsPerNpu: 1, ...SCALE_OUT_DEFAULT } },
    assumed: ['scaleOut.radix', 'scaleOut.oversubscription', 'scaleOut.transceiversPerLink'],
    sources: [
      { label: 'Huawei Atlas 800T A2 product page', url: 'https://e.huawei.com/cn/products/computing/ascend/atlas-800t-a2', confidence: 'vendor', note: { zh: '4U；8 × 910B；4 × 鲲鹏 920；8 × 200GE QSFP 直出 RoCE', en: '4U; 8 × 910B; 4 × Kunpeng 920; 8 × 200GE QSFP direct RoCE' } },
      { label: 'Huawei Atlas 900 A2 PoD product page', confidence: 'derived', note: { zh: '基本单元为一个 47U 液冷柜，32 × 鲲鹏 920 → 每柜 8 台服务器、64 NPU（推得）', en: 'basic unit one 47U liquid-cooled cabinet with 32 × Kunpeng 920 → 8 servers, 64 NPUs per cabinet (derived)' } },
      { label: 'RoCE Clos', confidence: 'assumed', note: { zh: '交换机端口数 64、无收敛、每链路两个光模块：公开来源未给出', en: 'switch radix 64, non-blocking, two transceivers per link: not in public sources' } },
    ],
  },
  'a3-ub384': {
    id: 'a3-ub384',
    name: { zh: 'A3 · CloudMatrix384 UB 超节点', en: 'A3 · CloudMatrix384 UB supernode' },
    chip: 'Ascend 910C',
    scaleUpNpus: 384,
    podNpus: 384,
    summary: { zh: '48 节点 × (8 NPU + 4 CPU + 7 L1 UB 芯片)，12 计算柜 + 4 通信柜，7 子平面 × 16 片 L2；超节点之间为 RDMA 面（每 NPU 2 口）', en: '48 nodes × (8 NPUs + 4 CPUs + 7 L1 UB chips), 12 compute + 4 communication cabinets, 7 sub-planes × 16 L2 chips; RDMA plane between supernodes (2 ports per NPU)' },
    topology: { gpusPerNode: 8, nodesPerRack: 4, racksPerZone: 16, nvlinkDomainGpus: 384, networkPlanes: 7, superpod: { ...SUPERPOD_PRESETS.cloudmatrix384.values }, template: 'a3-ub384', fabricFill: 'proportional', scaleOut: { portsPerNpu: SUPERPOD_PRESETS.cloudmatrix384.values.rdmaPortsPerNpu, ...SCALE_OUT_DEFAULT } },
    assumed: ['superpod.transceiversPerLink', 'scaleOut.radix', 'scaleOut.oversubscription', 'scaleOut.transceiversPerLink'],
    sources: [
      { label: 'Huawei, Serving LLMs on Huawei CloudMatrix384 (arXiv 2506.12708 v3) §3.3', url: 'https://arxiv.org/abs/2506.12708', confidence: 'paper', note: { zh: '节点、机柜、L1 / L2、子平面、链路数与 RDMA 接口（每 die 1 个）', en: 'nodes, cabinets, L1 / L2 chips, sub-planes, links and RDMA interfaces (one per die)' } },
      { label: 'RDMA scale-out Clos', confidence: 'assumed', note: { zh: '交换机端口数 64、无收敛：公开来源未给出', en: 'switch radix 64, non-blocking: not in public sources' } },
    ],
  },
  'a950-ub2': {
    id: 'a950-ub2',
    name: { zh: 'Atlas 950 · UB 2.0 SuperPoD', en: 'Atlas 950 · UB 2.0 SuperPoD' },
    chip: 'Ascend 950DT',
    scaleUpNpus: 8192,
    podNpus: 8192,
    summary: { zh: '8,192 NPU、128 计算柜 + 32 通信柜、每计算柜 64 NPU（厂商）；柜间全光 UB 2.0；内部交换结构沿用 CloudMatrix384（假设）', en: '8,192 NPUs, 128 compute + 32 communication cabinets, 64 NPUs per compute cabinet (vendor); all-optical UB 2.0 between cabinets; internal fabric copied from CloudMatrix384 (assumed)' },
    topology: { gpusPerNode: 8, nodesPerRack: 8, racksPerZone: 160, nvlinkDomainGpus: 8192, networkPlanes: 7, superpod: { ...SUPERPOD_PRESETS.atlas950.values }, template: 'a950-ub2', fabricFill: 'proportional', scaleOut: { portsPerNpu: SUPERPOD_PRESETS.atlas950.values.rdmaPortsPerNpu, ...SCALE_OUT_DEFAULT } },
    assumed: [...SUPERPOD_PRESETS.atlas950.assumed.map((k) => `superpod.${k}`), 'scaleOut.radix', 'scaleOut.oversubscription', 'scaleOut.transceiversPerLink'],
    sources: [
      { label: 'Huawei Connect 2025 press release / keynote', url: 'https://www.huawei.com/en/news/2025/9/hc-lingqu-ai-superpod', confidence: 'vendor', note: { zh: '8,192 NPU、128 + 32 柜、柜间全光', en: '8,192 NPUs, 128 + 32 cabinets, all-optical between cabinets' } },
      { label: 'Huawei MWC 2026', url: 'https://www.huawei.com/en/news/2026/3/mwc-superpod-ai', confidence: 'vendor', note: { zh: '每柜 64 NPU', en: '64 NPUs per cabinet' } },
      { label: 'Fabric geometry', confidence: 'assumed', note: { zh: '节点组成、L1 / L2 端口数与子平面沿用 CloudMatrix384；L2 片数按端口数无阻塞推算', en: 'node composition, L1 / L2 radix and sub-planes copied from CloudMatrix384; L2 count scaled to stay non-blocking' } },
    ],
  },
};

/* ---------------------------------------------------------------------- */
/* Per-unit fault library                                                   */
/* ---------------------------------------------------------------------- */

/** NPUs per unit in the calibration geometry (one CloudMatrix384 pod without scale-out network): 384 / units per pod */
export function calibrationCardsPerUnit(): Record<FaultUnit, number> {
  const c = computeCounts(parseScenario({
    meta: { name: 'calibration' },
    topology: { gpusPerNode: 8, nodesPerRack: 4, superpod: { ...SUPERPOD_PRESETS.cloudmatrix384.values } },
    components: [{ id: 'x', countRule: { per: 'gpu', factor: 1 }, failure: { value: 0, unit: 'per_h' }, repair: { mttrHours: 1 } }],
    workload: { type: 'training', nGpus: 384, deltaS: 1 },
  }));
  return { npu: 1, job: 1, cpu: c.gpus / c.cpus, node: c.gpus / c.nodes, cabinet: c.gpus / c.racks, 'ub-switch': c.gpus / c.ubSwitches, 'ub-link': c.gpus / c.opticalLinks, 'roce-switch': c.gpus / c.ubSwitches, 'roce-link': c.gpus / c.opticalLinks };
}

export interface UnitFaultType {
  /** component id in a topology scenario: the catalog event id, `@roce` for the RoCE analogues */
  id: string;
  eventId: string;
  domainId: string;
  domain: L;
  description: L;
  type: 'hard' | 'slow' | 'sdc';
  unit: FaultUnit;
  /** catalog rate per card-hour (business-impact FIT) */
  fitPerCard: number;
  /** NPUs per unit in the calibration geometry */
  cardsPerUnit: number;
  /** business-impact FIT per unit-hour = fitPerCard × cardsPerUnit */
  fitPerUnit: number;
  persistence: string;
  flags: { replay: boolean; process: boolean; elastic: boolean };
  analogue: boolean;
  confidence: 'assumed';
  derivation: string;
}

/** the 54 catalog events attached to their hardware units (plus the RoCE analogues of FABRIC and OPT, 6 more) */
export function unitFaultLibrary(events: ReferenceEvent[] = REFERENCE_EVENTS): UnitFaultType[] {
  const cpu = calibrationCardsPerUnit();
  const out: UnitFaultType[] = [];
  const add = (e: ReferenceEvent, unit: FaultUnit, analogue: boolean) => {
    const k = cpu[unit];
    out.push({
      id: `${e.id}${UNIT_SUFFIX[unit] ?? ''}`,
      eventId: e.id,
      domainId: e.domainId,
      domain: DOMAIN_NAMES[e.domainId] ?? { zh: e.domain, en: e.domainId },
      description: { zh: e.description, en: EVENT_EN[e.id] ?? e.description },
      type: e.type,
      unit,
      fitPerCard: e.fit,
      cardsPerUnit: k,
      fitPerUnit: e.fit * k,
      persistence: e.persistence,
      flags: { replay: e.replay, process: e.process, elastic: e.elastic },
      analogue,
      confidence: 'assumed',
      derivation: analogue
        ? `RoCE analogue of the ${e.domainId} event on the UB ${unit === 'roce-switch' ? 'switch chip' : 'L1–L2 link'}: ${e.fit.toFixed(3)} FIT per card × ${k.toFixed(4)} cards per unit (CloudMatrix384 geometry) = ${(e.fit * k).toFixed(3)} FIT per ${unit === 'roce-switch' ? 'switch' : 'link'}; no public RoCE data for Ascend clusters (an unprotected Ethernet leaf is likely worse: Alibaba HPN reports 0.051 % critical ToR errors per month ≈ 708 FIT)`
        : `audited catalog ${e.id}: ${e.fit.toFixed(3)} FIT per card-hour × ${k.toFixed(4)} cards per ${unit} in one CloudMatrix384 pod (arXiv 2506.12708 §3.3) = ${(e.fit * k).toFixed(3)} FIT per ${unit}-hour`,
    });
  };
  for (const e of events) {
    const unit = DOMAIN_UNIT[e.domainId];
    if (!unit) continue;
    add(e, unit, false);
    const ro = ROCE_ANALOGUE[e.domainId];
    if (ro) add(e, ro, true);
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Scenario                                                                 */
/* ---------------------------------------------------------------------- */

export interface TopologyScenarioOptions {
  /** topology fields replacing the template's (radix, cabinet density, …) */
  topology?: Partial<Topology>;
  /** include the scale-out (RoCE / RDMA) network: switches and links with their fault types (default true) */
  scaleOut?: boolean;
  /** FIT per unit-hour by component id, replacing the library default (hard: failure, slow: sub-health, sdc: silent rate) */
  fit?: Record<string, number>;
  /** mechanisms applied on top (default: the six ReMAP defaults) */
  mechanisms?: string[];
  mechanismParameters?: Record<string, Record<string, number>>;
  id?: string;
  name?: string;
}

/** the units of a template that carry fault types */
export function templateUnits(t: TopologyTemplate, scaleOut = true): FaultUnit[] {
  const ub = t !== 'a2-roce';
  return FAULT_UNITS.filter((u) => (u === 'ub-switch' || u === 'ub-link' ? ub : u === 'roce-switch' || u === 'roce-link' ? scaleOut : true));
}

/**
 * A topology scenario: the template's topology at `npus` NPUs, one component per (fault type × unit) with its count rule, the
 * reference catalog's job settings (τ 300 s, δ 4 s, detection 95 % in 10 s else 60 s, automatic 180 s at 99 % else + 2 h, silent
 * corruption found after 120 h) and the default mechanisms applied through the library (exactly removable).
 */
export function topologyScenario(template: TopologyTemplate, npus: number, opts: TopologyScenarioOptions = {}): Scenario {
  const info = TOPOLOGY_TEMPLATES[template];
  const scaleOut = opts.scaleOut ?? true;
  const units = templateUnits(template, scaleOut);
  const topology: NonNullable<ScenarioInput['topology']> = { ...info.topology, ...(opts.topology ?? {}) } as NonNullable<ScenarioInput['topology']>;
  if (!scaleOut) delete (topology as { scaleOut?: unknown }).scaleOut;
  const lib = unitFaultLibrary().filter((f) => units.includes(f.unit));
  const N = Math.max(1, Math.round(npus));
  const components: ScenarioInput['components'] = lib.map((f) => {
    const fit = opts.fit?.[f.id] ?? f.fitPerUnit;
    const rate = fit / 1e9;
    const unitName = FAULT_UNIT_NAMES[f.unit];
    const base = {
      id: f.id,
      name: { zh: `${unitName.zh.replace(/（.*$/, '')} · ${f.domain.zh} · ${f.description.zh}`, en: `${unitName.en.replace(/ \(.*$/, '')} · ${f.domain.en} · ${f.description.en}` },
      subsystem: SUBSYSTEM[f.domainId] ?? ('other' as const),
      countRule: { per: UNIT_RULE[f.unit], factor: 1 },
    };
    const provenance = { source: f.analogue ? 'HAC-D v4 RoCE analogue of the audited catalog (review-2026-10-09)' : 'ai-cluster-reliability audited catalog (review-2026-10-09), per-unit conversion', confidence: 'assumed' as const, derivation: opts.fit?.[f.id] !== undefined ? `user value ${fit} FIT per ${f.unit}-hour (library default ${f.fitPerUnit.toFixed(3)})` : f.derivation };
    const koujing = { event: f.type === 'hard' ? 'hard_interruption' : f.type === 'slow' ? 'subhealth_entry' : 'silent_corruption', denominator: `${f.unit}_h`, level: 'job' as const };
    if (f.type === 'hard') {
      return {
        ...base,
        failure: { value: fit, unit: 'FIT' as const, koujing, provenance },
        repair: { auto: { coverage: 1, successProbability: 0.99, mttrHours: (12.5 + 180) / 3600 }, manual: { mttrHours: 2 } },
        mechanisms: { replay: f.flags.replay ? 1 : 0, process: f.flags.process ? 1 : 0, elastic: f.flags.elastic ? 1 : 0, predict: f.persistence === 'persistent' && (f.unit === 'npu' || f.unit === 'node' || f.unit === 'cpu') ? 1 : 0, netfail: ['NIC', 'OPT', 'BOXIO', 'FABRIC'].includes(f.domainId) ? 1 : 0, hotswap: f.flags.elastic ? 1 : 0 },
      };
    }
    if (f.type === 'slow') return { ...base, failure: { value: 0, unit: 'FIT' as const, provenance }, repair: { mttrHours: 1 }, subhealth: { ratePerHour: rate, durationHours: 24, performance: 0.95, escalationMultiplier: 1, policy: 'isolate' as const, detection: { probability: 0.95, delayHours: 5 / 60 } } };
    return { ...base, failure: { value: 0, unit: 'FIT' as const, provenance }, repair: { mttrHours: 1 }, sdc: { ratePerHour: rate, provenance: { ...provenance, derivation: `${provenance.derivation} (silent corruption per ${f.unit}-hour)` } } };
  });
  const s = parseScenario({
    meta: {
      id: opts.id ?? `topology-${template}`,
      name: opts.name ?? `${info.name.en} — ${N.toLocaleString('en-US')} NPUs`,
      basis: [...info.sources.map((x) => x.label), 'ai-cluster-reliability audited catalog (54 events) attached per hardware unit', 'docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §2'],
      description: `${info.summary.en}. Fault types per hardware unit: the audited catalog converted under the CloudMatrix384 geometry (FIT per unit = FIT per card × cards per unit)${scaleOut ? '; RoCE switches and links carry the UB analogues' : ''}.`,
    },
    topology,
    components,
    structure: { mode: 'template', template: 'training-series' },
    workload: { type: 'training', nGpus: N, durationDays: 30, deltaS: 4, intervalS: 300, intervalModel: 'young' },
    recovery: { mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { successProbability: 0.99, seconds: 180 }, manual: { seconds: 7200 } },
    sdc: { detection: { coverage: 0, detectSeconds: 1 }, fallbackDelayHours: 120 },
    targets: { goodput: 0.9, operational: 0.985 },
    assumptions: [
      'business-impact FIT per hardware unit (after the existing protection), converted from the audited catalog under the CloudMatrix384 geometry',
      'every hard event interrupts the synchronous job; sub-health units are isolated after detection (95 % in 5 min), silent corruption is found after 120 h unless a detector is applied',
      ...(scaleOut ? ['RoCE switches and links carry the per-unit FIT of the UB switch chip and the UB link (analogue)'] : []),
      ...info.assumed.map((k) => `${k} assumed (not public)`),
    ],
  });
  const ids = opts.mechanisms ?? DEFAULT_PLAYERS;
  return ids.length ? applyMechanisms(s, ids, opts.mechanismParameters) : s;
}

/** FIT per unit-hour of the scenario's fault types that differ from the library default (topology scenarios; read on the bare design, without the applied mechanisms) */
export function fitOverrides(s: Scenario): Record<string, number> {
  const ids = Object.keys(s.mechanisms.applied ?? {});
  const bare = ids.length ? stripMechanisms(s, ids) : s;
  const lib = new Map(unitFaultLibrary().map((f) => [f.id, f]));
  const out: Record<string, number> = {};
  for (const c of bare.components) {
    const f = lib.get(c.id);
    if (!f) continue;
    const v = f.type === 'hard' ? toPerHour(c.failure.value, c.failure.unit) * 1e9 : f.type === 'slow' ? (c.subhealth?.ratePerHour ?? 0) * 1e9 : (c.sdc?.ratePerHour ?? 0) * 1e9;
    if (Math.abs(v - f.fitPerUnit) > 1e-9 * Math.max(1, f.fitPerUnit)) out[c.id] = v;
  }
  return out;
}

/**
 * Move a topology design to another template: same NPU count, job settings (workload, recovery, silent-corruption policy, targets,
 * measures, costs, spares, hand-set chain settings), FIT edits of the fault types both templates carry and the applied mechanisms
 * (re-applied in their order with their parameters) are kept; the hardware comes from the new template.
 */
export function switchTopologyTemplate(s: Scenario, template: TopologyTemplate, opts: { id?: string; name?: string } = {}): Scenario {
  const records = Object.entries(s.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order);
  const bare = records.length ? stripMechanisms(s, records.map(([id]) => id)) : s;
  const fit = bare.topology.template ? fitOverrides(bare) : {};
  const N = bare.workload.type === 'training' ? bare.workload.nGpus : 10000;
  const scaleOut = bare.topology.template ? bare.topology.scaleOut !== undefined : true;
  const fresh = topologyScenario(template, N, { fit, mechanisms: [], scaleOut, id: opts.id ?? `topology-${template}`, name: opts.name });
  let c: Scenario = parseScenario({ ...fresh, workload: bare.workload.type === 'training' ? { ...bare.workload } : fresh.workload, recovery: bare.recovery, sdc: bare.sdc, targets: bare.targets, measures: bare.measures, costs: bare.costs, spares: bare.spares, mechanisms: { ...bare.mechanisms, applied: undefined } });
  for (const [id, rec] of records) {
    const m = mechanismById(id);
    if (m.apply) c = m.apply(c, rec.parameters);
  }
  return c;
}

/** the reference catalog as a CloudMatrix384 topology scenario without scale-out network and without mechanisms: reproduces `referenceCatalog(N)` */
export function calibrationScenario(npus: number): Scenario {
  return topologyScenario('a3-ub384', npus, { scaleOut: false, mechanisms: [] });
}

/* ---------------------------------------------------------------------- */
/* Bill of materials                                                        */
/* ---------------------------------------------------------------------- */

export interface BomRow {
  id: string;
  name: L;
  /** physical level used for grouping and the picture */
  level: 'npu' | 'node' | 'cabinet' | 'pod' | 'fabric' | 'scale-out' | 'cluster';
  count: number;
  perNpu: number;
  /** fault unit whose fault types this row carries (undefined: count only) */
  faultUnit?: FaultUnit;
  /** share of the fault unit's count on this row (L1 vs L2 chips, RoCE tiers) */
  unitShare?: number;
  /** business-impact FIT per unit by fault class (summed over the domains on the unit) */
  fit?: { hard: number; slow: number; sdc: number };
  /** job interruption rate from this row (per hour) */
  hardPerHour?: number;
  /** what one unit failure takes out */
  impact: L;
  blastRadiusNpus?: number;
  confidence: 'paper' | 'vendor' | 'derived' | 'assumed';
}

export interface TopologyBom {
  template?: TopologyTemplate;
  npus: number;
  counts: Counts;
  rows: BomRow[];
  /** hard (interruption) FIT per NPU from each fault unit, and the total */
  hardFitPerNpu: Partial<Record<FaultUnit, number>>;
  hardFitPerNpuTotal: number;
  /** job hard-interruption rate (per hour) and MTBI (hours) from the hardware alone */
  hardPerHour: number;
  notes: string[];
}

/** the hardware unit a component's fault type sits on: its catalog domain's unit when the count rule matches it, otherwise the unit its count rule counts (a per-card catalog class stays on the NPU) */
const RULE_UNIT: Partial<Record<string, FaultUnit>> = { gpu: 'npu', cpu: 'cpu', node: 'node', rack: 'cabinet', ub_switch: 'ub-switch', optical_link: 'ub-link', roce_switch: 'roce-switch', roce_link: 'roce-link' };
const unitOfComponent = (id: string, per: string): FaultUnit | undefined => {
  const d = id.replace(/@.*$/, '').replace(/-(hard|slow|sdc)$/, '');
  const u = id.includes('@roce') ? ROCE_ANALOGUE[d] : DOMAIN_UNIT[d];
  if (u && UNIT_RULE[u] === per) return u;
  return RULE_UNIT[per];
};

/** Hardware bill of materials of a scenario (any scenario; the topology templates give the richest rows). */
export function topologyBom(s: Scenario): TopologyBom {
  const counts = computeCounts(s);
  const t = s.topology;
  const sp = t.superpod;
  const so = t.scaleOut;
  const N = counts.gpus;
  // fault-unit FIT totals from the enabled components
  const fit: Partial<Record<FaultUnit, { hard: number; slow: number; sdc: number }>> = {};
  for (const c of s.components) {
    if (!c.enabled) continue;
    const u = unitOfComponent(c.id, c.countRule.per);
    if (!u) continue;
    const f = (fit[u] ??= { hard: 0, slow: 0, sdc: 0 });
    const perUnit = (x: number) => x * 1e9 * (c.countRule.per === 'fixed' ? 0 : c.countRule.factor);
    f.hard += perUnit(toPerHour(c.failure.value, c.failure.unit));
    f.slow += perUnit(c.subhealth?.ratePerHour ?? 0);
    f.sdc += perUnit(c.sdc?.ratePerHour ?? 0);
  }
  const unitCount: Record<FaultUnit, number> = { npu: N, job: N, cpu: counts.cpus, node: counts.nodes, cabinet: counts.racks, 'ub-switch': counts.ubSwitches, 'ub-link': counts.opticalLinks, 'roce-switch': counts.scaleOutSwitches, 'roce-link': counts.scaleOutLinks };
  const rows: BomRow[] = [];
  const row = (r: Omit<BomRow, 'perNpu' | 'fit' | 'hardPerHour'>) => {
    const f = r.faultUnit ? fit[r.faultUnit] : undefined;
    rows.push({ ...r, perNpu: N > 0 ? r.count / N : 0, fit: f, hardPerHour: f ? (f.hard * 1e-9) * r.count : undefined });
  };
  const nodeName: L = t.template === 'a2-roce' ? { zh: '服务器（Atlas 800T A2）', en: 'Server (Atlas 800T A2)' } : sp ? { zh: '计算节点', en: 'Compute node' } : { zh: '服务器 / 节点', en: 'Server / node' };
  const chip = t.template ? TOPOLOGY_TEMPLATES[t.template].chip : undefined;
  row({ id: 'npu', name: chip ? { zh: `NPU（${chip}）`, en: `NPU (${chip})` } : { zh: 'NPU / 加速卡', en: 'NPU / accelerator card' }, level: 'npu', count: N, faultUnit: 'npu', impact: { zh: '1 张卡；同步作业中断', en: 'one card; the synchronous job stops' }, blastRadiusNpus: 1, confidence: 'paper' });
  row({ id: 'job', name: FAULT_UNIT_NAMES.job, level: 'cluster', count: N, faultUnit: 'job', impact: { zh: '整个作业：共享存储、软件、未归因（按 NPU·h 口径）', en: 'the whole job: shared storage, software, unattributed (per NPU-hour 口径)' }, blastRadiusNpus: N, confidence: 'assumed' });
  row({ id: 'node', name: { zh: `${nodeName.zh} · ${counts.gpusPerNode} NPU`, en: `${nodeName.en} · ${counts.gpusPerNode} NPUs` }, level: 'node', count: counts.nodes, faultUnit: 'node', impact: { zh: `1 个节点（${counts.gpusPerNode} NPU）`, en: `one node (${counts.gpusPerNode} NPUs)` }, blastRadiusNpus: counts.gpusPerNode, confidence: t.template === 'a950-ub2' ? 'assumed' : 'vendor' });
  if (counts.cpus > 0) row({ id: 'cpu', name: FAULT_UNIT_NAMES.cpu, level: 'node', count: counts.cpus, faultUnit: 'cpu', impact: { zh: `所在节点（${counts.gpusPerNode} NPU）`, en: `its node (${counts.gpusPerNode} NPUs)` }, blastRadiusNpus: counts.gpusPerNode, confidence: t.template === 'a950-ub2' ? 'assumed' : 'vendor' });
  if (sp) row({ id: 'qingtian', name: { zh: '擎天卡（VPC 面）', en: 'Qingtian card (VPC plane)' }, level: 'node', count: counts.nodes * sp.vpcNicsPerNode, impact: { zh: '存储 / 管理通路（故障在 MGMT、STORAGE 类中）', en: 'storage / management path (faults inside MGMT, STORAGE)' }, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
  const perCab = counts.gpusPerNode * counts.nodesPerRack;
  row({ id: 'cabinet', name: { zh: `计算机柜（${counts.nodesPerRack} 节点 · ${perCab} NPU）`, en: `Compute cabinet (${counts.nodesPerRack} nodes · ${perCab} NPUs)` }, level: 'cabinet', count: counts.racks, faultUnit: 'cabinet', impact: { zh: `1 个机柜（${perCab} NPU）`, en: `one cabinet (${perCab} NPUs)` }, blastRadiusNpus: perCab, confidence: t.template === 'a2-roce' ? 'derived' : t.template === 'a950-ub2' ? 'vendor' : 'paper' });
  if (sp) {
    const podNpus = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
    row({ id: 'pod', name: { zh: `超节点（${podNpus.toLocaleString('en-US')} NPU）`, en: `SuperPoD (${podNpus.toLocaleString('en-US')} NPUs)` }, level: 'pod', count: counts.supernodes, impact: { zh: '一个 UB scale-up 域', en: 'one UB scale-up domain' }, blastRadiusNpus: podNpus, confidence: t.template === 'a3-ub384' ? 'paper' : 'vendor' });
    row({ id: 'commCabinet', name: { zh: '通信机柜（L2 交换）', en: 'Communication cabinet (L2 switching)' }, level: 'pod', count: counts.commRacks, impact: { zh: `约 ${Math.round((sp.subPlanes * sp.l2PerSubPlane) / Math.max(1, sp.commRacks))} 片 L2 的共因（故障在 FABRIC 类中）`, en: `common cause for ≈ ${Math.round((sp.subPlanes * sp.l2PerSubPlane) / Math.max(1, sp.commRacks))} L2 chips (faults inside FABRIC)` }, confidence: t.template === 'a3-ub384' ? 'paper' : 'vendor' });
    const ubShare = counts.ubSwitches > 0 ? counts.l1Switches / counts.ubSwitches : 0;
    row({ id: 'ubL1', name: { zh: `UB L1 交换芯片（每节点 ${sp.l1PerNode}）`, en: `UB L1 switch chip (${sp.l1PerNode} per node)` }, level: 'fabric', count: counts.l1Switches, faultUnit: 'ub-switch', unitShare: ubShare, impact: { zh: `1 个节点在 1 个子平面的上联（1/${sp.subPlanes}）`, en: `one node's uplinks in one sub-plane (1/${sp.subPlanes})` }, blastRadiusNpus: counts.gpusPerNode, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
    row({ id: 'ubL2', name: { zh: `UB L2 交换芯片（${sp.subPlanes} 子平面）`, en: `UB L2 switch chip (${sp.subPlanes} sub-planes)` }, level: 'fabric', count: counts.l2Switches, faultUnit: 'ub-switch', unitShare: 1 - ubShare, impact: { zh: `1 个子平面内每节点 1 条链路（${sp.l2Ports} 口）`, en: `one link per node in one sub-plane (${sp.l2Ports} ports)` }, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
    row({ id: 'ubLink', name: { zh: `UB 光链路 L1–L2（每 L1 ${sp.linksPerL1} 条）`, en: `UB optical link L1–L2 (${sp.linksPerL1} per L1 chip)` }, level: 'fabric', count: counts.opticalLinks, faultUnit: 'ub-link', impact: { zh: `1 条上联（每节点 ${sp.l1PerNode * sp.linksPerL1} 条之一）`, en: `one uplink (of ${sp.l1PerNode * sp.linksPerL1} per node)` }, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
    row({ id: 'ubTransceiver', name: { zh: 'UB 光模块（链路两端）', en: 'UB transceiver (both link ends)' }, level: 'fabric', count: counts.transceivers, impact: { zh: '计入所在链路（OPT 类）', en: 'counted with its link (OPT)' }, confidence: 'assumed' });
  }
  if (so) {
    // tiers are named by index: the role of tier k (spine, aggregation, core) depends on the tier count, which changes with N, and the
    // bill of materials shows several sizes side by side (10k needs three tiers at radix 64, 100k and beyond four)
    const tierName = (i: number): L => (i === 0 ? { zh: 'RoCE 叶交换机（第 1 层）', en: 'RoCE leaf switch (tier 1)' } : { zh: `RoCE 交换机（第 ${i + 1} 层）`, en: `RoCE switch (tier ${i + 1})` });
    const label = sp ? { zh: 'RDMA 口（scale-out，每 NPU ' + so.portsPerNpu + ' 个）', en: `RDMA port (scale-out, ${so.portsPerNpu} per NPU)` } : { zh: `RoCE 口（200GE，每 NPU ${so.portsPerNpu} 个）`, en: `RoCE port (200GE, ${so.portsPerNpu} per NPU)` };
    row({ id: 'rocePort', name: label, level: 'scale-out', count: counts.scaleOutPorts, impact: { zh: '故障计入 NPU 的 NIC 类', en: 'faults counted in the NPU NIC class' }, confidence: t.template === 'a950-ub2' ? 'assumed' : t.template === 'a3-ub384' ? 'paper' : 'vendor' });
    const down = Math.max(1, Math.floor((so.radix * so.oversubscription) / (1 + so.oversubscription)));
    counts.scaleOutPerTier.forEach((n, i) => row({ id: `roceTier${i + 1}`, name: { zh: `${tierName(i).zh.replace(/）$/, '')}，${so.radix} 口）`, en: `${tierName(i).en.replace(/\)$/, '')}, ${so.radix} ports)` }, level: 'scale-out', count: n, faultUnit: 'roce-switch', unitShare: counts.scaleOutSwitches > 0 ? n / counts.scaleOutSwitches : 0, impact: i === 0 ? { zh: `${down} 个 NPU 口`, en: `${down} NPU ports` } : { zh: `上联带宽的 1/${Math.round(so.radix / 2)}（ECMP）`, en: `1/${Math.round(so.radix / 2)} of the uplink bandwidth (ECMP)` }, blastRadiusNpus: i === 0 ? Math.ceil(down / so.portsPerNpu) : undefined, confidence: 'assumed' }));
    row({ id: 'roceLink', name: { zh: 'RoCE 光链路（NPU–叶 + 层间）', en: 'RoCE optical link (NPU–leaf + inter-tier)' }, level: 'scale-out', count: counts.scaleOutLinks, faultUnit: 'roce-link', impact: { zh: '1 个 NPU 口或 1 条上联', en: 'one NPU port or one uplink' }, confidence: 'assumed' });
    row({ id: 'roceTransceiver', name: { zh: 'RoCE 光模块（链路两端）', en: 'RoCE transceiver (both link ends)' }, level: 'scale-out', count: counts.scaleOutTransceivers, impact: { zh: '计入所在链路', en: 'counted with its link' }, confidence: 'assumed' });
  }
  const hardFitPerNpu: Partial<Record<FaultUnit, number>> = {};
  let hardPerHour = 0;
  for (const u of FAULT_UNITS) {
    const f = fit[u];
    if (!f || unitCount[u] === 0) continue;
    const perHour = f.hard * 1e-9 * unitCount[u];
    hardPerHour += perHour;
    hardFitPerNpu[u] = N > 0 ? (perHour / N) * 1e9 : 0;
  }
  const notes: string[] = [];
  if (sp && t.fabricFill === 'proportional' && counts.nodes % (sp.nodesPerRack * sp.computeRacks) !== 0) notes.push('the last SuperPoD is partly populated: its L2 chips and communication cabinets follow the populated nodes (port-count fill; parallel L1–L2 links allowed)');
  if (sp && t.fabricFill === 'full-pod' && counts.nodes % (sp.nodesPerRack * sp.computeRacks) !== 0) notes.push('full-pod fill: the last, partly populated SuperPoD counts its whole L2 tier and all communication cabinets');
  if (so) notes.push(`scale-out Clos: ${counts.scaleOutTiers} tier(s) for ${counts.scaleOutPorts.toLocaleString('en-US')} ports at radix ${so.radix}${so.oversubscription > 1 ? `, ${so.oversubscription}:1 at the leaves` : ', non-blocking'} (assumed)`);
  return { template: t.template, npus: N, counts, rows, hardFitPerNpu, hardFitPerNpuTotal: N > 0 ? (hardPerHour / N) * 1e9 : 0, hardPerHour, notes };
}

/**
 * Rows of several sizes' bills of materials as one table: the current size's rows, then the rows that exist only at other sizes
 * (e.g. a fourth Clos tier from 100,000 NPUs at radix 64) inserted after their predecessor with count 0 at the current size.
 */
export function bomRowsAcross(current: TopologyBom, at: { npus: number; bom: TopologyBom }[]): BomRow[] {
  const out = [...current.rows];
  for (const z of at) {
    z.bom.rows.forEach((r, k) => {
      if (out.some((q) => q.id === r.id)) return;
      const prev = k > 0 ? out.findIndex((q) => q.id === z.bom.rows[k - 1].id) : -1;
      out.splice(prev + 1, 0, { ...r, count: 0, perNpu: 0, hardPerHour: 0 });
    });
  }
  return out;
}

/** counts and hardware interruption FIT per NPU of a scenario at several sizes (the topology page's 10k / 100k / 200k / 500k columns) */
export function bomAtSizes(s: Scenario, sizes: number[] = TOPOLOGY_SCALES): { npus: number; bom: TopologyBom }[] {
  return sizes.map((n) => ({ npus: n, bom: topologyBom(withSize(s, n)) }));
}

/**
 * A scenario at another NPU count: every topology count follows the template geometry (`withSize`), and a generated name
 * "… — N NPUs" follows the size (user-chosen names stay). Used by the topology page's scale chips, `hacd example --npus` and MCP.
 */
export function resizeTopology(s: Scenario, n: number): Scenario {
  const c = withSize(s, n);
  const N = Math.max(1, Math.round(n));
  return { ...c, meta: { ...c.meta, name: c.meta.name.replace(/ — [\d,]+ NPUs$/, ` — ${N.toLocaleString('en-US')} NPUs`) } };
}

/** v4 built-in examples: the three topology templates at the first built-in scale (10,000 NPUs) with the six default mechanisms — the whole example registry; the scale is a parameter (`resizeTopology`) */
export const TOPOLOGY_EXAMPLES: Record<string, () => Scenario> = {
  'topology-a3-ub384': () => topologyScenario('a3-ub384', TOPOLOGY_SCALES[0]),
  'topology-a2-roce': () => topologyScenario('a2-roce', TOPOLOGY_SCALES[0]),
  'topology-a950-ub2': () => topologyScenario('a950-ub2', TOPOLOGY_SCALES[0]),
};
// the shared example registry is exactly the topology templates (registered here because the scenario module cannot import the topology module)
Object.assign(EXAMPLES, TOPOLOGY_EXAMPLES);
