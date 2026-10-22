/**
 * v5 golden-vector harness. Expected values in test/golden/golden_v5.json were computed independently in Python
 * (compute_golden_v5.py: the MTBF / MTTR form of A_op, the layer split, the rung-tree enumeration with per-contributor
 * booking, the requirement B, the closed-form uniform factor, the Shapley pruning rule) from the Methodology formulas (1)–(5)
 * and MODEL_REFERENCE.md §18 / §19 / §24 without reading the engine. Do not edit expected values by hand.
 *
 * The harness rebuilds every scenario from the architecture builders (scripts/ascend950-archs.ts, ascend910c-archs.ts) and
 * the case's `design` block {arch, npus, mechanisms, levers, k, derated}; the recommended plans' mechanisms / levers / k were
 * copied into the case inputs by the Python from docs/backup/ascend-allocation/results.json, so results.json is not read here.
 * The Shapley studies of G6 are read from docs/backup/arch-mechanism-shapley/<arch>.json (inputs of the rule).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { kpiForm, trainingOf } from '../src/budget/kpiForm.js';
import { chainSplit, classChainSplits, mttrDecomposition } from '../src/mttr/decompose.js';
import { byLayer, unavailabilityByLayer, DEFAULT_LAYERS } from '../src/layers/index.js';
import { requirementFromKpi, requirement } from '../src/strategy/requirement.js';
import { deratedOf } from '../src/strategy/window.js';
import { pruneByShapley, shapleyAtScale } from '../src/study/prune.js';
import { applyMechanisms } from '../src/mechanisms/index.js';
import { applyLevers, withHardwareFactors, DEFAULT_LEVERS, type LeverId } from '../src/strategy/index.js';
import { DERATE_DEFAULT } from '../src/mechanisms/plan.js';
import { evaluateScenario } from '../src/scenario/evaluate.js';
import type { Scenario } from '../src/scenario/schema.js';
import type { ChainParams, Applicability } from '../src/mechanisms/chain.js';
import * as A950 from '../../../scripts/ascend950-archs.js';
import * as A910 from '../../../scripts/ascend910c-archs.js';
import { REMAP_LATEST_PARAMS } from '../../../scripts/remap-latest-params.js';

interface Design { arch: 'native' | 'ubl128' | 'cm384' | 'a3server'; npus: number; mechanisms: string[]; levers: string[]; k: number; derated: boolean }
interface GoldenCase {
  id: string;
  group: string;
  inputs: Record<string, unknown> & { design?: Design };
  expected: Record<string, unknown>;
  tolerance: Record<string, number>;
  note?: string;
}
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const golden = JSON.parse(readFileSync(join(here, 'golden', 'golden_v5.json'), 'utf8')) as { cases: GoldenCase[]; findings: string[] };

const base = (d: Design): Scenario => (d.arch === 'native' || d.arch === 'ubl128' ? A950.scenarioOf(d.arch, d.npus) : A910.scenarioOf(d.arch, d.npus));
const levers = (ids: string[]) => DEFAULT_LEVERS.filter((l) => ids.includes(l.id));
const factors = (s: Scenario, k: number) => Object.fromEntries(s.components.filter((c) => c.failure.value > 0).map((c) => [c.id, k]));

/** the scenario of a case: today's design (nominal or derated), the recommended design nominal at k, or the recommended design derated at k = 1 */
function scenarioOf(d: Design): Scenario {
  const b = base(d);
  if (d.mechanisms.length === 0 && d.levers.length === 0) return d.derated ? deratedOf(b) : b;
  const applied = applyMechanisms(b, d.mechanisms, REMAP_LATEST_PARAMS);
  if (!d.derated) return withHardwareFactors(applyLevers(applied, levers(d.levers), null), factors(applied, d.k));
  // the engine's derated plan: deratedOf before the levers (finding 2 of golden-v5-report.md), then the uniform hardware factor
  const derated = applyLevers(deratedOf(applied), levers(d.levers), DERATE_DEFAULT);
  return d.k === 1 ? derated : withHardwareFactors(derated, factors(derated, d.k));
}

/** numeric comparison: every expected key must be present (a missing key passes only for an expected 0) and within tolerance */
function compareNumbers(id: string, got: Record<string, number | undefined>, expected: Record<string, unknown>, tol: Record<string, number>) {
  const rel = tol.rel ?? 1e-9;
  const abs = tol.abs ?? 1e-12;
  for (const [k, w] of Object.entries(expected)) {
    if (typeof w !== 'number') continue;
    const v = got[k];
    if (v === undefined) {
      expect.soft(w, `${id}.${k}: missing in the engine output (expected ${w})`).toBe(0);
      continue;
    }
    expect.soft(Math.abs(v - w), `${id}.${k}: got ${v}, expected ${w}`).toBeLessThanOrEqual(Math.max(abs, rel * Math.abs(w)));
  }
}

