/**
 * Draft worksheets from accepted evidence cards (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.1–§5.3): the deterministic step
 * between the model and the records. The model never writes a worksheet; this module places each card in the row of the importers'
 * profile (written with `writeWorksheetMarkdown` / `deviceTableToWorksheet`, so the same parser reads it back), with
 *   source     = `${doc} ${loc}` of the card,
 *   confidence = the source-type policy `SOURCE_CONFIDENCE[sourceType]` (never the model's), `derived` when this module converted
 *                a unit (the conversion is written into the note),
 *   note       = the verbatim quote.
 * Numbers are read with core `parseNumberText` (separators, full-width digits, 万 / 千 / k); a card whose value does not parse, whose
 * unit is not recognised or that conflicts with an earlier card for the same field is not placed and is listed under `## notes`.
 * The draft is a proposal for review: the validation gates (`hacd ingest validate`) and a person decide whether it is promoted.
 */
import {
  parseNumberText, normalizeText, cardKey, SOURCE_CONFIDENCE, WORKSHEET_VERSION, GEOMETRY_FIELDS, GEOMETRY_ENUMS, SCALEOUT_FIELDS, COUNT_ROWS, RECORD_LAYERS,
  type EvidenceCard, type DeviceRateUnit, type DeviceFitTable,
} from '@hac-d/core';
import { writeWorksheetMarkdown, deviceTableToWorksheet, parseNum, type WsOutSection, type WsCellValue } from '@hac-d/importers';
import type { DraftOptions, ExtractKind } from './types.js';

const src = (c: EvidenceCard): string => `${c.doc} ${c.loc}`.trim();
const vu = (c: EvidenceCard): string => `${c.value_text}${c.unit_text ? ` ${c.unit_text}` : ''}`;
const num = (s: string): number | null => parseNumberText(s) ?? parseNum(s);
/** round away binary noise of a unit conversion (0.95 not 0.9500000000000001) */
const clean = (v: number): number => Number(v.toPrecision(12));

/** first card per key; later cards with another value are conflicts (listed), with the same value duplicates (dropped) */
function firstPerKey(cards: EvidenceCard[], notes: string[]): Map<string, EvidenceCard> {
  const m = new Map<string, EvidenceCard>();
  for (const c of cards) {
    const k = cardKey(c), prev = m.get(k);
    if (!prev) { m.set(k, c); continue; }
    if (normalizeText(prev.value_text) !== normalizeText(c.value_text) || normalizeText(prev.unit_text) !== normalizeText(c.unit_text))
      notes.push(`${k}: ${vu(c)} (${src(c)}, “${c.quote}”) conflicts with ${vu(prev)} (${src(prev)}); the first is used`);
  }
  return m;
}

const notesSection = (notes: string[]): WsOutSection[] => (notes.length ? [{ name: 'notes', title: 'cards not placed in a row (review)', items: notes }] : []);

