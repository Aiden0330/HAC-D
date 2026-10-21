/**
 * Atlas 950 by topology level — cluster / SuperPoD / compute cabinet (Pod) / node / NPU — for docs/ATLAS950_LEVEL_ALLOCATION.{zh,en}.html:
 * which reference mechanism sits at which level, what each level contributes, and the allocation result of hardware and mechanisms
 * at each level for A_op ≥ 98.5 % (nominal and derated).
 *
 * Inputs (as requested: reference mechanisms only, FIT values of ReMAP, allocation methods of HAC-D):
 *  - FIT: the 54-event catalog of ReMAP / ai-cluster-reliability (review-2026-10-09; per card, NPU-equivalent business-impact events),
 *    unconverted — `referenceCatalog(N)`; no HAC-D per-unit conversion and no added scale-out classes;
 *  - mechanisms: ReMAP's reference set (`auditReferenceMechanisms` = sdcDetect, step, replay, process, elastic, fast = D-SDC, R-SDC,
 *    R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST) at ReMAP's policy parameters, on ReMAP's baseline recovery (detection 95 % in 10 s else
 *    60 s, R-CKPT automatic 180 s at 99 %, R-MANUAL 2 h); no other mechanism is added;
 *  - levels: each catalog event on exactly one level (ReMAP's architecture rule), from the catalog's own scope (card → NPU, server →
 *    node, rack → compute cabinet, job → cluster) with one Atlas 950 refinement: FABRIC and OPT (UB switching and its optics, which
 *    span the 1,024-NPU UB domain) at the SuperPoD level; instance counts from the Atlas 950 SuperPoD (1,024 NPUs, 64 per cabinet,
 *    8 per node);
 *  - allocation (HAC-D): the pause budget B = 3600·((1 − φ)/A* − 1) − F; P1 hardware alone (allocateStrategy MTTF-first, splits
 *    ARINC / AGREE / minimum effort); P2 recovery chain alone (HAC-D recovery factor: detection, automatic attempt and manual times
 *    scaled together); P3 least-effort mix (allocateStrategy optimal with the recovery levers — the R-CKPT / R-MANUAL parameters —
 *    and ARINC or minimum-effort hardware); every design holds nominally and with every mechanism derated (coverage −5 pt, success
 *    −8 pt, times ×1.5); window-ledger verification of P3; per-level Shapley of the reference mechanisms (exact, 64 coalitions);
 *    acceptance limits of each reference mechanism's parameters on the P3 design (bisection on the engine); the recommended design
 *    of docs/ASCEND_AVAILABILITY_ALLOCATION.html (P3 that also passes the window check, scaling-common recommendDesign) and the
 *    window check of today's design at every size.
 * Usage: node --import tsx scripts/a950-level-allocation.ts [--trials 400] [--out docs/a950-level-allocation/results.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { referenceCatalog } from '../packages/core/src/scenario/examples.js';
import { REFERENCE_EVENTS } from '../packages/core/src/scenario/referenceEvents.js';
import { applyMechanisms, stripMechanisms, mechanismById, DEFAULT_PLAYERS } from '../packages/core/src/mechanisms/index.js';
import { allocateStrategy, applyLevers, withHardwareFactors, DEFAULT_LEVERS, LEVER_NAMES, type StrategyResult, type HardwareSplit } from '../packages/core/src/strategy/index.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { scaleRecovery } from '../packages/core/src/scenario/analysis.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';
import type { TrainingKpis } from '../packages/core/src/scenario/evaluate.js';
import { tr, kpi, chainSplit, recommendDesign, windowCheck } from './scaling-common.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/a950-level-allocation/results.json';
const TRIALS = Number(flag('trials') ?? 400);
const SIZES = [10000, 100000, 200000, 500000];
const MAIN = 500000;
const TARGET = 0.985;
const t0 = Date.now();
const log = (m: string) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

type L = { zh: string; en: string };
/** the five levels, top-down; cards per instance and instance count of the Atlas 950 SuperPoD (1,024 NPUs, 64 per cabinet, 8 per node) */
const LEVELS: { id: string; name: L; scope: string; domains: string[]; cardsPer: (n: number) => number; instances: (n: number) => number }[] = [
  { id: 'cluster', name: { zh: '集群级', en: 'Cluster' }, scope: 'job', domains: ['STORAGE', 'UNKNOWN'], cardsPer: (n) => n, instances: () => 1 },
  { id: 'superpod', name: { zh: '超节点级', en: 'SuperPoD' }, scope: 'rack → SuperPoD (950)', domains: ['FABRIC', 'OPT'], cardsPer: () => 1024, instances: (n) => Math.ceil(n / 1024) },
  { id: 'cabinet', name: { zh: '计算柜（Pod）级', en: 'Compute cabinet (Pod)' }, scope: 'rack', domains: ['BOXIO', 'POWER', 'COOL', 'MGMT'], cardsPer: () => 64, instances: (n) => Math.ceil(n / 64) },
  { id: 'node', name: { zh: '节点级', en: 'Node' }, scope: 'server', domains: ['NIC', 'CPU', 'DDR', 'SSD'], cardsPer: () => 8, instances: (n) => Math.ceil(n / 8) },
  { id: 'npu', name: { zh: 'NPU 级', en: 'NPU' }, scope: 'card', domains: ['CORE', 'SRAM', 'IOD', 'MODULE', 'MEMT', 'MEMP'], cardsPer: () => 1, instances: (n) => n },
];
const LEVEL_OF: Record<string, string> = Object.fromEntries(LEVELS.flatMap((l) => l.domains.map((d) => [d, l.id])));
const domainOf = (id: string) => id.replace(/@.*$/, '').replace(/-(hard|slow|sdc)$/, '');
const levelOf = (id: string) => { const l = LEVEL_OF[domainOf(id)]; if (!l) throw new Error(`no level for ${id}`); return l; };

