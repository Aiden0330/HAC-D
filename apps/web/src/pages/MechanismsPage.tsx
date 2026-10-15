import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MECHANISM_LIBRARY, DEFAULT_PLAYERS, activeMechanisms, applyMechanisms, stripMechanisms, isStrippable, evaluateScenario, provisionalParameters, integrationStatus, type MechanismReport, type AttributionMetric, type MechanismPlan, type Scenario } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useLang } from '../hooks.js';
import { compute, cancelCompute, progressCallback, ComputeCancelled } from '../worker/client.js';
import { Kpi, Card, DataTable, Field, Select, Badge, NumberInput } from '../components/ui.js';
import { Tornado } from '../charts/Tornado.js';
import { Heatmap } from '../charts/Heatmap.js';
import { fmtPct, fmtNum } from '../lib/format.js';

const METRICS: AttributionMetric[] = ['delivered', 'effective', 'aOp'];

export function MechanismsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const scenarios = useStore((s) => s.scenarios);
  const activeId = useStore((s) => s.activeId);
  const replaceScenario = useStore((s) => s.replaceScenario);
  // the page attributes on the 54-event reference catalog by default (per-event mechanism flags reproduce combinations
  // exactly); any scenario can be chosen here; the other pages keep working on the active scenario
  const catalogId = scenarios.find((x) => x.meta.id?.startsWith('ref-catalog'))?.meta.id;
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const targetId = chosenId && scenarios.some((x) => x.meta.id === chosenId) ? chosenId : catalogId ?? activeId;
  const scenario: Scenario | undefined = scenarios.find((x) => x.meta.id === targetId);
  const scenarioKey = scenario ? JSON.stringify(scenario) : '';
  const active = useMemo(() => {
    if (!scenario) return undefined;
    try {
      return { scenario, result: evaluateScenario(scenario) };
    } catch (e) {
      return { scenario, result: undefined, error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioKey]);
  const updateActive = (fn: (s: Scenario) => Scenario) => {
    if (scenario?.meta.id) replaceScenario(scenario.meta.id, fn(scenario));
  };
  const [players, setPlayers] = useState<string[]>(DEFAULT_PLAYERS);
  const [metric, setMetric] = useState<AttributionMetric>('delivered');
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({});
  // v3.7 audited mechanisms carry null integration fields: with the switch on, the provisional assumptions (tagged assumed) are merged below the user's overrides
  const [provisional, setProvisional] = useState(false);
  const paramsFor = (ids: string[]) => { const base = provisional ? provisionalParameters(ids) : {}; const out: Record<string, Record<string, number>> = { ...base }; for (const [id, p] of Object.entries(overrides)) out[id] = { ...(out[id] ?? {}), ...p }; return out; };
  const [report, setReport] = useState<MechanismReport | null>(null);
  const [plan, setPlan] = useState<MechanismPlan | null>(null);
  const [planTarget, setPlanTarget] = useState<number>(scenario?.targets.goodput ?? 0.9);
  const [derate, setDerate] = useState(true);
  const [verify, setVerify] = useState(true);
  const [trials, setTrials] = useState(200);
  const [confidence, setConfidence] = useState(0.9);
  const [efforts, setEfforts] = useState<Record<string, number>>({});
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: string } | null>(null);
  const [err, setErr] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  const fail = (e: unknown) => setErr(e instanceof ComputeCancelled ? { text: t('mechanisms.cancelled'), tone: 'info' } : { text: (e as Error).message, tone: 'crit' });
  const busy = running || planning;
  useEffect(() => { setReport(null); setPlan(null); }, [scenarioKey]);
  const inScenario = useMemo(() => (active && !active.error ? activeMechanisms(active.scenario) : []), [active]);
  const fractional = useMemo(() => (scenario ? scenario.components.some((c) => c.enabled && c.mechanisms && Object.values(c.mechanisms).some((v) => typeof v === 'number' && v > 0 && v < 1)) : false), [scenario]);
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  if (active.scenario.workload.type !== 'training') return <div className="callout">{t('mechanisms.notTraining')}</div>;
  const applicable = MECHANISM_LIBRARY.filter((m) => m.apply);
  const name = (m: (typeof MECHANISM_LIBRARY)[number]) => (lang === 'zh' ? m.name.zh : m.name.en);
  const toggle = (id: string) => setPlayers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const checkPlayers = () => {
    if (players.length === 0) setErr({ text: t('mechanisms.noPlayers'), tone: 'crit' });
    else if (players.length > 10) setErr({ text: t('mechanisms.tooMany'), tone: 'crit' });
    else return true;
    return false;
  };
  const run = async () => {
    if (!checkPlayers()) return;
    setRunning(true);
    setErr(null);
    setProgress({ done: 0, total: 1 << players.length });
    try {
      setReport(await compute().mechanisms(active.scenario, players, { metric, parameters: paramsFor(players) }, progressCallback((done: number, total: number) => setProgress({ done, total }))));
    } catch (e) {
      fail(e);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };
  const runPlan = async () => {
    if (!checkPlayers()) return;
    setPlanning(true);
    setErr(null);
    setProgress({ done: 0, total: 1 << players.length, phase: 'coalitions' });
    try {
      setPlan(await compute().plan(active.scenario, { target: planTarget, players, metric, parameters: paramsFor(players), effort: efforts, derate: derate ? undefined : null, scan: true, verify: verify ? { trials, confidence } : undefined }, progressCallback((done: number, total: number, phase: string) => setProgress({ done, total, phase }))));
    } catch (e) {
      fail(e);
    } finally {
      setPlanning(false);
      setProgress(null);
    }
  };
  const progressText = () => (progress ? ` ${progress.phase ? t(`mechanisms.phase_${progress.phase}`) + ' ' : ''}${progress.done} / ${progress.total}` : '');
  const cancelButton = <button type="button" className="btn" onClick={cancelCompute}>{t('mechanisms.cancel')}</button>;
  const fmtMetric = (v: number) => fmtPct(v, 2);
  const pts = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(3)} pt`;
  const base = report ? report.baseline[report.metric] : 0;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('mechanisms.title')}</h1>
        <span className="sub">{t('mechanisms.sub')}</span>
      </div>
      <Card>
        <div className="form-grid">
          <Field label={t('mechanisms.scenarioFor')} hint={t('mechanisms.defaultCatalog')}>
            <Select value={targetId ?? ''} onChange={setChosenId} options={scenarios.map((x) => ({ value: x.meta.id!, label: `${x.meta.name}${x.meta.id === activeId ? ` (${t('mechanisms.activeTag')})` : ''}` }))} />
          </Field>
        </div>
        {fractional && <div className="callout warn" style={{ marginTop: 8 }}>{t('mechanisms.fractionWarn')}</div>}
      </Card>
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
            <div className="btn-row">
              <button type="button" className="btn primary" disabled={busy} onClick={run}>{running ? t('mechanisms.running') + progressText() : t('mechanisms.run')}</button>
              {running && cancelButton}
            </div>
          </div>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 13 }} title={t('audit.provisionalHint')}><input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} />{t('audit.provisionalShort')} <span className="muted" style={{ fontSize: 12 }}>({t('mechanisms.provisionalNote')})</span></label>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>● {t('mechanisms.inScenario')} · {t('mechanisms.oneJob')}</div>
        {err && <div className={`callout ${err.tone === 'crit' ? 'crit' : ''}`} style={{ marginTop: 8 }}>{err.text}</div>}
      </Card>
      <Card title={t('mechanisms.planTitle')} sub={t('mechanisms.planSub')} formula="min Σ effort_i s.t. v(S) ≥ G* and v_derated(S) ≥ G*; necessary = ∩ feasible S; Pareto over (effort, v)">
        <div className="form-grid">
          <Field label={t('mechanisms.planTarget')}><NumberInput value={planTarget} min={0.5} max={0.9999} step={0.005} onChange={setPlanTarget} /></Field>
          <Field label={t('mechanisms.planDerate')} hint={t('mechanisms.planDerateHint')}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0', fontSize: 13 }}><input type="checkbox" checked={derate} onChange={(e) => setDerate(e.target.checked)} />{t('mechanisms.planDerate')}</label>
          </Field>
          <Field label={t('mechanisms.planVerify')}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0', fontSize: 13 }}><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />{t('mechanisms.planVerify')}</label>
          </Field>
          {verify && <Field label={t('mechanisms.planTrials')}><NumberInput value={trials} min={20} max={5000} step={50} onChange={setTrials} /></Field>}
          {verify && <Field label={t('mechanisms.planConfidence')}><NumberInput value={confidence} min={0.5} max={0.999} step={0.01} onChange={setConfidence} /></Field>}
          <div className="field" style={{ justifyContent: 'end' }}>
            <div className="btn-row">
              <button type="button" className="btn primary" disabled={busy} onClick={runPlan}>{planning ? t('mechanisms.planning') + progressText() : t('mechanisms.planRun')}</button>
              {planning && cancelButton}
            </div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('mechanisms.planEffortHint')}</div>
        {plan && (
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <div className="kpi-row">
              {plan.plan ? (
                <Kpi label={t('mechanisms.planChosen')} value={plan.plan.ids.join(' + ') || '∅'} note={`${t('mechanisms.effort')} ${plan.plan.effort} · ${t('mechanisms.planValue')} ${fmtMetric(plan.plan.value)} · ${t('mechanisms.planDerated')} ${fmtMetric(plan.plan.derated)} · ${t('mechanisms.planMargin')} ${(plan.plan.margin * 100).toFixed(2)} pt`} hero />
              ) : (
                <Kpi label={t('mechanisms.planNone')} value={fmtMetric(plan.maxValue)} note={`${t('mechanisms.planMax')} · ${t('mechanisms.planDerated')} ${fmtMetric(plan.maxDerated)}${plan.bounds.provenInfeasible ? ` · ${t('mechanisms.planProven')}` : ''}`} tone="bad" hero />
              )}
              <Kpi label={t('mechanisms.planNecessary')} value={plan.necessary.join(', ') || '—'} note={`${plan.feasibleCount} / ${plan.coalitions.length} ${t('mechanisms.planFeasible')}`} />
              <Kpi label={t('mechanisms.baseline')} value={fmtMetric(plan.baseline[plan.metric])} note={`${t('mechanisms.planTarget')} ${fmtMetric(plan.target)}`} />
              <Kpi label={t('mechanisms.planBound')} value={fmtMetric(plan.bounds.finiteWindow)} note={`${t('mechanisms.planBoundNote')} ${fmtPct(plan.bounds.dutyCycle, 3)} · ${plan.bounds.bestIds.join(' + ') || '∅'}`} tone={plan.bounds.provenInfeasible ? 'bad' : undefined} />
              {plan.verification && <Kpi label={t('mechanisms.planVerification')} value={`${t('mechanisms.planPTarget')} ${fmtPct(plan.verification.pAtLeastTarget, 1)} · ${t('mechanisms.verdict_' + plan.verification.verdict)}`} note={`${t('mechanisms.wilson')} ${fmtPct(plan.verification.pLow, 1)} – ${fmtPct(plan.verification.pHigh, 1)} · ${t('mechanisms.planMean')} ${fmtPct(plan.verification.mean, 2)} ± ${fmtPct(plan.verification.ci95, 2)} · P5 ${fmtPct(plan.verification.p05, 1)} · ${plan.verification.trials} ${t('simulate.trials')}`} tone={plan.verification.verdict === 'supported' ? undefined : plan.verification.verdict === 'below' ? 'bad' : 'warn'} />}
            </div>
            <div className="grid cols-2">
              <Card title={t('mechanisms.planPareto')}>
                <DataTable columns={[t('mechanisms.planCoalition'), t('mechanisms.effort'), t('mechanisms.planValue'), t('mechanisms.planDerated'), t('mechanisms.planMargin')]} numericFrom={1} rows={plan.pareto.map((c) => [c.ids.join(' + ') || '∅', String(c.effort), fmtMetric(c.value), fmtMetric(c.derated), `${(c.margin * 100).toFixed(2)} pt${c.feasible ? ' ✓' : ''}`])} highlight={(i) => !!plan.plan && plan.pareto[i].ids.join() === plan.plan.ids.join()} />
              </Card>
              {plan.scan && plan.scan.recoverySeconds.length > 0 && (
                <Card>
                  <Heatmap title={t('mechanisms.planScan')} subtitle={plan.scan.basis} xs={plan.scan.coverages} ys={plan.scan.recoverySeconds} values={plan.scan.recoverySeconds.map((sec) => plan.scan!.coverages.map((q) => plan.scan!.cells.find((c) => c.coverage === q && c.recoverySeconds === sec)?.value ?? NaN))} formatX={(v) => fmtPct(v, 1)} formatY={(v) => `${v} s`} formatV={(v) => fmtPct(v, 1)} xLabel={t('mechanisms.planScanX')} yLabel={t('mechanisms.planScanY')} />
                </Card>
              )}
            </div>
            <ul className="plain muted" style={{ fontSize: 12 }}>
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
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
              columns={['', t('mechanisms.valueCol'), t('mechanisms.single'), t('mechanisms.lastAdded'), t('mechanisms.shapley'), t('mechanisms.share'), `A_op ${t('mechanisms.single')}`, `A_op ${t('mechanisms.shapley')}`, `${t('mechanisms.metric_delivered')} ${t('mechanisms.shapley')}`]}
              rows={report.gains
                .slice()
                .sort((a, b) => b.shapley - a.shapley)
                .map((g) => {
                  const m = MECHANISM_LIBRARY.find((x) => x.id === g.id)!;
                  return [`${g.id} · ${name(m)}`, fmtMetric(g.values[report.metric]), pts(g.single), pts(g.lastAdded), pts(g.shapley), fmtPct(g.share, 1), pts(g.byMetric.aOp.single), pts(g.byMetric.aOp.shapley), pts(g.byMetric.delivered.shapley)];
                })}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('mechanisms.sideBySide')}</div>
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
                <th>{t('mechanisms.effort')}</th>
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
                      {m.audit && <div className="muted" style={{ fontSize: 10 }}>{t('mechanisms.auditedTag')}{m.integrationNeeds?.length ? ` · ${integrationStatus(m, { ...m.parameters, ...(overrides[m.id] ?? {}), ...(provisional ? m.provisional ?? {} : {}) }).ready ? t('audit.statusReady') : t('audit.statusMissing') + ': ' + m.integrationNeeds.join(', ')}` : ''}</div>}
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
                    <td>{m.apply ? <NumberInput value={efforts[m.id] ?? m.effort} min={0} max={10} step={1} onChange={(v) => setEfforts((o) => ({ ...o, [m.id]: v }))} /> : <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {m.apply && (on ? (
                        <button type="button" className="btn small" onClick={() => updateActive((s) => stripMechanisms(s, [m.id]))} disabled={!isStrippable(active.scenario, m.id)}>{t('mechanisms.remove')}</button>
                      ) : (
                        <button type="button" className="btn small" onClick={() => updateActive((s) => applyMechanisms(s, [m.id], paramsFor([m.id])))}>{t('mechanisms.apply')}</button>
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
