/**
 * Device table from a spreadsheet (PLAN_V6 §4, the deterministic path for tabular FIT sources): a sheet with one row per device and
 * columns for the part name, the failure rate, its unit, the source and how it was obtained → DeviceFitTable. Columns are given
 * explicitly (`columns`) or guessed from a zh / en header lexicon; the unit may be a column or implied by the rate column's header
 * ("FIT", "MTBF (h)", "AFR"). Nothing is converted here: values stay as written, the normaliser converts with its formulas — with
 * two exceptions, both recorded in the row's note with the value as written (fifth review D2, recheck N1 / N2): an annual failure
 * rate written as a percentage (`%/year`, `AFR (%)`, `年化 %`, or a `%` in the value cell) is divided by 100 into the fraction the
 * normaliser's AFR formula expects — a `%` under any other unit refuses the row; and an MTBF stated in a multiple of hours
 * (`百万小时`, `million hours`, `10^6 h`, `万小时`, `kh`) is multiplied into hours. The header rules are tried most-specific first
 * (FIT, MTBF with a multiplier, per 10⁶ h, per hour, AFR, then MTBF), so `失效率（每百万小时）` is a rate per 10⁶ h,
 * `MTBF（百万小时）` an MTBF in millions of hours, and a header that only contains 小时 ("hours") is MTBF.
 */
import { parseDeviceFitTable, type DeviceFitTable, DEVICE_RATE_UNITS, SOURCE_TYPES, type DeviceRateUnit, type SourceType } from '@hac-d/core';
import type { SheetInfo } from '../types.js';

export type DeviceColumn = 'device' | 'value' | 'unit' | 'source' | 'loc' | 'sourceType' | 'note';
export interface DeviceTableOptions {
  id: string;
  source?: string;
  /** column index (0-based) or header text per role; guessed when absent */
  columns?: Partial<Record<DeviceColumn, number | string>>;
  headerRow?: number;
  /** unit of every value when the sheet has no unit column and the rate header does not say */
  unit?: DeviceRateUnit;
  /** source type of every row when the sheet has no such column */
  sourceType?: SourceType;
  /** source text of every row when the sheet has no source column (default: the file / sheet name) */
  rowSource?: string;
}
const LEX: Record<DeviceColumn, string[]> = {
  device: ['device', 'part', 'component', 'item', '器件', '部件', '元件', '物料', '组件', '名称'],
  value: ['fit', 'failure rate', 'rate', 'λ', 'lambda', 'mtbf', 'afr', '失效率', '故障率', '平均无故障', '年化'],
  unit: ['unit', '单位'],
  source: ['source', 'reference', 'origin', '来源', '依据', '出处'],
  loc: ['loc', 'location', 'row', 'ref', '位置', '行'],
  sourceType: ['source type', 'sourcetype', 'type', 'basis', 'kind', '来源类型', '类型', '性质'],
  note: ['note', 'remark', 'comment', '备注', '说明'],
};
/** header → unit (and the factor the stated value is multiplied by: 0.01 for a percentage); most specific first, MTBF last */
const UNIT_FROM_HEADER: [RegExp, DeviceRateUnit, number][] = [
  [/\bfit\b/i, 'FIT', 1],
  [/10\^?6|per million|百万/i, 'per_1e6_h', 1],
  [/per\s*h(our)?\b|\/\s*h\b|每小时|每\s*h\b/i, 'per_h', 1],
  [/(afr|annual|年化|年失效|per year|\/\s*(year|yr))[^%]*%|%[^a-z]*(afr|annual|年化|年失效|per year|\/\s*(year|yr))|%\s*\/\s*(year|yr|a)\b/i, 'afr', 0.01],
  [/afr|annual|年化|年失效|per year|\/\s*(year|yr)\b/i, 'afr', 1],
  [/mtbf|mttf|平均无故障|小时/i, 'mtbf_h', 1],
];
/** an MTBF / MTTF header: with a duration multiplier it is MTBF in that many hours (N2), tried before the rate rules */
const MTBF_WORD = /mtbf|mttf|平均无故障|mean time (between|to) failure/i;
const MTBF_MULTIPLIERS: [RegExp, number][] = [
  [/百万\s*小时|million\s*h(?:ours?|rs?)?|10\^?6\s*h(?:ours?|rs?)?|1e6\s*h(?:ours?|rs?)?|\bmh\b/i, 1e6],
  [/十万\s*小时/i, 1e5],
  [/万\s*小时/i, 1e4],
  [/千\s*小时|thousand\s*h(?:ours?|rs?)?|\bkh\b|10\^?3\s*h(?:ours?|rs?)?/i, 1e3],
];
function unitOfHeader(h: string): [DeviceRateUnit, number] | undefined {
  if (!/\bfit\b/i.test(h) && MTBF_WORD.test(h)) { const m = MTBF_MULTIPLIERS.find(([re]) => re.test(h)); if (m) return ['mtbf_h', m[1]]; }
  const r = UNIT_FROM_HEADER.find(([re]) => re.test(h));
  return r ? [r[1], r[2]] : undefined;
}
/** unit cell → unit (and factor): a rate per 10⁶ h says "per" / "/" / "每"; a bare multiple of hours is a duration (MTBF) */
const UNIT_TEXT: [RegExp, DeviceRateUnit, number][] = [
  [/^fit$/i, 'FIT', 1],
  [/^(per_1e6_h|\/10\^?6\s*h|per\s*10\^?6\s*h|1e-6\/h|ppm\/h|fpmh|\/\s*百万小时|每百万小时|per\s*million\s*h(?:ours?|rs?)?|\/\s*million\s*h(?:ours?|rs?)?)$/i, 'per_1e6_h', 1],
  [/^(per_h|\/h|1\/h|per hour|h-1)$/i, 'per_h', 1],
  [/^(百万小时|million\s*h(?:ours?|rs?)?|mh|10\^?6\s*h(?:ours?|rs?)?|1e6\s*h(?:ours?|rs?)?)$/i, 'mtbf_h', 1e6],
  [/^十万小时$/i, 'mtbf_h', 1e5],
  [/^万小时$/i, 'mtbf_h', 1e4],
  [/^(千小时|thousand\s*h(?:ours?|rs?)?|kh|10\^?3\s*h(?:ours?|rs?)?)$/i, 'mtbf_h', 1e3],
  [/^(mtbf_h|mtbf|h|hours|小时)$/i, 'mtbf_h', 1],
  [/^(%\s*\/\s*(year|yr|a)|%\s*per\s*year|percent\s*per\s*year|afr\s*\(?%\)?|年化\s*%|%\s*年化|%\s*\/\s*年|每年\s*%)$/i, 'afr', 0.01],
  [/^(afr|per year|年化|\/yr|\/year)$/i, 'afr', 1],
];
const SOURCE_TYPE_TEXT: [RegExp, SourceType][] = [[/field|现网|现场|运维|返修|returns/i, 'field'], [/vendor|datasheet|厂商|手册|规格/i, 'vendor'], [/predict|handbook|217|telcordia|预计|预测|计算/i, 'prediction'], [/paper|论文|文献/i, 'paper'], [/assum|假设|估/i, 'assumed']];

