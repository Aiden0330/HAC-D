#!/usr/bin/env node
/**
 * Build docs/REMAP_LATEST_ALLOCATION_98P5.zh.html (two printed pages, three inline SVG charts with tooltips and table views)
 * from docs/remap-latest-allocation-98p5/results.json (scripts/remap-latest-allocation-98p5.ts): the 98.5 % allocation study
 * with the latest ReMAP's mechanism set (the 8 original mechanisms with parameter transforms + 15 extensions at ReMAP's explicit
 * scenario parameters) in the A_op 口径, the same study in ReMAP's own 口径 (delivered goodput), the cross-check against
 * ReMAP's vendored review engine (engine-check.json, scripts/remap-latest-check.ts), and comparison rows from the
 * ReMAP-original-only run (docs/remap-allocation-98p5/results.json) when it exists.
 * Usage: node scripts/build-remap-latest-allocation-98p5.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const IN = JSON.parse(readFileSync('docs/remap-latest-allocation-98p5/results.json', 'utf8'));
const R = IN.aOp;
const D = IN.delivered;
const OUT_HTML = 'docs/REMAP_LATEST_ALLOCATION_98P5.zh.html';
const OUT_DIR = 'docs/remap-latest-allocation-98p5';
mkdirSync(OUT_DIR, { recursive: true });
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const PREV = load('docs/remap-allocation-98p5/results.json')?.study ?? null;
const CMP = load('docs/mechanism-comparison-98p5/results.json');
const HACD10 = load('docs/availability-98p5/results.json');
const EC = load('docs/remap-latest-allocation-98p5/engine-check.json');
const AUDIT = JSON.parse(readFileSync('packages/core/data/mechanism-audit.json', 'utf8'));
const isExt = (id) => IN.extensions.includes(id);
const famTag = (id) => (isExt(id) ? '扩' : 'R');
const aud = (id) => AUDIT.mechanisms.find((m) => m.id === id);

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
const GROUPS = [['npu', 'NPU 芯片与内存'], ['network', '网络'], ['host', '主机'], ['facility', '机房设施'], ['storageSoftware', '存储 / 软件 / 未归因'], ['other', '亚健康隔离、静默错误暂停等']];
const groupVals = (d) => { const o = { ...d.byGroup }; o.other = (o.isolation ?? 0) + (o.sdcPause ?? 0) + (o.falseAlarm ?? 0) + (o.sdcDetected ?? 0); return GROUPS.map(([k]) => o[k] ?? 0); };
const setLabel = (ids, all = R.players) => { if (!ids.length) return '无需机制'; if (ids.length <= 7) return ids.join(' + '); const ex = all.filter((id) => !ids.includes(id)); if (ex.length <= 4) return `全部 ${all.length} 项减去 ${ex.join('、')}（${ids.length} 项）`; return `${ids.length} 项（原有 ${ids.filter((id) => !isExt(id)).length} + 扩展 ${ids.filter(isExt).length}，见第 3 节）`; };
const planLabel = (N) => setLabel(P[N].plan.ids);
const textW = (s) => Array.from(s).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.6), 0);
const attr = P[SIZES[0]].attribution;
const vt = P[SIZES[0]].verification.trials;
const extSum = (N) => P[N].gains.filter((g) => isExt(g.id)).reduce((a, g) => a + g.byMetric.aOp.shapley, 0);
const shap = (N, id, metric = 'aOp') => P[N].gains.find((g) => g.id === id).byMetric[metric].shapley;
const maxHalf = Math.max(...SIZES.flatMap((N) => P[N].gains.map((g) => g.halfWidth ?? 0)));
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
function legend(x, y, items, kind = 'line') { let off = 0; return items.map((it) => { const lx = x + off; off += 30 + textW(it.name) + 14; return kind === 'line' ? `<line x1="${lx}" x2="${lx + 18}" y1="${y}" y2="${y}" stroke="var(--s${it.slot + 1})" stroke-width="2.5" stroke-linecap="round"${it.dash ? ' stroke-dasharray="6 4"' : ''}/><text x="${lx + 24}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--s${it.slot + 1})"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join(''); }

/* ---------- chart 1: A_op vs N ---------- */
function chartAop() {
  const grid = R.curveGrid;
  const series = [];
  const push = (key, cv, cvD, name, leg, short, dash = false) => series.push({ key, nom: cv.points, der: cvD.points, maxN: cv.maxN, maxNDer: cvD.maxN, name, leg, short, dash, slot: series.length });
  for (const k of Object.keys(R.curves).filter((k) => !k.endsWith('Derated'))) {
    const c = R.curves[k], cd = R.curves[`${k}Derated`];
    if (k === 'baseline') push(k, c, cd, '基线（无机制）', '基线', '基线');
    else if (k === 'allOn') push(k, c, cd, `全部 ${R.players.length} 项同时启用`, `全部 ${R.players.length} 项`, `全部 ${R.players.length} 项`);
    else { const N = Number(k.replace('plan', '')); const feas = P[N].plan.feasible; push(k, c, cd, `${zhNs(N)}卡${feas ? '推荐集' : '价值最高集'}（${c.ids.length} 项）`, `${zhNs(N)}卡集（${c.ids.length} 项）`, `${zhNs(N)}卡集`); }
  }
  if (PREV && JSON.stringify(PREV.curveGrid) === JSON.stringify(grid) && series.length < 6) push('prev200000', PREV.curves.plan200000, PREV.curves.plan200000Derated, `对照：仅 ReMAP 原有机制的 20 万卡最高集（${PREV.curves.plan200000.ids.length} 项）`, '仅原有机制 20 万卡集（对照）', '仅原有 20 万集', true);
  const W = 960, H = 372, L = 54, Rm = 170, Tp = 54, B = 40, pw = W - L - Rm, ph = H - Tp - B;
  const lx0 = Math.log10(grid[0]), lx1 = Math.log10(grid[grid.length - 1]);
  const xs = (N) => L + ((Math.log10(N) - lx0) / (lx1 - lx0)) * pw;
  const ys = (a) => Tp + ((1 - Math.max(0.8, a)) / 0.2) * ph;
  let g = svgOpen('chart-aop', W, H) + `<text x="${L}" y="20" class="ttl">图 1 · 运行可用率 A_op 随集群规模的变化（ReMAP 最新机制集：原有 + 扩展；名义参数实线，色带到降额参数的下限）</text>` + legend(L, 38, series.map((s) => ({ name: s.leg, slot: s.slot, dash: s.dash })));
  for (let v = 80; v <= 100; v += 5) { const y = ys(v / 100); g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="m tick">${v} %</text>`; }
  for (const N of [5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]) { const x = xs(N); g += `<line x1="${x}" x2="${x}" y1="${Tp + ph}" y2="${Tp + ph + 5}" class="axis"/><text x="${x}" y="${Tp + ph + 18}" text-anchor="middle" class="m tick">${kfmt(N)}</text>`; }
  g += `<line x1="${L}" x2="${L + pw}" y1="${Tp + ph}" y2="${Tp + ph}" class="axis"/><text x="${L + 150}" y="${H - 6}" text-anchor="middle" class="m">集群规模 N（卡，对数轴）</text>`;
  const yT = ys(R.target);
  g += `<line x1="${L}" x2="${L + pw}" y1="${yT}" y2="${yT}" class="ref"/><text x="${L + 6}" y="${yT - 5}" class="t2">目标 A_op ≥ ${pct(R.target, 1)} %</text>`;
  for (const s of series) { const poly = s.nom.map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`).concat(s.der.slice().reverse().map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`)).join(' '); g += `<polygon points="${poly}" fill="var(--s${s.slot + 1})" opacity="${s.dash ? 0.08 : 0.14}"/>`; }
  const labels = [];
  for (const s of series) {
    g += `<path d="${s.nom.map((p, i) => `${i ? 'L' : 'M'}${xs(p.N).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--s${s.slot + 1})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="6 4"' : ''}/>`;
    for (const N of SIZES) { const p = s.nom.find((q) => q.N === N); if (p) g += `<circle cx="${xs(N).toFixed(1)}" cy="${ys(p.value).toFixed(1)}" r="4" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`; }
    const last = s.nom[s.nom.length - 1];
    labels.push({ y: ys(last.value), text: `${s.short} ${pct(last.value, 1)} %` });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  for (const lb of labels) g += `<text x="${L + pw + 8}" y="${lb.y + 4}" class="t2">${esc(lb.text)}</text>`;
  const marks = series.map((s) => ({ s, N: s.maxN })).filter((m) => m.N > grid[0] && m.N < grid[grid.length - 1]).sort((a, b) => a.N - b.N);
  const tiers = [{ y: yT + 17, last: -1e9 }, { y: yT - 11, last: -1e9 }, { y: yT + 29, last: -1e9 }];
  for (const m of marks) { const x = xs(m.N); const tier = tiers.find((t) => x - t.last >= 44) ?? tiers[2]; tier.last = x; g += `<circle cx="${x.toFixed(1)}" cy="${yT}" r="4.5" fill="var(--s${m.s.slot + 1})" stroke="var(--surface)" stroke-width="2"/><text x="${x.toFixed(1)}" y="${tier.y}" text-anchor="middle" class="t2 tick">${kfmt(m.N)}</text>`; }
  g += `<text x="${L + pw}" y="${H - 6}" text-anchor="end" class="m">● 目标线上的圆点：名义参数下仍满足 98.5 % 的最大规模；虚线 = 上一报告的对照</text>`;
  g += `<g class="xh" id="aop-xh" style="display:none"><line id="aop-xl" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" class="ref"/>${series.map((s) => `<circle id="aop-c${s.slot}" r="5" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g><rect class="hit" id="aop-hit" x="${L}" y="${Tp}" width="${pw}" height="${ph}"/></svg>`;
  const data = { grid, x: grid.map((N) => +xs(N).toFixed(1)), series: series.map((s) => ({ name: s.name, nominal: s.nom.map((p) => p.value), derated: s.der.map((p) => p.value), y: s.nom.map((p) => +ys(p.value).toFixed(1)) })) };
  const table = `<table class="tv"><tr><th>N</th>${series.map((s) => `<th class="num">${esc(s.name)}<br><span class="small">名义 / 降额</span></th>`).join('')}</tr>${grid.map((N, i) => `<tr><td class="num">${N.toLocaleString('en-US')}</td>${series.map((s) => `<td class="num">${pct(s.nom[i].value)} / ${pct(s.der[i].value)}</td>`).join('')}</tr>`).join('')}<tr><td>满足 98.5 % 的最大 N</td>${series.map((s) => `<td class="num">${s.maxN.toLocaleString('en-US')} / ${s.maxNDer.toLocaleString('en-US')}</td>`).join('')}</tr></table>`;
  return { svg: g, data, table, series };
}

/* ---------- chart 2: unavailability composition ---------- */
function chartUnavail() {
  const rows = [];
  for (const N of SIZES) {
    rows.push({ label: `${zhNs(N)} · 基线`, N, set: P[N].plan.ids.length ? '无机制' : '无机制（基线已达标，无需机制）', vals: groupVals(P[N].baseline), group: N });
    if (!P[N].plan.ids.length) continue;
    if (PREV && PREV.perSize[N]?.plan.ids.length) rows.push({ label: `${zhNs(N)} · 原有集`, N, set: `仅 ReMAP 原有机制${PREV.perSize[N].plan.feasible ? '的推荐集' : '价值最高的集'}：${PREV.perSize[N].plan.ids.join(' + ')}`, vals: groupVals(PREV.perSize[N].planned), group: N });
    rows.push({ label: `${zhNs(N)} · 最新集`, N, set: `ReMAP 最新机制集${P[N].plan.feasible ? '的推荐集' : '价值最高的集'}：${planLabel(N)}`, vals: groupVals(P[N].planned), group: N });
  }
  const W = 960, L = 120, Rm = 70, Tp = 66, rowP = 22, groupGap = 8, barH = 14, B = 36;
  const nGroups = new Set(rows.map((r) => r.group)).size;
  const H = Tp + rows.length * rowP + (nGroups - 1) * groupGap + B;
  const pw = W - L - Rm, xmax = 12;
  const xs = (v) => L + (v / xmax) * pw;
  let g = svgOpen('chart-unavail', W, H) + `<text x="${L}" y="20" class="ttl">图 2 · 不可用度的构成（pt = 100 − A_op）：基线 / 仅原有机制的集 / 最新机制集（无可行集时取价值最高的集），预算线 1.5 pt</text>` + legend(L, 38, GROUPS.map(([, name], i) => ({ name, slot: i })), 'rect');
  const plotTop = Tp, plotBot = H - B;
  for (let v = 0; v <= xmax; v += 2) { const x = xs(v); g += `<line x1="${x}" x2="${x}" y1="${plotTop - 4}" y2="${plotBot}" class="grid"/><text x="${x}" y="${plotBot + 16}" text-anchor="middle" class="m tick">${v}</text>`; }
  g += `<text x="${L + pw}" y="${plotBot + 30}" text-anchor="end" class="m">不可用度（百分点）</text>`;
  const xb = xs((1 - R.target) * 100);
  g += `<line x1="${xb}" x2="${xb}" y1="${plotTop - 4}" y2="${plotBot}" class="ref"/><text x="${xb + 4}" y="${plotTop - 8}" class="t2">预算 1.5 pt</text>`;
  let y = plotTop + 4;
  rows.forEach((r, ri) => {
    if (ri > 0 && rows[ri - 1].group !== r.group) y += groupGap;
    const total = r.vals.reduce((a, b) => a + b, 0);
    g += `<text x="${L - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="t2">${esc(r.label)}</text>`;
    let x = L;
    r.vals.forEach((v, gi) => { const w = (v * 100 / xmax) * pw; if (w > 0.2) { const wi = Math.max(0, w - (gi < r.vals.length - 1 ? 2 : 0)); g += `<rect x="${x.toFixed(1)}" y="${y}" width="${wi.toFixed(1)}" height="${barH}" rx="${gi === r.vals.length - 1 ? 3 : 0}" fill="var(--s${gi + 1})" data-tip="${esc(r.label)}（${esc(r.set)}）\n${esc(GROUPS[gi][1])}：${pt(v)} pt，占 ${(v / total * 100).toFixed(1)} %\n合计 ${pt(total)} pt"/>`; } x += w; });
    g += `<text x="${(x + 6).toFixed(1)}" y="${y + barH / 2 + 4}" class="t2 tick">${pt(total)}</text>`;
    y += rowP;
  });
  g += '</svg>';
  const table = `<table class="tv"><tr><th>行</th><th>机制集</th>${GROUPS.map(([, n]) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">合计 pt</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.set)}</td>${r.vals.map((v) => `<td class="num">${pt(v, 3)}</td>`).join('')}<td class="num">${pt(r.vals.reduce((a, b) => a + b, 0), 3)}</td></tr>`).join('')}</table>`;
  return { svg: g, table };
}

/* ---------- chart 3: Shapley heatmap, two blocks ---------- */
function chartShapley() {
  const avg = (id) => SIZES.reduce((s, N) => s + shap(N, id), 0) / SIZES.length;
  const ids = R.players.slice().sort((a, b) => avg(b) - avg(a));
  const vmax = Math.max(...SIZES.flatMap((N) => P[N].gains.map((x) => Math.abs(x.byMetric.aOp.shapley))));
  const half = Math.ceil(ids.length / 2);
  const blocks = [ids.slice(0, half), ids.slice(half)];
  const W = 960, labelW = 158, colW = 64, effW = 40, rowH = 22, Tp = 62, legH = 58, gap = 30;
  const blockW = labelW + SIZES.length * colW + effW;
  const x0s = [14, 14 + blockW + gap];
  const H = Tp + half * rowH + legH;
  let g = svgOpen('chart-shapley', W, H) + `<text x="14" y="20" class="ttl">图 3 · ReMAP 最新机制集 ${R.players.length} 项对 A_op 的 Shapley 贡献（百分点${attr.method === 'sampled' ? `；置换抽样 ${attr.permutations} 次，95 % 半宽见悬停与数据表` : '；全组合精确值'}）；带框 = 该规模推荐集所含</text>`;
  const cls = (v) => { if (Math.abs(v) < 0.0005) return 'mid'; const k = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.abs(v) / vmax) * 4))); return (v > 0 ? 'h' : 'n') + k; };
  blocks.forEach((blk, bi) => {
    const x0 = x0s[bi];
    g += `<text x="${x0}" y="${Tp - 8}" class="m">${bi === 0 ? '机制（R = 原有，扩 = 扩展；按平均贡献排序）' : '（续）'}</text>`;
    SIZES.forEach((N, j) => { g += `<text x="${x0 + labelW + j * colW + colW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">${zhN(N)}</text>`; });
    g += `<text x="${x0 + labelW + SIZES.length * colW + effW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">工作量</text>`;
    blk.forEach((id, i) => {
      const y = Tp + i * rowH;
      g += `<text x="${x0}" y="${y + rowH / 2 + 4}" class="t2" style="font-size:11px"><tspan class="m">${famTag(id)}</tspan> ${esc(id)}</text>`;
      SIZES.forEach((N, j) => {
        const gn = P[N].gains.find((x) => x.id === id); const v = gn.byMetric.aOp.shapley; const c = cls(v); const x = x0 + labelW + j * colW; const inPlan = P[N].plan.ids.includes(id);
        const tip = `${esc(id)} ${esc(mechName(id))} · ${zhN(N)}\nShapley（A_op）${sgn(v, 3)} pt${gn.halfWidth !== undefined ? ` ± ${num(gn.halfWidth * 100, 3)}` : ''}；单独启用 ${sgn(gn.byMetric.aOp.single, 3)}；末位加入 ${sgn(gn.byMetric.aOp.lastAdded, 3)}\nShapley（正确交付）${sgn(gn.byMetric.delivered.shapley, 2)} pt${inPlan ? '\n在该规模的推荐集中' : ''}`;
        g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" fill="var(--${c})" data-tip="${tip}"/>`;
        if (inPlan) g += `<rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" stroke="var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" stroke="var(--ink)" stroke-width="1.5" pointer-events="none"/>`;
        const dark = c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';
        g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${dark ? ' onDark' : ''}" pointer-events="none">${sgn(v)}</text>`;
      });
      g += `<text x="${x0 + labelW + SIZES.length * colW + effW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2 tick">${LIB[id].effort}</text>`;
    });
  });
  const ly = Tp + half * rowH + 16, sx = 14 + 60;
  ['n4', 'n3', 'n2', 'n1', 'mid', 'h1', 'h2', 'h3', 'h4'].forEach((c, i) => { g += `<rect x="${sx + i * 26}" y="${ly}" width="24" height="12" fill="var(--${c})"/>`; });
  g += `<text x="${sx - 6}" y="${ly + 10}" text-anchor="end" class="m tick">−${(vmax * 100).toFixed(1)} pt</text><text x="${sx + 9 * 26 + 6}" y="${ly + 10}" class="m tick">+${(vmax * 100).toFixed(1)} pt（色阶按 √|值| 分级；负值均小于 0.03 pt）</text><text x="${sx + 4 * 26 + 12}" y="${ly + 23}" text-anchor="middle" class="m">0</text>`;
  g += `<text x="14" y="${ly + 36}" class="m">静默错误检测与 checkpoint 类机制改善正确交付而非 A_op，故接近 0 或微负；扩展机制按 ReMAP 显式情景（适用 100 %、成功 95 %、失败尝试 0 s）计，推荐集另经规划器降额。</text></svg>`;
  const table = `<table class="tv"><tr><th>机制</th>${SIZES.map((N) => `<th class="num">${zhN(N)}<br><span class="small">Shapley ± 95 % 半宽 / 单独 / 末位（pt）</span></th>`).join('')}</tr>${ids.map((id) => `<tr><td>${famTag(id)} ${esc(id)} ${esc(mechName(id))}</td>${SIZES.map((N) => { const gn = P[N].gains.find((x) => x.id === id); return `<td class="num">${sgn(gn.byMetric.aOp.shapley)} ± ${num((gn.halfWidth ?? 0) * 100, 2)} / ${sgn(gn.byMetric.aOp.single)} / ${sgn(gn.byMetric.aOp.lastAdded)}</td>`; }).join('')}</tr>`).join('')}</table>`;
  return { svg: g, table, ids };
}

