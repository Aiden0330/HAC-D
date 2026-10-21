/**
 * Shared drawing helpers and the Ascend 950 topology figures (inline SVG, light / dark tokens of the earlier reports' validated
 * palette) for docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html and docs/ASCEND950_SCALING_RELIABILITY.{zh,en}.html:
 *  - figScaleStrip: scale-up domain sizes of the Ascend generations and the 950-era designs on one log axis;
 *  - figNative: the native Atlas 950 SuperPoD (16 compute + 4 UB interconnect cabinets, one tier of optical UB switches) with a
 *    compute-cabinet zoom (8 NPU trays × 8, 8 CPU trays, backplane / LRS, uplinks);
 *  - figUbl128: SuperPoD Flex / UBL128 (2 compute cabinets, one layer of 4 UB switches in a cabinet shared by 4 pods) and the
 *    scale-out between SuperPoDs (planes × two-tier Clos).
 * Every count drawn comes from docs/ascend950-scaling/results.json (passed in as `R`).
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
export const svgOpen = (id, W, H, label) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
export function legend(x, y, items, maxX = 946) {
  let g = '', cx = x, cy = y;
  for (const it of items) {
    const w = 18 + tw(it.label, 9.8) + 16;
    if (cx + w > maxX) { cx = x; cy += 16; }
    const look = it.style ? `style="${it.style}"` : `class="${it.cls}"`;
    g += it.line ? `<line x1="${cx}" y1="${cy - 3}" x2="${cx + 12}" y2="${cy - 3}" ${look}/>` : `<rect x="${cx}" y="${cy - 8}" width="12" height="10" rx="2" ${look}/>`;
    g += `<text x="${cx + 17}" y="${cy + 1}" class="s">${esc(it.label)}</text>`;
    cx += w;
  }
  return { g, y: cy };
}
export function titleBlock(label, W = 960) { const ls = wrap(label, W - 30, 13 * 1.05); return { svg: lines(14, 22, ls, 'ttl', 17), dy: (ls.length - 1) * 17 }; }

/* ======================================================================================================================= */
/* Figure: scale-up domain sizes on one log axis                                                                             */
/* ======================================================================================================================= */
export function figScaleStrip(lang, id = 'fig-strip', num = 1) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const W = 960, H = 196;
  const x0 = 70, x1 = 914, lo = 3, hi = 14; // log2: 8 … 16,384
  const X = (v) => x0 + ((Math.log2(v) - lo) / (hi - lo)) * (x1 - x0);
  const yA = 112; // axis
  const head = titleBlock(T(`图 ${num}：scale-up 域（一个 UB / HCCS 域内的 NPU 数，对数轴）：从 8 卡服务器到万卡级超节点`, `Figure ${num}: scale-up domain size (NPUs in one UB / HCCS domain, log axis), from the 8-NPU server to 10k-class SuperPoDs`));
  let g = svgOpen(id, W, H, T('昇腾各代与 950 时代设计的 scale-up 域大小', 'Scale-up domain sizes of the Ascend generations and the 950-era designs')) + head.svg;
  g += `<line x1="${x0 - 8}" y1="${yA}" x2="${x1 + 8}" y2="${yA}" class="axis"/>`;
  for (const v of [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]) g += `<line x1="${X(v)}" y1="${yA - 3}" x2="${X(v)}" y2="${yA + 3}" class="axis"/><text x="${X(v)}" y="${yA + 15}" class="m" text-anchor="middle">${fmt(v)}</text>`;
  // kind: on = hardware shipped or shown; spec = specification / roadmap; ref = not Ascend
  const pts = [
    { v: 8, kind: 'on', row: -1, anchor: 'start', dx: -6, label: T('8 · A2 服务器（HCCS，跨机 RoCE）', '8 · A2 server (HCCS, RoCE across)') },
    { v: 64, kind: 'on', row: -2, anchor: 'end', dx: 6, label: T('64 · Atlas 950 单柜（产品页 64 卡配置）', '64 · one Atlas 950 cabinet (64-NPU option)') },
    { v: 72, kind: 'ref', row: 1, anchor: 'end', dx: 4, label: T('72 · NVL72（参照）', '72 · NVL72 (reference)') },
    { v: 96, kind: 'spec', row: 2, anchor: 'middle', dx: 0, label: T('≤ 96 · Atlas 850E 风冷（商用口径）', '≤ 96 · Atlas 850E air-cooled (commercial)') },
    { v: 128, kind: 'spec', row: -1, anchor: 'start', dx: -4, label: T('128 · SuperPoD Flex / UBL128', '128 · SuperPoD Flex / UBL128') },
    { v: 384, kind: 'on', row: 1, anchor: 'middle', dx: 6, label: T('384 · CloudMatrix384（A3）', '384 · CloudMatrix384 (A3)') },
    { v: 1024, kind: 'on', row: -2, anchor: 'middle', dx: 0, label: T('1,024 · Atlas 950 现行规格（WAIC 真机）', '1,024 · Atlas 950 current spec (shown at WAIC)') },
    { v: 4096, kind: 'spec', row: 1, anchor: 'middle', dx: 0, label: T('4,096 · Atlas 960E 规格（测试中）', '4,096 · Atlas 960E spec (in test)') },
    { v: 8192, kind: 'spec', row: -1, anchor: 'end', dx: 10, label: T('8,192 · Atlas 950 路线图上限', '8,192 · Atlas 950 roadmap maximum') },
    { v: 15488, kind: 'spec', row: 2, anchor: 'end', dx: 6, label: T('15,488 · Atlas 960（HC2025；HC2026 改为 4,096）', '15,488 · Atlas 960 (HC2025; 4,096 at HC2026)') },
  ];
  const rowY = { '-2': yA - 46, '-1': yA - 24, 1: yA + 36, 2: yA + 56 };
  for (const p of pts) {
    const x = X(p.v), ty = rowY[p.row];
    const ly0 = p.row < 0 ? yA - 6 : yA + 19, ly1 = p.row < 0 ? ty + 3 : ty - 10;
    g += `<line x1="${x}" y1="${ly0}" x2="${x}" y2="${ly1}" class="lead"/>`;
    g += `<text x="${x + p.dx}" y="${ty}" class="${p.kind === 'ref' ? 'm' : 's'} halo"${p.anchor !== 'start' ? ` text-anchor="${p.anchor}"` : ''}>${esc(p.label)}</text>`;
  }
  for (const p of pts) g += `<circle cx="${X(p.v)}" cy="${yA}" r="${p.kind === 'ref' ? 4 : 5}" class="dot-${p.kind}"/>`;
  const lg = legend(x0 - 8, H - 12, [
    { cls: 'dot-on', label: T('已交付或展出真机', 'shipped or shown as hardware') },
    { cls: 'dot-spec', label: T('规格 / 路线图（未见交付）', 'specification / roadmap (no delivery seen)') },
    { cls: 'dot-ref', label: T('参照（非昇腾）', 'reference (not Ascend)') },
  ]);
  // round markers in the legend
  g += lg.g.replace(/<rect x="([\d.]+)" y="([\d.]+)" width="12" height="10" rx="2" class="(dot-[a-z]+)"\/>/g, (_, x, y, c) => `<circle cx="${+x + 6}" cy="${+y + 5}" r="4.5" class="${c}"/>`);
  return g + '</svg>';
}

