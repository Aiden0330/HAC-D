import { useTranslation } from 'react-i18next';
import { useActive, useLang } from '../hooks.js';
import { Card, DataTable, Badge } from '../components/ui.js';
import { RbdDiagram } from '../diagrams/RbdDiagram.js';
import { download, scenarioFilename, componentsCsv, htmlReport } from '../lib/export.js';
import { fmtPct, fmtNum } from '../lib/format.js';

export function ReportPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const { scenario, result } = active;
  const cs = result.cutSets;
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
