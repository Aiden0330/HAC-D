#!/usr/bin/env node
/**
 * Build the one-page method summary of reliability allocation (fundamentals, one figure, formulas, algorithms) and the one-page
 * list of future improvements of the allocation method, in Chinese and English:
 *   docs/ALLOCATION_METHODS_SUMMARY.zh.html, docs/ALLOCATION_METHODS_SUMMARY.en.html (two printed A4 pages each)
 *   docs/allocation-methods/fig-allocation-loop.{zh,en}.svg (the figure on its own)
 * Numbers quoted on the pages come from docs/agree-allocation-98p5/results.json (scripts/agree-allocation-98p5.ts).
 * Usage: node scripts/build-allocation-methods-summary.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const IN = JSON.parse(readFileSync('docs/agree-allocation-98p5/results.json', 'utf8'));
mkdirSync('docs/allocation-methods', { recursive: true });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kfmt = (N) => (N >= 1e6 ? `${(N / 1e6).toFixed(N % 1e6 ? 1 : 0)}M` : `${Math.round(N / 1e3)}k`);
const kf = (k) => (k >= 10 ? k.toFixed(0) : k >= 2 ? k.toFixed(1) : k.toFixed(2));
const pct = (x, d = 2) => (x * 100).toFixed(d);
const date = IN.generated.slice(0, 10);
// numbers quoted in the text
const C1 = IN.common[100000], C5 = IN.common[500000];
const ceil = (k) => { const c = IN.sets[k].curves; return Object.keys(c).filter((x) => !x.endsWith('Derated') && x !== 'baseline').map((x) => c[x]).sort((a, b) => b.maxN - a.maxN)[0].maxN; };
const L5 = IN.sets.latest.perSize[500000];
const hwTasks5 = L5.classes.filter((r) => r.overRealloc).sort((a, b) => b.realloc.k - a.realloc.k);
const uni5 = 1 / L5.uniformResidual;
const phys = (id) => C1.hardwareOnly.agreePhysical.rows.find((r) => r.id === id).k;
const eq = (id) => C1.hardwareOnly.agreeEqual.rows.find((r) => r.id === id).k;
const NUM = { baselineMax: kfmt(IN.sets.remap.curves.baseline.maxN), remapMax: kfmt(ceil('remap')), combinedMax: kfmt(ceil('combined')), latestMax: kfmt(ceil('latest')), hw5: hwTasks5.map((r) => `${r.id.replace(/-hard$/, '')} ×${kf(r.realloc.k)}`).join(' / '), hw5n: hwTasks5.length, uni5: uni5.toFixed(2), physPower: kf(phys('POWER-hard')), physStorage: kf(phys('STORAGE-hard')), eqCore: kf(eq('CORE-hard')), eqUnknown: kf(eq('UNKNOWN-hard')), over1: C1.hardwareOnly.agreeEqual.overCount, perClass: pct(C1.budget.perClassEqual, 3), a2: pct(IN.sets.latest.perSize[200000].planned.aOp), e2: IN.sets.latest.perSize[200000].agree.effort, p2: pct(IN.sets.latest.perSize[200000].verification.pAtLeastTarget, 1), racks: Math.round(C1.counts.gpus / C1.counts.racks), trials: IN.trials };

const T = {
  zh: {
    lang: 'zh-CN', title: '可靠性分配方法：原理、公式与算法', tab: '可靠性分配方法速览', eyebrow1: `HAC-D · 分配方法速览 · ${date} · 第 1 / 3 页`, eyebrow2: `HAC-D · 分配方法改进方向 · ${date} · 第 2 / 3 页`,
    desc: '一页说明可靠性分配的原理、经典方法公式（等分、ARINC、AGREE、可改进性加权、Albert 最小努力、成本最优、不可用度分解、goodput 预算、阶段预算）与 HAC-D 的算法（AGREE 可用率分配与再分配、机制组合选择、自底向上校核），一页列出分配方法的改进方向（硬件约束、新机制组合、优化等），一页说明集群架构（规模、节点形态、网络、Pod / 分区、供电冷却、存储、控制面、备件）如何改变单元数、扇出与可用机制从而改变分配，并给出分配组件下一阶段的工作包。',
    intro: `<b>分配</b> = 把系统级目标（可用率 A*、goodput G*、故障率 λ*）自顶向下拆成每个部件类的允许故障率和每项机制的参数设定值，再自底向上预测、校核、迭代。<b>口径规则</b>：同一事件类、同一分母、同一层级；中断、亚健康、静默错误三类事件不能相加，只能各自进入窗口账本后再合成。公式与 HAC-D 的实现一致（<code>packages/core/src/allocation</code>、<code>study</code>、<code>mechanisms/plan</code>）；三份 AGREE 报告（REMAP_ALLOCATION_98P5_AGREE、MECHANISM_COMPARISON_98P5_AGREE、REMAP_LATEST_ALLOCATION_98P5_AGREE）是它们在 54 条事件目录上的算例。`,
    figTitle: '图 · 分配闭环：目标 → 拆分 → 类预算 → 两条杠杆 → 自底向上校核 → 再分配',
    figCap: '图：方法只决定"预算在类之间怎么拆"；硬件改各类的中断率 λ_i，机制改各类的停顿 p̄_i；每一轮都用引擎重算、按余量再分配，直到名义与降额参数都达标且 P(窗口 ≥ 目标) ≥ 90 %。',
    h2a: '1. 经典分配方法（串联系统，m 个子系统；λᵢ⁰ 当前合计率，λᵢ* 分配率，kᵢ = λᵢ⁰ / λᵢ* 改进倍数）',
    th: ['方法', '公式', '输入', '适用 / 性质'],
    rows: [
      ['等分', 'λᵢ* = λ* / m；可靠度形式 Rᵢ = (R*)^{1/m}', '无', '无信息时的起点'],
      ['ARINC', 'λᵢ* = wᵢ λ*，wᵢ = λᵢ⁰ / Σⱼ λⱼ⁰ ⇔ 全部类乘同一倍数 k = Σλ⁰ / λ*', '各类当前率', '信任现状比例；HAC-D 默认'],
      ['AGREE', 'Rᵢ = 1 − (1 − R*^{nᵢ/N}) / Eᵢ，λᵢ = −ln Rᵢ / tᵢ（nᵢ 模块数，N = Σn，Eᵢ 重要度，tᵢ 工作时间）。可用率形式：ptᵢ* = U_free · nᵢ/Σn，λᵢ* = ptᵢ* · 3600 / (A* p̄ᵢ)，U_free = (1 − A*) − 非域暂停项', '模块数、重要度、工时比；各类停顿 p̄ᵢ', '模块多、工时长、重要度低 → 预算多；n、E、t 相同时退化为等分'],
      ['可改进性加权', 'λᵢ* = wᵢ λ*，wᵢ = Πₖ rᵢₖ / Σⱼ Πₖ rⱼₖ（复杂度、技术水平、工时、环境各 1–10 分，越难改分越高）', '各类评分', '置信度参差时；HAC-D 用单一权重（假设值 2，否则 1）'],
      ['最小努力（Albert）', '当前率降序 λ₍₁₎ ≥ λ₍₂₎ ≥ …；取最小 k 使 λ̄ = (λ* − Σⱼ₎ₖ λ₍ⱼ₎) / k ≥ λ₍ₖ₊₁₎；前 k 类改到 λ̄，其余不动', '各类当前率', '少数类主导时最省力；= AGREE 等权 + "余量类不恶化"的再分配'],
      ['成本最优', 'min Σ aᵢ (λᵢ⁰/λᵢ)^{bᵢ}  s.t. Σλᵢ = λ*，λᵢ^min ≤ λᵢ ≤ λᵢ⁰ → λᵢ = (aᵢ bᵢ (λᵢ⁰)^{bᵢ} / ν)^{1/(bᵢ+1)} 截断到区间，ν 二分', '成本曲线 a、b，下限', '有改进成本模型时；预算低于下限之和则不可行'],
      ['不可用度分解', 'Π Aᵢ = A* → ln Aᵢ = (wᵢ/Σw) ln A*，Uᵢ = 1 − Aᵢ；给 MTTRᵢ 则 λᵢ = Uᵢ / (MTTRᵢ (1 − Uᵢ))，给 λᵢ 则 MTTRᵢ = Uᵢ / (λᵢ (1 − Uᵢ))', 'A*，各类 MTTR 或 λ', '硬件级可用率；每类只能用 λ 或 MTTR 之一兑现'],
      ['goodput 预算（Young）', 'M = 3600/(N λ_GPU)，L = √(2δ/M) + R/M，L* = 1 − G*；定 R 解 M*，定 M 解 R* = M (L* − √(2δ/M))；均衡 L_r = ρL*', 'δ、R、λ_GPU', '训练作业；要求 (τ+δ)/M ≤ 0.1 且 R/M ≤ 0.1'],
      ['恢复阶段预算', 'budgetᵢ = floorᵢ + (wᵢ − floorᵢ) / Σⱼ(wⱼ − floorⱼ) · (R* − Σ floor)，wᵢ 默认当前阶段时间，检测下限 5 s', '阶段时间、下限', '定 λ 压 R 时拆到检测 / 自动 / 人工份额'],
    ],
    h2b: '2. 算法（HAC-D 实现）',
    alg: [
      ['A · AGREE 可用率分配与再分配', ['固定项 fixed = Σ 非域暂停（亚健康隔离、静默错误即时检出、预测误报）；U_free = (1 − A*) − fixed', 'ptᵢ* = U_free · nᵢ / Σn；λᵢ* = ptᵢ* · 3600 / (A* · p̄ᵢ)；kᵢ = λᵢ / λᵢ*（> 1 须改进）；允许 FIT = 当前 / kᵢ', '再分配（注水）：over = {kᵢ > 1}；重复：rem = U_free − Σ_{i∉over} ptᵢ；若某 i∈over 的 rem·nᵢ/Σ_over n ≥ ptᵢ 则移出 over；直到稳定 → k′ᵢ（硬件任务）', '复算：各类 λᵢ ← λᵢ / kᵢ，引擎重算 A_op，应回到 A*（算例 98.50 %）']],
      ['B · 机制组合选择', ['精确（≤ 10 候选）：枚举 2ⁿ 组合，取 min Σ 工作量 s.t. V(名义) ≥ 目标 且 V(降额) ≥ 目标；必要机制 = 所有可行组合的交集；Pareto 前沿（工作量–价值）', '贪心（> 10）：每步加入 ΔV / 工作量最大者，直到名义与降额都达标', 'AGREE 两阶段：① 按类补缺 — score = [Σ_{i∈over} max(0, ptᵢ − max(ptᵢ^new, ptᵢ*)) − Δfixed] / 工作量；② 造余量 — 剩余超预算类无机制可用时按 ΔA_op / 工作量加入作用于已达标类的机制，余量经再分配补给', '降额 DERATE_DEFAULT：覆盖率 / 适用比例 −5 pt，成功率 −8 pt，时间与开销 ×1.5，削减比例 ×0.5；τ、域数为设计量不降额']],
      ['C · 自底向上预测与校核', ['闭式：27 路径恢复链枚举（预测 → 网络容错 → 重执行 → 热替换 → 弹性 → 进程 → 全局）→ 各类 p̄ᵢ → A_op；窗口账本九项 → 正确交付 goodput', `蒙特卡洛：${NUM.trials} 个 30 天窗口账本（同一故障流，机制共享历史）→ P(窗口 ≥ 目标)，Wilson 95 % 区间 → supported / uncertain / below（要求 ≥ 90 %）`, '归因：Shapley（≤ 12 项精确，否则置换抽样 ± t 半宽）；分配视角用"消除的超预算量"（单独 / 末位移除）', '闭环：实测事件 → Garwood 率区间（hacd rate）→ 回写 FIT、阶段时间、检出率 → 重跑']],
    ],
    h2c: '3. 要点',
    points: [
      `<b>守恒</b>：Σᵢ ptᵢ + fixed = 1 − A_op，ptᵢ = A_run · λᵢ · p̄ᵢ / 3600。方法只改变"在类之间怎么拆"，总预算相同：ARINC 全部等比，AGREE 按复杂度 / 重要度 / 工时，Albert 只改最差者。`,
      `<b>两条杠杆</b>：硬件改 λᵢ（验收限值 FIT = 当前 / k），机制改 p̄ᵢ（梯级把 264.5 s 的全局恢复换成 5–60 s 的就地恢复；检测、人工份额、启动 / 读取阶段的机制作用于所有中断）。有梯级的类拿到余量，经再分配补给没有梯级的 POWER / COOL / MGMT / STORAGE / UNKNOWN。`,
      `<b>复杂度与重要度决定 AGREE 的结论</b>：参考目录按每卡·小时归一 → nᵢ 相同 → 等分（10 万卡 ${NUM.over1} / 18 类超预算，CORE ×${NUM.eqCore}、UNKNOWN ×${NUM.eqUnknown}）；若按物理单元计，机柜级类的预算缩小 ${NUM.racks} 倍（POWER ×${NUM.physPower}、STORAGE ×${NUM.physStorage}）。串联作业里每个硬中断都停作业 → Eᵢ = 1；整窗暴露 → tᵢ = T。`,
      `<b>筛选律</b>：无故障上界 G ≤ τ/(τ+δ)，高于最佳组合上界的目标"已证明不可达"；规模律：检测与恢复项 ∝ N，checkpoint 项 ∝ √N，静默污染次数 ∝ N——按将运行的最大 N 分配。`,
      `<b>算例（54 条事件目录，A_op ≥ 98.5 %）</b>：基线上限 ${NUM.baselineMax} 卡；ReMAP 原有机制的 AGREE 集上限 ${NUM.remapMax}，原有 + 新增 ${NUM.combinedMax}，最新 ReMAP 集 ${NUM.latestMax}；20 万卡最新集 ${NUM.a2} %（工作量 ${NUM.e2}，P(窗口) ${NUM.p2} %）；50 万卡无可行集，AGREE 把硬件任务集中在 ${NUM.hw5}（其余 ${18 - NUM.hw5n} 类不动），ARINC 则要求全部 ×${NUM.uni5}。`,
    ],
    foot1: '来源：docs/ALLOCATION_METHODS_MECHANISM_PARAMETERS.zh.html（公式与 19 项机制的参数规则）、docs/MODEL_REFERENCE.md §7 / §22–§24、三份 AGREE 报告；复现 <code>node --import tsx scripts/agree-allocation-98p5.ts</code>、<code>hacd allocate &lt;s.json&gt; --availability 0.985 --method agree</code>、<code>hacd plan</code>、<code>hacd study</code>。',
    title2: '分配方法的改进方向（硬件约束、新机制组合、优化）',
    intro2: `下表按"现状与证据 → 做法 → HAC-D 接口"列出八个方向；证据来自 54 条事件目录上的分配研究（A_op ≥ 98.5 %，1 万–50 万卡）。优先级：★★★ 先做（改变结论），★★ 其次，★ 增强。`,
    th2: ['方向', '现状与证据', '做法（模型 / 算法）', 'HAC-D 接口', '优先级'],
    rows2: [
      ['① 硬件约束进入分配', `AGREE / ARINC 只给出"该类须 ×k"，不知道能否做到：50 万卡要求 UNKNOWN ×${kf(hwTasks5[0]?.realloc.k ?? 0)}、仅硬件时 CORE ×${kf(C5.hardwareOnly.agreeEqual.rows.find((r) => r.id === 'CORE-hard').k)}，远超工艺可及范围；成本最优法已有 λ^min 与 a·(λ⁰/λ)^b，但 a、b、下限都是占位值。`, '每类给出可及下限（最佳已知 FIT、供应商路线图、同器件实测的 Garwood 区间）、成本曲线与交付周期；分配改为带约束的优化：min 成本 s.t. Σ ptᵢ ≤ U_free，λᵢ ≥ λᵢ^min；不可达的类自动转给机制或冗余（k-of-n、β 共因）。', '<code>component.allocation.minLambdaFactor / costA / costB</code> 填实测值；分配页按"不可达"标红并给出替代路径', '★★★'],
      ['② 复杂度、重要度、工时的物理定义', `AGREE 的结论取决于"模块"：按每卡·小时归一 = 等分，按物理单元 = POWER ×${NUM.physPower}、STORAGE ×${NUM.physStorage}。重要度统一取 1 忽略了爆炸半径（一个机柜事件带走 ${NUM.racks} 卡）与就地恢复后"不再停作业"的事件。`, '复杂度 nᵢ 改为暴露量（卡·小时 × 扇出）或器件当量；重要度 Eᵢ = 经恢复链后仍到达全局恢复的事件份额（由链计算，而非人工打分）；工时 tᵢ 按阶段暴露（通信相、checkpoint 保存窗口）取值；三者由拓扑与链自动生成。', '<code>allocation.importance / duty</code> 由拓扑（机柜、分区、平面）与 <code>mechanisms.applied</code> 推导；分配页显示三种复杂度定义的并排结果', '★★★'],
      ['③ 硬件 × 机制 × 参数的联合优化', `现在分三步：机制集（精确 ≤ 10 / 贪心 / AGREE 两阶段）→ 参数二分 → 硬件因子；贪心在 10 万卡选 R-REPLAY + R-PROCESS 而精确解是 R-ELASTIC 单项（同工作量、A_op 高 0.2 pt）；带前置条件的组合（D-SDC + R-SDC）贪心永远选不到。`, '把机制选择、连续参数（检测时延、成功率、阶段时间、τ）和各类硬件因子放进一个问题：整数部分用分支定界 / 波束搜索（≤ 23 项可精确），连续部分用坐标下降或贝叶斯优化，目标 = 工作量或成本，约束 = 名义与降额都达标、P(窗口) ≥ 90 %；输出工作量–余量–P 的 Pareto 前沿；前置条件按"组"而非单项评估。', '<code>planToTarget</code> 加 <code>mode: "joint"</code>，<code>allocationStudy</code> 输出 Pareto 前沿；CLI <code>hacd plan --joint</code>', '★★★'],
      ['④ 面向薄弱环节规划新机制组合', `所有报告的残余都落在无梯级的类：20 万卡方案后 POWER / COOL / MGMT / STORAGE / UNKNOWN 占残余最大，50 万卡只有它们还要改硬件；现有机制中只有"作用于所有中断"的检测、人工份额、启动 / 读取类能碰到它们。`, '为每个无梯级类设计候选机制并先用参数占位评估收益阈值：机柜供电穿越 / 双路（POWER）、冷却降额运行而非停机（COOL）、控制面连续（MGMT，已有 H-CONTROL-CONTINUITY）、存储多路径与本地缓存（STORAGE）、未归因事件的根因归类（UNKNOWN，把 410 FIT 拆回可治理的类）；用 Shapley 与"消除的超预算量"区分替代与互补，再按链顺序与前置条件组合。', '审核库新增条目（<code>mechanism-audit.json</code> 候选事件 + 参数空缺），<code>hacd audit</code> 评估"若有此机制"的单点收益', '★★'],
      ['⑤ 多口径联合分配', `A_op 与正确交付 goodput 的结论不同：ReMAP 口径下只有 1 万卡可行，含 C-FAST 的组合永远到不了 98.5 %（常量保存损失 1.64 pt）；检测类机制对 A_op 为负、对正确交付为正。`, '目标写成向量（A_op、正确交付、有效 goodput）与字典序或加权；静默错误预算与中断预算分开拆再合成（不混口径）；对每个口径分别给出 q*、D*、τ 上界等硬约束，交集为可行域。', '<code>allocationStudy({ metric })</code> 扩为多目标；报告页并列两种口径（已有）加"可行域交集"视图', '★★'],
      ['⑥ 不确定性进入分配', `参数带置信度（measured / paper / vendor / assumed），但分配只用点值 + 固定降额（−5 / −8 pt、×1.5）；校核才给出 P(窗口)；10 万卡 R-REPLAY + R-PROCESS 的 P 仅 90.5 %（uncertain）。`, '按置信度分级降额；把 P(窗口 ≥ 目标) ≥ 90 % 写进分配（机会约束：对账本分布的分位数分配而非均值）；事件率用 Garwood 区间的上限做稳健分配；给出预算对各参数的敏感度（龙卷风图已有）。', '<code>DerateSpec</code> 按 provenance 分级；<code>verify</code> 的分位数回灌 <code>planToTarget</code>', '★★'],
      ['⑦ 随规模与时间变化的分配', `预算随 N 变化（检测 / 恢复项 ∝ N，checkpoint ∝ √N），同一机制集的上限是一个 N（曲线图）；寿命期内有早期失效、问题节点、修复后再生，分配却是静态的。`, '分配按"将运行的最大 N"和寿命阶段（磨合期、稳定期、老化期）分别做；闭环：实测事件 → 率区间 → 偏移检测 → 重分配；把备件池、修复队列（资源 DES）作为约束引入。', '<code>allocationStudy</code> 的曲线扩为 N × 阶段矩阵；<code>hacd rate</code> 回写；资源队列（架构路线图 X3）', '★'],
      ['⑧ 工具与交付', `AGREE 权重、再分配、两阶段选集目前只在脚本里；验收表（每类允许 FIT）与供应商、运维的接口靠手工。`, '分配页加 AGREE 权重编辑（拓扑推导 + 手改）、再分配开关、两阶段选集；导出每类验收表（FIT 限值、停顿限值、检测限值）与 ReMAP 审核请求；与 ReMAP 引擎交叉校核常态化。', '<code>hacd study --method agree</code>、MCP <code>allocation_study</code> 参数；导出 CSV / JSON 验收表', '★'],
    ],
    order: '建议顺序：② 先把 AGREE 的三个权重做成可从拓扑与恢复链推导的量（否则 ①③ 的优化在错误的预算上跑），再做 ① 与 ③（约束 + 联合优化），④ 与现有审核库并行，⑤–⑧ 作为增强。',
    foot2: '依据：docs/REMAP_LATEST_ALLOCATION_98P5_AGREE.zh.html、docs/MECHANISM_COMPARISON_98P5_AGREE.zh.html、docs/REMAP_ALLOCATION_98P5_AGREE.zh.html 及此前三份规划器报告；架构路线图 docs/ARCHITECTURE.zh.html §9。',
  },
  en: {
    lang: 'en', title: 'Reliability allocation methods: fundamentals, formulas and algorithms', tab: 'Allocation methods summary', eyebrow1: `HAC-D · Allocation methods at a glance · ${date} · page 1 / 3`, eyebrow2: `HAC-D · Future improvements of the allocation method · ${date} · page 2 / 3`,
    desc: 'One page on the fundamentals of reliability allocation, the classical formulas (equal, ARINC, AGREE, feasibility weighting, Albert minimum effort, cost-optimal, unavailability split, goodput budget, stage budget) and the HAC-D algorithms (AGREE availability allocation with reallocation, mechanism-set selection, bottom-up verification), one page of future improvements (hardware constraints, new mechanism combinations, optimisation), and one page on how the cluster architecture (scale, node form factor, network, pods / zones, power and cooling, storage, control plane, spares) changes unit counts, fan-out and available mechanisms and hence the allocation, with the next phase\u2019s work packages for the allocation components.',
    intro: `<b>Allocation</b> splits a system-level target (availability A*, goodput G*, failure rate λ*) top-down into an allowed failure rate per component class and a parameter setting per mechanism, then predicts bottom-up, verifies and iterates. <b>口径 rule</b>: same event class, same denominator, same level; interruptions, sub-health and silent corruption are never added, each enters the window ledger on its own before anything is combined. The formulas match the HAC-D implementation (<code>packages/core/src/allocation</code>, <code>study</code>, <code>mechanisms/plan</code>); the three AGREE reports (REMAP_ALLOCATION_98P5_AGREE, MECHANISM_COMPARISON_98P5_AGREE, REMAP_LATEST_ALLOCATION_98P5_AGREE) are their worked examples on the 54-event catalog.`,
    figTitle: 'Figure · The allocation loop: target → split → class budgets → two levers → bottom-up verification → reallocation',
    figCap: 'Figure: the method only decides how the budget is split between classes; hardware changes each class’s interruption rate λ_i, mechanisms change its pause p̄_i; every round is re-evaluated by the engine and the slack is reallocated until the target holds with nominal and derated parameters and P(window ≥ target) ≥ 90 %.',
    h2a: '1. Classical allocation methods (series system, m subsystems; λᵢ⁰ current aggregate rate, λᵢ* allocated rate, kᵢ = λᵢ⁰ / λᵢ* improvement factor)',
    th: ['Method', 'Formula', 'Inputs', 'Use / property'],
    rows: [
      ['Equal apportionment', 'λᵢ* = λ* / m; reliability form Rᵢ = (R*)^{1/m}', 'none', 'starting point without information'],
      ['ARINC', 'λᵢ* = wᵢ λ*, wᵢ = λᵢ⁰ / Σⱼ λⱼ⁰ ⇔ every class improves by the same factor k = Σλ⁰ / λ*', 'current rates', 'trusts the current proportions; HAC-D default'],
      ['AGREE', 'Rᵢ = 1 − (1 − R*^{nᵢ/N}) / Eᵢ, λᵢ = −ln Rᵢ / tᵢ (nᵢ modules, N = Σn, Eᵢ importance, tᵢ operating time). Availability form: ptᵢ* = U_free · nᵢ/Σn, λᵢ* = ptᵢ* · 3600 / (A* p̄ᵢ), U_free = (1 − A*) − non-domain pauses', 'module counts, importance, duty; class pauses p̄ᵢ', 'more modules, longer duty, lower importance → more budget; equal n, E, t → equal apportionment'],
      ['Feasibility weighting', 'λᵢ* = wᵢ λ*, wᵢ = Πₖ rᵢₖ / Σⱼ Πₖ rⱼₖ (complexity, state of the art, operating time, environment scored 1–10; harder to improve → higher score)', 'scores per class', 'uneven confidence; HAC-D uses one weight (2 for assumed rates, else 1)'],
      ['Minimum effort (Albert)', 'sort λ₍₁₎ ≥ λ₍₂₎ ≥ …; smallest k with λ̄ = (λ* − Σⱼ₎ₖ λ₍ⱼ₎) / k ≥ λ₍ₖ₊₁₎; the k worst classes go to λ̄, the rest stay', 'current rates', 'cheapest when a few classes dominate; = AGREE with equal weights + "no class gets worse" reallocation'],
      ['Cost-optimal', 'min Σ aᵢ (λᵢ⁰/λᵢ)^{bᵢ} s.t. Σλᵢ = λ*, λᵢ^min ≤ λᵢ ≤ λᵢ⁰ → λᵢ = (aᵢ bᵢ (λᵢ⁰)^{bᵢ} / ν)^{1/(bᵢ+1)} clipped, ν by bisection', 'cost curves a, b, floors', 'with a cost model; infeasible below the sum of floors'],
      ['Unavailability split', 'Π Aᵢ = A* → ln Aᵢ = (wᵢ/Σw) ln A*, Uᵢ = 1 − Aᵢ; given MTTRᵢ: λᵢ = Uᵢ / (MTTRᵢ (1 − Uᵢ)); given λᵢ: MTTRᵢ = Uᵢ / (λᵢ (1 − Uᵢ))', 'A*, MTTR or λ per class', 'hardware-level availability; each class spends its budget on λ or MTTR, not both'],
      ['Goodput budget (Young)', 'M = 3600/(N λ_GPU), L = √(2δ/M) + R/M, L* = 1 − G*; fix R → solve M*, fix M → R* = M (L* − √(2δ/M)); balanced L_r = ρL*', 'δ, R, λ_GPU', 'training jobs; requires (τ+δ)/M ≤ 0.1 and R/M ≤ 0.1'],
      ['Recovery stage budget', 'budgetᵢ = floorᵢ + (wᵢ − floorᵢ) / Σⱼ(wⱼ − floorⱼ) · (R* − Σ floor), wᵢ = current stage time, detection floor 5 s', 'stage times, floors', 'splitting R* over detection / automatic / manual share'],
    ],
    h2b: '2. Algorithms (as implemented in HAC-D)',
    alg: [
      ['A · AGREE availability allocation and reallocation', ['fixed = Σ non-domain pauses (sub-health isolation, detected silent corruption, predictor false alarms); U_free = (1 − A*) − fixed', 'ptᵢ* = U_free · nᵢ / Σn; λᵢ* = ptᵢ* · 3600 / (A* · p̄ᵢ); kᵢ = λᵢ / λᵢ* (> 1 must improve); allowed FIT = current / kᵢ', 'reallocation (water-filling): over = {kᵢ > 1}; repeat: rem = U_free − Σ_{i∉over} ptᵢ; drop any i ∈ over whose share rem·nᵢ/Σ_over n ≥ ptᵢ; until stable → k′ᵢ (the hardware task)', 'closure check: scale every class to λᵢ / kᵢ and re-evaluate A_op with the engine, which must return A* (98.50 % in the examples)']],
      ['B · Mechanism-set selection', ['exact (≤ 10 candidates): enumerate 2ⁿ coalitions, min Σ effort s.t. V(nominal) ≥ target and V(derated) ≥ target; necessary mechanisms = intersection of all feasible coalitions; Pareto front effort–value', 'greedy (> 10): add the mechanism with the largest ΔV / effort until the target holds nominally and derated', 'AGREE two-phase: ① close the classes — score = [Σ_{i∈over} max(0, ptᵢ − max(ptᵢ^new, ptᵢ*)) − Δfixed] / effort; ② create slack — when the remaining over-budget classes have no closer, add mechanisms acting on the other classes by ΔA_op / effort; the reallocation hands their slack over', 'derating DERATE_DEFAULT: coverage / eligible share −5 pt, success −8 pt, times and overheads ×1.5, reductions ×0.5; τ and domain counts are design choices and are not derated']],
      ['C · Bottom-up prediction and verification', ['closed form: 27-path recovery chain (predict → net-fail → replay → hot-swap → elastic → process → global) → class pauses p̄ᵢ → A_op; nine-line window ledger → delivered goodput', `Monte Carlo: ${NUM.trials} 30-day window ledgers (one fault stream, mechanisms share the history) → P(window ≥ target), Wilson 95 % interval → supported / uncertain / below (≥ 90 % required)`, 'attribution: Shapley (exact up to 12 players, permutation sampling ± t half-width beyond); the allocation view uses the "removed over-budget excess" (single / last removed)', 'closed loop: measured incidents → Garwood rate intervals (hacd rate) → write back FIT, stage times, detection coverage → rerun']],
    ],
    h2c: '3. Fundamentals',
    points: [
      `<b>Conservation</b>: Σᵢ ptᵢ + fixed = 1 − A_op with ptᵢ = A_run · λᵢ · p̄ᵢ / 3600. A method only changes how the budget is split between classes, the total is the same: ARINC scales every class alike, AGREE by complexity / importance / duty, Albert improves only the worst ones.`,
      `<b>Two levers</b>: hardware changes λᵢ (acceptance limit FIT = current / k), mechanisms change p̄ᵢ (a rung replaces the 264.5 s global recovery by a 5–60 s in-place one; detection, manual share and startup / read stage mechanisms act on every interruption). Classes with a rung gain slack, which the reallocation hands to POWER / COOL / MGMT / STORAGE / UNKNOWN that have none.`,
      `<b>Complexity and importance decide AGREE's verdict</b>: the reference catalog is normalised per card-hour → equal nᵢ → equal apportionment (100k cards: ${NUM.over1} / 18 classes over budget, CORE ×${NUM.eqCore}, UNKNOWN ×${NUM.eqUnknown}); counting physical units shrinks the rack-level budgets ${NUM.racks}-fold (POWER ×${NUM.physPower}, STORAGE ×${NUM.physStorage}). In a synchronous job every hard interruption stops the job → Eᵢ = 1; every class is exposed over the whole window → tᵢ = T.`,
      `<b>Screening laws</b>: fault-free bound G ≤ τ/(τ+δ), a target above the bound of the best coalition is "proven unreachable"; scale laws: detection and recovery terms ∝ N, the checkpoint term ∝ √N, silent-corruption counts ∝ N, so allocate for the largest N that will run.`,
      `<b>Worked numbers (54-event catalog, A_op ≥ 98.5 %)</b>: baseline holds up to ${NUM.baselineMax} cards; AGREE sets reach ${NUM.remapMax} with ReMAP's original mechanisms, ${NUM.combinedMax} with original + new, ${NUM.latestMax} with the latest ReMAP set; the 200k latest set gives ${NUM.a2} % (effort ${NUM.e2}, P(window) ${NUM.p2} %); 500k has no feasible set and AGREE concentrates the hardware task on ${NUM.hw5} (the other ${18 - NUM.hw5n} classes untouched) where ARINC would demand ×${NUM.uni5} on all of them.`,
    ],
    foot1: 'Sources: docs/ALLOCATION_METHODS_MECHANISM_PARAMETERS.zh.html (formulas and the parameter rule of the 19 mechanisms), docs/MODEL_REFERENCE.md §7 / §22–§24, the three AGREE reports; reproduce with <code>node --import tsx scripts/agree-allocation-98p5.ts</code>, <code>hacd allocate &lt;s.json&gt; --availability 0.985 --method agree</code>, <code>hacd plan</code>, <code>hacd study</code>.',
    title2: 'Future improvements of the allocation method (hardware constraints, new mechanism combinations, optimisation)',
    intro2: `Eight directions, each as "state and evidence → approach → HAC-D hook"; the evidence comes from the allocation studies on the 54-event catalog (A_op ≥ 98.5 %, 10k–500k cards). Priority: ★★★ first (changes conclusions), ★★ next, ★ enhancement.`,
    th2: ['Direction', 'State and evidence', 'Approach (model / algorithm)', 'HAC-D hook', 'Priority'],
    rows2: [
      ['① Hardware constraints inside the allocation', `AGREE / ARINC only say "this class must improve ×k" without knowing whether it can: 500k demands UNKNOWN ×${kf(hwTasks5[0]?.realloc.k ?? 0)}, hardware-only CORE ×${kf(C5.hardwareOnly.agreeEqual.rows.find((r) => r.id === 'CORE-hard').k)}, far beyond what processes can deliver; the cost-optimal method has λ^min and a·(λ⁰/λ)^b, but a, b and the floors are placeholders.`, 'Give every class a reachable floor (best known FIT, vendor roadmap, Garwood interval of the same part), a cost curve and a lead time; allocate as a constrained optimisation: min cost s.t. Σ ptᵢ ≤ U_free, λᵢ ≥ λᵢ^min; classes that cannot reach their budget are handed to mechanisms or redundancy (k-of-n, β common cause) automatically.', 'fill <code>component.allocation.minLambdaFactor / costA / costB</code> with measured values; the Allocation page flags "unreachable" and shows the alternative path', '★★★'],
      ['② Physical definitions of complexity, importance and duty', `AGREE's verdict depends on what a "module" is: per card-hour = equal split, per physical unit = POWER ×${NUM.physPower}, STORAGE ×${NUM.physStorage}. Importance = 1 everywhere ignores the blast radius (one rack event takes ${NUM.racks} cards) and the events that no longer stop the job after in-place recovery.`, 'Complexity nᵢ as exposure (card-hours × fan-out) or part equivalents; importance Eᵢ = share of events that still reach the global recovery after the chain (computed, not scored by hand); duty tᵢ from phase exposure (communication phases, checkpoint save windows); all three generated from the topology and the chain.', 'derive <code>allocation.importance / duty</code> from the topology (racks, zones, planes) and <code>mechanisms.applied</code>; show the three complexity definitions side by side on the Allocation page', '★★★'],
      ['③ Joint optimisation of hardware × mechanisms × parameters', `Today three steps: mechanism set (exact ≤ 10 / greedy / AGREE two-phase) → parameter bisection → hardware factor; at 100k the greedy picks R-REPLAY + R-PROCESS while the exact answer is R-ELASTIC alone (same effort, +0.2 pt A_op); coalitions with prerequisites (D-SDC + R-SDC) are never reached by a greedy step.`, 'One problem for the set, the continuous parameters (detection delay, success, stage times, τ) and the per-class hardware factors: branch and bound / beam search for the integer part (exact up to 23 items), coordinate descent or Bayesian optimisation for the continuous part, objective = effort or cost, constraints = target with nominal and derated parameters and P(window) ≥ 90 %; output the effort–margin–P Pareto front; evaluate prerequisite groups as groups.', '<code>planToTarget</code> with <code>mode: "joint"</code>, <code>allocationStudy</code> returning the Pareto front; CLI <code>hacd plan --joint</code>', '★★★'],
      ['④ Plan new mechanism combinations for the weak links', `Every report leaves its residual in the classes without a rung: after the 200k plan POWER / COOL / MGMT / STORAGE / UNKNOWN dominate the residual and at 500k only they still need hardware; among the existing mechanisms only the detection, manual-share and startup / read ones (acting on every interruption) touch them.`, 'Design candidate mechanisms per rung-less class and evaluate them with placeholder parameters to find the benefit threshold: rack power ride-through / dual feed (POWER), derated operation instead of shutdown (COOL), control-plane continuity (MGMT, H-CONTROL-CONTINUITY exists), storage multipath and local cache (STORAGE), root-cause attribution of the unattributed 410 FIT (UNKNOWN); separate substitutes from complements with Shapley and the removed excess, then combine by chain order and prerequisites.', 'new audit-library entries (<code>mechanism-audit.json</code> candidate events + open parameters), <code>hacd audit</code> for the "if we had it" single-point gain', '★★'],
      ['⑤ Allocation over several 口径 at once', `A_op and delivered goodput disagree: in ReMAP's 口径 only 10k is feasible and any set containing C-FAST never reaches 98.5 % (constant save loss 1.64 pt); detectors are negative for A_op and positive for delivered goodput.`, 'Targets as a vector (A_op, delivered, effective goodput) with lexicographic or weighted order; silent-corruption and interruption budgets split separately and recombined (never mixed); hard constraints per 口径 (q*, D*, τ bound) whose intersection is the feasible region.', '<code>allocationStudy({ metric })</code> extended to several metrics; the report page already shows both 口径, add the "feasible intersection" view', '★★'],
      ['⑥ Uncertainty inside the allocation', `Parameters carry a confidence (measured / paper / vendor / assumed) but the allocation uses point values plus a fixed derating (−5 / −8 pt, ×1.5); only the verification gives P(window); the 100k set R-REPLAY + R-PROCESS has P = 90.5 % (uncertain).`, 'Derate by confidence class; write P(window ≥ target) ≥ 90 % into the allocation (chance constraint: allocate quantiles of the ledger distribution, not means); use the upper Garwood bound of the rates for a robust allocation; report the budget sensitivity to each parameter (tornado exists).', '<code>DerateSpec</code> graded by provenance; feed the quantiles of <code>verify</code> back into <code>planToTarget</code>', '★★'],
      ['⑦ Allocation that follows scale and time', `Budgets change with N (detection / recovery ∝ N, checkpoint ∝ √N) and a mechanism set has one largest feasible N (the curves); infant mortality, lemon nodes and post-repair renewal change the rates over the life of the cluster, the allocation is static.`, 'Allocate for the largest N that will run and per life phase (burn-in, steady, wear-out); close the loop: incidents → rate intervals → drift detection → reallocation; bring the spare pool and repair queue (resource DES) in as constraints.', 'curves of <code>allocationStudy</code> as an N × phase matrix; <code>hacd rate</code> write-back; resource queue (architecture roadmap X3)', '★'],
      ['⑧ Tooling and delivery', `AGREE weights, reallocation and the two-phase selection live only in scripts; the acceptance table (allowed FIT per class) reaches vendors and operations by hand.`, 'Allocation page: editable AGREE weights (derived from topology + manual), reallocation switch, two-phase selection; export the per-class acceptance table (FIT, pause and detection limits) and the ReMAP audit request; make the cross-check against the ReMAP engines routine.', '<code>hacd study --method agree</code>, MCP <code>allocation_study</code> options; CSV / JSON acceptance tables', '★'],
    ],
    order: 'Suggested order: ② first, so that AGREE’s three weights become quantities derived from the topology and the recovery chain (otherwise ① and ③ optimise the wrong budgets), then ① and ③ (constraints + joint optimisation), ④ in parallel with the audit library, ⑤–⑧ as enhancements.',
    foot2: 'Based on docs/REMAP_LATEST_ALLOCATION_98P5_AGREE.zh.html, docs/MECHANISM_COMPARISON_98P5_AGREE.zh.html, docs/REMAP_ALLOCATION_98P5_AGREE.zh.html and the three earlier planner reports; architecture roadmap docs/ARCHITECTURE.zh.html §9.',
  },
};

/* ---------- the figure ---------- */
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const STYLE = `
svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --mid:#f0efec; --b1:#e8f0fb; --b2:#fdece4; --b3:#e4f6ee; --b4:#fdf3dc; --b5:#f0efec; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --mid:#383835; --b1:#1f2d44; --b2:#3d2619; --b3:#1b3328; --b4:#3a2f17; --b5:#2a2a28; } }
:root[data-theme="light"] svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --mid:#f0efec; --b1:#e8f0fb; --b2:#fdece4; --b3:#e4f6ee; --b4:#fdf3dc; --b5:#f0efec; }
:root[data-theme="dark"] svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --mid:#383835; --b1:#1f2d44; --b2:#3d2619; --b3:#1b3328; --b4:#3a2f17; --b5:#2a2a28; }
svg.viz text { fill: var(--ink); font-size: 11.5px; } svg.viz .h { font-size: 12.5px; font-weight: 700; } svg.viz .t2 { fill: var(--ink2); font-size: 10.5px; } svg.viz .m { fill: var(--muted); font-size: 10px; } svg.viz .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 10.5px; } svg.viz .ttl { font-size: 13px; font-weight: 600; }
svg.viz .box { stroke: var(--axis); stroke-width: 1; } svg.viz .arrow { stroke: var(--ink2); stroke-width: 1.6; fill: none; } svg.viz .back { stroke: var(--s2); stroke-width: 1.6; fill: none; stroke-dasharray: 6 4; }
`;
const FIG = {
  zh: {
    title: '分配闭环：目标 → 预算拆分 → 类预算 → 两条杠杆 → 自底向上预测与校核 → 再分配',
    b1: ['① 系统目标', 'A_op ≥ 98.5 %（30 天）', '或 G_d*（正确交付）、λ*', '预算 U = 1 − A*；', '口径：同类事件、同分母'],
    b2: ['② 预算拆分（方法）', '等分 λ*/m', 'ARINC wᵢ = λᵢ⁰/Σλ⁰（等比）', 'AGREE nᵢ/N ÷ (Eᵢ tᵢ)', '可改进性 Π rᵢₖ · Albert 共同水平', '成本最优 min Σ aᵢ(λᵢ⁰/λᵢ)^{bᵢ}'],
    b3: ['③ 类预算', 'ptᵢ* = U_free · wᵢ', 'λᵢ* = ptᵢ*·3600/(A*·p̄ᵢ)', 'kᵢ = λᵢ/λᵢ*；允许 FIT = 当前/kᵢ', '阶段预算：检测 / 自动 / 人工', '静默：q*、D*；checkpoint：τ 上界'],
    b4a: ['④a 硬件杠杆（改 λᵢ）', '每类 FIT 验收限值', 'H-RELIABILITY、H-LEMON', '冗余 k-of-n、β 共因'],
    b4b: ['④b 机制杠杆（改 p̄ᵢ）', '检测 d、梯级 s / tₛ、阶段 60/60/60', 'τ、δ；人工份额；覆盖率 q', '选集：精确 ≤ 10 / 贪心 / AGREE 两阶段', '降额 −5 pt / −8 pt / ×1.5'],
    b5: ['⑤ 自底向上预测与校核', '闭式：27 路径链 → p̄ᵢ → A_op', '账本九项 → 正确交付 G_d', `MC：${NUM.trials} 窗口 → P(窗口 ≥ 目标)`, 'Wilson 区间 → supported / uncertain', '归因：Shapley、消除的超预算量'],
    back1: '再分配余量（注水）/ 迭代', back2: '实测 → Garwood 率 → 回写（hacd rate）',
    ribbon: '守恒：Σᵢ ptᵢ + 非域暂停项 = 1 − A_op，ptᵢ = A_run · λᵢ · p̄ᵢ / 3600 —— 方法只改变类之间的拆分；硬件改 λᵢ，机制改 p̄ᵢ',
  },
  en: {
    title: 'The allocation loop: target → budget split → class budgets → two levers → bottom-up prediction and verification → reallocation',
    b1: ['① System target', 'A_op ≥ 98.5 % (30 days)', 'or G_d* (delivered), λ*', 'budget U = 1 − A*;', '口径: same event class, same denominator'],
    b2: ['② Budget split (methods)', 'equal λ*/m', 'ARINC wᵢ = λᵢ⁰/Σλ⁰ (uniform factor)', 'AGREE nᵢ/N ÷ (Eᵢ tᵢ)', 'feasibility Π rᵢₖ · Albert common level', 'cost-optimal min Σ aᵢ(λᵢ⁰/λᵢ)^{bᵢ}'],
    b3: ['③ Class budgets', 'ptᵢ* = U_free · wᵢ', 'λᵢ* = ptᵢ*·3600/(A*·p̄ᵢ)', 'kᵢ = λᵢ/λᵢ*; allowed FIT = current/kᵢ', 'stage budgets: detection / auto / manual', 'silent: q*, D*; checkpoint: τ bound'],
    b4a: ['④a Hardware lever (λᵢ)', 'FIT acceptance limit per class', 'H-RELIABILITY, H-LEMON', 'redundancy k-of-n, β common cause'],
    b4b: ['④b Mechanism lever (p̄ᵢ)', 'detection d, rungs s / tₛ, stages 60/60/60', 'τ, δ; manual share; coverage q', 'selection: exact ≤ 10 / greedy / AGREE two-phase', 'derating −5 pt / −8 pt / ×1.5'],
    b5: ['⑤ Bottom-up prediction and verification', 'closed form: 27-path chain → p̄ᵢ → A_op', 'nine-line ledger → delivered G_d', `MC: ${NUM.trials} windows → P(window ≥ target)`, 'Wilson interval → supported / uncertain', 'attribution: Shapley, removed excess'],
    back1: 'reallocate slack (water-filling) / iterate', back2: 'incidents → Garwood rates → write back (hacd rate)',
    ribbon: 'Conservation: Σᵢ ptᵢ + non-domain pauses = 1 − A_op, ptᵢ = A_run · λᵢ · p̄ᵢ / 3600 — the method only changes the split between classes; hardware changes λᵢ, mechanisms change p̄ᵢ',
  },
};
function figure(lang) {
  const F = FIG[lang];
  const W = 960, colX = [14, 202, 390, 578, 766], colW = 176, lh = 14;
  const tw = (t, mono) => Array.from(t).reduce((a, ch) => a + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 10.6 : mono ? 6.4 : 5.8), 0);
  const wrap = (t, maxW, mono) => {
    const lines = []; let cur = '';
    for (const tok of t.split(/(\s+)/)) {
      if (/^\s+$/.test(tok)) { cur += tok; continue; }
      if (tw(cur + tok, mono) <= maxW) { cur += tok; continue; }
      if (cur.trim()) lines.push(cur.trim());
      cur = '';
      if (tw(tok, mono) > maxW) { let piece = ''; for (const ch of Array.from(tok)) { if (tw(piece + ch, mono) > maxW && piece) { lines.push(piece); piece = ch; } else piece += ch; } cur = piece; } else cur = tok;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  };
  const items = (lines, monoIdx) => lines.flatMap((ln, i) => wrap(ln, colW - 16, monoIdx.includes(i)).map((w) => ({ text: w, cls: i === 0 ? 'h' : monoIdx.includes(i) ? 'f' : 't2' })));
  const draw = (x, y, fill, its) => { const h = 10 + its.length * lh + 4; let g = `<rect x="${x}" y="${y}" width="${colW}" height="${h}" rx="7" fill="var(--${fill})" class="box"/>`; its.forEach((it, i) => { g += `<text x="${x + 8}" y="${y + 16 + i * lh}" class="${it.cls}">${esc(it.text)}</text>`; }); return { g, h }; };
  const top = 36;
  const b1 = draw(colX[0], top, 'b1', items(F.b1, []));
  const b2 = draw(colX[1], top, 'b2', items(F.b2, [1, 2, 3, 4, 5]));
  const b3 = draw(colX[2], top, 'b3', items(F.b3, [1, 2, 3]));
  const b4a = draw(colX[3], top, 'b4', items(F.b4a, []));
  const b4b = draw(colX[3], top + b4a.h + 8, 'b4', items(F.b4b, []));
  const b5 = draw(colX[4], top, 'b3', items(F.b5, []));
  const bottom = Math.max(top + b1.h, top + b2.h, top + b3.h, top + b4a.h + 8 + b4b.h, top + b5.h);
  let g = `<svg class="viz" id="fig-loop" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} HEIGHT" width="100%" role="img" aria-label="${esc(F.title)}"><style>${STYLE}</style><rect width="${W}" height="HEIGHT" fill="var(--surface)" rx="8"/>`;
  g += `<text x="14" y="20" class="ttl">${esc(F.title)}</text>`;
  g += `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink2)"/></marker><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--s2)"/></marker></defs>`;
  g += b1.g + b2.g + b3.g + b4a.g + b4b.g + b5.g;
  const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" class="arrow" marker-end="url(#ah)"/>`;
  const ym = top + 44;
  g += arrow(colX[0] + colW, ym, colX[1] - 1, ym) + arrow(colX[1] + colW, ym, colX[2] - 1, ym);
  g += arrow(colX[2] + colW, ym - 8, colX[3] - 1, top + b4a.h / 2) + arrow(colX[2] + colW, ym + 8, colX[3] - 1, top + b4a.h + 8 + b4b.h / 2);
  g += arrow(colX[3] + colW, top + b4a.h / 2, colX[4] - 1, top + 30) + arrow(colX[3] + colW, top + b4a.h + 8 + b4b.h / 2, colX[4] - 1, top + b5.h - 30);
  const yb1 = bottom + 18, yb2 = bottom + 40;
  const c3 = colX[2] + colW / 2, c1 = colX[0] + colW / 2, c5a = colX[4] + colW * 0.62, c5b = colX[4] + colW * 0.38;
  g += `<path d="M${c5a} ${top + b5.h} L${c5a} ${yb1} L${c3} ${yb1} L${c3} ${top + b3.h + 1}" class="back" marker-end="url(#ah2)"/><text x="${(c3 + c5a) / 2}" y="${yb1 - 4}" text-anchor="middle" class="t2">${esc(F.back1)}</text>`;
  g += `<path d="M${c5b} ${top + b5.h} L${c5b} ${yb2} L${c1} ${yb2} L${c1} ${top + b1.h + 1}" class="back" marker-end="url(#ah2)"/><text x="${(c1 + c3) / 2}" y="${yb2 - 4}" text-anchor="middle" class="t2">${esc(F.back2)}</text>`;
  const rib = wrap(F.ribbon, W - 70, true);
  const ry = yb2 + 12, rh = 10 + rib.length * 15;
  g += `<rect x="14" y="${ry}" width="${W - 28}" height="${rh}" rx="7" fill="var(--mid)"/>` + rib.map((ln, i) => `<text x="${W / 2}" y="${ry + 17 + i * 15}" text-anchor="middle" class="f" style="font-size:11px">${esc(ln)}</text>`).join('');
  const H = ry + rh + 10;
  return (g + '</svg>').replace(/HEIGHT/g, String(H));
}

/* ---------- page 3: how the architecture shapes the allocation + next-phase work packages ---------- */
const T3 = {
  zh: {
    eyebrow3: `HAC-D · 架构如何影响分配 · 下一阶段工作包 · ${date} · 第 3 / 3 页`,
    title3: '集群架构如何影响分配，以及分配组件下一步做什么',
    intro3: `AGREE 的三个权重（复杂度 n_i、重要度 E_i、工时比 t_i）、各类的集群级事件率和可用的机制都由集群架构决定，而不是由分配方法决定：架构定下每类有多少单元（<code>countRule.per</code> × <code>topology</code> → <code>computeCounts</code>）、一次事件停掉多少卡（<code>blastRadius</code>、<code>ccf.beta</code>、冗余组）、哪些梯级可用（<code>component.mechanisms</code>、弹性域数、热备、平面数）。下表按架构要素列出它改变的分配量、HAC-D 里对应的字段 / 模型和在 98.5 % 算例上的后果；图中按层级给出同样的关系。最后一张表是下一阶段的工作包，细则见 <code>docs/PLAN_V3_8_ALLOCATION_ARCHITECTURE.md</code>。`,
    figCap3: '图：自下而上的五个架构层级各自决定单元数、扇出 / 共因、可用机制，从而决定 AGREE 的 n_i、E_i、t_i 与每类预算；卡级类梯级最多、余量最大，设施 / 存储 / 控制面级没有梯级，分配给它们的是冗余等级与 β 上限而不是 FIT。',
    h2arch: '1. 架构要素 → 分配量 → HAC-D 字段 → 算例上的后果',
    thArch: ['架构要素', '改变的分配量', 'HAC-D 现有字段 / 模型', '分配上的后果（98.5 % 算例与文献数值）'],
    rowsArch: [
      ['规模 N 与并行划分（DP × TP × PP）', '所有类的集群级事件率 ∝ N（1/N 定律，Meta RSC 实测）；检测 / 恢复项 ∝ N，checkpoint 项 ∝ √N；DP 副本数 = 弹性域数 n_dom；TP / PP 组内串联', 'workload.nGpus；mechanisms.elastic.domains；replicaComposition（副本范围）', '每类等分预算随 N 收紧：0.083 → 0.070 pt（1 万 → 50 万卡，非域暂停项变大）；仅硬件因子 6.19 → 0.10；基线上限 60.5k 卡'],
      ['节点形态与 scale-up 域（8 卡 HGX、NVL72 整柜 72 卡、CloudMatrix384 超节点 384 卡、Atlas 950 8,192 卡）', '节点级类的单元数（CPU / DDR / SSD / MGMT：N/8 或 N/4）；域级事件的扇出 = 域内卡数；备件粒度与弹性域数；共因 β（母线 / manifold / 交换托盘）', 'topology.gpusPerNode / nodesPerRack / nvlinkDomainGpus / superpod；component.blastRadius、ccf.beta、redundancy；hotSpareNodes', '扇出 8 → 72 → 384 使域级类的暴露量（卡·小时）同倍放大，AGREE 权重应按暴露量而非箱数：按物理箱数计 POWER ×188 是反例；Meta Sparing：72 / 36 / 18 卡块备件 8.6 / 4.7 / 2.6 %，stranding 3.9 / 7.8 / 9.9 %'],
      ['网络架构（多平面 Clos / 轨道优化、OCS、光链路数、单 / 双 ToR、逐包喷洒）', '网络类的单元数（CloudMatrix384 每超节点 5,376 条光链路、10,752 个光模块、7 子平面 × 16 L2 芯片）；平面丢失从停机变成容量系数 c = (P − 1)/P；netfail / 链路本地恢复 / 网络绕行的适用性', 'topology.networkPlanes、torMode、superpod（l1_switch / l2_switch / subplane / optical_link / transceiver 计数）；planeLossPerformance；mechanisms.netfail、R-LINK-LOCAL、R-FABRIC-DEGRADE', '目录中 NIC / OPT / BOXIO / FABRIC 占中断率 8.4 %（Llama 3 的 Switch / Cable 也是 8.4 %）；有 netfail 梯级时停顿 264 → 2 s，四类立刻进入余量；8 平面丢一面 = 12 % 容量而非一次中断（MRC）；TPUv4 OCS 日故障 0.04 % 但爆炸半径是整个 pod'],
      ['Pod / 分区 / 超节点划分与备件池位置', '分区级类（共享存储、控制面）的单元数与扇出；作业能放在哪、备件池按哪个层级配（N+k 超节点）；推理副本的范围', 'topology.racksPerZone；countRule.per = zone / supernode / fixed；replicaScope、ascendSupercluster；sparing（二项 P99）', '分区级事件一次停整个分区：预算按暴露量分而非按 7 个分区的箱数（否则 STORAGE ×8400）；备件按分位数而非比例：1,024 台作业 P99 只需 4 台热备（ByteRobust）'],
      ['供电与冷却（2N / N+1 / catcher；CDU N+1；机柜级共享母线）', 'POWER / COOL 类进入分配的是保护后残余率：并联 λ_res ≈ 2λ²·MTTR，k-of-n 用 CTMC；共因 β 决定残余的下限', 'topology.power / cooling；redundancy{scheme, k, n, switchover}；ccf{domain, beta}；ccfLeaves', '50 万卡方案后 POWER 仍是硬件任务（×1.3）而无机制可用：它的机制就是冗余等级与 β，分配应给出 β 上限（共因预算）而不只是 FIT；综述：无一家公开可代入的 β'],
      ['存储与 checkpoint 架构（内存副本 / 本地 NVMe / 共享存储分层；带宽）', 'δ 与加载阶段时间 → goodput 预算的 √(2δ/M) 项；STORAGE 类的单元数（按分区）与 FIT；C-MEM / C-ASYNC / C-LOSSLESS 的参数空间', 'workload.deltaS、recovery.automatic.stages.read、C-MEM / C-ASYNC / C-LOSSLESS 变换；countRule.per = zone', 'checkpoint 项 ∝ √N；ReMAP 口径下 τ 60 s 的常量保存损失 1.64 pt 已超预算——分层 checkpoint 是唯一出路；STORAGE 在 50 万卡是硬件任务（×1.05，128 FIT）'],
      ['控制面与软件（管理刀片 / BMC、调度器、框架、可观测性）', 'MGMT 与 UNKNOWN 类：无梯级，只有作用于所有中断的机制能碰到；根因归类把 UNKNOWN 拆回可治理的类', 'H-CONTROL-CONTINUITY；D-RECOVERY-CLASSIFY；fit/incidents（Garwood 率）；MGMT / UNKNOWN 类', 'UNKNOWN 410 FIT 占 12.3 %，是 50 万卡最大的硬件任务（×2.4 → 172 FIT）；架构上的可观测性决定它能否被分解'],
      ['备件与维修架构（热备粒度、备件池位置、维修队列、人工时间）', '备件耗尽行 P_blocked；hotswap 适用性；人工份额 (1 − p_s)·T_manual（基线 72 s / 次）', 'hotSpareNodes、spareReplenishHours；资源队列 X3（架构路线图）；恢复杠杆 manual30', '50 万卡：自动尝试 60 s 单项即达标（98.99 %）；备件补充时间进入 blocked 行；维修队列尚未建模'],
    ],
    h2wp: '2. 分配组件下一步：工作包（细则见规划说明书 PLAN_V3_8）',
    thWp: ['工作包', '做什么', '验收（数值）', '里程碑'],
    rowsWp: [
      ['WP1 架构推导的 AGREE 权重', '暴露量 = 单元数 × 扇出 × 工时比；重要度 = 链后到达全局恢复的份额（ChainOutcome.pGlobal）；页面 / CLI / MCP 的权重基准 count · exposure · topology · manual', '目录上 count 复现三份 AGREE 报告；nvl72Design 上 NVSwitch 托盘（扇出 72）与供电馈线权重高于卡级类；弹性类重要度 = 1 − a·s（1e-9）', 'M1'],
      ['WP2 多层级分配', '卡 → 节点 → 机柜 / 超节点 → 分区 → 集群：先按暴露量分到层级，再在层内按方法分，再注水再分配；每层允许率、MTBF、备件数与验收表', 'Σ 各层 = 总预算（1e-9）；等权退化为平面 AGREE；复算回到 98.5 % ± 0.03 pt；ascendSupercluster 的超节点级允许率与其 N+k 结果一致', 'M1'],
      ['WP3 架构选项成为分配杠杆', '平面数、ToR、供电、冷却、域大小、热备、checkpoint 层级：每个选项的账本行移动、各类暴露量 / 重要度变化、等目标点 (g_eff, f)；研究报告第四张图', '每个选项的残余率 = RBD / CTMC 值；8 平面丢一面 = 12 %；等目标点落在曲线 2 % 内', 'M2'],
      ['WP4 约束', '可及下限（库内最佳已知值）、成本曲线、共因 β 预算（每域 β*）', '低于下限的类标红并给出机制 / 架构替代路径；β* 与 FIT 限值同表', 'M2'],
      ['WP5 联合优化与机会约束', '机制集 + 参数 + 硬件因子 + 架构选项一个问题：分支定界（≤ 23 项精确）+ 坐标下降 + AGREE 再分配；P(窗口 ≥ 目标) ≥ 90 % 进约束；前置条件按组', '≤ 10 项复现精确规划器；10 万卡给出 R-ELASTIC 单项（工作量 5，99.07 %）；D-SDC + R-SDC 按组可达；50 万卡给出 Pareto 前沿', 'M3'],
      ['WP6 不确定性', '按置信分级的降额（measured / paper / vendor / derived / assumed）；Garwood 上界分配；分配龙卷风图', '结果并列默认降额与分级降额；上界分配的因子 ≥ 点估计的因子', 'M3'],
      ['WP7 多口径与交付', 'A_op / 正确交付 / 有效 goodput 的可行域交集；推理副本层级；报告泛化到 report/agreeReport.ts；验收表导出 CSV / JSON；文档与 SPEC F20–F23', '1 万卡两口径都可行、20 万卡仅 A_op（与现报告一致）；hacd acceptance 导出通过 CLI 冒烟', 'M4'],
    ],
    order3: '建议顺序 WP1 → WP2 → WP4 → WP3 → WP5 → WP6 → WP7：先让权重来自架构（否则后面的优化在错误的预算上跑），再把架构选项放进杠杆，最后联合优化。待决定：默认权重基准（topology 还是 exposure）、架构选项是否也走联合仿真、优化目标用工作量还是成本、分级降额的数值、是否提交这些报告。',
    foot3: '依据：packages/core/src/scenario/build.ts（computeCounts、componentInstances、replicaScope、ccfLeaves）、schema.ts（countRule、topology、superpod、blastRadius、ccf、redundancy）、mechanisms/chain.ts（ChainOutcome.pGlobal）、examples.ts（nvl72Design、cloudMatrix384Training、atlas950Training、ascendSupercluster）；可靠性章 §2（1/N 定律）、§4（并联 / k-of-n / 平面丢失、TPUv4 OCS、Minder）、§6（Meta Sparing 块大小、ByteRobust 备件）、§7（β 无公开值）；三份 AGREE 报告与硬件 / 机制分配页。',
  },
  en: {
    eyebrow3: `HAC-D · How the architecture shapes the allocation · next-phase work packages · ${date} · page 3 / 3`,
    title3: 'How the cluster architecture shapes the allocation, and what to do next with the allocation components',
    intro3: `AGREE's three weights (complexity n_i, importance E_i, duty t_i), the cluster-level event rate of every class and the mechanisms that can act on it are decided by the cluster architecture, not by the allocation method: the architecture fixes how many units each class has (<code>countRule.per</code> × <code>topology</code> → <code>computeCounts</code>), how many cards one event stops (<code>blastRadius</code>, <code>ccf.beta</code>, redundancy groups) and which rungs exist (<code>component.mechanisms</code>, elastic domains, hot spares, planes). The table lists, per architectural element, the allocation quantity it changes, the HAC-D field or model that carries it and the consequence on the 98.5 % examples; the figure shows the same relations per level. The last table is the next phase's work packages, detailed in <code>docs/PLAN_V3_8_ALLOCATION_ARCHITECTURE.md</code>.`,
    figCap3: 'Figure: five architectural levels, bottom-up, each fixing unit counts, fan-out / common cause and available mechanisms, hence AGREE’s n_i, E_i, t_i and the class budgets; card-level classes have the most rungs and the largest slack, facility / storage / control-plane classes have none, so what is allocated to them is a redundancy level and a β ceiling rather than a FIT.',
    h2arch: '1. Architectural element → allocation quantity → HAC-D field → consequence on the examples',
    thArch: ['Architectural element', 'Allocation quantity it changes', 'HAC-D field / model today', 'Consequence (98.5 % examples and literature values)'],
    rowsArch: [
      ['Scale N and the parallel layout (DP × TP × PP)', 'cluster-level rate of every class ∝ N (1/N law, measured on Meta RSC); detection / recovery terms ∝ N, checkpoint term ∝ √N; DP replicas = elastic domains n_dom; TP / PP groups in series', 'workload.nGpus; mechanisms.elastic.domains; replicaComposition (replica scope)', 'the equal per-class budget tightens with N: 0.083 → 0.070 pt (10k → 500k, non-domain pauses grow); hardware-only factor 6.19 → 0.10; baseline holds to 60.5k cards'],
      ['Node form factor and scale-up domain (8-GPU HGX, NVL72 rack of 72, CloudMatrix384 supernode of 384, Atlas 950 of 8,192)', 'unit counts of node-level classes (CPU / DDR / SSD / MGMT: N/8 or N/4); fan-out of domain events = cards per domain; spare granularity and elastic domain count; common cause β (busbar / manifold / switch tray)', 'topology.gpusPerNode / nodesPerRack / nvlinkDomainGpus / superpod; component.blastRadius, ccf.beta, redundancy; hotSpareNodes', 'fan-out 8 → 72 → 384 multiplies the exposure (card-hours) of domain-level classes alike, so AGREE weights must follow exposure, not box counts (physical boxes gave POWER ×188); Meta Sparing: 72 / 36 / 18-GPU blocks need 8.6 / 4.7 / 2.6 % spares with 3.9 / 7.8 / 9.9 % stranding'],
      ['Network architecture (multi-plane Clos / rail-optimised, OCS, optical link count, single / dual ToR, packet spraying)', 'unit counts of the network classes (CloudMatrix384: 5,376 optical links, 10,752 transceivers, 7 sub-planes × 16 L2 chips per supernode); a plane loss becomes a capacity coefficient c = (P − 1)/P instead of an interruption; eligibility of netfail / link-local / fabric-degrade', 'topology.networkPlanes, torMode, superpod (l1_switch / l2_switch / subplane / optical_link / transceiver counts); planeLossPerformance; mechanisms.netfail, R-LINK-LOCAL, R-FABRIC-DEGRADE', 'NIC / OPT / BOXIO / FABRIC carry 8.4 % of the catalog’s interruption rate (Llama 3’s switch / cable share is also 8.4 %); with a netfail rung their pause drops 264 → 2 s and they move into slack; losing one of 8 planes costs 12 % capacity, not an interruption (MRC); a TPUv4 OCS fails 0.04 % per day but its blast radius is the pod'],
      ['Pod / zone / supernode partitioning and spare-pool placement', 'unit counts and fan-out of zone-level classes (shared storage, control plane); where a job may be placed and at which level the spare pool sits (N+k supernodes); the inference replica scope', 'topology.racksPerZone; countRule.per = zone / supernode / fixed; replicaScope, ascendSupercluster; sparing (binomial P99)', 'a zone event stops the whole zone: allocate by exposure, not by 7 zone boxes (else STORAGE ×8400); spares by quantile, not ratio: a 1,024-host job needs 4 hot spares at P99 (ByteRobust)'],
      ['Power and cooling (2N / N+1 / catcher; CDU N+1; rack-level shared busbar)', 'POWER / COOL enter the allocation as residual rates after protection: parallel λ_res ≈ 2λ²·MTTR, k-of-n by CTMC; the common-cause β sets the floor of the residual', 'topology.power / cooling; redundancy{scheme, k, n, switchover}; ccf{domain, beta}; ccfLeaves', 'at 500k POWER stays a hardware task (×1.3) after every mechanism because none covers it: its mechanism is the redundancy level and β, so the allocation should hand it a β ceiling (common-cause budget), not only a FIT; the survey finds no published β'],
      ['Storage and checkpoint architecture (memory replica / local NVMe / shared tiers; bandwidth)', 'δ and the load stage → the √(2δ/M) term of the goodput budget; unit count (per zone) and FIT of the STORAGE class; parameter space of C-MEM / C-ASYNC / C-LOSSLESS', 'workload.deltaS, recovery.automatic.stages.read, C-MEM / C-ASYNC / C-LOSSLESS transforms; countRule.per = zone', 'checkpoint term ∝ √N; in ReMAP’s 口径 the constant save loss of τ = 60 s (1.64 pt) already exceeds the budget, so tiered checkpoints are the only way; STORAGE is a hardware task at 500k (×1.05, 128 FIT)'],
      ['Control plane and software (management blades / BMC, scheduler, framework, observability)', 'MGMT and UNKNOWN: no rung, only mechanisms acting on every interruption reach them; root-cause attribution splits UNKNOWN back into governable classes', 'H-CONTROL-CONTINUITY; D-RECOVERY-CLASSIFY; fit/incidents (Garwood rates); MGMT / UNKNOWN classes', 'UNKNOWN at 410 FIT is 12.3 % of the rate and the largest hardware task at 500k (×2.4 → 172 FIT); the observability architecture decides whether it can be decomposed'],
      ['Spares and repair architecture (hot-spare granularity, pool placement, repair queue, manual time)', 'blocked line P_blocked; hotswap eligibility; manual share (1 − p_s)·T_manual (72 s per event in the baseline)', 'hotSpareNodes, spareReplenishHours; resource queue X3 (architecture roadmap); recovery lever manual30', 'at 500k the 60 s automatic attempt alone reaches the target (98.99 %); replenishment time enters the blocked line; the repair queue is not modelled yet'],
    ],
    h2wp: '2. What to do next with the allocation components: work packages (details in the PLAN_V3_8 spec)',
    thWp: ['Work package', 'Content', 'Acceptance (numbers)', 'Milestone'],
    rowsWp: [
      ['WP1 Architecture-derived AGREE weights', 'exposure = units × fan-out × duty; importance = share reaching the global recovery after the chain (ChainOutcome.pGlobal); weight basis count · exposure · topology · manual on the page, CLI and MCP', 'count reproduces the three AGREE reports on the catalog; on nvl72Design the NVSwitch tray (fan-out 72) and the power feeds outrank card-level classes; importance of elastic classes = 1 − a·s to 1e-9', 'M1'],
      ['WP2 Hierarchical allocation', 'card → node → rack / supernode → zone → cluster: budget to levels by exposure, inside levels by the method, then water-filling; per level the allowed rate, MTBF, spares and the acceptance table', 'Σ levels = total budget (1e-9); equal weights reduce to flat AGREE; closure check returns 98.5 % ± 0.03 pt; the supernode-level allowed rate on ascendSupercluster agrees with its N+k result', 'M1'],
      ['WP3 Architecture options as allocation levers', 'planes, ToR, power, cooling, domain size, hot spares, checkpoint tier: per option the ledger-line shift, the change of exposure / importance per class, the iso-target point (g_eff, f); a fourth chart in the study report', 'each option’s residual rate equals the RBD / CTMC value; losing 1 of 8 planes = 12 %; the iso-target point lies within 2 % of the curve', 'M2'],
      ['WP4 Constraints', 'reachable floors (best known in the library), cost curves, common-cause budget (β* per domain)', 'classes below the floor are flagged with a mechanism / architecture alternative; β* listed with the FIT limits', 'M2'],
      ['WP5 Joint optimisation with chance constraints', 'one problem over mechanism set + parameters + hardware factors + architecture options: branch and bound (exact up to 23 items) + coordinate descent + AGREE reallocation; P(window ≥ target) ≥ 90 % as a constraint; prerequisite groups as units', 'reproduces the exact planner up to 10 candidates; 100k returns R-ELASTIC alone (effort 5, 99.07 %); D-SDC + R-SDC reachable as a group; 500k returns the Pareto front', 'M3'],
      ['WP6 Uncertainty', 'derating graded by confidence (measured / paper / vendor / derived / assumed); allocation on the upper Garwood bound; allocation tornado', 'default and graded derating side by side; bound-based factors ≥ point-estimate factors', 'M3'],
      ['WP7 Several 口径 and delivery', 'feasible intersection of A_op / delivered / effective goodput; inference replica level; report generalised to report/agreeReport.ts; acceptance-table export CSV / JSON; docs and SPEC F20–F23', '10k feasible in both 口径, 200k only in A_op (as in the current reports); hacd acceptance passes the CLI smoke test', 'M4'],
    ],
    order3: 'Suggested order WP1 → WP2 → WP4 → WP3 → WP5 → WP6 → WP7: weights from the architecture first (otherwise the later optimisation runs on the wrong budgets), then architecture options as levers, then the joint optimisation. Decisions pending: default weight basis (topology or exposure), whether architecture options also go through co-simulation, effort or cost as the objective, the graded derating values, and whether these reports are committed.',
    foot3: 'Sources: packages/core/src/scenario/build.ts (computeCounts, componentInstances, replicaScope, ccfLeaves), schema.ts (countRule, topology, superpod, blastRadius, ccf, redundancy), mechanisms/chain.ts (ChainOutcome.pGlobal), examples.ts (nvl72Design, cloudMatrix384Training, atlas950Training, ascendSupercluster); reliability chapter §2 (1/N law), §4 (parallel / k-of-n / plane loss, TPUv4 OCS, Minder), §6 (Meta Sparing block sizes, ByteRobust spares), §7 (no published β); the three AGREE reports and the hardware / mechanism split page.',
  },
};
const ARCH = {
  zh: {
    title: '架构层级 → 分配输入：单元数 n_i、扇出与共因（重要度 E_i）、可用机制（停顿 p̄_i）、工时比 t_i → 各类预算',
    cols: ['① 单元与计数 n_i（10 万卡示例）', '② 扇出与共因（E_i 的来源）', '③ 该层级可用的机制 / 冗余', '④ 对分配的后果'],
    rows: [
      ['卡 / 芯片', ['CORE、SRAM、IOD、HBM、NIC、光模块：每卡 1–14 个单元', '10 万卡 = 10 万单元 / 类'], ['同步训练：任一事件停整个作业', '扇出 1 卡；无共因'], ['重执行、进程重调度、DP 弹性、热替换', '预测迁移、静默错误检测'], ['梯级最多：停顿 264 → 5–60 s', '预算余量最大，再分配给上层']],
      ['节点 / 服务器', ['CPU、DDR、SSD、BMC：每节点 1 个', '12,500 节点（8 卡 / 节点）'], ['扇出 8 卡（NVL72 托盘 4 卡）', 'β：主机电源、固件批量升级'], ['进程重调度、热备节点', '预热进程、运行时快照'], ['按箱数计预算缩小 8 倍', '按暴露量（卡·小时）计与卡级相同']],
      ['机柜 · 超节点 · Pod', ['交换托盘、L1 / L2 芯片、机柜供电', '391 机柜；CloudMatrix384 = 261 超节点'], ['扇出 32–384 卡（NVL72 72 卡）', 'β：母线 / manifold / OCS（TPUv4：OCS 爆炸半径 = pod）'], ['弹性域 = 备件粒度；N+k 超节点', '控制面连续、网络绕行'], ['暴露量 ∝ 扇出：域级类权重放大', '备件 8.6 / 4.7 / 2.6 %（72 / 36 / 18 卡块）']],
      ['网络平面 · 分区', ['平面 7–8，分区 7；光链路 5,376 / 超节点', '按 plane / zone / optical_link 计数'], ['丢一面 = 容量 (P−1)/P，不停机', 'ToR 单上联 = 单点；双上联 = 并联'], ['多平面降级（R-FABRIC-DEGRADE）', '容错集合通信（R-NETFAIL）、链路本地恢复'], ['预算从停机行移到降速行', 'ToR / 平面的限值变成 β 与 k-of-n 限值']],
      ['机房设施 · 存储 · 控制面', ['供电馈线 2 条、CDU 6 模块、存储节点按分区', '调度器 / 框架 = 1'], ['扇出 = 整集群或整分区', 'β 无公开值（综述开放问题）'], ['2N / N+1 冗余、穿越；存储多路径', '根因归类（UNKNOWN → 可治理类）'], ['无梯级：方案后仍是硬件任务', '分配给 β 上限与冗余等级，而非 FIT']],
    ],
    legend: 'n_i 单元数 · E_i 重要度（链后到达全局恢复的份额 pGlobal）· t_i 工时比（通信相、保存窗口）· 预算 pt_i* = U_free · n_i E_i t_i / Σ_j n_j E_j t_j',
  },
  en: {
    title: 'Architectural level → allocation inputs: unit count n_i, fan-out and common cause (importance E_i), available mechanisms (pause p̄_i), duty t_i → class budgets',
    cols: ['① Units and counts n_i (100k example)', '② Fan-out and common cause (source of E_i)', '③ Mechanisms / redundancy at this level', '④ Consequence for the allocation'],
    rows: [
      ['Card / chip', ['CORE, SRAM, IOD, HBM, NIC, optics: 1–14 units per card', '100k cards = 100k units per class'], ['synchronous training: any event stops the job', 'fan-out 1 card; no common cause'], ['replay, process rescheduling, DP elasticity, hot swap', 'predictive migration, silent-corruption detection'], ['most rungs: pause 264 → 5–60 s', 'largest slack, reallocated upwards']],
      ['Node / server', ['CPU, DDR, SSD, BMC: 1 per node', '12,500 nodes (8 cards per node)'], ['fan-out 8 cards (NVL72 tray 4)', 'β: host PSU, batch firmware upgrades'], ['process rescheduling, hot-spare nodes', 'warm processes, runtime snapshots'], ['box count shrinks the budget 8×', 'exposure (card-hours) equals the card level']],
      ['Rack · supernode · pod', ['switch trays, L1 / L2 chips, rack power', '391 racks; CloudMatrix384 = 261 supernodes'], ['fan-out 32–384 cards (NVL72: 72)', 'β: busbar / manifold / OCS (TPUv4: OCS blast radius = pod)'], ['elastic domain = spare granularity; N+k supernodes', 'control-plane continuity, fabric reroute'], ['exposure ∝ fan-out: domain classes gain weight', 'spares 8.6 / 4.7 / 2.6 % (72 / 36 / 18-GPU blocks)']],
      ['Network planes · zones', ['planes 7–8, zones 7; 5,376 optical links per supernode', 'counted per plane / zone / optical_link'], ['one plane lost = capacity (P−1)/P, no stop', 'single ToR = single point; dual = parallel'], ['multi-plane degrade (R-FABRIC-DEGRADE)', 'fault-tolerant collectives (R-NETFAIL), link-local recovery'], ['budget moves from downtime to slowdown', 'ToR / plane limits become β and k-of-n limits']],
      ['Facility · storage · control plane', ['2 power feeds, 6 CDU modules, storage per zone', 'scheduler / framework = 1'], ['fan-out = whole cluster or zone', 'no published β (survey open problem)'], ['2N / N+1 redundancy, ride-through; storage multipath', 'root-cause attribution (UNKNOWN → governable classes)'], ['no rung: still a hardware task after the plan', 'allocate a β ceiling and a redundancy level, not a FIT']],
    ],
    legend: 'n_i unit count · E_i importance (share reaching the global recovery after the chain, pGlobal) · t_i duty (communication phases, save windows) · budget pt_i* = U_free · n_i E_i t_i / Σ_j n_j E_j t_j',
  },
};
function figureArch(lang) {
  const A = ARCH[lang];
  const W = 960, labelW = 112, x0 = 14, gap = 8, lh = 13.5;
  const colW = Math.floor((W - 2 * x0 - labelW - 4 * gap) / 4);
  const tw = (t, mono) => Array.from(t).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 10.2 : mono ? 6.2 : 5.6), 0);
  const wrap = (t, maxW) => { const lines = []; let cur = ''; for (const tok of t.split(/(\s+)/)) { if (/^\s+$/.test(tok)) { cur += tok; continue; } if (tw(cur + tok) <= maxW) { cur += tok; continue; } if (cur.trim()) lines.push(cur.trim()); cur = ''; if (tw(tok) > maxW) { let piece = ''; for (const ch of Array.from(tok)) { if (tw(piece + ch) > maxW && piece) { lines.push(piece); piece = ch; } else piece += ch; } cur = piece; } else cur = tok; } if (cur.trim()) lines.push(cur.trim()); return lines; };
  const fills = ['b1', 'b2', 'b4', 'b3', 'b5'];
  let g = `<svg class="viz" id="fig-arch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} HEIGHT" width="100%" role="img" aria-label="${esc(A.title)}"><style>${STYLE} svg.viz .c { font-size: 10.2px; fill: var(--ink2); } svg.viz .rh { font-size: 11.5px; font-weight: 700; }</style><rect width="${W}" height="HEIGHT" fill="var(--surface)" rx="8"/>`;
  g += `<text x="14" y="20" class="ttl">${esc(A.title)}</text>`;
  let y = 44;
  const heads = A.cols.map((c) => wrap(c, colW - 10));
  const hn = Math.max(...heads.map((h) => h.length));
  heads.forEach((lines, i) => { lines.forEach((ln, j) => { g += `<text x="${x0 + labelW + gap + i * (colW + gap) + 6}" y="${y + j * 13}" class="t2" style="font-weight:600;font-size:10.8px">${esc(ln)}</text>`; }); });
  y += 10 + (hn - 1) * 13;
  // rows bottom-up in the architecture, drawn top-down from facility to card? keep card first (reads with the text)
  A.rows.forEach((row, ri) => {
    const cells = row[1 + 0] ? row.slice(1).map((lines) => lines.flatMap((ln) => wrap(ln, colW - 12))) : [];
    const n = Math.max(...cells.map((c) => c.length));
    const h = 10 + n * lh + 4;
    g += `<rect x="${x0}" y="${y}" width="${labelW}" height="${h}" rx="6" fill="var(--${fills[ri]})" class="box"/>`;
    wrap(row[0], labelW - 12).forEach((ln, i) => { g += `<text x="${x0 + 6}" y="${y + 17 + i * 14}" class="rh">${esc(ln)}</text>`; });
    cells.forEach((lines, ci) => {
      const cx = x0 + labelW + gap + ci * (colW + gap);
      g += `<rect x="${cx}" y="${y}" width="${colW}" height="${h}" rx="6" fill="var(--${fills[ri]})" class="box" opacity="0.75"/>`;
      lines.forEach((ln, i) => { g += `<text x="${cx + 6}" y="${y + 15 + i * lh}" class="c">${esc(ln)}</text>`; });
    });
    y += h + 6;
  });
  const leg = wrap(A.legend, W - 40);
  const ry = y + 2, rh = 8 + leg.length * 15;
  g += `<rect x="14" y="${ry}" width="${W - 28}" height="${rh}" rx="7" fill="var(--mid)"/>` + leg.map((ln, i) => `<text x="${W / 2}" y="${ry + 16 + i * 15}" text-anchor="middle" class="f" style="font-size:10.8px">${esc(ln)}</text>`).join('');
  const H = ry + rh + 10;
  return (g + '</svg>').replace(/HEIGHT/g, String(H));
}