/* ---------------- topology ---------------- */
function draftTopology(cards: EvidenceCard[], o: DraftOptions): string {
  const notes: string[] = [];
  const by = firstPerKey(cards, notes);
  const conf = SOURCE_CONFIDENCE[o.sourceType];
  const used = new Set<string>();
  const take = (path: string): EvidenceCard | undefined => { const c = by.get(path); if (c) used.add(path); return c; };
  const prov = (c: EvidenceCard): WsCellValue[] => [src(c), conf, c.quote];
  const numeric = (path: string, c: EvidenceCard): number | null => {
    const v = num(c.value_text);
    if (v === null) notes.push(`${path}: value '${c.value_text}' is not a number (${src(c)}, “${c.quote}”)`);
    return v;
  };

  const geometry: WsCellValue[][] = [];
  const base = take('superpod.base');
  if (base) geometry.push(['base', base.value_text.trim(), ...prov(base)]);
  for (const f of GEOMETRY_FIELDS) {
    const c = take(`superpod.${f}`);
    if (!c) continue;
    if (GEOMETRY_ENUMS[f]) { geometry.push([f, c.value_text.trim(), ...prov(c)]); continue; }
    const v = numeric(`superpod.${f}`, c);
    if (v !== null) geometry.push([f, v, ...prov(c)]);
  }
  const dom = take('domainNpus');
  if (dom) { const v = numeric('domainNpus', dom); if (v !== null) geometry.push(['domainNpus', v, ...prov(dom)]); }

  const scaleOut: WsCellValue[][] = [];
  for (const f of SCALEOUT_FIELDS) {
    const c = take(`scaleOut.${f}`);
    if (!c) continue;
    const v = numeric(`scaleOut.${f}`, c);
    if (v !== null) scaleOut.push([f, v, ...prov(c)]);
  }

  const layers: WsCellValue[][] = [], provenance: WsCellValue[][] = [];
  const unitCard = take('layers.superpod.unit');
  for (const l of RECORD_LAYERS) {
    const c = take(`layers.${l}.npus`);
    if (!c) continue;
    const v = numeric(`layers.${l}.npus`, c);
    if (v === null) continue;
    if (l === 'superpod' && !unitCard) notes.push("layers.superpod.unit: not stated ('supernodes' or 'nodes'); fill the unit cell of the superpod layer");
    layers.push([l, l === 'superpod' ? unitCard?.value_text.trim() : '', v]);
    provenance.push([`layers.${l}.npus`, ...prov(c)]);
  }
  if (unitCard) provenance.push(['layers.superpod.unit', ...prov(unitCard)]);
  const missing = RECORD_LAYERS.filter((l) => !layers.some((r) => r[0] === l));
  if (missing.length) notes.push(`layers: no NPU count stated for ${missing.join(', ')}; the record needs the superpod, cabinet and node rows`);

  const counts: WsCellValue[][] = [];
  for (const r of COUNT_ROWS) {
    const cc = take(`countOverrides.${r}.count`), cn = take(`countOverrides.${r}.npus`);
    if (!cc && !cn) continue;
    if (!cc || !cn) { notes.push(`countOverrides.${r}: a count needs both the count and the NPUs it refers to (only ${cc ? 'count' : 'npus'} stated)`); continue; }
    const vc = numeric(`countOverrides.${r}.count`, cc), vn = numeric(`countOverrides.${r}.npus`, cn);
    if (vc !== null && vn !== null) counts.push([r, vc, vn, '', src(cc), conf, `${cc.quote} / ${cn.quote}`]);
  }

  for (const [k, c] of by) if (!used.has(k)) notes.push(`${k === 'unmapped' || c.field === 'unmapped' ? `unmapped '${c.label ?? ''}'` : k}: ${vu(c)} (${src(c)}, “${c.quote}”) has no row in the topology worksheet`);

  const name = o.name ?? { zh: o.id, en: o.id };
  const front = { worksheet: 'topology', version: WORKSHEET_VERSION, id: o.id, name, short: { ...(o.short ?? name) }, family: o.family ?? '', template: o.template ?? '', scenarioId: o.scenarioId ?? o.id };
  const FV = ['field', 'value', 'source', 'confidence', 'note'];
  const sections: WsOutSection[] = [
    { name: 'geometry', title: 'SuperPoD geometry (base = preset; rows override it)', tables: [{ headers: FV, rows: geometry }] },
    { name: 'scale-out', title: 'main scale-out design', tables: [{ headers: FV, rows: scaleOut }] },
    { name: 'layers', title: 'instance rule of the layers', tables: [{ headers: ['layer', 'unit', 'npus'], rows: layers }] },
  ];
  if (counts.length) sections.push({ name: 'counts', title: 'user hardware counts by BOM row', tables: [{ headers: ['row', 'count', 'npus', 'tiers', 'source', 'confidence', 'note'], rows: counts }] });
  if (provenance.length) sections.push({ name: 'provenance', title: 'entries by field path not placed in a row above', tables: [{ headers: ['path', 'source', 'confidence', 'note'], rows: provenance }] });
  sections.push(...notesSection(notes));
  return writeWorksheetMarkdown(front, sections, `Topology worksheet (draft from evidence cards) — ${name.en}`);
}

