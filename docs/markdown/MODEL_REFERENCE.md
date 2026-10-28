# Model reference

Every output of HAC-D maps to one of the formulas below. Section numbers refer to the survey chapter *AI 集群可靠性建模* (2026-10-08). Units: rates per hour unless noted; δ, τ, R in seconds; M (MTBI) in seconds when used with them.

## 1. Metrics and 口径 (§2)

| Quantity | Definition | Notes |
|---|---|---|
| A | MTTF / (MTTF + MTTR) ≈ MTBF / (MTBF + MTTR) | steady state; two-state unit unavailability u = λ·MTTR / (1 + λ·MTTR) |
| Rate conversions | per GPU·h ↔ per 1000 node·day (× 1000 × 24 × GPUs/node) ↔ FIT (per 10⁹ h) ↔ AFR (8760 / MTTF) ↔ GPU·day per event | Table 2-2; `units/index.ts` |
| 口径 | {event, denominator, level, includes_planned, dedup} on every rate | rates of different event classes are not summed (`assertAddable`) |

## 2. Structure: RBD and fault tree (§4.1, Fig. 4-1, Table 4-1)

| Block | Availability | Failure frequency ν | MTTF from new |
|---|---|---|---|
| leaf, n identical units in series | A₁ⁿ, A₁ = 1/(1 + λ·MTTR) | A·nλ | 1/(nλ); with sub-health MTTF_unit/n, MTTF_unit from §14 |
| series | Π Aᵢ | A·Σ λ_eq,i (λ_eq = ν/A) | 1/Σ(1/MTTFᵢ) |
| parallel 1-of-n | 1 − Π Uᵢ | Σᵢ νᵢ Π_{j≠i} Uⱼ | product-space CTMC (≤ 10 children) |
| k-of-n identical, unlimited repair | Σ_{j≤n−k} C(n,j) uʲ (1−u)ⁿ⁻ʲ | π_{n−k}·kλ | birth–death first passage (Fig. 4-3) |
| standby 1-of-n (factor f, switch pₛ) | CTMC with switch-failure states | from CTMC | ideal cold 2/λ, hot 3/(2λ), (1+pₛ)/λ |
| repeat ×c | A_unitᶜ | A·c·λ_eq | MTTF_unit / c |

Equivalent MTTR = (1 − A)/ν; MTBF (mean up time) = A/ν. Capacity (performability) = Σ π_s·c_s, first-order across blocks. Common cause: β-factor leaves per domain with λ = β·Σ(λ·n) of the members (conservative for redundant groups). Importance: Birnbaum = A(Aᵢ=1) − A(Aᵢ=0); Fussell-Vesely = (U − U(Aᵢ=1))/U; RAW = U(Aᵢ=0)/U; RRW = U/U(Aᵢ=1). Minimal cut sets with multiplicity n−k+1 for k-of-n; rare-event top event ≈ Σ P(cut set).

## 3. Repairable systems: CTMC (§4.2)

- Birth–death chain, states = failed units j: λⱼ = (n−j)λ, μⱼ = min(j, crews)·μ. Steady state by product form; MTTF by the tridiagonal recurrence (aⱼ + bⱼ)Tⱼ = 1 + aⱼT_{j+1} + bⱼT_{j−1}, T_{k+1} = 0.
- Degraded (fail-slow) unit: up → degraded (λ_deg), degraded → up (1/duration), capacity c_deg; A_cap = π_up + c_deg·π_deg (§4.3).
- SDC latent unit: up → latent (λ_SDC) → repair (1/T_expose) → up; latent time counts as lost work (§7).
- Spare pool (Meta Sparing): Pr(blocked) ≈ 1 − Σ_{n≤R} mⁿ/n!·e^{−m}, m = L·MTTR/MTBF; exact binomial form with ρ = MTTR/MTBF.

## 4. Checkpoint interval and goodput (§6.1, Table 6-1)

| Model | Formula |
|---|---|
| Young | τ = √(2δM) |
| Daly lowest order / three-term | √(2δM) − δ; √(2δM)[1 + (1/3)(δ/2M)^{1/2} + (1/9)(δ/2M)] − δ, τ = M when δ ≥ 2M |
| Daly exact | (1 − τ/M)e^{(τ+δ)/M} = 1 ⇔ η = 2ξ² + 1 + W₀(−e^{−2ξ²−1}), ξ = √(δ/2M), τ = ηM − δ |
| Daly full wall time | T_w/T_s = M·e^{R/M}(e^{(τ+δ)/M} − 1)/τ; goodput = its reciprocal |
| Saxena availability objective | A = (T_f − T_f·T_s/T_c)/(T_f + T_c/2 + T_r); T_c* = T_s + √(2(T_f + T_r)T_s + T_s²) |
| First-order goodput | 1 − δ/τ − (τ/2 + R)/M; validity: (τ+δ)/M and R/M ≤ 0.1 ok, ≤ 0.3 caution, else invalid; regime restart-dominated when R/M > δ/τ + τ/2M |
| TrainMover | ETTR(N) = 1 − D/MTTF(N); wasted GPUs = N·D/MTTF(N) |
| Epoch | L(t) = c/t + gλt/2, t* = √(2c/(gλ)) |
| Meta RSC | Δt* = √(2w_cp/(N_nodes·r_f)) with u₀ as R |
| Scale | MTBI(N) = 1/(N·λ_GPU-equivalent); R(N) from the pipeline's scale laws |

## 5. MTTR pipeline (§5, Fig. 5-1, Table 5-1)

R(N) = T_detect + T_localize + T_remediate + T_restart + T_load (+ warm-up); recompute = τ/2 (periodic checkpoint) or one step (replica recovery). Scale laws per stage: constant, linear (N/N₀), power ((N/N₀)^e), log (1 + s·ln(N/N₀)), order-statistic (1 + cv·(√(2 ln N) − √(2 ln N₀))), bandwidth (size/BW, BW ∝ N optional). Presets: timeout + manual (ByteRobust/Minder/Unicron), automated probes + warm standby (ByteRobust/Mycroft/TrainMover), TrainMover 8192-GPU restart (0.52 + 1.5 + 4.45 min), elastic/replica (Gemini 2.5, FlashRecovery).

## 6. Spares (§6.3, Tables 6-3, 6-4, 6-7)

Hot spares = smallest k with P(Binomial(N_nodes, p_daily) ≤ k) ≥ q (ByteRobust); Poisson quantile of N·λ·T_replenish (Meta); repair pipeline = Poisson(N·λ·f_hw·L) quantile; expected replacements over the job = N·λ·f_hw·D. Block MTBF = 1/(K_trays/MTBF_tray + 1/MTBF_rack).

## 7. Allocation (§6, design-review checklist)

- Series failure-rate budget λ*: equal (λ*/m), ARINC (∝ current), AGREE (Rᵢ = 1 − (1 − R*^{nᵢ/N})/wᵢ, rescaled), feasibility weights, minimum effort (Albert: worst subsystems to a common level), cost-optimal (minimise Σ aᵢ(λᵢ⁰/λᵢ)^{bᵢ} s.t. Σλᵢ = λ*, bisection on the multiplier).
- Availability target: ln Aᵢ = (wᵢ/Σw)·ln A*; λᵢ = Uᵢ/(MTTRᵢ(1 − Uᵢ)) or MTTR implied.
- Class weights (v3.3, `component.allocation`): AGREE importance and duty, feasibility weight (default 2 for assumed rates, 1 otherwise), cost coefficients a, b, floor factor (default 5 % of the current rate), `fixed`. With identical counts, importance and feasibility weights the equal, AGREE and feasibility methods coincide (reported); minimum-effort and cost-optimal keep current rates when the budget is already met.
- Goodput budget: with τ = √(2δM), loss L = √(2δ/M) + R/M. Fix R → solve √(2δ)s + Rs² = L*, s = M^{−1/2}; fix M → R* = M(L* − √(2δ/M)); balanced split by restart share. Stage budgets ∝ current stage times above floors.

## 8. Monte Carlo (§4.2, AIReSim-style)

Event-driven simulation of one synchronous job: units with exponential or mean-matched Weibull lifetimes (age-tracked; lemon fraction with rate multiplier; infant-mortality multiplier), repairs with their distribution, redundant groups (k required of size), β-factor common-cause events with a blast radius (node / rack / zone / cluster), hot-spare pool with replenishment or cluster requeue, fail-slow degradations as capacity factors, periodic checkpoints (interval τ, exposed save δ) with recompute of the lost segment, recovery drawn from the pipeline. A checkpoint is committed only when its exposed save completes: an interruption during the save restarts from the previous checkpoint (the interval and the partial save are lost), as in the renewal and Daly models. Outputs: goodput, MTBI, interruptions/day, blocked fraction, peak spares (P99), degraded loss, with mean, sd, 95 % CI and quantiles; compared with the closed form (disagreement flagged beyond 2 % absolute or 2 CI).

## 9. Validation

`packages/core/test/golden/golden.json` holds 143 cases computed independently in Python (mpmath/scipy) from the formulas above and the survey's worked examples (Tables 6-5 to 6-8, Daly 2006, Saxena 2024, TrainMover, Ironwood k-of-n, ByteRobust P99, textbook CTMC results, Benoit replication, Weibull/lognormal fits). 120 match the survey's printed numbers exactly, 4 at rounding level; the 4 discrepancies (Epoch replica model inputs, Meta Table 6-3 selection criterion, a goodput ratio) are documented in `golden-report.md` and are not engine issues.

---

# v2 additions (plan `PLAN_V2_AVAILABILITY_ENHANCEMENTS.md`)

Rates are per hour, times in hours unless marked (s). Every quantity below is implemented in `packages/core` and covered by the v2 golden vectors (`test/golden/golden_v2.json`, computed independently in Python).

## 10. Dual-path repair: automatic vs manual (自动恢复 / 人工修复)

Unit parameters: failure rate λ; automatic coverage `c ∈ [0,1]` (share of failures that take the automatic path); automatic success probability `s ∈ [0,1]`; mean automatic recovery time `T_a`; mean manual repair time `T_m`. Legacy input `mttrHours` means `c = 0, T_m = mttrHours`.

CTMC states `U` (up), `D_a` (down, automatic path), `D_m` (down, manual path):

| from → to | rate |
|---|---|
| U → D_a | λ·c |
| U → D_m | λ·(1−c) |
| D_a → U | s / T_a |
| D_a → D_m | (1−s) / T_a |
| D_m → U | 1 / T_m |

Mean repair time `E[R] = c·T_a + (1 − c·s)·T_m`; availability `A = π_U = 1/(1 + λ·E[R])` (alternating renewal; exact for any repair distribution with this mean); failure frequency `ν = λ·π_U`; automatic share of downtime `π_Da/(π_Da+π_Dm) = c·T_a/E[R]`; human fraction (events that reach a person) `1 − c·s`.

## 11. k-of-n group with dual repair and switchover (倒换成功率)

`n` identical active units (λ each), `k` required, repair parameters as §10, manual repair crews `r` (automatic recoveries are not crew-limited), switchover success probability `p_sw`, successful-switchover outage `t_sw` (s), switch-failure recovery time `T_sf`.

