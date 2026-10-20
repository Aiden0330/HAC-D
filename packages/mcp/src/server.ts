#!/usr/bin/env -S node --import tsx
/**
 * HAC-D MCP server (stdio). Tools: list_examples, get_example, evaluate_scenario, compare_scenarios,
 * allocate_scenario, tornado_scenario, simulate_scenario, library_search, scenario_schema,
 * excel_method_report, import_excel_scenario, export_excel (v2), mechanism_library, mechanism_report, apply_mechanisms, simulate_ledger, plan_mechanisms (v3),
 * estimate_rate (v3.5), audit_mechanisms, allocation_study (v3.7: single-point benefit audit and cross-scale allocation study, each with an optional standalone HTML report),
 * topology_bom, allocation_strategy (v4: topology templates with per-unit fault types; optimal / MTTR-preferred / MTTF-preferred allocation).
 * Register in Claude Code with: claude mcp add hacd -- node --import tsx <repo>/packages/mcp/src/server.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { importSpreadsheet, methodReport, readWorkbook, exportWorkbook } from '@hac-d/importers';
import {
  EXAMPLES, parseScenario, evaluateScenario, compareScenarios, allocateScenario, tornadoForScenario, simulateScenario, scenarioJsonSchema, filterLibrary,
  mechanismReport, simulateScenarioLedger, MECHANISM_LIBRARY, DEFAULT_PLAYERS, activeMechanisms, applyMechanisms, planToTarget,
  type Library, type AllocationMethod, type TornadoMetric, type AttributionMetric,
  rateFromCounts, unitRateFromCounts, type LossBudgetMethod, type LedgerLossLine,
  auditMechanisms, auditReportHtml, allocationStudy, studyReportHtml, type StudyMetric, type ReportLang,
  GPU_EXAMPLES, REFERENCE_FIXTURES, TOPOLOGY_SCALES, resizeTopology, topologyScenario, topologyBom, bomAtSizes, TOPOLOGY_TEMPLATES, SUPERPOD_VARIANTS, applySuperpodVariant, computeCounts, allocateStrategy, strategyAcrossSizes, type TopologyTemplate,
} from '@hac-d/core';

const here = dirname(fileURLToPath(import.meta.url));
let library: Library | null = null;
const lib = () => (library ??= JSON.parse(readFileSync(join(here, '..', '..', 'core', 'data', 'library.json'), 'utf8')) as Library);

const server = new McpServer({ name: 'hac-d', version: '0.1.0' });
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : typeof x === 'function' ? undefined : x), 2) }] });
const scenarioArg = z.union([z.string(), z.record(z.string(), z.unknown())]).describe('Scenario JSON (object or string)');
const toScenario = (s: string | Record<string, unknown>) => parseScenario(typeof s === 'string' ? JSON.parse(s) : s);

server.registerTool('list_examples', { description: 'List the built-in NPU example scenarios: the four topology templates (A2 RoCE, A3 CloudMatrix384, Atlas 950, Atlas 960E) at 10,000 NPUs with the six default mechanisms; the scale is a parameter (get_example with npus: built-in 10k / 100k / 200k / 500k or any N). The reference fixtures (ref-catalog-100k, ref-three-classes-100k) and the v3.7 GPU examples (survey-ex1/3/4, nvl72-16k, ref-baseline-100k) stay reachable by id with get_example.' }, async () => text(Object.keys(EXAMPLES).map((id) => ({ id, name: EXAMPLES[id]().meta.name }))));

server.registerTool('get_example', { description: `Return an example scenario as JSON, ready to edit and evaluate; npus resizes it (every topology count follows the template geometry; built-in ${TOPOLOGY_SCALES.join(' / ')}).`, inputSchema: { id: z.string(), npus: z.number().int().positive().optional() } }, async ({ id, npus }) => {
  const f = EXAMPLES[id] ?? REFERENCE_FIXTURES[id] ?? GPU_EXAMPLES[id];
  if (!f) throw new Error(`unknown example '${id}'`);
  return text(npus ? resizeTopology(f(), npus) : f());
});

server.registerTool('scenario_schema', { description: 'JSON Schema of the scenario file (topology, components with 口径-typed rates and provenance, workload, recovery pipeline, spares, targets, costs).' }, async () => text(scenarioJsonSchema()));

server.registerTool(
  'evaluate_scenario',
  { description: 'Evaluate a scenario: availability, MTBF/MTBI, MTTR pipeline, goodput and loss terms with validity flags, scale extrapolation, spares, inference N+k, importance, cut sets, design-review checklist. Every KPI comes with its formula.', inputSchema: { scenario: scenarioArg } },
  async ({ scenario }) => text(evaluateScenario(toScenario(scenario))),
);

server.registerTool(
  'compare_scenarios',
  { description: 'Side-by-side KPIs for two or more scenarios with the best option per metric.', inputSchema: { scenarios: z.array(scenarioArg).min(2) } },
  async ({ scenarios }) => {
    const cmp = compareScenarios(scenarios.map(toScenario));
    return text({ rows: cmp.rows.map(({ result: _r, ...rest }) => rest), best: cmp.best });
  },
);

server.registerTool(
  'allocate_scenario',
  { description: 'Allocate a goodput and/or availability target to subsystem budgets: allowed interruption rate per component class (ARINC/AGREE/equal/feasibility/minimum-effort/cost-optimal), allowed time per recovery stage, availability split, and (training, delivered basis) the loss budget over the window ledger: (1 − target) split over the ledger lines proportionally / equally / by custom weights, allowed vs current per line with the levers that move each line.', inputSchema: { scenario: scenarioArg, goodputTarget: z.number().min(0).max(1).optional(), availabilityTarget: z.number().min(0).max(1).optional(), method: z.enum(['equal', 'arinc', 'agree', 'feasibility', 'minimum-effort', 'cost-optimal']).optional(), restartShare: z.number().min(0).max(1).optional(), basis: z.enum(['effective', 'delivered']).optional(), lossMethod: z.enum(['proportional', 'equal', 'custom']).optional(), lossWeights: z.record(z.string(), z.number().min(0)).optional() } },
  async ({ scenario, goodputTarget, availabilityTarget, method, restartShare, basis, lossMethod, lossWeights }) => text(allocateScenario(toScenario(scenario), { goodputTarget, availabilityTarget, method: method as AllocationMethod | undefined, restartShare, basis, lossMethod: lossMethod as LossBudgetMethod | undefined, lossWeights: lossWeights as Partial<Record<LedgerLossLine, number>> | undefined })),
);

server.registerTool(
  'tornado_scenario',
  { description: 'One-at-a-time sensitivity (×½ / ×2) of goodput, availability, lost $/day or MTBI to every component rate, the recovery time, checkpoint δ, hot spares and common-cause β.', inputSchema: { scenario: scenarioArg, metric: z.enum(['goodput', 'delivered', 'availability', 'lostDollarsPerDay', 'mtbiHours']).optional() } },
  async ({ scenario, metric }) => text(tornadoForScenario(toScenario(scenario), (metric as TornadoMetric | undefined) ?? 'goodput')),
);

server.registerTool(
  'simulate_scenario',
  { description: 'Monte Carlo discrete-event simulation of a training job (Weibull/lognormal lifetimes, lemon units, common cause, hot-spare pool, fail-slow) with the closed-form comparison. Keep replications ≤ 200 and workHours ≤ 720 for interactive use.', inputSchema: { scenario: scenarioArg, replications: z.number().int().min(1).max(2000).optional(), seed: z.number().optional(), workHours: z.number().positive().optional() } },
  async ({ scenario, replications, seed, workHours }) => {
    const r = simulateScenario(toScenario(scenario), { replications: replications ?? 50, seed: seed ?? 1, workHours });
    return text({ ...r, spec: undefined, summary: { ...r.summary, rows: undefined } });
  },
);

server.registerTool(
  'library_search',
  { description: 'Search the survey-sourced parameter library (531 records with 口径 and provenance): failure rates, MTTR stage times, SDC rates, spare ratios, checkpoint overheads.', inputSchema: { query: z.string().optional(), class: z.string().optional(), kind: z.string().optional(), confidence: z.string().optional(), stage: z.string().optional(), ratesOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() } },
  async ({ query, class: cls, kind, confidence, stage, ratesOnly, limit }) => text(filterLibrary(lib(), { query, class: cls, kind, confidence, stage, ratesOnly }).slice(0, limit ?? 50)),
);

server.registerTool(
  'excel_method_report',
  { description: 'Read an availability workbook (.xlsx/.xls/.csv path on disk) and report which calculation methods its formulas use (A = MTBF/(MTBF+MTTR), series product, rare-event sum, parallel complement, k-of-n COMBIN/BINOM.DIST, switchover weighting, MTTR auto/manual mixture, Markov MMULT/MINVERSE …) with cell addresses and column roles.', inputSchema: { path: z.string() } },
  async ({ path }) => text(methodReport(readWorkbook(new Uint8Array(readFileSync(path)), basename(path)))),
);

server.registerTool(
  'import_excel_scenario',
  { description: 'Extract the component topology (series / parallel / k-of-n groups, quantities, MTBF/MTTR/FIT/λ, switchover success, auto/manual MTTR) from a workbook on disk, convert it into a HAC-D scenario, evaluate it and reconcile with the sheet’s own cached values. Returns the method report, the topology draft with evidence, the scenario JSON and the reconciliation table.', inputSchema: { path: z.string(), sheet: z.string().optional() } },
  async ({ path, sheet }) => {
    const r = importSpreadsheet(new Uint8Array(readFileSync(path)), basename(path), { sheet });
    return text({ sheet: r.sheet, confidence: r.draft.confidence, notes: [...r.draft.notes, ...r.conversion.notes], methods: r.report.methods, columns: r.draft.columns, tree: r.draft.root, scenario: r.conversion.input, availability: r.result.system.availability, measures: r.result.system.measures, reconciliation: r.reconciliation });
  },
);

server.registerTool(
  'export_excel',
  { description: 'Write a scenario and its evaluation as an .xlsx workbook with live formulas (Inputs, Structure with per-block combination formulas next to HAC-D values, Results with original vs compensated measures and the waterfall, Formulas).', inputSchema: { scenario: scenarioArg, outPath: z.string() } },
  async ({ scenario, outPath }) => {
    const s = toScenario(scenario);
    const bytes = exportWorkbook(s, evaluateScenario(s));
    writeFileSync(outPath, bytes);
    return text({ path: outPath, bytes: bytes.byteLength, sheets: ['Inputs', 'Structure', 'Results', 'Formulas'] });
  },
);

server.registerTool(
  'mechanism_library',
  { description: 'The fault-management mechanism library (the reference catalog’s twelve mechanisms: detection of interruptions / sub-health / silent corruption, replay, process rescheduling, DP-domain elasticity, global checkpoint recovery, manual recovery, step recovery, faster checkpoints, physical protection and hardware reliability) with change, prerequisite, failure path, confidence and target parameters, and which of them are active in a scenario.', inputSchema: { scenario: scenarioArg.optional() } },
  async ({ scenario }) => text({ mechanisms: MECHANISM_LIBRARY.map((m) => ({ ...m, apply: undefined, hasTransform: !!m.apply })), defaultPlayers: DEFAULT_PLAYERS, active: scenario ? activeMechanisms(toScenario(scenario)) : undefined }),
);

server.registerTool(
  'mechanism_report',
  { description: 'Attribute the gain of fault-management mechanisms on a training scenario: strips the selected mechanisms (baseline), evaluates all 2^n coalitions with the closed forms (value = delivered goodput, effective goodput or A_op) and returns single gains, last-added gains and exact Shapley values. Players default to the reference’s six candidates; at most 12.', inputSchema: { scenario: scenarioArg, players: z.array(z.string()).max(12).optional(), metric: z.enum(['delivered', 'effective', 'aOp']).optional(), parameters: z.record(z.string(), z.record(z.string(), z.number())).optional() } },
  async ({ scenario, players, metric, parameters }) => text(mechanismReport(toScenario(scenario), players ?? DEFAULT_PLAYERS, { metric: (metric as AttributionMetric | undefined) ?? 'delivered', parameters })),
);

server.registerTool(
  'apply_mechanisms',
  { description: 'Return the scenario with the given mechanisms applied (their target parameters written into the scenario: silent-corruption detection, step recovery, replay / process / elastic chain, faster checkpoints, detection targets).', inputSchema: { scenario: scenarioArg, ids: z.array(z.string()), parameters: z.record(z.string(), z.record(z.string(), z.number())).optional() } },
  async ({ scenario, ids, parameters }) => text(applyMechanisms(toScenario(scenario), ids, parameters)),
);

server.registerTool(
  'simulate_ledger',
  { description: 'Finite-window ledger simulation of a training job with three fault classes (interruptions through the mechanism chain, sub-health with detection and isolation, silent corruption with immediate detection, fallback discovery, clean-checkpoint rollback and terminal discard): delivered goodput with CI and quantiles, A_op, P(≥ target), mean ledger, event counts, per-class attribution, compared with the closed form. Keep trials ≤ 1000 for interactive use.', inputSchema: { scenario: scenarioArg, trials: z.number().int().min(1).max(20000).optional(), seed: z.number().optional(), target: z.number().min(0).max(1).optional() } },
  async ({ scenario, trials, seed, target }) => {
    const r = simulateScenarioLedger(toScenario(scenario), { trials: trials ?? 200, seed: seed ?? 1, target });
    return text({ ...r, summary: { ...r.summary, values: undefined } });
  },
);

server.registerTool(
  'plan_mechanisms',
  { description: 'Choose the fault-management mechanisms that reach a goodput target: evaluates every coalition of the candidate mechanisms with the closed forms (nominal and with the mechanism parameters derated: coverage −5 pts, success −8 pts, times ×1.5), returns the cheapest feasible coalition by effort score, the necessary mechanisms, the effort–value Pareto front, a silent-corruption-coverage × recovery-time scan and an optional ledger-simulation verification of P(window ≥ target).', inputSchema: { scenario: scenarioArg, target: z.number().min(0).max(1).optional(), players: z.array(z.string()).max(10).optional(), metric: z.enum(['delivered', 'effective', 'aOp']).optional(), parameters: z.record(z.string(), z.record(z.string(), z.number())).optional(), effort: z.record(z.string(), z.number()).optional(), derate: z.boolean().optional(), scan: z.boolean().optional(), verifyTrials: z.number().int().min(0).max(5000).optional(), confidence: z.number().min(0).max(1).optional() } },
  async ({ scenario, target, players, metric, parameters, effort, derate, scan, verifyTrials, confidence }) => text(planToTarget(toScenario(scenario), { target, players, metric: metric as AttributionMetric | undefined, parameters, effort, derate: derate === false ? null : undefined, scan: scan ?? true, verify: verifyTrials ? { trials: verifyTrials, confidence } : undefined })),
);

server.registerTool(
  'estimate_rate',
  { description: 'Failure rate of a component class from incident counts: events over an exposure in unit-hours (or units × hours) → rate per unit-hour, FIT, MTBF with the exact Garwood confidence interval; zero events give the one-sided upper bound −ln(1 − c)/E. Counts must be de-duplicated business-impact events of one class; put the result into component.failure with provenance confidence "measured".', inputSchema: { events: z.number().int().min(0), exposureHours: z.number().positive().optional(), units: z.number().positive().optional(), hours: z.number().positive().optional(), confidence: z.number().min(0.5).max(0.9999).optional() } },
  async ({ events, exposureHours, units, hours, confidence }) => {
    if (exposureHours === undefined && (units === undefined || hours === undefined)) throw new Error('give exposureHours, or units and hours');
    return text(exposureHours !== undefined ? rateFromCounts(events, exposureHours, confidence) : unitRateFromCounts(events, units!, hours!, confidence));
  },
);

server.registerTool(
  'audit_mechanisms',
  { description: 'v3.7 single-point benefit audit (单点收益审核) of selected mechanisms on a scenario: one applicable, successfully handled event (or one stage) per mechanism against the scenario\'s baseline (detection + automatic attempt + mean rollback; the audit\'s 342.5 s path on the reference catalog), with the mechanism\'s principle, trigger, workflow, overlap rules and integration fields (eligible share, conditional success, failure seconds, overhead; null until measured). `provisional` fills the null fields with the provisional assumptions (tagged assumed). Cluster-level deltas (A_op, delivered, effective) are added for mechanisms whose transform can act. `htmlPath` writes the standalone HTML report (zh or en).', inputSchema: { scenario: scenarioArg, mechanisms: z.array(z.string()).optional().describe('mechanism ids (default: all 35 library mechanisms)'), provisional: z.boolean().optional(), parameters: z.record(z.string(), z.record(z.string(), z.number())).optional(), htmlPath: z.string().optional(), lang: z.enum(['zh', 'en']).optional() } },
  async ({ scenario, mechanisms, provisional, parameters, htmlPath, lang }) => {
    const rep = auditMechanisms(toScenario(scenario), { ids: mechanisms, provisional, parameters });
    if (htmlPath) writeFileSync(htmlPath, auditReportHtml(rep, (lang as ReportLang | undefined) ?? 'zh'));
    return text(htmlPath ? { ...rep, htmlPath } : rep);
  },
);

server.registerTool(
  'allocation_study',
  { description: 'v3.7 cross-scale allocation study: for each cluster size the hardware-only and recovery-only budgets (uniform factors, ARINC and minimum-effort class allocation, stage budgets), the cheapest feasible mechanism set (exact ≤ 10 candidates, greedy beyond), Shapley attribution (exact ≤ 12, sampled beyond), the residual loss by domain group, recovery levers beyond the library, a window-ledger verification (P(window ≥ target), Wilson) and metric-vs-N curves with the largest size each set supports. Metric A_op (default), delivered or effective goodput. `htmlPath` writes the standalone HTML report with three charts; `summary` returns only the per-size summary.', inputSchema: { scenario: scenarioArg, sizes: z.array(z.number()).optional(), target: z.number().optional(), metric: z.enum(['aOp', 'delivered', 'effective']).optional(), players: z.array(z.string()).optional(), provisional: z.boolean().optional(), parameters: z.record(z.string(), z.record(z.string(), z.number())).optional(), trials: z.number().int().nonnegative().optional(), seed: z.number().optional(), derate: z.boolean().optional(), levers: z.boolean().optional(), curves: z.boolean().optional(), htmlPath: z.string().optional(), lang: z.enum(['zh', 'en']).optional(), summary: z.boolean().optional() } },
  async ({ scenario, sizes, target, metric, players, provisional, parameters, trials, seed, derate, levers, curves, htmlPath, lang, summary }) => {
    const r = allocationStudy(toScenario(scenario), { sizes, target, metric: metric as StudyMetric | undefined, players, provisional, parameters, trials, seed, derate: derate === false ? null : undefined, levers, curves });
    if (htmlPath) writeFileSync(htmlPath, studyReportHtml(r, (lang as ReportLang | undefined) ?? 'zh'));
    if (summary) return text({ target: r.target, metric: r.metric, players: r.players, htmlPath, sizes: r.sizes.map((N) => { const z = r.perSize[N]; return { N, baseline: z.baseline.value, hardwareFactor: z.hardwareOnly.factor, recoveryStarS: z.recoveryOnly.recoveryStarS, plan: z.plan, residualFactor: z.residualFactor, verification: z.verification, shapley: Object.fromEntries(z.gains.map((g) => [g.id, g.byMetric[r.metric].shapley])), residualByGroup: z.planned.byGroup }; }), maxN: Object.fromEntries(Object.entries(r.curves).map(([k, c]) => [k, c.maxN])), notes: r.notes });
    return text(htmlPath ? { ...r, htmlPath } : r);
  },
);

server.registerTool(
  'topology_bom',
  { description: 'v4 topology template → hardware bill of materials and scenario: template a2-roce (Atlas 800T A2 servers, RoCE Clos), a3-ub384 (CloudMatrix384 UB supernode, paper geometry) a950-ub2 (Atlas 950 SuperPoD to the product-page spec: 16 + 4 cabinets, 1,024 NPUs, cabinet 2D full mesh with 72 LRS plus a one-tier optical Clos of UB switches; `variant` a950-8k = the 8,192-NPU roadmap pod, a950-4d = the UB-Mesh paper 4D mesh, a950-2l = the v4.1 CloudMatrix384 two-level copy, a950-1k = the default) or a960e-ub (Atlas 960E: 56 + 14 cabinets of 72 NPUs, NPO optics, LinkDevice blade Clos, four-plane two-tier scale-out; single media source for the cabinet split); unit counts at the given sizes (default the built-in 10k / 100k / 200k / 500k NPUs); fault types per hardware unit from the 54-event catalog converted under the CloudMatrix384 geometry (FIT per unit = FIT per card × cards per unit), interruption FIT per NPU by unit. `counts` (v4.3) = user counts per bill-of-materials row id, whole numbers at `npus` (node, cpu, cabinet, pod, commCabinet, ubL1, ubL2, ubRackSwitch, ubPodSwitch, ubMeshLink, ubRackMesh, npoEngine, backupNpu, ubLink, ubTransceiver, rocePort, roceTier1…, roceLink, roceTransceiver), each replacing that one count and kept as a per-NPU ratio at the other sizes; ids that do not apply are reported in countOverrides.ignored. `scenario: true` also returns the scenario (six ReMAP default mechanisms applied).', inputSchema: { template: z.enum(['a2-roce', 'a3-ub384', 'a950-ub2', 'a960e-ub']), variant: z.enum(['a950-1k', 'a950-8k', 'a950-4d', 'a950-2l']).optional(), counts: z.record(z.string(), z.number().int().nonnegative()).optional(), npus: z.number().optional(), sizes: z.array(z.number()).optional(), scaleOut: z.boolean().optional(), fabricFill: z.enum(['proportional', 'full-pod']).optional(), radix: z.number().optional(), fit: z.record(z.string(), z.number()).optional(), mechanisms: z.array(z.string()).optional(), scenario: z.boolean().optional() } },
  async ({ template, variant, counts, npus, sizes, scaleOut, fabricFill, radix, fit, mechanisms, scenario }) => {
    const base = TOPOLOGY_TEMPLATES[template as TopologyTemplate].topology;
    if (variant && !SUPERPOD_VARIANTS[template as TopologyTemplate]?.some((v) => v.id === variant)) throw new Error(`variant ${variant} does not belong to template ${template}`);
    const s0 = topologyScenario(template as TopologyTemplate, npus ?? 10000, { scaleOut, fit, mechanisms, topology: { ...(fabricFill ? { fabricFill } : {}), ...(radix && base.scaleOut ? { scaleOut: { ...base.scaleOut, radix } as never } : {}) } });
    const s1 = variant ? applySuperpodVariant(s0, variant) : s0;
    // v4.3 user counts per bill-of-materials row, entered at `npus` and scaled with N at the other sizes
    const k1 = computeCounts(s1);
    const s = counts && Object.keys(counts).length ? { ...s1, topology: { ...s1.topology, countOverrides: Object.fromEntries(Object.entries(counts).map(([id, v]) => [id, { count: v, npus: k1.gpus, ...(/^roceTier\d+$/.test(id) ? { tiers: k1.scaleOutTiers } : {}) }])) } } : s1;
    const at = bomAtSizes(s, sizes);
    return text({ template: TOPOLOGY_TEMPLATES[template as TopologyTemplate], bom: topologyBom(s), sizes: at.map((x) => ({ npus: x.npus, counts: x.bom.counts, hardFitPerNpu: x.bom.hardFitPerNpu, hardFitPerNpuOther: x.bom.hardFitPerNpuOther, hardFitPerNpuTotal: x.bom.hardFitPerNpuTotal, hardPerHour: x.bom.hardPerHour, countOverrides: x.bom.countOverrides })), ...(scenario ? { scenario: s } : {}) });
  },
);

server.registerTool(
  'allocation_strategy',
  { description: 'v4 allocation strategies: reach an A_op or delivered-goodput target (nominal and derated) with mechanisms from the library, recovery levers moved to limits (automatic attempt, automatic success, manual time) and hardware: the interruption FIT of each class × x_i ∈ [floor_i, 1], effort e_i·log2(1/x_i). strategy optimal (least total effort), mttr-first (recovery side first, remaining gap to hardware) or mttf-first (hardware to the floors first, mechanisms only for the rest); hardware split min-effort, agree or arinc. Floors / effort per halving from component.allocation (minLambdaFactor, effortPerHalving, fixed). `sizes` runs the strategy at several cluster sizes. Pass a scenario or a topology template (with `variant` for the Atlas 950 SuperPoD).', inputSchema: { scenario: scenarioArg.optional(), template: z.enum(['a2-roce', 'a3-ub384', 'a950-ub2', 'a960e-ub']).optional(), variant: z.enum(['a950-1k', 'a950-8k', 'a950-4d', 'a950-2l']).optional(), npus: z.number().optional(), strategy: z.enum(['optimal', 'mttr-first', 'mttf-first']), target: z.number(), metric: z.enum(['aOp', 'delivered']).optional(), split: z.enum(['min-effort', 'agree', 'arinc']).optional(), candidates: z.array(z.string()).optional(), levers: z.boolean().optional(), derate: z.boolean().optional(), trials: z.number().int().nonnegative().optional(), sizes: z.array(z.number()).optional(), includeScenario: z.boolean().optional() } },
  async ({ scenario, template, variant, npus, strategy, target, metric, split, candidates, levers, derate, trials, sizes, includeScenario }) => {
    if (!scenario && !template) throw new Error('pass a scenario or a template');
    if (variant && !(template && SUPERPOD_VARIANTS[template as TopologyTemplate]?.some((v) => v.id === variant))) throw new Error(`variant ${variant} needs template a950-ub2`);
    const t0 = template ? topologyScenario(template as TopologyTemplate, npus ?? 10000) : undefined;
    const s = scenario ? toScenario(scenario) : variant ? applySuperpodVariant(t0!, variant) : t0!;
    const opts = { strategy, target, metric, hardwareSplit: split, candidates, levers: levers === false ? (false as const) : undefined, derate: derate === false ? null : undefined, verify: trials ? { trials } : undefined };
    if (sizes?.length) return text(strategyAcrossSizes(s, sizes, opts));
    const { scenario: finalScenario, ...r } = allocateStrategy(s, opts);
    return text(includeScenario ? { ...r, scenario: finalScenario } : r);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
