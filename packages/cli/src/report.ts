/**
 * v6.4 the Findings report of one project (scenario) written to a folder — what the web app's Allocation › Report tab does, on
 * the CLI (`hacd scenario report`) and the MCP server (`scenario_report`): `reportFromScenario` (@hac-d/core: the budget with the
 * window rule at every scale, the Shapley study, the mechanism hierarchy), the Findings and Methodology pages rendered with the
 * report recipes, the sidecar JSON (`data/`: results, mechanisms, provenance, records, the study) and the bundle
 * `<id>-findings-data.json` that `hacd findings --data` re-renders. No argv, no exit: the callers print and exit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reportFromScenario, DEFAULT_MECHANISM_SET, type Scenario, type ScenarioReport } from '@hac-d/core';
import { findingsHtml, methodologyHtml, FINDINGS_FILES, type ReportProvenance } from '@hac-d/reports';
import { engine } from './pipeline.js';

export interface ScenarioReportOptions {
  /** id of the architecture in the sidecar and the file name (default the project's id, else its name) */
  id?: string;
  name?: string;
  outDir: string;
  sizes?: number[];
  main?: number;
  target?: number;
  trials?: number;
  seed?: number;
  permutations?: number;
  /** the command line the footer names as the way to reproduce */
  command: string;
  onProgress?: (message: string) => void;
}
export interface KpiRow {
  scale: number;
  today: { aOp: number; aOpDerated: number; mtbfHwH: number | null; mttrS: number; pWindow: number; verdict: string };
  /** formula (2); `reachable` false (B ≤ 0): the other event classes and φ take the whole budget, the two ends are null */
  required: { B: number; reachable: boolean; mtbfAtTodayMttrH: number | null; mttrAtTodayMtbfS: number | null; F: number; phi: number; totalBudget: number };
  recommended: { mechanisms: string[]; levers: string[]; k: number; binding: string; escalated: boolean; aOp: number; aOpDerated: number; mtbfHwH: number | null; mttrS: number; pWindow: number; verdict: string };
}
export interface ScenarioReportManifest {
  status: 'ok';
  id: string;
  name: string;
  npus: number;
  sizes: number[];
  main: number;
  target: number;
  trials: number;
  permutations: number;
  seed: number;
  files: { dir: string; findings: string; methodology: string; bundle: string; data: string };
  kpi: KpiRow[];
  koujing: string;
  seconds: number;
}

const safeId = (s: string) => s.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();

/** render and write the report set of a scenario; returns the manifest (`--json` of `hacd scenario report`) */
export function renderScenarioReport(s: Scenario, o: ScenarioReportOptions): ScenarioReportManifest {
  const t0 = Date.now();
  if (s.workload.type !== 'training') throw new Error('the Findings report needs a training workload');
  const id = safeId(o.id ?? s.meta.id ?? s.meta.name);
  const name = o.name ?? s.meta.name;
  const N = s.workload.nGpus;
  const sizes = o.sizes?.length ? [...new Set(o.sizes)].sort((a, b) => a - b) : [N];
  const main = o.main ?? (sizes.includes(N) ? N : sizes[sizes.length - 1]);
  if (!sizes.includes(main)) throw new Error(`main ${main} is not one of the sizes ${sizes.join(', ')}`);
  const target = o.target ?? s.targets.operational ?? 0.985, trials = o.trials ?? 400, seed = o.seed ?? 1, permutations = o.permutations ?? 300;
  const bil = { zh: name, en: name };
  const r: ScenarioReport = reportFromScenario(s, { id, name: bil, short: bil, sizes, main, target, trials, seed, permutations, onProgress: (stage, n, d) => o.onProgress?.(`${stage} ${n.toLocaleString('en-US')} ${d}`.trim()) });
  const set = DEFAULT_MECHANISM_SET;
  const provenance: ReportProvenance = { command: o.command, records: [{ id, name: bil }], set: { id: set.id, source: set.source }, options: { scales: sizes, target, trials, seed, permutations }, engine: engine() };
  const asFile = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v));
  const R = asFile(r.results), MX = asFile(r.mechanisms), study = asFile(r.studies[id]), record = asFile(r.records[id]);
  o.onProgress?.('render');
  const findings = findingsHtml(id, { results: R, mechanisms: MX, shapley: study, record, provenance });
  const methodology = methodologyHtml({ results: R, mechanisms: MX, provenance });
  const dir = resolve(o.outDir), data = join(dir, 'data');
  mkdirSync(data, { recursive: true });
  const suffix = (FINDINGS_FILES as Record<string, string>)[id] ?? id.toUpperCase();
  const files = { dir, findings: join(dir, `ASCEND_ALLOCATION_FINDINGS_${suffix}.html`), methodology: join(dir, 'ASCEND_ALLOCATION_METHODOLOGY.html'), bundle: join(dir, `${id}-findings-data.json`), data };
  writeFileSync(files.findings, findings);
  writeFileSync(files.methodology, methodology);
  const w = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1));
  w(join(data, 'results.json'), r.results);
  w(join(data, 'mechanisms.json'), r.mechanisms);
  w(join(data, 'provenance.json'), provenance);
  w(join(data, 'records.json'), r.records);
  w(join(data, `${id}.json`), r.studies[id]);
  w(files.bundle, { results: r.results, mechanisms: r.mechanisms, provenance, studies: r.studies, records: r.records });
  const A = r.results.archs[id];
  const kpi: KpiRow[] = sizes.map((n) => {
    const z = A.sizes[String(n)], rec = z.recommended, f = rec.final;
    return {
      scale: n,
      today: { aOp: z.today.aOp, aOpDerated: z.today.aOpDerated, mtbfHwH: z.today.kpiDerated.mtbfHwH, mttrS: z.today.kpiDerated.mttrS, pWindow: z.today.window.pAtLeastTarget, verdict: z.today.window.verdict },
      required: { B: z.required.B, reachable: z.required.reachable, mtbfAtTodayMttrH: z.required.mtbfAtTodayMttrH, mttrAtTodayMtbfS: z.required.mttrAtTodayMtbfS, F: z.today.kpiDerated.F, phi: z.today.kpiDerated.phi, totalBudget: z.required.totalBudget },
      recommended: { mechanisms: rec.mechanisms, levers: rec.levers, k: rec.k, binding: rec.binding, escalated: rec.escalated, aOp: f.kpi.aOp, aOpDerated: f.kpiDerated.aOp, mtbfHwH: f.kpiDerated.mtbfHwH, mttrS: f.kpiDerated.mttrS, pWindow: rec.window.pAtLeastTarget, verdict: rec.window.verdict },
    };
  });
  return {
    status: 'ok', id, name, npus: N, sizes, main, target, trials, permutations, seed, files, kpi,
    koujing: 'A_op of one synchronous job per cluster-hour (formula 1), nominal and derated; MTBF_hw and MTTR_hw of the derated design; P = share of 30-day windows with A_op ≥ target (formula 6); recommended = added mechanisms | recovery levers · uniform hardware factor k (k < 1 a delivery task) and the binding side',
    seconds: (Date.now() - t0) / 1000,
  };
}
