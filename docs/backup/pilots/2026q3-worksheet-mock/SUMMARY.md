# hacd ingest run — ok (exit 0)

状态 / Status: **ok** · 2026-10-27T13:31:17.126Z → 2026-10-27T13:32:21.629Z
输入 / Inputs: record `acme-a3-2026q3` · override `acme-fit-2026q3` · set `acme-mech-2026q3`
下一步 / Next: 完成。交给可靠性负责人签署：delta/delta.html（输入差异与 KPI 前后）与 report/ 下的 Findings 页面；run.json 列出全部步骤与 KPI 行；记录未 promote（加 --promote 才写入数据目录）。
Next: Done. Hand to the reliability owner for sign-off: delta/delta.html (input changes and KPI before / after) and the Findings page(s) under report/; run.json lists every step and the KPI rows; nothing was promoted (add --promote to write the data folder).

## 步骤 / Steps
| step | result | time | command |
|---|---|---|---|
| worksheets | ok | 0.2 s | `hacd ingest worksheet /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/ws/koujing-mapping.md /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/ws/mechanisms.md /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/ws/topology.md --out /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging` |
| validate | ok | 0.1 s | `hacd ingest validate /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging --json` |
| dry-run | ok | 9.7 s | `hacd ingest dry-run --scales 100000 --target 0.985 --trials 400 --seed 1 --json --record /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/records/acme-a3-2026q3.json --rates /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/fault-rates/acme-fit-2026q3.json --mechanisms /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/mechanism-sets/acme-mech-2026q3.json` |
| diff | ok | 18.9 s | `hacd ingest diff --before-record a3server --after-record /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/records/acme-a3-2026q3.json --after-rates /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/fault-rates/acme-fit-2026q3.json --after-set /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/mechanism-sets/acme-mech-2026q3.json --scales 100000 --target 0.985 --trials 400 --seed 1 --out /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/out/delta --json` |
| findings | ok | 35.6 s | `hacd findings --scales 100000 --target 0.985 --trials 400 --seed 1 --permutations 300 --out /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/out/report --data-out /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/out/report/data --record /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/records/acme-a3-2026q3.json --rates /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/fault-rates/acme-fit-2026q3.json --mechanisms /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/staging/mechanism-sets/acme-mech-2026q3.json` |

## KPI（干跑 / dry run; 口径: A_op of one synchronous job per cluster-hour, nominal / derated; MTBF_hw and MTTR_hw of formula 1; P = share of 400 30-day windows ≥ target; k = uniform hardware factor）
| scale | A_op nominal / derated | delivered | MTBF_hw | MTTR_hw | P(window) | k | recommended mechanisms \| levers |
|---|---|---|---|---|---|---|---|
| 100000 | 99.03 % / 98.90 % | 91.91 % | 2.63 h | 101 s | 94.50 % supported | 1.106 | — \| — |

## 门禁问题 / Gate issues (errors and warnings)
- warning · validate · `acme-fit-2026q3.json: override.rates.OPT-hard@roce.fit` · implausible — 120.0 FIT per unit-hour is 25.2 × the unit library's 4.762 (envelope 0.1–10) / 120.0 FIT/单元·h 是单元库值 4.762 的 25.2 倍（范围 0.1–10）
- warning · validate · `acme-mech-2026q3.json: set.capability` · provenance-missing — capability has no provenance entry / capability 无来源 / 置信
- warning · dry-run · `override.rates.OPT-hard@roce.fit` · implausible — 120.0 FIT per unit-hour is 25.2 × the unit library's 4.762 (envelope 0.1–10) / 120.0 FIT/单元·h 是单元库值 4.762 的 25.2 倍（范围 0.1–10）
- warning · dry-run · `set.capability` · provenance-missing — capability has no provenance entry / capability 无来源 / 置信

## 文件 / Files
- run.json: this run (steps, issues, KPI rows, paths)
- delta: /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/out/delta (delta.html, delta.json, delta.md, delta.zh.md, provenance.json)
- report: /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/out/report (ASCEND_ALLOCATION_FINDINGS_ACME-A3-2026Q3.html, ASCEND_ALLOCATION_METHODOLOGY.html; data/ holds the sidecar JSON; `hacd findings --data /Users/liqingchuan/Documents/projects/HAC-D/data-staging/pilot-2026q3/work/out/report/data` re-renders)
- promoted: nothing (the data folder is unchanged)
