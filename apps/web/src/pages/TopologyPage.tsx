import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TOPOLOGY_TEMPLATES, TOPOLOGY_TEMPLATE_IDS, TOPOLOGY_SCALES, TOPOLOGY_EXAMPLES, scaleLabel, resizeTopology, FAULT_UNIT_NAMES, DOMAIN_NAMES, unitFaultLibrary, topologyBom, bomAtSizes, bomRowsAcross, fitOverrides,
  switchTopologyTemplate, editBase, mechanismOwner, mechanismById, parseScenario, STRATEGY_IDS, LEVER_SHORT,
  type Scenario, type TopologyTemplate, type FaultUnit, type BomRow, type StrategyResult, type StrategyId,
} from '@hac-d/core';
import { useStore } from '../state/store.js';
import { useActive, useLang } from '../hooks.js';
import { Kpi, Card, NumberInput, Select, Badge } from '../components/ui.js';
import { TopologyPicture } from '../components/TopologyPicture.js';
import { ReliabilityPanel } from '../panels/ReliabilityPanel.js';
import { compute, cancelCompute, progressCallback, ComputeCancelled } from '../worker/client.js';
import { download } from '../lib/export.js';
import { fmtPct, fmtDuration, fmtNum, fmtInt, type Lang } from '../lib/format.js';

type Tab = 'picture' | 'hardware' | 'reliability' | 'allocation';
const LIB = unitFaultLibrary();
const L = (x: { zh: string; en: string }, lang: Lang) => (lang === 'zh' ? x.zh : x.en);
const fmtCount = (n: number) => (n >= 1 ? fmtInt(n) : '—');

/** thumbnails of the three templates for the selector cards */
function Thumb({ t }: { t: TopologyTemplate }) {
  if (t === 'a2-roce') {
    return (
      <svg viewBox="0 0 80 36" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <rect key={`l${i}`} x={8 + i * 18} y={3} width={12} height={6} rx={1} className="tp-roce" />)}
        {[0, 1, 2, 3].map((i) => <line key={`w${i}`} x1={14 + i * 18} y1={9} x2={14 + i * 18} y2={16} className="tp-wire-roce" />)}
        {[0, 1, 2, 3].map((i) => <rect key={`c${i}`} x={6 + i * 18} y={16} width={16} height={18} rx={1} className="tp-cab" />)}
      </svg>
    );
  }
  const big = t === 'a950-ub2';
  return (
    <svg viewBox="0 0 80 36" aria-hidden="true">
      <rect x={3} y={3} width={74} height={30} rx={3} className="tp-pod" />
      {Array.from({ length: big ? 16 : 6 }, (_, i) => <rect key={i} x={7 + (i % (big ? 8 : 6)) * (big ? 8.5 : 11)} y={big ? 7 + Math.floor(i / 8) * 8 : 8} width={big ? 6.5 : 8} height={big ? 6 : 12} rx={1} className="tp-cab" />)}
      {Array.from({ length: big ? 6 : 2 }, (_, i) => <rect key={`m${i}`} x={7 + i * (big ? 11 : 22)} y={24} width={big ? 9 : 18} height={6} rx={1} className="tp-comm" />)}
    </svg>
  );
}

function Group({ title, note, open, children }: { title: string; note?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="group" open={open}>
      <summary><span>{title}</span>{note && <span className="muted">{note}</span>}</summary>
      <div className="body">{children}</div>
    </details>
  );
}

function Row({ label, children, assumed, hint }: { label: string; children: ReactNode; assumed?: boolean; hint?: string }) {
  return (
    <div className="kv-row" title={hint}>
      <span>{label}{assumed && <span className="tag-assumed"> · assumed</span>}</span>
      <span>{children}</span>
    </div>
  );
}

