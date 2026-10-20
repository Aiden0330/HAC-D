/**
 * docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html — the reviewed and extended survey of next-generation Ascend cluster architecture
 * (Atlas 950 SuperPoD and SuperCluster, Atlas 960E and the roadmap, customer deployments, published reliability numbers, a
 * claim-by-claim review of the Codex draft of 2026-10-19) and the HAC-D topology templates built from it.
 *  - section fragments: docs/ascend-nextgen/sections/*.html (written from the verified research record; every factual
 *    statement carries an evidence badge and `<cite data-url>` placeholders, numbered here by first appearance);
 *  - reference metadata: docs/ascend-nextgen/sources.json (URL → title, publisher, date);
 *  - section 7 (HAC-D mapping) is computed on the engine: counts per SuperPoD variant against the public figures, interruption
 *    FIT per NPU and A_op at the built-in scales with the six default mechanisms.
 * Usage: node --import tsx scripts/build-ascend-nextgen-survey.ts [--out docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { topologyScenario, topologyBom, applySuperpodVariant, TOPOLOGY_TEMPLATES, SUPERPOD_VARIANTS, type TopologyTemplate } from '../packages/core/src/topology/index.js';
import { evaluateScenario } from '../packages/core/src/scenario/evaluate.js';
import { computeCounts } from '../packages/core/src/scenario/build.js';
import type { Scenario } from '../packages/core/src/scenario/schema.js';

const argv = process.argv.slice(2);
const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('out') ?? 'docs/ASCEND_NEXTGEN_CLUSTER_SURVEY.zh.html';
const DIR = 'docs/ascend-nextgen';
const DATE = '2026-10-19';
const SOURCES: Record<string, { title?: string; publisher?: string; date?: string }> = JSON.parse(readFileSync(`${DIR}/sources.json`, 'utf8'));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const num = (n: number, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x: number, d = 3) => `${(x * 100).toFixed(d)} %`;
const frag = (name: string) => { const p = `${DIR}/sections/${name}.html`; if (!existsSync(p)) throw new Error(`missing section ${p}`); return readFileSync(p, 'utf8'); };

/* ---------------- section 7: the HAC-D templates, computed on the engine ---------------- */
type Row = { name: string; ev: string; make: (n: number) => Scenario; pod: number };
const a950 = (v: string) => (n: number) => applySuperpodVariant(topologyScenario('a950-ub2', n), v);
const ROWS: Row[] = [
  { name: 'A3 · CloudMatrix384（参照）', ev: '<span class="ev" data-ev="paper">华为论文</span>', make: (n) => topologyScenario('a3-ub384', n), pod: 384 },
  { name: 'Atlas 950 · 1,024 NPU，柜内全互联 + 光交换 Clos（默认，现行规格形态）', ev: '<span class="ev" data-ev="huawei">华为确认</span>', make: a950('a950-1k'), pod: 1024 },
  { name: 'Atlas 950 · 8,192 NPU，128 + 32 柜（路线图）', ev: '<span class="ev" data-ev="huawei">华为确认</span>', make: a950('a950-8k'), pod: 8192 },
  { name: 'Atlas 950 · UB-Mesh 4D（论文）', ev: '<span class="ev" data-ev="paper">华为论文</span>', make: a950('a950-4d'), pod: 8192 },
  { name: 'Atlas 950 · CloudMatrix384 两级拷贝（v4.1，对照）', ev: '<span class="ev" data-ev="unverified">假设</span>', make: a950('a950-2l'), pod: 1024 },
  { name: 'Atlas 960E · 56 + 14 柜，NPO（默认）', ev: '<span class="ev" data-ev="media">媒体</span>', make: (n) => topologyScenario('a960e-ub', n), pod: 4032 },
];
const SIZES = [10000, 100000, 500000];
const aop = (s: Scenario) => evaluateScenario(s, { structure: false }).training!.operationalAvailability;

