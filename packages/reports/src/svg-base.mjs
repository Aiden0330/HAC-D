/**
 * Text and SVG primitives shared with the earlier reports: HTML escaping, number formatting, the calibrated text-width model
 * (CJK 1 em, capitals and digits ≈ 0.66 em, lower case ≈ 0.56 em), line wrapping, and the SVG style of the validated light /
 * dark palette. Copied verbatim from scripts/ascend950-figures.mjs (the span from `export const esc` to the end of `STYLE`);
 * test/drift.test.mjs keeps the two identical until that script is retired.
 */

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

/* ---------- text measurement and wrapping (calibrated against the rendered PDF: CJK 1 em, capitals and digits ≈ 0.66 em, lower case ≈ 0.56 em) ---------- */
const CJK = /[⺀-鿿　-〿＀-￯]/;
const cw = (ch, fs, mono) => (CJK.test(ch) ? fs : mono ? fs * 0.62 : /[A-Z0-9#%@&≈≤≥×→µ‰²⁹]/.test(ch) ? fs * 0.66 : /[ilj.,;:'|!()\[\] ]/.test(ch) ? fs * 0.33 : fs * 0.56);
export const tw = (s, fs = 11, mono = false) => Array.from(s).reduce((a, ch) => a + cw(ch, fs, mono), 0);
export function wrap(text, maxW, fs = 11, mono = false) {
  const toks = text.match(/[⺀-鿿　-〿＀-￯]|[^\s⺀-鿿　-〿＀-￯]+|\s+/g) ?? [];
  const out = [];
  let cur = '';
  for (const t of toks) {
    if (/^\s+$/.test(t)) { if (cur) cur += ' '; continue; }
    const cand = cur + t;
    if (tw(cand, fs, mono) <= maxW || !cur.trim()) { cur = cand; continue; }
    out.push(cur.trimEnd());
    cur = t;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  for (let i = 1; i < out.length; i++) { const m = out[i].match(/^[，。；：、）)」%]+/); if (m) { out[i - 1] += m[0]; out[i] = out[i].slice(m[0].length); } }
  return out.filter(Boolean);
}
export const lines = (x, y, ls, cls, lh, anchor = 'start') => ls.map((ln, i) => `<text x="${x}" y="${(y + i * lh).toFixed(1)}" class="${cls}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(ln)}</text>`).join('');
/** wrapped text block; returns { svg, h } */
export function textBlock(x, y, text, maxW, cls = 's', fs = 9.8, lh = 12, anchor = 'start') {
  const ls = wrap(text, maxW, fs);
  return { svg: lines(x, y, ls, cls, lh, anchor), h: ls.length * lh };
}

/* ---------- SVG style (validated palette of the earlier reports; light and dark) ---------- */
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const LIGHT = '--surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --b1:#e8f0fb; --b2:#fdece4; --b3:#e4f6ee; --b4:#fdf3dc; --b5:#f0efec; --b6:#fce8f0; --mid:#f0efec;';
const DARK = '--surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#46463f; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --b1:#1f2d44; --b2:#3d2619; --b3:#1b3328; --b4:#3a2f17; --b5:#2a2a28; --b6:#3a1f2b; --mid:#383835;';
export const STYLE = `
svg.viz { ${LIGHT} font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.viz { ${DARK} } }
:root[data-theme="light"] svg.viz { ${LIGHT} }
:root[data-theme="dark"] svg.viz { ${DARK} }
svg.viz text { fill: var(--ink); font-size: 11px; } svg.viz .ttl { font-size: 13px; font-weight: 600; } svg.viz .h { font-size: 11.5px; font-weight: 700; }
svg.viz .t2 { fill: var(--ink2); font-size: 11px; } svg.viz .s { fill: var(--ink2); font-size: 9.8px; } svg.viz .m { fill: var(--muted); font-size: 9.8px; } svg.viz .num { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
svg.viz .tiny { fill: var(--ink2); font-size: 8.4px; } svg.viz .sb { fill: var(--ink); font-size: 9.8px; font-weight: 600; }
svg.viz .panel { fill: var(--surface); stroke: var(--grid); stroke-width: 1; } svg.viz .cab { fill: var(--surface); stroke: var(--axis); stroke-width: 1.1; }
svg.viz .npu { fill: var(--b1); stroke: var(--s1); stroke-width: 0.8; } svg.viz .tray { fill: var(--b1); stroke: var(--s1); stroke-width: 0.8; }
svg.viz .ub { fill: var(--b3); stroke: var(--s3); stroke-width: 1; } svg.viz .ubsolid { fill: var(--s3); stroke: var(--s3); stroke-width: 1; }
svg.viz .so { fill: var(--b2); stroke: var(--s2); stroke-width: 1; } svg.viz .cpu { fill: var(--b5); stroke: var(--axis); stroke-width: 0.8; }
svg.viz .asm { fill: none; stroke: var(--s4); stroke-width: 1.3; stroke-dasharray: 4 3; } svg.viz .unk { fill: var(--b4); stroke: var(--s4); stroke-width: 1; stroke-dasharray: 3 2; }
svg.viz .l-ub { stroke: var(--s3); stroke-width: 0.7; fill: none; } svg.viz .l-ubb { stroke: var(--s3); stroke-width: 1.6; fill: none; } svg.viz .l-so { stroke: var(--s2); stroke-width: 0.7; fill: none; }
svg.viz .l-npu { stroke: var(--s1); stroke-width: 0.7; fill: none; } svg.viz .zoom { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; fill: none; }
svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .grid { stroke: var(--grid); stroke-width: 1; } svg.viz .lead { stroke: var(--muted); stroke-width: 0.8; fill: none; }
svg.viz .dot-on { fill: var(--s1); stroke: var(--surface); stroke-width: 1.5; } svg.viz .dot-spec { fill: var(--surface); stroke: var(--s1); stroke-width: 1.8; } svg.viz .dot-ref { fill: var(--surface); stroke: var(--muted); stroke-width: 1.5; }
svg.viz .halo { paint-order: stroke; stroke: var(--surface); stroke-width: 3.4px; stroke-linejoin: round; }
`;
