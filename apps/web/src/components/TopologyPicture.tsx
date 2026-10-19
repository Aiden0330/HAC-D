import type { ReactNode } from 'react';
import type { Counts, Scenario } from '@hac-d/core';
import type { Lang } from '../lib/format.js';

/**
 * v4 live schematic of the topology templates, drawn from the current unit counts: the scale-out (RoCE / RDMA) Clos tiers on top,
 * the cabinets (A2) or SuperPoDs (A3, Atlas 950) in the middle, one node enlarged on the right. Counts in the labels are the
 * engine's (`computeCounts`); the drawing shows at most a handful of each unit with an ellipsis and the total.
 */
const fmt = (n: number) => n.toLocaleString('en-US');
const W = 760;

function Txt({ x, y, children, cls = 'tp-s', anchor = 'start' }: { x: number; y: number; children: ReactNode; cls?: string; anchor?: 'start' | 'middle' | 'end' }) {
  return <text x={x} y={y} className={cls} textAnchor={anchor}>{children}</text>;
}

/** row of `shown` boxes standing for `total` units, with an ellipsis when total > shown */
function Row({ x, y, w, h, total, shown, cls, gap = 4 }: { x: number; y: number; w: number; h: number; total: number; shown: number; cls: string; gap?: number }) {
  const n = Math.min(total, shown);
  const items: ReactNode[] = [];
  for (let i = 0; i < n; i++) items.push(<rect key={i} x={x + i * (w + gap)} y={y} width={w} height={h} rx={2} className={cls} />);
  if (total > shown) items.push(<text key="e" x={x + n * (w + gap) + 2} y={y + h / 2 + 4} className="tp-s">…</text>);
  return <g>{items}</g>;
}

function closTiers(counts: Counts, lang: Lang, x0: number, y0: number, width: number, label: string): { svg: ReactNode; bottom: number } {
  const tiers = counts.scaleOutPerTier;
  if (!tiers.length) return { svg: null, bottom: y0 };
  const names = tiers.length === 1 ? [lang === 'zh' ? '交换机' : 'switch'] : tiers.map((_, i) => (i === 0 ? (lang === 'zh' ? '叶' : 'leaf') : i === tiers.length - 1 ? (tiers.length === 2 ? (lang === 'zh' ? '脊' : 'spine') : lang === 'zh' ? '核心' : 'core') : lang === 'zh' ? '汇聚' : 'agg.'));
  const rowH = 22;
  const items: ReactNode[] = [];
  items.push(<Txt key="t" x={x0} y={y0 + 10} cls="tp-h roce-t">{label}</Txt>);
  const top = y0 + 18;
  tiers.slice().reverse().forEach((n, k) => {
    const i = tiers.length - 1 - k;
    const y = top + k * rowH;
    items.push(<Txt key={`n${i}`} x={x0} y={y + 12}>{names[i]}</Txt>);
    items.push(<Row key={`r${i}`} x={x0 + 46} y={y + 2} w={22} h={12} total={n} shown={Math.max(4, Math.floor((width - 170) / 26))} cls="tp-roce" />);
    items.push(<Txt key={`c${i}`} x={x0 + width} y={y + 12} anchor="end" cls="tp-s tp-num">{fmt(n)}</Txt>);
    // a few crossing links between this tier and the one above (schematic of the folded Clos)
    if (k > 0) for (let j = 0; j < 6; j++) for (const d of [0, 1]) items.push(<line key={`l${i}-${j}-${d}`} x1={x0 + 57 + j * 26} y1={y + 2} x2={x0 + 57 + ((j + d * 3) % 6) * 26} y2={y - 8} className="tp-wire-roce" />);
  });
  return { svg: <g>{items}</g>, bottom: top + tiers.length * rowH };
}

