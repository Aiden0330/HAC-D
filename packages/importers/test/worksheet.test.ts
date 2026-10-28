/**
 * v6 worksheets: the Markdown profile round-trips the public records (record → worksheet → record), the strict parser rejects what
 * it must, the templates parse as they are, the device table and mapping worksheets feed the normaliser, and a spreadsheet device
 * table is read with guessed and explicit columns.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseWorksheetMarkdown, writeWorksheetMarkdown, splitRow, WorksheetError, parseWorksheet, worksheetKind, worksheetTemplate,
  topologyRecordToWorksheet, worksheetToTopologyRecord, faultRateOverrideToWorksheet, worksheetToFaultRateOverride,
  mechanismSetToWorksheet, worksheetToMechanismSet, deviceTableToWorksheet, worksheetToDeviceTable, mappingToWorksheet, worksheetToMapping,
  proposalToWorksheet, worksheetToProposal, proposalIntoSet, deviceTableFromSheet, isPercentFormat, EXAMPLE_DEVICE_TABLE, EXAMPLE_MAPPING, EXAMPLE_PROPOSAL,
} from '../src/index.js';
import type { SheetInfo } from '../src/index.js';
import { BUILTIN_TOPOLOGY_RECORDS, DEFAULT_MECHANISM_SET, parseTopologyRecord, parseFaultRateOverride, normalizeFaultRates, deviceFit, WORKSHEET_KINDS, validateMechanismSet, type TopologyRecord, type MechanismSet } from '@hac-d/core';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '..', '..', 'core', 'data');
const a960e = parseTopologyRecord(JSON.parse(readFileSync(join(data, 'records', 'a960e.json'), 'utf8')));
const remap = parseFaultRateOverride(JSON.parse(readFileSync(join(data, 'fault-rates', 'remap-per-card-2026-10-09.json'), 'utf8')));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('markdown profile', () => {
  it('splits rows with escaped pipes and parses front matter, sections, tables and items', () => {
    expect(splitRow('| a | b \\| c | d |')).toEqual(['a', 'b | c', 'd']);
    const doc = parseWorksheetMarkdown('---\nworksheet: topology\nname: { zh: 甲, en: A }\n---\n# Title\n\n## geometry — SuperPoD\n\n| field | value |\n|---|---|\n| base | atlas950-1k |\n| npusPerNode | 8 |\n\n- an item\nsome prose\n');
    expect(doc.front).toEqual({ worksheet: 'topology', name: { zh: '甲', en: 'A' } });
    expect(doc.sections.map((s) => s.name)).toEqual(['geometry']);
    expect(doc.sections[0].tables[0].rows).toEqual([{ field: 'base', value: 'atlas950-1k' }, { field: 'npusPerNode', value: '8' }]);
    expect(doc.sections[0].items).toEqual(['an item']);
    expect(doc.sections[0].text).toEqual(['some prose']);
  });
  it('rejects a missing front matter, a ragged row, a bad separator and content before the first section', () => {
    expect(() => parseWorksheetMarkdown('## x\n')).toThrow(/front matter/);
    expect(() => parseWorksheetMarkdown('---\na: 1\n---\n## x\n| a | b |\n|---|---|\n| 1 |\n')).toThrow(/line 7: row has 1 cells/);
    expect(() => parseWorksheetMarkdown('---\na: 1\n---\n## x\n| a | b |\n| 1 | 2 |\n')).toThrow(/separator/);
    expect(() => parseWorksheetMarkdown('---\na: 1\n---\n| a |\n|---|\n')).toThrow(/before the first/);
    expect(() => parseWorksheetMarkdown('---\n- a\n---\n## x\n')).toThrow(/mapping/);
  });
  it('the writer escapes pipes and the parser reads them back', () => {
    const text = writeWorksheetMarkdown({ worksheet: 'x' }, [{ name: 's', tables: [{ headers: ['a', 'b'], rows: [['p|q', 1]] }], items: ['i'] }]);
    const doc = parseWorksheetMarkdown(text);
    expect(doc.sections[0].tables[0].rows[0]).toEqual({ a: 'p|q', b: '1' });
  });
});

describe('record round trips', () => {
  const records: Record<string, TopologyRecord> = { ...BUILTIN_TOPOLOGY_RECORDS, a960e };
  for (const [id, r] of Object.entries(records)) {
    it(`topology ${id}`, () => {
      const text = topologyRecordToWorksheet(r);
      const back = worksheetToTopologyRecord(parseWorksheetMarkdown(text));
      expect(back).toEqual(r);
      expect(worksheetKind(text)).toBe('topology');
    });
  }
  it('fault-rate override (54 classes, analogues, catalog block)', () => {
    const back = worksheetToFaultRateOverride(parseWorksheetMarkdown(faultRateOverrideToWorksheet(remap)));
    expect(back).toEqual(remap);
  });
  it('mechanism set, complete form (no base)', () => {
    const text = mechanismSetToWorksheet(DEFAULT_MECHANISM_SET);
    const back = worksheetToMechanismSet(parseWorksheetMarkdown(text));
    expect(back).toEqual(DEFAULT_MECHANISM_SET);
  });
  it('mechanism set, delta form over the default set', () => {
    const s = clone(DEFAULT_MECHANISM_SET) as MechanismSet;
    s.id = 'internal-mech-1'; s.source = 'internal review 2026-10';
    s.parameters['R-LINK-LOCAL'] = { ...s.parameters['R-LINK-LOCAL'], success: 0.97 };
    s.provenance = { ...s.provenance, 'parameters.R-LINK-LOCAL.success': { source: 'DR-2026-031 table 4', confidence: 'assumed' } };
    s.efforts = { ...(s.efforts ?? {}), 'R-LINK-LOCAL': 2 };
    // move a pruned mechanism to the candidates
    const moved = s.pruned[0];
    s.pruned = s.pruned.filter((x) => x !== moved); s.candidates.push(moved);
    if (s.verdicts) s.verdicts[moved] = { verdict: 'candidate', reason: { zh: '内部测得收益', en: 'internal measurement shows a gain' } };
    for (const [a, b] of Object.entries(s.prune.dominated)) if (a === moved || b === moved) delete s.prune.dominated[a];
    const text = mechanismSetToWorksheet(s, DEFAULT_MECHANISM_SET);
    expect(text).toContain('| R-LINK-LOCAL | success');
    expect(text).not.toContain('| D-SDC | reference'); // unchanged verdicts are not listed in a delta
    const back = worksheetToMechanismSet(parseWorksheetMarkdown(text), DEFAULT_MECHANISM_SET);
    expect(back).toEqual(s);
    expect(validateMechanismSet(back).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('device table, mapping and proposal', () => {
    expect(worksheetToDeviceTable(parseWorksheetMarkdown(deviceTableToWorksheet(EXAMPLE_DEVICE_TABLE)))).toEqual(EXAMPLE_DEVICE_TABLE);
    expect(worksheetToMapping(parseWorksheetMarkdown(mappingToWorksheet(EXAMPLE_MAPPING)))).toEqual(EXAMPLE_MAPPING);
    expect(worksheetToProposal(parseWorksheetMarkdown(proposalToWorksheet(EXAMPLE_PROPOSAL)))).toEqual(EXAMPLE_PROPOSAL);
  });
});

describe('templates and dispatch', () => {
  for (const kind of WORKSHEET_KINDS) {
    it(`template ${kind} parses as it is`, () => {
      const text = worksheetTemplate(kind);
      const parsed = parseWorksheet(text, { baseSet: DEFAULT_MECHANISM_SET });
      expect(parsed.kind).toBe(kind);
      expect(text).toContain('## notes');
    });
  }
  it('the device and mapping templates normalise to the fault-rate template\'s classes', () => {
    const dt = parseWorksheet(worksheetTemplate('device-fit')); const mp = parseWorksheet(worksheetTemplate('koujing-mapping'));
    if (dt.kind !== 'device-fit' || mp.kind !== 'koujing-mapping') throw new Error('kind');
    const { override } = normalizeFaultRates(dt.value, mp.value, { id: 'x' });
    expect(override.rates['DDR-hard'].fit).toBeCloseTo(130, 9);
    expect(override.rates['POWER-hard'].fit).toBeCloseTo(100, 9);
    const text = faultRateOverrideToWorksheet(override);
    expect(worksheetToFaultRateOverride(parseWorksheetMarkdown(text))).toEqual(override);
  });
  it('a proposal with mapsTo lands in the set; without it the parser still accepts it', () => {
    const s = proposalIntoSet(EXAMPLE_PROPOSAL, DEFAULT_MECHANISM_SET);
    expect(s.parameters['R-LINK-LOCAL'].success).toBe(0.95);
    expect(s.provenance?.['parameters.R-LINK-LOCAL.success']?.confidence).toBe('assumed');
    expect(() => proposalIntoSet({ ...EXAMPLE_PROPOSAL, mapsTo: undefined }, DEFAULT_MECHANISM_SET)).toThrow(/extension request/);
  });
  it('strict worksheet errors name the problem', () => {
    const t = topologyRecordToWorksheet(BUILTIN_TOPOLOGY_RECORDS.cm384);
    expect(t).toContain('| base ');
    expect(() => worksheetToTopologyRecord(parseWorksheetMarkdown(t.replace('| base ', '| bass ')))).toThrow(/unknown geometry field/);
    expect(() => worksheetToTopologyRecord(parseWorksheetMarkdown(t.replace('worksheet: topology', 'worksheet: fault-rates')))).toThrow(/must be 'topology'/);
    expect(() => parseWorksheet(t.replace('worksheet: topology', 'worksheet: nope'))).toThrow(/one of/);
    const r = faultRateOverrideToWorksheet(remap);
    expect(() => worksheetToFaultRateOverride(parseWorksheetMarkdown(r.replace('| class ', '| klass ')))).toThrow(/lacks the column 'class'/);
    const bad = r.replace(/\| assumed /, '| guessed ');
    expect(() => worksheetToFaultRateOverride(parseWorksheetMarkdown(bad))).toThrow(/not one of measured/);
  });
});

describe('device table from a sheet', () => {
  const cells = (rows: (string | number | null)[][]): SheetInfo => ({ name: 'FIT', rows: rows.length, cols: Math.max(...rows.map((r) => r.length)), merges: [], outline: rows.map(() => 0), cells: rows.flatMap((r, i) => r.map((v, j) => ({ sheet: 'FIT', addr: `${String.fromCharCode(65 + j)}${i + 1}`, row: i, col: j, value: v }))) });
  it('guesses the header row and the columns from a zh/en lexicon and keeps values as written', () => {
    const sheet = cells([['FIT 清单', null, null, null], ['器件', 'FIT', '来源', '来源类型'], ['DDR5 DIMM', 30, 'FIT-DB', '厂商手册'], ['PSU', 500, 'datasheet', 'vendor'], ['', null, null, null], ['SSD', 'n/a', 'x', 'field']]);
    const r = deviceTableFromSheet(sheet, { id: 't' });
    expect(r.headerRow).toBe(1);
    expect(r.table.rows.map((x) => [x.device, x.value, x.unit, x.sourceType])).toEqual([['DDR5 DIMM', 30, 'FIT', 'vendor'], ['PSU', 500, 'FIT', 'vendor']]);
    expect(r.skipped).toEqual([{ row: 6, reason: "rate 'n/a' is not a number" }]);
  });
  it('explicit columns, a unit column and defaults for missing columns', () => {
    const sheet = cells([['Part', 'Rate', 'Unit'], ['Fan', 0.03, 'AFR'], ['CPU', 1500000, 'MTBF'], ['NIC', 2, 'ppm/h']]);
    const r = deviceTableFromSheet(sheet, { id: 't', columns: { device: 'Part', value: 1, unit: 'Unit' }, sourceType: 'vendor', rowSource: 'vendor sheet' });
    expect(r.table.rows.map((x) => [x.device, x.unit, x.source])).toEqual([['Fan', 'afr', 'vendor sheet'], ['CPU', 'mtbf_h', 'vendor sheet'], ['NIC', 'per_1e6_h', 'vendor sheet']]);
    expect(() => deviceTableFromSheet(sheet, { id: 't', columns: { device: 'Nope' } })).toThrow(/no column headed 'Nope'/);
  });
  it('fifth review D2: a percent AFR becomes the fraction (noted as written); zh per-10⁶-h and per-hour headers are not MTBF', () => {
    const one = (rows: (string | number | null)[][]) => deviceTableFromSheet(cells(rows), { id: 't', sourceType: 'vendor' }).table.rows[0];
    const afr = (pct: number) => (-Math.log(1 - pct / 100) / 8760) * 1e9;
    const a = one([['器件', '失效率', '单位', '来源'], ['DIMM', 0.5, '%/year', 'v']]);
    expect([a.unit, a.value]).toEqual(['afr', 0.005]);
    expect(a.note).toMatch(/0\.5 %\/year read as afr 0\.005/);
    expect(deviceFit(a)).toBeCloseTo(afr(0.5), 6);
    const b = one([['器件', 'AFR (%)', '来源'], ['SSD', 0.8, 'v']]);
    expect([b.unit, b.value]).toEqual(['afr', 0.008]);
    expect(deviceFit(b)).toBeCloseTo(afr(0.8), 6);
    const c = one([['Part', 'Annual failure rate', 'source'], ['HDD', 0.02, 'v']]);
    expect([c.unit, c.value, c.note]).toEqual(['afr', 0.02, undefined]);
    const d = one([['器件', '失效率（每百万小时）', '来源'], ['PSU', 2.5, 'v']]);
    expect([d.unit, deviceFit(d)]).toEqual(['per_1e6_h', 2500]);
    const e = one([['器件', '每小时失效率', '来源'], ['FAN', 2e-6, 'v']]);
    expect([e.unit, deviceFit(e)]).toEqual(['per_h', 2000]);
    const f = one([['器件', '平均无故障时间（小时）', '来源'], ['CPU', 2e6, 'v']]);
    expect([f.unit, deviceFit(f)]).toEqual(['mtbf_h', 500]);
    const g = one([['Part', 'Failure rate (per million hours)', 'source'], ['PSU', 2.5, 'v']]);
    expect([g.unit, deviceFit(g)]).toEqual(['per_1e6_h', 2500]);
    const h = one([['Part', 'Rate', 'Unit', 'source'], ['Fan', '3 %', '% per year', 'v']]);
    expect([h.unit, h.value]).toEqual(['afr', 0.03]);
  });
  it('recheck N1 / N2: a percent in the value cell is an AFR’s only; an MTBF in a multiple of hours is multiplied into hours', () => {
    const all = (rows: (string | number | null)[][]) => deviceTableFromSheet(cells(rows), { id: 't', sourceType: 'vendor' });
    const afr = (pct: number) => (-Math.log(1 - pct / 100) / 8760) * 1e9;
    const a = all([['Device', 'AFR', 'Source'], ['DIMM', '0.5%', 'v']]).table.rows[0];
    expect([a.unit, a.value, a.note]).toEqual(['afr', 0.005, '0.5% read as afr 0.005']);
    expect(deviceFit(a)).toBeCloseTo(afr(0.5), 6);
    const b = all([['器件', '年化失效率', '来源'], ['SSD', '0.3%', 'v']]).table.rows[0];
    expect([b.unit, b.value]).toEqual(['afr', 0.003]);
    const c = all([['Device', 'FIT', 'Source'], ['Fan', '5%', 'v'], ['PSU', 500, 'v']]);
    expect(c.table.rows.map((r) => [r.device, r.value])).toEqual([['PSU', 500]]);
    expect(c.skipped).toEqual([{ row: 2, reason: "a percentage ('5%') is not a FIT value (FIT, per 10⁶ h, per hour or MTBF hours)" }]);
    for (const [h, factor] of [['MTBF（百万小时）', 1e6], ['MTBF (million hours)', 1e6], ['MTBF (10^6 h)', 1e6], ['平均无故障时间（万小时）', 1e4], ['MTBF (kh)', 1e3]] as const) {
      const r = all([['Part', h, 'Source'], ['PSU', 2, 'v']]).table.rows[0];
      expect([h, r.unit, r.value, r.note]).toEqual([h, 'mtbf_h', 2 * factor, `2 ${h} read as mtbf_h ${2 * factor}`]);
      expect(deviceFit(r)).toBeCloseTo(1e9 / (2 * factor), 9);
    }
    const d = all([['器件', '失效率（每百万小时）', '来源'], ['PSU', 2.5, 'v']]).table.rows[0];
    expect([d.unit, d.value, d.note]).toEqual(['per_1e6_h', 2.5, undefined]);
    const u = all([['Part', 'Rate', 'Unit', 'Source'], ['PSU', 2, '百万小时', 'v'], ['Fan', 2, '/百万小时', 'v'], ['CPU', 2, '万小时', 'v'], ['NIC', 2, 'per million hours', 'v']]);
    expect(u.table.rows.map((r) => [r.device, r.unit, r.value])).toEqual([['PSU', 'mtbf_h', 2e6], ['Fan', 'per_1e6_h', 2], ['CPU', 'mtbf_h', 2e4], ['NIC', 'per_1e6_h', 2]]);
  });
  it('second recheck N5 / N6: a percent-formatted cell holds the fraction; an MTBF in years; a count per time is a rate', () => {
    const withFmt = (rows: (string | number | null)[][], fmts: Record<string, string>): SheetInfo => { const s = cells(rows); return { ...s, cells: s.cells.map((c) => (fmts[`${c.row},${c.col}`] ? { ...c, format: fmts[`${c.row},${c.col}`] } : c)) }; };
    const one = (s: SheetInfo) => deviceTableFromSheet(s, { id: 't', sourceType: 'vendor' });
    const afr = (frac: number) => (-Math.log(1 - frac) / 8760) * 1e9;
    // Excel stores a cell shown as 0.5 % as 0.005: a percent header or unit cell does not divide it again
    const a = one(withFmt([['Device', 'AFR (%)', 'Source'], ['DIMM', 0.005, 'v']], { '1,1': '0.0%' })).table.rows[0];
    expect([a.unit, a.value, a.note]).toEqual(['afr', 0.005, '0.5% (cell format 0.0%, stored 0.005) read as afr 0.005']);
    expect(deviceFit(a)).toBeCloseTo(afr(0.005), 6);
    const b = one(withFmt([['Device', 'Rate', 'Unit', 'Source'], ['DIMM', 0.005, '%/year', 'v']], { '1,1': '0.00%' })).table.rows[0];
    expect([b.unit, b.value]).toEqual(['afr', 0.005]);
    expect(one(withFmt([['Device', 'AFR', 'Source'], ['DIMM', 0.005, 'v']], { '1,1': '0.00%' })).table.rows[0].value).toBe(0.005);
    // a typed percentage under a percent header is still divided (D2); a quoted or escaped "%" in a format only prints the sign
    expect(one(withFmt([['Device', 'AFR (%)', 'Source'], ['SSD', 0.8, 'v']], { '1,1': '0.0"%"' })).table.rows[0].value).toBe(0.008);
    expect(one(withFmt([['Device', 'AFR (%)', 'Source'], ['SSD', 0.8, 'v']], { '1,1': '0.0\\%' })).table.rows[0].value).toBe(0.008);
    expect([isPercentFormat('0.0%'), isPercentFormat('0%'), isPercentFormat('0.0"%"'), isPercentFormat('0.0\\%'), isPercentFormat('General'), isPercentFormat(undefined)]).toEqual([true, true, false, false, false, false]);
    // a percent-formatted cell under any other unit refuses the row
    const f = one(withFmt([['Device', 'FIT', 'Source'], ['Fan', 0.05, 'v'], ['PSU', 500, 'v']], { '1,1': '0%' }));
    expect(f.table.rows.map((r) => r.device)).toEqual(['PSU']);
    expect(f.skipped).toEqual([{ row: 2, reason: "a percentage ('5% (cell format 0%)') is not a FIT value (FIT, per 10⁶ h, per hour or MTBF hours)" }]);
    // MTBF in years: × 8,760 h; a header that names hours stays in hours
    for (const h of ['MTBF（年）', 'MTBF (years)', '平均无故障时间（年）', 'MTTF (yr)']) {
      const r = one(cells([['Part', h, 'Source'], ['Fan', 10, 'v']])).table.rows[0];
      expect([h, r.unit, r.value, r.note]).toEqual([h, 'mtbf_h', 87600, `10 ${h} read as mtbf_h 87600`]);
      expect(deviceFit(r)).toBeCloseTo(1e9 / 87600, 9);
    }
    expect(one(cells([['Part', 'MTBF (h), 5-year field data', 'Source'], ['Fan', 2e6, 'v']])).table.rows[0].value).toBe(2e6);
    // unit cells: a count per time is a rate, a bare year a duration
    const u = one(cells([['Part', 'Rate', 'Unit', 'Source'], ['PSU', 2.5, '次/百万小时', 'v'], ['Fan', 2.5, 'failures/10^6 h', 'v'], ['CPU', 2e-6, '次/小时', 'v'], ['NIC', 10, 'years', 'v'], ['SSD', 10, '年', 'v']]));
    expect(u.table.rows.map((r) => [r.device, r.unit, r.value])).toEqual([['PSU', 'per_1e6_h', 2.5], ['Fan', 'per_1e6_h', 2.5], ['CPU', 'per_h', 2e-6], ['NIC', 'mtbf_h', 87600], ['SSD', 'mtbf_h', 87600]]);
    expect(deviceFit(u.table.rows[0])).toBeCloseTo(2500, 9);
  });
});
