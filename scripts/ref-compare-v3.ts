// HAC-D v3 vs the ai-cluster-reliability audited engine on its three-class baseline (interruption 96.6 %, sub-health 2 %, silent 1.4 %).
// Reference means: catalogs/review-2026-10-09/results.json (4000 30-day trials per scenario). Usage: node --import tsx scripts/ref-compare-v3.ts [ledgerTrials]
import { referenceThreeClasses, referenceBaseline, evaluateScenario, simulateScenarioLedger, mechanismReport, applyMechanisms } from '../packages/core/src/index.ts';
const ref: Record<number, { base: number; aop: number; sdcDetect: number; sdcStep: number; replay: number; process: number; elastic: number; fast: number; combined: number }> = {
  10000: { base: 93.332, aop: 99.749, sdcDetect: 98.048, sdcStep: 98.053, replay: 93.448, process: 93.427, elastic: 93.741, fast: 93.132, combined: 97.99 },
  100000: { base: 62.559, aop: 97.556, sdcDetect: 92.618, sdcStep: 92.664, replay: 63.115, process: 62.987, elastic: 64.056, fast: 62.821, combined: 94.718 },
  200000: { base: 45.87, aop: 95.235, sdcDetect: 86.967, sdcStep: 87.051, replay: 46.537, process: 46.255, elastic: 47.203, fast: 46.317, combined: 91.385 },
  500000: { base: 25.244, aop: 88.88, sdcDetect: 73.132, sdcStep: 73.276, replay: 25.869, process: 25.619, elastic: 26.332, fast: 25.721, combined: 82.791 },
};
const trials = Number(process.argv[2] ?? 0);
for (const N of [10000, 100000, 200000, 500000]) {
  const s = referenceThreeClasses(N);
  const t = evaluateScenario(s).training!;
  const row: Record<string, unknown> = { N, closed_delivered: +(t.deliveredGoodput * 100).toFixed(3), ref_base: ref[N].base, closed_effective: +(t.effectiveGoodput * 100).toFixed(3), aop: +(t.operationalAvailability * 100).toFixed(3), ref_aop: ref[N].aop, episodes: +t.sdc!.delivery.expectedEpisodes.toFixed(3), pDirtyEnd: +t.sdc!.delivery.pDirtyAtEnd.toFixed(3), method: t.sdc!.delivery.method, ledger: Object.fromEntries(Object.entries(t.ledger).map(([k, v]) => [k, +(v * 100).toFixed(3)])) };
  if (trials > 0) {
    const t0 = Date.now();
    const mc = simulateScenarioLedger(s, { trials, seed: 7 });
    Object.assign(row, { mc_delivered: +(mc.summary.delivered.mean * 100).toFixed(3), mc_ci: +(mc.summary.delivered.ci95 * 100).toFixed(3), mc_aop: +(mc.summary.operationalAvailability.mean * 100).toFixed(3), mc_ledger: Object.fromEntries(Object.entries(mc.summary.ledger).map(([k, v]) => [k, +(v * 100).toFixed(3)])), mcSec: +((Date.now() - t0) / 1000).toFixed(1) });
  }
  console.log(JSON.stringify(row));
  // single mechanisms (closed form)
  const single: Record<string, number> = {};
  for (const [key, ids] of Object.entries({ sdcDetect: ['D-SDC'], sdcStep: ['D-SDC', 'R-SDC'], replay: ['R-REPLAY'], process: ['R-PROCESS'], elastic: ['R-ELASTIC'], fast: ['C-FAST'], combined: ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'] })) {
    single[key] = +(evaluateScenario(applyMechanisms(s, ids)).training!.deliveredGoodput * 100).toFixed(3);
  }
  console.log(JSON.stringify({ N, closed: single, ref: { sdcDetect: ref[N].sdcDetect, sdcStep: ref[N].sdcStep, replay: ref[N].replay, process: ref[N].process, elastic: ref[N].elastic, fast: ref[N].fast, combined: ref[N].combined } }));
}
const hard = evaluateScenario(referenceBaseline(100000)).training!;
console.log('hard-only 100k unchanged?', { aop: +(hard.operationalAvailability * 100).toFixed(3), exact: +(hard.renewalGoodput * 100).toFixed(3), first: +(hard.firstOrder.goodput * 100).toFixed(3), delivered: +(hard.deliveredGoodput * 100).toFixed(3) });
const t0 = Date.now();
const rep = mechanismReport(referenceThreeClasses(100000));
console.log('shapley 100k', rep.coalitions, 'coalitions', ((Date.now() - t0) / 1000).toFixed(1), 's', 'delta', +(rep.delta * 100).toFixed(3), 'residual', rep.residual.toExponential(2), rep.gains.map((g) => `${g.id}: single ${(g.single * 100).toFixed(3)} shapley ${(g.shapley * 100).toFixed(3)}`).join(' | '));
console.log('ref shapley 100k: sdcDetect 31.059 step 0.019 replay 0.355 process 0.315 elastic 0.247 fast 0.178 (delta 32.17)');
