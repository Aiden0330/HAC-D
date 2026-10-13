/**
 * Failure-rate estimation from incident counts (docs/MODEL_REFERENCE.md §23): a Poisson count k over an exposure E
 * (unit-hours) gives the point estimate λ = k/E, FIT = λ·10⁹ and the exact (Garwood) confidence interval
 * λ ∈ [χ²_{α/2}(2k)/(2E), χ²_{1−α/2}(2k+2)/(2E)]. With zero events the one-sided upper bound at the confidence level is
 * χ²_c(2)/(2E) = −ln(1 − c)/E (so 95 % and 10⁶ unit-hours give 2995.7 FIT). Counts must be de-duplicated business
 * events of one class (not alarms), the exposure the operating unit-hours of that class.
 */
import { chiSquareQuantile } from '../math/special.js';

export interface RateEstimate {
  events: number;
  exposureHours: number;
  confidence: number;
  ratePerHour: number;
  fit: number;
  mtbfHours: number;
  lower: { ratePerHour: number; fit: number; mtbfHours: number };
  upper: { ratePerHour: number; fit: number; mtbfHours: number };
  method: 'garwood-exact' | 'zero-event-upper-bound';
  notes: string[];
}

function triple(ratePerHour: number) {
  return { ratePerHour, fit: ratePerHour * 1e9, mtbfHours: ratePerHour > 0 ? 1 / ratePerHour : Infinity };
}

export function rateFromCounts(events: number, exposureHours: number, confidence = 0.95): RateEstimate {
  if (!Number.isInteger(events) || events < 0) throw new RangeError(`events must be a non-negative integer, got ${events}`);
  if (!(exposureHours > 0)) throw new RangeError(`exposureHours must be > 0, got ${exposureHours}`);
  if (!(confidence > 0 && confidence < 1)) throw new RangeError(`confidence must be in (0, 1), got ${confidence}`);
  const E = exposureHours;
  const rate = events / E;
  const notes: string[] = ['counts are de-duplicated business-impact events of one class; the exposure is the operating unit-hours of that class (口径: per unit-hour)', 'the interval covers Poisson sampling only: constant rate, independent events; trends, infant mortality and reporting gaps need their own evidence'];
  if (events === 0) {
    const upper = chiSquareQuantile(confidence, 2) / (2 * E); // = −ln(1 − c)/E
    notes.push(`zero events: one-sided ${(confidence * 100).toFixed(0)} % upper bound −ln(1 − c)/E; the point estimate 0 must not be used as the rate`);
    return { events, exposureHours: E, confidence, ...triple(rate), lower: triple(0), upper: triple(upper), method: 'zero-event-upper-bound', notes };
  }
  const alpha = 1 - confidence;
  const lower = chiSquareQuantile(alpha / 2, 2 * events) / (2 * E);
  const upper = chiSquareQuantile(1 - alpha / 2, 2 * events + 2) / (2 * E);
  return { events, exposureHours: E, confidence, ...triple(rate), lower: triple(lower), upper: triple(upper), method: 'garwood-exact', notes };
}

/** Per-unit rate of a component class from its incident count, the number of units and the observation hours (exposure = units × hours). */
export function unitRateFromCounts(events: number, units: number, hours: number, confidence = 0.95): RateEstimate & { units: number; hours: number } {
  if (!(units > 0) || !(hours > 0)) throw new RangeError('units and hours must be > 0');
  const r = rateFromCounts(events, units * hours, confidence);
  r.notes.push(`exposure = ${units} units × ${hours} h = ${(units * hours).toExponential(3)} unit-hours`);
  return { ...r, units, hours };
}
