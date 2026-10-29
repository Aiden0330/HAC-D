# HAC-D model review — sixth review: the effective-goodput basis (2026-10-29)

| | |
|---|---|
| Scope | v5.6 "the report on the effective-goodput basis" (5e782f0): formulas (1′)–(6′), the infeasible path of the window rule, the effective Shapley and the pruning rule, the window ledger's per-window value, the mechanism-set worksheet; a regression pass over the fixes of the fifth review and its rechecks |
| Code | `main` at 5e782f0, pushed; working tree clean apart from untracked drafts |
| Method | the suites and `reproduce.mjs`; the formulas re-derived from the code and checked against the engine; closed form against the window ledger (400 windows, seed 1) and the exact renewal; formula (2′) against the engine's bisection root, including the exact-renewal regime; C-ASYNC's marginal value by coalition and in the allocated designs; the effective Shapley half-widths recomputed with the study's own sampler (seed 1, 300 permutations); the worksheet round trip through the hierarchy. Synthetic public records and built-in examples only |
| Status | Reported by the review without changing the repository; **resolved 2026-10-29** (section 6: F1–F6 and M1–M6 fixed with tests and goldens; the studies, the report set, the goldens and the manual regenerated) |

## 1. Summary

The effective-goodput loss form, its layer split and its requirement close on the engine as documented, the printed formulas match the code, the six committed pages reproduce, and the user's two decisions are implemented as stated (the 98.5 % goal on G_eff with G_del beside it; C-FAST's fixed saves kept and the goal accepted as unreachable). Six problems were found, two of them high.

| # | Finding | Severity | Effect on the committed report set |
|---|---|---|---|
| F1 | Formula (2′) declares an unreachable target reachable when today's derated design is in the exact-renewal regime | High | none (every block is first order); reached by inputs with hardware rates about 2–3× the public records at 500k |
| F2 | `npm test` fails: the mechanism-set worksheet drops `prune.metric`; a set read back from a complete worksheet breaks `hacd findings` | High | none on the pages; the worksheet path for mechanism sets is broken and three suites are skipped |
| F3 | C-ASYNC is a G_eff candidate but lowers G_eff in every design the allocation can build | Medium | the all-moves designs carry it; its card's reason contradicts Table 4 on the same page |
| F4 | The acceptance metric is the first-order G_eff: 0.06–0.46 pt below the exact renewal and the window ledger, with every regime flag "ok" | Medium | printed G_eff low by up to 0.46 pt (derated, 500k); no verdict changes |
| F5 | The closed-form slowdown charges every slowed unit at the worst class's performance; the ledger charges each class its own | Medium (latent) | none (every sub-health class of the records has φ = 0.95); 5.8 pt on `atlas950Training` |
| F6 | The two v5.6 verdict changes (C-ASYNC in, R-FABRIC-DEGRADE out) sit within the effective Shapley sampling error, which the studies do not store | Low–Medium | two verdicts are statistically unresolved |
| M1–M6 | p_sdc booked differently in (2′) and (3′); no blocking in the per-window value; the strategy split weighted by pause; Table 4's per-layer column pause-only; the exact-renewal docstring; stale and repeated text | Low | presentation and latent paths |

## 2. Baseline of 5e782f0

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | core 882 / 882 pass; importers 54 / 55, **1 failed** (F2); the root script chains the workspaces with `&&`, so it stops there |
| agent, reports, CLI suites run alone | 37, 44, 13 — all pass |
| `node packages/reports/test/reproduce.mjs` | six OK |

## 3. Verified correct

