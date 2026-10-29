# Golden vectors v5 — independent verification report (task T9)

Verifier session of 2026-10-21 (Fable 5.1). Scope: `docs/markdown/PLAN_V5_REPORT_PIPELINE.md` §3 "Goldens" and §7 T9 — the
groups G1–G6 of the v5 budget numerics, re-derived in Python from the written specification and checked against the
TypeScript engine by `packages/core/test/golden_v5.test.ts`.

## Files

| File | Role |
|---|---|
| `test/golden/dump_inputs_v5.mjs` | writes the input tables (`node --import tsx packages/core/test/golden/dump_inputs_v5.mjs` from the repo root); the engine is used only to build the scenarios and read back the per-class table |
| `test/golden/inputs_v5/*.table.json` | 15 tables, 18–19 KB each: today's design nominal and derated for native950 500k, cm384 200k, a3server 10k; the recommended design nominal (at its k), derated at k = 1 and derated at results.json's k for native950 500k and cm384 200k; v5.5: a3server 10k with one mechanism each — R-RUNTIME-SNAPSHOT (`.snapshot`: per-class recovery stages), P-PREDICT (`.predict`: false alarms in F) and D-ABFT (`.abft`: a per-class silent-corruption detector) |
| `test/golden/compute_golden_v5.py` | pure Python 3.9 (standard library), `python3 compute_golden_v5.py` → `golden_v5.json`; the derivations are documented in its docstring |
| `test/golden/golden_v5.json` | 36 cases in seven groups (`generated_by`, `findings`, `cases[]` with id / group / inputs / expected / tolerance) |
| `test/golden_v5.test.ts` | vitest harness, one `it` per group (G1–G4, G5a, G5b, G6), `expect.soft` so one run lists every mismatch |

Independence: the modules under test (`budget/kpiForm.ts`, `mttr/decompose.ts`, `layers/index.ts`, `strategy/requirement.ts`,
`strategy/window.ts`, `study/prune.ts`, `budget/index.ts`, `scripts/scaling-common.ts`, `ascend-allocation-data.ts`,
`ascend-mechanism-hierarchy.ts`) were not read. To confirm the call signatures the task listed, I grepped their one-line
`export function` / `export const` headers only (no bodies). Spec sources read: Methodology formulas (1)–(5) and §3 / §4 texts
in `packages/reports/src/content.mjs`, `MODEL_REFERENCE.md` §18, §19, §19.1, §19.2, §24.1, §24.2, the v3 / v4 Python
generators and harnesses, `scenario/schema.ts`, the data files under `docs/backup/ascend-allocation/` and
`docs/backup/arch-mechanism-shapley/`.

## Inputs versus engine outputs

Inputs in each table: class id, fault unit (unit library), unit count (`componentInstances(c, computeCounts(s)).total`, v4
goldens cover the geometry), hard rate λ_i, mechanism applicability (incl. `custom`), the chain parameters, `order`, the recovery
block, the sdc block, the per-unit sub-health and silent-corruption rates, the isolation / detected-silent / false-alarm rates
(the sub-health occupancy and SDC models are covered by the v2 / v3 goldens). `detectS` and `globalS` of the engine are
recomputed from the recovery block (`t_d = p_d·t_auto + (1 − p_d)·t_timeout`, `G = T_auto + (1 − p_s)·T_manual`) and agree in
all 12 tables. No table carries a scale law or a per-class `recoveryStages` override, so the class global recovery equals the
scenario's.

Engine outputs in the tables (`meanPauseS`, `aOp`, `aRun`, `delivered`) are used only as declared identities:

- `aRun` is never used: the Python's `A_run = 1/(1 + (ΣC + F)/3600)` is the expectation and the engine's running fraction is
  checked against it (≤ 1e-9) — the closure held in all 12 tables.
