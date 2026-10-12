/**
 * Build the reliability structure (block tree) from a scenario's topology, component classes
 * and workload, following the survey's templates: series training job (Fig. 4-1a),
 * training job with hot spares (Fig. 4-1b / 4-3), N+k inference replicas (Fig. 4-1c),
 * and infrastructure redundancy (worked example 5).
 */
import { evaluate as evalRbd, type Block, type LeafBlock } from '../rbd/index.js';
import { manualOnly, meanRepairH, isDual, subhealthRateFromProbability, SUBHEALTH_THRESHOLD_DEFAULT, type DualRepair, type Subhealth, type Switchover } from '../ctmc/repair.js';
import { toPerHour } from '../units/index.js';
import type { Scenario, Component, BlockInput, SwitchoverInput } from './schema.js';

/** Resolve a component's repair input (legacy `mttrHours` or v2 auto/manual paths) into a DualRepair. */
export function repairOf(c: Component): DualRepair {
  const manual = c.repair.manual?.mttrHours ?? c.repair.mttrHours ?? 0;
  if (c.repair.auto && c.repair.auto.coverage > 0) {
    return { coverage: c.repair.auto.coverage, successProbability: c.repair.auto.successProbability, autoMttrH: c.repair.auto.mttrHours, manualMttrH: manual };
  }
  return manualOnly(manual);
}

/** Resolve a component's sub-health input (v2 `subhealth`, else the v1 `failslow` alias) into a Subhealth spec. */
export function componentSubhealth(c: Component, threshold = SUBHEALTH_THRESHOLD_DEFAULT): Subhealth | undefined {
  if (c.subhealth) {
    const sh = c.subhealth;
    const rate = sh.ratePerHour ?? subhealthRateFromProbability(sh.steadyStateProbability ?? 0, sh.durationHours).ratePerHour;
    return {
      ratePerHour: rate,
      durationH: sh.durationHours,
      performance: sh.performance,
      escalationMultiplier: sh.escalationMultiplier,
      policy: sh.policy,
      detection: sh.detection ? { probability: sh.detection.probability, delayH: sh.detection.delayHours } : undefined,
      threshold: sh.threshold ?? threshold,
    };
  }
  if (c.failslow && c.failslow.ratePerHour > 0) {
    return { ratePerHour: c.failslow.ratePerHour, durationH: c.failslow.durationHours, performance: c.failslow.capacity, escalationMultiplier: 1, policy: 'tolerate', threshold: 0 };
  }
  return undefined;
}

function switchoverOf(sw: SwitchoverInput | undefined, fallbackP?: number): Switchover | undefined {
  if (sw) return { successProbability: sw.successProbability, outageS: sw.outageS, failureRecoveryHours: sw.failureRecoveryHours };
  if (fallbackP !== undefined && fallbackP < 1) return { successProbability: fallbackP };
  return undefined;
}

export interface Counts {
  gpus: number;
  nodes: number;
  racks: number;
  zones: number;
  nvlinkDomains: number;
  planes: number;
  /** GPUs actually used by the workload (excluding hot spares) */
  workloadGpus: number;
  /** v2 superpod counts (0 without topology.superpod) */
  supernodes: number;
  commRacks: number;
  l1Switches: number;
  l2Switches: number;
  subPlanes: number;
  opticalLinks: number;
  transceivers: number;
  gpusPerNode: number;
  nodesPerRack: number;
}

/** GPUs per node and nodes per rack, from the superpod geometry when present. */
export function nodeGeometry(s: Scenario): { gpusPerNode: number; nodesPerRack: number } {
  const sp = s.topology.superpod;
  return sp ? { gpusPerNode: sp.npusPerNode, nodesPerRack: sp.nodesPerRack } : { gpusPerNode: s.topology.gpusPerNode, nodesPerRack: s.topology.nodesPerRack };
}

