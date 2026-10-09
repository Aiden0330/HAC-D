import { useTranslation } from 'react-i18next';
import { exportWorkbook } from '@hac-d/importers';
import { useActive, useLang } from '../hooks.js';
import { Card, DataTable, Badge, Kpi } from '../components/ui.js';
import { RbdDiagram } from '../diagrams/RbdDiagram.js';
import { BarChart } from '../charts/BarChart.js';
import { download, downloadBytes, scenarioFilename, componentsCsv, htmlReport } from '../lib/export.js';
import { fmtPct, fmtNum, fmtHours } from '../lib/format.js';
import { SERIES } from '../charts/common.js';

export function ReportPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const { scenario, result } = active;
  const cs = result.cutSets;
  const m = result.system.measures;
  const stepLabel = (id: string) => t(`measures.step_${id}`);
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('report.title')}</h1>
        <span className="sub">{t('report.sub')}</span>
      </div>
      <Card
        title={t('report.checklist')}
        actions={
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => download(scenarioFilename(scenario, 'report.html'), htmlReport(scenario, result, lang), 'text/html')}>{t('report.exportHtml')}</button>
            <button type="button" className="btn" onClick={() => download(scenarioFilename(scenario, 'components.csv'), componentsCsv(result), 'text/csv')}>{t('report.exportCsv')}</button>
            <button type="button" className="btn" onClick={() => download(scenarioFilename(scenario, 'json'), JSON.stringify(scenario, null, 2))}>{t('scenario.exportJson')}</button>
            <button type="button" className="btn" onClick={() => downloadBytes(scenarioFilename(scenario, 'xlsx'), exportWorkbook(scenario, result))}>{t('report.exportXlsx')}</button>
          </div>
        }
      >
        <ul className="plain" style={{ listStyle: 'none', paddingLeft: 0 }}>
          {result.checklist.map((c) => (
            <li key={c.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
              <Badge status={c.status}>{c.status}</Badge>
              <div>
                <b>{lang === 'zh' ? c.title.zh : c.title.en}</b>
                <div className="muted" style={{ fontSize: 12 }}>{c.message}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('measures.title')} sub={t('measures.sub')} formula={result.formulas.measures}>
        <div className="kpi-row" style={{ marginBottom: 10 }}>
          <Kpi label={t('measures.original')} value={fmtPct(m.original.availability, 4)} note={`${t('common.mtbf')} ${fmtHours(m.original.mtbfHours, lang)}`} />
          <Kpi label={t('measures.compensated')} value={fmtPct(m.compensated.availability, 4)} note={`${t('common.mtbf')} ${fmtHours(m.compensated.mtbfHours, lang)}`} hero />
          <Kpi label={t('measures.performability')} value={fmtPct(m.performability, 4)} note={`${t('measures.strict')} ${fmtPct(m.strict, 4)}`} />
          <Kpi label={t('measures.gain')} value={fmtPct(m.gain.deltaAvailability, 3)} note={`${t('measures.unavailabilityRatio')} ${Number.isFinite(m.gain.unavailabilityRatio) ? fmtNum(m.gain.unavailabilityRatio, 1) : '∞'}`} />
          <Kpi label={t('measures.switchoverPenalty')} value={m.switchoverPenalty > 0 ? m.switchoverPenalty.toExponential(2) : '0'} />
          <Kpi label={t('measures.humanFraction')} value={fmtPct(result.system.humanFraction, 1)} note={result.system.autoDowntimeShare !== undefined ? `${t('measures.autoShare')} ${fmtPct(result.system.autoDowntimeShare, 1)}` : undefined} />
        </div>
        <div className="grid cols-2">
          <BarChart
            title={t('measures.waterfall')}
            data={result.system.waterfall.map((w, i) => ({ label: stepLabel(w.id), value: w.unavailability, note: `A = ${fmtPct(w.availability, 4)} · Δ ${w.delta >= 0 ? '+' : ''}${w.delta.toExponential(2)}`, color: SERIES[i % SERIES.length] }))}
            format={(v) => fmtPct(v, 4)}
            unitLabel={t('measures.unavailability')}
          />
          <DataTable
            columns={[t('measures.measure'), t('common.availability'), t('measures.unavailability'), t('common.mtbf'), t('common.mttr_eq'), t('measures.frequency')]}
            rows={[
              [t('measures.original'), fmtPct(m.original.availability, 4), m.original.unavailability.toExponential(3), fmtHours(m.original.mtbfHours, lang), fmtHours(m.original.equivalentMttrHours, lang), m.original.failureFrequencyPerHour.toExponential(3)],
              [t('measures.compensated'), fmtPct(m.compensated.availability, 4), m.compensated.unavailability.toExponential(3), fmtHours(m.compensated.mtbfHours, lang), fmtHours(m.compensated.equivalentMttrHours, lang), m.compensated.failureFrequencyPerHour.toExponential(3)],
              [t('measures.strict'), fmtPct(m.strict, 4), (1 - m.strict).toExponential(3), '', '', ''],
              [t('measures.tolerant'), fmtPct(m.tolerant, 4), (1 - m.tolerant).toExponential(3), '', '', ''],
              [t('measures.performability'), fmtPct(m.performability, 4), (1 - m.performability).toExponential(3), '', '', ''],
            ]}
          />
        </div>
        {result.system.approximate && <div className="callout warn" style={{ marginTop: 8 }}>{t('measures.approximate')}</div>}
      </Card>
      <Card title={t('rbd.title')} sub={t('rbd.sub')}>
        <RbdDiagram root={result.structure.root} result={result.structure.result} lang={lang} weakestId={result.system.weakestBlock?.id} />
      </Card>
      <div className="grid cols-2">
        <Card title={t('report.importanceTitle')} formula="Birnbaum = A(A_i=1) − A(A_i=0); FV = (U − U(A_i=1))/U; RAW = U(A_i=0)/U; RRW = U/U(A_i=1)">
          <DataTable columns={['', 'A', t('report.birnbaum'), t('report.fv'), t('report.raw'), t('report.rrw')]} rows={result.importance.slice(0, 15).map((r) => [r.name, fmtPct(r.availability, 3), fmtNum(r.birnbaum, 4), fmtPct(r.fusselVesely, 1), fmtNum(r.raw, 2), Number.isFinite(r.rrw) ? fmtNum(r.rrw, 2) : '∞'])} />
        </Card>
        <Card title={t('report.cutsets')} sub={`${cs.cutSets.length}${cs.truncated ? '+' : ''} cut sets · rare-event top ≈ ${fmtPct(cs.topEventApprox, 3)} vs exact U = ${fmtPct(result.system.unavailability, 3)}`}>
          <DataTable columns={['cut set', 'units down']} numericFrom={1} rows={cs.cutSets.slice(0, 15).map((m) => [[...m.keys()].join(' + '), [...m.values()].reduce((a, b) => a + b, 0)])} />
        </Card>
      </div>
      <div className="grid cols-2">
        <Card title={t('common.assumptions')}>
          <ul className="plain">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Card>
        <Card title={t('common.warnings')}>
          {result.warnings.length === 0 ? <div className="muted">{t('common.none')}</div> : (
            <ul className="plain">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
