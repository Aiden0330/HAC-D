# HAC-D — AI 集群可用性 / MTBF / MTTR / goodput 建模工具

[English README](README.md) · 用户手册：[中文](docs/USER_MANUAL.zh.html) · [English](docs/USER_MANUAL.html)

HAC-D 把集群描述（拓扑、带故障与修复参数的部件类、负载、恢复策略、故障管理机制）转换为可用率、平均中断间隔、恢复时间、goodput 与成本，并把目标反向分配到子系统和机制。以综述章节《AI 集群可靠性建模》为依据，并与一个独立的参考引擎（经审核的单作业 30 天离散事件仿真器）交叉校核。

## 原则

- **每个数字都带公式与口径**（事件、分母、层级）；不同事件类的量永不相加。
- **解析式优先并带有效性标记**：一阶 checkpoint 公式检查 τ + δ ≪ M 与 R ≪ M，标记失效时首要值切换为精确更新式。
- **假设不成立时转蒙特卡洛**：非指数寿命、相关故障、有限备件池、有限窗口与静默错误走仿真，解析式结果仍显示并带差值徽标。
- **参数保留出处与置信**（measured / paper-reported / vendor / derived / assumed / scan-level）。

## 快速开始

```bash
npm install                      # Node ≥ 20
npm run dev                      # Web 应用 http://localhost:5173
npm test                         # 358 个核心测试 + 29 个导入器测试（含独立 Python 计算的黄金向量）
node --import tsx packages/cli/src/main.ts examples        # 命令行
claude mcp add hacd -- node --import tsx packages/mcp/src/server.ts   # MCP 服务
```

Web 应用：「方案」页 → 加载示例（九个内置方案）→ 其他页面在每次编辑后自动重算。界面支持中文 / 英文与浅色 / 深色。

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
