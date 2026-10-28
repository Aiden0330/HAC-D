# HAC-D 输入变更评审 — ACME A3 服务器集群 2026Q3

生成 2026-10-27 · 目标 A_op ≥ 98.5 % · 规模 100,000 · 400 窗口 · 种子 1

- 之前: 记录 `a3server`, 机制集 `remap-latest-2026-10`, 失效率 单元库
- 之后: 记录 `acme-a3-2026q3`, 机制集 `acme-mech-2026q3`, 失效率 `acme-fit-2026q3`
- 输入变化: 52 记录字段, 14 失效率类, 4 机制集字段; 校验: 0 错误, 2 警告; 0 扩展请求

## 结果

| 规模 | | A_op | A_op 降额 | 交付 | MTBF_hw | MTTR_hw | P(window) | k | 推荐 | 工作量 |
|---|---|---|---|---|---|---|---|---|---|---|
| 100,000 | 之前 | 99.107 % | 99.005 % | 91.532 % | 3.03 h | 104 s | 95.8 % supported | 1.147 | — \| — | 0.0 |
| 100,000 | 之后 | 99.029 % | 98.897 % | 91.913 % | 2.63 h | 101 s | 94.5 % supported | 1.106 | — \| — | 0.0 |
| 100,000 | Δ | −0.078 pt | −0.108 pt | +0.381 pt | × 0.868 | × 0.966 | | −0.041 | — | +0.0 |

## 输入变化

### 拓扑记录

| 字段 | 类型 | 之前 | 之后 | 来源 | 置信 |
|---|---|---|---|---|---|
| `id` | changed | a3server | acme-a3-2026q3 |  |  |
| `layers.cabinet.npus` | changed | 32 | 24 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `name.en` | changed | Atlas 800T A3 server cluster (8 NPUs per server, RoCE between servers) | ACME A3 server cluster 2026Q3 |  |  |
| `name.zh` | changed | Atlas 800T A3 服务器集群（8 NPU / 台，跨机 RoCE） | ACME A3 服务器集群 2026Q3 |  |  |
| `scaleOut.planes` | changed | 1 | 2 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `scaleOut.radix` | changed | 64 | 128 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `scenarioId` | changed | scaling-a3server | acme-a3-2026q3 |  |  |
| `short.en` | changed | 800T A3 | ACME A3 server cluster 2026Q3 |  |  |
| `short.zh` | changed | 800T A3 | ACME A3 服务器集群 2026Q3 |  |  |
| `superpod.cpusPerNode` | added |  | 4 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `superpod.l1PerNode` | added |  | 7 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `superpod.nodesPerRack` | added |  | 3 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `superpod.npusPerNode` | added |  | 8 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `superpod.preset` | removed | custom |  | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `superpod.rdmaPortsPerNpu` | added |  | 2 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `superpod.vpcNicsPerNode` | added |  | 1 | acme-a3-design-note-2026q3.md L1-39 | vendor |
| `variants[0].basis.en` | changed | paper: one RDMA port per die, 400 Gb/s per NPU; radix 64 and non-blocking assumed; the same as in the other “950 and 910C” report | the record's scale-out design |  |  |
| `variants[0].basis.zh` | changed | 论文：每 die 1 个 RDMA 口、每 NPU 400 Gb/s；端口数 64 与无收敛为假设；与另一份《950 与 910C》报告相同 | 记录的 scale-out 设计 |  |  |
| `variants[0].name.en` | changed | 2 × 200G per NPU, 64-port switches, non-blocking folded Clos (HAC-D template default, main case) | main design |  |  |
| `variants[0].name.zh` | changed | 每 NPU 2 × 200G、64 口交换机、无收敛折叠 Clos（HAC-D 模板默认，主算例） | 主设计 |  |  |
| `variants[0].scaleOut.planes` | changed | 1 | 2 |  |  |
| `variants[0].scaleOut.radix` | changed | 64 | 128 |  |  |
| `variants[1].basis.en` | removed | a current 51.2T switch chip used with 200G ports (assumed) |  |  |  |
| `variants[1].basis.zh` | removed | 现行 51.2T 交换芯片按 200G 口使用（假设） |  |  |  |
| `variants[1].id` | removed | r256x200 |  |  |  |
| `variants[1].name.en` | removed | 2 × 200G per NPU, 51.2T switches as 256 × 200G |  |  |  |
| `variants[1].name.zh` | removed | 每 NPU 2 × 200G、51.2T 交换机按 256 × 200G |  |  |  |
| `variants[1].scaleOut.oversubscription` | removed | 1 |  |  |  |
| `variants[1].scaleOut.planes` | removed | 1 |  |  |  |
| `variants[1].scaleOut.portsPerNpu` | removed | 2 |  |  |  |
| `variants[1].scaleOut.radix` | removed | 256 |  |  |  |
| `variants[1].scaleOut.transceiversPerLink` | removed | 2 |  |  |  |
| `variants[2].basis.en` | removed | third-party 800I A3 listing: 8 × 400GE per server; FiberMall relaying SemiAnalysis: 1,536 scale-out modules per CM384 = 384 NIC + 768 leaf + 384 spine |  |  |  |
| `variants[2].basis.zh` | removed | 第三方 800I A3 规格：每台 8 × 400GE；FiberMall 转述 SemiAnalysis：每 CM384 scale-out 1,536 只模块 = 384 网卡 + 768 叶 + 384 脊 |  |  |  |
| `variants[2].id` | removed | r128x400 |  |  |  |
| `variants[2].name.en` | removed | 1 × 400G per NPU, 51.2T switches as 128 × 400G |  |  |  |
| `variants[2].name.zh` | removed | 每 NPU 1 × 400G、51.2T 交换机按 128 × 400G |  |  |  |
| `variants[2].scaleOut.oversubscription` | removed | 1 |  |  |  |
| `variants[2].scaleOut.planes` | removed | 1 |  |  |  |
| `variants[2].scaleOut.portsPerNpu` | removed | 1 |  |  |  |
| `variants[2].scaleOut.radix` | removed | 128 |  |  |  |
| `variants[2].scaleOut.transceiversPerLink` | removed | 2 |  |  |  |
| `variants[3].basis.en` | removed | for comparison only |  |  |  |
| `variants[3].basis.zh` | removed | 仅作对照 |  |  |  |
| `variants[3].id` | removed | oversub2 |  |  |  |
| `variants[3].name.en` | removed | main case with 2:1 at the leaves |  |  |  |
| `variants[3].name.zh` | removed | 主算例 + 叶层 2:1 收敛 |  |  |  |
| `variants[3].scaleOut.oversubscription` | removed | 2 |  |  |  |
| `variants[3].scaleOut.planes` | removed | 1 |  |  |  |
| `variants[3].scaleOut.portsPerNpu` | removed | 2 |  |  |  |
| `variants[3].scaleOut.radix` | removed | 64 |  |  |  |
| `variants[3].scaleOut.transceiversPerLink` | removed | 2 |  |  |  |

