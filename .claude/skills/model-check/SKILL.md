---
name: model-check
description: Re-derive a reliability formula independently and compare it with the HAC-D engine and the golden vectors. Use after changing anything under packages/core/src (math, ctmc, rbd, checkpoint, sparing, mttr, allocation, mc, sdc, mechanisms) or when a result looks suspicious.
---

# Model check

1. State the formula being checked and its source (survey section, reference-tool file, paper). Write the derivation in plain text first; do not read the engine code before deriving. Record it in `docs/MODEL_REFERENCE.md` (the spec the goldens are computed from).
2. Compute reference values with Python, independent of TypeScript:
   - v1: `uv run --python 3.12 --with mpmath --with scipy --with numpy python packages/core/test/golden/compute_golden.py` → `golden.json`
   - v2 (dual repair, k-of-n with switchover, sub-health, ladder, waterfall): `compute_golden_v2.py` → `golden_v2.json`
   - v3 (mixed renewal, mechanism chain, silent-corruption delivery, P_clear): `uv run --with mpmath --with numpy python packages/core/test/golden/compute_golden_v3.py` → `golden_v3.json` (renewal equations on a grid with an exact exponential kernel; cases must have T a multiple of c/1200)
   For a new case add it to the script (group, id, inputs with units in key names, expected at full precision, tolerance, reference) rather than typing numbers by hand.
3. Map the case in the harness (`golden.test.ts`, `golden_v2.test.ts`, `golden_v3.test.ts`) and run `npm test`.
4. For finite-window or simulation models also check limits (λ → 0, D → ∞), conservation (ledgers close) and a brute-force simulation in the unit test (`v3_models.test.ts` pattern).
5. For training models cross-check the reference engine: `node scripts/ref-run.cjs 400` (reference), `node --import tsx scripts/ref-compare.ts` (hard-only, sub-health), `node --import tsx scripts/ref-compare-v3.ts 200` (three classes, mechanisms, Shapley); expectations in `docs/REFERENCE_COMPARISON_100K_500K.md`.
6. Compare against the survey's printed number; record `match: ok | rounding | discrepancy` and explain any discrepancy in `golden-report.md` / `golden-v2-report.md`. A discrepancy against a source is not automatically an engine bug: check the source's own derivation first.
7. Never edit an expected value in a golden JSON by hand.
