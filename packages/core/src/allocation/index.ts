/**
 * Allocation of a system-level target to subsystems.
 * Classical series-system methods: equal apportionment, ARINC (proportional to current rates),
 * AGREE (complexity × importance × duty time), feasibility-of-improvement weights,
 * minimum-effort (Albert) and cost-optimal (Lagrangian) allocation.
 * AI-specific: goodput-budget allocation that turns a goodput target into an allowed job
 * interruption rate and recovery time, then distributes them over component classes and MTTR stages.
 */

export interface Subsystem {
  id: string;
  name?: string;
  /** number of identical units (modules) in the subsystem */
  count: number;
  /** current per-unit failure rate (per hour), if known */
  currentLambda?: number;
  /** AGREE importance: probability that the system fails when this subsystem fails (1 for strict series) */
  importance?: number;
  /** AGREE duty factor t_i / T in (0, 1] */
  duty?: number;
  /** feasibility-of-improvement weight (product of state-of-art, complexity, environment, time factors) */
  feasibilityWeight?: number;
  /** cost model for cost-optimal allocation: cost = a · (λ_current / λ)^b */
  cost?: { a: number; b: number };
  /** lower bound on achievable per-unit λ (best known in the library) */
  minLambda?: number;
  /** repair time (h) used when converting unavailability budgets to λ */
  mttr?: number;
  /** keep the current value, do not allocate */
  fixed?: boolean;
}

export interface AllocationRow {
  id: string;
  name: string;
  count: number;
  /** allocated aggregate failure rate for the subsystem (per hour) */
  lambdaAggregate: number;
  /** allocated per-unit failure rate (per hour) */
  lambdaPerUnit: number;
  /** allocated per-unit MTBF (h) */
  mtbfPerUnit: number;
  /** current aggregate (if known) and the required improvement factor current/allocated */
  currentAggregate?: number;
  improvementFactor?: number;
  feasibility: 'ok' | 'tighter-than-best-known' | 'unknown';
  weight?: number;
}

export interface AllocationResult {
  method: string;
  /** system-level aggregate failure-rate budget (per hour) */
  lambdaSystem: number;
  rows: AllocationRow[];
  notes: string[];
}

function finishRows(method: string, subs: Subsystem[], agg: number[], lambdaSystem: number, weights?: number[], notes: string[] = []): AllocationResult {
  const rows: AllocationRow[] = subs.map((s, i) => {
    const perUnit = agg[i] / s.count;
    const cur = s.currentLambda !== undefined ? s.currentLambda * s.count : undefined;
    let feasibility: AllocationRow['feasibility'] = 'unknown';
    if (s.minLambda !== undefined) feasibility = perUnit >= s.minLambda ? 'ok' : 'tighter-than-best-known';
    return {
      id: s.id,
      name: s.name ?? s.id,
      count: s.count,
      lambdaAggregate: agg[i],
      lambdaPerUnit: perUnit,
      mtbfPerUnit: perUnit > 0 ? 1 / perUnit : Infinity,
      currentAggregate: cur,
      improvementFactor: cur !== undefined && agg[i] > 0 ? cur / agg[i] : undefined,
      feasibility,
      weight: weights?.[i],
    };
  });
  return { method, lambdaSystem, rows, notes };
}

function splitFixed(subs: Subsystem[], lambdaSystem: number): { free: number[]; fixedTotal: number } {
  const free: number[] = [];
  let fixedTotal = 0;
  subs.forEach((s, i) => {
    if (s.fixed && s.currentLambda !== undefined) fixedTotal += s.currentLambda * s.count;
    else free.push(i);
  });
  if (fixedTotal > lambdaSystem) throw new RangeError('Fixed subsystems already exceed the system failure-rate budget');
  return { free, fixedTotal };
}