States `(a, m)`: `a` units in automatic recovery, `m` in manual repair, `w = n − a − m` working; up iff `w ≥ k`. Switch-failed states `S(a, m)` (down) exist for every `(a, m)` with `w − 1 ≥ k`.

| from → to | rate | condition |
|---|---|---|
| (a,m) → (a+1,m) | w·λ·c·p_sw | w−1 ≥ k (survivable failure) |
| (a,m) → (a,m+1) | w·λ·(1−c)·p_sw | w−1 ≥ k |
| (a,m) → S(a,m) | w·λ·(1−p_sw) | w−1 ≥ k |
| (a,m) → (a+1,m) | w·λ·c | w−1 < k (group goes down regardless) |
| (a,m) → (a,m+1) | w·λ·(1−c) | w−1 < k |
| (a,m) → (a−1,m) | a·s / T_a | a ≥ 1 |
| (a,m) → (a−1,m+1) | a·(1−s) / T_a | a ≥ 1 |
| (a,m) → (a,m−1) | min(m, r) / T_m | m ≥ 1 |
| S(a,m) → (a,m+1) | 1 / T_sf | |

Outputs: `A = Σ_up π`; `ν` = probability flux from up to down states; capacity (summed over up states only, down states deliver 0): `binary` (1), `proportional` (min(1, w/k), the v1 convention), `fractional` (w/n); successful-switchover micro-outage `U_sw = Σ_{(a,m) up, w−1≥k} π(a,m)·w·λ·p_sw·t_sw/3600`, reported separately and subtracted first-order (`A_eff = A − U_sw`, flagged if `U_sw > 0.1·(1−A)`); every successful switchover with `t_sw > 0` is counted as an interruption in `ν_eff`; MTTF from new = mean first passage from (0,0) to any down state. With `c = 0` and `p_sw = 1` the chain reduces to the v1 `kOfNRepairable(n, k, λ, 1/T_m, r)`. Groups with more than 700 states fall back to the v1 one-dimensional chain with `E[R]` from §10 and no switch states; the result is flagged `approximate repair mixture`.

## 12. Parallel (1-of-n, heterogeneous children) with switchover — first order

`U_perfect = Π_i U_i` (v1). With switchover `(p_sw, t_sw, T_sf)`: `U ≈ U_perfect + Σ_i ν_i·(1−p_sw)·T_sf + Σ_i ν_i·p_sw·t_sw/3600`, where `ν_i` is child i's failure frequency. Flagged `first-order` when the added term exceeds `0.1·(1 − U_perfect)` or `U_perfect > 0.01`.

## 13. Standby with switchover (v1 extension)

v1 `standby(n, λ, μ, f, p_sw, crews)` is kept; v2 adds `T_sf` (switch-failed state cleared at `1/T_sf` instead of `μ`) and the micro-outage `U_sw = Σ_{j ≤ n−2} π_j·λ·p_sw·t_sw/3600` (a switch happens only while a standby exists). Switch-failed states `SW_j` exist only for `j ≤ n−2`: the failure of the last working unit (`j = n−1`) has no standby to switch to and goes straight to the all-failed state `n` at rate `λ`, so `p_sw` and `T_sf` have no effect for `n = 1`. The MTTF from new is the same under either reading; `A` and `ν` are not (until 2026-10-11 the chain kept an `SW_{n−1}` state, which overstated the unavailability by up to a few per cent).

## 14. Sub-health unit (亚健康)

