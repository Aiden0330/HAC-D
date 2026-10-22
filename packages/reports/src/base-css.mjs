/**
 * House CSS of the earlier HAC-D reports (page, type, tables, figures, print A4 pages). Copied verbatim from the `const css`
 * template literal of scripts/build-ascend950-scaling.mjs; test/drift.test.mjs keeps the two identical until that script is retired.
 */
export const BASE_CSS = `
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --warn:#a8691b; --warn-soft:#f6ead6; --bad:#b4361c; --bad-soft:#fbe6df; --mid-soft:#fdf3dc; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --warn:#e0a85a; --warn-soft:#3a2e1d; --bad:#f08a6c; --bad-soft:#3d2219; --mid-soft:#3a2f17; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --warn:#e0a85a; --warn-soft:#3a2e1d; --bad:#f08a6c; --bad-soft:#3d2219; --mid-soft:#3a2f17; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
  main { max-width: 1120px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 22px 26px 26px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 22px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 16px; font-weight: 600; margin: 14px 0 6px; padding-top: 8px; border-top: 1px solid var(--rule); }
  h3 { font-size: 13.5px; margin: 10px 0 4px; }
  p { margin: 5px 0; } .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 6px; }
  a { color: var(--accent); }
  code, .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; }
  p, h1, h2, h3, .callout, li { overflow-wrap: anywhere; } td, th { overflow-wrap: break-word; }
  table.t1 td:first-child { min-width: 15em; } table.map td:first-child { min-width: 12em; } table.map td:nth-child(7) { min-width: 16em; } table.t3 td:first-child, table.t5 td:first-child, table.t7 td:first-child { min-width: 11em; } table.t5 td { min-width: 9em; } td.src { min-width: 8em; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.6px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.2px; } th.c { text-align: center; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } th.num { white-space: normal; }
  td.src { color: var(--muted); font-size: 10.8px; } tr.b td { font-weight: 600; } td.b { font-weight: 600; } td.num.w { white-space: normal; } td.nw { white-space: nowrap; }
  table.t1 { font-size: 11.2px; } table.t7 td.num.w { min-width: 6.5em; } table.shp td.set { min-width: 20em; } table.shp th.num { white-space: nowrap; }
  tr.sec td { background: var(--surface-2); font-weight: 600; font-size: 11px; color: var(--muted); letter-spacing: 0.02em; }
  tr.sum td { background: var(--surface-2); }
  td.bad { background: var(--bad-soft); color: var(--bad); font-weight: 700; } td.mid { background: var(--mid-soft); }
  figure.chart { margin: 8px 0 10px; } .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; } figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  .callout ul { margin: 2px 0; padding-left: 16px; } .callout li { margin: 3px 0; }
  .formula { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.6px; background: var(--surface-2); padding: 5px 9px; border-radius: 5px; margin: 6px 0; }
  .note { font-size: 11.3px; color: var(--muted); }
  ul.scale { margin: 4px 0; padding-left: 18px; } ul.scale li { margin: 3px 0; }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; }
  #tip { position: fixed; z-index: 10; pointer-events: none; display: none; max-width: 340px; background: var(--surface); color: var(--ink); border: 1px solid var(--rule); border-radius: 6px; padding: 6px 9px; font-size: 11.5px; line-height: 1.45; box-shadow: 0 4px 14px rgba(0,0,0,0.18); }
  #tip b { display: block; margin-bottom: 2px; }
  @media screen and (max-width: 760px) { .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 760px; } .table-wrap table.t5, .table-wrap table.t8 { min-width: 640px; } .scroll svg { min-width: 780px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.3px; line-height: 1.33; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 6.9px; line-height: 1.22; } th, td { padding: 0.8px 2.4px; } th { font-size: inherit; } td.src { font-size: 6.4px; } tr.sec td { font-size: 6.6px; }
    code, .f, .formula { font-size: 6.9px; } .formula { padding: 2px 5px; margin: 3px 0; }
    .callout, .sub, footer, .note { font-size: 7.3px; } .callout { margin: 3px 0; padding: 3px 7px; } .callout li { margin: 1px 0; } footer { font-size: 6.8px; }
    h1 { font-size: 13.5px; margin: 2px 0 3px; } h2 { font-size: 10.2px; margin: 4px 0 2px; padding-top: 3px; } h3 { font-size: 8.8px; margin: 3px 0 1px; } .eyebrow { font-size: 7.3px; }
    figure.chart { margin: 2px 0 3px; } figcaption { font-size: 7px; margin-top: 0; } p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    ul.scale li { margin: 1px 0; } #tip { display: none !important; }
    table.t1 { font-size: 7.2px; line-height: 1.2; } table.t1 td, table.t1 th { padding: 0.6px 2px; } table.t1 td:first-child { min-width: 13em; } table.t1 td.src { font-size: 6.4px; }
    html[lang="en"] table.t1 { font-size: 6.5px; line-height: 1.16; } html[lang="en"] table.t1 td, html[lang="en"] table.t1 th { padding: 0.5px 2px; } html[lang="en"] table.t1 td.src { font-size: 6px; }
    .callout li { line-height: 1.26; }
  }
`;
