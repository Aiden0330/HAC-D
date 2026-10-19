#!/usr/bin/env node
/**
 * Build docs/design/TOPOLOGY_PAGE_OPTIONS.html: wireframes of three frontend options for HAC-D's new first page
 * (topology → hardware → fault types → default mechanisms → KPIs), see docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §4.
 * Numbers on the wireframes: hardware counts from computeCounts with the CloudMatrix384 preset (full-pod fill) at
 * 1k / 10k / 20k / 50k NPUs; KPIs from the 54-event reference catalog with the six default mechanisms; FIT per unit derived
 * from the catalog under the CloudMatrix384 geometry (docs/ascend-architecture/counts.json).
 * Usage: node scripts/build-topology-page-options.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('docs/design', { recursive: true });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const R = (x, y, w, h, cls, rx = 4, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"${extra ? ' ' + extra : ''}/>`;
const T = (x, y, s, cls = 's', anchor = 'start') => `<text x="${x}" y="${y}" class="${cls}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;
const L = (x1, y1, x2, y2, cls) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;

/* data (see header) */
const SCALES = ['1k', '10k', '20k', '50k'];
const KPI = { '10k': { aop: '99.91 %', del: '97.97 %', mtbi: '29.4 h', pause: '95 s' } };
const HW = [
  ['NPU (910C)', '1', ['1,000', '10,000', '20,000', '50,000'], 'CORE SRAM IOD MEMT MEMP MODULE', '1,577'],
  ['Node (8 NPU · 4 CPU)', '0.125', ['125', '1,250', '2,500', '6,250'], 'CPU DDR SSD BOXIO MGMT', '5,707'],
  ['NPU port (UB NIC / RDMA)', '1', ['1,000', '10,000', '20,000', '50,000'], 'NIC', '100'],
  ['UB L1 switch chip', '0.875', ['875', '8,750', '17,500', '43,750'], 'FABRIC', '57'],
  ['UB L2 switch chip', '0.30', ['336', '3,024', '5,936', '14,672'], 'FABRIC', '57'],
  ['L1–L2 optical link', '14', ['14,000', '140,000', '280,000', '700,000'], 'OPT', '4.8'],
  ['Compute cabinet', '0.031', ['32', '313', '625', '1,563'], 'POWER COOL', '8,533'],
  ['Comm. cabinet (L2)', '0.011', ['12', '108', '212', '524'], 'POWER COOL', '8,533'],
  ['SuperPoD (384 NPU)', '0.0026', ['3', '27', '53', '131'], '—', '—'],
];

