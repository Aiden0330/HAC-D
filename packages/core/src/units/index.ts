/**
 * 口径-aware quantities. A reliability number is meaningless without its event
 * definition, denominator and level (survey §2). This module makes those explicit
 * and performs conversions to a canonical per-unit-hour rate.
 */

export type EventClass =
  | 'job_interruption_unplanned'
  | 'job_interruption_all'
  | 'node_failure'
  | 'host_crash'
  | 'machine_failure'
  | 'error_event'
  | 'xid_event'
  | 'ticket'
  | 'sdc_event'
  | 'stage_duration'
  | 'unknown'
  /** any other event definition, spelled out */
  | (string & {});

export type Level = 'component' | 'node' | 'job' | 'fleet';

export interface Koujing {
  event: EventClass;
  /** what one unit of exposure is: 'gpu_h', 'node_day', 'device_day', 'job_day', 'machine_week', ... */
  denominator: string;
  level: Level;
  includesPlanned?: boolean;
  dedup?: string | null;
}

/** Rate / interval units accepted for failure parameters. */
export type RateUnit =
  | 'per_h' // events per unit-hour
  | 'per_1e6_h' // events per million unit-hours
  | 'FIT' // events per 1e9 unit-hours
  | 'per_year' // events per unit-year (AFR when ≪ 1)
  | 'per_day' // events per unit-day (daily failure fraction)
  | 'per_1000_node_day' // Meta r_f convention
  | 'per_node_day'
  | 'per_month'
  | 'per_week'
  | 'mtbf_h' // hours between events
  | 'h_per_event' // same as mtbf_h
  | 'gpu_h_per_event'
  | 'gpu_day_per_event'
  | 'node_h_per_event';

export const HOURS_PER_DAY = 24;
export const HOURS_PER_YEAR = 8760;
export const HOURS_PER_WEEK = 168;
/** 30.4375-day month, used only when a source quotes "per month". */
export const HOURS_PER_MONTH = 730.5;

/** Convert a rate expressed in `unit` to events per unit-hour. */
export function toPerHour(value: number, unit: RateUnit): number {
  switch (unit) {
    case 'per_h':
      return value;
    case 'per_1e6_h':
      return value / 1e6;
    case 'FIT':
      return value / 1e9;
    case 'per_year':
      return value / HOURS_PER_YEAR;
    case 'per_day':
    case 'per_node_day':
      return value / HOURS_PER_DAY;
    case 'per_1000_node_day':
      return value / (1000 * HOURS_PER_DAY);
    case 'per_month':
      return value / HOURS_PER_MONTH;
    case 'per_week':
      return value / HOURS_PER_WEEK;
    case 'mtbf_h':
    case 'h_per_event':
    case 'gpu_h_per_event':
    case 'node_h_per_event':
      return value > 0 ? 1 / value : Infinity;
    case 'gpu_day_per_event':
      return value > 0 ? 1 / (value * HOURS_PER_DAY) : Infinity;
  }
}

/** Convert a per-unit-hour rate to the requested unit. */
export function fromPerHour(ratePerHour: number, unit: RateUnit): number {
  switch (unit) {
    case 'per_h':
      return ratePerHour;
    case 'per_1e6_h':
      return ratePerHour * 1e6;
    case 'FIT':
      return ratePerHour * 1e9;
    case 'per_year':
      return ratePerHour * HOURS_PER_YEAR;
    case 'per_day':
    case 'per_node_day':
      return ratePerHour * HOURS_PER_DAY;
    case 'per_1000_node_day':
      return ratePerHour * 1000 * HOURS_PER_DAY;
    case 'per_month':
      return ratePerHour * HOURS_PER_MONTH;
    case 'per_week':
      return ratePerHour * HOURS_PER_WEEK;
    case 'mtbf_h':
    case 'h_per_event':
    case 'gpu_h_per_event':
    case 'node_h_per_event':
      return ratePerHour > 0 ? 1 / ratePerHour : Infinity;
    case 'gpu_day_per_event':
      return ratePerHour > 0 ? 1 / (ratePerHour * HOURS_PER_DAY) : Infinity;
  }
}

/**
 * Re-level a per-unit-hour rate between node and GPU denominators.
 * A node-level rate divided by GPUs/node gives the per-GPU-hour rate of the
 * same events (survey Table 2-2: 1000 × 24 × 8 ÷ r_f).
 */
export function nodeRateToGpuRate(ratePerNodeHour: number, gpusPerNode: number): number {
  return ratePerNodeHour / gpusPerNode;
}

export function gpuRateToNodeRate(ratePerGpuHour: number, gpusPerNode: number): number {
  return ratePerGpuHour * gpusPerNode;
}

/** Steady-state availability from MTTF (or MTBF) and MTTR in the same time unit. */
export function availabilityFromMttfMttr(mttf: number, mttr: number): number {
  if (!(mttf > 0)) return 0;
  return mttf / (mttf + mttr);
}

/** Steady-state unavailability u = λ·MTTR / (1 + λ·MTTR) for a two-state unit. */
export function unavailability(ratePerHour: number, mttrHours: number): number {
  const x = ratePerHour * mttrHours;
  return x / (1 + x);
}

/** AFR ≈ 8760 h ÷ MTTF (survey §2, FIT / AFR row). */
export function afrFromMttfHours(mttfHours: number): number {
  return HOURS_PER_YEAR / mttfHours;
}

/** Whether two 口径 describe the same kind of event, i.e. whether their rates may be added. */
export function sameEventClass(a: Koujing, b: Koujing): boolean {
  return a.event === b.event && a.level === b.level;
}

export class KoujingMismatchError extends Error {
  constructor(a: Koujing, b: Koujing) {
    super(`Cannot combine rates of different event classes: ${a.event}@${a.level} vs ${b.event}@${b.level}`);
    this.name = 'KoujingMismatchError';
  }
}

/** Throws if rates of different event classes would be summed. */
export function assertAddable(a: Koujing, b: Koujing): void {
  if (!sameEventClass(a, b)) throw new KoujingMismatchError(a, b);
}

/** Human-readable duration formatter (seconds → s / min / h / days / years). */
export function formatDuration(seconds: number, digits = 1): string {
  if (!Number.isFinite(seconds)) return '∞';
  if (seconds < 120) return `${seconds.toFixed(seconds < 10 ? 2 : 0)} s`;
  if (seconds < 7200) return `${(seconds / 60).toFixed(digits)} min`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(digits)} h`;
  if (seconds < 86400 * 3650) return `${(seconds / 86400).toFixed(digits)} d`;
  return `${(seconds / (86400 * 365.25)).toFixed(0)} y`;
}
