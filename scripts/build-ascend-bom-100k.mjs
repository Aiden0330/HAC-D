#!/usr/bin/env node
/**
 * Build docs/ASCEND_BOM_100K.html — a bilingual (zh default, EN toggle) table report of the hardware component counts of the
 * alternative topology designs of a 100,000-NPU Ascend cluster: four architectures (native Atlas 950 SuperPoD, SuperPoD Flex /
 * UBL128, Atlas 900 A3 SuperPoD / CloudMatrix384, Atlas 800T A3 servers) × their scale-out design variants (18 designs), the
 * scale-up and scale-out parts, the reliability consequence (hard FIT per NPU by fault unit, MTBI, A_op today) and the counts of
 * the main designs at 10k / 100k / 200k / 500k NPUs, with one small-multiple figure.
 * Input: docs/backup/ascend-allocation/bom.json (written by scripts/ascend-bom-100k.ts from HAC-D's topologyBom).
 * Usage: node scripts/build-ascend-bom-100k.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { esc, fmt, pct, tex, W, sz, tw, svgDyn, svgClose, titleBlock, legend, pages, pageShell } from './report-kit.mjs';

const B = JSON.parse(readFileSync('docs/backup/ascend-allocation/bom.json', 'utf8'));
const DATE = new Date(B.generated).toLocaleDateString('sv-SE');
const N = B.npus;
const D = Object.fromEntries(B.designs.map((d) => [d.id, d]));
const ARCH = ['native950', 'ubl128', 'cm384', 'a3server'];
const FAM = { 950: ['native950', 'ubl128'], '910C': ['cm384', 'a3server'] };
const SO = { 950: ['main', 'twoPlane', 'hacd', 'attach', 'oversub2'], '910C': ['main', 'r256x200', 'r128x400', 'oversub2'] };
const ORDER = Object.entries(FAM).flatMap(([f, as]) => as.flatMap((a) => SO[f].map((s) => D[`${a}-${s}`])));
const MAIN = ARCH.map((a) => D[`${a}-main`]);
const cnt = (d, id) => d.rows.find((r) => r.id === id)?.count ?? 0;
const rowOf = (d, id) => d.rows.find((r) => r.id === id);

/* ---------------- consistency checks on the data ---------------- */
const SOKEYS = ['scaleOutPorts', 'scaleOutTiers', 'scaleOutSwitches', 'scaleOutLinks', 'scaleOutTransceivers'];
for (const [f, [a1, a2]] of Object.entries(FAM)) for (const s of SO[f]) {
  const x = D[`${a1}-${s}`], y = D[`${a2}-${s}`];
  for (const k of SOKEYS) if (x.counts[k] !== y.counts[k]) throw new Error(`scale-out ${k} differs: ${x.id} vs ${y.id}`);
  if (x.counts.scaleOutPerTier.join() !== y.counts.scaleOutPerTier.join()) throw new Error(`scale-out tiers differ: ${x.id} vs ${y.id}`);
  if (JSON.stringify(x.scaleOut) !== JSON.stringify(y.scaleOut)) throw new Error(`scale-out parameters differ: ${x.id} vs ${y.id}`);
}
if (ORDER.length !== B.designs.length || ORDER.some((d) => !d)) throw new Error('design list incomplete');
for (const d of B.designs) {
  const s = Object.values(d.hardFitPerNpu).reduce((a, v) => a + v, 0) + d.hardFitPerNpuOther;
  if (Math.abs(s - d.hardFitPerNpuTotal) > 1e-6 * s) throw new Error(`FIT split does not sum: ${d.id}`);
  if (d.counts.gpus !== N) throw new Error(`NPU count ${d.id}`);
  const rate = d.rows.reduce((a, r) => a + (r.hardPerHour ?? 0), 0);
  if (Math.abs(rate - d.hardPerHour) > 1e-9) throw new Error(`job rate does not sum: ${d.id}`);
}
for (const a of ARCH) if (JSON.stringify(B.scales[a][String(N)].counts) !== JSON.stringify(D[`${a}-main`].counts)) throw new Error(`scales ≠ main design: ${a}`);