const CSS = `
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
  main { max-width: 1120px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 22px 26px 26px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 22px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 16px; font-weight: 600; margin: 14px 0 6px; padding-top: 8px; border-top: 1px solid var(--rule); }
  h2.first { border-top: none; padding-top: 0; margin-top: 4px; }
  p { margin: 5px 0; } .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 6px; }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
  .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.8px; overflow-wrap: anywhere; }
  footer, .eyebrow, p, h1, h2, .callout, td, th { overflow-wrap: anywhere; }
  .small { font-size: 11.3px; color: var(--muted); }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.8px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3.5px 6px; text-align: left; vertical-align: top; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.3px; }
  td.k { font-weight: 600; white-space: nowrap; } td.f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.3px; }
  figure.chart { margin: 8px 0 10px; } figure.chart svg { display: block; width: 100%; height: auto; } figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 14px; }
  .box { background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; padding: 7px 11px; }
  .box h3 { margin: 0 0 4px; font-size: 12.5px; } .box ol { margin: 2px 0 2px; padding-left: 16px; } .box li { margin: 2px 0; font-size: 12px; }
  ul.pts { margin: 4px 0; padding-left: 18px; } ul.pts li { margin: 3px 0; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; }
  @media screen and (max-width: 760px) { .grid3 { grid-template-columns: 1fr; } .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 640px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.4px; line-height: 1.34; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7.1px; line-height: 1.26; } th, td { padding: 1.2px 3px; } th { font-size: inherit; } td.f { font-size: 6.9px; }
    code { font-size: 7px; } .small { font-size: 6.9px; } .callout, .sub, footer { font-size: 7.4px; } .callout { margin: 3px 0; padding: 3px 7px; } footer { font-size: 6.9px; }
    h1 { font-size: 14px; margin: 2px 0 3px; } h2 { font-size: 10.5px; margin: 4px 0 2px; padding-top: 3px; } .eyebrow { font-size: 7.5px; }
    figure.chart { margin: 2px 0 2px; } figure.chart svg { height: FIGH; } figcaption { font-size: 7.2px; margin-top: 0; }
    .grid3 { gap: 4px 8px; } .box { padding: 3px 7px; } .box h3 { font-size: 8.2px; margin-bottom: 2px; } .box ol { padding-left: 11px; } .box li { font-size: 7.1px; margin: 1px 0; }
    ul.pts { padding-left: 12px; margin: 2px 0; } ul.pts li { margin: 1px 0; font-size: 7.6px; }
    p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    table.fut { font-size: FUTF; line-height: 1.28; } table.fut th, table.fut td { padding: 2px 3.5px; }
    figure.chart.arch svg { height: ARCHH; } table.arch { font-size: ARCHF; line-height: 1.24; } table.arch th, table.arch td { padding: 1.5px 3px; } table.arch td.f { font-size: ARCHFM; } table.wp { font-size: WPF; line-height: 1.24; } table.wp th, table.wp td { padding: 1.5px 3px; }
  }
`;

