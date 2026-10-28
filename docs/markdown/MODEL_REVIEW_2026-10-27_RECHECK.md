# HAC-D model review — recheck of the fixes (2026-10-27)

| | |
|---|---|
| Scope | The fixes for the fifth review (`docs/markdown/MODEL_REVIEW_2026-10-27.md`, findings D1–D9, M1–M3, R1–R4), made in another session; its resolution notes are §7 of that document |
| Code | uncommitted v5.5 working tree on `main` at f903fdb: 46 changed files, the new test `packages/core/test/model_review_v55.test.ts` and three new golden input tables |
| Method | every check of the review re-run on the fixed tree (synthetic public scenarios only); the v5 goldens regenerated from their scripts and compared; a Findings page rendered with an out-of-reach requirement; the seven reproduction snippets of the review re-run |
| Status | Reported by the recheck without changing the repository; **resolved 2026-10-27** (section 7: N1, N2, N3 fixed with tests; the order dependence of section 5 removed for the same-stage rule and the custom rungs; R1 and R4 still decisions) |

## 1. Summary

Most findings are fixed. The D2 fix introduced one new error (N1), one related gap remains in both input paths (N2), the resolution note overstates the D2 fix (N3), and three items stay open by documented decision.

| Finding | Status after the fixes |
|---|---|
| D1 audited mechanisms through the project editor | **fixed** |
| D2 device-table importer units | **reported cases fixed; new error N1, gap N2, note N3** |
| D3 set recovery baseline | **fixed** |
| D4 MTTR split with per-class stages | **fixed** |
| D5 derated twin order | **fixed for the twin**; the order dependence of six pairs is documented, not removed (section 5) |
| D6 negative requirement when B ≤ 0 | **fixed** |
| D7 fewer than 35 window trials | **fixed** |
| D8 project study parameters | **fixed** |
| D9 scale-out toggle | **fixed** |
| M1 formula (3) denominator, M2 layer split of detected corruption, M3 doc comment | **fixed** |
| R1 success lever dead under derating | **open**, documented as a decision for the report owner |
| R2 BOXIO-hard predictor applicability | **fixed** |
| R3 v4 section of the spec | **fixed** (`MODEL_REFERENCE.md` §28, with §22.4.1 and §29) |
| R4 derated D-HARD below the baseline | **open**, documented as a decision for the report owner |

## 2. Baseline of the fixed tree

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | core 867 / 867 (40 files), importers 53, agent 36, reports 43, CLI 13: all pass |
| `node packages/reports/test/reproduce.mjs` | 6 OK |
| `npm run build -w @hac-d/web` | built |
| v5 goldens regenerated (`dump_inputs_v5.mjs`, then `compute_golden_v5.py` under Python 3.12) | input tables identical; expected values equal to the committed file within 2.5e-16 relative (the only larger relative differences are in the `engineMeanPauseMaxRelDiff` diagnostics, both sides about 1e-16); not hand-edited |
| v5 goldens against the last commit | 7 new cases; every pre-existing expected value moved by at most 2.5e-16 relative; the new per-class case derives gᵢ = G − (A − Aᵢ) from the spec and the input stages, independent of the engine's new chain-row field |

## 3. Fixes verified

A3 · CloudMatrix384 unless stated. A_op = nominal closed form over the 30-day job window; points = percentage points of A_op or delivered goodput.

