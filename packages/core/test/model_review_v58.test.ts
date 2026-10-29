/**
 * v5.8 the external method & code review of 2026-10-29 (HAC-D-method-code-review.md; decisions in
 * docs/markdown/METHOD_CODE_REVIEW_RESPONSE_2026-10-29.md) — regression tests of the suggestions taken, on the review's own
 * counterexamples where it gave them:
 *  ① the window rule obeys the classes' constraints (fixed, floor, effort per halving) as the optimal strategy does
 *  ② the training model and the window ledger list the inputs they do not use (redundancy, common cause, distributions)
 *  ③ mechanism parameters outside their domain are rejected by the set schema, the ingest gate and the transforms
 *  ④ a recommended plan is accepted on windows the search never drew
 *  §3.6 the optimal strategy records exact enumeration or the greedy descent; §4 no NaN without hard interruptions
 */
import { describe, it, expect } from 'vitest';
import { recordScenario } from '../src/budget/index.js';
import { BUILTIN_TOPOLOGY_RECORDS } from '../src/records/topologyRecord.js';
import { DEFAULT_MECHANISM_SET, parseMechanismSet, resolveMechanismSet, type MechanismSetInput } from '../src/records/mechanismSet.js';
import { kpiForm, trainingOf } from '../src/budget/kpiForm.js';
import { requirementFromKpi } from '../src/strategy/requirement.js';
import { allocateStrategy, hardwareClasses, arincFactors, hardwareEffortOf } from '../src/strategy/index.js';
import { recommendPlan, windowCheck } from '../src/strategy/window.js';
import { applyMechanisms, MECHANISM_LIBRARY } from '../src/mechanisms/index.js';
import { derateParameters, DERATE_DEFAULT } from '../src/mechanisms/plan.js';
import { parameterIssue, parameterDomain } from '../src/mechanisms/parameters.js';
import { validateMechanismSet } from '../src/ingest/validate.js';
import { fieldSpecs } from '../src/ingest/fields.js';
import { buildLedgerRun } from '../src/mc/ledgerFromScenario.js';
import { evaluateScenario } from '../src/scenario/evaluate.js';
import { atlas950Training, workedExample1 } from '../src/scenario/examples.js';
import type { Scenario } from '../src/scenario/schema.js';

const rec = (id: keyof typeof BUILTIN_TOPOLOGY_RECORDS, n: number) => recordScenario(BUILTIN_TOPOLOGY_RECORDS[id], DEFAULT_MECHANISM_SET, n);
const RS = resolveMechanismSet(DEFAULT_MECHANISM_SET);
/** every hardware class of the scenario with the given allocation fields */
const withAllocation = (s: Scenario, a: (id: string) => Record<string, unknown> | undefined): Scenario => ({ ...s, components: s.components.map((c) => { const x = a(c.id); return x && c.enabled && c.failure.value > 0 ? { ...c, allocation: { ...(c.allocation ?? {}), ...x } } : c; }) });
const windowRule = (s: Scenario, o: Partial<Parameters<typeof recommendPlan>[1]> = {}) => recommendPlan(s, { target: 0.985, metric: 'aOp', candidates: RS.candidates, parameters: RS.parameters, efforts: DEFAULT_MECHANISM_SET.efforts, mechanisms: [], leverIds: [], levers: RS.levers, derate: RS.derate, trials: 40, seed: 1, onInfeasible: 'best', ...o });

