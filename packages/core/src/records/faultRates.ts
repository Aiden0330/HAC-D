/**
 * v5 failure-rate override (docs/markdown/PLAN_V5_REPORT_PIPELINE.md §1.2): new business-impact FIT for some fault classes of a
 * topology scenario, each with its source and confidence, either per hardware unit (HAC-D's basis) or per card (the ReMAP /
 * reference-catalog basis, converted through the CloudMatrix384 geometry exactly as `unitFaultLibrary` does:
 * FIT_unit = FIT_card × cards per unit). `applyFaultRates` writes the values on the bare design (the applied mechanisms removed
 * and re-applied exactly) and puts the provenance on the component, so the confidence tag reaches every table.
 *
 * 口径: FIT = business-impact events (after the existing protection) per 10⁹ unit-hours (per-unit) or card-hours (per-card), at
 * job level; hard → interruption rate (component.failure), slow → sub-health entry rate (component.subhealth.ratePerHour),
 * sdc → silent-corruption rate (component.sdc.ratePerHour). The classes stay apart; nothing is added across them.
 */
import { z } from 'zod';
import { ConfidenceSchema, type Scenario, type Component } from '../scenario/schema.js';
import { calibrationCardsPerUnit, unitFaultLibrary, FAULT_UNITS, type FaultUnit, type UnitFaultType } from '../topology/index.js';
import { editBase } from '../mechanisms/index.js';
import { fromPerHour, toPerHour } from '../units/index.js';
import remapPerCard from '../../data/fault-rates/remap-per-card-2026-10-09.json';

const FaultUnitSchema = z.enum(FAULT_UNITS as [FaultUnit, ...FaultUnit[]]);

export const FaultRateEntrySchema = z.object({
  /** hardware unit of the class (optional; checked against the unit library; needed for the per-card conversion of a class outside it) */
  unit: FaultUnitSchema.optional(),
  /** business-impact FIT per unit-hour (basis per-unit) or per card-hour (basis per-card) */
  fit: z.number().nonnegative(),
  source: z.string(),
  confidence: ConfidenceSchema,
  derivation: z.string().optional(),
  /** the source's own evidence note for this class (e.g. the audited catalog's fitEvidence / evidence / status) */
  note: z.string().optional(),
});
export type FaultRateEntry = z.infer<typeof FaultRateEntrySchema>;

export const FaultRateOverrideSchema = z.object({
  id: z.string().min(1),
  basis: z.enum(['per-unit', 'per-card']),
  source: z.string().optional(),
  /** the catalog the rates come from: revision, hash, rate basis (口径) and the anchor that normalises the class totals */
  catalog: z.object({
    file: z.string().optional(), revision: z.string().optional(), version: z.string().optional(), sha256: z.string().optional(), modifiedAt: z.string().optional(),
    rateBasis: z.object({ zh: z.string(), en: z.string() }).optional(),
    anchor: z.object({ referenceCards: z.number().positive(), hardMtbfHours: z.number().positive(), shares: z.record(z.string(), z.number()).optional(), classFit: z.record(z.string(), z.number()).optional(), note: z.string().optional() }).optional(),
    confidenceNote: z.string().optional(),
  }).optional(),
  /** by class id = the component id of a topology scenario ('FABRIC-hard', 'OPT-hard@roce', …) */
  rates: z.record(z.string(), FaultRateEntrySchema),
  /** class → class whose value it takes when it has none of its own (scale-out units take the UB values: 'FABRIC-hard@roce': 'FABRIC-hard') */
  analogues: z.record(z.string(), z.string()).optional(),
}).superRefine((o, ctx) => {
  for (const [k, v] of Object.entries(o.analogues ?? {})) {
    if (!o.rates[v]) ctx.addIssue({ code: 'custom', path: ['analogues', k], message: `analogue '${k}' → '${v}': '${v}' has no rate in this override` });
  }
});
export type FaultRateOverride = z.infer<typeof FaultRateOverrideSchema>;

