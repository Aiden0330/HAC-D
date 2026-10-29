/**
 * v5 mechanism parameter set (docs/markdown/PLAN_V5_REPORT_PIPELINE.md §1.3): which mechanisms are the baseline of every design,
 * which are A_op candidates of the allocation, which count only for the delivered goodput, which are pruned and which are
 * capabilities without a transform; their target parameters (merged over the library defaults), efforts, the recovery levers, the
 * derating, the baseline recovery policy with its provenance, the optional measured stage split of the automatic attempt, the
 * pruning rule and, per mechanism, its deployment layer / acted-on layers / stage (MechanismMetadata) and verdict. The default set
 * is ReMAP-latest (f53ab7e), formerly scripts/remap-latest-params.ts + the tables of scripts/ascend-mechanism-hierarchy.ts.
 *
 * 口径 of the parameters: each mechanism's own (MECHANISM_LIBRARY: probabilities, seconds, shares); the recovery baseline is the
 * MTTR mixture R = T_det + T_auto + (1 − p_s)·T_manual with T_det = p_d·autoSeconds + (1 − p_d)·timeoutSeconds, seconds per
 * job interruption.
 */
import { z } from 'zod';
import { ConfidenceSchema, RecoverySchema, RecoveryStagesSchema, type Scenario } from '../scenario/schema.js';
import { MECHANISM_LIBRARY, applyMechanisms, editBase, mechanismById, type MechanismMetadata } from '../mechanisms/index.js';
import { parameterIssues } from '../mechanisms/parameters.js';
import type { RecoveryLever } from '../strategy/index.js';
import type { DerateSpec } from '../mechanisms/plan.js';
import remapLatest from '../../data/mechanism-sets/remap-latest-2026-10.json';

const BilingualSchema = z.object({ zh: z.string(), en: z.string() });
const LayerIdSchema = z.enum(['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu']);

export const MechanismMetadataSchema = z.object({
  deploy: LayerIdSchema,
  acts: z.array(LayerIdSchema).min(1),
  stage: z.enum(['detection', 'rung', 'automatic', 'manual', 'checkpoint', 'sdc', 'rate', 'local', 'none']),
  how: BilingualSchema,
  changes: BilingualSchema,
}) satisfies z.ZodType<MechanismMetadata>;

export const RecoveryLeverSchema = z.object({ id: z.enum(['auto', 'success', 'manual']), limit: z.number().nonnegative(), effort: z.number().nonnegative() }) satisfies z.ZodType<RecoveryLever>;
export const DerateSpecSchema = z.object({ coverageDelta: z.number().min(0), successDelta: z.number().min(0), timeFactor: z.number().min(1), reductionFactor: z.number().min(0).max(1) }) satisfies z.ZodType<DerateSpec>;

/** the verdicts and the list each one belongs to */
const VERDICT_LIST = { reference: 'baseline', candidate: 'candidates', goodput: 'goodputOnly', pruned: 'pruned', capability: 'capability' } as const;
type Verdict = keyof typeof VERDICT_LIST;
const LISTS = ['baseline', 'candidates', 'goodputOnly', 'pruned', 'capability'] as const;