/** Equal apportionment: each free subsystem receives the same aggregate failure rate. */
export function equalApportionment(subs: Subsystem[], lambdaSystem: number): AllocationResult {
  const { free, fixedTotal } = splitFixed(subs, lambdaSystem);
  const agg = subs.map((s) => (s.fixed && s.currentLambda !== undefined ? s.currentLambda * s.count : 0));
  const share = (lambdaSystem - fixedTotal) / free.length;
  for (const i of free) agg[i] = share;
  return finishRows('equal', subs, agg, lambdaSystem);
}

/** ARINC: λ_i* = w_i λ*, w_i = current_i / Σ current (needs current rates). */
export function arinc(subs: Subsystem[], lambdaSystem: number): AllocationResult {
  const { free, fixedTotal } = splitFixed(subs, lambdaSystem);
  const cur = subs.map((s) => (s.currentLambda ?? NaN) * s.count);
  if (free.some((i) => !Number.isFinite(cur[i]))) throw new RangeError('ARINC needs currentLambda for every allocated subsystem');
  const total = free.reduce((a, i) => a + cur[i], 0);
  const agg = subs.map((s, i) => (s.fixed && s.currentLambda !== undefined ? s.currentLambda * s.count : 0));
  const weights = subs.map((_, i) => (free.includes(i) ? cur[i] / total : 0));
  for (const i of free) agg[i] = weights[i] * (lambdaSystem - fixedTotal);
  return finishRows('arinc', subs, agg, lambdaSystem, weights);
}

/**
 * AGREE (series system): subsystem i with n_i modules, importance w_i, duty t_i/T.
 * Classical form for a mission reliability R*: R_i = 1 − (1 − R*^{n_i/N}) / w_i, λ_i = −ln R_i / (t_i).
 * Here the mission is a unit horizon and the budget is a system failure rate λ*, so
 * R* = e^{−λ*·T}; the allocated aggregate rate is λ_i = −ln(R_i) / (duty_i · T).
 */
export function agree(subs: Subsystem[], lambdaSystem: number, horizonHours = 24): AllocationResult {
  const { free, fixedTotal } = splitFixed(subs, lambdaSystem);
  const N = free.reduce((a, i) => a + subs[i].count, 0);
  const Rstar = Math.exp(-(lambdaSystem - fixedTotal) * horizonHours);
  const agg = subs.map((s) => (s.fixed && s.currentLambda !== undefined ? s.currentLambda * s.count : 0));
  const weights = new Array<number>(subs.length).fill(0);
  const notes = [`AGREE with horizon T = ${horizonHours} h; R* = ${Rstar.toExponential(3)}`];
  for (const i of free) {
    const s = subs[i];
    const w = s.importance ?? 1;
    const duty = s.duty ?? 1;
    const Ri = 1 - (1 - Math.pow(Rstar, s.count / N)) / w;
    if (!(Ri > 0)) throw new RangeError(`AGREE: subsystem ${s.id} gets a non-positive reliability; lower the importance or the budget`);
    agg[i] = -Math.log(Ri) / (duty * horizonHours);
    weights[i] = s.count / N;
  }
  // AGREE is exact only to first order in the horizon; rescale so the aggregate meets the budget.
  const sumFree = free.reduce((a, i) => a + agg[i], 0);
  const scale = (lambdaSystem - fixedTotal) / sumFree;
  if (Math.abs(scale - 1) > 1e-9) {
    for (const i of free) agg[i] *= scale;
    notes.push(`rescaled by ${scale.toFixed(4)} so that Σλ_i = λ*`);
  }
  return finishRows('agree', subs, agg, lambdaSystem, weights, notes);
}

/** Feasibility-of-improvement (Karmiol-type): λ_i* ∝ feasibilityWeight_i. */
export function feasibilityOfImprovement(subs: Subsystem[], lambdaSystem: number): AllocationResult {
  const { free, fixedTotal } = splitFixed(subs, lambdaSystem);
  const total = free.reduce((a, i) => a + (subs[i].feasibilityWeight ?? 1), 0);
  const agg = subs.map((s) => (s.fixed && s.currentLambda !== undefined ? s.currentLambda * s.count : 0));
  const weights = subs.map((s, i) => (free.includes(i) ? (s.feasibilityWeight ?? 1) / total : 0));
  for (const i of free) agg[i] = weights[i] * (lambdaSystem - fixedTotal);
  return finishRows('feasibility-of-improvement', subs, agg, lambdaSystem, weights);
}