export function computeCounts(s: Scenario): Counts {
  const t = s.topology;
  const { gpusPerNode, nodesPerRack } = nodeGeometry(s);
  let workloadGpus: number;
  let gpus: number;
  if (s.workload.type === 'training') {
    workloadGpus = s.workload.nGpus;
    gpus = workloadGpus + s.workload.hotSpareNodes * gpusPerNode;
  } else {
    workloadGpus = s.workload.replicasRequired * s.workload.gpusPerReplica;
    gpus = (s.workload.replicasRequired + s.workload.spareReplicas) * s.workload.gpusPerReplica;
  }
  const nodes = Math.ceil(gpus / gpusPerNode);
  const racks = Math.ceil(nodes / nodesPerRack);
  const zones = Math.ceil(racks / t.racksPerZone);
  const base: Counts = {
    gpus,
    nodes,
    racks,
    zones,
    nvlinkDomains: Math.ceil(gpus / (t.superpod ? t.superpod.npusPerNode * t.superpod.nodesPerRack * t.superpod.computeRacks : t.nvlinkDomainGpus)),
    planes: t.superpod ? t.superpod.subPlanes : t.networkPlanes,
    workloadGpus,
    supernodes: 0,
    commRacks: 0,
    l1Switches: 0,
    l2Switches: 0,
    subPlanes: 0,
    opticalLinks: 0,
    transceivers: 0,
    gpusPerNode,
    nodesPerRack,
  };
  const sp = t.superpod;
  if (!sp) return base;
  const nodesPerSupernode = sp.nodesPerRack * sp.computeRacks;
  const supernodes = Math.max(1, Math.ceil(nodes / nodesPerSupernode));
  const links = nodes * sp.l1PerNode * sp.linksPerL1;
  return {
    ...base,
    supernodes,
    commRacks: supernodes * sp.commRacks,
    l1Switches: nodes * sp.l1PerNode,
    l2Switches: supernodes * sp.subPlanes * sp.l2PerSubPlane,
    subPlanes: supernodes * sp.subPlanes,
    opticalLinks: links,
    transceivers: links * sp.transceiversPerLink,
  };
}

export interface ComponentInstances {
  component: Component;
  /** how many scope instances (nodes, racks, zones; 1 for fixed) */
  instances: number;
  /** units per instance */
  unitsPerInstance: number;
  /** total units */
  total: number;
  /** per-unit failure rate, per hour */
  lambda: number;
  /** independent part (1 − β) λ */
  lambdaIndependent: number;
  /** mean repair time E[R] over both paths, hours */
  mttr: number;
  /** v2 repair paths */
  repair: DualRepair;
  /** v2 sub-health (or the v1 fail-slow alias) */
  subhealth?: Subhealth;
  /** v3 silent-corruption rate per unit-hour (0 when the class produces none) */
  sdcLambda: number;
  /** v3 fraction of this class's hard interruptions each chain mechanism applies to */
  applicable: { replay: number; process: number; elastic: number; predict: number; netfail: number; hotswap: number };
}

