/**
 * v6 extraction worker (PLAN_V6 §6): the chunker is deterministic, labels pages and line ranges, carries an overlap and splits a
 * long paragraph hard; the answer parser accepts exactly `{cards:[...]}` or an array (fenced or wrapped in prose) and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { chunkDocument, parseCardsText } from '../src/index.js';

const doc = {
  name: 'design.md',
  text: [
    '# Title', '', 'First paragraph about the pod. It has several sentences, and some more words here.', '',
    '## 2 Section', 'Second paragraph line one.', 'Second paragraph line two with more text to fill the chunk.', '',
    '3.1 Numbered heading', 'Third paragraph: the last facts of the document are here, with a tail.',
  ].join('\n'),
};

describe('chunkDocument', () => {
  it('is deterministic, ids are doc#index, locs are line ranges and every chunk is an exact slice', () => {
    const a = chunkDocument(doc, { chunkChars: 120, overlapChars: 30 }), b = chunkDocument(doc, { chunkChars: 120, overlapChars: 30 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
    a.forEach((c, i) => {
      expect(c.id).toBe(`design.md#${i}`);
      expect(c.index).toBe(i);
      expect(c.doc).toBe('design.md');
      expect(c.loc).toMatch(/^L\d+-\d+$/);
      expect(doc.text.includes(c.text)).toBe(true);
    });
    expect(a[0].loc).toBe('L1-3');
    const last = a[a.length - 1];
    expect(last.loc.endsWith(`-${doc.text.split('\n').length}`)).toBe(true);
  });
  it('carries at most overlapChars of the previous chunk into the next one', () => {
    const cs = chunkDocument(doc, { chunkChars: 120, overlapChars: 30 });
    for (let i = 1; i < cs.length; i++) {
      let n = 0;
      for (let k = 1; k <= Math.min(cs[i].text.length, cs[i - 1].text.length); k++) if (cs[i - 1].text.endsWith(cs[i].text.slice(0, k))) n = k;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(30);
    }
    const none = chunkDocument(doc, { chunkChars: 120, overlapChars: 0 });
    expect(none.map((c) => c.text).join('')).not.toContain('\n\n\n');
    expect(none.every((c, i) => i === 0 || !none[i - 1].text.includes(c.text.slice(0, 15)))).toBe(true);
  });
  it('labels pages p.<n> when the document has form feeds', () => {
    const cs = chunkDocument({ name: 'x.pdf', text: 'page one text\fpage two text\n\nmore on two\fpage three' }, { chunkChars: 1000 });
    expect(cs.map((c) => [c.id, c.loc])).toEqual([['x.pdf#0', 'p.1'], ['x.pdf#1', 'p.2'], ['x.pdf#2', 'p.3']]);
    expect(cs[1].text).toBe('page two text\n\nmore on two');
  });
  it('splits a paragraph longer than chunkChars hard, preferring a boundary', () => {
    const long = 'a'.repeat(1000);
    const cs = chunkDocument({ name: 'l', text: long }, { chunkChars: 300, overlapChars: 0 });
    expect(cs.map((c) => c.text.length)).toEqual([300, 300, 300, 100]);
    expect(cs.map((c) => c.text).join('')).toBe(long);
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const ws = chunkDocument({ name: 'w', text: words }, { chunkChars: 100, overlapChars: 0 });
    expect(ws.every((c) => c.text.length <= 100)).toBe(true);
    expect(ws.slice(0, -1).every((c) => /\s$/.test(c.text) || /word\d+$/.test(c.text))).toBe(true);
    expect(ws.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim()).toBe(words);
  });
  it('returns no chunk for an empty document', () => {
    expect(chunkDocument({ name: 'e', text: '  \n\n ' })).toEqual([]);
  });
});

describe('parseCardsText', () => {
  const c = { doc: 'd', field: 'superpod.npusPerNode', value_text: '8', quote: '8 NPUs' };
  it('accepts an object, a bare array, a fence and prose around JSON', () => {
    expect(parseCardsText(JSON.stringify({ cards: [c] }))).toEqual([c]);
    expect(parseCardsText(JSON.stringify([c]))).toEqual([c]);
    expect(parseCardsText('```json\n' + JSON.stringify({ cards: [c] }) + '\n```')).toEqual([c]);
    expect(parseCardsText('Here you are:\n```\n[]\n```\nDone.')).toEqual([]);
    expect(parseCardsText(`Sure! The cards are ${JSON.stringify({ cards: [c] })} — hope this helps {name}.`)).toEqual([c]);
    expect(parseCardsText('note {not json} then {"cards": []}')).toEqual([]);
    expect(parseCardsText('{"cards":[{"doc":"d","field":"f","value_text":"a } b","quote":"x ] y"}]}')).toHaveLength(1);
  });
  it('throws on anything else', () => {
    expect(() => parseCardsText('no json here')).toThrow(/no JSON cards in model output/);
    expect(() => parseCardsText('{"items": []}')).toThrow(/no JSON cards/);
    expect(() => parseCardsText('{"cards": [1, 2,]}')).toThrow(/no JSON cards/);
    expect(() => parseCardsText('{"cards": [{"a": [1]},]}')).toThrow(/no JSON cards/);
    expect(() => parseCardsText("{'cards': []}")).toThrow(/no JSON cards/);
    expect(() => parseCardsText('{"cards": [')).toThrow(/no JSON cards/);
    expect(() => parseCardsText('42')).toThrow(/no JSON cards/);
  });
});
