#!/usr/bin/env node
/**
 * Build the three AGREE-method allocation reports (two printed A4 pages each, three inline SVG charts with tooltips and table
 * views) from docs/agree-allocation-98p5/results.json (scripts/agree-allocation-98p5.ts):
 *   --report remap       → docs/REMAP_ALLOCATION_98P5_AGREE.zh.html          (ReMAP's original mechanisms only)
 *   --report comparison  → docs/MECHANISM_COMPARISON_98P5_AGREE.zh.html      (original vs 16 new vs combined)
 *   --report latest      → docs/REMAP_LATEST_ALLOCATION_98P5_AGREE.zh.html   (latest ReMAP: original + 16 extensions)
 * Each report compares the AGREE allocation (per-class budgets, strict and reallocated improvement factors, AGREE-driven
 * mechanism set) with the planner sets of the earlier reports (docs/*-98p5/results.json) when those exist.
 * Usage: node scripts/build-agree-allocation-98p5.mjs --report latest   (or: --report all)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const IN = JSON.parse(readFileSync('docs/agree-allocation-98p5/results.json', 'utf8'));
const AUDIT = JSON.parse(readFileSync('packages/core/data/mechanism-audit.json', 'utf8'));
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const PREV_REMAP = load('docs/remap-allocation-98p5/results.json')?.study ?? null;
const PREV_CMP = load('docs/mechanism-comparison-98p5/results.json');
const PREV_LATEST = load('docs/remap-latest-allocation-98p5/results.json')?.aOp ?? null;
const prevStudy = (key) => (key === 'remap' ? PREV_REMAP : key === 'latest' ? PREV_LATEST : PREV_CMP?.sets?.[key]?.study ?? null);

const CFG = {
  remap: { out: 'docs/REMAP_ALLOCATION_98P5_AGREE.zh.html', dir: 'docs/agree-allocation-98p5/remap', sets: ['remap'], main: 'remap', tag: () => 'R', famNote: 'R = ReMAP 原有', title: '98.5 % 目标下的 AGREE 分配：仅 ReMAP 原有机制（1 万–50 万卡）', short: 'AGREE 分配研究（仅 ReMAP 原有机制）', doc: 'ReMAP 原有机制', prevName: '上一报告 REMAP_ALLOCATION_98P5（精确枚举规划器）', tabTitle: 'AGREE 分配 · ReMAP 原有机制' },
  comparison: { out: 'docs/MECHANISM_COMPARISON_98P5_AGREE.zh.html', dir: 'docs/agree-allocation-98p5/comparison', sets: ['remap', 'new', 'combined'], main: 'combined', tag: (id) => (IN.extensions.includes(id) ? '新' : 'R'), famNote: 'R = ReMAP 原有，新 = 审核新增', title: '98.5 % 目标下的 AGREE 分配：ReMAP 原有机制 · 新增 16 项 · 两者合并（1 万–50 万卡）', short: 'AGREE 分配研究（机制族比较）', doc: '三个机制族', prevName: '上一报告 MECHANISM_COMPARISON_98P5（规划器）', tabTitle: 'AGREE 分配 · 机制族比较' },
  latest: { out: 'docs/REMAP_LATEST_ALLOCATION_98P5_AGREE.zh.html', dir: 'docs/agree-allocation-98p5/latest', sets: ['latest'], compare: 'remap', main: 'latest', tag: (id) => (IN.extensions.includes(id) ? '扩' : 'R'), famNote: 'R = ReMAP 原有，扩 = 最新 ReMAP 的扩展', title: '98.5 % 目标下的 AGREE 分配：ReMAP 最新机制集（原有 + 16 项扩展，1 万–50 万卡）', short: 'AGREE 分配研究（ReMAP 最新机制集）', doc: 'ReMAP 最新机制集', prevName: '上一报告 REMAP_LATEST_ALLOCATION_98P5（贪心规划器）', tabTitle: 'AGREE 分配 · ReMAP 最新机制集' },
};
const SIZES = IN.sizes;
const C = IN.common;
const TARGET = IN.target;
const pct = (x, d = 2) => (x * 100).toFixed(d);
const pt = (x, d = 2) => (x * 100).toFixed(d);
const sgn = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d);
const num = (x, d = 2) => Number(x).toFixed(d);
const kf = (k) => (k >= 10 ? k.toFixed(0) : k >= 2 ? k.toFixed(1) : k.toFixed(2));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kfmt = (N) => (N >= 1e6 ? `${(N / 1e6).toFixed(N % 1e6 ? 1 : 0)}M` : N >= 1e5 ? `${Math.round(N / 1e3)}k` : `${(N / 1e3).toFixed(1).replace(/\.0$/, '')}k`);
const zhN = (N) => ({ 10000: '1 万卡', 100000: '10 万卡', 200000: '20 万卡', 500000: '50 万卡' })[N] ?? `${N}`;
const zhNs = (N) => ({ 10000: '1 万', 100000: '10 万', 200000: '20 万', 500000: '50 万' })[N] ?? `${N}`;
const dom = (id) => id.replace(/-hard$/, '');
const textW = (s) => Array.from(s).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.6), 0);
const CLASSES = C[100000].classes; // same ids at every size
const GROUPS = [['npu', 'NPU 芯片与内存'], ['network', '网络'], ['host', '主机'], ['facility', '机房设施'], ['storageSoftware', '存储 / 软件 / 未归因']];
const classOrder = GROUPS.flatMap(([g]) => CLASSES.filter((c) => c.group === g).map((c) => c.id));
const shortName = (id) => (CLASSES.find((c) => c.id === id)?.name ?? id).split(' · ')[0];
const PK = { coverage: '覆盖率', detectSeconds: '检测时延', success: '成功率', successSeconds: '成功耗时', failureSeconds: '失败耗时', domains: '域数', recoverSeconds: '域恢复', syncSeconds: '协调', computeSeconds: 'τ', saveSeconds: 'δ', stepSeconds: 'step', pauseSeconds: '停顿', switchSeconds: '切换', exposedCommunicationFraction: '通信暴露', remainingBandwidthRatio: '剩余带宽', repairSeconds: '修复', startupTargetSeconds: '启动目标', blockingTargetSeconds: '阻塞目标', durableLagSeconds: '持久化滞后', compressionRatio: '压缩比', decompressSeconds: '解压', manualProbabilityTarget: '人工概率目标', detectionTarget: '检出目标', upstreamDetection: '上游检出', conditionalMissDetection: '漏检补捕', overhead: '开销', occurrenceReduction: '发生率降低', communicationBeforeSeconds: '通信重建前', communicationTargetSeconds: '通信重建目标', graphTargetSeconds: '图准备目标', eligibleShare: '适用比例', riskShare: '风险占比', share: '适用×成功', reduction: '削减', rateFactor: '进入率因子', durationFactor: '持续因子', recall: '召回', precision: '精度', migrationSeconds: '迁移停顿', loadSavingSeconds: '加载节省' };
const UNIT = { detectSeconds: ' s', successSeconds: ' s', failureSeconds: ' s', recoverSeconds: ' s', syncSeconds: ' s', computeSeconds: ' s', saveSeconds: ' s', stepSeconds: ' s', pauseSeconds: ' s', switchSeconds: ' s', repairSeconds: ' s', startupTargetSeconds: ' s', blockingTargetSeconds: ' s', durableLagSeconds: ' s', decompressSeconds: ' s', communicationBeforeSeconds: ' s', communicationTargetSeconds: ' s', graphTargetSeconds: ' s', migrationSeconds: ' s', loadSavingSeconds: ' s' };
const SCENARIO_KEYS = new Set(['eligibleShare', 'success', 'failureSeconds', 'share']);
const fmtParams = (nom, der, hideScenario) => Object.keys(nom).filter((k) => !(hideScenario && SCENARIO_KEYS.has(k))).filter((k) => !(Number(nom[k]) === 0 && Number(der[k] ?? nom[k]) === 0)).map((k) => { const mul = k === 'overhead' ? 100 : 1; const a = +(nom[k] * mul).toFixed(3), b = +((der[k] ?? nom[k]) * mul).toFixed(3); return `${PK[k] ?? k} ${a}${a !== b ? `→${b}` : ''}${k === 'overhead' ? ' %' : UNIT[k] ?? ''}`; }).join('，');

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
function legend(x, y, items, kind = 'line') { let off = 0; return items.map((it) => { const lx = x + off; off += 30 + textW(it.name) + 14; return kind === 'line' ? `<line x1="${lx}" x2="${lx + 18}" y1="${y}" y2="${y}" stroke="var(--s${it.slot + 1})" stroke-width="2.5" stroke-linecap="round"${it.dash ? ' stroke-dasharray="6 4"' : ''}/><text x="${lx + 24}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--s${it.slot + 1})"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join(''); }
/** diverging colour class for an improvement factor k (log scale): red = must improve, blue = slack */
const kcls = (k) => { if (!(k > 0)) return 'mid'; const l = Math.log10(k); if (Math.abs(l) < 0.0414) return 'mid'; const t = Math.min(4, Math.max(1, Math.ceil(Math.abs(l) / 0.3))); return (l > 0 ? 'n' : 'h') + t; };
const isDark = (c) => c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';

