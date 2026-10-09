/** Sheet-level method report: header detection, column roles (zh/en lexicon) and formula fingerprints. */
import { fingerprintFormula, extractRefs, METHOD_DESCRIPTIONS } from './formula.js';
import { decodeAddr } from './workbook.js';
import type { ColumnGuess, ColumnRole, MethodHit, MethodReport, MethodTag, SheetInfo, SheetMethodReport, WorkbookInfo } from './types.js';

interface LexEntry {
  role: ColumnRole;
  /** lowercase substrings; a header matches when any is contained */
  any: string[];
  /** substrings that veto the match */
  not?: string[];
  weight: number;
}

const LEXICON: LexEntry[] = [
  { role: 'mttr_auto_h', any: ['mttr自动', 'mttr_auto', 't_auto', 'auto mttr', '自动恢复时间', '自动修复时间', 'mttr (auto', 'mttr(auto'], weight: 1 },
  { role: 'mttr_manual_h', any: ['mttr人工', 'mttr_manual', 't_manual', 'manual mttr', '人工修复时间', '人工恢复时间', 'mttr (manual', 'mttr(manual'], weight: 1 },
  { role: 'mttr_effective_h', any: ['mttr有效', '有效mttr', 'effective mttr', 'mttr_eff', 'mttr (eff', '等效mttr', '综合mttr'], weight: 1 },
  { role: 'auto_fraction', any: ['自动恢复比例', '自动比例', '自愈率', 'auto fraction', 'p_auto', 'coverage', '自动恢复率', '自动化比例'], weight: 1 },
  { role: 'switchover_success', any: ['倒换成功率', '切换成功率', 'switchover', 'failover', '倒换'], weight: 1 },
  { role: 'group_availability', any: ['组可用度', '组可用性', 'group availability', '冗余后可用度', '子系统可用度'], weight: 1 },
  { role: 'availability_pct', any: ['可用度(%)', '可用度（%）', '可用性(%)', 'availability (%)', 'availability(%)', '可用度 %'], weight: 1 },
  { role: 'unavailability', any: ['不可用度', '不可用性', 'unavailability', '不可用'], weight: 1 },
  { role: 'availability', any: ['可用度', '可用性', 'availability', '单机可用度', '单元可用度'], not: ['不可用'], weight: 0.9 },
  { role: 'mtbf_h', any: ['mtbf', '平均故障间隔', '平均无故障', 'mttf'], weight: 1 },
  { role: 'mttr_h', any: ['mttr', '修复时间', '恢复时间', 'repair time', 'recovery time'], not: ['自动', '人工', '有效', 'auto', 'manual', 'eff'], weight: 0.9 },
  { role: 'fit', any: ['fit'], not: ['profit'], weight: 1 },
  { role: 'afr_pct', any: ['afr', '年失效率', '%/yr', '%/year', 'annual failure'], weight: 1 },
  { role: 'lambda_per_h', any: ['失效率', 'λ', 'lambda', 'failure rate', '故障率', '/h'], not: ['fit', 'afr', '年'], weight: 0.9 },
  { role: 'level', any: ['层级', '层次', 'level', 'tier'], weight: 1 },
  { role: 'count', any: ['数量', 'qty', 'quantity', 'count', '个数', 'units'], weight: 1 },
  { role: 'redundancy', any: ['冗余', 'redundancy', 'k/n', 'k-of-n', 'config'], weight: 1 },
  { role: 'notes', any: ['备注', 'notes', 'note', 'remark', 'comment', '说明'], weight: 0.8 },
  { role: 'name', any: ['名称', '部件', '组件', '模块', 'component', 'name', 'item', '设备', '对象', 'element', 'subsystem'], weight: 0.8 },
];

export function guessRole(header: string): { role: ColumnRole | null; confidence: number } {
  const h = header.trim().toLowerCase();
  if (!h) return { role: null, confidence: 0 };
  if (h === 'n' || h === 'qty') return { role: 'count', confidence: 0.9 };
  if (h === 'a' || h === 'a_i') return { role: 'availability', confidence: 0.6 };
  if (h === 'u' || h === 'u_i') return { role: 'unavailability', confidence: 0.6 };
  if (h === 'λ' || h === 'lambda') return { role: 'lambda_per_h', confidence: 0.9 };
  for (const e of LEXICON) {
    if (e.not && e.not.some((n) => h.includes(n))) continue;
    if (e.any.some((a) => h.includes(a))) return { role: e.role, confidence: e.weight };
  }
  return { role: null, confidence: 0 };
}

