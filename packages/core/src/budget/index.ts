/**
 * v5 hierarchical MTBF / MTTR budget of one design at one scale (docs/ASCEND_ALLOCATION_METHODOLOGY.html §5 and the Findings
 * tables; previously the per-size block of scripts/ascend-allocation-data.ts). For a topology scenario with the reference
 * mechanisms applied:
 *  - today: A_op nominal / derated in the MTBF / MTTR form (formula (1)), the per-layer split (Table 1), the MTTR decomposition
 *    (formula (4)), the hardware units with today's FIT, the window check (formula (6));
 *  - required: the budget B and the two ends of the requirement (formula (2)) on the derated design;
 *  - hardwareOnly: reference ① — hardware alone (allocateStrategy mttf-first, ARINC uniform factor);
 *  - optimal: HAC-D's least-effort plan over the candidate mechanisms and the recovery levers (allocateStrategy optimal, ARINC);
 *  - recommended: the window rule (recommendPlan) from the optimal plan; the final design decomposed by layer (nominal and
 *    derated twins), by hardware unit (allowed FIT = today × k, MTBF per unit), by chain rung and recovery stage, with every
 *    applied mechanism's parameters nominal and derated, the lever values, and the pause each applied mechanism removes per layer
 *    (removed from the final design, nominal; R-SDC goes with D-SDC).
 * `BudgetResult` is the shape of one `archs.<id>.sizes.<N>` block of docs/backup/ascend-allocation/results.json; the v4.4 data
 * reproduces from it to 1e-9 (fixed seeds). 口径: as the KPI form; FIT = business-impact interruptions per unit-hour × 1e9.
 */
import type { VariantSummary } from './variants.js';
import type { Scenario } from '../scenario/schema.js';
import type { TrainingKpis } from '../scenario/evaluate.js';
import { computeCounts, type Counts } from '../scenario/build.js';
import { topologyBom, DOMAIN_UNIT, type BomRow, type FaultUnit } from '../topology/index.js';
import { toPerHour } from '../units/index.js';
import { allocateStrategy, applyLevers, withHardwareFactors, hardwareClasses, DEFAULT_LEVERS, type LeverId, type RecoveryLever, type StrategyPlan, type StrategyResult } from '../strategy/index.js';
import { recommendPlan, windowCheck, deratedOf, type WindowCheck, type WindowRulePlan, type WindowRuleTrial } from '../strategy/window.js';
import { requirementFromKpi, type Requirement } from '../strategy/requirement.js';
import { applyMechanismsInOrder, stripMechanisms, mechanismById, DEFAULT_PLAYERS, type MechanismKind } from '../mechanisms/index.js';
import { DERATE_DEFAULT, derateParameters, type DerateSpec } from '../mechanisms/plan.js';
import { minWindowTrials } from '../math/stats.js';
import { kpiForm, trainingOf, metricValue, type KpiForm, type BudgetMetric } from './kpiForm.js';
import { mttrDecomposition, type MttrDecomposition } from '../mttr/decompose.js';
import { byLayer, layerModel, lossBreakdown, DEFAULT_LAYERS, type LayerDef, type LayerId, type LayerModel, type LayerModelSpec, type LayerClassRow, type LossBreakdown } from '../layers/index.js';

export interface BudgetOptions {
  target: number;
  /**
   * v5.6 the acceptance metric the target, the requirement (formula 2 / 2′), the k search, the window rule and the layer split run on:
   * the effective goodput (default since 2026-10-28, the report's 口径) or A_op (the v4.4–v5.5 reports)
   */
  metric?: BudgetMetric;
  /** candidate mechanisms of the allocation (library ids) and their parameter overrides */
  candidates: string[];
  parameters?: Record<string, Record<string, number>>;
  efforts?: Record<string, number>;
  /** recovery levers (default DEFAULT_LEVERS) */
  levers?: RecoveryLever[];
  /** the reference set already applied to the scenario (default DEFAULT_PLAYERS) */
  reference?: string[];
  derate?: DerateSpec;
  /** window check: 30-day windows (default 400, seed 1, required 0.9) */
  trials?: number;
  seed?: number;
  required?: number;
  /** layer model (default: the six layers; the SuperPoD instance = one supernode) */
  layers?: LayerDef[];
  layerSpec?: LayerModelSpec;
  onProgress?: (step: string) => void;
}