/**
 * Minimum effort (Albert): improve only the worst subsystems, bringing them to a common
 * aggregate rate λ̄ while better ones are left as they are.
 */
export function minimumEffort(subs: Subsystem[], lambdaSystem: number): AllocationResult {
  const { free, fixedTotal } = splitFixed(subs, lambdaSystem);
  const cur = subs.map((s) => (s.currentLambda ?? NaN) * s.count);
  if (free.some((i) => !Number.isFinite(cur[i]))) throw new RangeError('minimumEffort needs currentLambda for every allocated subsystem');
  const budget = lambdaSystem - fixedTotal;
  const order = [...free].sort((a, b) => cur[b] - cur[a]); // worst first
  const agg = subs.map((s) => (s.fixed && s.currentLambda !== undefined ? s.currentLambda * s.count : 0));
  const totalCur = free.reduce((a, i) => a + cur[i], 0);
  const notes: string[] = [];
  if (totalCur <= budget) {
    for (const i of free) agg[i] = cur[i];
    notes.push('current design already meets the budget; nothing to improve');
    return finishRows('minimum-effort', subs, agg, lambdaSystem, undefined, notes);
  }
  let k = 1;
  let bar = 0;
  for (; k <= order.length; k++) {
    const rest = order.slice(k).reduce((a, i) => a + cur[i], 0);
    bar = (budget - rest) / k;
    const next = k < order.length ? cur[order[k]] : -Infinity;
    if (bar >= next) break;
  }
  if (k > order.length) k = order.length;
  for (let j = 0; j < order.length; j++) agg[order[j]] = j < k ? bar : cur[order[j]];
  notes.push(`${k} subsystem(s) improved to a common aggregate rate ${bar.toExponential(3)} /h`);
  return finishRows('minimum-effort', subs, agg, lambdaSystem, undefined, notes);
}

/**
 * Cost-optimal allocation: minimise Σ a_i (λ_i^cur/λ_i)^{b_i} subject to Σ λ_i = λ*,
 * λ_i^min ≤ λ_i ≤ λ_i^cur, by bisection on the Lagrange multiplier.
 */
export function costOptimal(subs: Subsystem[], lambdaSystem: number): AllocationResult {
  const { free, fixedTotal } = splitFixed(subs, lambdaSystem);
  const budget = lambdaSystem - fixedTotal;
  for (const i of free) {
    const s = subs[i];
    if (s.currentLambda === undefined || !s.cost) throw new RangeError('costOptimal needs currentLambda and cost for every allocated subsystem');
  }
  const cur = subs.map((s) => (s.currentLambda ?? 0) * s.count);
  const minAgg = subs.map((s) => (s.minLambda ?? 0) * s.count);
  const lambdaAt = (nu: number) =>
    free.map((i) => {
      const s = subs[i];
      const { a, b } = s.cost!;
      // d/dλ [a (cur/λ)^b] = −a b cur^b λ^{−b−1} = −ν → λ = (a b cur^b / ν)^{1/(b+1)}
      const unconstrained = Math.pow((a * b * Math.pow(cur[i], b)) / nu, 1 / (b + 1));
      return Math.min(cur[i], Math.max(minAgg[i], unconstrained));
    });
  const sumAt = (nu: number) => lambdaAt(nu).reduce((a, x) => a + x, 0);
  const minTotal = free.reduce((a, i) => a + minAgg[i], 0);
  const curTotal = free.reduce((a, i) => a + cur[i], 0);
  const notes: string[] = [];
  const agg = subs.map((s) => (s.fixed && s.currentLambda !== undefined ? s.currentLambda * s.count : 0));
  if (budget >= curTotal) {
    free.forEach((i) => (agg[i] = cur[i]));
    notes.push('current design already meets the budget');
    return finishRows('cost-optimal', subs, agg, lambdaSystem, undefined, notes);
  }
  if (budget < minTotal) throw new RangeError('Budget below the sum of best-known achievable rates');
  let lo = 1e-30;
  let hi = 1e30;
  for (let it = 0; it < 300; it++) {
    const mid = Math.sqrt(lo * hi);
    if (sumAt(mid) > budget) lo = mid; // larger ν → smaller λ
    else hi = mid;
  }
  const sol = lambdaAt(Math.sqrt(lo * hi));
  free.forEach((i, j) => (agg[i] = sol[j]));
  return finishRows('cost-optimal', subs, agg, lambdaSystem, undefined, notes);
}

