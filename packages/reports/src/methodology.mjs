/**
 * Methodology recipe of the Ascend allocation report set — docs/ASCEND_ALLOCATION_METHODOLOGY.html (bilingual zh / en, zh default,
 * print shows the active language): scope and 口径, the six formulas, the allocation procedure (Figure 1), the layer model (Table 1),
 * the ReMAP mechanism hierarchy (Figure 2) with the 23 mechanisms + I-CONTAIN and the set's table with the Shapley values per scale being Table 6 of each Findings page since 2026-10-25, the hierarchical
 * MTBF / MTTR budgets, and the HAC-D tooling requirements (Table 3). Prose: content.mjs.
 * Pure function of its data: `results` = docs/backup/ascend-allocation/results.json, `mechanisms` = …/mechanisms.json (parsed).
 * No file access; the date comes from `results.generated`.
 * v5 (hacd CLI): optional `provenance` replaces the footer's data / build sentence with the hacd command, record / set / override
 * ids, run options and engine version; the instance counts are read at `results.main` and the Shapley columns at the hierarchy's
 * decision scale (the largest scale of its studies), so the 50 万 / 500k headers follow the data (identical for the v4.4 data).
 * Relocated from scripts/build-ascend-allocation-methodology.mjs (v5 T10), now a thin wrapper that reads and writes the files.
 */
import { esc, fmt, tw, wrap, lines, sz, W, pageShell, pages, M, svgDyn, svgClose, titleBlock, legend, node, arrowDefs, arrow, FLOW, chip, tiny, CHIP_H, kN, provenanceFooter, countWord } from './kit.mjs';
import { contentFor } from './content.mjs';
import { FINDINGS_FILES } from './findings.mjs';

