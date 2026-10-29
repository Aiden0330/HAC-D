/**
 * v5 report pipeline: identities of the new primitives on the built-in records, the pruning rule on the stored studies, and the
 * reproduction of the v4.4 data (docs/backup/ascend-allocation/{results,bom,mechanisms}.json) from the records through the core —
 * one architecture × scale block of results.json to 1e-9 (fixed seeds), the whole BOM document and the whole hierarchy table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { kpiForm, trainingOf } from '../src/budget/kpiForm.js';
import { chainSplit, mttrDecomposition, classChainSplits } from '../src/mttr/decompose.js';
import { byLayer, DEFAULT_LAYERS, unavailabilityByLayer, layerModel } from '../src/layers/index.js';
import { shapleyByLayer } from '../src/layers/shapley.js';
import { deratedOf, windowCheck, recommendPlan } from '../src/strategy/window.js';
import { requirement, requirementFromKpi } from '../src/strategy/requirement.js';
import { pruneByShapley, shapleyAtScale } from '../src/study/prune.js';
import { mechanismHierarchy, type StoredStudy } from '../src/study/hierarchy.js';
import { hierarchicalBudget, recordScenario, budgetFromRecords } from '../src/budget/index.js';
import { bomDocument, bomOfVariants } from '../src/budget/bom.js';
import { BUILTIN_TOPOLOGY_RECORDS, scenarioFromRecord } from '../src/records/topologyRecord.js';
import { DEFAULT_MECHANISM_SET, resolveMechanismSet } from '../src/records/mechanismSet.js';
import { DEFAULT_PLAYERS, applyMechanisms, stripMechanisms } from '../src/mechanisms/index.js';
import { topologyBom } from '../src/topology/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const backup = join(root, 'docs', 'backup', 'ascend-allocation');
const R = JSON.parse(readFileSync(join(backup, 'results.json'), 'utf8'));
const SET = DEFAULT_MECHANISM_SET, RS = resolveMechanismSet(SET);
const REC = BUILTIN_TOPOLOGY_RECORDS;

/**
 * fields the engine writes since the stored v4.4 data (additive, derived from stored values, so the stored block stays the
 * reference): `required.reachable` (v5.5, fifth review D6) = B > 0 — checked against the stored B instead of flagged as extra;
 * v5.8 (method & code review 2026-10-29) `optimal.solver` — exact enumeration up to its limit, the greedy descent beyond — and
 * `recommended.cause` — 'ceiling' when the stored perfect-hardware ceiling misses the target (a feasible block has none)
 */
