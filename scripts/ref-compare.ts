// HAC-D on the ai-cluster-reliability baseline: 10k-card hard MTBF 30 h, τ = 300 s, δ = 4 s,
// detection 95 % @ 10 s else 60 s, automatic recovery 180 s @ 99 % else + 7200 s manual,
// sub-health 2 % of events (24 h, −5 %, 95 % detected in 5 min). Usage: node --import tsx scripts/ref-compare.ts [mcReps]
import { parseScenario, evaluateScenario, simulateScenario, type ScenarioInput } from '../packages/core/src/index.ts';
const reps = Number(process.argv[2] ?? 20);
const lamCard = 1 / (10000 * 30); // hard interruptions per card-hour
function scenario(N: number, withSlow: boolean) {
  const card: ScenarioInput['components'][number] = {
    id: 'card', subsystem: 'compute', countRule: { per: 'gpu' },
    failure: { value: lamCard, unit: 'per_h', koujing: { event: 'hard_interruption', denominator: 'card_h', level: 'job' } },
    repair: { auto: { coverage: 1, successProbability: 0.99, mttrHours: (12.5 + 180) / 3600 }, manual: { mttrHours: 7200 / 3600 } },
    ...(withSlow ? { subhealth: { ratePerHour: (lamCard * 0.02) / 0.966, durationHours: 24, performance: 0.95, escalationMultiplier: 1, policy: 'isolate' as const, detection: { probability: 0.95, delayHours: 5 / 60 } } } : {}),
  };
  return parseScenario({
    meta: { name: `reference baseline ${N}${withSlow ? ' + sub-health' : ''}` },
    topology: { gpusPerNode: 8, nodesPerRack: 32 },
    components: [card],
    structure: { mode: 'template', template: 'training-series' },
    workload: { type: 'training', nGpus: N, durationDays: 30, deltaS: 4, intervalS: 300, intervalModel: 'young' },
    recovery: { mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { successProbability: 0.99, seconds: 180 }, manual: { seconds: 7200 } },
    measures: { subhealthThreshold: 0.7, primary: 'compensated', commShare: 0.3 },
  });
}
for (const N of [100000, 200000, 500000]) {
  for (const withSlow of [false, true]) {
    const s = scenario(N, withSlow);
    const r = evaluateScenario(s); const tr = r.training!;
    const row: Record<string, unknown> = { N, stage: withSlow ? 1 : 0, mtbiH: +tr.mtbiHours.toFixed(4), R_s: +tr.recoveryS.toFixed(1), A_op: +tr.operationalAvailability.toFixed(5), first: +tr.firstOrder.goodput.toFixed(5), product: +tr.productGoodput.toFixed(5), exact: +tr.renewalGoodput.toFixed(5), daly: +tr.dalyGoodput.toFixed(5), headline: tr.headlineModel, effective: +tr.effectiveGoodput.toFixed(5), validity: tr.firstOrder.validity };
    if (withSlow && tr.subhealth) Object.assign(row, { pSlowed: +tr.subhealth.pSlowed.toFixed(4), perfFactor: +tr.subhealth.performanceFactor.toFixed(5), isoPerH: +tr.subhealth.isolationInterruptionsPerHour.toFixed(4), hwPerH: +tr.subhealth.hardwareInterruptionsPerHour.toFixed(4) });
    const t0 = Date.now();
    try {
      const mc = simulateScenario(s, { replications: reps, seed: 1 });
      Object.assign(row, { mc: +mc.summary.goodput.mean.toFixed(5), mc_ci95: +mc.summary.goodput.ci95.toFixed(5), mc_blocked: +mc.summary.blockedFraction.mean.toFixed(5), mcSec: +((Date.now() - t0) / 1000).toFixed(1), disagrees: mc.disagrees });
    } catch (e) { row.mcError = String((e as Error).message).slice(0, 80); }
    console.log(JSON.stringify(row));
  }
}
