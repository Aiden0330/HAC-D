/**
 * Data of the Ascend allocation report set (docs/ASCEND_ALLOCATION_METHODOLOGY.html, docs/ASCEND_ALLOCATION_FINDINGS_*.html) — v5:
 * a thin wrapper over the core's `budgetFromRecords` (packages/core/src/budget): the built-in topology records under the default
 * mechanism set at 10k / 100k / 200k / 500k NPUs, A_op ≥ 98.5 %, 400 × 30-day windows. Every block of the output is the core's
 * `BudgetResult` (today, requirement, hardware alone, optimal plan, the window rule's recommended design with its layer / unit /
 * rung decomposition and the pause each mechanism removes per layer).
 * Usage: node --import tsx scripts/ascend-allocation-data.ts [--trials 400] [--sizes 10000,100000,200000,500000] [--target 0.985]
 *        [--records a.json,b.json] [--set set.json] [--rates override.json] [--out docs/backup/ascend-allocation/results.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { budgetFromRecords } from '../packages/core/src/budget/index.js';
import { BUILTIN_TOPOLOGY_RECORDS, parseTopologyRecord } from '../packages/core/src/records/topologyRecord.js';
import { DEFAULT_MECHANISM_SET, parseMechanismSet } from '../packages/core/src/records/mechanismSet.js';
import { parseFaultRateOverride } from '../packages/core/src/records/faultRates.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/backup/ascend-allocation/results.json';
const TRIALS = Number(flag('trials') ?? 400);
const SIZES = (flag('sizes') ?? '10000,100000,200000,500000').split(',').map(Number);
const TARGET = Number(flag('target') ?? 0.985);
const records = flag('records') ? flag('records')!.split(',').map((p) => parseTopologyRecord(JSON.parse(readFileSync(p, 'utf8')))) : Object.values(BUILTIN_TOPOLOGY_RECORDS);
const set = flag('set') ? parseMechanismSet(JSON.parse(readFileSync(flag('set')!, 'utf8'))) : DEFAULT_MECHANISM_SET;
const rates = flag('rates') ? parseFaultRateOverride(JSON.parse(readFileSync(flag('rates')!, 'utf8'))) : undefined;
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);
const out = budgetFromRecords(records, set, { sizes: SIZES, target: TARGET, trials: TRIALS, seed: 1, rates, onProgress: (arch, n, step) => { if (step === 'today') log(`${arch} ${n}`); } });
for (const [arch, A] of Object.entries(out.archs)) for (const [n, z] of Object.entries(A.sizes)) {
  const kD = z.today.kpiDerated, rec = z.recommended, fin = rec.final;
  log(`${arch} ${n}: today ${(z.today.aOp * 100).toFixed(3)} / ${(kD.aOp * 100).toFixed(3)} % (MTBF ${kD.mtbfHwH.toFixed(3)} h, MTTR ${kD.mttrS.toFixed(1)} s, P ${(z.today.window.pAtLeastTarget * 100).toFixed(0)} %) | B ${z.required.B.toFixed(1)} s/h → MTBF ≥ ${z.required.mtbfAtTodayMttrH.toFixed(2)} h or MTTR ≤ ${z.required.mttrAtTodayMtbfS.toFixed(1)} s | hw-only ${z.hardwareOnly.factor ? `×${z.hardwareOnly.factor.toFixed(3)}` : `slack ×${(z.hardwareOnly.slack ?? 0).toFixed(2)}`} | optimal ${z.optimal.mechanisms.join('+') || '—'} | ${z.optimal.levers.join('+') || '—'} | recommended ${rec.mechanisms.join('+') || '—'} | ${rec.levers.join('+') || '—'} k ${rec.k.toFixed(3)} (${rec.binding}${rec.escalated ? ', escalated' : ''}) → ${(fin.kpi.aOp * 100).toFixed(2)} / ${(fin.kpiDerated.aOp * 100).toFixed(2)} % P ${(rec.window.pAtLeastTarget * 100).toFixed(1)} % | MTBF ${fin.kpiDerated.mtbfHwH.toFixed(3)} h MTTR ${fin.kpiDerated.mttrS.toFixed(1)} s`);
}
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
