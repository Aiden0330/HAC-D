/**
 * v3.7 standalone HTML of the single-point benefit audit (the structure of the user's 新可靠性机制库 · 单点收益审核 page):
 * header and cards, notes, the fault-handling flow, the recovery stage budget, the transferable summary table, sensitivity,
 * one article per mechanism (principle, trigger, workflow, success criteria, formula, scope, evidence, prerequisites, failure,
 * cost, overlap, acceptance, observations, parameters and integration fields, sources) and the embedded JSON with export.
 */
import type { AuditReport, AuditRow } from '../mechanisms/audit.js';
import { esc, pct, num, sgn, jsonScript, REPORT_CSS, REPORT_FONTS } from './common.js';

export type ReportLang = 'zh' | 'en';

const L = {
  zh: {
    eyebrow: 'HAC-D · 可靠性机制库 · 单点收益量化审核', title: '可靠性机制库：原理、触发流程与单点收益', intro: (n: number, N: number, h: number) => `${n} 项机制逐项说明原理、触发信号、执行步骤、成功判据和失败回退；单点收益按方案自身基线计算（${N.toLocaleString('en-US')} 卡，${h} h 窗口）。集群级增量只对参数齐全的机制给出。`,
    exportJson: '导出审核 JSON', print: '打印 / 另存 PDF', expand: '展开全部参数', collapse: '收起全部参数',
    cards: ['独立量化条目', '常规中断参考损失', '含人工尾部的期望损失', '方案基线 A_op · 正确交付'], cardNotes: ['项（含 HAC-D 既有机制与审核新增）', '发现 + 自动恢复 + 平均回滚', '常规损失 + p_manual × 人工时长；不与常规口径混用', '当前规模的集群级基线（无所选机制）'],
    flowTitle: '先看机制如何进入故障处理流程', flowSub: '这是机制库的建议编排：先检查适用条件，再选择分支；并非每个故障都依次经过所有机制。',
    flow: [['① 发生前：降低风险', '在线压测 → 发现异常资源 → 隔离／替换 → 降低适用集合的训练暴露 FIT。改变"是否发生"（H-SDC-SCREEN、H-LEMON、H-SWEEP、H-RELIABILITY）。'], ['② 发生时：发现与阻止污染', '硬件告警／超时，或 BF16、FP8、FP4、ABFT、网络 SDC 校验 → 确认异常并阻止错误提交。改变"能否发现、多久发现"（D-*）。'], ['③ 发现后：按类型恢复', '瞬态链路优先透明恢复；局部故障隔离＋弹性；检出的 SDC 从可信 step 起点重算；状态不可信则干净 CKPT 回滚。改变"影响范围、恢复时间与回退量"（R-*、C-*）。'], ['④ 恢复失败：有界升级', '局部失败 → 更强的自动恢复；少量卡死／根因不明 → 人工诊断。改变"成功率和长尾损失"（D-RECOVERY-CLASSIFY、R-MANUAL）。']],
    stageTitle: '恢复时间使用同一份阶段预算', stageNames: ['进程／运行时启动', '训练状态读取', '通信重建'], stageNotes: ['其中图准备', '无损压缩作用于此', 'HCCL 弹性作用于此'],
    tableTitle: '可转交的单点收益总表', tableSub: '点击机制名称跳转详细流程。秒数、检出率百分点与 FIT 的单位不同，不能混合排序为总体收益；集群级增量是该机制单独加在基线上的闭式解析增量。',
    th: ['机制与编号', '触发条件与量化口径', '基线 → 候选目标', '单点改善量', '集群级增量（单独启用）', '改动说明与重叠约束'],
    sensTitle: '敏感性：备选目标下的单点值', articlesTitle: '逐项机制说明', principle: '工作原理', trigger: '何时触发', signal: '信号／启动条件', gate: '必须满足的门槛', timing: '执行时机', owner: '执行主体', workflow: '执行流程', success: '成功判据', dont: '不适用／禁止直接续跑的情况', scope: '适用范围', evidence: '证据与假设', prereq: '成立前提', failure: '失败后的处理', cost: '成本与限制', overlap: '与已有机制的重叠', acceptance: '验收指标', observe: '需记录的观测指标', params: '查看参数、集成字段与敏感性数据', sources: '设计依据：', integration: '集成字段', missing: '待校准', provisional: '临时假设', ready: '可进入集群级模型', auditOnly: '仅单点审核',
    footer: (v: string, g: string) => `交付格式：本 HTML 可离线独立打开；"导出审核 JSON"包含全部机制说明、触发流程、参数、公式、证据和待校准字段。审核目录版本 ${v}；生成 ${g}。由 HAC-D 生成（hacd audit · MCP audit_mechanisms · 机制审核页）。既有故障库、机制库与仿真默认值未修改。`,
    notesTitle: '口径与假设', detectionNote: '检出率提升，非可用度增益',
  },
  en: {
    eyebrow: 'HAC-D · reliability mechanism catalog · single-point benefit audit', title: 'Reliability mechanisms: principle, trigger flow and single-point benefit', intro: (n: number, N: number, h: number) => `${n} mechanisms with principle, trigger signals, workflow, success criteria and fallback; single-point gains against the scenario's own baseline (${N.toLocaleString('en-US')} cards, ${h} h window). Cluster-level deltas only for mechanisms whose parameters are complete.`,
    exportJson: 'Export audit JSON', print: 'Print / save PDF', expand: 'Expand all parameters', collapse: 'Collapse all parameters',
    cards: ['Quantified entries', 'Reference loss of a regular interruption', 'Expected loss incl. manual tail', 'Scenario baseline A_op · delivered'], cardNotes: ['mechanisms (HAC-D built-in and audited)', 'detection + automatic attempt + mean rollback', 'regular loss + p_manual × manual time; a separate 口径', 'cluster-level baseline at this size (without the selected mechanisms)'],
    flowTitle: 'How mechanisms enter the fault-handling flow', flowSub: 'The suggested arrangement: check applicability first, then branch; not every fault passes through every mechanism.',
    flow: [['① Before: lower the risk', 'Online screening → anomalous resources → isolation / replacement → lower exposed silent FIT (H-SDC-SCREEN, H-LEMON, H-SWEEP, H-RELIABILITY). Changes whether it happens.'], ['② At occurrence: detect and stop contamination', 'Hardware alarms / timeouts, or BF16 / FP8 / FP4 / ABFT / network silent-corruption checks confirm the fault and block wrong commits (D-*). Changes detection and its delay.'], ['③ After detection: recover by type', 'Transient links recover transparently; local faults are contained and handled elastically; detected silent corruption restarts from a trusted step; untrusted state rolls back to a clean checkpoint (R-*, C-*). Changes scope, recovery time and rollback.'], ['④ Recovery failure: bounded escalation', 'Local failure → stronger automatic recovery; a few hangs / unknown root causes → manual diagnosis (D-RECOVERY-CLASSIFY, R-MANUAL). Changes success and the long tail.']],
    stageTitle: 'Recovery time uses one stage budget', stageNames: ['Process / runtime startup', 'Training-state read', 'Communication rebuild'], stageNotes: ['of which graph preparation', 'lossless compression acts here', 'HCCL elasticity acts here'],
    tableTitle: 'Transferable single-point benefit table', tableSub: 'Click a mechanism to jump to its article. Seconds, detection percentage points and FIT are different units and must not be ranked together; the cluster-level delta is the closed-form gain of the mechanism applied alone to the baseline.',
    th: ['Mechanism', 'Trigger and quantification basis', 'Baseline → candidate target', 'Single-point gain', 'Cluster-level delta (alone)', 'Change and overlap rules'],
    sensTitle: 'Sensitivity: single-point values at alternative targets', articlesTitle: 'Mechanism articles', principle: 'Principle', trigger: 'When it triggers', signal: 'Signal / start condition', gate: 'Gate', timing: 'Timing', owner: 'Owner', workflow: 'Workflow', success: 'Success criteria', dont: 'Do not trigger when', scope: 'Scope', evidence: 'Evidence and assumptions', prereq: 'Prerequisites', failure: 'On failure', cost: 'Cost and limits', overlap: 'Overlap with existing mechanisms', acceptance: 'Acceptance', observe: 'Observations to record', params: 'Parameters, integration fields and sensitivity data', sources: 'Design basis: ', integration: 'Integration fields', missing: 'to calibrate', provisional: 'provisional', ready: 'enters the cluster-level models', auditOnly: 'audit only',
    footer: (v: string, g: string) => `This HTML opens offline; "Export audit JSON" carries every mechanism's description, trigger flow, parameters, formulas, evidence and fields to calibrate. Audit catalog ${v}; generated ${g}. Produced by HAC-D (hacd audit · MCP audit_mechanisms · Audit page). Existing fault catalog, mechanism library and simulation defaults are unchanged.`,
    notesTitle: 'Conventions and assumptions', detectionNote: 'detection gain, not an availability gain',
  },
} as const;

