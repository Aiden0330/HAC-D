/**
 * Scenario file schema (zod). A scenario is the complete, reproducible input of an analysis:
 * topology, component classes with 口径-typed parameters and provenance, structure, workload,
 * recovery pipeline, spares policy, targets and costs. JSON Schema can be exported with z.toJSONSchema.
 */
import { z } from 'zod';

export const DistributionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), value: z.number().nonnegative() }),
  z.object({ type: z.literal('exponential'), rate: z.number().positive() }),
  z.object({ type: z.literal('weibull'), shape: z.number().positive(), scale: z.number().positive() }),
  z.object({ type: z.literal('lognormal'), mu: z.number(), sigma: z.number().positive() }),
]);

export const RateUnitSchema = z.enum([
  'per_h', 'per_1e6_h', 'FIT', 'per_year', 'per_day', 'per_1000_node_day', 'per_node_day', 'per_month', 'per_week',
  'mtbf_h', 'h_per_event', 'gpu_h_per_event', 'gpu_day_per_event', 'node_h_per_event',
]);

export const KoujingSchema = z.object({
  event: z.string(),
  denominator: z.string(),
  level: z.enum(['component', 'node', 'job', 'fleet']),
  includesPlanned: z.boolean().optional(),
  dedup: z.string().nullable().optional(),
});

export const ConfidenceSchema = z.enum(['measured', 'paper-reported', 'vendor', 'derived', 'assumed', 'scan-level']);

export const ProvenanceSchema = z.object({
  source: z.string(),
  org: z.string().optional(),
  venue: z.string().optional(),
  year: z.number().int().optional(),
  url: z.string().optional(),
  surveyRef: z.string().optional(),
  confidence: ConfidenceSchema,
  derivation: z.string().optional(),
});

export const RateSchema = z.object({
  value: z.number().nonnegative(),
  unit: RateUnitSchema,
  /** lifetime distribution shape; exponential if omitted */
  weibullShape: z.number().positive().optional(),
  koujing: KoujingSchema.optional(),
  provenance: ProvenanceSchema.optional(),
});

export const RepairSchema = z
  .object({
    /** legacy single mean repair / replacement time in hours (= the manual path) */
    mttrHours: z.number().nonnegative().optional(),
    /** v2 automatic path (自动恢复): share of failures covered, success probability, mean time */
    auto: z
      .object({
        coverage: z.number().min(0).max(1),
        successProbability: z.number().min(0).max(1).default(1),
        mttrHours: z.number().nonnegative(),
      })
      .optional(),
    /** v2 manual path (人工修复) */
    manual: z.object({ mttrHours: z.number().nonnegative() }).optional(),
    /** optional distribution of the repair time (hours) for simulation (manual path when dual) */
    distribution: DistributionSchema.optional(),
    provenance: ProvenanceSchema.optional(),
  })
  .refine((r) => r.mttrHours !== undefined || r.manual !== undefined, { message: 'repair needs mttrHours or manual.mttrHours' });

/** v2 switchover (倒换) of a redundant group */
export const SwitchoverSchema = z.object({
  successProbability: z.number().min(0).max(1),
  /** outage of a successful switchover, seconds */
  outageS: z.number().nonnegative().optional(),
  /** time to clear a failed switchover, hours (default: the unit's manual MTTR) */
  failureRecoveryHours: z.number().positive().optional(),
});

/** v2 sub-health (亚健康) of a component class */
export const SubhealthSchema = z
  .object({
    ratePerHour: z.number().nonnegative().optional(),
    /** alternative input: steady-state probability of being sub-healthy */
    steadyStateProbability: z.number().min(0).lt(1).optional(),
    durationHours: z.number().positive(),
    /** delivered performance while sub-healthy */
    performance: z.number().min(0).max(1),
    /** failure-rate multiplier while sub-healthy */
    escalationMultiplier: z.number().positive().default(1),
    policy: z.enum(['tolerate', 'isolate']).default('tolerate'),
    detection: z.object({ probability: z.number().min(0).max(1), delayHours: z.number().nonnegative() }).optional(),
    /** per-class override of the scenario's sub-health threshold */
    threshold: z.number().min(0).max(1).optional(),
  })
  .refine((s) => s.ratePerHour !== undefined || s.steadyStateProbability !== undefined, { message: 'subhealth needs ratePerHour or steadyStateProbability' });