function NodeDetail({ x, y, npus, cpus, l1, ports, lang, ub }: { x: number; y: number; npus: number; cpus: number; l1: number; ports: number; lang: Lang; ub: boolean }) {
  const items: ReactNode[] = [];
  const w = 196;
  items.push(<rect key="b" x={x} y={y} width={w} height={ub ? 150 : 132} rx={8} className="tp-node" />);
  items.push(<Txt key="t" x={x + 10} y={y + 16} cls="tp-h">{lang === 'zh' ? `一个节点：${npus} NPU + ${cpus} CPU` : `one node: ${npus} NPUs + ${cpus} CPUs`}</Txt>);
  // NPU ring with the scale-up links (HCCS mesh in A2, UB via the L1 chips in A3 / 950)
  const cx = x + 56, cy = y + 74, r = 32;
  const pts = Array.from({ length: npus }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / npus - Math.PI / 2), cy + r * Math.sin((2 * Math.PI * i) / npus - Math.PI / 2)]);
  if (!ub) for (let i = 0; i < npus; i++) for (let j = i + 1; j < npus; j++) items.push(<line key={`m${i}-${j}`} x1={pts[i][0]} y1={pts[i][1]} x2={pts[j][0]} y2={pts[j][1]} className="tp-wire-hccs" />);
  pts.forEach(([px, py], i) => items.push(<rect key={`n${i}`} x={px - 7} y={py - 7} width={14} height={14} rx={2} className="tp-npu" />));
  items.push(<Txt key="nl" x={cx} y={y + 124} anchor="middle">{ub ? (lang === 'zh' ? 'NPU（UB 经 L1）' : 'NPUs (UB via L1)') : lang === 'zh' ? 'NPU（HCCS 全互连）' : 'NPUs (HCCS mesh)'}</Txt>);
  // CPUs
  for (let i = 0; i < cpus; i++) items.push(<rect key={`c${i}`} x={x + 112 + (i % 2) * 38} y={y + 32 + Math.floor(i / 2) * 20} width={32} height={14} rx={2} className="tp-cpu" />);
  items.push(<Txt key="cl" x={x + 112} y={y + 32 + Math.ceil(cpus / 2) * 20 + 8}>{lang === 'zh' ? '鲲鹏 CPU' : 'Kunpeng CPUs'}</Txt>);
  if (ub) {
    for (let i = 0; i < l1; i++) items.push(<rect key={`l${i}`} x={x + 112 + i * 11} y={y + 94} width={9} height={14} rx={1} className="tp-ub" />);
    items.push(<Txt key="ll" x={x + 112} y={y + 122}>{lang === 'zh' ? `${l1} 片 L1 UB 芯片` : `${l1} L1 UB chips`}</Txt>);
    items.push(<Txt key="rl" x={x + 10} y={y + 142} cls="tp-s rdma-t">{lang === 'zh' ? `${ports} 个 RDMA 口（scale-out）` : `${ports} RDMA ports (scale-out)`}</Txt>);
  } else {
    for (let i = 0; i < ports; i++) items.push(<rect key={`p${i}`} x={x + 112 + i * 10} y={y + 96} width={8} height={10} rx={1} className="tp-roce" />);
    items.push(<Txt key="pl" x={x + 112} y={y + 120} cls="tp-s roce-t">{lang === 'zh' ? `${ports} × 200GE RoCE` : `${ports} × 200GE RoCE`}</Txt>);
  }
  return <g>{items}</g>;
}