export function componentInstances(c: Component, counts: Counts, subhealthThreshold = SUBHEALTH_THRESHOLD_DEFAULT): ComponentInstances {
  let instances = 1;
  let unitsPerInstance = 1;
  switch (c.countRule.per) {
    case 'gpu':
      instances = counts.gpus;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'node':
      instances = counts.nodes;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'rack':
      instances = counts.racks;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'zone':
      instances = counts.zones;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'fixed':
      instances = 1;
      unitsPerInstance = c.countRule.count;
      break;
    case 'supernode':
      instances = counts.supernodes;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'comm_rack':
      instances = counts.commRacks;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'l1_switch':
      instances = counts.l1Switches;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'l2_switch':
      instances = counts.l2Switches;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'subplane':
      instances = counts.subPlanes;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'optical_link':
      instances = counts.opticalLinks;
      unitsPerInstance = c.countRule.factor;
      break;
    case 'transceiver':
      instances = counts.transceivers;
      unitsPerInstance = c.countRule.factor;
      break;
  }
  const lambda = toPerHour(c.failure.value, c.failure.unit);
  const beta = c.ccf?.beta ?? 0;
  const repair = repairOf(c);
  return {
    component: c,
    instances,
    unitsPerInstance,
    total: instances * unitsPerInstance,
    lambda,
    lambdaIndependent: lambda * (1 - beta),
    mttr: meanRepairH(repair),
    repair,
    subhealth: componentSubhealth(c, subhealthThreshold),
    sdcLambda: c.sdc?.ratePerHour ?? 0,
    // a missing flag means the mechanism does not apply to this class (every rung, prediction included)
    applicable: { replay: c.mechanisms?.replay ?? 0, process: c.mechanisms?.process ?? 0, elastic: c.mechanisms?.elastic ?? 0, predict: c.mechanisms?.predict ?? 0, netfail: c.mechanisms?.netfail ?? 0, hotswap: c.mechanisms?.hotswap ?? 0 },
  };
}

/** Job-level silent-corruption rate per hour: Σ n_i λ_sdc,i over the enabled classes. */
export function sdcRatePerHour(items: ComponentInstances[]): number {
  return items.reduce((a, ci) => a + ci.total * ci.sdcLambda, 0);
}

function leafFor(ci: ComponentInstances, count: number, idSuffix = ''): LeafBlock {
  const c = ci.component;
  const leaf: LeafBlock = {
    kind: 'leaf',
    id: c.id + idSuffix,
    name: c.name?.en ?? c.name?.zh ?? c.id,
    count,
    lambda: ci.lambdaIndependent,
    mttr: ci.repair.manualMttrH,
  };
  if (isDual(ci.repair)) leaf.repair = ci.repair;
  if (ci.subhealth) leaf.subhealth = ci.subhealth;
  if (c.failure.koujing) leaf.koujing = c.failure.koujing;
  return leaf;
}

/** Block for one component class honouring its declared redundancy (if any). */
export function componentBlock(ci: ComponentInstances): Block {
  const c = ci.component;
  const red = (c as Component & { redundancy?: Redundancy }).redundancy;
  if (!red || red.scheme === 'series') return leafFor(ci, ci.total);
  const unit = leafFor(ci, 1, ':unit');
  let group: Block;
  switch (red.scheme) {
    case 'parallel':
      // identical units: use the exact k-of-n chain (k = 1) so dual repair and switchover are modelled exactly
      group = { kind: 'kofn', id: c.id + ':group', name: `${unit.name} (1-of-${ci.unitsPerInstance})`, n: red.n ?? ci.unitsPerInstance, k: 1, unit, capacityMode: red.capacityMode ?? 'binary', switchover: switchoverOf(red.switchover) };
      break;
    case 'kofn':
      group = { kind: 'kofn', id: c.id + ':group', name: `${unit.name} (${red.k ?? ci.unitsPerInstance - 1}-of-${red.n ?? ci.unitsPerInstance})`, n: red.n ?? ci.unitsPerInstance, k: red.k ?? ci.unitsPerInstance - 1, unit, capacityMode: red.capacityMode ?? 'binary', switchover: switchoverOf(red.switchover) };
      break;
    case 'standby':
      group = { kind: 'standby', id: c.id + ':group', name: `${unit.name} (standby ×${ci.unitsPerInstance})`, n: red.n ?? ci.unitsPerInstance, unit, standbyFactor: red.standbyFactor ?? 0, switchProbability: red.switchover?.successProbability ?? red.switchProbability ?? 1, switchover: switchoverOf(red.switchover) };
      break;
  }
  return ci.instances > 1 ? { kind: 'repeat', id: c.id, name: unit.name, count: ci.instances, unit: group } : { ...group, id: c.id };
}

