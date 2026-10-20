# HAC-D — NPU 集群可用性 / MTBF / MTTR / goodput 建模工具

[English README](README.md) · 用户手册：[中文](docs/USER_MANUAL.zh.html) · [English](docs/USER_MANUAL.html)

HAC-D 把集群描述（拓扑、带故障与修复参数的部件类、负载、恢复策略、故障管理机制）转换为可用率、平均中断间隔、恢复时间、goodput 与成本，并把目标反向分配到子系统和机制。以综述章节《AI 集群可靠性建模》为依据，并与一个独立的参考引擎（经审核的单作业 30 天离散事件仿真器）交叉校核。

## v4.3（2026-10-19）：用户设定硬件数量

- 拓扑页硬件清单的**修改数量**：在当前规模下直接输入节点、CPU、机柜、超节点、互联柜、各类交换（含各层）、链路、光模块或 NPO 光引擎的数量；用户数量只替换该行（其他规模按每 NPU 比例缩放），评估器、指标、拓扑图与分配都使用它（`topology.countOverrides`，`hacd topology --count ubPodSwitch=200`，MCP `topology_bom` 的 `counts`）。不适用的数量会被忽略并注明。
- 方案编辑器的计数规则下拉框列出全部口径（新增 `cpu`、`ub_switch`、scale-out 以及新的 `rack_switch` / `pod_switch` / `npo_engine`）；不在模板单元上的部件在硬件清单中显示为“其他部件”，使清单总率始终等于评估器的硬件中断率。金标新增 9 个独立的用户数量算例。

## v4.2（2026-10-19）：按现行规格重建 Atlas 950，新增 Atlas 960E

- **Atlas 950 按证据重建**：默认超节点为产品页现行规格的 1,024 NPU 形态（16 计算柜 + 4 灵衢互联柜，每柜 64 NPU、16 颗鲲鹏），柜内 2D 全互联（每柜 72 片低阶 UB 交换），每 NPU 2 条 800G 光链路上联一层 128 口 UB 交换（Clos）：每超节点 4,096 个光模块，与 LightCounting 对 WAIC 2026 整机的拆解一致。8,192 NPU 路线图形态（128 台 100T 交换，Hot Chips 2025）、UB-Mesh 论文的 4D 网格（每 8K 64 台 HRS）和 v4.1 的 CloudMatrix384 两级拷贝可在“超节点形态”中选择（`SUPERPOD_VARIANTS`）。超节点之间：每 NPU 2 × 400G UBoE，两平面三层 Clos（128³ / 4 = 524,288，即 SuperCluster；假设）。
- **新增 Atlas 960E 模板**（`a960e-ub`）：56 + 14 柜、每柜 72 NPU + 18 CPU（4,032 NPU，单一媒体来源），柜内 LinkBlade、每超节点 126 台 LinkDevice（176 × 1.6 Tb/s），NPO 光互联（每 4,096 卡 5,500 个 Hi-ONE 引擎替代 48,000 个 800G 模块），四平面两层 scale-out 至 50 万卡（125 个超节点）。
- 核心、金标与界面新增互联拓扑种类（`two-level`、`mesh-clos`、`mesh-4d`、`blade-clos`）与多平面 scale-out；新交换芯片沿用一片 CloudMatrix384 UB 芯片的 FIT，光链路沿用一条 L1–L2 链路的 FIT（按单元等价，假设）。
- 综述：[昇腾下一代集群架构综述（复核与扩展版）](docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html)——Atlas 950 / SuperCluster / 960E、带证据标签的客户部署、已公开可靠性数字及其口径、对 Codex 版的逐条复核。

## v4（2026-10-18）：NPU 工具，拓扑优先

