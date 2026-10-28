# HAC-D model review — 2026-10-27 (fifth review)

| | |
|---|---|
| Scope | The models changed since the fourth review (2026-10-18): v5 report primitives (formulas 1–6, layers, MTTR composition, window rule, budget assembly, records), v5.4 templates, v6 input path (口径 normaliser, device-table importer, gates), v6.3 / v6.4 project report and project editing |
| Code | `main` at f903fdb (no code change since 652c827, where the checks ran); working tree clean |
| Method | `model-check` skill: derivation from the spec (`docs/markdown/MODEL_REFERENCE.md` §25–§27), numerical checks on the engine with synthetic public scenarios (A3 · CloudMatrix384 and the built-in records), end-to-end runs of `hierarchicalBudget` |
| Status | Reported by the review without changing the repository; **resolved 2026-10-27** (section 7: D1–D9, M1–M3, R2, R3 fixed with tests and goldens; R1 and R4 left as decisions because they change the published designs); **R1 and R4 fixed 2026-10-28** on the report owner’s decision (section 7, `MODEL_REVIEW_2026-10-28_RECHECK2.md` §6; the report set regenerated) |

## 1. Summary

The reliability formulas check out and the committed Ascend report set is not affected (section 6). The newer code around the formulas has nine defects, mostly in the v6 input path and the v6.3 / v6.4 project report and editing. Four findings of the fourth review are still open.

| # | Defect | Area | Severity | Location |
|---|---|---|---|---|
| D1 | Audited mechanisms cannot be applied through the project workflow: silent no-op reported as applied, needed keys refused | v6.4 project editing | High | `packages/core/src/project/edit.ts:211` |
| D2 | Device-table importer misreads percent AFR and Chinese per-hour headers (138× to 10¹¹× errors) | v6 input | High | `packages/importers/src/worksheet/deviceTable.ts:33–34` |
| D3 | A mechanism set's recovery baseline is never applied | v5 records, v6 input | High | `packages/core/src/budget/index.ts:267` |
| D4 | MTTR decomposition (formula 5) ignores per-class stage savings and throws | v5 primitives | High | `packages/core/src/mttr/decompose.ts:106, 117, 125` |
| D5 | The derated twin is rebuilt in library order while projects record the applied order; several pairs do not commute | v5 window rule, budget | Medium | `packages/core/src/strategy/window.ts:32` |
| D6 | Formula (2) prints negative MTBF / MTTR requirements when B ≤ 0 | v5 primitives, reports | Medium | `packages/core/src/strategy/requirement.ts:36` |
| D7 | Fewer than 35 window trials can never pass; the report then throws | v5 window rule, web | Medium | `packages/core/src/strategy/window.ts:47`, `apps/web/src/panels/ReportPanel.tsx:100` |
| D8 | Project report: the Shapley study ignores the project's mechanism parameters | v6.3 report | Medium | `packages/core/src/study/archStudy.ts:74` |
| D9 | Scale-out network off → on drops per-class mechanism effects | v6.4 project editing | Low | `packages/core/src/project/edit.ts:129` |
| M1–M3 | Formula (3) denominator, layer split of detected corruption, a doc comment | v5 primitives | Minor | section 4 |
| R1–R4 | Still open from the fourth review | v4 | Low–Medium | section 5 |

## 2. Baseline

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | core 851 / 851, plus suites of 52, 36, 43 and 13 tests, all pass |
| `node packages/reports/test/reproduce.mjs` | 6 OK (byte-for-byte) |

## 3. Verified correct

- **Formula (1)** `kpiForm`: A_op = (1 − φ) / (1 + (Σλᵢt̄ᵢ + F)/3600) closes against the engine's running fraction (|Δ| ≤ 1e-9, asserted). F is exactly the sum of the three other event classes, each at its own pause: sub-health isolation at the global recovery G, detected silent corruption at t_d + G (or the step recovery), predictor false alarms at t_mig.
- **Formula (2)** `requirementFromKpi`: B = 3600·((1 − φ)/A* − 1) − F in seconds of hardware pause per job hour; MTBF needed = MTTR/B in hours, MTTR allowed = B·MTBF in seconds; the factors are consistent (B > 0 case).
- **Formula (3)** `byLayer`: every class sits on exactly one layer, so Σ_ℓ λ_ℓ = λ_hw and Σ_ℓ C_ℓ = Σλᵢt̄ᵢ; U_ℓ = C_ℓ / (3600·D) equals the study decomposition's per-class points.
- **§25.3** the derated design is built in the required order (applyMechanisms → deratedOf → applyLevers → withHardwareFactors) in `recommendPlan` and `hierarchicalBudget`.
- **§26.1** 口径 normaliser: FIT, per 10⁶ h, per h, MTBF h and AFR (annual failure fraction, λ = −ln(1 − AFR)/8760 h) convert as specified; FIT_class,unit = Σ FIT_device × devices per unit × impact factor; hard / slow / sdc never added; confidence policy as specified (goldens G7a–G7e pass).
- **Failure-rate override**: per-card values convert × cards per unit of the CloudMatrix384 geometry; each type is written to its own block (failure, sub-health rate, silent rate).
- **Topology counts**: the v4 goldens cover all five templates (a2-roce, a3-ub384, a950-ub2, a960e-ub, ub-generic) and the count overrides.

