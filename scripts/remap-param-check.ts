#!/usr/bin/env -S node --import tsx
/**
 * Are the built-in 54-event example's parameters the same as ReMAP's reference audit? Compares every event FIT and
 * mechanism flag, the baseline settings and the eight mechanism policies of `ref-catalog-100k` with the untracked ReMAP
 * drop (references/expert-review-2026-10-09/{inputs.json, mechanism-policy.json, config.json}).
 * Usage: node --import tsx scripts/remap-param-check.ts [--remap remap/remap-main]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REFERENCE_FIXTURES, MECHANISM_LIBRARY, computeCounts, componentInstances } from '@hac-d/core';

const i = process.argv.indexOf('--remap');
const R = resolve(i >= 0 ? process.argv[i + 1] : process.env.REMAP_DIR ?? 'remap/remap-main', 'references/expert-review-2026-10-09');
const inputs = JSON.parse(readFileSync(resolve(R, 'inputs.json'), 'utf8'));
const policy = JSON.parse(readFileSync(resolve(R, 'mechanism-policy.json'), 'utf8')) as Record<string, Record<string, number>>;
const config = JSON.parse(readFileSync(resolve(R, 'config.json'), 'utf8'));
const s = REFERENCE_FIXTURES['ref-catalog-100k']();
const counts = computeCounts(s);
let fitDiff = 0;
let flagDiff = 0;
const legacy = new Map<string, Record<string, unknown>>(inputs.legacy.events.map((e: Record<string, unknown>) => [e.id as string, e]));
for (const e of inputs.current.events as { id: string; fit: number }[]) {
  const c = s.components.find((x) => x.id === e.id);
  if (!c) throw new Error(`event ${e.id} missing from the example`);
  const ci = componentInstances(c, counts, s.measures.subhealthThreshold);
  fitDiff = Math.max(fitDiff, Math.abs((ci.lambda + (ci.subhealth?.ratePerHour ?? 0) + ci.sdcLambda) * 1e9 - e.fit));
  const l = legacy.get(e.id);
  if (l?.type === 'hard') {
    const a = c.mechanisms ?? {};
    if ((a.replay ?? 0) !== (l.replay ? 1 : 0) || (a.process ?? 0) !== (l.process ? 1 : 0) || (a.elastic ?? 0) !== (l.elastic ? 1 : 0)) flagDiff++;
  }
}
console.log(`events: ${inputs.current.events.length} compared, max |FIT difference| ${fitDiff.toExponential(1)} per card-hour, mechanism-flag mismatches ${flagDiff}`);
const w = s.workload as Extract<typeof s.workload, { type: 'training' }>;
const rec = s.recovery as Extract<typeof s.recovery, { mode: 'mixture' }>;
const sh = s.components.find((c) => c.id === 'CORE-slow')!.subhealth!;
const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)) : String(a) === String(b));
const rows: [string, unknown, unknown][] = [
  ['checkpoint compute s', w.intervalS, config.checkpointComputeSeconds],
  ['checkpoint save s', w.deltaS, config.checkpointSaveSeconds],
  ['detect probability', rec.detection.coverage, config.detectProbability],
  ['detect s', rec.detection.autoSeconds, config.detectSeconds],
  ['timeout s', rec.detection.timeoutSeconds, config.timeoutSeconds],
  ['recovery attempt s', rec.automatic.seconds, config.recoveryAttemptSeconds],
  ['recovery success', rec.automatic.successProbability, config.recoverySuccess],
  ['manual s', rec.manual.seconds, config.manualAdditionalSeconds],
  ['slow detect probability', sh.detection?.probability, config.slowDetectProbability],
  ['slow detect h', sh.detection?.delayHours, config.slowDetectHours],
  ['slow lifetime h', sh.durationHours, config.slowLifetimeHours],
  ['slow loss', 1 - sh.performance, config.slowLoss],
  ['sdc immediate coverage', s.sdc.detection.coverage, config.sdcImmediateProbability],
  ['sdc fallback delay h', s.sdc.fallbackDelayHours, config.sdcDelayHours],
  ['window h', w.durationDays * 24, config.horizonHours],
];
let settingDiff = 0;
for (const [k, a, b] of rows) {
  const ok = same(a, b);
  if (!ok) settingDiff++;
  console.log(`${k.padEnd(24)} HAC-D ${String(a).padEnd(8)} ReMAP ${String(b)}${ok ? '' : '   <-- differs'}`);
}
console.log(`terminal rule            HAC-D ${s.sdc.terminalRule}   ReMAP ${config.terminalRule} (same rule)`);
console.log(`goodput target (requirement, not a model parameter): HAC-D example ${s.targets.goodput}; ReMAP default target table 0.99 / 0.95 / 0.90 / 0.80 at 10k / 100k / 200k / 500k cards`);
let policyDiff = 0;
for (const [id, p] of Object.entries(policy)) {
  const mine = (MECHANISM_LIBRARY.find((x) => x.id === id)?.parameters ?? {}) as Record<string, number>;
  const diffs = Object.entries(p).filter(([k, v]) => !same(mine[k], v)).map(([k, v]) => `${k}: HAC-D ${mine[k]} vs ReMAP ${v}`);
  policyDiff += diffs.length;
  console.log(`${id.padEnd(10)} ${diffs.length ? 'DIFFERS ' + diffs.join('; ') : 'same ' + JSON.stringify(p)}`);
}
console.log(`HAC-D library entries without a ReMAP counterpart (inert until applied): ${MECHANISM_LIBRARY.map((m) => m.id).filter((id) => !(id in policy) && !['R-CKPT', 'R-MANUAL', 'H-PROTECT', 'H-RELIABILITY'].includes(id)).join(', ')}`);
console.log(`\nresult: ${fitDiff < 1e-9 && flagDiff === 0 && settingDiff === 0 && policyDiff === 0 ? 'SAME fault rates, flags, baseline settings and mechanism parameters' : 'DIFFERENCES found (see above)'}`);
