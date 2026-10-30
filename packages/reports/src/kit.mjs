/**
 * Shared kit of the Ascend allocation report set (docs/ASCEND_ALLOCATION_METHODOLOGY.html, docs/ASCEND_ALLOCATION_FINDINGS_*.html,
 * docs/ASCEND_BOM_100K.html): the page shell (bilingual zh / en in one file with a toggle, print shows the active language, the
 * house CSS of the earlier reports), KaTeX at build time with embedded fonts, SVG figure helpers with enlarged type (FS = 1.18 × the
 * earlier reports), flow-chart nodes, chips, and the hardware schematics of the four architectures used by the overlay figures.
 * Relocated from scripts/report-kit.mjs (v5 T10). v6.3: no file access here — the KaTeX fonts are registered by katex-node.mjs
 * (the Node entry, read from the installed katex package) or by a browser build through setKatexCss (katexCssFrom), so the kit
 * and the recipes also run in a web worker (@hac-d/reports/browser).
 */
import katex from 'katex';
import { esc, fmt, tw, wrap, lines, textBlock, STYLE } from './svg-base.mjs';
import { BASE_CSS } from './base-css.mjs';
export { esc, fmt, tw, wrap, lines, textBlock };

/* ---------------- numbers ---------------- */
export const pct = (x, d = 2) => `${(x * 100).toFixed(d)} %`;
export const fk = (k) => fmt(k, k >= 10 ? 1 : k >= 1 ? 2 : 3);
export const pP = (p) => `${fmt(p * 100, p === 0 || p === 1 ? 0 : 1)} %`;
export const f2 = (v) => (v < 0.005 ? '< 0.01' : fmt(v, 2));
export const kN = (n, lang) => (lang === 'zh' ? `${fmt(n / 10000)} 万` : `${fmt(n / 1000)}k`);
export const hours = (h, lang) => (h >= 8760 ? (lang === 'zh' ? `${fmt(h / 8760, 1)} 年` : `${fmt(h / 8760, 1)} y`) : h >= 48 ? (lang === 'zh' ? `${fmt(h / 24)} 天` : `${fmt(h / 24)} d`) : h >= 1 ? `${fmt(h, 1)} h` : `${fmt(h * 60, 1)} min`);
export const secs = (s) => (s >= 3600 ? `${fmt(s / 3600, 2)} h` : s >= 120 ? `${fmt(s / 60, 1)} min` : `${fmt(s, s < 10 ? 1 : 0)} s`);

/** small counts as words (zh 六个 / en six) for prose that states a count of the data; digits above twelve */
const ZH_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const EN_NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const countWord = (n, lang) => (n <= 12 ? (lang === 'zh' ? `${ZH_NUM[n]}个` : EN_NUM[n]) : lang === 'zh' ? `${n} 个` : String(n));