- **Formula (1′)**: G_eff = (1 − p_sdc)·Φ·(1 − δ/τ − (Σλᵢrᵢ + F + Q_other)/3600) closes on the engine while the headline is first order (asserted to 1e-9). The ledger identity holds algebraically: downtime + save + rollback = 1 − (1 − p)g and slowdown + local + blocked + overhead = (1 − p)g(1 − Φ), so the seven lines sum to 1 − G_eff.
- **Delivered against effective**: the ledger's per-window `effective` = delivered + (discovery rollback + terminal discard)/T, the same split as the closed form's G_del = G_eff − sdcRollback − terminal; an immediately detected corruption's rollback stays a loss of G_eff on both sides.
- **Formula (2′)**: B = 3600(1 − δ/τ − G*/Φ′) − F − Q_other inverts (1′); the three terms and B sum to 3600(1 − G*). The 500k conclusion of the 950 page reproduces: saves 90.0 + other classes 7.5 + factors 9.9 against the budget 54.0 gives B = −53.4 s/h.
- **Formula (3′)**: U_ℓ = (1 − p_sdc)(C_ℓ + Q_ℓ)/3600 in the first-order regime; Table 2's cluster row (80.01 s/h → 2.22 pt) checks.
- **Printed formulas**: (1′)–(6′) on the Methodology page match the code.
- **Infeasible path**: the all-moves design at k = 1 and the ceiling at k = 1e-3; the manual's values (97.45 / 97.01 / 96.53 / 95.08 % derated, ceilings 97.49 / 97.44 / 97.39 / 97.22 %) match `results.json`.
- **Studies**: the stored Shapley means reproduce exactly from the code (seed 1, 300 permutations).
- **Fixed checkpoint period**: every topology template fixes τ (300 s, or 60 s with C-FAST), which (2′) assumes. With Young's interval instead (not used by the records) the MTBF end is about 2.5 % conservative in k.
- **Earlier fixes**: the suites are green apart from F2.

## 4. Findings

### F1 — Formula (2′) declares an unreachable target reachable in the exact-renewal regime (High)

`requirementFromKpi` takes Φ′ = G_eff / (1 − S) with S the first-order loss sum (`strategy/requirement.ts:65–66`). While the headline is first order this equals the product of the throughput factors. When today's derated design is in the exact-renewal regime, G_eff is the exact renewal value, which exceeds 1 − S, so Φ′ > 1 (1.02–1.17 below), the factors term 3600·G*(1/Φ′ − 1) turns negative and B is inflated. The worse the hardware, the larger B.

Derated requirement at 98.5 %, record rates multiplied by m (synthetic):

| Case | Headline (derated) | G_eff,der today | B (code), s/h | Verdict printed | Factors term, s/h | G_eff,der with perfect hardware |
|---|---|---|---|---|---|---|
| native950 500k ×2 | first order | 87.57 % | −56.0 | unreachable | +12.5 | 97.09 % |
| native950 500k ×3 | exact renewal | 84.81 % | +25.0 | reachable, MTBF ≥ 4.37 h | −68.6 | 97.09 % |
| native950 500k ×4 | exact renewal | 81.30 % | +80.1 | reachable, MTBF ≥ 1.37 h | −123.6 | 97.09 % |
| cm384 500k ×2 | exact renewal | 87.41 % | −5.7 | unreachable | −38.8 | 97.03 % |
| cm384 500k ×3 | exact renewal | 83.18 % | +46.6 | reachable, MTBF ≥ 2.47 h | −91.1 | 97.03 % |
| cm384 500k ×4 | exact renewal | 79.30 % | +119.4 | reachable, MTBF ≥ 0.96 h | −163.9 | 97.03 % |

The derated saves alone cost 2.5 % against a 1.5 % budget, so no hardware reaches 98.5 %. The page would still print an MTBF requirement, and beside it the plan side (computed on the engine) prints "no plan reaches the goal … 97.03 % even with perfect hardware": the effective-mode conclusion joins both sentences (`packages/reports/src/findings.mjs:129–135`). The same B reaches Table 1, the web Report tab, `hacd budget`, `hacd scenario report` and the ingest delta. With Φ′ = (1 − p_sdc)·Φ, the product the docstring and §30.1 describe, B is negative in every row above. The committed pages are not affected (every derated block of the four records is first order), but internal inputs with hardware rates about two to three times the public ones at 500k are.

Direction: take Φ′ from the product of the factors (kpiForm already carries `factor` and `pauseFrac`), or solve the two ends on the engine in the exact-renewal regime and print the regime.

### F2 — The test suite is red: the mechanism-set worksheet drops `prune.metric` (High)