export interface LayerBudget {
  lam: number; c: number; iso: number; sdc: number; mttrS: number;
  cDerated: number; isoDerated: number; sdcDerated: number; mttrDeratedS: number;
  /** v5.6 the recompute the layer's rollbacks cause (Σλ_i P_rb,i W, s/h) and the loss per interruption r_ℓ = (C_ℓ + Q_ℓ)/λ_ℓ (s), nominal and derated */
  recompute: number; recomputeDerated: number; lossS: number; lossDeratedS: number;
  instances: number; mtbfH: number | null; mtbfInstanceH: number | null;
  rows: LayerClassRow[];
}
export interface UnitBudgetRow {
  id: string; name: BomRow['name']; level: BomRow['level']; faultUnit: FaultUnit | undefined; count: number; perNpu: number;
  fitToday: number; fitAllowed: number; mtbfTodayH: number; mtbfAllowedH: number; hardPerHourToday: number; hardPerHourAllowed: number;
  blastRadiusNpus: number | null; confidence: BomRow['confidence'];
  /**
   * v5 provenance of the FIT itself (`confidence` above is the count's, from the template geometry): the hard classes on this
   * row's fault unit whose failure provenance is not the unit library's 'assumed' — i.e. classes replaced by a failure-rate
   * override (applyFaultRates) with another confidence — with their FIT per unit-hour. Absent when every class is the library's.
   */
  fitProvenance?: { id: string; fit: number; confidence: string; source: string }[];
}
/** per-layer summary of a design (nominal and derated twins) */
export interface DesignSummary {
  kpi: KpiForm; kpiDerated: KpiForm;
  layers: Record<LayerId, LayerBudget>;
  mttr: { nom: MttrDecomposition; der: MttrDecomposition };
  units: UnitBudgetRow[];
  k: number;
  /** v5.6 the split of 1 − metric into the layers' shares and the non-hardware lines (formula 3 / 3′), nominal and derated */
  metric: BudgetMetric;
  loss: LossBreakdown; lossDerated: LossBreakdown;
}
export interface AppliedMechanism { id: string; order: number; kind: MechanismKind; effort: number; nominal: Record<string, number>; derated: Record<string, number> }
export interface LeverValues { autoSeconds: number; success: number; manualSeconds: number }
export interface BudgetResult {
  npus: number;
  /** v5.8 inputs of the scenario the training model and the window ledger do not use (absent when none; method & code review P1-②) */
  unmodelled?: NonNullable<TrainingKpis['unmodelled']>;
  counts: Counts;
  instances: Record<LayerId, number>;
  bomRows: { id: string; name: BomRow['name']; level: BomRow['level']; count: number; perNpu: number; faultUnit: FaultUnit | null; fitHard: number | null; hardPerHour: number | null; confidence: BomRow['confidence'] }[];
  hardFitPerNpu: Partial<Record<FaultUnit, number>>;
  hardFitPerNpuTotal: number;
  hardPerHour: number;
  today: DesignSummary & { window: WindowCheck; aOp: number; aOpDerated: number; /** v5.6 the acceptance metric nominal / derated, and both goodputs */ value: number; valueDerated: number; effective: number; effectiveDerated: number; delivered: number; deliveredDerated: number };
  required: Requirement;
  hardwareOnly: { needed: boolean; factor: number | null; slack: number | null; final: number; finalDerated: number; effort: number };
  optimal: {
    feasible: boolean; mechanisms: string[]; levers: LeverId[]; needed: boolean; factor: number | null; slack: number | null; final: number; finalDerated: number;
    effort: StrategyResult['effort']; verification: StrategyResult['verification'] | null;
    alternatives: { mechanisms: string[]; levers: LeverId[]; effort: number; value: number; derated: number; feasible: boolean }[]; evaluations: number;
    /** v5.8 exact enumeration of the move subsets or the greedy descent (method & code review 2026-10-29, §3.6) */
    solver: NonNullable<StrategyResult['solver']>;
  };
  recommended: {
    mechanisms: string[]; levers: LeverId[]; k: number; kMean: number | null; kPlan: number | null; binding: 'window' | 'mean' | 'none'; escalated: boolean; tried: WindowRuleTrial[];
    /** v5.6 false when no move set meets the target: every move is on at k = 1 and `ceiling` is the metric with perfect hardware */
    feasible: boolean; ceiling: WindowRulePlan['ceiling'];
    /** v5.8 why no move set meets the target (absent when feasible): 'ceiling' | 'constraints' | 'window' */
    cause?: WindowRulePlan['cause'];
    /** v5.8 a feasible plan's window verdict is its acceptance on replications the search never drew; `search` the search's check at k */
    window: WindowCheck; search?: WindowCheck; windowPlan: WindowCheck | null; effort: WindowRulePlan['effort'];
    /** v5.8 classes kept at today's FIT (fixed or floor 1) and classes stopped at their floor (each absent when empty) */
    fixedClasses?: string[]; atFloor?: string[];
    applied: AppliedMechanism[];
    leverValues: { nominal: LeverValues | null; derated: LeverValues | null };
    plan: { aOp: number; aOpDerated: number; value: number; valueDerated: number };
    final: DesignSummary;
    /** pause (A_op basis) or pause plus recompute (goodput basis, v5.7) each applied mechanism removes per layer (seconds per hour, nominal, removed from the final design) and its A_op / effective / delivered goodput value */
    removal: Record<string, { byLayer: Record<LayerId, number>; aOp: number; delivered: number; effective: number }>;
  };
}

