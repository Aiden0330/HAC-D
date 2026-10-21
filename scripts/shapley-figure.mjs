/**
 * The Shapley heatmap of the latest ReMAP mechanism set (as Figure 3 of docs/REMAP_LATEST_ALLOCATION_98P5.zh.html) for the scaling
 * reports, and the report section built around it: one heatmap per architecture (mechanisms × 10k / 100k / 200k / 500k, two blocks,
 * effort column, boxed cells = in that size's recommended set), plus the recommended sets per size. Data from
 * docs/arch-mechanism-shapley/<arch>.json (scripts/arch-mechanism-shapley.ts). Used by scripts/build-ascend950-scaling.mjs and
 * scripts/build-ascend910c-scaling.mjs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { esc, fmt, svgOpen, titleBlock, wrap, lines } from './ascend950-figures.mjs';

/** the per-architecture results, or null when the study has not been run */
export function loadShapley(arch) {
  const f = `docs/arch-mechanism-shapley/${arch}.json`;
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

const HM_LIGHT = '--h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; --hm0:#f0efec;';
const HM_DARK = '--h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; --hm0:#383835;';
const HM_STYLE = `<style>svg.viz.hm { ${HM_LIGHT} } @media (prefers-color-scheme: dark) { svg.viz.hm { ${HM_DARK} } } :root[data-theme="light"] svg.viz.hm { ${HM_LIGHT} } :root[data-theme="dark"] svg.viz.hm { ${HM_DARK} } svg.viz.hm .cellt { font-size: 11px; font-variant-numeric: tabular-nums; } svg.viz.hm .onDark { fill: var(--surface); }</style>`;

const pt = (x, d = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}`;

/** heatmap of one architecture; `name` is the architecture's display name */
export function figShapley(lang, D, { id, num, name }) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const SIZES = D.sizes;
  const P = D.perSize;
  const isExt = (m) => D.extensions.includes(m);
  const tag = (m) => (isExt(m) ? T('扩', 'ext') : 'R');
  const gain = (N, m) => P[N].gains.find((g) => g.id === m);
  const shap = (N, m) => gain(N, m).aOp.shapley;
  const avg = (m) => SIZES.reduce((s, N) => s + shap(N, m), 0) / SIZES.length;
  const ids = D.players.slice().sort((a, b) => avg(b) - avg(a));
  const vmax = Math.max(...SIZES.flatMap((N) => P[N].gains.map((g) => Math.abs(g.aOp.shapley))));
  const negMax = Math.max(0, ...SIZES.flatMap((N) => P[N].gains.map((g) => -g.aOp.shapley)));
  const half = Math.ceil(ids.length / 2);
  const blocks = [ids.slice(0, half), ids.slice(half)];
  const W = 960, labelW = 168, colW = 62, effW = 40, rowH = 22, gap = 22;
  const blockW = labelW + SIZES.length * colW + effW;
  const x0s = [14, 14 + blockW + gap];
  const sizeLabel = (N) => (lang === 'zh' ? `${fmt(N / 10000)} 万卡` : `${fmt(N / 1000)}k`);
  const head = titleBlock(T(`图 ${num}：${name} · ReMAP 最新机制集 ${D.players.length} 项对 A_op 的 Shapley 贡献（百分点；置换抽样 ${D.permutations} 次，95 % 半宽见悬停）；带框 = 该规模推荐集所含`, `Figure ${num}: ${name} · Shapley contribution of the latest ReMAP mechanism set (${D.players.length}) to A_op (points; ${D.permutations} sampled permutations, 95 % half-width on hover); boxed = in that size’s recommended set`));
  const note = T('R = 原有，扩 = 扩展；行按四个规模的平均贡献排序。静默错误检测与 checkpoint 类机制改善正确交付而非 A_op，故接近 0 或微负；扩展机制按 ReMAP 显式情景（适用 100 %、成功 95 %、失败尝试 0 s）计，推荐集另经规划器降额。', 'R = original, ext = extension; rows sorted by the mean contribution over the four sizes. Silent-corruption detectors and checkpoint mechanisms improve delivered goodput rather than A_op, hence ≈ 0 or slightly negative; extensions at ReMAP’s explicit scenario (eligible 100 %, success 95 %, failed attempt 0 s); the recommended set is also checked derated.');
  const noteLines = wrap(note, W - 28, 9.8);
  const Tp = 62 + head.dy;
  const H = Tp + half * rowH + 50 + noteLines.length * 12;
  let g = svgOpen(id, W, H, T('机制 Shapley 贡献', 'Mechanism Shapley contributions')).replace('class="viz"', 'class="viz hm"') + HM_STYLE + head.svg;
  const cls = (v) => { if (Math.abs(v) < 0.0005) return 'hm0'; const k = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.abs(v) / vmax) * 4))); return (v > 0 ? 'h' : 'n') + k; };
  blocks.forEach((blk, bi) => {
    const x0 = x0s[bi];
    g += `<text x="${x0}" y="${Tp - 8}" class="m">${esc(bi === 0 ? T('机制（R 原有 · 扩 扩展）', 'Mechanism (R / ext)') : T('（续）', '(cont.)'))}</text>`;
    SIZES.forEach((N, j) => {
      const x = x0 + labelW + j * colW + colW / 2;
      g += `<text x="${x}" y="${Tp - 8}" text-anchor="middle" class="t2">${esc(sizeLabel(N))}</text>`;
      if (!P[N].plan.feasible) g += `<text x="${x}" y="${Tp - 20}" text-anchor="middle" class="tiny">${esc(T('不可达', 'out of reach'))}</text>`;
    });
    g += `<text x="${x0 + labelW + SIZES.length * colW + effW / 2}" y="${Tp - 8}" text-anchor="middle" class="t2">${esc(T('工作量', 'Effort'))}</text>`;
    blk.forEach((m, i) => {
      const y = Tp + i * rowH;
      g += `<text x="${x0}" y="${y + rowH / 2 + 4}" class="t2" style="font-size:10.6px"><tspan class="m">${esc(tag(m))}</tspan> ${esc(m)}</text>`;
      SIZES.forEach((N, j) => {
        const gn = gain(N, m), v = gn.aOp.shapley, c = cls(v), x = x0 + labelW + j * colW, inPlan = P[N].plan.ids.includes(m);
        const tip = `${m} ${D.library[m]?.name?.[lang] ?? ''} · ${sizeLabel(N)}|Shapley (A_op) ${pt(v, 3)} pt${gn.halfWidth !== undefined ? ` ± ${(gn.halfWidth * 100).toFixed(3)}` : ''}|${T('单独启用', 'alone')} ${pt(gn.aOp.single, 3)} · ${T('末位加入', 'added last')} ${pt(gn.aOp.lastAdded, 3)}|Shapley (${T('正确交付', 'delivered goodput')}) ${pt(gn.delivered.shapley, 2)} pt${inPlan ? `|${T('在该规模的推荐集中', 'in this size’s recommended set')}` : ''}`;
        g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" style="fill:var(--${c})" data-tip="${esc(tip)}"/>`;
        if (inPlan) g += `<rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" style="stroke:var(--surface)" stroke-width="3" pointer-events="none"/><rect x="${x + 3}" y="${y + 3}" width="${colW - 6}" height="${rowH - 6}" fill="none" style="stroke:var(--ink)" stroke-width="1.5" pointer-events="none"/>`;
        const dark = c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';
        g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${dark ? ' onDark' : ''}" pointer-events="none">${pt(v)}</text>`;
      });
      g += `<text x="${x0 + labelW + SIZES.length * colW + effW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2">${esc(String(D.library[m]?.effort ?? ''))}</text>`;
    });
  });
  const ly = Tp + half * rowH + 16, sx = 14 + 64;
  ['n4', 'n3', 'n2', 'n1', 'hm0', 'h1', 'h2', 'h3', 'h4'].forEach((c, i) => { g += `<rect x="${sx + i * 26}" y="${ly}" width="24" height="12" style="fill:var(--${c})"/>`; });
  g += `<text x="${sx - 6}" y="${ly + 10}" text-anchor="end" class="m">−${(vmax * 100).toFixed(1)} pt</text><text x="${sx + 9 * 26 + 6}" y="${ly + 10}" class="m">${esc(T(`+${(vmax * 100).toFixed(1)} pt（色阶按 √|值| 分级；负值均小于 ${(Math.max(negMax, 0.0001) * 100).toFixed(2)} pt）`, `+${(vmax * 100).toFixed(1)} pt (steps by √|value|; every negative value is below ${(Math.max(negMax, 0.0001) * 100).toFixed(2)} pt)`))}</text><text x="${sx + 4 * 26 + 12}" y="${ly + 23}" text-anchor="middle" class="m">0</text>`;
  g += lines(14, ly + 38, noteLines, 'm', 12);
  return g + '</svg>';
}

