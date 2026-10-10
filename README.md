# HAC-D — AI cluster availability, MTBF/MTTR and goodput modeling

HAC-D is a browser-based reliability-engineering workbench for AI (LLM) training and inference clusters. It takes a cluster design — topology, component classes with 口径-typed failure parameters and provenance, workload, recovery pipeline, spares — and returns availability, MTBF/MTBI, MTTR, goodput and its loss terms, spare counts, N+k replica sizing and the cost of unavailability. It allocates a goodput or availability target to subsystem budgets, compares design options, runs one-at-a-time sensitivity, and cross-checks the closed forms with a Monte Carlo discrete-event simulation. It is grounded in the survey chapter *AI 集群可靠性建模：MTBF、MTTR 与可靠性框图* (2026-10).

## Quick start

```bash
npm install            # Node 20+, workspaces (core, importers, cli, mcp, web)
npm test               # 327 tests incl. 143 + 26 independently computed golden vectors (v1 + v2 models)
npm run dev            # web app at http://localhost:5173 (bilingual zh/en, light/dark)
npm run build -w @hac-d/web   # static bundle in apps/web/dist
```

CLI (no build step):

```bash
node --import tsx packages/cli/src/main.ts examples
node --import tsx packages/cli/src/main.ts example survey-ex1 > ex1.json
node --import tsx packages/cli/src/main.ts eval ex1.json
node --import tsx packages/cli/src/main.ts compare ex1.json nvl72.json
node --import tsx packages/cli/src/main.ts allocate nvl72.json --goodput 0.98 --method arinc
node --import tsx packages/cli/src/main.ts simulate ex1.json --reps 100
node --import tsx packages/cli/src/main.ts example ascend-cm384 > cm384.json          # CloudMatrix384 supernode (v2)
node --import tsx packages/cli/src/main.ts measures cm384.json                       # original vs compensated + waterfall
node --import tsx packages/cli/src/main.ts example ascend-supercluster-100k > sc.json  # 100,000 NPUs as 261 + 3 supernodes (capacity availability)
node --import tsx packages/cli/src/main.ts methods book.xlsx                         # which availability methods a spreadsheet uses
node --import tsx packages/cli/src/main.ts import-excel book.xlsx --out imported.json # topology + parameters → scenario, reconciled
node --import tsx packages/cli/src/main.ts export-excel cm384.json cm384.xlsx        # workbook with live formulas
```

MCP server for agents (Claude Code: `claude mcp add hacd -- node --import tsx $PWD/packages/mcp/src/server.ts`): tools `list_examples`, `get_example`, `scenario_schema`, `evaluate_scenario`, `compare_scenarios`, `allocate_scenario`, `tornado_scenario`, `simulate_scenario`, `library_search`, and (v2) `excel_method_report`, `import_excel_scenario`, `export_excel`.

## v2 (2026-10-09): Ascend topology, repair paths, sub-health, original vs compensated, Excel

