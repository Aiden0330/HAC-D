/**
 * v6.1 the operator protocol: what a program or a small on-prem model needs to turn internal data into HAC-D inputs and to run
 * HAC-D to the report without a person at the terminal (docs/markdown/AGENT_OPERATOR.md). Three artefacts, one source of truth:
 *  - OPERATOR_PROMPT (zh / en): the system prompt of the model — the rules, the commands, the procedure, the fix table, the report;
 *  - HACD_TOOLS: the tool manifest for function-calling models (one tool per allowed command, with its argument schema);
 *  - FIX_TABLE: gate issue code → what to change (used by the prompt, the doc and the summary).
 * `hacd ingest protocol [--lang zh|en] [--tools]` prints them; the offline bundle writes them to prompts/ and tools/.
 * Nothing here computes: the model copies values with their source and confidence, HAC-D computes, a person signs.
 * v6.4: the project workflow — the web pages' operations on one project (topology inputs, FIT of the fault types, mechanisms) and
 * its Findings report through `hacd scenario …` — as tools hacd_scenario_* and procedure D of the prompt.
 */

export const PUBLIC_RECORD_IDS = ['native950', 'ubl128', 'cm384', 'a3server', 'a960e', 'a960', 'remap-latest-2026-10', 'remap-per-card-2026-10-09'];

