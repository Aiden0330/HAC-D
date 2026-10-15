/**
 * v3.7 single-point benefit audit (单点收益审核) of selected mechanisms against the scenario's own baseline, the 口径 of the
 * mechanism audit of 2026-10-14: every row quantifies one applicable, successfully handled event (or one stage), with its own
 * metric and denominator — seconds, detection fractions and FIT are different units and are never summed. Cluster-level
 * deltas (A_op, delivered and effective goodput at the scenario's size) are added for the mechanisms whose transform can act:
 * the built-in ones always, the audited ones when their integration parameters are given or the provisional switch is on.
 */
import type { Scenario } from '../scenario/schema.js';
import { evaluateScenario, automaticStages } from '../scenario/evaluate.js';
import { computeCounts, componentInstances } from '../scenario/build.js';
import { MECHANISM_LIBRARY, mechanismById, applyMechanisms, stripMechanisms, mechanismValues, activeMechanisms, type MechanismDef, type MechanismValues } from './index.js';
import { AUDIT_CATALOG } from './auditCatalog.js';
import { provisionalParameters, integrationStatus } from './auditLibrary.js';
import type { AuditBaseline, SinglePoint, AuditCatalogMechanism } from './auditTypes.js';

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The scenario's baseline in the audit's terms (12.5 / 180 / 150 s on the reference catalog). */
export function auditBaseline(s: Scenario): AuditBaseline {
  const ev = evaluateScenario(s, { structure: false });
  const t = ev.training;
  const counts = computeCounts(s);
  const sdcFitByClass: Record<string, number> = {};
  let sdcFitTotal = 0;
  for (const c of s.components) {
    if (!c.enabled || !c.sdc) continue;
    const ci = componentInstances(c, counts, s.measures.subhealthThreshold);
    const fit = ci.sdcLambda * 1e9;
    sdcFitByClass[c.id] = fit;
    sdcFitTotal += fit;
  }
  const w = s.workload.type === 'training' ? s.workload : undefined;
  const tauS = t?.tauS ?? (w?.intervalS ?? 300);
  const deltaS = w?.deltaS ?? 4;
  const rollbackS = t?.recomputePerInterruptionS ?? tauS / 2;
  if (s.recovery.mode === 'mixture') {
    const r = s.recovery;
    const detectS = r.detection.coverage * r.detection.autoSeconds + (1 - r.detection.coverage) * r.detection.timeoutSeconds;
    const st = automaticStages(r);
    const autoS = r.automatic.seconds;
    const manualProbability = 1 - r.automatic.successProbability;
    const manualS = r.manual.seconds;
    return { nGpus: w?.nGpus ?? 0, windowH: (w?.durationDays ?? 30) * 24, detectS, autoS, stages: { startup: st.startup, graphWithinStartup: st.graphWithinStartup, read: st.read, communication: st.communication }, manualProbability, manualS, tauS, deltaS, rollbackS, normalLossS: detectS + autoS + rollbackS, expectedRecoveryS: autoS + manualProbability * manualS, expectedLossS: detectS + autoS + manualProbability * manualS + rollbackS, sdcCoverage: t?.sdc?.coverage ?? s.sdc.detection.coverage, sdcFitTotal, sdcFitByClass, mixture: true };
  }
  // other recovery models: the mixture-equivalent numbers (detection = detect stage, automatic = the rest, no manual share)
  const detectS = t?.detectS ?? 0;
  const autoS = t?.globalRecoveryS ?? (t?.recoveryS ?? 0) - detectS;
  const third = autoS / 3;
  return { nGpus: w?.nGpus ?? 0, windowH: (w?.durationDays ?? 30) * 24, detectS, autoS, stages: { startup: third, graphWithinStartup: third / 2, read: third, communication: third }, manualProbability: 0, manualS: 0, tauS, deltaS, rollbackS, normalLossS: detectS + autoS + rollbackS, expectedRecoveryS: autoS, expectedLossS: detectS + autoS + rollbackS, sdcCoverage: t?.sdc?.coverage ?? s.sdc.detection.coverage, sdcFitTotal, sdcFitByClass, mixture: false };
}

