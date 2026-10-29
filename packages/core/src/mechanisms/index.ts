/**
 * Fault-management mechanism library and attribution (docs/MODEL_REFERENCE.md §22).
 * The twelve mechanisms of the audited ai-cluster-reliability catalog (catalogs/review-2026-10-09/mechanisms.json)
 * expressed as HAC-D scenario transforms, with the reference's target parameters (mechanism-policy.json).
 * Attribution: single gains (baseline → +m), last-added gains (all − m → all) and exact Shapley values over
 * all 2^n coalitions, every coalition evaluated with the closed forms (delivered goodput by default).
 */
import type { Scenario } from '../scenario/schema.js';
import { evaluateScenario, resolvePipeline, automaticStages } from '../scenario/evaluate.js';
import { cloneScenario } from '../scenario/analysis.js';
import { recordApplied, restorePrevious, orNull, type Previous } from './applied.js';
import { AUDIT_MECHANISM_DEFS } from './auditLibrary.js';
import type { AuditBaseline, AuditCatalogMechanism, SinglePoint } from './auditTypes.js';
import { assertParameters } from './parameters.js';

export type MechanismKind = 'detect' | 'recover' | 'checkpoint' | 'physical';
export type MechanismStatus = 'baseline' | 'candidate' | 'conditional' | 'informational';

/** v5 the six layers of the per-unit basis, top-down (cluster = the job, scale-out network, SuperPoD / UB domain, cabinet, node, NPU) */
type LayerId = 'cluster' | 'scaleout' | 'superpod' | 'cabinet' | 'node' | 'npu';
/**
 * v5 where a mechanism is deployed, the layers whose events it acts on (by the catalog's candidate event classes), the recovery
 * stage or quantity it works on (mechanisms on the same stage take the minimum, never the sum) and, bilingual, how it is realised
 * and what it changes. Carried by a mechanism set record (packages/core/src/records/mechanismSet.ts).
 */
export interface MechanismMetadata {
  deploy: LayerId;
  acts: LayerId[];
  stage: 'detection' | 'rung' | 'automatic' | 'manual' | 'checkpoint' | 'sdc' | 'rate' | 'local' | 'none';
  how: { zh: string; en: string };
  changes: { zh: string; en: string };
}

export interface MechanismDef {
  id: string;
  name: { zh: string; en: string };
  kind: MechanismKind;
  status: MechanismStatus;
  /** which fault class or chain rung it acts on */
  scope: 'hard' | 'slow' | 'sdc' | 'all' | 'none' | 'replay' | 'process' | 'elastic';
  change: { zh: string; en: string };
  prerequisite: { zh: string; en: string };
  failure: { zh: string; en: string };
  confidence: string;
  /** default target parameters (the reference's mechanism-policy.json) */
  parameters: Record<string, number>;
  /** mechanisms that must be active for this one to have an effect */
  requires?: string[];
  /** relative implementation effort 1–5 used by the planner (0 = informational); editable per run */
  effort: number;
  /** scenario transform; absent for informational entries */
  apply?: (s: Scenario, p: Record<string, number>) => Scenario;
  /** v3.7 the audit catalog entry behind this mechanism (the 16 audited mechanisms) */
  audit?: AuditCatalogMechanism;
  /** v3.7 catalog event ids the mechanism can attach to (hard / sdc classes of the reference catalog) */
  events?: string[];
  /** v3.7 integration parameters the transform needs before it acts on the cluster-level models (null in the audit until measured) */
  integrationNeeds?: string[];
  /** v3.7 provisional values of those parameters (tagged assumed, derated by the planner) */
  provisional?: Record<string, number>;
  /** v6 parameter keys the transform reads optionally (implicit default when absent) beyond parameters / provisional / integrationNeeds; declared so that a set's keys can be validated */
  reads?: string[];
  /** v3.7 single-point quantification against the scenario's baseline (the audit's 口径) */
  singlePoint?: (b: AuditBaseline, p: Record<string, number>) => SinglePoint;
  /** v5 deployment layer, acted-on layers, stage and bilingual description (from a mechanism set record; absent in the built-in library) */
  metadata?: MechanismMetadata;
}

/** Mechanisms that only switch a block on, so that they can be removed exactly even without an applied record. */
const SWITCHABLE = ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'P-PREDICT', 'R-NETFAIL', 'R-HOTSWAP', 'R-LINK-LOCAL', 'R-FABRIC-DEGRADE', 'H-CONTROL-CONTINUITY'];

/** Whether `stripMechanisms` removes the mechanism exactly: an applied record exists, or the mechanism only switches a block on. */
export function isStrippable(s: Scenario, id: string): boolean {
  return !!s.mechanisms.applied?.[id] || SWITCHABLE.includes(id);
}

/**
 * Absolute per-class immediate-detection overrides (`component.sdc.coverage`) never fall below the scenario-level detector:
 * raise the ones below `q` and return the replaced sdc blocks for the applied record (restored as `componentSdc`).
 */
function raiseClassCoverage(c: Scenario, q: number): Record<string, Scenario['components'][number]['sdc'] | null> {
  const prev: Record<string, Scenario['components'][number]['sdc'] | null> = {};
  for (const comp of c.components) {
    if (comp.sdc?.coverage !== undefined && comp.sdc.coverage < q) {
      prev[comp.id] = { ...comp.sdc };
      comp.sdc = { ...comp.sdc, coverage: q };
    }
  }
  return prev;
}