export const MechanismSetSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  remap: z.object({ repo: z.string(), commit: z.string(), note: z.string().optional() }).optional(),
  /** in the baseline of every design (ReMAP's six reference mechanisms) */
  baseline: z.array(z.string()),
  /** A_op levers of the allocation */
  candidates: z.array(z.string()),
  /** kept for the delivered goodput (silent-corruption detection, checkpoint cost), outside the A_op allocation */
  goodputOnly: z.array(z.string()),
  /** dominated on a shared stage or without effect beyond noise */
  pruned: z.array(z.string()),
  /** capabilities without a scenario transform (no separate credit) */
  capability: z.array(z.string()),
  /** target parameters by mechanism, merged over the library defaults (mechanismById(id).parameters) */
  parameters: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  /** implementation effort by mechanism, replacing the library's (1–5) */
  efforts: z.record(z.string(), z.number().nonnegative()).optional(),
  levers: z.array(RecoveryLeverSchema),
  derate: DerateSpecSchema,
  /** baseline recovery policy (MTTR mixture) with its provenance */
  recovery: z.object({
    detection: z.object({ coverage: z.number().min(0).max(1), autoSeconds: z.number().nonnegative(), timeoutSeconds: z.number().nonnegative() }),
    automatic: z.object({ seconds: z.number().nonnegative(), successProbability: z.number().min(0).max(1) }),
    manual: z.object({ seconds: z.number().nonnegative() }),
    provenance: z.object({ source: z.string(), confidence: ConfidenceSchema }),
  }),
  /** measured stage split of the automatic attempt (seconds; serial, sums to automatic.seconds); absent = equal thirds */
  stages: RecoveryStagesSchema.optional(),
  /** pruning rule: A_op / delivered Shapley threshold (fraction, 0.0015 = 0.15 pt at the largest scale on every architecture) and the dominated → dominating map */
  prune: z.object({ threshold: z.number().nonnegative(), dominated: z.record(z.string(), z.string()).default({}), rule: BilingualSchema.optional(), /** v5.6 the metric of the candidate rule: A_op (default, the v5 sets) or the effective goodput */ metric: z.enum(['aOp', 'effective']).optional() }),
  metadata: z.record(z.string(), MechanismMetadataSchema),
  /** source and confidence by field path ('parameters', 'levers', 'derate', 'efforts', 'prune.threshold', 'baseline', 'candidates', …) */
  provenance: z.record(z.string(), z.object({ source: z.string(), confidence: ConfidenceSchema, note: z.string().optional() })).default({}),
  verdicts: z.record(z.string(), z.object({ verdict: z.enum(Object.keys(VERDICT_LIST) as [Verdict, ...Verdict[]]), reason: BilingualSchema })).optional(),
}).superRefine((s, ctx) => {
  const seen = new Map<string, string>();
  for (const list of LISTS) {
    for (const id of s[list]) {
      const prev = seen.get(id);
      if (prev) ctx.addIssue({ code: 'custom', path: [list], message: `mechanism '${id}' is in both '${prev}' and '${list}'` });
      else seen.set(id, list);
      const m = MECHANISM_LIBRARY.find((x) => x.id === id);
      if (!m) ctx.addIssue({ code: 'custom', path: [list], message: `unknown mechanism '${id}' (not in MECHANISM_LIBRARY)` });
      else if (list === 'capability' ? !!m.apply : !m.apply) ctx.addIssue({ code: 'custom', path: [list], message: list === 'capability' ? `'${id}' has a scenario transform; list it as appliable` : `'${id}' has no scenario transform; list it under 'capability'` });
      if (!s.metadata[id]) ctx.addIssue({ code: 'custom', path: ['metadata'], message: `no metadata for '${id}'` });
    }
  }
  for (const id of Object.keys(s.metadata)) if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['metadata', id], message: `metadata for '${id}', which is in none of the lists` });
  for (const id of Object.keys(s.parameters)) if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['parameters', id], message: `parameters for '${id}', which is in none of the lists` });
  // v5.8 (method & code review 2026-10-29, P1-③) every parameter inside its domain: probabilities and shares in [0, 1], seconds ≥ 0, …
  for (const [id, params] of Object.entries(s.parameters)) for (const b of parameterIssues(id, params)) ctx.addIssue({ code: 'custom', path: ['parameters', id, b.key], message: b.message.en });
  s.levers.forEach((l, i) => { if (l.id === 'success' && l.limit > 1) ctx.addIssue({ code: 'custom', path: ['levers', i, 'limit'], message: `the automatic-success lever's limit ${l.limit} is a probability (≤ 1)` }); });
  for (const id of Object.keys(s.efforts ?? {})) if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['efforts', id], message: `effort for '${id}', which is in none of the lists` });
  if (s.verdicts) {
    for (const [id, v] of Object.entries(s.verdicts)) {
      const list = seen.get(id);
      if (!list) ctx.addIssue({ code: 'custom', path: ['verdicts', id], message: `verdict for '${id}', which is in none of the lists` });
      else if (VERDICT_LIST[v.verdict] !== list) ctx.addIssue({ code: 'custom', path: ['verdicts', id], message: `'${id}' has verdict '${v.verdict}' but is listed in '${list}' (expected '${VERDICT_LIST[v.verdict]}')` });
    }
    for (const id of seen.keys()) if (!s.verdicts[id]) ctx.addIssue({ code: 'custom', path: ['verdicts'], message: `no verdict for '${id}'` });
  }
  for (const [a, b] of Object.entries(s.prune.dominated)) {
    if (seen.get(a) !== 'pruned') ctx.addIssue({ code: 'custom', path: ['prune', 'dominated', a], message: `dominated mechanism '${a}' must be in 'pruned'` });
    if (!seen.has(b) || seen.get(b) === 'pruned' || seen.get(b) === 'capability') ctx.addIssue({ code: 'custom', path: ['prune', 'dominated', a], message: `'${a}' is dominated by '${b}', which must be a kept, appliable mechanism` });
  }
  if (s.stages) {
    const sum = s.stages.startup + s.stages.read + s.stages.communication;
    if (Math.abs(sum - s.recovery.automatic.seconds) > 1e-9 * Math.max(1, sum)) ctx.addIssue({ code: 'custom', path: ['stages'], message: `stages sum to ${sum} s, the automatic attempt is ${s.recovery.automatic.seconds} s` });
  }
});
export type MechanismSet = z.infer<typeof MechanismSetSchema>;
export type MechanismSetInput = z.input<typeof MechanismSetSchema>;

