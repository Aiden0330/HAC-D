/**
 * v3.7: the 16 audited mechanisms (single-point values against the audit's own JSON, provisional integration, exact removal,
 * same-stage minimum rule, closed form vs ledger simulation with custom rungs / per-class stages / durable lag / per-class
 * SDC coverage) and the cross-scale allocation study.
 */
import { describe, it, expect } from 'vitest';
import { referenceCatalog } from '../src/scenario/examples.js';
import { evaluateScenario, automaticStages } from '../src/scenario/evaluate.js';
import { auditMechanisms, AUDIT_CATALOG, AUDIT_MECHANISM_DEFS, applyMechanisms, stripMechanisms, provisionalParameters, integrationStatus, mechanismById, MECHANISM_LIBRARY } from '../src/index.js';
import { buildLedgerRun, simulateLedgerReplications } from '../src/mc/ledgerFromScenario.js';
import { summaryStat } from '../src/math/stats.js';
import { allocationStudy } from '../src/study/index.js';
import { auditReportHtml } from '../src/report/auditReport.js';
import { studyReportHtml } from '../src/report/studyReport.js';

const catalog = () => referenceCatalog(100000);
const auditedIds = AUDIT_MECHANISM_DEFS.map((m) => m.id);
const withApply = AUDIT_MECHANISM_DEFS.filter((m) => m.apply).map((m) => m.id);

