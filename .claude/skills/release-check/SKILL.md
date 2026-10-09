---
name: release-check
description: Pre-release verification for HAC-D — golden tests, typecheck, production build, CLI smoke test, and browser checks at 1280 px and 375 px in light and dark. Use before tagging a release or claiming a UI change works.
---

# Release check

```bash
npm test                                   # 240+ core tests incl. 143 golden vectors
npm run typecheck                          # core, cli, web
npm run build -w @hac-d/web                # production bundle
node --import tsx packages/cli/src/main.ts eval data-staging/ex1.json   # CLI smoke (create with `example survey-ex1 > …`)
```

Browser (dev server from `.claude/launch.json`, name `web`): open each page (Scenario, Training, Inference with survey-ex4, Spares, Allocation, Compare, Simulate — run 100 replications, Report, Library) at 1280×900 and 375×812, in light and dark. Check: no horizontal scroll, every chart has its table twin, KPI values do not wrap, tooltips appear on hover, the worker simulation completes, and the console shows no errors except blocked external font requests.
