/**
 * v6 worksheet profile (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.1): a constrained Markdown document — YAML front matter for the
 * scalars, `## name` sections, pipe tables with fixed headers for the repeated parts, `- ` items, and prose the parser keeps only as
 * notes. Strict on purpose: unknown table headers, ragged rows and malformed separators are errors with line numbers, because a
 * worksheet that parses must mean exactly one record. The writer produces the same profile, so records round-trip.
 */
import YAML from 'yaml';

export class WorksheetError extends Error {
  constructor(message: string, public readonly line?: number) { super(line !== undefined ? `line ${line}: ${message}` : message); this.name = 'WorksheetError'; }
}

export interface WsTable { headers: string[]; rows: Record<string, string>[]; line: number }
export interface WsSection { name: string; heading: string; line: number; tables: WsTable[]; items: string[]; text: string[] }
export interface WsDoc { front: Record<string, unknown>; sections: WsSection[] }

const SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const normHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
/** split a table line on unescaped pipes; `\|` is a literal pipe */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
/** the section name of a heading: the first token, lower-cased ('## rates (per-unit)' → 'rates') */
export const sectionName = (heading: string): string => heading.trim().split(/[\s(（—:：]/)[0].toLowerCase();

export function parseWorksheetMarkdown(text: string): WsDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let front: Record<string, unknown> = {};
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    if (end < 0) throw new WorksheetError('front matter is not closed with ---', 1);
    let y: unknown;
    try { y = YAML.parse(lines.slice(1, end).join('\n')); } catch (e) { throw new WorksheetError(`front matter is not valid YAML: ${(e as Error).message}`, 2); }
    if (y === null || y === undefined) y = {};
    if (typeof y !== 'object' || Array.isArray(y)) throw new WorksheetError('front matter must be a mapping', 2);
    front = y as Record<string, unknown>;
    i = end + 1;
  } else throw new WorksheetError('a worksheet starts with a --- front matter block', 1);
  const sections: WsSection[] = [];
  let cur: WsSection | null = null;
  const ensure = (ln: number) => { if (!cur) throw new WorksheetError('content before the first "## section" heading', ln); return cur; };
  while (i < lines.length) {
    const raw = lines[i], ln = i + 1, t = raw.trim();
    if (/^#\s/.test(t)) { i++; continue; } // a document title is allowed and ignored
    if (/^##\s+/.test(t)) {
      const heading = t.replace(/^##\s+/, '');
      cur = { name: sectionName(heading), heading, line: ln, tables: [], items: [], text: [] };
      sections.push(cur);
      i++; continue;
    }
    if (t.startsWith('|')) {
      const sec = ensure(ln);
      const headers = splitRow(raw).map(normHeader);
      if (headers.some((h) => !h)) throw new WorksheetError('empty table header cell', ln);
      const dup = headers.find((h, k) => headers.indexOf(h) !== k);
      if (dup) throw new WorksheetError(`duplicate table header '${dup}'`, ln);
      if (!SEP.test(lines[i + 1] ?? '')) throw new WorksheetError('table header must be followed by a |---| separator row', ln + 1);
      const sepCells = splitRow(lines[i + 1]).length;
      if (sepCells !== headers.length) throw new WorksheetError(`separator has ${sepCells} columns, header has ${headers.length}`, ln + 1);
      const rows: Record<string, string>[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        const cells = splitRow(lines[j]);
        if (cells.length !== headers.length) throw new WorksheetError(`row has ${cells.length} cells, table has ${headers.length} columns`, j + 1);
        rows.push(Object.fromEntries(headers.map((h, k) => [h, cells[k]])));
        j++;
      }
      sec.tables.push({ headers, rows, line: ln });
      i = j; continue;
    }
    if (/^[-*]\s+/.test(t)) { ensure(ln).items.push(t.replace(/^[-*]\s+/, '')); i++; continue; }
    if (t) ensure(ln).text.push(t);
    i++;
  }
  return { front, sections };
}

export const section = (doc: WsDoc, name: string): WsSection | undefined => doc.sections.find((s) => s.name === name);
export function requireSection(doc: WsDoc, name: string): WsSection {
  const s = section(doc, name);
  if (!s) throw new WorksheetError(`missing section "## ${name}"`);
  return s;
}
/**
 * the first table of a section checked against the profile: every required header present, no header outside required + optional
 * (headers compared lower-cased)
 */
export function table(sec: WsSection, required: readonly string[], optional: readonly string[] = []): WsTable {
  const t = sec.tables[0];
  if (!t) throw new WorksheetError(`section "## ${sec.name}" has no table`, sec.line);
  const req = required.map(normHeader), opt = optional.map(normHeader);
  for (const h of req) if (!t.headers.includes(h)) throw new WorksheetError(`table in "## ${sec.name}" lacks the column '${h}' (columns: ${t.headers.join(', ')})`, t.line);
  for (const h of t.headers) if (!req.includes(h) && !opt.includes(h)) throw new WorksheetError(`table in "## ${sec.name}" has an unknown column '${h}' (allowed: ${[...req, ...opt].join(', ')})`, t.line);
  return t;
}
/** a section's table when the section exists, else null */
export const optionalTable = (doc: WsDoc, name: string, required: readonly string[], optional: readonly string[] = []): WsTable | null => { const s = section(doc, name); return s && s.tables.length ? table(s, required, optional) : null; };

export const cell = (row: Record<string, string>, name: string): string => (row[normHeader(name)] ?? '').trim();
export function reqCell(row: Record<string, string>, name: string, where: string): string {
  const v = cell(row, name);
  if (!v) throw new WorksheetError(`${where}: column '${name}' is empty`);
  return v;
}
/** a number as written: thousands separators and underscores allowed */
export function parseNum(s: string): number | null {
  const t = s.normalize('NFKC').trim().replace(/[,\s_，]/g, '');
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
export function numCell(row: Record<string, string>, name: string, where: string): number {
  const s = reqCell(row, name, where), v = parseNum(s);
  if (v === null) throw new WorksheetError(`${where}: column '${name}' is not a number ('${s}')`);
  return v;
}
export function optNumCell(row: Record<string, string>, name: string, where: string): number | undefined {
  const s = cell(row, name);
  if (!s) return undefined;
  const v = parseNum(s);
  if (v === null) throw new WorksheetError(`${where}: column '${name}' is not a number ('${s}')`);
  return v;
}
export function enumCell<T extends string>(row: Record<string, string>, name: string, values: readonly T[], where: string, optional = false): T | undefined {
  const s = cell(row, name);
  if (!s) { if (optional) return undefined; throw new WorksheetError(`${where}: column '${name}' is empty (one of ${values.join(', ')})`); }
  if (!(values as readonly string[]).includes(s)) throw new WorksheetError(`${where}: column '${name}' = '${s}' is not one of ${values.join(', ')}`);
  return s as T;
}
/** { source, confidence, note? } of a row when a source or a confidence is given */
export function provCell(row: Record<string, string>, confidences: readonly string[], where: string): { source: string; confidence: string; note?: string } | undefined {
  const source = cell(row, 'source'), confidence = cell(row, 'confidence'), note = cell(row, 'note');
  if (!source && !confidence) return undefined;
  if (!source) throw new WorksheetError(`${where}: a confidence needs a source`);
  if (!confidence) throw new WorksheetError(`${where}: a source needs a confidence (one of ${confidences.join(', ')})`);
  if (!confidences.includes(confidence)) throw new WorksheetError(`${where}: confidence '${confidence}' is not one of ${confidences.join(', ')}`);
  return { source, confidence, ...(note ? { note } : {}) };
}

/* ---------------- writer ---------------- */
export type WsCellValue = string | number | boolean | null | undefined;
export interface WsOutTable { headers: string[]; rows: WsCellValue[][] }
export interface WsOutSection { name: string; title?: string; tables?: WsOutTable[]; items?: string[]; text?: string[] }

const fmtCell = (v: WsCellValue): string => (v === undefined || v === null ? '' : typeof v === 'number' ? String(v) : String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|'));
/** a pipe table with padded columns (CJK width ignored: alignment is cosmetic, parsing does not depend on it) */
export function formatTable(t: WsOutTable): string {
  const rows = t.rows.map((r) => r.map(fmtCell));
  const w = t.headers.map((h, j) => Math.max(h.length, 3, ...rows.map((r) => (r[j] ?? '').length)));
  const line = (cells: string[]) => `| ${cells.map((c, j) => (c ?? '').padEnd(w[j])).join(' | ')} |`;
  return [line(t.headers), `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`, ...rows.map(line)].join('\n');
}
export function writeWorksheetMarkdown(front: Record<string, unknown>, sections: WsOutSection[], title?: string): string {
  const fm = YAML.stringify(front, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' }).trimEnd();
  const out: string[] = ['---', fm, '---', ''];
  if (title) out.push(`# ${title}`, '');
  for (const s of sections) {
    out.push(`## ${s.name}${s.title ? ` — ${s.title}` : ''}`, '');
    for (const t of s.text ?? []) out.push(t, '');
    for (const t of s.tables ?? []) out.push(formatTable(t), '');
    for (const it of s.items ?? []) out.push(`- ${it}`);
    if (s.items?.length) out.push('');
  }
  return out.join('\n');
}
