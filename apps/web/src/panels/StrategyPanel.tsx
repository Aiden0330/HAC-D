import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Comlink from 'comlink';
import {
  MECHANISM_LIBRARY, TOPOLOGY_SCALES, DEFAULT_STRATEGY_CANDIDATES, DEFAULT_LEVERS, DEFAULT_FLOOR, DEFAULT_EFFORT_PER_HALVING, LEVER_NAMES, LEVER_SHORT, STRATEGY_IDS, computeCounts, componentInstances, integrationStatus,
  DEFAULT_MECHANISM_SET, resolveMechanismSet, DERATE_DEFAULT,
  type Scenario, type StrategyId, type StrategyMetric, type HardwareSplit, type RecoveryLever, type StrategyResult, type StrategyOptions, type BudgetResult, type DerateSpec, type MechanismDef,
} from '@hac-d/core';
import { useStore, useActiveSettings } from '../state/store.js';
import { useLang } from '../hooks.js';
import { compute, cancelCompute, progressCallback, ComputeCancelled } from '../worker/client.js';
import { Kpi, Card, Field, NumberInput, Select, Badge, DataTable } from '../components/ui.js';
import { fmtPct, fmtNum, fmtInt, fmtHours } from '../lib/format.js';

export interface StrategySettings {
  metric: StrategyMetric;
  target: number;
  strategy: StrategyId | 'all';
  split: HardwareSplit;
  derate: boolean;
  trials: number;
  candidates: string[];
  levers: (RecoveryLever & { on: boolean })[];
  /**
   * v5.3 effort per mechanism id for the search; empty / absent = the Mechanism library page's effort edits (project settings
   * mechanisms.efforts), else the library value — so both pages agree unless the form carries its own (Report settings)
   */
  efforts?: Record<string, number>;
  /** v5.3 parameter overrides of the candidate mechanisms (merged over the library defaults; Report settings: the mechanism set's) */
  parameters?: Record<string, Record<string, number>>;
}

export function defaultSettings(s: Scenario): StrategySettings {
  return { metric: 'aOp', target: s.targets.operational ?? 0.985, strategy: 'all', split: 'min-effort', derate: true, trials: 0, candidates: DEFAULT_STRATEGY_CANDIDATES.filter((id) => !s.mechanisms.applied?.[id]), levers: DEFAULT_LEVERS.map((l) => ({ ...l, on: true })), efforts: {}, parameters: {} };
}

/** v5.3 a candidate mechanism is ready when its integration parameters are present (library defaults merged with the form's) */
export const mechanismReady = (m: MechanismDef, parameters?: Record<string, number>) => !m.integrationNeeds?.length || integrationStatus(m, { ...m.parameters, ...(parameters ?? {}) }).ready;

/**
 * v5.3 the settings of the Findings report (hacd findings / hacd budget over DEFAULT_MECHANISM_SET): A_op target, the optimal
 * strategy with the ARINC split, derating on, 400 windows, the set's candidates (appliable, not applied in the scenario, ready with
 * the set's parameters), the set's parameters, efforts and levers (all on). The strategy run then reproduces the report's
 * "optimal" row; its "recommended" row adds the window rule (Report budget card).
 */
