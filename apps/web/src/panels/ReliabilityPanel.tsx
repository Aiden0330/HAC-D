import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { goodputFirstOrder, dalyGoodput, scaleTable, recoveryTimeS, resolveRecovery, PIPELINE_PRESETS, type Scenario, type EvaluationResult } from '@hac-d/core';
import { useActive, useLang } from '../hooks.js';
import { Kpi, Card, DataTable, Badge } from '../components/ui.js';
import { StackedBar } from '../charts/StackedBar.js';
import { LineChart } from '../charts/LineChart.js';
import { BarChart } from '../charts/BarChart.js';
import { fmtPct, fmtDuration, fmtMoney, fmtNum, fmtInt, fmtRatePerMillion, fmtHours } from '../lib/format.js';

/**
 * v4 the former Training page as the Reliability tab of the topology page: regime, goodput models, loss decomposition, recovery
 * stages, ledger, silent corruption, chain, sub-health, scale and interval curves, component shares. The headline KPIs (A_op,
 * delivered goodput, MTBI, mean pause, interruptions per day) live in the topology page's KPI strip and are not repeated here.
 */
export function ReliabilityPanel() {
  const { t } = useTranslation();
  const active = useActive();
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  if (!active.result.training || active.scenario.workload.type !== 'training') return <div className="callout">{t('inference.notTraining')}</div>;
  return <ReliabilityBody scenario={active.scenario} result={active.result} />;
}