/* ---------------- device-fit ---------------- */
/**
 * unit as written → device-table unit and the factor the stated value is multiplied by. A rate per 10⁶ hours says "per" / "/" /
 * "每"; a bare multiple of hours (百万小时, million hours, 10^6 h, 万小时, kh), with or without the MTBF word, is a duration — an
 * MTBF in that many hours (recheck N2). The percent of an AFR is handled by the caller (the value text may carry it).
 */
const UNIT_LEXICON: [RegExp, DeviceRateUnit, number][] = [
  [/^fits?$/, 'FIT', 1],
  [/^(mtbf|mttf|平均无故障时间?)?(百万小时|millionh(?:ours?|rs?)?|10\^?6h(?:ours?|rs?)?|1e6h(?:ours?|rs?)?|mh)$/, 'mtbf_h', 1e6],
  [/^(mtbf|mttf|平均无故障时间?)?十万小时$/, 'mtbf_h', 1e5],
  [/^(mtbf|mttf|平均无故障时间?)?万小时$/, 'mtbf_h', 1e4],
  [/^(mtbf|mttf|平均无故障时间?)?(千小时|thousandh(?:ours?|rs?)?|kh|10\^?3h(?:ours?|rs?)?)$/, 'mtbf_h', 1e3],
  [/^(failures?)?(\/|per|每)(10\^?6|1e6|million|百万)(h|hr|hrs|hours?|小时)$|^fpmh$|^ppm\/h$|^(10\^?-6|1e-6)\/h$/, 'per_1e6_h', 1],
  [/^(failures?|1)?\/(h|hr|hour)$|^perhour$|每小时/, 'per_h', 1],
  [/^%?\/(year|yr|a|年)$|^afr|^peryear$|年/, 'afr', 1],
  [/^(h|hr|hrs|hours?|小时)$|^mtbf/, 'mtbf_h', 1],
];
/** the device-table unit of a unit as written and the factor to multiply the stated value by (null when not recognised) */
export function deviceRateUnitFactor(unitText: string): { unit: DeviceRateUnit; factor: number } | null {
  const s = unitText.normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/[()（）]/g, '');
  if (!s) return null;
  const m = UNIT_LEXICON.find(([re]) => re.test(s));
  return m ? { unit: m[1], factor: m[2] } : null;
}
/** the device-table unit of a unit as written (null when not recognised) */
export function deviceRateUnit(unitText: string): DeviceRateUnit | null {
  return deviceRateUnitFactor(unitText)?.unit ?? null;
}

function draftDeviceFit(cards: EvidenceCard[], o: DraftOptions): string {
  const notes: string[] = [];
  const rows: DeviceFitTable['rows'] = [];
  for (const c of firstPerKey(cards.filter((x) => x.field === 'unmapped'), notes).values()) {
    const device = (c.label ?? '').trim(), text = c.value_text.trim(), pct = /%/.test(text), v = num(text.replace(/%/g, '')), uf = deviceRateUnitFactor(c.unit_text), unit = uf?.unit ?? null;
    if (v === null) { notes.push(`${device}: value '${c.value_text}' is not a number (${src(c)}, “${c.quote}”)`); continue; }
    if (!unit || !uf) { notes.push(`${device}: unit '${c.unit_text}' not recognised (FIT, /10^6 h, per hour, MTBF h, AFR) (${src(c)}, “${c.quote}”)`); continue; }
    let value = v, note = c.quote;
    if (pct || (unit === 'afr' && /%/.test(c.unit_text))) {
      // a percent is an AFR's only (recheck N1): under any other unit the row is not placed
      if (unit !== 'afr') { notes.push(`${device}: a percentage ('${c.value_text}') is not a ${unit} value (${src(c)}, “${c.quote}”)`); continue; }
      value = clean(v / 100); note = `${c.quote}; ${v} % → ${value} (÷100)`;
    } else if (uf.factor !== 1) { value = clean(v * uf.factor); note = `${c.quote}; ${v} ${c.unit_text} → ${value} h (×${uf.factor})`; }
    if (unit === 'afr' && value >= 1) { notes.push(`${device}: AFR ${value} is not a fraction below 1 (${src(c)}, “${c.quote}”)`); continue; }
    rows.push({ device, value, unit, source: src(c), loc: c.loc, sourceType: o.sourceType, note });
  }
  for (const c of cards) if (c.field !== 'unmapped') notes.push(`${c.field}: ${vu(c)} (${src(c)}) is not a device row (device cards are 'unmapped' with a label)`);
  const text = deviceTableToWorksheet({ id: o.id, ...(o.source ? { source: o.source } : {}), rows }, `Device table (draft from evidence cards) — ${o.id}`);
  return notes.length ? `${text.trimEnd()}\n\n## notes — cards not placed in a row (review)\n\n${notes.map((n) => `- ${n.replace(/\r?\n/g, ' ')}`).join('\n')}\n` : text;
}

