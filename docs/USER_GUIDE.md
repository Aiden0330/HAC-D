# User guide

## v4 (2026-10-18)

The main flow has four pages (minimal mode); **All pages** adds the scenario editor, Compare, Simulate, Report, Inference, Spares & domains and Import. All pages read the **active scenario** chosen in the top bar. Since v4.1 the built-in examples are exactly the three topology templates (`topology-a3-ub384`, `topology-a2-roce`, `topology-a950-ub2`, 10,000 NPUs with the six default mechanisms); the scale is a parameter (built-in 10k / 100k / 200k / 500k or any N), so no per-size or per-design example exists. The reference fixtures `ref-catalog-100k` and `ref-three-classes-100k` stay reachable by id (`hacd example <id>`, MCP `get_example`) for the reference / ReMAP cross-checks.

| Page | What you do there | What you get |
|---|---|---|
| Topology & hardware | pick a template (A2 · RoCE, A3 · CloudMatrix384, Atlas 950), a scale (built-in 10k / 100k / 200k / 500k or any N), hardware parameters, FIT per unit, workload and targets, recovery | KPI strip (A_op, delivered goodput, MTBI, mean pause, interruption FIT per NPU); tabs **Picture** (live schematic), **Hardware** (bill of materials at the four scales, fault types per unit with editable FIT), **Reliability** (the former Training page), **Allocation** (the three strategies at the A_op target) |
| Mechanisms | select players, attribute; edit the silent-corruption policy and the chain (single owner); run the single-point audit | single / last-added / Shapley gains, library table, audit report |
| Allocation | target and metric, strategy, hardware split, candidate mechanisms, recovery limits, FIT floors and effort per halving | the three strategies compared, steps, allowed FIT per class, alternatives, ledger check; cross-scale table and detailed study; the classic budget methods; the mechanism planner |
| Fault library | filter the per-unit fault types and the parameter library | 60 per-unit fault types with their conversion; 635 records, GPU-measured ones tagged as analogues |

