#!/usr/bin/env node
/**
 * Build docs/ASCEND_ALLOCATION_FINDINGS_{950,UBL128,CM384,A3SERVER}.html — the Findings volume of the Ascend allocation report set,
 * one file per topology (bilingual zh / en, print shows the active language): the system-level MTBF / MTTR targets for
 * A_op ≥ 98.5 % at 10k / 100k / 200k / 500k NPUs, decomposed to the six layers (cluster, scale-out, SuperPoD, cabinet, node,
 * NPU), the hardware unit classes and the mechanism parameters, with an overlay figure of the budgets on the hardware hierarchy.
 * Method and formulas (1)–(6): docs/ASCEND_ALLOCATION_METHODOLOGY.html; component counts: docs/ASCEND_BOM_100K.html.
 * Inputs: docs/backup/ascend-allocation/results.json, docs/backup/ascend-allocation/mechanisms.json.
 * Usage: node scripts/build-ascend-allocation-findings.mjs [native950|ubl128|cm384|a3server …]   (no args = all four)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { esc, fmt, tw, wrap, lines, pct, fk, pP, f2, kN, hours, secs, sz, W, svgDyn, svgClose, titleBlock, legend, flow, chip, CHIP_H, pages, pageShell, drawLayer, zoomLines } from './report-kit.mjs';

const R = JSON.parse(readFileSync('docs/backup/ascend-allocation/results.json', 'utf8'));
const MJ = JSON.parse(readFileSync('docs/backup/ascend-allocation/mechanisms.json', 'utf8'));
const DATE = new Date(R.generated).toLocaleDateString('sv-SE');
const SIZES = R.sizes, MAIN = R.main, TARGET = R.target;
const LV = R.layers.map((l) => l.id), LAYER = Object.fromEntries(R.layers.map((l) => [l.id, l]));
const DEPLOY = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.deploy]));
const MLIB = R.mechanismLibrary, REF = new Set(R.reference);
const MNAME = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.name])), MEFF = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.effort])), MORIG = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.origin]));
const UNIT_LAYER = { npu: 'npu', cluster: 'cluster', node: 'node', cabinet: 'cabinet', fabric: 'superpod', 'scale-out': 'scaleout' };
const FILES = { native950: '950', ubl128: 'UBL128', cm384: 'CM384', a3server: 'A3SERVER' };

/** unavailability by layer, points of A_op, derated (formula 3): U_ℓ = 100·C_ℓ / (3600·D), D = 1 + Σ(C + iso + sdc)/3600 */
function uSplit(d) {
  const L = d.layers, D = 1 + LV.reduce((a, l) => a + L[l].cDerated + L[l].isoDerated + L[l].sdcDerated, 0) / 3600;
  const u = Object.fromEntries(LV.map((l) => [l, (100 * L[l].cDerated) / (3600 * D)]));
  u.hard = LV.reduce((a, l) => a + u[l], 0); u.total = 100 * (1 - d.kpiDerated.aOp); u.other = u.total - u.hard;
  if (u.other < -1e-9) throw new Error('negative residual in the layer split');
  return u;
}
const sum = (o, pred) => Object.entries(o).filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0);

