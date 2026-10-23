import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { evaluateScenario, type EvaluationResult } from '@hac-d/core';
import { readWorkbook, methodReport, extractTopology, draftToScenario, reconcile, flattenDraft, exportWorkbook, type WorkbookInfo, type MethodReport, type ColumnRole, type MethodHit, type DraftConversion, type TopologyDraft } from '@hac-d/importers';
import { useStore, defaultProjectSettings } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { Card, DataTable, Field, Select, Badge, Kpi } from '../components/ui.js';
import { downloadBytes, scenarioFilename } from '../lib/export.js';
import { fmtPct } from '../lib/format.js';

const ROLES: (ColumnRole | '')[] = ['', 'name', 'level', 'count', 'mtbf_h', 'mttr_h', 'fit', 'lambda_per_h', 'afr_pct', 'availability', 'availability_pct', 'group_availability', 'unavailability', 'redundancy', 'switchover_success', 'auto_fraction', 'mttr_auto_h', 'mttr_manual_h', 'mttr_effective_h', 'notes'];

interface Loaded {
  wb: WorkbookInfo;
  report: MethodReport;
}

/**
 * v5.2 the Excel import flow (formerly the Import page) as a panel of Projects › Import: workbook and sheet, the methods detected in
 * the formulas, the column roles, the extracted topology with its evidence, the reconciliation of the engine against the cached Excel
 * values, import as a new project, and the export of the active scenario as a workbook with live formulas.
 */