export function reportSettings(s: Scenario): StrategySettings {
  const r = resolveMechanismSet(DEFAULT_MECHANISM_SET);
  const candidates = r.candidates.filter((id) => {
    const m = MECHANISM_LIBRARY.find((x) => x.id === id);
    return !!m && !!m.apply && m.status !== 'informational' && !s.mechanisms.applied?.[id] && mechanismReady(m, r.parameters[id]);
  });
  return { metric: 'aOp', target: s.targets.operational ?? 0.985, strategy: 'optimal', split: 'arinc', derate: true, trials: 400, candidates, efforts: { ...r.efforts }, parameters: Object.fromEntries(Object.entries(r.parameters).map(([id, p]) => [id, { ...p }])), levers: r.levers.map((l) => ({ ...l, on: true })) };
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNumRecord = (v: unknown): v is Record<string, number> => isPlain(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * v5.1 the stored strategy form of a project over the scenario's defaults (null = the defaults; unknown keys dropped, mistyped ones
 * defaulted). v5.3 objects stored before `efforts` / `parameters` existed resolve to empty records (= the page's efforts, library parameters).
 */
export function resolveStrategySettings(s: Scenario, stored: StrategySettings | null | undefined): StrategySettings {
  const d = defaultSettings(s);
  if (!stored || typeof stored !== 'object') return d;
  const out = { ...d } as Record<string, unknown>;
  for (const k of Object.keys(d) as (keyof StrategySettings)[]) {
    const v = (stored as unknown as Record<string, unknown>)[k];
    if (k === 'efforts') { if (isNumRecord(v)) out[k] = v; continue; }
    if (k === 'parameters') { if (isPlain(v) && Object.values(v).every(isNumRecord)) out[k] = v; continue; }
    if (v !== undefined && v !== null && (Array.isArray(d[k]) ? Array.isArray(v) : typeof v === typeof d[k])) out[k] = v;
  }
  return out as unknown as StrategySettings;
}

const hasKeys = (o: object | undefined): o is object => !!o && Object.keys(o).length > 0;
/** the efforts the search uses: the form's when it has any, else the Mechanism library page's edits (library values for the rest) */
export const effortsOf = (st: StrategySettings, pageEfforts?: Record<string, number>): Record<string, number> | undefined => (hasKeys(st.efforts) ? st.efforts : hasKeys(pageEfforts) ? pageEfforts : undefined);

export function optionsOf(st: StrategySettings, strategy: StrategyId, pageEfforts?: Record<string, number>): Omit<StrategyOptions, 'onProgress'> {
  return { strategy, target: st.target, metric: st.metric, hardwareSplit: st.split, derate: st.derate ? undefined : null, candidates: st.candidates, levers: st.levers.filter((l) => l.on).map(({ on: _on, ...l }) => l), verify: st.trials > 0 ? { trials: st.trials } : undefined, efforts: effortsOf(st, pageEfforts), parameters: hasKeys(st.parameters) ? st.parameters : undefined };
}

/** v5.3 no derating for the budget when the form's derate switch is off (hierarchicalBudget always derates; this spec is the identity) */
const NO_DERATE: DerateSpec = { coverageDelta: 0, successDelta: 0, timeFactor: 1, reductionFactor: 1 };

/** v4 target, strategy and constraints form (the Strategies tab; v5.3: the across-sizes card reads the same form) */
export function StrategyForm({ s, st, set }: { s: Scenario; st: StrategySettings; set: (f: (x: StrategySettings) => StrategySettings) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const updateActive = useStore((x) => x.updateActive);
  const pageEfforts = useActiveSettings().mechanisms.efforts;
  const efforts = effortsOf(st, pageEfforts) ?? {};
  const pool = MECHANISM_LIBRARY.filter((m) => m.apply && m.status !== 'informational' && !s.mechanisms.applied?.[m.id]);
  const name = (id: string) => { const m = MECHANISM_LIBRARY.find((x) => x.id === id)!; return lang === 'zh' ? m.name.zh : m.name.en; };
  const classes = useMemo(() => {
    const counts = computeCounts(s);
    return s.components.filter((c) => c.enabled).map((c) => ({ c, ci: componentInstances(c, counts, s.measures.subhealthThreshold) })).filter((x) => x.ci.lambda > 0).sort((a, b) => b.ci.lambda * b.ci.total - a.ci.lambda * a.ci.total);
  }, [s]);
  const setAlloc = (id: string, patch: NonNullable<Scenario['components'][number]['allocation']>) => updateActive((sc) => ({ ...sc, components: sc.components.map((q) => (q.id === id ? { ...q, allocation: { ...(q.allocation ?? {}), ...patch } } : q)) }));
  const setAll = (patch: NonNullable<Scenario['components'][number]['allocation']>) => updateActive((sc) => ({ ...sc, components: sc.components.map((q) => ({ ...q, allocation: { ...(q.allocation ?? {}), ...patch } })) }));
  const [allFloor, setAllFloor] = useState(DEFAULT_FLOOR);
  const [allEffort, setAllEffort] = useState(DEFAULT_EFFORT_PER_HALVING);
  return (
    <>
      <Card title={t('strategy.formTitle')} sub={t('strategy.formSub')}>
        <div className="form-grid">
          <Field label={t('strategy.metric')}><Select value={st.metric} onChange={(v) => set((x) => ({ ...x, metric: v, target: v === 'aOp' ? s.targets.operational ?? 0.985 : s.targets.goodput ?? 0.9 }))} options={[{ value: 'aOp', label: t('mechanisms.metric_aOp') }, { value: 'delivered', label: t('mechanisms.metric_delivered') }]} /></Field>
          <Field label={t('strategy.target')}><NumberInput value={st.target} min={0.5} max={0.99999} step={0.0005} onChange={(v) => set((x) => ({ ...x, target: v }))} /></Field>
          <Field label={t('strategy.strategy')} hint={t(`strategy.hint_${st.strategy}`)}><Select value={st.strategy} onChange={(v) => set((x) => ({ ...x, strategy: v }))} options={[{ value: 'all', label: t('strategy.compareAll') }, ...STRATEGY_IDS.map((id) => ({ value: id, label: t(`strategy.name_${id}`) }))]} /></Field>
          <Field label={t('strategy.split')} hint={t(`strategy.splitHint_${st.split}`)}><Select value={st.split} onChange={(v) => set((x) => ({ ...x, split: v }))} options={(['min-effort', 'agree', 'arinc'] as HardwareSplit[]).map((v) => ({ value: v, label: t(`strategy.split_${v}`) }))} /></Field>
          <Field label={t('strategy.trials')} hint={t('strategy.trialsHint')}><NumberInput value={st.trials} min={0} max={2000} step={50} onChange={(v) => set((x) => ({ ...x, trials: Math.max(0, Math.round(v)) }))} /></Field>
        </div>
        <label className="check" title={t('mechanisms.planDerateHint')}><input type="checkbox" checked={st.derate} onChange={(e) => set((x) => ({ ...x, derate: e.target.checked }))} />{t('strategy.derate')}</label>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn small" onClick={() => set(() => reportSettings(s))}>{t('strategy.presetReport')}</button>
          <button type="button" className="btn small" onClick={() => set(() => defaultSettings(s))}>{t('strategy.presetDefaults')}</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('strategy.presetNote', { id: DEFAULT_MECHANISM_SET.id })}</div>
      </Card>
      <Card title={t('strategy.movesTitle')} sub={t('strategy.movesSub')}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('strategy.candidates')} ({st.candidates.length})</div>
        <div className="btn-row">
          {pool.map((m) => {
            const ready = mechanismReady(m, st.parameters?.[m.id]);
            return <button key={m.id} type="button" className="btn small" aria-pressed={st.candidates.includes(m.id)} disabled={!ready} title={`${lang === 'zh' ? m.change.zh : m.change.en}${ready ? '' : ` · ${t('audit.needs')}: ${m.integrationNeeds!.join(', ')}`}`} onClick={() => set((x) => ({ ...x, candidates: x.candidates.includes(m.id) ? x.candidates.filter((q) => q !== m.id) : [...x.candidates, m.id] }))}>{m.id} · {name(m.id)}{m.kind === 'physical' ? ' ⚙' : ''} · {efforts[m.id] ?? m.effort}</button>;
          })}
        </div>
        <div className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>{t('strategy.candidatesNote')}</div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{t('strategy.lever')}</th><th className="num">{t('strategy.limit')}</th><th className="num">{t('mechanisms.effort')}</th></tr></thead>
            <tbody>
              {st.levers.map((l, i) => (
                <tr key={l.id}>
                  <td><label className="check" style={{ margin: 0 }}><input type="checkbox" checked={l.on} onChange={(e) => set((x) => ({ ...x, levers: x.levers.map((q, j) => (j === i ? { ...q, on: e.target.checked } : q)) }))} />{lang === 'zh' ? LEVER_NAMES[l.id].zh : LEVER_NAMES[l.id].en}</label></td>
                  <td className="num"><NumberInput value={l.limit} min={0} step={l.id === 'success' ? 0.0005 : 10} onChange={(v) => set((x) => ({ ...x, levers: x.levers.map((q, j) => (j === i ? { ...q, limit: v } : q)) }))} /></td>
                  <td className="num"><NumberInput value={l.effort} min={0} step={1} onChange={(v) => set((x) => ({ ...x, levers: x.levers.map((q, j) => (j === i ? { ...q, effort: Math.max(0, v) } : q)) }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('strategy.leversNote')}</div>
      </Card>
      <Card title={t('strategy.hwTitle')} sub={t('strategy.hwSub')} formula="effort_hw = Σ e_i · log2(FIT_now / FIT_allowed) · FIT_allowed ≥ floor_i · FIT_now">
        <div className="btn-row">
          <Field label={t('strategy.floorAll')}><NumberInput value={allFloor} min={0} max={1} step={0.05} onChange={setAllFloor} /></Field>
          <Field label={t('strategy.effortAll')}><NumberInput value={allEffort} min={0} step={0.5} onChange={setAllEffort} /></Field>
          <button type="button" className="btn small" style={{ alignSelf: 'end' }} onClick={() => setAll({ minLambdaFactor: allFloor, effortPerHalving: allEffort })}>{t('strategy.applyAll')}</button>
        </div>
        <details style={{ marginTop: 8 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>{t('strategy.perClass', { n: classes.length })}</summary>
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="data">
              <thead><tr><th>{t('common.component')}</th><th className="num">{t('topology.units')}</th><th className="num">{t('strategy.fitNow')}</th><th className="num">{t('strategy.floor')}</th><th className="num">{t('strategy.effortHalving')}</th><th>{t('allocation.wFixed')}</th></tr></thead>
              <tbody>
                {classes.map(({ c, ci }) => (
                  <tr key={c.id}>
                    <td><span className="mono">{c.id}</span><div className="muted" style={{ fontSize: 11 }}>{lang === 'zh' ? c.name?.zh ?? c.name?.en : c.name?.en ?? c.name?.zh}</div></td>
                    <td className="num">{fmtInt(ci.total)}</td>
                    <td className="num">{fmtNum(ci.lambda * 1e9, 2)}</td>
                    <td className="num"><NumberInput value={c.allocation?.minLambdaFactor ?? DEFAULT_FLOOR} min={0} max={1} step={0.05} onChange={(v) => setAlloc(c.id, { minLambdaFactor: Math.min(1, Math.max(0, v)) })} /></td>
                    <td className="num"><NumberInput value={c.allocation?.effortPerHalving ?? DEFAULT_EFFORT_PER_HALVING} min={0} step={0.5} onChange={(v) => setAlloc(c.id, { effortPerHalving: Math.max(0, v) })} /></td>
                    <td><input type="checkbox" checked={!!c.allocation?.fixed} onChange={(e) => setAlloc(c.id, { fixed: e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </>
  );
}

/** v4 strategies tab: run one strategy or all three, show the plan, the allowed FIT per class and the verification */
export function StrategyPanel({ s, st }: { s: Scenario; st: StrategySettings }) {
  const { t } = useTranslation();
  const lang = useLang();
  const addScenario = useStore((x) => x.addScenario);
  const pageEfforts = useActiveSettings().mechanisms.efforts;
  const [results, setResults] = useState<Partial<Record<StrategyId, StrategyResult>>>({});
  const [shown, setShown] = useState<StrategyId>('optimal');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  const key = JSON.stringify(s);
  useEffect(() => { setResults({}); }, [key]);
  if (s.workload.type !== 'training') return <div className="callout">{t('inference.notTraining')}</div>;
  const run = async () => {
    setBusy(true); setErr(null); setResults({});
    const ids = st.strategy === 'all' ? STRATEGY_IDS : [st.strategy];
    try {
      for (const id of ids) {
        setProgress(t(`strategy.name_${id}`));
        const r = await compute().strategy(s, optionsOf(st, id, pageEfforts), progressCallback((done: number, total: number) => setProgress(`${t(`strategy.name_${id}`)} ${done} / ${total}`)));
        setResults((o) => ({ ...o, [id]: r }));
      }
      setShown(ids[0]);
    } catch (e) {
      setErr(e instanceof ComputeCancelled ? { text: t('mechanisms.cancelled'), tone: 'info' } : { text: (e as Error).message, tone: 'crit' });
    } finally { setBusy(false); setProgress(''); }
  };
  const list = STRATEGY_IDS.filter((id) => results[id]).map((id) => results[id]!);
  const r = results[shown] ?? list[0];
  const v = (x: number) => fmtPct(x, st.metric === 'aOp' ? 3 : 2);
  const leverLabel = (id: string) => (lang === 'zh' ? LEVER_SHORT[id as keyof typeof LEVER_SHORT].zh : LEVER_SHORT[id as keyof typeof LEVER_SHORT].en);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={busy} onClick={run}>{busy ? `${t('common.running')} ${progress}` : t('strategy.run')}</button>
        {busy && <button type="button" className="btn" onClick={cancelCompute}>{t('mechanisms.cancel')}</button>}
      </div>
      {err && <div className={`callout ${err.tone === 'crit' ? 'crit' : ''}`}>{err.text}</div>}
      {list.length > 1 && (
        <Card title={t('strategy.compareTitle')}>
          <DataTable
            columns={[t('strategy.strategy'), t('strategy.final'), t('strategy.added'), t('strategy.mechEffort'), t('strategy.hwEffort'), t('strategy.totalEffort'), '']}
            numericFrom={3}
            highlight={(i) => list[i].strategy === shown}
            rows={list.map((x) => [<button key="b" type="button" className="btn small" aria-pressed={x.strategy === shown} onClick={() => setShown(x.strategy)}>{t(`strategy.name_${x.strategy}`)}</button>, `${v(x.final.value)} / ${v(x.final.derated)}`, [...x.mechanisms, ...x.levers.map(leverLabel)].join(' + ') || '—', fmtNum(x.effort.mechanisms + x.effort.levers, 1), fmtNum(x.effort.hardware, 2), <b key="t">{fmtNum(x.effort.total, 2)}</b>, x.feasible ? <Badge key="f" status="pass">{t('strategy.feasible')}</Badge> : <Badge key="f" status="fail">{t('strategy.infeasible')}</Badge>])}
          />
        </Card>
      )}
      {r && <StrategyDetail r={r} metric={st.metric} onSave={() => addScenario({ ...r.scenario, meta: { ...r.scenario.meta, id: undefined, name: `${s.meta.name} · ${t(`strategy.name_${r.strategy}`)} ${fmtPct(r.target, 2)}` } }, false)} />}
      <BudgetCard s={s} st={st} pageEfforts={pageEfforts} />
    </div>
  );
}

function StrategyDetail({ r, metric, onSave }: { r: StrategyResult; metric: StrategyMetric; onSave: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [saved, setSaved] = useState(false);
  const v = (x: number) => fmtPct(x, metric === 'aOp' ? 3 : 2);
  const cut = r.hardware.rows.filter((h) => h.factor < 1).sort((a, b) => a.factor - b.factor);
  const leverLabel = (id: string) => (lang === 'zh' ? LEVER_SHORT[id as keyof typeof LEVER_SHORT].zh : LEVER_SHORT[id as keyof typeof LEVER_SHORT].en);
  return (
    <Card title={`${t(`strategy.name_${r.strategy}`)} · ${t(`mechanisms.metric_${r.metric}`)} ≥ ${fmtPct(r.target, 2)}`} sub={t(`strategy.hint_${r.strategy}`)}>
      <div className="kpi-row">
        <Kpi hero label={t('strategy.final')} value={v(r.final.value)} note={`${t('strategy.derated')} ${v(r.final.derated)} · ${t('strategy.baseline')} ${v(r.baseline.value)} / ${v(r.baseline.derated)}`} tone={r.feasible ? undefined : 'bad'} />
        <Kpi label={t('strategy.totalEffort')} value={fmtNum(r.effort.total, 2)} note={`${t('strategy.mechEffort')} ${fmtNum(r.effort.mechanisms, 1)} + ${t('strategy.leverEffort')} ${fmtNum(r.effort.levers, 1)} + ${t('strategy.hwEffort')} ${fmtNum(r.effort.hardware, 2)}`} />
        <Kpi label={t('strategy.added')} value={r.mechanisms.length + r.levers.length ? t('strategy.movesN', { n: r.mechanisms.length + r.levers.length }) : '—'} note={[...r.mechanisms, ...r.levers.map(leverLabel)].join(' + ') || t('strategy.addedNote')} />
        <Kpi label={t('strategy.hardware')} value={r.hardware.needed ? t('strategy.hwClasses', { n: cut.length }) : r.hardware.slackFactor !== undefined ? `${t('strategy.slack')} ×${Number.isFinite(r.hardware.slackFactor) ? fmtNum(r.hardware.slackFactor, 2) : '∞'}` : '—'} note={r.hardware.atFloors.length ? `${t('strategy.atFloor')}: ${r.hardware.atFloors.join(', ')}` : t(`strategy.split_${r.hardwareSplit}`)} tone={r.hardware.atFloors.length ? 'warn' : undefined} />
        {r.verification && <Kpi label={t('strategy.verification')} value={`P ${fmtPct(r.verification.pAtLeastTarget, 1)}`} note={`${t('mechanisms.wilson')} ${fmtPct(r.verification.wilson[0], 1)} – ${fmtPct(r.verification.wilson[1], 1)} · ${t('mechanisms.verdict_' + r.verification.verdict)} · ${r.verification.trials} ${t('simulate.trials')}`} tone={r.verification.verdict === 'supported' ? undefined : r.verification.verdict === 'below' ? 'bad' : 'warn'} />}
      </div>
      <h3 style={{ margin: '12px 0 4px' }}>{t('strategy.steps')}</h3>
      <ol className="plain steps">
        {r.steps.length ? r.steps.map((x, i) => <li key={i}><span className="mono">{x.kind === 'lever' ? leverLabel(x.id) : x.kind === 'hardware' ? t('strategy.hwStep', { split: t(`strategy.split_${x.id}`) }) : x.id}</span> · {t('mechanisms.effort')} {fmtNum(x.effort, 2)} → {v(x.value)} / {v(x.derated)}</li>) : <li className="muted">{t('strategy.noSteps')}</li>}
      </ol>
      {cut.length > 0 && (
        <>
          <h3 style={{ margin: '12px 0 4px' }}>{t('strategy.allowedFit')}</h3>
          <DataTable
            columns={[t('common.component'), t('topology.units'), t('strategy.fitNow'), t('strategy.fitAllowed'), t('strategy.factor'), t('strategy.floor'), t('strategy.mtbfUnit'), t('strategy.points'), t('mechanisms.effort')]}
            numericFrom={1}
            rows={cut.map((h) => [<span key="n"><span className="mono">{h.id}</span>{h.atFloor && <Badge status="warn">{t('strategy.atFloor')}</Badge>}</span>, fmtInt(h.count), fmtNum(h.currentFit, 2), <b key="a">{fmtNum(h.allowedFit, 2)}</b>, `×${h.factor.toFixed(3)}`, fmtNum(h.floor, 2), fmtHours(h.mtbfHours, lang), `${(h.pointsBefore * 100).toFixed(3)} → ${(h.pointsAfter * 100).toFixed(3)} pt`, fmtNum(h.effort, 2)])}
          />
        </>
      )}
      {r.alternatives && r.alternatives.length > 1 && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>{t('strategy.alternatives', { n: r.alternatives.length })}</summary>
          <DataTable columns={[t('strategy.added'), t('strategy.mechEffort'), t('strategy.hwEffort'), t('strategy.totalEffort'), t('strategy.final')]} numericFrom={1} rows={r.alternatives.map((p) => [[...p.mechanisms, ...p.levers.map(leverLabel)].join(' + ') || '∅', fmtNum(p.effort.mechanisms + p.effort.levers, 1), fmtNum(p.effort.hardware, 2), fmtNum(p.effort.total, 2), `${v(p.value)} / ${v(p.derated)}${p.feasible ? '' : ' ✕'}`])} />
        </details>
      )}
      <ul className="plain muted" style={{ fontSize: 12, marginTop: 8 }}><li>{t('strategy.nomDerDef')}</li>{r.notes.map((n) => <li key={n}>{n}</li>)}<li>{t('strategy.evaluations', { n: r.evaluations })}</li></ul>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn" disabled={saved} onClick={() => { onSave(); setSaved(true); }}>{saved ? t('strategy.saved') : t('strategy.save')}</button>
      </div>
    </Card>
  );
}

/** v4 the strategies at the built-in 10k / 100k / 200k / 500k (or any sizes); v5.3 a card at the end of the Strategies tab (formerly the Cross-scale tab, which duplicated the form) */
export function CrossScalePanel({ s, st }: { s: Scenario; st: StrategySettings }) {
  const { t } = useTranslation();
  const lang = useLang();
  const pageEfforts = useActiveSettings().mechanisms.efforts;
  const [sizesText, setSizesText] = useState(TOPOLOGY_SCALES.join(', '));
  const [rows, setRows] = useState<(Omit<StrategyResult, 'scenario'> & { npus: number })[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (s.workload.type !== 'training') return <div className="callout">{t('inference.notTraining')}</div>;
  const sizes = sizesText.split(/[,，\s]+/).map((x) => Number(x.replace(/[kK]$/, '000'))).filter((n) => Number.isFinite(n) && n > 0);
  const run = async () => {
    setBusy(true); setErr(null); setRows([]);
    try {
      for (const id of st.strategy === 'all' ? STRATEGY_IDS : [st.strategy]) {
        setProgress(t(`strategy.name_${id}`));
        const r = await compute().strategySizes(s, sizes, optionsOf(st, id, pageEfforts), progressCallback((done: number, total: number) => setProgress(`${t(`strategy.name_${id}`)} ${done} / ${total}`)));
        setRows((o) => [...o, ...r]);
      }
    } catch (e) {
      setErr(e instanceof ComputeCancelled ? t('mechanisms.cancelled') : (e as Error).message);
    } finally { setBusy(false); setProgress(''); }
  };
  const v = (x: number) => fmtPct(x, st.metric === 'aOp' ? 3 : 2);
  const leverLabel = (id: string) => (lang === 'zh' ? LEVER_SHORT[id as keyof typeof LEVER_SHORT].zh : LEVER_SHORT[id as keyof typeof LEVER_SHORT].en);
  return (
    <Card title={t('strategy.crossTitle')} sub={t('strategy.crossSub')}>
      <div className="form-grid">
        <Field label={t('audit.sizes')} hint={t('audit.sizesHint')}><input value={sizesText} onChange={(e) => setSizesText(e.target.value)} /></Field>
        <div className="field" style={{ justifyContent: 'end' }}>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={busy || !sizes.length} onClick={run}>{busy ? `${t('common.running')} ${progress}` : t('strategy.runCross')}</button>
            {busy && <button type="button" className="btn" onClick={cancelCompute}>{t('mechanisms.cancel')}</button>}
          </div>
        </div>
      </div>
      {err && <div className="callout crit" style={{ marginTop: 8 }}>{err}</div>}
      {rows.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <DataTable
            columns={[t('strategy.strategy'), t('topology.npus'), t('strategy.baseline'), t('strategy.final'), t('strategy.added'), t('strategy.hwEffort'), t('strategy.totalEffort'), t('strategy.hwTop'), '']}
            numericFrom={1}
            rows={rows.map((x) => [t(`strategy.name_${x.strategy}`), fmtInt(x.npus), v(x.baseline.value), `${v(x.final.value)} / ${v(x.final.derated)}`, [...x.mechanisms, ...x.levers.map(leverLabel)].join(' + ') || '—', fmtNum(x.effort.hardware, 2), <b key="t">{fmtNum(x.effort.total, 2)}</b>, x.hardware.needed ? x.hardware.rows.filter((h) => h.factor < 1).sort((a, b) => a.factor - b.factor).slice(0, 3).map((h) => `${h.id} ×${h.factor.toFixed(2)}`).join(', ') : x.hardware.slackFactor !== undefined ? `${t('strategy.slack')} ×${Number.isFinite(x.hardware.slackFactor) ? x.hardware.slackFactor.toFixed(2) : '∞'}` : '—', x.feasible ? <Badge key="f" status="pass">✓</Badge> : <Badge key="f" status="fail">✕</Badge>])}
          />
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('strategy.crossNote')}</div>
    </Card>
  );
}

/**
 * v5.3 the report budget of the active scenario at its own size: hierarchicalBudget (packages/core/src/budget) with the form's
 * target, candidates, parameters, efforts and levers, the ARINC split, the window rule and seed 1 — the rows today / required /
 * recommended of `hacd budget` and of Table 1 of the Findings report. The reference set is the scenario's applied mechanisms.
 * Results stay local and reset when the scenario changes.
 */
function BudgetCard({ s, st, pageEfforts }: { s: Scenario; st: StrategySettings; pageEfforts: Record<string, number> }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [trials, setTrials] = useState(400);
  const [res, setRes] = useState<BudgetResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [err, setErr] = useState<{ text: string; tone: 'crit' | 'info' } | null>(null);
  const key = JSON.stringify(s);
  useEffect(() => { setRes(null); setErr(null); }, [key]);
  const run = async () => {
    setBusy(true); setErr(null); setRes(null); setSteps([]);
    const n = Math.max(1, Math.round(trials));
    try {
      const r = await compute().budget(s, {
        target: st.target, candidates: st.candidates, parameters: st.parameters ?? {}, efforts: effortsOf(st, pageEfforts),
        levers: st.levers.filter((l) => l.on).map(({ on: _on, ...l }) => l), derate: st.derate ? DERATE_DEFAULT : NO_DERATE,
        reference: Object.keys(s.mechanisms.applied ?? {}), trials: n, seed: 1,
      }, Comlink.proxy((step: string) => setSteps((x) => [...x, step])));
      setRes(r);
    } catch (e) {
      const m = (e as Error).message;
      setErr(e instanceof ComputeCancelled ? { text: t('mechanisms.cancelled'), tone: 'info' } : { text: /supported window check/.test(m) ? `${t('strategy.budgetNoWindow', { n })} (${m})` : m, tone: 'crit' });
    } finally { setBusy(false); }
  };
  const p = (x: number, k = 3) => fmtPct(x, k), h = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${x.toFixed(3)} h`), sec = (x: number) => `${x.toFixed(1)} s`;
  const verdict = (v: string) => t(`mechanisms.verdict_${v}`);
  const leverLabel = (id: string) => (lang === 'zh' ? LEVER_SHORT[id as keyof typeof LEVER_SHORT].zh : LEVER_SHORT[id as keyof typeof LEVER_SHORT].en);
  const rec = res?.recommended;
  return (
    <Card title={t('strategy.budgetTitle')} sub={t('strategy.budgetSub')} formula={t('strategy.budgetFormula')}>
      {s.workload.type !== 'training' ? <div className="callout">{t('inference.notTraining')}</div> : (
        <>
          <div className="form-grid">
            <Field label={t('strategy.budgetTrials')} hint={t('strategy.budgetTrialsHint')}><NumberInput value={trials} min={1} max={5000} step={50} onChange={(v) => setTrials(Math.max(1, Math.round(v)))} /></Field>
            <div className="field" style={{ justifyContent: 'end' }}>
              <div className="btn-row">
                <button type="button" className="btn primary" disabled={busy || st.metric !== 'aOp'} onClick={run}>{busy ? t('common.running') : t('strategy.budgetRun')}</button>
                {busy && <button type="button" className="btn" onClick={cancelCompute}>{t('mechanisms.cancel')}</button>}
              </div>
            </div>
          </div>
          {st.metric !== 'aOp' && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('strategy.budgetAopOnly')}</div>}
          {(busy || steps.length > 0) && <div className="muted mono" style={{ fontSize: 12, marginTop: 6, overflowWrap: 'anywhere' }}>{t('strategy.budgetSteps')}: {steps.length ? steps.join(' → ') : '…'}</div>}
          {err && <div className={`callout ${err.tone === 'crit' ? 'crit' : ''}`} style={{ marginTop: 8 }}>{err.text}</div>}
          {res && rec && (
            <div style={{ marginTop: 10 }}>
              <DataTable
                columns={['', t('strategy.colAopNom'), t('strategy.colAopDer'), t('strategy.colMtbfDer'), t('strategy.colMttrDer'), t('strategy.colWindow'), t('strategy.colPlan')]}
                numericFrom={1}
                rows={[
                  [t('strategy.rowToday'), p(res.today.aOp), p(res.today.aOpDerated), h(res.today.kpiDerated.mtbfHwH), sec(res.today.kpiDerated.mttrS), `${p(res.today.window.pAtLeastTarget, 1)} · ${verdict(res.today.window.verdict)}`, '—'],
                  [t('strategy.rowRequired'), '', p(st.target, 1), `≥ ${h(res.required.mtbfAtTodayMttrH)} ${t('strategy.atTodayMttr')}`, `≤ ${sec(res.required.mttrAtTodayMtbfS)} ${t('strategy.atTodayMtbf')}`, '', `B = ${res.required.B.toFixed(1)} s/h (${t('strategy.formula2')})`],
                  [<b key="r">{t('strategy.rowRecommended')}</b>, p(rec.final.kpi.aOp), <b key="d">{p(rec.final.kpiDerated.aOp)}</b>, h(rec.final.kpiDerated.mtbfHwH), sec(rec.final.kpiDerated.mttrS), `${p(rec.window.pAtLeastTarget, 1)} · ${verdict(rec.window.verdict)}`, `${rec.mechanisms.join(' + ') || '—'} | ${rec.levers.map(leverLabel).join(' + ') || '—'} · ${t('strategy.hardwareK')} ${rec.k.toFixed(3)} (${t(`strategy.binding_${rec.binding}`)})${rec.escalated ? ` † ${t('strategy.escalated')}` : ''}`],
                ]}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('strategy.budgetNote', { n: fmtInt(res.npus), trials: res.today.window.trials, effort: fmtNum(rec.effort.total, 1) })}</div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