function build(report) {
  const cfg = CFG[report];
  mkdirSync(cfg.dir, { recursive: true });
  const S = Object.fromEntries(cfg.sets.map((k) => [k, IN.sets[k]]));
  const M = IN.sets[cfg.main];
  const CMP = cfg.compare ? IN.sets[cfg.compare] : null;
  const setLabel = (k) => IN.sets[k].label.zh;
  const mechName = (id) => M.library[id]?.name?.zh ?? IN.sets.latest.library[id]?.name?.zh ?? id;
  const tag = cfg.tag;
  const z = (k, N) => IN.sets[k].perSize[N];
  const idsLabel = (k, N) => { const a = z(k, N).agree; if (!a.ids.length) return a.feasible ? '无需机制' : '—'; const p2 = new Set(a.steps.filter((s) => s.phase === 2).map((s) => s.id)); return a.ids.map((id) => (p2.has(id) ? `${id}②` : id)).join(' + '); };
  const overList = (rows) => rows.filter((r) => r.overRealloc).sort((a, b) => b.realloc.k - a.realloc.k).map((r) => `${dom(r.id)} ×${kf(r.realloc.k)}`);
  const vt = z(cfg.main, SIZES[0]).verification?.trials ?? IN.trials;

  /* ---------- chart 1: heatmap of the per-class improvement factors ---------- */
  function chartHeat() {
    const cols = [];
    for (const N of SIZES) {
      cols.push({ N, key: 'hw', label: '仅硬件', rows: C[N].hardwareOnly.agreeEqual.rows, set: null });
      for (const k of cfg.sets) cols.push({ N, key: k, label: cfg.sets.length > 1 ? ({ remap: '原有', new: '新增', combined: '合并', latest: '最新' })[k] : '机制后', rows: z(k, N).classes, set: k });
    }
    const W = 960, labelW = 150, Tp = 74, rowH = 19, legH = 64, groupGap = 6;
    const colW = Math.floor((W - labelW - 20 - (SIZES.length - 1) * groupGap) / cols.length);
    const H = Tp + classOrder.length * rowH + legH;
    const xOf = (ci) => labelW + 10 + ci * colW + Math.floor(ci / (cols.length / SIZES.length)) * groupGap;
    let g = svgOpen('chart-heat', W, H) + `<text x="14" y="20" class="ttl">图 1 · AGREE 分配：各事件类相对自身预算的改进倍数 k（当前中断率 ÷ 允许中断率；红 = 须改进，蓝 = 有余量；带框 = 松弛再分配后仍须改进的硬件任务）</text>`;
    SIZES.forEach((N, j) => { const first = cols.findIndex((c) => c.N === N); const n = cols.filter((c) => c.N === N).length; const x = xOf(first); g += `<text x="${x + (n * colW) / 2}" y="${Tp - 26}" text-anchor="middle" class="t2" style="font-weight:600">${zhN(N)}</text>`; });
    cols.forEach((c, ci) => { g += `<text x="${xOf(ci) + colW / 2}" y="${Tp - 9}" text-anchor="middle" class="m">${esc(c.label)}</text>`; });
    classOrder.forEach((id, i) => {
      const y = Tp + i * rowH;
      const grp = GROUPS.find(([gk]) => CLASSES.find((c) => c.id === id).group === gk)?.[1] ?? '';
      const firstOfGroup = i === 0 || CLASSES.find((c) => c.id === classOrder[i - 1]).group !== CLASSES.find((c) => c.id === id).group;
      g += `<text x="14" y="${y + rowH / 2 + 4}" class="t2" style="font-size:11px">${esc(dom(id))}${firstOfGroup ? ` <tspan class="m" style="font-size:9.5px">${esc(grp)}</tspan>` : ''}</text>`;
      cols.forEach((c, ci) => {
        const r = c.rows.find((x) => x.id === id);
        const k = r.k, cls = kcls(k), x = xOf(ci);
        const setTxt = c.set ? `${setLabel(c.set)}的 AGREE 机制集后` : '仅改硬件（无机制）';
        const tip = `${esc(dom(id))} ${esc(shortName(id))} · ${zhN(c.N)} · ${setTxt}\n当前 ${pt(r.pts, 3)} pt，AGREE 预算 ${pt(r.budget, 3)} pt → k = ${kf(k)}（${k > 1 ? '须改进' : '有余量'}）\n再分配后 k′ = ${kf(r.realloc.k)}${r.overRealloc ? `：硬件任务，允许 FIT ${num(r.realloc.allowedFit, 0)}（当前 ${num(C[c.N].classes.find((q) => q.id === id).fit, 0)}）` : '：无硬件任务'}\n每次事件平均停顿 ${num(r.pauseS, 0)} s，预算允许 ${Number.isFinite(r.pauseStarS) ? num(r.pauseStarS, 0) : '∞'} s`;
        g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" fill="var(--${cls})" data-tip="${tip}"/>`;
        if (r.overRealloc) g += `<rect x="${x + 2.5}" y="${y + 2.5}" width="${colW - 5}" height="${rowH - 5}" fill="none" stroke="var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 2.5}" y="${y + 2.5}" width="${colW - 5}" height="${rowH - 5}" fill="none" stroke="var(--ink)" stroke-width="1.4" pointer-events="none"/>`;
        g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${isDark(cls) ? ' onDark' : ''}" pointer-events="none">${kf(k)}</text>`;
      });
    });
    const ly = Tp + classOrder.length * rowH + 14, sx = 14 + 70;
    ['h4', 'h3', 'h2', 'h1', 'mid', 'n1', 'n2', 'n3', 'n4'].forEach((c, i) => { g += `<rect x="${sx + i * 26}" y="${ly}" width="24" height="12" fill="var(--${c})"/>`; });
    g += `<text x="${sx - 6}" y="${ly + 10}" text-anchor="end" class="m tick">k ≤ 0.06</text><text x="${sx + 9 * 26 + 6}" y="${ly + 10}" class="m tick">k ≥ 16（每格 ×2；k 为当前类中断率 ÷ AGREE 预算在该类停顿下允许的中断率）</text><text x="${sx + 4 * 26 + 12}" y="${ly + 23}" text-anchor="middle" class="m">1</text>`;
    g += `<text x="14" y="${ly + 38}" class="m">预算：每类 (1.5 pt − 非域暂停项) / 18（参考目录按每卡·小时计，n_i = N 对所有类相同，重要度 1、工时比 1 → AGREE 等分）；"仅硬件"列的再分配结果与 Albert 最小努力法一致。</text></svg>`;
    const table = `<table class="tv"><tr><th>域</th>${cols.map((c) => `<th class="num">${zhN(c.N)}<br>${esc(c.label)}<br><span class="small">k / k′ / 允许 FIT</span></th>`).join('')}</tr>${classOrder.map((id) => `<tr><td>${esc(dom(id))} ${esc(shortName(id))}</td>${cols.map((c) => { const r = c.rows.find((x) => x.id === id); return `<td class="num">${kf(r.k)} / ${kf(r.realloc.k)} / ${num(r.realloc.allowedFit, 0)}</td>`; }).join('')}</tr>`).join('')}</table>`;
    return { svg: g, table };
  }

  /* ---------- chart 2: A_op vs N ---------- */
  function chartAop() {
    const grid = M.curveGrid;
    const series = [];
    const push = (cv, cvD, name, leg, short, dash = false) => series.push({ nom: cv.points, der: cvD.points, maxN: cv.maxN, maxNDer: cvD.maxN, name, leg, short, dash, slot: series.length });
    const cur = M.curves;
    push(cur.baseline, cur.baselineDerated, '基线（无机制）', '基线', '基线');
    for (const N of SIZES) { const key = `agree${N}`; if (!cur[key]) continue; const feas = M.perSize[N].agree.feasible; push(cur[key], cur[`${key}Derated`], `${zhNs(N)}卡 AGREE 集（${cur[key].ids.length} 项${feas ? '' : '，不达标'}）`, `${zhNs(N)}卡 AGREE 集（${cur[key].ids.length} 项）`, `${zhNs(N)}卡 AGREE 集`); }
    if (cur.allOn) push(cur.allOn, cur.allOnDerated, `全部 ${M.players.length} 项同时启用`, `全部 ${M.players.length} 项`, `全部 ${M.players.length} 项`);
    const prev = prevStudy(cfg.main);
    if (prev && JSON.stringify(prev.curveGrid) === JSON.stringify(grid) && prev.curves.plan200000 && series.length < 6) push(prev.curves.plan200000, prev.curves.plan200000Derated, `对照：规划器 20 万卡集（${prev.curves.plan200000.ids.length} 项，上一报告）`, '规划器 20 万卡集（对照）', '规划器 20 万集', true);
    if (CMP && series.length < 6) { const ck = Object.keys(CMP.curves).filter((k) => k.startsWith('agree') && !k.endsWith('Derated')).sort((a, b) => Number(b.replace('agree', '')) - Number(a.replace('agree', ''))).find((k) => CMP.perSize[Number(k.replace('agree', ''))].agree.feasible) ?? 'agree200000'; if (CMP.curves[ck]) push(CMP.curves[ck], CMP.curves[`${ck}Derated`], `对照：仅原有机制的 ${zhNs(Number(ck.replace('agree', '')))}卡 AGREE 集（${CMP.curves[ck].ids.length} 项）`, `仅原有 ${zhNs(Number(ck.replace('agree', '')))}卡集（对照）`, '仅原有集', true); }
    const W = 960, H = 360, L = 54, Rm = 172, Tp = 54, B = 40, pw = W - L - Rm, ph = H - Tp - B;
    const lx0 = Math.log10(grid[0]), lx1 = Math.log10(grid[grid.length - 1]);
    const xs = (N) => L + ((Math.log10(N) - lx0) / (lx1 - lx0)) * pw;
    const ys = (a) => Tp + ((1 - Math.max(0.8, a)) / 0.2) * ph;
    let g = svgOpen('chart-aop', W, H) + `<text x="${L}" y="20" class="ttl">图 2 · 运行可用率 A_op 随规模的变化（${esc(setLabel(cfg.main))}的 AGREE 机制集；名义参数实线，色带到降额参数）</text>` + legend(L, 38, series.map((s) => ({ name: s.leg, slot: s.slot, dash: s.dash })));
    for (let v = 80; v <= 100; v += 5) { const y = ys(v / 100); g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="m tick">${v} %</text>`; }
    for (const N of [5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]) { const x = xs(N); g += `<line x1="${x}" x2="${x}" y1="${Tp + ph}" y2="${Tp + ph + 5}" class="axis"/><text x="${x}" y="${Tp + ph + 18}" text-anchor="middle" class="m tick">${kfmt(N)}</text>`; }
    g += `<line x1="${L}" x2="${L + pw}" y1="${Tp + ph}" y2="${Tp + ph}" class="axis"/><text x="${L + 150}" y="${H - 6}" text-anchor="middle" class="m">集群规模 N（卡，对数轴）</text>`;
    const yT = ys(TARGET);
    g += `<line x1="${L}" x2="${L + pw}" y1="${yT}" y2="${yT}" class="ref"/><text x="${L + 6}" y="${yT - 5}" class="t2">目标 A_op ≥ ${pct(TARGET, 1)} %</text>`;
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
    g += `<text x="${L + pw}" y="${H - 6}" text-anchor="end" class="m">● 目标线上的圆点：名义参数下仍满足 98.5 % 的最大规模；虚线 = 对照</text>`;
    g += `<g class="xh" id="aop-xh" style="display:none"><line id="aop-xl" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" class="ref"/>${series.map((s) => `<circle id="aop-c${s.slot}" r="5" fill="var(--s${s.slot + 1})" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g><rect class="hit" id="aop-hit" x="${L}" y="${Tp}" width="${pw}" height="${ph}"/></svg>`;
    const data = { grid, x: grid.map((N) => +xs(N).toFixed(1)), series: series.map((s) => ({ name: s.name, nominal: s.nom.map((p) => p.value), derated: s.der.map((p) => p.value), y: s.nom.map((p) => +ys(p.value).toFixed(1)) })) };
    const table = `<table class="tv"><tr><th>N</th>${series.map((s) => `<th class="num">${esc(s.name)}<br><span class="small">名义 / 降额</span></th>`).join('')}</tr>${grid.map((N, i) => `<tr><td class="num">${N.toLocaleString('en-US')}</td>${series.map((s) => `<td class="num">${pct(s.nom[i].value)} / ${pct(s.der[i].value)}</td>`).join('')}</tr>`).join('')}<tr><td>满足 98.5 % 的最大 N</td>${series.map((s) => `<td class="num">${s.maxN.toLocaleString('en-US')} / ${s.maxNDer.toLocaleString('en-US')}</td>`).join('')}</tr></table>`;
    return { svg: g, data, table, series };
  }

  /* ---------- chart 3: closure heatmap (mechanism importance from the allocation view) ---------- */
  function chartClosure() {
    const players = M.players;
    const imp = (N, id) => M.perSize[N].importance.find((x) => x.id === id);
    const avg = (id) => SIZES.reduce((a, N) => a + imp(N, id).single, 0) / SIZES.length;
    const ids = players.slice().sort((a, b) => avg(b) - avg(a));
    const vmax = Math.max(...SIZES.flatMap((N) => players.map((id) => Math.abs(imp(N, id).single))));
    const two = ids.length > 12;
    const half = two ? Math.ceil(ids.length / 2) : ids.length;
    const blocks = two ? [ids.slice(0, half), ids.slice(half)] : [ids];
    const W = 960, labelW = two ? 150 : 170, colW = two ? 60 : 90, effW = 40, rowH = 21, Tp = 62, legH = 60, gap = 28;
    const blockW = labelW + SIZES.length * colW + effW;
    const x0s = two ? [14, 14 + blockW + gap] : [14];
    const H = Tp + half * rowH + legH;
    let g = svgOpen('chart-closure', W, H) + `<text x="14" y="20" class="ttl">图 3 · 分配视角的机制重要度：单独启用时消除的"超预算量"Σ_i max(0, pt_i − pt_i*)（百分点）；带框 = 该规模 AGREE 机制集所含（悬停见末位移除值）</text>`;
    const cls = (v) => { if (Math.abs(v) < 0.00005) return 'mid'; const k = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.abs(v) / vmax) * 4))); return (v > 0 ? 'h' : 'n') + k; };
    blocks.forEach((blk, bi) => {
      const x0 = x0s[bi];
      g += `<text x="${x0}" y="${Tp - 8}" class="m">${bi === 0 ? '机制（按平均消除量排序）' : '（续）'}</text>`;
      SIZES.forEach((N, j) => { g += `<text x="${x0 + labelW + j * colW + colW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">${zhN(N)}</text>`; });
      g += `<text x="${x0 + labelW + SIZES.length * colW + effW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">工作量</text>`;
      blk.forEach((id, i) => {
        const y = Tp + i * rowH;
        g += `<text x="${x0}" y="${y + rowH / 2 + 4}" class="t2" style="font-size:11px"><tspan class="m">${tag(id)}</tspan> ${esc(id)}</text>`;
        SIZES.forEach((N, j) => {
          const im = imp(N, id); const v = im.single; const c = cls(v); const x = x0 + labelW + j * colW;
          const tip = `${esc(id)} ${esc(mechName(id))} · ${zhN(N)}\n单独启用：消除超预算 ${sgn(v, 3)} pt，A_op ${sgn(im.aOpSingle, 3)} pt，单独补齐 ${im.closedClasses.length} 类${im.closedClasses.length ? `（${im.closedClasses.map(dom).join('、')}）` : ''}${im.inSet ? `\n在 AGREE 集内：末位移除后超预算回升 ${sgn(im.lastRemoved ?? 0, 3)} pt，A_op 下降 ${sgn(im.aOpLast ?? 0, 3)} pt` : ''}`;
          g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" fill="var(--${c})" data-tip="${tip}"/>`;
          if (im.inSet) g += `<rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" stroke="var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" stroke="var(--ink)" stroke-width="1.5" pointer-events="none"/>`;
          g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${isDark(c) ? ' onDark' : ''}" pointer-events="none">${v === 0 ? '0' : pt(v, 2)}</text>`;
        });
        g += `<text x="${x0 + labelW + SIZES.length * colW + effW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2 tick">${M.library[id].effort}</text>`;
      });
    });
    const ly = Tp + half * rowH + 16, sx = 14 + 60;
    ['mid', 'h1', 'h2', 'h3', 'h4'].forEach((c, i) => { g += `<rect x="${sx + i * 26}" y="${ly}" width="24" height="12" fill="var(--${c})"/>`; });
    g += `<text x="${sx - 6}" y="${ly + 10}" text-anchor="end" class="m tick">0</text><text x="${sx + 5 * 26 + 6}" y="${ly + 10}" class="m tick">${pt(vmax, 2)} pt（色阶按 √值分级）</text>`;
    g += `<text x="14" y="${ly + 36}" class="m">${esc(cfg.famNote)}。单独消除量把替代机制（重执行 / 弹性 / 进程重调度）各自记满，不是公平分摊；集内的边际作用见悬停与数据表。静默错误检测、checkpoint 类对 A_op 预算无消除量（它们改善的是正确交付）。</text></svg>`;
    const table = `<table class="tv"><tr><th>机制</th>${SIZES.map((N) => `<th class="num">${zhN(N)}<br><span class="small">单独消除 / A_op 单独 / 末位移除（pt）· 单独补齐类数</span></th>`).join('')}</tr>${ids.map((id) => `<tr><td>${tag(id)} ${esc(id)} ${esc(mechName(id))}</td>${SIZES.map((N) => { const im = imp(N, id); return `<td class="num">${sgn(im.single)} / ${sgn(im.aOpSingle)} / ${im.inSet ? sgn(im.lastRemoved ?? 0) : '—'} · ${im.closedClasses.length}</td>`; }).join('')}</tr>`).join('')}</table>`;
    return { svg: g, table, ids };
  }

  /* ---------- tables ---------- */
  function hardwareTable() {
    const row = (label, f) => `<tr><td class="k" style="white-space:normal">${label}</td>${SIZES.map((N) => `<td>${f(N, C[N])}</td>`).join('')}</tr>`;
    const worst = (rows) => rows.slice().sort((a, b) => b.k - a.k)[0];
    return `<div class="table-wrap"><table>
<tr><th style="width:24%">量（30 天窗口，A_op 口径；无机制）</th>${SIZES.map((N) => `<th>${zhN(N)}</th>`).join('')}</tr>
${row('基线 A_op · 缺口 · λ_job · R̄', (N, c) => `${pct(c.baseline.aOp)} % · ${c.baseline.aOp >= TARGET ? `余量 ${pt(c.baseline.aOp - TARGET)}` : `缺 ${pt(TARGET - c.baseline.aOp)}`} pt · ${num(c.baseline.lambdaJob, 3)} /h · ${num(c.baseline.recoveryS, 0)} s`)}
${row('AGREE 预算：非域暂停项（固定扣除）· 每类 pt_i* · 允许停顿范围 p̄_i*（CORE … BOXIO）', (N, c) => { const rows = c.hardwareOnly.agreeEqual.rows; const p = rows.map((r) => r.pauseStarS); return `${pt(c.budget.fixed, 3)} pt · ${pt(c.budget.perClassEqual, 4)} pt · ${num(Math.min(...p), 0)}–${num(Math.max(...p), 0)} s`; })}
${row('严格 AGREE（各类独立达标）：超预算类数 · 最差类 k · 复算 A_op（各类按 λ_i* 缩放）', (N, c) => { const a = c.hardwareOnly.agreeEqual; const w = worst(a.rows); return `${a.overCount} / ${a.rows.length} · ${dom(w.id)} ×${kf(w.k)} · ${pct(a.check.strict)} %`; })}
${row('松弛再分配（余量类不恶化；= Albert 最小努力法）：须改进类数 · 共同允许 FIT · 最大 k′ · 复算 A_op', (N, c) => { const a = c.hardwareOnly.agreeEqual; const over = a.rows.filter((r) => r.overRealloc); if (!over.length) return '无需改进'; return `${over.length} 类 · ${num(over[0].realloc.allowedFit, 0)} FIT · ${dom(over.slice().sort((x, y) => y.realloc.k - x.realloc.k)[0].id)} ×${kf(Math.max(...over.map((r) => r.realloc.k)))} · ${pct(a.check.realloc)} %`; })}
${row('对照 ARINC（等比）：全部类 × f · 允许 FIT 合计 · MTBI ≥', (N, c) => `× ${num(c.hardwareOnly.uniformFactor, 3)} · ${num(c.classes.reduce((a, x) => a + x.fit, 0) * c.hardwareOnly.uniformFactor, 0)} FIT · ${num(c.hardwareOnly.mtbiStarHours, 2)} h`)}
${row('敏感性：复杂度按物理单元计（卡 / 节点 / 机柜 / 分区，假设）时的最差三类 k', (N, c) => c.hardwareOnly.agreePhysical.rows.slice().sort((a, b) => b.k - a.k).slice(0, 3).map((r) => `${dom(r.id)} ×${kf(r.k)}`).join('，'))}
</table></div>`;
  }
  function setTable() {
    const row = (label, f) => `<tr><td class="k" style="white-space:normal">${label}</td>${SIZES.map((N) => `<td>${f(N)}</td>`).join('')}</tr>`;
    let html = `<div class="table-wrap"><table class="dense"><tr><th style="width:24%">机制族 · 量</th>${SIZES.map((N) => `<th>${zhN(N)}</th>`).join('')}</tr>`;
    for (const k of cfg.sets) {
      const lab = cfg.sets.length > 1 ? `<b>${esc(setLabel(k))}</b>：` : '';
      html += row(`${lab}AGREE 机制集（① 按类补缺 → ② 造余量）· 工作量`, (N) => { const a = z(k, N).agree; return `${a.feasible ? '' : '<b>不达标</b>；'}${esc(idsLabel(k, N))} · ${a.effort}`; });
      html += row(`${lab}A_op 名义 / 降额 · P(窗口 ≥ 98.5 %) [Wilson] · 判定`, (N) => { const q = z(k, N); const v = q.verification; return `${pct(q.planned.aOp)} / ${pct(q.plannedDerated.aOp)} %${v ? ` · ${pct(v.pAtLeastTarget, 1)} % [${pct(v.wilson[0], 1)}–${pct(v.wilson[1], 1)}] · <b>${v.verdict}</b>` : ''}`; });
      html += row(`${lab}方案后硬件任务：k′ > 1 的类（其余不动）· 对照 ARINC 等比 × f`, (N) => { const q = z(k, N); const ol = overList(q.classes); return `${ol.length ? ol.join('，') : '无（余量 ' + pt(q.realloc.remaining - q.classes.filter((r) => r.over).reduce((s, r) => s + r.pts, 0), 2) + ' pt）'} · × ${num(q.uniformResidual, 2)}${q.uniformResidual >= 1 ? '（余量）' : ''}`; });
      if (cfg.sets.length > 1 && k !== cfg.main) continue;
      html += row(`${lab}对照：规划器集（${esc(cfg.prevName.replace(/^上一报告 /, ''))}）· 工作量 · A_op 名义 / 降额 · 其 AGREE 视角的硬件任务`, (N) => { const p = z(k, N).plannerRef; if (!p) return '—'; const same = p.ids.join('+') === z(k, N).agree.ids.join('+'); return `${same ? '<i>与 AGREE 集相同</i>' : esc(p.ids.join(' + ') || '无需机制')} · ${p.effort} · ${pct(p.nominal)} / ${pct(p.derated)} %${p.feasible ? '' : '（不达标）'} · ${p.agreeView.overRealloc.length ? p.agreeView.overRealloc.map(dom).join('、') + `（最大 ×${kf(p.agreeView.maxK)}）` : '无'}`; });
    }
    return html + '</table></div>';
  }
  function mechanismTable() {
    const members = M.players.filter((id) => SIZES.some((N) => M.perSize[N].agree.ids.includes(id)) || (CMP && SIZES.some((N) => CMP.perSize[N].agree.ids.includes(id))));
    const aud = (id) => AUDIT.mechanisms.find((m) => m.id === id);
    const role = (id) => { const a = aud(id); return a ? `${a.lever}（${a.eventCandidates.length} 类候选事件）` : ''; };
    const cols = cfg.sets.length > 1 ? cfg.sets : [cfg.main];
    const closure = (N, id) => { const im = M.perSize[N].importance.find((x) => x.id === id); return im ? `${pt(im.single)} / ${im.inSet ? pt(im.lastRemoved ?? 0) : '—'}` : '—'; };
    return `<div class="table-wrap"><table class="dense"><tr><th style="width:${cols.length > 1 ? 21 : 26}%">机制（进入任一 AGREE 集的 ${members.length} 项）</th><th style="width:${cols.length > 1 ? 43 : 38}%">参数：名义→降额（无箭头 = 不降额${M === IN.sets.latest ? '；扩展项公共情景：适用 1→0.95、成功 0.95→0.87、失败尝试 0 s' : ''}）</th><th class="num" style="width:5%">工作量</th>${cols.map((k) => `<th style="width:${cols.length > 1 ? 6 : 10}%">${cols.length > 1 ? esc(({ remap: '原有', new: '新增', combined: '合并' })[k] ?? k) + '<br>' : 'AGREE 集<br>'}1/10/20/50 万</th>`).join('')}<th class="num">消除超预算 pt<br>20 万 单独 / 末位 · 50 万</th></tr>${members.map((id) => { const nom = M.nominal[id] ?? IN.sets.latest.nominal[id]; const der = M.derated[id] ?? IN.sets.latest.derated[id]; return `<tr><td class="k" style="white-space:normal" title="${esc(role(id))}">${tag(id)} <b>${esc(id)}</b> <span class="small">${esc(mechName(id))}</span></td><td><span class="small">${esc(fmtParams(nom, der, M === IN.sets.latest && IN.extensions.includes(id)))}</span></td><td class="num">${M.library[id]?.effort ?? IN.sets.latest.library[id].effort}</td>${cols.map((k) => `<td style="white-space:nowrap">${SIZES.map((N) => (IN.sets[k].players.includes(id) ? (z(k, N).agree.ids.includes(id) ? (z(k, N).agree.steps.find((s) => s.id === id)?.phase === 2 ? '◐' : '●') : '○') : '·')).join('')}</td>`).join('')}<td class="num">${closure(200000, id)} · ${closure(500000, id)}</td></tr>`; }).join('')}</table></div>`;
  }
  function classTable() {
    const fitTotal = C[100000].classes.reduce((a, x) => a + x.fit, 0);
    const req = (r) => { if (!r.key) return r.over ? '<b>无机制作用</b>' : '—'; const q = r.requirement; const base = `${esc(r.key.id)}`; if (!q) return base; if (!q.closable) return `${base}：参数到极限仍不足`; if (q.needed === q.nominal) return `${base}：名义值即达预算`; return `${base}：${PK[q.param] ?? q.param} ${q.nominal}→${q.dir === 'down' ? '≤' : '≥'} ${Number(q.needed.toPrecision(3))}${UNIT[q.param] ?? ''}`; };
    const kcell = (r) => `<td class="num${r.overRealloc ? ' hw' : ''}">${kf(r.k)}${r.overRealloc ? `<b>/${kf(r.realloc.k)}</b>` : ''}</td>`;
    const multi = cfg.sets.length > 1;
    const head = multi
      ? `${SIZES.slice(1).map((N) => `<th class="num">仅硬件<br>${zhNs(N)}</th>`).join('')}${cfg.sets.map((k) => `<th class="num">${esc(({ remap: '原有', new: '新增', combined: '合并' })[k])}集后<br>20 万 · 50 万</th>`).join('')}<th>关键机制 @20 万（合并集）· 独自补齐所需参数</th>`
      : `${SIZES.slice(1).map((N) => `<th class="num">仅硬件<br>${zhNs(N)}</th>`).join('')}${SIZES.slice(1).map((N) => `<th class="num">机制后<br>${zhNs(N)}</th>`).join('')}<th class="num">允许 FIT<br>50 万 机制后</th><th>关键机制 @20 万 · 独自补齐所需参数</th>`;
    const body = classOrder.map((id) => {
      const c = C[100000].classes.find((x) => x.id === id);
      const flags = [c.flags.replay ? 'r' : '', c.flags.process ? 'p' : '', c.flags.elastic ? 'e' : '', c.flags.netfail ? 'n' : ''].filter(Boolean).join(' ') || '<b>无</b>';
      const hw = SIZES.slice(1).map((N) => kcell(C[N].hardwareOnly.agreeEqual.rows.find((r) => r.id === id))).join('');
      const r200 = z(cfg.main, 200000).classes.find((r) => r.id === id);
      const r500 = z(cfg.main, 500000).classes.find((r) => r.id === id);
      const after = multi
        ? cfg.sets.map((k) => { const a = z(k, 200000).classes.find((r) => r.id === id), b = z(k, 500000).classes.find((r) => r.id === id); const f = (r) => `${kf(r.k)}${r.overRealloc ? `<b>/${kf(r.realloc.k)}</b>` : ''}`; return `<td class="num">${f(a)} · ${f(b)}</td>`; }).join('')
        : SIZES.slice(1).map((N) => kcell(z(cfg.main, N).classes.find((r) => r.id === id))).join('') + `<td class="num">${r500.overRealloc ? `<b>${num(r500.realloc.allowedFit, 0)}</b>` : `${num(c.fit, 0)}（不变）`}</td>`;
      return `<tr><td class="k">${esc(dom(id))} <span class="small">${esc(shortName(id))}</span></td><td class="num">${num(c.fit, 1)}</td><td class="num">${(c.fit / fitTotal * 100).toFixed(1)} %</td><td style="white-space:nowrap">${flags}</td><td class="num">${pt(C[100000].hardwareOnly.agreeEqual.rows.find((r) => r.id === id).pts, 3)}</td>${hw}${after}<td class="small">${req(r200)}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="dense cls"><tr><th>域</th><th class="num">当前 FIT</th><th class="num">占 λ</th><th>梯级<sup>†</sup></th><th class="num">基线 pt<br>10 万</th>${head}</tr>${body}</table></div>`;
  }
  function conclusions() {
    const rows = SIZES.map((N) => {
      const q = z(cfg.main, N);
      const hw = C[N].hardwareOnly.agreeEqual;
      const hwOver = hw.rows.filter((r) => r.overRealloc).sort((a, b) => b.realloc.k - a.realloc.k);
      const ol = overList(q.classes);
      const strictOver = q.classes.filter((r) => r.over).sort((a, b) => b.k - a.k);
      const top = q.importance.filter((x) => x.inSet).sort((a, b) => (b.lastRemoved ?? 0) - (a.lastRemoved ?? 0)).slice(0, 3).map((x) => `${x.id} ${sgn(x.lastRemoved ?? 0)}`).join('，');
      const topSingle = q.importance.slice().sort((a, b) => b.single - a.single).slice(0, 3).map((x) => `${x.id} ${sgn(x.single)}`).join('，');
      const p = q.plannerRef;
      let main;
      if (!q.agree.ids.length && q.agree.feasible) main = `基线已达标（余量 ${pt(q.planned.aOp - TARGET)} pt）；AGREE 各类均在预算内，仅硬件时允许全部类恶化到 ×${num(1 / hw.rows[0].k, 1)}（等分预算 ${pt(C[N].budget.perClassEqual, 3)} pt/类）。`;
      else {
        const hwLine = hwOver.length && cfg.sets.length === 1 ? `仅改硬件：AGREE 要求 ${hwOver.length} 类降到共同水平 ${num(hwOver[0].realloc.allowedFit, 0)} FIT（最差 ${dom(hwOver[0].id)} ×${kf(hwOver[0].realloc.k)}；ARINC 等比则全部 ×${num(1 / C[N].hardwareOnly.uniformFactor, 2)}）。` : '';
        const setLine = q.agree.feasible ? `AGREE 两阶段选出 ${q.agree.ids.length} 项（工作量 ${q.agree.effort}）：${pct(q.planned.aOp)} / 降额 ${pct(q.plannedDerated.aOp)} %，P(窗口) ${pct(q.verification.pAtLeastTarget, 1)} %（${q.verification.verdict}）；方案后${ol.length ? `仍有硬件任务 ${ol.join('，')}` : `无硬件任务（${strictOver.length} 类严格超预算由他类余量再分配吸收）`}。` : `无可行集：${q.agree.ids.length} 项全部启用 ${pct(q.planned.aOp)} / ${pct(q.plannedDerated.aOp)} %，缺 ${pt(TARGET - q.planned.aOp)} pt → AGREE 再分配把硬件任务集中到 ${ol.join('，')}（其余 ${q.classes.length - q.overReallocIds.length} 类不动${cfg.sets.length > 1 ? '' : `；ARINC 等比则全部 ×${num(1 / q.uniformResidual, 2)}`}）。`;
        const cmpLine = p ? (p.ids.join('+') === q.agree.ids.join('+') ? `规划器给出同一集合。` : `规划器集 ${p.ids.join(' + ') || '∅'}（工作量 ${p.effort}）${pct(p.nominal)} / ${pct(p.derated)} %：${p.effort < q.agree.effort ? '工作量更低' : p.effort > q.agree.effort ? '工作量更高' : '工作量相同'}${p.nominal > q.planned.aOp ? '、A_op 更高' : '、A_op 更低'}，AGREE 按类补缺的路径先取对单类消除量最大的廉价项。`) : '';
        main = `${hwLine}${setLine}${cmpLine}`;
      }
      const weak = strictOver.length ? `严格超预算 ${strictOver.length} 类：${strictOver.slice(0, 5).map((r) => `${dom(r.id)} ×${kf(r.k)}`).join('，')}${strictOver.length > 5 ? ' …' : ''}${ol.length ? `；再分配后 ${ol.join('，')}` : '；再分配后无'}` : '无';
      return `<tr><td class="k" style="white-space:normal"><b>${zhN(N)}</b><br>${q.agree.feasible ? '<span class="ok">达标</span>' : '<span class="crit">不达标</span>'}</td><td>${main}</td><td>${weak}</td><td>${top ? `集内末位移除：${top}<br>` : ''}单独消除：${topSingle}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="concl"><tr><th style="width:9%">规模 · 判定</th><th style="width:52%">结论（AGREE 口径：每类预算 = (1.5 pt − 非域项)/18）</th><th style="width:21%">薄弱环节（k = 当前 ÷ 允许；k′ 为再分配后的硬件任务）</th><th>最重要的机制（消除超预算，pt）</th></tr>${rows}</table></div>`;
  }
  function crossNote() {
    const q2 = z(cfg.main, 200000), q5 = z(cfg.main, 500000), q1 = z(cfg.main, 100000);
    const ceil = (k) => { const c = IN.sets[k].curves; const best = Object.keys(c).filter((x) => !x.endsWith('Derated') && x !== 'baseline').map((x) => c[x]).sort((a, b) => b.maxN - a.maxN)[0]; return best; };
    const fam = cfg.sets.length > 1 ? cfg.sets.map((k) => `${setLabel(k)} ${kfmt(ceil(k).maxN)} 卡`).join('、') : `${kfmt(ceil(cfg.main).maxN)} 卡（${ceil(cfg.main).ids.length} 项）${CMP ? `，仅原有机制 ${kfmt(ceil(cfg.compare).maxN)} 卡` : ''}`;
    const hwNote = `① 仅改硬件时 AGREE 等分预算在 10 万卡让 ${C[100000].hardwareOnly.agreeEqual.overCount} 类超预算（CORE ×${kf(C[100000].hardwareOnly.agreeEqual.rows.find((r) => r.id === 'CORE-hard').k)}、UNKNOWN ×${kf(C[100000].hardwareOnly.agreeEqual.rows.find((r) => r.id === 'UNKNOWN-hard').k)}、MEMT ×${kf(C[100000].hardwareOnly.agreeEqual.rows.find((r) => r.id === 'MEMT-hard').k)}），BOXIO / OPT / FABRIC 有余量；按"余量类不恶化"再分配后与 Albert 最小努力法完全一致，而 ARINC 让全部类同比 ×${num(1 / C[100000].hardwareOnly.uniformFactor, 2)}——方法只改变"在类之间怎么拆"，总预算相同；`;
    const mechNote = `② 机制改变的是各类的停顿 p̄_i，从而改变允许中断率 λ_i* = pt_i*·3600/(A*·p̄_i)：有梯级（r / p / e）的类停顿从 ${num(C[200000].baseline.recoveryS, 0)} s 降到 ${num(Math.min(...q2.classes.map((r) => r.pauseS)), 0)} s 一级，预算余量反过来接济无梯级的 POWER / COOL / MGMT / STORAGE / UNKNOWN；20 万卡${q2.agree.feasible ? `因此达标（${pct(q2.planned.aOp)} / 降额 ${pct(q2.plannedDerated.aOp)} %），方案后无硬件任务` : `仍不达标（${pct(q2.planned.aOp)} %），硬件任务 ${overList(q2.classes).join('，')}`}；`;
    const bigNote = `③ 50 万卡无可行集（${pct(q5.planned.aOp)} %）：AGREE 把剩余缺口折成 ${q5.overReallocIds.length} 类的硬件任务（${overList(q5.classes).join('，')}），其余 ${q5.classes.length - q5.overReallocIds.length} 类不动——比 ARINC 等比 ×${num(1 / q5.uniformResidual, 2)} 便宜得多，但这 ${q5.overReallocIds.length} 类正是没有任何机制覆盖的事件，只能靠硬件或新梯级；`;
    const selNote = `④ AGREE 两阶段选集与规划器的差别：10 万卡 ${q1.agree.ids.join(' + ')}（${pct(q1.planned.aOp)} %）vs 规划器 ${q1.plannerRef ? q1.plannerRef.ids.join(' + ') : '—'}（${q1.plannerRef ? pct(q1.plannerRef.nominal) : '—'} %）；按类补缺先取单类消除量最大的廉价项，造余量阶段才补 R-ELASTIC 这类"对已达标类再加码"的机制，所以 20 万卡集更大（工作量 ${q2.agree.effort} vs ${q2.plannerRef?.effort ?? '—'}）但校核概率更高（${pct(q2.verification.pAtLeastTarget, 1)} % vs ${prevStudy(cfg.main)?.perSize?.[200000]?.verification ? pct(prevStudy(cfg.main).perSize[200000].verification.pAtLeastTarget, 1) : '—'} %）；上限 ${fam}；`;
    const sens = `⑤ 敏感性：若复杂度按物理单元数（卡 / 节点 / 机柜 / 分区）计，机柜级与分区级的类预算缩小 ${Math.round(C[100000].counts.gpus / C[100000].counts.racks)}–${Math.round(C[100000].counts.gpus / C[100000].counts.zones / 1000)}k 倍，POWER / COOL / STORAGE 的 k 升到 ×${kf(C[100000].hardwareOnly.agreePhysical.rows.find((r) => r.id === 'POWER-hard').k)} / ×${kf(C[100000].hardwareOnly.agreePhysical.rows.find((r) => r.id === 'COOL-hard').k)} / ×${kf(C[100000].hardwareOnly.agreePhysical.rows.find((r) => r.id === 'STORAGE-hard').k)}（10 万卡）——AGREE 的结论取决于"模块"的定义，参考目录按每卡·小时归一是本报告采用等分的原因。`;
    return `<div class="callout"><b>跨规模结论</b>：${hwNote}${mechNote}${bigNote}${selNote}${sens}</div>`;
  }

  /* ---------- assemble ---------- */
  const c1 = chartHeat(), c2 = chartAop(), c3 = chartClosure();
  writeFileSync(`${cfg.dir}/fig1-agree-factors.svg`, c1.svg);
  writeFileSync(`${cfg.dir}/fig2-aop-vs-n.svg`, c2.svg);
  writeFileSync(`${cfg.dir}/fig3-closure.svg`, c3.svg);
  const gen = IN.generated.slice(0, 10);
  const q2 = z(cfg.main, 200000), q5 = z(cfg.main, 500000);
  const playersNote = report === 'remap'
    ? `候选机制 = ReMAP 原有 12 项中有参数变换的 8 项（${IN.original.join('、')}；R-CKPT / R-MANUAL 为基线本身，H-PROTECT / H-RELIABILITY 无增量参数），库内目标参数。`
    : report === 'comparison'
      ? `三个机制族分别作为候选：ReMAP 原有 8 项（库内目标参数）；审核新增 16 项中有变换的 15 项（空缺的集成参数按临时假设填入：适用 100 %、成功 90 %、失败尝试 10 s、FP8 / FP4 风险占比各 1/3，标注 assumed）；两者合并 23 项。`
      : `候选机制 = 最新 ReMAP（github.com/lzq0927/remap，commit ${IN.remap.commit.slice(0, 7)}，${IN.remap.date}）的全部机制：原有 8 项有变换者 + 扩展 16 项中的 15 项（I-CONTAIN 为支撑能力），扩展参数取 ReMAP 的显式情景 <code>extensionScenario()</code>（适用 100 %，FP8 / FP4 各占 CORE 静默风险 50 %，成功 95 %，失败尝试 0 s，开销 0 / ABFT 0.1 %），按期望值折入 HAC-D 参数（与上一报告相同）。`;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.tabTitle)}</title>
<meta name="description" content="54 条事件参考目录上，用 AGREE 分配法（复杂度 × 重要度 × 工作时间；本目录下为等分）把 98.5 % 运行可用率目标拆到 18 个硬件事件类，给出 ${esc(cfg.doc)}在 1 万 / 10 万 / 20 万 / 50 万卡下的硬件故障率允许值与机制参数分配、薄弱环节和关键机制，并与 ARINC、Albert 和此前的规划器结果对照（HAC-D，${gen}）。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; --ok:#2d7a4f; --crit:#b3382c; --hw:#fbe6e4; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#7cc89a; --crit:#e07a6f; --hw:#4a2622; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#7cc89a; --crit:#e07a6f; --hw:#4a2622; }
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
  .small { font-size: 11.3px; color: var(--muted); } .ok { color: var(--ok); font-weight: 600; } .crit { color: var(--crit); font-weight: 600; }
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
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; }
  @media screen and (max-width: 760px) { .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 700px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.3px; line-height: 1.34; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7px; line-height: 1.26; } th, td { padding: 1px 2.5px; } th { font-size: inherit; } table.dense { font-size: 6.4px; line-height: 1.18; } table.dense th, table.dense td { padding: 0.4px 2px; } table.dense th { white-space: normal; } td.num { white-space: normal; }
    #p1 .table-wrap:first-of-type table { font-size: 6.8px; line-height: 1.22; }
    code { font-size: 7px; } .small { font-size: 6.9px; } .callout, .formula, .sub, footer { font-size: 7.4px; } .callout, .formula { margin: 3px 0; padding: 3px 7px; } footer { font-size: 6.9px; }
    h1 { font-size: 14px; margin: 2px 0 3px; } h2 { font-size: 10.5px; margin: 4px 0 2px; padding-top: 3px; } .eyebrow { font-size: 7.5px; }
    figure.chart { margin: 2px 0 2px; } figcaption { font-size: 7.2px; margin-top: 0; } details.tv { display: none; } .tip { display: none !important; }
    p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    figure.chart.c1 svg { height: ${report === 'comparison' ? 262 : 280}px; } figure.chart.c2 svg { height: ${report === 'comparison' ? 158 : 168}px; } figure.chart.c3 svg { height: ${report === 'comparison' ? 160 : c3.ids.length > 12 ? 174 : 168}px; }
    table.concl { font-size: 6.8px; line-height: 1.22; } table.concl th, table.concl td { padding: 1px 2.5px; }
  }
