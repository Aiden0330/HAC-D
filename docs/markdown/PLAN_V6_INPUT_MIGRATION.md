# v6 plan — migrating internal inputs into HAC-D: hardware FIT, new topologies, new mechanisms

Status (2026-10-22): decided by the user — the pipeline direction, Markdown worksheets, internal ids beside the public records — and implemented the same day (DEVELOPMENT_PLAN.md "v6"; commands in USER_GUIDE.md "v6 ingest", formulas in MODEL_REFERENCE.md §26, runbook INGEST_RUNBOOK.md). The three open points of §10 were taken as assumptions: generic layouts with synthetic samples (nothing internal can be shared yet), an OpenAI-compatible endpoint with constrained JSON and a fenced-JSON fallback, and mechanisms as parameter updates plus proposals (no new transforms in v6). Originally the answer to the question "an agentic Skill that updates HAC-D inputs from internal
documents and runs the allocation — or something better, given that the internal data cannot leave the network and the only
model inside is a limited open-source one". This is also the deferred M5 decision of `PLAN_V5_REPORT_PIPELINE.md` §6
(agent module), now with a concrete use.

Follow-up v6.1 (2026-10-26): the chain runs without a person at the terminal — `hacd ingest run` (one call, `run.json` manifest, exit 0 / 2 / 3) and `hacd ingest protocol` (the on-prem model's system prompt, tool manifest and fix table), specified in `AGENT_OPERATOR.md`; §6 below stays the rule: the model never computes and never promotes.

## 1. Answer in brief

A Claude Code Skill is the wrong unit for the migration itself and the right unit for maintaining it.

- A Skill is a prompt bundle for Claude. Claude cannot see the internal documents, and the on-prem model cannot run a Skill.
  Whatever reads the legacy documents has to run inside the network, on a small model, without network or keys.
- HAC-D already has the two things the migration needs: a **data contract** (the v5 input records — topology record,
  failure-rate override, mechanism set — zod-validated, JSON Schema printable with `hacd schema --record|--mechanisms|--rates`,
  provenance and confidence on every stated value) and a **deterministic engine** behind a CLI that regenerates the whole report
  set from those records (`hacd findings | budget | study | bom | methodology | prune`). Nothing numeric is missing.
- So the deliverable is an **offline ingest pipeline** around the existing contract — `hacd ingest …` — shipped as a Node bundle
  into the network, with the on-prem model plugged in as one replaceable step (an OpenAI-compatible adapter, which is what any
  vLLM / SGLang / llama.cpp-served open model exposes). The model never drives and never computes; a script drives, the engine
  computes. On this side, a maintainer Skill (`update-inputs`) validates staged records, runs the dry run and the delta report, and
  implements the engine extensions a genuinely new design or mechanism needs.
- The migration risk is not parsing. It is **口径**: internal "hardware FIT" is device FIT (all failure modes, per device-hour,
  no protection considered); HAC-D's catalog FIT is business-impact events per 10⁹ unit-hours after the existing protection, split
  into hard / slow / sdc classes that are never added. The mapping between the two is a reviewed table owned by reliability
  engineers, not an extraction task, and the pipeline is built around that table.

## 2. What exists today (the parts to reuse)

| Piece | Where | Role in v6 |
|---|---|---|
| Topology record (`TopologyRecordSchema`) | `packages/core/src/records/topologyRecord.ts`, `packages/core/data/records/*.json` | target of "novel topological designs": template + SuperPoD preset with field overrides, scale-out design and variants, count overrides by BOM row, layer instance rule, `provenance` by field path, `assumed` list |
| Failure-rate override (`FaultRateOverrideSchema`) | `records/faultRates.ts`, `data/fault-rates/` | target of "internal hardware FIT": per-unit or per-card FIT by catalog class, each with `source`, `confidence`, `derivation`, `note`; `catalog` block with revision, hash, rate basis and anchor; `analogues` |
| Mechanism set (`MechanismSetSchema`) | `records/mechanismSet.ts`, `data/mechanism-sets/` | target of "new reliability mechanisms" that are parameter / verdict / metadata changes of mechanisms the library knows |
| Schemas as JSON Schema | `hacd schema --record \| --mechanisms \| --rates` | the published contract; what a third-party model API is given |
| Loader error messages | `parseTopologyRecord`, `parseMechanismSet`, `parseFaultRateOverride` | already name the extension points when a record asks for a unit kind, template or mechanism the engine does not have |
| Spreadsheet importer | `packages/importers` (SheetJS reader, zh/en header lexicon and column roles, formula fingerprints, topology extraction, reconciliation of the sheet's own numbers with HAC-D's) | the deterministic path for tabular FIT sources; the reconciliation idea is reused for the delta report |
| Report kit | `packages/reports` | bilingual delta and review reports from JSON, same look as the Findings set |
| MCP server | `packages/mcp` | optional tool access if the on-prem model can call tools reliably; not relied on |
| Agent module proposal | `PLAN_V5_REPORT_PIPELINE.md` §6: `extract` / `author` / `narrate`, three adapters, staging, prompts logged | v6 builds `extract` and `author` with the OpenAI-compatible adapter first; `narrate` is out of scope |
| Division of labour for weak models | `CLAUDE.md` routing: workers return raw wording and location only; the lead assigns event class, denominator, level and confidence | the on-prem model is such a worker; inside the network the "lead" is the mapping table plus a human reviewer |

Known gap found while reading: `resolveMechanismSet` merges a set's `parameters[id]` over the library defaults without checking
that each key is a parameter the mechanism's transform reads, so a misspelt key is a silent no-op. v6 adds that check (§5, gate 2).

## 3. The three input kinds are three different problems

| Input | Expressible as data today | Needs engine code | Where the risk is |
|---|---|---|---|
| Hardware FIT | yes — `FaultRateOverride` by catalog class (54 events × hard / slow / sdc, 9 fault units) | a device that maps to no class or no unit (an NPO module, an optical engine with its own classes) → unit-library entry + BOM row in `packages/core/src/topology/index.ts` | 口径: device FIT → business-impact FIT per unit (class, denominator, impact factor after protection) |
| Topology | yes within the four templates (`a2-roce`, `a3-ub384`, `a950-ub2`, `a960e-ub`): SuperPoD geometry (NPUs / CPUs per node, nodes per rack, compute and comm racks, rack switches, pod uplinks, optical links and engines per NPU, backup NPUs, sub-planes, transceivers), scale-out (ports per NPU, planes, radix, oversubscription), count overrides, layer rule, variants | a new hierarchy level, a new unit kind, or a template whose structure none of the four covers → `TOPOLOGY_TEMPLATES` entry, unit library, BOM row, golden | count consistency and which geometry facts are vendor-stated vs assumed |
| Mechanisms | yes for parameters, efforts, verdict lists, recovery baseline, derating, metadata of mechanisms in the library | a mechanism with a new effect needs a `MechanismDef` with an `apply` scenario transform, a golden and a model-check; or it is a `capability` without separate credit | stage: mechanisms on one stage take the minimum, never the sum; mapping a new mechanism onto an existing library id is a modelling decision, not an extraction |

The pipeline therefore classifies every item as **data update** (lands in a record) or **extension request** (a structured
description that crosses to the HAC-D side and becomes code with a golden). The classification is deterministic: the loader's own
error messages decide it.

## 4. Architecture: two environments, one contract

```
inside the network (no egress)                                  │ here (Claude, no internal data)
                                                                │
legacy docs / FIT tables / DB dumps                             │ schemas, worksheet profile, importers,
   │                                                            │ validators, report recipes, extension code,
   ├─ structured (xlsx / csv / dump) ─ deterministic importer    │ synthetic fixtures, goldens
   │       + 口径 mapping table (reviewed)                       │
   ├─ prose (design proposals, review minutes, mechanism specs)  │   ◄── extension requests (structure only, no values)
   │       chunk → on-prem model → evidence cards (JSON,         │   ──► offline bundle hacd-<ver>.tgz, runbook
   │         grammar-constrained) → grounding + agreement checks │
   ▼                                                            │
worksheets (Markdown, YAML front matter, fixed tables)           │
   ▼  hacd ingest worksheet   → staged records (JSON)            │
   ▼  hacd ingest validate    → schema, vocab, provenance, plausibility, consistency
   ▼  hacd ingest dry-run     → hacd budget / findings on the staged records (regime flags reported)
   ▼  hacd ingest diff        → delta report: changed inputs with source and confidence, KPI and allocation deltas
   ▼  human sign-off          → hacd ingest promote → packages/core/data/… under internal record ids, changelog entry
   ▼  hacd findings / bom / methodology  → the report set on the new inputs
```

Rules of the architecture:

1. **The engine makes every number.** The model fills fields; it never converts units, never computes a FIT, never decides a
   class, denominator or level, never merges across documents.
2. **A script drives.** `make ingest SRC=…` (or a plain shell runbook) calls the steps in order; the model is a function call
   inside step 2, replaceable by `--provider none` (the deterministic parts run without any model).
3. **Everything that crosses the boundary is structural.** Schema versions, the worksheet profile, validator messages (paths and
   codes, no values), extension requests, synthetic fixtures. Internal values stay inside.
4. **Internal records get their own ids** beside the public Ascend records (`native950`, `ubl128`, `cm384`, `a3server`,
   `a960e`), never overwriting them: the stored report provenance (`packages/reports/test/reproduce.mjs`) keeps reproducing, and the
   internal and public sets can be compared with `hacd bom --records …`.

## 5. Input format specification

### 5.1 Contract vs worksheet

- **Contract = the JSON records**, validated by the existing zod schemas. One source of truth; no parallel Pydantic layer.
- **Worksheet = a constrained Markdown profile** per input kind: YAML front matter for scalars, fixed tables with fixed headers for
  the repeated parts, one prose section the parser ignores except to keep as a note. Reviewers read Markdown, diffs of tables are
  legible, and small models produce flat tables more reliably than nested JSON. Every worksheet row maps 1:1 to a record field;
  the parser rejects anything off-profile (unknown header, merged cells, free text in a value column).
- A third-party model API is given, per task: the chunk, the evidence-card schema (§5.3), the closed vocabularies, and two
  worked examples. It never writes a worksheet directly; the normaliser does.

### 5.2 The three worksheets

**Fault rates** → `FaultRateOverride`

```
---
id: internal-fit-2026q4
basis: per-unit            # or per-card
source: <internal catalog name, revision>
catalog: { revision: …, file: …, sha256: …, rateBasis: { zh: …, en: … } }
---
| class      | unit    | fit    | source                 | confidence | derivation                                   | note |
|------------|---------|--------|------------------------|------------|----------------------------------------------|------|
| DDR-hard   | node    | 120.0  | FIT-DB table X row 17  | derived    | 8 DIMM × 30 FIT device × impact 0.5 (…)      | …    |
```

`class` is a catalog event id (`CORE-hard`, `DDR-slow`, `OPT-sdc`, `FABRIC-hard@roce` …), `unit` one of the nine fault units,
`confidence` one of measured / paper-reported / vendor / derived / assumed / scan-level. A row that is the result of arithmetic is
`derived` and must carry a `derivation`.

**Topology** → `TopologyRecord`

Front matter: `id`, `name` and `short` (zh / en), `family`, `template`, `scenarioId`. Tables: *geometry* (field | value | source |
confidence | note; `base` names a SuperPoD preset, other rows override it), *scale-out* (field | value | …), *variants* (id | name
zh | name en | basis zh | basis en | portsPerNpu | planes | radix | oversubscription | transceiversPerLink), *layers* (superpod unit
and NPUs, cabinet NPUs, node NPUs), *count overrides* (BOM row | count | source | confidence), and an *assumed* list. The parser
fills `provenance` by field path from the source / confidence columns and `assumed` from the list.

**Mechanisms** → `MechanismSet` delta over a base set, or a *mechanism proposal*

Tables: *parameter updates* (mechanism | parameter | value | source | confidence | note), *verdicts* (mechanism | verdict | reason
zh | reason en), *recovery baseline* (detection coverage / auto s / timeout s, automatic s / success, manual s | source |
confidence), *efforts*. A **proposal** worksheet for a mechanism the library does not have: name zh / en, kind (detect / recover /
checkpoint / physical), stage (detection / rung / automatic / manual / checkpoint / sdc / rate / local), deploy layer and acted-on
layers (cluster / scaleout / superpod / cabinet / node / npu), the quantity it claims to change, parameters with evidence,
prerequisites, failure modes. The proposal is either mapped by a person onto an existing library id (recorded in the worksheet) or
becomes an extension request.

### 5.3 Evidence cards — the only thing the model writes

```json
{ "doc": "DR-2025-031.pdf", "loc": "p.12 §3.2", "field": "superpod.npusPerNode",
  "value_text": "8", "unit_text": "卡/节点", "quote": "每节点配置 8 张卡", "model_confidence": "high" }
```

- `field` is drawn from the closed list of record field paths (generated from `hacd schema`), or `unmapped` with a free `label`.
- `quote` must be found verbatim (whitespace-normalised) in the chunk, and `value_text` must occur inside `quote`. A card that
  fails this **grounding check** is dropped; this removes most invented numbers from a small model at zero cost.
- Each chunk is extracted twice with two prompt variants (or two samplers); a field is accepted when both runs agree on
  `value_text` and `unit_text`; disagreements go to the review queue. Cheap on-prem, and it is the only "self-consistency" worth
  paying for at this model size.
- `model_confidence` is advisory only. HAC-D confidence is assigned by the **source-type policy** in the mapping table (field data
  → measured; vendor datasheet or prediction → vendor; any arithmetic → derived with the formula; placeholder → assumed), never by the
  model.

### 5.4 The 口径 mapping table (the artifact reliability engineers own)

| device / part | unit | class(es) | devices per unit | impact factor per class | impact basis | confidence policy |
|---|---|---|---|---|---|---|
| DDR5 DIMM | node | DDR-hard, DDR-slow | 8 | 0.5 hard, 0.2 slow | field ratio 2025H1 / assumption | derived / assumed |

The normaliser computes `FIT_class,unit = Σ_devices FIT_device × devices per unit × impact factor`, writes the formula into
`derivation`, tags the result `derived` (or `assumed` when any factor is an assumption), and refuses to run when a device has no
row. The table is versioned with the records; changing it is a reviewed change, and the delta report shows its effect.

### 5.5 Validation gates (`hacd ingest validate`, all deterministic)

1. Schema (zod) — exists.
2. Vocabulary: class ids against the catalog, units against `FAULT_UNITS`, mechanism ids against the library, **parameter keys
   against the mechanism's parameter set** (new), templates, layers, stages, confidence.
3. Provenance completeness: every stated field has a `provenance` entry or an `assumed` item; `derived` has a `derivation`.
4. Plausibility (warning, not error): FIT per class within a configurable envelope around the current catalog value (default
   ×0.1 … ×10); geometry within the template's known range.
5. Structural consistency: NPUs per cabinet = NPUs per node × nodes per rack; layer NPUs match; `main` variant equals
   `scaleOut`; recovery stages sum to the automatic attempt.
6. Dry run: `hacd budget --record <id> --scale N --rates … --mechanisms … --json` completes; the regime flags (τ+δ ≪ M, R ≪ M)
   and the Monte-Carlo routing are reported, not hidden.

### 5.6 Outputs

- **Delta report** (bilingual HTML + Markdown, report kit): changed inputs with old / new / source / confidence; KPI deltas at the
  headline scales (A_op, delivered goodput, the window-rule factor k, the recommended mechanism set); the mapping-table rows that
  produced each FIT; the extension requests found. This is what a reviewer signs, and what the migration is for.
- **Promote**: copy into `packages/core/data/…` under the internal ids, append to a changelog, run `npm test` and
  `reproduce.mjs`; then the ordinary report set (`hacd findings / bom / methodology`) on the new inputs.
- **Logs**: every model call with prompt hash, model name and version, seed, chunk id, in `data-staging/<run>/log.jsonl` (the §6
  guard rail of the v5 plan).

## 6. Using the on-prem model without trusting it

Assumptions about the model (to confirm, §10): served behind an OpenAI-compatible endpoint; supports JSON-schema or grammar
constrained output (vLLM `guided_json`, SGLang, llama.cpp grammars) or at least fenced JSON with retries; context in the
8k–32k token range; no reliable tool calling.

Use it for: locating the relevant section of a long document (retrieval, not reasoning); one small evidence card per chunk;
classification into closed vocabularies with an explicit `unsure`; drafting the reviewer's note.
Never for: arithmetic, unit conversion, 口径 assignment, merging across documents, calling the engine, deciding what is added to what.

Micro-tasks, not documents: one chunk → one field group → one JSON object. Few-shot examples come from HAC-D's own records
(public ones, so they can be shipped). Temperature 0 for the first pass; the second pass varies the prompt, not the sampler, when
the server cannot sample.

## 7. Where a Skill does belong

- **Here**: project skill `update-inputs` — given a staging directory (synthetic or sanitised records), run `validate → dry-run →
  diff`, check provenance and 口径 per `CLAUDE.md`, and, for each extension request, implement the unit-library entry / template /
  `MechanismDef` with a golden through the existing `model-check` skill. This is the maintainer loop and it never sees internal values.
- **Inside**: a runbook plus the CLI. If the on-prem model is later found to call tools reliably, `packages/mcp` can expose
  `ingest_validate` / `ingest_diff`; until then a Makefile target is the dependable "agent".

## 8. Work breakdown

| # | Task | Size | Built and verified where |
|---|---|---|---|
| T1 | Worksheet profile for the three kinds + parser → records; `hacd ingest worksheet` | 1.5 d | here, synthetic fixtures |
| T2 | Validators (vocab, parameter keys, provenance completeness, plausibility, consistency); `hacd ingest validate` | 1.5 d | here |
| T3 | Dry run + bilingual delta report; `hacd ingest dry-run \| diff` | 2 d | here |
| T4 | Offline bundle (`npm pack` with vendored dependencies or a single-executable build, Node ≥ 20), `--provider none`, runbook | 1 d | here, in a clean container without network |
| T5 | Tabular FIT importer on `packages/importers` (header lexicon extended with FIT / MTBF / device columns), mapping-table format, normaliser with derivations | 2–3 d | here on synthetic layouts; tuned inside on real ones |
| T6 | `packages/agent`: OpenAI-compatible adapter, chunker, evidence cards with constrained decoding, grounding, two-pass agreement, review queue (Markdown) | 3–4 d | here against a mocked adapter and a small local model; tuned inside |
| T7 | Extension-request format + the `update-inputs` skill | 1 d | here |
| T8 | End-to-end regression: a synthetic document set reproduces its records and KPIs to 1e-9 after a round trip; `reproduce.mjs` unaffected | 1 d | here |

About 13–15 session-days. Roughly half is fully verifiable here with synthetic data; T5 and T6 need two or three iterations
inside the network by the internal team, which is why the bundle and the runbook (T4) come before them.

Model routing (per `CLAUDE.md`): the normaliser's conversions and impact-factor arithmetic are formula work — Fable 5.1 at xhigh
with an independent check; CLI, validators and report recipes — Opus 5.5 at high; the agent module — Opus 5.5 at high. No UI in
v6, so no screenshot checks.

## 9. Against the reference proposal

Agreed and kept: code-first; the solver isolated from the model; schema validation before any computation; micro-task
extraction with constrained decoding; a CLI pipeline with ingestion, engine and reporting steps.

Changed or added:

1. **No new intermediate layer and no Python solver.** The v5 records are the layer and the TypeScript engine is the solver;
   Python stays where it is today, in the independent goldens.
2. **Markdown as worksheet, JSON as contract**, one schema (zod) rather than a Pydantic twin.
3. **Grammar-constrained output is necessary, not sufficient**: grounding and two-pass agreement are what remove invented
   numbers; the model's confidence is never HAC-D's confidence.
4. **The central reviewed artifact is the 口径 mapping table**, not the extraction prompts.
5. **Classification into data update vs extension request**: novel topologies and mechanisms may need engine code and a golden;
   the reference treats everything as configuration.
6. **The delta report is the primary output** for people; the full report set is a consequence.
7. **Internal records live beside the public ones** under their own ids; nothing public is overwritten.

## 10. Decisions needed before starting

1. Direction: contract + offline pipeline + maintainer skill, as the M5 decision scoped to `extract` and `author` with the
   OpenAI-compatible adapter (recommended), or a Skill-only attempt first.
2. Worksheet format: Markdown with YAML front matter (recommended) or JSON only.
3. What may be shared with this side: anonymised column headers and section outlines of the three legacy document kinds, and
   synthetic samples. Without them T5 and T6 are built on generic layouts and tuned inside.
4. On-prem serving facts: OpenAI-compatible endpoint, constrained JSON support, context length, whether two samplers are available.
5. New mechanisms in v6: parameter updates of known mechanisms only, or also new transforms with goldens (each one a formula task).
6. Record policy: internal ids beside the public Ascend records (recommended), never overwriting them.
