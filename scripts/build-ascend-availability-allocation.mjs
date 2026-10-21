#!/usr/bin/env node
/**
 * Build docs/ASCEND_AVAILABILITY_ALLOCATION.html — one bilingual page (zh default, EN toggle; print shows the active language) that
 * summarises how the availability goal (A_op ≥ 98.5 %, nominal, derated and per 30-day window) is allocated at 10k / 100k / 200k /
 * 500k NPUs on three topologies (native Atlas 950 SuperPoD, SuperPoD Flex / UBL128, Atlas 900 A3 SuperPoD / CloudMatrix384): the
 * allocation method, the layer allocation and the detailed result, replacing the allocation parts of the earlier reports.
 * Inputs: docs/a950-level-allocation/results.json (ReMAP per-card FIT, ReMAP's six reference mechanisms, HAC-D methods; per-card
 * results do not depend on the topology) and docs/allocation-summary/results.json (instance sizes of the three topologies and the
 * sensitivity on HAC-D's per-unit FIT). Formulas are LaTeX rendered at build time with KaTeX (fonts embedded, so the file stays
 * self-contained); figures are inline SVG.
 * Usage: node scripts/build-ascend-availability-allocation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import katex from 'katex';
import { esc, fmt, tw, svgOpen, titleBlock, legend, wrap, lines, textBlock } from './ascend950-figures.mjs';

const R = JSON.parse(readFileSync('docs/a950-level-allocation/results.json', 'utf8'));
const S = JSON.parse(readFileSync('docs/allocation-summary/results.json', 'utf8'));
const BASE_CSS = readFileSync('scripts/build-ascend950-scaling.mjs', 'utf8').match(/const css = `([\s\S]*?)`;\n/)[1];
const DATE = new Date(R.generated).toLocaleDateString('sv-SE');
const SIZES = R.sizes, MAIN = R.main;
const LV = R.levels.map((l) => l.id);
const TOPO = ['native950', 'ubl128', 'cm384'];
const P = (n) => R.perSize[String(n)];
const Z5 = P(MAIN);
const lvl = Object.fromEntries(R.levels.map((l) => [l.id, l]));
const MECH = Object.fromEntries(R.mechanisms.map((m) => [m.id, m]));
const LEVER = Object.fromEntries(R.levers.map((l) => [l.id, l]));
const hardFit = (d) => R.events.find((e) => e.domainId === d && e.type === 'hard')?.fit ?? 0;
const fitCard = (l) => lvl[l].domains.reduce((a, d) => a + hardFit(d), 0);
const FIT_OF = (type) => R.events.filter((e) => e.type === type).reduce((a, e) => a + e.fit, 0);
const kOf = (n) => P(n).recommended.k;
/** ① hardware alone: the ARINC factor (null when today already meets the goal) */
const x1 = (n) => { const h = P(n).p1.arinc.hardware; return h.needed ? Math.min(...h.rows.map((r) => r.factor)) : null; };
const pct = (x, d = 2) => `${(x * 100).toFixed(d)} %`;
const fk = (k) => fmt(k, k >= 10 ? 1 : k >= 1 ? 2 : 3);
const pP = (p) => `${fmt(p * 100, p === 0 || p === 1 ? 0 : 1)} %`;
const f2 = (v) => (v < 0.005 ? '< 0.01' : fmt(v, 2));
/** unavailability by layer, percentage points of A_op: U_ℓ = C_ℓ / (3600·D), D = 1 + (Σ C + F)/3600; other = (1 − A_op) − Σ U_ℓ */
function uSplit(levels, aOp) {
  const D = 1 + LV.reduce((a, l) => a + levels[l].c + levels[l].iso + levels[l].sdc, 0) / 3600;
  const u = Object.fromEntries(LV.map((l) => [l, (100 * levels[l].c) / (3600 * D)]));
  const total = 100 * (1 - aOp);
  return { ...u, other: total - LV.reduce((a, l) => a + u[l], 0), total };
}
const uToday = (n) => uSplit(P(n).today.levelsDerated, P(n).today.aOpDerated);
const uAlloc = (n) => uSplit(P(n).recommended.atLimit.levelsDerated, P(n).recommended.atLimit.aOpDerated);
const uLevers = () => uSplit(Z5.p3.decomposition.leversDerated, Z5.p3.decomposition.kpiLevers.aOpDerated);
for (const n of SIZES) { const a = uAlloc(n), t = uToday(n); if (a.other < 0 || t.other < 0) throw new Error(`negative residual at ${n}`); }
if (Math.abs(kOf(MAIN) - Math.min(...Z5.p3.arinc.hardware.rows.map((r) => r.factor))) > 1e-3) throw new Error('recommended 500k design differs from plan ③');

/* ---------------- LaTeX → HTML at build time (KaTeX); the fonts it needs are embedded ---------------- */
const KATEX_FONTS = [['KaTeX_Main', 'normal', 'KaTeX_Main-Regular'], ['KaTeX_Math', 'italic', 'KaTeX_Math-Italic'], ['KaTeX_Size1', 'normal', 'KaTeX_Size1-Regular'], ['KaTeX_Size2', 'normal', 'KaTeX_Size2-Regular'], ['KaTeX_Size3', 'normal', 'KaTeX_Size3-Regular'], ['KaTeX_Size4', 'normal', 'KaTeX_Size4-Regular'], ['KaTeX_Caligraphic', 'normal', 'KaTeX_Caligraphic-Regular']];
const fontFaces = KATEX_FONTS.map(([fam, style, file]) => `@font-face{font-family:${fam};font-style:${style};font-weight:400;font-display:block;src:url(data:font/woff2;base64,${readFileSync(`node_modules/katex/dist/fonts/${file}.woff2`).toString('base64')}) format("woff2")}`).join('\n');
const KATEX_CSS = fontFaces + '\n' + readFileSync('node_modules/katex/dist/katex.min.css', 'utf8').replace(/@font-face\{[^}]*\}/g, '');
const usedFonts = new Set();
const tex = (src, display = false) => { const h = katex.renderToString(src, { displayMode: display, output: 'htmlAndMathml', throwOnError: true, strict: 'ignore' }); for (const m of h.matchAll(/class="[^"]*\b(mathnormal|mathit|mathbf|amsrm|textbf|textit|mathsf|mathtt|mathcal|mathfrak|mathscr|boldsymbol)\b/g)) usedFonts.add(m[1]); return h; };
const M = (src) => `<div class="math-block">${tex(src, true)}</div>`;