export function TopologyPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const scenarios = useStore((s) => s.scenarios);
  const updateActive = useStore((s) => s.updateActive);
  const replaceScenario = useStore((s) => s.replaceScenario);
  const addScenario = useStore((s) => s.addScenario);
  const setActive = useStore((s) => s.setActive);
  const setPage = useStore((s) => s.setPage);
  const [tab, setTab] = useState<Tab>('hardware');
  const [carry, setCarry] = useState(true);
  const [nText, setNText] = useState('');
  if (!active) return <div className="callout crit">No scenario</div>;
  const s = active.scenario;
  const tpl = s.topology.template;
  const N = s.workload.type === 'training' ? s.workload.nGpus : s.workload.replicasRequired * s.workload.gpusPerReplica;
  // the generated name "… — N NPUs" follows the size (resizeTopology); a renamed design keeps its name
  const setN = (n: number) => updateActive((x) => (x.workload.type === 'training' ? resizeTopology(x, n) : x));
  const pickTemplate = (to: TopologyTemplate) => {
    const id = `topology-${to}`;
    const exists = scenarios.some((x) => x.meta.id === id);
    if (tpl === to && s.meta.id === id) return;
    let next: Scenario;
    if (carry && tpl) next = switchTopologyTemplate(s, to, { id });
    else {
      const base = scenarios.find((x) => x.meta.id === id) ?? TOPOLOGY_EXAMPLES[id]();
      next = base.workload.type === 'training' ? parseScenario({ ...base, workload: { ...base.workload, nGpus: N } }) : base;
    }
    if (exists) { replaceScenario(id, next); setActive(id); } else addScenario(next, true);
  };
  const resetTemplate = () => { if (tpl) replaceScenario(s.meta.id!, { ...TOPOLOGY_EXAMPLES[`topology-${tpl}`](), meta: { ...TOPOLOGY_EXAMPLES[`topology-${tpl}`]().meta, id: s.meta.id } }); };
  /** change the design under the applied mechanisms (they are re-applied with their parameters) */
  const upBase = (fn: (b: Scenario) => Scenario) => updateActive((x) => editBase(x, fn));

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="page-title">
        <h1>{t('topology.title')}</h1>
        <span className="sub">{t('topology.sub')}</span>
      </div>
      <div className="workbench">
        <aside className="pane-in">
          <Card>
            <div className="tpl-cards" role="group" aria-label={t('topology.template')}>
              {TOPOLOGY_TEMPLATE_IDS.map((id) => (
                <button key={id} type="button" className="tpl-card" aria-pressed={tpl === id} onClick={() => pickTemplate(id)} title={L(TOPOLOGY_TEMPLATES[id].summary, lang)}>
                  <Thumb t={id} />
                  <span>{L(TOPOLOGY_TEMPLATES[id].name, lang)}</span>
                </button>
              ))}
            </div>
            <label className="check" title={t('topology.carryHint')}><input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />{t('topology.carry')}</label>
            {!tpl && <div className="callout warn" style={{ marginTop: 8 }}>{t('topology.notTemplate')}</div>}
            {tpl && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{L(TOPOLOGY_TEMPLATES[tpl].summary, lang)}</div>}
            <h3 style={{ margin: '12px 0 6px' }}>{t('topology.scale')}</h3>
            <div className="btn-row">
              {TOPOLOGY_SCALES.map((n) => <button key={n} type="button" className="btn small" aria-pressed={N === n} onClick={() => setN(n)}>{scaleLabel(n)}</button>)}
              <input className="n-input" type="number" min={1} step={1} value={nText !== '' ? nText : N} aria-label={t('topology.npus')} onChange={(e) => setNText(e.target.value)} onBlur={() => { const v = Number(nText); if (nText !== '' && Number.isFinite(v) && v > 0) setN(v); setNText(''); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('topology.npusNote')}</div>
          </Card>
          {tpl && <HardwareParams s={s} upd={updateActive} lang={lang} />}
          <FaultLibraryGroup s={s} onReset={() => upBase((b) => resetFits(b))} onOpenLibrary={() => setPage('library')} onEdit={() => setTab('hardware')} />
          <MechanismGroup s={s} lang={lang} onEdit={() => setPage('mechanisms')} />
          <WorkloadGroup s={s} upBase={upBase} />
          <RecoveryGroup s={s} upBase={upBase} />
          <Group title={t('topology.file')}>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={() => download(`${s.meta.id ?? 'scenario'}.json`, JSON.stringify(s, null, 2))}>{t('topology.exportJson')}</button>
              {tpl && <button type="button" className="btn small" onClick={resetTemplate}>{t('topology.resetTemplate')}</button>}
              <button type="button" className="btn small" onClick={() => setPage('scenario')}>{t('topology.advancedEditor')} ›</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('topology.fileNote')}</div>
          </Group>
        </aside>
        <section className="pane-out">
          {active.error ? <div className="callout crit">{active.error}</div> : <Outputs s={s} tab={tab} setTab={setTab} lang={lang} upBase={upBase} onAllocation={() => setPage('allocation')} />}
        </section>
      </div>
    </div>
  );
}

function resetFits(b: Scenario): Scenario {
  const lib = new Map(LIB.map((f) => [f.id, f]));
  return { ...b, components: b.components.map((c) => { const f = lib.get(c.id); return f ? setFit(c, f.type, f.fitPerUnit) : c; }) };
}
function setFit(c: Scenario['components'][number], type: 'hard' | 'slow' | 'sdc', fit: number): Scenario['components'][number] {
  if (type === 'hard') return { ...c, failure: { ...c.failure, value: fit, unit: 'FIT' } };
  if (type === 'slow' && c.subhealth) return { ...c, subhealth: { ...c.subhealth, ratePerHour: fit / 1e9 } };
  if (type === 'sdc' && c.sdc) return { ...c, sdc: { ...c.sdc, ratePerHour: fit / 1e9 } };
  return c;
}

/* ---------------------------- left pane groups ---------------------------- */

