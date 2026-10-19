#!/usr/bin/env node
/**
 * Build docs/HARDWARE_MECHANISM_ALLOCATION_98P5.zh.html (two printed A4 pages, two inline SVG charts with tooltips and table views):
 * why the ARINC allowed FIT values exceed the current values (slack = acceptance limit, not an improvement task), the MTBF of every
 * hardware class under the current, ARINC and AGREE allocations (per card and cluster-level), and how the 98.5 % budget is split
 * between hardware and reliability mechanisms (iso-target curves f(g), budget ledgers, lever alternatives).
 * Inputs: docs/hardware-mechanism-split-98p5/results.json (scripts/hardware-mechanism-split-98p5.ts) and
 * docs/agree-allocation-98p5/results.json (scripts/agree-allocation-98p5.ts).
 * Usage: node scripts/build-hardware-mechanism-split-98p5.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const HM = JSON.parse(readFileSync('docs/hardware-mechanism-split-98p5/results.json', 'utf8'));
const AG = JSON.parse(readFileSync('docs/agree-allocation-98p5/results.json', 'utf8'));
const OUT_HTML = 'docs/HARDWARE_MECHANISM_ALLOCATION_98P5.zh.html';
const OUT_DIR = 'docs/hardware-mechanism-split-98p5';
mkdirSync(OUT_DIR, { recursive: true });
const SIZES = HM.sizes;
const TARGET = HM.target;
const P = HM.perSize;
const C = AG.common;
const LZ = (N) => AG.sets.latest.perSize[N];
const RZ = (N) => AG.sets.remap.perSize[N];
const pct = (x, d = 2) => (x * 100).toFixed(d);
const pt = (x, d = 2) => (x * 100).toFixed(d);
const num = (x, d = 2) => Number(x).toFixed(d);
const kf = (k) => (k >= 10 ? k.toFixed(0) : k >= 2 ? k.toFixed(1) : k.toFixed(2));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zhN = (N) => ({ 10000: '1 万卡', 100000: '10 万卡', 200000: '20 万卡', 500000: '50 万卡' })[N] ?? `${N}`;
const zhNs = (N) => ({ 10000: '1 万', 100000: '10 万', 200000: '20 万', 500000: '50 万' })[N] ?? `${N}`;
const dom = (id) => id.replace(/-hard$/, '');
const textW = (s) => Array.from(s).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.6), 0);
const CLASSES = C[100000].classes;
const GROUPS = [['npu', 'NPU 芯片与内存'], ['network', '网络'], ['host', '主机'], ['facility', '机房设施'], ['storageSoftware', '存储 / 软件 / 未归因']];
const classOrder = GROUPS.flatMap(([g]) => CLASSES.filter((c) => c.group === g).map((c) => c.id));
const shortName = (id) => (CLASSES.find((c) => c.id === id)?.name ?? id).split(' · ')[0];
const yrs = (fit) => 1e9 / fit / 8760;
const hrs = (fit, N) => 1e9 / fit / N;
const fy = (y) => (y >= 100 ? y.toFixed(0) : y >= 10 ? y.toFixed(1) : y.toFixed(2));
const fh = (h) => (h >= 100 ? h.toFixed(0) : h >= 10 ? h.toFixed(1) : h.toFixed(2));
const fitTotal = CLASSES.reduce((a, c) => a + c.fit, 0);
const setLabel = (ids) => (ids.length ? (ids.length <= 4 ? ids.join(' + ') : `${ids.length} 项`) : '无机制');

const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const STYLE = `
svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; } }
:root[data-theme="light"] svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; }
:root[data-theme="dark"] svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; }
svg.viz text { fill: var(--ink); font-size: 12px; } svg.viz .t2 { fill: var(--ink2); font-size: 11.5px; } svg.viz .m { fill: var(--muted); font-size: 11px; } svg.viz .tick { font-variant-numeric: tabular-nums; } svg.viz .ttl { font-size: 13px; font-weight: 600; } svg.viz .lab { font-size: 10.5px; }
svg.viz .grid { stroke: var(--grid); stroke-width: 1; } svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .ref { stroke: var(--ink2); stroke-width: 1; } svg.viz .hit { fill: transparent; pointer-events: all; }
`;
const svgOpen = (id, W, H) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
function legend(x, y, items, kind = 'line') { let off = 0; return items.map((it) => { const lx = x + off; off += 30 + textW(it.name) + 14; return kind === 'line' ? `<line x1="${lx}" x2="${lx + 18}" y1="${y}" y2="${y}" stroke="var(--s${it.slot + 1})" stroke-width="2.5" stroke-linecap="round"/><text x="${lx + 24}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--s${it.slot + 1})"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join(''); }

/* ---------- chart 1: iso-target curves f(g) ---------- */
function chartIso() {
  const sizes = [100000, 200000, 500000];
  const W = 960, H = 412, L = 60, Rm = 22, Tp = 56, B = 58, pw = W - L - Rm, ph = H - Tp - B;
  const gx0 = Math.log10(0.05), gx1 = Math.log10(2), fy0 = Math.log10(0.08), fy1 = Math.log10(10);
  const xs = (g) => L + ((Math.log10(g) - gx0) / (gx1 - gx0)) * pw;
  const ys = (f) => Tp + ph - ((Math.log10(Math.min(10, Math.max(0.08, f))) - fy0) / (fy1 - fy0)) * ph;
  let g = svgOpen('chart-iso', W, H) + `<text x="${L}" y="20" class="ttl">图 1 · 硬件与恢复的等目标曲线：恢复因子 g（所有恢复阶段 × g）对应为满足 98.5 % 所需的硬件因子 f（所有类故障率 × f）；f &gt; 1 余量，f &lt; 1 任务</text>` + legend(L, 40, sizes.map((N, i) => ({ name: `${zhN(N)} 等目标线 f(g)`, slot: i })));
  for (const v of [0.1, 0.2, 0.5, 1, 2, 5, 10]) { const y = ys(v); g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="${v === 1 ? 'ref' : 'grid'}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="m tick">×${v}</text>`; }
  for (const v of [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2]) { const x = xs(v); g += `<line x1="${x}" x2="${x}" y1="${Tp}" y2="${Tp + ph}" class="${v === 1 ? 'ref' : 'grid'}"/><text x="${x}" y="${Tp + ph + 16}" text-anchor="middle" class="m tick">×${v}</text>`; }
  g += `<text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle" class="m">恢复因子 g = 方案的每次事件平均停顿 ÷ 基线（264 s）；对数轴，越靠左恢复越快</text><text x="${L + pw / 2}" y="${H - 24}" text-anchor="middle" class="m">■ 基线（g = 1） ● 最新 AGREE 集 ○ 原有 AGREE 集 ◆ 杠杆 / 全部 23 项；点落在各自规模的曲线附近：横向 = 机制把恢复压到哪里，纵向 = 硬件还须改多少</text><text transform="translate(16 ${Tp + ph / 2}) rotate(-90)" text-anchor="middle" class="m">硬件因子 f（允许 FIT ÷ 当前 FIT，对数轴）</text>`;
  g += `<text x="${L + 6}" y="${ys(1) - 6}" class="t2">f = 1：硬件保持现状即可达标</text>`;
  const tipData = [];
  sizes.forEach((N, i) => {
    const z = P[N];
    const pts = z.iso.filter((p) => p.f > 0 && Number.isFinite(p.f));
    g += `<path d="${pts.map((p, j) => `${j ? 'L' : 'M'}${xs(p.g).toFixed(1)} ${ys(p.f).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--s${i + 1})" stroke-width="2" stroke-linejoin="round"/>`;
    for (const p of pts) g += `<circle cx="${xs(p.g).toFixed(1)}" cy="${ys(p.f).toFixed(1)}" r="2.5" fill="var(--s${i + 1})" data-tip="${zhN(N)} 等目标线\n恢复 × ${p.g} → 平均停顿 ${num(p.meanPauseS, 0)} s，硬件因子 f = ${num(p.f, 3)}（f · g = ${num(p.f * p.g, 3)}）"/>`;
    const marks = [
      { key: 'baseline', label: '基线', g: 1, f: z.hardwareOnly.factor, extra: `仅改硬件：全部类 × ${num(z.hardwareOnly.factor, 3)}` },
      { key: 'remapAgree', label: `原有 AGREE 集（${z.sets.remapAgree.ids.length}）`, g: z.sets.remapAgree.recoveryFactorEff, f: z.sets.remapAgree.hardwareFactor, extra: `${z.sets.remapAgree.ids.join(' + ')}：A_op ${pct(z.sets.remapAgree.aOp)} %` },
      { key: 'latestAgree', label: `最新 AGREE 集（${z.sets.latestAgree.ids.length}）`, g: z.sets.latestAgree.recoveryFactorEff, f: z.sets.latestAgree.hardwareFactor, extra: `${z.sets.latestAgree.ids.length} 项：A_op ${pct(z.sets.latestAgree.aOp)} %` },
      { key: 'latestAll', label: '全部 23 项', g: z.sets.latestAll.recoveryFactorEff, f: z.sets.latestAll.hardwareFactor, extra: `A_op ${pct(z.sets.latestAll.aOp)} %` },
      { key: 'auto60', label: '+ 自动 60 s', g: z.levers[0].recoveryFactorEff, f: z.levers[0].hardwareFactor, extra: `最新 AGREE 集 + 自动尝试 60 s：A_op ${pct(z.levers[0].aOp)} %` },
      { key: 'all3', label: '+ 三项杠杆', g: z.levers[3].recoveryFactorEff, f: z.levers[3].hardwareFactor, extra: `最新 AGREE 集 + 自动 60 s、成功率 99.9 %、人工 30 min：A_op ${pct(z.levers[3].aOp)} %` },
    ].filter((m) => m.key !== 'remapAgree' || z.sets.remapAgree.ids.length);
    marks.forEach((m) => {
      const x = xs(m.g), y = ys(m.f);
      const shape = m.key === 'baseline' ? `<rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" fill="var(--s${i + 1})" stroke="var(--surface)" stroke-width="1.5"/>` : m.key.startsWith('latest') ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="var(--s${i + 1})" stroke="var(--surface)" stroke-width="1.5"/>` : m.key === 'remapAgree' ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="var(--surface)" stroke="var(--s${i + 1})" stroke-width="2"/>` : `<path d="M${x.toFixed(1)} ${(y - 6).toFixed(1)} L${(x + 6).toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${(y + 6).toFixed(1)} L${(x - 6).toFixed(1)} ${y.toFixed(1)} Z" fill="var(--s${i + 1})" stroke="var(--surface)" stroke-width="1.5"/>`;
      g += `<g data-tip="${zhN(N)} · ${esc(m.label)}\n${esc(m.extra)}\n恢复因子 g_eff = ${num(m.g, 3)}（平均停顿 ${num(m.g * z.baseline.meanPauseS, 0)} s），硬件因子 f = ${num(m.f, 3)} → 允许 FIT = 当前 × ${num(m.f, 2)}">${shape}</g>`;
      tipData.push({ N, ...m });
    });
    // labels for the main points
    const lab = (m, dx, dy, anchor = 'start') => `<text x="${(xs(m.g) + dx).toFixed(1)}" y="${(ys(m.f) + dy).toFixed(1)}" class="lab" text-anchor="${anchor}" fill="var(--s${i + 1})">${esc(m.label)} ×${num(m.f, 2)}</text>`;
    g += lab(marks.find((m) => m.key === 'baseline'), 8, 4) + lab(marks.find((m) => m.key === 'latestAgree'), -8, i === 2 ? 14 : -8, 'end') + lab(marks.find((m) => m.key === 'all3'), 8, 4);
  });
  g += '</svg>';
  const table = `<table class="tv"><tr><th>规模</th><th>点</th><th class="num">g_eff</th><th class="num">平均停顿 s</th><th class="num">硬件因子 f</th><th class="num">f · g</th><th>说明</th></tr>${tipData.map((m) => `<tr><td>${zhN(m.N)}</td><td>${esc(m.label)}</td><td class="num">${num(m.g, 3)}</td><td class="num">${num(m.g * P[m.N].baseline.meanPauseS, 0)}</td><td class="num">${num(m.f, 3)}</td><td class="num">${num(m.f * m.g, 3)}</td><td>${esc(m.extra)}</td></tr>`).join('')}${sizes.flatMap((N) => P[N].iso.map((p) => `<tr><td>${zhN(N)}</td><td>等目标线</td><td class="num">${p.g}</td><td class="num">${num(p.meanPauseS, 0)}</td><td class="num">${num(p.f, 3)}</td><td class="num">${num(p.f * p.g, 3)}</td><td>所有恢复阶段 × ${p.g}</td></tr>`)).join('')}</table>`;
  return { svg: g, table };
}

/* ---------- chart 2: who takes the reduction ---------- */
function chartSplit() {
  const rows = [];
  for (const N of SIZES) {
    const z = P[N];
    for (const key of ['latestAgree', 'remapAgree']) {
      const s = z.sets[key]; if (!s) continue;
      const base = z.baseline.unavailability, b = 1 - TARGET;
      const need = base - b; // > 0: reduction required; < 0: slack even at baseline
      const removed = base - s.unavailability;
      rows.push({ N, key, label: `${zhNs(N)} · ${key === 'latestAgree' ? '最新集' : '原有集'}`, base, need, removed, residual: s.unavailability, hw: Math.max(0, s.unavailability - b), slack: Math.max(0, b - s.unavailability), f: s.hardwareFactor, ids: s.ids });
    }
  }
  const W = 960, L = 96, Rm = 150, Tp = 60, rowP = 24, barH = 15, B = 40;
  const H = Tp + rows.length * rowP + B;
  const pw = W - L - Rm, xmax = 12;
  const xs = (v) => L + (v * 100 / xmax) * pw;
  let g = svgOpen('chart-split', W, H) + `<text x="${L}" y="20" class="ttl">图 2 · 98.5 % 预算的分担（pt = 100 − A_op）：基线不可用度 = 机制集削减 + 方案后残余；残余 ≤ 1.5 pt 为余量（硬件可放宽），&gt; 1.5 pt 的部分是硬件任务</text>` + legend(L, 37, [{ name: '机制集削减', slot: 0 }, { name: '方案后残余（≤ 1.5 pt 预算内）', slot: 2 }, { name: '硬件须削减（残余超出预算）', slot: 1 }], 'rect');
  for (let v = 0; v <= xmax; v += 2) { const x = xs(v / 100); g += `<line x1="${x}" x2="${x}" y1="${Tp - 4}" y2="${Tp + rows.length * rowP}" class="grid"/><text x="${x}" y="${Tp + rows.length * rowP + 14}" text-anchor="middle" class="m tick">${v}</text>`; }
  const xb = xs(1 - TARGET);
  g += `<line x1="${xb}" x2="${xb}" y1="${Tp - 4}" y2="${Tp + rows.length * rowP}" class="ref"/><text x="${xb + 4}" y="${Tp - 1}" class="t2">预算 1.5 pt</text><text x="${L + pw}" y="${H - 6}" text-anchor="end" class="m">不可用度（百分点）；条从左到右：方案后残余 → 机制削减；红色 = 残余中超出预算的部分</text>`;
  rows.forEach((r, i) => {
    const y = Tp + i * rowP + 4;
    g += `<text x="${L - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="t2">${esc(r.label)}</text>`;
    const within = Math.min(r.residual, 1 - TARGET);
    const tip = `${esc(r.label)}：${esc(setLabel(r.ids))}\n基线 ${pt(r.base)} pt → 方案后 ${pt(r.residual)} pt（机制削减 ${pt(r.removed)} pt）\n${r.hw > 0 ? `超出预算 ${pt(r.hw)} pt → 硬件须削减：全部类 × ${num(r.f, 3)}（ARINC）` : `余量 ${pt(r.slack)} pt → 硬件可放宽到 × ${num(r.f, 2)}`}\n削减分担：机制 ${r.need > 0 ? pct(Math.min(1, r.removed / r.need), 0) : '—'} % · 硬件 ${r.need > 0 ? pct(r.hw / r.need, 0) : '—'} %`;
    g += `<rect x="${xs(0).toFixed(1)}" y="${y}" width="${(xs(within) - xs(0)).toFixed(1)}" height="${barH}" fill="var(--s3)" data-tip="${tip}"/>`;
    if (r.hw > 0) g += `<rect x="${xs(within).toFixed(1)}" y="${y}" width="${(xs(r.residual) - xs(within)).toFixed(1)}" height="${barH}" fill="var(--s2)" data-tip="${tip}"/>`;
    g += `<rect x="${xs(r.residual).toFixed(1)}" y="${y}" width="${Math.max(0, xs(r.base) - xs(r.residual)).toFixed(1)}" height="${barH}" rx="3" fill="var(--s1)" data-tip="${tip}"/>`;
    g += `<text x="${(xs(r.base) + 6).toFixed(1)}" y="${y + barH / 2 + 4}" class="t2 tick">${pt(r.base)} → ${pt(r.residual)}${r.hw > 0 ? `，硬件 × ${num(r.f, 2)}` : `，余量 × ${num(r.f, 2)}`}</text>`;
  });
  g += '</svg>';
  const table = `<table class="tv"><tr><th>行</th><th>机制集</th><th class="num">基线 pt</th><th class="num">机制削减 pt</th><th class="num">方案后 pt</th><th class="num">预算内 pt</th><th class="num">硬件须削减 pt</th><th class="num">硬件因子 f</th><th class="num">机制 / 硬件 分担</th></tr>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.ids.join(' + ') || '无')}</td><td class="num">${pt(r.base, 3)}</td><td class="num">${pt(r.removed, 3)}</td><td class="num">${pt(r.residual, 3)}</td><td class="num">${pt(Math.min(r.residual, 1 - TARGET), 3)}</td><td class="num">${pt(r.hw, 3)}</td><td class="num">${num(r.f, 3)}</td><td class="num">${r.need > 0 ? `${pct(Math.min(1, r.removed / r.need), 0)} % / ${pct(r.hw / r.need, 0)} %` : '基线已达标'}</td></tr>`).join('')}</table>`;
  return { svg: g, table, rows };
}

/* ---------- tables ---------- */
function whyTable() {
  const row = (label, f) => `<tr><td class="k" style="white-space:normal">${label}</td>${SIZES.map((N) => `<td>${f(N, P[N])}</td>`).join('')}</tr>`;
  const prodNote = (N) => { const z = P[N]; return z.iso.filter((p) => p.g <= 1 && p.g >= 0.1).map((p) => num(p.f * p.g, 2)); };
  return `<div class="table-wrap"><table>
