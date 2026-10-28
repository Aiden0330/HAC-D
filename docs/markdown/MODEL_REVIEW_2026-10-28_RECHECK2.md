# HAC-D model review — second recheck of the fixes (2026-10-28)

| | |
|---|---|
| Scope | The fixes for the first recheck (`docs/markdown/MODEL_REVIEW_2026-10-27_RECHECK.md` §7: N1–N3 and the D5 residual), and a regression pass over D1–D9, M1–M3 and R1–R4 of `docs/markdown/MODEL_REVIEW_2026-10-27.md` |
| Code | `main` at b43e35d ("v5.5: fifth model review and its recheck resolved …"), pushed; working tree clean apart from untracked drafts |
| Method | both earlier recheck scripts re-run; new edge cases of the unit rules in both input paths (spreadsheet importer, agent draft); pairwise commutation of every appliable mechanism; the startup trio in all six orders; the stage mechanisms under the automatic-attempt lever; the stored Shapley studies against the current rule; the cm384 500k plan under a consistent lever treatment. Synthetic public scenarios only |
| Status | **Reported, not fixed.** Nothing in the repository was changed by this recheck |

## 1. Summary

Everything reported by the first recheck is fixed, and the earlier fixes still hold. R1 and R4 stay open as decisions for the report owner. This round found four new problems, N4–N7.

| Item | Status |
|---|---|
| N1 a `%` in the value cell | **fixed** |
| N2 MTBF in a multiple of hours | **fixed** |
| N3 the D2 resolution note | **fixed** |
| D5 residual (same-stage rule, custom-rung order) | **fixed**; two pairs stay order-dependent by design (section 5) |
| D1–D9, M1–M3, R2, R3 | **still fixed** |
| R1 success lever, R4 derated D-HARD | **open**, decisions for the report owner |
| N4 per-class stage mechanisms under the automatic-attempt lever | **new**, medium: wrong sign for two mechanisms, under-credit for the default candidate |
| N5 Excel percent-formatted cells divided by 100 twice | **new**, high: silent 100× underestimate |
| N6 MTBF in years read as hours | **new**, high: silent 8,760× overestimate |
| N7 stored Shapley studies no longer reproduce; the resolution note understates the shift | **new**, low: below the pruning threshold |

## 2. Baseline of b43e35d

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | core 871 / 871 (40 files), importers 54, agent 37, reports 43, CLI 13: all pass |
| `node packages/reports/test/reproduce.mjs` | 6 OK |
| `npm run build -w @hac-d/web` | built |

## 3. Fixes verified

Device FIT = failures per 10⁹ device-hours (all failure modes); A_op = nominal closed form over the 30-day job window.

| Item | Check | Result |
|---|---|---|
| N1 | `0.5%` under `AFR`; `0.8 %` under `Annual failure rate`; `0.3%` under `年化失效率`; `5%` under `FIT` | afr 0.005 → 572.21 FIT; afr 0.008 → 916.91; afr 0.003 → 342.98; the `FIT` row refused ("a percentage ('5%') is not a FIT value") |
| N2 importer | `MTBF（百万小时）` 2; `MTBF (million hours)` 2; `平均无故障时间（万小时）` 200; `MTBF (kh)` 2,000; `MTBF (10^6 h)` 2; unit cell `百万小时` 2 | all MTBF 2 × 10⁶ h → 500 FIT |
| N2 agent | `deviceRateUnitFactor` of `MTBF（百万小时）`, `MTBF (million hours)`, `万小时`, `kh`, `每百万小时` | MTBF ×10⁶, ×10⁶, ×10⁴, ×10³; per 10⁶ h |
| D2 (first round) | `%/year` unit cell; `AFR (%)` with a typed 0.8; `失效率（每百万小时）`; `每小时失效率`; `平均无故障时间（小时）`; `MTBF (h)`; `Failure rate (per million hours)` | all as intended |
| N3 | resolution note of D2 (`MODEL_REVIEW_2026-10-27.md` §7) and `MODEL_REFERENCE.md` §26.1 | rewritten; they state the rules as implemented |
| D5 residual | R-WARM-PROCESS, R-RUNTIME-SNAPSHOT, R-CANN-GRAPH in all six orders (A3 100k, UNKNOWN-hard startup) | 15.296563 s in every order; removing R-RUNTIME-SNAPSHOT equals R-WARM-PROCESS + R-CANN-GRAPH applied directly (20.93125 s); removing all three restores no override; the MTTR split closes (87.6127 s) |
| D5 residual | pairwise commutation of every appliable mechanism (A3 100k, six defaults) | 6 non-commuting pairs before, 2 now (section 5) |
| D1, D3, D4, D6–D9, M1, M2 | the first recheck's script re-run | same results as in the first recheck (the combined stage case's MTTR moved from 68.4584 s to 68.4518 s with the new stage rule; it still closes) |

