/**
 * Hierarchical, capacity-aware reliability block diagrams (survey §4.1, Fig. 4-1, Table 4-1).
 * Blocks: leaf (n identical two-state or three-state units in series), series, parallel (1-of-n),
 * k-of-n of identical units (repairable, optional repair crews), standby with switch probability.
 * Each block yields steady-state availability, failure frequency, equivalent failure rate and MTTR,
 * MTTF from new, and expected delivered capacity (performability, first order).
 */
import { kOfNRepairable, standby as standbyChain, Ctmc, type CtmcState, type Transition } from '../ctmc/index.js';
import { kOfNGroup, subhealthUnit, manualOnly, isDual, meanRepairH, autoDowntimeShare, type DualRepair, type Switchover, type Subhealth } from '../ctmc/repair.js';
import { binomSf } from '../math/special.js';
import type { Koujing } from '../units/index.js';

export interface BlockBase {
  id: string;
  name?: string;
}

export interface LeafBlock extends BlockBase {
  kind: 'leaf';
  /** number of identical units in series inside this leaf (default 1) */
  count?: number;
  /** failure rate per unit-hour */
  lambda: number;
  /** mean time to repair / replace, hours */
  mttr: number;
  /** optional fail-slow degraded state (v1 alias of `subhealth` with policy tolerate, counted as up) */
  degraded?: { lambda: number; durationH: number; capacity: number };
  /** v2: two repair paths (automatic coverage / success / time, manual time); overrides `mttr` */
  repair?: DualRepair;
  /** v2: sub-health state with performance factor, escalation and tolerate / isolate policy */
  subhealth?: Subhealth;
  koujing?: Koujing;
}

export interface SeriesBlock extends BlockBase {
  kind: 'series';
  children: Block[];
}

export interface ParallelBlock extends BlockBase {
  kind: 'parallel';
  children: Block[];
  /** v2: imperfect switchover (first order for heterogeneous children) */
  switchover?: Switchover;
}

export interface KofNBlock extends BlockBase {
  kind: 'kofn';
  n: number;
  k: number;
  unit: Block;
  crews?: number;
  capacityMode?: 'binary' | 'proportional' | 'fractional';
  /** v2: imperfect switchover (exact chain for identical units) */
  switchover?: Switchover;
}

export interface StandbyBlock extends BlockBase {
  kind: 'standby';
  n: number;
  unit: Block;
  /** 0 = cold, 1 = hot */
  standbyFactor?: number;
  switchProbability?: number;
  crews?: number;
  /** v2: switchover details; `successProbability` overrides `switchProbability` */
  switchover?: Switchover;
}

export interface RepeatBlock extends BlockBase {
  kind: 'repeat';
  /** number of identical, independent copies of `unit` in series */
  count: number;
  unit: Block;
}

export type Block = LeafBlock | SeriesBlock | ParallelBlock | KofNBlock | StandbyBlock | RepeatBlock;

export interface BlockResult {
  id: string;
  name: string;
  kind: Block['kind'];
  availability: number;
  unavailability: number;
  /** steady-state frequency of block failures, per hour */
  failureFrequency: number;
  /** ν / A — the failure rate seen while the block is up, per hour */
  equivalentFailureRate: number;
  /** (1 − A) / ν, hours */
  equivalentMttr: number;
  /** A / ν — mean up time between failures, hours */
  mtbf: number;
  /** mean time from all-new to first block failure, hours */
  mttfFromNew: number;
  /** expected delivered capacity (0..1), ≤ availability */
  capacity: number;
  /** capacity given the block is up (first-order) */
  capacityGivenUp: number;
  children: BlockResult[];
  notes: string[];
  /** v2: availability counting sub-health as down (present when sub-health is modelled below this block) */
  strict?: number;
  /** v2: availability counting sub-health as up */
  tolerant?: number;
  /** v2: share of this block's downtime on the automatic repair path (dual repair) */
  autoDowntimeShare?: number;
  /** v2: switchover accounting (first order): micro-outage unavailability, switchovers per hour, switch-failed probability */
  switchover?: { outage: number; frequency: number; failedProbability: number };
  /** v2: sub-health exposure: P(sub-healthy | not down) per unit and detected isolations per hour (all units) */
  subhealth?: { pGivenNotDown: number; isolationFrequency: number; performance: number };
  /** some part of this block used a first-order or reduced model */
  approximate?: boolean;
}

export interface EvaluateOptions {
  /** force a block's availability (used for importance measures) */
  overrides?: Map<string, number>;
}

const EPS = 1e-300;