const m = (zh: string, en: string) => ({ zh, en });
const dec = (metric: { zh: string; en: string }, before: number, after: number, formula: { zh: string; en: string }, unit: SinglePoint['unit'] = 'seconds', range?: SinglePoint['range'], derived?: Record<string, number>): SinglePoint => ({ metric, unit, direction: 'decrease', before: r3(before), after: r3(after), improvement: r3(before - after), reductionFraction: before > 0 ? (before - after) / before : undefined, formula, range, derived });
const inc = (metric: { zh: string; en: string }, before: number, after: number, formula: { zh: string; en: string }, range?: SinglePoint['range']): SinglePoint => ({ metric, unit: 'fraction', direction: 'increase', before: r3(before), after: r3(after), improvement: r3(after - before), formula, range });

/** Single-point quantification of the built-in (v3–v3.6) mechanisms against the same baseline. */
export const BUILTIN_SINGLE_POINT: Record<string, (b: AuditBaseline, p: Record<string, number>) => SinglePoint> = {
  'D-HARD': (b, p) => dec(m('检测时延 T_det', 'detection delay T_det'), b.detectS, p.coverage * p.detectSeconds + (1 - p.coverage) * 60, m(`T_det = p_d·t_auto + (1 − p_d)·60 s：${r3(b.detectS)} → ${r3(p.coverage * p.detectSeconds + (1 - p.coverage) * 60)} s`, 'T_det = p_d·t_auto + (1 − p_d)·timeout')),
  'D-SLOW': (_b, p) => inc(m('亚健康检出概率', 'sub-health detection probability'), 0.95, p.coverage, m(`95 % @ 5 min → ${r3(p.coverage * 100)} % @ ${p.detectSeconds} s；漏检仍降速 24 h`, `0.95 → ${p.coverage}; detection delay ${p.detectSeconds} s`)),
  'D-SDC': (b, p) => inc(m('静默错误即时检出率', 'immediate silent-corruption detection'), b.sdcCoverage, Math.max(b.sdcCoverage, p.coverage), m(`q：${r3(b.sdcCoverage * 100)} % → ${r3(p.coverage * 100)} %；漏检仍在 ${AUDIT_CATALOG.sdcRecoveryContract.latentDiscoverySeconds} s 后发现`, `q ${b.sdcCoverage} → ${p.coverage}`)),
  'R-SDC': (b, p) => dec(m('已检出静默错误的单次损失', 'loss of one detected silent event'), b.detectS + b.autoS + b.rollbackS, p.stepSeconds + p.recoverSeconds + 1, m(`干净 CKPT 回滚 ${r3(b.detectS + b.autoS + b.rollbackS)} s → 检测 1 + 恢复 ${p.recoverSeconds} + step 重算 ${p.stepSeconds} s`, 'clean-checkpoint rollback → step recovery')),
  'R-REPLAY': (b, p) => dec(m('常规单次等效损失（适用瞬态事件）', 'loss of one applicable transient event'), b.normalLossS, b.detectS + p.successSeconds, m(`成功路径 d + t_rp = ${r3(b.detectS)} + ${p.successSeconds} s，无回滚；失败 +${p.failureSeconds} s 后进入后续梯级`, 'success path d + t_rp, no rollback')),
  'R-PROCESS': (b, p) => dec(m('常规单次等效损失（适用事件）', 'loss of one applicable event'), b.normalLossS, b.detectS + p.successSeconds + b.rollbackS, m(`d + t_pr + W = ${r3(b.detectS)} + ${p.successSeconds} + ${r3(b.rollbackS)} s（仍回滚）`, 'd + t_pr + W, rollback kept')),
  'R-ELASTIC': (b, p) => dec(m('常规单次等效损失（适用事件，含域损失）', 'loss of one applicable event incl. domain loss'), b.normalLossS, p.syncSeconds + (b.detectS + p.recoverSeconds - p.syncSeconds) / Math.max(1, p.domains), m(`全局暂停 t_sync = ${p.syncSeconds} s + 域损失 (d + t_el − t_sync)/n = ${r3((b.detectS + p.recoverSeconds - p.syncSeconds) / Math.max(1, p.domains))} s，无回滚`, 'global pause t_sync + (d + t_el − t_sync)/domains, no rollback')),
  'C-FAST': (b, p) => dec(m('每次保存阻塞（回滚 W 随 τ 同步缩短）', 'blocking per save (W shrinks with τ)'), b.deltaS, p.saveSeconds, m(`δ ${r3(b.deltaS)} → ${p.saveSeconds} s；τ ${r3(b.tauS)} → ${p.computeSeconds} s，W = τ/2：${r3(b.rollbackS)} → ${r3(p.computeSeconds / 2)} s`, 'δ and τ both change'), 'seconds', undefined, { rollbackAfterSeconds: r3(p.computeSeconds / 2), saveShareAfter: r3(p.saveSeconds / (p.computeSeconds + p.saveSeconds)) }),
  'H-RELIABILITY': (_b, p) => dec(m('硬件中断率因子', 'hardware interruption-rate factor'), 1, 1 - Math.min(0.999, p.reduction), m(`λ × (1 − ${p.reduction})；须逐事件给出新旧率`, 'λ × (1 − reduction)'), 'fraction'),
  'P-PREDICT': (b, p) => dec(m('被预测事件的单次损失（含误报）', 'loss of one predicted event incl. false alarms'), b.normalLossS, p.migrationSeconds / Math.max(0.01, p.precision), m(`命中：计划迁移 ${p.migrationSeconds} s，无检测时延、无回滚；误报按 (1 − p)/p 追加同样停顿 → 每命中事件 t_mig/p = ${r3(p.migrationSeconds / Math.max(0.01, p.precision))} s；召回 ${p.recall} 决定适用份额`, 'hit: migration pause, no detection delay or rollback; false alarms add t_mig·(1 − p)/p')),
  'R-NETFAIL': (b, p) => dec(m('常规单次等效损失（网络类事件）', 'loss of one network event'), b.normalLossS, p.successSeconds, m(`集合通信内切换 ${p.successSeconds} s，无检测时延、无回滚；失败 +${p.failureSeconds} s`, 'failover inside the collective, no detection delay or rollback')),
  'R-HOTSWAP': (b, p) => dec(m('常规单次等效损失（卡 / 服务器事件）', 'loss of one card / server event'), b.normalLossS, b.detectS + p.successSeconds, m(`d + t_hs = ${r3(b.detectS)} + ${p.successSeconds} s，无回滚；失败 +${p.failureSeconds} s`, 'd + t_hs, no rollback')),
  'C-MEM': (b, p) => dec(m('全局恢复时间（内存加载）与保存阻塞', 'global recovery (memory load) and blocking per save'), b.autoS, Math.max(30, b.autoS - p.loadSavingSeconds), m(`自动恢复 ${r3(b.autoS)} → ${r3(Math.max(30, b.autoS - p.loadSavingSeconds))} s（读取阶段由主机 / 邻居内存承担）；δ → ${p.saveSeconds} s；开销 ${r3(p.overhead * 100)} %`, 'automatic attempt − load saving; δ; overhead'), 'seconds', undefined, { saveSecondsAfter: p.saveSeconds, overheadFraction: p.overhead }),
  'D-SDC-DMR': (b, p) => inc(m('静默错误即时检出率（双模冗余）', 'immediate silent-corruption detection (DMR)'), b.sdcCoverage, Math.max(b.sdcCoverage, p.coverage), m(`q → ${r3(p.coverage * 100)} %，代价 ${r3(p.overhead * 100)} % 吞吐`, `q → ${p.coverage} at ${p.overhead * 100} % throughput`)),
  'H-LEMON': (_b, p) => dec(m('硬件中断率因子', 'hardware interruption-rate factor'), 1, 1 - Math.min(1, p.share) * Math.min(1, p.reduction), m(`λ × (1 − share × reduction) = 1 − ${p.share} × ${p.reduction}`, 'λ × (1 − share·reduction)'), 'fraction'),
  'H-SWEEP': (_b, p) => dec(m('亚健康暴露因子（进入率 × 持续时间）', 'sub-health exposure factor (rate × duration)'), 1, p.rateFactor * p.durationFactor, m(`进入率 × ${p.rateFactor}，持续时间 × ${p.durationFactor}`, 'rate and duration factors'), 'fraction'),
};

