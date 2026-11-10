# HAC-D — NPU 集群可用性 / MTBF / MTTR / goodput 建模工具

[English README](README.md) · 用户手册：[中文](docs/USER_MANUAL.zh.html) · [English](docs/USER_MANUAL.html)

HAC-D 把集群描述（拓扑、带故障与修复参数的部件类、负载、恢复策略、故障管理机制）转换为可用率、平均中断间隔、恢复时间、goodput 与成本，并把目标反向分配到子系统和机制。以综述章节《AI 集群可靠性建模》为依据，并与一个独立的参考引擎（经审核的单作业 30 天离散事件仿真器）交叉校核。

## v6（2026-10-22）：输入迁移流水线——工作表、校验门、差异评审、离线包

- **v6.1**（2026-10-26）：流水线不再需要有人在终端操作。`hacd ingest run` 一次调用完成工作表 → 门禁 → 干跑 → 差异 → 报告，并写出机器可读的 `run.json`（状态 ok / needs-input / failed、每步的 issue 及其 path 与 code、KPI 行、路径）与 `SUMMARY.md`；`hacd ingest protocol` 打印给内网小模型的操作员协议（中 / 英系统提示词、函数调用工具清单、门禁 code → 修复表），规范见 `docs/markdown/AGENT_OPERATOR.md`，离线包随附。模型只抄有来源与置信的事实并运行这一条命令；HAC-D 计算；负责人签字并 promote。命令行测试覆盖 ok 与 needs-input 两条路径（`npm run test -w @hac-d/cli`）。
- **v6.2**（2026-10-27）：参考宿主与首次试点。`hacd ingest operate` 把 OpenAI 兼容的内网模型当操作员运行（系统提示词 + 任务 + 工具清单；每次工具调用都是本 CLI 的子进程；只读工作目录与输入文档，只写 `ws/`，拒绝以短横线开头的参数值，步数上限，传输层重试，不含密钥的日志；退出码 = 最后一次 run 的）。`scripts/mock-onprem-model.mjs` 是一个按剧本回答的 OpenAI 兼容替身（按模式抽取、把操作员流程做成状态机），无模型即可跑通接线；随离线包一起发布，附合成试点输入（`examples/pilot/`）。操作手册 §8 的试点已用它在离线包内完成——一个以公开 `a3server` 为基线的 A3 服务器集群、10 万卡、一个季度的器件 FIT、一条机制增量——评审后 promote：`docs/markdown/PILOT_2026Q3_MOCK.md`。试点发现并修复：写到管道的 run 清单在退出前被截断（现同步写出）、`run` 在重新转换前删除上一次转换的暂存文件、`validate --json` 不再在输出刷出前退出。测试：`packages/agent/test/host.test.ts`、`packages/cli/test/operate.test.ts`（对替身的三个场景）。
- **v6.3**（2026-10-27）：网页端一键生成 Findings 报告。分配页的「**报告**」页签（第一个页签）一个按钮即在计算工作器中对当前项目运行 `hacd findings` 的流水线——报告预设、项目自身规模或四个内置规模、窗口数与置换次数可改——并下载双语 Findings 页面、Methodology 与数据包（`hacd findings --data <bundle>.json` 可重新渲染）；原「策略」页签的「报告预算」卡与跨规模卡并入该页签。核心测试证明：记录自身的项目给出记录的数字。拓扑图页签的示意图改为与报告共用的一个纯函数：每个 Findings 页面的图 1（记录在主规模下）与 BOM 的图 1a–d（每个主设计一张）。硬件页签、Findings 表 3 与 BOM 表 1 把单元按六个层级（集群 → NPU）分组并给出各层小计。六份报告已重新生成并逐字节复现。
- **v6.4**（2026-10-27）：报告运行归属项目，切换页签或页面不再丢失（「报告」页签显示「运行中」；过期结果有标注）；「**保存 Findings**」把页面与数据包按项目保存在浏览器中，可在新标签页打开、下载或删除。网页各页面对一个项目的操作现在都有程序或模型可运行的命令——`hacd scenario new | show | fields | set | fit | mechanisms | report`（拓扑输入、故障类型 FIT、机制、Findings 报告），基于 `packages/core/src/project/edit.ts`——以工具 `hacd_scenario_*` 与流程 D 提供给内网操作员模型（`docs/markdown/AGENT_OPERATOR.md` §11；已用替身模型经宿主端到端验证），以 `scenario_*` 提供给 MCP 代理。项目流程在离线包内、以工作表试点的同一输入做的试点：`docs/markdown/PILOT_2026Q3_PROJECT_WORKFLOW.md`——两条输入路径给出逐位相同的报告。两次试点的证据（清单、操作员结果、报告旁路 JSON）已提交在 `docs/backup/pilots/`；工作目录（`data-staging/`）不入 git。

