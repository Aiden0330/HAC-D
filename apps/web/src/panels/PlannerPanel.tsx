import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MECHANISM_LIBRARY, DEFAULT_PLAYERS, provisionalParameters, type AttributionMetric, type MechanismPlan, type Scenario } from '@hac-d/core';
import { useLang } from '../hooks.js';
import { compute, cancelCompute, progressCallback, ComputeCancelled } from '../worker/client.js';
import { Kpi, Card, DataTable, Field, Select, NumberInput } from '../components/ui.js';
import { Heatmap } from '../charts/Heatmap.js';
import { fmtPct } from '../lib/format.js';

const METRICS: AttributionMetric[] = ['delivered', 'effective', 'aOp'];

/**
 * v4 the mechanism planner of the former Mechanisms page (cheapest feasible mechanism set by exact enumeration, necessary
 * mechanisms, Pareto front, coverage × recovery-time scan, ledger verification), now a tab of the Allocation page; the
 * strategies tab adds hardware FIT and recovery levers to the same search.
 */
export function PlannerPanel({ scenario }: { scenario: Scenario }) {
  const { t } = useTranslation();
  const lang = useLang();
  const applicable = MECHANISM_LIBRARY.filter((m) => m.apply);
  const name = (m: (typeof MECHANISM_LIBRARY)[number]) => (lang === 'zh' ? m.name.zh : m.name.en);
  const [players, setPlayers] = useState<string[]>(DEFAULT_PLAYERS);
  const [metric, setMetric] = useState<AttributionMetric>('delivered');
  const [provisional, setProvisional] = useState(false);
  const [plan, setPlan] = useState<MechanismPlan | null>(null);
  const [planTarget, setPlanTarget] = useState<number>(scenario.targets.goodput ?? 0.9);
  const [derate, setDerate] = useState(true);
  const [verify, setVerify] = useState(true);
  const [trials, setTrials] = useState(200);
  const [confidence, setConfidence] = useState(0.9);
  const [efforts] = useState<Record<string, number>>({});
  const [planning, setPlanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: string } | null>(null);
  const [err, setErr] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  const key = JSON.stringify(scenario);
  useEffect(() => { setPlan(null); }, [key]);
  if (scenario.workload.type !== 'training') return <div className="callout">{t('mechanisms.notTraining')}</div>;
  const toggle = (id: string) => setPlayers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const fail = (e: unknown) => setErr(e instanceof ComputeCancelled ? { text: t('mechanisms.cancelled'), tone: 'info' } : { text: (e as Error).message, tone: 'crit' });
  const paramsFor = (ids: string[]) => (provisional ? provisionalParameters(ids) : {});
  const runPlan = async () => {
    if (players.length === 0) { setErr({ text: t('mechanisms.noPlayers'), tone: 'crit' }); return; }
    if (players.length > 10) { setErr({ text: t('mechanisms.tooMany'), tone: 'crit' }); return; }
    setPlanning(true);
    setErr(null);
    setProgress({ done: 0, total: 1 << players.length, phase: 'coalitions' });
    try {
      setPlan(await compute().plan(scenario, { target: planTarget, players, metric, parameters: paramsFor(players), effort: efforts, derate: derate ? undefined : null, scan: true, verify: verify ? { trials, confidence } : undefined }, progressCallback((done: number, total: number, phase: string) => setProgress({ done, total, phase }))));
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
  return (
    <>
      <Card title={t('mechanisms.players')} sub={t('mechanisms.hint')}>
        <div className="btn-row">
          {applicable.map((m) => (
            <button key={m.id} type="button" className="btn small" aria-pressed={players.includes(m.id)} onClick={() => toggle(m.id)} title={lang === 'zh' ? m.change.zh : m.change.en}>{m.id} · {name(m)}</button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label={t('mechanisms.metric')}><Select value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m, label: t(`mechanisms.metric_${m}`) }))} /></Field>
        </div>
        <label className="check" title={t('audit.provisionalHint')}><input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} />{t('audit.provisionalShort')}</label>
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
              <button type="button" className="btn primary" disabled={planning} onClick={runPlan}>{planning ? t('mechanisms.planning') + progressText() : t('mechanisms.planRun')}</button>
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
    </>
  );
}
