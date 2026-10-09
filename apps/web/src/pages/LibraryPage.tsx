import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterLibrary, recordToFailureRate, LIBRARY_CLASSES, type Library, type LibraryRecord } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { Card, Field, Select, Badge } from '../components/ui.js';

let cached: Library | null = null;

export function LibraryPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const updateActive = useStore((s) => s.updateActive);
  const [lib, setLib] = useState<Library | null>(cached);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cls, setCls] = useState('');
  const [conf, setConf] = useState('');
  const [stage, setStage] = useState('');
  const [query, setQuery] = useState('');
  const [ratesOnly, setRatesOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [targetState, setTarget] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  // the target component must belong to the active scenario (it changes when the user switches scenarios)
  const componentIds = active?.scenario.components.map((c) => c.id) ?? [];
  const target = componentIds.includes(targetState) ? targetState : componentIds[0] ?? '';

  useEffect(() => {
    if (cached) return;
    setLoadError(null);
    import('@hac-d/core/library.json')
      .then((m) => {
        cached = (m.default ?? m) as unknown as Library;
        setLib(cached);
      })
      .catch((e: unknown) => setLoadError(`${(e as Error).message ?? String(e)} — reload the page (a stale build can no longer find its library chunk)`));
  }, [attempt]);

  const rows = useMemo(() => (lib ? filterLibrary(lib, { class: cls || undefined, confidence: conf || undefined, stage: stage || undefined, query, ratesOnly }) : []), [lib, cls, conf, stage, query, ratesOnly]);

  const useAsRate = (r: LibraryRecord) => {
    const fr = recordToFailureRate(r);
    if (!fr || !target) return;
    updateActive((s) => ({
      ...s,
      components: s.components.map((c) =>
        c.id === target
          ? {
              ...c,
              failure: {
                ...c.failure,
                value: fr.value,
                unit: fr.unit,
                koujing: { event: r.koujing.event, denominator: r.koujing.denominator, level: (['component', 'node', 'job', 'fleet'].includes(r.koujing.level) ? r.koujing.level : 'component') as 'component' | 'node' | 'job' | 'fleet', includesPlanned: r.koujing.includes_planned ?? false, dedup: r.koujing.dedup ?? null },
                provenance: { source: r.provenance.source, org: r.provenance.org, venue: r.provenance.venue, year: r.provenance.year, url: r.provenance.url ?? undefined, surveyRef: r.provenance.survey_ref, confidence: (r.provenance.confidence as 'measured') ?? 'measured', derivation: r.provenance.derivation ?? undefined },
              },
            }
          : c,
      ),
    }));
    setMsg(`${target} ← ${r.id}: ${fr.value} ${fr.unit}`);
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('library.title')}</h1>
        <span className="sub">{t('library.sub')}</span>
      </div>
      <Card>
        <div className="form-grid">
          <Field label={t('library.query')}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Llama, TrainMover, HBM…" /></Field>
          <Field label={t('library.class')}><Select value={cls} onChange={setCls} options={[{ value: '', label: '—' }, ...LIBRARY_CLASSES.map((c) => ({ value: c, label: c }))]} /></Field>
          <Field label={t('library.confidence')}><Select value={conf} onChange={setConf} options={[{ value: '', label: '—' }, ...['measured', 'paper-reported', 'derived', 'vendor', 'scan-level', 'assumed'].map((c) => ({ value: c, label: c }))]} /></Field>
          <Field label={t('library.stage')}><Select value={stage} onChange={setStage} options={[{ value: '', label: '—' }, ...['detect', 'localize', 'remediate', 'restart', 'load', 'recompute', 'warmup', 'serving_restart', 'end_to_end'].map((c) => ({ value: c, label: c }))]} /></Field>
          <div className="field"><label>{t('library.ratesOnly')}</label><input type="checkbox" checked={ratesOnly} onChange={(e) => setRatesOnly(e.target.checked)} /></div>
          {active && (
            <Field label={t('library.use')} hint={msg ?? undefined}>
              <Select value={target} onChange={setTarget} options={active.scenario.components.map((c) => ({ value: c.id, label: c.id }))} />
            </Field>
          )}
        </div>
      </Card>
      <Card title={`${rows.length} ${t('library.records')}${lib ? ` / ${lib.records.length}` : ''}`}>
        {!lib && !loadError && <div className="muted">{t('library.loading')}</div>}
        {loadError && (
          <div className="callout crit">
            {loadError} <button type="button" className="btn small" onClick={() => setAttempt((a) => a + 1)}>{t('common.reset')}</button>
          </div>
        )}
        {msg && <div className="callout" style={{ marginBottom: 8 }}>{t('library.applied')}: {msg}</div>}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{t('common.name')}</th><th>{t('library.class')}</th><th className="num">{t('common.value')}</th><th>{t('common.unit')}</th><th>{t('common.koujing')}</th><th>{t('common.source')}</th><th>{t('library.confidence')}</th><th></th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                    <td>{lang === 'zh' ? r.name.zh ?? r.name.en : r.name.en ?? r.name.zh}</td>
                    <td className="mono">{r.class}{r.applicability.stage ? ` · ${r.applicability.stage}` : ''}</td>
                    <td className="num">{r.value === null ? '—' : Math.abs(r.value) < 0.001 ? r.value.toExponential(3) : Number(r.value.toPrecision(6)).toLocaleString('en-US')}</td>
                    <td className="mono">{r.unit}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{r.koujing.event} / {r.koujing.denominator} / {r.koujing.level}</td>
                    <td style={{ fontSize: 12 }}>{r.provenance.org ? `${r.provenance.org} · ` : ''}{r.provenance.venue ?? ''} {r.provenance.year ?? ''}</td>
                    <td><Badge status={r.provenance.confidence}>{r.provenance.confidence}</Badge></td>
                    <td>{recordToFailureRate(r) && active ? <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); useAsRate(r); }}>{t('library.use')}</button> : null}</td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--surface-3)' }}>
                        <div className="grid cols-2" style={{ fontSize: 12 }}>
                          <div>
                            <div><b>{t('library.applicability')}:</b> {[r.applicability.hardware, r.applicability.scale, r.applicability.period, r.applicability.phase, r.applicability.workload, r.applicability.setting].filter(Boolean).join(' · ')}</div>
                            {r.caveat && <div><b>{t('library.caveat')}:</b> {lang === 'zh' ? r.caveat.zh ?? r.caveat.en : r.caveat.en ?? r.caveat.zh}</div>}
                            {r.provenance.derivation && <div><b>{t('library.derivation')}:</b> <span className="mono">{r.provenance.derivation}</span></div>}
                          </div>
                          <div>
                            <div><b>{t('common.source')}:</b> {r.provenance.source}{r.provenance.url ? <> · <a href={r.provenance.url} target="_blank" rel="noreferrer">link</a></> : null}</div>
                            <div><b>survey:</b> {r.provenance.survey_ref ?? '—'} · <span className="mono">{r.id}</span></div>
                            {r.range && (r.range.low !== null || r.range.high !== null) && <div><b>range:</b> {r.range.low ?? '—'} – {r.range.high ?? '—'}</div>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
