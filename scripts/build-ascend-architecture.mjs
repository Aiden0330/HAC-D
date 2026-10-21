#!/usr/bin/env node
/**
 * Build docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html (2026-10-20 revision, ≤ 4 A4 pages): typical Ascend cluster architectures and
 * topologies, merging the 2026-10-16 page (three generations), the reviewed evidence of docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html
 * (2026-10-19) and what survived checking in the two attachments received on 2026-10-20 (the “昇腾950C … 50万卡” report PDF and its
 * dashboard). Figures (redrawn, scripts/ascend950-figures.mjs): scale-up domain sizes on one log axis; the native Atlas 950 SuperPoD
 * with a cabinet zoom; SuperPoD Flex / UBL128 and the scale-out planes. Counts: docs/ascend-architecture/counts.json
 * (scripts/ascend-architecture-counts.ts) and docs/ascend950-scaling/results.json (scripts/ascend950-scaling.ts).
 * The English page docs/ASCEND_CLUSTER_ARCHITECTURE.en.html is the 2026-10-16 version, built by this script's earlier revision
 * (git 273e6a9); this revision writes the Chinese page only.
 * Usage: node scripts/build-ascend-architecture.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { esc, fmt, figScaleStrip, figNative, figUbl128 } from './ascend950-figures.mjs';

const C = JSON.parse(readFileSync('docs/ascend-architecture/counts.json', 'utf8'));
const R = JSON.parse(readFileSync('docs/ascend950-scaling/results.json', 'utf8'));
const OUT_DIR = 'docs/ascend-architecture';
mkdirSync(OUT_DIR, { recursive: true });
const DATE = '2026-10-20';
const D = C.designs;
const S = (a, n) => R.archs[a].sizes[String(n)];
const pct = (x, d = 2) => `${(x * 100).toFixed(d)} %`;
const kN = (n) => (n >= 1000 ? `${fmt(n / 1000)}k` : fmt(n));

/* ---------------- references ---------------- */
const REFS = [
  ['prod', '昇腾 Atlas 950 SuperPoD 产品页（中 / 英；2026-10-19 读取，10-20 复核）', 'https://www.hiascend.com/hardware/cluster', '华为确认'],
  ['hc25', '华为 HC2025 徐直军主题演讲（2025-09-18）', 'https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech', '华为确认'],
  ['waic', '昇腾950超节点真机亮相 WAIC 2026（2026-07-17）', 'https://www.huawei.com/cn/news/2026/7/atlas-950-superpod', '华为确认'],
  ['lc', 'LightCounting：Atlas 950 SuperPoD all-optical（2026-07-21）', 'https://lightcounting.com/newsletter/en/july-2026-atlas-950-superpod-achieves-all-optical-interconnection-with-superior-cost-and-power-efficiency-450', '分析师'],
  ['ubm', 'UB-Mesh，arXiv 2503.20377（华为作者，2025）', 'https://arxiv.org/abs/2503.20377', '华为论文'],
  ['hot', 'Hot Chips 2025，廖恒 UB-Mesh 报告', 'https://hc2025.hotchips.org/assets/program/conference/day2/67_Huawei_Liao_final.pdf', '华为论文'],
  ['ubwp', '基于灵衢的超节点参考架构白皮书（2025-09）', 'https://www.unifiedbus.com/api-server/web/v1/white-paper/zh/file/UB-SuperPoD-Architecture-White-Paper-zh.pdf/4.0.0', '华为确认'],
  ['wp950', '昇腾 950 NPU 架构白皮书（2026-06）', 'https://public-download.obs.cn-east-2.myhuaweicloud.com/ascend/%E6%98%87%E8%85%BE950%20NPU%E6%9E%B6%E6%9E%84%E7%99%BD%E7%9A%AE%E4%B9%A6.pdf', '华为确认'],
  ['wang', 'HC2026 汪涛主题演讲（2026-09-17）', 'https://www.huawei.com/cn/news/2026/9/hc-wang-keynote', '华为确认'],
  ['peer', 'Peerium 计算架构新闻稿（2026-09-17）', 'https://www.huawei.com/en/news/2026/9/new-computing-architecture-peerium', '华为确认'],
  ['a960', '昇腾960超节点发布（2026-09-17）', 'https://www.huawei.com/cn/news/2026/9/hc-ascend960-supernode', '华为确认'],
  ['lq', '以灵衢互联为核心的新计算架构（LinkDevice，2026-09-17）', 'https://www.huawei.com/cn/news/2026/9/hc-lingqu-agent-ai', '华为确认'],
  ['ubg', '星河 UBG 交换机 radix 1,024（Kyodo PR Wire，2026-09-21）', 'https://kyodonewsprwire.jp/release/202609216351', '华为确认'],
  ['sf', '星河 AI 网络：CloudEngine SF9300（2026-09-19）', 'https://www.huawei.com/cn/news/2026/9/hc-ai-infra-aiwan-campus', '华为确认'],
  ['xu', '徐直军与国际媒体圆桌纪要（2026-09-30）', 'https://www.eqs-news.com/news/corporate/huawei-pioneers-a-new-computing-architecture-for-the-ai-era-making-one-million-processors-work-as-one-computer-summary-of-roundtable-meeting-between-eric-xu-and-international-media-outlets/f50bf9f3-66ae-45a6-b652-530a27b647f8_en', '华为确认'],
  ['ubl', '华为计算官微：DeepSeek 开源昇腾基础组件（经量子位授权转载，2026-09-30）', 'https://www.qbitai.com/2026/09/499263.html', '华为确认'],
  ['dep', 'DeepEP-Ascend README', 'https://github.com/deepseek-ai/DeepEP-Ascend', '客户确认'],
  ['tk', 'TileKernels README（2026-09-30）', 'https://github.com/deepseek-ai/TileKernels', '客户确认'],
  ['verl', 'verl：昇腾 950DT 镜像（字节跳动）', 'https://github.com/volcengine/verl/blob/main/docker/ascend/Dockerfile.ascend_9.1.0_a5', '客户确认'],
  ['aics', '华为云灵衢智算集群 AICS 产品页', 'https://www.huaweicloud.com/product/aics.html', '华为确认'],
  ['tz', '科技日报：首个昇腾 A5 超节点商用局点（2026-10-04）', 'https://www.stdaily.com/web/gdxw/2026-10/04/content_591732.html', '媒体'],
  ['c114', 'C114：中国移动 6,208 卡 AI 超节点集采（2026-03-18）', 'https://m.c114.com.cn/w118-1307117.html', '媒体'],
  ['hrb', '证券日报：实探哈尔滨智算中心（2025-01-24）', 'https://www.stcn.com/article/detail/1508161.html', '媒体'],
  ['hx', '华西证券：华为超节点集群与组网（2025-09-22）', 'https://finance.sina.com.cn/stock/marketresearch/2025-09-22/doc-infrivcm4740054.shtml', '分析师'],
  ['zdx', '智东西：华为超节点“黑科技”详解（2026-09-19）', 'https://news.qq.com/rain/a/20260919A067RE00', '媒体'],
  ['cm', 'Serving LLMs on Huawei CloudMatrix384，arXiv 2506.12708', 'https://arxiv.org/abs/2506.12708', '华为论文'],
  ['tf', 'TrendForce：960DT 提前至 1Q27（2026-09-17）', 'https://www.trendforce.com/news/2026/09/17/news-huawei-speeds-up-ai-chip-roadmap-reportedly-pulls-ascend-960dt-forward-three-quarters-to-1q27/', '媒体'],
  ['a350', '新浪：Atlas 350（950PR）上市（2026-03-23）', 'https://finance.sina.com.cn/tech/roll/2026-03-23/doc-inhrxmcx5535251.shtml', '媒体'],
  ['att', '附件：《昇腾950C（Ascend 950系列）超大规模计算集群拓扑架构、头部客户实践与50万卡硬件工程量全景调研报告》PDF（24 页）及同名交互仪表盘（2026-10-20 收到）', '', '附件'],
  ['sv', 'HAC-D：docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html（2026-10-19，复核后的证据与 307 条参考）', '', 'HAC-D'],
  ['rep', 'HAC-D：docs/ASCEND950_SCALING_RELIABILITY.zh.html（本页配套：规模、可靠性与瓶颈）', '', 'HAC-D'],
];
const RN = Object.fromEntries(REFS.map(([id], i) => [id, i + 1]));
const c = (...ids) => `<sup class="ref">[${ids.map((id) => { if (!RN[id]) throw new Error(`unknown ref ${id}`); return `<a href="#r${RN[id]}">${RN[id]}</a>`; }).join(',')}]</sup>`;
const L = (t) => `<span class="lab lab-${{ '华为确认': 'hw', '华为论文': 'pp', '客户确认': 'cu', '招标': 'td', '媒体': 'md', '分析师': 'an', '未证实': 'un', '相互矛盾': 'cf', '推导': 'dv', '假设': 'as' }[t] ?? 'md'}">${t}</span>`;

