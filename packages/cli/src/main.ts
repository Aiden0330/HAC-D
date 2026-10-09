#!/usr/bin/env -S node --import tsx
/**
 * hacd — command-line access to the HAC-D core.
 *   hacd examples                      list example scenarios
 *   hacd example <id>                  print an example scenario as JSON
 *   hacd eval <scenario.json> [--json] evaluate a scenario (table or JSON)
 *   hacd schema                        print the scenario JSON schema
 */
import { readFileSync } from 'node:fs';
import { EXAMPLES, parseScenario, evaluateScenario, scenarioJsonSchema, formatDuration } from '@hac-d/core';

const [cmd, ...rest] = process.argv.slice(2);

function pct(x: number, d = 2): string {
  return `${(x * 100).toFixed(d)} %`;
}

function printTable(rows: [string, string, string?][]): void {
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max(...rows.map((r) => r[1].length));
  for (const r of rows) console.log(`${r[0].padEnd(w0)}  ${r[1].padStart(w1)}  ${r[2] ?? ''}`);
}

switch (cmd) {
  case 'examples':
    for (const id of Object.keys(EXAMPLES)) console.log(id);
    break;
  case 'example': {
    const f = EXAMPLES[rest[0]];
    if (!f) {
      console.error(`unknown example '${rest[0]}'`);
      process.exit(1);
    }
    console.log(JSON.stringify(f(), null, 2));
    break;
  }
  case 'schema':
    console.log(JSON.stringify(scenarioJsonSchema(), null, 2));
    break;
  case 'eval': {
    const path = rest.find((a) => !a.startsWith('--'));
    const json = rest.includes('--json');
    if (!path) {
      console.error('usage: hacd eval <scenario.json> [--json]');
      process.exit(1);
    }
    const scenario = parseScenario(JSON.parse(readFileSync(path, 'utf8')));
    const r = evaluateScenario(scenario);
    if (json) {
      console.log(JSON.stringify(r, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
      break;
    }
    console.log(`# ${r.scenarioName}`);
    console.log(`GPUs ${r.counts.gpus} · nodes ${r.counts.nodes} · racks ${r.counts.racks} · NVLink domains ${r.counts.nvlinkDomains}`);
    console.log('\n## System (structure)');
    printTable([
      ['availability', pct(r.system.availability, 4), r.formulas.availability],
      ['capacity availability', pct(r.system.capacityAvailability, 4)],
      ['MTBF', formatDuration(r.system.mtbfHours * 3600), r.formulas.mtbf],
      ['equivalent MTTR', formatDuration(r.system.equivalentMttrHours * 3600)],
      ['failures / year', r.system.failuresPerYear.toFixed(1)],
      ['weakest block', r.system.weakestBlock?.name ?? '—'],
    ]);
    if (r.training) {
      const t = r.training;
      console.log('\n## Training job');
      printTable([
        ['interruption rate', `${t.interruptionRatePerHour.toFixed(4)} /h`, r.formulas.mtbi],
        ['MTBI', formatDuration(t.mtbiS)],
        ['recovery R(N)', formatDuration(t.recoveryS), `dominant stage: ${t.recovery.dominant}`],
        [`interval τ (${t.intervalModel})`, formatDuration(t.tauS), r.formulas.interval],
        ['goodput (first order)', pct(t.firstOrder.goodput), r.formulas.goodput],
        ['goodput (Daly full)', pct(t.dalyGoodput)],
        ['loss: save / recompute / restart', `${pct(t.firstOrder.terms.save)} / ${pct(t.firstOrder.terms.recompute)} / ${pct(t.firstOrder.terms.restart)}`],
        ['regime', `${t.firstOrder.regime} (${t.firstOrder.validity})`],
        ['blocked (spares exhausted)', pct(t.blockedProbability, 4)],
        ['effective goodput', pct(t.effectiveGoodput)],
        ['interruptions / day', t.interruptionsPerDay.toFixed(2)],
        ['wasted GPU·h / day', t.wastedGpuHoursPerDay.toFixed(0)],
        ['lost $ / day', `$${t.lostDollarsPerDay.toFixed(0)}`, r.formulas.cost],
      ]);
      console.log('\n## Scale extrapolation');
      printTable([['N', 'MTBI', 'τ · goodput · interruptions/day'], ...t.scale.map((s) => [String(s.nGpus), formatDuration(s.mtbiS), `${formatDuration(s.tauS)} · ${pct(s.goodput.goodput, 1)} · ${s.interruptionsPerDay.toFixed(1)} ${s.goodput.validity !== 'ok' ? `(${s.goodput.validity})` : ''}`] as [string, string, string])]);
    }
    if (r.spares) {
      const s = r.spares;
      console.log('\n## Spares');
      printTable([
        ['nodes', String(s.nodes)],
        ['node daily failure probability', pct(s.nodeDailyFailureProbability, 3)],
        [`hot spares (binomial P${(s.quantile * 100).toFixed(0)})`, String(s.hotSparesBinomial), r.formulas.spares],
        ['hot spares (Poisson, replenish time)', String(s.hotSparesPoissonReplenish)],
        ['configured', String(s.configuredHotSpares)],
        ['repair pipeline (mean / quantile)', `${s.repairPipeline.mean.toFixed(1)} / ${s.repairPipeline.quantile}`],
        ['replacements over job (mean / quantile)', `${s.replacementsOverJob.mean.toFixed(1)} / ${s.replacementsOverJob.quantile}`],
      ]);
    }
    if (r.inference) {
      const i = r.inference;
      console.log('\n## Inference service');
      printTable([
        ['replica MTBF', formatDuration(i.replicaMtbfHours * 3600), r.formulas.inference],
        ['replica unavailability', pct(i.replicaUnavailability, 3)],
        ['service-up availability', pct(i.serviceUpAvailability, 4)],
        [`capacity availability (k = ${i.spareReplicas})`, pct(i.capacityAvailability, 4)],
        ['k required for target', String(i.kRequiredForTarget)],
        ['replica failures / day', i.replicaFailuresPerDay.toFixed(2)],
      ]);
    }
    console.log('\n## Components (interruption share)');
    printTable(r.components.slice(0, 12).map((c) => [c.name, pct(c.interruptionShare, 1), `${c.count} × ${(c.lambdaPerUnitPerHour * 1e6).toFixed(2)} /1e6 h · MTTR ${c.mttrHours} h${c.confidence ? ` · ${c.confidence}` : ''}`] as [string, string, string]));
    console.log('\n## Design review');
    for (const c of r.checklist) console.log(`[${c.status.padEnd(4)}] ${c.title.en} — ${c.message}`);
    if (r.warnings.length) {
      console.log('\n## Warnings');
      for (const w of r.warnings) console.log(`- ${w}`);
    }
    break;
  }
  default:
    console.log('usage: hacd <examples | example <id> | eval <scenario.json> [--json] | schema>');
}