## 4. New findings

### N4 — Per-class stage mechanisms under the automatic-attempt lever

**Where.** `lowerStage` (`packages/core/src/mechanisms/auditLibrary.ts:80`) writes a class's stage as absolute seconds, computed against the job's stage at the time the mechanism is applied (base at line 100, value at line 103). `applyLevers` (`packages/core/src/strategy/index.ts:140`, automatic attempt at line 146) changes `recovery.automatic.seconds` afterwards: the job's stages rescale to the new attempt (§24.2), the per-class overrides do not, and `gOf` (`packages/core/src/scenario/evaluate.ts:553`) charges the class the difference A_i − A. The lever is applied after the mechanisms in `allocateStrategy` (`strategy/index.ts:194`, `:196`), `recommendPlan` (`strategy/window.ts:119`) and the budget's rebuild (`budget/index.ts:192`).

**What.** Under a shorter attempt, a stage value computed against the 180 s attempt can exceed the new job stage. The mechanism then lengthens the recovery instead of shortening it, or is credited too little.

**Evidence.** A3 · CloudMatrix384 at 100,000 NPUs, six default mechanisms; the mechanism with the default set's parameters; lever "automatic attempt → 60 s" (job stages 20 / 20 / 20 s; derated limit 90 s). g = the class's global recovery after detection.

| Mechanism | Class | Stored startup | Job startup under the lever | g, lever alone → lever + mechanism | Derated (90 s) | Effect |
|---|---|---|---|---|---|---|
| R-CANN-GRAPH | CORE-hard | 38.625 s | 20 s | 132.00 → 150.63 s | 162.00 → 170.63 s | longer; A_op 99.4629 % → 99.4419 % |
| R-WARM-PROCESS | UNKNOWN-hard | 22.00 s | 20 s | 132.00 → 134.00 s | 162.00 → 154.00 s | longer nominally |
| R-RUNTIME-SNAPSHOT | CORE-hard, UNKNOWN-hard | 17.25 s | 20 s | 132.00 → 129.25 s | 162.00 → 149.25 s | shorter, but the startup with the lever applied to the base first is 15.25 s, not 17.25 s: credited 2.75 s instead of 4.75 s |

**Effect on the committed report set.** None of the recommended designs contains a stage mechanism. With a consistent treatment (lever on the base, then the mechanisms), the cm384 500k plan plus R-RUNTIME-SNAPSHOT reaches k 0.76600 and effort 35.38 (engine order: k 0.75880, effort 35.93), still above the chosen plan's 32.60; the chosen plan's k (0.74998) is the same under both treatments. The strategies still evaluate every plan that combines R-RUNTIME-SNAPSHOT, a default candidate, with the automatic-attempt lever with too little credit, and a project with R-CANN-GRAPH or R-WARM-PROCESS applied is penalised by that lever.

**Suggested fix.** Apply the levers to the bare design and re-apply the recorded mechanisms over it (as `editBase` does for recovery edits) in the strategies, the window rule and the budget's rebuild; or keep each per-class stage as the expectation inputs (candidates and shares) and recompute it from the current job stage whenever the attempt changes.

### N5 — Excel percent-formatted cells are divided by 100 twice

**Where.** `grid` (`packages/importers/src/worksheet/deviceTable.ts:77`) keeps only each cell's cached value. The cell's number format, which the workbook reader records (`packages/importers/src/workbook.ts:30`, `format`), is never read, and the percent factor of the header (`unitOfHeader`, line 56) or of the unit cell (scale, line 125) is applied to the cached value.

**What.** Excel stores a cell displayed as "0.5%" as 0.005. Under a header or a unit cell that marks a percentage, the importer multiplies that fraction by 0.01 again.

**Evidence.**

| Header / unit cell | Cell: cached value, format | Read as | Device FIT | Intended |
|---|---|---|---|---|
| header `AFR (%)` | 0.005, `0.0%` | afr 0.00005 | 5.71 | 572.21 |
| unit cell `%/year` | 0.005, `0.0%` | afr 0.00005 | 5.71 | 572.21 |
| header `AFR` | 0.005, `0.00%` | afr 0.005 | 572.21 | 572.21 (correct) |
| header `AFR (%)` | typed 0.8, no format | afr 0.008 | 916.91 | 916.91 (correct) |

