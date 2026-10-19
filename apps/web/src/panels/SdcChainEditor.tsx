import { useTranslation } from 'react-i18next';
import { applyMechanisms, stripMechanisms, mechanismById, rungOrder, type Scenario } from '@hac-d/core';
import { Field, NumberInput, Select } from '../components/ui.js';
import { useLang } from '../hooks.js';

type Upd = (fn: (s: Scenario) => Scenario) => void;

/** chain rungs and the silent-corruption mechanisms, with the scenario field each one owns */
const RUNGS = [
  { id: 'P-PREDICT', field: 'predict' },
  { id: 'R-NETFAIL', field: 'netfail' },
  { id: 'R-REPLAY', field: 'replay' },
  { id: 'R-HOTSWAP', field: 'hotswap' },
  { id: 'R-ELASTIC', field: 'elastic' },
  { id: 'R-PROCESS', field: 'process' },
] as const;
const LABEL: Record<string, string> = {
  success: 'scenario.mechSuccess', successSeconds: 'scenario.mechSuccessS', failureSeconds: 'scenario.mechFailureS', recoverSeconds: 'scenario.mechRecoverS', syncSeconds: 'scenario.mechSyncS',
  domains: 'scenario.mechDomains', recall: 'scenario.mechRecall', precision: 'scenario.mechPrecision', migrationSeconds: 'scenario.mechMigrationS', coverage: 'scenario.sdcCoverage', detectSeconds: 'scenario.sdcDetectS', stepSeconds: 'scenario.sdcStepS',
};
const stepOf = (k: string) => (k === 'success' || k === 'coverage' || k === 'recall' || k === 'precision' ? 0.01 : k === 'domains' ? 1 : 1);

/**
 * v4 single owner of the silent-corruption policy and the recovery chain (duplicates D8 / D9 of the v4 plan): switching a rung or
 * detector on applies its library mechanism, every parameter edit re-applies it with the new parameters (so the applied record and
 * the scenario never disagree), switching it off removes it exactly. The fallback delay, the terminal rule and the rung order belong
 * to no mechanism and are edited directly.
 */
export function SdcChainEditor({ s, upd }: { s: Scenario; upd: Upd }) {
  const { t } = useTranslation();
  const lang = useLang();
  const anySdc = s.components.some((c) => c.enabled && c.sdc && c.sdc.ratePerHour > 0);
  const recorded = (id: string) => s.mechanisms.applied?.[id]?.parameters;
  const paramsOf = (id: string, current?: Record<string, number>) => ({ ...mechanismById(id).parameters, ...(current ?? {}), ...(recorded(id) ?? {}) });
  const setParam = (id: string, base: Record<string, number>, k: string, v: number) => upd((x) => applyMechanisms(x, [id], { [id]: { ...base, [k]: v } }));
  const toggle = (id: string, on: boolean) => upd((x) => (on ? applyMechanisms(x, [id]) : stripMechanisms(x, [id])));
  const name = (id: string) => (lang === 'zh' ? mechanismById(id).name.zh : mechanismById(id).name.en);
  const editor = (id: string, on: boolean, current?: Record<string, number>, keys?: string[]) => {
    const p = paramsOf(id, current);
    return (
      <div key={id} className="rung">
        <label className="check"><input type="checkbox" checked={on} onChange={(e) => toggle(id, e.target.checked)} /><b style={{ whiteSpace: 'nowrap' }}>{id}</b>&nbsp;{name(id)}</label>
        {on && (
          <div className="form-grid" style={{ marginTop: 6 }}>
            {(keys ?? Object.keys(p)).map((k) => (
              <Field key={k} label={id === 'R-SDC' && k === 'recoverSeconds' ? t('scenario.sdcRecoverS') : LABEL[k] ? t(LABEL[k]) : k}><NumberInput value={p[k]} min={0} max={k === 'success' || k === 'coverage' || k === 'recall' || k === 'precision' ? 1 : undefined} step={stepOf(k)} onChange={(v) => setParam(id, p, k, v)} /></Field>
            ))}
          </div>
        )}
        {on && !recorded(id) && <div className="muted" style={{ fontSize: 11 }}>{t('mechanisms.handSet')}</div>}
      </div>
    );
  };
  const sdcDet = s.sdc.detection.coverage > 0;
  return (
    <div className="grid" style={{ gap: 12 }}>
      <section className="card">
        <header><div><h2>{t('scenario.sdcTitle')}</h2><div className="muted" style={{ fontSize: 12 }}>{anySdc ? t('scenario.sdcNote') : t('scenario.sdcNone')}</div></div></header>
        <div className="grid cols-2" style={{ gap: 12 }}>
          {editor('D-SDC', sdcDet, { coverage: s.sdc.detection.coverage, detectSeconds: s.sdc.detection.detectSeconds }, ['coverage', 'detectSeconds'])}
          {editor('R-SDC', !!s.sdc.stepRecovery, s.sdc.stepRecovery ? { stepSeconds: s.sdc.stepRecovery.stepSeconds, recoverSeconds: s.sdc.stepRecovery.recoverSeconds } : undefined, ['stepSeconds', 'recoverSeconds'])}
        </div>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label={t('scenario.sdcFallback')}><NumberInput value={s.sdc.fallbackDelayHours} min={0.001} onChange={(v) => upd((x) => ({ ...x, sdc: { ...x.sdc, fallbackDelayHours: v } }))} /></Field>
          <Field label={t('scenario.sdcTerminal')}>
            <Select value={s.sdc.terminalRule} onChange={(v) => upd((x) => ({ ...x, sdc: { ...x.sdc, terminalRule: v as Scenario['sdc']['terminalRule'] } }))} options={[{ value: 'retain-last-clean', label: t('scenario.sdcTerminalRetain') }, { value: 'discard-all', label: t('scenario.sdcTerminalDiscard') }]} />
          </Field>
        </div>
      </section>
      <section className="card">
        <header><div><h2>{t('scenario.mechTitle')}</h2><div className="muted" style={{ fontSize: 12 }}>{t('scenario.mechNote')}</div></div></header>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, fontSize: 12 }}>
          <span className="muted">{t('scenario.chainOrder')}:</span>
          {rungOrder(s.mechanisms.order).map((r, i, arr) => (
            <span key={r} className="btn small" style={{ cursor: 'default' }}>
              {i + 1}. {r}
              {i > 0 && (
                <button type="button" className="btn small" style={{ marginLeft: 4, padding: '0 4px' }} title={t('scenario.chainOrderHint')} onClick={() => { const next = [...arr]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; upd((x) => ({ ...x, mechanisms: { ...x.mechanisms, order: next.filter((q): q is 'replay' | 'hotswap' | 'elastic' | 'process' => q === 'replay' || q === 'hotswap' || q === 'elastic' || q === 'process') } })); }}>↑</button>
              )}
            </span>
          ))}
          <span className="muted" style={{ fontSize: 11 }}>{t('scenario.chainOrderHint')}</span>
        </div>
        <div className="grid cols-3" style={{ gap: 12 }}>
          {RUNGS.map((r) => editor(r.id, !!s.mechanisms[r.field], s.mechanisms[r.field] as Record<string, number> | undefined))}
        </div>
        {s.mechanisms.overheads && Object.keys(s.mechanisms.overheads).length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('scenario.mechOverheads')}: {Object.entries(s.mechanisms.overheads).map(([k, v]) => `${k} ${(v * 100).toFixed(1)} %`).join(' · ')} · {t('scenario.mechOverheadHint')}</div>
        )}
      </section>
    </div>
  );
}