## 4. Defects

### D1 — Audited mechanisms cannot be applied through the project workflow (v6.4)

**Where.** `editMechanisms` in `packages/core/src/project/edit.ts`: the key check at line 211 compares against `m.parameters` (the library defaults), and the mechanisms are then applied with the defaults merged with the caller's keys.

**What.** Most audited mechanisms read integration parameters that are not in their library defaults (`eligibleShare`, `success`, `failureSeconds`, `riskShare`, …). With the defaults alone the transform returns the scenario unchanged and writes no applied record, yet `editMechanisms` returns `+<id>` in `changed`. Passing the missing keys is refused, because the check does not use `mechanismParameterKeys(id)` — the vocabulary the v6 gate (`validateMechanismSet`) uses.

**Evidence.** A3 · CloudMatrix384, 100,000 NPUs, six default mechanisms; each audited mechanism applied alone with `editMechanisms(s, { apply: { [id]: {} } })`. ΔA_op and Δdelivered: nominal closed form over the 30-day job window, percentage points.

| Mechanism | Default-set list | Reported | Applied record | ΔA_op | Δdelivered | Set keys refused |
|---|---|---|---|---|---|---|
| R-LINK-LOCAL | candidates | applied | none | 0 | 0 | eligibleShare, success, failureSeconds, overhead |
| R-FABRIC-DEGRADE | candidates | applied | none | 0 | 0 | eligibleShare, success, failureSeconds, overhead |
| H-CONTROL-CONTINUITY | candidates | applied | none | 0 | 0 | eligibleShare, success, failureSeconds, overhead |
| R-RUNTIME-SNAPSHOT | candidates | applied | none | 0 | 0 | eligibleShare |
| R-WARM-PROCESS | pruned | applied | none | 0 | 0 | eligibleShare |
| R-CANN-GRAPH | pruned | applied | none | 0 | 0 | eligibleShare |
| D-SDC-FP8 | goodputOnly | applied | none | 0 | 0 | riskShare |
| D-SDC-FP4 | goodputOnly | applied | none | 0 | 0 | riskShare |
| H-SDC-SCREEN | goodputOnly | applied | none | 0 | 0 | eligibleShare |
| C-LOSSLESS | candidates | applied | yes | +0.0627 | +0.0606 | share |
| D-RECOVERY-CLASSIFY | candidates | applied | yes | +0.2036 | +0.1965 | eligibleShare, success |
| C-ASYNC | pruned | applied | yes | 0 | −0.0297 | none |
| D-ABFT | goodputOnly | applied | yes | +0.0010 | +1.8000 | none |
| D-NET-SDC | goodputOnly | applied | yes | +0.0001 | +0.1087 | none |
| R-HCCL-ELASTIC | pruned | applied | yes | 0 | +0.0023 | share |

Nine of the fifteen audited mechanisms are silent no-ops, four of them among the seven default candidates. Where the transform works, it runs with library defaults that differ from the set's parameters, and the set's values cannot be passed.

**Impact.** `hacd scenario mechanisms --apply`, MCP `scenario_mechanisms` and the operator tools `hacd_scenario_*`: a model is told a mechanism was applied while the KPIs do not change; the operator workflow cannot reproduce the report set's designs.

**Suggested fix.** Validate keys against `mechanismParameterKeys(id)`; merge the default set's parameters (or `provisionalParameters`) when the caller gives none; report "not applied: needs …" instead of `+id` when the transform writes no record.

### D2 — Device-table importer misreads percent AFR and Chinese per-hour headers (v6 input)

**Where.** `packages/importers/src/worksheet/deviceTable.ts:33` (`UNIT_FROM_HEADER`) and `:34` (`UNIT_TEXT`); the normaliser's AFR at `packages/core/src/ingest/koujing.ts:89` expects a fraction.

**What.**
1. The unit text `%/year` and the headers `annual`, `年化`, `AFR (%)` map to `afr`, but the value is kept as written ("values stay as written"), so a percentage enters a formula that expects a fraction. Values of 1 % and above fail the `AFR < 1` check; values below 1 % — typical for DIMMs, SSDs and HDDs — pass silently.
2. The header rules are tried in order, and `/mtbf|mttf|平均无故障|小时/` comes before `/10^6|per million|百万/` and `/…|每小时/`. Any Chinese header containing 小时 ("hours") is read as MTBF, including "per 10⁶ hours" and "per hour" headers.

