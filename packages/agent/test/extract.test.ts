/**
 * v6 extraction worker (PLAN_V6 §5.3, §6): grounding drops invented cards, two-pass agreement sends one-sided fields to review,
 * the chunk's doc and loc overwrite the model's, every call is logged with its prompt hash, a malformed answer is retried, and an
 * adapter error on one chunk is logged without stopping the run. No network: mock adapters only.
 */
import { describe, it, expect } from 'vitest';
import { extractDocuments, mockAdapter, buildPrompts, chunkDocument, adapterFromSpec, type CompletionRequest, type LogEntry } from '../src/index.js';

const card = (field: string, value_text: string, quote: string, extra: Record<string, string> = {}) =>
  ({ doc: 'wrong.pdf', loc: 'p.99', field, value_text, unit_text: '', quote, model_confidence: 'high', ...extra });
const isPass2 = (req: CompletionRequest) => req.system.startsWith('Task: turn a passage');
const fixed = () => '2026-10-22T00:00:00.000Z';

describe('extractDocuments — grounding and agreement', () => {
  it('accepts agreed grounded cards, rejects invented ones and disputes one-sided fields', async () => {
    const text = 'The pod has 16 compute racks and 4 comm racks.';
    const seen: LogEntry[] = [];
    const adapter = mockAdapter((req) => JSON.stringify({
      cards: isPass2(req)
        ? [card('superpod.computeRacks', '16', '16 compute racks'), card('superpod.npusPerNode', '8', '8 NPUs per node'), card('superpod.commRacks', '4', '4 comm racks')]
        : [card('superpod.computeRacks', '16', '16 compute racks'), card('superpod.commRacks', '6', '6 comm racks')],
    }), 'mock-7b');
    const r = await extractDocuments({ docs: [{ name: 'design.md', text }], kind: 'topology', adapter, now: fixed, log: (e) => seen.push(e) });
    expect(r.chunks).toBe(1);
    expect(r.calls).toBe(2);
    expect(r.model).toBe('mock-7b');
    expect(r.accepted).toEqual([{ doc: 'design.md', loc: 'L1-1', field: 'superpod.computeRacks', value_text: '16', unit_text: '', quote: '16 compute racks', model_confidence: 'high' }]);
    expect(r.rejected.map((x) => [x.reason, (x.card as { field: string }).field, x.chunk])).toEqual([
      ['quote-not-in-chunk', 'superpod.commRacks', 'design.md#0'],
      ['quote-not-in-chunk', 'superpod.npusPerNode', 'design.md#0'],
    ]);
    expect(r.rejected.every((x) => (x.card as { doc: string }).doc === 'design.md' && (x.card as { loc: string }).loc === 'L1-1')).toBe(true);
    expect(r.disputed).toHaveLength(1);
    expect(r.disputed[0]).toMatchObject({ key: 'superpod.commRacks', reason: 'only-in-b', b: { value_text: '4', doc: 'design.md', loc: 'L1-1' } });
    expect(r.log).toHaveLength(2);
    expect(seen).toEqual(r.log);
    expect(r.log.map((e) => [e.chunk, e.pass, e.model, e.ts, e.cards, e.rejected])).toEqual([
      ['design.md#0', 1, 'mock-7b', fixed(), 1, 1],
      ['design.md#0', 2, 'mock-7b', fixed(), 2, 1],
    ]);
    for (const e of r.log) expect(e.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.log[0].promptSha256).not.toBe(r.log[1].promptSha256);
    expect(r.reviewMarkdown).toContain('superpod.commRacks');
  });

  it('rejects invalid cards, unknown fields, unmapped cards without a label and values outside the quote', async () => {
    const text = 'Each node has 8 NPUs. Power supply: 2 units.';
    const adapter = mockAdapter(() => JSON.stringify({ cards: [
      { field: 'superpod.npusPerNode', quote: '8 NPUs' },
      card('superpod.npusPerNode', '8', '8 NPUs'),
      card('superpod.bogus', '2', '2 units'),
      card('unmapped', '2', '2 units'),
      card('unmapped', '2', 'Power supply: 2 units', { label: 'power supplies' }),
      card('superpod.cpusPerNode', '4', 'Each node has 8 NPUs'),
      'not a card',
    ] }));
    const r = await extractDocuments({ docs: [{ name: 'd', text }], kind: 'topology', adapter, passes: 1 });
    expect(r.accepted.map((c) => c.field)).toEqual(['superpod.npusPerNode', 'unmapped']);
    expect(r.rejected.map((x) => x.reason.split(':')[0])).toEqual(['invalid-card', 'unknown-field', 'unmapped-without-label', 'value-not-in-quote', 'invalid-card']);
  });

  it('agreement is per field: different values or units go to review, duplicates across overlapping chunks are removed', async () => {
    const text = ['Each node has 8 NPUs.', '', 'Racks: 12 compute racks.', '', 'Again: each node has 8 NPUs.'].join('\n');
    const adapter = mockAdapter((req) => {
      const cards = [];
      if (/each node has 8 NPUs/i.test(req.user)) cards.push(card('superpod.npusPerNode', '8', 'node has 8 NPUs'));
      if (req.user.includes('12 compute racks')) cards.push(card('superpod.computeRacks', '12', '12 compute racks', { unit_text: isPass2(req) ? 'racks' : '' }));
      return JSON.stringify({ cards });
    });
    const r = await extractDocuments({ docs: [{ name: 'd', text }], kind: 'topology', adapter, chunkChars: 30, overlapChars: 0 });
    expect(r.chunks).toBe(3);
    expect(r.accepted.map((c) => [c.field, c.loc])).toEqual([['superpod.npusPerNode', 'L1-1']]);
    expect(r.disputed.map((d) => [d.key, d.reason])).toEqual([['superpod.computeRacks', 'unit-differs']]);
  });
});

