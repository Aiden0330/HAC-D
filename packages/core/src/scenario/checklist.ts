/** The survey's 11-item design-review checklist (§6.8) applied to a scenario and its evaluation. */
import type { Scenario } from './schema.js';

export interface ChecklistItem {
  id: string;
  title: { zh: string; en: string };
  status: 'pass' | 'warn' | 'fail' | 'n/a';
  message: string;
}

export interface ChecklistContext {
  smallParameter?: number;
  restartRatio?: number;
  deltaS?: number;
  hasLoadStage: boolean;
  stageCount: number;
  hotSparesConfigured?: number;
  hotSparesRequired?: number;
  anyNonExponential: boolean;
  anyCcf: boolean;
  anyFailslow: boolean;
  monetised: boolean;
}

export function designReviewChecklist(s: Scenario, ctx: ChecklistContext): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const comps = s.components.filter((c) => c.enabled);

  const missingKoujing = comps.filter((c) => !c.failure.koujing).map((c) => c.id);
  items.push({
    id: 'koujing',
    title: { zh: '先定口径', en: 'Define the metric basis first' },
    status: missingKoujing.length === 0 ? 'pass' : 'warn',
    message: missingKoujing.length === 0 ? 'every failure rate declares event, denominator and level' : `no 口径 declared for: ${missingKoujing.join(', ')}`,
  });

  const assumed = comps.filter((c) => c.failure.provenance?.confidence === 'assumed').map((c) => c.id);
  const noProv = comps.filter((c) => !c.failure.provenance).map((c) => c.id);
  items.push({
    id: 'own-rates',
    title: { zh: '用自己集群的故障率', en: 'Use your own cluster\'s failure rates' },
    status: assumed.length ? 'warn' : noProv.length ? 'warn' : 'pass',
    message: assumed.length ? `assumed placeholder rates: ${assumed.join(', ')} — sweep them` : noProv.length ? `no provenance recorded for: ${noProv.join(', ')}` : 'all rates carry provenance; confirm they were measured on the target cluster',
  });

  if (ctx.deltaS !== undefined) {
    items.push({
      id: 'delta-exposed',
      title: { zh: 'δ 只计暴露时间，并保留两份以上快照', en: 'δ is the exposed save time only; keep ≥ 2 snapshots' },
      status: ctx.deltaS <= 60 ? 'pass' : 'warn',
      message: ctx.deltaS <= 60 ? `δ = ${ctx.deltaS.toFixed(2)} s is in the exposed-time range` : `δ = ${ctx.deltaS.toFixed(0)} s looks like an end-to-end save time; the model needs the blocking part only`,
    });
  }

  if (ctx.smallParameter !== undefined && ctx.restartRatio !== undefined) {
    const ok = ctx.smallParameter <= 0.1 && ctx.restartRatio <= 0.1;
    const bad = ctx.smallParameter > 0.3 || ctx.restartRatio > 0.3;
    items.push({
      id: 'first-order-validity',
      title: { zh: '检查 τ + δ ≪ M 且 R ≪ M', en: 'Check τ + δ ≪ M and R ≪ M' },
      status: ok ? 'pass' : bad ? 'fail' : 'warn',
      message: `(τ+δ)/M = ${ctx.smallParameter.toFixed(3)}, R/M = ${ctx.restartRatio.toFixed(3)}${bad ? ' — first-order model invalid; use the full Daly model and replica recovery' : ''}`,
    });
  }

  items.push({
    id: 'recovery-read',
    title: { zh: '单独核算恢复读带宽', en: 'Account for recovery read bandwidth separately' },
    status: ctx.hasLoadStage ? 'pass' : 'warn',
    message: ctx.hasLoadStage ? 'a checkpoint load stage is modelled' : 'no load stage in the recovery pipeline; loading is often minutes (Lablup 33 min, Epoch ≈ 5.1 min)',
  });

  if (ctx.hotSparesRequired !== undefined) {
    const ok = (ctx.hotSparesConfigured ?? 0) >= ctx.hotSparesRequired;
    items.push({
      id: 'spares-quantile',
      title: { zh: '备件按分位数算，不按比例', en: 'Size spares by quantile, not by ratio' },
      status: ok ? 'pass' : 'warn',
      message: `required at the configured quantile: ${ctx.hotSparesRequired}; configured: ${ctx.hotSparesConfigured ?? 0}`,
    });
  }

  items.push({
    id: 'spare-granularity',
    title: { zh: '备件粒度与故障域一致', en: 'Spare granularity matches the failure domain' },
    status: s.topology.nvlinkDomainGpus > s.topology.gpusPerNode ? 'warn' : 'pass',
    message: s.topology.nvlinkDomainGpus > s.topology.gpusPerNode ? `NVLink domain (${s.topology.nvlinkDomainGpus} GPU) exceeds the node (${s.topology.gpusPerNode} GPU): spares should be whole domains / racks` : 'failure domain equals the node',
  });

  items.push({
    id: 'mttr-staged',
    title: { zh: '把 MTTR 拆段测量', en: 'Measure MTTR stage by stage' },
    status: ctx.stageCount >= 3 ? 'pass' : 'warn',
    message: `${ctx.stageCount} recovery stage(s) modelled`,
  });

  items.push({
    id: 'assumptions',
    title: { zh: '核验独立与指数假设', en: 'Check the independence and exponential assumptions' },
    status: ctx.anyNonExponential || !ctx.anyCcf ? 'warn' : 'pass',
    message: [ctx.anyNonExponential ? 'non-exponential or heterogeneous inputs present: run Monte Carlo' : 'all lifetimes exponential', ctx.anyCcf ? 'β-factor CCF modelled' : 'no common-cause factor declared (β unknown in all public data; sweep β)'].join('; '),
  });

  items.push({
    id: 'failslow-sdc',
    title: { zh: '把 fail-slow 与 SDC 写进模型', en: 'Put fail-slow and SDC into the model' },
    status: ctx.anyFailslow ? 'pass' : 'warn',
    message: ctx.anyFailslow ? 'degraded (fail-slow) states modelled' : 'no fail-slow state: IBM power brake 3× slowdown, Alibaba 16/27 jobs affected',
  });

  items.push({
    id: 'monetise',
    title: { zh: '货币化后再比备机，并与仿真或实测交叉验证', en: 'Monetise before comparing options; cross-validate with simulation' },
    status: ctx.monetised ? 'pass' : 'warn',
    message: ctx.monetised ? 'costs attached; run the Monte Carlo cross-check before deciding' : 'no price per GPU-hour set',
  });
  return items;
}