**Impact.** A silent 100× underestimate, the opposite direction of the original D2 error. A titled `AFR (%)` column of percent-formatted cells is a common spreadsheet layout. Only the plausibility envelope (×0.1 … ×10 of the unit library, level warning) flags it, after the mapping.

**Suggested fix.** When a cell's format contains `%`, its cached value is already the fraction: skip the header's and the unit cell's 0.01, and note the format in the row; add a test with a formatted cell.

### N6 — MTBF in years is read as hours

**Where.** Importer: the MTBF rules (`MTBF_WORD` and `MTBF_MULTIPLIERS`, `packages/importers/src/worksheet/deviceTable.ts:49–55`) know multiples of hours only, and no rule names years after an MTBF word, so `MTBF（年）` and `MTBF (years)` fall through to MTBF in hours. Agent: `UNIT_LEXICON` (`packages/agent/src/draft.ts:121`) maps any text containing `年` to AFR (line 129) and any text starting with `mtbf` to MTBF in hours (line 130).

**Evidence.** Value 10, meaning an MTBF of 10 years = 87,600 h, intended 11,416 FIT.

| Path | Text | Read as | Device FIT |
|---|---|---|---|
| importer header | `MTBF（年）` | MTBF 10 h | 1.0 × 10⁸ |
| importer header | `MTBF (years)` | MTBF 10 h | 1.0 × 10⁸ |
| agent unit text | `MTBF（年）` | AFR | refused ("AFR 10 is not a fraction below 1"); a value below 1, e.g. 0.5 years, would be accepted as AFR 0.5 |
| agent unit text | `MTBF (years)` | MTBF h | 1.0 × 10⁸ |

Refused with a visible reason (no silent error): importer unit cells `次/百万小时`, `failures/10^6 h`, `years`; agent `次/百万小时`, `years`.

**Suggested fix.** Add year multiples (`年`, `years`, `yr`, `a`, ×8,760 h) to the MTBF rules of both paths, before the AFR rule; in the agent, read `年` as an AFR only with AFR wording (`年化`, `年失效`, `/年`, `per year`) and never after an MTBF word; accept `次/百万小时` and `failures/10^6 h` as rates per 10⁶ h.

### N7 — The stored Shapley studies no longer reproduce from the code; the resolution note understates the shift

**Where.** The note in `MODEL_REVIEW_2026-10-27_RECHECK.md` §7 ("… below 1e-7 of A_op, so they were not regenerated"); the stored studies `docs/backup/arch-mechanism-shapley/*.json` (computed with the former sequential rule); the set's dominance list (`packages/core/data/mechanism-sets/remap-latest-2026-10.json:167`: R-WARM-PROCESS and R-CANN-GRAPH dominated by R-RUNTIME-SNAPSHOT).

**What.** Under the former rule, R-CANN-GRAPH applied after R-RUNTIME-SNAPSHOT (library order) changed nothing, because its candidate (37.5 s) lay above the snapshot's stage value. The expectation rule credits it on the events the snapshot does not cover, so the classes of R-CANN-GRAPH move, not only the trio's UNKNOWN-hard.

**Evidence.** native950 at 500,000 NPUs, all 23 players applied, startup stage per class:

| Class | Stored (former rule) | Current rule |
|---|---|---|
| CORE-hard, MODULE-hard, NIC-hard, CPU-hard | 17.25 s | 16.18 s |
| UNKNOWN-hard | 15.35 s | 15.30 s |
| SRAM, IOD, MEMT, MEMP, DDR, SSD (hard) | 17.25 s | 17.25 s |

A_op with all players applied, current minus stored (fractions):

| Record | 10k | 100k | 200k | 500k |
|---|---|---|---|---|
| native950 | 6.2e-8 | 6.1e-7 | 1.2e-6 | 3.0e-6 |
| ubl128 | 6.2e-8 | 6.1e-7 | 1.2e-6 | 3.0e-6 |
| cm384 | 6.2e-8 | 6.2e-7 | 1.2e-6 | 3.0e-6 |
| a3server | 6.2e-8 | 6.2e-7 | 1.2e-6 | 3.0e-6 |

With R-CANN-GRAPH left out of the players the difference is exactly 0, so the whole shift is R-CANN-GRAPH's new credit.

**Impact.** 3.0e-6 of A_op is 0.0003 pt, far below the 0.15 pt pruning threshold, so no verdict changes. But the stored studies are not reproducible from the code, and "R-CANN-GRAPH dominated by R-RUNTIME-SNAPSHOT" is now only approximately true: R-CANN-GRAPH adds value on the events the snapshot misses.