describe('extractDocuments — one pass, retries and adapter errors', () => {
  it('passes = 1 accepts grounded cards without agreement; an adapter error on one chunk is logged and the run continues', async () => {
    const adapter = mockAdapter((req) => {
      if (req.user.includes('BOOM')) throw new Error('server overloaded');
      return JSON.stringify([card('superpod.commRacks', '4', '4 comm racks')]);
    });
    const progress: string[] = [];
    const r = await extractDocuments({
      docs: [{ name: 'a.md', text: 'BOOM: this chunk fails.' }, { name: 'b.md', text: 'The pod has 4 comm racks.' }],
      kind: 'topology', adapter, passes: 1, onProgress: (m) => progress.push(m),
    });
    expect(r.calls).toBe(2);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toMatchObject({ doc: 'b.md', field: 'superpod.commRacks', value_text: '4' });
    expect(r.disputed).toEqual([]);
    expect(r.log.map((e) => [e.chunk, e.error])).toEqual([['a.md#0', 'adapter: server overloaded'], ['b.md#0', undefined]]);
    expect(progress.some((m) => m.includes('skipped'))).toBe(true);
    expect(r.reviewMarkdown).toContain('server overloaded');
  });

  it('with two passes an adapter error skips the rest of the chunk only', async () => {
    let n = 0;
    const adapter = mockAdapter((req) => { n++; if (n === 1) throw new Error('timeout'); return JSON.stringify({ cards: req.user.includes('4 comm racks') ? [card('superpod.commRacks', '4', '4 comm racks')] : [] }); });
    const r = await extractDocuments({ docs: [{ name: 'a', text: 'first chunk' }, { name: 'b', text: 'The pod has 4 comm racks.' }], kind: 'topology', adapter });
    expect(r.calls).toBe(3);
    expect(r.accepted.map((c) => c.doc)).toEqual(['b']);
  });

  it('retries a malformed answer once with a correction line, then gives up on that pass', async () => {
    const users: string[] = [];
    let n = 0;
    const adapter = mockAdapter((req) => { users.push(req.user); n++; return n === 1 ? 'Sorry, here: {cards: [oops]}' : '```json\n{"cards":[]}\n```'; });
    const r = await extractDocuments({ docs: [{ name: 'a', text: 'some text' }], kind: 'topology', adapter, passes: 1 });
    expect(r.calls).toBe(2);
    expect(r.log[0].error).toMatch(/^parse: no JSON cards in model output/);
    expect(r.log[1].error).toBeUndefined();
    expect(users[1].startsWith(users[0])).toBe(true);
    expect(users[1]).toContain('previous answer could not be used');
    expect(r.log[0].promptSha256).not.toBe(r.log[1].promptSha256);

    const bad = mockAdapter(() => 'nothing');
    const r2 = await extractDocuments({ docs: [{ name: 'a', text: 'some text' }], kind: 'topology', adapter: bad, passes: 1, retries: 2 });
    expect(r2.calls).toBe(3);
    expect(r2.log.every((e) => e.error?.startsWith('parse:'))).toBe(true);
    expect(r2.accepted).toEqual([]);
  });

  it('retries when every card of an answer is invalid', async () => {
    let n = 0;
    const adapter = mockAdapter(() => (++n === 1 ? JSON.stringify({ cards: [{ field: 'x' }] }) : JSON.stringify({ cards: [card('superpod.commRacks', '4', '4 comm racks')] })));
    const r = await extractDocuments({ docs: [{ name: 'a', text: 'The pod has 4 comm racks.' }], kind: 'topology', adapter, passes: 1 });
    expect(r.calls).toBe(2);
    expect(r.log[0].error).toMatch(/^validation/);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
  });

  it("the 'none' adapter makes every call fail without aborting the run", async () => {
    const r = await extractDocuments({ docs: [{ name: 'a', text: 'x' }, { name: 'b', text: 'y' }], kind: 'device-fit', adapter: adapterFromSpec({ provider: 'none' }) });
    expect(r.calls).toBe(2);
    expect(r.log.every((e) => /no model configured/.test(e.error ?? ''))).toBe(true);
  });
});

