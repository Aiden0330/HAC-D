# HAC-D vs the ai-cluster-reliability reference at 100k–500k NPUs

Date 2026-10-10. Reference = `ai-cluster-reliability-main/catalogs/review-2026-10-09` (audited engine `engine.cjs`, baseline mechanisms). Both tools were run on the reference's confirmed baseline: 10,000-card hard-interruption MTBF 30 h with linear scaling (λ_card = 3.33e-6 /h), checkpoint 300 s compute + 4 s blocking save, detection 95 % in 10 s else 60 s timeout, automatic recovery 180 s with 99 % success else +7,200 s manual (R = 264.5 s), 30-day window; sub-health = 2 % of events (24 h, −5 % throughput, 95 % detected in 5 min); silent corruption = 1.4 % of events (no immediate detection, 120 h fallback, rollback to the last clean checkpoint).

Scripts: `node scripts/ref-run.cjs 400` (reference engine, 400 trajectories per point) and `node --import tsx scripts/ref-compare.ts 10` (HAC-D closed forms and Monte Carlo, 10 replications). The reference's published 4,000-trajectory results (`results.json`) agree with the 400-trajectory rerun to the third decimal.

## 1. Hard interruptions only (stage 0): like for like

| N | reference operational availability | reference useful throughput | HAC-D A_op | HAC-D first order | HAC-D exact renewal | HAC-D Daly full | HAC-D Monte Carlo (10 reps) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100,000 | 97.62 % | 94.99 % ± 0.02 | 97.61 % | 94.83 % | **94.98 %** | 94.95 % | 94.98 % ± 0.22 |
| 200,000 | 95.31 % | 91.43 % ± 0.03 | 95.33 % | 90.99 % | **91.45 %** | 91.35 % | 91.34 % ± 0.28 |
| 500,000 | 89.07 % | 81.84 % ± 0.04 | 89.09 % | 79.48 % | **81.88 %** | 81.31 % | 82.30 % ± 0.49 |

- The exact renewal model reproduces the reference discrete-event simulation to within 0.03 points at every scale, and operational availability to within 0.02 points. The two share the same assumptions (exponential failures while running, no failures during recovery, checkpoint retried until an interval completes).
- The first-order formula is low by 0.16, 0.44 and 2.4 points; at 500k cards (τ+δ)/M = 0.14 and R/M = 0.12, so HAC-D's headline switches to the exact form there (flag `caution`).
- Daly's full model is 0.03–0.6 points below both because it also allows failures during recovery, which the reference does not simulate.
- HAC-D's Monte Carlo agrees with the reference within its confidence interval at all three scales.

## 2. Hard interruptions + sub-health (stage 1)

| N | reference operational | reference useful | HAC-D exact × sub-health factor | HAC-D headline effective | HAC-D Monte Carlo |
|---:|---:|---:|---:|---:|---:|
| 100,000 | 97.57 % | 94.90 % | 94.86 % | 94.71 % (first order) | 94.11 % ± 0.29 |
| 200,000 | 95.20 % | 91.25 % | 91.24 % | 90.76 % (first order) | 90.21 % ± 0.45 |
| 500,000 | 88.87 % | 81.51 % | 81.41 % | 81.41 % (exact) | 79.27 % ± 0.35 (flagged) |

- With the straggler law (P(slowed) = 0.9 / 1.8 / 4.3 %, factor 0.9996 / 0.9991 / 0.9978) and the isolation interruptions (0.0065 / 0.013 / 0.033 per hour), HAC-D's exact form lands within 0.04–0.1 points of the reference. The remaining difference comes from the reference saving progress before a sub-health recovery (zero rollback) whereas HAC-D charges a normal interruption (τ/2 recompute) for the 2 % of events that are isolations.
- HAC-D's Monte Carlo is 1–2 points low here and flags the disagreement: the simulator maps sub-health to a 24-hour slow-down for every event (it does not yet implement the detect-and-isolate policy), so it over-charges the 95 % of events that the reference isolates after 5 minutes. This is the known simulator gap recorded in the plan.

## 3. All three classes (stage 2): silent corruption dominates

| N | reference operational | reference useful (baseline) | reference useful with 95 % SDC detection | reference useful with the six-mechanism combination | HAC-D |
|---:|---:|---:|---:|---:|---:|
| 100,000 | 97.56 % | 62.6 % ± 0.5 | 92.6 % | 94.7 % | no SDC model: 94.7–94.9 % |
| 200,000 | 95.23 % | 45.9 % ± 0.4 | 87.0 % | 91.4 % | 90.8–91.2 % |
| 500,000 | 88.85 % | 25.2 % ± 0.3 | 73.1 % | 82.8 % | 81.4 % |

- Operational availability is unchanged by silent corruption (the job keeps running on corrupt state), so the two tools still agree on it.
- Useful throughput collapses in the reference because every silent event (1.4 % of interruptions, found only after 120 h) rolls back up to five days of progress: the ledger shows 30 / 44 / 58 % of the window lost to rollback plus 3–4.5 % terminal discard. HAC-D has no scenario-level SDC model, so its figures correspond to the reference's "95 % immediate detection + step recovery" or "combined" rows rather than the baseline. This is the first item of the agreed next phase.

