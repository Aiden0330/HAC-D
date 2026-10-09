/**
 * Parameter library: 口径-typed records with provenance extracted from the survey chapter
 * (data in ../../data/library.json; loaded by the app or CLI, not bundled with the core).
 */
import type { RateUnit } from '../units/index.js';

export interface LibraryRecord {
  id: string;
  class: string;
  kind: 'fraction' | 'stage_time' | 'count' | 'failure_rate' | 'mtbf' | 'availability' | 'ratio' | 'mtbe' | 'mttf' | 'duration' | 'mttr' | 'probability' | string;
  name: { zh?: string; en?: string };
  value: number | null;
  unit: string;
  range?: { low: number | null; high: number | null };
  distribution?: { type: string; shape: number | null; note: string | null };
  koujing: { event: string; denominator: string; level: string; includes_planned?: boolean; dedup?: string | null };
  applicability: { hardware?: string | null; scale?: string | null; period?: string | null; phase?: string; workload?: string; stage?: string; setting?: string; variant?: string };
  provenance: { source: string; org?: string; venue?: string; year?: number; url?: string | null; survey_ref?: string; confidence: string; derivation?: string | null };
  caveat?: { zh?: string; en?: string };
}

export interface Library {
  version: string;
  generated: string;
  source_document: string;
  vocab: Record<string, unknown>;
  records: LibraryRecord[];
}

export interface LibraryFilter {
  class?: string;
  kind?: string;
  confidence?: string;
  stage?: string;
  query?: string;
  /** only records convertible to a component failure rate */
  ratesOnly?: boolean;
}

export function filterLibrary(lib: Library, f: LibraryFilter): LibraryRecord[] {
  const q = f.query?.trim().toLowerCase();
  return lib.records.filter((r) => {
    if (f.class && r.class !== f.class) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.confidence && r.provenance.confidence !== f.confidence) return false;
    if (f.stage && r.applicability.stage !== f.stage) return false;
    if (f.ratesOnly && !recordToFailureRate(r)) return false;
    if (q) {
      const hay = [r.id, r.name.zh, r.name.en, r.provenance.source, r.provenance.org, r.applicability.hardware, r.caveat?.en, r.caveat?.zh].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Convert a library record into a component failure-rate input {value, unit} when its unit allows it. */
export function recordToFailureRate(r: LibraryRecord): { value: number; unit: RateUnit } | null {
  if (r.value === null || !Number.isFinite(r.value)) return null;
  const v = r.value;
  switch (r.unit) {
    case 'per_gpu_h':
    case 'per_h':
      return { value: v, unit: 'per_h' };
    case 'per_1000_node_day':
      return { value: v, unit: 'per_1000_node_day' };
    case 'per_day':
    case 'per_device_day':
    case 'per_gpu_day':
      return { value: v, unit: 'per_day' };
    case 'pct_per_day':
      return { value: v / 100, unit: 'per_day' };
    case 'pct_per_week':
      return { value: v / 100, unit: 'per_week' };
    case 'pct_per_month':
      return { value: v / 100, unit: 'per_month' };
    case 'per_year':
    case 'per_socket_year':
      return { value: v, unit: 'per_year' };
    case 'FIT':
      return { value: v, unit: 'FIT' };
    case 'gpu_h_per_event':
      return { value: v, unit: 'gpu_h_per_event' };
    case 'gpu_day_per_event':
      return { value: v, unit: 'gpu_day_per_event' };
    case 'node_h_per_event':
    case 'processor_h_per_event':
    case 'socket_h_per_event':
      return { value: v, unit: 'h_per_event' };
    case 'h':
      return r.kind === 'mtbf' || r.kind === 'mttf' || r.kind === 'mtbe' ? { value: v, unit: 'mtbf_h' } : null;
    case 'months':
      return r.kind === 'mtbf' || r.kind === 'mttf' ? { value: v * 730.5, unit: 'mtbf_h' } : null;
    case 'days':
      return r.kind === 'mtbf' || r.kind === 'mttf' ? { value: v * 24, unit: 'mtbf_h' } : null;
    default:
      return null;
  }
}

/** Seconds for a recovery-stage or MTTR record, when its unit is a time. */
export function recordToSeconds(r: LibraryRecord): number | null {
  if (r.value === null) return null;
  switch (r.unit) {
    case 's':
      return r.value;
    case 'min':
      return r.value * 60;
    case 'h':
      return r.value * 3600;
    case 'days':
      return r.value * 86400;
    default:
      return null;
  }
}

export const LIBRARY_CLASSES = [
  'gpu', 'hbm', 'nvlink_nvswitch', 'nic_optics', 'switch', 'host', 'node', 'psu_power', 'cooling', 'storage', 'software', 'tpu_machine', 'ici_cable', 'ocs',
  'job', 'cluster', 'recovery_stage', 'checkpoint', 'spares', 'sdc', 'failslow', 'ccf', 'prediction', 'screening', 'composition', 'ascend',
] as const;
