# HAC-D — AI cluster availability / MTBF / MTTR modeling tool

Plan: `docs/DEVELOPMENT_PLAN.md`. Evidence base: the survey chapter at `../survey/ai-cluster-reliability-modeling.html` (read-only; extract text with a script, it is too large to read whole).

## Layout
- `packages/core` — pure TypeScript numerics (no DOM). Modules: units, math, rbd, ctmc, checkpoint, sparing, mttr, scale, allocation, sensitivity, cost, mc, scenario. Tests in `packages/core/test`, golden vectors in `packages/core/test/golden/golden.json` (computed independently in Python; do not edit expected values by hand).
- `apps/web` — Vite + React static app (bilingual zh/en, light/dark), compute in Web Workers.
- `packages/cli` — Node CLI over the core.

## Rules
- Every number shown to a user carries its formula and its 口径 (event, denominator, level). Never add quantities of different event classes.
- First-order checkpoint formulas must check τ+δ ≪ M and R ≪ M and flag the regime.
- Non-exponential or correlated inputs route to Monte Carlo; the closed-form result is still shown with a delta badge.
- Parameters from the survey keep provenance and confidence (measured / paper-reported / vendor / derived / assumed / scan-level).
- Run `npm test` (goldens) before claiming a core change works; UI changes are checked at 1280 px and 375 px in light and dark.