<tr><th style="width:26%">量（30 天窗口，A_op 口径；f = 允许 FIT ÷ 当前 FIT，所有类相同）</th>${SIZES.map((N) => `<th>${zhN(N)}</th>`).join('')}</tr>
${row('基线：A_op · 不可用度 U₀ · 相对 1.5 pt 预算', (N, z) => `${pct(z.baseline.aOp)} % · ${pt(z.baseline.unavailability)} pt · ${z.baseline.unavailability <= 1 - TARGET ? `<b>余量 ${pt(1 - TARGET - z.baseline.unavailability)} pt</b>` : `缺 ${pt(z.baseline.unavailability - (1 - TARGET))} pt`}`)}
${row('基线每次事件平均停顿 p̄ · 硬件 MTBI', (N, z) => `${num(z.baseline.meanPauseS, 0)} s · ${num(z.baseline.mtbiHours, 2)} h`)}
${row('仅改硬件（恢复不变）：f = 预算 ÷ 当前 Σλ p̄ · 允许 FIT 合计', (N, z) => `<b>× ${num(z.hardwareOnly.factor, 3)}</b> · ${num(fitTotal * z.hardwareOnly.factor, 0)} FIT（当前 ${num(fitTotal, 0)}）`)}
${row('仅改恢复（硬件不变）：所有阶段 × g · 平均停顿须 ≤', (N, z) => `× ${num(z.recoveryOnly.factor, 3)} · ${num(z.recoveryOnly.meanPauseStarS, 0)} s`)}
${row('最新 ReMAP 的 AGREE 机制集：停顿 → g_eff · 方案后 U · 允许 FIT 因子 f′', (N, z) => { const s = z.sets.latestAgree; return `${num(s.meanPauseS, 0)} s → × ${num(s.recoveryFactorEff, 3)} · ${pt(s.unavailability)} pt · <b>× ${num(s.hardwareFactor, 3)}</b>${s.hardwareFactor >= 1 ? '（余量：允许 FIT 高于当前）' : '（任务：允许 FIT 低于当前）'}`; })}
${row('ReMAP 原有机制的 AGREE 集：g_eff · U · f′', (N, z) => { const s = z.sets.remapAgree; return `× ${num(s.recoveryFactorEff, 3)} · ${pt(s.unavailability)} pt · <b>× ${num(s.hardwareFactor, 3)}</b>`; })}
${row('上一报告的规划器集（最新 ReMAP）：g_eff · U · f′', (N, z) => { const s = z.sets.latestPlanner; return s ? `× ${num(s.recoveryFactorEff, 3)} · ${pt(s.unavailability)} pt · × ${num(s.hardwareFactor, 3)}` : '—'; })}
${row('等目标线上 f · g 的取值（g = 0.1 … 1）：一阶理论为常数 = 仅硬件 f', (N) => `${prodNote(N).join(' / ')}`)}
</table></div>`;
}
function mtbfTable() {
  const sizes = [200000, 500000];
  const cell = (fit, N, bold = false) => `${bold ? '<b>' : ''}${num(fit, 0)}${bold ? '</b>' : ''} · ${fh(hrs(fit, N))}`;
  const head = sizes.map((N) => `<th class="num" style="border-left:2px solid var(--rule)">当前集群<br>MTBF h</th><th class="num">ARINC<br>仅硬件</th><th class="num">ARINC<br>机制后</th><th class="num">AGREE 严格<br>仅硬件</th><th class="num">AGREE 再分配<br>机制后</th>`).join('');
  const body = classOrder.map((id) => {
    const c = CLASSES.find((x) => x.id === id);
    const cols = sizes.map((N) => {
      const hwA = c.fit * P[N].hardwareOnly.factor;
      const setA = c.fit * P[N].sets.latestAgree.hardwareFactor;
      const agStrict = C[N].hardwareOnly.agreeEqual.rows.find((r) => r.id === id);
      const agSet = LZ(N).classes.find((r) => r.id === id);
      return `<td class="num" style="border-left:2px solid var(--rule)">${fh(hrs(c.fit, N))}</td><td class="num">${cell(hwA, N)}</td><td class="num">${cell(setA, N)}</td><td class="num${agStrict.k > 1 ? ' hw' : ''}">${cell(agStrict.allowedFit, N, agStrict.k > 1)}</td><td class="num${agSet.overRealloc ? ' hw' : ''}">${agSet.overRealloc ? cell(agSet.realloc.allowedFit, N, true) : `${num(c.fit, 0)} · ${fh(hrs(c.fit, N))}<span class="small">（不变）</span>`}</td>`;
    }).join('');
    return `<tr><td class="k">${esc(dom(id))} <span class="small">${esc(shortName(id))}</span></td><td class="num">${num(c.fit, 1)}</td><td class="num">${fy(yrs(c.fit))}</td>${cols}</tr>`;
  }).join('');
  const totals = sizes.map((N) => { const lam = (fit) => fit * 1e-9 * N; const mtbi = (fit) => 1 / lam(fit); const hwA = fitTotal * P[N].hardwareOnly.factor; const setA = fitTotal * P[N].sets.latestAgree.hardwareFactor; const agS = C[N].hardwareOnly.agreeEqual.rows.reduce((a, r) => a + r.allowedFit, 0); const agR = LZ(N).classes.reduce((a, r) => a + (r.overRealloc ? r.realloc.allowedFit : CLASSES.find((c) => c.id === r.id).fit), 0); return `<td class="num" style="border-left:2px solid var(--rule)">${fh(mtbi(fitTotal))}</td><td class="num">${num(hwA, 0)} · ${fh(mtbi(hwA))}</td><td class="num">${num(setA, 0)} · ${fh(mtbi(setA))}</td><td class="num">${num(agS, 0)} · ${fh(mtbi(agS))}</td><td class="num">${num(agR, 0)} · ${fh(mtbi(agR))}</td>`; }).join('');
  return `<div class="table-wrap"><table class="dense"><tr><th rowspan="2">域</th><th class="num" rowspan="2">当前<br>FIT</th><th class="num" rowspan="2">每卡 MTBF<br>年</th>${sizes.map((N) => `<th colspan="5" style="text-align:center;border-left:2px solid var(--rule)">${zhN(N)}：允许 FIT · 集群级 MTBF（h）</th>`).join('')}</tr><tr>${head}</tr>${body}<tr><td class="k">合计 / 硬件 MTBI</td><td class="num">${num(fitTotal, 0)}</td><td class="num">${fy(yrs(fitTotal))}</td>${totals}</tr></table></div>`;
}
function ledgerTable() {
  const row = (label, f) => `<tr><td class="k" style="white-space:normal">${label}</td>${SIZES.map((N) => `<td>${f(N, P[N])}</td>`).join('')}</tr>`;
  const hwTasks = (N) => { const z = LZ(N); const over = z.classes.filter((r) => r.overRealloc).sort((a, b) => b.realloc.k - a.realloc.k); return over.length ? over.map((r) => `${dom(r.id)} ×${kf(r.realloc.k)}（${num(r.realloc.allowedFit, 0)} FIT）`).join('，') : '无'; };
  const lever = (N, id) => P[N].levers.find((l) => l.id === id);
  return `<div class="table-wrap"><table class="dense">
