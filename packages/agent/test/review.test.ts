/**
 * v6 extraction worker (PLAN_V6 §5.6): the review queue states the run summary and lists disputed, rejected, unmapped and
 * low-confidence cards with pipes escaped, bilingual by default and in one language on request.
 */
import { describe, it, expect } from 'vitest';
import type { EvidenceCard } from '@hac-d/core';
import { reviewMarkdown } from '../src/index.js';

const c = (field: string, value_text: string, quote: string, extra: Partial<EvidenceCard> = {}): EvidenceCard =>
  ({ doc: 'a.md', loc: 'L3-4', field, value_text, unit_text: '', quote, model_confidence: 'high', ...extra });
const base = {
  kind: 'topology' as const,
  accepted: [
    c('superpod.npusPerNode', '8', '8 NPUs | per node'),
    c('unmapped', '2', '2 fans', { label: 'fans|tray', model_confidence: 'low' }),
    c('superpod.computeRacks', '16', '16 racks', { loc: 'L1-1' }),
    c('superpod.computeRacks', '20', '20 racks', { loc: 'L9-9' }),
  ],
  disputed: [{ key: 'superpod.commRacks', a: c('superpod.commRacks', '4', '4 | comm'), b: c('superpod.commRacks', '6', '6 comm'), reason: 'value-differs' as const }],
  rejected: [{ card: c('superpod.l2Ports', '48', '48 ports'), chunk: 'a.md#0', reason: 'quote-not-in-chunk' }],
  chunks: 3, calls: 6, model: 'mock-7b',
  log: [{ ts: 't', chunk: 'a.md#0', pass: 1, model: 'mock-7b', promptSha256: 'f'.repeat(64), durationMs: 1, cards: 1, rejected: 0, error: 'adapter: boom | bang' }],
};

describe('reviewMarkdown', () => {
  it('summarises the run and escapes pipes', () => {
    const md = reviewMarkdown(base);
    expect(md).toContain('## 运行摘要 / Run summary');
    for (const row of ['| 分块 / chunks | 3 |', '| 模型调用 / model calls | 6 |', '| 模型 / model | mock-7b |', '| 接受 / accepted | 4 |', '| 争议 / disputed | 1 |', '| 拒绝 / rejected | 1 |', '| 出错调用 / failed calls | 1 |', '| 文档 / documents | 1: a.md |']) expect(md).toContain(row);
    expect(md).toContain('| superpod.commRacks | a.md L3-4 | 4 | “4 \\| comm” | 6 | “6 comm” | value-differs |');
    expect(md).toContain('| superpod.l2Ports | 48 | quote-not-in-chunk | a.md#0 |');
    expect(md).toContain('| fans\\|tray | 2 |  | 2 fans | a.md L3-4 |');
    expect(md).toContain('| unmapped: fans\\|tray | 2 |  | 2 fans | a.md L3-4 | low |');
    expect(md).toMatch(/\| superpod\.computeRacks \| 16 \| 16 racks \| a\.md L1-1 \|\n\| superpod\.computeRacks \| 20 \|/);
    expect(md).toContain('adapter: boom \\| bang');
    expect(md).not.toContain('8 NPUs | per node');
    for (const line of md.split('\n').filter((l) => l.startsWith('| '))) {
      const cells = line.replace(/\\\|/g, '').split('|').length;
      expect(cells).toBeGreaterThan(2);
    }
  });
  it('one language on request, and "none" for empty queues', () => {
    const empty = { ...base, accepted: [], disputed: [], rejected: [], log: [] };
    const en = reviewMarkdown(empty, 'en');
    expect(en).toContain('## Run summary');
    expect(en).not.toContain('运行摘要');
    expect(en.match(/^None\.$/gm)?.length).toBe(6);
    const zh = reviewMarkdown(empty, 'zh');
    expect(zh).toContain('## 争议（两遍不一致）');
    expect(zh).not.toContain('Run summary');
  });
});
