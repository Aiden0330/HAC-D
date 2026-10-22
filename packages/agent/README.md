# @hac-d/agent — v6 extraction worker

The model step of the v6 input migration (`docs/markdown/PLAN_V6_INPUT_MIGRATION.md` §5.3, §6). It reads source documents
(plain text / Markdown; convert PDFs first with `pdftotext -layout`), cuts them into chunks and asks a model for **evidence cards**.
One card is one fact: a field path, the value and unit exactly as written, a verbatim quote and its location. The model never
computes, converts units, assigns event classes or HAC-D confidence. Its `model_confidence` is advisory only.

## The two checks (deterministic, from `@hac-d/core`)

1. **Grounding** (`groundCard`): the quote must occur in the chunk (whitespace-normalised, case-folded) and the value must occur
   inside the quote. A card that fails is rejected with the reason (`quote-not-in-chunk`, `value-not-in-quote`, `quote-too-long`).
   Cards that are not valid evidence cards, or that name a field outside the kind's list, are rejected as well.
2. **Two-pass agreement** (`agreeCards`): every chunk is extracted twice with two materially different prompt variants. A field is
   accepted only when both passes give the same value and unit. Otherwise it goes to the review queue (`only-in-a`, `only-in-b`,
   `value-differs`, `unit-differs`).

The chunk's `doc` and `loc` overwrite whatever the model wrote. Every call is logged with the sha256 of its prompt, the model,
the seed and temperature, the duration and the token usage. If an answer is malformed, the call is retried with a correction
line. If the adapter itself fails, the error is logged and the run continues with the next chunk.

## API

```ts
import { adapterFromSpec, extractDocuments, draftWorksheet } from '@hac-d/agent';

const adapter = adapterFromSpec({ provider: 'openai-compatible', baseUrl: 'http://host:8000/v1', model: 'qwen2.5-7b-instruct', mode: 'guided_json' });
const run = await extractDocuments({ docs: [{ name: 'design.md', text }], kind: 'topology', adapter, passes: 2 });
// run.accepted / run.disputed / run.rejected / run.log / run.reviewMarkdown
const worksheet = draftWorksheet('topology', run.accepted, { id: 'internal-x', sourceType: 'vendor', template: 'a950-ub2', family: '950' });
```

| export | what it does |
|---|---|
| `adapterFromSpec(spec)` | `openai-compatible`, `mock` (a function) or `none` (every call throws "no model configured"; the deterministic steps still run) |
| `openaiCompatibleAdapter(o)` / `mockAdapter(fn, model?)` | the adapters directly; `fetchImpl` can be injected for tests |
| `chunkDocument(doc, { chunkChars = 2500, overlapChars = 200 })` | page (`\f`) → headings / blank lines → packed chunks; loc `p.<n>` or `L<a>-<b>`; id `doc#i` |
| `buildPrompts(kind, chunk, variant)` | system + user prompt with the rules, the field list from `fieldSpecs(kind)`, two examples (zh + en), the JSON Schema |
| `parseCardsText(text)` | strict: `{"cards":[...]}` or `[...]`, fenced or inside prose; throws otherwise (no repair) |
| `extractDocuments(o)` | the run: chunks × passes → validation → grounding → agreement → de-duplication → review queue |
| `reviewMarkdown(result, lang?)` | bilingual review queue: summary, disputed, rejected, unmapped, low-confidence, cross-chunk conflicts, failed calls |
| `draftWorksheet(kind, cards, o)` | the importers' worksheet profile (topology / device-fit / mechanisms delta over `remap-latest-2026-10`) |

`draftWorksheet` gets HAC-D confidence from the source-type policy (`SOURCE_CONFIDENCE[sourceType]`) and never from the model.
Source is `doc loc` and the note is the quote. Two deterministic unit conversions exist: a percent becomes a fraction (AFR,
coverage, success), and minutes or hours become seconds for `…Seconds` mechanism parameters. A converted row is marked `derived`
and its note states the conversion. A card whose value does not parse, whose unit is unknown, or that conflicts with an earlier
card for the same field is not placed in the worksheet. Such cards are listed under `## notes`.

The `kind` values map to fields as follows:

- **`topology`**: the `superpod.*`, `scaleOut.*`, `layers.*`, `countOverrides.*` and `domainNpus` paths. The person supplies
  id, name, template and family in `DraftOptions`.
- **`device-fit`**: device rows as `unmapped` cards, with `label` = the device.
- **`mechanisms`**: `parameters.<MECHANISM-ID>.<key>`.

## Pointing it at the on-prem model

Any OpenAI-compatible server works (vLLM, SGLang, llama.cpp `llama-server`). The CLI is `hacd ingest extract`:

```sh
hacd ingest extract design.txt --kind topology \
  --provider openai-compatible --base-url http://host:8000/v1 --model <served-model-name> \
  --mode guided_json            # vLLM: schema-guided decoding (extra field guided_json)
  # --mode json_schema          # servers with response_format {type: json_schema} (SGLang, llama.cpp, recent vLLM)
  # --mode fenced               # no constrained decoding: prompt-only JSON, strict parser + one retry
  --api-key-env HACD_LLM_KEY    # only if the server wants a bearer token (read from the environment, never logged)
  --source-type vendor --id internal-x --template a950-ub2 --out data-staging/extract-1
```

The output directory holds `cards.json`, `disputed.json`, `rejected.json`, `review.md`, `log.jsonl` and, when `--source-type`
is given, the draft worksheet. Review it, complete it, then continue with
`hacd ingest worksheet → validate → dry-run → diff → promote`.

The base URL may end in `/v1` or in `/v1/chat/completions`. The temperature defaults to 0. The second pass changes the prompt,
not the sampler, so agreement works on a server that cannot sample. The request timeout defaults to 120 s.

## Tests

`npm run test -w @hac-d/agent` runs without network, using mock adapters and an injected `fetch`. The tests cover:

- the chunker and the strict parser;
- grounding and agreement;
- retries and adapter errors;
- the request body for each adapter mode;
- an end-to-end synthetic (fictional) topology document → draft worksheet → `worksheetToTopologyRecord`;
- a device table → `worksheetToDeviceTable`;
- a mechanisms delta → `worksheetToMechanismSet`.