function HardwareParams({ s, upd, lang }: { s: Scenario; upd: (fn: (s: Scenario) => Scenario) => void; lang: Lang }) {
  const { t } = useTranslation();
  const tp = s.topology;
  const info = TOPOLOGY_TEMPLATES[tp.template!];
  const assumed = (k: string) => info.assumed.includes(k);
  const sp = tp.superpod;
  const so = tp.scaleOut;
  const setTop = (patch: Partial<Scenario['topology']>) => upd((x) => ({ ...x, topology: { ...x.topology, ...patch } }));
  const setSp = (patch: Partial<NonNullable<Scenario['topology']['superpod']>>) => upd((x) => (x.topology.superpod ? { ...x, topology: { ...x.topology, superpod: { ...x.topology.superpod, ...patch }, ...(patch.nodesPerRack ? { nodesPerRack: patch.nodesPerRack } : {}), ...(patch.npusPerNode ? { gpusPerNode: patch.npusPerNode } : {}) } } : x));
  const setSo = (patch: Partial<NonNullable<Scenario['topology']['scaleOut']>>) => upd((x) => (x.topology.scaleOut ? { ...x, topology: { ...x.topology, scaleOut: { ...x.topology.scaleOut, ...patch } } } : x));
  const toggleScaleOut = (on: boolean) => upd((x) => {
    const lib = LIB.filter((f) => f.unit === 'roce-switch' || f.unit === 'roce-link');
    if (!on) return { ...x, topology: { ...x.topology, scaleOut: undefined }, components: x.components.filter((c) => !c.id.includes('@roce')) };
    const fresh = TOPOLOGY_EXAMPLES[`topology-${x.topology.template}`]();
    const add = fresh.components.filter((c) => lib.some((f) => f.id === c.id) && !x.components.some((q) => q.id === c.id));
    return { ...x, topology: { ...x.topology, scaleOut: TOPOLOGY_TEMPLATES[x.topology.template!].topology.scaleOut as Scenario['topology']['scaleOut'] }, components: [...x.components, ...add] };
  });
  return (
    <Group title={t('topology.hardware')} note={sp ? `${sp.npusPerNode * sp.nodesPerRack * sp.computeRacks} NPU / pod` : `${tp.gpusPerNode * tp.nodesPerRack} NPU / ${lang === 'zh' ? '柜' : 'cabinet'}`}>
      {!sp && (
        <>
          <Row label={t('topology.npusPerServer')}><NumberInput value={tp.gpusPerNode} min={1} step={1} onChange={(v) => setTop({ gpusPerNode: Math.max(1, Math.round(v)) })} /></Row>
          <Row label={t('topology.cpusPerServer')}><NumberInput value={tp.cpusPerNode ?? 0} min={0} step={1} onChange={(v) => setTop({ cpusPerNode: Math.max(0, Math.round(v)) })} /></Row>
          <Row label={t('topology.serversPerCabinet')}><NumberInput value={tp.nodesPerRack} min={1} step={1} onChange={(v) => setTop({ nodesPerRack: Math.max(1, Math.round(v)) })} /></Row>
        </>
      )}
      {sp && (
        <>
          <Row label={t('topology.nodesPerCabinet')} assumed={assumed('superpod.nodesPerRack')}><NumberInput value={sp.nodesPerRack} min={1} step={1} onChange={(v) => setSp({ nodesPerRack: Math.max(1, Math.round(v)) })} /></Row>
          <Row label={t('topology.computeCabinets')}><NumberInput value={sp.computeRacks} min={1} step={1} onChange={(v) => setSp({ computeRacks: Math.max(1, Math.round(v)) })} /></Row>
          <Row label={t('topology.commCabinets')}><NumberInput value={sp.commRacks} min={0} step={1} onChange={(v) => setSp({ commRacks: Math.max(0, Math.round(v)) })} /></Row>
          <Row label={t('topology.cpusPerNode')} assumed={assumed('superpod.cpusPerNode')}><NumberInput value={sp.cpusPerNode} min={0} step={1} onChange={(v) => setSp({ cpusPerNode: Math.max(0, Math.round(v)) })} /></Row>
          <Row label={t('topology.l1PerNode')} assumed={assumed('superpod.l1PerNode')}><NumberInput value={sp.l1PerNode} min={0} step={1} onChange={(v) => setSp({ l1PerNode: Math.max(0, Math.round(v)) })} /></Row>
          <Row label={t('topology.subPlanes')} assumed={assumed('superpod.subPlanes')}><NumberInput value={sp.subPlanes} min={1} step={1} onChange={(v) => setSp({ subPlanes: Math.max(1, Math.round(v)) })} /></Row>
          <Row label={t('topology.l2PerSubPlane')} assumed={assumed('superpod.l2PerSubPlane')}><NumberInput value={sp.l2PerSubPlane} min={0} step={1} onChange={(v) => setSp({ l2PerSubPlane: Math.max(0, Math.round(v)) })} /></Row>
          <Row label={t('topology.l2Ports')} assumed={assumed('superpod.l2Ports')}><NumberInput value={sp.l2Ports} min={1} step={1} onChange={(v) => setSp({ l2Ports: Math.max(1, Math.round(v)) })} /></Row>
          <Row label={t('topology.linksPerL1')} assumed={assumed('superpod.linksPerL1')}><NumberInput value={sp.linksPerL1} min={0} step={1} onChange={(v) => setSp({ linksPerL1: Math.max(0, Math.round(v)) })} /></Row>
          <Row label={t('topology.transceiversPerLink')} assumed={assumed('superpod.transceiversPerLink')}><NumberInput value={sp.transceiversPerLink} min={0} step={1} onChange={(v) => setSp({ transceiversPerLink: Math.max(0, Math.round(v)) })} /></Row>
          <Row label={t('topology.fabricFill')} hint={t('topology.fabricFillHint')}>
            <Select value={tp.fabricFill} onChange={(v) => setTop({ fabricFill: v })} options={[{ value: 'proportional', label: t('topology.fillProportional') }, { value: 'full-pod', label: t('topology.fillFull') }]} />
          </Row>
        </>
      )}
      <div className="kv-sep" />
      <label className="check"><input type="checkbox" checked={!!so} onChange={(e) => toggleScaleOut(e.target.checked)} />{sp ? t('topology.scaleOutUb') : t('topology.scaleOutA2')}</label>
      {so && (
        <>
          <Row label={t('topology.portsPerNpu')}><NumberInput value={so.portsPerNpu} min={1} step={1} onChange={(v) => setSo({ portsPerNpu: Math.max(1, Math.round(v)) })} /></Row>
          <Row label={t('topology.radix')} assumed><NumberInput value={so.radix} min={4} step={8} onChange={(v) => setSo({ radix: Math.max(4, Math.round(v)) })} /></Row>
          <Row label={t('topology.oversub')} assumed hint={t('topology.oversubHint')}><NumberInput value={so.oversubscription} min={1} step={0.5} onChange={(v) => setSo({ oversubscription: Math.max(1, v) })} /></Row>
          <Row label={t('topology.transceiversPerLink')} assumed><NumberInput value={so.transceiversPerLink} min={0} step={1} onChange={(v) => setSo({ transceiversPerLink: Math.max(0, Math.round(v)) })} /></Row>
        </>
      )}
    </Group>
  );
}

