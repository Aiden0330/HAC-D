/**
 * The ReMAP mechanism set (8 original + 15 latest extensions + the I-CONTAIN capability) categorised for the allocation report set:
 * deployment layer and the layers it acts on (by the catalog's candidate event classes), the quantity it changes, parameters nominal
 * and derated (ReMAP-latest values of scripts/remap-latest-params.ts), effort, the A_op and delivered-goodput Shapley values on the
 * four architectures (docs/backup/arch-mechanism-shapley/*.json: 23 players, 300 permutations, bare scenario) and the verdict:
 *   reference   — ReMAP's six reference mechanisms: in the baseline of every design;
 *   candidate   — an A_op lever of the allocation: A_op Shapley ≥ 0.15 pt at 500k on every architecture and not dominated on a shared
 *                 recovery stage (mechanisms on the same stage take the minimum, never the sum);
 *   goodput     — kept for the delivered goodput (silent-corruption detection, checkpoint cost), outside the A_op allocation;
 *   pruned      — dominated on its stage (R-WARM-PROCESS, R-CANN-GRAPH vs R-RUNTIME-SNAPSHOT) or without effect on either metric
 *                 beyond noise (R-HCCL-ELASTIC, D-SLOW);
 *   capability  — I-CONTAIN: the enabling capability of R-ELASTIC, no separate credit (cannot be applied).
 * The verdicts are checked against the rule on the Shapley data; a mismatch throws.
 * Usage: node --import tsx scripts/ascend-mechanism-hierarchy.ts [--out docs/backup/ascend-allocation/mechanisms.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MECHANISM_LIBRARY, DEFAULT_PLAYERS } from '../packages/core/src/mechanisms/index.js';
import { AUDIT_CATALOG } from '../packages/core/src/mechanisms/auditCatalog.js';
import { DERATE_DEFAULT, derateParameters } from '../packages/core/src/mechanisms/plan.js';
import { REMAP_LATEST_PARAMS } from './remap-latest-params.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/backup/ascend-allocation/mechanisms.json';
const SHAPLEY_DIR = flag('shapley-dir') ?? 'docs/backup/arch-mechanism-shapley';
const ARCHS = ['native950', 'ubl128', 'cm384', 'a3server'];
const THRESHOLD = 0.0015; // 0.15 points at 500k on every architecture (A_op → candidate; delivered goodput → goodput-only)

type L = { zh: string; en: string };
type LayerId = 'cluster' | 'scaleout' | 'superpod' | 'cabinet' | 'node' | 'npu';
type Verdict = 'reference' | 'candidate' | 'goodput' | 'pruned' | 'capability';
const ORIGINAL = ['D-HARD', 'D-SLOW', 'D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'];
const EXT = MECHANISM_LIBRARY.filter((m) => m.audit).map((m) => m.id); // 15 appliable + I-CONTAIN
const ALL = [...ORIGINAL, ...EXT];

/** where the mechanism runs, which layers' events it acts on (catalog candidate classes), and the quantity it changes */
const MAP: Record<string, { deploy: LayerId; how: L; acts: LayerId[]; changes: L; stage: 'detection' | 'rung' | 'automatic' | 'manual' | 'checkpoint' | 'sdc' | 'rate' | 'local' | 'none' }> = {
  'D-HARD': { deploy: 'cluster', how: { zh: '集群管理：中断检测', en: 'cluster management: interruption detection' }, acts: ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu'], changes: { zh: '检测延迟：95 % 在 10 s、其余 60 s → 99.9 % 在 1 s', en: 'detection delay: 95 % in 10 s, rest 60 s → 99.9 % in 1 s' }, stage: 'detection' },
  'D-SLOW': { deploy: 'cluster', how: { zh: '集群监控：亚健康检出', en: 'cluster monitoring: sub-health detection' }, acts: ['superpod', 'cabinet', 'node', 'npu'], changes: { zh: '亚健康检出 95 % / 5 min → 99 % / 30 s（隔离暂停随之增加）', en: 'sub-health detection 95 % / 5 min → 99 % / 30 s (more isolation pauses)' }, stage: 'rate' },
  'D-SDC': { deploy: 'npu', how: { zh: '芯片与框架：step 级计算校验', en: 'device and framework: step-level compute checks' }, acts: ['npu', 'node', 'superpod'], changes: { zh: '静默损坏即时检出 0 → 95 %（1 s）', en: 'immediate silent-corruption detection 0 → 95 % (1 s)' }, stage: 'sdc' },
  'R-SDC': { deploy: 'npu', how: { zh: '芯片：HBM 中的干净 step 状态', en: 'device: clean step state kept in HBM' }, acts: ['npu'], changes: { zh: '检出的静默从 1 s 干净状态恢复，不回滚全局 CKPT', en: 'detected corruption recovers from the 1 s clean state, no global rollback' }, stage: 'sdc' },
  'R-REPLAY': { deploy: 'npu', how: { zh: '芯片运行时：算子 / 集合通信重执行', en: 'device runtime: operator / collective replay' }, acts: ['npu', 'node', 'superpod', 'scaleout'], changes: { zh: '瞬态中断的第一梯级：90 % 在 5 s', en: 'first rung for transient interruptions: 90 % in 5 s' }, stage: 'rung' },
  'R-PROCESS': { deploy: 'node', how: { zh: '节点：训练进程 / 容器重建', en: 'node: training process / container rebuilt' }, acts: ['npu', 'node'], changes: { zh: '进程级梯级：95 % 在 60 s（回滚）', en: 'process rung: 95 % in 60 s (rollback)' }, stage: 'rung' },
  'R-ELASTIC': { deploy: 'cluster', how: { zh: '集群：50 个 DP 域的局部恢复', en: 'cluster: local recovery in 50 DP domains' }, acts: ['npu', 'node'], changes: { zh: '弹性梯级：98 % 局部恢复，作业只停 1 s', en: 'elastic rung: 98 % local, the job pauses 1 s' }, stage: 'rung' },
  'C-FAST': { deploy: 'cluster', how: { zh: '集群：检查点与共享存储', en: 'cluster: checkpoints and shared storage' }, acts: ['cluster'], changes: { zh: '保存 4 s / 300 s → 1 s / 60 s（回滚损失）', en: 'save 4 s / 300 s → 1 s / 60 s (rollback loss)' }, stage: 'checkpoint' },
  'R-LINK-LOCAL': { deploy: 'superpod', how: { zh: 'UB / RoCE 链路层：链路透明恢复', en: 'UB / RoCE link layer: link-transparent recovery' }, acts: ['superpod', 'scaleout', 'npu'], changes: { zh: '新增透明梯级：瞬态链路异常 95 % 在 2 s，不检测延迟、不回滚', en: 'new transparent rung: transient link faults 95 % in 2 s, no detection delay, no rollback' }, stage: 'rung' },
  'R-FABRIC-DEGRADE': { deploy: 'superpod', how: { zh: 'UB / RoCE 交换层：绕行与降级运行', en: 'UB / RoCE switching: re-route and degraded running' }, acts: ['superpod', 'scaleout'], changes: { zh: '新增透明梯级：交换 / 链路资源故障 95 % 在 2 s 绕行，修复期降级运行（只损失有效产出）', en: 'new transparent rung: switch / link faults re-routed 95 % in 2 s, degraded running during repair (goodput only)' }, stage: 'rung' },
  'H-CONTROL-CONTINUITY': { deploy: 'cabinet', how: { zh: '管理面：控制面故障下数据面继续运行', en: 'management: data plane continues under control-plane faults' }, acts: ['node'], changes: { zh: '新增透明梯级：MGMT 事件 95 % 只停 1 s', en: 'new transparent rung: MGMT events pause 1 s in 95 % of cases' }, stage: 'rung' },
  'R-WARM-PROCESS': { deploy: 'node', how: { zh: '节点：预热进程与可信状态接替', en: 'node: warm standby process' }, acts: ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu'], changes: { zh: '自动恢复的启动阶段 60 → 20 s', en: 'startup stage of the automatic recovery 60 → 20 s' }, stage: 'automatic' },
  'R-RUNTIME-SNAPSHOT': { deploy: 'node', how: { zh: '节点：运行时初始化快照', en: 'node: runtime initialisation snapshot' }, acts: ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu'], changes: { zh: '自动恢复的启动阶段 60 → 15 s', en: 'startup stage of the automatic recovery 60 → 15 s' }, stage: 'automatic' },
  'R-CANN-GRAPH': { deploy: 'npu', how: { zh: '芯片运行时：CANN 图准备与启动缓存', en: 'device runtime: CANN graph preparation caches' }, acts: ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu'], changes: { zh: '启动阶段中的图准备 30 → 7.5 s', en: 'graph preparation within startup 30 → 7.5 s' }, stage: 'automatic' },
  'C-ASYNC': { deploy: 'cluster', how: { zh: '集群：异步检查点保存', en: 'cluster: asynchronous checkpoint saves' }, acts: ['cluster'], changes: { zh: '每次保存阻塞 4 → 1 s，回滚多 10 s 持久化滞后', en: 'blocking per save 4 → 1 s, 10 s durable lag on every rollback' }, stage: 'checkpoint' },
  'C-LOSSLESS': { deploy: 'cluster', how: { zh: '集群：无损检查点压缩', en: 'cluster: lossless checkpoint compression' }, acts: ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu'], changes: { zh: '自动恢复的检查点读取阶段 60 → 40 s', en: 'checkpoint-read stage of the automatic recovery 60 → 40 s' }, stage: 'automatic' },
  'D-RECOVERY-CLASSIFY': { deploy: 'cluster', how: { zh: '集群运维：故障分类与恢复动作匹配', en: 'operations: fault classification and action matching' }, acts: ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu'], changes: { zh: '2 h 人工兜底的概率 1 % → 0.1 %', en: 'probability of the 2 h manual fallback 1 % → 0.1 %' }, stage: 'manual' },
  'D-SDC-FP8': { deploy: 'npu', how: { zh: '芯片：FP8 计算路径校验', en: 'device: FP8 compute-path checks' }, acts: ['npu'], changes: { zh: 'FP8 路径的静默检出 95 %（CORE 风险的一半）', en: 'silent detection 95 % on the FP8 path (half the CORE risk)' }, stage: 'sdc' },
  'D-SDC-FP4': { deploy: 'npu', how: { zh: '芯片：FP4 计算路径校验', en: 'device: FP4 compute-path checks' }, acts: ['npu'], changes: { zh: 'FP4 路径的静默检出 95 %', en: 'silent detection 95 % on the FP4 path' }, stage: 'sdc' },
  'D-ABFT': { deploy: 'npu', how: { zh: '芯片：算子 ABFT / 矩阵校验', en: 'device: operator ABFT / matrix checks' }, acts: ['npu'], changes: { zh: '上游漏检的 90 % 被补检（联合 99.5 %），0.1 % 吞吐', en: '90 % of the upstream misses caught (joint 99.5 %), 0.1 % throughput' }, stage: 'sdc' },
  'D-NET-SDC': { deploy: 'superpod', how: { zh: '网络：端到端静默检测', en: 'network: end-to-end silent-corruption detection' }, acts: ['superpod', 'scaleout', 'node'], changes: { zh: '网络残余静默的检出 95 %', en: 'residual network silent corruption detected 95 %' }, stage: 'sdc' },
  'H-SDC-SCREEN': { deploy: 'npu', how: { zh: '芯片：在线压测与异常资源筛除', en: 'device: online stress screening and eviction' }, acts: ['npu'], changes: { zh: '筛除子集的静默 FIT × 0.75', en: 'silent FIT of the screened subset × 0.75' }, stage: 'rate' },
  'R-HCCL-ELASTIC': { deploy: 'cluster', how: { zh: '集群：HCCL 通信域弹性重建', en: 'cluster: HCCL communicator elastic rebuild' }, acts: ['npu', 'node'], changes: { zh: '弹性局部恢复的通信重建 60 → 15 s（局部损失，不停作业）', en: 'communication rebuild of a local recovery 60 → 15 s (local loss, no job pause)' }, stage: 'local' },
  'I-CONTAIN': { deploy: 'cluster', how: { zh: '集群：故障隔离与传播抑制', en: 'cluster: fault containment' }, acts: ['npu', 'node'], changes: { zh: 'R-ELASTIC 的使能能力，不单独计收益', en: 'enabling capability of R-ELASTIC, no separate credit' }, stage: 'none' },
};
const VERDICT: Record<string, { verdict: Verdict; reason: L }> = {
  'D-SDC': { verdict: 'reference', reason: { zh: '参考集；对 A_op −0.02 点（检出的静默变成暂停），对有效产出 +37 点', en: 'reference set; −0.02 pt on A_op (detected corruption becomes pauses), +37 pt on delivered goodput' } },
  'R-SDC': { verdict: 'reference', reason: { zh: '参考集；需 D-SDC；A_op +0.07 点', en: 'reference set; needs D-SDC; +0.07 pt on A_op' } },
  'R-REPLAY': { verdict: 'reference', reason: { zh: '参考集；A_op +1.1 点（50 万卡）', en: 'reference set; +1.1 pt on A_op (500k)' } },
  'R-PROCESS': { verdict: 'reference', reason: { zh: '参考集；A_op +1.4 点', en: 'reference set; +1.4 pt on A_op' } },
  'R-ELASTIC': { verdict: 'reference', reason: { zh: '参考集；最大的单项，A_op +2.9–3.1 点', en: 'reference set; the largest single gain, +2.9–3.1 pt on A_op' } },
  'C-FAST': { verdict: 'reference', reason: { zh: '参考集；只影响回滚损失（有效产出 +0.5 点）', en: 'reference set; rollback loss only (+0.5 pt delivered goodput)' } },
  'D-HARD': { verdict: 'candidate', reason: { zh: 'A_op +0.30 点（50 万卡），每层都受益', en: '+0.30 pt on A_op (500k), every layer benefits' } },
  'D-RECOVERY-CLASSIFY': { verdict: 'candidate', reason: { zh: 'A_op +1.1–1.2 点；降额后仍有效（人工概率 ×1.5），而“自动成功率”杠杆降额后无效', en: '+1.1–1.2 pt on A_op; survives derating (manual probability ×1.5) where the automatic-success lever does not' } },
  'R-LINK-LOCAL': { verdict: 'candidate', reason: { zh: 'A_op +0.37–0.53 点；光链路、交换与 NIC 的瞬态事件不再走全局恢复', en: '+0.37–0.53 pt on A_op; transient optics, switch and NIC events skip the global recovery' } },
  'R-RUNTIME-SNAPSHOT': { verdict: 'candidate', reason: { zh: 'A_op +0.42 点；启动阶段三个机制中最短（15 s），同阶段取最小值', en: '+0.42 pt on A_op; the shortest of the three startup-stage mechanisms (15 s), minimum rule on the stage' } },
  'H-CONTROL-CONTINUITY': { verdict: 'candidate', reason: { zh: 'A_op +0.35 点；唯一作用于管理面事件的机制', en: '+0.35 pt on A_op; the only mechanism acting on management-plane events' } },
  'C-LOSSLESS': { verdict: 'candidate', reason: { zh: 'A_op +0.34–0.38 点；缩短每次全局恢复的读取阶段', en: '+0.34–0.38 pt on A_op; shortens the read stage of every global recovery' } },
  'R-FABRIC-DEGRADE': { verdict: 'candidate', reason: { zh: 'A_op +0.19–0.34 点；降级运行的损失只计入有效产出', en: '+0.19–0.34 pt on A_op; the degraded-running loss counts against goodput only' } },
  'R-WARM-PROCESS': { verdict: 'pruned', reason: { zh: '与 R-RUNTIME-SNAPSHOT 同为启动阶段，20 s > 15 s，被支配（同阶段取最小值）；单独 +0.075 点', en: 'same startup stage as R-RUNTIME-SNAPSHOT, 20 s > 15 s: dominated (minimum rule); +0.075 pt alone' } },
  'R-CANN-GRAPH': { verdict: 'pruned', reason: { zh: '启动阶段内的图准备 30 → 7.5 s，启动 60 → 37.5 s，被 15 s 的快照支配；单独 +0.07 点', en: 'graph share of startup 30 → 7.5 s (startup 60 → 37.5 s), dominated by the 15 s snapshot; +0.07 pt alone' } },
  'R-HCCL-ELASTIC': { verdict: 'pruned', reason: { zh: '只缩短弹性局部恢复（作业不停），A_op 0.000、有效产出 +0.01 点', en: 'shortens only the local elastic recovery (no job pause): 0.000 pt A_op, +0.01 pt goodput' } },
  'D-SLOW': { verdict: 'pruned', reason: { zh: 'A_op −0.007 点（更多隔离暂停），有效产出 +0.1 点：两项都在噪声内', en: '−0.007 pt A_op (more isolation pauses), +0.1 pt goodput: both within noise' } },
  'D-SDC-FP8': { verdict: 'goodput', reason: { zh: 'A_op −0.008 点，有效产出 +4.1 点', en: '−0.008 pt A_op, +4.1 pt delivered goodput' } },
  'D-SDC-FP4': { verdict: 'goodput', reason: { zh: 'A_op −0.009 点，有效产出 +4.6 点', en: '−0.009 pt A_op, +4.6 pt delivered goodput' } },
  'D-ABFT': { verdict: 'goodput', reason: { zh: 'A_op −0.014 点，有效产出 +13 点', en: '−0.014 pt A_op, +13 pt delivered goodput' } },
  'D-NET-SDC': { verdict: 'goodput', reason: { zh: 'A_op −0.001 点，有效产出 +0.9–1.3 点', en: '−0.001 pt A_op, +0.9–1.3 pt delivered goodput' } },
  'H-SDC-SCREEN': { verdict: 'goodput', reason: { zh: 'A_op +0.009 点，有效产出 +3.2 点', en: '+0.009 pt A_op, +3.2 pt delivered goodput' } },
  'C-ASYNC': { verdict: 'pruned', reason: { zh: 'A_op 0.000 点，有效产出 +0.1 点（50 万卡）：阻塞少 3 s，每次回滚多 10 s 滞后，低于 0.15 点阈值', en: '0.000 pt A_op, +0.1 pt goodput at 500k: 3 s less blocking against a 10 s lag on every rollback, below the 0.15-pt threshold' } },
  'I-CONTAIN': { verdict: 'capability', reason: { zh: '不可单独应用：R-ELASTIC 的使能能力', en: 'not appliable on its own: the enabling capability of R-ELASTIC' } },
};
const DOMINATED: Record<string, string> = { 'R-WARM-PROCESS': 'R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH': 'R-RUNTIME-SNAPSHOT' };

/* ---------------- Shapley values of the four architectures ---------------- */
type Gain = { aOp: number; halfWidth: number; delivered: number };
const shapley: Record<string, Record<string, Record<string, Gain>>> = {}; // arch → size → id
const studies: Record<string, { baseline: Record<string, number>; allOn: Record<string, number>; allOnDerated: Record<string, number>; plan: Record<string, unknown> }> = {};
for (const a of ARCHS) {
  const j = JSON.parse(readFileSync(`${SHAPLEY_DIR}/${a}.json`, 'utf8'));
  shapley[a] = {}; studies[a] = { baseline: {}, allOn: {}, allOnDerated: {}, plan: {} };
  for (const [n, z] of Object.entries(j.perSize as Record<string, { baseline: number; allOn: number; allOnDerated: number; plan: unknown; gains: { id: string; halfWidth: number; aOp: { shapley: number }; delivered: { shapley: number } }[] }>)) {
    shapley[a][n] = Object.fromEntries(z.gains.map((g) => [g.id, { aOp: g.aOp.shapley, halfWidth: g.halfWidth, delivered: g.delivered.shapley }]));
    studies[a].baseline[n] = z.baseline; studies[a].allOn[n] = z.allOn; studies[a].allOnDerated[n] = z.allOnDerated; studies[a].plan[n] = z.plan;
  }
}
const lib = (id: string) => { const m = MECHANISM_LIBRARY.find((x) => x.id === id); if (!m) throw new Error(`no library entry for ${id}`); return m; };
const catalog = (id: string) => AUDIT_CATALOG.mechanisms.find((x) => x.id === id);

const rows = ALL.map((id) => {
  const m = lib(id), c = catalog(id), map = MAP[id], v = VERDICT[id];
  if (!map || !v) throw new Error(`no mapping / verdict for ${id}`);
  const nominal = { ...m.parameters, ...(REMAP_LATEST_PARAMS[id] ?? {}) };
  const sh = Object.fromEntries(ARCHS.map((a) => [a, Object.fromEntries(['200000', '500000'].map((n) => [n, shapley[a][n]?.[id] ?? null]))]));
  const at500 = ARCHS.map((a) => shapley[a]['500000']?.[id]?.aOp ?? NaN);
  const minAop = Math.min(...at500), maxAop = Math.max(...at500);
  const dl500 = ARCHS.map((a) => shapley[a]['500000']?.[id]?.delivered ?? NaN);
  // the rule: reference set as is; a shared-stage mechanism dominated by a shorter one is pruned; otherwise kept as an A_op candidate
  // when its A_op Shapley reaches the threshold on every architecture, as goodput-only when its delivered Shapley does, else pruned
  const isRef = DEFAULT_PLAYERS.includes(id);
  const appliable = !!m.apply;
  const minDl = Math.min(...dl500);
  const ruleVerdict: Verdict = !appliable ? 'capability' : isRef ? 'reference' : DOMINATED[id] ? 'pruned' : minAop >= THRESHOLD ? 'candidate' : minDl >= THRESHOLD ? 'goodput' : 'pruned';
  if (ruleVerdict !== v.verdict) throw new Error(`verdict rule mismatch for ${id}: rule ${ruleVerdict}, table ${v.verdict} (A_op min ${minAop}, delivered min ${minDl})`);
  return {
    id, name: m.name, kind: m.kind, origin: ORIGINAL.includes(id) ? 'original' : 'extension', remapCategory: c?.category ?? (isRef ? '参考机制' : 'ReMAP 基线扩展'), eventCandidates: c?.eventCandidates ?? null,
    change: m.change, effort: m.effort, requires: m.requires ?? [], appliable,
    deploy: map.deploy, how: map.how, acts: map.acts, changes: map.changes, stage: map.stage,
    nominal, derated: appliable ? derateParameters(nominal, DERATE_DEFAULT) : nominal,
    shapley: sh, aOp500: { min: minAop, max: maxAop }, delivered500: { min: Math.min(...dl500), max: Math.max(...dl500) },
    verdict: v.verdict, reason: v.reason, dominatedBy: DOMINATED[id] ?? null,
  };
});
const out = { generated: new Date().toISOString(), threshold: THRESHOLD, rule: { zh: '参考集原样保留；同一恢复阶段上被更短机制支配的剪除；其余：50 万卡上四种拓扑的 A_op Shapley 均 ≥ 0.15 个百分点 → A_op 候选，有效产出 Shapley 均 ≥ 0.15 点 → 只保有效产出，否则剪除', en: 'reference set kept as is; a mechanism dominated by a shorter one on the same recovery stage is pruned; otherwise A_op Shapley ≥ 0.15 pt at 500k on every architecture → A_op candidate, delivered Shapley ≥ 0.15 pt → goodput-only, else pruned' }, archs: ARCHS, studies, source: { dir: SHAPLEY_DIR, players: 23, permutations: 300, basis: 'bare architecture scenario, HAC-D per-unit FIT, REMAP_LATEST_PARAMS' }, mechanisms: rows, candidates: rows.filter((r) => r.verdict === 'candidate').map((r) => r.id) };
mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.error(`written ${OUT}: ${rows.length} mechanisms; candidates ${out.candidates.join(', ')}; goodput ${rows.filter((r) => r.verdict === 'goodput').map((r) => r.id).join(', ')}; pruned ${rows.filter((r) => r.verdict === 'pruned').map((r) => r.id).join(', ')}`);
