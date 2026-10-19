#!/usr/bin/env node
/**
 * Build docs/REMAP_ALLOCATION_98P5.zh.html (two printed pages, three inline SVG charts with tooltips and table views) from
 * docs/remap-allocation-98p5/results.json (scripts/remap-allocation-98p5.ts): the 98.5 % A_op allocation study with ReMAP's
 * original mechanisms as the only candidates, plus a one-line comparison with the HAC-D 10-candidate and the 23-candidate runs
 * when their result files exist. Usage: node scripts/build-remap-allocation-98p5.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const IN = JSON.parse(readFileSync('docs/remap-allocation-98p5/results.json', 'utf8'));
const R = IN.study;
const OUT_HTML = 'docs/REMAP_ALLOCATION_98P5.zh.html';
const OUT_DIR = 'docs/remap-allocation-98p5';
mkdirSync(OUT_DIR, { recursive: true });
const HACD10 = existsSync('docs/availability-98p5/results.json') ? JSON.parse(readFileSync('docs/availability-98p5/results.json', 'utf8')) : null;
const CMP = existsSync('docs/mechanism-comparison-98p5/results.json') ? JSON.parse(readFileSync('docs/mechanism-comparison-98p5/results.json', 'utf8')) : null;

const pct = (x, d = 2) => (x * 100).toFixed(d);
const pt = (x, d = 2) => (x * 100).toFixed(d);
const sgn = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d);
const num = (x, d = 2) => Number(x).toFixed(d);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kfmt = (N) => (N >= 1e6 ? `${(N / 1e6).toFixed(N % 1e6 ? 1 : 0)}M` : N >= 1e5 ? `${Math.round(N / 1e3)}k` : `${(N / 1e3).toFixed(1).replace(/\.0$/, '')}k`);
const zhN = (N) => ({ 10000: '1 万卡', 100000: '10 万卡', 200000: '20 万卡', 500000: '50 万卡' })[N] ?? `${N}`;
const zhNs = (N) => ({ 10000: '1 万', 100000: '10 万', 200000: '20 万', 500000: '50 万' })[N] ?? `${N}`;
const SIZES = R.sizes;
const P = R.perSize;
const LIB = R.library;
const mechName = (id) => LIB[id]?.name?.zh ?? id;
const GROUPS = [['npu', 'NPU 芯片与内存'], ['network', '网络'], ['host', '主机'], ['facility', '机房设施'], ['storageSoftware', '存储 / 软件 / 未归因'], ['other', '亚健康隔离与静默暂停']];
const groupVals = (d) => { const o = { ...d.byGroup }; o.other = (o.isolation ?? 0) + (o.sdcPause ?? 0); return GROUPS.map(([k]) => o[k] ?? 0); };
const planLabel = (N) => (P[N].plan.ids.length ? P[N].plan.ids.join(' + ') : '无需机制');
const textW = (s) => Array.from(s).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.6), 0);
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const STYLE = `
svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; --h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; } }
:root[data-theme="light"] svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; --h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; }
:root[data-theme="dark"] svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; }
svg.viz text { fill: var(--ink); font-size: 12px; } svg.viz .t2 { fill: var(--ink2); font-size: 11.5px; } svg.viz .m { fill: var(--muted); font-size: 11px; } svg.viz .tick { font-variant-numeric: tabular-nums; } svg.viz .ttl { font-size: 13px; font-weight: 600; }
svg.viz .grid { stroke: var(--grid); stroke-width: 1; } svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .ref { stroke: var(--ink2); stroke-width: 1; } svg.viz .hit { fill: transparent; pointer-events: all; } svg.viz .xh { pointer-events: none; } svg.viz .cellt { font-size: 12px; font-variant-numeric: tabular-nums; } svg.viz .onDark { fill: var(--surface); }
`;
const svgOpen = (id, W, H) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
function legend(x, y, items, kind = 'line') { let off = 0; return items.map((it) => { const lx = x + off; off += 30 + textW(it.name) + 14; return kind === 'line' ? `<line x1="${lx}" x2="${lx + 18}" y1="${y}" y2="${y}" stroke="var(--s${it.slot + 1})" stroke-width="2.5" stroke-linecap="round"/><text x="${lx + 24}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--s${it.slot + 1})"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join(''); }

/* ---------- chart 1 ---------- */
function chartAop() {
  const keys = Object.keys(R.curves).filter((k) => !k.endsWith('Derated'));
  const name = (k) => (k === 'baseline' ? '基线（无机制）' : k === 'allOn' ? `全部 ${R.players.length} 项同时启用` : `${zhNs(Number(k.replace('plan', '')))}卡推荐集（${R.curves[k].ids.length} 项）`);
  const short = (k) => (k === 'baseline' ? '基线' : k === 'allOn' ? `全部 ${R.players.length} 项` : `${zhNs(Number(k.replace('plan', '')))}卡集`);
  const series = keys.slice(0, 6).map((k, i) => ({ key: k, name: name(k), short: short(k), slot: i }));
  const W = 960, H = 372, L = 54, Rm = 150, Tp = 54, B = 40, pw = W - L - Rm, ph = H - Tp - B;
  const grid = R.curveGrid;
  const lx0 = Math.log10(grid[0]), lx1 = Math.log10(grid[grid.length - 1]);
  const xs = (N) => L + ((Math.log10(N) - lx0) / (lx1 - lx0)) * pw;
  const ys = (a) => Tp + ((1 - Math.max(0.8, a)) / 0.2) * ph;
  let g = svgOpen('chart-aop', W, H) + `<text x="${L}" y="20" class="ttl">图 1 · 运行可用率 A_op 随集群规模的变化（仅 ReMAP 原有机制；名义参数实线，色带到降额参数的下限）</text>` + legend(L, 38, series.map((s) => ({ name: s.name, slot: s.slot })));
  for (let v = 80; v <= 100; v += 5) { const y = ys(v / 100); g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="m tick">${v} %</text>`; }
  for (const N of [5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]) { const x = xs(N); g += `<line x1="${x}" x2="${x}" y1="${Tp + ph}" y2="${Tp + ph + 5}" class="axis"/><text x="${x}" y="${Tp + ph + 18}" text-anchor="middle" class="m tick">${kfmt(N)}</text>`; }
  g += `<line x1="${L}" x2="${L + pw}" y1="${Tp + ph}" y2="${Tp + ph}" class="axis"/><text x="${L + 150}" y="${H - 6}" text-anchor="middle" class="m">集群规模 N（卡，对数轴）</text>`;
  const yT = ys(R.target);
  g += `<line x1="${L}" x2="${L + pw}" y1="${yT}" y2="${yT}" class="ref"/><text x="${L + 6}" y="${yT - 5}" class="t2">目标 A_op ≥ ${pct(R.target, 1)} %</text>`;
  for (const s of series) { const nom = R.curves[s.key].points, der = R.curves[`${s.key}Derated`].points; const poly = nom.map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`).concat(der.slice().reverse().map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`)).join(' '); g += `<polygon points="${poly}" fill="var(--s${s.slot + 1})" opacity="0.14"/>`; }
  const labels = [];
  for (const s of series) {
    const nom = R.curves[s.key].points;
    g += `<path d="${nom.map((p, i) => `${i ? 'L' : 'M'}${xs(p.N).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--s${s.slot + 1})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const N of SIZES) { const p = nom.find((q) => q.N === N); if (p) g += `<circle cx="${xs(N).toFixed(1)}" cy="${ys(p.value).toFixed(1)}" r="4" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`; }
    const last = nom[nom.length - 1];
    labels.push({ y: ys(last.value), text: `${s.short} ${pct(last.value, 1)} %` });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  for (const lb of labels) g += `<text x="${L + pw + 8}" y="${lb.y + 4}" class="t2">${esc(lb.text)}</text>`;
  const marks = series.map((s) => ({ s, N: R.curves[s.key].maxN })).filter((m) => m.N > grid[0] && m.N < grid[grid.length - 1]).sort((a, b) => a.N - b.N);
  // three label tiers (below, above, further below) so that up to three close markers stay legible
  const tiers = [{ y: yT + 17, last: -1e9 }, { y: yT - 11, last: -1e9 }, { y: yT + 29, last: -1e9 }];
  for (const m of marks) { const x = xs(m.N); const tier = tiers.find((t) => x - t.last >= 44) ?? tiers[2]; tier.last = x; g += `<circle cx="${x.toFixed(1)}" cy="${yT}" r="4.5" fill="var(--s${m.s.slot + 1})" stroke="var(--surface)" stroke-width="2"/><text x="${x.toFixed(1)}" y="${tier.y}" text-anchor="middle" class="t2 tick">${kfmt(m.N)}</text>`; }
  g += `<text x="${L + pw}" y="${H - 6}" text-anchor="end" class="m">● 目标线上的圆点：名义参数下仍满足 98.5 % 的最大规模</text>`;
  g += `<g class="xh" id="aop-xh" style="display:none"><line id="aop-xl" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" class="ref"/>${series.map((s) => `<circle id="aop-c${s.slot}" r="5" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g><rect class="hit" id="aop-hit" x="${L}" y="${Tp}" width="${pw}" height="${ph}"/></svg>`;
  const data = { grid, x: grid.map((N) => +xs(N).toFixed(1)), series: series.map((s) => ({ name: s.name, nominal: R.curves[s.key].points.map((p) => p.value), derated: R.curves[`${s.key}Derated`].points.map((p) => p.value), y: R.curves[s.key].points.map((p) => +ys(p.value).toFixed(1)) })) };
  const table = `<table class="tv"><tr><th>N</th>${series.map((s) => `<th class="num">${esc(s.name)}<br><span class="small">名义 / 降额</span></th>`).join('')}</tr>${grid.map((N, i) => `<tr><td class="num">${N.toLocaleString('en-US')}</td>${series.map((s) => `<td class="num">${pct(R.curves[s.key].points[i].value)} / ${pct(R.curves[`${s.key}Derated`].points[i].value)}</td>`).join('')}</tr>`).join('')}<tr><td>满足 98.5 % 的最大 N</td>${series.map((s) => `<td class="num">${R.curves[s.key].maxN.toLocaleString('en-US')} / ${R.curves[`${s.key}Derated`].maxN.toLocaleString('en-US')}</td>`).join('')}</tr></table>`;
  return { svg: g, data, table, series };
}

/* ---------- chart 2 ---------- */
function chartUnavail() {
  const rows = [];
  for (const N of SIZES) { rows.push({ label: `${zhNs(N)} · 基线`, N, kind: 'base', vals: groupVals(P[N].baseline) }); rows.push({ label: `${zhNs(N)} · 方案`, N, kind: 'plan', vals: groupVals(P[N].planned) }); }
  const W = 960, L = 118, Rm = 70, Tp = 66, rowP = 25, groupGap = 9, barH = 15, B = 36;
  const H = Tp + rows.length * rowP + (SIZES.length - 1) * groupGap + B;
  const pw = W - L - Rm, xmax = 12;
  const xs = (v) => L + (v / xmax) * pw;
  let g = svgOpen('chart-unavail', W, H) + `<text x="${L}" y="20" class="ttl">图 2 · 不可用度的构成（百分点 = 100 − A_op）：基线 vs 该规模的 ReMAP 推荐集（无可行集时为价值最高的集），预算线 1.5 pt</text>` + legend(L, 38, GROUPS.map(([, name], i) => ({ name, slot: i })), 'rect');
  const plotTop = Tp, plotBot = H - B;
  for (let v = 0; v <= xmax; v += 2) { const x = xs(v); g += `<line x1="${x}" x2="${x}" y1="${plotTop - 4}" y2="${plotBot}" class="grid"/><text x="${x}" y="${plotBot + 16}" text-anchor="middle" class="m tick">${v}</text>`; }
  g += `<text x="${L + pw}" y="${plotBot + 30}" text-anchor="end" class="m">不可用度（百分点）</text>`;
  const xb = xs((1 - R.target) * 100);
  g += `<line x1="${xb}" x2="${xb}" y1="${plotTop - 4}" y2="${plotBot}" class="ref"/><text x="${xb + 4}" y="${plotTop - 8}" class="t2">预算 1.5 pt</text>`;
  let y = plotTop + 4;
  rows.forEach((r, ri) => {
    if (ri > 0 && ri % 2 === 0) y += groupGap;
    const total = r.vals.reduce((a, b) => a + b, 0);
    g += `<text x="${L - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="t2">${esc(r.label)}</text>`;
    let x = L;
    r.vals.forEach((v, gi) => { const w = (v * 100 / xmax) * pw; if (w > 0.2) { const wi = Math.max(0, w - (gi < r.vals.length - 1 ? 2 : 0)); g += `<rect x="${x.toFixed(1)}" y="${y}" width="${wi.toFixed(1)}" height="${barH}" rx="${gi === r.vals.length - 1 ? 3 : 0}" fill="var(--s${gi + 1})" data-tip="${esc(r.label)}（${esc(r.kind === 'plan' ? planLabel(r.N) : '无机制')}）\n${esc(GROUPS[gi][1])}：${pt(v)} pt，占 ${(v / total * 100).toFixed(1)} %"/>`; } x += w; });
    g += `<text x="${(x + 6).toFixed(1)}" y="${y + barH / 2 + 4}" class="t2 tick">${pt(total)}</text>`;
    y += rowP;
  });
  g += '</svg>';
  const table = `<table class="tv"><tr><th>行</th><th>方案</th>${GROUPS.map(([, n]) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">合计 pt</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.kind === 'plan' ? planLabel(r.N) : '—')}</td>${r.vals.map((v) => `<td class="num">${pt(v, 3)}</td>`).join('')}<td class="num">${pt(r.vals.reduce((a, b) => a + b, 0), 3)}</td></tr>`).join('')}</table>`;
  return { svg: g, table };
}

/* ---------- chart 3 ---------- */
function chartShapley() {
  const ids = R.players.slice().sort((a, b) => avg(b) - avg(a));
  function avg(id) { return SIZES.reduce((s, N) => s + P[N].gains.find((x) => x.id === id).byMetric.aOp.shapley, 0) / SIZES.length; }
  const vmax = Math.max(...SIZES.flatMap((N) => P[N].gains.map((x) => Math.abs(x.byMetric.aOp.shapley))));
  const W = 960, L = 262, colW = 128, rowH = 28, Tp = 58, effW = 70, legH = 50;
  const H = Tp + ids.length * rowH + legH;
  let g = svgOpen('chart-shapley', W, H) + `<text x="16" y="20" class="ttl">图 3 · ReMAP 各机制对 A_op 的 Shapley 贡献（百分点，${R.players.length} 项全组合精确值）；带框 = 该规模推荐集所含</text><text x="16" y="${Tp - 8}" class="m">机制（按平均贡献排序）</text>`;
  SIZES.forEach((N, j) => { g += `<text x="${L + j * colW + colW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">${zhN(N)}</text>`; });
  g += `<text x="${L + SIZES.length * colW + effW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">工作量</text>`;
  const cls = (v) => { if (Math.abs(v) < 0.0005) return 'mid'; const k = Math.min(4, Math.floor((Math.abs(v) / vmax) * 4) + 1); return (v > 0 ? 'h' : 'n') + k; };
  ids.forEach((id, i) => {
    const y = Tp + i * rowH;
    g += `<text x="16" y="${y + rowH / 2 + 4}" class="t2">${esc(id)} <tspan class="m">${esc(mechName(id))}</tspan></text>`;
    SIZES.forEach((N, j) => {
      const gn = P[N].gains.find((x) => x.id === id); const v = gn.byMetric.aOp.shapley; const c = cls(v); const x = L + j * colW; const inPlan = P[N].plan.ids.includes(id);
      const tip = `${esc(id)} ${esc(mechName(id))} · ${zhN(N)}\nShapley（A_op）${sgn(v, 3)} pt；单独启用 ${sgn(gn.byMetric.aOp.single, 3)}；末位加入 ${sgn(gn.byMetric.aOp.lastAdded, 3)}\nShapley（正确交付）${sgn(gn.byMetric.delivered.shapley, 2)} pt${inPlan ? '\n在该规模的推荐集中' : ''}`;
      g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" fill="var(--${c})" data-tip="${tip}"/>`;
      if (inPlan) g += `<rect x="${x + 4}" y="${y + 4}" width="${colW - 8}" height="${rowH - 8}" fill="none" stroke="var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 4}" y="${y + 4}" width="${colW - 8}" height="${rowH - 8}" fill="none" stroke="var(--ink)" stroke-width="1.5" pointer-events="none"/>`;
      const dark = c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';
      g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${dark ? ' onDark' : ''}" pointer-events="none">${sgn(v)}</text>`;
    });
    g += `<text x="${L + SIZES.length * colW + effW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2 tick">${LIB[id].effort}</text>`;
  });
  const ly = Tp + ids.length * rowH + 22;
  ['n4', 'n3', 'n2', 'n1', 'mid', 'h1', 'h2', 'h3', 'h4'].forEach((c, i) => { g += `<rect x="${L + i * 26}" y="${ly}" width="24" height="12" fill="var(--${c})"/>`; });
  g += `<text x="${L - 6}" y="${ly + 10}" text-anchor="end" class="m tick">−${(vmax * 100).toFixed(1)} pt</text><text x="${L + 9 * 26 + 6}" y="${ly + 10}" class="m tick">+${(vmax * 100).toFixed(1)} pt</text><text x="${L + 4 * 26 + 12}" y="${ly + 24}" text-anchor="middle" class="m">0</text><text x="${L + 9 * 26 + 80}" y="${ly + 10}" class="m">静默错误检测（D-SDC、R-SDC）与 checkpoint（C-FAST）改善正确交付而非 A_op，故接近 0 或微负</text></svg>`;
  const table = `<table class="tv"><tr><th>机制</th>${SIZES.map((N) => `<th class="num">${zhN(N)}<br><span class="small">Shapley / 单独 / 末位（pt）</span></th>`).join('')}</tr>${ids.map((id) => `<tr><td>${esc(id)} ${esc(mechName(id))}</td>${SIZES.map((N) => { const gn = P[N].gains.find((x) => x.id === id); return `<td class="num">${sgn(gn.byMetric.aOp.shapley)} / ${sgn(gn.byMetric.aOp.single)} / ${sgn(gn.byMetric.aOp.lastAdded)}</td>`; }).join('')}</tr>`).join('')}</table>`;
  return { svg: g, table, ids };
}