const VERDICTS = ['reference', 'candidate', 'goodput', 'pruned', 'capability'];
const VCLS = { reference: 'ub', candidate: 'so', goodput: 'npu', pruned: 'asm', capability: 'unk' };
const STAGE_COL = { detection: 'det', rung: 'rung', automatic: 'auto', manual: 'man', checkpoint: 'ckpt', sdc: 'sdc', rate: 'rate', local: 'rate', none: 'rate' };
const COLS = ['det', 'rung', 'auto', 'man', 'ckpt', 'sdc', 'rate'];
/** content strings: escape everything except the intentional <b> markup */
const H = (s) => esc(s).replace(/&lt;(\/?)b&gt;/g, '<$1b>');
/** Shapley range in percentage points */
const pt = (v, d) => { const r = Number((v * 100).toFixed(d)); return r === 0 ? (0).toFixed(d) : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(d)}`; };
const range = (o, d) => (o.min == null ? '—' : pt(o.min, d) === pt(o.max, d) ? pt(o.min, d) : `${pt(o.min, d)} – ${pt(o.max, d)}`);
const CAT_EN = { 'ReMAP 基线扩展': 'ReMAP baseline extension', 参考机制: 'reference mechanism', 新增: 'new', '新增／依赖能力': 'new / enabling capability', '扩展 C-FAST': 'extends C-FAST', 扩展恢复编排: 'extends recovery orchestration', '用户方案 · 检测扩展': 'user plan · detection extension', '用户方案 · 漏检补充': 'user plan · missed-detection backup', '用户方案 · 发生率改善': 'user plan · rate improvement', '用户方案 · 局部恢复加速': 'user plan · faster local recovery', '用户方案 · 启动加速': 'user plan · faster startup' };

/** the page sections of one language; `ctx` carries the data-derived values of methodologyHtml */
function sections(lang, ctx) {
  const { R, MX, DATE, MAIN, ARCHS, LAYERS, MECHS, DEC, PROV, C, TGT } = ctx;
  const { SUBTITLE, SCOPE, FORMULAS, LAYERS_TEXT, MECH_TEXT, BUDGET_TEXT, TOOLING, FOOTER, TITLE } = C;
  const LROW = Object.fromEntries(LAYERS_TEXT.rows.map((r) => [r.id, r]));
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const L = (o) => o[lang];
  const NA = { zh: `${countWord(ARCHS.length, 'zh').replace(/个$/, '种')}拓扑`, en: `the ${countWord(ARCHS.length, 'en')} topolog${ARCHS.length === 1 ? 'y' : 'ies'}` };
  const CAPS = MX.mechanisms.filter((m) => !m.appliable).map((m) => m.id);
  const LN = Object.fromEntries(R.layers.map((l) => [l.id, l.name[lang]]));
  const LS = { cluster: T('集群', 'cluster'), scaleout: T('跨超节点', 'scale-out'), superpod: T('超节点', 'SuperPoD'), cabinet: T('柜', 'cabinet'), node: T('节点', 'node'), npu: 'NPU' };
  const VN = { reference: T('参考', 'reference'), candidate: T('候选', 'candidate'), goodput: T('只保有效产出', 'goodput-only'), pruned: T('剪除', 'pruned'), capability: T('能力', 'capability') };
  const VG = { reference: T('ReMAP 参考集（原样保留）', 'ReMAP reference set (kept as is)'), candidate: T('A_op 候选（进入分配）', 'A_op candidates (enter the allocation)'), goodput: T('只保有效产出（保留，不参与 A_op 分配）', 'goodput-only (kept, outside the A_op allocation)'), pruned: T(`剪除（被支配或低于 ${fmt(MX.threshold * 100, 2)} 点）`, `pruned (dominated or below ${fmt(MX.threshold * 100, 2)} pt)`), capability: T('能力（不可单独应用）', 'capability (not appliable on its own)') };
  const CN = { det: T('检测', 'detection'), rung: T('机制链梯级', 'chain rung'), auto: T('自动恢复阶段', 'automatic-recovery stage'), man: T('人工兜底', 'manual fallback'), ckpt: T('检查点', 'checkpoint'), sdc: T('静默损坏', 'silent corruption'), rate: T('发生率 · 局部 · 能力', 'rate · local · capability') };
  const D = R.derate;

  /* ---------------- Figure 1: the allocation procedure as a tree ---------------- */
  function figProcedure() {
    const id = `proc-${lang}`;
    const head = titleBlock(T('图 1：HAC-D 的分配流程——目标 → 总预算 → 六层 → 层内最小努力 → 三重校核 → 四级预算', 'Figure 1: HAC-D allocation procedure — goal → budget → six layers → least effort → checks → budgets'));
    let g = svgDyn(`fig-procedure-${lang}`, T('分配流程', 'Allocation procedure')) + arrowDefs(id) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    const goal = node(160, 32, 640, 'cab', T(`① 目标与口径：A_op ≥ A* = ${TGT}`, `① Goal and 口径: A_op ≥ A* = ${TGT}`), T('30 天窗口 · 一个同步训练作业 · 分母为集群·小时 · 各事件类分开（公式 1）', '30-day window · one synchronous training job · per cluster-hour · event classes kept apart (formula 1)'));
    g += goal.svg;
    const budget = node(160, goal.bottom + 18, 640, 'cab', T('② 总预算 B（公式 2）', '② Total budget B (formula 2)'), T('每小时允许的硬中断暂停秒数 B，对比今天的 MTTR_hw / MTBF_hw × 3600；系统级 MTBF_hw / MTTR_hw 要求', 'hard-interruption pause seconds allowed per hour, B, against today’s MTTR_hw / MTBF_hw × 3600; system-level MTBF_hw / MTTR_hw requirements'));
    g += budget.svg + arrow(id, `M ${goal.cx} ${goal.bottom} V ${budget.y - 2}`);
    const fanL = wrap(T('③ 按故障单元分到六层（每类事件只归一个单元、一层）：C_ℓ、U_ℓ、按实例的 MTBF（公式 3）', '③ split over six layers by fault unit (each event class on one unit and one layer): C_ℓ, U_ℓ, MTBF per instance (formula 3)'), W - 44 - budget.cx, sz(9.8)), flh = Math.round(sz(9.8) * 1.3);
    g += lines(budget.cx + 10, budget.bottom + flh, fanL, 'm', flh);
    const fanY = budget.bottom + fanL.length * flh;
    const lw = 150, step = 156, x0 = (W - (5 * step + lw)) / 2, ly = fanY + 17;
    const lay = LAYERS.map((l, i) => node(x0 + i * step, ly, lw, 'ub', LN[l], LROW[l].units));
    const lh = Math.max(...lay.map((n) => n.h));
    lay.forEach((n) => { g += n.svg.replace(/height="[\d.]+"/, `height="${lh}"`) + `<path d="M ${budget.cx} ${budget.bottom} V ${fanY + 10} H ${n.cx} V ${ly - 2}" style="${FLOW}" marker-end="url(#arr-${id})"/>`; });
    const cy = ly + lh + 16, cw = (lw - 6) / 2, clh = Math.round(sz(9.8) * 1.3);
    const kid = (x, cls, t) => { const ls = wrap(t, cw - 8, sz(9.8) * 1.1); return { x, cls, ls, cx: x + cw / 2, h: ls.length * clh + 10 }; };
    const kids = [];
    lay.forEach((n) => {
      const a = kid(n.x, 'so', T('机制·杠杆', 'mech. · levers')), b = kid(n.x + lw - cw, 'npu', T('硬件 FIT×k', 'hardware FIT × k'));
      kids.push(a, b);
      g += `<path d="M ${n.cx} ${n.y + lh} V ${cy - 10} H ${a.cx} V ${cy - 2}" style="${FLOW}" marker-end="url(#arr-${id})"/><path d="M ${n.cx} ${cy - 10} H ${b.cx} V ${cy - 2}" style="${FLOW}" marker-end="url(#arr-${id})"/>`;
    });
    const kh = Math.max(...kids.map((k) => k.h)), brY = cy + kh + 10;
    kids.forEach((k) => { g += `<rect x="${k.x}" y="${cy}" width="${cw}" height="${kh}" rx="6" class="${k.cls}"/>` + lines(k.cx, cy + (kh - k.ls.length * clh) / 2 + clh - 4, k.ls, 'sb', clh, 'middle') + `<path d="M ${k.cx} ${cy + kh} V ${brY}" style="${FLOW}"/>`; });
    g += `<path d="M ${kids[0].cx} ${brY} H ${kids[kids.length - 1].cx}" style="${FLOW}"/>`;
    const lev = R.levers.map((l) => ({ auto: T(`自动尝试 ≥ ${l.limit} s`, `automatic attempt ≥ ${l.limit} s`), success: T(`自动成功 ≤ ${fmt(l.limit * 100, 1)} %`, `automatic success ≤ ${fmt(l.limit * 100, 1)} %`), manual: T(`人工 ≥ ${l.limit / 60} min`, `manual ≥ ${l.limit / 60} min`) })[l.id] + T(`（努力 ${l.effort}）`, ` (effort ${l.effort})`)).join(T('、', ', '));
    const eff = node(110, brY + 13, 700, 'cab', T('④ 层内取舍：总努力 E 最小（公式 4）', '④ Within a layer: least total effort E (formula 4)'), T(`${R.candidates.length} 个候选机制（各自的努力 e_m）+ ${R.levers.length} 个恢复杠杆：${lev} + 硬件 ARINC：全部中断类 FIT × k，每减半努力 2；${R.candidates.length + R.levers.length} 个动作的 ${fmt(2 ** (R.candidates.length + R.levers.length))} 个子集精确枚举`, `${R.candidates.length} candidate mechanisms (effort e_m each) + ${R.levers.length} recovery levers: ${lev} + ARINC hardware: every interruption FIT × k, effort 2 per halving; the ${fmt(2 ** (R.candidates.length + R.levers.length))} subsets of the ${R.candidates.length + R.levers.length} moves enumerated exactly`));
    g += eff.svg + arrow(id, `M ${eff.cx} ${brY} V ${eff.y - 2}`);
    const chk = node(110, eff.bottom + 19, 700, 'panel', T('⑤ 校核：名义 · 降额 · 逐窗口（公式 6）', '⑤ Checks: nominal · derated · per window (formula 6)'), T(`A_op ≥ A* 名义，且全部机制降额（覆盖 −${D.coverageDelta * 100} pt、成功 −${D.successDelta * 100} pt、时间 ×${D.timeFactor}、发生率改善 ×${D.reductionFactor}）；${R.trials} 个 30 天窗口，P(A_op ≥ A*) 的 Wilson 95 % 下界 ≥ ${fmt((R.required ?? 0.9) * 100, 0)} %`, `A_op ≥ A* nominally and with every mechanism derated (coverage −${D.coverageDelta * 100} pt, success −${D.successDelta * 100} pt, times ×${D.timeFactor}, rate improvements ×${D.reductionFactor}); ${R.trials} 30-day windows, Wilson 95 % lower bound of P(A_op ≥ A*) ≥ 90 %`));
    g += chk.svg + arrow(id, `M ${eff.cx} ${eff.bottom} V ${chk.y - 2}`);
    g += arrow(id, `M ${chk.x + chk.w} ${chk.y + chk.h / 2} H ${chk.x + chk.w + 20} V ${eff.y + eff.h / 2} H ${eff.x + eff.w + 2}`, true);
    const nsY = (chk.y + chk.h / 2 + eff.y + eff.h / 2) / 2;
    const nsL = wrap(T('不支持：加最便宜的未用动作或收紧 k', 'not supported: add the cheapest unused move or lower k'), W - chk.x - chk.w - 38, sz(9.8)), nlh = Math.round(sz(9.8) * 1.3);
    g += lines(chk.x + chk.w + 26, nsY - (nsL.length * nlh) / 2 + nlh - 4, nsL, 'm', nlh);
    const out = node(110, chk.bottom + 19, 700, 'cab', T('⑥ 输出：系统 / 层 / 单元 / 机制四级预算（§5）', '⑥ Outputs: budgets at the system / layer / unit / mechanism levels (§5)'), T(`预算表与叠加图见 ASCEND_ALLOCATION_FINDINGS_{${ARCHS.map((a) => FINDINGS_FILES[a] ?? a.toUpperCase()).join(',')}}.html`, `budget tables and overlays in ASCEND_ALLOCATION_FINDINGS_{${ARCHS.map((a) => FINDINGS_FILES[a] ?? a.toUpperCase()).join(',')}}.html`));
    g += out.svg + arrow(id, `M ${chk.cx} ${chk.bottom} V ${out.y - 2}`);
    return svgClose(g, out.bottom + 10 + head.dy);
  }

  /* ---------------- Figure 2: mechanism hierarchy — deployment layer × stage group ---------------- */
  function figHierarchy() {
    const head = titleBlock(T('图 2：机制分层图——部署层 × 所作用的恢复阶段；颜色为取舍结论（悬停看名称、所改变的量与理由）', 'Figure 2: mechanism hierarchy — deployment layer × recovery stage acted on; colour = verdict (hover for details)'));
    let g = svgDyn(`fig-hierarchy-${lang}`, T('机制分层图', 'Mechanism hierarchy')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    const x0 = 14, avail = W - 2 * x0, labW = 82, pad = 4, gap = 6, LH = CHIP_H + 4;
    /* chip width: the kit's chip draws its label at x + 8; 16 + text width leaves ≥ 8 px on the right */
    const cwid = (id) => 16 + tw(id, sz(8.4));
    const flowT = (ids, xa, width) => { let x = xa, line = 0; const pos = ids.map((id) => { const w = cwid(id); if (x + w > xa + width + 0.01 && x > xa) { x = xa; line++; } const q = { x, line, w }; x += w + gap; return q; }); return { pos, lines: ids.length ? line + 1 : 0 }; };
    const byCol = (c) => MX.mechanisms.filter((m) => STAGE_COL[m.stage] === c);
    const colW = Object.fromEntries(COLS.map((c) => [c, Math.max(58, ...byCol(c).map((m) => cwid(m.id))) + 2 * pad]));
    const extra = avail - labW - COLS.reduce((a, c) => a + colW[c], 0);
    if (extra < 0) throw new Error(`hierarchy grid too wide by ${-extra}`);
    const sdcNeed = Math.max(0, cwid('D-SDC-FP8') + cwid('D-SDC-FP4') + gap + 2 * pad - colW.sdc), give = Math.min(extra, sdcNeed); /* two detectors per line in the NPU row */
    colW.sdc += give; colW.rate += extra - give;
    const colX = {}; let cx = x0 + labW; for (const c of COLS) { colX[c] = cx; cx += colW[c]; }
    const lh = Math.round(sz(9.8) * 1.3), hlh = Math.round(sz(8.4) * 1.3), top = 30;
    const hdr = Object.fromEntries(COLS.map((c) => [c, wrap(CN[c], colW[c] - 2 * pad, sz(8.4) * 1.05)]));
    const hdrH = Math.max(...COLS.map((c) => hdr[c].length)) * hlh + 5;
    const hstyle = 'font-weight:600;fill:var(--ink)';
    for (const c of COLS) hdr[c].forEach((t, i) => { g += tiny(colX[c] + pad, top + hlh - 3 + i * hlh, t, 'start', hstyle); });
    wrap(T('部署层', 'layer'), labW - 2 * pad, sz(8.4) * 1.05).forEach((t, i) => { g += tiny(x0 + pad, top + hlh - 3 + i * hlh, t, 'start', hstyle); });
    let y = top + hdrH;
    LAYERS.forEach((l, li) => {
      const cells = COLS.map((c) => { const ms = MX.mechanisms.filter((m) => m.deploy === l && STAGE_COL[m.stage] === c); return { c, ms, f: flowT(ms.map((m) => m.id), colX[c] + pad, colW[c] - 2 * pad) }; });
      const nameL = LN[l].split(/(?=（)|\s(?=\()/).flatMap((part) => wrap(part, labW - 2 * pad, sz(9.8) * 1.05)), acting = MX.mechanisms.filter((m) => (m.acts ?? []).includes(l)).length;
      const rowH = Math.max(nameL.length * lh + 8, 8 + Math.max(1, ...cells.map((k) => k.f.lines)) * LH - 4);
      g += `<rect x="${x0}" y="${y}" width="${avail}" height="${rowH}" rx="4" style="fill:${li % 2 ? 'var(--surface)' : 'var(--mid)'};stroke:var(--grid)" data-tip="${esc(`${LN[l]}|${T(`作用于此层的机制：${acting} 个`, `mechanisms acting on this layer: ${acting}`)}`)}"/>`;
      if (cells.some((k) => k.ms.length)) for (const c of COLS) g += `<line x1="${colX[c]}" y1="${y}" x2="${colX[c]}" y2="${y + rowH}" class="grid"/>`;
      else g += `<line x1="${colX.det}" y1="${y}" x2="${colX.det}" y2="${y + rowH}" class="grid"/>`;
      g += lines(x0 + pad, y + lh - 1, nameL, 'sb', lh);
      cells.forEach((k) => { k.ms.forEach((m, j) => { const q = k.f.pos[j]; g += chip(q.x, y + 4 + q.line * LH, q.w, VCLS[m.verdict], m.id, `${m.id} · ${L(m.name)}|${T('改变', 'changes')}: ${L(m.changes)}|${VN[m.verdict]}: ${L(m.reason)}`); }); });
      if (cells.every((k) => !k.ms.length)) g += `<text x="${colX.det + pad}" y="${y + rowH / 2 + 4}" class="m">${esc(T(`无部署于此层的机制；作用于此层的 ${acting} 个机制部署在其他层`, `no mechanism deployed here; the ${acting} mechanisms acting on this layer are deployed on other layers`))}</text>`;
      y += rowH + 2;
    });
    const lg = legend(x0, y + 14, VERDICTS.map((v) => ({ cls: VCLS[v], label: `${VN[v]} (${MX.mechanisms.filter((m) => m.verdict === v).length})` })));
    g += lg.g;
    return svgClose(g, lg.y + 8 + head.dy);
  }

  /* ---------------- the outcome paragraph, stated from the data ---------------- */
  function outcome() {
    const of = (v) => MX.mechanisms.filter((m) => m.verdict === v);
    const ids = (v) => of(v).map((m) => m.id).join(T('、', ', '));
    const dom = of('pruned').filter((m) => m.dominatedBy), rest = of('pruned').filter((m) => !m.dominatedBy);
    const nc = of('candidate').length, nl = R.levers.length, moves = nc + nl;
    const domGroups = [...new Set(dom.map((m) => m.dominatedBy))].map((by) => T(`${dom.filter((m) => m.dominatedBy === by).map((m) => m.id).join('、')} 被 ${by} 支配`, `${dom.filter((m) => m.dominatedBy === by).map((m) => m.id).join(', ')} dominated by ${by}`));
    const prunedWhy = [...domGroups, ...(rest.length ? [T(`${rest.map((m) => m.id).join('、')} 低于阈值`, `${rest.map((m) => m.id).join(', ')} below the threshold`)] : [])].join(T('；', '; '));
    const search = moves <= 10 ? T(`HAC-D 最优策略精确枚举 ${fmt(2 ** moves)} 个子集`, `which HAC-D’s optimal strategy enumerates exactly (${fmt(2 ** moves)} subsets)`) : T('超过 10 个动作，HAC-D 最优策略改用贪心路径', 'more than 10 moves, so HAC-D’s optimal strategy falls back to the greedy path');
    return esc(T(`结果：${nc} 个 A_op 候选（${ids('candidate')}）、${of('goodput').length} 个只保有效产出（${ids('goodput')}）、${of('pruned').length} 个剪除（${prunedWhy}）、${of('capability').length} 个能力（${ids('capability')}）。${nc} 个候选 + ${nl} 个杠杆 = ${moves} 个动作，${search}。`,
      `Outcome: ${nc} A_op candidates (${ids('candidate')}), ${of('goodput').length} goodput-only (${ids('goodput')}), ${of('pruned').length} pruned (${prunedWhy}), ${of('capability').length} capability (${ids('capability')}). ${nc} candidates + ${nl} levers = ${moves} moves, ${search}.`));
  }

  /* ---------------- tables ---------------- */
  const th = (s, num = false) => `<th${num ? ' class="num"' : ''}>${esc(s)}</th>`;
  const table1 = `<div class="table-wrap"><table class="s1"><thead><tr>${th(T('层级', 'Layer'))}${th(T('故障单元', 'Fault units'))}${th(T('事件类', 'Event classes'))}${th(T('实例（验收对象）', 'Instance (accepted unit)'))}${ARCHS.map((a) => th(T(`${L(R.archs[a].short)}：${kN(Number(MAIN), 'zh')}卡实例数`, `${L(R.archs[a].short)}: instances at ${kN(Number(MAIN), 'en')}`), true)).join('')}${th(T('交付方', 'Delivered by'))}</tr></thead><tbody>${LAYERS.map((l) => `<tr><td><b>${esc(LN[l])}</b></td><td><code>${esc(LROW[l].units)}</code></td><td>${esc(LROW[l].classes)}</td><td>${esc(L(LROW[l].instance))}</td>${ARCHS.map((a) => `<td class="num">${fmt(R.archs[a].sizes[MAIN].instances[l])}</td>`).join('')}<td>${esc(L(LROW[l].delivered))}</td></tr>`).join('')}</tbody></table></div>`;
  const table3 = `<div class="table-wrap"><table class="s3"><thead><tr>${TOOLING.columns.map((c) => th(L(c))).join('')}</tr></thead><tbody>${TOOLING.rows.map((r) => `<tr><td>${H(L(r.cap))}</td><td class="${r.status === 'script' || r.status === 'external' ? 'warn' : 'ok'}">${esc(L(TOOLING.statusLabel[r.status]))}</td><td>${H(L(r.used))}</td><td>${H(L(r.todo))}</td></tr>`).join('')}</tbody></table></div>`;

  return [
    `<h1>${esc(L(TITLE))}</h1>
  <p class="sub">${H(L(SUBTITLE))}</p>
  <h2>${esc(L(SCOPE.heading))}</h2>
  <ul class="scale">${SCOPE.items.map((it) => `<li>${H(L(it))}</li>`).join('')}</ul>
  <h2>${esc(L(FORMULAS.heading))}</h2>
  ${FORMULAS.blocks.map((b) => `${M(b.tex)}\n  <p class="note">${H(L(b.note))}</p>`).join('\n  ')}
  <h2>${esc(L(LAYERS_TEXT.heading))}</h2>
  <p>${H(L(LAYERS_TEXT.intro))}</p>
  <h3>${esc(T(`表 1：六个层级——故障单元、事件类、实例与 ${kN(Number(MAIN), 'zh')}卡上的实例数`, `Table 1: the six layers — fault units, event classes, instance and instance counts at ${kN(Number(MAIN), 'en')}`))}</h3>
  ${table1}
  <p class="note">${H(L(LAYERS_TEXT.note))}</p>`,
    `<figure class="chart first"><div class="scroll">${figProcedure()}</div></figure>
  <h2>${esc(L(MECH_TEXT.heading))}</h2>
  <p>${H(L(MECH_TEXT.intro))}</p>
  <p class="note">${H(L(MECH_TEXT.rule))}</p>
  <figure class="chart"><div class="scroll">${figHierarchy()}</div></figure>
  <p class="note">${outcome()}</p>
  <p class="note">${esc(T(`机制集的表格——每项机制的部署层、作用层、所改变的量、努力、结论与理由，以及在该拓扑各规模上的 A_op Shapley 与 ${kN(DEC, 'zh')}卡的有效产出 Shapley（裸架构场景、${MX.source.permutations} 次置换）——是各拓扑 Findings 文件的表 6；结论对${NA.zh}相同。`, `The set’s table — each mechanism’s deployment layer, layers acted on, quantity changed, effort, verdict and reason, with the A_op Shapley values per scale and the goodput Shapley at ${kN(DEC, 'en')} on that architecture (bare scenario, ${MX.source.permutations} permutations) — is Table 6 of each Findings page; the verdicts are the same for ${NA.en}.`))}</p>
  <p class="note">${H(L(MECH_TEXT.overlapNote))}</p>`,
    `<h2 class="first">${esc(L(BUDGET_TEXT.heading))}</h2>
  <ul class="scale">${BUDGET_TEXT.steps.map((s) => `<li>${H(L(s))}</li>`).join('')}</ul>
  <p class="note">${H(L(BUDGET_TEXT.procedure))}</p>`,
    `<h2 class="first">${esc(L(TOOLING.heading))}</h2>
  <p>${H(L(TOOLING.intro))}</p>
  <h3>${esc(T('表 2：能力、实现方式与 v5 的实现', 'Table 2: capabilities, how they are implemented and the v5 implementation'))}</h3>
  ${table3}
  <h3>${esc(L(TOOLING.agent.heading))}</h3>
  <p>${H(L(TOOLING.agent.verdict))}</p>
  <ul class="scale">${TOOLING.agent.design.map((s) => `<li>${H(L(s))}</li>`).join('')}</ul>
  <footer>${PROV ? `${provenanceFooter(PROV, lang, ['results.json', 'mechanisms.json'], DATE)}${T('公式由 KaTeX 在构建时排版。', 'Formulas typeset at build time with KaTeX.')}` : H(L(FOOTER))}</footer>`,
  ];
}

const eyebrow = (lang, DATE) => (i, n) => (lang === 'zh' ? `HAC-D · 昇腾可用度分配 · 方法 · ${DATE} · 第 ${i} / ${n} 页` : `HAC-D · Ascend availability allocation · Methodology · ${DATE} · page ${i} / ${n}`);
const extraCss = `
  figure.chart.first { margin-top: 4px; }
  table.s1 td:first-child { min-width: 7em; } table.s1 td:nth-child(3) { min-width: 9em; } table.s1 td:nth-child(4) { min-width: 12em; } table.s1 td:last-child { min-width: 11em; }
  table.s2 td:nth-child(5) { min-width: 13em; } table.s2 td:last-child { min-width: 15em; } table.s2 td.num { white-space: nowrap; } table.s2 td:nth-child(4) { min-width: 7em; } table.s2 td:nth-child(2) { min-width: 7.5em; } table.s2 td:nth-child(3) { min-width: 5.5em; } table.s2 th:nth-child(6) { white-space: nowrap; }
  table.s3 td:first-child { min-width: 14em; } table.s3 td:last-child { min-width: 16em; } table.s3 td:nth-child(2) { white-space: nowrap; }
  @media print { table.s2 { font-size: 6.3px; } }
