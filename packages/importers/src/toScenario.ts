/** TopologyDraft → HAC-D scenario (custom structure) with cell-level provenance. */
import { parseScenario, type Scenario, type ScenarioInput, type BlockInput } from '@hac-d/core';
import type { DraftNode, TopologyDraft } from './types.js';

export interface DraftToScenarioOptions {
  name?: string;
  workload?: ScenarioInput['workload'];
  recoveryPreset?: string;
}

export interface DraftConversion {
  scenario: Scenario;
  input: ScenarioInput;
  /** draft node id → block id in the evaluated structure */
  blockIds: Map<string, string>;
  notes: string[];
}

type ComponentInput = ScenarioInput['components'][number];

function slug(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'item';
}

/** failure rate (per hour) and the unit used, from whichever parameters the row carries */
function failureOf(n: DraftNode, notes: string[]): { value: number; unit: ComponentInput['failure']['unit']; derivation: string } | undefined {
  const p = n.params;
  if (p.lambdaPerH !== undefined && p.lambdaPerH > 0) return { value: p.lambdaPerH, unit: 'per_h', derivation: 'λ column' };
  if (p.fit !== undefined && p.fit > 0) return { value: p.fit, unit: 'FIT', derivation: 'FIT column' };
  if (p.mtbfH !== undefined && p.mtbfH > 0) return { value: p.mtbfH, unit: 'mtbf_h', derivation: 'MTBF column' };
  if (p.afrPct !== undefined && p.afrPct > 0) return { value: p.afrPct / 100, unit: 'per_year', derivation: 'AFR %/year ÷ 100' };
  if (p.availability !== undefined && p.availability > 0 && p.availability < 1) {
    const T = (p.mttrH ?? 0) > 0 ? p.mttrH! : 1;
    return { value: (1 - p.availability) / (p.availability * T), unit: 'per_h', derivation: (p.mttrH ?? 0) > 0 ? 'λ = (1 − A)/(A·MTTR) from the availability and MTTR cells' : 'availability only: λ = (1 − A)/A with a nominal 1 h repair' };
  }
  if (p.availability !== undefined && p.availability >= 1) return { value: 0, unit: 'per_h', derivation: 'availability 1 in the sheet' };
  notes.push(`${n.name}: no failure-rate information (λ, FIT, MTBF, AFR or A + MTTR); rate set to 0`);
  return undefined;
}

function repairOf(n: DraftNode, lambda: number | undefined, notes: string[]): ComponentInput['repair'] {
  const p = n.params;
  if (p.mttrAutoH !== undefined && p.mttrManualH !== undefined && p.autoFraction !== undefined) {
    return { auto: { coverage: p.autoFraction, successProbability: 1, mttrHours: p.mttrAutoH }, manual: { mttrHours: p.mttrManualH } };
  }
  if (p.mttrH !== undefined) return { mttrHours: p.mttrH };
  if (p.mttrManualH !== undefined) return { mttrHours: p.mttrManualH };
  if (p.availability !== undefined && p.availability > 0 && p.availability < 1) return { mttrHours: 1 };
  notes.push(`${n.name}: no repair time; 1 h assumed`);
  void lambda;
  return { mttrHours: 1 };
}