const LIGHT = '--surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --b1:#e8f0fb; --b2:#fdece4; --b3:#e4f6ee; --b4:#fdf3dc; --b5:#f0efec; --bar:#efede7;';
const DARK = '--surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#46463f; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --b1:#1f2d44; --b2:#3d2619; --b3:#1b3328; --b4:#3a2f17; --b5:#2a2a28; --bar:#262724;';
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const STYLE = `
svg.wf { ${LIGHT} font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.wf { ${DARK} } }
:root[data-theme="light"] svg.wf { ${LIGHT} } :root[data-theme="dark"] svg.wf { ${DARK} }
svg.wf text { fill: var(--ink); font-size: 11px; } svg.wf .h { font-size: 12.5px; font-weight: 700; } svg.wf .h2 { font-size: 11.5px; font-weight: 600; } svg.wf .s { fill: var(--ink2); font-size: 10.5px; } svg.wf .m { fill: var(--muted); font-size: 10px; } svg.wf .num { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; } svg.wf .brand { font-size: 13px; font-weight: 700; } svg.wf .on { fill: var(--s1); font-weight: 600; }
svg.wf .app { fill: var(--surface); stroke: var(--axis); stroke-width: 1.2; } svg.wf .bar { fill: var(--bar); stroke: none; } svg.wf .panel { fill: var(--surface); stroke: var(--grid); stroke-width: 1.2; } svg.wf .sub { fill: var(--b5); stroke: none; }
svg.wf .npu { fill: var(--b1); stroke: var(--s1); stroke-width: 1; } svg.wf .ub { fill: var(--b3); stroke: var(--s3); stroke-width: 1; } svg.wf .rdma { fill: var(--b2); stroke: var(--s2); stroke-width: 1; } svg.wf .cpu { fill: var(--b5); stroke: var(--axis); stroke-width: 1; }
svg.wf .card { fill: var(--surface); stroke: var(--axis); stroke-width: 1; } svg.wf .sel { fill: var(--b1); stroke: var(--s1); stroke-width: 2.2; } svg.wf .chip { fill: var(--surface); stroke: var(--axis); stroke-width: 1; } svg.wf .chipOn { fill: var(--s1); stroke: var(--s1); stroke-width: 1; } svg.wf .chipOnT { fill: var(--surface); font-weight: 600; }
svg.wf .mech { fill: var(--b3); stroke: var(--s3); stroke-width: 1; } svg.wf .kpi { fill: var(--b5); stroke: none; } svg.wf .hl { fill: var(--b1); stroke: none; } svg.wf .btn { fill: var(--s1); stroke: none; } svg.wf .btnT { fill: var(--surface); font-weight: 600; }
svg.wf .l-ub { stroke: var(--s3); stroke-width: 0.7; opacity: 0.55; } svg.wf .l-rdma { stroke: var(--s2); stroke-width: 0.8; opacity: 0.7; } svg.wf .rule { stroke: var(--grid); stroke-width: 1; } svg.wf .step { stroke: var(--axis); stroke-width: 2; } svg.wf .tab { stroke: var(--s1); stroke-width: 2.5; }
svg.wf .dash { fill: none; stroke: var(--axis); stroke-dasharray: 4 3; }
`;
const svgOpen = (id, W, H, label) => `<svg class="wf" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${STYLE}</style>`;