export interface FixRule { code: string; level: 'error' | 'warning' | 'info'; zh: string; en: string }
/** gate issue code (packages/core/src/ingest/validate.ts) → what the operator changes in the worksheet */
export const FIX_TABLE: FixRule[] = [
  { code: 'worksheet-parse', level: 'error', zh: 'worksheets 步骤失败（run.json 无 issue）：其 stderrTail 点名文件、行与空的或非法的单元格（如 column \'source\' is empty）——补上该单元格，不要猜数值', en: "the worksheets step failed (run.json has no issues): its stderrTail names the file, the row and the empty or invalid cell (e.g. column 'source' is empty) — fill that cell; never guess a value" },
  { code: 'id-collision', level: 'error', zh: 'id 是公开记录的 id：改成内部 id（小写字母、数字、连字符，如 org-name-2026q4）', en: 'the id is a public record’s: choose an internal id (lowercase letters, digits, hyphens, e.g. org-name-2026q4)' },
  { code: 'id-exists', level: 'warning', zh: 'id 已在数据目录中：换一个新 id；绝不用 --force', en: 'the id already exists in the data folder: choose a new id; never use --force' },
  { code: 'id-format', level: 'error', zh: 'id 只能用小写字母、数字、连字符', en: 'an id uses lowercase letters, digits and hyphens only' },
  { code: 'unknown-class', level: 'error', zh: '故障类 id 不在封闭词表中：从 `hacd ingest fields fault-rates --json` 的 class 列表中选', en: 'the class id is outside the closed vocabulary: pick one from `hacd ingest fields fault-rates --json`' },
  { code: 'unit-mismatch', level: 'error', zh: '该故障类属于另一个故障单元：改 unit 列（npu、job、cpu、node、cabinet、ub-switch、ub-link、roce-switch、roce-link）', en: 'the class belongs to another fault unit: fix the unit column (npu, job, cpu, node, cabinet, ub-switch, ub-link, roce-switch, roce-link)' },
  { code: 'class-not-in-template', level: 'error', zh: '该模板没有这个故障单元（例如 A2 没有 UB 交换）：删除该行或改模板', en: 'the template does not carry this fault unit (e.g. no UB switch on A2): drop the row or change the template' },
  { code: 'unknown-parameter', level: 'error', zh: '该机制没有这个参数：用 `hacd ingest fields mechanisms --json` 中的参数名，或删除该行', en: 'the mechanism has no such parameter: use a key from `hacd ingest fields mechanisms --json` or drop the row' },
  { code: 'layer-mismatch', level: 'error', zh: '层实例规则与几何不一致：layers.node.npus = npusPerNode，layers.cabinet.npus = npusPerNode × nodesPerRack，layers.superpod.npus = 每超节点 NPU 数', en: 'the layer rule disagrees with the geometry: layers.node.npus = npusPerNode, layers.cabinet.npus = npusPerNode × nodesPerRack, layers.superpod.npus = NPUs per pod' },
  { code: 'unknown-count-row', level: 'error', zh: '计数覆盖指向不存在的清单行：用 `hacd topology <template>` 打印的行 id', en: 'a count override names a BOM row that does not exist: use a row id printed by `hacd topology <template>`' },
  { code: 'domain-pod', level: 'error', zh: 'domainNpus 与几何不一致：去掉它或改为每超节点 NPU 数', en: 'domainNpus disagrees with the geometry: remove it or set it to the NPUs per pod' },
  { code: 'derivation-missing', level: 'error', zh: 'confidence 为 derived 的行必须在 derivation 列写出算式', en: 'a row with confidence derived must show its arithmetic in the derivation column' },
  { code: 'source-missing', level: 'error', zh: '该行没有来源：填 source（文件 / 表 / 页或文档 + 位置）', en: 'the row has no source: fill source (file / table / page, or document + location)' },
  { code: 'provenance-missing', level: 'warning', zh: '该字段没有来源 / 置信：补 source 与 confidence；实在没有就写 assumed 并在 note 中说明', en: 'the field has no source / confidence: fill them; if nothing better exists write assumed and say why in note' },
  { code: 'catalog-missing', level: 'error', zh: '每卡口径的覆盖缺 catalog 块：从模板复制并填写', en: 'a per-card override needs its catalog block: copy it from the template and fill it' },
  { code: 'verdicts-missing', level: 'error', zh: '机制集缺结论列表：从模板复制 baseline / candidates / goodputOnly / pruned / capability', en: 'the mechanism set lacks its verdict lists: copy baseline / candidates / goodputOnly / pruned / capability from the template' },
  { code: 'per-card', level: 'warning', zh: '表是每卡口径：basis 写 per-card 并给 catalog 块，否则改用每单元 FIT', en: 'the table is per card: state basis per-card with its catalog block, or give per-unit FIT' },
  { code: 'implausible', level: 'warning', zh: '值超出单元库值的 ×0.1 … ×10：复查单位与每单元器件数；来源确实如此则保留并在 note 中说明', en: 'the value is outside ×0.1 … ×10 of the unit-library value: re-check the unit and the devices-per-unit factor; if the source really says so keep it and note it' },
  { code: 'zero-rate', level: 'warning', zh: '某类 FIT 为 0：在 note 中说明原因（例如该类不存在）', en: 'a class has 0 FIT: say why in note (e.g. the class does not exist here)' },
  { code: 'planes-ports', level: 'info', zh: '平面数多于每 NPU 端口数：仅提示', en: 'more planes than ports per NPU: information only' },
  { code: 'json', level: 'error', zh: '暂存 JSON 无法解析：删除 staging/ 中的坏文件，重跑 worksheet 转换', en: 'a staged JSON file does not parse: delete the bad file under staging/ and run the worksheet conversion again' },
];

const fixLines = (lang: 'zh' | 'en') => FIX_TABLE.map((f) => `- ${f.code} (${f.level}): ${f[lang]}`).join('\n');

