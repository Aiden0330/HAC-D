# Training availability: revised formulas, the ai-cluster-reliability-main methods, and what HAC-D should absorb

Date 2026-10-10. Scope: a single synchronous training job; symbols below are in hours unless marked (s). The companion tool reviewed is the folder `ai-cluster-reliability-main` (versions V1 → V4 → audited catalog `catalogs/review-2026-10-09`).

## 1. Notation and the factors you listed

| Symbol | Meaning | Remarks |
|---|---|---|
| M = MTBF | mean time between job-interrupting failures at the job's size | the job-level value: M(N) = 1/(N·λ_card) (1/N law); with FIT, M(N) = 10⁹/(N·ΣFIT) h |
| T_int | checkpoint interval (training time between two checkpoints, excluding the save) | you wrote *T_init*; read here as the interval (question 1) |
| T_oh | checkpoint overhead: the blocking save time paid once per interval | the survey's δ |
| W | lost computation per failure (rollback / recompute) | derived from T_int, or measured |
| MTTR | mean time from failure to resumed training | mixture of automatic and manual paths, below |
| p_d, p_s | failure-detection rate, automatic-recovery success rate | event fractions, not per-hour rates |
| T_auto, T_manual | automatic recovery duration, manual recovery duration | |

### 1.1 MTTR as a mixture of paths

Your definition:

    MTTR = p_d·p_s·T_auto + (1 − p_d·p_s)·T_manual                                   (M1)

Two variants differ in what happens on the paths that are *not* "detected and recovered automatically":

    MTTR = T_det + p_s·T_auto + (1 − p_s)·(T_auto + T_manual)                        (M2, failed attempt still costs T_auto)
    T_det = p_d·t_auto_det + (1 − p_d)·t_timeout                                     (detection delay: automatic or timeout fallback)

    MTTR = c·T_auto + (1 − c·s)·T_manual,  c = coverage, s = success                   (M3, HAC-D v2 dual-path repair, §10 of MODEL_REFERENCE)

M1 sends every undetected failure (1 − p_d) to the manual path; M2 (the convention of the audited ai-cluster engine, `reference.cjs`) lets an undetected failure be found by a timeout and still recovered automatically, and charges the failed automatic attempt before manual work. M3 is M1 plus the failed-attempt time. On the ai-cluster baseline (p_d = 0.95 at 10 s, timeout 60 s, p_s = 0.99, T_auto = 180 s, T_manual = 7,200 s) the three give 610 s, 265 s and 264 s: the treatment of the 5 % undetected failures changes MTTR by 2.3× (question 2).

The general form is HAC-D's recovery ladder: rungs i = 1..L tried in order, MTTR = Σ_i P_i·t_i with P_i = Π_{j<i}(1 − s_j); M1–M3 are the two-rung cases.

### 1.2 Formulations of training availability

**F1 Operational (time) availability.** The fraction of wall time the job is running (checkpoint saves and recompute count as running).

    A_op = M / (M + MTTR) = 1 / (1 + MTTR/M)

Assumptions: alternating renewal (exponential failures, any repair distribution with mean MTTR); no failures counted during repair. This is the survey's A = MTBF/(MTBF+MTTR) and the ai-cluster tool's 运行可用度 A = 1/(1+λd).

**F2 Effective availability / goodput, first order (Young–Daly).** The fraction of wall time that is correct, retained computation.

    A_eff ≈ 1 − T_oh/T_int − (W + MTTR)/M,     W = T_int/2 (periodic checkpoint) or W = one step (step/replica recovery)

Assumptions: T_int + T_oh ≪ M and MTTR ≪ M (at most one failure per interval); checkpoint overhead paid every interval; the failure phase is uniform in the interval. HAC-D flags (T_int+T_oh)/M and MTTR/M and the regime (checkpoint- vs restart-dominated). Optimal interval T_int* = √(2·T_oh·M) (Young), independent of MTTR.

**F3 Product form.** The same three mechanisms treated as independent factors:

    A_eff ≈ A_op × T_int/(T_int + T_oh) × (1 − W/M)

Assumptions: independence of downtime, save overhead and rollback; first-order equal to F2. Useful when the three terms come from different measurements (uptime from monitoring, overhead from storage profiling, W from logs).

