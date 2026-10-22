/**
 * v6 口径 normaliser (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.4): internal device failure rates → a HAC-D failure-rate override.
 *
 * The two quantities differ in kind. A device table states device FIT: all failure modes of one part, per device-hour, with no
 * protection considered. HAC-D's catalog classes state business-impact FIT: events that interrupt (hard), degrade (slow) or silently
 * corrupt (sdc) the job, per fault-unit-hour, after the protection already in place. The bridge is the mapping table, one row per
 * (device, class): the fault unit the device belongs to, how many devices one unit carries and the impact factor — the share of that
 * device's failures that become a business-impact event of the class. The table is a reviewed, versioned artifact; this module only
 * applies it and writes the arithmetic into the record:
 *
 *   FIT_class,unit = Σ_devices FIT_device × devicesPerUnit × impactFactor_class            (business-impact FIT per unit-hour)
 *   FIT_device     = λ_device × 10⁹ with λ from the stated unit: FIT /10⁹, per 10⁶ h /10⁶, per h, MTBF h → 1/MTBF,
 *                    AFR (annual failure fraction) → λ = −ln(1 − AFR) / 8760 h (exponential; AFR/8760 is the first-order value).
 *
 * Confidence policy (never the model's): the entry is `assumed` when any term's impact factor or source is an assumption, else
 * `derived` whenever arithmetic was applied, else the source type's own confidence (field → measured, vendor → vendor,
 * prediction / paper → paper-reported). The derivation string lists every term. Classes are never added across hard / slow / sdc:
 * each class is its own sum.
 */
import { z } from 'zod';
import { HOURS_PER_YEAR } from '../units/index.js';
import { FAULT_UNITS, unitFaultLibrary, type FaultUnit, type UnitFaultType } from '../topology/index.js';
import { parseFaultRateOverride, type FaultRateOverride, type FaultRateEntry } from '../records/faultRates.js';
import { SOURCE_TYPES, DEVICE_RATE_UNITS, IMPACT_CONFIDENCES, type SourceType, type DeviceRateUnit } from './fields.js';

const FaultUnitSchema = z.enum(FAULT_UNITS as [FaultUnit, ...FaultUnit[]]);

export const DeviceFitRowSchema = z.object({
  device: z.string().min(1),
  /** the failure rate as stated, in `unit` */
  value: z.number().nonnegative(),
  unit: z.enum(DEVICE_RATE_UNITS),
  source: z.string().min(1),
  /** where in the source (table, row, page) */
  loc: z.string().optional(),
  sourceType: z.enum(SOURCE_TYPES),
  note: z.string().optional(),
});
export type DeviceFitRow = z.infer<typeof DeviceFitRowSchema>;
export const DeviceFitTableSchema = z.object({
  id: z.string().min(1),
  source: z.string().optional(),
  catalog: z.object({ file: z.string().optional(), revision: z.string().optional(), version: z.string().optional(), sha256: z.string().optional(), modifiedAt: z.string().optional() }).optional(),
  rows: z.array(DeviceFitRowSchema).min(1),
}).superRefine((t, ctx) => {
  const seen = new Set<string>();
  t.rows.forEach((r, i) => { if (seen.has(r.device)) ctx.addIssue({ code: 'custom', path: ['rows', i, 'device'], message: `device '${r.device}' listed twice` }); seen.add(r.device); });
  t.rows.forEach((r, i) => { if (r.unit === 'afr' && r.value >= 1) ctx.addIssue({ code: 'custom', path: ['rows', i, 'value'], message: `AFR must be a fraction below 1 (got ${r.value})` }); });
});
export type DeviceFitTable = z.infer<typeof DeviceFitTableSchema>;

export const MappingRowSchema = z.object({
  device: z.string().min(1),
  unit: FaultUnitSchema,
  /** catalog class id ('DDR-hard', 'OPT-sdc', 'FABRIC-hard@roce', …) */
  class: z.string().min(1),
  devicesPerUnit: z.number().positive(),
  impactFactor: z.number().min(0).max(1),
  /** how the factor was obtained (field ratio, FMEA, assumption) */
  impactBasis: z.string().min(1),
  impactConfidence: z.enum(IMPACT_CONFIDENCES),
  note: z.string().optional(),
});
export type MappingRow = z.infer<typeof MappingRowSchema>;
export const KoujingMappingSchema = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
  source: z.string().optional(),
  rows: z.array(MappingRowSchema).min(1),
}).superRefine((m, ctx) => {
  const seen = new Set<string>();
  m.rows.forEach((r, i) => { const k = `${r.device}|${r.class}`; if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['rows', i], message: `(${r.device}, ${r.class}) mapped twice` }); seen.add(k); });
});
export type KoujingMapping = z.infer<typeof KoujingMappingSchema>;