function flatKpi(k: ReturnType<typeof kpiForm>): Record<string, number> {
  const out: Record<string, number> = { lamHw: k.lamHw, sumLP: k.sumLP, mttrS: k.mttrS, mtbfHwH: k.mtbfHwH, F: k.F, aRun: k.aRun, phi: k.phi, detectS: k.detectS, globalS: k.globalS };
  for (const o of k.other) {
    out[`other.${o.id}.ratePerHour`] = o.ratePerHour;
    out[`other.${o.id}.pauseS`] = o.pauseS;
    out[`other.${o.id}.sPerH`] = o.sPerH;
    if (o.mtbfH !== null && Number.isFinite(o.mtbfH)) out[`other.${o.id}.mtbfH`] = o.mtbfH;
  }
  return out;
}

type Split = { contrib: Record<string, number>; probs: Record<string, number>; meanS: number };
function flatSplit(prefix: string, sp: Split, out: Record<string, number>) {
  for (const [k, v] of Object.entries(sp.contrib)) out[`${prefix}.contrib.${k}`] = v;
  for (const [k, v] of Object.entries(sp.probs)) out[`${prefix}.probs.${k}`] = v;
  out[`${prefix}.meanS`] = sp.meanS;
}

const byGroup = (g: string) => golden.cases.filter((c) => c.group === g);