- **为什么**：内部硬件 FIT、新拓扑与新机制要从一个只有受限开源模型、数据不能外传的内网进入 HAC-D。基于提示词的 Skill 做不了这件迁移；围绕 v5 输入记录的确定性离线流水线可以，模型只是其中一个受约束的步骤。计划与决策：`docs/markdown/PLAN_V6_INPUT_MIGRATION.md`；内网团队的操作手册：`docs/markdown/INGEST_RUNBOOK.md`。
- **工作表**（`packages/importers/src/worksheet`）：严格的 Markdown 规范（`hacd-worksheet-1`：YAML 头、`## 小节`、固定表头的竖线表格，出错报行号），六种类型——topology、fault-rates、device-fit、koujing-mapping、mechanisms（相对默认机制集的增量）、mechanism-proposal——与 v5 输入记录双向转换；`hacd ingest template <kind>` 打印原样可解析的示例。每条公开记录、默认机制集与 ReMAP 覆盖文件经工作表往返后不变。
- **口径归一**（`packages/core/src/ingest/koujing.ts`）：按来源原文记录的器件失效率（FIT、每 10⁶ 小时、每小时、MTBF 小时、AFR）× 经评审的映射表（器件 → 故障单元、目录故障类、每单元器件数、影响因子）→ 各类每单元·小时的业务影响 FIT，`FIT = Σ FIT_器件 × 每单元器件数 × 影响因子`，算式写入每个条目，置信按政策给出（任一因子或来源为假设即 assumed，否则 derived，否则取来源类型自身的置信）。黄金向量 G7a–G7e 由 Python 独立计算（`compute_golden_v6.py`）。
- **校验门**（`validate.ts`）：封闭词表（含机制实际读取的参数键——新增 `MechanismDef.reads`，三项已审核机制的变换读取了未声明的键）、出处完整性、相对单元库 ×0.1 … ×10 的合理性、记录的结构一致性、id 政策——内部记录用自己的 id 与公开记录并列，公开记录从不被覆盖。引擎无法表达的设计或机制成为面向 HAC-D 侧的扩展请求，只含结构。
- **差异**（`diff.ts`、`packages/reports/src/delta.mjs`）：带新记录所声明来源与置信的输入变化、按每单元口径比较的失效率变化、前后预算的 KPI 行（A_op 名义 / 降额、交付 goodput、MTBF_hw、MTTR_hw、P(窗口)、k、推荐机制与杠杆）及 Δ → `delta.{json,md,zh.md,html}`，双语评审页，已在 1280 / 375 px 检查。
- **抽取工作器**（`packages/agent`，新工作区）：OpenAI 兼容适配器（json_schema / guided_json / fenced），适用于 vLLM / SGLang / llama.cpp 部署的任何模型；分块、两种提示变体与封闭词表、证据卡（字段路径、原文的值与单位、逐字引文、位置），只有引文在分块中找到、值在引文内且两遍一致才接受；评审 Markdown、带提示哈希的 jsonl 日志、草稿工作表的置信来自声明的来源类型而非模型。
- **命令行** `hacd ingest template | fields | worksheet | import-fit | normalize | validate | dry-run | diff | promote | extract`；**离线包** `node scripts/bundle-offline.mjs` → `dist/offline/hacd-<version>.tgz`（esbuild 打包、katex 置于其旁、`data/` 目录作为 `HACD_DATA`、启动脚本、模板、文档；只需 Node ≥ 20，除指定的模型端点外不联网）。公式与校验门：`docs/markdown/MODEL_REFERENCE.md` §26；维护侧技能 `update-inputs`。

## v5.12（2026-11-09）：三目标报告

- **原因**：2026-11-09 的全面评审（`docs/markdown/TOOL_REVIEW_2026-11-09.md`）确认公式正确——独立的事件仿真在 1 万、10 万、50 万卡复现了引擎的 goodput——而 98.5 % 目标“不可达”只是因为它在 2026-10-28 从运行时间占比改到了有效 goodput：参考检查点（每 60 s 保存 1 s，降额 1.5 s）自身就占 1.67 %（名义）/ 2.5 %（降额），超过 1.5 % 的全部预算，于是每页都写“不可达”，没有分配结果。所有者 2026-11-09 决定：采纳评审建议。
- **三个量上的三个目标**（`MODEL_REFERENCE.md` §36）：（1）**A_op ≥ 98.5 %** 承载 MTBF / MTTR 分配（公式 1–6，表 1–6）；`--metric aOp` 重新成为默认，`--metric effective` 保留 v5.6 口径。A_op 既不含检查点周期也不含保存时间，分配不再随检查点策略变化。（2）**检查点层**：推荐设计在随规模变化的周期下的有效 goodput（设计自身周期固定时取 Young 周期 τ = √(2δ·M_rb)）对下限——默认 97 %，取项目的 `targets.effective`，`--effective-floor x|none`——并给出下限允许的保存时间（公式 7，表 7）。（3）**交付层**：交付 goodput 对下限——默认 90 %，`targets.goodput`，`--delivered-floor`——给出下限所需的联合检出覆盖率或发现时延，以及加上机制集中只保交付的检测机制后的值（公式 8，表 8）。核心：`goodputTiers`（`packages/core/src/budget/tiers.ts`）。
- **现场水平对照**（`--field-rates <override>`，表 9；`fieldCaseSummary`）：同一预算在第二套故障率基准上重算。`field-llama3-2026-11` 把目录的 18 个中断类统一乘 5.92，使总量等于公开的现场总量（16,384 张 GPU、54 天内 419 次作业中断）——这是取自另一厂商集群的界，不是本硬件的测量，各类均标 `assumed`，由 `scripts/build-field-rates.mjs` 生成。公式 2 的要求是绝对量：同一方案下每 NPU 允许的中断 FIT 在两套基准上相同（原生 950、50 万卡：2,748），变化的只是相对“今天”的倍数（目录基准 k 0.887，现场基准 0.150）。
- **结论**（400 个窗口，四条记录，以降额值为准）：每个规模都有分配方案。1 万与 10 万卡今天的硬件有余量（k 11–14 与 1.1–1.4，无需动作）；20 万卡时两条 950 记录靠人工恢复杠杆保持 k ≈ 1.0，两条 910C 记录用 C-LOSSLESS + D-HARD 加两个杠杆得到 k ≈ 1.4–1.5；50 万卡需要 D-HARD + R-LINK-LOCAL + H-CONTROL-CONTINUITY 加三个恢复杠杆，并把中断 FIT 压到目录值的 77–90 %（每 NPU 2,571–2,748 FIT）。有效 goodput 在 10 万卡及以下每条记录都达到 97 %（20 万卡时两条 950 记录达到，两条 910C 记录为 96.7 %），50 万卡为 96.5 %（降额），除非单次保存不超过 0.51–0.54 s；交付 goodput 在 10 万卡及以下达到 90 %，50 万卡（76.6–76.8 %）需要联合检出覆盖率 97.2 % 或在 31–32 h 内发现——五个只保交付的检测机制把它提高到 92.6–92.7 %。
- **评审缺陷已修复**：周期被优化时，要求不再在可行方案旁写“仅靠硬件不可达”，也不再在一行里给两个要求（D1、D2：`required.interval = 'optimised'`）；没有可行方案的规模打印“—”而不是允许 FIT（D3）；窗口占比同时给出名义设计与降额设计的值（D4：规则按名义设计验收；k 落在均值限上时降额设计只有约一半窗口达标）；`docs/markdown/SPEC.md` 的计数（D5）；`docs/README.md` 把每个报告页标为现行、背景或已被取代（D6）。另：机制集可为自动恢复给出规模律（`recovery.automatic.scale`，可选；公开集没有，表 5 注已说明），预算中加入节点维修管线及其备件池（`BudgetResult.spares`）。
- **网页与工具**：拓扑页指标条显示 A_op（降额）、两个 goodput 层对各自下限、MTBF_hw 与 MTTR_hw；分配 › 报告运行三目标报告并按规模预览一行；`hacd scenario report`、操作员工具与 MCP 工具接受 `metric` 与两个下限。黄金向量 G8（Young 孪生设计与保存时间求根；v5 共 97 例）。版本 0.5.12。
- **未决**——架构对比：四条记录在 50 万卡的 A_op 最多相差 0.8 个百分点，因为 87–94 % 的中断率落在每 NPU 数量与 FIT 在各记录中都相同的类上，而目录里互联只占 4–5 %（评审补充第 11 节）。模型未为此作任何改动。

