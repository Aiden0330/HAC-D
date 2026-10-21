# Ascend / CloudMatrix source notes

Companion to `data-staging/ascend/ascend-records.json` (104 records; classes: ascend 93, nic_optics 7, switch 3, hbm 1; confidence: paper-reported 24, derived 13, vendor 63, scan-level 4).
Compiled 2026-10-09 by fetching every URL below. All 104 records were merged into `packages/core/data/library.json` on 2026-10-09 (class `ascend` plus analogue records in `nic_optics`, `switch`, `hbm`); the staging JSON is kept for regeneration.

Rules applied: every record carries 口径 (event / denominator / level), applicability, provenance with URL and confidence, and a zh+en caveat.
Counts use `event: topology_count`; the denominator is `supernode` for whole-supernode totals and the narrower unit (`node`, `die`, `npu`, `sub-plane`, `L2 UB switch chip`, `compute rack`, `superpod`, `supercluster`) where the number is per that unit, so that multiplying by the unit count reproduces the supernode total. Quantities of different event classes (link failures, link flaps, sub-health, job interruptions) are kept as separate records and must not be added.

## 1. Verification status of the sources

| Source | URL | Fetched? | Notes |
|---|---|---|---|
| CloudMatrix384 paper, arXiv 2506.12708 v3 (abs page) | <https://arxiv.org/abs/2506.12708> | yes | v1 15 Jun, v2 18 Jun, v3 19 Jun 2025; abstract: 384 Ascend 910 NPUs + 192 Kunpeng CPUs via UB |
| CloudMatrix384 paper v3 body, §3.3.1–3.3.3 | <https://arxiv.org/html/2506.12708v3> | yes (curl + text extraction; WebFetch refused the page) | All topology counts below quoted from §3.3.1 (chip), §3.3.2 (node), §3.3.3 (UB switch system) and the planes paragraph of §3.2 |
| The Register, 29 Jul 2025, Tobias Mann | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> | yes | "Each P910C accelerator features 14 28GB/s UB links (seven per compute die)"; "32 NPUs per rack"; "16 racks with 12 for compute and four for networking"; "400Gbps of scale-out networking per accelerator"; "up to 165,000 NPUs" |
| SemiAnalysis, 16 Apr 2025 (public preview only) | <https://newsletter.semianalysis.com/p/huawei-ai-cloudmatrix-384-chinas-answer-to-nvidia-gb200-nvl72> | yes (public part; paywall starts at "CloudMatrix384 Scale-Up Topology Estimates") | "6,912 400G LPO transceivers ... the vast majority of which are for the scaleup network" — 400G, not 800G; "12 compute rack containing 32 GPUs"; "4 racks of scale up switches" |
| FiberMall relay of the SemiAnalysis paywalled breakdown | <https://www.fibermall.com/ja/blog/?p=17241> | yes | 5,376 scale-up + 1,536 scale-out (384 NIC + 768 leaf + 384 spine); many numbers mangled to "XNUMX" → scan-level only |
| Huawei press release, HC2025 (en / cn) | <https://www.huawei.com/en/news/2025/9/hc-lingqu-ai-superpod> | yes | 8,192 / 15,488 NPUs; >500,000 / >1 million; UnifiedBus 2.0 specs released; no cabinet counts |
| Eric Xu keynote, HC2025 (en / cn) | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> | yes | Primary for 160 = 128 + 32 cabinets, 1,000 m², 220 = 176 + 44 cabinets, 100-ns-level optical fault detection/protection switching, "100 times more reliable", >200 m, 16.3 PB/s, 2.1 µs, >300 Atlas 900 A3 deployed |
| Huawei MWC 2026 release | <https://www.huawei.com/en/news/2026/3/mwc-superpod-ai> | yes | "integrates 64 NPUs per cabinet and can scale up to 8,192 NPUs" |
| Huawei press release, HC2026, Atlas 960E | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> | yes | 4,096 NPUs; 5,500 Hi-ONE replace 48,000 800G modules; >550 kW saved; "doubling the system's fault-free operating time"; "99.8% system availability"; 512,000 / one million NPUs |
| SDxCentral, 22 Sep 2025 | <https://www.sdxcentral.com/news/huawei-bets-ai-future-on-interconnect-efforts-in-challenge-to-nvidia/> | yes | Secondary confirmation of the 100-ns / hundredfold claims (not used as a record source) |
| MindCluster 7.3 Fault Handling Description | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_021.html> | yes | Six-rung ladder, fall-back order, dependence on "backup redundant compute servers", direct rescheduling vs unconditional retry (`fault-retry-times`) |
| MindCluster 7.3 Process-Level Rescheduling | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_025.html> | yes | rank-0 rule; recover vs recover-in-place; standby server; constraints |
| MindCluster 7.3 Process-Level Online Recovery | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_026.html> | yes | HCCS L1–L2 port/link and RoCE faults after operator-level fails; on-chip memory UCE (0x80E01801) isolate + step retry; disabled by default |
| MindCluster 7.3 Operator-Level Online Recovery | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_114.html> | yes | Processor network faults + UnifiedBus interconnect device faults; HCCS BGP switching / RoCE failover; Atlas 900 A3 SuperPoD only |
| MindCluster 7.3 Slow Node Diagnosis | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindxdlFDUG138.html> | yes | 110001010 SubHealthFault; degradationPercentage 0.3; nConsecAnomaliesSignifySlow 3; nSecondsDoOneDetection 30 s; nSigma 3; normalNumber 20; clusterMeanDistance 1.3 |
| Huawei Cloud Algorithm Innovation Lab news | <https://www.huaweicloud.com/lab/algorithm/news/Ascend_10k_cards_level_computing_power_cluster_breakthrough.html> | yes (undated page) | "训练可用度高达98%：全年365天中，有超过358天可随时启动训练任务"; 秒级恢复、分钟级诊断; linearity 96 % / 95.05 % / 96.48 %; no 99.95 % |
| QbitAI 量子位, 10 Jun 2025 (金磊) | <https://www.qbitai.com/2025/06/292512.html> | yes | 98 %; "AI推理的可用度甚至还需要达到99.95%"; 10 min / 3 min / 30 s recovery rungs; Step级重调度 HBM 多比特 ECC 1 分钟内, 算力损失减少 5 %; 容忍超过 99 % 光模块闪断; TOKEN 级重试 <10 s; 实例重启 <5 min |
| ModelArts node-fault troubleshooting | <https://support.huaweicloud.com/trouble-modelarts/modelarts_13_0287.html> | yes | "可能是亚健康，建议先重启节点，如果重启节点后未恢复，发起维修流程"; cordon + migrate on NotReady; no durations |
| Huawei Cloud Availability Engineering Lab | <https://www.huaweicloud.com/lab/reliability/research.html> | yes | "亚健康问题，即硬件或系统处于非正常工作状态，但尚未引发显著故障"; no numbers |
| ModelArts Lite Server — Snt9b23 HCCL operator-level re-execution | <https://support.huaweicloud.com/resmgmt-modelarts/usermanual-server-0037.html> | yes (updated 2026-02-06) | L1–L2 optical flap → path switch; link-down may interrupt → checkpoint rollback; RoH/RoCE 30 s threshold; ~95 % re-execution success; defaults 5000 ms / 1000 ms / 3 |
| Huawei optical-module channel loss resistance (encyclopedia) | <https://info.support.huawei.com/info-finder/encyclopedia/en/Optical+module+channel+loss+resistance.html> | yes | AFR of traditional modules "as high as 4‰"; ~60 interruptions/yr in a >10,000-card cluster; ~90 % single-channel; 4‰ → 0.4‰, 60 → 6 |
| Alibaba HPN, SIGCOMM 2024 (PDF) | <https://ennanzhai.github.io/pub/sigcomm24-hpn.pdf> | yes (curl + pypdf) | "0.057% of NIC-ToR links fail each month, and about 0.051% of ToR switches encounter critical errors and crashes ... 5K-60K link flapping cases happen each day" (§2.3, Fig. 5) |
| Llama 3 paper (Table 5) | <https://arxiv.org/html/2407.21783> | yes (curl) | 419 unexpected interruptions over 54 days / 16,384 H100; Network Switch/Cable 35 (8.4 %), NIC 7 (1.7 %) |
| Microsoft, Surviving switch failures (CCR 2021) | <https://ccronline.sigcomm.org/?p=1180> | yes | 180,000+ switches; 98 % uninterrupted for >3 months after deployment; one vendor 2× failure likelihood |
| Meta IMC 2018 network reliability (PDF) | <https://conferences.sigcomm.org/imc/2018/papers/imc18-final179.pdf> | yes (curl + pypdf) | Only qualitative statements extractable (rack switches ≈28 % of incidents; three orders of magnitude spread in incident rates by device type) → no record |
| ByteDance MegaScale (NSDI 2024) | <https://arxiv.org/html/2402.15627> | yes (curl) | Mentions link flapping and NCCL/NIC retransmit tuning but gives no flap rate → no record |
| Meta "Revisiting Reliability" (arXiv 2410.21680) | <https://arxiv.org/html/2410.21680> | yes (curl) | IB-link failures "dominated by a short period ... from a handful of nodes"; no per-link rate → no new record (fleet rates already in library) |
| Calchas, ATC 2024 | <https://www.usenix.org/conference/atc24/presentation/wu-ronglong> | counts taken from existing library records (`hbm.uer_count.calchas`), not re-fetched | derived UER rate per stack-year |
| **Not fetchable** | | | |
| e.huawei.com StarryLink optical modules (reported "every 3.6 days / ~2 h recovery") | <https://e.huawei.com/en/products/dcn-modules> | **no — HTTP 403** | Figures seen only in search snippets → not recorded |
| toutiao copy of the SemiAnalysis breakdown | <https://www.toutiao.com/zixun/7531901713386063906> | **no — HTTP 404** | Replaced by the FiberMall copy |
| LightCounting notes (Sep 2025, Jul 2026) | <https://lightcounting.com/newsletter/en/september-2025-huawei-announced-large-supernodes-enhancing-scale-and-efficiency-through-connectivity-411> | **no — HTTP 403** | Would have been a second source for cabinet splits |
| Credo "path to zero flap" blog | <https://credosemi.com/blogs/the-path-to-zero-flap-reinventing-optical-reliability-for-scalable-ai-clusters/> | **no — connection closed (3 attempts)** | Vendor flap figures not recorded |
| TechRadar MWC 2026 Atlas 950 | <https://www.techradar.com/pro/huawei-debuts-its-atlas-950-ai-superpod-at-mwc-2026-taking-the-ai-data-center-fight-to-nvidia-and-amd> | partial (navigation only) | Not needed: keynote is primary |
| SemiAnalysis paywalled "Scale-Up Topology Estimates" | (same URL as above) | **no — paywall** | Anything beyond the public preview is marked scan-level via the FiberMall relay |