**Evidence.** Synthetic one-row sheets through `deviceTableFromSheet`, then `deviceFit` (device FIT = failures per 10⁹ device-hours, all failure modes).

| Sheet | Read as | Device FIT | Intended |
|---|---|---|---|
| value 0.5, unit cell `%/year` | afr 0.5 | 79,126 | 572 (AFR 0.005) |
| header `AFR (%)`, value 0.8 | afr 0.8 | 183,730 | 917 (AFR 0.008) |
| header `失效率（每百万小时）`, value 2.5 | mtbf_h 2.5 | 4.0 × 10⁸ | 2,500 |
| header `每小时失效率`, value 2 × 10⁻⁶ | mtbf_h 2 × 10⁻⁶ | 5.0 × 10¹⁴ | 2,000 |
| header `Failure rate (per million hours)`, value 2.5 | per_1e6_h 2.5 | 2,500 | 2,500 (correct) |

**Impact.** Wrong device FIT reaches the normaliser and the override; only the plausibility envelope of `validateFaultRateOverride` (×0.1 … ×10 of the unit library, level *warning*) flags it, after the mapping.

**Suggested fix.** Divide by 100 when the unit cell or the header carries `%` (or a separate unit `afr_pct`); test the per-10⁶-h and per-hour rules before the MTBF rule and match 小时 alone only in a unit cell; add golden cases for these spellings to G7.

### D3 — A mechanism set's recovery baseline is never applied (v5 records, v6 input)

**Where.** `withRecoveryBaseline` (`packages/core/src/records/mechanismSet.ts:191`) has no caller in core, CLI, MCP, agent or web. `recordScenario` (`packages/core/src/budget/index.ts:267`) builds the scenario from the record and applies the set's mechanisms only. The mechanism-set worksheet offers `recovery.*` fields (`packages/core/src/ingest/fields.ts:119`).

**What.** The set's `recovery` block (detection coverage and times, automatic attempt and success, manual time, with provenance) and its optional `stages` are parsed, resolved and documented as the baseline, but every record-built scenario keeps the template's values: detection 95 % in 10 s else 60 s, automatic 180 s at 99 %, manual 7,200 s.

**Evidence.** cm384 record at 100,000 NPUs, default set copied with automatic 90 s at 99.5 % and manual 3,600 s. A_op = nominal closed form over the 30-day job window.

| Scenario | Recovery used | A_op |
|---|---|---|
| `recordScenario` (report pipeline) | 180 s at 99 %, manual 7,200 s | 99.0853 % |
| with `withRecoveryBaseline` | 90 s at 99.5 %, manual 3,600 s | 99.5388 % |

**Impact.** `budgetFromRecords`, `hacd findings | budget`, `hacd ingest dry-run | diff | run`: an internal set with a measured recovery baseline is silently ignored. The default set's recovery equals the template's, so the committed reports are unaffected.

**Suggested fix.** Call `withRecoveryBaseline` in `recordScenario` after `scenarioFromRecord` (it works through `editBase`, so mechanisms such as D-HARD still act on top), and in any other path that applies a set to a record scenario; add a test with a non-default recovery.

### D4 — MTTR decomposition (formula 5) ignores per-class stage savings (v5)

**Where.** `packages/core/src/mttr/decompose.ts:106` and `:117` pass the job-level `t.chain.globalS` and `automatic.seconds` to `chainSplit` for every class; `:125` splits the global attempt by the job-level stages. The engine gives a class with `recoveryStages` its own global recovery (`gOf`, `packages/core/src/scenario/evaluate.ts:544`): gᵢ = G − (A − Aᵢ)·A(N)/A (§24.2).

**What.** For such a class the split no longer sums to the class's mean pause, and the closure assertion in `mttrDecomposition` throws.

**Evidence.** A3 · CloudMatrix384 at 100,000 NPUs, one mechanism applied with the default set's parameters. Mean pause in seconds of job time per interruption.

| Mechanism | Classes with own stages | `mttrDecomposition` |
|---|---|---|
| R-RUNTIME-SNAPSHOT (default candidate) | 11 | throws: CORE-hard split 17.2642 s vs engine 17.2599 s |
| R-WARM-PROCESS (pruned) | 1 | throws: UNKNOWN-hard 264.5 s vs 226.5 s |
| R-CANN-GRAPH (pruned) | 5 | throws: CORE-hard 17.2642 s vs 17.2621 s |
| C-LOSSLESS (job-level stages) | 0 | closes (86.9743 s) |

`hierarchicalBudget` on a project with R-RUNTIME-SNAPSHOT applied throws at once ("MTTR split does not close for CORE-hard").

