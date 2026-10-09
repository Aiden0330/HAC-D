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
 */
import { readFileSync } from 'node:fs';
import {
  EXAMPLES, parseScenario, evaluateScenario, scenarioJsonSchema, formatDuration, compareScenarios, allocateScenario, tornadoForScenario, simulateScenario,
  type AllocationMethod, type TornadoMetric,
} from '@hac-d/core';

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
      console.error('usage: hacd allocate <scenario.json> [--goodput 0.97] [--availability 0.999] [--method arinc] [--json]');
      process.exit(1);
    }
    const a = allocateScenario(load(path), { goodputTarget: flag('goodput') ? Number(flag('goodput')) : undefined, availabilityTarget: flag('availability') ? Number(flag('availability')) : undefined, method: (flag('method') as AllocationMethod | undefined) ?? 'arinc' });
    if (json) {
      out(a);
      break;
    }
    if (a.goodput) {
      console.log(`loss budget ${pct(a.goodput.lossBudget)} · current ${pct(a.goodput.current.loss)}`);
      console.log(`keep R, tighten λ: MTBI ≥ ${formatDuration(a.goodput.fixRecovery.requiredMtbiS)} (×${a.goodput.fixRecovery.improvementFactor.toFixed(2)})`);
      console.log(`keep λ, tighten R: R ≤ ${a.goodput.fixRate.requiredRecoveryS > 0 ? formatDuration(a.goodput.fixRate.requiredRecoveryS) : 'infeasible'}`);
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
  default:
    console.log('usage: hacd <examples | example <id> | eval <scenario.json> | compare <a.json> <b.json>… | allocate <scenario.json> | tornado <scenario.json> | simulate <scenario.json> | schema> [--json]');
}
