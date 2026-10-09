/** Reconcile the spreadsheet's own numbers with HAC-D's evaluation of the imported structure. */
import { indexResults, type EvaluationResult } from '@hac-d/core';
import { METHOD_DESCRIPTIONS } from './formula.js';
import type { DraftNode, MethodHit, MethodTag, TopologyDraft } from './types.js';
import { flattenDraft } from './topology.js';

export interface ReconcileRow {
  nodeId: string;
  name: string;
  kind: DraftNode['kind'];
  depth: number;
  /** cached spreadsheet value (null when the file has no cached values) */
  excel: number | null;
  /** HAC-D availability of the matching block */
  engine: number | undefined;
  delta: number | null;
  relDelta: number | null;
  method?: MethodTag;
  note: string;
}

export interface Reconciliation {
  rows: ReconcileRow[];
  maxAbsDelta: number;
  comparable: number;
  notes: string[];
}

const NOTE: Partial<Record<MethodTag, string>> = {
  series_rare_event_sum: 'spreadsheet uses 1 − ΣU (rare-event, optimistic); HAC-D uses the exact product',
  unavailability_lambda_mttr: 'spreadsheet uses U = λ·MTTR; HAC-D uses λ·MTTR/(1 + λ·MTTR)',
  switchover_weighted: 'spreadsheet weights the switchover statically; HAC-D models the failed switch as a down state cleared in T_sf (§11)',
  mttr_mixture_auto_manual: 'MTTR mixture: identical for series units, differs inside redundant groups (§10)',
  markov_mmult_minverse: 'spreadsheet solves a Markov chain in-sheet',
};

export function reconcile(draft: TopologyDraft, result: EvaluationResult, blockIds: Map<string, string>, hits: Map<string, MethodHit> = new Map()): Reconciliation {
  const byId = indexResults(result.structure.result);
  const rows: ReconcileRow[] = [];
  let maxAbs = 0;
  let comparable = 0;
  for (const { node, depth } of flattenDraft(draft.root)) {
    const blockId = blockIds.get(node.id);
    const engine = blockId ? byId.get(blockId)?.availability : undefined;
    const hit = node.availabilityCell ? hits.get(node.availabilityCell) : undefined;
    const excel = node.excelAvailability ?? null;
    const delta = excel !== null && engine !== undefined ? engine - excel : null;
    if (delta !== null) {
      comparable++;
      maxAbs = Math.max(maxAbs, Math.abs(delta));
    }
    const parts: string[] = [];
    if (hit) parts.push(METHOD_DESCRIPTIONS[hit.tag].en);
    if (hit && NOTE[hit.tag]) parts.push(NOTE[hit.tag]!);
    if (excel === null) parts.push('no cached value in the file (saved without calculation): compare after opening and saving in Excel');
    rows.push({ nodeId: node.id, name: node.name, kind: node.kind, depth, excel, engine, delta, relDelta: delta !== null && excel ? delta / (1 - excel || 1) : null, method: hit?.tag, note: parts.join('; ') });
  }
  const notes: string[] = [];
  if (!comparable) notes.push('the workbook carries no cached results; only the structure and parameters were imported');
  else notes.push(`${comparable} block(s) compared; largest |Δ availability| = ${maxAbs.toExponential(2)}`);
  return { rows, maxAbsDelta: maxAbs, comparable, notes };
}
