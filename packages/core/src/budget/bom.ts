/**
 * v5 bill of materials of a topology record's design variants (docs/ASCEND_BOM_100K.html; previously scripts/ascend-bom-100k.ts):
 * for every scale-out variant of the record the HAC-D bill of materials at N NPUs (counts, per NPU, fault unit, business-impact FIT
 * per unit, job interruption rate per row), the reliability consequence (hard FIT per NPU by fault unit, MTBI, A_op and delivered
 * goodput today with the reference mechanisms), and the counts of the main design at the built-in scales. Identity checks of the
 * BOM report: designs of one family share the scale-out counts variant by variant (the scale-out network depends on N and the
 * variant only); the hard FIT per NPU splits sum to the total; the rows' rates sum to the job rate.
 * 口径: counts are HAC-D topology-template geometry, not vendor bills of materials; FIT per unit-hour; rates per hour at job level.
 */
import type { Scenario } from '../scenario/schema.js';
import { topologyBom, TOPOLOGY_SCALES, type BomRow, type FaultUnit } from '../topology/index.js';
import type { Counts } from '../scenario/build.js';
import { trainingOf } from './kpiForm.js';
import { scenarioFromRecord, type TopologyRecord } from '../records/topologyRecord.js';

type L = { zh: string; en: string };
export interface BomDesignRow {
  id: string; name: L; level: BomRow['level']; count: number; perNpu: number; faultUnit: FaultUnit | null;
  fitHard: number | null; fitSlow: number | null; fitSdc: number | null; hardPerHour: number | null; impact: L; blastRadiusNpus: number | null; confidence: BomRow['confidence'];
}
export interface BomDesign {
  /** `${record.id}-${variant.id}` */
  id: string; family: string; arch: string; so: string;
  name: L; short: L; soName: L; basis: L; assumed: (string | L)[]; main: boolean;
  counts: Counts; rows: BomDesignRow[];
  hardFitPerNpu: Partial<Record<FaultUnit, number>>; hardFitPerNpuTotal: number; hardFitPerNpuOther: number; hardPerHour: number; mtbiH: number | null;
  aOp: number; delivered: number;
  scaleOut: Scenario['topology']['scaleOut'];
}

/** one design's bill of materials at N NPUs */
export function bomDesign(record: TopologyRecord, variantId: string, npus: number): BomDesign {
  const v = record.variants.find((x) => x.id === variantId);
  if (!v) throw new Error(`record '${record.id}' has no scale-out variant '${variantId}' (variants: ${record.variants.map((x) => x.id).join(', ')})`);
  const s = scenarioFromRecord(record, npus, variantId);
  const b = topologyBom(s);
  const t = trainingOf(s);
  return {
    id: `${record.id}-${v.id}`, family: record.family, arch: record.id, so: v.id, name: record.name, short: record.short, soName: v.name, basis: v.basis, assumed: record.assumed, main: v.id === 'main',
    counts: b.counts, rows: b.rows.map((r) => ({ id: r.id, name: r.name, level: r.level, count: r.count, perNpu: r.perNpu, faultUnit: r.faultUnit ?? null, fitHard: r.fit?.hard ?? null, fitSlow: r.fit?.slow ?? null, fitSdc: r.fit?.sdc ?? null, hardPerHour: r.hardPerHour ?? null, impact: r.impact, blastRadiusNpus: r.blastRadiusNpus ?? null, confidence: r.confidence })),
    hardFitPerNpu: b.hardFitPerNpu, hardFitPerNpuTotal: b.hardFitPerNpuTotal, hardFitPerNpuOther: b.hardFitPerNpuOther, hardPerHour: b.hardPerHour, mtbiH: b.hardPerHour > 0 ? 1 / b.hardPerHour : null,
    aOp: t.operationalAvailability, delivered: t.deliveredGoodput,
    scaleOut: s.topology.scaleOut,
  };
}

/** every scale-out variant of a record at N NPUs */
export function bomOfVariants(record: TopologyRecord, npus: number): BomDesign[] {
  return record.variants.map((v) => bomDesign(record, v.id, npus));
}

export interface BomScaleCounts { counts: Counts; rows: { id: string; count: number }[]; hardFitPerNpuTotal: number; hardPerHour: number }
export interface BomDocument {
  generated: string;
  npus: number;
  sizes: number[];
  designs: BomDesign[];
  /** the main design of every record at the built-in scales (counts only) */
  scales: Record<string, Record<string, BomScaleCounts>>;
  /** the scale-out variants by family (id → { so, name, basis }) */
  scaleOutDesigns: Record<string, Record<string, { so: Scenario['topology']['scaleOut']; name: L; basis: L }>>;
}

/** the BOM document of several records: the shape of docs/backup/ascend-allocation/bom.json */
export function bomDocument(records: TopologyRecord[], npus: number, sizes: number[] = TOPOLOGY_SCALES): BomDocument {
  const designs = records.flatMap((r) => bomOfVariants(r, npus));
  // identity checks: same family and variant ⇒ same scale-out counts and parameters; FIT splits and row rates sum
  const SOKEYS = ['scaleOutPorts', 'scaleOutTiers', 'scaleOutSwitches', 'scaleOutLinks', 'scaleOutTransceivers'] as const;
  for (const a of designs) for (const b of designs) {
    if (a === b || a.family !== b.family || a.so !== b.so) continue;
    for (const k of SOKEYS) if (a.counts[k] !== b.counts[k]) throw new Error(`scale-out ${k} differs: ${a.id} vs ${b.id}`);
    if (a.counts.scaleOutPerTier.join() !== b.counts.scaleOutPerTier.join()) throw new Error(`scale-out tiers differ: ${a.id} vs ${b.id}`);
    if (JSON.stringify(a.scaleOut) !== JSON.stringify(b.scaleOut)) throw new Error(`scale-out parameters differ: ${a.id} vs ${b.id}`);
  }
  for (const d of designs) {
    const s = Object.values(d.hardFitPerNpu).reduce((a, v) => a + (v ?? 0), 0) + d.hardFitPerNpuOther;
    if (Math.abs(s - d.hardFitPerNpuTotal) > 1e-6 * s) throw new Error(`FIT split does not sum: ${d.id}`);
    if (d.counts.gpus !== npus) throw new Error(`NPU count ${d.id}`);
    const rate = d.rows.reduce((a, r) => a + (r.hardPerHour ?? 0), 0);
    if (Math.abs(rate - d.hardPerHour) > 1e-9) throw new Error(`job rate does not sum: ${d.id}`);
  }
  const scales: BomDocument['scales'] = {};
  for (const r of records) {
    scales[r.id] = {};
    for (const n of sizes) { const b = topologyBom(scenarioFromRecord(r, n)); scales[r.id][String(n)] = { counts: b.counts, rows: b.rows.map((x) => ({ id: x.id, count: x.count })), hardFitPerNpuTotal: b.hardFitPerNpuTotal, hardPerHour: b.hardPerHour }; }
  }
  const scaleOutDesigns: BomDocument['scaleOutDesigns'] = {};
  for (const r of records) {
    const fam = (scaleOutDesigns[r.family] ??= {});
    for (const v of r.variants) {
      const entry = { so: v.scaleOut, name: v.name, basis: v.basis };
      if (fam[v.id] && JSON.stringify(fam[v.id]) !== JSON.stringify(entry)) throw new Error(`family ${r.family}: variant '${v.id}' differs between its records`);
      fam[v.id] ??= entry;
    }
  }
  return { generated: new Date().toISOString(), npus, sizes, designs, scales, scaleOutDesigns };
}