export function ImportPanel() {
  const { t } = useTranslation();
  const lang = useLang();
  const store = useStore();
  const active = useActive();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sheetName, setSheetName] = useState<string>('');
  const [overrides, setOverrides] = useState<Partial<Record<ColumnRole, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [importedId, setImportedId] = useState<string | null>(null);

  const onFile = (file: File) => {
    file.arrayBuffer().then((buf) => {
      try {
        const wb = readWorkbook(new Uint8Array(buf), file.name);
        const report = methodReport(wb);
        const first = wb.sheets.find((s) => report.sheets.find((r) => r.sheet === s.name)?.headerRow !== null) ?? wb.sheets[0];
        setLoaded({ wb, report });
        setSheetName(first?.name ?? '');
        setOverrides({});
        setImportedId(null);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const sheet = loaded?.wb.sheets.find((s) => s.name === sheetName);
  const sheetReport = loaded?.report.sheets.find((r) => r.sheet === sheetName);
  const draft: TopologyDraft | undefined = useMemo(() => (sheet && loaded ? extractTopology(sheet, loaded.wb.fileName, { columns: overrides }) : undefined), [sheet, loaded, overrides]);
  const conversion: { conv?: DraftConversion; result?: EvaluationResult; error?: string } = useMemo(() => {
    if (!draft || draft.headerRow < 0) return {};
    try {
      const conv = draftToScenario(draft);
      return { conv, result: evaluateScenario(conv.scenario) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [draft]);
  const hits = useMemo(() => {
    const m = new Map<string, MethodHit>();
    for (const h of sheetReport?.hits ?? []) m.set(h.addr, h);
    return m;
  }, [sheetReport]);
  const rec = useMemo(() => (draft && conversion.conv && conversion.result ? reconcile(draft, conversion.result, conversion.conv.blockIds, hits) : undefined), [draft, conversion, hits]);

  const doImport = () => {
    if (!conversion.conv) return;
    // the new project opens on Projects › Import, so this panel (and its workbook) stays on screen
    const id = store.addScenario({ ...conversion.conv.scenario, meta: { ...conversion.conv.scenario.meta, id: undefined } }, true, { ...defaultProjectSettings(), projects: { tab: 'import' } });
    setImportedId(id);
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <Card>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <label className="btn primary" style={{ cursor: 'pointer' }}>
            {t('import.choose')}
            <input type="file" accept=".xlsx,.xlsm,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
          </label>
          {loaded && (
            <Field label={t('import.sheet')}>
              <Select value={sheetName} onChange={(v) => { setSheetName(v); setOverrides({}); setImportedId(null); }} options={loaded.wb.sheets.map((s) => ({ value: s.name, label: `${s.name} (${s.rows}×${s.cols})` }))} />
            </Field>
          )}
          {loaded && <span className="muted">{loaded.wb.fileName}</span>}
          <div className="spacer" />
          {active && !active.error && (
            <button type="button" className="btn" onClick={() => downloadBytes(scenarioFilename(active.scenario, 'xlsx'), exportWorkbook(active.scenario, active.result))}>{t('import.exportXlsx')}</button>
          )}
        </div>
        {error && <div className="callout crit" style={{ marginTop: 8 }}>{error}</div>}
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('import.futureImage')}</div>
      </Card>

      {loaded && sheetReport && (
        <div className="grid cols-2">
          <Card title={t('import.methods')} sub={sheetReport.notes.join(' · ') || undefined}>
            {loaded.report.methods.length === 0 ? <div className="muted">{t('common.none')}</div> : (
              <DataTable
                columns={[t('import.method'), '#', '']}
                numericFrom={1}
                rows={loaded.report.methods.filter((m) => sheetReport.summary[m.tag]).map((m) => [<span key="t" className="mono" style={{ fontSize: 12 }}>{m.tag}</span>, String(sheetReport.summary[m.tag] ?? 0), lang === 'zh' ? m.description.zh : m.description.en])}
              />
            )}
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>{t('import.hits')} ({sheetReport.hits.length})</summary>
              <DataTable columns={[t('import.cell'), t('import.method'), t('import.formula')]} numericFrom={99} rows={sheetReport.hits.slice(0, 60).map((h) => [h.addr, <span key="t" className="mono" style={{ fontSize: 11 }}>{h.tag}</span>, <span key="f" className="mono" style={{ fontSize: 11 }}>={h.formula}</span>])} />
            </details>
          </Card>
          <Card title={t('import.columns')} sub={sheetReport.headerRow === null ? t('import.noHeader') : `${t('import.header')}: row ${sheetReport.headerRow + 1}`}>
            {draft && draft.headerRow >= 0 ? (
              <DataTable
                columns={[t('import.header'), t('import.role'), t('import.confidence')]}
                numericFrom={99}
                rows={draft.columns.map((c) => [
                  c.header || `(${c.col + 1})`,
                  <Select
                    key="r"
                    value={(c.role ?? '') as ColumnRole | ''}
                    onChange={(v) => setOverrides((o) => {
                      const next: Partial<Record<ColumnRole, number>> = { ...o };
                      for (const [role, col] of Object.entries(next)) if (col === c.col) delete next[role as ColumnRole];
                      if (v) next[v as ColumnRole] = c.col;
                      return next;
                    })}
                    options={ROLES.map((r) => ({ value: r, label: r || t('import.none') }))}
                  />,
                  fmtPct(c.confidence, 0),
                ])}
              />
            ) : <div className="muted">{t('import.noHeader')}</div>}
          </Card>
        </div>
      )}

      {draft && draft.headerRow >= 0 && (
        <Card
          title={t('import.tree')}
          sub={`${t('import.confidence')} ${fmtPct(draft.confidence, 0)} · ${draft.notes.join(' · ')}`}
          actions={
            <div className="btn-row">
              <button type="button" className="btn primary" disabled={!conversion.conv} onClick={doImport}>{t('import.importBtn')}</button>
              {importedId && <Badge status="pass">{t('import.imported')}: {importedId}</Badge>}
            </div>
          }
        >
          {conversion.error && <div className="callout crit" style={{ marginBottom: 8 }}>{conversion.error}</div>}
          <DataTable
            columns={[t('import.node'), t('scenario.kind'), t('common.count'), 'n / k', 'MTBF (h)', 'λ (/h)', 'FIT', t('common.mttr'), t('scenario.switchoverSuccess'), t('import.evidence')]}
            numericFrom={2}
            rows={flattenDraft(draft.root).map(({ node, depth }) => [
              <span key="n" style={{ paddingLeft: depth * 14 }}>{depth > 0 ? '└ ' : ''}{node.name}</span>,
              node.kind,
              String(node.count),
              node.n !== undefined ? `${node.n} / ${node.k ?? '—'}` : '—',
              node.params.mtbfH !== undefined ? String(node.params.mtbfH) : '—',
              node.params.lambdaPerH !== undefined ? node.params.lambdaPerH.toExponential(2) : '—',
              node.params.fit !== undefined ? String(node.params.fit) : '—',
              node.params.mttrH !== undefined ? String(node.params.mttrH) : node.params.mttrManualH !== undefined ? `${node.params.mttrAutoH ?? '—'} / ${node.params.mttrManualH}` : '—',
              node.params.switchoverSuccess !== undefined ? String(node.params.switchoverSuccess) : '—',
              <span key="e" className="muted" style={{ fontSize: 11 }}>{node.evidence.join('; ')}</span>,
            ])}
          />
          {conversion.conv && conversion.conv.notes.length > 0 && (
            <ul className="plain muted" style={{ fontSize: 12, marginTop: 6 }}>
              {conversion.conv.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </Card>
      )}

      {rec && conversion.result && (
        <Card title={t('import.reconcile')} sub={rec.notes.join(' · ')}>
          <div className="kpi-row" style={{ marginBottom: 10 }}>
            <Kpi label={t('common.availability')} value={fmtPct(conversion.result.system.availability, 4)} note={`${t('measures.original')} ${fmtPct(conversion.result.system.measures.original.availability, 4)}`} />
            <Kpi label={t('common.mtbf')} value={`${conversion.result.system.mtbfHours.toFixed(1)} h`} note={`${t('common.mttr_eq')} ${conversion.result.system.equivalentMttrHours.toFixed(2)} h`} />
            {rec.comparable > 0 && <Kpi label={`max |${t('import.delta')}|`} value={rec.maxAbsDelta.toExponential(2)} />}
          </div>
          {rec.comparable === 0 && <div className="callout" style={{ marginBottom: 8 }}>{t('import.noCached')}</div>}
          <DataTable
            columns={[t('import.node'), t('import.engineValue'), t('import.excelValue'), t('import.delta'), t('import.method'), t('common.notes')]}
            numericFrom={1}
            rows={rec.rows.map((r) => [
              <span key="n" style={{ paddingLeft: r.depth * 14 }}>{r.name}</span>,
              r.engine !== undefined ? fmtPct(r.engine, 4) : '—',
              r.excel !== null ? fmtPct(r.excel, 4) : '—',
              r.delta !== null ? r.delta.toExponential(2) : '—',
              r.method ? <span key="m" className="mono" style={{ fontSize: 11 }}>{r.method}</span> : '—',
              <span key="x" className="muted" style={{ fontSize: 11 }}>{r.note}</span>,
            ])}
          />
        </Card>
      )}
    </div>
  );
}