### 失效率（业务影响 FIT / 单元·小时）

| 类 | 单元 | 之前 | 之后 | 倍数 | 置信 | 来源 |
|---|---|---|---|---|---|---|
| `COOL-hard` | cabinet | — | 2,880 | — | derived | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_cab row 5; 口径 mapping acme-fit-2026q3-koujing |
| `CORE-hard` | npu | — | 450 | — | derived | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_npu row 3; 口径 mapping acme-fit-2026q3-koujing |
| `CORE-sdc` | npu | — | 36 | — | assumed | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_npu row 3; 口径 mapping acme-fit-2026q3-koujing |
| `CPU-hard` | cpu | — | 320 | — | derived | acme-fit-2026q3.csv / Sheet1: CPU vendor datasheet rev C section 4.2; 口径 mapping acme-fit-2026q3-koujing |
| `DDR-hard` | node | — | 560 | — | derived | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_mem row 2; 口径 mapping acme-fit-2026q3-koujing |
| `FABRIC-hard` | ub-switch | — | 60.000 | — | assumed | acme-fit-2026q3.csv / Sheet1: FIDES prediction 2026Q2 sheet UB; 口径 mapping acme-fit-2026q3-koujing |
| `FABRIC-hard@roce` | roce-switch | — | 66.667 | — | assumed | acme-fit-2026q3.csv / Sheet1: switch vendor datasheet section 7; 口径 mapping acme-fit-2026q3-koujing |
| `MEMT-hard` | npu | — | 384 | — | derived | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_npu row 7; 口径 mapping acme-fit-2026q3-koujing |
| `MGMT-hard` | node | — | 400 | — | assumed | acme-fit-2026q3.csv / Sheet1: FIDES prediction 2026Q2 sheet MGMT; 口径 mapping acme-fit-2026q3-koujing |
| `MODULE-hard` | npu | — | 180 | — | derived | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_npu row 3; 口径 mapping acme-fit-2026q3-koujing |
| `NIC-hard` | npu | — | 60.000 | — | measured | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_net row 1; 口径 mapping acme-fit-2026q3-koujing |
| `OPT-hard@roce` | roce-link | — | 120 | — | derived | acme-fit-2026q3.csv / Sheet1: ACME field returns 2026Q3 tbl_net row 4; 口径 mapping acme-fit-2026q3-koujing |
| `POWER-hard` | cabinet | — | 6,000 | — | derived | acme-fit-2026q3.csv / Sheet1: PSU vendor datasheet p. 12; 口径 mapping acme-fit-2026q3-koujing |
| `SSD-hard` | node | — | 1,378.1 | — | assumed | acme-fit-2026q3.csv / Sheet1: SSD vendor reliability report 2026H1 p. 3; 口径 mapping acme-fit-2026q3-koujing |

### 机制集

| 字段 | 类型 | 之前 | 之后 | 来源 | 置信 |
|---|---|---|---|---|---|
| `id` | changed | remap-latest-2026-10 | acme-mech-2026q3 |  |  |
| `parameters.D-HARD.detectSeconds` | added |  | 20 | ACME-FM-2026Q3 table 4 (median detection time of hard faults) | measured |
| `parameters.R-REPLAY.success` | added |  | 0.920000 | ACME-FM-2026Q3 table 6 (step-replay success rate, Q3) | measured |
| `source` | changed | ReMAP f53ab7e, extensionScenario() + parameter sets (eligible share 1, FP8 / FP4 0.5 of the CORE silent risk each, success 0.95, failure attempt 0 s, overhead 0, ABFT 0.001; eligibility × success folded into the parameters by expectation where the transform is deterministic) | acme-mechanisms-2026q3.md: ACME-FM-2026Q3 field report. Only the parameters that differ from the HAC-D default set are listed. |  |  |

## 校验

| 级别 | 路径 | 代码 | 说明 |
|---|---|---|---|
| info | `record.layers` | provenance-missing | 层实例规则无来源（通常由几何推出） |
| warning | `override.rates.OPT-hard@roce.fit` | implausible | 120.0 FIT/单元·h 是单元库值 4.762 的 25.2 倍（范围 0.1–10） |
| info | `override.catalog` | catalog-missing | 无 catalog 块（版本 / 哈希 / 口径） |
| warning | `set.capability` | provenance-missing | capability 无来源 / 置信 |

## 扩展请求

无：所有输入都是数据更新。