## 2. Record table

| id | value | unit | confidence | URL |
|---|---|---|---|---|
| `ascend.cm384.npus` | 384 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.cpus` | 192 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.racks_total` | 16 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.compute_racks` | 12 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.communication_racks` | 4 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.nodes` | 48 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.npus_per_node` | 8 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.cpus_per_node` | 4 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l1_switch_chips_per_node` | 7 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l2_subplanes` | 7 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l2_chips_per_subplane` | 16 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l2_ports_per_chip` | 48 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l1_fanout_links` | 16 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.ub_transceivers_per_die` | 7 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.rdma_interfaces_per_die` | 1 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.dies_per_npu` | 2 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.hbm_stacks_per_npu` | 8 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.network_planes` | 3 | count | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.nonblocking_l2` | — | n/a | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.vpc_bw_per_node` | ≤400 | Gbps | paper-reported | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l1_switch_chips` | 336 | count | derived | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l2_switch_chips` | 112 | count | derived | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l1_l2_links` | 5376 | count | derived | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.links_per_subplane` | 768 | count | derived | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.l1_l2_transceiver_ends` | 10,752 | count | derived | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.node_uplinks` | 112 | count | derived | <https://arxiv.org/html/2506.12708v3> |
| `ascend.cm384.npu_ub_links_total` | 5376 | count | derived | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> |
| `ascend.cm384.ub_bw_per_npu` | 392 | GB/s | derived | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> |
| `ascend.cm384.ub_links_per_npu` | 14 | count | vendor | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> |
| `ascend.cm384.ub_link_bw` | 28 | GB/s | vendor | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> |
| `ascend.cm384.npus_per_compute_rack` | 32 | count | vendor | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> |
| `ascend.cm384.rdma_bw_per_npu` | 400 | Gbps | vendor | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> |
| `ascend.cm384.max_training_cluster_npus` | 165,000 | count | vendor | <https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/> |
| `ascend.cm384.lpo_transceivers_semianalysis` | 6912 | count | scan-level | <https://newsletter.semianalysis.com/p/huawei-ai-cloudmatrix-384-chinas-answer-to-nvidia-gb200-nvl72> |
| `ascend.cm384.scaleup_transceivers_secondary` | 5376 | count | scan-level | <https://www.fibermall.com/ja/blog/?p=17241> |
| `ascend.cm384.scaleout_transceivers_secondary` | 1536 | count | scan-level | <https://www.fibermall.com/ja/blog/?p=17241> |
| `ascend.cm384.ub_bw_per_npu_semianalysis` | 2.8 | Tbps | scan-level | <https://www.fibermall.com/ja/blog/?p=17241> |
| `ascend.atlas950.npus` | 8192 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-lingqu-ai-superpod> |
| `ascend.atlas950.cabinets_total` | 160 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950.compute_cabinets` | 128 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950.communication_cabinets` | 32 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950.npus_per_cabinet` | 64 | count | vendor | <https://www.huawei.com/en/news/2026/3/mwc-superpod-ai> |
| `ascend.atlas950.floor_area` | 1000 | m2 | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950.interconnect_bw` | 16.3 | PB/s | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950.ub_latency` | 2.1 | us | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas960.npus` | 15,488 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-lingqu-ai-superpod> |
| `ascend.atlas960.cabinets_total` | 220 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas960.compute_cabinets` | 176 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas960.communication_cabinets` | 44 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas960.npus_per_compute_cabinet_derived` | 88 | count | derived | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950_supercluster.npus` | 520,000 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950_supercluster.superpods` | 64 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas950_supercluster.cabinets` | ≥10,000 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas960_supercluster.npus` | ≥1,000,000 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-lingqu-ai-superpod> |
| `ascend.ub2.optical_fault_switchover` | 100 | ns | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.ub2.optical_reliability_gain` | 100 | x | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.ub2.interconnect_reach` | ≥200 | m | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas900a3.deployed_units` | ≥300 | count | vendor | <https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech> |
| `ascend.atlas960e.npus` | 4096 | count | vendor | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> |
| `ascend.atlas960e.system_availability` | 99.8 | pct | vendor | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> |
| `ascend.atlas960e.fault_free_time_gain` | 2 | x | vendor | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> |
| `ascend.atlas960e.hi_one_units` | 5500 | count | vendor | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> |
| `ascend.atlas960e.replaced_800g_modules` | 48,000 | count | vendor | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> |
| `ascend.atlas960e.hi_one_capacity` | 7.2 | Tbps | vendor | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> |
| `ascend.atlas960e.supercluster_npus` | 512,000 | count | vendor | <https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode> |
| `ascend.mindcluster.recovery_ladder_levels` | 6 | count | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_021.html> |
| `ascend.mindcluster.operator_level_coverage` | — | n/a | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_114.html> |
| `ascend.mindcluster.process_level_online_coverage` | — | n/a | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_026.html> |
| `ascend.mindcluster.process_level_rescheduling_dependence` | — | n/a | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_025.html> |
| `ascend.mindcluster.rank0_rule` | — | n/a | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_025.html> |
| `ascend.mindcluster.job_level_default` | — | n/a | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_021.html> |
| `ascend.mindcluster.slow_node_fault_code` | 110,001,010 | code | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindxdlFDUG138.html> |
| `ascend.mindcluster.slow_node_degradation_threshold` | 0.3 | fraction | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindxdlFDUG138.html> |
| `ascend.mindcluster.slow_node_consecutive_anomalies` | 3 | count | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindxdlFDUG138.html> |
| `ascend.mindcluster.slow_node_detection_period` | 30 | s | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindxdlFDUG138.html> |
| `ascend.mindcluster.slow_node_min_detection_latency_derived` | ≥90 | s | derived | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindxdlFDUG138.html> |
| `ascend.mindcluster.slow_node_nsigma` | 3 | count | vendor | <https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/mindxdlFDUG138.html> |
| `ascend.huaweicloud.training_availability_10k` | 98 | pct | vendor | <https://www.huaweicloud.com/lab/algorithm/news/Ascend_10k_cards_level_computing_power_cluster_breakthrough.html> |
| `ascend.huaweicloud.inference_availability_requirement` | 99.95 | pct | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.recovery_job_level_10k` | ≤10 | min | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.recovery_process_level_rescheduling` | ≤3 | min | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.recovery_process_level_online` | ≤30 | s | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.recovery_step_level_hbm_mbe` | ≤1 | min | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.step_level_compute_loss_reduction` | 5 | pct | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.optical_flap_tolerance` | ≥99 | pct | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.inference_token_retry_recovery` | ≤10 | s | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.inference_instance_restart` | ≤5 | min | vendor | <https://www.qbitai.com/2025/06/292512.html> |
| `ascend.huaweicloud.subhealth_definition` | — | n/a | vendor | <https://www.huaweicloud.com/lab/reliability/research.html> |
| `ascend.huaweicloud.modelarts_subhealth_guidance` | — | n/a | vendor | <https://support.huaweicloud.com/trouble-modelarts/modelarts_13_0287.html> |
| `ascend.huaweicloud.hccl_reexec_success` | 95 | pct | vendor | <https://support.huaweicloud.com/resmgmt-modelarts/usermanual-server-0037.html> |
| `ascend.huaweicloud.roce_flap_threshold` | 30 | s | vendor | <https://support.huaweicloud.com/resmgmt-modelarts/usermanual-server-0037.html> |
| `ascend.huaweicloud.hccl_reexec_max_retries` | 3 | count | vendor | <https://support.huaweicloud.com/resmgmt-modelarts/usermanual-server-0037.html> |
| `ascend.huaweicloud.hccs_l1_l2_flap_behavior` | — | n/a | vendor | <https://support.huaweicloud.com/resmgmt-modelarts/usermanual-server-0037.html> |
| `nic_optics.optical_module_afr.huawei_traditional` | ≤0.004 | per_year | vendor | <https://info.support.huawei.com/info-finder/encyclopedia/en/Optical+module+channel+loss+resistance.html> |
| `nic_optics.optical_module_afr.huawei_channel_loss_resistance` | 0.0004 | per_year | vendor | <https://info.support.huawei.com/info-finder/encyclopedia/en/Optical+module+channel+loss+resistance.html> |
| `nic_optics.optical_interruptions_per_year.huawei_10k_cluster` | 60 | per_year | vendor | <https://info.support.huawei.com/info-finder/encyclopedia/en/Optical+module+channel+loss+resistance.html> |
| `nic_optics.single_channel_fault_share.huawei` | 90 | pct | vendor | <https://info.support.huawei.com/info-finder/encyclopedia/en/Optical+module+channel+loss+resistance.html> |
| `nic_optics.nic_tor_link_failure_rate.hpn` | 0.057 | pct_per_month | paper-reported | <https://ennanzhai.github.io/pub/sigcomm24-hpn.pdf> |
| `switch.tor_critical_error_rate.hpn` | 0.051 | pct_per_month | paper-reported | <https://ennanzhai.github.io/pub/sigcomm24-hpn.pdf> |
| `nic_optics.link_flap_count_per_day.hpn` | 5000–60,000 | per_day | paper-reported | <https://ennanzhai.github.io/pub/sigcomm24-hpn.pdf> |
| `switch.network_interruption_rate.llama3_derived` | 1.65e-06 | per_gpu_h | derived | <https://arxiv.org/html/2407.21783> |
| `nic_optics.nic_interruption_rate.llama3_derived` | 3.3e-07 | per_gpu_h | derived | <https://arxiv.org/html/2407.21783> |
| `switch.survival_3month.msft_ccr2021` | 98 | pct | paper-reported | <https://ccronline.sigcomm.org/?p=1180> |
| `hbm.uer_rate.calchas_derived` | 0.0247 | per_year | derived | <https://www.usenix.org/conference/atc24/presentation/wu-ronglong> |

## 3. Topology summary (CloudMatrix384 / Atlas 900 A3 SuperPoD)

Paper-reported (arXiv 2506.12708v3): 384 Ascend 910C NPUs and 192 Kunpeng CPUs in 48 nodes; each node has 8 NPUs, 4 CPUs and 7 on-board L1 UB switch chips; 16 racks = 12 compute racks (4 nodes / 32 NPUs each) + 4 communication racks holding the L2 UB switches. The L2 tier is non-blocking and split into 7 independent sub-planes of 16 L2 UB chips × 48 ports. Each node's 7 L1 chips map one-to-one onto the 7 sub-planes and each L1 chip sends one link to every L2 chip of its sub-plane (16 uplinks). Each 910C die has 7 UB transceivers and one RDMA interface; three planes (UB scale-up, RDMA/RoCE scale-out, VPC via the Qingtian DPU). The paper body does not state the per-NPU UB bandwidth; The Register gives 14 UB links × 28 GB/s per NPU.

Derived arithmetic (all `confidence: derived`, derivation stored on the record):

| Quantity | Arithmetic | Value | Cross-check |
|---|---|---|---|
| L1 UB switch chips | 48 nodes × 7 | **336** | — |
| L2 UB switch chips | 7 sub-planes × 16 | **112** | — |
| L1–L2 links | 336 × 16 uplinks | **5,376** | = 112 L2 chips × 48 ports → every L2 port used, no spares |
| Links per sub-plane | 16 L2 chips × 48 ports | **768** | = 48 nodes × 16 |
| Transceiver ends on L1–L2 links | 5,376 × 2 | **10,752** | one transceiver per link end assumed |
| Uplinks per node | 7 × 16 | **112** | = 8 NPUs × 14 UB links → matches "uplink precisely matches internal UB capacity" (CPU UB links ignored) |
| NPU-side UB links | 384 × 14 | **5,376** | numerically equal to the L1–L2 link count by non-blocking design; different physical links |
| Per-NPU UB bandwidth | 14 × 28 GB/s | **392 GB/s** (3.136 Tbps; 224 Gbps/link) | SemiAnalysis relay: 2.8 Tbps = 7 × 400G module rate (see §5) |
| Atlas 950 NPUs per compute cabinet | 8,192 / 128 | 64 | stated directly in the MWC 2026 release |
| Atlas 960 NPUs per compute cabinet | 15,488 / 176 | 88 | not stated by Huawei; density or cabinet definition differs from Atlas 950 |
| Atlas 950 SuperCluster | 64 × 8,192; 64 × 160 | 524,288 NPUs; 10,240 cabinets | keynote: "52 万多" chips, ">10,000 cabinets" |
| Slow-node minimum detection latency | 3 consecutive × 30 s | ≥ 90 s | excludes data cleaning and scheduling |
| Calchas HBM2 UER rate | 3,334 / (60,000 × 2.25 yr) | 0.0247 per stack-year (upper bound) | 910C: 8 stacks → ≈ 0.2 UER per NPU-year ≈ 2.3e-5 per NPU·h |
| Llama 3 network interruption rate | 35 / (16,384 × 54 × 24) | 1.65e-6 per GPU·h | NIC: 7 → 3.3e-7 per GPU·h |

Blast-radius reading for the RBD: an L1–L2 link or L2 port fault removes 1/16 of one sub-plane's capacity for one node pair (non-blocking → no spare capacity, so it is a hotspot, not a loss of connectivity); an L2 chip fault removes 1/16 of a sub-plane for all 48 nodes; an L1 chip fault is a node-level event (on-board, not hot-swappable); a communication-rack power/cooling event is a common-cause event for ~28 L2 chips (placement of sub-planes across the 4 racks is not public); a compute-rack event takes 4 nodes / 32 NPUs (64 on Atlas 950).

## 4. Unknowns and assumptions

No public, Ascend-specific value exists for any of the following. Each line gives the suggested analogue (existing library ids where available), the multiplier rationale, and the confidence the resulting scenario parameter should carry (`assumed` unless stated).

1. **Ascend 910C per-NPU failure / interruption rate.** Analogues: `gpu.interruption_rate.llama3_h100` (1.97e-5 per GPU·h, job-level unplanned interruptions, all causes; GPU-class share 58.7 % → ≈1.2e-5 per GPU·h; `composition.llama3.gpu_class_share`), `gpu.mtbf.coreweave_converted` (90,000 GPU·h, vendor), `gpu.mtbf.rsc1_converted` / `gpu.mtbf.rsc2_converted` (29,500 / 82,000 GPU·h node-level, A100), `gpu.mtbe.lablup_converted` (B200 Xid). Rationale for multipliers: the 910C is a dual-die package with 8 HBM stacks (records `ascend.cm384.dies_per_npu`, `ascend.cm384.hbm_stacks_per_npu`) versus one die and 5 active HBM3 stacks on H100, so scale the HBM share (Llama 3: 17.2 %, `composition.llama3.hbm3_share`) by 8/5 = 1.6 and the die-level share by 2; process maturity (SMIC N+2) is unknown. Suggested scenario range: 1×–3× the H100 GPU-class rate, i.e. 1.2e-5 to 3.5e-5 per NPU·h, with the Calchas upper bound (`hbm.uer_rate.calchas_derived`, ≈2.3e-5 UER per NPU·h for 8 HBM2 stacks, not all of which interrupt) as the HBM sanity check. Huawei's own fleet of >300 Atlas 900 A3 SuperPoDs (`ascend.atlas900a3.deployed_units`) has no published failure data.
2. **UB L2 switch chip failure rate.** Analogues: `switch.tor_critical_error_rate.hpn` (0.051 %/month per ToR ≈ 7.0e-7 per chip·h), `switch.survival_3month.msft_ccr2021` (98 % survive 3 months; early-life), `ocs.failure_rate.tpuv4` (0.04 %/day ≈ 1.7e-5/h; MEMS optical switch, upper bound), `switch.stacked_tor_severe_failure_share.hpn` (ToR single-point lesson). Rationale: the L2 UB chip is a 48-port ASIC with per-port optics, closer to a ToR ASIC than to an OCS; suggest 1×–3× the HPN ToR rate (7e-7 to 2e-6 per chip·h) → for 112 chips 0.06–0.17 failures per supernode-month. Blast radius 1/16 of one sub-plane (bandwidth), modelled as a degraded state, not an outage, unless HCCL cannot run degraded (unknown; `ascend.mindcluster.operator_level_coverage` says HCCS link-down is handled by BGP switching + operator retransmission).
3. **UB L1 on-board switch chip failure rate.** No analogue (NVSwitch field rates are not public; `nvlink_nvswitch.error_count.delta_a100` and `composition.acme.nvlink_error_share_gpu_time` are error counts, not chip failure rates). Suggest the same per-chip rate as item 2 with node-level blast radius (336 chips → 0.2–0.5 node-level events per supernode-month at 1×–3× HPN ToR), confidence `assumed`.
4. **LPO optical module / L1–L2 link failure rate.** Analogues: `nic_optics.nic_tor_link_failure_rate.hpn` (0.057 %/month per NIC–ToR link ≈ 7.8e-7 per link·h, includes NIC + optics + cable + ports), `nic_optics.optical_module_afr.huawei_traditional` (4‰/yr per module ≈ 4.6e-7 per module·h, vendor), `ici_cable.failure_rate.tpuv4` (0.005 %/day ≈ 2.1e-6 per cable·h), `nic_optics.defective_ib_link_ratio.superbench_tropical` (35× site dependence), `nic_optics.port_alert_count.imbue` (1,800 alerts / ≈10,000 IB links). Rationale: with 5,376 links × 7.8e-7/h (HPN) ≈ 4.2e-3 link failures per supernode-hour (one per ≈10 days) or 10,752 ends × 4.6e-7/h (Huawei 4‰) ≈ 4.9e-3/h (one per ≈8.5 days) — the two analogues agree within 20 %. LPO has no DSP (fewer active components) but relies on host SerDes equalisation; no public LPO field data → multiplier 0.5×–2× of the DSP-module AFR, `assumed`. UnifiedBus 2.0's "100 times more reliable" and 100-ns switchover (`ascend.ub2.*`) apply to Atlas 950 and later and should be a sensitivity scenario, never the baseline for CM384.
5. **Link-flap rate and P(interruption | flap).** Flap rate has no usable denominator (`nic_optics.link_flap_count_per_day.hpn`: 5K–60K/day fleet-wide; `nic_optics.link_flap_rate.mrc_clusterA` is a placeholder). Huawei claims the supernode tolerates >99 % of optical-module flaps (`ascend.huaweicloud.optical_flap_tolerance`) → P(interruption | flap) ≤ 0.01 as a vendor-claimed lower bound; the Snt9b23 document (`ascend.huaweicloud.hccs_l1_l2_flap_behavior`) states the opposite outcome exists (packet loss → job interruption → checkpoint rollback) and that RoCE-plane flaps shorter than 30 s are absorbed (`ascend.huaweicloud.roce_flap_threshold`). Flaps are a fail-slow / dual-path MTTR event class; keep them out of the failure-rate sum.
6. **Recovery rung times and rung success probabilities.** Vendor-claimed best cases via QbitAI: operator-level (no time given; HCCL re-execution ≈95 % success, `ascend.huaweicloud.hccl_reexec_success`), process-level online 30 s, process-level rescheduling 3 min, job-level 10 min for a 10k-card job, step-level HBM multi-bit ECC <1 min, inference token retry <10 s, instance restart <5 min (`ascend.huaweicloud.recovery_*`). Library analogues for the restart stage: `recovery_stage.restart.megascale_nccl_init.baseline` (1,047 s), `recovery_stage.network_error_tr.acme` (592 min). Rationale: treat vendor times as p10, use lognormal with median 2× and p90 5× the claim until measured; success probabilities of the lower rungs are unknown (use 0.95 from the HCCL figure for operator-level, `assumed` 0.8 for process-level online, remainder falls through per the documented fall-back order, `ascend.mindcluster.recovery_ladder_levels`). The rank-0 rule (`ascend.mindcluster.rank0_rule`) forces 1/48 of node faults to the job-level rung on a 48-node supernode.
7. **Spare-server dependence.** Process- and pod-level rescheduling require backup redundant compute servers (`ascend.mindcluster.process_level_rescheduling_dependence`); without them the job scales in (elastic training). No Ascend spare ratio is public; use the `spares` class and `switch.spare_downlinks_per_tor.hpn` (8 spare ports per ToR for standby machines) as reference points, and make the spare-node count a scenario variable (e.g., 1 standby node per 48 ≈ 2 %).
8. **Sub-health / slow-node fraction.** Only the detector parameters are public (`ascend.mindcluster.slow_node_*`: 30 % degradation, 3 × 30 s). Analogue for the fraction of affected machines: `failslow.straggler_fraction.megascale` (0.5 %) and `failslow.mfu_gain_after_straggler_removal.megascale`. Sub-health is a fail-slow class (fault level `SubHealthFault`, code 110001010), not an interruption.
9. **Cooling and power.** No Ascend data; analogues `cooling.loop_availability.calce_baseline` / `calce_improved`, `cooling.fleet_uptime.google_liquid_cooling`, `psu_power.failure_rate.placeholder`. The 4 communication racks are the main common-cause exposure (item 2 blast radius).
10. **Availability 口径.** Huawei Cloud's 98 % (`ascend.huaweicloud.training_availability_10k`) counts days on which training can start; the Atlas 960E 99.8 % (`ascend.atlas960e.system_availability`) is undefined system availability; 99.95 % is a stated requirement (`ascend.huaweicloud.inference_availability_requirement`). None is a goodput or ETTR number (compare `job.effective_training_time.llama3` 90 %, `job.ettr.megascale` 90 %, `cluster.availability.tpuv4` 99.98 %).

## 5. Discrepancies between sources

1. **6,912 transceivers vs 5,376 links × 2 = 10,752 ends.** SemiAnalysis (public preview) says "6,912 400G LPO transceivers ... the vast majority for the scaleup network" — 400G, not the 800G quoted by some secondary sources. The FiberMall relay splits this into 5,376 scale-up + 1,536 scale-out (384 NIC + 768 leaf + 384 spine). The scale-up 5,376 is 2 × 2,688 = 2 × (384 NPUs × 7 modules), i.e. a model with seven 400G modules per NPU mirrored on the switch side in a single-layer flat topology. The paper instead describes on-board L1 chips (NPU→L1 links on the board, not pluggable optics) and 5,376 inter-rack L1→L2 links, which need 10,752 ends if each end carries its own transceiver. The equality 5,376 = 5,376 is a consequence of the non-blocking design (8 × 14 = 7 × 16 per node), not evidence that the two sources count the same objects. Module count also depends on lane bundling (one 400G module may carry more than one 224 Gbps UB lane), which no source specifies. Both counts are kept, as `derived` (paper) and `scan-level` (SemiAnalysis).
2. **Per-NPU UB bandwidth: 392 GB/s vs 2.8 Tbps.** 14 × 28 GB/s = 392 GB/s = 3.136 Tbps (The Register; 224 Gbps per link, matching FiberMall's "7 × 224 Gbps per die"); SemiAnalysis's 2.8 Tbps (350 GB/s) is 7 × 400G module capacity. The paper body does not state either number (figures only). Different 口径 (link signalling rate vs module nominal rate); not an error in either.
3. **"100 ns" vs 百纳秒级.** The English keynote says "100-ns-level fault detection and protection switching on optical paths"; the Chinese keynote says 百纳秒级 ("hundreds-of-nanoseconds level"). Recorded as 100 ns with an order-of-magnitude note. Not tied explicitly to UnifiedBus 2.0 in the speech text; the association is by context (the UB 2.0 release in the same keynote).
4. **"100 times more reliable".** Baseline and metric unstated; SDxCentral paraphrases it as a hundredfold increase in optical-interconnect reliability; a 2025 Mobile World Live item attributes a separate "2× reliability" to cooling design (not recorded).
5. **Atlas 960 SuperPoD (15,488 NPUs, 220 cabinets, Q4 2027) vs Atlas 960E SuperPoD (4,096 NPUs, NPO, 2026).** Different products from different years; several outlets conflate them. Both recorded separately.
6. **"Doubling fault-free operating time" vs "MTBF doubled".** Huawei's text says fault-free operating time doubles; some press rewrites it as MTBF. Recorded under the vendor wording as a ratio claim.
7. **98 % vs 99.8 % vs 99.95 %.** Three different 口径 (training-start days for a 10k-card cluster; undefined system availability for a 4,096-NPU SuperPoD; a requirement for inference). Not comparable; see §4 item 10.
8. **Optical-module interruptions: 60/yr vs "every 3.6 days".** The encyclopedia page says ~60 interruptions per year in a >10,000-card cluster; search snippets of the unfetchable StarryLink page say "every 3.6 days" (≈100/yr) with ~2 h average recovery. Only the fetched 60/yr is recorded.
9. **Step 级重调度 vs step-level recomputation.** QbitAI calls the HBM multi-bit ECC path "Step 级重调度"; MindCluster 7.3 documents the same behaviour as process-level online recovery / "step-level recomputation recovery" (isolate the faulty memory, retry the step; disabled by default). Recorded as the vendor time claim with the mapping in the caveat.
10. **16 PB/s vs 16.3 PB/s.** Both appear in the keynote; 16.3 PB/s recorded (also in ITHome's relay).
11. **Paper "Ascend 910" vs press "910C".** The paper writes "Ascend 910"; The Register, SemiAnalysis and Huawei's own keynote write 910C. Treated as the same part.
12. **Cabinet counts.** Before the keynote text was fetched, 160 = 128 + 32 and 220 = 176 + 44 were visible only in secondary blogs; the Xu keynote (en and cn) confirms both splits, so they are `vendor`, not `scan-level`.

## 6. Existing library records usable as analogues (by class)

- `nic_optics`: `nic_optics.defective_ib_link_ratio.superbench_tropical` (35×, site dependence), `nic_optics.port_alert_count.imbue` (1,800 alerts / ≈10,000 IB links), `nic_optics.link_flap_rate.mrc_clusterA` (placeholder), `nic_optics.optical_module_flap_rate.placeholder`, `nic_optics.nic_failure_rate.placeholder`.
- `switch`: `switch.stacked_tor_severe_failure_share.hpn` (>40 % of severe failures), `switch.spare_downlinks_per_tor.hpn` (8), `switch.failure_rate.placeholder`.
- `nvlink_nvswitch`: `nvlink_nvswitch.error_count.delta_a100` (1,922 NVLink errors / 448 GPU × 895 d), `nvlink_nvswitch.error_count.delta_gh200` (0), `nvlink_nvswitch.failure_rate.placeholder`; plus `composition.acme.nvlink_error_share_gpu_time` (30.25 % of failed GPU time).
- `ocs`: `ocs.failure_rate.tpuv4` (0.04 %/day) — analogue for a centralised switching element with pod-wide blast radius.
- `ici_cable`: `ici_cable.failure_rate.tpuv4` (0.005 %/day) — analogue for an inter-node link.
- `gpu`: `gpu.interruption_rate.llama3_h100`, `gpu.mtbi.llama3_h100`, `gpu.mtbf.rsc1_converted`, `gpu.mtbf.rsc2_converted`, `gpu.mtbf.coreweave_converted`, `gpu.mtbf.nebius_mean_converted`, `gpu.mtbe.lablup_converted`, `gpu.xid_count.fireflyer`.
- `hbm`: `hbm.ce_count.calchas`, `hbm.ueo_count.calchas`, `hbm.uer_count.calchas`, `hbm.banks_with_ce_and_uer.calchas`, `hbm.uer_cluster_within_1h.calchas` (HBM2 on Huawei DSAs — the only Huawei-silicon memory data in the library), `hbm.dbe_rate.ampere_*`, `hbm.mtbe_uncorrectable.delta_h100`, `hbm.a100_sdc_fit.micro21`.
- `host`: `host.crash_rate.vela` (2 %/month), `host.failure_rate.imbue` (3 %/week), `host.mtbf.imbue_fleet`.
- `psu_power`: `psu_power.failure_rate.placeholder` only.
- `cooling`: `cooling.loop_availability.calce_baseline` (0.9932), `cooling.loop_availability.calce_improved` (0.9997), `cooling.fleet_uptime.google_liquid_cooling` (99.999 %).

## 7. Merge notes

- `class: ascend`, `kind: bandwidth` and `kind: claim`, and the units `GB/s`, `Gbps`, `PB/s`, `Tbps`, `ns`, `us`, `m`, `m2`, `code`, `n/a` are not in `library.json`'s `vocab`; add them (or map them) before merging. `recordToFailureRate` already understands `per_year`, `pct_per_month`, `per_day`, `per_gpu_h`, so the nine `failure_rate` records load as component rates.
- `confidence` is restricted to {paper-reported, vendor, derived, assumed, scan-level} as requested; HPN / Llama 3 / Microsoft field statistics are therefore `paper-reported` here even though the library would normally call production measurements `measured`.
- `survey_ref` is null on every record (these facts are not from the survey chapter).
- No existing file was modified; `data-staging/` is git-ignored.