**F4 Exact renewal models (no small-parameter assumption).** With λ = 1/M, τ = T_int, c = T_oh, d = MTTR:

    TOR = λτ / [(e^{λ(τ+c)} − 1)(1 + λd)]            (ai-cluster V1 §1: failures possible during the save, none during recovery)
    G   = τ / [M·e^{d/M}·(e^{(τ+c)/M} − 1)]          (Daly 2006 full model: failures also possible during recovery; HAC-D "Daly full")

In both, W is implied rather than input: the expected lost work per failed interval is E[min(X, τ) | X < τ+c] = [(1 − e^{−λτ})/λ − τ·e^{−λ(τ+c)}] / (1 − e^{−λ(τ+c)}), which tends to τ/2 at low failure rates. Use F4 whenever (τ+c)/M or d/M exceeds about 0.1 (ten-thousand-card scale and above with hour-level MTBF). If W is a *measured* input (replay logs), use F2/F3 with the measured W instead of the implied one.

**F5 Local (DP-domain) elastic recovery.** The job keeps running on healthy domains; a failed domain of D equal domains is restored without a global rollback:

    A_cap = 1/(1 + λ·d_L/D),   TOR_L = A_cap × τ/(τ + c)          (ai-cluster V1 §2, ideal-isolation upper bound)

Assumptions: the other D−1 domains keep producing retained progress; d_L includes state resynchronisation; no global pause (the audited engine adds a short global sync pause and a 98 % success rate with fallback to process / checkpoint / manual recovery).

**F6 Performance degradation (sub-health, 亚健康).** Multiply by a slow-down exposure factor:

    HAC-D v2:      φ_job = 1 − P(slowed)·(1 − φ),   P(slowed) = 1 − Π_i (1 − p_H,i)^{n_i}         (straggler law)
    ai-cluster V1: S = exp(−λ_s·H̄·ℓ),  H̄ = (1 − q)H + q·min(δ, H)                              (Poisson exposure, multiplicative slow-down ℓ)

**F7 Correctness-aware delivery (silent data corruption).** The ai-cluster tool's headline since V3: the retained *correct* progress at the end of a finite window T (720 h), zero if an unresolved corruption remains:

    A_delivery(T) = E[ P_correct(T) · 1{clean end} ] / T

No closed form in general (Monte Carlo); its simplest special case multiplies F2/F4 by a silent-risk time factor C_time = (1 − e^{−νT})/(νT) with ν = λ_sdc·(1 − q_sdc)·A_exposure (the exposure correction matters: without it the 500k-card example is wrong by 3×).

### 1.3 Numbers on the ai-cluster baseline (hard MTBF 30 h at 10,000 cards, linear scaling; τ = 300 s, c = 4 s; MTTR per M2 = 264.5 s)

| N | M | A_op (F1) | F2 first order | F3 product | F4 exact (ai) | F4 Daly | implied W | T_int* | F2 at T_int* | (τ+c)/M | MTTR/M |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 | 30 h | 99.76 % | 98.28 % | 98.31 % | 98.30 % | 98.30 % | 152 s | 930 s | 98.89 % | 0.003 | 0.002 |
| 100,000 | 3 h | 97.61 % | 94.83 % | 94.99 % | 94.98 % | 94.95 % | 151 s | 294 s | 94.83 % | 0.028 | 0.025 |
| 500,000 | 0.6 h | 89.09 % | 79.48 % | 81.81 % | 81.88 % | 81.31 % | 148 s | 131 s | 81.67 % | 0.141 | 0.123 |

F2 and the exact forms agree to 0.1 points at 10k and 100k cards and separate by 2–3 points at 500k, where the first-order validity flags fire. The ai-cluster tool's audited 30-day Monte Carlo gives lower numbers at 500k (its baseline 正确有效产出 is a few percent) because it also charges sub-health, undetected SDC with a five-day fallback and terminal discard; F1–F4 do not.

## 2. The ai-cluster-reliability-main tool: methods

**Purpose and scope.** One large synchronous training job from 1,000 to 500,000 cards, 30-day (720 h) window, all cards in one job. Outputs 运行可用度 (operational availability), 正确有效产出率 / delivery (correct retained progress ÷ 720 h), a conserved loss ledger, single-mechanism gains and Shapley attribution across mechanism combinations; latest run: 54 fault events, 12 mechanisms, a 90 %-at-500k-cards target scan.

