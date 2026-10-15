/**
 * Types of the mechanism audit catalog (新可靠性机制库 · 单点收益量化审核, review 02, 2026-10-14): 16 mechanisms with their
 * principle, trigger, workflow, single-point quantification against the 342.5 s reference path and the four integration
 * fields that stay null until measured (eligible share of parent events, conditional success probability, failure-attempt
 * seconds, steady throughput overhead). The data is the user's deliverable, kept verbatim in packages/core/data/mechanism-audit.json.
 */
export interface AuditSource {
  title: string;
  url: string;
}
export interface AuditQuantification {
  metric: string;
  unit: 'seconds' | 'fraction' | 'FIT' | string;
  direction: 'decrease' | 'increase';
  before: number;
  after: number;
  improvement: number;
  saved: number | null;
  reductionFraction: number | null;
  range: Record<string, number>[];
}
export interface AuditIntegration {
  eligibleShareOfParentEvents: number | null;
  conditionalSuccessProbability: number | null;
  failureAttemptSeconds: number | null;
  steadyThroughputOverheadFraction: number | null;
  rateBasis: string;
  instructions: string;
}
export interface AuditCatalogMechanism {
  id: string;
  name: string;
  category: string;
  basis: string;
  scope: string;
  eventCandidates: string[];
  inputs: Record<string, number | number[] | null>;
  change: string;
  formula: string;
  evidence: string;
  prerequisite: string;
  failure: string;
  cost: string;
  overlap: string;
  acceptance: string;
  sourceIds: string[];
  lever: string;
  principle: string;
  trigger: { signal: string; gate: string; timing: string; owner: string };
  workflow: string[];
  successCriteria: string;
  doNotTrigger: string;
  observe: string[];
  origin: string;
  designStatus: string;
  quantification: AuditQuantification;
  quantitativeEvidence: string;
  simulationReady: boolean;
  integration: AuditIntegration;
  derived?: Record<string, unknown>;
}
export interface AuditCatalog {
  version: string;
  date: string;
  scope: string;
  baseline: { detectSeconds: number; recoverSeconds: number; rollbackSeconds: number; manualProbability: number; manualAdditionalSeconds: number; checkpointComputeSeconds: number; checkpointBlockSeconds: number; normalLossSeconds: number; expectedRecoverySeconds: number; expectedLossSeconds: number };
  startupBudgetAssumption: { startup: number; graphWithinStartup: number; otherWithinStartup: number; checkpointRead: number; communication: number; total: number; status: string };
  precisionContext: Record<string, unknown>;
  sdcRecoveryContract: Record<string, string | number>;
  sources: Record<string, AuditSource>;
  mechanisms: AuditCatalogMechanism[];
}

/** v3.7 baseline of the single-point audit, taken from the scenario (the audit's 12.5 / 180 / 150 s reference path for the catalog) */
export interface AuditBaseline {
  nGpus: number;
  windowH: number;
  /** detection delay T_det = p_d·t_auto + (1 − p_d)·t_timeout (s) */
  detectS: number;
  /** automatic recovery attempt (s, unscaled) and its stage budget */
  autoS: number;
  stages: { startup: number; graphWithinStartup: number; read: number; communication: number };
  /** probability that the automatic attempt fails and the manual fallback of `manualS` seconds follows */
  manualProbability: number;
  manualS: number;
  /** checkpoint compute interval, exposed save time and the mean rollback τ/2 (s) */
  tauS: number;
  deltaS: number;
  rollbackS: number;
  /** T_det + T_auto + W: the reference path when the automatic attempt succeeds */
  normalLossS: number;
  /** T_auto + p_manual·T_manual */
  expectedRecoveryS: number;
  /** T_det + expected recovery + W */
  expectedLossS: number;
  /** job-level immediate silent-corruption detection coverage and the silent FIT per card-hour of the scenario */
  sdcCoverage: number;
  sdcFitTotal: number;
  /** silent FIT per class id (card-hour equivalent) */
  sdcFitByClass: Record<string, number>;
  /** whether the recovery is the MTTR mixture (the audit's 口径); other recovery models carry the mixture-equivalent numbers */
  mixture: boolean;
}

/** v3.7 one mechanism's single-point quantification (the audit's 口径: one applicable, successfully handled event or one stage) */
export interface SinglePoint {
  metric: { zh: string; en: string };
  unit: 'seconds' | 'fraction' | 'FIT';
  direction: 'decrease' | 'increase';
  before: number;
  after: number;
  /** before − after (decrease) or after − before (increase) */
  improvement: number;
  /** improvement / before for decreases, undefined for fractions */
  reductionFraction?: number;
  formula: { zh: string; en: string };
  /** sensitivity: alternative targets and the resulting value */
  range?: { label: string; value: number }[];
  /** derived numbers worth showing (recovery before / after, break-even values) */
  derived?: Record<string, number>;
}
