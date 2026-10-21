#!/usr/bin/env node
/**
 * Build docs/ASCEND910C_SCALING_RELIABILITY.{zh,en}.html from docs/ascend910c-scaling/results.json (scripts/ascend910c-scaling.ts):
 * Ascend 910C as the Atlas 900 A3 SuperPoD / CloudMatrix384 (384 NPUs) and as Atlas 800T A3 servers (8 NPUs) on RoCE, at 10k / 100k /
 * 200k / 500k NPUs — (1) hardware scaling and reliability table, (2) two architecture mapping tables (UB domain ↔ cabinet ↔ node ↔
 * NPU ↔ components), (3) bottleneck analysis (where interruptions and downtime come from, size by size, single points of failure,
 * sensitivities), (4) cross-checks against the paper, the press and the other "950 与 910C" report. Figures from
 * scripts/ascend910c-figures.mjs; page style shared with scripts/build-ascend950-scaling.mjs.
 * Usage: node scripts/build-ascend910c-scaling.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { esc, fmt, svgOpen, titleBlock, legend, wrap, lines } from './ascend950-figures.mjs';
import { figCm384, figA3Server } from './ascend910c-figures.mjs';
import { loadShapley, shapleySection } from './shapley-figure.mjs';

const R = JSON.parse(readFileSync('docs/ascend910c-scaling/results.json', 'utf8'));
const DATE = R.generated.slice(0, 10);
const SIZES = R.sizes;
const ARCHS = ['cm384', 'a3server'];
const S = (a, n) => R.archs[a].sizes[String(n)];
const pct = (x, d = 3) => `${(x * 100).toFixed(d)} %`;
const kN = (n) => (n >= 1000 ? `${fmt(n / 1000)}k` : fmt(n));
const kM = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : kN(n));
// the page style of the Atlas 950 report (one look for the series)
const BASE_CSS = readFileSync('scripts/build-ascend950-scaling.mjs', 'utf8').match(/const css = `([\s\S]*?)`;\n/)[1];

function page(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const hShort = (h) => (h >= 10 ? `${fmt(h, 1)} h` : h >= 1 ? `${fmt(h, 2)} h` : `${fmt(h * 60)} min`);
  const hrs = (h) => (h >= 10 ? `${fmt(h, 1)} h` : h >= 1 ? `${fmt(h, 2)} h` : T(`${fmt(h, 3)} h（${fmt(h * 60)} min）`, `${fmt(h, 3)} h (${fmt(h * 60)} min)`));
  const days = (h) => (h >= 24 * 365 ? T(`${fmt(h / 8760, 1)} 年`, `${fmt(h / 8760, 1)} y`) : h >= 48 ? T(`${fmt(h / 24)} 天`, `${fmt(h / 24)} d`) : `${fmt(h, 1)} h`);
  const NAME = { cm384: 'CM384', a3server: '800T A3' };
  const UNIT = {
    job: T('作业级共享服务（共享存储、未归因 / 软件）', 'Job-level shared services (shared storage, unattributed / software)'),
    node: T('节点（DDR、SSD、板级 IO、管理 BMC）', 'Node (DDR, SSD, board IO, management BMC)'),
    cabinet: T('计算柜（供电、散热）', 'Compute cabinet (power, cooling)'),
    npu: T('NPU（计算核、片上 SRAM、IO Die、HBM、UB / RDMA 口）', 'NPU (cores, SRAM, IO die, HBM, UB / RDMA ports)'),
    'ub-switch': T('UB 交换芯片（L1，CM384 另有 L2）', 'UB switch chips (L1; CM384 also L2)'),
    'ub-link': T('UB L1–L2 光链路（仅 CM384）', 'UB L1–L2 optical link (CM384 only)'),
    cpu: T('鲲鹏 920 CPU', 'Kunpeng 920 CPU'),
    'roce-switch': T('RoCE / RDMA 交换机', 'RoCE / RDMA switch'),
    'roce-link': T('RoCE / RDMA 光链路', 'RoCE / RDMA optical link'),
  };
  const UNITS = ['job', 'node', 'cabinet', 'npu', 'ub-switch', 'cpu', 'roce-link', 'ub-link', 'roce-switch'];
  const ENDS = (e) => [['replay', T('重执行', 'replay')], ['elastic', T('弹性', 'elastic')], ['process', T('进程', 'process')], ['global', T('全局', 'global')]].filter(([k]) => (e[k] ?? 0) > 0.0005).map(([k, l]) => `${l} ${fmt((e[k] ?? 0) * 100)} %`).join(' · ');
  const c500 = S('cm384', 500000), s500 = S('a3server', 500000), c200 = S('cm384', 200000), s200 = S('a3server', 200000), c10 = S('cm384', 10000), c100 = S('cm384', 100000);
  const thrC = R.archs.cm384.thresholds, thrS = R.archs.a3server.thresholds;
  const mC = R.archs.cm384.mapping, mS = R.archs.a3server.mapping;
  const so = R.scaleOut.main.so;
  const X = R.crossCheck;
  const noRung = (x) => { const d = Object.values(x.breakdown.domains).filter((v) => v.pGlobal > 0.999); return { ev: d.reduce((a, v) => a + v.lam, 0) / x.kpi.lamHw, dt: d.reduce((a, v) => a + v.lp, 0) / x.kpi.sumLP }; };
  const nr500 = noRung(c500);
  const ubFit = (s) => (s.hardFitPerNpu['ub-switch'] ?? 0) + (s.hardFitPerNpu['ub-link'] ?? 0);
  const tierStr = (s) => s.counts.scaleOutPerTier.map((v) => fmt(v)).join(' / ');

  /* ---------------- 1. hardware scaling and reliability table ---------------- */
  const row = (label, get, opts = {}) => ({ label, get, ...opts });
  const sec = (label) => ({ section: label });
  const T1 = [
    sec(T('机柜', 'Racks')),
    row(T('计算柜（4 节点 = 32 NPU / 柜）', 'Compute cabinets (4 nodes = 32 NPUs each)'), (s) => fmt(s.counts.racks), { src: T('论文；800T A3 假设', 'paper; 800T A3 assumed') }),
    row(T('网络柜 · UB 域：CM384 为通信柜（L2，4 / 超节点）；800T A3 无', 'Network racks · UB domain: CM384 communication cabinets (L2, 4 per pod); none for 800T A3'), (s) => fmt(s.counts.commRacks), { src: T('论文', 'paper') }),
    row(T(`网络柜 · scale-out（估算：每柜 ${R.constants.scaleOutSwitchesPerRack} 台 64 口交换机）`, `Network racks · scale-out (estimate: ${R.constants.scaleOutSwitchesPerRack} 64-port switches per rack)`), (s) => fmt(s.derived.scaleOutRacks), { src: T('假设', 'assumed') }),
    row(T('机柜合计（不含存储、管理与供电制冷配套）', 'Racks in total (storage, management, power and cooling plant not counted)'), (s) => fmt(s.derived.racksTotal), { bold: true }),
    sec(T('计算', 'Compute')),
    row(T('UB 域：CM384 超节点 / 800T A3 服务器', 'UB domains: CM384 SuperPoDs / 800T A3 servers'), (s) => fmt(s.derived.ubDomains), { src: T('⌈N ÷ 域卡数⌉', '⌈N ÷ domain size⌉') }),
    row(T('节点 = 8 NPU 主板（800T A3 即一台服务器）', 'Nodes = 8-NPU boards (an 800T A3 is one server)'), (s) => fmt(s.counts.nodes), { src: T('论文；产品页', 'paper; product page') }),
    row(T('CPU（鲲鹏 920，每节点 4）', 'CPUs (Kunpeng 920, 4 per node)'), (s) => fmt(s.counts.cpus), { src: T('论文；产品页', 'paper; product page') }),
    row(T('HBM 合计（128 GB / NPU，PB）', 'HBM in total (128 GB per NPU, PB)'), (s) => fmt(s.derived.hbmTB / 1000, 2), { src: T('产品文档', 'product documentation') }),
    sec(T('UB scale-up 网络', 'UB scale-up network')),
    row(T('L1 UB 交换芯片（板载，每节点 7）', 'L1 UB switch chips (on board, 7 per node)'), (s) => fmt(s.counts.l1Switches), { src: T('论文', 'paper') }),
    row(T('L2 UB 交换芯片（CM384：7 子平面 × 16 / 超节点）', 'L2 UB switch chips (CM384: 7 sub-planes × 16 per pod)'), (s) => fmt(s.counts.l2Switches), { src: T('论文', 'paper') }),
    row(T('UB L1–L2 光链路（CM384：每 NPU 14 条）', 'UB L1–L2 optical links (CM384: 14 per NPU)'), (s) => fmt(s.counts.opticalLinks), { src: T('论文推算', 'derived from the paper') }),
    row(T('UB 链路端 / 光模块（每链路 2 个，假设）', 'UB link ends / transceivers (2 per link, assumed)'), (s) => kM(s.counts.transceivers), { src: T('假设；SemiAnalysis 6,912 只 / 超节点', 'assumed; SemiAnalysis 6,912 per pod') }),
    sec(T(`scale-out（主算例：每 NPU ${so.portsPerNpu} × 200G，${so.radix} 口交换机，无收敛折叠 Clos）`, `Scale-out (main case: ${so.portsPerNpu} × 200G per NPU, ${so.radix}-port switches, non-blocking folded Clos)`)),
    row(T('端口（每 die 1 个 RDMA 口）', 'Ports (one RDMA port per die)'), (s) => kM(s.counts.scaleOutPorts), { src: T('论文', 'paper') }),
    row(T('交换机：层 1 / 层 2 / 层 3 / 层 4', 'Switches: tier 1 / 2 / 3 / 4'), (s) => tierStr(s), { src: T('假设（Clos 计数）', 'assumed (Clos counting)'), wrap: true }),
    row(T('交换机合计', 'Switches in total'), (s) => fmt(s.counts.scaleOutSwitches), { src: T('假设', 'assumed') }),
    row(T('链路 / 光模块', 'Links / transceivers'), (s) => `${kM(s.counts.scaleOutLinks)} / ${kM(s.counts.scaleOutTransceivers)}`, { src: T('假设', 'assumed') }),
    sec(T('可靠性（六个默认机制，同步训练作业）', 'Reliability (six default mechanisms, one synchronous training job)')),
    row(T('硬件中断率（FIT / NPU，业务影响）', 'Hardware interruption rate (FIT per NPU, business impact)'), (s) => fmt(s.hardFitPerNpuTotal), { src: T('目录 × 单元数', 'catalog × unit counts') }),
    row(T('硬件中断（次 / 天）', 'Hardware interruptions per day'), (s) => fmt(s.kpi.lamHw * 24, 1), { src: 'λ_hw × 24' }),
    row(T('MTBF_hw（集群级，硬件中断间隔）', 'MTBF_hw (cluster level, between hardware interruptions)'), (s) => hShort(s.kpi.mtbfHwH), { src: '1 / λ_hw', bold: true }),
    row(T('MTTR_hw（每次中断的平均暂停）', 'MTTR_hw (mean pause per interruption)'), (s) => `${fmt(s.kpi.mttrS, 1)} s`, { src: 'Σ λᵢ t̄ᵢ / λ_hw', bold: true }),
    row(T('其他暂停：亚健康隔离 + 静默检出（次 / 天）', 'Other pauses: isolation of sub-healthy units + detected silent corruption (per day)'), (s) => `${fmt(s.kpi.other[0].ratePerHour * 24, 2)} + ${fmt(s.kpi.other[1].ratePerHour * 24, 2)}`, { src: T('252 s / 3 s 每次', '252 s / 3 s each') }),
    row(T('系统可用度 A_op', 'System availability A_op'), (s) => pct(s.kpi.aOp), { src: T('见下式；= ReMAP 的“运行可用度”', 'formula below; = ReMAP’s “operational availability”'), bold: true, cls: (s) => (s.kpi.aOp < 0.985 ? 'bad' : s.kpi.aOp < 0.99 ? 'mid' : '') }),
    row(T('正确有效产出（保留的正确进度 ÷ 30 天窗口）', 'Delivered goodput (retained correct progress ÷ 30-day window)'), (s) => pct(s.kpi.delivered, 2), { src: T('= ReMAP 的“可用度”主指标', '= ReMAP’s headline “availability”') }),
    row(T('参照：两个仓库的原值（每卡 FIT，不做拓扑换算）A_op ／ 有效产出', 'Reference: the two repositories’ values (FIT per card, no topology conversion) A_op / goodput'), (s) => { const r = R.repoPerCard[String(s.npus)]; return `${pct(r.aOp, 2)} /\n${pct(r.delivered, 2)}`; }, { src: T('= CM384 去掉 scale-out（标定几何）', '= CM384 without scale-out (the calibration geometry)'), wrap: true }),
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
    const line = (label, x, fitCell, impact, src) => `<tr><td>${esc(label)}</td><td class="num">${esc(r(x.perDomain))}</td><td class="num">${esc(r(x.perRack))}</td><td class="num">${esc(r(x.perNode))}</td><td class="num">${esc(r(x.perNpu))}</td><td class="num">${esc(fitCell)}</td><td>${esc(impact)}</td><td class="src">${esc(src)}</td></tr>`;
    const cm = arch === 'cm384';
    const rows = [
      line(T('计算柜', 'Compute cabinet'), it.computeRack, fmt(f.cabinet), T(`32 NPU；${ends('cabinet')}`, `32 NPUs; ${ends('cabinet')}`), cm ? T('论文（液冷）', 'paper (liquid-cooled)') : T('假设（每柜 4 台）', 'assumed (4 per cabinet)')),
    ];
    if (cm) rows.push(line(T('通信柜（L2 交换）', 'Communication cabinet (L2 switching)'), it.networkRack, T('计入交换', 'in the switches'), T('约 28 片 L2：若按子平面均分，即每个子平面 1/4 带宽', '≈ 28 L2 chips: if spread evenly over the sub-planes, 1/4 of every sub-plane’s bandwidth'), T('论文；分布假设', 'paper; placement assumed')));
    rows.push(
      line(cm ? T('节点（8 NPU 主板 = 800T A3 同款）', 'Node (8-NPU board, as in the 800T A3)') : T('节点 = 一台 800T A3 服务器（10U）', 'Node = one 800T A3 server (10U)'), it.node, fmt(f.node), T(`8 NPU；${ends('node')}`, `8 NPUs; ${ends('node')}`), cm ? T('论文', 'paper') : T('产品页', 'product page')),
      line(T('NPU（昇腾 910C，2 die，128 GB HBM）', 'NPU (Ascend 910C, 2 dies, 128 GB HBM)'), it.npu, fmt(f.npu), T(`1 NPU；${ends('npu')}`, `1 NPU; ${ends('npu')}`), T('论文', 'paper')),
      line(T('CPU（鲲鹏 920）', 'CPU (Kunpeng 920)'), it.cpu, fmt(f.cpu), T(`所在节点；${ends('cpu')}`, `its node; ${ends('cpu')}`), T('论文；产品页', 'paper; product page')),
      line(T('擎天卡（VPC 面）', 'Qingtian card (VPC plane)'), it.qingtian, T('计入管理 / 存储', 'in MGMT / STORAGE'), T('存储 / 管理通路', 'storage / management path'), T('论文', 'paper')),
      line(T('L1 UB 交换芯片（板载）', 'L1 UB switch chip (on board)'), it.l1, fmt(f.ubSwitch, 1), cm ? T(`节点 UB 带宽的 1/7（一个子平面）；${ends('ub-switch')}`, `1/7 of the node’s UB bandwidth (one sub-plane); ${ends('ub-switch')}`) : T(`服务器内 UB 带宽的 1/7；${ends('ub-switch')}`, `1/7 of the server’s internal UB bandwidth; ${ends('ub-switch')}`), T('论文', 'paper')),
    );
    if (cm) rows.push(
      line(T('L2 UB 交换芯片', 'L2 UB switch chip'), it.l2, fmt(f.ubSwitch, 1), T('所在子平面带宽的 1/16（热点，不断连）', '1/16 of its sub-plane’s bandwidth (a hotspot, not a disconnection)'), T('论文', 'paper')),
      line(T('UB L1–L2 光链路', 'UB L1–L2 optical link'), it.opticalLink, fmt(f.ubLink, 2), T(`该 L1 上行的 1/16；${ends('ub-link')}`, `1/16 of its L1’s uplinks; ${ends('ub-link')}`), T('论文推算', 'derived from the paper')),
      line(T('UB 光模块 / 链路端', 'UB transceiver / link end'), it.transceiver, T('计入链路', 'with its link'), '—', T('假设', 'assumed')),
    );
    rows.push(
      line(T('scale-out 端口（200G，每 die 1 个）', 'Scale-out port (200G, one per die)'), it.soPort, T('计入 NPU 的 NIC 类', 'in the NPU NIC class'), T('该 die 的 scale-out', 'that die’s scale-out'), T('论文', 'paper')),
      line(T('scale-out 叶交换机（份额）', 'Scale-out leaf switch (share)'), it.soLeaf, fmt(f.soSwitch, 1), T(`${fmt(so.radix / 2)} 个端口`, `${fmt(so.radix / 2)} ports`), T('假设', 'assumed')),
      line(T('scale-out 交换机合计（4 层份额，50 万卡）', 'Scale-out switches, all tiers (share, 500k)'), it.soSwitch, fmt(f.soSwitch, 1), T(`上层一台 = 上联带宽的一小部分；${ends('roce-switch')}`, `an upper-tier switch = a small share of the uplink bandwidth; ${ends('roce-switch')}`), T('假设', 'assumed')),
      line(T('scale-out 光链路（50 万卡）', 'Scale-out optical link (500k)'), it.soLink, fmt(f.soLink, 2), T(`1 个端口或 1 条上联；${ends('roce-link')}`, `one port or one uplink; ${ends('roce-link')}`), T('假设', 'assumed')),
    );
    const L = Object.fromEntries(m.levels.map((l) => [l.id, l]));
    rows.push(`<tr class="b sum"><td>${esc(T('本层内硬中断 FIT 合计', 'Hard FIT contained in the level'))}</td><td class="num">${fmt(L.domain.fit)}</td><td class="num">${fmt(L.rack.fit)}</td><td class="num">${fmt(L.node.fit)}</td><td class="num">${fmt(L.npu.fit)}</td><td colspan="3" class="src">${esc(cm ? T(`超节点 = 12 计算柜 + 112 片 L2；计算柜 = 4 节点 + 柜（供电液冷）+ 448 条光链路；节点 = 8 NPU + 节点 + 4 CPU + 7 片 L1。另有集群层：作业级服务 ${fmt(m.cluster.jobPerNpu, 1)}、scale-out ${fmt(m.cluster.scaleOutPerNpu, 1)} FIT / NPU（50 万卡）`, `pod = 12 cabinets + 112 L2 chips; cabinet = 4 nodes + cabinet (power, cooling) + 448 optical links; node = 8 NPUs + node + 4 CPUs + 7 L1 chips. Cluster level on top: job-level services ${fmt(m.cluster.jobPerNpu, 1)}, scale-out ${fmt(m.cluster.scaleOutPerNpu, 1)} FIT per NPU (500k)`) : T(`UB 域 = 服务器 = 节点 = 8 NPU + 节点 + 4 CPU + 7 片 L1；计算柜 = 4 台 + 柜（供电散热）。另有集群层：作业级服务 ${fmt(m.cluster.jobPerNpu, 1)}、scale-out ${fmt(m.cluster.scaleOutPerNpu, 1)} FIT / NPU（50 万卡）`, `UB domain = server = node = 8 NPUs + node + 4 CPUs + 7 L1 chips; cabinet = 4 servers + cabinet (power, cooling). Cluster level on top: job-level services ${fmt(m.cluster.jobPerNpu, 1)}, scale-out ${fmt(m.cluster.scaleOutPerNpu, 1)} FIT per NPU (500k)`))}</td></tr>`);
    rows.push(`<tr class="b sum"><td>${esc(T('对应 MTBF（该层任一硬中断）', 'Matching MTBF (any hard interruption in the level)'))}</td><td class="num">${esc(days(L.domain.mtbfH))}</td><td class="num">${esc(days(L.rack.mtbfH))}</td><td class="num">${esc(days(L.node.mtbfH))}</td><td class="num">${esc(days(L.npu.mtbfH))}</td><td colspan="3" class="src">${esc(T(`每 NPU：UB 域层 ${fmt(L.domain.fitPerNpu, 1)}、柜层 ${fmt(L.rack.fitPerNpu, 1)}、节点层 ${fmt(L.node.fitPerNpu, 1)} FIT`, `per NPU: ${fmt(L.domain.fitPerNpu, 1)} at UB-domain level, ${fmt(L.rack.fitPerNpu, 1)} at cabinet level, ${fmt(L.node.fitPerNpu, 1)} at node level`))}</td></tr>`);
    const domHead = cm ? T(`每超节点（${fmt(m.domainNpus)} NPU）`, `Per SuperPoD (${fmt(m.domainNpus)} NPUs)`) : T('每 UB 域 = 每台服务器（8 NPU）', 'Per UB domain = per server (8 NPUs)');
    const headM = `<tr><th>${esc(T('部件', 'Component'))}</th><th class="num">${esc(domHead)}</th><th class="num">${esc(T('每计算柜（32 NPU）', 'Per cabinet (32 NPUs)'))}</th><th class="num">${esc(T('每节点', 'Per node'))}</th><th class="num">${esc(T('每 NPU', 'Per NPU'))}</th><th class="num">${esc(T('单元 FIT', 'FIT per unit'))}</th><th>${esc(T('一次故障的影响；恢复去向（六个机制）', 'What one failure takes out; where recovery ends (six mechanisms)'))}</th><th>${esc(T('依据', 'Basis'))}</th></tr>`;
    return `<div class="table-wrap"><table class="map"><thead>${headM}</thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  /* ---------------- 3. bottleneck: charts ---------------- */
  function chartAop() {
    const W = 960, H = 318, x0 = 74, x1 = 836, y0 = 52, y1 = 262;
    const lo = Math.log10(5000), hi = Math.log10(600000);
    const Xp = (n) => x0 + ((Math.log10(n) - lo) / (hi - lo)) * (x1 - x0);
    const yLo = Math.floor(Math.min(...ARCHS.flatMap((a) => R.curve[a].map((p) => p.aOp))) * 100) / 100, yHi = 1.0;
    const Y = (a) => y1 - ((a - yLo) / (yHi - yLo)) * (y1 - y0);
    const head = titleBlock(T('图 3：系统可用度 A_op 随规模下降（六个默认机制；虚线为 99 % 与 98.5 %）', 'Figure 3: system availability A_op falls with scale (six default mechanisms; dashed: 99 % and 98.5 %)'));
    let g = svgOpen('fig-aop', W, H, T('A_op 与规模', 'A_op versus scale')) + head.svg;
    for (let v = yLo; v <= yHi + 1e-9; v += 0.01) g += `<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" class="grid"/><text x="${x0 - 8}" y="${Y(v) + 4}" class="m" text-anchor="end">${(v * 100).toFixed(0)} %</text>`;
    for (const n of [5000, 10000, 20000, 50000, 100000, 200000, 500000]) g += `<line x1="${Xp(n)}" y1="${y1}" x2="${Xp(n)}" y2="${y1 + 4}" class="axis"/><text x="${Xp(n)}" y="${y1 + 17}" class="m" text-anchor="middle">${esc(kN(n))}</text>`;
    g += `<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" class="axis"/><text x="${(x0 + x1) / 2}" y="${y1 + 33}" class="s" text-anchor="middle">${esc(T('NPU 数（对数轴）', 'NPUs (log axis)'))}</text>`;
    for (const [v, lab] of [[0.99, '99 %'], [0.985, '98.5 %']]) g += `<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" style="stroke:var(--muted);stroke-width:1.2;stroke-dasharray:5 4"/><text x="${x1 + 6}" y="${Y(v) + 4}" class="s">${lab}</text>`;
    // the stated CM384 cluster ceiling (165,000 NPUs)
    const xc = Xp(X.published.maxClusterNpus);
    g += `<line x1="${xc}" y1="${y0 - 4}" x2="${xc}" y2="${y1}" style="stroke:var(--s4);stroke-width:1.2;stroke-dasharray:3 3"/><text x="${xc + 4}" y="${y0 + 4}" class="s halo">${esc(T('CM384 公开上限 16.5 万卡', 'stated CM384 ceiling: 165,000'))}</text>`;
    const col = { cm384: 'var(--s1)', a3server: 'var(--s2)' };
    for (const a of ARCHS) {
      const pts = R.curve[a].map((p) => `${Xp(p.n).toFixed(1)},${Y(p.aOp).toFixed(1)}`).join(' ');
      g += `<polyline points="${pts}" fill="none" style="stroke:${col[a]};stroke-width:2"/>`;
    }
    for (const a of ARCHS) {
      const t = R.archs[a].thresholds;
      for (const [lev, n] of [[0.99, t.aOp99], [0.985, t.aOp985]]) g += `<line x1="${Xp(n)}" y1="${Y(lev) - 6}" x2="${Xp(n)}" y2="${Y(lev) + 6}" style="stroke:${col[a]};stroke-width:2"/>`;
      for (const n of SIZES) {
        const s = S(a, n);
        const tip = `${NAME[a]} · ${fmt(n)} NPU|A_op ${pct(s.kpi.aOp)}|MTBF_hw ${hrs(s.kpi.mtbfHwH)}|MTTR_hw ${fmt(s.kpi.mttrS, 1)} s|${T('硬件中断', 'hardware interruptions')} ${fmt(s.kpi.lamHw * 24, 1)} / ${T('天', 'day')}`;
        g += `<circle cx="${Xp(n)}" cy="${Y(s.kpi.aOp)}" r="4.6" style="fill:${col[a]};stroke:var(--surface);stroke-width:1.6" data-tip="${esc(tip)}"/><circle cx="${Xp(n)}" cy="${Y(s.kpi.aOp)}" r="11" fill="transparent" data-tip="${esc(tip)}"/>`;
      }
    }
    const endC = R.curve.cm384.at(-1), endS = R.curve.a3server.at(-1);
    g += `<text x="${Xp(endC.n) + 6}" y="${Y(endC.aOp) + 12}" class="s halo">${esc(`CM384 ${pct(endC.aOp, 2)}`)}</text>`;
    g += `<text x="${Xp(endS.n) + 6}" y="${Y(endS.aOp) - 5}" class="s halo">${esc(`800T A3 ${pct(endS.aOp, 2)}`)}</text>`;
    const note = T(`竖短线：跌破 99 % 与 98.5 % 的规模——CM384 ${kN(thrC.aOp99)} / ${kN(thrC.aOp985)}，800T A3 ${kN(thrS.aOp99)} / ${kN(thrS.aOp985)} NPU；两条线几乎重合（差 ≤ 0.10 个百分点）；端点为 60 万卡`, `Ticks: the size where A_op falls below 99 % and 98.5 % — CM384 ${kN(thrC.aOp99)} / ${kN(thrC.aOp985)}, 800T A3 ${kN(thrS.aOp99)} / ${kN(thrS.aOp985)} NPUs; the two lines nearly coincide (≤ 0.10 points apart); curves end at 600k NPUs`);
    g += lines(x0 + 10, Y(0.9625), wrap(note, 470, 9.8), 's halo', 12);
    const lg = legend(x0, H - 8, [{ label: 'CM384', line: true, style: 'stroke:var(--s1);stroke-width:2' }, { label: '800T A3', line: true, style: 'stroke:var(--s2);stroke-width:2' }]);
    g += lg.g;
    return g + '</svg>';
  }
  function chartShares() {
    const U = c500.breakdown.units, UU = s500.breakdown.units;
    const lam = c500.kpi.lamHw, lp = c500.kpi.sumLP;
    const rows = UNITS.map((u) => ({ u, ev: U[u].lam / lam, dt: U[u].lp / lp, x: U[u] }));
    const W = 960, rowH = 30, x0 = 300, x1 = 860, y0 = 56;
    const H = y0 + rows.length * rowH + 44;
    const max = 0.6;
    const Xs = (v) => x0 + (v / max) * (x1 - x0);
    const head = titleBlock(T('图 4：CM384 的硬件中断从哪里来、停机时间花在哪里（份额与规模无关；800T A3 只少了 UB 光链路与 L2 两项）', 'Figure 4: where the CM384’s hardware interruptions come from and where the downtime goes (shares do not depend on scale; the 800T A3 only lacks the UB optics and the L2 tier)'));
    let g = svgOpen('fig-shares', W, H + head.dy, T('中断份额与停机份额', 'Interruption and downtime shares')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    for (const v of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) g += `<line x1="${Xs(v)}" y1="${y0 - 6}" x2="${Xs(v)}" y2="${y0 + rows.length * rowH}" class="grid"/><text x="${Xs(v)}" y="${y0 - 10}" class="m" text-anchor="middle">${fmt(v * 100)} %</text>`;
    rows.forEach((r, i) => {
      const y = y0 + i * rowH;
      const lab = wrap(UNIT[r.u], x0 - 24, 9.8);
      g += lines(x0 - 10, y + 12 - (lab.length - 1) * 5.5, lab, 's', 11, 'end');
      const other = UU[r.u] ? `${T('800T A3', '800T A3')}: ${pct(UU[r.u].lam / s500.kpi.lamHw, 1)} · ${pct(UU[r.u].lp / s500.kpi.sumLP, 1)}` : T('800T A3：无此单元', '800T A3: no such unit');
      const tip = `${UNIT[r.u]}|FIT / NPU: CM384 ${fmt(c500.hardFitPerNpu[r.u] ?? 0, 1)} · 800T A3 ${fmt(s500.hardFitPerNpu[r.u] ?? 0, 1)}|${T('中断份额', 'interruption share')} ${pct(r.ev, 1)} · ${T('停机份额', 'downtime share')} ${pct(r.dt, 1)}|${T('每次暂停', 'pause per event')} ${fmt(r.x.mttrS, 1)} s · ${ENDS(r.x.ends)}|${T('50 万卡', '500k NPUs')}: ${fmt(r.x.lam * 24, 2)} ${T('次 / 天', 'per day')} · ${fmt((r.x.lp * 24) / 60, 1)} ${T('分钟停机 / 天', 'min of pause per day')}|${other}`;
      g += `<rect x="${x0}" y="${y + 3}" width="${Math.max(1.5, Xs(r.ev) - x0)}" height="9" rx="2" style="fill:var(--s1)" data-tip="${esc(tip)}"/>`;
      g += `<rect x="${x0}" y="${y + 14}" width="${Math.max(1.5, Xs(r.dt) - x0)}" height="9" rx="2" style="fill:var(--s2)" data-tip="${esc(tip)}"/>`;
      g += `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent" data-tip="${esc(tip)}"/>`;
      if (r.ev >= 0.04) g += `<text x="${Xs(r.ev) + 4}" y="${y + 11}" class="tiny">${fmt(r.ev * 100, 1)} %</text>`;
      if (r.dt >= 0.04) g += `<text x="${Xs(r.dt) + 4}" y="${y + 22}" class="tiny">${fmt(r.dt * 100, 1)} %</text>`;
    });
    const lg = legend(x0, y0 + rows.length * rowH + 22, [{ label: T('占硬件中断次数', 'share of hardware interruptions'), style: 'fill:var(--s1)' }, { label: T('占硬件中断停机时间（λ × 每次暂停）', 'share of hardware-interruption downtime (λ × pause)'), style: 'fill:var(--s2)' }]);
    g += lg.g;
    return g + '</g></svg>';
  }

  /* ---------------- 3. bottleneck: tables ---------------- */
  const unitRows = UNITS.map((u) => {
    const a = c500.breakdown.units[u], b = s500.breakdown.units[u];
    const bShare = b ? `${fmt((b.lp / s500.kpi.sumLP) * 100, 1)} %` : '—';
    return `<tr><td>${esc(UNIT[u])}</td><td class="num">${fmt(c500.hardFitPerNpu[u] ?? 0, 1)} / ${b ? fmt(s500.hardFitPerNpu[u] ?? 0, 1) : '—'}</td><td class="num">${fmt((a.lam / c500.kpi.lamHw) * 100, 1)} %</td><td class="num">${fmt(a.mttrS, 1)} s</td><td>${esc(ENDS(a.ends))}</td><td class="num${a.lp / c500.kpi.sumLP >= 0.1 ? ' bad' : ''}">${fmt((a.lp / c500.kpi.sumLP) * 100, 1)} % / ${bShare}</td><td class="num">${fmt(a.lam * 24, 2)}</td><td class="num">${fmt((a.lp * 24) / 60, 1)}</td></tr>`;
  }).join('');
  const otherRow = `<tr class="sum"><td>${esc(T('另：亚健康隔离（另一事件类，不与上面相加次数）', 'Also: isolation of sub-healthy units (another event class; counts not added above)'))}</td><td class="num">—</td><td class="num">—</td><td class="num">${fmt(c500.kpi.other[0].pauseS)} s</td><td>${esc(T('全局暂停（不回滚）', 'global pause (no rollback)'))}</td><td class="num">${esc(T(`占全部暂停 ${fmt((c500.kpi.other[0].sPerH / (c500.kpi.sumLP + c500.kpi.F)) * 100, 1)} %`, `${fmt((c500.kpi.other[0].sPerH / (c500.kpi.sumLP + c500.kpi.F)) * 100, 1)} % of all pause time`))}</td><td class="num">${fmt(c500.kpi.other[0].ratePerHour * 24, 2)}</td><td class="num">${fmt((c500.kpi.other[0].sPerH * 24) / 60, 1)}</td></tr>`;
  const table3 = `<div class="table-wrap"><table class="t3"><thead><tr><th>${esc(T('硬件单元（故障类所在）', 'Hardware unit (where the classes sit)'))}</th><th class="num">${esc(T('FIT / NPU CM384 / 800T A3', 'FIT per NPU CM384 / 800T A3'))}</th><th class="num">${esc(T('中断份额', 'Interruption share'))}</th><th class="num">${esc(T('每次暂停', 'Pause per event'))}</th><th>${esc(T('恢复去向（六个机制）', 'Where recovery ends (six mechanisms)'))}</th><th class="num">${esc(T('停机份额 CM384 / 800T A3', 'Downtime share CM384 / 800T A3'))}</th><th class="num">${esc(T('50 万卡 次 / 天', '500k: per day'))}</th><th class="num">${esc(T('50 万卡 停机 min / 天', '500k: min of pause per day'))}</th></tr></thead><tbody>${unitRows}${otherRow}</tbody></table></div>`;

  const globalOf = (s) => (s.breakdown.mttrParts.globalAuto ?? 0) + (s.breakdown.mttrParts.globalManual ?? 0);
  const scaleRows = SIZES.map((n) => {
    const a = S('cm384', n), b = S('a3server', n);
    const r = (s, i) => { const q = s.required[i]; return q.feasibleToday ? T(`满足（≤ ${fmt(q.fitPerNpuBudget)}）`, `met (≤ ${fmt(q.fitPerNpuBudget)})`) : `≤ ${fmt(q.fitPerNpuBudget)} (×${fmt(q.mtbfFactor, 1)})`; };
    const z = R.sensitivity.scaleOut.main.sizes[String(n)];
    return `<tr><td class="b nw">${esc(T(`${fmt(n / 10000)} 万`, kN(n)))}</td><td class="num">${fmt(a.derived.ubDomains)} / ${fmt(b.derived.ubDomains)}</td><td class="num">${fmt(a.kpi.lamHw * 24, 1)}</td><td class="num">${esc(hShort(a.kpi.mtbfHwH))}</td><td class="num${a.kpi.aOp < 0.985 ? ' bad' : a.kpi.aOp < 0.99 ? ' mid' : ''}">${pct(a.kpi.aOp)}</td><td class="num${b.kpi.aOp < 0.985 ? ' bad' : b.kpi.aOp < 0.99 ? ' mid' : ''}">${pct(b.kpi.aOp)}</td><td class="num w">${esc(r(a, 0))}</td><td class="num w">${esc(r(a, 1))}</td><td class="num">${fmt(a.regime.tauRatio, 3)} / ${fmt(a.regime.globalRatio, 3)}</td><td class="num">${z.tiers} · ${fmt((z.ports / z.capacity) * 100, 1)} %</td></tr>`;
  }).join('');
  const table4 = `<div class="table-wrap"><table class="t4"><thead><tr><th>${esc(T('规模', 'Size'))}</th><th class="num">${esc(T('UB 域 CM384 / 800T A3', 'UB domains CM384 / 800T A3'))}</th><th class="num">${esc(T('硬件中断 / 天', 'Interruptions per day'))}</th><th class="num">MTBF_hw</th><th class="num">A_op CM384</th><th class="num">A_op 800T A3</th><th class="num">${esc(T('98.5 % 的 FIT / NPU 上限（倍数）', '98.5 %: FIT per NPU ceiling (factor)'))}</th><th class="num">${esc(T('99 % 的上限（倍数）', '99 %: ceiling (factor)'))}</th><th class="num">(τ+δ)/M · G/M</th><th class="num">${esc(T('scale-out 层数 · 端口 / 上限', 'Scale-out tiers · ports / ceiling'))}</th></tr></thead><tbody>${scaleRows}</tbody></table></div>`;

  const scaleText = [
    T(`<b>1 万卡</b>：${fmt(c10.kpi.lamHw * 24, 2)} 次 / 天，MTBF_hw ${hrs(c10.kpi.mtbfHwH)}，A_op ${pct(c10.kpi.aOp)}；对 98.5 % 有约 ${fmt(c10.required[0].fitPerNpuBudget / c10.hardFitPerNpuTotal)} 倍余量。瓶颈不在可用度而在单次长停：作业级服务、柜供电 / 散热、交换类每次中断都走全局恢复（${fmt(c10.kpi.globalS + c10.kpi.detectS, 1)} s）。27 个 CM384 超节点里，一个通信柜断电会让约 28 片 L2 退出（每个子平面少约 1/4 带宽，若按子平面均分）。`, `<b>10k NPUs</b>: ${fmt(c10.kpi.lamHw * 24, 2)} interruptions per day, MTBF_hw ${hrs(c10.kpi.mtbfHwH)}, A_op ${pct(c10.kpi.aOp)}, about ${fmt(c10.required[0].fitPerNpuBudget / c10.hardFitPerNpuTotal)}× headroom for 98.5 %. The bottleneck is not availability but single long stops: every interruption of the job-level services, cabinet power / cooling and switches goes to the global recovery (${fmt(c10.kpi.globalS + c10.kpi.detectS, 1)} s). Among 27 CM384 pods, a power loss in one communication cabinet takes ≈ 28 L2 chips out (≈ 1/4 of every sub-plane if they are spread evenly).`),
    T(`<b>10 万卡</b>：约 ${fmt(c100.kpi.lamHw * 24, 1)} 次 / 天，MTBF_hw ${hrs(c100.kpi.mtbfHwH)}；两种形态都还满足 99 %（余量约 ${fmt(c100.required[1].fitPerNpuBudget / c100.hardFitPerNpuTotal, 2)} 倍）。CM384 超过约 ${kN(thrC.aOp99)}、800T A3 超过约 ${kN(thrS.aOp99)} NPU 后跌破 99 %。scale-out 在约 3.3 万卡时从三层变四层（radix 64、每 NPU 2 口）。`, `<b>100k NPUs</b>: ≈ ${fmt(c100.kpi.lamHw * 24, 1)} interruptions per day, MTBF_hw ${hrs(c100.kpi.mtbfHwH)}; both forms still meet 99 % (≈ ${fmt(c100.required[1].fitPerNpuBudget / c100.hardFitPerNpuTotal, 2)}× headroom). CM384 falls below 99 % beyond ≈ ${kN(thrC.aOp99)} NPUs, the 800T A3 beyond ≈ ${kN(thrS.aOp99)}. The scale-out goes from three to four tiers at ≈ 33k NPUs (radix 64, 2 ports per NPU).`),
    T(`<b>20 万卡</b>：约 ${fmt(c200.kpi.lamHw * 24, 1)} 次 / 天，MTBF_hw ${hrs(c200.kpi.mtbfHwH)}；A_op ${pct(c200.kpi.aOp)} / ${pct(s200.kpi.aOp)}，两者都已低于 98.5 %（FIT / NPU 需降到 ${fmt(c200.required[0].fitPerNpuBudget)}，×${fmt(c200.required[0].mtbfFactor, 2)}）。98.5 % 的规模上限约为 ${kN(thrC.aOp985)} / ${kN(thrS.aOp985)} NPU——恰好落在 CM384 公开的 16.5 万卡集群上限附近；20 万与 50 万卡本身已超出该上限，属外推。`, `<b>200k NPUs</b>: ≈ ${fmt(c200.kpi.lamHw * 24, 1)} interruptions per day, MTBF_hw ${hrs(c200.kpi.mtbfHwH)}; A_op ${pct(c200.kpi.aOp)} / ${pct(s200.kpi.aOp)}, both already below 98.5 % (FIT per NPU must fall to ${fmt(c200.required[0].fitPerNpuBudget)}, ×${fmt(c200.required[0].mtbfFactor, 2)}). The 98.5 % ceiling is ≈ ${kN(thrC.aOp985)} / ${kN(thrS.aOp985)} NPUs — right at the stated CM384 cluster ceiling of 165,000; 200k and 500k themselves are beyond it, an extrapolation.`),
    T(`<b>50 万卡</b>：约 ${fmt(c500.kpi.lamHw * 24, 1)} 次 / 天，MTBF_hw ${hrs(c500.kpi.mtbfHwH)}，A_op ${pct(c500.kpi.aOp, 2)} / ${pct(s500.kpi.aOp, 2)}。达到 98.5 % 需要 FIT / NPU ≤ ${fmt(c500.required[0].fitPerNpuBudget)}（今天的 1 / ${fmt(c500.required[0].mtbfFactor, 1)}），或在今天的 MTBF 下把 MTTR 从 ${fmt(c500.kpi.mttrS, 1)} s 压到 ${fmt(c500.required[0].mttrReqS, 1)} s；99 % 需 ×${fmt(c500.required[1].mtbfFactor, 1)}。${pct(c500.breakdown.ends.global, 0)} 的中断走全局恢复，却占 MTTR 的 ${fmt((globalOf(c500) / c500.kpi.mttrS) * 100)} %。scale-out 四层 ${fmt(c500.counts.scaleOutSwitches)} 台交换机、${kM(c500.counts.scaleOutTransceivers)} 只光模块；CM384 另有 ${kM(c500.counts.opticalLinks)} 条 UB 光链路（${kM(c500.counts.transceivers)} 个链路端）。分配见另一份报告《ARCH_ALLOCATION_98P5_500K》。`, `<b>500k NPUs</b>: ≈ ${fmt(c500.kpi.lamHw * 24, 1)} interruptions per day, MTBF_hw ${hrs(c500.kpi.mtbfHwH)}, A_op ${pct(c500.kpi.aOp, 2)} / ${pct(s500.kpi.aOp, 2)}. 98.5 % needs FIT per NPU ≤ ${fmt(c500.required[0].fitPerNpuBudget)} (1/${fmt(c500.required[0].mtbfFactor, 1)} of today) or, at today's MTBF, MTTR down from ${fmt(c500.kpi.mttrS, 1)} s to ${fmt(c500.required[0].mttrReqS, 1)} s; 99 % needs ×${fmt(c500.required[1].mtbfFactor, 1)}. ${pct(c500.breakdown.ends.global, 0)} of the interruptions end in the global recovery but they make ${fmt((globalOf(c500) / c500.kpi.mttrS) * 100)} % of the MTTR. The four-tier scale-out has ${fmt(c500.counts.scaleOutSwitches)} switches and ${kM(c500.counts.scaleOutTransceivers)} transceivers; the CM384 adds ${kM(c500.counts.opticalLinks)} UB optical links (${kM(c500.counts.transceivers)} link ends). The allocation is in the companion report ARCH_ALLOCATION_98P5_500K.`),
  ];

  const spof = [
    [T('作业级共享服务：共享检查点存储、调度 / 管理面、未归因软件', 'Job-level shared services: shared checkpoint storage, scheduling / management plane, unattributed software'), T('整个作业', 'the whole job'), T(`没有快速恢复梯级，每次走全局恢复（${fmt(c500.kpi.globalS + c500.kpi.detectS, 1)} s）；占中断 ${fmt((c500.breakdown.units.job.lam / c500.kpi.lamHw) * 100, 1)} %、停机 ${fmt((c500.breakdown.units.job.lp / c500.kpi.sumLP) * 100, 1)} %，每个规模都是第一瓶颈`, `no fast recovery rung: every event goes to the global recovery (${fmt(c500.kpi.globalS + c500.kpi.detectS, 1)} s); ${fmt((c500.breakdown.units.job.lam / c500.kpi.lamHw) * 100, 1)} % of interruptions, ${fmt((c500.breakdown.units.job.lp / c500.kpi.sumLP) * 100, 1)} % of downtime — the first bottleneck at every size`), T('两者相同；目录按 NPU·h 计，随 N 线性增长', 'same in both; per NPU-hour in the catalog, so it grows with N')],
    [T('计算柜供电 / 散热（CM384 液冷；800T A3 风冷 10U、每台 5+1 电源）', 'Compute-cabinet power / cooling (CM384 liquid-cooled; 800T A3 air-cooled 10U, 5+1 supplies per server)'), '32 NPU', T(`全局恢复；中断 ${fmt((c500.breakdown.units.cabinet.lam / c500.kpi.lamHw) * 100, 1)} %、停机 ${fmt((c500.breakdown.units.cabinet.lp / c500.kpi.sumLP) * 100, 1)} %`, `global recovery; ${fmt((c500.breakdown.units.cabinet.lam / c500.kpi.lamHw) * 100, 1)} % of interruptions, ${fmt((c500.breakdown.units.cabinet.lp / c500.kpi.sumLP) * 100, 1)} % of downtime`), T(`两者相同（同为 32 卡柜，假设）；800T A3 若每柜只放 2 台（风冷功率密度），柜类 FIT / NPU 翻倍，50 万卡 A_op 降到 ${pct(R.sensitivity.twoPerCabinet['500000'].aOp, 2)}`, `same in both (32-NPU cabinets, assumed); with 2 servers per cabinet (air-cooling density) the cabinet FIT per NPU doubles and A_op at 500k falls to ${pct(R.sensitivity.twoPerCabinet['500000'].aOp, 2)}`)],
    [T('节点管理与板级 IO（BMC、IO 板、DDR、SSD）', 'Node management and board IO (BMC, IO boards, DDR, SSD)'), '8 NPU', T(`节点事件的 ${fmt(c500.breakdown.units.node.ends.global * 100)} % 走全局，其余由弹性恢复吸收`, `${fmt(c500.breakdown.units.node.ends.global * 100)} % of node events go global, the rest are absorbed by elastic recovery`), T('两者相同（同一块主板）', 'same in both (the same board)')],
    [T('板载 L1 UB 芯片（每节点 7 片）', 'On-board L1 UB chips (7 per node)'), T('CM384：节点 1/7 的 UB 带宽（一个子平面）；800T A3：服务器内 1/7 带宽', 'CM384: 1/7 of the node’s UB bandwidth (one sub-plane); 800T A3: 1/7 of the server’s internal bandwidth'), T('残余平面中断（FABRIC）走全局', 'residual plane outages (FABRIC) go global'), T(`CM384 UB 交换（L1 + L2）中断 ${fmt((c500.breakdown.units['ub-switch'].lam / c500.kpi.lamHw) * 100, 1)} %、停机 ${fmt((c500.breakdown.units['ub-switch'].lp / c500.kpi.sumLP) * 100, 1)} %；800T A3 只有 L1：${fmt((s500.breakdown.units['ub-switch'].lp / s500.kpi.sumLP) * 100, 1)} %`, `CM384 UB switching (L1 + L2): ${fmt((c500.breakdown.units['ub-switch'].lam / c500.kpi.lamHw) * 100, 1)} % of interruptions, ${fmt((c500.breakdown.units['ub-switch'].lp / c500.kpi.sumLP) * 100, 1)} % of downtime; the 800T A3 has L1 only: ${fmt((s500.breakdown.units['ub-switch'].lp / s500.kpi.sumLP) * 100, 1)} %`)],
    [T('L2 交换层与通信柜（仅 CM384）', 'L2 tier and communication cabinets (CM384 only)'), T('一片 L2 = 子平面带宽 1/16；一个通信柜 ≈ 28 片', 'one L2 = 1/16 of a sub-plane; one communication cabinet ≈ 28 chips'), T('降级（路由收敛时）；残余中断走全局', 'degradation while routing converges; residual outages go global'), T('设计要点：每个子平面的 16 片 L2 分散到 4 个通信柜，一柜故障只损失每个子平面的 1/4；若某子平面的 L2 集中在一柜，该柜断电即断开该子平面', 'design point: spread each sub-plane’s 16 L2 chips over the 4 cabinets, so one cabinet costs 1/4 of each sub-plane; if a sub-plane’s L2 sit in one cabinet, its power loss disconnects that sub-plane')],
    [T('UB L1–L2 光链路与光模块（仅 CM384）', 'UB L1–L2 optical links and transceivers (CM384 only)'), T('1 条上联 = 该 L1 上行的 1/16', 'one uplink = 1/16 of its L1’s uplinks'), T('残余中断 90 % 由重执行吸收', '90 % of residual interruptions are replayed'), T(`每 NPU 14 条（28 个链路端），50 万卡 ${kM(c500.counts.opticalLinks)} 条：数量最大的光器件群，但每条只占 4.76 FIT（保护之后）；停机份额 ${fmt((c500.breakdown.units['ub-link'].lp / c500.kpi.sumLP) * 100, 1)} %`, `14 per NPU (28 link ends), ${kM(c500.counts.opticalLinks)} at 500k: the largest optical population, but only 4.76 FIT each after protection; ${fmt((c500.breakdown.units['ub-link'].lp / c500.kpi.sumLP) * 100, 1)} % of downtime`)],
    [T('scale-out 叶交换机', 'Scale-out leaf switch'), T(`${fmt(so.radix / 2)} 个端口（每 NPU 2 口分属不同叶时为降级）`, `${fmt(so.radix / 2)} ports (a degradation when an NPU’s two ports sit on different leaves)`), T('残余中断走全局', 'residual outages go global'), T('两者相同；800T A3 的 TP / EP 跨机流量全部压在 RoCE 上，同样的交换机故障对性能影响更大（不在本模型内）', 'same in both; the 800T A3 puts all TP / EP traffic across servers on RoCE, so the same switch fault costs more performance (not in this model)')],
    [T('scale-out 规模上限', 'Scale-out size ceiling'), '—', T(`radix ${so.radix}、每 NPU 2 口：三层 ≤ ${fmt(Math.pow(so.radix, 3) / 4)} 口（${fmt(Math.pow(so.radix, 3) / 8)} 卡），约 3.3 万卡起需第四层`, `radix ${so.radix}, 2 ports per NPU: three tiers ≤ ${fmt(Math.pow(so.radix, 3) / 4)} ports (${fmt(Math.pow(so.radix, 3) / 8)} NPUs), a fourth tier from ≈ 33k NPUs`), T(`公开的 CM384 集群上限为 16.5 万卡（约 ${fmt(X.podsAtMax)} 个超节点）；51.2T 交换机（radix 128 / 256）三层即可到 50 万卡（3.4）`, `the stated CM384 cluster ceiling is 165,000 NPUs (≈ ${fmt(X.podsAtMax)} pods); 51.2T switches (radix 128 / 256) reach 500k in three tiers (3.4)`)],
  ];
  const table5 = `<div class="table-wrap"><table class="t5"><thead><tr><th>${esc(T('部位', 'Element'))}</th><th>${esc(T('一次故障波及', 'One failure reaches'))}</th><th>${esc(T('对同步作业的效果（六个机制）', 'Effect on the synchronous job (six mechanisms)'))}</th><th>${esc(T('两种形态的差别 / 设计要点', 'Difference between the forms / design point'))}</th></tr></thead><tbody>${spof.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="b"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  /* ---------------- 3.4 sensitivities ---------------- */
  const soRows = Object.entries(R.sensitivity.scaleOut).map(([id, v]) => {
    const z = v.sizes['500000'];
    return `<tr${id === 'main' ? ' class="b"' : ''}><td>${esc(v.name[lang])}</td><td class="num">${z.tiers}</td><td class="num">${fmt(z.switches)}</td><td class="num">${kM(z.links)}</td><td class="num">${kM(z.transceivers)}</td><td class="num">${fmt(z.cm384.soFitPerNpu, 1)}</td><td class="num">${pct(z.cm384.aOp, 2)} / ${pct(z.a3server.aOp, 2)}</td><td class="src">${esc(v.basis[lang])}</td></tr>`;
  }).join('');
  const table6 = `<div class="table-wrap"><table class="t6"><thead><tr><th>${esc(T('scale-out 设计（50 万卡）', 'Scale-out design (500k NPUs)'))}</th><th class="num">${esc(T('层数', 'Tiers'))}</th><th class="num">${esc(T('交换机', 'Switches'))}</th><th class="num">${esc(T('链路', 'Links'))}</th><th class="num">${esc(T('光模块', 'Transceivers'))}</th><th class="num">${esc(T('scale-out FIT / NPU', 'Scale-out FIT per NPU'))}</th><th class="num">A_op CM384 / 800T A3</th><th>${esc(T('依据', 'Basis'))}</th></tr></thead><tbody>${soRows}</tbody></table></div>`;
  const tp = R.sensitivity.twoPerCabinet, ns = R.sensitivity.cm384NoScaleOut;
  const sensText = T(`<b>800T A3 每柜 2 台</b>（风冷 10U 服务器的功率密度更常见的放法）：计算柜 ${fmt(tp['500000'].racks)} 个，柜类 FIT / NPU 从 ${fmt(s500.hardFitPerNpu.cabinet, 1)} 升到 ${fmt(tp['500000'].cabinetFitPerNpu, 1)}（同一每柜 FIT 的假设），合计 ${fmt(tp['500000'].totalFitPerNpu)} FIT / NPU，MTTR ${fmt(tp['500000'].mttrS, 1)} s，50 万卡 A_op ${pct(tp['500000'].aOp, 2)}（每柜 4 台为 ${pct(s500.kpi.aOp, 2)}）——比两种形态的差别大约 9 倍。<b>CM384 去掉 scale-out</b>：${fmt(ns['500000'].totalFitPerNpu)} FIT / NPU，A_op ${pct(ns['500000'].aOp, 3)}，与两个仓库的每卡原值（表 1 参照行）一致：CloudMatrix384 正是 HAC-D 单元 FIT 的标定几何，910C 与仓库口径的差别只来自加上的 scale-out 网络（主算例 ${fmt(c500.hardFitPerNpu['roce-switch'] + c500.hardFitPerNpu['roce-link'], 1)} FIT / NPU）。`, `<b>800T A3 with 2 servers per cabinet</b> (the more common placement for air-cooled 10U servers): ${fmt(tp['500000'].racks)} cabinets, cabinet FIT per NPU up from ${fmt(s500.hardFitPerNpu.cabinet, 1)} to ${fmt(tp['500000'].cabinetFitPerNpu, 1)} (the same per-cabinet FIT assumed), ${fmt(tp['500000'].totalFitPerNpu)} FIT per NPU in total, MTTR ${fmt(tp['500000'].mttrS, 1)} s, A_op ${pct(tp['500000'].aOp, 2)} at 500k (4 per cabinet: ${pct(s500.kpi.aOp, 2)}) — about 9× the difference between the two forms. <b>CM384 without scale-out</b>: ${fmt(ns['500000'].totalFitPerNpu)} FIT per NPU, A_op ${pct(ns['500000'].aOp, 3)}, the repositories’ per-card values (reference row of Table 1): CloudMatrix384 is the geometry HAC-D’s unit FIT were calibrated on, so the 910C differs from the repositories only by the scale-out network added (${fmt(c500.hardFitPerNpu['roce-switch'] + c500.hardFitPerNpu['roce-link'], 1)} FIT per NPU in the main case).`);

  /* ---------------- 4. cross-checks ---------------- */
  const P = X.pod, Pub = X.published;
  const ok = (a, b) => (a === b ? T('一致', 'agree') : T('不同', 'differ'));
  const xrows = [
    [T('节点 / NPU / CPU', 'Nodes / NPUs / CPUs'), `${P.nodes} / ${P.npus} / ${P.cpus}`, `${Pub.nodes} / ${Pub.npus} / ${Pub.cpus}`, T('论文 §3.3', 'paper §3.3'), ok(P.nodes + P.npus + P.cpus, Pub.nodes + Pub.npus + Pub.cpus)],
    [T('L1 / L2 UB 芯片', 'L1 / L2 UB chips'), `${fmt(P.l1)} / ${fmt(P.l2)}`, `${fmt(Pub.l1)} / ${fmt(Pub.l2)}`, T('论文 §3.3.3', 'paper §3.3.3'), ok(P.l1 + P.l2, Pub.l1 + Pub.l2)],
    [T('L1–L2 链路', 'L1–L2 links'), fmt(P.links), fmt(Pub.links), T('论文（48 × 7 × 16）', 'paper (48 × 7 × 16)'), ok(P.links, Pub.links)],
    [T('计算柜 + 通信柜', 'Compute + communication cabinets'), `${P.racks} + ${P.commRacks}`, `${Pub.racks} + ${Pub.commRacks}`, T('论文；The Register', 'paper; The Register'), ok(P.racks + P.commRacks, Pub.racks + Pub.commRacks)],
    [T('RDMA 口', 'RDMA ports'), fmt(P.rdmaPorts), fmt(Pub.rdmaPorts), T('论文（每 die 1 个）', 'paper (one per die)'), ok(P.rdmaPorts, Pub.rdmaPorts)],
    [T('光模块', 'Transceivers'), fmt(P.transceivers), fmt(Pub.transceiversSemiAnalysis), 'SemiAnalysis', T('口径不同：本页每条 L1–L2 链路两端各 1 只；SemiAnalysis 6,912 只 400G LPO 含 scale-out，按 lane 打包', 'different basis: here one module per L1–L2 link end; SemiAnalysis’s 6,912 × 400G LPO include scale-out and bundle lanes')],
    [T('集群上限', 'Cluster ceiling'), '—', T(`${fmt(Pub.maxClusterNpus)} NPU（约 ${fmt(X.podsAtMax)} 个超节点）`, `${fmt(Pub.maxClusterNpus)} NPUs (≈ ${fmt(X.podsAtMax)} pods)`), T('The Register；论文图 1', 'The Register; paper Figure 1'), T('20 万与 50 万卡超出该上限，本页为外推', '200k and 500k exceed it; this page extrapolates')],
  ];
  const other = X.other;
  const otherRows = other ? SIZES.map((n) => { const a = other.rows[String(n)], b = other.ours[String(n)]; return `<tr><td class="b nw">${esc(T(`${fmt(n / 10000)} 万`, kN(n)))}</td><td class="num">${pct(a.aOp, 4)}</td><td class="num">${pct(b.aOp, 4)}</td><td class="num">${fmt(a.mtbfHwH, 4)} h</td><td class="num">${fmt(b.mtbfHwH, 4)} h</td><td class="num">${fmt(a.mttrS, 2)} s</td><td class="num">${fmt(b.mttrS, 2)} s</td><td class="num">${pct(a.delivered, 2)}</td><td class="num">${pct(b.delivered, 2)}</td></tr>`; }).join('') : '';
  const table7 = `<div class="table-wrap"><table class="t7"><thead><tr><th>${esc(T('每个 CloudMatrix384 超节点', 'Per CloudMatrix384 SuperPoD'))}</th><th class="num">${esc(T('HAC-D 模型', 'HAC-D model'))}</th><th class="num">${esc(T('公开值', 'Published'))}</th><th>${esc(T('来源', 'Source'))}</th><th>${esc(T('核对', 'Check'))}</th></tr></thead><tbody>${xrows.map((r) => `<tr><td>${esc(r[0])}</td><td class="num w">${esc(r[1])}</td><td class="num w">${esc(r[2])}</td><td class="src">${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('')}</tbody></table></div>`;
  const table7b = other ? `<div class="table-wrap"><table class="t7b"><thead><tr><th>${esc(T('规模', 'Size'))}</th><th class="num">${esc(T('A_op 另一份报告', 'A_op other report'))}</th><th class="num">${esc(T('A_op 本页', 'A_op this page'))}</th><th class="num">${esc(T('MTBF 另一份', 'MTBF other'))}</th><th class="num">${esc(T('MTBF 本页', 'MTBF here'))}</th><th class="num">${esc(T('MTTR 另一份', 'MTTR other'))}</th><th class="num">${esc(T('MTTR 本页', 'MTTR here'))}</th><th class="num">${esc(T('产出 另一份', 'Goodput other'))}</th><th class="num">${esc(T('产出 本页', 'Goodput here'))}</th></tr></thead><tbody>${otherRows}</tbody></table></div>` : '';

  /* ---------------- 5. mechanisms ---------------- */
  const mechRows = R.mechanisms.map((m) => `<tr><td class="b">${esc(m.id)}</td><td>${esc(m.name[lang])}</td><td>${esc(m.change[lang])}</td><td class="src">${esc(Object.entries(m.parameters).map(([k, v]) => `${k} ${v}`).join(', '))}</td></tr>`).join('');
  const rec = R.baseline.recovery;
  const table8 = `<div class="table-wrap"><table class="t8"><thead><tr><th>${esc(T('机制', 'Mechanism'))}</th><th>${esc(T('名称', 'Name'))}</th><th>${esc(T('作用', 'What it does'))}</th><th>${esc(T('参数', 'Parameters'))}</th></tr></thead><tbody>${mechRows}<tr class="sum"><td class="b">${esc(T('基线', 'Baseline'))}</td><td>${esc(T('检测与全局恢复', 'Detection and global recovery'))}</td><td>${esc(T(`检测 ${fmt(rec.detection.coverage * 100)} % 在 ${rec.detection.autoSeconds} s，其余 ${rec.detection.timeoutSeconds} s；自动恢复 ${rec.automatic.seconds} s、成功 ${fmt(rec.automatic.successProbability * 100)} %，失败再加人工 ${fmt(rec.manual.seconds / 3600)} h；全局恢复均值 ${fmt(c500.kpi.globalS + c500.kpi.detectS, 1)} s`, `detection ${fmt(rec.detection.coverage * 100)} % in ${rec.detection.autoSeconds} s, the rest ${rec.detection.timeoutSeconds} s; automatic recovery ${rec.automatic.seconds} s at ${fmt(rec.automatic.successProbability * 100)} %, else manual + ${fmt(rec.manual.seconds / 3600)} h; mean global recovery ${fmt(c500.kpi.globalS + c500.kpi.detectS, 1)} s`))}</td><td class="src">${esc(T('参考目录作业设置', 'reference catalog job settings'))}</td></tr></tbody></table></div>`;

  const css = BASE_CSS + `
  table.t7b td:first-child { min-width: 4em; }
  @media screen and (max-width: 760px) { .table-wrap table.t7b { min-width: 680px; } }
`;
  const fC = figCm384(lang, R, 'fig-cm384', 1);
  const fS = figA3Server(lang, R, 'fig-a3server', 2);
  const keyFindings = [
    T(`<b>硬件规模</b>：两种形态的计算部分相同（同一块 8 卡主板、每柜 32 卡，50 万卡 ${fmt(c500.counts.racks)} 个计算柜、${fmt(c500.counts.cpus)} 颗 CPU）；差别全在 UB 域：CM384 每 384 卡有 4 个通信柜、112 片 L2、5,376 条 L1–L2 光链路，50 万卡共 ${fmt(c500.counts.commRacks)} 个通信柜、${kM(c500.counts.l2Switches)} 片 L2、${kM(c500.counts.opticalLinks)} 条 UB 光链路；800T A3 一台服务器就是一个 8 卡 UB 域，这三项为零。scale-out 两者相同：50 万卡四层 ${fmt(c500.counts.scaleOutSwitches)} 台交换机。`, `<b>Hardware</b>: compute is the same in both forms (one 8-NPU board, 32 NPUs per cabinet; ${fmt(c500.counts.racks)} compute cabinets and ${fmt(c500.counts.cpus)} CPUs at 500k); the difference is the UB domain: per 384 NPUs the CM384 has 4 communication cabinets, 112 L2 chips and 5,376 L1–L2 optical links — ${fmt(c500.counts.commRacks)} cabinets, ${kM(c500.counts.l2Switches)} L2 chips and ${kM(c500.counts.opticalLinks)} UB optical links at 500k; one 800T A3 server is an 8-NPU UB domain and has none of these. The scale-out is the same for both: four tiers, ${fmt(c500.counts.scaleOutSwitches)} switches at 500k.`),
    T(`<b>可靠性随规模</b>：CM384 的 A_op ${pct(c10.kpi.aOp, 2)}（1 万）→ ${pct(c100.kpi.aOp, 2)}（10 万）→ ${pct(c200.kpi.aOp, 2)}（20 万）→ ${pct(c500.kpi.aOp, 2)}（50 万）；MTBF_hw 从 ${hrs(c10.kpi.mtbfHwH)} 降到 ${hrs(c500.kpi.mtbfHwH)}，MTTR_hw 约 ${fmt(c500.kpi.mttrS)} s 不随规模变。800T A3 少了 UB 光链路与 L2（${fmt(c500.hardFitPerNpuTotal - s500.hardFitPerNpuTotal, 1)} FIT / NPU，约 ${fmt(((c500.hardFitPerNpuTotal - s500.hardFitPerNpuTotal) / c500.hardFitPerNpuTotal) * 100, 1)} %），A_op 高 0.002–0.10 个百分点——但 UB 域只有 8 卡，代价在性能侧（不在本模型内）。数字与另一份《950 与 910C》报告的 910C 列逐项相同（4 节）。`, `<b>Reliability with scale</b>: CM384 A_op ${pct(c10.kpi.aOp, 2)} (10k) → ${pct(c100.kpi.aOp, 2)} (100k) → ${pct(c200.kpi.aOp, 2)} (200k) → ${pct(c500.kpi.aOp, 2)} (500k); MTBF_hw from ${hrs(c10.kpi.mtbfHwH)} down to ${hrs(c500.kpi.mtbfHwH)}, MTTR_hw ≈ ${fmt(c500.kpi.mttrS)} s at every size. The 800T A3 lacks the UB optics and the L2 tier (${fmt(c500.hardFitPerNpuTotal - s500.hardFitPerNpuTotal, 1)} FIT per NPU, ≈ ${fmt(((c500.hardFitPerNpuTotal - s500.hardFitPerNpuTotal) / c500.hardFitPerNpuTotal) * 100, 1)} %) and is 0.002–0.10 points higher — but its UB domain is only 8 NPUs, a cost on the performance side (not in this model). The numbers equal the 910C column of the other “950 and 910C” report item by item (Section 4).`),
    T(`<b>阈值</b>：跌破 99 % 约在 ${kN(thrC.aOp99)}（CM384）/ ${kN(thrS.aOp99)}（800T A3）卡，跌破 98.5 % 约在 ${kN(thrC.aOp985)} / ${kN(thrS.aOp985)} 卡（与 CM384 公开的 16.5 万卡集群上限几乎重合），MTBF_hw 低于 1 h 约在 ${kN(thrC.mtbf1h)} 卡。50 万卡达到 98.5 % 需要每 NPU FIT 降到 ${fmt(c500.required[0].fitPerNpuBudget)}（今天 ${fmt(c500.hardFitPerNpuTotal)}）或 MTTR 降到 ${fmt(c500.required[0].mttrReqS)} s。`, `<b>Thresholds</b>: below 99 % from ≈ ${kN(thrC.aOp99)} (CM384) / ${kN(thrS.aOp99)} (800T A3) NPUs, below 98.5 % from ≈ ${kN(thrC.aOp985)} / ${kN(thrS.aOp985)} (almost exactly the stated CM384 cluster ceiling of 165,000), MTBF_hw under 1 h from ≈ ${kN(thrC.mtbf1h)}. At 500k, 98.5 % needs FIT per NPU down to ${fmt(c500.required[0].fitPerNpuBudget)} (today ${fmt(c500.hardFitPerNpuTotal)}) or MTTR down to ${fmt(c500.required[0].mttrReqS)} s.`),
    T(`<b>瓶颈</b>：没有快速恢复梯级的类别——作业级共享服务（存储、未归因 / 软件）、管理与板级 IO、计算柜供电 / 散热、UB 与 RoCE 交换——只占硬件中断的 ${pct(nr500.ev, 0)}，却占停机时间的 ${pct(nr500.dt, 0)}（每次 ${fmt(c500.kpi.globalS + c500.kpi.detectS, 1)} s 全局恢复）。NPU 自身占中断 ${fmt((c500.breakdown.units.npu.lam / c500.kpi.lamHw) * 100)} %，只占停机 ${fmt((c500.breakdown.units.npu.lp / c500.kpi.sumLP) * 100)} %。比两种形态的差别更大的是每柜放几台：800T A3 每柜 2 台时 50 万卡 A_op 再降 ${fmt((s500.kpi.aOp - R.sensitivity.twoPerCabinet['500000'].aOp) * 100, 2)} 个百分点。`, `<b>Bottleneck</b>: the classes without a fast recovery rung — job-level shared services (storage, unattributed / software), management and board IO, cabinet power / cooling, UB and RoCE switches — are ${pct(nr500.ev, 0)} of the hardware interruptions but ${pct(nr500.dt, 0)} of the downtime (${fmt(c500.kpi.globalS + c500.kpi.detectS, 1)} s of global recovery each). The NPU itself is ${fmt((c500.breakdown.units.npu.lam / c500.kpi.lamHw) * 100)} % of the interruptions but only ${fmt((c500.breakdown.units.npu.lp / c500.kpi.sumLP) * 100)} % of the downtime. Larger than the difference between the forms is how many servers share a cabinet: with 2 per cabinet the 800T A3 loses another ${fmt((s500.kpi.aOp - R.sensitivity.twoPerCabinet['500000'].aOp) * 100, 2)} points at 500k.`),
    T(`<b>口径与边界</b>：故障率与机制参数逐项取自 ReMAP 与 ai-cluster-reliability 的同一份目录（54 类事件，每卡 FIT，GPU 机群的类比先验；8 项核对通过，见 HACD_REMAP_COMPARISON）；HAC-D 按 CloudMatrix384 几何换算到每个硬件单元——因此 CM384 去掉 scale-out 就回到仓库原值（表 1 参照行），差别只来自 scale-out 网络。都不是 910C 实测。800T A3 的每柜台数与 RoCE 端口为假设；scale-out 交换机端口数与收敛比未公开。`, `<b>口径 and limits</b>: failure rates and mechanism parameters are the values of the one catalog shared by ReMAP and ai-cluster-reliability (54 events, FIT per card, an analogue prior from GPU fleets; all 8 checks pass, see HACD_REMAP_COMPARISON); HAC-D converts them per hardware unit under the CloudMatrix384 geometry — so the CM384 without scale-out returns the repositories’ values (reference row of Table 1) and the only difference is the scale-out network. None are 910C measurements. Servers per cabinet and the RoCE ports of the 800T A3 are assumed; the scale-out radix and oversubscription are not public.`),
  ];

  const sections = [
    `<div class="eyebrow">EYEBROW1</div>
  <h1>${esc(T('昇腾 910C 两种部署形态：1 万–50 万卡的硬件规模、可靠性与瓶颈', 'Ascend 910C in two deployment forms at 10k–500k NPUs: hardware scale, reliability and bottlenecks'))}</h1>
  <p class="sub">${T(`对象：<b>Atlas 900 A3 超节点 / CloudMatrix384</b>（384 卡一个 UB 域：48 节点、12 计算柜 + 4 通信柜、两级 UB 交换）与 <b>Atlas 800T A3 服务器集群</b>（同一块 8 卡主板单独使用：一台 10U 服务器就是一个 8 卡 UB 域，服务器之间走 RoCE）。硬件数量由 HAC-D v4.3 引擎的 a3-ub384 模板算出（800T A3 = 同一模板去掉 L2 层、UB 光链路与通信柜，见第 2 节）；可靠性为一个同步训练作业在 <b>六个默认机制</b>（D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST，第 5 节）下的结果。scale-out 两种形态相同：${R.scaleOut.main.name.zh}；其他设计见 3.4。姊妹篇：<code>docs/ASCEND950_SCALING_RELIABILITY.zh.html</code>；50 万卡 98.5 % 的分配见 <code>docs/ARCH_ALLOCATION_98P5_500K.zh.html</code>；第 6 节为 ReMAP 最新机制集 23 项的 Shapley 贡献。`, `Subjects: the <b>Atlas 900 A3 SuperPoD / CloudMatrix384</b> (one UB domain of 384 NPUs: 48 nodes, 12 compute + 4 communication cabinets, two-level UB switching) and an <b>Atlas 800T A3 server cluster</b> (the same 8-NPU board used stand-alone: one 10U server is an 8-NPU UB domain, RoCE between servers). Hardware counts come from the HAC-D v4.3 engine’s a3-ub384 template (800T A3 = the same template without the L2 tier, the UB optics and the communication cabinets, Section 2); reliability is that of one synchronous training job with the <b>six default mechanisms</b> (D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST, Section 5). Both use the same scale-out: ${R.scaleOut.main.name.en}; other designs in 3.4. Companion: <code>docs/ASCEND950_SCALING_RELIABILITY.en.html</code>; the 98.5 % allocation at 500k: <code>docs/ARCH_ALLOCATION_98P5_500K.en.html</code>; Section 6 gives the Shapley contributions of the latest ReMAP mechanism set (23).`)}</p>
  <div class="callout"><ul>${keyFindings.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h2 class="first">${esc(T('1. 硬件规模与可靠性（表 1）', '1. Hardware scaling and reliability (Table 1)'))}</h2>
  ${table1}
  <div class="formula">A_op = (1 − φ_SDC) / (1 + (λ_hw · MTTR_hw + Σ_k λ_k · t_k) / 3600)　·　λ_hw = Σ_u n_u · FIT_u · 10⁻⁹ /h　·　MTBF_hw = 1/λ_hw　·　MTTR_hw = Σ_i λ_i · t̄_i / λ_hw [s]</div>
  <p class="note">${T('口径：事件 = 同步训练作业的硬中断（每次都会停住整个作业）；分母 = 集群·小时；层级 = 作业。n_u 为单元数（表中各行），FIT_u 为每单元每 10⁹ 小时的业务影响中断（保护之后）。t̄_i 为第 i 类中断在机制链上的平均暂停（检测 + 重执行 / 弹性 / 进程 / 全局恢复）；λ_k、t_k 为另两个事件类：亚健康单元隔离（每次 252 s）与静默数据损坏检出（每次 3 s），φ_SDC 为静默损坏片段占用的时间份额（< 0.01 %）。A_op 是运行时间份额，回滚重算与检查点开销计入有效产出，不在此列。MTBF_hw 是集群级“硬件中断间隔”，不是单个器件的 MTBF。粗体红底 = 低于 98.5 %，黄底 = 低于 99 %。“98.5 % 需要”一行：B = 3600·((1 − φ)/A* − 1) − F 为每小时允许的暂停秒数，MTBF_hw ≥ MTTR_hw / B，FIT / NPU ≤ 10⁹ / (MTBF_hw · N)。1 万卡时最后一个 CM384 超节点只装了部分节点，通信柜与 L2 按端口比例取整。', '口径: event = a hard interruption of the synchronous training job (each one stops the whole job); denominator = cluster-hour; level = job. n_u = unit counts (rows of the table), FIT_u = business-impact interruptions per 10⁹ unit-hours (after the existing protection). t̄_i = mean pause of class i down the mechanism chain (detection + replay / elastic / process / global recovery); λ_k, t_k = the two other event classes: isolation of sub-healthy units (252 s each) and detected silent data corruption (3 s each); φ_SDC = time share of silent-corruption episodes (< 0.01 %). A_op is the running-time share; rollback recompute and checkpoint overhead count against goodput, not here. MTBF_hw is the cluster-level time between hardware interruptions, not a device MTBF. Bold on red = below 98.5 %, on yellow = below 99 %. “Needed for 98.5 %”: B = 3600·((1 − φ)/A* − 1) − F seconds of pause allowed per hour, MTBF_hw ≥ MTTR_hw / B, FIT per NPU ≤ 10⁹ / (MTBF_hw · N). At 10k the last CM384 pod is partly populated; its communication cabinets and L2 chips are rounded up in proportion to the ports.')}</p>`,
    `<div class="eyebrow">EYEBROW2</div>
  <h2 class="first">${esc(T('2. 架构映射：UB 域 ↔ 计算柜 ↔ 节点 ↔ NPU ↔ 部件', '2. Architecture mapping: UB domain ↔ cabinet ↔ node ↔ NPU ↔ components'))}</h2>
  <figure class="chart"><div class="scroll">${fC}</div></figure>
  <h3>${esc(T('表 2a：Atlas 900 A3 超节点 / CloudMatrix384（384 NPU）', 'Table 2a: Atlas 900 A3 SuperPoD / CloudMatrix384 (384 NPUs)'))}</h3>
  ${mapTable('cm384')}`,
    `<div class="eyebrow">EYEBROW3</div>
  <figure class="chart"><div class="scroll">${fS}</div></figure>
  <h3>${esc(T('表 2b：Atlas 800T A3 服务器集群（UB 域 = 一台服务器，8 NPU）', 'Table 2b: Atlas 800T A3 server cluster (UB domain = one server, 8 NPUs)'))}</h3>
  ${mapTable('a3server')}
  <p class="note">${T('单元 FIT 来自参考目录在 CloudMatrix384 几何下的换算（每片 L1 / L2 UB 芯片 57.1 FIT、每条 L1–L2 光链路 4.76 FIT、每个 32 卡计算柜 8,533 FIT；RoCE 交换机与链路按 UB 芯片与链路类比，为假设）。“恢复去向”按 50 万卡、六个机制下各类中断走到哪一级计（份额与规模无关）。分数“1/n”表示 n 个该层级共用一个部件；scale-out 份额按 50 万卡的四层 Clos 计。800T A3 的 UB 域 = 服务器 = 节点，所以前后两列相同。', 'FIT per unit is the reference catalog converted under the CloudMatrix384 geometry (57.1 FIT per L1 / L2 UB chip, 4.76 FIT per L1–L2 optical link, 8,533 FIT per 32-NPU compute cabinet; RoCE switches and links as analogues of the UB chip and link, an assumption). “Where recovery ends” is the share of each class’s interruptions ending at each rung with the six mechanisms at 500k (independent of size). A fraction “1/n” means n of that level share one component; scale-out shares are those of the four-tier Clos at 500k. For the 800T A3 the UB domain = server = node, so those two columns are equal.')}</p>`,
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
  <p class="note">${T('同步训练作业是串联系统：任何一个硬中断都会停住整个作业，所以每个部件都是作业的“单点”。区分关键与否的是两件事：一次故障波及多少卡（是否需要整柜 / 整超节点重排），以及这一类中断有没有快速恢复梯级（否则每次付全局恢复的 264.5 s）。', 'A synchronous training job is a series system: any hard interruption stops the whole job, so every component is a single point for the job. What separates the critical ones is how many NPUs one failure reaches (whether a whole cabinet / pod must be re-planned) and whether its class has a fast recovery rung (otherwise each event pays the 264.5 s global recovery).')}</p>
  ${table5}
  <h3>${esc(T('3.4 敏感性', '3.4 Sensitivities'))}</h3>
  ${table6}
  <p class="note">${sensText}</p>
  <h2>${esc(T('4. 交叉核对（表 7、表 7b）', '4. Cross-checks (Tables 7 and 7b)'))}</h2>
  ${table7}
  <p class="note">${esc(other ? T(`表 7b：另一份《950 与 910C》报告（${other.file}，HAC-D 模板默认）的 910C 列与本页 CM384 主算例逐项对照；最大相对差 ${other.maxRel.toExponential(1)}，即该报告 6 位有效数字的舍入。`, `Table 7b: the 910C column of the other “950 and 910C” report (${other.file}, HAC-D template defaults) against this page’s CM384 main case, item by item; largest relative difference ${other.maxRel.toExponential(1)}, the rounding of that report’s six significant digits.`) : '')}</p>
  ${table7b}
  <h2>${esc(T('5. 六个默认机制与基线恢复（表 8）', '5. The six default mechanisms and the baseline recovery (Table 8)'))}</h2>
  ${table8}
  <p class="note">${T('其他假设：故障率为 54 类事件参考目录（中断 3,333.3 / 亚健康 69.0 / 静默 48.3 FIT 每卡，GPU 机群实测的类比）按单元换算，置信度 assumed；亚健康单元在 95 % 概率、平均 5 min 检出且片段（平均 24 h）仍在时隔离；未建模：存储与管理系统的器件数、配电与冷站、多作业分区、备机池、scale-out 交换机自身的冗余电源、800T A3 小 UB 域带来的通信时间变化。', 'Other assumptions: failure rates are the 54-event reference catalog (interruption 3,333.3 / sub-health 69.0 / silent 48.3 FIT per card, an analogue of GPU-fleet measurements) converted per unit, confidence assumed; sub-healthy units are isolated when detected (95 %, mean 5 min) while the episode (mean 24 h) lasts; not modelled: device counts of storage and management systems, power distribution and cooling plant, multi-job partitions, spare pools, redundant supplies inside the scale-out switches, the communication-time change that the 800T A3’s small UB domain brings.')}</p>
  <footer>${T(`来源：CloudMatrix384 论文（arXiv 2506.12708 v3 §3.2–3.3）；Atlas 800T A3 产品页（华为企业业务，2026-10-20 检索：10U、单机 8 × 昇腾 910、4 × 鲲鹏 920、784 GB/s 1:1、多机最大 384 卡超节点）；The Register 2025-07-29（每 NPU 400 Gbps scale-out、16 柜、16.5 万卡）；SemiAnalysis 2025-04-16 公开部分（6,912 只 400G LPO）；第三方 800I A3 规格页（8 × 400GE、6 × 3 kW，未证实）；docs/ASCEND_SOURCES.md；docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html。复现：<code>node --import tsx scripts/ascend910c-scaling.ts</code> → <code>node scripts/build-ascend910c-scaling.mjs</code>；架构定义 <code>scripts/ascend910c-archs.ts</code>，图 <code>scripts/ascend910c-figures.mjs</code>，共用读数 <code>scripts/scaling-common.ts</code>；数字已由独立 Python 复算（计数逐项相同；FIT、MTTR、A_op、预算的相对误差 ≤ 1e-7）。`, `Sources: the CloudMatrix384 paper (arXiv 2506.12708 v3 §3.2–3.3); the Atlas 800T A3 product page (Huawei Enterprise, searched 2026-10-20: 10U, 8 × Ascend 910, 4 × Kunpeng 920, 784 GB/s at 1:1, up to 384-card supernodes); The Register 2025-07-29 (400 Gbps scale-out per NPU, 16 racks, 165,000 NPUs); SemiAnalysis 2025-04-16 public part (6,912 × 400G LPO); a third-party 800I A3 listing (8 × 400GE, 6 × 3 kW; unverified); docs/ASCEND_SOURCES.md; docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html. Reproduce: <code>node --import tsx scripts/ascend910c-scaling.ts</code> → <code>node scripts/build-ascend910c-scaling.mjs</code>; architectures in <code>scripts/ascend910c-archs.ts</code>, figures in <code>scripts/ascend910c-figures.mjs</code>, shared read-outs in <code>scripts/scaling-common.ts</code>; the numbers were re-derived independently in Python (counts identical; FIT, MTTR, A_op and budgets within a relative 1e-7).`)}</footer>`,
  ];
  const shap = shapleySection(lang, [{ id: 'cm384', short: 'CM384', name: T('Atlas 900 A3 超节点 / CloudMatrix384', 'Atlas 900 A3 SuperPoD / CloudMatrix384'), D: loadShapley('cm384') }, { id: 'a3server', short: '800T A3', name: T('Atlas 800T A3 服务器集群', 'Atlas 800T A3 server cluster'), D: loadShapley('a3server') }], { h2: T('6. 机制贡献：ReMAP 最新机制集 23 项的 Shapley 归因（图 5、图 6）', '6. Mechanism contributions: Shapley attribution of the latest ReMAP mechanism set (Figures 5 and 6)'), firstFig: 5 });
  if (shap) sections.push(`<div class="eyebrow">EYEBROW${sections.length + 1}</div>\n  ${shap}`);
  const nPages = sections.length;
  const eyebrow = (i) => esc(T(`HAC-D · 昇腾 910C 规模与可靠性 · ${DATE} · 第 ${i} / ${nPages} 页`, `HAC-D · Ascend 910C scale and reliability · ${DATE} · page ${i} / ${nPages}`));
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
<title>${esc(T('昇腾 910C 规模与可靠性', 'Ascend 910C scale and reliability'))}</title>
<meta name="description" content="${esc(T('Atlas 900 A3 超节点 / CloudMatrix384 与 Atlas 800T A3 服务器集群在 1 万、10 万、20 万、50 万卡下的机柜与器件数、六个默认机制下的可用度、MTBF 与 MTTR，两张架构映射表，以及各规模的瓶颈与单点故障分析（HAC-D）。', 'Atlas 900 A3 SuperPoD / CloudMatrix384 and an Atlas 800T A3 server cluster at 10k, 100k, 200k and 500k NPUs: racks and devices, availability, MTBF and MTTR with the six default mechanisms, two architecture mapping tables, and the bottlenecks and single points of failure at each size (HAC-D).'))}">
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
  const out = `docs/ASCEND910C_SCALING_RELIABILITY.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
page('zh');
page('en');