function finish(partial: Omit<BlockResult, 'unavailability' | 'equivalentFailureRate' | 'equivalentMttr' | 'mtbf'>): BlockResult {
  const A = partial.availability;
  const nu = partial.failureFrequency;
  return {
    ...partial,
    unavailability: 1 - A,
    equivalentFailureRate: A > 0 ? nu / A : 0,
    equivalentMttr: nu > 0 ? (1 - A) / nu : 1 - A > 0 ? Infinity : 0,
    mtbf: nu > 0 ? A / nu : Infinity,
  };
}

/** Evaluate a block tree. */
export function evaluate(block: Block, options: EvaluateOptions = {}): BlockResult {
  const name = block.name ?? block.id;
  const forced = options.overrides?.get(block.id);
  if (forced !== undefined) {
    return finish({
      id: block.id,
      name,
      kind: block.kind,
      availability: forced,
      failureFrequency: 0,
      mttfFromNew: forced >= 1 ? Infinity : 0,
      capacity: forced,
      capacityGivenUp: 1,
      children: [],
      notes: ['availability forced by override'],
    });
  }
  switch (block.kind) {
    case 'leaf':
      return evalLeaf(block, name);
    case 'series':
      return evalSeries(block, name, options);
    case 'parallel':
      return evalParallel(block, name, options);
    case 'kofn':
      return evalKofN(block, name, options);
    case 'standby':
      return evalStandby(block, name, options);
    case 'repeat':
      return evalRepeat(block, name, options);
  }
}

const hasMeasure = (rs: BlockResult[]) => rs.some((r) => r.strict !== undefined || r.tolerant !== undefined);
const strictOf = (r: BlockResult) => r.strict ?? r.availability;
const tolerantOf = (r: BlockResult) => r.tolerant ?? r.availability;

/** steady-state availability of a k-of-n group of independent units with unit unavailability u (binomial, for the auxiliary measures) */
function kofnBinomial(n: number, k: number, u: number): number {
  return 1 - binomSf(n, n - k + 1, u);
}

function evalRepeat(b: RepeatBlock, name: string, options: EvaluateOptions): BlockResult {
  const unit = evaluate(b.unit, options);
  const c = Math.max(1, Math.round(b.count));
  const A = Math.pow(unit.availability, c);
  const lambdaEq = c * unit.equivalentFailureRate;
  const capGivenUp = Math.max(0, 1 - c * (1 - unit.capacityGivenUp));
  const measures = hasMeasure([unit]) ? { strict: Math.pow(strictOf(unit), c), tolerant: Math.pow(tolerantOf(unit), c) } : {};
  return finish({
    id: b.id,
    name,
    kind: 'repeat',
    availability: A,
    failureFrequency: A * lambdaEq,
    mttfFromNew: unit.mttfFromNew > 0 ? unit.mttfFromNew / c : 0,
    capacity: A * capGivenUp,
    capacityGivenUp: capGivenUp,
    children: [unit],
    notes: [`${c} identical independent copies in series`],
    ...measures,
    autoDowntimeShare: unit.autoDowntimeShare,
    subhealth: unit.subhealth ? { ...unit.subhealth, isolationFrequency: unit.subhealth.isolationFrequency * c } : undefined,
    approximate: unit.approximate,
  });
}

/** v1 `degraded` alias expressed as a sub-health spec: tolerate, no escalation, counted as up. */
function subhealthOf(b: LeafBlock): Subhealth | undefined {
  if (b.subhealth && b.subhealth.ratePerHour > 0) return b.subhealth;
  if (b.degraded && b.degraded.lambda > 0) return { ratePerHour: b.degraded.lambda, durationH: b.degraded.durationH, performance: b.degraded.capacity, escalationMultiplier: 1, policy: 'tolerate', threshold: 0 };
  return undefined;
}

