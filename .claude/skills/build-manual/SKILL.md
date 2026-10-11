---
name: build-manual
description: Rebuild the HAC-D user manual (docs/USER_MANUAL.html) from its HTML source and fresh page screenshots after a UI or method change. Use when asked to update the manual, the documentation pictures, or before a release.
---

# Build the manual

1. Dev server up (`preview_start` name `web`), then `npm run shots` (English UI → `shots/`) and `node scripts/screenshots.mjs shots-zh zh` (Chinese UI → `shots-zh/`): 8 pages × 2 viewports × 2 themes each.
2. `uv run --with pillow python scripts/manual-images.py shots docs/manual/img` and `… shots-zh docs/manual/img-zh` crop the desktop-light screenshots (top of each page) to 1000 px wide JPEGs plus the Training mobile view.
3. Edit both sources for text changes: `docs/manual/USER_MANUAL.src.html` (English) and `docs/manual/USER_MANUAL.zh.src.html` (中文); keep the section numbering identical. Images are referenced as `img/<page>.jpg` and `img-zh/<page>.jpg`.
4. `npm run manual` inlines the images as data URIs into the self-contained `docs/USER_MANUAL.html` and `docs/USER_MANUAL.zh.html` (about 1.7 MB each).
5. `node scripts/manual-check.mjs` and `node scripts/manual-check.mjs docs/USER_MANUAL.zh.html` render both at 1280 px and 375 px in light and dark (file:// URL) into `shots/manual*-*.png` and report horizontal overflow and broken images; keep both viewports clean.
6. Keep `docs/SPEC.md`, `docs/WORKFLOW.md`, `docs/SKILLS.md` and `README.md` consistent with the manual's feature list.
