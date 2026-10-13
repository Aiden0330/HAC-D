#!/usr/bin/env -S node --import tsx
/**
 * hacd — command-line access to the HAC-D core.
 *   hacd examples                                   list example scenarios
 *   hacd example <id>                               print an example scenario as JSON
 *   hacd eval <scenario.json> [--json]              evaluate a scenario (table or JSON)
 *   hacd compare <a.json> <b.json> ... [--json]     side-by-side KPIs
 *   hacd allocate <scenario.json> [--goodput 0.97] [--availability 0.999] [--method arinc] [--json]
 *   hacd tornado <scenario.json> [--metric goodput] [--json]
 *   hacd simulate <scenario.json> [--reps 100] [--seed 1] [--hours 240] [--json]
 *   hacd schema                                     print the scenario JSON schema
 *   hacd measures <scenario.json> [--json]          original vs compensated measures and the compensation waterfall (v2)
 *   hacd methods <book.xlsx> [--json]               which availability methods a spreadsheet uses (formula fingerprints)
 *   hacd import-excel <book.xlsx> [--sheet S] [--out scenario.json] [--json]   topology + parameters → scenario, reconciled
 *   hacd export-excel <scenario.json> [out.xlsx]    workbook with live formulas (Inputs / Structure / Results / Formulas)
 *   hacd mechanisms <scenario.json> [--players D-SDC,R-SDC,…] [--metric delivered|effective|aOp] [--json]   single / last-added / Shapley gains (v3)
 *   hacd ledger <scenario.json> [--trials 300] [--seed 1] [--target 0.9] [--json]   finite-window ledger simulation vs the closed form (v3)
 *   hacd plan <scenario.json> [--target 0.9] [--players …] [--no-derate] [--trials 200] [--json]   cheapest mechanism set for the target, necessary mechanisms, scan, verification (v3.1)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  EXAMPLES, parseScenario, evaluateScenario, scenarioJsonSchema, formatDuration, compareScenarios, allocateScenario, tornadoForScenario, simulateScenario,
  mechanismReport, simulateScenarioLedger, DEFAULT_PLAYERS, MECHANISM_LIBRARY, planToTarget,
  type AllocationMethod, type TornadoMetric, type AttributionMetric, type AllocationBasis,
  rateFromCounts, unitRateFromCounts,
} from '@hac-d/core';
import { importSpreadsheet, methodReport, readWorkbook, exportWorkbook, flattenDraft } from '@hac-d/importers';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const json = rest.includes('--json');
const files = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--') || rest[i - 1] === '--json'));
const load = (p: string) => parseScenario(JSON.parse(readFileSync(p, 'utf8')));
const out = (v: unknown) => console.log(JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : typeof x === 'function' ? undefined : x), 2));

function pct(x: number, d = 2): string {
  return `${(x * 100).toFixed(d)} %`;
}

function printTable(rows: (string | number)[][]): void {
  const widths = rows[0].map((_c, j) => Math.max(...rows.map((r) => String(r[j] ?? '').length)));
  for (const r of rows) console.log(r.map((c, j) => String(c ?? '').padEnd(widths[j])).join('  '));
}

switch (cmd) {
  case 'examples':
    for (const id of Object.keys(EXAMPLES)) console.log(`${id}\t${EXAMPLES[id]().meta.name}`);
    break;
  case 'example': {
    const f = EXAMPLES[rest[0]];
    if (!f) {
      console.error(`unknown example '${rest[0]}'`);
      process.exit(1);
    }
    out(f());
    break;
  }
  case 'schema':
    out(scenarioJsonSchema());
    break;
  case 'eval': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd eval <scenario.json> [--json]');
      process.exit(1);
    }
    const r = evaluateScenario(load(path));
    if (json) {
      out(r);
      break;
    }
    console.log(`# ${r.scenarioName}`);
    console.log(`GPUs ${r.counts.gpus} · nodes ${r.counts.nodes} · racks ${r.counts.racks} · NVLink domains ${r.counts.nvlinkDomains}\n`);
    console.log('## System (structure)');
    printTable([
      ['availability', pct(r.system.availability, 4), r.formulas.availability],
      ['capacity availability', pct(r.system.capacityAvailability, 4), ''],
      ['MTBF', formatDuration(r.system.mtbfHours * 3600), r.formulas.mtbf],
      ['equivalent MTTR', formatDuration(r.system.equivalentMttrHours * 3600), ''],
      ['failures / year', r.system.failuresPerYear.toFixed(1), ''],
      ['weakest block', r.system.weakestBlock?.name ?? '—', ''],
    ]);
    if (r.training) {
      const t = r.training;
      console.log('\n## Training job');
      printTable([
        ['interruption rate', `${t.interruptionRatePerHour.toFixed(4)} /h`, r.formulas.mtbi],
        ['MTBI', formatDuration(t.mtbiS), ''],
        ['recovery R(N)', formatDuration(t.recoveryS), `dominant stage: ${t.recovery.dominant}`],
        [`interval τ (${t.intervalModel})`, formatDuration(t.tauS), r.formulas.interval],
        ['goodput (first order)', pct(t.firstOrder.goodput), r.formulas.goodput],
        ['goodput (Daly full)', pct(t.dalyGoodput), ''],
        ['loss: save / recompute / restart', `${pct(t.firstOrder.terms.save)} / ${pct(t.firstOrder.terms.recompute)} / ${pct(t.firstOrder.terms.restart)}`, ''],
        ['regime', `${t.firstOrder.regime} (${t.firstOrder.validity})`, ''],
        ['blocked (spares exhausted)', pct(t.blockedProbability, 4), ''],
        ['effective goodput', pct(t.effectiveGoodput), ''],
        ['interruptions / day', t.interruptionsPerDay.toFixed(2), ''],
        ['wasted GPU·h / day', t.wastedGpuHoursPerDay.toFixed(0), ''],
        ['lost $ / day', `$${t.lostDollarsPerDay.toFixed(0)}`, r.formulas.cost],
      ]);
      console.log('\n## Scale extrapolation');
      printTable([['N', 'MTBI', 'τ', 'goodput', 'interruptions/day', 'validity'], ...t.scale.map((s) => [String(s.nGpus), formatDuration(s.mtbiS), formatDuration(s.tauS), pct(s.goodput.goodput, 1), s.interruptionsPerDay.toFixed(1), s.goodput.validity])]);
    }
    if (r.spares) {
      const s = r.spares;
      console.log('\n## Spares');
      printTable([
        ['nodes', String(s.nodes), ''],
        ['node daily failure probability', pct(s.nodeDailyFailureProbability, 3), ''],
        [`hot spares (binomial P${(s.quantile * 100).toFixed(0)})`, String(s.hotSparesBinomial), r.formulas.spares],
        ['hot spares (Poisson, replenish time)', String(s.hotSparesPoissonReplenish), ''],
        ['configured', String(s.configuredHotSpares), ''],
        ['repair pipeline (mean / quantile)', `${s.repairPipeline.mean.toFixed(1)} / ${s.repairPipeline.quantile}`, ''],
        ['replacements over job (mean / quantile)', `${s.replacementsOverJob.mean.toFixed(1)} / ${s.replacementsOverJob.quantile}`, ''],
      ]);
    }
    if (r.inference) {
      const i = r.inference;
      console.log('\n## Inference service');
      printTable([
        ['replica MTBF', formatDuration(i.replicaMtbfHours * 3600), r.formulas.inference],
        ['replica unavailability', pct(i.replicaUnavailability, 3), ''],
        ['service-up availability', pct(i.serviceUpAvailability, 4), ''],
        [`capacity availability (k = ${i.spareReplicas})`, pct(i.capacityAvailability, 4), ''],
        ['k required for target', String(i.kRequiredForTarget), ''],
        ['replica failures / day', i.replicaFailuresPerDay.toFixed(2), ''],
      ]);
    }
    console.log('\n## Components (interruption share)');
    printTable([['component', 'share', 'count × λ /1e6 h · MTTR · confidence'], ...r.components.slice(0, 12).map((c) => [c.name, pct(c.interruptionShare, 1), `${c.count} × ${(c.lambdaPerUnitPerHour * 1e6).toFixed(2)} · ${c.mttrHours} h${c.confidence ? ` · ${c.confidence}` : ''}`])]);
    console.log('\n## Design review');
    for (const c of r.checklist) console.log(`[${c.status.padEnd(4)}] ${c.title.en} — ${c.message}`);
    if (r.warnings.length) {
      console.log('\n## Warnings');
      for (const w of r.warnings) console.log(`- ${w}`);
    }
    break;
  }
  case 'compare': {
    if (files.length < 2) {
      console.error('usage: hacd compare <a.json> <b.json> [...] [--json]');
      process.exit(1);
    }
    const cmp = compareScenarios(files.map(load));
    if (json) {
      out({ rows: cmp.rows.map(({ result: _r, ...rest }) => rest), best: cmp.best });
      break;
    }
    printTable([
      ['scenario', 'availability', 'MTBI', 'R', 'goodput', 'lost $/day', 'blocked', 'spares P99', 'capacity A', 'k*'],
      ...cmp.rows.map((r) => [
        r.name,
        pct(r.availability, 4) + (cmp.best.availability === r.id ? ' ★' : ''),
        r.mtbiHours !== undefined ? formatDuration(r.mtbiHours * 3600) + (cmp.best.mtbiHours === r.id ? ' ★' : '') : '—',
        r.recoveryS !== undefined ? formatDuration(r.recoveryS) : '—',
        r.effectiveGoodput !== undefined ? pct(r.effectiveGoodput) + (cmp.best.effectiveGoodput === r.id ? ' ★' : '') : '—',
        r.lostDollarsPerDay !== undefined ? `$${r.lostDollarsPerDay.toFixed(0)}` + (cmp.best.lostDollarsPerDay === r.id ? ' ★' : '') : '—',
        r.blockedProbability !== undefined ? pct(r.blockedProbability, 4) : '—',
        r.hotSparesRequired !== undefined ? String(r.hotSparesRequired) : '—',
        r.capacityAvailabilityInference !== undefined ? pct(r.capacityAvailabilityInference, 4) : '—',
        r.kRequired !== undefined ? String(r.kRequired) : '—',
      ]),
    ]);
    break;
  }
  case 'allocate': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd allocate <scenario.json> [--goodput 0.97] [--basis effective|delivered] [--availability 0.999] [--method arinc] [--json]');
      process.exit(1);
    }
    const a = allocateScenario(load(path), { goodputTarget: flag('goodput') ? Number(flag('goodput')) : undefined, availabilityTarget: flag('availability') ? Number(flag('availability')) : undefined, method: (flag('method') as AllocationMethod | undefined) ?? 'arinc', basis: flag('basis') as AllocationBasis | undefined });
    if (json) {
      out(a);
      break;
    }
    if (a.goodput) {
      console.log(`loss budget ${pct(a.goodput.lossBudget)} · current ${pct(a.goodput.current.loss)}`);
      console.log(`keep R, tighten λ: MTBI ≥ ${formatDuration(a.goodput.fixRecovery.requiredMtbiS)} (×${a.goodput.fixRecovery.improvementFactor.toFixed(2)})`);
      console.log(`keep λ, tighten R: R ≤ ${a.goodput.fixRate.requiredRecoveryS > 0 ? formatDuration(a.goodput.fixRate.requiredRecoveryS) : 'infeasible'}`);
    }
    if (a.lossBudget) {
      const lb = a.lossBudget;
      console.log(`\n## Loss budget over the window ledger (${lb.method}): allowed ${pct(lb.totalAllowed)} = ${lb.totalAllowedHours.toFixed(1)} h of ${lb.windowHours} h · current ${pct(lb.totalCurrent)} = ${lb.totalCurrentHours.toFixed(1)} h`);
      printTable([['line', 'current', 'weight', 'allowed', 'excess', 'levers'], ...lb.rows.map((r) => [r.line, `${pct(r.current)} (${r.currentHours.toFixed(1)} h)`, pct(r.weight, 1), `${pct(r.allowed)} (${r.allowedHours.toFixed(1)} h)`, `${r.excess >= 0 ? '+' : ''}${(r.excess * 100).toFixed(2)} pt (${r.excessHours.toFixed(1)} h)`, r.lever])]);
    }
    if (a.sdc) {
      console.log(`delivered basis: current ${pct(a.sdc.currentDelivered)} → target ${pct(a.sdc.deliveredTarget)}; delivery factor ${a.sdc.factor.toFixed(4)}; effective target ${pct(a.sdc.effectiveTarget)}; reachable by hardware alone ${pct(a.sdc.maxDeliveredByHardware)} (${a.sdc.feasibleByHardware ? 'feasible' : 'NOT feasible'})`);
      console.log(`silent-corruption levers: immediate detection ≥ ${a.sdc.requiredCoverage !== undefined ? pct(a.sdc.requiredCoverage) : 'not reachable'} (hardware as is) · fallback delay ≤ ${a.sdc.requiredFallbackDelayH !== undefined ? `${a.sdc.requiredFallbackDelayH.toFixed(1)} h` : 'not reachable'} (current coverage) · budgets below assume coverage ${pct(a.sdc.coverageUsed)}`);
    }
    if (a.rateAllocation) {
      console.log(`\n## Allowed failure rate per component class (${a.rateAllocation.method})`);
      printTable([['component', 'n', 'current /h', 'allocated /h', 'per unit /1e6 h', 'improvement', 'feasibility'], ...a.rateAllocation.rows.map((r) => [r.name, String(r.count), r.currentAggregate?.toExponential(3) ?? '—', r.lambdaAggregate.toExponential(3), (r.lambdaPerUnit * 1e6).toFixed(3), r.improvementFactor ? `×${r.improvementFactor.toFixed(2)}` : '—', r.feasibility])]);
    }
    if (a.stageAllocation) {
      console.log('\n## Allowed time per recovery stage');
      printTable([['stage', 'current', 'budget', 'improvement'], ...a.stageAllocation.map((s) => [s.name, formatDuration(s.currentS), formatDuration(s.budgetS), `×${s.improvementFactor.toFixed(2)}`])]);
    }
    if (a.unavailability) {
      console.log('\n## Availability target split');
      printTable([['component', 'A_i', 'λ allowed /h', 'MTTR implied'], ...a.unavailability.rows.map((r) => [r.name, pct(r.availability, 5), r.lambdaAggregate?.toExponential(3) ?? '—', r.mttrImplied !== undefined ? formatDuration(r.mttrImplied * 3600) : '—'])]);
    }
    for (const n of a.notes) console.log(`- ${n}`);
    break;
  }
  case 'tornado': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd tornado <scenario.json> [--metric goodput|availability|lostDollarsPerDay|mtbiHours] [--json]');
      process.exit(1);
    }
    const rows = tornadoForScenario(load(path), (flag('metric') as TornadoMetric | undefined) ?? 'goodput');
    if (json) {
      out(rows);
      break;
    }
    printTable([['parameter', 'low', 'base', 'high', 'swing'], ...rows.map((r) => [r.name, r.low.toPrecision(5), r.base.toPrecision(5), r.high.toPrecision(5), r.swing.toPrecision(4)])]);
    break;
  }
  case 'simulate': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd simulate <scenario.json> [--reps 100] [--seed 1] [--hours 240] [--json]');
      process.exit(1);
    }
    const r = simulateScenario(load(path), { replications: Number(flag('reps') ?? 100), seed: Number(flag('seed') ?? 1), workHours: flag('hours') ? Number(flag('hours')) : undefined });
    if (json) {
      out({ ...r, spec: undefined, summary: { ...r.summary, rows: undefined } });
      break;
    }
    const s = r.summary;
    console.log(`${r.disagrees ? 'DISAGREES' : 'agrees'} with closed form: MC goodput ${pct(s.goodput.mean)} ± ${pct(s.goodput.ci95)} vs ${pct(r.closedForm.goodput)}`);
    printTable([
      ['metric', 'mean', 'sd', 'P5', 'P50', 'P95'],
      ['goodput', pct(s.goodput.mean, 3), pct(s.goodput.sd, 3), pct(s.goodput.p05, 3), pct(s.goodput.p50, 3), pct(s.goodput.p95, 3)],
      ['MTBI (h)', s.mtbiHours.mean.toFixed(2), s.mtbiHours.sd.toFixed(2), s.mtbiHours.p05.toFixed(2), s.mtbiHours.p50.toFixed(2), s.mtbiHours.p95.toFixed(2)],
      ['interruptions/day', s.interruptionsPerDay.mean.toFixed(2), s.interruptionsPerDay.sd.toFixed(2), s.interruptionsPerDay.p05.toFixed(2), s.interruptionsPerDay.p50.toFixed(2), s.interruptionsPerDay.p95.toFixed(2)],
      ['blocked fraction', pct(s.blockedFraction.mean, 3), pct(s.blockedFraction.sd, 3), pct(s.blockedFraction.p05, 3), pct(s.blockedFraction.p50, 3), pct(s.blockedFraction.p95, 3)],
      ['peak spares', s.peakSparesInUse.mean.toFixed(1), s.peakSparesInUse.sd.toFixed(1), String(s.peakSparesInUse.p05), String(s.peakSparesInUse.p50), `${s.peakSparesInUse.p95} (P99 ${s.peakSparesInUse.p99})`],
    ]);
    break;
  }
  case 'measures': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd measures <scenario.json> [--json]');
      process.exit(1);
    }
    const r = evaluateScenario(load(path));
    const m = r.system.measures;
    if (json) {
      out({ measures: m, waterfall: r.system.waterfall, humanFraction: r.system.humanFraction, autoDowntimeShare: r.system.autoDowntimeShare, approximate: r.system.approximate });
      break;
    }
    printTable([
      ['measure', 'availability', 'unavailability', 'MTBF (h)', 'MTTR (h)'],
      ['original (原始)', pct(m.original.availability, 4), m.original.unavailability.toExponential(3), m.original.mtbfHours.toFixed(1), m.original.equivalentMttrHours.toFixed(2)],
      ['compensated (补偿后)', pct(m.compensated.availability, 4), m.compensated.unavailability.toExponential(3), m.compensated.mtbfHours.toFixed(1), m.compensated.equivalentMttrHours.toFixed(2)],
      ['strict (sub-health = down)', pct(m.strict, 4), (1 - m.strict).toExponential(3), '', ''],
      ['tolerant (sub-health = up)', pct(m.tolerant, 4), (1 - m.tolerant).toExponential(3), '', ''],
      ['performance-weighted', pct(m.performability, 4), (1 - m.performability).toExponential(3), '', ''],
    ]);
    console.log(`switchover penalty ${m.switchoverPenalty.toExponential(3)} · human fraction ${pct(r.system.humanFraction, 1)}${r.system.autoDowntimeShare !== undefined ? ` · automatic share of downtime ${pct(r.system.autoDowntimeShare, 1)}` : ''}`);
    printTable([['waterfall step', 'availability', 'Δ'], ...r.system.waterfall.map((w) => [w.id, pct(w.availability, 4), w.delta.toExponential(3)])]);
    break;
  }
  case 'methods': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd methods <book.xlsx> [--json]');
      process.exit(1);
    }
    const rep = methodReport(readWorkbook(new Uint8Array(readFileSync(path)), basename(path)));
    if (json) {
      out(rep);
      break;
    }
    for (const s of rep.sheets) {
      console.log(`sheet ${s.sheet}: header row ${s.headerRow === null ? 'none' : s.headerRow + 1}; columns ${s.columns.filter((c) => c.role).map((c) => `${c.header}→${c.role}`).join(', ') || '—'}`);
      printTable([['method', 'cells', 'description'], ...rep.methods.filter((m) => s.summary[m.tag]).map((m) => [m.tag, String(s.summary[m.tag]), m.description.en])]);
      for (const n of s.notes) console.log(`  note: ${n}`);
    }
    break;
  }
  case 'import-excel': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd import-excel <book.xlsx> [--sheet S] [--out scenario.json] [--json]');
      process.exit(1);
    }
    const r = importSpreadsheet(new Uint8Array(readFileSync(path)), basename(path), { sheet: flag('sheet') });
    const outPath = flag('out');
    if (outPath) writeFileSync(outPath, JSON.stringify(r.conversion.input, null, 2));
    if (json) {
      out({ sheet: r.sheet, methods: r.report.methods, columns: r.draft.columns, notes: [...r.draft.notes, ...r.conversion.notes], confidence: r.draft.confidence, tree: r.draft.root, scenario: r.conversion.input, availability: r.result.system.availability, measures: r.result.system.measures, reconciliation: r.reconciliation });
      break;
    }
    console.log(`sheet ${r.sheet} · confidence ${pct(r.draft.confidence, 0)} · ${r.draft.notes.join(' · ')}`);
    printTable([['method', 'cells'], ...r.report.methods.map((m) => [m.tag, String(m.count)])]);
    printTable([['node', 'kind', 'count', 'n/k', 'HAC-D A', 'sheet A', 'Δ'], ...r.reconciliation.rows.map((row) => {
      const node = flattenDraft(r.draft.root).find((x) => x.node.id === row.nodeId)!.node;
      return [`${'  '.repeat(row.depth)}${row.name}`, row.kind, String(node.count), node.n !== undefined ? `${node.k ?? '?'}/${node.n}` : '', row.engine !== undefined ? pct(row.engine, 4) : '—', row.excel !== null ? pct(row.excel, 4) : '—', row.delta !== null ? row.delta.toExponential(2) : '—'];
    })]);
    for (const n of [...r.conversion.notes, ...r.reconciliation.notes]) console.log(`  note: ${n}`);
    console.log(`system availability ${pct(r.result.system.availability, 4)}${outPath ? ` · scenario written to ${outPath}` : ''}`);
    break;
  }
  case 'export-excel': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd export-excel <scenario.json> [out.xlsx]');
      process.exit(1);
    }
    const s = load(path);
    const target = files[1] ?? path.replace(/\.json$/i, '') + '.xlsx';
    const bytes = exportWorkbook(s, evaluateScenario(s));
    writeFileSync(target, bytes);
    console.log(`wrote ${target} (${bytes.byteLength} bytes; sheets Inputs, Structure, Results, Formulas)`);
    break;
  }
  case 'mechanisms': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd mechanisms <scenario.json> [--players D-SDC,R-SDC,R-REPLAY,R-PROCESS,R-ELASTIC,C-FAST] [--metric delivered|effective|aOp] [--json]');
      process.exit(1);
    }
    const players = flag('players') ? flag('players')!.split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_PLAYERS;
    const rep = mechanismReport(load(path), players, { metric: (flag('metric') as AttributionMetric | undefined) ?? 'delivered' });
    if (json) {
      out(rep);
      break;
    }
    console.log(`${rep.metric}: baseline ${pct(rep.baseline[rep.metric], 3)} → all ${pct(rep.combined[rep.metric], 3)} (Δ ${(rep.delta * 100).toFixed(3)} pt, ${rep.coalitions} coalitions, interaction ${(rep.interaction * 100).toFixed(3)} pt)`);
    printTable([
      ['mechanism', 'name', 'alone', 'single gain', 'last-added', 'Shapley', 'share'],
      ...rep.gains.slice().sort((a, b) => b.shapley - a.shapley).map((g) => [g.id, MECHANISM_LIBRARY.find((m) => m.id === g.id)?.name.en ?? '', pct(g.values[rep.metric], 3), `${(g.single * 100).toFixed(3)} pt`, `${(g.lastAdded * 100).toFixed(3)} pt`, `${(g.shapley * 100).toFixed(3)} pt`, pct(g.share, 1)]),
    ]);
    for (const n of rep.notes) console.log(`- ${n}`);
    break;
  }
  case 'ledger': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd ledger <scenario.json> [--trials 300] [--seed 1] [--target 0.9] [--json]');
      process.exit(1);
    }
    const r = simulateScenarioLedger(load(path), { trials: Number(flag('trials') ?? 300), seed: Number(flag('seed') ?? 1), target: flag('target') ? Number(flag('target')) : undefined });
    if (json) {
      out({ ...r, summary: { ...r.summary, values: undefined } });
      break;
    }
    const L = r.summary;
    console.log(`${r.disagrees ? 'DISAGREES' : 'agrees'} with closed form: delivered ${pct(L.delivered.mean, 3)} ± ${pct(L.delivered.ci95, 3)} vs ${pct(r.closedForm.delivered, 3)}; A_op ${pct(L.operationalAvailability.mean, 3)} vs ${pct(r.closedForm.operationalAvailability, 3)}${L.pAtLeastTarget !== undefined ? `; P(≥ ${pct(L.target ?? 0, 0)}) ${pct(L.pAtLeastTarget, 1)}` : ''}; P(unresolved at end) ${pct(L.pUnresolvedAtEnd, 1)}${L.pAtLeastTargetInterval ? `; Wilson 95 % [${pct(L.pAtLeastTargetInterval.low, 1)}, ${pct(L.pAtLeastTargetInterval.high, 1)}]` : ''}; CI = Student-t 95 %`);
    printTable([
      ['ledger share', 'Monte Carlo', 'closed form'],
      ['delivered', pct(L.ledger.delivered, 3), pct(r.closedForm.ledger.delivered, 3)],
      ['downtime', pct(L.ledger.downtime, 3), pct(r.closedForm.ledger.downtime, 3)],
      ['saves', pct(L.ledger.save, 3), pct(r.closedForm.ledger.save, 3)],
      ['rollback (interruptions)', pct(L.ledger.rollbackHard, 3), pct(r.closedForm.ledger.rollback, 3)],
      ['slow-down', pct(L.ledger.slowdown, 3), pct(r.closedForm.ledger.slowdown, 3)],
      ['local loss', pct(L.ledger.localLoss, 3), pct(r.closedForm.ledger.local, 3)],
      ['rollback (silent)', pct(L.ledger.rollbackSdc, 3), pct(r.closedForm.ledger.sdcRollback, 3)],
      ['terminal discard', pct(L.ledger.terminalInvalid, 3), pct(r.closedForm.ledger.terminal, 3)],
    ]);
    printTable([['class', 'events/run', 'downtime', 'rollback', 'slow-down', 'local', 'terminal'], ...Object.entries(L.byClass).map(([id, a]) => [id, a.events.toFixed(1), pct(a.downtime, 3), pct(a.rollback, 3), pct(a.slowdown, 3), pct(a.localLoss, 3), pct(a.terminalInvalid, 3)])]);
    break;
  }
  case 'plan': {
    const path = files[0];
    if (!path) {
      console.error('usage: hacd plan <scenario.json> [--target 0.9] [--players D-SDC,R-SDC,…] [--metric delivered|effective|aOp] [--no-derate] [--trials 200] [--confidence 0.9] [--json]');
      process.exit(1);
    }
    const players = flag('players') ? flag('players')!.split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_PLAYERS;
    const trials = flag('trials') ? Number(flag('trials')) : 200;
    const p = planToTarget(load(path), { target: flag('target') ? Number(flag('target')) : undefined, players, metric: (flag('metric') as AttributionMetric | undefined) ?? 'delivered', derate: rest.includes('--no-derate') ? null : undefined, scan: true, verify: trials > 0 ? { trials, confidence: flag('confidence') ? Number(flag('confidence')) : 0.9 } : undefined });
    if (json) {
      out(p);
      break;
    }
    console.log(`target ${pct(p.target)} (${p.metric}); baseline ${pct(p.baseline[p.metric])}; ${p.feasibleCount}/${p.coalitions.length} feasible coalitions; all on: ${pct(p.maxValue)} nominal / ${pct(p.maxDerated)} derated; no-fault bound ${pct(p.bounds.finiteWindow, 3)} (duty cycle ${pct(p.bounds.dutyCycle, 3)}, ${p.bounds.bestIds.join(' + ') || 'baseline'})${p.bounds.provenInfeasible ? ' → PROVEN INFEASIBLE by the checkpoint saves' : ''}`);
    if (p.plan) console.log(`plan: ${p.plan.ids.join(' + ') || '(nothing needed)'} · effort ${p.plan.effort} · ${pct(p.plan.value)} nominal / ${pct(p.plan.derated)} derated · necessary: ${p.necessary.join(', ') || '—'}`);
    printTable([['coalition (Pareto front)', 'effort', 'nominal', 'derated', 'margin'], ...p.pareto.map((c) => [c.ids.join(' + ') || '∅', String(c.effort), pct(c.value), pct(c.derated), `${(c.margin * 100).toFixed(2)} pt${c.feasible ? ' ✓' : ''}`])]);
    if (p.scan && p.scan.recoverySeconds.length) {
      console.log(`\n## Scan: ${p.scan.basis}`);
      printTable([['recovery s \\ coverage', ...p.scan.coverages.map((q) => pct(q, 1))], ...p.scan.recoverySeconds.map((sec) => [String(sec), ...p.scan!.coverages.map((q) => pct(p.scan!.cells.find((c) => c.coverage === q && c.recoverySeconds === sec)!.value))])]);
    }
    if (p.verification) console.log(`verification: mean ${pct(p.verification.mean)} ± ${pct(p.verification.ci95)} (Student-t), P5 ${pct(p.verification.p05)}, P(window ≥ target) ${pct(p.verification.pAtLeastTarget, 1)} [Wilson ${pct(p.verification.pLow, 1)}–${pct(p.verification.pHigh, 1)}] vs confidence ${pct(p.verification.confidence, 0)} → ${p.verification.verdict.toUpperCase()}`);
    for (const n of p.notes) console.log(`- ${n}`);
    break;
  }
  case 'rate': {
    const events = Number(files[0]);
    const exposure = flag('units') && flag('hours') ? undefined : Number(files[1]);
    if (!Number.isInteger(events) || events < 0 || (exposure === undefined && !(flag('units') && flag('hours'))) || (exposure !== undefined && !(exposure > 0))) {
      console.error('usage: hacd rate <events> <exposureUnitHours> [--confidence 0.95] [--json]   or   hacd rate <events> --units N --hours H [--confidence 0.95] [--json]');
      process.exit(1);
    }
    const confidence = flag('confidence') ? Number(flag('confidence')) : 0.95;
    const r = exposure !== undefined ? rateFromCounts(events, exposure, confidence) : unitRateFromCounts(events, Number(flag('units')), Number(flag('hours')), confidence);
    if (json) {
      out(r);
      break;
    }
    console.log(`${r.events} events over ${r.exposureHours.toExponential(3)} unit-hours: λ ${r.ratePerHour.toExponential(4)} /h = ${r.fit.toFixed(2)} FIT, MTBF ${Number.isFinite(r.mtbfHours) ? formatDuration(r.mtbfHours * 3600) : '∞'}`);
    console.log(`${(r.confidence * 100).toFixed(1)} % ${r.method === 'garwood-exact' ? 'Garwood interval' : 'one-sided upper bound'}: [${r.lower.fit.toFixed(2)}, ${r.upper.fit.toFixed(2)}] FIT = [${r.lower.ratePerHour.toExponential(4)}, ${r.upper.ratePerHour.toExponential(4)}] /h`);
    for (const n of r.notes) console.log(`- ${n}`);
    break;
  }
  default:
    console.log('usage: hacd <examples | example <id> | eval <scenario.json> | compare <a.json> <b.json>… | allocate <scenario.json> | tornado <scenario.json> | simulate <scenario.json> | measures <scenario.json> | methods <book.xlsx> | import-excel <book.xlsx> | export-excel <scenario.json> [out.xlsx] | mechanisms <scenario.json> | ledger <scenario.json> | plan <scenario.json> | rate <events> <unitHours> | schema> [--json]');
}
