/**
 * v5 the mechanism Shapley study of one topology record under a mechanism set (docs/ASCEND_ALLOCATION_FINDINGS_* Table 7 and the
 * hierarchy's Shapley columns; previously scripts/arch-mechanism-shapley.ts): for every scale, `allocationStudy` on the record's
 * bare scenario (no mechanism applied — the set's baseline mechanisms are players like the others) with the set's appliable
 * mechanisms as players and the set's parameters: sampled Shapley values of A_op and delivered goodput (permutations, 95 %
 * half-width), single and last-added gains, and the planner's cheapest set meeting the target nominally and derated. The output is
 * the `StoredStudy` shape the hierarchy and the Findings recipe read (docs/backup/arch-mechanism-shapley/<record>.json).
 * 口径: Shapley values in fractions of A_op / delivered goodput at each scale; the base is the bare architecture scenario.
 */
import { allocationStudy, type StudyGain, type StudyResult } from './index.js';
import { stripMechanisms, mechanismById, DEFAULT_PLAYERS } from '../mechanisms/index.js';
import { scenarioFromRecord, type TopologyRecord } from '../records/topologyRecord.js';
import { resolveMechanismSet, type MechanismSet } from '../records/mechanismSet.js';
import { applyFaultRates, type FaultRateOverride } from '../records/faultRates.js';
import { HIERARCHY_DEFAULT_IDS } from './hierarchy.js';

export interface ArchStudyOptions {
  sizes?: number[];
  target?: number;
  permutations?: number;
  seed?: number;
  /** failure-rate override applied to the bare scenario */
  rates?: FaultRateOverride;
  variantId?: string;
  onProgress?: (n: number, done: number, total: number) => void;
}
export interface ArchStudySize {
  baseline: number;
  plan: { ids: string[]; feasible: boolean; effort: number; nominal: number; derated: number };
  allOn: number;
  allOnDerated: number;
  gains: { id: string; halfWidth?: number; aOp: { single: number; lastAdded: number; shapley: number }; delivered: { shapley: number } }[];
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
  parameters: Record<string, Record<string, number>>;
  set: string;
  library: StudyResult['library'] | null;
  perSize: Record<string, ArchStudySize>;
}

/** the Shapley study of a record under a set: one `allocationStudy` per scale on the bare scenario */
export function archStudy(record: TopologyRecord, set: MechanismSet, o: ArchStudyOptions = {}): ArchStudy {
  const r = resolveMechanismSet(set);
  const sizes = o.sizes ?? [10000, 100000, 200000, 500000];
  const target = o.target ?? 0.985, perms = o.permutations ?? 300, seed = o.seed ?? 1;
  // player order fixes the permutation sampler's draws for a given seed: the eight ReMAP originals first, then the audited
  // extensions in library order (the order of the stored v4.4 studies), then anything else the set lists
  const players = [...HIERARCHY_DEFAULT_IDS.filter((id) => r.players.includes(id)), ...r.players.filter((id) => !HIERARCHY_DEFAULT_IDS.includes(id))];
  const perSize: Record<string, ArchStudySize> = {};
  let library: StudyResult['library'] | null = null;
  sizes.forEach((N, i) => {
    // one size per study: each size is built from the record's own geometry (count overrides scale with N)
    let s = scenarioFromRecord(record, N, o.variantId, { mechanisms: [] });
    if (o.rates) s = applyFaultRates(s, o.rates);
    const bare = stripMechanisms(s, DEFAULT_PLAYERS);
    const study = allocationStudy(bare, { sizes: [N], target, metric: 'aOp', players, parameters: r.parameters, trials: 0, seed, levers: false, curves: false, permutations: perms, derate: r.derate });
    const z = study.perSize[N];
    library ??= study.library;
    perSize[String(N)] = {
      baseline: z.baseline.value,
      plan: { ids: z.plan.ids, feasible: z.plan.feasible, effort: z.plan.effort, nominal: z.plan.nominal, derated: z.plan.derated },
      allOn: z.allOn.value, allOnDerated: z.allOnDerated.value,
      gains: z.gains.map((g: StudyGain) => ({ id: g.id, halfWidth: g.halfWidth, aOp: g.byMetric.aOp, delivered: { shapley: g.byMetric.delivered.shapley } })),
      attribution: z.attribution,
    };
    o.onProgress?.(N, i + 1, sizes.length);
  });
  const original = players.filter((id) => !mechanismById(id).audit);
  return { generated: new Date().toISOString(), arch: record.id, sizes, target, permutations: perms, players, original, extensions: players.filter((id) => !original.includes(id)), parameters: set.parameters, set: set.id, library, perSize };
}
