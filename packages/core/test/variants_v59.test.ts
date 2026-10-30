/**
 * v5.9 the appendix variants of the report (user's request 2026-10-29): C-YOUNG lets the checkpoint period float by Young's rule
 * on the design's save time and is exactly removable; the two variant mechanism sets parse and resolve; `variantSummary` reduces a
 * variant budget to the rows Appendix A prints, consistent with the KPI form and the requirement of formula (2′).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_TOPOLOGY_RECORDS, DEFAULT_MECHANISM_SET, parseMechanismSet, resolveMechanismSet, recordScenario, budgetFromRecords, variantSummary,
  applyMechanisms, stripMechanisms, trainingOf, youngInterval, kpiForm, mechanismById, MECHANISM_LIBRARY,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const SETS = join(here, '..', 'data', 'mechanism-sets');
const readSet = (id: string) => parseMechanismSet(JSON.parse(readFileSync(join(SETS, `${id}.json`), 'utf8')));
const REC = BUILTIN_TOPOLOGY_RECORDS.a3server;

describe('v5.9 C-YOUNG: the checkpoint period by Young’s rule', () => {
  it('is a library variant outside the candidate pools, with no parameter of its own', () => {
    const m = mechanismById('C-YOUNG');
    expect(m.status).toBe('variant');
    expect(m.kind).toBe('checkpoint');
    expect(Object.keys(m.parameters)).toHaveLength(0);
    expect(MECHANISM_LIBRARY.filter((x) => x.status === 'variant').map((x) => x.id)).toEqual(['C-YOUNG']);
  });
  it('clears the fixed interval of C-FAST, keeps its save time and takes τ = √(2δ·M_rb); removal restores the fixed period', () => {
    const base = recordScenario(REC, DEFAULT_MECHANISM_SET, 10000);
    expect(base.workload.type).toBe('training');
    if (base.workload.type !== 'training') return;
    expect(base.workload.intervalS).toBe(60);
    expect(base.workload.deltaS).toBe(1);
    const young = applyMechanisms(base, ['C-YOUNG']);
    if (young.workload.type !== 'training') throw new Error('training expected');
    expect(young.workload.intervalS).toBeUndefined();
    expect(young.workload.intervalModel).toBe('young');
    expect(young.workload.deltaS).toBe(1);
    const t = trainingOf(young);
    // the engine chooses τ against the rollback MTBI (M_rb in hours → seconds)
    expect(t.intervalModel).toBe('young');
    expect(t.tauS).toBeGreaterThan(60);
    expect(t.tauS).toBeCloseTo(youngInterval(1, 3600 / t.rollbackRatePerHour), 6);
    const k = kpiForm(young, t);
    expect(k.tauS).toBe(t.tauS);
    expect(k.deltaS).toBe(1);
    expect(k.saveFrac).toBeCloseTo(1 / t.tauS, 12);
    // exactly removable: the fixed 60 s period and the interval model come back
    const back = stripMechanisms(young, ['C-YOUNG']);
    if (back.workload.type !== 'training') throw new Error('training expected');
    expect(back.workload.intervalS).toBe(60);
    expect(back.workload.intervalModel).toBe(base.workload.intervalModel);
    expect(back.mechanisms.applied?.['C-YOUNG']).toBeUndefined();
  });
});

describe('v5.9 the appendix variant sets and variantSummary', () => {
  it('the young and cmem sets parse, resolve and differ from the default set only in the checkpoint policy', () => {
    const young = readSet('remap-latest-2026-10--young'), cmem = readSet('remap-latest-2026-10--cmem');
    expect(resolveMechanismSet(young).baseline).toEqual([...DEFAULT_MECHANISM_SET.baseline, 'C-YOUNG']);
    expect(resolveMechanismSet(cmem).baseline).toEqual(DEFAULT_MECHANISM_SET.baseline.map((id) => (id === 'C-FAST' ? 'C-MEM' : id)));
    for (const s of [young, cmem]) {
      expect(s.candidates).toEqual(DEFAULT_MECHANISM_SET.candidates);
      expect(s.levers).toEqual(DEFAULT_MECHANISM_SET.levers);
      expect(s.derate).toEqual(DEFAULT_MECHANISM_SET.derate);
      expect(s.prune).toEqual(DEFAULT_MECHANISM_SET.prune);
    }
    const sc = recordScenario(REC, cmem, 10000);
    if (sc.workload.type !== 'training') throw new Error('training expected');
    expect(sc.workload.intervalS).toBe(60);
    expect(sc.workload.deltaS).toBe(0.5);
    expect(sc.mechanisms.applied?.['C-FAST']).toBeUndefined();
    expect(sc.mechanisms.overheads?.['C-MEM']).toBe(0.01);
  });
  it('variantSummary carries the derated τ / δ, the saves, the (2′) requirement and the window rule’s outcome per scale', () => {
    const young = readSet('remap-latest-2026-10--young');
    const opts = { sizes: [10000], target: 0.985, metric: 'effective' as const, trials: 40, seed: 1 };
    const main = budgetFromRecords([REC], DEFAULT_MECHANISM_SET, opts);
    const doc = budgetFromRecords([REC], young, opts);
    const v = variantSummary(main, young, doc);
    expect(v.id).toBe('remap-latest-2026-10--young');
    expect(v.added).toEqual(['C-YOUNG']);
    expect(v.removed).toEqual([]);
    expect(Object.keys(v.mechanisms)).toEqual(['C-YOUNG']);
    const rows = v.archs.a3server;
    expect(rows).toHaveLength(1);
    const row = rows[0], z = doc.archs.a3server.sizes['10000'];
    expect(row.npus).toBe(10000);
    expect(row.today.tauS).toBe(z.today.kpiDerated.tauS);
    expect(row.today.deltaS).toBe(1.5); // C-FAST's 1 s save derated × 1.5
    expect(row.today.saveSPerH).toBeCloseTo((3600 * row.today.deltaS) / row.today.tauS, 9);
    expect(row.today.effective).toBe(z.today.effectiveDerated);
    expect(row.required.B).toBe(z.required.B);
    expect(row.required.totalBudget).toBeCloseTo(3600 * (1 - 0.985), 9);
    expect(row.required.B).toBeCloseTo(row.required.totalBudget - row.required.terms.save - row.required.terms.other - row.required.terms.factors, 6);
    expect(row.recommended.feasible).toBe(z.recommended.feasible !== false);
    expect(row.recommended.mechanisms).toEqual(z.recommended.mechanisms);
    expect(row.recommended.effective).toBe(z.recommended.final.kpiDerated.effective);
    // the saves under Young's rule are a fraction of C-FAST's fixed 60 s / 1.5 s (90 s/h derated) at this scale
    const mainRow = main.archs.a3server.sizes['10000'];
    expect(3600 * mainRow.today.kpiDerated.saveFrac).toBeCloseTo(90, 6);
    expect(row.today.saveSPerH).toBeLessThan(90);
  }, 300_000);
});