/* ---------------- figure type: FS × the earlier reports ---------------- */
export const FS = 1.18;
export const sz = (base) => base * FS;
const BIG = `svg.viz text{font-size:${(11 * FS).toFixed(2)}px} svg.viz .ttl{font-size:${(13 * FS).toFixed(2)}px} svg.viz .h{font-size:${(11.5 * FS).toFixed(2)}px} svg.viz .t2{font-size:${(11 * FS).toFixed(2)}px} svg.viz .s{font-size:${(9.8 * FS).toFixed(2)}px} svg.viz .m{font-size:${(9.8 * FS).toFixed(2)}px} svg.viz .num{font-size:${(12 * FS).toFixed(2)}px} svg.viz .tiny{font-size:${(8.4 * FS).toFixed(2)}px} svg.viz .sb{font-size:${(9.8 * FS).toFixed(2)}px}`;
export const W = 960;
export const svgOpen = (id, w, h, label) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${STYLE}${BIG}</style><rect width="${w}" height="${h}" fill="var(--surface)" rx="8"/>`;
/** an SVG whose height is known only after drawing: open with placeholders, close with the final height */
export const svgDyn = (id, label, w = W) => svgOpen(id, w, 10, label).replace(`viewBox="0 0 ${w} 10"`, 'VIEWBOX').replace('height="10"', 'HEIGHT');
export const svgClose = (g, H, w = W) => g.replace('VIEWBOX', `viewBox="0 0 ${w} ${H}"`).replace('HEIGHT', `height="${H}"`) + '</g></svg>';
export function titleBlock(label, w = W) { const ls = wrap(label, w - 30, sz(13) * 1.05); return { svg: lines(14, 24, ls, 'ttl', 19), dy: (ls.length - 1) * 19 }; }
export function legend(x, y, items, maxX = W - 14) {
  let g = '', cx = x, cy = y;
  for (const it of items) {
    const w = 20 + tw(it.label, sz(9.8)) + 18;
    if (cx + w > maxX) { cx = x; cy += 18; }
    const look = it.style ? `style="${it.style}"` : `class="${it.cls}"`;
    g += it.line ? `<line x1="${cx}" y1="${cy - 3}" x2="${cx + 14}" y2="${cy - 3}" ${look}/>` : `<rect x="${cx}" y="${cy - 9}" width="13" height="11" rx="2" ${look}/>`;
    g += `<text x="${cx + 19}" y="${cy + 1}" class="s">${esc(it.label)}</text>`;
    cx += w;
  }
  return { g, y: cy };
}
export const FLOW = 'stroke:var(--muted);stroke-width:1.3;fill:none';
export const arrowDefs = (id) => `<defs><marker id="arr-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:var(--muted)"/></marker></defs>`;
export const arrow = (id, d, dashed = false) => `<path d="${d}" style="${FLOW}${dashed ? ';stroke-dasharray:4 3' : ''}" marker-end="url(#arr-${id})"/>`;
/** a flow-chart node: bold title + wrapped sub text; returns its geometry */
export function node(x, y, w, cls, title, sub, pad = 9, titleFs = 11.5) {
  const tl = wrap(title, w - 2 * pad, sz(titleFs) * 1.05), sl = sub ? wrap(sub, w - 2 * pad, sz(9.8)) : [];
  const lh1 = Math.round(sz(titleFs) * 1.3), lh2 = Math.round(sz(9.8) * 1.3);
  const h = 7 + tl.length * lh1 + (sl.length ? 3 + sl.length * lh2 : 0) + 8;
  const svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" class="${cls}"/>` + lines(x + pad, y + 7 + lh1 - 4, tl, 'h', lh1) + (sl.length ? lines(x + pad, y + 7 + tl.length * lh1 + 3 + lh2 - 4, sl, 's', lh2) : '');
  return { svg, h, cx: x + w / 2, bottom: y + h, x, y, w };
}
/* chips (rounded labels) flowing within a width */
export const chipW = (label) => 16 + tw(label, sz(8.4)) * 1.04;
export const CHIP_H = Math.round(18 * FS);
export function flow(labels, xa, width) { let x = xa, line = 0; const pos = labels.map((lab) => { const w = chipW(lab); if (x + w > xa + width && x > xa) { x = xa; line++; } const p = { x, line, w }; x += w + 6; return p; }); return { pos, lines: labels.length ? line + 1 : 0, rowH: CHIP_H + 5 }; }
export const chip = (x, y, w, cls, label, tip, rx = 4) => `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${CHIP_H}" rx="${rx}" class="${cls}"${tip ? ` data-tip="${esc(tip)}"` : ''}/><text x="${(x + 8).toFixed(1)}" y="${y + CHIP_H - 6}" class="tiny" pointer-events="none">${esc(label)}</text>`;
export const tiny = (x, y, t, anchor = 'middle', style = '') => `<text x="${x}" y="${y}" class="tiny"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${style ? ` style="${style}"` : ''}>${esc(t)}</text>`;
/** colours of the chain's terminal rungs */
export const ENDS = (T) => [['replay', T('重执行', 'replay'), 'var(--s3)'], ['custom', T('透明梯级', 'transparent rung'), 'var(--s5)'], ['elastic', T('弹性', 'elastic'), 'var(--s1)'], ['process', T('进程', 'process'), 'var(--s4)'], ['global', T('全局恢复', 'global'), 'var(--s2)']];