function FaultLibraryGroup({ s, onReset, onOpenLibrary, onEdit }: { s: Scenario; onReset: () => void; onOpenLibrary: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  const over = useMemo(() => (s.topology.template ? fitOverrides(s) : {}), [s]);
  const n = Object.keys(over).length;
  return (
    <Group title={t('topology.faultLib')} note={s.topology.template ? (n ? t('topology.overrides', { n }) : t('topology.libDefaults')) : undefined}>
      <p className="muted" style={{ fontSize: 12 }}>{t('topology.faultLibNote')}</p>
      <div className="btn-row">
        {s.topology.template && <button type="button" className="btn small" onClick={onEdit}>{t('topology.editFits')}</button>}
        {n > 0 && <button type="button" className="btn small" onClick={onReset}>{t('topology.resetFits')}</button>}
        <button type="button" className="btn small" onClick={onOpenLibrary}>{t('topology.openLibrary')} ›</button>
      </div>
      {n > 0 && <ul className="plain muted" style={{ fontSize: 12 }}>{Object.entries(over).map(([id, v]) => <li key={id}>{id}: {fmtNum(v, 2)} FIT</li>)}</ul>}
    </Group>
  );
}

function MechanismGroup({ s, lang, onEdit }: { s: Scenario; lang: Lang; onEdit: () => void }) {
  const { t } = useTranslation();
  const ids = Object.entries(s.mechanisms.applied ?? {}).sort((a, b) => a[1].order - b[1].order);
  return (
    <Group title={t('topology.mechanisms')} note={`${ids.length}`} open>
      <div className="chips">
        {ids.map(([id, rec]) => {
          const m = mechanismById(id);
          const p = Object.entries(rec.parameters).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' · ');
          return <span key={id} className="chip" title={`${L(m.name, lang)} · ${p}`}><b>{id}</b> <span className="muted">{L(m.name, lang)}</span></span>;
        })}
        {!ids.length && <span className="muted" style={{ fontSize: 12 }}>{t('topology.noMechanisms')}</span>}
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn small" onClick={onEdit}>{t('topology.editMechanisms')} ›</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('topology.mechanismsNote')}</div>
    </Group>
  );
}

