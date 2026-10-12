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

Code: `mc/ledger.ts`, `mc/ledgerFromScenario.ts`. A job-level discrete-event simulation of one window with the three fault classes, the mechanism chain with per-class applicability (Bernoulli), sub-health detection and isolation (snapshot, then pause), silent corruption (immediate detection, step recovery, fallback discovery, clean-checkpoint retention, terminal discard) and checkpoint batching (`advance`: compute vs save within each period, commits update the checkpoint, dirty flag propagated). Faults arrive on the running clock. Two random streams (arrivals / detection vs mechanism outcomes) so that coalitions share the fault history. Every replication asserts `delivered + downtime + save + rollback + slowdown + local loss + terminal = T` and books each loss to a class. Output: delivered and A_op with CI and quantiles, mean ledger, event counts, per-class attribution, P(delivered ≥ target), P(dirty at end). Compared with the closed forms on the Simulate page (delta badge) and with the reference engine in `scripts/ref-compare-v3.ts`.

## 22. Mechanism library and Shapley attribution (v3)

Code: `mechanisms/index.ts`. The reference catalog's twelve mechanisms as scenario transforms with the reference target parameters: D-HARD (mixture detection 99.9 % / 1 s), D-SLOW (sub-health detection 99 % / 30 s), D-SDC (immediate silent detection 95 % / 1 s), R-SDC (step recovery 1 s / 1 s, requires D-SDC), R-REPLAY (90 % / 5 s / 10 s), R-PROCESS (95 % / 60 s / 120 s), R-ELASTIC (50 domains, 98 %, 180 s, 120 s, 1 s), C-FAST (τ 60 s, δ 1 s), H-RELIABILITY (optional rate reduction factor); R-CKPT, R-MANUAL and H-PROTECT are informational (baseline / no double credit). `mechanismReport(s, players, {metric})` strips the players from the scenario (baseline), evaluates all 2^n coalitions with the closed forms (value = delivered goodput, effective goodput or A_op), and returns single gains, last-added gains and exact Shapley values (Σ φ_i = v(all) − v(∅) by construction; interaction = Δ − Σ single). On the three-class baseline at 100k cards HAC-D's Shapley shares are D-SDC 30.68, R-SDC 0.02, R-REPLAY 0.33, R-PROCESS 0.34, R-ELASTIC 0.83, C-FAST 0.17 points (Δ 32.37) vs the reference's Monte Carlo 31.06 / 0.02 / 0.36 / 0.32 / 0.25 / 0.18 (Δ 32.17); the elastic difference is inside the reference's ±0.3–0.6 point sampling error (its mechanism stream desynchronises the fault stream).

### 22.1 Allocation on the delivered basis (v3.1)

`allocateScenario(s, {goodputTarget: G_d, basis: 'delivered'})`: with `f = delivered/effective` and `φ = effective/headline` of the scenario, the interruption budget is computed for the headline target `G_d/(f·φ)`. Feasibility by hardware alone is the delivered goodput with every failure rate × 10⁻⁶ under the current silent-corruption policy; when it is below `G_d`, the smallest immediate detection coverage `q*` (bisection on the closed form, hardware unchanged) and the longest fallback delay `D*` (current coverage) that reach `G_d` are reported and the budgets are computed with the coverage raised to `q*`. The rate and stage tables are produced in the slack case too (allowed values above the current ones).

### 22.2 Mechanism planner (v3.1)

`planToTarget(s, {target, players, effort, derate, scan, verify})`: baseline = scenario with the players stripped; for every coalition S the closed-form value v(S) and the derated value v_d(S) (library parameters worsened: coverage − 0.05, success − 0.08, times × 1.5, H-RELIABILITY reduction × 0.5; design choices such as the checkpoint compute interval and the domain count unchanged); feasible ⇔ v ≥ G* and v_d ≥ G*; plan = argmin effort over feasible S (ties: larger margin); necessary = ∩ feasible S; Pareto front over (effort, v). Scan: immediate detection coverage × automatic recovery seconds applied on top of the plan (recovery axis only for the MTTR mixture). Verification: ledger simulation of the plan, P(window ≥ G*) ≥ confidence. Practice: `docs/ALLOCATION_PRACTICE.md`.
