/**
 * Topology worksheet ↔ TopologyRecord (PLAN_V6 §5.2). Front matter: id, name, short, family, template, scenarioId, scenarioName?,
 * faultUnits?, schematic?. Tables: geometry (field | value | source | confidence | note; `base` names the SuperPoD preset, other rows
 * override it, `domainNpus` is accepted here too), scale-out, variants, layers, counts (count overrides), assumed (zh | en) and a
 * provenance table for entries the row columns cannot place (group keys such as `scaleOut`). Row provenance goes to
 * `superpod.<field>` / `scaleOut.<field>` / `countOverrides.<row>`; the `base` row's provenance is the record's `superpod` entry.
 * A blank value cell means "not stated" and the row is skipped, so a template with every field listed parses.
 */
import {
  parseTopologyRecord, type TopologyRecord, GEOMETRY_FIELDS, GEOMETRY_ENUMS, SCALEOUT_FIELDS, PRESET_KEYS, CONFIDENCES, SUPERPOD_UNITS, RECORD_LAYERS, WORKSHEET_VERSION,
} from '@hac-d/core';
import {
  requireSection, optionalTable, table, cell, reqCell, numCell, optNumCell, enumCell, provCell, parseNum, writeWorksheetMarkdown, WorksheetError, type WsDoc, type WsOutSection, type WsCellValue,
} from './markdown.js';

const FV = ['field', 'value'], FV_OPT = ['source', 'confidence', 'note'];
const VARIANT_COLS = ['id', 'name zh', 'name en', 'basis zh', 'basis en', ...SCALEOUT_FIELDS];
const LAYER_COLS = ['layer', 'npus'], LAYER_OPT = ['unit'];
const COUNT_COLS = ['row', 'count', 'npus'], COUNT_OPT = ['tiers', 'source', 'confidence', 'note'];
const PROV_COLS = ['path', 'source', 'confidence'], PROV_OPT = ['note'];
type Prov = { source: string; confidence: string; note?: string };

export function checkWorksheet(front: Record<string, unknown>, kind: string): void {
  if (front.worksheet !== kind) throw new WorksheetError(`front matter 'worksheet' must be '${kind}' (got '${String(front.worksheet)}')`);
  if (front.version !== undefined && front.version !== WORKSHEET_VERSION) throw new WorksheetError(`front matter 'version' must be '${WORKSHEET_VERSION}' (got '${String(front.version)}')`);
}
const numValue = (s: string, where: string): number => { const v = parseNum(s); if (v === null) throw new WorksheetError(`${where}: value '${s}' is not a number`); return v; };
const enumValue = <T extends string>(s: string, values: readonly T[], where: string): T => { if (!(values as readonly string[]).includes(s)) throw new WorksheetError(`${where}: value '${s}' is not one of ${values.join(', ')}`); return s as T; };