## v5.11（2026-11-01）：浏览器报告中的附录

- **分配 › 报告**以复选框提供三个公开变体机制集（+ C-YOUNG；C-MEM 替代 C-FAST；+ C-YOUNG 与五个只保交付 goodput 的机制）：每勾选一个，就增加一页 `hacd findings --variants` 的附录 A——在相同的目标、规模、窗口数、种子、分配方式与降额下，用该机制集的候选与杠杆，对项目的设计施加该机制集的变化后重算预算，不做 Shapley 研究。表 1–6 不变；页脚与保存的结果记录所选机制集。核心：`ScenarioReportOptions.variants`、`VARIANT_MECHANISM_SETS` / `mechanismSetById`（为浏览器内置的机制集）、`variantReference`；`variantSummary` 从变体自身的参考集读取“增加 / 移除”，因此记录路径与浏览器路径的描述一致，在记录自身的设计上逐字节给出相同的行（`report_variants_v511.test.ts`）。MODEL_REFERENCE §35；手册 §7.2。 项目工作流取同一选项：`hacd scenario report --variants <set>,…`、操作模型工具 `hacd_scenario_report` 与 MCP 工具 `scenario_report`；Methodology 页公式 4′ 的注记同日说明：在 C-YOUNG 下闭式 k ≈ B/Σc 只是根的下界。
- 同日：v5.9 附录数值的独立校核（MODEL_REFERENCE §33.5，黄金向量 G7y），以及开发与 CI 迁移到 Node 24（`.nvmrc`；离线包仍保持 Node ≥ 20，由 CI 的第二个作业运行）。

## v5.10（2026-11-01）：报告中的只保交付 goodput 机制

- **原因**：在 50 万卡上达到 98.5 % 有效 goodput 目标的方案只交付约 78 %，因为未检出的静默错误使工作作废。作用于这部分损失的五个机制不在任何设计中，页面却称它们“保留”。
- **附录 A3**：公开变体机制集 `remap-latest-2026-10--young-sdc`（`--young` 机制集，并把 D-SDC-FP8、D-SDC-FP4、D-ABFT、D-NET-SDC、H-SDC-SCREEN 放入基线）经 `hacd findings --variants` 运行。表 1–6 的数字都不变。
- **结论**（400 个窗口，降额，四个记录）：每个方案仍达到目标，并通过新窗口上的验收；1 万 / 10 万 / 20 万 / 50 万卡的交付 goodput 从 98.1 / 93.6 / 89.1 / 78 % 升到 98.5 / 97.7 / 96.9 / 94.6 %。代价是 D-ABFT 的吞吐开销，约占 54 s/h 预算中的 5.3 s/h，因此 20 万与 50 万卡的硬件系数须收紧 16–18 %（50 万卡 k 从 0.18–0.22 降到 0.14–0.18）。这些参数是机制集的目标值，并非测量值。闭式与窗口账本在抽样误差内一致（4,000 个窗口）。
- **页面更正**：表 1 的注释说明 G_del 覆盖的范围；标签与剪除规则把“保留”改为“表 1–5 的设计未应用”；附录参数按原值打印（A2 曾把 C-MEM 的 0.5 s 保存显示为 1、1 % 开销显示为 0）。版本 0.5.10。规范 `docs/markdown/MODEL_REFERENCE.md` §34。

## v5.9（2026-10-29）：另一种检查点策略的附录