/* ---------------- LaTeX at build time (KaTeX), fonts embedded ---------------- */
/** the KaTeX fonts a report may need: [family, style, file]; the guard below refuses output that needs any other */
export const KATEX_FONTS = [['KaTeX_Main', 'normal', 'KaTeX_Main-Regular'], ['KaTeX_Math', 'italic', 'KaTeX_Math-Italic'], ['KaTeX_Size1', 'normal', 'KaTeX_Size1-Regular'], ['KaTeX_Size2', 'normal', 'KaTeX_Size2-Regular'], ['KaTeX_Size3', 'normal', 'KaTeX_Size3-Regular'], ['KaTeX_Size4', 'normal', 'KaTeX_Size4-Regular'], ['KaTeX_Caligraphic', 'normal', 'KaTeX_Caligraphic-Regular'], ['KaTeX_AMS', 'normal', 'KaTeX_AMS-Regular']];
/** the KaTeX CSS with the fonts embedded as data URIs: `fonts` = [{ family, style, base64 }] (KATEX_FONTS order), `minCss` = katex.min.css */
export const katexCssFrom = (fonts, minCss) => fonts.map((f) => `@font-face{font-family:${f.family};font-style:${f.style};font-weight:400;font-display:block;src:url(data:font/woff2;base64,${f.base64}) format("woff2")}`).join('\n') + '\n' + minCss.replace(/@font-face\{[^}]*\}/g, '');
let katexCssValue = null;
/** register the KaTeX CSS the page shell embeds: katex-node.mjs does it from the installed package (Node entry index.mjs); a browser build passes the fonts it fetched */
export function setKatexCss(css) { katexCssValue = css; }
/** the registered KaTeX CSS (throws until setKatexCss ran: import @hac-d/reports under Node, or register the fonts in a browser build) */
export function katexCss() {
  if (katexCssValue === null) throw new Error('KaTeX CSS not registered: import @hac-d/reports (Node, reads the katex package) or call setKatexCss(katexCssFrom(fonts, minCss)) before rendering a page');
  return katexCssValue;
}
const usedFonts = new Set();
const ALLOWED = new Set(['mathnormal', 'mathcal', 'amsrm']);
export const tex = (src, display = false) => { const h = katex.renderToString(src, { displayMode: display, output: 'htmlAndMathml', throwOnError: true, strict: 'ignore' }); for (const m of h.matchAll(/class="[^"]*\b(mathnormal|mathit|mathbf|amsrm|textbf|textit|mathsf|mathtt|mathcal|mathfrak|mathscr|boldsymbol)\b/g)) usedFonts.add(m[1]); return h; };
export const M = (src) => `<div class="math-block">${tex(src, true)}</div>`;
export function katexFontGuard() { const bad = [...usedFonts].filter((f) => !ALLOWED.has(f)); if (bad.length) throw new Error(`KaTeX output needs fonts that are not embedded: ${bad.join(', ')}`); }

/* ---------------- page shell ---------------- */
export { BASE_CSS };
export const KIT_CSS = `
  [data-l] { display: block; }
  html[data-lang="zh"] [data-l="en"], html[data-lang="en"] [data-l="zh"] { display: none !important; }
  #lang { position: fixed; top: 10px; right: 12px; z-index: 20; font: 600 12px/1 "IBM Plex Sans", system-ui, sans-serif; color: var(--ink); background: var(--surface); border: 1px solid var(--rule); border-radius: 999px; padding: 7px 12px; cursor: pointer; }
  #lang:hover { border-color: var(--accent); }
  h2.first, h3.first { border-top: none; padding-top: 0; margin-top: 6px; }
  .katex { font-size: 1.08em; } .katex-display { margin: 0.2em 0; text-align: left; } .katex-display > .katex { text-align: left; }
  .math-block { background: var(--surface-2); border-radius: 6px; padding: 3px 10px; margin: 5px 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .math-block + .math-block { margin-top: -5px; border-top-left-radius: 0; border-top-right-radius: 0; }
  .math-block:has(+ .math-block) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .katex .cjk_fallback { font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
  p.note .katex, p.sub .katex, td .katex, li .katex { font-size: 1.02em; }
  th.num { white-space: normal; } td.w { white-space: normal; }
  ul.kf { margin: 4px 0; padding-left: 18px; } ul.kf li { margin: 3px 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; } @media screen and (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
  .tag { display: inline-block; font-size: 10.5px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--rule); color: var(--muted); margin-left: 4px; vertical-align: middle; }
  td.ok { color: var(--accent); font-weight: 600; } td.warn { background: var(--warn-soft); color: var(--warn); font-weight: 600; }
  sup { font-size: 0.75em; line-height: 0; }
  figure.schem figcaption.top { margin: 0 0 4px; font-weight: 600; color: var(--ink); font-size: 13px; }
  @media screen and (max-width: 760px) { #lang { top: 6px; right: 6px; } }
  @media print { figure.schem figcaption.top { font-size: 8.3px; margin: 0 0 1px; } #lang { display: none !important; } .katex { font-size: 1.02em; } .math-block { padding: 1px 6px; margin: 2px 0; overflow: visible; } .math-block + .math-block { margin-top: -2px; } .katex-display { margin: 0.12em 0; } .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; } }
`;
const SCRIPT = `<script>
(() => {
  const root = document.documentElement, btn = document.getElementById('lang');
  const set = (l) => { root.setAttribute('data-lang', l); root.lang = l === 'zh' ? 'zh-CN' : 'en'; btn.textContent = l === 'zh' ? 'English' : '中文'; try { localStorage.setItem('hacd-alloc-lang', l); } catch (e) {} };
  let l = 'zh'; try { l = localStorage.getItem('hacd-alloc-lang') || 'zh'; } catch (e) {}
  set(l === 'en' ? 'en' : 'zh');
  btn.addEventListener('click', () => set(root.getAttribute('data-lang') === 'zh' ? 'en' : 'zh'));
  const tip = document.getElementById('tip');
  const clean = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const show = (el, x, y) => { const p = el.getAttribute('data-tip').split('|'); tip.innerHTML = '<b>' + clean(p[0]) + '</b>' + p.slice(1).map(clean).join('<br>'); tip.style.display = 'block'; const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px'; tip.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 14)) + 'px'; };
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    el.addEventListener('click', (e) => { show(el, e.clientX, e.clientY); e.stopPropagation(); });
  });
  document.addEventListener('click', () => { tip.style.display = 'none'; });
})();
</script>`;
/** wrap the sections of one language into A4 pages with an eyebrow line */
export function pages(sections, eyebrow) { const n = sections.length; return sections.map((s, i) => `<section class="page">\n  <div class="eyebrow">${esc(eyebrow(i + 1, n))}</div>\n  ${s}\n</section>`).join('\n'); }
/** the full HTML: zh and en bodies, toggle, tooltip, KaTeX css, house css */
export function pageShell({ title, description, zhBody, enBody, extraCss = '' }) {
  katexFontGuard();
  return `<!doctype html>
<html lang="zh-CN" data-lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${katexCss()}</style>
<style>${BASE_CSS}${KIT_CSS}${extraCss}</style>
</head>
<body>
<button id="lang" type="button" aria-label="Switch language / 切换语言">English</button>
<main>
<div data-l="zh">
${zhBody}
</div>
<div data-l="en">
${enBody}
</div>
</main>
<div id="tip" role="tooltip"></div>
${SCRIPT}
</body>
</html>
`;
}