const fail = (what: string, r: z.ZodSafeParseResult<unknown>): never => { throw new Error(`invalid ${what}: ${(r as { error: z.ZodError }).error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`); };
export function parseDeviceFitTable(input: unknown): DeviceFitTable { const r = DeviceFitTableSchema.safeParse(input); return r.success ? r.data : fail('device table', r); }
export function parseKoujingMapping(input: unknown): KoujingMapping { const r = KoujingMappingSchema.safeParse(input); return r.success ? r.data : fail('口径 mapping', r); }
export const deviceFitTableJsonSchema = (): unknown => z.toJSONSchema(DeviceFitTableSchema, { io: 'input' });
export const koujingMappingJsonSchema = (): unknown => z.toJSONSchema(KoujingMappingSchema, { io: 'input' });

/** λ per device-hour from a stated value and unit (the formulas of the module header) */
export function devicePerHour(value: number, unit: DeviceRateUnit): number {
  switch (unit) {
    case 'FIT': return value / 1e9;
    case 'per_1e6_h': return value / 1e6;
    case 'per_h': return value;
    case 'mtbf_h': return value > 0 ? 1 / value : Infinity;
    case 'afr': if (!(value < 1)) throw new Error(`AFR must be a fraction below 1 (got ${value})`); return -Math.log(1 - value) / HOURS_PER_YEAR;
  }
}
/** device FIT = λ × 10⁹ */
export const deviceFit = (row: Pick<DeviceFitRow, 'value' | 'unit'>): number => devicePerHour(row.value, row.unit) * 1e9;
const UNIT_TEXT: Record<DeviceRateUnit, string> = { FIT: 'FIT', per_1e6_h: 'per 10⁶ h', per_h: 'per h', mtbf_h: 'h MTBF', afr: 'AFR' };
const CONV_TEXT: Record<DeviceRateUnit, string> = { FIT: '', per_1e6_h: ' × 10³', per_h: ' × 10⁹', mtbf_h: ' → 10⁹ / MTBF', afr: ' → −ln(1 − AFR) / 8760 h × 10⁹' };

/** source type → HAC-D confidence when the value passes through untouched */
export const SOURCE_CONFIDENCE: Record<SourceType, FaultRateEntry['confidence']> = { field: 'measured', vendor: 'vendor', prediction: 'paper-reported', paper: 'paper-reported', assumed: 'assumed' };

/** deterministic number formatting for derivation strings: up to 6 significant digits, no locale */
export const num = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : String(x));

export interface NormalizedTerm {
  device: string; value: number; unit: DeviceRateUnit; sourceType: SourceType; source: string; loc?: string;
  /** device FIT after the unit conversion */
  fit: number;
  devicesPerUnit: number; impactFactor: number; impactConfidence: MappingRow['impactConfidence']; impactBasis: string;
  /** FIT_device × devicesPerUnit × impactFactor */
  contribution: number;
}
export interface NormalizedClass { class: string; unit: FaultUnit; fit: number; confidence: FaultRateEntry['confidence']; terms: NormalizedTerm[] }
export interface NormalizeReport {
  classes: NormalizedClass[];
  /** devices of the table with no mapping row: an error of the mapping, listed so nobody misses them */
  unmappedDevices: string[];
  /** mapping rows whose device is not in the table (stale rows) */
  unusedMappings: string[];
  warnings: string[];
}
export interface NormalizeOptions {
  /** id of the produced override */
  id: string;
  source?: string;
  /** catalog block copied to the override (revision, hash, rate basis) */
  catalog?: FaultRateOverride['catalog'];
  /** class → class whose value it takes when absent (e.g. the @roce analogues) */
  analogues?: Record<string, string>;
  /** fail (default) or warn when a device has no mapping row */
  unmapped?: 'error' | 'warn';
}

let LIB: Map<string, UnitFaultType> | undefined;
const lib = () => (LIB ??= new Map(unitFaultLibrary().map((f) => [f.id, f])));

/**
 * Apply the mapping table to the device table: one override entry per class with the summed business-impact FIT per unit-hour,
 * the full derivation and the policy confidence. Throws when a class is unknown to the unit library, a mapping row's unit differs
 * from the library unit of its class, or (by default) a device has no mapping row.
 */