/* ---------------------------------------------------------------------- */
/* Unavailability-budget allocation (availability targets)                 */
/* ---------------------------------------------------------------------- */

export interface UnavailabilityRow {
  id: string;
  name: string;
  unavailability: number;
  availability: number;
  /** λ (per hour, aggregate) implied by the subsystem's MTTR, if given */
  lambdaAggregate?: number;
  lambdaPerUnit?: number;
  /** MTTR (h) implied by the subsystem's current λ, if given */
  mttrImplied?: number;
}

/**
 * Split an availability target A* over series subsystems: Σ U_i ≈ 1 − A* with weights
 * (equal, by count, or explicit). Each row is then converted to λ (given MTTR) or MTTR (given λ).
 */
export function allocateUnavailability(subs: Subsystem[], availabilityTarget: number, weights?: number[]): { rows: UnavailabilityRow[]; unavailabilityBudget: number } {
  const U = 1 - availabilityTarget;
  const w = weights ?? subs.map((s) => s.count);
  const total = w.reduce((a, x) => a + x, 0);
  // exact series split: Π A_i = A* → ln A_i = (w_i/Σw) ln A*
  const rows: UnavailabilityRow[] = subs.map((s, i) => {
    const Ai = Math.exp((w[i] / total) * Math.log(availabilityTarget));
    const Ui = 1 - Ai;
    const row: UnavailabilityRow = { id: s.id, name: s.name ?? s.id, unavailability: Ui, availability: Ai };
    if (s.mttr !== undefined && s.mttr > 0) {
      // U = λ·MTTR / (1 + λ·MTTR) → λ = U / (MTTR (1 − U))
      row.lambdaAggregate = Ui / (s.mttr * (1 - Ui));
      row.lambdaPerUnit = row.lambdaAggregate / s.count;
    }
    if (s.currentLambda !== undefined && s.currentLambda > 0) {
      const lam = s.currentLambda * s.count;
      row.mttrImplied = Ui / (lam * (1 - Ui));
    }
    return row;
  });
  return { rows, unavailabilityBudget: U };
}

/* ---------------------------------------------------------------------- */
/* Goodput-budget allocation (AI training jobs)                            */
/* ---------------------------------------------------------------------- */

export interface GoodputBudgetInput {
  goodputTarget: number;
  nGpus: number;
  /** exposed checkpoint save time (s) */
  deltaS: number;
  /** current recovery time per interruption (s), stages ①–⑤ */
  recoveryS: number;
  /** current per-GPU interruption rate (per GPU-hour) */
  lambdaPerGpuHour: number;
  /** how to split the loss budget when both λ and R are free: share of the budget given to the restart term */
  restartShare?: number;
}

export interface GoodputBudgetResult {
  lossBudget: number;
  /** current loss at the Young interval and its decomposition */
  current: { loss: number; checkpointTerm: number; restartTerm: number; mtbiS: number; tauS: number };
  /** keep R, tighten λ: required job MTBI and per-GPU rate */
  fixRecovery: { requiredMtbiS: number; requiredLambdaPerGpuHour: number; improvementFactor: number; feasible: boolean };
  /** keep λ, tighten R: required recovery time */
  fixRate: { requiredRecoveryS: number; improvementFactor: number; feasible: boolean };
  /** split the budget between the two terms with `restartShare` */
  balanced: { mtbiS: number; lambdaPerGpuHour: number; recoveryS: number; restartShare: number };
  notes: string[];
}

