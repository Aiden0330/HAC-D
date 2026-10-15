/**
 * v3.7 standalone HTML of the cross-scale allocation study: summary table per size, recovery-parameter levers, three inline
 * SVG charts with hover tooltips and table views (metric vs N with the largest supported size per mechanism set; loss
 * composition per size against the budget; Shapley heatmap with the plan membership), mechanism parameters, hardware FIT
 * allocation per domain and generated conclusions. Palette: the validated data-viz defaults (light and dark), one hue per
 * entity, diverging blue–red for the Shapley cells.
 */
import { NON_DOMAIN_GROUPS, type StudyResult, type StudySize, type StudyDecomposition } from '../study/index.js';
import { esc, pct, num, sgn, jsonScript, REPORT_CSS, REPORT_FONTS, TOOLTIP_JS } from './common.js';
import type { ReportLang } from './auditReport.js';

const kfmt = (N: number) => (N >= 1e6 ? `${(N / 1e6).toFixed(N % 1e6 ? 1 : 0)}M` : N >= 1e5 ? `${Math.round(N / 1e3)}k` : `${(N / 1e3).toFixed(1).replace(/\.0$/, '')}k`);
const sizeName = (N: number, lang: ReportLang) => (lang === 'zh' ? (N >= 10000 ? `${+(N / 10000).toFixed(2)} 万卡` : `${N} 卡`) : `${kfmt(N)} cards`);
const sizeShort = (N: number, lang: ReportLang) => (lang === 'zh' ? (N >= 10000 ? `${+(N / 10000).toFixed(2)} 万` : `${N}`) : kfmt(N));
const metricName = (m: StudyResult['metric'], lang: ReportLang) => (m === 'aOp' ? (lang === 'zh' ? '运行可用率 A_op' : 'operational availability A_op') : m === 'delivered' ? (lang === 'zh' ? '正确交付 goodput' : 'delivered goodput') : lang === 'zh' ? '有效 goodput' : 'effective goodput');
const metricShort = (m: StudyResult['metric']) => (m === 'aOp' ? 'A_op' : m === 'delivered' ? 'G_d' : 'G_eff');

const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const VIZ_STYLE = `
svg.viz { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --mid:#f0efec; --h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; font-family:${FONT}; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; } }
:root[data-theme="dark"] svg.viz { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --grid:#2c2c2a; --axis:#383835; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --mid:#383835; --h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; }
svg.viz text { fill: var(--ink); font-size: 12px; } svg.viz .t2 { fill: var(--ink2); font-size: 11.5px; } svg.viz .m { fill: var(--muted); font-size: 11px; } svg.viz .tick { font-variant-numeric: tabular-nums; } svg.viz .ttl { font-size: 13px; font-weight: 600; }
svg.viz .grid { stroke: var(--grid); stroke-width: 1; } svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .ref { stroke: var(--ink2); stroke-width: 1; } svg.viz .hit { fill: transparent; pointer-events: all; } svg.viz .xh { pointer-events: none; } svg.viz .cellt { font-size: 12px; font-variant-numeric: tabular-nums; } svg.viz .onDark { fill: var(--surface); }
`;
const svgOpen = (id: string, W: number, H: number) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"><style>${VIZ_STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
const textW = (s: string) => Array.from(s).reduce((a, ch) => a + (/[　-鿿＀-￯]/.test(ch) ? 12 : 6.6), 0);
function legend(x: number, y: number, items: { name: string; slot: number }[], kind: 'line' | 'rect' = 'line'): string {
  let off = 0;
  return items.map((it) => { const lx = x + off; off += 30 + textW(it.name) + 14; return kind === 'line' ? `<line x1="${lx}" x2="${lx + 18}" y1="${y}" y2="${y}" stroke="var(--s${it.slot + 1})" stroke-width="2.5" stroke-linecap="round"/><text x="${lx + 24}" y="${y + 4}" class="t2">${esc(it.name)}</text>` : `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="var(--s${it.slot + 1})"/><text x="${lx + 18}" y="${y + 4}" class="t2">${esc(it.name)}</text>`; }).join('');
}