- `aOp` enters φ = 1 − A_op / A_run (G1, and through φ G4, G5a and G5b). This is the declared identity on the engine's A_op.
- `meanPauseS` is never used in an expected value: every class mean pause t̄_i is the Python chain mean of G3; the engine's
  value is compared with it (max relative deviation over the 240 class rows: < 1e-9, no finding).

Plan inputs (recommended mechanisms, levers, k, binding) were copied by the Python from `results.json` into the case inputs
(`design`, `resultsK`), so the harness never reads `results.json`. The Shapley studies are read by both sides from
`docs/backup/arch-mechanism-shapley/<arch>.json` (inputs of the rule).

## Groups

| Group | Derivation (spec) | Identity parts | Tolerance | Result |
|---|---|---|---|---|
| G1 `kpiForm` (10 cases) | formula (1): λ_hw = Σλ_i, ΣC = Σλ_i t̄_i, MTTR_hw, MTBF_hw; other classes isolation λ×G, detected silent λ×(t_d + t_rec + t_step), false alarms λ×t_mig; F; A_run; t_d and G from §18 | A_run closure vs engine running fraction (1e-9); φ on the engine A_op | rel 1e-9, abs 1e-12 | pass |
| G2 `byLayer` (6 cases; v5.5 adds a3server 10k with P-PREDICT and with D-ABFT) | formula (3) with the Methodology §3 unit → layer map; isolation pause split ∝ Σ slow_u·n_u, detected-silent pause ∝ Σ sdc_u·n_u·q_u (§24.3 class coverage; v5.5) per layer; U_ℓ = 100·C_ℓ/(3600·D), D = 1 + (ΣC + F)/3600 with the false alarms in F; Σ_ℓ λ_ℓ = λ_hw, Σ_ℓ C_ℓ = ΣC | none beyond G1's φ-free quantities | rel 1e-9, abs 1e-12 | pass (incl. `slowRate`, `sdcRate`, `sdcDetectedRate`, `hard` = Σ U_ℓ, `DEFAULT_LAYERS` mapping) |
| G3 `chainSplit` / `mttrDecomposition` (6 cases: today's native950 500k; recommended native950 500k nominal with two custom rungs; recommended cm384 200k nominal with explicit stages; recommended native950 derated k = 1; v5.5: a3server 10k with R-RUNTIME-SNAPSHOT — per-class stages, §24.2 — and with P-PREDICT — the predict rung) | §19 / §19.1 / §19.2 / §24.1 rung tree enumerated recursively; per terminal the probability and the pause by contributor: `detect`, own time per rung (`custom:<id>`, elastic → t_sync), `failed:<rung>` (`failed:custom:<id>`), `globalAuto` = p_global·T_auto, `globalManual` = p_global·(G − T_auto); job level rate-weighted; stages §24.2 (thirds, or the given stages rescaled to T_auto), `manual` = globalManual. The derated design is built in the order of finding 2 (`applyMechanisms → deratedOf → applyLevers(…, DERATE_DEFAULT)`), which is the construction the engine's plan uses | Σ contributions = engine `meanPauseS` per class (1e-9 rel); `chainSplit` direct signature = `classChainSplits`; `mttrS` = `kpiForm.mttrS` | rel 1e-9, abs 1e-12 | pass (all 80 class splits, 4 job decompositions, stages, recovery echo) |
| G4 `requirementFromKpi` / `requirement` (3 cases: derated native950 500k, cm384 200k, a3server 10k, A* = 0.985) | formula (2): B = 3600·((1 − φ)/A* − 1) − F, total budget 3600·(1/A* − 1), MTTR_hw/B, B·MTBF_hw, ratio today, the two factors | φ from G1 | rel 1e-9, abs 1e-12 | pass (both entry points) |
| G5a first-order closed-form k* (2 cases: native950 500k, cm384 200k; both `binding = 'mean'` in results.json) | formula (4): k* = (3600·((1 − φ)/A* − 1) − F)/ΣC₁ on the derated recommended design at k = 1, φ and F frozen at k = 1 — the check that the first-order form agrees with the engine's "mean binds" k (the bisection root of A_op,der(k) = A* with φ at k) to ~1e-5 | φ, F, ΣC₁ of the derated design vs `kpiForm` (rel 1e-9) | k* vs results.json `recommended.k`: rel 2e-5; engine A_op of the design at k* vs A*: abs 3e-7 (decision of 2026-10-21; see finding 1) | pass (6.6e-6 and 7.7e-6 relative on k; 9.1e-8 and 1.1e-7 on A_op) |
| G5b exact identity at the engine's k (2 cases: the same designs at results.json's k) | formula (1) on the derated design at k: (1 − φ(k))/(1 + (ΣC(k) + F)/3600) = A*; ΣC(k) = k·ΣC₁ (only the hardware pause scales); F(k) = F(1); φ(k) − φ(1) recorded | φ(k) on that table's engine A_op (declared); the engine A_op at k vs A* | A_op abs 1e-9; ΣC(k), F, φ rel 1e-9 | pass (A* reproduced to 1e-16 on both; ΣC(k)/ΣC₁ = k to 1e-15) |
| G6 `pruneByShapley` (2 cases: stored 23-player study at 500k + I-CONTAIN; synthetic table) | Methodology §4 rule: reference → `reference`; absent from every study → `capability`; dominated → `pruned`; min A_op Shapley ≥ 0.0015 → `candidate`; min delivered ≥ 0.0015 → `goodput`; else `pruned`; min / max per metric; `missing` | none | exact (rel 1e-12) | pass; verdicts also equal the published `mechanisms.json` |
| G1e `kpiForm` loss form (15 cases, v5.6) | formula (1′), MODEL_REFERENCE §30: W = τ/2 + lag (the dumped source), r_i = t̄_i + P_rb,i·W, Q_hw = Σλ_i P_rb,i W, Σλr, R_eff = Σλr/λ_hw, Q_other (0 with step recovery), δ/τ, ℓ_local = Σλ_i ℓ_i/3600, Φ = (1 − P_blocked)·φ_perf·(1 − ℓ_local)·(1 − o); G_eff = (1 − p_sdc)·Φ·(1 − δ/τ − (Σλr + F + Q_other)/3600) | P_rb,i, ℓ_i, P_blocked, φ_perf, o, p_sdc are engine outputs taken as inputs; G_eff closure vs the engine's effectiveGoodput (1e-9) while first order; R_eff = MTTR_hw + P̄_rb W | rel 1e-9, abs 1e-12 | pass (15 of 15 tables first order; closure ≤ 1e-9) |
| G2e `lossBreakdown` / `unavailabilityByLayer(effective)` (6 cases, v5.6) | formula (3′): Q_ℓ = Σ_{i∈ℓ} λ_i P_rb,i W; U_ℓ = (downtime − p_sdc)·C_ℓ/(ΣC + F) + rollback·Q_ℓ/(ΣQ + Q_other) with the engine's ledger lines; lines save / otherClasses / factors; Σ U_ℓ + lines = 1 − G_eff | the ledger lines (declared); under the first-order model the two lines equal (1 − p_sdc)(ΣC + F)/3600 and (1 − p_sdc)(ΣQ + Q_other)/3600 (checked) | rel 1e-9, abs 1e-12 | pass (closure 0 on every table) |
| G4e `requirementFromKpi(…, 'effective')` / `requirement` (5 cases, v5.6: derated today's designs and the derated all-moves designs, G* = 0.985) | formula (2′): Φ′ = G_eff/(1 − S), B = 3600·(1 − δ/τ − G*/Φ′) − F − Q_other, total 3600·(1 − G*), terms { 3600 δ/τ, F + Q_other, total − save − other − B }, the ends null when B ≤ 0 | G_eff from G1e | rel 1e-9, abs 1e-12 | pass (B ≤ 0 on every table: −36 to −55 s/h) |
| G5e all-moves identity (2 cases, v5.6: native950 500k, cm384 200k, `feasible = false` in results.json) | the derated all-moves design at k = 1: formula (2′) says B ≤ 0, the ceiling with perfect hardware lies between the design and the goal | — | rel 1e-9 | pass; G5a / G5b skipped (the mean does not bind anywhere) |
| G6e `pruneByShapley(…, { metric: 'effective' })` (2 cases, v5.6: the regenerated studies at 500k; a synthetic table with effective values) | the §4 rule on the effective-goodput Shapley (min ≥ 0.0015 → `candidate`), delivered for `goodput`, min / max of the three metrics | none | exact (rel 1e-12) | pass; verdicts equal the regenerated `mechanisms.json` (C-ASYNC candidate, R-FABRIC-DEGRADE pruned) |

`npm test -w @hac-d/core`: 36 files, 799 tests — 799 passed, 0 failed. `tsc -p packages/core/tsconfig.json` reports no
error for the new harness. The Python's own `findings` list in `golden_v5.json` is empty.

## Findings

### 1. The first-order closed-form factor and the engine's bisection k differ by ~7e-6 relative (G5a) — φ moves with k

| design | k* closed form (φ, F at k = 1) | results.json `recommended.k` | relative | engine A_op of the derated design at k* | A_op − A* |
|---|---|---|---|---|---|
| native950 500k (D-HARD, R-LINK-LOCAL, H-CONTROL-CONTINUITY; auto, success, manual) | 0.88731874408729 | 0.88731426265397 | 5.05e-6 | 0.984999929484659 | −7.05e-8 |
| cm384 200k (C-LOSSLESS, D-HARD; auto, manual) | 1.43436385123203 | 1.43437495487140 | 7.74e-6 | 0.985000110851429 | +1.11e-7 |

The derivation is formula (4)'s ARINC form with the premise "k scales every hard class's rate and nothing else":
A_op(k) = (1 − φ)/(1 + (k·ΣC₁ + F)/3600) with φ and F at their k = 1 values. ΣC₁ and F do scale as assumed (G5b: ΣC(k) = k·ΣC₁
to 1e-15 and F(k) = F(1); the isolation and detected-silent rates do not move). What moves is φ: the silent-corruption time share
depends on the hard rate through the silent-corruption window (§20: `pClearedBeforePersist(λ_rb)` and the episode rate per
wall hour on the running clock). From the G5b tables (φ as the declared identity on the engine A_op at k): native950
φ(1) = 4.10087e-5 → φ(k_results) = 4.10803e-5 (`phiShiftFromK1` = +7.16e-8); cm384 φ(1) = 2.34749e-5 → 2.33624e-5 (−1.13e-7).
The predicted shift δA_op = −δφ/D (D = 1 + (k·ΣC₁ + F)/3600 ≈ 1.0152) is −7.05e-8 and +1.11e-7, which reproduces the
observed misses to three digits — the whole discrepancy is φ(k). The same effect shows in G4's a3server 10k case:
`mttrFactor` = B·MTBF_hw/MTTR_hw = 15.935186 against `results.json`'s `kMean` = 15.935232 (2.9e-6).

Decision (coordinator, 2026-10-21): the "mean binds" k is defined as the engine's bisection root of A_op,der(k) = A* with φ
evaluated at k; formula (4)'s k* = B/ΣC₁ with φ at k = 1 is the first-order closed form and serves as the check that the two
agree to about 1e-5 relative. G5a therefore keeps k* as derived with tolerance rel 2e-5 on k versus `recommended.k` and
abs 3e-7 on A_op(k*) − A* (both pass at 5.1e-6 / 7.7e-6 and 7.1e-8 / 1.1e-7); G5b adds the exact identity at the engine's k
on the dumped tables at results.json's k: (1 − φ(k))/(1 + (ΣC(k) + F)/3600) = A* to 1e-9 (holds to 1e-16 on both designs),
ΣC(k) = k·ΣC₁ to 1e-9 relative, and the engine A_op at k equals A* to 1e-9. No expected value was fitted to the engine; the
Python computes every number from the tables and `results.json`'s k.

### 2. Construction of the derated recommended design: `deratedOf` must precede `applyLevers`

The task's recipe "derated via `deratedOf` and `applyLevers(…, DERATE_DEFAULT)`" has two orders. Only
`applyMechanisms → deratedOf → applyLevers(levers, DERATE_DEFAULT)` reproduces the engine's plan (A_op = 0.985 at
`results.json`'s k; automatic 90 s = 60 × 1.5, manual 2700 s = 1800 × 1.5). In the other order `deratedOf` restores the
pre-lever recovery block of a mechanism that records it (C-LOSSLESS: automatic 171.45 s, manual 7200 s): A_op 0.98135 instead
of 0.98936 for cm384 200k at k = 1, and k* = 0.7909 instead of 1.4344. (Before the R1 fix of 2026-10-28 the native950 500k plan
held D-RECOVERY-CLASSIFY, which records the recovery block too — A_op 0.97188 instead of 0.98279 there; its plan now uses the
success lever instead and both orders coincide.) The dump script prints this comparison; the harness and the case inputs record the
construction used. Not a numerical error, but anyone building derated designs from the public helpers needs the order.

### 3. `pruneByShapley` requires library ids (G6 synthetic case)

The engine looks every id up in `MECHANISM_LIBRARY` (`mechanismById` throws `unknown mechanism` for a synthetic id); its
`capability` branch is keyed to the library's `appliable` flag rather than to "absent from every study". On the stored
study both rules give the same 24 verdicts (I-CONTAIN is the only non-appliable id and the only id absent from the studies).
The synthetic case therefore uses real library ids with hand-set values (D-SDC as reference, D-HARD at exactly 0.0015 →
candidate, D-ABFT with delivered exactly 0.0015 → goodput, D-NET-SDC with a negative A_op Shapley → goodput, D-SLOW → pruned,
R-WARM-PROCESS dominated by D-HARD → pruned, C-LOSSLESS → candidate, I-CONTAIN absent → capability); every branch and the
threshold edge (≥) pass.

### Everything else matched

- A_run closure (formula (1) vs the engine running fraction) ≤ 1e-9 in all 12 tables; `detectS` / `globalS` equal the §18 forms.
- The Python chain mean pause equals the engine's `meanPauseS` to < 1e-9 relative in all 240 class rows (12 tables × 20
  classes), including the two transparent custom rungs (R-LINK-LOCAL on 7 classes, H-CONTROL-CONTINUITY on MGMT) and the
  rescaled explicit stages of C-LOSSLESS (60 / 41 / 60 s rescaled to the 60 s attempt).
