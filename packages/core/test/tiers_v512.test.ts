/**
 * v5.12 the three-target report (tool review 2026-11-09, docs/markdown/TOOL_REVIEW_2026-11-09.md): the allocation on A_op by default,
 * the two goodput tiers with their requirements (budget/tiers.ts), the requirement under a checkpoint period that follows the
 * rollback interval (defects D1 / D2), the window share of the derated twin, the recovery scale law of a mechanism set, the node
 * repair pipeline and the field-level case.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_TOPOLOGY_RECORDS } from '../src/records/topologyRecord.js';
import { DEFAULT_MECHANISM_SET, mechanismSetById, resolveMechanismSet, parseMechanismSet } from '../src/records/mechanismSet.js';
import { parseFaultRateOverride } from '../src/records/faultRates.js';
import { recordScenario, hierarchicalBudget, budgetFromRecords } from '../src/budget/index.js';
import { goodputTiers, withYoungInterval, withSaveTime, withMissFactor, withFallbackDelay, DEFAULT_TIER_FLOORS } from '../src/budget/tiers.js';
import { fieldCaseSummary } from '../src/budget/fieldCase.js';
import { deratedOf } from '../src/strategy/window.js';
import { kpiForm, trainingOf } from '../src/budget/kpiForm.js';
import { applyMechanisms } from '../src/mechanisms/index.js';
import fieldRates from '../data/fault-rates/field-llama3-2026-11.json';
import catalogRates from '../data/fault-rates/remap-per-card-2026-10-09.json';

const REC = BUILTIN_TOPOLOGY_RECORDS, SET = DEFAULT_MECHANISM_SET, RS = resolveMechanismSet(SET);
const today = (n: number, rec = REC.native950) => { const s = recordScenario(rec, SET, n); return { s, d: deratedOf(s) }; };
const geff = (s: Parameters<typeof trainingOf>[0]) => trainingOf(s).effectiveGoodputExact;
const gdel = (s: Parameters<typeof trainingOf>[0]) => trainingOf(s).deliveredGoodputExact;

describe('v5.12 goodput tiers', () => {
  it('the Young twin is the design with C-YOUNG applied, and A_op does not depend on the checkpoint policy', () => {
    for (const n of [10000, 500000]) {
      const { s } = today(n);
      const a = trainingOf(withYoungInterval(s)), b = trainingOf(applyMechanisms(s, ['C-YOUNG']));
      expect(a.tauS).toBe(b.tauS);
      expect(a.effectiveGoodputExact).toBe(b.effectiveGoodputExact);
      expect(a.deliveredGoodputExact).toBe(b.deliveredGoodputExact);
      // the running share is independent of τ and δ; only the episode pauses of silent corruption move (P_clear), by less than 1e-6
      expect(Math.abs(a.operationalAvailability - trainingOf(s).operationalAvailability)).toBeLessThan(1e-6);
      const deltaS = s.workload.type === 'training' ? s.workload.deltaS : NaN;
      expect(a.tauS).toBeCloseTo(Math.sqrt((2 * deltaS * 3600) / a.rollbackRatePerHour), 9);
    }
  });

  it('checkpoint tier: both rows, the basis, and the save time that meets the floor exactly', () => {
    const { s, d } = today(200000);
    const T = goodputTiers(s, d), c = T.checkpoint;
    expect(c.asDesigned.policy).toBe('fixed');
    expect(c.asDesigned.tauS).toEqual({ nominal: 60, derated: 60 });
    expect(c.deltaS).toEqual({ nominal: 1, derated: 1.5 });
    expect(c.basis).toBe('young');
    expect(c.young!.effective.derated).toBe(geff(withYoungInterval(d)));
    expect(c.young!.effective.derated).toBeGreaterThan(c.asDesigned.effective.derated);
    expect(c.floor).toBe(DEFAULT_TIER_FLOORS.effective);
    // today's 200k design misses 97 % derated at Young's period; a shorter save meets it
    expect(c.met).toBe(false);
    expect(c.saveAllowedS!.derated).toBeLessThan(1.5);
    expect(geff(withSaveTime(withYoungInterval(d), c.saveAllowedS!.derated))).toBeCloseTo(0.97, 9);
    // the nominal requirement derates to it by the design's own ratio (times × 1.5)
    expect(c.saveAllowedS!.nominal * 1.5).toBeCloseTo(c.saveAllowedS!.derated, 12);
    expect(c.ceiling).toBeGreaterThan(0.97);
    // the ledger shares of the basis row are the engine's
    const y = trainingOf(withYoungInterval(d));
    expect(c.young!.save.derated).toBe(y.ledgerExact.save);
    expect(c.young!.recompute.derated).toBe(y.ledgerExact.rollback);
  });

  it('checkpoint tier: a ceiling below the floor has no save time; slack is a save time above today’s; no floor, no requirement', () => {
    const big = today(500000), T5 = goodputTiers(big.s, big.d).checkpoint;
    expect(T5.ceiling).toBeLessThan(0.97);
    expect(T5.saveAllowedS).toBeNull();
    expect(T5.met).toBe(false);
    const small = today(10000), T1 = goodputTiers(small.s, small.d).checkpoint;
    expect(T1.met).toBe(true);
    expect(T1.saveAllowedS!.nominal).toBeGreaterThan(1);
    const none = goodputTiers(small.s, small.d, { floors: { effective: null, delivered: null } });
    expect(none.checkpoint.met).toBeNull();
    expect(none.checkpoint.saveAllowedS).toBeNull();
    expect(none.delivered.met).toBeNull();
    expect(none.delivered.coverageNeeded).toBeNull();
    // the design as it is as the basis
    const own = goodputTiers(small.s, small.d, { basis: 'asDesigned' });
    expect(own.checkpoint.basis).toBe('asDesigned');
    expect(own.delivered.asAllocated.delivered.derated).toBe(gdel(small.d));
    // a design whose period already follows the rollback interval has one row
    const y = withYoungInterval(small.s), Ty = goodputTiers(y, deratedOf(y));
    expect(Ty.checkpoint.young).toBeUndefined();
    expect(Ty.checkpoint.asDesigned.policy).toBe('young');
  });

  it('delivered tier: the two ends of the detection requirement meet the floor exactly', () => {
    const { s, d } = today(200000);
    const T = goodputTiers(s, d).delivered, bD = withYoungInterval(d);
    expect(T.ratePerHour).toBeGreaterThan(0);
    expect(T.asAllocated.coverage.nominal).toBeCloseTo(0.95, 12);
    expect(T.asAllocated.coverage.derated).toBeCloseTo(0.9, 12);
    expect(T.asAllocated.delivered.derated).toBe(gdel(bD));
    expect(T.met).toBe(false);
    // joint coverage q*: every class's miss scaled by (1 − q*) / (1 − q)
    const q = T.coverageNeeded!;
    expect(q.derated).toBeGreaterThan(0.9);
    expect(gdel(withMissFactor(bD, (1 - q.derated) / (1 - T.asAllocated.coverage.derated)))).toBeCloseTo(0.9, 9);
    expect(q.nominal - q.derated).toBeCloseTo(0.05, 12);
    // discovery delay D* at today's coverage
    expect(T.delayAllowedH!).toBeLessThan(T.fallbackDelayH);
    expect(gdel(withFallbackDelay(bD, T.delayAllowedH!))).toBeCloseTo(0.9, 9);
    // the ceiling is the delivered goodput with nothing undetected: the effective goodput
    expect(T.ceiling).toBeCloseTo(geff(withMissFactor(bD, 0)), 6);
  });

  it('delivered tier: slack reads as a coverage below today’s and any delay within the window', () => {
    const { s, d } = today(10000);
    const T = goodputTiers(s, d).delivered;
    expect(T.met).toBe(true);
    expect(T.coverageNeeded!.derated).toBeLessThan(T.asAllocated.coverage.derated);
    expect(T.delayAllowedH).toBe(T.horizonH);
    expect(T.horizonH).toBe(720);
  });

  it('withMissFactor folds the conditional detectors into one coverage and scales the joint miss', () => {
    const s = applyMechanisms(recordScenario(REC.native950, SET, 100000), RS.goodputOnly, RS.parameters);
    const t0 = trainingOf(s).sdc!;
    expect(trainingOf(withMissFactor(s, 1)).sdc!.coverage).toBeCloseTo(t0.coverage, 12);
    expect(1 - trainingOf(withMissFactor(s, 0.5)).sdc!.coverage).toBeCloseTo(0.5 * (1 - t0.coverage), 12);
    expect(trainingOf(withMissFactor(s, 0)).sdc!.coverage).toBe(1);
  });
});

describe('v5.12 the budget on the three targets', () => {
  const rec = REC.a3server, n = 1000;
  const base = { target: 0.985, candidates: RS.candidates, parameters: RS.parameters, efforts: SET.efforts, levers: RS.levers, reference: RS.baseline, derate: RS.derate, trials: 40, seed: 1, layerSpec: rec.layers };

  it('allocates on A_op by default and carries the tiers, the derated window share, the scale law and the repair pipeline', () => {
    const z = hierarchicalBudget(recordScenario(rec, SET, n), { ...base, deliveredOnly: RS.goodputOnly });
    expect(z.required.metric).toBe('aOp');
    expect(z.today.metric).toBe('aOp');
    expect(z.today.value).toBe(z.today.aOp);
    for (const T of [z.today.tiers, z.recommended.tiers]) {
      expect(T.checkpoint.floor).toBe(0.97);
      expect(T.delivered.floor).toBe(0.9);
      expect(T.checkpoint.basis).toBe('young');
      // the delivered-only mechanisms of the set, applied after the design's own, raise the joint coverage; at 1,000 NPUs their
      // throughput overhead costs more than the corruption they save (the delivered goodput falls), at 500k it is the reverse (below)
      expect(T.delivered.withDetectors!.mechanisms).toEqual(RS.goodputOnly);
      expect(T.delivered.withDetectors!.coverage.derated).toBeGreaterThan(T.delivered.asAllocated.coverage.derated);
      expect(T.delivered.withDetectors!.effective.derated).toBeLessThan(T.delivered.asAllocated.effective.derated);
    }
    {
      const big = recordScenario(REC.native950, SET, 500000), det = applyMechanisms(big, RS.goodputOnly, RS.parameters);
      const T = goodputTiers(big, deratedOf(big), { detectors: { mechanisms: RS.goodputOnly, nom: det, der: deratedOf(det) } }).delivered;
      expect(T.withDetectors!.delivered.derated).toBeGreaterThan(T.asAllocated.delivered.derated + 0.1);
      expect(T.met).toBe(false);
      expect(T.withDetectors!.met).toBe(false); // 89.8 % derated: today's 500k design still misses 90 % by a hair
    }
    expect(z.recommended.feasible).toBe(true);
    // the same acceptance replications on the derated twin
    expect(z.recommended.windowDerated!.from).toBe(z.recommended.window.from);
    expect(z.recommended.windowDerated!.trials).toBe(40);
    expect(z.recommended.windowDerated!.pAtLeastTarget).toBeLessThanOrEqual(z.recommended.window.pAtLeastTarget);
    expect(z.recoveryScale).toBeNull();
    expect(z.spares!.nodes).toBe(n / 8);
    expect(z.spares!.design.mean).toBeLessThanOrEqual(z.spares!.today.mean * Math.max(1, z.recommended.k) + 1e-12);
    // without the list there is no detector row; floors of the options reach the tiers
    const plain = hierarchicalBudget(recordScenario(rec, SET, n), { ...base, effectiveFloor: null, deliveredFloor: 0.95 });
    expect(plain.recommended.tiers.delivered.withDetectors).toBeUndefined();
    expect(plain.recommended.tiers.checkpoint.floor).toBeNull();
    expect(plain.recommended.tiers.delivered.floor).toBe(0.95);
  }, 120000);

  it('budgetFromRecords records the basis, the floors and the delivered-only list of the set', () => {
    const d = budgetFromRecords([rec], SET, { sizes: [n], target: 0.985, trials: 40 });
    expect(d.metric).toBe('aOp');
    expect(d.floors).toEqual({ effective: 0.97, delivered: 0.9 });
    expect(d.deliveredOnly).toEqual(RS.goodputOnly);
    const e = budgetFromRecords([rec], SET, { sizes: [n], target: 0.985, trials: 40, metric: 'effective', effectiveFloor: null });
    expect(e.metric).toBe('effective');
    expect(e.floors).toEqual({ effective: null, delivered: 0.9 });
  }, 120000);

  it('D1 / D2: under a period that follows the rollback interval the goodput requirement is the engine’s hardware-only root', () => {
    const young = mechanismSetById('remap-latest-2026-10--young'), ry = resolveMechanismSet(young), N = 500000;
    const z = hierarchicalBudget(recordScenario(REC.native950, young, N), { target: 0.985, metric: 'effective', candidates: ry.candidates, parameters: ry.parameters, efforts: young.efforts, levers: ry.levers, reference: ry.baseline, derate: ry.derate, trials: 40, seed: 1, layerSpec: REC.native950.layers });
    // formula (2′) at today's period says B ≤ 0 …
    expect(z.required.B).toBeLessThan(0);
    // … yet hardware alone reaches the target (the period lengthens as the hardware improves): the requirement is the engine's root
    expect(z.required.interval).toBe('optimised');
    expect(z.required.reachable).toBe(true);
    expect(z.hardwareOnly.factor!).toBeGreaterThan(0.05);
    expect(z.hardwareOnly.factor!).toBeLessThan(0.2);
    expect(z.required.mtbfAtTodayMttrH!).toBeCloseTo(z.today.kpiDerated.mtbfHwH / z.hardwareOnly.factor!, 9);
    expect(z.required.mttrAtTodayMtbfS).toBeNull();
    // the fixed period of the default set keeps formula (2′) as it is
    const fixed = hierarchicalBudget(recordScenario(REC.native950, SET, N), { ...base, metric: 'effective', layerSpec: REC.native950.layers });
    expect(fixed.required.interval).toBeUndefined();
    expect(fixed.required.reachable).toBe(false);
  }, 240000);

  it('a mechanism set can state a scale law of the automatic attempt; without one the recovery is the same at every scale', () => {
    const scaled = parseMechanismSet({ ...JSON.parse(JSON.stringify(SET)), id: 'scaled-test', recovery: { ...SET.recovery, automatic: { ...SET.recovery.automatic, scale: { type: 'log', refN: 10000, slope: 0.5 } } } });
    const mttr = (set: typeof SET, N: number) => kpiForm(recordScenario(REC.native950, set, N)).mttrS;
    // the same recovery seconds at every scale: the mean pause moves only with the class mix (the scale-out tiers), by a fraction of a second
    expect(Math.abs(mttr(SET, 500000) - mttr(SET, 10000))).toBeLessThan(0.5);
    expect(mttr(scaled, 10000)).toBeCloseTo(mttr(SET, 10000), 9);
    expect(mttr(scaled, 500000)).toBeGreaterThan(mttr(SET, 500000) * 1.2);
    const z = hierarchicalBudget(recordScenario(rec, scaled, n), base);
    expect(z.recoveryScale).toEqual({ type: 'log', refN: 10000, slope: 0.5 });
  }, 120000);

  it('the field-level case: the catalog’s proportions at a measured total, and the allowed FIT of its plan', () => {
    const field = parseFaultRateOverride(fieldRates), cat = parseFaultRateOverride(catalogRates);
    const hard = (o: typeof field) => Object.entries(o.rates).filter(([id]) => id.endsWith('-hard')).reduce((a, [, r]) => a + r.fit, 0);
    // 419 interruptions in 54 days on 16,384 GPUs
    expect(hard(field)).toBeCloseTo((419 / (54 * 24 * 16384)) * 1e9, 6);
    const f = hard(field) / hard(cat);
    for (const [id, r] of Object.entries(field.rates)) expect(r.fit).toBeCloseTo(cat.rates[id].fit * f, 9);
    expect(Object.keys(field.rates).every((id) => id.endsWith('-hard'))).toBe(true);
    const main = budgetFromRecords([rec], SET, { sizes: [n], target: 0.985, trials: 40 });
    const fd = budgetFromRecords([rec], SET, { sizes: [n], target: 0.985, trials: 40, rates: field });
    const fc = fieldCaseSummary(field, fd), row = fc.archs[rec.id][0];
    expect(fc.id).toBe('field-llama3-2026-11');
    expect(fc.metric).toBe('aOp');
    expect(row.today.hardFitPerNpu / main.archs[rec.id].sizes[String(n)].hardFitPerNpuTotal).toBeCloseTo(f, 6);
    expect(row.recommended.feasible).toBe(true);
    expect(row.recommended.allowedFitPerNpu!).toBeCloseTo(row.recommended.k * row.today.hardFitPerNpu, 9);
    // the requirement is absolute: with no move needed on either basis the allowed FIT per NPU is the same
    const m = main.archs[rec.id].sizes[String(n)].recommended;
    if (!m.mechanisms.length && !m.levers.length && !row.recommended.mechanisms.length && !row.recommended.levers.length) expect(row.recommended.allowedFitPerNpu! / (m.k * main.archs[rec.id].sizes[String(n)].hardFitPerNpuTotal)).toBeCloseTo(1, 2);
  }, 240000);
});