/** where each reference mechanism and each baseline recovery element is deployed */
const DEPLOY: Record<string, { level: string; how: L }> = {
  'R-REPLAY': { level: 'npu', how: { zh: '芯片运行时：算子 / 集合通信在 NPU 上重执行（CANN、HCCL）', en: 'device runtime: operator / collective re-executed on the NPU (CANN, HCCL)' } },
  'D-SDC': { level: 'npu', how: { zh: '芯片与框架：step 级计算校验在 NPU 上运行', en: 'device and framework: step-level compute checks run on the NPU' } },
  'R-SDC': { level: 'npu', how: { zh: '芯片：HBM 中保留干净 step 状态，就地重算', en: 'device: a clean step state kept in HBM, recomputed in place' } },
  'R-PROCESS': { level: 'node', how: { zh: '节点：重建训练进程 / 容器（Pod 重调度）', en: 'node: the training process / container is rebuilt (pod rescheduling)' } },
  'R-ELASTIC': { level: 'cluster', how: { zh: '集群：50 个 DP 域跨超节点，故障域局部恢复', en: 'cluster: 50 DP domains across SuperPoDs, the failed domain recovers locally' } },
  'C-FAST': { level: 'cluster', how: { zh: '集群：作业检查点与共享存储（周期 60 s、阻塞 1 s）', en: 'cluster: job checkpoints and shared storage (60 s period, 1 s blocking)' } },
  'detect': { level: 'cluster', how: { zh: '集群管理：中断检测（基线 95 % 在 10 s，其余 60 s 超时）', en: 'cluster management: interruption detection (baseline 95 % in 10 s, the rest by a 60 s timeout)' } },
  'R-CKPT': { level: 'cluster', how: { zh: '集群：全局 CKPT 自动恢复（基线 180 s、成功 99 %）', en: 'cluster: global checkpoint automatic recovery (baseline 180 s at 99 %)' } },
  'R-MANUAL': { level: 'cluster', how: { zh: '运维：自动失败后人工诊断与恢复（基线 2 h）', en: 'operations: manual diagnosis and recovery after a failed automatic attempt (baseline 2 h)' } },
  'isolate': { level: 'cluster', how: { zh: '集群监控：亚健康检出（95 %、5 min）后隔离，暂停一次全局恢复', en: 'cluster monitoring: sub-healthy units isolated after detection (95 %, 5 min), one global-recovery pause' } },
};
const REF = [...DEFAULT_PLAYERS];