function evalLeaf(b: LeafBlock, name: string): BlockResult {
  const c = Math.max(1, Math.round(b.count ?? 1));
  const notes: string[] = [];
  const repair: DualRepair = b.repair ?? manualOnly(b.mttr);
  const sh = subhealthOf(b);
  let A1: number;
  let cap1: number;
  let nu1: number;
  let strict1: number | undefined;
  let tolerant1: number | undefined;
  let autoShare: number | undefined;
  let subhealth: BlockResult['subhealth'];
  let lambdaOutage = b.lambda;
  if (sh) {
    const r = subhealthUnit(b.lambda, repair, sh);
    A1 = r.availability;
    cap1 = r.performability;
    nu1 = r.failureFrequency;
    strict1 = r.strict;
    tolerant1 = r.tolerant;
    subhealth = { pGivenNotDown: r.pSubhealthGivenNotDown, isolationFrequency: r.isolationFrequency * c, performance: sh.performance };
    if (r.countsAsDown) lambdaOutage = b.lambda + sh.ratePerHour;
    notes.push(b.subhealth ? (r.countsAsDown ? 'sub-health counted as down (performance below threshold)' : 'sub-health counted as up (performance at or above threshold)') : 'three-state unit (up / degraded / down)');
    notes.push(...r.warnings);
    if (isDual(repair)) {
      const down = r.piDownAuto + r.piDownManual;
      autoShare = down > 0 ? r.piDownAuto / down : autoDowntimeShare(repair);
    }
  } else if (isDual(repair)) {
    const ER = meanRepairH(repair);
    A1 = 1 / (1 + b.lambda * ER);
    cap1 = A1;
    nu1 = b.lambda * A1;
    autoShare = autoDowntimeShare(repair);
    notes.push(`dual-path repair: E[R] = ${ER.toPrecision(4)} h (automatic ${repair.autoMttrH} h × coverage ${repair.coverage}, success ${repair.successProbability}; manual ${repair.manualMttrH} h)`);
  } else {
    const x = b.lambda * (b.mttr > 0 ? b.mttr : 0);
    A1 = 1 / (1 + x);
    cap1 = A1;
    nu1 = b.lambda * A1;
  }
  const A = Math.pow(A1, c);
  const nu = c * nu1 * Math.pow(A1, c - 1);
  const capGivenUp1 = A1 > 0 ? cap1 / A1 : 0;
  const capGivenUp = Math.max(0, 1 - c * (1 - capGivenUp1));
  return finish({
    id: b.id,
    name,
    kind: 'leaf',
    availability: A,
    failureFrequency: nu,
    mttfFromNew: lambdaOutage > 0 ? 1 / (c * lambdaOutage) : Infinity,
    capacity: A * capGivenUp,
    capacityGivenUp: capGivenUp,
    children: [],
    notes,
    strict: strict1 !== undefined ? Math.pow(strict1, c) : undefined,
    tolerant: tolerant1 !== undefined ? Math.pow(tolerant1, c) : undefined,
    autoDowntimeShare: autoShare,
    subhealth,
  });
}

function evalSeries(b: SeriesBlock, name: string, options: EvaluateOptions): BlockResult {
  const children = b.children.map((ch) => evaluate(ch, options));
  let A = 1;
  let lambdaEq = 0;
  let invMttf = 0;
  let degradation = 0;
  let strict = 1;
  let tolerant = 1;
  let autoDown = 0;
  let allDown = 0;
  let iso = 0;
  for (const ch of children) {
    A *= ch.availability;
    lambdaEq += ch.equivalentFailureRate;
    invMttf += ch.mttfFromNew > 0 ? 1 / ch.mttfFromNew : Infinity;
    degradation += 1 - ch.capacityGivenUp;
    strict *= strictOf(ch);
    tolerant *= tolerantOf(ch);
    if (ch.autoDowntimeShare !== undefined) autoDown += ch.autoDowntimeShare * ch.unavailability;
    allDown += ch.unavailability;
    iso += ch.subhealth?.isolationFrequency ?? 0;
  }
  const capGivenUp = Math.max(0, 1 - degradation);
  const anySub = children.some((ch) => ch.subhealth);
  const perf = anySub ? Math.min(...children.filter((ch) => ch.subhealth).map((ch) => ch.subhealth!.performance)) : 1;
  return finish({
    id: b.id,
    name,
    kind: 'series',
    availability: A,
    failureFrequency: A * lambdaEq,
    mttfFromNew: invMttf > 0 ? 1 / invMttf : Infinity,
    capacity: A * capGivenUp,
    capacityGivenUp: capGivenUp,
    children,
    notes: [],
    ...(hasMeasure(children) ? { strict, tolerant } : {}),
    autoDowntimeShare: children.some((ch) => ch.autoDowntimeShare !== undefined) && allDown > 0 ? autoDown / allDown : undefined,
    subhealth: anySub ? { pGivenNotDown: 1 - children.reduce((p, ch) => p * (1 - (ch.subhealth?.pGivenNotDown ?? 0)), 1), isolationFrequency: iso, performance: perf } : undefined,
    approximate: children.some((ch) => ch.approximate) || undefined,
  });
}

