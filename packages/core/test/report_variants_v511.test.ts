/**
 * v5.11 the appendix variants in the browser report (apps/web Allocation › Report): `reportFromScenario(..., { variants })` runs the
 * budget of the project's design with each variant set's change and reduces it with `variantSummary`, the rows Appendix A prints;
 * the main document (Tables 1–6) is byte for byte the one of a run without variants; on a record's own design the browser path's
 * reference is the record path's (the set's baseline). Small settings keep it fast (1,000 NPUs, 40 windows, 4 permutations).
 */
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TOPOLOGY_RECORDS, DEFAULT_MECHANISM_SET, VARIANT_MECHANISM_SETS, mechanismSetById, resolveMechanismSet, recordScenario,
  reportFromScenario, variantReference, budgetFromRecords, variantSummary, youngInterval, trainingOf, kpiForm, applyMechanisms,
} from '../src/index.js';
import { deratedOf } from '../src/strategy/window.js';

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const noDate = <T extends { generated?: string; variants?: unknown }>(o: T) => { const { generated: _g, variants: _v, ...rest } = o; return rest; };

describe('v5.11 the appendix variants of the browser report', () => {
  const rec = BUILTIN_TOPOLOGY_RECORDS.a3server, set = DEFAULT_MECHANISM_SET;
  const s = recordScenario(rec, set, 1000);
  const base = { id: rec.id, name: rec.name, short: rec.short, family: rec.family, assumed: rec.assumed, sizes: [1000], target: 0.985, trials: 40, seed: 1, permutations: 4 };
  const young = mechanismSetById('remap-latest-2026-10--young'), cmem = mechanismSetById('remap-latest-2026-10--cmem');

  it('the three public variant sets are built in, parsed and distinct from the default set', () => {
    expect(VARIANT_MECHANISM_SETS.map((v) => v.id)).toEqual(['remap-latest-2026-10--young', 'remap-latest-2026-10--cmem', 'remap-latest-2026-10--young-sdc']);
    for (const v of VARIANT_MECHANISM_SETS) expect(v.id).not.toBe(set.id);
    expect(() => mechanismSetById('no-such-set')).toThrow(/unknown mechanism set/);
    expect(mechanismSetById(set.id)).toBe(set);
  });

  it('variantReference: the project design with the set’s change; the record path’s baseline on the default set’s own design', () => {
    const b = resolveMechanismSet(set).baseline;
    expect(variantReference(b, b, resolveMechanismSet(young).baseline)).toEqual(resolveMechanismSet(young).baseline);
    expect(variantReference(b, b, resolveMechanismSet(cmem).baseline)).toEqual(resolveMechanismSet(cmem).baseline);
    // a project that applies only part of the default baseline keeps its own design and takes the change alone
    expect(variantReference(['D-SDC', 'R-REPLAY', 'C-FAST'], b, resolveMechanismSet(young).baseline)).toEqual(['D-SDC', 'R-REPLAY', 'C-FAST', 'C-YOUNG']);
    expect(variantReference(['D-SDC', 'R-REPLAY', 'C-FAST'], b, resolveMechanismSet(cmem).baseline)).toEqual(['D-SDC', 'R-REPLAY', 'C-MEM']);
    expect(variantReference(['D-SDC', 'R-REPLAY'], b, resolveMechanismSet(cmem).baseline)).toEqual(['D-SDC', 'R-REPLAY', 'C-MEM']);
  });

  it('results.variants carries the appendix rows; Tables 1–6 are the ones of a run without variants; the record path agrees', () => {
    const plain = reportFromScenario(s, base);
    const got = reportFromScenario(s, { ...base, variants: [young, cmem] });
    expect(noDate(json(got.results))).toEqual(noDate(json(plain.results)));
    expect(plain.results.variants).toBeUndefined();
    const V = got.results.variants!;
    expect(V.map((v) => v.id)).toEqual([young.id, cmem.id]);
    expect(V[0].added).toEqual(['C-YOUNG']); expect(V[0].removed).toEqual([]);
    expect(V[1].added).toEqual(['C-MEM']); expect(V[1].removed).toEqual(['C-FAST']);
    for (const v of V) { expect(Object.keys(v.archs)).toEqual([rec.id]); expect(v.archs[rec.id].map((row) => row.npus)).toEqual([1000]); }
    // the Young row: τ = √(2δ·M_rb) on the derated design, the saves 3600·δ/τ
    const ry = V[0].archs[rec.id][0];
    expect(ry.today.deltaS).toBeCloseTo(1.5, 12);
    expect(ry.today.saveSPerH).toBeCloseTo(3600 * ry.today.deltaS / ry.today.tauS, 9);
    expect(ry.today.tauS).toBeGreaterThan(60);
    // the C-MEM row keeps the 60 s period with the 0.75 s derated save
    const rm = V[1].archs[rec.id][0];
    expect(rm.today.tauS).toBe(60); expect(rm.today.deltaS).toBeCloseTo(0.75, 12); expect(rm.today.saveSPerH).toBeCloseTo(45, 9);
    // the record path (hacd findings --variants) gives the same rows on the record's own design
    for (const [i, vs] of [young, cmem].entries()) {
      const want = variantSummary(plain.results, vs, budgetFromRecords([rec], vs, { sizes: [1000], target: 0.985, trials: 40, seed: 1 }));
      expect(json(V[i]), vs.id).toEqual(json(want));
    }
  }, 300_000);

  it('refuses the report’s own set as a variant', () => {
    expect(() => reportFromScenario(s, { ...base, variants: [set] })).toThrow(/report's own set/);
  });

  it('the Young row is the derated variant design, its period the engine’s youngInterval there', () => {
    const got = reportFromScenario(s, { ...base, variants: [young] });
    const row = got.results.variants![0].archs[rec.id][0];
    const design = applyMechanisms(s, ['C-YOUNG'], resolveMechanismSet(young).parameters);
    const t = trainingOf(design); const k = kpiForm(design, t);
    expect(k.tauS).toBeCloseTo(youngInterval(k.deltaS, 3600 / t.rollbackRatePerHour), 9);
    const der = deratedOf(design); const td = trainingOf(der); const kd = kpiForm(der, td);
    expect(kd.deltaS).toBeCloseTo(1.5, 12);
    expect(kd.tauS).toBeCloseTo(youngInterval(kd.deltaS, 3600 / td.rollbackRatePerHour), 9);
    expect(row.today.tauS).toBeCloseTo(kd.tauS, 9);
    expect(row.today.saveSPerH).toBeCloseTo(3600 * kd.saveFrac, 9);
  }, 300_000);
});
