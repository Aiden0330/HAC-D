#!/usr/bin/env node
/**
 * Build docs/HACD_REMAP_COMPARISON.{zh,en}.html from docs/hacd-remap-comparison/results.json (scripts/hacd-remap-comparison.ts):
 * (1) whether HAC-D's fault data and mechanism parameters are the values of github.com/lzq0927/remap and
 * github.com/zy009197/ai-cluster-reliability, and where HAC-D's topology layer departs from them; (2) the “950 与 910C” report
 * (~/Documents/projects/output/HAC-D-950-910C-default-six.html) reproduced and its differences from
 * docs/ASCEND950_SCALING_RELIABILITY decomposed; (3) HAC-D's availability and goodput formulas against ReMAP's, with both engines
 * run on the same event rates.
 * Usage: node scripts/build-hacd-remap-comparison.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { esc, fmt } from './ascend950-figures.mjs';

const R = JSON.parse(readFileSync('docs/hacd-remap-comparison/results.json', 'utf8'));
const DATE = R.generated.slice(0, 10);
const SIZES = R.sizes;
const H = (id, n) => R.results[id][String(n)];
const E = (id, n) => R.engine[id][String(n)];
const pct = (x, d = 3) => `${(x * 100).toFixed(d)} %`;
const pp = (x, d = 3) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}`;
const kN = (n) => (n >= 1000 ? `${fmt(n / 1000)}k` : fmt(n));

function page(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const NAME = {
    refcat: T('仓库原值（每卡 FIT，无拓扑换算）', 'Repository values (FIT per card, no topology conversion)'),
    a3tpl: T('910C · CloudMatrix384 模板', '910C · CloudMatrix384 template'),
    a950tpl: T('950 · 模板默认（另一份报告）', '950 · template default (the other report)'),
    a950main: T('950 · 本项目主算例', '950 · main case of the scaling report'),
    ubl128main: T('UBL128 · 本项目主算例', 'UBL128 · main case of the scaling report'),
  };
  const DES = ['refcat', 'a3tpl', 'a950tpl', 'a950main', 'ubl128main'];

  /* 1. repository checks */
  const checkName = {
    'repos.identical': T('两个仓库的目录文件一致', 'Catalog files identical in both repositories'),
    events: T('54 个事件：FIT、类别、域、描述、范围、持续性、三个恢复标志', '54 events: FIT, class, domain, description, scope, persistence, three recovery flags'),
    'mechanisms.parameters': T('机制参数（mechanism-policy.json）', 'Mechanism parameters (mechanism-policy.json)'),
    'mechanisms.applicability': T('机制适用事件（mechanisms.json eventIds）', 'Mechanism applicability (mechanisms.json eventIds)'),
    baseline: T('作业与恢复基线（ReMAP config.json = reference.cjs）', 'Job and recovery baseline (ReMAP config.json = reference.cjs)'),
    audit16: T('16 项新机制审核数据', 'The 16 audited mechanisms'),
    'units.derived': T('HAC-D 单元 FIT 由每卡 FIT 推得', 'HAC-D unit FIT derived from the per-card FIT'),
    'units.calibration': T('CloudMatrix384 几何下换算回目录值', 'Conversion returns the catalog at the CloudMatrix384 geometry'),
  };
  const shaOf = (R.refcheck.checks.find((c) => c.id === 'repos.identical')?.detail.match(/sha256 inputs\.json ([0-9a-f]+)/) ?? [])[1] ?? '';
  const cal = R.refcheck.checks.find((c) => c.id === 'units.calibration')?.detail.match(/([\d.]+) hard FIT per NPU = catalog ([\d.]+); at 10,000 NPUs ([\d.]+)/) ?? [];
  const zhDetail = {
    'repos.identical': `inputs.json、mechanisms.json、mechanism-policy.json、engine.cjs、reference.cjs 在两个仓库中逐字节相同（inputs.json sha256 ${shaOf}…）`,
    events: '54 / 54 个事件的每卡 FIT、类别、域、描述、范围、持续性与重执行 / 进程 / 弹性标志全部相同；每卡 FIT 中断 3,333.333333、亚健康 69.013112、静默 48.309179（合计 3,450.655625，与仓库相同）',
    'mechanisms.parameters': 'mechanism-policy.json 中 D-HARD、D-SLOW、D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST 的全部参数与 HAC-D 机制库相同',
    'mechanisms.applicability': 'mechanisms.json 中 7 个机制的适用事件清单与 HAC-D 实际作用的事件相同',
    baseline: '16 项作业与恢复设置相同：CKPT 计算 300 s / 保存 4 s；检测 95 % 在 10 s、其余 60 s；自动恢复 180 s、成功 99 %，失败加人工 7,200 s；亚健康检出 95 %、5 min，持续 24 h、降速 5 %；静默即时检出 0、120 h 兜底；窗口 720 h；retain-last-clean',
    audit16: 'ReMAP 的《新可靠性机制库-单点量化》JSON 与 HAC-D 的 packages/core/data/mechanism-audit.json 逐字节相同',
    'units.derived': '60 个单元故障类型（54 类 + 6 个 scale-out 类比）的每卡 FIT 等于目录值；单元 FIT = 每卡 FIT × CloudMatrix384 中每单元卡数',
    'units.calibration': `CloudMatrix384 几何、去掉 scale-out、9,984 卡（26 个整超节点）时每 NPU 硬中断 ${cal[1] ?? ''} FIT = 目录 ${cal[2] ?? ''}；10,000 卡时 ${cal[3] ?? ''}（末尾部分超节点取整）`,
  };
  const checks = R.refcheck.checks.map((c) => `<tr><td>${esc(checkName[c.id] ?? c.id)}</td><td class="${c.pass ? 'ok' : 'bad'}">${c.pass ? 'PASS' : 'FAIL'}</td><td class="src">${esc(lang === 'zh' ? zhDetail[c.id] ?? c.detail : c.detail)}</td></tr>`).join('');
  const table1 = `<div class="table-wrap"><table class="t1"><thead><tr><th>${esc(T('检查项', 'Check'))}</th><th>${esc(T('结果', 'Result'))}</th><th>${esc(T('细节', 'Detail'))}</th></tr></thead><tbody>${checks}</tbody></table></div>`;
  const UNITS = [['npu', T('NPU', 'NPU')], ['job', T('作业级服务', 'Job-level services')], ['node', T('节点', 'Node')], ['cpu', 'CPU'], ['cabinet', T('计算柜', 'Cabinet')], ['ub-switch', T('UB 交换', 'UB switch')], ['ub-link', T('UB 光链路', 'UB link')], ['roce-switch', T('scale-out 交换（类比，新增）', 'Scale-out switch (analogue, added)')], ['roce-link', T('scale-out 链路（类比，新增）', 'Scale-out link (analogue, added)')]];
  const catByUnit = { 'roce-switch': 0, 'roce-link': 0, ...R.catalogByUnit };
  const tplCols = [['a3tpl', 'A3 / 910C'], ['a950tpl', T('950 模板', '950 template')], ['a950main', T('950 主算例', '950 main')], ['ubl128main', 'UBL128']];
  const fitRows = UNITS.map(([u, label]) => `<tr><td>${esc(label)}</td><td class="num">${fmt(catByUnit[u], 1)}</td>${tplCols.map(([id]) => { const v = R.fitBreakdown[id][u] ?? 0; const dlt = v - catByUnit[u]; return `<td class="num">${fmt(v, 1)}${Math.abs(dlt) > 0.05 ? ` <span class="d">(${dlt > 0 ? '+' : '−'}${fmt(Math.abs(dlt), 1)})</span>` : ''}</td>`; }).join('')}</tr>`).join('');
  const tot = (id) => Object.values(R.fitBreakdown[id]).reduce((a, b) => a + b, 0);
  const table2 = `<div class="table-wrap"><table class="t2"><thead><tr><th>${esc(T('硬中断 FIT / NPU（1 万卡）', 'Hard FIT per NPU (10k NPUs)'))}</th><th class="num">${esc(T('仓库每卡', 'Repository per card'))}</th>${tplCols.map(([, l]) => `<th class="num">${esc(l)}</th>`).join('')}</tr></thead><tbody>${fitRows}<tr class="b"><td>${esc(T('合计', 'Total'))}</td><td class="num">3,333.3</td>${tplCols.map(([id]) => `<td class="num">${fmt(tot(id), 1)} <span class="d">(${((tot(id) / 3333.3333333 - 1) * 100).toFixed(1)} %)</span></td>`).join('')}</tr></tbody></table></div>`;

  /* 2. the other report */
  const rep = (id) => SIZES.map((n) => { const o = R.other[id][String(n)], h = H(id, n); return `<tr><td>${esc(NAME[id])}</td><td class="num">${fmt(n)}</td><td class="num">${pct(o.aOp, 4)} / ${pct(h.aOp, 4)}</td><td class="num">${fmt(o.mtbfHwH, 4)} / ${fmt(h.mtbfHwH, 4)}</td><td class="num">${fmt(o.mttrS, 2)} / ${fmt(h.mttrS, 2)}</td><td class="num">${pct(o.delivered, 4)} / ${pct(h.delivered, 4)}</td><td class="ok">✓</td></tr>`; }).join('');
  const table3 = `<div class="table-wrap"><table class="t3"><thead><tr><th>${esc(T('方案', 'Design'))}</th><th class="num">NPU</th><th class="num">${esc(T('A_op 另一份 / 复算', 'A_op other / re-run'))}</th><th class="num">${esc(T('MTBF_hw h 另一份 / 复算', 'MTBF_hw h other / re-run'))}</th><th class="num">${esc(T('MTTR_hw s 另一份 / 复算', 'MTTR_hw s other / re-run'))}</th><th class="num">${esc(T('正确有效产出 另一份 / 复算', 'Delivered goodput other / re-run'))}</th><th></th></tr></thead><tbody>${rep('a950tpl')}${rep('a3tpl')}</tbody></table></div>`;
  const dec = SIZES.map((n) => { const t = H('a950tpl', n), m = H('a950main', n), r = H('refcat', n); return `<tr><td class="num b">${fmt(n)}</td><td class="num">${pct(r.aOp)}</td><td class="num">${pct(t.aOp)} <span class="d">(${pp(t.aOp - r.aOp)})</span></td><td class="num">${pct(m.aOp)} <span class="d">(${pp(m.aOp - t.aOp, 4)})</span></td><td class="num">${fmt(r.hardFitPerNpu, 1)} → ${fmt(t.hardFitPerNpu, 1)} → ${fmt(m.hardFitPerNpu, 1)}</td><td class="num">${fmt(r.mttrS, 2)} → ${fmt(t.mttrS, 2)} → ${fmt(m.mttrS, 2)}</td><td class="num">${fmt(t.scaleOutSwitches)} (${t.scaleOutTiers}) → ${fmt(m.scaleOutSwitches)} (${m.scaleOutTiers})</td><td class="num">${kN(t.scaleOutLinks)} → ${kN(m.scaleOutLinks)}</td></tr>`; }).join('');
  const table4 = `<div class="table-wrap"><table class="t4"><thead><tr><th class="num">NPU</th><th class="num">${esc(T('① 仓库每卡', '① Repository per card'))}</th><th class="num">${esc(T('② 950 模板（另一份）', '② 950 template (other report)'))}</th><th class="num">${esc(T('③ 950 主算例（本项目）', '③ 950 main case (scaling report)'))}</th><th class="num">${esc(T('硬中断 FIT / NPU ① → ② → ③', 'Hard FIT per NPU ① → ② → ③'))}</th><th class="num">${esc(T('MTTR_hw s ① → ② → ③', 'MTTR_hw s ① → ② → ③'))}</th><th class="num">${esc(T('scale-out 交换机（层）② → ③', 'Scale-out switches (tiers) ② → ③'))}</th><th class="num">${esc(T('scale-out 链路 ② → ③', 'Scale-out links ② → ③'))}</th></tr></thead><tbody>${dec}</tbody></table></div>`;

  /* 3. engines on the same rates */
  const eng = DES.map((id) => SIZES.map((n) => { const e = E(id, n), h = H(id, n); const da = h.aOp - e.review.aOp.mean, dg = h.delivered - e.review.delivered.mean; const inA = Math.abs(da) <= e.review.aOp.ci95 * 1.5, inG = Math.abs(dg) <= e.review.delivered.ci95 * 1.5; return `<tr><td>${n === SIZES[0] ? esc(NAME[id]) : ''}</td><td class="num">${fmt(n)}</td><td class="num">${pct(h.aOp, 4)}</td><td class="num">${pct(e.review.aOp.mean, 4)} ± ${(e.review.aOp.ci95 * 100).toFixed(4)}</td><td class="num${inA ? '' : ' mid'}">${pp(da, 4)}</td><td class="num">${pct(h.delivered, 3)}</td><td class="num">${pct(e.review.delivered.mean, 3)} ± ${(e.review.delivered.ci95 * 100).toFixed(3)}</td><td class="num${inG ? '' : ' mid'}">${pp(dg, 3)}</td></tr>`; }).join('')).join('');
  const table5 = `<div class="table-wrap"><table class="t5"><thead><tr><th>${esc(T('方案（同一事件率）', 'Design (same event rates)'))}</th><th class="num">NPU</th><th class="num">${esc(T('HAC-D A_op（闭式）', 'HAC-D A_op (closed form)'))}</th><th class="num">${esc(T('ReMAP 运行可用度（MC ± 95 %）', 'ReMAP operational availability (MC ± 95 %)'))}</th><th class="num">Δ pt</th><th class="num">${esc(T('HAC-D 正确有效产出', 'HAC-D delivered goodput'))}</th><th class="num">${esc(T('ReMAP“可用度”= 保留正确进度（MC ± 95 %）', 'ReMAP “availability” = retained clean progress (MC ± 95 %)'))}</th><th class="num">Δ pt</th></tr></thead><tbody>${eng}</tbody></table></div>`;
  const maxDa = Math.max(...DES.flatMap((id) => SIZES.map((n) => Math.abs(H(id, n).aOp - E(id, n).review.aOp.mean))));
  const maxDg = Math.max(...DES.flatMap((id) => SIZES.map((n) => Math.abs(H(id, n).delivered - E(id, n).review.delivered.mean))));

  const mapRows = [
    [T('运行可用度', 'Operational availability'), 'A_op = (1 − φ_SDC) / (1 + Σᵢ λᵢ t̄ᵢ / 3600 + λ_iso R_iso / 3600 + λ_det R_det / 3600)', 'E[1 − downtime / T]', T('同一定义：作业在窗口内处于运行状态的时间份额。HAC-D 为稳态更新过程闭式，ReMAP 为 720 h 窗口的蒙特卡洛', 'Same definition: the share of time the job is running. HAC-D: steady-state renewal closed form; ReMAP: Monte Carlo over a 720 h window')],
    [T('主指标', 'Headline metric'), T('HAC-D 的“系统可用度”= A_op（目标默认 98.5 %）', 'HAC-D “system availability” = A_op (default target 98.5 %)'), T('ReMAP 的“可用度”= training.retained-clean-progress（目标 99 / 95 / 90 / 80 %）', 'ReMAP “availability” = training.retained-clean-progress (targets 99 / 95 / 90 / 80 %)'), T('名称相同、量不同：ReMAP 的“可用度”对应 HAC-D 的正确有效产出，不是 A_op', 'Same name, different quantity: ReMAP’s “availability” is HAC-D’s delivered goodput, not A_op')],
    [T('正确有效产出', 'Delivered goodput'), T('G = [1 − δ/τ − (P_rb·τ/2 + R̄)/M]（一阶，小参数成立时；否则精确更新）× 降速 × (1 − 局部) × (1 − 阻塞)，再按窗口计漏检静默的回滚与尾段（retain-last-clean）', 'G = [1 − δ/τ − (P_rb·τ/2 + R̄)/M] (first order while the small-parameter test holds, else exact renewal) × slowdown × (1 − local) × (1 − blocked), then the window’s undetected-SDC rollback and tail (retain-last-clean)'), 'E[correct / T]，T = correct + downtime + save + slowdown + rollback + terminalInvalid + localLoss', T('同一定义（保留的正确进度 ÷ 窗口）。HAC-D 闭式，ReMAP 逐事件台账', 'Same definition (retained correct progress ÷ window). HAC-D closed form; ReMAP per-event ledger')],
    [T('事件率', 'Event rates'), 'λᵢ = n_u(i) · FITᵢ,unit · 10⁻⁹（拓扑单元数 × 单元 FIT）', 'λ_class = N · FIT_class,card · 10⁻⁹，类内按 FIT 抽事件', T('拓扑模板下唯一的实质差别（表 2）；仓库口径下两者相同', 'The only substantive difference under the topology templates (Table 2); identical under the repository arithmetic')],
    ['MTBF / MTTR', 'MTBF_hw = 1/Σλᵢ，MTTR_hw = Σλᵢt̄ᵢ/Σλᵢ，A_op = (1 − φ)/(1 + MTTR_hw/MTBF_hw + Σ_k MTTR_k/MTBF_k)', T('不报告；对象 MTBF = 10⁹ / (N · FIT)', 'not reported; object MTBF = 10⁹ / (N · FIT)'), T('HAC-D 的分解在 ReMAP 中没有对应量', 'HAC-D’s decomposition has no ReMAP counterpart')],
    [T('子模型分配', 'Sub-model allocation'), T('AGREE / ARINC / 最省力分配（对 A_op 或有效产出）', 'AGREE / ARINC / least-effort allocation (on A_op or goodput)'), 'A = Πᵢ Aᵢ，Aᵢ = A*^{wᵢ}，λᵢ = (1/Aᵢ − 1)/MTTRᵢ（availability.log-budget.v1）', T('ReMAP 的串联稳态可用度只用于独立子模型，文档明确不用于训练正确交付', 'ReMAP’s series steady-state availability is for independent sub-models only; its docs say it does not apply to training delivery')],
  ];
  const table6 = `<div class="table-wrap"><table class="t6"><thead><tr><th>${esc(T('项目', 'Item'))}</th><th>HAC-D</th><th>ReMAP</th><th>${esc(T('关系', 'Relation'))}</th></tr></thead><tbody>${mapRows.map((r) => `<tr><td class="b">${esc(r[0])}</td><td class="f">${esc(r[1])}</td><td class="f">${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody></table></div>`;
  const e500 = E('refcat', 500000), h500 = H('refcat', 500000);
  const detail = [
    T(`<b>亚健康隔离</b>：ReMAP 检出固定 5 min、片段固定 24 h，凡检出必隔离；HAC-D 用竞争指数，隔离概率 0.95 × 24 / (24 + 1/12)，少 0.35 %（50 万卡对 A_op 影响约 0.0007 pt）。`, `<b>Isolation of sub-healthy units</b>: ReMAP detects after a fixed 5 min and the episode lasts a fixed 24 h, so every detected episode is isolated; HAC-D uses competing exponentials, 0.95 × 24 / (24 + 1/12), 0.35 % fewer (≈ 0.0007 pt of A_op at 500k).`),
    T(`<b>即时检出的静默错误</b>：ReMAP 停机 2 s（检测 1 s + 恢复 1 s）、1 s 重算记为回滚；HAC-D 把 3 s 都记为暂停（50 万卡约 0.0006 pt）。`, `<b>Detected silent corruption</b>: ReMAP pauses 2 s (1 s detection + 1 s recovery) and books the 1 s redo as rollback; HAC-D counts all 3 s as pause (≈ 0.0006 pt at 500k).`),
    T(`<b>保存开销</b>：HAC-D 一阶式取 δ/τ = 1/60 = ${pct(h500.ledger.save, 3)} 且作用于整个窗口；ReMAP 只在运行时保存，比例 δ/(τ+δ) × 运行份额（50 万卡 ${pct(e500.review.ledger.save, 3)}）。`, `<b>Checkpoint save</b>: HAC-D’s first order takes δ/τ = 1/60 = ${pct(h500.ledger.save, 3)} over the whole window; ReMAP saves only while running, δ/(τ+δ) × running share (${pct(e500.review.ledger.save, 3)} at 500k).`),
    T(`<b>停机项</b>：HAC-D 有效产出的一阶分解用事件钟上的 R̄/M（50 万卡 ${pct(h500.ledger.downtime, 2)}），比精确运行份额 1 − A_op（${pct(1 - h500.aOp, 2)}）略大；ReMAP 的停机（${pct(e500.review.ledger.downtime, 2)}）对应后者。`, `<b>Downtime term</b>: HAC-D’s first-order goodput uses R̄/M on the event clock (${pct(h500.ledger.downtime, 2)} at 500k), slightly above the exact 1 − A_op (${pct(1 - h500.aOp, 2)}); ReMAP’s downtime (${pct(e500.review.ledger.downtime, 2)}) matches the latter.`),
    T('<b>窗口与人工兜底</b>：ReMAP 从干净状态开始、窗口末截断停机，人工兜底按 1 % 概率抽 7,200 s；HAC-D 取稳态与均值 252 s——均值相同，只影响方差。', '<b>Window and manual fallback</b>: ReMAP starts clean, clips downtime at the window end and draws the 7,200 s manual fallback with 1 % probability; HAC-D takes the steady state and the 252 s mean — same mean, only the variance differs.'),
    T('<b>静默错误的方差</b>：漏检静默片段稀少但每次可丢失最多 120 h 进度，ReMAP 的保留正确进度呈重尾，95 % 区间在 50 万卡约 ±0.5 pt；这也是两者有效产出差异的主要来源。', '<b>Variance from silent corruption</b>: undetected episodes are rare but each can cost up to 120 h of progress, so ReMAP’s retained progress is heavy-tailed (±0.5 pt 95 % interval at 500k); this is the main source of the goodput differences.'),
  ];

  const css = readFileSync('scripts/build-ascend950-scaling.mjs', 'utf8').match(/const css = `([\s\S]*?)`;\n/)[1];
  const extra = `td.ok { color: #1f6f4a; font-weight: 700; } td.bad { color: #a33a1a; font-weight: 700; } .d { color: var(--muted); font-size: 0.9em; } td.f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 10.8px; }
  table.t1 td:first-child, table.t6 td:first-child { min-width: 11em; } table.t6 td.f { min-width: 16em; } table.t5 td:first-child { min-width: 12em; } table.t2 td:first-child { min-width: 13em; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) td.ok { color: #7fd3a6; } }
  @media print { td.f { font-size: 6.3px; } }`;
  const keyPoints = [
    T(`<b>数据来源一致</b>：本地 ReMAP 从 eaacb05 更新到 ${esc(R.repositories.remap.head.slice(0, 7))}（上游新增 3 次提交，均为分析与报告功能，不改目录与参数）；参考引擎本地副本与 GitHub 683afe8 逐字节一致。HAC-D 的 54 个事件、8 个机制参数、适用事件、16 项基线设置与 16 项新机制数据与两个仓库完全一致（8 项检查全部通过）。`, `<b>Data provenance matches</b>: the local ReMAP clone moved from eaacb05 to ${esc(R.repositories.remap.head.slice(0, 7))} (3 upstream commits, analysis and reporting features only, no catalog or parameter change); the local reference engine is byte-identical to GitHub 683afe8. HAC-D’s 54 events, 8 mechanism parameter sets, applicability lists, 16 baseline settings and the 16-mechanism audit data equal both repositories (all 8 checks pass).`),
    T(`<b>差别在 HAC-D 的拓扑层</b>：仓库按每卡 FIT 计率（“非物理器件 FIT”），HAC-D 的拓扑模板把它在 CloudMatrix384 几何下换算到每个硬件单元、再按目标拓扑的单元数加总，并给 scale-out 网络新增 6 类类比事件。于是 1 万卡时每 NPU 硬中断 FIT：910C ${fmt(tot('a3tpl'), 1)}（+${((tot('a3tpl') / 3333.33333 - 1) * 100).toFixed(1)} %），950 ${fmt(tot('a950tpl'), 1)}（${((tot('a950tpl') / 3333.33333 - 1) * 100).toFixed(1)} %）——950 每卡的机柜、CPU 只有一半，UB 光链路只有 1/7。`, `<b>The difference is HAC-D’s topology layer</b>: the repositories rate events per card (“not device FIT”); HAC-D’s templates convert them per hardware unit under the CloudMatrix384 geometry, re-count them for the target topology and add 6 analogue classes on the scale-out network. Hard FIT per NPU at 10k: 910C ${fmt(tot('a3tpl'), 1)} (+${((tot('a3tpl') / 3333.33333 - 1) * 100).toFixed(1)} %), 950 ${fmt(tot('a950tpl'), 1)} (${((tot('a950tpl') / 3333.33333 - 1) * 100).toFixed(1)} %) — per card the 950 has half the cabinets and CPUs and 1/7 of the UB optical links.`),
    T(`<b>另一份“950 与 910C”报告被逐值复现</b>（${R.reproduction.rows.length} / ${R.reproduction.rows.length} 个数）：它就是 HAC-D v4.3 模板默认。与本项目 950 主算例的差别只来自 scale-out 假设（模板 2 平面 × 三层 radix 128 对主算例 4 平面 × 两层 radix 1,024），50 万卡 A_op 差 ${pp(H('a950main', 500000).aOp - H('a950tpl', 500000).aOp, 4)} pt；第二个架构不同（910C 对 UBL128）。`, `<b>The other “950 与 910C” report is reproduced value by value</b> (${R.reproduction.rows.length} / ${R.reproduction.rows.length}): it is the HAC-D v4.3 template default. Its difference from the scaling report’s 950 main case comes only from the scale-out assumption (template 2 planes × 3 tiers at radix 128 vs 4 planes × 2 tiers at radix 1,024), ${pp(H('a950main', 500000).aOp - H('a950tpl', 500000).aOp, 4)} pt of A_op at 500k; the second architecture differs (910C vs UBL128).`),
    T(`<b>公式</b>：HAC-D 的 A_op 与 ReMAP 的“运行可用度”是同一个量，ReMAP 的主指标“可用度”是保留正确进度，对应 HAC-D 的正确有效产出。在同一事件率下，两个引擎的 A_op 最大差 ${(maxDa * 100).toFixed(4)} pt，有效产出最大差 ${(maxDg * 100).toFixed(2)} pt，均在蒙特卡洛区间量级内。`, `<b>Formulas</b>: HAC-D’s A_op and ReMAP’s “operational availability” are the same quantity; ReMAP’s headline “availability” is retained clean progress, HAC-D’s delivered goodput. On the same event rates the engines differ by at most ${(maxDa * 100).toFixed(4)} pt of A_op and ${(maxDg * 100).toFixed(2)} pt of goodput, of the order of the Monte Carlo intervals.`),
  ];

  const sections = [
    `<div class="eyebrow">EYEBROW1</div>
  <h1>${esc(T('HAC-D 与 ReMAP / 参考引擎：数据来源、950 结果差异与可用度公式', 'HAC-D vs ReMAP and the reference engine: data provenance, the 950 result differences and the availability formulas'))}</h1>
  <p class="sub">${T('对象：github.com/lzq0927/remap（本地 remap/remap-latest）与 github.com/zy009197/ai-cluster-reliability（本地 ai-cluster-reliability-main，目录 review-2026-10-09）；另一份报告为 ~/Documents/projects/output/HAC-D-950-910C-default-six.html（HAC-D v4.3 dd1fc99，2026-10-20）；本项目报告为 docs/ASCEND950_SCALING_RELIABILITY。全部为六个默认机制、30 天同步训练作业。', 'Subjects: github.com/lzq0927/remap (local remap/remap-latest) and github.com/zy009197/ai-cluster-reliability (local ai-cluster-reliability-main, catalog review-2026-10-09); the other report is ~/Documents/projects/output/HAC-D-950-910C-default-six.html (HAC-D v4.3 dd1fc99, 2026-10-20); the scaling report is docs/ASCEND950_SCALING_RELIABILITY. All with the six default mechanisms and a 30-day synchronous training job.')}</p>
  <div class="callout"><ul>${keyPoints.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h2 class="first">${esc(T('1. FIT 与机制参数是否取自两个仓库（表 1）', '1. Are the FIT and mechanism values those of the two repositories (Table 1)'))}</h2>
  ${table1}
  <p class="note">${T('复现：<code>node --import tsx scripts/check-reference-values.ts</code>。两个仓库的 inputs.json、mechanisms.json、mechanism-policy.json、engine.cjs、reference.cjs 逐字节相同（ReMAP 直接收录参考引擎）；1 万卡不是整超节点（10,000 ÷ 384 = 26.04），末尾部分超节点的柜与 L2 向上取整使换算值高 0.013 %，整超节点时精确相等。', 'Reproduce: <code>node --import tsx scripts/check-reference-values.ts</code>. inputs.json, mechanisms.json, mechanism-policy.json, engine.cjs and reference.cjs are byte-identical in both repositories (ReMAP vendors the reference engine); 10,000 NPUs is not a whole number of pods (10,000 ÷ 384 = 26.04), so the last pod’s cabinets and L2 chips round up and the conversion is 0.013 % high there, exact at whole pods.')}</p>
  <h3>${esc(T('表 2：拓扑模板把每卡 FIT 变成了多少（1 万卡，括号为相对仓库每卡值的变化）', 'Table 2: what the topology templates make of the per-card FIT (10k NPUs; brackets: change against the repository per-card value)'))}</h3>
  ${table2}
  <p class="note">${T('仓库的事件率口径是“每十亿 NPU 等效运行暴露小时的业务影响事件，非物理器件 FIT”，没有任何器件数量；ReMAP 新增的“架构”层只是功能分组，注释写明“不虚构部署拓扑”。HAC-D 的单元换算（单元 FIT = 每卡 FIT × CloudMatrix384 中每单元卡数）与 scale-out 类比事件是 HAC-D 自己的假设，可关闭：去掉 scale-out、使用参考目录场景即为仓库口径（表 4 ①）。', 'The repositories’ rate basis is “business-impact events per 10⁹ NPU-equivalent exposure hours, not physical device FIT”, with no device counts; ReMAP’s new “architecture” layer is functional grouping only, its comment says it never invents a deployment topology. HAC-D’s unit conversion (unit FIT = per-card FIT × cards per unit in CloudMatrix384) and the scale-out analogue classes are HAC-D’s own assumptions and can be switched off: without scale-out and with the reference-catalog scenario you get the repositories’ arithmetic (Table 4 ①).')}</p>`,
    `<div class="eyebrow">EYEBROW2</div>
  <h2 class="first">${esc(T('2. 与“950 与 910C”报告的差异来源', '2. Where the “950 与 910C” report differs and why'))}</h2>
  <h3>${esc(T('表 3：另一份报告的数字 / HAC-D v4.3 复算（模板默认、六个默认机制）', 'Table 3: the other report’s numbers / HAC-D v4.3 re-run (template default, six default mechanisms)'))}</h3>
  ${table3}
  <h3>${esc(T('表 4：A_op 从仓库口径到两份 950 结果的分解', 'Table 4: A_op from the repository arithmetic to the two 950 results'))}</h3>
  ${table4}
  <ul class="scale">
    <li>${T(`<b>① → ②（拓扑换算，差异的主体）</b>：950 每 NPU 少 ${fmt(3333.333 - tot('a950tpl'), 0)} FIT（机柜 −132.7、CPU −83.3、UB 光链路 −57.1、UB 交换 −1.2，scale-out 类比 +33.1），MTTR 也因少了全局恢复类的机柜事件而缩短，50 万卡 A_op 高 ${pp(H('a950tpl', 500000).aOp - H('refcat', 500000).aOp, 2)} pt。910C 模板与仓库口径只差 scale-out 类比（+${fmt(tot('a3tpl') - 3333.333, 0)} FIT），A_op 低 ${pp(H('a3tpl', 500000).aOp - H('refcat', 500000).aOp, 2)} pt。`, `<b>① → ② (topology conversion, the bulk)</b>: the 950 has ${fmt(3333.333 - tot('a950tpl'), 0)} FIT less per NPU (cabinet −132.7, CPU −83.3, UB optical links −57.1, UB switches −1.2, scale-out analogue +33.1), and its MTTR shortens because fewer cabinet events go to the global recovery; A_op is ${pp(H('a950tpl', 500000).aOp - H('refcat', 500000).aOp, 2)} pt higher at 500k. The 910C template differs from the repositories only by the scale-out analogue (+${fmt(tot('a3tpl') - 3333.333, 0)} FIT), ${pp(H('a3tpl', 500000).aOp - H('refcat', 500000).aOp, 2)} pt of A_op.`)}</li>
    <li>${T(`<b>② → ③（scale-out 假设）</b>：本项目主算例取 4 平面 × 两层、radix 1,024（每 NPU 4 × 200G），模板默认是 2 平面 × 三层、radix 128。交换机少 85 %、链路多 33 %：交换机类（全部走全局恢复）FIT 少 3.8、链路类（90 % 重执行）FIT 多 9.5，合计 +5.7 FIT / NPU 但 MTTR 短 0.35 s，A_op 净增 ${pp(H('a950main', 500000).aOp - H('a950tpl', 500000).aOp, 4)} pt。`, `<b>② → ③ (scale-out assumption)</b>: the scaling report’s main case is 4 planes × 2 tiers at radix 1,024 (4 × 200G per NPU), the template default 2 planes × 3 tiers at radix 128. 85 % fewer switches, 33 % more links: switch classes (all global recovery) −3.8 FIT, link classes (90 % replayed) +9.5 FIT, net +5.7 FIT per NPU but 0.35 s less MTTR, so A_op is ${pp(H('a950main', 500000).aOp - H('a950tpl', 500000).aOp, 4)} pt higher.`)}</li>
    <li>${T('<b>第二个架构</b>：另一份报告比较 950 与 910C（CloudMatrix384 模板），本项目按你的选择比较原生 950 与 UBL128（假设几何），两者不是同一问题。', '<b>Second architecture</b>: the other report compares 950 with 910C (CloudMatrix384 template); the scaling report, as you chose, compares native 950 with UBL128 (assumed geometry) — different questions.')}</li>
    <li>${T('<b>指标与呈现</b>：另一份报告另给正确有效产出与 30 天损失台账、单参数复算；本项目给 scale-out 机柜估算（每柜 2 台，假设）、映射表与单点故障表。计算柜、UB 互联柜、LRS、超节点层交换机、UB 光链路与光模块的数量两边完全相同。', '<b>Metrics and presentation</b>: the other report adds delivered goodput, the 30-day loss ledger and single-parameter re-runs; the scaling report adds a scale-out rack estimate (2 per rack, assumed), the mapping tables and the single-point-of-failure table. Compute cabinets, UB interconnect cabinets, LRS, pod switches, UB optical links and transceivers are identical in both.')}</li>
  </ul>`,
    `<div class="eyebrow">EYEBROW3</div>
  <h2 class="first">${esc(T('3. HAC-D 与 ReMAP 的可用度公式', '3. The availability formulas of HAC-D and ReMAP'))}</h2>
  <div class="formula">${T('HAC-D（闭式，运行时钟上的稳态更新过程）', 'HAC-D (closed form, steady-state renewal on the running clock)')}<br>A_run = 1 / (1 + [Σᵢ λᵢ t̄ᵢ + λ_iso R_iso + λ_det R_det + λ_FA R_FA] / 3600)　·　A_op = A_run · (1 − φ_SDC)<br>λᵢ = n_u · FITᵢ · 10⁻⁹ /h　·　t̄ᵢ = E[${T('检测 + 重执行 / 弹性 / 进程 / 全局恢复', 'detection + replay / elastic / process / global recovery')}]　·　R_iso = 252 s　·　R_det = 3 s<br>G_delivered = SDC_window( G_clean , ν , 120 h , retain-last-clean )，G_clean = [1 − δ/τ − (P_rb·τ/2 + R̄)/M] × ${T('降速', 'slowdown')} × (1 − ${T('局部', 'local')}) × (1 − ${T('阻塞', 'blocked')})</div>
  <div class="formula">${T('ReMAP / 参考引擎（review-retained-progress，720 h 窗口蒙特卡洛）', 'ReMAP / reference engine (review-retained-progress, Monte Carlo over 720 h windows)')}<br>λ_hard = N / (10,000 × 30 h) = N · 3,333.3 · 10⁻⁹ /h　·　λ_slow, λ_sdc ${T('按份额', 'by shares')} 0.02 / 0.014　·　${T('类内按 FIT 抽事件', 'events drawn ∝ FIT within a class')}<br>T = correct + downtime + save + slowdown + rollback + terminalInvalid + localLoss　（${T('逐次试验闭合', 'closes in every trial')}）<br>${T('运行可用度', 'operational availability')} = E[1 − downtime / T]　·　${T('可用度（主指标）', 'availability (headline)')} = E[correct / T]，correct = ${T('窗口末进度或最后干净检查点', 'progress at T or the last clean checkpoint')}</div>
  <h3>${esc(T('表 5：两套公式逐项对照', 'Table 5: the two formulations term by term'))}</h3>
  ${table6}
  <h3>${esc(T('表 6：同一事件率下两个引擎的数值（2,000 个 720 h 窗口；黄底 = 差值超过 1.5 倍区间）', 'Table 6: both engines on the same event rates (2,000 windows of 720 h; yellow = difference beyond 1.5 × the interval)'))}</h3>
  ${table5}
  <ul class="scale">${detail.map((d) => `<li>${d}</li>`).join('')}</ul>
  <footer>${T(`复现：<code>node --import tsx scripts/hacd-remap-comparison.ts</code>（调用 <code>scripts/check-reference-values.ts</code> 与 <code>scripts/remap-bridge.ts --remap remap/remap-latest</code>）→ <code>node scripts/build-hacd-remap-comparison.mjs</code>；结果在 <code>docs/hacd-remap-comparison/results.json</code>。ReMAP 引擎为其收录的参考审核引擎（review-retained-progress.v2），种子策略同 ReMAP；HAC-D 侧没有引入任何 ReMAP 代码。`, `Reproduce: <code>node --import tsx scripts/hacd-remap-comparison.ts</code> (runs <code>scripts/check-reference-values.ts</code> and <code>scripts/remap-bridge.ts --remap remap/remap-latest</code>) → <code>node scripts/build-hacd-remap-comparison.mjs</code>; results in <code>docs/hacd-remap-comparison/results.json</code>. The ReMAP engine is the reference review engine it vendors (review-retained-progress.v2) with ReMAP’s seed policy; no ReMAP code is imported into HAC-D.`)}</footer>`,
  ];
  const nPages = sections.length;
  const eyebrow = (i) => esc(T(`HAC-D · 与 ReMAP 对照 · ${DATE} · 第 ${i} / ${nPages} 页`, `HAC-D · comparison with ReMAP · ${DATE} · page ${i} / ${nPages}`));
  const body = sections.map((s, i) => `<section class="page" id="p${i + 1}">\n  ${s.replace(`EYEBROW${i + 1}`, eyebrow(i + 1))}\n</section>`).join('\n');
  const html = `<!doctype html>
<html lang="${T('zh-CN', 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T('HAC-D 与 ReMAP 对照', 'HAC-D and ReMAP'))}</title>
<meta name="description" content="${esc(T('HAC-D 的故障率与机制参数是否取自 ReMAP 与 ai-cluster-reliability、“950 与 910C”报告的复现与差异分解、HAC-D 与 ReMAP 可用度公式及同一事件率下的数值对照。', 'Whether HAC-D’s failure rates and mechanism parameters come from ReMAP and ai-cluster-reliability, the “950 与 910C” report reproduced and its differences decomposed, and HAC-D’s availability formulas against ReMAP’s with both engines on the same event rates.'))}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${css}\n  ${extra}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
  const out = `docs/HACD_REMAP_COMPARISON.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
page('zh');
page('en');
