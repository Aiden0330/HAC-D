/** The delta recipe renders a bilingual page and a Markdown summary from a delta document, with and without a baseline. */
import { describe, it, expect } from 'vitest';
import { deltaHtml, deltaMarkdown } from '../src/index.mjs';

const row = (scale, aOp) => ({ scale, aOp, aOpDerated: aOp - 0.002, delivered: aOp - 0.004, mtbfHwH: 12.5, mttrS: 210.3, windowP: 0.93, verdict: 'supported', B: 40.2, k: 1.25, mechanisms: ['D-HARD', 'R-LINK-LOCAL'], levers: ['auto'], recommendedAop: aOp + 0.004, recommendedAopDerated: aOp + 0.003, recommendedWindowP: 0.98, effort: 7 });
const delta = {
  version: 'hacd-delta-1', generated: '2026-10-22', target: 0.985, scales: [10000, 100000], trials: 20, seed: 1,
  before: { record: { id: 'native950', name: { zh: '原生 950', en: 'native 950' } }, set: { id: 'remap-latest-2026-10' }, rates: { id: 'remap-per-card-2026-10-09', basis: 'per-card' } },
  after: { record: { id: 'internal-950', name: { zh: '内部 950', en: 'internal 950' } }, set: { id: 'remap-latest-2026-10' }, rates: { id: 'internal-fit-2026q4', basis: 'per-unit' } },
  changes: {
    record: [{ path: 'superpod.rackSwitches', kind: 'added', after: 80, source: 'design note | DR-31', confidence: 'vendor' }, { path: 'id', kind: 'changed', before: 'native950', after: 'internal-950' }],
    rates: [{ class: 'DDR-hard', unit: 'node', before: 266.7, after: 130, ratio: 0.4875, confidence: 'derived', source: 'FIT-DB', derivation: '30 FIT × 8 × 0.5 + …' }],
    set: [],
  },
  kpi: { before: [row(10000, 0.981), row(100000, 0.962)], after: [row(10000, 0.984), row(100000, 0.97)], delta: [{ scale: 10000, dAop: 0.003, dAopDerated: 0.003, dDelivered: 0.003, mtbfRatio: 1.4, mttrRatio: 1, dK: 0.1, mechanismsAdded: [], mechanismsRemoved: ['R-LINK-LOCAL'], leversAdded: [], leversRemoved: [], dEffort: -3 }, { scale: 100000, dAop: 0.008, dAopDerated: 0.008, dDelivered: 0.008, mtbfRatio: 1.4, mttrRatio: 1, dK: 0.2, mechanismsAdded: ['C-LOSSLESS'], mechanismsRemoved: [], leversAdded: ['manual'], leversRemoved: [], dEffort: 2 }] },
  issues: [{ level: 'warning', code: 'implausible', path: 'rates.DDR-hard.fit', message: { zh: '偏离单元库', en: 'far from the unit library value' } }],
  extensionRequests: [{ version: 'hacd-extension-request-1', id: 'unit-npo', kind: 'unit', title: { zh: '新单元', en: 'New unit kind: npo-module' }, summary: { zh: '…', en: 'needs a unit-library entry' }, payload: {}, evidence: [], source: 'ws', requestedAt: '2026-10-22' }],
  notes: ['normalised from device table internal-fit-2026q4 through mapping map-v1'],
};

describe('delta recipe', () => {
  it('renders both languages with the KPI rows, changes, issues and requests', () => {
    const html = deltaHtml({ delta, provenance: { command: 'hacd ingest diff --record internal-950', engine: { version: '0.5.0' } } });
    for (const s of ['HAC-D input change review', 'HAC-D 输入变更评审', 'superpod.rackSwitches', 'DDR-hard', 'design note \\| DR-31'.replace('\\', ''), 'far from the unit library value', 'New unit kind: npo-module', 'hacd ingest diff --record internal-950', '98.400 %', '−R-LINK-LOCAL', '+C-LOSSLESS', 'data-lang="zh"']) expect(html).toContain(s);
    expect(html.match(/<section class="page">/g)?.length).toBe(6);
  });
  it('renders a new record without a baseline', () => {
    const d = { ...delta, before: {}, kpi: { before: null, after: delta.kpi.after, delta: null } };
    const html = deltaHtml({ delta: d });
    expect(html).toContain('no baseline (a new record)');
    expect(html).not.toContain('· before');
  });
  it('writes the Markdown summary in either language and escapes pipes', () => {
    const md = deltaMarkdown(delta, 'en');
    expect(md).toContain('# HAC-D input change review — internal 950');
    expect(md).toContain('| `DDR-hard` | node | 266.7 | 130 | × 1.4'.slice(0, 20));
    expect(md).toContain('design note \\| DR-31');
    expect(deltaMarkdown(delta, 'zh')).toContain('## 结果');
  });
  it('rejects a document of another version or shape', () => {
    expect(() => deltaHtml({ delta: { ...delta, version: 'x' } })).toThrow(/unsupported version/);
    expect(() => deltaMarkdown({ ...delta, kpi: { ...delta.kpi, after: [] } })).toThrow(/one row per scale/);
  });
});