Switching template carries the NPU count, job settings, mechanisms and FIT edits by default. Edits under the applied mechanisms go to the bare design and the mechanisms are re-applied, so settings a mechanism owns (C-FAST's τ / δ, D-HARD's detection, D-SDC's coverage) stay with it. The sections below describe the v3 pages; the Training page is now the Reliability tab, the Scenario page the scenario editor, the Audit page the third Mechanisms tab and the Allocation cross-scale study.

## v3 pages

The app had nine pages; all of them read the **active scenario** chosen in the top bar. Scenarios are stored in the browser (localStorage) and can be exported/imported as JSON. Theme (auto/light/dark) and language (中文/EN) toggles are in the top bar.

| Page | What you do there | What you get |
|---|---|---|
| Scenario | Load an example (survey worked examples 1/3/4, NVL72 design), edit topology, workload, recovery pipeline (preset or custom stages with scale laws), spares policy, targets, costs, and the component table (count rule, λ with unit, MTTR, redundancy, common-cause β and domain, fail-slow); or edit the JSON directly | Availability / goodput headline, auto-laid-out reliability block diagram (hover a block for A, λ_eq, MTTF, MTTR), structure notes |
| Training | — | Effective goodput (hero), MTBI, R(N), τ, lost $/day, wall-clock; regime banner with (τ+δ)/M and R/M; loss decomposition bar; recovery stage table; scale extrapolation chart with caution/invalid bands; goodput-vs-interval curve with the optimum; interruption share by component |
| Inference | needs an inference workload | Capacity availability for the configured k, k required for the target, service-up availability, replica MTBF/MTTR, failures/day, idle spare cost; curve and table over k |
| Spares & domains | — | Hot spares by binomial quantile and by Poisson/replenishment, repair pipeline, replacements over the job; heat map of required spares over node MTBF × MTTR; spares vs coverage quantile |
| Allocation | choose goodput / availability targets, method, restart share | Loss budget and current loss; keep-R / keep-λ / balanced requirements; allowed λ per component class with improvement factors; allowed time per recovery stage; availability split |
| Compare | select 2–4 scenarios | KPI matrix with ★ best per metric, goodput and lost-$ bars, tornado of the active scenario (×½ / ×2 on every component rate, recovery, δ, hot spares, β) |
| Simulate | replications, seed, simulated work hours → Run | Monte Carlo goodput with CI and quantiles vs the closed form (agreement badge), MTBI, interruptions, blocked fraction, peak spares P99, goodput histogram, failures by class |
| Report | — | 11-item design-review checklist with verdicts, block diagram, importance measures, minimal cut sets, assumptions and warnings; export self-contained HTML report, components CSV, scenario JSON |
| Library | filter by class, confidence, stage, text | 531 survey-sourced records with 口径, applicability, provenance and caveats; "Use as rate" copies a record's rate, 口径 and provenance into the selected component of the active scenario |

Every chart has a **Table** toggle (the accessible twin), hover tooltips, and shows its formula underneath. Numbers marked `assumed` or `vendor` in the component table should be swept (Compare → tornado) rather than trusted.

## Typical workflows

1. **Evaluate a design**: load `nvl72-16k`, adjust counts and rates, read Training; check the Report checklist; export the HTML report.
2. **Size spares**: Spares page gives P99 hot spares and the MTBF–MTTR map; set `hotSpareNodes` in Scenario to see the blocked probability and effective goodput.
3. **Allocate a target**: set the goodput target (e.g. 0.97) in Scenario → Allocation; choose ARINC for proportional tightening or minimum effort to see which subsystems must improve.
4. **Compare options**: duplicate the scenario, change one thing (dual ToR, replica recovery, more spares), then Compare.
5. **Validate with simulation**: Simulate with 100–200 replications; if the badge says the Monte Carlo disagrees, trust the simulation (non-exponential inputs, correlated failures or a too-small spare pool are the usual causes).


## v2 additions (2026-10-09)

### Original vs compensated measures
The Scenario page's KPI row shows both the compensated availability (after redundancy, switchover success, automatic recovery and the sub-health policy) and the original one (every unit fault is an outage repaired manually, redundancy removed). The Report page has a dedicated card: KPIs, a waterfall of unavailability by step (original → + redundancy → + automatic recovery → + sub-health policy), the switchover penalty, the share of events that need a person, and a table of the strict / tolerant / performance-weighted measures. The Compare page carries the original availability, the performance-weighted availability and the human fraction as extra columns. Formulas: `docs/MODEL_REFERENCE.md` §10–§17.

### Scenario editors
- **Supernode geometry**: pick `CloudMatrix384 (Atlas 900 A3)`, `Atlas 950 SuperPoD` or `Custom`; the per-node composition, racks, UB sub-planes, L2 chips, ports, links per L1 chip and transceivers per link become editable, and the derived counts (nodes, supernodes, L1 / L2 chips, links, transceivers) are printed. Component classes can then be counted per `supernode`, `comm_rack`, `l1_switch`, `l2_switch`, `subplane`, `optical_link` or `transceiver`. Fields that are not public are listed as assumed.
- **Measures**: sub-health threshold φ_min (sub-health below it counts as down), communication share f_comm (plane-loss performance factor), headline measure.
- **Recovery**: the preset selector now offers pipelines and ladders. A ladder (e.g. `mindcluster-a3`) shows every rung with its reach probability and share of E[T]; `Customise rungs` makes the rungs editable.
- **Component details** (the `Details` button on a row): dual-path repair (automatic coverage, success, automatic MTTR, manual MTTR), common cause, sub-health (entry rate, duration, performance, escalation, tolerate / isolate policy with detection), switchover (success probability, outage per switchover, failed-switch recovery) for redundant groups, and the provenance text.

### Training page
When any class has sub-health, a card shows P(job slowed), the job performance factor φ_job and the isolation-induced interruption rate (straggler law). With a ladder, the recovery card lists the rungs instead of the pipeline stages and the KPI note shows P(person needed).

### Import page
1. Choose an `.xlsx`, `.xls` or `.csv` workbook; pick the sheet.
2. **Methods detected**: the formula fingerprints (A = MTBF/(MTBF+MTTR), λ = FIT·1e-9, series product vs 1 − ΣU, parallel complement, k-of-n via COMBIN / BINOM.DIST / explicit sums, switchover weighting, MTTR auto/manual mixture, Markov MMULT/MINVERSE, percent conversions) with notes on approximations.
3. **Column roles**: guessed from zh/en headers; change any role from the dropdown.
4. **Extracted topology**: the tree (series / parallel / k-of-n / standby, counts, n/k, parameters, switchover success) with the evidence for each node (level column, indentation, outline level, formula references, redundancy text). `Import as scenario` creates a scenario with a custom structure and cell-level provenance.
5. **Reconciliation**: HAC-D's availability per block next to the sheet's cached value and the method it used; files saved without calculation carry no cached values, in which case only the structure is compared.
6. `Export the active scenario to Excel` (also on the Report page) writes a workbook whose Structure sheet holds the combination formula of every block next to HAC-D's value, plus Inputs (E[R], unit availability formulas), Results (measures, waterfall) and Formulas.

Diagram / image import is not built; it will produce the same topology draft and reuse steps 3–5.

### CLI and MCP
`hacd measures`, `hacd methods <book.xlsx>`, `hacd import-excel <book.xlsx> [--sheet S] [--out scenario.json]`, `hacd export-excel <scenario.json> [out.xlsx]`; MCP tools `excel_method_report`, `import_excel_scenario`, `export_excel`. For a CloudMatrix384 or Atlas 950 workbook start from the `topology-a3-ub384` / `topology-a950-ub2` template (`hacd example topology-a3-ub384 --npus 384`).

### Sizing 100k / 200k / 500k-NPU clusters (supernodes)
Do not model such a cluster as one synchronous training job (the 1/N law makes the first-order goodput formula invalid there and the tool flags it). Model it as **N + k supernodes**:

1. Pick the A3 · CloudMatrix384 or Atlas 950 template at the pool size on the Topology page and set the workload type to inference in the scenario editor.
2. Press `= supernode` next to "GPUs per replica" so one replica unit is one supernode (384 NPUs for CloudMatrix384, 8,192 for Atlas 950).
3. Enter either the cluster size (100,000 / 200,000 / 500,000) into "Cluster size" or the number of supernodes directly into "Supernodes required (N)" and "Spare supernodes (k)" (the fields take these names as soon as one replica is one supernode); 261 / 521 / 1,303 CloudMatrix384 supernodes correspond to the three sizes, and the Scenario KPI shows the supernode, node, L1/L2 chip and link counts. For a training job the field "Supernodes used by the job" sets Job NPUs = supernodes × supernode size.
4. The Inference page then reports the supernode MTBF and MTTR (every class at or below supernode scope, including the UB fabric, racks' power and the scale-out leaf/spine switches, folded into one unit), the expected number of supernodes out of service, the capacity availability for the configured spares, and `k*`, the spare supernodes needed for the capacity target.

With the example's analogue rates a CloudMatrix384 supernode has an MTBF of about 138 h and a repair time of 1.5 h, so about 1.1 % of supernodes are down at any time: 100k NPUs need 9 spare supernodes for 99.9 % capacity availability, 200k need 14 and 500k need 27.

### Training availability models (v2.1)
The Training page lists five models side by side (operational A_op, first order, product form, exact renewal, Daly full) and marks the headline with ★: the first-order value while (τ+δ)/M and R/M are small, the exact renewal value otherwise; the scale table shows both columns. "Measured lost computation per failure W" in the workload editor replaces τ/2 when you have replay logs. The recovery selector offers "MTTR mixture (detection + automatic + manual)" with detection coverage, automatic detection delay, timeout fallback, automatic success and duration, and manual duration; R = T_det + T_auto + (1 − p_s)·T_manual.

## v3 additions (2026-10-10): silent corruption, mechanism chain, attribution

### Delivered goodput (正确有效产出)
When any component class carries a silent-corruption rate, the Training page headlines the **delivered goodput**: the correct progress retained at the end of the job window divided by the window length. The performance goodput (hard interruptions, sub-health, chain) is shown next to it with the delivery factor. The "Silent corruption over the job window" card gives the episode rate ν, the expected number of undetected episodes and how many are discovered inside the window, the clean / dirty / pause shares, the probability of still being dirty at the end, and the no-recovery factor for comparison. The job-window ledger shows every share of the window once (downtime, saves, rollback, slow-down, elastic domain loss, spares, SDC rollback, terminal discard, delivered).

### Scenario page
- **Silent corruption policy (job level)**, under Measures: immediate detection coverage q and time, fallback discovery delay (120 h in the reference baseline), optional step recovery (redo at most 1 s, recover in 1 s). Per-class silent rates are set in the component Details ("Silent corruption" checkbox + rate per unit-hour).
- **Recovery mechanism chain**: enable replay (no rollback), DP-domain elasticity (no rollback, domain out for 180 s, 1 s global sync) and process rescheduling (rollback) with success probabilities and success / failure times; each class declares in Details → "Mechanism applicability" the fraction of its interruptions a mechanism can act on (the reference catalog's flags, aggregated per source in the built-in examples). Interruptions then run replay → elastic → process → global checkpoint recovery; detected sub-healthy units are isolated after saving progress (pause without rollback).
- Example **"Reference baseline, three fault classes"** reproduces the reference tool's confirmed baseline (interruption 96.6 %, sub-health 2 %, silent 1.4 %; delivered 62.6 % at 100k cards).

### Mechanisms page
Pick the mechanisms to attribute (default: the reference's six candidates D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST), choose the value function (delivered goodput, effective goodput or A_op) and press Attribute: the page strips the selected mechanisms from the scenario (baseline), evaluates all 2^n combinations with the closed forms and shows single gains, last-added gains and exact Shapley values (they sum to the combined gain). The value function evaluates only the training block of each coalition (`evaluateScenario(s, { structure: false })`: no block structure, importance measures or cut sets), so ten players on the 54-event catalog take about a second; the button counts the coalitions evaluated, the compute worker runs one job at a time (an attribution and a plan queue) and Cancel restarts it. The library table lists all twelve reference mechanisms with change, prerequisite, failure path, confidence and editable target parameters; Apply writes a mechanism's parameters into the active scenario, Remove takes it out again.

### Simulate page
The default mode is now the **window ledger**: a finite-window simulation with the same semantics as the reference engine (three fault classes, mechanism chain, sub-health isolation, silent corruption with clean-checkpoint rollback and terminal discard). It reports the delivered goodput with its confidence interval and quantiles, A_op, P(delivered ≥ target), the probability of ending dirty, the mean ledger and the attribution by class, and compares with the closed form (delta badge). The previous unit-level job simulation (Weibull lifetimes, spares, common cause) is still available as the second mode.

### Compare / Report
The Compare table and the tornado carry a Delivered column / metric; the HTML report and the Excel export list the delivered goodput and A_op.

### Allocation page with silent corruption (v3.1)
When the scenario carries silent corruption, the Allocation page offers a **target basis**: *effective goodput* (performance, as before) or *delivered goodput* (default when silent corruption is present). On the delivered basis the page first checks whether the target is reachable by hardware alone (failure rates → 0 under the current silent-corruption policy); if not, it reports the immediate detection coverage q* and the fallback delay D* that would reach the target with the hardware as is, raises the coverage to q* for the budgets, converts the delivered target into the effective and interruption targets (÷ delivery factor ÷ sub-health factor), and then apportions the interruption budget to the component classes and recovery stages as usual. When the target is already met, the rate table shows how far each class may degrade (improvement factors below 1).

### Mechanisms page: plan to target (v3.1)
Set a target and press Plan: the page evaluates every combination of the selected mechanisms (nominal and with the library's assumed parameters derated: coverage −5 points, success −8 points, times ×1.5), returns the cheapest feasible set by effort score (editable in the library table), the mechanisms present in every feasible set, the effort–value Pareto front, a scan of silent-corruption detection coverage × automatic recovery time on top of the plan, and, when enabled, a ledger simulation of the plan with P(window ≥ target) against a confidence level. The procedure and the cross-field references are in `docs/ALLOCATION_PRACTICE.md`; `hacd plan` and the MCP tool `plan_mechanisms` expose the same function.

### Reference catalog example and mechanism contributions (v3.2)
The reference fixture `ref-catalog-100k` (not in the app's list; `hacd example ref-catalog-100k`, then Import JSON) is the reference's three-class baseline at catalog granularity: 54 component classes (18 hardware domains × interruption / sub-health / silent) with each interruption event's own replay / process / elastic flags. Job-level totals equal the four-source example; use the catalog example on the Mechanisms page when attributing or planning *combinations* of mechanisms (per-event flags reproduce the reference tool's combined scenario; per-source fractions over-credit it). Contribution tables for every mechanism, the formula factor each one moves, and a survey of further methods (in-memory checkpoints, hot-swap, pipeline rerouting, online SDC detection, straggler sweeps, failure prediction, lemon eviction, fault-tolerant collectives, warm spare pools) are in `docs/MECHANISM_CONTRIBUTIONS.md`.

### Library entries from the literature and side-by-side gains (v3.2)
Seven mechanisms were added from the 2023–2026 literature: P-PREDICT (failure prediction with pre-emptive migration), R-NETFAIL (fault-tolerant collectives), R-HOTSWAP (hot-swap of failed devices), C-MEM (in-memory / tiered checkpointing), D-SDC-DMR (dual modular redundancy or two-stage integrity checks for silent corruption), H-LEMON (lemon-node eviction) and H-SWEEP (offline node sweeps). Entries that cost throughput even without failures carry a fault-free overhead that multiplies the goodput (shown as a ledger line; A_op unaffected). The Scenario page's chain editor gained the three new rungs and per-class applicability fields (predict, net failover, hot-swap); the attribution table on the Mechanisms page shows the gains on A_op and on delivered goodput side by side whatever value function was chosen. The contribution report `docs/MECHANISM_CONTRIBUTIONS.md` §7 gives the numbers.

### Mechanisms page scenario (v3.2, decision 2026-10-12)
The Mechanisms page has its own scenario selector and works on the active scenario by default (v4: the topology scenarios carry the catalog's per-event mechanism flags, so combinations are attributed exactly; the imported `ref-catalog-100k` fixture reproduces the reference tool's combinations); any scenario can be chosen there, and "Apply / Remove" act on the chosen one. A warning appears when the chosen scenario declares applicability as per-class fractions (independent fractions over-credit combinations). The other pages (Training, Allocation, Compare, Simulate, Report) keep working on the active scenario, so allocation to the four sources and attribution on the catalog can be used side by side.

### Allocation methods and class weights (v3.3)
The six methods differ only in how the job-level budget is split across classes; the KPI tiles are the same for every method. Equal, AGREE and feasibility coincide whenever every class has the same unit count, importance and feasibility weight (the reference examples), and minimum-effort and cost-optimal keep the current rates when the budget is already met; the page says which methods coincide. The "Class weights used by the methods" table lets you set the AGREE importance, the feasibility weight, the cost coefficients a and b, and mark classes as fixed; the values are saved in the scenario (`component.allocation`).

## v3.5 additions (2026-10-13): from the comparison with the reference engine and ReMAP

### Terminal rule of the silent-corruption window
The Scenario page's silent-corruption policy has a **Terminal rule**: *keep the last clean checkpoint* (the audited review engine, default) or *discard the whole window if it ends unresolved* (the reference V4 and ReMAP legacy `delivery` rule). The Training page's silent-corruption card shows the rule, the delivered goodput under the other rule and P(unresolved at end); the ledger simulation applies the rule per window. The two rules are different metrics: never compare them as one number (`docs/MODEL_REFERENCE.md` §20.1).

### Rung order
The mechanism chain editor lists the detection-delayed rungs (replay, hot-swap, elastic, process) in the order they are tried; ↑ moves a rung earlier. Prediction and network failover always act first (§19.2).

### Intervals and verdicts
Simulation means now carry Student-t 95 % half-widths and type-7 quantiles; P(window ≥ target) and P(unresolved at end) carry Wilson intervals. The planner's verification says *supported* when the Wilson lower bound reaches the confidence, *below* when the upper bound misses it, *uncertain* otherwise (§21.1).

### Loss budget on the Allocation page
With a delivered target the Allocation page shows the loss budget over the window ledger: (1 − G*) × window split over the nine ledger lines proportionally to the current ledger, equally, or by custom weights, with current, allowed, excess and the levers that move each line (§7.1). `hacd allocate` prints the same table; `allocate_scenario` takes `lossMethod` and `lossWeights`.

### Proof of infeasibility in the planner
Every coalition carries its no-fault bound (the checkpoint saves alone cap the window at (⌊S/L⌋τ + min(S mod L, τ))/S); a target above the best bound is reported as *proven infeasible by the checkpoint saves* instead of "not found" (§22.5).

### Failure rates from incident counts
The component details carry *Rate from incident counts*: events over units × hours observed give the rate, FIT, MTBF and the exact Garwood interval (zero events: the one-sided upper bound −ln(1 − c)/E, used as the rate); *Use as measured rate* writes it into the class with provenance `measured` and the derivation. Also `hacd rate <events> <unitHours>` and the MCP tool `estimate_rate` (§23).

## v3.6 (2026-10-13): minimal mode and the ReMAP bridge

### Minimal mode
The web app opens in **Minimal** mode: Scenario, Training, Mechanisms, Allocation, Import and Library. The header toggle **All pages** adds Inference, Spares & domains, Compare, Simulate and Report; the choice is remembered in the browser. Nothing is removed: every function stays in the core, the CLI and the MCP server, and the manual's screenshots show all pages. Keep Simulate in mind when inputs are non-exponential or correlated (the closed forms are flagged and the Monte Carlo route is on that page; `hacd simulate` / `hacd ledger` do the same from the command line).

### Using ReMAP's models with HAC-D
`docs/REMAP_INTEGRATION.md` describes the three ways the tools work together: `scripts/remap-bridge.ts` runs the expert engines ReMAP vendors (the audited 54-event review engine and the V4 monthly engine) on any HAC-D scenario and compares them with HAC-D's closed forms and ledger simulation, exporting the engine inputs and a ReMAP audit request; `hacd import-remap` turns a ReMAP / reference event catalog (`inputs.json`, `events.json`, frozen run inputs) into a HAC-D scenario at catalog granularity; and HAC-D's closed forms, planner, allocation and mechanism library sit on top of ReMAP's calibrated catalogs and reports. The bridge needs the untracked `remap/remap-main` drop (`--remap <dir>` or `REMAP_DIR`).

## v3.7 (2026-10-15): the mechanism audit catalog and the Audit & study page

### The 16 audited mechanisms
The library now has 35 entries: the 19 of v3.6 plus the 16 of the mechanism audit of 2026-10-14 (link-transparent recovery, fabric re-route with degraded running, fault containment, control-plane continuity, warm standby process, runtime snapshot, asynchronous and compressed checkpoints, recovery-action classification, FP8 / FP4 / ABFT / network silent-corruption detection, online screening, HCCL elastic rebuild, CANN graph caches). Each entry keeps the audit's principle, trigger, workflow, success criteria, overlap rules and sources. The four integration fields the audit leaves null (eligible share of the candidate events, conditional success, failure-attempt seconds, steady overhead; the precision path's risk share for FP8 / FP4) keep those mechanisms **audit-only** until you enter values or switch on **use provisional assumptions** (Mechanisms page and Audit page): the provisional values are tagged assumed and the planner derates them. Mechanisms acting on the same recovery stage (startup: warm process, snapshot, graph caches; read: compression, in-memory loading) take the minimum, never the sum; I-CONTAIN adds nothing on top of DP-domain elasticity; R-HCCL-ELASTIC needs R-ELASTIC.

### Audit & study page
1. **Single-point benefit audit**: pick mechanisms (audited 16 by default, or all 35), optionally switch on the provisional assumptions, click *Run audit*. The table gives each mechanism's metric and 口径, baseline → target, single-point gain and, where the transform can act, the cluster-level ΔA_op and Δdelivered at the scenario's size. *Download HTML report* writes the standalone page in the structure of the audit deliverable (cards, notes, flow, stage budget, summary table, sensitivity, one article per mechanism, JSON export inside the page); *Download JSON* writes the data.
2. **Cross-scale allocation study**: sizes, target, metric (A_op, delivered or effective goodput), candidate mechanisms (more than 10 → greedy planner, more than 12 → sampled Shapley), verification windows, seed, derating, levers and curves; click *Run study* (about 30 s for four sizes with 200 windows; Cancel restarts the worker). The table gives per size the baseline, the recommended set with effort, nominal / derated values, the residual hardware factor and the verification; the embedded report carries the full study (budgets, levers, three charts, mechanism parameters, FIT allocation per domain, conclusions) and can be downloaded as HTML or JSON.
3. CLI `hacd audit`, `hacd study` and MCP `audit_mechanisms`, `allocation_study` produce the same reports (`--html` / `htmlPath`).

### What changed in the models
Custom chain rungs (`mechanisms.custom`, per-class applicability), the automatic attempt's stage budget with per-class overrides (`recovery.automatic.stages`, `component.recoveryStages`), per-class silent-corruption coverage (`component.sdc.coverage`, rate-weighted) and the durable lag of asynchronous saves (`workload.rollbackLagS`). Defaults reproduce every v3.6 number; `docs/MODEL_REFERENCE.md` §24.
