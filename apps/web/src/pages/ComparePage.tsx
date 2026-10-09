import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compareScenarios, tornadoForScenario, type TornadoMetric } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { Card, DataTable, Field, Select } from '../components/ui.js';
import { Tornado } from '../charts/Tornado.js';
import { BarChart } from '../charts/BarChart.js';
import { fmtPct, fmtDuration, fmtMoney, fmtHours, fmtInt } from '../lib/format.js';
import { SERIES } from '../charts/common.js';

export function ComparePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const scenarios = useStore((s) => s.scenarios);
  const compareIds = useStore((s) => s.compareIds);
  const toggle = useStore((s) => s.toggleCompare);
  const active = useActive();
  const [metric, setMetric] = useState<TornadoMetric>('goodput');
  const selected = scenarios.filter((s) => compareIds.includes(s.meta.id!));
  const cmp = useMemo(() => {
    try {
      return compareScenarios(selected);
    } catch {
      return undefined;
    }
  }, [selected]);
  const torn = useMemo(() => {
    if (!active || active.error) return [];
    try {
      return tornadoForScenario(active.scenario, metric);
    } catch {
      return [];
    }
  }, [active, metric]);
  const fmtMetric = (v: number) => (metric === 'goodput' || metric === 'availability' ? fmtPct(v, 2) : metric === 'lostDollarsPerDay' ? fmtMoney(v) : fmtHours(v, lang));
  const base = torn[0]?.base ?? 0;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('compare.title')}</h1>
        <span className="sub">{t('compare.sub')}</span>
      </div>
      <Card title={t('compare.select')}>
        <div className="btn-row">
          {scenarios.map((s) => (
            <button key={s.meta.id} type="button" className="btn small" aria-pressed={compareIds.includes(s.meta.id!)} onClick={() => toggle(s.meta.id!)}>{s.meta.name}</button>
          ))}
        </div>
      </Card>
      {cmp && cmp.rows.length > 0 && (
        <Card>
          <DataTable
            columns={['', t('common.availability'), t('compare.original'), t('compare.performability'), t('compare.human'), t('common.mtbi'), t('common.recovery'), t('common.goodput'), t('common.lost_per_day'), 'blocked', 'hot spares P99', t('inference.capacity'), 'k*', 'checklist warn']}
            rows={cmp.rows.map((r) => [
              r.name,
              `${fmtPct(r.availability, 4)}${cmp.best.availability === r.id ? ' ★' : ''}`,
              fmtPct(r.originalAvailability, 4),
              fmtPct(r.performability, 4),
              fmtPct(r.humanFraction, 0),
              r.mtbiHours !== undefined ? `${fmtHours(r.mtbiHours, lang)}${cmp.best.mtbiHours === r.id ? ' ★' : ''}` : '—',
              r.recoveryS !== undefined ? `${fmtDuration(r.recoveryS, lang)}${cmp.best.recoveryS === r.id ? ' ★' : ''}` : '—',
              r.effectiveGoodput !== undefined ? `${fmtPct(r.effectiveGoodput, 2)}${cmp.best.effectiveGoodput === r.id ? ' ★' : ''}` : '—',
              r.lostDollarsPerDay !== undefined ? `${fmtMoney(r.lostDollarsPerDay)}${cmp.best.lostDollarsPerDay === r.id ? ' ★' : ''}` : '—',
              r.blockedProbability !== undefined ? fmtPct(r.blockedProbability, 4) : '—',
              r.hotSparesRequired !== undefined ? fmtInt(r.hotSparesRequired) : '—',
              r.capacityAvailabilityInference !== undefined ? fmtPct(r.capacityAvailabilityInference, 4) : '—',
              r.kRequired !== undefined ? String(r.kRequired) : '—',
              String(r.checklistWarnings),
            ])}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>★ {t('compare.best')}</div>
        </Card>
      )}
      {cmp && cmp.rows.some((r) => r.effectiveGoodput !== undefined) && (
        <div className="grid cols-2">
          <Card>
            <BarChart title={t('common.goodput')} data={cmp.rows.filter((r) => r.effectiveGoodput !== undefined).map((r, i) => ({ label: r.name, value: r.effectiveGoodput!, color: SERIES[i % SERIES.length] }))} format={(v) => fmtPct(v, 2)} unitLabel={t('common.goodput')} />
          </Card>
          <Card>
            <BarChart title={t('common.lost_per_day')} data={cmp.rows.filter((r) => r.lostDollarsPerDay !== undefined).map((r, i) => ({ label: r.name, value: r.lostDollarsPerDay!, color: SERIES[i % SERIES.length] }))} format={(v) => fmtMoney(v)} unitLabel={t('common.lost_per_day')} />
          </Card>
        </div>
      )}
      {active && !active.error && torn.length > 0 && (
        <Card
          title={`${t('compare.tornado')} — ${active.scenario.meta.name}`}
          actions={
            <Field label={t('compare.metric')}>
              <Select value={metric} onChange={setMetric} options={[{ value: 'goodput', label: t('common.goodput') }, { value: 'availability', label: t('common.availability') }, { value: 'lostDollarsPerDay', label: t('common.lost_per_day') }, { value: 'mtbiHours', label: t('common.mtbi') }]} />
            </Field>
          }
        >
          <Tornado title="" base={base} items={torn.map((r) => ({ name: r.name, low: r.low, high: r.high, lowLabel: r.lowLabel, highLabel: r.highLabel }))} format={fmtMetric} metricLabel={t(`common.${metric === 'lostDollarsPerDay' ? 'lost_per_day' : metric === 'mtbiHours' ? 'mtbi' : metric}`)} />
        </Card>
      )}
    </div>
  );
}
