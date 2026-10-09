---
name: model-check
description: Re-derive a reliability formula independently and compare it with the HAC-D engine and the golden vectors. Use after changing anything under packages/core/src (math, ctmc, rbd, checkpoint, sparing, mttr, allocation, mc) or when a result looks suspicious.
---

# Model check

1. State the formula being checked and its source (survey section / paper). Write the derivation in plain text first; do not read the engine code before deriving.
2. Compute reference values with Python, independent of TypeScript:
   `uv run --python 3.12 --with mpmath --with scipy --with numpy python packages/core/test/golden/compute_golden.py` regenerates `golden.json`; for a new case, add it to that script (group, id, inputs with units in key names, expected at full precision, tolerance, survey reference) rather than typing numbers by hand.
3. Map the case in `packages/core/test/golden.test.ts` (`handlers` or `handlerFor`) and run `npm test`.
4. Compare against the survey's printed number; record `match: ok | rounding | discrepancy` and explain any discrepancy in `golden-report.md`. A discrepancy against the survey is not automatically an engine bug — check the survey's own derivation first.
5. Never edit an expected value in `golden.json` by hand.
