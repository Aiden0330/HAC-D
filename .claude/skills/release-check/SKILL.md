---
name: release-check
description: Pre-release verification for HAC-D — golden tests, typecheck, production build, CLI smoke tests (eval, allocate, mechanisms, ledger, plan), screenshot checks of every page at 1280 px and 375 px in light and dark, and the manual rebuild. Use before tagging a release, before pushing, or before claiming a UI change works.
---

# Release check

```bash
npm test                                   # 358 core tests (143 + 26 + 18 golden vectors) + 29 importer tests
npm run typecheck                          # core, cli, mcp, importers, web
npm run build -w @hac-d/web                # production bundle
node --import tsx packages/cli/src/main.ts example ref-three-classes-100k > data-staging/three.json
node --import tsx packages/cli/src/main.ts eval data-staging/three.json | head
node --import tsx packages/cli/src/main.ts allocate data-staging/three.json --goodput 0.9 --basis delivered | head
node --import tsx packages/cli/src/main.ts mechanisms data-staging/three.json | head -12
node --import tsx packages/cli/src/main.ts ledger data-staging/three.json --trials 100 | head -4
node --import tsx packages/cli/src/main.ts plan data-staging/three.json --target 0.9 --trials 100 | head -6
```

Expected on the three-class example at 100k cards: delivered 62.6 %, A_op 97.55 %; the ledger simulation agrees with the closed form; the plan is D-SDC alone at effort 5 (92.3 % nominal).

## Browser checks

Start the dev server with `preview_start` (`.claude/launch.json`, name `web`; it stops between turns sometimes, check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173`). Then `npm run shots` (Playwright, Chromium): selects the three-class example, visits Scenario, Training, Mechanisms (presses Attribute and Plan), Allocation, Simulate (runs the window ledger), Report, Import (uploads a fixture workbook and imports it) and Compare at 1280×900 and 375×812, light and dark, into `shots/`, and prints `HORIZONTAL OVERFLOW` or console errors per page. Inspect the PNGs with the Read tool; the in-app browser pane renders the 1280 px layout too small to judge. `node scripts/overflow-check.mjs` lists the innermost elements wider than a 375 px viewport (rows inside `.table-wrap` scrollers are expected).

## Manual

If a page changed visibly: `uv run --with pillow python scripts/manual-images.py shots docs/manual/img` then `npm run manual` (rebuilds `docs/USER_MANUAL.html` from `docs/manual/USER_MANUAL.src.html`); update the text of the source when a feature changed.