- **原因**：在有效 goodput 口径下，C-FAST 固定的 60 s / 1 s 检查点使 98.5 % 目标不可达，目标与机制集保持不变（用户决定，2026-10-29）。现在每个 Findings 页末尾都有一个附录，说明目标在另一种检查点策略下需要什么；表 1–6 不受影响。
- **C-YOUNG**（机制库，状态 `variant`）：检查点周期按 Young 公式 τ = √(2δ·M_rb) 取值，保存时间为设计自身的值，可精确移除，不进入任何候选池。两个公开变体机制集：`remap-latest-2026-10--young`（参考集加 C-YOUNG）与 `remap-latest-2026-10--cmem`（C-MEM 替代 C-FAST）。
- **`hacd findings --variants <set>,…`** 在各变体机制集下运行相同的预算（窗口规则、候选、杠杆、ARINC、降额、窗口数、种子）并写入 `results.variants`；每个 Findings 页增加附录 A（逐规模的 τ / δ、保存、公式 2′ 的 B 与两端要求、方案或上限），方法页增加一句，页脚列出机制集（`docs/markdown/MODEL_REFERENCE.md` §33）。
- **结论**：附录在昇腾报告集上的结果（2026-10-29，400 个窗口，降额）：采用 Young 周期后，保存从 90 s/h 降到 5–11 s/h（保存 1.5 s 时，1 万卡 τ 950–1,050 s，10 万卡 300–333 s，20 万卡 212–236 s，50 万卡 134–149 s），目标在每个规模都可达——1 万卡无需动作，硬件上限 k = 5.5–7.1；10 万卡一到两个动作，k ≈ 1（自动尝试 / 人工杠杆、D-HARD 或 R-LINK-LOCAL）；20 万卡需要 D-HARD + R-LINK-LOCAL + H-CONTROL-CONTINUITY 以及自动尝试与成功率杠杆，k = 0.55–0.66；50 万卡同样五个动作，k = 0.18–0.22（硬件中断 FIT 降到约五分之一），P(窗口) 95–96 %。C-MEM 替代 C-FAST 在任何规模都达不到目标：1 % 开销（降额 1.5 %）本身就占 54 s/h，即全部预算，因此 B = −45 至 −63 s/h，全部动作加理想硬件的上限为 97.0–97.3 %。
- **发布检查与 CI**（2026-10-29 / 30）：工作区版本统一为 0.5.9；`.github/workflows/ci.yml` 在 Linux 上运行检查（版本检查、干净安装、类型检查、Web 构建、全部测试、报告页面逐字节复现）。首次运行在安装时失败：工作区各包互相精确锁定 0.5.0，而各包已是 0.5.9，npm 于是向注册表请求未发布的包，本地 `node_modules` 符号链接掩盖了这一点。`node scripts/version-bump.mjs <version>` 现在一条命令设置所有版本副本（根、各工作区及其 `@hac-d/*` 依赖、lockfile、`CORE_VERSION`、报告工具包的默认引擎版本），`--check` 在安装前运行。第二次运行失败在页面日期：报告配方曾按渲染器所在时区格式化日期；现在取侧车文件 `generated` 时间戳的前十个字符（`isoLocal` 写入作者的 UTC 偏移），页面在任何 `TZ` 下都可复现。附录数值已于 2026-11-01 独立校核（MODEL_REFERENCE §33.5，黄金向量 G7y）：Young 周期、保存、每次中断损失与预算都能由存储项以机器精度复现；附录的 k 是窗口规则的 k，闭式 k ≈ B/Σc 在 C-YOUNG 下只是下界。

## v5.8（2026-10-29）：采纳外部方法与代码评审

- **窗口规则遵守各类约束**：窗口规则的硬件系数 k 现在与最优策略完全一样，遵守各类的 `fixed` 标记、下限与每减半努力（同一规则：`hardwareClasses` / `arincFactors`）。方案只有在每类都到下限时仍满足目标才算可行，不可行的方案说明原因（理想硬件也不够、约束、或窗口校核）。此前窗口规则可能移动固定类，并报告优化器判为不可行的目标已达到。
- **独立验收**：推荐方案的窗口结论来自搜索从未抽取的窗口（同一种子的第 T … 2T − 1 个复制）；搜索自身的校核保留为 `search`。
- **参数定义域**：每个机制参数都有定义域（`mechanisms/parameters.ts`：概率在 [0, 1]，秒 ≥ 0，……），由机制集模式、导入校验门与每个变换强制执行；工作表模板会打印定义域。
- **较小修复**：训练模型未使用的输入（冗余、共因、寿命分布）列为警告，不再静默丢弃；最优策略记录它是枚举还是贪心下降（方法页现在说明 G_eff 报告集用的是贪心下降，而非枚举 512 个子集）；没有硬中断时不再出现 NaN；Web 构建的提交写入报告出处；所有平台按 LF 检出。规范 `docs/markdown/MODEL_REFERENCE.md` §32；决定记录 `docs/markdown/METHOD_CODE_REVIEW_RESPONSE_2026-10-29.md`。

## v5.7（2026-10-29）：第六次模型评审的修复

- **验收值**：报告验收用的有效 goodput 取精确更新模型（`effectiveGoodputExact`，即窗口账本的模型）；损失形式 (1′) 是其一阶预算。此前一阶首要值低 0.06–0.46 点，均值规则与窗口规则检验的不是同一个数。
- **公式 (2′)**：Φ′ 是各吞吐系数之积，不可达的目标在精确更新区间不再显示为可达。
- **剪除规则**：候选还需在参考集之上有增益（C-ASYNC 被剪除：C-FAST 已设定保存，它只增加滞后）；研究（1200 次置换）保存每个指标的半宽，规则列出落在半宽内的结论。
- **较小修复**：按类的 straggler 定律、窗口账本中的备机阻塞、机制集工作表的剪除指标、表 4 的分层损失。规范 `docs/markdown/MODEL_REFERENCE.md` §31；评审 `docs/markdown/MODEL_REVIEW_2026-10-29.md`。

## v5.6（2026-10-29）：按有效 goodput 口径出报告

