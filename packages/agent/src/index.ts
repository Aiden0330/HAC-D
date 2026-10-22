/**
 * @hac-d/agent — the v6 extraction worker (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.3, §6): model adapters (OpenAI-compatible,
 * mock, none), a deterministic chunker, prompts with two variants, a strict answer parser, the extraction run with the grounding and
 * two-pass agreement checks of @hac-d/core, the review queue and the worksheet drafter in the importers' profile.
 */
export type {
  ExtractKind, CompletionRequest, CompletionResult, Adapter, AdapterSpec, Chunk, LogEntry, RejectedCard, ExtractOptions, ExtractResult, DraftOptions,
} from './types.js';
export { adapterFromSpec, openaiCompatibleAdapter, mockAdapter, noneAdapter, chatCompletionsUrl, chatCompletionsBody, type OpenAICompatibleOptions, type OutputMode } from './adapters.js';
export { chunkDocument } from './chunk.js';
export { parseCardsText } from './parse.js';
export { buildPrompts, cardsJsonSchema, fieldList } from './prompts.js';
export { extractDocuments, allowedFields } from './extract.js';
export { reviewMarkdown } from './review.js';
export { draftWorksheet, deviceRateUnit } from './draft.js';
