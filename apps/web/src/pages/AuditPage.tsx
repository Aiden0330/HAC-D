import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MECHANISM_LIBRARY, DEFAULT_STUDY_PLAYERS, auditReportHtml, studyReportHtml, integrationStatus, type AuditReport, type StudyResult, type StudyMetric, type Scenario } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useLang } from '../hooks.js';
import { compute, cancelCompute, progressCallback, ComputeCancelled } from '../worker/client.js';
import { Card, DataTable, Field, Select, NumberInput, Kpi } from '../components/ui.js';
import { download } from '../lib/export.js';
import { fmtPct } from '../lib/format.js';

const METRICS: StudyMetric[] = ['aOp', 'delivered', 'effective'];
const parseSizes = (s: string) => s.split(/[,，\s]+/).map((x) => Number(x.replace(/[kK]$/, '000').replace(/[mM]$/, '000000'))).filter((n) => Number.isFinite(n) && n > 0);

export function AuditPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const theme = useStore((s) => s.theme);
  const scenarios = useStore((s) => s.scenarios);
  const activeId = useStore((s) => s.activeId);
  const catalogId = scenarios.find((x) => x.meta.id?.startsWith('ref-catalog'))?.meta.id;
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const targetId = chosenId && scenarios.some((x) => x.meta.id === chosenId) ? chosenId : catalogId ?? activeId;
  const scenario: Scenario | undefined = scenarios.find((x) => x.meta.id === targetId);
  const builtin = useMemo(() => MECHANISM_LIBRARY.filter((m) => !m.audit), []);
  const audited = useMemo(() => MECHANISM_LIBRARY.filter((m) => !!m.audit), []);
  const name = (id: string) => { const m = MECHANISM_LIBRARY.find((x) => x.id === id); return m ? (lang === 'zh' ? m.name.zh : m.name.en) : id; };
  // ---- single-point audit ----
  const [ids, setIds] = useState<string[]>(() => audited.map((m) => m.id));
  const [provisional, setProvisional] = useState(false);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [auditHtml, setAuditHtml] = useState('');
  // ---- allocation study ----
  const [sizesText, setSizesText] = useState('10000, 100000, 200000, 500000');
  const [target, setTarget] = useState(0.985);
  const [metric, setMetric] = useState<StudyMetric>('aOp');
  const [players, setPlayers] = useState<string[]>(DEFAULT_STUDY_PLAYERS);
  const [provStudy, setProvStudy] = useState(false);
  const [trials, setTrials] = useState(200);
  const [seed, setSeed] = useState(1);
  const [derate, setDerate] = useState(true);
  const [levers, setLevers] = useState(true);
  const [curves, setCurves] = useState(true);
  const [study, setStudy] = useState<StudyResult | null>(null);
  const [studyHtml, setStudyHtml] = useState('');
  const [busy, setBusy] = useState<'audit' | 'study' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: string } | null>(null);
  const [err, setErr] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  const fail = (e: unknown) => setErr(e instanceof ComputeCancelled ? { text: t('audit.cancelled'), tone: 'info' } : { text: (e as Error).message, tone: 'crit' });
  if (!scenario) return <div className="callout crit">No scenario</div>;
  if (scenario.workload.type !== 'training') return <div className="callout">{t('audit.notTraining')}</div>;
  const themed = (html: string) => (theme === 'auto' ? html : html.replace(/<html lang="([^"]+)">/, `<html lang="$1" data-theme="${theme}">`));
  const toggle = (set: (f: (p: string[]) => string[]) => void, id: string) => set((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const runAudit = async () => {
    if (!ids.length) { setErr({ text: t('audit.noMechanisms'), tone: 'crit' }); return; }
    setBusy('audit'); setErr(null);
    try {
      const rep = await compute().audit(scenario, { ids, provisional });
      setAudit(rep);
      setAuditHtml(auditReportHtml(rep, lang));
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const runStudy = async () => {
    const sizes = parseSizes(sizesText);
    if (!sizes.length) { setErr({ text: t('audit.badSizes'), tone: 'crit' }); return; }
    if (!players.length) { setErr({ text: t('audit.noMechanisms'), tone: 'crit' }); return; }
    setBusy('study'); setErr(null); setProgress({ done: 0, total: sizes.length + 1 });
    try {
      const r = await compute().study(scenario, { sizes, target, metric, players, provisional: provStudy, trials, seed, derate: derate ? undefined : null, levers, curves }, progressCallback((done: number, total: number, phase: string) => setProgress({ done, total, phase })));
      setStudy(r);
      setStudyHtml(studyReportHtml(r, lang));
    } catch (e) { fail(e); } finally { setBusy(null); setProgress(null); }
  };
  const fmtVal = (v: number, unit: string) => (unit === 'fraction' ? `${(v * 100).toFixed(1)} %` : unit === 'FIT' ? `${v.toFixed(2)} FIT` : `${v.toFixed(v >= 100 ? 1 : 2)} s`);
  const pts = (v: number, d = 3) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)} pt`;
  const mechButtons = (list: typeof MECHANISM_LIBRARY, sel: string[], set: (f: (p: string[]) => string[]) => void) => (
    <div className="btn-row">
      {list.map((m) => {
        const st = integrationStatus(m, { ...m.parameters, ...(m.provisional ?? {}) });
        return (
          <button key={m.id} type="button" className="btn small" aria-pressed={sel.includes(m.id)} onClick={() => toggle(set, m.id)} title={`${lang === 'zh' ? m.change.zh : m.change.en}${m.integrationNeeds?.length ? ` · ${t('audit.needs')}: ${m.integrationNeeds.join(', ')}` : ''}`}>
            {m.id} · {name(m.id)}{m.integrationNeeds?.length ? (st.ready ? ' ◐' : ' ○') : ''}
          </button>
        );
      })}
    </div>
  );
  const progressText = progress ? ` ${progress.phase ? t(`audit.phase_${progress.phase}`) + ' ' : ''}${progress.done} / ${progress.total}` : '';
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('audit.title')}</h1>
        <span className="sub">{t('audit.sub')}</span>
      </div>
      <Card>
        <div className="form-grid">
          <Field label={t('audit.scenarioFor')} hint={t('audit.defaultCatalog')}>
            <Select value={targetId ?? ''} onChange={setChosenId} options={scenarios.map((x) => ({ value: x.meta.id!, label: `${x.meta.name}${x.meta.id === activeId ? ` (${t('mechanisms.activeTag')})` : ''}` }))} />
          </Field>
        </div>
        {err && <div className={`callout ${err.tone === 'crit' ? 'crit' : ''}`} style={{ marginTop: 8 }}>{err.text}</div>}
      </Card>

      <Card title={t('audit.auditTitle')} sub={t('audit.auditSub')} formula="常规损失 = T_det + T_auto + W；期望损失 = T_det + T_auto + p_manual·T_manual + W；同一阶段取最小，不相加">
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('audit.audited')} ({audited.length})</div>
        {mechButtons(audited, ids, setIds)}
        <div className="muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>{t('audit.builtin')} ({builtin.length})</div>
        {mechButtons(builtin, ids, setIds)}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, whiteSpace: 'nowrap' }} title={t('audit.provisionalHint')}><input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} />{t('audit.provisionalShort')}</label>
          <div className="btn-row">
            <button type="button" className="btn small" onClick={() => setIds(MECHANISM_LIBRARY.map((m) => m.id))}>{t('audit.selectAll')}</button>
            <button type="button" className="btn small" onClick={() => setIds(audited.map((m) => m.id))}>{t('audit.selectAudited')}</button>
            <button type="button" className="btn small" onClick={() => setIds([])}>{t('audit.selectNone')}</button>
            <button type="button" className="btn primary" disabled={busy !== null} onClick={runAudit}>{busy === 'audit' ? t('common.running') : t('audit.runAudit')}</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('audit.provisionalHint')}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>◐ {t('audit.legendReady')} · ○ {t('audit.legendMissing')}</div>
        {audit && (
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <div className="kpi-row">
              <Kpi label={t('audit.kpiNormal')} value={`${audit.baseline.normalLossS.toFixed(1)} s`} note={`${audit.baseline.detectS.toFixed(1)} + ${audit.baseline.autoS.toFixed(0)} + ${audit.baseline.rollbackS.toFixed(0)} s`} />
              <Kpi label={t('audit.kpiExpected')} value={`${audit.baseline.expectedLossS.toFixed(1)} s`} note={`p_manual ${(audit.baseline.manualProbability * 100).toFixed(1)} % × ${audit.baseline.manualS.toFixed(0)} s`} />
              <Kpi label={t('audit.kpiStages')} value={`${audit.stageBudget.startup.toFixed(0)} / ${audit.stageBudget.read.toFixed(0)} / ${audit.stageBudget.communication.toFixed(0)} s`} note={t('audit.kpiStagesNote')} />
              <Kpi label={t('audit.kpiBaseline')} value={`A_op ${fmtPct(audit.baselineValues.aOp, 2)}`} note={`${t('mechanisms.metric_delivered')} ${fmtPct(audit.baselineValues.delivered, 1)} · ${audit.scenario.nGpus.toLocaleString('en-US')}`} />
            </div>
            <DataTable
              columns={[t('audit.colMech'), t('audit.colMetric'), t('audit.colBaseline'), t('audit.colGain'), 'ΔA_op', `Δ${t('mechanisms.metric_delivered')}`, t('audit.colStatus')]}
              numericFrom={2}
              rows={audit.rows.map((r) => {
                const sp = r.singlePoint;
                const status = r.cluster ? (r.integration.provisional ? t('audit.statusProvisional') : t('audit.statusReady')) : r.integration.missing.length ? `${t('audit.statusMissing')}: ${r.integration.missing.join(', ')}` : t('audit.statusAuditOnly');
                return [`${r.id} · ${lang === 'zh' ? r.name.zh : r.name.en}`, sp ? (lang === 'zh' ? sp.metric.zh : sp.metric.en) : '—', sp ? `${fmtVal(sp.before, sp.unit)} → ${fmtVal(sp.after, sp.unit)}` : '—', sp ? (sp.unit === 'fraction' && sp.direction === 'increase' ? `+${(sp.improvement * 100).toFixed(1)} pt` : sp.unit === 'fraction' ? `× ${sp.after.toFixed(3)}` : `−${fmtVal(sp.improvement, sp.unit)}${sp.reductionFraction !== undefined ? ` (${(sp.reductionFraction * 100).toFixed(1)} %)` : ''}`) : '—', r.cluster ? pts(r.cluster.aOp) : '—', r.cluster ? pts(r.cluster.delivered, 2) : '—', status];
              })}
            />
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => download(`${scenario.meta.id ?? 'scenario'}-mechanism-audit.html`, themed(auditHtml), 'text/html')}>{t('audit.downloadHtml')}</button>
              <button type="button" className="btn" onClick={() => download(`${scenario.meta.id ?? 'scenario'}-mechanism-audit.json`, JSON.stringify(audit, null, 2))}>{t('audit.downloadJson')}</button>
            </div>
            <details open>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>{t('audit.preview')}</summary>
              <iframe title="audit-report" srcDoc={themed(auditHtml)} sandbox="allow-same-origin allow-scripts allow-downloads allow-modals allow-popups" style={{ width: '100%', height: 760, border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--surface)', marginTop: 6 }} />
            </details>
          </div>
        )}
      </Card>

      <Card title={t('audit.studyTitle')} sub={t('audit.studySub')} formula="(1 − A*)/A* ≥ Σ λᵢ·p̄ᵢ；f_hw、g_rec 二分；min Σ effort s.t. v(S) ≥ target（名义与降额）；Shapley 全组合精确（≤ 12）或置换抽样">
        <div className="form-grid">
          <Field label={t('audit.sizes')} hint={t('audit.sizesHint')}><input value={sizesText} onChange={(e) => setSizesText(e.target.value)} /></Field>
          <Field label={t('audit.target')}><NumberInput value={target} min={0.5} max={0.9999} step={0.005} onChange={setTarget} /></Field>
          <Field label={t('mechanisms.metric')}><Select value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m, label: t(`mechanisms.metric_${m}`) }))} /></Field>
          <Field label={t('audit.trials')} hint={t('audit.trialsHint')}><NumberInput value={trials} min={0} max={5000} step={50} onChange={setTrials} /></Field>
          <Field label={t('audit.seed')}><NumberInput value={seed} min={1} max={1e9} step={1} onChange={setSeed} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, fontSize: 13 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('audit.options')}:</span>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={derate} onChange={(e) => setDerate(e.target.checked)} />{t('mechanisms.planDerate')}</label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={levers} onChange={(e) => setLevers(e.target.checked)} />{t('audit.levers')}</label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={curves} onChange={(e) => setCurves(e.target.checked)} />{t('audit.curves')}</label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }} title={t('audit.provisionalHint')}><input type="checkbox" checked={provStudy} onChange={(e) => setProvStudy(e.target.checked)} />{t('audit.provisionalShort')}</label>
        </div>
        <div className="muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>{t('audit.players')} ({players.length}) · {t('audit.playersHint')}</div>
        {mechButtons(MECHANISM_LIBRARY.filter((m) => m.apply), players, setPlayers)}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn small" onClick={() => setPlayers(DEFAULT_STUDY_PLAYERS)}>{t('audit.defaultPlayers')}</button>
          <button type="button" className="btn primary" disabled={busy !== null} onClick={runStudy}>{busy === 'study' ? t('audit.running') + progressText : t('audit.runStudy')}</button>
          {busy === 'study' && <button type="button" className="btn" onClick={cancelCompute}>{t('mechanisms.cancel')}</button>}
        </div>
        {study && (
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <DataTable
              columns={[t('audit.colSize'), t('audit.colBase'), t('audit.colPlan'), t('audit.colValues'), t('audit.colResidual'), t('audit.colVerify')]}
              numericFrom={1}
              rows={study.sizes.map((N) => {
                const z = study.perSize[N];
                return [N.toLocaleString('en-US'), fmtPct(z.baseline.value, 2), `${z.plan.feasible ? '' : `${t('audit.infeasible')} `}${z.plan.ids.join(' + ') || t('audit.none')} · ${z.plan.effort}${z.plan.method === 'greedy' ? ` · ${t('audit.greedy')}` : ''}`, `${fmtPct(z.plan.nominal, 2)} / ${fmtPct(z.plan.derated, 2)}`, `× ${z.residualFactor.plan.toFixed(2)} / × ${z.residualFactor.planDerated.toFixed(2)}`, z.verification ? `${fmtPct(z.verification.pAtLeastTarget, 1)} [${fmtPct(z.verification.wilson[0], 1)}–${fmtPct(z.verification.wilson[1], 1)}] · ${t('mechanisms.verdict_' + z.verification.verdict)}` : '—'];
              })}
            />
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => download(`${scenario.meta.id ?? 'scenario'}-allocation-study.html`, themed(studyHtml), 'text/html')}>{t('audit.downloadHtml')}</button>
              <button type="button" className="btn" onClick={() => download(`${scenario.meta.id ?? 'scenario'}-allocation-study.json`, JSON.stringify(study, null, 2))}>{t('audit.downloadJson')}</button>
            </div>
            <details open>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>{t('audit.preview')}</summary>
              <iframe title="study-report" srcDoc={themed(studyHtml)} sandbox="allow-same-origin allow-scripts allow-downloads allow-modals allow-popups" style={{ width: '100%', height: 900, border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--surface)', marginTop: 6 }} />
            </details>
            <ul className="plain muted" style={{ fontSize: 12 }}>{study.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
      </Card>
    </div>
  );
}