export const MECHANISM_LIBRARY: MechanismDef[] = guardParameters([
  {
    id: 'D-HARD', name: { zh: '中断检测 / 超时兜底', en: 'Interruption detection / timeout fallback' }, kind: 'detect', status: 'baseline', scope: 'hard',
    change: { zh: '基线 95 % 在 10 s 发现、其余 60 s 超时 → 99.9 % 在 1 s 发现、其余 60 s；只改变停机中的发现时间', en: 'baseline 95 % detected in 10 s, rest by a 60 s timeout → 99.9 % in 1 s, rest 60 s; only the detection part of the outage changes' },
    prerequisite: { zh: '不增加误报或检测资源开销；此假设尚未计价', en: 'no extra false alarms or detection overhead; not priced yet' },
    failure: { zh: '仍由 60 s 超时兜底', en: 'the 60 s timeout still catches the rest' },
    confidence: 'baseline USER; 99.9 % / 1 s is a target to be audited',
    effort: 2,
    parameters: { coverage: 0.999, detectSeconds: 1 },
    apply: (s, p) => {
      if (s.recovery.mode !== 'mixture') return s;
      const c = cloneScenario(s);
      if (c.recovery.mode !== 'mixture') return c;
      const previous: Previous = { 'recovery.detection': { ...c.recovery.detection } };
      // a detector never makes the detection it replaces worse (v5.5, fourth review R4): the derated target (coverage 0.949) stays at
      // the baseline's 0.95 instead of undercutting it; the faster detection time is kept. The nominal target is above both.
      c.recovery = { ...c.recovery, detection: { ...c.recovery.detection, coverage: Math.max(c.recovery.detection.coverage, p.coverage), autoSeconds: Math.min(c.recovery.detection.autoSeconds, p.detectSeconds) } };
      return recordApplied(c, 'D-HARD', p, previous);
    },
  },
  {
    id: 'D-SLOW', name: { zh: '亚健康检测', en: 'Sub-health detection' }, kind: 'detect', status: 'baseline', scope: 'slow',
    change: { zh: '95 % 在 5 min 发现 → 99 % 在 30 s 发现；漏检仍降速 24 h；恢复仍 3 min、零回滚', en: '95 % detected in 5 min → 99 % in 30 s; undetected units stay slow for 24 h; recovery unchanged (3 min, no rollback)' },
    prerequisite: { zh: '识别真实亚健康而非负载变化，误报开销暂未计入', en: 'distinguishes real sub-health from load changes; false-alarm cost not counted' },
    failure: { zh: '漏检维持 24 h 降速；不是强制人工恢复', en: 'an undetected unit keeps slowing the job for 24 h; no forced manual recovery' },
    confidence: 'baseline USER; 99 % / 30 s is a target to be audited',
    effort: 3,
    parameters: { coverage: 0.99, detectSeconds: 30 },
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { subhealthDetection: Object.fromEntries(c.components.filter((x) => x.subhealth).map((x) => [x.id, { policy: orNull(x.subhealth!.policy), detection: orNull(x.subhealth!.detection) }])) };
      // as D-HARD (v5.5, fourth review R4): never below the class's detection probability, never slower than its delay
      for (const comp of c.components) if (comp.subhealth) {
        const d = comp.subhealth.detection;
        comp.subhealth = { ...comp.subhealth, policy: comp.subhealth.policy ?? 'isolate', detection: { probability: Math.max(d?.probability ?? 0, p.coverage), delayHours: Math.min(d?.delayHours ?? Infinity, p.detectSeconds / 3600) } };
      }
      return recordApplied(c, 'D-SLOW', p, previous);
    },
  },
  {
    id: 'D-SDC', name: { zh: '静默即时检测', en: 'Immediate silent-corruption detection' }, kind: 'detect', status: 'candidate', scope: 'sdc',
    change: { zh: '即时检出 0 % → 95 %，检测 1 s；仅启用检测时回到现有干净 CKPT 并用全局恢复；漏检仍 120 h 后发现', en: 'immediate detection 0 % → 95 % after 1 s; the job rolls back to the last checkpoint and runs the global recovery; the remaining 5 % are still found after 120 h' },
    prerequisite: { zh: '全链路污染识别与干净点验证；1 s 为场景值', en: 'end-to-end corruption identification and clean-point verification; 1 s is a scenario value' },
    failure: { zh: '保留既有污染，漏检走兜底；新检测不能清洗旧污染', en: 'an existing undetected corruption is kept; the fallback still applies; a new detection does not clean old corruption' },
    confidence: '95 % is a user target; 1 s a provisional step-level value',
    effort: 5,
    parameters: { coverage: 0.95, detectSeconds: 1 },
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'sdc.detection': { ...c.sdc.detection } };
      // a detector never lowers the coverage already in place (as D-SDC-DMR): D-SDC and D-SDC-DMR commute whatever the order (fifth review D5)
      const level = Math.max(c.sdc.detection.coverage, p.coverage);
      const raised = raiseClassCoverage(c, level);
      if (Object.keys(raised).length) previous.componentSdc = raised;
      c.sdc = { ...c.sdc, detection: { coverage: level, detectSeconds: p.detectSeconds } };
      return recordApplied(c, 'D-SDC', p, previous);
    },
  },
  {
    id: 'R-SDC', name: { zh: '干净状态恢复与 step 重算', en: 'Clean step-state recovery' }, kind: 'recover', status: 'conditional', scope: 'sdc', requires: ['D-SDC'],
    change: { zh: '已即时检出的静默从全局 CKPT / 3 min 恢复 → 易失干净 step 状态 / 1 s 恢复，最多重做 1 s 计算；不缩短漏检的兜底', en: 'a detected corruption recovers from the volatile clean step state in 1 s and redoes at most 1 s instead of the global checkpoint recovery; the fallback for undetected corruption is unchanged' },
    prerequisite: { zh: '必须有 D-SDC 即时定位与有效易失干净状态', en: 'needs immediate localisation (D-SDC) and a valid volatile clean state' },
    failure: { zh: '按恢复成功率 100 % 的理想能力评估；失败和覆盖范围待测', en: 'evaluated as an ideal capability (100 % success); failure modes and coverage to be measured' },
    confidence: 'ideal capability target, not a vendor measurement',
    effort: 4,
    parameters: { stepSeconds: 1, recoverSeconds: 1 },
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'sdc.stepRecovery': orNull(c.sdc.stepRecovery) };
      c.sdc = { ...c.sdc, stepRecovery: { stepSeconds: p.stepSeconds, recoverSeconds: p.recoverSeconds } };
      return recordApplied(c, 'R-SDC', p, previous);
    },
  },
  {
    id: 'R-REPLAY', name: { zh: '通信 / 算子重执行', en: 'Operator / communication replay' }, kind: 'recover', status: 'candidate', scope: 'replay',
    change: { zh: '瞬态中断先重执行：90 % 在 5 s 成功且不回滚；失败耗时 10 s 后进入后续恢复链', en: 'transient interruptions are re-executed first: 90 % succeed in 5 s without rollback; a failure costs 10 s and continues down the chain' },
    prerequisite: { zh: '可重执行、幂等、通信一致性；必须清除瞬态根因', en: 're-executable, idempotent, communication-consistent; the transient root cause must clear' },
    failure: { zh: '弹性 → 进程重调度 → 全局 CKPT → 人工', en: 'elastic → process reschedule → global checkpoint → manual' },
    confidence: 'PRIOR from the old mechanism library; not for persistent device damage',
    effort: 2,
    parameters: { success: 0.9, successSeconds: 5, failureSeconds: 10 },
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'mechanisms.replay': orNull(c.mechanisms.replay) };
      c.mechanisms = { ...c.mechanisms, replay: { success: p.success, successSeconds: p.successSeconds, failureSeconds: p.failureSeconds } };
      return recordApplied(c, 'R-REPLAY', p, previous);
    },
  },
  {
    id: 'R-PROCESS', name: { zh: '进程 / Pod 重调度', en: 'Process / pod rescheduling' }, kind: 'recover', status: 'candidate', scope: 'process',
    change: { zh: '适用中断 95 % 在 60 s 重建进程，仍全局暂停并回滚 CKPT；失败 120 s 后全局 CKPT', en: '95 % of applicable interruptions rebuild the process in 60 s (global pause, rollback to the checkpoint); a failure costs 120 s before the global recovery' },
    prerequisite: { zh: '健康备用资源；进程级故障可隔离；本版只用于中断', en: 'healthy spare resources; process-level faults isolable; interruptions only' },
    failure: { zh: '全局 CKPT → 人工', en: 'global checkpoint → manual' },
    confidence: 'PRIOR from the old mechanism library',
    effort: 3,
    parameters: { success: 0.95, successSeconds: 60, failureSeconds: 120 },
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'mechanisms.process': orNull(c.mechanisms.process) };
      c.mechanisms = { ...c.mechanisms, process: { success: p.success, successSeconds: p.successSeconds, failureSeconds: p.failureSeconds } };
      return recordApplied(c, 'R-PROCESS', p, previous);
    },
  },
  {
    id: 'R-ELASTIC', name: { zh: 'DP 域弹性恢复', en: 'DP-domain elastic recovery' }, kind: 'recover', status: 'conditional', scope: 'elastic',
    change: { zh: '适用中断 98 % 局部恢复成功：50 域中一个域 180 s 不可用，全局协调 1 s；状态冗余避免回滚；失败 120 s 后后续全局恢复', en: '98 % of applicable interruptions recover locally: one of 50 domains is out for 180 s, the job pauses 1 s to re-synchronise; redundant state avoids rollback; a failure costs 120 s before the next rung' },
    prerequisite: { zh: '其余域可持续产生可保留的有效进度；状态冗余、备用资源、DP 数学语义与收敛验证', en: 'the other domains keep producing retained progress; redundant state, spare resources, DP semantics and convergence verified' },
    failure: { zh: '进程重调度（若启用）→ 全局 CKPT → 人工', en: 'process reschedule (if enabled) → global checkpoint → manual' },
    confidence: '50 domains USER; 98 % and 1 s are priors to be audited; a capacity model, not a synchronous-training performance promise',
    effort: 5,
    parameters: { domains: 50, success: 0.98, recoverSeconds: 180, failureSeconds: 120, syncSeconds: 1 },
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'mechanisms.elastic': orNull(c.mechanisms.elastic) };
      c.mechanisms = { ...c.mechanisms, elastic: { domains: Math.max(1, Math.round(p.domains)), success: p.success, recoverSeconds: p.recoverSeconds, failureSeconds: p.failureSeconds, syncSeconds: p.syncSeconds } };
      return recordApplied(c, 'R-ELASTIC', p, previous);
    },
  },
  {
    id: 'R-CKPT', name: { zh: '全局 CKPT 自动恢复', en: 'Global checkpoint automatic recovery' }, kind: 'recover', status: 'baseline', scope: 'all',
    change: { zh: '恢复尝试固定 3 min，成功 99 %；中断回滚最近 CKPT，亚健康保存当前进度零回滚，静默回到干净 CKPT', en: 'automatic attempt 3 min with 99 % success; interruptions roll back to the last checkpoint, sub-health saves progress (no rollback), silent corruption returns to the clean checkpoint' },
    prerequisite: { zh: '干净检查点永久保留，存储可读，恢复加载已含 3 min', en: 'clean checkpoints are retained, storage readable, loading included in the 3 min' },
    failure: { zh: '1 % 失败额外人工 2 h', en: '1 % fail and add 2 h of manual work' },
    confidence: 'latest USER values (replace the old 10–20 min curve)',
    effort: 0,
    parameters: {},
  },
  {
    id: 'R-MANUAL', name: { zh: '人工诊断与恢复', en: 'Manual diagnosis and recovery' }, kind: 'recover', status: 'baseline', scope: 'all',
    change: { zh: '自动恢复失败后追加 120 min；最终成功率 100 %', en: '+120 min after a failed automatic attempt; final success 100 %' },
    prerequisite: { zh: '2 h 服务响应与资源修复能力；长尾尚未建模', en: '2 h service response and repair capacity; the long tail is not modelled' },
    failure: { zh: '超过 2 h 或最终失败的尾部待现场数据', en: 'tails beyond 2 h await field data' },
    confidence: '2 h USER; final success 100 % is a model termination assumption',
    effort: 0,
    parameters: {},
  },
  {
    id: 'C-FAST', name: { zh: '缩短 CKPT 周期和保存阻塞', en: 'Faster checkpoints' }, kind: 'checkpoint', status: 'candidate', scope: 'all',
    change: { zh: '每计算 300 s 保存 4 s → 每计算 60 s 保存 1 s；同时改变保存开销与回滚', en: 'save 4 s every 300 s of compute → save 1 s every 60 s; both the save overhead and the rollback change' },
    prerequisite: { zh: '带宽、并发、存储空间能支撑；异步实现效果待测', en: 'bandwidth, concurrency and storage can sustain it; asynchronous saving to be measured' },
    failure: { zh: '保存失败沿现有故障事件进入恢复；新增存储压力未建模', en: 'a failed save follows the existing fault events; extra storage load not modelled' },
    confidence: 'target prior of this round',
    effort: 3,
    parameters: { computeSeconds: 60, saveSeconds: 1 },
    apply: (s, p) => {
      const c = cloneScenario(s);
      if (c.workload.type !== 'training') return c;
      const previous: Previous = { 'workload.intervalS': orNull(c.workload.intervalS), 'workload.deltaS': c.workload.deltaS };
      c.workload = { ...c.workload, intervalS: p.computeSeconds, deltaS: p.saveSeconds };
      return recordApplied(c, 'C-FAST', p, previous);
    },
  },
  {
    id: 'H-PROTECT', name: { zh: '既有光路 / 供电保护', en: 'Existing optical / power protection' }, kind: 'physical', status: 'informational', scope: 'none',
    change: { zh: '事件率已是保护后的业务影响残余率；不能再次扣除同一份保护收益', en: 'event rates are already the residual business impact after protection; the same protection cannot be credited twice' },
    prerequisite: { zh: '需要保护前物理故障率、共因故障、切换覆盖率和拓扑', en: 'needs pre-protection physical rates, common cause, switchover coverage and topology (HAC-D: model them as redundancy groups with switchover)' },
    failure: { zh: '未增加收益；不是保护技术本身没有价值', en: 'no extra gain here; the protection itself is valuable' },
    confidence: 'no independent incremental parameter',
    effort: 0,
    parameters: {},
  },
  {
    id: 'H-RELIABILITY', name: { zh: '降低硬件物理故障率', en: 'Lower hardware failure rates' }, kind: 'physical', status: 'informational', scope: 'none',
    change: { zh: '必须逐事件给出新旧故障率；不擅自假设全硬件 FIT 下降比例（可在此输入一个待验证的下降比例）', en: 'needs per-event old and new rates; no blanket FIT reduction is assumed (enter a reduction factor here to explore one)' },
    prerequisite: { zh: '同器件、同暴露时长的前后实测；根因去重', en: 'before / after measurements on the same devices and exposure; root causes de-duplicated' },
    failure: { zh: '—', en: '—' },
    confidence: 'no quantified target provided',
    effort: 4,
    parameters: { reduction: 0 },
    apply: (s, p) => {
      if (!(p.reduction > 0)) return s;
      const c = cloneScenario(s);
      const f = 1 - Math.min(0.999, p.reduction);
      for (const comp of c.components) comp.failure = { ...comp.failure, value: comp.failure.value * f };
      return recordApplied(c, 'H-RELIABILITY', p, { rateFactor: f });
    },
  },
  {
    id: 'P-PREDICT', name: { zh: '故障预测与预先迁移', en: 'Failure prediction and pre-emptive migration' }, kind: 'detect', status: 'candidate', scope: 'hard',
    change: { zh: '预测器召回 50 % 的即将发生的中断，在下一个 checkpoint 做计划内迁移（180 s 停顿、不回滚、无检测时延）；精度 80 %，误报按 r(1 − p)/p 增加同样的停顿', en: 'the predictor catches 50 % of impending interruptions, which become planned migrations at the next checkpoint (180 s pause, no rollback, no detection delay); precision 80 %, false alarms add the same pause at r(1 − p)/p per interruption' },
    prerequisite: { zh: '可用的前兆信号（ECC 趋势、温度、PCIe 降级）与排名式健康评分；备用节点', en: 'leading signals (ECC trend, temperature, PCIe downtraining) and a ranking health score; spare nodes to migrate to' },
    failure: { zh: '漏报走正常检测与恢复链；误报只付迁移停顿', en: 'misses go through the normal detection and chain; false alarms only cost the migration pause' },
    confidence: 'HeaRank (64 % of failures in the top 5 % of nodes), Meta ECC-trend (48–72 h, 89–96 %), Clockwork pre-emptive mode: priors, not measured on this cluster',
    parameters: { recall: 0.5, precision: 0.8, migrationSeconds: 180 },
    effort: 3,
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'mechanisms.predict': orNull(c.mechanisms.predict) };
      c.mechanisms = { ...c.mechanisms, predict: { recall: p.recall, precision: p.precision, migrationSeconds: p.migrationSeconds } };
      return recordApplied(c, 'P-PREDICT', p, previous);
    },
  },
  {
    id: 'R-NETFAIL', name: { zh: '容错集合通信 / 多网卡切换', en: 'Fault-tolerant collectives and multi-NIC failover' }, kind: 'recover', status: 'candidate', scope: 'hard',
    change: { zh: '网卡或链路故障在一次迭代内被集合通信库吸收：95 % 在 2 s 内切换、不回滚、无检测时延；失败耗时 10 s 后进入检测与恢复链', en: 'NIC or link failures are absorbed inside the collective: 95 % fail over in 2 s with no rollback and no detection delay; a failure costs 10 s before the normal detection and chain' },
    prerequisite: { zh: '多网卡与多路径、支持连接迁移的集合通信库（R²CCL、VCCL 类）；仅对网络类事件', en: 'multi-NIC / multipath fabric and a collective library with connection migration (R²CCL, VCCL class); network-class events only (component applicability netfail)' },
    failure: { zh: '超时 → 正常恢复链', en: 'timeout → the normal chain' },
    confidence: 'R²CCL (< 1 % training overhead under NIC failures, 2 servers) and VCCL documentation: priors',
    parameters: { success: 0.95, successSeconds: 2, failureSeconds: 10 },
    effort: 3,
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'mechanisms.netfail': orNull(c.mechanisms.netfail) };
      c.mechanisms = { ...c.mechanisms, netfail: { success: p.success, successSeconds: p.successSeconds, failureSeconds: p.failureSeconds } };
      return recordApplied(c, 'R-NETFAIL', p, previous);
    },
  },
  {
    id: 'R-HOTSWAP', name: { zh: '故障卡热替换（零开销 checkpoint）', en: 'Hot-swap of failed devices with zero-overhead checkpoints' }, kind: 'recover', status: 'candidate', scope: 'hard',
    change: { zh: '卡 / 服务器级中断 90 % 在 180 s 内由备用设备热替换、不回滚；失败 60 s 后进入弹性 / 进程 / 全局', en: 'card / server interruptions are hot-swapped from a spare in 180 s with 90 % success and no rollback; a failure costs 60 s before elastic / process / global' },
    prerequisite: { zh: '热备卡与状态镜像（零开销 checkpoint 或冗余状态）；仅对卡 / 服务器范围的事件', en: 'hot spare devices and mirrored state (zero-overhead checkpoint or redundant state); card / server scoped events only (component applicability hotswap)' },
    failure: { zh: '弹性（若启用）→ 进程重调度 → 全局 CKPT → 人工', en: 'elastic (if enabled) → process → global checkpoint → manual' },
    confidence: 'PHOENIX (2026 preprint) and Clockwork TorchPass (~3 min, vendor claim): priors',
    parameters: { success: 0.9, successSeconds: 180, failureSeconds: 60 },
    effort: 4,
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'mechanisms.hotswap': orNull(c.mechanisms.hotswap) };
      c.mechanisms = { ...c.mechanisms, hotswap: { success: p.success, successSeconds: p.successSeconds, failureSeconds: p.failureSeconds } };
      return recordApplied(c, 'R-HOTSWAP', p, previous);
    },
  },
  {
    id: 'C-MEM', name: { zh: '内存 / 分层 checkpoint', en: 'In-memory and tiered checkpointing' }, kind: 'checkpoint', status: 'candidate', scope: 'all',
    change: { zh: '暴露保存时间降到 0.5 s、每 60 s 一次；从主机 / 邻居内存加载使全局恢复缩短 60 s；主机内存与流量干扰计 1 % 开销', en: 'exposed save time 0.5 s every 60 s; loading from host / peer memory shortens the global recovery by 60 s; host-memory and traffic interference cost 1 % of throughput' },
    prerequisite: { zh: '主机内存冗余（相邻节点、纠删码）与流量调度；存储带宽', en: 'host-memory redundancy (peer nodes, erasure coding) and traffic scheduling; storage bandwidth' },
    failure: { zh: '内存副本丢失时回退到远端存储的 checkpoint', en: 'falls back to the remote-storage checkpoint when memory copies are lost' },
    confidence: 'GEMINI (SOSP\'23, 13× faster recovery), ECCHECK (ICDCS\'25), TierCheck (2026): priors',
    parameters: { computeSeconds: 60, saveSeconds: 0.5, loadSavingSeconds: 60, overhead: 0.01 },
    effort: 3,
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = {};
      if (c.workload.type === 'training') {
        previous['workload.intervalS'] = orNull(c.workload.intervalS);
        previous['workload.deltaS'] = c.workload.deltaS;
        c.workload = { ...c.workload, intervalS: p.computeSeconds, deltaS: p.saveSeconds };
      }
      if (c.recovery.mode === 'mixture') {
        // v3.7 stage-aware: loading from host / peer memory removes the checkpoint-read stage (same numbers as before: 180 → 120 s)
        previous.recovery = c.recovery;
        const st = automaticStages(c.recovery);
        const read = Math.max(0, st.read - p.loadSavingSeconds);
        const total = Math.max(30, st.startup + read + st.communication);
        c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, seconds: total, stages: { startup: st.startup, graphWithinStartup: st.graphWithinStartup, read: Math.max(0, total - st.startup - st.communication), communication: st.communication } } };
      } else if (c.recovery.mode === 'preset' || c.recovery.mode === 'pipeline') {
        // loading from host / peer memory shortens the checkpoint-load stage (a preset is resolved into explicit stages); ladders carry no load stage
        previous.recovery = c.recovery;
        const stages = resolvePipeline(c).stages.map((st) => (st.name === 'load' && typeof st.value === 'number' ? { ...st, value: Math.max(0, st.value - p.loadSavingSeconds) } : { ...st }));
        c.recovery = { mode: 'pipeline', stages: stages as Extract<Scenario['recovery'], { mode: 'pipeline' }>['stages'] };
      }
      previous.overheads = orNull(c.mechanisms.overheads);
      c.mechanisms = { ...c.mechanisms, overheads: { ...(c.mechanisms.overheads ?? {}), 'C-MEM': p.overhead } };
      return recordApplied(c, 'C-MEM', p, previous);
    },
  },
  {
    id: 'D-SDC-DMR', name: { zh: '双模冗余 / 在线完整性校验（静默）', en: 'Dual modular redundancy / online integrity checks for silent corruption' }, kind: 'detect', status: 'candidate', scope: 'sdc',
    change: { zh: '静默即时检出率 → 99.9 %（1 s），代价为 8 % 的吞吐（SpareTrain 3–14 %；AEGIS 两段式校验约 1–3 %）', en: 'immediate silent-corruption detection → 99.9 % in 1 s at a throughput cost of 8 % (SpareTrain 3–14 %; AEGIS two-stage checks about 1–3 %)' },
    prerequisite: { zh: '冗余计算或轻量感知 + 验证两段式校验；空闲算力', en: 'redundant computation or a two-stage sensing + verification check; idle compute' },
    failure: { zh: '漏检走兜底；校验本身的误报未建模', en: 'misses go to the fallback; false positives of the check are not modelled' },
    confidence: 'SpareTrain (ICLR\'26, 32 H200), AEGIS (OSDI\'26, 35 M GPU-h): priors',
    parameters: { coverage: 0.999, detectSeconds: 1, overhead: 0.08 },
    effort: 4,
    apply: (s, p) => {
      const c = cloneScenario(s);
      const previous: Previous = { 'sdc.detection': { ...c.sdc.detection }, overheads: orNull(c.mechanisms.overheads) };
      const level = Math.max(c.sdc.detection.coverage, p.coverage);
      const raised = raiseClassCoverage(c, level);
      if (Object.keys(raised).length) previous.componentSdc = raised;
      c.sdc = { ...c.sdc, detection: { coverage: level, detectSeconds: p.detectSeconds } };
      c.mechanisms = { ...c.mechanisms, overheads: { ...(c.mechanisms.overheads ?? {}), 'D-SDC-DMR': p.overhead } };
      return recordApplied(c, 'D-SDC-DMR', p, previous);
    },
  },
  {
    id: 'H-LEMON', name: { zh: '问题节点（lemon）识别与剔除', en: 'Lemon-node detection and eviction' }, kind: 'physical', status: 'candidate', scope: 'hard',
    change: { zh: '反复出事的节点移出大作业：中断率 × (1 − share × reduction)，默认占比 10 %、剔除 70 %', en: 'nodes with repeated failures are removed from large jobs: interruption rates × (1 − share × reduction), default share 10 %, reduction 70 %' },
    prerequisite: { zh: '历史故障与排除记录；容量不被过度剔除耗尽', en: 'failure and exclusion history per node; capacity not starved by aggressive exclusion' },
    failure: { zh: '—', en: '—' },
    confidence: 'Meta "Revisiting reliability" (large-job failures 14 % → 4 %): prior share and reduction',
    parameters: { share: 0.1, reduction: 0.7 },
    effort: 2,
    apply: (s, p) => {
      const c = cloneScenario(s);
      const f = 1 - Math.min(1, p.share) * Math.min(1, p.reduction);
      for (const comp of c.components) comp.failure = { ...comp.failure, value: comp.failure.value * f };
      return recordApplied(c, 'H-LEMON', p, { rateFactor: f });
    },
  },
  {
    id: 'H-SWEEP', name: { zh: '节点离线巡检（亚健康筛查）', en: 'Offline node sweeps for sub-health' }, kind: 'physical', status: 'candidate', scope: 'slow',
    change: { zh: '上线前巡检剔除慢节点：亚健康进入率 × 0.5、持续时间 × 0.5', en: 'nodes are qualified before joining: sub-health entry rate × 0.5 and duration × 0.5' },
    prerequisite: { zh: '离线基准（NCCL、GEMM）与在线监控结合；备用节点', en: 'offline benchmarks (NCCL, GEMM) combined with online monitoring; spare nodes' },
    failure: { zh: '—', en: '—' },
    confidence: 'Guard (MLSys\'26: step variance 20 % → 1 %, MTTF up): priors',
    parameters: { rateFactor: 0.5, durationFactor: 0.5 },
    effort: 2,
    apply: (s, p) => {
      const c = cloneScenario(s);
      for (const comp of c.components) if (comp.subhealth) comp.subhealth = { ...comp.subhealth, ratePerHour: (comp.subhealth.ratePerHour ?? 0) * p.rateFactor, durationHours: comp.subhealth.durationHours * p.durationFactor };
      return recordApplied(c, 'H-SWEEP', p, { subhealthRateFactor: p.rateFactor, subhealthDurationFactor: p.durationFactor });
    },
  },
  ...AUDIT_MECHANISM_DEFS,
]);

