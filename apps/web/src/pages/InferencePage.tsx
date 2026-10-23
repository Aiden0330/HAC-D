import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { hotSparesBinomial, hotSparesPoisson } from '@hac-d/core';
import { useActive, useLang } from '../hooks.js';
import { Kpi, Card, DataTable } from '../components/ui.js';
import { LineChart } from '../charts/LineChart.js';
import { Heatmap } from '../charts/Heatmap.js';
import { fmtPct, fmtHours, fmtNum, fmtInt, fmtMoney } from '../lib/format.js';

const MTTRS = [0.5, 1, 2, 4, 8, 24, 72];
const MTBFS = [1000, 2000, 5000, 10000, 20000, 50000];

/**
 * v5.2 Inference & spares: the N+k inference replicas (former Inference page) followed by the quantile-based spares and failure
 * domains (former Spares page), each under its former title. Both read the active scenario; the section that does not apply to its
 * workload (spares for an inference scenario, replicas for a training one) shows a one-line note.
 */
export function InferencePage() {
  const { t } = useTranslation();
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('nav.inference')}</h1>
        <span className="sub">{t('inference.pageSub')}</span>
      </div>
      <h2 style={{ margin: '6px 0 0' }}>{t('inference.title')}</h2>
      <div className="muted" style={{ fontSize: 12 }}>{t('inference.sub')}</div>
      <InferenceSection />
      <h2 style={{ margin: '6px 0 0' }}>{t('spares.title')}</h2>
      <div className="muted" style={{ fontSize: 12 }}>{t('spares.sub')}</div>
      <SparesSection />
    </div>
  );
}

/** N+k inference replicas (the former Inference page) */
function InferenceSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const { scenario, result } = active;
  const inf = result.inference;
  if (!inf || scenario.workload.type !== 'inference') return <div className="callout">{t('inference.notTraining')}</div>;
  const target = scenario.workload.capacityTarget;
  return (
    <>
      {inf.replicaScope === 'supernode' && (
        <div className="callout">
          <b>{t('inference.clusterTitle')}</b>: {fmtInt(inf.clusterGpus)} NPU = {inf.replicasRequired} + {inf.spareReplicas} × {fmtInt(scenario.workload.gpusPerReplica)} · {t('inference.supernodesTotal')} {inf.supernodesTotal} · {t('inference.replicaMembers')}: {inf.replicaMembers.join(', ')}
        </div>
      )}
      <div className="kpi-row">
        <Kpi label={`${t('inference.capacity')} (k = ${inf.spareReplicas})`} value={fmtPct(inf.capacityAvailability, 4)} tone={inf.capacityAvailability < target ? 'bad' : undefined} note={`target ${fmtPct(target, 2)} · ${t('inference.unitScope')}: ${inf.replicaScope}`} hero />
        <Kpi label={t('inference.kRequired')} value={String(inf.kRequiredForTarget)} note={`${fmtPct(inf.kRequiredForTarget / inf.replicasRequired, 1)} redundancy`} />
        <Kpi label={t('inference.serviceUp')} value={fmtPct(inf.serviceUpAvailability, 5)} />
        <Kpi label={inf.replicaScope === 'supernode' ? t('inference.supernodeMtbf') : t('inference.replicaMtbf')} value={fmtHours(inf.replicaMtbfHours, lang)} note={`${t('inference.replicaU')} ${fmtPct(inf.replicaUnavailability, 3)} · MTTR ${fmtHours(inf.replicaMttrHours, lang)}`} />
        <Kpi label={t('inference.expectedDown')} value={fmtNum(inf.expectedDownReplicas, 2)} note={inf.replicaScope === 'supernode' ? t('inference.supernodesDownNote') : undefined} />
        <Kpi label={t('inference.failuresPerDay')} value={fmtNum(inf.replicaFailuresPerDay, 2)} note={`${t('inference.pNoFailure')} ${fmtPct(inf.pNoReplicaFailureInWindow, 1)}`} />
        <Kpi label={t('inference.idleSpares')} value={fmtInt(inf.idleSpareGpuHoursPerDay)} note={fmtMoney(inf.spareDollarsPerDay)} />
      </div>
      <div className="grid cols-2">
        <Card formula={result.formulas.inference}>
          <LineChart
            title={t('inference.curve')}
            series={[{ label: t('inference.capacity'), points: inf.curve.map((p) => ({ x: p.k, y: p.capacityAvailability })) }]}
            xLabel="k"
            yLabel={t('inference.capacity')}
            formatX={(v) => String(Math.round(v))}
            formatY={(v) => fmtPct(v, 2)}
            markers={[{ x: inf.kRequiredForTarget, label: `k* = ${inf.kRequiredForTarget} @ ${fmtPct(target, 2)}` }]}
          />
        </Card>
        <Card title={t('common.table')}>
          <DataTable columns={['k', t('inference.capacity'), 'redundancy']} rows={inf.curve.map((p) => [p.k, fmtPct(p.capacityAvailability, 4), fmtPct(p.k / inf.replicasRequired, 1)])} highlight={(i) => inf.curve[i].k === inf.kRequiredForTarget} />
        </Card>
      </div>
    </>
  );
}

