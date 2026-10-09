# HAC-D parameter library report (library.json v0.1, generated 2026-10-08)

Source: survey chapter `ai-cluster-reliability-modeling.html (2026-10-08)` via `survey_text.txt`; only the line ranges named in the task were read (Tables 2-2, 3-1, 3-2, 4-2, 5-1, 6-2, 6-3/6-4, 7-1/7-2/7-3, references). `corpus.json` was used read-only to confirm three URLs (CoreWeave whitepaper, original Google Cloud URL of the Ironwood post, and to establish that the Di et al. SC'14, LANL power-event thesis and Frontier CUG'24 items have no resolvable URL).

Total records: **531** (9 placeholders with `confidence: "assumed"`).

## Counts per class × confidence

| class | total | measured | paper-reported | vendor | derived | scan-level | assumed |
|---|---:|---:|---:|---:|---:|---:|---:|
| recovery_stage | 131 | 103 | 7 | 13 | 2 | 5 | 1 |
| composition | 62 | 48 | 10 | 4 | 0 | 0 | 0 |
| job | 50 | 35 | 2 | 8 | 3 | 2 | 0 |
| sdc | 43 | 29 | 10 | 0 | 4 | 0 | 0 |
| hbm | 32 | 26 | 4 | 0 | 2 | 0 | 0 |
| screening | 31 | 29 | 2 | 0 | 0 | 0 | 0 |
| checkpoint | 29 | 10 | 11 | 2 | 6 | 0 | 0 |
| cluster | 28 | 14 | 7 | 2 | 3 | 2 | 0 |
| spares | 28 | 8 | 17 | 2 | 1 | 0 | 0 |
| gpu | 22 | 10 | 0 | 1 | 11 | 0 | 0 |
| prediction | 22 | 19 | 2 | 0 | 1 | 0 | 0 |
| node | 14 | 10 | 1 | 0 | 3 | 0 | 0 |
| host | 6 | 4 | 0 | 0 | 2 | 0 | 0 |
| nic_optics | 5 | 3 | 0 | 0 | 0 | 0 | 2 |
| failslow | 5 | 5 | 0 | 0 | 0 | 0 | 0 |
| ccf | 5 | 3 | 2 | 0 | 0 | 0 | 0 |
| cooling | 4 | 0 | 2 | 1 | 0 | 0 | 1 |
| switch | 3 | 2 | 0 | 0 | 0 | 0 | 1 |
| software | 3 | 2 | 0 | 0 | 0 | 0 | 1 |
| nvlink_nvswitch | 3 | 2 | 0 | 0 | 0 | 0 | 1 |
| tpu_machine | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| ici_cable | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| ocs | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| psu_power | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| storage | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| **all** | **531** | **365** | **77** | **33** | **38** | **9** | **9** |

## Confidence policy actually applied

- `measured`: 一手直接观测（同行评审论文或运营方技术报告/日志/博客），综述未另标
- `paper-reported`: 综述标「论文报告/摘要报告/预期」，或来源自身的模型/仿真/注入/演示值而非现场观测
- `vendor`: 综述标「厂商自述/厂商自报」或厂商自家产品的博客/白皮书
- `derived`: 由其他数字推算（综述「本章推算/记录核验者推算/反推」、Epoch 反推或来源的简单换算），derivation 给算式
- `scan-level`: 综述标「扫描级」，只取摘要数字
- `assumed`: 占位记录，value 为 null

Precedence when several could apply: survey flag (`scan-level` > `vendor` > `paper-reported`) wins over the nature of the number; `derived` is used for any value obtained by arithmetic from other reported numbers (the `derivation` field names who computed it: 本章 / 记录核验者 / Epoch / the paper); `measured` is reserved for direct observations. Operator technical reports, logbooks and blogs that the survey treats as first-hand data (Llama 3, Gemini 2.5, IBM Vela, Imbue, OPT logbook, Lablup, Meta engineering blogs) are `measured` with the venue recorded, so peer-review status can be filtered on `provenance.venue`.

## Vocabulary extensions beyond the task's lists

