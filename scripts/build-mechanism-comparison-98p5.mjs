#!/usr/bin/env node
/**
 * Build docs/MECHANISM_COMPARISON_98P5.zh.html (two printed pages, three inline SVG charts with tooltips and table views) from
 * docs/mechanism-comparison-98p5/results.json (scripts/mechanism-comparison-98p5.ts): ReMAP's original mechanisms vs the 16 new
 * ones vs both, at a 98.5 % A_op target on the 54-event catalog at 10k / 100k / 200k / 500k cards.
 * Usage: node scripts/build-mechanism-comparison-98p5.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const R = JSON.parse(readFileSync('docs/mechanism-comparison-98p5/results.json', 'utf8'));
const AUDIT = JSON.parse(readFileSync('packages/core/data/mechanism-audit.json', 'utf8'));
const OUT_HTML = 'docs/MECHANISM_COMPARISON_98P5.zh.html';
const OUT_DIR = 'docs/mechanism-comparison-98p5';
mkdirSync(OUT_DIR, { recursive: true });

const pct = (x, d = 2) => (x * 100).toFixed(d);
const pt = (x, d = 2) => (x * 100).toFixed(d);
const sgn = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d);
const num = (x, d = 2) => Number(x).toFixed(d);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kfmt = (N) => (N >= 1e6 ? `${(N / 1e6).toFixed(N % 1e6 ? 1 : 0)}M` : N >= 1e5 ? `${Math.round(N / 1e3)}k` : `${(N / 1e3).toFixed(1).replace(/\.0$/, '')}k`);
const zhN = (N) => ({ 10000: '1 万卡', 100000: '10 万卡', 200000: '20 万卡', 500000: '50 万卡' })[N] ?? `${N}`;
const zhNs = (N) => ({ 10000: '1 万', 100000: '10 万', 200000: '20 万', 500000: '50 万' })[N] ?? `${N}`;
const SIZES = R.sizes;
const SETS = ['remap', 'new', 'combined'];
const SET_LABEL = { remap: 'ReMAP 原有', new: '新增 16 项', combined: '原有 + 新增' };
const S = Object.fromEntries(SETS.map((k) => [k, R.sets[k].study]));
const lib = { ...S.combined.library };
for (const k of SETS) Object.assign(lib, S[k].library);
const mechName = (id) => lib[id]?.name?.zh ?? id;
const isNew = (id) => R.sets.new.all.includes(id);
const famTag = (id) => (isNew(id) ? '新' : 'R');
const GROUPS = [['npu', 'NPU 芯片与内存'], ['network', '网络'], ['host', '主机'], ['facility', '机房设施'], ['storageSoftware', '存储 / 软件 / 未归因'], ['other', '亚健康隔离与静默暂停']];
const groupVals = (d) => { const o = { ...d.byGroup }; o.other = (o.isolation ?? 0) + (o.sdcPause ?? 0); return GROUPS.map(([k]) => o[k] ?? 0); };
const planLabel = (z) => (z.plan.ids.length ? z.plan.ids.join(' + ') : '无需机制');
const textW = (s) => Array.from(s).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.6), 0);

/* ---------- SVG chrome (validated data-viz palette, light + dark) ---------- */
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const STYLE = `
svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; --h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; } }
:root[data-theme="light"] svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; --h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; }
:root[data-theme="dark"] svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; }
svg.viz text { fill: var(--ink); font-size: 12px; } svg.viz .t2 { fill: var(--ink2); font-size: 11.5px; } svg.viz .m { fill: var(--muted); font-size: 11px; } svg.viz .tick { font-variant-numeric: tabular-nums; } svg.viz .ttl { font-size: 13px; font-weight: 600; }
svg.viz .grid { stroke: var(--grid); stroke-width: 1; } svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .ref { stroke: var(--ink2); stroke-width: 1; } svg.viz .hit { fill: transparent; pointer-events: all; } svg.viz .xh { pointer-events: none; } svg.viz .cellt { font-size: 11.5px; font-variant-numeric: tabular-nums; } svg.viz .onDark { fill: var(--surface); }
`;
const svgOpen = (id, W, H) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
function legend(x, y, items, kind = 'line') { let off = 0; return items.map((it) => { const lx = x + off; off += 30 + textW(it.name) + 14; return kind === 'line' ? `<line x1="${lx}" x2="${lx + 18}" y1="${y}" y2="${y}" stroke="var(--s${it.slot + 1})" stroke-width="2.5" stroke-linecap="round"/><text x="${lx + 24}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--s${it.slot + 1})"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join(''); }

/* ---------- Chart 1: A_op vs N, baseline + the 20万卡 plan of each set ---------- */
function chartAop() {
  const W = 960, H = 372, L = 54, Rm = 150, Tp = 54, B = 40, pw = W - L - Rm, ph = H - Tp - B;
  const grid = S.remap.curveGrid;
  const lx0 = Math.log10(grid[0]), lx1 = Math.log10(grid[grid.length - 1]);
  const xs = (N) => L + ((Math.log10(N) - lx0) / (lx1 - lx0)) * pw;
  const ys = (a) => Tp + ((1 - Math.max(0.8, a)) / 0.2) * ph;
  const series = [
    { key: 'baseline', set: 'remap', name: '基线（无机制）', short: '基线', slot: 0 },
    { key: 'plan200000', set: 'remap', name: `ReMAP 原有 · 20 万卡集（${S.remap.perSize[200000].plan.ids.length} 项）`, short: 'ReMAP 原有', slot: 1 },
    { key: 'plan200000', set: 'new', name: `新增 · 20 万卡集（${S.new.perSize[200000].plan.ids.length} 项）`, short: '新增', slot: 2 },
    { key: 'plan200000', set: 'combined', name: `原有 + 新增 · 20 万卡集（${S.combined.perSize[200000].plan.ids.length} 项）`, short: '原有 + 新增', slot: 3 },
  ];
  const cv = (s) => S[s.set].curves[s.key];
  const cvd = (s) => S[s.set].curves[`${s.key}Derated`];
  let g = svgOpen('chart-aop', W, H);
  g += `<text x="${L}" y="20" class="ttl">图 1 · 运行可用率 A_op 随集群规模的变化：三种机制集各自在 20 万卡的推荐集（名义实线，色带到降额下限）</text>`;
  g += legend(L, 38, series.map((s) => ({ name: s.name, slot: s.slot })));
  for (let v = 80; v <= 100; v += 5) { const y = ys(v / 100); g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="m tick">${v} %</text>`; }
  for (const N of [5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]) { const x = xs(N); g += `<line x1="${x}" x2="${x}" y1="${Tp + ph}" y2="${Tp + ph + 5}" class="axis"/><text x="${x}" y="${Tp + ph + 18}" text-anchor="middle" class="m tick">${kfmt(N)}</text>`; }
  g += `<line x1="${L}" x2="${L + pw}" y1="${Tp + ph}" y2="${Tp + ph}" class="axis"/><text x="${L + 150}" y="${H - 6}" text-anchor="middle" class="m">集群规模 N（卡，对数轴）</text>`;
  const yT = ys(R.target);
  g += `<line x1="${L}" x2="${L + pw}" y1="${yT}" y2="${yT}" class="ref"/><text x="${L + 6}" y="${yT - 5}" class="t2">目标 A_op ≥ ${pct(R.target, 1)} %</text>`;
  for (const s of series) { const nom = cv(s).points, der = cvd(s).points; const poly = nom.map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`).concat(der.slice().reverse().map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`)).join(' '); g += `<polygon points="${poly}" fill="var(--s${s.slot + 1})" opacity="0.14"/>`; }
  const labels = [];
  for (const s of series) {
    const nom = cv(s).points;
    g += `<path d="${nom.map((p, i) => `${i ? 'L' : 'M'}${xs(p.N).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--s${s.slot + 1})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const N of SIZES) { const p = nom.find((q) => q.N === N); if (p) g += `<circle cx="${xs(N).toFixed(1)}" cy="${ys(p.value).toFixed(1)}" r="4" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`; }
    const last = nom[nom.length - 1];
    labels.push({ y: ys(last.value), text: `${s.short} ${pct(last.value, 1)} %` });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  for (const lb of labels) g += `<text x="${L + pw + 8}" y="${lb.y + 4}" class="t2">${esc(lb.text)}</text>`;
  const marks = series.map((s) => ({ s, N: cv(s).maxN })).filter((m) => m.N > grid[0] && m.N < grid[grid.length - 1]).sort((a, b) => a.N - b.N);
  let prevX = -1e9, prevUp = false;
  for (const m of marks) { const x = xs(m.N); const up = x - prevX < 44 && !prevUp; prevX = x; prevUp = up; g += `<circle cx="${x.toFixed(1)}" cy="${yT}" r="4.5" fill="var(--s${m.s.slot + 1})" stroke="var(--surface)" stroke-width="2"/><text x="${x.toFixed(1)}" y="${up ? yT - 11 : yT + 17}" text-anchor="middle" class="t2 tick">${kfmt(m.N)}</text>`; }
  g += `<text x="${L + pw}" y="${H - 6}" text-anchor="end" class="m">● 目标线上的圆点：名义参数下仍满足 98.5 % 的最大规模</text>`;
  g += `<g class="xh" id="aop-xh" style="display:none"><line id="aop-xl" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" class="ref"/>${series.map((s) => `<circle id="aop-c${s.slot}" r="5" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g><rect class="hit" id="aop-hit" x="${L}" y="${Tp}" width="${pw}" height="${ph}"/></svg>`;
  const data = { grid, x: grid.map((N) => +xs(N).toFixed(1)), series: series.map((s) => ({ name: s.name, nominal: cv(s).points.map((p) => p.value), derated: cvd(s).points.map((p) => p.value), y: cv(s).points.map((p) => +ys(p.value).toFixed(1)) })) };
  const table = `<table class="tv"><tr><th>N</th>${series.map((s) => `<th class="num">${esc(s.name)}<br><span class="small">名义 / 降额</span></th>`).join('')}</tr>${grid.map((N, i) => `<tr><td class="num">${N.toLocaleString('en-US')}</td>${series.map((s) => `<td class="num">${pct(cv(s).points[i].value)} / ${pct(cvd(s).points[i].value)}</td>`).join('')}</tr>`).join('')}<tr><td>满足 98.5 % 的最大 N</td>${series.map((s) => `<td class="num">${cv(s).maxN.toLocaleString('en-US')} / ${cvd(s).maxN.toLocaleString('en-US')}</td>`).join('')}</tr></table>`;
  return { svg: g, data, table, series };
}

/* ---------- Chart 2: residual composition per size × set ---------- */
function chartResidual() {
  const rows = [];
  for (const N of SIZES) {
    rows.push({ label: `${zhNs(N)} · 基线`, N, set: null, vals: groupVals(S.remap.perSize[N].baseline) });
    for (const k of SETS) rows.push({ label: `${zhNs(N)} · ${SET_LABEL[k]}`, N, set: k, vals: groupVals(S[k].perSize[N].planned) });
  }
  const W = 960, L = 150, Rm = 70, Tp = 66, rowP = 19, groupGap = 8, barH = 12, B = 36;
  const H = Tp + rows.length * rowP + (SIZES.length - 1) * groupGap + B;
  const pw = W - L - Rm, xmax = 12;
  const xs = (v) => L + (v / xmax) * pw;
  let g = svgOpen('chart-residual', W, H);
  g += `<text x="${L}" y="20" class="ttl">图 2 · 不可用度的构成（百分点 = 100 − A_op）：基线与三种机制集各自的推荐集，预算线 1.5 pt</text>`;
  g += legend(L, 38, GROUPS.map(([, name], i) => ({ name, slot: i })), 'rect');
  const plotTop = Tp, plotBot = H - B;
  for (let v = 0; v <= xmax; v += 2) { const x = xs(v); g += `<line x1="${x}" x2="${x}" y1="${plotTop - 4}" y2="${plotBot}" class="grid"/><text x="${x}" y="${plotBot + 16}" text-anchor="middle" class="m tick">${v}</text>`; }
  g += `<text x="${L + pw}" y="${plotBot + 30}" text-anchor="end" class="m">不可用度（百分点）</text>`;
  const xb = xs((1 - R.target) * 100);
  g += `<line x1="${xb}" x2="${xb}" y1="${plotTop - 4}" y2="${plotBot}" class="ref"/><text x="${xb + 4}" y="${plotTop - 8}" class="t2">预算 1.5 pt</text>`;
  let y = plotTop + 3;
  rows.forEach((r, ri) => {
    if (ri > 0 && ri % 4 === 0) y += groupGap;
    const total = r.vals.reduce((a, b) => a + b, 0);
    g += `<text x="${L - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="t2" style="font-size:10.5px">${esc(r.label)}</text>`;
    let x = L;
    r.vals.forEach((v, gi) => {
      const w = (v * 100 / xmax) * pw;
      if (w > 0.2) { const wi = Math.max(0, w - (gi < r.vals.length - 1 ? 2 : 0)); g += `<rect x="${x.toFixed(1)}" y="${y}" width="${wi.toFixed(1)}" height="${barH}" rx="${gi === r.vals.length - 1 ? 3 : 0}" fill="var(--s${gi + 1})" data-tip="${esc(r.label)}（${esc(r.set ? planLabel(S[r.set].perSize[r.N]) : '无机制')}）\n${esc(GROUPS[gi][1])}：${pt(v)} pt，占 ${total > 0 ? (v / total * 100).toFixed(1) : 0} %"/>`; }
      x += w;
    });
    g += `<text x="${(x + 6).toFixed(1)}" y="${y + barH / 2 + 4}" class="t2 tick" style="font-size:10.5px">${pt(total)}</text>`;
    y += rowP;
  });
  g += '</svg>';
  const table = `<table class="tv"><tr><th>行</th><th>推荐集</th>${GROUPS.map(([, n]) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">合计 pt</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.set ? planLabel(S[r.set].perSize[r.N]) : '—')}</td>${r.vals.map((v) => `<td class="num">${pt(v, 3)}</td>`).join('')}<td class="num">${pt(r.vals.reduce((a, b) => a + b, 0), 3)}</td></tr>`).join('')}</table>`;
  return { svg: g, table };
}

/* ---------- Chart 3: Shapley heatmap of the combined study ---------- */
function chartShapley() {
  const st = S.combined;
  const ids = st.players.filter((id) => st.perSize[SIZES[0]].gains.some((g) => g.id === id)).sort((a, b) => avg(b) - avg(a));
  function avg(id) { return SIZES.reduce((s, N) => s + st.perSize[N].gains.find((x) => x.id === id).byMetric.aOp.shapley, 0) / SIZES.length; }
  const vmax = Math.max(...SIZES.flatMap((N) => st.perSize[N].gains.map((x) => Math.abs(x.byMetric.aOp.shapley))));
  const W = 960, L = 300, colW = 118, rowH = 22, Tp = 58, effW = 60, legH = 48;
  const H = Tp + ids.length * rowH + legH;
  let g = svgOpen('chart-shapley', W, H);
  g += `<text x="16" y="20" class="ttl">图 3 · 原有 + 新增 共 ${ids.length} 项同时参与时各机制对 A_op 的 Shapley 贡献（百分点；置换抽样 ${st.perSize[SIZES[0]].attribution.permutations} 次，± 见数据表）；带框 = 该规模推荐集所含</text>`;
  g += `<text x="16" y="${Tp - 8}" class="m">机制（R = ReMAP 原有，新 = 新增；按平均贡献排序）</text>`;
  SIZES.forEach((N, j) => { g += `<text x="${L + j * colW + colW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">${zhN(N)}</text>`; });
  g += `<text x="${L + SIZES.length * colW + effW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">工作量</text>`;
  const cls = (v) => { if (Math.abs(v) < 0.0005) return 'mid'; const k = Math.min(4, Math.floor((Math.abs(v) / vmax) * 4) + 1); return (v > 0 ? 'h' : 'n') + k; };
  ids.forEach((id, i) => {
    const y = Tp + i * rowH;
    g += `<text x="16" y="${y + rowH / 2 + 4}" class="t2" style="font-size:11px"><tspan class="m">${famTag(id)}</tspan> ${esc(id)} <tspan class="m">${esc(mechName(id)).slice(0, 14)}</tspan></text>`;
    SIZES.forEach((N, j) => {
      const gn = st.perSize[N].gains.find((x) => x.id === id);
      const v = gn.byMetric.aOp.shapley;
      const c = cls(v);
      const x = L + j * colW;
      const inPlan = st.perSize[N].plan.ids.includes(id);
      const tip = `${esc(id)} ${esc(mechName(id))} · ${zhN(N)}\nShapley（A_op）${sgn(v, 3)} pt ± ${num((gn.halfWidth ?? 0) * 100, 3)}；单独启用 ${sgn(gn.byMetric.aOp.single, 3)}；末位加入 ${sgn(gn.byMetric.aOp.lastAdded, 3)}\nShapley（正确交付）${sgn(gn.byMetric.delivered.shapley, 2)} pt${inPlan ? '\n在该规模的推荐集中' : ''}`;
      g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" fill="var(--${c})" data-tip="${tip}"/>`;
      if (inPlan) g += `<rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" stroke="var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" stroke="var(--ink)" stroke-width="1.5" pointer-events="none"/>`;
      const dark = c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';
      g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${dark ? ' onDark' : ''}" pointer-events="none">${sgn(v)}</text>`;
    });
    g += `<text x="${L + SIZES.length * colW + effW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2 tick">${lib[id]?.effort ?? ''}</text>`;
  });
  const ly = Tp + ids.length * rowH + 20;
  ['n4', 'n3', 'n2', 'n1', 'mid', 'h1', 'h2', 'h3', 'h4'].forEach((c, i) => { g += `<rect x="${L + i * 26}" y="${ly}" width="24" height="12" fill="var(--${c})"/>`; });
  g += `<text x="${L - 6}" y="${ly + 10}" text-anchor="end" class="m tick">−${(vmax * 100).toFixed(1)} pt</text><text x="${L + 9 * 26 + 6}" y="${ly + 10}" class="m tick">+${(vmax * 100).toFixed(1)} pt</text><text x="${L + 4 * 26 + 12}" y="${ly + 24}" text-anchor="middle" class="m">0</text>`;
  g += `<text x="${L + 9 * 26 + 80}" y="${ly + 10}" class="m">负值 = 在该链序与参数下反而拉低 A_op；新增机制按临时假设（适用 100 %、成功 90 %、失败 10 s）计</text></svg>`;
  const table = `<table class="tv"><tr><th>机制</th>${SIZES.map((N) => `<th class="num">${zhN(N)}<br><span class="small">Shapley ± 半宽 / 单独 / 末位（pt）</span></th>`).join('')}</tr>${ids.map((id) => `<tr><td>${famTag(id)} ${esc(id)} ${esc(mechName(id))}</td>${SIZES.map((N) => { const gn = st.perSize[N].gains.find((x) => x.id === id); return `<td class="num">${sgn(gn.byMetric.aOp.shapley)} ± ${num((gn.halfWidth ?? 0) * 100, 2)} / ${sgn(gn.byMetric.aOp.single)} / ${sgn(gn.byMetric.aOp.lastAdded)}</td>`; }).join('')}</tr>`).join('')}</table>`;
  return { svg: g, table, ids };
}

