/**
 * v6.3 the Findings report of one scenario — the web app's Allocation › Report tab: the same pipeline as `hacd findings` (the
 * hierarchical budget with the window rule at every scale, the mechanism Shapley study, the mechanism hierarchy) on a project
 * instead of a topology record, so that the page and the CLI produce the same report in the same 口径 (packages/core/test/report_v63:
 * a record's scenario gives the record's numbers). The scenario at another size is `withSize` (the template geometry follows N,
 * count overrides scale with N); the reference set is the project's applied mechanisms (the budget's "today"); the candidates are the
 * report preset's (the default set's candidates that are appliable, not applied in the project and ready with the set's parameters,
 * as the Allocation page's "Report settings"). Output: the sidecar objects the recipes read (results, mechanisms, studies, records),
 * rendered by @hac-d/reports findingsHtml / methodologyHtml and re-rendered by `hacd findings --data <bundle.json>`.
 * 口径: unchanged from the budget (A_op of one synchronous job per cluster-hour, formula 1; P over 30-day windows, formula 6;
 * Shapley values on the bare scenario).
 */
import type { Scenario } from '../scenario/schema.js';
import { withSize } from '../study/index.js';
import { budgetDocument, type BudgetDocument } from './index.js';
import { variantSummary } from './variants.js';
import { studyOfBuild, type ArchStudy } from '../study/archStudy.js';
import { mechanismHierarchy, type MechanismHierarchy, type StoredStudy } from '../study/hierarchy.js';
import { DEFAULT_MECHANISM_SET, resolveMechanismSet, type MechanismSet } from '../records/mechanismSet.js';
import { MECHANISM_LIBRARY, applyMechanisms, stripMechanisms } from '../mechanisms/index.js';
import { integrationStatus } from '../mechanisms/auditLibrary.js';
import { TOPOLOGY_TEMPLATES } from '../topology/index.js';
import { minWindowTrials } from '../math/stats.js';
import type { LayerModelSpec } from '../layers/index.js';
import type { BudgetMetric } from './kpiForm.js';

type L = { zh: string; en: string };

export interface ScenarioReportOptions {
  /** id of the architecture in the sidecar (the project id); the Findings file name follows it */
  id: string;
  name: L;
  short: L;
  /** chip family for the report headers (default: the template's name) */
  family?: string;
  assumed?: (string | L)[];
  /** the scales of the report (the project's own size, optionally the built-in four); `main` = the headline scale (default the largest) */
  sizes: number[];
  main?: number;
  target: number;
  /** v5.6 the acceptance metric (default the effective goodput) */
  metric?: BudgetMetric;
  trials?: number;
  seed?: number;
  permutations?: number;
  /** the mechanism set (default the default set: its candidates, parameters, efforts, levers and derating) */
  set?: MechanismSet;
  /**
   * v5.11 the appendix variants (Appendix A of the Findings page, `hacd findings --variants`): for each variant set the budget of the
   * project's design with the set's change — the mechanisms its baseline adds to / removes from the report set's baseline, e.g.
   * C-YOUNG added, C-MEM in place of C-FAST — under the same metric, target, scales, windows, seed, split and derating, with the
   * variant set's candidates, parameters, efforts, levers and derating; no Shapley study. `results.variants` carries the rows
   * (`variantSummary`); Tables 1–6 never read them. A variant equal to the report set is refused.
   */
  variants?: MechanismSet[];
  onProgress?: (stage: 'study' | 'budget' | 'hierarchy' | 'variant', n: number, detail: string) => void;
}
/** the record-shaped geometry the Findings recipe draws Figures 1 and 2 from (`record` of findingsHtml; records.json of the sidecar) */
export interface ReportRecord {
  id: string; name: L; short: L; family: string;
  template?: Scenario['topology']['template'];
  superpod?: Scenario['topology']['superpod'];
  scaleOut?: Scenario['topology']['scaleOut'];
  layers: LayerModelSpec;
  assumed: (string | L)[];
}
export interface ScenarioReport {
  results: BudgetDocument;
  mechanisms: MechanismHierarchy;
  studies: Record<string, ArchStudy>;
  records: Record<string, ReportRecord>;
}