/** parse a topology worksheet into a validated record */
export function worksheetToTopologyRecord(doc: WsDoc): TopologyRecord {
  const f = doc.front;
  checkWorksheet(f, 'topology');
  const input: Record<string, unknown> = {};
  for (const k of ['id', 'name', 'short', 'family', 'template', 'scenarioId', 'scenarioName', 'domainNpus', 'faultUnits', 'schematic']) if (f[k] !== undefined) input[k] = f[k];
  const provenance: Record<string, Prov> = {};
  const superpod: Record<string, unknown> = {};
  const geom = table(requireSection(doc, 'geometry'), FV, FV_OPT);
  for (const row of geom.rows) {
    const field = reqCell(row, 'field', 'geometry row'), value = cell(row, 'value');
    if (!value) continue;
    const where = `geometry '${field}'`;
    const p = provCell(row, CONFIDENCES, where);
    if (field === 'base') { superpod.base = enumValue(value, PRESET_KEYS, where); if (p) provenance.superpod = p; continue; }
    if (field === 'domainNpus') { input.domainNpus = numValue(value, where); if (p) provenance.domainNpus = p; continue; }
    if (!GEOMETRY_FIELDS.includes(field)) throw new WorksheetError(`${where}: unknown geometry field (known: base, domainNpus, ${GEOMETRY_FIELDS.join(', ')})`, geom.line);
    superpod[field] = GEOMETRY_ENUMS[field] ? enumValue(value, GEOMETRY_ENUMS[field], where) : numValue(value, where);
    if (p) provenance[`superpod.${field}`] = p;
  }
  input.superpod = superpod;
  const so = table(requireSection(doc, 'scale-out'), FV, FV_OPT);
  const scaleOut: Record<string, number> = {};
  for (const row of so.rows) {
    const field = reqCell(row, 'field', 'scale-out row'), value = cell(row, 'value');
    if (!value) continue;
    const where = `scale-out '${field}'`;
    if (!SCALEOUT_FIELDS.includes(field)) throw new WorksheetError(`${where}: unknown scale-out field (known: ${SCALEOUT_FIELDS.join(', ')})`, so.line);
    scaleOut[field] = numValue(value, where);
    const p = provCell(row, CONFIDENCES, where);
    if (p) provenance[`scaleOut.${field}`] = p;
  }
  input.scaleOut = scaleOut;
  const vt = optionalTable(doc, 'variants', VARIANT_COLS);
  const variants: Record<string, unknown>[] = (vt?.rows ?? []).map((row) => {
    const id = reqCell(row, 'id', 'variants row'), where = `variant '${id}'`;
    return { id, name: { zh: reqCell(row, 'name zh', where), en: reqCell(row, 'name en', where) }, basis: { zh: reqCell(row, 'basis zh', where), en: reqCell(row, 'basis en', where) }, scaleOut: Object.fromEntries(SCALEOUT_FIELDS.map((k) => [k, numCell(row, k, where)])) };
  });
  if (!variants.some((v) => v.id === 'main')) variants.unshift({ id: 'main', name: { zh: '主设计', en: 'main design' }, basis: { zh: '记录的 scale-out 设计', en: "the record's scale-out design" }, scaleOut: { ...scaleOut } });
  input.variants = variants;
  const lt = table(requireSection(doc, 'layers'), LAYER_COLS, LAYER_OPT);
  const layers: Record<string, unknown> = {};
  for (const row of lt.rows) {
    const layer = enumCell(row, 'layer', RECORD_LAYERS, 'layers row')!, npus = numCell(row, 'npus', `layer '${layer}'`);
    layers[layer] = layer === 'superpod' ? { unit: enumCell(row, 'unit', SUPERPOD_UNITS, `layer '${layer}'`), npus } : { npus };
  }
  input.layers = layers;
  const ct = optionalTable(doc, 'counts', COUNT_COLS, COUNT_OPT);
  if (ct && ct.rows.length) {
    const co: Record<string, { count: number; npus: number; tiers?: number }> = {};
    for (const row of ct.rows) {
      const id = reqCell(row, 'row', 'counts row'), where = `count '${id}'`, tiers = optNumCell(row, 'tiers', where);
      co[id] = { count: numCell(row, 'count', where), npus: numCell(row, 'npus', where), ...(tiers !== undefined ? { tiers } : {}) };
      const p = provCell(row, CONFIDENCES, where);
      if (p) provenance[`countOverrides.${id}`] = p;
    }
    input.countOverrides = co;
  }
  const at = optionalTable(doc, 'assumed', ['zh', 'en']);
  if (at) input.assumed = at.rows.map((row, i) => { const zh = cell(row, 'zh'), en = cell(row, 'en'); if (!zh && !en) throw new WorksheetError(`assumed row ${i + 1} is empty`, at.line); return zh === en ? zh : { zh: zh || en, en: en || zh }; });
  const pt = optionalTable(doc, 'provenance', PROV_COLS, PROV_OPT);
  if (pt) for (const row of pt.rows) { const path = reqCell(row, 'path', 'provenance row'); const p = provCell(row, CONFIDENCES, `provenance '${path}'`); if (!p) throw new WorksheetError(`provenance '${path}': source and confidence required`, pt.line); provenance[path] = p; }
  if (Object.keys(provenance).length) input.provenance = provenance;
  return parseTopologyRecord(input);
}