/* ---------- tables ---------- */
const topGroups = (d) => { const vals = groupVals(d); const tot = vals.reduce((a, b) => a + b, 0); return GROUPS.map(([, n], i) => [n, vals[i]]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, v]) => `${n} ${(v / tot * 100).toFixed(0)} %`).join('，'); };
function comparisonTable() {
  const rows = [];
  for (const N of SIZES) {
    const base = S.remap.perSize[N].baseline;
    if (base.aOp >= R.target) {
      rows.push(`<tr><td class="k">${zhN(N)}<br><span class="small">基线 ${pct(base.aOp)} %</span></td><td colspan="5">基线已达标（余量 ${pt(base.aOp - R.target)} pt）：三种机制集都无需启用；硬件余量 × ${num(S.remap.perSize[N].residualFactor.plan, 2)}，恢复余量 × ${num(S.remap.perSize[N].recoveryOnly.factor, 2)}；200 个窗口全部 ≥ 98.5 %（5 % 分位 ${pct(S.remap.perSize[N].verification.aOp.p05)} %）。全部启用时：ReMAP ${pct(S.remap.perSize[N].allOn.aOp)} %、新增 ${pct(S.new.perSize[N].allOn.aOp)} %、合并 ${pct(S.combined.perSize[N].allOn.aOp)} %。</td></tr>`);
      continue;
    }
    rows.push(`<tr><td class="k" rowspan="3">${zhN(N)}<br><span class="small">基线 ${pct(base.aOp)} %<br>缺 ${pt(R.target - base.aOp)} pt</span></td>${SETS.map((k) => { const z = S[k].perSize[N]; return `<td class="k">${SET_LABEL[k]}</td><td>${z.plan.feasible ? '' : '<b>无可行集</b>，价值最高：'}${esc(planLabel(z))} · <b>${z.plan.effort}</b>${z.plan.method === 'greedy' ? ' <span class="small">贪心</span>' : ''}</td><td class="num">${pct(z.plan.nominal)} / ${pct(z.plan.derated)}</td><td class="num">× ${num(z.residualFactor.plan)} / × ${num(z.residualFactor.planDerated)}</td><td class="num">${z.verification ? `${pct(z.verification.pAtLeastTarget, 1)} [${pct(z.verification.wilson[0], 1)}–${pct(z.verification.wilson[1], 1)}] · <b>${z.verification.verdict}</b>` : '—'}</td>`; }).join('</tr><tr>')}</tr>`);
  }
  return `<div class="table-wrap"><table><tr><th>规模</th><th>机制集</th><th>推荐集（最低工作量可行集；无可行集时为价值最高的集）· 工作量</th><th class="num">A_op 名义 / 降额</th><th class="num">方案后硬件因子<br>名义 / 降额</th><th class="num">校核 P(窗口 ≥ 98.5 %) [Wilson] · 判定</th></tr>${rows.join('')}</table></div>`;
}
function maxNTable() {
  const cols = ['baseline', 'plan100000', 'plan200000', 'plan500000', 'allOn'];
  const name = { baseline: '基线', plan100000: '10 万卡推荐集', plan200000: '20 万卡推荐集', plan500000: '50 万卡集', allOn: '全部启用' };
  return `<div class="table-wrap"><table><tr><th>满足 98.5 % 的最大规模（名义 / 降额）</th>${cols.map((c) => `<th class="num">${name[c]}</th>`).join('')}</tr>${SETS.map((k) => `<tr><td class="k">${SET_LABEL[k]}</td>${cols.map((c) => { const cv = S[k].curves[c]; const cvd = S[k].curves[`${c}Derated`]; return `<td class="num">${cv ? `${kfmt(cv.maxN)} / ${kfmt(cvd.maxN)}` : '—'}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
}
const PK = { coverage: ['覆盖率', '', 1], detectSeconds: ['检测', ' s', 1], success: ['成功率', '', 1], successSeconds: ['成功耗时', ' s', 1], failureSeconds: ['失败耗时', ' s', 1], domains: ['域数', '', 1], recoverSeconds: ['域恢复', ' s', 1], syncSeconds: ['协调', ' s', 1], computeSeconds: ['τ', ' s', 1], saveSeconds: ['δ', ' s', 1], stepSeconds: ['step', ' s', 1], pauseSeconds: ['停顿', ' s', 1], switchSeconds: ['切换', ' s', 1], exposedCommunicationFraction: ['通信暴露 f', '', 1], remainingBandwidthRatio: ['剩余带宽 r', '', 1], repairSeconds: ['修复', ' s', 1], startupTargetSeconds: ['启动目标', ' s', 1], blockingTargetSeconds: ['阻塞目标', ' s', 1], durableLagSeconds: ['持久化滞后', ' s', 1], compressionRatio: ['压缩比', '', 1], decompressSeconds: ['解压', ' s', 1], manualProbabilityTarget: ['人工概率目标', '', 1], detectionTarget: ['检出目标', '', 1], upstreamDetection: ['上游检出', '', 1], conditionalMissDetection: ['漏检补捕', '', 1], overhead: ['开销', ' %', 100], occurrenceReduction: ['发生率降低', '', 1], communicationBeforeSeconds: ['通信重建前', ' s', 1], communicationTargetSeconds: ['通信重建目标', ' s', 1], graphTargetSeconds: ['图准备目标', ' s', 1], eligibleShare: ['适用比例', '', 1], riskShare: ['风险占比', '', 1], reduction: ['削减', '', 1] };
const fmtParams = (nom, der) => Object.keys(nom).map((k) => { const [lab, unit, mul] = PK[k] ?? [k, '', 1]; const a = +(nom[k] * mul).toFixed(3), b = +((der[k] ?? nom[k]) * mul).toFixed(3); return `${lab} ${a}${a !== b ? `→${b}` : ''}${unit}`; }).join('，');
function mechanismTable(ids) {
  const st = S.combined;
  const members = ids.filter((id) => SIZES.some((N) => st.perSize[N].plan.ids.includes(id)));
  const short = (nom, der) => { const keys = Object.keys(nom).slice(0, 5); return fmtParams(Object.fromEntries(keys.map((k) => [k, nom[k]])), der) + (Object.keys(nom).length > 5 ? '，…' : ''); };
  return `<div class="table-wrap"><table class="dense"><tr><th>机制（进入合并集的推荐集）</th><th>参数：名义→降额（临时假设标 <span class="tag">assumed</span>）· 候选事件</th><th class="num">工作量</th><th>推荐集 1/10/20/50 万</th></tr>${members.map((id) => { const lb = lib[id]; const aud = AUDIT.mechanisms.find((m) => m.id === id); const events = aud ? aud.eventCandidates.map((e) => e.replace(/-(hard|sdc)$/, '')).join('、') : ''; return `<tr><td class="k">${famTag(id)} <b>${esc(id)}</b> <span class="small">${esc(mechName(id))}</span></td><td><span class="small">${esc(short(lb.parameters, lb.derated))}${lb.provisional ? ' <span class="tag">assumed</span>' : ''}${events ? ` · ${esc(events)}` : ''}</span></td><td class="num">${lb.effort}</td><td>${SIZES.map((N) => (st.perSize[N].plan.ids.includes(id) ? '●' : '○')).join('')}</td></tr>`; }).join('')}</table></div>`;
}
function domainTable() {
  const doms = S.combined.domains.filter((d) => d.fit > 0).sort((a, b) => b.fit - a.fit);
  const code = { 'R-LINK-LOCAL': 'L', 'R-FABRIC-DEGRADE': 'F', 'H-CONTROL-CONTINUITY': 'M', 'R-WARM-PROCESS': 'W', 'R-RUNTIME-SNAPSHOT': 'S', 'R-CANN-GRAPH': 'G' };
  const newFlags = (id) => AUDIT.mechanisms.filter((m) => code[m.id] && m.eventCandidates.includes(id)).map((m) => code[m.id]).join(' ');
  const total = doms.reduce((a, d) => a + d.fit, 0);
  const dom = (set, N, id) => S[set].perSize[N].planned.byDomain[id];
  return `<div class="table-wrap"><table class="dense"><tr><th>域</th><th class="num">当前 FIT</th><th class="num">占 λ</th><th>ReMAP 梯级</th><th>新增适用<sup>†</sup></th><th class="num">ReMAP 集后<br>停顿 s · 残余</th><th class="num">合并集后<br>停顿 s · 残余</th>${SIZES.map((N) => `<th class="num">允许 FIT<br>${zhNs(N)}</th>`).join('')}</tr>${doms.map((d) => { const dr = dom('remap', 200000, d.id), dc = dom('combined', 200000, d.id); const flags = [d.flags.replay ? 'r' : '', d.flags.process ? 'p' : '', d.flags.elastic ? 'e' : ''].filter(Boolean).join(' ') || '<b>无</b>'; return `<tr><td class="k">${esc(d.id.replace(/-hard$/, ''))} <span class="small">${esc(d.name.split(' · ')[0])}</span></td><td class="num">${num(d.fit, 1)}</td><td class="num">${(d.fit / total * 100).toFixed(1)} %</td><td style="white-space:nowrap">${flags}</td><td style="white-space:nowrap">${newFlags(d.id) || '<b>无</b>'}</td><td class="num">${num(dr.meanPauseS, 0)} · ${(dr.share * 100).toFixed(1)} %</td><td class="num">${num(dc.meanPauseS, 0)} · ${(dc.share * 100).toFixed(1)} %</td>${SIZES.map((N) => `<td class="num">${num(d.fit * S.combined.perSize[N].residualFactor.plan, 0)}</td>`).join('')}</tr>`; }).join('')}<tr><td class="k">合计</td><td class="num">${num(total, 1)}</td><td class="num">100 %</td><td></td><td></td><td></td><td></td>${SIZES.map((N) => `<td class="num">${num(total * S.combined.perSize[N].residualFactor.plan, 0)}</td>`).join('')}</tr></table></div>`;
}

/* ---------- conclusions ---------- */
function famTop(N, fam) {
  const st = S.combined.perSize[N];
  return st.gains.filter((g) => (fam === 'new') === isNew(g.id)).sort((a, b) => b.byMetric.aOp.shapley - a.byMetric.aOp.shapley).slice(0, 3).map((g) => `${g.id} ${sgn(g.byMetric.aOp.shapley)}`).join('，');
}
function conclusions() {
  return SIZES.map((N) => {
    const zr = S.remap.perSize[N], zn = S.new.perSize[N], zc = S.combined.perSize[N];
    const base = zr.baseline.aOp;
    const head = base >= R.target ? `${zhN(N)}：基线已达标（${pct(base)} %）` : `${zhN(N)}：缺 ${pt(R.target - base)} pt`;
    const li = [];
    const line = (label, z) => `${label} ${z.plan.feasible ? `${pct(z.plan.nominal, 1)} % / 降额 ${pct(z.plan.derated, 1)} %（${planLabel(z)}，工作量 ${z.plan.effort}${z.verification ? `，P ${pct(z.verification.pAtLeastTarget, 0)} % ${z.verification.verdict}` : ''}）` : `不可行，最高 ${pct(z.plan.nominal, 1)} %（硬件尚须 × ${num(1 / z.residualFactor.plan)}）`}`;
    if (base < R.target) li.push(`${line('仅原有', zr)}；${line('仅新增', zn)}；${line('合并', zc)}。`);
    else li.push(`无需机制；硬件余量 × ${num(zr.residualFactor.plan, 1)}；三种机制集只改变余量（全部启用：原有 ${pct(zr.allOn.aOp)} %，新增 ${pct(zn.allOn.aOp)} %，合并 ${pct(zc.allOn.aOp)} %）。`);
    li.push(`薄弱环节（合并集方案后残余）：${topGroups(zc.planned)}；仅原有集后：${topGroups(zr.planned)}。`);
    li.push(`最重要机制（合并研究 Shapley）：原有 ${famTop(N, 'remap')}；新增 ${famTop(N, 'new')}。`);
    return `<div class="box"><h3>${esc(head)}</h3><ul>${li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }).join('');
}

/* ---------- assemble ---------- */
const c1 = chartAop(), c2 = chartResidual(), c3 = chartShapley();
writeFileSync(`${OUT_DIR}/fig1-aop-vs-n.svg`, c1.svg);
writeFileSync(`${OUT_DIR}/fig2-residual.svg`, c2.svg);
writeFileSync(`${OUT_DIR}/fig3-shapley.svg`, c3.svg);
const prov = R.provisional;
const provText = `适用比例 = 候选事件的 100 %、条件成功率 90 %、失败尝试 10 s、开销 0；FP8 / FP4 风险占比各 1/3；筛查适用比例 100 %`;
const z500 = S.combined.perSize[500000];
const lever500 = z500.levers ? z500.levers.filter((l) => l.id !== 'plan' && l.value >= R.target && l.valueDerated >= R.target).sort((a, b) => a.id.length - b.id.length)[0] : undefined;
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReMAP 原有 vs 新增机制 98.5 % 分配对比</title>
<meta name="description" content="54 条事件参考目录上，ReMAP 原有机制、新增 16 项机制与两者合并在 98.5 % 运行可用率目标下的硬件故障率与机制参数分配对比（1 万 / 10 万 / 20 万 / 50 万卡），薄弱环节与关键机制（HAC-D，${R.generated.slice(0, 10)}）。">
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
  .small { font-size: 11.3px; color: var(--muted); } .tag { display: inline-block; font-size: 10px; padding: 0 5px; border-radius: 4px; background: var(--warn-soft); color: var(--warn); }
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
    html, body { background: #fff; color: #000; font-size: 8.6px; line-height: 1.34; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7.2px; line-height: 1.26; } th, td { padding: 1px 2.5px; } table.dense { font-size: 6.9px; line-height: 1.2; } table.dense th, table.dense td { padding: 0.5px 2px; }
    .f { font-size: 7.8px; } code { font-size: 7.3px; } .small { font-size: 7.1px; } .box p, .box li, .callout, .sub, footer { font-size: 7.8px; } .box h3 { font-size: 8.5px; margin-bottom: 2px; } .box ul { padding-left: 12px; } .box li { font-size: 7.5px; }
    h1 { font-size: 14.5px; margin: 2px 0 3px; } h2 { font-size: 11px; margin: 6px 0 3px; padding-top: 4px; } .eyebrow { font-size: 8px; }
    figure.chart { margin: 3px 0 4px; } figcaption { font-size: 7.5px; margin-top: 1px; } details.tv { display: none; } .tip { display: none !important; }
    .grid2 { gap: 4px 10px; } .box { padding: 3px 7px; } .callout { margin: 4px 0; padding: 3px 7px; } p { margin: 2px 0; } .table-wrap { overflow: visible; }
    figure.chart.c1 svg { height: 228px; } figure.chart.c2 svg { height: 252px; } figure.chart.c3 svg { height: 236px; }
    table.dense { font-size: 6.4px; line-height: 1.18; } table.dense th, table.dense td { padding: 0.3px 2px; } table.dense th.num, table.dense th { white-space: normal; } td.num { white-space: normal; } .box li { font-size: 6.9px; } .box h3 { font-size: 8px; } .callout { font-size: 7.1px; } footer { font-size: 6.8px; } h2 { margin: 5px 0 2px; padding-top: 3px; } .grid2 { gap: 3px 8px; } .box { padding: 2px 6px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D · 机制集对比研究 · ${R.generated.slice(0, 10)} · 第 1 / 2 页</div>
  <h1>98.5 % 运行可用率目标：ReMAP 原有机制 vs 新增 16 项机制（1 万 / 10 万 / 20 万 / 50 万卡）</h1>
  <p class="sub"><b>口径</b>：A_op = 30 天窗口内的运行时间占比，目标 ≥ 98.5 %（不可用度预算 1.5 pt）；对象为 54 条事件的参考目录（中断 / 亚健康 / 静默 FIT 3333.3 / 69.0 / 48.3 每卡·小时），基线恢复 12.5 s 发现 + 180 s 自动尝试 @ 99 % + 2 h 人工。<b>三种候选机制集</b>：① ReMAP 原有 12 项（有参数变换的 8 项参与：D-HARD、D-SLOW、D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST；R-CKPT / R-MANUAL 为基线，H-PROTECT / H-RELIABILITY 无增量参数）；② 2026-10-14 审核新增 16 项（15 项参与，I-CONTAIN 为支撑能力无增量），集成字段按<b>临时假设</b>填入（${provText}），规划器再按覆盖率 −5 pt、成功率 −8 pt、时间 ×1.5 降额；③ 两者合并 23 项（超过 10 项 → 贪心规划，超过 12 项 → 置换抽样 Shapley ${S.combined.perSize[SIZES[0]].attribution.permutations} 次）。HAC-D 自带的 v3.2 七项（P-PREDICT、R-NETFAIL、R-HOTSWAP、C-MEM、D-SDC-DMR、H-LEMON、H-SWEEP）不在本次对比范围。每个集都做完整分配研究：仅改硬件 / 仅改恢复的预算、最低工作量可行集、方案后硬件因子、按域分组的残余、200 个窗口的账本校核（Wilson 区间）。</p>

  <h2 class="first">1. 三种机制集在四个规模的分配结果</h2>
  ${comparisonTable()}
  <p class="small">满足 98.5 % 的最大规模（名义 / 降额）：${SETS.map((k) => `${SET_LABEL[k]} 全部启用 ${kfmt(S[k].curves.allOn.maxN)} / ${kfmt(S[k].curves.allOnDerated.maxN)}，20 万卡推荐集 ${kfmt(S[k].curves.plan200000.maxN)} / ${kfmt(S[k].curves.plan200000Derated.maxN)}`).join('；')}；基线 ${kfmt(S.remap.curves.baseline.maxN)}。方案后硬件因子 ≥ 1 为余量（中断率可放宽到当前的若干倍，按 ARINC 等比落到各域），&lt; 1 为仍须改进的倍数。仅改硬件 / 仅改恢复的预算与机制集无关：10 万卡须故障率 × ${num(S.remap.perSize[100000].hardwareOnly.factor, 3)} 或 R̄ ≤ ${num(S.remap.perSize[100000].recoveryOnly.recoveryStarS, 0)} s，20 万卡 × ${num(S.remap.perSize[200000].hardwareOnly.factor, 3)} / ${num(S.remap.perSize[200000].recoveryOnly.recoveryStarS, 0)} s，50 万卡 × ${num(S.remap.perSize[500000].hardwareOnly.factor, 3)} / ${num(S.remap.perSize[500000].recoveryOnly.recoveryStarS, 0)} s。</p>

  <div class="callout"><b>跨规模结论</b>：① ReMAP 原有机制的上限约 ${kfmt(S.remap.curves.plan200000.maxN)} 卡（20 万卡以上无可行集，最高 ${pct(S.remap.perSize[200000].plan.nominal)} %），因为它的梯级只覆盖有重执行 / 进程 / 弹性标记的事件，无梯级域（UNKNOWN、POWER、COOL、MGMT、STORAGE，占中断率 28 %）和 72 s 的人工份额不受影响；② 新增 16 项恰好作用在这些残余上：D-RECOVERY-CLASSIFY 把人工份额压到 7 s，R-LINK-LOCAL / H-CONTROL-CONTINUITY 让网络与管理事件以 1–2 s 透明恢复，R-RUNTIME-SNAPSHOT / R-WARM-PROCESS / R-CANN-GRAPH 缩短 11 个域（含 UNKNOWN）的启动阶段，C-LOSSLESS 缩短读取阶段——合并后 20 万卡${S.combined.perSize[200000].plan.feasible ? `可行（${pct(S.combined.perSize[200000].plan.nominal)} % / 降额 ${pct(S.combined.perSize[200000].plan.derated)} %，硬件余量 × ${num(S.combined.perSize[200000].residualFactor.plan)}）` : '仍不可行'}，50 万卡${S.combined.perSize[500000].plan.feasible ? `可行（${pct(S.combined.perSize[500000].plan.nominal)} %）` : `最高 ${pct(S.combined.perSize[500000].plan.nominal)} %${lever500 ? `，加恢复杠杆 ${lever500.id} 后 ${pct(lever500.value)} %` : ''}`}；③ 剩下的薄弱环节是没有任何机制覆盖的供电、冷却与存储事件（合并集后约占残余 ${(() => { const v = groupVals(S.combined.perSize[200000].planned); const t = v.reduce((a, b) => a + b, 0); return ((v[3] + v[4]) / t * 100).toFixed(0); })()} %），只能靠硬件 FIT 预算；④ 新增机制的数字全部基于临时假设（适用 100 %、成功 90 %、失败 10 s）并已降额，实测前只能作为优先级排序与验收目标，不能作为承诺。</div>
  <figure class="chart c1">${c1.svg}<div class="tip" id="tip-aop"></div><figcaption>图 1：ReMAP 原有集把 98.5 % 的上限从基线的 ${kfmt(S.remap.curves.baseline.maxN)} 卡推到 ${kfmt(S.remap.curves.plan200000.maxN)} 卡（降额 ${kfmt(S.remap.curves.plan200000Derated.maxN)}），新增集推到 ${kfmt(S.new.curves.plan200000.maxN)} 卡（降额 ${kfmt(S.new.curves.plan200000Derated.maxN)}），合并集推到 ${kfmt(S.combined.curves.plan200000.maxN)} 卡（降额 ${kfmt(S.combined.curves.plan200000Derated.maxN)}）。</figcaption></figure>
  <details class="tv"><summary>图 1 数据表</summary>${c1.table}</details>

  <figure class="chart c2">${c2.svg}<figcaption>图 2：ReMAP 集压低有梯级域（NPU、主机、部分网络）的停顿，残余留在无梯级的供电 / 冷却 / 管理 / 存储 / 未归因事件；新增集通过链路透明恢复、控制面连续、启动阶段缩短与恢复动作分类作用在正是这些域和人工份额上，合并后残余集中到供电 / 冷却 / 存储。</figcaption></figure>
  <details class="tv"><summary>图 2 数据表</summary>${c2.table}</details>
</section>

<section class="page" id="p2">
  <div class="eyebrow">HAC-D · 机制集对比研究 · ${R.generated.slice(0, 10)} · 第 2 / 2 页</div>
  <h2 class="first">2. 关键机制：合并研究的 Shapley 归因（R = ReMAP 原有，新 = 新增）</h2>
  <figure class="chart c3">${c3.svg}<figcaption>图 3：抽样 Shapley 的 95 % 半宽见数据表（多数 &lt; 0.02 pt）。原有集内 R-REPLAY 与 R-ELASTIC 仍是最大的两项（互为替代）；新增集内 D-RECOVERY-CLASSIFY（人工份额 1 % → 0.1 %）、R-RUNTIME-SNAPSHOT（11 个域的启动阶段）、R-LINK-LOCAL 与 H-CONTROL-CONTINUITY（网络与管理事件的透明恢复）贡献最大；SDC 检测类机制对 A_op 为零或微负（它们改善的是正确交付）。</figcaption></figure>
  <details class="tv"><summary>图 3 数据表</summary>${c3.table}</details>
  ${mechanismTable(c3.ids)}

  <h2>3. 硬件故障率分配（每单元·小时 FIT，业务影响口径）与 20 万卡方案后的残余</h2>
  ${domainTable()}
  <p class="small"><sup>†</sup>新增适用（按审核的候选事件）：L 链路透明恢复、F 网络绕行降级、M 控制面连续、W 预热进程、S 运行时快照、G CANN 图缓存；C-LOSSLESS / D-RECOVERY-CLASSIFY 作用于所有中断。允许 FIT = 当前 × 合并集方案后的硬件因子（ARINC 等比；${SIZES.map((N) => `${zhNs(N)} × ${num(S.combined.perSize[N].residualFactor.plan)}`).join('，')}）。</p>

  <h2>4. 结论：各规模的薄弱环节与最重要的机制</h2>
  <div class="grid2">${conclusions()}</div>
  <footer>复现：<code>node --import tsx scripts/mechanism-comparison-98p5.ts --trials 200 --permutations 300</code> → <code>node scripts/build-mechanism-comparison-98p5.mjs</code>；同一计算可在"审核与报告"页、<code>hacd study --players …</code> 或 MCP <code>allocation_study</code> 中按任意机制集重跑。方法：docs/MODEL_REFERENCE.md §22–§24。</footer>
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
