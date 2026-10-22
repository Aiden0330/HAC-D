/**
 * v6 extraction worker end to end (PLAN_V6 §5.2, §5.3): a synthetic bilingual design document (fictional, every value invented,
 * no internal data) → chunks → a mock model that reads its chunk with regexes and returns grounded cards on both passes →
 * accepted cards → a draft topology / device-table / mechanisms worksheet → the importers' parsers → records equal to the invented
 * values, with the source-type confidence and the quote as provenance.
 */
import { describe, it, expect } from 'vitest';
import { recordPodNpus, recordSuperpod, DEFAULT_MECHANISM_SET, type EvidenceCard } from '@hac-d/core';
import { parseWorksheetMarkdown, worksheetToTopologyRecord, worksheetToDeviceTable, worksheetToMechanismSet, parseWorksheet } from '@hac-d/importers';
import { extractDocuments, draftWorksheet, mockAdapter, deviceRateUnit, type CompletionRequest } from '../src/index.js';

/** a model stand-in: every pattern found in the prompt's chunk becomes a card whose quote is the whole match */
const regexModel = (patterns: [string, RegExp, string, string?][]) => (req: CompletionRequest): string => {
  const cards = [];
  for (const [field, re, unit, label] of patterns) {
    const m = re.exec(req.user);
    if (m) cards.push({ doc: 'model-guess', loc: '', field, ...(label ? { label } : {}), value_text: m[1], unit_text: unit, quote: m[0], model_confidence: 'medium' });
  }
  return '```json\n' + JSON.stringify({ cards }, null, 2) + '\n```';
};

const DESIGN = [
  '# 虚构超节点 X 设计说明 / Fictional SuperPoD X design note',
  '',
  '本文为虚构示例，所有数值均为编造。This document is fictional; every number in it is invented.',
  '',
  '## 1 概述 Overview',
  '设计基线为 atlas950-1k 预设，几何按下文覆盖。The geometry starts from a preset and is overridden below.',
  '',
  '## 2 计算节点 Compute node',
  '每个计算节点配置 4 颗 NPU 和 1 颗 CPU。Each compute node carries four accelerators and one host processor.',
  '单节点 NPU 数为 4，节点即托盘。',
  '',
  '## 3 机柜 Cabinet',
  '每个计算柜容纳 12 个节点，柜内有 24 颗 UB 交换芯片。Each compute cabinet holds twelve nodes.',
  '按上述配置，每柜 48 卡。',
  '',
  '## 4 超节点 SuperPoD',
  '超节点由 10 个计算柜和 3 个互联柜组成，共 480 卡，可靠性分析以超节点为实例单位（supernodes）。',
  'Each NPU has 3 optical uplinks into the pod switch tier.',
  '',
  '## 5 Scale-out 网络 / scale-out network',
  'Each NPU has 2 scale-out ports, spread over 2 planes of 96-port switches.',
  '',
].join('\n');

const TOPO_PATTERNS: [string, RegExp, string][] = [
  ['superpod.base', /基线为 (atlas950-1k) 预设/, ''],
  ['superpod.npusPerNode', /配置 (\d+) 颗 NPU/, '颗'],
  ['superpod.cpusPerNode', /和 (\d+) 颗 CPU/, '颗'],
  ['superpod.nodesPerRack', /容纳 (\d+) 个节点/, '个'],
  ['superpod.rackSwitches', /柜内有 (\d+) 颗 UB 交换芯片/, '颗'],
  ['superpod.computeRacks', /由 (\d+) 个计算柜/, '个'],
  ['superpod.commRacks', /和 (\d+) 个互联柜/, '个'],
  ['superpod.podUplinksPerNpu', /has (\d+) optical uplinks/, 'optical uplinks'],
  ['scaleOut.portsPerNpu', /has (\d+) scale-out ports/, 'ports'],
  ['scaleOut.planes', /over (\d+) planes/, 'planes'],
  ['scaleOut.radix', /of (\d+)-port switches/, 'port'],
  ['layers.node.npus', /单节点 NPU 数为 (\d+)/, ''],
  ['layers.cabinet.npus', /每柜 (\d+) 卡/, '卡'],
  ['layers.superpod.npus', /共 (\d+) 卡/, '卡'],
  ['layers.superpod.unit', /实例单位（(supernodes)）/, ''],
];