function page(lang) {
  const L = T[lang];
  const fig = figure(lang);
  writeFileSync(`docs/allocation-methods/fig-allocation-loop.${lang}.svg`, fig);
  const L3 = T3[lang];
  const figA = figureArch(lang);
  writeFileSync(`docs/allocation-methods/fig-architecture-levels.${lang}.svg`, figA);
  const row = (r) => `<tr><td class="k">${esc(r[0])}</td><td class="f">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`;
  const html = `<!doctype html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(L.tab)}</title>
<meta name="description" content="${esc(L.desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${CSS.replace('FIGH', lang === 'zh' ? '296px' : '272px').replace('FUTF', lang === 'zh' ? '8.2px' : '7.6px').replace('ARCHH', lang === 'zh' ? '262px' : '262px').replace('ARCHF', lang === 'zh' ? '7.1px' : '6.6px').replace('ARCHFM', lang === 'zh' ? '6.6px' : '6.2px').replace('WPF', lang === 'zh' ? '7.2px' : '6.7px')}</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">${esc(L.eyebrow1)}</div>
  <h1>${esc(L.title)}</h1>
  <p class="sub">${L.intro}</p>
  <figure class="chart">${fig}<figcaption>${esc(L.figCap)}</figcaption></figure>
  <h2 class="first">${esc(L.h2a)}</h2>
  <div class="table-wrap"><table><tr>${L.th.map((h, i) => `<th style="width:${[12, 50, 15, 23][i]}%">${esc(h)}</th>`).join('')}</tr>${L.rows.map(row).join('')}</table></div>
  <h2>${esc(L.h2b)}</h2>
  <div class="grid3">${L.alg.map(([h, steps]) => `<div class="box"><h3>${esc(h)}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`).join('')}</div>
  <h2>${esc(L.h2c)}</h2>
  <ul class="pts">${L.points.map((p) => `<li>${p}</li>`).join('')}</ul>
  <footer>${L.foot1}</footer>
</section>
<section class="page" id="p2">
  <div class="eyebrow">${esc(L.eyebrow2)}</div>
  <h1>${esc(L.title2)}</h1>
  <p class="sub">${L.intro2}</p>
  <div class="table-wrap"><table class="fut"><tr>${L.th2.map((h, i) => `<th style="width:${[11, 29, 36, 18, 6][i]}%">${esc(h)}</th>`).join('')}</tr>${L.rows2.map((r) => `<tr><td class="k" style="white-space:normal">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${r[3]}</td><td>${esc(r[4])}</td></tr>`).join('')}</table></div>
  <div class="callout">${esc(L.order)}</div>
  <footer>${L.foot2}</footer>
</section>
<section class="page" id="p3">
  <div class="eyebrow">${esc(L3.eyebrow3)}</div>
  <h1>${esc(L3.title3)}</h1>
  <p class="sub">${L3.intro3}</p>
  <figure class="chart arch">${figA}<figcaption>${esc(L3.figCap3)}</figcaption></figure>
  <h2 class="first">${esc(L3.h2arch)}</h2>
  <div class="table-wrap"><table class="arch"><tr>${L3.thArch.map((h, i) => `<th style="width:${[15, 27, 24, 34][i]}%">${esc(h)}</th>`).join('')}</tr>${L3.rowsArch.map((r) => `<tr><td class="k" style="white-space:normal">${esc(r[0])}</td><td>${esc(r[1])}</td><td class="f">${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</table></div>
  <h2>${esc(L3.h2wp)}</h2>
  <div class="table-wrap"><table class="wp"><tr>${L3.thWp.map((h, i) => `<th style="width:${[16, 40, 36, 8][i]}%">${esc(h)}</th>`).join('')}</tr>${L3.rowsWp.map((r) => `<tr><td class="k" style="white-space:normal">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</table></div>
  <div class="callout">${esc(L3.order3)}</div>
  <footer>${L3.foot3}</footer>
</section>
</main>
</body>
</html>
`;
  const out = `docs/ALLOCATION_METHODS_SUMMARY.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
page('zh');
page('en');