/* ---------------- hardware schematics of the four architectures (overlay figures) ---------------- */
/** geometry used by the drawings; counts come from the data files, these are the shapes */
export const TOPO_GEOM = {
  native950: { podCabinets: 16, commCabinets: 4, nodesPerCabinet: 8, npusPerNode: 8, cpusPerNode: 2, fabric: 'mesh-clos', soTiers: 2, ubLabel: { zh: 'UB 交换（柜内 LRS + 灵衢互联柜）+ 光链路', en: 'UB switching (in-cabinet LRS + UB cabinets) + optics' }, podLabel: { zh: '超节点 1,024 NPU：16 计算柜 + 4 互联柜', en: 'SuperPoD 1,024 NPUs: 16 compute + 4 UB cabinets' } },
  ubl128: { podCabinets: 2, commCabinets: 1, nodesPerCabinet: 8, npusPerNode: 8, cpusPerNode: 2, fabric: 'mesh-clos', soTiers: 2, ubLabel: { zh: '单层 UB 交换（每 NPU 4 × 800G）+ 光链路', en: 'single-layer UB switching (4 × 800G per NPU) + optics' }, podLabel: { zh: '超节点 128 NPU：2 计算柜 + 共享交换柜', en: 'SuperPoD 128 NPUs: 2 compute cabinets + shared switch cabinet' } },
  cm384: { podCabinets: 12, commCabinets: 4, nodesPerCabinet: 4, npusPerNode: 8, cpusPerNode: 4, fabric: 'two-level', soTiers: 4, ubLabel: { zh: 'L1（节点内 7 片）/ L2（通信柜）两级 UB 交换 + 光链路', en: 'two-level UB switching, L1 (7 per node) / L2 (comm cabinets) + optics' }, podLabel: { zh: '超节点 384 NPU：12 计算柜 + 4 通信柜', en: 'SuperPoD 384 NPUs: 12 compute + 4 communication cabinets' } },
  a3server: { podCabinets: 1, commCabinets: 0, nodesPerCabinet: 4, npusPerNode: 8, cpusPerNode: 4, fabric: 'server', soTiers: 4, ubLabel: { zh: '服务器内 UB（7 片 L1 芯片），无光链路', en: 'in-server UB (7 L1 chips), no optics' }, podLabel: { zh: 'UB 域 = 一台 800T A3 服务器', en: 'UB domain = one server' } },
};
/**
 * v5 the schematic geometry of a topology record (the shape of a TOPO_GEOM entry) for the overlay figure of a record the table
 * above does not list. `record.superpod` must be resolved over its preset (@hac-d/core `recordSuperpod(record)`); `counts` = the
 * main scale's `counts` of the budget (BudgetResult.counts; `scaleOutTiers` is read). Rule: cabinets / nodes / NPUs / CPUs from
 * the SuperPoD geometry; fabric = superpod.fabric, or 'server' when the pod has neither communication cabinets nor an L2 tier (the
 * UB domain is the server, e.g. a3server); labels from the optional `record.schematic` (generic defaults otherwise). For the four
 * built-in records the result deep-equals TOPO_GEOM[record.id] (packages/reports/test/geometry.test.mjs).
 */