`;

/** the Methodology page as an HTML string; throws on inconsistent data (unknown verdict, stage, layer or category) and on undefined / NaN in the output */
export function methodologyHtml({ results, mechanisms, provenance }) {
  const R = results, MX = mechanisms;
  const DATE = new Date(R.generated).toLocaleDateString('sv-SE');
  const MAIN = String(R.main);
  const ARCHS = MX.archs;
  const LAYERS = R.layers.map((l) => l.id);
  const MECHS = VERDICTS.flatMap((v) => MX.mechanisms.filter((m) => m.verdict === v));
  if (MECHS.length !== MX.mechanisms.length) throw new Error('mechanism with an unknown verdict');
  for (const m of MX.mechanisms) { if (!STAGE_COL[m.stage]) throw new Error(`unknown stage ${m.stage}`); if (!LAYERS.includes(m.deploy)) throw new Error(`unknown layer ${m.deploy}`); }
  for (const m of MX.mechanisms) if (!(m.remapCategory in CAT_EN)) throw new Error(`no English for category ${m.remapCategory}`);
  // decision scale of the hierarchy's Shapley columns: the largest scale of its studies
  const DEC = Math.max(...ARCHS.flatMap((a) => Object.keys(MX.studies?.[a]?.baseline ?? {}).map(Number)));
  if (!Number.isFinite(DEC)) throw new Error('the mechanism hierarchy has no study scales');
  const maxHw = Math.max(0, ...MX.mechanisms.flatMap((m) => ARCHS.flatMap((a) => Object.values(m.shapley[a] ?? {}).filter(Boolean).map((s) => s.halfWidth ?? 0))));
  const archsMeta = ARCHS.map((a) => {
    const A = R.archs[a], z = A.sizes[MAIN], lay = A.layers ?? {};
    return { id: a, short: A.short, name: A.name, podNpus: lay.superpod?.npus ?? Math.round(z.npus / z.instances.superpod), superpodUnit: lay.superpod?.unit ?? 'supernodes', cabinetNpus: lay.cabinet?.npus ?? Math.round(z.npus / z.instances.cabinet), nodeNpus: lay.node?.npus ?? z.counts.gpusPerNode, cpusPerNode: Math.round(z.counts.cpus / z.counts.nodes) };
  });
  const C = contentFor({
    target: R.target, sizes: R.sizes, main: Number(MAIN), trials: R.trials, requiredP: R.required ?? 0.9, derate: R.derate, levers: R.levers, reference: R.reference, candidates: R.candidates.length, archs: archsMeta,
    originals: MX.mechanisms.filter((m) => m.origin === 'original').length, extensions: MX.mechanisms.filter((m) => m.origin !== 'original' && m.appliable).length, capabilities: MX.mechanisms.filter((m) => !m.appliable).map((m) => m.id),
    players: MX.source.players, permutations: MX.source.permutations, halfWidthPt: maxHw * 100, decisionScale: DEC, threshold: MX.threshold, engine: provenance?.engine?.version ?? 'v5',
  });
  const TGT = `${fmt(R.target * 100, 1)} %`;
  const ctx = { R, MX, DATE, MAIN, ARCHS, LAYERS, MECHS, DEC, PROV: provenance, C, TGT };
  const html = pageShell({
    title: `${C.TITLE.zh} · ${C.TITLE.en}`,
    description: `${C.SUBTITLE.zh} ${C.SUBTITLE.en}`,
    zhBody: pages(sections('zh', ctx), eyebrow('zh', DATE)),
    enBody: pages(sections('en', ctx), eyebrow('en', DATE)),
    extraCss,
  });
  for (const bad of ['undefined', 'NaN']) if (html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '').includes(bad)) throw new Error(`"${bad}" in the output`);
  return html;
}
