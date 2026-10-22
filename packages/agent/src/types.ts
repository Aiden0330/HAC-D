/**
 * Types of the v6 extraction worker (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.3, §6): the model adapter contract, chunks of a
 * source document, the per-call run log and the result of an extraction run. The model writes evidence cards only; every type
 * that carries a number HAC-D will use is produced by deterministic code downstream (draftWorksheet, the importers' parsers).
 */
import type { EvidenceCard, Disputed } from '@hac-d/core';

/** the three worksheet kinds the extraction worker drafts */
export type ExtractKind = 'topology' | 'device-fit' | 'mechanisms';

export interface CompletionRequest {
  system: string;
  user: string;
  /** JSON Schema of the expected output (used by the json_schema / guided_json modes) */
  jsonSchema?: unknown;
  temperature?: number;
  seed?: number;
  maxTokens?: number;
}
export interface CompletionResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  raw?: unknown;
}
export interface Adapter {
  readonly name: string;
  readonly model: string;
  /** sampler settings the adapter sends when the request does not set them (recorded in the run log) */
  readonly temperature?: number;
  readonly seed?: number;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
export interface AdapterSpec {
  provider: 'openai-compatible' | 'mock' | 'none';
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  mode?: 'json_schema' | 'guided_json' | 'fenced';
  temperature?: number;
  seed?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  mock?: (req: CompletionRequest) => string | Promise<string>;
}

/** one piece of a source document as the model sees it; `doc` and `loc` are authoritative for the cards drawn from it */
export interface Chunk { id: string; doc: string; loc: string; text: string; index: number }

/** one adapter call */
export interface LogEntry {
  ts: string;
  chunk: string;
  pass: number;
  model: string;
  /** sha256 (hex) of system + "\n" + user */
  promptSha256: string;
  seed?: number;
  temperature?: number;
  durationMs: number;
  usage?: CompletionResult['usage'];
  /** cards of this call that passed validation and grounding */
  cards: number;
  /** cards of this call rejected (invalid, unknown field, not grounded) */
  rejected: number;
  error?: string;
}
export interface RejectedCard { card: EvidenceCard | Record<string, unknown>; chunk: string; reason: string }

export interface ExtractOptions {
  docs: { name: string; text: string }[];
  kind: ExtractKind;
  adapter: Adapter;
  passes?: 1 | 2;
  chunkChars?: number;
  overlapChars?: number;
  maxQuoteChars?: number;
  retries?: number;
  now?: () => string;
  log?: (e: LogEntry) => void;
  onProgress?: (message: string) => void;
}
export interface ExtractResult {
  kind: ExtractKind;
  accepted: EvidenceCard[];
  disputed: Disputed[];
  rejected: RejectedCard[];
  chunks: number;
  calls: number;
  model: string;
  log: LogEntry[];
  reviewMarkdown: string;
}

export interface DraftOptions {
  id: string;
  /** how the source obtained its values; the confidence policy (SOURCE_CONFIDENCE) maps it to HAC-D confidence */
  sourceType: 'field' | 'vendor' | 'prediction' | 'paper' | 'assumed';
  template?: string;
  family?: string;
  name?: { zh: string; en: string };
  short?: { zh: string; en: string };
  scenarioId?: string;
  source?: string;
}