function build(arch) {
  const A = R.archs[arch], Z = (n) => A.sizes[String(n)], Z5 = Z(MAIN);
  // the 23-mechanism Shapley study of this architecture (bare scenario, ReMAP-latest parameters; scripts/arch-mechanism-shapley.ts)
  const SJ = JSON.parse(readFileSync(`docs/backup/arch-mechanism-shapley/${arch}.json`, 'utf8'));
  if (JSON.stringify(SJ.sizes) !== JSON.stringify(SIZES) || SJ.players.some((id) => !MNAME[id])) throw new Error(`${arch}: the Shapley study does not match the report's sizes or mechanism set`);
  for (const n of SIZES) { const r = Z(n).recommended; if (r.final.mttr.nom.mttrS && Math.abs(sum(r.final.mttr.nom.contrib, () => true) - r.final.mttr.nom.mttrS) > 1e-6) throw new Error(`MTTR composition does not close (${arch} ${n})`); }

  function body(lang) {
    const T = (zh, en) => (lang === 'zh' ? zh : en);
    const LN = Object.fromEntries(R.layers.map((l) => [l.id, l.name[lang]]));
    const SH = A.short[lang], NAME = A.name[lang];
    const VERD = { supported: T('支持', 'supported'), uncertain: T('不确定', 'uncertain'), below: T('不足', 'below') };
    const LEV = { auto: T('自动尝试 180→60 s', 'automatic attempt 180→60 s'), manual: T('人工 2 h→30 min', 'manual 2 h→30 min'), success: T('自动成功 99→99.9 %', 'automatic success 99→99.9 %') };
    const LEVS = { auto: T('自动 60 s', 'auto 60 s'), manual: T('人工 30 min', 'manual 30 min'), success: T('成功 99.9 %', 'success 99.9 %') };
    const plan = (m, l) => [...m, ...l.map((x) => LEV[x])].join(' + ') || '—';
    const kStr = (k) => (k >= 1 ? T(`上限 × ${fk(k)}`, `ceiling × ${fk(k)}`) : T(`任务 × ${fk(k)}`, `task × ${fk(k)}`));
    const sep = T('；', '; '), colon = T('：', ': ');
    const U0 = Object.fromEntries(SIZES.map((n) => [n, uSplit(Z(n).today)])), U1 = Object.fromEntries(SIZES.map((n) => [n, uSplit(Z(n).recommended.final)]));
    const meets = (n) => Z(n).today.aOpDerated >= TARGET && Z(n).today.window.verdict === 'supported';
    const fitOfLayer = (l, z = Z5) => LAYER[l].units.reduce((a, u) => a + (z.hardFitPerNpu[u] ?? 0), 0);
    const pts = T(' 点', ' pt');

    /* ---------------- key findings ---------------- */
    const t5 = Z5.today, r5 = Z5.recommended, q5 = Z5.required;
    const top2 = (u) => LV.slice().sort((a, b) => u[b] - u[a]).slice(0, 2).map((l) => `${LN[l]} ${f2(u[l])}`).join(T('、', ', '));
    const fitTop = Object.entries(Z5.hardFitPerNpu).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const uTop = r5.final.units.slice().sort((a, b) => b.hardPerHourToday - a.hardPerHourToday)[0];
    const keys = [
      T(`<b>差距</b>：今天 A_op 名义 / 降额 / 逐窗口 P — ${SIZES.map((n) => `${kN(n, lang)} ${pct(Z(n).today.aOp)} / ${pct(Z(n).today.aOpDerated)} / ${pP(Z(n).today.window.pAtLeastTarget)}`).join('；')}。今天已达标：${SIZES.filter(meets).map((n) => kN(n, lang)).join('、') || '无'}。`,
        `<b>Gap</b>: today’s A_op nominal / derated / window P — ${SIZES.map((n) => `${kN(n, lang)} ${pct(Z(n).today.aOp)} / ${pct(Z(n).today.aOpDerated)} / ${pP(Z(n).today.window.pAtLeastTarget)}`).join('; ')}. Meeting the goal today: ${SIZES.filter(meets).map((n) => kN(n, lang)).join(', ') || 'none'}.`),
      T('<b>方案</b>：', '<b>Plan</b>: ') + SIZES.map((n) => { const r = Z(n).recommended; return `${kN(n, lang)}${colon}${esc(plan(r.mechanisms, r.levers))}${sep}${r.k >= 1 ? T(`硬件不变（验收上限 × ${fk(r.k)}）→ 上限处 ${pct(r.final.kpi.aOp)} / ${pct(r.final.kpiDerated.aOp)}，P = ${pP(r.window.pAtLeastTarget)}`, `hardware unchanged (acceptance ceiling × ${fk(r.k)}) → at the ceiling ${pct(r.final.kpi.aOp)} / ${pct(r.final.kpiDerated.aOp)}, P = ${pP(r.window.pAtLeastTarget)}`) : T(`硬件任务 × ${fk(r.k)} → ${pct(r.final.kpi.aOp)} / ${pct(r.final.kpiDerated.aOp)}，P = ${pP(r.window.pAtLeastTarget)}`, `hardware task × ${fk(r.k)} → ${pct(r.final.kpi.aOp)} / ${pct(r.final.kpiDerated.aOp)}, P = ${pP(r.window.pAtLeastTarget)}`)}`; }).join(T('。', '. ')) + T('。', '.'),
      T(`<b>MTBF / MTTR 要求（${kN(MAIN, lang)}卡，降额）</b>：今天 MTBF_hw ${hours(t5.kpiDerated.mtbfHwH, lang)}、MTTR_hw ${secs(t5.kpiDerated.mttrS)}，B = ${fmt(q5.B, 1)} s/h → 在今天的 MTTR 下 MTBF ≥ ${hours(q5.mtbfAtTodayMttrH, lang)}（× ${fk(q5.mtbfFactor)}），或在今天的 MTBF 下 MTTR ≤ ${secs(q5.mttrAtTodayMtbfS)}（× ${fk(q5.mttrFactor)}）；推荐设计落在 MTBF ${hours(r5.final.kpiDerated.mtbfHwH, lang)}、MTTR ${secs(r5.final.kpiDerated.mttrS)}——主要靠 MTTR。`,
        `<b>MTBF / MTTR requirement (${kN(MAIN, lang)}, derated)</b>: today MTBF_hw ${hours(t5.kpiDerated.mtbfHwH, lang)}, MTTR_hw ${secs(t5.kpiDerated.mttrS)}, B = ${fmt(q5.B, 1)} s/h → MTBF ≥ ${hours(q5.mtbfAtTodayMttrH, lang)} at today’s MTTR (× ${fk(q5.mtbfFactor)}) or MTTR ≤ ${secs(q5.mttrAtTodayMtbfS)} at today’s MTBF (× ${fk(q5.mttrFactor)}); the recommended design lands at MTBF ${hours(r5.final.kpiDerated.mtbfHwH, lang)}, MTTR ${secs(r5.final.kpiDerated.mttrS)} — mostly through the MTTR.`),
      T(`<b>分层</b>：${kN(MAIN, lang)}卡 U_ℓ 最大的两层今天为 ${top2(U0[MAIN])}，分配后为 ${top2(U1[MAIN])}（降额，点）；允许的实例 MTBF：超节点 ${hours(r5.final.layers.superpod.mtbfInstanceH, lang)}、计算柜 ${hours(r5.final.layers.cabinet.mtbfInstanceH, lang)}、节点 ${hours(r5.final.layers.node.mtbfInstanceH, lang)}、NPU ${hours(r5.final.layers.npu.mtbfInstanceH, lang)}。`,
        `<b>Layers</b>: at ${kN(MAIN, lang)} the two largest U_ℓ are ${top2(U0[MAIN])} today and ${top2(U1[MAIN])} after allocation (derated, points); allowed MTBF per instance: SuperPoD ${hours(r5.final.layers.superpod.mtbfInstanceH, lang)}, cabinet ${hours(r5.final.layers.cabinet.mtbfInstanceH, lang)}, node ${hours(r5.final.layers.node.mtbfInstanceH, lang)}, NPU ${hours(r5.final.layers.npu.mtbfInstanceH, lang)}.`),
      T(`<b>硬件</b>：硬中断 FIT / NPU 合计 ${fmt(Z5.hardFitPerNpuTotal, 1)}，前三类 ${fitTop.map(([u, v]) => `${u} ${fmt(v, 1)}（${fmt((100 * v) / Z5.hardFitPerNpuTotal)} %）`).join('、')}；${kN(MAIN, lang)}卡时 ${esc(uTop.name.zh)} 每单元 FIT ${fmt(uTop.fitToday, 1)} → 允许 ${fmt(uTop.fitAllowed, 1)}。`,
        `<b>Hardware</b>: hard FIT per NPU ${fmt(Z5.hardFitPerNpuTotal, 1)} in all; the top three are ${fitTop.map(([u, v]) => `${u} ${fmt(v, 1)} (${fmt((100 * v) / Z5.hardFitPerNpuTotal)} %)`).join(', ')}; at ${kN(MAIN, lang)} the ${esc(uTop.name.en)} may have ${fmt(uTop.fitAllowed, 1)} FIT per unit (today ${fmt(uTop.fitToday, 1)}).`),
    ];

    /* ---------------- Figure 1: the overlay ---------------- */
    function figOverlay() {
      const x0 = 14, colW = 150, step = 158, schemH = 110;
      const kList = SIZES.map((n) => `× ${fk(Z(n).recommended.k)}`).join(' / ');
      const head = titleBlock(T(`图 1：${SH} 的硬件层级与分层预算——每层：允许的实例 MTBF、层 MTTR、不可用度预算 Uℓ（降额，百分点），四个规模；k = ${kList}`, `Figure 1: ${SH} hardware hierarchy and layer budgets — per layer: allowed MTBF per instance, layer MTTR and unavailability budget Uℓ (derated, points) at the four sizes; k = ${kList}`));
      const lhH = Math.round(sz(11.5) * 1.3), lhM = Math.round(sz(9.8) * 1.3), lhT = Math.round(sz(8.4) * 1.45);
      const top = 50;
      const hdrs = LV.map((l) => ({ n: wrap(LN[l], colW - 4, sz(11.5) * 1.05), i: wrap(LAYER[l].instance[lang], colW - 4, sz(9.8)) }));
      const hdrH = Math.max(...hdrs.map((h) => h.n.length * lhH + h.i.length * lhM));
      const schemY = top + hdrH - 12;
      let g = svgDyn(`fig-overlay-${lang}`, T(`${SH}：分层预算叠加图`, `${SH}: layer budgets on the hardware`)) + head.svg + `<g transform="translate(0 ${head.dy})">`;
      const sch = LV.map((l, i) => drawLayer(arch, l, x0 + i * step, schemY, colW, schemH, T));
      // budget-card geometry (shared by all columns)
      const fs = sz(8.4), cardY = schemY + schemH + 8;
      const hdr = [T('规模', 'scale'), T('MTBF', 'MTBF'), 'MTTR', 'U_ℓ'];
      const cells = LV.map((l) => SIZES.map((n) => { const L = Z(n).recommended.final.layers[l]; return [kN(n, lang), hours(L.mtbfInstanceH, lang), secs(L.mttrS), f2(U1[n][l]).replace('< ', '<')]; }));
      const cw = [0, 1, 2, 3].map((j) => Math.max(tw(hdr[j], fs), ...cells.flat().map((r) => tw(r[j], fs))));
      const gap = (colW - 10 - cw.reduce((a, b) => a + b, 0)) / 3;
      if (gap < 4) throw new Error(`budget card too narrow (${arch} ${lang}: gap ${gap.toFixed(1)})`);
      const g3 = [0.5, 1.4, 1.1].map((w) => w * gap); // MTBF and MTTR are both right-aligned, so the widest gap goes between them
      const cx = [5, 5 + cw[0] + g3[0] + cw[1], 5 + cw[0] + g3[0] + cw[1] + g3[1] + cw[2], colW - 5]; // col 0 left, others right edges
      const cardH = 8 + 5 * lhT + 2;
      const lever = r5.levers;
      let maxBottom = 0;
      LV.forEach((l, i) => {
        const x = x0 + i * step;
        g += lines(x + 2, top - 6, hdrs[i].n, 'h', lhH) + lines(x + 2, top - 6 + hdrs[i].n.length * lhH, hdrs[i].i, 'm', lhM);
        g += sch[i].svg;
        // the card
        const tipRows = SIZES.map((n, j) => `${cells[i][j][0]}: MTBF ${cells[i][j][1]} · MTTR ${cells[i][j][2]} · U ${cells[i][j][3]}${pts} · λ ${fmt(Z(n).recommended.final.layers[l].lam, 3)}/h`);
        g += `<rect x="${x}" y="${cardY}" width="${colW}" height="${cardH}" rx="6" class="panel" data-tip="${esc(`${LN[l]}|${tipRows.join('|')}`)}"/>`;
        const row = (j, vals, style) => vals.map((v, c) => `<text x="${(x + cx[c]).toFixed(1)}" y="${(cardY + 4 + (j + 1) * lhT - 3).toFixed(1)}" class="tiny"${c ? ' text-anchor="end"' : ''}${style ? ` style="${style}"` : ''} pointer-events="none">${c === 3 && j === 0 ? 'U<tspan dy="2" font-size="85%">ℓ</tspan>' : esc(v)}</text>`).join('');
        g += row(0, hdr, 'font-weight:700;fill:var(--muted)') + `<line x1="${x + 5}" y1="${cardY + 4 + lhT + 1}" x2="${x + colW - 5}" y2="${cardY + 4 + lhT + 1}" class="grid"/>`;
        SIZES.forEach((n, j) => { g += row(j + 1, cells[i][j], n === MAIN ? 'font-weight:700;fill:var(--ink)' : ''); });
        let y = cardY + cardH + 8;
        // mechanisms deployed on this layer at 500k
        const ids = r5.applied.map((m) => m.id).filter((id) => DEPLOY[id] === l);
        const labels = [...ids, ...(l === 'cluster' ? lever.map((x) => LEVS[x]) : [])];
        g += `<text x="${x + 2}" y="${y + 9}" class="m">${esc(T(`${kN(MAIN, lang)}卡部署的机制`, `mechanisms at ${kN(MAIN, lang)}`))}</text>`; y += 14;
        if (!labels.length) { const nl = wrap(T('无（只经集群级恢复链）', 'none (cluster-level chain only)'), colW - 4, sz(9.8)); g += lines(x + 2, y + 11, nl, 's', lhM); y += nl.length * lhM + 4; }
        else {
          const f = flow(labels, x, colW);
          labels.forEach((lab, j) => {
            const p = f.pos[j], cy = y + p.line * f.rowH, id = ids[j];
            const tip = id ? `${id} · ${MLIB[id].name[lang]}|${MLIB[id].change[lang]}` : `${lab}|${T('恢复杠杆（R-CKPT / R-MANUAL）', 'recovery lever (R-CKPT / R-MANUAL)')}`;
            g += chip(p.x, cy, p.w, id ? (REF.has(id) ? 'ub' : 'so') : 'asm', lab, tip);
          });
          y += f.lines * f.rowH + 2;
        }
        const fl = fitOfLayer(l), fitL = [T(`硬 FIT / NPU ${fmt(fl, 1)}`, `hard FIT per NPU ${fmt(fl, 1)}`), T(`占合计 ${fmt((100 * fl) / Z5.hardFitPerNpuTotal, 1)} %`, `${fmt((100 * fl) / Z5.hardFitPerNpuTotal, 1)} % of the total`)];
        g += lines(x + 2, y + 11, fitL, 'm', lhM); y += fitL.length * lhM + 2;
        maxBottom = Math.max(maxBottom, y);
      });
      LV.forEach((l, i) => { if (i < LV.length - 1 && sch[i].zoom && sch[i + 1].outer) g += zoomLines(sch[i].zoom, sch[i + 1].outer); });
      const lg = legend(x0, maxBottom + 16, [{ cls: 'ub', label: T('ReMAP 参考机制（基线）；UB 交换', 'ReMAP reference mechanism (baseline); UB switching') }, { cls: 'so', label: T('新增候选机制；跨超节点网络', 'added candidate mechanism; scale-out network') }, { cls: 'asm', label: T('恢复杠杆', 'recovery lever') }, { cls: 'panel', label: T(`预算卡（推荐设计；${kN(MAIN, lang)}卡行加粗）`, `budget card (recommended design; ${kN(MAIN, lang)} row bold)`) }, { cls: 'zoom', label: T('放大', 'zoom'), line: true }]);
      g += lg.g;
      return svgClose(g, lg.y + 12 + head.dy);
    }

    /* ---------------- Table 1: system-level targets and plans ---------------- */
    const t1rows = SIZES.map((n) => {
      const z = Z(n), t = z.today, r = z.recommended, q = z.required;
      return `<tr><td class="b nw">${kN(n, lang)}</td><td class="num">${hours(t.kpiDerated.mtbfHwH, lang)}</td><td class="num">${secs(t.kpiDerated.mttrS)}</td><td class="num">${pct(t.aOp)}</td><td class="num${t.aOpDerated < TARGET ? ' bad' : ''}">${pct(t.aOpDerated)}</td><td class="num">${pP(t.window.pAtLeastTarget)}</td><td class="num">${fmt(q.B, 1)}</td><td class="num">${hours(q.mtbfAtTodayMttrH, lang)}</td><td class="num">${secs(q.mttrAtTodayMtbfS)}</td><td class="w">${esc(plan(r.mechanisms, r.levers))}${r.escalated ? '<sup>†</sup>' : ''}</td><td class="num${r.k < 1 ? ' b' : ''}">${kStr(r.k)}</td><td class="num">${hours(r.final.kpiDerated.mtbfHwH, lang)}</td><td class="num">${secs(r.final.kpiDerated.mttrS)}</td><td class="num">${pct(r.final.kpi.aOp)}</td><td class="num">${pct(r.final.kpiDerated.aOp)}</td><td class="num">${pP(r.window.pAtLeastTarget)}</td></tr>`;
    }).join('');
    const th = (s, num = true) => `<th${num ? ' class="num"' : ''}>${s}</th>`;
    const table1 = `<div class="table-wrap"><table class="s1"><thead><tr>${th(T('规模', 'Size'), false)}${th(T('今天 MTBF_hw', 'Today MTBF_hw'))}${th(T('今天 MTTR_hw', 'Today MTTR_hw'))}${th(T('今天 A_op 名义', 'Today A_op nominal'))}${th(T('今天 A_op 降额', 'Today A_op derated'))}${th(T('今天 P', 'Today P'))}${th('B (s/h)')}${th(T('今天 MTTR 下需 MTBF', 'MTBF needed at today’s MTTR'))}${th(T('今天 MTBF 下需 MTTR', 'MTTR needed at today’s MTBF'))}${th(T('推荐方案（新增机制 + 杠杆）', 'Recommended plan (added mechanisms + levers)'), false)}${th(T('硬件 k', 'Hardware k'))}${th(T('设计 MTBF_hw', 'Design MTBF_hw'))}${th(T('设计 MTTR_hw', 'Design MTTR_hw'))}${th(T('设计 A_op 名义', 'Design A_op nominal'))}${th(T('设计 A_op 降额', 'Design A_op derated'))}${th(T('设计 P', 'Design P'))}</tr></thead><tbody>${t1rows}</tbody></table></div>`;
    const escal = SIZES.filter((n) => Z(n).recommended.escalated).map((n) => `${kN(n, lang)}${colon}${Z(n).recommended.tried.map((t, j) => `${j ? '→ ' : T('最优方案 ', 'optimal plan ')}${plan(t.mechanisms, t.levers)} (P = ${pP(t.pAtLeastTarget)}, ${VERD[t.verdict]})`).join(' ')}`).join(sep);
    const bindStr = SIZES.map((n) => `${kN(n, lang)} ${Z(n).recommended.binding === 'window' ? T('逐窗口', 'window') : T('降额均值', 'derated mean')}`).join(T('、', ', '));
    const note1 = T(`口径：MTBF_hw = 整个作业两次硬中断之间的集群级间隔 1/Σλ，MTTR_hw = 经机制链按速率加权的平均暂停（公式 1，降额设计）；隔离与静默另计，不加入 λ。B = 每集群·小时允许的硬中断暂停秒数（降额设计，公式 2），两列“需”为 B 的两端。P = 400 个 30 天窗口中 A_op ≥ 98.5 % 的比例（公式 6）。k 按公式 4（ARINC，全部中断类同乘 k）：≥ 1 为验收上限，< 1 为交付任务；约束侧：${bindStr}。设计列 = 推荐设计在 k 处。${escal ? `† 逐窗口校核迫使升级：${esc(escal)}。` : ''}`,
      `口径: MTBF_hw = the cluster-level interval between hard interruptions of the whole job, 1/Σλ; MTTR_hw = the rate-weighted mean pause through the mechanism chain (formula 1, derated design); isolation and silent corruption are counted separately, never in λ. B = allowed hard-interruption pause seconds per cluster-hour (derated design, formula 2); the two “needed” columns are its two ends. P = share of 400 30-day windows with A_op ≥ 98.5 % (formula 6). k per formula 4 (ARINC, every interruption class × k): ≥ 1 an acceptance ceiling, < 1 a delivery task; binding side: ${bindStr}. Design columns = the recommended design at k. ${escal ? `† The window check forced escalation: ${esc(escal)}.` : ''}`);

    /* ---------------- Table 2: layer decomposition at 500k ---------------- */
    const t0 = Z5.today, f0 = r5.final, u0 = U0[MAIN], u1 = U1[MAIN];
    const ar = (a, b, d) => `${fmt(a, d)} → ${fmt(b, d)}`;
    const t2rows = LV.map((l) => { const a = t0.layers[l], b = f0.layers[l]; return `<tr><td class="b">${esc(LN[l])}</td><td class="num">${ar(a.lam, b.lam, 3)}</td><td class="num">${ar(a.mttrS, b.mttrS, 1)}</td><td class="num">${ar(a.mttrDeratedS, b.mttrDeratedS, 1)}</td><td class="num">${ar(a.cDerated, b.cDerated, 2)}</td><td class="num b">${f2(u0[l])} → ${f2(u1[l])}</td><td class="num">${fmt(a.instances)}</td><td class="num">${hours(a.mtbfInstanceH, lang)} → ${hours(b.mtbfInstanceH, lang)}</td></tr>`; }).join('');
    const hardRow = `<tr class="sum"><td class="b">${esc(T('硬中断合计（Σℓ）', 'Hard interruptions (Σℓ)'))}</td><td class="num">${ar(t0.kpi.lamHw, f0.kpi.lamHw, 3)}</td><td class="num">${ar(t0.kpi.mttrS, f0.kpi.mttrS, 1)}</td><td class="num">${ar(t0.kpiDerated.mttrS, f0.kpiDerated.mttrS, 1)}</td><td class="num">${ar(t0.kpiDerated.sumLP, f0.kpiDerated.sumLP, 2)}</td><td class="num b">${f2(u0.hard)} → ${f2(u1.hard)}</td><td class="num">1</td><td class="num">${hours(t0.kpiDerated.mtbfHwH, lang)} → ${hours(f0.kpiDerated.mtbfHwH, lang)}</td></tr>`;
    const OTH = { isolation: T('亚健康隔离', 'Isolation of sub-healthy units'), sdcDetected: T('静默损坏检出', 'Silent corruption detected') };
    const othRows = ['isolation', 'sdcDetected'].map((id) => { const g0 = (k) => k.other.find((o) => o.id === id); const a = g0(t0.kpi), b = g0(f0.kpi), ad = g0(t0.kpiDerated), bd = g0(f0.kpiDerated); return `<tr><td>${esc(OTH[id])}</td><td class="num">${ar(a.ratePerHour, b.ratePerHour, 3)}</td><td class="num">${ar(a.pauseS, b.pauseS, 1)}</td><td class="num">${ar(ad.pauseS, bd.pauseS, 1)}</td><td class="num">${ar(ad.sPerH, bd.sPerH, 2)}</td><td class="num">—</td><td class="num">—</td><td class="num">${hours(ad.mtbfH, lang)} → ${hours(bd.mtbfH, lang)}</td></tr>`; }).join('');
    const table2 = `<div class="table-wrap"><table class="s2"><thead><tr>${th(T('层级 / 事件类', 'Layer / event class'), false)}${th(T('λ（中断 / h）今天 → 设计', 'λ (interruptions/h) today → design'))}${th(T('MTTR_ℓ 名义 (s)', 'MTTR_ℓ nominal (s)'))}${th(T('MTTR_ℓ 降额 (s)', 'MTTR_ℓ derated (s)'))}${th(T('C_ℓ 降额 (s/h)', 'C_ℓ derated (s/h)'))}${th(T('U_ℓ 降额（点）', 'U_ℓ derated (points)'))}${th(T('实例数', 'Instances'))}${th(T('MTBF / 实例 今天 → 允许', 'MTBF per instance today → allowed'))}</tr></thead><tbody>${t2rows}${hardRow}<tr class="sec"><td colspan="8">${esc(T('其他事件类（单独计，不加入硬中断）', 'Other event classes (counted separately, never added to hard interruptions)'))}</td></tr>${othRows}<tr><td>${esc(T('其他事件类的不可用（隔离 + 静默检出 + 漏检 φ）', 'Unavailability of the other classes (isolation + detected + undetected φ)'))}</td><td colspan="4"></td><td class="num b">${f2(u0.other)} → ${f2(u1.other)}</td><td colspan="2"></td></tr><tr class="sum"><td class="b">${esc(T('1 − A_op（降额）', '1 − A_op (derated)'))}</td><td colspan="4"></td><td class="num b">${f2(u0.total)} → ${f2(u1.total)}</td><td colspan="2"></td></tr></tbody></table></div>`;
    const note2 = T(`口径（公式 3）：λ = 该层单元硬中断经检测后的作业中断率（集群·小时）；MTTR_ℓ = 该层中断经机制链的平均暂停；C_ℓ = λ·MTTR_ℓ（降额）；U_ℓ = C_ℓ / (3600·D)，D = 1 + (Σ C + F)/3600，单位为 A_op 的百分点（1 点 ≈ 每小时 36 s）；实例 MTBF = 实例数 / λ（集群级与跨超节点网络为整体间隔）。“设计” = 推荐设计在 k 处；1 − A_op = Σ U_ℓ + 其他事件类，不同事件类只在不可用度（点）上合计。`,
      `口径 (formula 3): λ = the job-interruption rate from the layer’s units after detection (per cluster-hour); MTTR_ℓ = the layer’s mean pause through the mechanism chain; C_ℓ = λ·MTTR_ℓ (derated); U_ℓ = C_ℓ / (3600·D), D = 1 + (Σ C + F)/3600, in points of A_op (1 point ≈ 36 s per hour); MTBF per instance = instances / λ (cluster and scale-out: the whole-system interval). “Design” = the recommended design at k; 1 − A_op = Σ U_ℓ + the other classes — event classes are combined only as unavailability points.`);
    const S3 = SIZES.filter((n) => n !== MAIN);
    const t2b = `<div class="table-wrap"><table class="s2b"><thead><tr>${th(T('U_ℓ 降额（点）今天 → 设计', 'U_ℓ derated (points) today → design'), false)}${S3.map((n) => th(kN(n, lang))).join('')}${th(T('k', 'k'), false)}</tr></thead><tbody>${[...LV, 'other', 'total'].map((l) => `<tr${l === 'total' ? ' class="sum"' : ''}><td>${esc(l === 'other' ? T('其他事件类', 'Other event classes') : l === 'total' ? T('1 − A_op', '1 − A_op') : LN[l])}</td>${S3.map((n) => `<td class="num">${f2(U0[n][l])} → ${f2(U1[n][l])}</td>`).join('')}<td>${l === LV[0] ? esc(S3.map((n) => `${kN(n, lang)} ${kStr(Z(n).recommended.k)}`).join(' · ')) : ''}</td></tr>`).join('')}</tbody></table></div>`;

    /* ---------------- Table 3: hardware units ---------------- */
    const units = r5.final.units.filter((u) => u.count > 0);
    const fitAt = (n, id) => { const u = Z(n).recommended.final.units.find((v) => v.id === id); return u ? u.fitAllowed : NaN; };
    const t3rows = units.map((u) => `<tr><td>${esc(u.name[lang])} <span class="cf">${esc(u.confidence)}</span></td><td>${esc(u.faultUnit)} · ${esc(LN[UNIT_LAYER[u.level]] ?? u.level)}</td><td class="num">${fmt(u.count)}</td><td class="num">${fmt(u.fitToday, 1)}</td>${SIZES.map((n) => `<td class="num${Z(n).recommended.k < 1 ? ' b' : ''}">${Number.isFinite(fitAt(n, u.id)) ? fmt(fitAt(n, u.id), 1) : '—'}</td>`).join('')}<td class="num">${hours(u.mtbfAllowedH, lang)}</td><td class="num">${fmt((100 * u.hardPerHourToday) / t0.kpi.lamHw, 1)} %</td></tr>`).join('');
    const table3 = `<div class="table-wrap"><table class="s3"><thead><tr>${th(T('硬件单元', 'Hardware unit'), false)}${th(T('故障单元 · 层', 'Fault unit · layer'), false)}${th(T(`数量（${kN(MAIN, lang)}）`, `Count (${kN(MAIN, lang)})`))}${th(T('今天 FIT / 单元', 'Today FIT per unit'))}${SIZES.map((n) => th(T(`允许 FIT ${kN(n, lang)}`, `Allowed FIT ${kN(n, lang)}`))).join('')}${th(T(`MTBF / 单元 ${kN(MAIN, lang)}（允许）`, `MTBF per unit ${kN(MAIN, lang)} (allowed)`))}${th(T('占今天集群中断率', 'Share of today’s interruption rate'))}</tr></thead><tbody><tr class="sec"><td colspan="4">${esc(T('硬件系数 k（公式 4）', 'Hardware factor k (formula 4)'))}</td>${SIZES.map((n) => `<td class="num">× ${fk(Z(n).recommended.k)}</td>`).join('')}<td colspan="2"></td></tr>${t3rows}</tbody></table></div>`;
    const note3 = T(`口径：每单元硬中断 FIT（HAC-D 单元口径，跨超节点网络单元为 UB 类比值 @roce，置信度 assumed）；允许 = 今天 × k（ARINC，全部中断类同乘一个系数，公式 4）；粗体 k &lt; 1 为交付任务（要比今天好），其余为验收上限。MTBF / 单元 = 10⁹ / 允许 FIT（h）；占比 = 该单元类今天的中断率 / 今天的集群中断率 Σλ（只计硬中断）。“—”= 该规模没有这类单元（例如层数更少的跨超节点网络）。数量见 ASCEND_BOM_100K。`,
      `口径: hard-interruption FIT per unit (HAC-D per-unit basis; scale-out units are the UB analogue @roce, confidence assumed); allowed = today × k (ARINC, one factor for every interruption class, formula 4); bold (k &lt; 1) is a delivery task that must beat today, the others are acceptance ceilings. MTBF per unit = 10⁹ / allowed FIT (h); share = the unit class’s interruption rate today / today’s cluster interruption rate Σλ (hard interruptions only). “—” = the unit class does not exist at that size (e.g. a scale-out network with fewer tiers). Counts in ASCEND_BOM_100K.`);

    /* ---------------- Table 4: mechanism parameters ---------------- */
    const PK = { success: T('成功', 'success'), successSeconds: T('耗时 s', 'time s'), failureSeconds: T('失败耗时 s', 'fail s'), coverage: T('覆盖', 'coverage'), detectSeconds: T('检测 s', 'detect s'), domains: T('域数', 'domains'), recoverSeconds: T('局部恢复 s', 'recover s'), syncSeconds: T('同步 s', 'sync s'), computeSeconds: T('周期 s', 'period s'), saveSeconds: T('保存 s', 'save s'), stepSeconds: T('重算 s', 'recompute s'), eligibleShare: T('适用份额', 'eligible'), manualProbabilityTarget: T('人工概率', 'P(manual)'), pauseSeconds: T('暂停 s', 'pause s'), startupTargetSeconds: T('启动 s', 'startup s'), compressionRatio: T('压缩比', 'compression'), decompressSeconds: T('解压 s', 'decompress s'), overhead: T('开销', 'overhead') };
    const PCT = new Set(['success', 'coverage', 'eligibleShare', 'manualProbabilityTarget', 'overhead']);
    const pv = (k, v) => (PCT.has(k) ? `${fmt(v * 100, v * 100 < 1 && v > 0 ? 2 : Number.isInteger(Math.round(v * 1000) / 10) ? 0 : 1)} %` : k === 'compressionRatio' ? `× ${fmt(v, 1)}` : fmt(v, Number.isInteger(v) ? 0 : 1));
    const params = (o) => Object.entries(o).filter(([k, v]) => !(k === 'overhead' && v === 0) && !(k === 'failureSeconds' && v === 0)).map(([k, v]) => { const lab = PK[k] ?? k; return lab.endsWith(' s') ? `${lab.slice(0, -2)} ${pv(k, v)} s` : `${lab} ${pv(k, v)}`; }).join(' · ');
    const t4rows = r5.applied.map((m) => { const rm = r5.removal[m.id]; const bl = rm ? LV.filter((l) => Math.abs(rm.byLayer[l]) >= 0.05).map((l) => `${LN[l]} ${fmt(rm.byLayer[l], 2).replace('-', '−')}`).join(' · ') || '< 0.05' : '—'; const gain = rm ? 100 * rm.aOp : NaN; return `<tr><td class="b">${esc(m.id)}</td><td>${esc(LN[DEPLOY[m.id]] ?? DEPLOY[m.id])}</td><td>${REF.has(m.id) ? T('参考', 'reference') : T('新增', 'added')}</td><td class="w">${esc(params(m.nominal))}</td><td class="w">${esc(params(m.derated))}</td><td class="w">${esc(bl)}</td><td class="num${gain <= -0.0005 ? ' bad' : ''}">${Math.abs(gain) < 0.0005 ? '≈ 0' : `${gain > 0 ? '+' : '−'}${fmt(Math.abs(gain), 3)}`}</td></tr>`; }).join('');
    const lvS = (v) => `${T('自动', 'auto')} ${fmt(v.autoSeconds)} s · ${T('成功', 'success')} ${fmt(v.success * 100, 2)} % · ${T('人工', 'manual')} ${secs(v.manualSeconds)}`;
    const table4 = `<div class="table-wrap"><table class="s4"><thead><tr>${th('ID', false)}${th(T('部署层', 'Deployed on'), false)}${th(T('角色', 'Role'), false)}${th(T('名义参数（要求）', 'Nominal parameters (requirement)'), false)}${th(T('降额参数（校核）', 'Derated parameters (check)'), false)}${th(T('去掉的暂停（s/h，按层）', 'Pause removed (s/h, by layer)'), false)}${th(T('A_op 增益（点）', 'A_op gain (points)'))}</tr></thead><tbody>${t4rows}<tr class="sum"><td class="b">${esc(T('恢复参数（杠杆后；成功率含 D-RECOVERY-CLASSIFY）', 'Recovery parameters (after levers; success incl. D-RECOVERY-CLASSIFY)'))}</td><td>${esc(LN.cluster)}</td><td>${esc(r5.levers.map((x) => LEVS[x]).join(' + ') || '—')}</td><td class="w">${esc(lvS(r5.leverValues.nominal))}</td><td class="w">${esc(lvS(r5.leverValues.derated))}</td><td colspan="2"></td></tr></tbody></table></div>`;
    const negs = r5.applied.filter((m) => r5.removal[m.id] && LV.some((l) => r5.removal[m.id].byLayer[l] <= -0.05)).map((m) => m.id);
    const note4 = T(`口径：名义 = 要求，降额 = 校核（覆盖 −5 pt、成功 −8 pt、时间 × 1.5）。去掉的暂停 = 最终设计（${kN(MAIN, lang)}卡、名义）的暂停减去去掉该机制后的设计，按层、每集群·小时的秒数（只计硬中断与静默的暂停；R-SDC 随 D-SDC）；A_op 增益同口径，单位点。负值表示在此口径下该梯级反而增加暂停：${negs.length ? `${negs.join('、')} 在某些层为负（例如 R-REPLAY 排在弹性之前，失败的重执行尝试先付耗时，再落到弹性；D-SDC 单独会增加回滚暂停）` : '本设计没有'}——它们的价值在有效产出或与其他机制的组合上，不在本表的单项差值上。`,
      `口径: nominal = the requirement, derated = the check (coverage −5 pt, success −8 pt, times × 1.5). Pause removed = the final design’s pause (${kN(MAIN, lang)}, nominal) minus the design without this mechanism, by layer, seconds per cluster-hour (hard-interruption and silent-corruption pauses; R-SDC goes with D-SDC); A_op gain on the same basis, in points. Negative values mean the rung costs pause on this basis: ${negs.length ? `${negs.join(', ')} are negative on some layers (e.g. R-REPLAY sits before elastic, so failed replay attempts pay their time before falling through to elastic; D-SDC alone adds rollback pauses)` : 'none in this design'} — their value lies in goodput or in combination with other mechanisms, not in this single-mechanism difference.`);

    /* ---------------- Table 5: MTTR composition ---------------- */
    const ms = [t0.mttr.nom, t0.mttr.der, f0.mttr.nom, f0.mttr.der];
    const customIds = [...new Set(ms.flatMap((m) => Object.keys(m.contrib).filter((k) => k.startsWith('custom:')).map((k) => k.slice(7))))];
    const comp = [
      [T('检测', 'Detection'), (m) => m.contrib.detect],
      [T(`透明梯级（${customIds.join('、') || '无'}）`, `Transparent rungs (${customIds.join(', ') || 'none'})`), (m) => sum(m.contrib, (k) => k.startsWith('custom:'))],
      [T('重执行 R-REPLAY', 'Replay R-REPLAY'), (m) => m.contrib.replay], [T('弹性 R-ELASTIC', 'Elastic R-ELASTIC'), (m) => m.contrib.elastic], [T('进程 R-PROCESS', 'Process R-PROCESS'), (m) => m.contrib.process],
      [T('失败梯级耗时（Σ failed:*）', 'Failed-rung time (Σ failed:*)'), (m) => sum(m.contrib, (k) => k.startsWith('failed:'))],
      [T('自动恢复：启动', 'Automatic: startup'), (m) => m.stages.startup], [T('自动恢复：读检查点', 'Automatic: checkpoint read'), (m) => m.stages.read], [T('自动恢复：通信重建', 'Automatic: communication rebuild'), (m) => m.stages.communication],
      [T('人工兜底份额', 'Manual fallback share'), (m) => m.stages.manual],
    ];
    const t5rows = comp.map(([nm, f]) => `<tr><td>${esc(nm)}</td>${ms.map((m) => `<td class="num">${fmt(f(m), 2)}</td>`).join('')}</tr>`).join('') + `<tr class="sum"><td class="b">MTTR_hw</td>${ms.map((m) => `<td class="num b">${fmt(m.mttrS, 2)}</td>`).join('')}</tr>`;
    const PR = [[T('重执行', 'replay'), (p) => p.replay], [T('透明梯级', 'transparent rung'), (p) => sum(p, (k) => k.startsWith('custom:'))], [T('弹性', 'elastic'), (p) => p.elastic], [T('进程', 'process'), (p) => p.process], [T('全局恢复', 'global'), (p) => p.global]];
    const t5end = `<tr class="sec"><td>${esc(T('中断在哪里结束（名义，%）', 'Where interruptions end (nominal, %)'))}</td><td colspan="2">${esc(T('今天', 'today'))}</td><td colspan="2">${esc(T('设计', 'design'))}</td></tr>` + PR.map(([nm, f]) => `<tr><td>${esc(nm)}</td><td class="num" colspan="2">${fmt(100 * (f(t0.mttr.nom.probs) ?? 0), 1)}</td><td class="num" colspan="2">${fmt(100 * (f(f0.mttr.nom.probs) ?? 0), 1)}</td></tr>`).join('');
    const table5 = `<div class="table-wrap"><table class="s5"><thead><tr>${th(T('构成（s / 中断，按速率加权）', 'Component (s per interruption, rate-weighted)'), false)}${th(T('今天 名义', 'Today nominal'))}${th(T('今天 降额', 'Today derated'))}${th(T('设计 名义', 'Design nominal'))}${th(T('设计 降额', 'Design derated'))}</tr></thead><tbody>${t5rows}${t5end}</tbody></table></div>`;
    const note5 = T(`口径（公式 5）：每次硬中断的平均暂停按各梯级的结束概率与耗时分解，合计 = MTTR_hw（公式 1）；自动恢复按阶段（启动、读检查点、通信重建）拆分，人工兜底 = 自动失败份额 × 人工时间；透明梯级 = 不回滚的局部恢复（R-LINK-LOCAL、H-CONTROL-CONTINUITY，若有 R-FABRIC-DEGRADE）；设计中没有启动 / 读取阶段的机制时，三个自动恢复阶段等分自动尝试时间。只计硬中断。`,
      `口径 (formula 5): the mean pause per hard interruption split by the rungs’ end probabilities and times; the total = MTTR_hw (formula 1); the automatic recovery split by stage (startup, checkpoint read, communication rebuild), the manual fallback = the automatic failure share × the manual time; transparent rungs = local recovery without rollback (R-LINK-LOCAL, H-CONTROL-CONTINUITY, R-FABRIC-DEGRADE if present); without a startup- or read-stage mechanism in the design the three automatic stages are equal thirds of the attempt. Hard interruptions only.`);

    /* ---------------- Table 6: checks ---------------- */
    const wl = (w) => `${pP(w.pAtLeastTarget)} [${fmt(100 * w.wilson[0], 1)}–${fmt(100 * w.wilson[1], 1)}] ${VERD[w.verdict]}`;
    const t6rows = SIZES.map((n) => { const z = Z(n), o = z.optimal, r = z.recommended; return `<tr><td class="b nw">${kN(n, lang)}</td><td class="num">${wl(z.today.window)}</td><td class="w">${esc(plan(o.mechanisms, o.levers))}</td><td class="num">${o.verification ? wl(o.verification) : '—'}</td><td class="num">× ${fk(r.kPlan)} · ${wl(r.windowPlan)}</td><td class="num">× ${fk(r.k)} · ${wl(r.window)}</td><td class="nw">${r.binding === 'window' ? T('逐窗口', 'window') : T('降额均值', 'derated mean')}</td><td class="num">${r.tried.length - 1}</td><td class="num">${fmt(r.effort.total, 1)}</td></tr>`; }).join('');
    const table6 = `<div class="table-wrap"><table class="s6"><thead><tr>${th(T('规模', 'Size'), false)}${th(T('今天 P [Wilson]', 'Today P [Wilson]'))}${th(T('最优方案', 'Optimal plan'), false)}${th(T('最优方案 P', 'Optimal plan P'))}${th(T('推荐：kPlan 处 P', 'Recommended: P at kPlan'))}${th(T('推荐：k 处 P', 'Recommended: P at k'))}${th(T('约束', 'Binding'), false)}${th(T('升级步数', 'Escalation steps'))}${th(T('努力合计', 'Effort total'))}</tr></thead><tbody>${t6rows}</tbody></table></div>`;
    const note6 = T(`口径（公式 6）：P = ${R.trials} 个 30 天窗口（名义参数、种子 1）中 A_op ≥ 98.5 % 的比例，括号为 Wilson 95 % 区间（%）；下界 ≥ 90 % 为“支持”。kPlan = 方案本身的硬件系数（不动时为 1），k = 同时满足降额均值与逐窗口的系数；努力 = 机制 + 杠杆 + 硬件（每减半 2，公式 4）。`,
      `口径 (formula 6): P = share of ${R.trials} 30-day windows (nominal parameters, seed 1) with A_op ≥ 98.5 %, brackets = Wilson 95 % interval (%); supported when the lower bound ≥ 90 %. kPlan = the plan’s own hardware factor (1 when unchanged), k = the factor meeting both the derated mean and the window check; effort = mechanisms + levers + hardware (2 per halving, formula 4).`);

    /* ---------------- Table 7: Shapley contribution of the 23 mechanisms by scale (heat-map table) ---------------- */
    const gains = (n) => SJ.perSize[String(n)].gains;
    const rows7 = SJ.players.map((id) => { const vals = SIZES.map((n) => 100 * gains(n).find((g) => g.id === id).aOp.shapley); return { id, vals, mean: vals.reduce((a, b) => a + b, 0) / vals.length }; }).sort((a, b) => b.mean - a.mean);
    const vmax = Math.max(...rows7.flatMap((r) => r.vals));
    const inDesign = (n, id) => REF.has(id) || Z(n).recommended.mechanisms.includes(id);
    const hm = (v, boxed) => { const a = v > 0.005 ? 0.12 + 0.83 * Math.min(1, v / vmax) : 0; return `<td class="hm${boxed ? ' box' : ''}"${a ? ` style="background:rgba(47,79,184,${a.toFixed(2)})${a > 0.6 ? ';color:#fff' : ''}"` : ''}>${v < 0 ? '−' : '+'}${fmt(Math.abs(v), 2)}</td>`; };
    const t7rows = rows7.map((r) => `<tr><td><span class="tag">${MORIG[r.id] === 'original' ? 'R' : T('新', 'new')}</span><b>${esc(r.id)}</b> <span class="nm">${esc(MNAME[r.id][lang])}</span></td>${r.vals.map((v, j) => hm(v, inDesign(SIZES[j], r.id))).join('')}<td class="num">${MEFF[r.id]}</td></tr>`).join('');
    const sum7 = SIZES.map((n, j) => rows7.reduce((a, r) => a + r.vals[j], 0));
    const t7sum = `<tr class="sum"><td class="b">${esc(T('23 项合计（= 全部启用 − 全部关闭）', 'Sum of the 23 (= all on − all off)'))}</td>${sum7.map((v) => `<td class="hm b">${v < 0 ? '−' : '+'}${fmt(Math.abs(v), 2)}</td>`).join('')}<td></td></tr>`;
    const table7 = `<div class="table-wrap"><table class="s7"><thead><tr>${th(T('机制（R = ReMAP 原有，新 = 新增；按平均贡献排序）', 'Mechanism (R = ReMAP original, new = extension; sorted by mean contribution)'), false)}${SIZES.map((n) => `<th class="hm">${kN(n, lang)}</th>`).join('')}${th(T('工作量', 'Effort'))}</tr></thead><tbody>${t7rows}${t7sum}</tbody></table></div>`;
    const halfMax = SIZES.map((n) => `${kN(n, lang)} ±${fmt(100 * Math.max(...gains(n).map((g) => g.halfWidth)), 2)}`).join(T('、', ', '));
    const allOn = SIZES.map((n) => `${kN(n, lang)} ${pct(SJ.perSize[String(n)].allOn)} / ${pct(SJ.perSize[String(n)].allOnDerated)}`).join(T('、', ', '));
    const note7 = T(`口径：23 项（ReMAP 8 项原有 + 15 项新增；I-CONTAIN 不可单独应用）在裸架构场景（不加任何机制，HAC-D 单元口径 FIT，ReMAP 最新参数）上同时参与时对 A_op 的 Shapley 贡献，百分点，${SJ.permutations} 次置换抽样，95 % 半宽最大 ${halfMax}；贡献可加，合计 = 全部启用 − 全部关闭。带框 = 本报告该规模的推荐设计所含（六个参考机制在每个设计的基线中，新增候选见表 1）。全部 23 项启用时 A_op 名义 / 降额：${allOn}——只靠机制在 ${kN(MAIN, lang)}卡达不到 98.5 %，所以推荐设计还用恢复杠杆与硬件系数 k。静默检测类（D-SDC-FP8 / FP4、D-ABFT、D-NET-SDC）对 A_op 为零或略负，其价值在有效产出（方法 §4）。`,
      `口径: Shapley contribution to A_op of the 23 mechanisms (ReMAP’s 8 original + 15 extensions; I-CONTAIN cannot be applied alone) all playing together on the bare architecture scenario (no mechanism applied, HAC-D per-unit FIT, ReMAP-latest parameters), in points, ${SJ.permutations} sampled permutations, largest 95 % half-width ${halfMax}; contributions are additive, the sum = all on − all off. Boxed = in this report’s recommended design at that scale (the six reference mechanisms are in every design’s baseline; the added candidates per Table 1). A_op with all 23 on, nominal / derated: ${allOn} — mechanisms alone do not reach 98.5 % at ${kN(MAIN, lang)}, hence the recovery levers and the hardware factor k of the recommended design. The silent-corruption detectors (D-SDC-FP8 / FP4, D-ABFT, D-NET-SDC) are zero or slightly negative on A_op; their value is in goodput (Methodology §4).`);

    const geo = T(`几何（${kN(MAIN, lang)}卡）：${fmt(Z5.instances.superpod)} 个超节点 / UB 域、${fmt(Z5.instances.cabinet)} 个计算柜、${fmt(Z5.instances.node)} 个节点、跨超节点 ${Z5.counts.scaleOutTiers} 层 ${fmt(Z5.counts.scaleOutSwitches)} 台交换机`, `Geometry (${kN(MAIN, lang)}): ${fmt(Z5.instances.superpod)} SuperPoDs / UB domains, ${fmt(Z5.instances.cabinet)} compute cabinets, ${fmt(Z5.instances.node)} nodes, scale-out ${Z5.counts.scaleOutTiers} tiers of ${fmt(Z5.counts.scaleOutSwitches)} switches`);
    const sub = T(`<b>目标</b>：一个同步作业 30 天窗口 A_op ≥ 98.5 %，名义、降额与逐窗口都要满足。<b>口径</b>：HAC-D 单元 FIT（拓扑模板上的单元故障库；跨超节点单元为 @roce 类比值，assumed）。<b>机制</b>：基线含 ReMAP 六个参考机制，另有七个 A_op 候选与三个恢复杠杆（方法 §4）。${geo}。假设：${esc(A.assumed.join('; '))}。`,
      `<b>Goal</b>: A_op ≥ 98.5 % over a 30-day window for one synchronous job, nominal, derated and per window. <b>Basis</b>: HAC-D per-unit FIT (unit fault library on the topology template; scale-out units the @roce analogue, assumed). <b>Mechanisms</b>: the six ReMAP reference mechanisms in the baseline, plus the seven A_op candidates and three recovery levers (Methodology §4). ${geo}. Assumptions: ${esc(A.assumed.join('; '))}.`);

    const sections = [
      `<h1>${esc(T(`${NAME}：可用度目标的 MTBF / MTTR 分层预算，1 万–50 万卡`, `${NAME}: hierarchical MTBF / MTTR budgets for the availability goal, 10k–500k NPUs`))}</h1>
  <p class="sub">${sub}</p>
  <div class="callout"><ul>${keys.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <figure class="chart"><div class="scroll">${figOverlay()}</div></figure>
  <h3>${esc(T('表 1：系统级目标与方案', 'Table 1: System-level targets and plans'))}</h3>
  ${table1}
  <p class="note">${note1}</p>`,
      `<h3 class="first">${esc(T(`表 2：分层分解（${kN(MAIN, lang)}卡）`, `Table 2: Layer decomposition (${kN(MAIN, lang)})`))}</h3>
  ${table2}
  <p class="note">${note2}</p>
  <h3>${esc(T('表 2b：其他规模的层预算', 'Table 2b: Layer budgets at the other sizes'))}</h3>
  ${t2b}
  <h3>${esc(T('表 3：硬件单元：允许的 FIT 与 MTBF', 'Table 3: Hardware units: allowed FIT and MTBF'))}</h3>
  ${table3}
  <p class="note">${note3}</p>`,
      `<h3 class="first">${esc(T(`表 4：机制参数（${kN(MAIN, lang)}卡推荐设计）`, `Table 4: Mechanism parameters (recommended design at ${kN(MAIN, lang)})`))}</h3>
  ${table4}
  <p class="note">${note4}</p>
  <h3>${esc(T(`表 5：MTTR 构成（${kN(MAIN, lang)}卡）`, `Table 5: MTTR composition (${kN(MAIN, lang)})`))}</h3>
  ${table5}
  <p class="note">${note5}</p>`,
      `<h3 class="first">${esc(T('表 6：校核', 'Table 6: Checks'))}</h3>
  ${table6}
  <p class="note">${note6}</p>
  <h3>${esc(T('表 7：原有 + 新增共 23 项同时参与时各机制对 A_op 的 Shapley 贡献（百分点）；带框 = 该规模推荐设计所含', 'Table 7: Shapley contribution of the 23 mechanisms (original + extensions, all playing together) to A_op (points); boxed = in the recommended design at that scale'))}</h3>
  ${table7}
  <p class="note">${note7}</p>
  <footer>${T(`数据：<code>docs/backup/ascend-allocation/results.json</code>、<code>mechanisms.json</code>（${DATE}）。复现：<code>node --import tsx scripts/ascend-allocation-data.ts</code> → <code>node scripts/build-ascend-allocation-findings.mjs</code>。方法与公式 (1)–(6)：ASCEND_ALLOCATION_METHODOLOGY.html；元件数量：ASCEND_BOM_100K.html。数字已用 Python 独立重算（层合计、A_op 闭合、k 的闭式解、MTTR 构成），误差 ≤ 1e-9。`,
        `Data: <code>docs/backup/ascend-allocation/results.json</code>, <code>mechanisms.json</code> (${DATE}). Reproduce: <code>node --import tsx scripts/ascend-allocation-data.ts</code> → <code>node scripts/build-ascend-allocation-findings.mjs</code>. Method and formulas (1)–(6): ASCEND_ALLOCATION_METHODOLOGY.html; component counts: ASCEND_BOM_100K.html. Numbers re-derived independently in Python (layer sums, A_op closure, k closed form, MTTR composition) to within 1e-9.`)}</footer>`,
    ];
    const subs = (h) => h.split(/(<svg[\s\S]*?<\/svg>)/).map((p, i) => (i % 2 ? p : p.replace(/\b(MTBF|MTTR|A|U|C)_(hw|op|ℓ)/g, '$1<sub>$2</sub>'))).join('');
    return pages(sections.map(subs), (i, n) => T(`HAC-D · 昇腾可用度分配 · ${SH} · ${DATE} · 第 ${i} / ${n} 页`, `HAC-D · Ascend availability allocation · ${SH} · ${DATE} · page ${i} / ${n}`));
  }

  const extraCss = `
  table.s1 td.w { min-width: 12em; } table.s4 td.w { min-width: 13em; } table.s4 td:nth-child(6) { min-width: 11em; } table.s3 td:first-child { min-width: 12em; } table.s2 td:first-child { min-width: 11em; }
  table.s6 td.w { min-width: 14em; } table.s2b td:last-child { min-width: 14em; } table.s5 td:first-child { min-width: 16em; } table.s5 { width: auto; min-width: 62%; }
  span.cf { font-size: 0.82em; color: var(--muted); margin-left: 3px; } sub { font-size: 0.75em; line-height: 0; }
  table.s7 { print-color-adjust: exact; -webkit-print-color-adjust: exact; } table.s7 td.hm, table.s7 th.hm { text-align: center; font-variant-numeric: tabular-nums; min-width: 5.5em; } table.s7 td.box { box-shadow: inset 0 0 0 2px var(--ink); }
  table.s7 td:first-child { min-width: 19em; } table.s7 span.nm { color: var(--muted); font-size: 0.92em; margin-left: 3px; } table.s7 span.tag { margin: 0 4px 0 0; }
  @media print { table.s1 { font-size: 6.8px; } table.s2, table.s2b, table.s3 { font-size: 7.4px; } table.s4, table.s5, table.s6 { font-size: 7.3px; } table.s7 { font-size: 7.1px; } table.s7 td.box { box-shadow: inset 0 0 0 1.5px var(--ink); } }`;
  const html = pageShell({
    title: `${A.short.zh} 可用度分配结果 · ${A.short.en} allocation findings`,
    description: `${A.name.zh}：A_op ≥ 98.5 % 在 1 万–50 万卡上的 MTBF / MTTR 分层预算。${A.name.en}: hierarchical MTBF / MTTR budgets for A_op ≥ 98.5 % at 10k–500k NPUs.`,
    zhBody: body('zh'), enBody: body('en'), extraCss,
  });
  for (const bad of ['undefined', 'NaN', '>null<', ' null ']) if (html.replace(/<style>[\s\S]*?<\/style>/g, '').includes(bad)) throw new Error(`${arch}: output contains "${bad}"`);
  const out = `docs/ASCEND_ALLOCATION_FINDINGS_${FILES[arch]}.html`;
  writeFileSync(out, html);
  return `${out} (${(html.length / 1024).toFixed(0)} kB)`;
}

const want = process.argv.slice(2);
for (const arch of want.length ? want : Object.keys(FILES)) { if (!R.archs[arch]) throw new Error(`unknown arch ${arch}`); console.log('written', build(arch)); }