</style>
</head>
<body>
<main>
<section class="page" id="p1">
  <div class="eyebrow">HAC-D · ${esc(cfg.short)} · ${gen} · 第 1 / 2 页</div>
  <h1>${esc(cfg.title)}</h1>
  <p class="sub"><b>口径</b>：A_op = 30 天窗口内运行时间占比，目标 ≥ 98.5 %（预算 1.5 pt），对象为 54 条事件的参考审核目录（中断 / 亚健康 / 静默 FIT 3333.3 / 69.0 / 48.3 每卡·小时），基线恢复 12.5 s 发现 + 180 s 自动尝试 @ 99 % + 2 h 人工（R̄ 264.5 s），τ 300 s、δ 4 s——与此前三份报告相同，不同之处只在分配方法。${playersNote} 规划器降额（覆盖率 / 适用比例 −5 pt、成功率 −8 pt、时间 ×1.5）、${vt} 个窗口的账本校核（Wilson 区间）同前。</p>
  <div class="formula"><b>AGREE 分配法</b>（串联系统）：子系统 i 有 n_i 个模块、重要度 E_i = P(系统失效 | i 失效)、工作时间 t_i，R_i = 1 − (1 − R*^{n_i/N}) / E_i，λ_i = −ln R_i / t_i（HAC-D <code>allocation.agree</code>，R* = e^{−λ*T}，一阶后按 Σλ_i = λ* 缩放）。用于可用率目标时同一权重拆不可用度：<b>pt_i* = (1.5 pt − 非域暂停项) · n_i / Σn</b>，允许中断率 <b>λ_i* = pt_i* · 3600 / (A* · p̄_i)</b>（p̄_i = 该类每次事件在机制集下的平均停顿，秒），改进倍数 <b>k_i = λ_i / λ_i*</b>（> 1 须改进，< 1 有余量），允许 FIT = 当前 FIT / k_i。每个硬中断都停作业 → E_i = 1；各类整窗暴露 → t_i = T；参考目录把所有类都归一到每卡·小时 → n_i = N 相同，AGREE 退化为 18 类等分（HAC-D 分配页的 <code>coincidingMethods</code> 会提示这一点）。非域暂停项（亚健康隔离、静默错误即时检出、预测误报）作为固定子系统先扣除。<b>再分配</b>：有余量的类不恶化、保留现状，余量按同一权重补给超预算的类（逐轮直到稳定），得 k′_i——它才是硬件任务。<b>机制选择（AGREE 两阶段）</b>：① 按类补缺——每步加入"对超预算类消除的超预算量 ÷ 工作量"最大的机制；② 造余量——若目标仍未在名义与降额下成立，而剩余超预算类已无机制可用，则按 A_op 增益 ÷ 工作量加入作用于已达标类的机制，其余量经再分配补给前者。复算：各类按 λ_i* 缩放后用引擎重算 A_op 应回到 98.5 %。</div>
  <h2 class="first">1. 仅改硬件：AGREE 等分 vs ARINC 等比 vs Albert（无机制）</h2>
  ${hardwareTable()}
  <h2>2. ${cfg.sets.length > 1 ? '三个机制族' : esc(setLabel(cfg.main))}的 AGREE 机制集、硬件任务与规划器对照（A_op 口径；② = 造余量阶段加入）</h2>
  ${setTable()}
  ${crossNote()}
  <figure class="chart c1">${c1.svg}<figcaption>图 1：仅硬件列 = 无机制时各类相对等分预算的倍数（CORE、UNKNOWN、MEMT 最差，BOXIO / OPT / FABRIC 有余量）；机制后列 = AGREE 集把有梯级类的 k 压到 1 以下（它们的余量再分配给无梯级类），带框的 ${overList(q5.classes).length ? overList(q5.classes).map((s) => s.split(' ')[0]).join('、') : '—'} 是 50 万卡方案后仍要改硬件的类。</figcaption></figure>
  <details class="tv"><summary>图 1 数据表</summary>${c1.table}</details>
