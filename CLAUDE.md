# HAC-D — AI cluster availability / MTBF / MTTR modeling tool

Plan: `docs/DEVELOPMENT_PLAN.md`. Evidence base: the survey chapter at `../survey/ai-cluster-reliability-modeling.html` (read-only; extract text with a script, it is too large to read whole).

## Layout
- `packages/core` — pure TypeScript numerics (no DOM). Modules: units, math, rbd, ctmc, checkpoint, sparing, mttr, scale, allocation, sensitivity, cost, mc, scenario; v5: records (topology record, failure-rate override, mechanism set — JSON in `packages/core/data/{records,fault-rates,mechanism-sets}`, every value with provenance and confidence), budget, layers, study/prune. Tests in `packages/core/test`, golden vectors in `packages/core/test/golden/golden*.json` (computed independently in Python; do not edit expected values by hand).
- `apps/web` — Vite + React static app (bilingual zh/en, light/dark), compute in Web Workers.
- `packages/cli` — Node CLI over the core; `hacd findings | bom | budget | methodology | prune | study` regenerate the Ascend report set from the records (`docs/markdown/USER_GUIDE.md` "v5 CLI").
- `packages/reports` — the bilingual HTML report kit and the Findings / Methodology / BOM recipes as pure functions of the sidecar JSON; `node packages/reports/test/reproduce.mjs` must print six OK after any change to a recipe or to `docs/backup/ascend-allocation`.

## Rules
- Every number shown to a user carries its formula and its 口径 (event, denominator, level). Never add quantities of different event classes.
- First-order checkpoint formulas must check τ+δ ≪ M and R ≪ M and flag the regime.
- Non-exponential or correlated inputs route to Monte Carlo; the closed-form result is still shown with a delta badge.
- Parameters from the survey keep provenance and confidence (measured / paper-reported / vendor / derived / assumed / scan-level).
- Run `npm test` (goldens) before claiming a core change works; UI changes are checked at 1280 px and 375 px in light and dark.

## Model and effort routing for delegated work
Applies to Agent-tool sub-agents and to sessions started from a HAC-D session. Pick the model per session and keep it; never switch mid-session.
- Research lead, survey synthesis, parameter 口径 and confidence, allocation judgment: Fable 5.1 at high effort. Max only for the final reconciliation pass over a parameter set.
- Formula derivation under `packages/core`: Fable 5.1 at xhigh or max. Independent verifier (model-check): a fresh session on Opus 5.5 at xhigh when goldens exist; a fresh Fable 5.1 session at xhigh when the formula has no golden yet.
- Extraction from the survey corpus, grep over reports, citation counts: Sonnet 5.5 at low effort (Haiku 5.5 for pure grep). Workers return raw wording and location only; the lead assigns event class, denominator, level and confidence. A worker never decides what may be added to what.
- Report builds (`scripts/build-*.mjs`, bilingual HTML, SVG figures): Opus 5.5 at medium or high.
- UI code in `apps/web`: Opus 5.5 at high. Screenshot checks at 1280 px and 375 px, light and dark: Sonnet 5.5 at low.
- Delegate only when there is bulk to fan out (parallel report builds, corpus extraction). A single dependent chain, such as one formula change plus its golden check, stays in one session.
- Run sub-tasks at the lower setting and re-run only the failures higher; goldens, reference-compare and the review checklist are the checkers.
