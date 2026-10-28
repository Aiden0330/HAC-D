# HAC-D ingest runbook — running the input migration inside your network

For the team that holds the internal documents. Everything here runs offline on the bundle `hacd-<version>.tgz` (Node ≥ 20, nothing
else); the only network call is the one you choose to make to your own model endpoint in step 4. HAC-D computes every number; the
model, when used, only copies facts out of documents into evidence cards that two deterministic checks verify.

## 0. Install

```sh
tar -xzf hacd-0.5.0.tgz && cd hacd-0.5.0
bin/hacd ingest help            # bin\hacd.cmd on Windows
```

Layout: `bin/` (launcher + bundle), `data/` (the records folder, `HACD_DATA`; `promote` writes here), `templates/` (one example
worksheet per kind), `docs/` (this runbook, the plan, the user guide, the model reference). Keep a working folder per batch,
e.g. `batches/2026q4/`; the bundle never writes outside `data/` and the `--out` folders you give.

## 1. What a worksheet is

A Markdown file: YAML front matter for the scalars, `## section` headings, pipe tables with fixed headers. One worksheet = one record.
The parser is strict (unknown column, ragged row, value outside a closed vocabulary → error with a line number). Start from a template:

| kind | makes | template |
|---|---|---|
| `device-fit` | the device table: one row per part as your source states it (value, unit as written, source, source type) | `templates/device-fit.md` |
| `koujing-mapping` | the reviewed 口径 table: device → fault unit, catalog class, devices per unit, impact factor, basis, confidence | `templates/koujing-mapping.md` |
| `fault-rates` | a failure-rate override: business-impact FIT per unit-hour by class (normally produced by `normalize`, not written by hand) | `templates/fault-rates.md` |
| `topology` | a topology record: template, SuperPoD geometry (preset + overrides), scale-out, variants, layers, counts, provenance | `templates/topology.md` |
| `mechanisms` | a mechanism-set delta over the default set: parameters, verdicts, recovery baseline, efforts, metadata | `templates/mechanisms.md` |
| `mechanism-proposal` | a mechanism the library may not have; with `mapsTo` it becomes a set delta, without it an extension request | `templates/mechanism-proposal.md` |

Closed vocabularies: `bin/hacd ingest fields --vocab`; field paths of a kind: `bin/hacd ingest fields topology`.

## 2. Hardware FIT (structured sources first)

1. Export the FIT table to xlsx / csv. `bin/hacd ingest import-fit fit.xlsx --id fit-2026q4 --sheet FIT --out staging` guesses the
   header row and the columns (zh / en header lexicon); force them with `--columns device=Part,value=FIT,unit=Unit,source=Source`,
   `--unit FIT` (when the sheet has no unit column), `--source-type vendor|field|prediction|paper|assumed`. Values stay as written.
   Review `staging/device-fit/fit-2026q4.md`.
2. Write the 口径 mapping from `templates/koujing-mapping.md`: one row per device × class. `devicesPerUnit` is how many of the part one
   fault unit carries (node, cabinet, npu, cpu, ub-switch, ub-link, …); `impactFactor` is the share of that part's failures that
   become a business-impact event of the class after the protection you already have (ECC, redundancy, retries); `impactBasis` says
   where the factor comes from; `impactConfidence` measured / derived / assumed. **This table is the review object** — the reliability
   owner signs it, and every later number quotes it.
3. `bin/hacd ingest normalize --devices staging/device-fit/fit-2026q4.json --mapping mapping-2026q4.md --id internal-fit-2026q4 --out staging`
   → `staging/fault-rates/internal-fit-2026q4.{json,md,report.json}`: per class Σ FIT_device × devices per unit × impact factor, unit
   conversions (FIT, per 10⁶ h, per hour, MTBF hours, AFR) written into the derivation, confidence by policy (assumed if any factor is
   an assumption, else derived). A device without a mapping row stops the run (`--unmapped warn` to continue).

## 3. Topologies and mechanisms

- Topology: copy `templates/topology.md`, give it an internal id (never a public one: `native950`, `ubl128`, `cm384`, `a3server`,
  `a960e`), fill the geometry rows you know (blank value = not stated; `base` names a preset the rest falls back to), the scale-out
  design, layers, counts, and a source + confidence per row. `bin/hacd ingest worksheet my-topology.md --out staging`.