/**
 * v5.8 (method & code review 2026-10-29, P1-③) every transform checks its parameters against their domains (mechanisms/parameters.ts)
 * before it runs, so a probability above 1 or a negative time stops at whichever path brought it — a set, a worksheet, a project edit,
 * a recorded parameter re-applied by stripMechanisms / editBase — instead of reaching the closed forms
 */
function guardParameters(defs: MechanismDef[]): MechanismDef[] {
  return defs.map((d) => {
    const apply = d.apply;
    return apply ? { ...d, apply: (s: Scenario, p: Record<string, number>) => { assertParameters(d.id, p); return apply(s, p); } } : d;
  });
}

export const DEFAULT_PLAYERS = ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];

/** Mechanisms whose parameters are present in the scenario (as configured, whatever their values). */
export function activeMechanisms(s: Scenario): string[] {
  const ids: string[] = [];
  if (s.recovery.mode === 'mixture' && s.recovery.detection.coverage >= 0.999 && s.recovery.detection.autoSeconds <= 1) ids.push('D-HARD');
  const sh = s.components.filter((c) => c.enabled && c.subhealth);
  if (sh.length && sh.every((c) => (c.subhealth!.detection?.probability ?? 0) >= 0.99)) ids.push('D-SLOW');
  if (s.sdc.detection.coverage > 0) ids.push('D-SDC');
  if (s.sdc.stepRecovery) ids.push('R-SDC');
  if (s.mechanisms.replay) ids.push('R-REPLAY');
  if (s.mechanisms.process) ids.push('R-PROCESS');
  if (s.mechanisms.elastic) ids.push('R-ELASTIC');
  if (s.mechanisms.predict) ids.push('P-PREDICT');
  if (s.mechanisms.netfail) ids.push('R-NETFAIL');
  if (s.mechanisms.hotswap) ids.push('R-HOTSWAP');
  for (const id of Object.keys(s.mechanisms.custom ?? {})) if (!ids.includes(id)) ids.push(id);
  for (const id of Object.keys(s.mechanisms.overheads ?? {})) if (!ids.includes(id)) ids.push(id);
  if (s.workload.type === 'training' && s.workload.intervalS !== undefined && s.workload.intervalS <= 60 && s.workload.deltaS <= 1 && !ids.includes('C-FAST')) ids.push('C-FAST');
  for (const id of Object.keys(s.mechanisms.applied ?? {})) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/**
 * Remove the given mechanisms from a scenario (the attribution baseline, the Remove button of the Mechanisms page).
 * Mechanisms applied through the library carry an applied record: every record is undone in reverse order of application
 * and the ones that stay are re-applied with their recorded parameters, so removal is the exact inverse of application
 * (docs/MODEL_REFERENCE.md §22.4). Without a record (scenario written by hand) the mechanism is switched off and the
 * settings it changed stay as configured; the attribution report notes it.
 */
export function stripMechanisms(s: Scenario, ids: string[]): Scenario {
  let c = cloneScenario(s);
  const records = Object.entries(c.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order);
  if (records.length) {
    for (const [, rec] of [...records].reverse()) restorePrevious(c, rec.previous);
    c.mechanisms = { ...c.mechanisms, applied: undefined };
    for (const [id, rec] of records) {
      if (ids.includes(id)) continue;
      const m = MECHANISM_LIBRARY.find((x) => x.id === id);
      if (m?.apply) c = m.apply(c, rec.parameters);
    }
  }
  const recorded = new Set(records.map(([id]) => id));
  for (const id of ids) {
    if (recorded.has(id)) continue;
    if (id === 'D-SDC') c.sdc = { ...c.sdc, detection: { ...c.sdc.detection, coverage: 0 } };
    else if (id === 'R-SDC') c.sdc = { ...c.sdc, stepRecovery: undefined };
    else if (id === 'R-REPLAY') c.mechanisms = { ...c.mechanisms, replay: undefined };
    else if (id === 'R-PROCESS') c.mechanisms = { ...c.mechanisms, process: undefined };
    else if (id === 'R-ELASTIC') c.mechanisms = { ...c.mechanisms, elastic: undefined };
    else if (id === 'P-PREDICT') c.mechanisms = { ...c.mechanisms, predict: undefined };
    else if (id === 'R-NETFAIL') c.mechanisms = { ...c.mechanisms, netfail: undefined };
    else if (id === 'R-HOTSWAP') c.mechanisms = { ...c.mechanisms, hotswap: undefined };
    if (c.mechanisms.custom && id in c.mechanisms.custom) {
      // v3.7 custom rung without a record: drop the rung and its per-class applicability
      const custom = { ...c.mechanisms.custom };
      delete custom[id];
      c.mechanisms = { ...c.mechanisms, custom: Object.keys(custom).length ? custom : undefined };
      for (const comp of c.components) if (comp.mechanisms?.custom && id in comp.mechanisms.custom) {
        const cc = { ...comp.mechanisms.custom };
        delete cc[id];
        comp.mechanisms = { ...comp.mechanisms, custom: Object.keys(cc).length ? cc : undefined };
      }
    }
    if (c.mechanisms.overheads && id in c.mechanisms.overheads) {
      const o = { ...c.mechanisms.overheads };
      delete o[id];
      c.mechanisms = { ...c.mechanisms, overheads: o };
    }
  }
  return c;
}

/**
 * v4 edit the design under the applied mechanisms: every recorded mechanism is removed (exact inverse), `fn` changes the bare
 * scenario, and the mechanisms are applied again in their recorded order with their recorded parameters. Settings a mechanism
 * owns (e.g. C-FAST's checkpoint interval) are therefore set again by it; see `mechanismOwner`.
 */
export function editBase(s: Scenario, fn: (bare: Scenario) => Scenario): Scenario {
  const records = Object.entries(s.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order);
  if (!records.length) return fn(cloneScenario(s));
  let c = fn(stripMechanisms(s, records.map(([id]) => id)));
  for (const [id, rec] of records) {
    const m = MECHANISM_LIBRARY.find((x) => x.id === id);
    if (m?.apply) c = m.apply(c, rec.parameters);
  }
  return c;
}

/** v4 the applied mechanism that owns a setting (its applied record replaced `key`, e.g. 'workload.deltaS', 'recovery.detection', 'sdc.detection'), if any (the last one applied wins) */
export function mechanismOwner(s: Scenario, key: string): string | undefined {
  let owner: string | undefined;
  let order = -1;
  for (const [id, rec] of Object.entries(s.mechanisms.applied ?? {})) if (key in rec.previous && rec.order > order) { owner = id; order = rec.order; }
  return owner;
}

export function mechanismById(id: string): MechanismDef {
  const m = MECHANISM_LIBRARY.find((x) => x.id === id);
  if (!m) throw new Error(`unknown mechanism '${id}'`);
  return m;
}

export type AttributionMetric = 'delivered' | 'effective' | 'aOp';

export interface MechanismValues {
  /** v5.7 the delivered and the effective goodput on the exact renewal model (the window ledger's model, the report's acceptance value) */
  delivered: number;
  effective: number;
  aOp: number;
  mtbiHours: number;
  recoveryS: number;
  /** checkpoint settings and window of the evaluated scenario (for the no-fault bounds of the planner) */
  tauS: number;
  deltaS: number;
  horizonH: number;
}

export interface MechanismGain {
  id: string;
  values: MechanismValues;
  /** metric gain over the baseline when applied alone */
  single: number;
  /** metric gain when added last to all the other players */
  lastAdded: number;
  /** exact Shapley contribution to (combined − baseline) */
  shapley: number;
  /** shapley / (combined − baseline) */
  share: number;
  /** v3.2: the same gains for every value function (A_op and delivered side by side) */
  byMetric: Record<AttributionMetric, { single: number; lastAdded: number; shapley: number }>;
}

export interface MechanismReport {
  metric: AttributionMetric;
  players: string[];
  baseline: MechanismValues;
  combined: MechanismValues;
  delta: number;
  gains: MechanismGain[];
  coalitions: number;
  /** Σ shapley − delta, should be ~0 */
  residual: number;
  /** interaction = delta − Σ single gains */
  interaction: number;
  notes: string[];
}

export function applyMechanisms(s: Scenario, ids: string[], parameters: Record<string, Record<string, number>> = {}): Scenario {
  let out = s;
  // apply in library order so that dependencies (e.g. D-SDC before R-SDC) are deterministic
  for (const m of MECHANISM_LIBRARY) {
    if (!ids.includes(m.id) || !m.apply) continue;
    // a mechanism already applied is removed first, so that re-applying it replaces its previous application instead of compounding
    if (out.mechanisms.applied?.[m.id]) out = stripMechanisms(out, [m.id]);
    out = m.apply(out, { ...m.parameters, ...(parameters[m.id] ?? {}) });
  }
  return out;
}

/**
 * v5.5 apply in the given order — a design's recorded order of application (`mechanisms.applied[].order`), which the derated
 * twin (`deratedOf`), the strategies' derated designs and the budget's rebuild must keep: not every pair of transforms commutes
 * (C-FAST and C-MEM both set τ and δ; same-stage reductions with a share below 1; custom rungs are tried in insertion order), so
 * a rebuild in library order is not the same design (fifth review D5). `applyMechanisms` remains the library-order form for
 * mechanisms added to a design. An id without a transform is skipped; an already applied one is replaced.
 */
export function applyMechanismsInOrder(s: Scenario, ids: string[], parameters: Record<string, Record<string, number>> = {}): Scenario {
  let out = s;
  for (const id of ids) {
    const m = MECHANISM_LIBRARY.find((x) => x.id === id);
    if (!m?.apply) continue;
    if (out.mechanisms.applied?.[id]) out = stripMechanisms(out, [id]);
    out = m.apply(out, { ...m.parameters, ...(parameters[id] ?? {}) });
  }
  return out;
}

export function mechanismValues(s: Scenario): MechanismValues {
  const r = evaluateScenario(s, { structure: false }).training;
  if (!r) throw new Error('mechanism attribution needs a training workload');
  const w = s.workload as Extract<Scenario['workload'], { type: 'training' }>;
  return { delivered: r.deliveredGoodputExact, effective: r.effectiveGoodputExact, aOp: r.operationalAvailability, mtbiHours: r.mtbiHours, recoveryS: r.recoveryS, tauS: r.tauS, deltaS: w.deltaS, horizonH: w.durationDays * 24 };
}

const factorial = (n: number): number => (n < 2 ? 1 : n * factorial(n - 1));

/**
 * Single, last-added and exact Shapley gains of the selected players (closed forms, all 2^n coalitions).
 * Players without an `apply` are ignored; a player whose requirement is absent from the coalition contributes 0 there.
 */
export interface MechanismReportOptions {
  metric?: AttributionMetric;
  parameters?: Record<string, Record<string, number>>;
  /** called about 64 times over the enumeration with the coalitions evaluated so far */
  onProgress?: (done: number, total: number) => void;
}

export function mechanismReport(s: Scenario, players: string[] = DEFAULT_PLAYERS, opts: MechanismReportOptions = {}): MechanismReport {
  const metric = opts.metric ?? 'delivered';
  const ids = players.filter((id) => !!mechanismById(id).apply);
  if (ids.length > 12) throw new Error('at most 12 players (4096 coalitions)');
  const n = ids.length;
  const total = 1 << n;
  const base = stripMechanisms(s, ids);
  const values: MechanismValues[] = new Array(total);
  const step = Math.max(1, Math.floor(total / 64));
  for (let mask = 0; mask < total; mask++) {
    const sel = ids.filter((_, i) => mask & (1 << i));
    values[mask] = mechanismValues(applyMechanisms(base, sel, opts.parameters));
    if (opts.onProgress && ((mask + 1) % step === 0 || mask + 1 === total)) opts.onProgress(mask + 1, total);
  }
  const v = (mask: number) => values[mask][metric];
  const baseline = values[0];
  const combined = values[total - 1];
  const delta = v(total - 1) - v(0);
  const metrics: AttributionMetric[] = ['delivered', 'effective', 'aOp'];
  const gains: MechanismGain[] = ids.map((id, i) => {
    const bit = 1 << i;
    const byMetric = {} as MechanismGain['byMetric'];
    for (const m of metrics) {
      const vm = (mask: number) => values[mask][m];
      let sh = 0;
      for (let mask = 0; mask < total; mask++) {
        if (mask & bit) continue;
        const k = popcount(mask);
        const w = (factorial(k) * factorial(n - k - 1)) / factorial(n);
        sh += w * (vm(mask | bit) - vm(mask));
      }
      byMetric[m] = { single: vm(bit) - vm(0), lastAdded: vm(total - 1) - vm((total - 1) & ~bit), shapley: sh };
    }
    const own = byMetric[metric];
    return { id, values: values[bit], single: own.single, lastAdded: own.lastAdded, shapley: own.shapley, share: delta !== 0 ? own.shapley / delta : 0, byMetric };
  });
  const sumShapley = gains.reduce((a, g) => a + g.shapley, 0);
  const sumSingle = gains.reduce((a, g) => a + g.single, 0);
  const notes = [
    `value function: ${metric === 'delivered' ? 'delivered goodput over the job window (closed forms)' : metric === 'effective' ? 'effective (performance) goodput' : 'operational availability A_op'}; ${total} coalitions evaluated exactly`,
    'Shapley values sum to the combined gain by construction; single gains do not (interaction term)',
  ];
  for (const id of ids) {
    const m = mechanismById(id);
    if (m.requires?.some((r) => !ids.includes(r))) notes.push(`${id} requires ${m.requires.join(', ')}: without it the mechanism has no effect`);
  }
  const already = activeMechanisms(s).filter((id) => ids.includes(id));
  if (already.length) {
    const exact = already.filter((id) => isStrippable(s, id));
    const partial = already.filter((id) => !isStrippable(s, id));
    notes.push(`baseline = the scenario without ${already.join(', ')} (removed before the enumeration${exact.length ? `; ${exact.join(', ')} restored exactly from the applied records` : ''}${partial.length ? `; ${partial.join(', ')} carry no applied record, so only their switches are turned off and the settings they changed stay as configured` : ''})`);
  }
  return { metric, players: ids, baseline, combined, delta, gains, coalitions: total, residual: sumShapley - delta, interaction: delta - sumSingle, notes };
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>>= 1;
  }
  return c;
}