/* building blocks */
function chrome(W, H) {
  let g = R(8, 8, W - 16, H - 16, 'app', 10) + R(9, 9, W - 18, 36, 'bar', 9) + T(22, 32, 'HAC-D · NPU', 'brand');
  const nav = ['Topology & hardware', 'Mechanisms', 'Allocation', 'Fault library', 'All pages ▾'];
  let x = 140;
  nav.forEach((n, i) => { const w = n.length * 6.1 + 18; g += i === 0 ? `${R(x, 16, w, 22, 'chipOn', 11)}${T(x + w / 2, 31, n, 's chipOnT', 'middle')}` : T(x + w / 2, 31, n, 's', 'middle'); x += w + 6; });
  g += T(W - 22, 31, '中文 | EN · ◐', 'm', 'end');
  return g;
}
function thumbA2(x, y, w, h) {
  let g = '';
  const sp = [0, 1, 2].map((k) => [x + w * (0.2 + k * 0.3) - 7, y + 3]);
  const lf = [0, 1, 2, 3].map((k) => [x + w * (0.12 + k * 0.255) - 5, y + h * 0.36]);
  for (const l of lf) for (const s of sp) g += L(l[0] + 5, l[1], s[0] + 7, s[1] + 5, 'l-rdma');
  for (const s of sp) g += R(s[0], s[1], 14, 5, 'rdma', 1);
  for (const l of lf) g += R(l[0], l[1], 10, 5, 'rdma', 1);
  for (let k = 0; k < 3; k++) { const sx = x + 3 + k * (w - 6) / 3; const sw = (w - 6) / 3 - 4; g += L(sx + sw / 2, y + h * 0.66, lf[k][0] + 5, lf[k][1] + 5, 'l-rdma') + R(sx, y + h * 0.66, sw, h * 0.32, 'card', 2); for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g += R(sx + 2 + c * (sw - 4) / 4, y + h * 0.7 + r * h * 0.13, (sw - 4) / 4 - 1.5, h * 0.1, 'npu', 0.5); }
  return g;
}
function thumbA3(x, y, w, h) {
  let g = R(x + 1, y + 1, w - 2, h - 2, 'card', 4);
  const comm = [0, 1, 2, 3].map((k) => [x + 6 + k * (w - 12) / 4, y + 6]);
  const cab = Array.from({ length: 8 }, (_, k) => [x + 5 + k * (w - 10) / 8, y + h * 0.55]);
  for (const a of cab) for (const b of comm) g += L(a[0] + 3, a[1], b[0] + ((w - 12) / 4 - 4) / 2, b[1] + 7, 'l-ub');
  for (const b of comm) g += R(b[0], b[1], (w - 12) / 4 - 4, 7, 'ub', 1);
  for (const a of cab) g += R(a[0], a[1], (w - 10) / 8 - 3, h * 0.38, 'npu', 1);
  return g;
}
function thumb950(x, y, w, h) {
  let g = R(x + 1, y + 1, w - 2, h - 2, 'card', 4);
  const gw = w * 0.72, cols = 10, rows = 6;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g += R(x + 5 + c * (gw - 6) / cols, y + 5 + r * (h - 10) / rows, (gw - 6) / cols - 1.5, (h - 10) / rows - 1.5, 'npu', 0.5);
  for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) g += R(x + gw + 2 + c * (w - gw - 7) / 3, y + 5 + r * (h - 10) / rows, (w - gw - 7) / 3 - 1.5, (h - 10) / rows - 1.5, 'ub', 0.5);
  return g;
}
const THUMB = [thumbA2, thumbA3, thumb950];
const TOPO = [['A2 · 8-NPU servers + RoCE', 'scale-up 8 · HCCS'], ['A3 · CloudMatrix384', 'scale-up 384 · UB'], ['Atlas 950 · UB 2.0', 'scale-up 8,192 · UB 2.0']];
function chips(x, y, labels, on, w = 42) { return labels.map((l, i) => (i === on ? `${R(x + i * (w + 6), y, w, 22, 'chipOn', 11)}${T(x + i * (w + 6) + w / 2, y + 15, l, 's chipOnT', 'middle')}` : `${R(x + i * (w + 6), y, w, 22, 'chip', 11)}${T(x + i * (w + 6) + w / 2, y + 15, l, 's', 'middle')}`)).join(''); }
function kpis(x, y, w, h) {
  const k = KPI['10k'];
  const items = [['A_op (30 days)', k.aop], ['Delivered goodput', k.del], ['MTBI', k.mtbi], ['Mean pause / event', k.pause]];
  const tw = (w - 3 * 10) / 4;
  return items.map(([l, v], i) => `${R(x + i * (tw + 10), y, tw, h, 'kpi', 6)}${T(x + i * (tw + 10) + 10, y + 16, l, 'm')}${T(x + i * (tw + 10) + 10, y + h - 10, v, 'num')}`).join('');
}
function mechChips(x, y) {
  let g = T(x, y + 15, 'Default mechanisms (ReMAP six):', 's');
  let cx = x + 178;
  for (const m of ['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC', 'C-FAST']) { const w = m.length * 6.6 + 14; g += R(cx, y, w, 22, 'mech', 11) + T(cx + w / 2, y + 15, m, 's', 'middle'); cx += w + 6; }
  return g + T(cx + 6, y + 15, 'edit on Mechanisms ›', 'on');
}
function cm384Mini(x, y, w, h, pods = '× 27 pods') {
  let g = '';
  const comm = [0, 1, 2, 3].map((k) => [x + w * 0.12 + k * w * 0.2, y + h * 0.12]);
  const cab = Array.from({ length: 12 }, (_, k) => [x + w * 0.05 + k * (w * 0.9) / 12, y + h * 0.5]);
  const cw = (w * 0.9) / 12 - 6;
  for (const a of cab) for (const b of comm) g += L(a[0] + cw / 2, a[1], b[0] + w * 0.07, b[1] + 22, 'l-ub');
  for (const b of comm) g += R(b[0], b[1], w * 0.14, 22, 'ub', 3) + T(b[0] + w * 0.07, b[1] + 15, 'L2', 's', 'middle');
  for (const a of cab) g += R(a[0], a[1], cw, h * 0.3, 'npu', 3);
  g += R(x + w * 0.05, y + h * 0.88, w * 0.9, 5, 'rdma', 2);
  for (let k = 0; k < 6; k++) g += L(x + w * 0.05 + cw / 2 + k * 2 * (w * 0.9) / 12, y + h * 0.8, x + w * 0.05 + cw / 2 + k * 2 * (w * 0.9) / 12, y + h * 0.88, 'l-rdma');
  g += R(x + w - 86, y + h * 0.02, 82, 22, 'chipOn', 11) + T(x + w - 45, y + h * 0.02 + 15, pods, 's chipOnT', 'middle');
  return g;
}
function hwTable(x, y, w, cols, rowsFn, highlightCol = -1) {
  let g = '';
  const totalW = cols.reduce((a, c) => a + c[1], 0);
  const scale = w / totalW;
  let cx = x;
  const xs = cols.map((c) => { const v = cx; cx += c[1] * scale; return v; });
  if (highlightCol >= 0) g += R(xs[highlightCol] - 2, y - 14, cols[highlightCol][1] * scale, 24 + rowsFn.length * 22, 'hl', 4);
  cols.forEach((c, i) => { g += T(c[2] === 'end' ? xs[i] + c[1] * scale - 6 : xs[i] + 2, y, c[0], 'h2', c[2] ?? 'start'); });
  g += L(x, y + 6, x + w, y + 6, 'rule');
  rowsFn.forEach((r, j) => { const ry = y + 24 + j * 22; r.forEach((v, i) => { g += T(cols[i][2] === 'end' ? xs[i] + cols[i][1] * scale - 6 : xs[i] + 2, ry, v, i === 0 ? 's' : 's', cols[i][2] ?? 'start'); }); g += L(x, ry + 7, x + w, ry + 7, 'rule'); });
  return g;
}

