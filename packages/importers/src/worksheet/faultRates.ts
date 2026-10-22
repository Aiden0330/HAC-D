/**
 * Fault-rate worksheets (PLAN_V6 §5.2): `fault-rates` ↔ FaultRateOverride (one row per catalog class), `device-fit` → the device
 * table of the normaliser (one row per part as the internal source states it) and `koujing-mapping` → the reviewed mapping table
 * (one row per device × class). The two latter are the inputs of `normalizeFaultRates`; the first is its output and the record the
 * engine applies.
 */
import {
  parseFaultRateOverride, parseDeviceFitTable, parseKoujingMapping, type FaultRateOverride, type DeviceFitTable, type KoujingMapping,
  CONFIDENCES, UNITS, SOURCE_TYPES, DEVICE_RATE_UNITS, IMPACT_CONFIDENCES, WORKSHEET_VERSION,
} from '@hac-d/core';
import { requireSection, optionalTable, table, cell, reqCell, numCell, enumCell, writeWorksheetMarkdown, type WsDoc, type WsOutSection, type WsCellValue } from './markdown.js';
import { checkWorksheet } from './topology.js';

const RATE_COLS = ['class', 'fit', 'source', 'confidence'], RATE_OPT = ['unit', 'derivation', 'note'];
const DEVICE_COLS = ['device', 'value', 'unit', 'source', 'sourcetype'], DEVICE_OPT = ['loc', 'note'];
const MAP_COLS = ['device', 'unit', 'class', 'devicesperunit', 'impactfactor', 'impactbasis', 'impactconfidence'], MAP_OPT = ['note'];
const pick = (f: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));

export function worksheetToFaultRateOverride(doc: WsDoc): FaultRateOverride {
  const f = doc.front;
  checkWorksheet(f, 'fault-rates');
  const t = table(requireSection(doc, 'rates'), RATE_COLS, RATE_OPT);
  const rates: Record<string, unknown> = {};
  for (const row of t.rows) {
    const cls = reqCell(row, 'class', 'rates row'), where = `class '${cls}'`;
    const unit = enumCell(row, 'unit', UNITS, where, true), derivation = cell(row, 'derivation'), note = cell(row, 'note');
    rates[cls] = { ...(unit ? { unit } : {}), fit: numCell(row, 'fit', where), source: reqCell(row, 'source', where), confidence: enumCell(row, 'confidence', CONFIDENCES, where), ...(derivation ? { derivation } : {}), ...(note ? { note } : {}) };
  }
  const at = optionalTable(doc, 'analogues', ['class', 'takes']);
  const analogues = at ? Object.fromEntries(at.rows.map((row) => [reqCell(row, 'class', 'analogues row'), reqCell(row, 'takes', 'analogues row')])) : undefined;
  return parseFaultRateOverride({ ...pick(f, ['id', 'basis', 'source', 'catalog']), rates, ...(analogues && Object.keys(analogues).length ? { analogues } : {}) });
}

export function faultRateOverrideToWorksheet(o: FaultRateOverride, title?: string): string {
  const front = { worksheet: 'fault-rates', version: WORKSHEET_VERSION, id: o.id, basis: o.basis, ...(o.source ? { source: o.source } : {}), ...(o.catalog ? { catalog: o.catalog } : {}) };
  const rows: WsCellValue[][] = Object.entries(o.rates).map(([cls, e]) => [cls, e.unit, e.fit, e.source, e.confidence, e.derivation, e.note]);
  const sections: WsOutSection[] = [{ name: 'rates', title: `business-impact FIT per ${o.basis === 'per-card' ? 'card' : 'unit'}-hour by catalog class`, tables: [{ headers: ['class', 'unit', 'fit', 'source', 'confidence', 'derivation', 'note'], rows }] }];
  if (o.analogues && Object.keys(o.analogues).length) sections.push({ name: 'analogues', title: 'class → class whose value it takes', tables: [{ headers: ['class', 'takes'], rows: Object.entries(o.analogues) }] });
  return writeWorksheetMarkdown(front, sections, title ?? `Fault-rate worksheet — ${o.id}`);
}

export function worksheetToDeviceTable(doc: WsDoc): DeviceFitTable {
  const f = doc.front;
  checkWorksheet(f, 'device-fit');
  const t = table(requireSection(doc, 'devices'), DEVICE_COLS, DEVICE_OPT);
  const rows = t.rows.map((row) => {
    const device = reqCell(row, 'device', 'devices row'), where = `device '${device}'`, loc = cell(row, 'loc'), note = cell(row, 'note');
    return { device, value: numCell(row, 'value', where), unit: enumCell(row, 'unit', DEVICE_RATE_UNITS, where), source: reqCell(row, 'source', where), ...(loc ? { loc } : {}), sourceType: enumCell(row, 'sourceType', SOURCE_TYPES, where), ...(note ? { note } : {}) };
  });
  return parseDeviceFitTable({ ...pick(f, ['id', 'source', 'catalog']), rows });
}
export function deviceTableToWorksheet(t: DeviceFitTable, title?: string): string {
  const front = { worksheet: 'device-fit', version: WORKSHEET_VERSION, id: t.id, ...(t.source ? { source: t.source } : {}), ...(t.catalog ? { catalog: t.catalog } : {}) };
  const rows: WsCellValue[][] = t.rows.map((r) => [r.device, r.value, r.unit, r.source, r.loc, r.sourceType, r.note]);
  return writeWorksheetMarkdown(front, [{ name: 'devices', title: 'device failure rates as the source states them', tables: [{ headers: ['device', 'value', 'unit', 'source', 'loc', 'sourceType', 'note'], rows }] }], title ?? `Device table — ${t.id}`);
}

export function worksheetToMapping(doc: WsDoc): KoujingMapping {
  const f = doc.front;
  checkWorksheet(f, 'koujing-mapping');
  const t = table(requireSection(doc, 'mapping'), MAP_COLS, MAP_OPT);
  const rows = t.rows.map((row) => {
    const device = reqCell(row, 'device', 'mapping row'), cls = reqCell(row, 'class', `device '${device}'`), where = `mapping (${device}, ${cls})`, note = cell(row, 'note');
    return { device, unit: enumCell(row, 'unit', UNITS, where), class: cls, devicesPerUnit: numCell(row, 'devicesPerUnit', where), impactFactor: numCell(row, 'impactFactor', where), impactBasis: reqCell(row, 'impactBasis', where), impactConfidence: enumCell(row, 'impactConfidence', IMPACT_CONFIDENCES, where), ...(note ? { note } : {}) };
  });
  return parseKoujingMapping({ ...pick(f, ['id', 'source']), ...(f.mappingVersion !== undefined ? { version: String(f.mappingVersion) } : {}), rows });
}
export function mappingToWorksheet(m: KoujingMapping, title?: string): string {
  const front = { worksheet: 'koujing-mapping', version: WORKSHEET_VERSION, id: m.id, ...(m.version ? { mappingVersion: m.version } : {}), ...(m.source ? { source: m.source } : {}) };
  const rows: WsCellValue[][] = m.rows.map((r) => [r.device, r.unit, r.class, r.devicesPerUnit, r.impactFactor, r.impactBasis, r.impactConfidence, r.note]);
  return writeWorksheetMarkdown(front, [{ name: 'mapping', title: 'device → fault unit, class, devices per unit, impact factor (reviewed)', tables: [{ headers: ['device', 'unit', 'class', 'devicesPerUnit', 'impactFactor', 'impactBasis', 'impactConfidence', 'note'], rows }] }], title ?? `口径 mapping — ${m.id}`);
}
