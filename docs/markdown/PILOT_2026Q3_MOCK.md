# Pilot of the input pipeline with a mock on-prem model — 2026-10-27

The runbook's §8 pilot (`INGEST_RUNBOOK.md`), run end to end inside the offline bundle with the mock on-prem model of
`AGENT_OPERATOR.md` §9 standing in for the internal model, on synthetic inputs. It proves the wiring — the host, the operator
protocol, the worksheets, the gates, the dry run, the delta, the report, promote — not that a given real model follows the prompt;
that is the next pilot, inside the network, with the same commands.

## 1. Scope (as the runbook asks)

| Item | Pilot |
|---|---|
| Topology with a public counterpart | `acme-a3-2026q3`, an A3 server cluster (template `a3-ub384`, chip family 910C) against the public `a3server` record: 3 servers per cabinet instead of 4, 2 RoCE planes of 128-port switches instead of 1 plane of 64-port switches, the rest as the public record |
| Scale | 100,000 NPUs |
| Hardware FIT, one period | `acme-fit-2026q3.csv`: 12 devices for 2026Q3 as FIT, MTBF hours and AFR, with source, location and source type; the reviewed 口径 mapping `acme-koujing-mapping-2026q3.csv` (14 device × class rows with devices per unit, impact factor, basis and confidence) |
| Mechanism delta | `acme-mechanisms-2026q3.md`: `D-HARD.detectSeconds` 20 s and `R-REPLAY.success` 0.92, both "measured" from a Q3 field report |
| Data | Every value is invented (`packages/cli/test/fixtures/pilot/internal`, shipped in the bundle as `examples/pilot/`); no internal data was used or seen |
| Settings | the report preset: 400 windows, 300 Shapley permutations, target A_op ≥ 98.5 %, seed 1 |

## 2. Who did what

| Role | In this pilot |
|---|---|
| Internal data | the five synthetic files above, plus the owner's brief (`brief.md`: ids, names, template, which file is which) |
| Operator model | `tools/mock-onprem-model.mjs` — scripted answers; it saw the documents only through the host's `read_file`, wrote only under `ws/`, and copied values by pattern |
| Host | `bin/hacd ingest operate --lang zh …` of the bundle `hacd-0.5.0` |
| HAC-D | every computation: `import-fit`, `normalize`, `extract` (grounding and two-pass agreement), `worksheet`, `validate`, `dry-run`, `diff`, `findings`, `promote` |
| Reliability owner | the author of this report, on synthetic data: read `SUMMARY.md`, `delta.md` and the two warnings, then ran `promote` — a rehearsal of the sign-off, not one |

## 3. The session

```sh
node tools/mock-onprem-model.mjs --port 0                     # the stand-in model
export HACD_DATA=…/pilot-2026q3/data                          # a copy of the bundle's data folder: the internal side's records
bin/hacd ingest operate --base-url http://127.0.0.1:<port>/v1 --model mock-onprem --work …/work \
  --docs …/internal/acme-a3-design-note-2026q3.md --docs …/internal/acme-fit-2026q3.csv \
  --docs …/internal/acme-koujing-mapping-2026q3.csv --docs …/internal/acme-mechanisms-2026q3.md \
  --brief …/internal/brief.md --before-record a3server --scales 100000 --trials 400 --permutations 300 --lang zh
bin/hacd ingest promote …/work/staging                                                            # the owner, after review
bin/hacd findings --record acme-a3-2026q3 --rates …/data/fault-rates/acme-fit-2026q3.json \
  --mechanisms …/data/mechanism-sets/acme-mech-2026q3.json --scales 100000 --trials 400 --permutations 300 --out …/promoted-report
```

The operator session: 8 model turns, 15 tool calls, 3 worksheets written, 1 pipeline run, 66 s in all.