<tr><th style="width:27%">预算账本（A_op 口径，pt = 百分点）</th>${SIZES.map((N) => `<th>${zhN(N)}</th>`).join('')}</tr>
${row('① 基线不可用度 U₀ − 预算 1.5 pt = 须削减量', (N, z) => { const need = z.baseline.unavailability - (1 - TARGET); return `${pt(z.baseline.unavailability)} − 1.50 = ${need > 0 ? `<b>${pt(need)}</b>` : `${pt(need)}（无需削减）`}`; })}
${row('② 机制集削减（最新 ReMAP 的 AGREE 集 · 工作量）· 名义 / 降额 A_op', (N, z) => { const s = z.sets.latestAgree; const a = LZ(N).agree; return `${pt(s.removedPts)} pt（${esc(setLabel(s.ids))} · ${a.effort}）· ${pct(s.aOp)} / ${pct(LZ(N).plannedDerated.aOp)} %`; })}
${row('③ 方案后残余 U₁ · 相对预算', (N, z) => { const s = z.sets.latestAgree; const gap = s.unavailability - (1 - TARGET); return `${pt(s.unavailability)} pt · ${gap > 0 ? `<b>超出 ${pt(gap)} pt</b>` : `余量 ${pt(-gap)} pt`}`; })}
${row('④ 硬件分担：ARINC 等比（全部类 × f′）· AGREE 再分配（只改 k′ > 1 的类）', (N, z) => { const s = z.sets.latestAgree; return `× ${num(s.hardwareFactor, 3)}${s.hardwareFactor >= 1 ? '（放宽）' : '（改进）'} · ${hwTasks(N)}`; })}
${row('⑤ 削减分担比例：机制 : 硬件（占须削减量）', (N, z) => { const l = z.ledgers.latestAgree; const need = l.baselineU - l.budget; return need > 0 ? `${pct(l.mechanismShareOfReduction, 0)} % : ${pct(l.hardwareShareOfReduction, 0)} %` : '基线已达标（机制与硬件都是余量）'; })}
${row('⑥ 替代硬件的恢复杠杆（库外参数，机制集之上）：自动 60 s → A_op · f′ ；三项同时 → A_op · f′', (N) => { const a = lever(N, 'auto60'), b = lever(N, 'all3'); return `${pct(a.aOp)} % · × ${num(a.hardwareFactor, 2)}；${pct(b.aOp)} % · × ${num(b.hardwareFactor, 2)}`; })}
${row('⑦ 对照：ReMAP 原有机制的 AGREE 集 → 残余 · f′ · 硬件分担', (N, z) => { const s = z.sets.remapAgree; const l = z.ledgers.remapAgree; const need = l.baselineU - l.budget; return `${pt(s.unavailability)} pt · × ${num(s.hardwareFactor, 3)} · ${need > 0 ? `${pct(l.hardwareShareOfReduction, 0)} %` : '—'}`; })}
</table></div>`;
}

/* ---------- assemble ---------- */
const c1 = chartIso(), c2 = chartSplit();
writeFileSync(`${OUT_DIR}/fig1-iso-target.svg`, c1.svg);
writeFileSync(`${OUT_DIR}/fig2-budget-split.svg`, c2.svg);
const gen = HM.generated.slice(0, 10);
const z1 = P[100000], z2 = P[200000], z5 = P[500000];
const core = CLASSES.find((c) => c.id === 'CORE-hard');
const l5 = LZ(500000);
const hw5 = l5.classes.filter((r) => r.overRealloc).sort((a, b) => b.realloc.k - a.realloc.k);
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>硬件与机制的分配</title>
<meta name="description" content="解释为什么 ARINC 分配给出的硬件允许 FIT 会高于当前值（余量 = 验收上限而非改进任务），给出 18 个硬件事件类在当前、ARINC 与 AGREE 分配下的 MTBF（每卡与集群级），并用等目标曲线与预算账本说明 98.5 % 可用率预算在硬件与可靠性机制之间怎么分（HAC-D，${gen}）。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; --hw:#fbe6e4; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --hw:#4a2622; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --hw:#4a2622; }
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
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
  footer, .eyebrow, p { overflow-wrap: anywhere; }
  .small { font-size: 11.3px; color: var(--muted); }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.8px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3.5px 6px; text-align: left; vertical-align: top; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.3px; }
  td.k { white-space: nowrap; font-weight: 500; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } td.hw { background: var(--hw); }
  figure.chart { margin: 8px 0 10px; position: relative; } figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  details.tv { margin: -2px 0 10px; font-size: 11.5px; overflow-x: auto; } details.tv summary { cursor: pointer; color: var(--accent); }
  table.tv { font-size: 11px; } table.tv th, table.tv td { padding: 2px 5px; }
  .tip { position: absolute; z-index: 5; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 11.5px; line-height: 1.4; padding: 6px 9px; border-radius: 6px; white-space: pre-line; max-width: 340px; box-shadow: 0 2px 8px rgba(0,0,0,.25); display: none; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  .formula { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 6px 0; font-size: 12.2px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
  .box { background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; padding: 7px 11px; } .box h3 { margin: 0 0 4px; font-size: 12.5px; } .box ol, .box ul { margin: 2px 0; padding-left: 16px; } .box li { margin: 2px 0; font-size: 12px; }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; }
  @media screen and (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 700px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.8px; line-height: 1.36; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7.5px; line-height: 1.28; } th, td { padding: 1.2px 2.5px; } th { font-size: inherit; } table.dense { font-size: 7.2px; line-height: 1.22; } table.dense th, table.dense td { padding: 0.8px 2px; } table.dense th { white-space: normal; } td.num { white-space: normal; }
    #p1 .table-wrap:first-of-type table { font-size: 7.6px; line-height: 1.26; }
    code { font-size: 7.4px; } .small { font-size: 7.3px; } .callout, .formula, .sub, footer { font-size: 7.9px; } .callout, .formula { margin: 3px 0; padding: 3px 7px; } footer { font-size: 7.2px; }
    .box { padding: 3px 7px; } .box h3 { font-size: 8.6px; margin-bottom: 2px; } .box li { font-size: 7.8px; margin: 1px 0; } .box ol, .box ul { padding-left: 11px; } .grid2 { gap: 4px 10px; }
    h1 { font-size: 14px; margin: 2px 0 3px; } h2 { font-size: 10.5px; margin: 4px 0 2px; padding-top: 3px; } .eyebrow { font-size: 7.5px; }
    figure.chart { margin: 2px 0 2px; } figcaption { font-size: 7.2px; margin-top: 0; } details.tv { display: none; } .tip { display: none !important; }
    p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    figure.chart.c1 svg { height: 292px; } figure.chart.c2 svg { height: 168px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D · 硬件与机制的分配（98.5 % A_op，54 条事件参考目录） · ${gen} · 第 1 / 2 页</div>
  <h1>硬件故障率与可靠性机制之间的分配：为什么 ARINC 允许 FIT 高于当前值、各类硬件的 MTBF、预算怎么分</h1>
  <p class="sub"><b>口径</b>：A_op = 30 天窗口内运行时间占比，目标 ≥ 98.5 %（预算 1.5 pt）；对象为 54 条事件的参考审核目录（中断 FIT 3333.3 每卡·小时，18 个硬件事件类），基线恢复 12.5 s 发现 + 180 s 自动尝试 @ 99 % + 2 h 人工（每次事件平均停顿 ${num(z1.baseline.meanPauseS, 0)} s）。FIT 为"业务影响口径"的事件率：每卡·小时内该类事件使作业中断的次数 × 10⁹，已含现有保护后的残余；它不是器件手册的 MTBF。机制集取三份 AGREE 报告的结果（ReMAP 最新机制集与原有机制各自的 AGREE 两阶段集），规划器集取此前报告。所有因子由引擎二分求得，不是一阶近似。</p>
  <h2 class="first">1. 为什么 ARINC 分配出的允许 FIT 会高于当前值</h2>
  <div class="formula">1 − A_op ≈ A_run · Σᵢ λᵢ p̄ᵢ / 3600 + 非域暂停项（λᵢ = 该类集群级事件率 /h，p̄ᵢ = 每次事件平均停顿 s）。目标 ⇒ Σᵢ λᵢ p̄ᵢ ≤ B_eff。<b>ARINC 把 B_eff 按当前比例分给各类，等价于所有类乘同一个因子 f = B_eff / Σᵢ λᵢ⁰ p̄ᵢ，允许 FITᵢ = f × 当前 FITᵢ</b>。所以 f 是"当前方案离目标有多远"的倒数：<b>f &lt; 1 ⇔ 当前方案不达标，允许 FIT 低于当前 = 改进任务；f &gt; 1 ⇔ 当前方案已超过目标，允许 FIT 高于当前 = 验收上限（硬件最多可以差到这里而仍然达标），不是要去追的指标</b>。三种情形让 f &gt; 1：① 规模小，基线本身就达标（1 万卡：基线 ${pct(z1.baseline.aOp)} %，余量 ${pt(1 - TARGET - P[10000].baseline.unavailability)} pt → f = ${num(P[10000].hardwareOnly.factor, 2)}）；② 机制把 p̄ᵢ 压低——同一预算容得下更多事件：10 万卡最新 AGREE 集把平均停顿从 ${num(z1.baseline.meanPauseS, 0)} s 压到 ${num(z1.sets.latestAgree.meanPauseS, 0)} s（g_eff ${num(z1.sets.latestAgree.recoveryFactorEff, 2)}），于是仅硬件时的 × ${num(z1.hardwareOnly.factor, 3)}（改进任务）变成机制后的 × ${num(z1.sets.latestAgree.hardwareFactor, 3)}（余量）；20 万卡同理 × ${num(z2.hardwareOnly.factor, 3)} → × ${num(z2.sets.latestAgree.hardwareFactor, 3)}；③ 50 万卡即使全部 23 项机制也只到 × ${num(z5.sets.latestAll.hardwareFactor, 3)}——这时允许 FIT 才真正低于当前，是任务。此前报告"硬件故障率分配"表里 1 万 / 10 万 / 20 万卡的允许值都高于当前值，正是情形 ①②；读法：把它们当作每类可接受的最差 FIT（验收限值），而 50 万卡那一列才是改进目标。</div>
  ${whyTable()}
  <p class="small">等目标线上 f · g ≈ 常数说明两条杠杆在一阶上可以互换（硬件差一倍 ⇔ 恢复快一倍）；乘积随 g 变小而略升，是因为非域暂停项（亚健康隔离、静默错误检出）不随恢复阶段缩放，以及 A_run 归一化的二阶效应。ARINC 的"等比"保留了当前各类的构成比例，因此允许 FIT 的高低完全由 f 决定；AGREE 则按类给出不同的 k（第 2 节），余量类在再分配后保持当前值（不允许恶化），超预算类才有改进任务。</p>
  <h2>2. 各硬件类的 MTBF：当前值与 ARINC / AGREE 允许值（20 万 / 50 万卡）</h2>
  <div class="formula">换算：每卡 MTBFᵢ = 10⁹ / FITᵢ 小时（单卡上该类中断事件的平均间隔，÷ 8760 得年）；集群级 MTBFᵢ(N) = 每卡 MTBFᵢ / N（整个集群该类事件的平均间隔）；硬件总 MTBI = 1 / Σλᵢ = 10⁹ / (N · ΣFIT)。允许值的 MTBF 按同一公式由允许 FIT 换算：ARINC 允许 FIT = 当前 × f；AGREE 严格允许 FIT = 当前 / kᵢ（kᵢ = 当前 ÷ 等分预算下的允许率，&lt; 1 的类允许值高于当前）；AGREE 再分配后只有 k′ᵢ &gt; 1 的类（底色）有允许值，其余保持当前值。例：CORE ${num(core.fit, 1)} FIT → 每卡 ${fy(yrs(core.fit))} 年，20 万卡集群级 ${fh(hrs(core.fit, 200000))} h；仅硬件 ARINC 要求 ${num(core.fit * z2.hardwareOnly.factor, 0)} FIT（${fh(hrs(core.fit * z2.hardwareOnly.factor, 200000))} h），AGREE 严格要求 ${num(C[200000].hardwareOnly.agreeEqual.rows.find((r) => r.id === 'CORE-hard').allowedFit, 0)} FIT（k = ${kf(C[200000].hardwareOnly.agreeEqual.rows.find((r) => r.id === 'CORE-hard').k)}），而最新 AGREE 机制集之后 ARINC 允许 ${num(core.fit * z2.sets.latestAgree.hardwareFactor, 0)} FIT、AGREE 不要求改进。</div>
  ${mtbfTable()}
  <p class="small">每格 = 允许 FIT · 对应的集群级 MTBF（h）。"ARINC 仅硬件"= 恢复不变时全部类 × f；"ARINC 机制后"= 最新 ReMAP 的 AGREE 机制集之后全部类 × f′（20 万卡 × ${num(z2.sets.latestAgree.hardwareFactor, 2)} 是放宽，50 万卡 × ${num(z5.sets.latestAgree.hardwareFactor, 2)} 是改进）；"AGREE 严格仅硬件"= 各类独立达到等分预算 ${pt(C[200000].budget.perClassEqual, 3)} / ${pt(C[500000].budget.perClassEqual, 3)} pt 时的允许值（粗体 = 低于当前）；"AGREE 再分配机制后"= 机制集之后把余量类的余量补给超预算类后仍须改进的类（50 万卡：${hw5.map((r) => `${dom(r.id)} ×${kf(r.realloc.k)}`).join('、')}），其余类不变。集群级 MTBF 随 N 反比下降，是分配随规模变严的根源。</p>
</section>
<section class="page" id="p2">
  <div class="eyebrow">HAC-D · 硬件与机制的分配 · ${gen} · 第 2 / 2 页</div>
  <h2 class="first">3. 硬件与可靠性机制之间怎么分：等目标曲线与预算账本</h2>
  <figure class="chart c1">${c1.svg}<div class="tip"></div><figcaption>图 1：每条曲线是该规模下"恢复因子 g → 为达标所需的硬件因子 f"的等目标线（仅硬件：g = 1 处 f = ${num(z1.hardwareOnly.factor, 3)} / ${num(z2.hardwareOnly.factor, 3)} / ${num(z5.hardwareOnly.factor, 3)}；仅恢复：f = 1 处 g = ${num(z1.recoveryOnly.factor, 3)} / ${num(z2.recoveryOnly.factor, 3)} / ${num(z5.recoveryOnly.factor, 3)}）。机制集是曲线上的一个点：最新 AGREE 集在 10 万 / 20 万卡把 g 压到 ${num(z1.sets.latestAgree.recoveryFactorEff, 2)} / ${num(z2.sets.latestAgree.recoveryFactorEff, 2)}，f 升到 ${num(z1.sets.latestAgree.hardwareFactor, 2)} / ${num(z2.sets.latestAgree.hardwareFactor, 2)}（余量）；50 万卡 g = ${num(z5.sets.latestAgree.recoveryFactorEff, 2)} 时 f = ${num(z5.sets.latestAgree.hardwareFactor, 2)}，再加自动尝试 60 s 才回到 f = ${num(z5.levers[0].hardwareFactor, 2)}。</figcaption></figure>
  <details class="tv"><summary>图 1 数据表</summary>${c1.table}</details>
  ${ledgerTable()}
  <figure class="chart c2">${c2.svg}<figcaption>图 2：须削减量 = 基线不可用度 − 1.5 pt；机制集先削减，残余超出预算的部分才是硬件任务。10 万 / 20 万卡最新集的残余已在预算内（硬件可放宽 × ${num(z1.sets.latestAgree.hardwareFactor, 2)} / × ${num(z2.sets.latestAgree.hardwareFactor, 2)}）；50 万卡机制削减 ${pt(z5.sets.latestAgree.removedPts)} pt 后残余 ${pt(z5.sets.latestAgree.unavailability)} pt，超出 ${pt(z5.sets.latestAgree.unavailability - (1 - TARGET))} pt 归硬件（机制 : 硬件 = ${pct(z5.ledgers.latestAgree.mechanismShareOfReduction, 0)} % : ${pct(z5.ledgers.latestAgree.hardwareShareOfReduction, 0)} %）。</figcaption></figure>
  <details class="tv"><summary>图 2 数据表</summary>${c2.table}</details>
  <div class="grid2">
    <div class="box"><h3>分配规则（按顺序）</h3><ol>
      <li><b>先定两端点</b>：仅硬件 f（恢复不变）与仅恢复 g（硬件不变）——它们是等目标线的两个交点，任何方案都落在这条线上：f · g ≈ 常数。</li>
      <li><b>机制先于硬件</b>：就地恢复把 p̄ᵢ 从 ${num(z1.baseline.meanPauseS, 0)} s 压到几十秒，每 pt 削减的工作量最低（10 万卡 ${esc(setLabel(z1.sets.latestAgree.ids))} 削减 ${pt(z1.sets.latestAgree.removedPts)} pt，工作量 ${LZ(100000).agree.effort}；同样的 pt 若靠硬件要全部类 FIT 降到 ${pct(z1.hardwareOnly.factor, 0)} %）。机制集按 AGREE 两阶段或规划器选到名义与降额都达标为止。</li>
      <li><b>残余超出预算的部分给硬件</b>：ARINC 等比（全部类 × f′）或 AGREE 再分配（只改 k′ &gt; 1 的类——50 万卡：${hw5.map((r) => `${dom(r.id)} ×${kf(r.realloc.k)}`).join('、')}，其余 ${18 - hw5.length} 类不动）。AGREE 更便宜，但这几类正是没有梯级覆盖的事件，硬件之外只剩新机制。</li>
      <li><b>硬件改不动时换恢复杠杆</b>：库外参数（自动尝试 60 s、成功率 99.9 %、人工 30 min）在 50 万卡单项 60 s 即达标（${pct(z5.levers[0].aOp)} %，f′ = ${num(z5.levers[0].hardwareFactor, 2)}），三项同时 ${pct(z5.levers[3].aOp)} %。</li>
      <li><b>余量的处置</b>：f′ &gt; 1 时允许 FIT 写成验收限值（供应商 / 运维的最差可接受值），或留作降额与规模增长的裕度——20 万卡最新集的 × ${num(z2.sets.latestAgree.hardwareFactor, 2)} 对应上限 ${Math.round(AG.sets.latest.curves.agree200000.maxN / 1000)}k 卡。</li>
    </ol></div>
    <div class="box"><h3>各规模的数值答案（最新 ReMAP 机制集，A_op 口径）</h3><ul>
      <li><b>1 万卡</b>：基线 ${pct(P[10000].baseline.aOp)} % 已达标；硬件可放宽到 × ${num(P[10000].hardwareOnly.factor, 2)}（CORE 允许 ${num(core.fit * P[10000].hardwareOnly.factor, 0)} FIT），无需机制。</li>
      <li><b>10 万卡</b>：须削减 ${pt(z1.baseline.unavailability - (1 - TARGET))} pt；${esc(setLabel(z1.sets.latestAgree.ids))} 削减 ${pt(z1.sets.latestAgree.removedPts)} pt → 残余 ${pt(z1.sets.latestAgree.unavailability)} pt，余量 ${pt(1 - TARGET - z1.sets.latestAgree.unavailability)} pt；硬件 100 % 由机制替代，允许 FIT × ${num(z1.sets.latestAgree.hardwareFactor, 2)}。</li>
      <li><b>20 万卡</b>：须削减 ${pt(z2.baseline.unavailability - (1 - TARGET))} pt；${z2.sets.latestAgree.ids.length} 项削减 ${pt(z2.sets.latestAgree.removedPts)} pt → 残余 ${pt(z2.sets.latestAgree.unavailability)} pt，余量 ${pt(1 - TARGET - z2.sets.latestAgree.unavailability)} pt；硬件 × ${num(z2.sets.latestAgree.hardwareFactor, 2)}（放宽）；仅原有机制的 AGREE 集则残余 ${pt(z2.sets.remapAgree.unavailability)} pt，硬件须 × ${num(z2.sets.remapAgree.hardwareFactor, 2)}（AGREE：UNKNOWN ×${kf(RZ(200000).classes.find((r) => r.id === 'UNKNOWN-hard').realloc.k)}）。</li>
      <li><b>50 万卡</b>：须削减 ${pt(z5.baseline.unavailability - (1 - TARGET))} pt；12 项削减 ${pt(z5.sets.latestAgree.removedPts)} pt（${pct(z5.ledgers.latestAgree.mechanismShareOfReduction, 0)} %），硬件承担 ${pt(z5.sets.latestAgree.unavailability - (1 - TARGET))} pt（${pct(z5.ledgers.latestAgree.hardwareShareOfReduction, 0)} %）：ARINC 全部类 × ${num(z5.sets.latestAgree.hardwareFactor, 2)}（CORE ${num(core.fit * z5.sets.latestAgree.hardwareFactor, 0)} FIT，集群级 MTBF ${fh(hrs(core.fit * z5.sets.latestAgree.hardwareFactor, 500000))} h），或 AGREE ${hw5.map((r) => `${dom(r.id)} → ${num(r.realloc.allowedFit, 0)} FIT`).join('、')}；或改用自动尝试 60 s。</li>
    </ul></div>
  </div>
  <footer>复现：<code>node --import tsx scripts/agree-allocation-98p5.ts --trials ${AG.trials}</code> → <code>node --import tsx scripts/hardware-mechanism-split-98p5.ts</code> → <code>node scripts/build-hardware-mechanism-split-98p5.mjs</code>。相关报告：REMAP_LATEST_ALLOCATION_98P5_AGREE、REMAP_ALLOCATION_98P5_AGREE、MECHANISM_COMPARISON_98P5_AGREE（AGREE 各类预算与机制集）、REMAP_LATEST_ALLOCATION_98P5（规划器集与杠杆）、ALLOCATION_METHODS_SUMMARY（方法）。事件率为参考目录先验，须以本集群实测替换；"允许 FIT"是验收限值，供应商交付前须用同器件同暴露时长的实测（Garwood 区间）确认。</footer>
</section>
</main>
<script>
(function(){
  function tipFor(el){ var f = el.closest('figure'); if(!f) return null; var t = f.querySelector('.tip'); if(!t){ t = document.createElement('div'); t.className='tip'; f.appendChild(t);} return t; }
  function place(t, f, ev){ var r = f.getBoundingClientRect(); var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14; if (x + 350 > r.width) x = Math.max(0, ev.clientX - r.left - 350); t.style.left = x + 'px'; t.style.top = y + 'px'; }
  document.querySelectorAll('[data-tip]').forEach(function(el){ el.addEventListener('mousemove', function(ev){ var f = el.closest('figure'); var t = tipFor(el); if(!t) return; t.textContent = el.getAttribute('data-tip'); t.style.display='block'; place(t, f, ev); }); el.addEventListener('mouseleave', function(){ var t = tipFor(el); if(t) t.style.display='none'; }); });
})();
</script>
</body>
</html>
`;
writeFileSync(OUT_HTML, html);
console.log(`written ${OUT_HTML} (${(html.length / 1024).toFixed(0)} kB) and two SVGs in ${OUT_DIR}`);
