/**
 * v5 the mechanism Shapley study of one topology record under a mechanism set (docs/ASCEND_ALLOCATION_FINDINGS_* Table 7 and the
 * hierarchy's Shapley columns; previously scripts/arch-mechanism-shapley.ts): for every scale, `allocationStudy` on the record's
 * bare scenario (no mechanism applied — the set's baseline mechanisms are players like the others) with the set's appliable
 * mechanisms as players and the set's parameters: sampled Shapley values of A_op and delivered goodput (permutations, 95 %
 * half-width), single and last-added gains, and the planner's cheapest set meeting the target nominally and derated. The output is
 * the `StoredStudy` shape the hierarchy and the Findings recipe read (docs/backup/arch-mechanism-shapley/<record>.json).
 * v6.3: `studyOfBuild` is the same study over any builder of the scenario at N — the web app's Report tab passes a project at its
 * own geometry (`withSize`) — and `archStudy` is its record form; a project's applied players are stripped to reach the bare scenario.
 * v5.5 (fifth review D8): a project's recorded parameters replace the set's for its applied players (`parameters`), so the study
 * and the budget of one report share one parameter set; an applied mechanism outside the players stays in the base and is listed
 * in `fixed`. The record form writes the set's recovery baseline on the bare scenario (D3), as `recordScenario` does.
 * 口径: Shapley values in fractions of A_op / delivered goodput at each scale; the base is the bare architecture scenario.
 */
import type { Scenario } from '../scenario/schema.js';
import { allocationStudy, type StudyGain, type StudyResult } from './index.js';
import { stripMechanisms, mechanismById, DEFAULT_PLAYERS, applyMechanisms } from '../mechanisms/index.js';
import { scenarioFromRecord, type TopologyRecord } from '../records/topologyRecord.js';
import { resolveMechanismSet, withRecoveryBaseline, type MechanismSet } from '../records/mechanismSet.js';
import { applyFaultRates, type FaultRateOverride } from '../records/faultRates.js';
import { HIERARCHY_DEFAULT_IDS } from './hierarchy.js';
import { derateParameters } from '../mechanisms/plan.js';
import { trainingOf } from '../budget/kpiForm.js';

export interface ArchStudyOptions {
  sizes?: number[];
  target?: number;
  permutations?: number;
  seed?: number;
  /** failure-rate override applied to the bare scenario */
  rates?: FaultRateOverride;
  variantId?: string;
  /** parameters by mechanism replacing the set's for the ids given (a project's recorded parameters, merged over the set's by the caller) */
  parameters?: Record<string, Record<string, number>>;
  onProgress?: (n: number, done: number, total: number) => void;
}
/** the three value functions a study carries (v5.6: the effective goodput joins A_op and the delivered goodput) */
export type StudyValueMetric = 'aOp' | 'effective' | 'delivered';
export interface ArchStudySize {
  /** A_op of the bare scenario; `baselineBy` the three metrics (v5.6) */
  baseline: number;
  baselineBy: Record<StudyValueMetric, number>;
  plan: { ids: string[]; feasible: boolean; effort: number; nominal: number; derated: number };
  /** A_op with every player on, nominal and derated; `allOnBy` / `allOnDeratedBy` the three metrics (v5.6) */
  allOn: number;
  allOnDerated: number;
  allOnBy: Record<StudyValueMetric, number>;
  allOnDeratedBy: Record<StudyValueMetric, number>;
  gains: {
    id: string;
    /** 95 % half-width of the A_op Shapley; v5.7 `halfWidthBy` the three metrics' (sixth review F6) */
    halfWidth?: number;
    halfWidthBy?: Record<StudyValueMetric, number>;
    aOp: { single: number; lastAdded: number; shapley: number };
    effective: { shapley: number };
    delivered: { shapley: number };
    /**
     * v5.7 (sixth review F3) the gain of the mechanism on top of the set's reference mechanisms (with its prerequisites), nominal at
     * k = 1: the designs the allocation can build always hold the reference set, while the Shapley value averages over coalitions
     * without it; null for a reference player
     */
    onReference?: Record<StudyValueMetric, number> | null;
  }[];
  attribution: { method: 'exact' | 'sampled'; coalitions?: number; permutations?: number };
}
export interface ArchStudy {
  generated: string;
  arch: string;
  sizes: number[];
  target: number;
  permutations: number;
  players: string[];
  /** the set's baseline (the reference mechanisms are players here, not part of the base) */
  original: string[];
  extensions: string[];
  /** the set's parameter overrides (the study ran with them merged over the library defaults, `projectParameters` aside) */
  parameters: Record<string, Record<string, number>>;
  set: string;
  library: StudyResult['library'] | null;
  perSize: Record<string, ArchStudySize>;
  /** v5.5 a project study: the mechanisms whose parameters differ from the set's resolved values, with the parameters the study ran with */
  projectParameters?: Record<string, Record<string, number>>;
  /** v5.5 applied mechanisms of the built scenario that are not players (outside the set): kept in the base, not attributed */
  fixed?: string[];
}

/**
 * The study over any builder of the scenario at N (`id` names the architecture): one `allocationStudy` per scale on the bare
 * scenario — the built scenario with every player of the set stripped (a record scenario is built without mechanisms; a project
 * may carry some) and the optional failure-rate override applied.
 */
