#!/usr/bin/env -S node --import tsx
/**
 * HAC-D MCP server (stdio). Tools: list_examples, get_example, evaluate_scenario, compare_scenarios,
 * allocate_scenario, tornado_scenario, simulate_scenario, library_search, scenario_schema,
 * excel_method_report, import_excel_scenario, export_excel (v2), mechanism_library, mechanism_report, simulate_ledger (v3).
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
  mechanismReport, simulateScenarioLedger, MECHANISM_LIBRARY, DEFAULT_PLAYERS, activeMechanisms, applyMechanisms,
  type Library, type AllocationMethod, type TornadoMetric, type AttributionMetric,
} from '@hac-d/core';

const here = dirname(fileURLToPath(import.meta.url));
let library: Library | null = null;
const lib = () => (library ??= JSON.parse(readFileSync(join(here, '..', '..', 'core', 'data', 'library.json'), 'utf8')) as Library);

const server = new McpServer({ name: 'hac-d', version: '0.1.0' });
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : typeof x === 'function' ? undefined : x), 2) }] });
const scenarioArg = z.union([z.string(), z.record(z.string(), z.unknown())]).describe('Scenario JSON (object or string)');
const toScenario = (s: string | Record<string, unknown>) => parseScenario(typeof s === 'string' ? JSON.parse(s) : s);

server.registerTool('list_examples', { description: 'List the built-in example scenarios (survey worked examples and an NVL72 design).' }, async () => text(Object.keys(EXAMPLES).map((id) => ({ id, name: EXAMPLES[id]().meta.name }))));

server.registerTool('get_example', { description: 'Return an example scenario as JSON, ready to edit and evaluate.', inputSchema: { id: z.string() } }, async ({ id }) => {
  const f = EXAMPLES[id];
  if (!f) throw new Error(`unknown example '${id}'`);
  return text(f());
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
  { description: 'Allocate a goodput and/or availability target to subsystem budgets: allowed interruption rate per component class (ARINC/AGREE/equal/feasibility/minimum-effort/cost-optimal), allowed time per recovery stage, availability split.', inputSchema: { scenario: scenarioArg, goodputTarget: z.number().min(0).max(1).optional(), availabilityTarget: z.number().min(0).max(1).optional(), method: z.enum(['equal', 'arinc', 'agree', 'feasibility', 'minimum-effort', 'cost-optimal']).optional(), restartShare: z.number().min(0).max(1).optional() } },
  async ({ scenario, goodputTarget, availabilityTarget, method, restartShare }) => text(allocateScenario(toScenario(scenario), { goodputTarget, availabilityTarget, method: method as AllocationMethod | undefined, restartShare })),
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

const transport = new StdioServerTransport();
await server.connect(transport);
