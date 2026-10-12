import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { allocateScenario, type AllocationMethod, type AllocationBasis } from '@hac-d/core';
import { useActive, useLang } from '../hooks.js';
import { useStore } from '../state/store.js';
import { Kpi, Card, DataTable, Field, NumberInput, Select, Badge } from '../components/ui.js';
import { fmtPct, fmtDuration, fmtNum, fmtRatePerMillion, fmtHours } from '../lib/format.js';

const METHODS: AllocationMethod[] = ['arinc', 'agree', 'equal', 'feasibility', 'minimum-effort', 'cost-optimal'];

export function AllocationPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const updateActive = useStore((st) => st.updateActive);
  const [method, setMethod] = useState<AllocationMethod>('arinc');
  const [goodputTarget, setGoodputTarget] = useState<number>(active?.scenario.targets.goodput ?? 0.97);
  const [availabilityTarget, setAvailabilityTarget] = useState<number>(active?.scenario.targets.availability ?? 0.999);
  const [restartShare, setRestartShare] = useState(0.5);
  const hasSdc = !!active?.result?.training?.sdc;
  const [basisChoice, setBasis] = useState<AllocationBasis | undefined>(undefined);
  const basis: AllocationBasis = basisChoice ?? (hasSdc ? 'delivered' : 'effective');
  const alloc = useMemo(() => {
    if (!active || active.error) return undefined;
    try {
      return allocateScenario(active.scenario, { goodputTarget, availabilityTarget, method, restartShare, basis });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [active, goodputTarget, availabilityTarget, method, restartShare, basis]);
  if (!active || active.error) return <div className="callout crit">{active?.error ?? 'No scenario'}</div>;
  const isTraining = active.scenario.workload.type === 'training';
  const a = alloc && !('error' in alloc) ? alloc : undefined;
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('allocation.title')}</h1>
        <span className="sub">{t('allocation.sub')}</span>
      </div>
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
      {a?.goodput && (
        <>
          <div className="kpi-row">
            <Kpi label={t('allocation.lossBudget')} value={fmtPct(a.goodput.lossBudget, 2)} note={`${t('allocation.current')} ${fmtPct(a.goodput.current.loss, 2)}`} tone={a.goodput.current.loss > a.goodput.lossBudget ? 'warn' : undefined} />
            <Kpi label={`${t('allocation.fixR')}: ${t('allocation.requiredMtbi')}`} value={fmtDuration(a.goodput.fixRecovery.requiredMtbiS, lang)} note={`${t('allocation.requiredRate')} ${fmtRatePerMillion(a.goodput.fixRecovery.requiredLambdaPerGpuHour)} /1e6 GPU·h · ${t('allocation.improvement')}${fmtNum(a.goodput.fixRecovery.improvementFactor, 2)}`} />
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
