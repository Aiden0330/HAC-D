# Claude Code skills for HAC-D (2026-10-11)

Skills live in `.claude/skills/<name>/SKILL.md` and are invoked with `/<name>` (or picked up automatically when the task matches). They encode the recurring parts of the workflows in `docs/WORKFLOW.md`.

| Skill | Use it when | What it does |
|---|---|---|
| `model-check` | a core formula changed or a number looks wrong | derive independently, compute goldens in Python (`compute_golden*.py`), map the harness, check limits / conservation, cross-check the reference engine, document |
| `release-check` | before pushing, tagging, or claiming a UI change works | tests, typecheck, build, CLI smoke tests (eval, allocate, mechanisms, ledger, plan), screenshots of every page at 1280 / 375 light / dark, manual rebuild |
| `scenario-review` | asked to review a design or a scenario file | eleven-item checklist with numbers, headline model and regime, ledger, dominant class and stage, delivered vs effective goodput, necessary mechanisms, flagged assumptions |
| `allocate-to-target` | asked how to reach X % at N cards or which mechanisms to adopt | delivered-basis allocation (hardware feasibility, q*, D*), planner (cheapest feasible set, derating, Pareto, scan, P(window ≥ target)), attribution, write-up |
| `reference-compare` | training / SDC / chain / ledger models changed | run the reference engine and the comparison scripts, compare with the published means and CI bands, record the table |
| `add-parameter` | a new paper, blog or measurement gives a rate or time | add a library record with 口径, provenance and confidence, validate, test, report |
| `build-manual` | UI or methods changed visibly | refresh English and Chinese screenshots, crop images, edit both manual sources, inline into `docs/USER_MANUAL.html` and `docs/USER_MANUAL.zh.html`, check at both viewports |

Conventions shared by all skills: goldens are computed independently in Python and never edited by hand; every KPI is reported with its formula and 口径; the reference-tool drop (`ai-cluster-reliability-main/`) is never committed; screenshots are inspected as PNGs because the in-app browser pane renders 1280 px too small to judge.