- **决定**（用户，2026-10-28）：报告以 goodput 作为可用度值——**有效 goodput G_eff**（检查点保存、每次回滚的重算与恢复暂停，乘吞吐系数）是验收指标，目标 98.5 %；**交付 goodput G_del** 并列报告；名义 / 降额成对数值不再显示，每个设计一个降额值。`BudgetMetric`（默认 'effective'，保留 'aOp' 作为 v5.5 口径）贯穿 `kpiForm`（损失形式 1′：rᵢ = t̄ᵢ + P_rb,i·W，R_eff = MTTR_hw + P̄_rb·W）、`requirementFromKpi`（2′：B = 3600 (1 − δ/τ − G*/Φ′) − F − Q_other）、`lossBreakdown`（3′）、`recommendPlan` / `windowCheck`（6′，来自账本的逐窗口有效 goodput）、`allocateStrategy`、Shapley 研究与剪除规则（`prune.metric`；C-ASYNC 进入，R-FABRIC-DEGRADE 移出）、Findings / 方法 / 差异配方、`hacd findings | budget --metric`、`hacd scenario report`、`hacd ingest run`、Web 报告页签、拓扑指标条与策略预设、`targets.effective`。没有可行方案的规模是一个打印出来的结果（全部动作开启、k = 1、给出理想硬件的上限），绝不崩溃。`MODEL_REFERENCE.md` §30；黄金向量 G1e–G6e。
- **结论**：在 C-FAST 固定的 60 s / 1 s 检查点下，仅保存就把有效 goodput 限制在名义 98.33 % / 降额 97.5 %，因此四个记录的每个规模都达不到 98.5 % 目标；重新生成的页面给出公式 (2′) 各项与全部动作的上限。有效 goodput 现在把静默错误事件（episode）的暂停计为停机（≤ 0.006 点）。图 1 在每个模板族上标出 scale-out 平面。

## v5 / v5.1 / v5.2 / v5.3（2026-10-21 / 22）：由输入记录生成报告流水线；项目页；页面合并；页面与报告同一口径

- **v5**：昇腾分配报告集（方法、各拓扑结果、10 万卡元件清单）由三种输入记录——拓扑记录、失效率覆盖、机制集（`packages/core/src/records`，JSON 在 `packages/core/data/{records,fault-rates,mechanism-sets}`，每个值带出处与置信）——经核心原语（KPI 形式、MTTR 分解、分层预算、要求、窗口规则、Shapley 剪除、分层预算汇总）、双语报告套件 `packages/reports`（报告配方是旁路 JSON 的纯函数；`node packages/reports/test/reproduce.mjs` 逐字节复现六份报告）与命令行 `hacd findings | bom | budget | methodology | prune | study --record | records | schema --record|--mechanisms|--rates` 生成；黄金向量 G1–G6；参数复核 `docs/markdown/V5_PARAMETER_RECONCILIATION.md`；计划 `docs/markdown/PLAN_V5_REPORT_PIPELINE.md`。
- **v5.1**：唯一的**项目页**（项目 = 方案 + 各页设置）作为载入 / 保存的单一入口；导航 项目 → 拓扑与硬件 → 分配 → 机制库 → 故障库；删除重复的分配视图（拓扑页的分配页签、分配页的规划器页签与 v3.7 研究面板）。
- **v5.2**（2026-10-22）：十二个页面合并为八个，一个功能只在一处——项目页新增导入与对比页签；新增**评审**页，容纳带导出的评审清单、蒙特卡洛校核与敏感性龙卷风；推理与备件合为「全部页面」中的一页；各硬件单元的故障类型只在拓扑页的硬件页签显示一次，故障库页即参数库。导航：项目 → 拓扑与硬件 → 分配 → 机制库 → 故障库 → 评审；「全部页面」另有方案编辑器与推理与备件。
- **v5.4**（2026-10-26）：第五个拓扑模板——**通用 UB 超节点**（`ub-generic`，由记录定义）：面向非公开产品的超节点，几何（四种 UB 互联形态之一）、名称、来源与假设全部来自拓扑记录 / 工作表；页面在没有记录时显示 1,024 NPU 两级 L1/L2 的占位几何，Findings 报告的叠加图按记录绘制。首个记录 `a960`：HC2025 路线图的 Atlas 960 超节点（15,488 NPU、220 柜；柜内几何为假设，HC2026 已把该产品改为 4,096 NPU = `a960e` 记录）。`hacd findings --record a960` 仅凭记录即可生成其结果报告；新增黄金向量固定该模板的数量（核心测试 840 个）。
- **v5.3**（2026-10-22）：页面与报告同一口径。拓扑页指标条按公式 (1) 显示：A_op 名义 / 降额、正确有效产出、MTBF_hw（硬中断的 1/Σλ；注释保留 MTBI）、MTTR_hw 名义 / 降额（硬中断类按速率加权的暂停；注释保留全部事件均值）、每 NPU 中断 FIT——即结果报告「今天」一行。分配 › 策略新增「**报告设置**」（机制集的候选、工作量、参数与杠杆、ARINC、降额、400 个窗口，使最优行与报告一致）和「**报告预算（逐窗口规则）**」卡（对当前项目运行 `hierarchicalBudget`：今天 / 要求 / 推荐，同 `hacd budget`）；名义与降额在出现处均有定义（名义 = 机制库给出的参数；降额 = 覆盖率 −5 pt、成功率 −8 pt、时间 ×1.5、发生率改善 ×0.5；两者都须达标，起决定作用的是降额值）。内置项目：Atlas 950 示例采用 native950 记录的几何（跨超节点 4 端口 / 4 平面 / radix 1024），新增 UBL128 与 Atlas 800T A3 服务器集群，报告集的每个架构都能以报告的数字在页面上打开。`hacd findings --data <dir>` 由已存旁路 JSON 重新渲染页面。评审页的 HTML 导出带指标条的数字。重复整个策略表单的「跨规模」页签并入「策略」页签末尾的跨规模卡（分配页剩两个页签）。结果报告按评审精简：目标与要点、一条结论（MTBF / MTTR 要求）、表 1–6（机制集及其各规模 Shapley 值为表 6，方法报告不再重复）、每张表下只保留一句口径注、屏幕字号加大。可靠性页签：模型表只显示 A_op 与首要模型（其余折叠），机制链表简化为六列（各梯级结束占比合并为一格），规模表只保留首要 goodput 一列。