const T = {
  zh: { eyebrow: 'HAC-D · 跨规模分配研究', title: (m: string, t: number) => `${(t * 100).toFixed(1)} % ${m}目标下的可靠性分配`, metricAxis: (m: string) => m, fig1: (m: string) => `图 1 · ${m}随集群规模的变化（名义参数实线，色带到降额参数的下限）`, fig1note: '● 目标线上的圆点：名义参数下仍满足目标的最大规模', fig1x: '集群规模 N（卡，对数轴）', baseline: '基线（无机制）', planOf: (n: string, k: number) => `${n}方案（${k} 项）`, allOn: (k: number) => `全部 ${k} 项`, target: '目标', fig2: '图 2 · 损失的构成（百分点）：基线 vs 该规模的推荐机制方案，预算线', fig2x: '损失（百分点）', budget: '预算', base: '基线', plan: '方案', fig3: (m: string) => `图 3 · 各机制对${m}的 Shapley 贡献（百分点）；带框 = 该规模推荐方案所含机制`, mech: '机制（按平均贡献排序）', effort: '工作量', neg: '负值 = 在该链序与参数下反而拉低指标（替代了更快的梯级、误报停顿）', sampled: '采样 Shapley（置换抽样，±为 95 % 半宽）', s1: '1. 各规模的分配结果一览', s2: '2. 机制集之上的恢复参数杠杆（库外参数）', s3: '3. 关键机制：Shapley 归因与参数', s4: '4. 硬件故障率分配（每单元·小时 FIT；允许值 = 当前 × 方案后硬件因子，ARINC 等比）', s5: '5. 结论：各规模的薄弱环节与最重要的机制', dataTable: '数据表',
    rows: { base: (m: string) => `基线 ${m} · 缺口`, lam: '作业中断率 λ_job · MTBI · R̄', hw: '仅改硬件：故障率 × f（允许 FIT 合计）· MTBI ≥ · 最小努力法', rec: '仅改恢复：R̄ 须 ≤ · 阶段预算', plan: '推荐机制集（最低工作量可行集）· 工作量 · 必要机制', planv: (m: string) => `方案 ${m} 名义 / 降额`, resid: '方案后硬件因子（名义 / 降额）', ver: (t: number) => `校核：P(窗口 ≥ ${(t * 100).toFixed(1)} %) [Wilson 95 %] · 判定 · 均值 ± t 半宽 · 5 % 分位`, weak: '方案后残余损失的主要来源' },
    gap: (g: number) => (g >= 0 ? `余量 ${num(g * 100, 2)} pt` : `缺 ${num(-g * 100, 2)} pt`), infeasible: '无可行集；价值最高的集：', necessary: '必要：', metBaseline: '基线已达标', slack: '（余量）', mustImprove: '（仍须改进）', improved: (k: number, fit: number) => `${k} 个域降到 ${num(fit, 0)} FIT`, met: '已满足', greedy: '贪心', leverHead: '机制集之上的恢复参数杠杆', leverCols: (m: string) => `${m} 名义 / 降额 · 硬件因子`,
    levers: { plan: '推荐机制集（库内参数）', auto60: '+ 自动恢复尝试 → 60 s', ps999: '+ 自动恢复成功率 → 99.9 %', manual30: '+ 人工恢复 → 30 min', 'auto60+ps999': '+ 自动 60 s 与成功率 99.9 %', 'auto60+manual30': '+ 自动 60 s 与人工 30 min', 'ps999+manual30': '+ 成功率 99.9 % 与人工 30 min', all3: '+ 三项同时' },
    mechCols: ['机制', '参数：名义→降额（无箭头 = 不降额）', '工作量', '进入方案', 'Shapley（各规模）'], domCols: ['域', '当前 FIT', '占 λ', '梯级', '方案后停顿 s · 残余', '允许 FIT', '最小努力'], domNote: '梯级：r 重执行、p 进程重调度、e DP 域弹性、n 网络切换、h 热替换、f 预测迁移，以及审核机制的 id（按目录逐事件标记）。"方案后停顿 · 残余"取最大规模的方案；最小努力列 ● = 仅靠硬件达标时该域须降到共同水平（各规模）。',
    concl: { met: (n: string, v: string) => `${n}：基线已达标（${v} %）`, need: (n: string, g: string) => `${n}：缺 ${g} pt`, nofeas: (n: string, g: string) => `${n}：缺 ${g} pt，候选机制不够`, planLine: (ids: string, e: number, v: string, d: string) => `推荐 ${ids}（工作量 ${e}）→ ${v} %（降额 ${d} %）`, bestLine: (ids: string, v: string) => `价值最高的集 ${ids} 只到 ${v} %`, verLine: (p: string, lo: string, hi: string, verdict: string) => `校核 P(窗口 ≥ 目标) = ${p} % [${lo}–${hi}]，判定 ${verdict}`, hwLine: (f: number) => (f >= 1 ? `方案后硬件余量 × ${num(f, 2)}` : `方案后硬件仍须 × ${num(1 / f, 2)}（故障率降到 ${num(f * 100, 0)} %）`), leverLine: (id: string, v: string) => `恢复杠杆 ${id} 可达 ${v} %`, weakLine: (items: string) => `薄弱环节（方案后残余）：${items}`, cross: '跨规模结论', top: (items: string) => `最重要的机制（平均 Shapley）：${items}`, negs: (items: string) => `贡献为负、不应与更快梯级同时启用：${items}`, none: '无' },
    footer: (g: string) => `由 HAC-D 生成（hacd study · MCP allocation_study · 机制审核与分配报告页），${g}。所有事件率与机制参数为参考目录 / 文献先验或临时假设，须以本集群实测替换。`,
  },
  en: { eyebrow: 'HAC-D · cross-scale allocation study', title: (m: string, t: number) => `Reliability allocation for a ${(t * 100).toFixed(1)} % ${m} target`, metricAxis: (m: string) => m, fig1: (m: string) => `Figure 1 · ${m} vs cluster size (nominal parameters solid, band down to the derated value)`, fig1note: '● dots on the target line: largest size that still meets the target (nominal)', fig1x: 'cluster size N (cards, log axis)', baseline: 'baseline (no mechanism)', planOf: (n: string, k: number) => `${n} plan (${k})`, allOn: (k: number) => `all ${k}`, target: 'target', fig2: 'Figure 2 · loss composition (points): baseline vs the recommended set at each size, budget line', fig2x: 'loss (points)', budget: 'budget', base: 'baseline', plan: 'plan', fig3: (m: string) => `Figure 3 · Shapley contribution of each mechanism to ${m} (points); framed = in the recommended set at that size`, mech: 'mechanism (by mean contribution)', effort: 'effort', neg: 'negative = lowers the metric in this chain order (displaces faster rungs, false alarms)', sampled: 'sampled Shapley (permutations; ± = 95 % half-width)', s1: '1. Allocation results per size', s2: '2. Recovery-parameter levers on top of the mechanism set', s3: '3. Key mechanisms: Shapley attribution and parameters', s4: '4. Hardware failure-rate allocation (FIT per unit-hour; allowed = current × residual hardware factor, ARINC)', s5: '5. Conclusions: weak links and the most important mechanisms per size', dataTable: 'data table',
    rows: { base: (m: string) => `baseline ${m} · gap`, lam: 'λ_job · MTBI · R̄', hw: 'hardware only: rates × f (allowed FIT) · MTBI ≥ · minimum effort', rec: 'recovery only: R̄ ≤ · stage budgets', plan: 'recommended set (cheapest feasible) · effort · necessary', planv: (m: string) => `plan ${m} nominal / derated`, resid: 'residual hardware factor (nominal / derated)', ver: (t: number) => `verification: P(window ≥ ${(t * 100).toFixed(1)} %) [Wilson 95 %] · verdict · mean ± t · P5`, weak: 'main residual loss after the plan' },
    gap: (g: number) => (g >= 0 ? `slack ${num(g * 100, 2)} pt` : `gap ${num(-g * 100, 2)} pt`), infeasible: 'no feasible set; best: ', necessary: 'necessary: ', metBaseline: 'baseline meets the target', slack: ' (slack)', mustImprove: ' (still needed)', improved: (k: number, fit: number) => `${k} domains to ${num(fit, 0)} FIT`, met: 'met', greedy: 'greedy', leverHead: 'levers on top of the mechanism set', leverCols: (m: string) => `${m} nominal / derated · hardware factor`,
    levers: { plan: 'recommended set (library parameters)', auto60: '+ automatic attempt → 60 s', ps999: '+ automatic success → 99.9 %', manual30: '+ manual recovery → 30 min', 'auto60+ps999': '+ 60 s and 99.9 %', 'auto60+manual30': '+ 60 s and 30 min', 'ps999+manual30': '+ 99.9 % and 30 min', all3: '+ all three' },
    mechCols: ['mechanism', 'parameters: nominal → derated', 'effort', 'in plan', 'Shapley (per size)'], domCols: ['domain', 'current FIT', 'share of λ', 'rungs', 'pause s · residual after plan', 'allowed FIT', 'min. effort'], domNote: 'rungs: r replay, p process rescheduling, e DP elasticity, n network failover, h hot-swap, f prediction, plus audited mechanism ids (per-event flags). Pause · residual use the largest size; minimum effort ● = the domain must drop to the common level when hardware alone meets the target.',
    concl: { met: (n: string, v: string) => `${n}: baseline meets the target (${v} %)`, need: (n: string, g: string) => `${n}: gap ${g} pt`, nofeas: (n: string, g: string) => `${n}: gap ${g} pt, the candidates are not enough`, planLine: (ids: string, e: number, v: string, d: string) => `recommended ${ids} (effort ${e}) → ${v} % (derated ${d} %)`, bestLine: (ids: string, v: string) => `best set ${ids} reaches only ${v} %`, verLine: (p: string, lo: string, hi: string, verdict: string) => `verification P(window ≥ target) = ${p} % [${lo}–${hi}], ${verdict}`, hwLine: (f: number) => (f >= 1 ? `hardware slack × ${num(f, 2)} after the plan` : `hardware must still improve × ${num(1 / f, 2)} (rates to ${num(f * 100, 0)} %)`), leverLine: (id: string, v: string) => `lever ${id} reaches ${v} %`, weakLine: (items: string) => `weak links (residual after the plan): ${items}`, cross: 'Across sizes', top: (items: string) => `most important mechanisms (mean Shapley): ${items}`, negs: (items: string) => `negative contributions, not to be enabled with faster rungs: ${items}`, none: 'none' },
    footer: (g: string) => `Produced by HAC-D (hacd study · MCP allocation_study · Audit & study page), ${g}. Event rates and mechanism parameters are catalog / literature priors or provisional assumptions; replace them with measurements.`,
  },
} as const;