export interface Redundancy {
  scheme: 'series' | 'parallel' | 'kofn' | 'standby';
  n?: number;
  k?: number;
  capacityMode?: 'binary' | 'proportional' | 'fractional';
  standbyFactor?: number;
  switchProbability?: number;
  switchover?: SwitchoverInput;
}

/** Common-cause leaves: one per domain, rate β·Σ(λ·count) of the members, repair = longest member MTTR. */
export function ccfLeaves(items: ComponentInstances[]): LeafBlock[] {
  const byDomain = new Map<string, { rate: number; mttr: number; members: string[] }>();
  for (const ci of items) {
    const ccf = ci.component.ccf;
    if (!ccf || ccf.beta <= 0) continue;
    const e = byDomain.get(ccf.domain) ?? { rate: 0, mttr: 0, members: [] };
    e.rate += ccf.beta * ci.lambda * ci.total;
    e.mttr = Math.max(e.mttr, ci.mttr);
    e.members.push(ci.component.id);
    byDomain.set(ccf.domain, e);
  }
  return [...byDomain.entries()].map(([domain, e]) => ({
    kind: 'leaf',
    id: `ccf:${domain}`,
    name: `Common cause (${domain}: ${e.members.join(', ')})`,
    count: 1,
    lambda: e.rate,
    mttr: e.mttr,
  }));
}

const PER_UNIT_SCOPES = new Set(['gpu', 'node']);

/* ---------------------------------------------------------------------- */
/* Replica composition (v2): which classes live inside one replica unit     */
/* ---------------------------------------------------------------------- */

export type ScopeLevel = 'gpu' | 'node' | 'rack' | 'supernode' | 'zone' | 'cluster';
const SCOPE_RANK: Record<ScopeLevel, number> = { gpu: 0, node: 1, rack: 2, supernode: 3, zone: 4, cluster: 5 };

/** Physical scope of a count rule (superpod scopes count per supernode or per node inside it). */
export function scopeOfCountRule(per: Component['countRule']['per']): ScopeLevel {
  switch (per) {
    case 'gpu':
      return 'gpu';
    case 'node':
      return 'node';
    case 'rack':
      return 'rack';
    case 'zone':
      return 'zone';
    case 'fixed':
      return 'cluster';
    default:
      return 'supernode';
  }
}

/** Smallest physical scope that contains `gpusPerReplica` GPUs. */
export function replicaScope(s: Scenario, counts: Counts, gpusPerReplica: number): ScopeLevel {
  if (gpusPerReplica <= counts.gpusPerNode) return 'node';
  const perRack = counts.gpusPerNode * counts.nodesPerRack;
  if (gpusPerReplica <= perRack) return 'rack';
  const sp = s.topology.superpod;
  if (sp && gpusPerReplica <= sp.npusPerNode * sp.nodesPerRack * sp.computeRacks) return 'supernode';
  if (gpusPerReplica <= perRack * s.topology.racksPerZone) return 'zone';
  return 'cluster';
}

export interface ReplicaMember {
  ci: ComponentInstances;
  /** failure rate contributed to one replica, per hour */
  lambdaPerReplica: number;
  mttrH: number;
  /** the class's declared redundancy was reduced to an equivalent exponential first */
  viaGroup: boolean;
}

export interface ReplicaComposition {
  scope: ScopeLevel;
  members: ReplicaMember[];
  /** classes above the replica scope: stay in series with the pool */
  others: ComponentInstances[];
  lambdaPerReplica: number;
  /** rate-weighted mean repair time of the replica, hours (or the configured replica recovery) */
  mttrH: number;
  notes: string[];
}

/**
 * Everything at or below the replica's scope (GPU, node, rack, supernode-level fabric …) fails the replica;
 * classes with declared redundancy enter through their group's equivalent rate. Classes above the scope
 * (zone, fixed) stay in series with the pool.
 */