describe('③ mechanism parameters inside their domains', () => {
  it('the review’s R-REPLAY success 1.5 / failureSeconds −9 fails the set schema and the ingest gate, and a transform refuses it', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_MECHANISM_SET)) as MechanismSetInput & { parameters: Record<string, Record<string, number>> };
    raw.parameters['R-REPLAY'] = { ...(raw.parameters['R-REPLAY'] ?? {}), success: 1.5, failureSeconds: -9 };
    expect(() => parseMechanismSet(raw)).toThrow(/parameters\.R-REPLAY\.success: R-REPLAY: success = 1\.5 is outside its domain \[0, 1\].*parameters\.R-REPLAY\.failureSeconds/);
    const issues = validateMechanismSet(raw as never).filter((i) => i.code === 'out-of-domain');
    expect(issues.map((i) => i.path)).toEqual(['parameters.R-REPLAY.success', 'parameters.R-REPLAY.failureSeconds']);
    expect(issues.every((i) => i.level === 'error')).toBe(true);
    const s = rec('native950', 10000);
    expect(() => applyMechanisms(s, ['R-NETFAIL'], { 'R-NETFAIL': { success: 1.5 } })).toThrow(/R-NETFAIL: success = 1\.5 is outside its domain/);
    expect(() => applyMechanisms(s, ['C-MEM'], { 'C-MEM': { computeSeconds: 0 } })).toThrow(/computeSeconds = 0 is outside its domain \(0, ∞\)/);
    expect(() => applyMechanisms(s, ['D-SDC-DMR'], { 'D-SDC-DMR': { overhead: 1 } })).toThrow(/overhead = 1 is outside/);
    expect(() => applyMechanisms(s, ['C-MEM'], { 'C-MEM': { saveSeconds: Number.NaN } })).toThrow(/not a finite number/);
    // a lever's success limit is a probability too
    expect(() => parseMechanismSet({ ...JSON.parse(JSON.stringify(DEFAULT_MECHANISM_SET)), levers: [{ id: 'success', limit: 1.2, effort: 3 }] })).toThrow(/levers\.0\.limit/);
  });
  it('every library default, provisional value and derated value lies inside its domain; the field specs carry the domain', () => {
    for (const m of MECHANISM_LIBRARY) {
      for (const p of [m.parameters, { ...m.parameters, ...(m.provisional ?? {}) } as Record<string, number>]) {
        for (const [k, v] of Object.entries(p)) expect(parameterIssue(k, v), `${m.id}.${k} = ${v}`).toBeNull();
        for (const [k, v] of Object.entries(derateParameters(p, DERATE_DEFAULT))) expect(parameterIssue(k, v), `${m.id}.${k} derated = ${v}`).toBeNull();
      }
    }
    expect(parameterDomain('failureSeconds')?.kind).toBe('seconds');
    expect(parameterIssue('success', 1)).toBeNull();
    expect(parameterIssue('remainingBandwidthRatio', 0)).not.toBeNull();
    const spec = fieldSpecs('mechanisms').find((f) => f.path === 'parameters.R-REPLAY.success');
    expect(spec?.about.en).toBe('mechanism parameter (probability, 0–1)');
  });
});

describe('① the window rule under the classes’ constraints', () => {
  it('the review’s counterexample: every hardware class fixed at 500k — the optimal strategy and the window rule both report infeasible, no class moves', () => {
    const s = withAllocation(rec('native950', 500000), () => ({ fixed: true, minLambdaFactor: 1 }));
    const opt = allocateStrategy(s, { strategy: 'optimal', metric: 'aOp', target: 0.985, candidates: RS.candidates, parameters: RS.parameters, levers: RS.levers, hardwareSplit: 'arinc', derate: RS.derate });
    const r = windowRule(s, { mechanisms: opt.mechanisms, leverIds: opt.levers });
    expect(opt.feasible).toBe(false);
    expect(r.feasible).toBe(false);
    expect(r.k).toBe(1);
    expect(Object.values(r.factors).every((x) => x === 1)).toBe(true);
    expect(r.hardwareClasses).toEqual([]);
    expect(r.fixedClasses.length).toBe(20);
    expect(r.effort.hardware).toBe(0);
    // no free class: perfect hardware is today's hardware, so the ceiling is the all-moves design itself
    expect(r.cause).toBe('ceiling');
    expect(r.ceiling!.derated).toBeCloseTo(trainingOf(r.der).operationalAvailability, 12);
  });
  it('fixed classes keep today’s FIT, floors stop an improvement, the effort is Σ e_i log2(1/x_i); floors that bind are the cause', () => {
    const s0 = rec('native950', 500000);
    const ids = hardwareClasses(s0).map((h) => h.id);
    const fixed = new Set(ids.filter((_id, i) => i % 2 === 0));
    const s = withAllocation(s0, (id) => (fixed.has(id) ? { fixed: true } : { minLambdaFactor: 0.6, effortPerHalving: 5 }));
    const r = windowRule(s, { mechanisms: RS.candidates, leverIds: ['auto', 'success', 'manual'] });
    expect(r.feasible).toBe(true);
    for (const id of fixed) expect(r.factors[id]).toBe(1);
    for (const id of r.hardwareClasses) expect(r.factors[id]).toBeCloseTo(Math.max(0.6, Math.min(1, r.k)), 12);
    expect(r.effort.hardware).toBeCloseTo(hardwareEffortOf(hardwareClasses(s), r.factors), 12);
    expect(r.effort.hardware).toBeCloseTo(r.k < 1 ? r.hardwareClasses.length * 5 * Math.log2(1 / Math.max(0.6, r.k)) : 0, 9);
    expect(trainingOf(r.der).operationalAvailability).toBeGreaterThanOrEqual(0.985 - 1e-12);
    // floors of 0.98 cannot close the gap that k ≈ 0.9 closes on every class: infeasible within the constraints, reachable with perfect hardware
    const tight = withAllocation(s0, () => ({ minLambdaFactor: 0.98 }));
    const t = windowRule(tight, { mechanisms: RS.candidates, leverIds: ['auto', 'success', 'manual'] });
    expect(t.feasible).toBe(false);
    expect(t.cause).toBe('constraints');
    expect(t.ceiling!.derated).toBeGreaterThanOrEqual(0.985);
    expect(t.ceiling!.constrained!.derated).toBeLessThan(0.985);
    expect(arincFactors(hardwareClasses(tight), 0.5)[ids[0]]).toBe(0.98);
  });
});

