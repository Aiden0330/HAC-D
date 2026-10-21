/**
 * The Ascend 910C topology figures of docs/ASCEND910C_SCALING_RELIABILITY.{zh,en}.html (inline SVG, the light / dark tokens and
 * drawing helpers of scripts/ascend950-figures.mjs):
 *  - figCm384: the Atlas 900 A3 SuperPoD / CloudMatrix384 (12 compute + 4 communication cabinets, the two-level UB fabric) with a
 *    zoom on one node (8 × 910C = 16 dies, 7 on-board L1 chips, 4 CPUs, Qingtian card, one RDMA port per die);
 *  - figA3Server: the Atlas 800T A3 server cluster (UB domain = one 10U server) and the RoCE folded Clos between UB domains, which
 *    is the same per NPU for both architectures.
 * Every count drawn comes from docs/ascend910c-scaling/results.json (passed in as `R`).
 */
import { esc, fmt, svgOpen, titleBlock, legend, textBlock, lines, wrap } from './ascend950-figures.mjs';

/* ======================================================================================================================= */
/* Figure: Atlas 900 A3 SuperPoD / CloudMatrix384 and one node                                                                */
/* ======================================================================================================================= */
export function figCm384(lang, R, id = 'fig-cm384', num = 1) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const m = R.archs.cm384.mapping.items;
  const W = 960, H = 478;
  const head = titleBlock(T(`图 ${num}：Atlas 900 A3 超节点 / CloudMatrix384（384 NPU）：12 计算柜 + 4 通信柜；节点内 die → 7 片板载 L1，L1 → 通信柜内 7 个子平面 × 16 片 L2（每对一条光链路）`, `Figure ${num}: Atlas 900 A3 SuperPoD / CloudMatrix384 (384 NPUs): 12 compute + 4 communication cabinets; die → 7 on-board L1 chips inside each node, L1 → 7 sub-planes × 16 L2 chips in the communication cabinets (one optical link per pair)`));
  let g = svgOpen(id, W, H + head.dy, T('CloudMatrix384 超节点拓扑', 'CloudMatrix384 SuperPoD topology')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
  /* ---- left panel: the SuperPoD ---- */
  const PL = { x: 14, y: 40, w: 540, h: 362 };
  g += `<rect x="${PL.x}" y="${PL.y}" width="${PL.w}" height="${PL.h}" rx="6" class="panel"/>`;
  g += `<text x="${PL.x + 12}" y="${PL.y + 18}" class="h">${esc(T(`超节点（一个 UB 域）：${fmt(m.npu.perDomain)} NPU = ${fmt(m.computeRack.perDomain)} 计算柜 × 32 = ${fmt(m.node.perDomain)} 节点 × 8`, `SuperPoD (one UB domain): ${fmt(m.npu.perDomain)} NPUs = ${fmt(m.computeRack.perDomain)} cabinets × 32 = ${fmt(m.node.perDomain)} nodes × 8`))}</text>`;
  const cabW = 70, cabH = 58, cx0 = PL.x + 26, cstep = 84;
  const topY = PL.y + 36, botY = PL.y + 224;
  const ccW = 112, ccH = 70, ccx0 = PL.x + 24, ccstep = 128, ccY = PL.y + 126;
  const cabinet = (x, y, i) => {
    let s = `<rect x="${x}" y="${y}" width="${cabW}" height="${cabH}" rx="3" class="cab"/>`;
    for (let r = 0; r < 4; r++) {
      const ty = y + 5 + r * 13;
      s += `<rect x="${x + 4}" y="${ty}" width="${cabW - 8}" height="10" rx="1.5" class="tray"/>`;
      for (let k = 0; k < 8; k++) s += `<rect x="${x + 7 + k * 6.4}" y="${ty + 2}" width="4.6" height="6" rx="0.8" class="npu" style="fill:var(--surface)"/>`;
      s += `<rect x="${x + cabW - 12}" y="${ty + 2}" width="6" height="6" rx="0.8" class="ubsolid"/>`;
    }
    return s + `<text x="${x + cabW / 2}" y="${y < ccY ? y - 3 : y + cabH + 11}" class="tiny" text-anchor="middle">${i}</text>`;
  };
  // links first: every compute cabinet to every communication cabinet (each node's 7 L1 chips reach all 16 L2 of their sub-planes)
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
    const ax = cx0 + i * cstep + cabW / 2, bx = ccx0 + j * ccstep + ccW / 2;
    g += `<line x1="${ax}" y1="${topY + cabH}" x2="${bx}" y2="${ccY}" class="l-ub" opacity="0.55"/>`;
    g += `<line x1="${ax}" y1="${botY}" x2="${bx}" y2="${ccY + ccH}" class="l-ub" opacity="0.55"/>`;
  }
  for (let i = 0; i < 6; i++) g += cabinet(cx0 + i * cstep, topY, i + 1) + cabinet(cx0 + i * cstep, botY, i + 7);
  for (let j = 0; j < 4; j++) {
    const x = ccx0 + j * ccstep;
    g += `<rect x="${x}" y="${ccY}" width="${ccW}" height="${ccH}" rx="4" class="ub"/>`;
    g += `<text x="${x + 6}" y="${ccY + 12}" class="tiny">${esc(T(`通信柜 ${j + 1}：28 片 L2`, `comm. cabinet ${j + 1}: 28 L2`))}</text>`;
    for (let r = 0; r < 7; r++) for (let k = 0; k < 4; k++) g += `<rect x="${x + 8 + k * 25}" y="${ccY + 17 + r * 7.2}" width="21" height="5" rx="1" class="ubsolid"/>`;
  }
  g += `<rect x="${ccx0 - 4}" y="${ccY - 4}" width="${3 * ccstep + ccW + 8}" height="${ccH + 8}" rx="6" class="asm"/>`;
  g += `<text x="${ccx0 + 3 * ccstep + ccW + 2}" y="${ccY - 8}" class="tiny halo" text-anchor="end">${esc(T('L2 在 4 柜间的分布未公开：按每柜 28 片（7 子平面 × 4）计', 'placement of the L2 chips over the 4 cabinets not public: 28 each (7 sub-planes × 4) assumed'))}</text>`;
  const a1 = textBlock(PL.x + 12, PL.y + 312, T(`每节点 7 片 L1 × 16 条上行 = ${fmt(m.opticalLink.perNode)} 条 L1–L2 光链路；每超节点 ${fmt(m.opticalLink.perDomain)} 条、${fmt(m.transceiver.perDomain)} 个链路端（每端一只光模块，假设；SemiAnalysis 计 6,912 只 400G LPO，口径不同）。7 个子平面相互独立：子平面 k = 48 片 L1-k 与 16 片 L2 的完全二部图，无备用口。`, `Each node: 7 L1 × 16 uplinks = ${fmt(m.opticalLink.perNode)} L1–L2 optical links; ${fmt(m.opticalLink.perDomain)} links and ${fmt(m.transceiver.perDomain)} link ends per SuperPoD (one module per end, assumed; SemiAnalysis counts 6,912 × 400G LPO on another basis). The 7 sub-planes are independent: sub-plane k is the complete bipartite graph of the 48 L1-k chips and its 16 L2 chips, no spare ports.`), PL.w - 24);
  g += a1.svg;
  /* ---- right panel: one node ---- */
  const PR = { x: 568, y: 40, w: 378, h: 362 };
  g += `<rect x="${PR.x}" y="${PR.y}" width="${PR.w}" height="${PR.h}" rx="6" class="panel"/>`;
  const hr = textBlock(PR.x + 12, PR.y + 18, T('一个节点（= Atlas 800T A3 主板）：8 × 910C（16 die）+ 4 × 鲲鹏 920 + 7 片板载 L1 + 擎天卡', 'One node (= the Atlas 800T A3 board): 8 × 910C (16 dies) + 4 × Kunpeng 920 + 7 on-board L1 chips + Qingtian card'), PR.w - 24, 'h', 11.5, 14);
  g += hr.svg;
  const N0 = { x: PR.x + 12, y: PR.y + 26 + hr.h };
  const dies = [];
  for (let k = 0; k < 8; k++) {
    const nx = N0.x + k * 44;
    g += `<rect x="${nx}" y="${N0.y}" width="40" height="44" rx="3" class="cab"/>`;
    for (let d = 0; d < 2; d++) dies.push({ x: nx + 4 + d * 17, y: N0.y + 6, w: 15, h: 32 });
  }
  const l1 = Array.from({ length: 7 }, (_, k) => ({ x: N0.x + 4 + k * 50, y: N0.y + 116, w: 42, h: 18 }));
  for (const d of dies) for (const l of l1) g += `<line x1="${d.x + d.w / 2}" y1="${d.y + d.h}" x2="${l.x + l.w / 2}" y2="${l.y}" class="l-ub" stroke-width="0.45" opacity="0.5"/>`;
  for (const d of dies) g += `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="2" class="npu"/><circle cx="${d.x + d.w / 2}" cy="${d.y}" r="2.2" style="fill:var(--s2)"/>`;
  g += l1.map((l, k) => `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="2" class="ub"/><text x="${l.x + l.w / 2}" y="${l.y + 12.5}" text-anchor="middle" class="tiny">L1-${k + 1}</text>`).join('');
  // uplinks to the sub-planes
  for (const l of l1) g += `<path d="M ${l.x + l.w / 2} ${l.y + l.h} v 12" class="l-ubb"/><path d="M ${l.x + l.w / 2 - 3.5} ${l.y + l.h + 8} l 3.5 5 l 3.5 -5" class="l-ubb"/>`;
  g += `<text x="${N0.x + 178}" y="${l1[0].y + l1[0].h + 26}" class="tiny" text-anchor="middle">${esc(T('每片 L1 → 本子平面 16 片 L2，各 1 条光链路', 'each L1 → one optical link to each of its sub-plane’s 16 L2 chips'))}</text>`;
  const cy = l1[0].y + l1[0].h + 36;
  for (let c = 0; c < 4; c++) g += `<rect x="${N0.x + 4 + c * 52}" y="${cy}" width="46" height="16" rx="2" class="cpu"/><text x="${N0.x + 27 + c * 52}" y="${cy + 11.5}" text-anchor="middle" class="tiny">CPU</text>`;
  g += `<rect x="${N0.x + 216}" y="${cy}" width="134" height="16" rx="2" class="so" style="opacity:0.85"/><text x="${N0.x + 283}" y="${cy + 11.5}" text-anchor="middle" class="tiny">${esc(T('擎天卡（VPC 面）', 'Qingtian card (VPC plane)'))}</text>`;
  const notes = [
    T('UB：每 NPU 14 条 × 28 GB/s = 392 GB/s 单向（产品页 784 GB/s、1:1 无收敛）；每 die 的 7 条各接一片 L1', 'UB: 14 links × 28 GB/s = 392 GB/s per NPU one way (product page: 784 GB/s, 1:1 non-blocking); each die’s 7 links go one to each L1'),
    T('橙点：每 die 1 个 RDMA 口，每 NPU 400 Gb/s（scale-out，图 2）', 'orange: one RDMA port per die, 400 Gb/s per NPU (scale-out, Figure 2)'),
    T(`每柜 4 节点 = ${fmt(m.npu.perRack)} NPU、${fmt(m.cpu.perRack)} CPU、${fmt(m.l1.perRack)} 片 L1、${fmt(m.opticalLink.perRack)} 条光链路；计算柜液冷`, `per cabinet 4 nodes = ${fmt(m.npu.perRack)} NPUs, ${fmt(m.cpu.perRack)} CPUs, ${fmt(m.l1.perRack)} L1 chips, ${fmt(m.opticalLink.perRack)} optical links; liquid-cooled compute cabinets`),
  ];
  let ny = cy + 30;
  for (const n of notes) { const b = textBlock(PR.x + 12, ny, n, PR.w - 24); g += b.svg; ny += b.h + 4; }
  // zoom from cabinet 6 (top row, right end) to the right panel
  const z = cx0 + 5 * cstep;
  g += `<path d="M ${z + cabW} ${topY + 5} L ${N0.x - 4} ${N0.y}" class="zoom"/><path d="M ${z + cabW} ${topY + 15} L ${N0.x - 4} ${N0.y + 44}" class="zoom"/>`;
  /* ---- legend and sources ---- */
  const lg = legend(PL.x, PL.y + PL.h + 16, [
    { cls: 'npu', label: T('NPU / die', 'NPU / die') }, { cls: 'cpu', label: 'CPU' }, { cls: 'ubsolid', label: T('UB 交换芯片（L1 / L2）', 'UB switch chip (L1 / L2)') },
    { cls: 'l-ub', label: T('UB 光链路（L1–L2）', 'UB optical link (L1–L2)'), line: true }, { cls: 'so', label: T('RDMA / VPC 出口', 'RDMA / VPC egress') }, { cls: 'asm', label: T('假设 / 未公开（虚线框）', 'assumed / not public (dashed)') },
  ]);
  g += lg.g;
  const src = textBlock(PL.x, lg.y + 17, T('来源：结构与计数 = CloudMatrix384 论文（arXiv 2506.12708 v3 §3.3，华为论文）：48 节点、每节点 8 NPU + 4 CPU + 7 L1、12 + 4 柜、7 子平面 × 16 片 L2 × 48 口、每 L1 16 条上行、每 die 7 条 UB 与 1 个 RDMA 口；784 GB/s 与 4 × 鲲鹏 920 = Atlas 800T A3 产品页（华为确认）；6,912 只 LPO = SemiAnalysis 公开部分（分析师）。', 'Sources: structure and counts = the CloudMatrix384 paper (arXiv 2506.12708 v3 §3.3, Huawei paper): 48 nodes, 8 NPUs + 4 CPUs + 7 L1 per node, 12 + 4 cabinets, 7 sub-planes × 16 L2 × 48 ports, 16 uplinks per L1, 7 UB links and 1 RDMA port per die; 784 GB/s and 4 × Kunpeng 920 = Atlas 800T A3 product page (Huawei-confirmed); 6,912 LPO = SemiAnalysis public part (analyst).'), W - 30, 'm');
  g += src.svg;
  return g + '</g></svg>';
}

