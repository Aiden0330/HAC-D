# HAC-D input change review — ACME A3 server cluster 2026Q3

generated 2026-10-27 · target A_op ≥ 98.5 % · scales 100,000 · 400 windows · seed 1

- before: record `a3server`, set `remap-latest-2026-10`, rates unit library
- after: record `acme-a3-2026q3`, set `acme-mech-2026q3`, rates `acme-fit-2026q3`
- input changes: 52 record fields, 14 rate classes, 4 set fields; validation: 0 errors, 2 warnings; 0 extension requests

## Results

| scale | | A_op | A_op derated | delivered | MTBF_hw | MTTR_hw | P(window) | k | recommended | effort |
|---|---|---|---|---|---|---|---|---|---|---|
| 100,000 | before | 99.107 % | 99.005 % | 91.532 % | 3.03 h | 104 s | 95.8 % supported | 1.147 | — \| — | 0.0 |
| 100,000 | after | 99.029 % | 98.897 % | 91.913 % | 2.63 h | 101 s | 94.5 % supported | 1.106 | — \| — | 0.0 |
| 100,000 | Δ | −0.078 pt | −0.108 pt | +0.381 pt | × 0.868 | × 0.966 | | −0.041 | — | +0.0 |

## Input changes

### Topology record

| path | kind | before | after | source | confidence |
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

### Failure rates (business-impact FIT per unit-hour)

| class | unit | before | after | ratio | confidence | source |
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

### Mechanism set

| path | kind | before | after | source | confidence |
|---|---|---|---|---|---|
| `id` | changed | remap-latest-2026-10 | acme-mech-2026q3 |  |  |
| `parameters.D-HARD.detectSeconds` | added |  | 20 | ACME-FM-2026Q3 table 4 (median detection time of hard faults) | measured |
| `parameters.R-REPLAY.success` | added |  | 0.920000 | ACME-FM-2026Q3 table 6 (step-replay success rate, Q3) | measured |
| `source` | changed | ReMAP f53ab7e, extensionScenario() + parameter sets (eligible share 1, FP8 / FP4 0.5 of the CORE silent risk each, success 0.95, failure attempt 0 s, overhead 0, ABFT 0.001; eligibility × success folded into the parameters by expectation where the transform is deterministic) | acme-mechanisms-2026q3.md: ACME-FM-2026Q3 field report. Only the parameters that differ from the HAC-D default set are listed. |  |  |

## Validation

| level | path | code | message |
|---|---|---|---|
| info | `record.layers` | provenance-missing | the layer rule has no provenance entry (usually derived from the geometry) |
| warning | `override.rates.OPT-hard@roce.fit` | implausible | 120.0 FIT per unit-hour is 25.2 × the unit library's 4.762 (envelope 0.1–10) |
| info | `override.catalog` | catalog-missing | no catalog block (revision, hash, rate basis) |
| warning | `set.capability` | provenance-missing | capability has no provenance entry |

## Extension requests

None: every input is a data update.