/* option A: picture-first canvas */
function optionA() {
  const W = 960, H = 612;
  let g = chrome(W, H);
  const CARD = [['A2', 'servers + RoCE', 'scale-up 8'], ['A3', 'CloudMatrix384', 'scale-up 384'], ['Atlas 950', 'UB 2.0 SuperPoD', 'scale-up 8,192']];
  CARD.forEach((t, i) => { const x = 24 + i * 176; g += R(x, 58, 166, 84, i === 1 ? 'sel' : 'card', 8) + THUMB[i](x + 8, 66, 62, 52) + T(x + 78, 84, t[0], 'h2') + T(x + 78, 100, t[1], 's') + T(x + 78, 116, t[2], 'm'); });
  g += T(560, 76, 'Scale (NPUs)', 'h2') + chips(560, 88, SCALES, 1) + R(752, 88, 96, 22, 'chip', 4) + T(760, 103, 'N = 10,000', 's') + T(560, 132, 'any N; other units follow the topology', 'm');
  g += R(24, 154, 540, 276, 'panel', 8) + T(38, 174, 'Live topology · 27 SuperPoDs × 384 NPUs', 'h') + cm384Mini(42, 190, 504, 220);
  g += R(574, 154, 362, 276, 'panel', 8) + T(588, 174, 'Hardware · CloudMatrix384 · 10k NPUs', 'h');
  g += hwTable(588, 198, 334, [['Unit', 128], ['Count', 52, 'end'], ['/NPU', 40, 'end'], ['Faults', 74], ['FIT', 40, 'end']], HW.slice(0, 8).map((r) => [r[0].replace(' (UB NIC / RDMA)', '').replace(' (8 NPU · 4 CPU)', '').replace(' switch chip', '').replace(' optical link', ' link').replace(' (L2)', ''), r[2][1], r[1], r[3].split(' ').slice(0, 2).join(' ') + (r[3].split(' ').length > 2 ? ' …' : ''), r[4]]));
  g += kpis(24, 440, 912, 54) + mechChips(24, 504);
  g += R(24, 538, 912, 54, 'sub', 8) + T(38, 560, '▸ Evaluation details (former Training page)', 'h2') + T(38, 579, 'goodput models · loss decomposition · recovery stages · window ledger · silent corruption · chain · sub-health · scale curve', 's');
  return svgOpen('opt-a', W, H, 'Option A wireframe: picture-first canvas') + g + '</svg>';
}
/* option B: guided stepper */
function optionB() {
  const W = 960, H = 612;
  let g = chrome(W, H);
  g += R(24, 56, 200, 536, 'panel', 8);
  const steps = [['Topology & scale', 'pick A2 / A3 / 950 and N'], ['Hardware list', 'units, counts, per NPU'], ['Fault types', 'FIT per unit, provenance'], ['Mechanisms', 'ReMAP six by default'], ['Constraints & strategy', 'floors · limits · strategy'], ['Results & report', 'allocation, verification, export']];
  steps.forEach((s, i) => { const y = 88 + i * 84; if (i < steps.length - 1) g += L(46, y + 14, 46, y + 70, 'step'); g += `<circle cx="46" cy="${y}" r="13" class="${i === 0 ? 'chipOn' : 'chip'}"/>` + T(46, y + 4, String(i + 1), i === 0 ? 's chipOnT' : 's', 'middle') + T(68, y + 4, s[0], 'h2') + T(68, y + 20, s[1], 'm'); });
  g += R(236, 56, 700, 38, 'kpi', 8) + T(250, 80, `Step 1 of 6 · live result: A_op ${KPI['10k'].aop} · delivered ${KPI['10k'].del} · MTBI ${KPI['10k'].mtbi}`, 's');
  g += R(236, 104, 700, 488, 'panel', 8) + T(252, 128, '① Choose the topology and the scale', 'h');
  TOPO.forEach((t, i) => { const x = 252 + i * 226; g += R(x, 142, 214, 172, i === 1 ? 'sel' : 'card', 8) + THUMB[i](x + 12, 152, 190, 96) + T(x + 12, 270, t[0], 'h2') + T(x + 12, 288, t[1], 's') + T(x + 12, 304, ['servers + leaf / spine', '48 nodes, L1 + L2 UB, 7 sub-planes', '160 cabinets, all-optical'][i], 'm'); });
  g += T(252, 342, 'Scale (NPUs)', 'h2') + chips(340, 328, SCALES, 1) + R(536, 328, 96, 22, 'chip', 4) + T(544, 343, 'N = 10,000', 's');
  g += R(252, 364, 668, 160, 'sub', 8) + T(266, 384, 'Preview: 27 SuperPoDs · 1,250 nodes · 313 + 108 cabinets · 8,750 L1 + 3,024 L2 · 140,000 links', 's') + cm384Mini(270, 392, 632, 124);
  g += R(252, 540, 92, 30, 'chip', 6) + T(298, 559, '◂ Back', 'm', 'middle') + R(744, 540, 176, 30, 'btn', 6) + T(832, 559, 'Next: hardware list ▸', 's btnT', 'middle');
  return svgOpen('opt-b', W, H, 'Option B wireframe: guided stepper') + g + '</svg>';
}
/* option C: split workbench */
function optionC() {
  const W = 960, H = 612;
  let g = chrome(W, H);
  g += R(24, 56, 300, 536, 'panel', 8) + T(38, 78, 'Template', 'h2');
  ['A2', 'A3 · CM384', '950'].forEach((l, i) => { const x = 36 + i * 94; g += R(x, 86, 88, 66, i === 1 ? 'sel' : 'card', 6) + THUMB[i](x + 8, 92, 72, 38) + T(x + 44, 145, l, 's', 'middle'); });
  g += T(38, 176, 'Scale (NPUs)', 'h2') + chips(38, 184, SCALES, 1, 40) + R(228, 184, 84, 22, 'chip', 4) + T(234, 199, 'N = 10,000', 's');
  let y = 220;
  g += R(36, y, 276, 26, 'kpi', 4) + T(46, y + 17, '▾ Hardware parameters', 'h2'); y += 32;
  for (const [k, v] of [['NPUs per node', '8'], ['Nodes per compute cabinet', '4'], ['UB L1 chips per node', '7'], ['Sub-planes × L2 chips', '7 × 16'], ['Fabric fill', 'proportional | full pod']]) { g += T(48, y + 12, k, 's') + T(300, y + 12, v, 's', 'end') + L(48, y + 18, 300, y + 18, 'rule'); y += 22; }
  y += 6;
  for (const [k, v] of [['▸ Fault library', 'FIT per unit'], ['▸ Mechanisms', 'ReMAP six · edit ›'], ['▸ Workload & checkpoint', '30 d · τ 300 s · δ 4 s'], ['▸ Recovery stages', '12.5 s + 180 s + 2 h'], ['▸ Scenario JSON', '']]) { g += R(36, y, 276, 26, 'kpi', 4) + T(46, y + 17, k, 'h2') + T(304, y + 17, v, 'm', 'end'); y += 32; }
  g += R(336, 56, 600, 536, 'panel', 8) + kpis(348, 68, 576, 52);
  const tabs = ['Picture', 'Hardware', 'Reliability (former Training)', 'Allocation'];
  let tx = 352;
  tabs.forEach((t, i) => { const w = t.length * 6.2 + 20; g += T(tx + w / 2, 148, t, i === 1 ? 'on' : 's', 'middle'); if (i === 1) g += L(tx + 4, 156, tx + w - 4, 156, 'tab'); tx += w + 8; });
  g += L(348, 157, 924, 157, 'rule');
  g += hwTable(352, 182, 568, [['Unit', 150], ['/NPU', 44, 'end'], ['1k', 50, 'end'], ['10k', 56, 'end'], ['20k', 56, 'end'], ['50k', 60, 'end'], ['Faults', 100], ['FIT', 40, 'end']], HW.map((r) => [r[0], r[1], ...r[2], r[3].split(' ').slice(0, 2).join(' ') + (r[3].split(' ').length > 2 ? ' …' : ''), r[4]]), 3);
  g += T(352, 400, 'current N highlighted · counts: computeCounts, CloudMatrix384 preset (full-pod fill)', 'm') + T(352, 416, 'FIT per unit derived from the 54-event catalog (per-card FIT × cards ÷ units)', 'm');
  g += R(348, 432, 576, 148, 'sub', 8) + T(362, 452, 'Picture tab (same data): live topology', 'h2') + cm384Mini(380, 460, 520, 112);
  return svgOpen('opt-c', W, H, 'Option C wireframe: split workbench') + g + '</svg>';
}

