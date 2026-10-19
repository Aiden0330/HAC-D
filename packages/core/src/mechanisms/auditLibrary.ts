/**
 * v3.7 the 16 mechanisms of the mechanism audit (新可靠性机制库 · 单点收益量化审核, review 02, 2026-10-14) as HAC-D library
 * entries. Every entry keeps the audit's text and single-point quantification; the transform acts on the cluster-level models
 * only when the integration parameters the audit leaves null are supplied — either measured values or the provisional
 * assumptions of `provisionalParameters()` (tagged assumed, derated by the planner). Overlaps follow the audit: mechanisms on the
 * same recovery stage take the minimum (never the sum), I-CONTAIN adds nothing on top of R-ELASTIC, R-HCCL-ELASTIC needs
 * R-ELASTIC, and the silent-corruption detectors compound on the residual misses (c_total = c₁ + (1 − c₁)·c₂).
 */
import type { Scenario } from '../scenario/schema.js';
import type { MechanismDef } from './index.js';
import type { AuditBaseline, AuditCatalogMechanism, SinglePoint } from './auditTypes.js';
import { AUDIT_CATALOG } from './auditCatalog.js';
import { cloneScenario } from '../scenario/analysis.js';
import { automaticStages } from '../scenario/evaluate.js';
import { recordApplied, orNull, type Previous } from './applied.js';

type P = Record<string, number>;
const catalog = (id: string): AuditCatalogMechanism => {
  const m = AUDIT_CATALOG.mechanisms.find((x) => x.id === id);
  if (!m) throw new Error(`audit catalog has no mechanism '${id}'`);
  return m;
};
/** v4 catalog event id of a component: per-unit classes of the topology templates are written `<event>@<unit>` (e.g. `FABRIC-hard@roce`) */
export const eventIdOf = (componentId: string): string => componentId.replace(/@.*$/, '');
const num = (p: P, k: string): number | undefined => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? p[k] : undefined);
const ready = (p: P, needs: string[]): boolean => needs.every((k) => num(p, k) !== undefined);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/* ---------- transform helpers (every change is recorded for exact removal) ---------- */

/** Add a custom chain rung and its per-class applicability (eligible share of the candidate classes); optional steady overhead. */
function addCustomRung(s: Scenario, id: string, rung: NonNullable<Scenario['mechanisms']['custom']>[string], candidates: string[], share: number, overhead: number | undefined, p: P): Scenario {
  const c = cloneScenario(s);
  const previous: Previous = { 'mechanisms.custom': orNull(c.mechanisms.custom ? { ...c.mechanisms.custom } : undefined) };
  const compPrev: Record<string, Record<string, number> | null> = {};
  for (const comp of c.components) {
    if (!candidates.includes(eventIdOf(comp.id))) continue;
    compPrev[comp.id] = orNull(comp.mechanisms?.custom ? { ...comp.mechanisms.custom } : undefined);
    comp.mechanisms = { ...(comp.mechanisms ?? {}), custom: { ...(comp.mechanisms?.custom ?? {}), [id]: Math.min(1, Math.max(0, share)) } };
  }
  previous.componentCustom = compPrev;
  c.mechanisms = { ...c.mechanisms, custom: { ...(c.mechanisms.custom ?? {}), [id]: rung } };
  if (overhead !== undefined && overhead > 0) {
    previous.overheads = orNull(c.mechanisms.overheads);
    c.mechanisms = { ...c.mechanisms, overheads: { ...(c.mechanisms.overheads ?? {}), [id]: overhead } };
  }
  return recordApplied(c, id, p, previous);
}

/** Lower one automatic stage of the candidate classes towards a candidate value: new = current − share·(current − candidate), never above the current (the audit's same-stage minimum rule). */
function lowerStage(s: Scenario, id: string, stage: 'startup' | 'read' | 'communication', candidates: string[], share: number, candidateOf: (def: ReturnType<typeof automaticStages>, current: number) => number, p: P): Scenario {
  if (s.recovery.mode !== 'mixture') return s;
  const c = cloneScenario(s);
  if (c.recovery.mode !== 'mixture') return c;
  const def = automaticStages(c.recovery);
  const compPrev: Record<string, Scenario['components'][number]['recoveryStages'] | null> = {};
  for (const comp of c.components) {
    if (!candidates.includes(eventIdOf(comp.id))) continue;
    const current = comp.recoveryStages?.[stage] ?? def[stage];
    const cand = candidateOf(def, current);
    if (!(cand < current)) continue;
    compPrev[comp.id] = orNull(comp.recoveryStages ? { ...comp.recoveryStages } : undefined);
    const next = Math.max(0, current - Math.min(1, Math.max(0, share)) * (current - cand));
    comp.recoveryStages = { ...(comp.recoveryStages ?? {}), [stage]: next };
  }
  return recordApplied(c, id, p, { componentStages: compPrev });
}

/**
 * Register a conditional silent-corruption detector on the candidate classes: it catches `gain` of the misses left by every
 * other detector (`component.sdc.extraDetection[id]`), so the class coverage is q_i = 1 − (1 − q)·Π(1 − c_k) whatever the
 * order in which the detectors are applied (the scenario-level D-SDC can come before or after).
 */