describe('buildPrompts', () => {
  const [chunk] = chunkDocument({ name: 'doc.md', text: '每柜 64 卡。' });
  it('variant 2 differs materially from variant 1 and both carry the rules, fields and two examples', () => {
    for (const kind of ['topology', 'device-fit', 'mechanisms'] as const) {
      const a = buildPrompts(kind, chunk, 1), b = buildPrompts(kind, chunk, 2);
      expect(a.system).not.toBe(b.system);
      expect(a.user).not.toBe(b.user);
      expect(b.system).toContain('order their facts appear');
      expect(b.user).toMatch(/Reminder: .*verbatim/);
      for (const p of [a, b]) {
        expect(p.system).toMatch(/No arithmetic/);
        expect(p.system).toMatch(/No unit conversion/);
        expect(p.system).toContain('Example 1 (');
        expect(p.system).toContain('Example 2 (');
        expect(p.user).toContain('每柜 64 卡。');
        expect(p.jsonSchema).toMatchObject({ type: 'object', required: ['cards'], properties: { cards: { type: 'array', items: { type: 'object' } } } });
        expect(JSON.stringify(p.jsonSchema)).not.toContain('"default"');
      }
    }
    const topo = buildPrompts('topology', chunk, 1).system;
    expect(topo).toContain('superpod.computeRacks');
    expect(topo).toContain('superpod.base (enum; one of:');
    expect(topo).toContain('16 个计算柜');
    expect(topo).not.toMatch(/^- scenarioId /m);
    const mech = buildPrompts('mechanisms', chunk, 1).system;
    expect(mech).toContain('parameters.D-HARD.coverage');
    expect(mech).not.toContain('verdicts.');
    expect(buildPrompts('device-fit', chunk, 1).system).toContain('"field": "unmapped"');
  });
});
