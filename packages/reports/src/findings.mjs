/**
 * Findings recipe of the Ascend allocation report set — docs/ASCEND_ALLOCATION_FINDINGS_{950,UBL128,CM384,A3SERVER}.html, one file
 * per topology (bilingual zh / en, print shows the active language): the system-level MTBF / MTTR targets for A_op ≥ A* at
 * 10k / 100k / 200k / 500k NPUs, decomposed to the six layers (cluster, scale-out, SuperPoD, cabinet, node, NPU), the hardware unit
 * classes, the mechanism parameters and the mechanism set with its Shapley values by scale (one table, formerly Table 7 here and
 * Table 2 of the Methodology), with an overlay figure of the budgets on the hardware hierarchy. 2026-10-25: Tables 2b (layer budgets at
 * the other sizes) and 6 (window-rule internals) removed on the user's decision.
 * Pure function of its data: `results` = docs/backup/ascend-allocation/results.json, `mechanisms` = …/mechanisms.json, `shapley` =
 * docs/backup/arch-mechanism-shapley/<arch>.json (all parsed). No file access; the date comes from `results.generated`.
 * v5 (hacd CLI): optional `record` (the topology record with its superpod resolved) draws the overlay schematic through
 * `topoGeomFromRecord` instead of the built-in TOPO_GEOM entry; optional `provenance` replaces the footer's data / reproduce
 * sentence with the hacd command, record / set / override ids, run options and engine version. Sizes, the main scale, the window
 * count and the scale range come from `results`; with the v4.4 data the output is byte-identical to the committed reports.
 * Relocated from scripts/build-ascend-allocation-findings.mjs (v5 T10), which is now a thin wrapper that reads and writes the files.
 */
import { esc, fmt, tw, wrap, lines, pct, fk, pP, f2, kN, hours, secs, sz, W, svgDyn, svgClose, titleBlock, legend, flow, chip, CHIP_H, pages, pageShell, drawLayer, zoomLines, topoGeomFromRecord, provenanceFooter, countWord } from './kit.mjs';

const UNIT_LAYER = { npu: 'npu', cluster: 'cluster', node: 'node', cabinet: 'cabinet', fabric: 'superpod', 'scale-out': 'scaleout' };
/** architecture id → file suffix of docs/ASCEND_ALLOCATION_FINDINGS_<suffix>.html */
export const FINDINGS_FILES = { native950: '950', ubl128: 'UBL128', cm384: 'CM384', a3server: 'A3SERVER' };

const sum = (o, pred) => Object.entries(o).filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0);

/**
 * The Findings page of one architecture as an HTML string; throws on an unknown architecture and on inconsistent data (Shapley
 * study vs. the report's sizes / mechanism set, MTTR composition, layer split residual, undefined / NaN / null in the output).
 */