/* ======================================================================================================================= */
/* Figure: native Atlas 950 SuperPoD (1,024 NPUs) and a compute cabinet                                                       */
/* ======================================================================================================================= */
export function figNative(lang, R, id = 'fig-native', num = 2) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const m = R.archs.native.mapping.items;
  const W = 960, H = 466;
  const head = titleBlock(T(`图 ${num}：华为原生 Atlas 950 超节点（现行规格 1,024 NPU）：16 计算柜 + 4 灵衢互联柜，托盘内全互联、柜内背板，柜间一层光交换 Clos`, `Figure ${num}: Huawei native Atlas 950 SuperPoD (current spec, 1,024 NPUs): 16 compute + 4 UB interconnect cabinets, full mesh in each tray, a cabinet backplane, one tier of optical UB switches between cabinets`));
  let g = svgOpen(id, W, H + head.dy, T('Atlas 950 超节点拓扑', 'Atlas 950 SuperPoD topology')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
  /* ---- left panel: the SuperPoD ---- */
  const PL = { x: 14, y: 40, w: 520, h: 356 };
  g += `<rect x="${PL.x}" y="${PL.y}" width="${PL.w}" height="${PL.h}" rx="6" class="panel"/>`;
  g += `<text x="${PL.x + 12}" y="${PL.y + 18}" class="h">${esc(T(`超节点（一个 UB 域）：${fmt(m.npu.perPod)} NPU = ${fmt(m.computeRack.perPod)} 计算柜 × 64`, `SuperPoD (one UB domain): ${fmt(m.npu.perPod)} NPUs = ${fmt(m.computeRack.perPod)} compute cabinets × 64`))}</text>`;
  const cabW = 50, cabH = 56, cx0 = 46, cstep = 58;
  const topY = PL.y + 34, botY = PL.y + 238;
  const ucW = 104, ucH = 52, ux0 = 48, ustep = 116, uY = PL.y + 138;
  const cabinet = (x, y, i) => {
    let s = `<rect x="${x}" y="${y}" width="${cabW}" height="${cabH}" rx="3" class="cab"/>`;
    for (let r = 0; r < 8; r++) s += `<rect x="${x + 5}" y="${(y + 5 + r * 6.3).toFixed(1)}" width="${cabW - 10}" height="4" rx="1" class="tray"/>`;
    return s + `<text x="${x + cabW / 2}" y="${y + cabH + (y < uY ? -cabH - 3 : 11)}" class="tiny" text-anchor="middle">${i}</text>`;
  };
  // links first (under the boxes): every compute cabinet to every interconnect cabinet
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
    const ax = cx0 + i * cstep + cabW / 2, bx = ux0 + j * ustep + ucW / 2;
    g += `<line x1="${ax}" y1="${topY + cabH}" x2="${bx}" y2="${uY}" class="l-ub" opacity="0.55"/>`;
    g += `<line x1="${ax}" y1="${botY}" x2="${bx}" y2="${uY + ucH}" class="l-ub" opacity="0.55"/>`;
  }
  for (let i = 0; i < 8; i++) g += cabinet(cx0 + i * cstep, topY, i + 1) + cabinet(cx0 + i * cstep, botY, i + 9);
  for (let j = 0; j < 4; j++) {
    const x = ux0 + j * ustep;
    g += `<rect x="${x}" y="${uY}" width="${ucW}" height="${ucH}" rx="4" class="ub"/>`;
    g += `<text x="${x + 6}" y="${uY + 13}" class="tiny">${esc(T(`灵衢互联柜 ${j + 1}`, `UB cabinet ${j + 1}`))}</text>`;
    for (let k = 0; k < 4; k++) g += `<rect x="${x + 5 + k * 24.5}" y="${uY + 20}" width="20" height="24" rx="2" class="ubsolid"/><text x="${x + 15 + k * 24.5}" y="${uY + 35}" class="tiny" text-anchor="middle" style="fill:var(--surface)">SW</text>`;
  }
  // annotations
  const a1 = textBlock(PL.x + 12, PL.y + 316, T(`每柜 128 条 800G 光链路（每 NPU 2 条，LPO，2+2 光路保护）上联 ${fmt(m.podSwitch.perPod)} 台 UB 交换机（128 × 800G，一层 Clos）：每台交换机到每柜 8 条；每超节点 ${fmt(m.opticalLink.perPod)} 条链路、${fmt(m.transceiver.perPod)} 只光模块（含两端）。`, `Each cabinet: 128 × 800G optical links (2 per NPU, LPO, 2+2 optical-path protection) up to ${fmt(m.podSwitch.perPod)} UB switches (128 × 800G, one-tier Clos), 8 from every cabinet to every switch; ${fmt(m.opticalLink.perPod)} links and ${fmt(m.transceiver.perPod)} transceivers (both ends) per SuperPoD.`), PL.w - 24);
  g += a1.svg;
  g += `<rect x="${ux0 - 4}" y="${uY - 4}" width="${3 * ustep + ucW + 8}" height="${ucH + 8}" rx="6" class="asm"/>`;
  g += `<text x="${ux0 + 3 * ustep + ucW + 2}" y="${uY - 8}" class="tiny halo" text-anchor="end">${esc(T('交换机数与型号未公开：16 台为推算', 'switch count and model not public: 16 is derived'))}</text>`;
  /* ---- right panel: one compute cabinet ---- */
  const PR = { x: 548, y: 40, w: 398, h: 356 };
  g += `<rect x="${PR.x}" y="${PR.y}" width="${PR.w}" height="${PR.h}" rx="6" class="panel"/>`;
  const hr = textBlock(PR.x + 12, PR.y + 18, T('计算柜（产品页）：64 × 昇腾 950DT + 16 × 鲲鹏 950，约 100 kW，液冷，44OU', 'Compute cabinet (product page): 64 × Ascend 950DT + 16 × Kunpeng 950, ≈ 100 kW, liquid-cooled, 44 OU'), PR.w - 24, 'h', 11.5, 14);
  g += hr.svg;
  const C = { x: PR.x + 12, y: PR.y + 26 + hr.h, w: 196, h: 236 };
  g += `<rect x="${C.x}" y="${C.y}" width="${C.w}" height="${C.h}" rx="4" class="cab"/>`;
  const trayY = (r) => C.y + 24 + r * 25.5;
  g += `<text x="${C.x + 6}" y="${C.y + 14}" class="tiny">${esc(T('NPU 托盘 × 8（每托盘 8 NPU）', 'NPU trays × 8 (8 NPUs each)'))}</text>`;
  g += `<text x="${C.x + 134}" y="${C.y + 14}" class="tiny">${esc(T('CPU 托盘 × 8', 'CPU trays × 8'))}</text>`;
  for (let r = 0; r < 8; r++) {
    const y = trayY(r);
    g += `<rect x="${C.x + 6}" y="${y}" width="${118}" height="19" rx="2" class="tray"/>`;
    for (let k = 0; k < 8; k++) g += `<rect x="${C.x + 10 + k * 14}" y="${y + 4}" width="10" height="11" rx="1.5" class="npu" style="fill:var(--surface)"/>`;
    g += `<rect x="${C.x + 132}" y="${y}" width="${40}" height="19" rx="2" class="cpu"/>`;
    for (let k = 0; k < 2; k++) g += `<rect x="${C.x + 137 + k * 17}" y="${y + 4}" width="13" height="11" rx="1.5" class="cpu" style="fill:var(--surface)"/>`;
  }
  // tray mesh hint on the first tray: arcs between NPUs
  { const y = trayY(0) + 4; for (let k = 0; k < 7; k++) g += `<path d="M ${C.x + 15 + k * 14} ${y} q 7 -6 14 0" class="l-npu"/>`; }
  // backplane / LRS strip
  g += `<rect x="${C.x + 178}" y="${C.y + 20}" width="12" height="${C.h - 28}" rx="2" class="unk"/>`;
  g += `<text transform="translate(${C.x + 187.5} ${C.y + C.h / 2 + 4}) rotate(-90)" class="tiny" text-anchor="middle">${esc(T('正交背板 / LRS', 'orthogonal backplane / LRS'))}</text>`;
  // uplink arrows
  const ax = C.x + C.w + 10;
  g += `<path d="M ${C.x + 60} ${C.y} v -6" class="l-ubb"/><path d="M ${C.x + 56} ${C.y - 3} l 4 -5 l 4 5" class="l-ubb"/>`;
  const notes = [
    { cls: 'npu', text: T('托盘内 8 卡全互联（每托盘 28 条电链路，推算）', 'full mesh in each tray (28 electrical links per tray, derived)') },
    { cls: 'unk', text: T(`柜内第二维未定：直连 2D Mesh + ${fmt(m.lrs.perRack)} 片 LRS（UB-Mesh 参考设计，HAC-D 采用）或背板 Clos（LightCounting）`, `second in-cabinet dimension undecided: direct 2D mesh + ${fmt(m.lrs.perRack)} LRS (UB-Mesh reference, used by HAC-D) or a backplane Clos (LightCounting)`) },
    { cls: 'ub', text: T('上联：每 NPU 2 × 800G LPO，每柜 128 只（LightCounting 计数）', 'uplinks: 2 × 800G LPO per NPU, 128 per cabinet (LightCounting’s count)') },
    { cls: 'so', text: T(`scale-out：芯片 2 × 400G UBoE；产品用法未公开（图 ${num + 1}）`, `scale-out: 2 × 400G UBoE on the chip; product use not public (Figure ${num + 1})`) },
    { cls: 'cpu', text: T('UB 1.68 TB/s / NPU（双向）= 15 个 x4 口（推算）；跨柜 RTT 3 µs', 'UB 1.68 TB/s per NPU (bidirectional) = 15 x4 ports (derived); 3 µs cross-cabinet RTT') },
  ];
  let ny = C.y + 4;
  for (const n of notes) {
    const b = textBlock(ax + 16, ny + 9, n.text, PR.x + PR.w - ax - 26);
    g += `<rect x="${ax}" y="${ny}" width="10" height="10" rx="2" class="${n.cls}"/>` + b.svg;
    ny += b.h + 8;
  }
  // zoom from cabinet 8 (top row, right end) to the right panel
  const z = cx0 + 7 * cstep;
  g += `<path d="M ${z + cabW} ${topY} L ${C.x} ${C.y}" class="zoom"/><path d="M ${z + cabW} ${topY + cabH} L ${C.x} ${C.y + C.h}" class="zoom"/>`;
  const cnote = textBlock(PR.x + 12, Math.max(C.y + C.h, ny) + 14, T(`每柜：${fmt(m.npu.perRack)} NPU · ${fmt(m.cpu.perRack)} CPU · ${fmt(m.node.perRack)} 节点 · ${fmt(m.lrs.perRack)} LRS · ${fmt(m.meshLink.perRack)} 条柜内电链路 · ${fmt(m.opticalLink.perRack)} 条光链路`, `Per cabinet: ${fmt(m.npu.perRack)} NPUs · ${fmt(m.cpu.perRack)} CPUs · ${fmt(m.node.perRack)} nodes · ${fmt(m.lrs.perRack)} LRS · ${fmt(m.meshLink.perRack)} in-cabinet links · ${fmt(m.opticalLink.perRack)} optical links`), PR.w - 24, 'sb');
  g += cnote.svg;
  /* ---- legend and sources ---- */
  const lg = legend(PL.x, PL.y + PL.h + 16, [
    { cls: 'tray', label: T('NPU / NPU 托盘', 'NPU / NPU tray') }, { cls: 'cpu', label: T('CPU 托盘', 'CPU tray') }, { cls: 'ubsolid', label: T('UB 交换', 'UB switch') },
    { cls: 'l-ub', label: T('UB 800G 光链路', 'UB 800G optical link'), line: true }, { cls: 'so', label: 'scale-out' }, { cls: 'asm', label: T('推算 / 未定（虚线框）', 'derived / undecided (dashed)') },
  ]);
  g += lg.g;
  const src = textBlock(PL.x, lg.y + 17, T('来源：规格 = 昇腾产品页（2026-10-19 读取，华为确认）；托盘与每柜 128 × 800G = LightCounting 2026-07-21（分析师）；72 LRS = UB-Mesh 论文（华为论文）；16 台交换机 = Hot Chips 8K 示例按卡数缩放（推算）。8,192 卡路线图 = 8 × 本图（128 + 32 柜，HC2025），截至 2026-10-19 未见交付。', 'Sources: specification = Ascend product page (read 2026-10-19, Huawei-confirmed); trays and 128 × 800G per cabinet = LightCounting 2026-07-21 (analyst); 72 LRS = UB-Mesh paper (Huawei paper); 16 switches = Hot Chips 8K example scaled by NPUs (derived). The 8,192-NPU roadmap = 8 × this picture (128 + 32 cabinets, HC2025), no delivery seen by 2026-10-19.'), W - 30, 'm');
  g += src.svg;
  return g + '</g></svg>';
}