- class: added `job` (job-level counts, MTTF/MTBI, ETTR/goodput) and `cluster` (system-level MTBF/MTBE/availability/counts). `storage`, `software` and `switch` placeholders were added beyond Table 4-2's missing-class list because the survey asks for them as common-cause basic events.
- kind: added `duration` for non-MTTR time quantities (test rounds, checkpoint intervals, lead times).
- unit: added `pct_per_day`, `pct_per_week`, `pct_per_month`, `pct_per_quarter`, `per_day`, `per_h`, `per_min`, `per_year`, `per_job_day`, `per_job_s`, `per_gpu_day`, `per_socket_year`, `socket_h_per_event`, `processor_h_per_event`, `months`, `permyriad`, `x`, `normalized`, `iteration`, `count`. Percentages are kept in the survey's printed form (unit `pct`) to avoid conversion errors, so the TPU daily rates use `pct_per_day` rather than `per_device_day` (which appears only as the nominal unit of three placeholders); From the given unit list, `per_1e6_gpu_h`, `per_node_day`, `per_quarter`, `per_month` and `per_week` were not needed (host rates are kept as `pct_per_month` / `pct_per_week`; the Vela host MTBF uses `months`).
- applicability: `stage` (detect | localize | remediate | restart | load | recompute | warmup | serving_restart | end_to_end), `setting`, `variant` (baseline | optimized). `end_to_end` was added for whole-recovery times that the survey does not split into stages.

## Records where a field could not be filled

### value is null (non-placeholder)

- `job.ettr.rsc1_cluster` — range only (0.85–0.9 fraction)
- `cluster.hw_interruption_rate.gemini25` — qualitative only: 原文定性：每小时多次
- `recovery_stage.restart.gemini25_elastic` — qualitative only: 数十秒
- `sdc.expected_frequency.gemini1` — range only (7–14 days)
- `gpu.mtbf.sigma_early_life` — range only (7300–9300 gpu_h_per_event)
- `failslow.pcie_degradation_slowdown.vela` — range only (None–2 x)
- `composition.dgxcloud.ub_timeout_weekly` — range only (14–50 pct)
- `composition.dgxcloud.uecc_typical` — range only (4–19 pct)
- `spares.spare_fraction.imbue` — range only (10–20 pct)
- `checkpoint.save_overhead.lablup` — range only (0.22–0.61 pct)
- `hbm.dbe_rate_spread_by_event.ampere` — range only (2.4–12 x)
- `hbm.error_interarrival_cv.ampere` — range only (1.31–3.86 x)
- `cluster.mtbf.gupta_normalized_range` — range only (7.45–22.67 h)
- `node.failure_rate.lanl_per_system_range` — range only (17–1159 per_year)
- `composition.lanl.hardware_share_range` — range only (30–60 pct)
- `recovery_stage.end_to_end.ascend_training_rto` — qualitative only: 分钟级
- `recovery_stage.job_recovery_automated.range` — range only (None–25 min)
- `recovery_stage.job_recovery_manual.range` — range only (70–None min)
- `recovery_stage.node_repair.range` — range only (12–None min)
- `recovery_stage.detect.byterobust_nccl_timeout.baseline` — range only (30–60 min)
- `recovery_stage.detect.byterobust_inspection.optimized` — range only (2–60 s)
- `recovery_stage.detect.flashrecovery.optimized` — range only (4–11 s)
- `recovery_stage.detect.huawei_online_diag.baseline` — qualitative only: 数小时到数天
- `recovery_stage.localize.holmes.optimized` — range only (15.5–30.3 s)
- `recovery_stage.localize.ccld.optimized` — range only (0.108–60 s)
- `recovery_stage.localize.argus_l1_l2.optimized` — qualitative only: 秒级
- `recovery_stage.localize.argus_l3.optimized` — qualitative only: 分钟级
- `recovery_stage.remediate.byterobust_requeue.baseline` — range only (454–768 s)
- `recovery_stage.remediate.byterobust_hot_update.optimized` — range only (46–65 s)
- `recovery_stage.remediate.trainmover_unexpected_failure.optimized` — range only (19.8–21.1 s)
- `recovery_stage.remediate.gemini_sosp_machine_replacement` — range only (4–7 min)
- `recovery_stage.remediate.guard_sweep` — range only (1–2 h)
- `recovery_stage.restart.flashrecovery.optimized` — range only (78–116 s)
- `recovery_stage.restart.bootseer_startup.baseline` — range only (6–7 min)
- `recovery_stage.startup_reduction.bootseer` — range only (36–52 pct)
- `recovery_stage.restart.huawei_industry_rto.baseline` — range only (20–30 min)
- `recovery_stage.restart.huawei_link_build.baseline` — range only (10–20 min)
- `recovery_stage.restart.huawei_rto_level3_4.optimized` — range only (3–5 min)
- `recovery_stage.restart.sagemaker_hyperpod` — range only (15–30 min)
- `checkpoint.save_mfu.byterobust.baseline` — range only (39.11–43.07 pct)
- `checkpoint.save_mfu.byterobust.optimized` — range only (99.11–99.71 pct)
- `recovery_stage.load.trainmover_p2p.optimized` — range only (6–9 s)
- `recovery_stage.load.jit_checkpoint.baseline` — qualitative only: 数分钟/GPU
- `recovery_stage.load.jit_checkpoint.optimized` — qualitative only: 数秒/GPU
- `recovery_stage.warmup.argus_jit_microbatch_normal` — range only (0.095–0.16 s)
- `spares.spare_cubes.ironwood_derived` — range only (14–19 count)
- `spares.spare_nodes_per_1000.scr` — range only (1–2 count)
- `prediction.recall_at_2pct.gpu_pred` — range only (7.1–17.4 pct)
- `prediction.top10pct_hosts_failure_share.hearank` — range only (24–33 pct)
- `screening.cadence.fleetscanner` — range only (45–60 days)
- `sdc.cpu_sdc_count.meta_2021` — qualitative only: 数百颗 / 数十万台（数量级）
- `sdc.mercurial_core_density.hotos21` — qualitative only: 数量级描述，无确切分母
- `sdc.cpu_incidence_by_microarch.farron` — range only (0.082–9.29 permyriad)
- `sdc.crash_vs_sdc_ratio.veritas` — range only (2–3 x)
- `sdc.detection_overhead.online_check_range` — range only (0.86–2.6 pct)
- `sdc.per_gpu_observed_rate_range.sdchunter` — range only (1e-06–100 pct)
- `nic_optics.link_flap_rate.mrc_clusterA` — range only (1–13 per_min)
- `ccf.post_power_event_failure_multiplier.lanl` — range only (5–10 x)

