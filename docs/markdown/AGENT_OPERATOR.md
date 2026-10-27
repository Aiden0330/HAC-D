# HAC-D operator protocol — an on-prem model drives the input pipeline (v6.1)

The v6 pipeline (`INGEST_RUNBOOK.md`) was written for a person at the terminal. This document makes the same pipeline operable by a
program or by a small on-prem model with no one clicking in HAC-D: the model writes worksheets from internal data and runs one
command; HAC-D computes; a person signs the result. Three rules do not change: the model never produces a number it cannot cite,
HAC-D does every computation, and `promote` (writing the data folder) stays a human decision.

## 1. Roles and the division of work

| Who | Does | Never does |
|---|---|---|
| Internal data | failure-data tables (FIT / MTBF / AFR per device), topology design documents or tables, mechanism parameters | — |
| Operator model (on-prem, OpenAI-compatible; any size that follows a 60-line instruction) | copies facts into worksheets with source and confidence; runs `hacd ingest run`; reads `run.json`; fixes the rows the gates name; reports | computes, converts, estimates or rounds a number; edits the data folder; passes `--force`; promotes |
| HAC-D CLI (offline bundle, `bin/hacd`) | templates and vocabularies; worksheet → record; gates; dry run; delta; the report set; the manifest | guesses a missing value (a blank stays blank and the gate says so) |
| Reliability owner | signs `delta.html` and the Findings page; decides `promote`; answers 口径 questions; files extension requests | — |

## 2. What the model gets

`hacd ingest protocol --lang zh|en` prints the system prompt (the rules, the six commands, the procedure, the fix table, the final
message format); `hacd ingest protocol --tools` prints the tool manifest for function-calling models (one tool per command with its
argument schema and the command line the host runs); `hacd ingest protocol --fix-table --lang zh|en` prints the fix table alone.
The offline bundle writes the three to `prompts/` and `tools/`. Source of truth: `packages/agent/src/operator.ts`.

The host (the program that runs the model) needs only: a way to run `bin/hacd …` and return stdout, stderr and the exit code; a
`read_file` tool over `<work>/` and the input documents; a `write_file` tool restricted to `<work>/ws/`. Nothing else is required.

## 3. The six commands the model may run

| Command | Produces | Reads |
|---|---|---|
| `hacd ingest template <kind>` | an example worksheet (topology, fault-rates, mechanisms, mechanism-proposal, device-fit, koujing-mapping) | — |
| `hacd ingest fields <kind> --json` | the allowed field paths and closed vocabularies | — |
| `hacd ingest import-fit <book> --id … --out ws` | a device-fit worksheet from a failure-data spreadsheet or CSV | the table |
| `hacd ingest normalize --devices … --mapping … --id … --out staging` | the failure-rate override (device FIT → business-impact FIT per unit) and its report | two worksheets |
| `hacd ingest extract <docs> --kind … --provider openai-compatible …` | evidence cards, a review queue and a draft worksheet from prose (optional) | documents |
| `hacd ingest run --worksheets ws --staging staging --before-record <id> --out out --json` | gates → dry run → delta → report; `run.json` + `SUMMARY.md` | the worksheets |

`run` is the only orchestration: it executes `ingest worksheet`, `ingest validate`, `ingest dry-run`, `ingest diff` (when
`--before-record` is given), `ingest promote` (only with `--promote`, never with `--force`) and `findings`, each as a child process of
the same CLI, so every step keeps its own exit code and JSON output.

## 4. The manifest contract (`out/run.json`)

| Field | Meaning |
|---|---|
| `status` | `ok` (report written), `needs-input` (schema or gate errors, or no single record in staging), `failed` (engine or report error) |
| `exitCode` | 0 / 2 / 3; usage errors exit 1 before a manifest exists |
| `inputs` | the record, override and mechanism set used (id and path); resolved from the flags or from the single file of each kind in staging |
| `steps[]` | `name`, `ok`, `exitCode`, `seconds`, `command`, `issues[]` (validate and dry-run: `level`, `code`, `path` = `file: field`, bilingual `message`), `stderrTail` of a failed step |
| `kpi[]` | the dry run's rows per scale: A_op nominal / derated, delivered goodput, MTBF_hw, MTTR_hw, P(window) with verdict, k, recommended mechanisms and levers, effort |
| `report`, `delta`, `promoted` | paths of the Findings pages (+ Methodology) and their sidecar `data/`, of the delta files, and the promoted ids (empty without `--promote`) |
| `nextAction` | one bilingual sentence telling the operator what to do next |

