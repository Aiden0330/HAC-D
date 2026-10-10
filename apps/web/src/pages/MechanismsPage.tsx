import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MECHANISM_LIBRARY, DEFAULT_PLAYERS, activeMechanisms, applyMechanisms, stripMechanisms, type MechanismReport, type AttributionMetric } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { compute } from '../worker/client.js';
import { Kpi, Card, DataTable, Field, Select, Badge, NumberInput } from '../components/ui.js';
import { Tornado } from '../charts/Tornado.js';
import { fmtPct, fmtNum } from '../lib/format.js';

const METRICS: AttributionMetric[] = ['delivered', 'effective', 'aOp'];

export function MechanismsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const updateActive = useStore((s) => s.updateActive);
  const [players, setPlayers] = useState<string[]>(DEFAULT_PLAYERS);
  const [metric, setMetric] = useState<AttributionMetric>('delivered');
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({});
  const [report, setReport] = useState<MechanismReport | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scenarioKey = active ? JSON.stringify(active.scenario) : '';
  useEffect(() => setReport(null), [scenarioKey]);
  const inScenario = useMemo(() => (active && !active.error ? activeMechanisms(active.scenario) : []), [active]);
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  if (active.scenario.workload.type !== 'training') return <div className="callout">{t('mechanisms.notTraining')}</div>;
  const applicable = MECHANISM_LIBRARY.filter((m) => m.apply);
  const name = (m: (typeof MECHANISM_LIBRARY)[number]) => (lang === 'zh' ? m.name.zh : m.name.en);
  const toggle = (id: string) => setPlayers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const run = async () => {
    if (players.length === 0) {
      setErr(t('mechanisms.noPlayers'));
      return;
    }
    if (players.length > 10) {
      setErr(t('mechanisms.tooMany'));
      return;
    }
    setRunning(true);
    setErr(null);
    try {
      setReport(await compute().mechanisms(active.scenario, players, { metric, parameters: overrides }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const fmtMetric = (v: number) => fmtPct(v, 2);
  const pts = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(3)} pt`;
  const base = report ? report.baseline[report.metric] : 0;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('mechanisms.title')}</h1>
        <span className="sub">{t('mechanisms.sub')}</span>
      </div>
      <Card title={t('mechanisms.players')} sub={t('mechanisms.hint')}>
        <div className="btn-row">
          {applicable.map((m) => (
            <button key={m.id} type="button" className="btn small" aria-pressed={players.includes(m.id)} onClick={() => toggle(m.id)} title={lang === 'zh' ? m.change.zh : m.change.en}>
              {m.id} · {name(m)}{inScenario.includes(m.id) ? ' ●' : ''}
            </button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label={t('mechanisms.metric')}>
            <Select value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m, label: t(`mechanisms.metric_${m}`) }))} />
          </Field>
          <div className="field" style={{ justifyContent: 'end' }}>
            <button type="button" className="btn primary" disabled={running} onClick={run}>{running ? t('mechanisms.running') : t('mechanisms.run')}</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>● {t('mechanisms.inScenario')}</div>
        {err && <div className="callout crit" style={{ marginTop: 8 }}>{err}</div>}
      </Card>
      {report && (
        <>
          <div className="kpi-row">
            <Kpi label={t('mechanisms.baseline')} value={fmtMetric(report.baseline[report.metric])} note={`${t('mechanisms.metric_' + report.metric)} · A_op ${fmtPct(report.baseline.aOp, 3)}`} />
            <Kpi label={t('mechanisms.combined')} value={fmtMetric(report.combined[report.metric])} note={`A_op ${fmtPct(report.combined.aOp, 3)}`} hero />
            <Kpi label={t('mechanisms.delta')} value={pts(report.delta)} note={`${report.coalitions} ${t('mechanisms.coalitions')}`} />
            <Kpi label={t('mechanisms.interaction')} value={pts(report.interaction)} note={`Σ Shapley − Δ = ${report.residual.toExponential(1)}`} />
          </div>
          <div className="grid cols-2">
            <Card>
              <Tornado title={t('mechanisms.singleChart')} base={base} items={report.gains.map((g) => ({ name: g.id, low: Math.min(base, base + g.single), high: Math.max(base, base + g.single), lowLabel: g.single < 0 ? pts(g.single) : '', highLabel: g.single >= 0 ? pts(g.single) : '' }))} format={fmtMetric} metricLabel={t('mechanisms.metric_' + report.metric)} legendLow={t('mechanisms.legendLoss')} legendHigh={t('mechanisms.legendGain')} />
            </Card>
            <Card>
              <Tornado title={t('mechanisms.shapleyChart')} base={base} items={report.gains.map((g) => ({ name: g.id, low: Math.min(base, base + g.shapley), high: Math.max(base, base + g.shapley), lowLabel: g.shapley < 0 ? pts(g.shapley) : '', highLabel: g.shapley >= 0 ? pts(g.shapley) : '' }))} format={fmtMetric} metricLabel={t('mechanisms.metric_' + report.metric)} legendLow={t('mechanisms.legendLoss')} legendHigh={t('mechanisms.legendGain')} />
            </Card>
          </div>
          <Card formula="φ_i = Σ_S |S|!(n−|S|−1)!/n! · [v(S ∪ {i}) − v(S)] over all coalitions S ∌ i; Σ φ_i = v(all) − v(∅)">
            <DataTable
              columns={['', t('mechanisms.valueCol'), t('mechanisms.single'), t('mechanisms.lastAdded'), t('mechanisms.shapley'), t('mechanisms.share')]}
              rows={report.gains
                .slice()
                .sort((a, b) => b.shapley - a.shapley)
                .map((g) => {
                  const m = MECHANISM_LIBRARY.find((x) => x.id === g.id)!;
                  return [`${g.id} · ${name(m)}`, fmtMetric(g.values[report.metric]), pts(g.single), pts(g.lastAdded), pts(g.shapley), fmtPct(g.share, 1)];
                })}
            />
            <ul className="plain muted" style={{ fontSize: 12, marginTop: 6 }}>
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
      <Card title={t('mechanisms.library')} sub={t('mechanisms.paramHint')}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('mechanisms.kind')}</th>
                <th>{t('mechanisms.status')}</th>
                <th>{t('mechanisms.change')}</th>
                <th>{t('mechanisms.prerequisite')}</th>
                <th>{t('mechanisms.failure')}</th>
                <th>{t('mechanisms.parameters')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {MECHANISM_LIBRARY.map((m) => {
                const on = inScenario.includes(m.id);
                const params = { ...m.parameters, ...(overrides[m.id] ?? {}) };
                return (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <b>{m.id}</b>
                      <div className="muted" style={{ fontSize: 11 }}>{name(m)}</div>
                      <div className="muted" style={{ fontSize: 10 }}>{m.confidence}</div>
                    </td>
                    <td>{m.kind}</td>
                    <td><Badge status={m.status === 'baseline' ? 'pass' : m.status === 'informational' ? 'none' : 'warn'}>{t(`mechanisms.status_${m.status}`)}</Badge></td>
                    <td style={{ fontSize: 12, minWidth: 220 }}>{lang === 'zh' ? m.change.zh : m.change.en}</td>
                    <td style={{ fontSize: 12, minWidth: 160 }}>{lang === 'zh' ? m.prerequisite.zh : m.prerequisite.en}</td>
                    <td style={{ fontSize: 12, minWidth: 160 }}>{lang === 'zh' ? m.failure.zh : m.failure.en}</td>
                    <td style={{ minWidth: 150 }}>
                      {Object.keys(params).length === 0 ? <span className="muted">—</span> : Object.entries(params).map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
                          <span className="mono" style={{ minWidth: 90 }}>{k}</span>
                          <NumberInput value={v} min={0} step={k.toLowerCase().includes('coverage') || k === 'success' || k === 'reduction' ? 0.01 : 1} onChange={(x) => setOverrides((o) => ({ ...o, [m.id]: { ...(o[m.id] ?? {}), [k]: x } }))} />
                        </div>
                      ))}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {m.apply && (on ? (
                        <button type="button" className="btn small" onClick={() => updateActive((s) => stripMechanisms(s, [m.id]))} disabled={!['D-SDC', 'R-SDC', 'R-REPLAY', 'R-PROCESS', 'R-ELASTIC'].includes(m.id)}>{t('mechanisms.remove')}</button>
                      ) : (
                        <button type="button" className="btn small" onClick={() => updateActive((s) => applyMechanisms(s, [m.id], overrides))}>{t('mechanisms.apply')}</button>
                      ))}
                      {on && <div className="muted" style={{ fontSize: 10 }}>● {t('mechanisms.inScenario')}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{fmtNum(MECHANISM_LIBRARY.length, 0)} · ai-cluster-reliability catalogs/review-2026-10-09/mechanisms.json · mechanism-policy.json</div>
      </Card>
    </div>
  );
}