const unitLabel = (unit: string, lang: ReportLang) => (unit === 'seconds' ? 's' : unit === 'FIT' ? ' FIT' : lang === 'zh' ? '' : '');
const fmtValue = (v: number, unit: string) => (unit === 'fraction' ? `${num(v * 100, v * 100 >= 10 ? 1 : 2)}%` : unit === 'FIT' ? `${num(v, 2)} FIT` : `${num(v, v >= 100 ? 1 : 2)}s`);

function rowGain(r: AuditRow, lang: ReportLang): string {
  const sp = r.singlePoint;
  if (!sp) return `<span class="muted">—</span>`;
  if (sp.unit === 'fraction' && sp.direction === 'increase') return `<span class="gain">+${num(sp.improvement * 100, 1)} ${lang === 'zh' ? '个百分点' : 'points'}</span><div class="small">${L[lang].detectionNote}</div>`;
  if (sp.unit === 'fraction') return `<span class="gain">× ${num(sp.after, 3)}</span><div class="small">${lang === 'zh' ? '率因子' : 'rate factor'}</div>`;
  const red = sp.reductionFraction !== undefined ? `<div class="small">${lang === 'zh' ? '减少' : '−'} ${num(sp.reductionFraction * 100, 2)} %</div>` : '';
  return `<span class="gain${sp.improvement < 0 ? ' neg' : ''}">−${fmtValue(sp.improvement, sp.unit)}</span>${red}`;
}
function clusterCell(r: AuditRow, lang: ReportLang): string {
  if (r.cluster) {
    const tag = r.integration.provisional ? `<span class="tag assumed">${L[lang].provisional}</span>` : '';
    return `ΔA_op <b>${sgn(r.cluster.aOp * 100, 3)}</b> pt<br>Δ${lang === 'zh' ? '正确交付' : 'delivered'} <b>${sgn(r.cluster.delivered * 100, 2)}</b> pt${tag}${r.cluster.note ? `<div class="small">${esc(r.cluster.note)}</div>` : ''}`;
  }
  if (!r.integration.ready && r.integration.missing.length) return `<span class="warning">${L[lang].missing}：${esc(r.integration.missing.join('、'))}</span><div class="small">${L[lang].auditOnly}</div>`;
  return `<span class="muted">${L[lang].auditOnly}</span>`;
}

