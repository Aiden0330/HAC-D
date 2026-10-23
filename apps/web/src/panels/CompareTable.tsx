import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { compareScenarios } from '@hac-d/core';
import { useStore, useActiveSettings, compareIdsOf } from '../state/store.js';
import { useLang } from '../hooks.js';
import { Card, DataTable } from '../components/ui.js';
import { BarChart } from '../charts/BarChart.js';
import { fmtPct, fmtDuration, fmtMoney, fmtHours, fmtInt } from '../lib/format.js';
import { SERIES } from '../charts/common.js';

/**
 * v5.2 the project comparison (formerly the Compare page, without its tornado) as Projects › Compare: the picker of up to four
 * projects (the active project's `compare.ids` setting) and the side-by-side KPI table with the goodput and lost-dollars bars. The
 * one-at-a-time sensitivity of the active project is on Review › Sensitivity.
 */
export function CompareTable() {
  const { t } = useTranslation();
  const lang = useLang();
  const scenarios = useStore((s) => s.scenarios);
  // v5.1 the comparison set is a page setting of the active project
  const cmpSettings = useActiveSettings();
  const compareIds = useMemo(() => compareIdsOf({ scenarios }, cmpSettings), [scenarios, cmpSettings]);
  const toggle = useStore((s) => s.toggleCompare);
  const selected = useMemo(() => scenarios.filter((s) => compareIds.includes(s.meta.id!)), [scenarios, compareIds]);
  const cmp = useMemo(() => {
    try {
      return compareScenarios(selected);
    } catch {
      return undefined;
    }
  }, [selected]);
  return (
    <div className="grid" style={{ gap: 14 }}>
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
            columns={['', t('common.availability'), t('compare.original'), t('compare.performability'), t('compare.human'), t('training.operational'), t('common.mtbi'), t('common.recovery'), t('common.goodput'), t('compare.delivered'), t('common.lost_per_day'), 'blocked', 'hot spares P99', t('inference.capacity'), 'k*', 'checklist warn']}
            rows={cmp.rows.map((r) => [
              r.name,
              `${fmtPct(r.availability, 4)}${cmp.best.availability === r.id ? ' ★' : ''}`,
              fmtPct(r.originalAvailability, 4),
              fmtPct(r.performability, 4),
              fmtPct(r.humanFraction, 0),
              r.operationalAvailability !== undefined ? fmtPct(r.operationalAvailability, 3) : '—',
              r.mtbiHours !== undefined ? `${fmtHours(r.mtbiHours, lang)}${cmp.best.mtbiHours === r.id ? ' ★' : ''}` : '—',
              r.recoveryS !== undefined ? `${fmtDuration(r.recoveryS, lang)}${cmp.best.recoveryS === r.id ? ' ★' : ''}` : '—',
              r.effectiveGoodput !== undefined ? `${fmtPct(r.effectiveGoodput, 2)}${cmp.best.effectiveGoodput === r.id ? ' ★' : ''}` : '—',
              r.deliveredGoodput !== undefined ? `${fmtPct(r.deliveredGoodput, 2)}${cmp.best.deliveredGoodput === r.id ? ' ★' : ''}` : '—',
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
    </div>
  );
}