function WorkloadGroup({ s, upBase }: { s: Scenario; upBase: (fn: (b: Scenario) => Scenario) => void }) {
  const { t } = useTranslation();
  if (s.workload.type !== 'training') return null;
  const w = s.workload;
  const ckOwner = mechanismOwner(s, 'workload.deltaS') ?? mechanismOwner(s, 'workload.intervalS');
  const setW = (patch: Partial<typeof w>) => upBase((b) => (b.workload.type === 'training' ? { ...b, workload: { ...b.workload, ...patch } } : b));
  return (
    <Group title={t('topology.workload')} note={`${w.durationDays} d · τ ${w.intervalS ?? '—'} s · δ ${w.deltaS} s`}>
      <Row label={t('scenario.durationDays')}><NumberInput value={w.durationDays} min={1} step={1} onChange={(v) => setW({ durationDays: Math.max(0.1, v) })} /></Row>
      {ckOwner ? (
        <div className="callout" style={{ fontSize: 12, margin: '6px 0' }}>{t('topology.ownedBy', { id: ckOwner })}: τ {w.intervalS ?? '—'} s · δ {w.deltaS} s</div>
      ) : (
        <>
          <Row label={t('topology.intervalS')}><NumberInput value={w.intervalS ?? 0} min={0} step={10} onChange={(v) => setW({ intervalS: v > 0 ? v : undefined })} /></Row>
          <Row label={t('scenario.deltaS')}><NumberInput value={w.deltaS} min={0} step={0.5} onChange={(v) => setW({ deltaS: Math.max(0, v) })} /></Row>
        </>
      )}
      <Row label={t('topology.targetAop')}><NumberInput value={s.targets.operational ?? 0.985} min={0.5} max={0.99999} step={0.001} onChange={(v) => upBase((b) => ({ ...b, targets: { ...b.targets, operational: v } }))} /></Row>
      <Row label={t('topology.targetDelivered')}><NumberInput value={s.targets.goodput ?? 0.9} min={0.5} max={0.9999} step={0.005} onChange={(v) => upBase((b) => ({ ...b, targets: { ...b.targets, goodput: v } }))} /></Row>
    </Group>
  );
}

function RecoveryGroup({ s, upBase }: { s: Scenario; upBase: (fn: (b: Scenario) => Scenario) => void }) {
  const { t } = useTranslation();
  const r = s.recovery;
  if (r.mode !== 'mixture') return <Group title={t('topology.recovery')} note={r.mode}><div className="muted" style={{ fontSize: 12 }}>{t('topology.recoveryAdvanced')}</div></Group>;
  const detOwner = mechanismOwner(s, 'recovery.detection');
  const setR = (fn: (m: Extract<Scenario['recovery'], { mode: 'mixture' }>) => Scenario['recovery']) => upBase((b) => (b.recovery.mode === 'mixture' ? { ...b, recovery: fn(b.recovery) } : b));
  const R = r.detection.coverage * r.detection.autoSeconds + (1 - r.detection.coverage) * r.detection.timeoutSeconds + r.automatic.seconds + (1 - r.automatic.successProbability) * r.manual.seconds;
  return (
    <Group title={t('topology.recovery')} note={`R̄ ${fmtNum(R, 1)} s`}>
      {detOwner ? (
        <div className="callout" style={{ fontSize: 12, margin: '6px 0' }}>{t('topology.ownedBy', { id: detOwner })}: {fmtPct(r.detection.coverage, 1)} · {r.detection.autoSeconds} s</div>
      ) : (
        <>
          <Row label={t('topology.detCoverage')}><NumberInput value={r.detection.coverage} min={0} max={1} step={0.01} onChange={(v) => setR((m) => ({ ...m, detection: { ...m.detection, coverage: Math.min(1, Math.max(0, v)) } }))} /></Row>
          <Row label={t('topology.detSeconds')}><NumberInput value={r.detection.autoSeconds} min={0} step={1} onChange={(v) => setR((m) => ({ ...m, detection: { ...m.detection, autoSeconds: Math.max(0, v) } }))} /></Row>
          <Row label={t('topology.timeoutSeconds')}><NumberInput value={r.detection.timeoutSeconds} min={0} step={5} onChange={(v) => setR((m) => ({ ...m, detection: { ...m.detection, timeoutSeconds: Math.max(0, v) } }))} /></Row>
        </>
      )}
      <Row label={t('topology.autoSeconds')}><NumberInput value={r.automatic.seconds} min={0} step={10} onChange={(v) => setR((m) => ({ ...m, automatic: { ...m.automatic, seconds: Math.max(0, v) } }))} /></Row>
      <Row label={t('topology.autoSuccess')}><NumberInput value={r.automatic.successProbability} min={0} max={1} step={0.001} onChange={(v) => setR((m) => ({ ...m, automatic: { ...m.automatic, successProbability: Math.min(1, Math.max(0, v)) } }))} /></Row>
      <Row label={t('topology.manualSeconds')}><NumberInput value={r.manual.seconds} min={0} step={600} onChange={(v) => setR((m) => ({ ...m, manual: { seconds: Math.max(0, v) } }))} /></Row>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>R̄ = T_det + T_auto + (1 − p_s)·T_manual = {fmtNum(R, 1)} s</div>
    </Group>
  );
}

/* ---------------------------- right pane ---------------------------- */