`packages/importers/test/worksheet.test.ts:66` ("record round trips › mechanism set, complete form (no base)") fails: the round trip loses `prune.metric: 'effective'`. The worksheet writer emits only the threshold in the prune table (`packages/importers/src/worksheet/mechanisms.ts:127`), the reader refuses any other prune field (`mechanisms.ts:92`), and the field added in v5.6 (`packages/core/src/records/mechanismSet.ts:69`) has no worksheet cell. A delta-form worksheet inherits it from its base; a complete form loses it.

Effect: `mechanismHierarchy` falls back to the A_op rule (`study/hierarchy.ts:71`) and, on the stored studies, throws "verdict rule mismatch for R-FABRIC-DEGRADE: rule candidate, set pruned", so `hacd findings` fails on any set authored or promoted as a complete worksheet. Because the root `npm test` chains the workspaces with `&&`, the agent, reports and CLI suites do not run (they pass alone). The v5.6 commit message says all suites pass. The prune table's description still reads "pruning threshold (A_op / delivered Shapley fraction)" (`mechanisms.ts:139`).

### F3 — C-ASYNC is a G_eff candidate that lowers G_eff in every allocated design (Medium)

C-ASYNC sets δ = min(δ, 1.15 s) and adds a 10 s durable lag to every rollback (`packages/core/src/mechanisms/auditLibrary.ts:230`). The reference baseline already holds C-FAST (τ = 60 s, δ = 1 s), so on every design the allocation builds C-ASYNC changes no save and only lengthens the recompute per rollback, W = 30 → 40 s (45 s derated).

Change of G_eff from adding C-ASYNC, points (nominal / derated):

| Record, scale | On today's design | In the all-moves design at k = 1 |
|---|---|---|
| native950 10k | −0.003 / −0.004 | −0.002 / −0.003 |
| native950 500k | −0.131 / −0.215 | −0.098 / −0.170 |
| ubl128 500k | −0.122 / −0.202 | −0.098 / −0.168 |
| cm384 500k | −0.152 / −0.249 | −0.117 / −0.201 |
| a3server 500k | −0.149 / −0.243 | −0.117 / −0.200 |

Its effective Shapley at 500k (0.17–0.20 pt, just above the 0.15 pt threshold) is earned in coalitions without C-FAST: the study puts the reference set among the players on the bare scenario, where τ = 300 s and δ = 4 s (`study/archStudy.ts:97–98`). At native950 500k C-ASYNC's marginal value is +0.449 pt without C-FAST and −0.385 pt with it; with the rest of the reference set on, +0.770 against −0.131. The allocation never builds a design without the reference set.

The 950 Findings page contradicts itself: the mechanism card gives C-ASYNC "effective goodput +0.17–0.20 pt: the shorter save blocking outweighs the 10 s durable lag", while Table 4 gives it −0.098 pt in the 500k design and Table 2's recompute per interruption rises 30 → 45 s (derated). The printed all-moves G_eff (95.08 % derated, native950 500k) is 0.17 pt below the same design without C-ASYNC (95.25 %).

Direction: judge a candidate by its value on top of the reference set (the designs the allocation can build), for example a Shapley over the non-reference players with the reference set in the base.

### F4 — The acceptance metric is the first-order G_eff (Medium)

The acceptance value is the headline effective goodput, first order while the regime flags are "ok" (`scenario/evaluate.ts:641`), which they are for every block of the report set. The window rule (6′) tests the ledger's per-window value, which follows the exact model:

| Today, nominal | First order (published) | Exact renewal | Ledger mean ± 95 % |
|---|---|---|---|
| native950 10k | 98.240 % | 98.269 % | 98.270 ± 0.008 % |
| native950 500k | 93.703 % | 93.963 % | 93.977 ± 0.054 % |
| cm384 500k | 93.006 % | 93.328 % | 93.301 ± 0.056 % |

A_op, by contrast, agrees with the ledger (native950 500k: 96.146 % against 96.151 ± 0.052 %). On the derated designs the bias is 0.06 pt at 10k, 0.38–0.46 pt for today's designs at 500k and 0.14–0.15 pt for the 500k all-moves designs. Even at 10k the save term is first order: δ/τ = 2.5 % derated against δ/(τ + δ) = 2.44 %.

