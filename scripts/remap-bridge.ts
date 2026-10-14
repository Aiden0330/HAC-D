#!/usr/bin/env -S node --import tsx
/**
 * ReMAP bridge (docs/REMAP_INTEGRATION.md): run the expert engines that ReMAP vendors — the audited 54-event review engine
 * (`training.retained-clean-progress`) and the V4 monthly engine (`training.correct-delivery`) — on a HAC-D scenario, compare
 * them with HAC-D's closed forms and ledger simulation, and export the scenario as the engines' inputs and as a ReMAP audit
 * request (eventOverrides, model, policy, mechanisms, recoveryOrder) for ReMAP's own workbench.
 *
 * Needs the untracked ReMAP drop (default remap/remap-main; --remap <dir> or REMAP_DIR). The engines are byte-identical copies of
 * the reference engine; nothing from ReMAP is imported into HAC-D's packages.
 *
 * Usage: node --import tsx scripts/remap-bridge.ts <scenario.json | example id> [--engine review|v4|both] [--trials 400]
 *        [--seed 20261009] [--no-ledger] [--export out.json] [--json] [--remap <dir>]
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXAMPLES, parseScenario, evaluateScenario, computeCounts, componentInstances, simulateScenarioLedger, summaryStat, proportionEstimate, DEFAULT_CHAIN, rungOrder, REFERENCE_EVENTS, cloneScenario, type Scenario } from '@hac-d/core';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.match(/^--(engine|trials|seed|export|remap)$/));
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const json = args.includes('--json');
const withLedger = !args.includes('--no-ledger');
const engineChoice = (flag('engine') ?? 'both') as 'review' | 'v4' | 'both';
const trials = Number(flag('trials') ?? 400);
const seed = Number(flag('seed') ?? 20261009);
const remapDir = resolve(flag('remap') ?? process.env.REMAP_DIR ?? 'remap/remap-main');
const target = files[0];
if (!target) {
  console.error('usage: node --import tsx scripts/remap-bridge.ts <scenario.json | example id> [--engine review|v4|both] [--trials 400] [--seed 20261009] [--no-ledger] [--export out.json] [--json] [--remap <dir>]');
  process.exit(1);
}
const vendor = resolve(remapDir, 'packages/solvers/src/vendor');
if (!existsSync(resolve(vendor, 'review-engine.cjs')) || !existsSync(resolve(vendor, 'monthly-engine.cjs'))) {
  console.error(`ReMAP drop not found at ${remapDir} (expected packages/solvers/src/vendor/{review-engine,monthly-engine}.cjs); pass --remap <dir> or set REMAP_DIR`);
  process.exit(2);
}
const require = createRequire(import.meta.url);
type ReviewEngine = { simulate: (cards: number, stage: number, seed: number, p: Record<string, unknown>, opts: Record<string, unknown>) => { operationalAvailability: number; usefulThroughput: number; correctHours: number; ledger: Record<string, number>; counts: Record<string, number>; unresolvedSilent: boolean }; parameters: (opts?: Record<string, unknown>) => Record<string, unknown>; typeTotals: Record<string, number> };
const createReviewEngine = require(resolve(vendor, 'review-engine.cjs')) as (events: unknown[], P: unknown, config: unknown) => ReviewEngine;
type V4Engine = { version: string; defaults: Record<string, unknown>; validate: (p: Record<string, unknown>, n: number) => void; summary: (p: Record<string, unknown>, n: number) => Record<string, number>; estimate: (n: number, p: Record<string, unknown>, trials: number, seed: number, hours: number) => Record<string, unknown> };
const createMonthlyTrainingEngine = require(resolve(vendor, 'monthly-engine.cjs')) as () => V4Engine;

const s: Scenario = EXAMPLES[target] ? EXAMPLES[target]() : parseScenario(JSON.parse(readFileSync(target, 'utf8')));
if (s.workload.type !== 'training') throw new Error('the bridge needs a training workload');
const w = s.workload;
const N = w.nGpus;
const hours = w.durationDays * 24;
const ev = evaluateScenario(s).training!;
const counts = computeCounts(s);
const clamp = (x: number | undefined) => Math.min(1, Math.max(0, x ?? 0));
const notes: string[] = [];

// ---------------------------------------------------------------------------------------------------------------------
// review engine inputs: one Boolean event per class (fractional applicability split into sub-events), class policies
type Flag = 'replay' | 'process' | 'elastic';
interface EngineEvent { id: string; hacdId: string; type: 'hard' | 'slow' | 'sdc'; fit: number; replay: boolean; process: boolean; elastic: boolean; domain: string; scope: string; persistence: string }
const events: EngineEvent[] = [];
let slowW = 0, slowDet = 0, slowDelay = 0, slowLife = 0, slowLoss = 0;
const slotFit = [0, 0, 0, 0]; // V4 sources: HBM / accelerator / network / other
for (const c of s.components) {
  if (!c.enabled) continue;
  const ci = componentInstances(c, counts, s.measures.subhealthThreshold);
  const perCardFit = (ratePerUnitHour: number) => ((ratePerUnitHour * ci.total) / N) * 1e9;
  const hardFit = perCardFit(ci.lambda);
  const slot = c.subsystem === 'memory' ? 0 : c.subsystem === 'compute' ? 1 : c.subsystem === 'network' || c.subsystem === 'interconnect' ? 2 : 3;
  slotFit[slot] += hardFit;
  if (hardFit > 0) {
    const fr: Record<Flag, number> = { replay: clamp(ci.applicable.replay), process: clamp(ci.applicable.process), elastic: clamp(ci.applicable.elastic) };
    const flags: Flag[] = ['replay', 'process', 'elastic'];
    const boolean = flags.every((k) => fr[k] === 0 || fr[k] === 1);
    for (let mask = 0; mask < 8; mask++) {
      let p = 1;
      const on = { replay: false, process: false, elastic: false };
      flags.forEach((k, i) => {
        const bit = (mask >> i) & 1;
        p *= bit ? fr[k] : 1 - fr[k];
        on[k] = bit === 1;
      });
      if (p <= 1e-15) continue;
      events.push({ id: boolean ? c.id : `${c.id}#${mask}`, hacdId: c.id, type: 'hard', fit: hardFit * p, ...on, domain: c.subsystem, scope: 'card', persistence: 'unknown' });
    }
    if (!boolean) notes.push(`${c.id}: fractional applicability split into Boolean sub-events (independent fractions, HAC-D's four-source convention)`);
    if (s.mechanisms.predict && ci.applicable.predict > 0) notes.push(`${c.id}: the prediction rung has no counterpart in the review engine (ignored there)`);
    if (s.mechanisms.netfail && ci.applicable.netfail > 0) notes.push(`${c.id}: the network-failover rung has no counterpart in the review engine (ignored there)`);
    if (s.mechanisms.hotswap && ci.applicable.hotswap > 0) notes.push(`${c.id}: the hot-swap rung has no counterpart in the review engine (ignored there)`);
  }
  if (ci.subhealth && ci.subhealth.ratePerHour > 0) {
    const f = perCardFit(ci.subhealth.ratePerHour);
    events.push({ id: hardFit > 0 ? `${c.id}-slow` : c.id, hacdId: c.id, type: 'slow', fit: f, replay: false, process: false, elastic: false, domain: c.subsystem, scope: 'card', persistence: 'transient' });
    slowW += f;
    slowDet += f * (ci.subhealth.detection?.probability ?? 0);
    slowDelay += f * (ci.subhealth.detection?.delayH ?? 0);
    slowLife += f * ci.subhealth.durationH;
    slowLoss += f * (1 - ci.subhealth.performance);
    if ((ci.subhealth.policy ?? 'tolerate') !== 'isolate') notes.push(`${c.id}: sub-health policy tolerate; the review engine always isolates a detected unit (snapshot + pause)`);
  }
  if (ci.sdcLambda > 0) events.push({ id: hardFit > 0 ? `${c.id}-sdc` : c.id, hacdId: c.id, type: 'sdc', fit: perCardFit(ci.sdcLambda), replay: false, process: false, elastic: false, domain: c.subsystem, scope: 'card', persistence: 'persistent' });
}
const classFit = { hard: events.filter((e) => e.type === 'hard').reduce((a, e) => a + e.fit, 0), slow: events.filter((e) => e.type === 'slow').reduce((a, e) => a + e.fit, 0), sdc: events.filter((e) => e.type === 'sdc').reduce((a, e) => a + e.fit, 0) };
const totalFit = classFit.hard + classFit.slow + classFit.sdc;
const rec = s.recovery.mode === 'mixture' ? s.recovery : undefined;
if (!rec) notes.push(`recovery mode ${s.recovery.mode}: the engines take the mean global recovery ${ev.globalRecoveryS.toFixed(0)} s as a deterministic attempt (success 1) and the mean detection ${ev.detectS.toFixed(1)} s`);
const overhead = Object.values(s.mechanisms.overheads ?? {}).reduce((a, b) => a + b, 0);
if (overhead > 0) notes.push(`fault-free overhead ${(overhead * 100).toFixed(2)} % of the enabled mechanisms is not representable in the engines (HAC-D's values include it)`);
if (w.hotSpareNodes > 0) notes.push('hot spares / blocked probability are not represented in the engines');
const discardAll = s.sdc.terminalRule === 'discard-all';
const config = {
  scope: `hac-d:${s.meta.id ?? s.meta.name}`,
  referenceCards: 10000,
  referenceMtbfHours: 30,
  referenceRateArithmetic: false,
  checkpointComputeSeconds: ev.tauS,
  checkpointSaveSeconds: w.deltaS,
  recoveryAttemptSeconds: rec ? rec.automatic.seconds : ev.globalRecoveryS,
  recoverySuccess: rec ? rec.automatic.successProbability : 1,
  manualAdditionalSeconds: rec ? rec.manual.seconds : 0,
  detectProbability: rec ? rec.detection.coverage : 1,
  detectSeconds: rec ? rec.detection.autoSeconds : ev.detectS,
  timeoutSeconds: rec ? rec.detection.timeoutSeconds : ev.detectS,
  horizonHours: hours,
  shares: { hard: totalFit ? classFit.hard / totalFit : 1, slow: totalFit ? classFit.slow / totalFit : 0, sdc: totalFit ? classFit.sdc / totalFit : 0 },
  slowDetectProbability: slowW ? slowDet / slowW : 0.95,
  slowDetectHours: slowW ? slowDelay / slowW : 1 / 12,
  slowLifetimeHours: slowW ? slowLife / slowW : 24,
  slowLoss: slowW ? slowLoss / slowW : 0.05,
  sdcImmediateProbability: s.sdc.detection.coverage,
  sdcDelayHours: s.sdc.fallbackDelayHours,
  sdcDelayDistribution: 'fixed',
  terminalRule: discardAll ? 'discard-all (applied to the engine output: an unresolved window delivers 0)' : 'retain-last-clean-checkpoint-if-corrupt',
  trials,
  seed,
};
const ch = s.mechanisms;
const P = {
  'D-HARD': { coverage: config.detectProbability, detectSeconds: config.detectSeconds },
  'D-SLOW': { coverage: config.slowDetectProbability, detectSeconds: config.slowDetectHours * 3600 },
  'D-SDC': { coverage: s.sdc.detection.coverage, detectSeconds: s.sdc.detection.detectSeconds },
  'R-SDC': { stepSeconds: s.sdc.stepRecovery?.stepSeconds ?? 1, recoverSeconds: s.sdc.stepRecovery?.recoverSeconds ?? 1 },
  'R-REPLAY': { ...(ch.replay ?? DEFAULT_CHAIN.replay) },
  'R-PROCESS': { ...(ch.process ?? DEFAULT_CHAIN.process) },
  'R-ELASTIC': { ...(ch.elastic ?? DEFAULT_CHAIN.elastic) },
  'C-FAST': { computeSeconds: ev.tauS, saveSeconds: w.deltaS },
};
const recoveryOrder = rungOrder(ch.order).filter((r): r is 'replay' | 'elastic' | 'process' => r !== 'hotswap');
const opts = { replay: !!ch.replay, elastic: !!ch.elastic, process: !!ch.process, sdcDetect: s.sdc.detection.coverage > 0, sdcCoverage: s.sdc.detection.coverage, step: !!s.sdc.stepRecovery, stepSeconds: s.sdc.stepRecovery?.stepSeconds, elasticSyncSeconds: ch.elastic?.syncSeconds, recoveryOrder };

// ---------------------------------------------------------------------------------------------------------------------
// run the review engine
interface EngineRun { engine: string; trials: number; seed: number; delivered: ReturnType<typeof summaryStat>; aOp: ReturnType<typeof summaryStat>; pAtLeastTarget?: ReturnType<typeof proportionEstimate>; pUnresolved: number; ledger: Record<string, number>; counts: Record<string, number> }
function runReview(): EngineRun {
  const engine = createReviewEngine(events, P, config);
  const p = engine.parameters({});
  const delivered: number[] = [];
  const aops: number[] = [];
  const ledger: Record<string, number> = {};
  const cnt: Record<string, number> = {};
  let unresolved = 0;
  for (let i = 0; i < trials; i++) {
    const r = engine.simulate(N, 2, (seed + Math.imul(i + 1, 2654435761)) >>> 0, p, opts);
    delivered.push(discardAll && r.unresolvedSilent ? 0 : r.usefulThroughput);
    aops.push(r.operationalAvailability);
    if (r.unresolvedSilent) unresolved++;
    for (const [k, v] of Object.entries(r.ledger)) ledger[k] = (ledger[k] ?? 0) + v / (trials * hours);
    for (const [k, v] of Object.entries(r.counts)) cnt[k] = (cnt[k] ?? 0) + v / trials;
  }
  const t = s.targets.goodput;
  return { engine: 'ReMAP review engine (reference catalogs/review-2026-10-09, factory version review-retained-progress.v2)', trials, seed, delivered: summaryStat(delivered), aOp: summaryStat(aops), pAtLeastTarget: t !== undefined ? proportionEstimate(delivered.filter((v) => v >= t).length, trials) : undefined, pUnresolved: unresolved / trials, ledger, counts: cnt };
}

// ---------------------------------------------------------------------------------------------------------------------
// V4 monthly engine inputs: four sources, class percentages, deterministic global recovery, no per-event rungs
function v4Params(): Record<string, unknown> {
  const engine = createMonthlyTrainingEngine();
  const d = engine.defaults;
  const fits = classFit.hard > 0 ? slotFit.map((f) => (f * totalFit) / classFit.hard) : [0, 0, 0, totalFit];
  const globalMinutes = (config.recoveryAttemptSeconds + (1 - config.recoverySuccess) * config.manualAdditionalSeconds) / 60;
  const params: Record<string, unknown> = {
    ...d,
    fits,
    slowPct: totalFit ? (100 * classFit.slow) / totalFit : 0,
    silentPct: totalFit ? (100 * classFit.sdc) / totalFit : 0,
    hardDetect: config.detectProbability * 100,
    hardSeconds: config.detectSeconds,
    fallbackMinutes: config.timeoutSeconds / 60,
    slowDetect: config.slowDetectProbability * 100,
    slowMinutes: config.slowDetectHours * 60,
    slowHours: config.slowLifetimeHours,
    slowLoss: config.slowLoss * 100,
    silentDetect: s.sdc.detection.coverage * 100,
    silentHours: s.sdc.detection.detectSeconds / 3600,
    silentFallbackHours: s.sdc.fallbackDelayHours,
    silentMinutes: ev.globalRecoveryS / 60,
    stepSeconds: s.sdc.stepRecovery?.stepSeconds ?? 1,
    intervalSeconds: ev.tauS,
    saveSeconds: w.deltaS,
    globalMinutes,
    localMinutes: globalMinutes,
    mode: 'global',
    cardsPerServer: s.topology.gpusPerNode,
    serversPerRack: s.topology.nodesPerRack,
    recoveryDomains: ch.elastic?.domains ?? 50,
  };
  engine.validate(params, N);
  return params;
}
function runV4(params: Record<string, unknown>): EngineRun & { effective: number; uptime: number } {
  const engine = createMonthlyTrainingEngine();
  const est = engine.estimate(N, params, trials, seed, hours) as { delivery: { mean: number; se: number; p05: number; p50: number; p95: number }; effective: { mean: number }; uptime: { mean: number }; cleanEnd: { mean: number }; ledger: Record<string, number>; stats: Record<string, number> };
  const d = est.delivery;
  const sd = d.se * Math.sqrt(trials);
  const stat = (m: number) => ({ mean: m, sd, ci95: (1.96 * sd) / Math.sqrt(trials), p05: d.p05, p50: d.p50, p95: d.p95, n: trials, ciMethod: 'none' as const });
  const ledger: Record<string, number> = {};
  for (const [k, v] of Object.entries(est.ledger)) ledger[k] = v / hours;
  return { engine: `ReMAP V4 monthly engine (${engine.version}, delivery = 0 when the month ends contaminated)`, trials, seed, delivered: stat(d.mean), aOp: { ...stat(est.uptime.mean), p05: NaN, p50: NaN, p95: NaN }, pUnresolved: 1 - est.cleanEnd.mean, ledger, counts: est.stats, effective: est.effective.mean, uptime: est.uptime.mean };
}

// ---------------------------------------------------------------------------------------------------------------------
const hacd = { delivered: ev.deliveredGoodput, deliveredRetained: ev.sdc?.delivery.deliveredRetained ?? ev.deliveredGoodput, deliveredDiscardAll: ev.sdc?.delivery.deliveredDiscardAll ?? ev.deliveredGoodput, aOp: ev.operationalAvailability, pUnresolved: ev.sdc?.delivery.pUnresolvedAtEnd ?? 0, ledger: ev.ledger, tauS: ev.tauS, detectS: ev.detectS, globalRecoveryS: ev.globalRecoveryS };
const noChain = cloneScenario(s);
noChain.mechanisms = { ...noChain.mechanisms, predict: undefined, netfail: undefined, replay: undefined, hotswap: undefined, elastic: undefined, process: undefined, overheads: {} };
const evNoChain = evaluateScenario(noChain).training!;
const out: Record<string, unknown> = { scenario: { id: s.meta.id, name: s.meta.name, cards: N, hours, target: s.targets.goodput, terminalRule: s.sdc.terminalRule }, classFitPerCardHour: classFit, hacdClosedForm: hacd, notes };
let review: EngineRun | undefined;
let v4: (EngineRun & { effective: number; uptime: number }) | undefined;
let v4params: Record<string, unknown> | undefined;
if (engineChoice !== 'v4') {
  review = runReview();
  out.review = review;
  if (withLedger) {
    const led = simulateScenarioLedger(s, { trials, seed, target: s.targets.goodput });
    out.hacdLedger = { delivered: led.summary.delivered, aOp: led.summary.operationalAvailability, pAtLeastTarget: led.summary.pAtLeastTargetInterval, pUnresolved: led.summary.pUnresolvedAtEnd, ledger: led.summary.ledger };
  }
}
if (engineChoice !== 'review') {
  v4params = v4Params();
  v4 = runV4(v4params);
  out.v4 = { ...v4, hacdWithoutChain: { deliveredRetained: evNoChain.sdc?.delivery.deliveredRetained ?? evNoChain.deliveredGoodput, deliveredDiscardAll: evNoChain.sdc?.delivery.deliveredDiscardAll ?? evNoChain.deliveredGoodput, aOp: evNoChain.operationalAvailability } };
}
if (flag('export')) {
  const catalogIds = new Set(REFERENCE_EVENTS.map((e) => e.id));
  const eventOverrides = events.filter((e) => catalogIds.has(e.id)).map((e) => ({ id: e.id, fit: e.fit, source: `HAC-D scenario ${s.meta.id ?? s.meta.name}`, evidence: 'scenario', rateBasis: 'npu-equivalent-hour', note: `${e.hacdId}: ${e.type} FIT per card-hour from the HAC-D class rate` }));
  const unmapped = events.filter((e) => !catalogIds.has(e.id)).map((e) => e.id);
  const model = Object.fromEntries(['checkpointComputeSeconds', 'checkpointSaveSeconds', 'recoveryAttemptSeconds', 'recoverySuccess', 'manualAdditionalSeconds', 'detectProbability', 'detectSeconds', 'timeoutSeconds', 'slowDetectProbability', 'slowDetectHours', 'slowLifetimeHours', 'slowLoss', 'sdcDelayHours'].map((k) => [k, (config as Record<string, unknown>)[k]]));
  const mechanisms = [opts.sdcDetect ? 'sdcDetect' : null, opts.step ? 'step' : null, opts.replay ? 'replay' : null, opts.process ? 'process' : null, opts.elastic ? 'elastic' : null].filter((x): x is string => !!x);
  const auditRequest = { cards: N, hours, trials, seed, target: s.targets.goodput ?? 0.9, targets: { [String(N)]: s.targets.goodput ?? 0.9 }, scales: [N], mechanisms, attribution: true, sensitivity: false, verifyRecommendation: true, recoveryOrder, model, policy: P, eventOverrides, candidateFitOverrides: [], lossBudgetMethod: 'equal', metricId: 'training.retained-clean-progress' };
  writeFileSync(flag('export')!, JSON.stringify({ hacd: out.scenario, reviewEngine: { events, policy: P, config, opts, seedPolicy: '(seed + imul(i+1, 2654435761)) >>> 0', note: 'createReviewEngine(events, policy, config).simulate(cards, 2, seed_i, parameters({}), opts)' }, auditRequest, auditRequestNotes: [`eventOverrides cover the ${eventOverrides.length} events whose ids exist in ReMAP's reference catalog; ${unmapped.length} other ids (${unmapped.slice(0, 6).join(', ')}${unmapped.length > 6 ? ', …' : ''}) need a ReMAP catalog import first`, 'mechanisms = the rungs and silent-corruption options active in the HAC-D scenario, so ReMAP\'s "combined" scenario equals this scenario and its baseline strips them', 'model = the 13 editable review-engine keys taken from the scenario (checkpoint from the evaluated interval); policy = the scenario\'s mechanism parameters', 'ReMAP recomputes class rates from the overridden FIT totals (its catalog arithmetic), as this bridge does'], v4: v4params ? { cards: N, hours, params: v4params, note: 'createMonthlyTrainingEngine().estimate(cards, params, trials, seed, hours)' } : undefined, notes }, null, 2));
  console.error(`wrote ${flag('export')}`);
}
if (json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const pct = (x: number, d = 2) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)} %` : '—');
  console.log(`${s.meta.name} — ${N.toLocaleString('en-US')} cards, ${hours} h window, terminal rule ${s.sdc.terminalRule}; class FIT per card-hour: interruption ${classFit.hard.toFixed(2)}, sub-health ${classFit.slow.toFixed(2)}, silent ${classFit.sdc.toFixed(2)}; ${events.length} engine events`);
  console.log(`HAC-D closed form: delivered ${pct(hacd.delivered)} (retain ${pct(hacd.deliveredRetained)} / discard-all ${pct(hacd.deliveredDiscardAll)}), A_op ${pct(hacd.aOp, 3)}, P(unresolved at end) ${pct(hacd.pUnresolved, 1)}; τ ${hacd.tauS.toFixed(0)} s, detection ${hacd.detectS.toFixed(1)} s, global recovery ${hacd.globalRecoveryS.toFixed(1)} s`);
  if (out.hacdLedger) {
    const L = out.hacdLedger as { delivered: ReturnType<typeof summaryStat>; aOp: ReturnType<typeof summaryStat>; pUnresolved: number };
    console.log(`HAC-D ledger simulation (${trials}): delivered ${pct(L.delivered.mean)} ± ${pct(L.delivered.ci95)} (P5 ${pct(L.delivered.p05, 1)}), A_op ${pct(L.aOp.mean, 3)}, P(unresolved) ${pct(L.pUnresolved, 1)}`);
  }
  if (review) {
    console.log(`${review.engine} (${trials} windows): delivered ${pct(review.delivered.mean)} ± ${pct(review.delivered.ci95)} (P5 ${pct(review.delivered.p05, 1)}), A_op ${pct(review.aOp.mean, 3)}, P(unresolved) ${pct(review.pUnresolved, 1)}${review.pAtLeastTarget ? `, P(≥ ${pct(s.targets.goodput ?? 0, 0)}) ${pct(review.pAtLeastTarget.p, 1)} [Wilson ${pct(review.pAtLeastTarget.low, 1)}–${pct(review.pAtLeastTarget.high, 1)}]` : ''}`);
    console.log(`  Δ engine − HAC-D closed form: delivered ${((review.delivered.mean - hacd.delivered) * 100).toFixed(2)} pt (CI ± ${(review.delivered.ci95 * 100).toFixed(2)}), A_op ${((review.aOp.mean - hacd.aOp) * 100).toFixed(3)} pt`);
    const rl = review.ledger;
    console.log(`  engine ledger: downtime ${pct(rl.downtime, 3)}, save ${pct(rl.save, 3)}, rollback ${pct(rl.rollback, 3)}, slowdown ${pct(rl.slowdown, 3)}, local ${pct(rl.localLoss, 3)}, terminal ${pct(rl.terminalInvalid, 3)} | HAC-D: downtime ${pct(hacd.ledger.downtime, 3)}, save ${pct(hacd.ledger.save, 3)}, rollback ${pct(hacd.ledger.rollback + hacd.ledger.sdcRollback, 3)}, slowdown ${pct(hacd.ledger.slowdown, 3)}, local ${pct(hacd.ledger.local, 3)}, terminal ${pct(hacd.ledger.terminal, 3)}`);
  }
  if (v4) {
    const h = (out.v4 as { hacdWithoutChain: { deliveredRetained: number; deliveredDiscardAll: number; aOp: number } }).hacdWithoutChain;
    console.log(`${v4.engine} (${trials} windows): delivery ${pct(v4.delivered.mean)} ± ${pct(v4.delivered.ci95)}, effective ${pct(v4.effective)}, uptime ${pct(v4.uptime, 3)}, P(contaminated at end) ${pct(v4.pUnresolved, 1)}`);
    console.log(`  HAC-D without the chain rungs (V4 has none): discard-all ${pct(h.deliveredDiscardAll)} ↔ delivery, retain ${pct(h.deliveredRetained)} ↔ effective (V4 freezes the correct work at the episode start, not at the last clean checkpoint), A_op ${pct(h.aOp, 3)} ↔ uptime`);
  }
  for (const n of notes) console.log(`- ${n}`);
}