**Failure model.** A single per-card equivalent FIT anchored by "10,000-card hard-interruption MTBF = 30 h" (FIT_card = 10⁹/(10⁴·30) = 3,333; interruption rate ∝ N). Events are split into three *manifestations* with fixed shares (interruption 96.6 %, sub-health 2 %, silent 1.4 %; V1–V4 used 97.6/2/0.4) and, in the audited catalog, into 54 events by hardware domain (AI Core, NPU memory transient/persistent, IO die, HiAM module, CPU blade, CPU DDR, SRAM, SSD, BMC, shared checkpoint storage, UB NIC, cooling, optical protection groups, L1/L2 interconnect, IO boards, rack power residual, unknown/software) each with FIT, scope (card/server/rack/job), persistence, and flags saying which recovery mechanisms apply. A constraint module keeps the class budgets fixed and AI Core at 85 % of silent FIT. Source × manifestation is treated as a cross table; "HBM/GPU/network/other" weights come from Llama 3 Table 5 (17.2/30.1/8.4/44.3 %).

**Detection and recovery.** Interruptions: 95 % detected in 10 s, the rest by a 60 s timeout; recovery attempt 180 s with 99 % success, else +7,200 s manual (so MTTR = T_det + 180 + 0.01·7,200 s). Sub-health: 95 % detected in 5 min, else 24 h at −5 % throughput; recovery saves current progress (zero rollback). Silent: 0 % immediate detection in the baseline, fixed 120 h fallback, rollback to the last *clean* checkpoint, retained progress kept, terminal discard if still dirty at day 30. Mechanism library (audited): D-HARD, D-SLOW, D-SDC (detection), R-REPLAY (operator re-execution 90 % in 5 s), R-PROCESS (process reschedule 95 % in 60 s), R-ELASTIC (50-domain DP elasticity 98 %, domain down 180 s, 1 s global sync), R-CKPT (global checkpoint recovery 3 min, 99 %), R-MANUAL (+120 min), R-SDC (volatile clean step state, 1 s), C-FAST (60 s / 1 s checkpoints), H-PROTECT and H-RELIABILITY (physical, no automatic credit). Fallback chain: replay → elastic → process → global checkpoint → manual, each rung gated by per-event applicability and a success probability, with the failed rung's time charged.

**Engines.** V1: closed forms (F1, F4 exact renewal, F5 DP domains, F6 exposure factor). V2/V3 "三类故障" discrete-event engine: checkpoint batching (`advance`), global vs 50-domain local modes, sub-health multiplicative slow-down, silent epoch with clean-checkpoint retention window, replay rate. V4 "月度训练仿真引擎": cards → servers → racks → recovery domains (compact or striped placement), event scopes (card/server/rack/job), background shared FIT (server/rack/job) on a calendar clock, finite repair slots with FIFO queueing, minimum active-capacity threshold, reconfiguration pause, silent state machine with locate / verify / recover success rates and monitoring overhead, volatile step state separated from durable and clean checkpoints, a mutually exclusive 720 h ledger (pause + save + capacity loss + slow-down + monitoring + replay slow-down + rollback + unrecovered corrupt work + terminal discard + delivered = 720), means with standard errors and P05/P50/P95. Audited engine (`engine.cjs`): per-event audit with the mechanism chain and a per-cause / per-event ledger, asserted to conserve time.

**Attribution.** 8 improvement directions (silent detection 0→95 %, local elasticity, recovery 120→15 min, interval 7,200→600 s, FIT halved, save blocking 10→0.1 s, hard detection 95→100 %, sub-health detection 95→100 %): all 256 subsets simulated with shared seeds (2,048 trajectories each), exact Shapley values, single-change and last-added gains, interaction checks; the audited catalog ranks 12 mechanisms per scale and scans silent-detection coverage and global recovery time for the 500k-card 90 % target (99.9 % coverage and 120 s recovery give 94.0 % mean, 98.3 % of months ≥ 90 %).

**Validation and provenance.** Time-ledger conservation per trajectory; analytic cross-checks (500,000-sample renewal check, exact 2-state Markov reward model with an absorbing silent state in `复核三类故障公式.py`, rollback-quadrature check); SHA-256 binding of engine, scenario and experiment; evidence table per parameter (user baseline / scenario / assumption); explicit statements that nothing is a measured SLA.

