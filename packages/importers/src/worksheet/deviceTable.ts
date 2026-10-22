/**
 * Device table from a spreadsheet (PLAN_V6 §4, the deterministic path for tabular FIT sources): a sheet with one row per device and
 * columns for the part name, the failure rate, its unit, the source and how it was obtained → DeviceFitTable. Columns are given
 * explicitly (`columns`) or guessed from a zh / en header lexicon; the unit may be a column or implied by the rate column's header
 * ("FIT", "MTBF (h)", "AFR"). Nothing is converted here: values stay as written, the normaliser converts with its formulas.
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
const UNIT_FROM_HEADER: [RegExp, DeviceRateUnit][] = [[/\bfit\b/i, 'FIT'], [/mtbf|mttf|平均无故障|小时/i, 'mtbf_h'], [/afr|annual|年化|年失效/i, 'afr'], [/10\^?6|per million|百万/i, 'per_1e6_h'], [/per\s*h(our)?\b|\/h\b|每小时/i, 'per_h']];
const UNIT_TEXT: [RegExp, DeviceRateUnit][] = [[/^fit$/i, 'FIT'], [/^(per_1e6_h|\/10\^?6\s*h|per\s*10\^?6\s*h|1e-6\/h|ppm\/h|fpmh)$/i, 'per_1e6_h'], [/^(per_h|\/h|1\/h|per hour|h-1)$/i, 'per_h'], [/^(mtbf_h|mtbf|h|hours|小时)$/i, 'mtbf_h'], [/^(afr|%\/year|per year|年化|\/yr)$/i, 'afr']];
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
  const headerUnit = UNIT_FROM_HEADER.find(([re]) => re.test(guess.headers[columns.value!]))?.[1];
  const rows: DeviceFitTable['rows'] = [];
  const skipped: { row: number; reason: string }[] = [];
  for (let r = guess.headerRow + 1; r < g.length; r++) {
    const row = g[r];
    const device = cellText(row[columns.device]);
    const rawV = row[columns.value];
    if (!device && (rawV === null || rawV === '')) continue;
    if (!device) { skipped.push({ row: r + 1, reason: 'no device name' }); continue; }
    const value = typeof rawV === 'number' ? rawV : Number(cellText(rawV).replace(/[,\s]/g, ''));
    if (!Number.isFinite(value)) { skipped.push({ row: r + 1, reason: `rate '${cellText(rawV)}' is not a number` }); continue; }
    let unit: DeviceRateUnit | undefined = o.unit ?? headerUnit;
    if (columns.unit !== undefined) { const u = cellText(row[columns.unit]); const m = UNIT_TEXT.find(([re]) => re.test(u)); if (u && !m && !(DEVICE_RATE_UNITS as readonly string[]).includes(u)) { skipped.push({ row: r + 1, reason: `unit '${u}' not recognised` }); continue; } unit = (m?.[1] ?? (u as DeviceRateUnit)) || unit; }
    if (!unit) { skipped.push({ row: r + 1, reason: 'no unit (give --unit or a unit column)' }); continue; }
    let sourceType: SourceType | undefined = o.sourceType;
    if (columns.sourceType !== undefined) { const t = cellText(row[columns.sourceType]); const m = SOURCE_TYPE_TEXT.find(([re]) => re.test(t)); sourceType = (SOURCE_TYPES as readonly string[]).includes(t) ? (t as SourceType) : m?.[1] ?? sourceType; }
    if (!sourceType) { skipped.push({ row: r + 1, reason: 'no source type (give --source-type or a column)' }); continue; }
    const source = (columns.source !== undefined && cellText(row[columns.source])) || o.rowSource || `${sheet.name}!row ${r + 1}`;
    const loc = columns.loc !== undefined ? cellText(row[columns.loc]) : `${sheet.name}!R${r + 1}`;
    const note = columns.note !== undefined ? cellText(row[columns.note]) : '';
    rows.push({ device, value, unit, source, loc, sourceType, ...(note ? { note } : {}) });
  }
  const table = parseDeviceFitTable({ id: o.id, ...(o.source ? { source: o.source } : {}), rows });
  return { table, headerRow: guess.headerRow, columns, skipped };
}
