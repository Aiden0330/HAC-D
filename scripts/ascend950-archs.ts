/**
 * The two Ascend 950 SuperPoD architectures compared in docs/ASCEND950_SCALING_RELIABILITY.{zh,en}.html and drawn in
 * docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html, as HAC-D scenarios on the a950-ub2 template, and the scale-out designs.
 *  - native: Huawei's Atlas 950 SuperPoD as on the product page (16 compute + 4 UB interconnect cabinets, 1,024 NPUs); the template's
 *    atlas950-1k geometry (72 LRS per cabinet from the UB-Mesh paper, 2 × 800G per NPU into 16 radix-128 switches, derived);
 *  - ubl128: SuperPoD Flex / UBL128 as stated by Huawei Computing (2026-09-30, jointly defined with DeepSeek): 128 NPUs on a single
 *    layer of UB switching at 3.2 Tb/s per NPU, two-tier scale-out to 256K NPUs. Everything else is an assumption, listed in `assumed`.
 */
import { topologyScenario } from '../packages/core/src/topology/index.js';
import { SUPERPOD_PRESETS, type Scenario } from '../packages/core/src/scenario/schema.js';

export type Superpod = NonNullable<Scenario['topology']['superpod']>;
export type ScaleOut = NonNullable<Scenario['topology']['scaleOut']>;
export type ArchId = 'native' | 'ubl128';
type Overrides = NonNullable<Scenario['topology']['countOverrides']>;
export type Label = { zh: string; en: string };
const L = (zh: string, en: string): Label => ({ zh, en });

const A950 = SUPERPOD_PRESETS['atlas950-1k'].values;
export const ARCHS: Record<ArchId, { name: Label; short: Label; superpod: Superpod; overrides?: Overrides; assumed: string[] }> = {
  native: {
    name: L('华为原生 Atlas 950 超节点（1,024 NPU）', 'Huawei native Atlas 950 SuperPoD (1,024 NPUs)'),
    short: L('原生 950', 'Native 950'),
    superpod: { ...A950 },
    assumed: ['cpusPerNode = 2 (16 per cabinet ÷ 8 trays)', 'rackSwitches = 72 LRS (UB-Mesh paper reference cabinet)', 'podSwitchRadix = 128 × 800G (16 switches per pod, from the Hot Chips 8K example scaled)', 'transceiversPerLink = 2'],
  },
  ubl128: {
    name: L('SuperPoD Flex / UBL128（128 NPU，单层 UB 交换）', 'SuperPoD Flex / UBL128 (128 NPUs, single-layer UB switch)'),
    short: L('UBL128', 'UBL128'),
    superpod: { ...A950, preset: 'custom', computeRacks: 2, commRacks: 1, rackSwitches: 0, podUplinksPerNpu: 4, podSwitchRadix: 128 },
    // one switch cabinet per 4 pods (the attached report's 1,000 cabinets for 4,000 pods); only the 8-NPU tray mesh, no cabinet-wide mesh
    overrides: { commCabinet: { count: 1, npus: 512 }, ubMeshLink: { count: 28, npus: 8 } },
    assumed: ['2 compute cabinets of 64 NPUs per pod (Atlas 950 cabinet)', 'podUplinksPerNpu = 4 × 800G = 3.2 Tb/s', 'podSwitchRadix = 128 × 800G → 4 switches per pod', 'rackSwitches = 0 (all NPUs on the single switch layer)', 'tray mesh only: 28 electrical links per 8-NPU tray', 'one switch cabinet per 4 pods', 'cpusPerNode = 2', 'transceiversPerLink = 2 (optical links)'],
  },
};