/**
 * the fault unit a component's fault type sits on — the rule of topologyBom (module-private there): a per-card class
 * (countRule.per 'gpu') sits on the job unit when its catalog domain does, else on the NPU; every other count rule names its unit
 */
const PER_UNIT: Partial<Record<string, FaultUnit>> = { gpu: 'npu', cpu: 'cpu', node: 'node', rack: 'cabinet', ub_switch: 'ub-switch', optical_link: 'ub-link', roce_switch: 'roce-switch', roce_link: 'roce-link' };
const unitOfClass = (c: Scenario['components'][number]): FaultUnit | undefined => {
  if (c.countRule.per !== 'gpu') return PER_UNIT[c.countRule.per];
  const d = c.id.replace(/@.*$/, '').replace(/-(hard|slow|sdc)$/, '');
  return !c.id.includes('@roce') && DOMAIN_UNIT[d] === 'job' ? 'job' : 'npu';
};
/** v5 the hard classes per fault unit whose FIT provenance is not the library's 'assumed' (the override's confidence for Table 3) */
function fitProvenanceByUnit(sc: Scenario): Partial<Record<FaultUnit, NonNullable<UnitBudgetRow['fitProvenance']>>> {
  const out: Partial<Record<FaultUnit, NonNullable<UnitBudgetRow['fitProvenance']>>> = {};
  for (const c of sc.components) {
    const p = c.failure.provenance;
    if (!c.enabled || !p || p.confidence === 'assumed' || c.countRule.per === 'fixed') continue;
    const fit = toPerHour(c.failure.value, c.failure.unit) * 1e9 * c.countRule.factor;
    const u = unitOfClass(c);
    if (!u || !(fit > 0)) continue;
    (out[u] ??= []).push({ id: c.id, fit, confidence: p.confidence, source: p.source });
  }
  return out;
}

