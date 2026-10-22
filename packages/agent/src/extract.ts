/**
 * The extraction run of the v6 worker (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.3, §6): chunk the documents, ask the model for
 * evidence cards twice per chunk with two prompt variants, and keep only what two deterministic checks let through —
 *   grounding  (core `groundCard`): the quote occurs in the chunk and the value inside the quote;
 *   agreement  (core `agreeCards`): both passes give the field the same value and unit.
 * Cards that fail validation, name a field outside the kind's list or fail grounding are rejected with the reason; fields the two
 * passes disagree on go to the review queue. The chunk's doc and loc overwrite the model's. A malformed answer is retried with a
 * correction line; an adapter error is logged and the run continues with the next chunk. Every call is logged with the sha256 of
 * its prompt. Nothing here computes a value: that is the drafter's and the normaliser's job.
 */
import { createHash } from 'node:crypto';
import { parseEvidenceCard, groundCard, agreeCards, cardKey, normalizeText, fieldSpecs, type EvidenceCard, type Disputed } from '@hac-d/core';
import { chunkDocument } from './chunk.js';
import { parseCardsText } from './parse.js';
import { buildPrompts, TOPOLOGY_META } from './prompts.js';
import { reviewMarkdown } from './review.js';
import type { Chunk, ExtractKind, ExtractOptions, ExtractResult, LogEntry, RejectedCard } from './types.js';

