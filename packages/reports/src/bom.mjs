/**
 * BOM recipe — docs/ASCEND_BOM_100K.html, a bilingual (zh default, EN toggle) table report of the hardware component counts of the
 * alternative topology designs of an N-NPU Ascend cluster: every topology record given (grouped by chip family) × its scale-out
 * design variants, the scale-up and scale-out parts, the reliability consequence (hard FIT per NPU by fault unit, MTBI, A_op
 * today) and the counts of the main designs at the built-in scales, with one small-multiple figure.
 * Pure function of its data: `bom` = the bomDocument JSON (docs/backup/ascend-allocation/bom.json). No file access; the date comes
 * from `bom.generated`. v5: generic over the records in the data — families, architectures and variants are read from `designs`
 * and `scaleOutDesigns`, labels from the records' bilingual names, assumptions from the records' `assumed` items; optional
 * `provenance` replaces the footer's data / reproduce sentence (hacd bom).
 */
import { esc, fmt, pct, tex, W, sz, tw, svgDyn, svgClose, titleBlock, legend, pages, pageShell, provenanceFooter, countWord, kN } from './kit.mjs';

const cnt = (d, id) => d.rows.find((r) => r.id === id)?.count ?? 0;
const rowOf = (d, id) => d.rows.find((r) => r.id === id);
const SOKEYS = ['scaleOutPorts', 'scaleOutTiers', 'scaleOutSwitches', 'scaleOutLinks', 'scaleOutTransceivers'];
const r1k = (v) => (v === 0 ? '0' : fmt(v, v >= 100 ? 0 : v >= 10 ? 1 : 2));
const rN = (v) => (v === 0 ? '0' : fmt(v, v < 1 ? 2 : 1));
const FAB = ['ub-switch', 'ub-link', 'roce-switch', 'roce-link'];
const fabShare = (d) => FAB.reduce((a, k) => a + (d.hardFitPerNpu[k] ?? 0), 0) / d.hardFitPerNpuTotal;
const xcvr = (d) => d.counts.transceivers + d.counts.scaleOutTransceivers;
const range = (xs) => [Math.min(...xs), Math.max(...xs)];
const argmin = (ds, f) => ds.reduce((m, d) => (f(d) < f(m) ? d : m));
const uniq = (xs) => [...new Set(xs)];
/** short labels of the scale-out variants the v4.4 records use; any other variant falls back to its id */
const SHORT = { twoPlane: { zh: '2 平面', en: '2 planes' }, hacd: { zh: 'HAC-D 3 层', en: 'HAC-D 3-tier' }, attach: { zh: '附件 1×800G', en: 'attach. 1×800G' }, oversub2: { zh: '2:1 收敛', en: '2:1 leaves' }, r256x200: { zh: 'radix 256', en: 'radix 256' }, r128x400: { zh: '1×400G', en: '1×400G' } };
/** NPUs of one pod of a design: compute cabinets per pod × nodes per cabinet × NPUs per node */
const podNpus = (d) => (d.counts.supernodes > 0 ? Math.round((d.counts.racks / d.counts.supernodes) * d.counts.nodesPerRack * d.counts.gpusPerNode) : 0);
const txt = (x, lang) => (typeof x === 'string' ? x : x[lang]);

