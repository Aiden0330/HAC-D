/**
 * v6.3 the topology schematic as one pure drawing function, shared by the web app's Picture tab (apps/web TopologyPicture) and the
 * reports (Findings Figure 1, BOM Figure 1): the scale-out (RoCE / RDMA / UBoE) Clos tiers on top, the cabinets (A2) or one SuperPoD
 * with the others stacked behind it (A3, Atlas 950, Atlas 960E, generic UB) in the middle, one node enlarged on the right. The UB
 * fabric of a SuperPoD is drawn by kind (two-level L1/L2, cabinet mesh + optical Clos, UB-Mesh 4D, LinkBlade + LinkDevice with NPO).
 * Counts in the labels are the engine's (`computeCounts` of @hac-d/core); the drawing shows at most a handful of each unit with an
 * ellipsis and the total. Ported from the v4 React component (apps/web/src/components/TopologyPicture.tsx, retired in v6.3).
 *
 * Inputs: `geom` = the topology (a scenario's `topology` block or a record with its superpod resolved: `template`, `superpod`,
 * `scaleOut`), `counts` = the Counts at the drawn size, `lang`. No file access, no clock. The web passes `embedStyle: false` and
 * styles the `tp-*` classes with its own tokens (app.css); the reports embed TOPO_STYLE on the validated figure palette.
 */
import { esc, STYLE } from './svg-base.mjs';

export const SCHEMATIC_WIDTH = 760;
const fmt = (n) => Number(n).toLocaleString('en-US');

/** the schematic's own classes on the figure palette of the reports (svg.viz tokens: --s1 NPU, --s2 scale-out, --s3 UB) */
export const TOPO_STYLE = `
svg.viz.topo text { fill: var(--ink2); font-size: 11px; } svg.viz.topo text.tp-h { font-size: 12px; font-weight: 600; fill: var(--ink); } svg.viz.topo text.tp-num { font-variant-numeric: tabular-nums; }
svg.viz.topo text.roce-t, svg.viz.topo text.rdma-t { fill: var(--s2); } svg.viz.topo text.ub-t { fill: var(--s3); }
svg.viz.topo .tp-roce { fill: var(--b2); stroke: var(--s2); stroke-width: 1; } svg.viz.topo .tp-ub { fill: var(--b3); stroke: var(--s3); stroke-width: 1; } svg.viz.topo .tp-npu { fill: var(--b1); stroke: var(--s1); stroke-width: 1; }
svg.viz.topo .tp-cpu { fill: var(--b5); stroke: var(--axis); } svg.viz.topo .tp-cab { fill: var(--mid); stroke: var(--axis); } svg.viz.topo .tp-server { fill: var(--b1); stroke: var(--grid); } svg.viz.topo .tp-node { fill: var(--surface); stroke: var(--axis); }
svg.viz.topo .tp-pod { fill: var(--surface); stroke: var(--s3); stroke-width: 1.2; } svg.viz.topo .tp-pod-back { opacity: 0.45; } svg.viz.topo .tp-comm { fill: var(--b3); stroke: var(--s3); }
svg.viz.topo .tp-wire-roce { stroke: var(--s2); stroke-width: 1; opacity: 0.6; fill: none; } svg.viz.topo .tp-wire-ub { stroke: var(--s3); stroke-width: 0.8; opacity: 0.55; } svg.viz.topo .tp-wire-hccs { stroke: var(--s1); stroke-width: 0.6; opacity: 0.55; }
`;

const r1 = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const txt = (x, y, s, cls = 'tp-s', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;
const rect = (x, y, w, h, rx, cls) => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${rx}" class="${cls}"/>`;
const line = (x1, y1, x2, y2, cls) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}"/>`;

/** row of `shown` boxes standing for `total` units, with an ellipsis when total > shown */
function row(x, y, w, h, total, shown, cls, gap = 4) {
  const n = Math.min(total, shown);
  let g = '';
  for (let i = 0; i < n; i++) g += rect(x + i * (w + gap), y, w, h, 2, cls);
  if (total > shown) g += txt(x + n * (w + gap) + 2, y + h / 2 + 4, '…');
  return g;
}