describe('v3.7 mechanism audit', () => {
  it('reproduces the audit JSON single-point before / after of all 16 mechanisms on the reference catalog', () => {
    const rep = auditMechanisms(catalog(), { ids: auditedIds, cluster: false });
    expect(rep.baseline.normalLossS).toBeCloseTo(AUDIT_CATALOG.baseline.normalLossSeconds, 6);
    expect(rep.baseline.expectedLossS).toBeCloseTo(AUDIT_CATALOG.baseline.expectedLossSeconds, 6);
    expect(rep.baseline.stages).toEqual({ startup: 60, graphWithinStartup: 30, read: 60, communication: 60 });
    for (const m of AUDIT_CATALOG.mechanisms) {
      const row = rep.rows.find((r) => r.id === m.id)!;
      expect(row.singlePoint, m.id).toBeDefined();
      expect(row.singlePoint!.before, `${m.id} before`).toBeCloseTo(m.quantification.before, 2);
      expect(row.singlePoint!.after, `${m.id} after`).toBeCloseTo(m.quantification.after, 2);
    }
    expect(rep.rows.length).toBe(16);
  });
  it('keeps the audited mechanisms audit-only until their integration fields are given, and the provisional switch fills them', () => {
    const s = catalog();
    const link = mechanismById('R-LINK-LOCAL');
    expect(integrationStatus(link, link.parameters).ready).toBe(false);
    expect(JSON.stringify(applyMechanisms(s, ['R-LINK-LOCAL']))).toBe(JSON.stringify(s));
    const prov = provisionalParameters(['R-LINK-LOCAL', 'C-ASYNC']);
    expect(prov['R-LINK-LOCAL']).toEqual({ eligibleShare: 1, success: 0.9, failureSeconds: 10, overhead: 0 });
    expect(prov['C-ASYNC']).toBeUndefined();
    const applied = applyMechanisms(s, ['R-LINK-LOCAL'], prov);
    expect(applied.mechanisms.custom?.['R-LINK-LOCAL']).toMatchObject({ success: 0.9, successSeconds: 2, failureSeconds: 10, rollback: false, detectionDelay: false });
    expect(applied.components.find((c) => c.id === 'NIC-hard')!.mechanisms!.custom!['R-LINK-LOCAL']).toBe(1);
    expect(applied.components.find((c) => c.id === 'CORE-hard')!.mechanisms!.custom).toBeUndefined();
    const t = evaluateScenario(applied, { structure: false }).training!;
    expect(t.operationalAvailability).toBeGreaterThan(evaluateScenario(s, { structure: false }).training!.operationalAvailability);
    expect(t.chain.rows.find((r) => r.id === 'NIC-hard')!.pCustom['R-LINK-LOCAL']).toBeCloseTo(0.9, 9);
    const rep = auditMechanisms(s, { ids: ['R-LINK-LOCAL', 'I-CONTAIN'], provisional: true });
    expect(rep.rows[0].integration.provisional).toBe(true);
    expect(rep.rows[0].cluster!.aOp).toBeGreaterThan(0);
    expect(rep.rows[1].clusterReady).toBe(false);
  });
  it('removes the audited mechanisms exactly (apply then strip returns the original scenario)', () => {
    const s = catalog();
    const ids = ['R-ELASTIC', ...withApply];
    const applied = applyMechanisms(s, ids, provisionalParameters(withApply));
    expect(Object.keys(applied.mechanisms.applied ?? {}).length).toBe(ids.length);
    expect(JSON.stringify(stripMechanisms(applied, ids))).toBe(JSON.stringify(s));
    // re-application replaces instead of compounding (the applied records are renumbered, the model state is identical)
    const twice = applyMechanisms(applied, ['R-WARM-PROCESS', 'C-ASYNC'], provisionalParameters(withApply));
    const state = (x: typeof applied) => JSON.stringify({ components: x.components.map((c) => [c.id, c.recoveryStages, c.mechanisms?.custom, c.sdc]), workload: x.workload, recovery: x.recovery, custom: x.mechanisms.custom, elastic: x.mechanisms.elastic, overheads: x.mechanisms.overheads });
    expect(state(twice)).toBe(state(applied));
    expect(evaluateScenario(twice, { structure: false }).training!.deliveredGoodput).toBeCloseTo(evaluateScenario(applied, { structure: false }).training!.deliveredGoodput, 12);
  });
  it('applies the same-stage minimum rule: warm process, runtime snapshot and graph caches do not add up on the startup stage', () => {
    const s = catalog();
    const prov = provisionalParameters(withApply);
    const one = applyMechanisms(s, ['R-WARM-PROCESS'], prov);
    expect(one.components.find((c) => c.id === 'UNKNOWN-hard')!.recoveryStages).toEqual({ startup: 20 });
    const three = applyMechanisms(s, ['R-WARM-PROCESS', 'R-RUNTIME-SNAPSHOT', 'R-CANN-GRAPH'], prov);
    expect(three.components.find((c) => c.id === 'UNKNOWN-hard')!.recoveryStages).toEqual({ startup: 15 });
    expect(three.components.find((c) => c.id === 'MODULE-hard')!.recoveryStages).toEqual({ startup: 15 });
    expect(three.components.find((c) => c.id === 'CPU-hard')!.recoveryStages).toEqual({ startup: 15 });
    expect(three.components.find((c) => c.id === 'POWER-hard')!.recoveryStages).toBeUndefined();
    // the class with the shorter startup gets a shorter global recovery in the closed form
    const t = evaluateScenario(three, { structure: false }).training!;
    const unknown = t.chain.rows.find((r) => r.id === 'UNKNOWN-hard')!;
    const power = t.chain.rows.find((r) => r.id === 'POWER-hard')!;
    expect(power.meanPauseS - unknown.meanPauseS).toBeCloseTo(45, 6);
    // C-MEM removes the read stage; lossless compression adds nothing on top
    const mem = applyMechanisms(s, ['C-MEM', 'C-LOSSLESS'], prov);
    if (mem.recovery.mode !== 'mixture') throw new Error('mixture expected');
    expect(mem.recovery.automatic.seconds).toBe(120);
    expect(automaticStages(mem.recovery).read).toBe(0);
    expect(JSON.stringify(stripMechanisms(mem, ['C-MEM', 'C-LOSSLESS']))).toBe(JSON.stringify(s));
  });
  it('raises per-class silent-corruption coverage on the residual misses and rate-weights it into the job-level coverage', () => {
    const s = catalog();
    const prov = provisionalParameters(withApply);
    const fp = applyMechanisms(s, ['D-SDC-FP8', 'D-ABFT'], prov);
    const core = fp.components.find((c) => c.id === 'CORE-sdc')!;
    // FP8 path: 1/3 risk share × 95 % as a conditional detector on q = 0 → 0.3167; ABFT catches 90 % of the remaining misses
    expect(core.sdc!.extraDetection!['D-SDC-FP8']).toBeCloseTo(0.95 / 3, 12);
    expect(core.sdc!.extraDetection!['D-ABFT']).toBeCloseTo(0.9, 12);
    const coreCoverage = 1 - (1 - 0.95 / 3) * (1 - 0.9);
    expect(coreCoverage).toBeCloseTo(0.95 / 3 + (1 - 0.95 / 3) * 0.9, 12);
    const t = evaluateScenario(fp, { structure: false }).training!;
    const coreFit = 41.06280193236715, total = 48.30917874396136;
    expect(t.sdc!.coverage).toBeCloseTo((coreCoverage * coreFit) / total, 6);
    expect(t.deliveredGoodput).toBeGreaterThan(evaluateScenario(s, { structure: false }).training!.deliveredGoodput + 0.1);
    const screen = applyMechanisms(s, ['H-SDC-SCREEN'], prov);
    expect(evaluateScenario(screen, { structure: false }).training!.sdc!.ratePerHour).toBeCloseTo(evaluateScenario(s, { structure: false }).training!.sdc!.ratePerHour * 0.75, 9);
  });
  it('agrees with the ledger simulation when custom rungs, per-class stages, the durable lag and per-class coverage are all active', () => {
    const s = applyMechanisms(catalog(), ['R-LINK-LOCAL', 'R-FABRIC-DEGRADE', 'R-WARM-PROCESS', 'R-RUNTIME-SNAPSHOT', 'C-ASYNC', 'D-NET-SDC', 'D-SDC-FP8', 'H-SDC-SCREEN', 'D-RECOVERY-CLASSIFY', 'C-LOSSLESS'], provisionalParameters(withApply));
    const t = evaluateScenario(s, { structure: false }).training!;
    const run = buildLedgerRun(s, { trials: 150, seed: 7 });
    const rows = simulateLedgerReplications(run.spec, 0, 150, 7);
    const a = summaryStat(rows.map((r) => r.operationalAvailability));
    const d = summaryStat(rows.map((r) => r.delivered));
    expect(Math.abs(a.mean - t.operationalAvailability)).toBeLessThan(3 * a.ci95 + 2e-4);
    expect(Math.abs(d.mean - t.deliveredGoodput)).toBeLessThan(3 * d.ci95 + 5e-3);
    expect(rows.reduce((x, r) => x + r.counts.custom, 0)).toBeGreaterThan(0);
    for (const r of rows) {
      const l = r.ledger;
      expect(Math.abs(r.correctH / r.horizonH + l.downtime / r.horizonH + l.save / r.horizonH + l.slowdown / r.horizonH + l.rollback / r.horizonH + l.terminalInvalid / r.horizonH + l.localLoss / r.horizonH + l.overhead / r.horizonH - 1)).toBeLessThan(1e-9);
    }
  });
  it('renders the standalone audit report with one article per mechanism and the embedded JSON', () => {
    const rep = auditMechanisms(catalog(), { ids: ['R-REPLAY', 'R-LINK-LOCAL', 'C-ASYNC'], provisional: true });
    const html = auditReportHtml(rep, 'zh');
    expect(html).toContain('<article id="R-LINK-LOCAL">');
    expect((html.match(/<article /g) ?? []).length).toBe(3);
    expect(html).toContain('id="audit-data"');
    expect(html).toContain('342.5');
    expect(auditReportHtml(rep, 'en')).toContain('Link-transparent recovery');
  });
  it('library: 35 entries, the audited ones carry their catalog text and events', () => {
    expect(MECHANISM_LIBRARY.length).toBe(35);
    for (const m of AUDIT_MECHANISM_DEFS) {
      expect(m.audit?.id).toBe(m.id);
      expect(m.audit?.principle.length).toBeGreaterThan(10);
    }
  });
});

