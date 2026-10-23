import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { tornadoForScenario, type TornadoMetric } from '@hac-d/core';
import { useStore, useActiveSettings } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { Card, Field, Select } from '../components/ui.js';
import { Tornado } from '../charts/Tornado.js';
import { fmtPct, fmtMoney, fmtHours } from '../lib/format.js';

/**
 * v5.2 the one-at-a-time sensitivity of the active project (formerly the tornado of the Compare page) as Review › Sensitivity: the
 * metric (the project's `compare.metric` setting), the tornado chart around the base value with its chart / table toggle.
 */
export function TornadoPanel() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const metric = useActiveSettings().compare.metric;
  const updateSettings = useStore((s) => s.updateActiveSettings);
  const setMetric = (m: TornadoMetric) => updateSettings({ compare: { metric: m } });
  const torn = useMemo(() => {
    if (!active || active.error) return [];
    try {
      return tornadoForScenario(active.scenario, metric);
    } catch {
      return [];
    }
  }, [active, metric]);
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const fmtMetric = (v: number) => (metric === 'goodput' || metric === 'delivered' || metric === 'availability' ? fmtPct(v, 2) : metric === 'lostDollarsPerDay' ? fmtMoney(v) : fmtHours(v, lang));
  const metricLabel = metric === 'delivered' ? t('compare.delivered') : t(`common.${metric === 'lostDollarsPerDay' ? 'lost_per_day' : metric === 'mtbiHours' ? 'mtbi' : metric}`);
  const base = torn[0]?.base ?? 0;
  return (
    <Card
      title={`${t('compare.tornado')} — ${active.scenario.meta.name}`}
      actions={
        <Field label={t('compare.metric')}>
          <Select value={metric} onChange={setMetric} options={[{ value: 'goodput', label: t('common.goodput') }, { value: 'delivered', label: t('compare.delivered') }, { value: 'availability', label: t('common.availability') }, { value: 'lostDollarsPerDay', label: t('common.lost_per_day') }, { value: 'mtbiHours', label: t('common.mtbi') }]} />
        </Field>
      }
    >
      {torn.length === 0 ? <div className="muted">{t('common.none')}</div> : (
        <Tornado title="" base={base} items={torn.map((r) => ({ name: r.name, low: r.low, high: r.high, lowLabel: r.lowLabel, highLabel: r.highLabel }))} format={fmtMetric} metricLabel={metricLabel} />
      )}
    </Card>
  );
}
