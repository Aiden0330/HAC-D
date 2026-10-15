#!/usr/bin/env node
/**
 * Build docs/AVAILABILITY_ALLOCATION_98P5.zh.html (two-page study, three inline SVG charts with hover tooltips and table views)
 * from docs/availability-98p5/results.json (written by scripts/availability-allocation-98p5.ts). Standalone SVGs are written
 * next to the JSON. Usage: node scripts/build-availability-98p5.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const R = JSON.parse(readFileSync('docs/availability-98p5/results.json', 'utf8'));
const OUT_HTML = 'docs/AVAILABILITY_ALLOCATION_98P5.zh.html';
const OUT_DIR = 'docs/availability-98p5';
mkdirSync(OUT_DIR, { recursive: true });

/* ---------- helpers ---------- */
const pct = (x, d = 2) => (x * 100).toFixed(d);
const pt = (x, d = 2) => (x * 100).toFixed(d);
const sgn = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d);
const num = (x, d = 2) => Number(x).toFixed(d);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kfmt = (N) => (N >= 1e6 ? `${(N / 1e6).toFixed(N % 1e6 ? 1 : 0)}M` : N >= 1e5 ? `${Math.round(N / 1e3)}k` : `${(N / 1e3).toFixed(1).replace(/\.0$/, '')}k`);
const zhN = (N) => ({ 10000: '1 万卡', 100000: '10 万卡', 200000: '20 万卡', 500000: '50 万卡' })[N] ?? `${N}`;
const zhNs = (N) => ({ 10000: '1 万', 100000: '10 万', 200000: '20 万', 500000: '50 万' })[N] ?? `${N}`;
const SIZES = R.sizes;
const P = R.perSize;
const LIB = R.library;
const mechName = (id) => LIB[id]?.name?.zh ?? id;
const GROUPS = [['npu', 'NPU 芯片与内存'], ['network', '网络'], ['host', '主机'], ['facility', '机房设施'], ['storageSoftware', '存储 / 软件 / 未归因'], ['other', '亚健康隔离与静默暂停']];
const groupVals = (d) => { const o = { ...d.byGroup }; o.other = (o.isolation ?? 0) + (o.sdcPause ?? 0); return GROUPS.map(([k]) => o[k] ?? 0); };
const isFeasible = (N) => P[N].plan.feasible;
const planLabel = (N) => (P[N].plan.ids.length ? P[N].plan.ids.join(' + ') : '无需机制');