export function topoGeomFromRecord(record, counts) {
  const sp = record.superpod ?? {};
  const need = ['computeRacks', 'commRacks', 'nodesPerRack', 'npusPerNode', 'cpusPerNode', 'fabric', 'l2PerSubPlane'];
  const missing = need.filter((k) => sp[k] === undefined);
  if (missing.length) throw new Error(`topoGeomFromRecord: superpod of record '${record.id}' is not resolved (${missing.join(', ')} missing) — pass { ...record, superpod: recordSuperpod(record) } (@hac-d/core)`);
  if (!counts || !Number.isFinite(counts.scaleOutTiers)) throw new Error(`topoGeomFromRecord: counts.scaleOutTiers missing for record '${record.id}'`);
  const pod = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
  const lab = record.schematic ?? {};
  return {
    podCabinets: sp.computeRacks, commCabinets: sp.commRacks, nodesPerCabinet: sp.nodesPerRack, npusPerNode: sp.npusPerNode, cpusPerNode: sp.cpusPerNode,
    fabric: sp.commRacks === 0 && sp.l2PerSubPlane === 0 ? 'server' : sp.fabric,
    soTiers: counts.scaleOutTiers,
    ubLabel: lab.ubLabel ?? { zh: 'UB 交换 + 光链路', en: 'UB switching + optics' },
    podLabel: lab.podLabel ?? { zh: `${record.short.zh} 超节点 ${fmt(pod)} NPU`, en: `${record.short.en} SuperPoD ${fmt(pod)} NPUs` },
  };
}

/**
 * v5 the footer's "Data: … Reproduce: …" sentence of a report produced by the hacd CLI, from the run's provenance
 * ({ command, records: [{ id, name }], set: { id, source }, rates?: { id, basis }, options: { scales, target, trials, seed,
 * permutations?, npus? }, engine: { version, commit? } }); `files` = the sidecar JSON file names the report reads; `date` = the
 * data's date. Returns HTML ending with the sentence stop (plus a space in English); the caller appends the rest of its footer.
 */
export function provenanceFooter(p, lang, files, date) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  // commands and paths may be long without break points: let them wrap anywhere (375-px pages)
  const code = (s) => `<code style="overflow-wrap:anywhere">${esc(s)}</code>`;
  const sep = T('；', '; ');
  const o = p.options ?? {};
  const list = (xs) => xs.map((n) => fmt(n)).join(' / ');
  const opts = [
    o.npus !== undefined ? T(`${fmt(o.npus)} NPU`, `${fmt(o.npus)} NPUs`) : null,
    o.scales?.length ? T(`规模 ${list(o.scales)}`, `scales ${list(o.scales)}`) : null,
    o.target !== undefined ? T(`目标 ${o.metric === 'effective' ? '有效 goodput' : 'A_op'} ≥ ${fmt(o.target * 100, 1)} %`, `target ${o.metric === 'effective' ? 'effective goodput' : 'A_op'} ≥ ${fmt(o.target * 100, 1)} %`) : null,
    o.trials !== undefined ? T(`${fmt(o.trials)} 个 30 天窗口`, `${fmt(o.trials)} 30-day windows`) : null,
    o.seed !== undefined ? T(`种子 ${o.seed}`, `seed ${o.seed}`) : null,
    o.permutations !== undefined ? T(`Shapley ${fmt(o.permutations)} 次置换`, `Shapley ${fmt(o.permutations)} permutations`) : null,
    o.variants?.length ? T(`附录变体 ${o.variants.map(code).join('、')}`, `appendix variants ${o.variants.map(code).join(', ')}`) : null,
  ].filter(Boolean);
  const recs = (p.records ?? []).map((r) => code(r.id)).join(T('、', ', '));
  // the engine version only: the commit hash stays in provenance.json so the page reproduces byte for byte after a commit
  const eng = `HAC-D ${esc(p.engine?.version ?? '?')}`;
  const parts = [
    T(`记录 ${recs}`, `records ${recs}`),
    T(`机制集 ${code(p.set.id)}`, `mechanism set ${code(p.set.id)}`),
    p.rates ? T(`失效率覆盖 ${code(p.rates.id)}（${esc(p.rates.basis)}）`, `failure-rate override ${code(p.rates.id)} (${esc(p.rates.basis)})`) : T('失效率：HAC-D 单元库', 'failure rates: the HAC-D unit library'),
    ...opts,
    T(`引擎 ${eng}`, `engine ${eng}`),
  ];
  return T(`数据：${files.map(code).join('、')}（${esc(date)}${sep}${parts.join(sep)}）。复现：${code(p.command)}。`,
    `Data: ${files.map(code).join(', ')} (${esc(date)}${sep}${parts.join(sep)}). Reproduce: ${code(p.command)}. `);
}