function closTiers(counts, lang, x0, y0, width, label) {
  const tiers = counts.scaleOutPerTier;
  if (!tiers.length) return { svg: '', bottom: y0 };
  const zh = lang === 'zh';
  const names = tiers.length === 1 ? [zh ? '交换机' : 'switch'] : tiers.map((_, i) => (i === 0 ? (zh ? '叶' : 'leaf') : i === tiers.length - 1 ? (tiers.length === 2 ? (zh ? '脊' : 'spine') : zh ? '核心' : 'core') : zh ? '汇聚' : 'agg.'));
  const rowH = 22;
  let g = txt(x0, y0 + 10, label, 'tp-h roce-t');
  const top = y0 + 18;
  tiers.slice().reverse().forEach((n, k) => {
    const i = tiers.length - 1 - k;
    const y = top + k * rowH;
    g += txt(x0, y + 12, names[i]);
    g += row(x0 + 46, y + 2, 22, 12, n, Math.max(4, Math.floor((width - 170) / 26)), 'tp-roce');
    g += txt(x0 + width, y + 12, fmt(n), 'tp-s tp-num', 'end');
    // a few crossing links between this tier and the one above (schematic of the folded Clos)
    if (k > 0) for (let j = 0; j < 6; j++) for (const d of [0, 1]) g += line(x0 + 57 + j * 26, y + 2, x0 + 57 + ((j + d * 3) % 6) * 26, y - 8, 'tp-wire-roce');
  });
  return { svg: g, bottom: top + tiers.length * rowH };
}

function nodeDetail({ x, y, npus, cpus, l1, ports, lang, ub, fabric = 'two-level', rackSwitches = 0 }) {
  const zh = lang === 'zh';
  const w = 196;
  let g = rect(x, y, w, ub ? (fabric === 'two-level' ? 150 : 162) : 132, 8, 'tp-node');
  g += txt(x + 10, y + 16, zh ? `一个节点：${npus} NPU + ${cpus} CPU` : `one node: ${npus} NPUs + ${cpus} CPUs`, 'tp-h');
  // NPU ring with the scale-up links (HCCS mesh in A2, UB via the L1 chips in A3 / 950)
  const cx = x + 56, cy = y + 74, r = 32;
  const pts = Array.from({ length: npus }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / npus - Math.PI / 2), cy + r * Math.sin((2 * Math.PI * i) / npus - Math.PI / 2)]);
  const mesh = ub && (fabric === 'mesh-clos' || fabric === 'mesh-4d');
  if (!ub || mesh) for (let i = 0; i < npus; i++) for (let j = i + 1; j < npus; j++) g += line(pts[i][0], pts[i][1], pts[j][0], pts[j][1], mesh ? 'tp-wire-ub' : 'tp-wire-hccs');
  for (const [px, py] of pts) g += rect(px - 7, py - 7, 14, 14, 2, 'tp-npu');
  const nl = !ub ? (zh ? 'NPU（HCCS 全互连）' : 'NPUs (HCCS mesh)') : mesh ? (zh ? 'NPU（UB 全互联）' : 'NPUs (UB mesh)') : fabric === 'blade-clos' ? (zh ? 'NPU（经 LinkBlade）' : 'NPUs (LinkBlade)') : zh ? 'NPU（UB 经 L1）' : 'NPUs (UB via L1)';
  g += txt(cx, y + 124, nl, 'tp-s', 'middle');
  // at most four CPUs drawn (a user CPU count can be large); the label keeps the true number
  const drawn = Math.max(0, Math.min(cpus, 4));
  for (let i = 0; i < drawn; i++) g += rect(x + 112 + (i % 2) * 38, y + 32 + Math.floor(i / 2) * 20, 32, 14, 2, 'tp-cpu');
  g += txt(x + 112, y + 32 + Math.ceil(drawn / 2) * 20 + 8, cpus > drawn ? `… ${zh ? '鲲鹏 CPU' : 'Kunpeng CPUs'}` : zh ? '鲲鹏 CPU' : 'Kunpeng CPUs');
  if (ub && fabric !== 'two-level') {
    // per cabinet, not per node: the LRS of the cabinet mesh or the LinkBlade chips
    for (let i = 0; i < Math.min(rackSwitches, 7); i++) g += rect(x + 112 + i * 11, y + 94, 9, 14, 1, 'tp-ub');
    g += txt(x + 112, y + 122, fabric === 'blade-clos' ? `${rackSwitches} LinkBlade` : `${rackSwitches} LRS`);
    g += txt(x + 112, y + 135, zh ? '每柜' : 'per cabinet');
    g += txt(x + 10, y + 154, zh ? `${ports} 个 UBoE / RDMA 口` : `${ports} UBoE / RDMA ports (scale-out)`, 'tp-s rdma-t');
  } else if (ub) {
    for (let i = 0; i < Math.min(l1, 7); i++) g += rect(x + 112 + i * 11, y + 94, 9, 14, 1, 'tp-ub');
    g += txt(x + 112, y + 122, zh ? `${l1} 片 L1 UB 芯片` : `${l1} L1 UB chips`);
    g += txt(x + 10, y + 142, zh ? `${ports} 个 RDMA 口（scale-out）` : `${ports} RDMA ports (scale-out)`, 'tp-s rdma-t');
  } else {
    // at most eight ports drawn inside the box; the label keeps the true number
    for (let i = 0; i < Math.min(ports, 8); i++) g += rect(x + 112 + i * 10, y + 96, 8, 10, 1, 'tp-roce');
    g += txt(x + 112, y + 120, `${ports} × 200GE RoCE`, 'tp-s roce-t');
  }
  return g;
}

