import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { allocateScenario, type AllocationMethod, type AllocationBasis, type LossBudgetMethod, type LedgerLossLine } from '@hac-d/core';
import { useActive, useLang } from '../hooks.js';
import { useStore, useActiveSettings, type ProjectSettings } from '../state/store.js';
import type { AllocationTab } from '../state/settings.js';
import { Kpi, Card, DataTable, Field, NumberInput, Select, Badge } from '../components/ui.js';
import { StrategyForm, StrategyPanel, CrossScalePanel, resolveStrategySettings, type StrategySettings } from '../panels/StrategyPanel.js';
import { fmtPct, fmtDuration, fmtNum, fmtRatePerMillion, fmtHours } from '../lib/format.js';

const METHODS: AllocationMethod[] = ['arinc', 'agree', 'equal', 'feasibility', 'minimum-effort', 'cost-optimal'];

type Tab = AllocationTab;

/**
 * v4 allocation page: the three strategies (optimal / MTTR-preferred / MTTF-preferred) with hardware FIT floors, mechanism candidates
 * and recovery limits; the same strategies across sizes; the classic budget methods (ARINC, AGREE, equal, feasibility, minimum
 * effort, cost optimal, loss and stage budgets). v5.1: the mechanism-only planner tab and the v3.7 allocation study panel are gone —
 * the strategies tab covers the planner's search (with levers and hardware on top) and the v5 CLI (hacd findings) produces the study.
 */
export function AllocationPage() {
  const { t } = useTranslation();
  const active = useActive();
  // v5.1 the tab and the strategy form are page settings of the active project; the form stays null (= defaultSettings of the
  // current scenario) until the user changes something
  const { tab, strategy: st } = useActiveSettings().allocation;
  const updateSettings = useStore((s) => s.updateActiveSettings);
  const setTab = (k: Tab) => updateSettings({ allocation: { tab: k } });
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const settings = resolveStrategySettings(active.scenario, st);
  const set = (f: (x: StrategySettings) => StrategySettings) => updateSettings((x) => ({ ...x, allocation: { ...x.allocation, strategy: f(resolveStrategySettings(active.scenario, x.allocation.strategy)) } }));
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('allocation.title')}</h1>
        <span className="sub">{t('allocation.subV4')}</span>
      </div>
      <div className="tabs" role="tablist">
        {(['strategies', 'cross', 'classic'] as Tab[]).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`allocation.tab_${k}`)}</button>)}
      </div>
      {(tab === 'strategies' || tab === 'cross') && <StrategyForm s={active.scenario} st={settings} set={set} />}
      {tab === 'strategies' && <StrategyPanel s={active.scenario} st={settings} />}
      {tab === 'cross' && <CrossScalePanel s={active.scenario} st={settings} />}
      {tab === 'classic' && <ClassicAllocation />}
    </div>
  );
}