/* ---------------- scenarios ---------------- */
const base = (n: number) => applyMechanisms(referenceCatalog(n), REF);
/** every applied mechanism re-applied with derated parameters (HAC-D's derated yardstick) */
function deratedOf(sc: Scenario): Scenario {
  const ids = Object.entries(sc.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  const rec = Object.fromEntries(Object.entries(sc.mechanisms.applied ?? {}).map(([id, r]) => [id, derateParameters(r.parameters, DERATE_DEFAULT)]));
  return ids.length ? applyMechanisms(stripMechanisms(sc, ids), ids, rec) : sc;
}

/* ---------------- per-level read-out of one design ---------------- */
const SLOW_FIT: Record<string, number> = {}, SDC_FIT: Record<string, number> = {};
for (const e of REFERENCE_EVENTS) { if (e.type === 'slow') SLOW_FIT[e.domainId] = e.fit; if (e.type === 'sdc') SDC_FIT[e.domainId] = e.fit; }
function levels(sc: Scenario, t: TrainingKpis = tr(sc)) {
  const k = kpi(sc, t);
  const out: Record<string, { lam: number; c: number; iso: number; sdc: number; rows: { id: string; ratePerHour: number; meanPauseS: number; pGlobal: number }[] }> = Object.fromEntries(LEVELS.map((l) => [l.id, { lam: 0, c: 0, iso: 0, sdc: 0, rows: [] }]));
  for (const r of t.chain.rows) {
    const lv = out[levelOf(r.id)];
    lv.lam += r.ratePerHour; lv.c += r.ratePerHour * r.meanPauseS;
    lv.rows.push({ id: r.id, ratePerHour: r.ratePerHour, meanPauseS: r.meanPauseS, pGlobal: r.pGlobal });
  }
  // the other event classes, split by the per-card FIT of each level's slow / silent classes (one detection probability and one
  // coverage for every class in the reference set, so the split is exact)
  const slowTot = Object.values(SLOW_FIT).reduce((a, b) => a + b, 0), sdcTot = Object.values(SDC_FIT).reduce((a, b) => a + b, 0);
  for (const l of LEVELS) {
    out[l.id].iso = k.other[0].sPerH * l.domains.reduce((a, d) => a + (SLOW_FIT[d] ?? 0), 0) / slowTot;
    out[l.id].sdc = k.other[1].sPerH * l.domains.reduce((a, d) => a + (SDC_FIT[d] ?? 0), 0) / sdcTot;
  }
  return { k, levels: out };
}
const pauseVec = (x: ReturnType<typeof levels>) => Object.fromEntries(LEVELS.map((l) => [l.id, x.levels[l.id].c + x.levels[l.id].iso + x.levels[l.id].sdc]));

/** where each level's hard interruptions end on today's chain (no custom rungs in the reference set) */
function ends(sc: Scenario, t: TrainingKpis) {
  if (sc.recovery.mode !== 'mixture') throw new Error('mixture recovery expected');
  const autoS = sc.recovery.automatic.seconds;
  const acc: Record<string, Record<string, number>> = Object.fromEntries(LEVELS.map((l) => [l.id, {}]));
  const lam: Record<string, number> = Object.fromEntries(LEVELS.map((l) => [l.id, 0]));
  for (const r of t.chain.rows) {
    const o = chainSplit(t.chain.detectS, t.chain.globalS, autoS, t.chain.params, r.applicable, sc.mechanisms.order);
    const lv = levelOf(r.id);
    lam[lv] += r.ratePerHour;
    for (const [k, v] of Object.entries(o.probs)) acc[lv][k] = (acc[lv][k] ?? 0) + r.ratePerHour * v;
  }
  return Object.fromEntries(LEVELS.map((l) => [l.id, Object.fromEntries(Object.entries(acc[l.id]).map(([k, v]) => [k, v / lam[l.id]]))]));
}

/* ---------------- exact Shapley of the six reference mechanisms, per level (value = pause s/h of the level) ---------------- */
function shapleyByLevel(n: number) {
  const bare = referenceCatalog(n);
  const ids = REF;
  const m = ids.length;
  const cache = new Map<number, { pause: Record<string, number>; aOp: number }>();
  const val = (mask: number) => {
    let v = cache.get(mask);
    if (!v) {
      // R-SDC acts only with D-SDC (ReMAP: “无 D-SDC 时无效”): a coalition without D-SDC drops R-SDC
      const sel = ids.filter((_, i) => mask & (1 << i)).filter((id) => !(id === 'R-SDC' && !(mask & (1 << ids.indexOf('D-SDC')))));
      const sc = sel.length ? applyMechanisms(bare, sel) : bare;
      const x = levels(sc);
      v = { pause: pauseVec(x), aOp: x.k.aOp };
      cache.set(mask, v);
    }
    return v;
  };
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
  const out: Record<string, { aOp: number; byLevel: Record<string, number> }> = {};
  ids.forEach((id, i) => {
    let aOp = 0;
    const byLevel: Record<string, number> = Object.fromEntries(LEVELS.map((l) => [l.id, 0]));
    for (let mask = 0; mask < 1 << m; mask++) {
      if (mask & (1 << i)) continue;
      const s = mask.toString(2).split('').filter((ch) => ch === '1').length;
      const w = (fact(s) * fact(m - s - 1)) / fact(m);
      const a = val(mask), b = val(mask | (1 << i));
      aOp += w * (b.aOp - a.aOp);
      for (const l of LEVELS) byLevel[l.id] += w * (a.pause[l.id] - b.pause[l.id]); // pause removed (s/h)
    }
    out[id] = { aOp, byLevel };
  });
  const none = val(0), all = val((1 << m) - 1);
  return { gains: out, none: { pause: none.pause, aOp: none.aOp }, all: { pause: all.pause, aOp: all.aOp } };
}

/* ---------------- allocation ---------------- */
const strip = (r: StrategyResult) => ({
  feasible: r.feasible, levers: r.levers, mechanisms: r.mechanisms, effort: r.effort, final: r.final, baseline: r.baseline, verification: r.verification ?? null,
  hardware: { needed: r.hardware.needed, effort: r.hardware.effort, slackFactor: r.hardware.slackFactor ?? null, rows: r.hardware.rows.map((h) => ({ id: h.id, level: levelOf(h.id), currentFit: h.currentFit, allowedFit: h.allowedFit, factor: h.factor, atFloor: h.atFloor })) }, // per-card FIT (one unit per card in the catalog)
  notes: r.notes,
});
/** the derated twin of a strategy's final design (the strategy's own construction), checked against its derated value */
function deratedFinal(s: Scenario, r: StrategyResult): Scenario {
  const ids = Object.entries(s.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  const params = Object.fromEntries(Object.entries(s.mechanisms.applied ?? {}).map(([id, x]) => [id, derateParameters(x.parameters, DERATE_DEFAULT)]));
  let d = applyMechanisms(stripMechanisms(s, ids), ids, params);
  d = applyLevers(d, DEFAULT_LEVERS.filter((l) => r.levers.includes(l.id)), DERATE_DEFAULT);
  d = withHardwareFactors(d, Object.fromEntries(r.hardware.rows.map((h) => [h.id, h.factor])));
  const a = tr(d).operationalAvailability;
  if (Math.abs(a - r.final.derated) > 1e-9) throw new Error(`derated twin ${a} vs strategy ${r.final.derated}`);
  return d;
}
/** HAC-D recovery factor: the largest g ≤ 1 with A_op(detection, automatic and manual times × g) ≥ target, nominally and derated */
function recoveryFactor(s: Scenario, sDer: Scenario) {
  const ok = (g: number) => tr(scaleRecovery(s, g)).operationalAvailability >= TARGET && tr(scaleRecovery(sDer, g)).operationalAvailability >= TARGET;
  if (ok(1)) return 1;
  if (!ok(1e-6)) return NaN;
  let lo = 1e-6, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}
/** the worst value of one reference-mechanism parameter that still meets the target on a design (others unchanged) */
function acceptanceLimit(sc: Scenario, id: string, key: string, dir: 'down' | 'up', extreme: number) {
  const p0 = sc.mechanisms.applied?.[id]?.parameters;
  if (!p0) return null;
  const at = (v: number) => tr(applyMechanisms(sc, [id], { [id]: { ...p0, [key]: v } })).operationalAvailability;
  const v0 = p0[key];
  if (at(v0) < TARGET) return { nominal: v0, limit: null, binding: true };
  if (at(extreme) >= TARGET) return { nominal: v0, limit: extreme, binding: false };
  let good = v0, bad = extreme;
  for (let i = 0; i < 50; i++) { const mid = (good + bad) / 2; if (at(mid) >= TARGET) good = mid; else bad = mid; }
  return { nominal: v0, limit: good, binding: true, dir };
}

const LIMITS: { id: string; key: string; dir: 'down' | 'up'; extreme: number }[] = [
  { id: 'R-REPLAY', key: 'success', dir: 'down', extreme: 0 }, { id: 'R-REPLAY', key: 'successSeconds', dir: 'up', extreme: 3600 },
  { id: 'R-PROCESS', key: 'success', dir: 'down', extreme: 0 }, { id: 'R-PROCESS', key: 'successSeconds', dir: 'up', extreme: 3600 },
  { id: 'R-ELASTIC', key: 'success', dir: 'down', extreme: 0 }, { id: 'R-ELASTIC', key: 'syncSeconds', dir: 'up', extreme: 3600 }, { id: 'R-ELASTIC', key: 'failureSeconds', dir: 'up', extreme: 3600 },
];

function perSize(n: number, full: boolean) {
  const s = base(n), sDer = deratedOf(s);
  const tN = tr(s), tD = tr(sDer);
  const nom = levels(s, tN), der = levels(sDer, tD);
  const B = (k: ReturnType<typeof kpi>) => 3600 * ((1 - k.phi) / TARGET - 1) - k.F;
  const budget = { nominal: B(nom.k), derated: B(der.k), sumCNominal: nom.k.sumLP, sumCDerated: der.k.sumLP };
  const run = (strategy: 'mttf-first' | 'optimal', split: HardwareSplit, levers: boolean, verify = false) => allocateStrategy(s, { strategy, target: TARGET, candidates: [], levers: levers ? DEFAULT_LEVERS : false, hardwareSplit: split, ...(verify ? { verify: { trials: TRIALS, seed: 1 } } : {}) });
  const p1 = { arinc: run('mttf-first', 'arinc', false), agree: run('mttf-first', 'agree', false), minEffort: run('mttf-first', 'min-effort', false) };
  const p3 = { arinc: run('optimal', 'arinc', true, full), minEffort: run('optimal', 'min-effort', true) };
  const g = recoveryFactor(s, sDer);
  const res: Record<string, unknown> = {
    npus: n,
    instances: Object.fromEntries(LEVELS.map((l) => [l.id, l.instances(n)])),
    today: { aOp: nom.k.aOp, aOpDerated: der.k.aOp, mtbfHwH: nom.k.mtbfHwH, mttrS: nom.k.mttrS, mttrDerS: der.k.mttrS, other: nom.k.other, phi: nom.k.phi, delivered: nom.k.delivered, levels: nom.levels, levelsDerated: der.levels },
    budget,
    p1: Object.fromEntries(Object.entries(p1).map(([k, r]) => [k, strip(r)])),
    p2: { factor: g, recovery: Number.isFinite(g) ? scaleRecovery(s, g).recovery : null, levels: Number.isFinite(g) ? levels(scaleRecovery(s, g)).levels : null, levelsDerated: Number.isFinite(g) ? levels(scaleRecovery(sDer, g)).levels : null, aOp: Number.isFinite(g) ? tr(scaleRecovery(s, g)).operationalAvailability : null, aOpDerated: Number.isFinite(g) ? tr(scaleRecovery(sDer, g)).operationalAvailability : null, phi: Number.isFinite(g) ? kpi(scaleRecovery(s, g)).phi : null, phiDerated: Number.isFinite(g) ? kpi(scaleRecovery(sDer, g)).phi : null },
    p3: Object.fromEntries(Object.entries(p3).map(([k, r]) => [k, strip(r)])),
  };
  // the recommended design (P3 + window check) and today's window check
  const rec = recommendDesign(s, p3.arinc.levers, TARGET, TRIALS);
  const rN = levels(rec.nom), rD = levels(rec.der), plN = tr(rec.planNom);
  res.todayWindow = windowCheck(s, TARGET, TRIALS);
  res.recommended = {
    levers: rec.levers, leverEffort: rec.leverEffort, escalated: rec.escalated, tried: rec.tried, kMean: rec.kMean, kPlan: rec.kPlan, k: rec.k, binding: rec.binding,
    window: rec.window, windowPlan: rec.windowPlan,
    plan: { aOp: plN.operationalAvailability, aOpDerated: tr(rec.planDer).operationalAvailability, delivered: plN.deliveredGoodput },
    atLimit: { aOp: rN.k.aOp, aOpDerated: rD.k.aOp, phi: rN.k.phi, phiDerated: rD.k.phi, F: rN.k.F, FDerated: rD.k.F, delivered: rN.k.delivered, levels: rN.levels, levelsDerated: rD.levels },
  };
  if (full) {
    // per-level decomposition of P3 (ARINC): today → levers → hardware, nominal and derated
    const r = p3.arinc;
    const leversOnly = applyLevers(s, DEFAULT_LEVERS.filter((l) => r.levers.includes(l.id)), null);
    const leversOnlyDer = applyLevers(sDer, DEFAULT_LEVERS.filter((l) => r.levers.includes(l.id)), DERATE_DEFAULT);
    const finNom = r.scenario, finDer = deratedFinal(s, r);
    const fN = levels(finNom), fD = levels(finDer);
    (res.p3 as Record<string, unknown>).decomposition = {
      leversNominal: levels(leversOnly).levels, leversDerated: levels(leversOnlyDer).levels,
      kpiLevers: { aOp: tr(leversOnly).operationalAvailability, aOpDerated: tr(leversOnlyDer).operationalAvailability },
      finalNominal: fN.levels, finalDerated: fD.levels,
      kpiFinal: { aOp: fN.k.aOp, aOpDerated: fD.k.aOp, mtbfHwH: fN.k.mtbfHwH, mttrS: fN.k.mttrS, mttrDerS: fD.k.mttrS, other: fN.k.other, otherDerated: fD.k.other, delivered: fN.k.delivered, phi: fN.k.phi, phiDerated: fD.k.phi },
      recovery: finNom.recovery,
      ends: ends(finNom, tr(finNom)),
    };
    (res.p3 as Record<string, unknown>).limits = LIMITS.map((x) => ({ ...x, ...(acceptanceLimit(finNom, x.id, x.key, x.dir, x.extreme) ?? {}) }));
    res.endsToday = ends(s, tN);
    res.shapley = shapleyByLevel(n);
  }
  log(`N=${n}: A_op ${(nom.k.aOp * 100).toFixed(3)} / ${(der.k.aOp * 100).toFixed(3)} %, B ${budget.derated.toFixed(1)} s/h vs Σc ${budget.sumCDerated.toFixed(1)} | P1 ARINC ×${(p1.arinc.hardware.rows[0]?.factor ?? 1).toFixed(3)} | P2 g ${g.toFixed(3)} | P3 ${p3.arinc.levers.join('+') || '—'} ×${Math.min(...p3.arinc.hardware.rows.map((h) => h.factor)).toFixed(3)} → ${(p3.arinc.final.aOp * 100).toFixed(3)} / ${(p3.arinc.final.derated * 100).toFixed(3)} %${p3.arinc.verification ? ` P ${(p3.arinc.verification.pAtLeastTarget * 100).toFixed(1)} %` : ''} | today P ${((res.todayWindow as { pAtLeastTarget: number }).pAtLeastTarget * 100).toFixed(1)} % | recommended ${rec.levers.join('+') || '—'} k ${rec.k.toFixed(3)} (mean ${rec.kMean.toFixed(3)}, ${rec.binding}) P ${(rec.window.pAtLeastTarget * 100).toFixed(1)} % ${rec.window.verdict}`);
  return res;
}

const sizes: Record<number, unknown> = {};
for (const n of SIZES) sizes[n] = perSize(n, n === MAIN || n === 200000);
const lib = (id: string) => { const m = mechanismById(id); return { id, name: m.name, kind: m.kind, change: m.change, parameters: m.parameters, derated: derateParameters(m.parameters, DERATE_DEFAULT), effort: m.effort }; };
const s0 = base(MAIN);
const out = {
  generated: new Date().toISOString(), target: TARGET, sizes: SIZES, main: MAIN, trials: TRIALS, derate: DERATE_DEFAULT,
  levels: LEVELS.map((l) => ({ id: l.id, name: l.name, scope: l.scope, domains: l.domains, cardsPer: l.cardsPer(MAIN), instancesMain: l.instances(MAIN) })),
  events: REFERENCE_EVENTS.map((e) => ({ id: e.id, domainId: e.domainId, domain: e.domain, description: e.description, type: e.type, fit: e.fit, scope: e.scope, persistence: e.persistence, replay: e.replay, process: e.process, elastic: e.elastic, level: LEVEL_OF[e.domainId] })),
  deploy: DEPLOY,
  mechanisms: REF.map(lib),
  levers: DEFAULT_LEVERS.map((l) => ({ ...l, name: LEVER_NAMES[l.id] })),
  baseline: { recovery: s0.recovery, workload: s0.workload, sdc: s0.sdc },
  perSize: sizes,
};
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`written ${OUT}`);