**Impact.** `designSummary` → `hierarchicalBudget` → every report path (`hacd findings`, the web Allocation › Report tab, `hacd scenario report`) fails when today's or the recommended design contains one of these mechanisms. The committed reports never selected them.

**Suggested fix.** Expose the class's global recovery and automatic time on the chain row (the values `gOf` computes), pass them to `chainSplit`, and split `globalAuto` by the class's own stages; add a golden case for a stage-lowered class.

### D5 — The derated twin is rebuilt in library order (v5 window rule, budget)

**Where.** `deratedOf` (`packages/core/src/strategy/window.ts:32`), the strategies' derated designs (`packages/core/src/strategy/index.ts:195`) and the budget's rebuild with its assertion (`packages/core/src/budget/index.ts:187–188`) re-apply through `applyMechanisms`, which applies in library order (`packages/core/src/mechanisms/index.ts:539`). A project records mechanisms in the order applied, and re-applying one with new parameters (Mechanism library page, `hacd scenario mechanisms --apply`) strips it and puts it last.

**What.** Where two transforms do not commute, the derated twin is not the derated version of the nominal design.

**Non-commuting pairs.** Pairwise test of all appliable mechanisms on the A3 100k design: both orders evaluated; listed when |ΔA_op| or |Δdelivered| > 1e-12 (fractions).

| Pair | Cause | \|ΔA_op\| | \|Δdelivered\| |
|---|---|---|---|
| D-SDC × D-SDC-DMR | D-SDC writes the coverage absolutely (`mechanisms/index.ts:137`), DMR takes the maximum (`:350`) | 1.3e-5 | 2.25e-2 |
| C-FAST × C-MEM | both write τ and δ absolutely (`:231`, `:319`) | 7.7e-11 | 8.0e-3 |
| R-ELASTIC × R-HCCL-ELASTIC | R-ELASTIC writes the elastic block, R-HCCL-ELASTIC subtracts a saving from it (`auditLibrary.ts:308`) | 0 | 2.2e-5 |
| R-WARM-PROCESS, R-RUNTIME-SNAPSHOT, R-CANN-GRAPH (pairwise) | same-stage rule new = current − share·(current − cand), skipped when cand ≥ current (`auditLibrary.ts:61–63`): exact only in decreasing-candidate order when share < 1 | 1.2e-5 – 2.1e-5 | 1.2e-5 – 2.1e-5 |
| R-LINK-LOCAL × R-FABRIC-DEGRADE | transparent custom rungs are tried in the insertion order of `mechanisms.custom` | 0 | 1.3e-3 |

**Evidence.** A3 at 10,000 NPUs.

1. Project with D-SDC-DMR applied before D-SDC (recorded order R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST, D-SDC-DMR, D-SDC). Nominal coverage 0.95, where library order gives 0.999. `deratedOf` gives 0.949 (derated DMR last), where the derated recorded order gives 0.90. `hierarchicalBudget` throws "rebuilt final design differs: 0.9909061564128143 vs 0.9909048224291939".
2. Project with C-MEM applied before C-FAST. Nominal τ 60 s, δ 1 s (C-FAST last). Derated twin δ 0.75 s (derated C-MEM last), where the derated recorded order gives 1.5 s. The report completes, with the derated delivered goodput overstated and no warning.

**Suggested fix.** Re-apply the recorded mechanisms in their recorded order in `deratedOf`, the strategies' derated designs and the budget rebuild, appending the additions; make the transforms commute where they should (D-SDC: maximum, as D-SDC-DMR; the same-stage rule: the expectation over both mechanisms, independent of order); fix the order of custom rungs (library order or `mechanisms.order`).

### D6 — Formula (2) prints negative requirements when B ≤ 0 (v5)

**Where.** `requirementFromKpi` (`packages/core/src/strategy/requirement.ts:36`) divides by B. Printed without a guard by the Findings conclusion (`packages/reports/src/findings.mjs:94–95`) and Table 5 (`:167`), the web Report panel (`apps/web/src/panels/ReportPanel.tsx:139`) and the CLI (`packages/cli/src/pipeline.ts:324`, `packages/cli/src/scenarioCmd.ts:192`).

**What.** When F and φ alone take the whole unavailability budget, B ≤ 0 and no hardware MTBF or MTTR meets the target; the code still returns MTTR/B and B·MTBF.

**Evidence.** A3 · CloudMatrix384 at 500,000 NPUs, derated design (the binding side). B in seconds of hardware pause per job hour.

| A* | B (s/h) | MTBF needed at today's MTTR (h) | MTTR allowed at today's MTBF (s) |
|---|---|---|---|
| 98.5 % | 45.911 | 2.2739 | 27.135 |
| 99.8 % | −1.692 | −61.703 | −1.000 |
| 99.9 % | −5.302 | −19.689 | −3.134 |

