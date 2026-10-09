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
