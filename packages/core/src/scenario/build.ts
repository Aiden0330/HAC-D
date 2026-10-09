/**
 * Build the reliability structure (block tree) from a scenario's topology, component classes
 * and workload, following the survey's templates: series training job (Fig. 4-1a),
 * training job with hot spares (Fig. 4-1b / 4-3), N+k inference replicas (Fig. 4-1c),
 * and infrastructure redundancy (worked example 5).
 */
import type { Block, LeafBlock } from '../rbd/index.js';
import { toPerHour } from '../units/index.js';
import type { Scenario, Component, BlockInput } from './schema.js';

export interface Counts {
  gpus: number;
  nodes: number;
  racks: number;
  zones: number;
  nvlinkDomains: number;
  planes: number;
  /** GPUs actually used by the workload (excluding hot spares) */
  workloadGpus: number;
}

export function computeCounts(s: Scenario): Counts {
  const t = s.topology;
  let workloadGpus: number;
  let gpus: number;
  if (s.workload.type === 'training') {
    workloadGpus = s.workload.nGpus;
    gpus = workloadGpus + s.workload.hotSpareNodes * t.gpusPerNode;
  } else {
    workloadGpus = s.workload.replicasRequired * s.workload.gpusPerReplica;
    gpus = (s.workload.replicasRequired + s.workload.spareReplicas) * s.workload.gpusPerReplica;
  }
  const nodes = Math.ceil(gpus / t.gpusPerNode);
  const racks = Math.ceil(nodes / t.nodesPerRack);
  const zones = Math.ceil(racks / t.racksPerZone);
  return { gpus, nodes, racks, zones, nvlinkDomains: Math.ceil(gpus / t.nvlinkDomainGpus), planes: t.networkPlanes, workloadGpus };
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
  mttr: number;
}

export function componentInstances(c: Component, counts: Counts): ComponentInstances {
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
  }
  const lambda = toPerHour(c.failure.value, c.failure.unit);
  const beta = c.ccf?.beta ?? 0;
  return {
    component: c,
    instances,
    unitsPerInstance,
    total: instances * unitsPerInstance,
    lambda,
    lambdaIndependent: lambda * (1 - beta),
    mttr: c.repair.mttrHours,
  };
}

function leafFor(ci: ComponentInstances, count: number, idSuffix = ''): LeafBlock {
  const c = ci.component;
  const leaf: LeafBlock = {
    kind: 'leaf',
    id: c.id + idSuffix,
    name: c.name?.en ?? c.name?.zh ?? c.id,
    count,
    lambda: ci.lambdaIndependent,
    mttr: ci.mttr,
  };
  if (c.failslow) leaf.degraded = { lambda: c.failslow.ratePerHour, durationH: c.failslow.durationHours, capacity: c.failslow.capacity };
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
      group = { kind: 'parallel', id: c.id + ':group', name: `${unit.name} (1-of-${ci.unitsPerInstance})`, children: Array.from({ length: ci.unitsPerInstance }, (_, i) => ({ ...unit, id: `${c.id}:u${i}` })) };
      break;
    case 'kofn':
      group = { kind: 'kofn', id: c.id + ':group', name: `${unit.name} (${red.k ?? ci.unitsPerInstance - 1}-of-${red.n ?? ci.unitsPerInstance})`, n: red.n ?? ci.unitsPerInstance, k: red.k ?? ci.unitsPerInstance - 1, unit, capacityMode: red.capacityMode ?? 'binary' };
      break;
    case 'standby':
      group = { kind: 'standby', id: c.id + ':group', name: `${unit.name} (standby ×${ci.unitsPerInstance})`, n: red.n ?? ci.unitsPerInstance, unit, standbyFactor: red.standbyFactor ?? 0, switchProbability: red.switchProbability ?? 1 };
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

/** Build the block tree for the scenario's structure mode. */
export function buildStructure(s: Scenario, counts: Counts): { root: Block; items: ComponentInstances[]; notes: string[] } {
  const items = s.components.filter((c) => c.enabled).map((c) => componentInstances(c, counts));
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
    const workingNodes = Math.ceil(s.workload.nGpus / s.topology.gpusPerNode);
    const nodeUnit: LeafBlock = { kind: 'leaf', id: 'node', name: 'Node (GPUs, NICs, host)', count: 1, lambda: perNode, mttr: s.workload.spareReplenishHours };
    const pool: Block = { kind: 'kofn', id: 'node-pool', name: `Nodes ${workingNodes}-of-${workingNodes + s.workload.hotSpareNodes} with hot spares`, n: workingNodes + s.workload.hotSpareNodes, k: workingNodes, unit: nodeUnit };
    notes.push(`node unit aggregates ${nodeMembers.map((m) => m.component.id).join(', ')}; pool MTTR = spare replenishment ${s.workload.spareReplenishHours} h`);
    return { root: { kind: 'series', id: 'job', name: 'Training job with hot spares', children: [pool, ...others.map(componentBlock), ...ccf] }, items, notes };
  }

  if (template === 'inference-nk' && s.workload.type === 'inference') {
    const w = s.workload;
    const replicaMembers = items.filter((ci) => PER_UNIT_SCOPES.has(ci.component.countRule.per) && !(ci.component as Component & { redundancy?: Redundancy }).redundancy);
    const others = items.filter((ci) => !replicaMembers.includes(ci));
    const totalReplicas = w.replicasRequired + w.spareReplicas;
    const perReplica = replicaMembers.reduce((a, ci) => a + ci.lambdaIndependent * ci.total / totalReplicas, 0);
    const mttrRep = w.replicaRecoveryHours ?? Math.max(...replicaMembers.map((m) => m.mttr), 0.1);
    const replica: LeafBlock = { kind: 'leaf', id: 'replica', name: `Replica (${w.gpusPerReplica} GPU)`, count: 1, lambda: perReplica, mttr: mttrRep };
    const pool: Block = { kind: 'kofn', id: 'replica-pool', name: `Replicas ${w.replicasRequired}-of-${totalReplicas}`, n: totalReplicas, k: w.replicasRequired, unit: replica, capacityMode: 'proportional' };
    notes.push(`replica unit aggregates ${replicaMembers.map((m) => m.component.id).join(', ')}; replica MTTR ${mttrRep} h`);
    return { root: { kind: 'series', id: 'service', name: 'Inference service', children: [pool, ...others.map(componentBlock), ...ccf] }, items, notes };
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
      return { kind: 'parallel', id: b.id, name: b.name, children: b.children.map((c) => resolveCustom(c, items)) };
    case 'kofn':
      return { kind: 'kofn', id: b.id, name: b.name, n: b.n, k: b.k, unit: resolveCustom(b.unit, items), crews: b.crews, capacityMode: b.capacityMode };
    case 'standby':
      return { kind: 'standby', id: b.id, name: b.name, n: b.n, unit: resolveCustom(b.unit, items), standbyFactor: b.standbyFactor, switchProbability: b.switchProbability, crews: b.crews };
  }
}

/** Total interruption rate of a synchronous job: every component failure stops it (per hour). */
export function interruptionRatePerHour(items: ComponentInstances[]): number {
  return items.reduce((a, ci) => a + ci.lambda * ci.total, 0);
}
