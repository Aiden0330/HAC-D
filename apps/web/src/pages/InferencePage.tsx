import { useTranslation } from 'react-i18next';
import { useActive, useLang } from '../hooks.js';
import { Kpi, Card, DataTable } from '../components/ui.js';
import { LineChart } from '../charts/LineChart.js';
import { fmtPct, fmtHours, fmtNum, fmtInt, fmtMoney } from '../lib/format.js';

export function InferencePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const { scenario, result } = active;
  const inf = result.inference;
  if (!inf || scenario.workload.type !== 'inference') return <div className="callout">{t('inference.notTraining')}</div>;
  const target = scenario.workload.capacityTarget;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('inference.title')}</h1>
        <span className="sub">{t('inference.sub')}</span>
      </div>
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
    </div>
  );
}
