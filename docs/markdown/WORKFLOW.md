# HAC-D workflows (2026-10-11)

Two workflows: the **analysis workflow** a reliability engineer follows with the tool, and the **development workflow** for changing the tool. Both are summarised in the user manual (`docs/USER_MANUAL.html` §14) and detailed here.

## A. Analysis workflow: from question to decision

| Step | Question | Pages / commands | Output to keep |
|---|---|---|---|
| A1 Fix the 口径 | Which metric and window? delivered goodput (正确有效产出), effective goodput, A_op, capacity availability; mean and/or P(window ≥ target) | Scenario → Measures, Targets | one sentence stating event class, denominator, level, window |
| A2 Gather data | failure rates per class with provenance; MTTR stage times; detection coverages; sub-health and SDC rates | Library (635 records, Use as rate), own logs | component table with confidence tags |
| A2b Internal inputs (v6) | which internal FIT tables, topology designs and mechanism data replace the public priors, and under which 口径? | worksheets and the offline bundle: `hacd ingest import-fit / normalize` (device table × reviewed 口径 mapping), `worksheet`, `validate`, `dry-run`, `diff`, `promote` (`docs/markdown/INGEST_RUNBOOK.md`; prose documents through `extract` with the on-prem model) | the signed delta page, records under internal ids, extension requests for what the engine cannot express |
| A3 Build the scenario | topology / supernode preset, component classes, repair paths, redundancy and switchover, sub-health, silent corruption, mechanism applicability, workload, recovery (mixture / ladder / pipeline) | Scenario; `hacd example`, JSON editor | scenario JSON (export) |
| A4 Evaluate | availability (original vs compensated), MTBI, R(N), goodput models, regime flags, ledger | Topology › Reliability tab, Inference & spares; `hacd eval` | KPI tiles; the regime line must be `ok` or the headline switches to the exact form |
| A5 Attribute | where the window goes (ledger), which levers matter | Reliability tab (ledger, chain), Mechanism library (Shapley), Review › Sensitivity (tornado); `hacd mechanisms`, `hacd tornado` | ranked levers with gains |
| A6 Allocate | required interruption rate per class and recovery time per stage for the target; silent-corruption levers | Allocation (delivered basis); `hacd allocate --basis delivered` | allowed λ per class, stage budgets, q* / D* |
| A7 Plan mechanisms | cheapest sufficient mechanism set with derated parameters; necessary mechanisms; coverage × recovery scan | Allocation › Strategies (the planner moved there in v5.1); `hacd strategy`, `hacd plan` | plan with margin, Pareto front |
| A8 Verify | does the plan hold on the distribution and beyond the closed-form assumptions? | Review › Simulation (window ledger: P(window ≥ target); job simulation: Weibull, common cause, spares); `hacd ledger`, `hacd simulate` | agreement badge, P(≥ target), P5 |
| A9 Review and report | eleven-item checklist, assumptions, importance, exports | Review › Checklist and its exports; `hacd measures`, Excel export | HTML / Excel report with formulas |
| A10 Close the loop | measure stage times, coverage, incident logs; re-allocate | Library (add records), Scenario | updated scenario with measured confidence |

Decision rules that recur:
- If the hardware alone cannot reach the target (Allocation → "reachable by hardware alone" below the target), start with the necessary mechanism (usually silent-corruption detection), not with rates.
- Substitutes (replay, elasticity, process rescheduling) have diminishing returns; complements (detection + step recovery) only pay together; read last-added gains before adding a lever.
- Allocate for the largest N that will run: detection and recovery losses grow ∝ N, the checkpoint term ∝ √N, silent-corruption episodes ∝ N.
- A plan that meets the target on the mean can miss it in a sizeable share of months; require P(window ≥ target) ≥ 90 % (or your confidence) in A8.

Worked examples: `docs/markdown/ALLOCATION_PRACTICE.md` §4 (90 % at 50,000 cards), `docs/markdown/REFERENCE_COMPARISON_100K_500K.md`.

## B. Development workflow

1. **Specify first.** Model changes start in `docs/markdown/MODEL_REFERENCE.md` (formula, 口径, assumptions, validity flags); UI changes in `docs/markdown/SPEC.md` (requirement, page, interface).
2. **Independent goldens.** Expected values for new closed forms are computed in Python from the spec (`packages/core/test/golden/compute_golden_v*.py`, run with `uv run --with mpmath --with numpy python …`), never by running the engine; a harness test (`golden_v*.test.ts`) compares at the stated tolerance.
3. **Implement in the core** (`packages/core/src`), keep v1 code paths exact when no new feature is used, return every KPI with its formula string.
4. **Tests**: `npm test` (817 core + 52 importer + 30 agent + 28 report; `node packages/reports/test/reproduce.mjs` six OK); add unit tests for limits and conservation (ledgers must close); cross-check against the reference engine with `scripts/ref-compare*.ts` when the change touches the training models.
5. **Wire the interfaces**: web page (bilingual strings in `apps/web/src/i18n/strings.ts`, worker API), CLI command, MCP tool.
6. **Browser check**: `npm run shots` with the dev server (`.claude/launch.json` → `web`): every page at 1280 × 900 and 375 × 812, light and dark, no horizontal overflow, no console errors; inspect the PNGs.
7. **Docs and manual**: USER_GUIDE / README / MODEL_REFERENCE (and INGEST_RUNBOOK for a v6 change); `npm run manual` rebuilds `docs/USER_MANUAL.html` from `docs/manual/USER_MANUAL.src.html` and the cropped screenshots (`scripts/manual-images.py`).
8. **Commit** with the attribution trailer; do not commit the reference-tool drop (`ai-cluster-reliability-main/`, ignored).

Skills in `.claude/skills` encode the recurring parts of this workflow (`docs/markdown/SKILLS.md`).