</section>
<section class="page" id="p2">
  <div class="eyebrow">HAC-D · ${esc(cfg.short)} · ${gen} · 第 2 / 2 页</div>
  <figure class="chart c2">${c2.svg}<figcaption>图 2：基线在 ${kfmt(M.curves.baseline.maxN)} 卡以下达标；${SIZES.filter((N) => M.curves[`agree${N}`]).map((N) => `${zhNs(N)}卡 AGREE 集（${M.curves[`agree${N}`].ids.length} 项）到 ${kfmt(M.curves[`agree${N}`].maxN)} 卡（降额 ${kfmt(M.curves[`agree${N}Derated`].maxN)}）`).join('，')}${M.curves.allOn ? `，全部 ${M.players.length} 项 ${kfmt(M.curves.allOn.maxN)} 卡（降额 ${kfmt(M.curves.allOnDerated.maxN)}）` : ''}${c2.series.filter((s) => s.dash).map((s) => `；${s.name.replace(/（.*$/, '')} ${kfmt(s.maxN)} 卡`).join('')}。</figcaption></figure>
  <details class="tv"><summary>图 2 数据表</summary>${c2.table}</details>
  <h2 class="first">3. 关键机制与参数（分配视角：消除的超预算量；● 阶段 ① 加入，◐ 阶段 ② 加入，○ 候选未选，· 不在该族）</h2>
  <figure class="chart c3">${c3.svg}<figcaption>图 3：单独消除量最大的是替代型梯级 R-ELASTIC / R-PROCESS / R-REPLAY（各自补齐 ${Math.max(...q5.importance.map((x) => x.closedClasses.length))} 类以内），其后是作用于所有中断的 D-RECOVERY-CLASSIFY（人工份额）、D-HARD（检测时延）${M.players.includes('C-LOSSLESS') ? '、C-LOSSLESS（读取阶段）' : ''}；集内末位移除值见数据表。</figcaption></figure>
  <details class="tv"><summary>图 3 数据表</summary>${c3.table}</details>
  ${mechanismTable()}
  <h2>4. 硬件故障率分配（每单元·小时 FIT，业务影响口径）：仅硬件与机制后的 AGREE 倍数 k（粗体 = 再分配后硬件任务 k′）</h2>
  ${classTable()}
  <p class="small"><sup>†</sup>梯级（目录逐事件标记）：r 重执行、p 进程重调度、e DP 域弹性、n 网络容错。每格 = 严格 AGREE 倍数 k（当前 ÷ 允许）；底色 / 粗体 = 再分配后仍 > 1 的硬件任务 k′。"允许 FIT 50 万 机制后"= 当前 FIT / k′（k′ ≤ 1 的类保持当前值，不作为验收限值放宽）。"关键机制"= 20 万卡 AGREE 集中移除后该类超预算回升最多的一项；"独自补齐所需参数"= 其余参数不变，只动该机制的主参数到使该类达预算的值（二分求得），"到极限仍不足"= 参数归零 / 封顶也补不齐，须新梯级或硬件。${report !== 'remap' ? ' C-LOSSLESS、D-RECOVERY-CLASSIFY、R-WARM-PROCESS、R-RUNTIME-SNAPSHOT 作用于所有经全局恢复的中断，无梯级的类也受益。' : ''}</p>
  <h2>5. 结论：各规模的薄弱环节与最重要的机制（AGREE 口径）</h2>
  ${conclusions()}
  <footer>复现：<code>node --import tsx scripts/agree-allocation-98p5.ts --trials ${vt}</code> → <code>node scripts/build-agree-allocation-98p5.mjs --report ${report}</code>；同一分配可在分配页选 AGREE（<code>hacd allocate &lt;s.json&gt; --availability 0.985 --method agree</code>）复现单步。公式与方法：docs/ALLOCATION_METHODS_MECHANISM_PARAMETERS.zh.html、docs/ALLOCATION_METHODS_SUMMARY.zh.html、docs/MODEL_REFERENCE.md §22–§24。事件率为参考目录先验，机制参数为目标值或 ReMAP 情景，须以本集群实测替换。</footer>