export const CountRuleSchema = z.discriminatedUnion('per', [
  z.object({ per: z.literal('gpu'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('node'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('rack'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('zone'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('fixed'), count: z.number().nonnegative() }),
  /** v2 superpod scopes (counts derived from topology.superpod) */
  z.object({ per: z.literal('supernode'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('comm_rack'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('l1_switch'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('l2_switch'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('subplane'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('optical_link'), factor: z.number().positive().default(1) }),
  z.object({ per: z.literal('transceiver'), factor: z.number().positive().default(1) }),
]);

export const DomainSchema = z.enum(['gpu', 'node', 'nvlink_domain', 'rack', 'tor', 'power_zone', 'cdu', 'plane', 'zone', 'cluster', 'supernode', 'ub_subplane', 'l2_switch', 'l1_switch', 'optical_link', 'comm_rack']);

/**
 * v2 supernode (SuperPoD) geometry. Defaults are the CloudMatrix384 facts from the Huawei paper
 * (arXiv 2506.12708 §3.3): 48 nodes × (8 NPU + 4 CPU + 7 L1 UB chips), 12 compute + 4 communication racks,
 * 7 L2 sub-planes × 16 chips × 48 ports, 16 links per L1 chip.
 */
export const SuperpodSchema = z.object({
  preset: z.enum(['cloudmatrix384', 'atlas950', 'custom']).default('custom'),
  npusPerNode: z.number().int().positive().default(8),
  cpusPerNode: z.number().int().nonnegative().default(4),
  l1PerNode: z.number().int().nonnegative().default(7),
  nodesPerRack: z.number().int().positive().default(4),
  computeRacks: z.number().int().positive().default(12),
  commRacks: z.number().int().nonnegative().default(4),
  subPlanes: z.number().int().positive().default(7),
  l2PerSubPlane: z.number().int().nonnegative().default(16),
  l2Ports: z.number().int().positive().default(48),
  linksPerL1: z.number().int().nonnegative().default(16),
  transceiversPerLink: z.number().int().nonnegative().default(2),
  rdmaPortsPerNpu: z.number().int().nonnegative().default(2),
  vpcNicsPerNode: z.number().int().nonnegative().default(1),
});
export type Superpod = z.infer<typeof SuperpodSchema>;

/** Public presets; every field not stated by a public source is marked in `assumed`. */
export const SUPERPOD_PRESETS: Record<'cloudmatrix384' | 'atlas950', { values: Superpod; assumed: (keyof Superpod)[]; source: string }> = {
  cloudmatrix384: {
    values: { preset: 'cloudmatrix384', npusPerNode: 8, cpusPerNode: 4, l1PerNode: 7, nodesPerRack: 4, computeRacks: 12, commRacks: 4, subPlanes: 7, l2PerSubPlane: 16, l2Ports: 48, linksPerL1: 16, transceiversPerLink: 2, rdmaPortsPerNpu: 2, vpcNicsPerNode: 1 },
    // §3.3.2 also states that one CPU per node hosts the Qingtian card (vpcNicsPerNode = 1); only the two transceiver ends per L1–L2 link are an assumption
    assumed: ['transceiversPerLink'],
    source: 'Huawei, Serving Large Language Models on Huawei CloudMatrix384 (arXiv 2506.12708 v3) §3.3.1–3.3.3 (8 NPU + 4 CPU + 7 L1 UB chips per node; 48 nodes in 12 compute + 4 communication racks; 7 sub-planes × 16 L2 chips × 48 ports; 16 links per L1 chip; 7 UB transceivers and 1 RDMA interface per die, 2 dies and 8 HBM stacks per NPU); The Register 2025-07-29 (14 × 28 GB/s UB links per NPU)',
  },
  atlas950: {
    // 8,192 NPUs in 160 cabinets (128 compute + 32 communication, secondary press): 1,024 nodes → 8 nodes per compute cabinet.
    // Fabric tiers are not public: the same 7-plane / 16-link L1 radix is assumed and the L2 count scaled to keep the fabric non-blocking.
    values: { preset: 'atlas950', npusPerNode: 8, cpusPerNode: 4, l1PerNode: 7, nodesPerRack: 8, computeRacks: 128, commRacks: 32, subPlanes: 7, l2PerSubPlane: Math.ceil((1024 * 16) / 48), l2Ports: 48, linksPerL1: 16, transceiversPerLink: 2, rdmaPortsPerNpu: 2, vpcNicsPerNode: 1 },
    assumed: ['npusPerNode', 'cpusPerNode', 'l1PerNode', 'nodesPerRack', 'subPlanes', 'l2PerSubPlane', 'l2Ports', 'linksPerL1', 'transceiversPerLink', 'rdmaPortsPerNpu', 'vpcNicsPerNode'],
    source: 'Huawei Connect 2025 press (8,192 NPUs; cabinet split from secondary coverage); fabric geometry assumed from CloudMatrix384',
  },
};

export const ComponentSchema = z.object({
  id: z.string(),
  name: z.object({ zh: z.string().optional(), en: z.string().optional() }).optional(),
  /** subsystem grouping used by allocation and reports */
  subsystem: z.enum(['compute', 'memory', 'interconnect', 'network', 'host', 'storage', 'power', 'cooling', 'software', 'other']).default('other'),
  countRule: CountRuleSchema,
  failure: RateSchema,
  repair: RepairSchema,
  /** which failure domain one failure takes down (blast radius); default: the unit itself */
  blastRadius: DomainSchema.optional(),
  /** common-cause: share β of the class's failures that hit the whole domain at once */
  ccf: z.object({ domain: DomainSchema, beta: z.number().min(0).max(1) }).optional(),
  /** fail-slow degraded state (v1; counted as up with reduced capacity) */
  failslow: z.object({ ratePerHour: z.number().nonnegative(), durationHours: z.number().positive(), capacity: z.number().min(0).max(1) }).optional(),
  /** v2 sub-health with threshold rule, escalation and tolerate / isolate policy (takes precedence over failslow) */
  subhealth: SubhealthSchema.optional(),
  /** infant mortality: rate multiplier for the first `durationHours` of life (simulation) */
  infant: z.object({ multiplier: z.number().positive(), durationHours: z.number().positive() }).optional(),
  /** lemon units: fraction of units with a higher rate (simulation) */
  lemon: z.object({ fraction: z.number().min(0).max(1), multiplier: z.number().positive() }).optional(),
  /** arrangement of the units inside one scope instance (default: all in series) */
  redundancy: z
    .object({
      scheme: z.enum(['series', 'parallel', 'kofn', 'standby']),
      n: z.number().int().positive().optional(),
      k: z.number().int().positive().optional(),
      capacityMode: z.enum(['binary', 'proportional', 'fractional']).optional(),
      standbyFactor: z.number().min(0).max(1).optional(),
      switchProbability: z.number().min(0).max(1).optional(),
      /** v2 switchover details (success probability overrides switchProbability) */
      switchover: SwitchoverSchema.optional(),
    })
    .optional(),
  /** exclude from the analysis without deleting */
  enabled: z.boolean().default(true),
});

export const TopologySchema = z.object({
  gpusPerNode: z.number().int().positive().default(8),
  nodesPerRack: z.number().int().positive().default(4),
  racksPerZone: z.number().int().positive().default(64),
  /** GPUs sharing one NVLink / scale-up domain (8 for HGX, 72 for NVL72, 64 for a TPU cube) */
  nvlinkDomainGpus: z.number().int().positive().default(8),
  networkPlanes: z.number().int().positive().default(1),
  torMode: z.enum(['single', 'dual']).default('single'),
  power: z.enum(['none', 'N+1', '2N', 'catcher']).default('2N'),
  cooling: z.object({ modules: z.number().int().positive(), required: z.number().int().positive() }).prefault({ modules: 6, required: 5 }),
  /** v2: supernode geometry; when present it defines gpusPerNode / nodesPerRack and the superpod count scopes */
  superpod: SuperpodSchema.optional(),
});

const BlockBaseSchema = z.object({ id: z.string(), name: z.string().optional() });
export type BlockInput =
  | (z.infer<typeof BlockBaseSchema> & { kind: 'component'; componentId: string; count?: number })
  | (z.infer<typeof BlockBaseSchema> & { kind: 'series'; children: BlockInput[] })
  | (z.infer<typeof BlockBaseSchema> & { kind: 'parallel'; children: BlockInput[]; switchover?: z.infer<typeof SwitchoverSchema> })
  | (z.infer<typeof BlockBaseSchema> & { kind: 'kofn'; n: number; k: number; unit: BlockInput; crews?: number; capacityMode?: 'binary' | 'proportional' | 'fractional'; switchover?: z.infer<typeof SwitchoverSchema> })
  | (z.infer<typeof BlockBaseSchema> & { kind: 'standby'; n: number; unit: BlockInput; standbyFactor?: number; switchProbability?: number; crews?: number; switchover?: z.infer<typeof SwitchoverSchema> });

export const BlockInputSchema: z.ZodType<BlockInput> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    BlockBaseSchema.extend({ kind: z.literal('component'), componentId: z.string(), count: z.number().positive().optional() }),
    BlockBaseSchema.extend({ kind: z.literal('series'), children: z.array(BlockInputSchema) }),
    BlockBaseSchema.extend({ kind: z.literal('parallel'), children: z.array(BlockInputSchema), switchover: SwitchoverSchema.optional() }),
    BlockBaseSchema.extend({ kind: z.literal('kofn'), n: z.number().int().positive(), k: z.number().int().positive(), unit: BlockInputSchema, crews: z.number().positive().optional(), capacityMode: z.enum(['binary', 'proportional', 'fractional']).optional(), switchover: SwitchoverSchema.optional() }),
    BlockBaseSchema.extend({ kind: z.literal('standby'), n: z.number().int().positive(), unit: BlockInputSchema, standbyFactor: z.number().min(0).max(1).optional(), switchProbability: z.number().min(0).max(1).optional(), crews: z.number().positive().optional(), switchover: SwitchoverSchema.optional() }),
  ]) as unknown as z.ZodType<BlockInput>,
);

export const StructureSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('template'), template: z.enum(['training-series', 'training-hot-spares', 'inference-nk', 'infrastructure']) }),
  z.object({ mode: z.literal('custom'), root: BlockInputSchema }),
]);

export const TrainingWorkloadSchema = z.object({
  type: z.literal('training'),
  nGpus: z.number().int().positive(),
  durationDays: z.number().positive().default(30),
  /** exposed (blocking) checkpoint save time, seconds */
  deltaS: z.number().nonnegative(),
  /** checkpoint-interval model */
  intervalModel: z.enum(['young', 'daly3', 'dalyExact', 'saxena']).default('young'),
  /** override the optimal interval (seconds) to evaluate a chosen interval */
  intervalS: z.number().positive().optional(),
  /** hot-spare nodes kept warm for the job (k-of-n at node granularity) */
  hotSpareNodes: z.number().int().nonnegative().default(0),
  /** how fast a consumed hot spare is replenished (hours) — the MTTR of the spare pool chain */
  spareReplenishHours: z.number().positive().default(24),
  /** recovery path changes the recompute term: 'checkpoint' = τ/2, 'replica' = one step */
  recovery: z.enum(['checkpoint', 'replica']).default('checkpoint'),
  stepTimeS: z.number().positive().optional(),
});

export const InferenceWorkloadSchema = z.object({
  type: z.literal('inference'),
  replicasRequired: z.number().int().positive(),
  gpusPerReplica: z.number().int().positive(),
  spareReplicas: z.number().int().nonnegative().default(0),
  capacityTarget: z.number().min(0).max(1).default(0.999),
  windowHours: z.number().positive().default(24),
  /** replica-level recovery time in hours (rebuild / restart); overrides the pipeline for replicas */
  replicaRecoveryHours: z.number().positive().optional(),
});

export const WorkloadSchema = z.discriminatedUnion('type', [TrainingWorkloadSchema, InferenceWorkloadSchema]);

export const ScaleLawSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('constant') }),
  z.object({ type: z.literal('linear'), refN: z.number().positive() }),
  z.object({ type: z.literal('power'), refN: z.number().positive(), exponent: z.number() }),
  z.object({ type: z.literal('log'), refN: z.number().positive(), slope: z.number() }),
  z.object({ type: z.literal('order-statistic'), refN: z.number().positive(), cv: z.number().nonnegative() }),
  z.object({ type: z.literal('bandwidth'), sizeGB: z.number().positive(), bandwidthGBps: z.number().positive(), bandwidthScalesWithN: z.boolean(), refN: z.number().positive() }),
]);

