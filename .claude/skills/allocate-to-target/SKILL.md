---
name: allocate-to-target
description: Allocate an availability or goodput target to component classes, recovery stages and fault-management mechanisms with HAC-D (delivered basis, required silent-corruption detection, cheapest feasible mechanism set with derated parameters, per-window probability). Use when asked how to reach X % goodput or availability at N cards, which mechanisms to adopt, or how to budget failure rates.
---

# Allocate to a target

Procedure (docs/ALLOCATION_PRACTICE.md, docs/WORKFLOW.md §A):

1. Fix the 口径: delivered goodput (正确有效产出) when silent corruption is in the scenario, effective goodput otherwise, or A_op; state the window (durationDays) and whether the target is a mean or a per-window probability.
2. Scale the scenario to the target size (`workload.nGpus`); keep a copy at the largest N that will run.
3. Hardware side: `node --import tsx packages/cli/src/main.ts allocate <s.json> --goodput <G> --basis delivered --method arinc`. Read: reachable by hardware alone, immediate detection needed q*, fallback delay needed D*, loss budget vs current loss, allowed λ per class and MTBF per unit, stage budgets. If "NOT feasible", the first lever is detection, not rates.
4. Mechanism side: `node --import tsx packages/cli/src/main.ts plan <s.json> --target <G> --trials 200`. Read: cheapest feasible set (effort), necessary mechanisms, Pareto front, the coverage × recovery scan, and the ledger verification P(window ≥ target) against the confidence (default 90 %). Adjust effort scores or parameters per mechanism on the web page (library table) or through the MCP tool `plan_mechanisms` when the user has better numbers.
5. Attribution for the write-up: `mechanisms <s.json>` gives single, last-added and Shapley gains; substitutes (replay, elastic, process) show diminishing returns, complements (D-SDC + R-SDC) only pay together.
6. Report: a table of levers (necessary / chosen / optional) with nominal and derated values, the remaining hardware budget per class (ARINC or AGREE), the verification result, and the assumptions flagged (library parameters are targets and priors).
7. Re-run at the largest N: detection and recovery losses grow ∝ N, the checkpoint term ∝ √N, silent-corruption episodes ∝ N.
