import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Comlink from 'comlink';
import { TOPOLOGY_SCALES, DEFAULT_MECHANISM_SET, VARIANT_MECHANISM_SETS, resolveMechanismSet, reportCandidates, minWindowTrials, type Scenario, type MechanismSet, type GoodputTiers } from '@hac-d/core';
import { useLang } from '../hooks.js';
import { compute, cancelCompute, ComputeCancelled } from '../worker/client.js';
import type { ReportRun } from '../worker/compute.worker.js';
import { useReportRuns, type ReportRunState } from '../state/reportRuns.js';
import { saveReport, loadReport, deleteReport, openHtml, type SavedReport } from '../lib/reportStore.js';
import { Card, Field, NumberInput, DataTable } from '../components/ui.js';
import { download } from '../lib/export.js';
import { fmtPct, fmtInt, fmtNum } from '../lib/format.js';

/**
 * v6.3 Allocation › Report: one button runs the report pipeline of `hacd findings` on the active project in the compute worker
 * (reportFromScenario: the hierarchical budget with the window rule at every scale, the Shapley study, the mechanism hierarchy) and
 * renders the bilingual Findings and Methodology pages with the same recipes as the committed reports (@hac-d/reports/browser).
 * Settings are the report preset (the default mechanism set's candidates, parameters, efforts and levers; ARINC; derating; seed 1),
 * the project's A_op target and its own size — the four built-in scales on request; windows and permutations default to the
 * report's 400 / 300 and may be lowered for a quick run (the footer of the pages records what was used).
 * v6.4: the run lives in the run store (state/reportRuns.ts), keyed by the project, so switching tabs or pages neither loses the
 * progress nor the result; a result computed from an earlier version of the project is shown as stale. "Save findings" keeps the
 * pages and the bundle in the browser (IndexedDB) across reloads; "Open" shows a page in a new tab; the downloads are the files.
 */
const projectIdOf = (s: Scenario) => (s.meta.id ?? s.meta.name).replace(/[^a-z0-9-_]+/gi, '-');
/** the fewest windows a supported window check can come from (35 for P ≥ 0.9 at 95 %; formula 6) */
const MIN_TRIALS = minWindowTrials();