describe('end to end: synthetic topology document → draft worksheet → topology record', () => {
  it('reproduces the invented geometry with provenance', async () => {
    const r = await extractDocuments({ docs: [{ name: 'synthetic-x.md', text: DESIGN }], kind: 'topology', adapter: mockAdapter(regexModel(TOPO_PATTERNS)), chunkChars: 300, overlapChars: 80 });
    expect(r.chunks).toBeGreaterThan(2);
    expect(r.calls).toBe(2 * r.chunks);
    expect(r.rejected).toEqual([]);
    expect(r.disputed).toEqual([]);
    expect(r.accepted.map((c) => c.field).sort()).toEqual(TOPO_PATTERNS.map(([f]) => f).sort());
    expect(r.accepted.every((c) => c.doc === 'synthetic-x.md' && /^L\d+-\d+$/.test(c.loc))).toBe(true);

    const text = draftWorksheet('topology', r.accepted, { id: 'internal-synth', sourceType: 'vendor', template: 'a950-ub2', family: '950', name: { zh: '虚构超节点 X', en: 'Fictional SuperPoD X' } });
    expect(text).not.toContain('## notes');
    const rec = worksheetToTopologyRecord(parseWorksheetMarkdown(text));
    expect(rec).toMatchObject({ id: 'internal-synth', template: 'a950-ub2', family: '950', scenarioId: 'internal-synth', name: { zh: '虚构超节点 X', en: 'Fictional SuperPoD X' }, short: { en: 'Fictional SuperPoD X' } });
    expect(rec.superpod).toEqual({ base: 'atlas950-1k', npusPerNode: 4, cpusPerNode: 1, nodesPerRack: 12, computeRacks: 10, commRacks: 3, rackSwitches: 24, podUplinksPerNpu: 3 });
    expect(rec.scaleOut).toEqual({ portsPerNpu: 2, planes: 2, radix: 96, oversubscription: 1, transceiversPerLink: 2 });
    expect(rec.layers).toEqual({ superpod: { unit: 'supernodes', npus: 480 }, cabinet: { npus: 48 }, node: { npus: 4 } });
    const sp = recordSuperpod(rec);
    expect(rec.layers.node.npus).toBe(sp.npusPerNode);
    expect(rec.layers.cabinet.npus).toBe(sp.npusPerNode * sp.nodesPerRack);
    expect(rec.layers.superpod.npus).toBe(recordPodNpus(rec));
    expect(rec.provenance['superpod.npusPerNode']).toEqual({ source: expect.stringMatching(/^synthetic-x\.md L\d+-\d+$/), confidence: 'vendor', note: '配置 4 颗 NPU' });
    expect(rec.provenance.superpod).toMatchObject({ confidence: 'vendor', note: '基线为 atlas950-1k 预设' });
    expect(rec.provenance['scaleOut.radix']).toMatchObject({ confidence: 'vendor', note: 'of 96-port switches' });
    expect(rec.provenance['layers.cabinet.npus']).toMatchObject({ confidence: 'vendor', note: '每柜 48 卡' });
    expect(parseWorksheet(text).kind).toBe('topology');
  });

  it('lists what it cannot place instead of guessing', () => {
    const c = (field: string, value_text: string, quote: string, extra: Partial<EvidenceCard> = {}): EvidenceCard => ({ doc: 'd', loc: 'L1-1', field, value_text, unit_text: '', quote, model_confidence: 'high', ...extra });
    const text = draftWorksheet('topology', [
      c('superpod.npusPerNode', 'eight', 'eight NPUs'),
      c('superpod.computeRacks', '16', '16 racks'),
      c('superpod.computeRacks', '20', '20 racks'),
      c('layers.superpod.npus', '1 万', '1 万卡'),
      c('countOverrides.node.count', '16', '16 nodes'),
      c('unmapped', '2', '2 fans', { label: 'fans per node' }),
    ], { id: 't', sourceType: 'assumed' });
    expect(text).toContain("superpod.npusPerNode: value 'eight' is not a number");
    expect(text).toMatch(/superpod\.computeRacks: 20 .* conflicts with 16/);
    expect(text).toContain('layers.superpod.unit: not stated');
    expect(text).toContain('countOverrides.node: a count needs both');
    expect(text).toContain("unmapped 'fans per node'");
    expect(text).toContain('layers: no NPU count stated for cabinet, node');
    expect(text).not.toMatch(/&a\d|\*a\d/);
    const doc = parseWorksheetMarkdown(text);
    expect(doc.sections.find((s) => s.name === 'geometry')?.tables[0].rows).toEqual([{ field: 'computeRacks', value: '16', source: 'd L1-1', confidence: 'assumed', note: '16 racks' }]);
    expect(doc.sections.find((s) => s.name === 'layers')?.tables[0].rows).toEqual([{ layer: 'superpod', unit: '', npus: '10000' }]);
  });
});

const FIT_DOC = [
  '# 器件失效率（虚构数值）/ Device failure rates (fictional values)',
  '',
  '内存：DDR5 内存条失效率为 150 FIT（厂商预计）。',
  '电源：电源模块的 MTBF 为 40 万小时。',
  'Optics: the fictional 800G optical module has an AFR of 0.8 %/year.',
  'Fans: the fan tray fails at 2 ppb.',
].join('\n');
const FIT_PATTERNS: [string, RegExp, string, string][] = [
  ['unmapped', /DDR5 内存条失效率为 (\d+) FIT/, 'FIT', 'DDR5 内存条'],
  ['unmapped', /电源模块的 MTBF 为 (40 万)小时/, '小时', '电源模块'],
  ['unmapped', /AFR of (0\.8) %\/year/, '%/year', '800G optical module'],
  ['unmapped', /fails at (2) ppb/, 'ppb', 'fan tray'],
];

