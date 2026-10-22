import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXAMPLES, TOPOLOGY_TEMPLATES, TOPOLOGY_TEMPLATE_IDS, TOPOLOGY_SCALES, topologyScenario, scaleLabel, type Scenario, type TopologyTemplate } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useLang } from '../hooks.js';
import { Card, Field, Select } from '../components/ui.js';
import { download, scenarioFilename } from '../lib/export.js';
import { fmtInt } from '../lib/format.js';

/**
 * v5.1 the one place to load and save: every project (a scenario + its page settings, saved automatically on every edit) with
 * open / rename / duplicate / export / reset to template / delete, a new project from a template at a built-in scale, import of a
 * project bundle or a bare scenario JSON, and reset to the built-ins.
 */
export function ProjectsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const scenarios = useStore((s) => s.scenarios);
  const activeId = useStore((s) => s.activeId);
  const projectMeta = useStore((s) => s.projectMeta);
  const store = useStore.getState;
  const setPage = useStore((s) => s.setPage);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [tpl, setTpl] = useState<TopologyTemplate>('a3-ub384');
  const [scale, setScale] = useState<string>(String(TOPOLOGY_SCALES[0]));
  const [msg, setMsg] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const L = (x: { zh: string; en: string }) => (lang === 'zh' ? x.zh : x.en);
  const templateOf = (s: Scenario) => (s.topology.template ? L(TOPOLOGY_TEMPLATES[s.topology.template].name) : t('projects.customTopology'));
  const sizeOf = (s: Scenario) =>
    s.workload.type === 'training'
      ? t('projects.trainingSize', { n: fmtInt(s.workload.nGpus) })
      : t('projects.inferenceSize', { r: fmtInt(s.workload.replicasRequired), g: fmtInt(s.workload.gpusPerReplica), n: fmtInt(s.workload.replicasRequired * s.workload.gpusPerReplica) });
  const when = (ms?: number) => (ms ? new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const open = (id: string) => { store().setActive(id); setPage('topology'); };
  const commitRename = () => { if (editing) store().renameProject(editing.id, editing.name); setEditing(null); };
  const exportOne = (id: string) => {
    const b = store().exportProject(id);
    if (b) download(scenarioFilename(b.scenario, 'hacd.json'), JSON.stringify(b, null, 2));
  };
  const remove = (s: Scenario) => {
    if (scenarios.length <= 1) return;
    if (window.confirm(t('projects.confirmDelete', { name: s.meta.name }))) store().removeScenario(s.meta.id!);
  };
  const resetOne = (s: Scenario) => {
    if (window.confirm(t('projects.confirmResetTemplate', { name: s.meta.name }))) store().resetProject(s.meta.id!);
  };
  const create = () => {
    const n = Number(scale);
    const fresh = topologyScenario(tpl, n);
    // a new project is a user project: its id follows the name, never the template's built-in id
    store().addScenario({ ...fresh, meta: { ...fresh.meta, id: undefined } }, true);
    setPage('topology');
  };
  const importFile = (file: File) => {
    file.text().then((txt) => {
      try {
        const id = store().importProject(txt);
        const s = store().scenarios.find((x) => x.meta.id === id);
        setMsg({ text: t('projects.imported', { name: s?.meta.name ?? id }), tone: 'info' });
      } catch (e) {
        setMsg({ text: `${t('projects.importInvalid')}: ${(e as Error).message}`, tone: 'crit' });
      }
    });
  };
  const resetAll = () => { if (window.confirm(t('projects.confirmResetAll'))) { store().resetToExamples(); setMsg(null); } };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('projects.title')}</h1>
        <span className="sub">{t('projects.sub')}</span>
      </div>
      <Card title={t('projects.listTitle', { n: scenarios.length })} sub={t('projects.listSub')}>
        <div className="table-wrap">
          <table className="data projects">
            <thead>
              <tr>
                <th>{t('projects.colName')}</th>
                <th>{t('projects.colTemplate')}</th>
                <th>{t('projects.colSize')}</th>
                <th>{t('projects.colOrigin')}</th>
                <th>{t('projects.colModified')}</th>
                <th>{t('projects.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => {
                const id = s.meta.id!;
                const isActive = id === activeId;
                const builtIn = !!EXAMPLES[id];
                const isEditing = editing?.id === id;
                return (
                  <tr key={id} className={isActive ? 'active' : undefined} data-project={id}>
                    <td className="name">
                      {isEditing ? (
                        <input
                          autoFocus
                          aria-label={t('projects.rename')}
                          value={editing.name}
                          onChange={(e) => setEditing({ id, name: e.target.value })}
                          onBlur={commitRename}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null); }}
                        />
                      ) : (
                        <>
                          <strong>{s.meta.name}</strong>
                          {isActive && <span className="muted" style={{ fontSize: 12 }}> · {t('projects.activeTag')}</span>}
                          <div className="muted mono" style={{ fontSize: 11 }}>{id}</div>
                        </>
                      )}
                    </td>
                    <td data-label={t('projects.colTemplate')}>{templateOf(s)}</td>
                    <td data-label={t('projects.colSize')}>{sizeOf(s)}</td>
                    <td className="origin" data-label={t('projects.colOrigin')}>{builtIn ? t('projects.builtIn') : t('projects.user')}</td>
                    <td className="when" data-label={t('projects.colModified')}>{when(projectMeta[id]?.modified)}</td>
                    <td className="actions">
                      <div className="btn-row">
                        <button type="button" className="btn small primary" onClick={() => open(id)}>{t('projects.open')}</button>
                        {isEditing
                          ? <button type="button" className="btn small" onMouseDown={(e) => e.preventDefault()} onClick={commitRename}>{t('projects.save')}</button>
                          : <button type="button" className="btn small" onClick={() => setEditing({ id, name: s.meta.name })}>{t('projects.rename')}</button>}
                        <button type="button" className="btn small" onClick={() => store().duplicateProject(id)}>{t('projects.duplicate')}</button>
                        <button type="button" className="btn small" onClick={() => exportOne(id)}>{t('projects.export')}</button>
                        {builtIn && <button type="button" className="btn small" onClick={() => resetOne(s)} title={t('projects.resetTemplateHint')}>{t('projects.resetTemplate')}</button>}
                        <button type="button" className="btn small" onClick={() => remove(s)} disabled={scenarios.length <= 1} title={scenarios.length <= 1 ? t('projects.deleteLast') : undefined}>{t('projects.delete')}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('projects.autosave')}</div>
      </Card>
      <Card title={t('projects.newTitle')} sub={t('projects.newSub')}>
        <div className="new-project">
          <Field label={t('projects.template')}>
            <Select value={tpl} onChange={setTpl} options={TOPOLOGY_TEMPLATE_IDS.map((id) => ({ value: id, label: L(TOPOLOGY_TEMPLATES[id].name) }))} />
          </Field>
          <Field label={t('projects.scale')}>
            <Select value={scale} onChange={setScale} options={TOPOLOGY_SCALES.map((n) => ({ value: String(n), label: `${scaleLabel(n)} · ${t('projects.trainingSize', { n: fmtInt(n) })}` }))} />
          </Field>
          <button type="button" className="btn primary" onClick={create}>{t('projects.create')}</button>
        </div>
      </Card>
      <Card title={t('projects.fileTitle')} sub={t('projects.fileSub')}>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{t('projects.import')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} aria-label={t('projects.import')} onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.currentTarget.value = ''; }} />
          <button type="button" className="btn" onClick={resetAll}>{t('projects.resetAll')}</button>
        </div>
        {msg && <div className={`callout${msg.tone === 'crit' ? ' crit' : ''}`} style={{ marginTop: 8 }}>{msg.text}</div>}
      </Card>
    </div>
  );
}
