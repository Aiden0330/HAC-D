/**
 * v5 topology record (docs/markdown/PLAN_V5_REPORT_PIPELINE.md §1.1): one cluster architecture as a JSON file — a built-in
 * template, the SuperPoD geometry as a preset plus field overrides, user counts of hardware units, the main scale-out design and
 * its variants, the instance rule of the layers, and the provenance / confidence of every stated field. `scenarioFromRecord`
 * turns it into a topology scenario at N NPUs through `topologyScenario` (the six default mechanisms applied), so a report can
 * run a new architecture without a hand-written scenario builder.
 *
 * Extension points: a record can only name a template of `TOPOLOGY_TEMPLATES` and fault units of `FAULT_UNITS`. A topology with
 * a new hardware unit kind (an optical engine, an NPO module) needs a unit-library entry (`unitFaultLibrary`: FAULT_UNITS,
 * DOMAIN_UNIT, the unit's count rule) and a bill-of-materials row (`topologyBom`) in packages/core/src/topology/index.ts; the
 * loader's error messages name both.
 */
import { z } from 'zod';
import {
  ConfidenceSchema, SuperpodSchema, ScaleOutSchema, TopologySchema, SUPERPOD_PRESETS,
  type Scenario, type Superpod, type ScaleOut, type Topology,
} from '../scenario/schema.js';
import { topologyScenario, templateUnits, TOPOLOGY_TEMPLATE_IDS, FAULT_UNITS, type TopologyTemplate, type FaultUnit } from '../topology/index.js';
import native950 from '../../data/records/native950.json';
import ubl128 from '../../data/records/ubl128.json';
import cm384 from '../../data/records/cm384.json';
import a3server from '../../data/records/a3server.json';

/** the two extension points a new template or hardware unit kind needs (plan §8 item 2) */
export const TOPOLOGY_EXTENSION_POINTS =
  'a new hardware unit kind needs two extension points in packages/core/src/topology/index.ts: a unit-library entry (unitFaultLibrary — FAULT_UNITS, DOMAIN_UNIT and the unit\'s count rule) and a bill-of-materials row (topologyBom); a new template also needs its TOPOLOGY_TEMPLATES entry';

const BilingualSchema = z.object({ zh: z.string(), en: z.string() });
type PresetKey = keyof typeof SUPERPOD_PRESETS;
const PRESET_KEYS = Object.keys(SUPERPOD_PRESETS) as [PresetKey, ...PresetKey[]];

/**
 * SuperPoD geometry: `base` names a SUPERPOD_PRESETS key and the other fields (SuperpodSchema's, every one optional and without
 * its default) override it, resolved as `{ ...SUPERPOD_PRESETS[base].values, ...fields }`; without `base` the fields are a full
 * custom geometry (the schema defaults fill the rest). Unknown fields are rejected.
 */
export const RecordSuperpodSchema = z.object({
  base: z.enum(PRESET_KEYS).optional(),
  ...Object.fromEntries(Object.entries(SuperpodSchema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType)).optional()])),
}).strict() as unknown as z.ZodType<{ base?: PresetKey } & Partial<Superpod>>;

const ProvenanceEntrySchema = z.object({ source: z.string(), confidence: ConfidenceSchema, note: z.string().optional() });

export const TopologyVariantSchema = z.object({
  id: z.string().min(1),
  name: BilingualSchema,
  basis: BilingualSchema,
  scaleOut: ScaleOutSchema,
});
export type TopologyVariant = z.infer<typeof TopologyVariantSchema>;