`targets.operational` accepts values up to 0.99999 (`SCENARIO_FIELDS`), so the case is reachable from the project workflow and the web app.

**Suggested fix.** Return null with a reason when B ≤ 0 ("out of reach by hardware alone: the other event classes F and φ take the budget") and print that sentence in the conclusion, Table 5, the panel and the CLI.

### D7 — Fewer than 35 window trials can never pass (v5 window rule, web)

**Where.** `windowCheck` (`packages/core/src/strategy/window.ts:47`) and the escalation in `recommendPlan` (throw at `:146`); the web Report tab accepts 1 to 5,000 trials (`apps/web/src/panels/ReportPanel.tsx:100`).

**What.** "Supported" needs the Wilson 95 % lower bound of P(A_op ≥ A*) ≥ 0.9. With every window passing, the bound is n/(n + z²), z = 1.96.

| Windows n, all passing | Wilson lower bound | Verdict |
|---|---|---|
| 20 | 0.8389 | uncertain |
| 34 | 0.8985 | uncertain |
| 35 | 0.9011 | supported |

Below 35 windows no design can be supported: `recommendPlan` adds every candidate and lever and throws "no move set meets the target with a supported window check". Observed on A3 at 10,000 NPUs (A_op 99.9 %) with 20 windows.

**Suggested fix.** Enforce the smallest n with n/(n + z²) ≥ required (35 at 0.9) in the web field, the CLI and `recommendPlan`, with a message that names the minimum.

### D8 — Project report: the Shapley study ignores the project's mechanism parameters (v6.3)

**Where.** `reportFromScenario` (`packages/core/src/budget/report.ts:98–105`) merges the project's recorded parameters for the budget but calls `studyOfBuild` with the set; the study evaluates every player with the set's parameters (`packages/core/src/study/archStudy.ts:74`).

**What.** One report mixes two parameter sets: the budget tables use the project's values, the Shapley table uses the set's. In addition, the study's bare base strips only the set's players and the six defaults, so a project mechanism outside the set (e.g. D-SDC-DMR, C-MEM, P-PREDICT) stays in the base and is not a player.

**Evidence.** A3 at 100,000 NPUs, project with D-SDC at coverage 0.6 or 0.95; study at one size, 4 permutations, seed 1.

| Project D-SDC coverage | Project delivered goodput | Study: D-SDC single gain (A_op) | Study: D-SDC Shapley (delivered) |
|---|---|---|---|
| 0.95 | 94.765 % | −0.0144 pt | 14.937 pt |
| 0.60 | 80.292 % | −0.0144 pt | 14.937 pt |

**Suggested fix.** Pass the merged parameters to `studyOfBuild`; strip every applied mechanism for the bare base and add the project's mechanisms outside the set as players (or list them in the report as fixed).

### D9 — Scale-out network off → on drops per-class mechanism effects (v6.4)

**Where.** `setScenarioFields`, branch `topology.scaleOut` (`packages/core/src/project/edit.ts:129–138`).