/** First row with ≥ 2 text cells followed by a row holding a number: the header. */
export function guessHeaderRow(sheet: SheetInfo): number | null {
  const byRow = new Map<number, typeof sheet.cells>();
  for (const c of sheet.cells) {
    if (!byRow.has(c.row)) byRow.set(c.row, []);
    byRow.get(c.row)!.push(c);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  for (const r of rows) {
    const cells = byRow.get(r)!;
    const texts = cells.filter((c) => typeof c.value === 'string' && c.value.trim() !== '' && !c.formula);
    if (texts.length < 2) continue;
    const roles = texts.map((c) => guessRole(String(c.value)).role).filter(Boolean);
    const next = byRow.get(r + 1) ?? [];
    const nextHasNumber = next.some((c) => typeof c.value === 'number' || c.formula);
    if (roles.length >= 2 && nextHasNumber) return r;
  }
  return null;
}

export function guessColumns(sheet: SheetInfo, headerRow: number): ColumnGuess[] {
  const out: ColumnGuess[] = [];
  for (const c of sheet.cells.filter((x) => x.row === headerRow)) {
    const header = c.value === null ? '' : String(c.value);
    const g = guessRole(header);
    out.push({ col: c.col, header, role: g.role, confidence: g.confidence });
  }
  // the first unassigned text column left of the numbers is the name column when none was recognised
  if (!out.some((g) => g.role === 'name') && out.length) {
    const first = out.sort((a, b) => a.col - b.col)[0];
    if (first.role === null) {
      first.role = 'name';
      first.confidence = 0.4;
    }
  }
  return out.sort((a, b) => a.col - b.col);
}

export function sheetMethodReport(sheet: SheetInfo): SheetMethodReport {
  const headerRow = guessHeaderRow(sheet);
  const columns = headerRow === null ? [] : guessColumns(sheet, headerRow);
  const hits: MethodHit[] = sheet.cells.filter((c) => c.formula).map((c) => fingerprintFormula(sheet.name, c.addr, c.formula!));
  // context: a two-factor product is λ·MTTR (unavailability) when its factors sit in rate / MTTR columns or the cell is in an unavailability column
  const roleOfCol = new Map<number, ColumnRole | null>(columns.map((g) => [g.col, g.role]));
  for (const h of hits) {
    if (h.tag !== 'series_product' || !/^\(?R1\*R2\)?$/.test(h.shape)) continue;
    const roles = extractRefs(h.formula).map((r) => roleOfCol.get(decodeAddr(r.addr).col) ?? null);
    const own = roleOfCol.get(decodeAddr(h.addr).col) ?? null;
    const rateLike = roles.some((r) => r === 'lambda_per_h' || r === 'fit');
    const mttrLike = roles.some((r) => r === 'mttr_h' || r === 'mttr_effective_h' || r === 'mttr_manual_h');
    if (own === 'unavailability' || (rateLike && mttrLike)) {
      h.tag = 'unavailability_lambda_mttr';
      h.confidence = 0.85;
    }
  }
  const summary: Partial<Record<MethodTag, number>> = {};
  for (const h of hits) summary[h.tag] = (summary[h.tag] ?? 0) + 1;
  const notes: string[] = [];
  if (summary.series_rare_event_sum && summary.series_product) notes.push('both the exact product and the rare-event sum appear: the sum is optimistic by ≈ Σ_{i<j} U_i U_j');
  else if (summary.series_rare_event_sum) notes.push('series availability uses 1 − ΣU (rare-event approximation); HAC-D uses the exact product');
  if (summary.unavailability_lambda_mttr) notes.push('U = λ·MTTR used (rare-event); exact is λ·MTTR/(1 + λ·MTTR)');
  if (summary.markov_mmult_minverse) notes.push('a Markov steady state is solved in-sheet; HAC-D rebuilds the chain from the λ / μ cells where the structure is recognised');
  if (summary.switchover_weighted) notes.push('switchover success is applied as a static weight c·A_sw + (1 − c)·A_single; HAC-D models the failed switch as a repairable down state (§11)');
  if (summary.mttr_mixture_auto_manual) notes.push('MTTR is mixed as p·T_auto + (1 − p)·T_manual; HAC-D keeps both paths (§10) which is exact for series units and differs inside redundant groups');
  if (summary.percent_to_fraction) notes.push('percent inputs converted with /100');
  if (summary.unknown) notes.push(`${summary.unknown} formula(s) not recognised`);
  return { sheet: sheet.name, headerRow, columns, hits, summary, notes };
}

export function methodReport(wb: WorkbookInfo): MethodReport {
  const sheets = wb.sheets.map(sheetMethodReport);
  const counts = new Map<MethodTag, number>();
  for (const s of sheets) for (const [tag, n] of Object.entries(s.summary)) counts.set(tag as MethodTag, (counts.get(tag as MethodTag) ?? 0) + (n ?? 0));
  const methods = [...counts.entries()]
    .filter(([tag]) => tag !== 'unknown')
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count, description: METHOD_DESCRIPTIONS[tag] }));
  return { fileName: wb.fileName, sheets, methods };
}