/** the v3 budget methods (unchanged) */
function ClassicAllocation() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const updateActive = useStore((st) => st.updateActive);
  // v5.1 the classic inputs are page settings of the active project (null targets / basis = the scenario's defaults)
  const cs = useActiveSettings().allocation.classic;
  const updateSettings = useStore((s) => s.updateActiveSettings);
  type C = ProjectSettings['allocation']['classic'];
  const setC = <K extends keyof C>(k: K) => (v: C[K] | ((prev: C[K]) => C[K])) => updateSettings((x) => { const cur = x.allocation.classic; return { ...x, allocation: { ...x.allocation, classic: { ...cur, [k]: typeof v === 'function' ? (v as (p: C[K]) => C[K])(cur[k]) : v } } }; });
  const { method, restartShare, lossMethod } = cs;
  const lossWeights = cs.lossWeights as Partial<Record<LedgerLossLine, number>>;
  const goodputTarget = cs.goodputTarget ?? active?.scenario.targets.goodput ?? 0.97;
  const availabilityTarget = cs.availabilityTarget ?? active?.scenario.targets.availability ?? 0.999;
  const setMethod = setC('method');
  const setGoodputTarget = setC('goodputTarget');
  const setAvailabilityTarget = setC('availabilityTarget');
  const setRestartShare = setC('restartShare');
  const setBasis = setC('basis');
  const setLossMethod = setC('lossMethod');
  const setLossWeights = setC('lossWeights');
  const hasSdc = !!active?.result?.training?.sdc;
  const basis: AllocationBasis = cs.basis ?? (hasSdc ? 'delivered' : 'effective');
  const alloc = useMemo(() => {
    if (!active || active.error) return undefined;
    try {
      return allocateScenario(active.scenario, { goodputTarget, availabilityTarget, method, restartShare, basis, lossMethod, lossWeights });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [active, goodputTarget, availabilityTarget, method, restartShare, basis, lossMethod, lossWeights]);
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const isTraining = active.scenario.workload.type === 'training';
  const a = alloc && !('error' in alloc) ? alloc : undefined;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="muted" style={{ fontSize: 12 }}>{t('allocation.sub')}</div>
      <Card>
        <div className="form-grid">
          {isTraining && (
            <Field label={t('allocation.target')}>
              <NumberInput value={goodputTarget} step={0.005} min={0.5} max={0.9999} onChange={setGoodputTarget} />
            </Field>
          )}
          {isTraining && hasSdc && (
            <Field label={t('allocation.basis')}>
              <Select value={basis} onChange={setBasis} options={[{ value: 'delivered', label: t('allocation.basisDelivered') }, { value: 'effective', label: t('allocation.basisEffective') }]} />
            </Field>
          )}
          <Field label={t('scenario.availabilityTarget')}>
            <NumberInput value={availabilityTarget} step={0.0005} min={0.9} max={0.999999} onChange={setAvailabilityTarget} />
          </Field>
          <Field label={t('allocation.method')} hint={t(`allocation.methodUses.${method}`)}>
            <Select value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: t(`allocation.methods.${m}`) }))} />
          </Field>
          {isTraining && (
            <Field label={t('allocation.restartShare')}>
              <NumberInput value={restartShare} step={0.05} min={0} max={1} onChange={setRestartShare} />
            </Field>
          )}
        </div>
        {alloc && 'error' in alloc && <div className="callout crit" style={{ marginTop: 8 }}>{alloc.error}</div>}
        {a && a.coincide && a.coincide.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}>{t('allocation.coincide')} {a.coincide.map((m) => t(`allocation.methods.${m}`)).join(' · ')}</div>}
        {isTraining && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('allocation.methodHint')}</div>}
      </Card>
      {a?.sdc && (
        <Card title={t('allocation.sdcTitle')} formula="delivered = effective × f_SDC; effective target = G_d / f_SDC; headline target = effective target / (φ_job (1 − P_blocked)(1 − ℓ)); q* and D* by bisection on the closed form">
          <div className={`callout${a.sdc.feasibleByHardware ? '' : ' warn'}`} style={{ marginBottom: 10 }}>{a.sdc.feasibleByHardware ? t('allocation.feasible') : t('allocation.infeasible')}</div>
          <div className="kpi-row">
            <Kpi label={t('allocation.currentDelivered')} value={fmtPct(a.sdc.currentDelivered, 2)} note={`${t('allocation.factor')} ${fmtNum(a.sdc.factor, 4)} · ${t('allocation.maxByHardware')} ${fmtPct(a.sdc.maxDeliveredByHardware, 2)}`} tone={a.sdc.currentDelivered < a.sdc.deliveredTarget ? 'warn' : undefined} />
            <Kpi label={t('allocation.requiredCoverage')} value={a.sdc.requiredCoverage !== undefined ? fmtPct(a.sdc.requiredCoverage, 2) : t('allocation.notReachable')} note={`${t('allocation.coverageUsed')} ${fmtPct(a.sdc.coverageUsed, 2)}`} hero={!a.sdc.feasibleByHardware} />
            <Kpi label={t('allocation.requiredFallback')} value={a.sdc.requiredFallbackDelayH !== undefined ? fmtHours(a.sdc.requiredFallbackDelayH, lang) : t('allocation.notReachable')} />
            <Kpi label={t('allocation.effectiveTarget')} value={fmtPct(a.sdc.effectiveTarget, 2)} note={`${t('allocation.headlineTarget')} ${fmtPct(a.sdc.headlineTarget, 2)}`} />
          </div>
        </Card>
      )}
      {a?.lossBudget && (() => {
        const lb = a.lossBudget;
        return (
          <Card title={t('allocation.lossTitle')} sub={t('allocation.lossSub')} formula="allowed_i = (1 − G*) × w_i, Σ w_i = 1; excess_i = current_i − allowed_i; current_i from the closed-form window ledger">
            <div className="form-grid">
              <Field label={t('allocation.lossMethod')}>
                <Select value={lossMethod} onChange={(v) => setLossMethod(v as LossBudgetMethod)} options={[{ value: 'proportional', label: t('allocation.lossProportional') }, { value: 'equal', label: t('allocation.lossEqual') }, { value: 'custom', label: t('allocation.lossCustom') }]} />
              </Field>
              <Kpi label={t('allocation.lossTotal')} value={`${fmtPct(lb.totalAllowed, 2)} · ${fmtNum(lb.totalAllowedHours, 1)} h`} note={`${t('allocation.lossCurrentTotal')} ${fmtPct(lb.totalCurrent, 2)} · ${fmtNum(lb.totalCurrentHours, 1)} h / ${lb.windowHours} h`} tone={lb.totalCurrent > lb.totalAllowed ? 'warn' : undefined} />
            </div>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('allocation.lossLine')}</th>
                    <th>{t('allocation.lossCurrent')}</th>
                    <th>{t('allocation.lossWeight')}</th>
                    <th>{t('allocation.lossAllowed')}</th>
                    <th>{t('allocation.lossExcess')}</th>
                    <th>{t('allocation.lossLever')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lb.rows.map((r) => (
                    <tr key={r.line}>
                      <td style={{ whiteSpace: 'nowrap' }}>{t(`training.ledger_${r.line}`, { defaultValue: r.line })}</td>
                      <td className="num">{fmtPct(r.current, 2)} · {fmtNum(r.currentHours, 1)} h</td>
                      <td className="num">{lossMethod === 'custom' ? <NumberInput value={lossWeights[r.line] ?? Number(r.weight.toFixed(3))} min={0} step={0.05} onChange={(v) => setLossWeights((w) => ({ ...w, [r.line]: v }))} /> : fmtPct(r.weight, 1)}</td>
                      <td className="num">{fmtPct(r.allowed, 2)} · {fmtNum(r.allowedHours, 1)} h</td>
                      <td className="num">{r.excess > 1e-9 ? <b>+{(r.excess * 100).toFixed(2)} pt · {fmtNum(r.excessHours, 1)} h</b> : `${(r.excess * 100).toFixed(2)} pt · ${fmtNum(r.excessHours, 1)} h`}</td>
                      <td style={{ fontSize: 11, minWidth: 220 }}>{lang === 'zh' ? t(`allocation.lever_${r.line}`) : r.lever}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="plain muted" style={{ fontSize: 12, marginTop: 6 }}>
              {lb.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>
        );
      })()}
      {a?.goodput && (
        <>
          <div className="kpi-row">
            <Kpi label={t('allocation.lossBudget')} value={fmtPct(a.goodput.lossBudget, 2)} note={`${t('allocation.current')} ${fmtPct(a.goodput.current.loss, 2)}`} tone={a.goodput.current.loss > a.goodput.lossBudget ? 'warn' : undefined} />
            <Kpi label={`${t('allocation.fixR')}: ${t('allocation.requiredMtbi')}`} value={fmtDuration(a.goodput.fixRecovery.requiredMtbiS, lang)} note={`${t('allocation.requiredRate')} ${fmtRatePerMillion(a.goodput.fixRecovery.requiredLambdaPerGpuHour)} /1e6 NPU·h · ${t('allocation.improvement')}${fmtNum(a.goodput.fixRecovery.improvementFactor, 2)}`} />
            <Kpi label={`${t('allocation.fixLambda')}: ${t('allocation.requiredR')}`} value={a.goodput.fixRate.requiredRecoveryS > 0 ? fmtDuration(a.goodput.fixRate.requiredRecoveryS, lang) : '—'} note={a.goodput.fixRate.requiredRecoveryS > 0 ? `${t('allocation.improvement')}${fmtNum(a.goodput.fixRate.improvementFactor, 2)}` : 'infeasible: checkpoint term alone exceeds the budget'} tone={a.goodput.fixRate.requiredRecoveryS > 0 ? undefined : 'bad'} />
            <Kpi label={t('allocation.balanced')} value={`${fmtDuration(a.goodput.balanced.mtbiS, lang)} · ${fmtDuration(a.goodput.balanced.recoveryS, lang)}`} note={`MTBI · R at restart share ${fmtPct(a.goodput.balanced.restartShare, 0)}`} />
          </div>
          {a.notes.length > 0 && (
            <div className="callout">
              <ul className="plain">
                {a.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="grid cols-2">
        {a?.rateAllocation && (
          <Card title={t('allocation.rateTable')} sub={`${t(`allocation.methods.${method}`)} · λ* = ${fmtNum(a.rateAllocation.lambdaSystem, 4)} /h`} formula="Σ_i λ_i* = λ*; per unit = λ_i*/n_i; improvement = current/allocated">
            <DataTable
              columns={[t('common.component'), 'n', t('allocation.currentAgg'), t('allocation.allocated'), t('allocation.perUnit'), t('allocation.mtbfPerUnit'), t('allocation.improvement'), t('allocation.feasibility')]}
              rows={a.rateAllocation.rows.map((r) => [r.name, r.count, r.currentAggregate !== undefined ? fmtNum(r.currentAggregate, 4) : '—', fmtNum(r.lambdaAggregate, 4), fmtRatePerMillion(r.lambdaPerUnit), fmtHours(r.mtbfPerUnit, lang), r.improvementFactor !== undefined ? `×${fmtNum(r.improvementFactor, 2)}` : '—', <Badge key="f" status={r.feasibility === 'ok' ? 'pass' : r.feasibility === 'unknown' ? 'warn' : 'fail'}>{r.feasibility}</Badge>])}
            />
            {a.rateAllocation.notes.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{a.rateAllocation.notes.join(' · ')}</div>}
          </Card>
        )}
        {a?.stageAllocation && (
          <Card title={t('allocation.stageTable')} formula="budget_i = floor_i + share_i × (R* − Σ floors), share ∝ current stage time">
            <DataTable columns={[t('training.stage'), 'current', 'budget', t('allocation.improvement')]} rows={a.stageAllocation.map((s) => [s.name, fmtDuration(s.currentS, lang), fmtDuration(s.budgetS, lang), `×${fmtNum(s.improvementFactor, 2)}`])} />
          </Card>
        )}
      </div>
      {isTraining && (
        <Card title={t('allocation.weightsTitle')} sub={t('allocation.weightsSub')}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>{t('common.component')}</th><th>{t('allocation.wCount')}</th><th>{t('allocation.wImportance')}</th><th>{t('allocation.wFeasibility')}</th><th>{t('allocation.wCostA')}</th><th>{t('allocation.wCostB')}</th><th>{t('allocation.wFixed')}</th></tr>
              </thead>
              <tbody>
                {active.scenario.components.filter((c) => c.enabled).map((c) => {
                  const w = c.allocation ?? {};
                  const row = active.result.components.find((r) => r.id === c.id);
                  const set = (patch: Partial<NonNullable<typeof c.allocation>>) => updateActive((sc) => ({ ...sc, components: sc.components.map((q) => (q.id === c.id ? { ...q, allocation: { ...(q.allocation ?? {}), ...patch } } : q)) }));
                  return (
                    <tr key={c.id}>
                      <td>{c.name?.en ?? c.name?.zh ?? c.id}</td>
                      <td className="num">{row ? row.count.toLocaleString('en-US') : '—'}</td>
                      <td><NumberInput value={w.importance ?? 1} min={0.01} max={1} step={0.05} onChange={(v) => set({ importance: v })} /></td>
                      <td><NumberInput value={w.feasibilityWeight ?? (c.failure.provenance?.confidence === 'assumed' ? 2 : 1)} min={0.01} step={0.5} onChange={(v) => set({ feasibilityWeight: v })} /></td>
                      <td><NumberInput value={w.costA ?? 1} min={0.01} step={0.5} onChange={(v) => set({ costA: v })} /></td>
                      <td><NumberInput value={w.costB ?? 1} min={0.1} step={0.5} onChange={(v) => set({ costB: v })} /></td>
                      <td><input type="checkbox" checked={!!w.fixed} onChange={(e) => set({ fixed: e.target.checked })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {a?.unavailability && (
        <Card title={t('allocation.unavailTable')} sub={`A* = ${fmtPct(availabilityTarget, 3)} · ln A_i = (n_i/Σn) ln A*`} formula="U_i = 1 − A_i; λ_i = U_i / (MTTR_i (1 − U_i)); MTTR_i implied = U_i / (λ_i (1 − U_i))">
          <DataTable columns={[t('common.component'), 'A_i', 'U_i', 'λ allowed (aggregate /h)', 'λ allowed per unit (/1e6 h)', 'MTTR implied']} rows={a.unavailability.rows.map((r) => [r.name, fmtPct(r.availability, 5), fmtPct(r.unavailability, 4), r.lambdaAggregate !== undefined ? fmtNum(r.lambdaAggregate, 5) : '—', r.lambdaPerUnit !== undefined ? fmtRatePerMillion(r.lambdaPerUnit) : '—', r.mttrImplied !== undefined ? fmtHours(r.mttrImplied, lang) : '—'])} />
        </Card>
      )}
    </div>
  );
}
