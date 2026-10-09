import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { allocateScenario, type AllocationMethod } from '@hac-d/core';
import { useActive, useLang } from '../hooks.js';
import { Kpi, Card, DataTable, Field, NumberInput, Select, Badge } from '../components/ui.js';
import { fmtPct, fmtDuration, fmtNum, fmtRatePerMillion, fmtHours } from '../lib/format.js';

const METHODS: AllocationMethod[] = ['arinc', 'agree', 'equal', 'feasibility', 'minimum-effort', 'cost-optimal'];

export function AllocationPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const active = useActive();
  const [method, setMethod] = useState<AllocationMethod>('arinc');
  const [goodputTarget, setGoodputTarget] = useState<number>(active?.scenario.targets.goodput ?? 0.97);
  const [availabilityTarget, setAvailabilityTarget] = useState<number>(active?.scenario.targets.availability ?? 0.999);
  const [restartShare, setRestartShare] = useState(0.5);
  const alloc = useMemo(() => {
    if (!active || active.error) return undefined;
    try {
      return allocateScenario(active.scenario, { goodputTarget, availabilityTarget, method, restartShare });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [active, goodputTarget, availabilityTarget, method, restartShare]);
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
          <Field label={t('scenario.availabilityTarget')}>
            <NumberInput value={availabilityTarget} step={0.0005} min={0.9} max={0.999999} onChange={setAvailabilityTarget} />
          </Field>
          <Field label={t('allocation.method')}>
            <Select value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: t(`allocation.methods.${m}`) }))} />
          </Field>
          {isTraining && (
            <Field label={t('allocation.restartShare')}>
              <NumberInput value={restartShare} step={0.05} min={0} max={1} onChange={setRestartShare} />
            </Field>
          )}
        </div>
        {alloc && 'error' in alloc && <div className="callout crit" style={{ marginTop: 8 }}>{alloc.error}</div>}
      </Card>
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
      {a?.unavailability && (
        <Card title={t('allocation.unavailTable')} sub={`A* = ${fmtPct(availabilityTarget, 3)} · ln A_i = (n_i/Σn) ln A*`} formula="U_i = 1 − A_i; λ_i = U_i / (MTTR_i (1 − U_i)); MTTR_i implied = U_i / (λ_i (1 − U_i))">
          <DataTable columns={[t('common.component'), 'A_i', 'U_i', 'λ allowed (aggregate /h)', 'λ allowed per unit (/1e6 h)', 'MTTR implied']} rows={a.unavailability.rows.map((r) => [r.name, fmtPct(r.availability, 5), fmtPct(r.unavailability, 4), r.lambdaAggregate !== undefined ? fmtNum(r.lambdaAggregate, 5) : '—', r.lambdaPerUnit !== undefined ? fmtRatePerMillion(r.lambdaPerUnit) : '—', r.mttrImplied !== undefined ? fmtHours(r.mttrImplied, lang) : '—'])} />
        </Card>
      )}
    </div>
  );
}