export function replicaComposition(s: Scenario, counts: Counts, items: ComponentInstances[], totalReplicas: number, gpusPerReplica: number, replicaRecoveryHours?: number): ReplicaComposition {
  const scope = replicaScope(s, counts, gpusPerReplica);
  const rank = SCOPE_RANK[scope];
  const members: ReplicaMember[] = [];
  const others: ComponentInstances[] = [];
  const notes: string[] = [];
  for (const ci of items) {
    const cs = scopeOfCountRule(ci.component.countRule.per);
    if (cs === 'cluster' || SCOPE_RANK[cs] > rank) {
      others.push(ci);
      continue;
    }
    const red = (ci.component as Component & { redundancy?: Redundancy }).redundancy;
    if (red && red.scheme !== 'series') {
      const single: ComponentInstances = { ...ci, instances: 1, total: ci.unitsPerInstance };
      const r = evalRbd(componentBlock(single));
      const mttrEq = Number.isFinite(r.equivalentMttr) && r.equivalentMttr > 0 ? r.equivalentMttr : ci.mttr;
      members.push({ ci, lambdaPerReplica: (r.equivalentFailureRate * ci.instances) / totalReplicas, mttrH: mttrEq, viaGroup: true });
    } else {
      members.push({ ci, lambdaPerReplica: (ci.lambdaIndependent * ci.total) / totalReplicas, mttrH: ci.mttr, viaGroup: false });
    }
  }
  const lambdaPerReplica = members.reduce((a, m) => a + m.lambdaPerReplica, 0);
  const weighted = lambdaPerReplica > 0 ? members.reduce((a, m) => a + m.lambdaPerReplica * m.mttrH, 0) / lambdaPerReplica : 0.1;
  const mttrH = replicaRecoveryHours ?? Math.max(weighted, 1e-6);
  notes.push(`replica scope ${scope}: ${members.map((m) => m.ci.component.id + (m.viaGroup ? ' (group λ_eq)' : '')).join(', ') || 'none'}; replica MTTR ${mttrH.toPrecision(3)} h${replicaRecoveryHours === undefined ? ' (rate-weighted mean of the members)' : ' (configured)'}`);
  if (members.some((m) => m.ci.subhealth)) notes.push('sub-health of replica members is not propagated into the replica pool (closed form); see the Training page for the straggler law');
  return { scope, members, others, lambdaPerReplica, mttrH, notes };
}

