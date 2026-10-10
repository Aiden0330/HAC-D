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
