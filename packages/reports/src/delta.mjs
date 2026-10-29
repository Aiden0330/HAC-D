/**
 * Delta recipe — the review page of an ingest run (docs/markdown/PLAN_V6_INPUT_MIGRATION.md §5.6): what changed in the inputs
 * (record fields with the source and confidence the new record states, failure-rate classes on one basis, mechanism-set fields) and
 * what it does to the results at the run's scales — A_op nominal and derated, delivered goodput, MTBF_hw and MTTR_hw (formula 1),
 * the window probability, the hardware factor k and the recommended mechanisms and levers (formula 6) — before and after, with the
 * validation issues and the extension requests of the run. Pure function of its data: `delta` = the delta.json written by
 * `hacd ingest diff` (@hac-d/core `deltaDocument`); the page date is `delta.generated`; `provenance` (command, engine) fills the footer.
 */
import { esc, fmt, pages, pageShell } from './kit.mjs';

const txt = (x, lang) => (x === null || x === undefined ? '' : typeof x === 'string' ? x : typeof x === 'object' && !Array.isArray(x) && 'zh' in x ? x[lang] : Array.isArray(x) ? x.join(', ') : typeof x === 'number' ? num(x) : JSON.stringify(x));
const num = (v) => (typeof v !== 'number' ? String(v) : !Number.isFinite(v) ? '—' : Number.isInteger(v) ? fmt(v) : fmt(v, Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 3 : 6));
const pp = (x) => `${(x * 100).toFixed(3)} %`;
const dpt = (x) => `${x >= 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(3)} pt`;
const ratio = (r) => (typeof r === 'number' && Number.isFinite(r) ? `× ${fmt(r, 3)}` : '—');
const h = (x) => (typeof x === 'number' && Number.isFinite(x) ? `${fmt(x, x >= 100 ? 0 : 2)} h` : '—');
const s = (x) => (typeof x === 'number' && Number.isFinite(x) ? `${fmt(x, x >= 100 ? 0 : 1)} s` : '—');
const kNum = (n, lang) => (lang === 'zh' ? `${fmt(n / 10000)} 万` : `${fmt(n / 1000)}k`);
const cell = (v, lang) => esc(txt(v, lang));
const table = (headers, rows, numCols = []) => `<table><thead><tr>${headers.map((x, j) => `<th${numCols.includes(j) ? ' class="num"' : ''}>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, j) => `<td${numCols.includes(j) ? ' class="num"' : ' class="w"'}>${v}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`;