**Suggested fix.** Regenerate the four stored studies (and the Findings pages that read them) or state in the note that they predate the rule, with the measured shift; describe the dominance as approximate, or derive it from the shares.

## 5. Open by decision or documented

| Item | State at b43e35d | Documented where |
|---|---|---|
| R1 success lever | the derated value 0.99 equals today's 0.99, so the lever never gains on the derated side | `MODEL_REVIEW_2026-10-27.md` §7; **fixed 2026-10-28** (§6) |
| R4 derated D-HARD | coverage 0.949, below the baseline 0.95 | same; **fixed 2026-10-28** (§6) |
| C-FAST × C-MEM | both set τ and δ, the later wins: \|Δdelivered\| 8.0e-3, \|ΔA_op\| 7.7e-11 between the two orders | `MODEL_REFERENCE.md` §22.4.1 |
| R-ELASTIC × R-HCCL-ELASTIC | R-ELASTIC re-applied after R-HCCL-ELASTIC overwrites the saving: \|Δdelivered\| 2.2e-5 | same |

## Appendix — reproduction

Run from the repository root with `node --import tsx <file>.mts`.

```ts
// N4: R-CANN-GRAPH under the automatic-attempt lever lengthens CORE-hard's global recovery
const R = `${process.cwd()}/packages/core/src`;
const { topologyScenario } = await import(`${R}/topology/index.ts`);
const { applyMechanisms } = await import(`${R}/mechanisms/index.ts`);
const { applyLevers, DEFAULT_LEVERS } = await import(`${R}/strategy/index.ts`);
const { evaluateScenario } = await import(`${R}/scenario/evaluate.ts`);
const { resolveMechanismSet, DEFAULT_MECHANISM_SET } = await import(`${R}/records/mechanismSet.ts`);
const P = resolveMechanismSet(DEFAULT_MECHANISM_SET).parameters;
const auto = DEFAULT_LEVERS.filter((l) => l.id === 'auto');
const base = topologyScenario('a3-ub384', 100000);
const g = (s: any) => evaluateScenario(s, { structure: false }).training!.chain.rows.find((r) => r.id === 'CORE-hard')!.globalS;
console.log(g(applyLevers(base, auto, null)), g(applyLevers(applyMechanisms(base, ['R-CANN-GRAPH'], P), auto, null))); // 132 150.625
```

```ts
// N5: a percent-formatted cell under "AFR (%)"
const { deviceTableFromSheet } = await import(`${process.cwd()}/packages/importers/src/worksheet/deviceTable.ts`);
const { deviceFit } = await import(`${process.cwd()}/packages/core/src/ingest/koujing.ts`);
const cells = [['Device', 'AFR (%)', 'Source'], ['DIMM', 0.005, 'v']].flatMap((r, i) => r.map((value, j) => ({ sheet: 'x', addr: '', row: i, col: j, value, ...(i === 1 && j === 1 ? { format: '0.0%' } : {}) })));
const t = deviceTableFromSheet({ name: 'x', rows: 2, cols: 3, cells, merges: [], outline: [0, 0] } as never, { id: 't', sourceType: 'vendor' }).table.rows[0];
console.log(t.unit, t.value, deviceFit(t)); // afr 0.00005 5.71… (intended 0.005 → 572)
```

```ts
// N6: MTBF in years, importer and agent
const { deviceTableFromSheet } = await import(`${process.cwd()}/packages/importers/src/worksheet/deviceTable.ts`);
const { deviceRateUnitFactor } = await import(`${process.cwd()}/packages/agent/src/draft.ts`);
const sheet = (h: string) => ({ name: 'x', rows: 2, cols: 3, merges: [], outline: [0, 0], cells: [['Part', h, 'Source'], ['Fan', 10, 'v']].flatMap((r, i) => r.map((value, j) => ({ sheet: 'x', addr: '', row: i, col: j, value }))) });
for (const h of ['MTBF（年）', 'MTBF (years)']) {
  const row = deviceTableFromSheet(sheet(h) as never, { id: 't', sourceType: 'vendor' }).table.rows[0];
  console.log(h, row.unit, row.value, JSON.stringify(deviceRateUnitFactor(h))); // mtbf_h 10 {afr ×1} / mtbf_h 10 {mtbf_h ×1}
}
```