### provenance.url is null

- `checkpoint.recovery_loss_share.survey_16384` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (§4 敏感性 paragraph; ref survey text)
- `checkpoint.ckpt_recompute_loss_share.survey_16384` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (§4 敏感性 paragraph; ref survey text)
- `recovery_stage.job_recovery_automated.range` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 3-2; ref survey text)
- `recovery_stage.job_recovery_manual.range` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 3-2; ref survey text)
- `recovery_stage.node_repair.range` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 3-2; ref survey text)
- `checkpoint.cost.fti_l1` — source: Di et al., multilevel checkpoint model, SC 2014 extension of the IPDPS 2014 work (FTI) (Table 6-2; ref [89] lists only the IPDPS 2014 paper; the SC 2014 extension has no URL in the survey references)
- `checkpoint.cost.fti_l2` — source: Di et al., multilevel checkpoint model, SC 2014 extension of the IPDPS 2014 work (FTI) (Table 6-2; ref [89] lists only the IPDPS 2014 paper; the SC 2014 extension has no URL in the survey references)
- `checkpoint.cost.fti_l3` — source: Di et al., multilevel checkpoint model, SC 2014 extension of the IPDPS 2014 work (FTI) (Table 6-2; ref [89] lists only the IPDPS 2014 paper; the SC 2014 extension has no URL in the survey references)
- `checkpoint.cost.fti_l4` — source: Di et al., multilevel checkpoint model, SC 2014 extension of the IPDPS 2014 work (FTI) (Table 6-2; ref [89] lists only the IPDPS 2014 paper; the SC 2014 extension has no URL in the survey references)
- `ccf.post_power_event_failure_multiplier.lanl` — source: LANL 2000s CPU-cluster study of hardware failures after power events (survey cites 'thesis') (Table 4-2; ref Table 4-2 'thesis' marker; no matching entry in the survey reference list)
- `nvlink_nvswitch.failure_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 4-2 缺失或口径不明; ref survey text)
- `nic_optics.optical_module_flap_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 4-2 缺失或口径不明; ref survey text)
- `nic_optics.nic_failure_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 4-2 缺失或口径不明; ref survey text)
- `psu_power.failure_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 4-2 缺失或口径不明; ref survey text)
- `cooling.failure_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 4-2 缺失或口径不明; ref survey text)
- `switch.failure_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 3-2 相关故障; Table 3-1 HPN; ref survey text)
- `storage.failure_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 3-2 相关故障; ref survey text)
- `software.failure_rate.placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 3-1; ref survey text)
- `recovery_stage.mttr_distribution.ai_cluster_placeholder` — source: ai-cluster-reliability-modeling.html (survey chapter's own calculation) (Table 4-2 MTTR 分布; ref survey text)

### Table cells lost in the survey text extraction (number dropped before the source marker; not recorded rather than guessed)

- Table 5-1 MegaScale: NCCL initialization optimized value (only the 1047 s baseline survived) — recorded baseline only.
- Table 3-2 / Table 5-1: MegaScale 「检测+诊断」 time and LongCat-Flash 「恢复」 time in the automated-recovery tier — tier recorded as a range with these members named in the caveat.
- Table 5-1 Mycroft localization: cell reads only 「RCA 100%」 (time value missing) — not recorded.
- Table 5-1 Aegis: 「离线 CBD」 figure missing — only the 77% → ≈100% runtime-diagnosis share recorded.
- Table 5-1 ARGUS: overhead figure missing — only L1/L2 seconds and L3 minutes recorded (value null).
- Table 5-1 GEMINI (SOSP'23) save/load: optimized 「每 iteration；ckpt …」 figure missing — baseline 81 s recorded only.
- Table 5-1 Huawei 10k-card recovery: optimized 「建链」 figure missing.
- Table 5-1 Huawei MoE inference: optimized value missing (only 「实例重启 20+ min」 baseline).
- Table 5-1 SageMaker HyperPod: only one of the two time cells survived (15–30 min); recorded with `variant` unset and the ambiguity in the caveat.
- Table 3-1 Minder: 「任务级日故障数随机器规模从约 0.7（…」 truncated — the per-task daily failure count vs. machine-scale curve is not recorded.
- Table 3-1 Meta engineering blog 2024-06: 「image-5 合计约 4.6k（读图，口径不明）」 — excluded because the survey itself marks the basis as undefined.
- Table 3-1 TSGuard 「复发率 GPU 8.78」 — unit/definition not given in the survey; excluded.

### Deliberately excluded (not parameters, or survey says not usable)

- Model projections/outputs that are not inputs: RSC 「12,000 GPU 作业要达到 ETTR ≈ 0.9 需 r_f → 约 1 或 checkpoint → 约 10 s」; TrainMover ETTR 97.94% (8K) → 68.21% (128K) and standby savings 35.91% / 55%; FT-HSDP 44% → 80%; SPARe 426 masked failures at 2.8×; SCR multi-level efficiency >75% / 26%; Meta sparing TPS scale 1.18/1.12/1.02 and goodput 61,134 vs 59,821. (Mentioned here so they can be added later if HAC-D wants calibration targets.)
- SCR aggregate write bandwidths (GB/s) and Lustre design peak — not reliability parameters.
- LongCat-2.0 「日均故障率万分之 15.7 → 万分之 4.4」 and 「MFU 17.8% → 27.68%」 — survey states these appear only in third-party summaries and on no Meituan page; the official 「>70%」 reduction is recorded with a heavy caveat instead.
- DeepSeek-V3 (2.664M GPU·h, no failure numbers disclosed) and Alibaba HPN qualitative items beyond the two switch records.
- Veritas VFADD 5954× (instruction-type stress ratio) and Farron temperature threshold 59°C — not cluster-level parameters; kept in caveats.

## Placeholder (assumed) records

- `nvlink_nvswitch.failure_rate.placeholder` (nvlink_nvswitch) — Survey marks 'missing': no failure rate. Qualitative evidence: IBM Vela calls it the second source of host crashes without a share; Delta A100 1,922 NVLink errors (0 on GH200, error counts); Fire-Flyer Xid74 42.57% of Xid (paper-reported); Acme NVLink Error 30.25% of failed GPU time; Lablup B200 5 of 17 XID events (29.4%)
- `nic_optics.optical_module_flap_rate.placeholder` (nic_optics) — Survey marks 'missing': no per-module flap rate. Evidence: MRC Cluster A cluster-level T0–T1 flaps ≈1–13/min; CloudMatrix384 report leaves 'optical module failure rate is X× the NPU' unfilled; SuperBench 35× defective IB links in tropical DCs; Imbue ≈1,800 port alerts on ≈10,000 links; Llama 3 Switch/Cable 8.4%; SIGMA Platform B IB flaps 12.4%
- `nic_optics.nic_failure_rate.placeholder` (nic_optics) — Survey marks 'missing': no figure; MRC lists it as a remaining in-series single point of failure
- `psu_power.failure_rate.placeholder` (psu_power) — Survey marks 'common-cause multiplier only': no FIT; LANL 2000s CPU clusters saw 5–10× hardware failures in the month after power events (conditional-probability ratio, paper-reported, source marked 'thesis'); power should be a common-cause basic event
- `cooling.failure_rate.placeholder` (cooling) — Survey marks 'missing': no component failure rate; CALCE secondary-loop availability 0.9932 → 0.9997 (abstract only); Google liquid-cooling fleet uptime 99.999% (undefined denominator, self-reported); Acme saw clustered NVLink/ECC errors during a July 2023 heat episode (~5°C room rise); Titan hazard rose with distance from the cold-air inlet
- `switch.failure_rate.placeholder` (switch) — Placeholder added by this library (switches are not a Table 4-2 row). Evidence: Minder one switch reboot took 32 of 600 machines offline; HPN stacked dual-ToR caused >40% of severe failures and ToR single points crash synchronous jobs; Llama 3 Switch/Cable 8.4%; survey recommends switch domains as common-cause basic events
- `storage.failure_rate.placeholder` (storage) — Placeholder added by this library. Evidence: Blue Waters 29 of 39 system-wide outages involved the shared file system (abstract-level); ByteCheckpoint HDFS save 200 s / offline reshard 1870 s shape the recovery path; survey recommends storage as a common-cause basic event
- `software.failure_rate.placeholder` (software) — Placeholder added by this library: only composition shares exist, no per-GPU·h rate. Evidence: Blue Waters software 20% of failures / 53% of repair time (abstract-level); Minder software 28.0%; ByteRobust CUDA Error 36.1%, Job Hang 9.9%; Llama 3 software bugs sit inside the ~22% non-hardware interruptions; Delta GSP errors 3,857 → 3
- `recovery_stage.mttr_distribution.ai_cluster_placeholder` (recovery_stage) — Table 4-2's 'MTTR distribution' row only has the LANL CPU-cluster lognormal (mean 355 min, median 54 min; legacy reference); AI clusters have per-stage point values and ranges in §5 but no fittable full distribution; spare models should use quantiles

## Internal inconsistencies or tensions in the survey's own numbers

- **Titan K20X event counts.** Table 3-1: 「DBE+OTB 5,320（旧批）/ 127（新批）」 (sum 5,447). Table 4-2: 「OTB 1,127 次、DBE 3,093 次 / 19,319 块」 (sum 4,220). The two tables cite the same SC'20 paper but the totals differ by ~1,100–1,200; both are recorded as printed (`gpu.board_event_count.titan_*` vs `gpu.board_otb_count.titan` / `gpu.board_dbe_count.titan`) with a caveat. Also 18,688 GPUs (Table 3-1) vs 19,319 boards (Table 4-2) — the latter plausibly includes replacements, but the survey does not say so.
- **SCR Lustre cost.** Table 6-2: measured 「Lustre 1051 s」 vs model parameter 「Lustre 1052 s」; the formula note also uses 1052 s. The survey explains these are measured vs. model-input values, so both are recorded separately.
- **ByteRobust detection baseline.** Table 5-1: 「PyTorch-Distributed 约 10 min（正文 30 min）」 — the paper's table and body disagree; recorded 10 min with the discrepancy in the caveat (survey already notes it).
- **BootSeer speed-up.** Table 5-1: body text 「约 2×（50%）」 vs Fig. 11 「各规模降 36%–52%，128/512/1024 GPU 仅约 1.6–1.7×」 — recorded as the 36–52% range with the text claim in the caveat.
- **Google Ironwood k-of-n points.** Table 6-4: 「130 cube @95%，125 @99%（按原文公式复算，两点在同一 p 下不完全自洽）」 — survey's own check; both recorded as vendor values.
- **ByteDance GPU-prediction precision.** Table 7-1: body 84.0% vs abstract 85.4% — both recorded.
- **HeaRank host concentration.** §7: 「前 10% 主机跨季度稳定覆盖 24–33% 的故障」 vs 「超过 30% 的关键故障来自不到 10% 的主机」 — the 24–33% range dips below 30%; likely 'all failures' vs 'critical failures', but the survey does not say. Recorded the range with the second statement in the caveat.
- **Delta uncorrectable-ECC rate vs Ampere-paper DBE rate (cross-source, same site).** Table 3-2 row 「不可纠正 ECC（HBM）」 pairs Delta A100 MTBE 283,271 h (= 8.5×10^-5 per GPU·day) with the Ampere paper's Delta DBE rate 0.000027 per GPU·day — about 3× apart for the same cluster. Different windows (895 days vs 2023), definitions (XID-based uncorrectable errors vs DBE counts) and populations (the Ampere study's Delta includes 400 A40) explain it, but a user picking 'the Delta HBM UE rate' gets two numbers.
- **SuperBench MTBI.** Table 3-1 measured 「Azure A100 集群整体 MTBI 17.5 h」 vs Table 7-2 simulation 「MTBI 262.05 h vs 不验证 11.59 h」 — not contradictory (measured vs simulated), but the simulation's 'unvalidated' 11.59 h is below the measured 17.5 h for a cluster that was being validated; recorded with caveats.
- **Lablup windows.** Table 3-1 gives 「55 / 73 天」 for 「17 次 XID 事件；23 次异常终止」 and a job MTBF of 56.2 h (×23 = 1,293 h ≈ 54 days). The 56.2 h is therefore job-runtime-based, not wall-clock over 73 days; the survey does not state which window pairs with which count. Recorded as printed.
- **Arithmetic checks that passed** (recorded derivations re-computed here): Llama 3 54×24×16,384/419 = 50,676; RSC 1000×24×8/6.50 = 29,538 and /2.34 = 82,051; CoreWeave 3,748.25×24 = 89,958 and /1,024 = 3.66 d, 1/3.66 = 0.2732/d, /16,384 = 0.229 d; Nebius 33.0×3,000 = 99,000 and 56.6×3,000 = 169,800; Delta 1.4×448 = 627, 1.9×608 = 1,155; LANL 4096×8760/1159 = 30,963 and 8760/1159 = 7.56 h; Titan 14.51×18,688 = 271,163; SIGMA 24/5.52×{1,688; 2,144} = {7,339; 9,322}; Imbue 511×3% = 15.3/week → 11.0 h; Lablup 55×24/17 = 77.6 h, ×504 = 39,312; Blue Waters 261/39 = 6.69 d; LongCat 720/20 = 36 h; Farron (0.776+0.18+2.306)/3.61 = 90.36%; AEGIS 18/3.5e7 = 5.14e-7 and ≈1 per 8 days at 10k GPUs; PinDrop 0.0024%×1e5 = 2.4; Gemini 0.25%×6% = 1.5e-4; OPT 33/56 = 0.59; TrainMover 0.52+1.5+4.45 = 6.47; Delta H100 99.3% ↔ 10 min/day.

## Notes on specific provenance choices

- `composition.llama3.switch_cable_share` (8.4%): the survey's inline marker is 「blog」, which cannot be matched to a single reference-list entry; the record points to the Llama 3 report because the survey text says 「Llama 3 的中断分项里」.
- CoreWeave records use the August 2025 whitepaper URL found in corpus.json (the survey's reference [26] lists only the companion blog); the whitepaper is the stated origin of the 3,748.25 GPU·day fit.
- Google Ironwood records use the original cloud.google.com URL confirmed in corpus.json; the survey's reference [60] points to a CXO-Community mirror because the original was unreachable to the survey author.
- `checkpoint.cost.fti_l*` (Di et al. SC 2014) and `ccf.post_power_event_failure_multiplier.lanl` ('thesis') have `url: null` because neither item exists in the survey's reference list; the Frontier CUG 2024 figures are attached to the SC-W'23 DOI with the CUG paper noted as URL-less.
- Titan Weibull shapes 「约 5 / 7」 were paired with OTB and DBE in listing order (Table 4-2 does not label the pairing); see `distribution.note`.
- Meta Sparing demo parameters (tray 20K h, rack 10K h, MTTR 24 h) are `paper-reported` with 「演示值」 caveats rather than `assumed`, since `assumed` is reserved for empty placeholders.


## Ascend merge (2026-10-09, v2)

104 records from `data-staging/ascend/ascend-records.json` were merged (classes: {'ascend': 93, 'nic_optics': 7, 'switch': 3, 'hbm': 1}). Sources, discrepancies and the analogue assumptions are documented in `docs/ASCEND_SOURCES.md`. New vocab: class `ascend`, kinds `bandwidth` / `claim`, units GB/s, Gbps, PB/s, Tbps, code, m, m2, n/a, ns, pct_per_month, per_gpu_h, us.