/**
 * the hardware units of the BOM with today's FIT and the allowed FIT at a uniform factor k; v5.8 with the per-class factors of the
 * window rule (fixed classes kept, floors respected) the allowed FIT of a unit is the BOM of the factored classes
 */
export function unitTable(sc: Scenario, k: number, factors?: Record<string, number>): UnitBudgetRow[] {
  const bom = topologyBom(sc);
  const prov = fitProvenanceByUnit(sc);
  const factored = factors ? new Map(topologyBom(withHardwareFactors(sc, factors)).rows.map((r) => [r.id, r.fit?.hard])) : undefined;
  return bom.rows.filter((r) => r.faultUnit && r.fit && r.fit.hard > 0).map((r) => {
    const today = r.fit!.hard, allowed = factored?.get(r.id) ?? today * k;
    return { id: r.id, name: r.name, level: r.level, faultUnit: r.faultUnit, count: r.count, perNpu: r.perNpu, fitToday: today, fitAllowed: allowed, mtbfTodayH: 1e9 / today, mtbfAllowedH: 1e9 / allowed, hardPerHourToday: r.hardPerHour ?? 0, hardPerHourAllowed: (r.hardPerHour ?? 0) * (factored ? allowed / today : k), blastRadiusNpus: r.blastRadiusNpus ?? null, confidence: r.confidence, ...(prov[r.faultUnit!] ? { fitProvenance: prov[r.faultUnit!] } : {}) };
  });
}

/** per-layer summary of a design (nominal and derated twins); `base` is the bare hardware for the unit table, `factors` the window rule's per-class factors */
export function designSummary(n: number, base: Scenario, nom: Scenario, der: Scenario, counts: Counts, k: number, model: LayerModel, tNom?: TrainingKpis, tDer?: TrainingKpis, metric: BudgetMetric = 'aOp', factors?: Record<string, number>): DesignSummary {
  const N = byLayer(nom, tNom, model.layers), D = byLayer(der, tDer, model.layers);
  const inst = model.instances(n, counts);
  const layers = Object.fromEntries(model.layers.map((l) => {
    const a = N.levels[l.id], d = D.levels[l.id];
    return [l.id, { lam: a.lam, c: a.c, iso: a.iso, sdc: a.sdc, mttrS: a.lam > 0 ? a.c / a.lam : 0, cDerated: d.c, isoDerated: d.iso, sdcDerated: d.sdc, mttrDeratedS: d.lam > 0 ? d.c / d.lam : 0, recompute: a.recompute, recomputeDerated: d.recompute, lossS: a.lam > 0 ? (a.c + a.recompute) / a.lam : 0, lossDeratedS: d.lam > 0 ? (d.c + d.recompute) / d.lam : 0, instances: inst[l.id], mtbfH: a.lam > 0 ? 1 / a.lam : null, mtbfInstanceH: a.lam > 0 ? inst[l.id] / a.lam : null, rows: a.rows }];
  })) as Record<LayerId, LayerBudget>;
  return { kpi: N.k, kpiDerated: D.k, layers, mttr: { nom: mttrDecomposition(nom, tNom), der: mttrDecomposition(der, tDer) }, units: unitTable(base, k, factors), k, metric, loss: lossBreakdown(N, model.layers, metric), lossDerated: lossBreakdown(D, model.layers, metric) };
}

const planRow = (p: StrategyPlan) => ({ mechanisms: p.mechanisms, levers: p.levers, effort: p.effort.total, value: p.value, derated: p.derated, feasible: p.feasible });

