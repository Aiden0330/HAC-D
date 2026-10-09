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
| leaf, n identical units in series | A₁ⁿ, A₁ = 1/(1 + λ·MTTR) | A·nλ | 1/(nλ) |
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

Event-driven simulation of one synchronous job: units with exponential or mean-matched Weibull lifetimes (age-tracked; lemon fraction with rate multiplier; infant-mortality multiplier), repairs with their distribution, redundant groups (k required of size), β-factor common-cause events with a blast radius (node / rack / zone / cluster), hot-spare pool with replenishment or cluster requeue, fail-slow degradations as capacity factors, periodic checkpoints (interval τ, exposed save δ) with recompute of the lost segment, recovery drawn from the pipeline. Outputs: goodput, MTBI, interruptions/day, blocked fraction, peak spares (P99), degraded loss, with mean, sd, 95 % CI and quantiles; compared with the closed form (disagreement flagged beyond 2 % absolute or 2 CI).

## 9. Validation

`packages/core/test/golden/golden.json` holds 143 cases computed independently in Python (mpmath/scipy) from the formulas above and the survey's worked examples (Tables 6-5 to 6-8, Daly 2006, Saxena 2024, TrainMover, Ironwood k-of-n, ByteRobust P99, textbook CTMC results, Benoit replication, Weibull/lognormal fits). 120 match the survey's printed numbers exactly, 4 at rounding level; the 4 discrepancies (Epoch replica model inputs, Meta Table 6-3 selection criterion, a goodput ratio) are documented in `golden-report.md` and are not engine issues.
