# Contribution of each fault-management mechanism to availability (2026-10-12)

Scenario: the reference three-class baseline (10,000-card interruption MTBF 30 h with linear scaling; sub-health 2 % and silent corruption 1.4 % of events; τ 300 s, δ 4 s; detection 95 % in 10 s else 60 s; recovery 180 s at 99 % else + 2 h manual; silent corruption 0 % immediate detection, 120 h fallback). Metric "availability" = operational availability A_op (running-time share, the reference's 运行可用度); delivered goodput (正确有效产出) alongside. HAC-D closed forms; reference = audited engine, 4000 30-day trials per scenario (`results.json`). Values in percentage points; "single" = mechanism alone on the baseline; "Shapley" = exact Shapley value over all 2⁸ coalitions of the eight parameterised mechanisms (HAC-D) or 2⁶ of six (reference, Monte Carlo).

## 1. Contribution to operational availability A_op

| Mechanism | 10k single HAC-D / ref | 100k single HAC-D / ref | 200k single HAC-D / ref | 500k single HAC-D / ref | 500k Shapley HAC-D |
|---|---:|---:|---:|---:|---:|
| D-HARD detection 99.9 % / 1 s | +0.011 / +0.011 | +0.101 / +0.100 | +0.193 / +0.194 | +0.420 / +0.417 | +0.364 |
| D-SLOW sub-health detection | −0.000 / −0.001 | −0.002 / −0.004 | −0.004 / −0.005 | −0.008 / +0.004 | −0.009 |
| D-SDC immediate SDC detection | −0.001 / −0.000 | −0.014 / −0.016 | −0.036 / −0.047 | −0.099 / −0.088 | −0.040 |
| R-SDC step recovery (given D-SDC) | +0.003 / +0.003 | +0.030 / +0.031 | +0.058 / +0.058 | +0.126 / +0.129 | +0.072 |
| R-REPLAY | +0.086 / +0.084 | +0.826 / +0.825 | +1.587 / +1.584 | +3.536 / +3.539 | +1.487 |
| R-PROCESS | +0.108 / +0.106 | +1.041 / +1.035 | +2.005 / +1.995 | +4.494 / +4.494 | +2.334 |
| R-ELASTIC | +0.156 / +0.156 | +1.517 / +1.510 | +2.936 / +2.931 | +6.669 / +6.671 | +3.848 |
| C-FAST | −0.000 / +0.000 | −0.000 / −0.001 | −0.000 / −0.002 | −0.001 / +0.003 | −0.000 |
| baseline A_op | 99.748 / 99.749 | 97.548 / 97.556 | 95.222 / 95.235 | 88.877 / 88.880 | |

Reading: A_op moves only through the downtime line. The three chain rungs are the levers (they shorten or remove the global recovery pause); detection of interruptions is worth 0.1–0.4 points at scale; detection of silent corruption and sub-health *cost* a little A_op (each detection adds a recovery pause) while they move the delivered goodput by tens of points; faster checkpoints do not touch A_op (saves are not downtime). Every single-mechanism figure agrees with the reference within 0.01 points.

## 2. Contribution to delivered goodput (正确有效产出)

| Mechanism | 100k single HAC-D / ref | 100k Shapley HAC-D / ref | 500k single HAC-D / ref | 500k Shapley HAC-D / ref |
|---|---:|---:|---:|---:|
| D-HARD | +0.048 / +0.035 | +0.057 / — | +0.037 / +0.080 | +0.163 / — |
| D-SLOW | +0.021 / +0.081 | +0.026 / — | +0.043 / −0.048 | +0.089 / — |
| D-SDC | +29.72 / +30.06 | +30.71 / +31.06 | +47.95 / +47.89 | +53.85 / +53.52 |
| R-SDC | 0 / 0 (given D-SDC +0.049 / +0.046) | +0.019 / +0.019 | 0 / 0 (given D-SDC +0.159 / +0.144) | +0.076 / +0.084 |
| R-REPLAY | +0.619 / +0.557 | +0.339 / +0.355 | +0.527 / +0.624 | +0.714 / +0.640 |
| R-PROCESS | +0.486 / +0.429 | +0.343 / +0.315 | +0.381 / +0.375 | +0.791 / +0.796 |
| R-ELASTIC | +1.081 / +1.498 | +0.815 / +0.247 | +0.900 / +1.088 | +2.039 / +1.371 |
| C-FAST | +0.283 / +0.262 | +0.167 / +0.178 | +0.405 / +0.476 | +0.830 / +0.999 |
| baseline | 62.61 / 62.56 | | 25.32 / 25.24 | |

The reference's single and Shapley values for D-SLOW and R-ELASTIC carry sampling error of ±0.05–0.6 points (their random streams desynchronise); everything else agrees within the reference's CI.

## 3. Combinations: per-event flags matter

| Cards | Six combined A_op: four-source / 54-event / ref | Six combined delivered: four-source / 54-event / ref |
|---:|---|---|
| 100,000 | 99.301 / 99.100 / 99.098 | 94.98 / 94.79 / 94.72 ± 0.19 |
| 500,000 | 96.598 / 95.656 / 95.665 | 83.45 / 82.63 / 82.79 ± 0.34 |

Single mechanisms are linear in the applicability fractions, so the four-source example (fractions per source) is exact for them. Coalitions are not: the catalog's flags are correlated per event (an event that process rescheduling can handle is also one elasticity can handle; optical-link events allow replay but neither), and treating the fractions as independent over-credits the combination by 0.2 points of A_op at 100k and 0.9 at 500k. The new built-in example `ref-catalog-100k` (one class per audited event, 54 classes, flags per event) reproduces the reference's combined scenario to 0.01 points. Use it for attribution and planning of combinations; keep the four-source example for allocation to sources. Decision of 2026-10-12: the Mechanisms page defaults to the catalog example (own scenario selector) and warns when a scenario declares per-class fractions.

## 4. Which factor of the availability formula each tool moves

Job-level formulas (docs/MODEL_REFERENCE.md §18–§20): A_run = 1/(1 + λ_rb R_rb + λ_p R_p); G ≈ 1 − δ/τ − (P_rb W + R̄)/M_ev (first order) or the mixed exact renewal; effective = G (1 − P_blocked) φ_job (1 − ℓ_local); delivered = [g E(clean) − U E(N)]/T with ν = λ_sdc (1 − q) A_run (1 − P_clear).

| Mechanism | Factor(s) moved | Direction and side effects |
|---|---|---|
| H-RELIABILITY (lower hardware rates), burn-in, lemon eviction | λᵢ → λ_rb, λ_p, M_ev | every term; also fewer SDC-clearing rollbacks (P_clear ↓, negligible) |
| H-PROTECT (redundancy, switchover) | residual λᵢ through k-of-n / parallel groups; switchover micro-outage | system availability and λ_job; no double credit when rates are already residual |
| D-HARD (detection coverage, time, timeout) | T_det inside R̄ (restart term R/M) | A_op and goodput; nothing else |
| D-SLOW (sub-health detection) | p_det, T_d → ν_iso (pause-only events) and φ_job | trades slow-down for isolation pauses: small A_op cost, goodput gain |
| D-SDC (immediate SDC detection q) | ν = λ_sdc(1 − q)·… (episode rate); adds detected-SDC rollback events to λ_rb | delivered goodput ↑ by tens of points; A_op ↓ slightly (extra recoveries) |
| R-SDC (step recovery) | detected-SDC events become pause-only (W → t_step, R → t_rec) | only with D-SDC |
| R-REPLAY | P_rb ↓ and R̄ ↓ (replay pause d + t_rp instead of d + G) | A_op and goodput; shifts events to λ_p |
| R-PROCESS | R̄ ↓ (pause d + t_pr), P_rb unchanged | A_op mainly |
| R-ELASTIC | P_rb ↓, R̄ ↓ (pause t_sync), ℓ_local ↑ (domain out for t_el / n_dom) | largest A_op lever; local loss small; P_clear ↓ |
| R-CKPT (automatic recovery time and success) | T_auto, p_s → G inside R̄; also the SDC episode pause R_c | A_op, goodput, delivered |
| R-MANUAL | (1 − p_s) T_manual inside R̄ | A_op, goodput |
| C-FAST (interval and save time) | δ/τ (save term), W = τ/2, U (pre-episode loss), P_clear | goodput and delivered; A_op unchanged |
| hot spares (pool size, replenishment) | P_blocked; T_remediate stage | effective goodput; A_op through the stage time |
| common-cause protection (power zones, planes) | β, blast radius | system availability, λ_job for shared events |

## 5. Additional fault-management methods for AI-cluster high availability (search, 2026-10-12)

Methods found in the literature and in current platforms, with the factor they move and how HAC-D can represent them today (parameter) or would need to be extended (new):

| Method (examples) | What it does | Factor moved | HAC-D today | Needs |
|---|---|---|---|---|
| In-memory / tiered / asynchronous checkpointing (GEMINI SOSP'23, ECCHECK ICDCS'25, TierCheck 2026, ByteCheckpoint NSDI'25) | checkpoints in host or peer memory with erasure coding; sub-second save, fast load | δ ↓ (save term), T_load ↓ (R̄), enables τ ↓ (W ↓) | δ, τ, pipeline stage `load`; the C-FAST transform | a library entry "C-MEM" with its own cost (host memory, interference) |
| Hot-swap of failed hardware with zero-overhead checkpoints, live migration (PHOENIX 2026, Clockwork TorchPass) | failed GPU replaced by a spare while the job continues; recovery ≈ 3 min, no rollback | P_rb → 0 for covered events, pause = migration time | chain rung of the replay kind with its own time and applicability | library entry "R-HOTSWAP" |
| Pipeline-level redundancy and rerouting (Bamboo redundant stages, Oobleck pipeline templates SOSP'23, ReCycle / SlipStream SOSP'24, Lazarus for MoE) | continue without restart by rerouting micro-batches or re-instantiating pipelines | P_rb → 0, pause small, capacity loss ℓ until repair; Bamboo adds a fault-free overhead | elastic rung (domains, recover time) | a steady-state overhead factor (like δ/τ) for redundant computation; degraded capacity until a spare arrives rather than a fixed 180 s |
| Elastic / per-step reconfiguration (ElasWave 2025, DLRover-style elastic training) | job continues on fewer devices and re-expands | P_rb → 0, ℓ_local over the repair time | elastic rung | same as above |
| Online silent-corruption detection with two stages (AEGIS OSDI'26, 35 M GPU-h) and low-cost dual modular redundancy (SpareTrain ICLR'26, 3–14 % overhead) | raise immediate detection to ~100 % at a throughput cost | q ↑, t_d; a goodput overhead factor | q, t_d (D-SDC) | a detection-overhead factor on goodput (1–3 %) so the cost side is modelled |
| Fail-slow detection and node sweeps (Falcon / GREYHOUND ATC'25, Guard MLSys'26, Holmes, Minder, CCL-D) | detect stragglers online, qualify nodes offline, mitigate without restart | p_det, T_d (D-SLOW); entry rate λ_sh ↓ via sweeps; mitigation reduces slow-down duration | D-SLOW parameters, sub-health duration | library entry "H-SWEEP" lowering λ_sh and duration |
| Failure prediction and pre-emptive migration (HeaRank "prioritize, don't predict", NeurIPS'25 degradation forecasting, Meta ECC-trend prediction, Clockwork pre-emptive mode) | predicted failures become planned migrations at the next checkpoint | fraction r (recall) of interruptions leave λ_rb for a planned pause; false alarms (1 − precision) add pauses | not represented | library entry "P-PREDICT" (recall, precision, migration pause) as a chain rung before detection |
| Lemon-node detection and eviction (Meta "Revisiting reliability", arXiv 2410.21680; survey §7) | nodes with repeated failures removed from large jobs; large-job failures 14 % → 4 % | λᵢ ↓ for the lemon share | `lemon` fraction and multiplier in the job Monte Carlo; closed form through λ scaling | library entry "H-LEMON" (share, multiplier) |
| Acceptance screening and burn-in (survey table 7-2) | removes infant mortality before production | λ(t) early segment | `infant` parameters in the Monte Carlo | closed-form credit as a λ reduction over the job window |
| Fault-tolerant collectives and multi-NIC failover (R²CCL, VCCL; TPUv4 OCS fault-tolerant routing; adaptive routing) | NIC or link failure absorbed within an iteration | network-class events: P_rb → 0, pause ≈ 0, residual λ through switchover | redundancy with switchover on network classes, or a replay-type rung applicable to the network class | library entry "R-NETFAIL" with per-class applicability |
| Automated node replacement with warm spare pools (Vertex AI cluster resiliency, SageMaker cluster repair, Crusoe AutoClusters: 60–120 min manual → 5–10 min) | detection, drain, replace from a pool | T_remediate stage, P_blocked, replenishment | hot spares k, replenish time, pipeline stage | — |
| Fast restart and warm standby processes (TrainMover, FlashRecovery, Unicron, BootSeer) | restart stage shortened, scale-aware | T_restart stage (scale law) | pipeline presets `automated-probe-standby`, `trainmover-8192-restart` | — |
| Power brake instead of fail-stop (IBM Vela) | PSU fault becomes a 3× slow node instead of an outage | moves events from λ_hard to λ_sh with φ ≈ 1/3 | manual re-classification between classes | a transform "H-POWERBRAKE" |
| Failure-domain-aware placement of checkpoints and spares (TierCheck, Meta sparing zones) | checkpoint copies and spares aligned with failure domains | β / blast radius, P_blocked per zone | ccf β and domain, spare zones in the Monte Carlo | — |

Not in scope for a training-job model: agentic-RL rollout fault tolerance (Belayer 2026), serving-side shadow checkpointing (GhostServe 2026).

Sources (search of 2026-10-12): [TierCheck](https://arxiv.org/pdf/2605.17821), [PHOENIX](https://arxiv.org/pdf/2607.01646), [ElasWave](https://arxiv.org/html/2510.00606v2), [Lazarus](https://arxiv.org/html/2407.04656v2), [GEMINI](https://www.amazon.science/publications/gemini-fast-failure-recovery-in-distributed-training-with-in-memory-checkpoints), [ECCHECK](https://i.cs.hku.hk/~cwu/papers/gcqi-icdcs25.pdf), [ByteCheckpoint](https://www.usenix.org/conference/nsdi25/presentation/wan-borui), [Guard](https://arxiv.org/pdf/2605.17879), [Falcon / GREYHOUND](https://arxiv.org/html/2410.12588v1), [AEGIS OSDI'26](https://www.usenix.org/conference/osdi26/presentation/lei), [SpareTrain](https://iclr.cc/virtual/2026/poster/10007813), [LLM-PRISM](https://www.themoonlight.io/en/review/llm-prism-characterizing-silent-data-corruption-from-permanent-gpu-faults-in-llm-training), [HeaRank](https://www.themoonlight.io/en/review/dont-predict-prioritize-rethinking-gpu-reliability-assessment), [degradation forecasting NeurIPS'25](https://neurips.cc/virtual/2025/129129), [Clockwork TorchPass](https://www.hpcwire.com/2026/03/11/clockwork-io-introduces-live-gpu-migration-for-ai-cluster-failures/), [Oobleck](https://arxiv.org/pdf/2309.08125), [ReCycle](https://arxiv.org/html/2405.14009v2), [R²CCL](https://www.catalyzex.com/paper/reliable-and-resilient-collective), [VCCL fault tolerance](https://vccl-doc.readthedocs.io/en/latest/features/fault-tolerance/), [Revisiting reliability (lemon nodes)](https://arxiv.org/pdf/2410.21680), [Vertex AI cluster resiliency](https://cloud.google.com/vertex-ai/docs/training/managed-training/cluster-resiliency), [SageMaker cluster repair](https://docs.aws.amazon.com/sagemaker/latest/dg/model-checkpoints-cluster-repair.html), [Crusoe AutoClusters](https://www.crusoe.ai/resources/blog/autoclusters-minimizing-hardware-failures-in-large-gpu-clusters).

## 6. Reproduce

```bash
node --import tsx packages/cli/src/main.ts example ref-three-classes-100k > three.json
node --import tsx packages/cli/src/main.ts mechanisms three.json --metric aOp --players D-HARD,D-SLOW,D-SDC,R-SDC,R-REPLAY,R-PROCESS,R-ELASTIC,C-FAST
node --import tsx packages/cli/src/main.ts example ref-catalog-100k > catalog.json
node --import tsx packages/cli/src/main.ts mechanisms catalog.json --metric aOp
```

## 7. The seven entries added from the literature (v3.2), on the 54-event catalog

Parameters are the library defaults (priors); A_op is unaffected by overheads, delivered goodput carries them. Prediction applies to persistent card / server faults only (30 % of HBM, 17 % of accelerator, 36 % of "other" interruptions in the catalog); network failover to the NIC / optical / IO-board / fabric events; hot-swap to card / server events.

| Mechanism (alone) | 100k ΔA_op | 100k Δeffective | 100k Δdelivered | 500k ΔA_op | 500k Δeffective | 500k Δdelivered |
|---|---:|---:|---:|---:|---:|---:|
| P-PREDICT | +0.046 | +0.231 | +0.103 | +0.190 | +0.951 | +0.097 |
| R-NETFAIL | +0.185 | +0.304 | +0.137 | +0.771 | +1.181 | +0.116 |
| R-HOTSWAP | +0.345 | +1.189 | +0.529 | +1.449 | +4.943 | +0.479 |
| C-MEM | +0.546 | +1.207 | +0.449 | +2.303 | +5.533 | +0.248 |
| D-SDC-DMR (8 % overhead) | −0.015 | −7.629 | +24.457 | −0.101 | −6.714 | +49.334 |
| H-LEMON | +0.163 | +0.269 | +0.121 | +0.682 | +1.041 | +0.103 |
| H-SWEEP | +0.022 | +0.054 | +0.031 | +0.091 | +0.212 | +0.048 |

Exact Shapley values over ten players (D-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, P-PREDICT, R-NETFAIL, R-HOTSWAP, D-SDC-DMR, C-MEM, H-LEMON; 1,024 coalitions, 34 s), A_op / delivered, points:

| Player | 100k A_op | 100k delivered | 500k A_op | 500k delivered |
|---|---:|---:|---:|---:|
| R-REPLAY | +0.457 | +0.436 | +2.013 | +1.471 |
| R-ELASTIC | +0.453 | +0.456 | +2.018 | +1.255 |
| R-PROCESS | +0.269 | +0.171 | +1.174 | +0.420 |
| C-MEM | +0.255 | +0.136 | +1.121 | +1.163 |
| R-NETFAIL | +0.113 | +0.115 | +0.499 | +0.388 |
| H-LEMON | +0.101 | +0.098 | +0.444 | +0.336 |
| D-SDC | −0.007 | +15.228 | −0.050 | +26.174 |
| D-SDC-DMR | −0.007 | +9.879 | −0.051 | +28.429 |
| P-PREDICT | −0.070 | −0.026 | −0.324 | −0.152 |
| R-HOTSWAP | −0.234 | −0.052 | −1.084 | −0.471 |
| combined gain | +1.331 | +26.442 | +5.759 | +59.012 |

Two readings matter for allocation. First, D-SDC and D-SDC-DMR are substitutes for the same loss line: alone each is worth 24 to 49 points of delivered goodput, together the second adds little, and DMR's 8 % fault-free overhead then shows as a net cost on the effective goodput. Second, prediction and hot-swap have positive gains alone but negative Shapley values once replay and elasticity are in the set: they sit earlier in the chain and take events that replay (5 s) or elasticity (1 s sync) would have handled with a shorter pause, and prediction adds false-alarm migrations. They pay only where their pause is shorter than the rung they displace or where they cover faults the others cannot (persistent faults before they happen, card replacement when no DP redundancy exists). The planner's Pareto front and last-added gains make this visible before a mechanism is adopted.
