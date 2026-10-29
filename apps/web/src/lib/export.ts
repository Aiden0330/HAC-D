import { kpiForm, deratedOf, topologyBom, type Scenario, type EvaluationResult } from '@hac-d/core';

export function download(filename: string, content: string, type = 'application/json'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBytes(filename: string, bytes: Uint8Array, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function scenarioFilename(s: Scenario, ext: string): string {
  return `${(s.meta.id ?? s.meta.name).replace(/[^a-z0-9-_]+/gi, '-')}.${ext}`;
}

export function componentsCsv(r: EvaluationResult): string {
  const head = ['id', 'name', 'subsystem', 'count', 'lambda_per_unit_per_h', 'lambda_aggregate_per_h', 'interruption_share', 'mttr_h', 'confidence', 'koujing'];
  const rows = r.components.map((c) => [c.id, c.name, c.subsystem, c.count, c.lambdaPerUnitPerHour, c.lambdaAggregatePerHour, c.interruptionShare, c.mttrHours, c.confidence ?? '', c.koujing ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [head.join(','), ...rows].join('\n');
}

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Self-contained HTML report in the survey's visual style. */
export function htmlReport(s: Scenario, r: EvaluationResult, lang: 'zh' | 'en'): string {
  const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)} %`;
  const dur = (sec: number) => (sec < 120 ? `${sec.toFixed(0)} s` : sec < 7200 ? `${(sec / 60).toFixed(1)} min` : sec < 172800 ? `${(sec / 3600).toFixed(1)} h` : `${(sec / 86400).toFixed(1)} d`);
  const zh = lang === 'zh';
  const t = r.training;
  // v5.3 every row carries its 口径 (event class, denominator, level) in the formula column; the first training rows are the
  // Topology strip in the Findings report's 口径 (kpiForm, formula (1); nominal and derated), the headline goodput model is ★
  const kj = (k: string, f?: string) => `${zh ? '口径：' : '口径: '}${k}${f ? ` · ${f}` : ''}`;
  const rows: [string, string, string?][] = [
    [zh ? '可用率' : 'Availability', pct(r.system.availability, 4), kj(zh ? '系统级稳态可用率（结构 RBD / CTMC，全部部件）' : 'system level, steady state (structure RBD / CTMC, all components)', r.formulas.availability)],
    [zh ? '容量可用率' : 'Capacity availability', pct(r.system.capacityAvailability, 4), kj(zh ? '系统级，期望在线容量占比' : 'system level, expected share of capacity up')],
    ['MTBF', dur(r.system.mtbfHours * 3600), kj(zh ? '系统级失效（结构），稳态失效频率的倒数' : 'system-level failures (structure), 1 / steady-state failure frequency', r.formulas.mtbf)],
    [zh ? '等效 MTTR' : 'Equivalent MTTR', dur(r.system.equivalentMttrHours * 3600), kj(zh ? '系统级，(1 − A)/ν' : 'system level, (1 − A)/ν')],
    [zh ? '年故障次数' : 'Failures / year', r.system.failuresPerYear.toFixed(1), kj(zh ? '系统级失效频率 × 8766 h' : 'system-level failure frequency × 8766 h')],
  ];
  if (t) {
    let form: { nom: ReturnType<typeof kpiForm>; der: ReturnType<typeof kpiForm> } | null = null;
    try { form = { nom: kpiForm(s, t), der: kpiForm(deratedOf(s)) }; } catch { form = null; }
    let fitPerNpu: number | null = null;
    try { fitPerNpu = topologyBom(s).hardFitPerNpuTotal; } catch { fitPerNpu = null; }
    const target = s.targets.operational ?? 0.985, targetEff = s.targets.effective ?? 0.985;
    if (form) {
      rows.push(
        [zh ? '有效 goodput G_eff 名义 / 降额' : 'Effective goodput G_eff nominal / derated', `${(form.nom.effective * 100).toFixed(2)} / ${(form.der.effective * 100).toFixed(2)} %`, kj(zh ? `报告指标（v5.6）：30 天窗口的有效 goodput——检查点保存、每次回滚重算与恢复暂停，乘吞吐系数，按精确更新模型（公式 1′ 为其一阶形式）；目标 ${pct(targetEff, 1)} 以降额为准` : `the report metric (v5.6): effective goodput over the 30-day window — checkpoint saves, recompute per rollback and recovery pauses, times the throughput factors, on the exact renewal model (formula 1′ its first-order form); target ${pct(targetEff, 1)} on the derated value`)],
        [zh ? '每次中断损失 R_eff 名义 / 降额' : 'Loss per interruption R_eff nominal / derated', `${form.nom.lossS.toFixed(1)} / ${form.der.lossS.toFixed(1)} s`, kj(zh ? 'MTTR_hw + 回滚概率 × 每次回滚重算 W（公式 2′ 的硬件侧）' : 'MTTR_hw + rollback probability × recompute per rollback W (the hardware side of formula 2′)')],
        [zh ? 'A_op 名义 / 降额' : 'A_op nominal / derated', `${(form.nom.aOp * 100).toFixed(3)} / ${(form.der.aOp * 100).toFixed(3)} %`, kj(zh ? `一个同步作业在作业窗口内的运行可用率；目标 ${pct(target, 1)} 对两者都须成立，以降额为准（降额：已应用机制参数与恢复杠杆按覆盖率 −5 pt、成功率 −8 pt、时间 ×1.5、速率降低量 ×0.5 劣化；方案自身 FIT 与恢复基线不降额）` : `one synchronous job over the job window; the target ${pct(target, 1)} must hold for both, the derated value decides (derated: applied mechanisms' parameters and the recovery levers worsened by coverage −5 pt, success −8 pt, times ×1.5, rate reductions ×0.5; the scenario's own FIT and recovery baseline are not derated)`, 'A_op = (1 − φ)/(1 + (Σλ_i t̄_i + F)/3600) (formula 1)')],
        ['MTBF_hw', `${form.nom.mtbfHwH.toFixed(3)} h`, kj(zh ? `仅硬中断类（经机制链后的作业中断/小时）；隔离、静默错误与误报单独计；含隔离的 MTBI ${t.mtbiHours.toFixed(3)} h` : `hard interruption classes only (job interruptions per hour after the mechanism chain); isolation, silent corruption and false alarms counted apart; MTBI incl. isolation ${t.mtbiHours.toFixed(3)} h`, 'MTBF_hw = 1/Σλ_i')],
        [zh ? 'MTTR_hw 名义 / 降额' : 'MTTR_hw nominal / derated', `${form.nom.mttrS.toFixed(1)} / ${form.der.mttrS.toFixed(1)} s`, kj(zh ? `硬中断按发生率加权的平均停顿（作业时间秒/次）；全部事件平均停顿 ${t.meanPauseS.toFixed(1)} s` : `rate-weighted pause of the hard interruptions (seconds of job time per event); mean pause over all events ${t.meanPauseS.toFixed(1)} s`, 'MTTR_hw = Σλ_i t̄_i / Σλ_i')],
      );
    }
    if (fitPerNpu !== null) rows.push([zh ? '每 NPU 中断 FIT' : 'Interruption FIT per NPU', fitPerNpu.toFixed(1), kj(zh ? '硬件，机制之前；业务影响中断/单元小时 × 1e9，按 NPU 平均' : 'hardware, before mechanisms; business-impact interruptions per unit-hour × 1e9, per NPU', 'Σ n·FIT / N')]);
    const star = (model: 'first-order' | 'exact-renewal') => (t.headlineModel === model ? ' ★' : '');
    rows.push(
      [zh ? '作业中断率' : 'Interruption rate', `${t.interruptionRatePerHour.toFixed(4)} /h`, kj(zh ? '作业级事件/小时（全部部件，含隔离），同步作业' : 'job-level events per hour (all components, incl. isolation), synchronous job', r.formulas.mtbi)],
      ['MTBI', dur(t.mtbiS), kj(zh ? '1/λ_job，含隔离中断' : '1/λ_job, incl. isolation interruptions')],
      ['R(N)', dur(t.recoveryS), kj(zh ? '规模 N 下每次中断的恢复时间' : 'recovery time per interruption at size N', r.formulas.recovery)],
      ['τ', dur(t.tauS), kj(zh ? '检查点间隔' : 'checkpoint interval', r.formulas.interval)],
      [`${zh ? 'goodput（一阶）' : 'Goodput (first order)'}${star('first-order')}`, pct(t.firstOrder.goodput), kj(zh ? '作业墙钟时间占比，阻塞备件与亚健康之前' : 'share of job wall time, before blocked spares and sub-health', r.formulas.goodput)],
      ...(t.headlineModel === 'exact-renewal' ? [[`${zh ? 'goodput（精确更新）' : 'Goodput (exact renewal)'} ★`, pct(t.headlineGoodput), kj(zh ? '作业墙钟时间占比；一阶模型越界时的标题模型' : 'share of job wall time; the headline model when the first order is out of range')] as [string, string, string]] : []),
      [zh ? 'goodput（Daly 完整）' : 'Goodput (Daly full)', pct(t.dalyGoodput), kj(zh ? '作业墙钟时间占比（对照）' : 'share of job wall time (cross-check)')],
      [zh ? '有效 goodput' : 'Effective goodput', pct(t.effectiveGoodput), kj(zh ? '作业墙钟时间占比，含阻塞备件、亚健康与机制开销' : 'share of job wall time incl. blocked spares, sub-health and mechanism overhead', r.formulas.goodputSubhealth)],
      [zh ? '正确有效产出（交付）' : 'Delivered goodput (correct)', pct(t.deliveredGoodput), kj(zh ? '30 天窗口内正确产出占墙钟时间' : 'correct output per wall time over the 30-day window', r.formulas.sdc ?? '')],
      [zh ? '运行可用率 A_op' : 'Operational availability A_op', pct(t.operationalAvailability), kj(zh ? '作业窗口内运行时间占比 × (1 − φ)（引擎值，= 上方 A_op 名义）' : 'running share of the job window × (1 − φ) (engine value, = A_op nominal above)')],
      [zh ? '每日损失' : 'Lost $/day', `$${t.lostDollarsPerDay.toFixed(0)}`, kj(zh ? '浪费的 GPU·h/天 × 单价（交付口径）' : 'wasted GPU·h per day × price (delivered basis)', r.formulas.cost)],
    );
  }
  const inf = r.inference;
  if (inf) rows.push([zh ? '有服务可用率' : 'Service-up availability', pct(inf.serviceUpAvailability, 4), kj(zh ? '推理服务级，至少所需副本在线的时间占比' : 'inference service level, share of time with the required replicas up', r.formulas.inference)], [zh ? '容量可用率' : 'Capacity availability', pct(inf.capacityAvailability, 4), kj(zh ? '推理服务级，期望在线副本容量占比' : 'inference service level, expected share of replica capacity up')], [zh ? '所需 k' : 'k required', String(inf.kRequiredForTarget), kj(zh ? '满足目标的冗余副本数 N+k' : 'redundant replicas N+k for the target')]);
  const comps = r.components.map((c) => `<tr><td>${esc(c.name)}</td><td class="n">${c.count}</td><td class="n">${(c.lambdaPerUnitPerHour * 1e6).toFixed(2)}</td><td class="n">${pct(c.interruptionShare, 1)}</td><td class="n">${c.mttrHours}</td><td>${esc(c.confidence ?? '')}</td><td>${esc(c.koujing ?? '')}</td></tr>`).join('');
  const check = r.checklist.map((c) => `<li class="${c.status}"><b>[${c.status}]</b> ${esc(zh ? c.title.zh : c.title.en)} — ${esc(c.message)}</li>`).join('');
  const assumptions = r.assumptions.map((a) => `<li>${esc(a)}</li>`).join('');
  return `<!doctype html><html lang="${zh ? 'zh-Hans' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HAC-D · ${esc(s.meta.name)}</title>
<style>
:root{--bg:#EEF0F4;--surface:#fff;--ink:#11141C;--ink-3:#687084;--rule:#CED3DD;--accent:#3B3FB6;--ok:#1D7A4C;--warn:#956608;--crit:#A63A2E;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0D0F15;--surface:#141720;--ink:#E4E7EF;--ink-3:#7A8195;--rule:#262B37;--accent:#A3A7FF;--ok:#4EC084;--warn:#DBA745;--crit:#E87C6D}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "IBM Plex Sans","Noto Sans SC",system-ui,sans-serif;padding:24px}
main{max-width:1100px;margin:0 auto}.card{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:16px 18px;margin:12px 0}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums}
.f{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--ink-3)}li.pass b{color:var(--ok)}li.warn b{color:var(--warn)}li.fail b{color:var(--crit)}.muted{color:var(--ink-3)}
</style></head><body><main>
<h1>${esc(s.meta.name)}</h1><div class="muted">HAC-D ${zh ? '设计评审报告' : 'design-review report'} · ${new Date().toISOString().slice(0, 10)} · NPUs ${r.counts.gpus} · nodes ${r.counts.nodes} · cabinets ${r.counts.racks}</div>
<div class="card"><h2>${zh ? '关键指标' : 'Key figures'}</h2><table>${rows.map((x) => `<tr><td>${esc(x[0])}</td><td class="n"><b>${esc(x[1])}</b></td><td class="f">${esc(x[2] ?? '')}</td></tr>`).join('')}</table></div>
<div class="card"><h2>${zh ? '部件类' : 'Component classes'}</h2><table><thead><tr><th>${zh ? '部件' : 'Component'}</th><th>n</th><th>λ /1e6 h</th><th>${zh ? '中断占比' : 'Share'}</th><th>MTTR h</th><th>${zh ? '置信' : 'Confidence'}</th><th>口径</th></tr></thead><tbody>${comps}</tbody></table></div>
<div class="card"><h2>${zh ? '设计评审清单' : 'Design-review checklist'}</h2><ul>${check}</ul></div>
<div class="card"><h2>${zh ? '假设' : 'Assumptions'}</h2><ul>${assumptions}</ul>${r.warnings.length ? `<h2>${zh ? '警告' : 'Warnings'}</h2><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>
<div class="card"><h2>${zh ? '方案 JSON' : 'Scenario JSON'}</h2><pre class="f" style="white-space:pre-wrap">${esc(JSON.stringify(s, null, 2))}</pre></div>
<p class="muted">${zh ? '一阶解析计算，用于数量级判断与方案比较；非指数或相关故障请以蒙特卡洛结果为准。' : 'First-order closed forms for order-of-magnitude judgement and option comparison; for non-exponential or correlated failures use the Monte Carlo results.'}</p>
</main></body></html>`;
}
