/** Monetising reliability (survey §6.5): wasted GPU·h, $/day, spare capex, option deltas. */

export interface CostInputs {
  nGpus: number;
  /** $ per GPU-hour (e.g. AWS Capacity Blocks ≈ $1.44M / 16,384 GPU·day ≈ $3.66/GPU·h) */
  pricePerGpuHour: number;
}

export const AWS_CAPACITY_BLOCK_PRICE_PER_GPU_HOUR = 1.44e6 / (16384 * 24);

export function wastedGpuHoursPerDay(nGpus: number, goodput: number): number {
  return nGpus * 24 * (1 - goodput);
}

export function lostDollarsPerDay(inputs: CostInputs, goodput: number): number {
  return wastedGpuHoursPerDay(inputs.nGpus, goodput) * inputs.pricePerGpuHour;
}

/** TrainMover's accounting: Cost/day ≈ N × (1 − ETTR) × ($1.44M / 16,384 GPU·day). */
export function trainMoverCostPerDay(nGpus: number, ettr: number, pricePer16kGpuDay = 1.44e6): number {
  return nGpus * (1 - ettr) * (pricePer16kGpuDay / 16384);
}

/** Spare capacity carrying cost: idle spare GPU-hours priced at the same rate. */
export function spareCarryingCostPerDay(spareGpus: number, pricePerGpuHour: number, utilisationOfSpares = 0): number {
  return spareGpus * 24 * (1 - utilisationOfSpares) * pricePerGpuHour;
}

export interface OptionCost {
  id: string;
  name: string;
  goodput: number;
  spareGpus: number;
  /** one-off or amortised extra $/day for the option (e.g. dual ToR, 2N power) */
  extraDollarsPerDay?: number;
}

export interface OptionCostRow extends OptionCost {
  lostPerDay: number;
  sparesPerDay: number;
  totalPerDay: number;
  deltaVsBase: number;
}

/** Side-by-side $/day of design options; the first option is the base. */
export function compareOptionCosts(inputs: CostInputs, options: OptionCost[]): OptionCostRow[] {
  const rows = options.map((o) => {
    const lostPerDay = lostDollarsPerDay(inputs, o.goodput);
    const sparesPerDay = spareCarryingCostPerDay(o.spareGpus, inputs.pricePerGpuHour);
    const totalPerDay = lostPerDay + sparesPerDay + (o.extraDollarsPerDay ?? 0);
    return { ...o, lostPerDay, sparesPerDay, totalPerDay, deltaVsBase: 0 };
  });
  const base = rows[0]?.totalPerDay ?? 0;
  for (const r of rows) r.deltaVsBase = r.totalPerDay - base;
  return rows;
}

/** GPU-equivalent value of a goodput improvement: N × Δgoodput. */
export function gpuEquivalentOfGoodput(nGpus: number, goodputDelta: number): number {
  return nGpus * goodputDelta;
}