| Finding | Check on the fixed tree | Result |
|---|---|---|
| D1 | each of the 15 audited mechanisms applied alone through `editMechanisms` at 100k | all recorded, with the default set's parameters, and all change the KPIs (e.g. R-LINK-LOCAL +0.1087 pt A_op, D-SDC-FP8 +0.9416 pt delivered); `eligibleShare: 0.8` accepted and recorded; R-HCCL-ELASTIC without R-ELASTIC refused with the reason |
| D3 | cm384 record at 100k, set with automatic 90 s at 99.5 % and manual 3,600 s | `recordScenario` carries 90 s / 0.995 / 3,600 s, A_op 99.5388 %; the default set still gives 180 s and 99.0853 % |
| D4 | `mttrDecomposition` with R-RUNTIME-SNAPSHOT, R-WARM-PROCESS, R-CANN-GRAPH, and with all three plus C-LOSSLESS and C-MEM | closes in every case at 100k and 500k (MTTR 87.8496 s, 88.4378 s, 90.4496 s, 68.4584 s); stage sum = global attempt; `hierarchicalBudget` runs with R-RUNTIME-SNAPSHOT applied |
| D5 | C-MEM applied before C-FAST; D-SDC applied after D-SDC-DMR | derated twin δ 1.5 s (the derated C-FAST, applied last); D-SDC-DMR then D-SDC gives coverage 0.999 nominal and 0.949 derated in either order; the report no longer throws |
| D6 | `requirement` at 500k, A* 99.8 % | B = −1.692 s/h, `reachable` false, MTBF / MTTR / factors null; a Findings page rendered with B ≤ 0 at two scales shows the out-of-reach sentence in the conclusion and no NaN, null or negative MTBF |
| D7 | `minWindowTrials(0.9)`; `recommendPlan` with 20 windows; web field | 35; refused with the minimum named; the Report tab's field has minimum 35 |
| D8 | project with D-SDC at coverage 0.95 or 0.6, C-MEM applied | D-SDC Shapley (delivered) 15.0544 pt vs 8.5142 pt; `projectParameters` lists D-SDC; `fixed` lists C-MEM |
| D9 | R-LINK-LOCAL applied, scale-out off then on | 2 `@roce` classes carry the rung before and after; A_op 0.9919406 both |
| M1 | P-PREDICT at 100k | Σ U_ℓ 1.074699 pt = the exact value |
| M2 | D-ABFT at 100k | NPU-layer detected-corruption pause 0.012810 s/h = the split by detected rate |
| R2 | calibration scenario vs the catalog at 100k | no applicability difference; with P-PREDICT A_op 0.975940994 vs 0.975941004 (the 1e-8 is the count rounding at a size that is not a whole number of pods) |

The seven reproduction snippets of the review now show the fixed behaviour (D1 recorded, D2 572 FIT and 2,500 FIT, D3 90 s, D4 no throw, D5 δ 1.5 s, D6 null ends).

## 4. New findings

### N1 — A percentage typed in a value cell is read as a fraction (new error from the D2 fix)

**Where.** `packages/importers/src/worksheet/deviceTable.ts:100` strips `%` from the value text (`replace(/[,\s%]/g, '')`); the factor 0.01 is applied only when the header (`UNIT_FROM_HEADER`, line 38) or the unit cell (`UNIT_TEXT`, line 47) marks a percentage.

**What.** A value cell such as `0.5%` under a header that names the AFR without a percent sign (`AFR`, `Annual failure rate`, `年化失效率`) is accepted as the fraction 0.5. Before the fix the same row was skipped with "rate '0.5%' is not a number", so the error used to be visible and is now silent. A `%` under a unit that is not an AFR (`5%` under `FIT`) is dropped and the row accepted.

**Evidence.** One-row synthetic sheets through `deviceTableFromSheet`, then `deviceFit` (device FIT = failures per 10⁹ device-hours, all failure modes).

| Header | Value cell | Read as | Device FIT | Intended |
|---|---|---|---|---|
| `AFR` | `0.5%` | afr 0.5 | 79,126 | 572 (AFR 0.005) |
| `Annual failure rate` | `0.8 %` | afr 0.8 | 183,730 | 917 (AFR 0.008) |
| `年化失效率` | `0.3%` | afr 0.3 | 40,716 | 343 (AFR 0.003) |
| `FIT` | `5%` | FIT 5 | 5 | refuse the row |

The agent's extraction path already handles this input: `packages/agent/src/draft.ts:138` divides an AFR by 100 when `%` appears in the unit text or the value text.

**Impact.** Wrong device FIT, 119× to 200× too high for typical DIMM, SSD and HDD rates, reaches the normaliser and the override; only the plausibility envelope (×0.1 … ×10 of the unit library, level warning) flags it after the mapping.

