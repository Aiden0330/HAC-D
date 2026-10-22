/**
 * v6 worksheets (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5): the constrained Markdown profile and its converters to and from the
 * v5 input records, the normaliser's tables and mechanism proposals. `parseWorksheet` dispatches on the front matter's `worksheet`.
 */
import type { MechanismSet, TopologyRecord, FaultRateOverride, DeviceFitTable, KoujingMapping, MechanismProposal, WorksheetKind } from '@hac-d/core';
import { WORKSHEET_KINDS } from '@hac-d/core';
import { parseWorksheetMarkdown, WorksheetError, type WsDoc } from './markdown.js';
import { worksheetToTopologyRecord } from './topology.js';
import { worksheetToFaultRateOverride, worksheetToDeviceTable, worksheetToMapping } from './faultRates.js';
import { worksheetToMechanismSet, worksheetToProposal } from './mechanisms.js';

export * from './markdown.js';
export * from './topology.js';
export * from './faultRates.js';
export * from './mechanisms.js';
export * from './deviceTable.js';
export * from './templates.js';

export type ParsedWorksheet =
  | { kind: 'topology'; doc: WsDoc; value: TopologyRecord }
  | { kind: 'fault-rates'; doc: WsDoc; value: FaultRateOverride }
  | { kind: 'mechanisms'; doc: WsDoc; value: MechanismSet }
  | { kind: 'mechanism-proposal'; doc: WsDoc; value: MechanismProposal }
  | { kind: 'device-fit'; doc: WsDoc; value: DeviceFitTable }
  | { kind: 'koujing-mapping'; doc: WsDoc; value: KoujingMapping };

/** the kind a worksheet text declares, before parsing it */
export function worksheetKind(text: string): WorksheetKind {
  const k = parseWorksheetMarkdown(text).front.worksheet;
  if (typeof k !== 'string' || !(WORKSHEET_KINDS as readonly string[]).includes(k)) throw new WorksheetError(`front matter 'worksheet' must be one of ${WORKSHEET_KINDS.join(', ')} (got '${String(k)}')`);
  return k as WorksheetKind;
}

/** parse any worksheet; a mechanisms delta needs its base set */
export function parseWorksheet(text: string, opts: { baseSet?: MechanismSet } = {}): ParsedWorksheet {
  const doc = parseWorksheetMarkdown(text);
  const kind = doc.front.worksheet;
  switch (kind) {
    case 'topology': return { kind, doc, value: worksheetToTopologyRecord(doc) };
    case 'fault-rates': return { kind, doc, value: worksheetToFaultRateOverride(doc) };
    case 'mechanisms': return { kind, doc, value: worksheetToMechanismSet(doc, opts.baseSet) };
    case 'mechanism-proposal': return { kind, doc, value: worksheetToProposal(doc) };
    case 'device-fit': return { kind, doc, value: worksheetToDeviceTable(doc) };
    case 'koujing-mapping': return { kind, doc, value: worksheetToMapping(doc) };
    default: throw new WorksheetError(`front matter 'worksheet' must be one of ${WORKSHEET_KINDS.join(', ')} (got '${String(kind)}')`);
  }
}