describe('end to end: device failure rates → draft device table', () => {
  it('maps units by the lexicon, converts nothing but a percent AFR, and lists an unknown unit', async () => {
    const r = await extractDocuments({ docs: [{ name: 'fit.md', text: FIT_DOC }], kind: 'device-fit', adapter: mockAdapter(regexModel(FIT_PATTERNS)) });
    expect(r.accepted.map((c) => c.label)).toEqual(['DDR5 内存条', '电源模块', '800G optical module', 'fan tray']);
    const text = draftWorksheet('device-fit', r.accepted, { id: 'internal-fit-synth', sourceType: 'prediction', source: 'fictional catalog rev A' });
    const t = worksheetToDeviceTable(parseWorksheetMarkdown(text));
    expect(t.id).toBe('internal-fit-synth');
    expect(t.source).toBe('fictional catalog rev A');
    expect(t.rows.map((x) => [x.device, x.value, x.unit, x.sourceType, x.loc])).toEqual([
      ['DDR5 内存条', 150, 'FIT', 'prediction', 'L1-6'],
      ['电源模块', 400000, 'mtbf_h', 'prediction', 'L1-6'],
      ['800G optical module', 0.008, 'afr', 'prediction', 'L1-6'],
    ]);
    expect(t.rows[0]).toMatchObject({ source: 'fit.md L1-6', note: 'DDR5 内存条失效率为 150 FIT' });
    expect(t.rows[2].note).toContain('0.8 % → 0.008');
    expect(text).toMatch(/## notes[\s\S]*fan tray: unit 'ppb' not recognised/);
    expect(parseWorksheet(text).kind).toBe('device-fit');
  });
  it('unit lexicon', () => {
    const cases: [string, string | null][] = [
      ['FIT', 'FIT'], ['fits', 'FIT'], ['/10^6 h', 'per_1e6_h'], ['per million hours', 'per_1e6_h'], ['fpmh', 'per_1e6_h'], ['ppm/h', 'per_1e6_h'], ['/10⁶h', 'per_1e6_h'],
      ['/h', 'per_h'], ['per hour', 'per_h'], ['h', 'mtbf_h'], ['hours', 'mtbf_h'], ['MTBF', 'mtbf_h'], ['MTBF (h)', 'mtbf_h'], ['小时', 'mtbf_h'],
      ['%/year', 'afr'], ['AFR', 'afr'], ['per year', 'afr'], ['%/年', 'afr'], ['年', 'afr'], ['ppb', null], ['%', null], ['', null],
    ];
    for (const [u, want] of cases) expect([u, deviceRateUnit(u)]).toEqual([u, want]);
  });
});

describe('draft mechanisms worksheet', () => {
  it('writes a parameter delta over remap-latest-2026-10 that parses against the default set', () => {
    const c = (field: string, value_text: string, unit_text: string, quote: string): EvidenceCard => ({ doc: 'mech.md', loc: 'p.3', field, value_text, unit_text, quote, model_confidence: 'high' });
    const text = draftWorksheet('mechanisms', [
      c('parameters.D-HARD.coverage', '95', '%', '覆盖率 95%'),
      c('parameters.D-HARD.detectSeconds', '2', 'min', 'detected within 2 min'),
      c('parameters.R-REPLAY.success', '0.9', '', 'success 0.9'),
      c('parameters.R-REPLAY.successSeconds', '3', 'weeks', '3 weeks'),
      c('unmapped', '7', '', '7 things'),
    ], { id: 'internal-mech-synth', sourceType: 'field' });
    expect(text).toContain('base: remap-latest-2026-10');
    expect(text).toMatch(/## notes[\s\S]*time unit 'weeks' not recognised/);
    const set = worksheetToMechanismSet(parseWorksheetMarkdown(text), DEFAULT_MECHANISM_SET);
    expect(set.id).toBe('internal-mech-synth');
    expect(set.parameters['D-HARD']).toMatchObject({ coverage: 0.95, detectSeconds: 120 });
    expect(set.parameters['R-REPLAY']).toMatchObject({ success: 0.9 });
    expect(set.provenance['parameters.D-HARD.coverage']).toMatchObject({ source: 'mech.md p.3', confidence: 'derived', note: expect.stringContaining('95 % → 0.95') });
    expect(set.provenance['parameters.R-REPLAY.success']).toMatchObject({ confidence: 'measured', note: 'success 0.9' });
  });
});
