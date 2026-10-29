import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McComparison, LedgerComparison } from '@hac-d/core';
import { useActive, useLang } from '../hooks.js';
import { compute, progressCallback } from '../worker/client.js';
import { Kpi, Card, DataTable, Field, NumberInput, Badge, Select } from '../components/ui.js';
import { StackedBar } from '../charts/StackedBar.js';
import { Histogram } from '../charts/Histogram.js';
import { BarChart } from '../charts/BarChart.js';
import { fmtPct, fmtHours, fmtNum, fmtInt } from '../lib/format.js';

/**
 * v5.2 the Monte Carlo verification (formerly the Simulate page) as Review › Simulation: the ledger mode (delivered goodput, A_op,
 * probability of the target, attribution by class) and the job mode (goodput, MTBI, blocking, spares), each against the closed form
 * with an agree / disagree badge. Results stay local to the panel.
 */
export function SimulatePanel() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const [reps, setReps] = useState(100);
  const [seed, setSeed] = useState(1);
  const [workHours, setWorkHours] = useState<number>(active?.scenario.workload.type === 'training' ? Math.min(active.scenario.workload.durationDays * 24, 240) : 240);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [res, setRes] = useState<McComparison | null>(null);
  const [mode, setMode] = useState<'job' | 'ledger'>('ledger');
  const [trials, setTrials] = useState(300);
  const [led, setLed] = useState<LedgerComparison | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  if (active.scenario.workload.type !== 'training') return <div className="callout">{t('simulate.notTraining')}</div>;

  const run = async () => {
    setRunning(true);
    setErr(null);
    setProgress(0);
    try {
      if (mode === 'ledger') {
        const r = await compute().ledger(active.scenario, { trials, seed, target: active.scenario.targets.goodput }, progressCallback((d, n) => setProgress(d / n)));
        setLed(r);
      } else {
        const r = await compute().simulate(active.scenario, { replications: reps, seed, workHours }, progressCallback((d, n) => setProgress(d / n)));
        setRes(r);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const s = res?.summary;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <Card>
        <div className="form-grid">
          <Field label={t('simulate.mode')}><Select value={mode} onChange={setMode} options={[{ value: 'ledger', label: t('simulate.modeLedger') }, { value: 'job', label: t('simulate.modeJob') }]} /></Field>
          {mode === 'ledger' ? (
            <Field label={t('simulate.trials')}><NumberInput value={trials} min={10} max={20000} step={50} onChange={setTrials} /></Field>
          ) : (
            <Field label={t('simulate.replications')}><NumberInput value={reps} min={5} max={2000} step={5} onChange={setReps} /></Field>
          )}
          <Field label={t('simulate.seed')}><NumberInput value={seed} min={0} step={1} onChange={setSeed} /></Field>
          {mode === 'job' && <Field label={t('simulate.workHours')}><NumberInput value={workHours} min={1} step={24} onChange={setWorkHours} /></Field>}
          <div className="field" style={{ justifyContent: 'end' }}>
            <button type="button" className="btn primary" disabled={running} onClick={run}>{running ? t('common.running') : mode === 'ledger' ? t('simulate.runLedger') : t('simulate.run')}</button>
          </div>
        </div>
        {mode === 'ledger' && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('simulate.ledgerNote')}</div>}
        {running && <div className="progress" style={{ marginTop: 10 }}><div style={{ width: `${(progress * 100).toFixed(0)}%` }} /></div>}
        {err && <div className="callout crit" style={{ marginTop: 8 }}>{err}</div>}
      </Card>
      {mode === 'ledger' && led && (() => {
        const L = led.summary;
        const cf = led.closedForm;
        const segs = [
          { label: t('training.ledger_delivered'), value: L.ledger.delivered },
          { label: t('training.ledger_downtime'), value: L.ledger.downtime },
          { label: t('training.ledger_save'), value: L.ledger.save },
          { label: t('training.ledger_rollback'), value: L.ledger.rollbackHard },
          ...(L.ledger.slowdown > 0 ? [{ label: t('training.ledger_slowdown'), value: L.ledger.slowdown }] : []),
          ...(L.ledger.localLoss > 0 ? [{ label: t('training.ledger_local'), value: L.ledger.localLoss }] : []),
          ...(L.ledger.overhead > 0 ? [{ label: t('training.ledger_overhead'), value: L.ledger.overhead }] : []),
          ...((L.ledger.blocked ?? 0) > 0 ? [{ label: t('training.ledger_blocked'), value: L.ledger.blocked }] : []),
          ...(L.ledger.rollbackSdc > 0 ? [{ label: t('training.ledger_sdcRollback'), value: L.ledger.rollbackSdc }] : []),
          ...(L.ledger.terminalInvalid > 0 ? [{ label: t('training.ledger_terminal'), value: L.ledger.terminalInvalid }] : []),
        ];
        return (
          <>
            <div className={`callout${led.disagrees ? ' warn' : ''}`}>
              <Badge status={led.disagrees ? 'warn' : 'pass'}>{led.disagrees ? t('simulate.disagrees') : t('simulate.agrees')}</Badge>
              {' '}{t('simulate.mc')} {fmtPct(L.delivered.mean, 2)} ± {fmtPct(L.delivered.ci95, 2)} vs {t('simulate.closedForm')} {fmtPct(cf.delivered, 2)} ({t('simulate.delta')} {fmtPct(led.delta.delivered, 2)}) · {t('simulate.aop')} {fmtPct(L.operationalAvailability.mean, 3)} vs {fmtPct(cf.operationalAvailability, 3)}
            </div>
            <div className="kpi-row">
              <Kpi label={`${t('simulate.delivered')} (${t('simulate.mc')})`} value={fmtPct(L.delivered.mean, 2)} note={`${t('simulate.ci')} ± ${fmtPct(L.delivered.ci95, 2)} (${t('simulate.tCi')}) · P5 ${fmtPct(L.delivered.p05, 1)} · P50 ${fmtPct(L.delivered.p50, 1)} · P95 ${fmtPct(L.delivered.p95, 1)}`} hero />
              <Kpi label={t('simulate.aop')} value={fmtPct(L.operationalAvailability.mean, 3)} note={`${t('simulate.closedForm')} ${fmtPct(cf.operationalAvailability, 3)}`} />
              {L.pAtLeastTarget !== undefined && <Kpi label={`${t('simulate.pTarget')} ${fmtPct(L.target ?? 0, 0)}`} value={fmtPct(L.pAtLeastTarget, 1)} note={L.pAtLeastTargetInterval ? `${t('simulate.wilson')} ${fmtPct(L.pAtLeastTargetInterval.low, 1)} – ${fmtPct(L.pAtLeastTargetInterval.high, 1)}` : undefined} tone={L.pAtLeastTarget < 0.5 ? 'warn' : undefined} />}
              <Kpi label={t('simulate.unresolved')} value={fmtPct(L.pUnresolvedAtEnd, 1)} note={`${t('simulate.episodes')} ${fmtNum(L.counts.sdcEpisodes, 2)}`} />
              <Kpi label={t('simulate.counts')} value={`${fmtNum(L.counts.hard, 0)} / ${fmtNum(L.counts.slow, 1)} / ${fmtNum(L.counts.sdc, 1)}`} note={`hard / slow / silent · ${t('simulate.manual')} ${fmtNum(L.counts.manual, 2)} · replay ${fmtNum(L.counts.replay, 1)} · elastic ${fmtNum(L.counts.elastic, 1)} · process ${fmtNum(L.counts.process, 1)}`} />
            </div>
            <div className="grid cols-2">
              <Card>
                <StackedBar title={t('simulate.ledgerTitle')} segments={segs} total={1} format={(v) => fmtPct(v, 3)} />
              </Card>
              <Card>
                <Histogram title={`${t('simulate.delivered')} · ${L.trials} ${t('simulate.trials')}`} values={L.values} format={(v) => fmtPct(v, 1)} refs={[{ value: cf.delivered, label: t('simulate.closedForm') }, { value: L.delivered.mean, label: t('simulate.mc'), color: 'var(--series-2)' }]} />
              </Card>
            </div>
            <Card title={t('simulate.byClass')}>
              <DataTable
                columns={['', 'events / run', t('training.ledger_downtime'), 'rollback', t('training.ledger_slowdown'), t('training.ledger_local'), t('training.ledger_terminal')]}
                rows={Object.entries(L.byClass).map(([id, a]) => [id, fmtNum(a.events, 1), fmtPct(a.downtime, 3), fmtPct(a.rollback, 3), fmtPct(a.slowdown, 3), fmtPct(a.localLoss, 3), fmtPct(a.terminalInvalid, 3)])}
              />
            </Card>
          </>
        );
      })()}
      {mode === 'job' && res && s && (
        <>
          <div className={`callout${res.disagrees ? ' warn' : ''}`}>
            <Badge status={res.disagrees ? 'warn' : 'pass'}>{res.disagrees ? t('simulate.disagrees') : t('simulate.agrees')}</Badge>
            {' '}{t('simulate.mc')} {fmtPct(s.goodput.mean, 2)} ± {fmtPct(s.goodput.ci95, 2)} vs {t('simulate.closedForm')} {fmtPct(res.closedForm.goodput, 2)} ({t('simulate.delta')} {fmtPct(res.delta.goodput, 2)})
          </div>
          <div className="kpi-row">
            <Kpi label={`${t('common.goodput')} (${t('simulate.mc')})`} value={fmtPct(s.goodput.mean, 2)} note={`${t('simulate.ci')} ± ${fmtPct(s.goodput.ci95, 2)} · P5 ${fmtPct(s.goodput.p05, 1)} · P95 ${fmtPct(s.goodput.p95, 1)}`} hero />
            <Kpi label={t('common.mtbi')} value={fmtHours(s.mtbiHours.mean, lang)} note={`${t('simulate.closedForm')} ${fmtHours(res.closedForm.mtbiHours, lang)}`} />
            <Kpi label={t('common.interruptions_per_day')} value={fmtNum(s.interruptionsPerDay.mean, 2)} note={`${t('simulate.closedForm')} ${fmtNum(res.closedForm.interruptionsPerDay, 2)}`} />
            <Kpi label={t('simulate.blocked')} value={fmtPct(s.blockedFraction.mean, 3)} note={`${t('simulate.closedForm')} ${fmtPct(res.closedForm.blockedProbability, 3)}`} />
            <Kpi label={t('simulate.peakSpares')} value={String(s.peakSparesInUse.p99)} note={`mean ${fmtNum(s.peakSparesInUse.mean, 1)}`} />
            <Kpi label="recovery / recompute / degraded" value={`${fmtPct(s.recoveryFraction.mean, 2)} · ${fmtPct(s.recomputeFraction.mean, 2)} · ${fmtPct(s.degradedLossFraction.mean, 2)}`} note={`CCF events / replication ${fmtNum(s.ccfEventsPerReplication.mean, 2)}`} />
          </div>
          <div className="grid cols-2">
            <Card>
              <Histogram title={t('simulate.goodputDist')} values={s.rows.map((r) => r.goodput)} format={(v) => fmtPct(v, 1)} refs={[{ value: res.closedForm.goodput, label: t('simulate.closedForm') }, { value: s.goodput.mean, label: t('simulate.mc'), color: 'var(--series-2)' }]} />
            </Card>
            <Card>
              <BarChart title={t('simulate.failures')} data={Object.entries(s.failuresByClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v / s.replications }))} format={(v) => fmtNum(v, 1)} unitLabel="failures / replication" />
            </Card>
          </div>
          <Card title={t('common.table')}>
            <DataTable
              columns={['', 'mean', 'sd', 'P5', 'P50', 'P95']}
              rows={[
                [t('common.goodput'), fmtPct(s.goodput.mean, 3), fmtPct(s.goodput.sd, 3), fmtPct(s.goodput.p05, 3), fmtPct(s.goodput.p50, 3), fmtPct(s.goodput.p95, 3)],
                [t('common.mtbi'), fmtHours(s.mtbiHours.mean, lang), fmtHours(s.mtbiHours.sd, lang), fmtHours(s.mtbiHours.p05, lang), fmtHours(s.mtbiHours.p50, lang), fmtHours(s.mtbiHours.p95, lang)],
                [t('common.interruptions_per_day'), fmtNum(s.interruptionsPerDay.mean, 2), fmtNum(s.interruptionsPerDay.sd, 2), fmtNum(s.interruptionsPerDay.p05, 2), fmtNum(s.interruptionsPerDay.p50, 2), fmtNum(s.interruptionsPerDay.p95, 2)],
                [t('simulate.blocked'), fmtPct(s.blockedFraction.mean, 3), fmtPct(s.blockedFraction.sd, 3), fmtPct(s.blockedFraction.p05, 3), fmtPct(s.blockedFraction.p50, 3), fmtPct(s.blockedFraction.p95, 3)],
                [t('simulate.peakSpares'), fmtNum(s.peakSparesInUse.mean, 1), fmtNum(s.peakSparesInUse.sd, 1), fmtInt(s.peakSparesInUse.p05), fmtInt(s.peakSparesInUse.p50), fmtInt(s.peakSparesInUse.p95)],
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