/* ---------- SVG chrome ---------- */
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const STYLE = `
svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec;
  --h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835;
  --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; } }
:root[data-theme="light"] svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; --h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; }
:root[data-theme="dark"] svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; }
svg.viz text { fill: var(--ink); font-size: 12px; }
svg.viz .t2 { fill: var(--ink2); font-size: 11.5px; }
svg.viz .m { fill: var(--muted); font-size: 11px; }
svg.viz .tick { font-variant-numeric: tabular-nums; }
svg.viz .ttl { font-size: 13px; font-weight: 600; }
svg.viz .grid { stroke: var(--grid); stroke-width: 1; }
svg.viz .axis { stroke: var(--axis); stroke-width: 1; }
svg.viz .ref { stroke: var(--ink2); stroke-width: 1; }
svg.viz .hit { fill: transparent; pointer-events: all; }
svg.viz .xh { pointer-events: none; }
svg.viz .cellt { font-size: 12px; font-variant-numeric: tabular-nums; }
svg.viz .onDark { fill: var(--surface); }
`;
const svgOpen = (id, W, H) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
const svgClose = '</svg>';
const legend = (x, y, items, kind = 'line') => items.map((it, i) => { const lx = x + it.offset; return kind === 'line' ? `<line x1="${lx}" x2="${lx + 18}" y1="${y}" y2="${y}" stroke="var(--s${it.slot + 1})" stroke-width="2.5" stroke-linecap="round"/><text x="${lx + 24}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--s${it.slot + 1})"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join('');
const textW = (s) => Array.from(s).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.6), 0);
function layoutLegend(items) { let off = 0; return items.map((it) => { const o = off; off += 30 + textW(it.name) + 14; return { ...it, offset: o }; }); }

/* ---------- Chart 1: A_op vs N ---------- */
function chartAop() {
  const W = 960, H = 372, L = 54, Rm = 150, Tp = 54, B = 40, pw = W - L - Rm, ph = H - Tp - B;
  const lx0 = Math.log10(5000), lx1 = Math.log10(1e6);
  const xs = (N) => L + ((Math.log10(N) - lx0) / (lx1 - lx0)) * pw;
  const ys = (a) => Tp + ((1 - a) / 0.2) * ph; // 100 % at top, 80 % at bottom
  const series = [
    { key: 'baseline', name: '基线（无机制）', short: '基线', slot: 0 },
    { key: 'plan100k', name: '仅 R-ELASTIC（10 万卡方案）', short: '仅 R-ELASTIC', slot: 1 },
    { key: 'plan200k', name: '20 万卡方案（7 项）', short: '20 万卡方案', slot: 2 },
    { key: 'allOn', name: '全部 10 项同时启用', short: '全部 10 项', slot: 3 },
  ];
  const grid = R.curves.baseline.points.map((p) => p.N);
  let g = svgOpen('chart-aop', W, H);
  g += `<text x="${L}" y="20" class="ttl">图 1 · 运行可用率 A_op 随集群规模的变化（30 天窗口，名义参数实线，色带到降额参数的下限）</text>`;
  g += legend(L, 38, layoutLegend(series));
  // grid + axes
  for (let v = 80; v <= 100; v += 5) { const y = ys(v / 100); g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="m tick">${v} %</text>`; }
  for (const N of [5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]) { const x = xs(N); g += `<line x1="${x}" x2="${x}" y1="${Tp + ph}" y2="${Tp + ph + 5}" class="axis"/><text x="${x}" y="${Tp + ph + 18}" text-anchor="middle" class="m tick">${kfmt(N)}</text>`; }
  g += `<line x1="${L}" x2="${L + pw}" y1="${Tp + ph}" y2="${Tp + ph}" class="axis"/>`;
  g += `<text x="${L + 150}" y="${H - 6}" text-anchor="middle" class="m">集群规模 N（卡，对数轴）</text>`;
  // target line
  const yT = ys(R.target);
  g += `<line x1="${L}" x2="${L + pw}" y1="${yT}" y2="${yT}" class="ref"/><text x="${L + 6}" y="${yT - 5}" class="t2">目标 A_op ≥ ${pct(R.target, 1)} %</text>`;
  // bands then lines
  for (const s of series) {
    const nom = R.curves[s.key].points, der = R.curves[s.key + 'Derated'].points;
    const poly = nom.map((p) => `${xs(p.N).toFixed(1)},${ys(Math.max(0.8, p.aOp)).toFixed(1)}`).concat(der.slice().reverse().map((p) => `${xs(p.N).toFixed(1)},${ys(Math.max(0.8, p.aOp)).toFixed(1)}`)).join(' ');
    g += `<polygon points="${poly}" fill="var(--s${s.slot + 1})" opacity="0.14"/>`;
  }
  const labels = [];
  for (const s of series) {
    const nom = R.curves[s.key].points;
    const d = nom.map((p, i) => `${i ? 'L' : 'M'}${xs(p.N).toFixed(1)} ${ys(Math.max(0.8, p.aOp)).toFixed(1)}`).join(' ');
    g += `<path d="${d}" fill="none" stroke="var(--s${s.slot + 1})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const N of SIZES) { const p = nom.find((q) => q.N === N); if (p && p.aOp >= 0.8) g += `<circle cx="${xs(N).toFixed(1)}" cy="${ys(p.aOp).toFixed(1)}" r="4" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`; }
    const last = nom[nom.length - 1];
    labels.push({ y: ys(Math.max(0.8, last.aOp)), text: `${s.short} ${pct(last.aOp, 1)} %`, slot: s.slot });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  for (const lb of labels) g += `<text x="${L + pw + 8}" y="${lb.y + 4}" class="t2">${esc(lb.text)}</text>`;
  // max-N markers on the target line
  const marks = series.map((s) => ({ s, N: R.curves[s.key].maxN, Nd: R.curves[s.key + 'Derated'].maxN })).filter((m) => m.N > 5000 && m.N < 1e6).sort((a, b) => a.N - b.N);
  let prevX = -1e9, prevUp = false;
  marks.forEach((m) => { const x = xs(m.N); const up = x - prevX < 44 && !prevUp; prevX = x; prevUp = up; g += `<circle cx="${x.toFixed(1)}" cy="${yT}" r="4.5" fill="var(--s${m.s.slot + 1})" stroke="var(--surface)" stroke-width="2"/><text x="${x.toFixed(1)}" y="${up ? yT - 11 : yT + 17}" text-anchor="middle" class="t2 tick">${kfmt(m.N)}</text>`; });
  g += `<text x="${L + pw}" y="${H - 6}" text-anchor="end" class="m">● 目标线上的圆点：名义参数下仍满足 98.5 % 的最大规模</text>`;
  // crosshair + hit area
  g += `<g class="xh" id="aop-xh" style="display:none"><line id="aop-xl" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" class="ref"/>${series.map((s) => `<circle id="aop-c${s.slot}" r="5" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g>`;
  g += `<rect class="hit" id="aop-hit" x="${L}" y="${Tp}" width="${pw}" height="${ph}"/>`;
  g += svgClose;
  const data = { grid, x: grid.map((N) => +xs(N).toFixed(1)), series: series.map((s) => ({ name: s.name, nominal: R.curves[s.key].points.map((p) => p.aOp), derated: R.curves[s.key + 'Derated'].points.map((p) => p.aOp), y: R.curves[s.key].points.map((p) => +ys(Math.max(0.8, p.aOp)).toFixed(1)) })) };
  const table = `<table class="tv"><tr><th>N</th>${series.map((s) => `<th>${esc(s.name)}<br><span class="small">名义 / 降额</span></th>`).join('')}</tr>${grid.map((N, i) => `<tr><td class="num">${N.toLocaleString('en-US')}</td>${series.map((s) => `<td class="num">${pct(R.curves[s.key].points[i].aOp)} / ${pct(R.curves[s.key + 'Derated'].points[i].aOp)}</td>`).join('')}</tr>`).join('')}<tr><td>满足 98.5 % 的最大 N</td>${series.map((s) => `<td class="num">${R.curves[s.key].maxN.toLocaleString('en-US')} / ${R.curves[s.key + 'Derated'].maxN.toLocaleString('en-US')}</td>`).join('')}</tr></table>`;
  return { svg: g, data, table };
}

/* ---------- Chart 2: unavailability composition ---------- */
function chartUnavail() {
  const rows = [];
  for (const N of SIZES) { rows.push({ label: `${zhNs(N)} · 基线`, N, kind: '基线', vals: groupVals(P[N].baseline) }); rows.push({ label: `${zhNs(N)} · 方案`, N, kind: '方案', vals: groupVals(P[N].planned) }); }
  const W = 960, L = 118, Rm = 70, Tp = 66, rowP = 25, groupGap = 9, barH = 15, B = 36;
  const H = Tp + rows.length * rowP + (SIZES.length - 1) * groupGap + B;
  const pw = W - L - Rm;
  const xmax = 12;
  const xs = (v) => L + (v / xmax) * pw;
  let g = svgOpen('chart-unavail', W, H);
  g += `<text x="${L}" y="20" class="ttl">图 2 · 不可用度的构成（百分点 = 100 − A_op）：基线 vs 该规模的推荐机制方案，预算线 1.5 pt</text>`;
  g += legend(L, 38, layoutLegend(GROUPS.map(([, name], i) => ({ name, slot: i }))), 'rect');
  const plotTop = Tp, plotBot = H - B;
  for (let v = 0; v <= xmax; v += 2) { const x = xs(v); g += `<line x1="${x}" x2="${x}" y1="${plotTop - 4}" y2="${plotBot}" class="grid"/><text x="${x}" y="${plotBot + 16}" text-anchor="middle" class="m tick">${v}</text>`; }
  g += `<text x="${L + pw}" y="${plotBot + 30}" text-anchor="end" class="m">不可用度（百分点）</text>`;
  const xb = xs((1 - R.target) * 100);
  g += `<line x1="${xb}" x2="${xb}" y1="${plotTop - 4}" y2="${plotBot}" class="ref"/><text x="${xb + 4}" y="${plotTop - 8}" class="t2">预算 ${((1 - R.target) * 100).toFixed(1)} pt</text>`;
  let y = plotTop + 4;
  const tips = [];
  rows.forEach((r, ri) => {
    if (ri > 0 && ri % 2 === 0) y += groupGap;
    const total = r.vals.reduce((a, b) => a + b, 0);
    g += `<text x="${L - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="t2">${esc(r.label)}</text>`;
    let x = L;
    r.vals.forEach((v, gi) => {
      const w = (v * 100 / xmax) * pw;
      if (w > 0.2) {
        const wi = Math.max(0, w - (gi < r.vals.length - 1 ? 2 : 0));
        const tip = `${esc(r.label)}（${esc(planLabel(r.N))}）\n${esc(GROUPS[gi][1])}：${pt(v)} pt，占 ${(v / total * 100).toFixed(1)} %`;
        g += `<rect x="${x.toFixed(1)}" y="${y}" width="${wi.toFixed(1)}" height="${barH}" rx="${gi === r.vals.length - 1 ? 3 : 0}" fill="var(--s${gi + 1})" data-tip="${tip}"/>`;
      }
      x += w;
    });
    g += `<text x="${(x + 6).toFixed(1)}" y="${y + barH / 2 + 4}" class="t2 tick">${pt(total)}</text>`;
    y += rowP;
  });
  g += svgClose;
  const table = `<table class="tv"><tr><th>行</th><th>方案</th>${GROUPS.map(([, n]) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">合计 pt</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(planLabel(r.N))}</td>${r.vals.map((v) => `<td class="num">${pt(v, 3)}</td>`).join('')}<td class="num">${pt(r.vals.reduce((a, b) => a + b, 0), 3)}</td></tr>`).join('')}</table>`;
  return { svg: g, table };
}

/* ---------- Chart 3: Shapley heatmap ---------- */
function chartShapley() {
  const ids = R.players.slice().sort((a, b) => avgShap(b) - avgShap(a));
  function avgShap(id) { return SIZES.reduce((s, N) => s + P[N].gains.find((x) => x.id === id).aOp.shapley, 0) / SIZES.length; }
  const vmax = Math.max(...SIZES.flatMap((N) => P[N].gains.map((x) => Math.abs(x.aOp.shapley))));
  const W = 960, L = 262, colW = 128, rowH = 28, Tp = 58, effW = 70, legH = 50;
  const H = Tp + ids.length * rowH + legH;
  let g = svgOpen('chart-shapley', W, H);
  g += `<text x="16" y="20" class="ttl">图 3 · 各机制对 A_op 的 Shapley 贡献（百分点，10 项机制全组合精确值）；带框 = 该规模推荐方案所含机制</text>`;
  g += `<text x="16" y="${Tp - 8}" class="m">机制（按平均贡献排序）</text>`;
  SIZES.forEach((N, j) => { g += `<text x="${L + j * colW + colW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">${zhN(N)}</text>`; });
  g += `<text x="${L + SIZES.length * colW + effW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">工作量</text>`;
  const cls = (v) => { if (Math.abs(v) < 0.0005) return 'mid'; const k = Math.min(4, Math.floor((Math.abs(v) / vmax) * 4) + 1); return (v > 0 ? 'h' : 'n') + k; };
  ids.forEach((id, i) => {
    const y = Tp + i * rowH;
    g += `<text x="16" y="${y + rowH / 2 + 4}" class="t2">${esc(id)} <tspan class="m">${esc(mechName(id))}</tspan></text>`;
    SIZES.forEach((N, j) => {
      const gn = P[N].gains.find((x) => x.id === id);
      const v = gn.aOp.shapley;
      const c = cls(v);
      const x = L + j * colW;
      const inPlan = P[N].plan.ids.includes(id);
      const tip = `${esc(id)} ${esc(mechName(id))} · ${zhN(N)}\nShapley（A_op）${sgn(v, 3)} pt；单独启用 ${sgn(gn.aOp.single, 3)}；末位加入 ${sgn(gn.aOp.lastAdded, 3)}\nShapley（正确交付）${sgn(gn.delivered.shapley, 2)} pt${inPlan ? '\n在该规模的推荐方案中' : ''}`;
      g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" fill="var(--${c})" data-tip="${tip}"/>`;
      if (inPlan) g += `<rect x="${x + 4}" y="${y + 4}" width="${colW - 8}" height="${rowH - 8}" fill="none" stroke="var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 4}" y="${y + 4}" width="${colW - 8}" height="${rowH - 8}" fill="none" stroke="var(--ink)" stroke-width="1.5" pointer-events="none"/>`;
      const dark = c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';
      g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${dark ? ' onDark' : ''}" pointer-events="none">${sgn(v)}</text>`;
    });
    g += `<text x="${L + SIZES.length * colW + effW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2 tick">${LIB[id].effort}</text>`;
  });
  // diverging scale legend
  const ly = Tp + ids.length * rowH + 22;
  const steps = ['n4', 'n3', 'n2', 'n1', 'mid', 'h1', 'h2', 'h3', 'h4'];
  steps.forEach((c, i) => { g += `<rect x="${L + i * 26}" y="${ly}" width="24" height="12" fill="var(--${c})"/>`; });
  g += `<text x="${L - 6}" y="${ly + 10}" text-anchor="end" class="m tick">−${(vmax * 100).toFixed(1)} pt</text><text x="${L + 9 * 26 + 6}" y="${ly + 10}" class="m tick">+${(vmax * 100).toFixed(1)} pt</text><text x="${L + 4 * 26 + 12}" y="${ly + 24}" text-anchor="middle" class="m">0</text>`;
  g += `<text x="${L + 9 * 26 + 80}" y="${ly + 10}" class="m">负值 = 在该链序与参数下反而拉低 A_op（替代了更快的梯级、误报停顿）</text>`;
  g += svgClose;
  const table = `<table class="tv"><tr><th>机制</th>${SIZES.map((N) => `<th class="num">${zhN(N)}<br><span class="small">Shapley / 单独 / 末位（pt）</span></th>`).join('')}</tr>${ids.map((id) => `<tr><td>${esc(id)} ${esc(mechName(id))}</td>${SIZES.map((N) => { const gn = P[N].gains.find((x) => x.id === id); return `<td class="num">${sgn(gn.aOp.shapley)} / ${sgn(gn.aOp.single)} / ${sgn(gn.aOp.lastAdded)}</td>`; }).join('')}</tr>`).join('')}</table>`;
  return { svg: g, table, ids };
}

