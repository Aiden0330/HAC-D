/**
 * Cross-check of HAC-D's closed forms against the latest ReMAP's vendored review engine (remap/remap-latest, commit eaacb05)
 * with its extension mechanisms switched on: the same 54-event catalog, the same mechanism-policy parameters and ReMAP's
 * explicit extension scenario (eligible 100 % / FP 50 %, success 95 %, failure 0 s, overhead 0 / ABFT 0.1 %). Coalitions:
 * originals (8), extensions (15), both (23) at 100k and 200k cards; A_op and delivered goodput, Student-t 95 % half-widths.
 * Usage: node --import tsx scripts/remap-latest-check.ts [--trials 400] [--remap remap/remap-latest] [--sizes 100000,200000]
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { REFERENCE_EVENTS } from '../packages/core/src/scenario/referenceEvents.js';
import { evaluateScenario } from '../packages/core/src/scenario/evaluate.js';
import { applyMechanisms, MECHANISM_LIBRARY } from '../packages/core/src/mechanisms/index.js';
import { AUDIT_CATALOG } from '../packages/core/src/mechanisms/auditCatalog.js';
import { summaryStat } from '../packages/core/src/math/stats.js';
import { REMAP_LATEST_PARAMS } from './remap-latest-allocation-98p5.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const TRIALS = Number(flag('trials') ?? 400);
const SIZES = (flag('sizes') ?? '100000,200000').split(',').map(Number);
const remapDir = resolve(flag('remap') ?? 'remap/remap-latest');
const OUT = flag('out') ?? 'docs/remap-latest-allocation-98p5/engine-check.json';
const require = createRequire(import.meta.url);
type Engine = { simulate: (cards: number, stage: number, seed: number, p: Record<string, unknown>, opts: Record<string, unknown>) => { operationalAvailability: number; usefulThroughput: number; ledger: Record<string, number>; counts: Record<string, number>; unresolvedSilent: boolean }; parameters: (opts?: Record<string, unknown>) => Record<string, unknown> };
const createReviewEngine = require(resolve(remapDir, 'packages/solvers/src/vendor/review-engine.cjs')) as (events: unknown[], P: unknown, config: unknown) => Engine;
const policy = require(resolve(remapDir, 'references/expert-review-2026-10-09/mechanism-policy.json')) as Record<string, Record<string, number>>;
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

// engine events: the catalog's 54 events with ReMAP's flags (identical FITs: 3333.3 / 69.0 / 48.3)
const events = REFERENCE_EVENTS.map((e) => ({ id: e.id, type: e.type, fit: e.fit, replay: e.replay, process: e.process, elastic: e.elastic }));
const fit = (t: string) => events.filter((e) => e.type === t).reduce((a, e) => a + e.fit, 0);
const total = fit('hard') + fit('slow') + fit('sdc');
const baseConfig = { scope: 'hac-d:ref-catalog', referenceCards: 10000, referenceMtbfHours: 30, referenceRateArithmetic: false, checkpointComputeSeconds: 300, checkpointSaveSeconds: 4, recoveryAttemptSeconds: 180, recoverySuccess: 0.99, manualAdditionalSeconds: 7200, detectProbability: 0.95, detectSeconds: 10, timeoutSeconds: 60, horizonHours: 720, shares: { hard: fit('hard') / total, slow: fit('slow') / total, sdc: fit('sdc') / total }, slowDetectProbability: 0.95, slowDetectHours: 5 / 60, slowLifetimeHours: 24, slowLoss: 0.05, sdcImmediateProbability: 0, sdcDelayHours: 120, sdcDelayDistribution: 'fixed', validationOverhead: 0 };
// ReMAP's extensionScenario(): generic fields + parameterSets (audit-extensions.ts)
const SETS: Record<string, Record<string, number>> = {
  'R-LINK-LOCAL': { pauseSeconds: 2 }, 'R-FABRIC-DEGRADE': { pauseSeconds: 2, communicationFraction: 0.3, bandwidthRatio: 0.75, repairSeconds: 1800 }, 'I-CONTAIN': {}, 'H-CONTROL-CONTINUITY': { pauseSeconds: 1 },
  'R-WARM-PROCESS': { stageSeconds: 20 }, 'R-RUNTIME-SNAPSHOT': { stageSeconds: 15 }, 'C-ASYNC': { blockSeconds: 1, durableLagSeconds: 10 }, 'C-LOSSLESS': { compressionRatio: 2, decompressSeconds: 10 },
  'D-RECOVERY-CLASSIFY': { manualProbability: 0.001 }, 'D-SDC-FP8': { coverage: 0.95, detectSeconds: 1 }, 'D-SDC-FP4': { coverage: 0.95, detectSeconds: 1 }, 'D-ABFT': { coverage: 0.9 }, 'D-NET-SDC': { coverage: 0.95, detectSeconds: 1 },
  'H-SDC-SCREEN': { reduction: 0.25 }, 'R-HCCL-ELASTIC': { stageSeconds: 15 }, 'R-CANN-GRAPH': { stageSeconds: 7.5 },
};
const extension = (id: string) => ({ id, eventIds: AUDIT_CATALOG.mechanisms.find((m) => m.id === id)!.eventCandidates, parameters: { eligibleShare: id === 'D-SDC-FP8' || id === 'D-SDC-FP4' ? 0.5 : 1, success: 0.95, failureSeconds: 0, overhead: id === 'D-ABFT' ? 0.001 : 0, ...SETS[id] }, source: 'ReMAP extensionScenario()', evidence: 'scenario' });
const ORIGINAL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
const EXT = MECHANISM_LIBRARY.filter((m) => m.audit && m.apply).map((m) => m.id);
const coalitions: Record<string, string[]> = { originals: ORIGINAL, extensions: EXT, all: [...ORIGINAL, ...EXT] };
const extra = flag('coalition'); if (extra) coalitions.custom = extra.split(',');

// H-SDC-SCREEN acts on the event FITs outside the engine (audit-enhanced-engine.ts)
function engineFor(ids: string[]): Engine {
  const exts = ids.filter((id) => EXT.includes(id)).map(extension);
  const screen = exts.find((m) => m.id === 'H-SDC-SCREEN');
  const evs = events.map((e) => (screen && screen.eventIds.includes(e.id) ? { ...e, fit: e.fit * (1 - screen.parameters.eligibleShare * screen.parameters.success * (screen.parameters as Record<string, number>).reduction) } : e));
  return createReviewEngine(evs, policy, { ...baseConfig, ...(exts.length ? { extensions: exts } : {}) });
}
const out: Record<string, unknown> = { generated: new Date().toISOString(), trials: TRIALS, sizes: SIZES, remap: remapDir, results: [] as unknown[] };
for (const N of SIZES) for (const [name, ids] of Object.entries(coalitions)) {
  const engine = engineFor(ids);
  const on = (id: string) => ids.includes(id);
  const p = engine.parameters({ fast: on('C-FAST'), hardDetect: on('D-HARD'), slowDetect: on('D-SLOW') });
  const opts = { replay: on('R-REPLAY'), elastic: on('R-ELASTIC'), process: on('R-PROCESS'), sdcDetect: on('D-SDC'), sdcCoverage: on('D-SDC') ? policy['D-SDC'].coverage : 0, step: on('R-SDC'), stepSeconds: policy['R-SDC'].stepSeconds, elasticSyncSeconds: policy['R-ELASTIC'].syncSeconds, recoveryOrder: ['replay', 'elastic', 'process'] };
  const a: number[] = [], d: number[] = [];
  const counts: Record<string, number> = {};
  for (let i = 0; i < TRIALS; i++) {
    const r = engine.simulate(N, 2, (1 + Math.imul(i + 1, 2654435761)) >>> 0, p, opts);
    a.push(r.operationalAvailability); d.push(r.usefulThroughput);
    for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v / TRIALS;
  }
  const hacd = evaluateScenario(applyMechanisms(referenceCatalog(N), ids, REMAP_LATEST_PARAMS), { structure: false }).training!;
  const row = { N, coalition: name, ids, remap: { aOp: summaryStat(a), delivered: summaryStat(d), counts }, hacd: { aOp: hacd.operationalAvailability, delivered: hacd.deliveredGoodput, sdcCoverage: hacd.sdc?.coverage, recoveryS: hacd.recoveryS } };
  (out.results as unknown[]).push(row);
  log(`N=${N} ${name}: ReMAP A_op ${(row.remap.aOp.mean * 100).toFixed(3)} ± ${(row.remap.aOp.ci95 * 100).toFixed(3)} | HAC-D ${(hacd.operationalAvailability * 100).toFixed(3)}; delivered ReMAP ${(row.remap.delivered.mean * 100).toFixed(2)} ± ${(row.remap.delivered.ci95 * 100).toFixed(2)} | HAC-D ${(hacd.deliveredGoodput * 100).toFixed(2)}`);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
