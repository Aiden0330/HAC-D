import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXAMPLES, parseScenario, PIPELINE_PRESETS, LADDER_PRESETS, SUPERPOD_PRESETS, ladderExpectation, mixtureLadder, type Scenario, type Component, type Superpod, type ComponentRow, unitRateFromCounts } from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { Card, Field, NumberInput, Select, Badge } from '../components/ui.js';
import { RbdDiagram } from '../diagrams/RbdDiagram.js';
import { download, scenarioFilename } from '../lib/export.js';
import { fmtHours } from '../lib/format.js';

const RATE_UNITS = ['per_h', 'per_1e6_h', 'FIT', 'per_year', 'per_day', 'per_1000_node_day', 'per_month', 'per_week', 'mtbf_h', 'gpu_h_per_event', 'gpu_day_per_event'] as const;
const DOMAINS = ['gpu', 'node', 'nvlink_domain', 'rack', 'tor', 'power_zone', 'cdu', 'plane', 'zone', 'cluster', 'supernode', 'ub_subplane', 'l2_switch', 'l1_switch', 'optical_link', 'comm_rack'] as const;
const SUPERPOD_FIELDS: (keyof Superpod)[] = ['npusPerNode', 'cpusPerNode', 'l1PerNode', 'nodesPerRack', 'computeRacks', 'commRacks', 'subPlanes', 'l2PerSubPlane', 'l2Ports', 'linksPerL1', 'transceiversPerLink'];
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
  const sp = s.topology.superpod;
  const supernodeSize = sp ? sp.npusPerNode * sp.nodesPerRack * sp.computeRacks : 0;

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
          <div className="select-fill"><Select value={exampleKey} onChange={setExampleKey} options={Object.keys(EXAMPLES).map((k) => ({ value: k, label: `${k} — ${EXAMPLES[k]().meta.name}` }))} /></div>
          <button type="button" className="btn" onClick={() => store.loadExample(exampleKey)} title={t('scenario.examplesHint')}>{t('scenario.examples')}</button>
          <button type="button" className="btn" onClick={() => store.restoreExample(exampleKey)} title={t('scenario.restoreHint')}>{t('scenario.restoreExample')}</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{t('scenario.importJson')}</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = ''; }} />
          <button type="button" className="btn" onClick={() => download(scenarioFilename(s, 'json'), JSON.stringify(s, null, 2))}>{t('scenario.exportJson')}</button>
          <button type="button" className="btn" onClick={() => store.duplicateActive()}>{t('scenario.duplicate')}</button>
          <button type="button" className="btn" onClick={() => { if (store.scenarios.length > 1) store.removeScenario(s.meta.id!); }} disabled={store.scenarios.length <= 1}>{t('scenario.deleteScenario')}</button>
          <button type="button" className="btn" onClick={() => store.resetToExamples()}>{t('common.reset')}</button>
        </div>
        {error && <div className="callout crit" style={{ marginTop: 8 }}>{error}</div>}
      </Card>
      <div className="callout" style={{ fontSize: 12 }}>{t('scenario.advancedNote')}</div>
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
          {s.topology.superpod && <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('scenario.fromSuperpod')}</div>}
          <div className="form-grid">
            {!s.topology.superpod && <Field label={t('scenario.gpusPerNode')}><NumberInput value={s.topology.gpusPerNode} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, gpusPerNode: Math.round(v) } }))} /></Field>}
            {!s.topology.superpod && <Field label={t('scenario.nodesPerRack')}><NumberInput value={s.topology.nodesPerRack} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, nodesPerRack: Math.round(v) } }))} /></Field>}
            <Field label={t('scenario.racksPerZone')}><NumberInput value={s.topology.racksPerZone} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, racksPerZone: Math.round(v) } }))} /></Field>
            {!s.topology.superpod && <Field label={t('scenario.nvlinkDomain')}><NumberInput value={s.topology.nvlinkDomainGpus} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, nvlinkDomainGpus: Math.round(v) } }))} /></Field>}
            {!s.topology.superpod && <Field label={t('scenario.planes')}><NumberInput value={s.topology.networkPlanes} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, topology: { ...x.topology, networkPlanes: Math.round(v) } }))} /></Field>}
          </div>
          <h3 style={{ margin: '12px 0 6px' }}>{t('scenario.superpod')}</h3>
          <div className="form-grid">
            <Field label={t('scenario.superpodPreset')}>
              <Select
                value={s.topology.superpod?.preset ?? 'generic'}
                onChange={(v) =>
                  upd((x) => ({
                    ...x,
                    topology: {
                      ...x.topology,
                      superpod: v === 'generic' ? undefined : v === 'custom' ? { ...(x.topology.superpod ?? SUPERPOD_PRESETS.cloudmatrix384.values), preset: 'custom' } : { ...SUPERPOD_PRESETS[v as 'cloudmatrix384' | 'atlas950'].values },
                      ...(v !== 'generic' ? (() => { const sp = v === 'custom' ? (x.topology.superpod ?? SUPERPOD_PRESETS.cloudmatrix384.values) : SUPERPOD_PRESETS[v as 'cloudmatrix384' | 'atlas950'].values; return { gpusPerNode: sp.npusPerNode, nodesPerRack: sp.nodesPerRack, networkPlanes: sp.subPlanes, nvlinkDomainGpus: sp.npusPerNode * sp.nodesPerRack * sp.computeRacks }; })() : {}),
                    },
                  }))
                }
                options={[{ value: 'generic', label: t('scenario.generic') }, { value: 'cloudmatrix384', label: 'CloudMatrix384 (Atlas 900 A3)' }, { value: 'atlas950', label: 'Atlas 950 SuperPoD' }, { value: 'custom', label: t('scenario.custom') }]}
              />
            </Field>
            {s.topology.superpod && SUPERPOD_FIELDS.map((f) => (
              <Field key={f} label={t(`scenario.${f}`)}>
                <NumberInput value={s.topology.superpod![f] as number} min={0} step={1} onChange={(v) => upd((x) => { const sp = { ...x.topology.superpod!, [f]: Math.round(v), preset: 'custom' as const }; return { ...x, topology: { ...x.topology, superpod: sp, gpusPerNode: sp.npusPerNode, nodesPerRack: sp.nodesPerRack, networkPlanes: sp.subPlanes, nvlinkDomainGpus: sp.npusPerNode * sp.nodesPerRack * sp.computeRacks } }; })} />
              </Field>
            ))}
          </div>
          {s.topology.superpod && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {s.topology.superpod.preset !== 'custom' && <span>{t('scenario.assumedFields')}: {SUPERPOD_PRESETS[s.topology.superpod.preset].assumed.join(', ')} · {SUPERPOD_PRESETS[s.topology.superpod.preset].source}. </span>}
              {!active.error && result && (() => { const sp = s.topology.superpod!; const perNode = `${sp.npusPerNode} NPU (${sp.npusPerNode * 2} dies, ${sp.npusPerNode * 8} HBM stacks) · ${sp.cpusPerNode} CPU · ${sp.l1PerNode} L1 UB chips · ${sp.l1PerNode * sp.linksPerL1} UB uplinks (= ${sp.npusPerNode} × ${sp.l1PerNode * sp.linksPerL1 / sp.npusPerNode} per NPU) · ${sp.rdmaPortsPerNpu * sp.npusPerNode} RDMA ports · ${sp.vpcNicsPerNode} Qingtian card`; return <span>{t('scenario.perNode')}: {perNode}. {t('scenario.derivedCounts')}: {result.counts.nodes} nodes · {result.counts.supernodes} supernode(s) · {result.counts.nodes * sp.cpusPerNode} CPU · {result.counts.l1Switches} L1 · {result.counts.l2Switches} L2 · {result.counts.opticalLinks} links · {result.counts.transceivers} transceivers · {result.counts.subPlanes} sub-planes</span>; })()}
            </div>
          )}
          <h3 style={{ margin: '12px 0 6px' }}>{t('scenario.measures')}</h3>
          <div className="form-grid">
            <Field label={t('scenario.subhealthThreshold')}><NumberInput value={s.measures.subhealthThreshold} min={0} max={1} step={0.05} onChange={(v) => upd((x) => ({ ...x, measures: { ...x.measures, subhealthThreshold: v } }))} /></Field>
            <Field label={t('scenario.commShare')}><NumberInput value={s.measures.commShare} min={0} max={1} step={0.05} onChange={(v) => upd((x) => ({ ...x, measures: { ...x.measures, commShare: v } }))} /></Field>
            <Field label={t('scenario.primaryMeasure')}><Select value={s.measures.primary} onChange={(v) => upd((x) => ({ ...x, measures: { ...x.measures, primary: v } }))} options={[{ value: 'compensated', label: t('measures.compensated') }, { value: 'original', label: t('measures.original') }]} /></Field>
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
                <Field label={t('scenario.nGpus')} hint={s.topology.superpod ? t('scenario.nGpusHint') : undefined}><NumberInput value={s.workload.nGpus} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), nGpus: Math.round(v) } }))} /></Field>
                {supernodeSize > 0 && (
                  <Field label={t('scenario.supernodesUsed')} hint={`${t('scenario.supernodeIs')} ${supernodeSize} NPU · ${t('scenario.supernodesUsedHint')}`}>
                    <NumberInput value={Math.ceil(s.workload.nGpus / supernodeSize)} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), nGpus: Math.max(1, Math.round(v)) * supernodeSize } }))} />
                  </Field>
                )}
                <Field label={t('scenario.durationDays')}><NumberInput value={s.workload.durationDays} min={0.1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), durationDays: v } }))} /></Field>
                <Field label={t('scenario.deltaS')}><NumberInput value={s.workload.deltaS} min={0} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), deltaS: v } }))} /></Field>
                <Field label={t('scenario.intervalModel')}><Select value={s.workload.intervalModel} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), intervalModel: v } }))} options={[{ value: 'young', label: 'Young √(2δM)' }, { value: 'daly3', label: 'Daly three-term' }, { value: 'dalyExact', label: 'Daly exact' }, { value: 'saxena', label: 'Saxena (availability)' }]} /></Field>
                <Field label={t('scenario.hotSpares')}><NumberInput value={s.workload.hotSpareNodes} min={0} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), hotSpareNodes: Math.round(v) }, structure: Math.round(v) > 0 && x.structure.mode === 'template' && x.structure.template === 'training-series' ? { mode: 'template', template: 'training-hot-spares' } : x.structure }))} /></Field>
                <Field label={t('scenario.replenish')}><NumberInput value={s.workload.spareReplenishHours} min={0.01} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), spareReplenishHours: v } }))} /></Field>
                <Field label={t('scenario.recoveryPath')}><Select value={s.workload.recovery} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), recovery: v } }))} options={[{ value: 'checkpoint', label: 'checkpoint (τ/2)' }, { value: 'replica', label: 'replica (one step)' }]} /></Field>
                {s.workload.recovery === 'replica' && <Field label={t('scenario.stepTime')}><NumberInput value={s.workload.stepTimeS ?? 10} min={0} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), stepTimeS: v } }))} /></Field>}
                <Field label={t('scenario.measuredRecompute')} hint={t('scenario.measuredRecomputeHint')}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <NumberInput value={s.workload.measuredRecomputeS ?? 0} min={0} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), measuredRecomputeS: v > 0 ? v : undefined } }))} />
                    {s.workload.measuredRecomputeS !== undefined && <button type="button" className="btn small" onClick={() => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), measuredRecomputeS: undefined } }))}>×</button>}
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field label={t('scenario.clusterSize')} hint={t('scenario.clusterSizeHint')}>
                  <NumberInput value={s.workload.replicasRequired * s.workload.gpusPerReplica} min={1} step={1} onChange={(v) => upd((x) => { const w = x.workload as typeof s.workload; return { ...x, workload: { ...w, replicasRequired: Math.max(1, Math.ceil(v / w.gpusPerReplica)) } }; })} />
                </Field>
                <Field label={supernodeSize > 0 && s.workload.gpusPerReplica === supernodeSize ? t('scenario.supernodesRequired') : t('scenario.replicasRequired')} hint={supernodeSize > 0 ? (s.workload.gpusPerReplica === supernodeSize ? `${t('scenario.supernodeIs')} ${supernodeSize} NPU` : t('scenario.pressSupernode')) : undefined}><NumberInput value={s.workload.replicasRequired} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), replicasRequired: Math.round(v) } }))} /></Field>
                <Field label={t('scenario.gpusPerReplica')}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <NumberInput value={s.workload.gpusPerReplica} min={1} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), gpusPerReplica: Math.round(v) } }))} />
                    {s.topology.superpod && <button type="button" className="btn small" title={t('scenario.useSupernode')} onClick={() => upd((x) => { const sp = x.topology.superpod!; const size = sp.npusPerNode * sp.nodesPerRack * sp.computeRacks; const w = x.workload as typeof s.workload; const cluster = w.replicasRequired * w.gpusPerReplica; return { ...x, workload: { ...w, gpusPerReplica: size, replicasRequired: Math.max(1, Math.ceil(cluster / size)) } }; })}>= {t('scenario.supernode')}</button>}
                  </div>
                </Field>
                <Field label={supernodeSize > 0 && s.workload.gpusPerReplica === supernodeSize ? t('scenario.spareSupernodes') : t('scenario.spareReplicas')}><NumberInput value={s.workload.spareReplicas} min={0} step={1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), spareReplicas: Math.round(v) } }))} /></Field>
                <Field label={t('scenario.capacityTarget')}><NumberInput value={s.workload.capacityTarget} min={0} max={1} step={0.0001} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), capacityTarget: v } }))} /></Field>
                <Field label={t('scenario.windowHours')}><NumberInput value={s.workload.windowHours} min={0.1} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), windowHours: v } }))} /></Field>
                <Field label={t('scenario.replicaRecovery')}><NumberInput value={s.workload.replicaRecoveryHours ?? 1} min={0.001} onChange={(v) => upd((x) => ({ ...x, workload: { ...(x.workload as typeof s.workload), replicaRecoveryHours: v } }))} /></Field>
              </>
            )}
          </div>
          {s.workload.type === 'training' && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('scenario.sdcMoved')}</div>}
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
      <ComponentsEditor s={s} upd={upd} rows={!active.error && result ? result.components : undefined} />
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
  const ladders = Object.keys(LADDER_PRESETS);
  const mode = s.recovery.mode;
  const selectValue = mode === 'preset' ? s.recovery.preset : mode === 'pipeline' ? 'custom' : mode === 'mixture' ? 'mixture' : s.recovery.rungs ? 'ladder-custom' : `ladder:${s.recovery.preset}`;
  const n = s.workload.type === 'training' ? s.workload.nGpus : s.workload.replicasRequired * s.workload.gpusPerReplica;
  const ladder = mode === 'ladder' ? (s.recovery.rungs ? { id: 'custom', rungs: s.recovery.rungs } : LADDER_PRESETS[s.recovery.preset ?? '']) : mode === 'mixture' ? mixtureLadder(s.recovery) : undefined;
  const ladderResult = ladder ? ladderExpectation(ladder as Parameters<typeof ladderExpectation>[0], n) : undefined;
  const onSelect = (v: string) => {
    if (v === 'custom') {
      const p = mode === 'preset' ? PIPELINE_PRESETS[s.recovery.preset] : null;
      upd((x) => ({ ...x, recovery: { mode: 'pipeline', stages: (p?.stages ?? [{ name: 'detect', value: 60 }, { name: 'localize', value: 60 }, { name: 'remediate', value: 60 }, { name: 'restart', value: 120 }, { name: 'load', value: 60 }]).map((st) => ({ ...st })) as never } }));
    } else if (v === 'ladder-custom') {
      const base = ladder ?? LADDER_PRESETS['mindcluster-a3'];
      upd((x) => ({ ...x, recovery: { mode: 'ladder', preset: base.id, rungs: base.rungs.map((r) => ({ ...r })) as never } }));
    } else if (v === 'mixture') upd((x) => ({ ...x, recovery: { mode: 'mixture', detection: { coverage: 0.95, autoSeconds: 10, timeoutSeconds: 60 }, automatic: { successProbability: 0.99, seconds: 180 }, manual: { seconds: 7200 } } }));
    else if (v.startsWith('ladder:')) upd((x) => ({ ...x, recovery: { mode: 'ladder', preset: v.slice(7) } }));
    else upd((x) => ({ ...x, recovery: { mode: 'preset', preset: v } }));
  };
  const setRung = (i: number, patch: Record<string, unknown>) =>
    upd((x) => (x.recovery.mode === 'ladder' && x.recovery.rungs ? { ...x, recovery: { ...x.recovery, rungs: x.recovery.rungs.map((r, j) => (j === i ? ({ ...r, ...patch } as typeof r) : r)) } } : x));
  return (
    <Card title={mode === 'ladder' ? t('scenario.ladder') : mode === 'mixture' ? t('scenario.mixtureMode') : t('scenario.recovery')} sub={mode === 'ladder' ? t('scenario.ladderNote') : mode === 'mixture' ? t('scenario.mixtureNote') : undefined}>
      <div className="form-grid">
        <Field label={t('scenario.preset')}>
          <Select
            value={selectValue}
            onChange={onSelect}
            options={[
              ...presets.map((p) => ({ value: p, label: `${t('scenario.pipelineMode')}: ${PIPELINE_PRESETS[p].name ?? p}` })),
              { value: 'custom', label: `${t('scenario.pipelineMode')}: ${t('scenario.custom')}` },
              ...ladders.map((l) => ({ value: `ladder:${l}`, label: `${t('scenario.ladderMode')}: ${LADDER_PRESETS[l].name?.en ?? l}` })),
              { value: 'ladder-custom', label: `${t('scenario.ladderMode')}: ${t('scenario.custom')}` },
              { value: 'mixture', label: t('scenario.mixtureMode') },
            ]}
          />
        </Field>
        {ladderResult && <Field label={`E[T] @ N = ${n}`}><div style={{ padding: '6px 0' }}>{ladderResult.meanS.toFixed(0)} s · {t('training.pManual')} {(ladderResult.pManual * 100).toFixed(2)} %</div></Field>}
      </div>
      {s.recovery.mode === 'mixture' && (() => {
        const r = s.recovery;
        const setMix = (patch: (q: typeof r) => typeof r) => upd((x) => (x.recovery.mode === 'mixture' ? { ...x, recovery: patch(x.recovery) } : x));
        return (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <Field label={t('scenario.detCoverage')}><NumberInput value={r.detection.coverage} min={0} max={1} step={0.01} onChange={(v) => setMix((q) => ({ ...q, detection: { ...q.detection, coverage: v } }))} /></Field>
            <Field label={t('scenario.detAutoS')}><NumberInput value={r.detection.autoSeconds} min={0} onChange={(v) => setMix((q) => ({ ...q, detection: { ...q.detection, autoSeconds: v } }))} /></Field>
            <Field label={t('scenario.detTimeoutS')}><NumberInput value={r.detection.timeoutSeconds} min={0} onChange={(v) => setMix((q) => ({ ...q, detection: { ...q.detection, timeoutSeconds: v } }))} /></Field>
            <Field label={t('scenario.autoSuccessP')}><NumberInput value={r.automatic.successProbability} min={0} max={1} step={0.01} onChange={(v) => setMix((q) => ({ ...q, automatic: { ...q.automatic, successProbability: v } }))} /></Field>
            <Field label={t('scenario.autoSeconds')}><NumberInput value={r.automatic.seconds} min={0} onChange={(v) => setMix((q) => ({ ...q, automatic: { ...q.automatic, seconds: v } }))} /></Field>
            <Field label={t('scenario.manualSeconds')}><NumberInput value={r.manual.seconds} min={0} onChange={(v) => setMix((q) => ({ ...q, manual: { seconds: v } }))} /></Field>
          </div>
        );
      })()}
      {mode !== 'ladder' && mode !== 'mixture' ? (
        <>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data">
              <thead>
                <tr><th>{t('scenario.stage')}</th><th className="num">{t('scenario.valueS')}</th><th>{t('scenario.scaleLaw')}</th><th className="num">{t('scenario.refN')}</th><th className="num">{t('scenario.exponent')} / {t('scenario.slope')}</th><th>{t('common.notes')}</th><th></th></tr>
              </thead>
              <tbody>
                {(s.recovery.mode === 'preset' ? PIPELINE_PRESETS[s.recovery.preset]?.stages ?? [] : s.recovery.mode === 'pipeline' ? s.recovery.stages : []).map((st, i) => {
                  const ro = mode === 'preset';
                  const setStage = (patch: Record<string, unknown>) =>
                    upd((x) => (x.recovery.mode === 'pipeline' ? { ...x, recovery: { ...x.recovery, stages: x.recovery.stages.map((q, j) => (j === i ? ({ ...q, ...patch } as typeof q) : q)) } } : x));
                  const law = st.scale ?? { type: 'constant' as const };
                  return (
                    <tr key={i}>
                      <td>{ro ? st.name : <Select value={st.name} onChange={(v) => setStage({ name: v })} options={STAGES.map((nm) => ({ value: nm, label: nm }))} />}</td>
                      <td className="num">{ro ? (typeof st.value === 'number' ? st.value.toFixed(0) : 'dist') : <NumberInput value={typeof st.value === 'number' ? st.value : 0} min={0} onChange={(v) => setStage({ value: v })} />}</td>
                      <td>{ro ? law.type : <Select value={law.type} onChange={(v) => setStage({ scale: v === 'constant' ? { type: 'constant' } : v === 'linear' ? { type: 'linear', refN: 8192 } : v === 'power' ? { type: 'power', refN: 8192, exponent: 0.5 } : v === 'log' ? { type: 'log', refN: 8192, slope: 0.3 } : { type: 'order-statistic', refN: 8192, cv: 0.2 } })} options={['constant', 'linear', 'power', 'log', 'order-statistic'].map((nm) => ({ value: nm, label: nm }))} />}</td>
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
        </>
      ) : (
        <>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data">
              <thead>
                <tr><th>{t('scenario.rung')}</th><th>{t('scenario.kind')}</th><th className="num">{t('scenario.success')}</th><th className="num">{t('scenario.timeS')}</th><th className="num">{t('scenario.reach')}</th><th className="num">E[T] share</th><th>{t('common.notes')}</th><th></th></tr>
              </thead>
              <tbody>
                {(ladder?.rungs ?? []).map((r, i) => {
                  const ro = !(s.recovery.mode === 'ladder' && s.recovery.rungs);
                  const res = ladderResult?.rungs[i];
                  const last = i === (ladder?.rungs.length ?? 0) - 1;
                  return (
                    <tr key={r.id}>
                      <td>{ro ? r.id : <input value={r.id} onChange={(e) => setRung(i, { id: e.target.value })} style={{ width: 140 }} />}</td>
                      <td>{ro ? r.kind : <Select value={r.kind} onChange={(v) => setRung(i, { kind: v })} options={[{ value: 'auto', label: 'auto' }, { value: 'manual', label: 'manual' }]} />}</td>
                      <td className="num">{ro || last ? (last ? 1 : r.successProbability).toFixed(2) : <NumberInput value={r.successProbability} min={0} max={1} step={0.05} onChange={(v) => setRung(i, { successProbability: v })} />}</td>
                      <td className="num">{ro ? (typeof r.timeS === 'number' ? r.timeS.toFixed(0) : 'dist') : <NumberInput value={typeof r.timeS === 'number' ? r.timeS : 0} min={0} onChange={(v) => setRung(i, { timeS: v })} />}</td>
                      <td className="num">{res ? `${(res.reachProbability * 100).toFixed(2)} %` : ''}</td>
                      <td className="num">{res ? `${(res.share * 100).toFixed(1)} %` : ''}</td>
                      <td className="muted" style={{ fontSize: 11, maxWidth: 260 }}>{r.note ?? ''}{r.confidence ? ` (${r.confidence})` : ''}</td>
                      <td>{!ro && !last && <button type="button" className="btn small" onClick={() => upd((x) => (x.recovery.mode === 'ladder' && x.recovery.rungs ? { ...x, recovery: { ...x.recovery, rungs: x.recovery.rungs.filter((_q, j) => j !== i) } } : x))}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            {(s.recovery.mode === 'ladder' || s.recovery.mode === 'mixture') && !(s.recovery.mode === 'ladder' && s.recovery.rungs) && <button type="button" className="btn small" onClick={() => onSelect('ladder-custom')}>{t('scenario.customise')}</button>}
            {s.recovery.mode === 'ladder' && s.recovery.rungs && (
              <button type="button" className="btn small" onClick={() => upd((x) => (x.recovery.mode === 'ladder' && x.recovery.rungs ? { ...x, recovery: { ...x.recovery, rungs: [...x.recovery.rungs.slice(0, -1), { id: `rung-${x.recovery.rungs.length}`, kind: 'auto', successProbability: 0.5, timeS: 300 }, x.recovery.rungs[x.recovery.rungs.length - 1]] } } : x))}>{t('common.add')}</button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function ComponentsEditor({ s, upd, rows }: { s: Scenario; upd: Upd; rows?: ComponentRow[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<Record<string, { n: number; h: number }>>({});
  const [incident, setIncident] = useState<Record<string, { events: number; units: number; hours: number; confidence: number }>>({});
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setComp = (id: string, fn: (c: Component) => Component) => upd((x) => ({ ...x, components: x.components.map((c) => (c.id === id ? fn(c) : c)) }));
  const add = () =>
    upd((x) => ({
      ...x,
      components: [
        ...x.components,
        { id: `component-${x.components.length + 1}`, name: { en: 'New component' }, subsystem: 'other', countRule: { per: 'fixed', count: 1 }, failure: { value: 10, unit: 'per_1e6_h', provenance: { source: 'assumed', confidence: 'assumed' } }, repair: { mttrHours: 8 }, enabled: true } as Component,
      ],
    }));
  const manualOf = (c: Component) => c.repair.manual?.mttrHours ?? c.repair.mttrHours ?? 0;
  const units = (c: Component) => (c.countRule.per === 'fixed' ? c.countRule.count : c.countRule.factor);
  return (
    <Card title={t('scenario.components')} actions={<button type="button" className="btn small" onClick={add}>{t('scenario.addComponent')}</button>}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('scenario.enabled')}</th><th>id · {t('common.name')}</th><th>subsystem</th><th>{t('common.count')}</th><th className="num">λ</th><th>{t('common.unit')}</th><th className="num">{t('scenario.manualMttr')}</th><th>{t('scenario.redundancy')}</th><th>{t('scenario.repairPaths')} · {t('scenario.subhealth')}</th><th>{t('common.confidence')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {s.components.map((c) => {
              const isOpen = open.has(c.id);
              const dual = !!c.repair.auto && c.repair.auto.coverage > 0;
              const row = rows?.find((x) => x.id === c.id);
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td><input type="checkbox" checked={c.enabled} onChange={(e) => setComp(c.id, (q) => ({ ...q, enabled: e.target.checked }))} /></td>
                    <td style={{ minWidth: 160 }}>
                      <div className="mono" style={{ fontSize: 11 }}>{c.id}</div>
                      <input value={c.name?.en ?? ''} placeholder="name" onChange={(e) => setComp(c.id, (q) => ({ ...q, name: { ...q.name, en: e.target.value } }))} />
                    </td>
                    <td><Select value={c.subsystem} onChange={(v) => setComp(c.id, (q) => ({ ...q, subsystem: v }))} options={SUBSYSTEMS.map((x) => ({ value: x, label: x }))} /></td>
                    <td style={{ minWidth: 150 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Select value={c.countRule.per} onChange={(v) => setComp(c.id, (q) => ({ ...q, countRule: v === 'fixed' ? { per: 'fixed', count: 1 } : { per: v as 'gpu', factor: 1 } }))} options={['gpu', 'node', 'rack', 'zone', 'fixed', 'supernode', 'comm_rack', 'l1_switch', 'l2_switch', 'subplane', 'optical_link', 'transceiver'].map((x) => ({ value: x, label: `per ${x}` }))} />
                        <NumberInput value={units(c)} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, countRule: q.countRule.per === 'fixed' ? { per: 'fixed', count: v } : { per: q.countRule.per, factor: v } }))} />
                      </div>
                    </td>
                    <td className="num" style={{ minWidth: 90 }}>
                      <NumberInput value={c.failure.value} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, failure: { ...q.failure, value: v } }))} />
                      {row && <div className="muted" style={{ fontSize: 11, maxWidth: 150 }}>{t('scenario.mtbfUnit')} {row.lambdaPerUnitPerHour > 0 ? fmtHours(1 / row.lambdaPerUnitPerHour, lang) : '∞'}<br />{t('scenario.lambdaAgg')} {row.lambdaAggregatePerHour.toExponential(2)}/h</div>}
                    </td>
                    <td><Select value={c.failure.unit} onChange={(v) => setComp(c.id, (q) => ({ ...q, failure: { ...q.failure, unit: v } }))} options={RATE_UNITS.map((u) => ({ value: u, label: u }))} /></td>
                    <td className="num" style={{ minWidth: 80 }}>
                      <NumberInput value={manualOf(c)} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, repair: { ...q.repair, mttrHours: v, manual: q.repair.manual ? { mttrHours: v } : undefined } }))} />
                      {row && <div className="muted" style={{ fontSize: 11 }}>{t('scenario.meanRepair_')} {fmtHours(row.mttrHours, lang)}</div>}
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Select value={c.redundancy?.scheme ?? 'series'} onChange={(v) => setComp(c.id, (q) => ({ ...q, redundancy: v === 'series' ? undefined : { ...q.redundancy, scheme: v as 'parallel', n: units(q), k: v === 'kofn' ? Math.max(1, units(q) - 1) : undefined } }))} options={['series', 'parallel', 'kofn', 'standby'].map((x) => ({ value: x, label: x }))} />
                        {c.redundancy?.scheme === 'kofn' && <NumberInput value={c.redundancy.k ?? 1} min={1} step={1} onChange={(v) => setComp(c.id, (q) => ({ ...q, redundancy: { ...q.redundancy!, k: Math.round(v) } }))} />}
                      </div>
                    </td>
                    <td style={{ minWidth: 150, fontSize: 12 }}>
                      <div>{dual ? `${t('scenario.autoCoverage')} ${c.repair.auto!.coverage} · ${c.repair.auto!.mttrHours} h` : t('scenario.manualMttr')}</div>
                      <div className="muted">{c.subhealth ? `${t('scenario.subhealth')}: φ ${c.subhealth.performance} · ${c.subhealth.policy}` : c.failslow ? t('scenario.legacyFailslow') : '—'}{c.redundancy?.switchover ? ` · ${t('scenario.switchover')} ${c.redundancy.switchover.successProbability}` : ''}</div>
                    </td>
                    <td>
                      <Badge status={c.failure.provenance?.confidence ?? 'assumed'}>{c.failure.provenance?.confidence ?? 'none'}</Badge>
                      {c.failure.provenance?.source && <div className="muted" style={{ fontSize: 10, maxWidth: 160 }}>{c.failure.provenance.source}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => toggle(c.id)}>{t('scenario.details')}</button>{' '}
                      <button type="button" className="btn small" onClick={() => upd((x) => ({ ...x, components: x.components.filter((q) => q.id !== c.id) }))} disabled={s.components.length <= 1}>×</button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="details">
                      <td colSpan={11} style={{ background: 'var(--surface-2)', padding: '10px 12px' }}>
                        <div className="grid cols-3" style={{ gap: 12 }}>
                          <div>
                            <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>{t('scenario.repairPaths')}</h4>
                            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                              <input type="checkbox" checked={dual} onChange={(e) => setComp(c.id, (q) => ({ ...q, repair: e.target.checked ? { ...q.repair, auto: { coverage: 0.8, successProbability: 0.9, mttrHours: 0.1 }, manual: { mttrHours: manualOf(q) } } : { ...q.repair, auto: undefined, manual: undefined, mttrHours: manualOf(q) } }))} />
                              {t('scenario.dualRepair')}
                            </label>
                            {dual && (
                              <div className="form-grid" style={{ marginTop: 6 }}>
                                <Field label={t('scenario.autoCoverage')}><NumberInput value={c.repair.auto!.coverage} min={0} max={1} step={0.05} onChange={(v) => setComp(c.id, (q) => ({ ...q, repair: { ...q.repair, auto: { ...q.repair.auto!, coverage: v } } }))} /></Field>
                                <Field label={t('scenario.autoSuccess')}><NumberInput value={c.repair.auto!.successProbability} min={0} max={1} step={0.05} onChange={(v) => setComp(c.id, (q) => ({ ...q, repair: { ...q.repair, auto: { ...q.repair.auto!, successProbability: v } } }))} /></Field>
                                <Field label={t('scenario.autoMttr')}><NumberInput value={c.repair.auto!.mttrHours} min={0} step={0.01} onChange={(v) => setComp(c.id, (q) => ({ ...q, repair: { ...q.repair, auto: { ...q.repair.auto!, mttrHours: v } } }))} /></Field>
                                <Field label={t('scenario.manualMttr')}><NumberInput value={manualOf(c)} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, repair: { ...q.repair, mttrHours: v, manual: { mttrHours: v } } }))} /></Field>
                              </div>
                            )}
                            <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>{t('scenario.ccf')}</h4>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <Select value={c.ccf?.domain ?? ''} onChange={(v) => setComp(c.id, (q) => ({ ...q, ccf: v ? { domain: v as 'rack', beta: q.ccf?.beta ?? 0.05 } : undefined }))} options={[{ value: '', label: '—' }, ...DOMAINS.map((d) => ({ value: d, label: d }))]} />
                              {c.ccf && <NumberInput value={c.ccf.beta} min={0} max={1} step={0.01} onChange={(v) => setComp(c.id, (q) => ({ ...q, ccf: { ...q.ccf!, beta: v } }))} />}
                            </div>
                          </div>
                          <div>
                            <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>{t('scenario.subhealth')}</h4>
                            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                              <input type="checkbox" checked={!!c.subhealth} onChange={(e) => setComp(c.id, (q) => ({ ...q, subhealth: e.target.checked ? { ratePerHour: q.failslow?.ratePerHour ?? 1e-5, durationHours: q.failslow?.durationHours ?? 1, performance: q.failslow?.capacity ?? 0.7, escalationMultiplier: 1, policy: 'tolerate' } : undefined, failslow: e.target.checked ? undefined : q.failslow }))} />
                              {t('scenario.subhealth')}{c.failslow && !c.subhealth ? ` (${t('scenario.legacyFailslow')})` : ''}
                            </label>
                            {c.subhealth && (
                              <div className="form-grid" style={{ marginTop: 6 }}>
                                <Field label={t('scenario.shRate')}><NumberInput value={c.subhealth.ratePerHour ?? 0} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, subhealth: { ...q.subhealth!, ratePerHour: v, steadyStateProbability: undefined } }))} /></Field>
                                <Field label={t('scenario.shDuration')}><NumberInput value={c.subhealth.durationHours} min={0.001} onChange={(v) => setComp(c.id, (q) => ({ ...q, subhealth: { ...q.subhealth!, durationHours: v } }))} /></Field>
                                <Field label={t('scenario.shPerformance')}><NumberInput value={c.subhealth.performance} min={0} max={1} step={0.05} onChange={(v) => setComp(c.id, (q) => ({ ...q, subhealth: { ...q.subhealth!, performance: v } }))} /></Field>
                                <Field label={t('scenario.shEscalation')}><NumberInput value={c.subhealth.escalationMultiplier} min={0} step={0.5} onChange={(v) => setComp(c.id, (q) => ({ ...q, subhealth: { ...q.subhealth!, escalationMultiplier: v } }))} /></Field>
                                <Field label={t('scenario.shPolicy')}><Select value={c.subhealth.policy} onChange={(v) => setComp(c.id, (q) => ({ ...q, subhealth: { ...q.subhealth!, policy: v, detection: v === 'isolate' ? q.subhealth!.detection ?? { probability: 0.9, delayHours: 0.025 } : q.subhealth!.detection } }))} options={[{ value: 'tolerate', label: t('scenario.tolerate') }, { value: 'isolate', label: t('scenario.isolate') }]} /></Field>
                                {c.subhealth.policy === 'isolate' && (
                                  <>
                                    <Field label={t('scenario.shDetectP')}><NumberInput value={c.subhealth.detection?.probability ?? 0.9} min={0} max={1} step={0.05} onChange={(v) => setComp(c.id, (q) => ({ ...q, subhealth: { ...q.subhealth!, detection: { probability: v, delayHours: q.subhealth!.detection?.delayHours ?? 0.025 } } }))} /></Field>
                                    <Field label={t('scenario.shDetectDelay')}><NumberInput value={c.subhealth.detection?.delayHours ?? 0.025} min={0} step={0.005} onChange={(v) => setComp(c.id, (q) => ({ ...q, subhealth: { ...q.subhealth!, detection: { probability: q.subhealth!.detection?.probability ?? 0.9, delayHours: v } } }))} /></Field>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <div>
                            <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>{t('scenario.switchover')}</h4>
                            {c.redundancy && c.redundancy.scheme !== 'series' ? (
                              <div className="form-grid">
                                <Field label={t('scenario.switchoverSuccess')}><NumberInput value={c.redundancy.switchover?.successProbability ?? c.redundancy.switchProbability ?? 1} min={0} max={1} step={0.01} onChange={(v) => setComp(c.id, (q) => ({ ...q, redundancy: { ...q.redundancy!, switchover: { ...q.redundancy!.switchover, successProbability: v } } }))} /></Field>
                                <Field label={t('scenario.switchoverOutage')}><NumberInput value={c.redundancy.switchover?.outageS ?? 0} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, redundancy: { ...q.redundancy!, switchover: { successProbability: q.redundancy!.switchover?.successProbability ?? 1, ...q.redundancy!.switchover, outageS: v } } }))} /></Field>
                                <Field label={t('scenario.switchoverRecovery')}><NumberInput value={c.redundancy.switchover?.failureRecoveryHours ?? manualOf(c)} min={0.001} onChange={(v) => setComp(c.id, (q) => ({ ...q, redundancy: { ...q.redundancy!, switchover: { successProbability: q.redundancy!.switchover?.successProbability ?? 1, ...q.redundancy!.switchover, failureRecoveryHours: v } } }))} /></Field>
                              </div>
                            ) : <div className="muted" style={{ fontSize: 12 }}>{t('scenario.redundancy')}: series</div>}
                            <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>{t('scenario.mtbfAnchor')}</h4>
                            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{t('scenario.mtbfAnchorHint')}</div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <NumberInput value={anchor[c.id]?.n ?? 10000} min={1} step={1} onChange={(v) => setAnchor((a) => ({ ...a, [c.id]: { n: Math.round(v), h: a[c.id]?.h ?? 30 } }))} />
                              <span className="muted" style={{ fontSize: 11 }}>×</span>
                              <NumberInput value={anchor[c.id]?.h ?? 30} min={0.001} onChange={(v) => setAnchor((a) => ({ ...a, [c.id]: { n: a[c.id]?.n ?? 10000, h: v } }))} />
                              <button type="button" className="btn small" onClick={() => { const a = anchor[c.id] ?? { n: 10000, h: 30 }; setComp(c.id, (q) => ({ ...q, failure: { ...q.failure, value: a.n * a.h, unit: 'mtbf_h', provenance: { source: 'fleet MTBF anchor', confidence: 'assumed', ...q.failure.provenance, derivation: `${a.n} units × ${a.h} h fleet MTBF → per-unit MTBF ${(a.n * a.h).toLocaleString('en-US')} h` } } }))}}>{t('common.apply')}</button>
                            </div>
                            <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>{t('scenario.rateFromCounts')}</h4>
                            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{t('scenario.rateFromCountsHint')}</div>
                            {(() => {
                              const inc = incident[c.id] ?? { events: 0, units: Math.max(1, Math.round(row?.count ?? 1000)), hours: 720, confidence: 0.95 };
                              const setInc = (patch: Partial<typeof inc>) => setIncident((a) => ({ ...a, [c.id]: { ...inc, ...patch } }));
                              let est: ReturnType<typeof unitRateFromCounts> | undefined;
                              try {
                                est = unitRateFromCounts(Math.max(0, Math.round(inc.events)), inc.units, inc.hours, inc.confidence);
                              } catch {
                                est = undefined;
                              }
                              return (
                                <>
                                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <NumberInput value={inc.events} min={0} step={1} onChange={(v) => setInc({ events: v })} />
                                    <span className="muted" style={{ fontSize: 11 }}>{t('scenario.rateEvents')} /</span>
                                    <NumberInput value={inc.units} min={1} step={1} onChange={(v) => setInc({ units: v })} />
                                    <span className="muted" style={{ fontSize: 11 }}>{t('scenario.rateUnits')} ×</span>
                                    <NumberInput value={inc.hours} min={0.001} onChange={(v) => setInc({ hours: v })} />
                                    <span className="muted" style={{ fontSize: 11 }}>{t('scenario.rateHours')} ·</span>
                                    <NumberInput value={inc.confidence} min={0.5} max={0.9999} step={0.01} onChange={(v) => setInc({ confidence: v })} />
                                    <span className="muted" style={{ fontSize: 11 }}>{t('scenario.rateConfidence')}</span>
                                    {est && (
                                      <button type="button" className="btn small" onClick={() => { const e = est!; const value = e.method === 'zero-event-upper-bound' ? e.upper.fit : e.fit; setComp(c.id, (q) => ({ ...q, failure: { ...q.failure, value, unit: 'FIT', provenance: { ...(q.failure.provenance ?? {}), source: 'incident counts', confidence: 'measured', derivation: `${e.events} events over ${e.units} units × ${e.hours} h = ${e.exposureHours.toExponential(3)} unit-hours: ${e.fit.toFixed(2)} FIT, ${(e.confidence * 100).toFixed(0)} % ${e.method === 'zero-event-upper-bound' ? 'one-sided upper bound' : 'Garwood interval'} [${e.lower.fit.toFixed(2)}, ${e.upper.fit.toFixed(2)}] FIT${e.method === 'zero-event-upper-bound' ? ' (upper bound used as the rate)' : ''}` } } })); }}>{t('scenario.rateApply')}</button>
                                    )}
                                  </div>
                                  {est && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>λ {est.ratePerHour.toExponential(3)} /h · {est.fit.toFixed(1)} FIT · MTBF {Number.isFinite(est.mtbfHours) ? est.mtbfHours.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' h' : '∞'} · {est.method === 'zero-event-upper-bound' ? t('scenario.rateUpper') : t('scenario.rateInterval')} [{est.lower.fit.toFixed(1)}, {est.upper.fit.toFixed(1)}] FIT ({est.method})</div>}
                                </>
                              );
                            })()}
                            <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>{t('scenario.sdcComponent')}</h4>
                            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                              <input type="checkbox" checked={!!c.sdc} onChange={(e) => setComp(c.id, (q) => ({ ...q, sdc: e.target.checked ? { ratePerHour: Math.max(1e-12, (row?.lambdaPerUnitPerHour ?? 1e-6) * 0.014 / 0.966) } : undefined }))} />
                              {t('scenario.sdcRatePerUnit')}
                            </label>
                            {c.sdc && <NumberInput value={c.sdc.ratePerHour} min={0} onChange={(v) => setComp(c.id, (q) => ({ ...q, sdc: { ...q.sdc!, ratePerHour: v } }))} />}
                            <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>{t('scenario.applicability')}</h4>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {(['replay', 'process', 'elastic', 'predict', 'netfail', 'hotswap'] as const).map((k) => (
                                <Field key={k} label={t(`scenario.appl${k[0].toUpperCase()}${k.slice(1)}`)}>
                                  <NumberInput value={c.mechanisms?.[k] ?? (k === 'predict' ? 1 : 0)} min={0} max={1} step={0.05} onChange={(v) => setComp(c.id, (q) => ({ ...q, mechanisms: { ...(q.mechanisms ?? {}), [k]: v } }))} />
                                </Field>
                              ))}
                            </div>
                            <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>{t('scenario.provenance')}</h4>
                            <input value={c.failure.provenance?.source ?? ''} placeholder="source" onChange={(e) => setComp(c.id, (q) => ({ ...q, failure: { ...q.failure, provenance: { ...(q.failure.provenance ?? { confidence: 'assumed' }), source: e.target.value } } }))} style={{ width: '100%' }} />
                            {c.failure.koujing && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t('common.koujing')}: {c.failure.koujing.event} / {c.failure.koujing.denominator} / {c.failure.koujing.level}</div>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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