/* ---------- tables ---------- */
const GLYPH = (b) => (b ? '●' : '○');
function summaryTable() {
  const row = (label, f) => `<tr><td class="k">${label}</td>${SIZES.map((N) => `<td>${f(N, P[N])}</td>`).join('')}</tr>`;
  const topGroups = (d) => { const o = { ...d.byGroup }; o.other = (o.isolation ?? 0) + (o.sdcPause ?? 0); const tot = GROUPS.reduce((a, [k]) => a + (o[k] ?? 0), 0); return GROUPS.map(([k, n]) => [n, o[k] ?? 0]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, v]) => `${n} ${(v / tot * 100).toFixed(0)} %`).join('，'); };
  return `<div class="table-wrap"><table>
<tr><th style="width:21%">量（30 天窗口，A_op 口径）</th>${SIZES.map((N) => `<th>${zhN(N)}</th>`).join('')}</tr>
${row('基线 A_op · 缺口', (N, z) => `${pct(z.baseline.aOp)} % · ${z.baseline.aOp >= R.target ? `余量 ${pt(z.baseline.aOp - R.target)}` : `缺 ${pt(R.target - z.baseline.aOp)}`} pt`)}
${row('作业中断率 λ_job · MTBI · R̄', (N, z) => `${num(z.baseline.lambdaJob, 3)} /h · ${num(z.baseline.mtbiHours, 1)} h · ${num(z.baseline.recoveryS, 0)} s`)}
${row('仅改硬件：故障率 × f（允许 FIT 合计）· MTBI ≥ · 最小努力法', (N, z) => `× ${num(z.hardwareOnly.factor, 3)}（${num(3333.3 * z.hardwareOnly.factor, 0)} FIT）· ${num(z.hardwareOnly.mtbiStarHours, 2)} h · ${z.hardwareOnly.minimumEffort && z.hardwareOnly.minimumEffort.rows.some((r) => r.improvementFactor > 1.0001) ? `${z.hardwareOnly.minimumEffort.rows.filter((r) => r.improvementFactor > 1.0001).length} 个域降到 ${num(z.hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)} FIT` : '已满足'}`)}
${row('仅改恢复：R̄ 须 ≤ · 阶段预算 检测 / 自动 / 人工份额', (N, z) => `${num(z.recoveryOnly.recoveryStarS, 0)} s（× ${num(z.recoveryOnly.factor, 3)}）· ${z.recoveryOnly.stages.map((s) => num(s.budgetS, 0)).join(' / ')} s`)}
${row('推荐机制集（最低工作量可行集）· 工作量 · 必要机制', (N, z) => `${z.plan.feasible ? '' : '<b>无可行集</b>；价值最高的集：'}${esc(planLabel(N))} · ${z.plan.effort}${z.plan.necessary.length ? ' · 必要：' + esc(z.plan.necessary.join('+')) : z.plan.feasible ? ' · 基线已达标' : ''}`)}
${row('方案 A_op 名义 / 降额', (N, z) => `${pct(z.plan.nominal)} / ${pct(z.plan.derated)} %${z.plan.feasible ? '' : '（不达标）'}`)}
${row('方案后硬件因子（名义 / 降额）', (N, z) => `× ${num(z.residualFactor.plan, 2)} / × ${num(z.residualFactor.planDerated, 2)}${z.residualFactor.plan >= 1 ? '（余量）' : '（仍须改进）'}`)}
${row('校核（200 窗口）：P(A_op ≥ 98.5 %) [Wilson 95 %] · 判定 · 均值 ± t 半宽 · 5 % 分位', (N, z) => `${pct(z.verification.pAtLeastTarget, 1)} % [${pct(z.verification.wilson[0], 1)}–${pct(z.verification.wilson[1], 1)}] · <b>${z.verification.verdict}</b> · ${pct(z.verification.aOp.mean)} ± ${pct(z.verification.aOp.ci95)} · ${pct(z.verification.aOp.p05)} %`)}
${row('方案后残余不可用的主要来源', (N, z) => topGroups(z.planned))}
</table></div>`;
}
function domainTable() {
  const d200 = P[200000].planned.byDomain;
  const rows = R.domains.slice().sort((a, b) => b.fit - a.fit);
  const flags = (d) => [d.replay ? 'r' : '', d.process ? 'p' : '', d.elastic ? 'e' : '', ['NIC', 'OPT', 'BOXIO', 'FABRIC'].includes(d.id) ? 'n' : '', d.elastic ? 'h' : '', d.persistence === 'persistent' && (d.scope === 'card' || d.scope === 'server') ? 'f' : ''].filter(Boolean).join(' ') || '<b>无</b>';
  const improved = (N, id) => { const me = P[N].hardwareOnly.minimumEffort; const r = me?.rows.find((x) => x.id === id); return GLYPH(!!r && r.improvementFactor > 1.0001); };
  return `<div class="table-wrap"><table class="dense">
<tr><th>域</th><th class="num">当前 FIT</th><th class="num">占 λ</th><th>梯级<sup>†</sup></th><th class="num">20 万方案后<br>停顿 s · 残余</th>${SIZES.map((N) => `<th class="num">${zhNs(N)}<br>允许 FIT</th>`).join('')}<th>最小努力<br>10/20/50 万</th></tr>
${rows.map((d) => `<tr><td class="k">${esc(d.id)} <span class="small">${esc(d.domain)}</span></td><td class="num">${num(d.fit, 1)}</td><td class="num">${(d.fit / 3333.33 * 100).toFixed(1)} %</td><td>${flags(d)}</td><td class="num">${num(d200[d.id].meanPauseS, 0)} · ${(d200[d.id].share * 100).toFixed(1)} %</td>${SIZES.map((N) => `<td class="num">${num(d.fit * P[N].residualFactor.plan, 0)}</td>`).join('')}<td>${[100000, 200000, 500000].map((N) => improved(N, d.id)).join('')}</td></tr>`).join('')}
<tr><td class="k">合计</td><td class="num">3333.3</td><td class="num">100 %</td><td></td><td></td>${SIZES.map((N) => `<td class="num">${num(3333.3 * P[N].residualFactor.plan, 0)}</td>`).join('')}<td></td></tr>
</table></div>`;
}
function mechanismTable(ids) {
  const PK = { coverage: ['覆盖率', '', 1], detectSeconds: ['检测', ' s', 1], success: ['成功率', '', 1], successSeconds: ['成功耗时', ' s', 1], failureSeconds: ['失败耗时', ' s', 1], domains: ['域数', '', 1], recoverSeconds: ['域恢复', ' s', 1], syncSeconds: ['协调', ' s', 1], recall: ['召回', '', 1], precision: ['精度', '', 1], migrationSeconds: ['迁移', ' s', 1], computeSeconds: ['τ', ' s', 1], saveSeconds: ['δ', ' s', 1], loadSavingSeconds: ['加载节省', ' s', 1], overhead: ['开销', ' %', 100], share: ['占比', '', 1], reduction: ['剔除', '', 1], rateFactor: ['进入率×', '', 1], durationFactor: ['持续×', '', 1] };
  const fmtBoth = (nom, der) => Object.keys(nom).map((k) => { const [lab, unit, mul] = PK[k] ?? [k, '', 1]; const a = +(nom[k] * mul).toFixed(3), b = +(der[k] * mul).toFixed(3); return `${lab} ${a}${a !== b ? `→${b}` : ''}${unit}`; }).join('，');
  return `<div class="table-wrap"><table>
<tr><th>机制</th><th>参数：名义→降额（规划器降额后的值；无箭头 = 不降额）</th><th class="num">工作量</th><th>分配结论（进入方案与 Shapley 见图 3）</th></tr>
${ids.map((id) => { const L_ = LIB[id]; const inPlans = SIZES.map((N) => GLYPH(P[N].plan.ids.includes(id))).join(''); const sh = [100000, 200000, 500000].map((N) => P[N].gains.find((x) => x.id === id).aOp.shapley); const neg = sh.every((v) => v < 0); const nec = P[200000].plan.necessary.includes(id); const note = neg ? '不建议启用：替代更快梯级并带来误报停顿，贡献为负' : id === 'R-ELASTIC' ? '10 万卡起的首选单项（单独 +' + pt(P[100000].gains.find((x) => x.id === id).aOp.single, 2) + ' pt@10 万）；20 万卡起必要' : nec ? '20 万卡起必要；至少达到名义值，降额后仍须达标' : id === 'R-PROCESS' ? '与弹性互为替代，只在弹性不可用的事件上有用' : '低工作量补充项，收益随 N 线性增长'; return `<tr><td class="k">${esc(id)} <span class="small">${esc(L_.name.zh)}</span></td><td><span class="small">${esc(fmtBoth(L_.parameters, L_.derated))}</span></td><td class="num">${L_.effort}</td><td>${note}</td></tr>`; }).join('')}
</table></div>`;
}
function leverTable() {
  const names = { plan: '推荐机制集（库内参数）', auto60: '+ 自动恢复尝试 180 → 60 s', ps999: '+ 自动恢复成功率 99 → 99.9 %', manual30: '+ 人工恢复 120 → 30 min', 'auto60+ps999': '+ 自动 60 s 与成功率 99.9 %', 'auto60+manual30': '+ 自动 60 s 与人工 30 min', 'ps999+manual30': '+ 成功率 99.9 % 与人工 30 min', all3: '+ 三项同时' };
  const sizes = [200000, 500000];
  return `<div class="table-wrap"><table>
<tr><th>机制集之上的恢复参数杠杆</th>${sizes.map((N) => `<th class="num" colspan="3">${zhN(N)}：A_op 名义 / 降额 · 硬件因子</th>`).join('')}</tr>
${P[500000].levers.map((l, i) => ['auto60+manual30', 'ps999+manual30'].includes(l.id) ? '' : `<tr><td class="k">${esc(names[l.id] ?? l.id)}</td>${sizes.map((N) => { const z = P[N].levers[i]; return `<td class="num">${pct(z.aOp)} %</td><td class="num">${pct(z.aOpDerated)} %</td><td class="num">× ${num(z.residualFactor, 2)}</td>`; }).join('')}</tr>`).join('')}
</table></div>`;
}

