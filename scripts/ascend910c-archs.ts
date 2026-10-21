/**
 * The two Ascend 910C architectures compared in docs/ASCEND910C_SCALING_RELIABILITY.{zh,en}.html, as HAC-D scenarios on the
 * a3-ub384 template, and the scale-out designs.
 *  - cm384: Atlas 900 A3 SuperPoD / CloudMatrix384 as in the paper (arXiv 2506.12708 v3 §3.3): 48 nodes × (8 NPUs + 4 CPUs + 7 on-board
 *    L1 UB chips) in 12 compute + 4 communication cabinets, 7 sub-planes × 16 L2 chips, one optical link per L1–L2 pair (5,376 per
 *    pod), one RDMA port per die. This is the template's own geometry and the geometry the per-unit FIT were calibrated on.
 *  - a3server: Atlas 800T A3 servers on a RoCE Clos. Huawei's product page: 10U, 8 × Ascend 910, 4 × Kunpeng 920, 784 GB/s interconnect
 *    at 1:1, and up to 384 cards as a supernode — the CloudMatrix384 node used stand-alone. The UB domain is the server: its 8 NPUs on
 *    the 7 on-board L1 chips; no L2 tier, no UB optics, no communication cabinets. Four servers per cabinet (as the CM384 compute
 *    cabinet) and the RoCE ports (the CM384 RDMA plane, 400 Gb/s per NPU) are assumptions; both are listed in `assumed`.
 */
import { topologyScenario } from '../packages/core/src/topology/index.js';
import { SUPERPOD_PRESETS, type Scenario } from '../packages/core/src/scenario/schema.js';

export type Superpod = NonNullable<Scenario['topology']['superpod']>;
export type ScaleOut = NonNullable<Scenario['topology']['scaleOut']>;
export type ArchId = 'cm384' | 'a3server';
export type Label = { zh: string; en: string };
const L = (zh: string, en: string): Label => ({ zh, en });

const CM = SUPERPOD_PRESETS.cloudmatrix384.values;
export const ARCHS: Record<ArchId, { name: Label; short: Label; superpod: Superpod; domainNpus: number; assumed: string[] }> = {
  cm384: {
    name: L('Atlas 900 A3 超节点 / CloudMatrix384（384 NPU，两级 UB 交换）', 'Atlas 900 A3 SuperPoD / CloudMatrix384 (384 NPUs, two-level UB switching)'),
    short: L('CM384', 'CM384'),
    superpod: { ...CM },
    domainNpus: 384,
    assumed: ['transceiversPerLink = 2 (one module per L1–L2 link end; SemiAnalysis counts 6,912 × 400G LPO per system on another basis)', 'the 112 L2 chips spread evenly over the 4 communication cabinets (28 each; placement not public)', 'scale-out: one 200G RDMA port per die (paper: 400 Gb/s per NPU) into a non-blocking folded Clos of 64-port switches (radix not public)'],
  },
  a3server: {
    name: L('Atlas 800T A3 服务器集群（8 NPU / 台，跨机 RoCE）', 'Atlas 800T A3 server cluster (8 NPUs per server, RoCE between servers)'),
    short: L('800T A3', '800T A3'),
    superpod: { ...CM, preset: 'custom', computeRacks: 1, commRacks: 0, l2PerSubPlane: 0, linksPerL1: 0 },
    domainNpus: 8,
    assumed: ['4 servers (32 NPUs) per cabinet, as in the CM384 compute cabinet (4 × 10U; air-cooled power density not public)', 'the 7 on-board L1 UB chips remain the server’s internal UB fabric; their uplink ports stay unused', 'scale-out ports as the CM384 RDMA plane (2 × 200G per NPU = 400 Gb/s; a third-party 800I A3 listing shows 8 × 400GE per server, the same bandwidth)', 'no L2 tier, no UB optics, no communication cabinets'],
  },
};

/** scale-out designs; identical per NPU for both architectures (the RDMA plane of CM384 = the RoCE ports of the 800T A3) */
export const SO: Record<string, { so: ScaleOut; name: Label; basis: Label }> = {
  main: { so: { portsPerNpu: 2, planes: 1, radix: 64, oversubscription: 1, transceiversPerLink: 2 }, name: L('每 NPU 2 × 200G、64 口交换机、无收敛折叠 Clos（HAC-D 模板默认，主算例）', '2 × 200G per NPU, 64-port switches, non-blocking folded Clos (HAC-D template default, main case)'), basis: L('论文：每 die 1 个 RDMA 口、每 NPU 400 Gb/s；端口数 64 与无收敛为假设；与另一份《950 与 910C》报告相同', 'paper: one RDMA port per die, 400 Gb/s per NPU; radix 64 and non-blocking assumed; the same as in the other “950 and 910C” report') },
  r256x200: { so: { portsPerNpu: 2, planes: 1, radix: 256, oversubscription: 1, transceiversPerLink: 2 }, name: L('每 NPU 2 × 200G、51.2T 交换机按 256 × 200G', '2 × 200G per NPU, 51.2T switches as 256 × 200G'), basis: L('现行 51.2T 交换芯片按 200G 口使用（假设）', 'a current 51.2T switch chip used with 200G ports (assumed)') },
  r128x400: { so: { portsPerNpu: 1, planes: 1, radix: 128, oversubscription: 1, transceiversPerLink: 2 }, name: L('每 NPU 1 × 400G、51.2T 交换机按 128 × 400G', '1 × 400G per NPU, 51.2T switches as 128 × 400G'), basis: L('第三方 800I A3 规格：每台 8 × 400GE；FiberMall 转述 SemiAnalysis：每 CM384 scale-out 1,536 只模块 = 384 网卡 + 768 叶 + 384 脊', 'third-party 800I A3 listing: 8 × 400GE per server; FiberMall relaying SemiAnalysis: 1,536 scale-out modules per CM384 = 384 NIC + 768 leaf + 384 spine') },
  oversub2: { so: { portsPerNpu: 2, planes: 1, radix: 64, oversubscription: 2, transceiversPerLink: 2 }, name: L('主算例 + 叶层 2:1 收敛', 'main case with 2:1 at the leaves'), basis: L('仅作对照', 'for comparison only') },
};

/** a topology scenario of one architecture at n NPUs with the six default mechanisms */
export function scenarioOf(arch: ArchId, n: number, so: ScaleOut = SO.main.so, patch: Partial<Superpod> = {}): Scenario {
  const a = ARCHS[arch];
  const sp = { ...a.superpod, ...patch } as Superpod;
  const topology = { superpod: sp, scaleOut: so, nodesPerRack: sp.nodesPerRack, racksPerZone: sp.computeRacks + sp.commRacks, nvlinkDomainGpus: a.domainNpus };
  return topologyScenario('a3-ub384', n, { topology: topology as never, id: `scaling-${arch}`, name: `${a.name.en} — ${n.toLocaleString('en-US')} NPUs` });
}