function Outputs({ s, tab, setTab, lang, upBase, onAllocation }: { s: Scenario; tab: Tab; setTab: (t: Tab) => void; lang: Lang; upBase: (fn: (b: Scenario) => Scenario) => void; onAllocation: () => void }) {
  const { t } = useTranslation();
  const active = useActive()!;
  const tr = active.result.training;
  const bom = useMemo(() => topologyBom(s), [s]);
  const target = s.targets.operational ?? 0.985;
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="kpi-row kpi5">
        {tr ? (
          <>
            <Kpi label={t('topology.kpiAop')} value={fmtPct(tr.operationalAvailability, 3)} note={`${t('topology.target')} ${fmtPct(target, 2)} · 1/(1 + Σλp̄)·(1 − φ_sdc)`} tone={tr.operationalAvailability < target ? 'warn' : undefined} />
            <Kpi label={t('topology.kpiDelivered')} value={fmtPct(tr.deliveredGoodput, 2)} note={`${t('topology.target')} ${fmtPct(s.targets.goodput ?? 0.9, 1)} · ${t('topology.deliveredNote')}`} tone={tr.deliveredGoodput < (s.targets.goodput ?? 0.9) ? 'warn' : undefined} />
            <Kpi label={t('common.mtbi')} value={fmtDuration(tr.mtbiS, lang)} note={`${fmtNum(tr.interruptionsPerDay, 1)} / ${lang === 'zh' ? '天' : 'day'} · 1/λ_job`} />
            <Kpi label={t('topology.kpiPause')} value={fmtDuration(tr.meanPauseS, lang)} note={t('topology.kpiPauseNote')} />
          </>
        ) : (
          <Kpi label={t('common.availability')} value={fmtPct(active.result.system.availability, 4)} />
        )}
        <Kpi label={t('topology.kpiFit')} value={fmtNum(bom.hardFitPerNpuTotal, 1)} note={`Σ n·FIT / N · ${t('topology.kpiFitNote')}`} />
      </div>
      <div className="tabs" role="tablist">
        {(['picture', 'hardware', 'reliability', 'allocation'] as Tab[]).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`topology.tab_${k}`)}</button>)}
      </div>
      {tab === 'picture' && <PictureTab s={s} lang={lang} />}
      {tab === 'hardware' && <HardwareTab s={s} lang={lang} upBase={upBase} />}
      {tab === 'reliability' && <ReliabilityPanel />}
      {tab === 'allocation' && <AllocationTab s={s} onAllocation={onAllocation} />}
    </div>
  );
}

function PictureTab({ s, lang }: { s: Scenario; lang: Lang }) {
  const { t } = useTranslation();
  const active = useActive()!;
  const info = s.topology.template ? TOPOLOGY_TEMPLATES[s.topology.template] : undefined;
  return (
    <Card title={info ? L(info.name, lang) : t('topology.customTopology')} sub={t('topology.pictureSub')}>
      {info || s.topology.superpod ? <TopologyPicture scenario={s} counts={active.result.counts} lang={lang} /> : <div className="callout">{t('topology.noPicture')}</div>}
      <div className="legend" style={{ marginTop: 8 }}>
        <span className="key"><span className="swatch" style={{ background: 'var(--series-3)' }} />{t('topology.legendNpu')}</span>
        <span className="key"><span className="swatch" style={{ background: 'var(--accent)' }} />UB</span>
        <span className="key"><span className="swatch" style={{ background: 'var(--series-2)' }} />RoCE / RDMA</span>
      </div>
      {info && (
        <>
          <h3 style={{ margin: '10px 0 4px' }}>{t('topology.sources')}</h3>
          <ul className="plain" style={{ fontSize: 12 }}>
            {info.sources.map((src) => <li key={src.label}><Badge status={src.confidence === 'paper' ? 'paper-reported' : src.confidence}>{src.confidence}</Badge> {src.url ? <a href={src.url} target="_blank" rel="noreferrer">{src.label}</a> : src.label} — {L(src.note, lang)}</li>)}
          </ul>
          {info.assumed.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t('topology.assumedFields')}: {info.assumed.join(', ')}</div>}
        </>
      )}
    </Card>
  );
}

const UNIT_ORDER: FaultUnit[] = ['npu', 'job', 'cpu', 'node', 'cabinet', 'ub-switch', 'ub-link', 'roce-switch', 'roce-link'];

