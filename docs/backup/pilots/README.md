# Pilot evidence

The committed evidence of the operator-protocol pilots run with the mock on-prem model on synthetic inputs (`packages/cli/test/fixtures/pilot/internal`, shipped in the offline bundle as `examples/pilot/`): the JSON and Markdown a run writes — manifests, summaries, the operator result with every tool call and command, the sidecar the reports are rendered from — never the rendered pages (they re-render from the sidecar) and never a data-folder copy. No internal data: every value is invented. The working folders of the runs (`data-staging/`) stay out of git; that folder is the staging area for internal inputs in a real pilot.

| Folder | Pilot | Report | Re-render |
|---|---|---|---|
| `2026q3-worksheet-mock/` | the worksheet path (`hacd ingest run` through `hacd ingest operate`), 2026-10-27 | `docs/markdown/PILOT_2026Q3_MOCK.md` | `hacd findings --data docs/backup/pilots/2026q3-worksheet-mock/data --out <dir>` (with the current recipes; the pilot's own pages were rendered by the v6.2 recipes, before the schematic figure) |
| `2026q3-project-workflow/` | the project workflow (`hacd scenario …` through `hacd ingest operate`), 2026-10-27 | `docs/markdown/PILOT_2026Q3_PROJECT_WORKFLOW.md` | `hacd findings --data docs/backup/pilots/2026q3-project-workflow/data --out <dir>` — byte-identical to the pilot's page |

Files: `run.json` / `SUMMARY.md` (the manifest and summary of `hacd ingest run`), `final-message.txt` (the model's final message), `operator-result.json` (the host's record of the session: tool calls, commands, writes, usage, exit), `data/` (results.json, mechanisms.json, provenance.json, records.json, the `<id>.json` Shapley study), `delta/` (the input / KPI delta of the worksheet pilot as JSON and Markdown), `project/` (the project file the model produced in the project workflow).