## v4.3（2026-10-19）：用户设定硬件数量

- 拓扑页硬件清单的**修改数量**：在当前规模下直接输入节点、CPU、机柜、超节点、互联柜、各类交换（含各层）、链路、光模块或 NPO 光引擎的数量；用户数量只替换该行（其他规模按每 NPU 比例缩放），评估器、指标、拓扑图与分配都使用它（`topology.countOverrides`，`hacd topology --count ubPodSwitch=200`，MCP `topology_bom` 的 `counts`）。不适用的数量会被忽略并注明。
- 方案编辑器的计数规则下拉框列出全部口径（新增 `cpu`、`ub_switch`、scale-out 以及新的 `rack_switch` / `pod_switch` / `npo_engine`）；不在模板单元上的部件在硬件清单中显示为“其他部件”，使清单总率始终等于评估器的硬件中断率。金标新增 9 个独立的用户数量算例。

## v4.2（2026-10-19）：按现行规格重建 Atlas 950，新增 Atlas 960E

- **Atlas 950 按证据重建**：默认超节点为产品页现行规格的 1,024 NPU 形态（16 计算柜 + 4 灵衢互联柜，每柜 64 NPU、16 颗鲲鹏），柜内 2D 全互联（每柜 72 片低阶 UB 交换），每 NPU 2 条 800G 光链路上联一层 128 口 UB 交换（Clos）：每超节点 4,096 个光模块，与 LightCounting 对 WAIC 2026 整机的拆解一致。8,192 NPU 路线图形态（128 台 100T 交换，Hot Chips 2025）、UB-Mesh 论文的 4D 网格（每 8K 64 台 HRS）和 v4.1 的 CloudMatrix384 两级拷贝可在“超节点形态”中选择（`SUPERPOD_VARIANTS`）。超节点之间：每 NPU 2 × 400G UBoE，两平面三层 Clos（128³ / 4 = 524,288，即 SuperCluster；假设）。
- **新增 Atlas 960E 模板**（`a960e-ub`）：56 + 14 柜、每柜 72 NPU + 18 CPU（4,032 NPU，单一媒体来源），柜内 LinkBlade、每超节点 126 台 LinkDevice（176 × 1.6 Tb/s），NPO 光互联（每 4,096 卡 5,500 个 Hi-ONE 引擎替代 48,000 个 800G 模块），四平面两层 scale-out 至 50 万卡（125 个超节点）。
- 核心、金标与界面新增互联拓扑种类（`two-level`、`mesh-clos`、`mesh-4d`、`blade-clos`）与多平面 scale-out；新交换芯片沿用一片 CloudMatrix384 UB 芯片的 FIT，光链路沿用一条 L1–L2 链路的 FIT（按单元等价，假设）。
- 综述：[昇腾下一代集群架构综述（复核与扩展版）](docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html)——Atlas 950 / SuperCluster / 960E、带证据标签的客户部署、已公开可靠性数字及其口径、对 Codex 版的逐条复核。

## v4（2026-10-18）：NPU 工具，拓扑优先

- **拓扑与硬件**成为首页：五种模板（v5.4 新增由记录定义的通用 UB 超节点）——A2（Atlas 800T A2 服务器 + RoCE Clos）、A3 / CloudMatrix384（UB 超节点，论文几何）、Atlas 950（v4.2：产品页现行规格的 1,024 NPU 超节点，16 计算柜 + 4 灵衢互联柜，柜内全互联 + 一层光交换 Clos；8,192 卡路线图形态、UB-Mesh 论文的 4D 网格与 CloudMatrix384 两级拷贝可选）、Atlas 960E（v4.2：56 + 14 柜、每柜 72 NPU，NPO 光互联，LinkBlade + LinkDevice，四平面两层 scale-out）——在任意规模下（内置 10k / 100k / 200k / 500k NPU，或任意 N）给出硬件清单（NPU、节点、CPU、机柜、超节点、UB L1 / L2 芯片或柜内与超节点层交换、全互联与光链路、NPO 光引擎、各层各平面的 scale-out 交换机与链路）、实时示意图、指标条，原训练作业页成为「可靠性」页签（`packages/core/src/topology`）。
- **各硬件单元的故障类型**：54 事件目录挂到对应单元，并在 CloudMatrix384 几何下换算（每单元 FIT = 每卡 FIT × 每单元对应卡数），因此拓扑会改变中断率（10k 时 A2 / A3 / Atlas 950 / Atlas 960E 每 NPU 分别为 3,086 / 3,371 / 3,092 / 3,041 FIT）；不含 scale-out 的 CloudMatrix384 精确复现目录。黄金向量见 `packages/core/test/golden/compute_golden_v4.py`。
- **默认机制**：每个拓扑方案默认应用 ReMAP 六项机制（D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST），在机制页修改；机制页现为静默错误策略与恢复链的唯一归属处（页签：选择与归因、静默错误与恢复链、单点收益审核）。
- **分配策略**（`packages/core/src/strategy`）：最优（总工作量最小）、MTTR 降低优先、MTTF 提升优先，可用手段为机制库机制、推到上限的恢复杠杆，以及带下限与每减半工作量的各类中断 FIT；硬件分配方式为最小工作量 / AGREE / ARINC；降额可行性、余量、账本校核，并可跨规模运行（分配 → 策略、跨规模）。命令行 `hacd topology`、`hacd strategy`；MCP `topology_bom`、`allocation_strategy`。
- **界面移除 GPU**：五个 GPU 示例与 GPU 用语已从应用中移除（命令行 / MCP 仍可按 ID 取用；GPU 工具可从 git 标签 `v3.7-gpu` 分出）；GPU 集群记录作为已标注的类比保留在参数库中。页面：拓扑与硬件、机制、分配、故障库；方案编辑器、对比、仿真、报告、推理、备件与导入在「全部页面」中。计划与决策见 `docs/markdown/PLAN_V4_NPU_TOPOLOGY_FIRST.md`。