`SUMMARY.md` is the same content for a person: status, inputs, the steps, the KPI table with its 口径, the gate issues, the files.

## 5. The operator loop

1. Inputs → worksheets (the prompt's part A): templates, one row per fact, source + confidence, blanks instead of guesses, internal ids.
2. `hacd ingest run … --json`.
3. `status ok` → report and stop (no promote). `needs-input` → fix the rows the issues name, by code, at most three rounds. `failed` → stop and hand over `run.json` unchanged.

The fix table (`hacd ingest protocol --fix-table`) maps every gate code to the one change that resolves it, e.g. `id-collision` →
choose an internal id; `unknown-class` → a class id from `hacd ingest fields fault-rates --json`; `layer-mismatch` → the three
layer rules; `derivation-missing` → write the arithmetic; `implausible` (a warning) → re-check unit and devices-per-unit, keep it
with a note when the source really says so.

## 6. Limits that stay with people

- Sign-off and `promote`: the model reports; the owner signs `delta.html` and the Findings page and runs `hacd ingest promote` (or
  adds `--promote` to a run) — the pilot's acceptance criteria are in the runbook §8.
- Fewer than 35 windows make the window check impossible to support; the model must not lower `--trials` below the prompt's value to
  make a run pass (the default 400 matches the report set).
- A design the templates cannot express (a new fabric kind, hardware unit kind or mechanism transform) arrives as an extension request
  (`staging/extension-requests/*.md`), produced by `ingest worksheet` from a `mechanism-proposal` worksheet or from a loader error;
  it is structure for the HAC-D side, not a number for the report. A SuperPoD of an existing fabric kind needs no code: template
  `ub-generic` with the geometry in the record.
- The on-prem model's extraction (`ingest extract`) is grounded and two-pass; rows it cannot cite do not reach the worksheet, so a
  draft may be incomplete — the operator fills the gaps only from sources it can cite.

## 7. A session (the CLI test `packages/cli/test/run.test.ts` runs exactly this)

```sh
hacd ingest template topology > ws/topology.md        # then: replace the example rows from the design document
hacd ingest template mechanisms > ws/mechanisms.md    # then: only the parameters that differ, with source
hacd ingest run --worksheets ws --staging staging --before-record native950 --out out --scales 10000,100000 --trials 400 --permutations 300 --json
```

`run.json` after an ok run (abridged):

```json
{ "status": "ok", "exitCode": 0,
  "inputs": { "record": { "id": "internal-example-950", "path": "staging/records/internal-example-950.json" }, "rates": null, "set": { "id": "example-mechanisms-delta", "path": "…" } },
  "steps": [ { "name": "worksheets", "ok": true }, { "name": "validate", "ok": true, "issues": [ { "level": "warning", "code": "provenance-missing", "path": "example-mechanisms-delta.json: set.capability" } ] },
             { "name": "dry-run", "ok": true }, { "name": "diff", "ok": true }, { "name": "findings", "ok": true } ],
  "kpi": [ { "scale": 10000, "aOp": 0.99920, "aOpDerated": 0.99910, "delivered": 0.9688, "mtbfHwH": 32.28, "mttrS": 99.4, "windowP": 1, "verdict": "supported", "k": 14.545 } ],
  "report": { "dir": "out/report", "files": ["ASCEND_ALLOCATION_FINDINGS_INTERNAL-EXAMPLE-950.html", "ASCEND_ALLOCATION_METHODOLOGY.html"] },
  "delta": { "dir": "out/delta", "files": ["delta.html", "delta.json", "delta.md", "delta.zh.md", "provenance.json"] },
  "promoted": [], "nextAction": { "en": "Done. Hand to the reliability owner for sign-off: …" } }
```

With `id: native950` in the topology worksheet the same run stops after `validate` with exit 2, `status: needs-input` and the issue
`{ level: "error", code: "id-collision", path: "native950.json: record.id" }`; the operator changes the id and runs again.

## 8. Validating an operator before the pilot

1. Run the CLI tests (`npm run test -w @hac-d/cli`): the ok path, the needs-input path and the protocol printouts.
2. Give the model the prompt, the tool manifest, the two template worksheets and a short design note; it must reproduce the session of
   §7 without touching anything outside `ws/`, and its final message must contain the KPI table and the paths — nothing invented.
3. Feed it a worksheet with a deliberate error of each level (a public id, an unknown class, a missing source): it must fix the errors
   by the table, leave the warnings with a note, and stop after three rounds.
4. Only then the pilot of the runbook §8, with the owner signing.