**Suggested fix.** Treat `%` in the value cell as the percent marker: for an AFR multiply by 0.01 and record the value as written, as the agent path does; for any other unit refuse the row ("a percentage is not a FIT / MTBF / rate per hour").

### N2 — MTBF stated in millions of hours is misread (both input paths)

**Where.** Importer header rules `packages/importers/src/worksheet/deviceTable.ts:38–45` (the per-10⁶-h rule matches `百万` before the MTBF rule; the MTBF rule has no multiplier); the agent's unit lexicon `packages/agent/src/draft.ts:116–121` (`百万小时` anywhere maps to per 10⁶ h; `MTBF (million hours)` maps to MTBF in hours).

**What.** Datasheets often give MTBF in millions of hours. A header or unit that says so is read either as a failure rate per 10⁶ hours (the inverse quantity) or as MTBF in hours (off by 10⁶). This was not one of the reported D2 cases; the zh form changed from MTBF-in-hours to per-10⁶-h with the new rule order and is wrong either way.

**Evidence.**

| Path | Text | Read as | Value 2 → device FIT | Intended (MTBF 2 × 10⁶ h) |
|---|---|---|---|---|
| importer header | `MTBF（百万小时）` | per 10⁶ h | 2,000 | 500 |
| importer header | `MTBF (million hours)` | MTBF h | 5.0 × 10⁸ | 500 |
| agent unit text | `MTBF（百万小时）` | per 10⁶ h | 2,000 | 500 |
| agent unit text | `MTBF (million hours)` | MTBF h | 5.0 × 10⁸ | 500 |
| agent unit text | `万小时` | not recognised (row refused) | — | 50 for MTBF 2 × 10⁴ h |

For a value v the per-10⁶-h reading gives 1,000·v FIT where the MTBF reading gives 1,000 / v FIT, so the error is not a fixed factor.

**Suggested fix.** Recognise an MTBF / MTTF / 平均无故障 header or unit with a multiplier (`百万小时`, `万小时`, `million hours`, `10^6 h`, `kh`) as MTBF times that multiplier, before the per-10⁶-h rule; keep the per-10⁶-h rule for rate wording only (`失效率`, `failure rate`, `per`, `每`); add both spellings to the importer test and to golden G7.

### N3 — The resolution note overstates the D2 fix

