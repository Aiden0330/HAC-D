---
name: build-manual
description: Rebuild the HAC-D user manual (docs/USER_MANUAL.html) from its HTML source and fresh page screenshots after a UI or method change. Use when asked to update the manual, the documentation pictures, or before a release.
---

# Build the manual

1. Dev server up (`preview_start` name `web`), then `npm run shots` to refresh `shots/*.png` (8 pages × 2 viewports × 2 themes).
2. `uv run --with pillow python scripts/manual-images.py shots docs/manual/img` crops the desktop-light screenshots (top of each page) to 1000 px wide JPEGs and the Training mobile view.
3. Edit `docs/manual/USER_MANUAL.src.html` for text changes (sections: pages, methods reference, validation, workflow, CLI / MCP, examples, limitations, glossary). Images are referenced as `img/<page>.jpg`.
4. `npm run manual` inlines the images as data URIs into the self-contained `docs/USER_MANUAL.html` (about 1.7 MB).
5. `node scripts/manual-check.mjs` renders the result at 1280 px and 375 px in light and dark (file:// URL) into `shots/manual-*.png` and reports horizontal overflow and broken images; keep both viewports clean.
6. Keep `docs/SPEC.md`, `docs/WORKFLOW.md`, `docs/SKILLS.md` and `README.md` consistent with the manual's feature list.
