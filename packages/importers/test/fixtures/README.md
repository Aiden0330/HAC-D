# Importer fixtures — synthetic availability workbooks

Test workbooks for the availability-spreadsheet importer (`packages/importers`): nine small
`.xlsx` files that between them use every calculation method the fingerprinter must recognise,
plus `manifest.json`, which records for each workbook the layout (header row, column roles,
merged cells, outline levels), the expected component tree, the expected method tags with the
cells they appear in, every formula as stored, and the numeric value every formula cell must
evaluate to.

**All parameter values are synthetic.** They are round numbers (MTBF 50 000 h, FIT 5000,
MTTR 4 h, AFR 12 %/year …) chosen to exercise the importer; nothing here is vendor, paper or
measured data, and nothing should be quoted as such.

## Regenerating

```sh
uv run --with openpyxl python packages/importers/test/fixtures/make_fixtures.py
```

The script writes the workbooks and the manifest, then reads every workbook back
(`data_only=False`) and asserts that each recorded formula is present, each input value
round-trips exactly, and merged ranges and outline levels are as the manifest says. Output is
byte-for-byte reproducible for a given openpyxl version (3.1.5 at the time of writing): document
timestamps are pinned and the zip is re-packed with fixed entry dates. The expected values are
computed in the same script with plain IEEE-754 doubles following each formula's own operation
order, so it doubles as the reference evaluator.

## The workbooks

| | File | Sheet | What it exercises |
|---|---|---|---|
| F1 | `series_basic_en.xlsx` | `Series` | Six leaves (GPU node, leaf/spine switch, storage, power feed, cooling loop) with `=(C/(C+D))^B`, i.e. per-unit MTBF/MTTR availability raised to the quantity, then a `PRODUCT` system row and a `1-SUM(U)` rare-event row. English headers, header row 1. |
| F2 | `parallel_switchover_zh.xlsx` | `可用度` | FIT → λ (`=C*1E-9`), `1/(1+λ·MTTR)`, two `1+1` rows weighted by 倒换成功率 (`=H*(1-(1-F)^2)+(1-H)*F`, 0.98 and 0.95), one row without redundancy (`=F4`), `PRODUCT` system row. Chinese headers; 数量 = 2 on the 1+1 rows means the two units of the pair. |
| F3 | `kofn_combin.xlsx` | `kofn` | A 2-of-3 PSU group and a 3-of-4 CDU-pump group, each computed three ways in adjacent columns: explicit sum, `COMBIN`, and `1-BINOM.DIST(k-1,n,A,TRUE)` (stored as `_xlfn.BINOM.DIST`). Redundancy column holds `2/3`, `3/4`, `1/1`; three `PRODUCT` system cells. |
| F4 | `mttr_auto_manual.xlsx` | `MTTR` | `MTTR有效 = p·T_auto + (1-p)·T_manual` and `A = 1/(1+λ·MTTR有效)` for four rows, `PRODUCT` system row, mixed zh/en headers. Qty is present but not referenced by any formula: λ is the row aggregate (the 备注 column says so). |
| F5 | `markov_1plus1.xlsx` | `Markov` | 1+1 hot standby as a 3-state chain: generator `Q` in B8:D10 from λ and μ cells, `M = Qᵀ` with the last row replaced by Σπ = 1 via `INDEX(TRANSPOSE(...),r,c)`, π via `INDEX(MMULT(MINVERSE(M),b),r,1)` (plain formulas, no CSE), availability = π(2 up)+π(1 up). Also an independent-units cross-check (`1-(1-A)^2`) and a cold-standby `EXP` mission-reliability cell that must be tagged but kept out of the tree. Block layout, merged title, single repair crew. |
| F6 | `hierarchy_levels_zh.xlsx` | `拓扑` | Thirteen-row tree described by a 层级 column (`0, 1, 1.1, 1.1.1 … 3.2`): 系统 → 计算子系统 (串联: rack of GPU nodes/ToR/PDU plus a management node), 网络子系统 (two planes, `1-(1-A)(1-B)`), 供电子系统 (2N, `1-PRODUCT(不可用度)`). Merged title row 1, header row 2; integer levels stored as numbers, dotted levels as text. |
| F7 | `hierarchy_indent_en.xlsx` | `Topology` | The same tree and formulas as F6 in English with no level column: depth is 2 leading spaces per level in the Component cell **and** the Excel row outline level (1–3, `summaryBelow = false`). Header row 1. |
| F8 | `inconsistent_rare_event.xlsx` | `Series` | Five leaves with deliberately low MTBF (2 000–6 000 h) so U = λ·MTTR is 0.018–0.04 per row; headline "System availability" = `1-SUM(U)` (0.862) next to the exact `PRODUCT(A)` (0.87285) and their difference (0.01085). Tests the reconciliation path. |
| F9 | `percent_units.xlsx` | `单位` | Availabilities entered as percentages (99.95, 99.9 as plain numbers with header `可用度(%)`, divided by 100 in the next column), one cell holding 0.9999 with the `0.00%` number format and *no* /100, AFR in %/year converted with `=8760/(C/100)`, `PRODUCT` system row. |

