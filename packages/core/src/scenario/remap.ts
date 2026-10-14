/**
 * v3.6 ReMAP / reference-catalog importer (docs/REMAP_INTEGRATION.md): turn an event catalog in the shape ReMAP and the
 * reference engine use (`catalogs/review-2026-10-09/inputs.json`: `current.events` with FIT, `legacy.events` with the
 * type / scope / persistence / replay / process / elastic flags; ReMAP's frozen run inputs or `events.json` exports; or a
 * plain array of events) into a HAC-D scenario at catalog granularity. Flags missing from the input are taken from the
 * built-in audited catalog by event id, otherwise set to false with a warning. FIT is per NPU-equivalent operating hour.
 */
import { REFERENCE_EVENTS, type ReferenceEvent } from './referenceEvents.js';
import { catalogScenario, type CatalogScenarioOptions } from './examples.js';
import type { Scenario } from './schema.js';

export interface RemapEventLike {
  id: string;
  type?: string;
  typeName?: string;
  fit?: number;
  domain?: string;
  domainId?: string;
  description?: string;
  symptom?: string;
  scope?: string;
  persistence?: string;
  replay?: boolean;
  process?: boolean;
  elastic?: boolean;
}

const TYPE_MAP: Record<string, ReferenceEvent['type']> = { hard: 'hard', slow: 'slow', sdc: 'sdc', 中断: 'hard', 亚健康: 'slow', 静默: 'sdc', interruption: 'hard', 'sub-health': 'slow', silent: 'sdc' };

function eventsOf(input: unknown): { current: RemapEventLike[]; legacy: RemapEventLike[] } {
  if (Array.isArray(input)) return { current: input as RemapEventLike[], legacy: [] };
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const current = (o.current as { events?: RemapEventLike[] } | undefined)?.events ?? (o.events as RemapEventLike[] | undefined);
    const legacy = (o.legacy as { events?: RemapEventLike[] } | undefined)?.events ?? [];
    if (Array.isArray(current)) return { current, legacy: Array.isArray(legacy) ? legacy : [] };
  }
  throw new Error('expected an array of events, {events: [...]}, or {current: {events}, legacy: {events}} (ReMAP / reference inputs.json)');
}

/** Normalize a ReMAP / reference event list into the built-in catalog's record shape. */
export function remapEventsFrom(input: unknown): { events: ReferenceEvent[]; warnings: string[] } {
  const { current, legacy } = eventsOf(input);
  const legacyById = new Map(legacy.map((e) => [e.id, e]));
  const builtIn = new Map(REFERENCE_EVENTS.map((e) => [e.id, e]));
  const warnings: string[] = [];
  const events: ReferenceEvent[] = [];
  for (const e of current) {
    if (!e || typeof e.id !== 'string') throw new Error('every event needs a string id');
    const leg = legacyById.get(e.id);
    const ref = builtIn.get(e.id);
    const rawType = e.type ?? leg?.type ?? ref?.type ?? '';
    const type = TYPE_MAP[rawType] ?? TYPE_MAP[(e.typeName ?? leg?.typeName ?? '') as string];
    if (!type) throw new Error(`event ${e.id}: unknown type "${rawType}" (expected hard / slow / sdc or 中断 / 亚健康 / 静默)`);
    const fit = e.fit ?? leg?.fit;
    if (!(typeof fit === 'number' && Number.isFinite(fit) && fit >= 0)) throw new Error(`event ${e.id}: FIT must be a non-negative number`);
    const flagsFrom = [e, leg, ref].find((x) => x && (x.replay !== undefined || x.process !== undefined || x.elastic !== undefined));
    if (type === 'hard' && !flagsFrom) warnings.push(`${e.id}: no replay / process / elastic flags in the input or the built-in catalog; set to false (only the global recovery applies)`);
    events.push({
      id: e.id,
      domainId: e.domainId ?? leg?.domainId ?? ref?.domainId ?? e.id.split('-')[0],
      domain: e.domain ?? leg?.domain ?? ref?.domain ?? e.id,
      description: e.description ?? e.symptom ?? leg?.symptom ?? ref?.description ?? '',
      type,
      fit,
      scope: e.scope ?? leg?.scope ?? ref?.scope ?? 'card',
      persistence: e.persistence ?? leg?.persistence ?? ref?.persistence ?? 'unknown',
      replay: !!(flagsFrom?.replay ?? false),
      process: !!(flagsFrom?.process ?? false),
      elastic: !!(flagsFrom?.elastic ?? false),
    });
  }
  if (!events.length) throw new Error('no events in the input');
  return { events, warnings };
}

export interface RemapImportResult {
  scenario: Scenario;
  events: ReferenceEvent[];
  warnings: string[];
  /** class FIT totals per card-hour (business-impact events), as the reference tools report them */
  classFit: { hard: number; slow: number; sdc: number };
}

/** Import a ReMAP / reference event catalog as a HAC-D scenario. */
export function importRemapCatalog(input: unknown, opts: CatalogScenarioOptions = {}): RemapImportResult {
  const { events, warnings } = remapEventsFrom(input);
  const classFit = { hard: 0, slow: 0, sdc: 0 };
  for (const e of events) classFit[e.type] += e.fit;
  const npus = opts.npus ?? 100000;
  const scenario = catalogScenario(events, {
    ...opts,
    npus,
    id: opts.id ?? `remap-catalog-${Math.round(npus / 1000)}k`,
    name: opts.name ?? `Imported catalog, ${events.length} events — ${npus.toLocaleString('en-US')} cards`,
    source: opts.source ?? 'event catalog imported from ReMAP / ai-cluster-reliability (FIT per NPU-equivalent operating hour, business-impact events after the existing protection)',
    description: opts.description ?? `${events.length} events (class FIT per card-hour: interruption ${classFit.hard.toFixed(2)}, sub-health ${classFit.slow.toFixed(2)}, silent ${classFit.sdc.toFixed(2)}) at catalog granularity with per-event replay / process / elastic flags; reference-engine baseline settings (checkpoints, detection, recovery, 120 h fallback) unless edited.`,
  });
  return { scenario, events, warnings, classFit };
}