const PK: Record<string, [string, string, number]> = { coverage: ['覆盖率', '', 1], detectSeconds: ['检测', ' s', 1], success: ['成功率', '', 1], successSeconds: ['成功耗时', ' s', 1], failureSeconds: ['失败耗时', ' s', 1], domains: ['域数', '', 1], recoverSeconds: ['域恢复', ' s', 1], syncSeconds: ['协调', ' s', 1], recall: ['召回', '', 1], precision: ['精度', '', 1], migrationSeconds: ['迁移', ' s', 1], computeSeconds: ['τ', ' s', 1], saveSeconds: ['δ', ' s', 1], loadSavingSeconds: ['加载节省', ' s', 1], overhead: ['开销', ' %', 100], share: ['占比', '', 1], reduction: ['剔除', '', 1], rateFactor: ['进入率×', '', 1], durationFactor: ['持续×', '', 1], eligibleShare: ['适用比例', '', 1], riskShare: ['风险占比', '', 1] };
const fmtParams = (nom: Record<string, number>, der: Record<string, number>) => Object.keys(nom).map((k) => { const [lab, unit, mul] = PK[k] ?? [k, '', 1]; const a = +(nom[k] * mul).toFixed(3), b = +((der[k] ?? nom[k]) * mul).toFixed(3); return `${lab} ${a}${a !== b ? `→${b}` : ''}${unit}`; }).join('，');

function groupVals(d: StudyDecomposition, keys: string[]): number[] {
  return keys.map((k) => (k === 'other' ? Object.entries(d.byGroup).filter(([g]) => !keys.includes(g)).reduce((a, [, v]) => a + v, 0) : d.byGroup[k] ?? 0));
}
function lossVals(d: StudyDecomposition): number[] {
  const l = d.ledger;
  return [l.downtime, l.save, l.rollback, l.sdcRollback, l.terminal, l.slowdown + l.local + l.blocked + l.overhead];
}