/** the page sections of one language; `ctx` carries the data-derived values of bomHtml */
function body(lang, ctx) {
  const { B, DATE, N, D, FAMS, ARCHS, SOS, ORDER, MAIN, k1, pn, PROV } = ctx;
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const AN = (d) => d.short[lang];
  const soShort = (d) => (d.so === 'main' ? (d.scaleOut.planes > 1 ? T(`${d.scaleOut.planes} 平面`, `${d.scaleOut.planes} planes`) : T(`${fmt(d.scaleOut.radix)} 口`, `${fmt(d.scaleOut.radix)}-port`)) : SHORT[d.so]?.[lang] ?? d.so);
  const lab = (d) => `${AN(d)} · ${soShort(d)}`;
  const famMain = (f) => MAIN.filter((d) => d.family === f);
  const FN = (f) => T(`${f} 家族（${famMain(f).map(AN).join(' / ')}）`, `${f} family (${famMain(f).map(AN).join(' / ')})`);
  const CONF = { paper: T('论文', 'paper'), vendor: T('厂商', 'vendor'), derived: T('推导', 'derived'), assumed: T('假设', 'assumed'), user: T('用户', 'user') };
  const famDs = (f) => ORDER.filter((d) => d.family === f);
  const sep = T('；', '; '), comma = T('、', ', ');

  /* ---------- findings ---------- */
  const ubk = (d) => k1(d.counts.ubSwitches), ubo = (d) => pn(d.counts.opticalLinks);
  /** what the UB switch chips of a main design are */
  const ubDetail = (d) => {
    const l1 = cnt(d, 'ubL1'), l2 = cnt(d, 'ubL2'), lrs = cnt(d, 'ubRackSwitch'), podSw = cnt(d, 'ubPodSwitch'), nodes = cnt(d, 'node'), cabs = cnt(d, 'cabinet'), pods = cnt(d, 'pod');
    if (l1 > 0) return l2 > 0 ? T(`每节点 ${fmt(l1 / nodes)} 片 L1 + L2`, `${fmt(l1 / nodes)} L1 chips per node + L2`) : T('只有板上 L1', 'on-board L1 only');
    const parts = [];
    if (lrs > 0) parts.push(T(`每柜 ${fmt(lrs / cabs)} 片 LRS`, `${fmt(lrs / cabs)} LRS per cabinet`));
    if (podSw > 0 && pods > 0) parts.push(T(`每 ${fmt(podNpus(d))} 卡 ${fmt(podSw / pods)} 台${lrs > 0 ? '超节点层' : '单层'}交换`, `${fmt(podSw / pods)} ${lrs > 0 ? 'pod-tier' : 'single-layer'} switches per ${fmt(podNpus(d))} NPUs`));
    return parts.join(T('，', ', ')) || T('无 UB 交换芯片', 'no UB switch chips');
  };
  const byUbk = [...MAIN].sort((a, b) => ubk(b) - ubk(a)), byUbo = [...MAIN].sort((a, b) => ubo(b) - ubo(a));
  const rank = (ds, val, f, detail) => ds.map((d, i) => `${AN(d)} ${f(val(d))}${i === 0 && ds.length > 1 ? T(' 最多', ' the most') : i === ds.length - 1 && ds.length > 2 ? T(' 最少', ' the fewest') : ''}${detail ? T(`（${detail(d)}）`, ` (${detail(d)})`) : ''}`).join(T('，', ', '));
  const soSw = (f) => range(famDs(f).map((d) => k1(d.counts.scaleOutSwitches))), soX = (f) => range(famDs(f).map((d) => pn(d.counts.scaleOutTransceivers)));
  const tiersBy = uniq(B.designs.map((d) => `${d.scaleOut.radix}|${d.counts.scaleOutTiers}`)).map((s) => s.split('|').map(Number)).sort((a, b) => b[0] - a[0]);
  const fitR = range(B.designs.map((d) => d.hardFitPerNpuTotal)), shR = range(B.designs.map(fabShare)), aR = range(B.designs.map((d) => d.aOp));
  const fitMin = argmin(B.designs, (d) => d.hardFitPerNpuTotal), fitMax = argmin(B.designs, (d) => -d.hardFitPerNpuTotal);
  const xMin = (f) => argmin(famDs(f), xcvr);
  const ubMajority = MAIN.filter((d) => d.counts.transceivers > 0 && ORDER.filter((x) => x.arch === d.arch).every((x) => x.counts.transceivers > x.counts.scaleOutTransceivers));
  const keys = [
    T(`<b>UB 交换芯片</b>（每千 NPU）：${rank(byUbk, ubk, r1k, ubDetail)}。<b>UB 光链路</b>（每 NPU）：${rank(byUbo, ubo, rN, (d) => (ubo(d) === 0 ? T('无 UB 光模块', 'no UB optics') : ''))}。`,
      `<b>UB switch chips</b> per 1,000 NPUs: ${rank(byUbk, ubk, r1k, ubDetail)}. <b>UB optical links</b> per NPU: ${rank(byUbo, ubo, rN, (d) => (ubo(d) === 0 ? 'no UB optics' : ''))}.`),
    T(`<b>scale-out 变体</b>在家族内移动的是交换机与光模块：${FAMS.map((f) => `${f} 家族每千 NPU ${r1k(soSw(f)[0])}–${r1k(soSw(f)[1])} 台交换机、每 NPU ${rN(soX(f)[0])}–${rN(soX(f)[1])} 只光模块`).join(sep)}。层数随 radix：${tiersBy.map(([r, t]) => `radix ${fmt(r)} → ${t} 层`).join(comma)}。`,
      `The <b>scale-out variants</b> move switches and transceivers within a family: ${FAMS.map((f) => `${f} family ${r1k(soSw(f)[0])}–${r1k(soSw(f)[1])} switches per 1,000 NPUs and ${rN(soX(f)[0])}–${rN(soX(f)[1])} transceivers per NPU`).join(sep)}. Tiers follow the radix: ${tiersBy.map(([r, t]) => `radix ${fmt(r)} → ${t} tiers`).join(comma)}.`),
    T(`<b>可靠性后果</b>：${B.designs.length} 个设计的硬中断 FIT / NPU 最低 ${fmt(fitR[0], 1)}（${esc(lab(fitMin))}），最高 ${fmt(fitR[1], 1)}（${esc(lab(fitMax))}），相差 ${fmt(100 * (fitR[1] / fitR[0] - 1), 1)} %；UB 交换 + UB 链路 + scale-out 交换 + 链路只占 ${pct(shR[0], 1)}–${pct(shR[1], 1)}，NPU、节点与作业级服务占主导。${kN(N, 'zh')}卡今天 A_op（六个参考机制）${pct(aR[0], 3)}–${pct(aR[1], 3)}。`,
      `<b>Reliability consequence</b>: hard FIT per NPU over the ${B.designs.length} designs spans ${fmt(fitR[0], 1)} (${esc(lab(fitMin))}) to ${fmt(fitR[1], 1)} (${esc(lab(fitMax))}), ${fmt(100 * (fitR[1] / fitR[0] - 1), 1)} % apart; UB switches + UB links + scale-out switches + links make only ${pct(shR[0], 1)}–${pct(shR[1], 1)} of it — NPUs, nodes and job-level services dominate. A_op today at ${kN(N, 'en')} (six reference mechanisms): ${pct(aR[0], 3)}–${pct(aR[1], 3)}.`),
    T(`<b>光模块最少</b>（UB + scale-out，每 NPU）：${FAMS.map((f) => `${f} 家族为 ${esc(lab(xMin(f)))}（${rN(pn(xcvr(xMin(f))))}）`).join(comma)}${ubMajority.length ? `；${ubMajority.map((d) => `${AN(d)} 的 UB 光模块（每 NPU ${rN(pn(d.counts.transceivers))}）在任何 scale-out 变体下都占多数`).join(sep)}` : ''}。`,
      `<b>Fewest transceivers</b> (UB + scale-out, per NPU): ${FAMS.map((f) => `${esc(lab(xMin(f)))} in the ${f} family (${rN(pn(xcvr(xMin(f))))})`).join(', ')}${ubMajority.length ? `; ${ubMajority.map((d) => `${AN(d)}’s UB transceivers (${rN(pn(d.counts.transceivers))} per NPU) are the majority under every scale-out variant`).join('; ')}` : ''}.`),
  ];

  /* ---------- Table 1: scale-up part ---------- */
  const cell = (d, id, n = cnt(d, id)) => { const r = rowOf(d, id); if (!r) return `<td class="num">—</td>`; return `<td class="num"${r ? ` data-tip="${esc(`${r.name[lang]}|${CONF[r.confidence]}`)}"` : ''}>${fmt(n)}<br><span class="src">${r1k(k1(n))} · ${CONF[r.confidence]}</span></td>`; };
  const T1 = [
    ['sec', T('计算', 'Compute')], ['npu', 'NPU'], ['cpu', T('CPU（鲲鹏）', 'CPUs (Kunpeng)')], ['node', T('节点（NPU 托盘 / 服务器，8 NPU）', 'nodes (NPU trays / servers, 8 NPUs)')], ['qingtian', T('擎天卡', 'Qingtian cards')],
    ['sec', T('机柜与超节点', 'Cabinets and SuperPoDs')], ['cabinet', T('计算柜', 'compute cabinets')], ['pod', T('超节点 / UB 域', 'SuperPoDs / UB domains')], ['commCabinet', T('互联柜 / 通信柜（UB 交换）', 'UB / communication cabinets')],
    ['sec', T('UB 交换网络', 'UB fabric')], ['ubRackSwitch', T('UB 交换芯片：柜内 LRS / LinkBlade', 'UB switch chips: in-cabinet LRS / LinkBlade')], ['ubPodSwitch', T('UB 交换芯片：超节点层（光 / LinkDevice）', 'UB switch chips: pod tier (optical / LinkDevice)')], ['ubL1', T('UB 交换芯片：L1（节点内）', 'UB switch chips: L1 (in node)')], ['ubL2', T('UB 交换芯片：L2（通信柜）', 'UB switch chips: L2 (comm. cabinets)')],
    ['ubSum', T('UB 交换芯片合计', 'UB switch chips, total')], ['ubMeshLink', T('UB 电链路（柜内 / 托盘内全互联）', 'UB electrical mesh links')], ['ubRackMesh', T('UB 电链路（柜间全互联）', 'UB electrical rack-to-rack links')], ['ubLink', T('UB 光链路', 'UB optical links')], ['npoEngine', T('NPO 光引擎', 'NPO optical engines')], ['ubTransceiver', T('UB 光模块（链路两端）', 'UB transceivers (both ends)')],
  ];
  // rows the main designs carry that the list above does not name (scale-out rows are Table 2; rate-only rows have no count)
  const known = new Set(T1.map(([id]) => id));
  const extra = uniq(MAIN.flatMap((d) => d.rows.filter((r) => !known.has(r.id) && r.level !== 'scale-out' && r.level !== 'cluster' && !r.noCount && r.count > 0).map((r) => r.id)));
  const t1rows = [...T1.filter(([id]) => id === 'sec' || id === 'ubSum' || MAIN.some((d) => rowOf(d, id))), ...(extra.length ? [['sec', T('其他部件', 'Other parts')], ...extra.map((id) => [id, MAIN.find((d) => rowOf(d, id)).rows.find((r) => r.id === id).name[lang]])] : [])];
  const t1 = `<div class="table-wrap"><table class="s1"><thead><tr><th>${esc(T('部件（数量；下行：每千 NPU · 置信度）', 'Part (count; second line: per 1,000 NPUs · confidence)'))}</th>${MAIN.map((d) => `<th class="num">${esc(d.name[lang])}</th>`).join('')}</tr></thead><tbody>${t1rows.map(([id, l]) => {
    if (id === 'sec') return `<tr class="sec"><td colspan="${MAIN.length + 1}">${esc(l)}</td></tr>`;
    if (id === 'ubSum') return `<tr class="sum"><td class="b">${esc(l)}</td>${MAIN.map((d) => `<td class="num b">${fmt(d.counts.ubSwitches)}<br><span class="src">${r1k(k1(d.counts.ubSwitches))}</span></td>`).join('')}</tr>`;
    return `<tr><td>${esc(l)}</td>${MAIN.map((d) => cell(d, id)).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;

  /* ---------- Table 2: scale-out part, by variant (one table per family; identical for the family's architectures) ---------- */
  const t2 = (f) => {
    const a0 = ARCHS.find((a) => D[`${a}-main`].family === f);
    const ds = SOS[f].map((s) => D[`${a0}-${s}`]);
    const R2 = [
      [T('每 NPU 口数', 'ports per NPU'), (d) => fmt(d.scaleOut.portsPerNpu)], [T('平面', 'planes'), (d) => fmt(d.scaleOut.planes)], [T('交换机端口数 radix', 'switch radix'), (d) => fmt(d.scaleOut.radix)],
      [T('叶层收敛比', 'leaf oversubscription'), (d) => `${fmt(d.scaleOut.oversubscription)}:1`], [T('层数', 'tiers'), (d) => fmt(d.counts.scaleOutTiers)], [T('每层交换机（第 1 层起）', 'switches per tier (tier 1 first)'), (d) => d.counts.scaleOutPerTier.map((v) => fmt(v)).join(' / ')],
      ['sum', T('交换机合计', 'switches, total'), (d) => fmt(d.counts.scaleOutSwitches)], [T('光链路（NPU–叶 + 层间）', 'optical links'), (d) => fmt(d.counts.scaleOutLinks)], [T('光模块（链路两端）', 'transceivers'), (d) => fmt(d.counts.scaleOutTransceivers)],
      ['sec', T('每千 NPU', 'per 1,000 NPUs')], [T('交换机', 'switches'), (d) => r1k(k1(d.counts.scaleOutSwitches))], [T('光链路', 'optical links'), (d) => r1k(k1(d.counts.scaleOutLinks))], [T('光模块', 'transceivers'), (d) => r1k(k1(d.counts.scaleOutTransceivers))],
    ];
    return `<div class="table-wrap"><table class="s2"><thead><tr><th>${esc(FN(f))}</th>${ds.map((d) => `<th class="num">${esc(d.soName[lang])}</th>`).join('')}</tr></thead><tbody>${R2.map((r) => {
      if (r[0] === 'sec') return `<tr class="sec"><td colspan="${ds.length + 1}">${esc(r[1])}</td></tr>`;
      const [l, g, cls] = r[0] === 'sum' ? [r[1], r[2], ' class="sum"'] : [r[0], r[1], ''];
      return `<tr${cls}><td>${esc(l)}</td>${ds.map((d) => `<td class="num">${g(d)}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
  };

  /* ---------- Table 3: reliability consequence ---------- */
  const FU = [['npu', 'NPU'], ['job', T('作业级', 'job')], ['cpu', 'CPU'], ['node', T('节点', 'node')], ['cabinet', T('计算柜', 'cabinet')], ['ub-switch', T('UB 交换', 'UB switch')], ['ub-link', T('UB 链路', 'UB link')], ['roce-switch', T('SO 交换', 'SO switch')], ['roce-link', T('SO 链路', 'SO link')]];
  const t3 = `<div class="table-wrap"><table class="s3"><thead><tr><th>${esc(T('设计（架构 · scale-out 变体）', 'Design (architecture · scale-out variant)'))}</th>${FU.map(([, l]) => `<th class="num">${esc(l)}</th>`).join('')}<th class="num">${esc(T('合计 FIT / NPU', 'total FIT per NPU'))}</th><th class="num">${esc(T('作业中断 / h', 'job interruptions per h'))}</th><th class="num">MTBI (h)</th><th class="num">${esc(T('今天 A_op', 'A_op today'))}</th></tr></thead><tbody>${FAMS.map((f) => `<tr class="sec"><td colspan="${FU.length + 5}">${esc(FN(f))}</td></tr>` + famDs(f).map((d) => `<tr><td class="nw${d.main ? ' b' : ''}">${esc(lab(d))}</td>${FU.map(([k]) => `<td class="num">${fmt(d.hardFitPerNpu[k] ?? 0, 1)}</td>`).join('')}<td class="num b">${fmt(d.hardFitPerNpuTotal, 1)}</td><td class="num">${fmt(d.hardPerHour, 3)}</td><td class="num">${fmt(d.mtbiH, 2)}</td><td class="num">${pct(d.aOp, 3)}</td></tr>`).join('')).join('')}</tbody></table></div>`;

  /* ---------- Table 4: the built-in scales ---------- */
  const C4 = [[T('超节点', 'SuperPoDs'), 'supernodes'], [T('计算柜', 'compute cabinets'), 'racks'], [T('节点', 'nodes'), 'nodes'], [T('UB 交换芯片', 'UB switch chips'), 'ubSwitches'], [T('UB 光链路', 'UB optical links'), 'opticalLinks'], [T('SO 交换机', 'SO switches'), 'scaleOutSwitches'], [T('SO 光链路', 'SO optical links'), 'scaleOutLinks']];
  const t4 = `<div class="table-wrap"><table class="s4"><thead><tr><th>${esc(T('规模（NPU）', 'Size (NPUs)'))}</th>${C4.map(([l]) => `<th class="num">${esc(l)}</th>`).join('')}</tr></thead><tbody>${ARCHS.map((a) => `<tr class="sec"><td colspan="${C4.length + 1}">${esc(D[`${a}-main`].name[lang])} · ${esc(soShort(D[`${a}-main`]))}</td></tr>` + B.sizes.map((n) => `<tr><td>${esc(kN(n, lang))}</td>${C4.map(([, k]) => `<td class="num">${fmt(B.scales[a][String(n)].counts[k])}</td>`).join('')}</tr>`).join('')).join('')}</tbody></table></div>`;
  // the rounding example of the note: the main design and scale whose cabinets give the most NPU slots above the size
  const slots = (a, n) => { const c = B.scales[a][String(n)].counts; return c.racks * c.nodesPerRack * c.gpusPerNode; };
  const over = ARCHS.flatMap((a) => B.sizes.map((n) => ({ a, n, s: slots(a, n) / n }))).sort((x, y) => y.s - x.s)[0];
  const tiersNote = ARCHS.map((a) => { const t = B.sizes.map((n) => B.scales[a][String(n)].counts.scaleOutTiers), tm = B.scales[a][String(N)].counts.scaleOutTiers, diff = B.sizes.filter((n, i) => t[i] !== tm); return diff.length ? T(`${AN(D[`${a}-main`])} 的 scale-out 在 ${diff.map((n) => kN(n, 'zh')).join('、')}卡时为 ${uniq(diff.map((n) => B.scales[a][String(n)].counts.scaleOutTiers)).join(' / ')} 层`, `the ${AN(D[`${a}-main`])} scale-out needs ${uniq(diff.map((n) => B.scales[a][String(n)].counts.scaleOutTiers)).join(' / ')} tiers at ${diff.map((n) => kN(n, 'en')).join(', ')}`) : null; }).filter(Boolean);
  const note4 = T(`同一模板在 ${B.sizes.map((n) => kN(n, 'zh')).join('、')} NPU 的部件数（超节点、柜向上取整${over && over.s > 1.0005 ? `，所以 ${AN(D[`${over.a}-main`])} 在 ${kN(over.n, 'zh')}卡时的计算柜容量是 ${fmt(slots(over.a, over.n))} 卡` : ''}）。${tiersNote.length ? `${tiersNote.join('；')}。` : ''}`,
    `The same templates at ${B.sizes.map((n) => kN(n, 'en')).join(', ')} NPUs (SuperPoDs and cabinets rounded up${over && over.s > 1.0005 ? `, so ${AN(D[`${over.a}-main`])} at ${kN(over.n, 'en')} has ${fmt(slots(over.a, over.n))} NPU slots in its cabinets` : ''}).${tiersNote.length ? ` ${tiersNote.map((s) => s[0].toUpperCase() + s.slice(1)).join('; ')}.` : ''}`);

  /* ---------- Figure 1: small multiples ---------- */
  function figParts() {
    const head = titleBlock(T(`图 1：${B.designs.length} 个设计的部件密度——UB 交换芯片与 scale-out 交换机（每千 NPU），光链路与光模块（每 NPU，实色 = UB、描边色块 = scale-out）`, `Figure 1: part density of the ${B.designs.length} designs — UB switch chips and scale-out switches (per 1,000 NPUs), optical links and transceivers (per NPU; solid = UB, outlined = scale-out)`));
    let g = svgDyn(`fig-parts-${lang}`, T('部件密度', 'Part density')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    const LW = 14 + Math.max(...ORDER.map((d) => tw(lab(d), sz(9.8)))) + 10, gap = 14, PW = (W - LW - 14 - 3 * gap) / 4, bh = 13, step = 18, fgap = 12, top = 66;
    const P = [
      [T('UB 交换芯片 / 千 NPU', 'UB switch chips / 1k NPUs'), (d) => [k1(d.counts.ubSwitches), 0], r1k],
      [T('scale-out 交换机 / 千 NPU', 'SO switches / 1k NPUs'), (d) => [0, k1(d.counts.scaleOutSwitches)], r1k],
      [T('光链路 / NPU（UB + SO）', 'optical links / NPU'), (d) => [pn(d.counts.opticalLinks), pn(d.counts.scaleOutLinks)], (v) => fmt(v, 1)],
      [T('光模块 / NPU（UB + SO）', 'transceivers / NPU'), (d) => [pn(d.counts.transceivers), pn(d.counts.scaleOutTransceivers)], (v) => fmt(v, 1)],
    ];
    const famIdx = (d) => FAMS.indexOf(d.family);
    const yOf = (i) => top + i * step + famIdx(ORDER[i]) * fgap;
    const solid = (f) => `var(--s${(FAMS.indexOf(f) % 5) + 1})`, outlined = (f) => (FAMS.indexOf(f) < 2 ? `var(--b${FAMS.indexOf(f) + 1})` : 'var(--surface)');
    ORDER.forEach((d, i) => { g += `<text x="${LW - 8}" y="${yOf(i) + bh - 3}" class="s" text-anchor="end"${d.main ? ' style="font-weight:600"' : ''}>${esc(lab(d))}</text>`; });
    const yEnd = yOf(ORDER.length - 1) + bh + 6;
    P.forEach(([ttl, val, f], p) => {
      const x0 = LW + p * (PW + gap), vmax = Math.max(...ORDER.map((d) => val(d)[0] + val(d)[1])), bw = PW - 44, X = (v) => (vmax > 0 ? (v / vmax) * bw : 0);
      g += `<text x="${x0}" y="${top - 26}" class="sb">${esc(ttl)}</text><line x1="${x0}" y1="${top - 6}" x2="${x0}" y2="${yEnd}" class="axis"/>`;
      ORDER.forEach((d, i) => {
        const [a, b] = val(d), y = yOf(i);
        if (a > 0) g += `<rect x="${x0}" y="${y}" width="${Math.max(X(a), 0.8).toFixed(1)}" height="${bh}" rx="1.5" style="fill:${solid(d.family)}"/>`;
        if (b > 0) g += `<rect x="${(x0 + X(a)).toFixed(1)}" y="${y}" width="${Math.max(X(b), 0.8).toFixed(1)}" height="${bh}" rx="1.5" style="fill:${p >= 2 ? `${outlined(d.family)};stroke:${solid(d.family)};stroke-width:0.8` : solid(d.family)}"/>`;
        g += `<text x="${(x0 + X(a + b) + 4).toFixed(1)}" y="${y + bh - 3}" class="tiny">${esc(f(a + b))}</text>`;
      });
    });
    const lg = legend(LW, yEnd + 20, FAMS.flatMap((f) => [{ style: `fill:${solid(f)}`, label: T(`${f} 家族（UB 或 SO 交换）`, `${f} family (UB or SO switches)`) }, { style: `fill:${outlined(f)};stroke:${solid(f)}`, label: T(`${f} 家族 · scale-out 部分`, `${f} family · scale-out part`) }]));
    g += lg.g;
    return svgClose(g, lg.y + 12 + head.dy);
  }

  const asm = (d) => d.assumed.map((x) => txt(x, lang)).join(sep);
  const narch = countWord(MAIN.length, 'zh').replace(/个$/, '种');
  const sub = `<p class="sub">${T(`<b>口径</b>：每个数字都是 HAC-D 拓扑模板（<code>topologyBom</code>）在恰好 ${fmt(N)} 张 NPU 时的部件数（超节点、柜按向上取整），每行注明置信度（论文 / 厂商 / 推导 / 假设 / 用户）。${narch}架构中厂商或论文给定的是超节点、柜与节点的几何，其余为假设（各记录的 provenance 字段注明来源与置信度）：`, `<b>Basis</b>: every number is a part count of HAC-D’s topology templates (<code>topologyBom</code>) at exactly ${fmt(N)} NPUs (SuperPoDs and cabinets rounded up); each row carries its confidence (paper / vendor / derived / assumed / user). The SuperPoD, cabinet and node geometry of the ${countWord(MAIN.length, 'en')} architectures is vendor- or paper-specified; the rest is assumed (each record’s provenance field names the source and confidence):`)}</p>
  <ul class="kf note">${MAIN.map((d) => `<li><b>${esc(d.name[lang])}</b>${T('：', ': ')}${esc(asm(d))}</li>`).join('')}</ul>
  <p class="sub">${T('scale-out 变体只改 RDMA / UBoE 网络（口数、平面、radix、收敛），同一家族的各架构在同一变体下 scale-out 数量相同（构建时已核对）；依据：', 'Scale-out variants change only the RDMA / UBoE network (ports, planes, radix, oversubscription); the architectures of a family have identical scale-out counts under the same variant (checked at build time). Basis: ')}${FAMS.map((f) => Object.entries(B.scaleOutDesigns[f] ?? {}).map(([s, v]) => `<b>${esc(SHORT[s]?.[lang] ?? (s === 'main' ? soShort(D[`${famMain(f)[0].arch}-main`]) : s))}</b>${FAMS.length > 1 ? ` (${esc(f)})` : ''} — ${esc(v.basis[lang])}`).join(sep)).join(sep)}${T('。', '.')}</p>`;

  const rateTex = tex(String.raw`\lambda=\sum_u n_u\,\mathrm{FIT}_u\cdot10^{-9}`), mtbiTex = tex(String.raw`\mathrm{MTBI}=1/\lambda`);
  // A4 pages (print): title, basis and Table 1 · Table 2 and Table 3 · figure and Table 4; a long design list (> 18 designs or
  // > 4 architectures) gets Table 2 and Table 3 on pages of their own, so that no section spills over an A4 page
  const wide = B.designs.length > 18 || MAIN.length > 4;
  const noteT2 = `<p class="note">${T('交换机 = 台数（每台一个交换芯片）；光链路 = NPU–叶 + 层间上联；光模块 = 光链路 × 2；层数 = Clos 接下全部 NPU 口的最少层数；收敛只在叶层；置信度：假设（RDMA 口数为论文 / 厂商）。', 'Switches = boxes (one chip each); links = NPU–leaf + inter-tier; transceivers = links × 2; tiers = the fewest a Clos needs; oversubscription at the leaves only; confidence assumed (RDMA ports: paper / vendor).')}</p>`;
  const secT2 = `<h3 class="first">${esc(T('表 2：scale-out 部分（按设计变体；同一家族各架构相同）', 'Table 2: Scale-out part (by design variant; identical for the architectures of a family)'))}</h3>
  ${FAMS.map(t2).join('')}
  ${noteT2}`;
  const secT3 = `<h3${wide ? ' class="first"' : ''}>${esc(T(`表 3：可靠性后果（${B.designs.length} 个设计，硬中断 FIT / NPU 按故障单元）`, `Table 3: Reliability consequence (${B.designs.length} designs, hard FIT per NPU by fault unit)`))}</h3>
  ${t3}
  <p class="note">${T(`FIT = 造成业务中断的硬故障 / 10⁹ 单元·小时，HAC-D 按硬件单元的口径；“每 NPU”= 单元数 × 单元 FIT ÷ NPU 数。作业中断率 ${rateTex}（一个同步作业占满全部 NPU，次 / h），${mtbiTex}；今天 A_op 按 ASCEND_ALLOCATION_METHODOLOGY 公式 (1)（30 天窗口、一个同步作业、六个参考机制）。SO = scale-out；其交换机与链路用 RoCE 类比 FIT（@roce，置信度“假设”）。亚健康与静默损坏不计入本表。`, `FIT = business-interrupting hard failures per 10⁹ unit-hours on HAC-D’s per-unit basis; “per NPU” = units × unit FIT ÷ NPUs. Job interruption rate ${rateTex} (one synchronous job on every NPU, per hour), ${mtbiTex}; A_op today per formula (1) of ASCEND_ALLOCATION_METHODOLOGY (30-day window, one synchronous job, six reference mechanisms). SO = scale-out; its switches and links use the RoCE analogue FIT (@roce, confidence assumed). Sub-health and silent corruption are not in this table.`)}</p>`;
  const secFig = `<figure class="chart${wide ? ' first' : ''}"><div class="scroll">${figParts()}</div></figure>`;
  const secT4 = `<h3${wide ? '' : ' class="first"'}>${esc(T(`表 4：${countWord(B.sizes.length, 'zh')}规模的数量（主设计）`, `Table 4: Counts at the ${countWord(B.sizes.length, 'en')} scales (main designs)`))}</h3>
  ${t4}
  <p class="note">${note4}</p>
  <footer>${T(`${PROV ? provenanceFooter(PROV, lang, ['bom.json'], DATE) : `数据：<code>bom.json</code>（${esc(DATE)}，HAC-D bomDocument）。复现：<code>hacd bom --records …</code>。`}数量是 HAC-D 拓扑模板的几何推算，不是厂商物料清单（BOM）。`, `${PROV ? provenanceFooter(PROV, lang, ['bom.json'], DATE) : `Data: <code>bom.json</code> (${esc(DATE)}, HAC-D bomDocument). Reproduce: <code>hacd bom --records …</code>. `}Counts are HAC-D topology-template geometry, not vendor bills of materials.`)}</footer>`;
  return [
    `<h1>${esc(T(`${kN(N, 'zh')}卡集群的硬件组件数量：${narch}拓扑与其 scale-out 设计变体`, `Hardware component counts of a ${kN(N, 'en')}-NPU cluster: ${countWord(MAIN.length, 'en')} topologies and their scale-out design variants`))}</h1>
  ${sub}
  <div class="callout"><ul>${keys.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h3>${esc(T('表 1：scale-up 部分（超节点内，主设计）', 'Table 1: Scale-up part (inside the SuperPoD, main designs)'))}</h3>
  ${t1}
  <p class="note">${T('“—”= 该架构没有此部件；0 = 模板有此行但数量为 0。UB 交换芯片合计 = 同类（交换芯片）相加；电链路与光链路分列，不相加。', '“—” = the architecture has no such part; 0 = the template has the row with count 0. The total adds switch chips only; electrical and optical links are never added.')}</p>`,
    ...(wide ? [secT2, `${secT3}
  ${secFig}`, secT4] : [`${secT2}
  ${secT3}`, `${secFig}
  ${secT4}`]),
  ];
}

const eyebrow = (lang, DATE, N) => (i, n) => (lang === 'zh' ? `HAC-D · ${kN(N, 'en')} BOM · ${DATE} · 第 ${i} / ${n} 页` : `HAC-D · ${kN(N, 'en')} BOM · ${DATE} · page ${i} / ${n}`);
const extraCss = `
  figure.chart.first { margin-top: 4px; }
  span.src { color: var(--muted); font-size: 0.86em; white-space: nowrap; }
  table.s1 td:first-child { min-width: 13em; } table.s2 th.num { min-width: 9em; } table.s2 td:first-child { white-space: nowrap; } table.s3 th.num { white-space: normal; }
  @media screen and (max-width: 760px) { .table-wrap table.s2 { min-width: 640px; } }
  @media print { table.s1 td, table.s1 th { padding: 0.5px 2.4px; line-height: 1.15; } ul.kf { margin: 1px 0; } ul.kf li { margin: 0; } }
`;

/** the BOM page as an HTML string; throws on inconsistent data (scale-out parts, design list, FIT and rate sums, scales vs. main design) and on undefined / NaN in the output */
export function bomHtml({ bom, provenance }) {
  const B = bom;
  const DATE = new Date(B.generated).toLocaleDateString('sv-SE');
  const N = B.npus;
  const D = Object.fromEntries(B.designs.map((d) => [d.id, d]));
  // families, architectures and variants in the data's order (bomDocument: records → variants)
  const FAMS = uniq(B.designs.map((d) => d.family));
  const ARCHS = FAMS.flatMap((f) => uniq(B.designs.filter((d) => d.family === f).map((d) => d.arch)));
  const SOS = Object.fromEntries(FAMS.map((f) => [f, uniq(B.designs.filter((d) => d.family === f).map((d) => d.so))]));
  const ORDER = FAMS.flatMap((f) => ARCHS.filter((a) => D[`${a}-main`]?.family === f).flatMap((a) => SOS[f].map((s) => D[`${a}-${s}`])));
  const MAIN = ARCHS.map((a) => D[`${a}-main`]);

  /* ---------------- consistency checks on the data ---------------- */
  if (ORDER.length !== B.designs.length || ORDER.some((d) => !d)) throw new Error(`design list incomplete: every architecture of a family must carry every variant of the family (${FAMS.map((f) => `${f}: ${SOS[f].join(', ')}`).join('; ')})`);
  if (MAIN.some((d) => !d)) throw new Error('every record needs a main design');
  for (const f of FAMS) {
    const as = ARCHS.filter((a) => D[`${a}-main`].family === f);
    for (const s of SOS[f]) for (let i = 1; i < as.length; i++) {
      const x = D[`${as[0]}-${s}`], y = D[`${as[i]}-${s}`];
      for (const k of SOKEYS) if (x.counts[k] !== y.counts[k]) throw new Error(`scale-out ${k} differs: ${x.id} vs ${y.id}`);
      if (x.counts.scaleOutPerTier.join() !== y.counts.scaleOutPerTier.join()) throw new Error(`scale-out tiers differ: ${x.id} vs ${y.id}`);
      if (JSON.stringify(x.scaleOut) !== JSON.stringify(y.scaleOut)) throw new Error(`scale-out parameters differ: ${x.id} vs ${y.id}`);
    }
  }
  for (const d of B.designs) {
    const s = Object.values(d.hardFitPerNpu).reduce((a, v) => a + v, 0) + d.hardFitPerNpuOther;
    if (Math.abs(s - d.hardFitPerNpuTotal) > 1e-6 * s) throw new Error(`FIT split does not sum: ${d.id}`);
    if (d.counts.gpus !== N) throw new Error(`NPU count ${d.id}`);
    const rate = d.rows.reduce((a, r) => a + (r.hardPerHour ?? 0), 0);
    if (Math.abs(rate - d.hardPerHour) > 1e-9) throw new Error(`job rate does not sum: ${d.id}`);
  }
  for (const a of ARCHS) if (JSON.stringify(B.scales[a][String(N)].counts) !== JSON.stringify(D[`${a}-main`].counts)) throw new Error(`scales ≠ main design: ${a}`);

  const k1 = (n) => (1000 * n) / N; // per 1,000 NPUs
  const pn = (n) => n / N; // per NPU
  const ctx = { B, DATE, N, D, FAMS, ARCHS, SOS, ORDER, MAIN, k1, pn, PROV: provenance };
  const html = pageShell({
    title: `HAC-D · ${kN(N, 'en')} BOM`,
    description: `Hardware component counts of ${countWord(MAIN.length, 'en')} Ascend topologies and their scale-out variants at ${fmt(N)} NPUs, with the reliability consequence.`,
    zhBody: pages(body('zh', ctx), eyebrow('zh', DATE, N)),
    enBody: pages(body('en', ctx), eyebrow('en', DATE, N)),
    extraCss,
  });
  const bad = html.replace(/<(style|script)>[\s\S]*?<\/\1>/g, '').match(/.{0,60}\b(undefined|NaN)\b.{0,30}/g);
  if (bad) throw new Error(`undefined / NaN in output: ${bad.join(' … ')}`);
  return html;
}