function evalParallel(b: ParallelBlock, name: string, options: EvaluateOptions): BlockResult {
  const children = b.children.map((ch) => evaluate(ch, options));
  const notes: string[] = [];
  let U = 1;
  for (const ch of children) U *= ch.unavailability;
  // ν = Σ_i ν_i Π_{j≠i} U_j  (the last working child fails)
  let nu = 0;
  for (let i = 0; i < children.length; i++) {
    let prod = children[i].failureFrequency;
    for (let j = 0; j < children.length; j++) if (j !== i) prod *= children[j].unavailability;
    nu += prod;
  }
  const Uperfect = U;
  // MTTF from new via product-space CTMC on children's equivalent exponential parameters
  let mttfFromNew: number;
  if (children.length <= 10) {
    mttfFromNew = productSpaceMttf(children, (downMask) => downMask === (1 << children.length) - 1);
  } else {
    mttfFromNew = nu > 0 ? (1 - U) / nu : Infinity;
    notes.push('MTTF from new approximated by steady-state A/ν (more than 10 children)');
  }
  let switchover: BlockResult['switchover'];
  let approximate: boolean | undefined;
  if (b.switchover && children.length >= 2) {
    const p = b.switchover.successProbability;
    const tsw = (b.switchover.outageS ?? 0) / 3600;
    const Tsf = b.switchover.failureRecoveryHours ?? Math.max(...children.map((ch) => (Number.isFinite(ch.equivalentMttr) ? ch.equivalentMttr : 0)));
    const nuSum = children.reduce((a, ch) => a + ch.failureFrequency, 0);
    const failed = nuSum * (1 - p) * Tsf;
    const micro = nuSum * p * tsw;
    U += failed + micro;
    nu += nuSum * (1 - p) + (tsw > 0 ? nuSum * p : 0);
    const lamFail = children.reduce((a, ch) => a + ch.equivalentFailureRate, 0) * (1 - p);
    if (lamFail > 0 && Number.isFinite(mttfFromNew)) mttfFromNew = 1 / (1 / mttfFromNew + lamFail);
    switchover = { outage: micro, frequency: nuSum * p, failedProbability: failed };
    notes.push(`switchover first order: success ${p}, failed-switch recovery ${Tsf.toPrecision(3)} h, micro-outage ${b.switchover.outageS ?? 0} s`);
    if (failed + micro > 0.1 * (1 - Uperfect) || Uperfect > 0.01) {
      approximate = true;
      notes.push('first-order switchover correction is not small: treat the group as k-of-n of identical units for an exact chain');
    }
  }
  const A = Math.max(0, 1 - U);
  const measures = hasMeasure(children)
    ? { strict: 1 - children.reduce((p, ch) => p * (1 - strictOf(ch)), 1) - (U - Uperfect), tolerant: 1 - children.reduce((p, ch) => p * (1 - tolerantOf(ch)), 1) - (U - Uperfect) }
    : {};
  return finish({
    id: b.id,
    name,
    kind: 'parallel',
    availability: A,
    failureFrequency: nu,
    mttfFromNew,
    capacity: A,
    capacityGivenUp: 1,
    children,
    notes,
    ...measures,
    switchover,
    approximate: approximate || children.some((ch) => ch.approximate) || undefined,
  });
}

/**
 * Mean time from all-up to the first state satisfying `isDown(mask)` where mask bit i = child i down.
 * Children are treated as independent exponential units with their equivalent λ and μ.
 */
function productSpaceMttf(children: BlockResult[], isDown: (mask: number) => boolean): number {
  const m = children.length;
  const nStates = 1 << m;
  const states: CtmcState[] = [];
  const tr: Transition[] = [];
  for (let mask = 0; mask < nStates; mask++) {
    states.push({ id: `m${mask}`, up: !isDown(mask), capacity: isDown(mask) ? 0 : 1 });
    for (let i = 0; i < m; i++) {
      const bit = 1 << i;
      if (mask & bit) {
        const mu = children[i].equivalentMttr > 0 && Number.isFinite(children[i].equivalentMttr) ? 1 / children[i].equivalentMttr : 0;
        if (mu > 0) tr.push({ from: mask, to: mask & ~bit, rate: mu });
      } else {
        const lam = children[i].equivalentFailureRate;
        if (lam > 0) tr.push({ from: mask, to: mask | bit, rate: lam });
      }
    }
  }
  const chain = new Ctmc(states, tr);
  const absorbing = new Set<number>();
  for (let mask = 0; mask < nStates; mask++) if (isDown(mask)) absorbing.add(mask);
  if (absorbing.size === 0) return Infinity;
  try {
    return chain.meanTimeToAbsorption(absorbing, 0);
  } catch {
    return Infinity;
  }
}