describe('v5 golden vectors (independent Python)', () => {
  it('G1 kpiForm — the MTBF / MTTR form of A_op, formula (1); A_run closure on the engine running fraction', () => {
    for (const c of byGroup('kpiForm')) {
      const s = scenarioOf(c.inputs.design!);
      const k = kpiForm(s);
      compareNumbers(c.id, flatKpi(k), c.expected, c.tolerance);
      // identity: the formula's A_run equals the engine's running fraction (≤ 1e-9), and φ = 1 − A_op / A_run
      const t = evaluateScenario(s, { structure: false }).training!;
      expect.soft(Math.abs(t.runningFraction - (c.expected.aRun as number)), `${c.id}: engine running fraction vs formula A_run`).toBeLessThanOrEqual(1e-9);
      expect.soft(Math.abs(k.aOp - t.operationalAvailability), `${c.id}: kpiForm.aOp vs engine A_op`).toBeLessThanOrEqual(1e-12);
      expect.soft(Math.abs(k.aOp - (c.inputs.engineAOp as number)), `${c.id}: engine A_op vs the dumped table`).toBeLessThanOrEqual(1e-12);
    }
  });

  it('G2 byLayer — formula (3): λ_ℓ, C_ℓ, the isolation / silent split by layer and U_ℓ; Σ_ℓ λ_ℓ = λ_hw, Σ_ℓ C_ℓ = ΣC', () => {
    const layerOfUnit = byGroup('byLayer')[0].inputs.layerOfUnit as Record<string, string>;
    for (const L of DEFAULT_LAYERS as unknown as { id: string; units: string[] }[]) for (const u of L.units) expect.soft(layerOfUnit[u], `DEFAULT_LAYERS: unit ${u}`).toBe(L.id);
    for (const c of byGroup('byLayer')) {
      const s = scenarioOf(c.inputs.design!);
      const x = byLayer(s);
      const U = unavailabilityByLayer(x) as unknown as Record<string, number>;
      const got: Record<string, number> = { sumLam: 0, sumC: 0, sumIso: 0, sumSdc: 0 };
      for (const [l, v] of Object.entries(x.levels)) {
        got[`${l}.lam`] = v.lam;
        got[`${l}.c`] = v.c;
        got[`${l}.iso`] = v.iso;
        got[`${l}.sdc`] = v.sdc;
        got[`${l}.slowRate`] = v.slowRate;
        got[`${l}.sdcRate`] = v.sdcRate;
        got[`${l}.U`] = U[l];
        got.sumLam += v.lam;
        got.sumC += v.c;
        got.sumIso += v.iso;
        got.sumSdc += v.sdc;
      }
      got.D = 1 + (x.k.sumLP + x.k.F) / 3600;
      got.hardU = U.hard;
      compareNumbers(c.id, got, c.expected, c.tolerance);
      expect.soft(Math.abs(got.sumLam - x.k.lamHw), `${c.id}: Σ_ℓ λ_ℓ vs kpiForm.lamHw`).toBeLessThanOrEqual(1e-12 * x.k.lamHw);
      expect.soft(Math.abs(got.sumC - x.k.sumLP), `${c.id}: Σ_ℓ C_ℓ vs kpiForm.sumLP`).toBeLessThanOrEqual(1e-12 * x.k.sumLP);
    }
  });

  it('G3 chainSplit / mttrDecomposition — rung-tree contributions per class and rate-weighted; Σ contributions = mean pause; stages', () => {
    for (const c of byGroup('chainSplit')) {
      const s = scenarioOf(c.inputs.design!);
      const t = trainingOf(s);
      const got: Record<string, number> = {};
      const applicable = c.inputs.applicable as Record<string, Applicability>;
      for (const row of classChainSplits(s, t)) {
        flatSplit(`class.${row.id}`, row.split as Split, got);
        // identity: the split closes on the engine's mean pause of the class
        expect.soft(Math.abs(row.split.meanS - row.meanPauseS), `${c.id}: ${row.id} Σ contributions vs engine meanPauseS`).toBeLessThanOrEqual(1e-9 * row.meanPauseS);
        // the direct signature with the engine's chain parameters must give the same split
        const direct = chainSplit(t.chain.detectS, t.chain.globalS, c.inputs.autoS as number, t.chain.params as ChainParams, applicable[row.id], (c.inputs.order as string[] | null) ?? undefined);
        expect.soft(Math.abs(direct.meanS - row.split.meanS), `${c.id}: ${row.id} chainSplit vs classChainSplits`).toBeLessThanOrEqual(1e-12);
      }
      const d = mttrDecomposition(s, t);
      for (const [k, v] of Object.entries(d.contrib)) got[`job.contrib.${k}`] = v;
      for (const [k, v] of Object.entries(d.probs)) got[`job.probs.${k}`] = v;
      for (const [k, v] of Object.entries(d.stages)) got[`job.stages.${k}`] = v;
      got['job.mttrS'] = d.mttrS;
      got['job.recovery.tDetS'] = d.recovery.tDetS;
      got['job.recovery.automaticS'] = d.recovery.automatic.seconds;
      got['job.recovery.successProbability'] = d.recovery.automatic.successProbability;
      got['job.recovery.manualS'] = d.recovery.manualS;
      got['job.recovery.globalS'] = d.recovery.globalS;
      for (const k of ['startup', 'read', 'communication'] as const) got[`job.recovery.stages.${k}`] = (d.recovery.automatic.stages as Record<string, number>)[k];
      compareNumbers(c.id, got, c.expected, c.tolerance);
      expect.soft(Math.abs(d.mttrS - kpiForm(s, t).mttrS), `${c.id}: mttrDecomposition.mttrS vs kpiForm.mttrS`).toBeLessThanOrEqual(1e-9 * d.mttrS);
    }
  });

  it('G4 requirementFromKpi — formula (2) on the derated design: B, the total budget, the two ends and the factors', () => {
    for (const c of byGroup('requirement')) {
      const d = c.inputs.design!;
      const target = c.inputs.target as number;
      const b = base({ ...d, derated: false });
      const r = requirement(b, target);
      compareNumbers(`${c.id} (requirement)`, r as unknown as Record<string, number>, c.expected, c.tolerance);
      const r2 = requirementFromKpi(kpiForm(deratedOf(b)), target);
      compareNumbers(`${c.id} (requirementFromKpi)`, r2 as unknown as Record<string, number>, c.expected, c.tolerance);
    }
  });

  it('G5 closed-form uniform factor k* where the derated mean binds — vs the bisection k of results.json and the evaluation at k*', () => {
    for (const c of byGroup('kStar')) {
      const d = scenarioOf(c.inputs.design!);
      const k = kpiForm(d);
      compareNumbers(c.id, { sumC1: k.sumLP, F: k.F, phi: k.phi }, { sumC1: c.expected.sumC1, F: c.expected.F, phi: c.expected.phi }, c.tolerance);
      const kStar = c.expected.kStar as number;
      const resultsK = c.inputs.resultsK as number;
      expect.soft(Math.abs(kStar - resultsK) / resultsK, `${c.id}: closed-form k* ${kStar} vs results.json recommended.k ${resultsK} (relative)`).toBeLessThanOrEqual(c.tolerance.kStarVsResultsRel);
      const atK = evaluateScenario(withHardwareFactors(d, factors(d, kStar)), { structure: false }).training!.operationalAvailability;
      expect.soft(Math.abs(atK - (c.expected.aOpAtKStar as number)), `${c.id}: A_op of the derated design at k* = ${kStar} is ${atK}, target ${c.expected.aOpAtKStar}`).toBeLessThanOrEqual(c.tolerance.aOpAbs);
    }
  });

  it('G5b exact identity at the engine k — formula (1) on the derated design at results.json k gives A*; ΣC(k) = k·ΣC₁', () => {
    for (const c of byGroup('kExact')) {
      const d = scenarioOf(c.inputs.design!);
      const k = kpiForm(d);
      compareNumbers(c.id, { sumCk: k.sumLP, kTimesSumC1: k.sumLP, F: k.F, phi: k.phi }, { sumCk: c.expected.sumCk, kTimesSumC1: c.expected.kTimesSumC1, F: c.expected.F, phi: c.expected.phi }, c.tolerance);
      const target = c.expected.target as number;
      const aOpFormula = (1 - k.phi) / (1 + (k.sumLP + k.F) / 3600);
      expect.soft(Math.abs(aOpFormula - target), `${c.id}: (1 − φ(k)) / (1 + (ΣC(k) + F)/3600) = ${aOpFormula} vs A* = ${target}`).toBeLessThanOrEqual(c.tolerance.aOpAbs);
      expect.soft(Math.abs(aOpFormula - (c.expected.aOpFormula as number)), `${c.id}: formula A_op vs the Python value`).toBeLessThanOrEqual(1e-12);
      const engine = evaluateScenario(d, { structure: false }).training!.operationalAvailability;
      expect.soft(Math.abs(engine - target), `${c.id}: engine A_op of the derated design at results.json k = ${c.inputs.resultsK} is ${engine}, target ${target}`).toBeLessThanOrEqual(c.tolerance.aOpAbs);
      expect.soft(Math.abs(k.phi - (c.inputs.phiAtK1 as number) - (c.expected.phiShiftFromK1 as number)), `${c.id}: φ(k) − φ(1)`).toBeLessThanOrEqual(1e-12);
    }
  });

  it('G6 pruneByShapley — the Methodology §4 rule on the stored 23-player studies at 500k and on a synthetic table', () => {
    type Verdict = { verdict: string; aOp: { min: number; max: number } | null; delivered: { min: number; max: number } | null; dominatedBy: string | null; missing: string[] };
    type Expected = { verdicts: Record<string, Verdict>; lists: Record<string, string[]> };
    for (const c of byGroup('prune')) {
      const studies = typeof c.inputs.studies === 'string'
        ? Object.fromEntries(['native950', 'ubl128', 'cm384', 'a3server'].map((a) => [a, JSON.parse(readFileSync(join(root, 'docs', 'backup', 'arch-mechanism-shapley', `${a}.json`), 'utf8'))]))
        : (c.inputs.studies as Record<string, { perSize: Record<string, { gains: never[] }> }>);
      const values = shapleyAtScale(studies as never, c.inputs.scale as number);
      const r = pruneByShapley(values, c.inputs.ids as string[], { threshold: c.inputs.threshold as number, dominated: c.inputs.dominated as Record<string, string>, reference: c.inputs.reference as string[] });
      const e = c.expected as unknown as Expected;
      for (const [id, w] of Object.entries(e.verdicts)) {
        const v = r.verdicts[id] as (Verdict & { dominatedBy?: string }) | undefined;
        expect.soft(v, `${c.id}: ${id} has a verdict`).toBeDefined();
        if (!v) continue;
        expect.soft(v.verdict, `${c.id}: ${id} verdict`).toBe(w.verdict);
        expect.soft(v.dominatedBy ?? null, `${c.id}: ${id} dominatedBy`).toBe(w.dominatedBy);
        expect.soft([...(v.missing ?? [])].sort(), `${c.id}: ${id} missing`).toEqual([...w.missing].sort());
        for (const m of ['aOp', 'delivered'] as const) {
          if (!w[m]) continue;
          for (const side of ['min', 'max'] as const) expect.soft(Math.abs((v[m]?.[side] ?? NaN) - w[m]![side]), `${c.id}: ${id} ${m}.${side}`).toBeLessThanOrEqual(c.tolerance.abs + c.tolerance.rel * Math.abs(w[m]![side]));
        }
      }
      const lists = r as unknown as { candidates: string[]; goodput: string[]; pruned: string[]; reference: string[]; capability: string[] };
      expect.soft([...lists.reference].sort(), `${c.id}: reference list`).toEqual([...e.lists.reference].sort());
      expect.soft([...lists.candidates].sort(), `${c.id}: candidates list`).toEqual([...e.lists.candidate].sort());
      expect.soft([...lists.goodput].sort(), `${c.id}: goodput list`).toEqual([...e.lists.goodput].sort());
      expect.soft([...lists.pruned].sort(), `${c.id}: pruned list`).toEqual([...e.lists.pruned].sort());
      expect.soft([...lists.capability].sort(), `${c.id}: capability list`).toEqual([...e.lists.capability].sort());
    }
  });
});