export function normalizeFaultRates(tableIn: unknown, mappingIn: unknown, o: NormalizeOptions): { override: FaultRateOverride; report: NormalizeReport } {
  const table = parseDeviceFitTable(tableIn), mapping = parseKoujingMapping(mappingIn);
  const errors: string[] = [], warnings: string[] = [];
  const byDevice = new Map(table.rows.map((r) => [r.device, r] as const));
  const mappedDevices = new Set(mapping.rows.map((m) => m.device));
  const unmappedDevices = table.rows.filter((r) => !mappedDevices.has(r.device)).map((r) => r.device);
  const unusedMappings = [...new Set(mapping.rows.filter((m) => !byDevice.has(m.device)).map((m) => m.device))];
  if (unmappedDevices.length) (o.unmapped === 'warn' ? warnings : errors).push(`devices without a mapping row: ${unmappedDevices.join(', ')}`);
  if (unusedMappings.length) warnings.push(`mapping rows for devices not in the table: ${unusedMappings.join(', ')}`);

  const perClass = new Map<string, { unit: FaultUnit; terms: NormalizedTerm[] }>();
  for (const m of mapping.rows) {
    const d = byDevice.get(m.device);
    if (!d) continue;
    const f = lib().get(m.class);
    if (!f) { errors.push(`class '${m.class}' (device ${m.device}) is not in the unit library`); continue; }
    if (f.unit !== m.unit) { errors.push(`class '${m.class}' belongs to unit '${f.unit}', the mapping row of ${m.device} says '${m.unit}'`); continue; }
    const fit = deviceFit(d);
    const term: NormalizedTerm = {
      device: d.device, value: d.value, unit: d.unit, sourceType: d.sourceType, source: d.source, ...(d.loc ? { loc: d.loc } : {}),
      fit, devicesPerUnit: m.devicesPerUnit, impactFactor: m.impactFactor, impactConfidence: m.impactConfidence, impactBasis: m.impactBasis,
      contribution: fit * m.devicesPerUnit * m.impactFactor,
    };
    const e = perClass.get(m.class) ?? { unit: m.unit, terms: [] };
    e.terms.push(term);
    perClass.set(m.class, e);
  }
  for (const [cls, to] of Object.entries(o.analogues ?? {})) if (!perClass.has(to)) errors.push(`analogue '${cls}' → '${to}': '${to}' has no mapped device`);
  if (errors.length) throw new Error(`口径 normalisation failed: ${errors.join('; ')}`);

  const classes: NormalizedClass[] = [];
  const rates: FaultRateOverride['rates'] = {};
  for (const [cls, { unit, terms }] of [...perClass.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    terms.sort((a, b) => a.device.localeCompare(b.device));
    const fit = terms.reduce((s, t) => s + t.contribution, 0);
    const assumed = terms.some((t) => t.impactConfidence === 'assumed' || t.sourceType === 'assumed');
    const passThrough = terms.length === 1 && terms[0].devicesPerUnit === 1 && terms[0].impactFactor === 1 && terms[0].unit === 'FIT';
    const confidence: FaultRateEntry['confidence'] = assumed ? 'assumed' : passThrough ? SOURCE_CONFIDENCE[terms[0].sourceType] : 'derived';
    const termText = terms.map((t) => `${t.device} ${num(t.value)} ${UNIT_TEXT[t.unit]}${CONV_TEXT[t.unit]} = ${num(t.fit)} FIT/device × ${num(t.devicesPerUnit)} per ${unit} × impact ${num(t.impactFactor)} (${t.impactBasis}; ${t.impactConfidence}) = ${num(t.contribution)}`).join(' + ');
    const derivation = `${termText}${terms.length > 1 ? ` = ${num(fit)}` : ''} FIT per ${unit}-hour, business-impact, class ${cls}; mapping ${mapping.id}${mapping.version ? ` ${mapping.version}` : ''}`;
    const source = `${table.source ?? table.id}: ${[...new Set(terms.map((t) => `${t.source}${t.loc ? ` ${t.loc}` : ''}`))].join('; ')}; 口径 mapping ${mapping.id}`;
    const note = `source types ${[...new Set(terms.map((t) => t.sourceType))].join(', ')}; impact ${[...new Set(terms.map((t) => t.impactConfidence))].join(', ')}`;
    rates[cls] = { unit, fit, source, confidence, derivation, note };
    classes.push({ class: cls, unit, fit, confidence, terms });
  }
  const override = parseFaultRateOverride({
    id: o.id, basis: 'per-unit',
    source: o.source ?? `${table.source ?? table.id} through 口径 mapping ${mapping.id}: Σ device FIT × devices per unit × impact factor per class (business-impact FIT per unit-hour)`,
    ...(o.catalog ?? table.catalog ? { catalog: { ...(table.catalog ?? {}), ...(o.catalog ?? {}) } } : {}),
    rates, ...(o.analogues ? { analogues: o.analogues } : {}),
  });
  return { override, report: { classes, unmappedDevices, unusedMappings, warnings } };
}