/**
 * The schematic as an SVG string with its width and height (viewBox units).
 * `geom`: { template?, superpod?, scaleOut? } — a scenario's topology, or a topology record with `superpod` resolved
 * (@hac-d/core recordSuperpod); `counts`: the Counts at the drawn size; `lang`: 'zh' | 'en'.
 * `opts.embedStyle` (default true): the reports' `svg.viz topo` figure with the palette and TOPO_STYLE embedded and a surface
 * background; false: a bare `svg.topo-pic` for the web app, styled by its stylesheet. `opts.id` names the figure element.
 */
export function topologySchematicSvg(geom, counts, lang, opts = {}) {
  const { embedStyle = true, id = 'fig-topology' } = opts;
  const W = SCHEMATIC_WIDTH;
  const t = geom ?? {};
  const sp = t.superpod ?? null;
  const zh = lang === 'zh';
  if (!counts || !Array.isArray(counts.scaleOutPerTier)) throw new Error('topologySchematicSvg: counts (computeCounts) with scaleOutPerTier are required');
  let g = '';
  let y = 8;
  const ubFamily = t.template === 'a950-ub2' || t.template === 'a960e-ub' || t.template === 'ub-generic';
  // the plane count of the scale-out design is part of the drawn geometry for every family (a record may state several planes on the A3 / A2 templates too)
  const planes = t.scaleOut?.planes ?? 1;
  const planeTxt = planes > 1 ? (zh ? ` × ${planes} 平面` : ` × ${planes} planes`) : '';
  const soLabel = ubFamily
    ? (zh ? `UBoE / RoCE scale-out 网络 · ${counts.scaleOutTiers} 层 Clos${planeTxt} · ${fmt(counts.scaleOutPorts)} 口 · ${fmt(counts.scaleOutLinks)} 条链路` : `UBoE / RoCE scale-out network · ${counts.scaleOutTiers}-tier Clos${planeTxt} · ${fmt(counts.scaleOutPorts)} ports · ${fmt(counts.scaleOutLinks)} links`)
    : sp
      ? (zh ? `RDMA scale-out 网络 · ${counts.scaleOutTiers} 层 Clos${planeTxt} · ${fmt(counts.scaleOutPorts)} 口 · ${fmt(counts.scaleOutLinks)} 条链路` : `RDMA scale-out network · ${counts.scaleOutTiers}-tier Clos${planeTxt} · ${fmt(counts.scaleOutPorts)} ports · ${fmt(counts.scaleOutLinks)} links`)
      : zh ? `RoCE 参数面 · ${counts.scaleOutTiers} 层 Clos${planeTxt} · ${fmt(counts.scaleOutPorts)} 口 · ${fmt(counts.scaleOutLinks)} 条链路` : `RoCE parameter plane · ${counts.scaleOutTiers}-tier Clos${planeTxt} · ${fmt(counts.scaleOutPorts)} ports · ${fmt(counts.scaleOutLinks)} links`;
  if (t.scaleOut) {
    const c = closTiers(counts, lang, 16, y, 520, soLabel);
    g += c.svg;
    y = c.bottom + 10;
  }
  const detailX = W - 206;
  if (!sp) {
    // A2: cabinets of servers under the leaf tier
    const cabTotal = counts.racks;
    const shown = Math.min(cabTotal, 6);
    const npc = counts.nodesPerRack;
    g += txt(16, y + 10, zh ? `计算机柜 × ${fmt(cabTotal)}（每柜 ${npc} 台服务器 · ${npc * counts.gpusPerNode} NPU）` : `compute cabinets × ${fmt(cabTotal)} (${npc} servers · ${npc * counts.gpusPerNode} NPUs each)`, 'tp-h');
    const cy = y + 18;
    for (let i = 0; i < shown; i++) {
      const cx = 16 + i * 84;
      g += rect(cx, cy, 74, 150, 4, 'tp-cab');
      const k0 = Math.min(npc, 12);
      for (let k = 0; k < k0; k++) g += rect(cx + 6, cy + 8 + k * (134 / k0), 62, Math.max(6, 134 / k0 - 4), 2, 'tp-server');
      if (t.scaleOut) for (const d of [0, 1]) g += line(cx + 25 + d * 24, cy, 73 + ((i * 2 + d) % 14) * 26, y - 14, 'tp-wire-roce');
    }
    if (cabTotal > shown) g += txt(16 + shown * 84 + 4, cy + 80, '…');
    g += nodeDetail({ x: detailX, y: cy - 4, npus: counts.gpusPerNode, cpus: Math.round(counts.cpus / Math.max(1, counts.nodes)), l1: 0, ports: (t.scaleOut?.portsPerNpu ?? 1) * counts.gpusPerNode, lang, ub: false });
    y = cy + 170;
    g += txt(16, y, zh ? `${fmt(counts.gpus)} NPU · ${fmt(counts.nodes)} 台服务器 · ${fmt(counts.cpus)} CPU · ${fmt(counts.racks)} 柜 · ${fmt(counts.scaleOutSwitches)} 台 RoCE 交换机 · ${fmt(counts.scaleOutTransceivers)} 个光模块` : `${fmt(counts.gpus)} NPUs · ${fmt(counts.nodes)} servers · ${fmt(counts.cpus)} CPUs · ${fmt(counts.racks)} cabinets · ${fmt(counts.scaleOutSwitches)} RoCE switches · ${fmt(counts.scaleOutTransceivers)} transceivers`);
    y += 14;
  } else {
    // A3 / Atlas 950 / 960E: one SuperPoD drawn, the others stacked behind it; every position is computed so the box fits its content
    const podNpus = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
    const pods = counts.supernodes;
    const stack = Math.max(0, Math.min(2, pods - 1));
    const two = sp.fabric === 'two-level';
    const commZh = two ? '通信柜' : '灵衢互联柜', commEn = two ? 'comm. cabinets' : 'UB interconnect cabinets';
    // per full SuperPoD (the build's rule: ⌈pod NPUs × uplinks per NPU / radix⌉); the last pod of N may be partial
    const podSw = Math.ceil((podNpus * sp.podUplinksPerNpu) / Math.max(1, sp.podSwitchRadix));
    g += txt(16, y + 10, zh ? `超节点 × ${fmt(pods)}（每个 ${fmt(podNpus)} NPU · ${sp.computeRacks} 计算柜 + ${sp.commRacks} ${commZh}）` : `SuperPoDs × ${fmt(pods)} (${fmt(podNpus)} NPUs · ${sp.computeRacks} compute + ${sp.commRacks} ${commEn} each)`, 'tp-h ub-t');
    const boxX = 16 + stack * 6, boxY = y + 24 + stack * 6, boxW = 500;
    const comp = sp.computeRacks;
    const cols = Math.min(16, comp);
    const rowsN = Math.min(4, Math.ceil(comp / cols));
    const cw = (boxW - 40) / cols - 4;
    const ch = comp <= 16 ? 64 : 22;
    const gridTop = boxY + 14;
    const gridBottom = gridTop + rowsN * (ch + 4);
    let inner = '';
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= comp) break;
      const cx = boxX + 20 + c * (cw + 4), cyy = gridTop + r * (ch + 4);
      inner += rect(cx, cyy, cw, ch, 2, 'tp-cab');
      if (comp <= 16) { const k0 = Math.min(sp.nodesPerRack, 8); for (let k = 0; k < k0; k++) inner += rect(cx + 3, cyy + 4 + k * ((ch - 8) / k0), cw - 6, Math.max(4, (ch - 8) / k0 - 3), 1, 'tp-server'); }
    }
    if (comp > cols * rowsN) inner += txt(boxX + boxW - 16, gridBottom - 8, '…');
    inner += txt(boxX + 20, gridBottom + 12, zh ? `${comp} 个计算柜 · 每柜 ${sp.nodesPerRack} 节点 / ${sp.nodesPerRack * sp.npusPerNode} NPU` : `${comp} compute cabinets · ${sp.nodesPerRack} nodes / ${sp.nodesPerRack * sp.npusPerNode} NPUs each`);
    // UB fabric: every compute cabinet reaches every communication cabinet (L2 sub-planes / pod-tier switches)
    const commTop = gridBottom + 46;
    const commShown = Math.min(sp.commRacks, 8);
    const commW = 52, commGap = 6;
    for (let i = 0; i < commShown; i++) {
      const cx = boxX + 20 + i * (commW + commGap);
      inner += rect(cx, commTop, commW, 28, 3, 'tp-comm');
      if (two) for (let k = 0; k < Math.min(sp.subPlanes, 7); k++) inner += line(cx + 5 + k * 7, commTop + 3, cx + 5 + k * 7, commTop + 25, 'tp-wire-ub');
      else for (let k = 0; k < Math.min(4, Math.ceil(podSw / Math.max(1, sp.commRacks))); k++) inner += rect(cx + 4 + k * 12, commTop + 8, 9, 12, 1, 'tp-ub');
    }
    if (sp.commRacks > commShown) inner += txt(boxX + 20 + commShown * (commW + commGap) + 2, commTop + 18, '…');
    if (commShown > 0) for (let k = 0; k < 8; k++) inner += line(boxX + 34 + k * ((boxW - 60) / 7), gridBottom + 18, boxX + 20 + commW / 2 + (k % commShown) * (commW + commGap), commTop, 'tp-wire-ub');
    const fabricTxt = two
      ? (zh ? `UB 交换：${sp.subPlanes} 个子平面 × ${sp.l2PerSubPlane} 片 L2（${sp.l2Ports} 口）；每片 L1 ${sp.linksPerL1} 条光链路` : `UB switching: ${sp.subPlanes} sub-planes × ${sp.l2PerSubPlane} L2 chips (${sp.l2Ports} ports); ${sp.linksPerL1} optical links per L1 chip`)
      : sp.fabric === 'blade-clos'
        ? (zh ? `UB 交换：每柜 ${sp.rackSwitches} 片 LinkBlade；每超节点 ${fmt(podSw)} 台 LinkDevice（${sp.podSwitchRadix} × 1.6 Tb/s）；NPO 光互联` : `UB switching: ${sp.rackSwitches} LinkBlade chips per cabinet; ${fmt(podSw)} LinkDevices per pod (${sp.podSwitchRadix} × 1.6 Tb/s); NPO optics`)
        : sp.fabric === 'mesh-4d'
          ? (zh ? `UB-Mesh 4D：柜内 2D 全互联 + ${sp.meshRackGrid} × ${sp.meshRackGrid} 柜间全互联；每超节点 ${fmt(podSw)} 台 HRS（${sp.podSwitchRadix} 口）` : `UB-Mesh 4D: in-cabinet 2D full mesh + ${sp.meshRackGrid} × ${sp.meshRackGrid} cabinet mesh; ${fmt(podSw)} HRS per pod (${sp.podSwitchRadix} ports)`)
          : (zh ? `UB 交换：柜内 2D 全互联（每柜 ${sp.rackSwitches} 片 LRS）；每 NPU ${sp.podUplinksPerNpu} 条 800G 光链路上联 ${fmt(podSw)} 台 UB 交换（${sp.podSwitchRadix} 口，一层 Clos）` : `UB switching: in-cabinet 2D full mesh (${sp.rackSwitches} LRS per cabinet); ${sp.podUplinksPerNpu} × 800G optical links per NPU to ${fmt(podSw)} UB switches (${sp.podSwitchRadix} ports, one-tier Clos)`);
    // a SuperPoD without communication cabinets (the UB domain is the server, e.g. Atlas 800T A3): the UB switching is on the node
    const commLabel = sp.commRacks === 0 && two
      ? (zh ? `无通信柜：UB 交换在节点内（每节点 ${sp.l1PerNode} 片 L1）` : `no communication cabinets: UB switching inside the node (${sp.l1PerNode} L1 chips per node)`)
      : two ? (zh ? `${sp.commRacks} 个通信柜（L2）` : `${sp.commRacks} communication cabinets (L2)`) : zh ? `${sp.commRacks} 个灵衢互联柜（超节点层交换）` : `${sp.commRacks} UB interconnect cabinets (pod switch tier)`;
    inner += txt(boxX + 20, commTop + 44, commLabel);
    // one line per clause so the caption stays inside the 500-px pod box
    const fabricLines = fabricTxt.split(zh ? '；' : '; ');
    fabricLines.forEach((ln, k) => { inner += txt(boxX + 20, commTop + 60 + k * 14, ln + (k < fabricLines.length - 1 ? (zh ? '；' : ';') : ''), 'tp-s ub-t'); });
    const boxH = commTop + 72 + (fabricLines.length - 1) * 14 - boxY;
    for (let k = stack; k >= 1; k--) g += rect(boxX - k * 6, boxY - k * 6, boxW, boxH, 8, 'tp-pod tp-pod-back');
    g += rect(boxX, boxY, boxW, boxH, 8, 'tp-pod');
    g += inner;
    g += nodeDetail({ x: detailX, y: boxY, npus: sp.npusPerNode, cpus: sp.cpusPerNode, l1: sp.l1PerNode, ports: (t.scaleOut?.portsPerNpu ?? sp.rdmaPortsPerNpu) * sp.npusPerNode, lang, ub: true, fabric: sp.fabric, rackSwitches: sp.rackSwitches });
    y = Math.max(boxY + boxH, boxY + (two ? 156 : 168)) + 20;
    const sw = two ? `${fmt(counts.l1Switches)} L1 + ${fmt(counts.l2Switches)} L2` : zh ? `${fmt(counts.rackSwitches)} 柜内 + ${fmt(counts.podSwitches)} 超节点层交换` : `${fmt(counts.rackSwitches)} in-cabinet + ${fmt(counts.podSwitches)} pod switches`;
    const npo = counts.opticalEngines > 0 ? (zh ? ` · ${fmt(counts.opticalEngines)} 个 NPO 光引擎` : ` · ${fmt(counts.opticalEngines)} NPO engines`) : '';
    g += txt(16, y, zh ? `${fmt(counts.gpus)} NPU · ${fmt(counts.nodes)} 节点 · ${fmt(counts.racks)} 计算柜 + ${fmt(counts.commRacks)} ${commZh}` : `${fmt(counts.gpus)} NPUs · ${fmt(counts.nodes)} nodes · ${fmt(counts.racks)} compute + ${fmt(counts.commRacks)} ${commEn}`);
    g += txt(16, y + 14, zh ? `${sw} · ${fmt(counts.opticalLinks)} 条 UB 光链路${npo}` : `${sw} · ${fmt(counts.opticalLinks)} UB optical links${npo}`);
    y += 28;
  }
  const H = Math.round(y + 6);
  const label = zh ? '拓扑示意图' : 'topology schematic';
  const svg = embedStyle
    ? `<svg class="viz topo" id="${esc(id)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${STYLE}${TOPO_STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>${g}</svg>`
    : `<svg class="topo-pic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" style="min-width:620px">${g}</svg>`;
  return { svg, width: W, height: H };
}