function raiseSdcCoverage(s: Scenario, id: string, candidates: string[], gain: number, detectSeconds: number | undefined, p: P, extra: Previous = {}): Scenario {
  const c = cloneScenario(s);
  const compPrev: Record<string, Scenario['components'][number]['sdc'] | null> = {};
  for (const comp of c.components) {
    if (!candidates.includes(eventIdOf(comp.id)) || !comp.sdc) continue;
    compPrev[comp.id] = orNull(comp.sdc ? { ...comp.sdc } : undefined);
    comp.sdc = { ...comp.sdc, extraDetection: { ...(comp.sdc.extraDetection ?? {}), [id]: Math.min(1, Math.max(0, gain)) } };
  }
  const previous: Previous = { componentSdc: compPrev, ...extra };
  if (detectSeconds !== undefined && detectSeconds < c.sdc.detection.detectSeconds) {
    previous['sdc.detection'] = { ...c.sdc.detection };
    c.sdc = { ...c.sdc, detection: { ...c.sdc.detection, detectSeconds } };
  }
  return recordApplied(c, id, p, previous);
}

const seconds = (zh: string, en: string): SinglePoint['metric'] => ({ zh, en });
const decrease = (metric: SinglePoint['metric'], before: number, after: number, formula: SinglePoint['formula'], unit: SinglePoint['unit'] = 'seconds', range?: SinglePoint['range'], derived?: Record<string, number>): SinglePoint => ({ metric, unit, direction: 'decrease', before: r3(before), after: r3(after), improvement: r3(before - after), reductionFraction: before > 0 ? (before - after) / before : undefined, formula, range, derived });
const increase = (metric: SinglePoint['metric'], before: number, after: number, formula: SinglePoint['formula'], range?: SinglePoint['range'], derived?: Record<string, number>): SinglePoint => ({ metric, unit: 'fraction', direction: 'increase', before: r3(before), after: r3(after), improvement: r3(after - before), formula, range, derived });

const HARD_NET = ['NIC-hard', 'OPT-hard', 'BOXIO-hard', 'FABRIC-hard'];
const eta = (f: number, r: number) => 1 / ((1 - f) + f / Math.max(1e-9, r));