export const TopologyRecordSchema = z.object({
  id: z.string().min(1),
  name: BilingualSchema,
  short: BilingualSchema,
  /** chip family ('950', '910C', …), for grouping in reports */
  family: z.string(),
  template: z.enum(TOPOLOGY_TEMPLATE_IDS as [TopologyTemplate, ...TopologyTemplate[]], {
    error: (iss) => `unknown topology template ${JSON.stringify(iss.input)} (known: ${TOPOLOGY_TEMPLATE_IDS.join(', ')}); ${TOPOLOGY_EXTENSION_POINTS}`,
  }),
  superpod: RecordSuperpodSchema,
  /** user counts of hardware units by BOM row id (TopologySchema.countOverrides) */
  countOverrides: TopologySchema.shape.countOverrides,
  /** NPUs of one UB (scale-up) domain, the scenario's nvlinkDomainGpus; absent = the pod (npusPerNode × nodesPerRack × computeRacks) */
  domainNpus: z.number().int().positive().optional(),
  /**
   * fault units the record expects the template to carry (default: all of `templateUnits(template)`); a unit outside FAULT_UNITS
   * or outside the template fails with the extension points
   */
  faultUnits: z.array(z.string()).optional(),
  /** the main scale-out design (also listed in `variants` as id 'main') */
  scaleOut: ScaleOutSchema,
  /** scale-out designs compared in the BOM report; 'main' must be present and equal `scaleOut` */
  variants: z.array(TopologyVariantSchema).min(1),
  /**
   * instance rule of the layers (MTBF per instance, the overlay): the SuperPoD instance is one supernode, or one node when the UB
   * domain is the server; NPUs per instance of the SuperPoD, cabinet and node layers. Cluster and scale-out network: one instance.
   */
  layers: z.object({
    superpod: z.object({ unit: z.enum(['supernodes', 'nodes']), npus: z.number().positive() }),
    cabinet: z.object({ npus: z.number().positive() }),
    node: z.object({ npus: z.number().positive() }),
  }),
  /** meta.id of the generated scenario */
  scenarioId: z.string().min(1),
  /** meta.name pattern of the generated scenario: `{name}` = name.en, `{npus}` = N with en-US digit grouping */
  scenarioName: z.string().default('{name} — {npus} NPUs'),
  /** source and confidence by field path of the record ('superpod.computeRacks', 'scaleOut', 'countOverrides.commCabinet', …) */
  provenance: z.record(z.string(), ProvenanceEntrySchema).default({}),
  /** every value not stated by a public source: a bilingual item for the reports, or a plain string */
  assumed: z.array(z.union([z.string(), BilingualSchema])).default([]),
  /**
   * labels of the hardware schematic in the Findings overlay figure (@hac-d/reports `topoGeomFromRecord`); absent fields take the
   * generic defaults there (UB label 'UB 交换 + 光链路' / 'UB switching + optics'; pod label from the short name and the NPUs per
   * pod). Presentation only: `scenarioFromRecord` does not read it.
   */
  schematic: z.object({ ubLabel: BilingualSchema.optional(), podLabel: BilingualSchema.optional() }).strict().optional(),
}).superRefine((r, ctx) => {
  const ids = r.variants.map((v) => v.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) ctx.addIssue({ code: 'custom', path: ['variants'], message: `duplicate variant id '${dup}'` });
  const main = r.variants.find((v) => v.id === 'main');
  if (!main) ctx.addIssue({ code: 'custom', path: ['variants'], message: "the variants must list the main design as id 'main'" });
  else if (JSON.stringify(main.scaleOut) !== JSON.stringify(r.scaleOut)) ctx.addIssue({ code: 'custom', path: ['variants'], message: "variant 'main' must equal the record's scaleOut" });
  for (const [i, u] of (r.faultUnits ?? []).entries()) {
    if (!(FAULT_UNITS as string[]).includes(u)) ctx.addIssue({ code: 'custom', path: ['faultUnits', i], message: `unknown fault unit '${u}' (known: ${FAULT_UNITS.join(', ')}); ${TOPOLOGY_EXTENSION_POINTS}` });
    else if (!templateUnits(r.template).includes(u as FaultUnit)) ctx.addIssue({ code: 'custom', path: ['faultUnits', i], message: `fault unit '${u}' is not carried by template ${r.template} (units: ${templateUnits(r.template).join(', ')}); ${TOPOLOGY_EXTENSION_POINTS}` });
  }
});
export type TopologyRecord = z.infer<typeof TopologyRecordSchema>;
export type TopologyRecordInput = z.input<typeof TopologyRecordSchema>;