## 4. What the comparison shows

1. For hardware interruptions with checkpoint recovery, HAC-D's closed forms and simulator are numerically consistent with the reference engine at 100k–500k NPUs; the exact renewal form is the right headline above about 100k cards with hour-level MTBF.
2. The MTTR mixture convention adopted on 2026-10-10 (timeout fallback, failed attempt charged) is the one the reference uses; with it both tools compute R = 264.5 s.
3. Sub-health closed forms agree to 0.1 points; the simulator needs the isolate policy.
4. Silent corruption is the single largest term at these scales in the reference's baseline and is absent from HAC-D; until the SDC delivery model exists, HAC-D's training availability at 100k–500k should be read as "hard interruptions and sub-health only".

## 5. v3 (2026-10-10): three classes and mechanisms in closed form, plus the ledger simulation

HAC-D now carries the reference's three-class baseline as the built-in example `ref-three-classes-100k` (four sources with the catalog's silent-corruption split and mechanism applicability fractions; `docs/MODEL_REFERENCE.md` §19–§22). The audited engine's published means (`results.json`, 4000 trials, 95 % CI half-widths in parentheses) against HAC-D's closed forms, delivered goodput in %:

| Cards | Reference base | HAC-D closed form | Reference A_op | HAC-D A_op |
|---:|---:|---:|---:|---:|
| 10,000 | 93.33 (0.26) | 93.33 | 99.749 | 99.748 |
| 100,000 | 62.56 (0.46) | 62.61 | 97.556 | 97.548 |
| 200,000 | 45.87 (0.40) | 45.66 | 95.235 | 95.222 |
| 500,000 | 25.24 (0.26) | 25.32 | 88.880 | 88.877 |

Single mechanisms on the baseline (delivered goodput, %), reference Monte Carlo vs HAC-D closed form; the reference's paired-delta CI half-width is given for the mechanisms whose random streams stay aligned:

| Cards | Mechanism | Reference | HAC-D | Reference Δ ± CI | HAC-D Δ |
|---:|---|---:|---:|---:|---:|
| 100,000 | D-SDC (95 % immediate detection) | 92.62 | 92.33 | +30.06 ± 0.47 | +29.72 |
| 100,000 | D-SDC + R-SDC (step recovery) | 92.66 | 92.38 | +30.11 | +29.76 |
| 100,000 | R-REPLAY | 63.12 | 63.23 | +0.56 ± 0.09 | +0.62 |
| 100,000 | R-PROCESS | 62.99 | 63.10 | +0.43 ± 0.07 | +0.49 |
| 100,000 | R-ELASTIC | 64.06 | 63.69 | +1.50 ± 0.58 | +1.08 |
| 100,000 | C-FAST (60 s / 1 s) | 62.82 | 62.90 | +0.26 ± 0.07 | +0.28 |
| 100,000 | six combined | 94.72 | 94.98 | +32.16 ± 0.49 | +32.37 |
| 500,000 | D-SDC | 73.13 | 73.27 | +47.89 ± 0.38 | +47.94 |
| 500,000 | R-ELASTIC | 26.33 | 26.22 | +1.09 ± 0.35 | +0.90 |
| 500,000 | six combined | 82.79 | 83.45 | +57.55 ± 0.42 | +58.13 |

Exact Shapley values at 100,000 cards (points of delivered goodput): HAC-D D-SDC 30.68, R-SDC 0.02, R-REPLAY 0.33, R-PROCESS 0.34, R-ELASTIC 0.83, C-FAST 0.17 (Δ 32.37, 64 coalitions in 0.1 s); reference 31.06 / 0.02 / 0.36 / 0.32 / 0.25 / 0.18 (Δ 32.17, 64 × 2000 trials). The elastic values differ by more than the others because the reference's elastic path skips the `recovery()` draw and desynchronises its fault stream, so its paired deltas carry ±0.3–0.6 points of sampling error; HAC-D's closed form sits inside those intervals.

HAC-D's own ledger simulation (`simulateScenarioLedger`, 200 trials) on the same baseline: 94.0 ± 1.1, 63.9 ± 2.0, 46.2 ± 1.8, 24.8 ± 1.2 % — consistent with both the reference and the closed forms, with the same ledger shape (downtime, saves, hard rollback, slow-down, SDC rollback, terminal discard). Reproduce with `node --import tsx scripts/ref-compare-v3.ts 200`.

What remains different: the reference's 54-event granularity (HAC-D aggregates to the four sources), its finite-horizon Monte Carlo with confidence intervals for every coalition (HAC-D attributes with closed forms and offers the ledger simulation per scenario), and its target scans (HAC-D: Allocation page and tornado).

## 6. Mechanism contributions to A_op and the per-event catalog (2026-10-12)

See also `docs/TOOL_COMPARISON.md` (2026-10-12): the three-way comparison with the reference engine's versions V1–V4 and with ReMAP, including the exact reproduction of the V1 closed form (`scripts/ref-compare-v1.ts`).