- **拓扑与硬件**成为首页：四种昇腾模板——A2（Atlas 800T A2 服务器 + RoCE Clos）、A3 / CloudMatrix384（UB 超节点，论文几何）、Atlas 950（v4.2：产品页现行规格的 1,024 NPU 超节点，16 计算柜 + 4 灵衢互联柜，柜内全互联 + 一层光交换 Clos；8,192 卡路线图形态、UB-Mesh 论文的 4D 网格与 CloudMatrix384 两级拷贝可选）、Atlas 960E（v4.2：56 + 14 柜、每柜 72 NPU，NPO 光互联，LinkBlade + LinkDevice，四平面两层 scale-out）——在任意规模下（内置 10k / 100k / 200k / 500k NPU，或任意 N）给出硬件清单（NPU、节点、CPU、机柜、超节点、UB L1 / L2 芯片或柜内与超节点层交换、全互联与光链路、NPO 光引擎、各层各平面的 scale-out 交换机与链路）、实时示意图、指标条，原训练作业页成为「可靠性」页签（`packages/core/src/topology`）。
- **各硬件单元的故障类型**：54 事件目录挂到对应单元，并在 CloudMatrix384 几何下换算（每单元 FIT = 每卡 FIT × 每单元对应卡数），因此拓扑会改变中断率（10k 时 A2 / A3 / Atlas 950 / Atlas 960E 每 NPU 分别为 3,086 / 3,371 / 3,092 / 3,041 FIT）；不含 scale-out 的 CloudMatrix384 精确复现目录。黄金向量见 `packages/core/test/golden/compute_golden_v4.py`。
- **默认机制**：每个拓扑方案默认应用 ReMAP 六项机制（D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST），在机制页修改；机制页现为静默错误策略与恢复链的唯一归属处（页签：选择与归因、静默错误与恢复链、单点收益审核）。
- **分配策略**（`packages/core/src/strategy`）：最优（总工作量最小）、MTTR 降低优先、MTTF 提升优先，可用手段为机制库机制、推到上限的恢复杠杆，以及带下限与每减半工作量的各类中断 FIT；硬件分配方式为最小工作量 / AGREE / ARINC；降额可行性、余量、账本校核，并可跨规模运行（分配 → 策略、跨规模）。命令行 `hacd topology`、`hacd strategy`；MCP `topology_bom`、`allocation_strategy`。
- **界面移除 GPU**：五个 GPU 示例与 GPU 用语已从应用中移除（命令行 / MCP 仍可按 ID 取用；GPU 工具可从 git 标签 `v3.7-gpu` 分出）；GPU 集群记录作为已标注的类比保留在参数库中。页面：拓扑与硬件、机制、分配、故障库；方案编辑器、对比、仿真、报告、推理、备件与导入在「全部页面」中。计划与决策见 `docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md`。

## 原则

- **每个数字都带公式与口径**（事件、分母、层级）；不同事件类的量永不相加。
- **解析式优先并带有效性标记**：一阶 checkpoint 公式检查 τ + δ ≪ M 与 R ≪ M，标记失效时首要值切换为精确更新式。
- **假设不成立时转蒙特卡洛**：非指数寿命、相关故障、有限备件池、有限窗口与静默错误走仿真，解析式结果仍显示并带差值徽标。
- **参数保留出处与置信**（measured / paper-reported / vendor / derived / assumed / scan-level）。

## 快速开始

```bash
npm install                      # Node ≥ 20
npm run dev                      # Web 应用 http://localhost:5173
npm test                         # 690 个核心测试 + 29 个导入器测试（含独立 Python 计算的黄金向量，v1–v4）
node --import tsx packages/cli/src/main.ts examples        # 命令行
claude mcp add hacd -- node --import tsx packages/mcp/src/server.ts   # MCP 服务
```

Web 应用：首页「拓扑与硬件」→ 选择模板与规模（内置四种拓扑模板，规模为参数：10k / 100k / 200k / 500k 或任意 N）→ 各页面在每次编辑后自动重算。界面支持中文 / 英文与浅色 / 深色。

## 功能概览

| 页面 | 内容 |
|---|---|
| 方案 | 拓扑与超节点预设（CloudMatrix384、Atlas 950）、部件类（故障率与口径、自动 / 人工修复路径、冗余与倒换、共因、亚健康、静默错误率、机制适用比例）、负载、恢复（流水线 / 分级 / MTTR 混合）、静默错误策略、恢复机制链、度量与目标 |
| 训练作业 | 正确有效产出与有效 goodput、A_op、MTBI、R(N)、模型表（一阶、乘积、精确更新、Daly）、区间标记、窗口账本、静默错误卡片、各类机制链、规模外推 |
| 机制 | 参考目录的 12 项机制、单项 / 末位加入 / Shapley 归因、按目标规划（最低工作量可行组合、降额、必要机制、Pareto 前沿、检出率 × 恢复时间扫描、账本仿真校核） |
| 推理服务、备件与故障域 | N+k 副本（副本可为一个超节点）、容量可用率、备件分位数、维修流水线 |
| 可用性分配 | 等分、ARINC、AGREE、可改进性、最小努力、成本最优；goodput 预算；正确交付口径（仅靠硬件可达性、所需静默检出率与兜底时延） |
| 方案对比 | 并排 KPI、龙卷风敏感性 |
| 蒙特卡洛 | 窗口账本仿真（三类故障、机制链、静默错误，与参考引擎同口径）；单元级作业仿真（Weibull、共因、备件） |
| 设计评审 | 11 条清单、原始 vs 补偿后与补偿瀑布、可靠性框图、重要度与割集、HTML / CSV / JSON / Excel 导出 |
| 导入、参数库 | Excel 公式方法识别（18 种）、拓扑提取与对账、含公式导出；635 条带口径与出处的参数记录 |

## 版本

