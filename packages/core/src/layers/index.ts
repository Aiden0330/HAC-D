/**
 * v5 layer model of the per-unit basis (docs/ASCEND_ALLOCATION_METHODOLOGY.html Table 1 and formula (3); previously the LAYERS
 * table, `levels()` and `instancesOf()` of scripts/ascend-allocation-data.ts).
 *
 * Six layers top-down, each the set of hardware fault units whose fault classes it owns: cluster = job-level services; scale-out
 * network = RoCE / UBoE switches and links; SuperPoD (UB domain) = UB switch chips and UB optical links; compute cabinet; node =
 * node + host CPU; NPU. A class belongs to exactly one layer (by its fault unit), so the layers' rates and pause contributions
 * add up to the job's: Σ_ℓ λ_ℓ = λ_hw and Σ_ℓ C_ℓ = Σλ_i t̄_i. The other event classes are split by each layer's own sub-health
 * entry rate (isolation) and detected silent rate Σ_i λ_sdc,i q_i (detected corruption; q_i the class's immediate detection
 * coverage, §24.3 — equal to the raw silent rate's share while every class has the same coverage). The unavailability share of a
 * layer is U_ℓ = C_ℓ / (3600 · D) with D = 1 + (ΣC + F)/3600 (formula (3); F includes the predictor's false alarms, which no
 * layer owns); MTBF per instance = instances / λ_ℓ.
 * 口径: job-level interruptions per hour by layer; pauses in seconds of job time; instances from the topology counts.
 */
import type { Scenario } from '../scenario/schema.js';
import type { TrainingKpis } from '../scenario/evaluate.js';
import { computeCounts, componentInstances, classSdcCoverage, type Counts } from '../scenario/build.js';
import { unitFaultLibrary, type FaultUnit, type UnitFaultType } from '../topology/index.js';
import { kpiForm, trainingOf, type KpiForm } from '../budget/kpiForm.js';

type L = { zh: string; en: string };
export type LayerId = 'cluster' | 'scaleout' | 'superpod' | 'cabinet' | 'node' | 'npu';
export const LAYER_IDS: LayerId[] = ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu'];

export interface LayerDef { id: LayerId; units: FaultUnit[]; name: L; instance: L }

/** the six layers of the per-unit basis, top-down, by fault unit */
export const DEFAULT_LAYERS: LayerDef[] = [
  { id: 'cluster', units: ['job'], name: { zh: '集群级', en: 'Cluster' }, instance: { zh: '整个作业', en: 'the whole job' } },
  { id: 'scaleout', units: ['roce-switch', 'roce-link'], name: { zh: '跨超节点网络', en: 'Scale-out network' }, instance: { zh: '整张网络', en: 'the whole network' } },
  { id: 'superpod', units: ['ub-switch', 'ub-link'], name: { zh: '超节点（UB 域）', en: 'SuperPoD (UB domain)' }, instance: { zh: '一个超节点', en: 'one SuperPoD' } },
  { id: 'cabinet', units: ['cabinet'], name: { zh: '计算柜', en: 'Compute cabinet' }, instance: { zh: '一个计算柜', en: 'one cabinet' } },
  { id: 'node', units: ['node', 'cpu'], name: { zh: '节点', en: 'Node' }, instance: { zh: '一个节点', en: 'one node' } },
  { id: 'npu', units: ['npu'], name: { zh: 'NPU', en: 'NPU' }, instance: { zh: '一张卡', en: 'one card' } },
];

let LIB: Map<string, UnitFaultType> | undefined;
/** the unit fault library keyed by component id (memoised) */
export function unitLibrary(): Map<string, UnitFaultType> {
  return (LIB ??= new Map(unitFaultLibrary().map((f) => [f.id, f])));
}
/** fault unit of a topology-scenario component (a class outside the unit library has no layer and throws) */
export function unitOfClass(id: string): FaultUnit {
  const f = unitLibrary().get(id);
  if (!f) throw new Error(`no fault unit for class '${id}': the layer model needs topology-scenario classes (unitFaultLibrary); add the class to the unit library and a bill-of-materials row to extend it`);
  return f.unit;
}
/** layer of a component by its fault unit */
export function layerOf(id: string, layers: LayerDef[] = DEFAULT_LAYERS): LayerId {
  const u = unitOfClass(id);
  const l = layers.find((x) => x.units.includes(u));
  if (!l) throw new Error(`no layer for fault unit '${u}' (class ${id})`);
  return l.id;
}

/**
 * Instance rule of the layers, read from a topology record's `layers` block: the SuperPoD instance is one supernode (UB
 * domain) or, when the UB domain is a server (Atlas 800T A3), one node. Cluster and scale-out network have one instance.
 */