Single-mechanism contributions to operational availability agree with the reference within 0.01 points at 10k–500k cards (replay +3.54 / +3.54, process +4.49 / +4.49, elasticity +6.67 / +6.67, interruption detection +0.42 / +0.42 at 500k; full tables in `docs/MECHANISM_CONTRIBUTIONS.md`). Combinations need per-event applicability: the four-source example's fractions are independent within a source and over-credit the six-mechanism set (A_op 99.30 vs the reference 99.10 at 100k, 96.60 vs 95.67 at 500k); the new `ref-catalog-100k` example (54 classes with the catalog's own flags) reproduces the reference combined scenario (99.100 / 95.656 A_op; delivered 94.79 / 82.63 vs 94.72 ± 0.19 / 82.79 ± 0.34).

## 7. Re-check at v5.8 (2026-10-29): after the effective-goodput basis, the sixth review and the external review

Run at e4aadf1 with the scripts and settings of §1–§5 (`scripts/ref-compare-v1.ts`; `scripts/ref-compare.ts 20`; `scripts/ref-compare-v3.ts 200`) after the window-ledger changes of v5.6 (the discovery-rollback line `rollbackSdcDiscovery`), v5.7 (the exact-renewal acceptance, the straggler law over classes, the spare-pool blocking) and v5.8 (the window rule under the class constraints).

- **Version-1 closed form**: HAC-D's exact renewal reproduces the reference's V1 useful throughput and availability at 10k–500k cards to 1.1e-16 (unchanged, `docs/TOOL_COMPARISON.md` §3.3).
- **Stage 0 (hard only)**: every value of §1 unchanged — A_op 97.61 / 95.33 / 89.09 %, exact renewal 94.98 / 91.45 / 81.88 % against the reference useful throughput 94.99 / 91.43 / 81.84 % (within 0.05 pt); unit-level Monte Carlo at 20 reps 94.88 ± 0.19, 91.36 ± 0.29, 81.94 ± 0.38 %.
- **Stage 1 (+ sub-health)**: the headline effective goodput is now 94.74 / 90.82 / 81.53 % (§2 had 94.71 / 90.76 / 81.41 %) because the v5.7 straggler law over classes gives a smaller slowdown factor (0.99956 at 100k instead of 0.99878). The exact renewal × slowdown factor gives 94.89 / 91.29 / 81.53 % against the reference useful 94.90 / 91.25 / 81.51 % (within 0.05 pt); the headline at 100k and 200k is the first-order form, as in §2. Monte Carlo at 20 reps 94.07 ± 0.25, 90.31 ± 0.30, 79.31 ± 0.31 % (the 500k flag of §2 as before).
- **Stage 2 (three classes), closed forms**: delivered goodput 93.33 / 62.61 / 45.65 / 25.32 % against the reference 93.33 (0.26) / 62.56 (0.46) / 45.87 (0.40) / 25.24 (0.26) — inside every CI, unchanged to the printed digit of §5; A_op 99.748 / 97.548 / 95.222 / 88.877 unchanged; the effective goodput of the baseline 98.27 / 94.72 / 90.80 / 81.50 % (v5.6 definition: the discovery rollback and the terminal discard excluded from the loss).
- **Single mechanisms**: unchanged — D-SDC 92.33 / 73.27, R-REPLAY 63.23, R-PROCESS 63.10, R-ELASTIC 63.69 / 26.22, C-FAST 62.90, six combined 94.98 / 83.45 % (§5 table).
- **Exact Shapley at 100,000 cards** (points of delivered goodput): D-SDC 30.71, R-SDC 0.02, R-REPLAY 0.31, R-PROCESS 0.32, R-ELASTIC 0.79, C-FAST 0.17 (Δ 32.32, residual −1e-16); §5 had 30.68 / 0.02 / 0.33 / 0.34 / 0.83 / 0.17 (Δ 32.37) — the straggler law moves the recovery mechanisms' shares by ≤ 0.04 pt; reference 31.06 / 0.02 / 0.36 / 0.32 / 0.25 / 0.18 (Δ 32.17).
- **Ledger simulation** (`simulateScenarioLedger`, 200 trials): 93.57 ± 1.14, 62.57 ± 2.14, 46.87 ± 1.87, 25.67 ± 1.19 % — consistent with the reference means and with the closed forms (§5: 94.0 ± 1.1, 63.9 ± 2.0, 46.2 ± 1.8, 24.8 ± 1.2). The ledger shape is unchanged; the v5.6 line `rollbackSdcDiscovery` equals `rollbackSdc` on this baseline because it has no immediate silent-corruption detection (every silent rollback is a discovery rollback), and the v5.7 blocking line stays 0 (no spare pool in the baseline).

Verdict: every band of the comparison holds after v5.6–v5.8 — hard-only exact renewal within 0.05 pt, A_op as in §1, three-class delivered goodput inside the reference CI, single-mechanism gains within the paired CI except elasticity (as before). Nothing to change.