- v1（2026-10-09）：RBD / CTMC、checkpoint 与 goodput 一阶式、MTTR 流水线、备件、分配、蒙特卡洛、参数库、Excel 报告。
- v2：昇腾拓扑预设、双路径修复、倒换成功率、亚健康、原始 vs 补偿后度量、分级恢复、Excel 导入 / 导出。
- v2.1（2026-10-10）：MTTR 混合、精确更新 / 乘积 / Daly 模型、首要值规则、A_op、参考基线示例。
- v3：静默错误交付模型、恢复机制链与混合更新式、窗口账本仿真、机制库与精确 Shapley 归因；与参考引擎在 1 万–50 万卡上的正确有效产出一致（93.3 / 62.6 / 45.7 / 25.3 % 对 93.33 / 62.56 / 45.87 / 25.24 %）。
- v3.1（2026-10-11）：正确交付口径的分配、机制规划器、分配实践说明、用户手册、规范与工作流文档、Claude Code 技能。
- v3.7（2026-10-15）：**机制审核目录**（2026-10-14《新可靠性机制库·单点收益审核》的 16 项机制进入机制库，集成字段留空时仅做单点审核，打开"使用临时假设"或填入实测值后进入集群级模型；自定义恢复梯级、带逐类覆盖的恢复阶段预算与同阶段取最小规则、逐类静默错误检出率、异步保存的持久化滞后）、**单点收益审核**与**跨规模分配研究**（新页面"审核与报告"、`hacd audit` / `hacd study`、MCP `audit_mechanisms` / `allocation_study`），均可导出独立 HTML 报告：`docs/MODEL_REFERENCE.md` §24。
- v3.6（2026-10-13）：精简模式（网页默认只显示训练核心页面，"全部页面"可恢复，功能不删减）与 ReMAP 桥接（`scripts/remap-bridge.ts` 在 HAC-D 方案上运行 ReMAP 内嵌引擎并导出 ReMAP 审核请求；`hacd import-remap` 导入 ReMAP / 参考工具事件库）：`docs/REMAP_INTEGRATION.md`。
- v3.5（2026-10-13）：来自与参考引擎、ReMAP 的三方对比（`docs/TOOL_COMPARISON.md`，`scripts/ref-compare-v1.ts` 以机器精度复现参考工具 V1 闭式结果）：静默错误窗口的期末规则（保留最后干净检查点 / 期末未解决则整窗口清零，V4 口径，闭式解经独立递推与账本仿真验证）、Student-t 半宽与 Wilson 区间及规划器的 支持 / 不确定 / 未达到 判定、分配页的账本损失预算（按比例 / 均分 / 自定义权重，逐项杠杆）、基于检查点无故障上界的不可达证明、可配置的恢复梯级顺序、由事件计数估计故障率（精确 Garwood 区间；`hacd rate`、`estimate_rate`、部件编辑器）。

## 文档

- 用户手册：`docs/USER_MANUAL.zh.html`（中文）、`docs/USER_MANUAL.html`（英文），自包含、含截图与方法参考；源文件在 `docs/manual/`，`npm run manual` 重建。
- 规范：`docs/SPEC.md`；方案 JSON Schema `docs/scenario.schema.json`。
- 工作流：`docs/WORKFLOW.md`（分析工作流 A1–A10、开发工作流 B1–B8）；分配实践 `docs/ALLOCATION_PRACTICE.md`。
- 技能：`docs/SKILLS.md`（`.claude/skills` 中的 model-check、release-check、scenario-review、allocate-to-target、reference-compare、add-parameter、build-manual）。
- 模型：`docs/MODEL_REFERENCE.md`；对比 `docs/REFERENCE_COMPARISON_100K_500K.md`、`docs/TRAINING_AVAILABILITY_FORMULAS_AND_COMPARISON.md`；各机制对可用率的贡献、公式因子与更多方法 `docs/MECHANISM_CONTRIBUTIONS.md`（示例 `ref-catalog-100k`，54 条事件、逐事件机制标志）；与参考引擎、ReMAP 的三方对比（公式、口径、机制、分配、统计）`docs/TOOL_COMPARISON.md`（`scripts/ref-compare-v1.ts` 以机器精度复现参考工具第一版闭式结果）；昇腾来源 `docs/ASCEND_SOURCES.md`。

## 目录结构

- `packages/core` — 纯 TypeScript 数值核心（units、math、rbd、ctmc、checkpoint、sparing、mttr、scale、allocation、sensitivity、cost、mc、sdc、mechanisms、scenario、library）；测试与黄金向量在 `packages/core/test`。
- `apps/web` — Vite + React 静态应用（中英双语、浅 / 深色），计算在 Web Worker 中。
- `packages/cli` — 命令行；`packages/mcp` — MCP 服务（17 个工具）；`packages/importers` — Excel 导入 / 导出。
- `scripts` — 截图检查、参考引擎对比、手册构建。

## 验证

`npm test`（黄金向量与单元测试）、`npm run typecheck`、`npm run build -w @hac-d/web`、`npm run shots`（每页 1280 / 375 px、浅 / 深色截图与溢出检查）、`node scripts/ref-compare-v3.ts`（参考引擎交叉校核）。
