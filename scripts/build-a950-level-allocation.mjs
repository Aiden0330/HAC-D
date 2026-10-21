#!/usr/bin/env node
/**
 * Build docs/ATLAS950_LEVEL_ALLOCATION.{zh,en}.html from docs/a950-level-allocation/results.json (scripts/a950-level-allocation.ts):
 * the Atlas 950 levels (cluster / SuperPoD / compute cabinet (Pod) / node / NPU), which reference mechanism sits at which level and
 * whose downtime it removes, today's downtime by level, and the allocation result of hardware and mechanisms at each level for
 * A_op ≥ 98.5 % — ReMAP's per-card FIT, ReMAP's six reference mechanisms, HAC-D's allocation methods. Page style shared with
 * scripts/build-ascend950-scaling.mjs; drawing helpers from scripts/ascend950-figures.mjs.
 * Usage: node scripts/build-a950-level-allocation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { esc, fmt, svgOpen, titleBlock, legend, wrap, lines, textBlock } from './ascend950-figures.mjs';

const R = JSON.parse(readFileSync('docs/a950-level-allocation/results.json', 'utf8'));
const BASE_CSS = readFileSync('scripts/build-ascend950-scaling.mjs', 'utf8').match(/const css = `([\s\S]*?)`;\n/)[1];
const DATE = R.generated.slice(0, 10);
const LV = R.levels.map((l) => l.id);
const Z = R.perSize[String(R.main)];
const Z2 = R.perSize['200000'];
const pct = (x, d = 2) => `${(x * 100).toFixed(d)} %`;
const sgnPt = (x, d = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}`;
const HM_LIGHT = '--h1:#b7d3f6; --h2:#6da7ec; --h3:#2a78d6; --h4:#184f95; --n1:#f7cfce; --n2:#f2a8a7; --n3:#ea7c7b; --n4:#e34948; --hm0:#f0efec;';
const HM_DARK = '--h1:#2b4a78; --h2:#2a5fa4; --h3:#3987e5; --h4:#86b6ef; --n1:#5a2a2a; --n2:#8c3434; --n3:#c24a4a; --n4:#e66767; --hm0:#383835;';
const HM_STYLE = `<style>svg.viz.hm { ${HM_LIGHT} } @media (prefers-color-scheme: dark) { svg.viz.hm { ${HM_DARK} } } :root[data-theme="light"] svg.viz.hm { ${HM_LIGHT} } :root[data-theme="dark"] svg.viz.hm { ${HM_DARK} } svg.viz.hm .cellt { font-size: 11px; font-variant-numeric: tabular-nums; } svg.viz.hm .onDark { fill: var(--surface); }</style>`;

function page(lang) {
  const T = (zh, en) => (lang === 'zh' ? zh : en);
  const LN = Object.fromEntries(R.levels.map((l) => [l.id, l.name[lang]]));
  const lvl = Object.fromEntries(R.levels.map((l) => [l.id, l]));
  const kN = (n) => (lang === 'zh' ? `${fmt(n / 10000)} 万卡` : `${fmt(n / 1000)}k`);
  const yrs = (h) => (h >= 8760 ? T(`${fmt(h / 8760, 1)} 年`, `${fmt(h / 8760, 1)} y`) : h >= 48 ? T(`${fmt(h / 24)} 天`, `${fmt(h / 24)} d`) : `${fmt(h, 1)} h`);
  const domainName = (d) => R.events.find((e) => e.domainId === d && e.type === 'hard')?.domain ?? d;
  const hardFit = (d) => R.events.find((e) => e.domainId === d && e.type === 'hard')?.fit ?? 0;
  const levelFitCard = (l) => lvl[l].domains.reduce((a, d) => a + hardFit(d), 0);
  const MECH = Object.fromEntries(R.mechanisms.map((m) => [m.id, m]));
  const dep = R.deploy;
  const totalPause = (x) => LV.reduce((a, l) => a + x[l].c + x[l].iso + x[l].sdc, 0);
  const tN = Z.today.levels, tD = Z.today.levelsDerated;
  const dec = Z.p3.decomposition;
  const sumC = Z.budget.sumCNominal;
  const share = (l) => tN[l].c / sumC;
  const unaddressed = (LV.filter((l) => (Z.endsToday[l].global ?? 0) > 0.999)).reduce((a, l) => a + share(l), 0);
  const x1 = Z.p1.arinc.hardware.rows[0].factor, x3 = Math.min(...Z.p3.arinc.hardware.rows.map((h) => h.factor));
  const g2 = Z.p2.factor;
  const sh = Z.shapley;
  const levName = { auto: T('自动尝试 180 → 60 s', 'automatic attempt 180 → 60 s'), manual: T('人工 2 h → 30 min', 'manual 2 h → 30 min'), success: T('自动成功 99 → 99.9 %', 'automatic success 99 → 99.9 %') };
  const p3Set = Z.p3.arinc.levers.map((id) => levName[id]).join(T('、', ', '));

  /* ---------------- Figure 1: the level map ---------------- */
  function figLevels() {
    const W = 960, x0 = 14, top = 46;
    const head = titleBlock(T(`图 1：Atlas 950 的五个层级（${kN(R.main)}）：每层的故障类（ReMAP 每卡 FIT）、部署在该层的参考机制、今天的停机份额`, `Figure 1: the five Atlas 950 levels (${kN(R.main)}): each level’s fault classes (ReMAP FIT per card), the reference mechanisms deployed there, today’s downtime share`));
    const cols = { lvl: x0, hw: x0 + 178, mech: x0 + 470, bar: x0 + 790 };
    const mechAt = (l) => Object.entries(dep).filter(([, v]) => v.level === l).map(([id]) => id);
    const actsOn = (id) => { const s = sh.gains[id]; if (!s) return ''; const ls = LV.filter((l) => Math.abs(s.byLevel[l]) > 0.05); return ls.map((l) => LN[l]).join(' · '); };
    const isRef = (id) => !!MECH[id];
    const chipW = (label) => 14 + Array.from(label).reduce((a, ch) => a + (/[一-鿿（）]/.test(ch) ? 10.5 : 6.4), 0);
    /** lay chips out left to right inside [xa, xb]; returns positions and the number of lines */
    const flow = (labels, xa, xb) => { let x = xa, line = 0; const pos = labels.map((lab) => { const w = chipW(lab); if (x + w > xb && x > xa) { x = xa; line++; } const p = { x, line, w }; x += w + 6; return p; }); return { pos, lines: labels.length ? line + 1 : 0 }; };
    const mechLabel = (id) => (isRef(id) ? id : ({ detect: T('检测（基线）', 'detection (baseline)'), isolate: T('亚健康隔离', 'sub-health isolation') })[id] ?? id);
    const rows = LV.map((l) => {
      const L = lvl[l];
      const hwLabels = L.domains.map((d) => `${d} ${fmt(hardFit(d), 1)}`);
      const mLabels = mechAt(l).map(mechLabel);
      const hw = flow(hwLabels, cols.hw, cols.mech - 12), me = flow(mLabels, cols.mech, cols.bar - 14);
      const acts = mechAt(l).filter(isRef).map((id) => `${id} → ${actsOn(id) || T('（A_op 无影响）', '(no A_op effect)')}`).join(T('；', '; '));
      const actsLines = acts ? wrap(acts, cols.bar - cols.mech - 20, 9.2) : [];
      const chipLines = Math.max(hw.lines, me.lines, 1);
      const h = Math.max(l === 'superpod' ? 84 : 76, 12 + chipLines * 22 + Math.max(16, actsLines.length * 11 + 6) + 8);
      return { l, L, hwLabels, mLabels, hw, me, actsLines, chipLines, h };
    });
    const bodyH = rows.reduce((a, r) => a + r.h, 0);
    const H = top + bodyH + 64 + head.dy;
    let g = svgOpen('fig-levels', W, H, T('层级映射', 'Level map')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    g += `<text x="${cols.lvl + 4}" y="${top - 10}" class="m">${esc(T('层级 · 个数 · 每个含 NPU', 'Level · instances · NPUs each'))}</text><text x="${cols.hw}" y="${top - 10}" class="m">${esc(T('故障类（硬中断 FIT / 卡）', 'Fault classes (hard FIT per card)'))}</text><text x="${cols.mech}" y="${top - 10}" class="m">${esc(T('部署在此层的参考机制 → 作用于', 'Reference mechanisms deployed here → act on'))}</text><text x="${cols.bar}" y="${top - 10}" class="m">${esc(T('今天的停机份额', 'Today’s downtime share'))}</text>`;
    let y = top;
    rows.forEach((r, i) => {
      const { l, L } = r;
      g += `<rect x="${x0}" y="${y}" width="${W - 28}" height="${r.h - 8}" rx="6" class="panel" style="fill:var(--b${i % 2 ? 5 : 1});opacity:0.55"/>`;
      g += `<text x="${cols.lvl + 8}" y="${y + 22}" class="h">${esc(L.name[lang])}</text>`;
      const inst = l === 'cluster' ? T(`1 个 · ${fmt(R.main)} NPU`, `1 · ${fmt(R.main)} NPUs`) : T(`${fmt(Z.instances[l])} 个 · ${fmt(L.cardsPer)} NPU`, `${fmt(Z.instances[l])} · ${fmt(L.cardsPer)} NPU${L.cardsPer > 1 ? 's' : ''} each`);
      g += `<text x="${cols.lvl + 8}" y="${y + 40}" class="s">${esc(inst)}</text>`;
      g += `<text x="${cols.lvl + 8}" y="${y + 55}" class="m">${esc(`ReMAP scope: ${l === 'superpod' ? 'rack' : L.scope}`)}</text>`;
      if (l === 'superpod') g += `<text x="${cols.lvl + 8}" y="${y + 67}" class="m">${esc(T('（950 中归超节点级）', '(SuperPoD level in the 950)'))}</text>`;
      r.hwLabels.forEach((label, j) => {
        const p = r.hw.pos[j], d = L.domains[j], cy = y + 10 + p.line * 22;
        const tip = `${d} · ${domainName(d)}|${T('硬中断', 'hard')} ${fmt(hardFit(d), 1)} FIT / ${T('卡', 'card')}|${T('每个本层实例', 'per instance of this level')} ${fmt(hardFit(d) * (l === 'cluster' ? R.main : L.cardsPer))} FIT`;
        g += `<rect x="${p.x}" y="${cy}" width="${p.w}" height="18" rx="9" class="cab" data-tip="${esc(tip)}"/><text x="${p.x + 6}" y="${cy + 13}" class="tiny" pointer-events="none">${esc(label)}</text>`;
      });
      g += `<text x="${cols.hw}" y="${y + 10 + r.chipLines * 22 + 12}" class="m">${esc(T(`合计 ${fmt(levelFitCard(l), 1)} FIT / 卡 = 每个 ${fmt(levelFitCard(l) * (l === 'cluster' ? R.main : L.cardsPer))} FIT`, `total ${fmt(levelFitCard(l), 1)} FIT per card = ${fmt(levelFitCard(l) * (l === 'cluster' ? R.main : L.cardsPer))} FIT per instance`))}</text>`;
      const ids = mechAt(l);
      r.mLabels.forEach((label, j) => {
        const p = r.me.pos[j], id = ids[j], my = y + 10 + p.line * 22;
        const on = actsOn(id);
        const tip = `${label}|${dep[id].how[lang]}${on ? `|${T('作用于', 'acts on')}：${on}` : ''}`;
        g += `<rect x="${p.x}" y="${my}" width="${p.w}" height="18" rx="4" class="${isRef(id) ? 'ub' : 'asm'}" data-tip="${esc(tip)}"/><text x="${p.x + 7}" y="${my + 13}" class="tiny" pointer-events="none">${esc(label)}</text>`;
      });
      if (r.actsLines.length) g += lines(cols.mech, y + 10 + r.chipLines * 22 + 12, r.actsLines, 'm', 11);
      const s = share(l), bw = 130;
      g += `<rect x="${cols.bar}" y="${y + 20}" width="${bw}" height="12" rx="3" style="fill:var(--grid)"/><rect x="${cols.bar}" y="${y + 20}" width="${Math.max(1.5, bw * s)}" height="12" rx="3" style="fill:var(--s2)"/>`;
      g += `<text x="${cols.bar}" y="${y + 50}" class="sb">${esc(`${fmt(s * 100, 1)} %`)}</text><text x="${cols.bar + 46}" y="${y + 50}" class="m">${esc(`${fmt(tN[l].c, 1)} s/h`)}</text><text x="${cols.bar}" y="${y + 63}" class="m">${esc(T(`走全局恢复 ${fmt((Z.endsToday[l].global ?? 0) * 100)} %`, `${fmt((Z.endsToday[l].global ?? 0) * 100)} % end in global recovery`))}</text>`;
      y += r.h;
    });
    const lg = legend(x0, top + bodyH + 14, [{ cls: 'cab', label: T('故障类（悬停看每实例 FIT）', 'fault class (hover: FIT per instance)') }, { cls: 'ub', label: T('ReMAP 参考机制（六项）', 'ReMAP reference mechanism (six)') }, { cls: 'asm', label: T('基线恢复（检测、R-CKPT、R-MANUAL、隔离）', 'baseline recovery (detection, R-CKPT, R-MANUAL, isolation)') }, { style: 'fill:var(--s2)', label: T('该层占硬中断停机（名义）', 'level’s share of hard-interruption downtime (nominal)') }]);
    g += lg.g;
    g += lines(x0, lg.y + 18, wrap(T('层级取 ReMAP 目录自带的影响范围（card → NPU，server → 节点，rack → 计算柜，job → 集群）；FABRIC 与 OPT（UB 交换与光链路）在 Atlas 950 中跨 1,024 卡 UB 域，单列为超节点级。每类事件只归一层（ReMAP 架构规则）。', 'Levels follow the ReMAP catalog’s own scope (card → NPU, server → node, rack → compute cabinet, job → cluster); FABRIC and OPT (UB switching and its optics) span the 1,024-NPU UB domain of the Atlas 950 and form the SuperPoD level. Each event sits on exactly one level (ReMAP’s architecture rule).'), W - 28, 9.8), 'm', 12);
    return g + '</g></svg>';
  }

  /* ---------------- Figure 2: mechanism × level heatmap (pause removed, s/h) ---------------- */
  function figHeat() {
    const rows = [...R.mechanisms.map((m) => ({ id: m.id, kind: 'ref', by: sh.gains[m.id].byLevel, aOp: sh.gains[m.id].aOp })),
      { id: 'levers', kind: 'lever', by: Object.fromEntries(LV.map((l) => [l, (tN[l].c + tN[l].iso + tN[l].sdc) - (dec.leversNominal[l].c + dec.leversNominal[l].iso + dec.leversNominal[l].sdc)])), aOp: null }];
    const W = 960, labelW = 300, colW = 92, aW = 96, rowH = 26;
    const head = titleBlock(T(`图 2：每个参考机制去掉哪一层的停机（${kN(R.main)}，秒 / 小时，精确 Shapley，64 个组合；最右为对 A_op 的 Shapley，百分点）`, `Figure 2: whose downtime each reference mechanism removes (${kN(R.main)}, seconds per hour, exact Shapley over 64 coalitions; right: Shapley on A_op, points)`));
    const Tp = 52 + head.dy;
    const H = Tp + rows.length * rowH + 70;
    const vmax = Math.max(...rows.flatMap((r) => LV.map((l) => Math.abs(r.by[l]))));
    const cls = (v) => { if (Math.abs(v) < 0.05) return 'hm0'; const k = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.abs(v) / vmax) * 4))); return (v > 0 ? 'h' : 'n') + k; };
    let g = svgOpen('fig-heat', W, H, T('机制与层级', 'Mechanisms by level')).replace('class="viz"', 'class="viz hm"') + HM_STYLE + head.svg;
    const x0 = 14;
    g += `<text x="${x0}" y="${Tp - 10}" class="m">${esc(T('机制（部署层）', 'Mechanism (deployed at)'))}</text>`;
    const SHORT = { cluster: T('集群', 'Cluster'), superpod: T('超节点', 'SuperPoD'), cabinet: T('计算柜（Pod）', 'Cabinet (Pod)'), node: T('节点', 'Node'), npu: 'NPU' };
    LV.forEach((l, j) => { g += `<text x="${x0 + labelW + j * colW + colW / 2}" y="${Tp - 10}" text-anchor="middle" class="t2">${esc(SHORT[l])}</text>`; });
    g += `<text x="${x0 + labelW + LV.length * colW + aW / 2}" y="${Tp - 10}" text-anchor="middle" class="t2">A_op Shapley</text>`;
    rows.forEach((r, i) => {
      const y = Tp + i * rowH;
      const name = r.kind === 'ref' ? `${r.id} · ${MECH[r.id].name[lang]}` : T('R-CKPT / R-MANUAL（方案 ③ 的杠杆）', 'R-CKPT / R-MANUAL (plan ③ levers)');
      const at = r.kind === 'ref' ? LN[dep[r.id].level] : LN.cluster;
      g += `<text x="${x0}" y="${y + rowH / 2 + 4}" class="t2" style="font-size:10.6px">${esc(name.length > 40 ? name.slice(0, 39) + '…' : name)} <tspan class="m">（${esc(at)}）</tspan></text>`;
      LV.forEach((l, j) => {
        const v = r.by[l], c = cls(v), x = x0 + labelW + j * colW;
        const tip = `${r.kind === 'ref' ? r.id : T('恢复杠杆', 'recovery levers')} · ${LN[l]}|${T('去掉的停机', 'downtime removed')} ${v >= 0 ? '' : '−'}${fmt(Math.abs(v), 2)} s/h${r.kind === 'ref' ? `|${T('部署层', 'deployed at')} ${LN[dep[r.id].level]}` : `|${T('今天 → 方案 ③ 的杠杆（名义）', 'today → plan ③ levers (nominal)')}`}`;
        g += `<rect x="${x + 1}" y="${y + 1}" width="${colW - 2}" height="${rowH - 2}" style="fill:var(--${c})" data-tip="${esc(tip)}"/>`;
        const dark = c === 'h3' || c === 'h4' || c === 'n3' || c === 'n4';
        g += `<text x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="cellt${dark ? ' onDark' : ''}" pointer-events="none">${Math.abs(v) < 0.05 ? '0' : `${v >= 0 ? '' : '−'}${fmt(Math.abs(v), 1)}`}</text>`;
      });
      g += `<text x="${x0 + labelW + LV.length * colW + aW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle" class="t2">${esc(r.aOp === null ? '—' : `${sgnPt(r.aOp)} pt`)}</text>`;
    });
    const ly = Tp + rows.length * rowH + 16, sx = x0 + 64;
    ['n4', 'n3', 'n2', 'n1', 'hm0', 'h1', 'h2', 'h3', 'h4'].forEach((c, i) => { g += `<rect x="${sx + i * 26}" y="${ly}" width="24" height="12" style="fill:var(--${c})"/>`; });
    g += `<text x="${sx - 6}" y="${ly + 10}" text-anchor="end" class="m">${esc(T('增加停机', 'adds'))}</text><text x="${sx + 9 * 26 + 6}" y="${ly + 10}" class="m">${esc(T(`去掉停机（最大 ${fmt(vmax, 0)} s/h；色阶按 √|值|）`, `removes downtime (max ${fmt(vmax, 0)} s/h; steps by √|value|)`))}</text>`;
    g += lines(x0, ly + 34, wrap(T(`集群级与计算柜级（共 ${fmt(unaddressed * 100)} % 的停机）没有任何参考机制的快速恢复梯级，只能靠基线的检测与全局恢复（R-CKPT / R-MANUAL）——即最后一行的恢复杠杆；D-SDC 单独会增加停机（每次检出走一次恢复），与 R-SDC 合用接近持平；C-FAST 改善有效产出，不改 A_op。`, `The cluster and cabinet levels (${fmt(unaddressed * 100)} % of the downtime) have no fast recovery rung from any reference mechanism: only the baseline detection and global recovery (R-CKPT / R-MANUAL) reach them — the recovery levers of the last row. D-SDC alone adds downtime (each detection triggers a recovery) and nets out with R-SDC; C-FAST improves goodput, not A_op.`), W - 28, 9.8), 'm', 12);
    return g + '</svg>';
  }

  /* ---------------- Figure 3: per-level ledger (derated, the binding side) ---------------- */
  function figLedger() {
    const W = 960, x0 = 170, x1 = 900, top = 50, rowH = 34;
    const items = [...LV.map((l) => ({ id: l, name: LN[l], t: tD[l].c, lev: dec.leversDerated[l].c, fin: dec.finalDerated[l].c })),
      { id: 'other', name: T('其他事件类（隔离、静默检出）', 'Other event classes (isolation, detected SDC)'), t: Z.today.levelsDerated ? LV.reduce((a, l) => a + tD[l].iso + tD[l].sdc, 0) : 0, lev: LV.reduce((a, l) => a + dec.leversDerated[l].iso + dec.leversDerated[l].sdc, 0), fin: LV.reduce((a, l) => a + dec.finalDerated[l].iso + dec.finalDerated[l].sdc, 0) }];
    const max = Math.max(...items.map((x) => x.t));
    const X = (v) => x0 + (v / max) * (x1 - x0);
    const head = titleBlock(T(`图 3：每层的停机预算怎样凑出来（${kN(R.main)}，降额口径，秒 / 小时）：今天 → 恢复杠杆（R-CKPT / R-MANUAL）→ ARINC 硬件 ×${fmt(x3, 3)}`, `Figure 3: how each level reaches its budget (${kN(R.main)}, derated, seconds per hour): today → recovery levers (R-CKPT / R-MANUAL) → ARINC hardware ×${fmt(x3, 3)}`));
    const H = top + items.length * rowH + 50 + head.dy;
    let g = svgOpen('fig-ledger', W, H, T('分层预算账', 'Level ledger')) + head.svg + `<g transform="translate(0 ${head.dy})">`;
    for (const v of [0, 20, 40, 60]) if (v <= max) g += `<line x1="${X(v)}" y1="${top - 8}" x2="${X(v)}" y2="${top + items.length * rowH - 6}" class="grid"/><text x="${X(v)}" y="${top - 12}" class="m" text-anchor="middle">${v}</text>`;
    items.forEach((it, i) => {
      const y = top + i * rowH;
      g += lines(x0 - 10, y + 14, wrap(it.name, x0 - 24, 9.8).slice(0, 2), 's', 11, 'end');
      const tip = `${it.name}|${T('今天（降额）', 'today (derated)')} ${fmt(it.t, 2)} s/h → ${T('杠杆后', 'after levers')} ${fmt(it.lev, 2)} → ${T('最终', 'final')} ${fmt(it.fin, 2)} s/h`;
      const seg = (a, b, style, label) => (b - a > 0 ? `<rect x="${X(a)}" y="${y}" width="${Math.max(1, X(b) - X(a) - 2)}" height="20" rx="3" style="${style}" data-tip="${esc(tip)}"/>${X(b) - X(a) > 52 ? `<text x="${(X(a) + X(b)) / 2 - 1}" y="${y + 14}" class="tiny" text-anchor="middle" style="fill:var(--surface);font-weight:600">${esc(label)}</text>` : ''}` : '');
      g += seg(0, it.fin, 'fill:var(--axis)', `${T('预算', 'budget')} ${fmt(it.fin, 1)}`);
      g += seg(it.fin, it.lev, 'fill:var(--s2)', `${T('硬件', 'hw')} ${fmt(it.lev - it.fin, 1)}`);
      g += seg(it.lev, it.t, 'fill:var(--s1)', `${T('杠杆', 'levers')} ${fmt(it.t - it.lev, 1)}`);
      g += `<text x="${X(it.t) + 6}" y="${y + 14}" class="tiny">${esc(fmt(it.t, 1))}</text><rect x="0" y="${y - 4}" width="${W}" height="${rowH - 2}" fill="transparent" data-tip="${esc(tip)}"/>`;
    });
    const lg = legend(x0, top + items.length * rowH + 14, [{ style: 'fill:var(--s1)', label: T('恢复杠杆去掉的', 'removed by the recovery levers') }, { style: 'fill:var(--s2)', label: T(`ARINC 硬件去掉的（×${fmt(x3, 3)}）`, `removed by ARINC hardware (×${fmt(x3, 3)})`) }, { style: 'fill:var(--axis)', label: T('留下的 = 该层预算', 'what remains = the level’s budget') }]);
    g += lg.g;
    return g + '</g></svg>';
  }

  /* ---------------- tables ---------------- */
  // T1 mapping of the 18 domains
  const flags = (d) => { const e = R.events.find((x) => x.domainId === d && x.type === 'hard'); return ['replay', 'process', 'elastic'].filter((k) => e[k]).map((k) => ({ replay: 'R-REPLAY', process: 'R-PROCESS', elastic: 'R-ELASTIC' })[k]); };
  const fitOf = (d, t) => R.events.find((x) => x.domainId === d && x.type === t)?.fit ?? 0;
  const t1rows = LV.map((l) => lvl[l].domains.map((d, j) => {
    const e = R.events.find((x) => x.domainId === d && x.type === 'hard');
    const f = flags(d);
    return `<tr>${j === 0 ? `<td class="b" rowspan="${lvl[l].domains.length}">${esc(LN[l])}</td>` : ''}<td><b>${esc(d)}</b> ${esc(domainName(d))}</td><td>${esc(e.scope)}</td><td class="num">${fmt(fitOf(d, 'hard'), 1)}</td><td class="num">${fmt(fitOf(d, 'slow'), 2)}</td><td class="num">${fmt(fitOf(d, 'sdc'), 2)}</td><td class="num">${fmt(fitOf(d, 'hard') * (l === 'cluster' ? R.main : lvl[l].cardsPer))}</td><td>${esc(f.length ? f.join(' · ') : T('无（直接全局恢复）', 'none (straight to global recovery)'))}</td></tr>`;
  }).join('')).join('');
  const table1 = `<div class="table-wrap"><table class="l1"><thead><tr><th>${esc(T('层级', 'Level'))}</th><th>${esc(T('故障域（ReMAP 目录）', 'Fault domain (ReMAP catalog)'))}</th><th>ReMAP scope</th><th class="num">${esc(T('硬中断 FIT / 卡', 'Hard FIT per card'))}</th><th class="num">${esc(T('亚健康 FIT / 卡', 'Sub-health FIT per card'))}</th><th class="num">${esc(T('静默 FIT / 卡', 'Silent FIT per card'))}</th><th class="num">${esc(T('硬中断 FIT / 本层实例', 'Hard FIT per instance'))}</th><th>${esc(T('可用的快速恢复梯级', 'Fast recovery rungs available'))}</th></tr></thead><tbody>${t1rows}</tbody></table></div>`;

  // T2 diagnosis today by level
  const t2rows = LV.map((l) => {
    const v = tN[l], d = tD[l], e = Z.endsToday[l];
    const inst = Z.instances[l];
    const perInstYear = (v.lam / inst) * 8760;
    const endsStr = [['replay', T('重执行', 'replay')], ['elastic', T('弹性', 'elastic')], ['process', T('进程', 'process')], ['global', T('全局', 'global')]].filter(([k]) => (e[k] ?? 0) > 0.0005).map(([k, n]) => `${n} ${fmt(e[k] * 100)} %`).join(' · ');
    return `<tr><td class="b">${esc(LN[l])}</td><td class="num">${fmt(inst)}</td><td class="num">${fmt(v.lam * 24, 2)}</td><td class="num">${fmt(perInstYear, perInstYear < 1 ? 3 : 2)}</td><td class="num">${esc(yrs(inst / v.lam))}</td><td class="num">${fmt(v.c / v.lam, 1)} s</td><td class="num">${fmt(v.c, 1)} / ${fmt(d.c, 1)}</td><td class="num${share(l) > 0.3 ? ' bad' : ''}">${fmt(share(l) * 100, 1)} %</td><td>${esc(endsStr)}</td><td class="num">${fmt(v.iso + v.sdc, 2)}</td></tr>`;
  }).join('');
  const other = Z.today.other;
  const t2sum = `<tr class="sum b"><td>${esc(T('合计', 'Total'))}</td><td></td><td class="num">${fmt(LV.reduce((a, l) => a + tN[l].lam, 0) * 24, 1)}</td><td></td><td class="num">${esc(T(`集群 ${fmt(Z.today.mtbfHwH * 60)} min`, `cluster ${fmt(Z.today.mtbfHwH * 60)} min`))}</td><td class="num">${fmt(Z.today.mttrS, 1)} s</td><td class="num">${fmt(sumC, 1)} / ${fmt(Z.budget.sumCDerated, 1)}</td><td class="num">100 %</td><td></td><td class="num">${fmt(other[0].sPerH + other[1].sPerH, 2)}</td></tr>`;
  const table2 = `<div class="table-wrap"><table class="l2"><thead><tr><th>${esc(T('层级', 'Level'))}</th><th class="num">${esc(T('实例数', 'Instances'))}</th><th class="num">${esc(T('硬中断 / 天（全集群）', 'Hard interruptions per day (cluster)'))}</th><th class="num">${esc(T('每实例每年', 'Per instance per year'))}</th><th class="num">${esc(T('每实例 MTBF', 'MTBF per instance'))}</th><th class="num">${esc(T('每次平均暂停', 'Mean pause'))}</th><th class="num">${esc(T('停机 s/h 名义 / 降额', 'Downtime s/h nominal / derated'))}</th><th class="num">${esc(T('停机份额', 'Downtime share'))}</th><th>${esc(T('恢复去向（六个参考机制）', 'Where recovery ends (six reference mechanisms)'))}</th><th class="num">${esc(T('另：隔离 + 静默检出 s/h', 'Also: isolation + detected SDC s/h'))}</th></tr></thead><tbody>${t2rows}${t2sum}</tbody></table></div>`;

  // T3 allocation per level and plan
  const levelRows = (r) => Object.fromEntries(LV.map((l) => [l, r.hardware.rows.filter((h) => h.level === l)]));
  const p1a = levelRows(Z.p1.arinc), p1e = levelRows(Z.p1.minEffort), p3a = levelRows(Z.p3.arinc), p3e = levelRows(Z.p3.minEffort);
  const sumFit = (rows, k) => rows.reduce((a, h) => a + h[k], 0);
  const effStr = (rows) => rows.filter((h) => h.factor < 0.9995).sort((a, b) => a.factor - b.factor).map((h) => `${h.id.replace('-hard', '')} ×${fmt(h.factor, 2)}`).join(', ') || T('不动', 'unchanged');
  const t3rows = LV.map((l) => {
    const cur = sumFit(p1a[l], 'currentFit');
    const inst = l === 'cluster' ? R.main : lvl[l].cardsPer;
    return `<tr><td class="b">${esc(LN[l])}</td><td class="num">${fmt(cur, 1)}</td><td class="num">${fmt(sumFit(p1a[l], 'allowedFit'), 1)}<br><span class="m">${esc(T(`每个 ${fmt(sumFit(p1a[l], 'allowedFit') * inst)}`, `${fmt(sumFit(p1a[l], 'allowedFit') * inst)} per inst.`))}</span></td><td class="w">${esc(effStr(p1e[l]))}</td><td class="w">${esc(l === 'cluster' ? T(`检测 10 → ${fmt(10 * g2, 1)} s、超时 60 → ${fmt(60 * g2, 1)} s；自动 180 → ${fmt(180 * g2)} s；人工 2 h → ${fmt(7200 * g2 / 60)} min`, `detection 10 → ${fmt(10 * g2, 1)} s, timeout 60 → ${fmt(60 * g2, 1)} s; automatic 180 → ${fmt(180 * g2)} s; manual 2 h → ${fmt(7200 * g2 / 60)} min`) : T(`经全局恢复受益（${fmt((Z.endsToday[l].global ?? 0) * 100)} % 走全局）`, `benefits through the global recovery (${fmt((Z.endsToday[l].global ?? 0) * 100)} % go global)`))}</td><td class="num b">${fmt(sumFit(p3a[l], 'allowedFit'), 1)}<br><span class="m">${esc(T(`每个 ${fmt(sumFit(p3a[l], 'allowedFit') * inst)}`, `${fmt(sumFit(p3a[l], 'allowedFit') * inst)} per inst.`))}</span></td><td class="w">${esc(effStr(p3e[l]))}</td><td class="num">${fmt(dec.finalDerated[l].c, 1)} / ${fmt(dec.finalNominal[l].c, 1)}</td></tr>`;
  }).join('');
  const table3 = `<div class="table-wrap"><table class="l3"><thead>
    <tr><th rowspan="2">${esc(T('层级', 'Level'))}</th><th rowspan="2" class="num">${esc(T('今天 FIT / 卡', 'Today FIT per card'))}</th><th colspan="2" class="c">${esc(T(`① 只靠硬件（六个机制不变）`, '① Hardware alone (six mechanisms unchanged)'))}</th><th class="c">${esc(T('② 只靠恢复链（硬件不变）', '② Recovery chain alone (hardware unchanged)'))}</th><th colspan="2" class="c">${esc(T(`③ 最省力组合：${p3Set} + 硬件`, `③ Least-effort mix: ${p3Set} + hardware`))}</th><th rowspan="2" class="num">${esc(T('③ 该层停机预算 s/h 降额 / 名义', '③ Level downtime budget s/h derated / nominal'))}</th></tr>
    <tr><th class="num">${esc(T(`ARINC ×${fmt(x1, 3)}：允许 FIT / 卡`, `ARINC ×${fmt(x1, 3)}: allowed FIT per card`))}</th><th>${esc(T('等权拆分（AGREE = 最小努力）', 'Equal-weight split (AGREE = minimum effort)'))}</th><th>${esc(T(`HAC-D 恢复系数 g = ${fmt(g2, 3)}`, `HAC-D recovery factor g = ${fmt(g2, 3)}`))}</th><th class="num">${esc(T(`ARINC ×${fmt(x3, 3)}：允许 FIT / 卡`, `ARINC ×${fmt(x3, 3)}: allowed FIT per card`))}</th><th>${esc(T('最小努力拆分', 'Minimum-effort split'))}</th></tr></thead><tbody>${t3rows}</tbody></table></div>`;

  // T4 mechanism requirements per level (plan ③)
  const lim = Object.fromEntries(Z.p3.limits.map((x) => [`${x.id}.${x.key}`, x]));
  const limStr = (id, key, unit) => { const x = lim[`${id}.${key}`]; if (!x) return '—'; if (!x.binding) return T('任意（不约束）', 'any (not binding)'); return `${x.dir === 'down' ? '≥' : '≤'} ${fmt(x.limit, unit === '%' ? 3 : 1)}${unit === 's' ? ' s' : ''}`; };
  const mechReq = [
    ['npu', 'R-REPLAY', T('成功 0.9，成功耗时 5 s，失败 10 s', 'success 0.9, 5 s on success, 10 s on failure'), T('成功 0.82，7.5 s，15 s', 'success 0.82, 7.5 s, 15 s'), T(`成功 ${limStr('R-REPLAY', 'success', '%')}；成功耗时 ${limStr('R-REPLAY', 'successSeconds', 's')}`, `success ${limStr('R-REPLAY', 'success', '%')}; time on success ${limStr('R-REPLAY', 'successSeconds', 's')}`)],
    ['npu', 'D-SDC + R-SDC', T('即时检出 95 %，1 s；step 重算 1 s + 恢复 1 s', '95 % detected in 1 s; 1 s step redo + 1 s recovery'), T('90 %，1.5 s；1.5 s + 1.5 s', '90 %, 1.5 s; 1.5 s + 1.5 s'), T('A_op 几乎不受影响（保有效产出）', 'A_op hardly affected (they protect goodput)')],
    ['node', 'R-PROCESS', T('成功 0.95，60 s，失败 120 s', 'success 0.95, 60 s, 120 s on failure'), T('0.87，90 s，180 s', '0.87, 90 s, 180 s'), T(`成功 ${limStr('R-PROCESS', 'success', '%')}；耗时 ${limStr('R-PROCESS', 'successSeconds', 's')}`, `success ${limStr('R-PROCESS', 'success', '%')}; time ${limStr('R-PROCESS', 'successSeconds', 's')}`)],
    ['cluster', 'R-ELASTIC', T('50 个 DP 域，成功 0.98，同步暂停 1 s，失败 120 s', '50 DP domains, success 0.98, 1 s resync pause, 120 s on failure'), T('0.90，1.5 s，180 s', '0.90, 1.5 s, 180 s'), T(`成功 ${limStr('R-ELASTIC', 'success', '%')}；同步暂停 ${limStr('R-ELASTIC', 'syncSeconds', 's')}；失败耗时 ${limStr('R-ELASTIC', 'failureSeconds', 's')}`, `success ${limStr('R-ELASTIC', 'success', '%')}; resync ${limStr('R-ELASTIC', 'syncSeconds', 's')}; failure ${limStr('R-ELASTIC', 'failureSeconds', 's')}`)],
    ['cluster', 'C-FAST', T('CKPT 周期 60 s，阻塞 1 s', '60 s checkpoint period, 1 s blocking'), T('阻塞 1.5 s', '1.5 s blocking'), T('不影响 A_op（影响有效产出）', 'no A_op effect (goodput only)')],
    ['cluster', 'R-CKPT / R-MANUAL', T(`自动尝试 ${fmt(dec.recovery.automatic.seconds)} s、成功 ${fmt(dec.recovery.automatic.successProbability * 100)} %；人工 ${fmt(dec.recovery.manual.seconds / 60)} min（方案 ③ 的杠杆）`, `automatic attempt ${fmt(dec.recovery.automatic.seconds)} s at ${fmt(dec.recovery.automatic.successProbability * 100)} %; manual ${fmt(dec.recovery.manual.seconds / 60)} min (plan ③ levers)`), T('90 s；45 min（时间 ×1.5）', '90 s; 45 min (times ×1.5)'), T('即方案 ③ 的设定值（降额后正好 98.5 %）', 'the settings of plan ③ (derated: exactly 98.5 %)')],
    ['cluster', T('检测（基线）', 'Detection (baseline)'), T('95 % 在 10 s，其余 60 s 超时', '95 % in 10 s, the rest by a 60 s timeout'), T('不降额（基线）', 'not derated (baseline)'), T(`方案 ② 时须 ×${fmt(g2, 2)}`, `×${fmt(g2, 2)} in plan ②`)],
  ];
  const table4 = `<div class="table-wrap"><table class="l4"><thead><tr><th>${esc(T('层级', 'Level'))}</th><th>${esc(T('机制', 'Mechanism'))}</th><th>${esc(T('分配的参数（名义 = 要求）', 'Allocated parameters (nominal = requirement)'))}</th><th>${esc(T('降额核验值（方案 ③ 仍须 ≥ 98.5 %）', 'Derated check value (plan ③ must still meet 98.5 %)'))}</th><th>${esc(T('单项放宽上限（其余名义，方案 ③ 硬件与杠杆）', 'Single-parameter acceptance limit (others nominal, plan ③ hardware and levers)'))}</th></tr></thead><tbody>${mechReq.map((r) => `<tr><td class="b">${esc(LN[r[0]])}</td><td class="b">${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('')}</tbody></table></div>`;

  // T5 acceptance per instance (plan ③ ARINC)
  const t5rows = LV.map((l) => {
    const inst = l === 'cluster' ? R.main : lvl[l].cardsPer;
    const allowed = sumFit(p3a[l], 'allowedFit') * inst;
    const today = sumFit(p3a[l], 'currentFit') * inst;
    return `<tr><td class="b">${esc(LN[l])}</td><td class="num">${fmt(today)}</td><td class="num b">${fmt(allowed)}</td><td class="num">${fmt((allowed * 8760) / 1e9, allowed * 8760 / 1e9 < 1 ? 3 : 1)}</td><td class="num">${esc(yrs(1e9 / allowed))}</td><td>${esc(l === 'cluster' ? T('作业级共享服务（存储、调度、未归因软件）合计', 'job-level shared services (storage, scheduling, unattributed software) in total') : l === 'superpod' ? T('一个超节点的 UB 交换（柜内 LRS + 超节点层）与光链路', 'one SuperPoD’s UB switching (in-cabinet LRS + pod tier) and optics') : l === 'cabinet' ? T('一个计算柜的供电、液冷、管理、框内 IO', 'one compute cabinet’s power, cooling, management, in-chassis IO') : l === 'node' ? T('一个节点的 CPU、DDR、SSD、网卡', 'one node’s CPUs, DDR, SSD, NIC') : T('一张 NPU（计算、SRAM、IO Die、HBM、模组）', 'one NPU (compute, SRAM, IO die, HBM, module)'))}</td></tr>`;
  }).join('');
  const table5 = `<div class="table-wrap"><table class="l5"><thead><tr><th>${esc(T('验收对象', 'Acceptance object'))}</th><th class="num">${esc(T('今天 FIT / 实例', 'Today FIT per instance'))}</th><th class="num">${esc(T(`允许 FIT / 实例（③ ×${fmt(x3, 3)}）`, `Allowed FIT per instance (③ ×${fmt(x3, 3)})`))}</th><th class="num">${esc(T('允许硬中断 / 实例 · 年', 'Allowed hard interruptions per instance-year'))}</th><th class="num">${esc(T('对应 MTBF / 实例', 'Matching MTBF per instance'))}</th><th>${esc(T('包含', 'Contains'))}</th></tr></thead><tbody>${t5rows}</tbody></table></div>`;

  // T6 cross-size summary
  const t6rows = R.sizes.map((n) => {
    const z = R.perSize[String(n)];
    const p1 = z.p1.arinc, p3 = z.p3.arinc;
    const x1n = p1.hardware.needed ? `×${fmt(Math.min(...p1.hardware.rows.map((h) => h.factor)), 3)}` : T(`余量 ×${fmt(p1.hardware.slackFactor, 2)}`, `slack ×${fmt(p1.hardware.slackFactor, 2)}`);
    const plan = p3.levers.length || p3.hardware.needed ? `${p3.levers.map((id) => levName[id]).join(' + ') || ''}${p3.hardware.needed ? `${p3.levers.length ? ' + ' : ''}${T('硬件', 'hardware')} ×${fmt(Math.min(...p3.hardware.rows.map((h) => h.factor)), 3)}` : ''}` : T('无需改动', 'nothing needed');
    return `<tr><td class="b nw">${esc(kN(n))}</td><td class="num">${pct(z.today.aOp, 3)} / ${pct(z.today.aOpDerated, 3)}</td><td class="num">${fmt(z.budget.derated, 1)} / ${fmt(z.budget.sumCDerated, 1)}</td><td class="num">${esc(x1n)}</td><td class="num">${esc(Number.isFinite(z.p2.factor) && z.p2.factor < 1 ? `g = ${fmt(z.p2.factor, 3)}` : T('无需', 'not needed'))}</td><td>${esc(plan)}</td><td class="num">${pct(p3.final.value, 2)} / ${pct(p3.final.derated, 2)}</td><td class="num">${p3.verification ? `${fmt(p3.verification.pAtLeastTarget * 100, 1)} % · ${p3.verification.verdict}` : '—'}</td></tr>`;
  }).join('');
  const table6 = `<div class="table-wrap"><table class="l6"><thead><tr><th>${esc(T('规模', 'Size'))}</th><th class="num">${esc(T('今天 A_op 名义 / 降额', 'Today A_op nominal / derated'))}</th><th class="num">${esc(T('预算 B / 今天 Σc（降额，s/h）', 'Budget B / today Σc (derated, s/h)'))}</th><th class="num">${esc(T('① 只靠硬件', '① Hardware alone'))}</th><th class="num">${esc(T('② 只靠恢复链', '② Recovery chain alone'))}</th><th>${esc(T('③ 最省力组合', '③ Least-effort mix'))}</th><th class="num">${esc(T('③ A_op 名义 / 降额', '③ A_op nominal / derated'))}</th><th class="num">${esc(T(`③ 逐窗口 P(≥ 98.5 %)（${R.trials} 窗）`, `③ per window P(≥ 98.5 %) (${R.trials})`))}</th></tr></thead><tbody>${t6rows}</tbody></table></div>`;

  const keyFindings = [
    T(`<b>能映射</b>：把 ReMAP 目录的 54 类事件按其自带影响范围放到 Atlas 950 的五层——NPU（${fmt(levelFitCard('npu'), 0)} FIT / 卡）、节点（${fmt(levelFitCard('node'), 0)}）、计算柜 / Pod（${fmt(levelFitCard('cabinet'), 0)}）、超节点（${fmt(levelFitCard('superpod'), 0)}）、集群（${fmt(levelFitCard('cluster'), 0)}），合计 3,333 FIT / 卡，与仓库一致；六个参考机制按部署位置归层：R-REPLAY、D-SDC、R-SDC 在 NPU 级，R-PROCESS 在节点级，R-ELASTIC、C-FAST 与基线恢复（检测、R-CKPT、R-MANUAL、隔离）在集群级。`, `<b>It maps</b>: the 54 events of the ReMAP catalog fall on the five Atlas 950 levels by their own scope — NPU (${fmt(levelFitCard('npu'), 0)} FIT per card), node (${fmt(levelFitCard('node'), 0)}), compute cabinet / Pod (${fmt(levelFitCard('cabinet'), 0)}), SuperPoD (${fmt(levelFitCard('superpod'), 0)}), cluster (${fmt(levelFitCard('cluster'), 0)}), 3,333 FIT per card in total as in the repositories; the six reference mechanisms sit where they are deployed: R-REPLAY, D-SDC and R-SDC at the NPU level, R-PROCESS at the node level, R-ELASTIC, C-FAST and the baseline recovery (detection, R-CKPT, R-MANUAL, isolation) at the cluster level.`),
    T(`<b>作用层与部署层不同</b>：集群级的 R-ELASTIC 去掉的是 NPU 级与节点级的停机（${kN(R.main)}时 ${fmt(sh.gains['R-ELASTIC'].byLevel.npu, 0)} + ${fmt(sh.gains['R-ELASTIC'].byLevel.node, 0)} s/h），R-PROCESS 与 R-REPLAY 也只作用于 NPU、节点（与超节点的光链路）。<b>集群级与计算柜级占今天停机的 ${fmt(unaddressed * 100)} %，没有任何参考机制的快速梯级</b>——只能靠基线的检测与全局恢复，或硬件。`, `<b>Where a mechanism acts is not where it sits</b>: the cluster-level R-ELASTIC removes NPU- and node-level downtime (${fmt(sh.gains['R-ELASTIC'].byLevel.npu, 0)} + ${fmt(sh.gains['R-ELASTIC'].byLevel.node, 0)} s/h at ${kN(R.main)}); R-PROCESS and R-REPLAY also act only on NPU and node events (and the SuperPoD optics). <b>The cluster and cabinet levels carry ${fmt(unaddressed * 100)} % of today’s downtime and no reference mechanism has a fast rung for them</b> — only the baseline detection and global recovery, or hardware.`),
    T(`<b>${kN(R.main)}、A_op ≥ 98.5 %（名义与降额）</b>：今天 ${pct(Z.today.aOp, 2)} / ${pct(Z.today.aOpDerated, 2)}，每小时只允许 ${fmt(Z.budget.derated, 1)} s 暂停（今天 ${fmt(Z.budget.sumCDerated, 1)} s）。① 只靠硬件：每类 FIT × ${fmt(x1, 3)}；② 只靠恢复链：检测、自动尝试、人工时间都要 × ${fmt(g2, 2)}（自动尝试 ${fmt(180 * g2)} s）；③ 最省力：${p3Set}，再加硬件 ARINC × ${fmt(x3, 3)}——名义 ${pct(Z.p3.arinc.final.value, 2)}、降额正好 98.50 %，${R.trials} 个 30 天窗口${Z.p3.arinc.verification.pAtLeastTarget >= 1 ? '全部' : ` ${fmt(Z.p3.arinc.verification.pAtLeastTarget * 100, 1)} %`}达标。`, `<b>${kN(R.main)}, A_op ≥ 98.5 % (nominal and derated)</b>: today ${pct(Z.today.aOp, 2)} / ${pct(Z.today.aOpDerated, 2)}; the budget is ${fmt(Z.budget.derated, 1)} s of pause per hour (today ${fmt(Z.budget.sumCDerated, 1)} s). ① Hardware alone: every class’s FIT × ${fmt(x1, 3)}; ② recovery chain alone: detection, automatic attempt and manual times all × ${fmt(g2, 2)} (automatic attempt ${fmt(180 * g2)} s); ③ least effort: ${p3Set}, then ARINC hardware × ${fmt(x3, 3)} — ${pct(Z.p3.arinc.final.value, 2)} nominal, exactly 98.50 % derated, ${Z.p3.arinc.verification.pAtLeastTarget >= 1 ? 'all' : `${fmt(Z.p3.arinc.verification.pAtLeastTarget * 100, 1)} % of the`} ${R.trials} 30-day windows meet it.`),
    T(`<b>每层的分配结果（方案 ③，表 3–5）</b>：每个超节点的超节点级硬件 ≤ ${fmt(sumFit(p3a.superpod, 'allowedFit') * 1024)} FIT（MTBF ≥ ${yrs(1e9 / (sumFit(p3a.superpod, 'allowedFit') * 1024))}），每个计算柜 ≤ ${fmt(sumFit(p3a.cabinet, 'allowedFit') * 64)} FIT（${yrs(1e9 / (sumFit(p3a.cabinet, 'allowedFit') * 64))}），每个节点 ≤ ${fmt(sumFit(p3a.node, 'allowedFit') * 8)} FIT，每张 NPU ≤ ${fmt(sumFit(p3a.npu, 'allowedFit'))} FIT；机制侧要求六个参考机制保持 ReMAP 的参数（降额后仍达标），集群级的自动尝试 ${fmt(dec.recovery.automatic.seconds)} s、人工 ${fmt(dec.recovery.manual.seconds / 60)} min。按最小努力拆分时，硬件任务集中在集群级（UNKNOWN、STORAGE）与计算柜级（POWER、MGMT、COOL）。`, `<b>Allocation at each level (plan ③, Tables 3–5)</b>: SuperPoD-level hardware ≤ ${fmt(sumFit(p3a.superpod, 'allowedFit') * 1024)} FIT per SuperPoD (MTBF ≥ ${yrs(1e9 / (sumFit(p3a.superpod, 'allowedFit') * 1024))}), ≤ ${fmt(sumFit(p3a.cabinet, 'allowedFit') * 64)} FIT per compute cabinet (${yrs(1e9 / (sumFit(p3a.cabinet, 'allowedFit') * 64))}), ≤ ${fmt(sumFit(p3a.node, 'allowedFit') * 8)} FIT per node, ≤ ${fmt(sumFit(p3a.npu, 'allowedFit'))} FIT per NPU; on the mechanism side the six reference mechanisms keep ReMAP’s parameters (still meeting the target derated) and the cluster-level automatic attempt is ${fmt(dec.recovery.automatic.seconds)} s, manual ${fmt(dec.recovery.manual.seconds / 60)} min. A minimum-effort split puts the hardware task on the cluster level (UNKNOWN, STORAGE) and the cabinet level (POWER, MGMT, COOL).`),
    T(`<b>其他规模</b>：1 万与 10 万卡已满足（硬件余量 ×${fmt(R.perSize['10000'].p1.arinc.hardware.slackFactor, 1)} 与 ×${fmt(R.perSize['100000'].p1.arinc.hardware.slackFactor, 2)}，表 3 的允许值是上限而非任务）；20 万卡只需把自动尝试压到 60 s（降额 ${pct(Z2.p3.arinc.final.derated, 2)}，逐窗口 ${fmt(Z2.p3.arinc.verification.pAtLeastTarget * 100, 1)} %，判定 ${Z2.p3.arinc.verification.verdict}）。口径：A_op = ReMAP 的“运行可用度”；FIT 为 ReMAP 每卡口径，每个实例的数 = 每卡 FIT × 实例卡数，只乘一次暴露量。`, `<b>Other sizes</b>: 10k and 100k already meet it (hardware slack ×${fmt(R.perSize['10000'].p1.arinc.hardware.slackFactor, 1)} and ×${fmt(R.perSize['100000'].p1.arinc.hardware.slackFactor, 2)}: the allowed values are ceilings, not tasks); 200k only needs the automatic attempt at 60 s (${pct(Z2.p3.arinc.final.derated, 2)} derated, ${fmt(Z2.p3.arinc.verification.pAtLeastTarget * 100, 1)} % of windows, verdict ${Z2.p3.arinc.verification.verdict}). 口径: A_op = ReMAP’s “operational availability”; FIT on ReMAP’s per-card basis, per-instance values = FIT per card × cards in the instance, exposure counted once.`),
  ];

  const css = BASE_CSS + `
  table.l1 td:nth-child(2) { min-width: 12em; } table.l2 td:nth-child(9) { min-width: 12em; } table.l3 td.w { min-width: 11em; white-space: normal; } table.l3 td:first-child, table.l2 td:first-child, table.l5 td:first-child { min-width: 7em; }
  table.l4 td:nth-child(3), table.l4 td:nth-child(4), table.l4 td:nth-child(5) { min-width: 12em; } table.l5 td:last-child { min-width: 16em; }
  @media screen and (max-width: 760px) { .table-wrap table.l3 { min-width: 980px; } }
  @media print { table.l3, table.l4 { font-size: 6.6px; } }
