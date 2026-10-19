#!/usr/bin/env node
/**
 * Build docs/ASCEND_CLUSTER_ARCHITECTURE.{zh,en}.html: typical Ascend AI-cluster architectures (cluster → SuperPoD → cabinet → node
 * → NPU), the three generations of topology (8-NPU RoCE servers, the 384-NPU UB supernode, the 10k-class UB 2.0 SuperPoD), the
 * CloudMatrix384 UB fabric and its three planes, and where the 18 domains of the 54-event reference catalog sit in that
 * architecture. Every number is taken from docs/ASCEND_SOURCES.md (library records with URL and confidence), from the search
 * summaries listed in the source table, or from docs/ascend-architecture/counts.json (scripts/ascend-architecture-counts.ts,
 * HAC-D's computeCounts with the cloudmatrix384 / atlas950 presets). Standalone SVGs go to docs/ascend-architecture/.
 * Usage: node scripts/build-ascend-architecture.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const C = JSON.parse(readFileSync('docs/ascend-architecture/counts.json', 'utf8'));
const OUT_DIR = 'docs/ascend-architecture';
mkdirSync(OUT_DIR, { recursive: true });
const DATE = C.generated.slice(0, 10);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const dom = Object.fromEntries(C.domains.map((d) => [d.id, d]));
const pod = C.perPod.cm384, pod950 = C.perPod.atlas950, k100 = C.at100k;
const P = C.presets.cloudmatrix384.values, P950 = C.presets.atlas950.values;
const flagsOf = (d) => [['replay', 'r'], ['process', 'p'], ['elastic', 'e'], ['predict', 'P'], ['netfail', 'n'], ['hotswap', 'h']].filter(([k]) => d.flags[k] > 0).map(([, l]) => l).join('/');
const fit = (id) => dom[id].fit.toFixed(1);

/* ---------- text measurement and wrapping ---------- */
const CJK = /[⺀-鿿　-〿＀-￯]/;
// calibrated against the rendered PDF (system-ui / PingFang): CJK 1 em, capitals and digits ≈ 0.66 em, lower case ≈ 0.56 em
const cw = (ch, fs, mono) => (CJK.test(ch) ? fs : mono ? fs * 0.62 : /[A-Z0-9#%@&≈≤≥×→µ‰²⁹]/.test(ch) ? fs * 0.66 : /[ilj.,;:'|!()\[\] ]/.test(ch) ? fs * 0.33 : fs * 0.56);
const tw = (s, fs = 11, mono = false) => Array.from(s).reduce((a, ch) => a + cw(ch, fs, mono), 0);
function wrap(text, maxW, fs = 11, mono = false) {
  const toks = text.match(/[⺀-鿿　-〿＀-￯]|[^\s⺀-鿿　-〿＀-￯]+|\s+/g) ?? [];
  const lines = [];
  let cur = '';
  for (const t of toks) {
    if (/^\s+$/.test(t)) { if (cur) cur += ' '; continue; }
    const cand = cur + t;
    if (tw(cand, fs, mono) <= maxW || !cur.trim()) { cur = cand; continue; }
    lines.push(cur.trimEnd());
    cur = t;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  for (let i = 1; i < lines.length; i++) { const m = lines[i].match(/^[，。；：、）)」%]+/); if (m) { lines[i - 1] += m[0]; lines[i] = lines[i].slice(m[0].length); } }
  return lines.filter(Boolean);
}
const lines = (x, y, ls, cls, lh, anchor = 'start') => ls.map((ln, i) => `<text x="${x}" y="${(y + i * lh).toFixed(1)}" class="${cls}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(ln)}</text>`).join('');

/* ---------- SVG style (validated palette of the earlier reports; light and dark) ---------- */
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const LIGHT = '--surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --b1:#e8f0fb; --b2:#fdece4; --b3:#e4f6ee; --b4:#fdf3dc; --b5:#f0efec; --b6:#fce8f0; --mid:#f0efec;';
const DARK = '--surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#46463f; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --b1:#1f2d44; --b2:#3d2619; --b3:#1b3328; --b4:#3a2f17; --b5:#2a2a28; --b6:#3a1f2b; --mid:#383835;';
const STYLE = `
svg.viz { ${LIGHT} font-family:${FONT}; }
@media (prefers-color-scheme: dark) { svg.viz { ${DARK} } }
:root[data-theme="light"] svg.viz { ${LIGHT} }
:root[data-theme="dark"] svg.viz { ${DARK} }
svg.viz text { fill: var(--ink); font-size: 11px; } svg.viz .ttl { font-size: 13px; font-weight: 600; } svg.viz .h { font-size: 11.5px; font-weight: 700; }
svg.viz .t2 { fill: var(--ink2); font-size: 11px; } svg.viz .s { fill: var(--ink2); font-size: 9.8px; } svg.viz .m { fill: var(--muted); font-size: 9.8px; } svg.viz .num { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
svg.viz .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 10px; fill: var(--ink2); }
svg.viz .ub-t { fill: var(--s3); } svg.viz .rdma-t { fill: var(--s2); } svg.viz .npu-t { fill: var(--s1); } svg.viz .vpc-t { fill: var(--s4); }
svg.viz .panel { fill: var(--surface); stroke: var(--grid); stroke-width: 1; } svg.viz .frame { fill: var(--surface); stroke: var(--axis); stroke-width: 1; }
svg.viz .npu { fill: var(--b1); stroke: var(--s1); stroke-width: 1; } svg.viz .ub { fill: var(--b3); stroke: var(--s3); stroke-width: 1; } svg.viz .rdma { fill: var(--b2); stroke: var(--s2); stroke-width: 1; }
svg.viz .vpc { fill: var(--b4); stroke: var(--s4); stroke-width: 1; } svg.viz .cpu { fill: var(--b5); stroke: var(--axis); stroke-width: 1; } svg.viz .fac { fill: var(--b6); stroke: var(--s5); stroke-width: 1; }
svg.viz .slab { fill: var(--surface); stroke: var(--s1); stroke-width: 1; } svg.viz .hl { fill: none; stroke: var(--ink); stroke-width: 1.7; }
svg.viz .l-ub { stroke: var(--s3); stroke-width: 0.7; fill: none; } svg.viz .l-rdma { stroke: var(--s2); stroke-width: 0.8; fill: none; } svg.viz .l-vpc { stroke: var(--s4); stroke-width: 1.2; fill: none; }
svg.viz .l-npu { stroke: var(--s1); fill: none; } svg.viz .zoom { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; fill: none; } svg.viz .dash { fill: none; stroke: var(--axis); stroke-width: 1; stroke-dasharray: 4 3; }
svg.viz .pod { fill: none; stroke: var(--s3); stroke-width: 1.4; } svg.viz .axis { stroke: var(--axis); stroke-width: 1; } svg.viz .grid { stroke: var(--grid); stroke-width: 1; }
svg.viz .halo { paint-order: stroke; stroke: var(--surface); stroke-width: 3.4px; stroke-linejoin: round; }
`;
const svgOpen = (id, W, H, label) => `<svg class="viz" id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${STYLE}</style><rect width="${W}" height="${H}" fill="var(--surface)" rx="8"/>`;
function legend(x, y, items, maxX = 946) {
  let g = '', cx = x, cy = y;
  for (const it of items) {
    const w = 18 + tw(it.label, 9.8) + 16;
    if (cx + w > maxX) { cx = x; cy += 16; }
    g += `<rect x="${cx}" y="${cy - 8}" width="12" height="10" rx="2" class="${it.cls}"/><text x="${cx + 17}" y="${cy + 1}" class="s">${esc(it.label)}</text>`;
    cx += w;
  }
  return { g, y: cy };
}

function titleBlock(label) { const ls = wrap(label, 930, 13 * 1.05); return { svg: lines(14, 22, ls, 'ttl', 17), dy: (ls.length - 1) * 17 }; }
function page(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const LEG = [
    { cls: 'npu', label: T('NPU / 计算', 'NPU / compute') }, { cls: 'ub', label: T('UB 互联（scale-up）', 'UB fabric (scale-up)') }, { cls: 'rdma', label: T('RDMA / RoCE / UBoE（scale-out）', 'RDMA / RoCE / UBoE (scale-out)') },
    { cls: 'vpc', label: T('VPC / 存储 / 管理', 'VPC / storage / management') }, { cls: 'cpu', label: T('CPU / HBM', 'CPU / HBM') }, { cls: 'fac', label: T('供电 / 冷却', 'power / cooling') },
  ];

  /* ---------- figure 1: five levels with zoom ---------- */
  function fig1() {
    const W = 960, top = 60, ph = 196, PW = 178, GAP = 9, X0 = 14;
    const px = (i) => X0 + i * (PW + GAP);
    const label = T('图 1 · 昇腾 AI 集群的五级结构：集群 → 超节点 → 计算柜 → 节点 → NPU（以 CloudMatrix384 为主，括注 Atlas 950 / 960）', 'Figure 1 · The five levels of an Ascend AI cluster: cluster → SuperPoD → compute cabinet → node → NPU (CloudMatrix384 geometry, with Atlas 950 / 960 in the notes)');
    const titles = [T('① 集群 SuperCluster', '① Cluster · SuperCluster'), T('② 超节点 SuperPoD', '② SuperPoD (supernode)'), T('③ 计算柜', '③ Compute cabinet'), T('④ 节点（服务器）', '④ Node (server)'), T('⑤ NPU（910C）', '⑤ NPU package (910C)')];
    const notes = [
      T(['CM384：≤ 16.5 万 NPU（约 430 个超节点）', '950：64 × 8,192 = 524,288 NPU', '960：> 100 万 NPU', '960E：两层四平面 Clos，51.2 万 NPU'], ['CM384: ≤ 165,000 NPUs (≈ 430 supernodes)', '950: 64 × 8,192 = 524,288 NPUs', '960: > 1 million NPUs', '960E: two-tier four-plane Clos, 512,000 NPUs']),
      T(['CM384：48 节点，384 NPU + 192 CPU', '16 柜 = 12 计算 + 4 通信（L2）', '950：160 柜 = 128 + 32，8,192 NPU', '960：220 柜 = 176 + 44，15,488 NPU'], ['CM384: 48 nodes, 384 NPUs + 192 CPUs', '16 cabinets = 12 compute + 4 comm. (L2)', '950: 160 = 128 + 32 cabinets, 8,192 NPUs', '960: 220 = 176 + 44 cabinets, 15,488 NPUs']),
      T(['CM384：4 节点 = 32 NPU / 柜', '950：64 NPU / 柜；960：约 88（推算）', '计算柜液冷、通信柜风冷（规格汇总站）', '柜级事件 = 整柜卡数'], ['CM384: 4 nodes = 32 NPUs per cabinet', '950: 64 per cabinet; 960: ≈ 88 (derived)', 'compute cabinets liquid-cooled, comm. air-cooled (aggregator)', 'a cabinet event takes all its cards']),
      T(['8 NPU（16 die）+ 4 鲲鹏 CPU', '7 片板载 L1 UB 交换芯片', '上行 112 条 = 8 × 14（无阻塞）', '擎天卡：VPC 面 ≤ 400 Gb/s'], ['8 NPUs (16 dies) + 4 Kunpeng CPUs', '7 on-board UB L1 switch chips', '112 uplinks = 8 × 14 (non-blocking)', 'Qingtian card: VPC plane ≤ 400 Gb/s']),
      T(['2 die、8 个 HBM 堆栈', '每 die 7 条 UB + 1 个 RDMA', 'UB：14 × 28 GB/s = 392 GB/s', 'RDMA：400 Gb/s / NPU'], ['2 dies, 8 HBM stacks', 'per die 7 UB links + 1 RDMA port', 'UB: 14 × 28 GB/s = 392 GB/s', 'RDMA: 400 Gb/s per NPU']),
    ];
    let g = '';
    titles.forEach((t, i) => { g += `<rect x="${px(i)}" y="${top}" width="${PW}" height="${ph}" rx="8" class="panel"/><text x="${px(i) + 4}" y="${top - 8}" class="h">${esc(t)}</text>`; });
    // ① cluster: leaf / spine and SuperPoDs
    { const x0 = px(0);
      g += `<text x="${x0 + 8}" y="${top + 26}" class="m">spine</text><text x="${x0 + 8}" y="${top + 73}" class="m">leaf</text>`;
      const sp = [0, 1, 2, 3].map((k) => ({ x: x0 + 52 + k * 31, y: top + 16, w: 24, h: 12 }));
      const lf = [0, 1, 2, 3, 4, 5].map((k) => ({ x: x0 + 46 + k * 21.5, y: top + 63, w: 16, h: 11 }));
      const pods = [0, 1, 2, 3, 4, 5].map((k) => ({ x: x0 + 12 + k * 27, y: top + 126, w: 21, h: 36 }));
      for (const l of lf) for (const s of sp) g += `<line x1="${l.x + l.w / 2}" y1="${l.y}" x2="${s.x + s.w / 2}" y2="${s.y + s.h}" class="l-rdma" opacity="0.7"/>`;
      pods.forEach((p, k) => { const l = lf[k]; g += `<line x1="${p.x + p.w / 2}" y1="${p.y}" x2="${l.x + l.w / 2}" y2="${l.y + l.h}" class="l-rdma"/>`; });
      g += sp.map((s) => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="2" class="rdma"/>`).join('') + lf.map((l) => `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="2" class="rdma"/>`).join('');
      g += `<text x="${x0 + PW / 2}" y="${top + 104}" text-anchor="middle" class="s halo">${esc(T('scale-out：RoCE 或 UBoE', 'scale-out: RoCE or UBoE'))}</text>`;
      for (const p of pods) { g += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3" class="ub"/>`; for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) g += `<rect x="${p.x + 4 + c * 8}" y="${p.y + 6 + r * 9}" width="5" height="5" class="npu"/>`; }
      g += `<text x="${x0 + PW / 2}" y="${top + 184}" text-anchor="middle" class="s">${esc(T('SuperPoD × N', 'SuperPoD × N'))}</text>`;
      const h = pods[5]; g += `<rect x="${h.x - 2}" y="${h.y - 2}" width="${h.w + 4}" height="${h.h + 4}" rx="4" class="hl"/>`;
      g += `<line x1="${h.x + h.w + 2}" y1="${h.y - 2}" x2="${px(1)}" y2="${top}" class="zoom"/><line x1="${h.x + h.w + 2}" y1="${h.y + h.h + 2}" x2="${px(1)}" y2="${top + ph}" class="zoom"/>`;
    }
    // ② SuperPoD: 12 compute cabinets, 4 communication cabinets with the L2 switches
    { const x0 = px(1);
      const cab = []; for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) cab.push({ x: x0 + 10 + c * 21.5, y: top + 20 + r * 52, w: 16, h: 42 });
      const comm = [0, 1, 2, 3].map((k) => ({ x: x0 + 146, y: top + 20 + k * 24, w: 24, h: 19 }));
      for (const a of cab) for (const b of comm) g += `<line x1="${a.x + a.w}" y1="${a.y + a.h / 2}" x2="${b.x}" y2="${b.y + b.h / 2}" class="l-ub" opacity="0.5"/>`;
      g += `<rect x="${x0 + 10}" y="${top + 140}" width="126" height="5" rx="2" class="rdma"/>`;
      for (let c = 0; c < 6; c++) g += `<line x1="${x0 + 18 + c * 21.5}" y1="${top + 114}" x2="${x0 + 18 + c * 21.5}" y2="${top + 140}" class="l-rdma"/>`;
      g += cab.map((a) => `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="2" class="npu"/>`).join('') + comm.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" class="ub"/><text x="${b.x + b.w / 2}" y="${b.y + 13}" text-anchor="middle" class="s">L2</text>`).join('');
      g += `<text x="${x0 + 10}" y="${top + 13}" class="s">${esc(T('计算柜 ×12', 'compute ×12'))}</text><text x="${x0 + 158}" y="${top + 128}" text-anchor="middle" class="s">${esc(T('通信 ×4', 'comm ×4'))}</text>`;
      g += `<text x="${x0 + 10}" y="${top + 160}" class="s">${esc(T('RDMA 面 → 其他超节点', 'RDMA plane → other SuperPoDs'))}</text><text x="${x0 + 10}" y="${top + 176}" class="s ub-t">${esc(T('UB：每柜连全部 4 个通信柜', 'UB: every cabinet to all 4 comm.'))}</text>`;
      const h = cab[11]; g += `<rect x="${h.x - 2}" y="${h.y - 2}" width="${h.w + 4}" height="${h.h + 4}" rx="3" class="hl"/>`;
      g += `<line x1="${h.x + h.w + 2}" y1="${h.y - 2}" x2="${px(2)}" y2="${top}" class="zoom"/><line x1="${h.x + h.w + 2}" y1="${h.y + h.h + 2}" x2="${px(2)}" y2="${top + ph}" class="zoom"/>`;
    }
    // ③ compute cabinet: power shelf, 4 node slabs, liquid cooling
    { const x0 = px(2);
      g += `<rect x="${x0 + 30}" y="${top + 8}" width="112" height="178" rx="4" class="frame"/>`;
      g += `<rect x="${x0 + 36}" y="${top + 14}" width="100" height="14" rx="2" class="fac"/><text x="${x0 + 86}" y="${top + 24.5}" text-anchor="middle" class="s">${esc(T('供电', 'power'))}</text>`;
      const slabs = [0, 1, 2, 3].map((k) => ({ x: x0 + 36, y: top + 36 + k * 35, w: 100, h: 29 }));
      g += `<line x1="${x0 + 154}" y1="${top + 14}" x2="${x0 + 154}" y2="${top + 172}" stroke="var(--s1)" stroke-width="2.6"/>`;
      for (const s of slabs) { g += `<line x1="${s.x + s.w}" y1="${s.y + s.h / 2}" x2="${x0 + 154}" y2="${s.y + s.h / 2}" stroke="var(--s1)" stroke-width="1.3"/><rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="2" class="slab"/>`; for (let j = 0; j < 8; j++) g += `<rect x="${s.x + 6 + j * 11.6}" y="${s.y + 10}" width="9" height="9" class="npu"/>`; }
      g += `<text x="${x0 + 86}" y="${top + 182}" text-anchor="middle" class="s">${esc(T('4 节点 × 8 NPU', '4 nodes × 8 NPUs'))}</text><text x="${x0 + 154}" y="${top + 186}" text-anchor="middle" class="s">${esc(T('液冷', 'cooling'))}</text>`;
      const h = slabs[2]; g += `<rect x="${h.x - 2}" y="${h.y - 2}" width="${h.w + 4}" height="${h.h + 4}" rx="3" class="hl"/>`;
      g += `<line x1="${h.x + h.w + 2}" y1="${h.y - 2}" x2="${px(3)}" y2="${top}" class="zoom"/><line x1="${h.x + h.w + 2}" y1="${h.y + h.h + 2}" x2="${px(3)}" y2="${top + ph}" class="zoom"/>`;
    }
    // ④ node: 8 NPUs with RDMA ports, 7 L1 UB chips, 4 CPUs, Qingtian card
    { const x0 = px(3);
      g += `<rect x="${x0 + 8}" y="${top + 6}" width="162" height="184" rx="4" class="frame"/>`;
      const npus = []; for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) npus.push({ x: x0 + 18 + c * 38, y: top + 16 + r * 40, w: 30, h: 30 });
      g += `<line x1="${x0 + 18}" y1="${top + 96}" x2="${x0 + 160}" y2="${top + 96}" stroke="var(--s3)" stroke-width="2"/>`;
      for (const n of npus) g += `<line x1="${n.x + 15}" y1="${n.y + n.h}" x2="${n.x + 15}" y2="${top + 96}" class="l-ub"/>`;
      for (const n of npus) g += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="3" class="npu"/><circle cx="${n.x + 9}" cy="${n.y}" r="2.4" class="rdma"/><circle cx="${n.x + 21}" cy="${n.y}" r="2.4" class="rdma"/>`;
      for (let c = 0; c < 7; c++) g += `<rect x="${x0 + 18 + c * 20.6}" y="${top + 102}" width="16" height="13" rx="2" class="ub"/>`;
      g += `<text x="${x0 + 16}" y="${top + 128}" class="s ub-t">${esc(T('L1 UB 交换芯片 ×7（板载）', 'UB L1 switch ×7 (on board)'))}</text>`;
      for (let c = 0; c < 4; c++) g += `<rect x="${x0 + 18 + c * 22}" y="${top + 140}" width="18" height="14" rx="2" class="cpu"/>`;
      g += `<rect x="${x0 + 110}" y="${top + 140}" width="52" height="14" rx="2" class="vpc"/><text x="${x0 + 136}" y="${top + 150.5}" text-anchor="middle" class="s">${esc(T('擎天卡', 'Qingtian'))}</text>`;
      g += `<text x="${x0 + 16}" y="${top + 168}" class="s">${esc(T('鲲鹏 CPU ×4', 'Kunpeng CPU ×4'))}</text><text x="${x0 + 110}" y="${top + 168}" class="s vpc-t">${esc(T('VPC 面', 'VPC plane'))}</text>`;
      g += `<text x="${x0 + 16}" y="${top + 183}" class="s rdma-t">${esc(T('● 每 die 一个 RDMA 口', '● one RDMA port per die'))}</text>`;
      const h = npus[3]; g += `<rect x="${h.x - 2}" y="${h.y - 2}" width="${h.w + 4}" height="${h.h + 4}" rx="4" class="hl"/>`;
      g += `<line x1="${h.x + h.w + 2}" y1="${h.y - 2}" x2="${px(4)}" y2="${top}" class="zoom"/><line x1="${h.x + h.w + 2}" y1="${h.y + h.h + 2}" x2="${px(4)}" y2="${top + ph}" class="zoom"/>`;
    }
    // ⑤ NPU package: two dies, 8 HBM stacks, 7 UB + 1 RDMA per die
    { const x0 = px(4);
      g += `<rect x="${x0 + 10}" y="${top + 8}" width="158" height="176" rx="6" class="frame"/>`;
      for (let k = 0; k < 4; k++) g += `<rect x="${x0 + 16}" y="${top + 30 + k * 22}" width="16" height="18" rx="2" class="cpu"/><rect x="${x0 + 146}" y="${top + 30 + k * 22}" width="16" height="18" rx="2" class="cpu"/>`;
      g += `<text x="${x0 + 24}" y="${top + 25}" text-anchor="middle" class="m">HBM</text><text x="${x0 + 154}" y="${top + 25}" text-anchor="middle" class="m">HBM</text>`;
      [x0 + 38, x0 + 92].forEach((dx, i) => {
        g += `<rect x="${dx}" y="${top + 24}" width="48" height="92" rx="3" class="npu"/><text x="${dx + 24}" y="${top + 40}" text-anchor="middle" class="s">die ${i}</text>`;
        g += lines(dx + 24, top + 60, ['AI Core', 'SRAM', 'IO die'], 'm', 13, 'middle');
        for (let j = 0; j < 7; j++) g += `<rect x="${dx + 2 + j * 6}" y="${top + 122}" width="4.5" height="9" class="ub"/>`;
        g += `<rect x="${dx + 44}" y="${top + 122}" width="4.5" height="9" class="rdma"/>`;
      });
      g += `<rect x="${x0 + 86}" y="${top + 60}" width="6" height="20" fill="var(--s1)"/><text x="${x0 + 89}" y="${top + 20}" text-anchor="middle" class="m">D2D</text>`;
      g += `<text x="${x0 + 89}" y="${top + 148}" text-anchor="middle" class="s">${esc(T('每 die：7 × UB + 1 × RDMA', 'per die: 7 × UB + 1 × RDMA'))}</text><text x="${x0 + 89}" y="${top + 163}" text-anchor="middle" class="s">${esc(T('910C：2 die · 8 HBM', '910C: 2 dies · 8 HBM'))}</text>`;
    }
    let maxL = 0;
    notes.forEach((ns, i) => { const ls = ns.flatMap((n) => wrap(n, PW - 6, 9.8)); maxL = Math.max(maxL, ls.length); g += lines(px(i) + 3, top + ph + 18, ls, 's', 13.2); });
    const lg = legend(14, top + ph + 18 + maxL * 13.2 + 10, LEG);
    const H = lg.y + 14;
    const tb = titleBlock(label);
    return svgOpen('fig-levels', W, H + tb.dy, label) + tb.svg + `<g transform="translate(0 ${tb.dy})">` + g + lg.g + '</g></svg>';
  }

  /* ---------- figure 2: three generations of topology + scale-up domain size ---------- */
  function fig2() {
    const W = 960, top = 56, PW = 300, X0 = 14, GAP = 15;
    const px = (i) => X0 + i * (PW + GAP);
    const label = T('图 2 · 三代拓扑：8 卡服务器 + RoCE 组网（A2）→ 384 卡 UB 超节点（A3 / CloudMatrix384）→ 万卡级 UB 2.0 超节点（Atlas 950 / 960）', 'Figure 2 · Three generations of topology: 8-NPU servers on RoCE (A2) → 384-NPU UB supernode (A3 / CloudMatrix384) → 10k-class UB 2.0 SuperPoD (Atlas 950 / 960)');
    const titles = [T('A2 · 8 卡服务器 + RoCE 组网（910B）', 'A2 · 8-NPU servers + RoCE fabric (910B)'), T('A3 · 384 卡 UB 超节点（910C）', 'A3 · 384-NPU UB supernode (910C)'), T('950 / 960 · 万卡级 UB 2.0 超节点', '950 / 960 · 10k-class UB 2.0 SuperPoD')];
    const notes = [
      T(['产品：Atlas 800T A2 服务器（4U，8 × 910B，4 × 鲲鹏 920）、Atlas 900 A2 PoD', 'scale-up 域 = 1 台服务器（8 NPU，HCCS）', '每 NPU 一个 200GE RoCE 口直出（参数面）', '叶脊两层 Clos 为示意；交换机数本页来源未给'], ['products: Atlas 800T A2 server (4U, 8 × 910B, 4 × Kunpeng 920), Atlas 900 A2 PoD', 'scale-up domain = 1 server (8 NPUs, HCCS)', 'one 200GE RoCE port per NPU (parameter plane)', 'leaf–spine drawn schematically; switch counts not in these sources']),
      T(['产品：Atlas 900 A3 SuperPoD / CloudMatrix384', 'scale-up 域 = 384 NPU：L1 板载、L2 在 4 个通信柜，7 个子平面，无阻塞', '跨超节点：RDMA 面（RoCE），每 NPU 400 Gb/s', 'VPC 面：擎天卡（存储、管理、外部）'], ['products: Atlas 900 A3 SuperPoD / CloudMatrix384', 'scale-up domain = 384 NPUs: L1 on board, L2 in 4 comm. cabinets, 7 sub-planes, non-blocking', 'between SuperPoDs: RDMA plane (RoCE), 400 Gb/s per NPU', 'VPC plane: Qingtian card (storage, management, external)']),
      T(['柜间全光 UB 2.0：铜缆至多两柜，光 ≥ 200 m', '16.3 PB/s、2.1 µs；百纳秒级光路保护切换（厂商）', '960：15,488 NPU / 220 柜；960E：4,096 NPU，NPO 光引擎', 'SuperCluster：RoCE 或 UBoE；960E 为两层四平面 Clos'], ['all-optical UB 2.0 between cabinets: copper spans two cabinets at most, optics ≥ 200 m', '16.3 PB/s, 2.1 µs; 100-ns-level optical protection switching (vendor)', '960: 15,488 NPUs / 220 cabinets; 960E: 4,096 NPUs, NPO optical engines', 'SuperCluster: RoCE or UBoE; 960E uses a two-tier four-plane Clos']),
    ];
    const noteLines = notes.map((ns) => ns.flatMap((n) => wrap(n, PW - 24, 9.8)));
    const drawH = 196; // drawing area below the title
    const panelH = 22 + drawH + 16 + Math.max(...noteLines.map((l) => l.length)) * 13 + 8;
    let g = '';
    titles.forEach((t, i) => { g += `<rect x="${px(i)}" y="${top - 18}" width="${PW}" height="${panelH}" rx="8" class="panel"/><text x="${px(i) + 10}" y="${top - 2}" class="h">${esc(t)}</text>`; });
    const y0 = top + 6; // top of the drawing area
    // A2
    { const x0 = px(0);
      const sp = [0, 1, 2, 3].map((k) => ({ x: x0 + 34 + k * 64, y: y0 + 12, w: 40, h: 14 }));
      const lf = Array.from({ length: 8 }, (_, k) => ({ x: x0 + 20 + k * 34, y: y0 + 62, w: 24, h: 12 }));
      for (const l of lf) for (const s of sp) g += `<line x1="${l.x + l.w / 2}" y1="${l.y}" x2="${s.x + s.w / 2}" y2="${s.y + s.h}" class="l-rdma" opacity="0.55"/>`;
      const srv = [0, 1, 2, 3].map((k) => ({ x: x0 + 18 + k * 70, y: y0 + 118, w: 62, h: 60 }));
      srv.forEach((s, k) => { [2 * k, 2 * k + 1].forEach((li) => { const l = lf[li]; g += `<line x1="${s.x + s.w / 2}" y1="${s.y}" x2="${l.x + l.w / 2}" y2="${l.y + l.h}" class="l-rdma" stroke-width="1.6"/>`; }); });
      g += sp.map((s) => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="2" class="rdma"/>`).join('') + lf.map((l) => `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="2" class="rdma"/>`).join('');
      g += `<text x="${x0 + 10}" y="${y0 + 8}" class="m">spine</text><text x="${x0 + 10}" y="${y0 + 58}" class="m">leaf</text><text x="${x0 + PW / 2}" y="${y0 + 100}" text-anchor="middle" class="s rdma-t halo">${esc(T('RoCE 参数面：每台 8 × 200GE', 'RoCE parameter plane: 8 × 200GE per server'))}</text>`;
      for (const s of srv) {
        g += `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="3" class="frame"/><rect x="${s.x + 4}" y="${s.y + 7}" width="${s.w - 8}" height="34" rx="3" class="ub" opacity="0.65"/>`;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g += `<rect x="${s.x + 7 + c * 13}" y="${s.y + 10 + r * 15}" width="10" height="10" class="npu"/>`;
        for (let j = 0; j < 8; j++) g += `<circle cx="${s.x + 6 + j * 7.1}" cy="${s.y}" r="2" class="rdma"/>`;
        g += `<text x="${s.x + s.w / 2}" y="${s.y + 54}" text-anchor="middle" class="s ub-t">HCCS</text>`;
      }
      g += `<text x="${x0 + PW / 2}" y="${y0 + 194}" text-anchor="middle" class="s">${esc(T('服务器 × N（每台 8 NPU）', 'servers × N (8 NPUs each)'))}</text>`;
    }
    // A3 / CloudMatrix384
    { const x0 = px(1);
      g += `<rect x="${x0 + 8}" y="${y0 + 6}" width="54" height="30" rx="4" class="dash"/><rect x="${x0 + PW - 62}" y="${y0 + 6}" width="54" height="30" rx="4" class="dash"/><text x="${x0 + 35}" y="${y0 + 25}" text-anchor="middle" class="m">${esc(T('其他超节点', 'other pods'))}</text><text x="${x0 + PW - 35}" y="${y0 + 25}" text-anchor="middle" class="m">${esc(T('其他超节点', 'other pods'))}</text>`;
      const sp = [0, 1, 2].map((k) => ({ x: x0 + 98 + k * 40, y: y0 + 4, w: 30, h: 11 }));
      const lf = [0, 1, 2, 3, 4].map((k) => ({ x: x0 + 82 + k * 30, y: y0 + 30, w: 22, h: 10 }));
      for (const l of lf) for (const s of sp) g += `<line x1="${l.x + l.w / 2}" y1="${l.y}" x2="${s.x + s.w / 2}" y2="${s.y + s.h}" class="l-rdma" opacity="0.6"/>`;
      g += `<line x1="${x0 + 62}" y1="${y0 + 21}" x2="${sp[0].x}" y2="${sp[0].y + 6}" class="l-rdma"/><line x1="${x0 + PW - 62}" y1="${y0 + 21}" x2="${sp[2].x + sp[2].w}" y2="${sp[2].y + 6}" class="l-rdma"/>`;
      g += sp.map((s) => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="2" class="rdma"/>`).join('') + lf.map((l) => `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="2" class="rdma"/>`).join('');
      const box = { x: x0 + 12, y: y0 + 58, w: PW - 24, h: 134 };
      lf.forEach((l) => { g += `<line x1="${l.x + l.w / 2}" y1="${l.y + l.h}" x2="${l.x + l.w / 2}" y2="${box.y}" class="l-rdma"/>`; });
      g += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" class="pod"/><text x="${box.x + 8}" y="${box.y + 14}" class="s ub-t">${esc(T('UB 超节点 = 384 NPU', 'UB supernode = 384 NPUs'))}</text>`;
      const comm = [0, 1, 2, 3].map((k) => ({ x: x0 + 44 + k * 58, y: box.y + 24, w: 40, h: 22 }));
      const cab = Array.from({ length: 12 }, (_, k) => ({ x: x0 + 22 + k * 22, y: box.y + 82, w: 17, h: 42 }));
      for (const a of cab) for (const b of comm) g += `<line x1="${a.x + a.w / 2}" y1="${a.y}" x2="${b.x + b.w / 2}" y2="${b.y + b.h}" class="l-ub" opacity="0.5"/>`;
      g += comm.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" class="ub"/><text x="${b.x + b.w / 2}" y="${b.y + 15}" text-anchor="middle" class="s">L2</text>`).join('') + cab.map((a) => `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="2" class="npu"/>`).join('');
      g += `<text x="${box.x + box.w / 2}" y="${box.y + 60}" text-anchor="middle" class="s halo">${esc(T('4 个通信柜：7 子平面 × 16 片 L2', '4 comm. cabinets: 7 sub-planes × 16 L2'))}</text><text x="${box.x + box.w / 2}" y="${box.y + 76}" text-anchor="middle" class="s halo">${esc(T('12 个计算柜 × 32 NPU（L1 在节点板上）', '12 compute cabinets × 32 NPUs (L1 on the node boards)'))}</text>`;
    }
    // Atlas 950 / 960
    { const x0 = px(2);
      g += `<rect x="${x0 + 20}" y="${y0 + 6}" width="${PW - 40}" height="4" rx="2" class="rdma"/>`;
      const pods = [0, 1, 2, 3, 4, 5].map((k) => ({ x: x0 + 24 + k * 44, y: y0 + 20, w: 32, h: 18 }));
      for (const p of pods) g += `<line x1="${p.x + p.w / 2}" y1="${y0 + 10}" x2="${p.x + p.w / 2}" y2="${p.y}" class="l-rdma"/><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3" class="ub"/>`;
      g += `<text x="${x0 + PW / 2}" y="${y0 + 52}" text-anchor="middle" class="s rdma-t halo">${esc(T('SuperCluster：64 × SuperPoD（RoCE 或 UBoE）', 'SuperCluster: 64 × SuperPoD (RoCE or UBoE)'))}</text>`;
      const box = { x: x0 + 12, y: y0 + 62, w: PW - 24, h: 130 };
      const hp = pods[2];
      g += `<rect x="${hp.x - 2}" y="${hp.y - 2}" width="${hp.w + 4}" height="${hp.h + 4}" rx="4" class="hl"/>`;
      g += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" class="pod"/><text x="${box.x + 8}" y="${box.y + 14}" class="s ub-t">${esc(T('Atlas 950 SuperPoD = 8,192 NPU · 160 柜', 'Atlas 950 SuperPoD = 8,192 NPUs · 160 cabinets'))}</text>`;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 16; c++) g += `<rect x="${box.x + 10 + c * 13}" y="${box.y + 24 + r * 10}" width="11" height="8" class="npu"/>`;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) g += `<rect x="${box.x + 226 + c * 10.5}" y="${box.y + 24 + r * 10}" width="8.5" height="8" class="ub"/>`;
      g += `<text x="${box.x + 10}" y="${box.y + 118}" class="s">${esc(T('计算柜 ×128（64 NPU / 柜）', 'compute ×128 (64 NPUs each)'))}</text><text x="${box.x + box.w - 8}" y="${box.y + 118}" text-anchor="end" class="s ub-t">${esc(T('通信 ×32', 'comm ×32'))}</text>`;
    }
    noteLines.forEach((ls, i) => { g += lines(px(i) + 10, top + drawH + 22, ls, 's', 13); });
    // scale-up domain size strip
    const sy = top - 18 + panelH + 26, ax0 = 90, ax1 = 900, lmax = Math.log10(20000);
    const lx = (n) => ax0 + (Math.log10(n) / lmax) * (ax1 - ax0);
    g += `<text x="14" y="${sy}" class="h">${esc(T('scale-up 域大小（一个 UB / HCCS 域内的 NPU 数，对数轴）', 'Scale-up domain size (NPUs inside one UB / HCCS domain, log axis)'))}</text>`;
    const ay = sy + 46;
    g += `<line x1="${ax0}" y1="${ay}" x2="${ax1}" y2="${ay}" class="axis"/>`;
    for (const t of [1, 10, 100, 1000, 10000]) g += `<line x1="${lx(t)}" y1="${ay}" x2="${lx(t)}" y2="${ay + 5}" class="axis"/><text x="${lx(t)}" y="${ay + 17}" text-anchor="middle" class="m">${fmt(t)}</text>`;
    const marks = [
      { n: 8, t: T('A2 服务器 8', 'A2 server 8'), cls: 'npu', dy: -12 }, { n: 72, t: T('NVL72 = 72（参考）', 'NVL72 = 72 (reference)'), cls: 'ref', dy: -12 }, { n: 384, t: T('CM384 · 384', 'CM384 · 384'), cls: 'ub', dy: -12 },
      { n: 4096, t: T('960E 4,096', '960E 4,096'), cls: 'ub', dy: -26 }, { n: 8192, t: T('950 8,192', '950 8,192'), cls: 'ub', dy: -12 }, { n: 15488, t: T('960 15,488', '960 15,488'), cls: 'ub', dy: -26 },
    ];
    for (const m of marks) {
      const x = lx(m.n);
      g += m.cls === 'ref' ? `<circle cx="${x}" cy="${ay}" r="4.5" fill="var(--surface)" stroke="var(--muted)" stroke-width="1.4"/>` : `<circle cx="${x}" cy="${ay}" r="5.5" class="${m.cls}" stroke-width="1.6"/>`;
      g += `<line x1="${x}" y1="${ay + m.dy + 3}" x2="${x}" y2="${ay - 6}" class="grid"/><text x="${x}" y="${ay + m.dy}" text-anchor="middle" class="${m.cls === 'ref' ? 'm' : 's'}">${esc(m.t)}</text>`;
    }
    const H = ay + 30;
    const tb = titleBlock(label);
    return svgOpen('fig-generations', W, H + tb.dy, label) + tb.svg + `<g transform="translate(0 ${tb.dy})">` + g + '</g></svg>';
  }

  /* ---------- figure 3: CloudMatrix384 UB fabric and the three planes ---------- */
  function fig3() {
    const W = 960, top = 40, ph = 338;
    const label = T('图 3 · CloudMatrix384 的 UB 互联：节点内 die → L1（板载）、子平面内 L1 → L2（通信柜），以及每个节点的三个平面', 'Figure 3 · The CloudMatrix384 UB fabric: die → L1 inside the node (on board), L1 → L2 inside a sub-plane (communication cabinets), and the three planes of every node');
    let g = '';
    const blocks = [{ x: 14, w: 308, t: T('a · 一个节点（共 48 个）', 'a · One node (48 in total)') }, { x: 332, w: 330, t: T('b · 一个 UB 子平面（共 7 个）', 'b · One UB sub-plane (7 in total)') }, { x: 672, w: 274, t: T('c · 每个节点的三个平面（论文）', 'c · The three planes of a node (paper)') }];
    for (const b of blocks) g += `<rect x="${b.x}" y="${top}" width="${b.w}" height="${ph}" rx="8" class="panel"/><text x="${b.x + 10}" y="${top + 18}" class="h">${esc(b.t)}</text>`;
    // a: 8 NPUs × 2 dies → 7 L1 chips (112 links)
    { const x0 = 14;
      g += `<text x="${x0 + 10}" y="${top + 36}" class="m">${esc(T('8 NPU × 2 die = 16 die（橙点：每 die 1 个 RDMA 口）', '8 NPUs × 2 dies = 16 dies (orange: one RDMA port per die)'))}</text>`;
      const dies = [];
      for (let k = 0; k < 8; k++) { const nx = x0 + 10 + k * 37; g += `<rect x="${nx}" y="${top + 44}" width="34" height="48" rx="3" class="frame"/>`; for (let d = 0; d < 2; d++) dies.push({ x: nx + 3 + d * 15, y: top + 48, w: 13, h: 40 }); }
      const l1 = Array.from({ length: 7 }, (_, k) => ({ x: x0 + 12 + k * 42, y: top + 166, w: 36, h: 18 }));
      for (const d of dies) for (const l of l1) g += `<line x1="${d.x + d.w / 2}" y1="${d.y + d.h}" x2="${l.x + l.w / 2}" y2="${l.y}" class="l-ub" stroke-width="0.5" opacity="0.5"/>`;
      for (const d of dies) g += `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="2" class="npu"/><circle cx="${d.x + d.w / 2}" cy="${d.y}" r="2" class="rdma"/>`;
      g += l1.map((l, k) => `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="2" class="ub"/><text x="${l.x + l.w / 2}" y="${l.y + 12.5}" text-anchor="middle" class="s">L1-${k + 1}</text>`).join('');
      for (let c = 0; c < 4; c++) g += `<rect x="${x0 + 12 + c * 46}" y="${top + 202}" width="40" height="16" rx="2" class="cpu"/><text x="${x0 + 32 + c * 46}" y="${top + 213.5}" text-anchor="middle" class="s">CPU</text>`;
      g += `<rect x="${x0 + 200}" y="${top + 202}" width="96" height="16" rx="2" class="vpc"/><text x="${x0 + 248}" y="${top + 213.5}" text-anchor="middle" class="s">${esc(T('擎天卡', 'Qingtian card'))}</text>`;
      const notes = T(['16 die × 7 条 UB = 112 条，每 die 的 7 条各连一片 L1（由计数推得）', '每片 L1：16 条下行（16 die）+ 16 条上行（本子平面的 16 片 L2）', 'CPU 也接入 UB；上行总量 = 节点内 UB 容量（无阻塞）'], ['16 dies × 7 UB links = 112; each die’s 7 links go one to each L1 (derived from the counts)', 'each L1: 16 downlinks (16 dies) + 16 uplinks (the 16 L2 chips of its sub-plane)', 'the CPUs also attach to UB; total uplink = the node’s internal UB capacity (non-blocking)']);
      g += lines(x0 + 10, top + 240, notes.flatMap((n) => wrap(n, 286, 9.8)), 's', 13);
    }
    // b: one sub-plane: L1-k of 48 nodes ↔ 16 L2 chips, 7 stacked sub-planes
    { const x0 = 332;
      g += `<rect x="${x0 + 26}" y="${top + 42}" width="292" height="210" rx="6" class="dash"/><rect x="${x0 + 20}" y="${top + 36}" width="292" height="210" rx="6" class="dash"/><rect x="${x0 + 14}" y="${top + 30}" width="292" height="210" rx="6" class="frame" opacity="0.9"/>`;
      g += `<text x="${x0 + 300}" y="${top + 45}" text-anchor="end" class="s ub-t halo">${esc(T('× 7 个子平面', '× 7 sub-planes'))}</text>`;
      const rowsL = [1, 2, 3, 4, 5, 6, null, 48];
      const l1 = rowsL.map((n, r) => ({ n, x: x0 + 24, y: top + 52 + r * 23, w: 88, h: 15 }));
      const l2 = Array.from({ length: 16 }, (_, r) => ({ x: x0 + 238, y: top + 54 + r * 11.6, w: 58, h: 9.4 }));
      for (const a of l1) if (a.n) for (const b of l2) g += `<line x1="${a.x + a.w}" y1="${a.y + a.h / 2}" x2="${b.x}" y2="${b.y + b.h / 2}" class="l-ub" stroke-width="0.5" opacity="0.5"/>`;
      for (const a of l1) g += a.n ? `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="2" class="ub"/><text x="${a.x + a.w / 2}" y="${a.y + 11}" text-anchor="middle" class="s">${esc(T(`节点 ${a.n} · L1-k`, `node ${a.n} · L1-k`))}</text>` : `<text x="${a.x + a.w / 2}" y="${a.y + 11}" text-anchor="middle" class="s">⋮</text>`;
      g += l2.map((b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" class="ub"/><text x="${b.x + b.w / 2}" y="${b.y + 7.9}" text-anchor="middle" class="m" style="font-size:8.4px">L2-${r + 1}</text>`).join('');
      const notes = T(['每片 L1 → 本子平面 16 片 L2 各 1 条；每片 L2 有 48 口 = 48 个节点', '768 条链路 / 子平面；全部 L2 端口用满，无备用口', '链路或 L2 故障：该子平面少 1/16 带宽（热点，不是断连）'], ['each L1 → one link to each of its sub-plane’s 16 L2 chips; each L2 has 48 ports = 48 nodes', '768 links per sub-plane; every L2 port in use, no spare ports', 'a link or L2 fault removes 1/16 of that sub-plane’s bandwidth (a hotspot, not a disconnection)']);
      g += lines(x0 + 14, top + 270, notes.flatMap((n) => wrap(n, 304, 9.8)), 's', 12.6);
    }
    // c: three planes
    { const x0 = 672;
      const node = { x: x0 + 12, y: top + 128, w: 56, h: 64 };
      g += `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="4" class="frame"/><text x="${node.x + node.w / 2}" y="${node.y + 14}" text-anchor="middle" class="s">${esc(T('节点', 'node'))}</text>`;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) g += `<rect x="${node.x + 6 + c * 11.5}" y="${node.y + 22 + r * 13}" width="9" height="9" class="npu"/>`;
      g += `<rect x="${node.x + 6}" y="${node.y + 50}" width="44" height="8" rx="2" class="vpc"/>`;
      const planes = [
        { cls: 'ub', l: 'l-ub', t: T(['UB 平面（scale-up）', '超节点内 384 NPU + 192 CPU', '每 NPU 14 × 28 GB/s = 392 GB/s'], ['UB plane (scale-up)', '384 NPUs + 192 CPUs in the supernode', '14 × 28 GB/s = 392 GB/s per NPU']) },
        { cls: 'rdma', l: 'l-rdma', t: T(['RDMA 平面（scale-out）', '跨超节点，RoCE，仅 NPU 参与', '每 die 1 口，每 NPU 400 Gb/s'], ['RDMA plane (scale-out)', 'between supernodes, RoCE, NPUs only', 'one port per die, 400 Gb/s per NPU']) },
        { cls: 'vpc', l: 'l-vpc', t: T(['VPC 平面', '擎天卡（DPU）：存储、管理、外部', '每节点 ≤ 400 Gb/s'], ['VPC plane', 'Qingtian card (DPU): storage, management, external', '≤ 400 Gb/s per node']) },
      ];
      planes.forEach((p, i) => {
        const bx = x0 + 96, by = top + 34 + i * 76, bw = 166, bh = 66;
        g += `<path d="M${node.x + node.w} ${node.y + 16 + i * 16} C ${node.x + node.w + 14} ${node.y + 16 + i * 16}, ${bx - 14} ${by + bh / 2}, ${bx} ${by + bh / 2}" class="${p.l}" stroke-width="1.8"/>`;
        g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6" class="${p.cls}"/>`;
        const ls = p.t.flatMap((t, j) => wrap(t, bw - 14, j === 0 ? 10.6 : 9.8).map((x) => ({ x, j })));
        ls.forEach((o, j) => { g += `<text x="${bx + 7}" y="${by + 15 + j * 12.6}" class="${o.j === 0 ? 'h' : 's'}" style="${o.j === 0 ? 'font-size:10.6px' : ''}">${esc(o.x)}</text>`; });
      });
      g += lines(x0 + 12, top + 276, wrap(T('三个平面的故障属不同事件类，不可相加（论文结构；故障率无公开值）', 'faults on the three planes are different event classes and are never added (paper structure; no public failure rates)'), 250, 9.8), 's', 13);
    }
    // bottom: per-SuperPoD counts
    const chips = [
      { n: fmt(pod.l1Switches), t: T('片 L1 UB 芯片（48 × 7）', 'UB L1 chips (48 × 7)') }, { n: fmt(pod.l2Switches), t: T('片 L2 UB 芯片（7 × 16）', 'UB L2 chips (7 × 16)') }, { n: fmt(pod.opticalLinks), t: T('条 L1–L2 光链路（推算）', 'L1–L2 optical links (derived)') },
      { n: fmt(pod.transceivers), t: T('个链路端（每端一个光模块，假设）', 'link ends (one module per end, assumed)') }, { n: '6,912', t: T('个 400G LPO（第三方估计，scan-level）', '400G LPO modules (third-party, scan-level)') }, { n: '12 + 4', t: T('计算柜 + 通信柜', 'compute + comm. cabinets') },
    ];
    const cy = top + ph + 14, cwid = (932 - 5 * 8) / 6;
    g += `<text x="14" y="${cy + 6}" class="s">${esc(T('每个 CloudMatrix384 超节点：', 'Per CloudMatrix384 SuperPoD:'))}</text>`;
    let maxLines = 1;
    const chipLines = chips.map((c) => wrap(c.t, cwid - 12, 9.8));
    maxLines = Math.max(...chipLines.map((l) => l.length));
    chips.forEach((c, i) => { const x = 14 + i * (cwid + 8), y = cy + 14; g += `<rect x="${x}" y="${y}" width="${cwid}" height="${26 + maxLines * 12.4}" rx="6" class="${i < 2 ? 'ub' : i < 4 ? 'ub' : i === 4 ? 'rdma' : 'npu'}" opacity="0.9"/><text x="${x + 8}" y="${y + 18}" class="num">${esc(c.n)}</text>` + lines(x + 8, y + 32, chipLines[i], 's', 12.4); });
    const H = cy + 14 + 26 + maxLines * 12.4 + 12;
    const tb = titleBlock(label);
    return svgOpen('fig-ub-fabric', W, H + tb.dy, label) + tb.svg + `<g transform="translate(0 ${tb.dy})">` + g + '</g></svg>';
  }

  /* ---------- figure 4: the 54-event catalog's 18 domains on the architecture ---------- */
  function fig4() {
    const W = 960, x0 = 14, labelW = 126, gap = 8;
    const colW = Math.floor((W - 2 * x0 - labelW - 4 * gap) / 4);
    const label = T('图 4 · 54 条事件参考目录的 18 个硬件域落在昇腾架构的哪一层（FIT = 每 10⁹ 卡·小时的中断事件，业务影响口径；单元数取 CloudMatrix384 几何、10 万卡）', 'Figure 4 · Where the 18 hardware domains of the 54-event reference catalog sit in the Ascend architecture (FIT = interruptions per 10⁹ card-hours, business-impact 口径; unit counts with the CloudMatrix384 geometry at 100k cards)');
    const per = (id, k) => dom[id].perDevice[k];
    const cols = T(['① 目录事件域 · FIT / 卡 · 梯级', '② 单元数 @ 10 万卡', '③ 扇出与共因（一次事件停掉多少卡）', '④ 首先起作用的恢复（MindCluster / 目录）'], ['① Catalog domain · FIT per card · rungs', '② Unit counts at 100k cards', '③ Fan-out and common cause (cards stopped by one event)', '④ First recovery that applies (MindCluster / catalog)']);
    const rows = [
      { fill: 'npu', name: T('NPU 芯片与封装', 'NPU chip and package'), c: [
        [`CORE ${fit('CORE')} · SRAM ${fit('SRAM')} · IOD ${fit('IOD')}`, T(`MEMT ${fit('MEMT')} · MEMP ${fit('MEMP')}（HBM）`, `MEMT ${fit('MEMT')} · MEMP ${fit('MEMP')} (HBM)`), T(`梯级：${flagsOf(dom.CORE)}（MEMP：${flagsOf(dom.MEMP)}）`, `rungs: ${flagsOf(dom.CORE)} (MEMP: ${flagsOf(dom.MEMP)})`)],
        T([`${fmt(k100.cm384.gpus)} NPU = ${fmt(2 * k100.cm384.gpus)} die`, `${fmt(8 * k100.cm384.gpus)} 个 HBM 堆栈（8 / NPU）`], [`${fmt(k100.cm384.gpus)} NPUs = ${fmt(2 * k100.cm384.gpus)} dies`, `${fmt(8 * k100.cm384.gpus)} HBM stacks (8 per NPU)`]),
        T(['1 卡；同步训练中任一事件都停住整个作业'], ['1 card; in synchronous training any event stops the whole job']),
        T(['瞬态：算子级重执行（HCCL 重执行约 95 % 成功）', '片上内存 UCE：隔离 + step 重试（进程级在线恢复，默认关）', '持久：进程级重调度（需备机）'], ['transient: operator-level re-execution (HCCL re-execution ≈ 95 % success)', 'on-chip memory UCE: isolate + step retry (process-level online recovery, off by default)', 'persistent: process-level rescheduling (needs a standby server)']) ] },
      { fill: 'npu', name: T('模组 / 板级', 'Module / board'), c: [
        T([`MODULE ${fit('MODULE')}（HiAM 模组 / 板级连接）`, `梯级：${flagsOf(dom.MODULE)}`], [`MODULE ${fit('MODULE')} (HiAM module / board connection)`, `rungs: ${flagsOf(dom.MODULE)}`]),
        T(['按卡计（目录口径）'], ['per card (catalog 口径)']),
        T(['1 卡；同板波及未公开'], ['1 card; spread to the same board not public']),
        T(['进程级重调度或热替换（需备机）；无备机时弹性缩容'], ['process-level rescheduling or hot swap (needs a spare); without spares, elastic scale-in']) ] },
      { fill: 'cpu', name: T('节点 / 框内', 'Node / chassis'), c: [
        T([`CPU ${fit('CPU')} · DDR ${fit('DDR')} · SSD ${fit('SSD')}（${flagsOf(dom.CPU)}）`, `NIC ${fit('NIC')}（UB 网卡 / RoCE 口，${flagsOf(dom.NIC)}）`, `BOXIO ${fit('BOXIO')}（框内 IO 转换 / 交换板，${flagsOf(dom.BOXIO)}）`], [`CPU ${fit('CPU')} · DDR ${fit('DDR')} · SSD ${fit('SSD')} (${flagsOf(dom.CPU)})`, `NIC ${fit('NIC')} (UB NIC / RoCE port, ${flagsOf(dom.NIC)})`, `BOXIO ${fit('BOXIO')} (in-chassis IO conversion / switch board, ${flagsOf(dom.BOXIO)})`]),
        T([`${fmt(k100.cm384.nodes)} 节点 · ${fmt(k100.cm384.nodes * P.cpusPerNode)} CPU`, `${fmt(k100.cm384.gpus * P.rdmaPortsPerNpu)} 个 RDMA 口 · ${fmt(k100.cm384.nodes * P.vpcNicsPerNode)} 张擎天卡`], [`${fmt(k100.cm384.nodes)} nodes · ${fmt(k100.cm384.nodes * P.cpusPerNode)} CPUs`, `${fmt(k100.cm384.gpus * P.rdmaPortsPerNpu)} RDMA ports · ${fmt(k100.cm384.nodes * P.vpcNicsPerNode)} Qingtian cards`]),
        T([`8 卡（一个节点）；折算 BOXIO ≈ ${fmt(per('BOXIO', 'perNode'))} FIT / 节点、CPU ≈ ${fmt(per('CPU', 'perCpu'))} FIT / 颗（推算）`], [`8 cards (one node); BOXIO ≈ ${fmt(per('BOXIO', 'perNode'))} FIT per node, CPU ≈ ${fmt(per('CPU', 'perCpu'))} FIT per CPU (derived)`]),
        T(['进程级重调度（换节点）；RoCE 闪断 < 30 s 被吸收，链路倒换后重执行'], ['process-level rescheduling (replace the node); RoCE flaps < 30 s are absorbed, re-execution after link failover']) ] },
      { fill: 'ub', name: T('UB 互联（scale-up）', 'UB fabric (scale-up)'), c: [
        T([`OPT ${fit('OPT')}（光模块 / 光纤保护组，保护失效后，${flagsOf(dom.OPT)}）`, `FABRIC ${fit('FABRIC')}（L1 / L2 互联设备，保护后残余，${flagsOf(dom.FABRIC)}）`], [`OPT ${fit('OPT')} (optics / fibre protection group, after protection, ${flagsOf(dom.OPT)})`, `FABRIC ${fit('FABRIC')} (L1 / L2 interconnect devices, residual after protection, ${flagsOf(dom.FABRIC)})`]),
        T([`${fmt(k100.cm384.l1Switches)} 片 L1 + ${fmt(k100.cm384.l2Switches)} 片 L2 · ${fmt(k100.cm384.subPlanes)} 个子平面`, `${fmt(k100.cm384.opticalLinks)} 条 L1–L2 链路 · ${fmt(k100.cm384.transceivers)} 个链路端`], [`${fmt(k100.cm384.l1Switches)} L1 + ${fmt(k100.cm384.l2Switches)} L2 chips · ${fmt(k100.cm384.subPlanes)} sub-planes`, `${fmt(k100.cm384.opticalLinks)} L1–L2 links · ${fmt(k100.cm384.transceivers)} link ends`]),
        T(['链路 / L2 芯片：该子平面少 1/16 带宽（降级）；L1 芯片：1 个节点（8 卡）', `折算：OPT ≈ ${per('OPT', 'perL1L2Link').toFixed(1)} FIT / 链路，FABRIC ≈ ${per('FABRIC', 'perUbChip').toFixed(0)} FIT / UB 芯片（推算）`], ['link / L2 chip: 1/16 of a sub-plane’s bandwidth (degraded); L1 chip: one node (8 cards)', `OPT ≈ ${per('OPT', 'perL1L2Link').toFixed(1)} FIT per link, FABRIC ≈ ${per('FABRIC', 'perUbChip').toFixed(0)} FIT per UB chip (derived)`]),
        T(['算子级在线恢复：BGP 切换后重执行（仅 A3）', 'UB 2.0：百纳秒级光路保护切换（950 起，厂商）', `对照：传统光模块年失效率 4‰ ≈ ${fmt(C.opticsVendor.traditionalFit)} FIT / 个，是保护前的器件率，口径不同`], ['operator-level online recovery: re-execute after BGP switching (A3 only)', 'UB 2.0: 100-ns-level optical protection switching (950 on, vendor)', `compare: conventional module AFR 4‰ ≈ ${fmt(C.opticsVendor.traditionalFit)} FIT per module, a raw device rate before protection (different 口径)`]) ] },
      { fill: 'fac', name: T('机柜 / 设施', 'Cabinet / facility'), c: [
        T([`POWER ${fit('POWER')} · COOL ${fit('COOL')} · MGMT ${fit('MGMT')}`, '柜级供电残余 · 液冷 / 风扇 · 管理刀片 / BMC / UBM；无梯级'], [`POWER ${fit('POWER')} · COOL ${fit('COOL')} · MGMT ${fit('MGMT')}`, 'cabinet power residual · liquid cooling / fans · management blade / BMC / UBM; no rung']),
        T([`${fmt(k100.cm384.racks)} 计算柜 + ${fmt(k100.cm384.commRacks)} 通信柜（CM384）`, `${fmt(k100.atlas950.racks)} + ${fmt(k100.atlas950.commRacks)}（Atlas 950 预设）`], [`${fmt(k100.cm384.racks)} compute + ${fmt(k100.cm384.commRacks)} comm. cabinets (CM384)`, `${fmt(k100.atlas950.racks)} + ${fmt(k100.atlas950.commRacks)} (Atlas 950 preset)`]),
        T([`计算柜 ${C.cardsPerCabinet.cm384} 卡（950：${C.cardsPerCabinet.atlas950}）；折算 POWER ≈ ${fmt(per('POWER', 'perComputeCabinetCm384'))} FIT / 柜`, '通信柜：约 28 片 L2 共因（子平面在 4 柜间的分布未公开）'], [`compute cabinet ${C.cardsPerCabinet.cm384} cards (950: ${C.cardsPerCabinet.atlas950}); POWER ≈ ${fmt(per('POWER', 'perComputeCabinetCm384'))} FIT per cabinet`, 'comm. cabinet: ≈ 28 L2 chips share it (sub-plane placement over the 4 cabinets not public)']),
        T(['无梯级 → 全局恢复（作业级重调度）', '靠冗余等级（1+1 / N+1）与共因 β 上限'], ['no rung → global recovery (job-level rescheduling)', 'handled by the redundancy level (1+1 / N+1) and a common-cause β ceiling']) ] },
      { fill: 'vpc', name: T('集群服务', 'Cluster services'), c: [
        T([`STORAGE ${fit('STORAGE')}（共享 checkpoint / 存储服务）`, `UNKNOWN ${fit('UNKNOWN')}（软件 / 未归因）`], [`STORAGE ${fit('STORAGE')} (shared checkpoint / storage service)`, `UNKNOWN ${fit('UNKNOWN')} (software / unattributed)`]),
        T([`整集群共享；10 万卡时 STORAGE 约 ${per('STORAGE', 'clusterEventsPerHourAt100k').toFixed(3)} 次 / h、UNKNOWN 约 ${per('UNKNOWN', 'clusterEventsPerHourAt100k').toFixed(3)} 次 / h`], [`shared by the cluster; at 100k cards STORAGE ≈ ${per('STORAGE', 'clusterEventsPerHourAt100k').toFixed(3)} and UNKNOWN ≈ ${per('UNKNOWN', 'clusterEventsPerHourAt100k').toFixed(3)} events per hour`]),
        T(['整个作业'], ['the whole job']),
        T(['作业级重调度（默认，耗时随规模增长）；UNKNOWN 需先根因归类才能分配'], ['job-level rescheduling (default, slower with scale); UNKNOWN must be attributed before it can be allocated']) ] },
    ];
    let g = '';
    let y = 40;
    const heads = cols.map((c) => wrap(c, colW - 10, 10.4));
    const hn = Math.max(...heads.map((h) => h.length));
    heads.forEach((ls, i) => { g += ls.map((ln, j) => `<text x="${x0 + labelW + gap + i * (colW + gap) + 6}" y="${y + j * 13}" class="t2" style="font-weight:600;font-size:10.4px">${esc(ln)}</text>`).join(''); });
    y += 8 + (hn - 1) * 13;
    for (const row of rows) {
      const cells = row.c.map((ls) => ls.flatMap((ln) => wrap(ln, colW - 12, 9.8)));
      const n = Math.max(...cells.map((c) => c.length));
      const h = 10 + n * 12.8 + 4;
      g += `<rect x="${x0}" y="${y}" width="${labelW}" height="${h}" rx="6" class="${row.fill}"/>`;
      g += lines(x0 + 7, y + 17, wrap(row.name, labelW - 12, 11.5), 'h', 14);
      cells.forEach((ls, ci) => { const cx = x0 + labelW + gap + ci * (colW + gap); g += `<rect x="${cx}" y="${y}" width="${colW}" height="${h}" rx="6" class="${row.fill}" opacity="0.55"/>` + lines(cx + 6, y + 15, ls, 's', 12.8); });
      y += h + 5;
    }
    const leg = wrap(T('梯级（目录逐事件标记）：r 重执行 · p 进程重调度 · e DP 弹性 · P 预测迁移 · n 网络容错 · h 热替换。折算 = 目录每卡 FIT × 卡数 ÷ 器件数，假设该类事件全部出自该器件（推算，只作量级参考）。', 'Rungs (per-event catalog flags): r replay · p process rescheduling · e DP elasticity · P predictive migration · n network fault tolerance · h hot swap. Conversions = catalog FIT per card × cards ÷ devices, assuming every event of the class originates in that device (derived, orientation only).'), W - 40, 9.8);
    g += lines(14, y + 12, leg, 'm', 12.6);
    const H = y + 12 + leg.length * 12.6 + 6;
    const tb = titleBlock(label);
    return svgOpen('fig-catalog-map', W, H + tb.dy, label) + tb.svg + `<g transform="translate(0 ${tb.dy})">` + g + '</g></svg>';
  }

  /* ---------- tables ---------- */
  const genRows = T([
    ['第一代 · Atlas 800（9000 / 9010）· Atlas 900 PoD', 'Ascend 910', '8 / 服务器（两组 4 卡 HCCS）', 'Atlas 900 PoD：47U 柜、64 颗 / 柜', 'HCCS（组内）', '每 NPU 一个 RoCE 口，按 NPU0/4、1/5 … 分 4 个网段', '4,096 颗', '厂商'],
    ['A2 · Atlas 800T A2 · Atlas 900 A2 PoD', 'Ascend 910B', '8 / 服务器', '4U 服务器、4 × 鲲鹏 920', 'HCCS（服务器内；调度不做处理器亲和分组，推得）', '8 × 200GE 直出 RoCE（参数面），同一网段', '本页来源未给', '厂商'],
    ['A3 · Atlas 900 A3 SuperPoD / CloudMatrix384', 'Ascend 910C（2 die、8 HBM）', '384', '12 + 4 = 16 柜；32 NPU / 计算柜', 'UB 两级：L1 板载、L2 在通信柜；7 子平面 × 16 片 L2，无阻塞；14 × 28 GB/s / NPU', 'RDMA（RoCE）400 Gb/s / NPU；VPC 擎天卡 ≤ 400 Gb/s / 节点', '16.5 万 NPU（约 430 个超节点）', '论文 · 厂商 · 推算'],
    ['Atlas 950 SuperPoD', 'Ascend 950DT', '8,192', '128 + 32 = 160 柜；64 NPU / 计算柜；约 1,000 m²', 'UB 2.0，柜间全光（≥ 200 m）；16.3 PB/s、2.1 µs；百纳秒级光路切换', 'RoCE 或 UBoE', 'SuperCluster：64 × 8,192 = 524,288（> 10,000 柜）', '厂商'],
    ['Atlas 960 SuperPoD', 'Ascend 960', '15,488', '176 + 44 = 220 柜；约 88 NPU / 计算柜（推算）', 'UB 2.0', '—', 'SuperCluster：> 100 万', '厂商 · 推算'],
    ['Atlas 960E SuperPoD（2026）', '未注明', '4,096', '未注明；正交架构、全液冷', 'UB + NPO 光引擎：5,500 个 Hi-ONE（每个 7.2 Tb/s）替代 48,000 个 800G 光模块', 'UB 网络或 RoCE；两层四平面 Clos', '51.2 万；加多轨约 100 万', '厂商（系统可用度 99.8 %，口径未定义）'],
  ], [
    ['1st gen · Atlas 800 (9000 / 9010) · Atlas 900 PoD', 'Ascend 910', '8 per server (two HCCS groups of 4)', 'Atlas 900 PoD: 47U cabinet, 64 processors per cabinet', 'HCCS (within a group)', 'one RoCE port per NPU, four subnets pairing NPU0/4, 1/5, …', '4,096 processors', 'vendor'],
    ['A2 · Atlas 800T A2 · Atlas 900 A2 PoD', 'Ascend 910B', '8 per server', '4U server, 4 × Kunpeng 920', 'HCCS (inside the server; no processor-affinity groups in scheduling, derived)', '8 × 200GE direct RoCE ports (parameter plane), one subnet', 'not in these sources', 'vendor'],
    ['A3 · Atlas 900 A3 SuperPoD / CloudMatrix384', 'Ascend 910C (2 dies, 8 HBM)', '384', '12 + 4 = 16 cabinets; 32 NPUs per compute cabinet', 'two-tier UB: L1 on board, L2 in comm. cabinets; 7 sub-planes × 16 L2, non-blocking; 14 × 28 GB/s per NPU', 'RDMA (RoCE) 400 Gb/s per NPU; VPC Qingtian ≤ 400 Gb/s per node', '165,000 NPUs (≈ 430 supernodes)', 'paper · vendor · derived'],
    ['Atlas 950 SuperPoD', 'Ascend 950DT', '8,192', '128 + 32 = 160 cabinets; 64 NPUs per compute cabinet; ≈ 1,000 m²', 'UB 2.0, all-optical between cabinets (≥ 200 m); 16.3 PB/s, 2.1 µs; 100-ns-level optical switching', 'RoCE or UBoE', 'SuperCluster: 64 × 8,192 = 524,288 (> 10,000 cabinets)', 'vendor'],
    ['Atlas 960 SuperPoD', 'Ascend 960', '15,488', '176 + 44 = 220 cabinets; ≈ 88 NPUs per compute cabinet (derived)', 'UB 2.0', '—', 'SuperCluster: > 1 million', 'vendor · derived'],
    ['Atlas 960E SuperPoD (2026)', 'not stated', '4,096', 'not stated; orthogonal architecture, fully liquid-cooled', 'UB + NPO optical engines: 5,500 Hi-ONE (7.2 Tb/s each) instead of 48,000 800G modules', 'UB network or RoCE; two-tier four-plane Clos', '512,000; ≈ 1 million with multi-rail', 'vendor (99.8 % system availability, 口径 undefined)'],
  ]);
  const genHead = T(['代际 · 产品', 'NPU', 'scale-up 域（NPU）', '柜 · 每柜 NPU', '域内互联', '域间（scale-out）', '集群上限', '置信'], ['Generation · product', 'NPU', 'Scale-up domain (NPUs)', 'Cabinets · NPUs per cabinet', 'Inside the domain', 'Between domains (scale-out)', 'Cluster ceiling', 'Confidence']);
  const genTable = `<div class="table-wrap"><table class="gen"><tr>${genHead.map((h, i) => `<th style="width:${[14, 9, 8, 14, 20, 15, 12, 8][i]}%">${esc(h)}</th>`).join('')}</tr>${genRows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="k"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  const cnt = (o) => o;
  const countRows = [
    [T('NPU', 'NPUs'), fmt(k100.server8.gpus), fmt(pod.gpus), fmt(k100.cm384.gpus), fmt(pod950.gpus), fmt(k100.atlas950.gpus)],
    [T('节点（8 NPU / 节点）', 'nodes (8 NPUs each)'), fmt(k100.server8.nodes), fmt(pod.nodes), fmt(k100.cm384.nodes), fmt(pod950.nodes), fmt(k100.atlas950.nodes)],
    [T('计算柜', 'compute cabinets'), '—', fmt(pod.racks), fmt(k100.cm384.racks), fmt(pod950.racks), fmt(k100.atlas950.racks)],
    [T('通信柜', 'communication cabinets'), '—', fmt(pod.commRacks), fmt(k100.cm384.commRacks), fmt(pod950.commRacks), fmt(k100.atlas950.commRacks)],
    [T('scale-up 域（超节点）', 'scale-up domains (SuperPoDs)'), T(`${fmt(k100.server8.nodes)} 台服务器`, `${fmt(k100.server8.nodes)} servers`), '1', fmt(k100.cm384.supernodes), '1', fmt(k100.atlas950.supernodes)],
    [T('UB L1 交换芯片', 'UB L1 switch chips'), '—', fmt(pod.l1Switches), fmt(k100.cm384.l1Switches), `${fmt(pod950.l1Switches)}*`, `${fmt(k100.atlas950.l1Switches)}*`],
    [T('UB L2 交换芯片', 'UB L2 switch chips'), '—', fmt(pod.l2Switches), fmt(k100.cm384.l2Switches), `${fmt(pod950.l2Switches)}*`, `${fmt(k100.atlas950.l2Switches)}*`],
    [T('UB 子平面', 'UB sub-planes'), '—', fmt(pod.subPlanes), fmt(k100.cm384.subPlanes), `${fmt(pod950.subPlanes)}*`, `${fmt(k100.atlas950.subPlanes)}*`],
    [T('L1–L2 光链路', 'L1–L2 optical links'), '—', fmt(pod.opticalLinks), fmt(k100.cm384.opticalLinks), `${fmt(pod950.opticalLinks)}*`, `${fmt(k100.atlas950.opticalLinks)}*`],
    [T('链路端（每端一个光模块，假设）', 'link ends (one module per end, assumed)'), '—', fmt(pod.transceivers), fmt(k100.cm384.transceivers), `${fmt(pod950.transceivers)}*`, `${fmt(k100.atlas950.transceivers)}*`],
    [T('RDMA / RoCE 口', 'RDMA / RoCE ports'), T(`${fmt(k100.server8.nodes * 8)}（8 × 200GE / 台）`, `${fmt(k100.server8.nodes * 8)} (8 × 200GE per server)`), fmt(pod.gpus * P.rdmaPortsPerNpu), fmt(k100.cm384.gpus * P.rdmaPortsPerNpu), `${fmt(pod950.gpus * P950.rdmaPortsPerNpu)}*`, `${fmt(k100.atlas950.gpus * P950.rdmaPortsPerNpu)}*`],
    [T('CPU', 'CPUs'), T(`${fmt(k100.server8.nodes * 4)}（4 / 台）`, `${fmt(k100.server8.nodes * 4)} (4 per server)`), fmt(pod.nodes * P.cpusPerNode), fmt(k100.cm384.nodes * P.cpusPerNode), `${fmt(pod950.nodes * P950.cpusPerNode)}*`, `${fmt(k100.atlas950.nodes * P950.cpusPerNode)}*`],
  ].map(cnt);
  const countHead = T(['单元', 'A2 式 8 卡服务器 @ 10 万', 'CM384 每超节点', 'CM384 @ 10 万', 'Atlas 950 每超节点（预设）', 'Atlas 950 @ 10 万（预设）'], ['Unit', 'A2-style 8-NPU servers at 100k', 'CM384 per SuperPoD', 'CM384 at 100k', 'Atlas 950 per SuperPoD (preset)', 'Atlas 950 at 100k (preset)']);
  const countTable = `<div class="table-wrap"><table class="cnt"><tr>${countHead.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr>${countRows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ' class="k"'}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  const SRC = [
    ['Serving Large Language Models on Huawei CloudMatrix384 (arXiv 2506.12708 v3)', ['https://arxiv.org/abs/2506.12708'], T('384 NPU / 192 CPU / 48 节点 / 12 + 4 柜；每节点 7 片 L1；7 子平面 × 16 片 L2 × 48 口；每 die 7 条 UB + 1 个 RDMA；三个平面', '384 NPUs / 192 CPUs / 48 nodes / 12 + 4 cabinets; 7 L1 per node; 7 sub-planes × 16 L2 × 48 ports; 7 UB + 1 RDMA per die; three planes'), T('论文', 'paper-reported'), T('2026-10-09 抓取入库', 'fetched 2026-10-09, in the library')],
    ['The Register, 2025-07-29', ['https://www.theregister.com/2025/07/29/huawei_rackscale_boogeyman/'], T('每 NPU 14 × 28 GB/s UB；32 NPU / 柜；每 NPU 400 Gb/s scale-out；集群至 16.5 万 NPU', '14 × 28 GB/s UB per NPU; 32 NPUs per rack; 400 Gb/s scale-out per NPU; clusters up to 165,000 NPUs'), T('厂商（媒体转述）', 'vendor (press)'), T('2026-10-09 抓取', 'fetched 2026-10-09')],
    ['SemiAnalysis public preview (2025-04-16) · FiberMall relay', ['https://newsletter.semianalysis.com/p/huawei-ai-cloudmatrix-384-chinas-answer-to-nvidia-gb200-nvl72', 'https://www.fibermall.com/ja/blog/?p=17241'], T('6,912 个 400G LPO；scale-up 5,376 + scale-out 1,536', '6,912 × 400G LPO; 5,376 scale-up + 1,536 scale-out'), 'scan-level', T('2026-10-09 抓取', 'fetched 2026-10-09')],
    ['Huawei Connect 2025: press release · Eric Xu keynote', ['https://www.huawei.com/en/news/2025/9/hc-lingqu-ai-superpod', 'https://www.huawei.com/en/news/2025/9/hc-xu-keynote-speech'], T('950：8,192 NPU、128 + 32 柜、约 1,000 m²、16.3 PB/s、2.1 µs、≥ 200 m、百纳秒级切换；960：15,488、176 + 44 柜；SuperCluster 52.4 万 / > 100 万', '950: 8,192 NPUs, 128 + 32 cabinets, ≈ 1,000 m², 16.3 PB/s, 2.1 µs, ≥ 200 m, 100-ns-level switching; 960: 15,488, 176 + 44 cabinets; SuperClusters 524k / > 1M'), T('厂商', 'vendor'), T('2026-10-09 抓取', 'fetched 2026-10-09')],
    ['Huawei MWC 2026', ['https://www.huawei.com/en/news/2026/3/mwc-superpod-ai'], T('每柜 64 NPU，可扩到 8,192', '64 NPUs per cabinet, up to 8,192'), T('厂商', 'vendor'), T('2026-10-09 抓取', 'fetched 2026-10-09')],
    ['Huawei Connect 2026: Atlas 960E SuperPoD', ['https://www.huawei.com/en/news/2026/9/hc-ascend960-supernode'], T('4,096 NPU；5,500 个 Hi-ONE（7.2 Tb/s）替代 48,000 个 800G 模块；正交架构、全液冷；两层四平面 Clos 至 51.2 万，多轨约 100 万；UB 或 RoCE；99.8 %', '4,096 NPUs; 5,500 Hi-ONE (7.2 Tb/s) instead of 48,000 800G modules; orthogonal, fully liquid-cooled; two-tier four-plane Clos to 512,000, ≈ 1M with multi-rail; UB or RoCE; 99.8 %'), T('厂商', 'vendor'), T('2026-10-09、10-16 抓取', 'fetched 2026-10-09 and 10-16')],
    ['UB-Mesh (arXiv 2503.20377) · Hot Chips 2025', ['https://arxiv.org/abs/2503.20377', 'https://hc2025.hotchips.org/assets/program/conference/day2/67_Huawei_Liao_final.pdf'], T('柜内 64 NPU 2D-FullMesh（8 板 × 8），Pod 为 4D-FullMesh，其上用 Clos；8K 示例：128 柜 × 64 NPU（另含 1 颗备用 NPU、16 颗 CPU / 柜），单层 128 台交换机', 'rack = 2D-FullMesh of 64 NPUs (8 boards × 8), pod = 4D-FullMesh, Clos above; 8K example: 128 racks × 64 NPUs (plus 1 spare NPU and 16 CPUs per rack), one layer of 128 switches'), T('论文 · 厂商讲稿（8K 示例为 scan-level）', 'paper · vendor slides (8K example scan-level)'), T('2026-10-16 搜索摘要', 'search summary 2026-10-16')],
    ['Notebookcheck · TechRadar (Atlas 950 SuperCluster)', ['https://www.notebookcheck.net/Huawei-Atlas-950-SuperCluster-unveiled-with-524-ExaFLOPS-AI-performance.1119000.0.html', 'https://www.techradar.com/pro/huawei-throws-massive-1-million-npu-gauntlet-at-nvidia-and-amd-as-it-positions-itself-an-alternative-to-us-ai-giants'], T('64 × 8,192 颗 Ascend 950DT；RoCE 或 UBoE', '64 × 8,192 Ascend 950DT; RoCE or UBoE'), T('媒体', 'press'), T('2026-10-16 搜索摘要', 'search summary 2026-10-16')],
    [T('华为 Atlas 800T A2 产品页', 'Huawei Atlas 800T A2 product page'), ['https://e.huawei.com/cn/products/computing/ascend/atlas-800t-a2'], T('4U；4 × 鲲鹏 920；8 × 200GE QSFP 直出，RoCE', '4U; 4 × Kunpeng 920; 8 × 200GE QSFP direct, RoCE'), T('厂商', 'vendor'), T('2026-10-16 搜索摘要', 'search summary 2026-10-16')],
    [T('华为 Atlas 900 PoD 产品页', 'Huawei Atlas 900 PoD product page'), ['https://e.huawei.com/ma/products/computing/ascend/atlas-900-pod-9000'], T('47U 柜、64 颗处理器，扩到 4,096 颗', '47U cabinet, 64 processors, scales to 4,096'), T('厂商', 'vendor'), T('2026-10-16 搜索摘要', 'search summary 2026-10-16')],
    [T('昇腾 MindCluster 部署指南 · 调度指南', 'Ascend MindCluster deployer and scheduling guides'), [T('https://www.hiascend.com/document/detail/zh/mindcluster/730/deployer/deployerug/deployer_0025.html', 'https://www.hiascend.com/document/detail/en/mindcluster/730/ascenddeployer/deployerug/deployer_0025.html'), 'https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_affinity_0004.html'], T('参数面网络配在 NPU 网口上；A2 节点 8 口同网段、第一代分 4 网段；第一代 8 NPU 分两组 4 卡 HCCS', 'parameter-plane network on the NPU ports; A2: one subnet per node, 1st gen: four subnets; 1st gen: 8 NPUs in two HCCS groups of 4'), T('厂商', 'vendor'), T('2026-10-16 搜索摘要', 'search summary 2026-10-16')],
    ['MindCluster 7.3 fault handling · ModelArts Snt9b23', ['https://www.hiascend.com/document/detail/en/mindcluster/730/clustersched/schedulingug/dl_resume_021.html', 'https://support.huaweicloud.com/resmgmt-modelarts/usermanual-server-0037.html'], T('六级恢复；算子级在线恢复仅 A3；进程级重调度需备机；HCCL 重执行约 95 % 成功；RoCE 闪断 < 30 s 被吸收', 'six recovery rungs; operator-level online recovery on A3 only; process-level rescheduling needs a standby server; HCCL re-execution ≈ 95 % success; RoCE flaps < 30 s absorbed'), T('厂商', 'vendor'), T('2026-10-09 抓取入库', 'fetched 2026-10-09, in the library')],
    [T('华为光模块抗通道失效（百科）', 'Huawei optical-module channel loss resistance'), ['https://info.support.huawei.com/info-finder/encyclopedia/en/Optical+module+channel+loss+resistance.html'], T('传统光模块年失效率最高 4‰ → 0.4‰', 'conventional module AFR up to 4‰ → 0.4‰'), T('厂商', 'vendor'), T('2026-10-09 抓取', 'fetched 2026-10-09')],
    ['flopper.io spec sheet (Atlas 900 A3 SuperPoD)', ['https://flopper.io/system/huawei-atlas-900-a3-superpod'], T('12 个液冷计算柜 + 4 个风冷总线柜；每 NPU 784 GB/s（双向）', '12 liquid-cooled compute + 4 air-cooled bus cabinets; 784 GB/s per NPU (bidirectional)'), T('汇总站（scan-level）', 'aggregator (scan-level)'), T('2026-10-16 搜索摘要', 'search summary 2026-10-16')],
    ['HAC-D', [], T('SUPERPOD_PRESETS（schema.ts）、computeCounts、docs/ASCEND_SOURCES.md、docs/ascend-architecture/counts.json', 'SUPERPOD_PRESETS (schema.ts), computeCounts, docs/ASCEND_SOURCES.md, docs/ascend-architecture/counts.json'), T('代码', 'code'), '—'],
  ];
  const srcHead = T(['来源', '本页用到的事实', '置信', '获取方式'], ['Source', 'Facts used on this page', 'Confidence', 'How obtained']);
  const srcTable = `<div class="table-wrap"><table class="src"><tr>${srcHead.map((h, i) => `<th style="width:${[27, 50, 11, 12][i]}%">${esc(h)}</th>`).join('')}</tr>${SRC.map(([n, urls, what, conf, how]) => `<tr><td class="k" style="white-space:normal">${urls.length ? `<a href="${esc(urls[0])}">${esc(n)}</a>${urls.slice(1).map((u, i) => ` · <a href="${esc(u)}">[${i + 2}]</a>`).join('')}` : esc(n)}</td><td>${esc(what)}</td><td>${esc(conf)}</td><td>${esc(how)}</td></tr>`).join('')}</table></div>`;

  const f1 = fig1(), f2 = fig2(), f3 = fig3(), f4 = fig4();
  writeFileSync(`${OUT_DIR}/fig1-levels.${lang}.svg`, f1);
  writeFileSync(`${OUT_DIR}/fig2-generations.${lang}.svg`, f2);
  writeFileSync(`${OUT_DIR}/fig3-ub-fabric.${lang}.svg`, f3);
  writeFileSync(`${OUT_DIR}/fig4-catalog-map.${lang}.svg`, f4);
  const linksPerNpu = pod.opticalLinks / pod.gpus, chipsPerNpu = (pod.l1Switches + pod.l2Switches) / pod.gpus;
  const keyPoints = T([
    `<b>三层嵌套、两种网络</b>：NPU → 节点（8 NPU）→ 超节点（一个 UB scale-up 域）→ 集群（RoCE 或 UBoE scale-out）。scale-up 域从 8（A2 服务器）扩到 384（A3 / CloudMatrix384），再到 8,192 / 15,488（Atlas 950 / 960），集合通信越来越多地留在 UB 域内。`,
    `<b>三个平面</b>：UB（域内，每 NPU 392 GB/s）、RDMA / RoCE（域间，每 NPU 400 Gb/s）、VPC（擎天卡：存储、管理、外部）。A2 一代则是每 NPU 一个 200GE RoCE 口组成参数面。三个平面的故障是不同事件类，不能相加。`,
    `<b>互联器件远多于 NPU</b>：CloudMatrix384 每颗 NPU 对应 ${linksPerNpu.toFixed(0)} 条 L1–L2 光链路、${chipsPerNpu.toFixed(2)} 片 UB 交换芯片；10 万卡时为 ${fmt(k100.cm384.opticalLinks)} 条链路、${fmt(k100.cm384.l1Switches + k100.cm384.l2Switches)} 片 UB 芯片。L2 无阻塞且端口用满，单条链路或单片 L2 故障是 1/16 子平面的带宽降级，而不是断连。`,
    `<b>故障域</b>：卡（1）· 节点（8）· 计算柜（32 / 64 / 约 88）· 超节点（384 / 8,192）· 通信柜（约 28 片 L2 的共因）· 集群服务（整个作业）。Atlas 950 / 960 的柜内互联与通信柜内部结构未公开；HAC-D 的 atlas950 预设沿用 CloudMatrix384 的结构参数（表 2 中带 * 的数）。`,
  ], [
    `<b>Three nested levels, two networks</b>: NPU → node (8 NPUs) → SuperPoD (one UB scale-up domain) → cluster (RoCE or UBoE scale-out). The scale-up domain grew from 8 (A2 server) to 384 (A3 / CloudMatrix384) and to 8,192 / 15,488 (Atlas 950 / 960), so more and more of the collective traffic stays inside UB.`,
    `<b>Three planes</b>: UB (inside the domain, 392 GB/s per NPU), RDMA / RoCE (between domains, 400 Gb/s per NPU), VPC (Qingtian card: storage, management, external). The A2 generation builds its parameter plane from one 200GE RoCE port per NPU. Faults on the three planes are different event classes and are never added.`,
    `<b>Many more fabric devices than NPUs</b>: CloudMatrix384 has ${linksPerNpu.toFixed(0)} L1–L2 optical links and ${chipsPerNpu.toFixed(2)} UB switch chips per NPU; at 100k cards that is ${fmt(k100.cm384.opticalLinks)} links and ${fmt(k100.cm384.l1Switches + k100.cm384.l2Switches)} UB chips. The L2 tier is non-blocking with every port used, so one link or one L2 chip failing costs 1/16 of a sub-plane's bandwidth, not connectivity.`,
    `<b>Fault domains</b>: card (1) · node (8) · compute cabinet (32 / 64 / ≈ 88) · SuperPoD (384 / 8,192) · communication cabinet (common cause for ≈ 28 L2 chips) · cluster services (the whole job). The in-cabinet and communication-cabinet internals of Atlas 950 / 960 are not public; HAC-D's atlas950 preset reuses the CloudMatrix384 radix (numbers marked * in Table 2).`,
  ]);
  const allocNote = T(
    `<b>对分配的含义</b>：目录按每卡·小时给 FIT，架构决定这些 FIT 落到多少个器件、一次事件停掉多少卡。CloudMatrix384 几何下，OPT 66.7 FIT / 卡 ≈ ${dom.OPT.perDevice.perL1L2Link.toFixed(1)} FIT / 链路，FABRIC 66.7 ≈ ${dom.FABRIC.perDevice.perUbChip.toFixed(0)} FIT / UB 芯片，POWER 166.7 ≈ ${fmt(dom.POWER.perDevice.perComputeCabinetCm384)} FIT / 计算柜（Atlas 950 的 64 卡柜加倍）。HAC-D 的计数作用域（<code>l1_switch</code>、<code>l2_switch</code>、<code>subplane</code>、<code>optical_link</code>、<code>comm_rack</code>、<code>supernode</code>）正是 v3.8 规划 WP1（按架构推导 AGREE 权重）的输入。`,
    `<b>What this means for the allocation</b>: the catalog states FIT per card-hour, and the architecture decides over how many devices those FIT spread and how many cards one event stops. With the CloudMatrix384 geometry, OPT 66.7 FIT per card ≈ ${dom.OPT.perDevice.perL1L2Link.toFixed(1)} FIT per link, FABRIC 66.7 ≈ ${dom.FABRIC.perDevice.perUbChip.toFixed(0)} FIT per UB chip, POWER 166.7 ≈ ${fmt(dom.POWER.perDevice.perComputeCabinetCm384)} FIT per compute cabinet (doubled for Atlas 950's 64-card cabinets). HAC-D's count scopes (<code>l1_switch</code>, <code>l2_switch</code>, <code>subplane</code>, <code>optical_link</code>, <code>comm_rack</code>, <code>supernode</code>) are exactly the input of WP1 of the v3.8 plan (architecture-derived AGREE weights).`);
  const css = `
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; }
  main { max-width: 1120px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 22px 26px 26px; margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 22px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; }
  h2 { font-family: "IBM Plex Serif", "IBM Plex Sans", "PingFang SC", Georgia, serif; font-size: 16px; font-weight: 600; margin: 14px 0 6px; padding-top: 8px; border-top: 1px solid var(--rule); }
  h2.first { border-top: none; padding-top: 0; margin-top: 4px; }
  p { margin: 5px 0; } .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 6px; }
  a { color: var(--accent); }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
  footer, .eyebrow, p, h1, h2, .callout, td, th { overflow-wrap: anywhere; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 6px 0 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 11.6px; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 3.5px 6px; text-align: left; vertical-align: top; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.2px; }
  td.k { font-weight: 600; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  figure.chart { margin: 8px 0 10px; } .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; } figure.chart svg { display: block; width: 100%; height: auto; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
  .callout { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: 6px 11px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.2px; }
  .callout ul { margin: 2px 0; padding-left: 16px; } .callout li { margin: 3px 0; }
  .note { font-size: 11.3px; color: var(--muted); }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 10px; }
  @media screen and (max-width: 760px) { .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 720px; } .scroll svg { min-width: 760px; } }
  @media print {
    @page { size: A4; margin: 7mm 8mm 8mm; }
    html, body { background: #fff; color: #000; font-size: 8.4px; line-height: 1.34; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; margin: 0; } .page + .page { break-before: page; page-break-before: always; }
    table { font-size: 7px; line-height: 1.24; } th, td { padding: 1px 2.5px; } th { font-size: inherit; }
    code { font-size: 7px; } .callout, .sub, footer, .note { font-size: 7.4px; } .callout { margin: 3px 0; padding: 3px 7px; } .callout li { margin: 1px 0; } footer { font-size: 6.9px; }
    h1 { font-size: 14px; margin: 2px 0 3px; } h2 { font-size: 10.5px; margin: 4px 0 2px; padding-top: 3px; } .eyebrow { font-size: 7.5px; }
    figure.chart { margin: 2px 0 3px; } figcaption { font-size: 7.2px; margin-top: 0; } p { margin: 2px 0; } .table-wrap { overflow: visible; margin: 3px 0 4px; }
    table.src { font-size: 6.6px; } table.cnt { font-size: 7.2px; }
  }
`;
  const sections = [
    `<div class="eyebrow">EYEBROW1</div>
  <h1>${esc(T('昇腾 AI 集群的典型架构与拓扑：集群 · 网络 · 超节点 · 硬件', 'Typical Ascend AI-cluster architectures and topologies: cluster · network · SuperPoD · hardware'))}</h1>
  <p class="sub">${T('本页把华为公开资料中的昇腾集群结构画成四张图：五级结构（图 1）、三代拓扑（图 2）、CloudMatrix384 的 UB 互联与三个平面（图 3）、以及 54 条事件参考目录的 18 个硬件域在架构中的位置（图 4）。数字来自项目已入库的来源记录（docs/ASCEND_SOURCES.md，带 URL 与置信）和本页末列出的搜索摘要；单元数由 HAC-D 的 <code>computeCounts</code> 按 <code>cloudmatrix384</code> / <code>atlas950</code> 预设算出。置信标签：论文 = 论文正文给出；厂商 = 华为发布或文档；推算 = 由前两者算出；scan-level = 只见于第三方或搜索摘要；假设 = HAC-D 预设的填补值。Atlas 950 / 960 的柜内与通信柜内部结构没有公开资料。', 'This page draws the structure of Ascend clusters from Huawei’s public material in four pictures: the five levels (Figure 1), three generations of topology (Figure 2), the CloudMatrix384 UB fabric and its three planes (Figure 3), and where the 18 hardware domains of the 54-event reference catalog sit (Figure 4). Numbers come from the source records already in the project (docs/ASCEND_SOURCES.md, with URL and confidence) and from the search summaries listed at the end; unit counts are computed by HAC-D’s <code>computeCounts</code> with the <code>cloudmatrix384</code> / <code>atlas950</code> presets. Confidence labels: paper = stated in the paper body; vendor = Huawei release or documentation; derived = computed from those; scan-level = seen only in third-party pages or search summaries; assumed = a fill-in value of the HAC-D preset. The in-cabinet and communication-cabinet internals of Atlas 950 / 960 are not public.')}</p>
  <figure class="chart"><div class="scroll">${f1}</div></figure>
  <h2 class="first">${esc(T('1. 典型产品与代际（表 1）', '1. Typical products and generations (Table 1)'))}</h2>
  ${genTable}
  <p class="note">${esc(T('UB-Mesh（华为论文与 Hot Chips 2025 讲稿）描述了柜内 64 NPU 的 2D-FullMesh、Pod 级 4D-FullMesh 与其上的 Clos，8K 示例为 128 柜 × 64 NPU——与 Atlas 950 的 128 × 64 计数相同，但发布稿没有说明产品采用该拓扑，图 2 未据此作图。', 'UB-Mesh (Huawei paper and Hot Chips 2025 talk) describes a 2D-FullMesh of 64 NPUs per rack, a 4D-FullMesh at pod level and Clos above; its 8K example is 128 racks × 64 NPUs, the same counts as Atlas 950, but the product releases do not say the product uses that topology, so Figure 2 is not drawn from it.'))}</p>
  <div class="callout"><ul>${keyPoints.map((k) => `<li>${k}</li>`).join('')}</ul></div>`,
    `<div class="eyebrow">EYEBROW2</div>
  <figure class="chart"><div class="scroll">${f2}</div><figcaption>${esc(T('图 2：A2 的 scale-up 域只有一台服务器，跨服务器全部走 RoCE；A3 把 384 NPU 放进一个 UB 域，RoCE 只连超节点之间；950 / 960 把 UB 域扩到万卡级并改为柜间全光，超节点之间用 RoCE 或 UBoE。下方刻度把各代的 scale-up 域放在同一对数轴上（NVL72 仅作参照）。', 'Figure 2: in A2 the scale-up domain is one server and everything between servers runs on RoCE; A3 puts 384 NPUs into one UB domain and uses RoCE only between supernodes; 950 / 960 stretch the UB domain to the 10k class, all-optical between cabinets, with RoCE or UBoE between SuperPoDs. The strip below puts the scale-up domain of each generation on one log axis (NVL72 for reference only).'))}</figcaption></figure>
  <figure class="chart"><div class="scroll">${f3}</div><figcaption>${esc(T('图 3：每个节点的 7 片 L1 一一对应 7 个子平面；子平面内是 48 片 L1 与 16 片 L2 的完全二部图，L2 的 48 个口正好接满 48 个节点。die → L1 的连法由计数推得（每 die 7 条、每节点 7 片 L1），论文未逐条给出。', 'Figure 3: the 7 L1 chips of every node map one-to-one onto the 7 sub-planes; inside a sub-plane the 48 L1 chips and 16 L2 chips form a complete bipartite graph, and the 48 ports of each L2 chip exactly fill the 48 nodes. The die → L1 wiring is derived from the counts (7 links per die, 7 L1 chips per node); the paper does not list it link by link.'))}</figcaption></figure>
  <h2>${esc(T('2. 单元数：同样 10 万卡，架构不同，器件数差几个数量级（表 2，HAC-D computeCounts）', '2. Unit counts: the same 100k cards, orders of magnitude apart in device counts (Table 2, HAC-D computeCounts)'))}</h2>
  ${countTable}
  <p class="note">${esc(T('* = Atlas 950 预设中沿用 CloudMatrix384 结构参数的假设值（每节点 7 片 L1、每片 16 条上行、L2 数按无阻塞放大）；UB-Mesh 的 8K 示例每柜 16 颗 CPU（每 64 NPU），而预设按每节点 4 颗（每柜 32 颗），以实际配置为准。A2 列只列服务器本身可数的单元，柜与交换机数本页来源未给。', '* = assumed values of the Atlas 950 preset that reuse the CloudMatrix384 radix (7 L1 per node, 16 uplinks each, L2 count scaled for non-blocking); the UB-Mesh 8K example has 16 CPUs per 64-NPU rack while the preset assumes 4 per node (32 per cabinet) — use the real configuration. The A2 column lists only what the server itself fixes; cabinet and switch counts are not in these sources.'))}</p>`,
    `<div class="eyebrow">EYEBROW3</div>
  <figure class="chart"><div class="scroll">${f4}</div></figure>
  <div class="callout">${allocNote}</div>
  <h2>${esc(T('3. 来源', '3. Sources'))}</h2>
  ${srcTable}
  <footer>${T('复现：<code>node --import tsx scripts/ascend-architecture-counts.ts</code> → <code>node scripts/build-ascend-architecture.mjs</code>；独立 SVG 在 <code>docs/ascend-architecture/</code>。场景示例：<code>cloudMatrix384Training()</code>、<code>atlas950Training()</code>、<code>ascendSupercluster(npus, spares)</code>（packages/core/src/scenario/examples.ts）。所有故障率仍为类比假设，见 docs/ASCEND_SOURCES.md §4。', 'Reproduce: <code>node --import tsx scripts/ascend-architecture-counts.ts</code> → <code>node scripts/build-ascend-architecture.mjs</code>; standalone SVGs in <code>docs/ascend-architecture/</code>. Scenario examples: <code>cloudMatrix384Training()</code>, <code>atlas950Training()</code>, <code>ascendSupercluster(npus, spares)</code> (packages/core/src/scenario/examples.ts). All failure rates remain analogue assumptions, see docs/ASCEND_SOURCES.md §4.')}</footer>`,
  ];
  const nPages = sections.length;
  const eyebrow = (i) => esc(T(`HAC-D · 昇腾集群架构 · ${DATE} · 第 ${i} / ${nPages} 页`, `HAC-D · Ascend cluster architecture · ${DATE} · page ${i} / ${nPages}`));
  const body = sections.map((s, i) => `<section class="page" id="p${i + 1}">\n  ${s.replace(`EYEBROW${i + 1}`, eyebrow(i + 1))}\n</section>`).join('\n');
  const html = `<!doctype html>
<html lang="${T('zh-CN', 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T('昇腾集群架构', 'Ascend cluster architecture'))}</title>
<meta name="description" content="${esc(T('昇腾 AI 集群的典型架构与拓扑：集群 → 超节点 → 计算柜 → 节点 → NPU 五级结构，A2 / A3（CloudMatrix384）/ Atlas 950 · 960 三代拓扑，UB 互联与三个平面，以及 54 条事件参考目录的硬件域在架构中的位置与单元数（HAC-D）。', 'Typical Ascend AI-cluster architectures and topologies: the five levels cluster → SuperPoD → cabinet → node → NPU, three generations (A2, A3 / CloudMatrix384, Atlas 950 · 960), the UB fabric and its three planes, and where the hardware domains of the 54-event reference catalog sit, with unit counts (HAC-D).'))}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
  const out = `docs/ASCEND_CLUSTER_ARCHITECTURE.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
page('zh');
page('en');