§7 of `MODEL_REVIEW_2026-10-27.md` lists "`%` in the cell" among the forms divided by 100. That holds only when the header or the unit cell also marks a percentage (the importer test's case `h`: value `3 %` with unit `% per year`); a `%` in the value cell alone gives N1. The note should follow the fix of N1.

## 5. Open by decision or documented

| Item | State on the fixed tree | Documented where |
|---|---|---|
| R1 success lever | the derated lever value is still 0.99, equal to today's 0.99, so the lever cannot gain on the derated side (`strategy/index.ts`, `applyLevers`) | review §7: decision for the report owner, because derating the failure probability instead can change the 200k / 500k plans |
| R4 derated D-HARD | coverage 0.999 − 0.05 = 0.949, below the baseline 0.95 (`mechanisms/plan.ts`) | review §7: decision, about 0.002 pt of A_op at 500k and a small change of k |
| D5 order semantics | the derated twin is consistent; the nominal design still depends on the order of application for six pairs (below) | `MODEL_REFERENCE.md` §22.4.1 |

Pairs whose two orders still differ (A3 at 100k with the six default mechanisms; |ΔA_op| or |Δdelivered| > 1e-12, fractions). D-SDC × D-SDC-DMR no longer appears.

| Pair | \|ΔA_op\| | \|Δdelivered\| |
|---|---|---|
| C-FAST × C-MEM | 7.7e-11 | 8.0e-3 |
| R-LINK-LOCAL × R-FABRIC-DEGRADE | 0 | 1.3e-3 |
| R-ELASTIC × R-HCCL-ELASTIC | 0 | 2.2e-5 |
| R-WARM-PROCESS × R-RUNTIME-SNAPSHOT | 2.1e-5 | 2.1e-5 |
| R-WARM-PROCESS × R-CANN-GRAPH | 1.2e-5 | 1.2e-5 |
| R-RUNTIME-SNAPSHOT × R-CANN-GRAPH | 1.2e-5 | 1.2e-5 |

For the startup-stage pair the order matters for accuracy, not only for consistency: the same-stage rule new = current − share·(current − cand) is the expectation over both mechanisms only when the larger target is applied first.

| Order | UNKNOWN-hard startup stage | A_op (100k) |
|---|---|---|
| R-WARM-PROCESS, then R-RUNTIME-SNAPSHOT | 15.35 s (the expectation) | 99.1354 % |
| R-RUNTIME-SNAPSHOT, then R-WARM-PROCESS | 17.25 s | 99.1333 % |

Library order applies R-WARM-PROCESS first, so the reports are exact; a project that applies the two in the other order understates the saving.

## 6. Minor note

The new per-class golden (`chain.a3server-10k.snapshot`) has no recovery scale law (T_auto(N) = A), so the scaled branch of the new chain-row code (stage times × T_auto(N)/A) is checked only by the engine's own closure identity. The topology scenarios carry no scale law, so the reports are not affected.

## Appendix — reproduction

Run from the repository root with `node --import tsx <file>.mts`.

```ts
// N1: a percentage in the value cell
const { deviceTableFromSheet } = await import(`${process.cwd()}/packages/importers/src/worksheet/deviceTable.ts`);
const { deviceFit } = await import(`${process.cwd()}/packages/core/src/ingest/koujing.ts`);
const sheet = (rows: (string | number)[][]) => ({ name: 'x', rows: rows.length, cols: rows[0].length, merges: [], outline: rows.map(() => 0),
  cells: rows.flatMap((r, i) => r.map((value, j) => ({ sheet: 'x', addr: '', row: i, col: j, value }))) });
const t = deviceTableFromSheet(sheet([['Device', 'AFR', 'Source'], ['DIMM', '0.5%', 'v']]) as never, { id: 't', sourceType: 'vendor' }).table.rows[0];
console.log(t.unit, t.value, deviceFit(t)); // afr 0.5 79126… (intended 0.005 → 572)
```

```ts
// N2: MTBF in millions of hours, importer and agent
const { deviceTableFromSheet } = await import(`${process.cwd()}/packages/importers/src/worksheet/deviceTable.ts`);
const { deviceRateUnit } = await import(`${process.cwd()}/packages/agent/src/draft.ts`);
const sheet = (rows: (string | number)[][]) => ({ name: 'x', rows: rows.length, cols: rows[0].length, merges: [], outline: rows.map(() => 0),
  cells: rows.flatMap((r, i) => r.map((value, j) => ({ sheet: 'x', addr: '', row: i, col: j, value }))) });
for (const h of ['MTBF（百万小时）', 'MTBF (million hours)']) {
  console.log(h, deviceTableFromSheet(sheet([['Part', h, 'Source'], ['PSU', 2, 'v']]) as never, { id: 't', sourceType: 'vendor' }).table.rows[0].unit, deviceRateUnit(h));
} // per_1e6_h per_1e6_h / mtbf_h mtbf_h
```

```ts
// D5 residual: the startup-stage pair in both orders
const R = `${process.cwd()}/packages/core/src`;
const { topologyScenario } = await import(`${R}/topology/index.ts`);
const { applyMechanismsInOrder } = await import(`${R}/mechanisms/index.ts`);
const { resolveMechanismSet, DEFAULT_MECHANISM_SET } = await import(`${R}/records/mechanismSet.ts`);
const P = resolveMechanismSet(DEFAULT_MECHANISM_SET).parameters;
const s = topologyScenario('a3-ub384', 100000);
const st = (ids: string[]) => applyMechanismsInOrder(s, ids, P).components.find((c) => c.id === 'UNKNOWN-hard')!.recoveryStages?.startup;
console.log(st(['R-WARM-PROCESS', 'R-RUNTIME-SNAPSHOT']), st(['R-RUNTIME-SNAPSHOT', 'R-WARM-PROCESS'])); // 15.35 17.25
```

## 7. Resolution (2026-10-27)

| # | Fix | Where | Tests |
|---|---|---|---|
| N1 | a `%` in the value cell is the percent marker: an AFR is divided by 100 and the note keeps the value as written (`0.5% read as afr 0.005`); under any other unit the row is skipped with "a percentage ('5%') is not a FIT value …". The agent's draft does the same (a percent under a non-AFR unit is listed in the notes, not placed) | `importers/src/worksheet/deviceTable.ts`, `agent/src/draft.ts` | `importers/test/worksheet.test.ts`, `agent/test/e2e.test.ts` |
| N2 | an MTBF / MTTF / 平均无故障 header with a duration multiplier (`百万小时`, `million hours`, `10^6 h`, `十万小时`, `万小时`, `千小时`, `kh`) is MTBF × that multiplier, tried before the per-10⁶-h rule; a unit cell with a bare multiple of hours is a duration, one with "per" / "每" / "/" a rate; the agent's lexicon (`deviceRateUnitFactor`) returns the factor and the draft multiplies the value with the note `2 百万小时 → 2000000 h (×1000000)` | same files | same files (headers, unit cells, the factor table; golden G7c already pins 2 × 10⁶ h MTBF → 500 FIT) |
| N3 | the resolution note of D2 rewritten after N1 / N2; `MODEL_REFERENCE.md` §26.1 states the rules | `MODEL_REVIEW_2026-10-27.md` §7 | — |
| D5 residual (section 5) | the same-stage rule is the per-event expectation over the applied same-stage mechanisms, E = Σ_k c_(k) a_(k) Π_{j<k}(1 − a_(j)) + Π(1 − a_j)·base with the candidates sorted ascending (`sameStageValue`, `MODEL_REFERENCE.md` §24.2): the startup trio gives 15.2966 s on UNKNOWN-hard in all six orders (shares 0.95), the pairs 15.35 / 16.18 / 20.93 s in both orders, singles as before (22 / 17.25 / 38.625 s), removal exact in any order; custom rungs are tried in the canonical order `CUSTOM_RUNG_ORDER` by the closed form, the MTTR split and the window ledger, so R-LINK-LOCAL × R-FABRIC-DEGRADE commute. Still order-dependent by design: C-FAST × C-MEM (both set the checkpoint design; the later wins) and R-ELASTIC re-applied after R-HCCL-ELASTIC (§22.4.1) | `mechanisms/auditLibrary.ts`, `mechanisms/chain.ts`, `mc/ledger.ts`, `mttr/decompose.ts`; the Python golden's chain uses the same canonical order | `core/test/model_review_v55.test.ts` (recheck blocks); `audit_v37.test.ts` unchanged (shares 1 give the minimum) |
| section 6 | noted: the scaled branch of the per-class chain row (T_auto(N)/A) has no golden because no public scenario carries a recovery scale law; the engine's closure identity covers it | — | — |

Effect on the committed report set: none — the designs apply their mechanisms in library order (larger candidate first for the startup pair; R-CANN-GRAPH is pruned), `node packages/reports/test/reproduce.mjs` prints six OK. The stored 23-player Shapley studies (`docs/backup/arch-mechanism-shapley/*.json`) were computed with the sequential rule; on the coalitions holding all three startup mechanisms the expectation lowers the startup stage of the eligible classes by 0.05 s (15.35 → 15.30 s), below 1e-7 of A_op, so they were not regenerated. *Correction (2026-10-28, `MODEL_REVIEW_2026-10-28_RECHECK2.md` N7): the shift was larger — the expectation rule also credits R-CANN-GRAPH, which the sequential rule skipped after R-RUNTIME-SNAPSHOT, on CORE / MODULE / NIC / CPU-hard (startup 17.25 → 16.18 s); A_op with all players on moved by up to 3.0e-6 at 500k. The studies were regenerated on 2026-10-28.* R1 and R4 remain the decisions recorded in the review's §7.