`;
  const sections = [
    `<div class="eyebrow">EYEBROW1</div>
  <h1>${esc(T('Atlas 950：可靠性机制按拓扑层级映射，以及每一层的硬件与机制分配', 'Atlas 950: reliability mechanisms mapped to topology levels, and the hardware and mechanism allocation at each level'))}</h1>
  <p class="sub">${T(`口径按要求限定：<b>故障率</b>只用 ReMAP / ai-cluster-reliability 的 54 类事件目录（每卡、NPU 等效业务影响 FIT，未做 HAC-D 的单元换算，也不加 scale-out 类比项）；<b>机制</b>只用 ReMAP 的参考机制集（<code>auditReferenceMechanisms</code> = D-SDC、R-SDC、R-REPLAY、R-PROCESS、R-ELASTIC、C-FAST，参数取 ReMAP 策略值）与 ReMAP 基线恢复（检测 95 % 在 10 s、其余 60 s；R-CKPT 自动 180 s、成功 99 %；R-MANUAL 2 h）；<b>分配方法</b>全部用 HAC-D 的（停机预算 B、ARINC / AGREE / 最小努力拆分、恢复系数、v4 最优策略与恢复杠杆、降额核验、窗口账本校核、Shapley）。Atlas 950 超节点（1,024 卡、每柜 64 卡、每节点 8 卡）给出层级与每层实例数。目标：一个同步训练作业 30 天窗口的 A_op ≥ 98.5 %，名义与全部机制降额（覆盖 −5 pt、成功 −8 pt、时间 ×1.5）都要满足；主算例 ${kN(R.main)}。`, `Scope as requested: <b>failure rates</b> only from the 54-event catalog of ReMAP / ai-cluster-reliability (business-impact FIT per card, NPU-equivalent; no HAC-D per-unit conversion, no scale-out analogue classes); <b>mechanisms</b> only ReMAP’s reference set (<code>auditReferenceMechanisms</code> = D-SDC, R-SDC, R-REPLAY, R-PROCESS, R-ELASTIC, C-FAST at ReMAP’s policy parameters) on ReMAP’s baseline recovery (detection 95 % in 10 s, the rest 60 s; R-CKPT automatic 180 s at 99 %; R-MANUAL 2 h); <b>allocation methods</b> all HAC-D’s (pause budget B, ARINC / AGREE / minimum-effort splits, the recovery factor, the v4 optimal strategy with recovery levers, derated check, window-ledger verification, Shapley). The Atlas 950 SuperPoD (1,024 NPUs, 64 per cabinet, 8 per node) gives the levels and the instances per level. Target: A_op ≥ 98.5 % for one synchronous training job over a 30-day window, nominally and with every mechanism derated (coverage −5 pt, success −8 pt, times ×1.5); main case ${kN(R.main)}.`)}</p>
  <div class="callout"><ul>${keyFindings.map((k) => `<li>${k}</li>`).join('')}</ul></div>
  <figure class="chart"><div class="scroll">${figLevels()}</div></figure>
  <h2>${esc(T(`1. 现状：每一层的中断、停机与恢复去向（${kN(R.main)}，表 1）`, `1. Today: interruptions, downtime and recovery by level (${kN(R.main)}, Table 1)`))}</h2>
  ${table2}
  <div class="formula">A_op = (1 − φ) / (1 + (Σ_ℓ C_ℓ + F) / 3600)　·　C_ℓ = Σ_{i∈ℓ} λᵢ · t̄ᵢ　·　λᵢ = N · FITᵢ(卡) · 10⁻⁹ /h　·　B = 3600 · ((1 − φ)/A* − 1) − F</div>
  <p class="note">${T('口径：事件 = 同步作业的硬中断；分母 = 集群·小时；层级 = 作业。每层 C_ℓ 为该层事件每小时造成的暂停秒数（中断率 × 机制链上的平均暂停），F 为亚健康隔离与静默检出两个事件类的暂停（按各层的亚健康 / 静默 FIT 份额分到各层，只在最后一列列出，不与次数相加）。每实例每年 = 全集群该层中断率 ÷ 实例数 × 8,760 h；MTBF / 实例是这一层硬件在一个实例上的中断间隔。', '口径: event = a hard interruption of the synchronous job; denominator = cluster-hour; level = job. C_ℓ = pause seconds per hour from the level’s events (rate × mean pause down the mechanism chain); F = the pauses of the two other event classes (isolation of sub-healthy units, detected silent corruption), split over the levels by their sub-health / silent FIT and shown only in the last column, never added to the counts. Per instance per year = the level’s cluster rate ÷ instances × 8,760 h; MTBF per instance = time between that level’s hardware interruptions on one instance.')}</p>