/* ---------------- derived quantities ---------------- */
const k1 = (n) => (1000 * n) / N; // per 1,000 NPUs
const pn = (n) => n / N; // per NPU
const r1k = (v) => (v === 0 ? '0' : fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : 2));
const rN = (v) => (v === 0 ? '0' : fmt(v, v < 1 ? 2 : 1));
const FAB = ['ub-switch', 'ub-link', 'roce-switch', 'roce-link'];
const fabShare = (d) => FAB.reduce((a, k) => a + (d.hardFitPerNpu[k] ?? 0), 0) / d.hardFitPerNpuTotal;
const optics = (d) => d.counts.opticalLinks + d.counts.scaleOutLinks;
const xcvr = (d) => d.counts.transceivers + d.counts.scaleOutTransceivers;
const range = (xs) => [Math.min(...xs), Math.max(...xs)];
const argmin = (ds, f) => ds.reduce((m, d) => (f(d) < f(m) ? d : m));

function body(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const AN = { native950: T('原生 950', 'Native 950'), ubl128: 'UBL128', cm384: 'CM384', a3server: '800T A3' };
  const SN = { main: null, twoPlane: T('2 平面', '2 planes'), hacd: T('HAC-D 3 层', 'HAC-D 3-tier'), attach: T('附件 1×800G', 'attach. 1×800G'), oversub2: T('2:1 收敛', '2:1 leaves'), r256x200: 'radix 256', r128x400: '1×400G' };
  const soShort = (d) => SN[d.so] ?? (d.family === '950' ? T('4 平面', '4 planes') : T('64 口', '64-port'));
  const lab = (d) => `${AN[d.arch]} · ${soShort(d)}`;
  const FN = { 950: T('950 家族（原生 950 / UBL128）', '950 family (native 950 / UBL128)'), '910C': T('910C 家族（CM384 / 800T A3）', '910C family (CM384 / 800T A3)') };
  const CONF = { paper: T('论文', 'paper'), vendor: T('厂商', 'vendor'), derived: T('推导', 'derived'), assumed: T('假设', 'assumed'), user: T('用户', 'user') };
  const kN = (n) => (lang === 'zh' ? `${fmt(n / 10000)} 万` : `${fmt(n / 1000)}k`);

  /* ---------- findings ---------- */
  const [nat, ubl, cm, a3] = MAIN;
  const ubk = (d) => k1(d.counts.ubSwitches), ubo = (d) => pn(d.counts.opticalLinks);
  const lrsPerCab = cnt(nat, 'ubRackSwitch') / cnt(nat, 'cabinet'), l1PerNode = cnt(cm, 'ubL1') / cnt(cm, 'node'), ublPerPod = cnt(ubl, 'ubPodSwitch') / cnt(ubl, 'pod');
  const famDs = (f) => ORDER.filter((d) => d.family === f);
  const soSw = (f) => range(famDs(f).map((d) => k1(d.counts.scaleOutSwitches))), soX = (f) => range(famDs(f).map((d) => pn(d.counts.scaleOutTransceivers)));
  const fitR = range(B.designs.map((d) => d.hardFitPerNpuTotal)), shR = range(B.designs.map(fabShare)), aR = range(B.designs.map((d) => d.aOp));
  const fitMin = argmin(B.designs, (d) => d.hardFitPerNpuTotal), fitMax = argmin(B.designs, (d) => -d.hardFitPerNpuTotal);
  const xMin = { 950: argmin(famDs('950'), xcvr), '910C': argmin(famDs('910C'), xcvr) };
  const keys = [
    T(`<b>UB 交换芯片</b>（每千 NPU）：CM384 ${r1k(ubk(cm))} 最多（每节点 ${fmt(l1PerNode)} 片 L1 + L2），原生 950 ${r1k(ubk(nat))}（每柜 ${fmt(lrsPerCab)} 片 LRS），800T A3 ${r1k(ubk(a3))}（只有板上 L1），UBL128 仅 ${r1k(ubk(ubl))}（每 128 卡 ${fmt(ublPerPod)} 台单层交换）。<b>UB 光链路</b>（每 NPU）：CM384 ${rN(ubo(cm))}、UBL128 ${rN(ubo(ubl))}、原生 950 ${rN(ubo(nat))}、800T A3 ${rN(ubo(a3))}（无 UB 光模块）。`,
      `<b>UB switch chips</b> per 1,000 NPUs: CM384 the most at ${r1k(ubk(cm))} (${fmt(l1PerNode)} L1 chips per node + L2), native 950 ${r1k(ubk(nat))} (${fmt(lrsPerCab)} LRS per cabinet), 800T A3 ${r1k(ubk(a3))} (on-board L1 only), UBL128 only ${r1k(ubk(ubl))} (${fmt(ublPerPod)} single-layer switches per 128 NPUs). <b>UB optical links</b> per NPU: CM384 ${rN(ubo(cm))}, UBL128 ${rN(ubo(ubl))}, native 950 ${rN(ubo(nat))}, 800T A3 ${rN(ubo(a3))} (no UB optics).`),
    T(`<b>scale-out 变体</b>在家族内移动的是交换机与光模块：950 家族每千 NPU ${r1k(soSw('950')[0])}–${r1k(soSw('950')[1])} 台交换机、每 NPU ${rN(soX('950')[0])}–${rN(soX('950')[1])} 只光模块；910C 家族 ${r1k(soSw('910C')[0])}–${r1k(soSw('910C')[1])} 台、${rN(soX('910C')[0])}–${rN(soX('910C')[1])} 只。radix 1,024 两层比 radix 128 三层少一个数量级的交换机；64 口交换机要 4 层。`,
      `The <b>scale-out variants</b> move switches and transceivers within a family: 950 family ${r1k(soSw('950')[0])}–${r1k(soSw('950')[1])} switches per 1,000 NPUs and ${rN(soX('950')[0])}–${rN(soX('950')[1])} transceivers per NPU; 910C family ${r1k(soSw('910C')[0])}–${r1k(soSw('910C')[1])} and ${rN(soX('910C')[0])}–${rN(soX('910C')[1])}. Two tiers of radix 1,024 need an order of magnitude fewer switches than three tiers of radix 128; 64-port switches need four tiers.`),
    T(`<b>可靠性后果</b>：18 个设计的硬中断 FIT / NPU 最低 ${fmt(fitR[0], 1)}（${esc(lab(fitMin))}），最高 ${fmt(fitR[1], 1)}（${esc(lab(fitMax))}），相差 ${fmt(100 * (fitR[1] / fitR[0] - 1), 1)} %；UB 交换 + UB 链路 + scale-out 交换 + 链路只占 ${pct(shR[0], 1)}–${pct(shR[1], 1)}，NPU、节点与作业级服务占主导。10 万卡今天 A_op（六个参考机制）${pct(aR[0], 3)}–${pct(aR[1], 3)}。`,
      `<b>Reliability consequence</b>: hard FIT per NPU over the 18 designs spans ${fmt(fitR[0], 1)} (${esc(lab(fitMin))}) to ${fmt(fitR[1], 1)} (${esc(lab(fitMax))}), ${fmt(100 * (fitR[1] / fitR[0] - 1), 1)} % apart; UB switches + UB links + scale-out switches + links make only ${pct(shR[0], 1)}–${pct(shR[1], 1)} of it — NPUs, nodes and job-level services dominate. A_op today at 100k (six reference mechanisms): ${pct(aR[0], 3)}–${pct(aR[1], 3)}.`),
    T(`<b>光模块最少</b>（UB + scale-out，每 NPU）：950 家族为 ${esc(lab(xMin[950]))}（${rN(pn(xcvr(xMin[950])))}），910C 家族为 ${esc(lab(xMin['910C']))}（${rN(pn(xcvr(xMin['910C'])))}）；CM384 的 UB 光模块（每 NPU ${rN(pn(cm.counts.transceivers))}）在任何 scale-out 变体下都占多数。`,
      `<b>Fewest transceivers</b> (UB + scale-out, per NPU): ${esc(lab(xMin[950]))} in the 950 family (${rN(pn(xcvr(xMin[950])))}) and ${esc(lab(xMin['910C']))} in the 910C family (${rN(pn(xcvr(xMin['910C'])))}); CM384’s UB transceivers (${rN(pn(cm.counts.transceivers))} per NPU) are the majority under every scale-out variant.`),
  ];

  /* ---------- Table 1: scale-up part ---------- */
  const cell = (d, id, n = cnt(d, id)) => { const r = rowOf(d, id); if (!r) return `<td class="num">—</td>`; return `<td class="num"${r ? ` data-tip="${esc(`${r.name[lang]}|${CONF[r.confidence]}`)}"` : ''}>${fmt(n)}<br><span class="src">${r1k(k1(n))} · ${CONF[r.confidence]}</span></td>`; };
  const T1 = [
    ['sec', T('计算', 'Compute')], ['npu', 'NPU'], ['cpu', T('CPU（鲲鹏）', 'CPUs (Kunpeng)')], ['node', T('节点（NPU 托盘 / 服务器，8 NPU）', 'nodes (NPU trays / servers, 8 NPUs)')], ['qingtian', T('擎天卡', 'Qingtian cards')],
    ['sec', T('机柜与超节点', 'Cabinets and SuperPoDs')], ['cabinet', T('计算柜', 'compute cabinets')], ['pod', T('超节点 / UB 域', 'SuperPoDs / UB domains')], ['commCabinet', T('互联柜 / 通信柜（UB 交换）', 'UB / communication cabinets')],
    ['sec', T('UB 交换网络', 'UB fabric')], ['ubRackSwitch', T('UB 交换芯片：柜内 LRS', 'UB switch chips: in-cabinet LRS')], ['ubPodSwitch', T('UB 交换芯片：超节点层（光）', 'UB switch chips: pod tier (optical)')], ['ubL1', T('UB 交换芯片：L1（节点内）', 'UB switch chips: L1 (in node)')], ['ubL2', T('UB 交换芯片：L2（通信柜）', 'UB switch chips: L2 (comm. cabinets)')],
    ['ubSum', T('UB 交换芯片合计', 'UB switch chips, total')], ['ubMeshLink', T('UB 电链路（柜内 / 托盘内全互联）', 'UB electrical mesh links')], ['ubLink', T('UB 光链路', 'UB optical links')], ['ubTransceiver', T('UB 光模块（链路两端）', 'UB transceivers (both ends)')],
  ];
  const t1 = `<div class="table-wrap"><table class="s1"><thead><tr><th>${esc(T('部件（数量；下行：每千 NPU · 置信度）', 'Part (count; second line: per 1,000 NPUs · confidence)'))}</th>${MAIN.map((d) => `<th class="num">${esc(d.name[lang])}</th>`).join('')}</tr></thead><tbody>${T1.map(([id, l]) => {
    if (id === 'sec') return `<tr class="sec"><td colspan="5">${esc(l)}</td></tr>`;
    if (id === 'ubSum') return `<tr class="sum"><td class="b">${esc(l)}</td>${MAIN.map((d) => `<td class="num b">${fmt(d.counts.ubSwitches)}<br><span class="src">${r1k(k1(d.counts.ubSwitches))}</span></td>`).join('')}</tr>`;
    return `<tr><td>${esc(l)}</td>${MAIN.map((d) => cell(d, id)).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;

  /* ---------- Table 2: scale-out part, by variant ---------- */
  const t2 = (f) => {
    const ds = SO[f].map((s) => D[`${FAM[f][0]}-${s}`]);
    const R2 = [
      [T('每 NPU 口数', 'ports per NPU'), (d) => fmt(d.scaleOut.portsPerNpu)], [T('平面', 'planes'), (d) => fmt(d.scaleOut.planes)], [T('交换机端口数 radix', 'switch radix'), (d) => fmt(d.scaleOut.radix)],
      [T('叶层收敛比', 'leaf oversubscription'), (d) => `${fmt(d.scaleOut.oversubscription)}:1`], [T('层数', 'tiers'), (d) => fmt(d.counts.scaleOutTiers)], [T('每层交换机（第 1 层起）', 'switches per tier (tier 1 first)'), (d) => d.counts.scaleOutPerTier.map((v) => fmt(v)).join(' / ')],
      ['sum', T('交换机合计', 'switches, total'), (d) => fmt(d.counts.scaleOutSwitches)], [T('光链路（NPU–叶 + 层间）', 'optical links'), (d) => fmt(d.counts.scaleOutLinks)], [T('光模块（链路两端）', 'transceivers'), (d) => fmt(d.counts.scaleOutTransceivers)],
      ['sec', T('每千 NPU', 'per 1,000 NPUs')], [T('交换机', 'switches'), (d) => r1k(k1(d.counts.scaleOutSwitches))], [T('光链路', 'optical links'), (d) => r1k(k1(d.counts.scaleOutLinks))], [T('光模块', 'transceivers'), (d) => r1k(k1(d.counts.scaleOutTransceivers))],
    ];
    return `<div class="table-wrap"><table class="s2"><thead><tr><th>${esc(FN[f])}</th>${ds.map((d) => `<th class="num">${esc(d.soName[lang])}</th>`).join('')}</tr></thead><tbody>${R2.map((r) => {
      if (r[0] === 'sec') return `<tr class="sec"><td colspan="${ds.length + 1}">${esc(r[1])}</td></tr>`;
      const [l, g, cls] = r[0] === 'sum' ? [r[1], r[2], ' class="sum"'] : [r[0], r[1], ''];
      return `<tr${cls}><td>${esc(l)}</td>${ds.map((d) => `<td class="num">${g(d)}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
  };

  /* ---------- Table 3: reliability consequence ---------- */
  const FU = [['npu', 'NPU'], ['job', T('作业级', 'job')], ['cpu', 'CPU'], ['node', T('节点', 'node')], ['cabinet', T('计算柜', 'cabinet')], ['ub-switch', T('UB 交换', 'UB switch')], ['ub-link', T('UB 链路', 'UB link')], ['roce-switch', T('SO 交换', 'SO switch')], ['roce-link', T('SO 链路', 'SO link')]];
  const t3 = `<div class="table-wrap"><table class="s3"><thead><tr><th>${esc(T('设计（架构 · scale-out 变体）', 'Design (architecture · scale-out variant)'))}</th>${FU.map(([, l]) => `<th class="num">${esc(l)}</th>`).join('')}<th class="num">${esc(T('合计 FIT / NPU', 'total FIT per NPU'))}</th><th class="num">${esc(T('作业中断 / h', 'job interruptions per h'))}</th><th class="num">MTBI (h)</th><th class="num">${esc(T('今天 A_op', 'A_op today'))}</th></tr></thead><tbody>${Object.keys(FAM).map((f) => `<tr class="sec"><td colspan="${FU.length + 5}">${esc(FN[f])}</td></tr>` + famDs(f).map((d) => `<tr><td class="nw${d.main ? ' b' : ''}">${esc(lab(d))}</td>${FU.map(([k]) => `<td class="num">${fmt(d.hardFitPerNpu[k] ?? 0, 1)}</td>`).join('')}<td class="num b">${fmt(d.hardFitPerNpuTotal, 1)}</td><td class="num">${fmt(d.hardPerHour, 3)}</td><td class="num">${fmt(d.mtbiH, 2)}</td><td class="num">${pct(d.aOp, 3)}</td></tr>`).join('')).join('')}</tbody></table></div>`;

  /* ---------- Table 4: the four scales ---------- */
  const C4 = [[T('超节点', 'SuperPoDs'), 'supernodes'], [T('计算柜', 'compute cabinets'), 'racks'], [T('节点', 'nodes'), 'nodes'], [T('UB 交换芯片', 'UB switch chips'), 'ubSwitches'], [T('UB 光链路', 'UB optical links'), 'opticalLinks'], [T('SO 交换机', 'SO switches'), 'scaleOutSwitches'], [T('SO 光链路', 'SO optical links'), 'scaleOutLinks']];
  const t4 = `<div class="table-wrap"><table class="s4"><thead><tr><th>${esc(T('规模（NPU）', 'Size (NPUs)'))}</th>${C4.map(([l]) => `<th class="num">${esc(l)}</th>`).join('')}</tr></thead><tbody>${ARCH.map((a) => `<tr class="sec"><td colspan="${C4.length + 1}">${esc(D[`${a}-main`].name[lang])} · ${esc(soShort(D[`${a}-main`]))}</td></tr>` + B.sizes.map((n) => `<tr><td>${esc(kN(n))}</td>${C4.map(([, k]) => `<td class="num">${fmt(B.scales[a][String(n)].counts[k])}</td>`).join('')}</tr>`).join('')).join('')}</tbody></table></div>`;

  /* ---------- Figure 1: small multiples ---------- */
  function figParts() {
    const head = titleBlock(T('图 1：18 个设计的部件密度——UB 交换芯片与 scale-out 交换机（每千 NPU），光链路与光模块（每 NPU，实色 = UB、描边色块 = scale-out）', 'Figure 1: part density of the 18 designs — UB switch chips and scale-out switches (per 1,000 NPUs), optical links and transceivers (per NPU; solid = UB, outlined = scale-out)'));
    let g = svgDyn(`fig-parts-${lang}`, T('部件密度', 'Part density')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    const LW = 14 + Math.max(...ORDER.map((d) => tw(lab(d), sz(9.8)))) + 10, gap = 14, PW = (W - LW - 14 - 3 * gap) / 4, bh = 13, step = 18, fgap = 12, top = 66;
    const P = [
      [T('UB 交换芯片 / 千 NPU', 'UB switch chips / 1k NPUs'), (d) => [k1(d.counts.ubSwitches), 0], r1k],
      [T('scale-out 交换机 / 千 NPU', 'SO switches / 1k NPUs'), (d) => [0, k1(d.counts.scaleOutSwitches)], r1k],
      [T('光链路 / NPU（UB + SO）', 'optical links / NPU'), (d) => [pn(d.counts.opticalLinks), pn(d.counts.scaleOutLinks)], (v) => fmt(v, 1)],
      [T('光模块 / NPU（UB + SO）', 'transceivers / NPU'), (d) => [pn(d.counts.transceivers), pn(d.counts.scaleOutTransceivers)], (v) => fmt(v, 1)],
    ];
    const yOf = (i) => top + i * step + (i >= famDs('950').length ? fgap : 0);
    ORDER.forEach((d, i) => { g += `<text x="${LW - 8}" y="${yOf(i) + bh - 3}" class="s" text-anchor="end"${d.main ? ' style="font-weight:600"' : ''}>${esc(lab(d))}</text>`; });
    const yEnd = yOf(ORDER.length - 1) + bh + 6;
    P.forEach(([ttl, val, f], p) => {
      const x0 = LW + p * (PW + gap), vmax = Math.max(...ORDER.map((d) => val(d)[0] + val(d)[1])), bw = PW - 44, X = (v) => (v / vmax) * bw;
      g += `<text x="${x0}" y="${top - 26}" class="sb">${esc(ttl)}</text><line x1="${x0}" y1="${top - 6}" x2="${x0}" y2="${yEnd}" class="axis"/>`;
      ORDER.forEach((d, i) => {
        const [a, b] = val(d), y = yOf(i), fam = d.family === '950' ? 1 : 2;
        if (a > 0) g += `<rect x="${x0}" y="${y}" width="${Math.max(X(a), 0.8).toFixed(1)}" height="${bh}" rx="1.5" style="fill:var(--s${fam})"/>`;
        if (b > 0) g += `<rect x="${(x0 + X(a)).toFixed(1)}" y="${y}" width="${Math.max(X(b), 0.8).toFixed(1)}" height="${bh}" rx="1.5" style="fill:${p >= 2 ? `var(--b${fam});stroke:var(--s${fam});stroke-width:0.8` : `var(--s${fam})`}"/>`;
        g += `<text x="${(x0 + X(a + b) + 4).toFixed(1)}" y="${y + bh - 3}" class="tiny">${esc(f(a + b))}</text>`;
      });
    });
    const lg = legend(LW, yEnd + 20, [{ style: 'fill:var(--s1)', label: T('950 家族（UB 或 SO 交换）', '950 family (UB or SO switches)') }, { style: 'fill:var(--b1);stroke:var(--s1)', label: T('950 家族 · scale-out 部分', '950 family · scale-out part') }, { style: 'fill:var(--s2)', label: T('910C 家族', '910C family') }, { style: 'fill:var(--b2);stroke:var(--s2)', label: T('910C 家族 · scale-out 部分', '910C family · scale-out part') }]);
    g += lg.g;
    return svgClose(g, lg.y + 12 + head.dy);
  }

  const ASSUMED = {
    native950: T('每节点 2 CPU；每柜 72 片 LRS（UB-Mesh 论文参考柜）；超节点层交换 128 × 800G（每超节点 16 台，按 Hot Chips 8K 例缩放）；每链路 2 只光模块', '2 CPUs per node; 72 LRS per cabinet (UB-Mesh reference cabinet); pod-tier switches 128 × 800G (16 per pod, Hot Chips 8K example scaled); 2 transceivers per link'),
    ubl128: T('每超节点 2 个 64 卡计算柜；每 NPU 4 × 800G 上联；128 × 800G 交换 → 每超节点 4 台；无 LRS；每 8 卡托盘 28 条电链路；每 4 个超节点 1 个交换柜；每节点 2 CPU；每链路 2 只光模块', '2 compute cabinets of 64 NPUs per pod; 4 × 800G uplinks per NPU; 128 × 800G switches → 4 per pod; no LRS; 28 electrical links per 8-NPU tray; one switch cabinet per 4 pods; 2 CPUs per node; 2 transceivers per link'),
    cm384: T('每条 L1–L2 链路 2 只光模块（SemiAnalysis 另一口径为每系统 6,912 只 400G LPO）；112 片 L2 均分到 4 个通信柜（布局未公开）；scale-out 每 die 1 个 200G RDMA 口接 64 口无收敛折叠 Clos（radix 未公开）', '2 transceivers per L1–L2 link (SemiAnalysis: 6,912 × 400G LPO per system on another basis); the 112 L2 chips spread 28 per communication cabinet (placement not public); scale-out one 200G RDMA port per die into a non-blocking 64-port folded Clos (radix not public)'),
    a3server: T('每柜 4 台服务器（同 CM384 计算柜）；板上 7 片 L1 UB 芯片保留为服务器内 UB，上联口不用；scale-out 口同 CM384 RDMA 平面；无 L2、无 UB 光、无通信柜', '4 servers per cabinet (as the CM384 compute cabinet); the 7 on-board L1 UB chips stay as the in-server UB, uplinks unused; scale-out ports as the CM384 RDMA plane; no L2, no UB optics, no communication cabinets'),
  };
  const asm = (a) => ASSUMED[a];
  const sub = `<p class="sub">${T(`<b>口径</b>：每个数字都是 HAC-D 拓扑模板（<code>topologyBom</code>）在恰好 ${fmt(N)} 张 NPU 时的部件数（超节点、柜按向上取整），每行注明置信度（论文 / 厂商 / 推导 / 假设 / 用户）。四种架构中厂商或论文给定的是超节点、柜与节点的几何，其余为假设：`, `<b>Basis</b>: every number is a part count of HAC-D’s topology templates (<code>topologyBom</code>) at exactly ${fmt(N)} NPUs (SuperPoDs and cabinets rounded up); each row carries its confidence (paper / vendor / derived / assumed / user). The SuperPoD, cabinet and node geometry of the four architectures is vendor- or paper-specified; the rest is assumed:`)}</p>
  <ul class="kf note">${ARCH.map((a) => `<li><b>${esc(D[`${a}-main`].name[lang])}</b>${T('：', ': ')}${esc(asm(a))}</li>`).join('')}</ul>
  <p class="sub">${T('scale-out 变体只改 RDMA / UBoE 网络（口数、平面、radix、收敛），同一家族的两种架构在同一变体下 scale-out 数量相同（构建时已核对）；依据：', 'Scale-out variants change only the RDMA / UBoE network (ports, planes, radix, oversubscription); the two architectures of a family have identical scale-out counts under the same variant (checked at build time). Basis: ')}${Object.entries(B.scaleOutDesigns).map(([f, vs]) => Object.entries(vs).filter(([s]) => !(f === '910C' && s === 'oversub2')).map(([s, v]) => `<b>${esc(SN[s] ?? (f === '950' ? T('4 平面', '4 planes') : T('64 口', '64-port')))}</b>${f === '950' ? '' : ' (910C)'} — ${esc(v.basis[lang])}`).join(T('；', '; '))).join(T('；', '; '))}${T('。', '.')}</p>`;

  const rateTex = tex(String.raw`\lambda=\sum_u n_u\,\mathrm{FIT}_u\cdot10^{-9}`), mtbiTex = tex(String.raw`\mathrm{MTBI}=1/\lambda`);
  return [
    `<h1>${esc(T('100k 卡集群的硬件组件数量：四种拓扑与其 scale-out 设计变体', 'Hardware component counts of a 100k-NPU cluster: four topologies and their scale-out design variants'))}</h1>
  ${sub}
  <div class="callout"><ul>${keys.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h3>${esc(T('表 1：scale-up 部分（超节点内，主设计）', 'Table 1: Scale-up part (inside the SuperPoD, main designs)'))}</h3>
  ${t1}
  <p class="note">${T('“—”= 该架构没有此部件；0 = 模板有此行但数量为 0。UB 交换芯片合计 = 同类（交换芯片）相加；电链路与光链路分列，不相加。', '“—” = the architecture has no such part; 0 = the template has the row with count 0. The total adds switch chips only; electrical and optical links are never added.')}</p>
  <h3>${esc(T('表 2：scale-out 部分（按设计变体；同一家族两种架构相同）', 'Table 2: Scale-out part (by design variant; identical for the two architectures of a family)'))}</h3>
  ${t2('950')}${t2('910C')}
  <p class="note">${T('交换机 = 台数（每台一个交换芯片）；光链路 = NPU–叶 + 层间上联；光模块 = 光链路 × 2；层数 = Clos 接下全部 NPU 口的最少层数；收敛只在叶层；置信度：假设（RDMA 口数为论文 / 厂商）。', 'Switches = boxes (one chip each); links = NPU–leaf + inter-tier; transceivers = links × 2; tiers = the fewest a Clos needs; oversubscription at the leaves only; confidence assumed (RDMA ports: paper / vendor).')}</p>`,
    `<h3 class="first">${esc(T('表 3：可靠性后果（18 个设计，硬中断 FIT / NPU 按故障单元）', 'Table 3: Reliability consequence (18 designs, hard FIT per NPU by fault unit)'))}</h3>
  ${t3}
  <p class="note">${T(`FIT = 造成业务中断的硬故障 / 10⁹ 单元·小时，HAC-D 按硬件单元的口径；“每 NPU”= 单元数 × 单元 FIT ÷ NPU 数。作业中断率 ${rateTex}（一个同步作业占满全部 NPU，次 / h），${mtbiTex}；今天 A_op 按 ASCEND_ALLOCATION_METHODOLOGY 公式 (1)（30 天窗口、一个同步作业、六个参考机制）。SO = scale-out；其交换机与链路用 RoCE 类比 FIT（@roce，置信度“假设”）。亚健康与静默损坏不计入本表。`, `FIT = business-interrupting hard failures per 10⁹ unit-hours on HAC-D’s per-unit basis; “per NPU” = units × unit FIT ÷ NPUs. Job interruption rate ${rateTex} (one synchronous job on every NPU, per hour), ${mtbiTex}; A_op today per formula (1) of ASCEND_ALLOCATION_METHODOLOGY (30-day window, one synchronous job, six reference mechanisms). SO = scale-out; its switches and links use the RoCE analogue FIT (@roce, confidence assumed). Sub-health and silent corruption are not in this table.`)}</p>
  <figure class="chart"><div class="scroll">${figParts()}</div></figure>
  <h3>${esc(T('表 4：四个规模的数量（主设计）', 'Table 4: Counts at the four scales (main designs)'))}</h3>
  ${t4}
  <p class="note">${T('同一模板在 1 万、10 万、20 万、50 万 NPU 的部件数（超节点、柜向上取整，所以原生 950 在 10 万卡是 98 个超节点 = 100,352 卡容量）。1 万卡时 910C 的 scale-out 只需 3 层。', 'The same templates at 10k, 100k, 200k and 500k NPUs (SuperPoDs and cabinets rounded up, so native 950 at 100k has 98 SuperPoDs = 100,352 NPU slots). At 10k the 910C scale-out needs only 3 tiers.')}</p>
  <footer>${T(`数据：<code>docs/backup/ascend-allocation/bom.json</code>（${esc(DATE)}）。复现：<code>node --import tsx scripts/ascend-bom-100k.ts</code> → <code>node scripts/build-ascend-bom-100k.mjs</code>（共享版式 <code>scripts/report-kit.mjs</code>）。数量是 HAC-D 拓扑模板的几何推算，不是厂商物料清单（BOM）。`, `Data: <code>docs/backup/ascend-allocation/bom.json</code> (${esc(DATE)}). Reproduce: <code>node --import tsx scripts/ascend-bom-100k.ts</code> → <code>node scripts/build-ascend-bom-100k.mjs</code> (shared layout <code>scripts/report-kit.mjs</code>). Counts are HAC-D topology-template geometry, not vendor bills of materials.`)}</footer>`,
  ];
}

const eyebrow = (lang) => (i, n) => (lang === 'zh' ? `HAC-D · 100k BOM · ${DATE} · 第 ${i} / ${n} 页` : `HAC-D · 100k BOM · ${DATE} · page ${i} / ${n}`);
const extraCss = `
  span.src { color: var(--muted); font-size: 0.86em; white-space: nowrap; }
  table.s1 td:first-child { min-width: 13em; } table.s2 th.num { min-width: 9em; } table.s2 td:first-child { white-space: nowrap; } table.s3 th.num { white-space: normal; }
  @media screen and (max-width: 760px) { .table-wrap table.s2 { min-width: 640px; } }
  @media print { table.s1 td, table.s1 th { padding: 0.5px 2.4px; line-height: 1.15; } ul.kf { margin: 1px 0; } ul.kf li { margin: 0; } }
`;
const html = pageShell({
  title: 'HAC-D · 100k BOM',
  description: 'Hardware component counts of four Ascend topologies and their scale-out variants at 100,000 NPUs, with the reliability consequence.',
  zhBody: pages(body('zh'), eyebrow('zh')),
  enBody: pages(body('en'), eyebrow('en')),
  extraCss,
});
const bad = html.replace(/<(style|script)>[\s\S]*?<\/\1>/g, '').match(/.{0,60}\b(undefined|NaN)\b.{0,30}/g);
if (bad) throw new Error(`undefined / NaN in output: ${bad.join(' … ')}`);
writeFileSync('docs/ASCEND_BOM_100K.html', html);
console.log('wrote docs/ASCEND_BOM_100K.html', (html.length / 1024).toFixed(0), 'KiB');
