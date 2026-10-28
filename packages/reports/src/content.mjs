/**
 * Text content of docs/ASCEND_ALLOCATION_METHODOLOGY.html (zh / en): scope and 口径, formulas (LaTeX), the layer model, the ReMAP
 * mechanism hierarchy narrative, the hierarchical MTBF / MTTR budgeting method, and the HAC-D tooling table with the agent-module
 * verdict. v5: `contentFor(ctx)` fills every data-dependent phrase (target, scales, the records' names and pod sizes, the mechanism
 * counts of the set, window trials, derating margins, lever limits, permutations, decision scale, threshold, engine version) so the
 * page reads correctly for any record set; the constants exported below are `contentFor(DEFAULT_CTX)` for the v4.4 report set.
 * The recipe (methodology.mjs, methodologyHtml) lays this out; numbers come from the results / mechanisms JSON.
 */
const L = (zh, en) => ({ zh, en });
const num = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const kNz = (n) => `${num(n / 10000, 0)} 万`, kNe = (n) => `${num(n / 1000, 0)}k`;
const ZH_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const EN_NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const zhCount = (n, unit) => (n <= 12 ? `${ZH_NUM[n]}${unit}` : `${n} ${unit}`), enCount = (n) => (n <= 12 ? EN_NUM[n] : String(n));
const join = (xs, zh) => xs.join(zh ? '、' : ', ');

/** the v4.4 report set (four records, ReMAP-latest set, 98.5 % at 10k–500k) */
export const DEFAULT_CTX = {
  target: 0.985, sizes: [10000, 100000, 200000, 500000], main: 500000, trials: 400, requiredP: 0.9,
  derate: { coverageDelta: 0.05, successDelta: 0.08, timeFactor: 1.5, reductionFactor: 0.5 },
  levers: [{ id: 'auto', limit: 60, effort: 3 }, { id: 'success', limit: 0.999, effort: 3 }, { id: 'manual', limit: 1800, effort: 2 }],
  reference: ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'], candidates: 7,
  archs: [
    { id: 'native950', short: L('原生 950', 'Native 950'), name: L('华为原生 Atlas 950 超节点（1,024 NPU）', 'Huawei native Atlas 950 SuperPoD (1,024 NPUs)'), podNpus: 1024, superpodUnit: 'supernodes', cabinetNpus: 64, nodeNpus: 8, cpusPerNode: 2 },
    { id: 'ubl128', short: L('UBL128', 'UBL128'), name: L('SuperPoD Flex / UBL128（128 NPU，单层 UB 交换）', 'SuperPoD Flex / UBL128 (128 NPUs, single-layer UB switch)'), podNpus: 128, superpodUnit: 'supernodes', cabinetNpus: 64, nodeNpus: 8, cpusPerNode: 2 },
    { id: 'cm384', short: L('CM384', 'CM384'), name: L('Atlas 900 A3 超节点 / CloudMatrix384（384 NPU，两级 UB 交换）', 'Atlas 900 A3 SuperPoD / CloudMatrix384 (384 NPUs, two-level UB switching)'), podNpus: 384, superpodUnit: 'supernodes', cabinetNpus: 32, nodeNpus: 8, cpusPerNode: 4 },
    { id: 'a3server', short: L('800T A3', '800T A3'), name: L('Atlas 800T A3 服务器集群（8 NPU / 台，跨机 RoCE）', 'Atlas 800T A3 server cluster (8 NPUs per server, RoCE between servers)'), podNpus: 8, superpodUnit: 'nodes', cabinetNpus: 32, nodeNpus: 8, cpusPerNode: 4 },
  ],
  originals: 8, extensions: 15, capabilities: ['I-CONTAIN'], players: 23, permutations: 300, halfWidthPt: 0.25, decisionScale: 500000, threshold: 0.0015,
  engine: '0.5.0',
};

