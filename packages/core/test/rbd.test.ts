import { describe, it, expect } from 'vitest';
import { evaluate, importance, cutSets, type Block } from '../src/rbd/index.js';
import { kOfNRepairable } from '../src/ctmc/index.js';

const leaf = (id: string, lambda: number, mttr: number, count = 1): Block => ({ kind: 'leaf', id, lambda, mttr, count });

describe('RBD evaluation', () => {
  it('series: availability multiplies, equivalent rates add', () => {
    const r = evaluate({ kind: 'series', id: 's', children: [leaf('a', 0.01, 2), leaf('b', 0.02, 5)] });
    const Aa = 1 / (1 + 0.02);
    const Ab = 1 / (1 + 0.1);
    expect(r.availability).toBeCloseTo(Aa * Ab, 12);
    expect(r.equivalentFailureRate).toBeCloseTo(0.03, 12);
    expect(r.mttfFromNew).toBeCloseTo(1 / 0.03, 9);
    expect(r.failureFrequency).toBeCloseTo(Aa * Ab * 0.03, 12);
  });
  it('leaf with count: n identical units in series (1/N law)', () => {
    const r = evaluate(leaf('gpu', 1 / 50680, 1, 16384));
    expect(r.mttfFromNew * 60).toBeCloseTo(185.6, 0);
    expect(r.availability).toBeCloseTo(Math.pow(1 / (1 + 1 / 50680), 16384), 12);
  });
  it('parallel of two identical repairable units: A = 1 − u², MTTF = (3λ+μ)/(2λ²)', () => {
    const lam = 0.01;
    const mttr = 10;
    const r = evaluate({ kind: 'parallel', id: 'p', children: [leaf('a', lam, mttr), leaf('b', lam, mttr)] });
    const u = (lam * mttr) / (1 + lam * mttr);
    expect(r.availability).toBeCloseTo(1 - u * u, 12);
    expect(r.mttfFromNew).toBeCloseTo((3 * lam + 1 / mttr) / (2 * lam * lam), 6);
    expect(r.failureFrequency).toBeCloseTo(2 * (1 - u) * lam * u, 12);
  });
  it('k-of-n block matches the CTMC builder (hot-spare job, survey Fig. 4-1b)', () => {
    const lam = 11.6e-6;
    const r = evaluate({ kind: 'kofn', id: 'k', n: 1032, k: 1024, unit: leaf('gpu', lam, 24) });
    const direct = kOfNRepairable(1032, 1024, lam, 1 / 24);
    expect(r.availability).toBeCloseTo(direct.availability, 12);
    expect(r.mttfFromNew / direct.mttfFromNew).toBeCloseTo(1, 6);
    expect(r.mttfFromNew).toBeGreaterThan(1 / (1024 * lam));
  });
  it('nested: series of k-of-n GPU block and infrastructure leaves (worked example 2 shape)', () => {
    const tree: Block = {
      kind: 'series',
      id: 'job',
      children: [
        { kind: 'kofn', id: 'gpus', n: 1032, k: 1024, unit: leaf('gpu', 11.6e-6, 24) },
        leaf('nic', 2e-6, 24, 1032),
        leaf('host', 5e-6, 24, 129),
        leaf('leaf-switch', 1e-6, 4, 32),
        { kind: 'parallel', id: 'ckpt-storage', children: [leaf('fs-a', 100e-6, 8), leaf('fs-b', 100e-6, 8)] },
        { kind: 'parallel', id: 'power-2n', children: [leaf('feed-a', 10e-6, 4), leaf('feed-b', 10e-6, 4)] },
        { kind: 'kofn', id: 'cdu-n+1', n: 3, k: 2, unit: leaf('cdu', 20e-6, 8) },
      ],
    };
    const r = evaluate(tree);
    expect(r.availability).toBeGreaterThan(0.9);
    expect(r.availability).toBeLessThan(1);
    expect(r.children.length).toBe(7);
    const imp = importance(tree);
    expect(imp[0].birnbaum).toBeGreaterThanOrEqual(imp[imp.length - 1].birnbaum);
    const nic = imp.find((x) => x.id === 'nic')!;
    const fsA = imp.find((x) => x.id === 'fs-a')!;
    expect(nic.fusselVesely).toBeGreaterThan(fsA.fusselVesely);
  });
  it('degraded leaf lowers capacity below availability', () => {
    const r = evaluate({ kind: 'leaf', id: 'g', lambda: 1e-4, mttr: 1, count: 100, degraded: { lambda: 1e-3, durationH: 1.2, capacity: 0.33 } });
    expect(r.capacity).toBeLessThan(r.availability);
    expect(r.capacityGivenUp).toBeLessThan(1);
  });
});

describe('importance and cut sets', () => {
  it('Birnbaum of a series component equals the product of the others', () => {
    const tree: Block = { kind: 'series', id: 's', children: [leaf('a', 0.01, 2), leaf('b', 0.02, 5)] };
    const imp = importance(tree);
    const a = imp.find((x) => x.id === 'a')!;
    expect(a.birnbaum).toBeCloseTo(1 / (1 + 0.1), 12);
    expect(a.raw).toBeGreaterThan(1);
    expect(a.rrw).toBeGreaterThan(1);
  });
  it('minimal cut sets of series(parallel(a,b), c) are {a,b} and {c}', () => {
    const tree: Block = {
      kind: 'series',
      id: 's',
      children: [{ kind: 'parallel', id: 'p', children: [leaf('a', 0.01, 1), leaf('b', 0.01, 1)] }, leaf('c', 0.001, 1)],
    };
    const cs = cutSets(tree);
    const asStrings = cs.cutSets.map((m) => [...m.entries()].map(([k, v]) => `${k}:${v}`).sort().join(','));
    expect(asStrings).toContain('a:1,b:1');
    expect(asStrings).toContain('c:1');
    expect(cs.cutSets.length).toBe(2);
    expect(cs.truncated).toBe(false);
    const exact = 1 - evaluate(tree).availability;
    expect(cs.topEventApprox).toBeCloseTo(exact, 3);
  });
  it('k-of-n cut sets carry multiplicity n−k+1', () => {
    const tree: Block = { kind: 'kofn', id: 'k', n: 5, k: 3, unit: leaf('u', 0.01, 1) };
    const cs = cutSets(tree);
    expect(cs.cutSets[0].get('u')).toBe(3);
  });
});