const cellText = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const grid = (s: SheetInfo): (string | number | boolean | null)[][] => { const g: (string | number | boolean | null)[][] = Array.from({ length: s.rows }, () => Array<string | number | boolean | null>(s.cols).fill(null)); for (const c of s.cells) if (c.row < s.rows && c.col < s.cols) g[c.row][c.col] = c.value; return g; };
const hits = (h: string, role: DeviceColumn) => LEX[role].filter((w) => h.toLowerCase().includes(w.toLowerCase())).length;

/** guess the header row (the first row with ≥ 2 lexicon hits) and the column of every role */
export function guessDeviceColumns(sheet: SheetInfo, headerRow?: number): { headerRow: number; columns: Partial<Record<DeviceColumn, number>>; headers: string[] } {
  const g = grid(sheet);
  let hr = headerRow;
  if (hr === undefined) {
    for (let r = 0; r < Math.min(g.length, 30); r++) { const n = g[r].filter((v) => typeof v === 'string' && (Object.keys(LEX) as DeviceColumn[]).some((role) => hits(v, role) > 0)).length; if (n >= 2) { hr = r; break; } }
    if (hr === undefined) throw new Error(`sheet '${sheet.name}': no header row found (a row with device and rate columns)`);
  }
  const headers = g[hr].map(cellText);
  const columns: Partial<Record<DeviceColumn, number>> = {};
  const taken = new Set<number>();
  for (const role of ['device', 'value', 'unit', 'sourceType', 'source', 'loc', 'note'] as DeviceColumn[]) {
    let best = -1, bestHits = 0;
    headers.forEach((h, j) => { if (taken.has(j)) return; const n = hits(h, role); if (n > bestHits) { best = j; bestHits = n; } });
    if (best >= 0) { columns[role] = best; taken.add(best); }
  }
  return { headerRow: hr, columns, headers };
}