describe('v3.7 allocation study', () => {
  it('runs the cross-scale study on the catalog (A_op 98.5 %): 10k feasible without mechanisms, 100k with R-ELASTIC alone', () => {
    const r = allocationStudy(referenceCatalog(100000), { sizes: [10000, 100000], target: 0.985, players: ['R-REPLAY', 'R-ELASTIC', 'C-MEM', 'H-LEMON'], trials: 20, curves: true, curveGrid: [5000, 20000, 100000, 300000], levers: true });
    expect(r.sizes).toEqual([10000, 100000]);
    const s10 = r.perSize[10000], s100 = r.perSize[100000];
    expect(s10.baseline.aOp).toBeCloseTo(0.99748, 4);
    expect(s10.plan.feasible).toBe(true);
    expect(s10.plan.ids).toEqual([]);
    expect(s10.hardwareOnly.factor).toBeGreaterThan(6);
    expect(s100.baseline.aOp).toBeCloseTo(0.97548, 4);
    expect(s100.plan.feasible).toBe(true);
    expect(s100.plan.ids).toEqual(['R-ELASTIC']);
    expect(s100.plan.method).toBe('exact');
    expect(s100.hardwareOnly.factor).toBeCloseTo(0.5956, 3);
    expect(s100.recoveryOnly.recoveryStarS).toBeCloseTo(160.3, 0);
    expect(s100.hardwareOnly.minimumEffort!.rows.filter((x) => x.improvementFactor > 1.0001).length).toBe(13);
    expect(s100.residualFactor.plan).toBeCloseTo(1.66, 2);
    expect(s100.gains.find((g) => g.id === 'R-ELASTIC')!.byMetric.aOp.single).toBeCloseTo(0.01518, 4);
    expect(s100.attribution.method).toBe('exact');
    expect(s100.verification!.trials).toBe(20);
    expect(s100.levers!.find((l) => l.id === 'all3')!.value).toBeGreaterThan(s100.planned.value);
    expect(Object.keys(r.curves)).toContain('baseline');
    expect(r.curves.baseline.maxN).toBeGreaterThan(55000);
    expect(r.curves.baseline.maxN).toBeLessThan(66000);
    const groups = Object.values(s100.planned.byGroup).reduce((a, b) => a + b, 0);
    expect(groups).toBeCloseTo(1 - s100.planned.aOp, 6);
  });
  it('renders the study report with three charts, tables and conclusions in both languages', () => {
    const r = allocationStudy(referenceCatalog(100000), { sizes: [10000, 100000], target: 0.985, players: ['R-REPLAY', 'R-ELASTIC', 'C-MEM'], trials: 0, curves: true, curveGrid: [5000, 20000, 100000, 300000], levers: true });
    const html = studyReportHtml(r, 'zh');
    expect(html).toContain('id="chart-aop"');
    expect(html).toContain('id="chart-unavail"');
    expect(html).toContain('id="chart-shapley"');
    expect(html).toContain('id="study-data"');
    expect(html).toContain('R-ELASTIC');
    expect(studyReportHtml(r, 'en')).toContain('Reliability allocation for a 98.5 % operational availability A_op target');
    const d = allocationStudy(referenceCatalog(50000), { sizes: [50000], metric: 'delivered', target: 0.9, players: ['D-SDC', 'R-SDC', 'C-FAST'], trials: 0, curves: false, levers: false });
    expect(d.perSize[50000].plan.feasible).toBe(true);
    expect(studyReportHtml(d, 'zh')).toContain('正确交付');
  });
  it('falls back to greedy selection and sampled Shapley when more than 10 / 12 candidates are given', () => {
    const players = ['D-HARD', 'R-REPLAY', 'R-NETFAIL', 'R-HOTSWAP', 'R-ELASTIC', 'R-PROCESS', 'P-PREDICT', 'C-MEM', 'H-LEMON', 'H-SWEEP', 'C-FAST', 'R-LINK-LOCAL', 'C-ASYNC', 'D-RECOVERY-CLASSIFY'];
    const r = allocationStudy(referenceCatalog(100000), { sizes: [200000], target: 0.985, players, provisional: true, trials: 0, curves: false, levers: false, permutations: 30 });
    const z = r.perSize[200000];
    expect(z.plan.method).toBe('greedy');
    expect(z.plan.feasible).toBe(true);
    expect(z.plan.nominal).toBeGreaterThanOrEqual(0.985);
    expect(z.attribution.method).toBe('sampled');
    expect(z.gains.length).toBe(players.length);
    expect(z.gains.find((g) => g.id === 'R-LINK-LOCAL')!.byMetric.aOp.single).toBeGreaterThan(0);
    expect(z.gains.every((g) => typeof g.halfWidth === 'number')).toBe(true);
  });
});