describe('④ independent acceptance of a recommended plan', () => {
  it('the review’s counterexample (10k, baseline only, 40 windows): the search’s 40 / 40 is kept as `search`, the verdict comes from replications 40–79', () => {
    const s = rec('native950', 10000);
    const r = windowRule(s, { candidates: [], levers: [] });
    expect(r.feasible).toBe(true);
    expect(r.k).toBeCloseTo(14.545083, 5);
    expect(r.search!.pAtLeastTarget).toBe(1);
    expect(r.search!.verdict).toBe('supported');
    expect(r.search!.from).toBeUndefined();
    expect(r.window.from).toBe(40);
    expect(r.window).toEqual(windowCheck(r.nom, 0.985, 40, 1, 0.9, 'aOp', 40));
    // the review's independent 800 windows put P near 91 % at this k: the fresh 40 windows do not confirm the search's 100 %
    expect(r.window.pAtLeastTarget).toBeLessThan(1);
    expect(r.window.verdict).not.toBe('supported');
  });
});

describe('② inputs the training model and the window ledger do not use', () => {
  it('Atlas 950 training: the 1+1 power and CDU classes are listed, warned about and carried by the ledger run; a record scenario has none', () => {
    const s = atlas950Training();
    const ev = evaluateScenario(s, { structure: false });
    expect(ev.training!.unmodelled).toEqual({ redundancy: ['rack_power', 'comm_rack_power', 'cdu'], ccf: [], nonExponential: [] });
    expect(ev.warnings.some((w) => w.startsWith('redundancy of rack_power, comm_rack_power, cdu is not credited'))).toBe(true);
    expect(buildLedgerRun(s, { trials: 1 }).unmodelled?.redundancy).toEqual(['rack_power', 'comm_rack_power', 'cdu']);
    expect(trainingOf(rec('native950', 10000)).unmodelled).toBeUndefined();
    const w = { ...s, components: s.components.map((c, i) => (i === 0 ? { ...c, failure: { ...c.failure, weibullShape: 2 }, ccf: { domain: 'rack' as const, beta: 0.5 } } : c)) };
    const u = trainingOf(w).unmodelled!;
    expect(u.ccf).toEqual([s.components[0].id]);
    expect(u.nonExponential).toEqual([s.components[0].id]);
  });
});

describe('§3.6 the search scope and §4 the boundary without hard interruptions', () => {
  it('the optimal strategy records exact enumeration on A_op and the greedy descent beyond 6 moves on the goodput metrics', () => {
    const s = rec('a3server', 10000);
    const o = (metric: 'aOp' | 'effective') => allocateStrategy(s, { strategy: 'optimal', metric, target: 0.985, candidates: RS.candidates, parameters: RS.parameters, levers: RS.levers, hardwareSplit: 'arinc', derate: RS.derate });
    expect(o('aOp').solver).toEqual({ mode: 'exact', moves: 9, exactUpTo: 10 });
    expect(o('effective').solver).toEqual({ mode: 'greedy', moves: 9, exactUpTo: 6 });
  });
  it('Σλ = 0: MTTR and the loss per interruption are 0, the requirement’s two ends null, nothing NaN', () => {
    const s = workedExample1();
    const z = { ...s, components: s.components.map((c) => ({ ...c, failure: { ...c.failure, value: 0 } })) };
    const k = kpiForm(z);
    expect(k.lamHw).toBe(0);
    expect(k.mtbfHwH).toBe(Infinity);
    expect(k.mttrS).toBe(0);
    expect(k.lossS).toBe(0);
    for (const metric of ['aOp', 'effective'] as const) {
      const q = requirementFromKpi(k, 0.9, metric);
      expect([q.mtbfAtTodayMttrH, q.mttrAtTodayMtbfS, q.mtbfFactor, q.mttrFactor]).toEqual([null, null, null, null]);
      expect(Number.isNaN(q.ratioToday)).toBe(false);
    }
    // no NaN anywhere; an unbounded interval (MTBF, MTBI, an absent class's MTBF) is ∞ in memory and the explicit null of JSON
    expect(JSON.stringify(k)).not.toMatch(/NaN/);
    expect(JSON.parse(JSON.stringify(k)).mtbfHwH).toBeNull();
  });
});