/* ---------- tables ---------- */
const topGroups = (d) => { const vals = groupVals(d); const tot = vals.reduce((a, b) => a + b, 0); return GROUPS.map(([, n], i) => [n, vals[i]]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, v]) => `${n} ${(v / tot * 100).toFixed(0)} %`).join('，'); };
const fitTotal = R.domains.reduce((a, d) => a + d.fit, 0);
function summaryTable() {
  const row = (label, f) => `<tr><td class="k">${label}</td>${SIZES.map((N) => `<td>${f(N, P[N])}</td>`).join('')}</tr>`;
  const me = (z) => (z.hardwareOnly.minimumEffort && z.hardwareOnly.minimumEffort.rows.some((r) => r.improvementFactor > 1.0001) ? `${z.hardwareOnly.minimumEffort.rows.filter((r) => r.improvementFactor > 1.0001).length} 个域降到 ${num(z.hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)} FIT` : '已满足');
  return `<div class="table-wrap"><table>
<tr><th style="width:21%">量（30 天窗口，A_op 口径）</th>${SIZES.map((N) => `<th>${zhN(N)}</th>`).join('')}</tr>
${row('基线 A_op · 缺口', (N, z) => `${pct(z.baseline.aOp)} % · ${z.baseline.aOp >= R.target ? `余量 ${pt(z.baseline.aOp - R.target)}` : `缺 ${pt(R.target - z.baseline.aOp)}`} pt`)}
${row('作业中断率 λ_job · MTBI · R̄', (N, z) => `${num(z.baseline.lambdaJob, 3)} /h · ${num(z.baseline.mtbiHours, 1)} h · ${num(z.baseline.recoveryS, 0)} s`)}
${row('仅改硬件：故障率 × f（允许 FIT 合计）· MTBI ≥ · 最小努力法', (N, z) => `× ${num(z.hardwareOnly.factor, 3)}（${num(fitTotal * z.hardwareOnly.factor, 0)} FIT）· ${num(z.hardwareOnly.mtbiStarHours, 2)} h · ${me(z)}`)}
${row('仅改恢复：R̄ 须 ≤ · 阶段预算 检测 / 自动 / 人工份额', (N, z) => `${num(z.recoveryOnly.recoveryStarS, 0)} s（× ${num(z.recoveryOnly.factor, 3)}）· ${z.recoveryOnly.stages.map((s) => num(s.budgetS, 0)).join(' / ')} s`)}
${row('ReMAP 推荐机制集（最低工作量可行集）· 工作量 · 必要机制', (N, z) => `${z.plan.feasible ? '' : '<b>无可行集</b>；价值最高的集：'}${esc(planLabel(N))} · ${z.plan.effort}${z.plan.necessary.length ? ' · 必要：' + esc(z.plan.necessary.join('+')) : z.plan.feasible ? ' · 基线已达标' : ''}`)}
${row('方案 A_op 名义 / 降额', (N, z) => `${pct(z.plan.nominal)} / ${pct(z.plan.derated)} %${z.plan.feasible ? '' : '（不达标）'}`)}
${row('方案后硬件因子（名义 / 降额）', (N, z) => `× ${num(z.residualFactor.plan)} / × ${num(z.residualFactor.planDerated)}${z.residualFactor.plan >= 1 ? '（余量）' : '（仍须改进）'}`)}
${row('校核（200 窗口）：P(A_op ≥ 98.5 %) [Wilson 95 %] · 判定 · 均值 ± t 半宽 · 5 % 分位', (N, z) => `${pct(z.verification.pAtLeastTarget, 1)} % [${pct(z.verification.wilson[0], 1)}–${pct(z.verification.wilson[1], 1)}] · <b>${z.verification.verdict}</b> · ${pct(z.verification.value.mean)} ± ${pct(z.verification.value.ci95)} · ${pct(z.verification.value.p05)} %`)}
${row('方案后残余不可用的主要来源', (N, z) => topGroups(z.planned))}
</table></div>`;
}
const LEVER_NAMES = { plan: '推荐机制集（库内参数）', auto60: '+ 自动恢复尝试 180 → 60 s', ps999: '+ 自动恢复成功率 99 → 99.9 %', manual30: '+ 人工恢复 120 → 30 min', 'auto60+ps999': '+ 自动 60 s 与成功率 99.9 %', 'auto60+manual30': '+ 自动 60 s 与人工 30 min', 'ps999+manual30': '+ 成功率 99.9 % 与人工 30 min', all3: '+ 三项同时' };
function leverTable() {
  const sizes = [200000, 500000];
  const ids = P[500000].levers.map((l) => l.id).filter((id) => !['auto60+manual30', 'ps999+manual30'].includes(id));
  return `<div class="table-wrap"><table><tr><th>机制集之上的恢复参数杠杆（库外参数）</th>${sizes.map((N) => `<th class="num" colspan="3">${zhN(N)}：A_op 名义 / 降额 · 硬件因子</th>`).join('')}</tr>${ids.map((id) => `<tr><td class="k">${esc(LEVER_NAMES[id] ?? id)}</td>${sizes.map((N) => { const z = P[N].levers.find((l) => l.id === id); const ok = z.value >= R.target && z.valueDerated >= R.target; return `<td class="num">${ok ? '<b>' : ''}${pct(z.value)} %${ok ? '</b>' : ''}</td><td class="num">${pct(z.valueDerated)} %</td><td class="num">× ${num(z.residualFactor)}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
}
const PK = { coverage: ['覆盖率', '', 1], detectSeconds: ['检测', ' s', 1], success: ['成功率', '', 1], successSeconds: ['成功耗时', ' s', 1], failureSeconds: ['失败耗时', ' s', 1], domains: ['域数', '', 1], recoverSeconds: ['域恢复', ' s', 1], syncSeconds: ['协调', ' s', 1], computeSeconds: ['τ', ' s', 1], saveSeconds: ['δ', ' s', 1], stepSeconds: ['step', ' s', 1], recoverSecondsSdc: ['恢复', ' s', 1] };
const fmtParams = (nom, der) => Object.keys(nom).map((k) => { const [lab, unit, mul] = PK[k] ?? [k, '', 1]; const a = +(nom[k] * mul).toFixed(3), b = +((der[k] ?? nom[k]) * mul).toFixed(3); return `${lab} ${a}${a !== b ? `→${b}` : ''}${unit}`; }).join('，');
function mechanismTable(ids) {
  const note = (id) => {
    const sh = SIZES.map((N) => P[N].gains.find((g) => g.id === id).byMetric.aOp.shapley);
    const single = SIZES.map((N) => P[N].gains.find((g) => g.id === id).byMetric.aOp.single);
    const nec = P[200000].plan.necessary.includes(id) || P[100000].plan.necessary.includes(id);
    const maxShare = Math.max(...SIZES.map((N) => { const z = P[N]; return z.gains.find((g) => g.id === id).byMetric.aOp.shapley; }));
    if (sh.every((v) => Math.abs(v) < 0.0005)) return '对 A_op 无作用（改善正确交付 / 保存开销），A_op 预算中不启用';
    if (sh.every((v) => v < 0)) return '对 A_op 为负（多一次检出 → 多一次回滚暂停），只在正确交付目标下启用';
    if (id === 'R-ELASTIC') return `10 万卡的唯一必要项（单独 +${pt(single[1])} pt）；与重执行 / 进程重调度互为替代`;
    if (id === 'R-REPLAY' || id === 'R-PROCESS') return `与弹性互为替代（末位加入仅 +${pt(P[100000].gains.find((g) => g.id === id).byMetric.aOp.lastAdded)} pt@10 万）；20 万卡起须三者同时启用`;
    if (id === 'D-HARD') return `检测 12.5 → 1 s，收益随 N 线性增长（${sgn(sh[3])} pt@50 万）；20 万卡起进入最佳集`;
    return maxShare > 0 ? '按名义值设定' : '—';
  };
  return `<div class="table-wrap"><table class="dense"><tr><th>机制</th><th>参数：名义→降额（规划器降额后的值；无箭头 = 不降额）</th><th class="num">工作量</th><th>进入推荐集 1/10/20/50 万</th><th>分配结论（Shapley 见图 3）</th></tr>${ids.map((id) => { const lb = LIB[id]; return `<tr><td class="k"><b>${esc(id)}</b> <span class="small">${esc(mechName(id))}</span></td><td><span class="small">${esc(fmtParams(lb.parameters, lb.derated))}</span></td><td class="num">${lb.effort}</td><td style="white-space:nowrap">${SIZES.map((N) => (P[N].plan.ids.includes(id) ? '●' : '○')).join('')}</td><td class="small">${note(id)}</td></tr>`; }).join('')}</table></div>`;
}
function domainTable() {
  const doms = R.domains.filter((d) => d.fit > 0).sort((a, b) => b.fit - a.fit);
  const d200 = P[200000].planned.byDomain;
  const improved = (N, id) => { const r = P[N].hardwareOnly.minimumEffort?.rows.find((x) => x.id === id); return r && r.improvementFactor > 1.0001 ? '●' : '○'; };
  return `<div class="table-wrap"><table class="dense"><tr><th>域</th><th class="num">当前 FIT</th><th class="num">占 λ</th><th>梯级<sup>†</sup></th><th class="num">20 万集后<br>停顿 s · 残余</th>${SIZES.map((N) => `<th class="num">允许 FIT<br>${zhNs(N)}</th>`).join('')}<th>最小努力<br>10/20/50 万</th></tr>${doms.map((d) => { const after = d200[d.id]; const flags = [d.flags.replay ? 'r' : '', d.flags.process ? 'p' : '', d.flags.elastic ? 'e' : ''].filter(Boolean).join(' ') || '<b>无</b>'; return `<tr><td class="k">${esc(d.id.replace(/-hard$/, ''))} <span class="small">${esc(d.name.split(' · ')[0])}</span></td><td class="num">${num(d.fit, 1)}</td><td class="num">${(d.fit / fitTotal * 100).toFixed(1)} %</td><td style="white-space:nowrap">${flags}</td><td class="num">${num(after.meanPauseS, 0)} · ${(after.share * 100).toFixed(1)} %</td>${SIZES.map((N) => `<td class="num">${num(d.fit * P[N].residualFactor.plan, 0)}</td>`).join('')}<td>${[100000, 200000, 500000].map((N) => improved(N, d.id)).join('')}</td></tr>`; }).join('')}<tr><td class="k">合计</td><td class="num">${num(fitTotal, 1)}</td><td class="num">100 %</td><td></td><td></td>${SIZES.map((N) => `<td class="num">${num(fitTotal * P[N].residualFactor.plan, 0)}</td>`).join('')}<td></td></tr></table></div>`;
}

/* ---------- conclusions ---------- */
function famTop(N, n = 3) { return P[N].gains.slice().sort((a, b) => b.byMetric.aOp.shapley - a.byMetric.aOp.shapley).slice(0, n).map((g) => `${g.id} ${sgn(g.byMetric.aOp.shapley)}`).join('，'); }
function conclusions() {
  return SIZES.map((N) => {
    const z = P[N];
    const base = z.baseline.aOp;
    const head = base >= R.target ? `${zhN(N)}：基线已达标（${pct(base)} %）` : z.plan.feasible ? `${zhN(N)}：缺 ${pt(R.target - base)} pt，ReMAP 机制可以补足` : `${zhN(N)}：缺 ${pt(R.target - base)} pt，ReMAP 原有机制不够`;
    const li = [];
    if (base >= R.target) li.push(`无需机制；硬件余量 × ${num(z.residualFactor.plan, 1)}，恢复余量 × ${num(z.recoveryOnly.factor, 1)}（R̄ 可放宽到 ${num(z.recoveryOnly.recoveryStarS, 0)} s）；200 个窗口全部 ≥ 98.5 %（5 % 分位 ${pct(z.verification.value.p05)} %）。`);
    else if (z.plan.feasible) li.push(`${planLabel(N)}（工作量 ${z.plan.effort}）→ ${pct(z.plan.nominal)} %（降额 ${pct(z.plan.derated)} %），P(窗口 ≥ 98.5 %) = ${pct(z.verification.pAtLeastTarget, 1)} %，${z.verification.verdict}；方案后硬件余量 × ${num(z.residualFactor.plan)}。${z.plan.pareto.filter((c) => c.ids.length && c.effort < z.plan.effort).length ? `更省力的组合（${z.plan.pareto.filter((c) => c.ids.length && c.effort < z.plan.effort).map((c) => `${c.ids.join('+')} 名义 ${pct(c.value)} % / 降额 ${pct(c.derated)} %`).join('；')}）至少有一项不达标。` : ''}`);
    else {
      const ok = (z.levers ?? []).filter((l) => l.id !== 'plan' && l.value >= R.target && l.valueDerated >= R.target).sort((a, b) => a.id.length - b.id.length);
      const okNom = (z.levers ?? []).filter((l) => l.id !== 'plan' && l.value >= R.target && l.valueDerated < R.target).sort((a, b) => a.id.length - b.id.length);
      li.push(`${R.players.length} 项全部启用也只到 ${pct(z.plan.maxValue)} %；价值最高的集 ${planLabel(N)}（工作量 ${z.plan.effort}）${pct(z.plan.nominal)} % / 降额 ${pct(z.plan.derated)} %，P(窗口 ≥ 目标) ${pct(z.verification.pAtLeastTarget, 1)} %。`);
      li.push(`补足途径：硬件中断率须降到 ${pct(z.residualFactor.plan, 0)} %（× ${num(1 / z.residualFactor.plan)}，各域允许 FIT 见第 4 节）${ok.length ? `，或在机制集之上加恢复杠杆 ${LEVER_NAMES[ok[0].id] ?? ok[0].id}（${pct(ok[0].value)} % / 降额 ${pct(ok[0].valueDerated)} %，硬件余量 × ${num(ok[0].residualFactor)}）` : okNom.length ? `，或加恢复杠杆 ${LEVER_NAMES[okNom[0].id] ?? okNom[0].id}（名义 ${pct(okNom[0].value)} % 达标，但降额 ${pct(okNom[0].valueDerated)} % 不达标）` : ''}。`);
    }
    li.push(`薄弱环节（方案后残余）：${topGroups(z.planned)}${base < R.target ? `；基线时 ${topGroups(z.baseline)}` : ''}。`);
    li.push(`最重要的 ReMAP 机制（Shapley）：${famTop(N)}。`);
    return `<div class="box"><h3>${esc(head)}</h3><ul>${li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }).join('');
}
function crossNote() {
  const ids = R.players;
  const avg = (id) => SIZES.reduce((s, N) => s + P[N].gains.find((x) => x.id === id).byMetric.aOp.shapley, 0) / SIZES.length;
  const top = ids.slice().sort((a, b) => avg(b) - avg(a)).filter((id) => avg(id) > 0.0005).slice(0, 4).map((id) => `${id} ${sgn(avg(id))}`).join('，');
  const zero = ids.filter((id) => SIZES.every((N) => Math.abs(P[N].gains.find((x) => x.id === id).byMetric.aOp.shapley) < 0.0005 || P[N].gains.find((x) => x.id === id).byMetric.aOp.shapley < 0));
  const nr = P[200000].planned.byDomain;
  const noRung = R.domains.filter((d) => d.fit > 0 && !d.flags.replay && !d.flags.process && !d.flags.elastic);
  const noRungShare = noRung.reduce((a, d) => a + d.fit, 0) / fitTotal;
  const noRungResidual = noRung.reduce((a, d) => a + (nr[d.id]?.share ?? 0), 0);
  let cmp = '';
  if (HACD10 && CMP) cmp = `与其他候选集比较（同一目标、同一方法）：HAC-D 自带 10 项候选的 20 万卡集可达 ${kfmt(HACD10.curves.plan200k.maxN)} 卡，原有 + 新增 23 项的 20 万卡集可达 ${kfmt(CMP.sets.combined.study.curves.plan200000.maxN)} 卡（全部启用 ${kfmt(CMP.sets.combined.study.curves.allOn.maxN)} 卡），而仅 ReMAP 原有机制为 ${kfmt(R.curves.plan200000.maxN)} 卡——差距来自没有任何 ReMAP 梯级覆盖的事件类和人工份额。`;
  return `<div class="callout"><b>跨规模结论</b>：① ReMAP 原有机制的上限约 ${kfmt(R.curves.plan200000.maxN)} 卡（降额 ${kfmt(R.curves.plan200000Derated.maxN)}）：10 万卡一项 R-ELASTIC 即可，20 万卡起无可行集（最高 ${pct(R.perSize[200000].plan.maxValue)} %），50 万卡最高 ${pct(R.perSize[500000].plan.maxValue)} %；② 最重要的机制是 ${top}（弹性 / 重执行 / 进程重调度互为替代，10 万卡只需其一，20 万卡起须同时启用），${zero.length ? `${zero.join('、')} 对 A_op 无作用或为负（它们改善的是正确交付）` : ''}；③ 薄弱环节：没有任何梯级标记的 ${noRung.map((d) => d.id.replace(/-hard$/, '')).join('、')} 占中断率 ${(noRungShare * 100).toFixed(0)} %，20 万卡集后占残余 ${(noRungResidual * 100).toFixed(0)} %，加上全局恢复中 72 s 的人工份额——这正是恢复参数杠杆（自动尝试 60 s、成功率 99.9 %）在 20 万 / 50 万卡能补足的部分；④ 硬件分配：仅改硬件须 × ${num(R.perSize[200000].hardwareOnly.factor, 2)}（20 万）/ × ${num(R.perSize[500000].hardwareOnly.factor, 2)}（50 万），机制集后仍须 × ${num(R.perSize[200000].residualFactor.plan, 2)} / × ${num(R.perSize[500000].residualFactor.plan, 2)}。${cmp}</div>`;
}

/* ---------- assemble ---------- */
const c1 = chartAop(), c2 = chartUnavail(), c3 = chartShapley();
writeFileSync(`${OUT_DIR}/fig1-aop-vs-n.svg`, c1.svg);
writeFileSync(`${OUT_DIR}/fig2-unavailability.svg`, c2.svg);
writeFileSync(`${OUT_DIR}/fig3-shapley.svg`, c3.svg);
const z1 = P[10000], z2 = P[100000], z3 = P[200000], z4 = P[500000];
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>仅 ReMAP 机制 98.5 % 可用率分配</title>
<meta name="description" content="54 条事件参考目录上，仅用 ReMAP 原有机制在 98.5 % 运行可用率目标下的硬件故障率与机制参数分配（1 万 / 10 万 / 20 万 / 50 万卡）、薄弱环节与关键机制（HAC-D，${R.generated.slice(0, 10)}）。">
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
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 22px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 16px; font-weight: 600; margin: 16px 0 6px; padding-top: 8px; border-top: 1px solid var(--rule); }
  h2.first { border-top: none; padding-top: 0; margin-top: 4px; }
  p { margin: 5px 0; } .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 6px; }
  .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
  footer, .eyebrow, p { overflow-wrap: anywhere; }
  .small { font-size: 11.3px; color: var(--muted); }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.8px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3.5px 6px; text-align: left; vertical-align: top; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.3px; }
  td.k { white-space: nowrap; font-weight: 500; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  figure.chart { margin: 8px 0 10px; position: relative; } figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  details.tv { margin: -2px 0 10px; font-size: 11.5px; overflow-x: auto; } details.tv summary { cursor: pointer; color: var(--accent); }
  table.tv { font-size: 11px; } table.tv th, table.tv td { padding: 2px 5px; }
  .tip { position: absolute; z-index: 5; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 11.5px; line-height: 1.4; padding: 6px 9px; border-radius: 6px; white-space: pre-line; max-width: 320px; box-shadow: 0 2px 8px rgba(0,0,0,.25); display: none; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
  .box { background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; padding: 7px 11px; }
  .box h3 { margin: 0 0 4px; font-size: 12.5px; } .box p, .box li { margin: 3px 0; font-size: 12.2px; } .box ul { margin: 2px 0 2px; padding-left: 16px; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; }
  @media screen and (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.7px; line-height: 1.36; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7.3px; line-height: 1.28; } th, td { padding: 1px 2.5px; } table.dense { font-size: 6.6px; line-height: 1.2; } table.dense th, table.dense td { padding: 0.4px 2px; } table.dense th { white-space: normal; } td.num { white-space: normal; }
    #p1 .table-wrap:first-of-type table { font-size: 7.05px; line-height: 1.24; }
    .f { font-size: 8px; } code { font-size: 7.4px; } .small { font-size: 7.2px; } .box p, .box li, .callout, .sub, footer { font-size: 7.9px; } .box h3 { font-size: 8.6px; margin-bottom: 2px; } .box ul { padding-left: 12px; } .box li { font-size: 7.5px; } .callout { font-size: 7.6px; } footer { font-size: 7.2px; }
    h1 { font-size: 15px; margin: 2px 0 3px; } h2 { font-size: 11.3px; margin: 6px 0 3px; padding-top: 4px; } .eyebrow { font-size: 8px; }
    figure.chart { margin: 3px 0 4px; } figcaption { font-size: 7.6px; margin-top: 1px; } details.tv { display: none; } .tip { display: none !important; }
    .grid2 { gap: 4px 10px; } .box { padding: 3px 7px; } .callout { margin: 4px 0; padding: 3px 7px; } p { margin: 2px 0; } .table-wrap { overflow: visible; }
    figure.chart.c1 svg { height: 240px; } figure.chart.c2 svg { height: 212px; } figure.chart.c3 svg { height: 232px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D · 分配研究（仅 ReMAP 原有机制） · ${R.generated.slice(0, 10)} · 第 1 / 2 页</div>
  <h1>98.5 % 运行可用率目标下的可靠性分配：仅用 ReMAP 原有机制（1 万 / 10 万 / 20 万 / 50 万卡）</h1>
  <p class="sub"><b>口径</b>：A_op = 作业窗口（30 天）内的运行时间占比，目标 ≥ 98.5 %（不可用度预算 1.5 pt）；对象为 54 条事件的参考审核目录（中断 / 亚健康 / 静默 FIT 3333.3 / 69.0 / 48.3 每卡·小时），基线恢复 12.5 s 发现 + 180 s 自动尝试 @ 99 % + 2 h 人工（R̄ = 264.5 s）。<b>候选机制</b>仅取 ReMAP 原有的 12 项：参与规划与归因的是有参数变换的 ${R.players.length} 项（${R.players.join('、')}），R-CKPT / R-MANUAL 为基线恢复本身，H-PROTECT / H-RELIABILITY 无增量参数（硬件改进由硬件预算单独给出）；HAC-D 自带的 v3.2 七项与 2026-10-14 新增的 16 项均不参与。机制参数为参考目录的目标值（先验），规划器按覆盖率 −5 pt、成功率 −8 pt、时间 ×1.5 降额后仍须达标；校核用 200 个窗口的账本仿真对 90 % 置信度（Wilson 区间）。</p>
  <h2 class="first">1. 四个规模的分配结果一览</h2>
  ${summaryTable()}
  <h2>2. 机制集之上的恢复参数杠杆（库外参数；20 万与 50 万卡无可行集时的补足途径，粗体 = 名义与降额都达标）</h2>
  ${leverTable()}
  ${crossNote()}
  <figure class="chart c1">${c1.svg}<div class="tip" id="tip-aop"></div><figcaption>图 1：基线在 ${kfmt(R.curves.baseline.maxN)} 卡以下达标；R-ELASTIC 一项把上限推到 ${kfmt(R.curves.plan100000.maxN)} 卡（降额 ${kfmt(R.curves.plan100000Derated.maxN)}）；ReMAP 价值最高的 ${R.curves.plan200000.ids.length} 项集到 ${kfmt(R.curves.plan200000.maxN)} 卡（降额 ${kfmt(R.curves.plan200000Derated.maxN)}），全部 ${R.players.length} 项同时启用 ${kfmt(R.curves.allOn.maxN)} 卡——ReMAP 原有机制的上限。</figcaption></figure>
  <details class="tv"><summary>图 1 数据表</summary>${c1.table}</details>
  <figure class="chart c2">${c2.svg}<figcaption>图 2：基线的不可用度按域分组（各域停顿相同，占比即中断率占比）；ReMAP 的梯级把带重执行 / 进程 / 弹性标记的域压到数秒的停顿，残余集中在没有任何梯级的供电 / 冷却 / 管理 / 存储 / 未归因事件（20 万卡集后占 ${((groupVals(z3.planned)[3] + groupVals(z3.planned)[4]) / (1 - z3.planned.aOp) * 100).toFixed(0)} %）。</figcaption></figure>
  <details class="tv"><summary>图 2 数据表</summary>${c2.table}</details>
</section>
<section class="page" id="p2">
  <div class="eyebrow">HAC-D · 分配研究（仅 ReMAP 原有机制） · ${R.generated.slice(0, 10)} · 第 2 / 2 页</div>
  <h2 class="first">3. 关键机制：Shapley 归因与参数分配</h2>
  <figure class="chart c3">${c3.svg}<figcaption>图 3：R-ELASTIC、R-REPLAY、R-PROCESS 三项互为替代（单独启用弹性 +${pt(z2.gains.find((g) => g.id === 'R-ELASTIC').byMetric.aOp.single)} pt@10 万卡，末位加入仅 +${pt(z2.gains.find((g) => g.id === 'R-ELASTIC').byMetric.aOp.lastAdded)}）；D-HARD 的检测收益随 N 线性增长；D-SLOW、D-SDC、R-SDC、C-FAST 对 A_op 接近 0 或微负。</figcaption></figure>
  <details class="tv"><summary>图 3 数据表</summary>${c3.table}</details>
  ${mechanismTable(c3.ids)}
  <h2>4. 硬件故障率分配（每单元·小时 FIT，业务影响口径；允许值 = 当前 × 方案后硬件因子，ARINC 等比）</h2>
  ${domainTable()}
  <p class="small"><sup>†</sup>梯级（目录逐事件标记）：r 重执行、p 进程重调度、e DP 域弹性。"20 万集后停顿 · 残余"取 20 万卡价值最高的集；无梯级的域仍是完整的全局恢复 ${num(z3.planned.globalS, 0)} s。最小努力列 ● = 仅靠硬件达标时该域须降到共同水平（10 / 20 / 50 万卡：${[100000, 200000, 500000].map((N) => num(P[N].hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)).join(' / ')} FIT）。允许 FIT 因子：${SIZES.map((N) => `${zhNs(N)} × ${num(P[N].residualFactor.plan)}`).join('，')}。</p>
  <h2>5. 结论：各规模的薄弱环节与最重要的机制</h2>
  <div class="grid2">${conclusions()}</div>
  <footer>复现：<code>node --import tsx scripts/remap-allocation-98p5.ts --trials 200</code> → <code>node scripts/build-remap-allocation-98p5.mjs</code>；同一计算可在"审核与报告"页、<code>hacd study --players D-HARD,D-SLOW,D-SDC,R-SDC,R-REPLAY,R-PROCESS,R-ELASTIC,C-FAST</code> 或 MCP <code>allocation_study</code> 中重跑。方法：docs/MODEL_REFERENCE.md §22–§24。所有事件率与机制参数为参考目录先验，须以本集群实测替换。</footer>
</section>
</main>
<script type="application/json" id="aop-data">${JSON.stringify(c1.data)}</script>
<script>
(function(){
  function tipFor(el){ var f = el.closest('figure'); if(!f) return null; var t = f.querySelector('.tip'); if(!t){ t = document.createElement('div'); t.className='tip'; f.appendChild(t);} return t; }
  function place(t, f, ev){ var r = f.getBoundingClientRect(); var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14; if (x + 330 > r.width) x = Math.max(0, ev.clientX - r.left - 330); t.style.left = x + 'px'; t.style.top = y + 'px'; }
  document.querySelectorAll('[data-tip]').forEach(function(el){ el.addEventListener('mousemove', function(ev){ var f = el.closest('figure'); var t = tipFor(el); if(!t) return; t.textContent = el.getAttribute('data-tip'); t.style.display='block'; place(t, f, ev); }); el.addEventListener('mouseleave', function(){ var t = tipFor(el); if(t) t.style.display='none'; }); });
  var data = JSON.parse(document.getElementById('aop-data').textContent);
  var svg = document.getElementById('chart-aop'); if(!svg) return;
  var hit = document.getElementById('aop-hit'), xh = document.getElementById('aop-xh'), xl = document.getElementById('aop-xl'); var fig = svg.closest('figure'), tip = document.getElementById('tip-aop');
  function fmt(v){ return (v*100).toFixed(2) + ' %'; }
  hit.addEventListener('mousemove', function(ev){ var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; var p = pt.matrixTransform(svg.getScreenCTM().inverse()); var best = 0; for (var i = 1; i < data.x.length; i++) if (Math.abs(data.x[i] - p.x) < Math.abs(data.x[best] - p.x)) best = i; xl.setAttribute('x1', data.x[best]); xl.setAttribute('x2', data.x[best]); data.series.forEach(function(s, k){ var c = document.getElementById('aop-c' + k); c.setAttribute('cx', data.x[best]); c.setAttribute('cy', s.y[best]); }); xh.style.display = ''; tip.textContent = 'N = ' + data.grid[best].toLocaleString('en-US') + ' 卡\\n' + data.series.map(function(s){ return s.name + '：' + fmt(s.nominal[best]) + '（降额 ' + fmt(s.derated[best]) + '）'; }).join('\\n'); tip.style.display = 'block'; place(tip, fig, ev); });
  hit.addEventListener('mouseleave', function(){ xh.style.display = 'none'; tip.style.display = 'none'; });
})();
</script>
</body>
</html>
`;
writeFileSync(OUT_HTML, html);
console.log(`written ${OUT_HTML} (${(html.length / 1024).toFixed(0)} kB) and three SVGs in ${OUT_DIR}`);
