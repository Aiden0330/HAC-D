#!/usr/bin/env node
/**
 * Build docs/MTBF_MTTR_TOPDOWN.{en,zh}.html (three printed A4 pages, three inline SVG figures with tooltips and table views):
 * the top-down availability formula in MTBF / MTTR terms, the MTBF and MTTR each built-in scale needs, the MTBF allocated to the
 * hardware units and the MTTR allocated to the mechanisms with their parameter values.
 * Input: docs/mtbf-mttr-topdown/results.json (scripts/mtbf-mttr-topdown.ts).
 * Usage: node scripts/build-mtbf-mttr-topdown.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const D = JSON.parse(readFileSync('docs/mtbf-mttr-topdown/results.json', 'utf8'));
const OUT_DIR = 'docs/mtbf-mttr-topdown';
mkdirSync(OUT_DIR, { recursive: true });
const gen = new Date(D.generated).toLocaleDateString('sv-SE');
const SIZES = D.sizes;
const TPL = 'a3-ub384';
const A3 = D.templates[TPL];
const Z = (n, t = TPL) => D.templates[t].sizes[n];
const TARGET = A3.target;
const N_MAX = SIZES[SIZES.length - 1];
const pct = (x, d = 3) => (x * 100).toFixed(d);
const num = (x, d = 2) => Number(x).toFixed(d);
const int = (x) => Math.round(x).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sig = (x, d = 3) => (x >= 100 ? int(x) : Number(x.toPrecision(d)).toString());
const yrs = (h) => h / 8760;
const fy = (y) => (y >= 1000 ? int(y) : y >= 100 ? y.toFixed(0) : y >= 10 ? y.toFixed(1) : y.toFixed(2));
const fitf = (x) => (x >= 1000 ? int(x) : x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const UNIT_ORDER = ['npu', 'job', 'node', 'cpu', 'cabinet', 'ub-switch', 'ub-link', 'roce-switch', 'roce-link'];
// MTTR categories of the figure (fine split in the table)
const CAT = (k) => (k === 'detect' ? 'detect' : k === 'globalAuto' ? 'auto' : k === 'globalManual' ? 'manual' : 'local');
const budgetOf = (k) => 3600 * ((1 - k.phi) / TARGET - 1) - k.F;

function build(lang) {
  const zh = lang === 'zh';
  const T = (z, e) => (zh ? z : e);
  const textW = (s) => Array.from(String(s)).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.4), 0);
  const fmtMtbf = (h) => (h < 1 ? `${num(h, 3)} h (${num(h * 60, 1)} min)` : `${sig(h)} h`);
  const unitName = (u) => ({ npu: T('NPU（含 HBM、片上网口）', 'NPU (incl. HBM, on-die ports)'), job: T('作业级服务（按 NPU 计）', 'Job-level services (per NPU)'), node: T('计算节点（DDR、SSD、板级 IO、BMC）', 'Compute node (DDR, SSD, board IO, BMC)'), cpu: T('鲲鹏 CPU', 'Kunpeng CPU'), cabinet: T('计算柜（供电、液冷）', 'Compute cabinet (power, cooling)'), 'ub-switch': T('UB 交换芯片', 'UB switch chip'), 'ub-link': T('UB 光链路', 'UB optical link'), 'roce-switch': T('RDMA / RoCE 交换机', 'RDMA / RoCE switch'), 'roce-link': T('RDMA / RoCE 光链路', 'RDMA / RoCE optical link') })[u] ?? u;
  const otherName = (id) => ({ isolation: T('亚健康单元隔离', 'isolation of detected sub-healthy units'), sdcDetected: T('已检出的静默错误', 'detected silent corruption'), falseAlarm: T('预测误报迁移', 'predictor false alarms') })[id];

  const FONT = zh ? 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' : 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const STYLE = `
svg.viz { --on-detect:#ffffff; --on-local:#0b0b0b; --on-auto:#0b0b0b; --on-manual:#0b0b0b; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --band:#e9e7e1; --ok:#eef4ec; --acc:#2f4fb8; --box:#f2f1ec; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) svg.viz { --on-detect:#ffffff; --on-local:#ffffff; --on-auto:#ffffff; --on-manual:#ffffff; --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --band:#34342f; --ok:#1f2a20; --acc:#9cb0ef; --box:#242421; } }
:root[data-theme="dark"] svg.viz { --on-detect:#ffffff; --on-local:#ffffff; --on-auto:#ffffff; --on-manual:#ffffff; --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --band:#34342f; --ok:#1f2a20; --acc:#9cb0ef; --box:#242421; }
svg.viz text { fill: var(--ink); font-size: 12px; } svg.viz .t2 { fill: var(--ink2); font-size: 11.5px; } svg.viz .m { fill: var(--muted); font-size: 11px; } svg.viz .tick { font-variant-numeric: tabular-nums; } svg.viz .ttl { font-size: 13px; font-weight: 600; } svg.viz .lab { font-size: 11px; } svg.viz .b { font-weight: 600; }
svg.viz .grid { stroke: var(--grid); stroke-width: 1; } svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .hit { fill: transparent; pointer-events: all; }
svg.viz .bx { fill: var(--box); stroke: var(--axis); } svg.viz .bxa { fill: var(--box); stroke: var(--acc); stroke-width: 1.5; } svg.viz .arr { stroke: var(--ink2); stroke-width: 1.3; fill: none; } svg.viz .arrh { fill: var(--ink2); }
svg.viz .dash { stroke: var(--ink2); stroke-width: 1.2; stroke-dasharray: 5 4; fill: none; }
`;
  const svgOpen = (id, W, H, label) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}"><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
  const legendSw = (x, y, items) => { let off = 0; return items.map((it) => { const lx = x + off; off += 24 + textW(it.name) + 18; if (it.kind === 'line') return `<line x1="${lx}" x2="${lx + 16}" y1="${y}" y2="${y}" stroke="${it.color}" stroke-width="2"${it.dash ? ' stroke-dasharray="5 4"' : ''}/><text x="${lx + 22}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; if (it.kind === 'dot') return `<circle cx="${lx + 6}" cy="${y}" r="5" fill="${it.color}" stroke="var(--surface)" stroke-width="2"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; if (it.kind === 'band') return `<rect x="${lx}" y="${y - 6}" width="16" height="12" fill="var(--band)" stroke="var(--axis)"/><text x="${lx + 22}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; return `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="${it.color}"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join(''); };
  const hbar = (x, y, w, h, fill, tip, rounded = true) => {
    if (w <= 0.3) return '';
    const r = rounded ? Math.min(4, w / 2, h / 2) : 0;
    const d = r ? `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x}Z` : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    return `<path d="${d}" fill="${fill}"${tip ? ` data-tip="${esc(tip)}"` : ''}/>`;
  };

  /* ---------- figure 0: the top-down tree ---------- */
  function tree() {
    const W = 960, H = 300;
    let g = svgOpen('fig-tree', W, H, T('自顶向下分解', 'Top-down decomposition')) + `<text x="14" y="20" class="ttl">${esc(T('图 0 · 自顶向下：目标 → 各事件类的 MTBF / MTTR → 硬件单元的 MTBF 与机制的 MTTR', 'Figure 0 · Top-down: target → MTBF / MTTR of each event class → MTBF of the hardware units and MTTR of the mechanisms'))}</text>`;
    const box = (x, y, w, h, t, lines, acc) => { let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="${acc ? 'bxa' : 'bx'}"/><text x="${x + 10}" y="${y + 18}" class="b">${esc(t)}</text>`; lines.forEach((l, i) => { s += `<text x="${x + 10}" y="${y + 37 + i * 17}" class="t2">${esc(l)}</text>`; }); return s; };
    const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2 - 6}" class="arr"/><path d="M${x2 - 5} ${y2 - 8} L${x2} ${y2} L${x2 + 5} ${y2 - 8} Z" class="arrh"/>`;
    g += box(280, 34, 400, 58, T('作业可用度 A_op（30 天窗口）', 'Job availability A_op (30-day window)'), [`A_op = (1 − φ_SDC) / (1 + MTTR_hw/MTBF_hw + Σₖ MTTRₖ/MTBFₖ)`], true);
    g += box(14, 122, 300, 58, T('硬件中断：MTBF_hw', 'Hardware interruptions: MTBF_hw'), [`1/MTBF_hw = Σᵤ nᵤ(N) / MTBFᵤ`]);
    g += box(330, 122, 300, 58, T('硬件中断：MTTR_hw', 'Hardware interruptions: MTTR_hw'), [`Σᵢ (λᵢ/λ_hw) · Σ_path P · T(path)`]);
    g += box(646, 122, 300, 58, T('其他事件类（各自 MTBFₖ、MTTRₖ）', 'Other event classes (own MTBFₖ, MTTRₖ)'), [T('隔离 · 已检出静默错误 · 误报；φ_SDC', 'isolation · detected SDC · false alarms; φ_SDC')]);
    g += box(14, 210, 300, 76, T('硬件单元 MTBFᵤ = 10⁹ / FITᵤ', 'Hardware unit MTBFᵤ = 10⁹ / FITᵤ'), [T('NPU · 节点 · CPU · 机柜 · 作业级服务', 'NPU · node · CPU · cabinet · job services'), T('UB / RoCE 交换芯片与光链路', 'UB / RoCE switches and optical links')]);
    g += box(330, 210, 300, 76, T('机制与恢复参数', 'Mechanisms and recovery parameters'), [T('检测 t_det = c·t_fast + (1 − c)·t_timeout', 'detection t_det = c·t_fast + (1 − c)·t_timeout'), T('局部梯级：网络切换 · 重执行 · 弹性 · 进程', 'local rungs: netfail · replay · elastic · process'), T('全局恢复 t_auto + (1 − s)·t_manual', 'global recovery t_auto + (1 − s)·t_manual')]);
    g += box(646, 210, 300, 76, T('要求（降额设计约束）', 'Requirement (derated design binds)'), ['MTTR_hw [s] / MTBF_hw [h] ≤ B', 'B = 3600·((1 − φ)/A* − 1) − F', T('F = Σₖ 3600·MTTRₖ/MTBFₖ（秒/小时）', 'F = Σₖ 3600·MTTRₖ/MTBFₖ (s/h)')]);
    g += arrow(420, 92, 164, 122) + arrow(480, 92, 480, 122) + arrow(540, 92, 796, 122) + arrow(164, 180, 164, 210) + arrow(480, 180, 480, 210) + arrow(796, 180, 796, 210);
    return g + '</svg>';
  }

  /* ---------- figure 1: the MTBF–MTTR plane ---------- */
  function plane() {
    const W = 960, H = 430, L = 70, Rm = 200, Tp = 56, Bm = 48;
    const pw = W - L - Rm, ph = H - Tp - Bm;
    const x0 = Math.log10(0.3), x1 = Math.log10(60), y0 = Math.log10(10), y1 = Math.log10(3000);
    const xs = (h) => L + ((Math.log10(h) - x0) / (x1 - x0)) * pw;
    const ys = (s) => Tp + ph - ((Math.log10(s) - y0) / (y1 - y0)) * ph;
    const Bs = SIZES.map((n) => Z(n).required.B);
    const bLo = Math.min(...Bs), bHi = Math.max(...Bs);
    let g = svgOpen('fig-plane', W, H, T('MTBF–MTTR 平面上的要求与设计点', 'Requirement and design points in the MTBF–MTTR plane')) + `<text x="14" y="20" class="ttl">${esc(T(`图 1 · ${'A3 · CloudMatrix384'}：要求线 MTTR_hw = B·MTBF_hw 与各规模的设计点（降额值，A_op ≥ ${pct(TARGET, 1)} %）`, `Figure 1 · A3 · CloudMatrix384: the requirement MTTR_hw = B·MTBF_hw and the design points per scale (derated values, A_op ≥ ${pct(TARGET, 1)} %)`))}</text>`;
    g += legendSw(14, 42, [{ name: T('现状（默认六项机制）', 'today (six default mechanisms)'), color: 'var(--s1)', kind: 'dot' }, { name: T('推荐分配（v4 最优）', 'recommended split (v4 optimal)'), color: 'var(--s2)', kind: 'dot' }, { name: T('仅硬件（v4 MTTF 优先）', 'hardware only (v4 MTTF-first)'), color: 'var(--s3)', kind: 'dot' }, { name: T(`要求带 B = ${num(bLo, 1)}–${num(bHi, 1)} s/h`, `requirement band B = ${num(bLo, 1)}–${num(bHi, 1)} s/h`), kind: 'band' }]);
    // feasible side shading and the band
    const xa = 0.3, xb = 60;
    g += `<path d="M${xs(xa)} ${ys(Math.max(10, bLo * xa))} L${xs(xb)} ${ys(Math.min(3000, bLo * xb))} L${xs(xb)} ${ys(10)} L${xs(xa)} ${ys(10)} Z" fill="var(--ok)"/>`;
    const lineAt = (B) => { const xA = Math.max(xa, 10 / B), xB = Math.min(xb, 3000 / B); return [[xs(xA), ys(B * xA)], [xs(xB), ys(B * xB)]]; };
    const [p1, p2] = lineAt(bLo), [q1, q2] = lineAt(bHi);
    g += `<path d="M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]} L${q2[0]} ${q2[1]} L${q1[0]} ${q1[1]} Z" fill="var(--band)" stroke="var(--axis)"/>`;
    for (const v of [0.3, 1, 3, 10, 30, 60]) g += `<line x1="${xs(v)}" x2="${xs(v)}" y1="${Tp}" y2="${Tp + ph}" class="grid"/><text x="${xs(v)}" y="${Tp + ph + 16}" text-anchor="middle" class="m tick">${v}</text>`;
    for (const v of [10, 30, 100, 300, 1000, 3000]) g += `<line x1="${L}" x2="${L + pw}" y1="${ys(v)}" y2="${ys(v)}" class="grid"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end" class="m tick">${v}</text>`;
    g += `<text x="${L + pw / 2}" y="${H - 10}" text-anchor="middle" class="t2">${esc(T('硬件中断 MTBF_hw（小时，对数）', 'hardware-interruption MTBF_hw (hours, log)'))}</text><text x="${-(Tp + ph / 2)}" y="18" class="t2" transform="rotate(-90)" text-anchor="middle">${esc(T('MTTR_hw（秒，对数）', 'MTTR_hw (seconds, log)'))}</text>`;
    g += `<text x="${xs(1.2)}" y="${ys(18)}" class="m">${esc(T('达标区（线下）', 'meets the target (below the band)'))}</text><text x="${xs(0.35)}" y="${ys(1500)}" class="m">${esc(T('不达标', 'misses the target'))}</text>`;
    // design points
    const pt = (h, s, c, tip) => `<circle cx="${xs(h)}" cy="${ys(s)}" r="5.5" fill="${c}" stroke="var(--surface)" stroke-width="2" data-tip="${esc(tip)}"/>`;
    const arr = (h1, s1, h2, s2) => { const xA = xs(h1), yA = ys(s1), xB = xs(h2), yB = ys(s2); const dx = xB - xA, dy = yB - yA, d = Math.hypot(dx, dy); if (d < 14) return ''; const ux = dx / d, uy = dy / d; const xe = xB - ux * 8, ye = yB - uy * 8; return `<line x1="${xA + ux * 7}" y1="${yA + uy * 7}" x2="${xe}" y2="${ye}" class="arr"/><path d="M${xe + uy * 4} ${ye - ux * 4} L${xB - ux * 6} ${yB - uy * 6} L${xe - uy * 4} ${ye + ux * 4} Z" class="arrh"/>`; };
    const lab = (n) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1000}k`);
    let right = '';
    const designsList = [];
    for (const n of SIZES) {
      const z = Z(n), kd = z.today.der;
      const tipToday = `${int(n)} NPU · ${T('现状', 'today')}\nMTBF_hw ${fmtMtbf(kd.mtbfHwH)} · MTTR_hw ${num(kd.mttrS, 1)} s\n${T('比值', 'ratio')} ${num(kd.mttrS / kd.mtbfHwH, 1)} s/h vs B ${num(z.required.B, 1)} s/h · A_op ${pct(kd.aOp)} %`;
      if (z.optimal.mechanisms.length + z.optimal.levers.length + z.optimal.hwRows.length) {
        const o = z.optimal.der, hw = z.hardwareOnly.der;
        g += arr(kd.mtbfHwH, kd.mttrS, o.mtbfHwH, o.mttrS) + arr(kd.mtbfHwH, kd.mttrS, hw.mtbfHwH, hw.mttrS);
        const Bo = budgetOf(o);
        // the recommended design's own budget line (its levers also shorten the isolation pauses)
        const segA = o.mtbfHwH / 1.8, segB = o.mtbfHwH * 1.8;
        g += `<line x1="${xs(segA)}" y1="${ys(Bo * segA)}" x2="${xs(segB)}" y2="${ys(Bo * segB)}" class="dash"/>`;
        g += pt(o.mtbfHwH, o.mttrS, 'var(--s2)', `${int(n)} NPU · ${T('推荐分配', 'recommended split')}: ${[...z.optimal.mechanisms, ...z.optimal.levers].join(' + ') || '—'}${z.optimal.hwRows.length ? T(` + ${z.optimal.hwRows.length} 类硬件`, ` + ${z.optimal.hwRows.length} hardware classes`) : ''}\nMTBF_hw ${fmtMtbf(o.mtbfHwH)} · MTTR_hw ${num(o.mttrS, 1)} s\n${T('自身预算', 'own budget')} B′ ${num(Bo, 1)} s/h · A_op ${pct(o.aOp)} %`);
        g += pt(hw.mtbfHwH, hw.mttrS, 'var(--s3)', `${int(n)} NPU · ${T('仅硬件', 'hardware only')}\nMTBF_hw ${fmtMtbf(hw.mtbfHwH)} · MTTR_hw ${num(hw.mttrS, 1)} s · A_op ${pct(hw.aOp)} %`);
        designsList.push({ n, o, hw });
      }
      g += pt(kd.mtbfHwH, kd.mttrS, 'var(--s1)', tipToday) + `<text x="${xs(kd.mtbfHwH)}" y="${ys(kd.mttrS) - 10}" text-anchor="middle" class="lab b">${lab(n)}</text>`;
    }
    // right-hand list: every design point with its numbers (the points themselves carry no labels where they crowd)
    let ry = Tp + 8;
    const item = (color, txt, sub) => { const s0 = `<circle cx="${W - Rm + 20}" cy="${ry - 4}" r="4.5" fill="${color}"/><text x="${W - Rm + 30}" y="${ry}" class="t2">${esc(txt)}</text>${sub ? `<text x="${W - Rm + 30}" y="${ry + 14}" class="m tick">${esc(sub)}</text>` : ''}`; ry += sub ? 34 : 20; return s0; };
    right += `<text x="${W - Rm + 14}" y="${ry}" class="m">${esc(T('设计点（降额）', 'design points (derated)'))}</text>`; ry += 18;
    right += item('var(--s1)', T('现状，各规模', 'today, every size'), `MTTR ${num(Z(SIZES[0]).today.der.mttrS, 1)} s`);
    for (const d of designsList) {
      right += item('var(--s2)', `${lab(d.n)} ${T('推荐', 'recommended')}`, `${sig(d.o.mtbfHwH)} h · ${num(d.o.mttrS, 1)} s`);
      right += item('var(--s3)', `${lab(d.n)} ${T('仅硬件', 'hardware only')}`, `${sig(d.hw.mtbfHwH)} h · ${num(d.hw.mttrS, 1)} s`);
    }
    g += right;
    g += `<text x="${xs(40)}" y="${ys(bHi * 40) + 30}" text-anchor="end" class="m">${esc(T('虚线：推荐设计自身的 B′（杠杆同时缩短隔离暂停）', 'dashed: own B′ of a recommended design (levers also shorten the isolation pauses)'))}</text>`;
    const table = `<table class="tv"><tr><th>${T('规模', 'NPUs')}</th><th>${T('设计', 'Design')}</th><th class="num">MTBF_hw (h)</th><th class="num">MTTR_hw (s)</th><th class="num">${T('比值 (s/h)', 'ratio (s/h)')}</th><th class="num">B (s/h)</th><th class="num">A_op ${T('降额', 'derated')}</th></tr>${SIZES.flatMap((n) => { const z = Z(n); const rows = [[T('现状', 'today'), z.today.der]]; if (z.optimal.mechanisms.length + z.optimal.levers.length + z.optimal.hwRows.length) rows.push([T('推荐分配', 'recommended'), z.optimal.der], [T('仅硬件', 'hardware only'), z.hardwareOnly.der]); return rows.map(([nm, k]) => `<tr><td>${int(n)}</td><td>${nm}</td><td class="num">${num(k.mtbfHwH, 3)}</td><td class="num">${num(k.mttrS, 1)}</td><td class="num">${num(k.mttrS / k.mtbfHwH, 1)}</td><td class="num">${num(budgetOf(k), 1)}</td><td class="num">${pct(k.aOp)} %</td></tr>`); }).join('')}</table>`;
    return { svg: g + '</svg>', table };
  }

  /* ---------- figure 2: MTTR composition ---------- */
  function figMttr() {
    const sumCat = (m) => { const o = { detect: 0, local: 0, auto: 0, manual: 0 }; for (const [k, v] of Object.entries(m.contrib)) o[CAT(k)] += v; return o; };
    const designs = [
      { name: T('现状 · 名义', 'today · nominal'), m: Z(N_MAX).today.mttr.nom },
      { name: T('现状 · 降额', 'today · derated'), m: Z(N_MAX).today.mttr.der },
      { name: T('200k 推荐 · 名义', '200k recommended · nominal'), m: Z(200000).optimal.mttr.nom },
      { name: T('200k 推荐 · 降额', '200k recommended · derated'), m: Z(200000).optimal.mttr.der },
      { name: T('500k 推荐 · 名义', '500k recommended · nominal'), m: Z(500000).optimal.mttr.nom },
      { name: T('500k 推荐 · 降额', '500k recommended · derated'), m: Z(500000).optimal.mttr.der },
    ].map((d) => ({ ...d, c: sumCat(d.m) }));
    const cats = [['detect', T('检测延迟', 'detection delay'), 'var(--s1)'], ['local', T('局部梯级（含失败尝试）', 'local rungs (incl. failed attempts)'), 'var(--s2)'], ['auto', T('全局恢复：自动尝试', 'global recovery: automatic attempt'), 'var(--s3)'], ['manual', T('全局恢复：人工份额', 'global recovery: manual share'), 'var(--s4)']];
    const W = 960, L = 190, Rm = 70, Tp = 64, rowH = 30, H = Tp + designs.length * rowH + 30;
    const pw = W - L - Rm;
    const max = Math.ceil(Math.max(...designs.map((d) => d.m.mttrS)) / 20) * 20;
    const xs = (v) => L + (v / max) * pw;
    let g = svgOpen('fig-mttr', W, H, T('MTTR 组成', 'MTTR composition')) + `<text x="14" y="20" class="ttl">${esc(T('图 2 · 每次硬件中断的平均暂停 MTTR_hw 由哪些部分构成（秒，按事件率加权）', 'Figure 2 · What one hardware interruption costs on average: MTTR_hw by part (seconds, rate-weighted)'))}</text>`;
    g += legendSw(14, 44, cats.map(([, n, c]) => ({ name: n, color: c })));
    for (let v = 0; v <= max; v += 20) g += `<line x1="${xs(v)}" x2="${xs(v)}" y1="${Tp - 4}" y2="${Tp + designs.length * rowH}" class="grid"/><text x="${xs(v)}" y="${Tp + designs.length * rowH + 16}" text-anchor="middle" class="m tick">${v} s</text>`;
    designs.forEach((d, i) => {
      const y = Tp + i * rowH;
      g += `<text x="${L - 8}" y="${y + 17}" text-anchor="end" class="lab">${esc(d.name)}</text>`;
      let x = L;
      const segs = cats.map(([k, n, c]) => ({ k, n, c, v: d.c[k] })).filter((q) => q.v > 0.05);
      segs.forEach((q, k) => {
        const w = xs(q.v) - L;
        const tip = `${d.name} · ${q.n}\n${num(q.v, 2)} s ${T('（占', '(')}${pct(q.v / d.m.mttrS, 0)} %${T('）', ')')}\nMTTR_hw ${num(d.m.mttrS, 1)} s`;
        g += hbar(x, y + 6, Math.max(0, w - (k < segs.length - 1 ? 2 : 0)), 17, q.c, tip, k === segs.length - 1);
        if (w > 30) g += `<text x="${x + w / 2 - 1}" y="${y + 18.5}" text-anchor="middle" class="lab b" style="fill:var(--on-${q.k})">${num(q.v, 0)}</text>`;
        x += w;
      });
      g += `<text x="${x + 6}" y="${y + 18}" class="t2 tick b">${num(d.m.mttrS, 1)} s</text>`;
      g += `<rect x="${L}" y="${y}" width="${W - L - 10}" height="${rowH}" class="hit" data-tip="${esc(`${d.name}\n${cats.map(([k, n]) => `${n} ${num(d.c[k], 2)} s`).join('\n')}\nMTTR_hw ${num(d.m.mttrS, 2)} s`)}"/>`;
    });
    const table = `<table class="tv"><tr><th>${T('设计', 'Design')}</th>${cats.map(([, n]) => `<th class="num">${esc(n)} (s)</th>`).join('')}<th class="num">MTTR_hw (s)</th></tr>${designs.map((d) => `<tr><td>${esc(d.name)}</td>${cats.map(([k]) => `<td class="num">${num(d.c[k], 2)}</td>`).join('')}<td class="num">${num(d.m.mttrS, 2)}</td></tr>`).join('')}</table>`;
    return { svg: g + '</svg>', table, designs };
  }

  const f0 = tree(), f1 = plane(), f2 = figMttr();
  writeFileSync(`${OUT_DIR}/fig0-tree.${lang}.svg`, f0);
  writeFileSync(`${OUT_DIR}/fig1-plane.${lang}.svg`, f1.svg);
  writeFileSync(`${OUT_DIR}/fig2-mttr.${lang}.svg`, f2.svg);

  /* ---------- tables ---------- */
  const z500 = Z(500000), z200 = Z(200000);
  const kd500 = z500.today.der, kn500 = z500.today.nom;
  // §1: the formula closes on the engine (500k today, derated)
  const classRows = [
    { name: T('硬件中断（经机制链）', 'hardware interruptions (through the mechanism chain)'), mtbf: kd500.mtbfHwH, mttr: kd500.mttrS, sph: kd500.sumLP },
    ...kd500.other.map((o) => ({ name: otherName(o.id), mtbf: o.mtbfH, mttr: o.pauseS, sph: o.sPerH })),
  ];
  const tClasses = `<div class="table-wrap"><table class="dense"><tr><th>${T('事件类 k', 'Event class k')}</th><th class="num">MTBFₖ</th><th class="num">MTTRₖ (s)</th><th class="num">3600·MTTRₖ/MTBFₖ (s/h)</th></tr>${classRows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.mtbf ? fmtMtbf(r.mtbf) : '—'}</td><td class="num">${r.mtbf ? num(r.mttr, 1) : '—'}</td><td class="num">${num(r.sph, 2)}</td></tr>`).join('')}<tr><td>${T('未检出静默错误的事件暂停 φ_SDC', 'undetected silent-corruption episodes φ_SDC')}</td><td class="num" colspan="2">${T('窗口占比', 'share of the window')}</td><td class="num">${kd500.phi.toExponential(2)}</td></tr><tr><td><b>A_op = (1 − φ) / (1 + Σ/3600)</b></td><td class="num" colspan="2"></td><td class="num"><b>${pct(kd500.aOp)} %</b> ${T('（引擎同值）', '(= engine)')}</td></tr></table></div>`;
  // §2: requirement per scale (A3) and the other templates
  const reqRows = SIZES.map((n) => {
    const z = Z(n), kn = z.today.nom, kd = z.today.der, q = z.required;
    const ok = q.mtbfFactor <= 1;
    const fitBudget = 1e9 / (n * q.mtbfAtTodayMttrH);
    return `<tr><td class="num">${int(n)}</td><td class="num">${fmtMtbf(kd.mtbfHwH)}</td><td class="num">${num(kn.mttrS, 1)} / ${num(kd.mttrS, 1)}</td><td class="num">${num(q.B, 1)}</td><td class="num"><b>${fmtMtbf(q.mtbfAtTodayMttrH)}</b></td><td class="num"><b>${num(q.mttrAtTodayMtbfS, 1)}</b></td><td class="num">${int(fitBudget)} ${T('（现', '(now')} ${int(z.today.units.reduce((a, u) => a + (u.count * u.fit) / n, 0))}${T('）', ')')}</td><td>${ok ? T(`达标，余量 ×${num(1 / q.mtbfFactor, 2)}`, `meets, slack ×${num(1 / q.mtbfFactor, 2)}`) : T(`MTBF ×${num(q.mtbfFactor, 2)} 或 MTTR ×${num(q.mttrFactor, 2)}`, `MTBF ×${num(q.mtbfFactor, 2)} or MTTR ×${num(q.mttrFactor, 2)}`)}</td></tr>`;
  }).join('');
  const otherTpl = ['a2-roce', 'a950-ub2', 'a960e-ub'].map((t) => `<tr><td class="k">${({ 'a2-roce': 'A2 · RoCE', 'a950-ub2': 'Atlas 950', 'a960e-ub': 'Atlas 960E' })[t]}</td>${SIZES.map((n) => { const z = Z(n, t); return `<td class="num">${T('现状', 'today')} ${sig(z.today.der.mtbfHwH)} h · ${num(z.today.der.mttrS, 0)} s<br>${T('需要', 'need')} ≥ ${sig(z.required.mtbfAtTodayMttrH)} h ${T('或', 'or')} ≤ ${num(z.required.mttrAtTodayMtbfS, 0)} s</td>`; }).join('')}</tr>`).join('');
  // the recommended split per scale
  const splitRows = SIZES.map((n) => {
    const z = Z(n), o = z.optimal, k = o.der;
    const moves = [...o.mechanisms, ...o.levers.map((l) => ({ auto: T('自动尝试 60 s', 'automatic attempt 60 s'), manual: T('人工 30 min', 'manual 30 min'), success: T('成功率 99.9 %', 'success 99.9 %') })[l])];
    const hw = o.hwRows.length ? T(`${o.hwRows.length} 类硬件：${o.hwRows.map((h) => `${h.id.replace(/-hard$/, '')} ×${num(h.factor, 2)}`).join('、')}`, `${o.hwRows.length} hardware classes: ${o.hwRows.map((h) => `${h.id.replace(/-hard$/, '')} ×${num(h.factor, 2)}`).join(', ')}`) : '';
    const what = moves.length || hw ? [moves.join(' + '), hw].filter(Boolean).join(T('；', '; ')) : T(`无需改动（余量 ×${num(o.slack, 2)}）`, `nothing needed (slack ×${num(o.slack, 2)})`);
    return `<tr><td class="num">${int(n)}</td><td>${esc(what)}</td><td class="num"><b>${fmtMtbf(k.mtbfHwH)}</b></td><td class="num"><b>${num(k.mttrS, 1)}</b> <span class="small">(${T('名义', 'nom.')} ${num(o.nom.mttrS, 1)})</span></td><td class="num">${num(budgetOf(k), 1)}</td><td class="num">${pct(k.aOp)} %</td><td class="num">${num(o.effort.total, 2)}</td></tr>`;
  }).join('');
  // §3: per-unit MTBF (years), recommended split at every scale + hardware-only at 200k / 500k
  const unitsOf = (sel) => Object.fromEntries(sel.map((u) => [u.unit, u]));
  const U = Object.fromEntries(SIZES.map((n) => [n, { rec: unitsOf(Z(n).optimal.units), hw: unitsOf(Z(n).hardwareOnly.units), today: unitsOf(Z(n).today.units) }]));
  const unitRows = UNIT_ORDER.filter((u) => U[N_MAX].today[u]).map((u) => {
    const t = U[N_MAX].today[u];
    const cell = (n, kind) => { const r = U[n][kind][u]; if (!r) return '<td class="num">—</td>'; const f = r.mtbfAllowedH / r.mtbfH; const bold = f > 1.0001; return `<td class="num">${bold ? '<b>' : ''}${fy(yrs(r.mtbfAllowedH))}${bold ? '</b>' : ''}</td>`; };
    return `<tr><td>${esc(unitName(u))}</td><td class="num">${int(t.count)}</td><td class="num">${fitf(t.fit)}</td><td class="num">${fy(yrs(t.mtbfH))}</td><td class="num">${pct(t.share, 1)} %</td>${SIZES.map((n) => cell(n, 'rec')).join('')}${cell(200000, 'hw')}${cell(500000, 'hw')}</tr>`;
  }).join('');
  // §4: MTTR by mechanism (500k recommended vs today), with parameters
  const P = (m) => m.chain;
  const mt = { tn: z500.today.mttr.nom, td: z500.today.mttr.der, on: z500.optimal.mttr.nom, od: z500.optimal.mttr.der };
  const c = (m, keys) => keys.reduce((a, k) => a + (m.contrib[k] ?? 0), 0);
  const pr = (m, k) => m.probs[k] ?? 0;
  const pctS = (x) => `${pct(x, 1)} %`;
  const parRec = (r) => `c ${num(r.detectionCoverage, 3)} · t_fast ${num(r.detectAutoS, 1)} s · t_timeout ${num(r.timeoutS, 0)} s → t_det ${num(r.tDetS, 2)} s`;
  const fmtRung = (p, keys) => (p ? keys.map(([k, lab, d]) => `${lab} ${typeof p[k] === 'number' ? (d === 'p' ? num(p[k], 2) : `${num(p[k], k.endsWith('Seconds') ? 1 : 0)}${k.endsWith('Seconds') ? ' s' : ''}`) : '—'}`).join(' · ') : T('未启用', 'off'));
  const rungKeys = {
    netfail: [['success', T('成功率', 'p_ok'), 'p'], ['successSeconds', 't_ok'], ['failureSeconds', 't_fail']],
    replay: [['success', T('成功率', 'p_ok'), 'p'], ['successSeconds', 't_ok'], ['failureSeconds', 't_fail']],
    elastic: [['success', T('成功率', 'p_ok'), 'p'], ['syncSeconds', 't_sync'], ['failureSeconds', 't_fail']],
    process: [['success', T('成功率', 'p_ok'), 'p'], ['successSeconds', 't_ok'], ['failureSeconds', 't_fail']],
  };
  const mrow = (name, mech, parToday, parRecN, parRecD, pToday, pRec, ctn, ctd, con, cod) => `<tr><td>${name}</td><td class="m">${mech}</td><td>${parToday}</td><td>${parRecN}${parRecD ? `<br><span class="small">${T('降额', 'derated')}: ${parRecD}</span>` : ''}</td><td class="num">${pToday} → ${pRec}</td><td class="num">${num(ctn, 2)} / ${num(ctd, 2)}</td><td class="num"><b>${num(con, 2)}</b> / ${num(cod, 2)}</td></tr>`;
  const rungRow = (k, name, mech) => mrow(name, mech, fmtRung(P(mt.tn)[k], rungKeys[k]), fmtRung(P(mt.on)[k], rungKeys[k]), fmtRung(P(mt.od)[k], rungKeys[k]), pctS(pr(mt.tn, k)), pctS(pr(mt.on, k)), c(mt.tn, [k]), c(mt.td, [k]), c(mt.on, [k]), c(mt.od, [k]));
  const failedKeys = (m) => Object.keys(m.contrib).filter((k) => k.startsWith('failed:'));
  const mechRows = [
    mrow(T('检测延迟 t_det', 'detection delay t_det'), 'D-HARD', parRec(mt.tn.recovery), parRec(mt.on.recovery), parRec(mt.od.recovery), T('除弹性、网络切换外的全部路径', 'every path except elastic and netfail'), '', c(mt.tn, ['detect']), c(mt.td, ['detect']), c(mt.on, ['detect']), c(mt.od, ['detect'])).replace(/<td class="num">[^<]*→ <\/td>/, `<td class="num">${pctS(1 - pr(mt.tn, 'elastic') - pr(mt.tn, 'netfail'))} → ${pctS(1 - pr(mt.on, 'elastic') - pr(mt.on, 'netfail'))}</td>`),
    rungRow('netfail', T('网络 / 网卡切换', 'network / NIC failover'), 'R-NETFAIL'),
    rungRow('replay', T('算子 / 通信重执行', 'operator / communication replay'), 'R-REPLAY'),
    rungRow('elastic', T('DP 域弹性（全局只暂停同步）', 'DP-domain elastic (global pause = sync only)'), 'R-ELASTIC'),
    rungRow('process', T('进程 / Pod 重调度', 'process / pod rescheduling'), 'R-PROCESS'),
    mrow(T('失败尝试（各梯级失败时间之和）', 'failed attempts (failure times of the rungs tried)'), '—', T('见上方各梯级“失败”时间', 'the rungs’ failure times above'), '', '', '', '', c(mt.tn, failedKeys(mt.tn)), c(mt.td, failedKeys(mt.td)), c(mt.on, failedKeys(mt.on)), c(mt.od, failedKeys(mt.od))).replace(/<td class="num"> → <\/td>/, '<td class="num">—</td>'),
    mrow(T('全局恢复：自动尝试 t_auto', 'global recovery: automatic attempt t_auto'), T('杠杆', 'lever'), `t_auto ${num(mt.tn.recovery.autoS, 0)} s`, `t_auto ${num(mt.on.recovery.autoS, 0)} s`, `t_auto ${num(mt.od.recovery.autoS, 0)} s`, pctS(pr(mt.tn, 'global')), pctS(pr(mt.on, 'global')), c(mt.tn, ['globalAuto']), c(mt.td, ['globalAuto']), c(mt.on, ['globalAuto']), c(mt.od, ['globalAuto'])),
    mrow(T('全局恢复：人工份额 (1 − s)·t_manual', 'global recovery: manual share (1 − s)·t_manual'), T('杠杆', 'lever'), `s ${pct(mt.tn.recovery.success, 1)} % · t_manual ${num(mt.tn.recovery.manualS / 60, 0)} min`, `s ${pct(mt.on.recovery.success, 1)} % · t_manual ${num(mt.on.recovery.manualS / 60, 0)} min`, `s ${pct(mt.od.recovery.success, 1)} % · t_manual ${num(mt.od.recovery.manualS / 60, 0)} min`, pctS(pr(mt.tn, 'global')), pctS(pr(mt.on, 'global')), c(mt.tn, ['globalManual']), c(mt.td, ['globalManual']), c(mt.on, ['globalManual']), c(mt.od, ['globalManual'])),
  ].join('') + `<tr><td><b>MTTR_hw</b></td><td></td><td></td><td></td><td></td><td class="num"><b>${num(mt.tn.mttrS, 2)} / ${num(mt.td.mttrS, 2)}</b></td><td class="num"><b>${num(mt.on.mttrS, 2)} / ${num(mt.od.mttrS, 2)}</b></td></tr>`;
  // per-scale MTTR allocation
  const mttrScale = SIZES.map((n) => {
    const z = Z(n), o = z.optimal;
    const req = budgetOf(o.der) * o.der.mtbfHwH;
    const what = [...o.mechanisms, ...o.levers.map((l) => ({ auto: T('t_auto 180 → 60 s', 't_auto 180 → 60 s'), manual: T('t_manual 2 h → 30 min', 't_manual 2 h → 30 min'), success: 's → 99.9 %' })[l])];
    return `<tr><td class="num">${int(n)}</td><td class="num">${fmtMtbf(o.der.mtbfHwH)}</td><td class="num">≤ ${num(req, 1)}</td><td class="num"><b>${num(o.der.mttrS, 1)}</b> <span class="small">(${T('名义', 'nom.')} ${num(o.nom.mttrS, 1)})</span></td><td>${esc(what.join(' + ') || T('默认六项机制即可', 'the six default mechanisms suffice'))}</td></tr>`;
  }).join('');
  // mechanism parameter catalogue
  const M = D.mechanisms;
  const fmtP = (p) => Object.entries(p).map(([k, v]) => `${k} ${Number(Number(v).toFixed(4))}`).join(', ');
  const used500 = new Set([...Object.keys(D.mechanisms).filter((id) => ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'].includes(id)), ...z500.optimal.mechanisms]);
  const paramRows = Object.entries(M).filter(([id]) => used500.has(id)).map(([id, m]) => `<tr><td><code>${id}</code> ${esc(zh ? m.name.zh : m.name.en)}</td><td>${['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST'].includes(id) ? T('默认六项', 'default six') : T('500k 推荐新增', 'added at 500k')}</td><td>${esc(fmtP(m.nominal))}</td><td>${esc(fmtP(m.derated))}</td></tr>`).join('');
  const kOpt500 = z500.optimal.der;

  const html = `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T('自顶向下 MTBF 与 MTTR', 'Top-down MTBF and MTTR')}</title>
<meta name="description" content="${esc(T('自顶向下的作业可用度公式（MTBF 与 MTTR）、各规模所需的 MTBF / MTTR、分配到硬件单元的 MTBF 与分配到机制的 MTTR 及其参数。', 'A top-down job availability formula in MTBF and MTTR, the MTBF / MTTR each scale needs, the MTBF allocated to the hardware units and the MTTR allocated to the mechanisms with their parameters.'))}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; --ok:#2a7d4f; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#6fcf97; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#6fcf97; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", ${zh ? '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC",' : ''} "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
  main { max-width: 1120px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 22px 26px 26px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", ${zh ? '"PingFang SC", "Noto Serif CJK SC",' : ''} Georgia, serif; font-size: 22px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; overflow-wrap: anywhere; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", ${zh ? '"PingFang SC",' : ''} Georgia, serif; font-size: 16px; font-weight: 600; margin: 16px 0 6px; padding-top: 8px; border-top: 1px solid var(--rule); overflow-wrap: anywhere; }
  h2.first { border-top: none; padding-top: 0; margin-top: 4px; }
  h3 { font-size: 13px; margin: 10px 0 4px; }
  p { margin: 5px 0; overflow-wrap: anywhere; } .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 6px; }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
  .small { font-size: 11.3px; color: var(--muted); }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.8px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3.5px 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.3px; }
  td.k { white-space: nowrap; font-weight: 500; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } td.m { white-space: nowrap; }
  figure.chart { margin: 8px 0 10px; position: relative; } figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  details.tv { margin: -2px 0 10px; font-size: 11.5px; overflow-x: auto; } details.tv summary { cursor: pointer; color: var(--accent); }
  table.tv { font-size: 11px; } table.tv th, table.tv td { padding: 2px 5px; }
  .tip { position: absolute; z-index: 5; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 11.5px; line-height: 1.4; padding: 6px 9px; border-radius: 6px; white-space: pre-line; max-width: 360px; box-shadow: 0 2px 8px rgba(0,0,0,.25); display: none; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  .formula { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 7px 12px; border-radius: 0 6px 6px 0; margin: 6px 0; font-size: 12.4px; }
  .formula .eq { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 12.6px; margin: 3px 0; overflow-wrap: anywhere; }
  .verdict { border-left: 3px solid var(--ok); background: var(--surface-2); padding: 7px 11px; border-radius: 0 6px 6px 0; margin: 6px 0 8px; font-size: 12.4px; }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; overflow-wrap: anywhere; }
  @media screen and (max-width: 760px) { .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 600px; } figure.chart { overflow-x: auto; } figure.chart svg { min-width: 720px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.8px; line-height: 1.36; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7.6px; line-height: 1.28; } th, td { padding: 1.2px 2.5px; } th { font-size: inherit; } table.dense { font-size: 7.3px; line-height: 1.22; } table.dense th, table.dense td { padding: 0.8px 2px; }
    code { font-size: 7.4px; } .small { font-size: 7.1px; } .callout, .formula, .verdict, .sub, footer { font-size: 7.9px; } .callout, .formula, .verdict { margin: 3px 0; padding: 3px 7px; } .formula .eq { font-size: 8.2px; margin: 1px 0; } footer { font-size: 7.2px; }
    h1 { font-size: 14px; margin: 2px 0 3px; } h2 { font-size: 10.5px; margin: 4px 0 2px; padding-top: 3px; } h3 { font-size: 9px; margin: 3px 0 1px; } .eyebrow { font-size: 7.5px; }
    figure.chart { margin: 2px 0 2px; } figcaption { font-size: 7.2px; margin-top: 0; } details.tv { display: none; } .tip { display: none !important; }
    p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    figure.chart.f0 svg { height: 210px; } figure.chart.f1 svg { height: 318px; } figure.chart.f2 svg { height: 190px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D v4 · ${T('自顶向下的可用度分解：公式与各规模的要求', 'Top-down availability: the formula and what each scale needs')} · ${gen} · ${T('第 1 / 3 页', 'page 1 / 3')}</div>
  <h1>${T('自顶向下：从可用度目标到硬件 MTBF 与机制 MTTR', 'Top-down: from the availability target to hardware MTBF and mechanism MTTR')}</h1>
  <p class="sub"><b>${T('口径', 'Basis')}</b>：${T(`作业运行可用度 A_op（30 天窗口内的运行时间占比），目标为方案默认的 ${pct(TARGET, 1)} %；主算例为 A3 · CloudMatrix384 拓扑、默认六项机制，内置规模 10k / 100k / 200k / 500k NPU（A2、Atlas 950 与 Atlas 960E 的要求见第 2 节）。设计须在<b>降额参数</b>（覆盖率 −5 pt、成功率 −8 pt、时间 ×1.5）下达标，因此要求按降额设计计算。FIT 为参考目录先验（假设）按 CloudMatrix384 几何换算到各硬件单元。每个数字都由 <code>scripts/mtbf-mttr-topdown.ts</code> 在引擎上计算，公式与引擎的运行占比逐项相等（误差 < 10⁻⁹）。`, `job operational availability A_op (running-time share of the 30-day window), target the scenario default ${pct(TARGET, 1)} %; main case the A3 · CloudMatrix384 topology with the six default mechanisms at the built-in 10k / 100k / 200k / 500k NPUs (A2, Atlas 950 and Atlas 960E requirements in section 2). The design must hold with <b>derated</b> parameters (coverage −5 pt, success −8 pt, times ×1.5), so requirements are computed on the derated design. FIT are the reference catalog’s priors (assumed) converted to hardware units under the CloudMatrix384 geometry. Every number is computed on the engine by <code>scripts/mtbf-mttr-topdown.ts</code>; the formula matches the engine’s running fraction term by term (difference < 10⁻⁹).`)}</p>
  <h2 class="first">${T('1. 自顶向下公式', '1. The top-down formula')}</h2>
  <div class="formula">
    <div>${T('<b>① 单一事件类</b>（经典）：', '<b>① One event class</b> (classic):')}</div>
    <div class="eq">A = MTBF / (MTBF + MTTR)</div>
    <div>${T('<b>② 作业级</b>：每个事件类 k 用自己的 MTBFₖ 与 MTTRₖ（不同事件类不合并成一个 MTBF），静默错误的事件暂停单独计为 φ_SDC：', '<b>② Job level</b>: each event class k keeps its own MTBFₖ and MTTRₖ (event classes are never merged into one MTBF); silent-corruption episodes enter as φ_SDC:')}</div>
    <div class="eq">A_op = (1 − φ_SDC) / (1 + MTTR_hw/MTBF_hw + Σₖ MTTRₖ/MTBFₖ)</div>
    <div>${T('<b>③ MTBF 层</b>：硬件中断的作业级 MTBF 由各硬件单元的 MTBF 与数量 nᵤ(N) 合成：', '<b>③ MTBF level</b>: the job-level MTBF of hardware interruptions combines the MTBF of each hardware unit with its count nᵤ(N):')}</div>
    <div class="eq">1 / MTBF_hw = Σᵤ nᵤ(N) / MTBFᵤ ,  MTBFᵤ = 10⁹ / FITᵤ  [h]</div>
    <div>${T('<b>④ MTTR 层</b>：每次硬件中断的平均暂停 = 各类按事件率加权，每类沿机制链（网络切换 → 重执行 → 弹性 → 进程 → 全局恢复）求期望：', '<b>④ MTTR level</b>: the mean pause per hardware interruption, rate-weighted over the classes, each through the mechanism chain (netfail → replay → elastic → process → global recovery):')}</div>
    <div class="eq">MTTR_hw = Σᵢ (λᵢ/λ_hw) · Σ_path P(path) · T(path) ;  T(global) = t_det + Σ t_fail + t_auto + (1 − s)·t_manual ;  t_det = c·t_fast + (1 − c)·t_timeout</div>
    <div>${T('<b>⑤ 要求</b>（MTBF_hw 以小时、MTTR 以秒计）：', '<b>⑤ Requirement</b> (MTBF_hw in hours, MTTR in seconds):')}</div>
    <div class="eq">MTTR_hw / MTBF_hw ≤ B ,  B = 3600·((1 − φ_SDC)/A* − 1) − F ,  F = Σₖ 3600·MTTRₖ/MTBFₖ  [s/h]</div>
    <div class="eq">⇒  MTBF_hw ≥ MTTR_hw / B   ${T('或', 'or')}   MTTR_hw ≤ B · MTBF_hw</div>
  </div>
  <figure class="chart f0">${f0}<figcaption>${T('图 0：目标在第一层分到各事件类；硬件中断这一类再分成 MTBF（由硬件单元承担）与 MTTR（由检测、恢复梯级与全局恢复参数承担）。', 'Figure 0: the target is first split over the event classes; the hardware-interruption class is then split into MTBF (carried by the hardware units) and MTTR (carried by detection, the recovery rungs and the global-recovery parameters).')}</figcaption></figure>
  <p>${T(`下表用 500,000 NPU 的现状（降额）验证公式②：各事件类的比值 3600·MTTRₖ/MTBFₖ 相加，再乘以 (1 − φ)，正好得到引擎的 A_op。硬件中断占暂停的 ${pct(kd500.sumLP / (kd500.sumLP + kd500.F), 0)} %，其余主要是亚健康单元隔离（每次触发一次全局恢复）。`, `The table checks formula ② on the 500,000-NPU design today (derated): the ratios 3600·MTTRₖ/MTBFₖ of the event classes add up and, with (1 − φ), give exactly the engine’s A_op. Hardware interruptions carry ${pct(kd500.sumLP / (kd500.sumLP + kd500.F), 0)} % of the pause; the rest is mainly the isolation of sub-healthy units (each one a global recovery).`)}</p>
  ${tClasses}
  <h2>${T('2. 各规模需要的 MTBF 与 MTTR', '2. What MTBF and MTTR each scale needs')}</h2>
  <div class="table-wrap"><table class="dense">
    <tr><th class="num">NPU</th><th class="num">${T('现状 MTBF_hw', 'MTBF_hw today')}</th><th class="num">${T('现状 MTTR_hw 名义 / 降额 (s)', 'MTTR_hw today nominal / derated (s)')}</th><th class="num">B (s/h)</th><th class="num">${T('现状 MTTR 下需要的 MTBF_hw', 'MTBF_hw needed at today’s MTTR')}</th><th class="num">${T('现状 MTBF 下允许的 MTTR_hw (s)', 'MTTR_hw allowed at today’s MTBF (s)')}</th><th class="num">${T('每 NPU 硬件 FIT 预算', 'hardware FIT budget per NPU')}</th><th>${T('结论', 'Status')}</th></tr>
    ${reqRows}
  </table></div>
  <div class="verdict">${T(`<b>读法：</b>MTTR 与规模无关（现状降额 ${num(Z(SIZES[0]).today.der.mttrS, 1)} s，由机制链决定），而 MTBF_hw 与 N 成反比，所以在现状 MTTR 下，<b>每个规模都需要作业级 MTBF_hw ≈ ${sig(Z(SIZES[0]).required.mtbfAtTodayMttrH)}–${sig(Z(N_MAX).required.mtbfAtTodayMttrH)} 小时</b>（B 随 N 略降，因为隔离与静默错误的暂停随 N 增加）。折算到每 NPU 的硬件中断 FIT 预算为 10⁹ / (N · MTBF_hw)：10k 时有很大余量，100k 时余量 ×${num(1 / Z(100000).required.mtbfFactor, 2)}，200k 需要 MTBF ×${num(Z(200000).required.mtbfFactor, 2)} 或 MTTR ×${num(Z(200000).required.mttrFactor, 2)}，500k 需要 MTBF ×${num(Z(N_MAX).required.mtbfFactor, 2)} 或 MTTR ×${num(Z(N_MAX).required.mttrFactor, 2)}（只靠一边都很难），所以 200k 以上要在两边之间分配。`, `<b>Reading:</b> MTTR does not depend on the scale (today ${num(Z(SIZES[0]).today.der.mttrS, 1)} s derated, set by the mechanism chain) while MTBF_hw falls as 1/N, so at today’s MTTR <b>every scale needs a job-level MTBF_hw of about ${sig(Z(SIZES[0]).required.mtbfAtTodayMttrH)}–${sig(Z(N_MAX).required.mtbfAtTodayMttrH)} hours</b> (B drops slightly with N because the isolation and silent-corruption pauses grow with N). Per NPU the hardware-interruption FIT budget is 10⁹ / (N · MTBF_hw): large slack at 10k, slack ×${num(1 / Z(100000).required.mtbfFactor, 2)} at 100k; 200k needs MTBF ×${num(Z(200000).required.mtbfFactor, 2)} or MTTR ×${num(Z(200000).required.mttrFactor, 2)}, 500k needs MTBF ×${num(Z(N_MAX).required.mtbfFactor, 2)} or MTTR ×${num(Z(N_MAX).required.mttrFactor, 2)} (hard on either side alone), so from 200k the gap is split between the two.`)}</div>
  <p class="small">${T('其他拓扑（降额，现状 MTBF_hw · MTTR_hw → 现状 MTTR 下需要的 MTBF_hw，或现状 MTBF 下允许的 MTTR_hw）：', 'Other topologies (derated, today MTBF_hw · MTTR_hw → MTBF_hw needed at today’s MTTR, or MTTR_hw allowed at today’s MTBF):')}</p>
  <div class="table-wrap"><table class="dense"><tr><th></th>${SIZES.map((n) => `<th class="num">${int(n)}</th>`).join('')}</tr>${otherTpl}</table></div>
  <h3>${T('推荐分配：MTBF 与 MTTR 各承担多少（v4 最优：工作量最小的组合）', 'Recommended split: how much MTBF and how much MTTR (v4 optimal: the least-effort combination)')}</h3>
  <div class="table-wrap"><table class="dense"><tr><th class="num">NPU</th><th>${T('手段', 'Moves')}</th><th class="num">MTBF_hw ${T('（降额设计）', '(derated design)')}</th><th class="num">MTTR_hw ${T('降额 (s)', 'derated (s)')}</th><th class="num">${T('自身 B′ (s/h)', 'own B′ (s/h)')}</th><th class="num">A_op ${T('降额', 'derated')}</th><th class="num">${T('工作量', 'Effort')}</th></tr>${splitRows}</table></div>
</section>

<section class="page" id="p2">
  <div class="eyebrow">HAC-D v4 · ${T('分配到硬件单元的 MTBF', 'MTBF allocated to the hardware units')} · ${gen} · ${T('第 2 / 3 页', 'page 2 / 3')}</div>
  <figure class="chart f1">${f1.svg}<div class="tip"></div><figcaption>${T(`图 1：横轴 MTBF_hw、纵轴 MTTR_hw（对数）。灰带是各规模的要求线 MTTR = B·MTBF（B = ${num(Math.min(...SIZES.map((n) => Z(n).required.B)), 1)}–${num(Math.max(...SIZES.map((n) => Z(n).required.B)), 1)} s/h），带下方达标。现状点（蓝）MTTR 相同、MTBF 随规模左移，在 100k 与 200k 之间越过要求带。到达要求有两条路：向右（硬件提高 MTBF，绿）或向下（机制缩短 MTTR，橙）；推荐分配在 500k 两者兼用。仅硬件的点也会向下移动：它主要削减没有恢复梯级的类（每次 264.5 s），剩下的中断以短暂停为主，MTTR_hw 因而变短——MTBF 与 MTTR 通过事件构成耦合。推荐设计的杠杆同时缩短隔离暂停（F 变小），因此它们的自身预算 B′（虚线）略高于现状。`, `Figure 1: MTBF_hw across, MTTR_hw up (log scales). The grey band holds the requirement lines MTTR = B·MTBF of the scales (B = ${num(Math.min(...SIZES.map((n) => Z(n).required.B)), 1)}–${num(Math.max(...SIZES.map((n) => Z(n).required.B)), 1)} s/h); below the band the target holds. Today’s points (blue) share one MTTR and move left with N, crossing the band between 100k and 200k. Two ways reach the band: right (hardware raises MTBF, green) or down (mechanisms cut MTTR, orange); the recommended split uses both at 500k. The hardware-only points also move down: they mostly remove events of the classes without a recovery rung (264.5 s each), so the remaining interruptions are mostly short pauses and MTTR_hw falls — MTBF and MTTR are coupled through the event mix. Its levers also shorten the isolation pauses (smaller F), so the recommended designs’ own budget B′ (dashed) sits slightly above today’s.`)}</figcaption></figure>
  <details class="tv"><summary>${T('图 1 数据表', 'Figure 1 data table')}</summary>${f1.table}</details>
  <h2>${T('3. 分配到各硬件单元的 MTBF（A3 · CloudMatrix384）', '3. MTBF allocated to each hardware unit (A3 · CloudMatrix384)')}</h2>
  <p>${T('下表给出每个硬件单元的<b>最低 MTBF（年 / 单元）</b>。推荐分配：10k–200k 不需要改进硬件，单元 MTBF 可降到“现状 ÷ 余量”（验收下限）；500k 由最小工作量分配把 FIT 压在暂停贡献最大的类上（未归因、机柜供电、管理、存储、冷却）。仅硬件的方案（MTTR 保持现状）列在右侧作比较。粗体 = 需要比现状更好。', 'The table gives the <b>minimum MTBF per unit (years)</b>. Recommended split: 10k–200k need no hardware improvement, so a unit’s MTBF may fall to “today ÷ slack” (acceptance floor); at 500k the least-effort split cuts FIT where the pause contribution is largest (unattributed, cabinet power, management, storage, cooling). The hardware-only plan (MTTR kept at today’s value) is on the right for comparison. Bold = must be better than today.')}</p>
  <div class="table-wrap"><table class="dense">
    <tr><th rowspan="2">${T('硬件单元', 'Hardware unit')}</th><th class="num" rowspan="2">${T('数量 @ 500k', 'Count @ 500k')}</th><th class="num" rowspan="2">${T('现状 FIT / 单元', 'FIT / unit today')}</th><th class="num" rowspan="2">${T('现状 MTBF（年）', 'MTBF today (years)')}</th><th class="num" rowspan="2">${T('占 λ_hw', 'share of λ_hw')}</th><th class="num" colspan="4">${T('最低 MTBF（年 / 单元）· 推荐分配', 'Minimum MTBF (years / unit) · recommended split')}</th><th class="num" colspan="2">${T('仅硬件', 'Hardware only')}</th></tr>
    <tr>${SIZES.map((n) => `<th class="num">${int(n)}</th>`).join('')}<th class="num">200,000</th><th class="num">500,000</th></tr>
    ${unitRows}
  </table></div>
  <p class="small">${T(`MTBFᵤ = 10⁹ / FITᵤ 小时 ÷ 8,760；FITᵤ 为该单元上全部故障类的中断 FIT 之和（业务影响口径）。占比 = nᵤ·FITᵤ / Σ。500k 推荐分配的作业级结果：MTBF_hw ${fmtMtbf(kOpt500.mtbfHwH)}（现状 ${fmtMtbf(kd500.mtbfHwH)}）。`, `MTBFᵤ = 10⁹ / FITᵤ hours ÷ 8,760; FITᵤ = the interruption FIT of all fault classes on the unit (business-impact 口径). Share = nᵤ·FITᵤ / Σ. Job-level result of the 500k recommended split: MTBF_hw ${fmtMtbf(kOpt500.mtbfHwH)} (today ${fmtMtbf(kd500.mtbfHwH)}).`)}</p>
  <div class="callout">${T(`<b>怎样用作硬件指标：</b>把“最低 MTBF（年 / 单元）”作为该单元的验收值；同一单元若有多个故障类，按各类 FIT 分到供应商（例如机柜：供电与液冷）。仅硬件方案在 500k 要求 NPU ${fy(yrs(U[N_MAX].hw.npu.mtbfAllowedH))} 年、机柜 ${fy(yrs(U[N_MAX].hw.cabinet.mtbfAllowedH))} 年、作业级服务 ${fy(yrs(U[N_MAX].hw.job.mtbfAllowedH))} 年（现状 ${fy(yrs(U[N_MAX].today.npu.mtbfH))} / ${fy(yrs(U[N_MAX].today.cabinet.mtbfH))} / ${fy(yrs(U[N_MAX].today.job.mtbfH))} 年），推荐分配则让 NPU 保持现状，只要求机柜 ${fy(yrs(U[N_MAX].rec.cabinet.mtbfAllowedH))} 年、作业级服务 ${fy(yrs(U[N_MAX].rec.job.mtbfAllowedH))} 年、节点 ${fy(yrs(U[N_MAX].rec.node.mtbfAllowedH))} 年——其余由 MTTR 承担（第 4 节）。`, `<b>Using it as hardware requirements:</b> take “minimum MTBF (years / unit)” as the unit’s acceptance value; when a unit carries several fault classes, split it to the suppliers by class FIT (e.g. a cabinet: power and cooling). At 500k the hardware-only plan needs NPUs at ${fy(yrs(U[N_MAX].hw.npu.mtbfAllowedH))} years, cabinets at ${fy(yrs(U[N_MAX].hw.cabinet.mtbfAllowedH))} and job-level services at ${fy(yrs(U[N_MAX].hw.job.mtbfAllowedH))} (today ${fy(yrs(U[N_MAX].today.npu.mtbfH))} / ${fy(yrs(U[N_MAX].today.cabinet.mtbfH))} / ${fy(yrs(U[N_MAX].today.job.mtbfH))}); the recommended split keeps the NPU as it is and asks only cabinets ${fy(yrs(U[N_MAX].rec.cabinet.mtbfAllowedH))} years, job-level services ${fy(yrs(U[N_MAX].rec.job.mtbfAllowedH))} and nodes ${fy(yrs(U[N_MAX].rec.node.mtbfAllowedH))} — the rest is carried by MTTR (section 4).`)}</div>
</section>

<section class="page" id="p3">
  <div class="eyebrow">HAC-D v4 · ${T('分配到机制的 MTTR 与参数', 'MTTR allocated to the mechanisms, with parameters')} · ${gen} · ${T('第 3 / 3 页', 'page 3 / 3')}</div>
  <h2 class="first">${T('4. 分配到机制的 MTTR', '4. MTTR allocated to the mechanisms')}</h2>
  <div class="table-wrap"><table class="dense"><tr><th class="num">NPU</th><th class="num">${T('分配后 MTBF_hw', 'MTBF_hw after allocation')}</th><th class="num">${T('允许 MTTR_hw = B′·MTBF (s)', 'allowed MTTR_hw = B′·MTBF (s)')}</th><th class="num">${T('达到的 MTTR_hw 降额 (s)', 'MTTR_hw reached, derated (s)')}</th><th>${T('承担 MTTR 的手段', 'What carries the MTTR')}</th></tr>${mttrScale}</table></div>
  <p class="small">${T(`MTTR_hw 是剩余中断的平均暂停，所以硬件改动也会改变它：500k 推荐分配削减的五类（未归因、机柜供电、管理、存储、冷却）都没有恢复梯级，削减后剩余中断更多地由重执行、弹性与网络切换在几秒内处理。第 5 节把 MTTR 逐项分到各机制。`, `MTTR_hw is the mean pause of the remaining interruptions, so hardware changes move it too: the five classes cut at 500k (unattributed, cabinet power, management, storage, cooling) have no recovery rung, and after the cut more of the remaining interruptions are handled in seconds by replay, elastic and network failover. Section 5 splits the MTTR over the mechanisms.`)}</p>
  <figure class="chart f2">${f2.svg}<div class="tip"></div><figcaption>${T(`图 2：现状 ${num(Z(N_MAX).today.mttr.nom.mttrS, 1)} s（名义）中 ${pct((f2.designs[0].c.auto + f2.designs[0].c.manual + f2.designs[0].c.detect) / f2.designs[0].m.mttrS, 0)} % 是全局恢复（自动尝试 180 s、1 % 转人工 2 h）与检测延迟——尽管只有 ${pct(Z(N_MAX).today.mttr.nom.probs.global, 0)} % 的中断走到全局恢复。500k 的推荐分配把检测缩到约 1 s（D-HARD）、自动尝试缩到 60 s、人工缩到 30 min，并让 ${pct(Z(N_MAX).optimal.mttr.nom.probs.netfail, 0)} % 的中断由网络切换在几秒内吸收（R-NETFAIL）。`, `Figure 2: of today’s ${num(Z(N_MAX).today.mttr.nom.mttrS, 1)} s (nominal), ${pct((f2.designs[0].c.auto + f2.designs[0].c.manual + f2.designs[0].c.detect) / f2.designs[0].m.mttrS, 0)} % is the global recovery (automatic attempt 180 s, 1 % to a 2 h manual repair) and the detection delay — although only ${pct(Z(N_MAX).today.mttr.nom.probs.global, 0)} % of the interruptions reach the global recovery. The 500k recommended split cuts detection to about 1 s (D-HARD), the automatic attempt to 60 s and manual repair to 30 min, and lets network failover absorb ${pct(Z(N_MAX).optimal.mttr.nom.probs.netfail, 0)} % of the interruptions within seconds (R-NETFAIL).`)}</figcaption></figure>
  <details class="tv"><summary>${T('图 2 数据表', 'Figure 2 data table')}</summary>${f2.table}</details>
  <h2>${T(`5. 每项机制承担的 MTTR 与参数（${int(N_MAX)} NPU：现状 → 推荐分配）`, `5. MTTR carried by each mechanism, with its parameters (${int(N_MAX)} NPUs: today → recommended split)`)}</h2>
  <div class="table-wrap"><table class="dense">
    <tr><th>${T('阶段 / 梯级', 'Stage / rung')}</th><th>${T('机制', 'Mechanism')}</th><th>${T('现状参数（名义）', 'Parameters today (nominal)')}</th><th>${T('推荐分配参数（名义；降额）', 'Recommended parameters (nominal; derated)')}</th><th class="num">${T('终止于此的中断占比', 'Interruptions ending here')}</th><th class="num">${T('现状 MTTR 贡献 名义 / 降额 (s)', 'MTTR share today nom / der (s)')}</th><th class="num">${T('推荐 MTTR 贡献 名义 / 降额 (s)', 'MTTR share recommended nom / der (s)')}</th></tr>
    ${mechRows}
  </table></div>
  <p class="small">${T('各项按事件率加权，逐项相加正好等于 MTTR_hw（每个故障类都与引擎的平均暂停逐项核对）。弹性梯级成功时作业只暂停同步时间，故障域在后台恢复（容量损失计入有效产出，不计入 A_op 的暂停）。适用比例来自参考目录的逐事件标志（例如重执行只对可重执行的事件生效）。', 'Each line is rate-weighted; the lines add up exactly to MTTR_hw (every fault class is checked against the engine’s mean pause). When the elastic rung succeeds the job pauses only for the sync while the domain recovers in the background (that capacity loss counts in goodput, not in the A_op pause). Applicability comes from the reference catalog’s per-event flags (replay only acts on replayable events, etc.).')}</p>
  <h3>${T('全部机制的参数值（名义与降额）', 'Parameter values of the mechanisms (nominal and derated)')}</h3>
  <div class="table-wrap"><table class="dense"><tr><th>${T('机制', 'Mechanism')}</th><th>${T('角色', 'Role')}</th><th>${T('名义参数', 'Nominal parameters')}</th><th>${T('降额参数', 'Derated parameters')}</th></tr>${paramRows}
    <tr><td>${T('恢复混合模型（全局恢复）', 'Recovery mixture (global recovery)')}</td><td>${T('现状 → 500k 推荐', 'today → 500k recommended')}</td><td>${esc(`c ${mt.tn.recovery.detectionCoverage} · t_fast ${mt.tn.recovery.detectAutoS} s · t_timeout ${mt.tn.recovery.timeoutS} s · t_auto ${mt.tn.recovery.autoS} s · s ${mt.tn.recovery.success} · t_manual ${mt.tn.recovery.manualS} s → c ${mt.on.recovery.detectionCoverage} · t_fast ${mt.on.recovery.detectAutoS} s · t_auto ${mt.on.recovery.autoS} s · t_manual ${mt.on.recovery.manualS} s`)}</td><td>${esc(`c ${num(mt.od.recovery.detectionCoverage, 3)} · t_fast ${mt.od.recovery.detectAutoS} s · t_auto ${mt.od.recovery.autoS} s · s ${mt.od.recovery.success} · t_manual ${mt.od.recovery.manualS} s`)}</td></tr>
  </table></div>
  <div class="verdict">${T(`<b>总结（A3 · CloudMatrix384，A_op ≥ ${pct(TARGET, 1)} %）：</b>要求是 MTTR_hw / MTBF_hw ≤ B ≈ ${num(Z(N_MAX).required.B, 0)}–${num(Z(SIZES[0]).required.B, 0)} 秒/小时。10k 与 100k 用默认六项机制即可（MTTR ${num(Z(SIZES[0]).today.der.mttrS, 0)} s，MTBF_hw ${sig(Z(SIZES[0]).today.der.mtbfHwH)} / ${sig(Z(100000).today.der.mtbfHwH)} h）；200k 把自动尝试缩到 60 s，MTTR_hw 降到 ${num(z200.optimal.der.mttrS, 1)} s 即可，不需改硬件；500k 需要 MTBF_hw ${fmtMtbf(kOpt500.mtbfHwH)} 且 MTTR_hw ${num(kOpt500.mttrS, 1)} s（降额）：硬件上机柜 ≥ ${fy(yrs(U[N_MAX].rec.cabinet.mtbfAllowedH))} 年、作业级服务 ≥ ${fy(yrs(U[N_MAX].rec.job.mtbfAllowedH))} 年、节点 ≥ ${fy(yrs(U[N_MAX].rec.node.mtbfAllowedH))} 年；机制上检测 ≈ 1 s（D-HARD）、网络切换（R-NETFAIL）、自动尝试 60 s、人工 30 min。`, `<b>Summary (A3 · CloudMatrix384, A_op ≥ ${pct(TARGET, 1)} %):</b> the requirement is MTTR_hw / MTBF_hw ≤ B ≈ ${num(Z(N_MAX).required.B, 0)}–${num(Z(SIZES[0]).required.B, 0)} seconds per hour. 10k and 100k work with the six default mechanisms (MTTR ${num(Z(SIZES[0]).today.der.mttrS, 0)} s, MTBF_hw ${sig(Z(SIZES[0]).today.der.mtbfHwH)} / ${sig(Z(100000).today.der.mtbfHwH)} h); 200k only needs the automatic attempt cut to 60 s, which brings MTTR_hw to ${num(z200.optimal.der.mttrS, 1)} s, with no hardware change; 500k needs MTBF_hw ${fmtMtbf(kOpt500.mtbfHwH)} and MTTR_hw ${num(kOpt500.mttrS, 1)} s (derated): on the hardware side cabinets ≥ ${fy(yrs(U[N_MAX].rec.cabinet.mtbfAllowedH))} years, job-level services ≥ ${fy(yrs(U[N_MAX].rec.job.mtbfAllowedH))}, nodes ≥ ${fy(yrs(U[N_MAX].rec.node.mtbfAllowedH))}; on the mechanism side detection ≈ 1 s (D-HARD), network failover (R-NETFAIL), automatic attempt 60 s, manual repair 30 min.`)}</div>
  <div class="callout">${T('<b>注意：</b>① MTBF 与 MTTR 之间的分配取工作量最小的组合（v4 最优）；工作量分数是假设，改变分数会改变分配（例如 200k 时仅硬件也可，工作量 5.19 对杠杆 3）。② 机制参数按机制库取值，不是求出的“最低需要值”；本文给出的是达到要求时各项参数的取值与它们承担的 MTTR。③ 隔离、已检出静默错误等事件类各有自己的 MTBF 与 MTTR，没有并入 MTBF_hw；它们决定预算 B 中的 F。④ 故障率为参考目录先验（假设），须以本集群实测替换。', '<b>Notes:</b> ① the split between MTBF and MTTR is the least-effort combination (v4 optimal); the effort scores are assumptions and other scores give another split (e.g. at 200k hardware alone also works, effort 5.19 against 3 for the lever). ② Mechanism parameters are the library values, not solved minimum values; the document gives the values at which the requirement is met and the MTTR each carries. ③ Isolation, detected silent corruption and the other event classes keep their own MTBF and MTTR and are not merged into MTBF_hw; they set F in the budget B. ④ Failure rates are the reference catalog’s priors (assumed) and must be replaced by measurements of the cluster.')}</div>
  <footer>${T('复现', 'Reproduce')}：<code>node --import tsx scripts/mtbf-mttr-topdown.ts</code> → <code>node scripts/build-mtbf-mttr-topdown.mjs</code>；${T('界面：拓扑页选模板与规模 → 分配页「策略」（目标 0.985）', 'in the app: Topology page (template and scale) → Allocation → Strategies (target 0.985)')}；CLI <code>hacd strategy --template a3-ub384 --npus 500000 --target 0.985</code>。</footer>
</section>
</main>
<script>
(function(){
  function tipFor(el){ var f = el.closest('figure'); if(!f) return null; var t = f.querySelector('.tip'); if(!t){ t = document.createElement('div'); t.className='tip'; f.appendChild(t);} return t; }
  function place(t, f, ev){ var r = f.getBoundingClientRect(); var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14; if (x + 370 > r.width) x = Math.max(0, ev.clientX - r.left - 370); t.style.left = x + 'px'; t.style.top = y + 'px'; }
  document.querySelectorAll('[data-tip]').forEach(function(el){ el.addEventListener('mousemove', function(ev){ var f = el.closest('figure'); var t = tipFor(el); if(!t) return; t.textContent = el.getAttribute('data-tip'); t.style.display='block'; place(t, f, ev); }); el.addEventListener('mouseleave', function(){ var t = tipFor(el); if(t) t.style.display='none'; }); });
})();
</script>
</body>
</html>
`;
  const out = `docs/MTBF_MTTR_TOPDOWN.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
build('en');
build('zh');