/** scale-out designs; identical per NPU for both architectures */
export const SO: Record<string, { so: ScaleOut; name: Label; basis: Label }> = {
  main: { so: { portsPerNpu: 4, planes: 4, radix: 1024, oversubscription: 1, transceiversPerLink: 2 }, name: L('4 平面 × 两层，radix 1,024，每 NPU 4 × 200G（主算例）', '4 planes × 2 tiers, radix 1,024, 4 × 200G per NPU (main case)'), basis: L('HC2026：昇腾 960 超节点集群两层 Clos、四平面；星河 UBG 交换机 radix 最高 1,024；附件把它用于 950；950 白皮书允许 2 × 400G UBoE 拆成 4 × 200G', 'HC2026: Ascend 960 SuperPoD clusters use a two-tier, four-plane Clos; Xinghe UBG switches have radix up to 1,024; the attachments apply this to 950; the 950 white paper lets the 2 × 400G UBoE split into 4 × 200G') },
  twoPlane: { so: { portsPerNpu: 2, planes: 2, radix: 1024, oversubscription: 1, transceiversPerLink: 2 }, name: L('2 平面 × 两层，radix 1,024，每 NPU 2 × 400G', '2 planes × 2 tiers, radix 1,024, 2 × 400G per NPU'), basis: L('950 白皮书 2 × 400G UBoE，每口一个平面', '950 white paper 2 × 400G UBoE, one plane per port') },
  hacd: { so: { portsPerNpu: 2, planes: 2, radix: 128, oversubscription: 1, transceiversPerLink: 2 }, name: L('2 平面 × 三层，radix 128（51.2T），每 NPU 2 × 400G（HAC-D 模板默认）', '2 planes × 3 tiers, radix 128 (51.2T), 2 × 400G per NPU (HAC-D template default)'), basis: L('HAC-D a950-ub2 模板默认（综述 2.6 节）；交换机数与券商 UBoE 约 39,000 台同量级', 'HAC-D a950-ub2 template default (survey §2.6); switch count of the order of the broker figure for UBoE (≈ 39,000)') },
  attach: { so: { portsPerNpu: 1, planes: 4, radix: 128, oversubscription: 1, transceiversPerLink: 2 }, name: L('附件方案：每 NPU 1 × 800G，按轨分到 4 个平面，radix 128，按 Clos 自洽所需层数', 'the attachments’ scheme: 1 × 800G per NPU, rails spread over 4 planes, radix 128, as many tiers as a Clos needs'), basis: L('附件写作“两层四平面”、64 口叶 + 128 口脊；每平面 12.8 万个端点时两层 radix 128 只能接 64 × 128 = 8,192 个，须三层', 'the attachments call it “two tiers, four planes” with 64-port leaves and 128-port spines; with 128,000 endpoints per plane two tiers of radix 128 reach only 64 × 128 = 8,192, so three tiers are needed') },
  oversub2: { so: { portsPerNpu: 4, planes: 4, radix: 1024, oversubscription: 2, transceiversPerLink: 2 }, name: L('主算例 + 叶层 2:1 收敛', 'main case with 2:1 at the leaves'), basis: L('附件架构五（推理 PD 分离）的 2:1 收敛，仅作对照', 'the 2:1 of the attachments’ architecture 5 (inference PD disaggregation), for comparison only') },
};

/** a topology scenario of one architecture at n NPUs with the six default mechanisms */
export function scenarioOf(arch: ArchId, n: number, so: ScaleOut = SO.main.so, patch: Partial<Superpod> = {}, dropOverrides: string[] = []): Scenario {
  const a = ARCHS[arch];
  const sp = { ...a.superpod, ...patch } as Superpod;
  const pod = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
  const ov = a.overrides ? Object.fromEntries(Object.entries(a.overrides).filter(([k]) => !dropOverrides.includes(k))) : {};
  const topology = { superpod: sp, scaleOut: so, racksPerZone: sp.computeRacks + sp.commRacks, nvlinkDomainGpus: pod, ...(Object.keys(ov).length ? { countOverrides: ov } : {}) };
  return topologyScenario('a950-ub2', n, { topology: topology as never, id: `scaling-${arch}`, name: `${a.name.en} — ${n.toLocaleString('en-US')} NPUs` });
}
