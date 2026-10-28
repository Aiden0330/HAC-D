/**
 * v4 topology templates (docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §2): three typical Ascend cluster topologies turned into a hardware
 * bill of materials and a scenario whose fault types sit on the hardware units, so that the topology changes the job's
 * interruption rate.
 *
 *  - `a2-roce`  · A2: Atlas 800T A2 servers (8 × 910B, 4 × Kunpeng 920, 8 × 200GE RoCE ports direct from the NPUs), 8 servers per
 *                 Atlas 900 A2 PoD cabinet, RoCE folded Clos (radix and oversubscription assumed).
 *  - `a3-ub384` · A3 / CloudMatrix384: 48 nodes × (8 NPU + 4 CPU + 7 L1 UB chips), 12 compute + 4 communication cabinets,
 *                 7 sub-planes × 16 L2 chips (arXiv 2506.12708 §3.3), RDMA scale-out plane (Clos assumed).
 *  - `a950-ub2` · Atlas 950 SuperPoD to the product-page spec: 1,024 NPUs in 16 compute + 4 UB interconnect cabinets, 64 NPUs + 16 CPUs per
 *                 compute cabinet (vendor); v4.2 fabric selectable: 'mesh-clos' (default: in-cabinet 2D full mesh with 72 low-radix UB
 *                 switches, 2 × 800G optical links per NPU into one tier of 100 Tb/s UB switches — Hot Chips 2025 8K reference design
 *                 and the analyst's inspection of the shipped machine), 'mesh-4d' (UB-Mesh paper) or 'two-level' (CloudMatrix384 copy);
 *                 the roadmap 8,192-NPU pod (128 + 32 cabinets) via the atlas950-8k preset; SuperCluster scale-out over 2 × 400G
 *                 UBoE per NPU as two planes of a three-tier Clos of 128-port switches (128³ / 4 = 524,288 per plane; assumed).
 *  - `a960e-ub` · Atlas 960E SuperPoD (HUAWEI CONNECT 2026): 4,096 NPUs (vendor), 56 + 14 cabinets with 72 NPUs + 18 CPUs per cabinet
 *                 (one media source; 4,032 NPUs per pod), in-cabinet LinkBlade and cross-cabinet LinkDevices (176 × 1.6 Tb/s),
 *                 NPO optics; scale-out two-tier, four-plane Clos to 512,000 NPUs (vendor) with radix 1,024 (assumed).
 *
 * Fault types: the 54 events of the audited reference catalog state a business-impact FIT per card-hour. Each event is attached to
 * the hardware unit it belongs to and converted under the CloudMatrix384 geometry, where the catalog and the paper's unit counts
 * agree: FIT_unit = FIT_card × 384 / (units in one 384-NPU pod). A CloudMatrix384 cluster without scale-out network therefore
 * reproduces the catalog exactly; A2 and Atlas 950 change the rate through their hardware mix. RoCE switches and links carry the
 * per-unit FIT of the UB switch chip and the UB link (analogue, assumed). Every value keeps its 口径 (business-impact events per
 * unit-hour) and its provenance.
 */
import { parseScenario, SUPERPOD_PRESETS, type Scenario, type ScenarioInput, type Topology, type Superpod } from '../scenario/schema.js';
import { REFERENCE_EVENTS, type ReferenceEvent } from '../scenario/referenceEvents.js';
import { EXAMPLES } from '../scenario/examples.js';
import { computeCounts, geometryCounts, resolveCountOverrides, componentInstances, withoutSuperpodOverrides, COUNT_OVERRIDE_ROWS, type Counts } from '../scenario/build.js';
import { applyMechanisms, stripMechanisms, mechanismById, DEFAULT_PLAYERS } from '../mechanisms/index.js';
import { toPerHour } from '../units/index.js';
import { withSize } from '../study/index.js';