/** Validate a mechanism set (JSON); the error lists every issue with its path. */
export function parseMechanismSet(input: unknown): MechanismSet {
  const r = MechanismSetSchema.safeParse(input);
  if (!r.success) throw new Error(`invalid mechanism set: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** JSON Schema of the mechanism set */
export function mechanismSetJsonSchema(): unknown {
  return z.toJSONSchema(MechanismSetSchema, { io: 'input' });
}

export interface ResolvedMechanismSet {
  id: string;
  /** every listed mechanism's parameters: the set's values merged over the library defaults */
  parameters: Record<string, Record<string, number>>;
  /** every listed mechanism's effort: the set's value, else the library's */
  efforts: Record<string, number>;
  levers: RecoveryLever[];
  derate: DerateSpec;
  /** the appliable mechanisms (baseline + candidates + goodputOnly + pruned), e.g. the players of a Shapley study */
  players: string[];
  baseline: string[];
  candidates: string[];
  goodputOnly: string[];
  pruned: string[];
  capability: string[];
  recovery: MechanismSet['recovery'];
  stages: MechanismSet['stages'];
  prune: MechanismSet['prune'];
  metadata: Record<string, MechanismMetadata>;
}

/** all ids of the set, list by list */
const idsOf = (s: MechanismSet) => LISTS.flatMap((l) => s[l]);

/** The set resolved against the library: merged parameters and efforts of every listed mechanism, the appliable players. */
export function resolveMechanismSet(set: MechanismSet): ResolvedMechanismSet {
  const ids = idsOf(set);
  return {
    id: set.id,
    parameters: Object.fromEntries(ids.map((id) => [id, { ...mechanismById(id).parameters, ...(set.parameters[id] ?? {}) }])),
    efforts: Object.fromEntries(ids.map((id) => [id, set.efforts?.[id] ?? mechanismById(id).effort])),
    levers: set.levers.map((l) => ({ ...l })),
    derate: { ...set.derate },
    players: [...set.baseline, ...set.candidates, ...set.goodputOnly, ...set.pruned],
    baseline: [...set.baseline],
    candidates: [...set.candidates],
    goodputOnly: [...set.goodputOnly],
    pruned: [...set.pruned],
    capability: [...set.capability],
    recovery: set.recovery,
    stages: set.stages,
    prune: set.prune,
    metadata: set.metadata,
  };
}

/**
 * Apply mechanisms of the set to a scenario with the set's parameters (merged over the library defaults; applyMechanisms, library
 * order, exactly removable). Default: the set's baseline. An id outside the set's appliable mechanisms throws.
 */
export function applyMechanismSet(scenario: Scenario, set: MechanismSet, ids: string[] = set.baseline): Scenario {
  const r = resolveMechanismSet(set);
  const bad = ids.filter((id) => !r.players.includes(id));
  if (bad.length) throw new Error(`mechanism set '${set.id}' cannot apply ${bad.join(', ')} (appliable: ${r.players.join(', ')})`);
  return applyMechanisms(scenario, ids, r.parameters);
}

/** deployment layer, acted-on layers, stage and description of a mechanism (the set's, else the library entry's) */
export function mechanismMetadata(set: MechanismSet, id: string): MechanismMetadata {
  const m = set.metadata[id] ?? mechanismById(id).metadata;
  if (!m) throw new Error(`mechanism set '${set.id}' has no metadata for '${id}'`);
  return m;
}

/**
 * The scenario with the set's baseline recovery (MTTR mixture: detection p_d in autoSeconds else timeoutSeconds, automatic attempt
 * of `seconds` succeeding with p_s, else + manual seconds; the set's stage split when given), written on the bare design and the
 * applied mechanisms re-applied (editBase), so a mechanism that changes the recovery (D-HARD) still acts on top of it.
 */
export function withRecoveryBaseline(scenario: Scenario, set: MechanismSet): Scenario {
  const rec = set.recovery;
  return editBase(scenario, (bare) => {
    const prevScale = bare.recovery.mode === 'mixture' ? bare.recovery.automatic.scale : undefined;
    bare.recovery = RecoverySchema.parse({
      mode: 'mixture',
      detection: { ...rec.detection },
      automatic: { successProbability: rec.automatic.successProbability, seconds: rec.automatic.seconds, ...(prevScale ? { scale: prevScale } : {}), ...(set.stages ? { stages: { ...set.stages } } : {}) },
      manual: { ...rec.manual },
    });
    return bare;
  });
}

/** the default mechanism set: ReMAP-latest (f53ab7e), parsed at load (a malformed built-in fails here) */
export const DEFAULT_MECHANISM_SET: MechanismSet = parseMechanismSet(remapLatest);
