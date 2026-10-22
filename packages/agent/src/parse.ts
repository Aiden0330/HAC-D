/**
 * Strict reader of a model's answer (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §6: "fenced JSON with retries"): the cards are a JSON
 * object `{"cards":[...]}` or a bare array, optionally inside a ```json fence or surrounded by prose. The first top-level balanced
 * JSON value that parses (strict JSON: no trailing commas, no comments, no single quotes) and has the right shape is taken; nothing
 * is repaired, because a repaired answer is a guess. The cards themselves are validated one by one later (parseEvidenceCard).
 */

const NO_CARDS = 'no JSON cards in model output';

/** end index (exclusive) of the balanced JSON value starting at `i` (a '{' or '['), or -1 when it never closes */
function balancedEnd(s: string, i: number): number {
  const stack: string[] = [];
  let inStr = false;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (inStr) {
      if (ch === '\\') k++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (!stack.length) return k + 1;
    }
  }
  return -1;
}

const cardsOf = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && Array.isArray((v as { cards?: unknown }).cards)) return (v as { cards: unknown[] }).cards;
  return null;
};

function scan(s: string): { cards: unknown[] | null; error?: string } {
  let error: string | undefined;
  let i = 0;
  while (i < s.length) {
    const j = s.slice(i).search(/[[{]/);
    if (j < 0) break;
    const start = i + j, end = balancedEnd(s, start);
    if (end < 0) { error ??= 'unbalanced JSON'; break; }
    try {
      const cards = cardsOf(JSON.parse(s.slice(start, end)));
      if (cards) return { cards };
      error ??= 'JSON value is neither {"cards":[...]} nor an array';
    } catch (e) {
      error ??= (e as Error).message;
    }
    i = end; // top-level values only: never accept a fragment of a value that failed
  }
  return { cards: null, error };
}

/** the cards of a model answer; throws when there is no well-formed `{cards:[...]}` / array */
export function parseCardsText(text: string): unknown[] {
  const fences = [...text.matchAll(/```[ \t]*(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/g)].map((m) => m[1]);
  let firstError: string | undefined;
  for (const body of fences.length ? fences : [text]) {
    const r = scan(body);
    if (r.cards) return r.cards;
    firstError ??= r.error;
  }
  throw new Error(firstError ? `${NO_CARDS} (${firstError})` : NO_CARDS);
}