/** the worksheet of a record (round-trips through worksheetToTopologyRecord) */
export function topologyRecordToWorksheet(r: TopologyRecord, title?: string): string {
  const front: Record<string, unknown> = {
    worksheet: 'topology', version: WORKSHEET_VERSION, id: r.id, name: r.name, short: r.short, family: r.family, template: r.template, scenarioId: r.scenarioId,
    ...(r.scenarioName !== '{name} — {npus} NPUs' ? { scenarioName: r.scenarioName } : {}),
    ...(r.faultUnits ? { faultUnits: r.faultUnits } : {}), ...(r.schematic ? { schematic: r.schematic } : {}),
  };
  const prov = r.provenance ?? {}, used = new Set<string>();
  const P = (key: string): Prov | undefined => { const p = prov[key]; if (p) used.add(key); return p; };
  const pc = (p: Prov | undefined): WsCellValue[] => [p?.source, p?.confidence, p?.note];
  const geomRows: WsCellValue[][] = [];
  const { base, ...fields } = r.superpod as { base?: string } & Record<string, unknown>;
  if (base) geomRows.push(['base', base, ...pc(P('superpod'))]);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) geomRows.push([k, v as WsCellValue, ...pc(P(`superpod.${k}`))]);
  if (r.domainNpus !== undefined) geomRows.push(['domainNpus', r.domainNpus, ...pc(P('domainNpus'))]);
  const soRows = SCALEOUT_FIELDS.map((k) => [k, r.scaleOut[k as keyof typeof r.scaleOut], ...pc(P(`scaleOut.${k}`))]);
  const variants = r.variants.map((v) => [v.id, v.name.zh, v.name.en, v.basis.zh, v.basis.en, ...SCALEOUT_FIELDS.map((k) => v.scaleOut[k as keyof typeof v.scaleOut])]);
  const layers: WsCellValue[][] = [['superpod', r.layers.superpod.unit, r.layers.superpod.npus], ['cabinet', '', r.layers.cabinet.npus], ['node', '', r.layers.node.npus]];
  const counts = Object.entries(r.countOverrides ?? {}).map(([id, c]) => [id, c.count, c.npus, c.tiers, ...pc(P(`countOverrides.${id}`))]);
  const assumed = r.assumed.map((a) => (typeof a === 'string' ? [a, a] : [a.zh, a.en]));
  const leftovers = Object.entries(prov).filter(([k]) => !used.has(k)).map(([k, p]) => [k, p.source, p.confidence, p.note]);
  const sections: WsOutSection[] = [
    { name: 'geometry', title: 'SuperPoD geometry (base = preset; rows override it)', tables: [{ headers: ['field', 'value', 'source', 'confidence', 'note'], rows: geomRows }] },
    { name: 'scale-out', title: 'main scale-out design', tables: [{ headers: ['field', 'value', 'source', 'confidence', 'note'], rows: soRows }] },
    { name: 'variants', title: "scale-out designs compared in the BOM ('main' = the design above)", tables: [{ headers: VARIANT_COLS, rows: variants }] },
    { name: 'layers', title: 'instance rule of the layers', tables: [{ headers: ['layer', 'unit', 'npus'], rows: layers }] },
  ];
  if (counts.length) sections.push({ name: 'counts', title: 'user hardware counts by BOM row', tables: [{ headers: ['row', 'count', 'npus', 'tiers', 'source', 'confidence', 'note'], rows: counts }] });
  if (assumed.length) sections.push({ name: 'assumed', title: 'values not stated by a source', tables: [{ headers: ['zh', 'en'], rows: assumed }] });
  if (leftovers.length) sections.push({ name: 'provenance', title: 'entries by field path not placed in a row above', tables: [{ headers: ['path', 'source', 'confidence', 'note'], rows: leftovers }] });
  return writeWorksheetMarkdown(front, sections, title ?? `Topology worksheet — ${r.name.en}`);
}