/** the Methodology prose for a report set; every phrase that depends on the data is filled from `ctx` (see DEFAULT_CTX for the fields) */
export function contentFor(c = DEFAULT_CTX) {
  const A = num(c.target * 100, 1), nA = c.archs.length, nS = c.sizes.length;
  const S0 = Math.min(...c.sizes), S1 = Math.max(...c.sizes);
  const RANGE = L(S0 === S1 ? kNz(S0) : `${kNz(S0)}–${kNz(S1)}`, S0 === S1 ? kNe(S0) : `${kNe(S0)}–${kNe(S1)}`);
  const NARCH = L(zhCount(nA, '种'), enCount(nA));
  const DEC = L(kNz(c.decisionScale), kNe(c.decisionScale));
  const thr = num(c.threshold * 100, 2);
  const D = c.derate;
  const lever = (id) => c.levers.find((l) => l.id === id);
  const leverTxt = L(
    [lever('auto') && `自动尝试 ≥ ${num(lever('auto').limit, 0)} s`, lever('success') && `自动成功 ≤ ${num(lever('success').limit * 100, 1)} %`, lever('manual') && `人工 ≥ ${num(lever('manual').limit / 60, 0)} min`].filter(Boolean).join('、'),
    [lever('auto') && `automatic attempt ≥ ${num(lever('auto').limit, 0)} s`, lever('success') && `automatic success ≤ ${num(lever('success').limit * 100, 1)} %`, lever('manual') && `manual ≥ ${num(lever('manual').limit / 60, 0)} min`].filter(Boolean).join(', '),
  );
  const leverEff = c.levers.map((l) => l.effort).join(' / ');
  const podTxt = (a, zh) => (a.superpodUnit === 'nodes' ? (zh ? `${a.short.zh}：一台服务器（${num(a.podNpus, 0)} 卡）` : `${a.short.en}: one server (${num(a.podNpus, 0)} NPUs)`) : zh ? `${a.short.zh}：${num(a.podNpus, 0)} 卡` : `${a.short.en}: ${num(a.podNpus, 0)}`);
  const uniq = (xs) => [...new Set(xs)].sort((x, y) => y - x);
  const cabs = uniq(c.archs.map((a) => a.cabinetNpus)), cpus = uniq(c.archs.map((a) => a.cpusPerNode)), nodes = uniq(c.archs.map((a) => a.nodeNpus));
  const or = (xs, zh) => xs.map((x) => num(x, 0)).join(zh ? ' 或 ' : ' or ');
  const topoList = L(c.archs.map((a) => `${a.name.zh}${a.superpodUnit === 'nodes' ? `（UB 域 = ${num(a.podNpus, 0)} NPU）` : ''}`).join('、'), c.archs.map((a) => `${a.name.en}${a.superpodUnit === 'nodes' ? ` (UB domain = ${num(a.podNpus, 0)} NPUs)` : ''}`).join(', '));
  const caps = L(join(c.capabilities, true), join(c.capabilities, false));
  const capPhrase = L(c.capabilities.length ? `（加 ${caps.zh} 能力）` : '', c.capabilities.length ? ` (plus the ${caps.en} capabilit${c.capabilities.length > 1 ? 'ies' : 'y'})` : '');

  const TITLE = L('昇腾集群可用度分配：方法', 'Ascend cluster availability allocation: methodology');
  const SUBTITLE = L(`目标 A_op ≥ ${A} %（30 天窗口、一个同步训练作业）在 ${RANGE.zh}卡、${NARCH.zh}拓扑上的分配方法：HAC-D 单元口径的失效率、ReMAP 机制集的分层与取舍、MTBF / MTTR 的逐层预算与三重校核。结果见各拓扑的 Findings 文件与 ${kNe(c.main).replace('k', '')}k BOM 表。`.replace(`${kNe(c.main).replace('k', '')}k BOM`, 'BOM'), `How the goal A_op ≥ ${A} % (30-day window, one synchronous training job) is allocated at ${RANGE.en} NPUs on ${NARCH.en} topologies: HAC-D’s per-unit failure rates, the ReMAP mechanism set categorised and pruned, hierarchical MTBF / MTTR budgets and the three checks. Results are in the per-topology Findings files and the BOM table.`);

  /* ---------------- 1. scope and 口径 ---------------- */
  const SCOPE = {
    heading: L('1. 范围与口径', '1. Scope and 口径'),
    items: [
      L(`<b>目标</b>：一个同步训练作业在 30 天窗口上的运行可用度 A_op ≥ A* = ${A} %，名义参数、全部机制降额（覆盖 −${num(D.coverageDelta * 100, 0)} pt、成功 −${num(D.successDelta * 100, 0)} pt、时间 ×${D.timeFactor}、发生率改善 ×${D.reductionFactor}）与逐窗口（${num(c.trials, 0)} 个窗口，Wilson 95 % 下界 ≥ ${num(c.requiredP * 100, 0)} %）三重满足。`, `<b>Goal</b>: operational availability A_op ≥ A* = ${A} % for one synchronous training job over a 30-day window, met nominally, with every mechanism derated (coverage −${num(D.coverageDelta * 100, 0)} pt, success −${num(D.successDelta * 100, 0)} pt, times ×${D.timeFactor}, rate improvements ×${D.reductionFactor}) and window by window (${num(c.trials, 0)} windows, Wilson 95 % lower bound ≥ ${num(c.requiredP * 100, 0)} %).`),
      L('<b>失效率口径</b>：HAC-D 单元口径——ReMAP / ai-cluster-reliability 的 54 类事件目录按 CloudMatrix384 几何换算到每个硬件单元（NPU、CPU、节点、计算柜、UB 交换芯片、UB 光链路、作业级），再乘各拓扑自己的单元数；跨超节点网络的交换机与光链路用 UB 单元的类比值（@roce，置信度 assumed）。每类事件只归一个单元、一个层级。失效率覆盖记录（FaultRateOverride）可按单元或按卡替换任一类的值并带入其置信度。', '<b>Failure-rate basis</b>: HAC-D per unit — the 54-event ReMAP / ai-cluster-reliability catalog converted to each hardware unit (NPU, CPU, node, cabinet, UB switch chip, UB optical link, job level) through the CloudMatrix384 geometry, then multiplied by each topology’s own unit counts; scale-out switches and links use the UB units’ analogue values (@roce, confidence assumed). Every event class belongs to exactly one unit and one layer. A failure-rate override record replaces any class per unit or per card and carries its confidence into the tables.'),
      L('<b>事件类不相加</b>：硬中断（经机制链）、亚健康隔离、静默损坏检出与漏检、误报各自保留速率与暂停；A_op 的分母是集群·小时。', '<b>Event classes stay apart</b>: hard interruptions (through the mechanism chain), isolation of sub-healthy units, detected and undetected silent corruption and false alarms each keep their own rate and pause; the denominator of A_op is the cluster-hour.'),
      L(`<b>机制集</b>：ReMAP 的${zhCount(c.reference.length, '个')}参考机制（${join(c.reference, true)}）在每个设计的基线里；ReMAP 最新扩展按第 4 节的规则分层取舍，${zhCount(c.candidates, '个')} A_op 候选进入分配；R-CKPT / R-MANUAL 以${zhCount(c.levers.length, '个')}恢复杠杆参与（${leverTxt.zh}）。`, `<b>Mechanism set</b>: ReMAP’s ${enCount(c.reference.length)} reference mechanisms (${join(c.reference, false)}) are in every design’s baseline; the latest ReMAP extensions are categorised and pruned by the rule of Section 4, ${enCount(c.candidates)} A_op candidates enter the allocation; R-CKPT / R-MANUAL take part as ${enCount(c.levers.length)} recovery levers (${leverTxt.en}).`),
      L(`<b>拓扑</b>：${topoList.zh}；几何与假设见 BOM 表与各记录的 provenance 字段。`, `<b>Topologies</b>: ${topoList.en}; geometry and assumptions in the BOM table and each record’s provenance field.`),
    ],
  };

  /* ---------------- 2. formulas ---------------- */
  const FORMULAS = {
    heading: L('2. 公式', '2. Formulas'),
    blocks: [
      { tex: String.raw`A_{\mathrm{op}}=\frac{1-\varphi}{1+\dfrac{\mathrm{MTTR}_{\mathrm{hw}}}{\mathrm{MTBF}_{\mathrm{hw}}}+\sum_k\dfrac{\mathrm{MTTR}_k}{\mathrm{MTBF}_k}},\qquad \mathrm{MTBF}_{\mathrm{hw}}=\frac{1}{\sum_i\lambda_i},\quad \mathrm{MTTR}_{\mathrm{hw}}=\frac{\sum_i\lambda_i\,\bar t_i}{\sum_i\lambda_i},\quad \lambda_i=n_i\cdot\mathrm{FIT}_i\cdot10^{-9}\ \mathrm{h}^{-1}\tag{1}`, note: L('硬中断类 i 的速率 λᵢ = 单元数 nᵢ × 单元 FIT；t̄ᵢ 为机制链上的平均暂停；k 遍历其他事件类（隔离、静默检出、误报）；φ 为静默损坏的时间份额。MTBF 为集群级（整个作业）的间隔，MTTR 以秒计、按速率加权。', 'λᵢ = units nᵢ × FIT per unit of hard class i; t̄ᵢ its mean pause down the mechanism chain; k runs over the other event classes (isolation, detected silent corruption, false alarms); φ the silent-corruption time share. MTBF is the cluster-level (whole-job) interval, MTTR in seconds, rate-weighted.') },
      { tex: String.raw`\frac{\mathrm{MTTR}_{\mathrm{hw}}}{\mathrm{MTBF}_{\mathrm{hw}}}\le B=3600\Bigl(\frac{1-\varphi}{A^{\ast}}-1\Bigr)-F,\qquad \mathrm{MTBF}_{\mathrm{hw}}^{\mathrm{req}}=\frac{\mathrm{MTTR}_{\mathrm{hw}}}{B},\quad \mathrm{MTTR}_{\mathrm{hw}}^{\mathrm{req}}=B\cdot\mathrm{MTBF}_{\mathrm{hw}}\tag{2}`, note: L('系统级要求：B 为每小时允许的硬中断暂停秒数（降额设计上取值，它是约束的一侧），F = Σ_k MTTR_k/MTBF_k × 3600 为其他事件类的暂停。“今天 MTTR 下需要的 MTBF”与“今天 MTBF 下需要的 MTTR”是同一要求的两个端点；B ≤ 0 时 F 与 φ 已占满预算，仅靠硬件不可达，两个端点不存在。', 'System-level requirement: B is the hard-interruption pause allowed per hour (taken on the derated design, the binding side), F = Σ_k MTTR_k/MTBF_k × 3600 the pause of the other classes. “MTBF needed at today’s MTTR” and “MTTR needed at today’s MTBF” are the two ends of the same requirement; when B ≤ 0, F and φ take the whole budget, the target is out of reach by hardware alone and the two ends do not exist.') },
      { tex: String.raw`C_\ell=\sum_{i\in\ell}\lambda_i\,\bar t_i,\qquad U_\ell=\frac{C_\ell}{3600\,D},\quad D=1+\frac{\sum_\ell C_\ell+F}{3600},\qquad \mathrm{MTBF}_\ell^{\mathrm{inst}}=\frac{m_\ell}{\sum_{i\in\ell}\lambda_i},\quad \mathrm{MTTR}_\ell=\frac{C_\ell}{\sum_{i\in\ell}\lambda_i}\tag{3}`, note: L('层级预算：每层 ℓ 的暂停贡献 C_ℓ、不可用度份额 U_ℓ（A_op 的百分点，Σ_ℓ U_ℓ + U_其他 = 1 − A_op）、按实例的 MTBF（m_ℓ 为该层实例数：超节点数、计算柜数、节点数、卡数；集群与跨超节点网络各 1）和该层的 MTTR。', 'Layer budget: each layer ℓ’s pause contribution C_ℓ, unavailability share U_ℓ (points of A_op, Σ_ℓ U_ℓ + U_other = 1 − A_op), MTBF per instance (m_ℓ instances: SuperPoDs, cabinets, nodes, cards; 1 for the cluster and the scale-out network) and the layer’s MTTR.') },
      { tex: String.raw`\mathrm{FIT}_u^{\ast}=k\,\mathrm{FIT}_u,\qquad \mathrm{MTBF}_u^{\ast}=\frac{10^{9}}{\mathrm{FIT}_u^{\ast}},\qquad k\approx\frac{B}{\sum_i c_i}\ (\text{ARINC}),\qquad E=\sum_{m\in\mathcal{M}}e_m+\sum_{j\in\mathcal{S}}e_j+\sum_i 2\log_2\frac{1}{x_i}\tag{4}`, note: L(`单元预算与方案努力：所有中断类同乘 k（ARINC；cᵢ = λᵢ t̄ᵢ 为今天的贡献），k > 1 是验收上限、k < 1 是交付任务。k 取引擎上 A_op,降额(k) = A* 的二分根：φ 随 k 经静默损坏窗口微变，闭式 B/Σcᵢ（φ 取 k = 1 的值）是一阶近似，与根相差约 1e-5（金标准 G5 固定两者）。E 为方案的总努力——机制 m（库中努力 eₘ）、杠杆 j（${leverEff}）与硬件（每减半努力 2，下限 × 0.05）。HAC-D 最优策略在候选机制与杠杆的全部子集上取 E 最小，硬件按 ARINC 补齐。`, `Unit budget and plan effort: every interruption class × k (ARINC; cᵢ = λᵢ t̄ᵢ today’s contribution), k > 1 an acceptance ceiling, k < 1 a delivery task. k is the engine’s bisection root of A_op,derated(k) = A*: φ moves with k through the silent-corruption window, so the closed form B/Σcᵢ (φ at k = 1) is a first-order approximation within about 1e-5 of the root (golden G5 pins both). E is the plan’s total effort — mechanisms m (library effort eₘ), levers j (${leverEff}) and hardware (effort 2 per halving, floor × 0.05). HAC-D’s optimal strategy minimises E over every subset of the candidate mechanisms and levers, the hardware closing the gap by ARINC.`) },
      { tex: String.raw`\bar t_i=\sum_{r}p_{i,r}\,t_{i,r},\qquad t_{i,\mathrm{global}}=t_{\mathrm{det}}+\sum_{\text{failed rungs}}t_f+t_{\mathrm{auto}}+(1-p_{\mathrm{succ}})\,t_{\mathrm{manual}},\qquad t_{\mathrm{auto}}=t_{\mathrm{startup}}+t_{\mathrm{read}}+t_{\mathrm{comm}}\tag{5}`, note: L('机制链：第 i 类中断在各梯级 r 结束的概率 p_{i,r}（透明梯级 R-LINK-LOCAL / R-FABRIC-DEGRADE / H-CONTROL-CONTINUITY 不等检测，重执行、弹性、进程各自等检测并累计失败耗时，最后全局恢复）；全局恢复 = 检测 + 失败梯级 + 自动尝试（启动、读取检查点、通信重建三个阶段）+ 人工兜底的概率份额。同一阶段上的机制取最小值，不相加。', 'The chain: the probability p_{i,r} that class i ends at rung r (transparent rungs R-LINK-LOCAL / R-FABRIC-DEGRADE / H-CONTROL-CONTINUITY skip the detection delay; replay, elastic and process each wait for detection and accumulate failed attempts; the global recovery last); global recovery = detection + failed rungs + the automatic attempt (startup, checkpoint read, communication rebuild) + the probability share of the manual fallback. Mechanisms on one stage take the minimum, never the sum.') },
      { tex: String.raw`\Pr\bigl(A_{\mathrm{op}}^{(30\,\mathrm{d})}\ge A^{\ast}\bigr)\ \text{Wilson}_{95\,\%}^{\mathrm{low}}\ge ${num(c.requiredP, 1)}\ (${num(c.trials, 0)}\ \text{windows}),\qquad \phi_m=\sum_{\mathcal{S}\subseteq\mathcal{M}\setminus\{m\}}\frac{|\mathcal{S}|!\,(|\mathcal{M}|-|\mathcal{S}|-1)!}{|\mathcal{M}|!}\bigl[v(\mathcal{S}\cup\{m\})-v(\mathcal{S})\bigr]\tag{6}`, note: L(`逐窗口校核与 Shapley 值：窗口账本按运行时钟抽样事件、按机制链判定结局；φₘ 为机制 m 对 A_op（或有效产出）的 Shapley 贡献，${c.players} 个机制用 ${num(c.permutations, 0)} 个置换抽样（半宽 ≤ ${num(c.halfWidthPt, 2)} 点）。`, `Window check and Shapley value: the window ledger samples events on the running clock and settles each on the chain; φₘ is mechanism m’s Shapley contribution to A_op (or delivered goodput), sampled with ${num(c.permutations, 0)} permutations for the ${c.players} mechanisms (half-width ≤ ${num(c.halfWidthPt, 2)} pt).`) },
    ],
  };

  /* ---------------- 3. layers ---------------- */
  const LAYERS_TEXT = {
    heading: L('3. 层级模型', '3. The layer model'),
    intro: L('六个层级按故障单元划分（每类事件只归一层）；“实例”是验收对象，拓扑决定它的大小与数量。', 'Six layers by fault unit (each event class on one layer); the “instance” is the acceptance object, whose size and count the topology sets.'),
    rows: [
      { id: 'cluster', units: 'job', classes: 'STORAGE · UNKNOWN', instance: L('整个作业（1 个）', 'the whole job (1)'), delivered: L('作业级服务：共享存储、调度、软件栈', 'job-level services: shared storage, scheduler, software stack') },
      { id: 'scaleout', units: 'roce-switch · roce-link', classes: 'FABRIC@roce · OPT@roce', instance: L('整张跨超节点网络（1 个）；交换机与光链路另按单元验收', 'the whole scale-out network (1); switches and links also accepted per unit'), delivered: L('RoCE / UBoE 交换机与光模块', 'RoCE / UBoE switches and optical modules') },
      { id: 'superpod', units: 'ub-switch · ub-link', classes: 'FABRIC · OPT', instance: L(`一个超节点 / UB 域（${c.archs.map((a) => podTxt(a, true)).join('；')}）`, `one SuperPoD / UB domain (${c.archs.map((a) => podTxt(a, false)).join('; ')})`), delivered: L('UB 交换芯片（LRS、交换柜、L1 / L2）与光链路', 'UB switch chips (LRS, switch cabinets, L1 / L2) and optical links') },
      { id: 'cabinet', units: 'cabinet', classes: 'POWER · COOL', instance: L(`一个计算柜（${or(cabs, true)} 卡）`, `one compute cabinet (${or(cabs, false)} NPUs)`), delivered: L('供电、液冷', 'power, cooling') },
      { id: 'node', units: 'node · cpu', classes: 'BOXIO · DDR · SSD · MGMT · CPU', instance: L(`一个节点（${or(nodes, true)} 卡 + ${or(cpus, true)} CPU）`, `one node (${or(nodes, false)} NPUs + ${or(cpus, false)} CPUs)`), delivered: L('节点板、内存、本地盘、管理控制器、CPU', 'node board, memory, local disks, management controller, CPUs') },
      { id: 'npu', units: 'npu', classes: 'CORE · SRAM · IOD · MODULE · MEMT · MEMP · NIC', instance: L('一张卡', 'one card'), delivered: L('NPU 模组（含片上网卡）', 'the NPU module (NIC on the die)') },
    ],
    note: L('NIC 在单元库中属于 NPU 单元（片上），MGMT 属于节点单元，柜级管理与框内 IO 归节点；跨超节点网络的贡献来自交换机与光链路的类比 FIT（assumed）。', 'NIC belongs to the NPU unit in the unit library (on the die), MGMT to the node unit, cabinet-level management and in-chassis IO to the node; the scale-out network’s contribution comes from the switches’ and links’ analogue FIT (assumed).'),
  };

  /* ---------------- 4. mechanism hierarchy ---------------- */
  const MECH_TEXT = {
    heading: L('4. ReMAP 机制集：分层与取舍', '4. The ReMAP mechanism set: hierarchy and pruning'),
    intro: L(`ReMAP 的 ${c.originals} 个原始机制与 ${c.extensions} 个最新扩展${capPhrase.zh}按部署层、作用层与所改变的量归类；取舍用${NARCH.zh}拓扑上 ${c.players} 个机制的 Shapley 值（裸架构、${num(c.permutations, 0)} 个置换）：`, `ReMAP’s ${c.originals} original mechanisms and ${c.extensions} latest extensions${capPhrase.en} are categorised by deployment layer, the layers they act on and the quantity they change; pruning uses the Shapley values of the ${c.players} mechanisms on the ${NARCH.en} architectures (bare architecture, ${num(c.permutations, 0)} permutations):`),
    rule: L(`<b>规则</b>：参考集原样保留；同一恢复阶段上被更短机制支配的剪除（同阶段取最小值，不相加）；其余在 ${DEC.zh}卡上${NARCH.zh}拓扑的 A_op Shapley 均 ≥ ${thr} 个百分点 → A_op 候选（进入分配），有效产出 Shapley 均 ≥ ${thr} 点 → 只保有效产出（设计中保留，不参与 A_op 分配），否则剪除。机制集记录带有结论与理由，hacd prune 按同一规则重算。`, `<b>Rule</b>: the reference set stays; a mechanism dominated by a shorter one on the same recovery stage is pruned (minimum on a stage, never the sum); otherwise A_op Shapley ≥ ${thr} pt at ${DEC.en} on every architecture → A_op candidate (enters the allocation), delivered Shapley ≥ ${thr} pt → goodput-only (kept in the design, outside the A_op allocation), else pruned. The mechanism-set record carries the verdicts and reasons; hacd prune re-derives them by the same rule.`),
    overlapNote: L('重叠规则（审核库）：启动阶段的三个机制逐事件取最小值（按资格份额求期望）；D-RECOVERY-CLASSIFY 与“自动成功率”杠杆作用于同一概率，取两者中较高者，降额时前者的人工概率与杠杆的失败概率都 ×1.5（杠杆 99.9 % → 99.85 %）；检测机制降额后不低于它替代的基线检测；R-HCCL-ELASTIC 需要 R-ELASTIC；静默检测器按残余漏检复合。', 'Overlap rules (audit library): the three startup-stage mechanisms take the minimum per event (the expectation over their eligible shares); D-RECOVERY-CLASSIFY and the automatic-success lever act on the same probability and the higher one applies, derated the former’s manual probability and the lever’s failure probability both ×1.5 (the lever 99.9 % → 99.85 %); a derated detector never falls below the baseline detection it replaces; R-HCCL-ELASTIC needs R-ELASTIC; silent-corruption detectors compound on the residual misses.'),
  };

  /* ---------------- 5. hierarchical MTBF / MTTR budgeting ---------------- */
  const BUDGET_TEXT = {
    heading: L('5. MTBF / MTTR 的逐层预算与叠加图', '5. Hierarchical MTBF / MTTR budgets and the overlay'),
    steps: [
      L('<b>系统级</b>（公式 1–2）：今天的 MTBF_hw、MTTR_hw 与 A_op；要求 B；两个端点“今天 MTTR 下需要的 MTBF”“今天 MTBF 下需要的 MTTR”；推荐设计的 MTBF_hw / MTTR_hw（名义与降额）。', '<b>System</b> (formulas 1–2): today’s MTBF_hw, MTTR_hw and A_op; the requirement B; the two ends “MTBF needed at today’s MTTR”, “MTTR needed at today’s MTBF”; the recommended design’s MTBF_hw / MTTR_hw (nominal and derated).'),
      L('<b>层级</b>（公式 3）：每层的 λ_ℓ、MTTR_ℓ、U_ℓ 与按实例的 MTBF，今天 → 推荐设计；杠杆与机制改变 MTTR_ℓ，硬件系数 k 改变 λ_ℓ。', '<b>Layer</b> (formula 3): each layer’s λ_ℓ, MTTR_ℓ, U_ℓ and MTBF per instance, today → recommended design; levers and mechanisms move MTTR_ℓ, the hardware factor k moves λ_ℓ.'),
      L('<b>硬件单元</b>（公式 4）：每类单元的数量、今天 FIT → 允许 FIT（× k）、单元 MTBF 与对集群中断率的份额——交付与验收值；失效率覆盖替换的类带其置信度标签。', '<b>Hardware unit</b> (formula 4): count, today’s FIT → allowed FIT (× k), unit MTBF and share of the cluster interruption rate — the delivery and acceptance values; classes replaced by a failure-rate override carry their confidence tag.'),
      L('<b>机制参数</b>（公式 5）：推荐设计中每个机制的名义参数（即要求）与降额核验值；MTTR 按梯级与阶段的构成；每个机制去掉的暂停按层。', '<b>Mechanism parameters</b> (formula 5): each mechanism’s nominal parameters (the requirement) and derated check values in the recommended design; the MTTR composition by rung and stage; the pause each mechanism removes, by layer.'),
      L(`<b>叠加图</b>：各拓扑的 Findings 文件把这些预算叠在硬件层级图上——每层一张卡片，${zhCount(nS, '个')}规模各一行：允许的实例 MTBF、层 MTTR、U_ℓ 预算、k，以及部署在该层的机制。`, '<b>Overlay</b>: each topology’s Findings file lays these budgets over the hardware hierarchy — one card per layer, one row per scale: allowed MTBF per instance, layer MTTR, U_ℓ budget, k, and the mechanisms deployed on that layer.'),
    ],
    procedure: L('<b>流程</b>：① 目标与口径 → ② 总预算 B → ③ 按故障单元分到六层 → ④ 层内取舍：候选机制 + 恢复杠杆 + 硬件 ARINC，总努力最小 → ⑤ 校核：名义、降额、逐窗口（不支持则加最便宜的未用动作或收紧 k）→ ⑥ 输出：系统 / 层 / 单元 / 机制四级预算。', '<b>Procedure</b>: ① goal and 口径 → ② total budget B → ③ split over six layers by fault unit → ④ within a layer: candidate mechanisms + recovery levers + ARINC hardware at least total effort → ⑤ checks: nominal, derated, per window (if unsupported, add the cheapest unused move or lower k) → ⑥ outputs: budgets at the system / layer / unit / mechanism levels.'),
  };

  /* ---------------- 6. tooling ---------------- */
  const TOOLING = {
    heading: L('6. HAC-D 的工具能力', '6. Tooling capabilities of HAC-D'),
    intro: L(`本报告集的每张表与每个模型由 HAC-D ${c.engine} 的确定性引擎产生，并由 hacd 命令行从三个输入记录（拓扑记录、失效率覆盖、机制集）加规模与目标再生，换一个拓扑记录不改代码；下表列出所需能力与其在 v5 中的实现。`, `Every table and model of this report set comes from HAC-D ${c.engine}’s deterministic engine and is regenerated by the hacd CLI from three input records (topology record, failure-rate override, mechanism set) plus scales and target, with no code change for a new topology record; the table lists the capabilities needed and how v5 implements them.`),
    columns: [L('能力', 'Capability'), L('实现方式', 'Implemented as'), L('用在', 'Used for'), L('v5 的实现', 'v5 implementation')],
    rows: [
      { cap: L('拓扑模板、BOM 与拓扑记录（几何、scale-out 变体、层实例、出处与置信度）', 'Topology templates, BOM and topology records (geometry, scale-out variants, layer instances, provenance and confidence)'), status: 'core', used: L('BOM 表、各规模单元数、按实例的 MTBF、叠加图的层级图', 'BOM table, unit counts per scale, MTBF per instance, the overlay schematic'), todo: L('<b>TopologyRecord</b>（JSON，zod 校验）：scenarioFromRecord、bomOfVariants；内置记录在 packages/core/data/records', '<b>TopologyRecord</b> (JSON, zod-validated): scenarioFromRecord, bomOfVariants; built-in records in packages/core/data/records') },
      { cap: L('单元故障库与口径；失效率覆盖（每单元 / 每卡，带置信度）', 'Unit fault library and 口径; failure-rate override (per unit / per card, with confidence)'), status: 'core', used: L('每类事件的速率、单元预算、表 3 的置信度标签', 'rates of every class, unit budgets, the confidence tags of Table 3'), todo: L('<b>FaultRateOverride</b>：applyFaultRates（editBase 下替换，机制重放）', '<b>FaultRateOverride</b>: applyFaultRates (replaced under editBase, mechanisms re-applied)') },
      { cap: L('引擎求值的 MTBF / MTTR 形式（各事件类分开、φ、F）', 'The MTBF / MTTR form of the evaluation (classes apart, φ, F)'), status: 'core', used: L('所有数字、表 1', 'every number, Table 1'), todo: L('<b>kpiForm</b>（公式 1，闭合断言 1e-9；金标准 G1）', '<b>kpiForm</b> (formula 1, closure asserted at 1e-9; golden G1)') },
      { cap: L('机制链分解（按梯级、按阶段的 MTTR 构成，含自定义梯级）', 'Chain decomposition (MTTR by rung and stage, custom rungs included)'), status: 'core', used: L('MTTR 构成表；机制去掉的暂停', 'MTTR composition tables; pause removed per mechanism'), todo: L('<b>mttrDecomposition</b>、chainSplit（公式 5；金标准 G3）', '<b>mttrDecomposition</b>, chainSplit (formula 5; golden G3)') },
      { cap: L('层级模型（单元 → 层、每层实例数、按实例验收值）', 'Layer model (unit → layer, instances per layer, acceptance per instance)'), status: 'core', used: L('分层预算、叠加图', 'layer budgets, the overlay'), todo: L('<b>layers</b>：byLayer、layerModel(record.layers)、unavailabilityByLayer（公式 3；G2）', '<b>layers</b>: byLayer, layerModel(record.layers), unavailabilityByLayer (formula 3; G2)') },
      { cap: L('分配策略（ARINC / AGREE / 最小努力、杠杆、候选机制、降额、最优枚举）', 'Allocation strategies (ARINC / AGREE / min-effort, levers, candidate mechanisms, derating, exact optimal)'), status: 'core', used: L('推荐方案、对照 ①', 'the recommended plan, reference ①'), todo: L('allocateStrategy（v4）', 'allocateStrategy (v4)') },
      { cap: L('窗口账本校核与推荐规则（不支持则加最便宜动作；最大支持的 k）', 'Window-ledger check and the recommendation rule (cheapest move when unsupported; largest supported k)'), status: 'core', used: L('逐窗口 P、k、升级轨迹', 'per-window P, k, the escalation trace'), todo: L('<b>windowCheck</b>、<b>recommendPlan</b>（公式 6；k 为引擎二分根，公式 4 的闭式为一阶校核，G5）', '<b>windowCheck</b>, <b>recommendPlan</b> (formula 6; k is the engine’s bisection root, formula 4’s closed form the first-order check, G5)') },
      { cap: L('机制库、审核目录与机制集记录（参数、杠杆、降额、元数据、取舍结论与出处）', 'Mechanism library, audit catalog and the mechanism-set record (parameters, levers, derating, metadata, verdicts and provenance)'), status: 'core', used: L('候选集、参数名义 / 降额、图 2 与 Findings 表 6', 'the candidate set, nominal / derated parameters, Figure 2 and Findings Table 6'), todo: L('<b>MechanismSet</b>：resolveMechanismSet、pruneByShapley、mechanismHierarchy（G6）；CLI hacd prune', '<b>MechanismSet</b>: resolveMechanismSet, pruneByShapley, mechanismHierarchy (G6); CLI hacd prune') },
      { cap: L('归因研究（抽样 Shapley）与按层精确 Shapley', 'Attribution study (sampled Shapley) and exact per-layer Shapley'), status: 'core', used: L('Findings 表 6', 'Findings Table 6'), todo: L('archStudy（allocationStudy 按记录）、shapleyByLayer（≤ 8 个参与者）；CLI hacd study', 'archStudy (allocationStudy per record), shapleyByLayer (≤ 8 players); CLI hacd study') },
      { cap: L('逐层 MTBF / MTTR 预算（系统 → 层 → 单元 → 机制）', 'Hierarchical MTBF / MTTR budget (system → layer → unit → mechanism)'), status: 'core', used: L('Findings 表 1–5 与叠加图', 'Findings Tables 1–5 and the overlay'), todo: L('<b>hierarchicalBudget</b>、budgetFromRecords（results.json）；CLI hacd budget', '<b>hierarchicalBudget</b>, budgetFromRecords (results.json); CLI hacd budget') },
      { cap: L('报告构建（双语 HTML、SVG 图、KaTeX 公式、A4 分页）', 'Report builds (bilingual HTML, SVG figures, KaTeX, A4 pages)'), status: 'cli', used: L('本报告集的全部文件', 'every file of this set'), todo: L('<b>@hac-d/reports</b>（findingsHtml / methodologyHtml / bomHtml，数据的纯函数）；CLI hacd findings | methodology | bom，脚注记录命令、记录 / 机制集 / 覆盖 id 与引擎版本', '<b>@hac-d/reports</b> (findingsHtml / methodologyHtml / bomHtml, pure functions of the data); CLI hacd findings | methodology | bom, the footer records the command, record / set / override ids and the engine version') },
      { cap: L('独立复算', 'Independent re-derivation'), status: 'test', used: L('每个原语的核对', 'the check of every primitive'), todo: L('Python 金标准 G1–G6（packages/core/test/golden/compute_golden_v5.py）与 v4.4 复现测试（results / bom / mechanisms 到 1e-9）', 'Python goldens G1–G6 (packages/core/test/golden/compute_golden_v5.py) and the v4.4 reproduction tests (results / bom / mechanisms to 1e-9)') },
      { cap: L('参数来源与置信度', 'Parameter provenance and confidence'), status: 'core', used: L('每个几何值、FIT 与机制参数的出处', 'provenance of every geometry value, FIT and mechanism parameter'), todo: L('记录的 provenance 字段（2026-10-21 对账：V5_PARAMETER_RECONCILIATION.md）与 library.json', 'the records’ provenance fields (reconciled 2026-10-21: V5_PARAMETER_RECONCILIATION.md) and library.json') },
    ],
    statusLabel: { core: L('内建原语', 'built-in primitive'), cli: L('内建包 + CLI', 'built-in package + CLI'), test: L('金标准测试', 'golden tests'), script: L('脚本编排', 'script orchestration'), external: L('外部（临时）', 'external (ad hoc)') },
    agent: {
      heading: L('是否需要模型无关的 Agent 模块？', 'Is a model-agnostic Agent module required?'),
      verdict: L('<b>结论：生成这些表与模型不需要</b>——以上链路全部是确定性的，可复现，也应保持无 LLM。<b>建议作为可选模块</b>加入，用于三件事：从综述、论文与产品页提取参数（带出处与置信度）、用自然语言生成或改写场景与设计变体（输出经 schema 校验的 JSON）、生成双语叙述与审核清单；这三件事今天在 Claude Code 会话中由技能完成（allocate-to-target、model-check、scenario-review），不在产品内。', '<b>Verdict: not required to produce these tables and models</b> — the chain above is deterministic and reproducible, and should stay LLM-free. <b>Recommended as an optional module</b> for three jobs: extracting parameters from surveys, papers and product pages (with provenance and confidence), authoring or rewriting scenarios and design variants from natural language (schema-validated JSON out), and writing bilingual narrative and review checklists; today these three jobs are done by skills in Claude Code sessions (allocate-to-target, model-check, scenario-review), not inside the product.'),
      design: [
        L('<b>接口</b>：packages/agent 提供 Provider 接口，三种适配：Anthropic Messages API、OpenAI 兼容的 chat completions（覆盖 GPT、DeepSeek、Qwen、本地 vLLM）、Google Gemini；统一工具调用与结构化输出，温度 0，记录提示词与模型版本以便复现。', '<b>Interface</b>: packages/agent with a Provider interface and three adapters — Anthropic Messages API, OpenAI-compatible chat completions (covers GPT, DeepSeek, Qwen, local vLLM), Google Gemini; one tool-calling and structured-output contract, temperature 0, prompts and model versions logged for reproducibility.'),
        L('<b>配方</b>：extract（原文 → 参数记录草稿，口径与置信度由人确认）、author（自然语言 → 拓扑 / 机制集记录 JSON，经 schema 与几何自洽校验）、narrate（结果 JSON → 文字块，数字只引用不生成）；CLI hacd agent extract|author|narrate --provider …，前端放在特性开关后。', '<b>Recipes</b>: extract (source text → draft parameter records, 口径 and confidence confirmed by a person), author (natural language → topology / mechanism-set record JSON, validated against the schema and geometric consistency), narrate (result JSON → text blocks that quote numbers, never produce them); CLI hacd agent extract|author|narrate --provider …, the web app behind a feature flag.'),
        L('<b>护栏</b>：LLM 不产生任何数字——每个数字由引擎算出并经金标准 / 复算校核；提取结果先进 data-staging，按 CLAUDE.md 的分工由人指定事件类、分母、层级与置信度；无网络或无密钥时所有确定性功能不受影响。', '<b>Guard rails</b>: the LLM produces no numbers — every number comes from the engine and passes the golden / re-derivation checks; extractions land in data-staging and a person assigns event class, denominator, level and confidence as CLAUDE.md prescribes; without network or keys every deterministic function keeps working.'),
        L('<b>规模与收益</b>：适配层约 1–2 千行；收益在参数维护与场景编写的速度，不在数值质量。上表的 budget、layers、mttrDecomposition 与 reports 四个模块已在 v5 内建，Agent 模块仍为可选。', '<b>Size and payoff</b>: the adapter layer is about 1–2 k lines; the payoff is in the speed of parameter maintenance and scenario authoring, not in numerical quality. The four modules of the table above — budget, layers, mttrDecomposition and reports — are built in v5; the agent module stays optional.'),
      ],
    },
  };

  const FOOTER = L(`数据：results.json、mechanisms.json（hacd findings 的侧车文件，HAC-D ${c.engine} 引擎）。构建：hacd methodology --data <目录>。公式由 KaTeX 在构建时排版。`, `Data: results.json, mechanisms.json (the sidecar files of hacd findings, HAC-D ${c.engine} engine). Build: hacd methodology --data <dir>. Formulas typeset at build time with KaTeX.`);
  return { TITLE, SUBTITLE, SCOPE, FORMULAS, LAYERS_TEXT, MECH_TEXT, BUDGET_TEXT, TOOLING, FOOTER };
}

const DEFAULT_CONTENT = contentFor(DEFAULT_CTX);
export const { TITLE, SUBTITLE, SCOPE, FORMULAS, LAYERS_TEXT, MECH_TEXT, BUDGET_TEXT, TOOLING, FOOTER } = DEFAULT_CONTENT;