## manifest.json

`workbooks[]` has one entry per file: `file`, `sheets`, `sheet`, `header_row` (1-based; `null`
for the block-layout F5), `data_rows`, `headers`, `columns` (role → column letter), `merged_cells`,
`outline_levels` (row → level), `expected_tree`, `expected_methods`, `untagged_formula_cells`,
`formulas`, `expected_values`, `tolerance`, `ambiguities` and `extra`. The `conventions` object at
the top of the manifest documents the node schema and the evaluation semantics in full; the
points tests depend on most:

- **Roles.** The base roles are `name, level, count, mtbf_h, mttr_h, fit, lambda_per_h,
  availability, unavailability, redundancy, switchover_success, auto_fraction, mttr_auto_h,
  mttr_manual_h, mttr_effective_h, notes`. Three extension roles were needed:
  `unit_availability` (F2, F3: per-unit availability next to the group availability the parent
  consumes), `afr_pct_per_year` and `availability_pct` (F9).
- **`count` vs `qty_cell`.** `count` is what the engine applies (`A_node = A_unit^count`);
  `qty_cell` is the raw quantity-column value. They coincide in F1/F6/F7/F9 where the formula
  raises to the quantity, but a `1+1` or `k/n` row has `count = 1`, `n = qty_cell`, and F4 has
  `count = 1` because λ is already the row aggregate.
- **Homogeneous groups.** A row whose redundancy text is `1+1`, `2N`, `2/3`, … becomes a
  `parallel`/`kofn` node with `homogeneous: true`, `k`, `n`, unit parameters in `params` and no
  children. F6/F7 parallel groups are heterogeneous (explicit child rows).
- **Methods.** `expected_methods` is a list of `{tag, cells, optional_cells?, note?}`. A cell may
  carry several tags (F2's `I2` is both `switchover_weighted` and `parallel_product_complement`).
  Assert `cells ⊆ detected ⊆ cells ∪ optional_cells` per tag; `untagged_formula_cells` lists the
  complements, pass-throughs, differences and `1/MTBF` cells that should not be tagged.
- **Values.** `expected_values` covers all 157 formula cells. Use the per-workbook `tolerance`
  (`rel` or `abs`); F5 needs the absolute tolerance because π(0 up) ≈ 1.3e-8 comes out of an O(1)
  matrix solve. A recalculation with the independent `formulas` Python package agreed on every
  cell it could evaluate (worst difference 2.2e-16; it lacks `COMBIN`).

## Things an importer must cope with (all intentional)

- No cached values anywhere (`<v/>` is empty): numbers come only from evaluating formulas.
- Strings are inline (`t="inlineStr"`), not a shared-string table; leading spaces in F7 are
  preserved with `xml:space="preserve"`.
- `BINOM.DIST` is stored as `_xlfn.BINOM.DIST`; SheetJS strips the prefix unless `xlfn: true`.
- Header row is 1 except F6 (merged title in row 1, header in row 2) and F5 (no header, label/value
  pairs and matrix blocks).
- Quantity semantics differ: exponent (F1, F6, F7, F9), units of a redundancy group (F2, F3),
  ignored because λ is aggregate (F4). The formula dependency graph tells them apart.
- Parallel groups appear as `1-(1-A)^2`, `1-(1-A)*(1-B)` and `1-PRODUCT(U-range)`; the last one
  references the *unavailability* column, so children must be found through `U = 1-A`.
- Series groups appear as `PRODUCT(range)`, `PRODUCT(a,b,c)` and `a*b` (F6 `F4`, F7 `E3`).
- F6's root has level `0`, which is not a dotted prefix of `1`/`2`/`3`; integer levels are numeric
  cells, dotted ones text.
- F9 mixes percent inputs, a `0.00%`-formatted fraction and `=G*100` display formulas in one
  column; the `%` in the header alone does not decide the conversion.
- F1 and F8 each have two "system" rows (exact and rare-event); F3 has three equal system cells;
  F5 has an `EXP` reliability cell that is a different 口径 and belongs outside the tree.
