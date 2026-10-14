---
name: reference-compare
description: Cross-check HAC-D against the ai-cluster-reliability reference engine (audited 30-day discrete-event simulator) on its confirmed baseline at 10k–500k cards, for hard interruptions, sub-health, silent corruption, mechanisms and Shapley values. Use after changing training, SDC, chain or ledger models, or when asked how HAC-D compares with the reference.
---

# Reference comparison

The reference tool lives in the untracked folder `ai-cluster-reliability-main/` (user-provided drop, ignored by git; never commit it). Its audited engine: `catalogs/review-2026-10-09/engine.cjs`; published means with CI: `results.json` (4000 trials per scenario); mechanism catalog `mechanisms.json`; parameters `mechanism-policy.json`; inputs `inputs.json` (54 events).

Scripts:
- `node scripts/ref-run.cjs 400` runs the reference engine at 100k / 200k / 500k cards for stages 0 (hard), 1 (+ sub-health), 2 (+ silent corruption).
- `node --import tsx scripts/ref-compare.ts 20` runs HAC-D closed forms and the unit-level Monte Carlo on the hard-only and sub-health baselines.
- `node --import tsx scripts/ref-compare-v3.ts 200` runs HAC-D three-class closed forms, the ledger simulation, single mechanisms and the six-player Shapley at 10k–500k against the published means.

The reference's version-1 closed form is HAC-D's exact renewal: `node --import tsx scripts/ref-compare-v1.ts` must agree to machine precision (docs/TOOL_COMPARISON.md §3.3). ReMAP (`remap/remap-main/`, untracked) vendors the same engines; `node --import tsx scripts/remap-bridge.ts <scenario|example> --trials 4000 --engine review --no-ledger` runs them on any HAC-D scenario and must agree with the closed form within the engine's CI (docs/REMAP_INTEGRATION.md); docs/TOOL_COMPARISON.md lists ReMAP's additions.

Expectations (docs/REFERENCE_COMPARISON_100K_500K.md): hard-only exact renewal within 0.05 pt of the reference useful throughput; A_op within 0.01 pt; three-class delivered goodput inside the reference CI (93.33 / 62.56 / 45.87 / 25.24 ± 0.26–0.46 at 10k / 100k / 200k / 500k); single-mechanism gains within the reference's paired CI except elasticity, whose reference deltas carry ±0.3–0.6 pt because its mechanism stream desynchronises the fault stream.

When a number moves outside these bands after a change: check 口径 first (running-clock vs wall-clock rates, what "rollback" includes), then the finite-window effects (episode pauses, terminal discard), then the model (docs/MODEL_REFERENCE.md §19–§21). Record the new table in the comparison document.