export function studyReportHtml(R: StudyResult, lang: ReportLang = 'zh'): string {
  const t = T[lang];
  const M = metricName(R.metric, lang);
  const MS = metricShort(R.metric);
  const sizes = R.sizes;
  const P = R.perSize;
  const isAop = R.metric === 'aOp';
  const mechName = (id: string) => (lang === 'zh' ? R.library[id]?.name.zh ?? id : R.library[id]?.name.en ?? id);
  const planLabel = (N: number) => (P[N].plan.ids.length ? P[N].plan.ids.join(' + ') : lang === 'zh' ? '无需机制' : 'none');
  const groupKeys = (() => { const keys = new Set<string>(); for (const N of sizes) for (const k of Object.keys(P[N].baseline.byGroup)) if (!NON_DOMAIN_GROUPS.includes(k)) keys.add(k); const ordered = [...keys].sort((a, b) => (P[sizes[sizes.length - 1]].baseline.byGroup[b] ?? 0) - (P[sizes[sizes.length - 1]].baseline.byGroup[a] ?? 0)); return [...ordered.slice(0, 5), 'other']; })();
  const groupLabel = (k: string) => (k === 'other' ? (lang === 'zh' ? '其他（亚健康隔离、预测误报、静默检出与暂停等）' : 'other (isolation, false alarms, silent detections and pauses, …)') : lang === 'zh' ? R.groupLabels[k]?.zh ?? k : R.groupLabels[k]?.en ?? k);
  const lossKeys = ['downtime', 'save', 'rollback', 'sdcRollback', 'terminal', 'other'];
  const lossLabel = (k: string) => ({ downtime: lang === 'zh' ? '停机' : 'downtime', save: lang === 'zh' ? 'CKPT 保存' : 'saves', rollback: lang === 'zh' ? '回滚' : 'rollback', sdcRollback: lang === 'zh' ? '静默回滚' : 'silent rollback', terminal: lang === 'zh' ? '期末判废' : 'terminal', other: lang === 'zh' ? '降速 / 域损失 / 备件 / 开销' : 'slowdown / local / blocked / overhead' })[k] ?? k;
  const segKeys = isAop ? groupKeys : lossKeys;
  const segLabel = isAop ? groupLabel : lossLabel;
  const segVals = (d: StudyDecomposition) => (isAop ? groupVals(d, groupKeys) : lossVals(d));

  /* ---------- chart 1 ---------- */
  const seriesKeys = Object.keys(R.curves).filter((k) => !k.endsWith('Derated')).slice(0, 6);
  const seriesName = (k: string) => (k === 'baseline' ? t.baseline : k === 'allOn' ? t.allOn(R.curves[k].ids.length) : t.planOf(sizeName(Number(k.replace('plan', '')), lang), R.curves[k].ids.length));
  const seriesShort = (k: string) => (k === 'baseline' ? t.base : k === 'allOn' ? t.allOn(R.curves[k].ids.length) : (lang === 'zh' ? `${sizeShort(Number(k.replace('plan', '')), lang)}方案` : `${kfmt(Number(k.replace('plan', '')))} plan`));
  const grid = R.curveGrid;
  let c1 = '', c1data: unknown = null, c1table = '';
  if (seriesKeys.length && grid.length) {
    const W = 960, H = 372, L = 54, Rm = 150, Tp = 54, B = 40, pw = W - L - Rm, ph = H - Tp - B;
    const lx0 = Math.log10(grid[0]), lx1 = Math.log10(grid[grid.length - 1]);
    const xs = (N: number) => L + ((Math.log10(N) - lx0) / (lx1 - lx0)) * pw;
    const allVals = seriesKeys.flatMap((k) => [...R.curves[k].points, ...R.curves[`${k}Derated`].points].map((p) => p.value));
    const yMin = Math.max(0, Math.floor((Math.min(...allVals, R.target) * 100 - 1) / 5) * 5) / 100;
    const ys = (a: number) => Tp + ((1 - Math.max(yMin, a)) / (1 - yMin)) * ph;
    c1 = svgOpen('chart-aop', W, H) + `<text x="${L}" y="20" class="ttl">${esc(t.fig1(M))}</text>` + legend(L, 38, seriesKeys.map((k, i) => ({ name: seriesName(k), slot: i })));
    const step = (1 - yMin) * 100 <= 10 ? 2 : (1 - yMin) * 100 <= 25 ? 5 : 10;
    for (let v = Math.round(yMin * 100); v <= 100; v += step) { const y = ys(v / 100); c1 += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="m tick">${v} %</text>`; }
    const ticks = [...new Set([grid[0], ...sizes, grid[grid.length - 1], ...[1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6].filter((n) => n > grid[0] && n < grid[grid.length - 1])])].sort((a, b) => a - b);
    for (const N of ticks) { const x = xs(N); c1 += `<line x1="${x}" x2="${x}" y1="${Tp + ph}" y2="${Tp + ph + 5}" class="axis"/><text x="${x}" y="${Tp + ph + 18}" text-anchor="middle" class="m tick">${kfmt(N)}</text>`; }
    c1 += `<line x1="${L}" x2="${L + pw}" y1="${Tp + ph}" y2="${Tp + ph}" class="axis"/><text x="${L + 150}" y="${H - 6}" text-anchor="middle" class="m">${esc(t.fig1x)}</text>`;
    const yT = ys(R.target);
    c1 += `<line x1="${L}" x2="${L + pw}" y1="${yT}" y2="${yT}" class="ref"/><text x="${L + 6}" y="${yT - 5}" class="t2">${esc(t.target)} ${MS} ≥ ${pct(R.target, 1)} %</text>`;
    seriesKeys.forEach((k, i) => {
      const nom = R.curves[k].points, der = R.curves[`${k}Derated`].points;
      const poly = nom.map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`).concat(der.slice().reverse().map((p) => `${xs(p.N).toFixed(1)},${ys(p.value).toFixed(1)}`)).join(' ');
      c1 += `<polygon points="${poly}" fill="var(--s${i + 1})" opacity="0.14"/>`;
    });
    const labels: { y: number; text: string }[] = [];
    seriesKeys.forEach((k, i) => {
      const nom = R.curves[k].points;
      c1 += `<path d="${nom.map((p, j) => `${j ? 'L' : 'M'}${xs(p.N).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--s${i + 1})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      for (const N of sizes) { const p = nom.find((q) => q.N === N); if (p) c1 += `<circle cx="${xs(N).toFixed(1)}" cy="${ys(p.value).toFixed(1)}" r="4" fill="var(--s${i + 1})" stroke="var(--surface)" stroke-width="2"/>`; }
      const last = nom[nom.length - 1];
      labels.push({ y: ys(last.value), text: `${seriesShort(k)} ${pct(last.value, 1)} %` });
    });
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const lb of labels) c1 += `<text x="${L + pw + 8}" y="${lb.y + 4}" class="t2">${esc(lb.text)}</text>`;
    const marks = seriesKeys.map((k, i) => ({ i, N: R.curves[k].maxN })).filter((mk) => mk.N > grid[0] && mk.N < grid[grid.length - 1]).sort((a, b) => a.N - b.N);
    let prevX = -1e9, prevUp = false;
    for (const mk of marks) { const x = xs(mk.N); const up: boolean = x - prevX < 44 && !prevUp; prevX = x; prevUp = up; c1 += `<circle cx="${x.toFixed(1)}" cy="${yT}" r="4.5" fill="var(--s${mk.i + 1})" stroke="var(--surface)" stroke-width="2"/><text x="${x.toFixed(1)}" y="${up ? yT - 11 : yT + 17}" text-anchor="middle" class="t2 tick">${kfmt(mk.N)}</text>`; }
    c1 += `<text x="${L + pw}" y="${H - 6}" text-anchor="end" class="m">${esc(t.fig1note)}</text>`;
    c1 += `<g class="xh" id="aop-xh" style="display:none"><line id="aop-xl" x1="0" x2="0" y1="${Tp}" y2="${Tp + ph}" class="ref"/>${seriesKeys.map((_, i) => `<circle id="aop-c${i}" r="5" fill="var(--s${i + 1})" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g><rect class="hit" id="aop-hit" x="${L}" y="${Tp}" width="${pw}" height="${ph}"/></svg>`;
    c1data = { grid, x: grid.map((N) => +xs(N).toFixed(1)), series: seriesKeys.map((k) => ({ name: seriesName(k), nominal: R.curves[k].points.map((p) => p.value), derated: R.curves[`${k}Derated`].points.map((p) => p.value), y: R.curves[k].points.map((p) => +ys(p.value).toFixed(1)) })) };
    c1table = `<table><tr><th>N</th>${seriesKeys.map((k) => `<th class="num">${esc(seriesName(k))}<br><span class="small">${lang === 'zh' ? '名义 / 降额' : 'nominal / derated'}</span></th>`).join('')}</tr>${grid.map((N, i) => `<tr><td class="num">${N.toLocaleString('en-US')}</td>${seriesKeys.map((k) => `<td class="num">${pct(R.curves[k].points[i].value)} / ${pct(R.curves[`${k}Derated`].points[i].value)}</td>`).join('')}</tr>`).join('')}<tr><td>max N</td>${seriesKeys.map((k) => `<td class="num">${R.curves[k].maxN.toLocaleString('en-US')} / ${R.curves[`${k}Derated`].maxN.toLocaleString('en-US')}</td>`).join('')}</tr></table>`;
  }

  /* ---------- chart 2 ---------- */
  const rows2 = sizes.flatMap((N) => [{ label: `${sizeShort(N, lang)} · ${t.base}`, N, vals: segVals(P[N].baseline) }, { label: `${sizeShort(N, lang)} · ${t.plan}`, N, vals: segVals(P[N].planned) }]);
  const W2 = 960, L2 = 128, Rm2 = 70, Tp2 = 66, rowP = 25, groupGap = 9, barH = 15, B2 = 36;
  const H2 = Tp2 + rows2.length * rowP + (sizes.length - 1) * groupGap + B2;
  const pw2 = W2 - L2 - Rm2;
  const xmax = Math.max(2, Math.ceil(Math.max(...rows2.map((r) => r.vals.reduce((a, b) => a + b, 0) * 100), (1 - R.target) * 100 * 1.5) / 2) * 2);
  const xs2 = (v: number) => L2 + (v / xmax) * pw2;
  let c2 = svgOpen('chart-unavail', W2, H2) + `<text x="${L2}" y="20" class="ttl">${esc(t.fig2)} ${((1 - R.target) * 100).toFixed(1)} pt</text>` + legend(L2, 38, segKeys.map((k, i) => ({ name: segLabel(k), slot: i })), 'rect');
  const plotTop = Tp2, plotBot = H2 - B2;
  const xstep = xmax <= 6 ? 1 : xmax <= 14 ? 2 : xmax <= 30 ? 5 : 10;
  for (let v = 0; v <= xmax; v += xstep) { const x = xs2(v); c2 += `<line x1="${x}" x2="${x}" y1="${plotTop - 4}" y2="${plotBot}" class="grid"/><text x="${x}" y="${plotBot + 16}" text-anchor="middle" class="m tick">${v}</text>`; }
  c2 += `<text x="${L2 + pw2}" y="${plotBot + 30}" text-anchor="end" class="m">${esc(t.fig2x)}</text>`;
  const xb = xs2((1 - R.target) * 100);
  c2 += `<line x1="${xb}" x2="${xb}" y1="${plotTop - 4}" y2="${plotBot}" class="ref"/><text x="${xb + 4}" y="${plotTop - 8}" class="t2">${esc(t.budget)} ${((1 - R.target) * 100).toFixed(1)} pt</text>`;
  let y2 = plotTop + 4;
  rows2.forEach((r, ri) => {
    if (ri > 0 && ri % 2 === 0) y2 += groupGap;
    const total = r.vals.reduce((a, b) => a + b, 0);
    c2 += `<text x="${L2 - 8}" y="${y2 + barH / 2 + 4}" text-anchor="end" class="t2">${esc(r.label)}</text>`;
    let x = L2;
    r.vals.forEach((v, gi) => {
      const w = ((v * 100) / xmax) * pw2;
      if (w > 0.2) {
        const wi = Math.max(0, w - (gi < r.vals.length - 1 ? 2 : 0));
        c2 += `<rect x="${x.toFixed(1)}" y="${y2}" width="${wi.toFixed(1)}" height="${barH}" rx="${gi === r.vals.length - 1 ? 3 : 0}" fill="var(--s${gi + 1})" data-tip="${esc(r.label)}（${esc(planLabel(r.N))}）\n${esc(segLabel(segKeys[gi]))}：${pct(v)} pt，${total > 0 ? ((v / total) * 100).toFixed(1) : '0'} %"/>`;
      }
      x += w;
    });
    c2 += `<text x="${(x + 6).toFixed(1)}" y="${y2 + barH / 2 + 4}" class="t2 tick">${pct(total)}</text>`;
    y2 += rowP;
  });
  c2 += '</svg>';
  const c2table = `<table><tr><th></th><th>${lang === 'zh' ? '方案' : 'plan'}</th>${segKeys.map((k) => `<th class="num">${esc(segLabel(k))}</th>`).join('')}<th class="num">Σ pt</th></tr>${rows2.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(planLabel(r.N))}</td>${r.vals.map((v) => `<td class="num">${pct(v, 3)}</td>`).join('')}<td class="num">${pct(r.vals.reduce((a, b) => a + b, 0), 3)}</td></tr>`).join('')}</table>`;

  /* ---------- chart 3 ---------- */
  const ids = R.players.filter((id) => P[sizes[0]].gains.some((g) => g.id === id)).sort((a, b) => avg(b) - avg(a));
  function avg(id: string) { return sizes.reduce((s, N) => s + (P[N].gains.find((x) => x.id === id)?.byMetric[R.metric].shapley ?? 0), 0) / sizes.length; }
  const vmax = Math.max(1e-9, ...sizes.flatMap((N) => P[N].gains.map((x) => Math.abs(x.byMetric[R.metric].shapley))));
  const L3 = 262, colW = Math.max(90, Math.min(128, Math.floor(560 / sizes.length))), rowH = 28, Tp3 = 58, effW = 70, legH = 50;
  const W3 = 960, H3 = Tp3 + ids.length * rowH + legH;
  const sampled = sizes.some((N) => P[N].attribution.method === 'sampled');
  let c3 = svgOpen('chart-shapley', W3, H3) + `<text x="16" y="20" class="ttl">${esc(t.fig3(MS))}${sampled ? ` · ${esc(t.sampled)}` : ''}</text><text x="16" y="${Tp3 - 8}" class="m">${esc(t.mech)}</text>`;
  sizes.forEach((N, j) => { c3 += `<text x="${L3 + j * colW + colW / 2}" y="${Tp3 - 8}" text-anchor="middle" class="t2">${esc(sizeName(N, lang))}</text>`; });
  c3 += `<text x="${L3 + sizes.length * colW + effW / 2}" y="${Tp3 - 8}" text-anchor="middle" class="t2">${esc(t.effort)}</text>`;
  const cls = (v: number) => { if (Math.abs(v) < 0.0005) return 'mid'; const k = Math.min(4, Math.floor((Math.abs(v) / vmax) * 4) + 1); return (v > 0 ? 'h' : 'n') + k; };
  ids.forEach((id, i) => {
    const y = Tp3 + i * rowH;
    c3 += `<text x="16" y="${y + rowH / 2 + 4}" class="t2">${esc(id)} <tspan class="m">${esc(mechName(id))}</tspan></text>`;
    sizes.forEach((N, j) => {
      const gn = P[N].gains.find((x) => x.id === id)!;
      const v = gn.byMetric[R.metric].shapley;
      const c = cls(v);
      const x = L3 + j * colW;
      const inPlan = P[N].plan.ids.includes(id);
      const tip = `${esc(id)} ${esc(mechName(id))} · ${esc(sizeName(N, lang))}\nShapley（${MS}）${sgn(v * 100, 3)} pt${gn.halfWidth !== undefined ? ` ± ${num(gn.halfWidth * 100, 3)}` : ''}；${lang === 'zh' ? '单独启用' : 'alone'} ${sgn(gn.byMetric[R.metric].single * 100, 3)}；${lang === 'zh' ? '末位加入' : 'last added'} ${sgn(gn.byMetric[R.metric].lastAdded * 100, 3)}\nShapley（${lang === 'zh' ? '正确交付' : 'delivered'}）${sgn(gn.byMetric.delivered.shapley * 100, 2)} pt${inPlan ? `\n${lang === 'zh' ? '在该规模的推荐方案中' : 'in the recommended set'}` : ''}`;
      c3 += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" fill="var(--${c})" data-tip="${tip}"/>`;
      if (inPlan) c3 += `<rect x="${x + 4}" y="${y + 4}" width="${colW - 8}" height="${rowH - 8}" fill="none" stroke="var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 4}" y="${y + 4}" width="${colW - 8}" height="${rowH - 8}" fill="none" stroke="var(--ink)" stroke-width="1.5" pointer-events="none"/>`;
      const dark = c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';
      c3 += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${dark ? ' onDark' : ''}" pointer-events="none">${sgn(v * 100)}</text>`;
    });
    c3 += `<text x="${L3 + sizes.length * colW + effW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2 tick">${R.library[id]?.effort ?? ''}</text>`;
  });
  const ly = Tp3 + ids.length * rowH + 22;
  ['n4', 'n3', 'n2', 'n1', 'mid', 'h1', 'h2', 'h3', 'h4'].forEach((c, i) => { c3 += `<rect x="${L3 + i * 26}" y="${ly}" width="24" height="12" fill="var(--${c})"/>`; });
  c3 += `<text x="${L3 - 6}" y="${ly + 10}" text-anchor="end" class="m tick">−${(vmax * 100).toFixed(1)} pt</text><text x="${L3 + 9 * 26 + 6}" y="${ly + 10}" class="m tick">+${(vmax * 100).toFixed(1)} pt</text><text x="${L3 + 4 * 26 + 12}" y="${ly + 24}" text-anchor="middle" class="m">0</text><text x="${L3 + 9 * 26 + 80}" y="${ly + 10}" class="m">${esc(t.neg)}</text></svg>`;
  const c3table = `<table><tr><th>${lang === 'zh' ? '机制' : 'mechanism'}</th>${sizes.map((N) => `<th class="num">${esc(sizeName(N, lang))}<br><span class="small">Shapley / ${lang === 'zh' ? '单独 / 末位' : 'alone / last'} (pt)</span></th>`).join('')}</tr>${ids.map((id) => `<tr><td>${esc(id)} ${esc(mechName(id))}</td>${sizes.map((N) => { const gn = P[N].gains.find((x) => x.id === id)!; return `<td class="num">${sgn(gn.byMetric[R.metric].shapley * 100)} / ${sgn(gn.byMetric[R.metric].single * 100)} / ${sgn(gn.byMetric[R.metric].lastAdded * 100)}</td>`; }).join('')}</tr>`).join('')}</table>`;

  /* ---------- tables ---------- */
  const topGroups = (d: StudyDecomposition) => { const vals = segVals(d); const tot = vals.reduce((a, b) => a + b, 0); return segKeys.map((k, i) => [segLabel(k), vals[i]] as const).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, v]) => `${n} ${tot > 0 ? ((v / tot) * 100).toFixed(0) : 0} %`).join('，'); };
  const row = (label: string, f: (N: number, z: StudySize) => string) => `<tr><td>${esc(label)}</td>${sizes.map((N) => `<td>${f(N, P[N])}</td>`).join('')}</tr>`;
  const fitTotal = R.domains.reduce((a, d) => a + d.fit, 0);
  const summary = `<div class="table-wrap"><table>
<tr><th style="width:22%">${lang === 'zh' ? '量（' : '('}${R.scenario.windowH} h${lang === 'zh' ? ' 窗口，' : ' window, '}${MS}${lang === 'zh' ? ' 口径）' : ')'}</th>${sizes.map((N) => `<th>${esc(sizeName(N, lang))}</th>`).join('')}</tr>
${row(t.rows.base(MS), (N, z) => `${pct(z.baseline.value)} % · ${t.gap(z.baseline.value - R.target)}`)}
${row(t.rows.lam, (N, z) => `${num(z.baseline.lambdaJob, 3)} /h · ${num(z.baseline.mtbiHours, 1)} h · ${num(z.baseline.recoveryS, 0)} s`)}
${row(t.rows.hw, (N, z) => `× ${Number.isFinite(z.hardwareOnly.factor) ? num(z.hardwareOnly.factor, 3) : '∞'}（${num(fitTotal * (Number.isFinite(z.hardwareOnly.factor) ? z.hardwareOnly.factor : 1), 0)} FIT）· ${Number.isFinite(z.hardwareOnly.mtbiStarHours) ? num(z.hardwareOnly.mtbiStarHours, 2) : '∞'} h · ${z.hardwareOnly.minimumEffort && z.hardwareOnly.minimumEffort.rows.some((r) => r.improvementFactor > 1.0001) ? t.improved(z.hardwareOnly.minimumEffort.rows.filter((r) => r.improvementFactor > 1.0001).length, z.hardwareOnly.minimumEffort.rows.find((r) => r.improvementFactor > 1.0001)!.allowedFit) : t.met}`)}
${row(t.rows.rec, (N, z) => `${Number.isFinite(z.recoveryOnly.recoveryStarS) ? num(z.recoveryOnly.recoveryStarS, 0) : '∞'} s（× ${Number.isFinite(z.recoveryOnly.factor) ? num(z.recoveryOnly.factor, 3) : '∞'}）${z.recoveryOnly.stages ? ' · ' + z.recoveryOnly.stages.map((s) => num(s.budgetS, 0)).join(' / ') + ' s' : ''}`)}
${row(t.rows.plan, (N, z) => `${z.plan.feasible ? '' : `<b>${t.infeasible}</b>`}${esc(planLabel(N))} · ${z.plan.effort}${z.plan.method === 'greedy' ? ` · ${t.greedy}` : ''}${z.plan.necessary.length ? ` · ${t.necessary}${esc(z.plan.necessary.join('+'))}` : z.plan.feasible && !z.plan.ids.length ? ` · ${t.metBaseline}` : ''}`)}
${row(t.rows.planv(MS), (N, z) => `${pct(z.plan.nominal)} / ${pct(z.plan.derated)} %${z.plan.feasible ? '' : lang === 'zh' ? '（不达标）' : ' (below target)'}`)}
${row(t.rows.resid, (N, z) => `× ${num(z.residualFactor.plan, 2)} / × ${num(z.residualFactor.planDerated, 2)}${z.residualFactor.plan >= 1 ? t.slack : t.mustImprove}`)}
${row(t.rows.ver(R.target), (N, z) => (z.verification ? `${pct(z.verification.pAtLeastTarget, 1)} % [${pct(z.verification.wilson[0], 1)}–${pct(z.verification.wilson[1], 1)}] · <b>${z.verification.verdict}</b> · ${pct(z.verification.value.mean)} ± ${pct(z.verification.value.ci95)} · ${pct(z.verification.value.p05)} %` : '—'))}
${row(t.rows.weak, (N, z) => topGroups(z.planned))}
</table></div>`;
  const leverIds = sizes.flatMap((N) => P[N].levers?.map((l) => l.id) ?? []).filter((v, i, a) => a.indexOf(v) === i);
  const leverTable = leverIds.length ? `<h2>${t.s2}</h2><div class="table-wrap"><table><tr><th>${t.leverHead}</th>${sizes.map((N) => `<th class="num" colspan="3">${esc(sizeName(N, lang))}：${t.leverCols(MS)}</th>`).join('')}</tr>${leverIds.map((id) => `<tr><td>${esc((t.levers as Record<string, string>)[id] ?? id)}</td>${sizes.map((N) => { const z = P[N].levers?.find((l) => l.id === id); return z ? `<td class="num">${pct(z.value)} %</td><td class="num">${pct(z.valueDerated)} %</td><td class="num">× ${num(z.residualFactor, 2)}</td>` : '<td colspan="3">—</td>'; }).join('')}</tr>`).join('')}</table></div>` : '';
  const mechTable = `<div class="table-wrap"><table><tr><th>${t.mechCols[0]}</th><th>${t.mechCols[1]}</th><th class="num">${t.mechCols[2]}</th><th>${t.mechCols[3]}<br><span class="small">${sizes.map((N) => sizeShort(N, lang)).join(' / ')}</span></th>${sizes.map((N) => `<th class="num">${esc(sizeShort(N, lang))}</th>`).join('')}</tr>${ids.map((id) => { const lb = R.library[id]; return `<tr><td><b>${esc(id)}</b> <span class="small">${esc(mechName(id))}</span>${lb?.provisional ? ' <span class="tag assumed">assumed</span>' : ''}</td><td><span class="small">${esc(fmtParams(lb?.parameters ?? {}, lb?.derated ?? {}))}</span></td><td class="num">${lb?.effort ?? ''}</td><td>${sizes.map((N) => (P[N].plan.ids.includes(id) ? '●' : '○')).join('')}</td>${sizes.map((N) => `<td class="num">${sgn((P[N].gains.find((g) => g.id === id)?.byMetric[R.metric].shapley ?? 0) * 100)}</td>`).join('')}</tr>`; }).join('')}</table></div>`;
  const largest = sizes[sizes.length - 1];
  const hardDomains = R.domains.filter((d) => d.fit > 0).sort((a, b) => b.fit - a.fit);
  const flagsOf = (d: StudyResult['domains'][number]) => { const codes: Record<string, string> = { replay: 'r', process: 'p', elastic: 'e', netfail: 'n', hotswap: 'h', predict: 'f' }; const out = Object.entries(d.flags).filter(([, v]) => v > 0).map(([k]) => codes[k] ?? k); return out.length ? out.join(' ') : `<b>${lang === 'zh' ? '无' : 'none'}</b>`; };
  const improved = (N: number, id: string) => { const r = P[N].hardwareOnly.minimumEffort?.rows.find((x) => x.id === id); return r && r.improvementFactor > 1.0001 ? '●' : '○'; };
  const domainTable = `<div class="table-wrap"><table><tr><th>${t.domCols[0]}</th><th class="num">${t.domCols[1]}</th><th class="num">${t.domCols[2]}</th><th>${t.domCols[3]}</th><th class="num">${t.domCols[4]}<br><span class="small">${esc(sizeShort(largest, lang))}</span></th>${sizes.map((N) => `<th class="num">${esc(sizeShort(N, lang))}<br>${t.domCols[5]}</th>`).join('')}<th>${t.domCols[6]}<br><span class="small">${sizes.map((N) => sizeShort(N, lang)).join('/')}</span></th></tr>${hardDomains.map((d) => { const after = P[largest].planned.byDomain[d.id]; return `<tr><td><b>${esc(d.id)}</b> <span class="small">${esc(d.name)}</span></td><td class="num">${num(d.fit, 1)}</td><td class="num">${fitTotal > 0 ? ((d.fit / fitTotal) * 100).toFixed(1) : '0'} %</td><td>${flagsOf(d)}</td><td class="num">${after ? `${num(after.meanPauseS, 0)} · ${(after.share * 100).toFixed(1)} %` : '—'}</td>${sizes.map((N) => `<td class="num">${Number.isFinite(P[N].residualFactor.plan) ? num(d.fit * P[N].residualFactor.plan, 0) : '∞'}</td>`).join('')}<td>${sizes.map((N) => improved(N, d.id)).join('')}</td></tr>`; }).join('')}<tr><td>Σ</td><td class="num">${num(fitTotal, 1)}</td><td class="num">100 %</td><td></td><td></td>${sizes.map((N) => `<td class="num">${Number.isFinite(P[N].residualFactor.plan) ? num(fitTotal * P[N].residualFactor.plan, 0) : '∞'}</td>`).join('')}<td></td></tr></table></div><p class="small">${esc(t.domNote)}</p>`;

  /* ---------- conclusions ---------- */
  const concl = sizes.map((N) => {
    const z = P[N];
    const gap = z.baseline.value - R.target;
    const head = gap >= 0 ? t.concl.met(sizeName(N, lang), pct(z.baseline.value)) : z.plan.feasible ? t.concl.need(sizeName(N, lang), num(-gap * 100, 2)) : t.concl.nofeas(sizeName(N, lang), num(-gap * 100, 2));
    const lines: string[] = [];
    if (gap < 0 && z.plan.feasible) lines.push(t.concl.planLine(z.plan.ids.join(' + '), z.plan.effort, pct(z.plan.nominal), pct(z.plan.derated)));
    if (!z.plan.feasible) lines.push(t.concl.bestLine(z.plan.best.ids.join(' + ') || '∅', pct(z.plan.best.value)));
    if (z.verification) lines.push(t.concl.verLine(pct(z.verification.pAtLeastTarget, 1), pct(z.verification.wilson[0], 1), pct(z.verification.wilson[1], 1), z.verification.verdict));
    if (Number.isFinite(z.residualFactor.plan) && z.residualFactor.plan > 0) lines.push(t.concl.hwLine(z.residualFactor.plan));
    if (!z.plan.feasible && z.levers) { const ok = z.levers.filter((l) => l.id !== 'plan' && l.value >= R.target && l.valueDerated >= R.target).sort((a, b) => a.id.length - b.id.length)[0]; if (ok) lines.push(t.concl.leverLine((t.levers as Record<string, string>)[ok.id] ?? ok.id, pct(ok.value))); }
    lines.push(t.concl.weakLine(topGroups(z.planned)));
    return `<div class="box"><h3>${esc(head)}</h3><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  }).join('');
  const top = ids.slice(0, 4).filter((id) => avg(id) > 0).map((id) => `${id} ${sgn(avg(id) * 100, 2)}`).join('，');
  const negs = ids.filter((id) => sizes.every((N) => (P[N].gains.find((g) => g.id === id)?.byMetric[R.metric].shapley ?? 0) < 0)).join('，');
  const crossNote = `<div class="callout"><b>${t.concl.cross}</b>：${esc(t.concl.top(top || t.concl.none))}；${esc(t.concl.negs(negs || t.concl.none))}。</div>`;

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t.title(MS, R.target))}</title>${REPORT_FONTS}<style>${REPORT_CSS}
  details.tv { margin: -2px 0 10px; font-size: 11.5px; overflow-x: auto; } details.tv summary { cursor: pointer; color: var(--accent); } details.tv table { font-size: 11px; } details.tv th, details.tv td { padding: 2px 5px; }
</style></head>
<body><main>
<header class="title"><div class="eyebrow">${esc(t.eyebrow)} · ${esc(R.generated.slice(0, 10))}</div><h1>${esc(t.title(M, R.target))}</h1>
<p class="sub">${esc(R.scenario.name ?? R.scenario.id ?? '')} · ${esc(sizes.map((N) => sizeName(N, lang)).join(' / '))} · ${lang === 'zh' ? '候选机制' : 'candidates'}：${esc(R.players.join('、'))}${R.provisional ? (lang === 'zh' ? '（审核机制使用临时假设）' : ' (audited mechanisms with provisional assumptions)') : ''}</p>
<div class="actions"><button id="export">${lang === 'zh' ? '导出研究 JSON' : 'Export study JSON'}</button><button class="secondary" onclick="window.print()">${lang === 'zh' ? '打印 / 另存 PDF' : 'Print / save PDF'}</button></div></header>
<div class="note">${R.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>
<h2>${t.s1}</h2>${summary}
${leverTable}
${c1 ? `<figure class="chart c1">${c1}<div class="tip" id="tip-aop"></div></figure><details class="tv"><summary>${lang === 'zh' ? '图 1 ' : 'Figure 1 '}${t.dataTable}</summary>${c1table}</details>` : ''}
<figure class="chart c2">${c2}</figure><details class="tv"><summary>${lang === 'zh' ? '图 2 ' : 'Figure 2 '}${t.dataTable}</summary>${c2table}</details>
<h2>${t.s3}</h2><figure class="chart c3">${c3}</figure><details class="tv"><summary>${lang === 'zh' ? '图 3 ' : 'Figure 3 '}${t.dataTable}</summary>${c3table}</details>
${mechTable}
<h2>${t.s4}</h2>${domainTable}
<h2>${t.s5}</h2><div class="grid2">${concl}</div>${crossNote}
<footer>${esc(t.footer(R.generated))}</footer>
</main>
<script type="application/json" id="study-data">${jsonScript(R)}</script>
${c1data ? `<script type="application/json" id="aop-data">${jsonScript(c1data)}</script>` : ''}
<script>${TOOLTIP_JS}
document.getElementById('export').onclick=function(){var blob=new Blob([JSON.stringify(JSON.parse(document.getElementById('study-data').textContent),null,2)],{type:'application/json'});var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='allocation-study.json';a.click();setTimeout(function(){URL.revokeObjectURL(u)},1000)};
(function(){var el=document.getElementById('aop-data');if(!el)return;var data=JSON.parse(el.textContent);var svg=document.getElementById('chart-aop');var hit=document.getElementById('aop-hit'),xh=document.getElementById('aop-xh'),xl=document.getElementById('aop-xl');var fig=svg.closest('figure'),tip=document.getElementById('tip-aop');
function fmt(v){return (v*100).toFixed(2)+' %'}
hit.addEventListener('mousemove',function(ev){var pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;var p=pt.matrixTransform(svg.getScreenCTM().inverse());var best=0;for(var i=1;i<data.x.length;i++)if(Math.abs(data.x[i]-p.x)<Math.abs(data.x[best]-p.x))best=i;xl.setAttribute('x1',data.x[best]);xl.setAttribute('x2',data.x[best]);data.series.forEach(function(s,k){var c=document.getElementById('aop-c'+k);c.setAttribute('cx',data.x[best]);c.setAttribute('cy',s.y[best])});xh.style.display='';tip.textContent='N = '+data.grid[best].toLocaleString('en-US')+'\\n'+data.series.map(function(s){return s.name+'：'+fmt(s.nominal[best])+'（'+fmt(s.derated[best])+'）'}).join('\\n');var b=fig.getBoundingClientRect();var x=ev.clientX-b.left+14,y=ev.clientY-b.top+14;if(x+330>b.width)x=Math.max(0,ev.clientX-b.left-330);tip.style.left=x+'px';tip.style.top=y+'px';tip.style.display='block'});
hit.addEventListener('mouseleave',function(){xh.style.display='none';tip.style.display='none'})})();
</script>
</body></html>
`;
}