/** quantile-based hot spares, repair pipeline and the MTBF–MTTR decision map (the former Spares page) */
function SparesSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const nodes = active && !active.error ? active.result.spares?.nodes : undefined;
  // the decision map before the early returns (hooks run on every render)
  const map = useMemo(() => (nodes === undefined ? [] : MTBFS.map((m) => MTTRS.map((r) => hotSparesPoisson(nodes, 1 / m, r, 0.99)))), [nodes]);
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const { scenario, result } = active;
  const sp = result.spares;
  if (!sp || scenario.workload.type !== 'training') return <div className="callout">{t('spares.notTraining')}</div>;
  const mttrs = MTTRS;
  const mtbfs = MTBFS;
  const quantiles = [0.9, 0.95, 0.99, 0.995, 0.999, 0.9999];
  const vsQ = quantiles.map((q) => ({ x: q, y: hotSparesBinomial(sp.nodes, sp.nodeDailyFailureProbability, q) }));

  return (
    <>
      <div className="kpi-row">
        <Kpi label={`${t('spares.hotBinomial')} P${(sp.quantile * 100).toFixed(sp.quantile >= 0.999 ? 1 : 0)}`} value={String(sp.hotSparesBinomial)} note={`${fmtPct(sp.hotSparesBinomial / sp.nodes, 2)} of ${fmtInt(sp.nodes)} nodes`} hero />
        <Kpi label={t('spares.hotPoisson')} value={String(sp.hotSparesPoissonReplenish)} note={`replenish ${fmtHours(scenario.workload.spareReplenishHours, lang)}`} />
        <Kpi label={t('spares.configured')} value={String(sp.configuredHotSpares)} tone={sp.configuredHotSpares < sp.hotSparesBinomial ? 'warn' : undefined} note={result.training ? `blocked ${fmtPct(result.training.blockedProbability, 4)}` : undefined} />
        <Kpi label={t('spares.pDaily')} value={fmtPct(sp.nodeDailyFailureProbability, 3)} note={`node λ ${fmtNum(sp.nodeLambdaPerHour * 1e6, 1)} /1e6 h`} />
        <Kpi label={t('spares.pipeline')} value={`${fmtNum(sp.repairPipeline.mean, 1)} / ${sp.repairPipeline.quantile}`} note={`turnaround ${fmtHours(scenario.spares.turnaroundHours, lang)} · ${fmtPct(sp.repairPipeline.fraction, 2)}`} />
        <Kpi label={t('spares.replacements')} value={`${fmtNum(sp.replacementsOverJob.mean, 0)} / ${sp.replacementsOverJob.quantile}`} />
      </div>
      <div className="grid cols-2">
        <Card formula={result.formulas.spares} sub={t('spares.mapNote')}>
          <Heatmap title={t('spares.map')} xs={mttrs} ys={mtbfs} values={map} formatX={(v) => fmtHours(v, lang)} formatY={(v) => `${fmtInt(v)} h`} formatV={(v) => String(v)} xLabel="MTTR / replenish" yLabel="node MTBF" />
        </Card>
        <Card>
          <LineChart title={t('spares.vsQuantile')} series={[{ label: t('spares.hotBinomial'), points: vsQ }]} xLabel="quantile" yLabel="spares" formatX={(v) => fmtPct(v, 2)} formatY={(v) => String(Math.round(v))} />
          <DataTable columns={['quantile', 'spares', 'fraction']} rows={vsQ.map((p) => [fmtPct(p.x, 2), p.y, fmtPct(p.y / sp.nodes, 2)])} />
        </Card>
      </div>
    </>
  );
}
