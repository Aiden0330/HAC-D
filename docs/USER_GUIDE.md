# User guide

The app has nine pages; all of them read the **active scenario** chosen in the top bar. Scenarios are stored in the browser (localStorage) and can be exported/imported as JSON. Theme (auto/light/dark) and language (中文/EN) toggles are in the top bar.

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
`hacd measures`, `hacd methods <book.xlsx>`, `hacd import-excel <book.xlsx> [--sheet S] [--out scenario.json]`, `hacd export-excel <scenario.json> [out.xlsx]`; MCP tools `excel_method_report`, `import_excel_scenario`, `export_excel`. Examples `ascend-cm384` and `ascend-atlas950` are built in.

### Sizing 100k / 200k / 500k-NPU clusters (supernodes)
Do not model such a cluster as one synchronous training job (the 1/N law makes the first-order goodput formula invalid there and the tool flags it). Model it as **N + k supernodes**:

1. Load `ascend-supercluster-100k` (or any CloudMatrix384 / Atlas 950 scenario) and set the workload type to inference.
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
Pick the mechanisms to attribute (default: the reference's six candidates D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST), choose the value function (delivered goodput, effective goodput or A_op) and press Attribute: the page strips the selected mechanisms from the scenario (baseline), evaluates all 2^n combinations with the closed forms and shows single gains, last-added gains and exact Shapley values (they sum to the combined gain). The library table lists all twelve reference mechanisms with change, prerequisite, failure path, confidence and editable target parameters; Apply writes a mechanism's parameters into the active scenario, Remove takes it out again.

### Simulate page
The default mode is now the **window ledger**: a finite-window simulation with the same semantics as the reference engine (three fault classes, mechanism chain, sub-health isolation, silent corruption with clean-checkpoint rollback and terminal discard). It reports the delivered goodput with its confidence interval and quantiles, A_op, P(delivered ≥ target), the probability of ending dirty, the mean ledger and the attribution by class, and compares with the closed form (delta badge). The previous unit-level job simulation (Weibull lifetimes, spares, common cause) is still available as the second mode.

### Compare / Report
The Compare table and the tornado carry a Delivered column / metric; the HTML report and the Excel export list the delivered goodput and A_op.

### Allocation page with silent corruption (v3.1)
When the scenario carries silent corruption, the Allocation page offers a **target basis**: *effective goodput* (performance, as before) or *delivered goodput* (default when silent corruption is present). On the delivered basis the page first checks whether the target is reachable by hardware alone (failure rates → 0 under the current silent-corruption policy); if not, it reports the immediate detection coverage q* and the fallback delay D* that would reach the target with the hardware as is, raises the coverage to q* for the budgets, converts the delivered target into the effective and interruption targets (÷ delivery factor ÷ sub-health factor), and then apportions the interruption budget to the component classes and recovery stages as usual. When the target is already met, the rate table shows how far each class may degrade (improvement factors below 1).

### Mechanisms page: plan to target (v3.1)
Set a target and press Plan: the page evaluates every combination of the selected mechanisms (nominal and with the library's assumed parameters derated: coverage −5 points, success −8 points, times ×1.5), returns the cheapest feasible set by effort score (editable in the library table), the mechanisms present in every feasible set, the effort–value Pareto front, a scan of silent-corruption detection coverage × automatic recovery time on top of the plan, and, when enabled, a ledger simulation of the plan with P(window ≥ target) against a confidence level. The procedure and the cross-field references are in `docs/ALLOCATION_PRACTICE.md`; `hacd plan` and the MCP tool `plan_mechanisms` expose the same function.