/** Validate a failure-rate override (JSON); the error lists every issue with its path. */
export function parseFaultRateOverride(input: unknown): FaultRateOverride {
  const r = FaultRateOverrideSchema.safeParse(input);
  if (!r.success) throw new Error(`invalid failure-rate override: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** JSON Schema of the failure-rate override */
export function faultRateOverrideJsonSchema(): unknown {
  return z.toJSONSchema(FaultRateOverrideSchema, { io: 'input' });
}

export interface FaultRateChange {
  id: string;
  type: 'hard' | 'slow' | 'sdc';
  unit: FaultUnit | undefined;
  /** FIT per unit-hour before and after (business-impact, job level) */
  before: number;
  after: number;
  /** the override entry used (the class's own, or its analogue's) */
  from: string;
  confidence: FaultRateEntry['confidence'];
}
export interface FaultRatesResult {
  scenario: Scenario;
  changes: FaultRateChange[];
  /** classes of the override absent from the scenario, unit mismatches, classes without the block their type needs */
  warnings: string[];
}

let LIB: Map<string, UnitFaultType> | undefined;
const lib = () => (LIB ??= new Map(unitFaultLibrary().map((f) => [f.id, f])));

/** fault type of a component: the unit library's, else read from its blocks / id suffix */
function typeOf(c: Component): 'hard' | 'slow' | 'sdc' {
  const f = lib().get(c.id);
  if (f) return f.type;
  if (/-sdc(@|$)/.test(c.id) || (c.sdc && !(c.failure.value > 0))) return 'sdc';
  if (/-slow(@|$)/.test(c.id) || (c.subhealth && !(c.failure.value > 0))) return 'slow';
  return 'hard';
}

/**
 * Apply a failure-rate override with the full report: per class the FIT per unit-hour before and after, and warnings for classes
 * that are not in the scenario (never silently dropped). Per-card values are converted by × cards per unit of the class's unit in
 * the CloudMatrix384 geometry (`unitFaultLibrary().cardsPerUnit`, or `calibrationCardsPerUnit()[entry.unit]` for a class outside
 * the library). The bare design is edited and the applied mechanisms re-applied with their parameters (`editBase`).
 */
export function applyFaultRatesDetailed(scenario: Scenario, override: FaultRateOverride): FaultRatesResult {
  const o = parseFaultRateOverride(override);
  const warnings: string[] = [];
  const changes: FaultRateChange[] = [];
  const present = new Set(scenario.components.map((c) => c.id));
  for (const id of Object.keys(o.rates)) if (!present.has(id)) warnings.push(`class '${id}' of override '${o.id}' is not in scenario '${scenario.meta.id ?? scenario.meta.name}'; not applied`);
  const cardsPer = calibrationCardsPerUnit();
  const out = editBase(scenario, (bare) => {
    for (const c of bare.components) {
      const own = o.rates[c.id];
      const fromId = own ? c.id : o.analogues?.[c.id];
      const e = own ?? (fromId ? o.rates[fromId] : undefined);
      if (!e || !fromId) continue;
      const f = lib().get(c.id);
      const unit = f?.unit ?? e.unit;
      if (own && e.unit && f && e.unit !== f.unit) warnings.push(`class '${c.id}': override unit '${e.unit}' differs from the library unit '${f.unit}'; the library unit is used`);
      let fit = e.fit;
      let conv = `${e.fit} FIT per ${unit ?? 'unit'}-hour`;
      if (o.basis === 'per-card') {
        const k = f?.cardsPerUnit ?? (unit ? cardsPer[unit] : undefined);
        if (k === undefined) { warnings.push(`class '${c.id}': per-card value needs the class's unit (not in the unit library and no 'unit' given); not applied`); continue; }
        fit = e.fit * k;
        conv = `${e.fit} FIT per card-hour × ${k.toFixed(4)} cards per ${unit} (CloudMatrix384 geometry) = ${fit.toFixed(3)} FIT per ${unit}-hour`;
      }
      const derivation = `${e.derivation ? `${e.derivation}; ` : ''}${fromId !== c.id ? `analogue of ${fromId}: ` : ''}${conv} (override ${o.id})`;
      const provenance = { source: e.source, confidence: e.confidence, derivation };
      const type = typeOf(c);
      let before: number;
      if (type === 'hard') {
        before = toPerHour(c.failure.value, c.failure.unit) * 1e9;
        c.failure = { ...c.failure, value: c.failure.unit === 'FIT' ? fit : fromPerHour(fit / 1e9, c.failure.unit), provenance };
      } else if (type === 'slow') {
        if (!c.subhealth) { warnings.push(`class '${c.id}' (sub-health) has no subhealth block; not applied`); continue; }
        before = (c.subhealth.ratePerHour ?? 0) * 1e9;
        c.subhealth = { ...c.subhealth, ratePerHour: fit / 1e9 };
        c.failure = { ...c.failure, provenance };
      } else {
        if (!c.sdc) { warnings.push(`class '${c.id}' (silent corruption) has no sdc block; not applied`); continue; }
        before = c.sdc.ratePerHour * 1e9;
        c.sdc = { ...c.sdc, ratePerHour: fit / 1e9, provenance: { ...provenance, derivation: `${derivation} (silent corruption per ${unit ?? 'unit'}-hour)` } };
        c.failure = { ...c.failure, provenance };
      }
      changes.push({ id: c.id, type, unit, before, after: fit, from: fromId, confidence: e.confidence });
    }
    return bare;
  });
  return { scenario: out, changes, warnings };
}

/** Apply a failure-rate override (see applyFaultRatesDetailed); warnings are dropped — use the detailed form to report them. */
export function applyFaultRates(scenario: Scenario, override: FaultRateOverride): Scenario {
  return applyFaultRatesDetailed(scenario, override).scenario;
}

/** the 54 catalog events per card-hour (ReMAP / ai-cluster-reliability review-2026-10-09), parsed at load */
export const REMAP_PER_CARD_RATES: FaultRateOverride = parseFaultRateOverride(remapPerCard);