- **Original vs compensated measures** (原始 / 补偿后): every evaluation reports the inherent availability (every unit fault is an outage repaired manually, redundancy removed) next to the compensated one (redundancy, switchover success, automatic recovery, sub-health policy), with a four-step waterfall and a switchover penalty. Strict / tolerant / performance-weighted sub-health measures are shown alongside.
- **Dual-path repair**: automatic coverage `c`, success `s`, automatic and manual MTTR; exact inside k-of-n groups (chain over automatic / manual / switch-failed states), `E[R] = c·T_a + (1 − c·s)·T_m` for series units; the share of events that reach a person is reported.
- **Switchover success rate** on parallel, k-of-n and standby groups, with a per-switchover micro-outage and a failed-switch recovery time.
- **Sub-health** (亚健康): entry rate or steady-state probability, duration, performance factor, escalation, tolerate vs isolate policy with detection; threshold rule (default 0.7 = MindCluster's 30 % degradation); straggler law for synchronous jobs; fabric plane loss as a performance factor.
- **Recovery ladder**: ordered rungs with success probabilities (MindCluster preset: operator-level → process-level online recovery → process / pod / job rescheduling → elastic scale-in → manual).
- **CloudMatrix384 / Atlas 950 presets**: supernode geometry from the Huawei paper (48 nodes × 8 NPU, 7 UB sub-planes × 16 L2 chips, 5,376 optical links) with count scopes for L1/L2 chips, links, transceivers and sub-planes; 104 sourced records in the library (`docs/ASCEND_SOURCES.md`); failure rates are analogues tagged `assumed`.
- **Excel import / export** (`packages/importers`, SheetJS): method fingerprinting of formulas (A = MTBF/(MTBF+MTTR), series product, rare-event sum, parallel complement, k-of-n COMBIN / BINOM.DIST, switchover weighting, MTTR mixtures, Markov MMULT/MINVERSE …), topology extraction from level columns, indentation, outline levels and the formula dependency graph, conversion to a scenario, reconciliation against the sheet's own numbers, and export of a workbook with live formulas. Nine synthetic fixture workbooks under `packages/importers/test/fixtures`.

## v3 (2026-10-10): silent corruption, mechanism chain, Shapley attribution

- **Silent data corruption at scenario level** (`component.sdc`, `scenario.sdc`): immediate detection coverage and time, fallback discovery delay, optional step recovery; a finite-window alternating-renewal closed form gives the delivered (正确有效) goodput, the expected undetected episodes, the clean-time share, the terminal-discard probability and a window ledger. Validated against independent Python goldens and the ai-cluster-reliability audited engine (93.33 / 62.6 / 45.7 / 25.3 % at 10k / 100k / 200k / 500k cards vs its 93.33 / 62.56 / 45.87 / 25.24 %).
- **Mechanism chain with per-class applicability**: replay → DP-domain elasticity → process rescheduling → global checkpoint recovery, each rung with applicable fraction, success probability and distinct success / failure times; pause-only vs rollback events enter a generalised exact renewal `λ_rb τ/[(e^{λ_rb(τ+δ)} − 1)(1 + λ_rb R_rb + λ_p R_p)]`; detected sub-healthy units are isolated after saving progress.
- **Mechanism library and attribution** (`packages/core/src/mechanisms`): the reference catalog's twelve mechanisms as scenario transforms with target parameters; single, last-added and exact Shapley gains over all 2^n coalitions with the closed forms; a Mechanisms page in the web app.
- **Window-ledger Monte Carlo** (`mc/ledger.ts`): the reference engine's semantics (three fault classes, chain, clean-checkpoint retention, terminal discard) with a conserved ledger, CI, quantiles and P(≥ target); Simulate page default mode.
- Example `ref-three-classes-100k` (the reference's confirmed baseline) and `scripts/ref-compare-v3.ts` for the cross-check; `docs/MODEL_REFERENCE.md` §19–§22, `docs/REFERENCE_COMPARISON_100K_500K.md` §5.

## Layout

| Path | What |
|---|---|
| `packages/core` | Numerics: `math` (special functions, Lambert W, RNG, distributions), `units` (口径 conversions), `rbd` (series / parallel / k-of-n / standby / repeat blocks, importance, cut sets), `ctmc` (birth–death, k-of-n repairable, standby with switch, degraded and SDC-latent units), `checkpoint` (Young, Daly, Saxena, first-order goodput with validity flags, TrainMover, Epoch), `sparing` (binomial / Poisson quantiles, blocked probability), `mttr` (six-stage pipeline with scale laws and presets), `allocation` (equal, ARINC, AGREE, feasibility, minimum effort, cost-optimal, availability split, goodput budget), `sensitivity`, `cost`, `mc` (discrete-event simulator), `scenario` (zod schema, structure builder, evaluator, checklist, examples, comparison, tornado, allocation), `library` (parameter records) |
| `packages/core/data/library.json` | 635 parameter records with 口径 and provenance: 531 from the survey (9 explicit placeholders) + 104 Ascend / CloudMatrix records |
| `packages/core/test/golden` | Golden vectors computed independently in Python (`compute_golden.py`, `compute_golden_v2.py`) and the reports of matches |
| `packages/importers` | Spreadsheet importer / exporter: workbook reader, formula fingerprinting, topology draft, scenario conversion, reconciliation, xlsx export |
| `packages/cli` | `hacd` command line |
| `packages/mcp` | MCP server over the same core |
| `apps/web` | Vite + React app: Scenario, Training, Inference, Spares & domains, Allocation, Compare, Simulate (Web Worker), Report, Import, Library |
| `docs` | Development plan (+ v2 enhancement plan), model reference (§10–17 = v2 models), user guide, Ascend source notes |
| `.claude/skills` | `model-check`, `add-parameter`, `scenario-review`, `release-check` |

## Modeling principles

- Every number carries its 口径 (event, denominator, level) and formula; rates of different event classes are never added.
- First-order checkpoint formulas (goodput ≈ 1 − δ/τ − (τ/2 + R)/M) display their validity: (τ+δ)/M and R/M are checked and the restart-dominated regime is flagged; Daly's full model is shown alongside.
- MTTR is a pipeline of stages (detect, localize, remediate, restart, load, recompute) with scale laws, so recovery time grows with N.
- Spares are sized by quantile (binomial P99 / Poisson), never by ratio; block size is checked against the failure domain.
- Non-exponential lifetimes, lemon units, common cause and a finite hot-spare pool are simulated; the Monte Carlo result is compared with the closed form and a disagreement is flagged.
- Parameters from the survey keep their provenance and confidence (measured / paper-reported / vendor / derived / assumed / scan-level); assumed values are meant to be swept, not trusted.
- Original and compensated measures are always both shown, so the credit taken for redundancy, switchover, automation and sub-health handling is explicit (v2).

See `docs/MODEL_REFERENCE.md` for the formulas and their survey anchors, and `docs/USER_GUIDE.md` for the pages.