export const AUDIT_MECHANISM_DEFS: MechanismDef[] = [
  {
    id: 'R-LINK-LOCAL', name: { zh: '链路透明恢复', en: 'Link-transparent recovery' }, kind: 'recover', status: 'candidate', scope: 'hard', audit: catalog('R-LINK-LOCAL'),
    change: { zh: catalog('R-LINK-LOCAL').change, en: 'Global recovery with rollback → the link recovers and training continues: 2 s total pause (detection, coordination and recovery), no rollback' },
    prerequisite: { zh: catalog('R-LINK-LOCAL').prerequisite, en: 'Consistent application state and communication transactions; retransmission never commits twice; bounded retries and explicit failure reporting' },
    failure: { zh: catalog('R-LINK-LOCAL').failure, en: 'A failed attempt costs its time and falls back to the existing chain; success probability and eligible coverage are to be measured' },
    confidence: 'engineering budget (NVLink layered-resilience design), not measured', effort: 3,
    events: catalog('R-LINK-LOCAL').eventCandidates, integrationNeeds: ['eligibleShare', 'success', 'failureSeconds'], provisional: { eligibleShare: 1, success: 0.9, failureSeconds: 10, overhead: 0 },
    parameters: { successSeconds: 2 },
    singlePoint: (b, p) => decrease(seconds('常规单次等效损失', 'loss of one regular event'), b.normalLossS, p.successSeconds, { zh: `常规损失 = ${r3(b.detectS)} + ${r3(b.autoS)} + ${r3(b.rollbackS)} = ${r3(b.normalLossS)} s；成功损失 = ${p.successSeconds} + 0 s（无回滚）`, en: `regular loss = T_det + T_auto + W = ${r3(b.normalLossS)} s; success = ${p.successSeconds} s, no rollback` }, 'seconds', [{ label: '1 s', value: 1 }, { label: '3 s', value: 3 }]),
    apply: (s, p) => (ready(p, ['eligibleShare', 'success', 'failureSeconds']) ? addCustomRung(s, 'R-LINK-LOCAL', { success: p.success, successSeconds: p.successSeconds, failureSeconds: p.failureSeconds, rollback: false, detectionDelay: false, localLossSeconds: 0, position: 'transparent' }, catalog('R-LINK-LOCAL').eventCandidates, p.eligibleShare, num(p, 'overhead'), p) : s),
  },
  {
    id: 'R-FABRIC-DEGRADE', name: { zh: '网络绕行与降级运行', en: 'Fabric re-route and degraded running' }, kind: 'recover', status: 'candidate', scope: 'hard', audit: catalog('R-FABRIC-DEGRADE'),
    change: { zh: catalog('R-FABRIC-DEGRADE').change, en: 'Global recovery to full resources → 2 s switch, then degraded running for the repair time (throughput η = 1/[(1 − f) + f/r]), then back to normal' },
    prerequisite: { zh: catalog('R-FABRIC-DEGRADE').prerequisite, en: 'The remaining topology carries the job; f is the exposed communication share of a step, r the remaining bandwidth ratio' },
    failure: { zh: catalog('R-FABRIC-DEGRADE').failure, en: 'Partition or overload: no degraded continuation, normal chain' },
    confidence: 'official degraded-bandwidth operation exists; f, r and the repair time are example budgets', effort: 4,
    events: catalog('R-FABRIC-DEGRADE').eventCandidates, integrationNeeds: ['eligibleShare', 'success', 'failureSeconds'], provisional: { eligibleShare: 1, success: 0.9, failureSeconds: 10, overhead: 0 },
    parameters: { switchSeconds: 2, exposedCommunicationFraction: 0.3, remainingBandwidthRatio: 0.75, repairSeconds: 1800 },
    singlePoint: (b, p) => {
      const e = eta(p.exposedCommunicationFraction, p.remainingBandwidthRatio);
      const loss = (rep: number) => p.switchSeconds + (1 - e) * rep;
      return decrease(seconds('含整个降级期的单次等效损失', 'loss of one event incl. the degraded period'), b.normalLossS, loss(p.repairSeconds), { zh: `η = 1/[(1 − f) + f/r] = ${r3(e)}；损失 L = t_switch + (1 − η)·T_repair = ${p.switchSeconds} + ${r3(1 - e)} × ${p.repairSeconds}`, en: `η = 1/[(1 − f) + f/r] = ${r3(e)}; L = t_switch + (1 − η)·T_repair` }, 'seconds', [{ label: 'T_repair 600 s', value: r3(loss(600)) }, { label: 'T_repair 1800 s', value: r3(loss(1800)) }, { label: 'T_repair 3600 s', value: r3(loss(3600)) }], { throughputRatio: r3(e), breakEvenRepairSeconds: r3((b.normalLossS - p.switchSeconds) / Math.max(1e-9, 1 - e)) });
    },
    apply: (s, p) => {
      if (!ready(p, ['eligibleShare', 'success', 'failureSeconds'])) return s;
      const e = eta(p.exposedCommunicationFraction, p.remainingBandwidthRatio);
      // degraded running at throughput η for the repair time: the ledger simulation runs it as a throughput factor over localLossDurationSeconds
      return addCustomRung(s, 'R-FABRIC-DEGRADE', { success: p.success, successSeconds: p.switchSeconds, failureSeconds: p.failureSeconds, rollback: false, detectionDelay: false, localLossSeconds: Math.max(0, (1 - e) * p.repairSeconds), localLossDurationSeconds: p.repairSeconds, position: 'transparent' }, catalog('R-FABRIC-DEGRADE').eventCandidates, p.eligibleShare, num(p, 'overhead'), p);
    },
  },
  {
    id: 'I-CONTAIN', name: { zh: '故障隔离与传播抑制', en: 'Fault containment' }, kind: 'recover', status: 'conditional', scope: 'elastic', audit: catalog('I-CONTAIN'), requires: ['R-ELASTIC'],
    change: { zh: catalog('I-CONTAIN').change, en: '180 s global stop → 1 s global coordination plus 180 s local recovery in 1 of 50 domains; the enabling capability of DP-domain elasticity, no extra credit on top of R-ELASTIC' },
    prerequisite: { zh: catalog('I-CONTAIN').prerequisite, en: 'DP semantics, state redundancy and communication isolation all hold' },
    failure: { zh: catalog('I-CONTAIN').failure, en: 'Containment failure or no independent progress: global recovery' },
    confidence: 'enabling capability; 50 domains are the user setting, 1 s coordination an assumption', effort: 4,
    events: catalog('I-CONTAIN').eventCandidates, parameters: { domains: 50, coordinationSeconds: 1, stageSeconds: 180 },
    singlePoint: (_b, p) => decrease(seconds('仅恢复阶段等效损失', 'recovery-stage loss only'), p.stageSeconds, p.coordinationSeconds + p.stageSeconds / Math.max(1, p.domains), { zh: `阶段损失 = ${p.coordinationSeconds} + ${p.stageSeconds} × (1/${p.domains})；不含检测与回滚；已有 R-ELASTIC 时增量记 0`, en: `stage loss = coordination + stage/domains; no detection or rollback; incremental 0 on top of R-ELASTIC` }),
  },
  {
    id: 'H-CONTROL-CONTINUITY', name: { zh: '控制面异常下业务连续运行', en: 'Data-plane continuity under control-plane faults' }, kind: 'recover', status: 'candidate', scope: 'hard', audit: catalog('H-CONTROL-CONTINUITY'),
    change: { zh: catalog('H-CONTROL-CONTINUITY').change, en: 'A management fault no longer triggers training recovery: the data plane keeps running, training pause budget 0–1 s' },
    prerequisite: { zh: catalog('H-CONTROL-CONTINUITY').prerequisite, en: 'Recoverable control state, no dual master, forwarding independent of the failed service; only the audited MGMT-hard subset' },
    failure: { zh: catalog('H-CONTROL-CONTINUITY').failure, en: 'Failed switch-over: normal chain' },
    confidence: 'control / data plane decoupling is public design; the pause budget is a candidate', effort: 3,
    events: catalog('H-CONTROL-CONTINUITY').eventCandidates, integrationNeeds: ['eligibleShare', 'success', 'failureSeconds'], provisional: { eligibleShare: 1, success: 0.9, failureSeconds: 10, overhead: 0 },
    parameters: { pauseSeconds: 1 },
    singlePoint: (b, p) => decrease(seconds('常规单次等效损失', 'loss of one regular event'), b.normalLossS, p.pauseSeconds, { zh: `按保守目标 ${p.pauseSeconds} s：单次常规损失 ${r3(b.normalLossS)} → ${p.pauseSeconds} s；管理服务恢复时长不计训练停机`, en: `conservative target ${p.pauseSeconds} s; the management-service restore time is not training downtime` }, 'seconds', [{ label: '0 s', value: 0 }, { label: '1 s', value: 1 }]),
    apply: (s, p) => (ready(p, ['eligibleShare', 'success', 'failureSeconds']) ? addCustomRung(s, 'H-CONTROL-CONTINUITY', { success: p.success, successSeconds: p.pauseSeconds, failureSeconds: p.failureSeconds, rollback: false, detectionDelay: false, localLossSeconds: 0, position: 'transparent' }, catalog('H-CONTROL-CONTINUITY').eventCandidates, p.eligibleShare, num(p, 'overhead'), p) : s),
  },
  {
    id: 'R-WARM-PROCESS', name: { zh: '预热进程与可信状态接替', en: 'Warm standby process with trusted-state takeover' }, kind: 'recover', status: 'candidate', scope: 'hard', audit: catalog('R-WARM-PROCESS'),
    change: { zh: catalog('R-WARM-PROCESS').change, en: 'The 180 s attempt split into startup 60 s + other 120 s; warm processes cut the startup to 20 s, the rest unchanged' },
    prerequisite: { zh: catalog('R-WARM-PROCESS').prerequisite, en: 'Surviving state, exclusive execution rights, consistent training-state versions; the checkpoint rollback is kept' },
    failure: { zh: catalog('R-WARM-PROCESS').failure, en: 'Untrusted state or hardware failure: cold start' },
    confidence: 'engineering estimate; the public 7.3 s result is an inference experiment', effort: 3,
    events: catalog('R-WARM-PROCESS').eventCandidates, integrationNeeds: ['eligibleShare'], provisional: { eligibleShare: 1 },
    parameters: { startupTargetSeconds: 20 },
    singlePoint: (b, p) => decrease(seconds('启动阶段耗时', 'startup stage time'), b.stages.startup, p.startupTargetSeconds, { zh: `启动 ${r3(b.stages.startup)} → ${p.startupTargetSeconds} s；恢复 ${r3(b.autoS)} → ${r3(b.autoS - b.stages.startup + p.startupTargetSeconds)} s；与运行时快照、图缓存共用同一启动预算，取最小不相加`, en: `startup ${r3(b.stages.startup)} → ${p.startupTargetSeconds} s; same-stage mechanisms take the minimum` }, 'seconds', [{ label: '10 s', value: 10 }, { label: '30 s', value: 30 }], { recoveryBeforeSeconds: r3(b.autoS), recoveryAfterSeconds: r3(b.autoS - b.stages.startup + p.startupTargetSeconds), normalEventLossAfterSeconds: r3(b.normalLossS - b.stages.startup + p.startupTargetSeconds) }),
    apply: (s, p) => (ready(p, ['eligibleShare']) ? lowerStage(s, 'R-WARM-PROCESS', 'startup', catalog('R-WARM-PROCESS').eventCandidates, p.eligibleShare, () => p.startupTargetSeconds, p) : s),
  },
  {
    id: 'R-RUNTIME-SNAPSHOT', name: { zh: '运行时初始化快照', en: 'Runtime initialisation snapshot' }, kind: 'recover', status: 'candidate', scope: 'hard', audit: catalog('R-RUNTIME-SNAPSHOT'),
    change: { zh: catalog('R-RUNTIME-SNAPSHOT').change, en: 'The same 60 s startup budget restored from an initialisation snapshot in 15 s; loading the latest training state stays in the other stages' },
    prerequisite: { zh: catalog('R-RUNTIME-SNAPSHOT').prerequisite, en: 'Compatible driver, device, model configuration and address map; external connections rebuilt' },
    failure: { zh: catalog('R-RUNTIME-SNAPSHOT').failure, en: 'Snapshot unavailable or verification failed: cold start' },
    confidence: 'process-snapshot principle is public; the 15 s training target and compatibility range are to be verified', effort: 4,
    events: catalog('R-RUNTIME-SNAPSHOT').eventCandidates, integrationNeeds: ['eligibleShare'], provisional: { eligibleShare: 1 },
    parameters: { startupTargetSeconds: 15 },
    singlePoint: (b, p) => decrease(seconds('启动阶段耗时', 'startup stage time'), b.stages.startup, p.startupTargetSeconds, { zh: `启动 ${r3(b.stages.startup)} → ${p.startupTargetSeconds} s；恢复 ${r3(b.autoS)} → ${r3(b.autoS - b.stages.startup + p.startupTargetSeconds)} s；与预热进程为同一阶段的替代方案`, en: `startup ${r3(b.stages.startup)} → ${p.startupTargetSeconds} s; alternative to the warm process on the same stage` }, 'seconds', [{ label: '10 s', value: 10 }, { label: '30 s', value: 30 }], { recoveryBeforeSeconds: r3(b.autoS), recoveryAfterSeconds: r3(b.autoS - b.stages.startup + p.startupTargetSeconds), normalEventLossAfterSeconds: r3(b.normalLossS - b.stages.startup + p.startupTargetSeconds) }),
    apply: (s, p) => (ready(p, ['eligibleShare']) ? lowerStage(s, 'R-RUNTIME-SNAPSHOT', 'startup', catalog('R-RUNTIME-SNAPSHOT').eventCandidates, p.eligibleShare, () => p.startupTargetSeconds, p) : s),
  },
  {
    id: 'C-ASYNC', name: { zh: '异步检查点保存', en: 'Asynchronous checkpoint saves' }, kind: 'checkpoint', status: 'candidate', scope: 'all', audit: catalog('C-ASYNC'),
    change: { zh: catalog('C-ASYNC').change, en: 'Blocking per save 4 → 1 s at the same 300 s period; a 10 s durable lag is added to every rollback' },
    prerequisite: { zh: catalog('C-ASYNC').prerequisite, en: 'Distinguish host / local copies from the durable remote copy; an uncommitted copy is not a checkpoint' },
    failure: { zh: catalog('C-ASYNC').failure, en: 'Lost staging copy or failed background write: the previous durable checkpoint' },
    confidence: 'public design (Megatron-Core async saves); 1 s blocking and 10 s lag are candidates', effort: 3,
    parameters: { blockingTargetSeconds: 1, durableLagSeconds: 10 },
    singlePoint: (b, p) => decrease(seconds('每次保存阻塞', 'blocking per save'), b.deltaS, p.blockingTargetSeconds, { zh: `每次保存少阻塞 ${r3(b.deltaS - p.blockingTargetSeconds)} s；仅远端副本存活时新增回退窗口 ≈ 有效持久化滞后 ${p.durableLagSeconds} s`, en: `${r3(b.deltaS - p.blockingTargetSeconds)} s less blocking per save; the durable lag of ${p.durableLagSeconds} s widens every rollback` }, 'seconds', [{ label: '0.5 s', value: 0.5 }, { label: '2 s', value: 2 }], { illustrativeExtraRollbackSeconds: p.durableLagSeconds }),
    apply: (s, p) => {
      if (s.workload.type !== 'training') return s;
      const c = cloneScenario(s);
      if (c.workload.type !== 'training') return c;
      const previous: Previous = { 'workload.deltaS': c.workload.deltaS, 'workload.rollbackLagS': orNull(c.workload.rollbackLagS) };
      c.workload = { ...c.workload, deltaS: Math.min(c.workload.deltaS, p.blockingTargetSeconds), rollbackLagS: Math.max(c.workload.rollbackLagS ?? 0, p.durableLagSeconds) };
      return recordApplied(c, 'C-ASYNC', p, previous);
    },
  },
  {
    id: 'C-LOSSLESS', name: { zh: '无损检查点压缩', en: 'Lossless checkpoint compression' }, kind: 'checkpoint', status: 'candidate', scope: 'all', audit: catalog('C-LOSSLESS'),
    change: { zh: catalog('C-LOSSLESS').change, en: 'The checkpoint-read stage 60 s → 60/r + decompression (40 s at r = 2); the save period is unchanged' },
    prerequisite: { zh: catalog('C-LOSSLESS').prerequisite, en: 'Same state and effective bandwidth; read and decompression are serial' },
    failure: { zh: catalog('C-LOSSLESS').failure, en: 'Checksum failure: read another trusted copy' },
    confidence: 'public (nvCOMP); 2× ratio, 60 s read and 10 s decompression are budgets', effort: 2,
    parameters: { compressionRatio: 2, decompressSeconds: 10 },
    singlePoint: (b, p) => {
      const after = (r: number) => b.stages.read / r + p.decompressSeconds;
      return decrease(seconds('读取加解压阶段耗时', 'read + decompression stage'), b.stages.read, after(p.compressionRatio), { zh: `T′ = ${r3(b.stages.read)}/r + ${p.decompressSeconds}；r = ${p.compressionRatio} 时 ${r3(b.stages.read)} → ${r3(after(p.compressionRatio))} s，恢复 ${r3(b.autoS)} → ${r3(b.autoS - b.stages.read + after(p.compressionRatio))} s`, en: `T′ = read/r + decompression; recovery ${r3(b.autoS)} → ${r3(b.autoS - b.stages.read + after(p.compressionRatio))} s` }, 'seconds', [{ label: 'r = 1.1', value: r3(after(1.1)) }, { label: 'r = 1.5', value: r3(after(1.5)) }, { label: 'r = 3', value: r3(after(3)) }], { breakEvenCompressionRatio: r3(b.stages.read / Math.max(1e-9, b.stages.read - p.decompressSeconds)), recoveryAfterSeconds: r3(b.autoS - b.stages.read + after(p.compressionRatio)) });
    },
    apply: (s, p) => {
      if (s.recovery.mode !== 'mixture') return s;
      const c = cloneScenario(s);
      if (c.recovery.mode !== 'mixture') return c;
      const st = automaticStages(c.recovery);
      const shareL = Math.min(1, Math.max(0, num(p, 'share') ?? 1));
      const read = st.read - shareL * Math.max(0, st.read - (st.read / Math.max(1e-9, p.compressionRatio) + p.decompressSeconds));
      const previous: Previous = { recovery: c.recovery };
      c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, stages: { startup: st.startup, graphWithinStartup: st.graphWithinStartup, read, communication: st.communication }, seconds: st.startup + read + st.communication } };
      return recordApplied(c, 'C-LOSSLESS', p, previous);
    },
  },
  {
    id: 'D-RECOVERY-CLASSIFY', name: { zh: '故障分类与恢复动作匹配', en: 'Fault classification and recovery-action matching' }, kind: 'recover', status: 'candidate', scope: 'all', audit: catalog('D-RECOVERY-CLASSIFY'),
    change: { zh: catalog('D-RECOVERY-CLASSIFY').change, en: 'The automatic attempt stays 180 s; the probability of a 2 h manual fallback drops from 1 % to 0.1 %' },
    prerequisite: { zh: catalog('D-RECOVERY-CLASSIFY').prerequisite, en: 'Accurate classification before the recovery action; wrong actions are escalated quickly' },
    failure: { zh: catalog('D-RECOVERY-CLASSIFY').failure, en: 'Misclassification: the normal escalation' },
    confidence: 'GPU error-recovery action interface is public; the 0.1 % target is a candidate', effort: 3,
    parameters: { manualProbabilityTarget: 0.001 },
    singlePoint: (b, p) => decrease(seconds('每次恢复的期望耗时', 'expected recovery time'), b.expectedRecoveryS, b.autoS + p.manualProbabilityTarget * b.manualS, { zh: `E[T] = ${r3(b.autoS)} + p_manual × ${r3(b.manualS)}：${r3(b.expectedRecoveryS)} → ${r3(b.autoS + p.manualProbabilityTarget * b.manualS)} s`, en: `E[T] = T_auto + p_manual·T_manual` }, 'seconds', [{ label: 'p 0.5 %', value: r3(b.autoS + 0.005 * b.manualS) }, { label: 'p 0.1 %', value: r3(b.autoS + 0.001 * b.manualS) }]),
    apply: (s, p) => {
      if (s.recovery.mode !== 'mixture') return s;
      const c = cloneScenario(s);
      if (c.recovery.mode !== 'mixture') return c;
      const previous: Previous = { recovery: c.recovery };
      // optional eligibleShare × success (ReMAP-latest scenario): the matched share reaches the target manual probability, the rest keeps the current one
      const q = Math.min(1, Math.max(0, num(p, 'eligibleShare') ?? 1)) * Math.min(1, Math.max(0, num(p, 'success') ?? 1));
      const cur = c.recovery.automatic.successProbability;
      c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, successProbability: q * Math.max(cur, 1 - p.manualProbabilityTarget) + (1 - q) * cur } };
      return recordApplied(c, 'D-RECOVERY-CLASSIFY', p, previous);
    },
  },
  ...(['D-SDC-FP8', 'D-SDC-FP4'] as const).map((id): MechanismDef => ({
    id, name: { zh: catalog(id).name, en: `${id === 'D-SDC-FP8' ? 'FP8' : 'FP4'} compute-path silent-corruption detection` }, kind: 'detect', status: 'candidate', scope: 'sdc', audit: catalog(id),
    change: { zh: catalog(id).change, en: `A 95 % detection target registered on the ${id === 'D-SDC-FP8' ? 'FP8' : 'FP4'} path that the BF16 detector does not cover; the path's share of the silent-corruption risk is to be calibrated` },
    prerequisite: { zh: catalog(id).prerequisite, en: 'Per-operator or per-step checks on the protected path; the risk share by precision is measured, not the FLOP share' },
    failure: { zh: catalog(id).failure, en: 'Missed events keep the latent 5-day discovery branch' },
    confidence: 'user proposal; detection target and risk share are acceptance targets', effort: 4,
    events: catalog(id).eventCandidates, integrationNeeds: ['riskShare'], provisional: { riskShare: 1 / 3 },
    parameters: { detectionTarget: 0.95, detectSeconds: 1 },
    singlePoint: (_b, p) => increase(seconds('适用 SDC 子集的登记检出率', 'registered detection on the applicable subset'), 0, p.detectionTarget, { zh: `子集内登记覆盖 0 % → ${r3(p.detectionTarget * 100)} %；核心检出率按 Σ(q_j × c_j) 加权，q_j 为该精度路径的风险占比（待校准）`, en: `subset coverage 0 → ${p.detectionTarget}; the class coverage is Σ q_j·c_j over the precision paths` }, undefined, { residualMissFraction: r3(1 - p.detectionTarget) }),
    apply: (s, p) => (ready(p, ['riskShare']) ? raiseSdcCoverage(s, id, catalog(id).eventCandidates, Math.min(1, Math.max(0, p.riskShare)) * p.detectionTarget, p.detectSeconds, p) : s),
  })),
  {
    id: 'D-ABFT', name: { zh: '算子 ABFT／实时矩阵校验', en: 'Operator ABFT / online matrix checks' }, kind: 'detect', status: 'candidate', scope: 'sdc', audit: catalog('D-ABFT'),
    change: { zh: catalog('D-ABFT').change, en: 'Catches 90 % of the misses left by the upstream 95 % detector (joint 99.5 %) at a 0.1 % steady throughput cost' },
    prerequisite: { zh: catalog('D-ABFT').prerequisite, en: 'An independent check validated on the residual misses, not the same capability as the FP8 / FP4 detectors' },
    failure: { zh: catalog('D-ABFT').failure, en: 'Residual misses keep the latent branch' },
    confidence: 'NVIDIA algorithm-based error detection research; conditional detection and overhead are targets', effort: 4,
    events: catalog('D-ABFT').eventCandidates, parameters: { upstreamDetection: 0.95, conditionalMissDetection: 0.9, overhead: 0.001 },
    singlePoint: (_b, p) => {
      const joint = (c2: number) => p.upstreamDetection + (1 - p.upstreamDetection) * c2;
      return increase(seconds('同一适用子集的两级联合检出率', 'joint two-level detection on the subset'), p.upstreamDetection, joint(p.conditionalMissDetection), { zh: `c_total = c₁ + (1 − c₁)·c₂ = ${r3(p.upstreamDetection)} + ${r3(1 - p.upstreamDetection)} × ${p.conditionalMissDetection}；每 1000 s 正常运行损失 ${r3(p.overhead * 1000)} s`, en: `c_total = c₁ + (1 − c₁)·c₂; steady cost ${p.overhead * 1000} s per 1000 s` }, [{ label: 'c₂ 0.9', value: r3(joint(0.9)) }, { label: 'c₂ 0.95', value: r3(joint(0.95)) }, { label: 'c₂ 0.98', value: r3(joint(0.98)) }], { residualMissFraction: r3(1 - joint(p.conditionalMissDetection)) });
    },
    apply: (s, p) => {
      const c = raiseSdcCoverage(s, 'D-ABFT', catalog('D-ABFT').eventCandidates, p.conditionalMissDetection, undefined, p, p.overhead > 0 ? { overheads: orNull(s.mechanisms.overheads) } : {});
      if (p.overhead > 0) c.mechanisms = { ...c.mechanisms, overheads: { ...(c.mechanisms.overheads ?? {}), 'D-ABFT': p.overhead } };
      return c;
    },
  },
  {
    id: 'D-NET-SDC', name: { zh: '网络端到端 SDC 检测', en: 'Network end-to-end silent-corruption detection' }, kind: 'detect', status: 'candidate', scope: 'sdc', audit: catalog('D-NET-SDC'),
    change: { zh: catalog('D-NET-SDC').change, en: 'A 95 % detection target registered on the residual network silent-corruption subset' },
    prerequisite: { zh: catalog('D-NET-SDC').prerequisite, en: 'End-to-end checks on the data path; the protected-link error count is not the denominator' },
    failure: { zh: catalog('D-NET-SDC').failure, en: 'Residual misses keep the latent branch' },
    confidence: 'user proposal; target to be verified', effort: 3,
    events: catalog('D-NET-SDC').eventCandidates, parameters: { detectionTarget: 0.95, detectSeconds: 1 },
    singlePoint: (_b, p) => increase(seconds('适用 SDC 子集的登记检出率', 'registered detection on the applicable subset'), 0, p.detectionTarget, { zh: `适用子集覆盖 0 % → ${r3(p.detectionTarget * 100)} %`, en: `subset coverage 0 → ${p.detectionTarget}` }, undefined, { residualMissFraction: r3(1 - p.detectionTarget) }),
    apply: (s, p) => raiseSdcCoverage(s, 'D-NET-SDC', catalog('D-NET-SDC').eventCandidates, p.detectionTarget, p.detectSeconds, p),
  },
  {
    id: 'H-SDC-SCREEN', name: { zh: '在线压测与异常资源筛除', en: 'Online stress screening and eviction' }, kind: 'physical', status: 'candidate', scope: 'sdc', audit: catalog('H-SDC-SCREEN'),
    change: { zh: catalog('H-SDC-SCREEN').change, en: 'Silent-corruption FIT of the screened subset × 0.75; detection and recovery unchanged' },
    prerequisite: { zh: catalog('H-SDC-SCREEN').prerequisite, en: 'Screened and isolated resources no longer expose the job; eligible share to be verified' },
    failure: { zh: catalog('H-SDC-SCREEN').failure, en: 'Detected but not isolated: counts as detection, not prevention' },
    confidence: 'user target (25 % lower occurrence); eligible share, interval and cost unknown', effort: 3,
    events: catalog('H-SDC-SCREEN').eventCandidates, integrationNeeds: ['eligibleShare'], provisional: { eligibleShare: 1 },
    parameters: { occurrenceReduction: 0.25 },
    singlePoint: (b, p) => {
      const before = catalog('H-SDC-SCREEN').eventCandidates.reduce((a, id) => a + (b.sdcFitByClass[id] ?? 0), 0);
      const share = num(p, 'eligibleShare') ?? 1;
      return decrease(seconds('适用子集的静默 FIT（全覆盖条件情景）', 'silent FIT of the eligible subset'), before, before * (1 - p.occurrenceReduction * share), { zh: `FIT′ = FIT × (1 − ${p.occurrenceReduction} × a)，a = 适用比例（${share}）；只对验证过的子集乘系数，不改变检出率或恢复时间`, en: `FIT′ = FIT × (1 − reduction × eligible share)` }, 'FIT', undefined, { rateMultiplier: r3(1 - p.occurrenceReduction * share) });
    },
    apply: (s, p) => {
      if (!ready(p, ['eligibleShare'])) return s;
      const c = cloneScenario(s);
      const compPrev: Record<string, Scenario['components'][number]['sdc'] | null> = {};
      const f = 1 - Math.min(1, Math.max(0, p.occurrenceReduction)) * Math.min(1, Math.max(0, p.eligibleShare));
      for (const comp of c.components) {
        if (!catalog('H-SDC-SCREEN').eventCandidates.includes(eventIdOf(comp.id)) || !comp.sdc) continue;
        compPrev[comp.id] = { ...comp.sdc };
        comp.sdc = { ...comp.sdc, ratePerHour: comp.sdc.ratePerHour * f };
      }
      return recordApplied(c, 'H-SDC-SCREEN', p, { componentSdc: compPrev });
    },
  },
  {
    id: 'R-HCCL-ELASTIC', name: { zh: 'HCCL 通信域弹性重建', en: 'HCCL communicator elastic rebuild' }, kind: 'recover', status: 'conditional', scope: 'elastic', audit: catalog('R-HCCL-ELASTIC'), requires: ['R-ELASTIC'],
    change: { zh: catalog('R-HCCL-ELASTIC').change, en: 'The communication-rebuild stage of a local (elastic) recovery 60 s → 15 s: local recovery 180 → 135 s' },
    prerequisite: { zh: catalog('R-HCCL-ELASTIC').prerequisite, en: 'Communicator shrink / rebuild supported by the collective library; only with DP-domain elasticity' },
    failure: { zh: catalog('R-HCCL-ELASTIC').failure, en: 'Rebuild failure: the elastic failure path' },
    confidence: 'NCCL / HCCL communicator management APIs are public; 15 s is a candidate', effort: 3,
    events: catalog('R-HCCL-ELASTIC').eventCandidates, parameters: { communicationBeforeSeconds: 60, communicationTargetSeconds: 15 },
    singlePoint: (_b, p) => decrease(seconds('通信重建阶段耗时', 'communication-rebuild stage'), p.communicationBeforeSeconds, p.communicationTargetSeconds, { zh: `单次局部恢复少 ${r3(p.communicationBeforeSeconds - p.communicationTargetSeconds)} s；若只有 1/50 域损失产出，全系统等效 ${r3((p.communicationBeforeSeconds - p.communicationTargetSeconds) / 50)} s`, en: `${r3(p.communicationBeforeSeconds - p.communicationTargetSeconds)} s less per local recovery` }, 'seconds', [{ label: '10 s', value: 10 }, { label: '20 s', value: 20 }], { recoveryAfterSeconds: r3(180 - (p.communicationBeforeSeconds - p.communicationTargetSeconds)) }),
    apply: (s, p) => {
      if (!s.mechanisms.elastic) return s;
      const c = cloneScenario(s);
      const previous: Previous = { 'mechanisms.elastic': { ...c.mechanisms.elastic! } };
      const saving = Math.max(0, p.communicationBeforeSeconds - p.communicationTargetSeconds) * Math.min(1, Math.max(0, num(p, 'share') ?? 1));
      c.mechanisms = { ...c.mechanisms, elastic: { ...c.mechanisms.elastic!, recoverSeconds: Math.max(0, c.mechanisms.elastic!.recoverSeconds - saving) } };
      return recordApplied(c, 'R-HCCL-ELASTIC', p, previous);
    },
  },
  {
    id: 'R-CANN-GRAPH', name: { zh: 'CANN 图准备与启动缓存加速', en: 'CANN graph preparation and startup caches' }, kind: 'recover', status: 'candidate', scope: 'hard', audit: catalog('R-CANN-GRAPH'),
    change: { zh: catalog('R-CANN-GRAPH').change, en: 'The 30 s graph-preparation share of the 60 s startup drops to 7.5 s; recovery 180 → 157.5 s' },
    prerequisite: { zh: catalog('R-CANN-GRAPH').prerequisite, en: 'Graph capture / compilation caches valid for the restarted process; shares the startup budget with warm processes and snapshots' },
    failure: { zh: catalog('R-CANN-GRAPH').failure, en: 'Cache miss: full graph preparation' },
    confidence: 'CANN graph capture API is public; 7.5 s is a candidate', effort: 2,
    events: catalog('R-CANN-GRAPH').eventCandidates, integrationNeeds: ['eligibleShare'], provisional: { eligibleShare: 1 },
    parameters: { graphTargetSeconds: 7.5 },
    singlePoint: (b, p) => decrease(seconds('图准备阶段耗时', 'graph-preparation stage'), b.stages.graphWithinStartup, p.graphTargetSeconds, { zh: `图准备 ${r3(b.stages.graphWithinStartup)} → ${p.graphTargetSeconds} s（启动 ${r3(b.stages.startup)} s 的子段）；恢复 ${r3(b.autoS)} → ${r3(b.autoS - b.stages.graphWithinStartup + p.graphTargetSeconds)} s；不与预热／快照的启动节省相加`, en: `graph preparation ${r3(b.stages.graphWithinStartup)} → ${p.graphTargetSeconds} s inside the startup stage` }, 'seconds', [{ label: '5 s', value: 5 }, { label: '10 s', value: 10 }], { recoveryAfterSeconds: r3(b.autoS - b.stages.graphWithinStartup + p.graphTargetSeconds) }),
    apply: (s, p) => (ready(p, ['eligibleShare']) ? lowerStage(s, 'R-CANN-GRAPH', 'startup', catalog('R-CANN-GRAPH').eventCandidates, p.eligibleShare, (def) => def.startup - Math.max(0, def.graphWithinStartup - p.graphTargetSeconds), p) : s),
  },
];

/** The provisional integration values of the selected mechanisms (the "use provisional assumptions" switch), tagged assumed. */
export function provisionalParameters(ids: string[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const m of AUDIT_MECHANISM_DEFS) if (ids.includes(m.id) && m.provisional) out[m.id] = { ...m.provisional };
  return out;
}

/** Which integration parameters a mechanism needs, which are provided, and whether its transform will act. */
export function integrationStatus(m: MechanismDef, p: Record<string, number> = {}): { needs: string[]; provided: string[]; missing: string[]; ready: boolean } {
  const needs = m.integrationNeeds ?? [];
  const provided = needs.filter((k) => num(p, k) !== undefined);
  return { needs, provided, missing: needs.filter((k) => !provided.includes(k)), ready: provided.length === needs.length };
}