/**
 * With the Young interval τ = √(2δM), the first-order loss is
 *   L = √(2δ/M) + R/M   (checkpoint + recompute term, restart term).
 * Given a goodput target G*, L* = 1 − G*; solve for M (fix R) or R (fix M).
 */
export function goodputBudget(input: GoodputBudgetInput): GoodputBudgetResult {
  const { goodputTarget, nGpus, deltaS, recoveryS, lambdaPerGpuHour } = input;
  const notes: string[] = [];
  const Lstar = 1 - goodputTarget;
  const mtbiS = 3600 / (nGpus * lambdaPerGpuHour);
  const tauS = Math.sqrt(2 * deltaS * mtbiS);
  const ckTerm = Math.sqrt((2 * deltaS) / mtbiS);
  const rTerm = recoveryS / mtbiS;
  const current = { loss: ckTerm + rTerm, checkpointTerm: ckTerm, restartTerm: rTerm, mtbiS, tauS };

  // fix R, solve √(2δ) s + R s² = L*, s = M^{-1/2}
  const a = recoveryS;
  const b = Math.sqrt(2 * deltaS);
  let s: number;
  if (a > 0) s = (-b + Math.sqrt(b * b + 4 * a * Lstar)) / (2 * a);
  else s = Lstar / b;
  const Mreq = 1 / (s * s);
  const lamReq = 3600 / (nGpus * Mreq);
  const fixRecovery = {
    requiredMtbiS: Mreq,
    requiredLambdaPerGpuHour: lamReq,
    improvementFactor: lambdaPerGpuHour / lamReq,
    feasible: Mreq >= mtbiS ? true : lamReq > 0,
  };
  if (lamReq > lambdaPerGpuHour) notes.push('current interruption rate already meets the target with the current recovery time');

  // fix λ (M), solve R* = M (L* − √(2δ/M))
  const Rreq = mtbiS * (Lstar - ckTerm);
  const fixRate = {
    requiredRecoveryS: Rreq,
    improvementFactor: Rreq > 0 ? recoveryS / Rreq : Infinity,
    feasible: Rreq > 0,
  };
  if (Rreq <= 0) notes.push('the checkpoint + recompute term alone exceeds the loss budget at the current interruption rate; λ or δ must change');

  // balanced split
  const share = input.restartShare ?? 0.5;
  const Lr = Lstar * share;
  const Lc = Lstar * (1 - share);
  const Mbal = (2 * deltaS) / (Lc * Lc); // √(2δ/M) = Lc
  const Rbal = Lr * Mbal;
  const balanced = { mtbiS: Mbal, lambdaPerGpuHour: 3600 / (nGpus * Mbal), recoveryS: Rbal, restartShare: share };
  if ((tauS + deltaS) / mtbiS > 0.1 || rTerm > 0.1) notes.push('first-order regime check failed for the current design; budgets are indicative, use the full Daly model');
  return { lossBudget: Lstar, current, fixRecovery, fixRate, balanced, notes };
}

/**
 * Distribute an allowed per-interruption recovery time over MTTR stages in proportion to
 * current stage shares (or explicit weights), returning stage budgets in seconds.
 */
export function allocateRecoveryStages(stages: { name: string; currentS: number; weight?: number; floorS?: number }[], recoveryBudgetS: number): { name: string; budgetS: number; improvementFactor: number }[] {
  const floors = stages.map((s) => s.floorS ?? 0);
  const floorTotal = floors.reduce((a, x) => a + x, 0);
  const distributable = Math.max(0, recoveryBudgetS - floorTotal);
  const w = stages.map((s, i) => Math.max(0, (s.weight ?? s.currentS) - floors[i]));
  const total = w.reduce((a, x) => a + x, 0);
  return stages.map((s, i) => {
    const budget = floors[i] + (total > 0 ? (w[i] / total) * distributable : distributable / stages.length);
    return { name: s.name, budgetS: budget, improvementFactor: budget > 0 ? s.currentS / budget : Infinity };
  });
}
