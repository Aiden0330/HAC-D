/**
 * Deterministic chunker of the v6 extraction worker (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §6: "micro-tasks, not documents").
 * A document is split on form feeds (pages of a PDF-to-text export), then into paragraphs at headings (`#…` or `3.2 …`) and blank
 * lines; paragraphs are packed into chunks of at most `chunkChars` characters (a longer paragraph is split hard, at a line, sentence
 * or word boundary when one lies in the second half of the window). Each chunk after the first of a page starts with up to
 * `overlapChars` characters of the previous chunk, so a fact cut by a boundary is seen whole once; the duplicates this produces are
 * removed after agreement. A chunk's text is an exact slice of the document, so a verbatim quote of the model is found in it.
 * loc = `p.<n>` when the document has form feeds, else `L<startLine>-<endLine>` (1-based, the overlap included); id = `${doc}#${index}`.
 */
import type { Chunk } from './types.js';

interface Span { start: number; end: number }
const HEADING = /^(#{1,6} |\d+(\.\d+)*\s)/;
const BREAKS = ['\n', '。', '；', '！', '？', '. ', '; ', '，', ', ', ' '];

/** paragraph spans of a page: blank lines end a paragraph, a heading line starts one */
function paragraphs(page: string): Span[] {
  const out: Span[] = [];
  let cur: Span | null = null;
  let pos = 0;
  for (const line of page.split('\n')) {
    const start = pos, end = pos + line.length;
    pos = end + 1;
    if (!line.trim()) { if (cur) { out.push(cur); cur = null; } continue; }
    if (cur && HEADING.test(line.trimStart())) { out.push(cur); cur = null; }
    if (cur) cur.end = end; else cur = { start, end };
  }
  if (cur) out.push(cur);
  return out;
}

/** a cut position in (lo, hi]: the last boundary in the second half of the window, else hi; never inside a surrogate pair */
function cutAt(text: string, lo: number, hi: number): number {
  const window = text.slice(lo, hi), half = Math.floor((hi - lo) / 2);
  let best = -1;
  for (const b of BREAKS) { const k = window.lastIndexOf(b); if (k >= half) { best = lo + k + b.length; break; } }
  let cut = best > lo ? best : hi;
  if (cut < text.length && /[\uDC00-\uDFFF]/.test(text[cut])) cut--;
  return cut > lo ? cut : hi;
}

function splitLong(page: string, s: Span, max: number): Span[] {
  const out: Span[] = [];
  let start = s.start;
  while (s.end - start > max) {
    const cut = cutAt(page, start, start + max);
    out.push({ start, end: cut });
    start = cut;
    while (start < s.end && /\s/.test(page[start])) start++;
  }
  if (start < s.end) out.push({ start, end: s.end });
  return out;
}

/** start of the overlap carried from a chunk ending at `end`: ≥ end − overlap, moved forward to a line / word / sentence start */
function overlapStart(page: string, chunkStart: number, end: number, overlap: number): number {
  if (overlap <= 0) return end;
  const lo = Math.max(chunkStart, end - overlap);
  if (lo === chunkStart) return lo;
  const tail = page.slice(lo, end);
  for (const b of ['\n', ' ', '。', '；', '，', '. ', ', ']) { const k = tail.indexOf(b); if (k >= 0 && lo + k + b.length < end) return lo + k + b.length; }
  return lo;
}

export function chunkDocument(doc: { name: string; text: string }, o: { chunkChars?: number; overlapChars?: number } = {}): Chunk[] {
  const max = Math.max(1, Math.floor(o.chunkChars ?? 2500));
  const overlap = Math.max(0, Math.min(Math.floor(o.overlapChars ?? 200), max - 1));
  const text = doc.text.replace(/\r\n?/g, '\n');
  const pages = text.split('\f');
  const paged = pages.length > 1;
  const chunks: Chunk[] = [];
  let lineBase = 1; // line number of the first line of the current page
  pages.forEach((page, p) => {
    const lineOf = (off: number) => lineBase + (page.slice(0, off).match(/\n/g)?.length ?? 0);
    const spans = paragraphs(page).flatMap((s) => (s.end - s.start > max ? splitLong(page, s, max) : [s]));
    let group: Span | null = null, prev: Span | null = null;
    const flush = () => {
      if (!group) return;
      const start = prev ? overlapStart(page, prev.start, prev.end, overlap) : group.start;
      const from = Math.min(start, group.start);
      const body = page.slice(from, group.end);
      if (body.trim()) {
        const index = chunks.length;
        chunks.push({ id: `${doc.name}#${index}`, doc: doc.name, loc: paged ? `p.${p + 1}` : `L${lineOf(from)}-${lineOf(group.end)}`, text: body, index });
      }
      prev = group;
      group = null;
    };
    for (const s of spans) {
      if (group && s.end - group.start > max) flush();
      group = group ? { start: group.start, end: s.end } : { ...s };
    }
    flush();
    lineBase += page.match(/\n/g)?.length ?? 0;
  });
  return chunks;
}