export function draftToScenario(draft: TopologyDraft, opts: DraftToScenarioOptions = {}): DraftConversion {
  const notes: string[] = [];
  const components: ComponentInput[] = [];
  const blockIds = new Map<string, string>();
  const usedIds = new Set<string>();
  const cellRef = (n: DraftNode) => `${draft.fileName}!${n.sheet}!row ${n.sourceRow + 1}`;

  const componentFor = (n: DraftNode, count: number): string => {
    let id = slug(n.name);
    if (usedIds.has(id)) id = `${id}_${n.sourceRow + 1}`;
    usedIds.add(id);
    const f = failureOf(n, notes);
    const lambdaPerH = f ? (f.unit === 'per_h' ? f.value : f.unit === 'FIT' ? f.value * 1e-9 : f.unit === 'mtbf_h' ? 1 / f.value : f.value / 8760) : undefined;
    components.push({
      id,
      name: { zh: n.name, en: n.name },
      subsystem: 'other',
      countRule: { per: 'fixed', count },
      failure: {
        value: f?.value ?? 0,
        unit: f?.unit ?? 'per_h',
        koujing: { event: 'failure_as_in_spreadsheet', denominator: 'unit_h', level: 'component' },
        provenance: { source: `spreadsheet ${cellRef(n)}`, confidence: 'derived', derivation: f?.derivation ?? 'no rate in the sheet' },
      },
      repair: repairOf(n, lambdaPerH, notes),
      ...(n.params.switchoverSuccess !== undefined && n.kind !== 'leaf' ? {} : {}),
    });
    return id;
  };

  const build = (n: DraftNode): BlockInput => {
    const switchover = n.params.switchoverSuccess !== undefined && n.params.switchoverSuccess < 1 ? { successProbability: n.params.switchoverSuccess } : undefined;
    if (n.children.length === 0) {
      if (n.kind === 'leaf' || n.n === undefined) {
        const componentId = componentFor(n, n.count);
        const id = n.id;
        blockIds.set(n.id, id !== componentId ? `${componentId}#${id}` : componentId);
        return { kind: 'component', id, componentId, count: n.count };
      }
      // homogeneous redundant group of n identical units
      const componentId = componentFor(n, n.n);
      const unit: BlockInput = { kind: 'component', id: `${n.id}:u`, componentId, count: 1 };
      blockIds.set(n.id, n.id);
      if (n.kind === 'standby') return { kind: 'standby', id: n.id, name: n.name, n: n.n, unit, standbyFactor: 0, switchover };
      return { kind: 'kofn', id: n.id, name: n.name, n: n.n, k: n.k ?? 1, unit, switchover };
    }
    blockIds.set(n.id, n.id);
    const children = n.children.map(build);
    if (n.count > 1) notes.push(`${n.name}: quantity ${n.count} on a group row ignored`);
    switch (n.kind) {
      case 'parallel':
        return { kind: 'parallel', id: n.id, name: n.name, children, switchover };
      case 'kofn':
        if (n.k !== undefined && children.length >= 1 && n.n !== undefined && children.length === 1) return { kind: 'kofn', id: n.id, name: n.name, n: n.n, k: n.k, unit: children[0], switchover };
        notes.push(`${n.name}: k-of-n over heterogeneous children approximated as series of children when k = n, parallel when k = 1`);
        return n.k === 1 ? { kind: 'parallel', id: n.id, name: n.name, children, switchover } : { kind: 'series', id: n.id, name: n.name, children };
      case 'standby':
        return children.length === 1 ? { kind: 'standby', id: n.id, name: n.name, n: n.n ?? 2, unit: children[0], standbyFactor: 0, switchover } : { kind: 'parallel', id: n.id, name: n.name, children, switchover };
      default:
        return { kind: 'series', id: n.id, name: n.name, children };
    }
  };

  const root = build(draft.root);
  if (!components.length) throw new Error('the draft has no component rows');
  const input: ScenarioInput = {
    meta: {
      id: `import-${slug(draft.fileName)}-${slug(draft.sheet)}`,
      name: opts.name ?? `${draft.fileName} / ${draft.sheet}`,
      basis: [`spreadsheet import: ${draft.fileName}!${draft.sheet}`],
      description: `Topology and parameters imported from a spreadsheet (${draft.notes.join('; ')})`,
    },
    components,
    structure: { mode: 'custom', root },
    workload: opts.workload ?? { type: 'inference', replicasRequired: 1, gpusPerReplica: 1, spareReplicas: 0 },
    recovery: { mode: 'preset', preset: opts.recoveryPreset ?? 'automated-probe-standby' },
    assumptions: ['imported structure: blocks exactly as the spreadsheet combines them; parameters as stated in the sheet'],
  };
  return { scenario: parseScenario(input), input, blockIds, notes };
}