**Training-availability formulas in the tool (as written there).** (1) A = 1/(1+λd); (2) TOR_hard = λτ/[(e^{λ(τ+c)}−1)(1+λd)]; (3) DP domains: a_d = 1/(1+λd/50), A_DP = 1−(1−a_d)^50, TOR_DP = a_d·τ/(τ+c); (4) sub-health: H̄ = (1−q)H + q·min(δ,H), S = exp(−λ_s H̄·0.05), TOR ≈ TOR_hard·S; (5) FIT: MTBF(N) = 10⁹/(N·ΣFIT_i), shares FIT_i/ΣFIT; (6) detection mixture: t̄_det = q·t_auto + (1−q)·t_fb, d = t̄_det + r; (7) expected rollback E[min(X,τ)|X<L] (§1.2 above); (8) delivery A = E[P_correct(720)·1_clean]/720; (9) silent time factor C_time = (1−e^{−νT})/(νT) with exposure correction; (10) exact Markov reward for run → repair (mean 2 h) → run with an absorbing silent state; (11) recovery = 180 s + 1 % × 7,200 s (MTTR with success rate, `reference.cjs`).

## 3. Comparison with HAC-D

| Dimension | ai-cluster-reliability-main | HAC-D (v2) |
|---|---|---|
| Object | one training job, whole cluster = job | training job (series or hot-spare pool), inference N+k, N+k supernodes, infrastructure; cluster sizing |
| Hardware structure | flat per-card FIT sum + scopes (card/server/rack/job) + fixed recovery domains; no RBD | hierarchical capacity-aware RBD / fault tree, CTMC groups (k-of-n, standby, switchover, dual repair), CCF β, importance, cut sets; supernode geometry (CloudMatrix384) |
| Failure classes | interruption / sub-health / silent with fixed budgets; 54 hardware-domain events | per-component classes (635 library records with 口径 and provenance); sub-health per class with threshold and tolerate/isolate; SDC-latent unit exists in the CTMC library but is **not** wired into scenarios |
| Detection / recovery | detection coverage + timeout; mechanism chain with per-event applicability and success rates; failed rung charged; manual fallback | six-stage MTTR pipeline with scale laws; recovery ladder (`mindcluster-a3`) with reach probabilities; component-level dual-path repair c, s, T_a, T_m; switchover success |
| Checkpoint / goodput | exact renewal TOR (F4); checkpoint batching in the DES | first-order with validity flags (F2), Daly full (F4), Young/Daly/Saxena intervals, scale table; no implied-W formula shown |
| Local elasticity | 50 DP domains, capacity-weighted, reconfiguration pause, repair queue | hot-spare node pool (k-of-n) and N+k replicas; no DP-domain mode |
| Correctness (SDC) | first-class: clean checkpoints, retention, locate/verify/recover rates, terminal discard, delivery metric | absent at scenario level |
| Window and statistics | finite 30-day window, P05/P50/P95, standard errors | steady-state closed forms; Monte Carlo per job duration with CI and quantiles; original vs compensated measures and waterfall |
| Loss accounting | conserved ledger (10 mutually exclusive terms) per trajectory and per cause/event | first-order loss decomposition (δ/τ, τ/2M, R/M, blocked) + MC loss fractions; not a conserved ledger |
| Attribution | Shapley over mechanism subsets; single gains; target scans | tornado (×½/×2), importance measures, compensation waterfall, allocation methods (AGREE …) |
| Scale | 1k–500k cards, 1/N law | same, plus supernode sizing |
| Validation | ledger conservation, analytic cross-checks, SHA-bound results | 169 independent golden vectors (Python), reduction identities, survey worked examples |
| Delivery | single offline HTML + Node CLI | web app (import/export Excel), CLI, MCP |

The two are complementary: the ai-cluster tool is deeper on *what happens inside one job* (detection → mechanism chain → correctness ledger, finite window, attribution); HAC-D is deeper on *what the cluster is made of* (structure, redundancy, provenance, cluster-level availability) and on reproducible closed forms.

## 4. What HAC-D should incorporate (proposal)

Ordered by value per effort; items 1–3 are closed-form additions, 4–8 are model extensions.