/** the field paths a card of the kind may carry ('unmapped' always) */
export function allowedFields(kind: ExtractKind): Set<string> {
  const paths = kind === 'topology' ? fieldSpecs('topology').map((s) => s.path).filter((p) => !TOPOLOGY_META.has(p))
    : kind === 'mechanisms' ? fieldSpecs('mechanisms').map((s) => s.path).filter((p) => p.startsWith('parameters.'))
      : [];
  return new Set([...paths, 'unmapped']);
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const CORRECTION = 'Your previous answer could not be used: answer again with one JSON object {"cards":[...]} only, strict JSON (double quotes, no trailing commas, no comments, no prose), every card with doc, field, value_text, unit_text and quote.';

interface CallOutcome { cards: EvidenceCard[]; rejected: RejectedCard[]; adapterError?: string }

/** check the raw cards of one answer: validation, field list, grounding */
function checkCards(raw: unknown[], chunk: Chunk, allowed: Set<string>, maxQuote: number): { cards: EvidenceCard[]; rejected: RejectedCard[] } {
  const cards: EvidenceCard[] = [], rejected: RejectedCard[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { rejected.push({ card: { value: r as unknown }, chunk: chunk.id, reason: 'invalid-card: not an object' }); continue; }
    const withLoc = { ...(r as Record<string, unknown>), doc: chunk.doc, loc: chunk.loc };
    let c: EvidenceCard;
    try { c = parseEvidenceCard(withLoc); } catch (e) { rejected.push({ card: withLoc, chunk: chunk.id, reason: `invalid-card: ${(e as Error).message.replace(/^invalid evidence card: /, '')}` }); continue; }
    if (!allowed.has(c.field)) { rejected.push({ card: c, chunk: chunk.id, reason: 'unknown-field' }); continue; }
    if (c.field === 'unmapped' && !c.label?.trim()) { rejected.push({ card: c, chunk: chunk.id, reason: 'unmapped-without-label' }); continue; }
    const g = groundCard(c, chunk.text, maxQuote);
    if (!g.ok) { rejected.push({ card: c, chunk: chunk.id, reason: g.reason ?? 'not-grounded' }); continue; }
    cards.push(c);
  }
  return { cards, rejected };
}

export async function extractDocuments(o: ExtractOptions): Promise<ExtractResult> {
  const passes = o.passes ?? 2, retries = Math.max(0, o.retries ?? 1), maxQuote = o.maxQuoteChars ?? 400;
  const now = o.now ?? (() => new Date().toISOString());
  const allowed = allowedFields(o.kind);
  const chunks = o.docs.flatMap((d) => chunkDocument(d, { chunkChars: o.chunkChars, overlapChars: o.overlapChars }));
  const log: LogEntry[] = [], rejected: RejectedCard[] = [], disputed: Disputed[] = [], acceptedAll: EvidenceCard[] = [];
  let calls = 0;

  const call = async (chunk: Chunk, pass: 1 | 2): Promise<CallOutcome> => {
    const p = buildPrompts(o.kind, chunk, pass, maxQuote);
    for (let attempt = 0; attempt <= retries; attempt++) {
      const user = attempt === 0 ? p.user : `${p.user}\n\n${CORRECTION}`;
      const req = { system: p.system, user, jsonSchema: p.jsonSchema };
      const entry: LogEntry = { ts: now(), chunk: chunk.id, pass, model: o.adapter.model, promptSha256: sha256(`${p.system}\n${user}`), ...(o.adapter.seed !== undefined ? { seed: o.adapter.seed } : {}), ...(o.adapter.temperature !== undefined ? { temperature: o.adapter.temperature } : {}), durationMs: 0, cards: 0, rejected: 0 };
      const t0 = Date.now();
      calls++;
      let text: string;
      try {
        const res = await o.adapter.complete(req);
        text = res.text;
        entry.model = res.model || entry.model;
        if (res.usage) entry.usage = res.usage;
      } catch (e) {
        entry.durationMs = Date.now() - t0;
        entry.error = `adapter: ${(e as Error).message}`;
        log.push(entry); o.log?.(entry);
        return { cards: [], rejected: [], adapterError: entry.error };
      }
      entry.durationMs = Date.now() - t0;
      const last = attempt === retries;
      let raw: unknown[];
      try { raw = parseCardsText(text); } catch (e) {
        entry.error = `parse: ${(e as Error).message}${last ? '' : ' (retrying)'}`;
        log.push(entry); o.log?.(entry);
        if (last) return { cards: [], rejected: [] };
        continue;
      }
      const r = checkCards(raw, chunk, allowed, maxQuote);
      const invalid = r.rejected.filter((x) => x.reason.startsWith('invalid-card')).length;
      if (raw.length > 0 && invalid === raw.length && !last) {
        entry.rejected = invalid;
        entry.error = 'validation: no card of the answer is a valid evidence card (retrying)';
        log.push(entry); o.log?.(entry);
        continue;
      }
      entry.cards = r.cards.length;
      entry.rejected = r.rejected.length;
      log.push(entry); o.log?.(entry);
      return r;
    }
    return { cards: [], rejected: [] };
  };

  for (const [k, chunk] of chunks.entries()) {
    const perPass: EvidenceCard[][] = [];
    const chunkRejected: RejectedCard[] = [];
    let failed = false;
    for (let pass = 1 as 1 | 2; pass <= passes; pass = (pass + 1) as 1 | 2) {
      o.onProgress?.(`chunk ${k + 1}/${chunks.length} (${chunk.id}, ${chunk.loc}) pass ${pass}/${passes}`);
      const r = await call(chunk, pass);
      if (r.adapterError) { failed = true; o.onProgress?.(`chunk ${chunk.id}: ${r.adapterError}; skipped`); break; }
      perPass.push(r.cards);
      chunkRejected.push(...r.rejected);
    }
    rejected.push(...chunkRejected);
    if (failed) continue;
    if (passes === 2) {
      const a = agreeCards(perPass[0], perPass[1]);
      acceptedAll.push(...a.agreed);
      disputed.push(...a.disputed);
    } else acceptedAll.push(...perPass[0]);
  }

  const seen = new Set<string>();
  const accepted = acceptedAll.filter((c) => { const key = `${cardKey(c)}\u0000${normalizeText(c.value_text)}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const base = { kind: o.kind, accepted, disputed, rejected, chunks: chunks.length, calls, model: o.adapter.model, log };
  return { ...base, reviewMarkdown: reviewMarkdown(base) };
}
