/**
 * Spare sizing (survey §6.3): Binomial P-quantile (ByteRobust), Poisson blocked
 * probability and quantile (Meta Sparing), in-repair pipeline with turnaround.
 */
import { binomQuantile, binomCdf, poissonCdf, poissonQuantile, logChoose } from '../math/special.js';

/** ByteRobust: K ~ Binomial(N, p_daily); hot spares = smallest k with P(K ≤ k) ≥ q. */
export function hotSparesBinomial(nMachines: number, pDaily: number, quantile = 0.99): number {
  return binomQuantile(nMachines, pDaily, quantile);
}

/** Expected simultaneously failed/in-repair units m = N·λ·MTTR (Meta: L·MTTR/MTBF). */
export function expectedInRepair(nUnits: number, lambdaPerHour: number, mttrHours: number): number {
  return nUnits * lambdaPerHour * mttrHours;
}

/** Poisson-quantile spares: smallest R with P(Poisson(N·λ·MTTR) ≤ R) ≥ q. */
export function hotSparesPoisson(nUnits: number, lambdaPerHour: number, mttrHours: number, quantile = 0.99): number {
  return poissonQuantile(expectedInRepair(nUnits, lambdaPerHour, mttrHours), quantile);
}

/** Meta Sparing Poisson approximation: Pr(blocked) ≈ 1 − Σ_{n≤R} m^n/n!·e^{−m}, m = L·MTTR/MTBF. */
export function blockedProbabilityPoisson(blocksL: number, mttrHours: number, mtbfHours: number, sparesR: number): number {
  const m = (blocksL * mttrHours) / mtbfHours;
  return Math.max(0, 1 - poissonCdf(m, sparesR));
}

/** Meta Sparing exact form: Pr(blocked) = 1 − (1 + MTTR/MTBF)^{−L} Σ_{n≤R} C(L,n)(MTTR/MTBF)^n. */
export function blockedProbabilityBinomial(blocksL: number, mttrHours: number, mtbfHours: number, sparesR: number): number {
  const r = mttrHours / mtbfHours;
  const u = r / (1 + r); // per-block unavailability
  return Math.max(0, 1 - binomCdf(blocksL, sparesR, u));
}

/** Smallest R such that the Poisson blocked probability ≤ target. */
export function sparesForBlockedTarget(blocksL: number, mttrHours: number, mtbfHours: number, targetBlocked: number): number {
  return poissonQuantile((blocksL * mttrHours) / mtbfHours, 1 - targetBlocked);
}

export interface PipelineSpares {
  /** expected units in the repair pipeline */
  mean: number;
  /** quantile of units in the pipeline → spare pool lower bound */
  quantile: number;
  /** spare fraction = quantile / N */
  fraction: number;
}

/**
 * Units simultaneously away for hardware repair when a fraction `hwFraction` of
 * interruptions needs a replacement and the turnaround is `leadTimeHours`
 * (the survey calculator's N·λ·fraction·L Poisson quantile).
 */
export function repairPipelineSpares(nUnits: number, lambdaPerHour: number, hwFraction: number, leadTimeHours: number, quantile = 0.99): PipelineSpares {
  const mean = nUnits * lambdaPerHour * hwFraction * leadTimeHours;
  const q = poissonQuantile(mean, quantile);
  return { mean, quantile: q, fraction: q / nUnits };
}

/** Expected hardware replacements over a job of `durationHours` (and its quantile). */
export function replacementsOverJob(nUnits: number, lambdaPerHour: number, hwFraction: number, durationHours: number, quantile = 0.99): { mean: number; quantile: number } {
  const mean = nUnits * lambdaPerHour * hwFraction * durationHours;
  return { mean, quantile: poissonQuantile(mean, quantile) };
}

/**
 * Compute-block MTBF for a block of K trays plus rack-level infrastructure in series
 * (Meta Sparing demo: tray MTBF 20K h, rack MTBF 10K h).
 */
export function blockMtbfHours(trays: number, trayMtbfH: number, rackMtbfH: number): number {
  return 1 / (trays / trayMtbfH + 1 / rackMtbfH);
}

/** log C(n,k) re-export for callers building custom tails. */
export { logChoose };