/** the device table of a sheet */
export function deviceTableFromSheet(sheet: SheetInfo, o: DeviceTableOptions): { table: DeviceFitTable; headerRow: number; columns: Partial<Record<DeviceColumn, number>>; skipped: { row: number; reason: string }[] } {
  const g = grid(sheet);
  const guess = guessDeviceColumns(sheet, o.headerRow);
  const columns: Partial<Record<DeviceColumn, number>> = { ...guess.columns };
  for (const [role, spec] of Object.entries(o.columns ?? {}) as [DeviceColumn, number | string][]) {
    if (typeof spec === 'number') columns[role] = spec;
    else { const j = guess.headers.findIndex((h) => h.toLowerCase() === spec.toLowerCase()); if (j < 0) throw new Error(`sheet '${sheet.name}': no column headed '${spec}' (headers: ${guess.headers.filter(Boolean).join(', ')})`); columns[role] = j; }
  }
  if (columns.device === undefined || columns.value === undefined) throw new Error(`sheet '${sheet.name}': the device and rate columns are needed (found: ${JSON.stringify(columns)}; headers: ${guess.headers.filter(Boolean).join(', ')})`);
  const header = unitOfHeader(guess.headers[columns.value!]);
  const headerUnit = header?.[0], headerScale = header?.[1] ?? 1;
  const rows: DeviceFitTable['rows'] = [];
  const skipped: { row: number; reason: string }[] = [];
  for (let r = guess.headerRow + 1; r < g.length; r++) {
    const row = g[r];
    const device = cellText(row[columns.device]);
    const rawV = row[columns.value];
    if (!device && (rawV === null || rawV === '')) continue;
    if (!device) { skipped.push({ row: r + 1, reason: 'no device name' }); continue; }
    const text = cellText(rawV);
    // a `%` in the value cell is the percent marker (recheck N1): an AFR is divided by 100, any other unit refuses the row
    const pct = typeof rawV !== 'number' && /%/.test(text);
    const stated = typeof rawV === 'number' ? rawV : Number(text.replace(/[,\s%]/g, ''));
    if (!Number.isFinite(stated)) { skipped.push({ row: r + 1, reason: `rate '${text}' is not a number` }); continue; }
    let unit: DeviceRateUnit | undefined = o.unit ?? headerUnit;
    let scale = o.unit ? 1 : headerScale;
    let unitText = '';
    if (columns.unit !== undefined) {
      const u = cellText(row[columns.unit]);
      const m = UNIT_TEXT.find(([re]) => re.test(u));
      if (u && !m && !(DEVICE_RATE_UNITS as readonly string[]).includes(u)) { skipped.push({ row: r + 1, reason: `unit '${u}' not recognised` }); continue; }
      if (u) { unit = m?.[1] ?? (u as DeviceRateUnit); scale = m?.[2] ?? 1; unitText = u; }
    }
    if (!unit) { skipped.push({ row: r + 1, reason: 'no unit (give --unit or a unit column)' }); continue; }
    if (pct) {
      if (unit !== 'afr') { skipped.push({ row: r + 1, reason: `a percentage ('${text}') is not a ${unit} value (FIT, per 10⁶ h, per hour or MTBF hours)` }); continue; }
      scale = 0.01;
    }
    const value = stated * scale;
    let sourceType: SourceType | undefined = o.sourceType;
    if (columns.sourceType !== undefined) { const t = cellText(row[columns.sourceType]); const m = SOURCE_TYPE_TEXT.find(([re]) => re.test(t)); sourceType = (SOURCE_TYPES as readonly string[]).includes(t) ? (t as SourceType) : m?.[1] ?? sourceType; }
    if (!sourceType) { skipped.push({ row: r + 1, reason: 'no source type (give --source-type or a column)' }); continue; }
    const source = (columns.source !== undefined && cellText(row[columns.source])) || o.rowSource || `${sheet.name}!row ${r + 1}`;
    const loc = columns.loc !== undefined ? cellText(row[columns.loc]) : `${sheet.name}!R${r + 1}`;
    const given = columns.note !== undefined ? cellText(row[columns.note]) : '';
    // a percentage or a multiple of hours is recorded as written: the value stays traceable to the sheet
    const conv = scale !== 1 ? `${pct ? text : `${stated} ${unitText || guess.headers[columns.value!]}`} read as ${unit} ${value}` : '';
    const note = [given, conv].filter(Boolean).join('; ');
    rows.push({ device, value, unit, source, loc, sourceType, ...(note ? { note } : {}) });
  }
  if (!rows.length) throw new Error(`sheet '${sheet.name}': no usable device rows${skipped.length ? ` (skipped: ${skipped.map((x) => `row ${x.row}: ${x.reason}`).join('; ')})` : ''}`);
  const table = parseDeviceFitTable({ id: o.id, ...(o.source ? { source: o.source } : {}), rows });
  return { table, headerRow: guess.headerRow, columns, skipped };
}