| Turn | What the model did |
|---|---|
| 1 | read the four documents |
| 2 | `hacd ingest template koujing-mapping`, `hacd ingest template mechanisms`, `hacd ingest import-fit acme-fit-2026q3.csv --id acme-fit-2026q3` |
| 3 | wrote `ws/koujing-mapping.md` (the owner's table row for row) and `ws/mechanisms.md` (two parameter rows, the example rows removed); `hacd ingest normalize` → the override `acme-fit-2026q3` (14 classes); `hacd ingest extract` of the design note (1 chunk, 2 passes, 21 cards accepted, 0 disputed, 0 rejected) → the draft topology worksheet |
| 4 | read the draft |
| 5 | wrote `ws/topology.md`: the draft with the names, the family and the scenario id from the brief |
| 6 | `hacd ingest run --worksheets ws --staging staging --before-record a3server --out out --scales 100000 --trials 400 --permutations 300 --json` → `ok` in 64.6 s (worksheets 0.2 s, validate 0.1 s, dry-run 9.7 s, diff 18.9 s, findings 35.6 s) |
| 7 | read `out/SUMMARY.md` |
| 8 | the final message: status, the run command, the KPI table, the two warnings, the paths — nothing else |

No command carried `--force`, `--promote` or `--data`; nothing was written outside `ws/`; the log (`operator-log.jsonl`) holds every
turn and tool call and no key.

## 4. Results (from `out/delta/delta.md`)

口径: A_op of one synchronous job per cluster-hour (formula 1 of the Methodology), nominal and derated; MTBF_hw and MTTR_hw of formula 1;
P(window) = share of 400 30-day windows at or above the target; k = the hardware-rate margin to the target.

| 100,000 NPUs | A_op | A_op derated | delivered | MTBF_hw | MTTR_hw | P(window) | k | recommended mechanisms |
|---|---|---|---|---|---|---|---|---|
| before: `a3server`, unit library, `remap-latest-2026-10` | 99.107 % | 99.005 % | 91.532 % | 3.03 h | 104 s | 95.8 % supported | 1.147 | — |
| after: `acme-a3-2026q3`, `acme-fit-2026q3`, `acme-mech-2026q3` | 99.029 % | 98.897 % | 91.913 % | 2.63 h | 101 s | 94.5 % supported | 1.106 | — |
| Δ | −0.078 pt | −0.108 pt | +0.381 pt | × 0.868 | × 0.966 | | −0.041 | |

Input changes: 52 record fields, 14 rate classes, 4 set fields; 0 extension requests ("every input is a data update").

How the input changes explain the KPI changes (the runbook's fourth acceptance item):

- **MTBF_hw falls by 13 %.** The override replaces the unit library's rates for 14 classes with the Q3 values. The largest single change
  is the RoCE optics class `OPT-hard@roce`: 120 FIT per link-hour against the library's 4.76 (the flagged ×25.2 value — 300 FIT per
  transceiver, 2 per link, impact factor 0.2, the owner's note: early-life returns of a new optics vendor). Power rises (6,000 against
  5,333 per cabinet-hour), several classes fall (DDR 560 against 1,600 per node-hour, management 400 against 1,067, NIC 60 against 100),
  CPU, HBM, core and module stay close to the library. The geometry adds to it: cabinet-level faults are spread over 24 instead of 32
  NPUs (3 servers per cabinet), and the scale-out network has two planes of 128-port switches instead of one of 64, so more RoCE links
  and switches per NPU carry the raised optics rate. The record's own tables list each term with its source (`delta.md` §Input changes).
- **MTTR_hw falls by 3 %** and **delivered goodput rises by 0.38 pt**: the two mechanism parameters from the Q3 field report — hard-fault
  detection at 20 s and step replay succeeding in 92 % of attempts — shorten the recovery chain and let more interruptions end in a
  replay instead of a restart.
- **A_op falls by 0.08 pt nominal and 0.11 pt derated**: the MTBF loss outweighs the MTTR gain. Both stay above the 98.5 % target with the
  window check supported (94.5 % of windows), so the recommendation stays "no additional mechanism" — the same conclusion as for the
  public record, with a smaller margin (k 1.106 against 1.147).

## 5. Gates

| Level | Path | Code | Disposition |
|---|---|---|---|
| warning | `acme-fit-2026q3.json: override.rates.OPT-hard@roce.fit` | implausible (120 FIT = 25.2 × the library's 4.762; envelope 0.1–10) | written down, kept: the source table and the mapping say so (early-life returns, 2 modules per link, impact 0.2). For the real pilot the owner re-checks the devices-per-link factor and the impact share before signing |
| warning | `acme-mech-2026q3.json: set.capability` | provenance-missing | written down: the capability list is inherited from the base set `remap-latest-2026-10`; a `capability` row in the worksheet's provenance table clears it |
| info | `acme-a3-2026q3.json: record.layers` | provenance-missing | the layer rule follows from the geometry (node 8, cabinet 24, server-sized SuperPoD) |
| info | `acme-fit-2026q3.json: override.catalog` | catalog-missing | per-unit basis; no catalog block is needed |

0 errors. The same issues appear in `validate`, `dry-run`, `promote` and the delta's Validation table.

## 6. Acceptance (runbook §8, all five)

| # | Criterion | Evidence |
|---|---|---|
| 1 | `validate` exits 0; every warning read and either fixed or written down | step `validate` ok; the two warnings in §5, both written down with the reason, in the model's final message, in `SUMMARY.md` and here |
| 2 | `dry-run` completes at the chosen scale | step `dry-run` ok at 100,000 NPUs, 9.7 s |
| 3 | every changed input in the delta carries a source and a confidence | geometry, scale-out and layer rows: `acme-a3-design-note-2026q3.md L1-39`, vendor; 14 rate classes: the CSV row and the mapping id, with the derivation; 2 parameters: `ACME-FM-2026Q3 table 4 / 6`, measured. Without a source column by nature: the id, the names, the scenario id (from the brief) and the public record's three extra scale-out variants, which the worksheet does not carry (listed as removed) |
| 4 | every KPI change explained by the input changes listed above it | §4 |
| 5 | `hacd findings` on the promoted inputs renders without an error | `promote` wrote the three files and the `CHANGELOG.md` lines (sha256 of each file); `findings` from the data folder rendered the Findings and Methodology pages in 36 s with `results.json` identical to the run's except the timestamp |

Output of the pilot (`data-staging/pilot-2026q3/`, kept out of git): `internal/` the inputs, `work/ws` the three worksheets and the
extraction folder, `work/staging` the records and the delta, `work/out/run.json`, `SUMMARY.md`, `report/`, `delta/`,
`operator-log.jsonl`, `operator-result.json`, `data/` the promoted records with `CHANGELOG.md`, `promoted-report/`. Extension requests:
none. The evidence is committed under `docs/backup/pilots/2026q3-worksheet-mock/` (`run.json`, `SUMMARY.md`, the final message,
`operator-result.json`, the report sidecar `data/` and the delta as JSON and Markdown; see the README there):
`hacd findings --data docs/backup/pilots/2026q3-worksheet-mock/data --out <dir>` re-renders the Findings page with the current recipes.

## 7. What the pilot found in the pipeline (fixed the same day)

1. `hacd ingest run --json` printed the manifest with `console.log` and exited at once; on macOS a pipe is asynchronous and the host
   received about 8 kB of a 12 kB manifest. The manifest is now written with a synchronous loop (`writeAllSync`).
2. After the operator renamed a public id, the previous conversion's staged record stayed in `staging/records` and the gates kept
   reporting it. `run` now keeps a ledger of the files the worksheet conversion produced and removes them before converting again.
3. `hacd ingest validate --json` exited right after printing; it now sets the exit code and lets the output flush.
4. The extract tool's command template made `--source-type`, `--id` and `--template` mandatory although the manifest listed them as
   optional.
5. A worksheet that fails to parse (an empty source cell) ends the run as `needs-input` without a gate issue; the prompt and the fix
   table gained `worksheet-parse`: the step's stderrTail names the file, the row and the cell.
6. The model server closed its idle keep-alive connection during the 65 s pipeline call and the next request failed once; the host
   retries a transport failure twice.

## 8. Limits of this pilot, and the next one

- The mock copies values by patterns written for this design note. It shows that a model which follows the prompt gets a signed-off
  report with no human at the terminal; it says nothing about whether a given 7B–70B model follows the prompt. The validation steps of
  `AGENT_OPERATOR.md` §8 are the way to find out, with the real model, before its pilot.
- The data is synthetic; the sign-off was a rehearsal. The implausible optics value is exactly the kind of row the real owner must
  decide on.
- The extraction wrote `vendor` confidence for a design note (the maker's own specification); an internal design document may deserve
  another policy — the owner sets `--source-type` in the brief.
- One scale, no verdict changes in the mechanism set, no extension request; the next pilot should include one worksheet row the
  templates cannot express, to exercise `staging/extension-requests/`.