export const StageSchema = z.object({
  name: z.enum(['detect', 'localize', 'remediate', 'restart', 'load', 'recompute', 'warmup']),
  value: z.union([z.number().nonnegative(), DistributionSchema]),
  scale: ScaleLawSchema.optional(),
  note: z.string().optional(),
});

export const RungSchema = z.object({
  id: z.string(),
  name: z.object({ zh: z.string().optional(), en: z.string().optional() }).optional(),
  kind: z.enum(['auto', 'manual']),
  successProbability: z.number().min(0).max(1),
  timeS: z.union([z.number().nonnegative(), DistributionSchema]),
  scale: ScaleLawSchema.optional(),
  note: z.string().optional(),
  confidence: z.enum(['measured', 'paper-reported', 'vendor', 'derived', 'assumed']).optional(),
});

export const RecoverySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preset'), preset: z.string() }),
  z.object({ mode: z.literal('pipeline'), stages: z.array(StageSchema).min(1) }),
  /** v2 recovery ladder: a preset id (e.g. 'mindcluster-a3') or explicit rungs */
  z.object({ mode: z.literal('ladder'), preset: z.string().optional(), rungs: z.array(RungSchema).min(1).optional() }),
]);

/** v2 measure settings */
export const MeasuresSchema = z.object({
  /** sub-health counts as down when its performance is below this threshold */
  subhealthThreshold: z.number().min(0).max(1).default(0.7),
  /** which measure the report headlines */
  primary: z.enum(['compensated', 'original']).default('compensated'),
  /** communication share of the step time used for fabric-plane degradation */
  commShare: z.number().min(0).max(1).default(0.3),
});