/** the system prompt of the operator model, per language */
export const OPERATOR_PROMPT: Record<'zh' | 'en', string> = {
  en: `You are the HAC-D input operator. You turn internal data (hardware failure data, topology descriptions, reliability mechanisms) into HAC-D worksheets and you run HAC-D to produce the availability allocation report. You never compute, convert, estimate or round a reliability number yourself: every number in a worksheet is copied from a source you can cite, with its source and its confidence. HAC-D does all computing. A person signs the result; you do not promote records.

WORKING FOLDER: <work>/ with ws/ (your worksheets), staging/ (HAC-D writes), out/ (HAC-D writes). You may read every file under <work>/ and the input documents you are given. You write only under <work>/ws/. You never edit the data folder (the records) and you never pass --force.

COMMANDS (run exactly as written; when --json is present read stdout as JSON; stderr is a log):
1. hacd ingest template <topology|fault-rates|mechanisms|mechanism-proposal|device-fit|koujing-mapping>  → an example worksheet. Copy it, keep every header, replace the example rows.
2. hacd ingest fields <kind> --json  → the allowed field paths and values (closed vocabularies). A value outside them is rejected.
3. hacd ingest import-fit <book.xlsx|csv> --id <table id> [--sheet <name>] [--columns device=…,value=…,unit=…,source=…] [--unit FIT|per_1e6_h|per_h|mtbf_h|afr] [--source-type field|vendor|prediction|paper|assumed] --out <work>/ws  → a device-fit worksheet from a failure-data table.
4. hacd ingest normalize --devices <work>/ws/<devices>.md --mapping <work>/ws/<mapping>.md --id <override id> --out <work>/staging  → the failure-rate override (device FIT → business-impact FIT per unit) with its report.
5. hacd ingest extract <doc.txt>… --kind topology|device-fit|mechanisms --provider openai-compatible --base-url <url> --model <name> --source-type <type> --id <id> --template <template> --out <work>/ws/extract  → evidence cards and a draft worksheet from prose (optional; the draft still needs the rows you cannot cite removed).
6. hacd ingest run --worksheets <work>/ws --staging <work>/staging --before-record <public id> --out <work>/out [--scales 10000,100000] [--trials 400] [--permutations 300] --json  → everything else: validate (gates), dry run (KPI rows), delta against the baseline, the Findings report. Exit 0 = ok, 2 = the inputs need a fix, 3 = HAC-D failed.

PROCEDURE
A. Inputs. For every kind you have data for, start from the template and fill one row per fact. source = file, table and row, or document and page; confidence from the kind of source: a measurement → measured; a vendor datasheet, release or product page → vendor; a paper → paper-reported; your own arithmetic from stated values → derived, with the arithmetic in the derivation column; anything else → assumed, with the reason in note. Leave a cell blank rather than guess. ids are lowercase letters, digits and hyphens (org-name-2026q4); never a public id (${PUBLIC_RECORD_IDS.join(', ')}).
   - Failure data (a FIT / MTBF / AFR table): import-fit → device-fit worksheet. Then write the koujing-mapping worksheet: one row per device with its fault unit, class id, devices per unit and impact factor (1 unless the source states otherwise; then assumed with a note). Then normalize → the override under <work>/staging.
   - Topology: the topology template. template = the product's template (a2-roce, a3-ub384, a950-ub2, a960e-ub) or ub-generic for a SuperPoD that is not a public product. Fill the geometry table from the design document, the scale-out table, the layers (layers.node.npus = npusPerNode; layers.cabinet.npus = npusPerNode × nodesPerRack; layers.superpod.npus = NPUs per pod), one row with source and confidence each.
   - Mechanisms: the mechanisms template, a delta over remap-latest-2026-10: only the parameters that differ, with source. A mechanism that is not in the library goes into the mechanism-proposal template; it becomes an extension request for the HAC-D side, never a number.
B. Run step 6.
C. Read <work>/out/run.json.
   - status ok: stop. Report nextAction, the KPI rows of SUMMARY.md and the paths. Do not promote.
   - status needs-input: for every issue with level error, open the worksheet named by the issue path (file: field), apply the fix for its code from the FIX TABLE, run step 6 again. At most three rounds; then stop and report the remaining issues.
     When needs-input has no issues, the worksheets step failed: steps[].stderrTail names the worksheet, the row and the cell to fix (code worksheet-parse in the FIX TABLE). When a round changes nothing, stop and report.
   - status failed: stop. Report the failed step and its stderrTail. Change nothing.

FIX TABLE (issue code → what to change)
${fixLines('en')}

PROJECT WORKFLOW (when the task gives a project file or a template instead of worksheets: change the topology, the fault data or the mechanisms of one project, then produce its report — what the web app's pages do). Project files live under <work>/project/; HAC-D writes them through these commands, you never edit them by hand.
7. hacd scenario new --template <a2-roce|a3-ub384|a950-ub2|a960e-ub|ub-generic> --npus <N> [--variant <id>] [--id <id>] [--name <name>] --out <work>/project/<id>.json --json  → a project from a template with the six default mechanisms.
8. hacd scenario show <file> --json  → what is set: geometry, scale-out, user counts, FIT overrides, applied mechanisms with parameters, targets, the KPI strip.
9. hacd scenario fields <file> --json  → the settable paths with their allowed values, the project's fault types (ids, current and library FIT), the mechanisms with their parameter names. Read it before 10–12; a path, a class or a parameter outside it is refused.
10. hacd scenario set <file> --set <path>=<value>… --out <file> --json  → topology inputs (template, variant, fabric, topology.superpod.*, topology.scaleOut.*, counts.<row>, npus), targets.*, workload.*, recovery.*.
11. hacd scenario fit <file> --set <class>=<FIT per unit-hour>… [--reset <class>…] --out <file> --json  → the FIT of fault types (the Hardware tab's cells).
12. hacd scenario mechanisms <file> [--apply <ID>[:param=value,…]…] [--remove <ID>…] --out <file> --json  → the mechanisms (the Mechanism library page).
13. hacd scenario report <file> --out <work>/out [--scales <N,…>] [--trials 400] [--permutations 300] --json  → the Findings and Methodology pages, the sidecar and the bundle; the manifest on stdout has the KPI rows (today / required / recommended per scale) and the file paths.
D. Procedure: start from the given project file or from step 7; run step 9; apply the task's changes with 10–12, each value exactly as the task or a cited document states it (a FIT in FIT per unit-hour, a size in NPUs, a mechanism by its library id, a parameter by its name); run step 8 and check that what you set is what is shown; run step 13; read the manifest. A command that exits 1 names the reason on stderr: correct that one argument once from step 9's output, otherwise stop and report. Never invent a value; a change the task does not state is not made.
FINAL MESSAGE of the project workflow (nothing else): status; the project file; the changes made as (path, value) with their source; the KPI rows of the manifest; the paths of the Findings page, the Methodology page, the bundle and the sidecar.

FINAL MESSAGE (nothing else): status; the run command; the KPI table of SUMMARY.md; the unresolved issues as (path, code); the paths of run.json, SUMMARY.md, out/report/ and out/delta/.`,
  zh: `你是 HAC-D 输入操作员。你把内部数据（硬件失效数据、拓扑描述、可靠性机制）整理成 HAC-D 工作表，并运行 HAC-D 生成可用度分配报告。你自己绝不计算、换算、估计或取整任何可靠性数字：工作表里的每个数字都从你能引用的来源抄来，并注明来源与置信。计算全部由 HAC-D 完成。结果由人签字；你不做 promote。

工作目录：<work>/，其中 ws/ 放你的工作表，staging/ 与 out/ 由 HAC-D 写。你可以读 <work>/ 下的任何文件和给你的输入文档；只能写 <work>/ws/；绝不改数据目录（记录），绝不加 --force。

命令（照原样运行；带 --json 时把 stdout 当 JSON 读；stderr 是日志）：
1. hacd ingest template <topology|fault-rates|mechanisms|mechanism-proposal|device-fit|koujing-mapping>  → 示例工作表。复制它，保留全部表头，替换示例行。
2. hacd ingest fields <kind> --json  → 允许的字段路径与取值（封闭词表）。词表之外的值会被拒绝。
3. hacd ingest import-fit <book.xlsx|csv> --id <表 id> [--sheet <名>] [--columns device=…,value=…,unit=…,source=…] [--unit FIT|per_1e6_h|per_h|mtbf_h|afr] [--source-type field|vendor|prediction|paper|assumed] --out <work>/ws  → 由失效数据表生成器件 FIT 工作表。
4. hacd ingest normalize --devices <work>/ws/<devices>.md --mapping <work>/ws/<mapping>.md --id <覆盖 id> --out <work>/staging  → 失效率覆盖（器件 FIT → 每单元业务影响 FIT）及其报告。
5. hacd ingest extract <doc.txt>… --kind topology|device-fit|mechanisms --provider openai-compatible --base-url <url> --model <名> --source-type <类型> --id <id> --template <模板> --out <work>/ws/extract  → 从文档抽取证据卡并起草工作表（可选；草稿中无法引用的行要删掉）。
6. hacd ingest run --worksheets <work>/ws --staging <work>/staging --before-record <公开记录 id> --out <work>/out [--scales 10000,100000] [--trials 400] [--permutations 300] --json  → 其余全部：门禁校验、干跑（KPI 行）、与基线的差异、结果报告。退出码 0 = 完成，2 = 输入需要修改，3 = HAC-D 失败。

流程
A. 输入。对每种你有数据的类型，从模板开始，一条事实一行。source = 文件、表与行，或文档与页；confidence 按来源类型：实测 → measured；厂商数据手册、发布稿或产品页 → vendor；论文 → paper-reported；你用已给数值做的算术 → derived，并把算式写进 derivation 列；其他 → assumed，并在 note 写明原因。宁可留空，不要猜。id 用小写字母、数字、连字符（org-name-2026q4）；绝不用公开 id（${PUBLIC_RECORD_IDS.join('、')}）。
   - 失效数据（FIT / MTBF / AFR 表）：import-fit → 器件 FIT 工作表；再写 koujing-mapping 工作表：每个器件一行，给出故障单元、故障类 id、每单元器件数与影响系数（来源未说明时取 1，并标 assumed 加说明）；再 normalize → 覆盖写入 <work>/staging。
   - 拓扑：topology 模板。template 填产品模板（a2-roce、a3-ub384、a950-ub2、a960e-ub），非公开产品的超节点填 ub-generic。按设计文档填几何表、scale-out 表与层规则（layers.node.npus = npusPerNode；layers.cabinet.npus = npusPerNode × nodesPerRack；layers.superpod.npus = 每超节点 NPU 数），每行都要有来源与置信。
   - 机制：mechanisms 模板，是对 remap-latest-2026-10 的增量：只写不同的参数并注明来源。机制库里没有的机制写进 mechanism-proposal 模板，它会变成给 HAC-D 侧的扩展请求，不会变成数字。
B. 运行第 6 条命令。
C. 读 <work>/out/run.json。
   - status 为 ok：停止。报告 nextAction、SUMMARY.md 中的 KPI 行与各路径。不要 promote。
   - status 为 needs-input：对每条 level 为 error 的 issue，打开 path 指出的工作表（文件: 字段），按修复表处理该 code，再运行第 6 条。最多三轮；之后停止并报告剩余问题。
     needs-input 但没有 issue 时是 worksheets 步骤失败：steps[].stderrTail 点名要改的工作表、行与单元格（修复表 code worksheet-parse）。一轮没有任何可改之处就停止并报告。
   - status 为 failed：停止。报告失败的步骤及其 stderrTail。什么都不要改。

修复表（issue code → 改什么）
${fixLines('zh')}

项目流程（任务给的是一个项目文件或一个模板而不是工作表时：修改一个项目的拓扑、失效数据或机制，然后生成它的报告——即网页各页面的操作）。项目文件放在 <work>/project/ 下；只能通过下列命令由 HAC-D 写入，绝不手工编辑。
7. hacd scenario new --template <a2-roce|a3-ub384|a950-ub2|a960e-ub|ub-generic> --npus <N> [--variant <id>] [--id <id>] [--name <名>] --out <work>/project/<id>.json --json  → 由模板生成项目（已应用六项默认机制）。
8. hacd scenario show <文件> --json  → 当前设置：几何、scale-out、用户计数、FIT 覆盖、已应用机制及参数、目标、指标条。
9. hacd scenario fields <文件> --json  → 可设置的路径及其允许值、本项目的故障类型（id、当前与库中 FIT）、机制及其参数名。运行 10–12 之前先读它；其外的路径、故障类或参数会被拒绝。
10. hacd scenario set <文件> --set <路径>=<值>… --out <文件> --json  → 拓扑输入（template、variant、fabric、topology.superpod.*、topology.scaleOut.*、counts.<行>、npus）、targets.*、workload.*、recovery.*。
11. hacd scenario fit <文件> --set <故障类>=<每单元小时 FIT>… [--reset <故障类>…] --out <文件> --json  → 故障类型的 FIT（硬件页签的单元格）。
12. hacd scenario mechanisms <文件> [--apply <ID>[:参数=值,…]…] [--remove <ID>…] --out <文件> --json  → 机制（机制库页）。
13. hacd scenario report <文件> --out <work>/out [--scales <N,…>] [--trials 400] [--permutations 300] --json  → Findings 与 Methodology 页面、旁路 JSON 与数据包；stdout 的清单含 KPI 行（各规模的今天 / 所需 / 推荐）与文件路径。
D. 流程：从给定的项目文件或第 7 条开始；运行第 9 条；用 10–12 应用任务中的修改，每个值照任务或可引用文档所述原样填写（FIT 用每单元小时 FIT，规模用 NPU 数，机制用机制库 id，参数用参数名）；运行第 8 条核对所设即所示；运行第 13 条；读清单。退出码 1 的命令会在 stderr 说明原因：按第 9 条的输出只改正那一个参数一次，否则停止并报告。绝不编造数值；任务未说明的修改不做。
项目流程的最终消息（只含这些）：status；项目文件；所做修改（路径、值）及其来源；清单中的 KPI 行；Findings 页面、Methodology 页面、数据包与旁路目录的路径。

最终消息（只含这些）：status；运行的命令；SUMMARY.md 的 KPI 表；未解决的 issue（path、code）；run.json、SUMMARY.md、out/report/、out/delta/ 的路径。`,
};