function evalKofN(b: KofNBlock, name: string, options: EvaluateOptions): BlockResult {
  const unit = evaluate(b.unit, options);
  const lambdaU = unit.equivalentFailureRate;
  const mttrU = unit.equivalentMttr > 0 && Number.isFinite(unit.equivalentMttr) ? unit.equivalentMttr : 0;
  const muU = mttrU > 0 ? 1 / mttrU : unit.equivalentMttr === 0 ? 1e300 : 0;
  const notes: string[] = [];
  if (b.unit.kind !== 'leaf') notes.push('unit replaced by its equivalent exponential (λ_eq, MTTR_eq)');
  if (b.crews !== undefined && Number.isFinite(b.crews)) notes.push(`${b.crews} repair crew(s)`);
  const capGivenUp = unit.capacityGivenUp; // first order: degradation of units propagates
  const leafRepair = b.unit.kind === 'leaf' && Math.round(b.unit.count ?? 1) === 1 ? b.unit.repair : undefined;
  const useV2 = !!b.switchover || isDual(leafRepair);
  const uStrict = 1 - strictOf(unit);
  const uTol = 1 - tolerantOf(unit);
  const measures = hasMeasure([unit]) ? { strict: kofnBinomial(b.n, b.k, uStrict), tolerant: kofnBinomial(b.n, b.k, uTol) } : {};
  if (!useV2) {
    const r = kOfNRepairable(b.n, b.k, lambdaU, muU, b.crews ?? Infinity, b.capacityMode ?? 'binary');
    return finish({
      id: b.id,
      name,
      kind: 'kofn',
      availability: r.availability,
      failureFrequency: r.failureFrequency,
      mttfFromNew: r.mttfFromNew,
      capacity: r.capacity * capGivenUp,
      capacityGivenUp: (r.availability > 0 ? r.capacity / r.availability : 1) * capGivenUp,
      children: [unit],
      notes,
      ...measures,
      subhealth: unit.subhealth ? { ...unit.subhealth, isolationFrequency: unit.subhealth.isolationFrequency * b.n } : undefined,
      approximate: unit.approximate,
    });
  }
  // v2: dual repair paths and / or switchover — exact chain over (auto, manual, switch-failed)
  const repair: DualRepair = leafRepair ? { ...leafRepair } : manualOnly(mttrU);
  if (leafRepair && b.unit.kind === 'leaf' && subhealthOf(b.unit)) notes.push('unit sub-health enters the group through λ_eq; repair paths as configured');
  const r = kOfNGroup({ n: b.n, k: b.k, lambda: lambdaU, repair, crews: b.crews, capacityMode: b.capacityMode ?? 'binary', switchover: b.switchover });
  notes.push(...r.notes);
  if (b.switchover) notes.push(`switchover: success ${b.switchover.successProbability}, micro-outage ${b.switchover.outageS ?? 0} s, failed-switch recovery ${(b.switchover.failureRecoveryHours ?? repair.manualMttrH).toPrecision(3)} h`);
  if (isDual(repair)) notes.push(`dual-path repair inside the group: coverage ${repair.coverage}, success ${repair.successProbability}, automatic ${repair.autoMttrH} h, manual ${repair.manualMttrH} h`);
  const A = r.availabilityEffective;
  const Usw = r.switchoverOutage + r.switchFailedProbability;
  return finish({
    id: b.id,
    name,
    kind: 'kofn',
    availability: A,
    failureFrequency: r.failureFrequencyEffective,
    mttfFromNew: r.mttfFromNew,
    capacity: Math.max(0, r.capacity) * capGivenUp,
    capacityGivenUp: (A > 0 ? Math.max(0, r.capacity) / A : 1) * capGivenUp,
    children: [unit],
    notes,
    strict: measures.strict !== undefined ? Math.max(0, measures.strict - Usw) : undefined,
    tolerant: measures.tolerant !== undefined ? Math.max(0, measures.tolerant - Usw) : undefined,
    autoDowntimeShare: isDual(repair) ? r.autoRepairShare : undefined,
    switchover: b.switchover ? { outage: r.switchoverOutage, frequency: r.switchoverFrequency, failedProbability: r.switchFailedProbability } : undefined,
    subhealth: unit.subhealth ? { ...unit.subhealth, isolationFrequency: unit.subhealth.isolationFrequency * b.n } : undefined,
    approximate: r.approximate || unit.approximate || undefined,
  });
}