`,
    `<div class="eyebrow">EYEBROW2</div>
  <h2 class="first">${esc(T('2. 映射细节：故障类与机制归到哪一层（表 2、图 2）', '2. Mapping in detail: which level the fault classes and mechanisms belong to (Table 2, Figure 2)'))}</h2>
  ${table1}
  <figure class="chart"><div class="scroll">${figHeat()}</div></figure>
  <p class="note">${T('部署层 = 机制在哪里实现与运行（芯片运行时、节点进程、集群管理与存储）；作用层 = 它缩短了哪一层事件的停机，由 HAC-D 引擎在 64 个机制组合上精确计算（每层停机的 Shapley 值，按层可加，合计等于全部启用与全部关闭之差）。R-REPLAY 只对目录中带重执行标记的瞬态事件生效（NPU 的 CORE、SRAM、IOD、MEMT，节点的 NIC，超节点的 OPT）；R-PROCESS 与 R-ELASTIC 只对带进程 / 弹性标记的 NPU 与节点事件生效。', 'Deployed at = where the mechanism is implemented and runs (device runtime, node process, cluster management and storage); acts on = whose events it shortens, computed exactly on HAC-D’s engine over the 64 coalitions (Shapley value of each level’s downtime, additive over levels; the total equals all-on minus all-off). R-REPLAY works only on the catalog’s transient events with the replay flag (NPU: CORE, SRAM, IOD, MEMT; node: NIC; SuperPoD: OPT); R-PROCESS and R-ELASTIC only on NPU and node events with the process / elastic flags.')}</p>
  <h2>${esc(T(`3. 每一层的分配结果（${kN(R.main)}，A_op ≥ 98.5 %，图 3、表 3–5）`, `3. Allocation result at each level (${kN(R.main)}, A_op ≥ 98.5 %, Figure 3, Tables 3–5)`))}</h2>
  <figure class="chart"><div class="scroll">${figLedger()}</div></figure>`,
    `<div class="eyebrow">EYEBROW3</div>
  <h3 class="first">${esc(T('表 3：硬件与恢复侧的三种分配', 'Table 3: three allocations between hardware and the recovery side'))}</h3>
  ${table3}
  <p class="note">${T(`① 硬件优先（HAC-D allocateStrategy，无候选机制、无杠杆）：ARINC 让每类按今天比例同乘 ×${fmt(x1, 3)}；等权拆分（这里 AGREE 与最小努力相同：每类单元数同为卡数、努力相同）让停机贡献大的类多降，UNKNOWN 已到 HAC-D 的下限 ×0.05。② HAC-D 恢复系数：硬件不变时检测、自动尝试、人工三个时间同乘 g。③ HAC-D 最优策略：在三个恢复杠杆（R-CKPT / R-MANUAL 的参数：自动尝试 ≥ 60 s、自动成功 ≤ 99.9 %、人工 ≥ 30 min）的全部组合上求“杠杆努力 + 硬件努力”最小，硬件按 ARINC（或最小努力）补齐；自动成功率杠杆按 HAC-D 降额规则在降额一侧无收益，未被选中。每格的“每个”= 允许 FIT / 卡 × 该层实例的卡数。`, `① Hardware first (HAC-D allocateStrategy, no candidate mechanism, no lever): ARINC multiplies every class by ×${fmt(x1, 3)} in proportion to today; the equal-weight split (here AGREE equals minimum effort: every class has the card count as units and the same effort) cuts the classes with large pause contributions most, UNKNOWN reaching HAC-D’s floor ×0.05. ② HAC-D recovery factor: with the hardware unchanged, detection, automatic attempt and manual times all scale by g. ③ HAC-D optimal strategy: over all subsets of the three recovery levers (the R-CKPT / R-MANUAL parameters: automatic attempt ≥ 60 s, automatic success ≤ 99.9 %, manual ≥ 30 min) the least lever + hardware effort, hardware closed by ARINC (or minimum effort); the automatic-success lever gains nothing derated under HAC-D’s rule and is not chosen. “per inst.” = allowed FIT per card × cards in that level’s instance.`)}</p>
  <h3>${esc(T('表 4：各层机制的参数要求（方案 ③）', 'Table 4: parameter requirements of each level’s mechanisms (plan ③)'))}</h3>
  ${table4}
  <h3>${esc(T('表 5：按实例的验收值（方案 ③，ARINC）', 'Table 5: acceptance values per instance (plan ③, ARINC)'))}</h3>
  ${table5}  <h2>${esc(T('4. 四个规模（表 6）与读法', '4. The four sizes (Table 6) and how to read them'))}</h2>
  ${table6}
  <ul class="scale">
    <li>${T('<b>为什么按层看</b>：同步训练是串联系统，任何一层的硬中断都停住整个作业；分层的意义在于“谁来交付”——NPU、节点、计算柜、超节点各自对应一个供应 / 验收对象（表 5），集群级对应作业级服务与运维流程。分层预算是设计参照（与 ReMAP 的分层诊断一致），总目标由 HAC-D 引擎整体闭合，不要求各层独立达标。', '<b>Why by level</b>: synchronous training is a series system — a hard interruption at any level stops the whole job; the levels matter for “who delivers”: NPU, node, compute cabinet and SuperPoD each map to a supply / acceptance object (Table 5), the cluster level to the job-level services and operations. Level budgets are design references (as in ReMAP’s layered diagnosis); the total target is closed on HAC-D’s engine as a whole, no level must meet its share on its own.')}</li>
    <li>${T('<b>参考机制的边界</b>：六个参考机制都只在 NPU 与节点级提供快速梯级；计算柜与集群级的停机只能由基线的检测、R-CKPT、R-MANUAL 或硬件降低。若要在这些层加机制（例如控制面连续性、故障分类、存储高可用），需要 ReMAP 扩展机制或 HAC-D 机制库，不在本页范围内。', '<b>Limits of the reference mechanisms</b>: all six provide fast rungs only at the NPU and node levels; cabinet- and cluster-level downtime can only be lowered by the baseline detection, R-CKPT, R-MANUAL or hardware. Mechanisms for those levels (e.g. control-plane continuity, fault classification, highly available storage) need ReMAP’s extensions or HAC-D’s library and are outside this page.')}</li>
    <li>${T('<b>不确定性</b>：目录 FIT 是 GPU 机群的类比先验（每卡口径），不是 Atlas 950 实测；机制参数是 ReMAP 的名义目标；层级归属按目录 scope，FABRIC / OPT 归超节点级是对 950 的判断（柜内 LRS 也在其中）。结论的形状（集群与计算柜级占大头、参考机制管不到、恢复杠杆先行可把硬件任务从 ×0.27 放宽到 ×0.50）对这些假设不敏感。', '<b>Uncertainty</b>: the catalog FIT is an analogue prior from GPU fleets (per card), not an Atlas 950 measurement; mechanism parameters are ReMAP’s nominal targets; levels follow the catalog scope, FABRIC / OPT on the SuperPoD level is a judgement for the 950 (the in-cabinet LRS are included). The shape of the result — cluster and cabinet levels dominate, the reference mechanisms do not reach them, recovery levers first relax the hardware task from ×0.27 to ×0.50 — does not hinge on these assumptions.')}</li>
  </ul>
  <footer>${T(`复现：<code>node --import tsx scripts/a950-level-allocation.ts</code> → <code>node scripts/build-a950-level-allocation.mjs</code>（HAC-D v4.3 引擎：referenceCatalog、allocateStrategy、scaleRecovery、窗口账本 ${R.trials} 窗、种子 1）。数据：ReMAP references/expert-review-2026-10-09（inputs.json、mechanism-policy.json、config.json，与 ai-cluster-reliability 683afe8 逐字节相同；HACD_REMAP_COMPARISON 8 项核对通过）。数字已由独立 Python 按目录与文中参数复算（各层停机、预算、Shapley、方案 ② ③ 的 A_op 相对误差 ≤ 1e-8；ARINC 系数与闭式 B/Σc 相差 ≤ 3e-4，为引擎二分容差）。相关：<code>docs/ASCEND950_SCALING_RELIABILITY</code>（HAC-D 单元口径的同一架构）、<code>docs/ARCH_ALLOCATION_98P5_500K</code>（多架构分配）。`, `Reproduce: <code>node --import tsx scripts/a950-level-allocation.ts</code> → <code>node scripts/build-a950-level-allocation.mjs</code> (HAC-D v4.3 engine: referenceCatalog, allocateStrategy, scaleRecovery, window ledger ${R.trials} windows, seed 1). Data: ReMAP references/expert-review-2026-10-09 (inputs.json, mechanism-policy.json, config.json; byte-identical with ai-cluster-reliability 683afe8; all 8 checks of HACD_REMAP_COMPARISON pass). The numbers were recomputed independently in Python from the catalog and the parameters stated here (level downtimes, budgets, Shapley values and the A_op of plans ② and ③ within a relative 1e-8; the ARINC factor within 3e-4 of the closed form B/Σc, the engine's bisection tolerance). Related: <code>docs/ASCEND950_SCALING_RELIABILITY</code> (the same architecture on HAC-D’s per-unit basis), <code>docs/ARCH_ALLOCATION_98P5_500K</code> (allocation across architectures).`)}</footer>`,
  ];
  const nPages = sections.length;
  const eyebrow = (i) => esc(T(`HAC-D · Atlas 950 分层分配 · ${DATE} · 第 ${i} / ${nPages} 页`, `HAC-D · Atlas 950 allocation by level · ${DATE} · page ${i} / ${nPages}`));
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
<title>${esc(T('Atlas 950 分层分配', 'Atlas 950 level allocation'))}</title>
<meta name="description" content="${esc(T('Atlas 950 的集群、超节点、计算柜（Pod）、节点、NPU 五个层级：ReMAP 目录故障类与六个参考机制的归层、各层停机诊断，以及 A_op ≥ 98.5 % 时每一层的硬件与机制分配结果（HAC-D 方法）。', 'The five Atlas 950 levels — cluster, SuperPoD, compute cabinet (Pod), node, NPU: where the ReMAP catalog’s fault classes and the six reference mechanisms sit, downtime by level, and the hardware and mechanism allocation at each level for A_op ≥ 98.5 % (HAC-D methods).'))}">
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
  const out = `docs/ATLAS950_LEVEL_ALLOCATION.${lang}.html`;
  writeFileSync(out, html);
  console.log(`written ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
page('zh');
page('en');