/* ---------- assemble ---------- */
const c1 = chartAop(), c2 = chartUnavail(), c3 = chartShapley();
writeFileSync(`${OUT_DIR}/fig1-aop-vs-n.svg`, c1.svg);
writeFileSync(`${OUT_DIR}/fig2-unavailability.svg`, c2.svg);
writeFileSync(`${OUT_DIR}/fig3-shapley.svg`, c3.svg);
const z1 = P[10000], z2 = P[100000], z3 = P[200000], z4 = P[500000];
const g2 = (id) => z2.gains.find((x) => x.id === id).aOp;
const lever5 = (id) => z4.levers.find((l) => l.id === id);
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>98.5 % 可用率分配研究</title>
<meta name="description" content="54 条事件参考目录上，1 万 / 10 万 / 20 万 / 50 万卡集群在 98.5 % 运行可用率目标下的硬件故障率与机制参数分配、薄弱环节与关键机制（HAC-D，2026-10-15）。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; --ok:#2d7a4f; --crit:#b3382c; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#7cc89a; --crit:#e07a6f; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#7cc89a; --crit:#e07a6f; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
  main { max-width: 1120px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 22px 26px 26px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 23px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 16px; font-weight: 600; margin: 16px 0 6px; padding-top: 8px; border-top: 1px solid var(--rule); }
  h2.first { border-top: none; padding-top: 0; margin-top: 4px; }
  p { margin: 5px 0; }
  .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 6px; }
  .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
  footer, .eyebrow, p { overflow-wrap: anywhere; }
  .small { font-size: 11.3px; color: var(--muted); }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.8px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3.5px 6px; text-align: left; vertical-align: top; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.3px; }
  td.k { white-space: nowrap; font-weight: 500; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  figure.chart { margin: 8px 0 10px; position: relative; }
  figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  details.tv { margin: -2px 0 10px; font-size: 11.5px; overflow-x: auto; } details.tv summary { cursor: pointer; color: var(--accent); }
  table.tv { font-size: 11px; } table.tv th, table.tv td { padding: 2px 5px; }
  .tip { position: absolute; z-index: 5; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 11.5px; line-height: 1.4; padding: 6px 9px; border-radius: 6px; white-space: pre-line; max-width: 320px; box-shadow: 0 2px 8px rgba(0,0,0,.25); display: none; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
  .box { background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; padding: 7px 11px; }
  .box h3 { margin: 0 0 4px; font-size: 12.5px; }
  .box p, .box li { margin: 3px 0; font-size: 12.2px; }
  .box ul { margin: 2px 0 2px; padding-left: 16px; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; }
  @media screen and (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.7px; line-height: 1.36; }
    main { max-width: none; padding: 0; }
    .page { border: none; border-radius: 0; padding: 0; margin: 0; }
    .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7.3px; line-height: 1.28; } th, td { padding: 1px 2.5px; }
    .f { font-size: 8px; } code { font-size: 7.4px; } .small { font-size: 7.2px; } .box p, .box li, .callout, .sub, footer { font-size: 7.9px; } .box h3 { font-size: 8.6px; margin-bottom: 2px; } .box ul { padding-left: 12px; }
    h1 { font-size: 15px; margin: 2px 0 3px; } h2 { font-size: 11.3px; margin: 6px 0 3px; padding-top: 4px; } .eyebrow { font-size: 8px; }
    figure.chart { margin: 3px 0 4px; } figcaption { font-size: 7.6px; margin-top: 1px; }
    details.tv { display: none; } .tip { display: none !important; }
    .grid2 { gap: 4px 10px; } .box { padding: 3px 7px; } .callout { margin: 4px 0; padding: 3px 7px; } p { margin: 2px 0; }
    .table-wrap { overflow: visible; }
    figure.chart.c1 svg { height: 244px; } figure.chart.c2 svg { height: 214px; } figure.chart.c3 svg { height: 250px; }
    #p1 .table-wrap:first-of-type table { font-size: 7.05px; line-height: 1.24; }
    .box li { font-size: 7.6px; } .callout { font-size: 7.7px; } footer { font-size: 7.4px; }
    table.dense { font-size: 7px; line-height: 1.22; } table.dense th, table.dense td { padding: 0.5px 2px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D · 分配研究 · ${R.generated.slice(0, 10)} · 第 1 / 2 页</div>
  <h1>98.5 % 运行可用率目标下的可靠性分配：1 万、10 万、20 万、50 万卡集群</h1>
  <p class="sub"><b>口径</b>：A_op = 作业窗口（30 天）内的运行时间占比 = 1 − 停机 / T，停机含检测时延、自动恢复、人工兜底与亚健康隔离暂停，不含 checkpoint 保存、回滚与静默错误损失（后者进入"正确交付"goodput，另一口径；10 万卡基线正确交付仅 ${pct(z2.baseline.delivered, 1)} %）。<b>对象</b>：54 条事件的参考审核目录（18 个硬件域 × 中断 / 亚健康 / 静默，业务影响 FIT 合计 3333.3 / 69.0 / 48.3 每卡·小时，先验值），基线恢复 95 % @ 10 s + 60 s 超时、自动尝试 180 s @ 99 %、人工 2 h（R̄ = 264.5 s）。<b>目标</b>：均值 A_op ≥ 98.5 %，即不可用度预算 1.5 pt，<span class="f">Σλᵢ·p̄ᵢ ≤ (1 − A*)/A* = ${num(z1.unavailabilityBudget, 5)}</span>；校核用 200 个窗口的账本仿真 P(窗口 A_op ≥ 98.5 %) 对 90 % 置信度（Wilson 区间）。机制参数为机制库目标值（先验），规划器按覆盖率 −5 pt、成功率 −8 pt、时间 ×1.5 降额后仍须达标。图 1、图 2 在第 1 页，机制归因、参数与硬件 FIT 分配在第 2 页。</p>

  <h2 class="first">1. 四个规模的分配结果一览</h2>
  ${summaryTable()}
  <p class="small">仅改硬件 / 仅改恢复：所有中断率（或所有恢复阶段时间）乘同一因子，二分求刚好达标的因子（ARINC 等比，各域改进倍数相同）；最小努力法（Albert）只把最差的域拉到共同水平。推荐机制集 = 规划器在 10 项候选的 1024 个组合中找出的最低工作量可行集（50 万卡无可行集时给出价值最高的集）。硬件因子 ≥ 1 为余量，&lt; 1 为仍须改进的倍数。</p>

  <h2>2. 机制集之上的恢复参数杠杆（库外参数，20 万与 50 万卡）</h2>
  ${leverTable()}
  <p class="small">50 万卡：7 项机制集只到 ${pct(z4.plan.nominal)} %，缺口须由恢复参数或硬件补足——自动尝试 60 s 与成功率 99.9 % 两项即达 ${pct(lever5('auto60+ps999').aOp)} %（降额 ${pct(lever5('auto60+ps999').aOpDerated)} %），三项同时 ${pct(lever5('all3').aOp)} %，硬件余量 × ${num(lever5('all3').residualFactor, 2)}；否则硬件中断率须降到 ${pct(z4.residualFactor.plan, 1)} %（× ${num(1 / z4.residualFactor.plan, 2)}）。</p>
  <figure class="chart c1">${c1.svg}<div class="tip" id="tip-aop"></div><figcaption>图 1：基线在 ${kfmt(R.curves.baseline.maxN)} 卡以下即可达标；仅加 DP 域弹性把上限推到 ${kfmt(R.curves.plan100k.maxN)} 卡（降额 ${kfmt(R.curves.plan100kDerated.maxN)}）；20 万卡方案推到 ${kfmt(R.curves.plan200k.maxN)} 卡（降额 ${kfmt(R.curves.plan200kDerated.maxN)}）；全部 10 项同时启用反而降到 ${kfmt(R.curves.allOn.maxN)} 卡，因为热替换与预测迁移替代了更快的梯级。</figcaption></figure>
  <details class="tv"><summary>图 1 数据表</summary>${c1.table}</details>

  <figure class="chart c2">${c2.svg}<figcaption>图 2：基线的不可用度按域分组（各域停顿相同，占比即中断率占比：NPU 芯片与内存 ${(groupVals(z2.baseline)[0] / (1 - z2.baseline.aOp) * 100).toFixed(0)} %）；方案把有梯级的域压到数秒的停顿，残余集中在没有任何梯级的供电 / 冷却 / 管理 / 存储 / 未归因事件（20 万卡方案后占 ${((groupVals(z3.planned)[3] + groupVals(z3.planned)[4]) / (1 - z3.planned.aOp) * 100).toFixed(0)} %）。</figcaption></figure>
  <details class="tv"><summary>图 2 数据表</summary>${c2.table}</details>
</section>

<section class="page" id="p2">
  <div class="eyebrow">HAC-D · 分配研究 · ${R.generated.slice(0, 10)} · 第 2 / 2 页</div>
  <h2 class="first">3. 关键机制：Shapley 归因与参数分配</h2>
  <figure class="chart c3">${c3.svg}<figcaption>图 3：R-REPLAY 与 R-ELASTIC 并列第一且互为替代（单独启用弹性 +${pt(g2('R-ELASTIC').single)} pt@10 万卡，末位加入仅 +${pt(g2('R-ELASTIC').lastAdded)}）；C-MEM、R-PROCESS、R-NETFAIL、H-LEMON、D-HARD 依次其后；R-HOTSWAP 与 P-PREDICT 在所有规模为负。所有贡献随 N 近似线性放大。</figcaption></figure>
  <details class="tv"><summary>图 3 数据表</summary>${c3.table}</details>
  ${mechanismTable(c3.ids)}


  <h2>4. 硬件故障率分配（每卡·小时 FIT，业务影响口径；允许值 = 当前 × 方案后硬件因子，ARINC 等比）</h2>
  ${domainTable()}
  <p class="small"><sup>†</sup>梯级（目录逐事件标记）：r 重执行、p 进程重调度、e DP 域弹性、n 网络切换、h 热替换、f 预测迁移。20 万方案后有梯级的域停顿降到 ${num(d200pause('CORE'), 0)} s（重执行）或 ${num(d200pause('NIC'), 0)} s（网络切换），无梯级的域仍是完整的全局恢复 ${num(z3.planned.globalS, 0)} s。最小努力列 ● = 仅靠硬件达标时该域须降到共同水平（10 / 20 / 50 万卡：${num(z2.hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)} / ${num(z3.hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)} / ${num(z4.hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)} FIT）。</p>

  <h2>5. 结论：各规模的薄弱环节与最重要的机制</h2>
  <div class="grid2">
    <div class="box"><h3>1 万卡：基线已达标（${pct(z1.baseline.aOp)} %，MTBI ${num(z1.baseline.mtbiHours, 0)} h）</h3><ul>
      <li>无需机制；硬件余量 × ${num(z1.residualFactor.plan, 1)}，恢复余量 × ${num(z1.recoveryOnly.factor, 1)}（R̄ 可放宽到 ${num(z1.recoveryOnly.recoveryStarS, 0)} s）；200 个窗口全部 ≥ 98.5 %（5 % 分位 ${pct(z1.verification.aOp.p05)} %）。</li>
      <li>相对薄弱环节：CORE（14 %）、UNKNOWN 未归因（12.3 %）、MEMT（12 %）占中断率 38 %。</li></ul></div>
    <div class="box"><h3>10 万卡：缺 ${pt(R.target - z2.baseline.aOp)} pt，一项机制即可</h3><ul>
      <li><b>R-ELASTIC</b>（50 域、98 %、180 s；工作量 5）单独把 A_op 提到 ${pct(z2.plan.nominal)} %（降额 ${pct(z2.plan.derated)} %），P(窗口 ≥ 98.5 %) = ${pct(z2.verification.pAtLeastTarget, 1)} %，supported；R-REPLAY（工作量 2）只到 ${pct(z2.plan.pareto.find((c) => c.ids.join() === 'R-REPLAY').value)} %。</li>
      <li>不改机制时硬件须 × ${num(z2.hardwareOnly.factor, 2)}（13 个域降到 123 FIT）或 R̄ ≤ ${num(z2.recoveryOnly.recoveryStarS, 0)} s；有方案后硬件余量 × ${num(z2.residualFactor.plan, 2)}。</li>
      <li>方案后薄弱环节转移到无梯级域：存储 / 软件 / 未归因 ${(groupVals(z2.planned)[4] / (1 - z2.planned.aOp) * 100).toFixed(0)} %、机房设施 ${(groupVals(z2.planned)[3] / (1 - z2.planned.aOp) * 100).toFixed(0)} %。</li></ul></div>
    <div class="box"><h3>20 万卡：缺 ${pt(R.target - z3.baseline.aOp)} pt，需要 7 项且余量极薄</h3><ul>
      <li>必要机制 <b>${esc(z3.plan.necessary.join(' + '))}</b>（1024 个组合中仅 ${z3.plan.feasibleCount} 个可行），加 H-LEMON、H-SWEEP 后名义 ${pct(z3.plan.nominal)} % / 降额 ${pct(z3.plan.derated)} %；校核 P = ${pct(z3.verification.pAtLeastTarget, 1)} % [${pct(z3.verification.wilson[0], 1)}–${pct(z3.verification.wilson[1], 1)}]，对 90 % 置信度判定 uncertain，5 % 分位 ${pct(z3.verification.aOp.p05)} %。</li>
      <li>薄弱环节：无梯级的 UNKNOWN（残余 ${(d200share('UNKNOWN') * 100).toFixed(0)} %）、POWER（${(d200share('POWER') * 100).toFixed(0)} %）、MGMT、STORAGE、COOL 合计 ${((d200share('UNKNOWN') + d200share('POWER') + d200share('MGMT') + d200share('STORAGE') + d200share('COOL')) * 100).toFixed(0)} %，以及全局恢复 ${num(z3.planned.globalS, 0)} s 中 72 s 的人工份额。要留余量：降低这些域的 FIT（第 4 节）或加一项恢复杠杆（自动尝试 60 s → ${pct(z3.levers.find((l) => l.id === 'auto60').aOp)} %）。</li></ul></div>
    <div class="box"><h3>50 万卡：缺 ${pt(R.target - z4.baseline.aOp)} pt，库内机制不够</h3><ul>
      <li>价值最高的集（${esc(z4.plan.ids.join(' + '))}，工作量 ${z4.plan.effort}）只到 ${pct(z4.plan.nominal)} %；全部 10 项反而 ${pct(z4.allOn.aOp)} %。</li>
      <li>可行路径：机制集 + 自动尝试 60 s + 成功率 99.9 %（${pct(lever5('auto60+ps999').aOp)} %），或 + 人工 30 min 三项同时（${pct(lever5('all3').aOp)} %，硬件余量 × ${num(lever5('all3').residualFactor, 2)}）；否则硬件中断率须降到当前的 ${pct(z4.residualFactor.plan, 0)} %（仅硬件时 ${pct(z4.hardwareOnly.factor, 0)} %，即 18 个域都降到 19 FIT）。</li>
      <li>薄弱环节：残余 ${pt(1 - z4.planned.aOp)} pt 中存储 / 软件 / 未归因占 ${(groupVals(z4.planned)[4] / (1 - z4.planned.aOp) * 100).toFixed(0)} %、机房设施占 ${(groupVals(z4.planned)[3] / (1 - z4.planned.aOp) * 100).toFixed(0)} %——都是没有任何梯级的事件类，单靠恢复参数无法消除；NPU 与主机已被弹性 / 进程重调度压到 ${((groupVals(z4.planned)[0] + groupVals(z4.planned)[2]) / (1 - z4.planned.aOp) * 100).toFixed(0)} %。</li></ul></div>
  </div>
  <div class="callout">跨规模的共同结论：① 最重要的机制是<b>不回滚的快速梯级</b>（R-ELASTIC 或 R-REPLAY，互为替代）加 <b>C-MEM</b>（缩短全局恢复 60 s）和 <b>R-NETFAIL</b>，10 万卡起 D-HARD（检测 12.5 → 1 s）也进入必要集；② 热替换（180 s）与预测迁移（180 s + 误报）在现有链序下为负贡献，不应启用或须排在弹性之后；③ 薄弱环节在加机制后从 NPU 芯片转移到<b>没有任何梯级的事件类</b>（未归因、供电、管理、存储、冷却）和人工兜底份额，硬件 FIT 预算应优先给这些域（最小努力法同样把 UNKNOWN、CORE、MEMT 排在最前）；④ 50 万卡必须动恢复参数或硬件，20 万卡的降额余量只有 ${pt(z3.plan.derated - R.target)} pt，应按窗口概率而非均值验收。</div>
  <footer>复现：<code>node --import tsx scripts/availability-allocation-98p5.ts --trials 200</code> → <code>node scripts/build-availability-98p5.mjs</code>（结果 docs/availability-98p5/results.json）。方法：A_op = A_run·(1 − 静默暂停份额)，A_run = 1/(1 + Σλᵢp̄ᵢ)，规划器、Shapley、ARINC 与最小努力法见 docs/MODEL_REFERENCE.md §18–§23 与分配方法速览。所有事件率与机制参数为参考目录先验，须以本集群实测替换。</footer>
</section>
</main>
<script type="application/json" id="aop-data">${JSON.stringify(c1.data)}</script>
<script>
(function(){
  var tipEl = null;
  function tipFor(el){ var f = el.closest('figure'); if(!f) return null; var t = f.querySelector('.tip'); if(!t){ t = document.createElement('div'); t.className='tip'; f.appendChild(t);} return t; }
  function place(t, f, ev){ var r = f.getBoundingClientRect(); var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14; if (x + 330 > r.width) x = Math.max(0, ev.clientX - r.left - 330); t.style.left = x + 'px'; t.style.top = y + 'px'; }
  document.querySelectorAll('[data-tip]').forEach(function(el){
    el.addEventListener('mousemove', function(ev){ var f = el.closest('figure'); var t = tipFor(el); if(!t) return; t.textContent = el.getAttribute('data-tip'); t.style.display='block'; place(t, f, ev); });
    el.addEventListener('mouseleave', function(){ var t = tipFor(el); if(t) t.style.display='none'; });
  });
  var data = JSON.parse(document.getElementById('aop-data').textContent);
  var svg = document.getElementById('chart-aop'); if(!svg) return;
  var hit = document.getElementById('aop-hit'), xh = document.getElementById('aop-xh'), xl = document.getElementById('aop-xl');
  var fig = svg.closest('figure'), tip = document.getElementById('tip-aop');
  function fmt(v){ return (v*100).toFixed(2) + ' %'; }
  hit.addEventListener('mousemove', function(ev){
    var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    var best = 0; for (var i = 1; i < data.x.length; i++) if (Math.abs(data.x[i] - p.x) < Math.abs(data.x[best] - p.x)) best = i;
    xl.setAttribute('x1', data.x[best]); xl.setAttribute('x2', data.x[best]);
    data.series.forEach(function(s, k){ var c = document.getElementById('aop-c' + k); c.setAttribute('cx', data.x[best]); c.setAttribute('cy', s.y[best]); });
    xh.style.display = '';
    tip.textContent = 'N = ' + data.grid[best].toLocaleString('en-US') + ' 卡\\n' + data.series.map(function(s){ return s.name + '：' + fmt(s.nominal[best]) + '（降额 ' + fmt(s.derated[best]) + '）'; }).join('\\n');
    tip.style.display = 'block'; place(tip, fig, ev);
  });
  hit.addEventListener('mouseleave', function(){ xh.style.display = 'none'; tip.style.display = 'none'; });
})();
</script>
</body>
</html>
`;
function d200pause(id) { return P[200000].planned.byDomain[id].meanPauseS; }
function d200share(id) { return P[200000].planned.byDomain[id].share; }
writeFileSync(OUT_HTML, html);
console.log(`written ${OUT_HTML} (${(html.length / 1024).toFixed(0)} kB) and three SVGs in ${OUT_DIR}`);