function body(lang, d, prov) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const idOf = (x) => (x ? `<code>${esc(x.id)}</code>` : T('（无）', '(none)'));
  const ids = (side) => [T(`记录 ${idOf(side.record)}`, `record ${idOf(side.record)}`), T(`机制集 ${idOf(side.set)}`, `mechanism set ${idOf(side.set)}`), T(`失效率覆盖 ${side.rates ? `${idOf(side.rates)}（${esc(side.rates.basis)}）` : T('单元库', 'unit library')}`, `failure rates ${side.rates ? `${idOf(side.rates)} (${esc(side.rates.basis)})` : 'unit library'}`)].join(T('；', '; '));
  const counts = { error: d.issues.filter((i) => i.level === 'error').length, warning: d.issues.filter((i) => i.level === 'warning').length, info: d.issues.filter((i) => i.level === 'info').length };
  const hasBefore = Array.isArray(d.kpi.before) && d.kpi.before.length > 0;
  const summary = `
<h2 class="first">${T('变化摘要', 'Summary of the change')}</h2>
<p class="sub">${d.metric === 'effective'
    ? T('口径：G_eff = 一个同步作业 30 天窗口的有效 goodput（公式 1′：检查点保存、每次回滚重算与恢复暂停，乘吞吐系数），目标在降额值上成立；交付 goodput = G_eff 减去静默损坏损失（降额）；A_op = 每集群小时的可运行比例（公式 1，降额）；MTBF_hw = 1/Σλ（硬中断类），MTTR_hw = 速率加权平均停顿；P(窗口) = 30 天窗口中 G_eff ≥ G* 的份额（公式 6）；k = 窗口规则允许的统一硬件 FIT 因子（— = 无方案可达）。每个数都由引擎计算，本页只排列。', 'Basis: G_eff = the effective goodput of one synchronous job over the 30-day window (formula 1′: checkpoint saves, recompute per rollback and recovery pauses, times the throughput factors), the target holding on the derated value; delivered goodput = G_eff less the silent-corruption loss (derated); A_op = the running share per cluster-hour (formula 1, derated); MTBF_hw = 1/Σλ over the hard interruption classes, MTTR_hw = the rate-weighted mean pause; P(window) = share of 30-day windows with G_eff ≥ G* (formula 6); k = the uniform hardware FIT factor the window rule allows (— = no plan reaches the target). The engine made every number; this page only arranges them.')
    : T('口径：A_op = 一个同步作业每集群小时的可运行比例；MTBF_hw = 1/Σλ（硬中断类），MTTR_hw = 速率加权平均停顿（公式 1）；P(窗口) = 30 天窗口中 A_op ≥ A* 的份额（公式 6）；k = 窗口规则允许的统一硬件 FIT 因子；交付 goodput 含静默损坏损失。每个数都由引擎计算，本页只排列。', 'Basis: A_op = running share of one synchronous job per cluster-hour; MTBF_hw = 1/Σλ over the hard interruption classes, MTTR_hw = the rate-weighted mean pause (formula 1); P(window) = share of 30-day windows with A_op ≥ A* (formula 6); k = the uniform hardware FIT factor the window rule allows; delivered goodput includes the silent-corruption loss. The engine made every number; this page only arranges them.')}</p>
<ul class="kf">
  <li><b>${T('之前', 'Before')}</b>: ${hasBefore ? ids(d.before) : T('无基线（新记录）', 'no baseline (a new record)')}</li>
  <li><b>${T('之后', 'After')}</b>: ${ids(d.after)}</li>
  <li>${T(`目标 ${d.metric === 'effective' ? '有效 goodput G_eff' : 'A_op'} ≥ ${fmt(d.target * 100, 1)} %；规模 ${d.scales.map((n) => kNum(n, lang)).join(' / ')}；${fmt(d.trials)} 个窗口，种子 ${d.seed}`, `target ${d.metric === 'effective' ? 'effective goodput G_eff' : 'A_op'} ≥ ${fmt(d.target * 100, 1)} %; scales ${d.scales.map((n) => kNum(n, lang)).join(' / ')}; ${fmt(d.trials)} windows, seed ${d.seed}`)}</li>
  <li>${T(`输入变化：记录字段 ${d.changes.record.length}，失效率类 ${d.changes.rates.length}，机制集字段 ${d.changes.set.length}`, `input changes: ${d.changes.record.length} record fields, ${d.changes.rates.length} rate classes, ${d.changes.set.length} mechanism-set fields`)}</li>
  <li>${T(`校验：${counts.error} 错误、${counts.warning} 警告、${counts.info} 提示；扩展请求 ${d.extensionRequests.length}`, `validation: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} notes; ${d.extensionRequests.length} extension requests`)}</li>
</ul>`;
  // v5.6 a delta on the effective-goodput basis shows G_eff nominal / derated (the report's metric), the delivered goodput and A_op derated
  const EFF = d.metric === 'effective';
  const kpiRows = [];
  for (let i = 0; i < d.kpi.after.length; i++) {
    const a = d.kpi.after[i], b = hasBefore ? d.kpi.before[i] : null, dl = d.kpi.delta ? d.kpi.delta[i] : null;
    const kTxt = (x) => (x.feasible === false ? T('—（不可达）', '— (not feasible)') : fmt(x.k, 3));
    const row = (label, x) => EFF
      ? [label, pp(x.effective), pp(x.effectiveDerated), pp(x.delivered), pp(x.aOpDerated), h(x.mtbfHwH), s(x.mttrS), `${(x.windowP * 100).toFixed(1)} % · ${esc(x.verdict)}`, kTxt(x), `${esc(x.mechanisms.join(' + ') || '—')} | ${esc(x.levers.join(' + ') || '—')}`, pp(x.recommendedEffectiveDerated), fmt(x.effort, 1)]
      : [label, pp(x.aOp), pp(x.aOpDerated), pp(x.delivered), h(x.mtbfHwH), s(x.mttrS), `${(x.windowP * 100).toFixed(1)} % · ${esc(x.verdict)}`, fmt(x.k, 3), `${esc(x.mechanisms.join(' + ') || '—')} | ${esc(x.levers.join(' + ') || '—')}`, pp(x.recommendedAopDerated), fmt(x.effort, 1)];
    if (b) kpiRows.push(row(`${kNum(a.scale, lang)} · ${T('之前', 'before')}`, b));
    kpiRows.push(row(`${kNum(a.scale, lang)} · ${T('之后', 'after')}`, a));
    const moves = esc([...dl?.mechanismsAdded ?? [], ...dl?.leversAdded ?? []].map((m) => `+${m}`).concat([...dl?.mechanismsRemoved ?? [], ...dl?.leversRemoved ?? []].map((m) => `−${m}`)).join(' ') || '—');
    if (dl) kpiRows.push(EFF
      ? [`${kNum(a.scale, lang)} · Δ`, dpt(dl.dEffective), dpt(dl.dEffectiveDerated), dpt(dl.dDelivered), dpt(dl.dAopDerated), ratio(dl.mtbfRatio), ratio(dl.mttrRatio), '', `${dl.dK >= 0 ? '+' : '−'}${fmt(Math.abs(dl.dK), 3)}`, moves, '', `${dl.dEffort >= 0 ? '+' : '−'}${fmt(Math.abs(dl.dEffort), 1)}`]
      : [`${kNum(a.scale, lang)} · Δ`, dpt(dl.dAop), dpt(dl.dAopDerated), dpt(dl.dDelivered), ratio(dl.mtbfRatio), ratio(dl.mttrRatio), '', `${dl.dK >= 0 ? '+' : '−'}${fmt(Math.abs(dl.dK), 3)}`, esc([...dl.mechanismsAdded.map((m) => `+${m}`), ...dl.mechanismsRemoved.map((m) => `−${m}`), ...dl.leversAdded.map((m) => `+${m}`), ...dl.leversRemoved.map((m) => `−${m}`)].join(' ') || '—'), '', `${dl.dEffort >= 0 ? '+' : '−'}${fmt(Math.abs(dl.dEffort), 1)}`]);
  }
  const kpi = `
<h2>${T('结果：今日设计与推荐设计', 'Results: today\'s design and the recommended design')}</h2>
${EFF
    ? table([T('规模', 'scale'), T('G_eff 名义', 'G_eff nominal'), T('G_eff 降额', 'G_eff derated'), T('交付 goodput', 'delivered'), T('A_op 降额', 'A_op derated'), 'MTBF_hw', 'MTTR_hw', T('P(窗口)', 'P(window)'), 'k', T('推荐机制 | 杠杆', 'recommended mechanisms | levers'), T('推荐 G_eff 降额', 'recommended G_eff derated'), T('工作量', 'effort')], kpiRows, [1, 2, 3, 4, 5, 6, 7, 8, 10, 11])
    : table([T('规模', 'scale'), T('A_op 名义', 'A_op nominal'), T('A_op 降额', 'A_op derated'), T('交付 goodput', 'delivered'), 'MTBF_hw', 'MTTR_hw', T('P(窗口)', 'P(window)'), 'k', T('推荐机制 | 杠杆', 'recommended mechanisms | levers'), T('推荐 A_op 降额', 'recommended A_op derated'), T('工作量', 'effort')], kpiRows, [1, 2, 3, 4, 5, 6, 7, 9, 10])}
<p class="note">${T('“之前”行用旧输入、“之后”行用新输入在同一引擎、同一种子下计算；Δ 行是两者之差（百分点、倍数）。', 'The "before" rows use the old inputs and the "after" rows the new ones, same engine and seed; Δ rows are their difference (percentage points, ratios).')}</p>`;

  const conf = (c) => (c ? `<span class="tag">${esc(c)}</span>` : '');
  const recordRows = d.changes.record.map((c) => [`<code>${esc(c.path)}</code>`, esc(c.kind), cell(c.before, lang), cell(c.after, lang), esc(c.source ?? ''), conf(c.confidence)]);
  const rateRows = d.changes.rates.map((c) => [`<code>${esc(c.class)}</code>`, esc(c.unit ?? ''), c.before === null ? '—' : num(c.before), c.after === null ? '—' : num(c.after), ratio(c.ratio), conf(c.confidence), esc(c.source ?? ''), esc(c.derivation ?? '')]);
  const setRows = d.changes.set.map((c) => [`<code>${esc(c.path)}</code>`, esc(c.kind), cell(c.before, lang), cell(c.after, lang), esc(c.source ?? ''), conf(c.confidence)]);
  const none = `<p class="note">${T('无变化。', 'No change.')}</p>`;
  const changes = `
<h2 class="first">${T('输入变化', 'Input changes')}</h2>
<h3>${T('拓扑记录', 'Topology record')}</h3>
${recordRows.length ? table([T('字段', 'path'), T('类型', 'kind'), T('之前', 'before'), T('之后', 'after'), T('来源', 'source'), T('置信', 'confidence')], recordRows) : none}
<h3>${T('失效率（业务影响 FIT / 单元·小时）', 'Failure rates (business-impact FIT per unit-hour)')}</h3>
${rateRows.length ? table([T('类', 'class'), T('单元', 'unit'), T('之前', 'before'), T('之后', 'after'), T('倍数', 'ratio'), T('置信', 'confidence'), T('来源', 'source'), T('算式', 'derivation')], rateRows, [2, 3, 4]) : none}
<p class="note">${T('每卡口径的覆盖按单元的卡数折算到每单元；hard / slow / sdc 三类各自比较，不相加。', 'Per-card overrides are converted to the per-unit basis by the cards per unit; the hard, slow and sdc classes are compared each on its own, never added.')}</p>
<h3>${T('机制集', 'Mechanism set')}</h3>
${setRows.length ? table([T('字段', 'path'), T('类型', 'kind'), T('之前', 'before'), T('之后', 'after'), T('来源', 'source'), T('置信', 'confidence')], setRows) : none}`;

  const issueRows = d.issues.map((i) => [`<td class="${i.level === 'error' ? 'warn' : ''}">${esc(i.level)}</td>`, `<code>${esc(i.path)}</code>`, esc(i.code), esc(i.message[lang])]);
  const issues = `
<h2 class="first">${T('校验', 'Validation')}</h2>
${issueRows.length ? `<table><thead><tr><th>${T('级别', 'level')}</th><th>${T('路径', 'path')}</th><th>${T('代码', 'code')}</th><th>${T('说明', 'message')}</th></tr></thead><tbody>${issueRows.map((r) => `<tr>${r[0]}<td>${r[1]}</td><td>${r[2]}</td><td class="w">${r[3]}</td></tr>`).join('\n')}</tbody></table>` : `<p class="note">${T('无问题。', 'No issues.')}</p>`}
<h2>${T('扩展请求', 'Extension requests')}</h2>
${d.extensionRequests.length ? `<ul class="kf">${d.extensionRequests.map((r) => `<li><b>${esc(r.title[lang])}</b> (<code>${esc(r.kind)}</code>): ${esc(r.summary[lang])}</li>`).join('')}</ul>` : `<p class="note">${T('无：所有输入都是数据更新。', 'None: every input is a data update.')}</p>`}
${d.notes.length ? `<h2>${T('备注', 'Notes')}</h2><ul class="kf">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<p class="note">${T(`数据：<code>delta.json</code>（${esc(d.generated)}；引擎 HAC-D ${esc(prov?.engine?.version ?? '?')}）。${prov?.command ? `复现：<code style="overflow-wrap:anywhere">${esc(prov.command)}</code>。` : ''}`, `Data: <code>delta.json</code> (${esc(d.generated)}; engine HAC-D ${esc(prov?.engine?.version ?? '?')}).${prov?.command ? ` Reproduce: <code style="overflow-wrap:anywhere">${esc(prov.command)}</code>.` : ''}`)}</p>`;
  return [summary + kpi, changes, issues];
}

const check = (d) => {
  for (const k of ['version', 'generated', 'target', 'scales', 'before', 'after', 'changes', 'kpi', 'issues', 'extensionRequests', 'notes']) if (!(k in d)) throw new Error(`delta: missing '${k}'`);
  if (d.version !== 'hacd-delta-1') throw new Error(`delta: unsupported version '${d.version}'`);
  if (!Array.isArray(d.kpi.after) || d.kpi.after.length !== d.scales.length) throw new Error('delta: kpi.after must have one row per scale');
};

/** the bilingual review page of a delta document */
export function deltaHtml({ delta, provenance }) {
  check(delta);
  const title = { zh: `HAC-D 输入变更评审 — ${delta.after.record?.name?.zh ?? delta.after.record?.id ?? ''}`, en: `HAC-D input change review — ${delta.after.record?.name?.en ?? delta.after.record?.id ?? ''}` };
  const eyebrow = (lang) => (i, n) => (lang === 'zh' ? `HAC-D 输入变更评审 · ${delta.generated} · 第 ${i} / ${n} 页` : `HAC-D input change review · ${delta.generated} · page ${i} / ${n}`);
  const wrap = (lang) => `<h1>${esc(title[lang])}</h1>` + pages(body(lang, delta, provenance), eyebrow(lang));
  return pageShell({ title: title.en, description: 'Review page of a HAC-D ingest run: input changes with provenance and the KPI table before and after.', zhBody: wrap('zh'), enBody: wrap('en') });
}

/** the same content as Markdown, for review queues and pull requests */
export function deltaMarkdown(delta, lang = 'en') {
  check(delta);
  const d = delta, T = (zh, en) => (lang === 'zh' ? zh : en);
  const idText = (x) => (x ? `\`${x.id}\`` : T('（无）', '(none)'));
  const hasBefore = Array.isArray(d.kpi.before) && d.kpi.before.length > 0;
  const esc2 = (x) => String(x ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const L = [`# ${T('HAC-D 输入变更评审', 'HAC-D input change review')} — ${d.after.record?.name?.[lang] ?? d.after.record?.id ?? ''}`, '', `${T('生成', 'generated')} ${d.generated} · ${T('目标', 'target')} A_op ≥ ${fmt(d.target * 100, 1)} % · ${T('规模', 'scales')} ${d.scales.map((n) => fmt(n)).join(' / ')} · ${fmt(d.trials)} ${T('窗口', 'windows')} · ${T('种子', 'seed')} ${d.seed}`, '',
    `- ${T('之前', 'before')}: ${hasBefore ? `${T('记录', 'record')} ${idText(d.before.record)}, ${T('机制集', 'set')} ${idText(d.before.set)}, ${T('失效率', 'rates')} ${d.before.rates ? idText(d.before.rates) : T('单元库', 'unit library')}` : T('无基线（新记录）', 'none (new record)')}`,
    `- ${T('之后', 'after')}: ${T('记录', 'record')} ${idText(d.after.record)}, ${T('机制集', 'set')} ${idText(d.after.set)}, ${T('失效率', 'rates')} ${d.after.rates ? idText(d.after.rates) : T('单元库', 'unit library')}`,
    `- ${T('输入变化', 'input changes')}: ${d.changes.record.length} ${T('记录字段', 'record fields')}, ${d.changes.rates.length} ${T('失效率类', 'rate classes')}, ${d.changes.set.length} ${T('机制集字段', 'set fields')}; ${T('校验', 'validation')}: ${d.issues.filter((i) => i.level === 'error').length} ${T('错误', 'errors')}, ${d.issues.filter((i) => i.level === 'warning').length} ${T('警告', 'warnings')}; ${d.extensionRequests.length} ${T('扩展请求', 'extension requests')}`, '',
    `## ${T('结果', 'Results')}`, '', `| ${T('规模', 'scale')} | | A_op | A_op ${T('降额', 'derated')} | ${T('交付', 'delivered')} | MTBF_hw | MTTR_hw | P(window) | k | ${T('推荐', 'recommended')} | ${T('工作量', 'effort')} |`, '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (let i = 0; i < d.kpi.after.length; i++) {
    const a = d.kpi.after[i], b = hasBefore ? d.kpi.before[i] : null, dl = d.kpi.delta ? d.kpi.delta[i] : null;
    const row = (lab, x) => `| ${fmt(x.scale)} | ${lab} | ${pp(x.aOp)} | ${pp(x.aOpDerated)} | ${pp(x.delivered)} | ${h(x.mtbfHwH)} | ${s(x.mttrS)} | ${(x.windowP * 100).toFixed(1)} % ${x.verdict} | ${fmt(x.k, 3)} | ${esc2(x.mechanisms.join('+') || '—')} \\| ${esc2(x.levers.join('+') || '—')} | ${fmt(x.effort, 1)} |`;
    if (b) L.push(row(T('之前', 'before'), b));
    L.push(row(T('之后', 'after'), a));
    if (dl) L.push(`| ${fmt(a.scale)} | Δ | ${dpt(dl.dAop)} | ${dpt(dl.dAopDerated)} | ${dpt(dl.dDelivered)} | ${ratio(dl.mtbfRatio)} | ${ratio(dl.mttrRatio)} | | ${dl.dK >= 0 ? '+' : '−'}${fmt(Math.abs(dl.dK), 3)} | ${esc2([...dl.mechanismsAdded.map((m) => `+${m}`), ...dl.mechanismsRemoved.map((m) => `−${m}`)].join(' ') || '—')} | ${dl.dEffort >= 0 ? '+' : '−'}${fmt(Math.abs(dl.dEffort), 1)} |`);
  }
  L.push('', `## ${T('输入变化', 'Input changes')}`, '');
  if (d.changes.record.length) { L.push(`### ${T('拓扑记录', 'Topology record')}`, '', `| ${T('字段', 'path')} | ${T('类型', 'kind')} | ${T('之前', 'before')} | ${T('之后', 'after')} | ${T('来源', 'source')} | ${T('置信', 'confidence')} |`, '|---|---|---|---|---|---|'); for (const c of d.changes.record) L.push(`| \`${c.path}\` | ${c.kind} | ${esc2(txt(c.before, lang))} | ${esc2(txt(c.after, lang))} | ${esc2(c.source ?? '')} | ${c.confidence ?? ''} |`); L.push(''); }
  if (d.changes.rates.length) { L.push(`### ${T('失效率（业务影响 FIT / 单元·小时）', 'Failure rates (business-impact FIT per unit-hour)')}`, '', `| ${T('类', 'class')} | ${T('单元', 'unit')} | ${T('之前', 'before')} | ${T('之后', 'after')} | ${T('倍数', 'ratio')} | ${T('置信', 'confidence')} | ${T('来源', 'source')} |`, '|---|---|---|---|---|---|---|'); for (const c of d.changes.rates) L.push(`| \`${c.class}\` | ${c.unit ?? ''} | ${c.before === null ? '—' : num(c.before)} | ${c.after === null ? '—' : num(c.after)} | ${ratio(c.ratio)} | ${c.confidence ?? ''} | ${esc2(c.source ?? '')} |`); L.push(''); }
  if (d.changes.set.length) { L.push(`### ${T('机制集', 'Mechanism set')}`, '', `| ${T('字段', 'path')} | ${T('类型', 'kind')} | ${T('之前', 'before')} | ${T('之后', 'after')} | ${T('来源', 'source')} | ${T('置信', 'confidence')} |`, '|---|---|---|---|---|---|'); for (const c of d.changes.set) L.push(`| \`${c.path}\` | ${c.kind} | ${esc2(txt(c.before, lang))} | ${esc2(txt(c.after, lang))} | ${esc2(c.source ?? '')} | ${c.confidence ?? ''} |`); L.push(''); }
  if (!d.changes.record.length && !d.changes.rates.length && !d.changes.set.length) L.push(T('无变化。', 'No change.'), '');
  L.push(`## ${T('校验', 'Validation')}`, '');
  if (d.issues.length) { L.push(`| ${T('级别', 'level')} | ${T('路径', 'path')} | ${T('代码', 'code')} | ${T('说明', 'message')} |`, '|---|---|---|---|'); for (const i of d.issues) L.push(`| ${i.level} | \`${i.path}\` | ${i.code} | ${esc2(i.message[lang])} |`); } else L.push(T('无问题。', 'No issues.'));
  L.push('', `## ${T('扩展请求', 'Extension requests')}`, '');
  if (d.extensionRequests.length) for (const r of d.extensionRequests) L.push(`- **${r.title[lang]}** (${r.kind}): ${r.summary[lang]}`); else L.push(T('无：所有输入都是数据更新。', 'None: every input is a data update.'));
  if (d.notes.length) { L.push('', `## ${T('备注', 'Notes')}`, ''); for (const n of d.notes) L.push(`- ${n}`); }
  return L.join('\n') + '\n';
}