/** the hierarchical budget of one topology scenario (reference mechanisms applied) at its own scale */
export function hierarchicalBudget(s: Scenario, o: BudgetOptions): BudgetResult {
  if (s.workload.type !== 'training') throw new Error('hierarchicalBudget needs a training workload');
  const n = s.workload.nGpus;
  const TARGET = o.target, TRIALS = o.trials ?? 400, SEED = o.seed ?? 1, REQUIRED = o.required ?? 0.9, METRIC: BudgetMetric = o.metric ?? 'effective';
  // fewer windows than the Wilson bound allows can never be 'supported': the window rule would escalate through every move and fail (fifth review D7)
  if (TRIALS < minWindowTrials(REQUIRED)) throw new Error(`hierarchicalBudget: ${TRIALS} windows cannot support P(A_op ≥ A*) ≥ ${REQUIRED} per window (Wilson 95 % lower bound n/(n + z²)); use at least ${minWindowTrials(REQUIRED)} windows (formula 6)`);
  const LEVERS = o.levers ?? DEFAULT_LEVERS, REF = o.reference ?? DEFAULT_PLAYERS, derate = o.derate ?? DERATE_DEFAULT, params = o.parameters ?? {};
  const model = layerModel(o.layerSpec, o.layers ?? DEFAULT_LAYERS);
  const log = o.onProgress ?? (() => {});
  const paramsOf = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { ...mechanismById(id).parameters, ...(params[id] ?? {}) }]));

  const t = trainingOf(s), sDer = deratedOf(s, derate);
  const bom = topologyBom(s), counts = bom.counts;
  log('today');
  const today = designSummary(n, s, s, sDer, counts, 1, model, t, undefined, METRIC);
  const kD = today.kpiDerated;
  const required = requirementFromKpi(kD, TARGET, METRIC);
  log('window check of today');
  const todayWindow = windowCheck(s, TARGET, TRIALS, SEED, REQUIRED, METRIC);
  log('hardware alone');
  const hwOnly = allocateStrategy(s, { strategy: 'mttf-first', metric: METRIC, target: TARGET, candidates: [], levers: false, hardwareSplit: 'arinc', derate });
  const hwFactor = hwOnly.hardware.needed ? Math.min(...hwOnly.hardware.rows.map((h) => h.factor)) : null;
  log('optimal plan');
  const opt = allocateStrategy(s, { strategy: 'optimal', metric: METRIC, target: TARGET, candidates: o.candidates, parameters: params, efforts: o.efforts, levers: LEVERS, hardwareSplit: 'arinc', derate, verify: { trials: TRIALS, seed: SEED } });
  const optFactor = opt.hardware.needed ? Math.min(...opt.hardware.rows.map((h) => h.factor)) : null;
  log('window rule');
  const rec = recommendPlan(s, { candidates: o.candidates, parameters: params, efforts: o.efforts, mechanisms: opt.mechanisms, leverIds: opt.levers, levers: LEVERS, derate, target: TARGET, trials: TRIALS, seed: SEED, required: REQUIRED, metric: METRIC, onInfeasible: 'best', onProgress: log });
  const fin = designSummary(n, s, rec.nom, rec.der, counts, rec.k, model, undefined, undefined, METRIC, rec.factors);
  // v5.8 the classes the constraints hold: fixed (or floor 1), and those an improvement stopped at their floor
  const atFloor = rec.k < 1 ? hardwareClasses(s).filter((h) => !h.fixed && h.floor < 1 && h.floor > rec.k).map((h) => h.id) : [];
  // the design's mechanisms with their parameters, nominal and derated
  const applied: AppliedMechanism[] = Object.entries(rec.nom.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id, r]) => ({ id, order: r.order, kind: mechanismById(id).kind, effort: o.efforts?.[id] ?? mechanismById(id).effort, nominal: r.parameters, derated: rec.der.mechanisms.applied?.[id]?.parameters ?? derateParameters(r.parameters, derate) }));
  const leverValuesOf = (d: Scenario): LeverValues | null => (d.recovery.mode === 'mixture' ? { autoSeconds: d.recovery.automatic.seconds, success: d.recovery.automatic.successProbability, manualSeconds: d.recovery.manual.seconds } : null);
  const leverValues = { nominal: leverValuesOf(rec.nom), derated: leverValuesOf(rec.der) };
  // loss each applied mechanism removes per layer (nominal, removed from the final design; R-SDC goes with D-SDC)
  log('removal per mechanism');
  const bare = stripMechanisms(s, [...REF]);
  const allIds = applied.map((a) => a.id);
  const kFactors = rec.factors;
  // rebuilt in the final design's recorded order (`allIds` is sorted by it; a `keep` subset keeps that order): the reference set as the
  // project applied it, then the plan's additions — a library-order rebuild is not the same design when transforms do not commute (v5.5)
  const rebuild = (keep: string[]) => withHardwareFactors(applyLevers(applyMechanismsInOrder(bare, keep, paramsOf(keep)), LEVERS.filter((l) => rec.levers.includes(l.id)), null), kFactors);
  { const tr = trainingOf(rebuild(allIds)); if (Math.abs(tr.operationalAvailability - fin.kpi.aOp) > 1e-9 || Math.abs(metricValue(tr, METRIC) - metricValue(trainingOf(rec.nom), METRIC)) > 1e-9) throw new Error(`rebuilt final design differs: ${tr.operationalAvailability} vs ${fin.kpi.aOp}`); }
  const removal = Object.fromEntries(allIds.map((id) => {
    const keep = allIds.filter((x) => x !== id && !(id === 'D-SDC' && x === 'R-SDC'));
    const lv = byLayer(rebuild(keep), undefined, model.layers);
    const base = fin.layers;
    // v5.7 (sixth review M4) on the goodput basis the layer's loss is its pause plus the recompute of the rollbacks it causes (formula 3′),
    // so a mechanism that acts through the recompute (C-ASYNC's durable lag) shows in the per-layer column, not only in the metric's gain
    const lossOf = (c: number, iso: number, sdc: number, q: number) => c + iso + sdc + (METRIC === 'aOp' ? 0 : q);
    return [id, { byLayer: Object.fromEntries(model.layers.map((l) => [l.id, lossOf(lv.levels[l.id].c, lv.levels[l.id].iso, lv.levels[l.id].sdc, lv.levels[l.id].recompute) - lossOf(base[l.id].c, base[l.id].iso, base[l.id].sdc, base[l.id].recompute)])) as Record<LayerId, number>, aOp: fin.kpi.aOp - lv.k.aOp, delivered: fin.kpi.delivered - lv.k.delivered, effective: fin.kpi.effective - lv.k.effective }];
  }));
  return {
    npus: n, ...(t.unmodelled ? { unmodelled: t.unmodelled } : {}), counts, instances: model.instances(n, counts),
    bomRows: bom.rows.map((r) => ({ id: r.id, name: r.name, level: r.level, count: r.count, perNpu: r.perNpu, faultUnit: r.faultUnit ?? null, fitHard: r.fit?.hard ?? null, hardPerHour: r.hardPerHour ?? null, confidence: r.confidence })),
    hardFitPerNpu: bom.hardFitPerNpu, hardFitPerNpuTotal: bom.hardFitPerNpuTotal, hardPerHour: bom.hardPerHour,
    today: { ...today, window: todayWindow, aOp: today.kpi.aOp, aOpDerated: today.kpiDerated.aOp, value: METRIC === 'aOp' ? today.kpi.aOp : today.kpi.effective, valueDerated: METRIC === 'aOp' ? today.kpiDerated.aOp : today.kpiDerated.effective, effective: today.kpi.effective, effectiveDerated: today.kpiDerated.effective, delivered: today.kpi.delivered, deliveredDerated: today.kpiDerated.delivered },
    required,
    hardwareOnly: { needed: hwOnly.hardware.needed, factor: hwFactor, slack: hwOnly.hardware.slackFactor ?? null, final: hwOnly.final.value, finalDerated: hwOnly.final.derated, effort: hwOnly.effort.total },
    optimal: { feasible: opt.feasible, mechanisms: opt.mechanisms, levers: opt.levers, needed: opt.hardware.needed, factor: optFactor, slack: opt.hardware.slackFactor ?? null, final: opt.final.value, finalDerated: opt.final.derated, effort: opt.effort, verification: opt.verification ?? null, alternatives: (opt.alternatives ?? []).slice(0, 6).map(planRow), evaluations: opt.evaluations, solver: opt.solver! },
    recommended: { mechanisms: rec.mechanisms, levers: rec.levers, k: rec.k, kMean: rec.kMean, kPlan: rec.kPlan, binding: rec.binding, escalated: rec.escalated, tried: rec.tried, feasible: rec.feasible, ...(rec.cause ? { cause: rec.cause } : {}), ceiling: rec.ceiling, window: rec.window, ...(rec.search ? { search: rec.search } : {}), windowPlan: rec.windowPlan, effort: rec.effort, ...(rec.fixedClasses.length ? { fixedClasses: rec.fixedClasses } : {}), ...(atFloor.length ? { atFloor } : {}), applied, leverValues, plan: { aOp: trainingOf(rec.planNom).operationalAvailability, aOpDerated: trainingOf(rec.planDer).operationalAvailability, value: metricValue(trainingOf(rec.planNom), METRIC), valueDerated: metricValue(trainingOf(rec.planDer), METRIC) }, final: fin, removal },
  };
}