/* ======================================================================================================================= */
/* Figure: SuperPoD Flex / UBL128 and the scale-out between SuperPoDs                                                         */
/* ======================================================================================================================= */
export function figUbl128(lang, R, id = 'fig-ubl128', num = 3) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const m = R.archs.ubl128.mapping.items;
  const s500n = R.archs.native.sizes['500000'], s500u = R.archs.ubl128.sizes['500000'];
  const so = R.scaleOut.main.so;
  const so500 = R.sensitivity.scaleOut.main.sizes['500000'];
  const W = 960, H = 470;
  const head = titleBlock(T(`图 ${num}：SuperPoD Flex / UBL128（128 NPU，单层 UB 交换）与超节点之间的 scale-out（主算例：4 平面 × 两层 Clos）`, `Figure ${num}: SuperPoD Flex / UBL128 (128 NPUs, single-layer UB switching) and the scale-out between SuperPoDs (main case: 4 planes × two-tier Clos)`));
  let g = svgOpen(id, W, H + head.dy, T('UBL128 超节点与 scale-out', 'UBL128 SuperPoD and scale-out')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
  /* ---- left: UBL128 ---- */
  const PL = { x: 14, y: 40, w: 392, h: 356 };
  g += `<rect x="${PL.x}" y="${PL.y}" width="${PL.w}" height="${PL.h}" rx="6" class="panel"/>`;
  g += `<text x="${PL.x + 12}" y="${PL.y + 18}" class="h">${esc(T('UBL128 超节点：128 NPU = 2 计算柜 × 64（假设）', 'UBL128 SuperPoD: 128 NPUs = 2 cabinets × 64 (assumed)'))}</text>`;
  // shared switch cabinet with 4 pods' switch groups
  const S = { x: PL.x + 28, y: PL.y + 34, w: 336, h: 62 };
  g += `<rect x="${S.x}" y="${S.y}" width="${S.w}" height="${S.h}" rx="4" class="ub"/>`;
  g += `<text x="${S.x + 6}" y="${S.y + 13}" class="tiny">${esc(T('交换柜：4 个超节点共用（附件估算，假设）', 'switch cabinet shared by 4 SuperPoDs (attachment estimate, assumed)'))}</text>`;
  const swX = (grp, k) => S.x + 12 + grp * 82 + k * 17;
  for (let grp = 0; grp < 4; grp++) {
    for (let k = 0; k < 4; k++) g += `<rect x="${swX(grp, k)}" y="${S.y + 22}" width="13" height="30" rx="2" class="${grp === 0 ? 'ubsolid' : 'ub'}"${grp === 0 ? '' : ' opacity="0.55"'}/>`;
    g += `<text x="${swX(grp, 0) + 32}" y="${S.y + S.h - 2}" class="tiny" text-anchor="middle">${esc(grp === 0 ? T('本超节点', 'this pod') : T(`超节点 ${grp + 1}`, `pod ${grp + 1}`))}</text>`;
  }
  g += `<rect x="${S.x - 4}" y="${S.y - 4}" width="${S.w + 8}" height="${S.h + 8}" rx="6" class="asm"/>`;
  // two compute cabinets
  const cab = (x, y) => {
    let s = `<rect x="${x}" y="${y}" width="128" height="140" rx="4" class="cab"/>`;
    for (let r = 0; r < 8; r++) {
      const ty = y + 9 + r * 16.2;
      s += `<rect x="${x + 6}" y="${ty}" width="116" height="13" rx="2" class="tray"/>`;
      for (let k = 0; k < 8; k++) s += `<rect x="${x + 10 + k * 13.8}" y="${ty + 2.5}" width="9.5" height="8" rx="1.2" class="npu" style="fill:var(--surface)"/>`;
    }
    return s;
  };
  const cy = PL.y + 150, c1x = PL.x + 40, c2x = PL.x + 222;
  // bundles: each cabinet to each of the 4 switches of this pod (64 × 800G each)
  for (const cx of [c1x, c2x]) for (let k = 0; k < 4; k++) g += `<line x1="${cx + 34 + k * 20}" y1="${cy}" x2="${swX(0, k) + 6.5}" y2="${S.y + 52}" class="l-ubb" opacity="0.7"/>`;
  g += cab(c1x, cy) + cab(c2x, cy);
  g += `<text x="${c1x + 64}" y="${cy + 152}" class="tiny" text-anchor="middle">${esc(T('计算柜 1', 'cabinet 1'))}</text><text x="${c2x + 64}" y="${cy + 152}" class="tiny" text-anchor="middle">${esc(T('计算柜 2', 'cabinet 2'))}</text>`;
  g += `<text x="${(c1x + c2x) / 2 + 64}" y="${cy - 34}" class="tiny halo" text-anchor="middle">${esc(T('每柜到每台交换机 64 × 800G', '64 × 800G from each cabinet to each switch'))}</text>`;
  const ln = textBlock(PL.x + 12, cy + 168, T(`每 NPU 4 × 800G = 3.2 Tb/s，接 4 台 128 口交换机（每台连全部 128 卡，一跳）；每超节点 ${fmt(m.podSwitch.perPod)} 台交换机、${fmt(m.opticalLink.perPod)} 条光链路；托盘内全互联、无柜内 LRS（假设）。`, `4 × 800G = 3.2 Tb/s per NPU into 4 switches of 128 ports (each reaches all 128 NPUs, one hop); ${fmt(m.podSwitch.perPod)} switches and ${fmt(m.opticalLink.perPod)} optical links per pod; tray mesh, no in-cabinet LRS (assumed).`), PL.w - 24);
  g += ln.svg;
  /* ---- right: scale-out planes ---- */
  const PR = { x: 420, y: 40, w: 526, h: 356 };
  g += `<rect x="${PR.x}" y="${PR.y}" width="${PR.w}" height="${PR.h}" rx="6" class="panel"/>`;
  g += `<text x="${PR.x + 12}" y="${PR.y + 18}" class="h">${esc(T(`超节点之间：${so.planes} 平面 × 两层 Clos（radix ${fmt(so.radix)}，主算例）`, `Between SuperPoDs: ${so.planes} planes × two-tier Clos (radix ${fmt(so.radix)}, main case)`))}</text>`;
  const bandX = PR.x + 64, leafN = 8, spineN = 4, bandW = 300;
  const leafX = (l) => bandX + 6 + l * (bandW / leafN), spineX = (s) => bandX + 30 + s * (bandW / spineN);
  const pods = 5, podY = PR.y + 300, podX = (i) => bandX + 4 + i * 62;
  for (let p = 0; p < so.planes; p++) {
    const y = PR.y + 34 + p * 62;
    g += `<rect x="${bandX - 6}" y="${y}" width="${bandW + 12}" height="54" rx="4" class="panel" style="fill:var(--b2);opacity:0.35"/>`;
    g += `<text x="${PR.x + 12}" y="${y + 31}" class="s">${esc(T(`平面 ${p + 1}`, `plane ${p + 1}`))}</text>`;
    for (let l = 0; l < leafN; l++) for (let s = 0; s < spineN; s++) g += `<line x1="${leafX(l) + 14}" y1="${y + 34}" x2="${spineX(s) + 14}" y2="${y + 16}" class="l-so" opacity="0.45"/>`;
    for (let s = 0; s < spineN; s++) g += `<rect x="${spineX(s)}" y="${y + 5}" width="28" height="11" rx="2" class="so"/><text x="${spineX(s) + 14}" y="${y + 13.5}" class="tiny" text-anchor="middle">S</text>`;
    for (let l = 0; l < leafN; l++) g += `<rect x="${leafX(l)}" y="${y + 34}" width="28" height="11" rx="2" class="so"/><text x="${leafX(l) + 14}" y="${y + 42.5}" class="tiny" text-anchor="middle">L</text>`;
  }
  // every pod reaches one leaf in every plane
  for (let i = 0; i < pods; i++) {
    const x = podX(i) + 26;
    g += `<line x1="${x}" y1="${podY}" x2="${x}" y2="${PR.y + 34 + 45}" class="l-so" opacity="0.8"/>`;
    for (let p = 0; p < so.planes; p++) g += `<circle cx="${x}" cy="${PR.y + 34 + p * 62 + 45}" r="2.2" style="fill:var(--s2)"/>`;
  }
  for (let i = 0; i < pods; i++) g += `<rect x="${podX(i)}" y="${podY}" width="52" height="22" rx="4" class="ub"/><text x="${podX(i) + 26}" y="${podY + 15}" class="tiny" text-anchor="middle">${esc(i === pods - 2 ? '…' : i === pods - 1 ? T('超节点 N', 'pod N') : T(`超节点 ${i + 1}`, `pod ${i + 1}`))}</text>`;
  g += `<text x="${bandX + 150}" y="${podY + 38}" class="tiny" text-anchor="middle">${esc(T(`50 万卡：原生 ${fmt(s500n.counts.supernodes)} 个、UBL128 ${fmt(s500u.counts.supernodes)} 个超节点`, `500k NPUs: ${fmt(s500n.counts.supernodes)} native or ${fmt(s500u.counts.supernodes)} UBL128 pods`))}</text>`;
  const rx = bandX + bandW + 20;
  const rnotes = [
    T(`每 NPU ${so.portsPerNpu} × 200G（芯片 2 × 400G UBoE 拆分，白皮书允许），每平面 1 口`, `${so.portsPerNpu} × 200G per NPU (the chip’s 2 × 400G UBoE split, allowed by the white paper), one port per plane`),
    T(`叶：${fmt(so.radix / 2)} 下 + ${fmt(so.radix / 2)} 上；每平面最多 ${fmt(so.radix)}² ÷ 2 = ${fmt((so.radix * so.radix) / 2)} 个端点`, `leaf: ${fmt(so.radix / 2)} down + ${fmt(so.radix / 2)} up; at most ${fmt(so.radix)}² ÷ 2 = ${fmt((so.radix * so.radix) / 2)} endpoints per plane`),
    T(`50 万卡：每平面 ${fmt(so500.perTier[0] / so.planes)} 叶 + ${fmt(so500.perTier[1] / so.planes)} 脊，共 ${fmt(so500.switches)} 台、${fmt(so500.links)} 条链路`, `500k NPUs: ${fmt(so500.perTier[0] / so.planes)} leaves + ${fmt(so500.perTier[1] / so.planes)} spines per plane, ${fmt(so500.switches)} switches, ${fmt(so500.links)} links`),
    T('950 SuperCluster 的平面数、层数、交换机型号未公开；两层四平面出自 HC2026 对昇腾 960 的陈述，UBL128 自称 256K 卡两层', 'planes, tiers and switch model of the 950 SuperCluster are not public; two tiers × four planes is HC2026’s statement for Ascend 960; UBL128 states two tiers to 256K NPUs'),
  ];
  let ry = PR.y + 40;
  for (const [i, t] of rnotes.entries()) {
    const b = textBlock(rx, ry, t, PR.x + PR.w - rx - 10, i === 3 ? 'm' : 's');
    if (i === 3) g += `<rect x="${rx - 6}" y="${ry - 12}" width="${PR.x + PR.w - rx}" height="${b.h + 6}" rx="4" class="asm"/>`;
    g += b.svg;
    ry += b.h + 9;
  }
  /* ---- legend and sources ---- */
  const lg = legend(PL.x, PL.y + PL.h + 16, [
    { cls: 'tray', label: T('NPU 托盘（8 NPU）', 'NPU tray (8 NPUs)') }, { cls: 'ubsolid', label: T('UB 交换', 'UB switch') }, { cls: 'l-ubb', label: T('UB 800G 光链路束', 'UB 800G link bundle'), line: true },
    { cls: 'so', label: T('scale-out 叶 L / 脊 S', 'scale-out leaf L / spine S') }, { cls: 'asm', label: T('假设 / 未公开（虚线框）', 'assumed / not public (dashed)') },
  ]);
  g += lg.g;
  const src = textBlock(PL.x, lg.y + 17, T('来源：UBL128 = 华为计算官微 2026-09-30（经量子位授权转载，华为确认）：华为与 DeepSeek 联合定义 SuperPoD Flex 与 UBL128 组网方案，128 卡 3.2 Tbps 单层交换 scale-up、256K 卡两层交换 scale-out；机柜、交换机数与链路介质为本页假设。scale-out：UBoE / RoCE 都支持（HC2025）；radix 1,024 = 星河 UBG（HC2026）。', 'Sources: UBL128 = Huawei Computing WeChat, 2026-09-30 (republished by QbitAI with permission; Huawei-confirmed): SuperPoD Flex and the UBL128 networking scheme defined jointly by Huawei and DeepSeek, 128 NPUs on a 3.2 Tbps single-layer switch, two-tier scale-out to 256K NPUs; cabinets, switch count and link media are this page’s assumptions. Scale-out: UBoE or RoCE (HC2025); radix 1,024 = Xinghe UBG (HC2026).'), W - 30, 'm');
  g += src.svg;
  return g + '</g></svg>';
}