/** Validate a topology record (JSON); the error lists every issue with its path. */
export function parseTopologyRecord(input: unknown): TopologyRecord {
  const r = TopologyRecordSchema.safeParse(input);
  if (!r.success) throw new Error(`invalid topology record${typeof (input as { id?: unknown })?.id === 'string' ? ` '${(input as { id: string }).id}'` : ''}: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** JSON Schema of the topology record (input form, defaults optional) */
export function topologyRecordJsonSchema(): unknown {
  return z.toJSONSchema(TopologyRecordSchema, { io: 'input', unrepresentable: 'any' });
}

/** the record's SuperPoD geometry resolved over its preset (`{ ...SUPERPOD_PRESETS[base].values, ...fields }`) */
export function recordSuperpod(record: TopologyRecord): Superpod {
  const { base, ...fields } = record.superpod as { base?: PresetKey } & Partial<Superpod>;
  return base ? ({ ...SUPERPOD_PRESETS[base].values, ...fields } as Superpod) : SuperpodSchema.parse(fields);
}

/** NPUs of one pod (npusPerNode × nodesPerRack × computeRacks) of the resolved geometry */
export function recordPodNpus(record: TopologyRecord): number {
  const sp = recordSuperpod(record);
  return sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
}

/** the scale-out design of a variant ('main' or absent = the record's scaleOut); an unknown id throws with the known ids */
export function recordScaleOut(record: TopologyRecord, variantId?: string): ScaleOut {
  if (variantId === undefined || variantId === 'main') return record.scaleOut;
  const v = record.variants.find((x) => x.id === variantId);
  if (!v) throw new Error(`topology record '${record.id}' has no scale-out variant '${variantId}' (variants: ${record.variants.map((x) => x.id).join(', ')})`);
  return v.scaleOut;
}

export interface ScenarioFromRecordOptions {
  /** SuperPoD fields replacing the record's (what-if on the geometry) */
  superpod?: Partial<Superpod>;
  /** countOverrides rows to drop */
  dropOverrides?: string[];
  /** mechanisms applied on top (default: the six ReMAP defaults, as topologyScenario) */
  mechanisms?: string[];
  mechanismParameters?: Record<string, Record<string, number>>;
}

/**
 * The topology scenario of a record at `npus` NPUs (job size N, NPU count of the training workload), with the scale-out design of
 * `variantId` (default the main design) and the six default mechanisms: `topologyScenario(template, N, { topology, id, name })` with
 * topology = { superpod, scaleOut, nodesPerRack = superpod.nodesPerRack, racksPerZone = computeRacks + commRacks (one pod's cabinets),
 * nvlinkDomainGpus = domainNpus ?? the pod, countOverrides }. Fault types: the per-unit library (business-impact FIT per unit-hour,
 * confidence assumed) unless replaced afterwards (applyFaultRates).
 */
export function scenarioFromRecord(record: TopologyRecord, npus: number, variantId?: string, opts: ScenarioFromRecordOptions = {}): Scenario {
  if (!(TOPOLOGY_TEMPLATE_IDS as string[]).includes(record.template)) throw new Error(`unknown topology template '${record.template}' in record '${record.id}'; ${TOPOLOGY_EXTENSION_POINTS}`);
  for (const u of record.faultUnits ?? []) {
    if (!(FAULT_UNITS as string[]).includes(u) || !templateUnits(record.template).includes(u as FaultUnit)) throw new Error(`fault unit '${u}' of record '${record.id}' is not in the unit library of template ${record.template}; ${TOPOLOGY_EXTENSION_POINTS}`);
  }
  const sp = { ...recordSuperpod(record), ...(opts.superpod ?? {}) } as Superpod;
  const pod = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
  const drop = opts.dropOverrides ?? [];
  const ov = record.countOverrides ? Object.fromEntries(Object.entries(record.countOverrides).filter(([k]) => !drop.includes(k))) : {};
  const topology: Partial<Topology> = {
    superpod: sp,
    scaleOut: recordScaleOut(record, variantId),
    nodesPerRack: sp.nodesPerRack,
    racksPerZone: sp.computeRacks + sp.commRacks,
    nvlinkDomainGpus: record.domainNpus ?? pod,
    ...(Object.keys(ov).length ? { countOverrides: ov } : {}),
  };
  const name = record.scenarioName.replaceAll('{name}', record.name.en).replaceAll('{npus}', npus.toLocaleString('en-US'));
  return topologyScenario(record.template, npus, {
    topology, id: record.scenarioId, name,
    ...(opts.mechanisms ? { mechanisms: opts.mechanisms } : {}),
    ...(opts.mechanismParameters ? { mechanismParameters: opts.mechanismParameters } : {}),
  });
}

/** the four built-in records of the v4.4 report set, parsed at load (a malformed built-in fails here) */
export const BUILTIN_TOPOLOGY_RECORDS: Record<'native950' | 'ubl128' | 'cm384' | 'a3server', TopologyRecord> = {
  native950: parseTopologyRecord(native950),
  ubl128: parseTopologyRecord(ubl128),
  cm384: parseTopologyRecord(cm384),
  a3server: parseTopologyRecord(a3server),
};