export function auditReportHtml(rep: AuditReport, lang: ReportLang = 'zh'): string {
  const t = L[lang];
  const b = rep.baseline;
  const name = (r: AuditRow) => (lang === 'zh' ? r.name.zh : r.name.en);
  const rows = rep.rows;
  const nameRow = (r: AuditRow, i: number) => `<a href="#${esc(r.id)}"><b>${String(i + 1).padStart(2, '0')} ${esc(name(r))}</b></a><br><code>${esc(r.id)}</code><span class="tag">${esc(r.category)}</span>`;
  const summary = rows.map((r, i) => {
    const sp = r.singlePoint;
    return `<tr><td>${nameRow(r, i)}</td><td>${esc(r.trigger?.signal ?? r.texts.change)}<p class="muted">${lang === 'zh' ? '量化口径' : 'basis'}：${esc(r.basis)}</p></td><td>${sp ? `<span class="before">${fmtValue(sp.before, sp.unit)}</span> → <b>${fmtValue(sp.after, sp.unit)}</b><p class="muted">${esc(lang === 'zh' ? sp.metric.zh : sp.metric.en)}</p>` : '<span class="muted">—</span>'}</td><td>${rowGain(r, lang)}</td><td>${clusterCell(r, lang)}</td><td>${esc(r.texts.change)}${r.texts.overlap ? `<p class="muted">${esc(r.texts.overlap)}</p>` : ''}</td></tr>`;
  }).join('');
  const sens = rows.filter((r) => r.singlePoint?.range?.length).map((r) => `<tr><td><a href="#${esc(r.id)}">${esc(r.id)}</a> ${esc(name(r))}</td><td class="muted">${esc(lang === 'zh' ? r.singlePoint!.metric.zh : r.singlePoint!.metric.en)}</td>${r.singlePoint!.range!.map((x) => `<td class="num">${esc(x.label)} → ${fmtValue(x.value, r.singlePoint!.unit)}</td>`).join('')}</tr>`).join('');
  const articles = rows.map((r, i) => {
    const sp = r.singlePoint;
    const tx = r.texts;
    const sec = (title: string, body?: string) => (body ? `<h3>${title}</h3><p>${esc(body)}</p>` : '');
    const integ = r.integration.needs.length ? `<p><b>${t.integration}</b>：${r.integration.needs.map((k) => `${esc(k)} = ${r.integration.values[k] === null ? `<span class="warning">${t.missing}</span>` : `${esc(String(r.integration.values[k]))}${r.integration.provisional ? ` <span class="tag assumed">${t.provisional}</span>` : ''}`}`).join('；')} → ${r.clusterReady ? `<span class="tag ok">${t.ready}</span>` : `<span class="tag">${t.auditOnly}</span>`}</p>` : '';
    return `<article id="${esc(r.id)}"><div class="article-title"><span class="no">${String(i + 1).padStart(2, '0')}</span><h2 style="margin:0">${esc(name(r))}</h2><span class="muted">${esc(r.id)} · ${esc(r.category)}</span><div class="headline">${rowGain(r, lang)}</div></div>
<p class="muted">${esc(r.origin)} · ${esc(r.designStatus)} · ${lang === 'zh' ? '工作量' : 'effort'} ${r.effort}</p>
${tx.principle ? `<h3>${t.principle}${tx.lever ? ` · ${esc(tx.lever)}` : ''}</h3><p>${esc(tx.principle)}</p>` : ''}
${r.trigger ? `<h3>${t.trigger}</h3><div class="grid4"><div class="box"><h3>${t.signal}</h3><p>${esc(r.trigger.signal)}</p></div><div class="box"><h3>${t.gate}</h3><p>${esc(r.trigger.gate)}</p></div><div class="box"><h3>${t.timing}</h3><p>${esc(r.trigger.timing)}</p></div><div class="box"><h3>${t.owner}</h3><p>${esc(r.trigger.owner)}</p></div></div>` : ''}
${tx.workflow?.length ? `<h3>${t.workflow}</h3><ol class="workflow">${tx.workflow.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>` : ''}
${sec(t.success, tx.successCriteria)}${sec(t.dont, tx.doNotTrigger)}
${sp ? `<div class="f">${esc(lang === 'zh' ? sp.formula.zh : sp.formula.en)}</div>` : ''}
${sec(t.scope, tx.scope)}${sec(t.evidence, tx.evidence)}${sec(t.prereq, tx.prerequisite)}${sec(t.failure, tx.failure)}${sec(t.cost, tx.cost)}${sec(t.overlap, tx.overlap)}${sec(t.acceptance, tx.acceptance)}
${tx.observe?.length ? `<h3>${t.observe}</h3><p>${esc(tx.observe.join('；'))}</p>` : ''}
${integ}
<details><summary>${t.params}</summary><pre class="json">${esc(JSON.stringify({ events: r.events, parameters: r.parameters, integration: r.integration.values, singlePoint: sp, audit: r.auditQuantification, cluster: r.cluster }, null, 1))}</pre></details>
${r.sources.length ? `<p class="small">${t.sources}${r.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(' · ')}</p>` : ''}
</article>`;
  }).join('');
  const sb = rep.stageBudget;
  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t.title)}</title>${REPORT_FONTS}<style>${REPORT_CSS}</style></head>
