import { MECHANISM_LIBRARY, DEFAULT_PLAYERS, type AttributionMetric, type TornadoMetric, type AllocationMethod, type AllocationBasis, type LossBudgetMethod, type LedgerLossLine } from '@hac-d/core';
import type { StrategySettings } from '../panels/StrategyPanel.js';

/**
 * v5.1 page settings of a project (persisted with its scenario; results, reports, plans and busy / progress / error stay local).
 * `null` means "the scenario's default" and is resolved against the current scenario when the page reads it (targets, the
 * strategy form, the comparison set), so a default follows the scenario until the user changes the value.
 * v5.2 the Projects page tab (list / new / import / compare) and the Review page tab (checklist / simulation / sensitivity) are
 * settings too; `compare` keeps the comparison set (Projects › Compare) and the tornado metric (Review › Sensitivity). Older
 * bundles without the two new groups normalise to their defaults.
 */
/** v5.3 'cross' (the former Cross-scale tab) is gone; v6.3 'report' (the Findings report of the project, one button) is the first tab and the default */
export type AllocationTab = 'report' | 'strategies' | 'classic';
export type MechanismsTab = 'selection' | 'chain' | 'audit';
export type TopologyTab = 'picture' | 'hardware' | 'reliability';
export type ProjectsTab = 'list' | 'new' | 'import' | 'compare';
export type ReviewTab = 'checklist' | 'simulation' | 'sensitivity';

export interface ProjectSettings {
  allocation: {
    tab: AllocationTab;
    /** StrategySettings of the Strategies tab (its single-size run, the report budget and the across-sizes card); null = defaultSettings(scenario) */
    strategy: StrategySettings | null;
    classic: {
      method: AllocationMethod;
      /** null = scenario.targets.goodput ?? 0.97 */
      goodputTarget: number | null;
      /** null = scenario.targets.availability ?? 0.999 */
      availabilityTarget: number | null;
      restartShare: number;
      /** null = delivered when the scenario has silent corruption, otherwise effective */
      basis: AllocationBasis | null;
      lossMethod: LossBudgetMethod;
      lossWeights: Partial<Record<LedgerLossLine, number>>;
    };
  };
  mechanisms: {
    tab: MechanismsTab;
    players: string[];
    metric: AttributionMetric;
    overrides: Record<string, Record<string, number>>;
    provisional: boolean;
    efforts: Record<string, number>;
    audit: { ids: string[]; provisional: boolean };
  };
  topology: { tab: TopologyTab; carry: boolean };
  /** Projects page tab */
  projects: { tab: ProjectsTab };
  /** Review page tab */
  review: { tab: ReviewTab };
  /** Projects › Compare: the comparison set (null = the first three projects); Review › Sensitivity: the tornado metric */
  compare: { ids: string[] | null; metric: TornadoMetric };
}

export function defaultProjectSettings(): ProjectSettings {
  return {
    allocation: {
      tab: 'report',
      strategy: null,
      classic: { method: 'arinc', goodputTarget: null, availabilityTarget: null, restartShare: 0.5, basis: null, lossMethod: 'proportional', lossWeights: {} },
    },
    mechanisms: {
      tab: 'selection',
      players: [...DEFAULT_PLAYERS],
      metric: 'delivered',
      overrides: {},
      provisional: false,
      efforts: {},
      audit: { ids: MECHANISM_LIBRARY.filter((m) => !!m.audit).map((m) => m.id), provisional: false },
    },
    topology: { tab: 'hardware', carry: true },
    projects: { tab: 'list' },
    review: { tab: 'checklist' },
    compare: { ids: null, metric: 'goodput' },
  };
}

/** the allowed values of the enumerated settings (a stored value outside the list falls back to the default) */
const ENUMS: Record<string, readonly string[]> = {
  'allocation.tab': ['report', 'strategies', 'classic'],
  'allocation.classic.method': ['arinc', 'agree', 'equal', 'feasibility', 'minimum-effort', 'cost-optimal'],
  'allocation.classic.lossMethod': ['proportional', 'equal', 'custom'],
  'mechanisms.tab': ['selection', 'chain', 'audit'],
  'mechanisms.metric': ['delivered', 'effective', 'aOp'],
  'topology.tab': ['picture', 'hardware', 'reliability'],
  'projects.tab': ['list', 'new', 'import', 'compare'],
  'review.tab': ['checklist', 'simulation', 'sensitivity'],
  'compare.metric': ['goodput', 'delivered', 'availability', 'lostDollarsPerDay', 'mtbiHours'],
};
const NULLABLE_ENUMS: Record<string, readonly string[]> = { 'allocation.classic.basis': ['effective', 'delivered'] };

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A stored value merged over the default: keys of the default are kept (a missing or mistyped value takes the default), unknown
 * keys are dropped; an empty-object default is a record (stored as-is when it is an object); a null default is a nullable slot
 * (stored value accepted when it is not undefined).
 */
function mergeOver(def: unknown, v: unknown, path: string): unknown {
  if (v === undefined) return def;
  if (path in NULLABLE_ENUMS) return v === null || (typeof v === 'string' && NULLABLE_ENUMS[path].includes(v)) ? v : def;
  if (def === null) return v;
  if (Array.isArray(def)) return Array.isArray(v) ? v : def;
  if (isPlain(def)) {
    if (!isPlain(v)) return def;
    const keys = Object.keys(def);
    if (keys.length === 0) return v;
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = mergeOver(def[k], v[k], path ? `${path}.${k}` : k);
    return out;
  }
  if (typeof v !== typeof def) return def;
  if (typeof v === 'number' && !Number.isFinite(v)) return def;
  if (path in ENUMS && !ENUMS[path].includes(v as string)) return def;
  return v;
}

/** settings of a stored project or bundle: merged over the defaults so older bundles stay valid */
export function normalizeSettings(v: unknown): ProjectSettings {
  return mergeOver(defaultProjectSettings(), v, '') as ProjectSettings;
}

/** a settings patch applied one level deep per page group (allocation / mechanisms / topology / projects / review / compare) */
export type SettingsPatch = { [K in keyof ProjectSettings]?: Partial<ProjectSettings[K]> };
export function applySettingsPatch(s: ProjectSettings, patch: SettingsPatch): ProjectSettings {
  const out = { ...s } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) if (v) out[k] = { ...(s as unknown as Record<string, Record<string, unknown>>)[k], ...v };
  return out as unknown as ProjectSettings;
}
