# HAC-D — AI cluster availability, MTBF/MTTR and goodput modeling

HAC-D is a browser-based reliability-engineering workbench for AI (LLM) training and inference clusters. It takes a cluster design — topology, component classes with 口径-typed failure parameters and provenance, workload, recovery pipeline, spares — and returns availability, MTBF/MTBI, MTTR, goodput and its loss terms, spare counts, N+k replica sizing and the cost of unavailability. It allocates a goodput or availability target to subsystem budgets, compares design options, runs one-at-a-time sensitivity, and cross-checks the closed forms with a Monte Carlo discrete-event simulation. It is grounded in the survey chapter *AI 集群可靠性建模：MTBF、MTTR 与可靠性框图* (2026-10).

## Quick start

```bash
npm install            # Node 20+, workspaces (core, cli, mcp, web)
npm test               # 245 tests incl. 143 independently computed golden vectors
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
```

MCP server for agents (Claude Code: `claude mcp add hacd -- node --import tsx $PWD/packages/mcp/src/server.ts`): tools `list_examples`, `get_example`, `scenario_schema`, `evaluate_scenario`, `compare_scenarios`, `allocate_scenario`, `tornado_scenario`, `simulate_scenario`, `library_search`.

## Layout

| Path | What |
|---|---|
| `packages/core` | Numerics: `math` (special functions, Lambert W, RNG, distributions), `units` (口径 conversions), `rbd` (series / parallel / k-of-n / standby / repeat blocks, importance, cut sets), `ctmc` (birth–death, k-of-n repairable, standby with switch, degraded and SDC-latent units), `checkpoint` (Young, Daly, Saxena, first-order goodput with validity flags, TrainMover, Epoch), `sparing` (binomial / Poisson quantiles, blocked probability), `mttr` (six-stage pipeline with scale laws and presets), `allocation` (equal, ARINC, AGREE, feasibility, minimum effort, cost-optimal, availability split, goodput budget), `sensitivity`, `cost`, `mc` (discrete-event simulator), `scenario` (zod schema, structure builder, evaluator, checklist, examples, comparison, tornado, allocation), `library` (parameter records) |
| `packages/core/data/library.json` | 531 survey-sourced parameter records with 口径 and provenance (9 explicit placeholders) |
| `packages/core/test/golden` | Golden vectors computed independently in Python (`compute_golden.py`) and the report of matches against the survey |
| `packages/cli` | `hacd` command line |
| `packages/mcp` | MCP server over the same core |
| `apps/web` | Vite + React app: Scenario, Training, Inference, Spares & domains, Allocation, Compare, Simulate (Web Worker), Report, Library |
| `docs` | Development plan, model reference, user guide |
| `.claude/skills` | `model-check`, `add-parameter`, `scenario-review`, `release-check` |

## Modeling principles

- Every number carries its 口径 (event, denominator, level) and formula; rates of different event classes are never added.
- First-order checkpoint formulas (goodput ≈ 1 − δ/τ − (τ/2 + R)/M) display their validity: (τ+δ)/M and R/M are checked and the restart-dominated regime is flagged; Daly's full model is shown alongside.
- MTTR is a pipeline of stages (detect, localize, remediate, restart, load, recompute) with scale laws, so recovery time grows with N.
- Spares are sized by quantile (binomial P99 / Poisson), never by ratio; block size is checked against the failure domain.
- Non-exponential lifetimes, lemon units, common cause and a finite hot-spare pool are simulated; the Monte Carlo result is compared with the closed form and a disagreement is flagged.
- Parameters from the survey keep their provenance and confidence (measured / paper-reported / vendor / derived / assumed / scan-level); assumed values are meant to be swept, not trusted.

See `docs/MODEL_REFERENCE.md` for the formulas and their survey anchors, and `docs/USER_GUIDE.md` for the pages.