export interface AuditRow {
  id: string;
  name: { zh: string; en: string };
  category: string;
  origin: string;
  designStatus: string;
  kind: MechanismDef['kind'];
  status: MechanismDef['status'];
  scope: MechanismDef['scope'];
  effort: number;
  /** quantification basis (口径) and trigger of the audit, or HAC-D's change text for the built-in mechanisms */
  basis: string;
  trigger?: AuditCatalogMechanism['trigger'];
  events: string[];
  parameters: Record<string, number>;
  singlePoint?: SinglePoint;
  /** the audit's own numbers for the audited mechanisms (for comparison with the scenario-based ones) */
  auditQuantification?: AuditCatalogMechanism['quantification'];
  texts: { change: string; prerequisite: string; failure: string; evidence?: string; cost?: string; overlap?: string; acceptance?: string; principle?: string; lever?: string; successCriteria?: string; doNotTrigger?: string; workflow?: string[]; observe?: string[]; scope?: string; confidence: string };
  sources: { title: string; url: string }[];
  integration: { needs: string[]; provided: string[]; missing: string[]; ready: boolean; provisional: boolean; values: Record<string, number | null> };
  /** whether the transform acts on the cluster-level models with the parameters given */
  clusterReady: boolean;
  /** cluster-level single application on the scenario (metric deltas), when clusterReady */
  cluster?: { aOp: number; delivered: number; effective: number; mtbiHours: number; recoveryS: number; note?: string };
}