function body(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const LN = Object.fromEntries(R.levels.map((l) => [l.id, l.name[lang]]));
  const TN = { native950: T('原生 Atlas 950', 'Native Atlas 950'), ubl128: 'UBL128', cm384: '910C · CM384' };
  const kN = (n) => (lang === 'zh' ? `${fmt(n / 10000)} 万` : `${fmt(n / 1000)}k`);
  const yrs = (h) => (h >= 8760 ? T(`${fmt(h / 8760, 1)} 年`, `${fmt(h / 8760, 1)} y`) : h >= 48 ? T(`${fmt(h / 24)} 天`, `${fmt(h / 24)} d`) : `${fmt(h, 1)} h`);
  const VERD = { supported: T('支持', 'supported'), uncertain: T('不确定', 'uncertain'), below: T('不足', 'below') };
  const LEV = { auto: T('自动尝试 180 → 60 s', 'automatic attempt 180 → 60 s'), manual: T('人工 2 h → 30 min', 'manual 2 h → 30 min'), success: T('自动成功 99 → 99.9 %', 'automatic success 99 → 99.9 %') };
  const LEVS = { auto: T('自动 60 s', 'auto 60 s'), manual: T('人工 30 min', 'manual 30 min'), success: T('成功 99.9 %', 'success 99.9 %') };
  const levStr = (ids, short = false) => (ids.length ? ids.map((id) => (short ? LEVS : LEV)[id]).join(' + ') : T('无', 'none'));
  const hwStr = (k, binding) => (k >= 1 ? T(`上限 × ${fk(k)}`, `ceiling × ${fk(k)}`) : T(`任务 × ${fk(k)}`, `task × ${fk(k)}`)) + (binding ? (binding === 'window' ? T('（逐窗口约束）', ' (window binds)') : T('（降额均值约束）', ' (derated mean binds)')) : '');
  const r2 = P(200000).recommended, r5 = Z5.recommended;
  const k5 = kOf(MAIN);
  const sh = Z5.shapley;
  const mechTotal = (sh.all.aOp - sh.none.aOp) * 100;
  const uT5 = uToday(MAIN), uA5 = uAlloc(MAIN);
  const ccShareT = (uT5.cluster + uT5.cabinet) / LV.reduce((a, l) => a + uT5[l], 0), ccShareA = (uA5.cluster + uA5.cabinet) / LV.reduce((a, l) => a + uA5[l], 0);
  const minE = Z5.p3.minEffort;
  const minERows = minE.hardware.rows.filter((h) => h.factor < 0.9995).sort((a, b) => a.factor - b.factor);
  const dn = (id) => id.replace(/-hard$/, '');
  const sens = (t, n) => S.topologies[t].sizes[String(n)];
  const sensRange = (f) => { const v = TOPO.map((t) => f(t)); return [Math.min(...v), Math.max(...v)]; };
  const ENDS = [['replay', T('重执行', 'replay'), 'var(--s3)'], ['elastic', T('弹性', 'elastic'), 'var(--s1)'], ['process', T('进程', 'process'), 'var(--s4)'], ['global', T('全局恢复', 'global'), 'var(--s2)']];
  const FLOW = 'stroke:var(--muted);stroke-width:1.2;fill:none';
  const defs = (id) => `<defs><marker id="arr-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:var(--muted)"/></marker></defs>`;
  const arrow = (id, d) => `<path d="${d}" style="${FLOW}" marker-end="url(#arr-${id})"/>`;
  /** an SVG whose height is known only after drawing: open with placeholders, close with the final height */
  const svgDyn = (id, label) => svgOpen(id, 960, 10, label).replace('viewBox="0 0 960 10"', 'VIEWBOX').replace('height="10"', 'HEIGHT');
  const svgClose = (g, H) => g.replace('VIEWBOX', `viewBox="0 0 960 ${H}"`).replace('HEIGHT', `height="${H}"`) + '</g></svg>';
  /** a flow-chart node: title (bold) + wrapped sub text; returns its height */
  const node = (x, y, w, cls, title, sub, pad = 8, titleFs = 11.5) => {
    const tl = wrap(title, w - 2 * pad, titleFs * 1.05), sl = sub ? wrap(sub, w - 2 * pad, 9.8) : [];
    const h = 6 + tl.length * 14 + (sl.length ? 2 + sl.length * 12 : 0) + 7;
    const svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" class="${cls}"/>` + lines(x + pad, y + 17, tl, 'h', 14) + (sl.length ? lines(x + pad, y + 17 + tl.length * 14 + 2, sl, 's', 12) : '');
    return { svg, h, cx: x + w / 2, bottom: y + h, x, y, w };
  };
  const chipW = (label) => 14 + tw(label, 8.4) * 1.04;
  const flow = (labels, xa, width) => { let x = xa, line = 0; const pos = labels.map((lab) => { const w = chipW(lab); if (x + w > xa + width && x > xa) { x = xa; line++; } const p = { x, line, w }; x += w + 6; return p; }); return { pos, lines: labels.length ? line + 1 : 0 }; };

  /* ---------------- Figure 1: the method as an allocation tree ---------------- */
  function figMethod() {
    const id = `m-${lang}`;
    const head = titleBlock(T('图 1：HAC-D 的分配流程——目标 → 总预算 → 分到五层 → 层内机制与硬件的取舍 → 三重校核 → 输出', 'Figure 1: the HAC-D allocation procedure — goal → total budget → split over five layers → mechanisms versus hardware within a layer → three checks → outputs'));
    let g = svgDyn(`fig-method-${lang}`, T('分配流程', 'Allocation procedure')) + defs(id) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    const goal = node(300, 36, 360, 'cab', T('① 目标：A_op ≥ A* = 98.5 %', '① Goal: A_op ≥ A* = 98.5 %'), T('30 天窗口 · 一个同步训练作业 · 名义参数、全部机制降额、逐窗口三重满足', '30-day window · one synchronous training job · met nominally, with every mechanism derated, and window by window'));
    g += goal.svg;
    const budget = node(300, goal.bottom + 24, 360, 'cab', T('② 总预算：1 − A* = 1.50 个百分点', '② Total budget: 1 − A* = 1.50 points'), T('= 每小时允许的暂停秒数 B（公式 2）；对比今天的 Σ C_ℓ + F', '= the pause seconds allowed per hour, B (formula 2), against today’s Σ C_ℓ + F'));
    g += budget.svg + arrow(id, `M ${goal.cx} ${goal.bottom} V ${budget.y - 2}`);
    const fanY = budget.bottom + 20;
    g += `<text x="${budget.cx}" y="${fanY + 4}" class="m halo" text-anchor="middle">${esc(T('③ 按 ReMAP scope 分到层（每类事件只归一层）：层预算 U_ℓ = C_ℓ / (3600·D)', '③ split by ReMAP scope (each event on exactly one layer): layer budget U_ℓ = C_ℓ / (3600·D)'))}</text>`;
    const SCOPE = { cluster: T('scope: job · 作业级服务', 'scope: job · job-level services'), superpod: T('scope: rack → SuperPoD · UB 交换与光链路', 'scope: rack → SuperPoD · UB switching, optics'), cabinet: T('scope: rack · 供电、液冷、管理、框内 IO', 'scope: rack · power, cooling, management, IO'), node: T('scope: server · CPU、内存、网卡、SSD', 'scope: server · CPU, memory, NIC, SSD'), npu: T('scope: card · 计算、SRAM、IO Die、HBM', 'scope: card · compute, SRAM, IO die, HBM') };
    const ly = fanY + 18, lw = 176;
    const layers = LV.map((l, i) => node(14 + i * 186, ly, lw, 'ub', LN[l], SCOPE[l]));
    const lh = Math.max(...layers.map((n) => n.h));
    layers.forEach((n) => { g += n.svg.replace(/height="[\d.]+"/, `height="${lh}"`); g += `<path d="M ${budget.cx} ${budget.bottom} V ${fanY + 9} H ${n.cx} V ${ly - 2}" style="${FLOW}" marker-end="url(#arr-${id})"/>`; });
    const cy = ly + lh + 18, cw = 83;
    const kids = [];
    layers.forEach((n) => {
      const a = node(n.x + 2, cy, cw, 'so', T('机制 · 杠杆', 'mechanisms, levers'), null, 6, 9.8), b = node(n.x + lw - cw - 2, cy, cw, 'npu', T('硬件 FIT × k', 'hardware FIT × k'), null, 6, 9.8);
      kids.push(a, b);
      g += a.svg + b.svg + `<path d="M ${n.cx} ${n.y + lh} V ${cy - 9} H ${a.cx} V ${cy - 2}" style="${FLOW}" marker-end="url(#arr-${id})"/><path d="M ${n.cx} ${cy - 9} H ${b.cx} V ${cy - 2}" style="${FLOW}" marker-end="url(#arr-${id})"/>`;
    });
    const kh = Math.max(...kids.map((k) => k.h)), brY = cy + kh + 12;
    g += `<path d="M ${kids[0].cx} ${brY} H ${kids[kids.length - 1].cx}" style="${FLOW}"/>` + kids.map((k) => `<path d="M ${k.cx} ${cy + kh} V ${brY}" style="${FLOW}"/>`).join('');
    const eff = node(150, brY + 14, 660, 'cab', T('④ 层内取舍：总努力最小  E = Σ 杠杆努力 eⱼ + Σ 2·log₂(1/xᵢ)（公式 3）', '④ Within a layer: least total effort  E = Σ lever effort eⱼ + Σ 2·log₂(1/xᵢ) (formula 3)'), T('杠杆 = R-CKPT / R-MANUAL 的参数：自动尝试 ≥ 60 s（努力 3）、自动成功 ≤ 99.9 %（3）、人工 ≥ 30 min（2）；硬件 = 中断类 FIT 同乘 k（ARINC），或最小努力拆分（每减半努力 2，下限 × 0.05）', 'levers = the R-CKPT / R-MANUAL parameters: automatic attempt ≥ 60 s (effort 3), automatic success ≤ 99.9 % (3), manual ≥ 30 min (2); hardware = every interruption class’s FIT × k (ARINC), or the minimum-effort split (effort 2 per halving, floor × 0.05)'));
    g += eff.svg + arrow(id, `M ${eff.cx} ${brY} V ${eff.y - 2}`);
    const chk = node(150, eff.bottom + 24, 660, 'panel', T('⑤ 校核：引擎闭合（名义与降额 A_op ≥ A*）+ 逐窗口（400 个 30 天窗口，P(A_op ≥ A*) 的 Wilson 下界 ≥ 90 %，公式 4）', '⑤ Checks: engine closure (A_op ≥ A* nominal and derated) + per window (400 × 30-day windows, Wilson lower bound of P(A_op ≥ A*) ≥ 90 %, formula 4)'), T('不支持 → 回到 ④：加最便宜的未用杠杆，或收紧硬件上限 k', 'not supported → back to ④: add the cheapest unused lever, or lower the hardware ceiling k'));
    g += chk.svg + arrow(id, `M ${eff.cx} ${eff.bottom} V ${chk.y - 2}`);
    g += `<path d="M ${chk.x + chk.w} ${chk.y + chk.h / 2} H ${chk.x + chk.w + 26} V ${eff.y + eff.h / 2} H ${eff.x + eff.w + 2}" style="${FLOW};stroke-dasharray:4 3" marker-end="url(#arr-${id})"/>`;
    g += `<text x="${chk.x + chk.w + 32}" y="${(chk.y + eff.y + eff.h) / 2 + 4}" class="m">${esc(T('不支持', 'not supported'))}</text>`;
    const out = node(150, chk.bottom + 24, 660, 'cab', T('⑥ 输出', '⑥ Outputs'), T('各规模的方案（表 1）· 每层的不可用度预算（表 2）· 机制与恢复流程的参数要求（表 3）· 每层允许 FIT / 卡（表 4）· 按拓扑、按实例的验收值（表 5）', 'the plan at each size (Table 1) · each layer’s unavailability budget (Table 2) · parameter requirements of the mechanisms and the recovery process (Table 3) · allowed FIT per card by layer (Table 4) · acceptance values per instance by topology (Table 5)'));
    g += out.svg + arrow(id, `M ${chk.cx} ${chk.bottom} V ${out.y - 2}`);
    return svgClose(g, out.bottom + 14 + head.dy);
  }

  /* ---------------- Figure 2: the gap and the plan by size ---------------- */
  function figSizes() {
    const top = 62, ph = 176;
    const head = titleBlock(T('图 2：四个规模的差距与方案——左：今天与分配后的 A_op（名义实心、降额空心）对目标；右：允许的硬件系数 k（> 1 验收上限，< 1 交付任务）', 'Figure 2: the gap and the plan at the four sizes — left: A_op today and after allocation (nominal filled, derated hollow) against the goal; right: the allowed hardware factor k (> 1 an acceptance ceiling, < 1 a delivery task)'));
    let g = svgDyn(`fig-sizes-${lang}`, T('规模与方案', 'Sizes and plans')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    // left panel
    const L = { x: 60, w: 490 }, yLo = 95, yHi = 100;
    const Y = (v) => top + ((yHi - v) / (yHi - yLo)) * ph;
    const X = (i) => L.x + 50 + i * ((L.w - 100) / (SIZES.length - 1));
    for (let v = yLo; v <= yHi; v++) g += `<line x1="${L.x}" y1="${Y(v)}" x2="${L.x + L.w}" y2="${Y(v)}" class="grid"/><text x="${L.x - 6}" y="${Y(v) + 4}" class="m" text-anchor="end">${v} %</text>`;
    g += `<line x1="${L.x}" y1="${Y(R.target * 100)}" x2="${L.x + L.w}" y2="${Y(R.target * 100)}" style="stroke:var(--ink);stroke-width:1.2;stroke-dasharray:5 3"/><text x="${L.x + L.w - 2}" y="${Y(R.target * 100) - 5}" class="sb" text-anchor="end">${esc(T('目标 A* = 98.5 %', 'goal A* = 98.5 %'))}</text>`;
    const series = [
      { key: (z) => z.today.aOp, color: 'var(--s2)', filled: true }, { key: (z) => z.today.aOpDerated, color: 'var(--s2)', filled: false },
      { key: (z) => z.recommended.atLimit.aOp, color: 'var(--s1)', filled: true }, { key: (z) => z.recommended.atLimit.aOpDerated, color: 'var(--s1)', filled: false },
    ];
    for (const s of series) {
      const pts = SIZES.map((n, i) => [X(i), Y(s.key(P(n)) * 100)]);
      g += `<path d="M ${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ')}" style="stroke:${s.color};stroke-width:${s.filled ? 1.6 : 1};fill:none${s.filled ? '' : ';stroke-dasharray:3 3'}"/>`;
      pts.forEach((p, i) => { const z = P(SIZES[i]); const tip = `${kN(SIZES[i])}|${T('今天', 'today')} ${pct(z.today.aOp)} / ${pct(z.today.aOpDerated)}|${T('分配后', 'after allocation')} ${pct(z.recommended.atLimit.aOp)} / ${pct(z.recommended.atLimit.aOpDerated)}`; g += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.2" style="fill:${s.filled ? s.color : 'var(--surface)'};stroke:${s.color};stroke-width:1.6" data-tip="${esc(tip)}"/>`; });
    }
    SIZES.forEach((n, i) => {
      const z = P(n), t = z.today.aOp * 100, r = z.recommended.atLimit.aOp * 100;
      g += `<text x="${X(i) - 8}" y="${Y(t) + 3.5}" class="tiny halo" text-anchor="end" style="fill:var(--s2);font-weight:600">${esc(`${fmt(t, 2)} %`)}</text>`;
      g += `<text x="${X(i) + 8}" y="${Y(r) + 3.5}" class="tiny halo" text-anchor="start" style="fill:var(--s1);font-weight:600">${esc(`${fmt(r, 2)} %`)}</text>`;
      g += `<text x="${X(i)}" y="${top + ph + 16}" class="sb" text-anchor="middle">${esc(T(`${kN(n)}卡`, kN(n)))}</text>`;
      g += `<text x="${X(i)}" y="${top + ph + 30}" class="m" text-anchor="middle">${esc(`P ${pP(z.todayWindow.pAtLeastTarget)} → ${pP(z.recommended.window.pAtLeastTarget)}`)}</text>`;
      g += `<text x="${X(i)}" y="${top + ph + 43}" class="m" text-anchor="middle">${esc(levStr(z.recommended.levers, true))}</text>`;
    });
    g += `<text x="${L.x}" y="${top - 24}" class="m">${esc(T('A_op（30 天窗口均值）；轴下：逐窗口 P(A_op ≥ A*) 今天 → 分配后，及所用恢复杠杆', 'A_op (30-day mean); below the axis: per-window P(A_op ≥ A*) today → after allocation, and the recovery levers used'))}</text>`;
    // right panel: k on a log axis
    const Rp = { x: 660, w: 280 }, kLo = 0.25, kHi = 32;
    const YK = (k) => top + ((Math.log(kHi) - Math.log(k)) / (Math.log(kHi) - Math.log(kLo))) * ph;
    const XK = (i) => Rp.x + 40 + i * ((Rp.w - 80) / (SIZES.length - 1));
    for (const v of [0.25, 0.5, 1, 2, 4, 8, 16, 32]) g += `<line x1="${Rp.x}" y1="${YK(v)}" x2="${Rp.x + Rp.w}" y2="${YK(v)}" class="${v === 1 ? 'axis' : 'grid'}"/><text x="${Rp.x - 6}" y="${YK(v) + 4}" class="m" text-anchor="end">× ${v}</text>`;
    g += `<text x="${Rp.x + Rp.w - 2}" y="${YK(1) - 5}" class="sb" text-anchor="end">${esc(T('今天的硬件', 'today’s hardware'))}</text>`;
    SIZES.forEach((n, i) => {
      const r = P(n).recommended, k = r.k, bw = 30, x = XK(i) - bw / 2;
      const y0 = YK(1), y1 = YK(k);
      g += `<rect x="${x}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw}" height="${Math.abs(y1 - y0).toFixed(1)}" rx="3" style="fill:${k >= 1 ? 'var(--s3)' : 'var(--s2)'}" data-tip="${esc(`${kN(n)}|k = ${fmt(k, 4)}|${r.binding === 'window' ? T('逐窗口校核约束', 'the window check binds') : T('降额均值约束', 'the derated mean binds')}`)}"/>`;
      g += `<text x="${XK(i)}" y="${k >= 1 ? y1 - 5 : y1 + 12}" class="sb halo" text-anchor="middle">× ${fk(k)}</text>`;
      g += `<text x="${XK(i)}" y="${top + ph + 16}" class="sb" text-anchor="middle">${esc(T(`${kN(n)}卡`, kN(n)))}</text>`;
      g += `<text x="${XK(i)}" y="${top + ph + 30}" class="m" text-anchor="middle">${esc(r.binding === 'window' ? T('逐窗口约束', 'window binds') : T('降额均值约束', 'mean binds'))}</text>`;
    });
    g += `<text x="${Rp.x}" y="${top - 24}" class="m">${esc(T('允许的硬件系数 k（全部中断类 FIT × k，对数轴）', 'allowed hardware factor k (every interruption FIT × k, log axis)'))}</text>`;
    const lg = legend(L.x, top + ph + 62, [
      { style: 'fill:var(--s2)', label: T('今天 · 名义', 'today · nominal') }, { style: 'fill:var(--surface);stroke:var(--s2);stroke-width:1.5', label: T('今天 · 降额', 'today · derated') },
      { style: 'fill:var(--s1)', label: T('分配后（在 k 处）· 名义', 'after allocation (at k) · nominal') }, { style: 'fill:var(--surface);stroke:var(--s1);stroke-width:1.5', label: T('分配后 · 降额', 'after allocation · derated') },
      { style: 'stroke:var(--ink);stroke-width:1.2;stroke-dasharray:5 3', label: T('目标', 'goal'), line: true }, { style: 'fill:var(--s3)', label: T('k > 1：验收上限', 'k > 1: acceptance ceiling') }, { style: 'fill:var(--s2)', label: T('k < 1：交付任务', 'k < 1: delivery task') },
    ]);
    g += lg.g;
    return svgClose(g, lg.y + 12 + head.dy);
  }

  /* ---------------- Figure 3: the five layers as a zoom chain through the hardware ---------------- */
  function figLayers() {
    const x0 = 14, colW = 184, step = 190, top = 40;
    const head = titleBlock(T('图 3：五个层级——逐级放大的硬件、每层的故障类（硬中断 FIT / 卡）、三种拓扑每个实例的 NPU 数、部署在该层的机制、该层中断今天在恢复链的哪一级结束', 'Figure 3: the five layers — the hardware zoomed in step by step, each layer’s fault classes (hard FIT per card), NPUs per instance on the three topologies, the mechanisms deployed there, and where the layer’s interruptions end on today’s recovery chain'));
    const inner = colW - 8;
    const mechAt = (l) => Object.entries(R.deploy).filter(([, v]) => v.level === l).map(([id]) => id);
    const mechLabel = (id) => (MECH[id] ? id : { detect: T('检测', 'detection'), isolate: T('隔离', 'isolation') }[id] ?? id);
    const PER = { cluster: T('整个作业：N', 'the whole job: N'), superpod: `${fmt(S.topologies.native950.podNpus)} · ${fmt(S.topologies.ubl128.podNpus)} · ${fmt(S.topologies.cm384.podNpus)}`, cabinet: `${S.topologies.native950.cabinetNpus} · ${S.topologies.ubl128.cabinetNpus} · ${S.topologies.cm384.cabinetNpus}`, node: T('8（三种相同）', '8 (all three)'), npu: '1' };
    const PER_SUB = { superpod: T('原生 950 · UBL128 · CM384', 'native 950 · UBL128 · CM384'), cabinet: T('原生 950 · UBL128 · CM384', 'native 950 · UBL128 · CM384') };
    const SCOPE = { cluster: 'job', superpod: 'rack → SuperPoD', cabinet: 'rack', node: 'server', npu: 'card' };
    const tiny = (x, y, t, anchor = 'middle', style = '') => `<text x="${x}" y="${y}" class="tiny"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${style ? ` style="${style}"` : ''}>${esc(t)}</text>`;
    /* schematics: each draws into (x, y, w, h) and returns { svg, zoom: rect of the element the next column magnifies } */
    const SCHEM = {
      cluster: (x, y, w, h) => {
        let s = `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="6" class="panel" style="stroke-dasharray:4 3"/>`;
        s += `<rect x="${x + 12}" y="${y + 10}" width="${w - 24}" height="22" rx="3" class="cpu"/>` + tiny(x + w / 2, y + 24, T('共享存储 · 调度 · 软件栈', 'shared storage · scheduler · software'));
        const pw = 30, py = y + 50;
        for (let j = 0; j < 4; j++) { const px = x + 14 + j * 38; s += `<line x1="${px + pw / 2}" y1="${y + 32}" x2="${px + pw / 2}" y2="${py}" class="l-so"/><rect x="${px}" y="${py}" width="${pw}" height="40" rx="3" class="cab"/>`; for (let r = 0; r < 3; r++) s += `<rect x="${px + 4}" y="${py + 6 + r * 10}" width="${pw - 8}" height="6" rx="1" class="tray"/>`; }
        s += tiny(x + w / 2, y + h - 4, T('超节点 × 若干（图中 4 个）', 'SuperPoDs (4 drawn)'));
        return { svg: s, zoom: { x: x + 14 + 3 * 38, y: py, w: pw, h: 40 }, outer: { x: x + 2, y: y + 2, w: w - 4, h: h - 4 } };
      },
      superpod: (x, y, w, h) => {
        let s = `<rect x="${x + 10}" y="${y + 8}" width="${w - 20}" height="20" rx="3" class="ub"/>` + tiny(x + w / 2, y + 21, T('UB 交换 + 光链路（FABRIC · OPT）', 'UB switching + optics (FABRIC · OPT)'));
        const cw = 20, cy = y + 50, n = 6;
        for (let j = 0; j < n; j++) { const cx = x + 14 + j * 26; s += `<line x1="${cx + cw / 2}" y1="${y + 28}" x2="${cx + cw / 2}" y2="${cy}" class="l-ub"/><rect x="${cx}" y="${cy}" width="${cw}" height="42" rx="2" class="cab"/>`; for (let r = 0; r < 5; r++) s += `<rect x="${cx + 3}" y="${cy + 4 + r * 7.5}" width="${cw - 6}" height="5" rx="1" class="tray"/>`; }
        s += tiny(x + w / 2, y + h - 4, T('计算柜 × 16 / 2 / 12（+ 互联柜）', 'compute cabinets × 16 / 2 / 12 (+ switch cabinets)'));
        return { svg: s, zoom: { x: x + 14 + 5 * 26, y: cy, w: cw, h: 42 }, outer: { x: x + 10, y: y + 8, w: w - 20, h: 84 } };
      },
      cabinet: (x, y, w, h) => {
        const cy = y + 6, ch = h - 24, sx = x + 14, sw = 50, cx = sx + sw + 12, cw = 70;
        let s = `<rect x="${sx}" y="${cy}" width="${sw}" height="${ch}" rx="3" class="cpu"/>`;
        T(['供电', '液冷', '管理', '框内 IO'], ['power', 'cooling', 'mgmt', 'IO']).forEach((t, i) => { s += tiny(sx + sw / 2, cy + 16 + i * 17, t); });
        s += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="3" class="cab"/><rect x="${cx + 5}" y="${cy + 5}" width="6" height="${ch - 10}" rx="1" class="unk"/>`;
        const trays = 8, th = (ch - 10) / trays;
        for (let r = 0; r < trays; r++) s += `<rect x="${cx + 15}" y="${(cy + 5 + r * th).toFixed(1)}" width="${cw - 21}" height="${(th - 2).toFixed(1)}" rx="1.5" class="tray"/>`;
        s += tiny(x + w / 2, y + h - 4, T('节点托盘 × 8 · 背板 / LRS（左）', 'node trays × 8 · backplane / LRS (left)'));
        return { svg: s, zoom: { x: cx + 15, y: cy + 5 + 2 * th, w: cw - 21, h: th - 2 }, outer: { x: cx, y: cy, w: cw, h: ch } };
      },
      node: (x, y, w, h) => {
        const nx = x + 12, ny = y + 8, nw = w - 24, nh = h - 26;
        let s = `<rect x="${nx}" y="${ny}" width="${nw}" height="${nh}" rx="3" class="cab"/>`;
        for (let r = 0; r < 2; r++) s += `<rect x="${nx + 8}" y="${ny + 8 + r * 22}" width="30" height="16" rx="2" class="cpu"/>` + tiny(nx + 23, ny + 19 + r * 22, 'CPU');
        for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) s += `<rect x="${nx + 50 + k * 24}" y="${ny + 8 + r * 22}" width="18" height="16" rx="2" class="npu"/>`;
        s += `<rect x="${nx + 8}" y="${ny + 54}" width="40" height="13" rx="2" class="so"/>` + tiny(nx + 28, ny + 64, 'NIC') + `<rect x="${nx + 54}" y="${ny + 54}" width="40" height="13" rx="2" class="tray"/>` + tiny(nx + 74, ny + 64, 'DDR') + `<rect x="${nx + 100}" y="${ny + 54}" width="40" height="13" rx="2" class="cpu"/>` + tiny(nx + 120, ny + 64, 'SSD');
        s += tiny(x + w / 2, y + h - 4, T('8 NPU + 2 CPU（UB 域内全互联）', '8 NPUs + 2 CPUs (meshed in the UB domain)'));
        return { svg: s, zoom: { x: nx + 50 + 3 * 24, y: ny + 8, w: 18, h: 16 }, outer: { x: nx, y: ny, w: nw, h: nh } };
      },
      npu: (x, y, w, h) => {
        const mx = x + 24, my = y + 6, mw = w - 48, mh = h - 24;
        let s = `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="4" class="cab"/>`;
        const dx = mx + 34, dw = mw - 68;
        s += `<rect x="${dx}" y="${my + 12}" width="${dw}" height="${mh - 24}" rx="3" class="npu"/>` + tiny(dx + dw / 2, my + mh / 2 - 6, T('计算 CORE', 'CORE')) + tiny(dx + dw / 2, my + mh / 2 + 6, 'SRAM · IOD');
        for (const [hx, lab] of [[mx + 8, 'HBM'], [mx + mw - 30, 'HBM']]) for (let r = 0; r < 2; r++) s += `<rect x="${hx}" y="${my + 12 + r * ((mh - 24) / 2)}" width="22" height="${(mh - 24) / 2 - 3}" rx="2" class="tray"/>` + tiny(hx + 11, my + 12 + r * ((mh - 24) / 2) + (mh - 24) / 4, lab);
        s += tiny(x + w / 2, y + h - 4, T('模组 MODULE（HBM：MEMT · MEMP）', 'MODULE (HBM: MEMT · MEMP)'));
        return { svg: s, zoom: null, outer: { x: mx, y: my, w: mw, h: mh } };
      },
    };
    // column layout
    const cols = LV.map((l, i) => {
      const x = x0 + i * step;
      const hdr = wrap(`scope: ${SCOPE[l]}`, inner, 9.8);
      const hwLabels = lvl[l].domains.map((d) => `${d} ${fmt(hardFit(d))}`), ids = mechAt(l);
      const hw = flow(hwLabels, x + 4, inner), me = flow(ids.map(mechLabel), x + 4, inner);
      const e = Z5.endsToday[l];
      const endL = wrap(ENDS.filter(([k]) => (e[k] ?? 0) >= 0.0005).map(([k, nm]) => `${nm} ${fmt(e[k] * 100, e[k] >= 0.1 ? 0 : 1)} %`).join(' · '), inner, 9.8);
      return { l, x, hdr, hwLabels, ids, hw, me, e, endL };
    });
    const schemY = top + 32, schemH = 110;
    const rowsY = schemY + schemH + 12;
    let g = svgDyn(`fig-layers-${lang}`, T('层级映射', 'Layer map')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    let maxBottom = 0;
    const zooms = [], outers = [];
    cols.forEach((c) => {
      const l = c.l;
      g += `<text x="${c.x + 4}" y="${top}" class="h">${esc(LN[l])}</text>` + lines(c.x + 4, top + 14, c.hdr, 'm', 12);
      const sc = SCHEM[l](c.x, schemY, colW, schemH);
      g += sc.svg; zooms.push(sc.zoom); outers.push(sc.outer);
      let y = rowsY;
      g += `<text x="${c.x + 4}" y="${y + 9}" class="m">${esc(T('每实例 NPU', 'NPUs per instance'))}</text><text x="${c.x + 4}" y="${y + 23}" class="sb">${esc(PER[l])}</text>`;
      y += 28;
      if (PER_SUB[l]) { g += `<text x="${c.x + 4}" y="${y + 6}" class="m">${esc(PER_SUB[l])}</text>`; y += 12; }
      y += 8;
      g += `<text x="${c.x + 4}" y="${y + 9}" class="m">${esc(T('故障类（硬中断 FIT / 卡）', 'fault classes (hard FIT per card)'))}</text>`;
      y += 14;
      c.hwLabels.forEach((label, j) => { const p = c.hw.pos[j], cy = y + p.line * 22; g += `<rect x="${p.x}" y="${cy}" width="${p.w.toFixed(1)}" height="18" rx="9" class="cab"/><text x="${p.x + 7}" y="${cy + 13}" class="tiny">${esc(label)}</text>`; });
      y += c.hw.lines * 22 + 2;
      g += `<text x="${c.x + 4}" y="${y + 9}" class="sb">${esc(T(`合计 ${fmt(fitCard(l), 1)} FIT / 卡`, `total ${fmt(fitCard(l), 1)} FIT per card`))}</text>`;
      y += 24;
      g += `<text x="${c.x + 4}" y="${y + 9}" class="m">${esc(T('部署在此层的机制', 'mechanisms deployed here'))}</text>`;
      y += 14;
      if (!c.ids.length) { const nl = wrap(T('无——只受集群级恢复与自身硬件影响', 'none — only the cluster-level recovery and its own hardware'), inner, 9.8); g += lines(c.x + 4, y + 12, nl, 's', 12); y += nl.length * 12 + 4; }
      c.ids.forEach((id, j) => { const p = c.me.pos[j], my = y + p.line * 22; g += `<rect x="${p.x}" y="${my}" width="${p.w.toFixed(1)}" height="18" rx="4" class="${MECH[id] ? 'ub' : 'asm'}" data-tip="${esc(`${mechLabel(id)}|${R.deploy[id].how[lang]}`)}"/><text x="${p.x + 7}" y="${my + 13}" class="tiny" pointer-events="none">${esc(mechLabel(id))}</text>`; });
      y += c.me.lines * 22 + 4;
      g += `<text x="${c.x + 4}" y="${y + 9}" class="m">${esc(T(`中断在哪里结束（今天，${kN(MAIN)}卡）`, `where interruptions end (today, ${kN(MAIN)})`))}</text>`;
      y += 14;
      let bx = c.x + 4;
      const tip = `${LN[l]}|${ENDS.map(([k, nm]) => `${nm} ${fmt((c.e[k] ?? 0) * 100, 2)} %`).join('|')}`;
      for (const [k, , col] of ENDS) { const w = inner * (c.e[k] ?? 0); if (w <= 0.3) continue; g += `<rect x="${bx.toFixed(1)}" y="${y}" width="${Math.max(1, w - 2).toFixed(1)}" height="10" rx="2" style="fill:${col}" data-tip="${esc(tip)}"/>`; bx += w; }
      g += lines(c.x + 4, y + 24, c.endL, 's', 12);
      y += 14 + c.endL.length * 12 + 4;
      maxBottom = Math.max(maxBottom, y);
    });
    // zoom lines from the magnified element to the next column's schematic
    zooms.forEach((z, i) => { if (!z || i === LV.length - 1) return; const o = outers[i + 1]; g += `<path d="M ${z.x + z.w} ${z.y} L ${o.x} ${o.y}" class="zoom"/><path d="M ${z.x + z.w} ${z.y + z.h} L ${o.x} ${o.y + o.h}" class="zoom"/><rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="1.5" style="fill:none;stroke:var(--muted);stroke-width:1.2"/>`; });
    const lg = legend(x0, maxBottom + 10, [{ cls: 'tray', label: T('NPU / 托盘 / HBM', 'NPU / tray / HBM') }, { cls: 'ub', label: T('UB 交换；ReMAP 参考机制（芯片）', 'UB switching; ReMAP reference mechanism (chip)') }, { cls: 'cpu', label: T('CPU、供电、管理等', 'CPU, power, management') }, { cls: 'zoom', label: T('放大', 'zoom'), line: true }, { cls: 'cab', label: T('故障类芯片', 'fault-class chip') }, { cls: 'asm', label: T('基线恢复（检测、R-CKPT、R-MANUAL、隔离）', 'baseline recovery (detection, R-CKPT, R-MANUAL, isolation)') }, ...ENDS.map(([, nm, col]) => ({ style: `fill:${col}`, label: T(`结束于${nm}`, `ends at ${nm}`) }))]);
    g += lg.g;
    return svgClose(g, lg.y + 12 + head.dy);
  }

  /* ---------------- Figure 4: the layer ledger at 500k (derated, points of A_op) ---------------- */
  function figLedger() {
    const W = 960, x0 = 168, x1 = 690, top = 46, rowH = 28;
    const t = uT5, v = uLevers(), a = uA5;
    const items = [...LV.map((l) => ({ name: LN[l], t: t[l], v: v[l], a: a[l] })), { name: T('其他事件类', 'Other event classes'), t: t.other, v: v.other, a: Math.min(a.other, v.other), aTrue: a.other }];
    const max = Math.ceil(Math.max(...items.map((x) => x.t)) * 2) / 2;
    const X = (u) => x0 + (u / max) * (x1 - x0);
    const head = titleBlock(T(`图 4：${kN(MAIN)}卡时每层的不可用度怎样降到预算（降额，A_op 的百分点）：今天 → 恢复杠杆（${levStr(r5.levers)}）→ 全部中断类 FIT × ${fk(k5)}`, `Figure 4: how each layer’s unavailability comes down to its budget at ${kN(MAIN)} NPUs (derated, points of A_op): today → recovery levers (${levStr(r5.levers)}) → every interruption FIT × ${fk(k5)}`));
    const H = top + (items.length + 1) * rowH + 40 + head.dy;
    let g = svgOpen(`fig-ledger-${lang}`, W, H, T('分层不可用度账', 'Layer unavailability ledger')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    for (let u = 0; u <= max + 1e-9; u += 0.5) g += `<line x1="${X(u)}" y1="${top - 8}" x2="${X(u)}" y2="${top + items.length * rowH - 6}" class="grid"/><text x="${X(u)}" y="${top - 12}" class="m" text-anchor="middle">${fmt(u, 1)}</text>`;
    g += `<text x="${x1 + 16}" y="${top - 12}" class="m">${esc(T('今天 → 杠杆后 → 预算（点）', 'today → after levers → budget (points)'))}</text>`;
    items.forEach((it, i) => {
      const y = top + i * rowH;
      g += `<text x="${x0 - 10}" y="${y + 13}" class="s" text-anchor="end">${esc(it.name)}</text>`;
      const tip = `${it.name}|${T('今天', 'today')} ${fmt(it.t, 3)}|${T('恢复杠杆后', 'after the levers')} ${fmt(it.v, 3)}|${T('预算', 'budget')} ${fmt(it.aTrue ?? it.a, 3)} ${T('个百分点', 'points')}`;
      const seg = (u0, u1, style) => (u1 - u0 > 1e-4 ? `<rect x="${X(u0).toFixed(1)}" y="${y}" width="${Math.max(1, X(u1) - X(u0) - 2).toFixed(1)}" height="18" rx="3" style="${style}" data-tip="${esc(tip)}"/>` : '');
      g += seg(0, it.a, 'fill:var(--s1)') + seg(it.a, it.v, 'fill:var(--s2)') + seg(it.v, it.t, 'fill:var(--s3)');
      g += `<text x="${x1 + 16}" y="${y + 13}" class="sb">${esc(`${f2(it.t)} → ${f2(it.v)} → ${f2(it.aTrue ?? it.a)}`)}</text>`;
    });
    const yT = top + items.length * rowH;
    g += `<line x1="${x0 - 150}" y1="${yT - 4}" x2="${W - 14}" y2="${yT - 4}" class="grid"/><text x="${x0 - 10}" y="${yT + 13}" class="h" text-anchor="end">${esc(T('合计 = 1 − A_op', 'Total = 1 − A_op'))}</text><text x="${x1 + 16}" y="${yT + 13}" class="sb">${esc(`${f2(t.total)} → ${f2(v.total)} → ${f2(a.total)}`)}</text>`;
    const lg = legend(x0, yT + rowH + 14, [{ style: 'fill:var(--s3)', label: T('恢复杠杆去掉的', 'removed by the recovery levers') }, { style: 'fill:var(--s2)', label: T(`硬件 × ${fk(k5)} 去掉的`, `removed by hardware × ${fk(k5)}`) }, { style: 'fill:var(--s1)', label: T('留下的 = 该层预算', 'what remains = the layer’s budget') }]);
    return g + lg.g + '</g></svg>';
  }

  /* ---------------- formulas (LaTeX) ---------------- */
  const other = lang === 'zh' ? String.raw`U_{\text{其他}}` : String.raw`U_{\mathrm{other}}`;
  const F1 = M(String.raw`A_{\mathrm{op}}=\frac{1-\varphi}{1+\bigl(\sum_{\ell}C_\ell+F\bigr)/3600},\qquad C_\ell=\sum_{i\in\ell}\lambda_i\,\bar t_i,\qquad \lambda_i=N\cdot\mathrm{FIT}_i\cdot10^{-9}\ \mathrm{h}^{-1},\qquad \bar t_i=\sum_{r}p_{i,r}\,t_{i,r}\tag{1}`);
  const F2 = M(String.raw`B=3600\Bigl(\frac{1-\varphi}{A^{\ast}}-1\Bigr)-F,\qquad U_\ell=\frac{C_\ell}{3600\,D},\quad D=1+\frac{\sum_\ell C_\ell+F}{3600},\qquad 1-A_{\mathrm{op}}=\sum_\ell U_\ell+${other}\tag{2}`);
  const F3 = M(String.raw`\lambda_i^{\ast}=k\,\lambda_i,\quad k=\frac{B}{\sum_i c_i}\ \ (\text{ARINC});\qquad \min_{x}\ \sum_i e_i\log_2\frac{1}{x_i}\ \ \text{s.t.}\ \sum_i x_i c_i\le B,\ x_i\ge 0.05\ \ (\text{min.\ effort});\qquad E=\sum_{j\in\mathcal{S}}e_j+\sum_i 2\log_2\frac{1}{x_i}\tag{3}`);
  const F4 = M(String.raw`\Pr\bigl(A_{\mathrm{op}}^{(30\,\mathrm{d})}\ge A^{\ast}\bigr)\ \text{(Wilson 95 \% lower bound, 400 windows)}\ \ge 0.9,\qquad A_{\mathrm{op}}(\text{nominal})\ge A^{\ast},\quad A_{\mathrm{op}}(\text{derated})\ge A^{\ast}\tag{4}`);
  const FS = M(String.raw`\phi_m=\sum_{\mathcal{S}\subseteq\mathcal{M}\setminus\{m\}}\frac{|\mathcal{S}|!\,(|\mathcal{M}|-|\mathcal{S}|-1)!}{|\mathcal{M}|!}\Bigl[v(\mathcal{S}\cup\{m\})-v(\mathcal{S})\Bigr],\qquad v(\mathcal{S})=\text{pause s/h of a layer (or }A_{\mathrm{op}})\text{ with the set }\mathcal{S}\text{ enabled}`);
  const F5 = tex(String.raw`\mathrm{FIT}_{\mathrm{inst}}=n_{\mathrm{inst}}\cdot k\cdot\mathrm{FIT}_{\mathrm{card}}`), F6 = tex(String.raw`\mathrm{MTBF}_{\mathrm{inst}}=10^{9}/\mathrm{FIT}_{\mathrm{inst}}`);
  const Uinl = tex(String.raw`U_\ell`), Finl = tex(String.raw`F`), phiInl = tex(String.raw`\varphi`), tInl = tex(String.raw`\bar t_i`), pInl = tex(String.raw`p_{i,r}`), gInl = tex(String.raw`g`), kInl = tex(String.raw`k`), cInl = tex(String.raw`c_i=\lambda_i\bar t_i`);

  /* ---------------- Table 0: the topologies ---------------- */
  const TDESC = {
    native950: [T('1,024 NPU：16 个计算柜 + 4 个灵衢互联柜，柜内全互联 + 一层光交换（8,192 卡路线图版本每 NPU 器件数相同）', '1,024 NPUs: 16 compute + 4 UB interconnect cabinets, in-cabinet mesh + one optical switching tier (the 8,192-NPU roadmap version has the same counts per NPU)'), T('64 NPU / 柜，8 NPU / 节点', '64 NPUs per cabinet, 8 per node')],
    ubl128: [T('128 NPU：2 个计算柜，单层 UB 交换（每 NPU 3.2 Tb/s）', '128 NPUs: 2 compute cabinets, single-layer UB switching (3.2 Tb/s per NPU)'), T('64 NPU / 柜，8 NPU / 节点', '64 NPUs per cabinet, 8 per node')],
    cm384: [T('384 NPU：12 个计算柜 + 4 个通信柜，L1 / L2 两级 UB 交换', '384 NPUs: 12 compute + 4 communication cabinets, two-level L1 / L2 UB switching'), T('32 NPU / 柜，8 NPU / 节点（Atlas 800T A3 服务器为节点）', '32 NPUs per cabinet, 8 per node (Atlas 800T A3 servers as nodes)')],
  };
  const table0 = `<div class="table-wrap"><table class="s0"><thead><tr><th>${esc(T('拓扑', 'Topology'))}</th><th>${esc(T('超节点（UB 域）', 'SuperPoD (UB domain)'))}</th><th>${esc(T('计算柜 / 节点', 'Cabinet / node'))}</th><th class="num">${esc(T('超节点数：1 万 / 10 万 / 20 万 / 50 万卡', 'SuperPoDs at 10k / 100k / 200k / 500k'))}</th></tr></thead><tbody>${TOPO.map((t) => `<tr><td class="b">${esc(t === 'native950' ? T('原生 Atlas 950 超节点', 'Native Atlas 950 SuperPoD') : t === 'ubl128' ? T('Atlas 950 SuperPoD Flex（UBL128）', 'Atlas 950 SuperPoD Flex (UBL128)') : T('910C：Atlas 900 A3 超节点（CloudMatrix384）', '910C: Atlas 900 A3 SuperPoD (CloudMatrix384)'))}</td><td>${esc(TDESC[t][0])}</td><td>${esc(TDESC[t][1])}</td><td class="num">${SIZES.map((n) => fmt(sens(t, n).instances.superpod)).join(' / ')}</td></tr>`).join('')}</tbody></table></div>`;

  /* ---------------- Table 1: goal, gap and plan by size ---------------- */
  const t1rows = SIZES.map((n) => {
    const z = P(n), r = z.recommended, w = z.todayWindow, x = x1(n);
    const g = z.p2.factor;
    return `<tr><td class="b nw">${esc(kN(n))}</td><td class="num${z.today.aOpDerated < R.target ? ' bad' : ''}">${pct(z.today.aOp)} / ${pct(z.today.aOpDerated)}</td><td class="num${w.verdict === 'below' ? ' bad' : ''}">${pP(w.pAtLeastTarget)} · ${esc(VERD[w.verdict])}</td><td class="num">${x === null ? esc(T('已满足', 'met')) : `× ${fk(x)}`}</td><td class="num">${g >= 1 - 1e-9 ? esc(T('已满足', 'met')) : `g = ${fmt(g, 3)}`}</td><td class="b">${esc(levStr(r.levers))}${r.escalated ? '<sup>¹</sup>' : ''}</td><td class="b">${esc(hwStr(r.k, r.binding))}</td><td class="num">${pct(r.atLimit.aOp)} / ${pct(r.atLimit.aOpDerated)} · ${pP(r.window.pAtLeastTarget)}</td></tr>`;
  }).join('');
  const table1 = `<div class="table-wrap"><table class="s1"><thead><tr><th>${esc(T('规模', 'Size'))}</th><th class="num">${esc(T('今天 A_op 名义 / 降额', 'Today A_op nominal / derated'))}</th><th class="num">${esc(T('今天逐窗口 P', 'Today per-window P'))}</th><th class="num">${esc(T('对照 ①：只靠硬件', 'Reference ①: hardware alone'))}</th><th class="num">${esc(T('对照 ②：只靠恢复链', 'Reference ②: recovery chain alone'))}</th><th>${esc(T('推荐：恢复杠杆', 'Recommended: recovery levers'))}</th><th>${esc(T('推荐：硬件（全部中断 FIT × k）', 'Recommended: hardware (every interruption FIT × k)'))}</th><th class="num">${esc(T('在 k 处：A_op 名义 / 降额 · 逐窗口 P', 'At k: A_op nominal / derated · per-window P'))}</th></tr></thead><tbody>${t1rows}</tbody></table></div>`;
  const v2 = P(200000).p3.arinc;
  const foot1 = T(`¹ HAC-D 最省力方案在 20 万卡只用自动尝试杠杆（今天硬件下 ${pct(v2.final.value)} / ${pct(v2.final.derated)}），但逐窗口 P = ${pP(v2.verification.pAtLeastTarget)}（Wilson ${fmt(v2.verification.wilson[0] * 100, 1)}–${fmt(v2.verification.wilson[1] * 100, 1)} %），不确定；加人工杠杆（努力 +2）后今天硬件下为 ${pct(r2.plan.aOp)} / ${pct(r2.plan.aOpDerated)}，P = ${pP(r2.windowPlan.pAtLeastTarget)}。`, `¹ HAC-D’s least-effort plan at 200k uses the automatic-attempt lever alone (${pct(v2.final.value)} / ${pct(v2.final.derated)} on today’s hardware), but its per-window P = ${pP(v2.verification.pAtLeastTarget)} (Wilson ${fmt(v2.verification.wilson[0] * 100, 1)}–${fmt(v2.verification.wilson[1] * 100, 1)} %) is uncertain; with the manual lever added (effort +2) today’s hardware gives ${pct(r2.plan.aOp)} / ${pct(r2.plan.aOpDerated)} and P = ${pP(r2.windowPlan.pAtLeastTarget)}.`);

  /* ---------------- Table 2: the layer split of the unavailability (points) ---------------- */
  const UT = Object.fromEntries(SIZES.map((n) => [n, uToday(n)])), UA = Object.fromEntries(SIZES.map((n) => [n, uAlloc(n)]));
  const t2row = (key, name, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td class="b">${esc(name)}</td>${SIZES.map((n) => `<td class="num">${esc(f2(UT[n][key]))} → <b>${esc(f2(UA[n][key]))}</b></td>`).join('')}</tr>`;
  const table2 = `<div class="table-wrap"><table class="s2"><thead><tr><th>${esc(T('层级（硬中断）', 'Layer (hard interruptions)'))}</th>${SIZES.map((n) => `<th class="num">${esc(T(`${kN(n)}卡：今天 → 预算`, `${kN(n)}: today → budget`))}</th>`).join('')}</tr></thead><tbody>${LV.map((l) => t2row(l, LN[l])).join('')}${t2row('other', T('其他事件类（隔离、静默）', 'Other event classes (isolation, silent corruption)'))}${t2row('total', T('合计 = 1 − A_op（降额）', 'Total = 1 − A_op (derated)'), 'sum')}</tbody></table></div>`;

  /* ---------------- Table 3: mechanism side at 500k ---------------- */
  const lim = Object.fromEntries(Z5.p3.limits.map((x) => [`${x.id}.${x.key}`, x]));
  const limOf = (id, key, name, unit) => { const x = lim[`${id}.${key}`]; if (!x || !x.binding) return null; return `${name} ${x.dir === 'down' ? '≥' : '≤'} ${unit === 's' ? `${fmt(x.limit)} s` : fmt(x.limit, 2)}`; };
  const limCell = (parts) => { const b = parts.filter(Boolean); return b.length ? b.join(T('；', '; ')) : T('均不约束（降到 0 或 1 h 仍达标）', 'none binding (0 or 1 h still meets the goal)'); };
  const removed = (ids) => { const by = Object.fromEntries(LV.map((l) => [l, ids.reduce((a, id) => a + sh.gains[id].byLevel[l], 0)])); const s = LV.filter((l) => Math.abs(by[l]) >= 0.05).map((l) => `${LN[l]} ${by[l] < 0 ? '−' : ''}${fmt(Math.abs(by[l]), 1)}`); return s.length ? s.join(' · ') : '≈ 0'; };
  const gainA = (ids) => ids.reduce((a, id) => a + sh.gains[id].aOp, 0) * 100;
  const signed = (v) => (Math.abs(v) < 0.005 ? '0.00' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), 2)}`);
  const mp = (id) => MECH[id].parameters, md = (id) => MECH[id].derated;
  const mrows = [
    { name: 'R-REPLAY', ids: ['R-REPLAY'], par: T(`瞬态中断先重执行：成功 ${mp('R-REPLAY').success}、${mp('R-REPLAY').successSeconds} s，失败耗 ${mp('R-REPLAY').failureSeconds} s（降额 ${fmt(md('R-REPLAY').success, 2)}、${md('R-REPLAY').successSeconds} / ${md('R-REPLAY').failureSeconds} s）`, `transient interruptions re-executed first: success ${mp('R-REPLAY').success} in ${mp('R-REPLAY').successSeconds} s, ${mp('R-REPLAY').failureSeconds} s on failure (derated ${fmt(md('R-REPLAY').success, 2)}, ${md('R-REPLAY').successSeconds} / ${md('R-REPLAY').failureSeconds} s)`), lim: limCell([limOf('R-REPLAY', 'success', T('成功', 'success')), limOf('R-REPLAY', 'successSeconds', T('耗时', 'time'), 's')]) },
    { name: 'R-PROCESS', ids: ['R-PROCESS'], par: T(`进程 / Pod 重建：成功 ${mp('R-PROCESS').success}、${mp('R-PROCESS').successSeconds} s，失败耗 ${mp('R-PROCESS').failureSeconds} s（降额 ${fmt(md('R-PROCESS').success, 2)}、${md('R-PROCESS').successSeconds} / ${md('R-PROCESS').failureSeconds} s）`, `process / pod rebuilt: success ${mp('R-PROCESS').success} in ${mp('R-PROCESS').successSeconds} s, ${mp('R-PROCESS').failureSeconds} s on failure (derated ${fmt(md('R-PROCESS').success, 2)}, ${md('R-PROCESS').successSeconds} / ${md('R-PROCESS').failureSeconds} s)`), lim: limCell([limOf('R-PROCESS', 'success', T('成功', 'success')), limOf('R-PROCESS', 'successSeconds', T('耗时', 'time'), 's')]) },
    { name: 'R-ELASTIC', ids: ['R-ELASTIC'], par: T(`${mp('R-ELASTIC').domains} 个 DP 域局部恢复：成功 ${mp('R-ELASTIC').success}、作业同步 ${mp('R-ELASTIC').syncSeconds} s，失败耗 ${mp('R-ELASTIC').failureSeconds} s（降额 ${fmt(md('R-ELASTIC').success, 2)}、${md('R-ELASTIC').syncSeconds} / ${md('R-ELASTIC').failureSeconds} s）`, `local recovery in ${mp('R-ELASTIC').domains} DP domains: success ${mp('R-ELASTIC').success}, job resync ${mp('R-ELASTIC').syncSeconds} s, ${mp('R-ELASTIC').failureSeconds} s on failure (derated ${fmt(md('R-ELASTIC').success, 2)}, ${md('R-ELASTIC').syncSeconds} / ${md('R-ELASTIC').failureSeconds} s)`), lim: limCell([limOf('R-ELASTIC', 'success', T('成功', 'success')), limOf('R-ELASTIC', 'syncSeconds', T('同步', 'resync'), 's'), limOf('R-ELASTIC', 'failureSeconds', T('失败耗时', 'failure time'), 's')]) },
    { name: 'D-SDC + R-SDC', ids: ['D-SDC', 'R-SDC'], par: T(`静默即时检出 ${fmt(mp('D-SDC').coverage * 100)} %、${mp('D-SDC').detectSeconds} s；干净 step 状态恢复 ${mp('R-SDC').recoverSeconds} s + 重算 ${mp('R-SDC').stepSeconds} s（降额 ${fmt(md('D-SDC').coverage * 100)} %、${md('R-SDC').recoverSeconds} s）`, `silent corruption detected at once: ${fmt(mp('D-SDC').coverage * 100)} % in ${mp('D-SDC').detectSeconds} s; clean step-state recovery ${mp('R-SDC').recoverSeconds} s + ${mp('R-SDC').stepSeconds} s redo (derated ${fmt(md('D-SDC').coverage * 100)} %, ${md('R-SDC').recoverSeconds} s)`), lim: T('对 A_op 不敏感；两者保的是有效产出（坏状态不进检查点）', 'A_op insensitive; they protect goodput (no corrupted state in checkpoints)') },
    { name: 'C-FAST', ids: ['C-FAST'], par: T(`检查点：每计算 ${mp('C-FAST').computeSeconds} s 保存 ${mp('C-FAST').saveSeconds} s（原 300 s / 4 s；降额 ${md('C-FAST').saveSeconds} s）`, `checkpoints: save ${mp('C-FAST').saveSeconds} s every ${mp('C-FAST').computeSeconds} s of compute (was 4 s every 300 s; derated ${md('C-FAST').saveSeconds} s)`), lim: T('不影响 A_op；减少回滚损失的有效产出', 'no A_op effect; cuts the goodput lost to rollback') },
  ].map((m) => `<tr><td class="b nw">${esc(m.name)}</td><td>${esc(m.par)}</td><td class="num w">${esc(removed(m.ids))}</td><td class="num">${signed(gainA(m.ids))}</td><td>${esc(m.lim)}</td></tr>`).join('');
  const dec = Z5.p3.decomposition;
  const levRemoved = LV.map((l) => { const a = Z5.today.levels[l], b = dec.leversNominal[l]; const v = a.c + a.iso + a.sdc - (b.c + b.iso + b.sdc); return Math.abs(v) >= 0.05 ? `${LN[l]} ${fmt(v, 1)}` : null; }).filter(Boolean).join(' · ');
  const levGain = (dec.kpiLevers.aOp - Z5.today.aOp) * 100;
  const levRow = `<tr class="sum"><td class="b nw">R-CKPT / R-MANUAL</td><td>${esc(T(`基线：自动恢复 ${R.baseline.recovery.automatic.seconds} s、成功 ${fmt(R.baseline.recovery.automatic.successProbability * 100)} %，人工 ${R.baseline.recovery.manual.seconds / 3600} h。分配：1 万、10 万卡不变；20 万、50 万卡自动尝试 ≤ ${LEVER.auto.limit} s、人工 ≤ ${LEVER.manual.limit / 60} min（降额核验 ${LEVER.auto.limit * R.derate.timeFactor} s、${LEVER.manual.limit * R.derate.timeFactor / 60} min）`, `baseline: automatic recovery ${R.baseline.recovery.automatic.seconds} s at ${fmt(R.baseline.recovery.automatic.successProbability * 100)} %, manual ${R.baseline.recovery.manual.seconds / 3600} h. Allocated: unchanged at 10k and 100k; at 200k and 500k automatic attempt ≤ ${LEVER.auto.limit} s, manual ≤ ${LEVER.manual.limit / 60} min (derated check ${LEVER.auto.limit * R.derate.timeFactor} s, ${LEVER.manual.limit * R.derate.timeFactor / 60} min)`))}</td><td class="num w">${esc(levRemoved)}</td><td class="num">${signed(levGain)}</td><td>${esc(T('自动成功率杠杆在降额后无收益（99.9 − 8 = 91.9 % < 99 %），未选', 'the automatic-success lever gains nothing derated (99.9 − 8 = 91.9 % < 99 %), not chosen'))}</td></tr>`;
  const table3 = `<div class="table-wrap"><table class="s3"><thead><tr><th>${esc(T('机制', 'Mechanism'))}</th><th>${esc(T('分配的参数：名义值即要求（降额核验）', 'Allocated parameters: nominal = requirement (derated check)'))}</th><th class="num">${esc(T(`${kN(MAIN)}卡去掉的暂停（s/h，按层）`, `Pause removed at ${kN(MAIN)} (s/h, by layer)`))}</th><th class="num">${esc(T('A_op 增益（点）', 'A_op gain (points)'))}</th><th>${esc(T(`${kN(MAIN)}卡单项放宽上限`, `Single-parameter limit at ${kN(MAIN)}`))}</th></tr></thead><tbody>${mrows}${levRow}</tbody></table></div>`;

  /* ---------------- Table 4: hardware side, allowed FIT per card ---------------- */
  const t4rows = LV.map((l) => {
    const cur = fitCard(l);
    const me = minERows.filter((h) => h.level === l).map((h) => `${dn(h.id)} × ${fmt(h.factor, 2)}`).join(', ') || T('不动', 'unchanged');
    return `<tr><td class="b">${esc(LN[l])}</td><td class="num">${fmt(cur, 1)}</td>${SIZES.map((n) => { const v = cur * kOf(n); return `<td class="num${kOf(n) < 1 ? ' b' : ''}">${fmt(v, v < 1000 ? 1 : 0)}</td>`; }).join('')}<td class="w">${esc(me)}</td></tr>`;
  }).join('');
  const kRow = `<tr class="sec"><td colspan="2">${esc(T('分配系数 k（> 1 为验收上限，< 1 为交付任务）', 'Allocated factor k (> 1 an acceptance ceiling, < 1 a delivery task)'))}</td>${SIZES.map((n) => `<td class="num">× ${fk(kOf(n))}</td>`).join('')}<td>${esc(T(`努力 ${fmt(minE.effort.hardware, 1)}（ARINC ${fmt(Z5.p3.arinc.effort.hardware, 1)}）`, `effort ${fmt(minE.effort.hardware, 1)} (ARINC ${fmt(Z5.p3.arinc.effort.hardware, 1)})`))}</td></tr>`;
  const table4 = `<div class="table-wrap"><table class="s4"><thead><tr><th>${esc(T('层级', 'Layer'))}</th><th class="num">${esc(T('今天 FIT / 卡', 'Today FIT per card'))}</th>${SIZES.map((n) => `<th class="num">${esc(T(`${kN(n)}卡允许`, `${kN(n)} allowed`))}</th>`).join('')}<th>${esc(T(`替代：${kN(MAIN)}卡最小努力拆分（同样两个杠杆）`, `Alternative at ${kN(MAIN)}: minimum-effort split (same two levers)`))}</th></tr></thead><tbody>${kRow}${t4rows}</tbody></table></div>`;

  /* ---------------- Table 5: acceptance values per instance by topology ---------------- */
  const groups = [
    { l: 'superpod', rows: TOPO.map((t) => ({ name: TN[t], k: S.topologies[t].podNpus })) },
    { l: 'cabinet', rows: [{ name: T('原生 950、UBL128', 'native 950, UBL128'), k: 64 }, { name: '910C · CM384', k: 32 }] },
    { l: 'node', rows: [{ name: T('三种相同', 'all three'), k: 8 }] },
  ];
  const t5rows = groups.map((gr) => gr.rows.map((r, j) => {
    const cur = fitCard(gr.l) * r.k, a5 = cur * k5;
    return `<tr>${j === 0 ? `<td class="b" rowspan="${gr.rows.length}">${esc(LN[gr.l])}</td>` : ''}<td>${esc(r.name)}</td><td class="num">${fmt(r.k)}</td><td class="num">${fmt(cur)}</td>${SIZES.map((n) => `<td class="num${kOf(n) < 1 ? ' b' : ''}">${fmt(cur * kOf(n))}</td>`).join('')}<td class="num">${esc(yrs(1e9 / a5))}</td></tr>`;
  }).join('')).join('');
  const jobRow = `<tr class="sum"><td class="b">${esc(LN.cluster)}</td><td>${esc(T('三种相同（每个作业）', 'all three (per job)'))}</td><td class="num">N</td><td class="num">${fmt(fitCard('cluster'), 1)} × N</td>${SIZES.map((n) => `<td class="num${kOf(n) < 1 ? ' b' : ''}">${fmt(fitCard('cluster') * n * kOf(n) / 1e6, 1)} M</td>`).join('')}<td class="num">${esc(yrs(1e9 / (fitCard('cluster') * MAIN * k5)))}</td></tr>`;
  const table5 = `<div class="table-wrap"><table class="s5"><thead><tr><th>${esc(T('层级', 'Layer'))}</th><th>${esc(T('拓扑', 'Topology'))}</th><th class="num">${esc(T('NPU / 实例', 'NPUs per instance'))}</th><th class="num">${esc(T('今天 FIT / 实例', 'Today FIT per instance'))}</th>${SIZES.map((n) => `<th class="num">${esc(T(`${kN(n)}卡允许`, `${kN(n)} allowed`))}</th>`).join('')}<th class="num">${esc(T(`${kN(MAIN)}卡 MTBF / 实例`, `MTBF per instance at ${kN(MAIN)}`))}</th></tr></thead><tbody>${t5rows}${jobRow}</tbody></table></div>`;

  /* ---------------- Table 6: sensitivity on HAC-D's per-unit FIT ---------------- */
  const recStr = (levers, k) => `${levStr(levers, true)} · ${k >= 1 ? T(`上限 × ${fk(k)}`, `ceiling × ${fk(k)}`) : `× ${fk(k)}`}`;
  const sensRows = [
    { name: T('ReMAP 每卡口径（本页，三种拓扑相同）', 'ReMAP per-card basis (this page, all three topologies)'), fit: FIT_OF('hard'), a: SIZES.map((n) => P(n).today.aOp), p1: x1(MAIN), r2: recStr(r2.levers, r2.k), r5: recStr(r5.levers, r5.k), cls: 'b' },
    ...TOPO.map((t) => { const z = (n) => sens(t, n); return { name: T(`HAC-D 单元口径 · ${TN[t]}`, `HAC-D per-unit · ${TN[t]}`), fit: z(MAIN).fitPerNpu, a: SIZES.map((n) => z(n).aOp), p1: z(MAIN).p1.factor, r2: recStr(z(200000).recommended.levers, z(200000).recommended.k), r5: recStr(z(MAIN).recommended.levers, z(MAIN).recommended.k) }; }),
  ].map((r) => `<tr${r.cls ? ` class="${r.cls}"` : ''}><td>${esc(r.name)}</td><td class="num">${fmt(r.fit, 1)}</td>${r.a.map((v) => `<td class="num${v < R.target ? ' bad' : ''}">${pct(v)}</td>`).join('')}<td class="num">× ${fk(r.p1)}</td><td>${esc(r.r2)}</td><td>${esc(r.r5)}</td></tr>`).join('');
  const table6 = `<div class="table-wrap"><table class="s6"><thead><tr><th>${esc(T('FIT 口径', 'FIT basis'))}</th><th class="num">${esc(T('硬中断 FIT / NPU', 'Hard FIT per NPU'))}</th>${SIZES.map((n) => `<th class="num">${esc(T(`今天 A_op ${kN(n)}`, `Today A_op ${kN(n)}`))}</th>`).join('')}<th class="num">${esc(T(`① ${kN(MAIN)}`, `① ${kN(MAIN)}`))}</th><th>${esc(T(`推荐 ${kN(200000)}卡`, `Recommended ${kN(200000)}`))}</th><th>${esc(T(`推荐 ${kN(MAIN)}卡`, `Recommended ${kN(MAIN)}`))}</th></tr></thead><tbody>${sensRows}</tbody></table></div>`;

  /* ---------------- key findings ---------------- */
  const [a5lo, a5hi] = sensRange((t) => sens(t, MAIN).aOp), [k5lo, k5hi] = sensRange((t) => sens(t, MAIN).recommended.k);
  const pod = (t) => fitCard('superpod') * S.topologies[t].podNpus * k5;
  const desc200 = TOPO.map((t) => { const r = sens(t, 200000).recommended; return `${TN[t]}${T('：', ': ')}${levStr(r.levers, true)}${r.k < 1 ? ` + × ${fk(r.k)}` : ''}`; }).join(T('；', '; '));
  const keys = [
    T(`<b>差距</b>：1 万、10 万卡今天已达标（逐窗口 P = ${pP(P(10000).todayWindow.pAtLeastTarget)} / ${pP(P(100000).todayWindow.pAtLeastTarget)}）；20 万卡差一点（${pct(P(200000).today.aOp)} / 降额 ${pct(P(200000).today.aOpDerated)}，P = ${pP(P(200000).todayWindow.pAtLeastTarget)}）；50 万卡差很多（${pct(Z5.today.aOp)} / ${pct(Z5.today.aOpDerated)}：允许 1.5 个百分点的不可用，降额后今天是 ${fmt(uT5.total, 2)}）。`, `<b>Gap</b>: 10k and 100k already meet the goal (per-window P = ${pP(P(10000).todayWindow.pAtLeastTarget)} / ${pP(P(100000).todayWindow.pAtLeastTarget)}); 200k is just short (${pct(P(200000).today.aOp)} / ${pct(P(200000).today.aOpDerated)} derated, P = ${pP(P(200000).todayWindow.pAtLeastTarget)}); 500k is far off (${pct(Z5.today.aOp)} / ${pct(Z5.today.aOpDerated)}: 1.5 points of unavailability allowed, ${fmt(uT5.total, 2)} today derated).`),
    T(`<b>怎么分</b>：1 万、10 万卡不动，硬件验收上限为今天的 × ${fk(kOf(10000))} / × ${fk(kOf(100000))}；20 万卡把自动尝试压到 60 s、人工恢复压到 30 min，硬件不动（上限 × ${fk(r2.k)}）；50 万卡同样两个杠杆，再加全部中断 FIT × ${fk(k5)}。只靠硬件要 × ${fk(x1(200000))} / × ${fk(x1(MAIN))}（20 万 / 50 万卡），只靠恢复链要把检测、自动、人工时间都乘 ${fmt(P(200000).p2.factor, 2)} / ${fmt(Z5.p2.factor, 2)}。`, `<b>How to split it</b>: leave 10k and 100k as they are, hardware acceptance ceilings × ${fk(kOf(10000))} / × ${fk(kOf(100000))} of today; at 200k bring the automatic attempt down to 60 s and manual recovery to 30 min, hardware unchanged (ceiling × ${fk(r2.k)}); at 500k the same two levers plus every interruption FIT × ${fk(k5)}. Hardware alone would need × ${fk(x1(200000))} / × ${fk(x1(MAIN))} (200k / 500k); the recovery chain alone would need detection, automatic and manual times all × ${fmt(P(200000).p2.factor, 2)} / × ${fmt(Z5.p2.factor, 2)}.`),
    T(`<b>分层</b>：六个参考机制在 50 万卡已贡献 +${fmt(mechTotal, 1)} 个百分点，但只缩短 NPU、节点级（与超节点光链路）的停机；集群级（共享存储、未归因软件）与计算柜级（供电、液冷、管理）的中断 100 % 走全局恢复，今天占各层不可用的 ${fmt(ccShareT * 100)} %，分配后仍占 ${fmt(ccShareA * 100)} %——这两层靠集群级恢复杠杆和自身硬件。`, `<b>Layers</b>: at 500k the six reference mechanisms already add +${fmt(mechTotal, 1)} points, but they only shorten NPU- and node-level downtime (and the SuperPoD optics); cluster-level (shared storage, unattributed software) and cabinet-level (power, cooling, management) interruptions all end in the global recovery and carry ${fmt(ccShareT * 100)} % of the layers’ unavailability today, ${fmt(ccShareA * 100)} % after allocation — those two layers depend on the cluster-level recovery levers and their own hardware.`),
    T(`<b>拓扑</b>：按每卡口径三种拓扑在同一规模的可用度与每卡预算相同；拓扑决定按实例的验收值——${kN(MAIN)}卡时每个超节点自身（UB 交换 + 光链路）允许 ${fmt(pod('native950'))} FIT（原生 950，1,024 卡）、${fmt(pod('ubl128'))}（UBL128，128 卡）、${fmt(pod('cm384'))}（CM384，384 卡）；CM384 每柜 32 卡，计算柜验收值是 950 的一半（表 5）。`, `<b>Topology</b>: on the per-card basis the three topologies share availability and per-card budgets at each size; the topology sets the acceptance values per instance — at ${kN(MAIN)}, a SuperPoD’s own UB switching and optics may have ${fmt(pod('native950'))} FIT (native 950, 1,024 NPUs), ${fmt(pod('ubl128'))} (UBL128, 128) or ${fmt(pod('cm384'))} (CM384, 384); a CM384 cabinet holds 32 NPUs, so its acceptance value is half the 950’s (Table 5).`),
    T(`<b>敏感性</b>：改用 HAC-D 按硬件单元换算的 FIT（拓扑会改变速率），50 万卡今天 A_op 在 ${pct(a5lo)}–${pct(a5hi)} 之间，同样两个杠杆下硬件系数 × ${fk(k5lo)}–× ${fk(k5hi)}；20 万卡的推荐为 ${desc200}（表 6）。`, `<b>Sensitivity</b>: on HAC-D’s per-unit FIT (where the topology changes the rates) A_op at 500k today lies between ${pct(a5lo)} and ${pct(a5hi)} and the hardware factor with the same two levers between × ${fk(k5lo)} and × ${fk(k5hi)}; at 200k the recommendation is ${desc200} (Table 6).`),
  ];

  const sections = [
    `<div class="eyebrow">EYEBROW1</div>
  <h1>${esc(T('昇腾集群可用度目标怎样分配：两种 Atlas 950 拓扑与 910C，1 万–50 万卡', 'Allocating the availability goal on Ascend clusters: two Atlas 950 topologies and the 910C, 10k–500k NPUs'))}</h1>
  <p class="sub">${T(`<b>目标</b>：一个同步训练作业在 30 天窗口上 ${tex(String.raw`A_{\mathrm{op}}\ge A^{\ast}=98.5\,\%`)}（ReMAP 的“运行可用度”），名义参数、全部机制降额与逐窗口都要满足。<b>数据</b>：ReMAP / ai-cluster-reliability 的 54 类事件目录，按卡计（硬中断 ${fmt(FIT_OF('hard'), 1)}、亚健康 ${fmt(FIT_OF('slow'), 1)}、静默 ${fmt(FIT_OF('sdc'), 1)} FIT / 卡）。<b>机制</b>：只用 ReMAP 的六个参考机制（D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST）与基线恢复（检测 95 % 在 10 s、其余 60 s；R-CKPT 自动 180 s、成功 99 %；R-MANUAL 2 h）。<b>方法</b>：HAC-D（第 1 节）。<b>拓扑</b>：下表三种；按卡计的事件率与拓扑无关，三种拓扑的可用度与每卡预算相同，拓扑决定各层实例的大小，即按实例的验收值（第 5 节）。`, `<b>Goal</b>: ${tex(String.raw`A_{\mathrm{op}}\ge A^{\ast}=98.5\,\%`)} (ReMAP’s “operational availability”) for one synchronous training job over a 30-day window, met nominally, with every mechanism derated and window by window. <b>Data</b>: the 54-event catalog of ReMAP / ai-cluster-reliability, per card (hard ${fmt(FIT_OF('hard'), 1)}, sub-health ${fmt(FIT_OF('slow'), 1)}, silent ${fmt(FIT_OF('sdc'), 1)} FIT per card). <b>Mechanisms</b>: only ReMAP’s six reference mechanisms (D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST) on the baseline recovery (detection 95 % in 10 s, the rest 60 s; R-CKPT automatic 180 s at 99 %; R-MANUAL 2 h). <b>Method</b>: HAC-D (Section 1). <b>Topologies</b>: the three below; per-card event rates do not depend on the topology, so the three share availability and per-card budgets, and the topology sets the size of each layer’s instances and with it the acceptance values per instance (Section 5).`)}</p>
  ${table0}
  <div class="callout"><ul>${keys.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h2>${esc(T('1. 分配方法', '1. Allocation method'))}</h2>
  <figure class="chart"><div class="scroll">${figMethod()}</div></figure>
  ${F1}${F2}${F3}${F4}
  <p class="note">${T(`符号：${phiInl} 静默损坏的时间份额；${Finl} 亚健康隔离与静默检出每小时的暂停秒数；${tInl} 第 i 类中断在机制链上的平均暂停，${pInl} 为它在第 r 级（重执行、弹性、进程、全局恢复）结束的概率，全局恢复 = 检测 + 自动尝试 + 1 % × 人工；${cInl} 为第 i 类今天的暂停贡献（s/h）；${kInl} 为 ARINC 的统一硬件系数；eᵢ = 2 为每减半一次的努力。对照 ①“只靠硬件”= 公式 3 的 ARINC，机制不变；对照 ②“只靠恢复链”= 硬件不变，检测、自动尝试、人工三个时间同乘 HAC-D 恢复系数 ${gInl}。推荐方案 = HAC-D 最优策略（在三个杠杆的全部组合上取公式 3 的 E 最小，硬件按 ARINC 补齐）再过公式 4；硬件有余量时，${kInl} 取同时满足降额均值与逐窗口的最大值。目标若是有效产出（ReMAP 的主指标），还需检查点与静默检出机制，本页不展开。`, `Symbols: ${phiInl} silent-corruption time share; ${Finl} pause seconds per hour of sub-health isolation and detected silent corruption; ${tInl} the mean pause of interruption class i down the mechanism chain, ${pInl} its probability of ending at rung r (replay, elastic, process, global recovery), global recovery = detection + automatic attempt + 1 % × manual; ${cInl} class i’s pause contribution today (s/h); ${kInl} the uniform ARINC hardware factor; eᵢ = 2 the effort per halving. Reference ① “hardware alone” = ARINC of formula 3 with the mechanisms unchanged; reference ② “recovery chain alone” = hardware unchanged, detection, automatic-attempt and manual times all × the HAC-D recovery factor ${gInl}. The recommended plan = HAC-D’s optimal strategy (least E of formula 3 over every subset of the three levers, hardware closed by ARINC) passed through formula 4; where the hardware has headroom, ${kInl} is the largest value that keeps both the derated mean and the window check. A goodput goal (ReMAP’s headline metric) also needs the checkpoint and silent-corruption mechanisms and is not covered here.`)}</p>`,
    `<div class="eyebrow">EYEBROW2</div>
  <h2 class="first">${esc(T('2. 各规模的分配结果（图 2、表 1）', '2. The allocation at each size (Figure 2, Table 1)'))}</h2>
  <figure class="chart"><div class="scroll">${figSizes()}</div></figure>
  ${table1}
  <p class="note">${foot1} ${T(`逐窗口 P：400 个 30 天窗口（名义参数、种子 1）中 A_op ≥ 98.5 % 的比例，Wilson 95 % 下界 ≥ 90 % 为“支持”。1 万、10 万卡先受逐窗口约束（降额均值 ${pct(P(10000).recommended.atLimit.aOpDerated)} 时 P 已降到 ${pP(P(10000).recommended.window.pAtLeastTarget)}；两者在约同一总中断率处受约束，N·k ≈ ${fmt(10000 * kOf(10000) / 1e4, 1)} / ${fmt(100000 * kOf(100000) / 1e4, 1)} 万卡当量，所以末列相同）：没有人工杠杆时，一次 2 h 人工恢复就占 30 天窗口的 0.28 个百分点，窗口间波动大；有了 30 min 人工杠杆，20 万、50 万卡在降额均值 98.50 % 处仍 P = 100 %。`, `Per-window P: the share of 400 30-day windows (nominal parameters, seed 1) with A_op ≥ 98.5 %, supported when the Wilson 95 % lower bound ≥ 90 %. At 10k and 100k the window check binds first (P is down to ${pP(P(10000).recommended.window.pAtLeastTarget)} at a derated mean of ${pct(P(10000).recommended.atLimit.aOpDerated)}; both bind at about the same total interruption rate, N·k ≈ ${fmt(10000 * kOf(10000) / 1e3)}k / ${fmt(100000 * kOf(100000) / 1e3)}k card-equivalents, hence the same last column): without the manual lever a single 2-h manual recovery takes 0.28 points of a 30-day window and the windows spread widely; with the 30-min manual lever, 200k and 500k keep P = 100 % at a derated mean of 98.50 %.`)}</p>
  <h2>${esc(T('3. 分层分配（图 3、表 2）', '3. Layer allocation (Figure 3, Table 2)'))}</h2>
  <figure class="chart"><div class="scroll">${figLayers()}</div></figure>
  <h3>${esc(T('表 2：不可用度按层的预算（降额，A_op 的百分点）', 'Table 2: the unavailability budget by layer (derated, points of A_op)'))}</h3>
  ${table2}
  <p class="note">${T(`${Uinl}（公式 2）= 每层硬中断造成的不可用；“其他事件类”= 亚健康隔离、静默检出与漏检 = 1 − A_op − Σ ${Uinl}（不与中断次数相加）。“预算”= 推荐设计在其硬件系数 k 处（表 1），每列合计即约束值：降额均值约束时为 1.50（20 万、50 万卡），逐窗口约束时约 ${f2(UA[10000].total)}（1 万、10 万卡）。1 个百分点 ≈ 每小时 36 s 暂停。图 3 的“结束于”按 ${pInl} 以各类中断率加权：集群级与计算柜级的事件没有参考机制梯级，全部走全局恢复。`, `${Uinl} (formula 2) = the unavailability from each layer’s hard interruptions; “other event classes” = isolation of sub-healthy units, detected and undetected silent corruption = 1 − A_op − Σ ${Uinl} (never added to interruption counts). “Budget” = the recommended design at its hardware factor k (Table 1); each column’s total is the binding value: 1.50 where the derated mean binds (200k, 500k), about ${f2(UA[10000].total)} where the window check binds (10k, 100k). One point ≈ 36 s of pause per hour. “Ends at” in Figure 3 is ${pInl} weighted by the classes’ interruption rates: cluster- and cabinet-level events have no reference-mechanism rung and all go through the global recovery.`)}</p>`,
    `<div class="eyebrow">EYEBROW3</div>
  <h2 class="first">${esc(T(`4. 详细结果：机制侧与硬件侧（图 4、表 3–4）`, '4. Detailed result: the mechanism side and the hardware side (Figure 4, Tables 3–4)'))}</h2>
  <figure class="chart"><div class="scroll">${figLedger()}</div></figure>
  <h3>${esc(T('表 3：机制侧——参考机制与恢复杠杆', 'Table 3: mechanism side — reference mechanisms and recovery levers'))}</h3>
  ${table3}
  ${FS}
  <p class="note">${T(`去掉的暂停（每集群·小时的暂停秒数）与 A_op 增益：${kN(MAIN)}卡、今天的恢复链、名义参数，六个机制在 64 个组合上的精确 Shapley 值 φₘ（上式；按层可加，合计 = 全开 − 全关 = +${fmt(mechTotal, 2)} 点）；D-SDC 单独会增加回滚暂停，与 R-SDC 合起来约为 0。杠杆行 = 两个杠杆一起的差值。单项放宽上限：推荐设计上其余参数取名义值，这一个参数最多能差到多少仍达标（引擎二分）；名义设计在降额约束下留有约 0.6 个百分点余量，所以上限宽。`, `Pause removed (pause seconds per cluster-hour) and A_op gain: ${kN(MAIN)}, today’s recovery chain, nominal parameters, the exact Shapley value φₘ of the six mechanisms over the 64 coalitions (above; additive over layers; the total = all on − all off = +${fmt(mechTotal, 2)} points); D-SDC alone adds rollback pauses and nets to about 0 with R-SDC. The lever row = the difference made by the two levers together. Single-parameter limit: on the recommended design, with the other parameters nominal, how far this one may fall before the goal breaks (bisection on the engine); the nominal design keeps ≈ 0.6 points of margin under the derated constraint, hence the wide limits.`)}</p>
  <h3>${esc(T('表 4：硬件侧——每层允许的 FIT / 卡（ARINC：全部中断类同乘 k）', 'Table 4: hardware side — allowed FIT per card by layer (ARINC: every interruption class × k)'))}</h3>
  ${table4}
  <p class="note">${T(`允许 FIT / 卡 = 今天 × k，是交付与验收值：粗体（k &lt; 1）要比今天好，其余为上限（超出则不达标）。20 万卡的上限高于 10 万卡，因为 20 万卡用了两个恢复杠杆。替代拆分（公式 3 的最小努力，每减半努力 2、下限 × 0.05）以更少的总努力达到同一目标：任务集中在 UNKNOWN、POWER、MGMT、STORAGE，其余 ${18 - minERows.length} 类不动。`, `Allowed FIT per card = today × k, a delivery and acceptance value: bold cells (k &lt; 1) must beat today, the others are ceilings (exceeding them misses the goal). The 200k ceilings exceed the 100k ones because the 200k design uses the two recovery levers. The alternative split (minimum effort of formula 3, effort 2 per halving, floor × 0.05) reaches the same goal with less total effort: the tasks concentrate on UNKNOWN, POWER, MGMT and STORAGE, the other ${18 - minERows.length} classes stay unchanged.`)}</p>
  <h2>${esc(T('5. 按拓扑的验收值（表 5）', '5. Acceptance values by topology (Table 5)'))}</h2>
  ${table5}
  <p class="note">${T(`每个实例允许的 FIT：${F5}（ReMAP 口径，暴露量只乘一次；n_inst = 实例的卡数）；${F6}（该层硬中断，按实例·小时）。超节点级 = FABRIC + OPT（UB 交换与光链路），计算柜级 = 供电、液冷、管理、框内 IO，节点级 = NIC、CPU、DDR、SSD；NPU 级每卡即表 4。集群级按作业计，随规模变化。`, `Allowed FIT per instance: ${F5} (ReMAP basis, exposure counted once; n_inst = NPUs in the instance); ${F6} (the layer’s hard interruptions, per instance-hour). SuperPoD layer = FABRIC + OPT (UB switching and optics), cabinet layer = power, cooling, management, in-chassis IO, node layer = NIC, CPU, DDR, SSD; the NPU layer per card is Table 4. The cluster layer counts per job and grows with the size.`)}</p>`,
    `<div class="eyebrow">EYEBROW4</div>
  <h2 class="first">${esc(T('6. 敏感性：HAC-D 按硬件单元换算的 FIT（表 6）', '6. Sensitivity: HAC-D’s per-unit FIT (Table 6)'))}</h2>
  ${table6}
  <p class="note">${T('HAC-D 单元口径：把目录 FIT 按 CloudMatrix384 几何换算到每个硬件单元（NPU、节点、柜、UB 交换芯片、光链路），再乘各拓扑自己的单元数，所以每 NPU 速率随拓扑变化（置信度 assumed）；机制、杠杆、ARINC 与逐窗口规则同本页。', 'HAC-D per-unit basis: the catalog FIT converted to each hardware unit (NPU, node, cabinet, UB switch chip, optical link) through the CloudMatrix384 geometry and multiplied by each topology’s own unit counts, so the rate per NPU depends on the topology (confidence: assumed); mechanisms, levers, ARINC and the window rule as on this page.')}</p>
  <ul class="scale">
    <li>${T('<b>怎么用</b>：按规模从表 1 取方案；用表 3 给机制与恢复流程定参数（名义值即要求，降额后仍须达标）；用表 4、表 5 给供应商与集成方下按卡、节点、柜、超节点的验收值；上线后用实测 FIT 与恢复时间回写重算。', '<b>How to use it</b>: take the plan for the size from Table 1; set the mechanism and recovery-process parameters from Table 3 (nominal values are requirements and must still hold derated); give suppliers and integrators their acceptance values per card, node, cabinet and SuperPoD from Tables 4 and 5; after deployment write the measured FIT and recovery times back and rerun.')}</li>
    <li>${T(`<b>边界</b>：FIT 是 GPU 机群的类比先验（每卡），不是 910C / 950 实测；机制参数是 ReMAP 的名义目标；FABRIC / OPT 归超节点级是对 UB 域的判断；目标是 A_op 不是有效产出——推荐设计的有效产出在 20 万卡约 ${fmt(r2.atLimit.delivered * 100)} %、50 万卡约 ${fmt(r5.atLimit.delivered * 100)} %。与 ATLAS950_LEVEL_ALLOCATION 的差别：20 万卡加了人工杠杆（那里只有自动杠杆，逐窗口不确定），上限因此从 × ${fk(P(200000).p3.arinc.hardware.slackFactor)} 变为 × ${fk(r2.k)}；1 万、10 万卡的上限按逐窗口收紧。`, `<b>Limits</b>: the FIT values are an analogue prior from GPU fleets (per card), not 910C / 950 measurements; mechanism parameters are ReMAP’s nominal targets; FABRIC / OPT on the SuperPoD layer is a judgement for the UB domain; the goal is A_op, not goodput — the recommended designs deliver about ${fmt(r2.atLimit.delivered * 100)} % goodput at 200k and ${fmt(r5.atLimit.delivered * 100)} % at 500k. Differences from ATLAS950_LEVEL_ALLOCATION: 200k adds the manual lever (there the automatic lever alone, window check uncertain), so its ceiling moves from × ${fk(P(200000).p3.arinc.hardware.slackFactor)} to × ${fk(r2.k)}; the 10k and 100k ceilings are tightened by the window check.`)}</li>
  </ul>
  <footer>${T(`本页汇总并取代以下报告的分配部分：ATLAS950_LEVEL_ALLOCATION、ARCH_ALLOCATION_98P5_500K、ASCEND950_SCALING_RELIABILITY、ASCEND910C_SCALING_RELIABILITY、ALLOCATION_METHODS_SUMMARY、ALLOCATION_STRATEGY_V4、MTBF_MTTR_TOPDOWN；数据核对见 HACD_REMAP_COMPARISON，拓扑细节见 ASCEND_CLUSTER_ARCHITECTURE。复现：<code>node --import tsx scripts/a950-level-allocation.ts</code>、<code>node --import tsx scripts/allocation-summary.ts</code> → <code>node scripts/build-ascend-availability-allocation.mjs</code>（HAC-D v4.3 引擎：referenceCatalog、allocateStrategy、scaleRecovery、窗口账本 ${R.trials} 窗、种子 1；推荐规则在 <code>scripts/scaling-common.ts</code> 的 recommendDesign；公式由 KaTeX 在构建时排版）。`, `This page summarises and replaces the allocation parts of ATLAS950_LEVEL_ALLOCATION, ARCH_ALLOCATION_98P5_500K, ASCEND950_SCALING_RELIABILITY, ASCEND910C_SCALING_RELIABILITY, ALLOCATION_METHODS_SUMMARY, ALLOCATION_STRATEGY_V4 and MTBF_MTTR_TOPDOWN; data checks in HACD_REMAP_COMPARISON, topology details in ASCEND_CLUSTER_ARCHITECTURE. Reproduce: <code>node --import tsx scripts/a950-level-allocation.ts</code>, <code>node --import tsx scripts/allocation-summary.ts</code> → <code>node scripts/build-ascend-availability-allocation.mjs</code> (HAC-D v4.3 engine: referenceCatalog, allocateStrategy, scaleRecovery, window ledger ${R.trials} windows, seed 1; the recommendation rule is recommendDesign in <code>scripts/scaling-common.ts</code>; formulas typeset at build time with KaTeX).`)}</footer>`,
  ];
  const n = sections.length;
  const eyebrow = (i) => esc(T(`HAC-D · 昇腾可用度分配总览 · ${DATE} · 第 ${i} / ${n} 页`, `HAC-D · Ascend availability allocation · ${DATE} · page ${i} / ${n}`));
  return sections.map((s, i) => `<section class="page">\n  ${s.replace(`EYEBROW${i + 1}`, eyebrow(i + 1))}\n</section>`).join('\n');
}

const zhBody = body('zh'), enBody = body('en');
const unexpected = [...usedFonts].filter((f) => f !== 'mathnormal' && f !== 'mathcal');
if (unexpected.length) throw new Error(`KaTeX output needs fonts that are not embedded: ${unexpected.join(', ')}`);

const css = BASE_CSS + `
  [data-l] { display: block; }
  html[data-lang="zh"] [data-l="en"], html[data-lang="en"] [data-l="zh"] { display: none !important; }
  #lang { position: fixed; top: 10px; right: 12px; z-index: 20; font: 600 12px/1 "IBM Plex Sans", system-ui, sans-serif; color: var(--ink); background: var(--surface); border: 1px solid var(--rule); border-radius: 999px; padding: 7px 12px; cursor: pointer; }
  #lang:hover { border-color: var(--accent); }
  h2.first, h3.first { border-top: none; padding-top: 0; margin-top: 6px; }
  .katex { font-size: 1.08em; } .katex-display { margin: 0.2em 0; text-align: left; } .katex-display > .katex { text-align: left; }
  .math-block { background: var(--surface-2); border-radius: 6px; padding: 3px 10px; margin: 5px 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .math-block + .math-block { margin-top: -5px; border-top-left-radius: 0; border-top-right-radius: 0; }
  .math-block:has(+ .math-block) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .katex .cjk_fallback { font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
  p.note .katex, p.sub .katex { font-size: 1.02em; }
  table.s0 td:nth-child(2) { min-width: 20em; } table.s0 td:first-child { min-width: 11em; } table.s0 th:last-child { min-width: 15em; }
  table.s1 td:nth-child(6), table.s1 td:nth-child(7) { min-width: 11em; } table.s1 th.num { white-space: normal; }
  table.s2 th.num { white-space: normal; } table.s2 td:first-child { min-width: 13em; }
  table.s3 td:nth-child(2) { min-width: 20em; } table.s3 td:last-child { min-width: 13em; } table.s3 td.num.w { min-width: 10em; } table.s3 th.num { white-space: normal; }
  table.s4 td.w { min-width: 15em; } table.s4 th.num, table.s5 th.num, table.s6 th.num { white-space: normal; }
  table.s5 td:nth-child(2) { min-width: 8em; } table.s6 td:first-child { min-width: 14em; } table.s6 td:nth-last-child(-n+2) { min-width: 10em; }
  sup { font-size: 0.75em; line-height: 0; }
  @media screen and (max-width: 760px) { #lang { top: 6px; right: 6px; } }
  @media print { #lang { display: none !important; } table.s3, table.s4 { font-size: 6.7px; } .katex { font-size: 1.02em; } .math-block { padding: 1px 6px; margin: 2px 0; overflow: visible; } .math-block + .math-block { margin-top: -2px; } .katex-display { margin: 0.12em 0; } }
`;
const script = `<script>
(() => {
  const root = document.documentElement, btn = document.getElementById('lang');
  const set = (l) => { root.setAttribute('data-lang', l); root.lang = l === 'zh' ? 'zh-CN' : 'en'; btn.textContent = l === 'zh' ? 'English' : '中文'; try { localStorage.setItem('hacd-alloc-lang', l); } catch (e) {} };
  let l = 'zh'; try { l = localStorage.getItem('hacd-alloc-lang') || 'zh'; } catch (e) {}
  set(l === 'en' ? 'en' : 'zh');
  btn.addEventListener('click', () => set(root.getAttribute('data-lang') === 'zh' ? 'en' : 'zh'));
  const tip = document.getElementById('tip');
  const clean = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const show = (el, x, y) => { const p = el.getAttribute('data-tip').split('|'); tip.innerHTML = '<b>' + clean(p[0]) + '</b>' + p.slice(1).map(clean).join('<br>'); tip.style.display = 'block'; const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px'; tip.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 14)) + 'px'; };
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    el.addEventListener('click', (e) => { show(el, e.clientX, e.clientY); e.stopPropagation(); });
  });
  document.addEventListener('click', () => { tip.style.display = 'none'; });
})();
</script>`;
const html = `<!doctype html>
<html lang="zh-CN" data-lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>昇腾可用度分配总览 · Ascend availability allocation</title>
<meta name="description" content="A_op ≥ 98.5 % 在 1 万–50 万卡上的分配：原生 Atlas 950、UBL128、910C CloudMatrix384；HAC-D 方法、分层分配与详细结果（ReMAP 每卡 FIT、六个参考机制）。Allocating A_op ≥ 98.5 % at 10k–500k NPUs on native Atlas 950, UBL128 and 910C CloudMatrix384: HAC-D method, layer allocation and detailed results.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${KATEX_CSS}</style>
<style>${css}</style>
</head>
<body>
<button id="lang" type="button" aria-label="Switch language / 切换语言">English</button>
<main>
<div data-l="zh">
${zhBody}
</div>
<div data-l="en">
${enBody}
</div>
</main>
<div id="tip" role="tooltip"></div>
${script}
</body>
</html>
`;
writeFileSync('docs/ASCEND_AVAILABILITY_ALLOCATION.html', html);
console.log(`written docs/ASCEND_AVAILABILITY_ALLOCATION.html (${(html.length / 1024).toFixed(0)} kB; KaTeX fonts embedded: ${KATEX_FONTS.map((f) => f[2]).join(', ')})`);
