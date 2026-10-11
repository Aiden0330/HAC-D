/**
 * Fault-management mechanism library and attribution (docs/MODEL_REFERENCE.md §22).
 * The twelve mechanisms of the audited ai-cluster-reliability catalog (catalogs/review-2026-10-09/mechanisms.json)
 * expressed as HAC-D scenario transforms, with the reference's target parameters (mechanism-policy.json).
 * Attribution: single gains (baseline → +m), last-added gains (all − m → all) and exact Shapley values over
 * all 2^n coalitions, every coalition evaluated with the closed forms (delivered goodput by default).
 */
import type { Scenario } from '../scenario/schema.js';
import { evaluateScenario } from '../scenario/evaluate.js';
import { cloneScenario } from '../scenario/analysis.js';

export type MechanismKind = 'detect' | 'recover' | 'checkpoint' | 'physical';
export type MechanismStatus = 'baseline' | 'candidate' | 'conditional' | 'informational';

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
}

export const MECHANISM_LIBRARY: MechanismDef[] = [
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
      if (c.recovery.mode === 'mixture') c.recovery.detection = { ...c.recovery.detection, coverage: p.coverage, autoSeconds: p.detectSeconds };
      return c;
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
      for (const comp of c.components) if (comp.subhealth) comp.subhealth = { ...comp.subhealth, policy: comp.subhealth.policy ?? 'isolate', detection: { probability: p.coverage, delayHours: p.detectSeconds / 3600 } };
      return c;
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
      c.sdc = { ...c.sdc, detection: { coverage: p.coverage, detectSeconds: p.detectSeconds } };
      return c;
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
      c.sdc = { ...c.sdc, stepRecovery: { stepSeconds: p.stepSeconds, recoverSeconds: p.recoverSeconds } };
      return c;
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
      c.mechanisms = { ...c.mechanisms, replay: { success: p.success, successSeconds: p.successSeconds, failureSeconds: p.failureSeconds } };
      return c;
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
      c.mechanisms = { ...c.mechanisms, process: { success: p.success, successSeconds: p.successSeconds, failureSeconds: p.failureSeconds } };
      return c;
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
      c.mechanisms = { ...c.mechanisms, elastic: { domains: Math.max(1, Math.round(p.domains)), success: p.success, recoverSeconds: p.recoverSeconds, failureSeconds: p.failureSeconds, syncSeconds: p.syncSeconds } };
      return c;
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
      if (c.workload.type === 'training') c.workload = { ...c.workload, intervalS: p.computeSeconds, deltaS: p.saveSeconds };
      return c;
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
      for (const comp of c.components) comp.failure = { ...comp.failure, value: comp.failure.value * (1 - Math.min(0.999, p.reduction)) };
      return c;
    },
  },
];

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
  if (s.workload.type === 'training' && s.workload.intervalS !== undefined && s.workload.intervalS <= 60 && s.workload.deltaS <= 1) ids.push('C-FAST');
  return ids;
}

/**
 * Remove the given mechanisms from a scenario so that an attribution baseline does not already contain them.
 * Detection targets (D-HARD, D-SLOW) and the checkpoint settings (C-FAST) cannot be undone without knowing the
 * previous values: they are left as configured and the report notes it.
 */
export function stripMechanisms(s: Scenario, ids: string[]): Scenario {
  const c = cloneScenario(s);
  if (ids.includes('D-SDC')) c.sdc = { ...c.sdc, detection: { ...c.sdc.detection, coverage: 0 } };
  if (ids.includes('R-SDC')) c.sdc = { ...c.sdc, stepRecovery: undefined };
  if (ids.includes('R-REPLAY')) c.mechanisms = { ...c.mechanisms, replay: undefined };
  if (ids.includes('R-PROCESS')) c.mechanisms = { ...c.mechanisms, process: undefined };
  if (ids.includes('R-ELASTIC')) c.mechanisms = { ...c.mechanisms, elastic: undefined };
  return c;
}

export function mechanismById(id: string): MechanismDef {
  const m = MECHANISM_LIBRARY.find((x) => x.id === id);
  if (!m) throw new Error(`unknown mechanism '${id}'`);
  return m;
}

export type AttributionMetric = 'delivered' | 'effective' | 'aOp';

export interface MechanismValues {
  delivered: number;
  effective: number;
  aOp: number;
  mtbiHours: number;
  recoveryS: number;
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
    out = m.apply(out, { ...m.parameters, ...(parameters[m.id] ?? {}) });
  }
  return out;
}

export function mechanismValues(s: Scenario): MechanismValues {
  const r = evaluateScenario(s).training;
  if (!r) throw new Error('mechanism attribution needs a training workload');
  return { delivered: r.deliveredGoodput, effective: r.effectiveGoodput, aOp: r.operationalAvailability, mtbiHours: r.mtbiHours, recoveryS: r.recoveryS };
}

const factorial = (n: number): number => (n < 2 ? 1 : n * factorial(n - 1));

/**
 * Single, last-added and exact Shapley gains of the selected players (closed forms, all 2^n coalitions).
 * Players without an `apply` are ignored; a player whose requirement is absent from the coalition contributes 0 there.
 */
export function mechanismReport(s: Scenario, players: string[] = DEFAULT_PLAYERS, opts: { metric?: AttributionMetric; parameters?: Record<string, Record<string, number>> } = {}): MechanismReport {
  const metric = opts.metric ?? 'delivered';
  const ids = players.filter((id) => !!mechanismById(id).apply);
  if (ids.length > 12) throw new Error('at most 12 players (4096 coalitions)');
  const n = ids.length;
  const total = 1 << n;
  const base = stripMechanisms(s, ids);
  const values: MechanismValues[] = new Array(total);
  for (let mask = 0; mask < total; mask++) {
    const sel = ids.filter((_, i) => mask & (1 << i));
    values[mask] = mechanismValues(applyMechanisms(base, sel, opts.parameters));
  }
  const v = (mask: number) => values[mask][metric];
  const baseline = values[0];
  const combined = values[total - 1];
  const delta = v(total - 1) - v(0);
  const gains: MechanismGain[] = ids.map((id, i) => {
    const bit = 1 << i;
    let shapley = 0;
    for (let mask = 0; mask < total; mask++) {
      if (mask & bit) continue;
      const k = popcount(mask);
      const w = (factorial(k) * factorial(n - k - 1)) / factorial(n);
      shapley += w * (v(mask | bit) - v(mask));
    }
    return { id, values: values[bit], single: v(bit) - v(0), lastAdded: v(total - 1) - v((total - 1) & ~bit), shapley, share: delta !== 0 ? shapley / delta : 0 };
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
  if (already.length) notes.push(`baseline = the scenario without ${already.join(', ')} (stripped before the enumeration; detection targets and checkpoint settings cannot be stripped and stay as configured)`);
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
