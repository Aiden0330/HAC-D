/**
 * Applied records (docs/MODEL_REFERENCE.md §22.4): every library transform stores what it replaced so that removal is its
 * exact inverse and re-application replaces instead of compounding. v3.7 adds the keys of the audit mechanisms (custom rungs,
 * per-class applicability, per-class recovery stages, per-class silent-corruption coverage and rate factors, the durable lag).
 */
import type { Scenario } from '../scenario/schema.js';

export type Previous = Record<string, unknown>;
export type AppliedRecord = NonNullable<Scenario['mechanisms']['applied']>[string];

export const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
export const fromNull = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

/** Store the parameters used, the application order and the replaced values on the scenario. */
export function recordApplied(c: Scenario, id: string, parameters: Record<string, number>, previous: Previous): Scenario {
  const applied: Record<string, AppliedRecord> = { ...(c.mechanisms.applied ?? {}) };
  const order = Object.values(applied).reduce((a, r) => Math.max(a, r.order + 1), 0);
  applied[id] = { order, parameters: { ...parameters }, previous };
  c.mechanisms = { ...c.mechanisms, applied };
  return c;
}

/** Undo one record: replaced values are written back (null = the field was absent), multiplicative changes are divided out. */
export function restorePrevious(c: Scenario, prev: Previous): void {
  for (const [key, v] of Object.entries(prev)) {
    switch (key) {
      case 'workload.intervalS':
        if (c.workload.type === 'training') c.workload = { ...c.workload, intervalS: fromNull<number>(v) };
        break;
      case 'workload.deltaS':
        if (c.workload.type === 'training' && typeof v === 'number') c.workload = { ...c.workload, deltaS: v };
        break;
      case 'workload.intervalModel':
        // v5.9 C-YOUNG records the interval model it replaced
        if (c.workload.type === 'training' && typeof v === 'string') c.workload = { ...c.workload, intervalModel: v as Extract<Scenario['workload'], { type: 'training' }>['intervalModel'] };
        break;
      case 'recovery':
        c.recovery = v as Scenario['recovery'];
        break;
      case 'recovery.automatic.seconds':
        if (c.recovery.mode === 'mixture' && typeof v === 'number') c.recovery = { ...c.recovery, automatic: { ...c.recovery.automatic, seconds: v } };
        break;
      case 'recovery.detection':
        if (c.recovery.mode === 'mixture') c.recovery = { ...c.recovery, detection: v as Extract<Scenario['recovery'], { mode: 'mixture' }>['detection'] };
        break;
      case 'sdc.detection':
        c.sdc = { ...c.sdc, detection: v as Scenario['sdc']['detection'] };
        break;
      case 'sdc.stepRecovery':
        c.sdc = { ...c.sdc, stepRecovery: fromNull<Scenario['sdc']['stepRecovery']>(v) };
        break;
      case 'overheads':
        c.mechanisms = { ...c.mechanisms, overheads: fromNull<Record<string, number>>(v) };
        break;
      case 'mechanisms.replay':
      case 'mechanisms.process':
      case 'mechanisms.elastic':
      case 'mechanisms.predict':
      case 'mechanisms.netfail':
      case 'mechanisms.hotswap': {
        const m = { ...c.mechanisms } as Record<string, unknown>;
        m[key.slice('mechanisms.'.length)] = fromNull(v);
        c.mechanisms = m as Scenario['mechanisms'];
        break;
      }
      case 'rateFactor':
        if (typeof v === 'number' && v > 0) for (const comp of c.components) comp.failure = { ...comp.failure, value: comp.failure.value / v };
        break;
      case 'subhealthRateFactor':
        if (typeof v === 'number' && v > 0) for (const comp of c.components) if (comp.subhealth?.ratePerHour !== undefined) comp.subhealth = { ...comp.subhealth, ratePerHour: comp.subhealth.ratePerHour / v };
        break;
      case 'subhealthDurationFactor':
        if (typeof v === 'number' && v > 0) for (const comp of c.components) if (comp.subhealth) comp.subhealth = { ...comp.subhealth, durationHours: comp.subhealth.durationHours / v };
        break;
      case 'mechanisms.custom':
        c.mechanisms = { ...c.mechanisms, custom: fromNull<Record<string, NonNullable<Scenario['mechanisms']['custom']>[string]>>(v) };
        break;
      case 'componentCustom': {
        // per-class applicability of custom rungs: comp id → previous custom map (null = absent)
        const map = v as Record<string, Record<string, number> | null>;
        for (const comp of c.components) if (comp.id in map) comp.mechanisms = { ...(comp.mechanisms ?? {}), custom: fromNull<Record<string, number>>(map[comp.id]) };
        break;
      }
      case 'componentStages': {
        const map = v as Record<string, Scenario['components'][number]['recoveryStages'] | null>;
        for (const comp of c.components) if (comp.id in map) comp.recoveryStages = fromNull<Scenario['components'][number]['recoveryStages']>(map[comp.id]);
        break;
      }
      case 'componentSdc': {
        const map = v as Record<string, Scenario['components'][number]['sdc'] | null>;
        for (const comp of c.components) if (comp.id in map) comp.sdc = fromNull<Scenario['components'][number]['sdc']>(map[comp.id]);
        break;
      }
      case 'workload.rollbackLagS':
        if (c.workload.type === 'training') c.workload = { ...c.workload, rollbackLagS: fromNull<number>(v) };
        break;
      case 'subhealthDetection': {
        const map = v as Record<string, { policy: unknown; detection: unknown }>;
        for (const comp of c.components) {
          const p = map[comp.id];
          if (p && comp.subhealth) comp.subhealth = { ...comp.subhealth, policy: fromNull<'tolerate' | 'isolate'>(p.policy) ?? 'tolerate', detection: fromNull<NonNullable<typeof comp.subhealth>['detection']>(p.detection) };
        }
        break;
      }
    }
  }
}

