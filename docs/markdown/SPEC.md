# HAC-D specification (v3.1, 2026-10-11)

## 1. Purpose and scope

HAC-D models the availability, MTBF, MTTR and goodput of AI training and inference clusters and allocates targets back to subsystems and fault-management mechanisms. In scope: one synchronous training job or one N+k inference pool on a described cluster; closed forms with validity flags; Monte Carlo for what the closed forms cannot hold; Excel import / export; bilingual web UI, CLI and MCP. Out of scope: multi-job scheduling, cost of mechanisms in currency (effort scores only), physical-layer models of optical or power protection (represented as residual rates with redundancy groups).

## 2. Functional requirements

| ID | Requirement | Realisation |
|---|---|---|
| F1 | Every displayed number carries its formula and its 口径 (event, denominator, level); quantities of different event classes are never added | `EvaluationResult.formulas`, `koujing` on rates, separate rates for interruption / sub-health / silent corruption |
| F2 | First-order checkpoint formulas check τ + δ ≪ M and R ≪ M and flag the regime; the headline switches to the exact renewal form when the flags fire | `goodputFirstOrder`, `headlineGoodput` |
| F3 | Non-exponential or correlated inputs route to Monte Carlo; the closed form stays visible with a delta badge | Simulate page (job simulation, window ledger), `disagrees` flags |
| F4 | Parameters keep provenance and confidence (measured / paper-reported / vendor / derived / assumed / scan-level) | `ProvenanceSchema`, library records |
| F5 | Structure: series, parallel, k-of-n, standby, common cause (β, domain), fault-tree cut sets and importance | `rbd`, `ctmc` |
| F6 | Repair paths: automatic (coverage, success, MTTR) and manual; switchover success, micro-outage, failed-switch recovery; original vs compensated measures with a waterfall | `ctmc/repair.ts`, `compensationWaterfall` |
| F7 | Sub-health: entry rate, duration, performance, escalation, tolerate / isolate with detection; strict / tolerant / performability; straggler law; plane loss | `subhealthUnit`, `stragglerLaw`, `planeLossPerformance` |
| F8 | Silent corruption: per-class rate; job policy (immediate detection coverage and time, fallback delay, step recovery); delivered goodput over the window with ledger | `sdc/index.ts`, `scenario.sdc` |
| F9 | Mechanism chain: predict → netfail → replay → hotswap → elastic → process → global with per-class applicability, success and failure times, false-alarm migrations and a fault-free overhead factor; pause-only vs rollback events in a mixed exact renewal | `mechanisms/chain.ts`, `renewalGoodputMixed` |
| F10 | Mechanism library (12 reference mechanisms + 7 literature entries: prediction, network failover, hot-swap, in-memory checkpoints, DMR, lemon eviction, sweeps) with transforms, effort scores and fault-free overheads; attribution (single, last-added, Shapley for A_op, effective and delivered side by side); planner (cheapest feasible set, derating, necessary, Pareto, scan, verification) | `mechanisms/index.ts`, `mechanisms/plan.ts` |
| F11 | Allocation: equal / ARINC / AGREE / feasibility / minimum-effort / cost-optimal rate budgets; recovery-stage budgets; availability split; goodput budget; delivered basis with hardware feasibility and required detection | `allocation`, `allocateScenario` |
| F12 | Spares: binomial and Poisson hot spares, repair pipeline, replacements; inference N+k with replica scope up to a supernode | `sparing`, `replicaComposition` |
| F13 | Supernode geometry (CloudMatrix384, Atlas 950) with count scopes for L1 / L2 chips, sub-planes, links, transceivers; cluster sizing in supernodes | `SuperpodSchema`, `computeCounts` |
| F14 | Excel import: method fingerprinting (18 tags), topology extraction, scenario conversion, reconciliation; export with live formulas | `packages/importers` |
| F15 | Window-ledger simulation with the reference engine's semantics, conserved ledger, CI, quantiles, P(≥ target), per-class attribution | `mc/ledger.ts` |
| F16 | Reference reproduction: built-in baselines reproduce the audited engine's means within its CI; the reference's V1 closed form is reproduced to machine precision | `ref-baseline-100k`, `ref-three-classes-100k`, `scripts/ref-compare-v3.ts`, `scripts/ref-compare-v1.ts`, tests |
| F19 | v3.7: the 16 audited mechanisms of 新可靠性机制库 (2026-10-14) as library entries with exact-removal transforms (custom chain rungs, recovery stage budget with per-class overrides and the same-stage minimum rule, per-class silent-corruption coverage, durable lag of asynchronous saves), strict null integration fields with a provisional-assumptions switch; single-point benefit audit with a standalone HTML report; cross-scale allocation study (budgets, exact / greedy planner, exact / sampled Shapley, residual by domain group, levers, verification, curves) with a standalone HTML report; Audit & study page, `hacd audit` / `hacd study`, MCP `audit_mechanisms` / `allocation_study` | `mechanisms/auditLibrary.ts`, `mechanisms/audit.ts`, `study/index.ts`, `report/*.ts`, `apps/web/src/pages/AuditPage.tsx` |
| F20 | v6: internal inputs through Markdown worksheets (profile `hacd-worksheet-1`) parsed to the v5 input records; device FIT → business-impact FIT per unit through a reviewed 口径 mapping with the derivation in every entry and a confidence policy; gates (closed vocabularies incl. the parameter keys a mechanism reads, provenance completeness, plausibility, structural consistency, id policy: internal ids beside the public records, never overwritten); input / KPI delta with a bilingual review page; an extraction worker whose evidence cards are accepted only by grounding and two-pass agreement, confidence from the declared source type; an offline bundle for the network that holds the documents | `packages/core/src/ingest`, `packages/importers/src/worksheet`, `packages/agent`, `hacd ingest …`, `packages/reports/src/delta.mjs`, `scripts/bundle-offline.mjs` |
| F18 | v3.6: minimal web mode (five pages hidden behind a header toggle, nothing removed); ReMAP bridge (`scripts/remap-bridge.ts`: run ReMAP's vendored review and V4 engines on a HAC-D scenario, compare, export engine inputs and a ReMAP audit request); ReMAP / reference catalog importer (`importRemapCatalog`, `hacd import-remap`) | `scripts/remap-bridge.ts`, `scenario/remap.ts`, `apps/web/src/App.tsx` |
| F17 | v3.5 (from the ReMAP / reference comparison): silent-corruption terminal rule (retain-last-clean / discard-all), configurable rung order, Student-t and Wilson intervals with a verification verdict, loss budget over the ledger lines, checkpoint no-fault bounds as a proof of infeasibility, incident-count rate estimation with Garwood intervals | `sdc/index.ts`, `mechanisms/chain.ts`, `math/stats.ts`, `math/special.ts`, `scenario/analysis.ts`, `mechanisms/plan.ts`, `fit/incidents.ts` |

## 3. Non-functional requirements

- Web app static (Vite + React), computation in a Web Worker, bilingual zh / en, light and dark, usable at 1280 px and 375 px without horizontal overflow; results recompute after every edit.
- Core is pure TypeScript without DOM dependencies; CLI and MCP reuse it unchanged.
- Verification: independent Python goldens for closed forms (187), unit tests (358 core + 29 importers), reference cross-check, screenshot checks; a change is not "working" until these pass.
- Performance: closed-form evaluation in milliseconds; Shapley over ≤ 10 players (1,024 coalitions, about a second on the 54-event catalog because the value function evaluates the training block only, `evaluateScenario(s, { structure: false })`) and the planner in the browser, both with a progress counter and a Cancel that restarts the compute worker; simulations chunked with progress.

## 4. Data model

The scenario document (`docs/scenario.schema.json`, generated by `scenarioJsonSchema()`), version 0.2, with the sections `meta`, `topology` (incl. `superpod`), `components[]` (count rule, failure rate with unit and 口径, repair paths, redundancy with switchover, common cause, sub-health, silent-corruption rate, mechanism applicability, infant / lemon / Weibull), `structure` (template or custom block tree), `workload` (training or inference), `recovery` (preset / pipeline / ladder / mixture), `spares`, `targets`, `costs`, `measures`, `sdc`, `mechanisms`, `assumptions`. Older documents (0.1) parse unchanged; new fields default to inert values.

## 5. Outputs (KPIs) and their 口径

| KPI | 口径 | Model |
|---|---|---|
| availability (compensated / original / strict / tolerant / performability) | steady-state, system structure | RBD + CTMC (§13.1–13.4 of the manual) |
| MTBF, equivalent MTTR, failures per year | system, steady state | A / ν_sys |
| MTBI, R(N), A_op | job, steady state | Σ nᵢλᵢ (+ isolations); pipeline / ladder / mixture; 1/(1 + λ_rb R_rb + λ_p R_p) |
| goodput: first order, exact renewal, product, Daly; effective | job, long-run share of wall time | §13.5 |
| delivered goodput, ledger, SDC episode statistics | job window (durationDays) | §13.7 |
| chain outcome per class | per interruption | §13.6 |
| Shapley / single / last-added gains; plan | scenario deltas of a chosen value function | §13.8 |
| allocation budgets | per class / per stage; delivered basis conversion | §13.9 |
| spares, inference capacity, k* | nodes / replicas / supernodes | §13.9 |

## 6. Interfaces

- **Web**: pages Scenario, Training, Mechanisms, Inference, Spares & domains, Allocation, Compare, Simulate, Report, Import, Library.
- **CLI** `hacd`: examples, example, eval, compare, allocate, tornado, simulate, measures, methods, import-excel, export-excel, mechanisms, ledger, plan, schema (`--json`); v4 topology, strategy; v5 findings, bom, budget, methodology, prune, study --record, records, schema --record|--mechanisms|--rates; v6 ingest template, fields, worksheet, import-fit, normalize, validate, dry-run, diff, promote, extract.
- **MCP** (stdio): list_examples, get_example, scenario_schema, evaluate_scenario, compare_scenarios, allocate_scenario, tornado_scenario, simulate_scenario, library_search, excel_method_report, import_excel_scenario, export_excel, mechanism_library, mechanism_report, apply_mechanisms, simulate_ledger, plan_mechanisms, estimate_rate, audit_mechanisms, allocation_study.
- **Files**: scenario JSON; Excel workbook (Inputs, Structure, Results, Formulas); HTML report; components CSV; the user manual `docs/USER_MANUAL.html`; v5 input records (topology record, failure-rate override, mechanism set; JSON with provenance) and the sidecar JSON of the report set; v6 worksheets (Markdown, `hacd ingest template`), staging folders, `delta.{json,md,html}`, extension requests, the offline bundle `dist/offline/hacd-<version>.tgz`.

## 7. Validation requirements

| Check | Evidence |
|---|---|
| closed forms vs independent Python | `packages/core/test/golden/golden*.json` (143 + 26 + 18 vectors) |
| limits and conservation | unit tests (ledgers close to 1e-6; renewal limits; SDC closed form vs brute-force simulation) |
| reference engine | delivered 93.33 / 62.6 / 45.7 / 25.3 % at 10k / 100k / 200k / 500k vs 93.33 / 62.56 / 45.87 / 25.24 (± 0.26–0.46); A_op within 0.01 pt; mechanism gains within the reference's CI |
| Excel export | recalculated with an independent formula engine (max |Δ| 1e-16 except documented sub-health / switchover effects) |
| UI | `npm run shots`: 8 pages × 2 viewports × 2 themes, no overflow, no console errors |

## 8. Model specification pointers

`docs/MODEL_REFERENCE.md` §1–§9 (v1), §10–§17 (v2), §18 (v2.1), §19–§22.2 (v3 / v3.1); `docs/TRAINING_AVAILABILITY_FORMULAS_AND_COMPARISON.md`; `docs/ALLOCATION_PRACTICE.md`; `docs/ASCEND_SOURCES.md`; `docs/PLAN_V2_AVAILABILITY_ENHANCEMENTS.md`; `docs/DEVELOPMENT_PLAN.md` (status tables).