/** the mechanism library table of a budget document: name, kind, effort, change, requires, parameters nominal and derated */
export function mechanismLibraryTable(ids: string[], parameters: Record<string, Record<string, number>> = {}, derate: DerateSpec = DERATE_DEFAULT, efforts: Record<string, number> = {}) {
  return Object.fromEntries(ids.map((id) => { const m = mechanismById(id); const p = { ...m.parameters, ...(parameters[id] ?? {}) }; return [id, { name: m.name, kind: m.kind, effort: efforts[id] ?? m.effort, change: m.change, requires: m.requires ?? [], nominal: p, derated: derateParameters(p, derate) }]; }));
}

export interface BudgetArchInput {
  name: { zh: string; en: string };
  short: { zh: string; en: string };
  family: string;
  assumed: (string | { zh: string; en: string })[];
  /** the scenario at n NPUs with the reference mechanisms applied */
  build: (n: number) => Scenario;
  layerSpec?: LayerModelSpec;
}
export interface BudgetDocumentOptions extends Omit<BudgetOptions, 'layerSpec' | 'onProgress'> {
  sizes: number[];
  /** the headline scale of the reports */
  main?: number;
  onProgress?: (arch: string, n: number, step: string) => void;
}
export interface BudgetDocument {
  generated: string;
  /** v5.6 the acceptance metric of the whole document */
  metric: BudgetMetric;
  target: number; sizes: number[]; main: number; trials: number;
  /** required P(A_op ≥ A*) per window of the window rule (Wilson lower bound) */
  required: number;
  derate: DerateSpec; candidates: string[]; levers: RecoveryLever[]; reference: string[]; layers: LayerDef[];
  archs: Record<string, { name: { zh: string; en: string }; short: { zh: string; en: string }; family: string; assumed: (string | { zh: string; en: string })[]; layers?: LayerModelSpec; sizes: Record<string, BudgetResult> }>;
  mechanismLibrary: ReturnType<typeof mechanismLibraryTable>;
  /** v5.9 appendix variants (`hacd findings --variants`): the budget under alternative mechanism sets, reduced to the rows of Appendix A (`variantSummary`); the main tables never read them */
  variants?: VariantSummary[];
}
/** the budget of several architectures at several scales: the shape of docs/backup/ascend-allocation/results.json */
export function budgetDocument(archs: Record<string, BudgetArchInput>, o: BudgetDocumentOptions): BudgetDocument {
  const LEVERS = o.levers ?? DEFAULT_LEVERS, REF = o.reference ?? DEFAULT_PLAYERS, derate = o.derate ?? DERATE_DEFAULT;
  const out: BudgetDocument = { generated: new Date().toISOString(), metric: o.metric ?? 'effective', target: o.target, sizes: o.sizes, main: o.main ?? o.sizes[o.sizes.length - 1], trials: o.trials ?? 400, required: o.required ?? 0.9, derate, candidates: o.candidates, levers: LEVERS, reference: REF, layers: o.layers ?? DEFAULT_LAYERS, archs: {}, mechanismLibrary: mechanismLibraryTable([...REF, ...o.candidates], o.parameters ?? {}, derate, o.efforts ?? {}) };
  for (const [arch, A] of Object.entries(archs)) {
    const sizes: Record<string, BudgetResult> = {};
    for (const n of o.sizes) sizes[String(n)] = hierarchicalBudget(A.build(n), { ...o, layerSpec: A.layerSpec, onProgress: (step) => o.onProgress?.(arch, n, step) });
    out.archs[arch] = { name: A.name, short: A.short, family: A.family, assumed: A.assumed, ...(A.layerSpec ? { layers: A.layerSpec } : {}), sizes };
  }
  return out;
}