function evalStandby(b: StandbyBlock, name: string, options: EvaluateOptions): BlockResult {
  const unit = evaluate(b.unit, options);
  const lambdaU = unit.equivalentFailureRate;
  const muU = unit.equivalentMttr > 0 && Number.isFinite(unit.equivalentMttr) ? 1 / unit.equivalentMttr : 0;
  const p = b.switchover?.successProbability ?? b.switchProbability ?? 1;
  const tsw = (b.switchover?.outageS ?? 0) / 3600;
  const swRate = b.switchover?.failureRecoveryHours ? 1 / b.switchover.failureRecoveryHours : undefined;
  const r = standbyChain(b.n, lambdaU, muU, b.standbyFactor ?? 0, p, b.crews ?? Infinity, swRate);
  const micro = r.switchFrequency * tsw;
  const A = Math.max(0, r.availability - micro);
  const notes = [`standby factor ${b.standbyFactor ?? 0}, switch success ${p}`];
  if (b.switchover) notes.push(`switchover: micro-outage ${b.switchover.outageS ?? 0} s, failed-switch recovery ${b.switchover.failureRecoveryHours ?? 'unit MTTR'} h`);
  const uStrict = 1 - strictOf(unit);
  const uTol = 1 - tolerantOf(unit);
  const measures = hasMeasure([unit]) ? { strict: Math.max(0, kofnBinomial(b.n, 1, uStrict) - micro - r.switchFailedProbability), tolerant: Math.max(0, kofnBinomial(b.n, 1, uTol) - micro - r.switchFailedProbability) } : {};
  return finish({
    id: b.id,
    name,
    kind: 'standby',
    availability: A,
    failureFrequency: r.failureFrequency + (tsw > 0 ? r.switchFrequency : 0),
    mttfFromNew: r.mttfFromNew,
    capacity: A,
    capacityGivenUp: 1,
    children: [unit],
    notes,
    ...measures,
    switchover: b.switchover || p < 1 ? { outage: micro, frequency: r.switchFrequency, failedProbability: r.switchFailedProbability } : undefined,
    subhealth: unit.subhealth ? { ...unit.subhealth, isolationFrequency: unit.subhealth.isolationFrequency * b.n } : undefined,
    approximate: unit.approximate,
  });
}

/* ---------------------------------------------------------------------- */
/* Original vs compensated measures (v2 §17)                                */
/* ---------------------------------------------------------------------- */

/** 0 = original (inherent), 1 = + redundancy, 2 = + automatic recovery, 3 = + sub-health policy (compensated) */
export type CompensationLevel = 0 | 1 | 2 | 3;

export interface TransformOptions {
  level: CompensationLevel;
  /** force perfect switchover (success 1, no outage) — used for the switchover penalty */
  perfectSwitchover?: boolean;
}

const STRICT_THRESHOLD = 1.01;

function transformLeaf(b: LeafBlock, o: TransformOptions): LeafBlock {
  const repair = b.repair ?? manualOnly(b.mttr);
  const sh = subhealthOf(b);
  const base: LeafBlock = { kind: 'leaf', id: b.id, name: b.name, count: b.count, lambda: b.lambda, mttr: repair.manualMttrH, koujing: b.koujing };
  if (o.level === 0) {
    if (!sh) return base;
    const lamO = b.lambda + sh.ratePerHour;
    const ER = lamO > 0 ? (b.lambda * repair.manualMttrH + sh.ratePerHour * sh.durationH) / lamO : repair.manualMttrH;
    return { ...base, lambda: lamO, mttr: ER };
  }
  const out: LeafBlock = { ...base };
  if (o.level >= 2 && isDual(repair)) out.repair = repair;
  if (sh) {
    if (o.level === 3) out.subhealth = sh;
    else out.subhealth = { ...sh, policy: 'tolerate', detection: undefined, threshold: STRICT_THRESHOLD };
  }
  return out;
}

/** Rebuild the block tree at a compensation level (§17). Ids are preserved so results can be matched block by block. */
export function transformCompensation(block: Block, o: TransformOptions): Block {
  switch (block.kind) {
    case 'leaf':
      return transformLeaf(block, o);
    case 'series':
      return { kind: 'series', id: block.id, name: block.name, children: block.children.map((c) => transformCompensation(c, o)) };
    case 'repeat':
      return { kind: 'repeat', id: block.id, name: block.name, count: block.count, unit: transformCompensation(block.unit, o) };
    case 'parallel':
      if (o.level === 0) return { kind: 'series', id: block.id, name: block.name, children: block.children.map((c) => transformCompensation(c, o)) };
      return { kind: 'parallel', id: block.id, name: block.name, children: block.children.map((c) => transformCompensation(c, o)), switchover: o.perfectSwitchover ? undefined : block.switchover };
    case 'kofn':
      if (o.level === 0) return { kind: 'repeat', id: block.id, name: block.name, count: block.n, unit: transformCompensation(block.unit, o) };
      return { kind: 'kofn', id: block.id, name: block.name, n: block.n, k: block.k, unit: transformCompensation(block.unit, o), crews: block.crews, capacityMode: block.capacityMode, switchover: o.perfectSwitchover ? undefined : block.switchover };
    case 'standby':
      if (o.level === 0) return { ...transformCompensation(block.unit, o), id: block.id, name: block.name ?? block.unit.name } as Block;
      return {
        kind: 'standby',
        id: block.id,
        name: block.name,
        n: block.n,
        unit: transformCompensation(block.unit, o),
        standbyFactor: block.standbyFactor,
        switchProbability: o.perfectSwitchover ? 1 : block.switchProbability,
        crews: block.crews,
        switchover: o.perfectSwitchover ? undefined : block.switchover,
      };
  }
}