/* ---------- tables ---------- */
const topGroups = (d) => { const vals = groupVals(d); const tot = vals.reduce((a, b) => a + b, 0); return GROUPS.map(([, n], i) => [n, vals[i]]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, v]) => `${n} ${(v / tot * 100).toFixed(0)} %`).join('，'); };
const fitTotal = R.domains.reduce((a, d) => a + d.fit, 0);
function summaryTable() {
  const row = (label, f) => `<tr><td class="k" style="white-space:normal">${label}</td>${SIZES.map((N) => `<td>${f(N, P[N])}</td>`).join('')}</tr>`;
  const me = (z) => (z.hardwareOnly.minimumEffort && z.hardwareOnly.minimumEffort.rows.some((r) => r.improvementFactor > 1.0001) ? `${z.hardwareOnly.minimumEffort.rows.filter((r) => r.improvementFactor > 1.0001).length} 个域降到 ${num(z.hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)} FIT` : '已满足');
  return `<div class="table-wrap"><table>
<tr><th style="width:21%">量（30 天窗口，A_op 口径）</th>${SIZES.map((N) => `<th>${zhN(N)}</th>`).join('')}</tr>
${row('基线 A_op · 缺口', (N, z) => `${pct(z.baseline.aOp)} % · ${z.baseline.aOp >= R.target ? `余量 ${pt(z.baseline.aOp - R.target)}` : `缺 ${pt(R.target - z.baseline.aOp)}`} pt`)}
${row('作业中断率 λ_job · MTBI · R̄', (N, z) => `${num(z.baseline.lambdaJob, 3)} /h · ${num(z.baseline.mtbiHours, 1)} h · ${num(z.baseline.recoveryS, 0)} s`)}
${row('仅改硬件：故障率 × f（允许 FIT 合计）· MTBI ≥ · 最小努力法', (N, z) => `× ${num(z.hardwareOnly.factor, 3)}（${num(fitTotal * z.hardwareOnly.factor, 0)} FIT）· ${num(z.hardwareOnly.mtbiStarHours, 2)} h · ${me(z)}`)}
${row('仅改恢复：R̄ 须 ≤ · 阶段预算 检测 / 自动 / 人工份额', (N, z) => `${num(z.recoveryOnly.recoveryStarS, 0)} s（× ${num(z.recoveryOnly.factor, 3)}）· ${z.recoveryOnly.stages.map((s) => num(s.budgetS, 0)).join(' / ')} s`)}
${row(`推荐机制集（最低工作量可行集；${R.players.length} 项候选 → 贪心逐步加入）· 工作量`, (N, z) => `${z.plan.feasible ? '' : '<b>无可行集</b>；价值最高的集：'}${esc(planLabel(N))} · ${z.plan.effort}${z.plan.feasible && !z.plan.ids.length ? ' · 基线已达标' : ''}`)}
${row('方案 A_op 名义 / 降额 · 方案后硬件因子（名义 / 降额）', (N, z) => `${pct(z.plan.nominal)} / ${pct(z.plan.derated)} %${z.plan.feasible ? '' : '（不达标）'} · × ${num(z.residualFactor.plan)} / × ${num(z.residualFactor.planDerated)}${z.residualFactor.plan >= 1 ? '（余量）' : '（仍须改进）'}`)}
${PREV ? row('对照：仅 ReMAP 原有机制（上一报告，精确枚举）· A_op 名义 / 降额', (N) => { const q = PREV.perSize[N]; return q.plan.feasible ? `${esc(q.plan.ids.join(' + ') || '无需机制')} · ${pct(q.plan.nominal)} / ${pct(q.plan.derated)} %` : `<b>无可行集</b>；最高 ${q.plan.ids.length} 项 ${pct(q.plan.nominal)} / ${pct(q.plan.derated)} %`; }) : ''}
${row(`校核（${vt} 窗口）：P(A_op ≥ 98.5 %) [Wilson 95 %] · 判定 · 均值 ± t 半宽 · 5 % 分位`, (N, z) => `${pct(z.verification.pAtLeastTarget, 1)} % [${pct(z.verification.wilson[0], 1)}–${pct(z.verification.wilson[1], 1)}] · <b>${z.verification.verdict}</b> · ${pct(z.verification.value.mean)} ± ${pct(z.verification.value.ci95)} · ${pct(z.verification.value.p05)} %`)}
${row('恢复杠杆（库外参数，机制集之上）：+ 自动尝试 60 s · + 三项同时（自动 60 s、成功率 99.9 %、人工 30 min），名义 / 降额 · 硬件因子', (N, z) => { const l = (id) => (z.levers ?? []).find((x) => x.id === id); const a = l('auto60'), b = l('all3'); const f = (x) => { const ok = x.value >= R.target && x.valueDerated >= R.target; return `${ok ? '<b>' : ''}${pct(x.value)} / ${pct(x.valueDerated)} %${ok ? '</b>' : ''} · × ${num(x.residualFactor)}`; }; return a && b ? `${f(a)} · ${f(b)}` : '—'; })}
</table></div>`;
}
const LEVER_NAMES = { plan: '推荐机制集（库内参数）', auto60: '+ 自动恢复尝试 180 → 60 s', ps999: '+ 自动恢复成功率 99 → 99.9 %', manual30: '+ 人工恢复 120 → 30 min', 'auto60+ps999': '+ 自动 60 s 与成功率 99.9 %', 'auto60+manual30': '+ 自动 60 s 与人工 30 min', 'ps999+manual30': '+ 成功率 99.9 % 与人工 30 min', all3: '+ 三项同时' };
const PK = { coverage: ['覆盖率', '', 1], detectSeconds: ['检测', ' s', 1], success: ['成功率', '', 1], successSeconds: ['成功耗时', ' s', 1], failureSeconds: ['失败耗时', ' s', 1], domains: ['域数', '', 1], recoverSeconds: ['域恢复', ' s', 1], syncSeconds: ['协调', ' s', 1], computeSeconds: ['τ', ' s', 1], saveSeconds: ['δ', ' s', 1], stepSeconds: ['step', ' s', 1], recoverSecondsSdc: ['恢复', ' s', 1], pauseSeconds: ['停顿', ' s', 1], switchSeconds: ['切换', ' s', 1], exposedCommunicationFraction: ['通信暴露 f', '', 1], remainingBandwidthRatio: ['剩余带宽 r', '', 1], repairSeconds: ['修复', ' s', 1], startupTargetSeconds: ['启动目标', ' s', 1], blockingTargetSeconds: ['阻塞目标', ' s', 1], durableLagSeconds: ['持久化滞后', ' s', 1], compressionRatio: ['压缩比', '', 1], decompressSeconds: ['解压', ' s', 1], manualProbabilityTarget: ['人工概率目标', '', 1], detectionTarget: ['检出目标', '', 1], upstreamDetection: ['上游检出', '', 1], conditionalMissDetection: ['漏检补捕', '', 1], overhead: ['开销', ' %', 100], occurrenceReduction: ['发生率降低', '', 1], communicationBeforeSeconds: ['通信重建前', ' s', 1], communicationTargetSeconds: ['通信重建目标', ' s', 1], graphTargetSeconds: ['图准备目标', ' s', 1], eligibleShare: ['适用比例', '', 1], riskShare: ['风险占比', '', 1], share: ['适用 × 成功', '', 1] };
const fmtParams = (nom, der) => Object.keys(nom).filter((k) => !(Number(nom[k]) === 0 && Number(der[k] ?? nom[k]) === 0)).map((k) => { const [lab, unit, mul] = PK[k] ?? [k, '', 1]; const a = +(nom[k] * mul).toFixed(3), b = +((der[k] ?? nom[k]) * mul).toFixed(3); return `${lab} ${a}${a !== b ? `→${b}` : ''}${unit}`; }).join('，');
const ORIG_ROLE = { 'R-ELASTIC': 'DP 域弹性梯级；与重执行 / 进程重调度互为替代，20 万卡起三者同时启用', 'R-REPLAY': '重执行梯级：最便宜的一项，贪心路径的第一步', 'R-PROCESS': '进程重调度梯级', 'D-HARD': '检测 12.5 → 1 s，收益随 N 线性增长', 'D-SLOW': '亚健康检测', 'D-SDC': '静默错误即时检测（改善正确交付）', 'R-SDC': '静默错误恢复', 'C-FAST': '缩短 CKPT 周期与保存阻塞（改善正确交付）' };
const SCENARIO_KEYS = new Set(['eligibleShare', 'success', 'failureSeconds', 'share']);
function mechanismTable(ids) {
  const members = ids.filter((id) => SIZES.some((N) => P[N].plan.ids.includes(id)));
  const role = (id) => { const a = aud(id); if (!a) return ORIG_ROLE[id] ?? '—'; const ev = a.eventCandidates.map((e) => e.replace(/-(hard|sdc|slow)$/, '')); return `${esc(a.lever)}（${ev.length > 5 ? `${ev.length} 类事件` : esc(ev.join('、'))}）`; };
  const params = (id) => { const lb = LIB[id]; const nom = isExt(id) ? Object.fromEntries(Object.keys(lb.parameters).filter((k) => !SCENARIO_KEYS.has(k)).map((k) => [k, lb.parameters[k]])) : lb.parameters; return fmtParams(nom, lb.derated); };
  return `<div class="table-wrap"><table class="dense"><tr><th style="width:28%">机制（进入任一规模推荐集的 ${members.length} 项；作用见审核库与第 5 节的适用字母）</th><th style="width:44%">参数：名义→降额（无箭头 = 不降额；扩展项另有公共情景参数：适用 1→0.95、成功 0.95→0.87、失败尝试 0 s）</th><th class="num" style="width:5%">工作量</th><th style="width:10%">推荐集<br>1/10/20/50 万</th><th class="num">Shapley pt<br>20 万 / 50 万</th></tr>${members.map((id) => { const lb = LIB[id]; return `<tr><td class="k" style="white-space:normal" title="${esc(role(id))}">${famTag(id)} <b>${esc(id)}</b> <span class="small">${esc(mechName(id))}</span></td><td><span class="small">${esc(params(id))}</span></td><td class="num">${lb.effort}</td><td style="white-space:nowrap">${SIZES.map((N) => (P[N].plan.ids.includes(id) ? '●' : '○')).join('')}</td><td class="num">${sgn(shap(200000, id))} / ${sgn(shap(500000, id))}</td></tr>`; }).join('')}</table></div>`;
}
function domainTable() {
  const doms = R.domains.filter((d) => d.fit > 0).sort((a, b) => b.fit - a.fit);
  const d200 = P[200000].planned.byDomain;
  const improved = (N, id) => { const r = P[N].hardwareOnly.minimumEffort?.rows.find((x) => x.id === id); return r && r.improvementFactor > 1.0001 ? '●' : '○'; };
  const code = { 'R-LINK-LOCAL': 'L', 'R-FABRIC-DEGRADE': 'F', 'H-CONTROL-CONTINUITY': 'M', 'R-WARM-PROCESS': 'W', 'R-RUNTIME-SNAPSHOT': 'S', 'R-CANN-GRAPH': 'G' };
  const extFlags = (id) => AUDIT.mechanisms.filter((m) => code[m.id] && m.eventCandidates.includes(id)).map((m) => code[m.id]).join(' ');
  return `<div class="table-wrap"><table class="dense"><tr><th>域</th><th class="num">当前 FIT</th><th class="num">占 λ</th><th>梯级<sup>†</sup></th><th>扩展适用<sup>†</sup></th><th class="num">20 万集后<br>停顿 s · 残余</th>${SIZES.map((N) => `<th class="num">允许 FIT<br>${zhNs(N)}</th>`).join('')}<th>最小努力<br>10/20/50 万</th></tr>${doms.map((d) => { const after = d200[d.id]; const flags = [d.flags.replay ? 'r' : '', d.flags.process ? 'p' : '', d.flags.elastic ? 'e' : ''].filter(Boolean).join(' ') || '<b>无</b>'; return `<tr><td class="k">${esc(d.id.replace(/-hard$/, ''))} <span class="small">${esc(d.name.split(' · ')[0])}</span></td><td class="num">${num(d.fit, 1)}</td><td class="num">${(d.fit / fitTotal * 100).toFixed(1)} %</td><td style="white-space:nowrap">${flags}</td><td style="white-space:nowrap">${extFlags(d.id) || '<b>无</b>'}</td><td class="num">${num(after.meanPauseS, 0)} · ${(after.share * 100).toFixed(1)} %</td>${SIZES.map((N) => `<td class="num">${num(d.fit * P[N].residualFactor.plan, 0)}</td>`).join('')}<td>${[100000, 200000, 500000].map((N) => improved(N, d.id)).join('')}</td></tr>`; }).join('')}<tr><td class="k">合计</td><td class="num">${num(fitTotal, 1)}</td><td class="num">100 %</td><td></td><td></td><td></td>${SIZES.map((N) => `<td class="num">${num(fitTotal * P[N].residualFactor.plan, 0)}</td>`).join('')}<td></td></tr></table></div>`;
}