/** the report section: heading, reading notes, one heatmap per architecture, the recommended sets per size */
export function shapleySection(lang, archs, { h2, firstFig }) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const ok = archs.filter((a) => a.D);
  if (!ok.length) return '';
  const D0 = ok[0].D;
  const SIZES = D0.sizes;
  const sizeLabel = (N) => (lang === 'zh' ? `${fmt(N / 10000)} 万卡` : `${fmt(N / 1000)}k`);
  const pct = (x, d = 2) => `${(x * 100).toFixed(d)} %`;
  const figs = ok.map((a, i) => `<figure class="chart"><div class="scroll">${figShapley(lang, a.D, { id: `fig-shap-${a.id}`, num: firstFig + i, name: a.name })}</div></figure>`).join('\n  ');
  const rows = ok.map((a) => SIZES.map((N, j) => {
    const z = a.D.perSize[N];
    const set = z.plan.ids.length ? z.plan.ids.join(' + ') : T('无需机制', 'none needed');
    return `<tr>${j === 0 ? `<td class="b" rowspan="${SIZES.length}">${esc(a.short)}</td>` : ''}<td class="nw">${esc(sizeLabel(N))}</td><td class="num">${pct(z.baseline)}</td><td class="set">${esc(set)}</td><td class="num">${z.plan.effort}</td><td class="num${z.plan.feasible ? '' : ' bad'}">${pct(z.plan.nominal)} / ${pct(z.plan.derated)}${z.plan.feasible ? '' : T('（不可达）', ' (out of reach)')}</td><td class="num">${pct(z.allOn)}</td></tr>`;
  }).join('')).join('');
  const table = `<div class="table-wrap"><table class="shp"><thead><tr><th>${esc(T('架构', 'Architecture'))}</th><th>${esc(T('规模', 'Size'))}</th><th class="num">${esc(T('不加任何机制的 A_op', 'A_op with no mechanism'))}</th><th>${esc(T('推荐集（贪心，最省工作量且降额后仍 ≥ 98.5 %）', 'Recommended set (greedy, least effort that still meets 98.5 % derated)'))}</th><th class="num">${esc(T('工作量', 'Effort'))}</th><th class="num">${esc(T('推荐集 A_op 名义 / 降额', 'A_op of the set nominal / derated'))}</th><th class="num">${esc(T(`全部 ${D0.players.length} 项`, `All ${D0.players.length}`))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  // reading notes from the data
  const top500 = (D) => D.perSize[500000].gains.slice().sort((x, y) => y.aOp.shapley - x.aOp.shapley).slice(0, 4).map((g) => `${g.id} ${pt(g.aOp.shapley)}`).join(T('、', ', '));
  const defaults = ['R-ELASTIC', 'R-PROCESS', 'R-REPLAY', 'D-SDC', 'R-SDC', 'C-FAST'];
  const defSum = (D, N) => defaults.reduce((s, m) => s + D.perSize[N].gains.find((g) => g.id === m).aOp.shapley, 0);
  const notes = ok.map((a) => T(`<b>${esc(a.short)}</b>：50 万卡贡献最大的是 ${esc(top500(a.D))} pt；六个默认机制合计 ${pt(defSum(a.D, 500000))} pt，其余 17 项合计 ${pt(a.D.perSize[500000].gains.reduce((s, g) => s + g.aOp.shapley, 0) - defSum(a.D, 500000))} pt；${a.D.perSize[500000].plan.feasible ? '50 万卡有可行集' : `50 万卡只用这 23 项不可达（全部启用 ${pct(a.D.perSize[500000].allOn)}，推荐集降额 ${pct(a.D.perSize[500000].plan.derated)}），差额要靠硬件或恢复杠杆（见 ARCH_ALLOCATION_98P5_500K）`}。`, `<b>${esc(a.short)}</b>: at 500k the largest contributions are ${esc(top500(a.D))} points; the six defaults add up to ${pt(defSum(a.D, 500000))} points and the other 17 to ${pt(a.D.perSize[500000].gains.reduce((s, g) => s + g.aOp.shapley, 0) - defSum(a.D, 500000))}; ${a.D.perSize[500000].plan.feasible ? 'a feasible set exists at 500k' : `these 23 alone cannot reach 98.5 % at 500k (all on ${pct(a.D.perSize[500000].allOn)}, recommended set ${pct(a.D.perSize[500000].plan.derated)} derated); the rest needs hardware or recovery levers (see ARCH_ALLOCATION_98P5_500K)`}.`));
  return `<h2 class="first">${esc(h2)}</h2>
  <p class="note">${T(`与 REMAP_LATEST_ALLOCATION_98P5 图 3 相同的方法，改在本报告的拓扑场景上算：候选为最新 ReMAP（github.com/lzq0927/remap，${esc(D0.remap.commit)}；扩展定义自 eaacb05 起未变）的 ${D0.players.length} 项机制——原有 8 项（含六个默认机制）+ 扩展 15 项，扩展参数取 ReMAP 的显式情景 <code>extensionScenario()</code>（适用 100 %，FP8 / FP4 各占 CORE 静默风险的 50 %，成功 95 %，失败尝试 0 s，开销 0，ABFT 0.1 %）。基准为不加任何机制的架构（六个默认机制也是参与者，所以这里的“基线”低于表 1）。Shapley = 在所有加入顺序上的平均边际 A_op 增益（置换抽样 ${D0.permutations} 次）；推荐集由 HAC-D 的贪心规划器按“单位工作量增益”逐项加入，名义与降额（覆盖 −5 pt、成功 −8 pt、时间 ×1.5）都要 ≥ 98.5 %。`, `The method of Figure 3 in REMAP_LATEST_ALLOCATION_98P5, computed on this report’s topology scenarios: the candidates are the ${D0.players.length} mechanisms of the latest ReMAP (github.com/lzq0927/remap, ${esc(D0.remap.commit)}; extension definitions unchanged since eaacb05) — the 8 original ones (the six defaults among them) + 15 extensions at ReMAP’s explicit scenario <code>extensionScenario()</code> (eligible 100 %, FP8 / FP4 50 % of the CORE silent risk each, success 95 %, failed attempt 0 s, overhead 0, ABFT 0.1 %). The base is the architecture with no mechanism (the six defaults are players too, so this base is below Table 1). Shapley = mean marginal A_op gain over all join orders (${D0.permutations} sampled permutations); the recommended set is HAC-D’s greedy planner adding the best gain per effort until the target holds nominally and derated (coverage −5 pt, success −8 pt, times ×1.5).`)}</p>
  ${figs}
  ${table}
  <ul class="scale">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
  <p class="note">${T(`复现：<code>node --import tsx scripts/arch-mechanism-shapley.ts --arch ${ok.map((a) => a.id).join('|')}</code>（HAC-D allocationStudy，种子 1）→ 本页构建脚本；图由 <code>scripts/shapley-figure.mjs</code> 绘制。`, `Reproduce: <code>node --import tsx scripts/arch-mechanism-shapley.ts --arch ${ok.map((a) => a.id).join('|')}</code> (HAC-D allocationStudy, seed 1) → this page’s build script; figures drawn by <code>scripts/shapley-figure.mjs</code>.`)}</p>`;
}