function hacdSection(): string {
  const t0 = Date.now();
  // 7.1 geometry of each variant at one full SuperPoD
  const geo = ROWS.map((r) => {
    const s = r.make(r.pod);
    const k = computeCounts(s);
    const sp = s.topology.superpod!;
    const two = sp.fabric === 'two-level';
    const so = s.topology.scaleOut;
    return `<tr><td>${r.name} ${r.ev}</td><td class="num">${int(k.gpus)}</td><td class="num">${k.racks} + ${k.commRacks}</td><td><code>${sp.fabric}</code></td><td class="num">${two ? `${int(k.l1Switches)} L1` : int(k.rackSwitches)}</td><td class="num">${two ? `${int(k.l2Switches)} L2` : int(k.podSwitches)}</td><td class="num">${int(k.meshLinks + k.rackMeshLinks)}</td><td class="num">${int(k.opticalLinks)}</td><td class="num">${int(k.transceivers)}</td><td class="num">${int(k.opticalEngines)}</td><td class="num">${so ? `${so.portsPerNpu} 口 · ${so.planes ?? 1} 平面 · k = ${so.radix}` : '—'}</td></tr>`;
  }).join('');
  // 7.2 model counts against the public figures
  const c1 = computeCounts(a950('a950-1k')(1024));
  const c8 = computeCounts(a950('a950-8k')(8192));
  const c4 = computeCounts(a950('a950-4d')(8192));
  const csc = computeCounts(a950('a950-8k')(524288));
  const e1 = computeCounts(topologyScenario('a960e-ub', 4032));
  const e500 = computeCounts(topologyScenario('a960e-ub', 500000));
  const cal: [string, string, string, string, string][] = [
    ['Atlas 950 · 1,024 NPU', '计算柜 + 灵衢互联柜', `${c1.racks} + ${c1.commRacks}`, '16 + 4（产品页）', '<span class="ev" data-ev="huawei">华为确认</span>'],
    ['Atlas 950 · 1,024 NPU', '800G 光模块（链路两端）', int(c1.transceivers), '4,096 × 800G LPO，含交换侧（LightCounting 现场拆解）', '<span class="ev" data-ev="analyst">分析师/券商</span>'],
    ['Atlas 950 · 1,024 NPU', '柜–交换光链路', int(c1.opticalLinks), `<span class="f">1,024 × 2 = 2,048</span>（每 NPU 2 条 800G，推得）`, '<span class="ev" data-ev="analyst">分析师/券商</span>'],
    ['Atlas 950 · 1,024 NPU', '超节点层 UB 交换', int(c1.podSwitches), `<span class="f">⌈2,048 / 128⌉ = 16</span>，每互联柜 4 台（推得；100 Tb/s ÷ 800G = 128 口）`, '<span class="ev" data-ev="unverified">推得</span>'],
    ['Atlas 950 · 1,024 NPU', '柜内低阶交换 LRS', int(c1.rackSwitches), '每柜 72 片（UB-Mesh 论文的机柜设计）', '<span class="ev" data-ev="paper">华为论文</span>'],
    ['Atlas 950 · 8,192 NPU', '超节点层 UB 交换', int(c8.podSwitches), '128 × 100T UB 交换，一层 Clos（Hot Chips 2025 参考设计）', '<span class="ev" data-ev="paper">华为论文</span>'],
    ['Atlas 950 · 8,192 NPU', '800G 光模块', int(c8.transceivers), `<span class="f">8 × 4,096 = 32,768</span>（按 1,024 卡的比例外推）`, '<span class="ev" data-ev="unverified">推得</span>'],
    ['UB-Mesh 4D · 8,192 NPU', '高阶交换 HRS', int(c4.podSwitches), '每 8K 64 台 HRS（x512）', '<span class="ev" data-ev="paper">华为论文</span>'],
    ['Atlas 950 SuperCluster', '超节点数 · NPU', `${csc.supernodes} · ${int(csc.gpus)}`, '64 × 8,192 = 524,288（路线图）', '<span class="ev" data-ev="huawei">华为确认</span>'],
    ['Atlas 950 SuperCluster', 'scale-out 交换（2 平面）', `${int(csc.scaleOutSwitches)}（每平面 ${csc.scaleOutTiers} 层）`, `<span class="f">128³ / 4 = 524,288</span> 口/平面；平面数、端口数、层数均为假设`, '<span class="ev" data-ev="unverified">假设</span>'],
    ['Atlas 960E · 4,032 NPU', 'NPO 光引擎 Hi-ONE', int(e1.opticalEngines), `<span class="f">5,500 × 4,032 / 4,096 = 5,414.1</span>（官方 5,500 对应名义 4,096 卡）`, '<span class="ev" data-ev="huawei">华为确认</span>'],
    ['Atlas 960E · 4,032 NPU', '光链路（800G 等效）', int(e1.opticalLinks), `<span class="f">48,000 / 2 × 4,032 / 4,096 = 23,625</span>（以被替代的 48,000 个 800G 模块计）`, '<span class="ev" data-ev="huawei">华为确认</span>'],
    ['Atlas 960E · 4,032 NPU', '跨柜 LinkDevice', int(e1.podSwitches), `<span class="f">⌈4,032 × 5.5 / 176⌉ = 126</span>（2.2 TB/s 每 NPU ÷ 1.6 Tb/s 每口，推得）`, '<span class="ev" data-ev="unverified">推得</span>'],
    ['Atlas 960E · 500,000 NPU', '超节点数', int(e500.supernodes), '两层四平面 Clos 至 512,000 卡 = 125 × 4,096', '<span class="ev" data-ev="huawei">华为确认</span>'],
  ];
  // 7.3 FIT per NPU and A_op at the built-in scales
  const kpis = ROWS.map((r) => {
    const cells = SIZES.map((n) => { const s = r.make(n); const b = topologyBom(s); return { fit: b.hardFitPerNpuTotal, ub: (b.hardFitPerNpu['ub-switch'] ?? 0) + (b.hardFitPerNpu['ub-link'] ?? 0), a: aop(s) }; });
    return `<tr><td>${r.name}</td>${cells.map((c) => `<td class="num">${num(c.fit, 0)}</td><td class="num">${num(c.ub, 1)}</td><td class="num">${pct(c.a)}</td>`).join('')}</tr>`;
  }).join('');
  const assumed = (t: TopologyTemplate) => TOPOLOGY_TEMPLATES[t].assumed.map((x) => `<code>${esc(x)}</code>`).join('、');
  const variants = (SUPERPOD_VARIANTS['a950-ub2'] ?? []).map((v) => `<li><code>${v.id}</code>：${esc(v.name.zh)}</li>`).join('');
  console.error(`section 7 computed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return `<section id="hacd">
<h2>7. HAC-D 内置拓扑：Atlas 950 与 Atlas 960E 模板</h2>
<p>依据第 1–3 节，HAC-D v4.2 把拓扑模板从三个扩展为四个：<code>a950-ub2</code>（Atlas 950，按产品页现行规格重建）与新增的 <code>a960e-ub</code>（Atlas 960E）。两者都可在内置规模 10k / 100k / 200k / 500k NPU 或任意 N 上计算，超节点按需填充（最后一个超节点按实际卡数配交换与互联柜）。拓扑页的“超节点形态”可在 Atlas 950 的四种形态间切换：</p>
<ul>${variants}</ul>
<h3>7.1 各形态的单超节点几何（引擎计数）</h3>
<div class="table-wrap"><table class="data wide"><thead><tr><th>模板 / 形态</th><th class="num">NPU</th><th class="num">计算 + 互联柜</th><th>UB 拓扑</th><th class="num">柜内交换</th><th class="num">超节点层交换</th><th class="num">电互联链路</th><th class="num">光链路</th><th class="num">光模块</th><th class="num">NPO 引擎</th><th class="num">超节点间 scale-out（每 NPU）</th></tr></thead><tbody>${geo}</tbody></table></div>
<div class="formula">
<div class="eq">柜内全互联电链路 = t·C(p, 2) + p·C(t, 2)　（Atlas 950：t = 8 托盘、p = 8 NPU → 每柜 448 条）</div>
<div class="eq">超节点层交换 = ⌈超节点 NPU 数 × 每 NPU 上联数 / 交换端口数⌉ ；光链路 = NPU × 每 NPU 光链路数 ；光模块 = 光链路 × 2</div>
<div class="eq">NPO 引擎 = NPU × 每 NPU 引擎数 ；UB-Mesh 4D 柜间链路 = g × g 网格中同行或同列的柜对数</div>
<div class="eq">scale-out：每平面是一个 Clos，端口数 = ⌈N × 每 NPU 端口数 / 平面数⌉；总量 = 平面数 × 每平面</div>
</div>
<h3>7.2 模型计数与公开数字的核对</h3>
<div class="table-wrap"><table class="data"><thead><tr><th>对象</th><th>计数项</th><th class="num">HAC-D</th><th>公开数字或推导</th><th>证据</th></tr></thead><tbody>${cal.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody></table></div>
<h3>7.3 每 NPU 的硬件中断 FIT 与 A_op（六项默认机制）</h3>
<p><b>口径</b>：FIT 为每 NPU 每 10⁹ 小时的作业中断次数（仅硬件，机制前），由 54 类事件目录按 CloudMatrix384 几何换算到各硬件单元；UB 列为 UB 交换与 UB 光链路两类之和。A_op 为 30 天训练作业的运行可用度，六项默认机制、名义参数。</p>
<div class="table-wrap"><table class="data wide"><thead><tr><th rowspan="2">模板 / 形态</th>${SIZES.map((n) => `<th colspan="3" class="num">${int(n)} NPU</th>`).join('')}</tr><tr>${SIZES.map(() => '<th class="num">FIT / NPU</th><th class="num">其中 UB</th><th class="num">A_op</th>').join('')}</tr></thead><tbody>${kpis}</tbody></table></div>
<div class="callout">新单元的 FIT 沿用 CloudMatrix384 的单元等价（假设）：每片交换芯片（LRS、UB 交换、HRS、LinkBlade、LinkDevice）按一片 CloudMatrix384 UB 交换芯片计 57.1 FIT；每条光链路按一条 CloudMatrix384 L1–L2 链路计 4.76 FIT；柜内电链路与 NPO 光引擎只计数不计 FIT（光链路故障已计在链路上）。UB 列的差别主要来自交换芯片的数量：Atlas 950 每 64 卡 72 片 LRS（论文的机柜设计，约 1.1 片/卡），而 Atlas 960E 每 72 卡只假设 5 片 LinkBlade（约 0.07 片/卡）；960E 的光链路反而更多（800G 等效每卡约 5.9 条，950 为 2 条）。两者的交换芯片数都不是官方数字，在没有实测之前，这一列不能用来比较 960E 与 950 的网络可靠性。8,192 卡形态与 1,024 卡形态每卡的单元数相同，所以每卡 FIT 与 A_op 也相同；差别只在故障域大小。</div>
<div class="callout warn">CloudMatrix384 的光模块数沿用 v4 的假设：每条 L1–L2 链路两端各 1 个，每超节点 5,376 × 2 = 10,752 个；华为可靠性报告给出的是每超节点 5,376 个光模块、2,688 根连线（第 6 节），两者口径不一致（一根连线承载几条逻辑链路未说明）。光模块在 HAC-D 中只计数、不计 FIT（光故障计在链路上），所以这一差别不改变中断率。</div>
<h3>7.4 假设清单</h3>
<p><b>Atlas 950（<code>a950-ub2</code>）</b>：${assumed('a950-ub2')}。<b>Atlas 960E（<code>a960e-ub</code>）</b>：${assumed('a960e-ub')}。其余几何取自华为产品页、发布会与论文，出处见拓扑页“来源”与本文第 1–3 节。</p>
<h3>7.5 使用方法</h3>
<ul>
<li>网页：拓扑与硬件页选择 “Atlas 950” 或 “Atlas 960E” 模板；“超节点形态”切换 1,024 / 8,192 / UB-Mesh 4D / 两级拷贝；“UB 互联拓扑”与各参数可逐项修改；scale-out 可设平面数。</li>
<li>CLI：<code>hacd topology a950-ub2 --sizes 10000,100000,500000</code>、<code>hacd topology a950-ub2 --variant a950-8k --npus 8192</code>、<code>hacd topology a960e-ub --npus 500000</code>；MCP 工具 <code>topology_bom</code> 与 <code>allocation_strategy</code> 接受模板 <code>a960e-ub</code>，Atlas 950 的形态用参数 <code>variant</code>（<code>a950-1k</code> / <code>a950-8k</code> / <code>a950-4d</code> / <code>a950-2l</code>）选择。</li>
<li>金标：<code>packages/core/test/golden/compute_golden_v4.py</code> 用 Python 独立计算四个模板和三个 Atlas 950 变体的计数与 FIT（178 例）。</li>
</ul>
</section>`;
}

/* ---------------- assemble ---------------- */
const ORDER = ['00-abstract', 'a950', 'scaleout', 'a960e', 'customers', 'operators', 'reliability', '#hacd', 'review-a', 'review-b', '99-open'];
let body = ORDER.map((n) => (n === '#hacd' ? hacdSection() : frag(n))).join('\n');
// a "number" cell holding prose (more than 28 characters outside its inline formula) is left-aligned like text
body = body.replace(/<td class="num">([\s\S]*?)<\/td>/g, (m, inner: string) => (inner.replace(/<span class="f">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim().length > 28 ? `<td class="numtext">${inner}</td>` : m));
// tables with seven or more header columns scroll at a larger minimum width on phones
body = body.replace(/<table class="data">(\s*<thead>\s*<tr>[\s\S]*?<\/tr>)/g, (m, head: string) => ((head.match(/<th[\s>]/g) ?? []).length >= 7 ? `<table class="data wide">${head}` : m));
// citations: number by first appearance
const refs: string[] = [];
const idx = new Map<string, number>();
body = body.replace(/<cite data-url="([^"]+)"><\/cite>/g, (_, u: string) => {
  const url = u.replace(/&amp;/g, '&');
  if (!idx.has(url)) { refs.push(url); idx.set(url, refs.length); }
  const i = idx.get(url)!;
  return `<sup class="cite"><a href="#r${i}">[${i}]</a></sup>`;
});
// a run of adjacent citations [55][33][31] → one superscript [55, 33, 31] (repeats dropped)
const ONE = '<sup class="cite"><a href="#r\\d+">\\[\\d+\\]</a></sup>';
body = body.replace(new RegExp(`${ONE}(?:\\s*${ONE})+`, 'g'), (run) => {
  const ids = [...new Set([...run.matchAll(/#r(\d+)/g)].map((m) => m[1]))];
  return `<sup class="cite">[${ids.map((i) => `<a href="#r${i}">${i}</a>`).join(', ')}]</sup>`;
});
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const refList = refs.map((u, i) => {
  const m = SOURCES[u] ?? {};
  return `<li id="r${i + 1}"><span class="rn">[${i + 1}]</span> ${m.publisher ? `${esc(m.publisher)}. ` : ''}${m.title ? `<em>${esc(m.title)}</em>. ` : ''}${m.date ? `${esc(m.date)}. ` : ''}<a href="${esc(u)}">${esc(host(u))}</a></li>`;
}).join('');
const unknown = refs.filter((u) => !SOURCES[u]);
if (unknown.length) console.error(`warning: ${unknown.length} cited URL(s) without metadata:\n  ${unknown.join('\n  ')}`);
const toc = [...body.matchAll(/<section id="([^"]+)">\s*<h2>([^<]+)<\/h2>/g)].map((m) => `<li><a href="#${m[1]}">${esc(m[2])}</a></li>`).join('');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>昇腾下一代集群架构综述</title>
<meta name="description" content="昇腾下一代集群架构综述（复核与扩展版，${DATE}）：Atlas 950 超节点与 SuperCluster、Atlas 960E 与路线图、客户部署、已公开的可靠性数字及其口径、对 Codex 版的逐条复核，以及据此内置到 HAC-D 的 Atlas 950 / 960E 拓扑模板。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#f6f5f1; --surface:#ffffff; --surface-2:#efede7; --ink:#1d1d1b; --muted:#5f5e58; --rule:#d9d6cd; --accent:#2f4fb8; --accent-soft:#e7ecfa; --warn:#a8691b; --warn-soft:#f6ead6; --ok:#2a7d4f; --ok-soft:#e3f1e8; --crit:#b3261e; --crit-soft:#f8e1df; --teal:#0f766e; --teal-soft:#dff2ef; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#6fcf97; --ok-soft:#1d3125; --crit:#f2b8b5; --crit-soft:#3d2120; --teal:#5fd3c4; --teal-soft:#173431; } }
  :root[data-theme="dark"] { --bg:#141513; --surface:#1d1e1b; --surface-2:#262724; --ink:#ecebe6; --muted:#a39f94; --rule:#35362f; --accent:#9cb0ef; --accent-soft:#232a40; --warn:#e0a85a; --warn-soft:#3a2e1d; --ok:#6fcf97; --ok-soft:#1d3125; --crit:#f2b8b5; --crit-soft:#3d2120; --teal:#5fd3c4; --teal-soft:#173431; }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif; font-size: 13.5px; line-height: 1.62; }
  main { max-width: 1120px; margin: 0 auto; padding: 22px 16px 48px; }
  .page { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; padding: 24px 28px 28px; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: "IBM Plex Serif", "PingFang SC", "Noto Serif CJK SC", Georgia, serif; font-size: 23px; font-weight: 600; line-height: 1.3; margin: 4px 0 8px; overflow-wrap: anywhere; }
  h2 { font-family: "IBM Plex Serif", "PingFang SC", Georgia, serif; font-size: 17px; font-weight: 600; margin: 26px 0 8px; padding-top: 12px; border-top: 1px solid var(--rule); overflow-wrap: anywhere; }
  h3 { font-size: 14px; margin: 16px 0 6px; } h4 { font-size: 13px; margin: 12px 0 4px; }
  p { margin: 6px 0; overflow-wrap: anywhere; } li { margin: 2px 0; overflow-wrap: anywhere; } .sub { color: var(--muted); font-size: 12.5px; margin: 0 0 8px; }
  a { color: var(--accent); }
  code { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 11.8px; background: var(--surface-2); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 8px 0 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.2px; line-height: 1.5; background: var(--surface); }
  th, td { border-bottom: 1px solid var(--rule); padding: 4px 7px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: var(--surface-2); font-weight: 600; font-size: 11.8px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; } th.num { white-space: nowrap; } td.num .f, td.numtext .f { display: block; font-size: 11px; color: var(--muted); } td.numtext { font-variant-numeric: tabular-nums; } td code { overflow-wrap: normal; white-space: nowrap; }
  table.data td, table.data th { min-width: 4.6em; } table.data td:first-child, table.data th:first-child { min-width: 7.5em; } table.data th.num { min-width: 0; } table.data td.num { min-width: 5.5em; }
  .callout { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 7px 12px; border-radius: 0 6px 6px 0; margin: 10px 0; font-size: 12.8px; }
  .callout.warn { border-left-color: var(--warn); background: var(--warn-soft); }
  .formula { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 7px 12px; border-radius: 0 6px 6px 0; margin: 8px 0; font-size: 12.4px; }
  .formula .eq, .f { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; } .formula .eq { margin: 3px 0; }
  .ev, .st, .vd { display: inline-block; font-size: 10.8px; line-height: 1.5; padding: 0 6px; border-radius: 9px; border: 1px solid currentColor; white-space: nowrap; margin: 0 2px; vertical-align: 1px; font-weight: 500; }
  .ev[data-ev="huawei"] { color: var(--accent); background: var(--accent-soft); }
  .ev[data-ev="paper"] { color: var(--accent); }
  .ev[data-ev="customer"] { color: var(--ok); background: var(--ok-soft); }
  .ev[data-ev="tender"] { color: var(--teal); background: var(--teal-soft); }
  .ev[data-ev="media"], .ev[data-ev="analyst"] { color: var(--warn); background: var(--warn-soft); }
  .ev[data-ev="unverified"] { color: var(--muted); }
  .ev[data-ev="contradicted"] { color: var(--crit); background: var(--crit-soft); }
  .st { color: var(--muted); border-style: dashed; }
  .vd[data-vd="confirmed"] { color: var(--ok); background: var(--ok-soft); }
  .vd[data-vd="partly"] { color: var(--accent); background: var(--accent-soft); }
  .vd[data-vd="corrected"] { color: var(--warn); background: var(--warn-soft); }
  .vd[data-vd="refuted"] { color: var(--crit); background: var(--crit-soft); }
  .vd[data-vd="unverifiable"], .vd[data-vd="missing"] { color: var(--muted); }
  sup.cite { font-size: 9.5px; line-height: 0; white-space: nowrap; } sup.cite a { text-decoration: none; }
  nav.toc ol { columns: 2; column-gap: 28px; margin: 6px 0 0; padding-left: 0; list-style: none; font-size: 12.8px; } nav.toc li { break-inside: avoid; }
  dl.legend { display: grid; grid-template-columns: max-content 1fr; gap: 3px 10px; font-size: 12.4px; margin: 6px 0; } dl.legend dt { text-align: right; } dl.legend dd { margin: 0; }
  ol.refs { list-style: none; padding: 0; font-size: 11.8px; line-height: 1.5; } ol.refs li { padding-left: 3.2em; text-indent: -3.2em; margin: 2px 0; } ol.refs .rn { display: inline-block; width: 3.2em; text-indent: 0; color: var(--muted); font-variant-numeric: tabular-nums; }
  ol.refs li:target { background: var(--accent-soft); }
  footer { font-size: 11.5px; color: var(--muted); margin-top: 14px; overflow-wrap: anywhere; }
  @media screen and (max-width: 760px) { .page { padding: 16px 12px 18px; } h1 { font-size: 19px; } .table-wrap table { min-width: 620px; } .table-wrap table.wide { min-width: 1040px; } nav.toc ol { columns: 1; } dl.legend { grid-template-columns: 1fr; } dl.legend dt { text-align: left; } }
  @media print {
    @page { size: A4; margin: 9mm 9mm 10mm; }
    html, body { background: #fff; color: #000; font-size: 9.2px; line-height: 1.45; }
    main { max-width: none; padding: 0; } .page { border: none; border-radius: 0; padding: 0; }
    table { font-size: 8px; line-height: 1.32; } th, td { padding: 1.5px 3px; } th { font-size: inherit; } code, .f, .formula .eq { font-size: 8px; } td.num .f, td.numtext .f { font-size: 7.2px; } table.data td, table.data th { min-width: 0; } table.data td:first-child, table.data th:first-child { min-width: 6em; }
    h1 { font-size: 15px; } h2 { font-size: 11.5px; margin: 10px 0 3px; padding-top: 4px; break-after: avoid; } h3 { font-size: 10px; margin: 6px 0 2px; break-after: avoid; } h4 { break-after: avoid; }
    .table-wrap { overflow: visible; } tr { break-inside: avoid; } .callout, .formula { break-inside: avoid; font-size: 8.4px; padding: 3px 7px; }
    .ev, .st, .vd { font-size: 7.4px; padding: 0 3px; } nav.toc ol { font-size: 8.6px; } ol.refs { font-size: 7.6px; } a { color: inherit; }
  }
</style>
</head>
<body>
<main>
<article class="page">
  <div class="eyebrow">HAC-D v4.2 · 证据综述 · ${DATE}</div>
  <h1>昇腾下一代集群架构综述（复核与扩展版）：Atlas 950、Atlas 960E 与客户部署</h1>
  <p class="sub">本文复核 Codex 版《昇腾集群架构研究》（2026-10-19，原文件保持不动），补充 Atlas 950 超节点的内部互联、SuperCluster、Atlas 960E 与路线图、主要客户部署以及已公开的可靠性数字，并说明据此内置到 HAC-D 的 Atlas 950 与 Atlas 960E 拓扑模板。证据截至 ${DATE}；每条事实带证据标签与来源编号，所有数字注明口径。</p>
  <dl class="legend">
    <dt><span class="ev" data-ev="customer">客户确认</span></dt><dd>客户本身的公告、财报、技术报告或官方渠道</dd>
    <dt><span class="ev" data-ev="huawei">华为确认</span></dt><dd>华为新闻稿、发布会主题演讲、产品页、白皮书</dd>
    <dt><span class="ev" data-ev="paper">华为论文</span></dt><dd>华为作者的论文或会议报告（设计与实验，不等于已交付产品）</dd>
    <dt><span class="ev" data-ev="tender">招标/政府文件</span></dt><dd>招标、中标、采购公示，政府或国企公告</dd>
    <dt><span class="ev" data-ev="media">媒体</span> <span class="ev" data-ev="analyst">分析师/券商</span></dt><dd>媒体报道、行业分析或券商研报（含现场拆解）；单一来源时以此为准，不升级</dd>
    <dt><span class="ev" data-ev="unverified">未证实</span> <span class="ev" data-ev="contradicted">相互矛盾</span></dt><dd>找不到可核实的来源，或来源之间互相矛盾；HAC-D 的推得量与假设值也用灰色标签</dd>
    <dt><span class="st" data-st="delivered">状态</span></dt><dd>已交付/在用、部署中、展示/样机、规格、路线图、报道（虚线标签）</dd>
  </dl>
  <nav class="toc"><b>目录</b><ol>${toc}<li><a href="#refs">参考文献</a></li></ol></nav>
${body}
  <section id="refs">
  <h2>参考文献</h2>
  <p class="sub">按正文首次引用编号。日期为来源的发布或更新日期；所有链接在 ${DATE} 前后由研究流程逐一读取；昇腾社区 hiascend.com 只引用其产品页与新闻页，文档页（/document）未用作依据。</p>
  <ol class="refs">${refList}</ol>
  </section>
  <footer>生成：<code>node --import tsx scripts/build-ascend-nextgen-survey.ts</code>（章节源文件 <code>docs/ascend-nextgen/sections/</code>，来源元数据 <code>docs/ascend-nextgen/sources.json</code>；第 7 节由 HAC-D 引擎计算）。原 Codex 版：<code>codex_update/ASCEND_CLUSTER_ARCHITECTURE.research-2026-10-19.zh.html</code>。</footer>
</article>
</main>
</body>
</html>
`;
writeFileSync(OUT, html);
console.error(`wrote ${OUT}: ${refs.length} references, ${(html.length / 1024).toFixed(0)} kB`);
