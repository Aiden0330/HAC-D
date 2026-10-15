/** Shared pieces of the standalone HTML reports (audit, allocation study): escaping, number formats, page CSS, JSON embedding. */
export const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const pct = (x: number, d = 2): string => (x * 100).toFixed(d);
export const num = (x: number, d = 2): string => Number(x).toFixed(d);
export const sgn = (x: number, d = 2): string => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
/** JSON for a <script type="application/json"> block (no closing-tag or line-separator surprises) */
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
export const jsonScript = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

export const REPORT_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">';

/** HAC-D report tokens and base styles (light / dark, print) */
export const REPORT_CSS = `
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; --ok:#2d7a4f; --ok-soft:#e1f0e6; --crit:#b3382c; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#7cc89a; --ok-soft:#1f3327; --crit:#e07a6f; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#7cc89a; --ok-soft:#1f3327; --crit:#e07a6f; }
  * { box-sizing: border-box; }
  html { background: var(--bg); scroll-behavior: smooth; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif; font-size: 14px; line-height: 1.55; }
  main { max-width: 1240px; margin: 0 auto; padding: 24px 18px 60px; }
  header.title { border-top: 5px solid var(--accent); padding: 18px 0 14px; margin-bottom: 14px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 28px; font-weight: 600; line-height: 1.25; margin: 8px 0 6px; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 19px; font-weight: 600; margin: 26px 0 8px; }
  h3 { font-size: 13px; color: var(--accent); margin: 10px 0 4px; }
  p { margin: 6px 0; }
  .sub { color: var(--muted); max-width: 1040px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  button { background: var(--ink); color: var(--surface); border: 0; padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; font-family: inherit; }
  button.secondary { background: var(--surface); color: var(--ink); border: 1px solid var(--rule); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 12px 0 18px; }
  .card { padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; }
  .card b { display: block; font-size: 24px; line-height: 1.2; margin: 4px 0; font-weight: 600; }
  .card span { font-size: 12px; color: var(--muted); }
  .note { padding: 10px 14px; border-left: 4px solid var(--warn); background: var(--warn-soft); border-radius: 0 8px 8px 0; margin: 12px 0; }
  .note p { margin: 4px 0; }
  .callout { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 8px 12px; border-radius: 0 6px 6px 0; margin: 10px 0; }
  .table-wrap { overflow: auto; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th { text-align: left; background: var(--surface-2); color: var(--muted); padding: 9px 10px; white-space: nowrap; font-weight: 600; font-size: 12px; }
  td { vertical-align: top; padding: 9px 10px; border-top: 1px solid var(--rule); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { font-size: 12px; color: var(--muted); }
  .small { font-size: 11.5px; color: var(--muted); }
  .tag { display: inline-block; background: var(--accent-soft); color: var(--accent); border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
  .tag.assumed { background: var(--warn-soft); color: var(--warn); }
  .tag.ok { background: var(--ok-soft); color: var(--ok); }
  .gain { color: var(--ok); font-weight: 600; }
  .gain.neg { color: var(--crit); }
  .before { color: var(--muted); }
  .warning { font-size: 12px; color: var(--warn); }
  code, .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 12px; }
  .f { background: var(--surface-2); border-left: 3px solid var(--accent); padding: 6px 10px; border-radius: 0 6px 6px 0; margin: 6px 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  article { margin-top: 18px; padding: 18px 20px; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; scroll-margin-top: 16px; }
  .article-title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .article-title .no { font-family: "IBM Plex Mono", monospace; color: var(--muted); }
  .article-title .headline { margin-left: auto; text-align: right; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 14px; }
  .box { background: var(--surface-2); border-radius: 8px; padding: 8px 12px; }
  .box h3 { margin: 0 0 4px; }
  .box p, .box li { margin: 3px 0; font-size: 12.8px; }
  ol.workflow { padding-left: 20px; margin: 4px 0; } ol.workflow li { margin: 2px 0; }
  details { margin-top: 8px; } summary { cursor: pointer; color: var(--accent); font-size: 12.5px; }
  pre.json { background: var(--surface-2); padding: 8px 10px; border-radius: 6px; font-size: 11px; overflow: auto; max-height: 320px; }
  nav.proposal-nav a { display: inline-block; margin: 2px 8px 2px 0; }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  figure.chart { margin: 10px 0 12px; position: relative; background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 8px; }
  figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 12px; color: var(--muted); margin-top: 6px; }
  .tip { position: absolute; z-index: 5; pointer-events: none; background: var(--ink); color: var(--surface); font-size: 11.5px; line-height: 1.4; padding: 6px 9px; border-radius: 6px; white-space: pre-line; max-width: 320px; box-shadow: 0 2px 8px rgba(0,0,0,.25); display: none; }
  footer { font-size: 12px; color: var(--muted); margin-top: 24px; border-top: 1px solid var(--rule); padding-top: 10px; }
  @media screen and (max-width: 760px) { .grid2, .grid4 { grid-template-columns: 1fr; } h1 { font-size: 22px; } main { padding: 14px 12px 40px; } }
  @media print { @page { size: A4; margin: 10mm; } html, body { background: #fff; color: #000; font-size: 10px; } main { max-width: none; padding: 0; } article { break-inside: avoid; } .actions, .tip { display: none !important; } details { display: block; } }
`;

/** Tooltip helper: elements with data-tip show it on hover inside their figure or body. */
export const TOOLTIP_JS = `
(function(){
  function tipFor(el){ var f = el.closest('figure') || document.body; var t = f.querySelector(':scope > .tip'); if(!t){ t = document.createElement('div'); t.className='tip'; f.appendChild(t);} return [t, f]; }
  document.querySelectorAll('[data-tip]').forEach(function(el){
    el.addEventListener('mousemove', function(ev){ var r = tipFor(el), t = r[0], f = r[1]; var b = f.getBoundingClientRect(); var x = ev.clientX - b.left + 14, y = ev.clientY - b.top + 14; if (x + 330 > b.width) x = Math.max(0, ev.clientX - b.left - 330); t.textContent = el.getAttribute('data-tip'); t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.display = 'block'; });
    el.addEventListener('mouseleave', function(){ var t = tipFor(el)[0]; t.style.display = 'none'; });
  });
})();`;