Parameters: λ and repair (§10); sub-health entry rate `λ_sh` or steady-state probability `p_sh` (converted `λ_sh = p_sh/((1−p_sh)·D)`, flagged when `m·λ·D > 0.1`); mean sub-health duration `D`; performance `φ ∈ (0,1)` while sub-healthy; escalation multiplier `m` (failure rate `m·λ` while sub-healthy); policy `tolerate` or `isolate` with detection probability `p_d` and mean detection delay `T_d`; threshold `φ_min` (default 0.7, MindCluster's 30 % degradation rule).

States: `U`, `H` (sub-healthy, not yet decided), `H'` (sub-healthy, undetected / tolerated), `I` (isolated: handled by the automatic path, down), `D_a`, `D_m`.

| from → to | rate | policy |
|---|---|---|
| U → H | λ_sh | both |
| U → D_a / D_m | λ·c / λ·(1−c) | both |
| H → U | 1/D | both |
| H → D_a / D_m | m·λ·c / m·λ·(1−c) | both |
| H → I | p_d / T_d | isolate |
| H → H' | (1−p_d) / T_d | isolate |
| H' → U | 1/D | isolate |
| H' → D_a / D_m | m·λ·c / m·λ·(1−c) | isolate |
| I → U | s / T_a | isolate |
| I → D_m | (1−s) / T_a | isolate |
| D_a → U, D_a → D_m, D_m → U | as §10 | both |

Measures: `A_strict = π_U`; `A_tolerant = π_U + π_H + π_H'`; `A_perf = π_U + φ·(π_H + π_H')` (performability); `A_threshold = π_U + [φ ≥ φ_min]·(π_H + π_H')` is the block's reported availability. `I`, `D_a`, `D_m` are down in every measure. Failure frequency = flux from the up set (threshold rule) into the down set. Detected-isolation frequency `ν_iso = π_H·p_d/T_d` per unit. With `m = 1`, `c = 0`, policy tolerate and `φ_min ≤ φ` the unit reduces to the v1 `degradedUnit`. MTTF from new of the unit = mean first passage from `U` into the complement of the threshold up-set: `1/(λ + λ_sh)` when sub-health counts as down, otherwise shorter than `1/λ` by the escalated failures (`m > 1`) and the detected isolations (policy isolate); it equals the mean up time `A/ν` because every repair returns to `U`. A leaf of `c` units reports `MTTF_unit/c` (the exponential-equivalent convention of §2).

Synchronous job of `N` units (straggler law, tolerate): `p_H = (π_H + π_H')/(π_U + π_H + π_H')` (sub-healthy given not down); `P(job slowed) = 1 − (1 − p_H)^N`; job performance factor `E[φ_job] = 1 − P(job slowed)·(1 − φ)` (exact under independence since any slow unit slows the step to φ). Policy isolate adds `N·ν_iso` to the job interruption rate and the undetected share keeps slowing the job.

## 15. Fabric plane loss as performance degradation

`P` equal planes, communication share `f_comm` of the step time: losing one plane multiplies the step time by `1 + f_comm/(P−1)`, so `φ_plane = 1/(1 + f_comm/(P−1))` (CloudMatrix384: P = 7, f_comm = 0.3 → φ ≈ 0.952).

## 16. Recovery ladder (MindCluster-style, 分级恢复)

Rungs `i = 1..L` with kind (`auto`/`manual`), success probability `s_i` (last rung `s_L = 1`) and time `t_i(N)` (a v1 stage with scale law). `P_i = Π_{j<i}(1 − s_j)`, `E[T] = Σ_i P_i·t_i`, share of rung i = `P_i·t_i/E[T]`, probability of needing a person = `P_{first manual rung}`. The ladder replaces the v1 pipeline as `R(N)` in the goodput formulas.

## 17. Original and compensated measures (原始 / 补偿后)

Original transform of a block tree: leaf → two-state unit with `λ_o = λ + λ_sh` and `E[R_o] = (λ·T_m + λ_sh·D)/(λ + λ_sh)` (every fault is an outage, manual repair, sub-health counted as an outage of duration D); `kofn(n, k, unit)` → `n` copies of the unit in series; `parallel(children)` → series of the children; `standby(n, unit)` → the primary unit alone; `repeat` unchanged. Waterfall steps, each evaluated on the whole tree: 0 original; 1 + redundancy (structure restored, configured switchover, manual-only repair `c = 0`, sub-health strict); 2 + automatic recovery (`c, s, T_a` as configured); 3 + sub-health policy (threshold/tolerant measure and isolation as configured) = compensated. Also reported: switchover penalty `A(p_sw = 1, t_sw = 0) − A(configured)` at step 3, and performability at step 3. Compensation gain = ΔA, MTBF ratio, MTTR ratio between steps 0 and 3.

## 18. Training availability models and the MTTR mixture (v2.1, decisions of 2026-10-10)

Full derivations and the comparison with the ai-cluster-reliability tool: `TRAINING_AVAILABILITY_FORMULAS_AND_COMPARISON.md`.

- **MTTR mixture** (`recovery.mode = 'mixture'`): `R = T_det + T_auto + (1 − p_s)·T_manual`, `T_det = p_d·t_auto + (1 − p_d)·t_timeout`. Undetected failures are found by the timeout and still try automatic recovery; a failed automatic attempt is charged before manual recovery. Implemented as a three-rung ladder (detection with success 0, automatic with success p_s, manual).
- **Operational availability** `A_op = M/(M + R)`.
- **First order** `A ≈ 1 − δ/τ − (W + R)/M`, `W = τ/2`, one step (replica) or the measured value `workload.measuredRecomputeS`.
- **Product form** `A_op · τ/(τ + δ) · (1 − W/M)`.
- **Exact renewal** `λτ/[(e^{λ(τ+δ)} − 1)(1 + λR)]`, `λ = 1/M`; implied rollback `E[min(X, τ) | X < τ+δ] = [(1 − e^{−λτ})/λ − τe^{−λ(τ+δ)}]/(1 − e^{−λ(τ+δ)})` (→ (τ²/2 + τδ)/(τ+δ) as λ → 0).
- **Daly full** `τ/(M e^{R/M}(e^{(τ+δ)/M} − 1))` (failures also during recovery).
- **Headline rule**: first order while its flags are `ok`, otherwise the exact renewal value; the scale table applies the rule per row, re-evaluating for every N the recovery R(N) from the scale laws (detection and global recovery), the chain and pause-only rates, the checkpoint interval against the row's rollback MTBI, the straggler law `1 − (1 − p_H)^N` and the silent-corruption window, so that a row equals a direct evaluation at that size; blocked spares (as configured) and the sub-health factor multiply the headline.

## 19. Mechanism chain and mixed event classes (v3, decisions of 2026-10-10)

Reference semantics: ai-cluster-reliability `catalogs/review-2026-10-09/engine.cjs` (audited), mechanism parameters `mechanism-policy.json`. Code: `mechanisms/chain.ts`, `checkpoint/renewalGoodputMixed`.

- **Chain per hard event** of class *i* with detection delay *d* (the mixture's T_det) and global recovery *G* (automatic attempt + manual fallback share): replay → elastic → process → global. A rung applies to a fraction *a_x* of the class's events (`component.mechanisms.{replay,process,elastic}`), succeeds with *s_x*, and charges *t_x^fail* when it fails before the next rung is tried. Outcomes: replay — pause `d + f + t_rp`, no rollback; elastic — global pause `f + t_sync`, the domain is out for `d + f + t_el` so the job loses `(d + t_el − t_sync)/n_dom` of compute, no rollback; process — pause `d + f + t_pr`, rollback to the last checkpoint; global — pause `d + f + G`, rollback. *f* is the sum of the failure times of the rungs tried before. The 27-path tree is enumerated exactly; per class `P_rb`, `E[pause·1{rb}]`, `E[pause·1{¬rb}]`, `E[local loss]`.
- **Event classes at job level**: rollback events λ_rb = Σ λ_i P_rb,i (+ immediately detected silent corruption without step recovery), pause-only events λ_p = Σ λ_i (1 − P_rb,i) (+ isolation of a *detected* sub-healthy unit, which saves progress first and pauses for G without rollback; + detected silent corruption with step recovery, pause `t_d + t_rec + t_step`). Rate-weighted pauses `R_rb`, `R_p`.
- **Mixed exact renewal**: `TOR = λ_rb τ / [(e^{λ_rb L} − 1)(1 + λ_rb R_rb + λ_p R_p)]`, `L = τ + δ`; pause-only events do not restart the interval. `λ_rb → 0` gives `τ/L · 1/(1 + λ_p R_p)`; `λ_p = 0` gives §18's form. Running share `A_run = 1/(1 + λ_rb R_rb + λ_p R_p)` replaces `M/(M + R)` as the operational availability.
- **First order (mixed)**: `1 − δ/τ − (P_rb W + R̄)/M_ev`, `M_ev = 1/(λ_rb + λ_p)`, `R̄` the rate-weighted pause; the checkpoint interval (Young / Daly) is chosen against the rollback MTBI `1/λ_rb`. Headline rule as in §18. Effective goodput = headline × (1 − P_blocked) × φ_job × (1 − ℓ_local), `ℓ_local = Σ λ_i E[local loss_i]` (fraction of job time).
- The hard-only reference baseline is unchanged by the chain machinery (no mechanism enabled ⇒ P_rb = 1, R̄ = R).

## 20. Silent data corruption over a finite window (v3)

Code: `sdc/index.ts`, scenario fields `component.sdc.ratePerHour` and `scenario.sdc` (detection coverage *q*, detect time *t_d*, fallback delay *D*, optional step recovery). Semantics follow the reference engine: an undetected corruption makes every later checkpoint dirty; it is discovered after *D* (wall clock), the job rolls back to the last clean checkpoint and pays the global recovery pause *R_c*; corruption still undiscovered at *T* discards the work since the last clean checkpoint (terminal discard). Only the first undetected event of an episode matters.

- **Episode rate** on the wall clock while clean: `ν = λ_sdc (1 − q) · A_run · (1 − P_clear)`, `P_clear = 1 − (1 − e^{−λ_rb L})/(λ_rb L)` (a rollback before the first dirty checkpoint is written clears the corruption; phase uniform over *L*).
- **Alternating renewal**: clean ~ Exp(ν), dirty + pause = `c = D + R_c` deterministic. With `S_k = Γ(k, ν) + (k − 1)c` the start of the k-th episode and `P(S_k ≤ y) = P(Poisson(νz) ≥ k)`, `z = y − (k − 1)c`:
  `E[N] = Σ_k P(S_k ≤ T)`, `E[dirty] = Σ_k ∫_0^D P(S_k ≤ T − x) dx`, `E[pause] = Σ_k ∫_D^c P(S_k ≤ T − x) dx`, `E[clean] = T − E[dirty] − E[pause]`. When `T/c` exceeds 4000 cycles the stationary fractions replace the sum: clean `1/(1 + νc)`, episodes `ν·clean·T`, rollback `g·dirty + U·episodes`, no terminal discard.
- **Delivered (正确有效) goodput** `= [g · E[clean] − U · E[N]]/T`, *g* the performance goodput (§19 effective goodput, which already contains detected corruption as events), `U = (τ²/2 + τδ)/(τ + δ)` the compute since the last clean checkpoint lost at the episode start. Rollback at discoveries `g·(E[dirty] − E[tail]) + U·E[N_disc]`, terminal discard `g·E[tail] + U·P(dirty at T)`. Reference factors reported alongside: `(1 − e^{−νT})/(νT)` (no recovery) and `e^{−νT}`.
- Detected corruption (*q*): without step recovery a rollback event with pause `t_d + G`; with step recovery a pause-only event `t_d + t_rec + t_step` (the volatile clean state keeps the checkpoint phase).
- Window ledger (closed form): downtime + saves + rollback + slow-down + local loss + blocked + SDC rollback + terminal discard + delivered = 1, decomposed with the headline model.
- Validation: independent Python goldens (renewal equations on a grid with an exact exponential kernel, `test/golden/compute_golden_v3.py`), a brute-force alternating-renewal simulation in `v3_models.test.ts`, and the reference engine's published means (4000 trials): delivered 93.33 / 62.56 / 45.87 / 25.24 % at 10k / 100k / 200k / 500k cards vs HAC-D 93.33 / 62.61 / 45.66 / 25.32 % (all inside the reference CI), A_op within 0.01 points.

## 21. Finite-window ledger simulation (v3)

Code: `mc/ledger.ts`, `mc/ledgerFromScenario.ts`. A job-level discrete-event simulation of one window with the three fault classes, the mechanism chain with per-class applicability (Bernoulli), sub-health detection and isolation (snapshot, then pause), silent corruption (immediate detection, step recovery, fallback discovery, clean-checkpoint retention, terminal discard) and checkpoint batching (`advance`: compute vs save within each period, commits update the checkpoint, dirty flag propagated). Faults arrive on the running clock. Three random streams: arrivals / detection; mechanism outcomes together with the global recovery draws; and the predictor's false alarms (a stream seeded from the mechanism stream), so that coalitions with and without a mechanism share the fault history (until 2026-10-12 the recovery draws came from the arrival stream, so any rung that avoided a global recovery shifted every later arrival). Every replication asserts `delivered + downtime + save + rollback + slowdown + local loss + terminal = T` and books each loss to a class. Output: delivered and A_op with CI and quantiles, mean ledger, event counts, per-class attribution, P(delivered ≥ target), P(dirty at end). Compared with the closed forms on the Simulate page (delta badge) and with the reference engine in `scripts/ref-compare-v3.ts`.

## 22. Mechanism library and Shapley attribution (v3)

Code: `mechanisms/index.ts`. The reference catalog's twelve mechanisms as scenario transforms with the reference target parameters: D-HARD (mixture detection 99.9 % / 1 s), D-SLOW (sub-health detection 99 % / 30 s), D-SDC (immediate silent detection 95 % / 1 s), R-SDC (step recovery 1 s / 1 s, requires D-SDC), R-REPLAY (90 % / 5 s / 10 s), R-PROCESS (95 % / 60 s / 120 s), R-ELASTIC (50 domains, 98 %, 180 s, 120 s, 1 s), C-FAST (τ 60 s, δ 1 s), H-RELIABILITY (optional rate reduction factor); R-CKPT, R-MANUAL and H-PROTECT are informational (baseline / no double credit). `mechanismReport(s, players, {metric})` strips the players from the scenario (baseline), evaluates all 2^n coalitions with the closed forms (value = delivered goodput, effective goodput or A_op), and returns single gains, last-added gains and exact Shapley values (Σ φ_i = v(all) − v(∅) by construction; interaction = Δ − Σ single). On the three-class baseline at 100k cards HAC-D's Shapley shares are D-SDC 30.68, R-SDC 0.02, R-REPLAY 0.33, R-PROCESS 0.34, R-ELASTIC 0.83, C-FAST 0.17 points (Δ 32.37) vs the reference's Monte Carlo 31.06 / 0.02 / 0.36 / 0.32 / 0.25 / 0.18 (Δ 32.17); the elastic difference is inside the reference's ±0.3–0.6 point sampling error (its mechanism stream desynchronises the fault stream).

### 22.1 Allocation on the delivered basis (v3.1)

`allocateScenario(s, {goodputTarget: G_d, basis: 'delivered'})`: with `f = delivered/effective` and `φ = effective/headline` of the scenario, the interruption budget is computed for the headline target `G_d/(f·φ)`. Feasibility by hardware alone is the delivered goodput with every failure rate × 10⁻⁶ under the current silent-corruption policy; when it is below `G_d`, the smallest immediate detection coverage `q*` (bisection on the closed form, hardware unchanged) and the longest fallback delay `D*` (current coverage) that reach `G_d` are reported and the budgets are computed with the coverage raised to `q*`. The rate and stage tables are produced in the slack case too (allowed values above the current ones).

### 22.2 Mechanism planner (v3.1)

`planToTarget(s, {target, players, effort, derate, scan, verify})`: baseline = scenario with the players stripped; for every coalition S the closed-form value v(S) and the derated value v_d(S) (library parameters worsened: coverage − 0.05, success − 0.08, times × 1.5, H-RELIABILITY reduction × 0.5; design choices such as the checkpoint compute interval and the domain count unchanged); feasible ⇔ v ≥ G* and v_d ≥ G*; plan = argmin effort over feasible S (ties: larger margin); necessary = ∩ feasible S; Pareto front over (effort, v). Scan: immediate detection coverage × automatic recovery seconds applied on top of the plan (recovery axis only for the MTTR mixture). Verification: ledger simulation of the plan, P(window ≥ G*) ≥ confidence. Practice: `docs/ALLOCATION_PRACTICE.md`.

### 19.1 Chain extensions (v3.2)

Rung order per interruption: **predict** (applicable fraction = share of persistent card / server faults; recall r turns the fault into a planned migration with pause t_mig, no detection delay, no rollback; false alarms add pause-only events at rate λ·a_pred·r·(1 − precision)/precision) → **netfail** (network-class events absorbed inside the collective: success s_nf, pause f + t_nf, no detection delay, no rollback; failure adds t_fail) → replay → **hotswap** (card / server events replaced from a spare: pause d + f + t_hs, no rollback; failure adds t_fail) → elastic → process → global → manual. Fault-free overhead: `scenario.mechanisms.overheads` (per mechanism) sums to o, and effective = headline × (1 − P_blocked) × φ_job × (1 − ℓ_local) × (1 − o); the window ledger carries an `overhead` line and the scale table applies the factor to every row; A_op is unaffected. A class without a `predict` flag is not predictable: a missing flag means 0 for every rung. The ledger simulation applies the same rungs (Bernoulli applicability), a Poisson stream of false-alarm migrations on the running clock, and the overhead as a compute factor.

### 22.3 Library entries added from the literature (v3.2)

P-PREDICT (recall 0.5, precision 0.8, migration 180 s; HeaRank, Meta ECC-trend, Clockwork), R-NETFAIL (0.95, 2 s, failure 10 s; R²CCL, VCCL), R-HOTSWAP (0.9, 180 s, failure 60 s; PHOENIX, Clockwork TorchPass), C-MEM (τ 60 s, δ 0.5 s, global recovery −60 s, overhead 1 %; GEMINI, ECCHECK, TierCheck), D-SDC-DMR (coverage 0.999, 1 s, overhead 8 %; SpareTrain, AEGIS), H-LEMON (share 0.1 × reduction 0.7 on interruption rates; Meta lemon detection), H-SWEEP (sub-health entry rate × 0.5, duration × 0.5; Guard). All parameters are priors tagged in the entry; the planner derates coverage, detection targets and shares (eligible share, risk share) by −5 points, success, recall and precision by −8 points, times and overheads ×1.5, the manual-fallback probability ×1.5, the fabric-degrade exposure (+5 points of communication share, −5 points of remaining bandwidth), reductions ×0.5 and compression ratios towards 1; design choices (compute interval, domain count, population shares) and "before" reference values stay. `mechanismReport` returns the gains for every value function (`byMetric`), so A_op and delivered goodput are attributed side by side. C-MEM shortens the automatic attempt of the MTTR mixture and the checkpoint-load stage of a pipeline recovery (a preset is resolved into explicit stages); ladder recoveries carry no load stage and keep their rungs.

### 22.4 Applied records: remove is the exact inverse of apply (v3.4)

Every library transform records on `scenario.mechanisms.applied[id]` the parameters used, its order of application and the values it replaced (checkpoint interval and save time, recovery settings, detection targets, the overhead map; multiplicative changes as factors). `stripMechanisms` undoes all records in reverse order of application and re-applies the mechanisms that stay with their recorded parameters, so removing a mechanism restores the scenario exactly, and `applyMechanisms` removes an already applied mechanism before applying it again, so re-application replaces instead of compounding (C-MEM's recovery saving, the H-LEMON / H-SWEEP / H-RELIABILITY factors). The attribution baseline and the planner's baseline use the same path. A scenario written by hand carries no records: stripping then only switches the mechanism off (`isStrippable`) and the settings it changed stay as configured, which the report notes.

#### 22.4.1 Order of application (v5.5, fifth review D5)

Not every pair of transforms commutes: C-FAST and C-MEM both set τ and δ (the later one wins), and R-ELASTIC re-applied after R-HCCL-ELASTIC rewrites the elastic block the latter had shortened. (The same-stage reductions of §24.2 and the custom rungs no longer depend on the order since the recheck of the fifth review: the stage is the per-event expectation, and custom rungs are tried in the canonical order `CUSTOM_RUNG_ORDER` of `mechanisms/chain.ts` — the closed form, the MTTR split and the window ledger alike.) A design is therefore its mechanisms *in their recorded order* (`mechanisms.applied[].order`). `applyMechanisms` keeps the library order for mechanisms added to a design; `applyMechanismsInOrder` applies a given order, and `deratedOf` (the derated twin), the strategies' derated designs (`allocateStrategy`) and the budget's rebuild of the final design (`hierarchicalBudget`) use it with the recorded order, so a project whose mechanisms were applied in another order than the library's keeps the same design on both sides. D-SDC takes the maximum of its coverage and the one already in place (as D-SDC-DMR does), so the two detectors commute whatever the order; the committed report set is unaffected (its baseline is applied in library order on a bare scenario).

## v3.5 additions (2026-10-13, from the three-tool comparison `TOOL_COMPARISON.md` §6)

### 20.1 Terminal rule of the silent-corruption window

`scenario.sdc.terminalRule` (default `retain-last-clean`): a window that ends inside an episode keeps the work up to the last clean checkpoint and discards the tail (§20, the audited review engine). `discard-all` is the reference V4 / ReMAP legacy `delivery` rule: the whole window delivers nothing unless it ends clean (dirty, or still in the recovery pause of the last discovery, counts as unresolved). In the alternating renewal of §20 the window ends clean with exactly *n* completed episodes with probability `Poisson(n; ν(T − nc))` (the n episode starts are `Γ(n, ν) + (n − 1)c`, the (n+1)-th clean period must outlast the remainder, and the clean time of such a window is exactly `T − nc`), so

`delivered_discard = Σ_{n ≤ T/c} Poisson(n; ν(T − nc)) · [g(T − nc) − U n]⁺ / T`, `P(unresolved at T) = 1 − Σ_n Poisson(n; ν(T − nc))`.

Both values are always reported (`deliveredRetained`, `deliveredDiscardAll`, `pUnresolvedAtEnd`); the ledger's terminal line absorbs the difference so that delivered + rollback + terminal = g·(1 − pause) under either rule. The stationary fallback (T/c > 4000) multiplies the retained value by the stationary clean share. Validation: `compute_golden_v3.py` solves the recursion `F(t) = e^{−νt} g t + ∫_0^{t−c} ν e^{−νx}[(g x − U)·P_clean(t − x − c) + F(t − x − c)] dx` on the grid independently of the Poisson sum (five cases, 2e-6), and `v35_models.test.ts` checks a brute-force simulation and the ledger simulation, which applies the rule per window (`unresolvedAtEnd`). The two rules are different metrics and are never compared as one (ReMAP's own rule).

### 19.2 Order of the recovery rungs

`scenario.mechanisms.order` lists the detection-delayed rungs (`replay`, `hotswap`, `elastic`, `process`) in the order they are tried; missing rungs follow in the default order replay → hotswap → elastic → process, unknown names and duplicates are ignored, and prediction and network failover always act first (they need no detection). `chainOutcome(d, G, params, applicable, order)` enumerates the tree in that order, the ledger simulation follows the same order (`chainOrder`), and the Python harness carries the order (three golden cases). This is ReMAP's `recoveryOrder` (its model `review-retained-progress.v2`).

### 21.1 Statistics of the simulations

`summaryStat` (`math/stats.ts`): mean, sample standard deviation, the 95 % half-width `t_{0.975, n−1}·sd/√n` (Student-t; the normal quantile above 10⁶ degrees of freedom), type-7 quantiles (linear interpolation, as R / NumPy / ReMAP). Probabilities estimated as shares of windows (`P(window ≥ target)`, `P(unresolved at end)`) carry a Wilson score interval `[(p + z²/2n) ± z√(p(1−p)/n + z²/4n²)]/(1 + z²/n)`. The planner's verdict compares the Wilson bounds with the required confidence: `supported` when the lower bound reaches it, `below` when the upper bound misses it, `uncertain` otherwise (more windows needed). Student-t and chi-square quantiles come from the regularized incomplete beta and gamma functions (continued fractions, `math/special.ts`), checked against SciPy in `golden_stats.json` (92 vectors). The intervals cover the sampling error of the simulation only, never the uncertainty of the inputs.

### 22.5 Checkpoint bounds in the planner

Without any fault the window still pays the saves: goodput ≤ `(⌊S/L⌋τ + min(S mod L, τ))/S` over a window of S seconds (L = τ + δ) and ≤ `τ/L` in the long run (the duty cycle). Every coalition carries its bound (its own τ, δ after C-FAST / C-MEM); a target above the best coalition's finite-window bound is `provenInfeasible` and the planner says so instead of "not found" (ReMAP's `proven_infeasible` certificate). In HAC-D's models step recovery never skips a save, so the bound holds for every mechanism set with those settings; A_op has no such bound (saves are not downtime).

### 7.1 Loss budget over the window ledger

`lossBudget(ledger, G*, T)`: the allowed loss `1 − G*` (fraction of the window and hours) is split over the nine ledger lines (downtime, save, rollback, slowdown, local, blocked, overhead, SDC rollback, terminal) by weight — `proportional` to the current ledger (default), `equal` over the lines with a current loss, or `custom` weights — and each line reports current, allowed, excess and the levers that move it (the mechanisms and parameters of `MECHANISM_CONTRIBUTIONS.md` §4). The split is an accounting target (the lines are mutually exclusive shares of the window, closed-form ledger), not a proof that each line can be reached independently; ReMAP's reference weights 25 / 20 / 35 / 10 / 5 / 5 % for downtime / save / rollback / terminal / slowdown / local are one `custom` choice. Attached to `allocateScenario` on the delivered basis (or without silent corruption), shown on the Allocation page, printed by `hacd allocate`, returned by `allocate_scenario`.

## 23. Failure rates from incident counts (v3.5)

`rateFromCounts(k, E, c)` (`fit/incidents.ts`): k de-duplicated business-impact events of one class over an exposure of E unit-hours give λ = k/E (FIT = λ·10⁹, MTBF = 1/λ) and the exact Garwood interval `[χ²_{α/2}(2k)/(2E), χ²_{1−α/2}(2k+2)/(2E)]`, α = 1 − c; with k = 0 the one-sided upper bound at c is `χ²_c(2)/(2E) = −ln(1 − c)/E` (95 % and 10⁶ unit-hours: 2995.73 FIT) and the point estimate 0 must not be used as the rate. `unitRateFromCounts(k, units, hours, c)` takes the exposure as units × hours. The Scenario page's component details, `hacd rate` and the MCP tool `estimate_rate` expose it; applying it writes `component.failure` in FIT with provenance confidence `measured` and the derivation (the upper bound when k = 0). The interval covers Poisson sampling only (constant rate, independent events); trends, infant mortality and reporting gaps need their own evidence. Checked against SciPy (`golden_stats.json`).

## 24. Mechanism audit catalog, custom rungs, recovery stages and the allocation study (v3.7, 2026-10-15)

Source: the user's mechanism audit 新可靠性机制库 · 单点收益量化审核 (review 02, 2026-10-14; data kept verbatim in `packages/core/data/mechanism-audit.json`, generated module `mechanisms/auditCatalog.ts`). Decisions of 2026-10-15: the audited mechanisms stay audit-only until their four integration fields are given (a one-click switch fills provisional assumptions, tagged assumed and derated); the automatic recovery attempt is modelled with the audit's stage budget (startup / checkpoint read / communication rebuild, 60 / 60 / 60 s of 180 s) and mechanisms on the same stage take the minimum; the audit and the cross-scale study are web page, CLI and MCP.

### 24.1 Custom chain rungs

`scenario.mechanisms.custom[id] = { success s, successSeconds t_s, failureSeconds t_f, rollback, detectionDelay, localLossSeconds ℓ, position }` with per-class applicability `component.mechanisms.custom[id] = a`. `transparent` rungs are tried right after network failover and before the detection-delayed rungs, `delayed` rungs after the ordered rungs and before the global recovery (insertion order among customs). Success path: pause `(detectionDelay ? d : 0) + f + t_s`, rollback as flagged, local loss ℓ booked to the `local` line (degraded running outside the pause); failure adds `t_f` to `f`. `chainOutcome` enumerates the tree exactly (`pCustom[id]`); the ledger simulation draws the same Bernoulli rungs, runs ℓ as a throughput factor `1 − ℓ/T` for `localLossDurationSeconds = T` of wall time after the pause (R-FABRIC-DEGRADE: the repair time) or, without a duration, books ℓ as progress lost at the event (checkpoint pointers lowered so that the window identity holds), and counts `custom` successes. Golden cases `chain.v37_*` (independent Python recursion in `compute_golden_v3.py`). Used by R-LINK-LOCAL (2 s, no rollback), R-FABRIC-DEGRADE (2 s switch + ℓ = (1 − η)·T_repair with η = 1/[(1 − f) + f/r] = 0.909 → 163.6 s) and H-CONTROL-CONTINUITY (1 s).

### 24.2 Recovery stage budget and per-class overrides

`automaticStages(r)` returns `{ startup, graphWithinStartup, read, communication }`: explicit `recovery.automatic.stages` when given (rescaled to `automatic.seconds` when their sum differs from it, so the attempt always wins and a stage saving is never scaled by the mismatch), else thirds of the attempt (graph = half of the startup). Scenario-level changes (C-LOSSLESS: read → read/r + decompression; C-MEM: read → max(0, read − 60), floor 30 s on the sum) rewrite `stages` and `automatic.seconds = Σ`. Per-class overrides `component.recoveryStages` (R-WARM-PROCESS startup → 20 s, R-RUNTIME-SNAPSHOT → 15 s, R-CANN-GRAPH → startup − (graph − 7.5) on their candidate classes): the audit's same-stage minimum rule per event — of the same-stage mechanisms an event is eligible for, the best candidate wins, else the stage keeps its base — so with independent eligible shares a_k the class's stage is the expectation E = Σ_k c_(k)·a_(k)·Π_{j<k}(1 − a_(j)) + Π_j(1 − a_j)·base over the candidates sorted ascending (`sameStageValue`; v5.5, recheck of the fifth review; a candidate at or above the base adds nothing). The value does not depend on the order of application (one mechanism: base − a·(base − c), the former sequential rule, which also equals the expectation for two mechanisms applied larger-candidate-first — the library order, so the reports are unchanged; the trio with R-CANN-GRAPH last used to skip it: 15.35 s instead of 15.30 s on UNKNOWN-hard at shares 0.95). Each applied record stores the class's previous stages, and re-application through `stripMechanisms` recomputes the expectation. Closed form: the class's global recovery is `g_i = G − (A − A_i)·(A(N)/A)` with A the default attempt, A_i the class's, A(N) the attempt at scale (the manual share is unchanged); `chainOutcome` runs per class with `g_i`. Ledger: a per-class sampler draws `A(N)·A_i/A + manual` on the mechanism stream. Test: with the three startup mechanisms applied the UNKNOWN class ends at 15 s (not 60 − 40 − 45 − 22.5) and its mean pause is 45 s below a class without override.

### 24.3 Per-class silent-corruption coverage

`component.sdc.coverage` is an absolute override of the scenario-level immediate detection coverage for one class (a scenario-level detector, D-SDC or D-SDC-DMR, raises it to at least its own coverage); `component.sdc.extraDetection[id] = c` registers a conditional detector that catches the share *c* of the misses left by every other detector. The class coverage is `q_i = 1 − (1 − q)·Π_k (1 − c_k)` with q the absolute coverage (`classSdcCoverage`), so the order in which detectors are applied does not matter, and the job-level coverage is the rate-weighted mean `q = Σ λ_i q_i / Σ λ_i` (Poisson thinning is additive, so the undetected rate is exact) in the closed form and the ledger spec. D-ABFT registers c = 0.9 (the audit's c_total = c₁ + (1 − c₁)c₂ on top of a 95 % detector), D-NET-SDC c = 0.95 on the network classes, D-SDC-FP8 / FP4 c = riskShare × 0.95 on CORE-sdc (the precision path's risk share being a null field with provisional 1/3). H-SDC-SCREEN multiplies the silent rate of its candidate classes by `1 − 0.25·a`.

### 24.4 Durable lag of asynchronous saves

`workload.rollbackLagS` (C-ASYNC: 10 s, with δ → 1 s): every rollback returns `lag` seconds below the checkpoint. First order: `W → W + lag`; exact renewal: the goodput is lowered by `λ_rb·lag·A_run` on the running clock and the ledger's rollback line raised by the same amount; ledger simulation: `rollback(cp − lag)` for hard and detected-corruption rollbacks, while a fallback discovery returns to the clean checkpoint itself (as in the closed form, where the lag enters λ_rb only). An approximation, flagged in the assumptions (the audit calls the lag illustrative).

### 24.5 The 16 audited mechanisms

| id | transform | needs (null in the audit) | provisional |
|---|---|---|---|
| R-LINK-LOCAL, R-FABRIC-DEGRADE, H-CONTROL-CONTINUITY | custom rung on the candidate hard classes | eligibleShare, success, failureSeconds (+ overhead) | 1, 0.9, 10 s, 0 |
| I-CONTAIN | none (enabling capability of R-ELASTIC; incremental 0) | — | — |
| R-WARM-PROCESS, R-RUNTIME-SNAPSHOT, R-CANN-GRAPH | per-class startup stage | eligibleShare | 1 |
| C-ASYNC | δ → 1 s, rollback lag 10 s | — | — |
| C-LOSSLESS | read stage → read/2 + 10 s | — | — |
| D-RECOVERY-CLASSIFY | automatic success → 1 − 0.001 | — | — |
| D-SDC-FP8, D-SDC-FP4 | CORE-sdc coverage on the path's risk share | riskShare | 1/3 |
| D-ABFT | CORE-sdc coverage, overhead 0.1 % | — | — |
| D-NET-SDC | network sdc coverage 95 % | — | — |
| H-SDC-SCREEN | silent rate × (1 − 0.25·a) on the candidates | eligibleShare | 1 |
| R-HCCL-ELASTIC | elastic recoverSeconds − 45 s (requires R-ELASTIC) | — | — |

Every transform records what it replaced (`applied.ts`: `mechanisms.custom`, `componentCustom`, `componentStages`, `componentSdc`, `workload.rollbackLagS`, `recovery`), so removal is exact and re-application replaces (test `audit_v37.test.ts`). Transforms whose needs are not met return the scenario unchanged (audit-only); `provisionalParameters(ids)` supplies the switch's values and `integrationStatus(def, p)` reports needs / provided / missing.

### 24.6 Single-point audit

`auditMechanisms(s, { ids, provisional, parameters })`: the baseline in the audit's terms from the scenario — `T_det = p_d t_auto + (1 − p_d) t_timeout`, the attempt and its stages, `p_manual = 1 − p_s`, `W = recompute per rollback` (τ/2 = 150 s at τ = 300 s), regular loss `T_det + T_auto + W` (342.5 s), expected loss `+ p_manual·T_manual` (414.5 s) — and one `SinglePoint` per mechanism (metric, unit seconds / fraction / FIT, before, after, improvement, formula, sensitivity range, derived values) from the audit's own formulas for the 16 and from `BUILTIN_SINGLE_POINT` for the built-in ones (replay: d + t_rp; elastic: t_sync + (d + t_el − t_sync)/n; C-MEM: attempt − 60 s; …). On the reference catalog the 16 rows reproduce the audit JSON's before / after exactly (test). Cluster-level deltas are the single application on the baseline (incremental over the required mechanisms when any), only when the transform can act. `auditReportHtml(report, lang)` writes the standalone page with the audit's structure (cards, notes, flow, stage budget, summary table, sensitivity, one article per mechanism, embedded JSON with export).

### 24.7 Cross-scale allocation study

`allocationStudy(s, { sizes, target, metric: aOp | delivered | effective, players, provisional, trials, seed, derate, levers, curves })` (`study/index.ts`): per size — hardware-only factor (bisection on a uniform scale of all hard rates: ARINC, identical improvement per class; minimum effort for the worst-first view) and recovery-only factor (uniform scale of all recovery stages; stage budgets by `allocateRecoveryStages`); the planner (`planToTarget` exact up to 10 candidates, greedy forward selection by nominal gain per effort beyond, both nominal and derated); the plan's decomposition of `1 − A_run = Σ λ_i p̄_i / (1 + Σ λ_i p̄_i)` by domain group (reference catalog groups or `component.subsystem`) plus the isolation of detected sub-healthy units (pause G), the predictor's false alarms, detected silent corruption and the silent-corruption episode pauses as their own lines; the residual hardware factor with the plan; Shapley attribution (`mechanismReport` exact up to 12 players, permutation sampling with a Student-t half-width beyond); recovery levers beyond the library on the mixture (automatic attempt 60 s, success 99.9 %, manual 30 min and their combinations); a ledger verification of the plan (P(window metric ≥ target), Wilson, verdict at 90 % confidence); metric-vs-N curves for the baseline, each size's plan and the all-on set with the largest supported N by bisection. `studyReportHtml(result, lang)` draws the three charts (metric vs N with derating bands and max-N markers; loss composition per size against the budget line; Shapley heatmap with plan frames), the tables and generated conclusions. The 2026-10-15 study `docs/AVAILABILITY_ALLOCATION_98P5.zh.html` is the catalog run of this function (identical numbers).

### 24.8 Surfaces

Web: page "审核与报告 / Audit & study" (minimal mode) with the mechanism selection, the provisional switch, in-page tables, the embedded report and HTML / JSON downloads; the Mechanisms page gained the same switch (attribution, planner and Apply use the provisional values when it is on). CLI: `hacd audit <s> [--mechanisms …] [--provisional] [--html out.html] [--lang zh|en] [--json]`, `hacd study <s> [--sizes …] [--target 0.985] [--metric aOp] [--players …] [--provisional] [--trials 200] [--seed 1] [--no-derate] [--no-levers] [--no-curves] [--html out.html] [--lang zh|en] [--json]`. MCP: `audit_mechanisms`, `allocation_study` (both with `htmlPath`).

## 25. v5 report pipeline (2026-10-21)

Plan: `docs/markdown/PLAN_V5_REPORT_PIPELINE.md`. The Ascend allocation report set (Methodology, Findings per topology, 100k BOM) is produced from three input records (topology record, failure-rate override, mechanism set; §25.4) by core primitives, pure report recipes (`packages/reports`) and the CLI (`hacd findings | bom | budget | methodology | prune | study | records`, `docs/markdown/USER_GUIDE.md` "v5 CLI"). The formula numbers below are those of `docs/ASCEND_ALLOCATION_METHODOLOGY.html` (text in `packages/reports/src/content.mjs`, `FORMULAS`).

### 25.1 Formulas (1)–(6) and the primitives

| Methodology | Primitive (module) | What it computes | 口径 |
|---|---|---|---|
| (1) A_op in MTBF / MTTR form | `kpiForm(s, t?)` (`budget/kpiForm.ts`) | A_op = (1 − φ) / (1 + (Σᵢ λᵢ t̄ᵢ + F)/3600), F = Σ_k λ_k t_k; MTBF_hw = 1/Σλᵢ (h), MTTR_hw = Σλᵢ t̄ᵢ / Σλᵢ (s), `other[]` = isolation, detected silent corruption, false alarms; `aRun`, `phi`, `sumLP` | job-level events per hour, pause seconds of job time, A_op over the job window; the form is asserted against the engine's running fraction (|Δ| ≤ 1e-9) and the other classes are never added to λ or MTTR |
| (2) system-level requirement | `requirementFromKpi(kD, A*)`, `requirement(s, A*)` (`strategy/requirement.ts`) | B = 3600·((1 − φ)/A* − 1) − F (allowed hard pause s per job hour), MTBF needed at today's MTTR = MTTR/B, MTTR needed at today's MTBF = B·MTBF, the two factors; v5.5: `reachable` = B > 0 — when F and φ alone exceed the budget the two ends and the factors are null and every surface prints the reason (`UNREACHABLE_TEXT`) instead of a negative requirement | φ and F of the derated design (the binding side) |
| (3) layer budget | `layerModel(spec)`, `byLayer(s, t?, layers?)`, `unavailabilityByLayer(x)` (`layers/index.ts`) | six layers (cluster, scale-out, SuperPoD, cabinet, node, NPU), each the set of fault units whose classes it owns; λ_ℓ, C_ℓ = Σ_{i∈ℓ} λᵢ t̄ᵢ, iso_ℓ (by the layer's sub-health entry rate), sdc_ℓ (v5.5: by the layer's detected silent rate Σ λ_sdc,i qᵢ, qᵢ the class coverage of §24.3 — the raw-rate split while every class has the same coverage), MTTR_ℓ = C_ℓ/λ_ℓ, instances m_ℓ and MTBF per instance m_ℓ/λ_ℓ; U_ℓ = 100·C_ℓ/(3600·D), D = 1 + (ΣC + F)/3600 with F of formula (1) (v5.5: including the predictor's false alarms, which no layer owns) | every class on exactly one layer, so Σ_ℓ λ_ℓ = λ_hw and Σ_ℓ C_ℓ = Σλᵢt̄ᵢ; U in points of A_op; event classes combine only as unavailability points |
| (4) unit budget, factor k, effort | `unitTable(s, k)` (`budget/index.ts`), `recommendPlan` (`strategy/window.ts`), `allocateStrategy` (ARINC) | FIT*_u = k·FIT_u, MTBF*_u = 10⁹/FIT*_u; E = Σ mechanism effort + Σ lever effort + Σᵢ 2·log₂(1/xᵢ) | business-impact interruption FIT per unit-hour; k multiplies every hardware interruption class (ARINC); k ≥ 1 acceptance ceiling, k < 1 delivery task |
| (5) MTTR composition | `chainSplit(...)`, `classChainSplits(s)`, `mttrDecomposition(s, t?)` (`mttr/decompose.ts`) | per class the pause split over the rungs (`detect`, `custom:<id>`, `failed:<rung>`, replay / elastic / process, `globalAuto` split into startup / read / communication, `globalManual` = (1 − p_succ)·t_manual); rate-weighted job MTTR; end probabilities. v5.5 (fifth review D4): each class runs on its own global recovery gᵢ and attempt Aᵢ of §24.2 — the engine's chain row carries `globalS`, `autoS` and `stages` — and its global attempt is split by its own stages (pᵢ,global·t_stage,i), so the split closes with R-RUNTIME-SNAPSHOT / R-WARM-PROCESS / R-CANN-GRAPH applied (golden `chain.a3server-10k.snapshot`) | seconds of job time per hardware interruption; contributions sum to t̄ᵢ (1e-9 relative); isolation / detected-silent / false-alarm pauses are F, not part of this MTTR |
| (6) window check and Shapley | `deratedOf(s, derate?)`, `windowCheck(s, A*, trials, seed, required)`, `recommendPlan(s, o)` (`strategy/window.ts`); `pruneByShapley`, `shapleyAtScale` (`study/prune.ts`); `mechanismHierarchy` (`study/hierarchy.ts`); `shapleyByLayer` (`layers/shapley.ts`); `archStudy` (`study/archStudy.ts`) | P(A_op,30 d ≥ A*) over 400 windows (seed 1) with the Wilson 95 % lower bound ≥ 0.9; sampled Shapley values of A_op and delivered goodput (300 permutations) on the bare scenario per scale; the verdict rule (reference / candidate / goodput / pruned / capability); exact per-layer Shapley for ≤ 8 players | A_op over the 30-day window; Shapley in fractions of A_op / delivered goodput at one scale; per-layer Shapley in pause seconds per job hour removed |

Assembly: `hierarchicalBudget(s, options) → BudgetResult` (one architecture × scale: today, required, hardware alone, optimal plan, the window rule's recommended design decomposed by layer / unit / rung / stage, mechanism parameters nominal and derated, pause removed per mechanism and layer); `budgetFromRecords(records, set, { sizes, target, main?, trials?, seed?, rates?, variantId? }) → BudgetDocument` (= `results.json`; `main` defaults to the last size); `bomDocument(records, npus, sizes?)` / `bomOfVariants(record, N)` (= `bom.json`, identity checks: designs of one family share the scale-out counts, FIT splits sum to the total, row rates sum to the job rate); `archStudy(record, set, { sizes, permutations, rates })` (= one `<record>.json` Shapley study); `mechanismHierarchy(set, studies, { permutations, basis, check })` (= `mechanisms.json`).

### 25.2 The hardware factor k: the engine's root, formula (4) is the check

The uniform factor k of the window rule (`recommendPlan`) is the bisection root of A_op,der(k) = A* with φ (the loss of undetected silent corruption) evaluated at k. The closed form k* = B / ΣC₁ of formula (4) holds φ at its k = 1 value; φ depends on the hard rate through the silent-corruption window (the share cleared before it persists, `pClearedBeforePersist`, and the episode rate per wall hour), so the closed form is first order in φ and agrees with the root to about 1e-5 relative (independent verifier, golden G5: native950 500k 0.862873 vs 0.862868; cm384 200k 1.433287 vs 1.433298). Reports print the engine's root; formula (4) is the check, not the definition.

### 25.3 Building a derated final design from the public helpers

The order matters and must follow the engine: `applyMechanisms(s, mechanisms, parameters)` → `deratedOf(s)` → `applyLevers(s, levers, DERATE_DEFAULT)` → `withHardwareFactors(s, { every hard class: k })`. `deratedOf` strips and re-applies the recorded mechanisms with derated parameters, so applying it after the levers restores the pre-lever recovery block (automatic 180 s / manual 7,200 s) and yields a wrong design (native950 at 500k, k = 1: A_op 0.9719 instead of 0.9828). `recommendPlan` and `hierarchicalBudget` build their derated twins in this order. v5.5: `deratedOf` re-applies the recorded mechanisms in their recorded order (§22.4.1), and the window rule refuses fewer windows than `minWindowTrials(required)` (35 for P ≥ 0.9 at 95 %: an all-passing sample's Wilson lower bound is n/(n + z²), so below that count no design can be "supported" and the escalation would run through every move and fail — fifth review D7); `hierarchicalBudget`, `reportFromScenario`, the CLI flags and the web field enforce the same minimum.

### 25.4 Input records

- Topology record (`records/topologyRecord.ts`, `TopologyRecordSchema`; files `packages/core/data/records/*.json`; four built-ins in `BUILTIN_TOPOLOGY_RECORDS`, further records such as `a960e.json` and `a960.json` (v5.4: the HC2025 roadmap Atlas 960 SuperPoD on the record-defined `ub-generic` template) resolved by id from the folder; v5.3 `RECORD_EXAMPLES` registers the Atlas 950 example as the native950 record's geometry under its page id and adds `topology-ubl128` / `topology-a3server`, so a page and the Findings report of one architecture show the same numbers): template, SuperPoD geometry (`superpod.base` preset + field overrides), count overrides, main scale-out design and `variants` ('main' must equal `scaleOut`), `layers` (instance rule), `scenarioId`, `provenance` by field path, `assumed`, optional `schematic` labels of the overlay figure (presentation only; `scenarioFromRecord` does not read it). `scenarioFromRecord(record, N, variant?)` equals the v4.4 scenario builders (`records.test.ts`). A new hardware unit kind needs the two extension points named by `TOPOLOGY_EXTENSION_POINTS` (unit-library entry and BOM row).
- Failure-rate override (`records/faultRates.ts`): per-unit or per-card FIT per class with source and confidence; `applyFaultRates` writes them on the bare design and puts the provenance on the component. v5 T11: `unitTable` adds `fitProvenance` (class, FIT, confidence, source) to a unit row when a class on that unit carries a confidence other than the library's `assumed`, so the Findings Table 3 tags it ("FIT measured"); the row's own `confidence` remains the count's (template geometry). Absent for library values, so `results.json` of the v4.4 runs is unchanged.
- Mechanism set (`records/mechanismSet.ts`): baseline / candidates / goodputOnly / pruned / capability lists, parameters, efforts, levers, derate, recovery baseline, optional stage split, pruning rule, metadata, verdicts. `mechanismHierarchy` checks the lists against `pruneByShapley` on the studies (throws by default); the CLI calls it with `check: false` and prints the mismatches as a warning (`--strict-prune` fails), because a hand-fixed list is a legitimate input; `hacd prune` re-derives the lists.


#### 25.4.1 Reconciliation of 2026-10-21 and the provenance fields

`docs/markdown/V5_PARAMETER_RECONCILIATION.md` records the pass over the three default records. Fields added or changed: topology records carry bilingual `assumed` items (`{ zh, en }`, printed by the BOM report) and re-tagged `provenance` entries (native950 `podSwitchRadix`, `cpusPerNode`, `transceiversPerLink` → derived with the source arithmetic; `scaleOut` of native950 / ubl128 → assumed, the network design being an analogy; ubl128 `podSwitchRadix` → assumed; a3server `domainNpus` → derived by definition of the option); the mechanism set has a `provenance` map by field path (`parameters`, `baseline`, `candidates`, `goodputOnly`, `pruned`, `levers`, `derate`, `efforts`, `prune.threshold`, `prune.dominated`) and a generic `prune.rule` text; the per-card override has a `catalog` block (revision, sha256, rate basis zh / en, the anchor 10,000 cards ↔ 30 h hard MTBF with the class totals, the reason every value stays `assumed`) and a `note` per rate copied from the catalog's `fitEvidence` / `evidence` / `status`. `BudgetDocument` records `required` (the window rule's P threshold) and each architecture's `layers` block, which the Methodology recipe reads for the instance texts.

### 25.5 Reproduction tests that pin the pipeline

- `packages/core/test/budget_v5.test.ts`: identities of the primitives (kpiForm closure, byLayer sums, MTTR composition), the pruning rule on the stored 23-player studies, one `results.json` block (native950 500k) to 1e-9 with fixed seeds, the whole `bom.json` and the whole hierarchy table.
- `packages/core/test/golden_v5.test.ts` + `test/golden/golden_v5.json` (computed in Python, `compute_golden_v5.py`; report `golden-v5-report.md`): groups G1–G6.
- `packages/core/test/records.test.ts`: records ≡ the v4.4 scenario builders; the per-card override ≡ the reference catalog; the default set ≡ the former script constant.
- `packages/reports/test/reproduce.test.mjs` (and `node packages/reports/test/reproduce.mjs`): the six `docs/*.html` regenerate byte-for-byte from `docs/backup/ascend-allocation/{results,mechanisms,bom}.json`, the stored `provenance.json` / `bom-provenance.json` (the footer of the hacd run; the engine commit stays in the JSON, the page shows the version only) and `docs/backup/arch-mechanism-shapley/*.json`; `geometry.test.mjs`: `topoGeomFromRecord` of the four built-ins equals `TOPO_GEOM`.
- CLI acceptance (2026-10-21): `hacd findings --record native950,ubl128,cm384,a3server --study-dir docs/backup/arch-mechanism-shapley` reproduces `results.json` and `bom.json` to 1e-9 (only `generated` differs) and the six HTML files differ from the committed ones only in the footer sentence.

## 26. v6 input migration: 口径 normaliser, evidence checks, gates (2026-10-22)

Plan: `docs/markdown/PLAN_V6_INPUT_MIGRATION.md`. Internal inputs (device failure rates, new topologies, new mechanisms) enter HAC-D through Markdown worksheets (`@hac-d/importers`, profile `hacd-worksheet-1`) that parse to the v5 records of §25.4; the primitives below live in `packages/core/src/ingest/` and the commands in `hacd ingest …` (USER_GUIDE "v6 ingest").

### 26.1 Device FIT → business-impact FIT per unit (`normalizeFaultRates`, `ingest/koujing.ts`)

Two quantities of different kind. A device table states **device FIT**: all failure modes of one part per device-hour, no protection considered. HAC-D's catalog classes state **business-impact FIT**: events that interrupt (hard), degrade (slow) or silently corrupt (sdc) the job, per fault-unit-hour, after the protection already in place (§25.4, the unit library). The bridge is the reviewed 口径 mapping table, one row per (device, class): the fault unit, devices per unit and the impact factor.

| Step | Formula | 口径 |
|---|---|---|
| device rate | λ_d = v (per_h) · v/10⁶ (per_1e6_h) · v/10⁹ (FIT) · 1/v (mtbf_h) · −ln(1 − v)/8760 (afr, annual failure fraction; v/8760 is the first-order value, ~0.7 % low at v = 1.4 %) | per device-hour, all failure modes |
| device FIT | FIT_d = λ_d × 10⁹ | per device-hour |
| class FIT | FIT_{c,u} = Σ_{d→c} FIT_d × n_{d,u} × f_{d,c} with n = devices per unit u, f ∈ [0, 1] = share of d's failures that become a business-impact event of class c | per unit-hour, class c alone; hard / slow / sdc never added |

Confidence policy (never the model's): `assumed` when any term's impact factor or source is an assumption; otherwise `derived` whenever arithmetic was applied; otherwise (one device, n = 1, f = 1, stated in FIT) the source type's own confidence — field → measured, vendor → vendor, prediction / paper → paper-reported. Every entry carries the derivation string with each term, the sources and the mapping id. Goldens G7a–G7e (`test/golden/golden_v6.json`, Python `compute_golden_v6.py`) pin the conversions and the sums to 1e-9.

Device-table import (`@hac-d/importers`, `worksheet/deviceTable.ts`, v5.5 — fifth review D2 and its recheck N1 / N2) and the agent's draft (`@hac-d/agent`, `draft.ts`, `deviceRateUnitFactor`): values stay as written with two exceptions, both recorded in the row's note with the value as written — an annual failure rate written as a percentage (`%/year`, `AFR (%)`, `年化 %`, or a `%` in the value cell) is divided by 100 into the fraction the AFR formula expects, and a `%` under any other unit refuses the row; an MTBF stated in a multiple of hours (`百万小时`, `million hours`, `10^6 h`, `万小时`, `kh`, with or without the MTBF word) is multiplied into hours. The header rules are tried most-specific first (FIT, MTBF with a multiplier, per 10⁶ h, per hour, AFR, then MTBF), so `失效率（每百万小时）` is a rate per 10⁶ h, `MTBF（百万小时）` an MTBF in millions of hours, `每小时失效率` per hour, while `小时` alone still means MTBF; a rate per 10⁶ h in a unit cell says "per", "每" or "/" and a bare multiple of hours is a duration. The numeric conversion of the resulting (value, unit) pair is golden G7's (2 × 10⁶ h MTBF → 500 FIT in G7c).

### 26.2 Evidence cards: grounding and agreement (`ingest/evidence.ts`)

An extraction model writes only cards `{ doc, loc, field, value_text, unit_text, quote, model_confidence }`. **Grounding**: the quote (NFKC, whitespace-collapsed, case-folded) must occur in the chunk, the value inside the quote, and the quote must be ≤ 400 characters. **Agreement**: two passes over the same chunk must give the same normalised value and unit for a field; otherwise the field goes to the review queue. `model_confidence` is advisory; HAC-D confidence comes from the source type (26.1). Numbers are parsed as written (`parseNumberText`: thousands separators, full-width digits, 万 / 千 / k) by the normaliser, never by the model.

### 26.3 Gates beyond the schemas (`ingest/validate.ts`)

Vocabulary (class ids of the unit library, fault units, templates, count rows, mechanism ids and the **parameter keys a mechanism reads** — defaults ∪ `provisional` ∪ `integrationNeeds` ∪ `reads`, so a misspelt key is an error instead of a silent no-op), provenance completeness (every stated geometry / scale-out / count / set field has a provenance entry; `derived` needs a derivation), plausibility (per-card values converted × cards per unit, then compared with the unit library's FIT within ×0.1 … ×10 as a warning), structural consistency (node NPUs = npusPerNode, cabinet = npusPerNode × nodesPerRack, SuperPoD instance = domainNpus ?? pod for `supernodes` or npusPerNode for `nodes`), and id policy (an internal record may not take a public id; an existing id is overwritten only with `--force`).

### 26.4 Delta (`ingest/diff.ts`)

Field changes of the three records with the provenance the new record states (longest matching key), rate changes per class on the per-unit basis, and the KPI rows of `hierarchicalBudget` before and after at the run's scales: A_op nominal and derated, delivered goodput, MTBF_hw and MTTR_hw (formula 1), P(window) and verdict, B (formula 2), k and the recommended mechanisms and levers (formula 6), effort. Δ rows are differences (percentage points) and ratios (MTBF, MTTR). Rendered by `@hac-d/reports` `deltaHtml` / `deltaMarkdown`.

### 26.5 One call and the operator protocol (v6.1, `packages/cli/src/run.ts`, `packages/agent/src/operator.ts`)

`hacd ingest run` executes `ingest worksheet` (optional), `ingest validate`, `ingest dry-run`, `ingest diff` (with `--before-record`), `ingest promote` (only with `--promote`, never `--force`) and `findings` as child processes of the same CLI (`process.execPath` + `process.execArgv` + `process.argv[1]`, so the repo's `node --import tsx` and the bundle's `node hacd.mjs` both work), parses their `--json` outputs and writes `run.json` (`version 1`: `status` ok | needs-input | failed, `exitCode` 0 | 2 | 3, `inputs` {record, rates, set}, `steps[]` {name, ok, exitCode, seconds, command, issues[], stderrTail}, `kpi[]` = the dry run's rows, `report`, `delta`, `promoted`, bilingual `nextAction`) and `SUMMARY.md`. The inputs come from the flags or from the single file of each kind under the staging folder; two records without `--record` is `needs-input`. The operator protocol (`OPERATOR_PROMPT` zh / en, `HACD_TOOLS`, `FIX_TABLE` by gate code) is one module; `hacd ingest protocol` prints it and the offline bundle writes `prompts/` and `tools/`. Rules it fixes: no number without source and confidence (blanks instead of guesses), internal ids only, three fix rounds then stop, `failed` is handed over unchanged, `promote` is a human decision. Tests: `packages/cli/test/run.test.ts` (ok path, needs-input path, protocol printouts).

The reference host (`runOperatorHost`, `packages/agent/src/host.ts`; CLI `hacd ingest operate`, `packages/cli/src/operate.ts`) is the loop a program needs to run the model under that protocol: messages = system prompt + task, tools = `HACD_TOOLS` plus `read_file` / `write_file` / `list_files` in the function-calling shape; a `tool_calls` answer is executed in order (`commandArgs` fills the manifest's command template — `{name}` placeholders, `[...]` optional groups, array values expanded — and refuses any value that starts with a dash; `checkArgs` applies the parameter schema; folder arguments must lie inside the work folder, inputs inside the work folder or the documents; writes only under `ws/`), the results go back as `tool` messages, and an answer without tool calls is the final message. Two findings of the first pilot are in the CLI: `hacd ingest run --json` writes its manifest with a synchronous loop (`writeAllSync`) because a `console.log` to a macOS pipe followed by `process.exit` cut it at about 8 kB, and the worksheets step keeps a ledger (`staging/worksheets/.outputs.ledger`) of the files it produced and removes them before converting again, so a renamed id leaves no stale record behind. The mock model (`scripts/mock-onprem-model.mjs`) and the pilot are in `AGENT_OPERATOR.md` §8–§10 and `PILOT_2026Q3_MOCK.md`.

## 27. v6.3 the Findings report of a scenario, the shared schematic, hardware by layer (2026-10-27)

### 27.1 `reportFromScenario` (`budget/report.ts`) — the web app's Report tab

The pipeline of `hacd findings` on a project instead of a record: `budgetDocument` over `build(n) = withSize(s, n)` (the template geometry follows N; count overrides scale with N), `studyOfBuild` (the Shapley study over the same builder: `archStudy` is its record form; the bare scenario strips every player of the set, so a project's applied mechanisms are players like the others) and `mechanismHierarchy` with `check: false`. Reference set = the project's applied mechanisms (the budget's "today"); candidates = `reportCandidates`: the set's candidates that are appliable, not applied in the project and ready with the set's parameters (the Allocation page's "Report settings" uses the same function). Layer instance rule `reportLayerSpec`: SuperPoD = one supernode of the UB domain's NPUs, or one node when the UB domain is a node or smaller (Atlas 800T A3); cabinet = nodes × NPUs per node; node = NPUs per node — the rule a topology record states in `layers`. Output: `{ results, mechanisms, studies, records }` — the sidecar objects the recipes read; the worker adds the provenance (`HAC-D web · Allocation › Report · project <id>`, the set, the options, `CORE_VERSION`) and renders with `findingsHtml` / `methodologyHtml` of `@hac-d/reports/browser` (the report kit without `node:` imports; the KaTeX CSS is registered through `setKatexCss(katexCssFrom(fonts, minCss))` from the fonts the bundler ships, what `katex-node.mjs` does from the file system under Node). Identity: on a record's own scenario (`recordScenario`) the budget document equals `budgetFromRecords` and the study equals `archStudy` (`packages/core/test/report_v63.test.ts`); the bundle the tab downloads (`results`, `mechanisms`, `provenance`, `studies`, `records`) re-renders with `hacd findings --data <bundle>.json` to the same page (`packages/cli/test/findings-data.test.ts`).

### 27.2 The topology schematic (`packages/reports/src/schematic.mjs`)

`topologySchematicSvg(geom, counts, lang, { embedStyle, id })` — `geom` = a scenario's `topology` block or a record with its superpod resolved (`template`, `superpod`, `scaleOut`), `counts` = `computeCounts` at the drawn size — returns `{ svg, width, height }`: the scale-out Clos tiers (per-tier switch counts, a few crossing links), one SuperPoD box with up to 16 compute cabinets (nodes drawn when ≤ 16 cabinets), the communication / UB interconnect cabinets with their sub-planes (two-level) or pod-tier switches, a caption per fabric kind, the other pods stacked behind, one node enlarged (NPU ring with HCCS or UB mesh links, CPUs, L1 chips or in-cabinet switches, the scale-out ports); A2 draws cabinets of servers. Counts in the labels are the engine's; a SuperPoD without communication cabinets says that the UB switching is inside the node. The web Picture tab renders it with `embedStyle: false` (its own `tp-*` stylesheet); the reports embed `TOPO_STYLE` on the figure palette (`--s1` NPU, `--s2` scale-out, `--s3` UB). Figure 1 of every Findings page is the record at the headline scale (so `record` is required: the CLI writes `records.json` next to the data and `reproduce.mjs` reads it); Figure 1a–d of the BOM are the main designs at N (`bom.json` designs carry `template` and `superpod`).

### 27.3 Hardware by layer

The six layers of `DEFAULT_LAYERS` (cluster, scale-out network, SuperPoD, cabinet, node, NPU), top-down, with the BOM level → layer map (`pod` and `fabric` → SuperPoD): the web Hardware tab (bill of materials and fault types, a subtotal row per layer: hard FIT per NPU = Σ count × unit FIT / N and the share of the job's hardware interruption rate, collapsible), Findings Table 3 (the layer row carries the layer's hard FIT per NPU of Figure 2 and its share of today's rate; count-only units show "—") and BOM Table 1 (SuperPoD, compute cabinet, node, NPU; the scale-out network is Table 2; the cluster level has no counted part).

### 27.4 Editing a project as the pages do (`project/edit.ts`, v6.4)

`setScenarioFields(s, { path: value })` over the closed list `SCENARIO_FIELDS` (kind, allowed values, bounds, note): `npus` → `resizeTopology`; `topology.template` → `switchTopologyTemplate` (hardware from the new template, job settings, FIT edits and mechanisms kept); `topology.variant` → `applySuperpodVariant`; `topology.fabric` → `withFabric` (the SuperPoD count overrides go); `topology.superpod.<field>` (also `topology.nodesPerRack` / `gpusPerNode` as the page); `topology.scaleOut` on / off (off removes the `@roce` classes, on restores the template default and its classes); `counts.<row>` (a user count at the current N, kept as a per-NPU ratio); `workload.*`, `targets.*`, `recovery.*` (MTTR mixture) through `editBase`, refused with the owner named when an applied mechanism owns the setting (`mechanismOwner`). The order of application puts the template first, then variant, fabric, scale-out, then the rest, then the size. `setFaultFit` sets the FIT of a fault type by the unit library's class id (hard → `failure` in FIT, slow / sdc → the rate per hour), null = the library value, through `editBase`. `editMechanisms` removes (`stripMechanisms`, only applied or switchable ones) then applies (`applyMechanisms`, library order). v5.5 (fifth review D1): a mechanism is applied with `mechanismDefaults(id)` — the default mechanism set's parameters merged over the library defaults, the values the Findings report evaluates its candidates with — then the caller's overrides; the keys are the mechanism's whole vocabulary (`mechanismParameterKeys`: parameters, provisional values, integration needs, read keys); a transform that would not act is refused with the reason — integration parameters still missing after the merge (the audit's provisional values are named), a required mechanism not applied, a transform that left the project unchanged — never reported as applied. `scenarioVocabulary` lists, per mechanism, the parameters it would be applied with, the settable keys, the missing integration keys (`needs`), the requirements and the set's effort. The scale-out toggles (`topology.scaleOut`) go through `editBase` (D9), so per-class mechanism effects (custom rungs, per-class detectors) act on the restored `@roce` classes. Every result is `parseScenario`d. `scenarioSummary` = the state a model reads back (geometry, scale-out, user counts with their geometry value, FIT overrides against the library, applied mechanisms with parameters, targets, workload with its owner, recovery, the KPI strip of formula 1 nominal / derated plus delivered goodput); `scenarioVocabulary` = the fields, the project's fault types and the appliable mechanisms. The report of such a project (`reportFromScenario`) keeps the applied mechanisms' recorded parameters in the reference set, so the budget's rebuild of the final design closes.

## 28. v4 topology templates: per-unit FIT, Clos counts, the strategies (2026-10-18; written up 2026-10-27, fourth review R3)

Plan: `docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md`. Code: `packages/core/src/topology/index.ts` (templates, unit fault library, BOM), `scenario/build.ts` (`computeCounts`, `closCounts`, count overrides), `strategy/index.ts` (strategies), `mechanisms/plan.ts` (`derateParameters`). Goldens: `test/golden/golden_v4.json` (`compute_golden_v4.py`: counts of the five templates at 10k / 100k / 200k / 500k, the count overrides).

### 28.1 Per-unit FIT (the unit fault library)

The audited catalog states a business-impact FIT per card-hour for 54 events (§25.4). Each event is attached to the hardware unit it belongs to by its domain (`DOMAIN_UNIT`: NPU, node, CPU, cabinet, UB switch chip, UB optical link, job) and converted under the CloudMatrix384 geometry, where the catalog and the paper's unit counts agree:

    FIT_unit = FIT_card × c_unit,   c_unit = 384 / (units of that kind in one 384-NPU pod)   (`calibrationCardsPerUnit`)

so c = 1 for the NPU and the job, 8 for a node (48 nodes), 32 for a compute cabinet (12 cabinets), 384 / 336 for a UB switch chip and 384 / 5,376 for a UB optical link. A CloudMatrix384 cluster without scale-out network therefore reproduces the catalog exactly at pod-aligned N (at N = 7,777 the rounding-up of partial nodes, cabinets and L2 chips adds 0.06 %, the intended per-unit behaviour); other templates change the job's rate through their hardware mix. The RoCE / UBoE switches and links of the scale-out network carry the UB switch chip's and UB link's per-unit FIT as analogues (`<event>@roce`, assumed). A job-level class is λ = FIT_unit × 10⁻⁹ per hour of the whole job; a unit class is n_unit × FIT_unit × 10⁻⁹ with n_unit from the template geometry at N (`computeCounts`). The BOM's hard FIT per NPU is Σ_units n_unit × FIT_unit / N (Hardware tab subtotal per layer; the `otherComponents` row carries the classes counted outside the template's units). The predictor's applicability follows the catalog's rule — persistent faults of card or server scope (v5.5: by the event's scope, so BOXIO-hard, unit node but scope rack, is not predictable; fourth review R2).

### 28.2 Folded Clos of the scale-out network (`closCounts`)

For P ports (NPUs × ports per NPU, divided over the planes), switch radix k, leaf oversubscription o (1 = non-blocking) and t_l transceivers per link:

- P ≤ k: one switch, P links.
- else a leaf carries d = ⌊k·o / (1 + o)⌋ downlinks (k/2 at o = 1); the tier count t ≥ 2 is the smallest with capacity d·k·(k/2)^(t−2) ≥ P (at most 8); H = ⌈P/o⌉ uplink ports leave the leaf tier; switches per tier = ⌈P/d⌉ leaves, ⌈H/(k/2)⌉ in each middle tier, ⌈H/k⌉ in the top tier; links = P + (t − 1)·H; transceivers = links × t_l.

The counts are per plane and summed over the planes; a user count (`topology.countOverrides`, v4.3) replaces a BOM row at the N it was given and is scaled with N/N_given elsewhere (`resolveCountOverrides`). `fabricFill` decides how a partly populated last SuperPoD counts its switches and cabinets: `proportional` (its NPU share) or `full-pod` (a whole pod).

### 28.3 Allocation strategies (`allocateStrategy`)

Three kinds of moves on top of the scenario's own mechanisms: library mechanisms (effort = library or set effort), recovery levers moved to a limit (automatic attempt, automatic success, manual time; one effort per lever), and hardware — the interruption FIT of class i multiplied by xᵢ ∈ [floorᵢ, 1] at effort eᵢ·log₂(1/xᵢ). For A_op the running fraction is exactly A_run = 1 / (1 + (Σᵢ xᵢcᵢ + F)/3600) with cᵢ = λᵢ t̄ᵢ today's pause contribution of the class through its chain and F the other event classes, and A_op = A_run·(1 − φ), which gives the hardware level in closed form (the engine confirms the closure to 1e-9). The split of a level L over the classes is the one-parameter rule

    xᵢ cᵢ = clamp(wᵢ L, floorᵢ cᵢ, cᵢ),   wᵢ = eᵢ ('min-effort': KKT of Σ eᵢ log₂(1/xᵢ), Albert's minimum effort for equal eᵢ) | nᵢ Eᵢ ('agree': units × importance, slack of under-budget classes reallocated) | cᵢ ('arinc': one uniform factor k),

L found by bisection on the engine. Strategies: `mttr-first` (recovery side first by gain per effort, hardware for the rest), `mttf-first` (hardware to the floors first), `optimal` (minimum total effort over the subsets of the moves: exact up to 10 moves for A_op, greedy beyond). Every plan must hold nominally and with the mechanism parameters derated (`derateParameters`, `DERATE_DEFAULT`: coverage, detection targets and shares −0.05, success / recall / precision −0.08, times and overheads ×1.5, rate reductions ×0.5, load savings ÷1.5, the manual-fallback probability ×1.5, the fabric-degrade exposure +0.05 and its remaining bandwidth −0.05; design choices such as the compute interval, the domain count and "before" reference values stay). Effort of a plan: E = Σ mechanism effort + Σ lever effort + Σᵢ eᵢ log₂(1/xᵢ) (formula (4) of the Methodology with eᵢ = 2 per class). Known limits (fourth review, open): the automatic-success lever is dead under the default derating (0.999 − 0.08 < today's 0.99, so its derated value is clamped to today's; R1), and a derated mechanism parameter may undercut the baseline it replaces (D-HARD coverage 0.949 < 0.95; R4) — both change the published designs if fixed, so they stay decisions for the report owner (MODEL_REVIEW_2026-10-27.md §5).

## 29. Fifth model review, resolved (2026-10-27, `docs/markdown/MODEL_REVIEW_2026-10-27.md` §7)

D1 project editor applies audited mechanisms with the set's parameters and refuses what would not act (§27.4); D2 device-table percent AFR and header order (§26.1); D3 `recordScenario` and `archStudy` write the set's recovery baseline (§25.4 — the default set's equals the template's, so the public reports are unchanged); D4 the MTTR split on the class's own gᵢ (§25.1 (5)); D5 recorded order of application (§22.4.1); D6 formula (2) with `reachable` (§25.1 (2)); D7 `minWindowTrials` (§25.3); D8 the project report's study runs with the project's parameters and lists fixed mechanisms (`projectParameters`, `fixed` of `ArchStudy`); D9 scale-out toggles through `editBase` (§27.4); M1 / M2 formula (3)'s D and the detected-rate split (§25.1 (3)); M3 the `globalS` comment; R2 the predictor's scope rule (§28.1); R3 this §28. Goldens: `golden_v5.json` regenerated with three new tables (`a3server-10k.{snapshot,predict,abft}`) and seven new cases; every pre-existing expected value is unchanged to 2.5e-16 (floating-point reassociation of the stage split only). The six committed report pages reproduce byte for byte from the stored sidecar (the Methodology's formula (2) note gained the B ≤ 0 sentence and was re-rendered). R1 and R4 remain open as decisions (§28.3). Recheck of the same day (`MODEL_REVIEW_2026-10-27_RECHECK.md` §7): N1 a percent in the value cell (§26.1), N2 an MTBF in a multiple of hours in both input paths (§26.1), N3 the resolution note, and the residual order dependence of D5 removed for the same-stage rule (§24.2) and the custom rungs (§22.4.1); the stored Shapley studies predate the expectation rule and differ from a fresh run by less than 1e-7 of A_op on the coalitions holding all three startup mechanisms.