On the A_op basis the closed form was exact; v5.6 makes a first-order approximation the acceptance yardstick, with an error at 500k larger than the pruning threshold (0.15 pt), and the mean rule and the window rule now test different numbers. The goldens G1e–G6e pin the closure to the engine's first-order value, so they cannot see this. No verdict changes here: every scale misses 98.5 % by more than 1 pt.

Direction: accept on the exact renewal (keeping the loss form for attribution and budgets), tighten the flags for the acceptance metric, or print the bias.

### F5 — Sub-health slowdown at the worst class's performance (Medium, latent)

The closed form sets the job's performance factor to 1 − P(any unit slowed)·(1 − min over classes of φ) (`scenario/evaluate.ts:463–476`); the ledger applies each slowed unit's own class φ (`mc/ledger.ts:312`). MODEL_REFERENCE.md states the straggler law for one φ, where it is exact ("any slow unit slows the step to φ"); the multi-class minimum is not documented.

On `atlas950Training`, P(slowed) = 0.264, mostly UB optical links (φ = 0.997) and L1 switches (0.952), all charged at the NPU's 0.70: slowdown 6.91 % closed against 1.45 % in the ledger, G_eff 80.41 % against 86.24 %. The records give every sub-health class φ = 0.95, so the report set is unaffected; a project or internal input with per-class φ is not. The approximation dates from v2, but it now sits on the acceptance path because G_eff includes the slowdown and A_op did not.

Direction: 1 − Σ_c P(class c slowed)·(1 − φ_c) to first order (or the minimum over the slowed set), which matches the ledger.

### F6 — The v5.6 verdict changes sit within the sampling error (Low–Medium)

Effective Shapley at 500k with its 95 % half-width, recomputed with the study's own sampler (the means equal the stored ones):

| Mechanism | native950 | cm384 | Margin to 0.15 pt |
|---|---|---|---|
| C-ASYNC (candidate) | 0.197 ± 0.046 | 0.170 ± 0.045 | +0.020 pt at cm384 = 0.45 half-widths |
| R-FABRIC-DEGRADE (pruned) | 0.130 ± 0.030 | 0.175 ± 0.038 | −0.020 pt at native950 = 0.68 half-widths |
| D-HARD, for contrast | 0.303 ± 0.013 | 0.314 ± 0.018 | ≥ 9 half-widths |

The studies store only the A_op half-width (`archStudy.ts:98` runs the study on 'aOp'; `study/index.ts:268`), so the rule compares point estimates (`study/prune.ts:71`). The rule's own note, that the threshold sits above the half-width, holds for A_op (about 1e-9) but not for G_eff (0.01–0.07 pt). Both verdicts could flip under another seed.

Direction: store the effective half-width and re-sample a verdict that falls within it, as the note asks for borderline verdicts.

### Minor

- **M1 — p_sdc in (2′) and (3′)**: (2′) keeps the episode pauses inside Φ′, so the printed "throughput factors (sub-health slowdown, local loss, blocked spares, mechanism overhead)" term includes them (`requirement.ts:86` text); (3′) books them under the other classes (`layers/index.ts:171`). At most 0.006 pt.
- **M2 — blocking in the per-window value**: the ledger simulates no spare-pool blocking, so `LedgerReplication.effective` (`mc/ledger.ts:437`) omits P_blocked. `workedExample3` (P_blocked 0.30 %): closed 96.77 %, ledger 97.10 %. The records have P_blocked 0.
- **M3 — strategy split weights**: `contributions` = λ t̄ on every metric (`strategy/index.ts:246`); on G_eff a class's share of the loss is λ(t̄ + P_rb W). ARINC is unaffected (the weights cancel); the min-effort and AGREE splits mis-weight by r/t̄ = 1.11 for the rollback classes against 1.00 for CORE-hard on the records.
- **M4 — Table 4 on G_eff**: the per-layer column is "pause removed" (`budget/index.ts:210`), so C-ASYNC and C-FAST show "< 0.05" while their G_eff gains are −0.098 and −0.134 (native950 500k); C-ASYNC's parameters print as raw keys with 1.15 s rounded to 1.2 ("blockingTargetSeconds 1.2 · durableLagSeconds 10").
- **M5 — exact-renewal docstring**: `budget/kpiForm.ts` and §30.1 say the form is "the first-order budget" in that regime; the code mixes the exact G_eff into Φ′ (F1).
- **M6 — text**: §30.2 quotes "every candidate and lever on at 10k: 98.21 % / 97.31 %", while the stored all-moves designs give 98.30–98.31 % / 97.44–97.46 % (and the 23-player all-on 98.18–98.19 % / 97.27–97.29 %); the Findings conclusion repeats "the checkpoint period / save time (τ, δ) or the target must change first" when B ≤ 0 and no plan exists (`findings.mjs:118` and `:122`); `KpiRow.B` is documented as the "hardware pause budget (formula 2)" (`ingest/diff.ts:94`) though on the effective basis it is the loss budget of (2′).