const ceilingMisses = (p: Record<string, unknown>) => { const c = p.ceiling as { nominal: number; derated: number } | null; return !!c && (c.nominal < R.target || c.derated < R.target); };
const ADDED_SINCE_STORED: Record<string, (a: unknown, parent: Record<string, unknown>) => boolean> = {
  '.required.reachable': (a, parent) => a === ((parent.B as number) > 0),
  '.optimal.solver': (a) => { const x = a as { mode: string; moves: number; exactUpTo: number }; return x.mode === (x.moves <= x.exactUpTo ? 'exact' : 'greedy') && x.exactUpTo === (R.metric === 'aOp' ? 10 : 6); },
  '.recommended.cause': (a, parent) => parent.feasible === false && a === (ceilingMisses(parent) ? 'ceiling' : a),
};
/** deep comparison: numbers to 1e-9 relative, the rest exactly; returns the differences */
function diff(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (typeof b === 'number') { if (typeof a !== 'number') out.push(`${path}: ${a} vs ${b}`); else if (Math.abs(a - b) > 1e-9 * Math.max(1e-3, Math.abs(b))) out.push(`${path}: ${a} vs ${b}`); return out; }
  if (b === null || typeof b !== 'object') { if (a !== b) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); return out; }
  if (Array.isArray(b)) { if (!Array.isArray(a) || a.length !== b.length) out.push(`${path}: length`); else b.forEach((v, i) => diff(a[i], v, `${path}[${i}]`, out)); return out; }
  const A = (a ?? {}) as Record<string, unknown>, B = b as Record<string, unknown>;
  for (const k of Object.keys(B)) { if (!(k in A)) { out.push(`${path}.${k}: missing`); continue; } diff(A[k], B[k], `${path}.${k}`, out); }
  for (const k of Object.keys(A)) {
    if (k in B || A[k] === undefined) continue;
    const added = ADDED_SINCE_STORED[`${path}.${k}`];
    if (added) { if (!added(A[k], B)) out.push(`${path}.${k}: ${JSON.stringify(A[k])} does not follow from the stored block`); continue; }
    out.push(`${path}.${k}: extra`);
  }
  return out;
}
const json = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('v5 primitives: identities', () => {
  const s = scenarioFromRecord(REC.a3server, 10000);
  const t = trainingOf(s);
  it('kpiForm closes on the engine and keeps the event classes apart', () => {
    const k = kpiForm(s, t);
    expect(k.aOp).toBe(t.operationalAvailability);
    expect(Math.abs(1 / (1 + (k.sumLP + k.F) / 3600) - t.runningFraction)).toBeLessThan(1e-9);
    expect(Math.abs(k.aRun * (1 - k.phi) - k.aOp)).toBeLessThan(1e-12);
    expect(k.other.map((o) => o.id)).toEqual(['isolation', 'sdcDetected', 'falseAlarm']);
    expect(Math.abs(k.lamHw * k.mttrS - k.sumLP)).toBeLessThan(1e-9);
  });
  it('byLayer sums to the KPI form; every class sits on exactly one layer; U_ℓ sums to the hard share', () => {
    const x = byLayer(s, t);
    const lam = DEFAULT_LAYERS.reduce((a, l) => a + x.levels[l.id].lam, 0), c = DEFAULT_LAYERS.reduce((a, l) => a + x.levels[l.id].c, 0);
    expect(Math.abs(lam - x.k.lamHw)).toBeLessThan(1e-12);
    expect(Math.abs(c - x.k.sumLP)).toBeLessThan(1e-9);
    expect(DEFAULT_LAYERS.reduce((a, l) => a + x.levels[l.id].rows.length, 0)).toBe(t.chain.rows.length);
    const iso = DEFAULT_LAYERS.reduce((a, l) => a + x.levels[l.id].iso, 0), sdc = DEFAULT_LAYERS.reduce((a, l) => a + x.levels[l.id].sdc, 0);
    expect(Math.abs(iso - x.k.other[0].sPerH)).toBeLessThan(1e-9);
    expect(Math.abs(sdc - x.k.other[1].sPerH)).toBeLessThan(1e-9);
    const u = unavailabilityByLayer(x);
    expect(u.hard + u.other).toBeCloseTo(u.total, 9);
    expect(u.other).toBeGreaterThanOrEqual(-1e-9);
    // the a3server record's SuperPoD instance is the node (UB domain = one server)
    const m = layerModel(REC.a3server.layers);
    expect(m.instances(10000, topologyBom(s).counts).superpod).toBe(topologyBom(s).counts.nodes);
  });
  it('mttrDecomposition: every class split closes on its mean pause; the job split sums to MTTR; stages sum to the global attempt', () => {
    const d = mttrDecomposition(s, t), k = kpiForm(s, t);
    expect(Math.abs(d.mttrS - k.mttrS)).toBeLessThan(1e-9);
    expect(Math.abs(Object.values(d.contrib).reduce((a, b) => a + b, 0) - d.mttrS)).toBeLessThan(1e-9);
    expect(Math.abs(d.stages.startup + d.stages.read + d.stages.communication - (d.contrib.globalAuto ?? 0))).toBeLessThan(1e-9);
    expect(Math.abs(d.stages.manual - (d.contrib.globalManual ?? 0))).toBeLessThan(1e-12);
    expect(Math.abs(Object.values(d.probs).reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
    for (const c of classChainSplits(s, t)) expect(Math.abs(c.split.meanS - c.meanPauseS)).toBeLessThan(1e-9 * Math.max(1, c.meanPauseS));
    // a bare chain: everything ends in the global recovery
    const g = chainSplit(12.5, 180 + 0.01 * 7200, 180, {}, {});
    expect(g.probs.global).toBe(1);
    expect(g.contrib).toEqual({ detect: 12.5, globalAuto: 180, globalManual: 72 });
  });
  it('requirement: B and its two ends on the derated design', () => {
    const q = requirement(s, 0.985);
    const kD = kpiForm(deratedOf(s));
    expect(q.kpiDerated.aOp).toBe(kD.aOp);
    expect(q.B).toBeCloseTo(3600 * ((1 - kD.phi) / 0.985 - 1) - kD.F, 9);
    expect(q.reachable).toBe(true);
    expect(q.mtbfAtTodayMttrH! * q.B).toBeCloseTo(kD.mttrS, 9);
    expect(q.mttrAtTodayMtbfS).toBeCloseTo(q.B * kD.mtbfHwH, 9);
    expect(requirementFromKpi(kD, 0.985).B).toBe(q.B);
  });
  it('shapleyByLayer: exact values sum to A_op(all) − A_op(none) and the layer pauses removed sum to the total removed', () => {
    const bare = stripMechanisms(s, DEFAULT_PLAYERS);
    const sh = shapleyByLayer(bare, ['R-REPLAY', 'R-PROCESS', 'R-ELASTIC']);
    const sum = Object.values(sh.gains).reduce((a, g) => a + g.aOp, 0);
    expect(Math.abs(sum - (sh.all.aOp - sh.none.aOp))).toBeLessThan(1e-12);
    for (const id of sh.players) {
      const removed = Object.values(sh.gains[id].byLayer).reduce((a, b) => a + b, 0);
      expect(removed).toBeGreaterThan(0);
    }
    const totalRemoved = DEFAULT_LAYERS.reduce((a, l) => a + (sh.none.pause[l.id] - sh.all.pause[l.id]), 0);
    expect(Math.abs(sh.players.reduce((a, id) => a + Object.values(sh.gains[id].byLayer).reduce((x, y) => x + y, 0), 0) - totalRemoved)).toBeLessThan(1e-9);
    expect(sh.coalitions).toBe(8);
  });
});

describe('v5 pruning rule and hierarchy on the stored studies', () => {
  const archs = ['native950', 'ubl128', 'cm384', 'a3server'];
  const studies: Record<string, StoredStudy> = Object.fromEntries(archs.map((a) => [a, JSON.parse(readFileSync(join(root, 'docs', 'backup', 'arch-mechanism-shapley', `${a}.json`), 'utf8'))]));
  const MJ = JSON.parse(readFileSync(join(backup, 'mechanisms.json'), 'utf8'));
  it('pruneByShapley reproduces the 24 verdicts and the candidate list of mechanisms.json', () => {
    const ids = MJ.mechanisms.map((m: { id: string }) => m.id);
    // v5.6: the rule reads the set's metric (the effective goodput since 2026-10-29)
    const p = pruneByShapley(shapleyAtScale(studies, 500000), ids, { threshold: SET.prune.threshold, dominated: SET.prune.dominated, reference: SET.baseline, metric: SET.prune.metric ?? 'aOp' });
    expect(MJ.metric).toBe(SET.prune.metric ?? 'aOp');
    for (const m of MJ.mechanisms as { id: string; verdict: string }[]) expect(p.verdicts[m.id].verdict, m.id).toBe(m.verdict);
    expect(p.candidates).toEqual(MJ.candidates);
    expect([...p.candidates].sort()).toEqual([...SET.candidates].sort());
  });
  it('the threshold is inclusive and every branch is reachable', () => {
    const v = { a: { X: { aOp: 0.0015, delivered: 0 }, Y: { aOp: 0.001, delivered: 0.0015 }, Z: { aOp: 0.001, delivered: 0.001 }, W: { aOp: 0.01, delivered: 0.01 }, D: { aOp: 0.01, delivered: 0.01 } }, b: { X: { aOp: 0.002, delivered: 0 }, Y: { aOp: 0.01, delivered: 0.002 }, Z: { aOp: 0.1, delivered: 0.1 }, W: { aOp: 0.01, delivered: 0.01 }, D: { aOp: 0.01, delivered: 0.01 } } };
    const p = pruneByShapley(v, ['X', 'Y', 'Z', 'W', 'D', 'C'], { dominated: { D: 'W' }, reference: ['W'], appliable: (id) => id !== 'C' });
    expect(p.verdicts.X.verdict).toBe('candidate');
    expect(p.verdicts.Y.verdict).toBe('goodput');
    expect(p.verdicts.Z.verdict).toBe('pruned');
    expect(p.verdicts.W.verdict).toBe('reference');
    expect(p.verdicts.D.verdict).toBe('pruned');
    expect(p.verdicts.C.verdict).toBe('capability');
  });
  it('mechanismHierarchy reproduces mechanisms.json (date and source aside)', () => {
    const h = json(mechanismHierarchy(SET, studies, { permutations: 300 }));
    const { generated: _g, source: _s, ...a } = h; const { generated: _g2, source: _s2, ...b } = MJ; void _g; void _s; void _g2; void _s2;
    expect(diff(a, b)).toEqual([]);
  });
});

describe('v5 reproduction of the v4.4 data from the records', () => {
  it('the record scenarios under the default set equal the v4.4 scenarios (today\'s A_op per cell)', () => {
    for (const [arch, A] of Object.entries(R.archs as Record<string, { sizes: Record<string, { today: { aOp: number } }> }>)) for (const [n, z] of Object.entries(A.sizes)) {
      const s = recordScenario(REC[arch as keyof typeof REC], SET, Number(n));
      expect(trainingOf(s).operationalAvailability, `${arch} ${n}`).toBe(z.today.aOp);
    }
  });
  it('bomDocument reproduces bom.json (date aside)', () => {
    const b = json(bomDocument(Object.values(REC), 100000));
    const B = JSON.parse(readFileSync(join(backup, 'bom.json'), 'utf8'));
    const { generated: _a, ...x } = b; const { generated: _b, ...y } = B; void _a; void _b;
    expect(diff(x, y)).toEqual([]);
    expect(bomOfVariants(REC.ubl128, 100000).map((d) => d.id)).toEqual(['ubl128-main', 'ubl128-twoPlane', 'ubl128-hacd', 'ubl128-attach', 'ubl128-oversub2']);
  });
  it('hierarchicalBudget reproduces one results.json block to 1e-9 (native 950 at 500k; fixed seeds)', () => {
    const arch = 'native950', n = 500000;
    const got = json(hierarchicalBudget(recordScenario(REC[arch], SET, n), { target: R.target, candidates: RS.candidates, parameters: RS.parameters, levers: RS.levers, reference: RS.baseline, derate: RS.derate, trials: R.trials, seed: 1, layerSpec: REC[arch].layers }));
    expect(diff(got, R.archs[arch].sizes[String(n)])).toEqual([]);
  }, 120000);
  it('the window rule escalates only by adding moves and reports the binding side', () => {
    const z = R.archs.cm384.sizes['200000'];
    expect(z.recommended.escalated).toBe(true);
    for (let i = 1; i < z.recommended.tried.length; i++) {
      const a = z.recommended.tried[i - 1], b = z.recommended.tried[i];
      expect(a.mechanisms.every((m: string) => b.mechanisms.includes(m)) && a.levers.every((l: string) => b.levers.includes(l))).toBe(true);
    }
    // v5.6: 'none' when no move set reaches the target (the all-moves design at k = 1, feasible false)
    expect(['window', 'mean', 'none']).toContain(z.recommended.binding);
    if (z.recommended.binding === 'none') { expect(z.recommended.feasible).toBe(false); expect(z.recommended.k).toBe(1); expect(z.recommended.ceiling.derated).toBeGreaterThan(z.recommended.final.kpiDerated.effective); }
  });
  it('budgetFromRecords carries the set and the records into the document header', () => {
    // header only: a 1-size, 1-record document at a small scale with few trials
    const d = budgetFromRecords([REC.a3server], SET, { sizes: [1000], target: 0.985, trials: 40 });
    expect(d.candidates).toEqual(SET.candidates);
    expect(d.reference).toEqual(SET.baseline);
    expect(Object.keys(d.archs)).toEqual(['a3server']);
    expect(d.archs.a3server.sizes['1000'].npus).toBe(1000);
    expect(Object.keys(d.mechanismLibrary)).toEqual([...SET.baseline, ...SET.candidates]);
    // the window check and the plan of the block are consistent
    const z = d.archs.a3server.sizes['1000'];
    expect(z.recommended.window.trials).toBe(40);
    expect(z.recommended.final.kpi.aOp).toBeGreaterThanOrEqual(0.985 - 1e-9);
    expect(windowCheck(recordScenario(REC.a3server, SET, 1000), 0.985, 40).trials).toBe(40);
    expect(typeof recommendPlan).toBe('function');
    expect(applyMechanisms).toBeDefined();
  }, 120000);
});
