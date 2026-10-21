# Three tools compared: HAC-D, ai-cluster-reliability (reference engine) and ReMAP (2026-10-12)

Scope: the availability / MTBF / MTTR / goodput formulas and the representation of fault-management mechanisms in the two third-party drops `ai-cluster-reliability-main/` (the expert's engine, versions V1–V4 and the 2026-10-09 catalog review) and `remap/remap-main/` (ReMAP, 可靠性设计与评估平台), set against HAC-D. Both drops are untracked and git-ignored. Citations are `path:line` inside each drop; HAC-D references point to `docs/MODEL_REFERENCE.md` sections (§) and source files under `packages/core/src`.

**摘要.** 三个工具针对同一问题（大规模同步训练作业在 30 天窗口内的可用度与正确有效产出）：参考引擎是专家的离散事件仿真（V1 为闭式稳态模型，V2–V4 为三类故障仿真，2026-10-09 审核版为 54 条事件 × 12 项机制的逐事件引擎）；ReMAP 是围绕该引擎建设的平台，原样内嵌 V4 月度引擎与 Shapley 代码（逐字节一致），审核引擎仅增加可配置恢复顺序、按 FIT 总量计算类别率两处改动，并补充静态 RBD/FTA/BDD、CTMC、经典可靠度/可用度分配、损失预算分配、统计区间、候选筛选与独立复核、资产与流程治理。HAC-D 用闭式模型（RBD/CTMC 硬件层 + 精确更新式作业层 + 静默错误交替更新 + 机制链枚举）在毫秒级得到同样口径的结果，并用窗口账本仿真校核：V1 闭式结果被 HAC-D 的精确更新式逐位复现（差异 ≤ 1e-16，机器精度）；审核版基线与单项机制在 1 万–50 万卡与参考仿真一致（正确有效产出差 ≤ 0.26 点，运行可用度差 ≤ 0.01 点）；组合与 Shapley 在参考工具的抽样误差内。差异集中在：V4 的"期末污染整条轨迹清零"交付口径（HAC-D 未实现）、ReMAP 的 Wilson/Student-t 区间与六项损失预算分配（HAC-D 有账本但无预算对照）、以及 HAC-D 独有的硬件层模型、19 项机制库、降额规划器与分配到类别/阶段的闭式预算。

## 1. What each tool is

| | HAC-D | ai-cluster-reliability (reference) | ReMAP |
|---|---|---|---|
| Purpose | Availability / MTBF / MTTR / goodput modelling of AI clusters from the survey chapter: hardware structure, repair, training and inference workloads, allocation, mechanisms | One synchronous training job of 1k–500k cards over 720 h; rank fault-management improvements by 正确有效产出 (`README.md:3-5,35-43`) | Multi-task "reliability design and evaluation workbench" built around the expert engine: ingestion → catalog review → model → solvers → allocation → reports → agents (`README.md:1-11`, design spec `docs/superpowers/specs/2026-10-10-reliability-platform-design.md:9-17`) |
| Model kinds | Closed forms (RBD, CTMC, renewal, alternating renewal, chain enumeration) + a job-level Monte Carlo and a window-ledger simulation | V1 closed form; V2–V4 discrete-event simulation; catalog review engine (simulation) | The two expert engines vendored byte-identically (`packages/solvers/src/vendor/monthly-engine.cjs` = `月度训练仿真引擎.js`, `shapley.cjs` = `Shapley贡献计算.js`; review engine adapted, 30 changed lines) + static ROBDD (RBD/FTA/BDD), CTMC plugin (SciPy), repairable series example, allocation, statistics |
| Where it runs | TypeScript core, web app (workers), CLI, MCP server | Node CommonJS scripts and self-contained HTML pages | pnpm monorepo: Fastify API, Vite/React UI, forked solver process, Python CTMC subprocess, OpenCode agent + MCP gateway (`packages/workflow/src/worker.ts:11-48`, `docs/mcp-contract.md:3-13`) |
| Validation | Golden vectors computed independently in Python (143 v1 + v2 + 18 v3), brute-force simulations, cross-check against the reference engine (§9, §20, `docs/REFERENCE_COMPARISON_100K_500K.md`) | Internal verification scripts per version: renewal simulation vs analytic (1.3 %), deterministic fixtures, ledger conservation, Shapley efficiency, a 2-state Markov reward re-derivation in Python (`复核三类故障公式.py:8-56`) | Byte identity (SHA-256) of the expert files, pathwise reproduction of 55 scenarios + 4 Shapley scales + 13 scan points (16,853 checks, max error 1.56e-12; `scripts/verify-expert-reproduction.ts:35-94`, `docs/2026-10-12-专家原始配置复现验收.md:50`) |

ReMAP's own numerical additions are therefore a layer around the reference engine; wherever this document says "reference" for a simulation result, it applies to ReMAP's `training` (V4) and `audit` (review) operations too. ReMAP's three changes to the review engine (`packages/solvers/src/vendor/review-engine.cjs` vs `catalogs/review-2026-10-09/engine.cjs`): a factory taking events / policy / config instead of file reads; class rates from FIT totals `cards·ΣFIT_type/1e9` unless the catalog is the frozen reference (`:7,14-17`); a configurable `recoveryOrder` (default replay → elastic → process) whose failed-rung seconds are charged to the next rung (`:44-65`, model version `review-retained-progress.v2`, `docs/事件机制审核与指标分配.md:57`).

## 2. Metrics and 口径

| Metric | HAC-D | Reference | ReMAP |
|---|---|---|---|
| Hardware / system availability A | `A = MTTF/(MTTF+MTTR)`, unit `u = λ·MTTR/(1+λ·MTTR)`, RBD and CTMC blocks, measures original / compensated / strict / tolerant / performability (§1–§3, §10–§17) | not modelled (job level only) | ROBDD over event *probabilities* (not rates) for RBD/FTA/BDD (`packages/solvers/src/static.ts:3-41`); repairable series `A = Π μ_i/(λ_i+μ_i)` (`repairable.ts:6-7`); CTMC `p(t) = p0·exp(Qt)` (`solvers/ctmc/solver.py:60`) |
| Cluster interruption rate / MTBF | `λ_job = Σ nᵢλᵢ` (plus isolation of detected sub-healthy units), `MTBI = 1/λ_job`; rates carry a 口径 and different event classes are never added (`assertAddable`, §1, §18) | `MTBF(N) = 10⁹/(N·ΣFIT)` (`第一版模型说明.md:35-42`; `三类故障仿真引擎.js:17-22`); V4 adds calendar-clock server / rack / shared FIT (`月度训练仿真引擎.js:44-51`) | same engines; audit `中断 MTBF = 10⁹/(cards·Σ_hard FIT)` (`packages/reports/src/audit.ts:198,270`); `estimateRate = events/exposure`, zero-event bound `−ln(1−c)/exposure` (`packages/analysis/src/index.ts:14-18`) |
| MTTR of an interruption | mixture `R = T_det + T_auto + (1−p_s)·T_manual`, `T_det = p_d·t_auto + (1−p_d)·t_timeout` (§18); stage pipeline with scale laws (§5); ladder (§16); dual-path CTMC `E[R] = c·T_a + (1−c·s)·T_m` (§10) | V1 fixed `d = detect + recover` (10 s + 900 s, `集群可用度建模分析报告.html:219,228`); V2–V4 `hardDetect` 95 % @ 10 s else 1 min, then 120 min global (`月度训练仿真引擎.js:5-8,111-116`); review: 95 % @ 10 s else 60 s, 180 s @ 99 % + 7200 s manual (`catalogs/review-2026-10-09/engine.cjs:29`) | same draws (`review-engine.cjs:32,114`) |
| Operational availability A_op (运行可用度) | `A_op = M/(M+R)` (§18); with pause-only events `A_run = 1/(1+λ_rb R_rb + λ_p R_p)` (§19) | V1 `A = 1/(1+λd)` (`第一版模型说明.md:57-60`); engines `uptime/T` (`月度训练仿真引擎.js:256`); review `1 − downtime/T`, global pauses only (`engine.cjs:137`) | same (`review-engine.cjs:142`) |
| Effective goodput (有效产出) | first order `1 − δ/τ − (W+R)/M`, exact renewal `λτ/[(e^{λ(τ+δ)}−1)(1+λR)]`, Daly, product; headline rule; mixed renewal with pause-only events; × `(1−P_blocked)·φ_job·(1−ℓ_local)·(1−o)` (§18, §19, §19.1) | V1 `TOR = A·τ/L·z/(e^z−1)·S` (`集群可用度建模分析报告.html:228-235`); engines `effective = correct/T` (retained correct progress) | same |
| Delivered goodput (正确有效产出) | closed-form alternating renewal over the window with "retain the last clean checkpoint" semantics; `delivered = [g·E(clean) − U·E(N)]/T` (§20); ledger simulation with the same rule (§21) | review: `correct = dirty ? cleanCp : progress`, `usefulThroughput = correct/T` (`engine.cjs:128,138`); V4: `delivery = (epoch ? 0 : correct)/T` — an unresolved contamination at the end zeroes the whole month (`月度训练仿真引擎.js:251-256`, `V4更新与模型契约.md:22-26`) | both, as two versioned "assessment models" declared non-comparable: audit `training.retained-clean-progress` (default) and legacy `training.correct-delivery` (`packages/contracts/src/assessment-model.ts:2-13`, `docs/事件机制审核与指标分配.md:7-12`) |
| Probability of meeting a target | ledger simulation `P(window ≥ target)` (normal CI); planner verification (§21, §22.2) | target90 scan `pAtLeast90` (`catalogs/review-2026-10-09/target90.cjs:3`) | `achievementProbability` with a Wilson 95 % interval; means with Student-t intervals; type-7 quantiles (`packages/solvers/src/statistics.ts:14-53`) |

Window unit everywhere: ideal full-speed training hours over `T = 720 h`; HAC-D's ledger uses the same identity (downtime + save + rollback + slowdown + local + blocked + overhead + SDC rollback + terminal + delivered = 1, §20–§21), the review engine asserts `correct + downtime + save + slowdown + rollback + terminalInvalid + localLoss = T` (`engine.cjs:132-136`) and V4 asserts a ten-line ledger (`月度训练仿真引擎.js:253-255`).

## 3. Availability and MTBF formulas, side by side

### 3.1 Scale law

All three tools make the interruption rate linear in the number of cards: `λ(N) = N·ΣFIT/10⁹` (reference `第一版模型说明.md:35-40`; ReMAP `review-engine.cjs:14-17`; HAC-D `MTBI(N) = 1/(N·λ_GPU-equivalent)` §4). The reference anchors 3333.33 FIT per card from "10k cards → 30 h" (`第一版模型说明.md:42`); HAC-D's examples use the same anchor (`ref-baseline-100k`, `scenario/examples.ts`). Differences: HAC-D scales the recovery time with N through the stage scale laws and re-evaluates the chain, the checkpoint interval and the silent-corruption window per row of the scale table (§18); the reference and ReMAP keep every time constant across scales (ReMAP digest: "no empirical scale law", `packages/contracts/src/audit-presets.ts:11`). HAC-D additionally derives residual rates from k-of-n / standby groups with switchover, β-factor common cause, lemon and infant multipliers (§2, §8); V4 adds server / rack / shared background faults on the calendar clock (`V4更新与模型契约.md:38-44`), which HAC-D represents as CCF leaves per domain (§2).

### 3.2 Hardware-level availability

HAC-D is the only one of the three with a rate-based hardware model: series / parallel / k-of-n / standby / repeat blocks, dual-path repair (automatic vs manual), switchover success and micro-outage, sub-health CTMC, importance measures and cut sets (§2, §3, §10–§17). ReMAP's static solver takes event *probabilities* and solves the Boolean structure exactly with a shared ROBDD (repeated events are one variable, correlations rejected, `static.ts:6,14,40`); its CTMC plugin solves a user-supplied generator (≤ 128 states, exponential holding only, `solver.py:10-17,60-67`); its repairable example is a two-module series with `A = (1/1.01)² = 0.98029605` (`scenarios/traditional-repairable/two-module-series.json`, `docs/numerical-methods.md:45`). The reference has no hardware-level model. What ReMAP's ROBDD adds over HAC-D's RBD is the exact handling of a component that appears in several places of a fault tree; HAC-D's structure is a tree of blocks whose leaves are independent, with common cause only through β-factor leaves.

### 3.3 Job-level closed forms: the reference V1 model is HAC-D's exact renewal

V1 (`集群可用度建模分析报告.html:228-235`, `第一版模型说明.md:50-74`), in seconds, `λ = N·FIT/(10⁹·3600)`, `d = detect + recover`, `L = τ + c`, `z = λL`:

```
A        = 1/(1 + λd)                      running-state share (saves and recompute count as running)
TOR_hard = A · τ/L · z/(e^z − 1)           exact renewal cycle with repeated failed attempts
S        = exp(−λ₀·p_s·H̄·ℓ)               sub-health factor, H̄ = (1−q)H + q·min(δ, H)
TOR      = TOR_hard · S
```

HAC-D §18: `exact renewal = λτ/[(e^{λ(τ+δ)} − 1)(1 + λR)]`. Since `λτ/(e^z − 1) = (τ/L)·(z/(e^z − 1))`, the two expressions are the same function of `(τ, δ, λ, R)` with `R = d`. Reproduced with HAC-D's `renewalGoodput` and `operationalAvailability` on V1's defaults (τ 7200 s, c 10 s, d 910 s, sub-health 2 % / 24 h / 5 % / 0 % detected) against `数值验证结果.json` (`keyScales[].baselineGlobal`):

| Cards | V1 TOR | HAC-D | V1 A | HAC-D A_op |
|---:|---:|---:|---:|---:|
| 10,000 | 95.6816 % | 95.6816 % | 99.1644 % | 99.1644 % |
| 100,000 | 64.2375 % | 64.2375 % | 92.2289 % | 92.2289 % |
| 200,000 | 40.0948 % | 40.0948 % | 85.5784 % | 85.5784 % |
| 500,000 | 8.2959 % | 8.2959 % | 70.3583 % | 70.3583 % |

(maximum absolute difference 1.1e-16, machine precision; `node --import tsx scripts/ref-compare-v1.ts`). HAC-D's first-order form flags this regime `invalid` above 10k cards ((τ+δ)/M = 0.67 at 100k), so its headline rule would pick the exact renewal there — the same choice V1 makes by construction. V1's ideal DP variant `A_DP = 1 − (1 − a_d)^50`, `a_d = 1/(1 + λd/50)`, `TOR_DP = a_d·τ/L` (`第一版模型说明.md:87-96`) corresponds to HAC-D's elastic rung with applicability 1, `t_sync = 0` and `ℓ_local = λ·d/n_dom` (§19): equal to first order in `λd/50`.

### 3.4 Simulation engines vs HAC-D's mixed renewal and ledger

The V2–V4 and review engines draw one Poisson stream at `λ = N·ΣFIT/1e9` on the running clock (no faults during global pauses), classify hard / slow / silent by share, batch checkpoints arithmetically (`advance`: compute vs save within each period), roll back to the last durable checkpoint on a global recovery and conserve a loss ledger per trajectory (`月度训练仿真引擎.js:56-69,87-257`; `engine.cjs:80-136`). HAC-D's window ledger simulation (§21) follows the same skeleton (running-clock arrivals, `advance`, dirty-flag propagation, conservation assertion) and its closed forms reproduce the stationary part: the mixed exact renewal `TOR = λ_rb τ/[(e^{λ_rb L} − 1)(1 + λ_rb R_rb + λ_p R_p)]` (§19) is the hard-only V1 form with the rollback events separated from the pause-only events that the chain, sub-health isolation and step recovery create.

Baseline cross-check (review engine, 4000 trials, vs HAC-D closed forms; `docs/REFERENCE_COMPARISON_100K_500K.md` §5):

| Cards | Reference delivered | HAC-D delivered | Reference A_op | HAC-D A_op |
|---:|---:|---:|---:|---:|
| 10,000 | 93.33 (± 0.26) | 93.33 | 99.749 | 99.748 |
| 100,000 | 62.56 (± 0.46) | 62.61 | 97.556 | 97.548 |
| 200,000 | 45.87 (± 0.40) | 45.66 | 95.235 | 95.222 |
| 500,000 | 25.24 (± 0.26) | 25.32 | 88.880 | 88.877 |

V4 numbers are not comparable with these without changing inputs (7200 s / 10 s checkpoints, 120 min global recovery, 0.4 % silent share, zeroing terminal rule): V4 base → all eight factors 87.89 → 99.90 / 34.66 → 99.35 / 15.62 → 98.07 / 2.01 → 95.66 % at 10k / 100k / 200k / 500k (`Shapley贡献结果.json`); V2's `effective` 86.40 / 31.17 / 13.55 / 1.63 % (`新版默认评估结果.json`). ReMAP reproduces V4's 1000-card HTML baseline 0.984938646066475 to 12 decimals (`tests/expert/expert-v4.test.ts:75-102`).

### 3.5 Sub-health (亚健康)

| | HAC-D | Reference / ReMAP |
|---|---|---|
| Unit model | CTMC with entry rate `λ_sh`, duration `D`, performance `φ`, escalation `m`, detection `p_d / T_d`, policy tolerate / isolate; measures strict / tolerant / performability / threshold (§14) | per-fault event with lifetime 24 h, 5 % multiplicative loss `slowFactor = Π(1 − slowLoss)` over active faults (`engine.cjs:84`; `月度训练仿真引擎.js:107`); V1 exposure factor `S = exp(−λ_s H̄ ℓ)` |
| Job effect | straggler law `P(slowed) = 1 − (1 − p_H)^N`, `φ_job = 1 − P(slowed)(1 − φ)` (§14) | multiplicative per active fault |
| Detected unit | isolation = snapshot then pause without rollback (§19, reference semantics) | review: snapshot + pause with the 3-min / manual draw, zero rollback (`engine.cjs:69-74`); V2–V4 global mode: 2 h pause **with rollback** (`月度训练仿真引擎.js:117-121,227`) |

HAC-D adopted the review semantics (decision 2026-10-10); sub-health closed forms agree with the review engine to 0.1 points (`docs/REFERENCE_COMPARISON_100K_500K.md` §4). The V2–V4 rollback-on-detection convention is one of the cross-version differences the reference's own README forbids mixing (`README.md:73`).

### 3.6 Silent data corruption (静默错误)

| | HAC-D (§20) | Review / ReMAP audit | V4 / ReMAP legacy |
|---|---|---|---|
| Episode | first undetected event dirties later checkpoints; discovered after `D` (120 h); roll back to the last clean checkpoint; still dirty at `T` → discard the work since the last clean checkpoint | same (`engine.cjs:99-107,128`) | `epoch` opens at onset, `correct` frozen; immediate channel (step state) or fallback (fixed / exponential); locate / verify / recover success gates; **unresolved epoch at `T` → `delivery = 0`** (`月度训练仿真引擎.js:156-187,251`) |
| Closed form | alternating renewal: `ν = λ_sdc(1−q)·A_run·(1−P_clear)`, `S_k = Γ(k, ν) + (k−1)(D + R_c)`, `E[clean] = T − Σ_k ∫ P(S_k ≤ T − x) dx`, `delivered = [g·E(clean) − U·E(N)]/T`; reference factors `(1−e^{−νT})/(νT)` and `e^{−νT}` reported | none (simulation); the memo's `C_time = (1 − e^{−νT})/(νT)` (`三类故障与恢复模型审视.md:271-273`) and `C = exp[−λ_SDC(1−q)T]` (`静默错误交付口径复核.html:7`) | none |
| Detected corruption | rollback event with pause `t_d + G`, or with step recovery a pause-only event `t_d + t_rec + t_step` | identical semantics (`engine.cjs:113-123`) | volatile step state never becomes a durable checkpoint (`:172-187`) |

HAC-D does not implement V4's zeroing rule (`delivery = 0` when the month ends contaminated); its ledger reports `P(dirty at end)` and the terminal discard instead. ReMAP keeps both rules as separate model versions and refuses to compare their means as one metric (`docs/事件机制审核与指标分配.md:12`).

### 3.7 Checkpoint bounds and the no-fault limit

ReMAP adds two certificates HAC-D lacks: the steady duty cycle `c/(c+s)` (300 / 304 = 98.684 %) and the finite-window no-fault bound `(⌊S/(c+s)⌋·c + min(S mod (c+s), c))/S` (`packages/analysis/src/audit-design.ts:72-84`, `docs/numerical-methods.md:33`); a design search returns `proven_infeasible` only when no candidate can skip saves through step recovery (`packages/analysis/src/index.ts:57-66`). HAC-D's `1 − δ/τ` is the same duty cycle; the planner reports "no coalition reaches the target" without a bound certificate (§22.2).

## 4. Fault-management mechanisms

### 4.1 Catalogs

| | HAC-D | Reference (review) | ReMAP |
|---|---|---|---|
| Entries | 19: the reference's 12 (D-HARD, D-SLOW, D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, R-CKPT, R-MANUAL, C-FAST, H-PROTECT, H-RELIABILITY) + P-PREDICT, R-NETFAIL, R-HOTSWAP, C-MEM, D-SDC-DMR, H-LEMON, H-SWEEP (§22, §22.3; `mechanisms/index.ts`) | 12 (`catalogs/review-2026-10-09/mechanisms.json`, parameters `mechanism-policy.json:2-9`); V4 instead has 8 "factors": silent, mode, recovery, checkpoint, fit, save, hardDetection, slowDetection (`Shapley贡献计算.js:32-41`) | the same 12 for the audit model (`references/expert-review-2026-10-09/mechanisms.json`), the 8 V4 factors for the legacy model, plus generic `mechanism` catalog assets as model patches / bindings with lifecycle draft → validated → published (`packages/domain/src/bindings.ts:9-48`, `packages/catalog-review/src/service.ts:27-36`) |
| Per-entry data | kind, scope, change, prerequisite, failure path, confidence, target parameters, effort score 1–5, fault-free overhead, `requires`, applied records (§22.3, §22.4) | kind, scope, coverage of events, baseline it replaces, evidence, target parameters, prerequisites (`mechanisms.json`) | same + cost (optional, user units) and evidence provenance (`packages/analysis/src/audit.ts:763-843`) |
| Applicability | per class fractions `component.mechanisms.{predict, netfail, replay, hotswap, elastic, process}`; 0 / 1 per catalog event in `ref-catalog-100k` (§19, §19.1) | per event Booleans `replay` (6 of 18 hard events), `process` (10), `elastic` (10); `scope` and `persistence` informational (`inputs.json:889-915`; `engine.cjs:41,45,57`) | same flags; rule `scope ∈ {all, none, hard, slow, sdc}` or `e.type === 'hard' && e[scope]` (`packages/analysis/src/audit.ts:875-889`) |
| Chain order | predict → netfail → replay → hotswap → elastic → process → global → manual, fixed (§19.1) | detection → replay → elastic → process → global CKPT (+ 1 % manual), fixed (`engine.cjs:38-68`) | configurable `recoveryOrder`, default replay → elastic → process (`review-engine.cjs:44`, `audit.ts:343-356`) |
| Hardware levers | H-RELIABILITY as a rate factor (and H-LEMON, H-SWEEP); hardware budgets by the allocation methods (§7, §22.1) | not simulated; "needs per-event new FIT" (`mechanisms.json:568-591`); V4 factor `fit` halves the sources (`Shapley贡献计算.js:38`) | `candidateFitOverrides` producing a "target FIT + mechanisms" row; mechanisms never change source FIT (`audit.ts:576-581,926`) |

### 4.2 Which term each mechanism moves

Reference / ReMAP terms are simulation branches (`engine.cjs` lines); HAC-D terms are the closed-form quantities of §19–§20 (`docs/MECHANISM_CONTRIBUTIONS.md` §4). Agreement figures are single-mechanism deltas on the three-class baseline (`docs/MECHANISM_CONTRIBUTIONS.md` §1–§2).

| Mechanism | Reference / ReMAP simulation | HAC-D closed form | Agreement |
|---|---|---|---|
| D-HARD | detection delay `U < p_d ? 10 s : 60 s` → 99.9 % / 1 s (`engine.cjs:7,109`) | `T_det` inside `R̄` (§18) | A_op within 0.01 pt at every scale |
| D-SLOW | detected share and slowdown duration (`:7,110`) | `p_d, T_d` → `ν_iso` pause-only events and `φ_job` (§14, §19) | ±0.005 pt A_op; delivered within the reference's sampling error |
| D-SDC | immediate branch: rollback to `cp` + 3 min recovery; a pending missed contamination is not cleaned (`:113-123`) | episode rate `ν = λ_sdc(1−q)·…`; detected events join `λ_rb` (§20) | +29.72 vs +30.06 pt delivered at 100k, +47.95 vs +47.89 at 500k |
| R-SDC | rollback target `max(cp, progress − 1 s)`, phase kept, 1 s pause (`:115-122`) | detected-SDC events become pause-only `t_d + t_rec + t_step` (§20) | conditional gain +0.049 vs +0.046 pt |
| R-REPLAY | success: pause `delay + failed + 5 s`, no rollback; failure +10 s (`:41-44`) | `P_rb ↓`, `R̄ ↓`, events move to `λ_p` (§19) | +0.826 vs +0.825 pt A_op at 100k |
| R-PROCESS | success: still `rollback(cp)`, pause `delay + failed + 60 s` (`:57-60`) | `R̄ ↓`, `P_rb` unchanged (§19) | +1.041 vs +1.035 pt |
| R-ELASTIC | one of 50 domains down 180 s (capacity `1 − locals/50`), global pause `failed + 1 s`, no rollback (`:45-56,79`) | `P_rb ↓`, pause `t_sync`, `ℓ_local = λ(d + t_el − t_sync)/n_dom` (§19) | +1.517 vs +1.510 pt A_op; delivered differs by up to 0.6 pt because the reference's elastic path desynchronises its fault stream |
| C-FAST | `tau, save` → save overhead and rollback distance (`:7,12`) | `δ/τ`, `W = τ/2`, `U`, `P_clear` (§18, §20); A_op unchanged | +0.283 vs +0.262 pt delivered at 100k |
| R-CKPT / R-MANUAL | default `pause()` path: 180 s @ 99 % + 7200 s (`:29,64-67`) | `T_auto, p_s, T_manual` of the mixture (§18) | baseline, R = 264.5 s in both |
| H-PROTECT / H-RELIABILITY | not simulated (`mechanisms.json:544-591`) | H-PROTECT informational; H-RELIABILITY rate factor (§22) | — |
| V4 `mode` (global → local, 50 domains) | all hard events handled locally: domain down `localMinutes`, no rollback (`月度训练仿真引擎.js:117-149`) | elastic rung with applicability 1 and `t_el = localMinutes` | not cross-checked numerically |
| V4 `recovery`, `checkpoint`, `save`, `fit`, `hardDetection`, `slowDetection`, `silent` | parameter patches (`Shapley贡献计算.js:32-41`) | R-CKPT time, C-FAST (τ, δ), H-RELIABILITY factor 0.5, D-HARD / D-SLOW coverage 100 %, D-SDC 95 % | — |
| P-PREDICT, R-NETFAIL, R-HOTSWAP, C-MEM, D-SDC-DMR, H-LEMON, H-SWEEP | not present | chain rungs predict / netfail / hotswap, checkpoint-load saving, coverage with an overhead factor, rate factors (§19.1, §22.3) | HAC-D only (literature priors, `docs/MECHANISM_CONTRIBUTIONS.md` §5, §7) |

Two semantic details worth keeping in mind when reading the reference: a *successful* R-PROCESS still rolls back to the last checkpoint (only the pause is shortened), and the detection delay of an R-ELASTIC event is charged to the domain, not to the global pause; HAC-D's chain implements both (§19).

### 4.3 Combinations: enumeration, Shapley and ranking

| | HAC-D | Reference | ReMAP |
|---|---|---|---|
| Coalitions | all `2^n`, closed forms, ≤ 10 players in the browser (1024 coalitions ≈ 1 s on the 54-event catalog, `mechanismReport`, §22) | 6 players × 64 coalitions × 2000 trials (catalog, `analyze.cjs:66-82`); 8 factors × 256 coalitions × 2048 trials × 13 scales (V4, `Shapley贡献计算.js:47-77`) | ≤ 8 players, `2^m·trials ≤ 131072` for V4 `attribute`; audit Shapley per selected set with per-trajectory values and common seeds (`packages/analysis/src/index.ts:6-13,76-91`; `audit.ts:623-692`) |
| Value function | delivered, effective or A_op, all three returned side by side (`byMetric`) | `delivery` (V4) or `usefulThroughput` (catalog) | same as the engine; `operationalAvailability` reported alongside |
| Shapley | exact `φ_i = Σ_S |S|!(n−|S|−1)!/n!·[v(S∪i) − v(S)]`; interaction `Δ − Σ single`; residual `Σφ − Δ` ≈ 1e-16 | per-trajectory Shapley with common random numbers, efficiency residual < 1e-10, negative values kept (`Shapley计算说明.md:66-83`) | same code; plus `nonAdditivity`, pairwise interactions, `conditionalStep` (`audit.ts:657-706`) |
| Uncertainty | none in the closed form (deterministic); ledger simulation CI per scenario | ±1.96 SE per coalition, sampling error only | Student-t / fixed-z intervals, Wilson for probabilities, paired differences; declared to exclude parameter and model error (`statistics.ts:59-60`) |
| Numbers | 100k Shapley (delivered, pt): D-SDC 30.68, R-SDC 0.02, R-REPLAY 0.33, R-PROCESS 0.34, R-ELASTIC 0.83, C-FAST 0.17 (Δ 32.37) | 31.06 / 0.02 / 0.36 / 0.32 / 0.25 / 0.18 (Δ 32.17) | reproduces the reference's four Shapley scales to 1e-9 (`tests/expert/audit-reproduction.test.ts:107-131`) |

Combinations need the per-event flags: with the four-source fractions HAC-D over-credits the six-mechanism set by 0.2 pt A_op at 100k and 0.9 pt at 500k; with the 54-event catalog example it reproduces the reference's combined scenario (A_op 99.100 / 95.656 vs 99.098 / 95.665; `docs/MECHANISM_CONTRIBUTIONS.md` §3).

### 4.4 From a target to a plan

| | HAC-D | Reference | ReMAP |
|---|---|---|---|
| Targets | scenario `targets.goodput` / availability; delivered basis (§22.1) | 500k-card 90 % scan: SDC coverage × recovery attempt grid, fallback delay, `P(month ≥ 90 %)` (`target90.cjs`, `target90-results.json`) | product targets 99 / 95 / 90 / 80 % at 10k / 100k / 200k / 500k with reference MTBF 30 / 3 / 1.5 / 0.6 h recorded separately (`packages/contracts/src/audit-presets.ts:1-7`) |
| Loss budget | ledger lines reported; class and stage budgets from the interruption budget (§7, §22.1) | ledger reported | six mutually exclusive ledger items with weights (reference start 25 / 20 / 35 / 10 / 5 / 5 %), `allowedHours = (1 − target)·hours`, allowed vs actual per item (`packages/analysis/src/audit-design.ts:11-18,108-136`) |
| Hardware / class allocation | equal, ARINC, AGREE (reliability form, class weights), feasibility, minimum effort, cost-optimal; availability log budget; stage budgets; feasibility by hardware alone, required SDC coverage `q*` and fallback delay `D*` (§7, §22.1) | none | task reliability: equal, ARINC, AGREE rate form `λ_i = n_i(−ln R)/(N·E_i·t_i)` (`packages/allocation/src/index.ts:208-212`); availability `A_i = A^{w_i/Σw}` with locks and bounds (`:21-112`); declared not applicable to training delivery (`:135-138`) |
| Mechanism choice | planner: cheapest feasible coalition by effort, nominal and derated parameters, necessary set, Pareto front, coverage × recovery scan, ledger verification `P(window ≥ target)` (§22.2) | ranking by mean gain; target90 grid | candidate screening (`ciLow ≥ target`, then lower cost, then mean, then fewer mechanisms), independent re-simulation with disjoint seed sets, verdict supported / below / uncertain (`audit.ts:763-843`); finite design search ≤ 8 dimensions × 1024 candidates with certificates (`index.ts:26-75`) |

AGREE conventions differ: HAC-D uses the classical reliability form `R_i = 1 − (1 − R*^{n_i/N})/w_i` rescaled to the budget (§7), ReMAP the NASA-2016 rate form; both flag that importance weights change the meaning of the budget.

## 5. Validation and statistics

| | HAC-D | Reference | ReMAP |
|---|---|---|---|
| Independent re-derivation | Python goldens (mpmath / scipy) for every closed form, never hand-edited; chain enumeration and SDC renewal equations re-derived in `compute_golden_v3.py` | `复核三类故障公式.py`: 2-state Markov reward exact vs 10,000-trajectory MC within 5 SE; rollback formula vs quadrature < 1e-8 h | none of its own; pathwise equality with the expert engines (byte identity + 16,853 numeric checks) |
| Simulation vs closed form | job MC and ledger simulation with delta badges; V1 reproduced to machine precision (§3.3); review baseline within CI (§3.4) | V1 renewal simulation 1.3 % relative error; V2 hard-only 100k: 0.41366 ± 0.00045 vs steady state 0.41336 | — |
| Statistics | mean, sd, 95 % CI (normal), quantiles, `P(≥ target)` | mean ± 1.96 SE, P05 / P50 / P95 | Student-t (df ≤ 10 table), type-7 quantiles, Wilson intervals, paired seeds, seed-set disjointness checks |
| Reproducibility | deterministic closed forms; seeded streams (arrivals, mechanisms, false alarms) | LCG seeds `(base + imul(i+1, 2654435761) + cards)` | same seeds; SHA-256 manifests of inputs and results |

## 6. Where the three agree, where they differ, what HAC-D should take

Agreement (same 口径, same semantics, numbers inside the reference's sampling error): the scale law; the MTTR mixture (R = 264.5 s); the operational availability as the running share; the exact renewal goodput (V1 reproduced exactly); the three-class baseline and every single mechanism of the review catalog; the combined scenario with per-event flags; the Shapley decomposition.

Differences in modelling choices:

1. **Terminal rule for silent corruption.** V4 / ReMAP legacy zero the whole month when it ends contaminated; the review engine, ReMAP's default and HAC-D keep the last clean checkpoint. The two rules differ by tens of points at 100k+ cards without immediate detection and must never be compared as one metric (ReMAP's own rule).
2. **Sub-health detection.** V2–V4 roll back on a detected sub-healthy unit; the review engine and HAC-D snapshot first.
3. **Sub-health job effect.** HAC-D's straggler law vs the reference's per-fault 5 % product; equal to 0.1 pt at the reference's 2 % share.
4. **Scale dependence of recovery.** Only HAC-D scales detection and recovery times with N.
5. **Hardware level.** Only HAC-D derives job rates from a repairable structure with redundancy, switchover and sub-health; ReMAP's static ROBDD works on event probabilities.
6. **Mechanism breadth.** HAC-D models 19 mechanisms including prediction, network failover, hot-swap, in-memory checkpoints, DMR with overhead, lemon eviction and sweeps; the reference and ReMAP model 12 (audit) or 8 factors (V4).
7. **Solver.** HAC-D attributes and plans with closed forms in a second; the reference and ReMAP simulate every coalition (minutes to hours; ReMAP's default expert profile runs 766,000 trajectories).

Recommended additions to HAC-D, in order of value (items 1–6 implemented on 2026-10-13 as v3.5: `docs/MODEL_REFERENCE.md` §20.1, §19.2, §21.1, §22.5, §7.1, §23):

1. A `sdc.terminalRule` switch with the V4 rule (`discard-all`: `delivered = 0` when dirty at the end) in the ledger simulation (exact per trial) and as an approximation in the closed form (`g·E[clean | clean at T]·P(clean at T)`), so that V4 / ReMAP legacy results can be matched.
2. Wilson intervals for `P(window ≥ target)` and Student-t intervals for small trial counts in `summarizeLedger` and the planner verification (ReMAP `statistics.ts:14-53`).
3. A loss-budget view on the Allocation page: `(1 − target)·T` split over the ledger lines with editable weights and the allowed-vs-actual table (ReMAP `audit-design.ts:108-136`); HAC-D already has the lines.
4. The checkpoint duty-cycle and finite-window bounds as a first feasibility screen in the planner, with ReMAP's caveat that step recovery can exceed the duty cycle (`docs/numerical-methods.md:33-35`).
5. Poisson rate estimation from incident counts with the zero-event upper bound (and Garwood intervals, which ReMAP lists as unimplemented) for the planned incident-log fitter.
6. Optional user-defined chain order (ReMAP `recoveryOrder`), low priority: the fixed order already matches the reference's physical chain.
7. V4's topology features (placement compact / striped, repair slots, minimum active fraction) are outside HAC-D's closed forms; the ledger simulation could add repair slots as a queue if a user asks for them (not implemented).

Status 2026-10-13: HAC-D now carries the V4 terminal rule as `sdc.terminalRule = 'discard-all'` (closed form by a Poisson-count identity, validated against an independent renewal recursion and the ledger simulation), Student-t half-widths and Wilson intervals with a supported / uncertain / below verdict, the loss-budget view with proportional / equal / custom weights and levers per line, the checkpoint duty-cycle and finite-window bounds as a proof of infeasibility in the planner, Garwood incident-rate estimation (`hacd rate`, `estimate_rate`, a helper in the component editor) and a configurable rung order. The reference's V4 delivery numbers can therefore be matched by setting the rule, 7200 s / 10 s checkpoints, the 120 min global recovery and the 0.4 % silent share. v3.6 adds the bridge in both directions (`docs/REMAP_INTEGRATION.md`): `scripts/remap-bridge.ts` runs ReMAP's vendored engines on any HAC-D scenario (the catalog example reproduces the published baseline exactly with ReMAP's seeds) and exports a ReMAP audit request; `hacd import-remap` turns a ReMAP / reference catalog into a HAC-D scenario.

What the other two tools lack that HAC-D provides: closed-form evaluation with validity flags, the hardware-level RBD / CTMC with dual-path repair and switchover, spares and inference N+k models, the scale table, per-class 口径 checks, the delivered-basis allocation with `q*` / `D*`, the derated planner with effort scores and Pareto front, exact Shapley for three value functions at once, and bilingual CLI / MCP / web interfaces. What they provide that HAC-D lacks: ReMAP's ingestion and catalog governance (versioned assets, evidence provenance, six-stage confirmed workflow, agent / MCP pipeline), its static ROBDD and generic CTMC plugin, its statistical rigour on Monte Carlo results, and the reference's V4 topology and placement model.

## 7. Cross-version caveats of the reference (do not mix)

Class shares 97.6 / 2 / 0.4 % (V2–V4) vs 96.6 / 2 / 1.4 % (catalog); checkpoints 7200 s / 10 s vs 300 s / 4 s; recovery 120 min manual vs 180 s @ 99 % + 2 h; terminal rule discard-to-zero vs retain-last-clean; sub-health rollback vs snapshot (`README.md:73`; ReMAP `docs/事件机制审核与指标分配.md:7-12`). HAC-D's built-in examples `ref-three-classes-100k` and `ref-catalog-100k` follow the catalog conventions; `ref-baseline-100k` is the hard-only stage.

## 8. Reproduce

```bash
# both need the untracked drop ai-cluster-reliability-main/
node --import tsx scripts/ref-compare-v1.ts              # V1 closed form (TOR, A) vs HAC-D's exact renewal at 10k–500k cards
node --import tsx scripts/ref-compare-v3.ts 200          # review engine baseline and mechanisms vs HAC-D (ledger, 200 trials)
node --import tsx packages/cli/src/main.ts mechanisms catalog.json --metric aOp   # single / Shapley gains on the 54-event catalog
```

Sources read: `ai-cluster-reliability-main/` (`README.md`, `第一版模型说明.md`, `三类故障与恢复模型审视.md`, `V4更新与模型契约.md`, `Shapley计算说明.md`, `月度训练仿真引擎.js`, `三类故障仿真引擎.js`, `catalogs/review-2026-10-09/*`, result JSON files) and `remap/remap-main/` (`README.md`, `docs/numerical-methods.md`, `docs/事件机制审核与指标分配.md`, `docs/superpowers/specs/2026-10-10-reliability-platform-design.md`, `packages/{solvers,analysis,allocation,domain,contracts}`, `references/*`, `tests/expert/*`).
