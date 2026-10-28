/**
 * v6.3 the Findings report from a scenario (apps/web Allocation › Report) equals the record path of `hacd findings`: on a record's
 * own scenario, reportFromScenario gives the budget document of budgetFromRecords and the study of archStudy (same seed, same
 * settings), the report preset's candidates, the record's layer rule, and the record's geometry for the figures. Small settings
 * (1,000 NPUs, 40 windows, 8 permutations) keep it fast; the identity does not depend on them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILTIN_TOPOLOGY_RECORDS } from '../src/records/topologyRecord.js';
import { DEFAULT_MECHANISM_SET, resolveMechanismSet } from '../src/records/mechanismSet.js';
import { budgetFromRecords, recordScenario } from '../src/budget/index.js';
import { archStudy } from '../src/study/archStudy.js';
import { reportFromScenario, reportCandidates, reportLayerSpec } from '../src/budget/report.js';
import { topologyScenario } from '../src/topology/index.js';
import { CORE_VERSION } from '../src/index.js';

const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const noDate = <T extends { generated?: string }>(o: T) => { const { generated: _g, ...rest } = o; return rest; };

describe('v6.3 reportFromScenario (the web app) = the record path (hacd findings)', () => {
  const rec = BUILTIN_TOPOLOGY_RECORDS.a3server, set = DEFAULT_MECHANISM_SET;
  const s = recordScenario(rec, set, 1000);
  const opts = { sizes: [1000], target: 0.985, trials: 40, seed: 1, permutations: 8 };
  const got = reportFromScenario(s, { id: rec.id, name: rec.name, short: rec.short, family: rec.family, assumed: rec.assumed, ...opts });

  it('the budget document equals budgetFromRecords (date aside)', () => {
    const want = budgetFromRecords([rec], set, opts);
    expect(noDate(json(got.results))).toEqual(noDate(json(want)));
  }, 300_000);
  it('the Shapley study equals archStudy (date aside)', () => {
    const want = archStudy(rec, set, { sizes: [1000], target: 0.985, permutations: 8, seed: 1 });
    expect(noDate(json(got.studies[rec.id]))).toEqual(noDate(json(want)));
  }, 300_000);
  it('the candidates are the report preset (the set’s candidates, none applied in the record scenario) and the layer rule is the record’s', () => {
    expect(reportCandidates(s)).toEqual(resolveMechanismSet(set).candidates);
    expect(reportLayerSpec(s)).toEqual(rec.layers);
    expect(reportLayerSpec(recordScenario(BUILTIN_TOPOLOGY_RECORDS.native950, set, 10000))).toEqual(BUILTIN_TOPOLOGY_RECORDS.native950.layers);
    expect(reportLayerSpec(recordScenario(BUILTIN_TOPOLOGY_RECORDS.cm384, set, 10000))).toEqual(BUILTIN_TOPOLOGY_RECORDS.cm384.layers);
  });
  it('the record geometry of the figures is the scenario’s (template, SuperPoD, scale-out) and the hierarchy names the set', () => {
    const r = got.records[rec.id];
    expect(r.template).toBe(rec.template);
    expect(r.superpod).toEqual(s.topology.superpod);
    expect(r.scaleOut).toEqual(s.topology.scaleOut);
    expect(got.mechanisms.source.set).toBe(set.id);
    expect(got.mechanisms.archs).toEqual([rec.id]);
  });
  it('refuses a template without a SuperPoD and a size list that misses the headline scale', () => {
    expect(() => reportFromScenario(topologyScenario('a2-roce', 1000), { id: 'x', name: { zh: 'x', en: 'x' }, short: { zh: 'x', en: 'x' }, ...opts })).toThrow(/SuperPoD/);
    expect(() => reportFromScenario(s, { id: 'x', name: rec.name, short: rec.short, sizes: [1000], main: 2000, target: 0.985 })).toThrow(/main 2000/);
  });
  it('CORE_VERSION is the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(CORE_VERSION).toBe(pkg.version);
  });
});