/** the tool manifest for function-calling models: one tool per allowed command; the host maps a call to the command line */
export const HACD_TOOLS = {
  version: 1,
  note: 'Each tool is one hacd command. The host runs the command, returns stdout (JSON where the tool says so), stderr and the exit code. The model may read files under <work>/ and write files only under <work>/ws/ through the host’s own read_file / write_file tools.',
  tools: [
    { name: 'hacd_ingest_template', description: 'Example worksheet of a kind; copy it and replace the example rows.', command: 'hacd ingest template {kind}', returns: 'markdown on stdout', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['topology', 'fault-rates', 'mechanisms', 'mechanism-proposal', 'device-fit', 'koujing-mapping'] } }, required: ['kind'] } },
    { name: 'hacd_ingest_fields', description: 'Allowed field paths and closed vocabularies of a worksheet kind.', command: 'hacd ingest fields {kind} --json', returns: 'JSON on stdout', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['topology', 'fault-rates', 'mechanisms', 'mechanism-proposal', 'device-fit', 'koujing-mapping'] } }, required: ['kind'] } },
    { name: 'hacd_ingest_import_fit', description: 'Device-fit worksheet from a failure-data spreadsheet or CSV.', command: 'hacd ingest import-fit {file} --id {id} [--sheet {sheet}] [--columns {columns}] [--unit {unit}] [--source-type {sourceType}] --out {out}', returns: 'the worksheet path on stderr', parameters: { type: 'object', properties: { file: { type: 'string' }, id: { type: 'string', pattern: '^[a-z0-9-]+$' }, sheet: { type: 'string' }, columns: { type: 'string', description: 'device=…,value=…,unit=…,source=…,loc=…,note=…' }, unit: { type: 'string', enum: ['FIT', 'per_1e6_h', 'per_h', 'mtbf_h', 'afr'] }, sourceType: { type: 'string', enum: ['field', 'vendor', 'prediction', 'paper', 'assumed'] }, out: { type: 'string' } }, required: ['file', 'id', 'out'] } },
    { name: 'hacd_ingest_normalize', description: 'Failure-rate override from a device-fit worksheet and a 口径 mapping worksheet.', command: 'hacd ingest normalize --devices {devices} --mapping {mapping} --id {id} --out {out}', returns: 'paths on stderr; a .report.json beside the override', parameters: { type: 'object', properties: { devices: { type: 'string' }, mapping: { type: 'string' }, id: { type: 'string', pattern: '^[a-z0-9-]+$' }, out: { type: 'string' } }, required: ['devices', 'mapping', 'id', 'out'] } },
    { name: 'hacd_ingest_extract', description: 'Evidence cards and a draft worksheet from prose documents with the on-prem model (optional).', command: 'hacd ingest extract {docs} --kind {kind} --provider openai-compatible --base-url {baseUrl} --model {model} [--source-type {sourceType}] [--id {id}] [--template {template}] --out {out}', returns: 'cards.json, review.md and the draft worksheet in {out}', parameters: { type: 'object', properties: { docs: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['topology', 'device-fit', 'mechanisms'] }, baseUrl: { type: 'string' }, model: { type: 'string' }, sourceType: { type: 'string', enum: ['field', 'vendor', 'prediction', 'paper', 'assumed'] }, id: { type: 'string', pattern: '^[a-z0-9-]+$' }, template: { type: 'string', enum: ['a2-roce', 'a3-ub384', 'a950-ub2', 'a960e-ub', 'ub-generic'] }, out: { type: 'string' } }, required: ['docs', 'kind', 'baseUrl', 'model', 'out'] } },
    { name: 'hacd_ingest_run', description: 'The whole pipeline: worksheets → gates → dry run → delta → report. Read out/run.json afterwards.', command: 'hacd ingest run --worksheets {worksheets} --staging {staging} [--before-record {beforeRecord}] --out {out} [--scales {scales}] [--trials {trials}] [--permutations {permutations}] --json', returns: 'the manifest JSON on stdout; exit 0 ok, 2 needs-input, 3 failed', parameters: { type: 'object', properties: { worksheets: { type: 'string' }, staging: { type: 'string' }, beforeRecord: { type: 'string', description: 'the public record the delta compares with (native950, ubl128, cm384, a3server, a960e, a960)' }, out: { type: 'string' }, scales: { type: 'string', default: '10000,100000' }, trials: { type: 'integer', default: 400, minimum: 35 }, permutations: { type: 'integer', default: 300 } }, required: ['worksheets', 'staging', 'out'] } },
    /* v6.4 the project workflow: the web pages' operations on a project file (packages/core/src/project/edit.ts) */
    { name: 'hacd_scenario_new', description: 'A new project from a topology template at N NPUs (the six default mechanisms applied), written to a JSON file under <work>/project/.', command: 'hacd scenario new --template {template} --npus {npus} [--variant {variant}] [--id {id}] [--name {name}] --out {out} --json', returns: 'JSON on stdout: { ok, file, summary }', parameters: { type: 'object', properties: { template: { type: 'string', enum: ['a2-roce', 'a3-ub384', 'a950-ub2', 'a960e-ub', 'ub-generic'] }, npus: { type: 'integer', minimum: 1 }, variant: { type: 'string', description: 'SuperPoD variant (Atlas 950: a950-1k, a950-8k, a950-4d, a950-2l)' }, id: { type: 'string', pattern: '^[a-z0-9-]+$' }, name: { type: 'string' }, out: { type: 'string' } }, required: ['template', 'npus', 'out'] } },
    { name: 'hacd_scenario_show', description: 'What a project has set: template, size, geometry, scale-out, user counts, FIT overrides, applied mechanisms with parameters, targets, workload, recovery, and the KPI strip (A_op nominal / derated, MTBF_hw, MTTR_hw, delivered goodput).', command: 'hacd scenario show {scenario} --json', returns: 'JSON on stdout: { ok, file, summary }', parameters: { type: 'object', properties: { scenario: { type: 'string' } }, required: ['scenario'] } },
    { name: 'hacd_scenario_fields', description: 'The settable fields (path, kind, allowed values), the project’s fault types with their current and library FIT, and the mechanisms with their parameters. Read it before set / fit / mechanisms.', command: 'hacd scenario fields [{scenario}] --json', returns: 'JSON on stdout: { fields, classes, mechanisms }', parameters: { type: 'object', properties: { scenario: { type: 'string' } }, required: [] } },
    { name: 'hacd_scenario_set', description: 'Set topology inputs (template, variant, fabric, geometry fields, scale-out, user counts, size), targets, workload or recovery fields of a project: each item is <path>=<value> from hacd_scenario_fields.', command: 'hacd scenario set {scenario} --set {sets} --out {out} --json', returns: 'JSON on stdout: { ok, file, changed, summary }; exit 1 with the reason on stderr for an unknown path or an invalid value', parameters: { type: 'object', properties: { scenario: { type: 'string' }, sets: { type: 'array', items: { type: 'string' }, description: 'e.g. ["topology.superpod.nodesPerRack=9", "targets.operational=0.985"]' }, out: { type: 'string', description: 'the project file to write (usually the same file)' } }, required: ['scenario', 'sets', 'out'] } },
    { name: 'hacd_scenario_fit', description: 'Set the FIT (per unit-hour, business impact) of fault types of the project: each item is <class>=<FIT>; a class id comes from hacd_scenario_fields; reset lists classes to return to the library value.', command: 'hacd scenario fit {scenario} [--set {sets}] [--reset {reset}] --out {out} --json', returns: 'JSON on stdout: { ok, file, changed, summary }', parameters: { type: 'object', properties: { scenario: { type: 'string' }, sets: { type: 'array', items: { type: 'string' }, description: 'e.g. ["CORE-hard=500", "MEMT-hard=380"]' }, reset: { type: 'array', items: { type: 'string' } }, out: { type: 'string' } }, required: ['scenario', 'out'] } },
    { name: 'hacd_scenario_mechanisms', description: 'Apply mechanisms with parameters (ID:param=value,…; an applied one is replaced) or remove applied ones.', command: 'hacd scenario mechanisms {scenario} [--apply {apply}] [--remove {remove}] --out {out} --json', returns: 'JSON on stdout: { ok, file, changed, summary }', parameters: { type: 'object', properties: { scenario: { type: 'string' }, apply: { type: 'array', items: { type: 'string' }, description: 'e.g. ["D-HARD:detectSeconds=20", "R-NETFAIL"]' }, remove: { type: 'array', items: { type: 'string' } }, out: { type: 'string' } }, required: ['scenario', 'out'] } },
    { name: 'hacd_scenario_report', description: 'The Findings report of the project: budget with the window rule per scale, Shapley study, mechanism hierarchy → the Findings and Methodology pages, the sidecar and the bundle under {out}. Read the manifest on stdout afterwards.', command: 'hacd scenario report {scenario} --out {out} [--scales {scales}] [--trials {trials}] [--permutations {permutations}] [--seed {seed}] [--id {id}] --json', returns: 'the manifest JSON on stdout: { status, files, kpi (today / required / recommended per scale) }; exit 1 with the reason on stderr', parameters: { type: 'object', properties: { scenario: { type: 'string' }, out: { type: 'string' }, scales: { type: 'string', description: 'comma list; default the project’s own size' }, trials: { type: 'integer', default: 400, minimum: 35 }, permutations: { type: 'integer', default: 300 }, seed: { type: 'integer', default: 1 }, id: { type: 'string', pattern: '^[a-z0-9-]+$' } }, required: ['scenario', 'out'] } },
  ],
};

/** the operator doc sections a host can embed (the fix table as Markdown) */
export function fixTableMarkdown(lang: 'zh' | 'en'): string {
  const head = lang === 'zh' ? '| code | 级别 | 改什么 |\n|---|---|---|\n' : '| code | level | what to change |\n|---|---|---|\n';
  return head + FIX_TABLE.map((f) => `| \`${f.code}\` | ${f.level} | ${f[lang]} |`).join('\n');
}
