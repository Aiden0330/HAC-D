# Using ReMAP's models and tools together with HAC-D (2026-10-13)

ReMAP (`remap/remap-main/`, an untracked drop, see `TOOL_COMPARISON.md`) is a workbench built around the expert's engine: it vendors the audited 54-event review engine and the V4 monthly engine byte-identically, and adds ingestion, catalog governance, a six-stage audit workflow, statistics, allocation and reports. HAC-D keeps closed forms of the same models, a planner, allocation to classes and stages and a 19-entry mechanism library. The two fit together in three ways; none of them copies ReMAP code into HAC-D's packages.

## 1. Run ReMAP's engines on a HAC-D scenario (`scripts/remap-bridge.ts`)

```bash
node --import tsx scripts/remap-bridge.ts ref-catalog-100k --trials 4000 --engine review --no-ledger   # the audited review engine
node --import tsx scripts/remap-bridge.ts my-scenario.json --trials 400 --export remap-request.json      # both engines, HAC-D ledger, export
```

The bridge converts the scenario into the engines' inputs and runs them with ReMAP's seed policy:

| HAC-D | Review engine (`createReviewEngine(events, policy, config)`) | V4 monthly engine (`estimate(cards, params, trials, seed, hours)`) |
|---|---|---|
| component class with rate λ, count n, applicability flags | one event per class, FIT = λ·n/N·10⁹ per card-hour; fractional replay / process / elastic applicability becomes Boolean sub-events with the product probabilities (HAC-D's independent-fraction convention) | four source slots (memory / compute / network / other) scaled to the total class FIT; slowPct and silentPct from the class totals |
| sub-health classes (rate, detection, duration, performance) | slow events; detection probability, delay, lifetime and loss rate-weighted over the classes (one policy in the engine) | slowDetect, slowMinutes, slowHours, slowLoss |
| silent-corruption classes and policy | sdc events; immediate coverage, detect time, step recovery, fallback delay | silentDetect, silentHours, stepSeconds, silentFallbackHours, silentMinutes |
| MTTR mixture (detection coverage / times, attempt, success, manual) | detectProbability / detectSeconds / timeoutSeconds, recoveryAttemptSeconds / recoverySuccess / manualAdditionalSeconds | hardDetect, hardSeconds, fallbackMinutes, globalMinutes = attempt + (1 − p_s)·manual |
| checkpoint (evaluated τ, δ) | checkpointComputeSeconds / SaveSeconds | intervalSeconds / saveSeconds |
| chain rungs and order | opts.replay / elastic / process with the scenario's parameters as the policy; recoveryOrder; prediction, network failover and hot-swap have no counterpart (noted) | none (V4 has no per-event rungs; the bridge shows HAC-D without the chain for this comparison) |
| terminal rule | retain-last-clean natively; discard-all applied to the engine output (an unresolved window delivers 0) | `delivery` is the discard-all rule; `effective` keeps the correct work frozen at the episode start |

Result on the built-in 54-event catalog at 100,000 cards (HAC-D closed form delivered 62.61 %, A_op 97.548 %):

| Run | Delivered | A_op | Note |
|---|---:|---:|---|
| ReMAP review engine, 4000 windows, seed 20261009 | 62.56 % ± 0.46 | 97.556 % | equals the reference's published `results.json` baseline to the printed digits |
| ReMAP review engine, 400 windows, seed 1 | 62.63 % ± 1.44 | 97.587 % | |
| HAC-D ledger simulation, 400 windows | 62.68 % ± 1.42 | 97.567 % | |
| ReMAP V4 engine, 400 windows (no rungs) | delivery 39.64 % ± 3.32, effective 62.85 %, uptime 97.553 % | | HAC-D discard-all 41.35 %, retain 62.61 %, A_op 97.548 % |

What the bridge cannot represent is listed in its notes: the three v3.2 rungs (prediction, network failover, hot-swap), fault-free overheads, hot spares and blocked time, pipeline / ladder recoveries (mapped to their means), the tolerate sub-health policy (the engine always isolates). Use `--json` for the full comparison object; the `--export` file holds `reviewEngine` (events, policy, config, opts), `v4` (params) and `auditRequest`.

## 2. Send a HAC-D scenario to ReMAP's workbench (`--export`)

The exported `auditRequest` is a ReMAP `audit` request: `eventOverrides` carry the scenario's per-event FIT (`evidence: "scenario"`, `rateBasis: "npu-equivalent-hour"`) for every id that exists in ReMAP's reference catalog, `model` the 13 editable review-engine keys, `policy` the mechanism parameters, `mechanisms` the rungs and silent-corruption options active in the scenario (so ReMAP's "combined" scenario equals the HAC-D scenario and its baseline strips them), and `recoveryOrder` the scenario's order. Ids that ReMAP's catalog does not know are listed in `auditRequestNotes`; they need a ReMAP catalog import first (ReMAP's audit model is tied to its event library). Post it to ReMAP's API (`POST /api/tasks/:taskId/runs`, operation `audit`) or paste the parts into the workbench's advanced fields to get ReMAP's Shapley with confidence intervals, sensitivity scans, independent re-verification and its HTML report on the same inputs.

## 3. Bring ReMAP's calibrated catalog into HAC-D (`hacd import-remap`)

```bash
node --import tsx packages/cli/src/main.ts import-remap remap/remap-main/references/expert-review-2026-10-09/inputs.json --cards 100000 --out catalog.json
```

Accepts the reference / ReMAP `inputs.json` (`current.events` with FIT, `legacy.events` with type, scope, persistence and the replay / process / elastic flags), ReMAP's frozen run inputs or `events.json` exports, or a plain array of `{id, type, fit, replay?, process?, elastic?}` (types `hard / slow / sdc` or `中断 / 亚健康 / 静默`). Flags missing from the input come from the built-in audited catalog by id, otherwise an event gets only the global recovery and a warning. The result is a scenario at catalog granularity with the reference-engine baseline settings; the reference inputs reproduce the built-in `ref-catalog-100k` example to nine decimals (`packages/core/test/remap_import.test.ts`). From there everything in HAC-D applies: closed forms in milliseconds, the mechanism library and planner, allocation to classes and stages, the loss budget, the ledger simulation, and the bridge in the other direction for a Monte Carlo check.

Typical loop with an internal catalog: calibrate FITs in ReMAP (incident counts, `eventOverrides`, frozen runs) → `hacd import-remap` → explore mechanisms and budgets in HAC-D in seconds → `remap-bridge.ts --export` → confirm the chosen design in ReMAP with its sampling, verification seeds and report.

## 4. What stays separate

- ReMAP's static RBD / FTA / BDD solver takes event probabilities and HAC-D's RBD takes rates and repair models; both exist, neither is bridged.
- ReMAP's CTMC plugin (SciPy) and HAC-D's CTMC module solve different inputs (a user generator vs the repair / switchover / sub-health chains).
- ReMAP's task reliability and log-budget availability allocation apply to sub-models, not to training delivery; HAC-D's allocation works on the delivered basis. Both tools say so.
- Minimal mode of the HAC-D web app (v3.6) hides Inference, Spares & domains, Compare, Simulate and Report behind the "All pages" toggle; the bridge and the importer are CLI tools and do not depend on it.

## 5. Is the built-in 54-event example the same as ReMAP's reference audit?

Yes — `node --import tsx scripts/remap-param-check.ts` compares `ref-catalog-100k` with ReMAP's `inputs.json`, `mechanism-policy.json` and `config.json`: all 54 event FITs agree to 1e-16 per card-hour, every replay / process / elastic flag matches, the fifteen baseline settings (300 s / 4 s checkpoints; detection 95 % at 10 s else 60 s; recovery 180 s at 99 % plus 7200 s manual; sub-health 95 % detected after 5 min, 24 h, 5 % loss; silent corruption 0 % immediate, 120 h fallback; 720 h window) and the eight mechanism policies (D-HARD, D-SLOW, D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST) are identical, and the terminal rule is the same retain-last-clean rule. The only differences: the example's goodput target is 0.90 (ReMAP's default target table says 0.95 at 100k cards — a requirement, not a model parameter; set it on the Allocation and Mechanisms pages), HAC-D's seven extra library entries (P-PREDICT, R-NETFAIL, R-HOTSWAP, C-MEM, D-SDC-DMR, H-LEMON, H-SWEEP) exist but are inert until applied, and the model itself is a closed form (the bridge run of §1 shows the engine agrees with it within its sampling error). The V4 legacy model of ReMAP is a different configuration (7200 s / 10 s checkpoints, 120 min recovery, 0.4 % silent share, four sources, discard-all delivery) and is not what the example represents.

## 6. Follow-up work in HAC-D after a ReMAP audit, step by step

HAC-D opens in Minimal mode; "All pages" in the header adds Simulate, Compare, Report, Inference and Spares & domains. `hacd …` below means `node --import tsx packages/cli/src/main.ts …`.

1. **Load the catalog.** Header scenario selector → *Reference catalog, 54 events — 100,000 cards*. For ReMAP's calibrated catalog: `hacd import-remap inputs.json --cards 100000 --out catalog.json`, then Scenario page → *Import JSON*. Scale: Scenario page → workload → cards (every page re-evaluates in milliseconds; the Training page's scale table shows 1k–1M cards with the recovery scale laws).
2. **Read the baseline** (Training page): delivered goodput, A_op, MTBI; the silent-corruption card (episode rate, P(dirty at end), the delivered value under the other terminal rule); the chain table per class; the window ledger; first-order validity flags.
3. **Attribute the mechanisms** (Mechanisms page): the page defaults to the catalog; pick the players (chips; the six reference candidates are preselected; add P-PREDICT, R-NETFAIL, R-HOTSWAP, C-MEM, D-SDC-DMR, H-LEMON, H-SWEEP as wanted, at most 10) → *Value function* (delivered / effective / A_op) → *Attribute*. Output: single, last-added and exact Shapley gains with A_op and delivered side by side, interaction term, tornado charts (ReMAP: Monte Carlo Shapley over at most 8 players with CI).
4. **Plan to the target** (same page, *Plan to target* card): *Target* 0.95, *Derate assumed parameters* on, *Verify with the ledger simulation* on, windows 200–1000, confidence 0.9 → *Plan*. Output: the cheapest feasible set by effort, the necessary mechanisms, the effort–value Pareto front, the coverage × recovery heatmap, the no-fault bound (a target above it is proven infeasible) and the verification verdict with its Wilson interval. Edit effort scores and target parameters in the library table (e.g. D-SDC coverage) and plan again; *Apply to scenario* writes a mechanism's parameters into the scenario, *Remove* restores them exactly.
5. **Allocate the target** (Allocation page; ReMAP has no target → FIT mapping): *Goodput target* 0.95, *Target basis* delivered, *Method* (equal / ARINC / AGREE / feasibility / minimum-effort / cost-optimal), *Restart share*. Output: the silent-corruption card (reachable by hardware alone? required immediate detection q*, fallback delay D*), the loss budget over the ledger lines (*Split* proportional / equal / custom weights, with excess and levers per line), the allowed failure rate per class (FIT per unit and improvement factor), the allowed time per recovery stage, and the class-weights table (importance, feasibility, cost a / b, fixed) that differentiates the methods.
6. **What-ifs on hardware and policies** (Scenario page, component *Details*): failure rate and unit (or *Rate from incident counts* → *Use as measured rate*), repair paths (automatic coverage / success / time, manual time), redundancy and switchover, sub-health (rate, duration, performance, policy, detection), silent rate, applicability of each rung; job level: the silent-corruption policy (coverage, detect time, fallback delay, step recovery, terminal rule retain / discard-all), the mechanism chain (rungs, parameters, rung order ↑), hot spares, the recovery model (mixture, or pipeline presets with scale laws), checkpoint δ and interval model.
7. **Check and hand back** (All pages → Simulate: *Window ledger*, trials, target → *Run*: delta badge against the closed form, P(≥ target) with Wilson; Compare: tornado sensitivity; Report: the 11-item design-review checklist and export). Then `node --import tsx scripts/remap-bridge.ts catalog.json --trials 4000 --engine review --export req.json` to run ReMAP's engine on the chosen design and hand the audit request to ReMAP for its report.

CLI equivalents: `hacd example ref-catalog-100k > c.json`, `hacd eval c.json`, `hacd mechanisms c.json --players D-SDC,R-SDC,R-REPLAY,R-PROCESS,R-ELASTIC,C-FAST,P-PREDICT,R-HOTSWAP`, `hacd plan c.json --target 0.95`, `hacd allocate c.json --goodput 0.95 --basis delivered`, `hacd ledger c.json --trials 300 --target 0.95`, `hacd rate 3 --units 100000 --hours 720`, `hacd import-remap inputs.json --cards 100000 --out c.json`; the MCP server exposes the same functions to agents.