- A SuperPoD that is not a public product but uses one of the four UB fabric kinds (two-level L1/L2, cabinet mesh + optical Clos, UB-Mesh 4D, LinkBlade + LinkDevice) is a data update: template `ub-generic` in the worksheet front matter and every geometry value in the geometry table (v5.4). A design the templates cannot express (a new hardware unit kind, a new hierarchy level, a new fabric kind) is not a data update: the loader's
  message names the extension point and `worksheet` writes an **extension request** under `staging/extension-requests/` for the HAC-D
  side (structure only, no values).
- Mechanisms: `templates/mechanisms.md` is a delta over the default set — list only what changes (a parameter, a verdict, an effort,
  the recovery baseline). Parameter keys must be ones the mechanism reads (`validate` checks). A new mechanism goes in a
  `mechanism-proposal` worksheet; a person decides `mapsTo` (an existing library mechanism whose stage and effect it matches) or
  leaves it empty for an extension request.

## 4. Prose documents with your on-prem model (optional) — and the model as operator (v6.1)

The on-prem model can also drive the whole pipeline instead of a person: give it the system prompt `bin/hacd ingest protocol --lang zh` (or `prompts/operator.zh.md` in the bundle), the tool manifest `tools/hacd-tools.json`, read access to the work folder and write access to `ws/` only. It fills the worksheets from your data, runs the one call of §5 and reads `run.json`; what it may and may not do, the manifest contract and the fix table are in `docs/AGENT_OPERATOR.md`. The rules of this runbook do not change: no number without a source, no `--force`, `promote` and the sign-off stay with the owner.
The host is `bin/hacd ingest operate --base-url <url> --model <name> --api-key-env <NAME> --work work --docs internal/ --brief brief.md --before-record <public id> --scales 100000 --lang zh` (the key only through the environment variable); test the wiring first with `node tools/mock-onprem-model.mjs` and the synthetic inputs in `examples/pilot/`, as the bundle's README shows.

Convert PDFs to text first (`pdftotext -layout doc.pdf doc.txt`). Then

```sh
export HACD_MODEL_KEY=…    # only if your endpoint needs one; the key is read from the variable, never typed on the command line
bin/hacd ingest extract doc.txt --kind topology --provider openai-compatible --base-url http://host:8000/v1 --model <name> \
  --mode guided_json --passes 2 --source-type vendor --id internal-x1 --template a950-ub2 --out staging/extract
```

`--mode guided_json` (vLLM), `json_schema` (OpenAI-style constrained output), `fenced` (any model: JSON in a code fence, parsed
strictly). Two passes with different prompts run per chunk; a fact is accepted only when the quote is found verbatim in the chunk, the
value is inside the quote, and both passes agree. Outputs: `cards.json` (accepted), `disputed.json` + `rejected.json` (for
`review.md`), `log.jsonl` (prompt hash, model, timings — no document text), and a **draft worksheet** `topology.md` with one row per
accepted card, source = document + location, confidence from `--source-type`, the quote as the note. Complete the draft by hand, then
`ingest worksheet`. `--kind device-fit` drafts a device table from rate mentions; `--kind mechanisms` a parameters delta.

## 5. Gates, dry run, review page, promote

One call does the chain below (v6.1), for a person as much as for the model: `bin/hacd ingest run --worksheets ws --staging staging --before-record native950 --out out --json` runs `worksheet`, `validate`, `dry-run`, `diff` and `findings` as child processes and writes `out/run.json` (status `ok` / `needs-input` / `failed`, every step with its issues, the KPI rows, the report and delta paths) and `out/SUMMARY.md`; exit 0, 2 (fix the rows the issues name and run again) or 3 (hand the manifest to the owner). Add `--promote` only when the owner has signed. The single commands remain for step-by-step work:

```sh
bin/hacd ingest validate staging                                   # exit 1 on errors; read every warning
bin/hacd ingest dry-run --record staging/records/internal-x1.json --rates staging/fault-rates/internal-fit-2026q4.json --scales 10000,100000
bin/hacd ingest diff --before-record native950 --after-record staging/records/internal-x1.json --after-rates staging/fault-rates/internal-fit-2026q4.json --out staging/delta
bin/hacd ingest promote staging                                    # own ids only; --force to overwrite an existing internal id
bin/hacd findings --record internal-x1 --rates internal-fit-2026q4 --out reports/internal-x1    # the report set on the new inputs
```

