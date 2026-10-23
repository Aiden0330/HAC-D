# HAC-D — NPU cluster availability, MTBF/MTTR and goodput modeling

[中文说明 (README.zh.md)](README.zh.md) · User manual: [English](docs/USER_MANUAL.html) · [中文](docs/USER_MANUAL.zh.html)

HAC-D is a browser-based reliability-engineering workbench for AI (LLM) training and inference clusters. It takes a cluster design — topology, component classes with 口径-typed failure parameters and provenance, workload, recovery pipeline, spares — and returns availability, MTBF/MTBI, MTTR, goodput and its loss terms, spare counts, N+k replica sizing and the cost of unavailability. It allocates a goodput or availability target to subsystem budgets, compares design options, runs one-at-a-time sensitivity, and cross-checks the closed forms with a Monte Carlo discrete-event simulation. It is grounded in the survey chapter *AI 集群可靠性建模：MTBF、MTTR 与可靠性框图* (2026-10).

## v6 (2026-10-22): input migration pipeline — worksheets, gates, delta, offline bundle

- **Why**: internal hardware FIT, new topologies and new mechanisms have to enter HAC-D from a network where only a limited open-source model runs and nothing may leave. A prompt-based Skill cannot be that migration; a deterministic offline pipeline around the v5 input records can, with the model as one guarded step. Plan and decisions: `docs/markdown/PLAN_V6_INPUT_MIGRATION.md`; runbook for the internal team: `docs/markdown/INGEST_RUNBOOK.md`.
- **Worksheets** (`packages/importers/src/worksheet`): a strict Markdown profile (`hacd-worksheet-1`: YAML front matter, `## sections`, pipe tables with fixed headers, errors with line numbers) for six kinds — topology, fault-rates, device-fit, koujing-mapping, mechanisms (a delta over the default set) and mechanism-proposal — converting both ways to the v5 records; `hacd ingest template <kind>` prints an example that parses as it is. Every public record, the default mechanism set and the ReMAP override round-trip through a worksheet unchanged.
- **口径 normaliser** (`packages/core/src/ingest/koujing.ts`): device failure rates as the source states them (FIT, per 10⁶ h, per hour, MTBF hours, AFR) × the reviewed mapping table (device → fault unit, catalog class, devices per unit, impact factor) → business-impact FIT per unit-hour per class, `FIT = Σ FIT_device × devices per unit × impact factor`, the derivation written into every entry and the confidence set by policy (assumed if any factor or source is an assumption, else derived, else the source type's own). Goldens G7a–G7e, computed independently in Python (`compute_golden_v6.py`).
- **Gates** (`validate.ts`): closed vocabularies including the parameter keys a mechanism actually reads (new `MechanismDef.reads`; three audited transforms read keys they had not declared), provenance completeness, plausibility ×0.1 … ×10 against the unit library, structural consistency of a record, and the id policy — internal records get their own ids beside the public ones, which are never overwritten. A design or mechanism the engine cannot express becomes an extension request for the HAC-D side, structure only.
- **Delta** (`diff.ts`, `packages/reports/src/delta.mjs`): input changes with the source and confidence the new record states, rate changes on the per-unit basis, the KPI rows of the budget before and after (A_op nominal / derated, delivered goodput, MTBF_hw, MTTR_hw, P(window), k, recommended mechanisms and levers) with Δ → `delta.{json,md,zh.md,html}`, a bilingual review page checked at 1280 / 375 px.
- **Extraction worker** (`packages/agent`, new workspace): an OpenAI-compatible adapter (json_schema / guided_json / fenced) for any vLLM / SGLang / llama.cpp-served model, chunking, prompts in two variants with the closed vocabularies, evidence cards (field path, value and unit as written, verbatim quote, location) accepted only when the quote is found in the chunk, the value inside the quote and the two passes agree; review Markdown, jsonl log with prompt hashes, a draft worksheet whose confidence comes from the declared source type, never from the model.
- **CLI** `hacd ingest template | fields | worksheet | import-fit | normalize | validate | dry-run | diff | promote | extract`; **offline bundle** `node scripts/bundle-offline.mjs` → `dist/offline/hacd-<version>.tgz` (esbuild bundle with katex beside it, the `data/` folder as `HACD_DATA`, launchers, templates, docs; Node ≥ 20, no network except the model endpoint you name). Formulas and gates: `docs/markdown/MODEL_REFERENCE.md` §26; maintainer skill `update-inputs`.

## v5 / v5.1 / v5.2 (2026-10-21 / 22): report pipeline from input records; projects; pages merged

- **v5**: the Ascend allocation report set (Methodology, Findings per topology, 100k BOM) is produced from three input records — topology record, failure-rate override, mechanism set (`packages/core/src/records`, JSON in `packages/core/data/{records,fault-rates,mechanism-sets}`, every value with provenance and confidence) — by core primitives (KPI form, MTTR decomposition, layer budget, requirement, window rule, Shapley pruning, hierarchical budget), the bilingual report kit `packages/reports` (recipes as pure functions of the sidecar JSON; `node packages/reports/test/reproduce.mjs` regenerates the six reports byte for byte) and the CLI `hacd findings | bom | budget | methodology | prune | study --record | records | schema --record|--mechanisms|--rates`; goldens G1–G6; parameter reconciliation `docs/markdown/V5_PARAMETER_RECONCILIATION.md`; plan `docs/markdown/PLAN_V5_REPORT_PIPELINE.md`.
- **v5.1**: one **Projects page** (a project = the scenario + the page settings) as the single place to load and save; navigation Projects → Topology & hardware → Allocation → Mechanism library → Fault library; the duplicate allocation views removed (the Topology page's allocation tab, the planner tab and the v3.7 study panel of the Allocation page).
- **v5.2** (2026-10-22): twelve pages merged into eight, one place per function — Projects gains Import and Compare tabs; a new **Review** page holds the checklist with the exports, the Monte Carlo verification and the sensitivity tornado; Inference and Spares are one page behind All pages; the fault types per unit are shown once, on the Topology page's Hardware tab, and the Fault library page is the parameter library. Navigation: Projects → Topology & hardware → Allocation → Mechanism library → Fault library → Review; All pages adds Scenario editor and Inference & spares.

## v4.3 (2026-10-19): user hardware counts

- **Edit counts** on the Topology page's bill of materials: type the number of nodes, CPUs, cabinets, SuperPoDs, interconnect cabinets, switches (per tier), links, transceivers or NPO engines at the current size; the user count replaces that row (kept as a per-NPU ratio at the other sizes) and the evaluator, KPIs, picture and allocation all use it (`topology.countOverrides`, `hacd topology --count ubPodSwitch=200`, MCP `topology_bom` `counts`). Non-applicable counts are ignored and noted.
- The scenario editor's count-rule list offers every scope (adds `cpu`, `ub_switch`, scale-out and the new `rack_switch` / `pod_switch` / `npo_engine`); a class counted outside the template units shows as 'Other components' so the bill of materials always matches the evaluator's hardware rate. Goldens: 9 independent override cases.

## v4.2 (2026-10-19): Atlas 950 to the product-page spec and Atlas 960E

- **Atlas 950 rebuilt from the evidence**: the default SuperPoD is the 1,024-NPU configuration of the product page (16 compute + 4 UB interconnect cabinets, 64 NPUs and 16 Kunpeng per cabinet) with an in-cabinet 2D full mesh (72 low-radix UB switches per cabinet) and 2 × 800G optical links per NPU into a one-tier Clos of 128-port UB switches: 4,096 transceivers per pod, as LightCounting counted on the WAIC 2026 machine. The 8,192-NPU roadmap pod (128 × 100T switches, Hot Chips 2025), the UB-Mesh paper's 4D mesh (64 HRS per 8K) and the v4.1 CloudMatrix384 two-level copy are selectable SuperPoD variants (`SUPERPOD_VARIANTS`). Scale-out: 2 × 400G UBoE per NPU as two planes of a three-tier Clos (128³ / 4 = 524,288, the SuperCluster; assumed).
- **Atlas 960E template** (`a960e-ub`): 56 + 14 cabinets of 72 NPUs and 18 CPUs (4,032 NPUs, single media source), LinkBlade in the cabinet, 126 LinkDevices (176 × 1.6 Tb/s) per pod, NPO optics (5,500 Hi-ONE engines replacing 48,000 × 800G modules per 4,096 NPUs), four-plane two-tier scale-out to 500k (125 SuperPoDs).
- New fabric kinds (`two-level`, `mesh-clos`, `mesh-4d`, `blade-clos`) and multi-plane scale-out in the core, goldens and UI; new switch chips carry the FIT of one CloudMatrix384 UB chip and optical links that of one L1–L2 link (assumed per-unit equivalence).
- Survey: [昇腾下一代集群架构综述（复核与扩展版）](docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html) — Atlas 950 / SuperCluster / 960E, customer deployments with evidence labels, published reliability numbers with their basis, a claim-by-claim review of the Codex draft.

## v4 (2026-10-18): NPU tool, topology first

- **Topology & hardware** is the first page: four Ascend templates — A2 (Atlas 800T A2 servers on a RoCE Clos), A3 / CloudMatrix384 (UB supernode, paper geometry), Atlas 950 (v4.2: the 1,024-NPU SuperPoD of the product page, 16 compute + 4 UB interconnect cabinets with an in-cabinet full mesh and a one-tier optical Clos; the 8,192-NPU roadmap pod, the UB-Mesh paper's 4D mesh and the CloudMatrix384 two-level copy selectable) and Atlas 960E (v4.2: 56 + 14 cabinets of 72 NPUs, NPO optics, LinkBlade + LinkDevice, four-plane two-tier scale-out) — at any scale (built-in 10k / 100k / 200k / 500k NPUs or any N) give the hardware bill of materials (NPUs, nodes, CPUs, cabinets, SuperPoDs, UB L1 / L2 chips or in-cabinet and pod-tier switches, mesh and optical links, NPO engines, scale-out switches per tier and plane and links), a live schematic, the KPI strip and the former Training page as the Reliability tab (`packages/core/src/topology`).
- **Fault types per hardware unit**: the 54-event catalog attached to its units and converted under the CloudMatrix384 geometry (FIT per unit = FIT per card × cards per unit), so the topology changes the interruption rate (A2 3,086 / A3 3,371 / Atlas 950 3,092 / Atlas 960E 3,041 FIT per NPU at 10k); CloudMatrix384 without scale-out reproduces the catalog exactly. Golden vectors in `packages/core/test/golden/compute_golden_v4.py`.
- **Default mechanisms**: the six ReMAP mechanisms (D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST) are applied on every topology scenario and edited on the Mechanisms page, which is now the single owner of the silent-corruption policy and the chain (tabs: selection & attribution, silent corruption & chain, single-point audit).
- **Allocation strategies** (`packages/core/src/strategy`): optimal (least total effort), MTTR reduction preferred and MTTF reduction preferred, over library mechanisms, recovery levers moved to limits and per-class interruption FIT with floors and an effort per halving; hardware split minimum effort / AGREE / ARINC; derated feasibility, slack, ledger check, and the same across sizes (Allocation → Strategies, Cross-scale). CLI `hacd topology`, `hacd strategy`; MCP `topology_bom`, `allocation_strategy`.
- **GPU removed from the UI**: the five GPU examples and the GPU wording left the app (still reachable by id in the CLI / MCP; the GPU tool can be forked from the git tag `v3.7-gpu`); GPU fleet records stay in the library as tagged analogues. Pages: Topology & hardware, Mechanisms, Allocation, Fault library; the scenario editor, Compare, Simulate, Report, Inference, Spares and Import behind "All pages". Plan and decisions: `docs/markdown/PLAN_V4_NPU_TOPOLOGY_FIRST.md`.

## Documentation

- **User manual**: `docs/USER_MANUAL.html` / `docs/USER_MANUAL.zh.html` (self-contained, with screenshots and the methods reference; sources `docs/manual/USER_MANUAL*.src.html`, rebuild with `npm run manual`). Section 15.5 covers the v6 worksheets, gates, delta and the offline bundle; sections 8 to 11 the pages after the v5.2 merge.
- **User guide and plans**: `docs/markdown/USER_GUIDE.md` (pages, "v5 CLI", "v6 ingest"), `docs/markdown/DEVELOPMENT_PLAN.md`, the phase plans `docs/markdown/PLAN_V*.md` (v6: `PLAN_V6_INPUT_MIGRATION.md`), the inside-the-network runbook `docs/markdown/INGEST_RUNBOOK.md`.
- **Specification**: `docs/markdown/SPEC.md` (requirements, data model, KPIs and 口径, interfaces, validation); the input records' JSON Schemas print with `hacd schema --record|--mechanisms|--rates`.
- **Workflows**: `docs/markdown/WORKFLOW.md` (analysis workflow A1–A10 with the v6 internal-input step, development workflow B1–B8); allocation practice `docs/markdown/ALLOCATION_PRACTICE.md`.
- **Skills**: `docs/markdown/SKILLS.md` lists the Claude Code skills in `.claude/skills` (model-check, release-check, scenario-review, allocate-to-target, reference-compare, add-parameter, build-manual, update-inputs).
- **Models**: `docs/markdown/MODEL_REFERENCE.md` (§25 the v5 pipeline, §26 the v6 normaliser, evidence checks and gates); comparisons `docs/markdown/REFERENCE_COMPARISON_100K_500K.md`, `docs/markdown/TRAINING_AVAILABILITY_FORMULAS_AND_COMPARISON.md`; mechanism contributions, formula factors and further methods `docs/markdown/MECHANISM_CONTRIBUTIONS.md` (example `ref-catalog-100k`, 54 events with per-event mechanism flags); three-tool comparison with the reference engine and ReMAP (formulas, 口径, mechanisms, allocation, statistics) `docs/markdown/TOOL_COMPARISON.md` (`scripts/ref-compare-v1.ts` reproduces the reference's version-1 closed form to machine precision); the v5 parameter reconciliation `docs/markdown/V5_PARAMETER_RECONCILIATION.md`.
- **Reports** (`docs/*.html`): the Ascend allocation set (Methodology, Findings per topology, 100k BOM), the scaling and comparison reports, the next-generation survey.

## Quick start

```bash
npm install            # Node 20+, workspaces (core, importers, reports, agent, cli, mcp, web)
npm test               # 817 core + 52 importer + 30 agent + 28 report tests incl. the independently computed golden vectors (v1–v6)
npm run dev            # web app at http://localhost:5173 (bilingual zh/en, light/dark)
npm run build -w @hac-d/web   # static bundle in apps/web/dist
```

CLI (no build step):

```bash
node --import tsx packages/cli/src/main.ts examples                                   # the four topology templates (the built-in examples since v4.1)
node --import tsx packages/cli/src/main.ts example topology-a3-ub384 --npus 200000 > a3.json   # any template at any scale
node --import tsx packages/cli/src/main.ts topology a3-ub384 --npus 10000 --out a3.json   # v4 bill of materials at 10k / 100k / 200k / 500k
node --import tsx packages/cli/src/main.ts strategy --template a3-ub384 --npus 500000 --target 0.985   # v4 allocation strategies
node --import tsx packages/cli/src/main.ts example survey-ex1 > ex1.json   # v3.7 GPU example, reachable by id
node --import tsx packages/cli/src/main.ts eval ex1.json
node --import tsx packages/cli/src/main.ts compare ex1.json nvl72.json
node --import tsx packages/cli/src/main.ts allocate nvl72.json --goodput 0.98 --method arinc
node --import tsx packages/cli/src/main.ts simulate ex1.json --reps 100
node --import tsx packages/cli/src/main.ts example topology-a3-ub384 --npus 384 > cm384.json   # one CloudMatrix384 supernode
node --import tsx packages/cli/src/main.ts measures cm384.json                       # original vs compensated + waterfall
node --import tsx packages/cli/src/main.ts methods book.xlsx                         # which availability methods a spreadsheet uses
node --import tsx packages/cli/src/main.ts import-excel book.xlsx --out imported.json # topology + parameters → scenario, reconciled
node --import tsx packages/cli/src/main.ts export-excel cm384.json cm384.xlsx        # workbook with live formulas
node --import tsx packages/cli/src/main.ts findings --record native950 --out out/950   # v5 report set from the input records (+ bom, methodology, budget)
node --import tsx packages/cli/src/main.ts ingest template topology > my-topology.md  # v6 worksheet example (also fault-rates, device-fit, koujing-mapping, mechanisms, mechanism-proposal)
node --import tsx packages/cli/src/main.ts ingest worksheet my-topology.md --out staging   # → staged records; then: ingest validate staging
node --import tsx packages/cli/src/main.ts ingest diff --before-record native950 --after-record staging/records/<id>.json --out staging/delta   # bilingual review page
node --import tsx packages/cli/src/main.ts ingest promote staging                      # own ids only; then findings on the new inputs
node scripts/bundle-offline.mjs                                                       # offline bundle for the network that holds the documents
```

MCP server for agents (Claude Code: `claude mcp add hacd -- node --import tsx $PWD/packages/mcp/src/server.ts`): tools `list_examples`, `get_example`, `scenario_schema`, `evaluate_scenario`, `compare_scenarios`, `allocate_scenario`, `tornado_scenario`, `simulate_scenario`, `library_search`, and (v2) `excel_method_report`, `import_excel_scenario`, `export_excel`.

## v2 (2026-10-09): Ascend topology, repair paths, sub-health, original vs compensated, Excel

- **Original vs compensated measures** (原始 / 补偿后): every evaluation reports the inherent availability (every unit fault is an outage repaired manually, redundancy removed) next to the compensated one (redundancy, switchover success, automatic recovery, sub-health policy), with a four-step waterfall and a switchover penalty. Strict / tolerant / performance-weighted sub-health measures are shown alongside.
- **Dual-path repair**: automatic coverage `c`, success `s`, automatic and manual MTTR; exact inside k-of-n groups (chain over automatic / manual / switch-failed states), `E[R] = c·T_a + (1 − c·s)·T_m` for series units; the share of events that reach a person is reported.
- **Switchover success rate** on parallel, k-of-n and standby groups, with a per-switchover micro-outage and a failed-switch recovery time.
- **Sub-health** (亚健康): entry rate or steady-state probability, duration, performance factor, escalation, tolerate vs isolate policy with detection; threshold rule (default 0.7 = MindCluster's 30 % degradation); straggler law for synchronous jobs; fabric plane loss as a performance factor.
- **Recovery ladder**: ordered rungs with success probabilities (MindCluster preset: operator-level → process-level online recovery → process / pod / job rescheduling → elastic scale-in → manual).
- **CloudMatrix384 / Atlas 950 presets**: supernode geometry from the Huawei paper (48 nodes × 8 NPU, 7 UB sub-planes × 16 L2 chips, 5,376 optical links) with count scopes for L1/L2 chips, links, transceivers and sub-planes; 104 sourced records in the library (`docs/markdown/ASCEND_SOURCES.md`); failure rates are analogues tagged `assumed`.
- **Excel import / export** (`packages/importers`, SheetJS): method fingerprinting of formulas (A = MTBF/(MTBF+MTTR), series product, rare-event sum, parallel complement, k-of-n COMBIN / BINOM.DIST, switchover weighting, MTTR mixtures, Markov MMULT/MINVERSE …), topology extraction from level columns, indentation, outline levels and the formula dependency graph, conversion to a scenario, reconciliation against the sheet's own numbers, and export of a workbook with live formulas. Nine synthetic fixture workbooks under `packages/importers/test/fixtures`.

## v3 (2026-10-10): silent corruption, mechanism chain, Shapley attribution

- **Silent data corruption at scenario level** (`component.sdc`, `scenario.sdc`): immediate detection coverage and time, fallback discovery delay, optional step recovery; a finite-window alternating-renewal closed form gives the delivered (正确有效) goodput, the expected undetected episodes, the clean-time share, the terminal-discard probability and a window ledger. Validated against independent Python goldens and the ai-cluster-reliability audited engine (93.33 / 62.6 / 45.7 / 25.3 % at 10k / 100k / 200k / 500k cards vs its 93.33 / 62.56 / 45.87 / 25.24 %).
- **Mechanism chain with per-class applicability**: replay → DP-domain elasticity → process rescheduling → global checkpoint recovery, each rung with applicable fraction, success probability and distinct success / failure times; pause-only vs rollback events enter a generalised exact renewal `λ_rb τ/[(e^{λ_rb(τ+δ)} − 1)(1 + λ_rb R_rb + λ_p R_p)]`; detected sub-healthy units are isolated after saving progress.
- **Mechanism library and attribution** (`packages/core/src/mechanisms`): the reference catalog's twelve mechanisms as scenario transforms with target parameters; single, last-added and exact Shapley gains over all 2^n coalitions with the closed forms; a Mechanisms page in the web app.
- **Window-ledger Monte Carlo** (`mc/ledger.ts`): the reference engine's semantics (three fault classes, chain, clean-checkpoint retention, terminal discard) with a conserved ledger, CI, quantiles and P(≥ target); Simulate page default mode.
- Reference fixture `ref-three-classes-100k` (the reference's confirmed baseline; not listed, `hacd example ref-three-classes-100k`) and `scripts/ref-compare-v3.ts` for the cross-check; `docs/markdown/MODEL_REFERENCE.md` §19–§22, `docs/markdown/REFERENCE_COMPARISON_100K_500K.md` §5.
- **Allocation with mechanisms** (v3.1): the Allocation page accepts a delivered-goodput target (feasibility by hardware alone, required silent-corruption detection and fallback delay), and the Mechanisms page plans the cheapest feasible mechanism set by effort score with derated parameters, necessary mechanisms, a coverage × recovery scan and a ledger verification of P(window ≥ target); practice notes in `docs/markdown/ALLOCATION_PRACTICE.md`.

## v3.5 (2026-10-13): from the comparison with the reference engine and ReMAP

- **Terminal rule** of the silent-corruption window: keep the last clean checkpoint (default) or discard the whole window if it ends unresolved (the reference V4 / ReMAP `delivery` rule), closed form by a Poisson-count identity, validated against an independent renewal recursion and the ledger simulation; both values always reported.
- **Statistics**: Student-t half-widths and type-7 quantiles for every simulation mean; Wilson intervals for P(window ≥ target) with a supported / uncertain / below verdict in the planner.
- **Loss budget** over the window ledger on the Allocation page, `hacd allocate` and `allocate_scenario` (proportional / equal / custom weights, levers per line).
- **Proof of infeasibility** in the planner from the checkpoint no-fault bound; **configurable rung order**; **incident-count rate estimation** with exact Garwood intervals (`hacd rate`, `estimate_rate`, component editor).
- `docs/markdown/TOOL_COMPARISON.md` sets HAC-D against the reference engine's V1–V4 and ReMAP (`scripts/ref-compare-v1.ts` reproduces the V1 closed form to machine precision); `docs/markdown/MODEL_REFERENCE.md` §20.1, §19.2, §21.1, §22.5, §7.1, §23.
- v3.7 (2026-10-15): the **mechanism audit catalog** (16 audited mechanisms of 新可靠性机制库 as library entries, audit-only until their integration fields are given or the provisional-assumptions switch is on; custom chain rungs, recovery stage budget with per-class overrides, per-class silent-corruption coverage, asynchronous-save lag), the **single-point benefit audit** and the **cross-scale allocation study** as an Audit & study page, `hacd audit` / `hacd study` and MCP `audit_mechanisms` / `allocation_study`, each writing a standalone HTML report: `docs/markdown/MODEL_REFERENCE.md` §24.
- v3.6: **minimal mode** (the web app opens with the training core; "All pages" restores the rest, nothing removed) and the **ReMAP bridge** (`scripts/remap-bridge.ts` runs ReMAP's vendored engines on a HAC-D scenario and exports a ReMAP audit request; `hacd import-remap` imports a ReMAP / reference event catalog): `docs/markdown/REMAP_INTEGRATION.md`.

## Layout

| Path | What |
|---|---|
| `packages/core` | Numerics: `math` (special functions, Lambert W, RNG, distributions), `units` (口径 conversions), `rbd` (series / parallel / k-of-n / standby / repeat blocks, importance, cut sets), `ctmc` (birth–death, k-of-n repairable, standby with switch, degraded and SDC-latent units), `checkpoint` (Young, Daly, Saxena, first-order goodput with validity flags, TrainMover, Epoch), `sparing` (binomial / Poisson quantiles, blocked probability), `mttr` (six-stage pipeline with scale laws and presets), `allocation` (equal, ARINC, AGREE, feasibility, minimum effort, cost-optimal, availability split, goodput budget), `sensitivity`, `cost`, `mc` (discrete-event simulator), `scenario` (zod schema, structure builder, evaluator, checklist, examples, comparison, tornado, allocation), `library` (parameter records); v5 `records` (topology record, failure-rate override, mechanism set), `budget`, `layers`, `study`; v6 `ingest` (vocabularies, evidence cards, 口径 normaliser, gates, delta, extension requests) |
| `packages/core/data/library.json` | 635 parameter records with 口径 and provenance: 531 from the survey (9 explicit placeholders) + 104 Ascend / CloudMatrix records |
| `packages/core/test/golden` | Golden vectors computed independently in Python (`compute_golden.py` … `compute_golden_v6.py`: v1–v4 models, v5 budget primitives G1–G6, v6 口径 normaliser G7) and the reports of matches |
| `packages/importers` | Spreadsheet importer / exporter: workbook reader, formula fingerprinting, topology draft, scenario conversion, reconciliation, xlsx export; v6 `worksheet`: the Markdown profile, converters both ways for the six worksheet kinds, templates, spreadsheet device table |
| `packages/reports` | Bilingual HTML report kit and the Findings / Methodology / BOM / delta recipes as pure functions of data (byte-identical reproduction of the Ascend set) |
| `packages/agent` | v6 extraction worker: OpenAI-compatible / mock / none adapters, chunking, two prompt variants, evidence cards with grounding and two-pass agreement, review Markdown, draft worksheets |
| `packages/cli` | `hacd` command line (v5 `findings | bom | budget | methodology | prune | study --record | records | schema`, v6 `ingest …`) |
| `packages/mcp` | MCP server over the same core |
| `apps/web` | Vite + React app (v5.2): Projects (list, new, import incl. Excel, compare), Topology & hardware (picture, hardware, reliability), Allocation (strategies, cross-scale, classic methods), Mechanism library, Fault library (parameter library), Review (checklist and exports, simulation, sensitivity); behind All pages: Scenario editor, Inference & spares |
| `docs/markdown` | Development plan, the phase plans v2–v6, model reference (§10–17 v2, §25 v5, §26 v6), user guide, specification, workflows, skills, the ingest runbook, Ascend source notes; `docs/*.html` the report set and the two manuals |
| `scripts` | report builders, screenshots and the manual build, `bundle-offline.mjs` (the v6 offline bundle) |
| `.claude/skills` | `model-check`, `add-parameter`, `scenario-review`, `release-check`, `allocate-to-target`, `reference-compare`, `build-manual`, `update-inputs` |

## Modeling principles

- Every number carries its 口径 (event, denominator, level) and formula; rates of different event classes are never added.
- First-order checkpoint formulas (goodput ≈ 1 − δ/τ − (τ/2 + R)/M) display their validity: (τ+δ)/M and R/M are checked and the restart-dominated regime is flagged; Daly's full model is shown alongside.
- MTTR is a pipeline of stages (detect, localize, remediate, restart, load, recompute) with scale laws, so recovery time grows with N.
- Spares are sized by quantile (binomial P99 / Poisson), never by ratio; block size is checked against the failure domain.
- Non-exponential lifetimes, lemon units, common cause and a finite hot-spare pool are simulated; the Monte Carlo result is compared with the closed form and a disagreement is flagged.
- Parameters from the survey keep their provenance and confidence (measured / paper-reported / vendor / derived / assumed / scan-level); assumed values are meant to be swept, not trusted.
- Original and compensated measures are always both shown, so the credit taken for redundancy, switchover, automation and sub-health handling is explicit (v2).
- A model, where one is used (v6 extraction), never makes a number: it copies facts into evidence cards that grounding and two-pass agreement verify; 口径 comes from a reviewed mapping table and confidence from the source type.

See `docs/markdown/MODEL_REFERENCE.md` for the formulas and their survey anchors, and `docs/markdown/USER_GUIDE.md` for the pages and the CLI.
