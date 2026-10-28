# Pilot of the project workflow with a mock on-prem model — 2026-10-27

The second pilot of the operator protocol (`AGENT_OPERATOR.md` §11): instead of worksheets, the model changes one project the way the
web pages do — the topology inputs, the FIT of the fault types, a mechanism parameter — and produces its Findings report, through the
reference host inside the offline bundle, with the mock on-prem model (§9) standing in for the internal model. Same synthetic inputs
as the worksheet pilot (`PILOT_2026Q3_MOCK.md`), so the two input paths can be compared: they give the same numbers to the last digit.

## 1. Scope

| Item | Pilot |
|---|---|
| Start | the public record `a3server` at 100,000 NPUs (`hacd scenario new --record a3server`: its geometry and the default mechanism set's baseline — what the web app's built-in project is) |
| Changes (the task's lines) | geometry: 3 servers per cabinet (`topology.superpod.nodesPerRack=3`), 2 RoCE planes of 128-port switches (`topology.scaleOut.planes=2`, `radix=128`), target A_op 0.985; FIT: the 14 classes of the worksheet pilot's normalized override `acme-fit-2026q3.json`, as FIT per unit-hour on the unit library's units (OPT-hard@roce 120, the deliberately implausible value, among them); mechanisms: R-REPLAY success 0.92 applied |
| Not expressible | the worksheet pilot's D-HARD detectSeconds 20 is a *candidate* parameter of the mechanism set; the project workflow sets a project's applied mechanisms, not the set's candidates — the set delta of the worksheet path is the record of it (§6) |
| Settings | the report preset: 400 windows, 300 Shapley permutations, seed 1, one scale (100,000) |
| Data | every value invented (`packages/cli/test/fixtures/pilot/internal/project-workflow.md`, shipped as `examples/pilot/project-workflow.md`); no internal data was used or seen |

## 2. Who did what

| Role | In this pilot |
|---|---|
| Task | `project-workflow.md`: the five lines of the mock's grammar plus the sources of every value |
| Operator model | `tools/mock-onprem-model.mjs`, project personality: one command per turn, read back, the final message of procedure D; it saw nothing but the task and the tool results, computed nothing, wrote no file |
| Host | `bin/hacd ingest operate --lang zh --task "$(cat examples/pilot/project-workflow.md)"` of the bundle `hacd-0.5.0` (rebuilt for this pilot) |
| HAC-D | every computation and every write: `scenario new / fields / set / fit / mechanisms / show / report` as child processes of the CLI |
| Reliability owner | the author, on synthetic data: read the final message, `show`'s summary and the Findings page; no promote exists in this workflow (a project is not a record) |

## 3. The session

```sh
node tools/mock-onprem-model.mjs --port 0                     # the stand-in model
export HACD_DATA=…/hacd-0.5.0/data
bin/hacd ingest operate --base-url http://127.0.0.1:<port>/v1 --model mock-onprem --work …/work --lang zh \
  --task "$(cat examples/pilot/project-workflow.md)"
```

8 model turns, 7 tool calls, 0 files written by the model, 34 s in all (the report 32.8 s of it).

| Turn | Tool | Command | s |
|---|---|---|---|
| 1 | `hacd_scenario_new` | `hacd scenario new --record a3server --npus 100000 --id acme-a3-2026q3-pw --name … --out <work>/project/acme-a3-2026q3-pw.json --json` | 0.2 |
| 2 | `hacd_scenario_fields` | `hacd scenario fields <project> --json` — the settable paths, the project's 60 fault types with their FIT, the mechanisms with their parameters | 0.2 |
| 3 | `hacd_scenario_set` | `--set topology.superpod.nodesPerRack=3 topology.scaleOut.planes=2 topology.scaleOut.radix=128 targets.operational=0.985` | 0.2 |
| 4 | `hacd_scenario_fit` | `--set COOL-hard=2880 CORE-hard=450 … SSD-hard=1378.1485427248` (14 classes) | 0.2 |
| 5 | `hacd_scenario_mechanisms` | `--apply R-REPLAY:success=0.92` | 0.2 |
| 6 | `hacd_scenario_show` | the project as set: template a3-ub384, 100,000 NPUs, 3 nodes per cabinet, 2 planes × radix 128, UB domain 8, 14 FIT overrides, R-REPLAY {success 0.92, successSeconds 5, failureSeconds 10}, KPI strip | 0.2 |
| 7 | `hacd_scenario_report` | `--out <work>/out --scales 100000 --trials 400 --permutations 300 --json` → status ok | 32.8 |
| 8 | — | the final message: status, the project file, the 19 changes as (path, value, source), the mechanisms applied, the KPI row, the four paths | |

Every tool call exited 0; no command carried `--force` or `--promote`; `operator-result.json` lists `writes: []`; the log holds every turn and no key.

## 4. Results (`out/data/results.json`, 100,000 NPUs)

口径: A_op of one synchronous job per cluster-hour (formula 1 of the Methodology), nominal and derated; MTBF_hw and MTTR_hw of the
derated design; P = share of 400 30-day windows at or above the target; k = the uniform hardware factor of the window rule.

| 100,000 NPUs | A_op | A_op derated | MTBF_hw | MTTR_hw | P(window) | k | recommended |
|---|---|---|---|---|---|---|---|
| public `a3server` baseline (worksheet pilot's "before") | 99.107 % | 99.005 % | 3.03 h | 104 s | 95.8 % | 1.147 | — |
| worksheet pilot "after" (`acme-a3-2026q3`, override, set delta) | 99.029 % | 98.897 % | 2.63 h | 101 s | 94.5 % | 1.106 | — |
| **this pilot**: project workflow on `a3server` | **99.029 %** | **98.897 %** | **2.63 h** | **101 s** | **94.5 %** | **1.106** | — |

The two input paths agree exactly: today's A_op 0.9902907643644036 / 0.9889725938253819, MTBF_hw 2.628805671870975 h, MTTR_hw
100.81707081095948 s, P 0.945, k 1.1057400393243237, the recommended design (no added mechanism, hardware ceiling × 1.106, A_op
98.933 / 98.787 % derated, P 93.0 %) — every difference 0.0. Required: B = 53.0 s/h, MTBF ≥ 1.90 h at today's MTTR or MTTR ≤ 139 s
at today's MTBF. The Findings page's Figure 1 draws the changed geometry ("每柜 3 节点 / 24 NPU"). The bundle `acme-a3-2026q3-pw-findings-data.json`
re-renders the page byte for byte with `hacd findings --data`.

Why they agree: a project started from the record carries the record's geometry and the default set's baseline with its parameters;
the worksheet path builds the same scenario from the staged record and the set; the 14 FIT values are the override's per-unit values
(the worksheet path normalises device FIT into them, the project path takes them as given); R-REPLAY's success is the only baseline
parameter the set delta changed, and the project applied it. The D-HARD candidate parameter (20 s in the set delta, 1 s in the default
set) does not enter today's numbers and did not enter the recommended design at this scale (no mechanism was added), so the plans agree too.

## 5. Acceptance

| # | Criterion | Evidence |
|---|---|---|
| 1 | every command of the chain exits 0 and the report manifest says ok | the seven tool calls in `operator-result.json`, `lastRun { status: ok, exitCode: 0 }`, host exit 0 |
| 2 | what the task states is what the project holds — nothing more, nothing less | `hacd scenario show --json` after the run: 4 fields, 14 FIT overrides, R-REPLAY success 0.92, applied set D-SDC + R-SDC + R-REPLAY + R-PROCESS + R-ELASTIC + C-FAST; the final message lists the same 19 changes with their source |
| 3 | the model copies and runs; it writes nothing and computes nothing | `writes: []`; every value in the commands appears in the task verbatim; no `--force` / `--promote` |
| 4 | the report equals the worksheet path's for the same inputs | §4: every KPI identical to the last digit |
| 5 | the output reproduces | `hacd findings --data <bundle>.json` renders the identical page |

Output of the pilot (`data-staging/pilot-project/`, kept out of git): `work/project/acme-a3-2026q3-pw.json`, `work/out/` (the Findings and
Methodology pages, `data/`, the bundle), `work/operator-log.jsonl`, `work/operator-result.json`, `mock.out`, `operate.out`, `rerender/`.

## 6. Limits of this pilot, and what it does not cover

- The mock follows a fixed grammar (`Project workflow: template|record …, npus …` and the Set / FIT / Mechanisms / Report lines); it
  shows that a model which follows procedure D gets the report with no human at the terminal and no file of its own, not that a given
  7B–70B model does. The validation steps of `AGENT_OPERATOR.md` §8 apply to the real model before its pilot.
- A candidate's parameter (the set's D-HARD detectSeconds) is outside the project workflow by design: the mechanism set is a record
  with its own provenance, changed through the worksheet path (a `mechanisms` worksheet, `hacd ingest run`). A project changes what
  is applied; the set defines what the allocation may add.
- One scale, one project, no extension request; a real pilot would also exercise a field the vocabulary refuses (the model must stop
  and report, not invent a path) and the stale-result case of the web app (a project edited after its report).
- `hacd scenario new --record` was added for this pilot: a project from a public record, which is what the web app's built-in
  projects are; a project from a template starts from the library's mechanism parameters instead of the set's.