**What.** "Off" filters out the `@roce` classes and "on" re-adds them from the template example, both without `editBase`. Mechanisms with per-class effects on those classes (the custom rungs of R-LINK-LOCAL, R-FABRIC-DEGRADE and H-CONTROL-CONTINUITY; D-NET-SDC's detector) no longer act on the re-added classes, while their applied records remain. FIT overrides of those classes are lost, which is documented ("on restores the template default").

**Evidence.** A3 at 100,000 NPUs with R-LINK-LOCAL applied (set parameters): `@roce` classes carrying the rung 2 before, 0 after off and on; A_op 0.9919406 before, 0.9918147 after (nominal, 30-day window); records still list R-LINK-LOCAL.

**Suggested fix.** Do both toggles through `editBase` (strip, change the topology and the components, re-apply).

### Minor

- **M1 — Formula (3) denominator.** `unavailabilityByLayer` sums c + iso + sdc for D (`packages/core/src/layers/index.ts:120`); formula (3) defines D = 1 + (ΣC + F)/3600 with F including the predictor's false alarms. A3 at 100,000 NPUs with P-PREDICT: false-alarm pause 2.0775 s/h; D 1.01129177 (code) vs 1.01186886; Σ U_ℓ 1.069924 pt vs 1.069314 pt.
- **M2 — Layer split of detected corruption.** The detected-corruption pause is split by each layer's raw silent rate (`layers/index.ts:114`) instead of its detected rate λᵢ·qᵢ (`classSdcCoverage`), which differs once a per-class detector is applied. With D-ABFT: NPU layer 0.01275 s/h vs 0.01281 s/h. The isolation pause is split by sub-health entry rate, exact only while every class has the same detection.
- **M3 — Doc comment.** `MttrDecomposition.recovery.globalS` (`packages/core/src/mttr/decompose.ts:96–97`) is described as detection + automatic + manual share; the value is automatic + manual share (252 s; the 12.5 s detection is `tDetS`).

## 5. Still open from the fourth review (2026-10-18)

| # | Finding | Location | Effect today |
|---|---|---|---|
| R1 | The automatic-success lever is dead under the default derating: 0.999 − 0.08 = 0.919 < the current 0.99, so the derated value is clamped to today's and the lever never gains on the derated side; now also in `recommendPlan` and `recommendLevers` | `packages/core/src/strategy/index.ts:147` | never selected in the committed reports; derating the failure probability (×1.5) would make it a real option |
| R2 | BOXIO-hard is predictable in topology scenarios (unit node → predict 1) but not in the catalog (scope rack → 0) | `packages/core/src/topology/index.ts:341` | none while P-PREDICT is not a candidate |
| R3 | `MODEL_REFERENCE.md` has no v4 section: per-unit FIT conversion (FIT_unit = FIT_card × 384 / units per CloudMatrix384 pod), folded Clos rule, proportional fill, strategy level rule xᵢcᵢ = clamp(wᵢL, floorᵢ·cᵢ, cᵢ) | `docs/markdown/MODEL_REFERENCE.md` | formulas only in code comments, `compute_golden_v4.py` and the explainer |
| R4 | Derated D-HARD coverage 0.999 − 0.05 = 0.949 falls below the baseline 0.95; levers are floored at today's value, mechanisms are not | `packages/core/src/mechanisms/plan.ts:40` | D-HARD is in all four 500k recommended designs; about 0.002 pt of A_op |

## 6. The committed report set is not affected

`docs/backup/ascend-allocation/results.json` (four records × four scales, target 98.5 %, 400 windows):

- the recommended designs use D-HARD, D-RECOVERY-CLASSIFY, R-LINK-LOCAL, H-CONTROL-CONTINUITY, C-LOSSLESS and the automatic / manual levers — no per-class stage mechanism (D4);
- every design is built by `applyMechanismSet` / `applyMechanisms` in library order, and the added mechanisms commute with the baseline (D5; the budget's rebuild assertion passed);
- the default set's recovery equals the template's (D3);
- B > 0 at every size (45.9 to 54.7 s/h) (D6); 400 windows (D7);
- records, not projects (D1, D8, D9); no importer input (D2).

R1 and R4 do apply to these reports; their effect is small.

## Appendix — reproduction

All checks use built-in public scenarios; no internal data. Run from the repository root with `node --import tsx <file>.mts` (ES module extension, so top-level `await` works outside the packages).

```ts
// D1: audited mechanism through the project editor
const R = `${process.cwd()}/packages/core/src`;
const { topologyScenario } = await import(`${R}/topology/index.ts`);
const { editMechanisms } = await import(`${R}/project/edit.ts`);
const s = topologyScenario('a3-ub384', 100000);
const e = editMechanisms(s, { apply: { 'R-LINK-LOCAL': {} } });
console.log(e.changed, !!e.scenario.mechanisms.applied?.['R-LINK-LOCAL']); // [ '+R-LINK-LOCAL' ] false
editMechanisms(s, { apply: { 'R-LINK-LOCAL': { eligibleShare: 1 } } });  // throws: no parameter 'eligibleShare'
```

```ts
// D2: percent AFR and a zh per-10^6-hour header
const { deviceTableFromSheet } = await import(`${process.cwd()}/packages/importers/src/worksheet/deviceTable.ts`);
const { deviceFit } = await import(`${process.cwd()}/packages/core/src/ingest/koujing.ts`);
const sheet = (rows: (string | number)[][]) => ({ name: 'x', rows: rows.length, cols: rows[0].length, merges: [], outline: rows.map(() => 0),
  cells: rows.flatMap((r, i) => r.map((value, j) => ({ sheet: 'x', addr: '', row: i, col: j, value }))) });
for (const rows of [[['器件', '失效率', '单位', '来源'], ['DIMM', 0.5, '%/year', 'v']], [['器件', '失效率（每百万小时）', '来源'], ['PSU', 2.5, 'v']]]) {
  const t = deviceTableFromSheet(sheet(rows) as never, { id: 't', sourceType: 'vendor' }).table.rows[0];
  console.log(t.unit, deviceFit(t)); // afr 79126…  /  mtbf_h 4e8
}
```

```ts
// D3: the set's recovery baseline
const R = `${process.cwd()}/packages/core/src`;
const { recordScenario } = await import(`${R}/budget/index.ts`);
const { BUILTIN_TOPOLOGY_RECORDS } = await import(`${R}/records/topologyRecord.ts`);
const { DEFAULT_MECHANISM_SET, parseMechanismSet } = await import(`${R}/records/mechanismSet.ts`);
const set = parseMechanismSet({ ...structuredClone(DEFAULT_MECHANISM_SET), id: 'what-if', recovery: { ...DEFAULT_MECHANISM_SET.recovery, automatic: { seconds: 90, successProbability: 0.995 }, manual: { seconds: 3600 } } });
const s = recordScenario(BUILTIN_TOPOLOGY_RECORDS.cm384, set, 100000);
console.log(s.recovery.automatic, s.recovery.manual); // { seconds: 180, successProbability: 0.99 } { seconds: 7200 }
```

```ts
// D4: MTTR split with a per-class stage mechanism
const R = `${process.cwd()}/packages/core/src`;
const { topologyScenario } = await import(`${R}/topology/index.ts`);
const { applyMechanisms } = await import(`${R}/mechanisms/index.ts`);
const { mttrDecomposition } = await import(`${R}/mttr/decompose.ts`);
const { resolveMechanismSet, DEFAULT_MECHANISM_SET } = await import(`${R}/records/mechanismSet.ts`);
const s = applyMechanisms(topologyScenario('a3-ub384', 100000), ['R-RUNTIME-SNAPSHOT'], resolveMechanismSet(DEFAULT_MECHANISM_SET).parameters);
mttrDecomposition(s); // throws: MTTR split does not close for CORE-hard
```

```ts
// D5: recorded order vs the derated twin (C-MEM before C-FAST)
const R = `${process.cwd()}/packages/core/src`;
const { topologyScenario } = await import(`${R}/topology/index.ts`);
const { applyMechanisms } = await import(`${R}/mechanisms/index.ts`);
const { deratedOf } = await import(`${R}/strategy/window.ts`);
const s0 = topologyScenario('a3-ub384', 10000, { mechanisms: ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC'] });
const s = applyMechanisms(applyMechanisms(s0, ['C-MEM']), ['C-FAST']);
console.log(s.workload.deltaS, deratedOf(s).workload.deltaS); // 1  0.75  (derated recorded order: 1.5)
```

```ts
// D6: B ≤ 0
const R = `${process.cwd()}/packages/core/src`;
const { topologyScenario } = await import(`${R}/topology/index.ts`);
const { requirement } = await import(`${R}/strategy/requirement.ts`);
const q = requirement(topologyScenario('a3-ub384', 500000), 0.998);
console.log(q.B, q.mtbfAtTodayMttrH, q.mttrAtTodayMtbfS); // −1.69  −61.7  −1.0
```

```ts
// D7: Wilson lower bound with every window passing
const { proportionEstimate, proportionVerdict } = await import(`${process.cwd()}/packages/core/src/math/stats.ts`);
for (const n of [34, 35]) { const e = proportionEstimate(n, n); console.log(n, e.low, proportionVerdict(e, 0.9)); } // 0.8985 uncertain / 0.9011 supported
```

## 7. Resolution (2026-10-27)

Everything below is in the working tree of the same day (`npm test`: 40 files, 867 tests; `npm run typecheck` clean; `node packages/reports/test/reproduce.mjs`: six OK — the Methodology page was re-rendered for one added sentence, the Findings and BOM pages are byte-identical). Regression tests: `packages/core/test/model_review_v55.test.ts` (16 tests, one block per finding), `packages/importers/test/worksheet.test.ts` (D2), the goldens `golden_v5.json` (three new input tables, seven new cases; every pre-existing expected value unchanged to 2.5e-16, `golden-v5-report.md` §4). Spec: `MODEL_REFERENCE.md` §22.4.1, §25.1, §25.3, §26.1, §27.4, §28, §29.

| # | Fix | Where | Effect on the committed report set |
|---|---|---|---|
| D1 | `editMechanisms` applies with `mechanismDefaults(id)` — the default set's parameters over the library's, then the caller's; keys from `mechanismParameterKeys`; refused with the missing keys when integration parameters are still absent, when a required mechanism is not applied, or when the transform leaves the project unchanged. `scenarioVocabulary` lists parameters, keys, `needs`, `requires`, the set's effort | `project/edit.ts`; CLI, MCP and operator texts | none (records, not projects) |
| D2 | header rules most-specific first (FIT, MTBF with a multiplier, per 10⁶ h, per hour, AFR, MTBF); a percent AFR (`%/year`, `AFR (%)`, `年化 %` in the header or the unit cell, or a `%` in the value cell — recheck N1) ÷ 100 with the value as written in the row's note, a `%` under any other unit refused; an MTBF in a multiple of hours (`百万小时`, `million hours`, `10^6 h`, `万小时`, `kh` — recheck N2) multiplied into hours, in the importer and in the agent's draft | `importers/src/worksheet/deviceTable.ts`, `agent/src/draft.ts` | none |
| D3 | `recordScenario` and `archStudy` write the set's recovery baseline (`withRecoveryBaseline`) on the bare scenario before the override and the baseline mechanisms | `budget/index.ts`, `study/archStudy.ts` | none: the default set's recovery equals the template's (`records.test.ts` pins the JSON identity) |
| D4 | the engine's chain row carries the class's own `globalS`, `autoS` and `stages` (§24.2); `classChainSplits` / `mttrDecomposition` run each class on them and split its global attempt by its own stages | `scenario/evaluate.ts`, `mttr/decompose.ts`; golden `chain.a3server-10k.snapshot` | none (no per-class stage mechanism in the designs); the stage split of the old cases moved by 2.5e-16 |
| D5 | `applyMechanismsInOrder`; `deratedOf`, the strategies' derated designs and the budget's rebuild re-apply in the recorded order; D-SDC takes the maximum coverage (commutes with D-SDC-DMR). Recheck: the same-stage rule is now the per-event expectation (`sameStageValue`, §24.2) and custom rungs are tried in a canonical order (`CUSTOM_RUNG_ORDER`), so the startup trio and the custom rungs commute too; the pairs that still depend on the order are the two design choices C-FAST × C-MEM and R-ELASTIC re-applied after R-HCCL-ELASTIC (§22.4.1) | `mechanisms/index.ts`, `mechanisms/auditLibrary.ts`, `mechanisms/chain.ts`, `mc/ledger.ts`, `mttr/decompose.ts`, `strategy/window.ts`, `strategy/index.ts`, `budget/index.ts` | none: the baseline is applied in library order on a bare scenario; `reproduce.mjs` six OK; the stored Shapley studies hold the sequential value on the coalitions with all three startup mechanisms (< 1e-7 of A_op) |
| D6 | `Requirement.reachable` = B > 0; the two ends and the factors are null below; `UNREACHABLE_TEXT` printed by the Findings conclusion and Table 1 ("—" cells, note), the web panel, the CLI (`budget`, `scenario report`); the Methodology's formula (2) note states the case | `strategy/requirement.ts`, `reports/src/findings.mjs`, `content.mjs`, `ReportPanel.tsx`, `pipeline.ts`, `scenarioCmd.ts`, `report.ts` | the Methodology page re-rendered (one sentence); B > 0 everywhere else |
| D7 | `minWindowTrials(required)` (35 for 0.9); `recommendPlan`, `recommendLevers`, `hierarchicalBudget`, `reportFromScenario`, `hacd findings`, `hacd budget` refuse fewer windows with the minimum named; the web field's minimum is 35 | `math/stats.ts`, `strategy/window.ts`, `budget/*`, CLI, `ReportPanel.tsx` | none (400 windows) |
| D8 | `studyOfBuild` takes the project's parameters (`projectParameters` records what differs from the set), strips the players and lists applied mechanisms outside them as `fixed`; the hierarchy's basis and the Findings Table 6 note name both | `study/archStudy.ts`, `budget/report.ts`, `findings.mjs` | none (a record's study equals `archStudy`, `report_v63.test.ts`) |
| D9 | both scale-out toggles through `editBase` | `project/edit.ts` | none |
| M1 | D = 1 + (ΣC + F)/3600 with `kpiForm.F` (false alarms included) | `layers/index.ts`; golden `byLayer.a3server-10k.predict` | none (no P-PREDICT) |
| M2 | the detected-corruption pause split by Σ λ_sdc,i qᵢ (`sdcDetectedRate`) | `layers/index.ts`; golden `byLayer.a3server-10k.abft` | none (uniform coverage; 2.5e-16 reassociation) |
| M3 | the `globalS` comment | `mttr/decompose.ts` | — |
| R2 | the predictor's applicability by the event's catalog scope (persistent, card or server), so BOXIO-hard is 0 as in the catalog | `topology/index.ts` (`UnitFaultType.scope`) | none (no P-PREDICT; the golden inputs' `applicable.predict` of BOXIO-hard became 0) |
| R3 | `MODEL_REFERENCE.md` §28: per-unit FIT, the folded Clos, count overrides and fabric fill, the strategies' level rule, derating and effort | docs | — |
| R1, R4 | **fixed 2026-10-28 on the report owner’s decision** (`MODEL_REVIEW_2026-10-28_RECHECK2.md` §6; the report set regenerated from that commit); as described when they were left open: derating the success lever's failure probability (×1.5 instead of −8 pt) makes the lever a real move and can change which plan the optimal search and the window rule pick at 200k / 500k; flooring a derated mechanism parameter at the baseline it replaces (D-HARD 0.949 → 0.95) raises every 500k derated A_op by about 0.002 pt and moves k. Both regenerate the four Findings pages (400 windows); the fix is a two-line change each once decided | `strategy/index.ts` (`applyLevers`), `mechanisms/plan.ts` or the transforms | the recommended designs may change |