/* ---------------- mechanisms ---------------- */
const TIME_FACTORS: [RegExp, number][] = [[/^(s|sec|secs|seconds?|秒)$/, 1], [/^(ms|毫秒)$/, 1e-3], [/^(min|mins|minutes?|分|分钟)$/, 60], [/^(h|hr|hrs|hours?|小时)$/, 3600]];

function draftMechanisms(cards: EvidenceCard[], o: DraftOptions): string {
  const notes: string[] = [];
  const conf = SOURCE_CONFIDENCE[o.sourceType];
  const rows: WsCellValue[][] = [];
  for (const [k, c] of firstPerKey(cards, notes)) {
    const m = /^parameters\.([^.]+)\.([^.]+)$/.exec(c.field);
    if (!m) { notes.push(`${c.field === 'unmapped' ? `unmapped '${c.label ?? ''}'` : k}: ${vu(c)} (${src(c)}, “${c.quote}”) is not a mechanism parameter`); continue; }
    const [, mech, key] = m;
    const v = num(c.value_text.replace(/%$/, ''));
    if (v === null) { notes.push(`${c.field}: value '${c.value_text}' is not a number (${src(c)}, “${c.quote}”)`); continue; }
    const unit = c.unit_text.normalize('NFKC').trim().toLowerCase();
    let value = v, factor = 1, how = '';
    if (unit === '%' || /%$/.test(c.value_text)) { factor = 0.01; how = '÷100'; }
    else if (unit && /seconds$/i.test(key)) {
      const t = TIME_FACTORS.find(([re]) => re.test(unit));
      if (!t) { notes.push(`${c.field}: time unit '${c.unit_text}' not recognised (${src(c)}, “${c.quote}”)`); continue; }
      factor = t[1]; how = factor === 1 ? '' : `×${t[1]}`;
    } else if (unit) { notes.push(`${c.field}: unit '${c.unit_text}' — the value is not placed, a person sets the dimensionless value (${src(c)}, “${c.quote}”)`); continue; }
    value = clean(v * factor);
    rows.push([mech, key, value, src(c), factor === 1 ? conf : 'derived', factor === 1 ? c.quote : `${c.quote}; ${vu(c)} → ${value} (${how})`]);
  }
  const front = { worksheet: 'mechanisms', version: WORKSHEET_VERSION, id: o.id, base: 'remap-latest-2026-10', source: o.source ?? `evidence cards (${[...new Set(cards.map((c) => c.doc))].join(', ')})` };
  const sections: WsOutSection[] = [
    { name: 'parameters', title: 'parameter updates over the base set', tables: [{ headers: ['mechanism', 'parameter', 'value', 'source', 'confidence', 'note'], rows }] },
    ...notesSection(notes),
  ];
  return writeWorksheetMarkdown(front, sections, `Mechanism set delta (draft from evidence cards) — ${o.id}`);
}

export function draftWorksheet(kind: ExtractKind, cards: EvidenceCard[], o: DraftOptions): string {
  switch (kind) {
    case 'topology': return draftTopology(cards, o);
    case 'device-fit': return draftDeviceFit(cards, o);
    case 'mechanisms': return draftMechanisms(cards, o);
  }
}
