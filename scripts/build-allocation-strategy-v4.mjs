#!/usr/bin/env node
/**
 * Build docs/ALLOCATION_STRATEGY_V4.{en,zh}.html (four printed A4 pages; two inline SVG charts with tooltips and table views, one
 * flow diagram): how the v4 allocation strategies split a target between hardware FIT and fault-management mechanisms, which
 * mechanism parameters they use, a worked example at the largest built-in scale (A3 · CloudMatrix384, 500,000 NPUs, the default
 * A_op ≥ 98.5 %), the three versions' allocation methods (v3.0 classic, v3.7 study, v4.0 strategies) on the same sixteen cases
 * (four templates × the built-in 10k / 100k / 200k / 500k), which one to use and the best practices.
 * Input: docs/allocation-strategy-v4/results.json (scripts/allocation-strategy-v4-example.ts).
 * Usage: node scripts/build-allocation-strategy-v4.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const D = JSON.parse(readFileSync('docs/allocation-strategy-v4/results.json', 'utf8'));
const OUT_DIR = 'docs/allocation-strategy-v4';
mkdirSync(OUT_DIR, { recursive: true });
const gen = new Date(D.generated).toLocaleDateString('sv-SE'); // local calendar date of the run
const TARGET = D.scenario.target;
const NPUS = D.scenario.npus;
const TPL = D.scenario.template;
const SIZES = D.scenario.sizes;
const V = D.versions;
const EX = V[TPL][NPUS];
const R = D.results;
const S = D.splits;
const B = D.baseline;
const TPLS = ['a3-ub384', 'a2-roce', 'a950-ub2', 'a960e-ub'];
const NCASES = TPLS.length * 4;
const pct = (x, d = 3) => (x * 100).toFixed(d);
const num = (x, d = 2) => Number(x).toFixed(d);
const int = (x) => Math.round(x).toLocaleString('en-US');
const fitf = (x) => (x >= 1000 ? int(x) : x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dom = (id) => id.replace(/-hard(@roce)?$/, (m, r) => (r ? ' (RoCE)' : ''));
const bare = (id) => id.replace(/-hard$/, '');
const years = (fit) => 1e9 / fit / 8760;
const DEFAULT_FLOOR = 0.05;
const agreeFloors = S.agree.hardware.rows.filter((h) => h.atFloor).map((h) => bare(h.id));
const fy = (y) => (y >= 100 ? y.toFixed(0) : y >= 10 ? y.toFixed(1) : y.toFixed(2));
const meetsT = (a, d) => a >= TARGET - 1e-9 && d >= TARGET - 1e-9;
const SPLIT_ORDER = ['minimum-effort', 'arinc', 'agree', 'equal'];
const cheapestV30 = (v30) => SPLIT_ORDER.map((k) => ({ k, ...v30.splits[k] })).filter((x) => x.meets).sort((a, b) => a.effort - b.effort)[0];
const range = (xs, d = 1) => { const lo = Math.min(...xs), hi = Math.max(...xs); return lo.toFixed(d) === hi.toFixed(d) ? lo.toFixed(d) : `${lo.toFixed(d)}–${hi.toFixed(d)}`; };

function build(lang) {
  const zh = lang === 'zh';
  const T = (z, e) => (zh ? z : e);
  const textW = (s) => Array.from(String(s)).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.4), 0);
  const leverName = (id) => ({ auto: T('自动恢复尝试 → 60 s', 'automatic attempt → 60 s'), success: T('自动成功率 → 99.9 %', 'automatic success → 99.9 %'), manual: T('人工恢复 → 30 min', 'manual recovery → 30 min') })[id];
  const leverShort = (id) => ({ auto: T('自动尝试 60 s', 'auto 60 s'), success: T('成功率 99.9 %', 'success 99.9 %'), manual: T('人工 30 min', 'manual 30 min') })[id];
  const leverVal = (id, v) => (id === 'success' ? `${(v * 100).toFixed(1)} %` : v >= 3600 ? `${(v / 3600).toFixed(v % 3600 ? 1 : 0)} h` : v >= 600 ? `${(v / 60).toFixed(0)} min` : `${v} s`);
  const stName = (id) => ({ optimal: T('最优', 'Optimal'), 'mttr-first': T('MTTR 降低优先', 'MTTR reduction preferred'), 'mttf-first': T('MTTF 提升优先', 'MTTF reduction preferred') })[id];
  const splitName = (k) => ({ 'minimum-effort': 'Albert', arinc: 'ARINC', agree: 'AGREE', equal: T('等分', 'equal') })[k];
  const tplName = (t) => ({ 'a3-ub384': 'A3 · CloudMatrix384', 'a2-roce': 'A2 · RoCE', 'a950-ub2': 'Atlas 950', 'a960e-ub': 'Atlas 960E' })[t];
  const mechName = (m) => (zh ? m.name.zh : m.name.en);
  const groupName = (g) => ({ npu: 'NPU', network: T('网络', 'network'), host: T('主机', 'host'), facility: T('设施', 'facility'), storageSoftware: T('存储 / 软件', 'storage / software') })[g] ?? g;
  const fmtParams = (p) => Object.entries(p).map(([k, v]) => `${k} ${Number(v.toFixed ? v.toFixed(4) : v)}`).join(', ');
  const fmtH = (h) => (h < 1 ? `${(h * 60).toFixed(1)} min` : `${h.toFixed(1)} h`);
  const mark = (ok) => (ok ? '✓' : '✕');

  const FONT = zh ? 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' : 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const STYLE = `
svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --ghost:#e4e2dc; --acc:#2f4fb8; --box:#f2f1ec; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --ghost:#34342f; --acc:#9cb0ef; --box:#242421; } }
:root[data-theme="dark"] svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --ghost:#34342f; --acc:#9cb0ef; --box:#242421; }
svg.viz text { fill: var(--ink); font-size: 12px; } svg.viz .t2 { fill: var(--ink2); font-size: 11.5px; } svg.viz .m { fill: var(--muted); font-size: 11px; } svg.viz .tick { font-variant-numeric: tabular-nums; } svg.viz .ttl { font-size: 13px; font-weight: 600; } svg.viz .lab { font-size: 11px; }
svg.viz .grid { stroke: var(--grid); stroke-width: 1; } svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .ref { stroke: var(--ink2); stroke-width: 1.5; } svg.viz .hit { fill: transparent; pointer-events: all; }
svg.viz .bx { fill: var(--box); stroke: var(--axis); } svg.viz .bxa { fill: var(--box); stroke: var(--acc); stroke-width: 1.5; } svg.viz .arr { stroke: var(--ink2); stroke-width: 1.4; fill: none; } svg.viz .arrh { fill: var(--ink2); }
`;
  const svgOpen = (id, W, H, label) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}"><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
  const legendSw = (x, y, items) => { let off = 0; return items.map((it) => { const lx = x + off; off += 24 + textW(it.name) + 16; return it.kind === 'line' ? `<line x1="${lx}" x2="${lx + 16}" y1="${y}" y2="${y}" stroke="${it.color}" stroke-width="2"/><text x="${lx + 22}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="${it.color}"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join(''); };
  // bar with a 4 px rounded data end, square at the baseline (horizontal)
  const hbar = (x, y, w, h, fill, tip, rounded = true) => {
    if (w <= 0.5) return '';
    const r = rounded ? Math.min(4, w / 2, h / 2) : 0;
    const d = r ? `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x}Z` : `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    return `<path d="${d}" fill="${fill}"${tip ? ` data-tip="${esc(tip)}"` : ''}/>`;
  };

  /* ---------- figure 0: one strategy run ---------- */
  function flow() {
    const boxes = [
      { t: T('设计', 'Design'), l: [T('拓扑模板 + 规模 N', 'topology template + N'), T('各单元故障 FIT', 'FIT per unit'), T('默认六项机制', 'six default mechanisms')] },
      { t: T('评估', 'Evaluate'), l: [T('A_op 与正确有效产出', 'A_op and delivered goodput'), T('名义与降额两套参数', 'nominal and derated'), T('cᵢ = λᵢ·p̄ᵢ，预算 B', 'cᵢ = λᵢ·p̄ᵢ, budget B')] },
      { t: T('按策略选择手段', 'Pick moves by strategy'), l: [T('机制（库参数）', 'library mechanisms'), T('恢复杠杆推到上限', 'recovery levers to limits'), T('最优 / MTTR / MTTF 优先', 'optimal / MTTR- / MTTF-first')] },
      { t: T('硬件闭合（水位 L）', 'Hardware closure (level L)'), l: ['xᵢcᵢ = clamp(wᵢL, floorᵢcᵢ, cᵢ)', T('L 由引擎二分', 'L by bisection'), T('工作量 Σ eᵢ log₂(1/xᵢ)', 'effort Σ eᵢ log₂(1/xᵢ)')] },
      { t: T('结果', 'Result'), l: [T('名义与降额都 ≥ 目标', 'nominal and derated ≥ target'), T('各类允许 FIT、总工作量', 'allowed FIT, total effort'), T('余量，或不可行', 'slack, or infeasible')] },
    ];
    const pad = 12, m = 14, by = 34, bh = 108;
    for (const b of boxes) b.w = Math.ceil(Math.max(textW(b.t) * 1.1, ...b.l.map(textW)) + 2 * pad);
    const sumW = boxes.reduce((a, b) => a + b.w, 0);
    const W = Math.max(960, Math.ceil(2 * m + sumW + 24 * (boxes.length - 1)));
    const gap = (W - 2 * m - sumW) / (boxes.length - 1);
    let x = m; for (const b of boxes) { b.x = x; x += b.w + gap; }
    const H = 190;
    let g = svgOpen('fig-flow', W, H, T('一次策略计算的流程', 'One strategy run')) + `<text x="${m}" y="20" class="ttl">${esc(T('图 0 · 一次策略计算', 'Figure 0 · One strategy run'))}</text>`;
    for (const [i, b] of boxes.entries()) {
      g += `<rect x="${b.x}" y="${by}" width="${b.w}" height="${bh}" rx="8" class="${i === 3 ? 'bxa' : 'bx'}"/><text x="${b.x + pad}" y="${by + 20}" style="font-weight:600">${esc(b.t)}</text>`;
      b.l.forEach((l, k) => { g += `<text x="${b.x + pad}" y="${by + 44 + k * 21}" class="t2">${esc(l)}</text>`; });
      if (i < boxes.length - 1) { const x1 = b.x + b.w + 3, x2 = boxes[i + 1].x - 3; g += `<line x1="${x1}" x2="${x2 - 5}" y1="${by + bh / 2}" y2="${by + bh / 2}" class="arr"/><path d="M${x2 - 7} ${by + bh / 2 - 5} L${x2} ${by + bh / 2} L${x2 - 7} ${by + bh / 2 + 5} Z" class="arrh"/>`; }
    }
    const c2 = boxes[2].x + boxes[2].w / 2, c3 = boxes[3].x + boxes[3].w / 2, yb = by + bh;
    g += `<path d="M${c3} ${yb + 2} V${yb + 18} H${c2} V${yb + 9}" class="arr"/><path d="M${c2 - 5} ${yb + 10} L${c2} ${yb + 2} L${c2 + 5} ${yb + 10} Z" class="arrh"/>`;
    g += `<text x="${c2}" y="${yb + 34}" class="m">${esc(T('MTTF 优先：硬件到下限仍不够 → 先加机制，再放宽硬件', 'MTTF-first: floors not enough → add mechanisms, then relax the hardware'))}</text>`;
    return g + '</svg>';
  }

  /* ---------- figure 1: the hardware split (water-filling) ---------- */
  function figSplit() {
    const rows = S['min-effort'].hardware.rows.slice().sort((a, b) => b.pointsBefore - a.pointsBefore).slice(0, 13);
    const level = rows.filter((r) => r.factor < 1 && !r.atFloor)[0]?.pointsAfter ?? 0;
    const W = 960, L = 170, Rm = 170, Tp = 62, rowH = 23, H = Tp + rows.length * rowH + 26;
    const pw = W - L - Rm;
    const max = Math.max(...rows.map((r) => r.pointsBefore)) * 1.05;
    const xs = (v) => L + (v / max) * pw;
    const step = [0.0005, 0.001, 0.0025, 0.005].find((st) => max / st <= 6);
    let g = svgOpen('fig-split', W, H, T('最小工作量硬件分配的水位图', 'Water-filling of the minimum-effort hardware split')) + `<text x="14" y="20" class="ttl">${esc(T('图 1 · 仅硬件、最小工作量：每类不可用点数削到同一水位 L（受下限约束的类停在下限）', 'Figure 1 · Hardware only, minimum effort: every class above the level L is cut down to it (or to its floor)'))}</text>`;
    g += legendSw(14, 42, [{ name: T('当前 FIT 下的贡献', 'contribution with today’s FIT'), color: 'var(--ghost)' }, { name: T('允许 FIT 下的贡献', 'contribution with the allowed FIT'), color: 'var(--s1)' }, { name: T(`水位 L = ${num(level * 100, 4)} pt`, `level L = ${num(level * 100, 4)} pt`), color: 'var(--ink2)', kind: 'line' }]);
    g += `<text x="${W - Rm + 10}" y="${Tp - 6}" class="m">${esc(T('x · FIT 当前 → 允许', 'x · FIT now → allowed'))}</text>`;
    for (let v = 0; v <= max; v += step) { const x = xs(v); g += `<line x1="${x}" x2="${x}" y1="${Tp - 2}" y2="${Tp + rows.length * rowH}" class="grid"/><text x="${x}" y="${Tp + rows.length * rowH + 16}" text-anchor="middle" class="m tick">${(v * 100).toFixed(2)} pt</text>`; }
    rows.forEach((r, i) => {
      const y = Tp + i * rowH;
      const tip = `${r.id} · ${T('单元', 'units')} ${int(r.count)}\n${T('当前', 'now')} ${fitf(r.currentFit)} FIT → ${T('允许', 'allowed')} ${fitf(r.allowedFit)} FIT (×${num(r.factor, 3)}${r.atFloor ? T('，到下限', ', at the floor') : ''})\n${T('不可用点数', 'unavailability points')} ${num(r.pointsBefore * 100, 4)} → ${num(r.pointsAfter * 100, 4)} pt · ${T('工作量', 'effort')} ${num(r.effort, 2)}`;
      g += `<text x="${L - 8}" y="${y + 15}" text-anchor="end" class="lab">${esc(dom(r.id))}</text>`;
      g += hbar(L, y + 4, xs(r.pointsBefore) - L, 14, 'var(--ghost)', tip);
      g += hbar(L, y + 4, Math.max(1, xs(r.pointsAfter) - L), 14, 'var(--s1)', tip);
      g += `<rect x="${L}" y="${y}" width="${W - L - 10}" height="${rowH}" class="hit" data-tip="${esc(tip)}"/>`;
      g += `<text x="${W - Rm + 10}" y="${y + 15}" class="t2 tick">${r.factor < 1 ? `×${num(r.factor, 2)} · ${fitf(r.currentFit)} → ${fitf(r.allowedFit)}${r.atFloor ? esc(T('（下限）', ' (floor)')) : ''}` : esc(T('不变', 'unchanged'))}</text>`;
    });
    const xl = xs(level);
    g += `<line x1="${xl}" x2="${xl}" y1="${Tp - 2}" y2="${Tp + rows.length * rowH + 4}" class="ref"/>`;
    const table = `<table class="tv"><tr><th>${T('类', 'Class')}</th><th class="num">${T('单元数', 'Units')}</th><th class="num">${T('当前 FIT', 'FIT now')}</th><th class="num">${T('允许 FIT', 'Allowed FIT')}</th><th class="num">x</th><th class="num">${T('点数前', 'Points before')}</th><th class="num">${T('点数后', 'Points after')}</th></tr>${rows.map((r) => `<tr><td>${esc(r.id)}</td><td class="num">${int(r.count)}</td><td class="num">${fitf(r.currentFit)}</td><td class="num">${fitf(r.allowedFit)}</td><td class="num">${num(r.factor, 3)}</td><td class="num">${num(r.pointsBefore * 100, 4)}</td><td class="num">${num(r.pointsAfter * 100, 4)}</td></tr>`).join('')}</table>`;
    return { svg: g + '</svg>', table, level };
  }

  /* ---------- figure 2: the three versions on the example case ---------- */
  function figEffort() {
    const v30 = EX.v30.splits, v37 = EX.v37;
    const meets = (a, d) => `${mark(a >= TARGET - 1e-9)} / ${mark(d >= TARGET - 1e-9)}`;
    const moveList = (r) => `${r.mechanisms.join(' + ')} + ${r.levers.map(leverShort).join(' + ')}`;
    const v4r = (st, name) => ({ grp: 'v4', name, m: R[st].effort.mechanisms, l: R[st].effort.levers, h: R[st].effort.hardware, ok: meets(R[st].final.value, R[st].final.derated), short: R[st].mechanisms.length + R[st].levers.length ? T(`${R[st].mechanisms.length} 项机制 + ${R[st].levers.length} 项杠杆 + 硬件 ${R[st].hardware.rows.filter((h) => h.factor < 1).length} 类`, `${R[st].mechanisms.length} mechanisms + ${R[st].levers.length} levers + ${R[st].hardware.rows.filter((h) => h.factor < 1).length} hw classes`) : T(`仅硬件 ${R[st].hardware.rows.filter((h) => h.factor < 1).length} 类`, `hardware only, ${R[st].hardware.rows.filter((h) => h.factor < 1).length} classes`), note: R[st].mechanisms.length + R[st].levers.length ? moveList(R[st]) : T('仅硬件，最小工作量分配（降额设计上闭合）', 'hardware only, minimum-effort split (closed on the derated design)') });
    const v30r = (k) => ({ grp: 'v30', name: `v3.0 · ${splitName(k)}`, m: 0, l: 0, h: v30[k].effort, ok: meets(v30[k].aOp, v30[k].aOpDerated), short: T(`${v30[k].improved} 类降低，结果 ${pct(v30[k].aOp, 2)} %`, `${v30[k].improved} classes cut, gives ${pct(v30[k].aOp, 2)} %`), note: T(`一阶预算 λ* = ${num(EX.v30.lambdaStar, 3)} /h（全局恢复 ${num(EX.v30.recoveryS, 1)} s），按 ${splitName(k)} 拆到各类故障率`, `first-order budget λ* = ${num(EX.v30.lambdaStar, 3)} /h (global recovery ${num(EX.v30.recoveryS, 1)} s), split over the class rates by ${splitName(k)}`) });
    const rows = [
      v4r('optimal', T('v4.0 · 最优', 'v4.0 · Optimal')),
      v4r('mttr-first', T('v4.0 · MTTR 降低优先', 'v4.0 · MTTR preferred')),
      v4r('mttf-first', T('v4.0 · MTTF 提升优先', 'v4.0 · MTTF preferred')),
      { grp: 'v4', name: T('v4.0 · 仅硬件 AGREE', 'v4.0 · hardware, AGREE'), m: 0, l: 0, h: S.agree.effort.hardware, ok: meets(S.agree.final.value, S.agree.final.derated), short: T(`${agreeFloors.join('、')} 到下限`, `${agreeFloors.join(', ')} at the floor`), note: T(`权重 = 单元数 × 重要度；${agreeFloors.join('、')} 到下限 ×${DEFAULT_FLOOR}`, `weight = units × importance; ${agreeFloors.join(', ')} at the ×${DEFAULT_FLOOR} floor`) },
      { grp: 'v4', name: T('v4.0 · 仅硬件 ARINC', 'v4.0 · hardware, ARINC'), m: 0, l: 0, h: S.arinc.effort.hardware, ok: meets(S.arinc.final.value, S.arinc.final.derated), short: T(`全部类 ×${num(D.uniform.hardwareDerated, 3)}`, `every class ×${num(D.uniform.hardwareDerated, 3)}`), note: T(`全部类同一倍数 ×${num(D.uniform.hardwareDerated, 3)}（降额设计）`, `one factor ×${num(D.uniform.hardwareDerated, 3)} for every class (derated design)`) },
      { grp: 'v37', name: T('v3.7 · 研究', 'v3.7 · study'), m: v37.effort.mechanisms, l: 0, h: v37.effort.hardware, ok: meets(v37.aOp, v37.aOpDerated), short: `${v37.plan.ids.join(' + ')} + ${T('全部类', 'all classes')} ×${num(v37.hardwareFactor, 2)}`, note: T(`规划器最佳组合 ${v37.plan.ids.join(' + ')}（不达标：${pct(v37.plan.nominal, 2)} / ${pct(v37.plan.derated, 2)} %），再对全部 ${v37.hardwareClasses} 类统一 ×${num(v37.hardwareFactor, 3)}；自身检查（只降额新增机制）达标，统一检查降额 ${pct(v37.aOpDerated, 2)} %`, `planner's best set ${v37.plan.ids.join(' + ')} (short: ${pct(v37.plan.nominal, 2)} / ${pct(v37.plan.derated, 2)} %), then one factor ×${num(v37.hardwareFactor, 3)} on all ${v37.hardwareClasses} classes; meets its own check (added mechanisms derated only), derated ${pct(v37.aOpDerated, 2)} % on the common check`) },
      v30r('minimum-effort'), v30r('arinc'), v30r('agree'), v30r('equal'),
    ];
    const W = 960, L = 200, Tp = 66, rowH = 25, sepGap = 10;
    const okHead = T('名义 / 降额', 'nominal / derated'), colOk = Math.max(64, Math.ceil(textW(okHead) + 14)), Rm = Math.ceil(colOk + Math.max(...rows.map((r) => textW(r.short))) + 24);
    const gOff = { v4: 0, v37: sepGap, v30: 2 * sepGap };
    const H = Tp + rows.length * rowH + 2 * sepGap + 30;
    const pw = W - L - Rm;
    const maxTot = Math.max(...rows.map((r) => r.m + r.l + r.h));
    const max = Math.ceil((maxTot * (1 + (textW(num(maxTot, 1)) + 14) / pw)) / 20) * 20;
    const xs = (v) => L + (v / max) * pw;
    const yOf = (i) => Tp + i * rowH + gOff[rows[i].grp];
    let g = svgOpen('fig-effort', W, H, T('同一算例下三个版本方法的总工作量', 'Total effort of the three versions’ methods on the same case')) + `<text x="14" y="20" class="ttl">${esc(T(`图 2 · 同一缺口（${tplName(TPL)}，${int(NPUS)} NPU，A_op ≥ ${pct(TARGET, 1)} %）的总工作量：v4.0、v3.7、v3.0`, `Figure 2 · Total effort to close the same gap (${tplName(TPL)}, ${int(NPUS)} NPUs, A_op ≥ ${pct(TARGET, 1)} %): v4.0, v3.7, v3.0`))}</text>`;
    g += legendSw(14, 44, [{ name: T('机制', 'mechanisms'), color: 'var(--s1)' }, { name: T('恢复杠杆', 'recovery levers'), color: 'var(--s2)' }, { name: T('硬件 Σ e·log₂(1/x)', 'hardware Σ e·log₂(1/x)'), color: 'var(--s3)' }]);
    g += `<text x="${W - Rm + 12}" y="${Tp - 8}" class="m">${esc(okHead)}</text><text x="${W - Rm + 12 + colOk}" y="${Tp - 8}" class="m">${esc(T('手段', 'moves'))}</text>`;
    const yEnd = yOf(rows.length - 1) + rowH;
    for (let v = 0; v <= max; v += 20) { const x = xs(v); g += `<line x1="${x}" x2="${x}" y1="${Tp - 2}" y2="${yEnd}" class="grid"/><text x="${x}" y="${yEnd + 16}" text-anchor="middle" class="m tick">${v}</text>`; }
    rows.forEach((r, i) => {
      const y = yOf(i);
      const tot = r.m + r.l + r.h;
      const tip = `${r.name}\n${T('机制', 'mechanisms')} ${num(r.m, 1)} + ${T('杠杆', 'levers')} ${num(r.l, 1)} + ${T('硬件', 'hardware')} ${num(r.h, 2)} = ${num(tot, 2)}\n${T('达标（名义 / 降额）', 'meets (nominal / derated)')} ${r.ok}\n${r.note}`;
      g += `<text x="${L - 8}" y="${y + 16}" text-anchor="end" class="lab">${esc(r.name)}</text>`;
      let x = L;
      const segs = [[r.m, 'var(--s1)'], [r.l, 'var(--s2)'], [r.h, 'var(--s3)']].filter(([v]) => v > 0);
      segs.forEach(([v, c], k) => { const w = xs(v) - L; g += hbar(x, y + 5, Math.max(0, w - (k < segs.length - 1 ? 2 : 0)), 15, c, tip, k === segs.length - 1); x += w; });
      g += `<text x="${x + 6}" y="${y + 16}" class="t2 tick">${num(tot, 1)}</text>`;
      g += `<rect x="${L}" y="${y}" width="${W - L - 10}" height="${rowH}" class="hit" data-tip="${esc(tip)}"/>`;
      g += `<text x="${W - Rm + 12}" y="${y + 16}" class="t2">${esc(r.ok)}</text><text x="${W - Rm + 12 + colOk}" y="${y + 16}" class="t2">${esc(r.short)}</text>`;
    });
    for (const i of [5, 6]) { const ySep = yOf(i) - sepGap / 2; g += `<line x1="14" x2="${W - 14}" y1="${ySep}" y2="${ySep}" class="axis"/>`; }
    const table = `<table class="tv"><tr><th>${T('方法', 'Method')}</th><th class="num">${T('机制', 'Mechanisms')}</th><th class="num">${T('杠杆', 'Levers')}</th><th class="num">${T('硬件', 'Hardware')}</th><th class="num">${T('合计', 'Total')}</th><th>${T('达标 名义 / 降额', 'Meets nominal / derated')}</th><th>${T('说明', 'Note')}</th></tr>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${num(r.m, 1)}</td><td class="num">${num(r.l, 1)}</td><td class="num">${num(r.h, 2)}</td><td class="num">${num(r.m + r.l + r.h, 2)}</td><td>${esc(r.ok)}</td><td>${esc(r.note)}</td></tr>`).join('')}</table>`;
    return { svg: g + '</svg>', table, rows };
  }

  const f0 = flow(), f1 = figSplit(), f2 = figEffort();
  writeFileSync(`${OUT_DIR}/fig0-flow.${lang}.svg`, f0);
  writeFileSync(`${OUT_DIR}/fig1-split.${lang}.svg`, f1.svg);
  writeFileSync(`${OUT_DIR}/fig2-effort.${lang}.svg`, f2.svg);

  const bn = B.nominal, bd = B.derated;
  const cut = 1 - B.budgetB / B.sumC;
  const top = D.classes.slice(0, 9);
  const noRung = D.classes.filter((c) => c.pGlobal > 0.99);
  const noRungShare = noRung.reduce((a, c) => a + c.share, 0);
  const opt = R.optimal, mttr = R['mttr-first'], mttf = R['mttf-first'];
  const core = D.classes.find((c) => c.id === 'CORE-hard');
  const nSubsets = 2 ** (D.moves.candidates.length + D.moves.levers.length);
  const hwUnk = mttf.hardware.rows.find((h) => h.id === 'UNKNOWN-hard'), hwPow = mttf.hardware.rows.find((h) => h.id === 'POWER-hard');
  const mttfFloors = mttf.hardware.rows.filter((h) => h.atFloor).map((h) => bare(h.id));
  const mttfImproved = mttf.hardware.rows.filter((h) => h.factor < 1).length;
  const iSlow = mttr.steps.findIndex((st) => st.id === 'D-SLOW');
  const slowGain = iSlow > 0 ? mttr.steps[iSlow].derated - mttr.steps[iSlow - 1].derated : 0;
  const stepsTable = (r) => `<div class="table-wrap"><table class="dense"><tr><th>#</th><th>${T('步骤', 'Step')}</th><th class="num">${T('工作量', 'Effort')}</th><th class="num">${T('名义 A_op', 'Nominal A_op')}</th><th class="num">${T('降额 A_op', 'Derated A_op')}</th></tr>${r.steps.map((st, i) => `<tr><td>${i + 1}</td><td>${st.kind === 'lever' ? esc(leverName(st.id)) : st.kind === 'hardware' ? esc(T('硬件闭合（最小工作量）', 'hardware closure (minimum effort)')) : `<code>${esc(st.id)}</code>`}</td><td class="num">${num(st.effort, 2)}</td><td class="num">${pct(st.value)} %</td><td class="num">${pct(st.derated)} %</td></tr>`).join('')}</table></div>`;
  const hwTable = (r) => `<div class="table-wrap"><table class="dense"><tr><th>${T('类', 'Class')}</th><th class="num">${T('单元', 'Units')}</th><th class="num">${T('当前 FIT / 单元', 'FIT now / unit')}</th><th class="num">${T('允许 FIT', 'Allowed')}</th><th class="num">x</th><th class="num">${T('允许 MTBF（年 / 单元）', 'Allowed MTBF (years / unit)')}</th><th class="num">${T('工作量', 'Effort')}</th></tr>${r.hardware.rows.filter((h) => h.factor < 1).sort((a, b) => a.factor - b.factor).map((h) => `<tr><td><code>${esc(h.id)}</code></td><td class="num">${int(h.count)}</td><td class="num">${fitf(h.currentFit)}</td><td class="num"><b>${fitf(h.allowedFit)}</b></td><td class="num">${num(h.factor, 3)}</td><td class="num">${fy(years(h.allowedFit))}</td><td class="num">${num(h.effort, 2)}</td></tr>`).join('')}</table></div>`;
  // cross-scale cells of the v4 strategies (the example's template)
  const v4cell = (r) => {
    if (r.slack && r.effort.total === 0) return T(`余量 ×${num(r.slack, 1)}`, `slack ×${num(r.slack, 1)}`);
    const mv = [...r.mechanisms, ...r.levers.map(leverShort)].join(' + ');
    const hw = r.effort.hardware > 0 ? `${T('硬件', 'hardware')} ${num(r.effort.hardware, 2)}${r.top?.length && !mv ? ` (${r.top.map((h) => `${bare(h.id)} ×${num(h.factor, 2)}`).join(', ')})` : ''}` : '';
    return `${esc([mv, hw].filter(Boolean).join(' + '))}${r.slack && r.effort.total > 0 ? ` (${T('余量', 'slack')} ×${num(r.slack, 2)})` : ''} · <b>${num(r.effort.total, 2)}</b>${r.feasible ? '' : ` ${T('不可行', 'infeasible')}`}`;
  };
  const crossRows = ['optimal', 'mttr-first', 'mttf-first'].map((st) => `<tr><td class="k">${esc(stName(st))}</td>${SIZES.map((n) => `<td>${v4cell(V[TPL][n].v4[st])}</td>`).join('')}</tr>`).join('');
  const base200 = V[TPL][200000], base500 = V[TPL][500000];
  // versions table across the cases (templates × built-in scales)
  const vRows = TPLS.map((t) => {
    const cells = (f) => SIZES.map((n) => `<td class="num">${f(V[t][n])}</td>`).join('');
    const b = cells((r) => `${pct(r.baseline.aOp, 2)} / ${pct(r.baseline.aOpDerated, 2)}`);
    const c30 = cells((r) => { const c = cheapestV30(r.v30); return c ? `${num(c.effort, 1)} ${mark(true)} <span class="small">${splitName(c.k)}</span>` : `— ${mark(false)}`; });
    const c37 = cells((r) => `${num(r.v37.effort.total, 1)} ${mark(r.v37.meets)}${!r.v37.meets ? '*' : ''}`);
    const c4 = cells((r) => `<b>${num(r.v4.optimal.effort.total, 2)}</b> ${mark(r.v4.optimal.feasible && meetsT(r.v4.optimal.aOp, r.v4.optimal.aOpDerated))}`);
    return `<tr class="tg"><td class="k" rowspan="4">${esc(tplName(t))}</td><td>${T('基线 A_op 名义 / 降额 (%)', 'baseline A_op nominal / derated (%)')}</td>${b}</tr><tr><td>${T('v3.0 经典（达标的最便宜拆分）', 'v3.0 classic (cheapest split that meets)')}</td>${c30}</tr><tr><td>${T('v3.7 研究（规划器 + 统一硬件因子）', 'v3.7 study (planner + uniform hardware)')}</td>${c37}</tr><tr><td>${T('v4.0 最优', 'v4.0 optimal')}</td>${c4}</tr>`;
  }).join('');
  // facts for the verdict
  const all = TPLS.flatMap((t) => SIZES.map((n) => ({ t, n, r: V[t][n] })));
  const at = (n) => all.filter((x) => x.n === n);
  const v4ok = all.every((x) => x.r.v4.optimal.feasible && meetsT(x.r.v4.optimal.aOp, x.r.v4.optimal.aOpDerated));
  const v37miss = all.filter((x) => !x.r.v37.meets);
  const v37gap = v37miss.map((x) => (TARGET - x.r.v37.aOpDerated) * 100);
  const e500 = { v4: at(500000).map((x) => x.r.v4.optimal.effort.total), v37: at(500000).map((x) => x.r.v37.effort.total), v30: at(500000).map((x) => cheapestV30(x.r.v30).effort), v30max: at(500000).map((x) => Math.max(...SPLIT_ORDER.map((k) => x.r.v30.splits[k].effort))) };
  const e100 = { v30: at(100000).map((x) => cheapestV30(x.r.v30).effort), v30max: at(100000).map((x) => Math.max(...SPLIT_ORDER.map((k) => x.r.v30.splits[k].effort))) };
  const fo = EX.v30.firstOrderAOp;
  const ms = { v4: all.map((x) => x.r.v4.optimal.ms), v37: all.map((x) => x.r.v37.ms), v30: all.map((x) => x.r.v30.ms) };
  const a200 = base200.v4;

  const html = `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T('v4 分配策略', 'v4 allocation strategy')}</title>
<meta name="description" content="${esc(T(`HAC-D v4 如何在硬件 FIT 与故障管理机制之间分配可用率目标：三类手段、三种策略、硬件水位分配、所用机制参数、${int(NPUS)} NPU 算例，以及 v3.0 / v3.7 / v4.0 分配方法在 10k–500k 上的对比与最佳实践。`, `How HAC-D v4 splits an availability target between hardware FIT and fault-management mechanisms: three kinds of moves, three strategies, the water-filling hardware split, the mechanism parameters used, a ${int(NPUS)}-NPU worked example, and the v3.0 / v3.7 / v4.0 allocation methods compared at 10k–500k with best practices.`))}">
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
  td.k { white-space: nowrap; font-weight: 500; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.tg td { border-top: 1.5px solid var(--muted); }
  figure.chart { margin: 8px 0 10px; position: relative; } figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  details.tv { margin: -2px 0 10px; font-size: 11.5px; overflow-x: auto; } details.tv summary { cursor: pointer; color: var(--accent); }
  table.tv { font-size: 11px; } table.tv th, table.tv td { padding: 2px 5px; }
  .tip { position: absolute; z-index: 5; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 11.5px; line-height: 1.4; padding: 6px 9px; border-radius: 6px; white-space: pre-line; max-width: 360px; box-shadow: 0 2px 8px rgba(0,0,0,.25); display: none; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  .formula { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 6px 0; font-size: 12.2px; }
  .verdict { border-left: 3px solid var(--ok); background: var(--surface-2); padding: 7px 11px; border-radius: 0 6px 6px 0; margin: 6px 0 8px; font-size: 12.4px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
  .box { background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; padding: 7px 11px; } .box h3 { margin: 0 0 4px; font-size: 12.5px; } .box ol, .box ul { margin: 2px 0; padding-left: 16px; } .box li { margin: 2px 0; font-size: 12px; }
  ol.bp { margin: 4px 0 6px; padding-left: 20px; } ol.bp li { margin: 3px 0; }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 6px 0 8px; }
  .kpi { background: var(--surface-2); border-radius: 6px; padding: 6px 10px; } .kpi .l { font-size: 11px; color: var(--muted); } .kpi .v { font-size: 18px; font-weight: 600; } .kpi .n { font-size: 11px; color: var(--muted); }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; overflow-wrap: anywhere; }
  @media screen and (max-width: 760px) { .grid2 { grid-template-columns: minmax(0, 1fr); } .kpis { grid-template-columns: 1fr 1fr; } .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 560px; } figure.chart { overflow-x: auto; } figure.chart svg { min-width: 720px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.8px; line-height: 1.36; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7.6px; line-height: 1.28; } th, td { padding: 1.2px 2.5px; } th { font-size: inherit; } table.dense { font-size: 7.3px; line-height: 1.22; } table.dense th, table.dense td { padding: 0.8px 2px; }
    code { font-size: 7.4px; } .small { font-size: 7.3px; } .callout, .formula, .verdict, .sub, footer { font-size: 7.9px; } .callout, .formula, .verdict { margin: 3px 0; padding: 3px 7px; } footer { font-size: 7.2px; }
    .box { padding: 3px 7px; } .box h3 { font-size: 8.6px; margin-bottom: 2px; } .box li { font-size: 7.8px; margin: 1px 0; } .box ol, .box ul { padding-left: 11px; } .grid2 { gap: 4px 10px; } ol.bp li { margin: 1px 0; } ol.bp { padding-left: 14px; }
    .kpis { gap: 4px; margin: 3px 0; } .kpi { padding: 2px 6px; } .kpi .v { font-size: 11px; } .kpi .l, .kpi .n { font-size: 7.2px; }
    h1 { font-size: 14px; margin: 2px 0 3px; } h2 { font-size: 10.5px; margin: 4px 0 2px; padding-top: 3px; } h3 { font-size: 9px; margin: 3px 0 1px; } .eyebrow { font-size: 7.5px; }
    figure.chart { margin: 2px 0 2px; } figcaption { font-size: 7.2px; margin-top: 0; } details.tv { display: none; } .tip { display: none !important; }
    p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    figure.chart.f0 svg { height: 150px; } figure.chart.f1 svg { height: 272px; } figure.chart.f2 svg { height: 262px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D v4 · ${T('分配策略：硬件 FIT 与机制', 'Allocation strategy: hardware FIT and mechanisms')} · ${gen} · ${T('第 1 / 4 页', 'page 1 / 4')}</div>
  <h1>${T(`v4 怎样在硬件故障率与可靠性机制之间分配目标——原理、所用参数、${int(NPUS)} NPU 算例与三个版本方法的对比`, `How v4 splits a target between hardware failure rates and reliability mechanisms — method, parameters used, a ${int(NPUS)}-NPU example and the three versions compared`)}</h1>
  <p class="sub"><b>${T('口径', 'Basis')}</b>：${T(`A_op = 30 天作业窗口内的运行时间占比，目标为方案默认的 ${pct(TARGET, 1)} %；须在<b>名义参数</b>与<b>降额参数</b>（覆盖率 −5 pt，成功率 / 召回率 / 精确率 −8 pt，时间与开销 ×1.5，物理机制的降率 ×0.5；作用于方案自身机制、候选机制与杠杆）下同时满足。FIT 为既有保护之后的业务影响事件率（每单元 10⁹ 小时），由 54 事件参考目录按 CloudMatrix384 几何换算到各硬件单元（假设值）。内置规模为 10k / 100k / 200k / 500k NPU。代码：<code>packages/core/src/strategy/index.ts</code>；本文数字由 <code>scripts/allocation-strategy-v4-example.ts</code> 在引擎上计算。`, `A_op = running-time share over the 30-day job window, target the scenario default ${pct(TARGET, 1)} %; it must hold with <b>nominal</b> and with <b>derated</b> parameters (coverage −5 pt; success, recall and precision −8 pt; times and overheads ×1.5; rate reductions of physical mechanisms ×0.5 — applied to the scenario's own mechanisms, the candidates and the levers). FIT = business-impact events per 10⁹ unit-hours after the existing protection, converted from the 54-event reference catalog to hardware units under the CloudMatrix384 geometry (assumed values). Built-in scales: 10k / 100k / 200k / 500k NPUs. Code: <code>packages/core/src/strategy/index.ts</code>; every number here is computed on the engine by <code>scripts/allocation-strategy-v4-example.ts</code>.`)}</p>
  <h2 class="first">${T('1. 分配什么：三类手段与一个工作量尺度', '1. What is allocated: three kinds of moves on one effort scale')}</h2>
  <div class="table-wrap"><table>
    <tr><th>${T('手段', 'Move')}</th><th>${T('改变的量', 'What it changes')}</th><th>${T('参数从哪来', 'Where its parameters come from')}</th><th>${T('工作量', 'Effort')}</th></tr>
    <tr><td class="k">${T('机制（候选）', 'Mechanisms (candidates)')}</td><td>${T('加入机制库中的一项机制（检测、恢复梯级、检查点）；默认候选 D-HARD、D-SLOW、P-PREDICT、R-NETFAIL、R-HOTSWAP、C-MEM，叠加在方案已有的六项默认机制之上', 'adds a library mechanism (detection, recovery rung, checkpointing); default candidates D-HARD, D-SLOW, P-PREDICT, R-NETFAIL, R-HOTSWAP, C-MEM, on top of the six default mechanisms the scenario already has')}</td><td>${T('机制库的目标参数（或用户在机制页的修改）——<b>按原值使用，不做优化</b>；可行性检查时再按降额规则变差', 'the library target parameters (or the user’s edits on the Mechanisms page) — <b>used as given, not optimised</b>; derated by the rule for the feasibility check')}</td><td>${T('库中工作量分数 1–5', 'library effort score 1–5')}</td></tr>
    <tr><td class="k">${T('恢复杠杆', 'Recovery levers')}</td><td>${T('把 MTTR 混合模型的三项参数推到上限：自动尝试 180 → 60 s、自动成功率 99 → 99.9 %、人工恢复 2 h → 30 min', 'moves three parameters of the MTTR mixture to a limit: automatic attempt 180 → 60 s, automatic success 99 → 99.9 %, manual recovery 2 h → 30 min')}</td><td>${T('上限为可编辑的假设；降额后的上限不会差于当前值（60 s → 90 s、30 min → 45 min、99.9 % → 91.9 % 取当前 99 %）', 'limits are editable assumptions; the derated limit is never worse than today (60 s → 90 s, 30 min → 45 min, 99.9 % → 91.9 %, i.e. today’s 99 %)')}</td><td>${T('3 / 3 / 2（假设）', '3 / 3 / 2 (assumed)')}</td></tr>
    <tr><td class="k">${T('硬件', 'Hardware')}</td><td>${T('每个故障类的<b>中断</b> FIT × xᵢ，xᵢ ∈ [下限ᵢ, 1]；亚健康与静默错误率不变', 'the <b>interruption</b> FIT of each fault class × xᵢ, xᵢ ∈ [floorᵢ, 1]; sub-health and silent-corruption rates stay')}</td><td>${T('下限（默认 0.05，即最多改善 20 倍）、每减半工作量 eᵢ（默认 2）、固定类，保存在方案的 <code>component.allocation.minLambdaFactor</code> / <code>effortPerHalving</code> / <code>fixed</code> 中', 'floor (default 0.05, at most 20× better), effort per halving eᵢ (default 2), fixed classes — stored in the scenario as <code>component.allocation.minLambdaFactor</code> / <code>effortPerHalving</code> / <code>fixed</code>')}</td><td>Σ eᵢ · log₂(1/xᵢ)</td></tr>
  </table></div>
  <figure class="chart f0">${f0}<figcaption>${T('图 0：每种策略都经过同样的流程，区别只在“按策略选择手段”一步（第 2 节）；硬件总是最后一步，按水位规则闭合剩余缺口。cᵢ 为第 i 类每小时造成的暂停秒数（事件率 × 其机制链每次事件的平均暂停）；可行 ⇔ 名义参数与降额参数下目标都满足。', 'Figure 0: every strategy runs the same pipeline and differs only in the “pick moves” step (section 2); hardware always comes last and closes the remaining gap by the level rule. cᵢ = pause seconds per hour caused by class i (rate × mean pause per event of its mechanism chain); feasible ⇔ the target holds with nominal and with derated parameters.')}</figcaption></figure>
  <h2>${T('2. 三种策略与硬件分配规则', '2. The three strategies and the hardware split')}</h2>
  <div class="table-wrap"><table>
    <tr><th>${T('策略', 'Strategy')}</th><th>${T('规则', 'Rule')}</th><th>${T('适用', 'Use when')}</th></tr>
    <tr><td class="k">${T('最优', 'Optimal')}</td><td>${T('在候选手段的所有子集上求“机制 + 杠杆 + 硬件”总工作量最小（A_op：≤ 10 个手段精确枚举，硬件水位用闭式求出，最终方案再用引擎确认；正确有效产出：≤ 6 个精确，超过则按总工作量贪心下降）；最便宜的若干方案作为备选列出', 'least total effort (mechanisms + levers + hardware) over all subsets of the candidate moves (A_op: exact enumeration up to 10 moves, the hardware level in closed form, the chosen plan confirmed on the engine; delivered goodput: exact up to 6, greedy descent on the total effort beyond); the cheapest plans are listed as alternatives')}</td><td>${T('工作量分数可信、想要最省的组合', 'the effort scores are trusted and the cheapest combination is wanted')}</td></tr>
    <tr><td class="k">${T('MTTR 降低优先', 'MTTR reduction preferred')}</td><td>${T('先恢复侧：只在非物理类手段（检测、恢复、检查点机制与三项杠杆）中，每一步加入“约束值（名义与降额中较低者）增益 / 工作量”最大的一项，直到目标满足或不再有任何增益；剩余缺口交给硬件', 'recovery side first: among the non-physical moves only (detection, recovery and checkpoint mechanisms, the three levers), add at each step the one with the largest gain of the binding value (the lower of nominal and derated) per effort until the target holds or nothing gains; the remaining gap goes to hardware')}</td><td>${T('硬件改动慢或贵、软件与运维先行', 'hardware changes are slow or expensive; software and operations go first')}</td></tr>
    <tr><td class="k">${T('MTTF 提升优先', 'MTTF reduction preferred')}</td><td>${T('先硬件：在不加机制的情况下用硬件闭合；若各类到下限仍不够，则在硬件处于下限时先加入物理类机制（如 H-LEMON、H-SWEEP，默认候选中没有），再加恢复侧手段，最后把硬件放宽到刚好达标', 'hardware first: close the gap with hardware alone; if the floors are not enough, add physical mechanisms (e.g. H-LEMON, H-SWEEP; none among the default candidates) and then recovery-side moves with the hardware held at its floors, then relax the hardware back to just meeting the target')}</td><td>${T('硬件方案尚可调整（选型、供应商要求）', 'the hardware design is still open (selection, supplier requirements)')}</td></tr>
  </table></div>
  <div class="formula">${T('<b>硬件分配（水位规则）</b>：对一个水位 L，xᵢ·cᵢ = clamp(wᵢ·L, 下限ᵢ·cᵢ, cᵢ)，cᵢ = λᵢ·p̄ᵢ 是第 i 类每小时造成的暂停（事件率 × 其机制链每次事件平均暂停），L 由引擎二分使目标恰好满足。权重 wᵢ 决定分配方式：<b>最小工作量</b>（默认）wᵢ = eᵢ——在 A_op 预算下使 Σ eᵢ log₂(1/xᵢ) 最小（KKT：被改进的类 xᵢcᵢ ∝ eᵢ；各类 e 相同时就是按暂停贡献的 Albert 最小工作量）；<b>AGREE</b> wᵢ = 单元数 × 重要度（复杂度权重，低于预算的类余量再分配）；<b>ARINC</b> wᵢ = cᵢ（全部类同一倍数）。对 A_op，运行占比精确等于 1/(1 + (Σ xᵢcᵢ + F)/3600)，F 为亚健康隔离、预测误报与已检出静默错误的暂停，因此水位有闭式解。目标已满足时报告<b>硬件余量</b>：所有中断 FIT 同比放大多少倍仍达标。', '<b>Hardware split (level rule)</b>: for a level L, xᵢ·cᵢ = clamp(wᵢ·L, floorᵢ·cᵢ, cᵢ), where cᵢ = λᵢ·p̄ᵢ is the pause per hour caused by class i (rate × mean pause per event of its mechanism chain) and L is found by bisection on the engine so that the target just holds. The weight wᵢ sets the method: <b>minimum effort</b> (default) wᵢ = eᵢ minimises Σ eᵢ log₂(1/xᵢ) for the A_op budget (KKT: improved classes end at xᵢcᵢ ∝ eᵢ; with equal e it is Albert’s minimum effort on pause contributions); <b>AGREE</b> wᵢ = units × importance (complexity weight, slack of the classes under budget reallocated); <b>ARINC</b> wᵢ = cᵢ (one factor for every class). For A_op the running fraction is exactly 1/(1 + (Σ xᵢcᵢ + F)/3600), F = sub-health isolation, predictor false alarms and detected silent corruption, so the level has a closed form. When the target already holds the result reports the <b>hardware slack</b>: the uniform factor by which every interruption FIT could grow with the target kept.')}</div>
  <h2>${T(`3. 起点：${tplName(TPL)}、${int(NPUS)} NPU 离 ${pct(TARGET, 1)} % 有多远`, `3. Starting point: how far ${tplName(TPL)} at ${int(NPUS)} NPUs is from ${pct(TARGET, 1)} %`)}</h2>
  <div class="kpis">
    <div class="kpi"><div class="l">A_op ${T('名义 / 降额', 'nominal / derated')}</div><div class="v">${pct(bn.aOp)} / ${pct(bd.aOp)} %</div><div class="n">${T('目标', 'target')} ${pct(TARGET, 1)} %</div></div>
    <div class="kpi"><div class="l">${T('暂停贡献 Σcᵢ（降额）', 'Pause contributions Σcᵢ (derated)')}</div><div class="v">${num(B.sumC, 1)} s/h</div><div class="n">${T('预算', 'budget')} B = ${num(B.budgetB, 1)} s/h · ${T('须削减', 'cut')} ${pct(cut, 0)} %</div></div>
    <div class="kpi"><div class="l">MTBI · ${T('平均暂停', 'mean pause')}</div><div class="v">${fmtH(bn.mtbiHours)} · ${num(bn.meanPauseS, 0)} s</div><div class="n">${T('每天', 'per day')} ${num(bn.eventsPerDay, 1)} · ${T('降额平均暂停', 'derated mean pause')} ${num(bd.meanPauseS, 0)} s · R̄ ${num(bn.recoveryS, 1)} s</div></div>
    <div class="kpi"><div class="l">${T('每 NPU 中断 FIT', 'Interruption FIT per NPU')}</div><div class="v">${int(B.hardFitPerNpu)}</div><div class="n">${T(`Σ 单元数 × FIT / N，${D.classes.length} 个硬件类`, `Σ units × FIT / N over ${D.classes.length} hardware classes`)}</div></div>
  </div>
  <p>${T(`预算 B = 3600 · ((1 − φ)/A* − 1) − F = ${num(B.budgetB, 1)} s/h（φ = 1 − A_op/A_run = ${B.phi.toExponential(2)}，静默错误损失的运行时间占比；F = ${num(B.F, 2)} s/h，亚健康隔离、预测误报与已检出静默错误的暂停）。下表是降额设计下暂停贡献最大的 9 类：<b>没有任何恢复梯级覆盖的类（UNKNOWN、POWER、MGMT、STORAGE、COOL、FABRIC、BOXIO：每次事件都走 ${num(top[0].meanPauseS, 1)} s 的全局恢复）占 Σc 的 ${pct(noRungShare, 0)} %</b>，而 CORE、MEMT 每小时事件数与 UNKNOWN 相当，却因重执行与 DP 弹性把每次暂停压到 ${num(core.meanPauseS, 0)} s，贡献只有 UNKNOWN 的约 ${num(core.c / top[0].c * 100, 0)} %。这就是硬件分配“压谁”的依据。`, `Budget B = 3600 · ((1 − φ)/A* − 1) − F = ${num(B.budgetB, 1)} s/h (φ = 1 − A_op/A_run = ${B.phi.toExponential(2)}, the running time lost to silent corruption; F = ${num(B.F, 2)} s/h of sub-health isolation, predictor false alarms and detected silent corruption). The table lists the 9 largest contributions on the derated design: <b>the classes no recovery rung covers (UNKNOWN, POWER, MGMT, STORAGE, COOL, FABRIC, BOXIO: every event falls to the ${num(top[0].meanPauseS, 1)} s global recovery) carry ${pct(noRungShare, 0)} % of Σc</b>, while CORE and MEMT, with as many events per hour as UNKNOWN, contribute only about ${num(core.c / top[0].c * 100, 0)} % of what UNKNOWN does because replay and DP elasticity cut their pause to ${num(core.meanPauseS, 0)} s. This is what the hardware split acts on.`)}</p>
  <div class="table-wrap"><table class="dense">
    <tr><th>${T('类', 'Class')}</th><th>${T('组', 'Group')}</th><th class="num">${T('单元数', 'Units')}</th><th class="num">${T('FIT / 单元', 'FIT / unit')}</th><th class="num">λᵢ (/h)</th><th class="num">p̄ᵢ (s)</th><th class="num">cᵢ (s/h)</th><th class="num">${T('占 Σc', 'share of Σc')}</th><th class="num">P(${T('全局恢复', 'global recovery')})</th></tr>
    ${top.map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(groupName(c.group))}</td><td class="num">${int(c.units)}</td><td class="num">${fitf(c.fitPerUnit)}</td><td class="num">${c.ratePerHour.toFixed(4)}</td><td class="num">${num(c.meanPauseS, 1)}</td><td class="num">${num(c.c, 2)}</td><td class="num">${pct(c.share, 1)} %</td><td class="num">${num(c.pGlobal, 3)}</td></tr>`).join('')}
  </table></div>
</section>

<section class="page" id="p2">
  <div class="eyebrow">HAC-D v4 · ${T(`算例结果：${tplName(TPL)}，${int(NPUS)} NPU`, `Worked example results: ${tplName(TPL)}, ${int(NPUS)} NPUs`)} · ${gen} · ${T('第 2 / 4 页', 'page 2 / 4')}</div>
  <h2 class="first">${T('4. 三种策略的结果', '4. What the three strategies return')}</h2>
  <div class="grid2">
    <div><h3>${T(`最优：总工作量 ${num(opt.effort.total, 2)}（机制 ${opt.effort.mechanisms} + 杠杆 ${opt.effort.levers} + 硬件 ${num(opt.effort.hardware, 2)}）`, `Optimal: total effort ${num(opt.effort.total, 2)} (mechanisms ${opt.effort.mechanisms} + levers ${opt.effort.levers} + hardware ${num(opt.effort.hardware, 2)})`)}</h3>${stepsTable(opt)}${hwTable(opt)}
      <p class="small">${T(`在 ${nSubsets} 个子集中选出；次优方案：${opt.alternatives.slice(1, 4).map((a) => `${[...a.mechanisms, ...a.levers.map(leverShort)].join(' + ') || '—'}（${num(a.effort.total, 2)}）`).join('；')}。`, `chosen among ${nSubsets} subsets; next best: ${opt.alternatives.slice(1, 4).map((a) => `${[...a.mechanisms, ...a.levers.map(leverShort)].join(' + ') || '—'} (${num(a.effort.total, 2)})`).join('; ')}.`)}</p></div>
    <div><h3>${T(`MTTR 降低优先：${num(mttr.effort.total, 2)}（${mttr.effort.mechanisms} + ${mttr.effort.levers} + ${num(mttr.effort.hardware, 2)}）`, `MTTR preferred: ${num(mttr.effort.total, 2)} (${mttr.effort.mechanisms} + ${mttr.effort.levers} + ${num(mttr.effort.hardware, 2)})`)}</h3>${stepsTable(mttr)}${hwTable(mttr)}
      <p class="small">${T(`杠杆按“增益 / 工作量”最先入选；D-SLOW 的增益几乎为零（${pct(slowGain, 4)} pt）也被加入，因为恢复侧在达标前任何正增益都算——这是“优先推到上限”的规则所致，比最优多花 ${num(mttr.effort.total - opt.effort.total, 2)}。`, `the levers enter first by gain per effort; D-SLOW, with an almost zero gain (${pct(slowGain, 4)} pt), is still added because any positive gain counts before the target holds — the “push the recovery side to its limits” rule, ${num(mttr.effort.total - opt.effort.total, 2)} more than the optimum.`)}</p></div>
  </div>
  <h3>${T(`MTTF 提升优先：仅硬件，总工作量 ${num(mttf.effort.total, 2)}，${mttfImproved} 类改进，结果 ${pct(mttf.final.value)} / ${pct(mttf.final.derated)} %`, `MTTF preferred: hardware only, total effort ${num(mttf.effort.total, 2)}, ${mttfImproved} classes improved, result ${pct(mttf.final.value)} / ${pct(mttf.final.derated)} %`)}</h3>
  <figure class="chart f1">${f1.svg}<div class="tip"></div><figcaption>${T(`图 1：MTTF 提升优先的硬件分配（显示贡献最大的 13 类）。被改进的类压到同一水位 L = ${num(f1.level * 100, 4)} pt：UNKNOWN 每 NPU ${fitf(hwUnk.currentFit)} → ${fitf(hwUnk.allowedFit)} FIT、POWER 每计算柜 ${fitf(hwPow.currentFit)} → ${fitf(hwPow.allowedFit)} FIT；${mttfFloors.length ? `${mttfFloors.join('、')} 受下限 ${DEFAULT_FLOOR} 约束，停在水位之上` : `没有一类到达下限 ${DEFAULT_FLOOR}`}。右列为 FIT 倍数 xᵢ 与每单元 FIT（当前 → 允许）。各类每减半工作量相同（e = 2）时，最小总工作量的解让被改进的类停在同一贡献水平（KKT：xᵢcᵢ ∝ eᵢ）。`, `Figure 1: the hardware split of MTTF-preferred (the 13 largest classes shown). Improved classes are cut to the same level L = ${num(f1.level * 100, 4)} pt: UNKNOWN ${fitf(hwUnk.currentFit)} → ${fitf(hwUnk.allowedFit)} FIT per NPU, POWER ${fitf(hwPow.currentFit)} → ${fitf(hwPow.allowedFit)} FIT per compute cabinet; ${mttfFloors.length ? `${mttfFloors.join(', ')} hit${mttfFloors.length === 1 ? 's' : ''} the ${DEFAULT_FLOOR} floor and stay${mttfFloors.length === 1 ? 's' : ''} above the level` : `no class reaches its ${DEFAULT_FLOOR} floor`}. Right column: FIT factor xᵢ and FIT per unit (now → allowed). With the same effort per halving for every class (e = 2), the least-effort solution leaves every improved class at the same contribution (KKT: xᵢcᵢ ∝ eᵢ).`)}</figcaption></figure>
  <details class="tv"><summary>${T('图 1 数据表', 'Figure 1 data table')}</summary>${f1.table}</details>
  <p class="small">${T(`四个内置规模（同一目标与约束，${tplName(TPL)}）：`, `The four built-in scales (same target and constraints, ${tplName(TPL)}):`)}</p>
  <div class="table-wrap"><table class="dense"><tr><th>${T('策略', 'Strategy')}</th>${SIZES.map((n) => `<th>${int(n)}</th>`).join('')}</tr>${crossRows}</table></div>
  <p class="small">${T(`余量 ×k：所有中断 FIT 同比放大 k 倍仍达标（无需任何手段）；粗体为总工作量。10k 与 100k 有余量；200k 时缺口很小，最优只用自动尝试 60 s（工作量 ${num(a200.optimal.effort.total, 0)}），仅硬件需要 ${num(a200['mttf-first'].effort.total, 2)}；500k 时三类手段都要用上。`, `slack ×k: every interruption FIT could grow k times with the target kept (no move needed); bold = total effort. 10k and 100k have slack; at 200k the gap is small and the optimum only takes the 60 s automatic attempt (effort ${num(a200.optimal.effort.total, 0)}) where hardware alone costs ${num(a200['mttf-first'].effort.total, 2)}; at 500k all three kinds of moves are needed.`)}</p>
</section>

<section class="page" id="p3">
  <div class="eyebrow">HAC-D v4 · ${T('所用机制参数与早期版本的分配方法', 'Mechanism parameters used and the earlier allocation methods')} · ${gen} · ${T('第 3 / 4 页', 'page 3 / 4')}</div>
  <h2 class="first">${T('5. 机制参数：哪些固定、哪些降额、哪些可动', '5. Mechanism parameters: what is fixed, what is derated, what moves')}</h2>
  <div class="table-wrap"><table class="dense">
    <tr><th>${T('机制', 'Mechanism')}</th><th>${T('角色', 'Role')}</th><th>${T('名义参数', 'Nominal parameters')}</th><th>${T('降额参数（可行性检查）', 'Derated parameters (feasibility check)')}</th><th class="num">${T('工作量', 'Effort')}</th></tr>
    ${D.moves.scenario.map((m) => `<tr><td><code>${esc(m.id)}</code> ${esc(mechName(m))}</td><td>${T('方案已有（默认六项）', 'in the scenario (default six)')}</td><td>${esc(fmtParams(m.nominal))}</td><td>${esc(fmtParams(m.derated))}</td><td class="num">—</td></tr>`).join('')}
    ${D.moves.candidates.map((m) => `<tr><td><code>${esc(m.id)}</code> ${esc(mechName(m))}</td><td>${T('候选', 'candidate')}</td><td>${esc(fmtParams(m.nominal))}</td><td>${esc(fmtParams(m.derated))}</td><td class="num">${m.effort}</td></tr>`).join('')}
    ${D.moves.levers.map((l) => `<tr><td>${esc(leverName(l.id))}</td><td>${T('杠杆', 'lever')}</td><td>${T('当前', 'today')} ${leverVal(l.id, l.current)} → ${leverVal(l.id, l.nominalValue)}</td><td>${leverVal(l.id, l.deratedValue)}${l.deratedValue === l.current ? ` <b>${T('（等于当前值，降额后无作用）', '(equals today: no derated effect)')}</b>` : ''}</td><td class="num">${l.effort}</td></tr>`).join('')}
  </table></div>
  <div class="callout">${T(`<b>当前策略不分配机制参数的数值。</b>机制按库中（或机制页上用户修改后）的参数加入，三项恢复参数只能整体推到上限；没有“需要多高的覆盖率 / 多快的恢复”这样的连续求解。可见的后果：① 自动成功率杠杆降额后为 99.9 % − 8 pt = 91.9 %，低于当前 99 %，降额检查中它不起作用，策略从不选它；② MTTR 优先会加入增益几乎为零的机制（D-SLOW）；③ 正确有效产出目标主要受检查点与静默错误参数限制：本例中 C-FAST 降额后每 60 s 保存 1.5 s、D-SDC 降额后覆盖率 90 %，即使硬件全部到下限，降额正确有效产出最高也只有 ${pct(D.delivered.final.derated, 2)} %（名义 ${pct(D.delivered.final.value, 2)} %），≥ ${pct(D.scenario.goodputTarget, 0)} % 被报告为不可行——这时需要的是参数分配（例如所需静默检出率 q*，经典方法页签对正确有效产出目标会计算 q* 与兜底时延 D*），而不是更多硬件。`, `<b>The strategies do not allocate mechanism parameter values.</b> Mechanisms enter with the library parameters (or the user’s edits on the Mechanisms page) and the three recovery parameters can only move to their limits as a whole; there is no continuous solve for “how much coverage / how fast a recovery is needed”. Visible consequences: ① the derated automatic-success lever is 99.9 % − 8 pt = 91.9 %, below today’s 99 %, so it has no derated effect and the strategies never pick it; ② MTTR-preferred adds a mechanism with an almost zero gain (D-SLOW); ③ delivered-goodput targets are capped by the checkpoint and silent-corruption parameters: here derated C-FAST saves 1.5 s every 60 s and derated D-SDC covers 90 %, so even with every hardware class at its floor the derated delivered goodput tops out at ${pct(D.delivered.final.derated, 2)} % (nominal ${pct(D.delivered.final.value, 2)} %) and ≥ ${pct(D.scenario.goodputTarget, 0)} % is reported infeasible — what is needed then is a parameter allocation (e.g. the required silent-corruption detection q*, which the Classic methods tab computes for delivered targets together with the fallback delay D*), not more hardware.`)}</div>
  <h2>${T('6. 与早期版本的分配方法相同吗？', '6. Is it the same as the earlier allocation methods?')}</h2>
  <p>${T('<b>不相同，但由同样的部件组成。</b>v3.0 的经典方法（等分、ARINC、AGREE、可改进性、Albert 最小工作量、成本最优）与 v3.1 的纯机制规划器代码没有改动，仍在分配页的「经典方法」「机制规划器」页签；v3.7 的分配研究在「跨规模」页签下方。v4.0 新增的策略层与它们的区别：', '<b>Not the same, but built from the same parts.</b> The v3.0 classic methods (equal, ARINC, AGREE, feasibility, Albert minimum effort, cost optimal) and the v3.1 mechanism-only planner are unchanged in code and remain on the Allocation page’s Classic methods and Mechanism planner tabs; the v3.7 allocation study sits below the Cross-scale tab. The new v4.0 strategy layer differs from them as follows:')}</p>
  <div class="table-wrap"><table class="dense">
    <tr><th></th><th>${T('v3.0 经典方法', 'v3.0 classic methods')}</th><th>${T('v3.1 机制规划器', 'v3.1 mechanism planner')}</th><th>${T('v3.7 分配研究', 'v3.7 allocation study')}</th><th>${T('v4.0 策略', 'v4.0 strategies')}</th></tr>
    <tr><td class="k">${T('分配对象', 'Allocates')}</td><td>${T('各类故障率 λᵢ；恢复阶段时间', 'class failure rates λᵢ; recovery stage times')}</td><td>${T('机制组合', 'mechanism sets')}</td><td>${T('先机制（规划器），残余缺口给一个统一硬件因子；杠杆只作参考', 'mechanisms first (planner), the residual gap to one uniform hardware factor; levers reported, not selected')}</td><td>${T('机制 + 恢复杠杆 + 各类 FIT，同一工作量尺度', 'mechanisms + recovery levers + class FIT on one effort scale')}</td></tr>
    <tr><td class="k">${T('预算模型', 'Budget model')}</td><td>${T('一阶 Young 式：A ≈ 1 − λR，R 取全局恢复时间（每次中断都按 264.5 s 计）', 'first-order Young form: A ≈ 1 − λR with R = the global recovery time (every interruption charged 264.5 s)')}</td><td>${T('引擎（解析式）', 'engine (closed forms)')}</td><td>${T('引擎：二分求统一因子', 'engine: bisection for a uniform factor')}</td><td>${T('引擎：A_op 闭式水位 + 二分确认；正确有效产出二分', 'engine: A_op level in closed form + bisection check; delivered by bisection')}</td></tr>
    <tr><td class="k">${T('硬件拆分依据', 'Hardware split on')}</td><td>${T('故障率（权重：当前率、单元数 × 重要度、可改进性、成本曲线）', 'rates (weights: current rate, units × importance, feasibility, cost curves)')}</td><td>—</td><td>${T('全部类同一倍数（ARINC / Albert 表仅作参考）', 'one factor for every class (ARINC / Albert tables for reference)')}</td><td>${T('暂停贡献 cᵢ = λᵢp̄ᵢ；单元数来自拓扑', 'pause contributions cᵢ = λᵢp̄ᵢ; unit counts from the topology')}</td></tr>
    <tr><td class="k">${T('鲁棒性检查', 'Robustness check')}</td><td>${T('无降额', 'no derating')}</td><td>${T('名义 + 降额（新增机制）', 'nominal + derated (added mechanisms)')}</td><td>${T('名义 + 降额，只降额<b>新增</b>机制；方案自身机制与硬件因子按名义', 'nominal + derated, <b>added</b> mechanisms only; the scenario’s own mechanisms and the hardware factor stay nominal')}</td><td>${T('名义 + 降额，<b>全部</b>机制与杠杆；硬件也在降额设计上闭合；每类下限、每减半工作量、固定类', 'nominal + derated, <b>every</b> mechanism and lever; the hardware closed on the derated design; per-class floors, effort per halving, fixed classes')}</td></tr>
    <tr><td class="k">${T('机制参数', 'Mechanism parameters')}</td><td>${T('正确有效产出口径下求所需静默检出率 q* 与兜底时延 D*；阶段时间预算', 'required silent-corruption detection q* and fallback delay D* on the delivered basis; stage-time budgets')}</td><td>${T('按库参数', 'library values')}</td><td>${T('按库参数；另评估库外恢复杠杆', 'library values; recovery levers evaluated beyond the library')}</td><td>${T('按库参数；三项恢复杠杆可入选（推到上限）', 'library values; three recovery levers can be selected (moved to limits)')}</td></tr>
  </table></div>
  <figure class="chart f2">${f2.svg}<div class="tip"></div><figcaption>${T(`图 2：同一缺口用三个版本的方法闭合的代价（统一检查：名义与全部机制降额都 ≥ ${pct(TARGET, 1)} %）。v3.0 的一阶预算把每次中断都按 ${num(EX.v30.recoveryS, 1)} s 全局恢复计，估计 A_op 为 ${pct(fo, 2)} %（引擎 ${pct(bn.aOp, 2)} %），因而要求 λ* = ${num(EX.v30.lambdaStar, 3)} /h（全部类 ×${num(EX.v30.uniformFactor, 3)}），达标但过度（${pct(EX.v30.splits['minimum-effort'].aOp, 2)} %），工作量 ${num(EX.v30.splits['minimum-effort'].effort, 0)}–${num(EX.v30.splits.agree.effort, 0)}；v3.7 选 ${EX.v37.plan.ids.join(' + ')} 后再对全部 ${EX.v37.hardwareClasses} 类统一 ×${num(EX.v37.hardwareFactor, 2)}，工作量 ${num(EX.v37.effort.total, 1)}，自身检查达标、统一检查降额只有 ${pct(EX.v37.aOpDerated, 2)} %；v4.0 最优 ${num(opt.effort.total, 1)}。`, `Figure 2: the cost of closing the same gap with the three versions’ methods (common check: nominal and every mechanism derated ≥ ${pct(TARGET, 1)} %). v3.0’s first-order budget charges every interruption the ${num(EX.v30.recoveryS, 1)} s global recovery and estimates A_op at ${pct(fo, 2)} % (engine ${pct(bn.aOp, 2)} %), so it asks for λ* = ${num(EX.v30.lambdaStar, 3)} /h (every class ×${num(EX.v30.uniformFactor, 3)}) and overshoots (${pct(EX.v30.splits['minimum-effort'].aOp, 2)} %) at an effort of ${num(EX.v30.splits['minimum-effort'].effort, 0)}–${num(EX.v30.splits.agree.effort, 0)}; v3.7 picks ${EX.v37.plan.ids.join(' + ')}, then one factor ×${num(EX.v37.hardwareFactor, 2)} on all ${EX.v37.hardwareClasses} classes, effort ${num(EX.v37.effort.total, 1)}, meeting its own check but only ${pct(EX.v37.aOpDerated, 2)} % derated on the common one; v4.0 optimal ${num(opt.effort.total, 1)}.`)}</figcaption></figure>
  <details class="tv"><summary>${T('图 2 数据表', 'Figure 2 data table')}</summary>${f2.table}</details>
</section>

<section class="page" id="p4">
  <div class="eyebrow">HAC-D v4 · ${T('哪个版本更好与最佳实践', 'Which version is better, and best practices')} · ${gen} · ${T('第 4 / 4 页', 'page 4 / 4')}</div>
  <h2 class="first">${T(`7. v3.0、v3.7、v4.0 哪个更好？——${NCASES} 个算例`, `7. Which is better: v3.0, v3.7 or v4.0? — ${NCASES} cases`)}</h2>
  <p class="small">${T(`${TPLS.length} 种模板 × 四个内置规模，A_op ≥ ${pct(TARGET, 1)} %，默认六项机制与相同候选；每个设计都用同一把尺子在引擎上复核（名义，以及方案自身与新增机制全部降额），工作量统一为 机制库分数 + 杠杆 + Σ 2·log₂(1/x)。✓ = 统一检查达标；✕* = 只通过自身检查（v3.7 只降额新增机制）。`, `${TPLS.length} templates × four built-in scales, A_op ≥ ${pct(TARGET, 1)} %, the six default mechanisms and the same candidates; every design re-checked on the engine with one yardstick (nominal, and every mechanism — the scenario’s own and the added ones — derated), effort on one metric: library score + levers + Σ 2·log₂(1/x). ✓ = meets the common check; ✕* = passes only its own check (v3.7 derates the added mechanisms only).`)}</p>
  <div class="table-wrap"><table class="dense"><tr><th>${T('模板', 'Template')}</th><th>${T('方法（总工作量）', 'Method (total effort)')}</th>${SIZES.map((n) => `<th class="num">${int(n)}</th>`).join('')}</tr>${vRows}</table></div>
  <div class="verdict">${T(`<b>结论：分配决策用 v4.0。</b>它是唯一在全部 ${NCASES} 个算例上都通过统一检查${v4ok ? '' : '（有例外）'}、且工作量最低的方法：500k 时 v4.0 最优 ${range(e500.v4)}，v3.7 ${range(e500.v37, 0)}（并在 ${v37miss.length} 个算例上差统一检查 ${range(v37gap, 2)} pt），v3.0 ${num(Math.min(...e500.v30), 0)}–${num(Math.max(...e500.v30max), 0)}。v3.0 的一阶预算把每次中断按 264.5 s 全局恢复计（链上实际平均暂停 95 s），所以在已经达标的 100k 也要求硬件改进（工作量 ${num(Math.min(...e100.v30), 0)}–${num(Math.max(...e100.v30max), 0)}，实际需要 0）；v3.7 的机制选择合理，但不把恢复杠杆纳入方案、残余缺口用一个统一因子压全部 20 类，且只降额新增机制。计算时间：v4.0 每个算例 ${range(ms.v4.map((x) => x / 1000), 1)} s，v3.7 ${range(ms.v37.map((x) => x / 1000), 1)} s，v3.0 ${range(ms.v30, 0)} ms。`, `<b>Verdict: use v4.0 for the allocation decision.</b> It is the only method that passes the common check on all ${NCASES} cases${v4ok ? '' : ' (with exceptions)'} and it has the lowest effort: at 500k v4.0 optimal costs ${range(e500.v4)}, v3.7 ${range(e500.v37, 0)} (and misses the common check by ${range(v37gap, 2)} pt in ${v37miss.length} cases), v3.0 ${num(Math.min(...e500.v30), 0)}–${num(Math.max(...e500.v30max), 0)}. v3.0’s first-order budget charges every interruption the 264.5 s global recovery while the chain’s mean pause is 95 s, so it asks for hardware work even at 100k where the design already meets the target (effort ${num(Math.min(...e100.v30), 0)}–${num(Math.max(...e100.v30max), 0)} for zero needed); v3.7 picks sensible mechanisms but leaves the recovery levers out of the plan, closes the residual with one factor on all 20 classes and derates only the mechanisms it adds. Run time per case: v4.0 ${range(ms.v4.map((x) => x / 1000), 1)} s, v3.7 ${range(ms.v37.map((x) => x / 1000), 1)} s, v3.0 ${range(ms.v30, 0)} ms.`)}</div>
  <div class="table-wrap"><table class="dense">
    <tr><th>${T('问题', 'Question')}</th><th>${T('用哪个', 'Use')}</th><th>${T('为什么', 'Why')}</th></tr>
    <tr><td>${T('目标怎样在机制、恢复参数与硬件之间分配？', 'How to split a target between mechanisms, recovery parameters and hardware?')}</td><td>${T('v4.0 策略 · 最优', 'v4.0 Strategies · Optimal')}</td><td>${T('最便宜的组合、按暂停贡献给出各类允许 FIT，名义与全部降额都验证', 'cheapest combination, allowed FIT per class weighted by pause, verified nominal and fully derated')}</td></tr>
    <tr><td>${T('硬件已冻结 / 硬件尚可调？', 'Hardware frozen / hardware still open?')}</td><td>${T('v4.0 MTTR 优先 / MTTF 优先', 'v4.0 MTTR-preferred / MTTF-preferred')}</td><td>${T('满足偏好的方案；与最优的工作量差就是偏好的代价', 'plans that respect the preference; the effort gap to the optimum prices it')}</td></tr>
    <tr><td>${T('为什么需要这个方案、各机制贡献多少？', 'Why is this plan needed, what does each mechanism contribute?')}</td><td>${T('v3.7 分配研究', 'v3.7 allocation study')}</td><td>${T('Shapley 归因、按组分解残余、杠杆替代、账本校核、曲线与 HTML 报告', 'Shapley attribution, residual by group, lever alternatives, ledger verification, curves and an HTML report')}</td></tr>
    <tr><td>${T('给供应商的部件指标', 'Component requirements for suppliers')}</td><td>${T('v4.0 的各类允许 FIT（每单元 FIT 与 MTBF）', 'v4.0 allowed FIT per class (per unit, with MTBF)')}</td><td>${T('v3.0 按故障率拆分在各类暂停差异大时会错配', 'v3.0 rate splits misallocate when pauses differ by class')}</td></tr>
    <tr><td>${T('正确有效产出目标（静默错误、检查点）', 'Delivered-goodput targets (silent corruption, checkpoints)')}</td><td>${T('v3.0 经典方法（q*、D*、阶段预算）+ 机制参数修改', 'v3.0 Classic methods (q*, D*, stage budgets) + mechanism parameter edits')}</td><td>${T('v4.0 不分配参数数值', 'v4.0 does not allocate parameter values')}</td></tr>
  </table></div>
  <h2>${T('8. 最佳实践', '8. Best practices')}</h2>
  <ol class="bp">
    <li>${T('<b>先定拓扑与规模，再换数据。</b>从模板与默认六项机制出发；有实测时把库中 FIT 换成本集群的每单元实测值（事件计数用 Garwood 区间），保留来源与置信度。', '<b>Fix topology and scale first, then replace the data.</b> Start from a template with the six defaults; where you have measurements, replace the library FIT by per-unit values of your cluster (Garwood interval for event counts) and keep source and confidence.')}</li>
    <li>${T(`<b>先定口径与分规模目标。</b>A_op（运行时间）与正确有效产出（保留的进度）不要混用；同一目标在大规模时可能因 F 项（隔离、误报、已检出静默错误的暂停随 N 增长）而不可行，宜按规模给目标。`, `<b>Choose the 口径 and per-size targets first.</b> Do not mix A_op (running time) with delivered goodput (retained progress); one target for all sizes can become infeasible at large N because the F term (isolation, false alarms, detected silent corruption) grows with N, so set targets per size.`)}</li>
    <li>${T('<b>以 v4.0 最优为参考答案，用两种偏好给偏好定价。</b>最优与 MTTR / MTTF 优先的工作量差就是“偏好”的代价。', '<b>Take v4.0 Optimal as the reference answer and price preferences with the other two.</b> The effort gap between Optimal and MTTR- / MTTF-preferred is the price of the preference.')}</li>
    <li>${T('<b>要求名义与全部降额都达标，并用账本校核最终方案。</b>看 P(窗口 ≥ 目标) 及其 Wilson 区间；只降额新增机制（v3.7）会高估余量。', '<b>Require nominal and fully derated feasibility, and verify the final plan with the ledger.</b> Read P(window ≥ target) with its Wilson interval; derating only the added mechanisms (v3.7) overstates the margin.')}</li>
    <li>${T(`<b>校准工作量与下限，并做敏感性。</b>工作量分数、每减半工作量、每类下限都是假设；${tplName(TPL)} 200k 时自动尝试 60 s（${num(a200.optimal.effort.total, 0)}）、仅硬件（${num(a200['mttf-first'].effort.total, 2)}）与 v3.7 的 D-HARD + C-MEM（5）相差很小，分数改 ±1 结论就会变。`, `<b>Calibrate efforts and floors, and test sensitivity.</b> Effort scores, effort per halving and floors are assumptions; for ${tplName(TPL)} at 200k the 60 s automatic attempt (${num(a200.optimal.effort.total, 0)}), hardware alone (${num(a200['mttf-first'].effort.total, 2)}) and v3.7’s D-HARD + C-MEM (5) are close, so a ±1 change of a score flips the choice.`)}</li>
    <li>${T('<b>有机制链时不要用一阶预算定规模。</b>v3.0 的 λ* 假设每次中断都付出全局恢复时间；只在没有回退梯级的设计或作初筛时使用。', '<b>Do not size with first-order budgets when a mechanism chain is active.</b> v3.0’s λ* assumes every interruption pays the global recovery time; use it only for designs without recovery rungs or as a first screen.')}</li>
    <li>${T('<b>按单元阅读硬件结果并作为验收值。</b>每单元允许 FIT 与 MTBF（年）给供应商；已达标时把余量因子作为验收上限。', '<b>Read hardware results per unit and use them as acceptance values.</b> Give suppliers the allowed FIT and MTBF (years) per unit; when the target already holds, use the slack factor as the acceptance ceiling.')}</li>
    <li>${T(`<b>先看无梯级的类。</b>本例 ${pct(noRungShare, 0)} % 的暂停来自没有恢复梯级覆盖的类（UNKNOWN、POWER、MGMT、STORAGE、COOL、FABRIC、BOXIO）；为它们增加一级局部恢复，比继续压 FIT 更有效（目前库中没有这样的机制，是下一步的候选）。`, `<b>Look at the classes without a recovery rung first.</b> Here ${pct(noRungShare, 0)} % of the pause comes from classes no rung covers (UNKNOWN, POWER, MGMT, STORAGE, COOL, FABRIC, BOXIO); a local recovery rung for them would pay more than further FIT cuts (the library has no such mechanism yet — a candidate for the next step).`)}</li>
    <li>${T('<b>正确有效产出目标要分配参数。</b>用经典方法的 q*、D* 与阶段预算，在机制页修改 D-SDC 覆盖率、C-FAST 保存时间等参数，再回到 v4.0 复核。', '<b>Delivered-goodput targets need parameter allocation.</b> Use the classic q*, D* and stage budgets, edit D-SDC coverage, C-FAST save time and similar parameters on the Mechanisms page, then re-check with v4.0.')}</li>
    <li>${T('<b>覆盖要支持的最大规模，并留存方案。</b>需求随 N 增长（本例 10k / 100k 有余量，500k 需三类手段）；在「跨规模」页签复核，把选定设计另存为方案并导出报告。', '<b>Cover the largest size you must support, and keep the designs.</b> Requirements grow with N (here 10k / 100k have slack, 500k needs all three kinds of moves); re-check on the Cross-scale tab, save the chosen design as a scenario and export the report.')}</li>
  </ol>
  <div class="box"><h3>${T('局限与建议的下一步', 'Limitations and suggested next steps')}</h3><ul>
    <li>${T('机制参数的连续分配（所需覆盖率、恢复时间、保存时间）尚未进入 v4.0；对正确有效产出目标尤其需要。', 'Continuous allocation of mechanism parameters (required coverage, recovery time, save time) is not in v4.0 yet; delivered-goodput targets need it most.')}</li>
    <li>${T('成功率杠杆的降额规则应改为失败概率 ×1.5（99.9 % → 99.85 %），否则它在降额检查中永远无效；MTTR 优先可加最小增益阈值。', 'The success lever should be derated on its failure probability ×1.5 (99.9 % → 99.85 %), otherwise it never helps under derating; MTTR-preferred could use a minimum-gain threshold.')}</li>
    <li>${T('v3.7 研究的降额检查宜与 v4.0 对齐（同时降额方案自身机制），否则它在 200k / 500k 的方案统一检查不达标。', 'The v3.7 study’s derated check should be aligned with v4.0 (derate the scenario’s own mechanisms too); otherwise its plans at 200k / 500k fail the common check.')}</li>
  </ul></div>
  <footer>${T('复现', 'Reproduce')}：<code>node --import tsx scripts/allocation-strategy-v4-example.ts</code> → <code>node scripts/build-allocation-strategy-v4.mjs</code>；${T(`界面：拓扑页选 A3、500k，分配页 → 策略 / 跨规模（目标 ${TARGET}）`, `in the app: Topology page A3 at 500k, then Allocation → Strategies / Cross-scale (target ${TARGET})`)}；CLI <code>hacd strategy --template ${TPL} --npus ${NPUS} --target ${TARGET}</code>。${T('故障率为参考目录先验（假设），须以本集群实测替换。', 'Failure rates are the reference catalog’s priors (assumed) and must be replaced by measurements of the cluster.')}</footer>
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
  const out = `docs/ALLOCATION_STRATEGY_V4.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
build('en');
build('zh');