export const SparesSchema = z.object({
  /** fraction of interruptions that need a hardware replacement */
  hardwareReplacementFraction: z.number().min(0).max(1).default(0.587),
  /** repair / RMA turnaround for cold spares, hours */
  turnaroundHours: z.number().positive().default(72),
  /** confidence level for quantile-based sizing */
  quantile: z.number().min(0.5).max(0.999999).default(0.99),
});

export const TargetsSchema = z.object({
  availability: z.number().min(0).max(1).optional(),
  goodput: z.number().min(0).max(1).optional(),
  capacityAvailability: z.number().min(0).max(1).optional(),
});

export const CostsSchema = z.object({
  pricePerGpuHour: z.number().nonnegative().default(1.44e6 / (16384 * 24)),
  spareUnitCostPerHour: z.number().nonnegative().optional(),
  extraDollarsPerDay: z.number().default(0),
});

export const ScenarioSchema = z.object({
  version: z.enum(['0.1', '0.2']).default('0.2'),
  meta: z.object({
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    created: z.string().optional(),
    basis: z.array(z.string()).default([]),
  }),
  topology: TopologySchema.prefault({}),
  components: z.array(ComponentSchema).min(1),
  structure: StructureSchema.prefault({ mode: 'template', template: 'training-series' }),
  workload: WorkloadSchema,
  recovery: RecoverySchema.prefault({ mode: 'preset', preset: 'baseline-timeout-manual' }),
  spares: SparesSchema.prefault({}),
  targets: TargetsSchema.prefault({}),
  costs: CostsSchema.prefault({}),
  measures: MeasuresSchema.prefault({}),
  assumptions: z.array(z.string()).default([]),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Topology = z.infer<typeof TopologySchema>;
export type TrainingWorkload = z.infer<typeof TrainingWorkloadSchema>;
export type InferenceWorkload = z.infer<typeof InferenceWorkloadSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Repair = z.infer<typeof RepairSchema>;
export type SubhealthInput = z.infer<typeof SubhealthSchema>;
export type SwitchoverInput = z.infer<typeof SwitchoverSchema>;
export type Recovery = z.infer<typeof RecoverySchema>;

export function parseScenario(input: unknown): Scenario {
  return ScenarioSchema.parse(input);
}

export function scenarioJsonSchema(): unknown {
  return z.toJSONSchema(ScenarioSchema, { io: 'input' });
}
