/**
 * Hierarchical, capacity-aware reliability block diagrams (survey §4.1, Fig. 4-1, Table 4-1).
 * Blocks: leaf (n identical two-state or three-state units in series), series, parallel (1-of-n),
 * k-of-n of identical units (repairable, optional repair crews), standby with switch probability.
 * Each block yields steady-state availability, failure frequency, equivalent failure rate and MTTR,
 * MTTF from new, and expected delivered capacity (performability, first order).
 */
import { kOfNRepairable, standby as standbyChain, degradedUnit, Ctmc, type CtmcState, type Transition } from '../ctmc/index.js';
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
  /** optional fail-slow degraded state: entry rate per hour, mean duration (h), delivered capacity */
  degraded?: { lambda: number; durationH: number; capacity: number };
  koujing?: Koujing;
}

export interface SeriesBlock extends BlockBase {
  kind: 'series';
  children: Block[];
}

export interface ParallelBlock extends BlockBase {
  kind: 'parallel';
  children: Block[];
}

export interface KofNBlock extends BlockBase {
  kind: 'kofn';
  n: number;
  k: number;
  unit: Block;
  crews?: number;
  capacityMode?: 'binary' | 'proportional' | 'fractional';
}

export interface StandbyBlock extends BlockBase {
  kind: 'standby';
  n: number;
  unit: Block;
  /** 0 = cold, 1 = hot */
  standbyFactor?: number;
  switchProbability?: number;
  crews?: number;
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

function evalRepeat(b: RepeatBlock, name: string, options: EvaluateOptions): BlockResult {
  const unit = evaluate(b.unit, options);
  const c = Math.max(1, Math.round(b.count));
  const A = Math.pow(unit.availability, c);
  const lambdaEq = c * unit.equivalentFailureRate;
  const capGivenUp = Math.max(0, 1 - c * (1 - unit.capacityGivenUp));
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
  });
}

function evalLeaf(b: LeafBlock, name: string): BlockResult {
  const c = Math.max(1, Math.round(b.count ?? 1));
  const notes: string[] = [];
  const mu = b.mttr > 0 ? 1 / b.mttr : Infinity;
  let A1: number;
  let cap1: number;
  if (b.degraded && b.degraded.lambda > 0) {
    const d = degradedUnit(b.lambda, mu === Infinity ? 1e300 : mu, b.degraded.lambda, b.degraded.durationH, b.degraded.capacity);
    A1 = d.availability;
    cap1 = d.capacity;
    notes.push('three-state unit (up / degraded / down)');
  } else {
    const x = b.lambda * (mu === Infinity ? 0 : b.mttr);
    A1 = 1 / (1 + x);
    cap1 = A1;
  }
  const A = Math.pow(A1, c);
  const lambdaEq = c * b.lambda;
  const nu = A * lambdaEq;
  const capGivenUp1 = A1 > 0 ? cap1 / A1 : 0;
  const capGivenUp = Math.max(0, 1 - c * (1 - capGivenUp1));
  return finish({
    id: b.id,
    name,
    kind: 'leaf',
    availability: A,
    failureFrequency: nu,
    mttfFromNew: b.lambda > 0 ? 1 / lambdaEq : Infinity,
    capacity: A * capGivenUp,
    capacityGivenUp: capGivenUp,
    children: [],
    notes,
  });
}

function evalSeries(b: SeriesBlock, name: string, options: EvaluateOptions): BlockResult {
  const children = b.children.map((ch) => evaluate(ch, options));
  let A = 1;
  let lambdaEq = 0;
  let invMttf = 0;
  let degradation = 0;
  for (const ch of children) {
    A *= ch.availability;
    lambdaEq += ch.equivalentFailureRate;
    invMttf += ch.mttfFromNew > 0 ? 1 / ch.mttfFromNew : Infinity;
    degradation += 1 - ch.capacityGivenUp;
  }
  const capGivenUp = Math.max(0, 1 - degradation);
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
  const A = 1 - U;
  // MTTF from new via product-space CTMC on children's equivalent exponential parameters
  let mttfFromNew: number;
  if (children.length <= 10) {
    mttfFromNew = productSpaceMttf(children, (downMask) => downMask === (1 << children.length) - 1);
  } else {
    mttfFromNew = nu > 0 ? A / nu : Infinity;
    notes.push('MTTF from new approximated by steady-state A/ν (more than 10 children)');
  }
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
  const muU = unit.equivalentMttr > 0 && Number.isFinite(unit.equivalentMttr) ? 1 / unit.equivalentMttr : unit.equivalentMttr === 0 ? 1e300 : 0;
  const r = kOfNRepairable(b.n, b.k, lambdaU, muU, b.crews ?? Infinity, b.capacityMode ?? 'binary');
  const notes: string[] = [];
  if (b.unit.kind !== 'leaf') notes.push('unit replaced by its equivalent exponential (λ_eq, MTTR_eq)');
  if (b.crews !== undefined && Number.isFinite(b.crews)) notes.push(`${b.crews} repair crew(s)`);
  const capGivenUp = unit.capacityGivenUp; // first order: degradation of units propagates
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
  });
}

function evalStandby(b: StandbyBlock, name: string, options: EvaluateOptions): BlockResult {
  const unit = evaluate(b.unit, options);
  const lambdaU = unit.equivalentFailureRate;
  const muU = unit.equivalentMttr > 0 && Number.isFinite(unit.equivalentMttr) ? 1 / unit.equivalentMttr : 0;
  const r = standbyChain(b.n, lambdaU, muU, b.standbyFactor ?? 0, b.switchProbability ?? 1, b.crews ?? Infinity);
  return finish({
    id: b.id,
    name,
    kind: 'standby',
    availability: r.availability,
    failureFrequency: r.failureFrequency,
    mttfFromNew: r.mttfFromNew,
    capacity: r.availability,
    capacityGivenUp: 1,
    children: [unit],
    notes: [`standby factor ${b.standbyFactor ?? 0}, switch success ${b.switchProbability ?? 1}`],
  });
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