/* ======================================================================================================================= */
/* Figure: Atlas 800T A3 server cluster and the RoCE Clos between UB domains                                                 */
/* ======================================================================================================================= */
export function figA3Server(lang, R, id = 'fig-a3server', num = 2) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const m = R.archs.a3server.mapping.items;
  const so = R.scaleOut.main.so;
  const z5 = R.sensitivity.scaleOut.main.sizes['500000'];
  const s500c = R.archs.cm384.sizes['500000'], s500s = R.archs.a3server.sizes['500000'];
  const W = 960, H = 456;
  const head = titleBlock(T(`图 ${num}：Atlas 800T A3 服务器集群（UB 域 = 一台 10U 服务器，8 NPU）与 UB 域之间的 RoCE 折叠 Clos（主算例：每 NPU 2 × 200G、${so.radix} 口交换机，两种架构相同）`, `Figure ${num}: the Atlas 800T A3 server cluster (UB domain = one 10U server, 8 NPUs) and the RoCE folded Clos between UB domains (main case: 2 × 200G per NPU, ${so.radix}-port switches, the same for both architectures)`));
  let g = svgOpen(id, W, H + head.dy, T('800T A3 服务器集群与 scale-out', '800T A3 server cluster and scale-out')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
  /* ---- left: server cabinet and one server ---- */
  const PL = { x: 14, y: 40, w: 402, h: 340 };
  g += `<rect x="${PL.x}" y="${PL.y}" width="${PL.w}" height="${PL.h}" rx="6" class="panel"/>`;
  const hl = textBlock(PL.x + 12, PL.y + 18, T('Atlas 800T A3：8 × 910C + 4 × 鲲鹏 920，10U；每柜 4 台 = 32 NPU（假设）', 'Atlas 800T A3: 8 × 910C + 4 × Kunpeng 920, 10U; 4 per cabinet = 32 NPUs (assumed)'), PL.w - 24, 'h', 11.5, 14);
  g += hl.svg;
  const C = { x: PL.x + 14, y: PL.y + 30 + hl.h, w: 104, h: 196 };
  g += `<rect x="${C.x}" y="${C.y}" width="${C.w}" height="${C.h}" rx="4" class="cab"/>`;
  for (let r = 0; r < 4; r++) {
    const y = C.y + 8 + r * 46.5;
    g += `<rect x="${C.x + 6}" y="${y}" width="${C.w - 12}" height="40" rx="2" class="tray"/>`;
    for (let k = 0; k < 8; k++) g += `<rect x="${C.x + 11 + (k % 4) * 20}" y="${y + 5 + Math.floor(k / 4) * 13}" width="15" height="10" rx="1.2" class="npu" style="fill:var(--surface)"/>`;
    g += `<rect x="${C.x + 11}" y="${y + 31}" width="76" height="5" rx="1" class="ubsolid"/>`;
  }
  g += `<rect x="${C.x - 4}" y="${C.y - 4}" width="${C.w + 8}" height="${C.h + 8}" rx="6" class="asm"/>`;
  g += `<text x="${C.x + C.w / 2}" y="${C.y + C.h + 16}" class="tiny" text-anchor="middle">${esc(T('计算柜（4 × 10U）', 'cabinet (4 × 10U)'))}</text>`;
  // zoom: one server
  const S = { x: C.x + C.w + 30, y: C.y, w: PL.x + PL.w - (C.x + C.w + 30) - 12, h: 196 };
  g += `<rect x="${S.x}" y="${S.y}" width="${S.w}" height="${S.h}" rx="4" class="cab"/>`;
  g += `<path d="M ${C.x + C.w - 6} ${C.y + 8} L ${S.x} ${S.y}" class="zoom"/><path d="M ${C.x + C.w - 6} ${C.y + 48} L ${S.x} ${S.y + S.h}" class="zoom"/>`;
  g += `<text x="${S.x + 8}" y="${S.y + 14}" class="tiny">${esc(T('一台服务器 = 一个 UB 域', 'one server = one UB domain'))}</text>`;
  const npuX = (k) => S.x + 10 + (k % 4) * 58, npuY = (k) => S.y + 24 + Math.floor(k / 4) * 40;
  const l1y = S.y + 118;
  const l1 = Array.from({ length: 7 }, (_, k) => ({ x: S.x + 10 + k * 33, y: l1y, w: 28, h: 15 }));
  for (let k = 0; k < 8; k++) for (const l of l1) g += `<line x1="${npuX(k) + 24}" y1="${npuY(k) + 30}" x2="${l.x + l.w / 2}" y2="${l.y}" class="l-ub" stroke-width="0.45" opacity="0.45"/>`;
  for (let k = 0; k < 8; k++) {
    g += `<rect x="${npuX(k)}" y="${npuY(k)}" width="48" height="30" rx="3" class="npu"/><text x="${npuX(k) + 24}" y="${npuY(k) + 19}" class="tiny" text-anchor="middle">910C</text>`;
    for (let d = 0; d < 2; d++) g += `<circle cx="${npuX(k) + 14 + d * 20}" cy="${npuY(k)}" r="2.2" style="fill:var(--s2)"/>`;
  }
  g += l1.map((l, k) => `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="2" class="ub"/><text x="${l.x + l.w / 2}" y="${l.y + 10.5}" text-anchor="middle" class="tiny">L1</text>`).join('');
  for (const l of l1) g += `<path d="M ${l.x + l.w / 2} ${l.y + l.h} v 9" style="stroke:var(--muted);stroke-width:1;stroke-dasharray:2 2"/>`;
  g += `<text x="${S.x + S.w / 2}" y="${l1y + 36}" class="tiny" text-anchor="middle">${esc(T('L1 上行口闲置（无 L2、无 UB 光链路）', 'L1 uplink ports unused (no L2, no UB optics)'))}</text>`;
  for (let c = 0; c < 4; c++) g += `<rect x="${S.x + 10 + c * 30}" y="${S.y + 166}" width="26" height="14" rx="2" class="cpu"/><text x="${S.x + 23 + c * 30}" y="${S.y + 176}" text-anchor="middle" class="tiny">CPU</text>`;
  g += `<rect x="${S.x + 134}" y="${S.y + 166}" width="${S.w - 144}" height="14" rx="2" class="so" style="opacity:0.85"/><text x="${S.x + 134 + (S.w - 144) / 2}" y="${S.y + 176}" text-anchor="middle" class="tiny">${esc(T('16 × 200G RoCE', '16 × 200G RoCE'))}</text>`;
  const ln = [
    T('与 CM384 节点同一块主板：每 NPU 少 14 条 UB 光链路（28 个链路端）、0.29 片 L2 与 1/96 个通信柜', 'the same board as a CM384 node: per NPU 14 UB optical links (28 link ends), 0.29 L2 chips and 1/96 of a communication cabinet fewer'),
    T('UB 域只有 8 卡：超出 8 卡的 TP / EP 通信改走 RoCE（性能影响不在本模型内）', 'the UB domain is only 8 NPUs: TP / EP traffic beyond 8 NPUs goes over RoCE (performance not in this model)'),
  ];
  let ly = C.y + C.h + 34;
  for (const t of ln) { const b = textBlock(PL.x + 12, ly, t, PL.w - 24); g += b.svg; ly += b.h + 4; }
  /* ---- right: RoCE folded Clos ---- */
  const PR = { x: 430, y: 40, w: 516, h: 340 };
  g += `<rect x="${PR.x}" y="${PR.y}" width="${PR.w}" height="${PR.h}" rx="6" class="panel"/>`;
  g += `<text x="${PR.x + 12}" y="${PR.y + 18}" class="h">${esc(T(`UB 域之间：RoCE 折叠 Clos（radix ${so.radix}、无收敛；50 万卡为 ${z5.tiers} 层）`, `Between UB domains: RoCE folded Clos (radix ${so.radix}, non-blocking; ${z5.tiers} tiers at 500k)`))}</text>`;
  const bandX = PR.x + 70, bandW = 250;
  const tiers = z5.perTier.length;
  const tierY = (t) => PR.y + 48 + (tiers - 1 - t) * 52; // t = 0 leaf (bottom) … top
  const nPer = (t) => (t === tiers - 1 ? 4 : 8);
  const sx = (t, i) => bandX + (bandW / nPer(t)) * (i + 0.5) - 13;
  for (let t = 0; t < tiers - 1; t++) for (let i = 0; i < nPer(t); i++) for (let j = 0; j < nPer(t + 1); j++) {
    if (t + 1 < tiers - 1 && Math.floor(i / 4) !== Math.floor(j / 4)) continue; // pods of the folded Clos below the top tier
    g += `<line x1="${sx(t, i) + 13}" y1="${tierY(t)}" x2="${sx(t + 1, j) + 13}" y2="${tierY(t + 1) + 11}" class="l-so" opacity="0.45"/>`;
  }
  for (let t = 0; t < tiers; t++) {
    for (let i = 0; i < nPer(t); i++) g += `<rect x="${sx(t, i)}" y="${tierY(t)}" width="26" height="11" rx="2" class="so"/>`;
    g += `<text x="${PR.x + 12}" y="${tierY(t) + 9}" class="s">${esc(T(t === 0 ? '叶（层 1）' : t === tiers - 1 ? `顶层（层 ${t + 1}）` : `层 ${t + 1}`, t === 0 ? 'leaf (tier 1)' : t === tiers - 1 ? `top (tier ${t + 1})` : `tier ${t + 1}`))}</text>`;
    g += `<text x="${bandX + bandW + 6}" y="${tierY(t) + 9}" class="tiny">${esc(fmt(z5.perTier[t]))}</text>`;
  }
  // UB domains at the bottom
  const domY = tierY(0) + 46;
  for (let i = 0; i < 5; i++) {
    const x = bandX + i * 52;
    g += `<line x1="${x + 22}" y1="${domY}" x2="${sx(0, Math.min(7, i * 2)) + 13}" y2="${tierY(0) + 11}" class="l-so" opacity="0.8"/>`;
    g += `<rect x="${x}" y="${domY}" width="44" height="20" rx="4" class="ub"/><text x="${x + 22}" y="${domY + 13.5}" class="tiny" text-anchor="middle">${esc(i === 3 ? '…' : i === 4 ? T('域 N', 'dom. N') : T(`域 ${i + 1}`, `dom. ${i + 1}`))}</text>`;
  }
  g += `<text x="${bandX + bandW / 2}" y="${domY + 34}" class="tiny" text-anchor="middle">${esc(T(`50 万卡：CM384 ${fmt(s500c.derived.ubDomains)} 个超节点，或 800T A3 ${fmt(s500s.derived.ubDomains)} 台服务器`, `500k NPUs: ${fmt(s500c.derived.ubDomains)} CM384 pods or ${fmt(s500s.derived.ubDomains)} 800T A3 servers`))}</text>`;
  const rx = bandX + bandW + 44;
  const cap3 = (so.radix * so.radix * so.radix) / 4;
  const rnotes = [
    T(`每 NPU ${so.portsPerNpu} 口（每 die 1 口，200G）；叶：${fmt(so.radix / 2)} 下 + ${fmt(so.radix / 2)} 上`, `${so.portsPerNpu} ports per NPU (one per die, 200G); leaf: ${fmt(so.radix / 2)} down + ${fmt(so.radix / 2)} up`),
    T(`radix ${so.radix}：三层最多 ${fmt(cap3)} 口（${fmt(cap3 / so.portsPerNpu)} NPU），再多要第四层`, `radix ${so.radix}: three tiers carry at most ${fmt(cap3)} ports (${fmt(cap3 / so.portsPerNpu)} NPUs); beyond that a fourth tier`),
    T(`50 万卡：共 ${fmt(z5.switches)} 台交换机、${fmt(z5.links)} 条链路、${fmt(z5.transceivers)} 只光模块`, `500k NPUs: ${fmt(z5.switches)} switches, ${fmt(z5.links)} links, ${fmt(z5.transceivers)} transceivers`),
    T('CM384 RDMA 面的公开上限为 16.5 万卡；交换机端口数与是否收敛未公开（虚线框）', 'the stated ceiling of the CM384 RDMA plane is 165,000 NPUs; switch radix and oversubscription not public (dashed)'),
  ];
  let ry = PR.y + 44;
  for (const [i, t] of rnotes.entries()) {
    const b = textBlock(rx, ry, t, PR.x + PR.w - rx - 10, i === 3 ? 'm' : 's');
    if (i === 3) g += `<rect x="${rx - 6}" y="${ry - 12}" width="${PR.x + PR.w - rx}" height="${b.h + 6}" rx="4" class="asm"/>`;
    g += b.svg;
    ry += b.h + 9;
  }
  /* ---- legend and sources ---- */
  const lg = legend(PL.x, PL.y + PL.h + 16, [
    { cls: 'npu', label: 'NPU' }, { cls: 'ubsolid', label: T('板载 L1 UB 芯片', 'on-board L1 UB chip') }, { cls: 'so', label: T('RoCE 交换机 / 端口', 'RoCE switch / port') },
    { cls: 'l-so', label: T('RoCE 光链路', 'RoCE optical link'), line: true }, { cls: 'asm', label: T('假设 / 未公开（虚线框）', 'assumed / not public (dashed)') },
  ]);
  g += lg.g;
  const src = textBlock(PL.x, lg.y + 17, T('来源：Atlas 800T A3 产品页（10U、单机 8 × 昇腾 910、4 × 鲲鹏 920、784 GB/s 1:1、多机可组成最大 384 卡超节点，华为确认）；第三方 800I A3 规格（8 × 400GE RoCE 直出、6 × 3 kW 电源，未证实）；每柜台数、端口数与 Clos 参数为本页假设。', 'Sources: Atlas 800T A3 product page (10U, 8 × Ascend 910, 4 × Kunpeng 920, 784 GB/s at 1:1, up to 384 cards as a supernode; Huawei-confirmed); a third-party 800I A3 listing (8 × 400GE RoCE direct, 6 × 3 kW supplies; unverified); servers per cabinet, ports and the Clos parameters are this page’s assumptions.'), W - 30, 'm');
  g += src.svg;
  return g + '</g></svg>';
}

export { esc, fmt, lines, wrap };
