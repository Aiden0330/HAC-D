#!/usr/bin/env node
/**
 * Build docs/ARCH_ALLOCATION_98P5_500K.{zh,en}.html from docs/arch-allocation-500k/results.json (scripts/arch-allocation-500k.ts):
 * A_op ≥ 98.5 % at 500,000 NPUs for the Ascend architectures of the two scaling reports — the gap, ARINC on the hardware alone,
 * mechanisms and recovery levers first and ARINC for the rest, the least-effort mix, the mechanism parameters and the allowed FIT /
 * MTBF per hardware unit, the iso-target curve and the residual downtime. Page style shared with scripts/build-ascend950-scaling.mjs.
 * Usage: node scripts/build-arch-allocation-500k.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { esc, fmt, svgOpen, titleBlock, legend, wrap, lines } from './ascend950-figures.mjs';

const R = JSON.parse(readFileSync('docs/arch-allocation-500k/results.json', 'utf8'));
const DATE = R.generated.slice(0, 10);
const A = R.archs;
const MAIN = ['cm384', 'a3server', 'native950', 'ubl128'];
const ALL = [...MAIN, 'a2', 'a960e'];
const pct = (x, d = 2) => `${(x * 100).toFixed(d)} %`;
const BASE_CSS = readFileSync('scripts/build-ascend950-scaling.mjs', 'utf8').match(/const css = `([\s\S]*?)`;\n/)[1];
const COL = { cm384: 'var(--s1)', a3server: 'var(--s2)', native950: 'var(--s3)', ubl128: 'var(--s4)' };
const preHw = (st) => { const s = st.steps.filter((x) => x.kind !== 'hardware'); return s.length ? s[s.length - 1] : null; };

function page(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const SHORT = { cm384: 'CM384', a3server: '800T A3', native950: T('原生 950', 'Native 950'), ubl128: 'UBL128', a2: 'A2', a960e: '960E' };
  const hrs = (h) => (h >= 10 ? `${fmt(h, 1)} h` : h >= 1 ? `${fmt(h, 2)} h` : `${fmt(h * 60)} min`);
  const UNIT = {
    npu: T('NPU', 'NPU'), job: T('作业级服务（每 NPU）', 'Job-level services (per NPU)'), node: T('节点（8 NPU）', 'Node (8 NPUs)'), cpu: T('CPU', 'CPU'),
    cabinet: T('计算柜', 'Compute cabinet'), 'ub-switch': T('UB 交换芯片 / 交换机', 'UB switch chip / switch'), 'ub-link': T('UB 光链路', 'UB optical link'),
    'roce-switch': T('scale-out 交换机', 'Scale-out switch'), 'roce-link': T('scale-out 光链路', 'Scale-out optical link'),
  };
  const MECH = Object.fromEntries([...R.candidates, ...R.defaults].map((m) => [m.id, m]));
  const LEV = Object.fromEntries(R.levers.map((l) => [l.id, l]));
  const levName = (id) => ({ auto: T('自动尝试 60 s', 'auto attempt 60 s'), manual: T('人工 30 min', 'manual 30 min'), success: T('自动成功 99.9 %', 'auto success 99.9 %') })[id] ?? id;
  const cm = A.cm384, s3 = A.a3server, nv = A.native950, ub = A.ubl128;
  const range = (f, d = 2, ids = MAIN) => { const v = ids.map((id) => f(A[id])); return `${fmt(Math.min(...v), d)}–${fmt(Math.max(...v), d)}`; };
  const rangeP = (f, d = 2, ids = MAIN) => { const v = ids.map((id) => f(A[id]) * 100); return `${fmt(Math.min(...v), d)}–${fmt(Math.max(...v), d)} %`; };

  /* ---------------- Table 1: the gap ---------------- */
  const gapRows = ALL.map((id) => {
    const a = A[id], n = a.nominal, d = a.derated;
    const hw = a.strategies.hwOnly;
    return `<tr${a.ref ? ' class="ref"' : ''}><td class="b">${esc(a.name[lang])}</td><td class="num">${fmt(a.fitPerNpu)}</td><td class="num">${pct(n.aOp)} / ${pct(d.aOp)}</td><td class="num">${hrs(n.mtbfHwH)}</td><td class="num">${fmt(n.mttrS, 1)} / ${fmt(d.mttrS, 1)} s</td><td class="num">${fmt(n.sumC, 1)} / ${fmt(d.sumC, 1)}</td><td class="num">${fmt(d.B, 1)}</td><td class="num b">×${fmt(n.x, 3)} / ×${fmt(hw.factor, 3)}</td><td class="num">${fmt(a.fitPerNpu * hw.factor)}</td><td class="num">${hrs(1 / (n.lamHw * hw.factor))}</td><td class="num">${fmt(n.mttrReqS, 1)} s</td></tr>`;
  }).join('');
  const table1 = `<div class="table-wrap"><table class="a1"><thead><tr><th>${esc(T('架构（50 万卡，六个默认机制）', 'Architecture (500k NPUs, six default mechanisms)'))}</th><th class="num">${esc(T('FIT / NPU', 'FIT per NPU'))}</th><th class="num">${esc(T('A_op 名义 / 降额', 'A_op nominal / derated'))}</th><th class="num">MTBF_hw</th><th class="num">${esc(T('MTTR_hw 名义 / 降额', 'MTTR_hw nominal / derated'))}</th><th class="num">${esc(T('Σcᵢ 名义 / 降额（s / h）', 'Σcᵢ nominal / derated (s/h)'))}</th><th class="num">${esc(T('预算 B（降额，s / h）', 'Budget B (derated, s/h)'))}</th><th class="num">${esc(T('只靠硬件的 ARINC 系数：名义 / 稳健', 'ARINC factor, hardware alone: nominal / robust'))}</th><th class="num">${esc(T('FIT / NPU 上限（稳健）', 'FIT per NPU ceiling (robust)'))}</th><th class="num">${esc(T('需要的 MTBF_hw', 'MTBF_hw needed'))}</th><th class="num">${esc(T('或：今天 FIT 下需要的 MTTR', 'Or: MTTR needed at today’s FIT'))}</th></tr></thead><tbody>${gapRows}</tbody></table></div>`;

  /* ---------------- Chart 1: budget ledger (derated, the binding side) ---------------- */
  function chartLedger() {
    const W = 960, x0 = 190, x1 = 900, y0 = 58, rowH = 34;
    const ids = ALL;
    const H = y0 + ids.length * rowH + 40;
    const maxU = Math.ceil(Math.max(...ids.map((id) => 1 - A[id].derated.aOp)) * 100) / 100 + 0.002;
    const X = (u) => x0 + (u / maxU) * (x1 - x0);
    const head = titleBlock(T('图 1：50 万卡的不可用度怎样降到 1.5 %（降额口径，约束起作用的一侧）：先机制与恢复杠杆，余下交给 ARINC 硬件', 'Figure 1: how the unavailability at 500k comes down to 1.5 % (derated, the binding side): mechanisms and recovery levers first, ARINC hardware for the rest'));
    let g = svgOpen('fig-ledger', W, H + head.dy, T('不可用度分配', 'Unavailability ledger')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    for (let v = 0; v <= maxU + 1e-9; v += 0.005) g += `<line x1="${X(v)}" y1="${y0 - 8}" x2="${X(v)}" y2="${y0 + ids.length * rowH - 6}" class="grid"/><text x="${X(v)}" y="${y0 - 12}" class="m" text-anchor="middle">${fmt(v * 100, 1)} %</text>`;
    ids.forEach((id, i) => {
      const a = A[id], o = a.strategies.optimal;
      const u0 = 1 - a.derated.aOp, u1 = 1 - preHw(o).derated, u2 = 1 - R.target;
      const y = y0 + i * rowH;
      g += lines(x0 - 10, y + 13, wrap(`${a.name[lang].replace(/（模板默认）| \(template default\)/, '')}`, x0 - 20, 9.8).slice(0, 2), a.ref ? 'm' : 's', 11, 'end');
      const seg = (from, to, style, label, tip) => {
        if (to - from <= 0) return '';
        let s = `<rect x="${X(from)}" y="${y}" width="${Math.max(1, X(to) - X(from) - 2)}" height="20" rx="3" style="${style}" data-tip="${esc(tip)}"/>`;
        if (X(to) - X(from) > 46) s += `<text x="${(X(from) + X(to)) / 2 - 1}" y="${y + 14}" class="tiny" text-anchor="middle" style="fill:var(--surface);font-weight:600">${esc(label)}</text>`;
        return s;
      };
      const tip = `${a.name[lang]}|${T('今天（降额）', 'today (derated)')} ${pct(1 - u0, 3)} → ${T('机制 + 杠杆后', 'after mechanisms + levers')} ${pct(1 - u1, 3)} → ${T('ARINC ×', 'ARINC ×')}${fmt(o.factor, 3)} → ${pct(R.target, 2)}|${T('名义', 'nominal')}: ${pct(a.nominal.aOp, 3)} → ${pct(preHw(o).value, 3)} → ${pct(o.final.value, 3)}`;
      g += seg(0, u2, 'fill:var(--axis)', T('目标 1.5 %', 'target 1.5 %'), tip);
      g += seg(u2, u1, 'fill:var(--s2)', `${T('硬件', 'hardware')} ${fmt((u1 - u2) * 100, 2)} pt`, tip);
      g += seg(u1, u0, 'fill:var(--s1)', `${T('机制', 'mech.')} ${fmt((u0 - u1) * 100, 2)} pt`, tip);
      g += `<text x="${X(u0) + 6}" y="${y + 14}" class="tiny">${esc(`${fmt(u0 * 100, 2)} %`)}</text>`;
      g += `<rect x="0" y="${y - 4}" width="${W}" height="${rowH - 2}" fill="transparent" data-tip="${esc(tip)}"/>`;
    });
    const lg = legend(x0, y0 + ids.length * rowH + 14, [
      { label: T('机制与恢复杠杆去掉的（D-HARD、R-NETFAIL（UBL128、A2 不用）、自动尝试 60 s、人工 30 min）', 'removed by mechanisms and recovery levers (D-HARD, R-NETFAIL (not on UBL128, A2), auto attempt 60 s, manual 30 min)'), style: 'fill:var(--s1)' },
      { label: T('ARINC 硬件去掉的（所有中断类 FIT × 同一系数）', 'removed by ARINC hardware (every interruption class × one factor)'), style: 'fill:var(--s2)' },
      { label: T('留下的 1.5 %', 'the 1.5 % left'), style: 'fill:var(--axis)' },
    ]);
    g += lg.g;
    return g + '</g></svg>';
  }

  /* ---------------- Table 2: strategies ---------------- */
  const setStr = (st) => [...st.mechanisms, ...st.levers.map(levName)].join(' + ') || '—';
  const stratRows = ALL.map((id) => {
    const a = A[id], S = a.strategies;
    const mf = S.mttrFirst, op = S.optimal, me = S.optimalMinEffort;
    const meCls = me.hardware.improvedRows.slice().sort((p, q) => p.factor - q.factor).map((r) => `${r.id.replace(/-hard$/, '')} ×${fmt(r.factor, 2)}`).join(', ');
    return `<tr${a.ref ? ' class="ref"' : ''}><td class="b">${esc(SHORT[id])}</td>`
      + `<td class="num">×${fmt(S.hwOnly.factor, 3)}</td><td class="num">${fmt(S.hwOnly.effort.total, 1)}</td>`
      + `<td>${esc(setStr(mf))}</td><td class="num">${pct(preHw(mf).value)} / ${pct(preHw(mf).derated)}</td><td class="num">×${fmt(mf.factor, 3)}</td><td class="num">${fmt(mf.effort.total, 1)}</td>`
      + `<td>${esc(setStr(op))}</td><td class="num b">×${fmt(op.factor, 3)}</td><td class="num">${fmt(op.effort.mechanisms + op.effort.levers, 0)} + ${fmt(op.effort.hardware, 1)}</td>`
      + `<td class="w">${esc(meCls)}</td><td class="num">${fmt(me.effort.total, 1)}</td></tr>`;
  }).join('');
  const table2 = `<div class="table-wrap"><table class="a2"><thead>
    <tr><th rowspan="2">${esc(T('架构', 'Architecture'))}</th><th colspan="2" class="c">${esc(T('① 只靠硬件（ARINC）', '① Hardware alone (ARINC)'))}</th><th colspan="4" class="c">${esc(T('② 先机制后硬件（MTTR 优先 + ARINC）', '② Mechanisms first, then hardware (MTTR-first + ARINC)'))}</th><th colspan="3" class="c">${esc(T('③ 最省力组合（最优 + ARINC）', '③ Least-effort mix (optimal + ARINC)'))}</th><th colspan="2" class="c">${esc(T('参照：最优 + 最小努力拆分', 'Reference: optimal + minimum-effort split'))}</th></tr>
    <tr><th class="num">${esc(T('系数 x', 'factor x'))}</th><th class="num">${esc(T('努力', 'effort'))}</th><th>${esc(T('机制与杠杆', 'mechanisms and levers'))}</th><th class="num">${esc(T('不动硬件时 A_op 名义 / 降额', 'A_op without hardware, nominal / derated'))}</th><th class="num">${esc(T('系数 x', 'factor x'))}</th><th class="num">${esc(T('努力', 'effort'))}</th><th>${esc(T('机制与杠杆', 'mechanisms and levers'))}</th><th class="num">${esc(T('系数 x', 'factor x'))}</th><th class="num">${esc(T('努力 机制 + 硬件', 'effort mech. + hw'))}</th><th>${esc(T('只改这些类（系数）', 'only these classes (factor)'))}</th><th class="num">${esc(T('努力', 'effort'))}</th></tr></thead><tbody>${stratRows}</tbody></table></div>`;

  /* ---------------- Table 3: mechanism and lever parameter allocation ---------------- */
  const used = (mid) => MAIN.concat(['a2', 'a960e']).filter((id) => A[id].strategies.optimal.mechanisms.includes(mid)).map((id) => SHORT[id]);
  const usedL = (lid) => ALL.filter((id) => A[id].strategies.optimal.levers.includes(lid)).map((id) => SHORT[id]);
  const par = (p) => Object.entries(p).map(([k, v]) => `${k} ${+Number(v).toFixed(4)}`).join(', ');
  const gainRange = (key) => {
    const v = MAIN.map((id) => A[id].singles[key]);
    const f = (k) => {
      const xs = v.map((x) => x[k] * 100);
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const sg = (x) => (x > 0.0005 ? '+' : x < -0.0005 ? '−' : '');
      if (Math.abs(hi - lo) < 0.005) return `${sg(lo)}${fmt(Math.abs(lo), 2)}`;
      if (sg(lo) === sg(hi)) { const a1 = Math.min(Math.abs(lo), Math.abs(hi)), a2 = Math.max(Math.abs(lo), Math.abs(hi)); return `${sg(lo)}${fmt(a1, 2)}–${fmt(a2, 2)}`; }
      return `${sg(lo)}${fmt(Math.abs(lo), 2)}…${sg(hi)}${fmt(Math.abs(hi), 2)}`;
    };
    return `${f('nominal')} / ${f('derated')}`;
  };
  const WHY = {
    'D-HARD': T('每种架构都选：便宜（努力 2），缩短所有中断的检测段', 'chosen everywhere: cheap (effort 2), shortens the detection part of every interruption'),
    'R-NETFAIL': T('网络类（NIC、光、框内 IO、交换）在集合通信内切换，不回滚；UBL128、A2 上收益只够打平努力', 'network classes (NIC, optics, board IO, switches) fail over inside the collective, no rollback; on UBL128 and A2 the gain only matches the effort'),
    'D-SLOW': T('只影响亚健康隔离的检出，对 A_op 几乎无增益；仅 ② 的贪心顺带选入', 'only changes detection of sub-health, ≈ no A_op gain; picked up only by the greedy ②'),
    'C-MEM': T('单独有效，但与“自动尝试 60 s”杠杆替代（都缩短全局恢复的加载段）；杠杆收益更大，选了杠杆就不再需要', 'useful alone, but a substitute for the “auto attempt 60 s” lever (both shorten the load part of the global recovery); the lever gains more, after it C-MEM adds nothing'),
    'P-PREDICT': T('有害：50 % 召回、80 % 精度的预测把中断变成 180 s 迁移，误报再加暂停', 'harmful: a 50 %-recall, 80 %-precision predictor turns interruptions into 180 s migrations and false alarms add pauses'),
    'R-HOTSWAP': T('有害：180 s 换卡比它替代的弹性恢复（1 s 同步）慢得多', 'harmful: a 180 s swap is far slower than the elastic recovery (1 s resync) it displaces'),
  };
  const mechRows = R.candidates.map((m) => {
    const u = used(m.id);
    const status = u.length ? T(`③ 选用：${u.join('、')}`, `③ chosen: ${u.join(', ')}`) : T('③ 未选', '③ not chosen');
    return `<tr${u.length ? '' : ' class="dim"'}><td class="b">${esc(m.id)}</td><td>${esc(m.name[lang])}</td><td class="src">${esc(par(m.nominal))}</td><td class="src">${esc(par(m.derated))}</td><td class="num">${m.effort}</td><td class="num">${esc(gainRange(m.id))}</td><td>${esc(status)}；${esc(WHY[m.id] ?? '')}</td></tr>`;
  }).join('');
  const levRows = R.levers.map((l) => {
    const u = usedL(l.id);
    const cur = l.id === 'success' ? pct(l.current, 1) : `${fmt(l.current)} s`;
    const lim = l.id === 'success' ? pct(l.limit, 1) : `${fmt(l.limit)} s`;
    const der = l.id === 'success' ? T(`${pct(l.deratedLimit, 1)}（低于今天的 ${cur}，降额后无收益）`, `${pct(l.deratedLimit, 1)} (below today’s ${cur}: no derated gain)`) : `${fmt(l.deratedLimit)} s`;
    return `<tr${u.length ? '' : ' class="dim"'}><td class="b">${esc(T('杠杆', 'Lever'))}</td><td>${esc(l.name[lang])}：${esc(cur)} → ${esc(lim)}</td><td class="src">${esc(lim)}</td><td class="src">${esc(der)}</td><td class="num">${l.effort}</td><td class="num">${esc(gainRange(`lever:${l.id}`))}</td><td>${esc(u.length ? T(`③ 选用：${u.join('、')}`, `③ chosen: ${u.join(', ')}`) : T('③ 未选：降额后无收益', '③ not chosen: no derated gain'))}</td></tr>`;
  }).join('');
  const defRows = R.defaults.map((m) => `<tr class="def"><td class="b">${esc(m.id)}</td><td>${esc(m.name[lang])}</td><td class="src">${esc(par(m.nominal))}</td><td class="src">${esc(par(m.derated))}</td><td class="num">${m.effort}</td><td class="num">—</td><td>${esc(T('已在基线（六个默认机制），一并降额', 'in the baseline (six defaults), derated as well'))}</td></tr>`).join('');
  const table3 = `<div class="table-wrap"><table class="a3"><thead><tr><th>${esc(T('机制 / 杠杆', 'Mechanism / lever'))}</th><th>${esc(T('名称', 'Name'))}</th><th>${esc(T('分配的参数（名义 = 要求）', 'Allocated parameters (nominal = requirement)'))}</th><th>${esc(T('降额核验用值', 'Derated check value'))}</th><th class="num">${esc(T('努力', 'Effort'))}</th><th class="num">${esc(T('单独加入的 A_op 增益：名义 / 降额（pt，四种架构）', 'A_op gain alone: nominal / derated (points, four architectures)'))}</th><th>${esc(T('选用与原因', 'Used and why'))}</th></tr></thead><tbody>${mechRows}${levRows}${defRows}</tbody></table></div>`;

  /* ---------------- Table 4: ARINC per hardware unit ---------------- */
  const units = ['npu', 'job', 'node', 'cpu', 'cabinet', 'ub-switch', 'ub-link', 'roce-switch', 'roce-link'];
  const unitOf = (id, u) => A[id].units.find((x) => x.unit === u);
  const uRows = units.map((u) => {
    const any = MAIN.map((id) => unitOf(id, u)).find(Boolean);
    if (!any) return '';
    const cells = MAIN.map((id) => { const x = unitOf(id, u); return x ? `<td class="num">${fmt(x.share * 100, 1)} %</td><td class="num">${fmt(x.allowedHwOnly, x.allowedHwOnly < 10 ? 2 : 0)}</td><td class="num b">${fmt(x.allowedOptimal, x.allowedOptimal < 10 ? 2 : 0)}</td>` : '<td class="num">—</td><td class="num">—</td><td class="num">—</td>'; }).join('');
    return `<tr><td>${esc(UNIT[u])}</td><td class="num">${fmt(any.fitPerUnit, any.fitPerUnit < 10 ? 2 : 0)}</td><td class="num">${esc(any.mtbfUnitH >= 8760 ? T(`${fmt(any.mtbfUnitH / 8760, 1)} 年`, `${fmt(any.mtbfUnitH / 8760, 1)} y`) : `${fmt(any.mtbfUnitH)} h`)}</td>${cells}</tr>`;
  }).join('');
  const sumRow = `<tr class="sum b"><td>${esc(T('每 NPU 合计 / 集群 MTBF_hw', 'Per NPU in total / cluster MTBF_hw'))}</td><td class="num" colspan="2">—</td>${MAIN.map((id) => { const a = A[id]; return `<td class="num">100 %</td><td class="num">${fmt(a.fitPerNpu * a.strategies.hwOnly.factor)}<br>${hrs(1 / (a.nominal.lamHw * a.strategies.hwOnly.factor))}</td><td class="num">${fmt(a.fitPerNpu * a.strategies.optimal.factor)}<br>${hrs(1 / (a.nominal.lamHw * a.strategies.optimal.factor))}</td>`; }).join('')}</tr>`;
  const xRow = `<tr class="sec"><td colspan="3">${esc(T('ARINC 系数 x（所有中断类相同）', 'ARINC factor x (the same for every interruption class)'))}</td>${MAIN.map((id) => `<td></td><td class="num">×${fmt(A[id].strategies.hwOnly.factor, 3)}</td><td class="num">×${fmt(A[id].strategies.optimal.factor, 3)}</td>`).join('')}</tr>`;
  const table4 = `<div class="table-wrap"><table class="a4"><thead><tr><th rowspan="2">${esc(T('硬件单元', 'Hardware unit'))}</th><th rowspan="2" class="num">${esc(T('今天 FIT / 单元', 'Today FIT per unit'))}</th><th rowspan="2" class="num">${esc(T('今天 MTBF / 单元', 'Today MTBF per unit'))}</th>${MAIN.map((id) => `<th colspan="3" class="c">${esc(SHORT[id])}</th>`).join('')}</tr><tr>${MAIN.map(() => `<th class="num">${esc(T('份额 wᵤ', 'share wᵤ'))}</th><th class="num">${esc(T('① 允许', '① allowed'))}</th><th class="num">${esc(T('③ 允许', '③ allowed'))}</th>`).join('')}</tr></thead><tbody>${xRow}${uRows}${sumRow}</tbody></table></div>`;

  /* ---------------- Chart 2: iso-target curve ---------------- */
  function chartCurve() {
    const W = 960, H = 330, x0 = 74, x1 = 780, y0 = 50, y1 = 270;
    const X = (s) => x0 + ((180 - s) / 150) * (x1 - x0);
    const Y = (v) => y1 - (v / 1) * (y1 - y0);
    const head = titleBlock(T('图 2：只靠硬件时需要的 ARINC 系数随自动恢复尝试时间变化（名义参数，六个默认机制；系数越大越容易）', 'Figure 2: ARINC factor needed with hardware alone as the automatic recovery attempt gets shorter (nominal parameters, six default mechanisms; larger is easier)'));
    let g = svgOpen('fig-curve', W, H, T('等目标曲线', 'Iso-target curve')) + head.svg;
    for (let v = 0; v <= 1.0001; v += 0.2) g += `<line x1="${x0}" y1="${Y(v)}" x2="${x1}" y2="${Y(v)}" class="grid"/><text x="${x0 - 8}" y="${Y(v) + 4}" class="m" text-anchor="end">×${fmt(v, 1)}</text>`;
    for (const s of [180, 150, 120, 90, 60, 45, 30]) g += `<line x1="${X(s)}" y1="${y1}" x2="${X(s)}" y2="${y1 + 4}" class="axis"/><text x="${X(s)}" y="${y1 + 17}" class="m" text-anchor="middle">${s} s</text>`;
    g += `<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" class="axis"/><text x="${(x0 + x1) / 2}" y="${y1 + 33}" class="s" text-anchor="middle">${esc(T('自动恢复尝试时间（今天 180 s → 杠杆下限 60 s → 30 s）', 'automatic recovery attempt (today 180 s → lever limit 60 s → 30 s)'))}</text>`;
    for (const [s, lab] of [[180, T('今天', 'today')], [60, T('杠杆下限', 'lever limit')]]) g += `<line x1="${X(s)}" y1="${y0 - 4}" x2="${X(s)}" y2="${y1}" style="stroke:var(--muted);stroke-width:1.1;stroke-dasharray:4 4"/><text x="${X(s) + 4}" y="${y0 + 2}" class="s halo">${esc(lab)}</text>`;
    for (const id of MAIN) {
      const c = A[id].curve;
      g += `<polyline points="${c.map((p) => `${X(p.autoS).toFixed(1)},${Y(p.x).toFixed(1)}`).join(' ')}" fill="none" style="stroke:${COL[id]};stroke-width:2"/>`;
      for (const p of c) {
        const tip = `${SHORT[id]} · ${T('自动尝试', 'auto attempt')} ${p.autoS} s|${T('需要的 ARINC 系数', 'ARINC factor needed')} ×${fmt(p.x, 3)}（FIT / NPU ≤ ${fmt(A[id].fitPerNpu * p.x)}）|MTTR_hw ${fmt(p.mttrS, 1)} s · ${T('全局恢复', 'global recovery')} ${fmt(p.globalS, 1)} s`;
        g += `<circle cx="${X(p.autoS)}" cy="${Y(p.x)}" r="3.6" style="fill:${COL[id]};stroke:var(--surface);stroke-width:1.4" data-tip="${esc(tip)}"/><circle cx="${X(p.autoS)}" cy="${Y(p.x)}" r="10" fill="transparent" data-tip="${esc(tip)}"/>`;
      }
    }
    // direct labels at the 30 s end, spread to avoid overlap
    const ends = MAIN.map((id) => ({ id, y: Y(A[id].curve[0].x) })).sort((p, q) => p.y - q.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    for (const e of ends) g += `<text x="${x1 + 8}" y="${e.y + 4}" class="s halo">${esc(`${SHORT[e.id]} ×${fmt(A[e.id].curve[0].x, 2)}`)}</text>`;
    const note = T(`x · MTTR_hw 近似为常数：把 180 s 缩到 60 s，CM384 的系数从 ×${fmt(cm.curve.find((p) => p.autoS === 180).x, 2)} 放宽到 ×${fmt(cm.curve.find((p) => p.autoS === 60).x, 2)}（按 HAC-D 的努力度量 log₂(1/x)，硬件任务减半）`, `x · MTTR_hw is roughly constant: cutting 180 s to 60 s relaxes the CM384 factor from ×${fmt(cm.curve.find((p) => p.autoS === 180).x, 2)} to ×${fmt(cm.curve.find((p) => p.autoS === 60).x, 2)} (half the hardware task in HAC-D’s effort measure log₂(1/x))`);
    g += lines(x0 + 10, Y(0.93), wrap(note, 420, 9.8), 's halo', 12);
    const lg = legend(x0, H - 8, MAIN.map((id) => ({ label: SHORT[id], line: true, style: `stroke:${COL[id]};stroke-width:2` })));
    g += lg.g;
    return g + '</svg>';
  }

  /* ---------------- Table 5: final designs ---------------- */
  const finRows = ALL.map((id) => {
    const a = A[id], f = a.final, v = a.strategies.optimal.verification;
    const sh = (u) => (f.units[u] ? `${fmt((f.units[u].lp / f.sumLP) * 100)} %` : '—');
    return `<tr${a.ref ? ' class="ref"' : ''}><td class="b">${esc(SHORT[id])}</td><td class="num">${fmt(f.fitPerNpu)}</td><td class="num">${hrs(f.mtbfHwH)}</td><td class="num">${fmt(f.mttrS, 1)} / ${fmt(f.mttrDerS, 1)} s</td><td class="num b">${pct(f.aOp)} / ${pct(f.aOpDerated)}</td><td class="num">${v ? `${pct(v.value.p05)} · ${fmt(v.pAtLeastTarget * 100)} %` : '—'}</td><td class="num">${pct(f.delivered, 1)}</td><td class="num">${sh('job')}</td><td class="num">${sh('cabinet')}</td><td class="num">${sh('node')}</td><td class="num">${sh('npu')}</td></tr>`;
  }).join('');
  const table5 = `<div class="table-wrap"><table class="a5"><thead><tr><th>${esc(T('③ 的最终设计', 'Final design of ③'))}</th><th class="num">${esc(T('FIT / NPU', 'FIT per NPU'))}</th><th class="num">MTBF_hw</th><th class="num">${esc(T('MTTR_hw 名义 / 降额', 'MTTR_hw nominal / derated'))}</th><th class="num">${esc(T('A_op 名义 / 降额', 'A_op nominal / derated'))}</th><th class="num">${esc(T(`逐窗口：5 % 分位 · P(≥ 98.5 %)（${R.trials} 个 30 天窗口）`, `Per window: 5th percentile · P(≥ 98.5 %) (${R.trials} 30-day windows)`))}</th><th class="num">${esc(T('正确有效产出（= ReMAP 可用度）', 'Delivered goodput (= ReMAP availability)'))}</th><th class="num">${esc(T('剩余停机：作业级', 'Residual downtime: job-level'))}</th><th class="num">${esc(T('计算柜', 'cabinet'))}</th><th class="num">${esc(T('节点', 'node'))}</th><th class="num">NPU</th></tr></thead><tbody>${finRows}</tbody></table></div>`;

  /* ---------------- text ---------------- */
  const keyFindings = [
    T(`<b>差距</b>：六个默认机制下，四种主架构在 50 万卡的 A_op 名义 ${rangeP((a) => a.nominal.aOp)}、降额 ${rangeP((a) => a.derated.aOp)}。达到 98.5 % 每小时只允许约 ${range((a) => a.derated.B, 0)} s 暂停，今天是 ${range((a) => a.nominal.sumC, 0)} s（降额 ${range((a) => a.derated.sumC, 0)} s）：要去掉约 ${range((a) => (1 - a.derated.B / a.derated.sumC) * 100, 0)} % 的暂停时间。`, `<b>Gap</b>: with the six default mechanisms, the four main architectures have, at 500k, an A_op of ${rangeP((a) => a.nominal.aOp)} nominal and ${rangeP((a) => a.derated.aOp)} derated. 98.5 % allows ≈ ${range((a) => a.derated.B, 0)} s of pause per hour against ${range((a) => a.nominal.sumC, 0)} s today (${range((a) => a.derated.sumC, 0)} s derated): about ${range((a) => (1 - a.derated.B / a.derated.sumC) * 100, 0)} % of the pause time has to go.`),
    T(`<b>① 只靠硬件（ARINC）</b>：所有中断类的 FIT 乘同一系数 ×${range((a) => a.strategies.hwOnly.factor, 2)}（CM384 最难、UBL128 最易），即每 NPU ${range((a) => a.fitPerNpu * a.strategies.hwOnly.factor, 0)} FIT、集群 MTBF_hw ≥ ${range((a) => 1 / (a.nominal.lamHw * a.strategies.hwOnly.factor), 1)} h；或在今天的 FIT 下把 MTTR_hw 压到 ${range((a) => a.nominal.mttrReqS, 0)} s。`, `<b>① Hardware alone (ARINC)</b>: every interruption class’s FIT times one factor ×${range((a) => a.strategies.hwOnly.factor, 2)} (hardest for CM384, easiest for UBL128) — ${range((a) => a.fitPerNpu * a.strategies.hwOnly.factor, 0)} FIT per NPU and a cluster MTBF_hw ≥ ${range((a) => 1 / (a.nominal.lamHw * a.strategies.hwOnly.factor), 1)} h; or, at today’s FIT, MTTR_hw down to ${range((a) => a.nominal.mttrReqS, 0)} s.`),
    T(`<b>② / ③ 先机制后硬件</b>：D-HARD（99.9 % 中断在 1 s 内检出）+ R-NETFAIL（网络类 95 % 在 2 s 内集合通信内切换）+ 自动恢复尝试 180 → 60 s + 人工恢复 2 h → 30 min，不动硬件就到名义 ${rangeP((a) => preHw(a.strategies.optimal).value)}，但降额只有 ${rangeP((a) => preHw(a.strategies.optimal).derated)}；余下由 ARINC ×${range((a) => a.strategies.optimal.factor, 2)} 补齐：FIT 只需降 ${range((a) => (1 - a.strategies.optimal.factor) * 100, 0)} %（① 要降 ${range((a) => (1 - a.strategies.hwOnly.factor) * 100, 0)} %）。UBL128 上 R-NETFAIL 的收益（单独 +${fmt(ub.singles['R-NETFAIL'].derated * 100, 2)} 个百分点，降额）只够打平它的努力分，所以 ③ 不选它。最终名义 ${rangeP((a) => a.final.aOp)}、降额正好 98.50 %，${R.trials} 个 30 天窗口全部 ≥ 98.5 %。`, `<b>② / ③ Mechanisms first, then hardware</b>: D-HARD (99.9 % of interruptions detected within 1 s) + R-NETFAIL (95 % of network faults failed over inside the collective in 2 s) + automatic attempt 180 → 60 s + manual recovery 2 h → 30 min reach ${rangeP((a) => preHw(a.strategies.optimal).value)} nominally without touching the hardware, but only ${rangeP((a) => preHw(a.strategies.optimal).derated)} derated; ARINC ×${range((a) => a.strategies.optimal.factor, 2)} closes the rest: FIT only has to fall by ${range((a) => (1 - a.strategies.optimal.factor) * 100, 0)} % (① needs ${range((a) => (1 - a.strategies.hwOnly.factor) * 100, 0)} %). On UBL128 R-NETFAIL’s gain (+${fmt(ub.singles['R-NETFAIL'].derated * 100, 2)} points alone, derated) only matches its effort score, so ③ leaves it out. Final: ${rangeP((a) => a.final.aOp)} nominal, exactly 98.50 % derated, all ${R.trials} 30-day windows ≥ 98.5 %.`),
    T(`<b>架构差别</b>：950 两种架构的每 NPU FIT 低（${fmt(ub.fitPerNpu)} / ${fmt(nv.fitPerNpu)} 对 910C 的 ${fmt(s3.fitPerNpu)} / ${fmt(cm.fitPerNpu)}），硬件系数更宽（③ ×${fmt(nv.strategies.optimal.factor, 2)} / ×${fmt(ub.strategies.optimal.factor, 2)} 对 ×${fmt(cm.strategies.optimal.factor, 2)} / ×${fmt(s3.strategies.optimal.factor, 2)}）；同一代内两种形态相差不到 ${fmt(Math.ceil(Math.max(Math.abs(cm.strategies.optimal.factor - s3.strategies.optimal.factor), Math.abs(nv.strategies.optimal.factor - ub.strategies.optimal.factor)) * 100) / 100, 2)}。分配之后剩余停机集中在没有快速恢复梯级的类：作业级服务 ${range((a) => a.final.units.job.lp / a.final.sumLP * 100, 0)} %、计算柜 ${range((a) => a.final.units.cabinet.lp / a.final.sumLP * 100, 0)} %、节点 ${range((a) => a.final.units.node.lp / a.final.sumLP * 100, 0)} %。`, `<b>Architectures</b>: the two 950 architectures have lower FIT per NPU (${fmt(ub.fitPerNpu)} / ${fmt(nv.fitPerNpu)} against ${fmt(s3.fitPerNpu)} / ${fmt(cm.fitPerNpu)} for 910C) and a looser hardware factor (③ ×${fmt(nv.strategies.optimal.factor, 2)} / ×${fmt(ub.strategies.optimal.factor, 2)} against ×${fmt(cm.strategies.optimal.factor, 2)} / ×${fmt(s3.strategies.optimal.factor, 2)}); within a generation the two forms differ by less than ${fmt(Math.ceil(Math.max(Math.abs(cm.strategies.optimal.factor - s3.strategies.optimal.factor), Math.abs(nv.strategies.optimal.factor - ub.strategies.optimal.factor)) * 100) / 100, 2)}. After allocation the residual downtime sits in the classes without a fast recovery rung: job-level services ${range((a) => a.final.units.job.lp / a.final.sumLP * 100, 0)} %, compute cabinets ${range((a) => a.final.units.cabinet.lp / a.final.sumLP * 100, 0)} %, nodes ${range((a) => a.final.units.node.lp / a.final.sumLP * 100, 0)} %.`),
    T(`<b>口径</b>：目标是 A_op（运行可用度，= ReMAP 的“运行可用度”），不是 ReMAP 的主指标“可用度”（正确有效产出）：最终设计的有效产出只有 ${rangeP((a) => a.final.delivered, 1)}。ARINC 按今天各类的中断率等比例分配（同一系数），简单但费力：只改没有快速恢复梯级的 3–5 类（UNKNOWN ×0.19–0.24、POWER、MGMT、STORAGE、COOL）的“最小努力”拆分，硬件努力只有 ARINC 的约三分之一（表 2 右栏）。`, `<b>口径</b>: the target is A_op (= ReMAP’s “operational availability”), not ReMAP’s headline “availability” (delivered goodput): the final designs deliver only ${rangeP((a) => a.final.delivered, 1)}. ARINC shares the cut in proportion to today’s rates (one factor) — simple but costly: a minimum-effort split that only touches the 3–5 classes without a fast rung (UNKNOWN ×0.19–0.24, POWER, MGMT, STORAGE, COOL) needs about a third of the hardware effort (right of Table 2).`),
  ];

  const css = BASE_CSS + `
  table.a1 td:first-child { min-width: 14em; } table.a2 td:first-child { min-width: 5em; } table.a2 td:nth-child(4), table.a2 td:nth-child(8) { min-width: 12em; } table.a2 td.w { min-width: 12em; }
  table.a3 td:nth-child(2) { min-width: 10em; } table.a3 td:nth-child(3), table.a3 td:nth-child(4) { min-width: 9em; } table.a3 td:last-child { min-width: 16em; } table.a3 td.num { min-width: 7.5em; }
  table.a4 td:first-child { min-width: 10em; } table.a5 td:first-child { min-width: 5em; }
  tr.ref td { color: var(--muted); } tr.dim td { color: var(--muted); } tr.def td { background: var(--surface-2); }
  @media screen and (max-width: 760px) { .table-wrap table.a2 { min-width: 980px; } .table-wrap table.a4 { min-width: 900px; } }
  @media print { table.a2, table.a4 { font-size: 6.5px; } html[lang="en"] table.a2 { font-size: 6.1px; } }
`;
  const sections = [
    `<div class="eyebrow">EYEBROW1</div>
  <h1>${esc(T('50 万卡 A_op 98.5 % 的分配：ARINC（硬件）+ 机制（恢复侧），六种昇腾架构', 'Allocating A_op 98.5 % at 500,000 NPUs: ARINC on the hardware, mechanisms on the recovery side, across six Ascend architectures'))}</h1>
  <p class="sub">${T(`对象：910C 的 <b>CloudMatrix384</b> 与 <b>Atlas 800T A3 服务器集群</b>（<code>ASCEND910C_SCALING_RELIABILITY</code>）、950 的 <b>原生 Atlas 950 超节点</b> 与 <b>UBL128</b>（<code>ASCEND950_SCALING_RELIABILITY</code>），各取其报告的主算例；另列 HAC-D 模板默认的 A2（910B）与 Atlas 960E 作参照（灰字）。目标：一个同步训练作业在 30 天窗口上的 A_op ≥ 98.5 %，<b>名义参数与全部机制降额（覆盖 −5 pt、成功率 −8 pt、时间 ×1.5，含六个默认机制）都要满足</b>（HAC-D 分配策略的口径）。硬件按 ARINC 分配：所有中断类的 FIT 乘同一系数 x；恢复侧从 HAC-D 默认候选（D-HARD、D-SLOW、P-PREDICT、R-NETFAIL、R-HOTSWAP、C-MEM）与三个恢复杠杆（自动尝试 ≥ 60 s、自动成功 ≤ 99.9 %、人工 ≥ 30 min）中选。`, `Subjects: the 910C’s <b>CloudMatrix384</b> and <b>Atlas 800T A3 server cluster</b> (<code>ASCEND910C_SCALING_RELIABILITY</code>), the 950’s <b>native Atlas 950 SuperPoD</b> and <b>UBL128</b> (<code>ASCEND950_SCALING_RELIABILITY</code>), each at its report’s main case; HAC-D’s template-default A2 (910B) and Atlas 960E as reference rows (grey). Target: A_op ≥ 98.5 % for one synchronous training job over a 30-day window, <b>met both with nominal parameters and with every mechanism derated (coverage −5 pt, success −8 pt, times ×1.5, the six defaults included)</b> — the 口径 of HAC-D’s allocation strategies. Hardware is allocated by ARINC: every interruption class’s FIT times one factor x; the recovery side picks from HAC-D’s default candidates (D-HARD, D-SLOW, P-PREDICT, R-NETFAIL, R-HOTSWAP, C-MEM) and three recovery levers (automatic attempt ≥ 60 s, automatic success ≤ 99.9 %, manual ≥ 30 min).`)}</p>
  <div class="callout"><ul>${keyFindings.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <h2 class="first">${esc(T('1. 差距与只靠硬件的 ARINC 分配（表 1）', '1. The gap and ARINC on the hardware alone (Table 1)'))}</h2>
  ${table1}
  <div class="formula">B = 3600 · ((1 − φ)/A* − 1) − F　·　Σcᵢ = Σ λᵢ · t̄ᵢ = λ_hw · MTTR_hw　·　${T('ARINC：x = B / Σcᵢ，λᵢ* = x · λᵢ（等价于 λ*_hw = B / MTTR_hw，λᵢ* = (λᵢ/λ_hw) · λ*_hw）', 'ARINC: x = B / Σcᵢ, λᵢ* = x · λᵢ (equivalently λ*_hw = B / MTTR_hw, λᵢ* = (λᵢ/λ_hw) · λ*_hw)')}</div>
  <p class="note">${T('口径：事件 = 同步训练作业的硬中断；分母 = 集群·小时；层级 = 作业。cᵢ 为第 i 类中断每小时贡献的暂停秒数（中断率 × 机制链上的平均暂停），F 为另外两个事件类（亚健康隔离、静默损坏检出）的暂停，φ 为静默损坏片段的时间份额。名义 / 稳健两个系数分别只满足名义、同时满足名义与降额（降额时 Σcᵢ 更大，约束起作用）；稳健值由 HAC-D 的 allocateStrategy（硬件优先、无候选机制）在引擎上闭合，与闭式 x = B/Σcᵢ（降额）一致。“需要的 MTBF_hw”按稳健系数；最后一列是今天的 FIT 不变、只压 MTTR 时的要求 B / λ_hw。', '口径: event = a hard interruption of the synchronous training job; denominator = cluster-hour; level = job. cᵢ = pause seconds per hour from class i (rate × mean pause down the mechanism chain); F = the pauses of the two other event classes (isolation of sub-healthy units, detected silent corruption); φ = time share of silent-corruption episodes. The nominal / robust factors meet the target nominally / both nominally and derated (derated Σcᵢ is larger and binds); the robust value is closed on the engine by HAC-D’s allocateStrategy (hardware first, no candidate mechanisms) and equals the closed form x = B/Σcᵢ on the derated design. “MTBF_hw needed” uses the robust factor; the last column is the requirement B / λ_hw if today’s FIT stays and only the MTTR is cut.')}</p>
  <h3>${esc(T('机制与硬件怎样分担（图 1；三种策略见表 2）', 'How mechanisms and hardware share the task (Figure 1; the three strategies in Table 2)'))}</h3>
  <figure class="chart"><div class="scroll">${chartLedger()}</div></figure>`,
    `<div class="eyebrow">EYEBROW2</div>
  <h2 class="first">${esc(T('2. 三种分配策略（表 2）', '2. Three allocation strategies (Table 2)'))}</h2>
  ${table2}
  <p class="note">${T('① 硬件优先：不加机制，只求 ARINC 系数。② MTTR 优先：按“每单位努力的降额 A_op 增益”贪心加入恢复侧机制与杠杆，直到再无增益，余下交给 ARINC（会带上增益约为零的 D-SLOW）。③ 最优：在 6 个候选 + 3 个杠杆的全部 512 个子集上，取“机制努力 + 杠杆努力 + 硬件努力”最小者（硬件努力 = Σ 每类 2 · log₂(1/x)，ARINC 时约 40 个中断类都付这一份，所以硬件努力大）。参照列用同一目标、同一机制集，但硬件按“最小努力”拆分（KKT：只压暂停贡献大的类）。努力分为 HAC-D 机制库的默认值（1–5），只作相对比较。', '① Hardware first: no added mechanism, only the ARINC factor. ② MTTR-first: add recovery-side mechanisms and levers greedily by derated A_op gain per unit of effort until nothing gains, then ARINC for the rest (it picks up D-SLOW at a gain of ≈ 0). ③ Optimal: over all 512 subsets of the 6 candidates and 3 levers, the least of mechanism + lever + hardware effort (hardware effort = Σ over classes 2 · log₂(1/x); under ARINC all ≈ 40 interruption classes pay it, so the hardware effort is large). The reference columns keep the target and the mechanism set but split the hardware by minimum effort (KKT: only the classes with large pause contributions are cut). Efforts are HAC-D’s library defaults (1–5), for relative comparison only.')}</p>
  <h2>${esc(T('3. 机制参数与恢复杠杆的分配（表 3）', '3. Allocated mechanism parameters and recovery levers (Table 3)'))}</h2>
  ${table3}
  <p class="note">${T(`名义参数即对机制的要求（供应商 / 研发验收值）；降额值是本页核验用的保守值。全部候选与杠杆一起上反而更差（CM384 名义 ${pct(cm.allCandidates.aOp)}、降额 ${pct(cm.allCandidates.aOpDerated)}，低于只上 ③ 的组合）：P-PREDICT 的迁移与误报、R-HOTSWAP 的 180 s 换卡都比它们替代的重执行 / 弹性恢复更慢。自动成功率杠杆按 HAC-D 的降额规则（成功率 −8 pt）降到 91.9 %，低于今天的 99 %，在降额一侧没有收益，所以不会被选中——若改按“失败概率 ×1.5”降额，它会分担一部分硬件任务。`, `Nominal parameters are the requirements on the mechanisms (supplier / development acceptance values); derated values are the conservative ones this page checks with. Switching on every candidate and lever is worse (CM384 ${pct(cm.allCandidates.aOp)} nominal, ${pct(cm.allCandidates.aOpDerated)} derated, below the ③ set): P-PREDICT’s migrations and false alarms and R-HOTSWAP’s 180 s swaps are slower than the replay / elastic rungs they displace. The automatic-success lever derates by HAC-D’s rule (success −8 pt) to 91.9 %, below today’s 99 %, so it gains nothing on the derated side and is never chosen — derated as “failure probability ×1.5” instead, it would take part of the hardware task.`)}</p>
`,
    `<div class="eyebrow">EYEBROW3</div>
  <h2 class="first">${esc(T('4. ARINC 分到每个硬件单元的 FIT 与 MTBF（表 4、图 2）', '4. ARINC allocation per hardware unit: FIT and MTBF (Table 4, Figure 2)'))}</h2>
  ${table4}
  <p class="note">${T('单元 FIT 为参考目录在 CloudMatrix384 几何下的换算（每单元每 10⁹ 小时的业务影响中断，保护之后），四种架构相同；不同的是单元数，所以份额 wᵤ = λᵤ/λ_hw 不同。ARINC 下每个单元的允许 FIT = x · 今天的 FIT，允许的单元 MTBF = 今天的 MTBF / x（例：CM384 ③ 的 NPU 1,676 → 1,005 FIT，MTBF 68 → 114 年）。“①” 为只靠硬件，“③” 为最优组合（机制与杠杆之后）。末行为每 NPU 合计与集群 MTBF_hw（= 1 / (x · λ_hw)）。', 'Unit FIT is the reference catalog converted under the CloudMatrix384 geometry (business-impact interruptions per 10⁹ unit-hours after protection), the same in all four architectures; the unit counts differ, and with them the shares wᵤ = λᵤ/λ_hw. Under ARINC each unit’s allowed FIT = x · today’s FIT and its allowed MTBF = today’s MTBF / x (e.g. the CM384 NPU under ③: 1,676 → 1,005 FIT, MTBF 68 → 114 years). “①” = hardware alone, “③” = the optimal mix (after mechanisms and levers). Last row: per-NPU total and cluster MTBF_hw (= 1 / (x · λ_hw)).')}</p>
  <figure class="chart"><div class="scroll">${chartCurve()}</div></figure>
  <h2>${esc(T('5. 分配后的设计：仍然每小时中断一次，但每次只停约 25 s（表 5）', '5. The allocated designs: still about one interruption an hour, but each pause ≈ 25 s (Table 5)'))}</h2>
  ${table5}
  <p class="note">${T(`逐窗口一列由 HAC-D 的窗口账本蒙特卡罗（每个 30 天窗口独立抽样中断、恢复梯级与人工兜底）给出名义设计的 A_op 5 % 分位与达标窗口比例：名义设计因降额约束留有约 0.7 个百分点余量，所以全部窗口达标。剩余停机份额为名义设计中各单元占硬中断停机的比例。有效产出（保留的正确进度 ÷ 窗口）还要扣去检查点保存、回滚重算与静默损坏，约 86 %——要让 ReMAP 口径的“可用度”到 98.5 % 是另一个、难得多的问题（C-FAST 的保存开销本身就占 1.6 个百分点）。`, `The per-window column is HAC-D’s window-ledger Monte Carlo (each 30-day window samples its interruptions, recovery rungs and manual fallbacks independently) on the nominal design: the 5th percentile of A_op and the share of windows meeting the target. The derated constraint leaves the nominal design ≈ 0.7 points of margin, so every window meets it. Residual downtime shares are each unit’s part of the hard-interruption downtime of the nominal design. Delivered goodput (retained correct progress ÷ window) also loses checkpoint saves, rollback recompute and silent corruption, ≈ 86 % — bringing ReMAP’s headline “availability” to 98.5 % is another and much harder problem (C-FAST’s save overhead alone costs 1.6 points).`)}</p>
  <h3>${esc(T('读法与边界', 'How to read it and limits'))}</h3>
  <ul class="scale">
    <li>${T('<b>ARINC 的含义</b>：按今天各类中断率的比例分配允许值，即“所有类同样改进 x 倍”。它不看改进难度，也不看哪类有快速恢复梯级；HAC-D 另有 AGREE 与最小努力拆分（表 2 右栏），后者把硬件任务集中在 UNKNOWN、POWER、MGMT、STORAGE、COOL 这几类全局恢复类上。', '<b>What ARINC means</b>: allowed values in proportion to today’s rates, i.e. “every class improves by the same factor”. It ignores how hard each improvement is and which classes have a fast recovery rung; HAC-D also offers AGREE and the minimum-effort split (right of Table 2), which concentrates the hardware task on the global-recovery classes UNKNOWN, POWER, MGMT, STORAGE and COOL.')}</li>
    <li>${T('<b>机制分配</b>：候选限于 HAC-D 分配页的默认 6 个（无需集成参数即可评估）；扩展机制库（35 项，含 16 项审核机制的暂定参数）未参与。D-HARD 与两个恢复杠杆在每种架构都被选中，是最划算的三项；R-NETFAIL 在 UBL128 与 A2 上不划算。', '<b>Mechanism allocation</b>: candidates are HAC-D’s 6 allocation-page defaults (evaluable without integration parameters); the extended library (35 entries incl. the 16 audited mechanisms with provisional parameters) is not used. D-HARD and the two recovery levers are chosen for every architecture — the three best buys; R-NETFAIL does not pay on UBL128 and A2.')}</li>
    <li>${T('<b>不确定性</b>：故障率是 54 类事件参考目录（GPU 机群的类比先验）按单元换算，不是 910C / 950 实测；机制参数是名义目标；结构假设（800T A3 每柜台数、scale-out 端口数与层数）见两份规模报告。结论的形状（差距 ≈ 3×、机制先行可减半硬件任务、剩余停机在全局恢复类）对这些假设不敏感，具体系数会随之移动。', '<b>Uncertainty</b>: failure rates are the 54-event reference catalog (an analogue prior from GPU fleets) converted per unit, not 910C / 950 measurements; mechanism parameters are nominal targets; structural assumptions (800T A3 servers per cabinet, scale-out ports and tiers) are in the two scaling reports. The shape of the result (a gap of ≈ 3×, mechanisms first halve the hardware task, residual downtime in the global-recovery classes) does not hinge on them; the exact factors move with them.')}</li>
  </ul>
  <footer>${T(`复现：<code>node --import tsx scripts/arch-allocation-500k.ts</code> → <code>node scripts/build-arch-allocation-500k.mjs</code>（引擎 HAC-D v4.3：<code>allocateStrategy</code>，hardwareSplit 'arinc' / 'min-effort'，默认降额，窗口账本 ${R.trials} 次、种子 1；架构定义 <code>scripts/ascend910c-archs.ts</code>、<code>scripts/ascend950-archs.ts</code>；共用读数 <code>scripts/scaling-common.ts</code>）。每个设计的降额值由独立重建的降额场景复核（误差 ≤ 1e-9）；四种主架构的预算 B、暂停贡献 Σcᵢ、ARINC 系数与最终设计的名义 / 降额 A_op 已由独立 Python 按文中参数重算（相对误差 ≤ 1e-7；引擎二分得到的硬件系数与闭式 B/Σcᵢ 相差 ≤ 3e-4）。方法背景：<code>docs/ALLOCATION_METHODS_SUMMARY.zh.html</code>、<code>docs/ALLOCATION_STRATEGY_V4.zh.html</code>、<code>docs/HARDWARE_MECHANISM_ALLOCATION_98P5.zh.html</code>。`, `Reproduce: <code>node --import tsx scripts/arch-allocation-500k.ts</code> → <code>node scripts/build-arch-allocation-500k.mjs</code> (HAC-D v4.3 engine: <code>allocateStrategy</code>, hardwareSplit 'arinc' / 'min-effort', default derating, window ledger ${R.trials} windows, seed 1; architectures in <code>scripts/ascend910c-archs.ts</code> and <code>scripts/ascend950-archs.ts</code>; shared read-outs in <code>scripts/scaling-common.ts</code>). Each design’s derated value is re-checked on an independently rebuilt derated scenario (difference ≤ 1e-9); for the four main architectures the budget B, the pause contributions Σcᵢ, the ARINC factors and the final designs’ nominal / derated A_op were recomputed independently in Python from the parameters stated here (relative difference ≤ 1e-7; the engine’s bisected hardware factor is within 3e-4 of the closed form B/Σcᵢ). Method background: <code>docs/ALLOCATION_METHODS_SUMMARY.en.html</code>, <code>docs/ALLOCATION_STRATEGY_V4.en.html</code>.`)}</footer>`,
  ];
  const nPages = sections.length;
  const eyebrow = (i) => esc(T(`HAC-D · 50 万卡 98.5 % 分配 · ${DATE} · 第 ${i} / ${nPages} 页`, `HAC-D · 98.5 % allocation at 500k · ${DATE} · page ${i} / ${nPages}`));
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
<title>${esc(T('50 万卡 98.5 % 分配', 'Allocation at 500k'))}</title>
<meta name="description" content="${esc(T('50 万卡同步训练作业 A_op ≥ 98.5 %（名义与降额）在 910C、950 等昇腾架构上的分配：ARINC 硬件系数、机制与恢复杠杆、每个硬件单元的允许 FIT 与 MTBF、等目标曲线与剩余停机（HAC-D）。', 'A_op ≥ 98.5 % (nominal and derated) for one synchronous training job on 500,000 NPUs across Ascend 910C and 950 architectures: ARINC hardware factors, mechanisms and recovery levers, allowed FIT and MTBF per hardware unit, the iso-target curve and the residual downtime (HAC-D).'))}">
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
  const out = `docs/ARCH_ALLOCATION_98P5_500K.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
page('zh');
page('en');