/** Build the block tree for the scenario's structure mode. */
export function buildStructure(s: Scenario, counts: Counts): { root: Block; items: ComponentInstances[]; notes: string[] } {
  const items = s.components.filter((c) => c.enabled).map((c) => componentInstances(c, counts, s.measures.subhealthThreshold));
  const notes: string[] = [];
  if (s.structure.mode === 'custom') {
    return { root: resolveCustom(s.structure.root, items), items, notes };
  }
  const template = s.structure.template;
  const ccf = ccfLeaves(items);
  if (ccf.length) notes.push('common-cause leaves use β·Σλ over all domain instances (conservative for redundant groups)');

  if (template === 'training-series' || (template === 'training-hot-spares' && (s.workload.type !== 'training' || s.workload.hotSpareNodes === 0))) {
    const children: Block[] = items.map(componentBlock);
    return { root: { kind: 'series', id: 'job', name: 'Synchronous training job', children: [...children, ...ccf] }, items, notes };
  }

  if (template === 'training-hot-spares' && s.workload.type === 'training') {
    const nodeMembers = items.filter((ci) => PER_UNIT_SCOPES.has(ci.component.countRule.per) && !(ci.component as Component & { redundancy?: Redundancy }).redundancy);
    const others = items.filter((ci) => !nodeMembers.includes(ci));
    const perNode = nodeMembers.reduce((a, ci) => a + ci.lambdaIndependent * ci.total / counts.nodes, 0);
    const workingNodes = Math.ceil(s.workload.nGpus / counts.gpusPerNode);
    const nodeUnit: LeafBlock = { kind: 'leaf', id: 'node', name: 'Node (GPUs, NICs, host)', count: 1, lambda: perNode, mttr: s.workload.spareReplenishHours };
    const pool: Block = { kind: 'kofn', id: 'node-pool', name: `Nodes ${workingNodes}-of-${workingNodes + s.workload.hotSpareNodes} with hot spares`, n: workingNodes + s.workload.hotSpareNodes, k: workingNodes, unit: nodeUnit };
    notes.push(`node unit aggregates ${nodeMembers.map((m) => m.component.id).join(', ')}; pool MTTR = spare replenishment ${s.workload.spareReplenishHours} h`);
    return { root: { kind: 'series', id: 'job', name: 'Training job with hot spares', children: [pool, ...others.map(componentBlock), ...ccf] }, items, notes };
  }

  if (template === 'inference-nk' && s.workload.type === 'inference') {
    const w = s.workload;
    const totalReplicas = w.replicasRequired + w.spareReplicas;
    const comp = replicaComposition(s, counts, items, totalReplicas, w.gpusPerReplica, w.replicaRecoveryHours);
    const unitName = comp.scope === 'supernode' ? `Supernode (${w.gpusPerReplica} NPU)` : `Replica (${w.gpusPerReplica} GPU)`;
    const replica: LeafBlock = { kind: 'leaf', id: 'replica', name: unitName, count: 1, lambda: comp.lambdaPerReplica, mttr: comp.mttrH };
    const pool: Block = { kind: 'kofn', id: 'replica-pool', name: `${comp.scope === 'supernode' ? 'Supernodes' : 'Replicas'} ${w.replicasRequired}-of-${totalReplicas}`, n: totalReplicas, k: w.replicasRequired, unit: replica, capacityMode: 'proportional' };
    notes.push(...comp.notes);
    return { root: { kind: 'series', id: 'service', name: comp.scope === 'supernode' ? 'Cluster of supernodes' : 'Inference service', children: [pool, ...comp.others.map(componentBlock), ...ccf] }, items, notes };
  }

  // infrastructure or fallback: every component with its declared redundancy, in series
  const children: Block[] = items.map(componentBlock);
  return { root: { kind: 'series', id: 'system', name: template === 'infrastructure' ? 'Infrastructure' : 'System', children: [...children, ...ccf] }, items, notes };
}

function resolveCustom(b: BlockInput, items: ComponentInstances[]): Block {
  switch (b.kind) {
    case 'component': {
      const ci = items.find((x) => x.component.id === b.componentId);
      if (!ci) throw new Error(`custom structure references unknown component '${b.componentId}'`);
      return leafFor(ci, b.count ?? ci.total, b.id !== ci.component.id ? `#${b.id}` : '');
    }
    case 'series':
      return { kind: 'series', id: b.id, name: b.name, children: b.children.map((c) => resolveCustom(c, items)) };
    case 'parallel':
      return { kind: 'parallel', id: b.id, name: b.name, children: b.children.map((c) => resolveCustom(c, items)), switchover: switchoverOf(b.switchover) };
    case 'kofn':
      return { kind: 'kofn', id: b.id, name: b.name, n: b.n, k: b.k, unit: resolveCustom(b.unit, items), crews: b.crews, capacityMode: b.capacityMode, switchover: switchoverOf(b.switchover) };
    case 'standby':
      return { kind: 'standby', id: b.id, name: b.name, n: b.n, unit: resolveCustom(b.unit, items), standbyFactor: b.standbyFactor, switchProbability: b.switchover?.successProbability ?? b.switchProbability, crews: b.crews, switchover: switchoverOf(b.switchover) };
  }
}

/** Total interruption rate of a synchronous job: every component failure stops it (per hour). */
export function interruptionRatePerHour(items: ComponentInstances[]): number {
  return items.reduce((a, ci) => a + ci.lambda * ci.total, 0);
}