## 5. Unchanged by decision

- G_eff is the acceptance metric at 98.5 % and G_del is reported beside it (user, 2026-10-28).
- C-FAST's fixed 60 s / 1 s saves stay and the 98.5 % goal is accepted as unreachable (user, 2026-10-29). Table 4 already prints what the saves cost in the final designs (C-FAST's G_eff gain −1.26 pt at 10k, −0.13 pt at native950 500k); this review does not reopen the decision.
- Order-dependent pairs C-FAST × C-MEM and R-ELASTIC × R-HCCL-ELASTIC stay documented (§22.4.1).

## Appendix — reproduction

Scratch scripts run with `node --import tsx <file>.mts` from the repository root; synthetic public records only.

```ts
// F1: formula (2′) on a derated design in the exact-renewal regime
const R = './packages/core/src';
const { recordScenario } = await import(`${R}/budget/index.ts`);
const { BUILTIN_TOPOLOGY_RECORDS } = await import(`${R}/records/topologyRecord.ts`);
const { DEFAULT_MECHANISM_SET } = await import(`${R}/records/mechanismSet.ts`);
const { requirement } = await import(`${R}/strategy/requirement.ts`);
const { withHardwareFactors } = await import(`${R}/strategy/index.ts`);
const { deratedOf } = await import(`${R}/strategy/window.ts`);
const { DERATE_DEFAULT } = await import(`${R}/mechanisms/plan.ts`);
const { trainingOf } = await import(`${R}/budget/kpiForm.ts`);
const atK = (s, k) => withHardwareFactors(s, Object.fromEntries(s.components.filter((c) => c.enabled && c.failure.value > 0).map((c) => [c.id, k])));
const s = atK(recordScenario(BUILTIN_TOPOLOGY_RECORDS.cm384, DEFAULT_MECHANISM_SET, 500000), 4);
const q = requirement(s, 0.985, DERATE_DEFAULT, 'effective');
console.log(q.B, q.reachable, q.terms);                                                // 119.4, true, factors −163.9
console.log(trainingOf(atK(deratedOf(s, DERATE_DEFAULT), 1e-3 / 4)).effectiveGoodput); // 0.9703
```

```bash
# F2
npm test -w @hac-d/importers
```

- **F3**: `applyMechanisms(recordScenario(…, n), ['C-ASYNC'], …)` against the baseline, nominal and through `deratedOf`; the coalition values on `stripMechanisms(s, baseline)` with and without C-FAST; `recommended.removal['C-ASYNC'].effective` in `docs/backup/ascend-allocation/results.json`.
- **F4, F5, M2**: `buildLedgerRun(s, { trials: 400, seed: 1 })` and `simulateLedgerReplications` against `trainingOf(s)`; the exact value is `renewalGoodput × (1 − P_blocked) × φ_perf × (1 − ℓ_local) × (1 − o) × (1 − p_sdc)`; `atlas950Training` and `workedExample3` from `scenario/examples.ts`.
- **F6**: `allocationStudy(bare, { sizes: [500000], metric: 'effective', players, parameters, seed: 1, permutations: 300, trials: 0, levers: false, curves: false })` with the players and the bare scenario of `studyOfBuild`; `halfWidth` is then the effective one.