## 原则

- **每个数字都带公式与口径**（事件、分母、层级）；不同事件类的量永不相加。
- **解析式优先并带有效性标记**：一阶 checkpoint 公式检查 τ + δ ≪ M 与 R ≪ M，标记失效时首要值切换为精确更新式。
- **假设不成立时转蒙特卡洛**：非指数寿命、相关故障、有限备件池、有限窗口与静默错误走仿真，解析式结果仍显示并带差值徽标。
- **参数保留出处与置信**（measured / paper-reported / vendor / derived / assumed / scan-level）。

## 快速开始

```bash
npm install                      # Node 24（.nvmrc；22.12 或更新——vitest 5 与 commander 15 需要），工作区（core、importers、reports、agent、cli、mcp、web）；离线包本身在 Node ≥ 20 上运行
npm run dev                      # Web 应用 http://localhost:5173
npm test                         # 933 核心 + 56 导入器 + 37 抽取工作器 + 46 报告 + 16 命令行测试（含 598 个独立 Python 计算的黄金向量，v1–v6）；引擎重负载测试超时 300 s（vitest.config.ts），命令行测试 600 s（其 operate 测试会启动模型替身）
node --import tsx packages/cli/src/main.ts examples        # 命令行：六个内置示例（四种拓扑模板 + 报告记录的 UBL128 与 A3 服务器集群，v5.3）
claude mcp add hacd -- node --import tsx packages/mcp/src/server.ts   # MCP 服务
node --import tsx packages/cli/src/main.ts findings --record native950 --out out/950   # v5：由输入记录生成报告集
node --import tsx packages/cli/src/main.ts ingest template topology > my-topology.md  # v6：工作表示例；然后 ingest worksheet / validate / diff / promote
node scripts/bundle-offline.mjs                                       # v6：内网离线包
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

- v6（2026-10-22）：输入迁移流水线——工作表、口径归一、校验门、差异评审页、抽取工作器、离线包（见上）。
- v5.12（2026-11-09）：三目标报告——A_op 承载分配，有效 goodput 与交付 goodput 各为一层并带下限；现场水平对照；评审缺陷 D1–D6（见上）。
- v5.6 – v5.11（2026-10-29 / 11-01）：按有效 goodput 口径出报告、第六次模型评审修复、采纳外部方法与代码评审、另一种检查点策略的附录、只保交付 goodput 机制的附录、浏览器报告中的附录（见上）。
- v5 / v5.1（2026-10-21 / 22）：由输入记录生成报告集、项目页（见上）。
- v4 – v4.3（2026-10-18 / 19）：NPU 工具拓扑优先、Atlas 950 / 960E 模板、用户硬件数量（见上）。
- v1（2026-10-09）：RBD / CTMC、checkpoint 与 goodput 一阶式、MTTR 流水线、备件、分配、蒙特卡洛、参数库、Excel 报告。
- v2：昇腾拓扑预设、双路径修复、倒换成功率、亚健康、原始 vs 补偿后度量、分级恢复、Excel 导入 / 导出。
- v2.1（2026-10-10）：MTTR 混合、精确更新 / 乘积 / Daly 模型、首要值规则、A_op、参考基线示例。
- v3：静默错误交付模型、恢复机制链与混合更新式、窗口账本仿真、机制库与精确 Shapley 归因；与参考引擎在 1 万–50 万卡上的正确有效产出一致（93.3 / 62.6 / 45.7 / 25.3 % 对 93.33 / 62.56 / 45.87 / 25.24 %）。
- v3.1（2026-10-11）：正确交付口径的分配、机制规划器、分配实践说明、用户手册、规范与工作流文档、Claude Code 技能。
- v3.7（2026-10-15）：**机制审核目录**（2026-10-14《新可靠性机制库·单点收益审核》的 16 项机制进入机制库，集成字段留空时仅做单点审核，打开"使用临时假设"或填入实测值后进入集群级模型；自定义恢复梯级、带逐类覆盖的恢复阶段预算与同阶段取最小规则、逐类静默错误检出率、异步保存的持久化滞后）、**单点收益审核**与**跨规模分配研究**（新页面"审核与报告"、`hacd audit` / `hacd study`、MCP `audit_mechanisms` / `allocation_study`），均可导出独立 HTML 报告：`docs/markdown/MODEL_REFERENCE.md` §24。
- v3.6（2026-10-13）：精简模式（网页默认只显示训练核心页面，"全部页面"可恢复，功能不删减）与 ReMAP 桥接（`scripts/remap-bridge.ts` 在 HAC-D 方案上运行 ReMAP 内嵌引擎并导出 ReMAP 审核请求；`hacd import-remap` 导入 ReMAP / 参考工具事件库）：`docs/markdown/REMAP_INTEGRATION.md`。
- v3.5（2026-10-13）：来自与参考引擎、ReMAP 的三方对比（`docs/markdown/TOOL_COMPARISON.md`，`scripts/ref-compare-v1.ts` 以机器精度复现参考工具 V1 闭式结果）：静默错误窗口的期末规则（保留最后干净检查点 / 期末未解决则整窗口清零，V4 口径，闭式解经独立递推与账本仿真验证）、Student-t 半宽与 Wilson 区间及规划器的 支持 / 不确定 / 未达到 判定、分配页的账本损失预算（按比例 / 均分 / 自定义权重，逐项杠杆）、基于检查点无故障上界的不可达证明、可配置的恢复梯级顺序、由事件计数估计故障率（精确 Garwood 区间；`hacd rate`、`estimate_rate`、部件编辑器）。

## 文档

- 用户手册：`docs/USER_MANUAL.zh.html`（中文）、`docs/USER_MANUAL.html`（英文），自包含、含截图与方法参考；源文件在 `docs/manual/`，`npm run manual` 重建。§15.5 介绍 v6 的工作表、校验门、差异评审与离线包；§8–§11 是 v5.2 合并后的各页面。
- 用户指南与计划：`docs/markdown/USER_GUIDE.md`（各页面、“v5 CLI”、“v6 ingest”）、`docs/markdown/DEVELOPMENT_PLAN.md`、各阶段计划 `docs/markdown/PLAN_V*.md`（v6：`PLAN_V6_INPUT_MIGRATION.md`）、内网操作手册 `docs/markdown/INGEST_RUNBOOK.md`（其 §8 为试点：一条有公开对照的记录、一个规模、一个季度，promote 前五项验收；模型只起草，命令行编排，由人签字）。
- 规范：`docs/markdown/SPEC.md`；输入记录的 JSON Schema 由 `hacd schema --record|--mechanisms|--rates` 输出。
- 工作流：`docs/markdown/WORKFLOW.md`（分析工作流 A1–A10 含 v6 内部输入步骤、开发工作流 B1–B8）；分配实践 `docs/markdown/ALLOCATION_PRACTICE.md`。
- 技能：`docs/markdown/SKILLS.md`（`.claude/skills` 中的 model-check、release-check、scenario-review、allocate-to-target、reference-compare、add-parameter、build-manual、update-inputs）。
- 模型：`docs/markdown/MODEL_REFERENCE.md`（§25 v5 流水线，§26 v6 口径归一、证据检查与校验门）；对比 `docs/markdown/REFERENCE_COMPARISON_100K_500K.md`、`docs/markdown/TRAINING_AVAILABILITY_FORMULAS_AND_COMPARISON.md`；各机制对可用率的贡献、公式因子与更多方法 `docs/markdown/MECHANISM_CONTRIBUTIONS.md`（示例 `ref-catalog-100k`，54 条事件、逐事件机制标志）；与参考引擎、ReMAP 的三方对比（公式、口径、机制、分配、统计）`docs/markdown/TOOL_COMPARISON.md`；v5 参数复核 `docs/markdown/V5_PARAMETER_RECONCILIATION.md`。
- 报告（`docs/*.html`）：`docs/README.md` 是索引——现行报告集（方法、各拓扑结果、10 万卡元件清单；v5.12）、背景页（架构、综述、方法）以及前几代已被取代的结果和应改读的页面。
- 评审：`docs/markdown/TOOL_REVIEW_2026-11-09.md`（全面评审：目标、模型、缺陷、建议，以及 v5.12 中的处理结果）、模型评审 `docs/markdown/MODEL_REVIEW_*.md`、对外部方法与代码评审的答复 `docs/markdown/METHOD_CODE_REVIEW_RESPONSE_2026-10-29.md`。

## 目录结构

- `packages/core` — 纯 TypeScript 数值核心（units、math、rbd、ctmc、checkpoint、sparing、mttr、scale、allocation、sensitivity、cost、mc、sdc、mechanisms、scenario、library；v5 records、budget、layers、study；v6 ingest：词表、证据卡、口径归一、校验门、差异、扩展请求）；测试与黄金向量在 `packages/core/test`（`compute_golden*.py`，v6 为 G7）。
- `apps/web` — Vite + React 静态应用（中英双语、浅 / 深色），计算在 Web Worker 中；v5.1 以项目页为唯一载入 / 保存入口；v5.2 八个页面：项目（列表、新建、导入含 Excel、对比）、拓扑与硬件、分配、机制库、故障库（参数库）、评审（评审清单与导出、仿真校核、敏感性），「全部页面」中另有方案编辑器与推理与备件。
- `packages/cli` — 命令行（v5 `findings | bom | budget | methodology | prune | study`，v6 `ingest …`）；`packages/mcp` — MCP 服务；`packages/importers` — Excel 导入 / 导出与 v6 工作表；`packages/reports` — 双语报告套件与配方（v6 新增差异评审页）；`packages/agent` — v6 抽取工作器。
- `scripts` — 截图检查、参考引擎对比、手册构建、`bundle-offline.mjs`（v6 离线包）。
- `docs/markdown` — 开发计划、各阶段计划、模型参考、用户指南、规范、工作流、技能、内网操作手册；`docs/*.html` — 报告集与两份用户手册。

## 验证

`npm test`（黄金向量与单元测试：核心、导入器、抽取工作器、报告、命令行）、`node packages/reports/test/reproduce.mjs`（六份报告逐字节复现）、`npm run typecheck`、`npm run build -w @hac-d/web`、`npm run shots`（每页 1280 / 375 px、浅 / 深色截图与溢出检查）、`node scripts/ref-compare-v3.ts`（参考引擎交叉校核）。
