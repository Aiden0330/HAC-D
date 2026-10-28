/**
 * Dumps the INPUT tables that compute_golden_v5.py reads (packages/core/test/golden/inputs_v5/*.table.json).
 * Run from the repo root:  node --import tsx packages/core/test/golden/dump_inputs_v5.mjs
 *
 * The engine is used here only to build the scenarios (topology builders, mechanism / lever application, derating,
 * hardware factors) and to read back the per-class table: class id, fault unit, unit count, hard rate λ_i (1/h),
 * mechanism applicability, the chain parameters, detection / global recovery seconds, the recovery and sdc blocks and
 * the per-unit sub-health / silent-corruption rates. Those are inputs of the v5 formulas.
 * The fields meanPauseS, aOp, aRun, delivered and the three `other` rates are ENGINE OUTPUTS and are used by the
 * Python only where a golden case is declared an identity check (see golden-v5-report.md).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const outDir = join(here, 'inputs_v5');
mkdirSync(outDir, { recursive: true });

const [{ scenarioOf: scenario950 }, { scenarioOf: scenario910 }, { REMAP_LATEST_PARAMS }, M, S, W, P, E, T, B] = await Promise.all([
  import(join(root, 'scripts/ascend950-archs.ts')),
  import(join(root, 'scripts/ascend910c-archs.ts')),
  import(join(root, 'scripts/remap-latest-params.ts')),
  import(join(root, 'packages/core/src/mechanisms/index.ts')),
  import(join(root, 'packages/core/src/strategy/index.ts')),
  import(join(root, 'packages/core/src/strategy/window.ts')),
  import(join(root, 'packages/core/src/mechanisms/plan.ts')),
  import(join(root, 'packages/core/src/scenario/evaluate.ts')),
  import(join(root, 'packages/core/src/topology/index.ts')),
  import(join(root, 'packages/core/src/scenario/build.ts')),
]);

const results = JSON.parse(readFileSync(join(root, 'docs/backup/ascend-allocation/results.json'), 'utf8'));
const lib = new Map(T.unitFaultLibrary().map((f) => [f.id, f]));

function base(arch, n) {
  return arch === 'native' || arch === 'ubl128' ? scenario950(arch, n) : scenario910(arch, n);
}
const archKey = { native: 'native950', ubl128: 'ubl128', cm384: 'cm384', a3server: 'a3server' };

/** uniform hardware factor on every class with a positive failure rate (the plan's k) */
function factors(s, k) {
  return Object.fromEntries(s.components.filter((c) => c.failure.value > 0).map((c) => [c.id, k]));
}
function levers(ids) {
  return S.DEFAULT_LEVERS.filter((l) => ids.includes(l.id));
}

function table(s, design) {
  const r = E.evaluateScenario(s, { structure: false }).training;
  const counts = B.computeCounts(s);
  const count = new Map(s.components.map((c) => [c.id, B.componentInstances(c, counts).total]));
  return {
    design,
    detectS: r.chain.detectS,
    globalS: r.chain.globalS,
    params: r.chain.params,
    order: s.mechanisms.order ?? null,
    recovery: s.recovery,
    sdc: s.sdc ?? null,
    rows: r.chain.rows.map((x) => ({ id: x.id, unit: lib.get(x.id)?.unit ?? null, count: count.get(x.id) ?? null, ratePerHour: x.ratePerHour, meanPauseS: x.meanPauseS, applicable: x.applicable, recoveryStages: s.components.find((c) => c.id === x.id)?.recoveryStages ?? null })),
    other: {
      isolationPerHour: r.subhealth ? r.subhealth.isolationInterruptionsPerHour : 0,
      sdcDetectedPerHour: r.sdc ? r.sdc.detectedRatePerHour : 0,
      falseAlarmPerHour: r.falseAlarmRatePerHour,
      globalRecoveryS: r.globalRecoveryS,
      predictMigrationS: s.mechanisms.predict ? s.mechanisms.predict.migrationSeconds : null,
    },
    aOp: r.operationalAvailability,
    aRun: r.runningFraction,
    delivered: r.deliveredGoodput,
    // v5.5: the per-class silent-corruption detection inputs of §24.3 (an absolute class coverage, the conditional detectors' gains), for the detected-rate split of formula (3)
    slowSdcByClass: s.components.map((c) => ({ id: c.id, unit: lib.get(c.id)?.unit ?? null, count: count.get(c.id) ?? null, slowPerUnitPerHour: c.subhealth ? c.subhealth.ratePerHour : 0, sdcPerUnitPerHour: c.sdc ? c.sdc.ratePerHour : 0, sdcCoverage: c.sdc?.coverage ?? null, sdcExtraDetection: c.sdc?.extraDetection ?? null })),
  };
}