What the gates say: `implausible` = the class is outside ×0.1 … ×10 of the public unit-library value — check the mapping's impact
factors and the unit before believing it; `provenance-missing` = a stated value without source / confidence; `unknown-parameter` =
a key the mechanism does not read; `layer-mismatch` = layers inconsistent with the geometry; `id-collision` = a public id.

`staging/delta/delta.html` (zh / en toggle) and `delta.md` are what the reviewer signs: every changed input with its source and
confidence, and the KPI table before / after — A_op nominal and derated, delivered goodput, MTBF_hw, MTTR_hw, P(window), k, the
recommended mechanisms and levers. A change the derivation does not explain is a finding, not a result.

## 6. What may cross to the HAC-D side

Structure, never values: extension requests (`staging/extension-requests/*.md`), validator messages (paths and codes), questions
about the worksheet profile, synthetic examples. The HAC-D side returns a new bundle with the extension implemented and a golden.

## 7. Troubleshooting

- `front matter 'worksheet' must be …` — the first lines are not a valid front matter block; copy a template.
- `table in "## rates" has an unknown column` — headers are fixed; see the template of the kind.
- `devices without a mapping row` — add rows to the 口径 mapping (or `--unmapped warn`).
- `class 'X' is not in the unit library` — the catalog class id is wrong (`bin/hacd ingest fields --vocab`), or the device is a kind HAC-D
  does not model yet → extension request.
- `recommendPlan: no move set meets the target with a supported window check` — too few windows for the Wilson bound: use `--trials 400`.
- Windows: run from `cmd` with `bin\hacd.cmd`; PowerShell quoting of `--columns` values needs double quotes.

The project workflow (a model changes one project — topology inputs, FIT, mechanisms — and produces its report, `AGENT_OPERATOR.md` §11)
has its own pilot: `PILOT_2026Q3_PROJECT_WORKFLOW.md`. The committed evidence of both pilots (manifests, operator results, report
sidecars; no pages, no internal data) is `docs/backup/pilots/`, with its README; the working folders stay in `data-staging/`, out of git.

## 8. Pilot: the first batch

Run the pipeline once, end to end, on the smallest scope that exercises every step, before any wider use.

- **Scope**: one topology record that has a public counterpart (the A3 server cluster or CM384, so the delta has a baseline), one
  scale (100,000 NPUs), one historical period of hardware FIT (one quarter). One worksheet per kind: topology, fault rates and, if
  the period changed a mechanism, a mechanism delta.
- **Division of work**: the data owner writes or corrects the worksheets (§2–§3); the on-prem model, if used, only drafts them
  from documents (§4) — it never runs the pipeline and never produces a number that is not a quoted evidence card; the CLI runs
  the gates, the dry run, the delta and the report set (§5); the reliability owner signs `staging/delta/delta.html`.
- **Acceptance**, all five before `promote` (with `hacd ingest run` they are one manifest: `status: ok`, no error issue, warnings noted, the report rendered): `validate` exits 0 with every warning read and either fixed or written down;
  `dry-run` completes at the chosen scale; every changed input in the delta carries a source and a confidence; every KPI
  change (A_op nominal and derated, MTBF_hw, MTTR_hw, P(window), k, the recommended mechanisms and levers) is explained by the
  input changes listed above it; `hacd findings` on the promoted inputs renders without an error.
- **Output of the pilot**: the promoted record and rates under their own ids, the signed delta report, the Findings set on the new
  inputs, and a list of extension requests (§6) for anything the worksheet profile could not express.
- **Time box**: one week of calendar time; if the gates still fail after that, the blocker is a 口径 or mapping question for the
  reliability owner, not a pipeline change.
- **Run on 2026-10-27 with the mock model** (synthetic ACME A3 server cluster, baseline `a3server`, 100,000 NPUs, 400 windows): the operator session took 66 s, all five acceptance items held, 2 warnings were written down, nothing needed an extension request; the records were promoted after review and `findings` rendered from the promoted data. Report: `PILOT_2026Q3_MOCK.md`; the next pilot runs the same commands with the real model inside the network.
