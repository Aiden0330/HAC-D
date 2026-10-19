import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MECHANISM_LIBRARY, auditReportHtml, integrationStatus, type AuditReport, type Scenario } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useLang } from '../hooks.js';
import { compute, ComputeCancelled } from '../worker/client.js';
import { Card, DataTable, Kpi } from '../components/ui.js';
import { download } from '../lib/export.js';
import { fmtPct } from '../lib/format.js';


/** v4 the single-point benefit audit of the former Audit page, now a tab of the Mechanisms page (on the scenario chosen there) */
export function AuditPanel({ scenario }: { scenario: Scenario }) {
  const { t } = useTranslation();
  const lang = useLang();
  const theme = useStore((s) => s.theme);
  const builtin = useMemo(() => MECHANISM_LIBRARY.filter((m) => !m.audit), []);
  const audited = useMemo(() => MECHANISM_LIBRARY.filter((m) => !!m.audit), []);
  const name = (id: string) => { const m = MECHANISM_LIBRARY.find((x) => x.id === id); return m ? (lang === 'zh' ? m.name.zh : m.name.en) : id; };
  const [ids, setIds] = useState<string[]>(() => audited.map((m) => m.id));
  const [provisional, setProvisional] = useState(false);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [auditHtml, setAuditHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  const fail = (e: unknown) => setErr(e instanceof ComputeCancelled ? { text: t('audit.cancelled'), tone: 'info' } : { text: (e as Error).message, tone: 'crit' });
  if (scenario.workload.type !== 'training') return <div className="callout">{t('audit.notTraining')}</div>;
  const themed = (html: string) => (theme === 'auto' ? html : html.replace(/<html lang="([^"]+)">/, `<html lang="$1" data-theme="${theme}">`));
  const toggle = (set: (f: (p: string[]) => string[]) => void, id: string) => set((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const runAudit = async () => {
    if (!ids.length) { setErr({ text: t('audit.noMechanisms'), tone: 'crit' }); return; }
    setBusy(true); setErr(null);
    try {
      const rep = await compute().audit(scenario, { ids, provisional });
      setAudit(rep);
      setAuditHtml(auditReportHtml(rep, lang));
    } catch (e) { fail(e); } finally { setBusy(false); }
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
  return (
    <Card title={t('audit.auditTitle')} sub={t('audit.auditSub')} formula="常规损失 = T_det + T_auto + W；期望损失 = T_det + T_auto + p_manual·T_manual + W；同一阶段取最小，不相加">
      {err && <div className={`callout ${err.tone === 'crit' ? 'crit' : ''}`} style={{ marginBottom: 8 }}>{err.text}</div>}
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
          <button type="button" className="btn primary" disabled={busy} onClick={runAudit}>{busy ? t('common.running') : t('audit.runAudit')}</button>
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
            <Kpi label={t('audit.kpiBaseline')} value={`A_op ${fmtPct(audit.baselineValues.aOp, 2)}`} note={`${t('mechanisms.metric_delivered')} ${fmtPct(audit.baselineValues.delivered, 1)} · ${audit.scenario.nGpus.toLocaleString('en-US')} NPU`} />
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
  );
}