function ReliabilityBody({ scenario, result }: { scenario: Scenario; result: EvaluationResult }) {
  const { t } = useTranslation();
  const lang = useLang();
  const tr = result.training!;
  const fo = tr.firstOrder;

  const intervalCurve = useMemo(() => {
    const xs: number[] = [];
    for (let f = 0.1; f <= 10.01; f *= 1.25) xs.push(tr.tauS * f);
    return [
      { label: t('common.goodput'), points: xs.map((tau) => ({ x: tau, y: goodputFirstOrder(scenario.workload.type === 'training' ? scenario.workload.deltaS : 0, tau, tr.mtbiS, tr.recoveryS).goodput })) },
      { label: t('training.dalyFull'), points: xs.map((tau) => ({ x: tau, y: dalyGoodput(tau, scenario.workload.type === 'training' ? scenario.workload.deltaS : 0, tr.mtbiS, tr.recoveryS) })) },
    ];
  }, [tr, scenario, t]);

  const scaleSeries = useMemo(() => {
    const lamPerGpu = tr.interruptionRatePerHour / tr.nGpus;
    const delta = scenario.workload.type === 'training' ? scenario.workload.deltaS : 0;
    const model = resolveRecovery(scenario);
    const sizes = tr.scale.map((r) => r.nGpus);
    const main = { label: `${t('common.goodput')} · R(N)`, points: tr.scale.map((r) => ({ x: r.nGpus, y: r.goodput.goodput, flag: r.goodput.validity })) };
    const alt = PIPELINE_PRESETS['automated-probe-standby'];
    const altRows = scaleTable(lamPerGpu, delta, (n) => recoveryTimeS(alt, n), sizes);
    const series = [main];
    if (model.id !== alt.id) series.push({ label: `${t('common.goodput')} · ${alt.name ?? alt.id}`, points: altRows.map((r) => ({ x: r.nGpus, y: r.goodput.goodput, flag: r.goodput.validity })), muted: true } as typeof main & { muted: boolean });
    return series;
  }, [tr, scenario, t]);

  const firstInvalid = tr.scale.find((r) => r.goodput.validity === 'invalid');
  const firstCaution = tr.scale.find((r) => r.goodput.validity !== 'ok');
  const bands = [] as { from: number; to: number; label: string }[];
  if (firstCaution) bands.push({ from: firstCaution.nGpus, to: firstInvalid?.nGpus ?? tr.scale[tr.scale.length - 1].nGpus * 2, label: 'caution' });
  if (firstInvalid) bands.push({ from: firstInvalid.nGpus, to: tr.scale[tr.scale.length - 1].nGpus * 2, label: 'first-order invalid' });

  const sp = scenario.topology.superpod;
  const supernodeSize = sp ? sp.npusPerNode * sp.nodesPerRack * sp.computeRacks : 0;
  const regimeKey = fo.regime === 'checkpoint-dominated' ? 'training.regime_checkpoint' : fo.regime === 'restart-dominated' ? 'training.regime_restart' : 'training.regime_invalid';

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="kpi-row">
        <Kpi label={t('training.effectiveGoodput')} value={fmtPct(tr.effectiveGoodput, 2)} note={`${t(tr.headlineModel === 'first-order' ? 'training.modelFirst' : 'training.modelExact')} ${fmtPct(tr.headlineGoodput, 2)}${tr.sdc ? ` · ${t('training.sdcFactor')} ${fmtNum(tr.sdc.delivery.factor, 4)}` : ` · ${t('training.noSdc')}`}`} />
        <Kpi label={t('common.recovery')} value={fmtDuration(tr.recoveryS, lang)} note={tr.ladder ? `${t('training.pManual')} ${fmtPct(tr.ladder.pManual, 2)} · ${tr.recoveryKind === 'mixture' ? t('scenario.mixtureMode') : tr.recoveryId}` : `${t('training.dominant')}: ${tr.recovery.dominant ?? '—'}`} />
        <Kpi label={t('training.eventRate')} value={fmtNum(tr.eventRatePerHour, 3)} note={`${t('training.rollbackEvents')} ${fmtPct(tr.pRollback, 1)} · ${t('training.pauseOnlyEvents')} ${fmtPct(1 - tr.pRollback, 1)}${tr.overheadFraction > 0 ? ` · ${t('training.ledger_overhead')} ${fmtPct(tr.overheadFraction, 1)}` : ''}${tr.falseAlarmRatePerHour > 0 ? ` · ${t('training.falseAlarms')} ${tr.falseAlarmRatePerHour.toExponential(2)}/h` : ''}`} />
        <Kpi label={t('common.interval')} value={fmtDuration(tr.tauS, lang)} note={tr.intervalModel} />
        <Kpi label={t('common.lost_per_day')} value={fmtMoney(tr.lostDollarsPerDay)} note={`${fmtInt(tr.wastedGpuHoursPerDay)} ${t('common.wasted')}`} />
        <Kpi label={t('training.wall')} value={fmtNum(tr.wallClockDays, 1)} note={`${fmtNum(tr.expectedInterruptions, 0)} ${t('training.interruptionsWord')} · P(${t('training.noInterruption24h')}) ${fmtPct(tr.pNoInterruption24h, 1)}`} />
      </div>
      <div className={`callout${fo.validity === 'invalid' ? ' crit' : fo.validity === 'caution' ? ' warn' : ''}`}>
        <b>{t('training.regime')}: {t(regimeKey)}</b> · (τ+δ)/M = {fo.smallParameter.toFixed(3)} · R/M = {fo.restartRatio.toFixed(3)} · <Badge status={fo.validity === 'ok' ? 'pass' : fo.validity === 'caution' ? 'warn' : 'fail'}>{fo.validity}</Badge> · {t('training.headlineIs')}: <b>{t(tr.headlineModel === 'first-order' ? 'training.modelFirst' : 'training.modelExact')}</b>
        {fo.warnings.length > 0 && (
          <ul className="plain">
            {fo.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>
      <Card title={t('training.modelsTitle')} formula={result.formulas.goodput}>
        <DataTable
          columns={[t('training.model'), t('common.goodput'), t('training.assumption')]}
          numericFrom={1}
          rows={[
            [t('training.operational'), fmtPct(tr.operationalAvailability, 4), 'A_op = M/(M + R)'],
            [`${t('training.modelFirst')}${tr.headlineModel === 'first-order' ? ' ★' : ''}`, fmtPct(tr.firstOrder.goodput, 4), `W = ${fmtDuration(tr.recomputePerInterruptionS, lang)} (${tr.recomputeSource}) · (τ+δ)/M, R/M ≪ 1`],
            [t('training.modelProduct'), fmtPct(tr.productGoodput, 4), 'A_op · τ/(τ+δ) · (1 − W/M)'],
            [`${t('training.modelExact')}${tr.headlineModel === 'exact-renewal' ? ' ★' : ''}`, fmtPct(tr.renewalGoodput, 4), `${t('training.impliedW')} ${fmtDuration(tr.impliedRecomputeS, lang)} · ${t('training.noRecoveryFailures')}`],
            [t('training.dalyFull'), fmtPct(tr.dalyGoodput, 4), t('training.dalyAssumption')],
          ]}
        />
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('training.headlineRule')}{result.formulas.mttr ? ` · MTTR: ${result.formulas.mttr}` : ''}</div>
      </Card>
      <div className="grid cols-2">
        <Card formula={result.formulas.goodput}>
          <StackedBar
            title={t('training.lossDecomposition')}
            segments={[
              { label: t('training.save'), value: fo.terms.save },
              { label: t('training.recompute'), value: fo.terms.recompute },
              { label: t('training.restart'), value: fo.terms.restart },
              ...(tr.blockedProbability > 0 ? [{ label: t('training.blocked'), value: tr.blockedProbability }] : []),
              ...(tr.localLossFraction > 0 ? [{ label: t('training.ledger_local'), value: tr.localLossFraction }] : []),
              ...(tr.overheadFraction > 0 ? [{ label: t('training.ledger_overhead'), value: tr.overheadFraction }] : []),
            ]}
            format={(v) => fmtPct(v, 2)}
          />
        </Card>
        <Card formula={result.formulas.recovery}>
          <h2 style={{ fontSize: 14, marginBottom: 6 }}>{tr.recoveryKind === 'ladder' ? t('training.ladderAt') : t('training.recoveryStages')} (N = {fmtInt(tr.nGpus)})</h2>
          <DataTable columns={[t('training.stage'), t('training.meanS'), t('training.shareOfR'), t('common.notes')]} numericFrom={1} rows={tr.recovery.stages.map((s) => [s.name === tr.recovery.dominant ? <b key="d">{s.name}</b> : s.name, fmtDuration(s.meanS, lang), fmtPct(s.share, 1), <span key="n" className="muted" style={{ fontSize: 12 }}>{s.note ?? ''}</span>])} />
        </Card>
      </div>
      <Card title={t('training.ledgerTitle')} sub={t('training.ledgerNote')} formula={result.formulas.ledger}>
        <StackedBar
          title={t('training.ledgerTitle')}
          segments={[
            { label: t('training.ledger_delivered'), value: tr.ledger.delivered },
            { label: t('training.ledger_downtime'), value: tr.ledger.downtime },
            { label: t('training.ledger_save'), value: tr.ledger.save },
            { label: t('training.ledger_rollback'), value: tr.ledger.rollback },
            ...(tr.ledger.slowdown > 0 ? [{ label: t('training.ledger_slowdown'), value: tr.ledger.slowdown }] : []),
            ...(tr.ledger.local > 0 ? [{ label: t('training.ledger_local'), value: tr.ledger.local }] : []),
            ...(tr.ledger.blocked > 0 ? [{ label: t('training.ledger_blocked'), value: tr.ledger.blocked }] : []),
            ...(tr.ledger.overhead > 0 ? [{ label: t('training.ledger_overhead'), value: tr.ledger.overhead }] : []),
            ...(tr.ledger.sdcRollback > 0 ? [{ label: t('training.ledger_sdcRollback'), value: tr.ledger.sdcRollback }] : []),
            ...(tr.ledger.terminal > 0 ? [{ label: t('training.ledger_terminal'), value: tr.ledger.terminal }] : []),
          ]}
          total={1}
          format={(v) => fmtPct(v, 3)}
        />
      </Card>
      {tr.sdc && (
        <Card title={t('training.sdcTitle')} formula={result.formulas.sdc}>
          <div className="kpi-row">
            <Kpi label={t('training.delivered')} value={fmtPct(tr.deliveredGoodput, 2)} note={`${t('training.sdcFactor')} ${fmtNum(tr.sdc.delivery.factor, 4)} · ${t('training.cTime')} ${fmtNum(tr.sdc.delivery.cTimeNoRecovery, 4)}`} hero />
            <Kpi label={t('training.sdcRate')} value={tr.sdc.ratePerHour.toExponential(3)} note={`${t('training.sdcCoverage')} ${fmtPct(tr.sdc.coverage, 1)} · ${t('training.pClear')} ${fmtPct(tr.sdc.pClearedBeforePersist, 2)}`} />
            <Kpi label={t('training.episodeRate')} value={tr.sdc.episodeRatePerWallHour.toExponential(3)} note={`${t('training.sdcEpisodes')} ${fmtNum(tr.sdc.delivery.expectedEpisodes, 2)} · ${fmtNum(tr.sdc.delivery.expectedDiscovered, 2)} ${t('training.sdcDiscovered')}`} />
            <Kpi label={t('training.sdcClean')} value={fmtPct(tr.sdc.delivery.cleanTimeFraction, 2)} note={`${t('training.sdcDirty')} ${fmtPct(tr.sdc.delivery.dirtyTimeFraction, 2)} · ${t('training.sdcPause')} ${fmtPct(tr.sdc.delivery.pauseFraction, 3)} · ${t('training.stationary')} ${fmtPct(tr.sdc.delivery.stationaryCleanFraction, 2)}`} />
            <Kpi label={t('training.pDirtyEnd')} value={fmtPct(tr.sdc.delivery.pDirtyAtEnd, 1)} note={`${t('training.ledger_terminal')} ${fmtPct(tr.sdc.delivery.terminalDiscardFraction, 2)} · ${t('training.ledger_sdcRollback')} ${fmtPct(tr.sdc.delivery.rollbackFraction, 2)}`} tone={tr.sdc.delivery.pDirtyAtEnd > 0.2 ? 'warn' : undefined} />
            <Kpi label={t('training.sdcFallback')} value={fmtHours(tr.sdc.fallbackDelayH, lang)} note={`${t('common.recovery')} ${fmtDuration(tr.sdc.episodePauseS, lang)} · ${tr.sdc.stepRecovery ? 'step recovery' : 'checkpoint recovery'} · ${tr.sdc.delivery.method}`} />
            <Kpi label={t('training.terminalRule')} value={t(tr.sdc.terminalRule === 'discard-all' ? 'training.rule_discard' : 'training.rule_retain')} note={`${t('training.otherRule')} ${fmtPct(tr.sdc.terminalRule === 'discard-all' ? tr.sdc.delivery.deliveredRetained : tr.sdc.delivery.deliveredDiscardAll, 2)} · ${t('training.pUnresolved')} ${fmtPct(tr.sdc.delivery.pUnresolvedAtEnd, 1)}`} tone={tr.sdc.terminalRule === 'discard-all' ? 'warn' : undefined} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('training.mechanismsHint')}</div>
        </Card>
      )}
      <Card title={t('training.chainTitle')} sub={tr.chain.active ? `${t('training.detectGlobal')}: ${fmtDuration(tr.detectS, lang)} · ${fmtDuration(tr.globalRecoveryS, lang)}` : t('training.chainInactive')} formula={result.formulas.chain}>
        <DataTable
          columns={[t('common.component'), t('training.chainRate'), t('training.applicable'), t('training.pPredict'), t('training.pNetfail'), t('training.pReplay'), t('training.pHotswap'), t('training.pElastic'), t('training.pProcess'), t('training.pGlobal'), t('training.pRollback'), t('training.meanPause'), t('training.localLoss')]}
          rows={tr.chain.rows.map((r) => [r.name, r.ratePerHour.toExponential(2), `${fmtNum(r.applicable.replay, 2)} / ${fmtNum(r.applicable.process, 2)} / ${fmtNum(r.applicable.elastic, 2)}`, fmtPct(r.pPredict, 1), fmtPct(r.pNetfail, 1), fmtPct(r.pReplay, 1), fmtPct(r.pHotswap, 1), fmtPct(r.pElastic, 1), fmtPct(r.pProcess, 1), fmtPct(r.pGlobal, 1), fmtPct(r.pRollback, 1), fmtDuration(r.meanPauseS, lang), `${fmtNum(r.localLossS, 2)} s`])}
        />
      </Card>
      {tr.subhealth && (
        <Card title={t('training.subhealthTitle')} formula={result.formulas.subhealth}>
          <div className="kpi-row">
            <Kpi label={t('training.pSlowed')} value={fmtPct(tr.subhealth.pSlowed, 2)} />
            <Kpi label={t('training.perfFactor')} value={fmtPct(tr.subhealth.performanceFactor, 3)} note={`${t('training.minPerf')} ${fmtPct(tr.subhealth.minPerformance, 0)}`} tone={tr.subhealth.performanceFactor < 0.95 ? 'warn' : undefined} />
            <Kpi label={t('training.isolationRate')} value={tr.subhealth.isolationInterruptionsPerHour.toExponential(2)} note={`${t('training.hardwareRate')} ${tr.subhealth.hardwareInterruptionsPerHour.toExponential(2)}`} />
          </div>
        </Card>
      )}
      <Card formula={result.formulas.scale} sub={t('training.scaleNote')}>
        <LineChart title={t('training.scale')} series={scaleSeries} xLog xLabel={t('training.nLabel')} yLabel={t('common.goodput')} yDomain={[0, 1]} formatX={(v) => fmtInt(v)} formatY={(v) => fmtPct(v, 0)} bands={bands} />
        <DataTable
          columns={[t('training.nLabel'), ...(supernodeSize ? [t('training.supernodes')] : []), t('common.mtbi'), 'τ', `${t('common.goodput')} (${t('training.modelFirst')})`, `${t('common.goodput')} (${t('training.modelExact')})`, ...(tr.sdc ? [t('training.scaleDelivered')] : []), t('common.interruptions_per_day'), '']}
          rows={tr.scale.map((r) => [fmtInt(r.nGpus), ...(supernodeSize ? [fmtInt(Math.ceil(r.nGpus / supernodeSize))] : []), fmtDuration(r.mtbiS, lang), fmtDuration(r.tauS, lang), r.headlineModel === 'first-order' ? <b key="f">{fmtPct(r.goodput.goodput, 1)}</b> : fmtPct(r.goodput.goodput, 1), r.headlineModel === 'exact-renewal' ? <b key="e">{fmtPct(r.renewalGoodput, 1)}</b> : fmtPct(r.renewalGoodput, 1), ...(tr.sdc ? [fmtPct(r.delivered ?? r.headline, 1)] : []), fmtNum(r.interruptionsPerDay, 1), r.goodput.validity === 'ok' ? '' : <Badge key="b" status={r.goodput.validity === 'caution' ? 'warn' : 'fail'}>{r.goodput.validity}</Badge>])}
        />
      </Card>
      <div className="grid cols-2">
        <Card formula={result.formulas.interval}>
          <LineChart title={t('training.intervalCurve')} series={intervalCurve} xLog xLabel="τ (s)" yLabel={t('common.goodput')} formatX={(v) => fmtDuration(v, lang, 0)} formatY={(v) => fmtPct(v, 1)} markers={[{ x: tr.tauS, label: `τ* ${fmtDuration(tr.tauS, lang)}` }]} />
        </Card>
        <Card formula={result.formulas.mtbi}>
          <BarChart title={result.components.length > 15 ? `${t('training.components')} · ${t('training.top15')}` : t('training.components')} data={[...result.components].sort((a, b) => b.interruptionShare - a.interruptionShare).slice(0, 15).map((c) => ({ label: c.name, value: c.interruptionShare, note: `${fmtInt(c.count)} × ${fmtRatePerMillion(c.lambdaPerUnitPerHour)} /1e6 h${c.confidence ? ` · ${c.confidence}` : ''}` }))} format={(v) => fmtPct(v, 1)} unitLabel={t('common.share')} />
        </Card>
      </div>
    </div>
  );
}
