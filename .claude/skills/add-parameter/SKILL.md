---
name: add-parameter
description: Add or update a record in the HAC-D parameter library (packages/core/data/library.json) with complete 口径 and provenance fields. Use when a new paper, blog or measurement provides a failure rate, MTTR stage time, SDC rate or spare ratio.
---

# Add a parameter

Every record needs: `id` (class.kind.source), `class`, `kind`, `name {zh,en}`, `value` + `unit` (controlled vocabulary in the file's `vocab` block; keep percentages as printed with `pct`), `distribution`, `koujing {event, denominator, level, includes_planned, dedup}`, `applicability {hardware, scale, period, phase, workload, stage?, setting?, variant?}`, `provenance {source, org, venue, year, url, survey_ref, confidence, derivation}`, `caveat {zh,en}`.

Confidence policy: `measured` first-hand observation; `paper-reported` numbers the survey marks 论文报告/摘要报告 or model/simulation values; `vendor` 厂商自述; `derived` any arithmetic from other numbers (fill `derivation`); `scan-level` abstract-only; `assumed` placeholder with `value: null`.

After editing: validate with `python3 -I -c "import json,sys; json.load(open(sys.argv[1]))" packages/core/data/library.json`, run `npm test` (library tests), and append the change to `packages/core/data/library-report.md`.