/* ---------- ReMAP's own 口径 and the engine cross-check ---------- */
const topDeliv = (N, n = 3) => D.perSize[N].gains.slice().sort((a, b) => b.byMetric.delivered.shapley - a.byMetric.delivered.shapley).slice(0, n).map((g) => `${g.id} ${sgn(g.byMetric.delivered.shapley)}`).join('，');
function deliveredTable() {
  if (!D) return '';
  const PD = D.perSize;
  const grid = D.curveGrid;
  const mx = (c) => (c.maxN <= grid[0] ? '—' : kfmt(c.maxN));
  const lines = (l) => [['停机', l.downtime], ['保存阻塞', l.save], ['回滚', l.rollback], ['静默错误回滚', l.sdcRollback], ['期末判废', l.terminal], ['降速 / 域内 / 开销', l.slowdown + l.local + l.blocked + l.overhead]].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${pt(v)}`).join('，');
  const rows = SIZES.map((N) => { const z = PD[N]; const l = z.planned.ledger; return `<tr><td class="k">${zhN(N)}</td><td class="num">${pct(z.baseline.value)} %</td><td>${z.plan.feasible ? '' : '<b>无可行集</b>；最高：'}${esc(setLabel(z.plan.ids))} · ${z.plan.effort}</td><td class="num">${pct(z.plan.nominal)} / ${pct(z.plan.derated)} %</td><td class="num">${pt(l.save + l.overhead + l.blocked)}</td><td class="num">${z.residualFactor.plan > 0 ? `× ${num(z.residualFactor.plan)}` : '不可达'} / ${z.residualFactor.planDerated > 0 ? `× ${num(z.residualFactor.planDerated)}` : '不可达'}</td><td class="num">${z.verification ? `${pct(z.verification.pAtLeastTarget, 1)} % · ${z.verification.verdict}` : '—'}</td><td class="small" style="white-space:nowrap">${lines(l)}</td></tr>`; }).join('');
  const maxNs = Object.keys(D.curves).filter((k) => !k.endsWith('Derated')).map((k) => `${k === 'baseline' ? '基线' : k === 'allOn' ? '全部启用' : `${zhNs(Number(k.replace('plan', '')))}卡集`} ${mx(D.curves[k])} / ${mx(D.curves[`${k}Derated`])}`).join('，');
  return `<div class="table-wrap"><table class="dense"><tr><th style="width:6%">规模</th><th class="num" style="width:6%">基线</th><th style="width:30%">推荐集（正确交付 ≥ 98.5 %；贪心）· 工作量</th><th class="num" style="width:8%">名义 /<br>降额</th><th class="num" style="width:6%">常量<br>损失 pt</th><th class="num" style="width:10%">硬件因子<br>名义 / 降额</th><th class="num" style="width:12%">P(窗口 ≥ 98.5 %)<br>· 判定</th><th>方案后主要损失项（pt）</th></tr>${rows}</table></div>
<p class="small">ReMAP 的"可用度"= 窗口内最终保留的正确进度 ÷ 窗口长度（HAC-D 的正确交付 goodput；ReMAP 分规模默认目标 99.97 / 99.70 / 99.39 / 98.5 %，这里统一取 98.5 %）；该口径下静默错误检测与 checkpoint 机制才是主要杠杆（10 万卡 Shapley：${topDeliv(100000)}）。常量损失 = 保存阻塞 δ/(τ+δ) + ABFT 开销，与硬件无关；"不可达"= 硬件中断率降到 0 也到不了目标，因为常量损失已超过 1.5 pt（50 万卡的集含 C-FAST：τ 60 s、δ 1 s，保存损失 ${pt(PD[500000].planned.ledger.save)} pt）。满足 98.5 % 的最大规模（名义 / 降额，— = 不达标）：${maxNs}。</p>`;
}
function engineCheckTable() {
  if (!EC) return '';
  const name = { originals: '原有 8 项', extensions: '扩展 15 项', all: '原有 + 扩展 23 项' };
  const cell = (d, hw, dd) => { const out = Math.abs(d) > hw; return `<td class="num">${out ? '<b>' : ''}${sgn(d, dd)}${out ? '†</b>' : ''}</td>`; };
  const rows = EC.results.map((r) => `<tr><td class="k">${name[r.coalition] ?? esc(r.coalition)}</td><td class="num">${r.N.toLocaleString('en-US')}</td><td class="num">${pct(r.remap.aOp.mean, 3)} ± ${pct(r.remap.aOp.ci95, 3)}</td><td class="num">${pct(r.hacd.aOp, 3)}</td>${cell(r.hacd.aOp - r.remap.aOp.mean, r.remap.aOp.ci95, 3)}<td class="num">${pct(r.remap.delivered.mean)} ± ${pct(r.remap.delivered.ci95)}</td><td class="num">${pct(r.hacd.delivered)}</td>${cell(r.hacd.delivered - r.remap.delivered.mean, r.remap.delivered.ci95, 2)}</tr>`).join('');
  const dA = EC.results.map((r) => r.hacd.aOp - r.remap.aOp.mean), dD = EC.results.map((r) => r.hacd.delivered - r.remap.delivered.mean);
  const outA = EC.results.filter((r, i) => Math.abs(dA[i]) > r.remap.aOp.ci95).length, outD = EC.results.filter((r, i) => Math.abs(dD[i]) > r.remap.delivered.ci95).length;
  const maxAbs = (a) => Math.max(...a.map(Math.abs));
  return `<div class="table-wrap"><table class="dense"><tr><th>ReMAP 最新引擎（${EC.trials} 个窗口，± 95 % 半宽）vs HAC-D 闭式</th><th class="num">卡数</th><th class="num">ReMAP A_op %</th><th class="num">HAC-D A_op %</th><th class="num">差 pt</th><th class="num">ReMAP 正确交付 %</th><th class="num">HAC-D 正确交付 %</th><th class="num">差 pt</th></tr>${rows}</table></div>
<p class="small">同一事件目录、同一基线恢复参数与 ReMAP 的显式扩展情景直接喂给最新仓库 packages/solvers 内的 review 引擎（含扩展实现），与 HAC-D 闭式结果并列。A_op 的差最大 ${pt(maxAbs(dA), 3)} pt（${outA ? `${outA} 项超出半宽，超出量 ≤ ${pt(Math.max(...EC.results.map((r, i) => Math.abs(dA[i]) - r.remap.aOp.ci95)), 4)} pt` : '均在半宽内'}）；正确交付的差最大 ${pt(maxAbs(dD))} pt（${outD} 项超出半宽，† 标记），来自 ReMAP 对 FP8 / FP4 / 网络静默检测取最大值而 HAC-D 在残余漏检上复合、引擎逐事件抽样适用与成功，以及静默错误 120 h 后才被校验发现的重尾（标准差 3–11 pt，${EC.trials} 个窗口的半宽 0.3–1 pt）；按 ReMAP 自身口径的分配见第 4 节。</p>`;
}

/* ---------- conclusions ---------- */
function famTopFam(N, ext, n = 3) { return P[N].gains.filter((g) => isExt(g.id) === ext).sort((a, b) => b.byMetric.aOp.shapley - a.byMetric.aOp.shapley).slice(0, n).map((g) => `${g.id} ${sgn(g.byMetric.aOp.shapley)}`).join('，'); }
function delivLine(N) {
  const z = D.perSize[N];
  if (z.plan.feasible) return `ReMAP 口径（正确交付 ≥ 98.5 %）：基线 ${pct(z.baseline.value, 1)} %，${setLabel(z.plan.ids)} → ${pct(z.plan.nominal)} % / 降额 ${pct(z.plan.derated)} %。`;
  return `ReMAP 口径（正确交付 ≥ 98.5 %）：基线 ${pct(z.baseline.value, 1)} %，无可行集，最高 ${pct(Math.max(z.plan.nominal, z.plan.maxValue))} %（${z.plan.ids.length} 项）${z.residualFactor.plan > 0 ? `，硬件 × ${num(z.residualFactor.plan)} 可补足` : '，硬件改进也不可达（常量损失超预算）'}。`;
}
function conclusions() {
  return SIZES.map((N) => {
    const z = P[N];
    const base = z.baseline.aOp;
    const head = base >= R.target ? `${zhN(N)}：基线已达标（${pct(base)} %）` : z.plan.feasible ? `${zhN(N)}：缺 ${pt(R.target - base)} pt，ReMAP 最新机制集可以补足` : `${zhN(N)}：缺 ${pt(R.target - base)} pt，ReMAP 最新机制集仍不够`;
    const li = [];
    const q = PREV?.perSize[N];
    if (base >= R.target) li.push(`无需机制；硬件余量 × ${num(z.residualFactor.plan, 1)}，恢复余量 × ${num(z.recoveryOnly.factor, 1)}（R̄ 可放宽到 ${num(z.recoveryOnly.recoveryStarS, 0)} s）；${vt} 个窗口全部 ≥ 98.5 %（5 % 分位 ${pct(z.verification.value.p05)} %）。`);
    else if (z.plan.feasible) {
      li.push(`${planLabel(N)}（工作量 ${z.plan.effort}）→ ${pct(z.plan.nominal)} %（降额 ${pct(z.plan.derated)} %），P(窗口 ≥ 98.5 %) = ${pct(z.verification.pAtLeastTarget, 1)} %，${z.verification.verdict}；方案后硬件余量 × ${num(z.residualFactor.plan)}。`);
      if (q && q.plan.feasible && q.plan.ids.length && q.plan.ids.join() !== z.plan.ids.join()) li.push(`对照：仅原有机制的精确枚举给出 ${q.plan.ids.join(' + ')}（工作量 ${q.plan.effort}）→ ${pct(q.plan.nominal)} % / 降额 ${pct(q.plan.derated)} %${q.plan.effort <= z.plan.effort && q.plan.nominal > z.plan.nominal ? '，同等工作量下更优：23 项候选的贪心规划不保证最优，两者都可行' : ''}。`);
      else if (q && !q.plan.feasible) li.push(`对照：仅原有机制时无可行集（最高 ${pct(q.plan.maxValue)} %）；可行性来自扩展项 ${z.plan.ids.filter(isExt).join('、')}（合计 Shapley ${sgn(z.plan.ids.filter(isExt).reduce((a, id) => a + shap(N, id), 0))} pt）。`);
    } else {
      const ok = (z.levers ?? []).filter((l) => l.id !== 'plan' && l.value >= R.target && l.valueDerated >= R.target).sort((a, b) => a.id.length - b.id.length);
      const okNom = (z.levers ?? []).filter((l) => l.id !== 'plan' && l.value >= R.target && l.valueDerated < R.target).sort((a, b) => a.id.length - b.id.length);
      li.push(`${R.players.length} 项全部启用也只到 ${pct(z.plan.maxValue)} %；价值最高的集 ${planLabel(N)}（工作量 ${z.plan.effort}）${pct(z.plan.nominal)} % / 降额 ${pct(z.plan.derated)} %，P(窗口 ≥ 目标) ${pct(z.verification.pAtLeastTarget, 1)} %${q ? `；仅原有机制时最高 ${pct(q.plan.maxValue)} %` : ''}。`);
      li.push(`补足途径：硬件中断率须降到 ${pct(z.residualFactor.plan, 0)} %（× ${num(1 / z.residualFactor.plan)}，各域允许 FIT 见第 5 节）${ok.length ? `，或在机制集之上加恢复杠杆 ${LEVER_NAMES[ok[0].id] ?? ok[0].id}（${pct(ok[0].value)} % / 降额 ${pct(ok[0].valueDerated)} %，硬件余量 × ${num(ok[0].residualFactor)}）` : ''}${okNom.length ? `；仅 ${LEVER_NAMES[okNom[0].id] ?? okNom[0].id} 名义 ${pct(okNom[0].value)} % 达标但降额 ${pct(okNom[0].valueDerated)} % 不达标` : ''}。`);
    }
    const weak = `${topGroups(z.planned)}${base < R.target ? `（基线时 ${topGroups(z.baseline)}）` : ''}`;
    const top = `原有 ${famTopFam(N, false, 2)}；扩展 ${famTopFam(N, true, 2)}`;
    return `<tr><td class="k" style="white-space:normal"><b>${esc(head)}</b></td><td>${li.map(esc).join(' ')}</td><td>${esc(weak)}</td><td>${esc(top)}</td><td>${esc(delivLine(N).replace(/^ReMAP 口径（正确交付 ≥ 98.5 %）：/, ''))}</td></tr>`;
  }).join('');
}
function crossNote() {
  const ids = R.players;
  const avg = (id) => SIZES.reduce((s, N) => s + shap(N, id), 0) / SIZES.length;
  const top = (ext) => ids.filter((id) => isExt(id) === ext).sort((a, b) => avg(b) - avg(a)).filter((id) => avg(id) > 0.0005).slice(0, 4).map((id) => `${id} ${sgn(avg(id))}`).join('，');
  const nr = P[200000].planned.byDomain;
  const EXT_RUNG = ['R-LINK-LOCAL', 'R-FABRIC-DEGRADE', 'H-CONTROL-CONTINUITY', 'R-WARM-PROCESS', 'R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH'];
  const covered = (id) => AUDIT.mechanisms.some((m) => EXT_RUNG.includes(m.id) && m.eventCandidates.includes(id));
  const noRung = R.domains.filter((d) => d.fit > 0 && !d.flags.replay && !d.flags.process && !d.flags.elastic);
  const stillNone = noRung.filter((d) => !covered(d.id));
  const stillShare = stillNone.reduce((a, d) => a + (nr[d.id]?.share ?? 0), 0);
  const z2 = P[200000], z5 = P[500000];
  const ok5 = (z5.levers ?? []).filter((l) => l.id !== 'plan' && l.value >= R.target && l.valueDerated >= R.target).sort((a, b) => a.id.length - b.id.length);
  const prev = PREV ? `仅原有机制时上限 ${kfmt(PREV.curves.plan200000.maxN)} 卡、20 万卡无可行集（最高 ${pct(PREV.perSize[200000].plan.maxValue)} %）；` : '';
  const others = HACD10 && CMP ? `同一方法下 HAC-D 自带 10 项候选的 20 万卡集 ${kfmt(HACD10.curves.plan200k.maxN)} 卡，原有 + 新增 23 项按 HAC-D 临时假设 ${kfmt(CMP.sets.combined.study.curves.plan200000.maxN)} 卡（全部启用 ${kfmt(CMP.sets.combined.study.curves.allOn.maxN)}），差别只在扩展项的适用比例与成功率假设；` : '';
  return `<div class="callout"><b>跨规模结论</b>：① 上限：最新机制集的 20 万卡推荐集可达 ${kfmt(R.curves.plan200000.maxN)} 卡（降额 ${kfmt(R.curves.plan200000Derated.maxN)}），全部 ${R.players.length} 项同时启用 ${kfmt(R.curves.allOn.maxN)} 卡（降额 ${kfmt(R.curves.allOnDerated.maxN)}）；${prev}${others}② 20 万卡${z2.plan.feasible ? `因扩展机制而可行（${pct(z2.plan.nominal)} % / 降额 ${pct(z2.plan.derated)} %，所含扩展项 ${z2.plan.ids.filter(isExt).join('、')}）` : `仍不可行（最高 ${pct(z2.plan.maxValue)} %）`}；50 万卡${z5.plan.feasible ? '可行' : `仍无可行集（全部启用 ${pct(z5.plan.maxValue)} %）：须硬件 × ${num(1 / z5.residualFactor.plan)}（中断率降到 ${pct(z5.residualFactor.plan, 0)} %），或在机制集之上加恢复杠杆${ok5.length ? ` ${LEVER_NAMES[ok5[0].id] ?? ok5[0].id}（${pct(ok5[0].value)} % / 降额 ${pct(ok5[0].valueDerated)} %）` : ''}`}；③ 最重要的机制：原有 ${top(false)}；扩展 ${top(true)}——扩展 15 项合计 ${sgn(extSum(200000))} pt@20 万卡、${sgn(extSum(500000))} pt@50 万卡，与一项 R-ELASTIC（${sgn(shap(200000, 'R-ELASTIC'))} / ${sgn(shap(500000, 'R-ELASTIC'))}）相当；④ 薄弱环节：原有梯级覆盖不到的网络、管理、未归因事件和人工份额被扩展机制接住，20 万卡集后仍无任何机制覆盖的 ${stillNone.map((d) => d.id.replace(/-hard$/, '')).join('、')} 占残余 ${(stillShare * 100).toFixed(0)} %，只能靠硬件 FIT 预算；⑤ 扩展机制的数字基于 ReMAP 的显式情景（适用 100 %、成功 95 %、失败尝试 0 s、开销 0）并经 HAC-D 降额，不是实测承诺。</div>`;
}

/* ---------- assemble ---------- */
const c1 = chartAop(), c2 = chartUnavail(), c3 = chartShapley();
writeFileSync(`${OUT_DIR}/fig1-aop-vs-n.svg`, c1.svg);
writeFileSync(`${OUT_DIR}/fig2-unavailability.svg`, c2.svg);
writeFileSync(`${OUT_DIR}/fig3-shapley.svg`, c3.svg);
const z3 = P[200000];
const extTop5 = P[200000].gains.filter((g) => isExt(g.id)).sort((a, b) => b.byMetric.aOp.shapley - a.byMetric.aOp.shapley).slice(0, 5).map((g) => g.id).join('、');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReMAP 最新机制集 98.5 % 分配</title>
<meta name="description" content="54 条事件参考目录上，用最新 ReMAP（commit ${IN.remap.commit.slice(0, 7)}，${IN.remap.date}）的机制集——原有机制加 16 项扩展——在 98.5 % 目标下的硬件故障率与机制参数分配（1 万 / 10 万 / 20 万 / 50 万卡）、薄弱环节、关键机制，以及按 ReMAP 自身口径的结果和与 ReMAP 引擎的交叉校核（HAC-D，${R.generated.slice(0, 10)}）。">
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
  @media screen and (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 700px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.3px; line-height: 1.34; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7px; line-height: 1.26; } th, td { padding: 1px 2.5px; } th { font-size: inherit; } table.dense { font-size: 6.4px; line-height: 1.18; } table.dense th, table.dense td { padding: 0.4px 2px; } table.dense th { white-space: normal; } td.num { white-space: normal; }
    #p1 .table-wrap:first-of-type table { font-size: 6.8px; line-height: 1.22; }
    .f { font-size: 7.6px; } code { font-size: 7px; } .small { font-size: 6.9px; } .box p, .box li, .callout, .sub, footer { font-size: 7.5px; } .box h3 { font-size: 8.2px; margin-bottom: 2px; } .box ul { padding-left: 12px; } .box li { font-size: 7.1px; } .callout { font-size: 7.3px; } footer { font-size: 6.9px; }
    h1 { font-size: 14px; margin: 2px 0 3px; } h2 { font-size: 10.5px; margin: 4px 0 2px; padding-top: 3px; } .eyebrow { font-size: 7.5px; }
    figure.chart { margin: 2px 0 2px; } figcaption { font-size: 7.2px; margin-top: 0; } details.tv { display: none; } .tip { display: none !important; }
    .grid2 { gap: 4px 10px; } .box { padding: 3px 7px; } .callout { margin: 4px 0; padding: 3px 7px; } p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    figure.chart.c1 svg { height: 194px; } figure.chart.c2 svg { height: 178px; } figure.chart.c3 svg { height: 176px; }
    table th.nw { white-space: nowrap; } table.concl { font-size: 6.8px; line-height: 1.22; } table.concl th, table.concl td { padding: 1px 2.5px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D · 分配研究（ReMAP 最新机制集，commit ${IN.remap.commit.slice(0, 7)} · ${IN.remap.date}） · ${R.generated.slice(0, 10)} · 第 1 / 2 页</div>
  <h1>98.5 % 目标下的可靠性分配：ReMAP 最新机制集（原有 + 16 项扩展，1 万–50 万卡）</h1>
  <p class="sub"><b>口径</b>：主结果为 A_op = 30 天窗口内的运行时间占比，目标 ≥ 98.5 %（预算 1.5 pt），与前几份报告一致；ReMAP 自身的"可用度"是窗口内最终保留的正确进度占比（HAC-D 的正确交付 goodput），第 4 节另给该口径的结果并与 ReMAP 引擎交叉校核。对象为 54 条事件的参考审核目录（与最新仓库 references/expert-review-2026-10-09 一致：中断 / 亚健康 / 静默 FIT 3333.3 / 69.0 / 48.3 每卡·小时），基线恢复 12.5 s 发现 + 180 s 自动尝试 @ 99 % + 2 h 人工（R̄ 264.5 s），τ 300 s、δ 4 s。<b>候选机制 = 最新 ReMAP（github.com/lzq0927/remap，commit ${IN.remap.commit.slice(0, 7)}，${IN.remap.date}）的全部机制</b>：原有 12 项中有参数变换的 8 项（${IN.original.join('、')}；R-CKPT / R-MANUAL 为基线本身，H-PROTECT / H-RELIABILITY 无增量参数）+ 扩展 16 项中的 15 项（I-CONTAIN 为支撑能力）。扩展参数取 ReMAP 的显式情景 <code>extensionScenario()</code>：适用 100 %（FP8 / FP4 各占 CORE 静默风险的 50 %）、成功 95 %、失败尝试 0 s、开销 0（ABFT 0.1 %），机制目标值同审核（第 3 节表）；ReMAP 引擎逐事件抽样适用与成功，HAC-D 按期望值折入参数（启动阶段按 95 % 适用、异步阻塞 4 × 5 % + 1 × 95 % = 1.15 s、人工概率 95 % × 0.1 % + 5 % × 1 %）。规划器按覆盖率 / 适用比例 −5 pt、成功率 −8 pt、时间 ×1.5 降额后仍须达标；${R.players.length} 项候选超过精确枚举上限（10 项），改为贪心逐步加入（每步加入单位工作量名义增益最大者），Shapley 置换抽样 ${attr.permutations} 次（95 % 半宽 ≤ ± ${num(maxHalf * 100, 2)} pt），校核 ${vt} 个窗口（Wilson 区间）。已知语义差别：FP8 / FP4 / 网络静默检测 ReMAP 取最大值、HAC-D 在残余漏检上复合；开销连乘 vs 求和（0.1 % 量级）。</p>
  <h2 class="first">1. 四个规模的分配结果一览（A_op 口径；杠杆行粗体 = 名义与降额都达标）</h2>
  ${summaryTable()}
  ${crossNote()}
  <h2>2. 与 ReMAP 最新引擎的交叉校核（同一目录、同一基线参数、ReMAP 显式扩展情景）</h2>
  ${engineCheckTable()}
  <figure class="chart c1">${c1.svg}<div class="tip" id="tip-aop"></div><figcaption>图 1：基线在 ${kfmt(R.curves.baseline.maxN)} 卡以下达标；10 万卡推荐集（${R.curves.plan100000.ids.join(' + ')}）到 ${kfmt(R.curves.plan100000.maxN)} 卡（降额 ${kfmt(R.curves.plan100000Derated.maxN)}），20 万卡推荐集（${R.curves.plan200000.ids.length} 项）到 ${kfmt(R.curves.plan200000.maxN)} 卡（降额 ${kfmt(R.curves.plan200000Derated.maxN)}），50 万卡价值最高的 ${R.curves.plan500000.ids.length} 项集 ${kfmt(R.curves.plan500000.maxN)} 卡，全部 ${R.players.length} 项同时启用 ${kfmt(R.curves.allOn.maxN)} 卡（降额 ${kfmt(R.curves.allOnDerated.maxN)}）${PREV ? `；对照（虚线）：仅原有机制的 20 万卡集 ${kfmt(PREV.curves.plan200000.maxN)} 卡` : ''}。</figcaption></figure>
  <details class="tv"><summary>图 1 数据表</summary>${c1.table}</details>
  <figure class="chart c2">${c2.svg}<figcaption>图 2：基线的不可用度按域分组（各域停顿相同，占比即中断率占比）；原有梯级压低带 r / p / e 标记的域，扩展机制（${extTop5}）再压低网络、管理、未归因事件与人工份额——20 万卡残余${PREV ? `从仅原有机制集的 ${pt(1 - PREV.perSize[200000].planned.aOp)} pt 降到` : ''}最新集的 ${pt(1 - z3.planned.aOp)} pt，其中机房设施 + 存储 / 软件 / 未归因占 ${((groupVals(z3.planned)[3] + groupVals(z3.planned)[4]) / (1 - z3.planned.aOp) * 100).toFixed(0)} %。</figcaption></figure>
  <details class="tv"><summary>图 2 数据表</summary>${c2.table}</details>
</section>
<section class="page" id="p2">
  <div class="eyebrow">HAC-D · 分配研究（ReMAP 最新机制集） · ${R.generated.slice(0, 10)} · 第 2 / 2 页</div>
  <h2 class="first">3. 关键机制：Shapley 归因与参数分配</h2>
  <figure class="chart c3">${c3.svg}<figcaption>图 3：原有集内 ${famTopFam(200000, false).replace(/ [+−][\d.]+/g, '')} 仍是最大三项（互为替代，20 万卡起同时启用）；扩展集内以 ${extTop5} 为主，15 项合计 ${sgn(extSum(200000))} pt@20 万卡、${sgn(extSum(500000))} pt@50 万卡；静默错误检测类对 A_op 为零或微负（它们改善的是正确交付，见第 4 节）。</figcaption></figure>
  <details class="tv"><summary>图 3 数据表</summary>${c3.table}</details>
  ${mechanismTable(c3.ids)}
  <h2>4. 同一机制集按 ReMAP 自身口径（正确交付 goodput ≥ 98.5 %）的分配</h2>
  ${deliveredTable()}
  <h2>5. 硬件故障率分配（每单元·小时 FIT，业务影响口径；允许值 = 当前 × 方案后硬件因子，ARINC 等比）</h2>
  ${domainTable()}
  <p class="small"><sup>†</sup>梯级（目录逐事件标记）：r 重执行、p 进程重调度、e DP 域弹性；扩展适用（审核候选事件）：L 链路透明恢复、F 网络绕行降级、M 控制面连续、W 预热进程、S 运行时快照、G CANN 图缓存（C-LOSSLESS、D-RECOVERY-CLASSIFY 作用于所有中断，不逐域列出）。"20 万集后"取 20 万卡推荐集，无机制覆盖的域仍是完整的全局恢复 ${num(z3.planned.globalS, 0)} s。最小努力 ● = 仅靠硬件达标时该域须降到共同水平（10 / 20 / 50 万卡：${[100000, 200000, 500000].map((N) => num(P[N].hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001).allowedFit, 0)).join(' / ')} FIT）。允许 FIT 因子：${SIZES.map((N) => `${zhNs(N)} × ${num(P[N].residualFactor.plan)}`).join('，')}。</p>
  <h2>6. 结论：各规模的薄弱环节与最重要的机制</h2>
  <div class="table-wrap"><table class="concl"><tr><th style="width:11%">规模 · 判定</th><th style="width:43%">结论（A_op 口径）</th><th style="width:15%">薄弱环节：方案后残余（基线时）</th><th style="width:15%">最重要的机制（Shapley，pt）</th><th>ReMAP 口径（正确交付 ≥ 98.5 %）</th></tr>${conclusions()}</table></div>
  <footer>复现：<code>git clone https://github.com/lzq0927/remap remap/remap-latest</code>；<code>node --import tsx scripts/remap-latest-allocation-98p5.ts --trials ${vt} --permutations ${attr.permutations}</code>；<code>node --import tsx scripts/remap-latest-check.ts --trials ${EC ? EC.trials : 400}</code> → <code>node scripts/build-remap-latest-allocation-98p5.mjs</code>（同一计算可在"审核与报告"页、<code>hacd study</code> 或 MCP <code>allocation_study</code> 中重跑）。方法：docs/MODEL_REFERENCE.md §22–§24。事件率为参考目录先验、扩展参数为 ReMAP 的显式情景，须以本集群实测替换。</footer>
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