```ts
// N7: the stored study against the current rule (native950 at 500k): the shift is R-CANN-GRAPH's
const ROOT = process.cwd(), R = `${ROOT}/packages/core/src`;
const { applyMechanisms } = await import(`${R}/mechanisms/index.ts`);
const { resolveMechanismSet, DEFAULT_MECHANISM_SET, withRecoveryBaseline } = await import(`${R}/records/mechanismSet.ts`);
const { BUILTIN_TOPOLOGY_RECORDS, scenarioFromRecord } = await import(`${R}/records/topologyRecord.ts`);
const { evaluateScenario } = await import(`${R}/scenario/evaluate.ts`);
const { readFileSync } = await import('node:fs');
const P = resolveMechanismSet(DEFAULT_MECHANISM_SET).parameters;
const st = JSON.parse(readFileSync(`${ROOT}/docs/backup/arch-mechanism-shapley/native950.json`, 'utf8'));
const bare = withRecoveryBaseline(scenarioFromRecord(BUILTIN_TOPOLOGY_RECORDS.native950, 500000, undefined, { mechanisms: [] }), DEFAULT_MECHANISM_SET);
const aop = (ids: string[]) => evaluateScenario(applyMechanisms(bare, ids, P), { structure: false }).training!.operationalAvailability;
console.log(aop(st.players) - st.perSize['500000'].allOn, aop(st.players.filter((x: string) => x !== 'R-CANN-GRAPH')) - st.perSize['500000'].allOn); // ≈ 3.0e-6, 0
```

## 6. Resolution (2026-10-28)

| # | Fix | Where | Tests |
|---|---|---|---|
| N4 | `applyLevers` strips the same-stage mechanisms (`STAGE_MECHANISM_IDS`: R-WARM-PROCESS, R-RUNTIME-SNAPSHOT, R-CANN-GRAPH) before the automatic-attempt lever shortens the attempt and re-applies them over the levered job stages in their recorded order (only when the `auto` lever is among the levers); the strategies, the window rule and the budget's rebuild all go through it. A3 100k, lever 60 s: CORE-hard's global recovery with R-CANN-GRAPH 129.63 s (was 150.63 s), R-RUNTIME-SNAPSHOT credited 4.75 s (was 2.75 s), R-WARM-PROCESS 132.00 s (was 134.00 s) | `mechanisms/auditLibrary.ts`, `strategy/index.ts`; `MODEL_REFERENCE.md` §24.2, §28.3 | `core/test/model_review_v55.test.ts` (second-recheck N4 block) |
| N5 | the importer reads each cell's number format: a numeric cell with an unquoted, unescaped `%` in its format (`isPercentFormat`) holds the fraction, so the header's or unit cell's 0.01 is not applied again; under any unit but an AFR the row is refused; the row's note records the cell as shown and as stored | `importers/src/worksheet/deviceTable.ts`; `MODEL_REFERENCE.md` §26.1 | `importers/test/worksheet.test.ts` (second-recheck N5 / N6 block) |
| N6 | MTBF / MTTF in years (`年`, `years`, `yr`; × 8,760 h; a header that also names hours stays in hours) in the importer's headers and unit cells and in the agent's lexicon; the agent reads a year as an AFR only with AFR wording; counts per time (`次/百万小时`, `failures/10^6 h`, `次/小时`) are rates in both paths; `mttf` joins the importer's rate-column lexicon | `importers/src/worksheet/deviceTable.ts`, `agent/src/draft.ts`; `MODEL_REFERENCE.md` §26.1 | `importers/test/worksheet.test.ts`, `agent/test/e2e.test.ts` (a bare `年` is now an MTBF in years) |
| R1 | the automatic-success lever is derated on its failure probability, 1 − (1 − 0.999)·1.5 = 99.85 % (was 99.9 − 8 = 91.9 %, clamped to today's 99 %, so the lever never gained on the derated side); a strategy with it as the only move now selects it (A3 500k) | `strategy/index.ts` (`applyLevers`); `MODEL_REFERENCE.md` §28.3; Methodology overlap note; the web definition of nominal / derated | `core/test/model_review_v55.test.ts` (R1 block) |
| R4 | D-HARD keeps max(baseline, its) coverage and min(baseline, its) detection time, D-SLOW the same per class: the derated D-HARD is 0.95 in 1.5 s (was 0.949 in 1.5 s), the derated D-SLOW 0.95 in 45 s (was 0.94); nominal targets unchanged (they are above the baselines) | `mechanisms/index.ts`; `MODEL_REFERENCE.md` §28.3 | `core/test/model_review_v55.test.ts` (R4 block) |
