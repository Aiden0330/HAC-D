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