<body><main>
<header class="title"><div class="eyebrow">${esc(t.eyebrow)} · ${esc(rep.version)}</div><h1>${esc(t.title)}</h1><p class="sub">${esc(t.intro(rows.length, rep.scenario.nGpus, rep.scenario.windowH))}${rep.scenario.name ? ` ${lang === 'zh' ? '方案' : 'Scenario'}：${esc(rep.scenario.name)}。` : ''}</p>
<div class="actions"><button id="export">${t.exportJson}</button><button class="secondary" onclick="window.print()">${t.print}</button><button id="expand" class="secondary">${t.expand}</button></div></header>
<div class="cards">
<div class="card"><span>${t.cards[0]}</span><b>${rows.length}</b><span>${t.cardNotes[0]}</span></div>
<div class="card"><span>${t.cards[1]}</span><b>${num(b.normalLossS, 1)} s</b><span>${num(b.detectS, 1)} + ${num(b.autoS, 0)} + ${num(b.rollbackS, 0)} s · ${t.cardNotes[1]}</span></div>
<div class="card"><span>${t.cards[2]}</span><b>${num(b.expectedLossS, 1)} s</b><span>${num(b.normalLossS, 1)} + ${num(b.manualProbability * 100, 1)} % × ${num(b.manualS, 0)} s · ${t.cardNotes[2]}</span></div>
<div class="card"><span>${t.cards[3]}</span><b>${pct(rep.baselineValues.aOp)} % · ${pct(rep.baselineValues.delivered, 1)} %</b><span>${rep.scenario.nGpus.toLocaleString('en-US')} ${lang === 'zh' ? '卡' : 'cards'} · ${t.cardNotes[3]}</span></div>
</div>
<div class="note"><b>${t.notesTitle}</b>${rep.notes.map((n) => `<p>${esc(lang === 'zh' ? n.zh : n.en)}</p>`).join('')}</div>
<section><h2>${t.flowTitle}</h2><p class="muted">${t.flowSub}</p><div class="grid4">${t.flow.map(([h, p]) => `<div class="box"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div>
<p class="muted">${esc(String(rep.sdcRecoveryContract.lateRecovery ?? ''))} ${esc(String(rep.sdcRecoveryContract.instantRecovery ?? ''))}</p></section>
<section><h2>${t.stageTitle}</h2><div class="grid4">
<div class="box"><h3>${t.stageNames[0]}</h3><b>${num(sb.startup, 0)} s</b><p class="muted">${t.stageNotes[0]} ${num(sb.graphWithinStartup, 0)} s</p></div>
<div class="box"><h3>${t.stageNames[1]}</h3><b>${num(sb.read, 0)} s</b><p class="muted">${t.stageNotes[1]}</p></div>
<div class="box"><h3>${t.stageNames[2]}</h3><b>${num(sb.communication, 0)} s</b><p class="muted">${t.stageNotes[2]}</p></div>
<div class="box"><h3>Σ</h3><b>${num(sb.total, 0)} s</b><p class="muted">${esc(sb.status)}</p></div></div></section>
<section id="summary-table"><h2>${t.tableTitle}</h2><p class="muted">${t.tableSub}</p><div class="table-wrap"><table id="mechanism-table"><thead><tr>${t.th.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${summary}</tbody></table></div></section>
${sens ? `<section><h2>${t.sensTitle}</h2><div class="table-wrap"><table><tbody>${sens}</tbody></table></div></section>` : ''}
<section><h2>${t.articlesTitle}</h2>${articles}</section>
<footer>${esc(t.footer(rep.version, rep.generated))}</footer>
</main>
<script type="application/json" id="audit-data">${jsonScript(rep)}</script>
<script>
document.getElementById('export').onclick=function(){var blob=new Blob([JSON.stringify(JSON.parse(document.getElementById('audit-data').textContent),null,2)],{type:'application/json'});var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='mechanism-audit.json';a.click();setTimeout(function(){URL.revokeObjectURL(u)},1000)};
(function(){var b=document.getElementById('expand'),open=false;b.onclick=function(){open=!open;document.querySelectorAll('details').forEach(function(d){d.open=open});b.textContent=open?${JSON.stringify(t.collapse)}:${JSON.stringify(t.expand)}}})();
</script>
</body></html>
`;
}