- The per-layer isolation / silent split ∝ (per-unit rate × count) and the percentage convention of U_ℓ match `byLayer` /
  `unavailabilityByLayer`; `DEFAULT_LAYERS` carries the Methodology §3 unit → layer map.
- The pruning rule reproduces the 24 published verdicts of `docs/backup/ascend-allocation/mechanisms.json`.

### 4. Regeneration of 2026-10-27 (v5.5, the fifth model review)

Three input tables and seven cases were added for the review's D4, M1 and M2 (`docs/markdown/MODEL_REVIEW_2026-10-27.md` §7), and the Python
gained the two pieces of the specification those cases need, both written from the spec, not from the engine:

- §24.2 per-class recovery (`class_recovery`): a class with its own stages keeps the job's stage for every stage it does not override,
  A_i = Σ stages_i, g_i = G − (A − A_i)·(T_auto(N)/A) with T_auto(N) = A in these tables (no recovery scale law); each class's chain runs on
  (t_d, g_i, A_i) and its global attempt is split by its own stages, p_global,i·t_stage,i, rate-weighted (`chain.a3server-10k.snapshot`:
  11 classes with own stages, all 20 class means equal the engine's to < 1e-9).
- §24.3 class coverage in the layer split (`by_layer`): q_u = 1 − (1 − q_abs | q)·Π(1 − c_k) from the dumped `sdcCoverage` /
  `sdcExtraDetection` inputs; the detected-corruption pause is split by Σ sdc_u·n_u·q_u (`byLayer.a3server-10k.abft`), and D keeps F
  with the predictor's false alarms (`byLayer.a3server-10k.predict`, false alarms 1.97 s/h).

The recheck of the same day added the canonical order of custom rungs to the Python chain (`CUSTOM_RUNG_ORDER`, as `mechanisms/chain.ts`);
the dumped tables carry the rungs in that order already, so no value changed. Every pre-existing expected value is unchanged except for floating-point reassociation: the largest relative change over the 29 old cases is
2.5e-16 (`chain.*.job.stages.*`, now summed per class; `byLayer.*.sdc`, now weighted by q_u = 0.95 for every class), far inside the 1e-9
tolerance. The input tables gained `sdcCoverage` / `sdcExtraDetection` per class and BOXIO-hard's `applicable.predict` became 0 (the
catalog's scope rule, fourth review R2); no expected value depends on either in the old cases. Regenerated with `/usr/bin/python3` 3.9.6.

### 5. Regeneration of 2026-10-29 (v5.6, the effective-goodput basis)

The report pipeline moved to the effective goodput as its acceptance metric (user's decision 2026-10-28; `docs/markdown/MODEL_REFERENCE.md` §30). The
input tables gained the inputs of the loss form (1′) — per class the rollback probability and the local loss, τ, δ, the recompute source and lag,
the throughput factors, the engine's ledger lines and `effective` — and the Python gained `kpi_form_eff`, `requirement_eff`, `loss_breakdown` and
the metric of `prune`, each written from §30, not from the engine. Findings of the run: none — the loss form closes on the engine's effective goodput
on all 15 tables (first-order headline everywhere), the layer split closes exactly, and formula (2′) gives B between −36 and −55 s/h on every
derated design: the checkpoint saves of C-FAST (δ/τ = 1.67 % nominal, 2.5 % derated = 90 s/h) exceed the whole loss budget 1 − G* = 54 s/h, so no
hardware or mechanism of the set reaches 98.5 % and `results.json` carries every scale as the all-moves design at k = 1 (`feasible` false). The old
G5a / G5b cases need a binding mean and are skipped on this data (the A_op basis, `--metric aOp`, still produces them). The studies were regenerated
with the effective-goodput Shapley values (`generated` 2026-10-29); under the effective rule C-ASYNC enters the candidates (+0.17–0.20 pt) and
R-FABRIC-DEGRADE leaves (+0.07–0.17 pt), which the set record now states (`prune.metric`). Every pre-existing expected value of G1–G4 is unchanged
except where the recommended designs changed with the data (the `recommended*` tables are now the all-moves designs). Regenerated with
`/usr/bin/python3` 3.9.6.

## Regenerating

```
node --import tsx packages/core/test/golden/dump_inputs_v5.mjs      # inputs_v5/*.table.json (engine used for inputs only)
python3 packages/core/test/golden/compute_golden_v5.py              # golden_v5.json (prints the findings list); use the system Python 3.9 — a newer Python changes the last float digits
npm test -w @hac-d/core
```

_Values of §1 and §2 regenerated 2026-10-28 from commit 38c2c45 (fourth review R1 / R4 fixed, second recheck of the fifth review): `dump_inputs_v5.mjs` → `compute_golden_v5.py`; findings 0. Regenerated again 2026-10-29 for v5.6 (§5, the effective-goodput basis; 62 cases): findings 0._