export type WaterfallStepId = 'original' | 'redundancy' | 'auto-recovery' | 'subhealth-policy';

export interface WaterfallStep {
  level: CompensationLevel;
  id: WaterfallStepId;
  availability: number;
  unavailability: number;
  failureFrequency: number;
  mtbf: number;
  equivalentMttr: number;
  capacity: number;
  /** availability change versus the previous step */
  delta: number;
}

export interface CompensationResult {
  steps: WaterfallStep[];
  original: BlockResult;
  compensated: BlockResult;
  /** A(perfect switchover) − A(configured) at the compensated level */
  switchoverPenalty: number;
  gain: { deltaAvailability: number; mtbfRatio: number; mttrRatio: number; unavailabilityRatio: number };
}

const STEP_IDS: WaterfallStepId[] = ['original', 'redundancy', 'auto-recovery', 'subhealth-policy'];

/** Original → compensated waterfall for a block tree (§17). */
export function compensationWaterfall(root: Block, options: EvaluateOptions = {}): CompensationResult {
  const results: BlockResult[] = [];
  for (let level = 0; level <= 3; level++) results.push(evaluate(transformCompensation(root, { level: level as CompensationLevel }), options));
  const steps: WaterfallStep[] = results.map((r, i) => ({
    level: i as CompensationLevel,
    id: STEP_IDS[i],
    availability: r.availability,
    unavailability: r.unavailability,
    failureFrequency: r.failureFrequency,
    mtbf: r.mtbf,
    equivalentMttr: r.equivalentMttr,
    capacity: r.capacity,
    delta: i === 0 ? 0 : r.availability - results[i - 1].availability,
  }));
  const perfect = evaluate(transformCompensation(root, { level: 3, perfectSwitchover: true }), options);
  const original = results[0];
  const compensated = results[3];
  return {
    steps,
    original,
    compensated,
    switchoverPenalty: perfect.availability - compensated.availability,
    gain: {
      deltaAvailability: compensated.availability - original.availability,
      mtbfRatio: original.mtbf > 0 && Number.isFinite(original.mtbf) ? compensated.mtbf / original.mtbf : Infinity,
      mttrRatio: original.equivalentMttr > 0 ? compensated.equivalentMttr / original.equivalentMttr : 1,
      unavailabilityRatio: compensated.unavailability > 0 ? original.unavailability / compensated.unavailability : Infinity,
    },
  };
}

/** Index a result tree by block id. */
export function indexResults(r: BlockResult, out = new Map<string, BlockResult>()): Map<string, BlockResult> {
  out.set(r.id, r);
  r.children.forEach((c) => indexResults(c, out));
  return out;
}

/* ---------------------------------------------------------------------- */
/* Importance measures                                                     */
/* ---------------------------------------------------------------------- */

export interface ImportanceRow {
  id: string;
  name: string;
  availability: number;
  /** Birnbaum: ∂A_sys/∂A_i = A_sys(A_i = 1) − A_sys(A_i = 0) */
  birnbaum: number;
  /** Fussell-Vesely: (U_sys − U_sys(A_i = 1)) / U_sys */
  fusselVesely: number;
  /** Risk achievement worth: U_sys(A_i = 0) / U_sys */
  raw: number;
  /** Risk reduction worth: U_sys / U_sys(A_i = 1) */
  rrw: number;
  /** share of the system failure frequency contributed by this block (series-level) */
  frequencyShare: number;
}

export function listBlocks(block: Block, out: Block[] = []): Block[] {
  out.push(block);
  switch (block.kind) {
    case 'series':
    case 'parallel':
      block.children.forEach((c) => listBlocks(c, out));
      break;
    case 'kofn':
    case 'standby':
    case 'repeat':
      listBlocks(block.unit, out);
      break;
    default:
      break;
  }
  return out;
}

/** Importance measures for every block except the root. */
export function importance(root: Block): ImportanceRow[] {
  const base = evaluate(root);
  const Usys = base.unavailability;
  const rows: ImportanceRow[] = [];
  const blocks = listBlocks(root).filter((b) => b.id !== root.id);
  const byId = new Map<string, BlockResult>();
  const collect = (r: BlockResult) => {
    byId.set(r.id, r);
    r.children.forEach(collect);
  };
  collect(base);
  for (const b of blocks) {
    const up = evaluate(root, { overrides: new Map([[b.id, 1]]) });
    const down = evaluate(root, { overrides: new Map([[b.id, 0]]) });
    const Uup = up.unavailability;
    const Udown = down.unavailability;
    const r = byId.get(b.id);
    rows.push({
      id: b.id,
      name: b.name ?? b.id,
      availability: r?.availability ?? NaN,
      birnbaum: up.availability - down.availability,
      fusselVesely: Usys > 0 ? (Usys - Uup) / Usys : 0,
      raw: Usys > 0 ? Udown / Usys : Infinity,
      rrw: Uup > 0 ? Usys / Uup : Infinity,
      frequencyShare: base.failureFrequency > 0 && r ? Math.min(1, r.failureFrequency / base.failureFrequency) : 0,
    });
  }
  return rows.sort((a, b) => b.birnbaum - a.birnbaum);
}