## 6. Resolution (2026-10-29)

Fixed in e6a3443 ("v5.7: sixth model review fixed …") on the report owner's request; specification `MODEL_REFERENCE.md` §31, regression tests `packages/core/test/model_review_v57.test.ts` and the worksheet round trip in `packages/importers/test/worksheet.test.ts`.

| Item | Fix | Where |
|---|---|---|
| F1 | Φ′ = (1 − p_sdc)·Φ, the product of the throughput factors; B is the first-order budget at the target. The cm384 500k case at 4× rates now reads unreachable (factors term ≥ 0) | `strategy/requirement.ts`; §31.2 |
| F2 | the prune table of the mechanism-set worksheet carries `metric`; both forms keep it; an unknown metric is refused | `importers/src/worksheet/mechanisms.ts` |
| F3 | a candidate (and a goodput-only mechanism) needs a gain on top of the reference set on every architecture; the studies store `onReference` | `study/archStudy.ts`, `study/prune.ts`, `study/hierarchy.ts`, `hacd prune`; §31.5 |
| F4 | the accepted value is the exact-renewal effective goodput (`effectiveGoodputExact`, `deliveredGoodputExact`, `ledgerExact`) wherever a goodput is a value function; the loss form closes on the engine's first-order value in every regime | `scenario/evaluate.ts`, `budget/kpiForm.ts`, `mechanisms/index.ts`, `strategy/index.ts`, `study/index.ts`, `mechanisms/plan.ts`; §31.1 |
| F5 | the straggler law over classes, each slowed unit at its own class's φ (`atlas950Training` slowdown 7.9 % → 1.41 %, ledger 1.45 %) | `ctmc/repair.ts` `stragglerLawClasses`; §31.3 |
| F6 | the studies store every metric's half-width; each verdict carries `resolved` and `margin`; the committed studies use 1200 permutations | `study/index.ts`, `study/prune.ts`; §31.5 |
| M1 | the episode pauses p_sdc with the other classes in (2′), as in (3′) | `strategy/requirement.ts` |
| M2 | the window ledger books the spare-pool blocking (`blocked`) | `mc/ledger.ts`, `mc/ledgerFromScenario.ts`; §31.4 |
| M3 | the strategies weight the hardware split by the loss on the goodput metrics | `strategy/index.ts` |
| M4 | Table 4's per-layer column is the loss removed (pause + recompute) on the goodput basis; parameter labels and decimals | `budget/index.ts`, `reports/src/findings.mjs` |
| M5 | the docstrings say what the loss form is in every regime | `budget/kpiForm.ts`, `strategy/requirement.ts` |
| M6 | §30.2's numbers restated from the regenerated data; the advice printed once; the `KpiRow.B` comment | `MODEL_REFERENCE.md` §30.2, `findings.mjs`, `ingest/diff.ts` |

Effect on the report set (regenerated from f76cfec: `hacd study --permutations 1200` for the four records, `hacd findings`, the v5 goldens, the manual):

| Change | Value |
|---|---|
| C-ASYNC | candidate → pruned by the reference test (−0.12 to −0.15 pt effective goodput on top of the reference set at 500k) |
| other verdicts | unchanged, all resolved (8.6 to 317 half-widths from the threshold, or decided by the reference test) |
| feasibility at 98.5 % | unchanged: no plan at any scale; B unchanged to 0.1 s/h |
| native950 500k, derated | today G_eff 92.33 → 92.70 %, all-moves design 95.08 → 95.38 %, ceiling 97.22 → 97.29 % |
| native950 10k, derated | today G_eff 97.40 → 97.46 %, all-moves design 97.45 → 97.52 %, ceiling 97.49 → 97.56 % |
| other records, 500k all-moves derated | ubl128 95.11 → 95.41 %, cm384 94.72 → 95.07 %, a3server 94.75 → 95.10 % |

The accepted values rise by the first-order bias that F4 removed, and the all-moves designs also by the lag C-ASYNC no longer adds. `node packages/reports/test/reproduce.mjs` prints six OK; the goldens report no findings; every suite passes.