const OPTS = [
  { id: 'A', name: 'A · Picture-first canvas', svg: optionA(), bullets: [
    ['Layout', 'three topology cards and the scale chips on top; a large live picture with the hardware table beside it; KPI strip and the six default mechanisms underneath; the former Training page collapsed at the bottom.'],
    ['Merges', 'Scenario and Training. Mechanisms and Allocation stay separate pages.'],
    ['Best for', 'presenting and comparing architectures; reviews with people who think in pictures.'],
    ['Cost and risk', 'medium effort (three parameterised SVG generators). Detailed editing (components, recovery stages, JSON) moves below the fold.'],
    ['Phone', 'cards and table stack vertically; the picture scrolls sideways.'],
  ] },
  { id: 'B', name: 'B · Guided stepper', svg: optionB(), bullets: [
    ['Layout', 'a vertical stepper (topology, hardware, fault types, mechanisms, constraints and strategy, results) with one panel per step and a running KPI bar.'],
    ['Merges', 'Scenario, Training, Mechanisms and Allocation into one guided flow; the separate pages remain for experts.'],
    ['Best for', 'a fixed workflow, new users, demonstrations.'],
    ['Cost and risk', 'highest effort (new navigation model and per-step state). Experts have to click through steps to change one value.'],
    ['Phone', 'the steps become an accordion.'],
  ] },
  { id: 'C', name: 'C · Split workbench', svg: optionC(), bullets: [
    ['Layout', 'inputs on the left in collapsible groups (template, scale, hardware parameters, fault library, mechanisms, workload, recovery, JSON); outputs on the right as tabs (picture, hardware, reliability, allocation) under a KPI strip. The hardware tab shows 1k / 10k / 20k / 50k side by side with the current N highlighted.'],
    ['Merges', 'Scenario and Training; Allocation reachable as a tab.'],
    ['Best for', 'daily modelling work: every edit recomputes in place, nothing is more than one click away.'],
    ['Cost and risk', 'lowest effort (reuses today’s editors and Training cards). Dense; the picture is one tab among four.'],
    ['Phone', 'the panes stack; the tabs stay.'],
  ] },
];
const CSS = `
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --warn:#a8691b; --warn-soft:#f6ead6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --warn:#e0a85a; --warn-soft:#3a2e1d; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --warn:#e0a85a; --warn-soft:#3a2e1d; }
  * { box-sizing: border-box; } html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif; font-size: 13.5px; line-height: 1.55; }
  main { max-width: 1080px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 22px 26px 26px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 22px; font-weight: 600; margin: 4px 0 8px; line-height: 1.3; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 17px; font-weight: 600; margin: 4px 0 8px; }
  p, li, td, th, h1, h2 { overflow-wrap: anywhere; } .sub { color: var(--muted); font-size: 13px; }
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; } figure { margin: 10px 0 12px; } figure svg { display: block; width: 100%; height: auto; }
  dl { display: grid; grid-template-columns: 120px 1fr; gap: 4px 14px; margin: 6px 0 0; } dt { font-weight: 600; } dd { margin: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; } th, td { border-bottom: 1px solid var(--rule); padding: 5px 8px; text-align: left; vertical-align: top; } th { background: var(--surface-2); }
  .table-wrap { overflow-x: auto; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 8px 12px; border-radius: 0 6px 6px 0; margin: 10px 0; }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 12px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; }
  @media (max-width: 760px) { .page { padding: 16px 12px; } .scroll svg { min-width: 760px; } dl { grid-template-columns: 1fr; } dd { margin-bottom: 6px; } .table-wrap table { min-width: 640px; } }
`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Topology page options</title>
<meta name="description" content="Three frontend options for HAC-D's new first page (topology → hardware → fault types → default mechanisms → KPIs): picture-first canvas, guided stepper, split workbench; wireframes with real counts for the CloudMatrix384 geometry at 1k–50k NPUs.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<main>
<section class="page">
  <div class="eyebrow">HAC-D · design proposal · 2026-10-16</div>
  <h1>New first page: topology → hardware → fault types → mechanisms — three frontend options</h1>
  <p class="sub">Each wireframe shows the same state: CloudMatrix384 template at 10,000 NPUs with the six default mechanisms. Counts come from HAC-D's <code>computeCounts</code> (CloudMatrix384 preset, full-pod fill); KPIs from the 54-event reference catalog with the six default mechanisms; FIT per unit derived from the catalog under the CloudMatrix384 geometry. In every option the Training page is merged into this page and the Audit page disappears from the navigation (its audit moves to Mechanisms, its cross-scale study to Allocation). Plan: <code>docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md</code>.</p>
  <div class="table-wrap"><table>
    <tr><th></th><th>A · Picture-first canvas</th><th>B · Guided stepper</th><th>C · Split workbench</th></tr>
    <tr><td><b>Merges</b></td><td>Scenario + Training</td><td>Scenario + Training + Mechanisms + Allocation (guided)</td><td>Scenario + Training; Allocation as a tab</td></tr>
    <tr><td><b>Best for</b></td><td>presenting architectures</td><td>fixed workflow, newcomers</td><td>daily modelling</td></tr>
    <tr><td><b>Effort</b></td><td>medium</td><td>high</td><td>low</td></tr>
    <tr><td><b>Main risk</b></td><td>editing below the fold</td><td>experts click through steps</td><td>dense</td></tr>
  </table></div>
  <div class="callout"><b>Recommendation: C</b>, with the three topology cards of A as the template selector at the top of the input pane. It keeps every current editor, merges Training without losing anything, and its hardware tab shows the four standard scales side by side.</div>
</section>
${OPTS.map((o) => `<section class="page" id="option-${o.id.toLowerCase()}">
  <h2>${esc(o.name)}</h2>
  <figure><div class="scroll">${o.svg}</div></figure>
  <dl>${o.bullets.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
</section>`).join('\n')}
</main>
</body>
</html>
`;
writeFileSync('docs/design/TOPOLOGY_PAGE_OPTIONS.html', html);
console.log(`written docs/design/TOPOLOGY_PAGE_OPTIONS.html (${(html.length / 1024).toFixed(0)} kB)`);