/** the candidates of the report preset for a scenario: the set's candidates that are appliable, not applied in the scenario and ready with the set's parameters */
/**
 * v5.11 the reference set of a variant on a project: the project's design (its applied mechanisms, in their order) without the
 * mechanisms the variant's baseline drops from the report set's baseline, plus the ones it adds (appended, applied after the
 * design's own). The record path applies the variant's whole baseline instead (`budgetFromRecords`); on the default set's own
 * design both give the same list.
 */
export function variantReference(reference: readonly string[], setBaseline: readonly string[], variantBaseline: readonly string[]): string[] {
  const added = variantBaseline.filter((id) => !setBaseline.includes(id)), removed = setBaseline.filter((id) => !variantBaseline.includes(id));
  return [...reference.filter((id) => !removed.includes(id)), ...added.filter((id) => !reference.includes(id))];
}

export function reportCandidates(s: Scenario, set: MechanismSet = DEFAULT_MECHANISM_SET): string[] {
  const r = resolveMechanismSet(set);
  return r.candidates.filter((id) => {
    const m = MECHANISM_LIBRARY.find((x) => x.id === id);
    return !!m && !!m.apply && m.status !== 'informational' && !s.mechanisms.applied?.[id] && (!m.integrationNeeds?.length || integrationStatus(m, { ...m.parameters, ...(r.parameters[id] ?? {}) }).ready);
  });
}

/**
 * The layer instance rule of a scenario (what a topology record states in `layers`): the SuperPoD instance is one supernode of
 * the UB domain's NPUs, or one node when the UB domain is a node or smaller (Atlas 800T A3); cabinet = nodes × NPUs per node, node
 * = NPUs per node. Needs a SuperPoD geometry.
 */
export function reportLayerSpec(s: Scenario): LayerModelSpec {
  const sp = s.topology.superpod;
  if (!sp) throw new Error('the Findings report needs a SuperPoD geometry (A3, Atlas 950, Atlas 960E or the generic UB template): the layer model and Figure 1 are drawn from it');
  const pod = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
  const domain = s.topology.nvlinkDomainGpus ?? pod;
  const server = domain <= sp.npusPerNode;
  return { superpod: server ? { unit: 'nodes', npus: sp.npusPerNode } : { unit: 'supernodes', npus: domain }, cabinet: { npus: sp.npusPerNode * sp.nodesPerRack }, node: { npus: sp.npusPerNode } };
}