export interface AuditReport {
  version: string;
  generated: string;
  scenario: { id?: string; name?: string; nGpus: number; windowH: number };
  baseline: AuditBaseline;
  baselineValues: MechanismValues;
  provisional: boolean;
  rows: AuditRow[];
  stageBudget: { startup: number; graphWithinStartup: number; read: number; communication: number; total: number; status: string };
  sdcRecoveryContract: Record<string, string | number>;
  notes: { zh: string; en: string }[];
}

export interface AuditOptions {
  /** mechanisms to audit (default: every library mechanism) */
  ids?: string[];
  /** fill the null integration fields of the audited mechanisms with the provisional assumptions */
  provisional?: boolean;
  /** parameter overrides per mechanism (library parameters and integration fields) */
  parameters?: Record<string, Record<string, number>>;
  /** evaluate the cluster-level single application of each ready mechanism (default true) */
  cluster?: boolean;
}

/** Audit the selected mechanisms on a scenario: single-point rows in the audit's 口径 plus cluster-level deltas where possible. */
export function auditMechanisms(s: Scenario, opts: AuditOptions = {}): AuditReport {
  const ids = opts.ids ?? MECHANISM_LIBRARY.map((x) => x.id);
  const baseline = auditBaseline(s);
  const provisional = !!opts.provisional;
  const prov = provisional ? provisionalParameters(ids) : {};
  const baseScenario = stripMechanisms(s, ids);
  const baselineValues = mechanismValues(baseScenario);
  const already = activeMechanisms(s);
  const rows: AuditRow[] = ids.map((id) => {
    const def = mechanismById(id);
    const p: Record<string, number> = { ...def.parameters, ...(prov[id] ?? {}), ...(opts.parameters?.[id] ?? {}) };
    const st = integrationStatus(def, p);
    const a = def.audit;
    const values: Record<string, number | null> = {};
    for (const k of st.needs) values[k] = typeof p[k] === 'number' ? p[k] : null;
    const sp = (def.singlePoint ?? BUILTIN_SINGLE_POINT[id])?.(baseline, p);
    const clusterReady = !!def.apply && st.ready && (!def.requires || def.requires.every((r) => ids.includes(r) || already.includes(r)));
    const row: AuditRow = {
      id, name: def.name, category: a?.category ?? (def.status === 'baseline' ? '基线已有' : 'HAC-D 机制库 v3'), origin: a?.origin ?? 'HAC-D 机制库（参考目录 / 文献先验）', designStatus: a?.designStatus ?? def.confidence,
      kind: def.kind, status: def.status, scope: def.scope, effort: def.effort,
      basis: a?.basis ?? def.change.zh, trigger: a?.trigger, events: def.events ?? a?.eventCandidates ?? [], parameters: p, singlePoint: sp, auditQuantification: a?.quantification,
      texts: { change: a?.change ?? def.change.zh, prerequisite: a?.prerequisite ?? def.prerequisite.zh, failure: a?.failure ?? def.failure.zh, evidence: a?.evidence, cost: a?.cost, overlap: a?.overlap, acceptance: a?.acceptance, principle: a?.principle, lever: a?.lever, successCriteria: a?.successCriteria, doNotTrigger: a?.doNotTrigger, workflow: a?.workflow, observe: a?.observe, scope: a?.scope, confidence: def.confidence },
      sources: (a?.sourceIds ?? []).map((k) => AUDIT_CATALOG.sources[k]).filter(Boolean),
      integration: { ...st, provisional: provisional && !!prov[id] && st.needs.some((k) => prov[id]?.[k] !== undefined && opts.parameters?.[id]?.[k] === undefined), values },
      clusterReady,
    };
    if (clusterReady && opts.cluster !== false) {
      // incremental over the prerequisites (R-SDC over D-SDC, R-HCCL-ELASTIC over R-ELASTIC): the required mechanisms are applied to the baseline first
      const required = (def.requires ?? []).filter((r) => !already.includes(r));
      const params = { ...prov, ...(opts.parameters ?? {}) };
      const withRequired = required.length ? applyMechanisms(baseScenario, required, params) : baseScenario;
      const v0 = required.length ? mechanismValues(withRequired) : baselineValues;
      const v = mechanismValues(applyMechanisms(withRequired, [id], params));
      row.cluster = { aOp: v.aOp - v0.aOp, delivered: v.delivered - v0.delivered, effective: v.effective - v0.effective, mtbiHours: v.mtbiHours, recoveryS: v.recoveryS, note: required.length ? `incremental over ${required.join(', ')} (required, applied first)` : undefined };
    }
    return row;
  });
  const sb = AUDIT_CATALOG.startupBudgetAssumption;
  const notes = [
    m('所有候选收益都是条件估算：机制库目标值与文献先验，不是厂商实测保证；不同条目的分母不同，秒数、检出率百分点与 FIT 不能混合排序为总体收益。', 'Every candidate gain is a conditional estimate from library targets and literature priors, not a vendor measurement; rows have different denominators (seconds, detection fractions, FIT) and must not be summed.'),
    m(`常规损失 ${r3(baseline.normalLossS)} s = 发现 ${r3(baseline.detectS)} + 自动恢复 ${r3(baseline.autoS)} + 平均回滚 ${r3(baseline.rollbackS)} s（自动恢复成功的参考路径）；含人工尾部的期望损失 ${r3(baseline.expectedLossS)} s 另列，不与常规口径混用。`, `Regular loss ${r3(baseline.normalLossS)} s = detection + automatic attempt + mean rollback (the success path); the expected loss with the manual tail ${r3(baseline.expectedLossS)} s is a separate 口径.`),
    m(`启动与读取预算是对 ${r3(baseline.autoS)} s 自动恢复的工程拆分：启动 ${r3(baseline.stages.startup)} s（含图准备 ${r3(baseline.stages.graphWithinStartup)} s）＋读取 ${r3(baseline.stages.read)} s＋通信重建 ${r3(baseline.stages.communication)} s；同一阶段的机制取最小值，不相加。`, 'The startup / read / communication budget is an engineering split of the automatic attempt; mechanisms on the same stage take the minimum, never the sum.'),
    m(provisional ? '集群级增量使用了临时假设值（适用比例、条件成功率、失败耗时、风险占比等，标注 assumed），规划器会对其降额；实测后请替换。' : '审核条目的四个待校准字段保持为空：这些机制只出现在单点表中；在"使用临时假设"开关打开或填写实测值后才进入集群级模型。', provisional ? 'Cluster-level deltas use the provisional assumptions (eligible share, conditional success, failure seconds, risk share; tagged assumed, derated by the planner); replace them with measurements.' : 'The four integration fields of the audited mechanisms stay null: those mechanisms appear only in the single-point table until the provisional switch is on or measured values are entered.'),
  ];
  return { version: AUDIT_CATALOG.version, generated: new Date().toISOString(), scenario: { id: s.meta.id, name: s.meta.name, nGpus: baseline.nGpus, windowH: baseline.windowH }, baseline, baselineValues, provisional, rows, stageBudget: { startup: baseline.stages.startup, graphWithinStartup: baseline.stages.graphWithinStartup, read: baseline.stages.read, communication: baseline.stages.communication, total: baseline.autoS, status: sb.status }, sdcRecoveryContract: AUDIT_CATALOG.sdcRecoveryContract, notes };
}
