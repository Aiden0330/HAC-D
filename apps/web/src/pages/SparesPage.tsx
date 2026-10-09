import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { hotSparesBinomial, hotSparesPoisson } from '@hac-d/core';
import { useActive, useLang } from '../hooks.js';
import { Kpi, Card, DataTable } from '../components/ui.js';
import { Heatmap } from '../charts/Heatmap.js';
import { LineChart } from '../charts/LineChart.js';
import { fmtPct, fmtHours, fmtNum, fmtInt } from '../lib/format.js';

export function SparesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const { scenario, result } = active;
  const sp = result.spares;
  if (!sp || scenario.workload.type !== 'training') return <div className="callout">{t('spares.notTraining')}</div>;

  const mttrs = [0.5, 1, 2, 4, 8, 24, 72];
  const mtbfs = [1000, 2000, 5000, 10000, 20000, 50000];
  const map = useMemo(() => mtbfs.map((m) => mttrs.map((r) => hotSparesPoisson(sp.nodes, 1 / m, r, 0.99))), [sp.nodes]);
  const quantiles = [0.9, 0.95, 0.99, 0.995, 0.999, 0.9999];
  const vsQ = quantiles.map((q) => ({ x: q, y: hotSparesBinomial(sp.nodes, sp.nodeDailyFailureProbability, q) }));

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('spares.title')}</h1>
        <span className="sub">{t('spares.sub')}</span>
      </div>
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
    </div>
  );
}
