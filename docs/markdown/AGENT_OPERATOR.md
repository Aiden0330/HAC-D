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

HAC-D ships that host (v6.1, `packages/cli/src/operate.ts` over `packages/agent/src/host.ts`):

```sh
hacd ingest operate --base-url http://host:8000/v1 --model <name> [--api-key-env NAME] --work <dir> --docs <file|dir>… [--brief <file.md>]
                    [--before-record <public id>] [--scales 100000] [--trials 400] [--permutations 300] [--lang zh|en] [--max-steps 60] [--task "<text>"]
```

It sends the system prompt, the task written from the flags and the owner's brief (work folder, the documents with a one-line description
each, the baseline record, scales / windows / permutations, the model endpoint for `extract`), and the tool manifest plus `read_file` /
`write_file` / `list_files` in the OpenAI function-calling shape. Every hacd_* call becomes a child process of the same CLI, so the repo's
`node --import tsx main.ts` and the bundle's `bin/hacd` both work. The host trusts nothing: reads only under `<work>/` and the
documents, writes only under `<work>/ws/`, folder arguments (`out`, `staging`, `worksheets`) inside the work folder, every argument
checked against the manifest's schema (enum, pattern, `trials ≥ 35`), any value starting with a dash refused (so `--force`, `--promote`
and `--data` cannot reach the CLI), a step cap (`--max-steps`), a transport retry for the long pipeline call, and a log of every turn
and tool call without the API key (`<work>/operator-log.jsonl`). Its outputs: the model's final message on stdout,
`<work>/operator-result.json` (turns, tool calls, writes, commands, the last run's status); exit code = the last `hacd ingest run`'s
(0 ok, 2 needs-input, 3 failed), 1 when the model did not finish or never ran the pipeline. The key goes in through an environment
variable, never on the command line.

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

Every step below runs without a real model, against the mock of §9, and `packages/cli/test/operate.test.ts` runs steps 2 and 3 on every
`npm test`.

1. The CLI tests (`npm run test -w @hac-d/cli`): `hacd ingest run` on its ok and needs-input paths, the protocol printouts, and the
   three operator scenarios of step 2 and 3 through `hacd ingest operate`.
2. The ok path: the synthetic inputs of `packages/cli/test/fixtures/pilot/internal` (a design note in prose, one quarter of device
   FIT as a CSV, the reviewed 口径 mapping, a mechanism parameter note, the owner's brief) through the host —

   ```sh
   node scripts/mock-onprem-model.mjs --port 8010 &
   hacd ingest operate --base-url http://127.0.0.1:8010/v1 --model mock-onprem --work /tmp/w --docs packages/cli/test/fixtures/pilot/internal \
                       --brief packages/cli/test/fixtures/pilot/internal/brief.md --before-record a3server --scales 10000 --trials 40 --permutations 10 --lang en
   ```

   The expected session is 8 model turns and 15 tool calls: read the four documents; the two templates and `import-fit`; the mapping
   and mechanisms worksheets, `normalize`, `extract`; read the draft; write the topology worksheet; `run`; read `SUMMARY.md`; the final
   message with the KPI table, the two warnings (`implausible` on the optics class, `provenance-missing` on the set) and the paths.
   Nothing is written outside `ws/`, no command carries `--force` or `--promote`.
3. The deliberate errors (`packages/cli/test/fixtures/pilot/errors`: a worksheet set with a public record id, an unknown class
   `HBM-hard` and an empty source cell; the brief says the worksheets are already prepared): three runs — the empty cell stops the
   worksheet conversion (`worksheet-parse`, the stderrTail names the cell), then the gates report `id-collision` and `unknown-class`,
   the model looks the vocabulary up with `hacd ingest fields fault-rates --json` and fixes both — and the third run is `ok`. The stale
   staged record of the public id is gone because `run` removes the previous conversion's outputs before converting again. The
   unfixable set (`packages/cli/test/fixtures/pilot/unfixable`: an unknown count row) ends after one run with the issue reported as
   `(path, code)`, nothing written, exit 2.
4. Only then the pilot of the runbook §8, with the owner signing. The pilot was run with the mock on 2026-10-27 (§10).

## 9. The mock on-prem model (`scripts/mock-onprem-model.mjs`, in the bundle `tools/`)

An OpenAI-compatible chat-completions server with scripted answers, so the host, the protocol and the pipeline can be exercised
before a real model is connected: a request without `tools` is an extraction call and gets evidence cards drawn from the chunk by
regular expressions over the sentences of the synthetic design note (grounded quotes, identical on both passes; `--flaky` drops one
card in pass 2 to show the review queue); a request with `tools` is an operator turn, answered by a state machine over the conversation
that follows the prompt's procedure and the fix table (`id-collision`, `unknown-class`, `worksheet-parse`; at most three rounds; stop
when a round changes nothing). It sees the documents only through the host's tools and never computes a number. It is a stand-in for
the wiring, not evidence that a given model will follow the prompt: that is what the pilot with the real model shows.

## 10. The pilot run of 2026-10-27 (mock model)

The runbook §8 pilot was run inside the bundle with the mock model on the synthetic ACME A3 server cluster (public baseline `a3server`,
100,000 NPUs, one quarter of device FIT, one mechanism delta; 400 windows, 300 permutations): 8 model turns, 15 tool calls, 3 worksheets,
one pipeline run of 65 s, status `ok`, 2 warnings written down, 0 extension requests; promoted after review, `findings` on the promoted
inputs rendered with identical results. All five acceptance items held. The session, the KPI delta and how the inputs explain it, the
gates, the pipeline defects the pilot found and fixed, and the limits of a mock-model pilot are in `PILOT_2026Q3_MOCK.md`.