export interface LayerModelSpec {
  superpod?: { unit: 'supernodes' | 'nodes'; npus?: number };
  cabinet?: { npus?: number };
  node?: { npus?: number };
}
export interface LayerModel {
  layers: LayerDef[];
  /** instances of each layer at n NPUs from the topology counts */
  instances: (n: number, counts: Counts) => Record<LayerId, number>;
  spec: LayerModelSpec;
}
export function layerModel(spec: LayerModelSpec = {}, layers: LayerDef[] = DEFAULT_LAYERS): LayerModel {
  const superpodUnit = spec.superpod?.unit ?? 'supernodes';
  return {
    layers,
    spec,
    instances: (n, counts) => ({ cluster: 1, scaleout: 1, superpod: superpodUnit === 'nodes' ? counts.nodes : counts.supernodes, cabinet: counts.racks, node: counts.nodes, npu: n }),
  };
}

export interface LayerClassRow { id: string; unit: FaultUnit; ratePerHour: number; meanPauseS: number; pGlobal: number }
export interface LayerReadout {
  /** Σλ_i of the layer's interruption classes, per hour */
  lam: number;
  /** Σλ_i t̄_i, seconds per hour */
  c: number;
  /** the layer's share of the isolation pauses, seconds per hour (by its sub-health entry rate) */
  iso: number;
  /** the layer's share of the detected-silent-corruption pauses, seconds per hour (by its detected silent rate Σ λ_sdc,i q_i) */
  sdc: number;
  slowRate: number;
  /** Σ_i n_i λ_sdc,i of the layer's classes, per hour (raw silent rate) */
  sdcRate: number;
  /** Σ_i n_i λ_sdc,i q_i: the layer's immediately detected silent rate, per hour (the weight of `sdc`) */
  sdcDetectedRate: number;
  rows: LayerClassRow[];
}
export interface ByLayer { k: KpiForm; levels: Record<LayerId, LayerReadout> }

/** per-layer read-out of one design: rates and pause contributions of the chain classes, the other event classes split by layer */
export function byLayer(sc: Scenario, t: TrainingKpis = trainingOf(sc), layers: LayerDef[] = DEFAULT_LAYERS): ByLayer {
  const k = kpiForm(sc, t);
  const cnt = computeCounts(sc);
  const out = Object.fromEntries(layers.map((l) => [l.id, { lam: 0, c: 0, iso: 0, sdc: 0, slowRate: 0, sdcRate: 0, sdcDetectedRate: 0, rows: [] as LayerClassRow[] }])) as Record<LayerId, LayerReadout>;
  for (const r of t.chain.rows) {
    const lv = out[layerOf(r.id, layers)];
    lv.lam += r.ratePerHour; lv.c += r.ratePerHour * r.meanPauseS;
    lv.rows.push({ id: r.id, unit: unitOfClass(r.id), ratePerHour: r.ratePerHour, meanPauseS: r.meanPauseS, pGlobal: r.pGlobal });
  }
  // the other event classes, split by each layer's sub-health entry rate and detected silent rate λ_sdc,i q_i (job level, per hour)
  for (const c of sc.components) {
    if (!c.enabled) continue;
    const ci = componentInstances(c, cnt, sc.measures.subhealthThreshold);
    if (!(ci.total > 0)) continue;
    const lv = out[layerOf(c.id, layers)];
    lv.slowRate += (c.subhealth?.ratePerHour ?? 0) * ci.total;
    const sdcRate = (c.sdc?.ratePerHour ?? 0) * ci.total;
    lv.sdcRate += sdcRate;
    lv.sdcDetectedRate += sdcRate * classSdcCoverage(ci, sc.sdc.detection.coverage);
  }
  const slowTot = layers.reduce((a, l) => a + out[l.id].slowRate, 0), sdcTot = layers.reduce((a, l) => a + out[l.id].sdcDetectedRate, 0);
  for (const l of layers) { out[l.id].iso = slowTot > 0 ? k.other[0].sPerH * out[l.id].slowRate / slowTot : 0; out[l.id].sdc = sdcTot > 0 ? k.other[1].sPerH * out[l.id].sdcDetectedRate / sdcTot : 0; }
  return { k, levels: out };
}

/** unavailability by layer in points of A_op (formula (3)): U_ℓ = 100 · C_ℓ / (3600 · D), D = 1 + (Σ_ℓ C_ℓ + F) / 3600 with F the other event classes of formula (1) (isolation, detected silent corruption, false alarms) */
export function unavailabilityByLayer(x: ByLayer, layers: LayerDef[] = DEFAULT_LAYERS): Record<LayerId, number> & { hard: number; total: number; other: number } {
  const D = 1 + (layers.reduce((a, l) => a + x.levels[l.id].c, 0) + x.k.F) / 3600;
  const u = Object.fromEntries(layers.map((l) => [l.id, (100 * x.levels[l.id].c) / (3600 * D)])) as Record<LayerId, number> & { hard: number; total: number; other: number };
  u.hard = layers.reduce((a, l) => a + u[l.id], 0);
  u.total = 100 * (1 - x.k.aOp);
  u.other = u.total - u.hard;
  return u;
}