</section>
</main>
<script type="application/json" id="aop-data">${JSON.stringify(c2.data)}</script>
<script>
(function(){
  function tipFor(el){ var f = el.closest('figure'); if(!f) return null; var t = f.querySelector('.tip'); if(!t){ t = document.createElement('div'); t.className='tip'; f.appendChild(t);} return t; }
  function place(t, f, ev){ var r = f.getBoundingClientRect(); var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14; if (x + 350 > r.width) x = Math.max(0, ev.clientX - r.left - 350); t.style.left = x + 'px'; t.style.top = y + 'px'; }
  document.querySelectorAll('[data-tip]').forEach(function(el){ el.addEventListener('mousemove', function(ev){ var f = el.closest('figure'); var t = tipFor(el); if(!t) return; t.textContent = el.getAttribute('data-tip'); t.style.display='block'; place(t, f, ev); }); el.addEventListener('mouseleave', function(){ var t = tipFor(el); if(t) t.style.display='none'; }); });
  var data = JSON.parse(document.getElementById('aop-data').textContent);
  var svg = document.getElementById('chart-aop'); if(!svg) return;
  var hit = document.getElementById('aop-hit'), xh = document.getElementById('aop-xh'), xl = document.getElementById('aop-xl'); var fig = svg.closest('figure'); var tip = tipFor(hit);
  function fmt(v){ return (v*100).toFixed(2) + ' %'; }
  hit.addEventListener('mousemove', function(ev){ var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; var p = pt.matrixTransform(svg.getScreenCTM().inverse()); var best = 0; for (var i = 1; i < data.x.length; i++) if (Math.abs(data.x[i] - p.x) < Math.abs(data.x[best] - p.x)) best = i; xl.setAttribute('x1', data.x[best]); xl.setAttribute('x2', data.x[best]); data.series.forEach(function(s, k){ var c = document.getElementById('aop-c' + k); c.setAttribute('cx', data.x[best]); c.setAttribute('cy', s.y[best]); }); xh.style.display = ''; tip.textContent = 'N = ' + data.grid[best].toLocaleString('en-US') + ' 卡\\n' + data.series.map(function(s){ return s.name + '：' + fmt(s.nominal[best]) + '（降额 ' + fmt(s.derated[best]) + '）'; }).join('\\n'); tip.style.display = 'block'; place(tip, fig, ev); });
  hit.addEventListener('mouseleave', function(){ xh.style.display = 'none'; tip.style.display = 'none'; });
})();
</script>
</body>
</html>
`;
  writeFileSync(cfg.out, html);
  console.log(`written ${cfg.out} (${(html.length / 1024).toFixed(0)} kB) and three SVGs in ${cfg.dir}`);
}

const which = flag('report') ?? 'all';
for (const r of which === 'all' ? Object.keys(CFG) : [which]) build(r);