export type TopologyTemplate = 'a2-roce' | 'a3-ub384' | 'a950-ub2' | 'a960e-ub' | 'ub-generic';
export const TOPOLOGY_TEMPLATE_IDS: TopologyTemplate[] = ['a2-roce', 'a3-ub384', 'a950-ub2', 'a960e-ub', 'ub-generic'];
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
  'ub-switch': { zh: 'UB 交换芯片（L1 + L2，或柜内 + 超节点层）', en: 'UB switch chip (L1 + L2, or in-cabinet + pod tier)' },
  'ub-link': { zh: 'UB 光链路（L1–L2 或柜–交换；NPO 按 800G 等效）', en: 'UB optical link (L1–L2 or cabinet–switch; NPO as 800G equivalents)' },
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
    name: { zh: 'Atlas 950 · 灵衢 UB 2.0 超节点', en: 'Atlas 950 · UB 2.0 SuperPoD' },
    chip: 'Ascend 950DT',
    scaleUpNpus: 1024,
    podNpus: 1024,
    summary: { zh: '产品页现行规格（真机 WAIC 2026 展示，交付数量未公布）：16 计算柜 + 4 灵衢互联柜、1,024 NPU；每计算柜 64 NPU（8 托盘 × 8）+ 16 颗鲲鹏 950；柜内 2D 全互联（72 片低阶 UB 交换），每 NPU 2 条 800G 光链路上联一层 100 Tb/s UB 交换（Clos）；8,192 NPU（128 + 32 柜）为路线图上限；超节点之间每 NPU 2 × 400G UBoE（两平面，假设）', en: 'Product-page spec (machine shown at WAIC 2026, delivery volume undisclosed): 16 compute + 4 UB interconnect cabinets, 1,024 NPUs; 64 NPUs (8 trays × 8) + 16 Kunpeng 950 per compute cabinet; in-cabinet 2D full mesh (72 low-radix UB switches), 2 × 800G optical links per NPU up to one tier of 100 Tb/s UB switches (Clos); 8,192 NPUs (128 + 32 cabinets) is the roadmap maximum; 2 × 400G UBoE per NPU between SuperPoDs (two planes, assumed)' },
    topology: { gpusPerNode: 8, nodesPerRack: 8, racksPerZone: 20, nvlinkDomainGpus: 1024, networkPlanes: 1, superpod: { ...SUPERPOD_PRESETS['atlas950-1k'].values }, template: 'a950-ub2', fabricFill: 'proportional', scaleOut: { portsPerNpu: 2, planes: 2, radix: 128, oversubscription: 1, transceiversPerLink: 2 } },
    assumed: [...SUPERPOD_PRESETS['atlas950-1k'].assumed.map((k) => `superpod.${k}`), 'scaleOut.planes', 'scaleOut.radix', 'scaleOut.oversubscription', 'scaleOut.transceiversPerLink'],
    sources: [
      { label: 'Huawei Atlas 950 SuperPoD product page (zh / en, read 2026-10-19)', url: 'https://www.hiascend.com/hardware/cluster', confidence: 'vendor', note: { zh: '16 计算柜 + 4 灵衢互联柜；≤ 1,024 NPU、256 颗鲲鹏 950；每 NPU 1.68 TB/s UB；2+2 光路保护；计算柜约 100 kW', en: '16 compute + 4 UB interconnect cabinets; ≤ 1,024 NPUs, 256 Kunpeng 950; 1.68 TB/s UB per NPU; 2+2 optical path protection; about 100 kW per compute cabinet' } },
      { label: 'LightCounting newsletter 2026-07-21 (WAIC 2026 machine)', url: 'https://www.lightcounting.com/newsletter/en/july-2026-atlas-950-superpod-achieve', confidence: 'derived', note: { zh: '每计算柜 8 个 NPU 托盘 + 8 个 CPU 托盘；每计算柜 128 个 800G OSFP；整机 4,096 个 800G LPO（含交换侧）；全局光 Clos（分析师观察）', en: '8 NPU trays + 8 CPU trays per compute cabinet; 128 × 800G OSFP per compute cabinet; 4,096 × 800G LPO incl. the switch side; global optical Clos (analyst observation)' } },
      { label: 'Hot Chips 2025, H. Liao, UB-Mesh slides 9–11', url: 'https://hc2025.hotchips.org/assets/program/conference/day2/67_Huawei_Liao_final.pdf', confidence: 'vendor', note: { zh: '8K 参考设计：每柜 64 + 1 NPU、16 CPU；128 台 100T UB 交换的一层 Clos（LPO 光）', en: '8K reference design: 64 + 1 NPUs and 16 CPUs per rack; one-tier Clos of 128 × 100T UB switches (LPO optics)' } },
      { label: 'UB-Mesh, arXiv 2503.20377 §3.3, §6.6', url: 'https://arxiv.org/abs/2503.20377', confidence: 'paper', note: { zh: '柜内 8 × 8 2D 全互联、每柜 72 片 LRS（4 平面 × 18）；4D 全互联与 HRS 变体；网络 MTBF 98.5 h（UB-Mesh）对 13.8 h（Clos）', en: 'in-rack 8 × 8 2D full mesh, 72 LRS per rack (4 planes × 18); 4D full mesh and HRS variant; network MTBF 98.5 h (UB-Mesh) vs 13.8 h (Clos)' } },
      { label: 'HUAWEI CONNECT 2025 keynote (Eric Xu) and press release', url: 'https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech', confidence: 'vendor', note: { zh: '8,192 NPU、128 + 32 柜、柜间全光、2026Q4（路线图）；SuperCluster = 64 个超节点、UBoE 或 RoCE', en: '8,192 NPUs, 128 + 32 cabinets, all-optical between cabinets, Q4 2026 (roadmap); SuperCluster = 64 SuperPoDs over UBoE or RoCE' } },
      { label: 'Ascend 950 NPU architecture white paper (2026)', url: 'https://public-download.obs.cn-east-2.myhuaweicloud.com/ascend/%E6%98%87%E8%85%BE950%20NPU%E6%9E%B6%E6%9E%84%E7%99%BD%E7%9A%AE%E4%B9%A6.pdf', confidence: 'vendor', note: { zh: '每芯片 18 个 x4 UB 口（112 Gb/s/lane）与 2 × 400G UBoE（与 UB 口静态复用）；Clos、Full-Mesh + Clos、nD-Mesh 可选', en: '18 x4 UB ports per chip (112 Gb/s per lane) and 2 × 400G UBoE (statically multiplexed with UB ports); Clos, Full-Mesh + Clos and nD-Mesh selectable' } },
      { label: 'Scale-out between SuperPoDs', confidence: 'assumed', note: { zh: '两平面（每 NPU 每平面 1 × 400G）、128 口交换机的三层 Clos（128³/4 = 524,288 = 64 × 8,192）、无收敛：平面数、层数与交换机型号均未公开', en: 'two planes (1 × 400G per NPU per plane), three-tier Clos of 128-port switches (128³ / 4 = 524,288 = 64 × 8,192), non-blocking: planes, tiers and switch model not public' } },
    ],
  },
  'a960e-ub': {
    id: 'a960e-ub',
    name: { zh: 'Atlas 960E · NPO 光互联超节点', en: 'Atlas 960E · NPO SuperPoD' },
    chip: 'Ascend 960',
    scaleUpNpus: 4032,
    podNpus: 4032,
    summary: { zh: '标称 4,096 NPU；按单一媒体口径 56 计算柜 + 14 灵衢互联柜，每柜 72 NPU（9 刀片 × 8）+ 18 颗鲲鹏（合 4,032；“一组柜内交换刀片互联 72 昇腾 + 18 鲲鹏”按一柜理解，为推断）；柜内 LinkBlade、跨柜 LinkDevice（176 × 1.6 Tb/s）；NPO 光引擎 Hi-ONE（5,500 个替代 48,000 个 800G 模块）；超节点之间两层四平面 Clos 至 51.2 万 NPU', en: 'Nominal 4,096 NPUs; from one media source 56 compute + 14 UB interconnect cabinets with 72 NPUs (9 blades × 8) + 18 Kunpeng per cabinet (4,032; the article says the in-cabinet switch blades interconnect 72 Ascend + 18 Kunpeng, read here as one cabinet, an inference); in-cabinet LinkBlade, cross-cabinet LinkDevices (176 × 1.6 Tb/s); NPO optics (5,500 Hi-ONE engines replacing 48,000 × 800G modules); two-tier, four-plane Clos between SuperPoDs to 512,000 NPUs' },
    topology: { gpusPerNode: 8, nodesPerRack: 9, racksPerZone: 70, nvlinkDomainGpus: 4032, networkPlanes: 4, superpod: { ...SUPERPOD_PRESETS.atlas960e.values }, template: 'a960e-ub', fabricFill: 'proportional', scaleOut: { portsPerNpu: 4, planes: 4, radix: 1024, oversubscription: 1, transceiversPerLink: 2 } },
    assumed: [...SUPERPOD_PRESETS.atlas960e.assumed.map((k) => `superpod.${k}`), 'scaleOut.portsPerNpu', 'scaleOut.radix', 'scaleOut.oversubscription', 'scaleOut.transceiversPerLink'],
    sources: [
      { label: 'Huawei, Atlas 960E SuperPoD release (HUAWEI CONNECT 2026-09-17)', url: 'https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode', confidence: 'vendor', note: { zh: '4,096 NPU、正交全液冷、5,500 个 Hi-ONE NPO 光引擎（7.2 Tb/s）替代 48,000 个 800G 模块；两层四平面 Clos 至 51.2 万；系统可用度 99.8 %（口径未定义）', en: '4,096 NPUs, orthogonal full liquid cooling, 5,500 Hi-ONE NPO engines (7.2 Tb/s) replacing 48,000 × 800G modules; two-tier four-plane Clos to 512,000; 99.8 % system availability (definition not given)' } },
      { label: 'Huawei UnifiedBus release (HUAWEI CONNECT 2026-09-17)', confidence: 'vendor', note: { zh: '柜内 LinkBlade（无线缆）、跨柜 LinkDevice 176 口 × 1.6 Tb/s（RTT ≤ 2 µs）、UBG 交换机最大 1,024 口', en: 'in-cabinet LinkBlade (cableless), cross-cabinet LinkDevice 176 ports × 1.6 Tb/s (RTT ≤ 2 µs), UBG switch radix up to 1,024' } },
      { label: '智东西 2026-09-19', confidence: 'scan-level', note: { zh: '56 计算柜 + 14 互联柜；柜内交换刀片互联 72 昇腾 + 18 鲲鹏（按每柜理解为推断）；计算刀片 8 NPU（单一媒体来源，56 × 72 = 4,032 ≠ 4,096；同文把每超节点省 196 km 铜缆误作每柜）', en: '56 compute + 14 interconnect cabinets; in-cabinet switch blades interconnect 72 Ascend + 18 Kunpeng (read per cabinet, an inference); 8-NPU compute blades (single media source; 56 × 72 = 4,032 ≠ 4,096; the same article puts the 196 km copper saving per cabinet instead of per SuperPoD)' } },
      { label: 'Fabric counts', confidence: 'assumed', note: { zh: '每 NPU 5.5 个 LinkDevice 口（2.2 TB/s ÷ 2 ÷ 1.6 Tb/s）→ 每 4,032 NPU 126 台 LinkDevice（每互联柜 9 台）；每柜 5 片 LinkBlade 交换芯片；每 NPU 4 个 scale-out 口、每平面 1 个、1,024 口交换机', en: '5.5 LinkDevice ports per NPU (2.2 TB/s ÷ 2 ÷ 1.6 Tb/s) → 126 LinkDevices per 4,032 NPUs (9 per interconnect cabinet); 5 LinkBlade switch chips per cabinet; 4 scale-out ports per NPU, one per plane, 1,024-port switches' } },
    ],
  },
  // v5.4 the record-defined template: for SuperPoDs that are not public products. The record or worksheet gives every geometry
  // value (any of the four UB fabric kinds), its own names, sources and assumptions; this entry only carries the placeholder
  // default so that the template works on the page, and the unit library of a UB SuperPoD with a scale-out network.
  'ub-generic': {
    id: 'ub-generic',
    name: { zh: '通用 UB 超节点（由记录定义）', en: 'Generic UB SuperPoD (record-defined)' },
    chip: 'Ascend',
    scaleUpNpus: 1024,
    podNpus: 1024,
    summary: { zh: '非公开产品的超节点模板：几何（四种 UB 互联形态之一：两级 L1/L2、柜内全互联 + 光 Clos、UB-Mesh 4D、LinkBlade + LinkDevice）、名称、来源与假设全部来自拓扑记录 / 工作表；页面上的默认几何只是占位——1,024 NPU、16 计算柜 + 4 通信柜、每柜 8 节点 × 8 NPU、两级 L1/L2，全部标为 assumed', en: 'The template for SuperPoDs that are not public products: geometry (any of the four UB fabric kinds — two-level L1/L2, cabinet mesh + optical Clos, UB-Mesh 4D, LinkBlade + LinkDevice), names, sources and assumptions all come from the topology record or worksheet; the default on the page is a placeholder — 1,024 NPUs, 16 compute + 4 communication cabinets, 8 nodes × 8 NPUs per cabinet, two-level L1/L2, every value assumed' },
    topology: { gpusPerNode: 8, nodesPerRack: 8, racksPerZone: 20, nvlinkDomainGpus: 1024, networkPlanes: 2, superpod: { ...SUPERPOD_PRESETS['ub-generic'].values }, template: 'ub-generic', fabricFill: 'proportional', scaleOut: { portsPerNpu: 2, planes: 2, radix: 128, oversubscription: 1, transceiversPerLink: 2 } },
    assumed: [...SUPERPOD_PRESETS['ub-generic'].assumed.map((k) => `superpod.${k}`), 'scaleOut.portsPerNpu', 'scaleOut.planes', 'scaleOut.radix', 'scaleOut.oversubscription', 'scaleOut.transceiversPerLink'],
    sources: [
      { label: 'Record-defined geometry (HAC-D v5.4)', confidence: 'assumed', note: { zh: '本模板没有公开产品来源：几何、名称与来源来自拓扑记录 / 工作表的出处字段（v6 ingest）；默认几何为占位，用记录替换后 Findings 报告的叠加图按记录的几何与标签绘制', en: 'No public product behind this template: geometry, names and sources come from the topology record / worksheet provenance (v6 ingest); the default geometry is a placeholder, and once a record replaces it the Findings overlay is drawn from the record’s geometry and labels' } },
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
  /** catalog scope of the event (card, server, rack, zone, job …): with `persistence` it decides the predictor's applicability, as in the catalog scenario */
  scope: string;
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
      scope: e.scope,
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

/** the units of a template that carry fault types (every SuperPoD template has UB switches and UB optical links) */
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
    const unitName = faultUnitName(f.unit, template);
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
        // predict: the catalog rule (catalogScenario) — persistent faults of card or server scope; v5.5 by the event's scope, not its
        // fault unit, so BOXIO-hard (unit node, scope rack) is not predictable here either (fourth review R2)
        mechanisms: { replay: f.flags.replay ? 1 : 0, process: f.flags.process ? 1 : 0, elastic: f.flags.elastic ? 1 : 0, predict: f.persistence === 'persistent' && (f.scope === 'card' || f.scope === 'server') ? 1 : 0, netfail: ['NIC', 'OPT', 'BOXIO', 'FABRIC'].includes(f.domainId) ? 1 : 0, hotswap: f.flags.elastic ? 1 : 0 },
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
      description: `${info.summary.en}. Fault types per hardware unit: the audited catalog converted under the CloudMatrix384 geometry (FIT per unit = FIT per card × cards per unit)${scaleOut ? `; ${template === 'a950-ub2' || template === 'a960e-ub' || template === 'ub-generic' ? 'UBoE / RoCE' : 'RoCE'} switches and links carry the UB analogues` : ''}.`,
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
  /** 'user' when the count is a user override (topology.countOverrides) */
  confidence: 'paper' | 'vendor' | 'derived' | 'assumed' | 'user';
  /** v4.3 the geometry count when a user override replaces it */
  geometryCount?: number;
  /** v4.3 the user may override this row's count (COUNT_OVERRIDE_ROWS or a scale-out tier) */
  overridable?: boolean;
  /** v4.3 a rate-only row (classes counted on different kinds of units): no unit count to show */
  noCount?: boolean;
}

export interface TopologyBom {
  template?: TopologyTemplate;
  npus: number;
  counts: Counts;
  rows: BomRow[];
  /** hard (interruption) FIT per NPU from each fault unit, and the total */
  hardFitPerNpu: Partial<Record<FaultUnit, number>>;
  hardFitPerNpuTotal: number;
  /** v4.3 FIT per NPU of the classes counted outside the template units (the 'Other components' row); part of the total */
  hardFitPerNpuOther: number;
  /** job hard-interruption rate (per hour) and MTBI (hours) from the hardware alone */
  hardPerHour: number;
  /** v4.3 user counts in effect and those that do not apply here */
  countOverrides: { applied: { id: string; geometry: number; count: number; tier?: number }[]; ignored: { id: string; reason: string }[] };
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

/** direct NPU–NPU links of one compute cabinet's 2D full mesh (trays × NPUs per tray) */
const meshLinksPerCabinet = (sp: NonNullable<Scenario['topology']['superpod']>) => sp.nodesPerRack * ((sp.npusPerNode * (sp.npusPerNode - 1)) / 2) + sp.npusPerNode * ((sp.nodesPerRack * (sp.nodesPerRack - 1)) / 2);

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
  const nodeName: L = t.template === 'a2-roce' ? { zh: '服务器（Atlas 800T A2）', en: 'Server (Atlas 800T A2)' } : sp?.fabric === 'blade-clos' ? { zh: '计算刀片', en: 'Compute blade' } : sp && sp.fabric !== 'two-level' ? { zh: 'NPU 托盘（含 CPU 托盘份额）', en: 'NPU tray (with its CPU-tray share)' } : sp ? { zh: '计算节点', en: 'Compute node' } : { zh: '服务器 / 节点', en: 'Server / node' };
  const vendorish = (x: TopologyTemplate | undefined) => (x === 'a950-ub2' || x === 'a960e-ub' || x === 'ub-generic' ? 'assumed' : 'vendor');
  const chip = t.template ? TOPOLOGY_TEMPLATES[t.template].chip : undefined;
  row({ id: 'npu', name: chip ? { zh: `NPU（${chip}）`, en: `NPU (${chip})` } : { zh: 'NPU / 加速卡', en: 'NPU / accelerator card' }, level: 'npu', count: N, faultUnit: 'npu', impact: { zh: '1 张卡；同步作业中断', en: 'one card; the synchronous job stops' }, blastRadiusNpus: 1, confidence: 'paper' });
  row({ id: 'job', name: FAULT_UNIT_NAMES.job, level: 'cluster', count: N, faultUnit: 'job', impact: { zh: '整个作业：共享存储、软件、未归因（按 NPU·h 口径）', en: 'the whole job: shared storage, software, unattributed (per NPU-hour 口径)' }, blastRadiusNpus: N, confidence: 'assumed' });
  row({ id: 'node', name: { zh: `${nodeName.zh} · ${counts.gpusPerNode} NPU`, en: `${nodeName.en} · ${counts.gpusPerNode} NPUs` }, level: 'node', count: counts.nodes, faultUnit: 'node', impact: { zh: `1 个节点（${counts.gpusPerNode} NPU）`, en: `one node (${counts.gpusPerNode} NPUs)` }, blastRadiusNpus: counts.gpusPerNode, confidence: vendorish(t.template) });
  const userRow = (id: string) => t.countOverrides?.[id] !== undefined;
  if (counts.cpus > 0 || userRow('cpu')) row({ id: 'cpu', name: FAULT_UNIT_NAMES.cpu, level: 'node', count: counts.cpus, faultUnit: 'cpu', impact: { zh: `所在节点（${counts.gpusPerNode} NPU）`, en: `its node (${counts.gpusPerNode} NPUs)` }, blastRadiusNpus: counts.gpusPerNode, confidence: t.template === 'a950-ub2' ? 'vendor' : vendorish(t.template) });
  if (sp) row({ id: 'qingtian', name: { zh: '擎天卡（VPC 面）', en: 'Qingtian card (VPC plane)' }, level: 'node', count: (t.countOverrides ? geometryCounts(s).nodes : counts.nodes) * sp.vpcNicsPerNode, impact: { zh: '存储 / 管理通路（故障在 MGMT、STORAGE 类中）', en: 'storage / management path (faults inside MGMT, STORAGE)' }, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
  const perCab = counts.gpusPerNode * counts.nodesPerRack;
  row({ id: 'cabinet', name: { zh: `计算机柜（${counts.nodesPerRack} 节点 · ${perCab} NPU）`, en: `Compute cabinet (${counts.nodesPerRack} nodes · ${perCab} NPUs)` }, level: 'cabinet', count: counts.racks, faultUnit: 'cabinet', impact: { zh: `1 个机柜（${perCab} NPU）`, en: `one cabinet (${perCab} NPUs)` }, blastRadiusNpus: perCab, confidence: t.template === 'a2-roce' ? 'derived' : t.template === 'a950-ub2' ? 'vendor' : t.template === 'a960e-ub' ? 'assumed' : 'paper' });
  if (sp) {
    const podNpus = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
    row({ id: 'pod', name: { zh: `超节点（${podNpus.toLocaleString('en-US')} NPU）`, en: `SuperPoD (${podNpus.toLocaleString('en-US')} NPUs)` }, level: 'pod', count: counts.supernodes, impact: { zh: '一个 UB scale-up 域', en: 'one UB scale-up domain' }, blastRadiusNpus: podNpus, confidence: t.template === 'a3-ub384' ? 'paper' : t.template === 'a960e-ub' ? 'assumed' : 'vendor' });
    if (sp.fabric === 'two-level') {
      row({ id: 'commCabinet', name: { zh: '通信机柜（L2 交换）', en: 'Communication cabinet (L2 switching)' }, level: 'pod', count: counts.commRacks, impact: { zh: `约 ${Math.round((sp.subPlanes * sp.l2PerSubPlane) / Math.max(1, sp.commRacks))} 片 L2 的共因（故障在 FABRIC 类中）`, en: `common cause for ≈ ${Math.round((sp.subPlanes * sp.l2PerSubPlane) / Math.max(1, sp.commRacks))} L2 chips (faults inside FABRIC)` }, confidence: t.template === 'a3-ub384' ? 'paper' : 'vendor' });
      const ubShare = counts.ubSwitches > 0 ? counts.l1Switches / counts.ubSwitches : 0;
      row({ id: 'ubL1', name: { zh: `UB L1 交换芯片（每节点 ${sp.l1PerNode}）`, en: `UB L1 switch chip (${sp.l1PerNode} per node)` }, level: 'fabric', count: counts.l1Switches, faultUnit: 'ub-switch', unitShare: ubShare, impact: { zh: `1 个节点在 1 个子平面的上联（1/${sp.subPlanes}）`, en: `one node's uplinks in one sub-plane (1/${sp.subPlanes})` }, blastRadiusNpus: counts.gpusPerNode, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
      row({ id: 'ubL2', name: { zh: `UB L2 交换芯片（${sp.subPlanes} 子平面）`, en: `UB L2 switch chip (${sp.subPlanes} sub-planes)` }, level: 'fabric', count: counts.l2Switches, faultUnit: 'ub-switch', unitShare: 1 - ubShare, impact: { zh: `1 个子平面内每节点 1 条链路（${sp.l2Ports} 口）`, en: `one link per node in one sub-plane (${sp.l2Ports} ports)` }, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
      row({ id: 'ubLink', name: { zh: `UB 光链路 L1–L2（每 L1 ${sp.linksPerL1} 条）`, en: `UB optical link L1–L2 (${sp.linksPerL1} per L1 chip)` }, level: 'fabric', count: counts.opticalLinks, faultUnit: 'ub-link', impact: { zh: `1 条上联（每节点 ${sp.l1PerNode * sp.linksPerL1} 条之一）`, en: `one uplink (of ${sp.l1PerNode * sp.linksPerL1} per node)` }, confidence: t.template === 'a3-ub384' ? 'paper' : 'assumed' });
      row({ id: 'ubTransceiver', name: { zh: 'UB 光模块（链路两端）', en: 'UB transceiver (both link ends)' }, level: 'fabric', count: counts.transceivers, impact: { zh: '计入所在链路（OPT 类）', en: 'counted with its link (OPT)' }, confidence: 'assumed' });
    } else {
      // v4.2 mesh and blade fabrics: in-cabinet switches, pod-tier switches, the electrical mesh, the optical links (and NPO engines)
      const perPod = Math.ceil((podNpus * sp.podUplinksPerNpu) / sp.podSwitchRadix);
      const perComm = sp.commRacks > 0 ? Math.round(perPod / sp.commRacks) : perPod;
      const share = (n: number) => (counts.ubSwitches > 0 ? n / counts.ubSwitches : 0);
      const blade = sp.fabric === 'blade-clos';
      const podSwitchName: L = blade ? { zh: `跨柜 LinkDevice（${sp.podSwitchRadix} 口 × 1.6 Tb/s）`, en: `Cross-cabinet LinkDevice (${sp.podSwitchRadix} × 1.6 Tb/s ports)` } : sp.fabric === 'mesh-4d' ? { zh: `高阶 UB 交换 HRS（${sp.podSwitchRadix} 个 8-lane 口）`, en: `High-radix UB switch HRS (${sp.podSwitchRadix} 8-lane ports)` } : { zh: `光互联 UB 交换（${sp.podSwitchRadix} × 800G，一层 Clos）`, en: `Optical UB switch (${sp.podSwitchRadix} × 800G, one-tier Clos)` };
      row({ id: 'commCabinet', name: { zh: '灵衢互联柜（超节点交换层）', en: 'UB interconnect cabinet (pod switch tier)' }, level: 'pod', count: counts.commRacks, impact: { zh: `约 ${perComm} 台超节点层交换的共因（故障在 FABRIC 类中）`, en: `common cause for ≈ ${perComm} pod-tier switches (faults inside FABRIC)` }, confidence: blade ? 'assumed' : 'vendor' });
      row({ id: 'ubRackSwitch', name: blade ? { zh: `柜内 LinkBlade 交换芯片（每柜 ${sp.rackSwitches}）`, en: `In-cabinet LinkBlade switch chip (${sp.rackSwitches} per cabinet)` } : { zh: `柜内低阶 UB 交换 LRS（每柜 ${sp.rackSwitches}）`, en: `In-cabinet low-radix UB switch LRS (${sp.rackSwitches} per cabinet)` }, level: 'fabric', count: counts.rackSwitches, faultUnit: 'ub-switch', unitShare: share(counts.rackSwitches), impact: blade ? { zh: `所在柜 1/${sp.rackSwitches} 的柜内交换`, en: `1/${sp.rackSwitches} of its cabinet's switching` } : { zh: '柜内 2D 全互联的一个转发 / 备份路径（4 平面之一）', en: 'one forwarding / backup path of the cabinet mesh (one of 4 planes)' }, confidence: blade ? 'assumed' : 'paper' });
      row({ id: 'ubPodSwitch', name: podSwitchName, level: 'fabric', count: counts.podSwitches, faultUnit: 'ub-switch', unitShare: share(counts.podSwitches), impact: perPod > 0 ? { zh: `超节点跨柜带宽的 1/${perPod}`, en: `1/${perPod} of the pod's cross-cabinet bandwidth` } : { zh: '无超节点层交换（每 NPU 上联数为 0）', en: 'no pod-tier switches (0 uplinks per NPU)' }, confidence: sp.fabric === 'mesh-4d' ? 'paper' : 'derived' });
      if (counts.meshLinks > 0 || userRow('ubMeshLink')) row({ id: 'ubMeshLink', name: { zh: `柜内全互联电链路（每柜 ${meshLinksPerCabinet(sp)} 条，x4）`, en: `In-cabinet full-mesh electrical link (${meshLinksPerCabinet(sp)} per cabinet, x4)` }, level: 'fabric', count: counts.meshLinks, impact: { zh: '一对 NPU 的直连；改经 LRS 转发（目录无此类，计数项）', en: 'one NPU pair; traffic re-routed through an LRS (no catalog class; counted only)' }, confidence: 'paper' });
      if (counts.rackMeshLinks > 0 || userRow('ubRackMesh')) row({ id: 'ubRackMesh', name: { zh: `柜间全互联电缆束（${sp.meshRackGrid} × ${sp.meshRackGrid} 柜，UB x128）`, en: `Cabinet-to-cabinet mesh bundle (${sp.meshRackGrid} × ${sp.meshRackGrid} cabinets, UB x128)` }, level: 'fabric', count: counts.rackMeshLinks, impact: { zh: '两柜之间的一维直连（计数项）', en: 'one cabinet-pair link of the cabinet mesh (counted only)' }, confidence: 'paper' });
      if (counts.opticalEngines > 0 || userRow('npoEngine')) row({ id: 'npoEngine', name: { zh: 'NPO 光引擎 Hi-ONE（7.2 Tb/s）', en: 'NPO optical engine Hi-ONE (7.2 Tb/s)' }, level: 'fabric', count: counts.opticalEngines, impact: { zh: '其承载的光链路（OPT 类按等效 800G 链路计）', en: 'the links it carries (OPT counted per 800G-equivalent link)' }, confidence: 'derived' });
      row({ id: 'ubLink', name: blade ? { zh: '光链路（800G 等效，NPO 承载）', en: 'Optical link (800G-equivalent, carried by NPO)' } : sp.fabric === 'mesh-4d' ? { zh: '柜–HRS 光链路（8-lane）', en: 'Cabinet-to-HRS optical link (8 lanes)' } : { zh: `柜–交换 800G 光链路（每 NPU ${sp.podUplinksPerNpu} 条，2+2 保护）`, en: `Cabinet-to-switch 800G optical link (${sp.podUplinksPerNpu} per NPU, 2+2 protection)` }, level: 'fabric', count: counts.opticalLinks, faultUnit: 'ub-link', impact: blade ? { zh: '1 条 800G 等效光通道；光引擎失效是保护倒换还是降带宽，华为未披露（OPT 类按 CloudMatrix384 每链路 FIT 计）', en: 'one 800G-equivalent optical channel; whether an engine failure is masked by protection or degrades bandwidth is not disclosed (OPT at the CloudMatrix384 per-link FIT)' } : { zh: '1 条光上联；单模块故障由 2+2 交叉保护与降 lane 吸收的部分不计入', en: 'one optical uplink; single-module faults absorbed by 2+2 cross protection and lane degradation are not counted' }, confidence: 'derived' });
      if (counts.transceivers > 0 || userRow('ubTransceiver')) row({ id: 'ubTransceiver', name: { zh: 'UB 光模块（链路两端）', en: 'UB transceiver (both link ends)' }, level: 'fabric', count: counts.transceivers, impact: { zh: '计入所在链路（OPT 类）', en: 'counted with its link (OPT)' }, confidence: 'derived' });
      if (counts.backupNpus > 0 || userRow('backupNpu')) row({ id: 'backupNpu', name: { zh: `柜内备份 NPU（每柜 ${sp.backupNpusPerRack}）`, en: `Backup NPU in the cabinet (${sp.backupNpusPerRack} per cabinet)` }, level: 'cabinet', count: counts.backupNpus, impact: { zh: '不参与作业；替换故障 NPU（计数项）', en: 'not used by the job; replaces a failed NPU (counted only)' }, confidence: 'paper' });
    }
  }
  if (so) {
    // tiers are named by index: the role of tier k (spine, aggregation, core) depends on the tier count, which changes with N, and the
    // bill of materials shows several sizes side by side (10k needs three tiers at radix 64, 100k and beyond four)
    // Atlas 950 / 960E SuperClusters run UBoE or RoCE between SuperPoDs (HC2025); the fault class stays roce-switch / roce-link
    const ubFamily = t.template === 'a950-ub2' || t.template === 'a960e-ub' || t.template === 'ub-generic';
    const net = ubFamily ? { zh: 'UBoE / RoCE ', en: 'UBoE / RoCE ' } : { zh: 'RoCE ', en: 'RoCE ' };
    const planes = Math.max(1, so.planes ?? 1);
    const planeNote = planes > 1 ? { zh: `，${planes} 平面`, en: `, ${planes} planes` } : { zh: '', en: '' };
    const tierName = (i: number): L => (i === 0 ? { zh: `${net.zh}叶交换机（第 1 层${planeNote.zh}）`, en: `${net.en}leaf switch (tier 1${planeNote.en})` } : { zh: `${net.zh}交换机（第 ${i + 1} 层${planeNote.zh}）`, en: `${net.en}switch (tier ${i + 1}${planeNote.en})` });
    const label = sp ? { zh: 'RDMA 口（scale-out，每 NPU ' + so.portsPerNpu + ' 个）', en: `RDMA port (scale-out, ${so.portsPerNpu} per NPU)` } : { zh: `RoCE 口（200GE，每 NPU ${so.portsPerNpu} 个）`, en: `RoCE port (200GE, ${so.portsPerNpu} per NPU)` };
    row({ id: 'rocePort', name: label, level: 'scale-out', count: counts.scaleOutPorts, impact: { zh: '故障计入 NPU 的 NIC 类', en: 'faults counted in the NPU NIC class' }, confidence: t.template === 'a960e-ub' ? 'assumed' : t.template === 'a3-ub384' ? 'paper' : 'vendor' });
    const down = Math.max(1, Math.floor((so.radix * so.oversubscription) / (1 + so.oversubscription)));
    counts.scaleOutPerTier.forEach((n, i) => row({ id: `roceTier${i + 1}`, name: { zh: `${tierName(i).zh.replace(/）$/, '')}，${so.radix} 口）`, en: `${tierName(i).en.replace(/\)$/, '')}, ${so.radix} ports)` }, level: 'scale-out', count: n, faultUnit: 'roce-switch', unitShare: counts.scaleOutSwitches > 0 ? n / counts.scaleOutSwitches : 0, impact: i === 0 ? { zh: `${down} 个 NPU 口`, en: `${down} NPU ports` } : { zh: `上联带宽的 1/${Math.round(so.radix / 2)}（ECMP）`, en: `1/${Math.round(so.radix / 2)} of the uplink bandwidth (ECMP)` }, blastRadiusNpus: i === 0 ? Math.ceil(down / Math.max(1, so.portsPerNpu / planes)) : undefined, confidence: 'assumed' }));
    row({ id: 'roceLink', name: { zh: `${net.zh}光链路（NPU–叶 + 层间）`, en: `${net.en}optical link (NPU–leaf + inter-tier)` }, level: 'scale-out', count: counts.scaleOutLinks, faultUnit: 'roce-link', impact: { zh: '1 个 NPU 口或 1 条上联', en: 'one NPU port or one uplink' }, confidence: 'assumed' });
    row({ id: 'roceTransceiver', name: { zh: `${net.zh}光模块（链路两端）`, en: `${net.en}transceiver (both link ends)` }, level: 'scale-out', count: counts.scaleOutTransceivers, impact: { zh: '计入所在链路', en: 'counted with its link' }, confidence: 'assumed' });
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
  // v4.3 components that sit on no hardware unit of the template (a fixed count, or a scope such as zone / supernode / L2 chip
  // chosen in the scenario editor): their rate is the evaluator's (component instances × rate), shown on one row so the table's
  // total equals the evaluator's hardware interruption rate
  let otherPerHour = 0;
  const otherIds: string[] = [];
  for (const c of s.components) {
    if (!c.enabled || unitOfComponent(c.id, c.countRule.per) && c.countRule.per !== 'fixed') continue;
    const r = componentInstances(c, counts).total * toPerHour(c.failure.value, c.failure.unit);
    if (r <= 0) continue;
    otherPerHour += r;
    otherIds.push(`${c.id} (${c.countRule.per === 'fixed' ? `fixed ${c.countRule.count}` : `per ${c.countRule.per}`})`);
  }
  // the classes count different kinds of units, so the row carries a rate and no unit count
  if (otherPerHour > 0) {
    rows.push({ id: 'otherComponents', name: { zh: '其他部件（固定数量或非模板单元口径）', en: 'Other components (fixed count or a scope outside the template units)' }, level: 'cluster', count: 0, perNpu: 0, noCount: true, hardPerHour: otherPerHour, impact: { zh: `按各部件的计数规则与故障率计（与评估器一致）：${otherIds.join('、')}`, en: `each component by its own count rule and rate (as the evaluator): ${otherIds.join(', ')}` }, confidence: 'assumed' });
    hardPerHour += otherPerHour;
  }
  const hardFitPerNpuOther = N > 0 ? (otherPerHour / N) * 1e9 : 0;
  // v4.3 user count overrides: mark the rows, keep the geometry count beside them
  const notes: string[] = [];
  const overrideInfo: TopologyBom['countOverrides'] = { applied: [], ignored: [] };
  if (t.countOverrides && Object.keys(t.countOverrides).length) {
    const r = resolveCountOverrides(geometryCounts(s), t);
    overrideInfo.applied = r.applied;
    overrideInfo.ignored = r.ignored;
    for (const a of r.applied) {
      const row = rows.find((x) => x.id === (a.tier ? `roceTier${a.tier}` : a.id));
      if (row) Object.assign(row, { confidence: 'user', geometryCount: a.geometry });
      const o = t.countOverrides[a.id];
      notes.push(`user count ${a.id}${a.tier ? ` → tier ${a.tier} (the ${a.tier === 1 ? 'leaf' : 'top'} tier at this size; entered with ${o.tiers} tiers)` : ''}: ${a.count.toLocaleString('en-US')} (geometry ${a.geometry.toLocaleString('en-US')}; entered as ${o.count.toLocaleString('en-US')} at ${o.npus.toLocaleString('en-US')} NPUs, scales with N)`);
    }
    for (const x of r.ignored) notes.push(`user count ${x.id} ignored: ${x.reason}`);
  }
  for (const row of rows) if (COUNT_OVERRIDE_ROWS[row.id] || /^roceTier\d+$/.test(row.id)) row.overridable = true;
  const tierWord = sp && sp.fabric !== 'two-level' ? 'pod-tier switches' : 'L2 chips';
  if (sp && sp.fabric !== 'two-level') notes.push(`UB fabric ${sp.fabric}: ${counts.rackSwitches.toLocaleString('en-US')} in-cabinet switches, ${counts.podSwitches.toLocaleString('en-US')} pod-tier switches, ${counts.opticalLinks.toLocaleString('en-US')} optical links${counts.meshLinks ? `, ${counts.meshLinks.toLocaleString('en-US')} electrical mesh links` : ''}${counts.opticalEngines ? `, ${counts.opticalEngines.toLocaleString('en-US')} NPO engines` : ''}; every switch carries the FIT of one CloudMatrix384 UB chip and every optical link that of one CloudMatrix384 L1–L2 link (assumed per-unit equivalence)`);
  if (sp && t.fabricFill === 'proportional' && counts.nodes % (sp.nodesPerRack * sp.computeRacks) !== 0 && sp.fabric !== 'two-level') notes.push(`the last SuperPoD is partly populated: its ${tierWord} and interconnect cabinets follow the populated NPUs`);
  if (sp && t.fabricFill === 'proportional' && counts.nodes % (sp.nodesPerRack * sp.computeRacks) !== 0 && sp.fabric === 'two-level') notes.push('the last SuperPoD is partly populated: its L2 chips and communication cabinets follow the populated nodes (port-count fill; parallel L1–L2 links allowed)');
  if (sp && t.fabricFill === 'full-pod' && counts.nodes % (sp.nodesPerRack * sp.computeRacks) !== 0) notes.push(sp.fabric === 'two-level' ? 'full-pod fill: the last, partly populated SuperPoD counts its whole L2 tier and all communication cabinets' : `full-pod fill: the last, partly populated SuperPoD counts all its ${tierWord} and interconnect cabinets`);
  if (so) notes.push(`scale-out Clos: ${(so.planes ?? 1) > 1 ? `${so.planes} planes × ` : ''}${counts.scaleOutTiers} tier(s) for ${counts.scaleOutPorts.toLocaleString('en-US')} ports at radix ${so.radix}${so.oversubscription > 1 ? `, ${so.oversubscription}:1 at the leaves` : ', non-blocking'} (assumed)`);
  return { template: t.template, npus: N, counts, rows, hardFitPerNpu, hardFitPerNpuTotal: N > 0 ? (hardPerHour / N) * 1e9 : 0, hardFitPerNpuOther, hardPerHour, countOverrides: overrideInfo, notes };
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

/**
 * v4.2 SuperPoD variants of a template (the topology page's pod selector): the Atlas 950 to the product-page spec (1,024 NPUs, cabinet mesh +
 * one-tier optical Clos), the 8,192-NPU roadmap pod, the UB-Mesh paper's 4D mesh (x4 lanes per NPU into x512 HRS) and the
 * CloudMatrix384 two-level copy kept from v4.1 for comparison. The golden generator's VARIANTS use the same overrides.
 */
export interface SuperpodVariant { id: string; name: L; confidence: 'paper' | 'vendor' | 'derived' | 'assumed'; values: () => Superpod }
export const SUPERPOD_VARIANTS: Partial<Record<TopologyTemplate, SuperpodVariant[]>> = {
  'a950-ub2': [
    { id: 'a950-1k', name: { zh: '1,024 NPU · 柜内全互联 + 光交换 Clos（现行规格）', en: '1,024 NPUs · cabinet mesh + optical Clos (current spec)' }, confidence: 'vendor', values: () => ({ ...SUPERPOD_PRESETS['atlas950-1k'].values }) },
    { id: 'a950-8k', name: { zh: '8,192 NPU · 128 + 32 柜（路线图）', en: '8,192 NPUs · 128 + 32 cabinets (roadmap)' }, confidence: 'vendor', values: () => ({ ...SUPERPOD_PRESETS['atlas950-8k'].values }) },
    { id: 'a950-4d', name: { zh: '8,192 NPU · UB-Mesh 4D（论文）', en: '8,192 NPUs · UB-Mesh 4D (paper)' }, confidence: 'paper', values: () => ({ ...SUPERPOD_PRESETS['atlas950-8k'].values, fabric: 'mesh-4d', podUplinksPerNpu: 0.5, podSwitchRadix: 64 }) },
    { id: 'a950-2l', name: { zh: '1,024 NPU · CloudMatrix384 两级 L1/L2 拷贝（v4.1）', en: '1,024 NPUs · CloudMatrix384 two-level copy (v4.1)' }, confidence: 'assumed', values: () => ({ ...SUPERPOD_PRESETS['atlas950-1k'].values, fabric: 'two-level' }) },
  ],
};

/**
 * v4.2 the SuperPoD on another UB fabric: the fields only that fabric uses take its reference geometry (assumed) so a switch never
 * leaves the pod without switches or links — mesh-clos the Atlas 950 cabinet mesh + optical Clos (72 LRS per 64 NPUs, 2 × 800G per
 * NPU into 128-port switches), mesh-4d the UB-Mesh paper (x4 lanes per NPU into 64-port HRS, 4 × 4 cabinet grid), blade-clos the
 * Atlas 960E (5 LinkBlade chips per 72 NPUs, 5.5 ports per NPU into 176-port LinkDevices, NPO), two-level the CloudMatrix384 radix
 * sized to the pod; the cabinet structure (NPUs, nodes, cabinets, CPUs) stays.
 */
export function withFabric(sp: Superpod, fabric: Superpod['fabric']): Superpod {
  if (sp.fabric === fabric) return sp;
  const perCab = sp.npusPerNode * sp.nodesPerRack;
  const e = SUPERPOD_PRESETS.atlas960e.values;
  if (fabric === 'two-level') {
    const nodesPerPod = sp.nodesPerRack * sp.computeRacks;
    return { ...sp, fabric, ...(sp.l1PerNode > 0 ? {} : { l1PerNode: 7, subPlanes: 7, l2PerSubPlane: Math.ceil((nodesPerPod * 16) / 48), l2Ports: 48, linksPerL1: 16 }), transceiversPerLink: sp.transceiversPerLink || 2 };
  }
  if (fabric === 'blade-clos') return { ...sp, fabric, rackSwitches: Math.max(1, Math.round((5 * perCab) / 72)), podUplinksPerNpu: 5.5, podSwitchRadix: 176, opticalLinksPerNpu: e.opticalLinksPerNpu, opticalEnginesPerNpu: e.opticalEnginesPerNpu, meshRackGrid: 0 };
  const lrs = Math.max(1, Math.round((72 * perCab) / 64));
  return fabric === 'mesh-4d'
    ? { ...sp, fabric, rackSwitches: lrs, podUplinksPerNpu: 0.5, podSwitchRadix: 64, meshRackGrid: 4, transceiversPerLink: sp.transceiversPerLink || 2 }
    : { ...sp, fabric, rackSwitches: lrs, podUplinksPerNpu: 2, podSwitchRadix: 128, meshRackGrid: sp.meshRackGrid || 4, transceiversPerLink: sp.transceiversPerLink || 2 };
}

/** display name of a fault unit on a template: the scale-out units of the Atlas 950 / 960E run UBoE or RoCE (HC2025) */
export function faultUnitName(u: FaultUnit, template?: TopologyTemplate): L {
  const ub = template === 'a950-ub2' || template === 'a960e-ub' || template === 'ub-generic';
  if (ub && u === 'roce-switch') return { zh: 'UBoE / RoCE 交换机（叶 / 脊 / 核心）', en: 'UBoE / RoCE switch (leaf / spine / core)' };
  if (ub && u === 'roce-link') return { zh: 'UBoE / RoCE 光链路（两端光模块）', en: 'UBoE / RoCE optical link (two transceivers)' };
  return FAULT_UNIT_NAMES[u];
}

/** which variant of the template the scenario's SuperPoD matches (undefined when edited by hand) */
export function superpodVariantOf(s: Scenario): string | undefined {
  const sp = s.topology.superpod;
  const list = s.topology.template ? SUPERPOD_VARIANTS[s.topology.template] : undefined;
  if (!sp || !list) return undefined;
  return list.find((v) => JSON.stringify({ ...v.values() }) === JSON.stringify({ ...v.values(), ...sp }))?.id;
}

/** the scenario on another SuperPoD variant: the superpod geometry and the topology fields mirrored from it */
export function applySuperpodVariant(s: Scenario, id: string): Scenario {
  const v = (s.topology.template ? SUPERPOD_VARIANTS[s.topology.template] : undefined)?.find((x) => x.id === id);
  if (!v) return s;
  const sp = v.values();
  const pod = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
  // user counts of SuperPoD rows belonged to the previous variant's devices: they go; node, CPU, cabinet and scale-out counts stay
  return { ...s, topology: { ...withoutSuperpodOverrides(s.topology), superpod: sp, gpusPerNode: sp.npusPerNode, nodesPerRack: sp.nodesPerRack, racksPerZone: sp.computeRacks + sp.commRacks, nvlinkDomainGpus: pod } };
}

/** v4.2 built-in examples: the topology templates (five since v5.4) at the first built-in scale (10,000 NPUs) with the six default mechanisms — the whole example registry; the scale is a parameter (`resizeTopology`) */
export const TOPOLOGY_EXAMPLES: Record<string, () => Scenario> = {
  'topology-a3-ub384': () => topologyScenario('a3-ub384', TOPOLOGY_SCALES[0]),
  'topology-a2-roce': () => topologyScenario('a2-roce', TOPOLOGY_SCALES[0]),
  'topology-a950-ub2': () => topologyScenario('a950-ub2', TOPOLOGY_SCALES[0]),
  'topology-a960e-ub': () => topologyScenario('a960e-ub', TOPOLOGY_SCALES[0]),
  'topology-ub-generic': () => topologyScenario('ub-generic', TOPOLOGY_SCALES[0]),
};
// the shared example registry is exactly the topology templates (registered here because the scenario module cannot import the topology module)
Object.assign(EXAMPLES, TOPOLOGY_EXAMPLES);