/* ---------------- tables ---------------- */
const tbl = (cls, head, rows) => `<div class="table-wrap"><table class="${cls}"><thead><tr>${head.map((h) => `<th${h.startsWith('#') ? ' class="num"' : ''}>${h.replace(/^#/, '')}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x, i) => `<td${head[i]?.startsWith('#') ? ' class="num"' : ''}>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

const n10 = S('native', 10000), n500 = S('native', 500000), u500 = S('ubl128', 500000);
const thrN = R.archs.native.thresholds, thrU = R.archs.ubl128.thresholds;

const table1 = tbl('t1', ['产品', '芯片', 'scale-up 域（NPU）', '机柜 · 每柜', '域内互联', '域间 scale-out', '状态（截至 2026-10-20）'], [
  ['Atlas 800T A2（A2）', '910B', '8 / 服务器（HCCS）', '4U 服务器；哈尔滨每柜 3 台' + c('hrb'), '服务器内 HCCS', '8 × 200GE RoCE 直出', `已交付：移动哈尔滨 2,304 台（18,432 卡，2024-08 投产）${L('媒体')}`],
  ['Atlas 900 A3 SuperPoD / CloudMatrix384', '910C', '384', '12 + 4；32 NPU / 柜' + c('cm'), 'UB 两级：L1 板载、7 子平面 × 16 片 L2', 'RDMA（RoCE）400 Gb/s / NPU', `累计超 1,000 套（HC2026，全行业套数口径）${L('华为确认')}${c('wang')}`],
  ['Atlas 950 SuperPoD（现行规格）', '950DT（96 GB）', '<b>1,024</b>', '16 + 4；64 NPU + 16 CPU / 柜，约 100 kW' + c('prod'), '托盘内全互联 + 柜内背板；柜间一层光 Clos（每 NPU 2 × 800G）', 'UBoE 或 RoCE（芯片 2 × 400G UBoE）' + c('wp950'), `WAIC 2026 展出真机${c('waic')}；“规模商用”与“训练超节点仍在测试”${L('相互矛盾')}${c('wang', 'xu')}`],
  ['Atlas 950 SuperPoD（路线图）', '950DT（144 GB）', '8,192', '128 + 32' + c('hc25'), '同上；8K 示例为 128 台 100T 一层 Clos' + c('hot'), '同上', `2026Q4 路线图，未见建成${L('华为确认')}`],
  ['Atlas 950 SuperCluster', '950DT', '64 × 8,192 = 524,288（推导）', '> 1 万柜', '—', 'UBoE / RoCE；平面、层数未公开', `路线图；25.6 万卡集群“部署中”，超节点规格未披露${c('peer')}`],
  ['SuperPoD Flex / UBL128', '昇腾 950', '128', '未公开', '128 卡 3.2 Tbps 单层交换', '256K 卡两层交换', `华为与 DeepSeek 联合定义（2026-09-30）${L('华为确认')}${c('ubl')}`],
  ['Atlas 850E', '950DT', '≤ 96（商用）；8–1,024（能力）', '风冷，标准机柜', 'UB', 'UBG / UBoE / RoCE', `北京通州首个 950DT 局点，2026-09-29 达到商用条件，卡数未披露${L('媒体')}${c('tz')}`],
  ['Atlas 960E / 昇腾960超节点', '960', '4,096（标称；4,032 为推断）', '56 + 14 × 72（单一媒体）' + c('zdx'), '柜内 LinkBlade + 跨柜 LinkDevice（176 × 1.6 Tb/s）；5,500 个 Hi-ONE NPO 替代 48,000 只 800G 模块' + c('a960', 'lq'), '两层四平面 Clos 至 51.2 万；多轨约 100 万', `规格发布，系统测试中；99.8 % 无口径${L('华为确认')}${c('peer')}`],
]);

const designCols = ['a2', 'cm384', 'a950', 'a950-8k', 'ubl128', 'a960e'];
const dv = (id, f, d = 0) => { const v = f(D[id]); return v === null || v === undefined || Number.isNaN(v) ? '—' : v === 0 ? '0' : fmt(v, Number.isInteger(+v.toFixed(6)) ? 0 : d || 2); };
const table2 = tbl('t2', ['单元（每个 scale-up 域）', ...designCols.map((id) => `#${D[id].label.zh.replace('（', '<br>（')}`)], [
  ['NPU', ...designCols.map((id) => dv(id, (x) => x.domainNpus))],
  ['节点 / 刀片（8 NPU）', ...designCols.map((id) => dv(id, (x) => x.perDomain.nodes))],
  ['CPU', ...designCols.map((id) => dv(id, (x) => x.perDomain.cpus))],
  ['计算柜 + 通信 / 互联柜', ...designCols.map((id) => (id === 'a2' ? '1/8 柜（每柜 8 台，HAC-D 默认）' : `${dv(id, (x) => x.perDomain.racks)} + ${dv(id, (x) => x.perDomain.commRacks)}`))],
  ['UB 交换：L1 + L2 ／ 柜内 + 超节点层', ...designCols.map((id) => { const p = D[id].perDomain; return id === 'a2' ? '—' : id === 'cm384' ? `${fmt(p.l1)} + ${fmt(p.l2)}` : `${fmt(p.rackSwitches)} + ${fmt(p.podSwitches)}`; })],
  ['柜内电链路（计数项）', ...designCols.map((id) => dv(id, (x) => x.perDomain.meshLinks))],
  ['UB 光链路（800G 等效）', ...designCols.map((id) => dv(id, (x) => x.perDomain.opticalLinks))],
  ['光模块 ／ NPO 光引擎', ...designCols.map((id) => { const p = D[id].perDomain; return id === 'a2' ? '—' : id === 'a960e' ? `0 / ${fmt(p.opticalEngines)}` : fmt(p.transceivers); })],
  ['每 NPU：UB 交换 · 光链路', ...designCols.map((id) => { const p = D[id].perDomain, n = D[id].domainNpus; return id === 'a2' ? '—' : `${fmt(p.ubSwitches / n, 3)} · ${fmt(p.opticalLinks / n, 2)}`; })],
  ['1 万卡时硬中断 FIT / NPU（其中 UB）', ...designCols.map((id) => `${fmt(D[id].at10k.hardFitPerNpu)}（${fmt(D[id].at10k.ubFitPerNpu, 1)}）`)],
]);

const table5 = tbl('t5', ['芯片 / 系统', 'HC2025 路线图', 'HC2026 更新', '证据'], [
  ['昇腾 950PR', '2026Q1；1 / 2 PFLOPS FP8 / FP4；HiBL 1.0 HBM；Prefill 与推荐', `随 Atlas 350 于 2026-03-20 上市${c('a350')}；圆桌称量不大`, `${L('华为确认')}${c('hc25', 'xu')}`],
  ['昇腾 950DT', '2026Q4；HiZQ 2.0 HBM 144 GB、4 TB/s；互联 2 TB/s', '仍在测试，2026 年底或 2027 年初批量供货', `${L('华为确认')}${c('hc25', 'xu')}`],
  ['昇腾 960DT / 960PR', '2027Q4（未分 DT / PR）', '960DT 2027Q1 就绪，960PR 2027Q3；附件称“大部分产能优先供应 DeepSeek”只见媒体', `${L('华为确认')}${c('wang', 'tf')}`],
  ['昇腾 970 / 980', '970：2028Q4', '970：2028 年；980：2029 年（新增）', `${L('华为确认')}${c('wang')}`],
  ['Atlas 960 超节点', '15,488 卡、176 + 44 柜（2027Q4）', '单超节点改为 4,096 卡（960E）；集群两层四平面 ≤ 51.2 万', `${L('华为确认')}${c('hc25', 'a960')}`],
]);

const table6 = tbl('t6', ['部署方', '已知事实（规模口径）', '状态', '证据'], [
  ['华为（全行业）', 'Atlas 900 A3 超节点累计超 1,000 套（套数口径，不可换算卡数）；25.6 万卡 Atlas 950 集群“部署中”，客户与超节点规格未披露', '在用 / 部署中', `${L('华为确认')}${c('wang', 'peer')}`],
  ['华为云 AICS', '64 卡与 1,024 卡两种 950DT 超节点规格；宣布 2026-09-30 国内商用，10-19 产品页仍为申请公测', '部署中', `${L('华为确认')}${c('aics')}`],
  ['DeepSeek', 'DeepEP-Ascend（950DT、预发布 PoC HDK）、TileKernels 昇腾后端、UBL128 联合定义；乌兰察布计划 ≥ 16 万颗 950DT（媒体）；训练用量有相互矛盾的报道', '软件在用；硬件为样机 / 计划', `${L('客户确认')}${L('媒体')}${c('dep', 'tk', 'ubl')}`],
  ['字节跳动', 'verl 发布 950DT 镜像（SOC_VERSION=ascend950dt_9582）；2026 年采购金额 > 400 亿元为媒体报道；软件就绪 ≠ 持有硬件', '框架就绪', `${L('客户确认')}${L('媒体')}${c('verl')}`],
  ['阿里巴巴 / 腾讯', '只有与字节合计“数十万颗”的订单报道，无拆分；Qwen3 设 MindIE 章节', '报道', `${L('媒体')}`],
  ['中国移动', '2026–2027 超节点集采 6,208 卡 / 776 节点，限定 CANN（招标阶段）；哈尔滨 1.8 万卡为 Atlas 800T A2（2024-08 投产）', '招标 / 在用', `${L('媒体')}${c('c114', 'hrb')}`],
  ['北京通州', 'Atlas 850E（950DT）首个商用局点，2026-09-29 达到商用条件；卡数未披露', '部署中', `${L('媒体')}${c('tz')}`],
  ['科大讯飞 / 美团', 'FlashRecovery 论文：> 1 万张昇腾 NPU 集群；美团五万卡国产集群未点名芯片', '在用', `${L('华为论文')}${L('客户确认')}`],
]);

const table7 = tbl('t7', ['公开的可靠性数字', '口径（事件 / 分母 / 层级）', '证据'], [
  ['UB-Mesh 表 6：8K 网络 88.9 次 / 年 → MTBF 98.5 h；无收敛 Clos 基线 632.8 次 / 年 → 13.8 h；MTTR 75 min 时 98.8 % 对 91.6 %', '网络部件（电缆、光、LRS、HRS）故障；整个 8K 集群·年；设计估算，不含 NPU 与主机', `${L('华为论文')}${c('ubm')}`],
  ['512 卡超节点光链路闪断 3.9 次 / 天', '缓解前的闪断；每超节点·天（512P 未定义）；观察窗未给，不计入中断', `${L('华为论文')}${c('hot')}`],
  ['8,192 卡超节点光互连 MTBF > 6,000 h', '保护后整个超节点的光互连；事件定义与测量基准未说明，与 98.5 h 不可比', `${L('华为确认')}${c('ubwp')}`],
  ['Atlas 960E 系统可用度 99.8 %', '无事件类、时间窗与分母；系统仍在测试', `${L('华为确认')}${c('a960')}`],
  ['SF9300：LLR 使集群每年服务中断减少 100 h', '无集群规模与基线', `${L('华为确认')}${c('sf')}`],
  [`<b>HAC-D 模型（配套报告）</b>：六个默认机制下 A_op ${pct(n10.kpi.aOp)}（1 万）→ ${pct(n500.kpi.aOp)}（50 万，原生）/ ${pct(u500.kpi.aOp)}（UBL128）；MTBF_hw ${fmt(n10.kpi.mtbfHwH, 1)} h → ${fmt(n500.kpi.mtbfHwH * 60)} min；MTTR_hw ≈ ${fmt(n500.kpi.mttrS)} s`, '作业硬中断；集群·小时；作业级。故障率为 54 类事件目录（GPU 机群类比）按单元换算，不是 950 实测', `${L('推导')}${c('rep')}`],
]);

const review = [
  ['“950C”是招标与资本市场对昇腾 950 系列的统称（如东方智媒城二期）', '华为不用此名；只作命名说明', L('媒体')],
  ['950PR / 950DT：HiBL 1.0 128 GB 1.6 TB/s 与 HiZQ 2.0 144 GB 4 TB/s；1 / 2 PFLOPS FP8 / FP4；72 lane、2 TB/s 互联', `与 HC2025 演讲、950 白皮书一致；950PR 随 Atlas 350 于 2026-03-20 上市（采用，表 1、表 3）`, L('华为确认')],
  ['计算柜 44OU、2,250 × 600 × 1,400 mm、1,700 kg、约 100 kW；58.8 / 114.1 / 31.1 PFLOPS（mxFP8 / mxFP4 / FP16）；16 × 950 CPU（96 核 2.3 GHz）、192 个 DDR5-6400 插槽；380 V AC 与 336 / 240 V 直流双路', '产品页逐项确认（采用，2.1）；内存条上限中文页 96 GB、英文页 64 GB，两页不一', L('华为确认')],
  ['“浸没 / 冷板液冷”', '产品页只写液冷（英文页写液冷 + 风冷），未见浸没', L('未证实')],
  ['8,192 卡“超过 1 PB 统一内存、16.3 PB/s、扩展线性度 > 90 %”', '8,192 卡为路线图；1 PB+ 与 16.3 PB/s 为路线图口径；线性度只见媒体', L('媒体')],
  ['Atlas 950 SuperCluster 为“二层 Clos 四平面、51.2–52.4 万卡”', '两层四平面是 HC2026 对昇腾 960 超节点集群的陈述，950 未公开（第 3 节）', L('相互矛盾')],
  ['50 万卡 BOM：叶 16,000 台（64 口）+ 脊 4,000 台（128 口）、两层、800G 光模块 204.8 万', `端口数对得上，但不成两层 Clos（每平面 12.8 万端点时 radix 64 / 128 两层只接 8,192）；按 Clos 须三层，交换机仍为 ${fmt(R.crossCheck512k['512000']['so:attach'].switches)} 台、光模块 ${fmt(R.crossCheck512k['512000']['so:attach'].transceivers / 1e6, 2)} M`, L('推导')],
  ['超节点内光模块 102.4 万（原生，51.2 万卡）', `LightCounting 为每 NPU 4 只（含两端）→ ${fmt(R.crossCheck512k['512000'].native.transceivers / 1e6, 3)} M`, L('分析师')],
  ['DeepSeek SuperPoD Flex / UBL128：128 卡 3.2 Tbps 单层交换 + 256K 卡两层 scale-out', '华为计算官微原文确认；机柜、交换机数未公开（采用，第 4 节与配套报告）', L('华为确认')],
  ['DeepEP 在 UBL128 上 dispatch 375 / combine 347 GB/s，“单跳 EP 收敛”', 'README：EP8 上限，netlayer 1，预发布 PoC HDK；README 未提 UBL128', L('未证实')],
  ['DeepSeek-V4.1-Flash EP32 离线 2,469 / 5,102 tokens/s/卡（TPOT 5 / 10 ms）', '华为自测：128K 上下文、Dspark 接受率 0.85、不含服务调度', L('华为确认')],
  ['2026-09-30 开源 TileLang、DeepGEMM、FlashMLA、TileKernel、DeepSelect、DeepEP 的昇腾版', '华为稿与 TileKernels README 一致（采用，第 6 节）', L('客户确认')],
  ['字节跳动 PD 分离：12.8 万 950PR + 38.4 万 950DT、2:1 收敛', '附件自己的设想方案；字节跳动未公开；MegaScale（12,288 卡 55.2 % MFU）是 GPU 论文', L('未证实')],
  ['阿里 HPN 7.0 / 8.0、腾讯星脉、移动 GSE / GSE-DCI 作为“950 客户拓扑”', '各家 GPU / 以太网架构的公开资料，未见其用于昇腾 950 的证据；不采用', L('未证实')],
  ['中国移动哈尔滨 1.8 万卡“2025-12 投产”', '投产为 2024-08，且为 Atlas 800T A2（910B 代）', L('相互矛盾')],
  ['昇腾 960（4,096–15,488 卡超节点）、970（2028）、980（2029）；Agentic 集群含 TaiShan 950 与 OceanStor M900', '与 HC2025 / HC2026 一致；TaiShan 950 的 4,096 是节点数，不是 NPU', L('华为确认')],
  ['50 万卡 IT 功耗 850–950 MW、占地约 6.4 万 m²', `附件估算；只计计算柜时 7,813–8,000 柜 × 100 kW = 781–800 MW`, L('推导')],
];
const table8 = tbl('t8', ['附件的说法', '核对结果与本页处理', '标签'], review.map((r) => [esc(r[0]), r[1], r[2]]));

/* ---------------- page ---------------- */
const f1 = figScaleStrip('zh', 'fig-strip', 1);
const f2 = figNative('zh', R, 'fig-native', 2);
const f3 = figUbl128('zh', R, 'fig-ubl128', 3);
writeFileSync(`${OUT_DIR}/fig-scale-strip.zh.svg`, f1);
writeFileSync(`${OUT_DIR}/fig-atlas950-superpod.zh.svg`, f2);
writeFileSync(`${OUT_DIR}/fig-ubl128-scaleout.zh.svg`, f3);

const mN = R.archs.native.mapping.items;
const keyPoints = [
  `<b>Atlas 950 有两种规模，不能混用</b>：产品页现行规格为 16 计算柜 + 4 灵衢互联柜、最多 1,024 颗 950DT（WAIC 2026 展出真机）；8,192 卡、128 + 32 柜是 HC2025 路线图，截至 2026-10-19 没有建成或交付的公开证据${c('prod', 'waic', 'hc25')}。两种规模每 NPU 的器件数相同，HAC-D 的可靠性数字也相同，只有超节点数与超节点级共因的波及范围不同。`,
  `<b>柜间是一层光交换 Clos</b>：每 NPU 2 × 800G LPO 上联 4 个灵衢互联柜中的交换机（约 16 台，推算），LightCounting 数到每计算柜 128 只、全系统约 4,096 只（含两端）${c('lc', 'hot')}。“UB-Mesh 递归直连”应理解为拓扑家族与逻辑全可达；柜内第二维是直连 Mesh + LRS 还是背板 Clos 仍未定${c('ubm')}。`,
  `<b>超节点之间的 scale-out 未公开</b>：华为只说 Atlas 950 SuperCluster 支持 UBoE 与 RoCE${c('hc25')}；“两层 Clos、四平面、51.2 万卡”是 HC2026 对昇腾 960 超节点集群的陈述${c('a960')}，附件把它记到 950 名下。按 Clos 自洽：每平面 12.8 万端点时两层需要 radix ≥ 512，星河 UBG 的 radix 1,024 两层每平面可到 524,288${c('ubg')}。`,
  `<b>新增：SuperPoD Flex / UBL128</b>：华为计算官微（2026-09-30）称与 DeepSeek 联合定义 128 卡 3.2 Tbps 单层交换的超节点与 256K 卡两层交换 scale-out${c('ubl')}；机柜与交换机数未公开。附件引用的 375 / 347 GB/s 是 DeepEP-Ascend 在预发布 PoC HDK、netlayer 1 上的 EP8 上限，README 未提 UBL128${c('dep')}。`,
  `<b>部署证据</b>：没有任何互联网公司公布过精确的昇腾卡数；最强的一手证据是客户代码（DeepEP-Ascend、TileKernels、verl 950DT 镜像）。中国移动 6,208 卡集采只到招标阶段，华为云 AICS 950 服务仍为公测，首个 950DT 商用局点（通州）是风冷 Atlas 850E${c('dep', 'verl', 'c114', 'aics', 'tz')}。`,
  `<b>可靠性</b>：公开数字口径各不相同，均不能当作作业中断率（第 7 节）。HAC-D 在六个默认机制下给出：A_op ${pct(n10.kpi.aOp)}（1 万卡）→ ${pct(n500.kpi.aOp)}（50 万卡），跌破 98.5 % 约在 ${kN(thrN.aOp985)}（原生）/ ${kN(thrU.aOp985)}（UBL128）卡；停机的约 ${fmt((Object.values(n500.breakdown.domains).filter((v) => v.pGlobal > 0.999).reduce((a, v) => a + v.lp, 0) / n500.kpi.sumLP) * 100)} % 来自没有快速恢复梯级的类别${c('rep')}。`,
];

const css = `
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --warn:#a8691b; --warn-soft:#f6ead6;
    --l-hw:#1f6f4a; --l-hw-b:#e3f3ea; --l-pp:#2f4fb8; --l-pp-b:#e7ecfa; --l-cu:#6b3fa0; --l-cu-b:#efe7f8; --l-md:#6b6a64; --l-md-b:#efede7; --l-an:#8a5a12; --l-an-b:#f6ead6; --l-un:#a33a1a; --l-un-b:#fbe6df; --l-cf:#a3164a; --l-cf-b:#fbe3ec; --l-dv:#255a8a; --l-dv-b:#e3eef8; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --warn:#e0a85a; --warn-soft:#3a2e1d;
    --l-hw:#7fd3a6; --l-hw-b:#1d3327; --l-pp:#9cb0ef; --l-pp-b:#232a40; --l-cu:#c6a6ef; --l-cu-b:#2e2440; --l-md:#b9b5aa; --l-md-b:#2c2c28; --l-an:#e0b46a; --l-an-b:#3a2e1d; --l-un:#f09a7c; --l-un-b:#3d2219; --l-cf:#f08cb0; --l-cf-b:#3d1a28; --l-dv:#8cc0ef; --l-dv-b:#1d2c3d; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --warn:#e0a85a; --warn-soft:#3a2e1d;
    --l-hw:#7fd3a6; --l-hw-b:#1d3327; --l-pp:#9cb0ef; --l-pp-b:#232a40; --l-cu:#c6a6ef; --l-cu-b:#2e2440; --l-md:#b9b5aa; --l-md-b:#2c2c28; --l-an:#e0b46a; --l-an-b:#3a2e1d; --l-un:#f09a7c; --l-un-b:#3d2219; --l-cf:#f08cb0; --l-cf-b:#3d1a28; --l-dv:#8cc0ef; --l-dv-b:#1d2c3d; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
  main { max-width: 1120px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 22px 26px 26px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 22px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 16px; font-weight: 600; margin: 12px 0 5px; padding-top: 7px; border-top: 1px solid var(--rule); }
  h2.first { border-top: none; padding-top: 0; margin-top: 4px; }
  p { margin: 5px 0; } .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 6px; }
  a { color: var(--accent); } sup.ref { font-size: 0.72em; line-height: 0; } sup.ref a { text-decoration: none; }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; }
  p, h1, h2, .callout, li { overflow-wrap: anywhere; } td, th { overflow-wrap: break-word; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 9px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.5px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.2px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.t1 td:first-child, table.t6 td:first-child { min-width: 9em; font-weight: 600; } table.t2 td:first-child { min-width: 13em; } table.t8 td:first-child { min-width: 16em; } table.t8 td:nth-child(2) { min-width: 16em; } table.t7 td:first-child { min-width: 18em; }
  .lab { display: inline-block; font-size: 10px; line-height: 1.35; padding: 0 4px; margin: 0 2px; border-radius: 3px; white-space: nowrap; font-weight: 600; vertical-align: 1px; }
  .lab-hw { color: var(--l-hw); background: var(--l-hw-b); } .lab-pp { color: var(--l-pp); background: var(--l-pp-b); } .lab-cu { color: var(--l-cu); background: var(--l-cu-b); } .lab-md { color: var(--l-md); background: var(--l-md-b); }
  .lab-an { color: var(--l-an); background: var(--l-an-b); } .lab-un { color: var(--l-un); background: var(--l-un-b); } .lab-cf { color: var(--l-cf); background: var(--l-cf-b); } .lab-dv, .lab-as { color: var(--l-dv); background: var(--l-dv-b); }
  figure.chart { margin: 8px 0 10px; } .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; } figure.chart svg { display: block; width: 100%; height: auto; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  .callout ul { margin: 2px 0; padding-left: 16px; } .callout li { margin: 3px 0; }
  .spec { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 18px; margin: 4px 0 6px; padding: 0; list-style: none; font-size: 12.2px; }
  .spec li { padding-left: 10px; text-indent: -10px; } .spec li::before { content: "· "; color: var(--muted); }
  .note { font-size: 11.3px; color: var(--muted); }
  ol.refs { columns: 2; column-gap: 22px; font-size: 10.6px; color: var(--muted); padding-left: 22px; margin: 4px 0; } ol.refs li { break-inside: avoid; margin: 1px 0; overflow-wrap: anywhere; }
  footer { font-size: 11.3px; color: var(--muted); margin-top: 8px; }
  @media screen and (max-width: 760px) { .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 720px; } .scroll svg { min-width: 760px; } .spec { grid-template-columns: 1fr; } ol.refs { columns: 1; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.2px; line-height: 1.32; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 6.9px; line-height: 1.22; } th, td { padding: 0.8px 2.4px; } th { font-size: inherit; } .lab { font-size: 6.2px; padding: 0 2px; }
    code { font-size: 6.9px; } .callout, .sub, footer, .note { font-size: 7.3px; } .callout { margin: 3px 0; padding: 3px 7px; } .callout li { margin: 1px 0; line-height: 1.28; }
    h1 { font-size: 13.5px; margin: 2px 0 3px; } h2 { font-size: 10px; margin: 4px 0 2px; padding-top: 3px; } .eyebrow { font-size: 7.3px; }
    figure.chart { margin: 2px 0 3px; } p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; } .spec { font-size: 7.4px; gap: 0 12px; margin: 2px 0 3px; }
    ol.refs { font-size: 6.2px; column-gap: 12px; } footer { font-size: 6.8px; }
  }
`;

const sections = [
  `<div class="eyebrow">EYEBROW1</div>
  <h1>昇腾 AI 集群架构与拓扑（2026-10-20 修订）：从 CloudMatrix384 到 Atlas 950 超节点、SuperPoD Flex / UBL128 与超节点集群</h1>
  <p class="sub">本页合并三部分：10-16 版的三代拓扑；10-19《昇腾下一代集群综述》中复核后的证据${c('sv')}；10-20 收到的两份附件（“昇腾950C … 50万卡硬件工程量”调研报告 PDF 与同名仪表盘）中经核对可用的信息${c('att')}（逐条判定见第 8 节）。证据标签：${L('华为确认')}${L('华为论文')}${L('客户确认')}${L('媒体')}${L('分析师')}${L('未证实')}${L('相互矛盾')}${L('推导')}；推算附算式；计数来自 HAC-D v4.3 引擎（a950-ub2 等模板）。图为按资料重绘的示意图。1 万–50 万卡的机柜与器件数、六个默认机制下的可用度 / MTBF / MTTR、架构映射与瓶颈见配套报告${c('rep')}。</p>
  <figure class="chart"><div class="scroll">${f1}</div></figure>
  <div class="callout"><ul>${keyPoints.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h2 class="first">1. 典型产品与代际（表 1）</h2>
  ${table1}`,
  `<div class="eyebrow">EYEBROW2</div>
  <h2 class="first">2. Atlas 950 超节点（现行规格 1,024 卡）</h2>
  <figure class="chart"><div class="scroll">${f2}</div></figure>
  <p><b>2.1 规格（产品页中英文，2026-10-20 复核）</b>${c('prod')}：</p>
  <ul class="spec">
    <li>16 计算柜 + 4 灵衢互联柜，均为 44OU、2,250 × 600 × 1,400 mm；计算柜 1,700 kg、约 100 kW</li>
    <li>每柜 64 × 950DT（96 GB、4.0 TB/s）+ 16 × 950 CPU（最高 96 核、2.3 GHz）、192 个 DDR5-6400 插槽</li>
    <li>每柜 58.8 PFLOPS mxFP8 / HiF8、114.1 PFLOPS mxFP4、31.1 PFLOPS FP16；整套 1 EFLOPS FP8（英文页 0.9）、2 EFLOPS mxFP4</li>
    <li>UB 每 NPU 1.68 TB/s（双向）、整套 1.72 PB/s；256 TB 全局统一编址；跨柜 RTT 3 µs${c('waic')}</li>
    <li>供电：380 V AC 与 336 V / 240 V 直流的两路组合；液冷（中文页：计算柜与互联柜均液冷；英文页写液冷 + 风冷）</li>
    <li>可靠性：闪断自恢复、传输层重传、降 lane 不断链、跨柜全光 2+2 光路保护；支持 64 或 1,024 卡配置，页面不含 8,192</li>
  </ul>
  <p><b>2.2 互联</b>：每柜 8 个 NPU 托盘（每托盘 8 卡，托盘内电链路全互联）+ 8 个 CPU 托盘，前插托盘与后插板正交互连${c('lc')}；芯片 18 个 x4 端口中 15 个合 1.68 TB/s（推算），可能的分配是 7 + 4 + 4 或 7 + 8${c('wp950')}。柜内第二维：UB-Mesh 参考设计为直连 2D 全互联 + 每柜 72 片 LRS（HAC-D 采用）${c('ubm')}，LightCounting 读作背板 Clos。柜间：每 NPU 2 × 800G LPO（2+2 保护）进入 4 个灵衢互联柜里的一层交换，交换机型号与台数未公开；按 Hot Chips 8K 示例（128 台 100T）缩放得 16 台${c('hot')}。冗余：64 + 1 备份 NPU 与 N + 1 备用柜只见于论文和讲稿，产品资料均按每柜 64 卡；单只光模块故障在 2+2 与降 lane 下属降级或亚健康，路由不可收敛时才隔离 NPU${c('ubwp')}。</p>
  <p class="note">表 2：每个 scale-up 域的器件数（HAC-D v4.3；A2 列为一台服务器；UBL128 为 4 个超节点共用 1 个交换柜后的人均值；960E 为 NPO 光引擎、无可插拔光模块；末行 FIT 为各模板在 1 万卡下的业务影响中断率，括号内为 UB 交换与光链路部分，单元 FIT 沿用 CloudMatrix384 换算，属假设）。</p>
  ${table2}`,
  `<div class="eyebrow">EYEBROW3</div>
  <h2 class="first">3. 超节点之间：SuperCluster 与 scale-out</h2>
  <figure class="chart"><div class="scroll">${f3}</div></figure>
  <p>HC2025 的 Atlas 950 SuperCluster 为 64 个 8,192 卡超节点、52 万多卡（64 × 8,192 = 524,288，推导）、1 万多个机柜，支持 UBoE 与 RoCE，华为称 UBoE 时延更低、可靠性更高、交换机与光模块更少，但没有数值${c('hc25')}。芯片侧每 NPU 2 × 400G UBoE，可拆为 4 × 200G，与 UB 共用 SerDes${c('wp950')}。平面数、层数、交换机 radix 与收敛比对 950 都未公开；券商估 UBoE 约 3.9 万台交换机、222 万只光模块，RoCE 约 4.5 万台、300 万只，追溯不到华为原文${L('分析师')}${c('hx')}。HC2026 首次给出“两层 Clos、四平面、51.2 万卡（多轨约 100 万）”，对象是昇腾 960 超节点集群${c('a960')}；同期星河 UBG 交换机 radix 最高 1,024，SF9300 面向昇腾 A5 / A6、两层多平面去掉核心层${c('ubg', 'sf')}。两层非阻塞 Clos 每平面最多 radix² ÷ 2 个端点：radix 1,024 时 524,288，radix 128 时只有 8,192。因此附件的“两层四平面 + 64 / 128 口交换机”在 51.2 万卡下不成 Clos；配套报告取 4 平面 × 两层、radix 1,024 为主算例，三层 radix 128 与附件方案作敏感性。25.6 万卡 Atlas 950 集群“部署中”，客户、地点、协议与超节点规格均未披露（256,000 ÷ 1,024 = 250 可整除，÷ 8,192 = 31.25 不能）${c('peer', 'xu')}。</p>
  <h2>4. SuperPoD Flex / UBL128 与 DeepSeek</h2>
  <p>华为计算官微（2026-09-30，经量子位授权转载）：华为向 DeepSeek 提供联合定义的昇腾超节点 SuperPoD Flex 与 UBL128 组网方案，实现 128 卡 3.2 Tbps 单层交换 scale-up 与 256K 卡两层交换 scale-out；在全互联的 UBL128 超节点上提供 ASC-COMM 通信编程库；DeepSeek 同日开源 TileLang 编译工具及 DeepGEMM、FlashMLA、TileKernel、DeepSelect、DeepEP 的昇腾版；华为自测 DeepSeek-V4.1-Flash 在 EP32、离线、128K 上下文下 TPOT 5 / 10 ms 时每卡 2,469 / 5,102 tokens/s${L('华为确认')}${c('ubl')}。未公开：机柜形态（950 液冷柜还是 850E 风冷）、交换机型号与台数、链路介质。DeepEP-Ascend README 的 dispatch 373–375 / combine 345–347 GB/s 是 EP8 每 rank 上限，EP128 降到 313–320 / 272–278，测于 netlayer 1、预发布 PoC HDK，README 没有 UBL128 一词${L('客户确认')}${c('dep')}；EP 规模止于 128 与 128 卡单层域吻合，这一对应是推断。配套报告把 UBL128 建成 2 个 64 卡计算柜 + 4 台 128 × 800G 交换机（每 NPU 4 × 800G）、无柜内 LRS、4 个超节点共用 1 个交换柜（附件估算），全部标为假设${L('假设')}。</p>
  <h2>5. Atlas 960E 与路线图（表 3）</h2>
  <p>960E（昇腾960超节点）：最多 4,096 卡，5,500 个 7.2 Tb/s Hi-ONE NPO 光引擎替代约 48,000 只 800G 模块，柜内 LinkBlade、跨柜 LinkDevice（176 × 1.6 Tb/s，华为未明说用于 960E），系统可用度 99.8 % 无口径，基于 NPO 的 960 系统仍在测试${c('a960', 'lq', 'peer')}；56 + 14 柜、每柜 72 卡只来自智东西（56 × 72 = 4,032 ≠ 4,096）${L('媒体')}${c('zdx')}。Agentic 超节点集群由 TaiShan 950、Atlas 960、OceanStor M900 与星河 UBG 组成，TaiShan 950 的 4,096 是节点数${c('lq')}。</p>
  ${table5}`,
  `<div class="eyebrow">EYEBROW4</div>
  <h2 class="first">6. 部署（表 4）</h2>
  ${table6}
  <h2>7. 可靠性数字的口径（表 5）</h2>
  ${table7}
  <h2>8. 附件核对（表 6）</h2>
  ${table8}
  <h2>9. 来源</h2>
  <ol class="refs">${REFS.map(([, t, u, lab], i) => `<li id="r${i + 1}">${esc(t)}${u ? ` — <a href="${esc(u)}">${esc(u.replace(/^https?:\/\//, '').slice(0, 70))}${u.replace(/^https?:\/\//, '').length > 70 ? '…' : ''}</a>` : ''} · ${esc(lab)}</li>`).join('')}</ol>
  <footer>复现：<code>node --import tsx scripts/ascend950-scaling.ts</code> → <code>node --import tsx scripts/ascend-architecture-counts.ts</code> → <code>node scripts/build-ascend-architecture.mjs</code>；独立 SVG 在 <code>docs/ascend-architecture/fig-*.zh.svg</code>，图的画法见 <code>scripts/ascend950-figures.mjs</code>。10-16 版的 CloudMatrix384 UB 互联图与目录映射图见该版（英文页 <code>ASCEND_CLUSTER_ARCHITECTURE.en.html</code> 仍为 10-16 版）。</footer>`,
];
const nPages = sections.length;
const eyebrow = (i) => esc(`HAC-D · 昇腾集群架构 · ${DATE} · 第 ${i} / ${nPages} 页`);
const body = sections.map((s, i) => `<section class="page" id="p${i + 1}">\n  ${s.replace(`EYEBROW${i + 1}`, eyebrow(i + 1))}\n</section>`).join('\n');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>昇腾集群架构</title>
<meta name="description" content="昇腾 AI 集群的典型架构与拓扑（2026-10-20 修订）：A2、CloudMatrix384、Atlas 950 超节点（1,024 现行规格 / 8,192 路线图）、SuperPoD Flex / UBL128、Atlas 850E 与 960E，超节点之间的 scale-out，部署证据与可靠性数字的口径，以及对两份附件的逐条核对（HAC-D）。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
writeFileSync('docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html', html);
console.log(`written docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html (${(html.length / 1024).toFixed(0)} kB)`);