1. **Job-level MTTR mixture, visible and configurable.** Detection delay (coverage p_d, automatic delay, timeout) + automatic attempt (success p_s, T_auto) + manual (T_manual), with the convention chosen in question 2, shown next to R(N) on the Training page and used as the pipeline's detect/remediate stages. (HAC-D already has the ladder and component dual repair; this adds the explicit two-path job formula and the detection timeout.)
2. **Exact renewal goodput (F4 ai-cluster form) and the implied rollback W** alongside first-order and Daly full, with W switchable to a measured input; add F3 product form for measurement-based reconciliation.
3. **Validity-driven selection**: when (τ+δ)/M or R/M > 0.1 the page headlines the exact form instead of the first-order one (currently it only flags).
4. **Silent data corruption at scenario level**: per-class SDC rate (or share), immediate detection coverage, fallback delay, clean-checkpoint retention, locate/verify/recover success; outputs: delivery availability A_delivery(T), terminal-discard probability, C_time factor with exposure correction. Wire the existing `sdcLatentUnit` and add the clean-checkpoint logic to the Monte Carlo.
5. **DP-domain elastic recovery mode** (fixed D domains, capacity-weighted, sync pause, success rate with fallback) as a third training template beside series and hot-spare pool, in closed form (F5) and in the simulator.
6. **Finite-window Monte Carlo with a conserved ledger** (pause, save, capacity loss, slow-down, rollback, unrecovered corrupt, terminal discard, delivered = T) and P05/P50/P95 of the 30-day delivery, replacing the current steady-state style loss fractions.
7. **Mechanism chain with per-component applicability**: extend the ladder so each rung lists which component classes it covers (replay for transient network faults, elastic for card/server scopes, process reschedule, checkpoint, manual) with the failed rung's time charged; import the 12-mechanism catalog as a preset.
8. **Event-catalog import**: a converter from the 54-event catalog (FIT per hardware domain, type, scope, persistence, mechanism flags) into HAC-D components with the class-budget constraint, plus the ai-cluster baseline (10k-card hard MTBF 30 h; 96.6/2/1.4 shares) as a built-in example so both tools can be cross-checked on one scenario.
9. **Shapley attribution** over improvement directions as a complement to the tornado (exact enumeration up to 8 directions, shared seeds).

Not recommended to copy: the flat per-card FIT sum as the only structure (HAC-D's RBD is the reason it can answer topology questions), and the fixed manifestation shares as hard constraints (keep them as a scenario preset).

## 5. Open questions

1. Is *T_init* the checkpoint interval (training time between checkpoints), or an initialisation / warm-up time to be added to MTTR?
2. In the MTTR mixture: do undetected failures (1 − p_d) go straight to manual recovery, or are they found by a timeout and still recovered automatically? And should the failed automatic attempt's T_auto be charged before manual work? (M1 vs M2 vs M3 above; 610 s vs 265 s on the baseline.)
3. Is W an input you measure (lost computation per failure from logs) or should it stay derived (T_int/2, or the exact renewal expression)?
4. Which quantity is "training availability" for reporting: operational A_op, effective goodput (first order / exact), or the correctness-aware 30-day delivery?
5. Should HAC-D adopt the ai-cluster baseline and 54-event catalog as a built-in cross-check scenario?
6. Build order: items 1–3 (formulas, days) first, or go straight to 4–6 (SDC, DP domains, ledger Monte Carlo, weeks)?

## 6. Status (2026-10-10)

Decisions taken: allocation stays on effective goodput; the reference example keeps the four-source granularity (HBM / GPU / network / other) with the catalog's silent-corruption split; mechanisms are a library with exact Shapley attribution over closed forms; the silent-corruption model was built first.

| Item | Status | Where |
|---|---|---|
| 1 MTTR mixture | done (v2.1) | `recovery.mode = 'mixture'`, §18 |
| 2 Exact renewal, implied W, product form | done (v2.1) | `checkpoint/renewalGoodput`, §18 |
| 3 Validity-driven headline | done (v2.1) | `headlineGoodput` |
| 4 Silent data corruption at scenario level | done (v3) | `sdc/index.ts`, `scenario.sdc`, `component.sdc`, §20; delivered goodput on the Training page |
| 5 DP-domain elastic recovery | done as a chain rung (v3) | `mechanisms/chain.ts` elastic rung with local capacity loss; the separate elastic *template* (F5) remains open |
| 6 Finite-window Monte Carlo with a conserved ledger | done (v3) | `mc/ledger.ts`, Simulate page "Window ledger" mode, §21 |
| 7 Mechanism chain with per-class applicability | done (v3) | `scenario.mechanisms`, `component.mechanisms` fractions, §19 |
| 8 Event-catalog import / reference baseline | partly: baseline examples done (`ref-baseline-100k`, `ref-three-classes-100k`), catalog aggregated to four sources; the 54-event converter is not built | `scenario/examples.ts` |
| 9 Shapley attribution | done (v3) | `mechanisms/index.ts`, Mechanisms page, §22 |

Cross-check against the reference engine: `docs/REFERENCE_COMPARISON_100K_500K.md` §5.