export function ReportPanel({ s }: { s: Scenario }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [trials, setTrials] = useState(400);
  const [perms, setPerms] = useState(300);
  const [allScales, setAllScales] = useState(false);
  /** v5.11 the appendix variant sets ticked for this run, in the built-in order (Appendix A1, A2, …) */
  const [variants, setVariants] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedReport | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  /** the page shown inline when the browser refuses a new tab (pop-up blocking, embedded browsers) */
  const [inline, setInline] = useState<{ html: string; title: string } | null>(null);
  const id = projectIdOf(s);
  const key = JSON.stringify(s);
  const run = useReportRuns((st) => st.runs[id]);
  const runs = useReportRuns();
  useEffect(() => { setMsg(null); setInline(null); let live = true; setSaved(undefined); loadReport(id).then((r) => { if (live) setSaved(r ?? null); }, () => { if (live) setSaved(null); }); return () => { live = false; }; }, [id]);
  if (s.workload.type !== 'training') return <div className="callout">{t('findingsTab.notTraining')}</div>;
  const N = s.workload.nGpus;
  const hasPod = !!s.topology.superpod;
  const sizes = allScales ? [...new Set([...TOPOLOGY_SCALES, N])].sort((a, b) => a - b) : [N];
  // v5.12 the report allocates on A_op (the project's A_op target, default 98.5 %); the project's effective / delivered goodput
  // targets are the floors of its two goodput tiers (absent: the defaults 97 % / 90 %)
  const target = s.targets.operational ?? 0.985;
  const effectiveFloor = s.targets.effective, deliveredFloor = s.targets.goodput;
  const candidates = reportCandidates(s);
  const reference = Object.keys(s.mechanisms.applied ?? {});
  const stageText = (stage: string, n: number, detail: string) => t(`findingsTab.stage_${stage}`, { n: fmtInt(n), detail, defaultValue: `${stage} ${fmtInt(n)} ${detail}` });
  const busy = run?.status === 'running';

  const generate = async () => {
    const settings = { sizes, trials: Math.max(MIN_TRIALS, Math.round(trials)), permutations: Math.max(1, Math.round(perms)), target, ...(variants.length ? { variants: [...variants] } : {}) };
    const name = { zh: s.meta.name, en: s.meta.name };
    runs.start(id, s.meta.name, key, settings);
    setMsg(null);
    try {
      // the promise is held by the store's run, not by this panel: the worker goes on when the tab is left
      const r = await compute().report(s, { id, name, short: name, sizes: settings.sizes, main: N, target, effectiveFloor, deliveredFloor, trials: settings.trials, seed: 1, permutations: settings.permutations, variants: settings.variants }, Comlink.proxy((stage: string, n: number, detail: string) => useReportRuns.getState().progress(id, stageText(stage, n, detail))));
      useReportRuns.getState().finish(id, r);
    } catch (e) {
      useReportRuns.getState().fail(id, e instanceof ComputeCancelled ? t('mechanisms.cancelled') : (e as Error).message, e instanceof ComputeCancelled);
    }
  };
  // the row of the checkpoint tier the report quotes: Young's period unless the design's own period already follows the rollback interval
  const tierRow = (T: GoodputTiers) => (T.checkpoint.basis === 'young' && T.checkpoint.young ? T.checkpoint.young : T.checkpoint.asDesigned);
  const save = async (r: ReportRunState) => {
    const res = r.result!;
    const A = res.sidecar.results.archs[id];
    try {
      const rec: SavedReport = {
        projectId: id, projectName: r.projectName, savedAt: Date.now(), scenarioKey: r.scenarioKey,
        settings: { ...r.settings, seed: 1 }, files: res.files, html: res.html, bundle: JSON.stringify(res.sidecar, null, 1),
        kpi: res.sidecar.results.sizes.map((n) => { const z = A.sizes[String(n)]; return { metric: res.sidecar.results.metric, scale: n, todayAop: z.today.aOp, todayAopDerated: z.today.aOpDerated, todayEffectiveDerated: tierRow(z.today.tiers).effective.derated, todayDeliveredDerated: z.today.tiers.delivered.asAllocated.delivered.derated, recommendedAopDerated: z.recommended.final.kpiDerated.aOp, recommendedEffectiveDerated: tierRow(z.recommended.tiers).effective.derated, recommendedDeliveredDerated: z.recommended.tiers.delivered.asAllocated.delivered.derated, feasible: z.recommended.feasible !== false, mechanisms: z.recommended.mechanisms, k: z.recommended.k }; }),
      };
      await saveReport(rec);
      setSaved(rec);
      setMsg({ text: t('findingsTab.savedMsg'), tone: 'info' });
    } catch (e) { setMsg({ text: `${t('findingsTab.saveFailed')}: ${(e as Error).message}`, tone: 'crit' }); }
  };
  const remove = async () => { try { await deleteReport(id); setSaved(null); setMsg(null); } catch (e) { setMsg({ text: (e as Error).message, tone: 'crit' }); } };
  const open = (html: string, title: string) => { if (openHtml(html)) { setInline(null); return; } setInline({ html, title }); setMsg({ text: t('findingsTab.popupBlocked'), tone: 'info' }); };

  const p = (x: number, k = 3) => fmtPct(x, k), h = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${x.toFixed(3)} h`), sec = (x: number) => `${x.toFixed(1)} s`;
  const verdict = (v: string) => t(`mechanisms.verdict_${v}`);
  const LEV: Record<string, string> = { auto: lang === 'zh' ? '自动 60 s' : 'auto 60 s', manual: lang === 'zh' ? '人工 30 min' : 'manual 30 min', success: lang === 'zh' ? '成功 99.9 %' : 'success 99.9 %' };
  const when = (ms: number) => new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const settingsText = (st: { sizes: number[]; trials: number; permutations: number; target: number; variants?: string[] }) => `${st.variants?.length ? `${t('findingsTab.variantsShort')} ${st.variants.map((v) => v.replace(/^remap-latest-2026-10--/, '')).join(', ')} · ` : ''}${st.sizes.map((n) => fmtInt(n)).join(' / ')} NPU · ${t('findingsTab.trials')} ${st.trials} · ${t('findingsTab.permutations')} ${st.permutations} · ${t('findingsTab.target')} ${fmtPct(st.target, 1)}`;
  /** what a variant set changes against the default set's baseline, for its checkbox label */
  const variantChange = (V: MechanismSet) => {
    const b = resolveMechanismSet(DEFAULT_MECHANISM_SET).baseline, vb = resolveMechanismSet(V).baseline;
    const added = vb.filter((id) => !b.includes(id)).join(' + '), removed = b.filter((id) => !vb.includes(id)).join(' + ');
    return removed ? t('findingsTab.variantReplaces', { added, removed }) : t('findingsTab.variantAdds', { ids: added });
  };
  const toggleVariant = (id: string, on: boolean) => setVariants(VARIANT_MECHANISM_SETS.map((v) => v.id).filter((x) => (x === id ? on : variants.includes(x))));
  const stale = (scenarioKey: string) => scenarioKey !== key;
  const A = run?.status === 'done' && run.result ? run.result.sidecar.results.archs[id] : undefined;
  const result: ReportRun | undefined = run?.status === 'done' ? run.result : undefined;

  return (
    <div className="grid" style={{ gap: 12 }}>
      <Card title={t('findingsTab.title')} sub={t('findingsTab.sub')} formula={t('strategy.budgetFormula')}>
        {!hasPod && <div className="callout warn" style={{ marginBottom: 8 }}>{t('findingsTab.noSuperpod')}</div>}
        <div className="form-grid">
          <Field label={t('findingsTab.target')}><span>{fmtPct(target, 1)}</span></Field>
          <Field label={t('findingsTab.set')}><span className="mono">{DEFAULT_MECHANISM_SET.id}</span></Field>
          <Field label={t('findingsTab.reference')}><span className="mono" style={{ fontSize: 12 }}>{reference.join(' + ') || '—'}</span></Field>
          <Field label={t('findingsTab.candidates')}><span className="mono" style={{ fontSize: 12 }}>{candidates.join(' + ') || '—'}</span></Field>
          <Field label={t('findingsTab.trials')} hint={t('strategy.budgetTrialsHint')}><NumberInput value={trials} min={MIN_TRIALS} max={5000} step={50} onChange={setTrials} /></Field>
          <Field label={t('findingsTab.permutations')}><NumberInput value={perms} min={1} max={2000} step={50} onChange={setPerms} /></Field>
        </div>
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={allScales} onChange={(e) => setAllScales(e.target.checked)} />
          {t('findingsTab.allScales')}
        </label>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t('findingsTab.variants')}</div>
          <div className="muted" style={{ fontSize: 12, margin: '2px 0 4px' }}>{t('findingsTab.variantsHint')}</div>
          {VARIANT_MECHANISM_SETS.map((V) => (
            <label key={V.id} className="check" style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <input type="checkbox" checked={variants.includes(V.id)} onChange={(e) => toggleVariant(V.id, e.target.checked)} />
              <span className="mono" style={{ fontSize: 12 }}>{V.id}</span>
              <span className="muted" style={{ fontSize: 12 }}>{variantChange(V)}</span>
            </label>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('findingsTab.scales')}: {sizes.map((n) => fmtInt(n)).join(' / ')} NPU · {t('findingsTab.seed')} 1 · {t('findingsTab.timeNote')}</div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary" disabled={busy || !hasPod} onClick={generate}>{busy ? `${t('common.running')}…` : t('findingsTab.run')}</button>
          {busy && <button type="button" className="btn" onClick={cancelCompute}>{t('mechanisms.cancel')}</button>}
        </div>
        {run && run.status === 'running' && (
          <div className="muted mono" style={{ fontSize: 12, marginTop: 6, overflowWrap: 'anywhere' }}>
            {t('findingsTab.progress')} ({run.progress.length}, {t('findingsTab.since', { when: when(run.startedAt) })}): {run.progress.slice(-3).join(' → ') || '…'}
          </div>
        )}
        {run && (run.status === 'error' || run.status === 'cancelled') && <div className={`callout ${run.status === 'error' ? 'crit' : ''}`} style={{ marginTop: 8 }}>{run.error}</div>}
        {msg && <div className={`callout ${msg.tone === 'crit' ? 'crit' : ''}`} style={{ marginTop: 8 }}>{msg.text}</div>}
      </Card>
      {run && result && A && (
        <Card title={t('findingsTab.resultTitle')} sub={`${t('findingsTab.done', { s: fmtNum(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000, 1) })} · ${settingsText(run.settings)}`}>
          {stale(run.scenarioKey) && <div className="callout warn" style={{ marginBottom: 8 }}>{t('findingsTab.stale')}</div>}
          <div className="btn-row" style={{ marginBottom: 8 }}>
            <button type="button" className="btn primary" onClick={() => save(run)}>{t('findingsTab.save')}</button>
            <button type="button" className="btn" onClick={() => open(result.html.findings, result.files.findings)}>{t('findingsTab.open')}</button>
            <button type="button" className="btn" onClick={() => download(result.files.findings, result.html.findings, 'text/html')}>{t('findingsTab.downloadFindings')}</button>
            <button type="button" className="btn" onClick={() => download(result.files.methodology, result.html.methodology, 'text/html')}>{t('findingsTab.downloadMethodology')}</button>
            <button type="button" className="btn" onClick={() => download(result.files.data, JSON.stringify(result.sidecar, null, 1))}>{t('findingsTab.downloadData')}</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{t('findingsTab.fileNote', { findings: result.files.findings, data: result.files.data })} · {t('findingsTab.dataNote')}</div>
          <DataTable
            columns={[t('topology.npus'), '', t('strategy.colAopDer'), t('strategy.colEffDer'), t('strategy.colDelDer'), t('strategy.colMtbfDer'), t('strategy.colMttrDer'), t('strategy.colWindow'), t('strategy.colPlan')]}
            numericFrom={2}
            rows={result.sidecar.results.sizes.flatMap((n) => {
              // v5.12 derated values on the three targets: A_op against the allocation target (MTBF_hw, MTTR_hw, P of the nominal design /
              // its derated twin), the effective goodput (the checkpoint tier's row) and the delivered goodput against their floors
              const z = A.sizes[String(n)];
              const rec = z.recommended, infeasible = rec.feasible === false, q = z.required;
              const fl = result.sidecar.results.floors ?? { effective: null, delivered: null };
              const mark = (m: boolean | null) => (m === null ? '' : m ? ' ✓' : ' ✗');
              const ok = q.reachable && q.mtbfAtTodayMttrH !== null && q.mttrAtTodayMtbfS !== null;
              return [
                [fmtInt(n), t('strategy.rowToday'), p(z.today.kpiDerated.aOp), p(tierRow(z.today.tiers).effective.derated, 2), p(z.today.tiers.delivered.asAllocated.delivered.derated, 2), h(z.today.kpiDerated.mtbfHwH), sec(z.today.kpiDerated.mttrS), `${p(z.today.window.pAtLeastTarget, 1)} · ${verdict(z.today.window.verdict)}`, '—'],
                ['', t('strategy.rowRequired'), `≥ ${p(run.settings.target, 1)}`, fl.effective === null ? '—' : `≥ ${p(fl.effective, 1)}`, fl.delivered === null ? '—' : `≥ ${p(fl.delivered, 1)}`, ok ? `≥ ${h(q.mtbfAtTodayMttrH)} ${t('strategy.atTodayMttr')}` : '—', ok ? `≤ ${sec(q.mttrAtTodayMtbfS ?? 0)} ${t('strategy.atTodayMtbf')}` : '—', '', q.reachable ? `B = ${q.B.toFixed(1)} s/h (${t('strategy.formula2')})` : t('strategy.unreachable', { B: q.B.toFixed(1), F: z.today.kpiDerated.F.toFixed(1), phi: p(z.today.kpiDerated.phi, 3) })],
                ['', <b key="r">{infeasible ? t('strategy.rowAllMoves') : t('strategy.rowRecommended')}</b>, <b key="d">{p(rec.final.kpiDerated.aOp)}</b>, `${p(tierRow(rec.tiers).effective.derated, 2)}${mark(rec.tiers.checkpoint.met)}`, `${p(rec.tiers.delivered.asAllocated.delivered.derated, 2)}${mark(rec.tiers.delivered.met)}`, h(rec.final.kpiDerated.mtbfHwH), sec(rec.final.kpiDerated.mttrS), `${p(rec.window.pAtLeastTarget, 1)}${rec.windowDerated ? ` / ${p(rec.windowDerated.pAtLeastTarget, 1)}` : ''} · ${verdict(rec.window.verdict)}`, `${rec.mechanisms.join(' + ') || '—'} | ${rec.levers.map((x) => LEV[x] ?? x).join(' + ') || '—'} · ${infeasible ? t('strategy.notFeasible', { ceiling: p(rec.ceiling?.derated ?? 0) }) : `${t('strategy.hardwareK')} ${rec.k.toFixed(3)} (${t(`strategy.binding_${rec.binding}`)})${rec.escalated ? ` † ${t('strategy.escalated')}` : ''}`}`],
              ];
            })}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('findingsTab.tableNote', { trials: result.sidecar.results.trials })}</div>
        </Card>
      )}
      <Card title={t('findingsTab.savedTitle')} sub={t('findingsTab.savedSub')}>
        {saved === undefined && <div className="muted" style={{ fontSize: 12 }}>…</div>}
        {saved === null && <div className="muted" style={{ fontSize: 12 }}>{t('findingsTab.noSaved')}</div>}
        {saved && (
          <>
            <div style={{ fontSize: 13 }}><b>{saved.projectName}</b> · {t('findingsTab.savedAt', { when: when(saved.savedAt) })} · {settingsText(saved.settings)}</div>
            {stale(saved.scenarioKey) && <div className="callout warn" style={{ margin: '6px 0' }}>{t('findingsTab.stale')}</div>}
            <ul className="plain muted" style={{ fontSize: 12, margin: '4px 0' }}>
              {saved.kpi.map((k) => k.metric === 'aOp' || k.todayEffectiveDerated === undefined
                ? <li key={k.scale}>{fmtInt(k.scale)} NPU: {t('strategy.rowToday')} A_op {p(k.todayAopDerated)}{k.todayEffectiveDerated !== undefined ? ` · G_eff ${p(k.todayEffectiveDerated, 2)}` : ''}{k.todayDeliveredDerated !== undefined ? ` · G_del ${p(k.todayDeliveredDerated, 2)}` : ''} · {k.feasible === false ? t('strategy.rowAllMoves') : t('strategy.rowRecommended')} A_op {p(k.recommendedAopDerated)}{k.recommendedEffectiveDerated !== undefined ? ` · G_eff ${p(k.recommendedEffectiveDerated, 2)}` : ''}{k.recommendedDeliveredDerated !== undefined ? ` · G_del ${p(k.recommendedDeliveredDerated, 2)}` : ''} ({k.mechanisms.join(' + ') || '—'}{k.feasible === false ? '' : ` · k ${k.k.toFixed(3)}`})</li>
                : <li key={k.scale}>{fmtInt(k.scale)} NPU: {t('strategy.rowToday')} G_eff {p(k.todayEffectiveDerated ?? k.todayAopDerated)}{k.todayDeliveredDerated !== undefined ? ` · G_del ${p(k.todayDeliveredDerated)}` : ''} · {k.feasible === false ? t('strategy.rowAllMoves') : t('strategy.rowRecommended')} {p(k.recommendedEffectiveDerated ?? k.recommendedAopDerated)} ({k.mechanisms.join(' + ') || '—'}{k.feasible === false ? '' : ` · k ${k.k.toFixed(3)}`})</li>)}
            </ul>
            <div className="btn-row">
              <button type="button" className="btn primary" onClick={() => open(saved.html.findings, saved.files.findings)}>{t('findingsTab.open')}</button>
              <button type="button" className="btn" onClick={() => download(saved.files.findings, saved.html.findings, 'text/html')}>{t('findingsTab.downloadFindings')}</button>
              <button type="button" className="btn" onClick={() => download(saved.files.methodology, saved.html.methodology, 'text/html')}>{t('findingsTab.downloadMethodology')}</button>
              <button type="button" className="btn" onClick={() => download(saved.files.data, saved.bundle)}>{t('findingsTab.downloadData')}</button>
              <button type="button" className="btn" onClick={remove}>{t('findingsTab.delete')}</button>
            </div>
          </>
        )}
      </Card>
      {inline && (
        <Card title={inline.title} actions={<button type="button" className="btn small" onClick={() => setInline(null)}>{t('findingsTab.close')}</button>}>
          <iframe title={inline.title} srcDoc={inline.html} sandbox="allow-scripts allow-same-origin" style={{ width: '100%', height: '80vh', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--surface)' }} />
        </Card>
      )}
    </div>
  );
}