export function findingsHtml(arch, { results, mechanisms, shapley, record, provenance }) {
  const R = results, MJ = mechanisms;
  if (!R.archs[arch]) throw new Error(`unknown arch ${arch}`);
  const DATE = new Date(R.generated).toLocaleDateString('sv-SE');
  const SIZES = R.sizes, MAIN = R.main, TARGET = R.target;
  const TGT = `${fmt(TARGET * 100, 1)} %`;
  // the mechanism set behind Table 7: players of the study, ReMAP originals / extensions, capabilities (not appliable alone)
  const NP = shapley.players.length, NO = shapley.players.filter((id) => (MJ.mechanisms.find((m) => m.id === id) ?? {}).origin === 'original').length, NE = NP - NO;
  const CAPS = MJ.mechanisms.filter((m) => !m.appliable).map((m) => m.id);
  // the scale range of the titles and the number of sizes of Figure 1 (v4.4: 1 万–50 万 / 10k–500k, four sizes)
  const S0 = Math.min(...SIZES), S1 = Math.max(...SIZES);
  const RANGE = S0 === S1 ? { zh: kN(S0, 'zh'), en: kN(S0, 'en') } : { zh: `${kN(S0, 'zh')}–${kN(S1, 'zh')}`, en: `${kN(S0, 'en')}–${kN(S1, 'en')}` };
  const NS = SIZES.length === 4 ? { zh: '四个规模', en: 'the four sizes' } : SIZES.length === 1 ? { zh: '一个规模', en: 'one size' } : { zh: `${SIZES.length} 个规模`, en: `the ${SIZES.length} sizes` };
  const LV = R.layers.map((l) => l.id), LAYER = Object.fromEntries(R.layers.map((l) => [l.id, l]));
  const DEPLOY = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.deploy]));
  const MLIB = R.mechanismLibrary, REF = new Set(R.reference);
  const MNAME = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.name])), MEFF = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.effort])), MORIG = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.origin]));
  // the set's hierarchy attributes and verdicts (mechanisms.json; identical for every architecture) for Table 6
  const MACTS = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.acts ?? []])), MCHG = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.changes])), MVERD = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.verdict])), MREASON = Object.fromEntries(MJ.mechanisms.map((m) => [m.id, m.reason]));
  const VERDICTS = ['reference', 'candidate', 'goodput', 'pruned', 'capability'];
  if (MJ.mechanisms.some((m) => !VERDICTS.includes(m.verdict))) throw new Error(`${arch}: mechanism with an unknown verdict`);

  /** unavailability by layer, points of A_op, derated (formula 3): U_ℓ = 100·C_ℓ / (3600·D), D = 1 + Σ(C + iso + sdc)/3600 */
  function uSplit(d) {
    const L = d.layers, D = 1 + LV.reduce((a, l) => a + L[l].cDerated + L[l].isoDerated + L[l].sdcDerated, 0) / 3600;
    const u = Object.fromEntries(LV.map((l) => [l, (100 * L[l].cDerated) / (3600 * D)]));
    u.hard = LV.reduce((a, l) => a + u[l], 0); u.total = 100 * (1 - d.kpiDerated.aOp); u.other = u.total - u.hard;
    if (u.other < -1e-9) throw new Error('negative residual in the layer split');
    return u;
  }

  const A = R.archs[arch], Z = (n) => A.sizes[String(n)], Z5 = Z(MAIN);
  // the 23-mechanism Shapley study of this architecture (bare scenario, ReMAP-latest parameters; scripts/arch-mechanism-shapley.ts)
  const SJ = shapley;
  const GEOM = record ? topoGeomFromRecord(record, Z5.counts) : arch;
  // the Python re-derivation sentence of the footer holds for the four v4.4 architectures, whose numbers it checked
  const V44 = arch in FINDINGS_FILES;
  if (record && record.id !== arch) throw new Error(`record '${record.id}' given for architecture '${arch}'`);
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
    const fitOfLayer = (l, z = Z5) => LAYER[l].units.reduce((a, u) => a + (z.hardFitPerNpu[u] ?? 0), 0);
    const pts = T(' 点', ' pt');

    /* ---------------- key findings ---------------- */
    const t5 = Z5.today, r5 = Z5.recommended, q5 = Z5.required;
    // which side moves the design (v4.4: always the MTTR): the larger of the MTTR reduction and the MTBF gain against today
    const gMttr = t5.kpiDerated.mttrS / r5.final.kpiDerated.mttrS, gMtbf = r5.final.kpiDerated.mtbfHwH / t5.kpiDerated.mtbfHwH;
    const VIA = gMttr >= gMtbf && gMttr > 1 + 1e-9 ? { zh: '主要靠 MTTR', en: 'mostly through the MTTR' } : gMtbf > 1 + 1e-9 ? { zh: '主要靠 MTBF', en: 'mostly through the MTBF' } : { zh: '今天的设计已满足目标，MTBF 只是验收上限', en: 'today’s design already meets the goal, the MTBF is an acceptance ceiling' };
    // the one conclusion of the page (user's decision 2026-10-25): the MTBF / MTTR requirement; the former gap / plan / layer / hardware
    // bullets live in the notes of Tables 1, 2 and 3, where their numbers are
    const conclusion = T(`<b>结论（MTBF / MTTR 要求，${kN(MAIN, lang)}卡，降额）</b>：今天 MTBF_hw ${hours(t5.kpiDerated.mtbfHwH, lang)}、MTTR_hw ${secs(t5.kpiDerated.mttrS)}，B = ${fmt(q5.B, 1)} s/h → 在今天的 MTTR 下 MTBF ≥ ${hours(q5.mtbfAtTodayMttrH, lang)}（× ${fk(q5.mtbfFactor)}），或在今天的 MTBF 下 MTTR ≤ ${secs(q5.mttrAtTodayMtbfS)}（× ${fk(q5.mttrFactor)}）；推荐设计落在 MTBF ${hours(r5.final.kpiDerated.mtbfHwH, lang)}、MTTR ${secs(r5.final.kpiDerated.mttrS)}——${VIA.zh}。`,
      `<b>Conclusion (MTBF / MTTR requirement at ${kN(MAIN, lang)}, derated)</b>: today MTBF_hw ${hours(t5.kpiDerated.mtbfHwH, lang)}, MTTR_hw ${secs(t5.kpiDerated.mttrS)}, B = ${fmt(q5.B, 1)} s/h → MTBF ≥ ${hours(q5.mtbfAtTodayMttrH, lang)} at today’s MTTR (× ${fk(q5.mtbfFactor)}) or MTTR ≤ ${secs(q5.mttrAtTodayMtbfS)} at today’s MTBF (× ${fk(q5.mttrFactor)}); the recommended design lands at MTBF ${hours(r5.final.kpiDerated.mtbfHwH, lang)}, MTTR ${secs(r5.final.kpiDerated.mttrS)} — ${VIA.en}.`);

    /* ---------------- Figure 1: the overlay ---------------- */
    function figOverlay() {
      const x0 = 14, colW = 150, step = 158, schemH = 110;
      const kList = SIZES.map((n) => `× ${fk(Z(n).recommended.k)}`).join(' / ');
      const head = titleBlock(T(`图 1：${SH} 的硬件层级与分层预算——每层：允许的实例 MTBF、层 MTTR、不可用度预算 Uℓ（降额，百分点），${NS.zh}；k = ${kList}`, `Figure 1: ${SH} hardware hierarchy and layer budgets — per layer: allowed MTBF per instance, layer MTTR and unavailability budget Uℓ (derated, points) at ${NS.en}; k = ${kList}`));
      const lhH = Math.round(sz(11.5) * 1.3), lhM = Math.round(sz(9.8) * 1.3), lhT = Math.round(sz(8.4) * 1.45);
      const top = 50;
      const hdrs = LV.map((l) => ({ n: wrap(LN[l], colW - 4, sz(11.5) * 1.05), i: wrap(LAYER[l].instance[lang], colW - 4, sz(9.8)) }));
      const hdrH = Math.max(...hdrs.map((h) => h.n.length * lhH + h.i.length * lhM));
      const schemY = top + hdrH - 12;
      let g = svgDyn(`fig-overlay-${lang}`, T(`${SH}：分层预算叠加图`, `${SH}: layer budgets on the hardware`)) + head.svg + `<g transform="translate(0 ${head.dy})">`;
      const sch = LV.map((l, i) => drawLayer(GEOM, l, x0 + i * step, schemY, colW, schemH, T));
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
    const DR = R.derate;
    const note1 = T(`口径：MTBF_hw = 整个作业硬中断的集群级间隔 1/Σλ，MTTR_hw = 经机制链按速率加权的平均暂停（公式 1，降额设计；隔离与静默另计）；B = 每集群·小时允许的硬中断暂停秒数（公式 2）；P = ${R.trials} 个 30 天窗口中 A_op ≥ ${TGT} 的比例（公式 6）；k = 所有中断类同乘的硬件系数（公式 4：≥ 1 为验收上限，< 1 为交付任务）。${escal ? `† 逐窗口校核迫使升级：${esc(escal)}。` : ''}`,
      `口径: MTBF_hw = the cluster-level interval between hard interruptions of the whole job, 1/Σλ, and MTTR_hw = the rate-weighted mean pause through the mechanism chain (formula 1, derated design; isolation and silent corruption counted apart); B = the hard-interruption pause allowed per cluster-hour (formula 2); P = the share of ${R.trials} 30-day windows with A_op ≥ ${TGT} (formula 6); k = the uniform hardware factor on every interruption class (formula 4: ≥ 1 an acceptance ceiling, < 1 a delivery task).${escal ? ` † The window check forced escalation: ${esc(escal)}.` : ''}`);

    /* ---------------- Table 2: layer decomposition at 500k ---------------- */
    const t0 = Z5.today, f0 = r5.final, u0 = U0[MAIN], u1 = U1[MAIN];
    const ar = (a, b, d) => `${fmt(a, d)} → ${fmt(b, d)}`;
    const t2rows = LV.map((l) => { const a = t0.layers[l], b = f0.layers[l]; return `<tr><td class="b">${esc(LN[l])}</td><td class="num">${ar(a.lam, b.lam, 3)}</td><td class="num">${ar(a.mttrS, b.mttrS, 1)}</td><td class="num">${ar(a.mttrDeratedS, b.mttrDeratedS, 1)}</td><td class="num">${ar(a.cDerated, b.cDerated, 2)}</td><td class="num b">${f2(u0[l])} → ${f2(u1[l])}</td><td class="num">${fmt(a.instances)}</td><td class="num">${hours(a.mtbfInstanceH, lang)} → ${hours(b.mtbfInstanceH, lang)}</td></tr>`; }).join('');
    const hardRow = `<tr class="sum"><td class="b">${esc(T('硬中断合计（Σℓ）', 'Hard interruptions (Σℓ)'))}</td><td class="num">${ar(t0.kpi.lamHw, f0.kpi.lamHw, 3)}</td><td class="num">${ar(t0.kpi.mttrS, f0.kpi.mttrS, 1)}</td><td class="num">${ar(t0.kpiDerated.mttrS, f0.kpiDerated.mttrS, 1)}</td><td class="num">${ar(t0.kpiDerated.sumLP, f0.kpiDerated.sumLP, 2)}</td><td class="num b">${f2(u0.hard)} → ${f2(u1.hard)}</td><td class="num">1</td><td class="num">${hours(t0.kpiDerated.mtbfHwH, lang)} → ${hours(f0.kpiDerated.mtbfHwH, lang)}</td></tr>`;
    const OTH = { isolation: T('亚健康隔离', 'Isolation of sub-healthy units'), sdcDetected: T('静默损坏检出', 'Silent corruption detected') };
    const othRows = ['isolation', 'sdcDetected'].map((id) => { const g0 = (k) => k.other.find((o) => o.id === id); const a = g0(t0.kpi), b = g0(f0.kpi), ad = g0(t0.kpiDerated), bd = g0(f0.kpiDerated); return `<tr><td>${esc(OTH[id])}</td><td class="num">${ar(a.ratePerHour, b.ratePerHour, 3)}</td><td class="num">${ar(a.pauseS, b.pauseS, 1)}</td><td class="num">${ar(ad.pauseS, bd.pauseS, 1)}</td><td class="num">${ar(ad.sPerH, bd.sPerH, 2)}</td><td class="num">—</td><td class="num">—</td><td class="num">${hours(ad.mtbfH, lang)} → ${hours(bd.mtbfH, lang)}</td></tr>`; }).join('');
    const table2 = `<div class="table-wrap"><table class="s2"><thead><tr>${th(T('层级 / 事件类', 'Layer / event class'), false)}${th(T('λ（中断 / h）今天 → 设计', 'λ (interruptions/h) today → design'))}${th(T('MTTR_ℓ 名义 (s)', 'MTTR_ℓ nominal (s)'))}${th(T('MTTR_ℓ 降额 (s)', 'MTTR_ℓ derated (s)'))}${th(T('C_ℓ 降额 (s/h)', 'C_ℓ derated (s/h)'))}${th(T('U_ℓ 降额（点）', 'U_ℓ derated (points)'))}${th(T('实例数', 'Instances'))}${th(T('MTBF / 实例 今天 → 允许', 'MTBF per instance today → allowed'))}</tr></thead><tbody>${t2rows}${hardRow}<tr class="sec"><td colspan="8">${esc(T('其他事件类（单独计，不加入硬中断）', 'Other event classes (counted separately, never added to hard interruptions)'))}</td></tr>${othRows}<tr><td>${esc(T('其他事件类的不可用（隔离 + 静默检出 + 漏检 φ）', 'Unavailability of the other classes (isolation + detected + undetected φ)'))}</td><td colspan="4"></td><td class="num b">${f2(u0.other)} → ${f2(u1.other)}</td><td colspan="2"></td></tr><tr class="sum"><td class="b">${esc(T('1 − A_op（降额）', '1 − A_op (derated)'))}</td><td colspan="4"></td><td class="num b">${f2(u0.total)} → ${f2(u1.total)}</td><td colspan="2"></td></tr></tbody></table></div>`;
    const note2 = T(`口径（公式 3）：λ = 该层单元硬中断经检测后的作业中断率（集群·小时），MTTR_ℓ = 该层中断经机制链的平均暂停，C_ℓ = λ·MTTR_ℓ（降额），U_ℓ = C_ℓ / (3600·D)（A_op 的百分点，1 点 ≈ 每小时 36 s），实例 MTBF = 实例数 / λ；“设计” = 推荐设计在 k 处，不同事件类只在不可用度（点）上合计。`,
      `口径 (formula 3): λ = the job-interruption rate from the layer’s units after detection (per cluster-hour), MTTR_ℓ = the layer’s mean pause through the mechanism chain, C_ℓ = λ·MTTR_ℓ (derated), U_ℓ = C_ℓ / (3600·D) (points of A_op, 1 point ≈ 36 s per hour), MTBF per instance = instances / λ; “design” = the recommended design at k, and event classes are combined only as unavailability points.`);

    /* ---------------- Table 3: hardware units ---------------- */
    const units = r5.final.units.filter((u) => u.count > 0);
    const fitAt = (n, id) => { const u = Z(n).recommended.final.units.find((v) => v.id === id); return u ? u.fitAllowed : NaN; };
    // v5 the FIT's own confidence where a failure-rate override replaced the library value (UnitBudgetRow.fitProvenance)
    const fitTag = (u) => (u.fitProvenance?.length ? ` <span class="cf fit" title="${esc(u.fitProvenance.map((f) => `${f.id}: ${fmt(f.fit, 1)} FIT, ${f.confidence} — ${f.source}`).join(' | '))}">FIT ${esc([...new Set(u.fitProvenance.map((f) => f.confidence))].join(' / '))}</span>` : '');
    const anyFitTag = units.some((u) => u.fitProvenance?.length);
    const t3rows = units.map((u) => `<tr><td>${esc(u.name[lang])} <span class="cf">${esc(u.confidence)}</span>${fitTag(u)}</td><td>${esc(u.faultUnit)} · ${esc(LN[UNIT_LAYER[u.level]] ?? u.level)}</td><td class="num">${fmt(u.count)}</td><td class="num">${fmt(u.fitToday, 1)}</td>${SIZES.map((n) => `<td class="num${Z(n).recommended.k < 1 ? ' b' : ''}">${Number.isFinite(fitAt(n, u.id)) ? fmt(fitAt(n, u.id), 1) : '—'}</td>`).join('')}<td class="num">${hours(u.mtbfAllowedH, lang)}</td><td class="num">${fmt((100 * u.hardPerHourToday) / t0.kpi.lamHw, 1)} %</td></tr>`).join('');
    const table3 = `<div class="table-wrap"><table class="s3"><thead><tr>${th(T('硬件单元', 'Hardware unit'), false)}${th(T('故障单元 · 层', 'Fault unit · layer'), false)}${th(T(`数量（${kN(MAIN, lang)}）`, `Count (${kN(MAIN, lang)})`))}${th(T('今天 FIT / 单元', 'Today FIT per unit'))}${SIZES.map((n) => th(T(`允许 FIT ${kN(n, lang)}`, `Allowed FIT ${kN(n, lang)}`))).join('')}${th(T(`MTBF / 单元 ${kN(MAIN, lang)}（允许）`, `MTBF per unit ${kN(MAIN, lang)} (allowed)`))}${th(T('占今天集群中断率', 'Share of today’s interruption rate'))}</tr></thead><tbody><tr class="sec"><td colspan="4">${esc(T('硬件系数 k（公式 4）', 'Hardware factor k (formula 4)'))}</td>${SIZES.map((n) => `<td class="num">× ${fk(Z(n).recommended.k)}</td>`).join('')}<td colspan="2"></td></tr>${t3rows}</tbody></table></div>`;
    const note3 = T(`口径：每单元硬中断 FIT（HAC-D 单元口径；跨超节点单元为 UB 类比值 @roce，assumed），允许 = 今天 × k（ARINC，公式 4；粗体 k < 1 为交付任务，其余为验收上限），MTBF / 单元 = 10⁹ / 允许 FIT，占比 = 该单元类今天的中断率 / 集群中断率 Σλ（只计硬中断）${anyFitTag ? '，“FIT …”标签 = 失效率覆盖文件给出的 FIT 置信度' : ''}；“—” = 该规模没有这类单元，数量与几何假设见 ASCEND_BOM_100K。`,
      `口径: hard-interruption FIT per unit (HAC-D per-unit basis; scale-out units the UB analogue @roce, assumed), allowed = today × k (ARINC, formula 4; bold k < 1 a delivery task, the others acceptance ceilings), MTBF per unit = 10⁹ / allowed FIT, share = the unit class’s interruption rate today / the cluster rate Σλ (hard interruptions only)${anyFitTag ? ', a “FIT …” tag = the FIT confidence of the failure-rate override' : ''}; “—” = no such unit at that size, counts and geometry assumptions in ASCEND_BOM_100K.`);

    /* ---------------- Table 4: mechanism parameters ---------------- */
    const PK = { success: T('成功', 'success'), successSeconds: T('耗时 s', 'time s'), failureSeconds: T('失败耗时 s', 'fail s'), coverage: T('覆盖', 'coverage'), detectSeconds: T('检测 s', 'detect s'), domains: T('域数', 'domains'), recoverSeconds: T('局部恢复 s', 'recover s'), syncSeconds: T('同步 s', 'sync s'), computeSeconds: T('周期 s', 'period s'), saveSeconds: T('保存 s', 'save s'), stepSeconds: T('重算 s', 'recompute s'), eligibleShare: T('适用份额', 'eligible'), manualProbabilityTarget: T('人工概率', 'P(manual)'), pauseSeconds: T('暂停 s', 'pause s'), startupTargetSeconds: T('启动 s', 'startup s'), compressionRatio: T('压缩比', 'compression'), decompressSeconds: T('解压 s', 'decompress s'), overhead: T('开销', 'overhead') };
    const PCT = new Set(['success', 'coverage', 'eligibleShare', 'manualProbabilityTarget', 'overhead']);
    const pv = (k, v) => (PCT.has(k) ? `${fmt(v * 100, v * 100 < 1 && v > 0 ? 2 : Number.isInteger(Math.round(v * 1000) / 10) ? 0 : 1)} %` : k === 'compressionRatio' ? `× ${fmt(v, 1)}` : fmt(v, Number.isInteger(v) ? 0 : 1));
    const params = (o) => Object.entries(o).filter(([k, v]) => !(k === 'overhead' && v === 0) && !(k === 'failureSeconds' && v === 0)).map(([k, v]) => { const lab = PK[k] ?? k; return lab.endsWith(' s') ? `${lab.slice(0, -2)} ${pv(k, v)} s` : `${lab} ${pv(k, v)}`; }).join(' · ');
    const t4rows = r5.applied.map((m) => { const rm = r5.removal[m.id]; const bl = rm ? LV.filter((l) => Math.abs(rm.byLayer[l]) >= 0.05).map((l) => `${LN[l]} ${fmt(rm.byLayer[l], 2).replace('-', '−')}`).join(' · ') || '< 0.05' : '—'; const gain = rm ? 100 * rm.aOp : NaN; return `<tr><td class="b">${esc(m.id)}</td><td>${esc(LN[DEPLOY[m.id]] ?? DEPLOY[m.id])}</td><td>${REF.has(m.id) ? T('参考', 'reference') : T('新增', 'added')}</td><td class="w">${esc(params(m.nominal))}</td><td class="w">${esc(params(m.derated))}</td><td class="w">${esc(bl)}</td><td class="num${gain <= -0.0005 ? ' bad' : ''}">${Math.abs(gain) < 0.0005 ? '≈ 0' : `${gain > 0 ? '+' : '−'}${fmt(Math.abs(gain), 3)}`}</td></tr>`; }).join('');
    const lvS = (v) => `${T('自动', 'auto')} ${fmt(v.autoSeconds)} s · ${T('成功', 'success')} ${fmt(v.success * 100, 2)} % · ${T('人工', 'manual')} ${secs(v.manualSeconds)}`;
    const table4 = `<div class="table-wrap"><table class="s4"><thead><tr>${th('ID', false)}${th(T('部署层', 'Deployed on'), false)}${th(T('角色', 'Role'), false)}${th(T('名义参数（要求）', 'Nominal parameters (requirement)'), false)}${th(T('降额参数（校核）', 'Derated parameters (check)'), false)}${th(T('去掉的暂停（s/h，按层）', 'Pause removed (s/h, by layer)'), false)}${th(T('A_op 增益（点）', 'A_op gain (points)'))}</tr></thead><tbody>${t4rows}<tr class="sum"><td class="b">${esc(T('恢复参数（杠杆后；成功率含 D-RECOVERY-CLASSIFY）', 'Recovery parameters (after levers; success incl. D-RECOVERY-CLASSIFY)'))}</td><td>${esc(LN.cluster)}</td><td>${esc(r5.levers.map((x) => LEVS[x]).join(' + ') || '—')}</td><td class="w">${esc(lvS(r5.leverValues.nominal))}</td><td class="w">${esc(lvS(r5.leverValues.derated))}</td><td colspan="2"></td></tr></tbody></table></div>`;
    const note4 = T(`口径：名义 = 要求，降额 = 校核（覆盖 −${fmt(DR.coverageDelta * 100, 0)} pt、成功 −${fmt(DR.successDelta * 100, 0)} pt、时间 ×${DR.timeFactor}）；去掉的暂停 = ${kN(MAIN, lang)}卡最终设计（名义）的暂停减去去掉该机制后的设计，按层、每集群·小时秒数（只计硬中断与静默的暂停，R-SDC 随 D-SDC），A_op 增益同口径（负值 = 该梯级在此口径下反而增加暂停，其价值在有效产出或与其他机制的组合）。`,
      `口径: nominal = the requirement, derated = the check (coverage −${fmt(DR.coverageDelta * 100, 0)} pt, success −${fmt(DR.successDelta * 100, 0)} pt, times ×${DR.timeFactor}); pause removed = the final design’s pause at ${kN(MAIN, lang)} (nominal) minus the design without this mechanism, by layer, seconds per cluster-hour (hard-interruption and silent-corruption pauses, R-SDC with D-SDC), and the A_op gain on the same basis (a negative value = the rung costs pause on this basis, its value lying in goodput or in combination).`);

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
    const note5 = T(`口径（公式 5）：每次硬中断的平均暂停按各梯级的结束概率与耗时分解，合计 = MTTR_hw（公式 1）；自动恢复按启动 / 读检查点 / 通信重建三阶段拆分，人工兜底 = 自动失败份额 × 人工时间，透明梯级 = 不回滚的局部恢复；只计硬中断。`,
      `口径 (formula 5): the mean pause per hard interruption split by the rungs’ end probabilities and times, the total = MTTR_hw (formula 1); the automatic recovery is split into startup / checkpoint read / communication rebuild, the manual fallback = the automatic failure share × the manual time, transparent rungs = local recovery without rollback; hard interruptions only.`);

    /* ---------------- Table 6: the mechanism set — hierarchy, verdict and Shapley contribution by scale (heat-map table) ---------------- */
    // one table for what used to be Table 7 here and Table 2 of the Methodology: the set's attributes and verdicts (mechanisms.json)
    // with this architecture's sampled Shapley values per scale (the arch study); a capability (not a player) shows no values
    const gains = (n) => SJ.perSize[String(n)].gains;
    const gainOf = (n, id) => gains(n).find((g) => g.id === id);
    const VG = { reference: T('ReMAP 参考集（原样保留）', 'ReMAP reference set (kept as is)'), candidate: T('A_op 候选（进入分配）', 'A_op candidates (enter the allocation)'), goodput: T('只保有效产出（保留，不参与 A_op 分配）', 'goodput-only (kept, outside the A_op allocation)'), pruned: T('剪除', 'pruned'), capability: T('能力（不可单独应用）', 'capability (not appliable on its own)') };
    const VN = { reference: T('参考', 'reference'), candidate: T('候选', 'candidate'), goodput: T('只保有效产出', 'goodput-only'), pruned: T('剪除', 'pruned'), capability: T('能力', 'capability') };
    const LS = { cluster: T('集群', 'cluster'), scaleout: T('跨超节点', 'scale-out'), superpod: T('超节点', 'SuperPoD'), cabinet: T('柜', 'cabinet'), node: T('节点', 'node'), npu: 'NPU' };
    const rows6 = MJ.mechanisms.map((m) => { const player = SJ.players.includes(m.id); const vals = player ? SIZES.map((n) => 100 * gainOf(n, m.id).aOp.shapley) : null; const dv = player ? 100 * (gainOf(MAIN, m.id).delivered?.shapley ?? 0) : null; return { id: m.id, verdict: MVERD[m.id], vals, dv, mean: vals ? vals.reduce((a, b) => a + b, 0) / vals.length : -Infinity }; });
    const vmax = Math.max(...rows6.flatMap((r) => r.vals ?? []));
    const inDesign = (n, id) => REF.has(id) || Z(n).recommended.mechanisms.includes(id);
    const hm = (v, boxed) => { const a = v > 0.005 ? 0.12 + 0.83 * Math.min(1, v / vmax) : 0; return `<td class="hm${boxed ? ' box' : ''}"${a ? ` style="background:rgba(47,79,184,${a.toFixed(2)})${a > 0.6 ? ';color:#fff' : ''}"` : ''}>${v < 0 ? '−' : '+'}${fmt(Math.abs(v), 2)}</td>`; };
    const spt = (v) => `${v < 0 ? '−' : '+'}${fmt(Math.abs(v), 2)}`;
    const COLS = 5 + SIZES.length + 2;
    const t6rows = VERDICTS.map((v) => { const rs = rows6.filter((r) => r.verdict === v).sort((a, b) => b.mean - a.mean); return rs.length ? `<tr class="sec"><td colspan="${COLS}">${esc(`${VG[v]} · ${rs.length}`)}</td></tr>` + rs.map((r) => `<tr><td><span class="tag">${MORIG[r.id] === 'original' ? 'R' : T('新', 'new')}</span><b>${esc(r.id)}</b> <span class="nm">${esc(MNAME[r.id][lang])}</span></td><td class="nw">${esc(LS[DEPLOY[r.id]] ?? LN[DEPLOY[r.id]] ?? DEPLOY[r.id])}</td><td>${esc(MACTS[r.id].map((a) => LS[a] ?? LN[a] ?? a).join(' · '))}</td><td class="w">${esc(MCHG[r.id]?.[lang] ?? '')}</td><td class="num">${MEFF[r.id]}</td>${r.vals ? r.vals.map((x, j) => hm(x, inDesign(SIZES[j], r.id))).join('') : SIZES.map(() => '<td class="hm">—</td>').join('')}<td class="num">${r.dv === null ? '—' : spt(r.dv)}</td><td class="w">${esc(MREASON[r.id]?.[lang] ?? '')}</td></tr>`).join('') : ''; }).join('');
    const sum6 = SIZES.map((n, j) => rows6.reduce((a, r) => a + (r.vals ? r.vals[j] : 0), 0));
    const t6sum = `<tr class="sum"><td class="b" colspan="5">${esc(T(`${NP} 项合计（= 全部启用 − 全部关闭）`, `Sum of the ${NP} (= all on − all off)`))}</td>${sum6.map((v) => `<td class="hm b">${spt(v)}</td>`).join('')}<td colspan="2"></td></tr>`;
    const t6all = `<tr class="sum"><td class="b" colspan="5">${esc(T(`全部 ${NP} 项启用时 A_op 名义 / 降额（%，目标 ${TGT}）`, `A_op with all ${NP} on, nominal / derated (%, target ${TGT})`))}</td>${SIZES.map((n) => { const z = SJ.perSize[String(n)]; return `<td class="hm b${z.allOnDerated < TARGET ? ' bad' : ''}"><span class="nw">${fmt(100 * z.allOn, 2)} /</span><br><span class="nw">${fmt(100 * z.allOnDerated, 2)}</span></td>`; }).join('')}<td colspan="2"></td></tr>`;
    const table6 = `<div class="table-wrap"><table class="s6"><thead><tr>${th(T('机制（R = ReMAP 原有，新 = 新增）', 'Mechanism (R = ReMAP original, new = extension)'), false)}${th(T('部署层', 'Deployed on'), false)}${th(T('作用层', 'Acts on'), false)}${th(T('所改变的量', 'Quantity changed'), false)}${th(T('努力', 'Effort'))}${SIZES.map((n) => `<th class="hm">A_op ${kN(n, lang)}</th>`).join('')}${th(T(`有效产出 ${kN(MAIN, lang)}`, `Goodput ${kN(MAIN, lang)}`))}${th(T('结论与理由', 'Verdict and reason'), false)}</tr></thead><tbody>${t6rows}${t6sum}${t6all}</tbody></table></div>`;
    const note6 = T(`口径：${NP} 项在裸架构场景（不加任何机制，HAC-D 单元 FIT，ReMAP 最新参数）上同时参与时对 A_op 与有效产出的 Shapley 贡献（百分点，${SJ.permutations} 次置换抽样，可加），结论与理由来自机制集记录 ${MJ.source.set}（规则见方法 §4）。`,
      `口径: Shapley contributions of the ${NP} mechanisms to A_op and delivered goodput, all playing together on the bare architecture scenario (no mechanism applied, HAC-D per-unit FIT, latest ReMAP parameters), in points, ${SJ.permutations} sampled permutations, additive; verdicts and reasons are the mechanism-set record ${MJ.source.set} (rule in Methodology §4).`);

    const sub = T(`<b>目标</b>：一个同步作业 30 天窗口 A_op ≥ ${TGT}，名义、降额与逐窗口都要满足。<b>要点</b>：HAC-D 单元 FIT 口径；基线含 ReMAP ${countWord(R.reference.length, 'zh')}参考机制，另有${countWord(R.candidates.length, 'zh')} A_op 候选与${countWord(R.levers.length, 'zh')}恢复杠杆（方法 §4）；几何与假设见表 3 注。`,
      `<b>Goal</b>: A_op ≥ ${TGT} over a 30-day window for one synchronous job, nominal, derated and per window. <b>Key points</b>: HAC-D per-unit FIT; the ${countWord(R.reference.length, 'en')} ReMAP reference mechanisms in the baseline, plus ${countWord(R.candidates.length, 'en')} A_op candidates and ${countWord(R.levers.length, 'en')} recovery levers (Methodology §4); geometry and assumptions in the note of Table 3.`);

    const sections = [
      `<h1>${esc(T(`${NAME}：可用度目标的 MTBF / MTTR 分层预算，${RANGE.zh}卡`, `${NAME}: hierarchical MTBF / MTTR budgets for the availability goal, ${RANGE.en} NPUs`))}</h1>
  <p class="sub">${sub}</p>
  <div class="callout">${conclusion}</div>
  <figure class="chart"><div class="scroll">${figOverlay()}</div></figure>
  <h3>${esc(T('表 1：系统级目标与方案', 'Table 1: System-level targets and plans'))}</h3>
  ${table1}
  <p class="note">${note1}</p>`,
      `<h3 class="first">${esc(T(`表 2：分层分解（${kN(MAIN, lang)}卡）`, `Table 2: Layer decomposition (${kN(MAIN, lang)})`))}</h3>
  ${table2}
  <p class="note">${note2}</p>
  <h3>${esc(T('表 3：硬件单元：允许的 FIT 与 MTBF', 'Table 3: Hardware units: allowed FIT and MTBF'))}</h3>
  ${table3}
  <p class="note">${note3}</p>`,
      `<h3 class="first">${esc(T(`表 4：机制参数（${kN(MAIN, lang)}卡推荐设计）`, `Table 4: Mechanism parameters (recommended design at ${kN(MAIN, lang)})`))}</h3>
  ${table4}
  <p class="note">${note4}</p>
  <h3>${esc(T(`表 5：MTTR 构成（${kN(MAIN, lang)}卡）`, `Table 5: MTTR composition (${kN(MAIN, lang)})`))}</h3>
  ${table5}
  <p class="note">${note5}</p>`,
      `<h3 class="first">${esc(T('表 6：机制集——分层、取舍与各规模对 A_op 的 Shapley 贡献（百分点）；带框 = 该规模推荐设计所含', 'Table 6: The mechanism set — hierarchy, verdict and Shapley contribution to A_op by scale (points); boxed = in the recommended design at that scale'))}</h3>
  ${table6}
  <p class="note">${note6}</p>
  <footer>${T(`${provenance ? provenanceFooter(provenance, lang, ['results.json', 'mechanisms.json', `${arch}.json`], DATE) : `数据：<code>docs/backup/ascend-allocation/results.json</code>、<code>mechanisms.json</code>（${DATE}）。复现：<code>node --import tsx scripts/ascend-allocation-data.ts</code> → <code>node scripts/build-ascend-allocation-findings.mjs</code>。`}方法与公式 (1)–(6)：ASCEND_ALLOCATION_METHODOLOGY.html；元件数量：ASCEND_BOM_100K.html。${V44 ? '数字已用 Python 独立重算（层合计、A_op 闭合、k 的闭式解、MTTR 构成），误差 ≤ 1e-9。' : '本记录的数字未单独重算；所用原语由 Python 独立计算的金标准向量与 v4.4 复现测试固定（packages/core/test）。'}`,
        `${provenance ? provenanceFooter(provenance, lang, ['results.json', 'mechanisms.json', `${arch}.json`], DATE) : 'Data: <code>docs/backup/ascend-allocation/results.json</code>, <code>mechanisms.json</code> (' + DATE + '). Reproduce: <code>node --import tsx scripts/ascend-allocation-data.ts</code> → <code>node scripts/build-ascend-allocation-findings.mjs</code>. '}Method and formulas (1)–(6): ASCEND_ALLOCATION_METHODOLOGY.html; component counts: ASCEND_BOM_100K.html. ${V44 ? 'Numbers re-derived independently in Python (layer sums, A_op closure, k closed form, MTTR composition) to within 1e-9.' : 'The numbers of this record were not re-derived separately; the primitives they use are pinned by golden vectors computed independently in Python and by the v4.4 reproduction tests (packages/core/test).'}`)}</footer>`,
    ];
    const subs = (h) => h.split(/(<svg[\s\S]*?<\/svg>)/).map((p, i) => (i % 2 ? p : p.replace(/\b(MTBF|MTTR|A|U|C)_(hw|op|ℓ)/g, '$1<sub>$2</sub>'))).join('');
    return pages(sections.map(subs), (i, n) => T(`HAC-D · 昇腾可用度分配 · ${SH} · ${DATE} · 第 ${i} / ${n} 页`, `HAC-D · Ascend availability allocation · ${SH} · ${DATE} · page ${i} / ${n}`));
  }

  const extraCss = `
  /* 2026-10-25 one size larger on screen (the print sizes stay): body 13 → 14 px, tables 11.6 → 12.6 px, notes 11.3 → 12.3 px */
  body { font-size: 14px; } main { max-width: 1200px; } .sub { font-size: 13.5px; } h1 { font-size: 23px; } h2 { font-size: 17px; } h3 { font-size: 14.5px; }
  table { font-size: 12.6px; } th { font-size: 12.2px; } tr.sec td { font-size: 12px; } td.src { font-size: 11.8px; } .callout { font-size: 13.4px; } .note, figcaption, footer { font-size: 12.3px; } code, .f { font-size: 12.5px; } span.cf { font-size: 0.85em; }
  table.s1 td.w { min-width: 12em; } table.s4 td.w { min-width: 13em; } table.s4 td:nth-child(6) { min-width: 11em; } table.s3 td:first-child { min-width: 12em; } table.s2 td:first-child { min-width: 11em; }
  table.s5 td:first-child { min-width: 16em; } table.s5 { width: auto; min-width: 62%; }
  span.cf { font-size: 0.82em; color: var(--muted); margin-left: 3px; } sub { font-size: 0.75em; line-height: 0; }
  table.s6 { print-color-adjust: exact; -webkit-print-color-adjust: exact; } table.s6 td.hm, table.s6 th.hm { text-align: center; font-variant-numeric: tabular-nums; min-width: 4.1em; } table.s6 td.box { box-shadow: inset 0 0 0 2px var(--ink); }
  table.s6 td:first-child { min-width: 13em; } table.s6 td:nth-child(2) { white-space: nowrap; } table.s6 td:nth-child(3) { min-width: 8em; } table.s6 td:nth-child(4) { min-width: 10em; } table.s6 td:last-child { min-width: 11em; } html[data-lang="en"] table.s6 td:nth-child(3) { min-width: 8.5em; } html[data-lang="en"] table.s6 td:first-child { min-width: 12.5em; } html[data-lang="en"] table.s6 td:last-child { min-width: 10.5em; } table.s6 span.nm { color: var(--muted); font-size: 0.92em; margin-left: 3px; } table.s6 span.nw { white-space: nowrap; } table.s6 span.tag { margin: 0 4px 0 0; }
  @media print { table.s1 { font-size: 6.8px; } table.s2, table.s3 { font-size: 7.4px; } table.s4, table.s5 { font-size: 7.3px; } table.s6 { font-size: 6.3px; } table.s6 td.box { box-shadow: inset 0 0 0 1.5px var(--ink); } }`;
  const html = pageShell({
    title: `${A.short.zh} 可用度分配结果 · ${A.short.en} allocation findings`,
    description: `${A.name.zh}：A_op ≥ ${TGT} 在 ${RANGE.zh}卡上的 MTBF / MTTR 分层预算。${A.name.en}: hierarchical MTBF / MTTR budgets for A_op ≥ ${TGT} at ${RANGE.en} NPUs.`,
    zhBody: body('zh'), enBody: body('en'), extraCss,
  });
  for (const bad of ['undefined', 'NaN', '>null<', ' null ']) if (html.replace(/<style>[\s\S]*?<\/style>/g, '').includes(bad)) throw new Error(`${arch}: output contains "${bad}"`);
  return html;
}
