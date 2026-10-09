/** Read a workbook (xlsx / xls / csv) into a flat cell list with formulas, merges and outline levels. */
import * as XLSX from 'xlsx';
import type { CellInfo, SheetInfo, WorkbookInfo } from './types.js';

export function readWorkbook(data: ArrayBuffer | Uint8Array, fileName = 'workbook.xlsx'): WorkbookInfo {
  // sheetStubs keeps formula cells saved without a cached value (type 'z'); cellStyles exposes row outline levels
  const wb = XLSX.read(data, { type: 'array', cellFormula: true, cellNF: true, cellDates: false, sheetStubs: true, cellStyles: true });
  return fromSheetJs(wb, fileName);
}

export function fromSheetJs(wb: XLSX.WorkBook, fileName: string): WorkbookInfo {
  const sheets: SheetInfo[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'];
    const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
    const cells: CellInfo[] = [];
    for (const key of Object.keys(ws)) {
      if (key.startsWith('!')) continue;
      const cell = ws[key] as XLSX.CellObject & { f?: string; z?: string };
      const { r, c } = XLSX.utils.decode_cell(key);
      let value: CellInfo['value'] = null;
      if (cell.t === 'z') {
        if (!cell.f) continue; // empty stub
        value = null; // formula without a cached value
      } else if (cell.t === 'n' || cell.t === 'b' || cell.t === 's') value = (cell.v as number | string | boolean | undefined) ?? null;
      else if (cell.t === 'd' && cell.v instanceof Date) value = cell.v.toISOString();
      else if (cell.v !== undefined && cell.v !== null) value = String(cell.v);
      const info: CellInfo = { sheet: name, addr: key, row: r, col: c, value };
      if (cell.f) info.formula = String(cell.f);
      if (cell.z) info.format = String(cell.z);
      cells.push(info);
    }
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    const merges = (ws['!merges'] ?? []).map((m) => ({ r0: m.s.r, c0: m.s.c, r1: m.e.r, c1: m.e.c }));
    const rowsMeta = (ws['!rows'] ?? []) as ({ level?: number } | undefined)[];
    const outline: number[] = [];
    for (let r = 0; r <= range.e.r; r++) outline.push(rowsMeta[r]?.level ?? 0);
    return { name, rows: range.e.r + 1, cols: range.e.c + 1, cells, merges, outline };
  });
  return { fileName, sheets };
}

export function cellAt(sheet: SheetInfo, row: number, col: number): CellInfo | undefined {
  return sheet.cells.find((c) => c.row === row && c.col === col);
}

export function rowCells(sheet: SheetInfo, row: number): CellInfo[] {
  return sheet.cells.filter((c) => c.row === row);
}

export function colLetter(col: number): string {
  return XLSX.utils.encode_col(col);
}

export function addrOf(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

export function decodeAddr(addr: string): { row: number; col: number } {
  const { r, c } = XLSX.utils.decode_cell(addr.replace(/\$/g, ''));
  return { row: r, col: c };
}
