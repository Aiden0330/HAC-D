import type { Scenario, EvaluationResult } from '@hac-d/core';

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
  const rows: [string, string, string?][] = [
    [zh ? '可用率' : 'Availability', pct(r.system.availability, 4), r.formulas.availability],
    [zh ? '容量可用率' : 'Capacity availability', pct(r.system.capacityAvailability, 4)],
    ['MTBF', dur(r.system.mtbfHours * 3600), r.formulas.mtbf],
    [zh ? '等效 MTTR' : 'Equivalent MTTR', dur(r.system.equivalentMttrHours * 3600)],
    [zh ? '年故障次数' : 'Failures / year', r.system.failuresPerYear.toFixed(1)],
  ];
  if (t) {
    rows.push(
      [zh ? '作业中断率' : 'Interruption rate', `${t.interruptionRatePerHour.toFixed(4)} /h`, r.formulas.mtbi],
      ['MTBI', dur(t.mtbiS)],
      ['R(N)', dur(t.recoveryS), r.formulas.recovery],
      ['τ', dur(t.tauS), r.formulas.interval],
      [zh ? 'goodput（一阶）' : 'Goodput (first order)', pct(t.firstOrder.goodput), r.formulas.goodput],
      [zh ? 'goodput（Daly 完整）' : 'Goodput (Daly full)', pct(t.dalyGoodput)],
      [zh ? '有效 goodput' : 'Effective goodput', pct(t.effectiveGoodput)],
      [zh ? '正确有效产出（交付）' : 'Delivered goodput (correct)', pct(t.deliveredGoodput), r.formulas.sdc ?? ''],
      [zh ? '运行可用率 A_op' : 'Operational availability A_op', pct(t.operationalAvailability)],
      [zh ? '每日损失' : 'Lost $/day', `$${t.lostDollarsPerDay.toFixed(0)}`, r.formulas.cost],
    );
  }
  const inf = r.inference;
  if (inf) rows.push([zh ? '有服务可用率' : 'Service-up availability', pct(inf.serviceUpAvailability, 4), r.formulas.inference], [zh ? '容量可用率' : 'Capacity availability', pct(inf.capacityAvailability, 4)], [zh ? '所需 k' : 'k required', String(inf.kRequiredForTarget)]);
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
