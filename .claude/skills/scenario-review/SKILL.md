---
name: scenario-review
description: Apply the survey's 11-item design-review checklist to a HAC-D scenario JSON and write the verdict table with the numbers behind each item. Use when asked to review a cluster design, a scenario file, or to compare design options.
---

# Scenario review

1. Evaluate: `node --import tsx packages/cli/src/main.ts eval <scenario.json>` (add `--json` for the full result; `compare` for several files; `allocate --goodput <G>` for budgets; `simulate --reps 100` for the Monte Carlo cross-check).
2. Report the checklist verdicts (口径, own rates, δ exposed only, τ+δ ≪ M and R ≪ M, recovery read bandwidth, spares by quantile, spare granularity vs failure domain, MTTR staged, independence/exponential, fail-slow & SDC, monetised + cross-validated) with the numbers that justify each.
3. Call out: the regime (checkpoint- vs restart-dominated), the dominant component class, the dominant recovery stage, and whether the Monte Carlo disagrees with the closed form.
4. Flag every `assumed` or `vendor` parameter and recommend a sweep range instead of a point value.