/* ---------------------------------------------------------------------- */
/* Minimal cut sets (fault-tree view)                                       */
/* ---------------------------------------------------------------------- */

/** A cut set: leaf id → number of that leaf's units that must be down. */
export type CutSet = Map<string, number>;

export interface CutSetResult {
  cutSets: CutSet[];
  truncated: boolean;
  /** rare-event approximation of the top-event probability from the listed cut sets */
  topEventApprox: number;
}

function minimalize(sets: CutSet[]): CutSet[] {
  const isSuperset = (a: CutSet, b: CutSet) => {
    for (const [id, cnt] of b) {
      const ac = a.get(id);
      if (ac === undefined || ac < cnt) return false;
    }
    return true;
  };
  const out: CutSet[] = [];
  const sorted = [...sets].sort((x, y) => sizeOf(x) - sizeOf(y));
  for (const s of sorted) {
    if (out.some((o) => isSuperset(s, o))) continue;
    out.push(s);
  }
  return out;
}

function sizeOf(s: CutSet): number {
  let n = 0;
  for (const v of s.values()) n += v;
  return n;
}

function merge(a: CutSet, b: CutSet): CutSet {
  const m = new Map(a);
  for (const [id, cnt] of b) m.set(id, (m.get(id) ?? 0) + cnt);
  return m;
}

function cutSetsOf(block: Block, limit: number, state: { truncated: boolean }): CutSet[] {
  switch (block.kind) {
    case 'leaf':
      return [new Map([[block.id, 1]])];
    case 'series': {
      let acc: CutSet[] = [];
      for (const ch of block.children) {
        acc = acc.concat(cutSetsOf(ch, limit, state));
        if (acc.length > limit) {
          state.truncated = true;
          acc = acc.slice(0, limit);
        }
      }
      return minimalize(acc);
    }
    case 'parallel': {
      let acc: CutSet[] = [new Map()];
      for (const ch of block.children) {
        const cs = cutSetsOf(ch, limit, state);
        const next: CutSet[] = [];
        for (const a of acc) {
          for (const c of cs) {
            next.push(merge(a, c));
            if (next.length > limit) {
              state.truncated = true;
              break;
            }
          }
          if (next.length > limit) break;
        }
        acc = next;
      }
      return minimalize(acc);
    }
    case 'kofn': {
      const need = block.n - block.k + 1;
      return cutSetsOf(block.unit, limit, state).map((cs) => {
        const m: CutSet = new Map();
        for (const [id, cnt] of cs) m.set(id, cnt * need);
        return m;
      });
    }
    case 'standby': {
      return cutSetsOf(block.unit, limit, state).map((cs) => {
        const m: CutSet = new Map();
        for (const [id, cnt] of cs) m.set(id, cnt * block.n);
        return m;
      });
    }
    case 'repeat':
      // any one copy failing fails the block: same cut sets as the unit
      return cutSetsOf(block.unit, limit, state);
  }
}

/** Minimal cut sets of the structure and the rare-event top-event approximation. */
export function cutSets(root: Block, limit = 5000): CutSetResult {
  const state = { truncated: false };
  const sets = cutSetsOf(root, limit, state);
  // unit unavailability per leaf
  const leafU = new Map<string, { u: number; count: number }>();
  for (const b of listBlocks(root)) {
    if (b.kind === 'leaf') {
      const r = evalLeaf(b, b.name ?? b.id);
      const count = Math.max(1, Math.round(b.count ?? 1));
      const u1 = 1 - Math.pow(r.availability, 1 / count);
      leafU.set(b.id, { u: u1, count });
    }
  }
  let top = 0;
  for (const cs of sets) {
    let p = 1;
    for (const [id, cnt] of cs) {
      const info = leafU.get(id);
      if (!info) continue;
      // probability that at least cnt of the leaf's `count` units are down; cnt may exceed count via multiplicity
      const need = Math.min(cnt, info.count);
      p *= binomSf(info.count, need, info.u) * (cnt > info.count ? Math.pow(info.u, cnt - info.count) : 1);
    }
    top += p;
  }
  return { cutSets: sets, truncated: state.truncated, topEventApprox: Math.min(1, top) };
}