function HardwareTab({ s, lang, upBase }: { s: Scenario; lang: Lang; upBase: (fn: (b: Scenario) => Scenario) => void }) {
  const { t } = useTranslation();
  const bom = useMemo(() => topologyBom(s), [s]);
  const sizes = useMemo(() => bomAtSizes(s), [s]);
  const N = bom.npus;
  const extra = !TOPOLOGY_SCALES.includes(N);
  const total = bom.hardPerHour;
  // rows of every displayed size (a fourth Clos tier appears from 100,000 NPUs); '—' where a row does not exist at that size
  const rows = useMemo(() => bomRowsAcross(bom, sizes), [bom, sizes]);
  const here = useMemo(() => new Set(bom.rows.map((r) => r.id)), [bom]);
  const cell = (r: BomRow, i: number) => { const q = sizes[i].bom.rows.find((x) => x.id === r.id); return q ? fmtCount(q.count) : '—'; };
  return (
    <div className="grid" style={{ gap: 12 }}>
      <Card title={t('topology.bomTitle')} sub={t('topology.bomSub')} formula="count(N) from the template geometry (computeCounts) · FIT_unit = FIT_card × cards per unit (CloudMatrix384 geometry) · λ_row = count × FIT_unit / 1e9 per hour">
        <div className="table-wrap">
          <table className="data bom">
            <thead>
              <tr>
                <th>{t('topology.unit')}</th>
                <th className="num">{t('topology.perNpu')}</th>
                {TOPOLOGY_SCALES.map((n) => <th key={n} className={`num${n === N ? ' cur' : ''}`}>{fmtInt(n)}</th>)}
                {extra && <th className="num cur">{fmtInt(N)}</th>}
                <th className="num">{t('topology.fitUnit')}</th>
                <th className="num">{t('topology.lambdaShare')}</th>
                <th>{t('topology.impact')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.faultUnit ? undefined : 'count-only'}>
                  <td>{L(r.name, lang)} <Badge status={r.confidence === 'paper' ? 'paper-reported' : r.confidence}>{r.confidence}</Badge></td>
                  <td className="num">{!here.has(r.id) ? '—' : r.perNpu >= 0.01 ? fmtNum(r.perNpu, 3) : r.perNpu.toExponential(2)}</td>
                  {TOPOLOGY_SCALES.map((n, i) => <td key={n} className={`num${n === N ? ' cur' : ''}`}>{cell(r, i)}</td>)}
                  {extra && <td className="num cur">{here.has(r.id) ? fmtCount(r.count) : '—'}</td>}
                  <td className="num">{r.fit ? fmtNum(r.fit.hard, r.fit.hard >= 100 ? 0 : 2) : '—'}</td>
                  <td className="num">{here.has(r.id) && r.hardPerHour !== undefined && total > 0 ? fmtPct(r.hardPerHour / total, 1) : '—'}</td>
                  <td style={{ fontSize: 12, minWidth: 150 }}>{L(r.impact, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="plain muted" style={{ fontSize: 12, marginTop: 6 }}>
          <li>{t('topology.bomNoteFit')}</li>
          {s.topology.scaleOut && <li>{t('topology.bomNoteTiers')}</li>}
          {bom.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Card>
      {s.topology.template ? <FaultTypesCard s={s} lang={lang} upBase={upBase} /> : <div className="callout">{t('topology.faultTypesCustom')}</div>}
    </div>
  );
}

function FaultTypesCard({ s, lang, upBase }: { s: Scenario; lang: Lang; upBase: (fn: (b: Scenario) => Scenario) => void }) {
  const { t } = useTranslation();
  const over = useMemo(() => fitOverrides(s), [s]);
  const bom = useMemo(() => topologyBom(s), [s]);
  const byId = useMemo(() => new Map(s.components.map((c) => [c.id, c])), [s]);
  const lib = LIB.filter((f) => byId.has(f.id));
  const units = UNIT_ORDER.filter((u) => lib.some((f) => f.unit === u));
  const fitOf = (id: string) => {
    if (over[id] !== undefined) return over[id];
    return LIB.find((f) => f.id === id)!.fitPerUnit;
  };
  const edit = (id: string, type: 'hard' | 'slow' | 'sdc', v: number) => upBase((b) => ({ ...b, components: b.components.map((c) => (c.id === id ? setFit(c, type, Math.max(0, v)) : c)) }));
  const unitCount: Record<FaultUnit, number> = { npu: bom.counts.gpus, job: bom.counts.gpus, cpu: bom.counts.cpus, node: bom.counts.nodes, cabinet: bom.counts.racks, 'ub-switch': bom.counts.ubSwitches, 'ub-link': bom.counts.opticalLinks, 'roce-switch': bom.counts.scaleOutSwitches, 'roce-link': bom.counts.scaleOutLinks };
  return (
    <Card title={t('topology.faultTypes')} sub={t('topology.faultTypesSub')} formula="FIT per unit-hour (business impact after the existing protection) · hard: interruptions · slow: sub-health entries · sdc: silent corruption · per-NPU contribution = count × FIT_unit / N">
      <div className="table-wrap">
        <table className="data faults">
          <thead>
            <tr>
              <th>{t('topology.domain')}</th>
              <th className="num">{t('topology.hardFit')}</th>
              <th className="num">{t('topology.slowFit')}</th>
              <th className="num">{t('topology.sdcFit')}</th>
              <th className="num">{t('topology.perNpuHard')}</th>
              <th>{t('topology.flags')}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const domains = [...new Set(lib.filter((f) => f.unit === u).map((f) => f.domainId))];
              return [
                <tr key={`h-${u}`} className="unit-head"><td colSpan={6}><b>{L(FAULT_UNIT_NAMES[u], lang)}</b> <span className="muted">· {fmtInt(unitCount[u])} {t('topology.units')} · {fmtNum(bom.hardFitPerNpu[u] ?? 0, 1)} FIT / NPU</span></td></tr>,
                ...domains.map((d) => {
                  const suffix = u === 'roce-switch' || u === 'roce-link' ? '@roce' : '';
                  const ids = { hard: `${d}-hard${suffix}`, slow: `${d}-slow${suffix}`, sdc: `${d}-sdc${suffix}` };
                  const hardLib = LIB.find((f) => f.id === ids.hard)!;
                  const cell = (type: 'hard' | 'slow' | 'sdc') => {
                    const id = ids[type];
                    if (!byId.has(id)) return <td key={type} className="num">—</td>;
                    const v = fitOf(id);
                    const def = LIB.find((f) => f.id === id)!.fitPerUnit;
                    return (
                      <td key={type} className="num">
                        <span className={`fit-edit${over[id] !== undefined ? ' changed' : ''}`} title={over[id] !== undefined ? `${t('topology.libDefault')} ${fmtNum(def, 3)}` : LIB.find((f) => f.id === id)!.derivation}>
                          <NumberInput value={Number(v.toPrecision(4))} min={0} step={v >= 100 ? 10 : v >= 1 ? 0.5 : 0.01} onChange={(x) => edit(id, type, x)} />
                          {over[id] !== undefined && <button type="button" className="btn small" aria-label="reset" onClick={() => edit(id, type, def)}>↺</button>}
                        </span>
                      </td>
                    );
                  };
                  const hardNow = fitOf(ids.hard);
                  return (
                    <tr key={`${u}-${d}`}>
                      <td><span className="mono">{d}</span> {L(DOMAIN_NAMES[d] ?? { zh: d, en: d }, lang)}{hardLib.analogue && <span className="tag-assumed"> · {t('topology.analogue')}</span>}<div className="muted" style={{ fontSize: 11 }}>{L(hardLib.description, lang)}</div></td>
                      {cell('hard')}
                      {cell('slow')}
                      {cell('sdc')}
                      <td className="num">{fmtNum((hardNow * unitCount[u]) / Math.max(1, bom.counts.gpus), 2)}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{hardLib.flags.replay ? 'R ' : ''}{hardLib.flags.process ? 'P ' : ''}{hardLib.flags.elastic ? 'E' : ''}{!hardLib.flags.replay && !hardLib.flags.process && !hardLib.flags.elastic ? '—' : ''}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('topology.flagsLegend')}</div>
    </Card>
  );
}

function AllocationTab({ s, onAllocation }: { s: Scenario; onAllocation: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const key = JSON.stringify(s);
  const [res, setRes] = useState<Partial<Record<StrategyId, StrategyResult>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  useEffect(() => { setRes({}); setErr(null); }, [key]);
  if (s.workload.type !== 'training') return <div className="callout">{t('inference.notTraining')}</div>;
  const target = s.targets.operational ?? 0.985;
  const run = async () => {
    setBusy(true); setErr(null); setRes({});
    try {
      for (const st of STRATEGY_IDS) {
        setProgress(t(`strategy.name_${st}`));
        const r = await compute().strategy(s, { strategy: st, target, metric: 'aOp' }, progressCallback(() => {}));
        setRes((o) => ({ ...o, [st]: r }));
      }
    } catch (e) {
      setErr(e instanceof ComputeCancelled ? t('mechanisms.cancelled') : (e as Error).message);
    } finally { setBusy(false); setProgress(''); }
  };
  const rows = STRATEGY_IDS.filter((st) => res[st]).map((st) => res[st]!);
  return (
    <Card title={t('topology.allocTitle')} sub={t('topology.allocSub', { target: fmtPct(target, 2) })}>
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={busy} onClick={run}>{busy ? `${t('common.running')} ${progress}` : t('topology.allocRun')}</button>
        {busy && <button type="button" className="btn" onClick={cancelCompute}>{t('mechanisms.cancel')}</button>}
        <button type="button" className="btn" onClick={onAllocation}>{t('topology.allocOpen')} ›</button>
      </div>
      {err && <div className="callout crit" style={{ marginTop: 8 }}>{err}</div>}
      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data">
            <thead><tr><th>{t('strategy.strategy')}</th><th className="num">{t('strategy.final')}</th><th>{t('strategy.added')}</th><th className="num">{t('strategy.hwEffort')}</th><th className="num">{t('strategy.totalEffort')}</th><th>{t('strategy.hwTop')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.strategy}>
                  <td>{t(`strategy.name_${r.strategy}`)} {r.feasible ? <Badge status="pass">✓</Badge> : <Badge status="fail">{t('strategy.infeasible')}</Badge>}</td>
                  <td className="num">{fmtPct(r.final.value, 3)} / {fmtPct(r.final.derated, 3)}</td>
                  <td style={{ fontSize: 12 }}>{[...r.mechanisms, ...r.levers.map((l) => (lang === 'zh' ? LEVER_SHORT[l].zh : LEVER_SHORT[l].en))].join(' + ') || '—'}</td>
                  <td className="num">{fmtNum(r.effort.hardware, 2)}</td>
                  <td className="num"><b>{fmtNum(r.effort.total, 2)}</b></td>
                  <td style={{ fontSize: 12 }}>{r.hardware.needed ? r.hardware.rows.filter((h) => h.factor < 1).sort((a, b) => a.factor - b.factor).slice(0, 3).map((h) => `${h.id} ×${h.factor.toFixed(2)}`).join(', ') : r.hardware.slackFactor !== undefined ? `${t('strategy.slack')} ×${Number.isFinite(r.hardware.slackFactor) ? r.hardware.slackFactor.toFixed(2) : '∞'}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('topology.allocNote')}</div>
    </Card>
  );
}
