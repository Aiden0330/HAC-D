#!/usr/bin/env node
/**
 * Build docs/ASCEND950_SCALING_RELIABILITY.{zh,en}.html from docs/ascend950-scaling/results.json (scripts/ascend950-scaling.ts):
 * the two Ascend 950 SuperPoD architectures (Huawei native Atlas 950, 1,024 NPUs; SuperPoD Flex / UBL128, 128 NPUs) at 10k / 100k /
 * 200k / 500k NPUs — (1) hardware scaling and reliability table, (2) two architecture mapping tables (SuperPoD ↔ cabinet ↔ node ↔
 * NPU ↔ components), (3) bottleneck analysis (where interruptions and downtime come from, scale by scale, single points of failure,
 * sensitivities), (4) the attached report's 512,000-NPU bill of materials recomputed. Figures from scripts/ascend950-figures.mjs.
 * Usage: node scripts/build-ascend950-scaling.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { esc, fmt, figNative, figUbl128, svgOpen, titleBlock, legend, wrap, lines, tw } from './ascend950-figures.mjs';
import { loadShapley, shapleySection } from './shapley-figure.mjs';

const R = JSON.parse(readFileSync('docs/ascend950-scaling/results.json', 'utf8'));
const DATE = R.generated.slice(0, 10);
const SIZES = R.sizes;
const ARCHS = ['native', 'ubl128'];
const S = (a, n) => R.archs[a].sizes[String(n)];
const pct = (x, d = 3) => `${(x * 100).toFixed(d)} %`;
const kN = (n) => (n >= 1000 ? `${fmt(n / 1000)}k` : fmt(n));
const kM = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : kN(n));

function page(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const hShort = (h) => (h >= 10 ? `${fmt(h, 1)} h` : h >= 1 ? `${fmt(h, 2)} h` : `${fmt(h * 60)} min`);
  const hrs = (h) => (h >= 10 ? `${fmt(h, 1)} h` : h >= 1 ? `${fmt(h, 2)} h` : T(`${fmt(h, 3)} h（${fmt(h * 60)} min）`, `${fmt(h, 3)} h (${fmt(h * 60)} min)`));
  const days = (h) => (h >= 24 * 365 ? T(`${fmt(h / 8760, 1)} 年`, `${fmt(h / 8760, 1)} y`) : h >= 48 ? T(`${fmt(h / 24)} 天`, `${fmt(h / 24)} d`) : `${fmt(h, 1)} h`);
  const NAME = { native: T('原生 950', 'Native 950'), ubl128: 'UBL128' };
  const UNIT = {
    job: T('作业级共享服务（共享存储、未归因 / 软件）', 'Job-level shared services (shared storage, unattributed / software)'),
    node: T('节点（DDR、SSD、板级 IO、管理 BMC / UBM）', 'Node (DDR, SSD, board IO, management BMC / UBM)'),
    cabinet: T('计算柜（供电、液冷）', 'Compute cabinet (power, liquid cooling)'),
    npu: T('NPU（计算核、片上 SRAM、IO Die、HBM、UB 网口）', 'NPU (cores, SRAM, IO die, HBM, UB ports)'),
    'ub-switch': T('UB 交换（柜内 LRS + 超节点层）', 'UB switch (in-cabinet LRS + pod tier)'),
    'ub-link': T('UB 800G 光链路', 'UB 800G optical link'),
    cpu: T('鲲鹏 CPU', 'Kunpeng CPU'),
    'roce-switch': T('scale-out 交换机', 'Scale-out switch'),
    'roce-link': T('scale-out 光链路', 'Scale-out optical link'),
  };
  const UNITS = ['job', 'node', 'cabinet', 'npu', 'ub-switch', 'cpu', 'roce-link', 'ub-link', 'roce-switch'];
  const ENDS = (e) => [['replay', T('重执行', 'replay')], ['elastic', T('弹性', 'elastic')], ['process', T('进程', 'process')], ['global', T('全局', 'global')]].filter(([k]) => (e[k] ?? 0) > 0.0005).map(([k, l]) => `${l} ${fmt((e[k] ?? 0) * 100)} %`).join(' · ');
  const n500 = S('native', 500000), u500 = S('ubl128', 500000), n200 = S('native', 200000), u200 = S('ubl128', 200000), n10 = S('native', 10000);
  const thrN = R.archs.native.thresholds, thrU = R.archs.ubl128.thresholds;
  const mN = R.archs.native.mapping, mU = R.archs.ubl128.mapping;
  const so = R.scaleOut.main.so;
  // classes without a fast recovery rung (every event ends in the global recovery): their share of interruptions and of downtime
  const noRung = (x) => { const d = Object.values(x.breakdown.domains).filter((v) => v.pGlobal > 0.999); return { ev: d.reduce((a, v) => a + v.lam, 0) / x.kpi.lamHw, dt: d.reduce((a, v) => a + v.lp, 0) / x.kpi.sumLP }; };
  const nr500 = noRung(n500);
  /* ---------------- 1. hardware scaling and reliability table ---------------- */
  const row = (label, get, opts = {}) => ({ label, get, ...opts });
  const sec = (label) => ({ section: label });
  const T1 = [
    sec(T('机柜', 'Racks')),
    row(T('计算柜（64 NPU / 柜）', 'Compute cabinets (64 NPUs each)'), (s) => fmt(s.counts.racks), { src: T('产品页', 'product page') }),
    row(T('网络柜 · UB 域：原生为灵衢互联柜（4 / 超节点）；UBL128 为交换柜（1 / 4 个超节点）', 'Network racks · UB domain: native UB interconnect cabinets (4 per pod); UBL128 switch cabinets (1 per 4 pods)'), (s) => fmt(s.counts.commRacks), { src: T('产品页；UBL128 假设', 'product page; UBL128 assumed') }),
    row(T(`网络柜 · scale-out（估算：每柜 ${R.constants.scaleOutSwitchesPerRack} 台 radix-1,024 交换机）`, `Network racks · scale-out (estimate: ${R.constants.scaleOutSwitchesPerRack} radix-1,024 switches per rack)`), (s) => fmt(s.derived.scaleOutRacks), { src: T('假设', 'assumed') }),
    row(T('机柜合计（不含存储、管理与供电制冷配套）', 'Racks in total (storage, management, power and cooling plant not counted)'), (s) => fmt(s.derived.racksTotal), { bold: true }),
    sec(T('计算', 'Compute')),
    row(T('超节点', 'SuperPoDs'), (s) => fmt(s.counts.supernodes), { src: T('⌈N ÷ 超节点卡数⌉', '⌈N ÷ pod size⌉') }),
    row(T('节点 = NPU 托盘（8 NPU）', 'Nodes = NPU trays (8 NPUs)'), (s) => fmt(s.counts.nodes), { src: 'LightCounting' }),
    row(T('CPU（鲲鹏 950，每节点 2）', 'CPUs (Kunpeng 950, 2 per node)'), (s) => fmt(s.counts.cpus), { src: T('产品页 16 / 柜', 'product page 16 per cabinet') }),
    row(T('HBM 合计（96 GB / NPU，PB）', 'HBM in total (96 GB per NPU, PB)'), (s) => fmt(s.derived.hbmTB / 1000, 2), { src: T('产品页', 'product page') }),
    sec(T('UB scale-up 网络', 'UB scale-up network')),
    row(T('柜内低阶 UB 交换 LRS（原生 72 / 柜；UBL128 0）', 'In-cabinet low-radix UB switches LRS (native 72 per cabinet; UBL128 0)'), (s) => fmt(s.counts.rackSwitches), { src: T('UB-Mesh 论文；UBL128 假设', 'UB-Mesh paper; UBL128 assumed') }),
    row(T('超节点层 UB 交换机（128 × 800G）', 'Pod-tier UB switches (128 × 800G)'), (s) => fmt(s.counts.podSwitches), { src: T('推算 / 假设', 'derived / assumed') }),
    row(T('柜内电链路（原生柜内 2D 全互联；UBL128 仅托盘内）', 'In-cabinet electrical links (native 2D full mesh; UBL128 tray mesh only)'), (s) => fmt(s.counts.meshLinks), { src: T('论文；推算', 'paper; derived') }),
    row(T('UB 800G 光链路（原生 2 / NPU，UBL128 4 / NPU）', 'UB 800G optical links (native 2 per NPU, UBL128 4)'), (s) => fmt(s.counts.opticalLinks), { src: T('LightCounting；UBL128 由 3.2 Tb/s 推算', 'LightCounting; UBL128 from 3.2 Tb/s') }),
    row(T('UB 800G 光模块（链路两端）', 'UB 800G transceivers (both link ends)'), (s) => fmt(s.counts.transceivers), { src: T('LightCounting 4 / NPU', 'LightCounting 4 per NPU') }),
    sec(T(`scale-out（主算例：${so.planes} 平面 × 两层 Clos，radix ${fmt(so.radix)}，每 NPU ${so.portsPerNpu} × 200G）`, `Scale-out (main case: ${so.planes} planes × two-tier Clos, radix ${fmt(so.radix)}, ${so.portsPerNpu} × 200G per NPU)`)),
    row(T('端口', 'Ports'), (s) => fmt(s.counts.scaleOutPorts), { src: T('白皮书 2 × 400G 拆分', 'white paper 2 × 400G split') }),
    row(T('叶交换机 / 脊交换机', 'Leaf / spine switches'), (s) => `${fmt(s.counts.scaleOutPerTier[0])} / ${fmt(s.counts.scaleOutPerTier[1])}`, { src: T('假设（Clos 计数）', 'assumed (Clos counting)') }),
    row(T('链路 / 光模块', 'Links / transceivers'), (s) => `${kM(s.counts.scaleOutLinks)} / ${kM(s.counts.scaleOutTransceivers)}`, { src: T('假设', 'assumed') }),
    sec(T('供电', 'Power')),
    row(T('计算柜 IT 功耗（MW，约 100 kW / 柜；不含网络柜与制冷）', 'Compute-cabinet IT power (MW, ≈ 100 kW per cabinet; network racks and cooling excluded)'), (s) => fmt(s.derived.computeCabinetMW, 1), { src: T('产品页', 'product page') }),
    sec(T('可靠性（六个默认机制，同步训练作业）', 'Reliability (six default mechanisms, one synchronous training job)')),
    row(T('硬件中断率（FIT / NPU，业务影响）', 'Hardware interruption rate (FIT per NPU, business impact)'), (s) => fmt(s.hardFitPerNpuTotal), { src: T('目录 × 单元数', 'catalog × unit counts') }),
    row(T('硬件中断（次 / 天）', 'Hardware interruptions per day'), (s) => fmt(s.kpi.lamHw * 24, 1), { src: 'λ_hw × 24' }),
    row(T('MTBF_hw（集群级，硬件中断间隔）', 'MTBF_hw (cluster level, between hardware interruptions)'), (s) => hShort(s.kpi.mtbfHwH), { src: '1 / λ_hw', bold: true }),
    row(T('MTTR_hw（每次中断的平均暂停）', 'MTTR_hw (mean pause per interruption)'), (s) => `${fmt(s.kpi.mttrS, 1)} s`, { src: 'Σ λᵢ t̄ᵢ / λ_hw', bold: true }),
    row(T('其他暂停：亚健康隔离 + 静默检出（次 / 天）', 'Other pauses: isolation of sub-healthy units + detected silent corruption (per day)'), (s) => `${fmt(s.kpi.other[0].ratePerHour * 24, 2)} + ${fmt(s.kpi.other[1].ratePerHour * 24, 2)}`, { src: T('252 s / 3 s 每次', '252 s / 3 s each') }),
    row(T('系统可用度 A_op', 'System availability A_op'), (s) => pct(s.kpi.aOp), { src: T('见下式；= ReMAP 的“运行可用度”', 'formula below; = ReMAP’s “operational availability”'), bold: true, cls: (s) => (s.kpi.aOp < 0.985 ? 'bad' : s.kpi.aOp < 0.99 ? 'mid' : '') }),
    row(T('正确有效产出（保留的正确进度 ÷ 30 天窗口）', 'Delivered goodput (retained correct progress ÷ 30-day window)'), (s) => pct(s.kpi.delivered, 2), { src: T('= ReMAP 的“可用度”主指标', '= ReMAP’s headline “availability”') }),
    row(T('参照：两个仓库的原值（每卡 FIT，不做拓扑换算）A_op ／ 有效产出', 'Reference: the two repositories’ values (FIT per card, no topology conversion) A_op / goodput'), (s) => { const r = R.repoPerCard[String(s.npus)]; return `${pct(r.aOp, 2)} /\n${pct(r.delivered, 2)}`; }, { src: T('ReMAP / ai-cluster-reliability 目录，两架构相同', 'ReMAP / ai-cluster-reliability catalog; same for both'), wrap: true }),
    row(T('达到 98.5 % 需要：MTBF_hw ≥ ／ FIT / NPU ≤', 'Needed for 98.5 %: MTBF_hw ≥ / FIT per NPU ≤'), (s) => { const r = s.required[0]; return r.feasibleToday ? T(`满足（≤ ${fmt(r.fitPerNpuBudget)}）`, `met (≤ ${fmt(r.fitPerNpuBudget)})`) : `≥ ${fmt(r.mtbfReqH, 2)} h\n≤ ${fmt(r.fitPerNpuBudget)} (×${fmt(r.mtbfFactor, 1)})`; }, { src: 'B = 3600((1−φ)/A* − 1) − F', wrap: true }),
  ];
  const head1 = `<tr><th rowspan="2">${esc(T('项目', 'Item'))}</th>${SIZES.map((n) => `<th colspan="2" class="c">${esc(T(`${fmt(n / 10000)} 万 NPU`, `${kN(n)} NPUs`))}</th>`).join('')}<th rowspan="2">${esc(T('依据', 'Basis'))}</th></tr><tr>${SIZES.map(() => ARCHS.map((a) => `<th class="num">${esc(NAME[a])}</th>`).join('')).join('')}</tr>`;
  const body1 = T1.map((r) => {
    if (r.section) return `<tr class="sec"><td colspan="${2 + SIZES.length * 2}">${esc(r.section)}</td></tr>`;
    return `<tr${r.bold ? ' class="b"' : ''}><td>${esc(r.label)}</td>${SIZES.map((n) => ARCHS.map((a) => { const s = S(a, n); const c = r.cls ? r.cls(s) : ''; return `<td class="num${c ? ` ${c}` : ''}${r.wrap ? ' w' : ''}">${esc(r.get(s)).replace(/\n/g, '<br>')}</td>`; }).join('')).join('')}<td class="src">${esc(r.src ?? '')}</td></tr>`;
  }).join('');
  const table1 = `<div class="table-wrap"><table class="t1"><thead>${head1}</thead><tbody>${body1}</tbody></table></div>`;

  /* ---------------- 2. architecture mapping tables ---------------- */
  function mapTable(arch) {
    const m = R.archs[arch].mapping, it = m.items, f = m.fit;
    const s5 = S(arch, 500000);
    const U = s5.breakdown.units;
    const ends = (u) => (U[u] ? ENDS(U[u].ends) : '');
    const r = (v) => { if (v === 0) return '0'; if (v >= 1) return Number.isInteger(+v.toFixed(6)) ? fmt(v) : String(+v.toFixed(3)); const inv = 1 / v; return Math.abs(inv - Math.round(inv)) < 1e-6 ? `1/${fmt(Math.round(inv))}` : String(+v.toFixed(4)); };
    const line = (label, x, fitCell, impact, src) => `<tr><td>${esc(label)}</td><td class="num">${esc(r(x.perPod))}</td><td class="num">${esc(r(x.perRack))}</td><td class="num">${esc(r(x.perNode))}</td><td class="num">${esc(r(x.perNpu))}</td><td class="num">${esc(fitCell)}</td><td>${esc(impact)}</td><td class="src">${esc(src)}</td></tr>`;
    const native = arch === 'native';
    const podSwImpact = native ? T(`超节点跨柜带宽的 1/${fmt(it.podSwitch.perPod)}（${fmt(mN.npus / mN.pods)} 卡降级）`, `1/${fmt(it.podSwitch.perPod)} of the pod's cross-cabinet bandwidth (${fmt(mN.npus / mN.pods)} NPUs degraded)`) : T(`超节点 scale-up 带宽的 1/${fmt(it.podSwitch.perPod)}（128 卡降级 25 %）`, `1/${fmt(it.podSwitch.perPod)} of the pod's scale-up bandwidth (128 NPUs lose 25 %)`);
    const rows = [
      line(T('计算柜', 'Compute cabinet'), it.computeRack, fmt(f.cabinet), T(`64 NPU；${ends('cabinet')}`, `64 NPUs; ${ends('cabinet')}`), T('产品页', 'product page')),
      line(native ? T('灵衢互联柜', 'UB interconnect cabinet') : T('交换柜（4 个超节点共用）', 'Switch cabinet (shared by 4 pods)'), it.networkRack, T('计入交换', 'in the switches'), native ? T('4 台超节点层交换机（1/4 跨柜带宽）', '4 pod-tier switches (1/4 of the cross-cabinet bandwidth)') : T('若一柜装 4 个超节点的全部交换机：512 卡失去 scale-up', 'if one cabinet holds all switches of 4 pods: 512 NPUs lose scale-up'), native ? T('产品页', 'product page') : T('附件估算（假设）', 'attachment estimate (assumed)')),
      line(T('节点 = NPU 托盘（含 1 个 CPU 托盘份额）', 'Node = NPU tray (with one CPU tray’s share)'), it.node, fmt(f.node), T(`8 NPU；${ends('node')}`, `8 NPUs; ${ends('node')}`), 'LightCounting'),
      line(T('NPU（昇腾 950DT，96 GB HBM）', 'NPU (Ascend 950DT, 96 GB HBM)'), it.npu, fmt(f.npu), T(`1 NPU；${ends('npu')}`, `1 NPU; ${ends('npu')}`), T('产品页', 'product page')),
      line(T('CPU（鲲鹏 950）', 'CPU (Kunpeng 950)'), it.cpu, fmt(f.cpu), T(`所在节点；${ends('cpu')}`, `its node; ${ends('cpu')}`), T('产品页', 'product page')),
      line(T('擎天卡（VPC 面）', 'Qingtian card (VPC plane)'), it.qingtian, T('计入管理 / 存储', 'in MGMT / STORAGE'), T('存储 / 管理通路', 'storage / management path'), T('假设', 'assumed')),
      line(T('柜内 LRS', 'In-cabinet LRS'), it.lrs, it.lrs.perPod > 0 ? fmt(f.ubSwitch, 1) : '—', it.lrs.perPod > 0 ? T(`柜内一条转发 / 备份路径；${ends('ub-switch')}`, `one forwarding / backup path; ${ends('ub-switch')}`) : T('无（单层交换，假设）', 'none (single-layer switching, assumed)'), native ? T('UB-Mesh 论文', 'UB-Mesh paper') : T('假设', 'assumed')),
      line(T('超节点层 UB 交换机（128 × 800G）', 'Pod-tier UB switch (128 × 800G)'), it.podSwitch, fmt(f.ubSwitch, 1), podSwImpact, native ? T('推算（Hot Chips 8K 示例按卡数缩放）', 'derived (Hot Chips 8K example scaled)') : T('假设（3.2 Tb/s ÷ 800G）', 'assumed (3.2 Tb/s ÷ 800G)')),
      line(native ? T('柜内电链路（2D 全互联）', 'In-cabinet electrical links (2D full mesh)') : T('托盘内电链路（假设）', 'Tray electrical links (assumed)'), it.meshLink, T('计数项', 'count only'), T('一对 NPU；改经交换绕行', 'one NPU pair; traffic re-routed'), native ? T('UB-Mesh 论文', 'UB-Mesh paper') : T('假设', 'assumed')),
      line(T('UB 800G 光链路', 'UB 800G optical link'), it.opticalLink, fmt(f.ubLink, 2), T(`1 条上联；2+2 保护吸收的不计；${ends('ub-link')}`, `one uplink; faults absorbed by 2+2 protection not counted; ${ends('ub-link')}`), native ? 'LightCounting' : T('推算', 'derived')),
      line(T('UB 800G 光模块', 'UB 800G transceiver'), it.transceiver, T('计入链路', 'with its link'), '—', native ? 'LightCounting' : T('假设', 'assumed')),
      line(T('scale-out 端口（200G）', 'Scale-out port (200G)'), it.soPort, T('计入 NPU 的 NIC 类', 'in the NPU NIC class'), T('1 个平面', 'one plane'), T('白皮书 + 假设', 'white paper + assumed')),
      line(T('scale-out 叶交换机（份额）', 'Scale-out leaf switch (share)'), it.soLeaf, fmt(f.soSwitch, 1), T(`1 个平面的 ${fmt(so.radix / 2)} 个端口`, `${fmt(so.radix / 2)} ports of one plane`), T('假设', 'assumed')),
      line(T('scale-out 脊交换机（份额，集群共用）', 'Scale-out spine switch (share, cluster-wide)'), it.soSpine, fmt(f.soSwitch, 1), T(`上联带宽的 1/${fmt(so.radix / 2)}`, `1/${fmt(so.radix / 2)} of the uplink bandwidth`), T('假设', 'assumed')),
      line(T('scale-out 光链路', 'Scale-out optical link'), it.soLink, fmt(f.soLink, 2), T(`1 个端口或 1 条上联；${ends('roce-link')}`, `one port or one uplink; ${ends('roce-link')}`), T('假设', 'assumed')),
    ];
    const kw = (x) => (x >= 1000 ? `${fmt(x / 1000, 2)} MW` : `${fmt(x, x >= 10 ? 0 : 2)} kW`);
    rows.push(`<tr><td>${esc(T('计算柜功耗', 'Compute-cabinet power'))}</td><td class="num">${kw(it.cabinetKW.perPod)}</td><td class="num">${kw(it.cabinetKW.perRack)}</td><td class="num">${kw(it.cabinetKW.perNode)}</td><td class="num">${kw(it.cabinetKW.perNpu)}</td><td class="num">—</td><td></td><td class="src">${esc(T('产品页 ≈ 100 kW / 柜', 'product page ≈ 100 kW per cabinet'))}</td></tr>`);
    const L = Object.fromEntries(m.levels.map((l) => [l.id, l]));
    rows.push(`<tr class="b sum"><td>${esc(T('本层内硬中断 FIT 合计', 'Hard FIT contained in the level'))}</td><td class="num">${fmt(L.pod.fit)}</td><td class="num">${fmt(L.rack.fit)}</td><td class="num">${fmt(L.node.fit)}</td><td class="num">${fmt(L.npu.fit)}</td><td colspan="3" class="src">${esc(T(`超节点 = 计算柜 + 超节点层交换；计算柜 = 8 节点 + 柜（供电液冷）+ LRS + 柜内光链路；节点 = 8 NPU + 节点 + 2 CPU。另有集群层：作业级服务 ${fmt(m.cluster.jobPerNpu, 1)}、scale-out ${fmt(m.cluster.scaleOutPerNpu, 1)} FIT / NPU`, `pod = cabinets + pod-tier switches; cabinet = 8 nodes + cabinet (power, cooling) + LRS + its optical links; node = 8 NPUs + node + 2 CPUs. Cluster level on top: job-level services ${fmt(m.cluster.jobPerNpu, 1)}, scale-out ${fmt(m.cluster.scaleOutPerNpu, 1)} FIT per NPU`))}</td></tr>`);
    rows.push(`<tr class="b sum"><td>${esc(T('对应 MTBF（该层任一硬中断）', 'Matching MTBF (any hard interruption in the level)'))}</td><td class="num">${esc(days(L.pod.mtbfH))}</td><td class="num">${esc(days(L.rack.mtbfH))}</td><td class="num">${esc(days(L.node.mtbfH))}</td><td class="num">${esc(days(L.npu.mtbfH))}</td><td colspan="3" class="src">${esc(T(`每 NPU：超节点层 ${fmt(L.pod.fitPerNpu, 1)}、柜层 ${fmt(L.rack.fitPerNpu, 1)} FIT`, `per NPU: ${fmt(L.pod.fitPerNpu, 1)} at pod level, ${fmt(L.rack.fitPerNpu, 1)} at cabinet level`))}</td></tr>`);
    const headM = `<tr><th>${esc(T('部件', 'Component'))}</th><th class="num">${esc(T(`每超节点（${fmt(m.npus / m.pods)} NPU）`, `Per SuperPoD (${fmt(m.npus / m.pods)} NPUs)`))}</th><th class="num">${esc(T('每计算柜', 'Per cabinet'))}</th><th class="num">${esc(T('每节点', 'Per node'))}</th><th class="num">${esc(T('每 NPU', 'Per NPU'))}</th><th class="num">${esc(T('单元 FIT', 'FIT per unit'))}</th><th>${esc(T('一次故障的影响；恢复去向（六个机制）', 'What one failure takes out; where recovery ends (six mechanisms)'))}</th><th>${esc(T('依据', 'Basis'))}</th></tr>`;
    return `<div class="table-wrap"><table class="map"><thead>${headM}</thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  /* ---------------- 3. bottleneck: charts ---------------- */
  function chartAop() {
    const W = 960, H = 318, x0 = 74, x1 = 836, y0 = 52, y1 = 262;
    const lo = Math.log10(5000), hi = Math.log10(600000);
    const X = (n) => x0 + ((Math.log10(n) - lo) / (hi - lo)) * (x1 - x0);
    const yLo = 0.95, yHi = 1.0;
    const Y = (a) => y1 - ((a - yLo) / (yHi - yLo)) * (y1 - y0);
    const head = titleBlock(T('图 3：系统可用度 A_op 随规模下降（六个默认机制；虚线为 99 % 与 98.5 %）', 'Figure 3: system availability A_op falls with scale (six default mechanisms; dashed: 99 % and 98.5 %)'));
    let g = svgOpen('fig-aop', W, H, T('A_op 与规模', 'A_op versus scale')) + head.svg;
    for (const v of [0.95, 0.96, 0.97, 0.98, 0.99, 1.0]) g += `<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" class="grid"/><text x="${x0 - 8}" y="${Y(v) + 4}" class="m" text-anchor="end">${(v * 100).toFixed(0)} %</text>`;
    for (const n of [5000, 10000, 20000, 50000, 100000, 200000, 500000]) g += `<line x1="${X(n)}" y1="${y1}" x2="${X(n)}" y2="${y1 + 4}" class="axis"/><text x="${X(n)}" y="${y1 + 17}" class="m" text-anchor="middle">${esc(kN(n))}</text>`;
    g += `<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" class="axis"/><text x="${(x0 + x1) / 2}" y="${y1 + 33}" class="s" text-anchor="middle">${esc(T('NPU 数（对数轴）', 'NPUs (log axis)'))}</text>`;
    for (const [v, lab] of [[0.99, '99 %'], [0.985, '98.5 %']]) g += `<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" style="stroke:var(--muted);stroke-width:1.2;stroke-dasharray:5 4"/><text x="${x1 + 6}" y="${Y(v) + 4}" class="s">${lab}</text>`;
    const col = { native: 'var(--s1)', ubl128: 'var(--s2)' };
    for (const a of ARCHS) {
      const pts = R.curve[a].map((p) => `${X(p.n).toFixed(1)},${Y(p.aOp).toFixed(1)}`).join(' ');
      g += `<polyline points="${pts}" fill="none" style="stroke:${col[a]};stroke-width:2"/>`;
    }
    // threshold ticks (98.5 % crossing) and the built-in sizes as hover points
    for (const a of ARCHS) {
      const t = R.archs[a].thresholds;
      for (const [lev, n] of [[0.99, t.aOp99], [0.985, t.aOp985]]) g += `<line x1="${X(n)}" y1="${Y(lev) - 6}" x2="${X(n)}" y2="${Y(lev) + 6}" style="stroke:${col[a]};stroke-width:2"/>`;
      for (const n of SIZES) {
        const s = S(a, n);
        const tip = `${NAME[a]} · ${fmt(n)} NPU|A_op ${pct(s.kpi.aOp)}|MTBF_hw ${hrs(s.kpi.mtbfHwH)}|MTTR_hw ${fmt(s.kpi.mttrS, 1)} s|${T('硬件中断', 'hardware interruptions')} ${fmt(s.kpi.lamHw * 24, 1)} / ${T('天', 'day')}`;
        g += `<circle cx="${X(n)}" cy="${Y(s.kpi.aOp)}" r="4.6" style="fill:${col[a]};stroke:var(--surface);stroke-width:1.6" data-tip="${esc(tip)}"/><circle cx="${X(n)}" cy="${Y(s.kpi.aOp)}" r="11" fill="transparent" data-tip="${esc(tip)}"/>`;
      }
    }
    // direct labels at the right end
    const endN = R.curve.native.at(-1), endU = R.curve.ubl128.at(-1);
    g += `<text x="${X(endN.n) + 6}" y="${Y(endN.aOp) + 12}" class="s halo">${esc(`${NAME.native} ${pct(endN.aOp, 2)}`)}</text>`;
    g += `<text x="${X(endU.n) + 6}" y="${Y(endU.aOp) - 5}" class="s halo">${esc(`${NAME.ubl128} ${pct(endU.aOp, 2)}`)}</text>`;
    const note = T(`竖短线：跌破 99 % 与 98.5 % 的规模——原生 ${kN(thrN.aOp99)} / ${kN(thrN.aOp985)}，UBL128 ${kN(thrU.aOp99)} / ${kN(thrU.aOp985)} NPU；端点为 60 万卡`, `Ticks: the size where A_op falls below 99 % and 98.5 % — native ${kN(thrN.aOp99)} / ${kN(thrN.aOp985)}, UBL128 ${kN(thrU.aOp99)} / ${kN(thrU.aOp985)} NPUs; curves end at 600k NPUs`);
    g += lines(x0 + 10, Y(0.9625), wrap(note, 470, 9.8), 's halo', 12);
    const lg = legend(x0, H - 8, [{ label: NAME.native, line: true, style: 'stroke:var(--s1);stroke-width:2' }, { label: NAME.ubl128, line: true, style: 'stroke:var(--s2);stroke-width:2' }]);
    g += lg.g;
    return g + '</svg>';
  }
  function chartShares() {
    const U = n500.breakdown.units, UU = u500.breakdown.units;
    const lamN = n500.kpi.lamHw, lpN = n500.kpi.sumLP;
    const rows = UNITS.map((u) => ({ u, ev: U[u].lam / lamN, dt: U[u].lp / lpN, x: U[u] }));
    const W = 960, rowH = 30, x0 = 300, x1 = 860, y0 = 56;
    const H = y0 + rows.length * rowH + 44;
    const max = 0.6;
    const X = (v) => x0 + (v / max) * (x1 - x0);
    const head = titleBlock(T('图 4：原生 950 的硬件中断从哪里来、停机时间花在哪里（份额与规模无关；UBL128 只有 UB 交换一行明显不同）', 'Figure 4: where the native 950’s hardware interruptions come from and where the downtime goes (shares do not depend on scale; UBL128 differs visibly only on the UB-switch row)'));
    let g = svgOpen('fig-shares', W, H + head.dy, T('中断份额与停机份额', 'Interruption and downtime shares')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    for (const v of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) g += `<line x1="${X(v)}" y1="${y0 - 6}" x2="${X(v)}" y2="${y0 + rows.length * rowH}" class="grid"/><text x="${X(v)}" y="${y0 - 10}" class="m" text-anchor="middle">${fmt(v * 100)} %</text>`;
    rows.forEach((r, i) => {
      const y = y0 + i * rowH;
      const lab = wrap(UNIT[r.u], x0 - 24, 9.8);
      g += lines(x0 - 10, y + 12 - (lab.length - 1) * 5.5, lab, 's', 11, 'end');
      const tip = `${UNIT[r.u]}|FIT / NPU: ${NAME.native} ${fmt(n500.hardFitPerNpu[r.u] ?? 0, 1)} · UBL128 ${fmt(u500.hardFitPerNpu[r.u] ?? 0, 1)}|${T('中断份额', 'interruption share')} ${pct(r.ev, 1)} · ${T('停机份额', 'downtime share')} ${pct(r.dt, 1)}|${T('每次暂停', 'pause per event')} ${fmt(r.x.mttrS, 1)} s · ${ENDS(r.x.ends)}|${T('50 万卡', '500k NPUs')}: ${fmt(r.x.lam * 24, 2)} ${T('次 / 天', 'per day')} · ${fmt((r.x.lp * 24) / 60, 1)} ${T('分钟停机 / 天', 'min of pause per day')}${r.u === 'ub-switch' ? `|UBL128: ${pct(UU[r.u].lam / u500.kpi.lamHw, 2)} · ${pct(UU[r.u].lp / u500.kpi.sumLP, 2)}` : ''}`;
      g += `<rect x="${x0}" y="${y + 3}" width="${Math.max(1.5, X(r.ev) - x0)}" height="9" rx="2" style="fill:var(--s1)" data-tip="${esc(tip)}"/>`;
      g += `<rect x="${x0}" y="${y + 14}" width="${Math.max(1.5, X(r.dt) - x0)}" height="9" rx="2" style="fill:var(--s2)" data-tip="${esc(tip)}"/>`;
      g += `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent" data-tip="${esc(tip)}"/>`;
      if (r.ev >= 0.04) g += `<text x="${X(r.ev) + 4}" y="${y + 11}" class="tiny">${fmt(r.ev * 100, 1)} %</text>`;
      if (r.dt >= 0.04) g += `<text x="${X(r.dt) + 4}" y="${y + 22}" class="tiny">${fmt(r.dt * 100, 1)} %</text>`;
    });
    const lg = legend(x0, y0 + rows.length * rowH + 22, [{ label: T('占硬件中断次数', 'share of hardware interruptions'), style: 'fill:var(--s1)' }, { label: T('占硬件中断停机时间（λ × 每次暂停）', 'share of hardware-interruption downtime (λ × pause)'), style: 'fill:var(--s2)' }]);
    g += lg.g;
    return g + '</g></svg>';
  }

  /* ---------------- 3. bottleneck: tables ---------------- */
  const unitRows = UNITS.map((u) => {
    const a = n500.breakdown.units[u], b = u500.breakdown.units[u];
    return `<tr><td>${esc(UNIT[u])}</td><td class="num">${fmt(n500.hardFitPerNpu[u] ?? 0, 1)} / ${fmt(u500.hardFitPerNpu[u] ?? 0, 1)}</td><td class="num">${fmt((a.lam / n500.kpi.lamHw) * 100, 1)} %</td><td class="num">${fmt(a.mttrS, 1)} s</td><td>${esc(ENDS(a.ends))}</td><td class="num${a.lp / n500.kpi.sumLP >= 0.1 ? ' bad' : ''}">${fmt((a.lp / n500.kpi.sumLP) * 100, 1)} % / ${fmt((b.lp / u500.kpi.sumLP) * 100, 1)} %</td><td class="num">${fmt(a.lam * 24, 2)}</td><td class="num">${fmt((a.lp * 24) / 60, 1)}</td></tr>`;
  }).join('');
  const otherRow = `<tr class="sum"><td>${esc(T('另：亚健康隔离（另一事件类，不与上面相加次数）', 'Also: isolation of sub-healthy units (another event class; counts not added above)'))}</td><td class="num">—</td><td class="num">—</td><td class="num">${fmt(n500.kpi.other[0].pauseS)} s</td><td>${esc(T('全局暂停（不回滚）', 'global pause (no rollback)'))}</td><td class="num">${esc(T(`占全部暂停 ${fmt((n500.kpi.other[0].sPerH / (n500.kpi.sumLP + n500.kpi.F)) * 100, 1)} %`, `${fmt((n500.kpi.other[0].sPerH / (n500.kpi.sumLP + n500.kpi.F)) * 100, 1)} % of all pause time`))}</td><td class="num">${fmt(n500.kpi.other[0].ratePerHour * 24, 2)}</td><td class="num">${fmt((n500.kpi.other[0].sPerH * 24) / 60, 1)}</td></tr>`;
  const table3 = `<div class="table-wrap"><table class="t3"><thead><tr><th>${esc(T('硬件单元（故障类所在）', 'Hardware unit (where the classes sit)'))}</th><th class="num">${esc(T('FIT / NPU 原生 / UBL128', 'FIT per NPU native / UBL128'))}</th><th class="num">${esc(T('中断份额', 'Interruption share'))}</th><th class="num">${esc(T('每次暂停', 'Pause per event'))}</th><th>${esc(T('恢复去向（六个机制）', 'Where recovery ends (six mechanisms)'))}</th><th class="num">${esc(T('停机份额 原生 / UBL128', 'Downtime share native / UBL128'))}</th><th class="num">${esc(T('50 万卡 次 / 天', '500k: per day'))}</th><th class="num">${esc(T('50 万卡 停机 min / 天', '500k: min of pause per day'))}</th></tr></thead><tbody>${unitRows}${otherRow}</tbody></table></div>`;

  const globalOf = (s) => (s.breakdown.mttrParts.globalAuto ?? 0) + (s.breakdown.mttrParts.globalManual ?? 0);
  const scaleRows = SIZES.map((n) => {
    const a = S('native', n), b = S('ubl128', n);
    const r = (s, i) => { const q = s.required[i]; return q.feasibleToday ? T(`满足（≤ ${fmt(q.fitPerNpuBudget)}）`, `met (≤ ${fmt(q.fitPerNpuBudget)})`) : `≤ ${fmt(q.fitPerNpuBudget)} (×${fmt(q.mtbfFactor, 1)})`; };
    const util = R.sensitivity.scaleOut.main.sizes[String(n)].portsPerPlane / R.sensitivity.scaleOut.main.sizes[String(n)].capacityPerPlane;
    return `<tr><td class="b nw">${esc(T(`${fmt(n / 10000)} 万`, kN(n)))}</td><td class="num">${fmt(a.counts.supernodes)} / ${fmt(b.counts.supernodes)}</td><td class="num">${fmt(a.kpi.lamHw * 24, 1)}</td><td class="num">${esc(hShort(a.kpi.mtbfHwH))}</td><td class="num${a.kpi.aOp < 0.985 ? ' bad' : a.kpi.aOp < 0.99 ? ' mid' : ''}">${pct(a.kpi.aOp)}</td><td class="num${b.kpi.aOp < 0.985 ? ' bad' : b.kpi.aOp < 0.99 ? ' mid' : ''}">${pct(b.kpi.aOp)}</td><td class="num w">${esc(r(a, 0))}</td><td class="num w">${esc(r(a, 1))}</td><td class="num">${fmt(a.regime.tauRatio, 3)} / ${fmt(a.regime.globalRatio, 3)}</td><td class="num">${fmt(util * 100, 1)} %</td></tr>`;
  }).join('');
  const table4 = `<div class="table-wrap"><table class="t4"><thead><tr><th>${esc(T('规模', 'Size'))}</th><th class="num">${esc(T('超节点 原生 / UBL128', 'Pods native / UBL128'))}</th><th class="num">${esc(T('硬件中断 / 天', 'Interruptions per day'))}</th><th class="num">MTBF_hw</th><th class="num">A_op ${esc(NAME.native)}</th><th class="num">A_op UBL128</th><th class="num">${esc(T('98.5 % 的 FIT / NPU 上限（倍数）', '98.5 %: FIT per NPU ceiling (factor)'))}</th><th class="num">${esc(T('99 % 的上限（倍数）', '99 %: ceiling (factor)'))}</th><th class="num">(τ+δ)/M · G/M</th><th class="num">${esc(T('scale-out 每平面端点 / 上限', 'Scale-out endpoints per plane / ceiling'))}</th></tr></thead><tbody>${scaleRows}</tbody></table></div>`;

  const scaleText = [
    T(`<b>1 万卡</b>：${fmt(n10.kpi.lamHw * 24, 2)} 次 / 天，MTBF_hw ${hrs(n10.kpi.mtbfHwH)}，A_op ${pct(n10.kpi.aOp)}；对 98.5 % 有约 ${fmt(n10.required[0].fitPerNpuBudget / n10.hardFitPerNpuTotal)} 倍余量。瓶颈不在可用度，而在单次长停：作业级服务、供电 / 液冷、交换类的每次中断都走全局恢复（${fmt(n10.kpi.globalS + n10.kpi.detectS, 1)} s）；10 个原生超节点（或 79 个 UBL128 超节点）里，一个灵衢互联柜或交换柜的供电 / 液冷故障就能波及 1,024 / 512 张卡。`, `<b>10k NPUs</b>: ${fmt(n10.kpi.lamHw * 24, 2)} interruptions per day, MTBF_hw ${hrs(n10.kpi.mtbfHwH)}, A_op ${pct(n10.kpi.aOp)}, about ${fmt(n10.required[0].fitPerNpuBudget / n10.hardFitPerNpuTotal)}× headroom for 98.5 %. The bottleneck is not availability but single long stops: every interruption of the job-level services, power / cooling and switches goes to the global recovery (${fmt(n10.kpi.globalS + n10.kpi.detectS, 1)} s); among 10 native pods (or 79 UBL128 pods) one power or cooling fault of an interconnect / switch cabinet reaches 1,024 / 512 NPUs.`),
    T(`<b>10 万卡</b>：约 ${fmt(S('native', 100000).kpi.lamHw * 24, 1)} 次 / 天，MTBF_hw ${hrs(S('native', 100000).kpi.mtbfHwH)}；两种架构都还满足 99 %（余量约 ${fmt(S('native', 100000).required[1].fitPerNpuBudget / S('native', 100000).hardFitPerNpuTotal, 2)} 倍）。原生超过约 ${kN(thrN.aOp99)}、UBL128 超过约 ${kN(thrU.aOp99)} NPU 后跌破 99 %。`, `<b>100k NPUs</b>: ≈ ${fmt(S('native', 100000).kpi.lamHw * 24, 1)} interruptions per day, MTBF_hw ${hrs(S('native', 100000).kpi.mtbfHwH)}; both architectures still meet 99 % (≈ ${fmt(S('native', 100000).required[1].fitPerNpuBudget / S('native', 100000).hardFitPerNpuTotal, 2)}× headroom). Native falls below 99 % beyond ≈ ${kN(thrN.aOp99)} NPUs, UBL128 beyond ≈ ${kN(thrU.aOp99)}.`),
    T(`<b>20 万卡</b>：约 ${fmt(n200.kpi.lamHw * 24, 1)} 次 / 天，MTBF_hw ${hrs(n200.kpi.mtbfHwH)}；原生 ${pct(n200.kpi.aOp)} 已低于 98.5 %（FIT / NPU 需降到 ${fmt(n200.required[0].fitPerNpuBudget)}，×${fmt(n200.required[0].mtbfFactor, 2)}），UBL128 ${pct(u200.kpi.aOp)} 刚好满足——差别全部来自柜内 LRS 的有无（敏感性见 3.4）。98.5 % 的规模上限约为 ${kN(thrN.aOp985)} / ${kN(thrU.aOp985)} NPU。`, `<b>200k NPUs</b>: ≈ ${fmt(n200.kpi.lamHw * 24, 1)} interruptions per day, MTBF_hw ${hrs(n200.kpi.mtbfHwH)}; native at ${pct(n200.kpi.aOp)} is already below 98.5 % (FIT per NPU must fall to ${fmt(n200.required[0].fitPerNpuBudget)}, ×${fmt(n200.required[0].mtbfFactor, 2)}); UBL128 at ${pct(u200.kpi.aOp)} just meets it — the whole difference is whether the cabinets carry LRS (sensitivity in 3.4). The 98.5 % ceiling is ≈ ${kN(thrN.aOp985)} / ${kN(thrU.aOp985)} NPUs.`),
    T(`<b>50 万卡</b>：约 ${fmt(n500.kpi.lamHw * 24, 1)} 次 / 天，MTBF_hw ${hrs(n500.kpi.mtbfHwH)}，A_op ${pct(n500.kpi.aOp, 2)} / ${pct(u500.kpi.aOp, 2)}。达到 98.5 % 需要 FIT / NPU ≤ ${fmt(n500.required[0].fitPerNpuBudget)}（今天的 1 / ${fmt(n500.required[0].mtbfFactor, 1)}），或在今天的 MTBF 下把 MTTR 从 ${fmt(n500.kpi.mttrS, 1)} s 压到 ${fmt(n500.required[0].mttrReqS, 1)} s；99 % 需 ×${fmt(n500.required[1].mtbfFactor, 1)}。${pct(n500.breakdown.ends.global, 0)} 的中断走全局恢复，却占 MTTR 的 ${fmt((globalOf(n500) / n500.kpi.mttrS) * 100)} %。scale-out 每平面用到两层 radix 1,024 上限的 ${fmt((500000 / 524288) * 100)} %，再扩就要第三层或更多平面；UBL128 的“256K 卡两层”说法不覆盖 50 万卡。`, `<b>500k NPUs</b>: ≈ ${fmt(n500.kpi.lamHw * 24, 1)} interruptions per day, MTBF_hw ${hrs(n500.kpi.mtbfHwH)}, A_op ${pct(n500.kpi.aOp, 2)} / ${pct(u500.kpi.aOp, 2)}. 98.5 % needs FIT per NPU ≤ ${fmt(n500.required[0].fitPerNpuBudget)} (1/${fmt(n500.required[0].mtbfFactor, 1)} of today) or, at today's MTBF, MTTR down from ${fmt(n500.kpi.mttrS, 1)} s to ${fmt(n500.required[0].mttrReqS, 1)} s; 99 % needs ×${fmt(n500.required[1].mtbfFactor, 1)}. ${pct(n500.breakdown.ends.global, 0)} of the interruptions end in the global recovery but they make ${fmt((globalOf(n500) / n500.kpi.mttrS) * 100)} % of the MTTR. Each scale-out plane uses ${fmt((500000 / 524288) * 100)} % of the two-tier radix-1,024 ceiling; beyond it a third tier or more planes are needed, and UBL128's stated “two tiers to 256K” does not cover 500k.`),
  ];

  const spof = [
    [T('作业级共享服务：共享检查点存储、调度 / 管理面、未归因软件', 'Job-level shared services: shared checkpoint storage, scheduling / management plane, unattributed software'), T('整个作业', 'the whole job'), T(`没有快速恢复梯级，每次走全局恢复（${fmt(n500.kpi.globalS + n500.kpi.detectS, 1)} s）；占中断 ${fmt((n500.breakdown.units.job.lam / n500.kpi.lamHw) * 100, 1)} %、停机 ${fmt((n500.breakdown.units.job.lp / n500.kpi.sumLP) * 100, 1)} %，每个规模都是第一瓶颈`, `no fast recovery rung: every event goes to the global recovery (${fmt(n500.kpi.globalS + n500.kpi.detectS, 1)} s); ${fmt((n500.breakdown.units.job.lam / n500.kpi.lamHw) * 100, 1)} % of interruptions, ${fmt((n500.breakdown.units.job.lp / n500.kpi.sumLP) * 100, 1)} % of downtime — the first bottleneck at every size`), T('两者相同；目录按 NPU·h 计，随 N 线性增长', 'same in both; per NPU-hour in the catalog, so it grows with N')],
    [T('计算柜供电 / 液冷（约 100 kW，CDU、电源框）', 'Compute-cabinet power / liquid cooling (≈ 100 kW, CDU, power shelves)'), '64 NPU', T(`全局恢复；中断 ${fmt((n500.breakdown.units.cabinet.lam / n500.kpi.lamHw) * 100, 1)} %、停机 ${fmt((n500.breakdown.units.cabinet.lp / n500.kpi.sumLP) * 100, 1)} %`, `global recovery; ${fmt((n500.breakdown.units.cabinet.lam / n500.kpi.lamHw) * 100, 1)} % of interruptions, ${fmt((n500.breakdown.units.cabinet.lp / n500.kpi.sumLP) * 100, 1)} % of downtime`), T('两者相同（同样的 64 卡柜，假设）', 'same in both (same 64-NPU cabinet, assumed)')],
    [T('节点管理与板级 IO（BMC、UBM、IO 转换板）', 'Node management and board IO (BMC, UBM, IO conversion)'), '8 NPU', T(`节点事件的 ${fmt(n500.breakdown.units.node.ends.global * 100)} % 走全局，其余由弹性恢复吸收`, `${fmt(n500.breakdown.units.node.ends.global * 100)} % of node events go global, the rest are absorbed by elastic recovery`), T('两者相同', 'same in both')],
    [T('柜内 LRS 层（原生每柜 72 片）', 'In-cabinet LRS tier (native: 72 per cabinet)'), T('柜内一条转发 / 备份路径', 'one forwarding / backup path in the cabinet'), T('残余平面中断（FABRIC）走全局', 'residual plane outages (FABRIC) go global'), T(`原生：中断 ${fmt((n500.breakdown.units['ub-switch'].lam / n500.kpi.lamHw) * 100, 1)} %、停机 ${fmt((n500.breakdown.units['ub-switch'].lp / n500.kpi.sumLP) * 100, 1)} %；UBL128（无 LRS）${fmt((u500.breakdown.units['ub-switch'].lp / u500.kpi.sumLP) * 100, 1)} %；若 UBL128 也保留 72 片则反超原生`, `native: ${fmt((n500.breakdown.units['ub-switch'].lam / n500.kpi.lamHw) * 100, 1)} % of interruptions, ${fmt((n500.breakdown.units['ub-switch'].lp / n500.kpi.sumLP) * 100, 1)} % of downtime; UBL128 (no LRS) ${fmt((u500.breakdown.units['ub-switch'].lp / u500.kpi.sumLP) * 100, 1)} %; if UBL128 keeps the 72, it is worse than native`)],
    [T('超节点层 UB 交换机', 'Pod-tier UB switch'), T('原生：1,024 卡的 1/16 跨柜带宽；UBL128：128 卡的 1/4 scale-up 带宽', 'native: 1/16 of 1,024 NPUs’ cross-cabinet bandwidth; UBL128: 1/4 of 128 NPUs’ scale-up bandwidth'), T('降级（路由收敛时）；残余中断走全局', 'degradation when routing converges; residual outages go global'), T('UBL128 单台故障的带宽损失是原生的 4 倍，但只影响 128 卡', 'one UBL128 switch costs 4× the bandwidth share of a native one, but only for 128 NPUs')],
    [T('网络柜（灵衢互联柜 / 交换柜）的供电与液冷', 'Power and cooling of a network rack (UB interconnect / switch cabinet)'), T('原生：4 台交换机 = 1/4 跨柜带宽（1,024 卡）；UBL128：若一柜装 4 个超节点的全部交换机，512 卡失去 scale-up', 'native: 4 switches = 1/4 of the cross-cabinet bandwidth (1,024 NPUs); UBL128: if one cabinet holds all switches of 4 pods, 512 NPUs lose scale-up'), T('HAC-D 未单列（计入 FABRIC 类）', 'not separate in HAC-D (inside the FABRIC class)'), T('设计要点：按平面把交换机分散到不同柜，一柜故障只剩 1/4 带宽损失', 'design point: spread switches over cabinets by plane, so one cabinet costs only 1/4 of the bandwidth')],
    [T('UB 光链路与光模块', 'UB optical links and transceivers'), T('1 条上联', 'one uplink'), T('2+2 保护、LLR、降 lane：多数单模块故障是降级；残余中断 90 % 由重执行吸收', '2+2 protection, LLR, lane degradation: most single-module faults are degradations; 90 % of residual interruptions are replayed'), T(`原生 2 条 / NPU，UBL128 4 条 / NPU（光模块 ×2，50 万卡 ${kN(u500.counts.transceivers)} 只）`, `native 2 per NPU, UBL128 4 per NPU (2× the optics, ${kN(u500.counts.transceivers)} at 500k)`)],
    [T('scale-out 叶交换机', 'Scale-out leaf switch'), T(`1 个平面的 ${fmt(so.radix / 2)} 个端口`, `${fmt(so.radix / 2)} ports of one plane`), T('主算例每 NPU 4 个平面：降级；附件方案每 NPU 只有 1 个口，叶故障使 64 个 NPU 失去 scale-out', 'main case, 4 planes per NPU: degradation; in the attachments’ scheme each NPU has one port, so a leaf failure cuts 64 NPUs off the scale-out'), T('两者相同', 'same in both')],
    [T('scale-out 规模上限', 'Scale-out size ceiling'), '—', T('两层 radix 1,024：每平面 ≤ 524,288 个端点', 'two tiers at radix 1,024: ≤ 524,288 endpoints per plane'), T('50 万卡用到 95 %；超过需第三层或多轨', '500k uses 95 %; beyond needs a third tier or more rails')],
  ];
  const table5 = `<div class="table-wrap"><table class="t5"><thead><tr><th>${esc(T('部位', 'Element'))}</th><th>${esc(T('一次故障波及', 'One failure reaches'))}</th><th>${esc(T('对同步作业的效果（六个机制）', 'Effect on the synchronous job (six mechanisms)'))}</th><th>${esc(T('两种架构的差别 / 设计要点', 'Difference between the architectures / design point'))}</th></tr></thead><tbody>${spof.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="b"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  /* ---------------- 3.4 sensitivities ---------------- */
  const soRows = Object.entries(R.sensitivity.scaleOut).map(([id, v]) => {
    const z = v.sizes['500000'];
    return `<tr${id === 'main' ? ' class="b"' : ''}><td>${esc(v.name[lang])}</td><td class="num">${z.tiers}</td><td class="num">${fmt(z.switches)}</td><td class="num">${kN(z.links)}</td><td class="num">${kN(z.transceivers)}</td><td class="num">${fmt(z.native.soFitPerNpu, 1)}</td><td class="num">${pct(z.native.aOp, 2)} / ${pct(z.ubl128.aOp, 2)}</td><td class="src">${esc(v.basis[lang])}</td></tr>`;
  }).join('');
  const table6 = `<div class="table-wrap"><table class="t6"><thead><tr><th>${esc(T('scale-out 设计（50 万卡）', 'Scale-out design (500k NPUs)'))}</th><th class="num">${esc(T('层数', 'Tiers'))}</th><th class="num">${esc(T('交换机', 'Switches'))}</th><th class="num">${esc(T('链路', 'Links'))}</th><th class="num">${esc(T('光模块', 'Transceivers'))}</th><th class="num">${esc(T('scale-out FIT / NPU', 'Scale-out FIT per NPU'))}</th><th class="num">A_op ${esc(NAME.native)} / UBL128</th><th>${esc(T('依据', 'Basis'))}</th></tr></thead><tbody>${soRows}</tbody></table></div>`;
  const lrs = R.sensitivity.ubl128Lrs;
  const lrsText = T(`UBL128 若沿用 Atlas 950 计算柜的 72 片 LRS（柜内 2D 全互联保留）：UB 部分 ${fmt(lrs['500000'].ubFitPerNpu, 1)} FIT / NPU（无 LRS 时 ${fmt(S('ubl128', 500000).hardFitPerNpu['ub-switch'] + S('ubl128', 500000).hardFitPerNpu['ub-link'], 1)}，原生 ${fmt(S('native', 500000).hardFitPerNpu['ub-switch'] + S('native', 500000).hardFitPerNpu['ub-link'], 1)}），20 万卡 A_op ${pct(lrs['200000'].aOp)}、50 万卡 ${pct(lrs['500000'].aOp)}，略低于原生。也就是说两种架构的可用度差别取决于 UBL128 柜内有没有 LRS 这一未公开事实，幅度不超过 0.25 个百分点；规模才是决定因素。`, `If UBL128 keeps the 72 LRS of the Atlas 950 cabinet (cabinet 2D mesh retained): ${fmt(lrs['500000'].ubFitPerNpu, 1)} FIT per NPU in the UB fabric (without LRS ${fmt(S('ubl128', 500000).hardFitPerNpu['ub-switch'] + S('ubl128', 500000).hardFitPerNpu['ub-link'], 1)}, native ${fmt(S('native', 500000).hardFitPerNpu['ub-switch'] + S('native', 500000).hardFitPerNpu['ub-link'], 1)}), A_op ${pct(lrs['200000'].aOp)} at 200k and ${pct(lrs['500000'].aOp)} at 500k, slightly below native. So the availability difference between the architectures hinges on an unpublished fact — whether UBL128 cabinets carry LRS — and is at most a quarter of a point; scale is what decides.`);

  /* ---------------- 4. cross-check with the attachments (512,000 NPUs) ---------------- */
  const X = R.crossCheck512k['512000'], A = R.crossCheck512k.attachment;
  const xrow = (label, an, hn, au, hu, note) => `<tr><td>${esc(label)}</td><td class="num w">${esc(an)}</td><td class="num w">${esc(hn)}</td><td class="num w">${esc(au)}</td><td class="num w">${esc(hu)}</td><td>${esc(note)}</td></tr>`;
  const so512 = X['so:main'], soA = X['so:attach'];
  const table7 = `<div class="table-wrap"><table class="t7"><thead><tr><th>${esc(T('项目（51.2 万卡）', 'Item (512,000 NPUs)'))}</th><th class="num">${esc(T('附件 · 架构一', 'Attachment · arch. 1'))}</th><th class="num">${esc(T('HAC-D · 原生', 'HAC-D · native'))}</th><th class="num">${esc(T('附件 · 架构二', 'Attachment · arch. 2'))}</th><th class="num">${esc(T('HAC-D · UBL128', 'HAC-D · UBL128'))}</th><th>${esc(T('核对', 'Check'))}</th></tr></thead><tbody>
    ${xrow(T('超节点', 'SuperPoDs'), fmt(A.native.pods), fmt(X.native.pods), fmt(A.ubl128.pods), fmt(X.ubl128.pods), T('一致', 'agree'))}
    ${xrow(T('计算柜', 'Compute cabinets'), fmt(A.native.computeRacks), fmt(X.native.racks), fmt(A.ubl128.computeRacks), fmt(X.ubl128.racks), T('一致（64 卡 / 柜）', 'agree (64 NPUs per cabinet)'))}
    ${xrow(T('UB 网络柜', 'UB network racks'), fmt(A.native.ubCabinets), fmt(X.native.commRacks), fmt(A.ubl128.ubCabinets), fmt(X.ubl128.commRacks), T('一致（UBL128 的 1 柜 / 4 超节点取自附件）', 'agree (UBL128’s 1 per 4 pods is taken from the attachment)'))}
    ${xrow(T('超节点内光模块', 'Scale-up transceivers'), kN(A.native.scaleUpOptics), kN(X.native.transceivers), kN(A.ubl128.scaleUpOptics), kN(X.ubl128.transceivers), T('附件原生只有 2 只 / NPU，LightCounting 为 4 只 / NPU（含两端）；UBL128 按 3.2 Tb/s 应为 8 只 / NPU（若全为光）', 'the attachment has 2 per NPU for native, LightCounting 4 per NPU (both ends); UBL128 at 3.2 Tb/s needs 8 per NPU if all optical'))}
    ${xrow(T('scale-out 交换机（层数）', 'Scale-out switches (tiers)'), T(`${fmt(A.native.switches)}（称两层）`, `${fmt(A.native.switches)} (called two tiers)`), T(`${fmt(soA.switches)}（${soA.tiers} 层，按附件端口与 radix 128）`, `${fmt(soA.switches)} (${soA.tiers} tiers, attachment’s ports at radix 128)`), T(`${fmt(A.ubl128.switches)}（称两层）`, `${fmt(A.ubl128.switches)} (called two tiers)`), T(`主算例 ${fmt(so512.switches)}（${so512.tiers} 层，radix 1,024）`, `main case ${fmt(so512.switches)} (${so512.tiers} tiers, radix 1,024)`), T('总数相同但层数不对：每平面 12.8 万端点时两层 radix 64 / 128 只能接 64 × 128 = 8,192 个，须三层；两层要 radix ≥ 512', 'same total but the wrong tier count: with 128,000 endpoints per plane two tiers of radix 64 / 128 reach only 64 × 128 = 8,192, so three are needed; two tiers need radix ≥ 512'))}
    ${xrow(T('scale-out 光模块', 'Scale-out transceivers'), kN(A.native.optics800G), kN(soA.transceivers), kN(A.ubl128.optics800G), kN(so512.transceivers), T('附件的“4 × N（两层）”对应 2 段链路；按三层是 6 × N = 307 万；主算例每 NPU 4 口，2 × 4 × 2 = 16 只 / NPU', 'the attachment’s “4 × N (two tiers)” means two link stages; with three tiers it is 6 × N = 3.07 M; the main case has 4 ports per NPU, 2 × 4 × 2 = 16 per NPU'))}
    ${xrow(T('机柜合计', 'Racks in total'), fmt(A.native.racksTotal), '—', fmt(A.ubl128.racksTotal), '—', T('附件约 240 个网络柜装 2 万台交换机，不合理；本页按每柜 2 台 radix-1,024 交换机估算', 'the attachment fits 20,000 switches into ≈ 240 network racks, not plausible; this page assumes 2 radix-1,024 switches per rack'))}
    ${xrow(T('功耗', 'Power'), `${A.native.powerMW} MW`, `${fmt((X.native.racks * 100) / 1000)} MW`, `${A.ubl128.powerMW} MW`, `${fmt((X.ubl128.racks * 100) / 1000)} MW`, T('HAC-D 只计计算柜 100 kW × 柜数；附件含网络与配套，口径不同', 'HAC-D counts compute cabinets only (100 kW each); the attachment includes network and plant, a different 口径'))}
  </tbody></table></div>`;

  /* ---------------- 5. method, mechanisms, assumptions ---------------- */
  const mechRows = R.mechanisms.map((m) => `<tr><td class="b">${esc(m.id)}</td><td>${esc(m.name[lang])}</td><td>${esc(m.change[lang])}</td><td class="src">${esc(Object.entries(m.parameters).map(([k, v]) => `${k} ${v}`).join(', '))}</td></tr>`).join('');
  const rec = R.baseline.recovery;
  const table8 = `<div class="table-wrap"><table class="t8"><thead><tr><th>${esc(T('机制', 'Mechanism'))}</th><th>${esc(T('名称', 'Name'))}</th><th>${esc(T('作用', 'What it does'))}</th><th>${esc(T('参数', 'Parameters'))}</th></tr></thead><tbody>${mechRows}<tr class="sum"><td class="b">${esc(T('基线', 'Baseline'))}</td><td>${esc(T('检测与全局恢复', 'Detection and global recovery'))}</td><td>${esc(T(`检测 ${fmt(rec.detection.coverage * 100)} % 在 ${rec.detection.autoSeconds} s，其余 ${rec.detection.timeoutSeconds} s；自动恢复 ${rec.automatic.seconds} s、成功 ${fmt(rec.automatic.successProbability * 100)} %，失败再加人工 ${fmt(rec.manual.seconds / 3600)} h；全局恢复均值 ${fmt(n500.kpi.globalS + n500.kpi.detectS, 1)} s`, `detection ${fmt(rec.detection.coverage * 100)} % in ${rec.detection.autoSeconds} s, the rest ${rec.detection.timeoutSeconds} s; automatic recovery ${rec.automatic.seconds} s at ${fmt(rec.automatic.successProbability * 100)} %, else manual + ${fmt(rec.manual.seconds / 3600)} h; mean global recovery ${fmt(n500.kpi.globalS + n500.kpi.detectS, 1)} s`))}</td><td class="src">${esc(T('参考目录作业设置', 'reference catalog job settings'))}</td></tr></tbody></table></div>`;

  const css = `
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
  const fN = figNative(lang, R, 'fig-native', 1);
  const fU = figUbl128(lang, R, 'fig-ubl128', 2);
  const keyFindings = [
    T(`<b>硬件规模</b>：两种架构的计算部分相同（64 卡柜，${fmt(S('native', 500000).counts.racks)} 个计算柜 @ 50 万卡）；差别在 UB 域：原生每 1,024 卡 4 个灵衢互联柜、16 台交换机、${fmt(mN.items.lrs.perPod)} 片 LRS；UBL128 每 128 卡 4 台交换机、无 LRS，但每 NPU 光链路多一倍（4 vs 2）。50 万卡时原生 ${fmt(S('native', 500000).counts.commRacks)} 个、UBL128 ${fmt(S('ubl128', 500000).counts.commRacks)} 个 UB 网络柜。`, `<b>Hardware</b>: compute is the same in both (64-NPU cabinets, ${fmt(S('native', 500000).counts.racks)} compute cabinets at 500k); the UB domain differs: native has 4 interconnect cabinets, 16 switches and ${fmt(mN.items.lrs.perPod)} LRS per 1,024 NPUs; UBL128 has 4 switches per 128 NPUs and no LRS but twice the optical links per NPU (4 vs 2). At 500k: ${fmt(S('native', 500000).counts.commRacks)} (native) vs ${fmt(S('ubl128', 500000).counts.commRacks)} (UBL128) UB network racks.`),
    T(`<b>可靠性随规模</b>：A_op ${pct(n10.kpi.aOp, 2)}（1 万）→ ${pct(S('native', 100000).kpi.aOp, 2)}（10 万）→ ${pct(n200.kpi.aOp, 2)}（20 万）→ ${pct(n500.kpi.aOp, 2)}（50 万，原生）；MTBF_hw 从 ${hrs(n10.kpi.mtbfHwH)} 降到 ${hrs(n500.kpi.mtbfHwH)}，MTTR_hw 约 ${fmt(n500.kpi.mttrS)} s 基本不随规模变。UBL128 高 0.004–0.21 个百分点。`, `<b>Reliability with scale</b>: A_op ${pct(n10.kpi.aOp, 2)} (10k) → ${pct(S('native', 100000).kpi.aOp, 2)} (100k) → ${pct(n200.kpi.aOp, 2)} (200k) → ${pct(n500.kpi.aOp, 2)} (500k, native); MTBF_hw from ${hrs(n10.kpi.mtbfHwH)} down to ${hrs(n500.kpi.mtbfHwH)}, MTTR_hw ≈ ${fmt(n500.kpi.mttrS)} s almost independent of size. UBL128 is 0.004–0.21 points higher.`),
    T(`<b>阈值</b>：跌破 99 % 约在 ${kN(thrN.aOp99)}（原生）/ ${kN(thrU.aOp99)}（UBL128）卡，跌破 98.5 % 约在 ${kN(thrN.aOp985)} / ${kN(thrU.aOp985)} 卡，MTBF_hw 低于 1 h 约在 ${kN(thrN.mtbf1h)} 卡。50 万卡达到 98.5 % 需要每 NPU FIT 降到 ${fmt(n500.required[0].fitPerNpuBudget)}（今天 ${fmt(n500.hardFitPerNpuTotal)}）或 MTTR 降到 ${fmt(n500.required[0].mttrReqS)} s。`, `<b>Thresholds</b>: below 99 % from ≈ ${kN(thrN.aOp99)} (native) / ${kN(thrU.aOp99)} (UBL128) NPUs, below 98.5 % from ≈ ${kN(thrN.aOp985)} / ${kN(thrU.aOp985)}, MTBF_hw under 1 h from ≈ ${kN(thrN.mtbf1h)}. At 500k, 98.5 % needs FIT per NPU down to ${fmt(n500.required[0].fitPerNpuBudget)} (today ${fmt(n500.hardFitPerNpuTotal)}) or MTTR down to ${fmt(n500.required[0].mttrReqS)} s.`),
    T(`<b>瓶颈</b>：没有快速恢复梯级的类别——作业级共享服务（存储、未归因 / 软件）、管理与板级 IO、计算柜供电 / 液冷、交换——只占硬件中断的 ${pct(nr500.ev, 0)}，却占停机时间的 ${pct(nr500.dt, 0)}（每次 ${fmt(n500.kpi.globalS + n500.kpi.detectS, 1)} s 全局恢复）。NPU 自身占中断 ${fmt((n500.breakdown.units.npu.lam / n500.kpi.lamHw) * 100)} %，只占停机 ${fmt((n500.breakdown.units.npu.lp / n500.kpi.sumLP) * 100)} %（重执行 + 弹性吸收）。两种架构的瓶颈相同。`, `<b>Bottleneck</b>: the classes without a fast recovery rung — job-level shared services (storage, unattributed / software), management and board IO, cabinet power / cooling, switches — are ${pct(nr500.ev, 0)} of the hardware interruptions but ${pct(nr500.dt, 0)} of the downtime (${fmt(n500.kpi.globalS + n500.kpi.detectS, 1)} s of global recovery each). The NPU itself is ${fmt((n500.breakdown.units.npu.lam / n500.kpi.lamHw) * 100)} % of the interruptions but only ${fmt((n500.breakdown.units.npu.lp / n500.kpi.sumLP) * 100)} % of the downtime (absorbed by replay and elastic recovery). The bottleneck is the same in both architectures.`),
    T(`<b>口径与边界</b>：故障率与机制参数逐项取自 ReMAP 与 ai-cluster-reliability 的同一份目录（54 类事件，每卡 FIT，GPU 机群的类比先验；8 项核对全部通过，见 HACD_REMAP_COMPARISON）；HAC-D 的拓扑模板再按 CloudMatrix384 几何把它换算到每个硬件单元，950 每 NPU 因此比仓库口径少约 7 %，仓库口径的结果见表 1 末行；都不是 950 实测；UBL128 除“128 卡、3.2 Tbps、单层交换、两层 scale-out”外的结构均为假设；scale-out 平面数、层数与 radix 950 未公开。`, `<b>口径 and limits</b>: failure rates and mechanism parameters are the values of the one catalog shared by ReMAP and ai-cluster-reliability (54 events, FIT per card, an analogue prior from GPU fleets; all 8 checks pass, see HACD_REMAP_COMPARISON); HAC-D’s topology templates then convert them per hardware unit under the CloudMatrix384 geometry, leaving the 950 about 7 % below the repositories’ arithmetic (their results are the last row of Table 1); none are 950 measurements; UBL128 beyond “128 NPUs, 3.2 Tbps, single-layer switch, two-tier scale-out” is assumed; the 950 scale-out planes, tiers and radix are not public.`),
  ];

  const sections = [
    `<div class="eyebrow">EYEBROW1</div>
  <h1>${esc(T('昇腾 950 两种超节点架构：1 万–50 万卡的硬件规模、可靠性与瓶颈', 'Two Ascend 950 SuperPoD architectures at 10k–500k NPUs: hardware scale, reliability and bottlenecks'))}</h1>
  <p class="sub">${T(`对象：<b>华为原生 Atlas 950 超节点</b>（产品页现行规格：16 计算柜 + 4 灵衢互联柜、1,024 NPU）与 <b>SuperPoD Flex / UBL128</b>（华为与 DeepSeek 联合定义：128 卡 3.2 Tbps 单层 UB 交换）。硬件数量由 HAC-D v4.3 引擎的 a950-ub2 模板算出（UBL128 = 同一模板换超节点几何，见第 2 节）；可靠性为一个同步训练作业在 <b>六个默认机制</b>（D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST，第 5 节）下的结果。超节点之间的 scale-out 两种架构取同一主算例（${R.scaleOut.main.name.zh}），其他设计见 3.4。架构背景见 <code>docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html</code>；第 6 节为 ReMAP 最新机制集 23 项的 Shapley 贡献。`, `Subjects: <b>Huawei’s native Atlas 950 SuperPoD</b> (current product-page spec: 16 compute + 4 UB interconnect cabinets, 1,024 NPUs) and <b>SuperPoD Flex / UBL128</b> (defined jointly by Huawei and DeepSeek: 128 NPUs on a 3.2 Tbps single-layer UB switch). Hardware counts come from the HAC-D v4.3 engine’s a950-ub2 template (UBL128 = the same template with another SuperPoD geometry, Section 2); reliability is that of one synchronous training job with the <b>six default mechanisms</b> (D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST, Section 5). Both use the same scale-out between SuperPoDs (${R.scaleOut.main.name.en}); other designs in 3.4. Architecture background: <code>docs/ASCEND_CLUSTER_ARCHITECTURE.zh.html</code>; Section 6 gives the Shapley contributions of the latest ReMAP mechanism set (23).`)}</p>
  <div class="callout"><ul>${keyFindings.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h2 class="first">${esc(T('1. 硬件规模与可靠性（表 1）', '1. Hardware scaling and reliability (Table 1)'))}</h2>
  ${table1}
  <div class="formula">A_op = (1 − φ_SDC) / (1 + (λ_hw · MTTR_hw + Σ_k λ_k · t_k) / 3600)　·　λ_hw = Σ_u n_u · FIT_u · 10⁻⁹ /h　·　MTBF_hw = 1/λ_hw　·　MTTR_hw = Σ_i λ_i · t̄_i / λ_hw [s]</div>
  <p class="note">${T('口径：事件 = 同步训练作业的硬中断（每次都会停住整个作业）；分母 = 集群·小时；层级 = 作业。n_u 为单元数（表中各行），FIT_u 为每单元每 10⁹ 小时的业务影响中断（保护之后）。t̄_i 为第 i 类中断在机制链上的平均暂停（检测 + 重执行 / 弹性 / 进程 / 全局恢复）；λ_k、t_k 为另两个事件类：亚健康单元隔离（每次 252 s）与静默数据损坏检出（每次 3 s），φ_SDC 为静默损坏片段占用的时间份额（< 0.01 %）。A_op 是运行时间份额，回滚重算与检查点开销计入有效产出，不在此列。MTBF_hw 是集群级“硬件中断间隔”，不是单个器件的 MTBF。粗体红底 = 低于 98.5 %，黄底 = 低于 99 %。“98.5 % 需要”一行：B = 3600·((1 − φ)/A* − 1) − F 为每小时允许的暂停秒数，MTBF_hw ≥ MTTR_hw / B，FIT / NPU ≤ 10⁹ / (MTBF_hw · N)。', '口径: event = a hard interruption of the synchronous training job (each one stops the whole job); denominator = cluster-hour; level = job. n_u = unit counts (rows of the table), FIT_u = business-impact interruptions per 10⁹ unit-hours (after the existing protection). t̄_i = mean pause of class i down the mechanism chain (detection + replay / elastic / process / global recovery); λ_k, t_k = the two other event classes: isolation of sub-healthy units (252 s each) and detected silent data corruption (3 s each); φ_SDC = time share of silent-corruption episodes (< 0.01 %). A_op is the running-time share; rollback recompute and checkpoint overhead count against goodput, not here. MTBF_hw is the cluster-level time between hardware interruptions, not a device MTBF. Bold on red = below 98.5 %, on yellow = below 99 %. “Needed for 98.5 %”: B = 3600·((1 − φ)/A* − 1) − F seconds of pause allowed per hour, MTBF_hw ≥ MTTR_hw / B, FIT per NPU ≤ 10⁹ / (MTBF_hw · N).')}</p>`,
    `<div class="eyebrow">EYEBROW2</div>
  <h2 class="first">${esc(T('2. 架构映射：超节点 ↔ 计算柜 ↔ 节点 ↔ NPU ↔ 部件', '2. Architecture mapping: SuperPoD ↔ cabinet ↔ node ↔ NPU ↔ components'))}</h2>
  <figure class="chart"><div class="scroll">${fN}</div></figure>
  <h3>${esc(T('表 2a：华为原生 Atlas 950 超节点（1,024 NPU）', 'Table 2a: Huawei native Atlas 950 SuperPoD (1,024 NPUs)'))}</h3>
  ${mapTable('native')}`,
    `<div class="eyebrow">EYEBROW3</div>
  <figure class="chart"><div class="scroll">${fU}</div></figure>
  <h3>${esc(T('表 2b：SuperPoD Flex / UBL128（128 NPU）', 'Table 2b: SuperPoD Flex / UBL128 (128 NPUs)'))}</h3>
  ${mapTable('ubl128')}
  <p class="note">${T('单元 FIT 来自参考目录在 CloudMatrix384 几何下的换算（每台交换机按一片 CloudMatrix384 UB 交换芯片 57.1 FIT、每条光链路按一条 L1–L2 链路 4.76 FIT，单元等价为假设；一台 100T 交换机含多片芯片与电源风扇，实际可能更高）。“恢复去向”按 50 万卡、六个机制下各类中断走到哪一级计（份额与规模无关）。分数“1/n”表示 n 个该层级共用一个部件。', 'FIT per unit is the reference catalog converted under the CloudMatrix384 geometry (each switch as one CloudMatrix384 UB chip, 57.1 FIT; each optical link as one L1–L2 link, 4.76 FIT; the unit equivalence is an assumption — a 100T switch has several chips plus power and fans and is likely worse). “Where recovery ends” is the share of each class’s interruptions ending at each rung with the six mechanisms (independent of size). A fraction “1/n” means n of that level share one component.')}</p>`,
    `<div class="eyebrow">EYEBROW4</div>
  <h2 class="first">${esc(T('3. 瓶颈分析：关键脆弱点与单点故障', '3. Bottleneck analysis: critical vulnerabilities and single points of failure'))}</h2>
  <figure class="chart"><div class="scroll">${chartAop()}</div></figure>
  <h3>${esc(T('3.1 中断从哪里来、停机花在哪里（50 万卡，表 3）', '3.1 Where interruptions come from and where the downtime goes (500k NPUs, Table 3)'))}</h3>
  <figure class="chart"><div class="scroll">${chartShares()}</div></figure>
  ${table3}
  <h3>${esc(T('3.2 逐个规模（表 4）', '3.2 Size by size (Table 4)'))}</h3>
  ${table4}
  <ul class="scale">${scaleText.map((t) => `<li>${t}</li>`).join('')}</ul>`,
    `<div class="eyebrow">EYEBROW5</div>
  <h3>${esc(T('3.3 单点故障与爆炸半径（表 5）', '3.3 Single points of failure and blast radius (Table 5)'))}</h3>
  <p class="note">${T('同步训练作业是串联系统：任何一个硬中断都会停住整个作业，所以每个部件都是作业的“单点”。区分关键与否的是两件事：一次故障波及多少卡（是否需要整机柜 / 整超节点重排），以及这一类中断有没有快速恢复梯级（否则每次付全局恢复的 264.5 s）。', 'A synchronous training job is a series system: any hard interruption stops the whole job, so every component is a single point for the job. What separates the critical ones is how many NPUs one failure reaches (whether a whole cabinet / pod must be re-planned) and whether its class has a fast recovery rung (otherwise each event pays the 264.5 s global recovery).')}</p>
  ${table5}
  <h3>${esc(T('3.4 敏感性', '3.4 Sensitivities'))}</h3>
  ${table6}
  <p class="note">${lrsText}</p>
  <p class="note">${T('8,192 卡的原生超节点（路线图）每 NPU 的器件数与本页 1,024 卡相同，可靠性数字一致；只是超节点数变为 2 / 13 / 25 / 62，超节点级共因（若有）一次波及 8,192 卡。', 'The native 8,192-NPU SuperPoD (roadmap) has the same devices per NPU as the 1,024-NPU one, so the reliability numbers are the same; only the pod count becomes 2 / 13 / 25 / 62 and a pod-level common cause (if any) reaches 8,192 NPUs.')}</p>
  <h2>${esc(T('4. 附件 51.2 万卡物料表的复算（表 7）', '4. The attachment’s 512,000-NPU bill of materials recomputed (Table 7)'))}</h2>
  ${table7}
  <h2>${esc(T('5. 六个默认机制与基线恢复（表 8）', '5. The six default mechanisms and the baseline recovery (Table 8)'))}</h2>
  ${table8}
  <p class="note">${T('其他假设：故障率为 54 类事件参考目录（中断 3,333.3 / 亚健康 69.0 / 静默 48.3 FIT 每卡，GPU 机群实测的类比）按单元换算，置信度 assumed；亚健康单元在 95 % 概率、平均 5 min 检出且片段（平均 24 h）仍在时隔离；未建模：存储与管理系统的器件数、配电与冷站、多作业分区、备机池、scale-out 交换机自身的冗余电源。', 'Other assumptions: failure rates are the 54-event reference catalog (interruption 3,333.3 / sub-health 69.0 / silent 48.3 FIT per card, an analogue of GPU-fleet measurements) converted per unit, confidence assumed; sub-healthy units are isolated when detected (95 %, mean 5 min) while the episode (mean 24 h) lasts; not modelled: device counts of storage and management systems, power distribution and cooling plant, multi-job partitions, spare pools, redundant supplies inside the scale-out switches.')}</p>
  <footer>${T(`来源：昇腾 Atlas 950 产品页（中英文，2026-10-20 复核：16 + 4 柜、每柜 64 NPU + 16 CPU、1.68 TB/s、约 100 kW、380 V AC / 336 V / 240 V 直流双路供电、2+2 光路保护）；LightCounting 2026-07-21；UB-Mesh（arXiv 2503.20377）与 Hot Chips 2025；华为计算官微 2026-09-30（经量子位授权转载，UBL128）；DeepEP-Ascend README；昇腾 950 白皮书；HC2025 / HC2026 新闻稿；docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html。复现：<code>node --import tsx scripts/ascend950-scaling.ts</code> → <code>node scripts/build-ascend950-scaling.mjs</code>；架构定义 <code>scripts/ascend950-archs.ts</code>，图 <code>scripts/ascend950-figures.mjs</code>；数字已由独立 Python 复算（计数、FIT、MTTR、A_op、预算，相对误差 ≤ 1e-7）。`, `Sources: Ascend Atlas 950 product page (zh and en, re-read 2026-10-20: 16 + 4 cabinets, 64 NPUs + 16 CPUs per cabinet, 1.68 TB/s, ≈ 100 kW, dual feeds 380 V AC / 336 V / 240 V DC, 2+2 optical-path protection); LightCounting 2026-07-21; UB-Mesh (arXiv 2503.20377) and Hot Chips 2025; Huawei Computing WeChat 2026-09-30 (republished by QbitAI with permission, UBL128); DeepEP-Ascend README; Ascend 950 white paper; HC2025 / HC2026 releases; docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html. Reproduce: <code>node --import tsx scripts/ascend950-scaling.ts</code> → <code>node scripts/build-ascend950-scaling.mjs</code>; architectures in <code>scripts/ascend950-archs.ts</code>, figures in <code>scripts/ascend950-figures.mjs</code>; the numbers were re-derived independently in Python (counts, FIT, MTTR, A_op, budgets; relative difference ≤ 1e-7).`)}</footer>`,
  ];
  const shap = shapleySection(lang, [{ id: 'native950', short: NAME.native, name: T('华为原生 Atlas 950 超节点', 'Huawei native Atlas 950 SuperPoD'), D: loadShapley('native950') }, { id: 'ubl128', short: NAME.ubl128, name: 'SuperPoD Flex / UBL128', D: loadShapley('ubl128') }], { h2: T('6. 机制贡献：ReMAP 最新机制集 23 项的 Shapley 归因（图 5、图 6）', '6. Mechanism contributions: Shapley attribution of the latest ReMAP mechanism set (Figures 5 and 6)'), firstFig: 5 });
  if (shap) sections.push(`<div class="eyebrow">EYEBROW${sections.length + 1}</div>\n  ${shap}`);
  const nPages = sections.length;
  const eyebrow = (i) => esc(T(`HAC-D · 昇腾 950 规模与可靠性 · ${DATE} · 第 ${i} / ${nPages} 页`, `HAC-D · Ascend 950 scale and reliability · ${DATE} · page ${i} / ${nPages}`));
  const body = sections.map((s, i) => `<section class="page" id="p${i + 1}">\n  ${s.replace(`EYEBROW${i + 1}`, eyebrow(i + 1))}\n</section>`).join('\n');
  const script = `<script>
(() => {
  const tip = document.getElementById('tip');
  const show = (el, x, y) => { const p = el.getAttribute('data-tip').split('|'); tip.innerHTML = '<b>' + p[0].replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</b>' + p.slice(1).map((s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])).join('<br>'); tip.style.display = 'block'; const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px'; tip.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 14)) + 'px'; };
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    el.addEventListener('click', (e) => { show(el, e.clientX, e.clientY); e.stopPropagation(); });
  });
  document.addEventListener('click', () => { tip.style.display = 'none'; });
})();
</script>`;
  const html = `<!doctype html>
<html lang="${T('zh-CN', 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T('昇腾 950 规模与可靠性', 'Ascend 950 scale and reliability'))}</title>
<meta name="description" content="${esc(T('华为原生 Atlas 950 超节点与 SuperPoD Flex / UBL128 在 1 万、10 万、20 万、50 万卡下的机柜与器件数、六个默认机制下的可用度、MTBF 与 MTTR，两张架构映射表，以及各规模的瓶颈与单点故障分析（HAC-D）。', 'Huawei native Atlas 950 SuperPoD and SuperPoD Flex / UBL128 at 10k, 100k, 200k and 500k NPUs: racks and devices, availability, MTBF and MTTR with the six default mechanisms, two architecture mapping tables, and the bottlenecks and single points of failure at each size (HAC-D).'))}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<main>
${body}
</main>
<div id="tip" role="tooltip"></div>
${script}
</body>
</html>
`;
  const out = `docs/ASCEND950_SCALING_RELIABILITY.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
page('zh');
page('en');
