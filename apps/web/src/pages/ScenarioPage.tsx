import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXAMPLES, parseScenario, PIPELINE_PRESETS, type Scenario, type Component } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { Kpi, Card, Field, NumberInput, Select, Badge } from '../components/ui.js';
import { RbdDiagram } from '../diagrams/RbdDiagram.js';
import { download, scenarioFilename } from '../lib/export.js';
import { fmtPct, fmtDuration, fmtHours } from '../lib/format.js';

const RATE_UNITS = ['per_h', 'per_1e6_h', 'FIT', 'per_year', 'per_day', 'per_1000_node_day', 'per_month', 'per_week', 'mtbf_h', 'gpu_h_per_event', 'gpu_day_per_event'] as const;
const DOMAINS = ['gpu', 'node', 'nvlink_domain', 'rack', 'tor', 'power_zone', 'cdu', 'plane', 'zone', 'cluster'] as const;
const SUBSYSTEMS = ['compute', 'memory', 'interconnect', 'network', 'host', 'storage', 'power', 'cooling', 'software', 'other'] as const;
const STAGES = ['detect', 'localize', 'remediate', 'restart', 'load', 'warmup'] as const;

type Upd = (fn: (s: Scenario) => Scenario) => void;

export function ScenarioPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const store = useStore();
  const [error, setError] = useState<string | null>(null);
  const [exampleKey, setExampleKey] = useState(Object.keys(EXAMPLES)[0]);
  const fileRef = useRef<HTMLInputElement>(null);

  const upd: Upd = (fn) => {
    try {
      store.updateActive(fn);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!active) return <div className="callout">No scenario. Load an example.</div>;
  const { scenario: s, result } = active;

  const importJson = (file: File) => {
    file.text().then((txt) => {
      try {
        const parsed = parseScenario(JSON.parse(txt));
        store.addScenario({ ...parsed, meta: { ...parsed.meta, id: undefined } }, true);
        setError(null);
      } catch (e) {
        setError(`${t('scenario.jsonInvalid')}: ${(e as Error).message}`);
      }
    });
  };

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('scenario.title')}</h1>
        <span className="sub">{t('scenario.sub')}</span>
      </div>
      <Card>
        <div className="btn-row">
          <Select value={exampleKey} onChange={setExampleKey} options={Object.keys(EXAMPLES).map((k) => ({ value: k, label: `${k} — ${EXAMPLES[k]().meta.name}` }))} />
          <button type="button" className="btn" onClick={() => store.loadExample(exampleKey)}>{t('scenario.examples')}</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{t('scenario.importJson')}</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = ''; }} />
          <button type="button" className="btn" onClick={() => download(scenarioFilename(s, 'json'), JSON.stringify(s, null, 2))}>{t('scenario.exportJson')}</button>
          <button type="button" className="btn" onClick={() => store.duplicateActive()}>{t('scenario.duplicate')}</button>
          <button type="button" className="btn" onClick={() => { if (store.scenarios.length > 1) store.removeScenario(s.meta.id!); }} disabled={store.scenarios.length <= 1}>{t('scenario.deleteScenario')}</button>
          <button type="button" className="btn" onClick={() => store.resetToExamples()}>{t('common.reset')}</button>
        </div>
        {error && <div className="callout crit" style={{ marginTop: 8 }}>{error}</div>}
      </Card>
      {!active.error && result && (
        <div className="kpi-row">
          <Kpi label={t('common.availability')} value={fmtPct(result.system.availability, 4)} note={`${t('common.mtbf')} ${fmtHours(result.system.mtbfHours, lang)}`} />
          {result.training && <Kpi label={t('common.goodput')} value={fmtPct(result.training.effectiveGoodput, 2)} note={`${t('common.mtbi')} ${fmtDuration(result.training.mtbiS, lang)} · R ${fmtDuration(result.training.recoveryS, lang)}`} tone={result.training.effectiveGoodput < 0.9 ? 'bad' : undefined} />}
          {result.inference && <Kpi label={t('inference.capacity')} value={fmtPct(result.inference.capacityAvailability, 4)} note={`k* = ${result.inference.kRequiredForTarget}`} />}
          <Kpi label={t('common.weakest')} value={result.system.weakestBlock?.name ?? '—'} />
          <Kpi label="GPUs · nodes · racks" value={`${result.counts.gpus} · ${result.counts.nodes} · ${result.counts.racks}`} note={`NVLink domains ${result.counts.nvlinkDomains}`} />
        </div>
      )}
      {active.error && <div className="callout crit">{active.error}</div>}
      <div className="grid cols-2">
        <Card title={s.meta.name} sub={s.meta.description}>
          <div className="form-grid">
            <Field label={t('common.name')}><input value={s.meta.name} onChange={(e) => upd((x) => ({ ...x, meta: { ...x.meta, name: e.target.value } }))} /></Field>
            <Field label={t('scenario.template')}>
              <Select
                value={s.structure.mode === 'template' ? s.structure.template : 'custom'}
                onChange={(v) => { if (v !== 'custom') upd((x) => ({ ...x, structure: { mode: 'template', template: v as 'training-series' } })); }}
                options={[{ value: 'training-series', label: t('scenario.trainingSeries') }, { value: 'training-hot-spares', label: t('scenario.trainingHotSpares') }, { value: 'inference-nk', label: t('scenario.inferenceNk') }, { value: 'infrastructure', label: t('scenario.infrastructure') }, ...(s.structure.mode === 'custom' ? [{ value: 'custom', label: 'custom (JSON)' }] : [])]}
              />
            </Field>
          </div>
          <h3 style={{ margin: '12px 0 6px' }}>{t('scenario.topology')}</h3>
          <div className="form-grid">
            <Field label={t('scenario.gpusPerNode')}><NumberInput value={s.topology.gpusPerNode} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, gpusPerNode: Math.round(v) } }))} /></Field>
            <Field label={t('scenario.nodesPerRack')}><NumberInput value={s.topology.nodesPerRack} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, nodesPerRack: Math.round(v) } }))} /></Field>
            <Field label={t('scenario.racksPerZone')}><NumberInput value={s.topology.racksPerZone} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, racksPerZone: Math.round(v) } }))} /></Field>
            <Field label={t('scenario.nvlinkDomain')}><NumberInput value={s.topology.nvlinkDomainGpus} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, nvlinkDomainGpus: Math.round(v) } }))} /></Field>
            <Field label={t('scenario.planes')}><NumberInput value={s.topology.networkPlanes} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, networkPlanes: Math.round(v) } }))} /></Field>
          </div>
          <h3 style={{ margin: '12px 0 6px' }}>{t('scenario.workload')}</h3>
          <div className="form-grid">
            <Field label={t('scenario.workloadType')}>
              <Select
                value={s.workload.type}
                onChange={(v) =>
                  upd((x) =>
                    v === 'training'
                      ? { ...x, workload: { type: 'training', nGpus: 16384, durationDays: 30, deltaS: 2.43, intervalModel: 'young', hotSpareNodes: 0, spareReplenishHours: 24, recovery: 'checkpoint' }, structure: { mode: 'template', template: 'training-series' } }
                      : { ...x, workload: { type: 'inference', replicasRequired: 64, gpusPerReplica: 8, spareReplicas: 4, capacityTarget: 0.999, windowHours: 24 }, structure: { mode: 'template', template: 'inference-nk' } },
                  )
                }
                options={[{ value: 'training', label: t('scenario.training') }, { value: 'inference', label: t('scenario.inference') }]}
              />
            </Field>
            {s.workload.type === 'training' ? (
              <>
                <Field label={t('scenario.nGpus')}><NumberInput value={s.workload.nGpus} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), nGpus: Math.round(v) } }))} /></Field>
                <Field label={t('scenario.durationDays')}><NumberInput value={s.workload.durationDays} min={0.1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), durationDays: v } }))} /></Field>
                <Field label={t('scenario.deltaS')}><NumberInput value={s.workload.deltaS} min={0} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), deltaS: v } }))} /></Field>
                <Field label={t('scenario.intervalModel')}><Select value={s.workload.intervalModel} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), intervalModel: v } }))} options={[{ value: 'young', label: 'Young √(2δM)' }, { value: 'daly3', label: 'Daly three-term' }, { value: 'dalyExact', label: 'Daly exact' }, { value: 'saxena', label: 'Saxena (availability)' }]} /></Field>
                <Field label={t('scenario.hotSpares')}><NumberInput value={s.workload.hotSpareNodes} min={0} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), hotSpareNodes: Math.round(v) }, structure: Math.round(v) > 0 && x.structure.mode === 'template' && x.structure.template === 'training-series' ? { mode: 'template', template: 'training-hot-spares' } : x.structure }))} /></Field>
                <Field label={t('scenario.replenish')}><NumberInput value={s.workload.spareReplenishHours} min={0.01} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), spareReplenishHours: v } }))} /></Field>
                <Field label={t('scenario.recoveryPath')}><Select value={s.workload.recovery} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), recovery: v } }))} options={[{ value: 'checkpoint', label: 'checkpoint (τ/2)' }, { value: 'replica', label: 'replica (one step)' }]} /></Field>
                {s.workload.recovery === 'replica' && <Field label={t('scenario.stepTime')}><NumberInput value={s.workload.stepTimeS ?? 10} min={0} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), stepTimeS: v } }))} /></Field>}
              </>
            ) : (
              <>
                <Field label={t('scenario.replicasRequired')}><NumberInput value={s.workload.replicasRequired} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), replicasRequired: Math.round(v) } }))} /></Field>
                <Field label={t('scenario.gpusPerReplica')}><NumberInput value={s.workload.gpusPerReplica} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), gpusPerReplica: Math.round(v) } }))} /></Field>
                <Field label={t('scenario.spareReplicas')}><NumberInput value={s.workload.spareReplicas} min={0} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), spareReplicas: Math.round(v) } }))} /></Field>
                <Field label={t('scenario.capacityTarget')}><NumberInput value={s.workload.capacityTarget} min={0} max={1} step={0.0001} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), capacityTarget: v } }))} /></Field>
                <Field label={t('scenario.windowHours')}><NumberInput value={s.workload.windowHours} min={0.1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), windowHours: v } }))} /></Field>
                <Field label={t('scenario.replicaRecovery')}><NumberInput value={s.workload.replicaRecoveryHours ?? 1} min={0.001} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), replicaRecoveryHours: v } }))} /></Field>
              </>
            )}
          </div>
          <h3 style={{ margin: '12px 0 6px' }}>{t('scenario.spares')} · {t('scenario.targets')} · {t('scenario.costs')}</h3>
          <div className="form-grid">
            <Field label={t('scenario.hwFraction')}><NumberInput value={s.spares.hardwareReplacementFraction} min={0} max={1} step={0.01} onChange={(v) => upd((x) => ({ ...x, spares: { ...x.spares, hardwareReplacementFraction: v } }))} /></Field>
            <Field label={t('scenario.turnaround')}><NumberInput value={s.spares.turnaroundHours} min={0.1} onChange={(v) => upd((x) => ({ ...x, spares: { ...x.spares, turnaroundHours: v } }))} /></Field>
            <Field label={t('scenario.quantile')}><NumberInput value={s.spares.quantile} min={0.5} max={0.999999} step={0.001} onChange={(v) => upd((x) => ({ ...x, spares: { ...x.spares, quantile: v } }))} /></Field>
            <Field label={t('scenario.goodputTarget')}><NumberInput value={s.targets.goodput ?? 0.97} min={0} max={1} step={0.005} onChange={(v) => upd((x) => ({ ...x, targets: { ...x.targets, goodput: v } }))} /></Field>
            <Field label={t('scenario.availabilityTarget')}><NumberInput value={s.targets.availability ?? 0.999} min={0} max={1} step={0.0005} onChange={(v) => upd((x) => ({ ...x, targets: { ...x.targets, availability: v } }))} /></Field>
            <Field label={t('scenario.pricePerGpuHour')}><NumberInput value={s.costs.pricePerGpuHour} min={0} step={0.1} onChange={(v) => upd((x) => ({ ...x, costs: { ...x.costs, pricePerGpuHour: v } }))} /></Field>
          </div>
        </Card>
        <RecoveryEditor s={s} upd={upd} />
      </div>
      <ComponentsEditor s={s} upd={upd} />
      {!active.error && result && (
        <Card title={t('rbd.title')} sub={t('rbd.sub')}>
          <RbdDiagram root={result.structure.root} result={result.structure.result} lang={lang} weakestId={result.system.weakestBlock?.id} />
          {result.structure.notes.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{result.structure.notes.join(' · ')}</div>}
        </Card>
      )}
      <JsonEditor s={s} onApply={(next) => { try { store.replaceScenario(s.meta.id!, parseScenario(next)); setError(null); } catch (e) { setError(`${t('scenario.jsonInvalid')}: ${(e as Error).message}`); } }} />
    </div>
  );
}

