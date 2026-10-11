---
name: scenario-review
description: Apply the survey's 11-item design-review checklist to a HAC-D scenario JSON and write the verdict table with the numbers behind each item, including the v3 fault classes (sub-health, silent corruption) and the mechanism chain. Use when asked to review a cluster design, a scenario file, or to compare design options.
---

# Scenario review

1. Evaluate: `node --import tsx packages/cli/src/main.ts eval <scenario.json>` (`--json` for the full result; `compare` for several files; `measures` for original vs compensated; `allocate --goodput <G> --basis delivered` for budgets; `mechanisms` for Shapley gains; `ledger --trials 300 --target <G>` and `simulate --reps 100` for the Monte Carlo cross-checks).
2. Report the checklist verdicts (口径, own rates, δ exposed only, τ+δ ≪ M and R ≪ M, recovery read bandwidth, spares by quantile, spare granularity vs failure domain, MTTR staged, independence / exponential, fail-slow & SDC, monetised + cross-validated) with the numbers that justify each.
3. Call out: the headline model (first order vs exact renewal) and the regime, the dominant component class, the dominant recovery stage, the window ledger (where the time goes: downtime, saves, rollback, slow-down, SDC rollback, terminal discard), whether delivered differs from effective goodput, the necessary mechanisms if a target is given, and whether the simulations disagree with the closed forms.
4. Flag every `assumed` or `vendor` parameter and recommend a sweep range or a derated evaluation (the planner's derating: coverage −5 pts, success −8 pts, times ×1.5) instead of a point value.
5. Keep 口径 separate: never add interruption, sub-health and silent-corruption rates; quote the fault-class shares explicitly.