/* ---------------- records → budget document ---------------- */
import { scenarioFromRecord, type TopologyRecord } from '../records/topologyRecord.js';
import { resolveMechanismSet, applyMechanismSet, withRecoveryBaseline, type MechanismSet } from '../records/mechanismSet.js';
import { applyFaultRates, type FaultRateOverride } from '../records/faultRates.js';

export interface BudgetRunOptions {
  sizes: number[];
  target: number;
  /** v5.6 the acceptance metric (default the effective goodput) */
  metric?: BudgetMetric;
  main?: number;
  trials?: number;
  seed?: number;
  required?: number;
  /** failure-rate override applied to every scenario (per unit or per card) */
  rates?: FaultRateOverride;
  /** scale-out variant of the record (default the main design) */
  variantId?: string;
  onProgress?: (arch: string, n: number, step: string) => void;
}
/**
 * the scenario of a record at N with the mechanism set's recovery baseline (the MTTR mixture of `set.recovery` and its stage
 * split, written on the bare design: v5.5, fifth review D3 — the default set's equals the template's, so the public reports are
 * unchanged, while an internal set with a measured baseline now reaches every record-built scenario), the optional failure-rate
 * override and the set's baseline mechanisms with the set's parameters
 */
export function recordScenario(record: TopologyRecord, set: MechanismSet, n: number, rates?: FaultRateOverride, variantId?: string): Scenario {
  const r = resolveMechanismSet(set);
  let s = withRecoveryBaseline(scenarioFromRecord(record, n, variantId, { mechanisms: [] }), set);
  if (rates) s = applyFaultRates(s, rates);
  return applyMechanismSet(s, set, r.baseline);
}
/** the budget document of topology records under a mechanism set (the results.json of a report set) */
export function budgetFromRecords(records: TopologyRecord[], set: MechanismSet, o: BudgetRunOptions): BudgetDocument {
  const r = resolveMechanismSet(set);
  const archs: Record<string, BudgetArchInput> = Object.fromEntries(records.map((rec) => [rec.id, { name: rec.name, short: rec.short, family: rec.family, assumed: rec.assumed, build: (n: number) => recordScenario(rec, set, n, o.rates, o.variantId), layerSpec: rec.layers }]));
  return budgetDocument(archs, { sizes: o.sizes, target: o.target, metric: o.metric, main: o.main, trials: o.trials, seed: o.seed, required: o.required, candidates: r.candidates, parameters: r.parameters, efforts: set.efforts, levers: r.levers, reference: r.baseline, derate: r.derate, onProgress: o.onProgress });
}