/** the Findings sidecar of one scenario (see the header): results (budgetDocument), the mechanism hierarchy, the study and the record geometry */
export function reportFromScenario(s: Scenario, o: ScenarioReportOptions): ScenarioReport {
  if (s.workload.type !== 'training') throw new Error('the Findings report needs a training workload');
  const layerSpec = reportLayerSpec(s);
  const set = o.set ?? DEFAULT_MECHANISM_SET, r = resolveMechanismSet(set);
  const sizes = o.sizes.length ? [...o.sizes] : [s.workload.nGpus];
  const main = o.main ?? sizes[sizes.length - 1];
  if (!sizes.includes(main)) throw new Error(`main ${main} is not one of the sizes ${sizes.join(', ')}`);
  const trials = o.trials ?? 400, seed = o.seed ?? 1, permutations = o.permutations ?? 300;
  if (trials < minWindowTrials()) throw new Error(`the Findings report needs at least ${minWindowTrials()} windows: with fewer, P(A_op ≥ A*) ≥ 0.9 per window can never be supported (Wilson 95 % lower bound n/(n + z²), formula 6) and the window rule has no design to recommend; got ${trials}`);
  const build = (n: number) => withSize(s, n);
  // the reference set is the project's applied mechanisms with the parameters they were applied with (a project may have set
  // them on the Mechanism library page): the budget rebuilds the design from them, the candidates take the set's parameters;
  // v5.5 the Shapley study evaluates the same players with the same merged parameters (fifth review D8), so one report has one
  // parameter set; a project mechanism outside the set stays in the study's base and is listed as fixed
  const applied = Object.entries(s.mechanisms.applied ?? {});
  const reference = applied.map(([id]) => id);
  const parameters = { ...r.parameters, ...Object.fromEntries(applied.map(([id, rec]) => [id, { ...(r.parameters[id] ?? {}), ...rec.parameters }])) };
  const candidates = reportCandidates(s, set);
  const family = o.family ?? (s.topology.template ? TOPOLOGY_TEMPLATES[s.topology.template].name.en : 'custom');
  const assumed = o.assumed ?? [];
  const study = studyOfBuild(o.id, build, set, { sizes, target: o.target, permutations, seed, parameters, onProgress: (n, i, k) => o.onProgress?.('study', n, `${i} / ${k}`) });
  const results = budgetDocument(
    { [o.id]: { name: o.name, short: o.short, family, assumed, build, layerSpec } },
    { sizes, target: o.target, metric: o.metric, main, trials, seed, candidates, parameters, efforts: set.efforts, levers: r.levers, reference, derate: r.derate, onProgress: (_arch, n, step) => o.onProgress?.('budget', n, step) },
  );
  if (o.variants?.length) {
    results.variants = o.variants.map((V) => {
      if (V.id === set.id) throw new Error(`variant ${V.id} is the report's own set`);
      const rv = resolveMechanismSet(V);
      // the variant's change against the report set's baseline, applied to the project's design: the dropped mechanisms stripped
      // (their recorded previous values restored), the added ones applied after the design's own with the variant set's parameters
      const added = rv.baseline.filter((id) => !r.baseline.includes(id) && !reference.includes(id)), removed = r.baseline.filter((id) => !rv.baseline.includes(id) && reference.includes(id));
      const vReference = variantReference(reference, r.baseline, rv.baseline);
      const vBuild = (n: number) => applyMechanisms(stripMechanisms(build(n), removed), added, rv.parameters);
      // the set's parameters, the project's applied parameters kept for the mechanisms that stay in the design
      const vParameters = { ...rv.parameters, ...Object.fromEntries(applied.filter(([id]) => vReference.includes(id)).map(([id, rec]) => [id, { ...(rv.parameters[id] ?? {}), ...rec.parameters }])) };
      const vCandidates = reportCandidates(s, V).filter((id) => !vReference.includes(id));
      const vd = budgetDocument(
        { [o.id]: { name: o.name, short: o.short, family, assumed, build: vBuild, layerSpec } },
        { sizes, target: o.target, metric: o.metric, main, trials, seed, candidates: vCandidates, parameters: vParameters, efforts: V.efforts, levers: rv.levers, reference: vReference, derate: rv.derate, onProgress: (_arch, n, step) => o.onProgress?.('variant', n, `${V.id} · ${step}`) },
      );
      return variantSummary(results, V, vd);
    });
  }
  o.onProgress?.('hierarchy', main, '');
  const custom = Object.keys(study.projectParameters ?? {});
  const h = mechanismHierarchy(set, { [o.id]: study as unknown as StoredStudy }, { permutations, basis: `bare project scenario ${o.id}, the project's per-unit FIT, ${set.id}${custom.length ? `, the project's parameters for ${custom.join(' + ')}` : ''}${study.fixed?.length ? `; fixed in the base (outside the set): ${study.fixed.join(' + ')}` : ''}`, check: false });
  const mechanisms = { ...h, source: { dir: 'in-memory', ...h.source } };
  const records: Record<string, ReportRecord> = { [o.id]: { id: o.id, name: o.name, short: o.short, family, template: s.topology.template, superpod: s.topology.superpod, scaleOut: s.topology.scaleOut, layers: layerSpec, assumed } };
  return { results, mechanisms, studies: { [o.id]: study }, records };
}