function RecoveryEditor({ s, upd }: { s: Scenario; upd: Upd }) {
  const { t } = useTranslation();
  const presets = Object.keys(PIPELINE_PRESETS);
  const mode = s.recovery.mode;
  return (
    <Card title={t('scenario.recovery')}>
      <div className="form-grid">
        <Field label={t('scenario.preset')}>
          <Select
            value={mode === 'preset' ? s.recovery.preset : 'custom'}
            onChange={(v) => {
              if (v === 'custom') {
                const p = mode === 'preset' ? PIPELINE_PRESETS[s.recovery.preset] : null;
                upd((x) => ({ ...x, recovery: { mode: 'pipeline', stages: (p?.stages ?? [{ name: 'detect', value: 60 }, { name: 'localize', value: 60 }, { name: 'remediate', value: 60 }, { name: 'restart', value: 120 }, { name: 'load', value: 60 }]).map((st) => ({ ...st })) as never } }));
              } else upd((x) => ({ ...x, recovery: { mode: 'preset', preset: v } }));
            }}
            options={[...presets.map((p) => ({ value: p, label: PIPELINE_PRESETS[p].name ?? p })), { value: 'custom', label: 'custom pipeline…' }]}
          />
        </Field>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="data">
          <thead>
            <tr><th>{t('scenario.stage')}</th><th className="num">{t('scenario.valueS')}</th><th>{t('scenario.scaleLaw')}</th><th className="num">{t('scenario.refN')}</th><th className="num">{t('scenario.exponent')} / {t('scenario.slope')}</th><th>{t('common.notes')}</th><th></th></tr>
          </thead>
          <tbody>
            {(mode === 'preset' ? PIPELINE_PRESETS[s.recovery.preset]?.stages ?? [] : s.recovery.stages).map((st, i) => {
              const ro = mode === 'preset';
              const setStage = (patch: Record<string, unknown>) =>
                upd((x) => (x.recovery.mode === 'pipeline' ? { ...x, recovery: { ...x.recovery, stages: x.recovery.stages.map((q, j) => (j === i ? ({ ...q, ...patch } as typeof q) : q)) } } : x));
              const law = st.scale ?? { type: 'constant' as const };
              return (
                <tr key={i}>
                  <td>{ro ? st.name : <Select value={st.name} onChange={(v) => setStage({ name: v })} options={STAGES.map((n) => ({ value: n, label: n }))} />}</td>
                  <td className="num">{ro ? (typeof st.value === 'number' ? st.value.toFixed(0) : 'dist') : <NumberInput value={typeof st.value === 'number' ? st.value : 0} min={0} onChange={(v) => setStage({ value: v })} />}</td>
                  <td>{ro ? law.type : <Select value={law.type} onChange={(v) => setStage({ scale: v === 'constant' ? { type: 'constant' } : v === 'linear' ? { type: 'linear', refN: 8192 } : v === 'power' ? { type: 'power', refN: 8192, exponent: 0.5 } : v === 'log' ? { type: 'log', refN: 8192, slope: 0.3 } : { type: 'order-statistic', refN: 8192, cv: 0.2 } })} options={['constant', 'linear', 'power', 'log', 'order-statistic'].map((n) => ({ value: n, label: n }))} />}</td>
                  <td className="num">{'refN' in law ? (ro ? law.refN : <NumberInput value={law.refN} min={1} onChange={(v) => setStage({ scale: { ...law, refN: v } })} />) : '—'}</td>
                  <td className="num">{'exponent' in law ? (ro ? law.exponent : <NumberInput value={law.exponent} onChange={(v) => setStage({ scale: { ...law, exponent: v } })} />) : 'slope' in law ? (ro ? law.slope : <NumberInput value={law.slope} onChange={(v) => setStage({ scale: { ...law, slope: v } })} />) : 'cv' in law ? (ro ? law.cv : <NumberInput value={law.cv} onChange={(v) => setStage({ scale: { ...law, cv: v } })} />) : '—'}</td>
                  <td className="muted" style={{ fontSize: 11, maxWidth: 260 }}>{st.note ?? ''}</td>
                  <td>{!ro && <button type="button" className="btn small" onClick={() => upd((x) => (x.recovery.mode === 'pipeline' ? { ...x, recovery: { ...x.recovery, stages: x.recovery.stages.filter((_q, j) => j !== i) } } : x))}>×</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mode === 'pipeline' && (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn small" onClick={() => upd((x) => (x.recovery.mode === 'pipeline' ? { ...x, recovery: { ...x.recovery, stages: [...x.recovery.stages, { name: 'warmup', value: 30 }] } } : x))}>{t('common.add')}</button>
        </div>
      )}
    </Card>
  );
}

function ComponentsEditor({ s, upd }: { s: Scenario; upd: Upd }) {
  const { t } = useTranslation();
  const setComp = (id: string, fn: (c: Component) => Component) => upd((x) => ({ ...x, components: x.components.map((c) => (c.id === id ? fn(c) : c)) }));
  const add = () =>
    upd((x) => ({
      ...x,
      components: [
        ...x.components,
        { id: `component-${x.components.length + 1}`, name: { en: 'New component' }, subsystem: 'other', countRule: { per: 'fixed', count: 1 }, failure: { value: 10, unit: 'per_1e6_h', provenance: { source: 'assumed', confidence: 'assumed' } }, repair: { mttrHours: 8 }, enabled: true } as Component,
      ],
    }));
  return (
    <Card title={t('scenario.components')} actions={<button type="button" className="btn small" onClick={add}>{t('scenario.addComponent')}</button>}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('scenario.enabled')}</th><th>id · {t('common.name')}</th><th>subsystem</th><th>{t('common.count')}</th><th className="num">λ</th><th>{t('common.unit')}</th><th className="num">{t('common.mttr')}</th><th>{t('scenario.redundancy')}</th><th>{t('scenario.ccf')}</th><th>{t('scenario.failslow')}</th><th>{t('common.confidence')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {s.components.map((c) => (
              <tr key={c.id}>
                <td><input type="checkbox" checked={c.enabled} onChange={(e) => setComp(c.id, (q) => ({ ...q, enabled: e.target.checked }))} /></td>
                <td style={{ minWidth: 160 }}>
                  <div className="mono" style={{ fontSize: 11 }}>{c.id}</div>
                  <input value={c.name?.en ?? ''} placeholder="name" onChange={(e) => setComp(c.id, (q) => ({ ...q, name: { ...q.name, en: e.target.value } }))} />
                </td>
                <td><Select value={c.subsystem} onChange={(v) => setComp(c.id, (q) => ({ ...q, subsystem: v }))} options={SUBSYSTEMS.map((x) => ({ value: x, label: x }))} /></td>
                <td style={{ minWidth: 150 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Select value={c.countRule.per} onChange={(v) => setComp(c.id, (q) => ({ ...q, countRule: v === 'fixed' ? { per: 'fixed', count: 1 } : { per: v as 'gpu', factor: 1 } }))} options={['gpu', 'node', 'rack', 'zone', 'fixed'].map((x) => ({ value: x, label: `per ${x}` }))} />
                    <NumberInput value={c.countRule.per === 'fixed' ? c.countRule.count : c.countRule.factor} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, countRule: q.countRule.per === 'fixed' ? { per: 'fixed', count: v } : { per: q.countRule.per, factor: v } }))} />
                  </div>
                </td>
                <td className="num" style={{ minWidth: 90 }}><NumberInput value={c.failure.value} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, failure: { ...q.failure, value: v } }))} /></td>
                <td><Select value={c.failure.unit} onChange={(v) => setComp(c.id, (q) => ({ ...q, failure: { ...q.failure, unit: v } }))} options={RATE_UNITS.map((u) => ({ value: u, label: u }))} /></td>
                <td className="num" style={{ minWidth: 80 }}><NumberInput value={c.repair.mttrHours} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, repair: { ...q.repair, mttrHours: v } }))} /></td>
                <td style={{ minWidth: 170 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Select value={c.redundancy?.scheme ?? 'series'} onChange={(v) => setComp(c.id, (q) => ({ ...q, redundancy: v === 'series' ? undefined : { scheme: v as 'parallel', n: q.countRule.per === 'fixed' ? q.countRule.count : q.countRule.factor, k: v === 'kofn' ? Math.max(1, (q.countRule.per === 'fixed' ? q.countRule.count : q.countRule.factor) - 1) : undefined } }))} options={['series', 'parallel', 'kofn', 'standby'].map((x) => ({ value: x, label: x }))} />
                    {c.redundancy?.scheme === 'kofn' && <NumberInput value={c.redundancy.k ?? 1} min={1} step={1} onChange={(v) => setComp(c.id, (q) => ({ ...q, redundancy: { ...q.redundancy!, k: Math.round(v) } }))} />}
                  </div>
                </td>
                <td style={{ minWidth: 170 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Select value={c.ccf?.domain ?? ''} onChange={(v) => setComp(c.id, (q) => ({ ...q, ccf: v ? { domain: v as 'rack', beta: q.ccf?.beta ?? 0.05 } : undefined }))} options={[{ value: '', label: '—' }, ...DOMAINS.map((d) => ({ value: d, label: d }))]} />
                    {c.ccf && <NumberInput value={c.ccf.beta} min={0} max={1} step={0.01} onChange={(v) => setComp(c.id, (q) => ({ ...q, ccf: { ...q.ccf!, beta: v } }))} />}
                  </div>
                </td>
                <td style={{ minWidth: 150 }}>
                  <input type="checkbox" checked={!!c.failslow} onChange={(e) => setComp(c.id, (q) => ({ ...q, failslow: e.target.checked ? { ratePerHour: 1e-6, durationHours: 1.2, capacity: 0.5 } : undefined }))} />
                  {c.failslow && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <NumberInput value={c.failslow.ratePerHour} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, failslow: { ...q.failslow!, ratePerHour: v } }))} />
                      <NumberInput value={c.failslow.durationHours} min={0.001} onChange={(v) => setComp(c.id, (q) => ({ ...q, failslow: { ...q.failslow!, durationHours: v } }))} />
                      <NumberInput value={c.failslow.capacity} min={0} max={1} step={0.05} onChange={(v) => setComp(c.id, (q) => ({ ...q, failslow: { ...q.failslow!, capacity: v } }))} />
                    </div>
                  )}
                </td>
                <td>
                  <Badge status={c.failure.provenance?.confidence ?? 'assumed'}>{c.failure.provenance?.confidence ?? 'none'}</Badge>
                  {c.failure.provenance?.source && <div className="muted" style={{ fontSize: 10, maxWidth: 160 }}>{c.failure.provenance.source}</div>}
                </td>
                <td><button type="button" className="btn small" onClick={() => upd((x) => ({ ...x, components: x.components.filter((q) => q.id !== c.id) }))} disabled={s.components.length <= 1}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('library.sub')} → {t('nav.library')}</div>
    </Card>
  );
}

function JsonEditor({ s, onApply }: { s: Scenario; onApply: (parsed: unknown) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(JSON.stringify(s, null, 2));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(JSON.stringify(s, null, 2));
  }, [s, dirty]);
  return (
    <Card
      title={t('scenario.json')}
      actions={
        <div className="btn-row">
          <button type="button" className="btn small" onClick={() => { setText(JSON.stringify(s, null, 2)); setDirty(false); }}>{t('common.reset')}</button>
          <button type="button" className="btn small primary" disabled={!dirty} onClick={() => { try { onApply(JSON.parse(text)); setDirty(false); } catch (e) { alert((e as Error).message); } }}>{t('common.apply')}</button>
        </div>
      }
    >
      <textarea className="json" value={text} onChange={(e) => { setText(e.target.value); setDirty(true); }} spellCheck={false} />
    </Card>
  );
}
