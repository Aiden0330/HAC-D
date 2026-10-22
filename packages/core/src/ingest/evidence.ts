/**
 * v6 evidence cards (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.3): the only thing an extraction model writes. One card = one
 * field of a worksheet as it stands in one chunk of a source document: the value and unit as written, a verbatim quote and its
 * location. Two deterministic checks make a small model safe to use: the quote must be found in the chunk and the value inside
 * the quote (grounding), and two independent passes must agree on the value (agreement). The model's own confidence is advisory:
 * HAC-D confidence is assigned later by the source-type policy of the normaliser, never by the model.
 */
import { z } from 'zod';

export const MODEL_CONFIDENCES = ['high', 'medium', 'low', 'unsure'] as const;
export const EvidenceCardSchema = z.object({
  /** source document id (file name) */
  doc: z.string().min(1),
  /** location inside the document: page, section, sheet!cell, line range — as the chunker labels it */
  loc: z.string().default(''),
  /** a field path of the worksheet kind (fieldSpecs), or 'unmapped' with a `label` */
  field: z.string().min(1),
  label: z.string().optional(),
  /** the value exactly as written in the source (digits, separators, Chinese numerals untouched) */
  value_text: z.string().min(1),
  /** the unit exactly as written ('' when the source states none) */
  unit_text: z.string().default(''),
  /** verbatim snippet of the chunk that contains value_text */
  quote: z.string().min(1),
  model_confidence: z.enum(MODEL_CONFIDENCES).default('unsure'),
}).strict();
export type EvidenceCard = z.infer<typeof EvidenceCardSchema>;

/** Validate one card (JSON); the error lists every issue with its path. */
export function parseEvidenceCard(input: unknown): EvidenceCard {
  const r = EvidenceCardSchema.safeParse(input);
  if (!r.success) throw new Error(`invalid evidence card: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}
export const evidenceCardJsonSchema = (): unknown => z.toJSONSchema(EvidenceCardSchema, { io: 'input' });

/** NFKC, whitespace collapsed, case folded: what "the same text" means for grounding and agreement */
export const normalizeText = (s: string): string => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export type GroundingFailure = 'quote-not-in-chunk' | 'value-not-in-quote' | 'quote-too-long';
export interface GroundingResult { ok: boolean; reason?: GroundingFailure }

/**
 * Grounding check: the quote (whitespace-normalised, case-folded) occurs in the chunk, the value occurs in the quote and the quote
 * is short enough to be a citation rather than the chunk itself (default ≤ 400 characters).
 */
export function groundCard(card: EvidenceCard, chunkText: string, maxQuoteChars = 400): GroundingResult {
  if (card.quote.length > maxQuoteChars) return { ok: false, reason: 'quote-too-long' };
  const q = normalizeText(card.quote);
  if (!normalizeText(chunkText).includes(q)) return { ok: false, reason: 'quote-not-in-chunk' };
  if (!q.includes(normalizeText(card.value_text))) return { ok: false, reason: 'value-not-in-quote' };
  return { ok: true };
}

/** the key two cards must share to be about the same thing */
export const cardKey = (c: EvidenceCard): string => (c.field === 'unmapped' ? `unmapped:${normalizeText(c.label ?? '')}` : c.field);
const rank: Record<EvidenceCard['model_confidence'], number> = { high: 3, medium: 2, low: 1, unsure: 0 };
const minConf = (a: EvidenceCard['model_confidence'], b: EvidenceCard['model_confidence']) => (rank[a] <= rank[b] ? a : b);

export interface Disputed { key: string; a?: EvidenceCard; b?: EvidenceCard; reason: 'only-in-a' | 'only-in-b' | 'value-differs' | 'unit-differs' }
export interface Agreement { agreed: EvidenceCard[]; disputed: Disputed[] }

/**
 * Agreement of two passes over the same chunk: a field is accepted when both passes give it the same value and unit (normalised);
 * a field seen by one pass only, or with different values, goes to the review queue. The accepted card carries the lower of the two
 * model confidences.
 */
export function agreeCards(a: EvidenceCard[], b: EvidenceCard[]): Agreement {
  const A = new Map(a.map((c) => [cardKey(c), c] as const)), Bm = new Map(b.map((c) => [cardKey(c), c] as const));
  const agreed: EvidenceCard[] = [], disputed: Disputed[] = [];
  for (const [k, ca] of A) {
    const cb = Bm.get(k);
    if (!cb) { disputed.push({ key: k, a: ca, reason: 'only-in-a' }); continue; }
    if (normalizeText(ca.value_text) !== normalizeText(cb.value_text)) disputed.push({ key: k, a: ca, b: cb, reason: 'value-differs' });
    else if (normalizeText(ca.unit_text) !== normalizeText(cb.unit_text)) disputed.push({ key: k, a: ca, b: cb, reason: 'unit-differs' });
    else agreed.push({ ...ca, model_confidence: minConf(ca.model_confidence, cb.model_confidence) });
  }
  for (const [k, cb] of Bm) if (!A.has(k)) disputed.push({ key: k, b: cb, reason: 'only-in-b' });
  return { agreed, disputed };
}

/**
 * Parse a number as written in a source: thousands separators (',', ' ', '_', '，'), full-width digits (NFKC), a trailing 万 / 千 /
 * k multiplier. Returns null for anything else (a range, a word, a percentage sign — the caller decides what the unit means).
 */
export function parseNumberText(s: string): number | null {
  const t = s.normalize('NFKC').trim().replace(/[,\s_，]/g, '');
  const m = /^([-+]?\d+(?:\.\d+)?)(万|千|k|K)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  const mult = m[2] === '万' ? 1e4 : m[2] === '千' || m[2] === 'k' || m[2] === 'K' ? 1e3 : 1;
  return Number.isFinite(v) ? v * mult : null;
}