/**
 * Draw one layer's schematic into (x, y, w, h); returns { svg, zoom, outer } where zoom is the element the next layer magnifies
 * (at the right edge) and outer the drawing's bounding rect. Layers: cluster, scaleout, superpod, cabinet, node, npu.
 * `topo` = a TOPO_GEOM key or a geometry object of that shape (topoGeomFromRecord).
 */
export function drawLayer(topo, layer, x, y, w, h, T) {
  const G = typeof topo === 'string' ? TOPO_GEOM[topo] : topo;
  if (!G) throw new Error(`drawLayer: no schematic geometry for '${topo}' (TOPO_GEOM keys: ${Object.keys(TOPO_GEOM).join(', ')}; or pass topoGeomFromRecord(record, counts))`);
  const s = { svg: '', zoom: null, outer: null };
  /** caption: up to two wrapped lines at the bottom of the cell */
  const cap = (text) => { const ls = wrap(text, w - 22, sz(8.4)).slice(0, 2); return lines(x + w / 2, y + h - 4 - (ls.length - 1) * 11, ls, 'tiny', 11, 'middle'); };
  const capH = (text) => (wrap(text, w - 22, sz(8.4)).length > 1 ? 11 : 0);
  if (layer === 'cluster') {
    const ch = capH(T('超节点 × 若干（图中 4 个）', 'SuperPoDs (4 drawn)'));
    s.svg += `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="6" class="panel" style="stroke-dasharray:4 3"/>`;
    s.svg += `<rect x="${x + 12}" y="${y + 8}" width="${w - 24}" height="22" rx="3" class="cpu"/>` + tiny(x + w / 2, y + 23, T('共享存储 · 调度 · 软件', 'storage · scheduler · SW'));
    const pw = 26, ph = h - 68 - ch, py = y + 44, n = 4, step = (w - 28 - pw) / (n - 1);
    for (let j = 0; j < n; j++) { const px = x + 14 + j * step; s.svg += `<line x1="${(px + pw / 2).toFixed(1)}" y1="${y + 30}" x2="${(px + pw / 2).toFixed(1)}" y2="${py}" class="l-so"/><rect x="${px.toFixed(1)}" y="${py}" width="${pw}" height="${ph}" rx="3" class="cab"/>`; for (let r = 0; r < 3; r++) s.svg += `<rect x="${(px + 4).toFixed(1)}" y="${py + 5 + r * 9}" width="${pw - 8}" height="6" rx="1" class="tray"/>`; }
    s.svg += cap(T('超节点 × 若干（图中 4 个）', 'SuperPoDs (4 drawn)'));
    s.zoom = { x: x + 14 + 3 * step, y: py, w: pw, h: ph }; s.outer = { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
  } else if (layer === 'scaleout') {
    const text = T(`RoCE / UBoE · ${G.soTiers} 层 Clos`, `RoCE / UBoE · ${G.soTiers}-tier Clos`), ch = capH(text);
    const tiers = Math.min(G.soTiers, 3), rowH = 22, inner = w - 28, x0 = x + 14;
    const boxes = []; // per tier: centres
    for (let t = 0; t < tiers; t++) { const n = t === tiers - 1 ? 2 : 4, bw = inner / n - 6, yy = y + 8 + (tiers - 1 - t) * rowH; const cs = []; for (let j = 0; j < n; j++) { const bx = x0 + (inner / n) * j + 3; s.svg += `<rect x="${bx.toFixed(1)}" y="${yy}" width="${bw.toFixed(1)}" height="14" rx="2" class="so"/>`; cs.push({ cx: bx + bw / 2, top: yy, bottom: yy + 14 }); } boxes.push(cs); }
    for (let t = 0; t + 1 < tiers; t++) for (const b of boxes[t]) { const up = boxes[t + 1][b.cx < x + w / 2 ? 0 : boxes[t + 1].length - 1]; s.svg += `<line x1="${b.cx.toFixed(1)}" y1="${b.top}" x2="${up.cx.toFixed(1)}" y2="${up.bottom}" class="l-so"/>`; }
    const py = y + 8 + tiers * rowH + 4, pw = 22, ph = Math.max(14, h - (py - y) - 14 - ch), n = 5, step = (inner - pw) / (n - 1);
    for (let j = 0; j < n; j++) { const px = x0 + j * step; const low = boxes[0][Math.min(3, Math.floor(j * 4 / n))]; s.svg += `<line x1="${(px + pw / 2).toFixed(1)}" y1="${low.bottom}" x2="${(px + pw / 2).toFixed(1)}" y2="${py}" class="l-so"/><rect x="${px.toFixed(1)}" y="${py}" width="${pw}" height="${ph}" rx="3" class="cab"/>`; }
    s.svg += cap(text);
    s.zoom = { x: x0 + (n - 1) * step, y: py, w: pw, h: ph }; s.outer = { x: x + 10, y: y + 4, w: w - 20, h: h - 16 - ch };
  } else if (layer === 'superpod') {
    const label = G.fabric === 'server' ? T('服务器内 UB（7 L1）', 'in-server UB (7 L1)') : G.fabric === 'two-level' ? T('L1/L2 UB 交换 + 光', 'L1/L2 UB + optics') : T('UB 交换 + 光链路', 'UB switching + optics');
    const text = T(G.podLabel.zh, G.podLabel.en), ch = capH(text);
    s.svg += `<rect x="${x + 10}" y="${y + 8}" width="${w - 20}" height="22" rx="3" class="ub"/>` + tiny(x + w / 2, y + 23, label);
    const n = Math.min(6, Math.max(1, G.podCabinets)), cw = 18, cy = y + 48, chh = h - 64 - ch, inner = w - 28, step = n > 1 ? Math.min(24, (inner - cw) / (n - 1)) : 0, x0 = x + 14 + (inner - (n - 1) * step - cw) / 2;
    for (let j = 0; j < n; j++) { const cx = x0 + j * step; s.svg += `<line x1="${(cx + cw / 2).toFixed(1)}" y1="${y + 30}" x2="${(cx + cw / 2).toFixed(1)}" y2="${cy}" class="l-ub"/><rect x="${cx.toFixed(1)}" y="${cy}" width="${cw}" height="${chh}" rx="2" class="cab"/>`; for (let r = 0; r < Math.min(5, G.nodesPerCabinet); r++) s.svg += `<rect x="${(cx + 3).toFixed(1)}" y="${(cy + 4 + r * ((chh - 8) / 5)).toFixed(1)}" width="${cw - 6}" height="${Math.max(3, (chh - 8) / 5 - 2).toFixed(1)}" rx="1" class="tray"/>`; }
    s.svg += cap(text);
    s.zoom = { x: x0 + (n - 1) * step, y: cy, w: cw, h: chh }; s.outer = { x: x + 10, y: y + 8, w: w - 20, h: chh + 40 };
  } else if (layer === 'cabinet') {
    const text = T(`节点 × ${G.nodesPerCabinet} · 背板（左）`, `nodes × ${G.nodesPerCabinet} · backplane (left)`), ch = capH(text);
    const cy = y + 6, ch2 = h - 24 - ch, sx = x + 12, sw = 46, cx = sx + sw + 10, cw = w - (cx - x) - 12;
    s.svg += `<rect x="${sx}" y="${cy}" width="${sw}" height="${ch2}" rx="3" class="cpu"/>`;
    T(['供电', '液冷', '管理', '框内 IO'], ['power', 'cooling', 'mgmt', 'IO']).forEach((t, i) => { s.svg += tiny(sx + sw / 2, cy + 17 + i * Math.min(18, (ch2 - 20) / 3), t); });
    s.svg += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch2}" rx="3" class="cab"/><rect x="${cx + 5}" y="${cy + 5}" width="6" height="${ch2 - 10}" rx="1" class="unk"/>`;
    const trays = G.nodesPerCabinet, th = (ch2 - 10) / trays;
    for (let r = 0; r < trays; r++) s.svg += `<rect x="${cx + 15}" y="${(cy + 5 + r * th).toFixed(1)}" width="${cw - 21}" height="${Math.max(2, th - 2).toFixed(1)}" rx="1.5" class="tray"/>`;
    s.svg += cap(text);
    const zr = Math.min(2, trays - 1);
    s.zoom = { x: cx + 15, y: cy + 5 + zr * th, w: cw - 21, h: th - 2 }; s.outer = { x: cx, y: cy, w: cw, h: ch2 };
  } else if (layer === 'node') {
    const text = T(`8 NPU + ${G.cpusPerNode} CPU`, `8 NPUs + ${G.cpusPerNode} CPUs`), ch = capH(text);
    const nx = x + 10, ny = y + 8, nw = w - 20, nh = h - 26 - ch;
    s.svg += `<rect x="${nx}" y="${ny}" width="${nw}" height="${nh}" rx="3" class="cab"/>`;
    const four = G.cpusPerNode > 2;
    if (four) { for (let r = 0; r < 4; r++) s.svg += `<rect x="${nx + 6 + (r % 2) * 14}" y="${ny + 8 + Math.floor(r / 2) * 20}" width="12" height="16" rx="2" class="cpu"/>`; s.svg += tiny(nx + 20, ny + 60, 'CPU×4'); }
    else { for (let r = 0; r < 2; r++) s.svg += `<rect x="${nx + 6}" y="${ny + 8 + r * 20}" width="28" height="16" rx="2" class="cpu"/>` + tiny(nx + 20, ny + 20 + r * 20, 'CPU'); }
    const nx0 = nx + 42, sq = 16, st = 20;
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) s.svg += `<rect x="${nx0 + k * st}" y="${ny + 8 + r * 20}" width="${sq}" height="${sq}" rx="2" class="npu"/>`;
    s.svg += `<rect x="${nx0}" y="${ny + 50}" width="34" height="13" rx="2" class="so"/>` + tiny(nx0 + 17, ny + 60, 'NIC') + `<rect x="${nx0 + 40}" y="${ny + 50}" width="${Math.min(40, nx + nw - nx0 - 44)}" height="13" rx="2" class="tray"/>` + tiny(nx0 + 40 + Math.min(40, nx + nw - nx0 - 44) / 2, ny + 60, 'DDR·SSD', 'middle', `font-size:${(7.4 * FS).toFixed(1)}px`);
    s.svg += cap(text);
    s.zoom = { x: nx0 + 3 * st, y: ny + 8, w: sq, h: sq }; s.outer = { x: nx, y: ny, w: nw, h: nh };
  } else if (layer === 'npu') {
    const text = T('模组：CORE · SRAM · IOD · HBM', 'module: CORE · SRAM · IOD · HBM'), ch = capH(text);
    const mx = x + 14, my = y + 6, mw = w - 28, mh = h - 24 - ch;
    s.svg += `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="4" class="cab"/>`;
    const hw = 16, dx = mx + hw + 8, dw = mw - 2 * (hw + 8);
    s.svg += `<rect x="${dx}" y="${my + 10}" width="${dw}" height="${mh - 20}" rx="3" class="npu"/>` + tiny(dx + dw / 2, my + mh / 2 - 4, 'CORE') + tiny(dx + dw / 2, my + mh / 2 + 9, 'SRAM·IOD');
    for (const hx of [mx + 4, mx + mw - hw - 4]) for (let r = 0; r < 2; r++) { const hh = (mh - 20) / 2 - 3, hy = my + 10 + r * ((mh - 20) / 2); s.svg += `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh.toFixed(1)}" rx="2" class="tray"/>` + `<text x="${hx + hw / 2}" y="${(hy + hh / 2 + 3).toFixed(1)}" class="tiny" text-anchor="middle" style="font-size:${(7.2 * FS).toFixed(1)}px">HBM</text>`; }
    s.svg += cap(text);
    s.outer = { x: mx, y: my, w: mw, h: mh };
  }
  return s;
}
/** dashed zoom lines from a magnified element to the next drawing's outer rect, and the highlight of the element */
export const zoomLines = (z, o) => `<path d="M ${z.x + z.w} ${z.y} L ${o.x} ${o.y}" class="zoom"/><path d="M ${z.x + z.w} ${z.y + z.h} L ${o.x} ${o.y + o.h}" class="zoom"/><rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="1.5" style="fill:none;stroke:var(--muted);stroke-width:1.2"/>`;