function write(name, obj) {
  const text = JSON.stringify(obj, null, 1);
  writeFileSync(join(outDir, name), text);
  console.log(name, (text.length / 1024).toFixed(1), 'KB', 'aOp', obj.aOp);
}

const plan = (arch, n) => results.archs[archKey[arch]].sizes[String(n)].recommended;

/** recommended design, nominal: mechanisms with the ReMAP-latest parameters, levers nominal, hardware factor k */
function recommendedNominal(arch, n) {
  const p = plan(arch, n);
  let s = M.applyMechanisms(base(arch, n), p.mechanisms, REMAP_LATEST_PARAMS);
  s = S.applyLevers(s, levers(p.levers), null);
  s = S.withHardwareFactors(s, factors(s, p.k));
  return { s, p };
}
/** recommended design, derated, at hardware factor k = 1 (G5): mechanisms applied, derated, levers derated */
function recommendedDerated1(arch, n, order = 'derate-then-levers') {
  const p = plan(arch, n);
  let s = M.applyMechanisms(base(arch, n), p.mechanisms, REMAP_LATEST_PARAMS);
  if (order === 'derate-then-levers') {
    s = W.deratedOf(s);
    s = S.applyLevers(s, levers(p.levers), P.DERATE_DEFAULT);
  } else {
    s = S.applyLevers(s, levers(p.levers), P.DERATE_DEFAULT);
    s = W.deratedOf(s);
  }
  return { s, p };
}

for (const [arch, n] of [['native', 500000], ['cm384', 200000], ['a3server', 10000]]) {
  const b = base(arch, n);
  const name = `${archKey[arch]}-${n / 1000}k`;
  write(`${name}.table.json`, table(b, { arch, npus: n, mechanisms: [], levers: [], k: 1, derated: false }));
  write(`${name}.derated.table.json`, table(W.deratedOf(b), { arch, npus: n, mechanisms: [], levers: [], k: 1, derated: true }));
}
// v5.5 (fifth review D4, M1, M2): one mechanism each on today's a3server 10k — per-class recovery stages (R-RUNTIME-SNAPSHOT: the
// class's own global recovery g_i and stage split, §24.2), the predictor's false alarms in F (P-PREDICT, formula (3)'s D) and a
// per-class silent-corruption detector (D-ABFT: the detected-rate split of formula (3), §24.3)
for (const [suffix, mech] of [['snapshot', 'R-RUNTIME-SNAPSHOT'], ['predict', 'P-PREDICT'], ['abft', 'D-ABFT']]) {
  const s = M.applyMechanisms(base('a3server', 10000), [mech], REMAP_LATEST_PARAMS);
  write(`a3server-10k.${suffix}.table.json`, table(s, { arch: 'a3server', npus: 10000, mechanisms: [mech], levers: [], k: 1, derated: false }));
}
for (const [arch, n] of [['native', 500000], ['cm384', 200000]]) {
  const name = `${archKey[arch]}-${n / 1000}k`;
  const { s, p } = recommendedNominal(arch, n);
  write(`${name}.recommended.table.json`, table(s, { arch, npus: n, mechanisms: p.mechanisms, levers: p.levers, k: p.k, binding: p.binding, derated: false }));
  const d1 = recommendedDerated1(arch, n);
  const t1 = table(d1.s, { arch, npus: n, mechanisms: p.mechanisms, levers: p.levers, k: 1, kRecommended: p.k, binding: p.binding, derated: true, construction: 'applyMechanisms → deratedOf → applyLevers(DERATE_DEFAULT)' });
  write(`${name}.recommended-derated-k1.table.json`, t1);
  const d2 = recommendedDerated1(arch, n, 'levers-then-derate');
  const t2 = table(d2.s, {});
  const same = JSON.stringify({ ...t1, design: null }) === JSON.stringify({ ...t2, design: null });
  console.log(`  ${name}: the two derating orders give ${same ? 'identical' : 'DIFFERENT'} tables`, same ? '' : `aOp ${t1.aOp} vs ${t2.aOp}`);
  // G5 (b): the same derated design at the engine's recommended k (the bisection root of A_op,der(k) = A*)
  const dk = S.withHardwareFactors(d1.s, factors(d1.s, p.k));
  write(`${name}.recommended-derated-k.table.json`, table(dk, { arch, npus: n, mechanisms: p.mechanisms, levers: p.levers, k: p.k, binding: p.binding, derated: true, construction: 'applyMechanisms → deratedOf → applyLevers(DERATE_DEFAULT) → withHardwareFactors(k)' }));
}
