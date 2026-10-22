export * from './types.js';
export { readWorkbook, fromSheetJs, colLetter, addrOf, decodeAddr } from './workbook.js';
export { normalizeFormula, extractRefs, shapeOf, fingerprintFormula, METHOD_DESCRIPTIONS } from './formula.js';
export { guessRole, guessHeaderRow, guessColumns, sheetMethodReport, methodReport } from './fingerprint.js';
export { extractTopology, flattenDraft, parseLevel, parseRedundancy, type ExtractOptions } from './topology.js';
export { draftToScenario, type DraftToScenarioOptions, type DraftConversion } from './toScenario.js';
export { reconcile, type ReconcileRow, type Reconciliation } from './reconcile.js';
export { exportWorkbook } from './exportWorkbook.js';

import { readWorkbook } from './workbook.js';
import { methodReport } from './fingerprint.js';
import { extractTopology, type ExtractOptions } from './topology.js';
import { draftToScenario, type DraftToScenarioOptions } from './toScenario.js';
import { reconcile } from './reconcile.js';
import { evaluateScenario } from '@hac-d/core';
import type { MethodHit } from './types.js';

/** One-call import: read → method report → topology draft (first sheet with a header) → scenario → evaluation → reconciliation. */
export function importSpreadsheet(data: ArrayBuffer | Uint8Array, fileName: string, opts: { sheet?: string; extract?: ExtractOptions; scenario?: DraftToScenarioOptions } = {}) {
  const wb = readWorkbook(data, fileName);
  const report = methodReport(wb);
  const sheet = opts.sheet ? wb.sheets.find((s) => s.name === opts.sheet) : wb.sheets.find((s) => report.sheets.find((r) => r.sheet === s.name)?.headerRow !== null) ?? wb.sheets[0];
  if (!sheet) throw new Error('workbook has no sheets');
  const draft = extractTopology(sheet, fileName, opts.extract);
  const conversion = draftToScenario(draft, opts.scenario);
  const result = evaluateScenario(conversion.scenario);
  const hits = new Map<string, MethodHit>();
  for (const h of report.sheets.find((r) => r.sheet === sheet.name)?.hits ?? []) hits.set(h.addr, h);
  const reconciliation = reconcile(draft, result, conversion.blockIds, hits);
  return { workbook: wb, report, sheet: sheet.name, draft, conversion, result, reconciliation };
}
export * from './worksheet/index.js';