export function studyOfBuild(id: string, build: (n: number) => Scenario, set: MechanismSet, o: Omit<ArchStudyOptions, 'variantId'> = {}): ArchStudy {
  const r = resolveMechanismSet(set);
  const sizes = o.sizes ?? [10000, 100000, 200000, 500000];
  const target = o.target ?? 0.985, perms = o.permutations ?? 300, seed = o.seed ?? 1;
  // player order fixes the permutation sampler's draws for a given seed: the eight ReMAP originals first, then the audited
  // extensions in library order (the order of the stored v4.4 studies), then anything else the set lists
  const players = [...HIERARCHY_DEFAULT_IDS.filter((id) => r.players.includes(id)), ...r.players.filter((id) => !HIERARCHY_DEFAULT_IDS.includes(id))];
  const strip = [...new Set([...DEFAULT_PLAYERS, ...players])];
  const parameters = o.parameters ? { ...r.parameters, ...o.parameters } : r.parameters;
  // what the project changed against the set (a record's scenario changes nothing: its study equals archStudy's)
  const projectParameters = Object.fromEntries(Object.entries(o.parameters ?? {}).filter(([id, p]) => JSON.stringify(p) !== JSON.stringify(r.parameters[id] ?? { ...mechanismById(id).parameters })));
  const perSize: Record<string, ArchStudySize> = {};
  let library: StudyResult['library'] | null = null;
  let fixed: string[] | undefined;
  sizes.forEach((N, i) => {
    // one size per study: each size is built from the architecture's own geometry (count overrides scale with N)
    let s = build(N);
    if (o.rates) s = applyFaultRates(s, o.rates);
    fixed ??= Object.keys(s.mechanisms.applied ?? {}).filter((id) => !strip.includes(id));
    const bare = stripMechanisms(s, strip);
    const study = allocationStudy(bare, { sizes: [N], target, metric: 'aOp', players, parameters, trials: 0, seed, levers: false, curves: false, permutations: perms, derate: r.derate });
    const z = study.perSize[N];
    library ??= study.library;
    // v5.6 the three metrics of the bare and the all-on designs (the study's own all-on A_op must agree with the direct evaluation)
    // v5.7 the goodputs on the exact renewal model (the acceptance values)
    const by = (sc: Scenario): Record<StudyValueMetric, number> => { const tr = trainingOf(sc); return { aOp: tr.operationalAvailability, effective: tr.effectiveGoodputExact, delivered: tr.deliveredGoodputExact }; };
    const paramsOf = (ids: string[], derated: boolean) => Object.fromEntries(ids.map((id) => [id, derated ? derateParameters(parameters[id] ?? { ...mechanismById(id).parameters }, r.derate) : parameters[id] ?? { ...mechanismById(id).parameters }]));
    const allOnBy = by(applyMechanisms(bare, players, paramsOf(players, false))), allOnDeratedBy = by(applyMechanisms(bare, players, paramsOf(players, true)));
    // v5.7 (sixth review F3) each non-reference player on top of the reference set (and its prerequisites), nominal, k = 1
    const reference = r.baseline.filter((id) => players.includes(id));
    const refBy = by(applyMechanisms(bare, reference, paramsOf(reference, false)));
    const onReferenceOf = (id: string): Record<StudyValueMetric, number> | null => {
      if (reference.includes(id)) return null;
      const req = (mechanismById(id).requires ?? []).filter((x) => !reference.includes(x));
      const base = [...reference, ...req];
      const b = req.length ? by(applyMechanisms(bare, base, paramsOf(base, false))) : refBy;
      const w = by(applyMechanisms(bare, [...base, id], paramsOf([...base, id], false)));
      return { aOp: w.aOp - b.aOp, effective: w.effective - b.effective, delivered: w.delivered - b.delivered };
    };
    if (Math.abs(allOnBy.aOp - z.allOn.value) > 1e-9 || Math.abs(allOnDeratedBy.aOp - z.allOnDerated.value) > 1e-9) throw new Error(`studyOfBuild ${id} at ${N}: the all-on design differs from the study's (${allOnBy.aOp} vs ${z.allOn.value}; derated ${allOnDeratedBy.aOp} vs ${z.allOnDerated.value})`);
    perSize[String(N)] = {
      baseline: z.baseline.value, baselineBy: by(bare),
      plan: { ids: z.plan.ids, feasible: z.plan.feasible, effort: z.plan.effort, nominal: z.plan.nominal, derated: z.plan.derated },
      allOn: z.allOn.value, allOnDerated: z.allOnDerated.value, allOnBy, allOnDeratedBy,
      gains: z.gains.map((g: StudyGain) => ({ id: g.id, halfWidth: g.halfWidth, ...(g.halfWidthBy ? { halfWidthBy: { aOp: g.halfWidthBy.aOp, effective: g.halfWidthBy.effective, delivered: g.halfWidthBy.delivered } } : {}), aOp: g.byMetric.aOp, effective: { shapley: g.byMetric.effective.shapley }, delivered: { shapley: g.byMetric.delivered.shapley }, onReference: onReferenceOf(g.id) })),
      attribution: z.attribution,
    };
    o.onProgress?.(N, i + 1, sizes.length);
  });
  const original = players.filter((id) => !mechanismById(id).audit);
  return { generated: new Date().toISOString(), arch: id, sizes, target, permutations: perms, players, original, extensions: players.filter((id) => !original.includes(id)), parameters: set.parameters, set: set.id, library, perSize, ...(Object.keys(projectParameters).length ? { projectParameters } : {}), ...(fixed?.length ? { fixed } : {}) };
}

/** the Shapley study of a record under a set: `studyOfBuild` over the record's scenario at each scale (no mechanisms, the set's recovery baseline, the optional variant) */
export function archStudy(record: TopologyRecord, set: MechanismSet, o: ArchStudyOptions = {}): ArchStudy {
  const { variantId, ...rest } = o;
  return studyOfBuild(record.id, (N) => withRecoveryBaseline(scenarioFromRecord(record, N, variantId, { mechanisms: [] }), set), set, rest);
}