export function TopologyPicture({ scenario, counts, lang }: { scenario: Scenario; counts: Counts; lang: Lang }) {
  const t = scenario.topology;
  const sp = t.superpod;
  const zh = lang === 'zh';
  const parts: ReactNode[] = [];
  let y = 8;
  const soLabel = sp ? (zh ? `RDMA scale-out 网络 · ${counts.scaleOutTiers} 层 Clos · ${fmt(counts.scaleOutPorts)} 口 · ${fmt(counts.scaleOutLinks)} 条链路` : `RDMA scale-out network · ${counts.scaleOutTiers}-tier Clos · ${fmt(counts.scaleOutPorts)} ports · ${fmt(counts.scaleOutLinks)} links`) : zh ? `RoCE 参数面 · ${counts.scaleOutTiers} 层 Clos · ${fmt(counts.scaleOutPorts)} 口 · ${fmt(counts.scaleOutLinks)} 条链路` : `RoCE parameter plane · ${counts.scaleOutTiers}-tier Clos · ${fmt(counts.scaleOutPorts)} ports · ${fmt(counts.scaleOutLinks)} links`;
  if (t.scaleOut) {
    const c = closTiers(counts, lang, 16, y, 520, soLabel);
    parts.push(<g key="clos">{c.svg}</g>);
    y = c.bottom + 10;
  }
  const detailX = W - 206;
  if (!sp) {
    // A2: cabinets of servers under the leaf tier
    const cabTotal = counts.racks;
    const shown = Math.min(cabTotal, 6);
    const npc = counts.nodesPerRack;
    parts.push(<Txt key="ct" x={16} y={y + 10} cls="tp-h">{zh ? `计算机柜 × ${fmt(cabTotal)}（每柜 ${npc} 台服务器 · ${npc * counts.gpusPerNode} NPU）` : `compute cabinets × ${fmt(cabTotal)} (${npc} servers · ${npc * counts.gpusPerNode} NPUs each)`}</Txt>);
    const cy = y + 18;
    for (let i = 0; i < shown; i++) {
      const cx = 16 + i * 84;
      parts.push(<rect key={`cab${i}`} x={cx} y={cy} width={74} height={150} rx={4} className="tp-cab" />);
      for (let k = 0; k < npc && k < 12; k++) parts.push(<rect key={`s${i}-${k}`} x={cx + 6} y={cy + 8 + k * (134 / Math.min(npc, 12))} width={62} height={Math.max(6, 134 / Math.min(npc, 12) - 4)} rx={2} className="tp-server" />);
      if (t.scaleOut) for (const d of [0, 1]) parts.push(<line key={`w${i}-${d}`} x1={cx + 25 + d * 24} y1={cy} x2={73 + ((i * 2 + d) % 14) * 26} y2={y - 14} className="tp-wire-roce" />);
    }
    if (cabTotal > shown) parts.push(<Txt key="more" x={16 + shown * 84 + 4} y={cy + 80}>…</Txt>);
    parts.push(<NodeDetail key="nd" x={detailX} y={cy - 4} npus={counts.gpusPerNode} cpus={Math.round(counts.cpus / Math.max(1, counts.nodes))} l1={0} ports={(t.scaleOut?.portsPerNpu ?? 1) * counts.gpusPerNode} lang={lang} ub={false} />);
    y = cy + 170;
    parts.push(<Txt key="sum" x={16} y={y}>{zh ? `${fmt(counts.gpus)} NPU · ${fmt(counts.nodes)} 台服务器 · ${fmt(counts.cpus)} CPU · ${fmt(counts.racks)} 柜 · ${fmt(counts.scaleOutSwitches)} 台 RoCE 交换机 · ${fmt(counts.scaleOutTransceivers)} 个光模块` : `${fmt(counts.gpus)} NPUs · ${fmt(counts.nodes)} servers · ${fmt(counts.cpus)} CPUs · ${fmt(counts.racks)} cabinets · ${fmt(counts.scaleOutSwitches)} RoCE switches · ${fmt(counts.scaleOutTransceivers)} transceivers`}</Txt>);
    y += 14;
  } else {
    // A3 / Atlas 950: one SuperPoD drawn, the others stacked behind it; every position is computed so the box fits its content
    const podNpus = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks;
    const pods = counts.supernodes;
    const stack = Math.min(2, pods - 1);
    parts.push(<Txt key="pt" x={16} y={y + 10} cls="tp-h ub-t">{zh ? `超节点 × ${fmt(pods)}（每个 ${fmt(podNpus)} NPU · ${sp.computeRacks} 计算柜 + ${sp.commRacks} 通信柜）` : `SuperPoDs × ${fmt(pods)} (${fmt(podNpus)} NPUs · ${sp.computeRacks} compute + ${sp.commRacks} comm. cabinets each)`}</Txt>);
    const boxX = 16 + stack * 6, boxY = y + 24 + stack * 6, boxW = 500;
    const comp = sp.computeRacks;
    const cols = Math.min(16, comp);
    const rowsN = Math.min(4, Math.ceil(comp / cols));
    const cw = (boxW - 40) / cols - 4;
    const ch = comp <= 16 ? 64 : 22;
    const gridTop = boxY + 14;
    const gridBottom = gridTop + rowsN * (ch + 4);
    const inner: ReactNode[] = [];
    for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= comp) break;
      const cx = boxX + 20 + c * (cw + 4), cyy = gridTop + r * (ch + 4);
      inner.push(<rect key={`cc${i}`} x={cx} y={cyy} width={cw} height={ch} rx={2} className="tp-cab" />);
      if (comp <= 16) for (let k = 0; k < sp.nodesPerRack && k < 8; k++) inner.push(<rect key={`cn${i}-${k}`} x={cx + 3} y={cyy + 4 + k * ((ch - 8) / Math.min(sp.nodesPerRack, 8))} width={cw - 6} height={Math.max(4, (ch - 8) / Math.min(sp.nodesPerRack, 8) - 3)} rx={1} className="tp-server" />);
    }
    if (comp > cols * rowsN) inner.push(<Txt key="cmore" x={boxX + boxW - 16} y={gridBottom - 8}>…</Txt>);
    inner.push(<Txt key="cl" x={boxX + 20} y={gridBottom + 12}>{zh ? `${comp} 个计算柜 · 每柜 ${sp.nodesPerRack} 节点 / ${sp.nodesPerRack * sp.npusPerNode} NPU` : `${comp} compute cabinets · ${sp.nodesPerRack} nodes / ${sp.nodesPerRack * sp.npusPerNode} NPUs each`}</Txt>);
    // UB fabric: every compute cabinet reaches every communication cabinet (L2 sub-planes)
    const commTop = gridBottom + 46;
    const commShown = Math.min(sp.commRacks, 8);
    const commW = 52, commGap = 6;
    for (let i = 0; i < commShown; i++) {
      const cx = boxX + 20 + i * (commW + commGap);
      inner.push(<rect key={`cm${i}`} x={cx} y={commTop} width={commW} height={28} rx={3} className="tp-comm" />);
      for (let k = 0; k < Math.min(sp.subPlanes, 7); k++) inner.push(<line key={`sp${i}-${k}`} x1={cx + 5 + k * 7} y1={commTop + 3} x2={cx + 5 + k * 7} y2={commTop + 25} className="tp-wire-ub" />);
    }
    if (sp.commRacks > commShown) inner.push(<Txt key="cmm" x={boxX + 20 + commShown * (commW + commGap) + 2} y={commTop + 18}>…</Txt>);
    for (let k = 0; k < 8; k++) inner.push(<line key={`fan${k}`} x1={boxX + 34 + k * ((boxW - 60) / 7)} y1={gridBottom + 18} x2={boxX + 20 + commW / 2 + (k % Math.max(1, commShown)) * (commW + commGap)} y2={commTop} className="tp-wire-ub" />);
    inner.push(<Txt key="cml" x={boxX + 20} y={commTop + 44}>{zh ? `${sp.commRacks} 个通信柜（L2）` : `${sp.commRacks} communication cabinets (L2)`}</Txt>);
    inner.push(<Txt key="fl" x={boxX + 20} y={commTop + 60} cls="tp-s ub-t">{zh ? `UB 交换：${sp.subPlanes} 个子平面 × ${sp.l2PerSubPlane} 片 L2（${sp.l2Ports} 口）；每片 L1 ${sp.linksPerL1} 条光链路` : `UB switching: ${sp.subPlanes} sub-planes × ${sp.l2PerSubPlane} L2 chips (${sp.l2Ports} ports); ${sp.linksPerL1} optical links per L1 chip`}</Txt>);
    const boxH = commTop + 72 - boxY;
    for (let k = stack; k >= 1; k--) parts.push(<rect key={`shadow${k}`} x={boxX - k * 6} y={boxY - k * 6} width={boxW} height={boxH} rx={8} className="tp-pod tp-pod-back" />);
    parts.push(<rect key="pod" x={boxX} y={boxY} width={boxW} height={boxH} rx={8} className="tp-pod" />);
    parts.push(<g key="inner">{inner}</g>);
    parts.push(<NodeDetail key="nd" x={detailX} y={boxY} npus={sp.npusPerNode} cpus={sp.cpusPerNode} l1={sp.l1PerNode} ports={(t.scaleOut?.portsPerNpu ?? sp.rdmaPortsPerNpu) * sp.npusPerNode} lang={lang} ub />);
    y = Math.max(boxY + boxH, boxY + 156) + 20;
    parts.push(<Txt key="sum" x={16} y={y}>{zh ? `${fmt(counts.gpus)} NPU · ${fmt(counts.nodes)} 节点 · ${fmt(counts.racks)} 计算柜 + ${fmt(counts.commRacks)} 通信柜 · ${fmt(counts.l1Switches)} L1 + ${fmt(counts.l2Switches)} L2 · ${fmt(counts.opticalLinks)} 条 UB 光链路` : `${fmt(counts.gpus)} NPUs · ${fmt(counts.nodes)} nodes · ${fmt(counts.racks)} compute + ${fmt(counts.commRacks)} comm. cabinets · ${fmt(counts.l1Switches)} L1 + ${fmt(counts.l2Switches)} L2 · ${fmt(counts.opticalLinks)} UB optical links`}</Txt>);
    y += 14;
  }
  const H = y + 6;
  return (
    <div className="table-wrap">
      <svg className="topo-pic" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={zh ? '拓扑示意图' : 'topology schematic'} style={{ minWidth: 620 }}>
        {parts}
      </svg>
    </div>
  );
}
