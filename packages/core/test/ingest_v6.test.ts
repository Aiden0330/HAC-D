/**
 * v6 ingest primitives (docs/markdown/PLAN_V6_INPUT_MIGRATION.md). The normaliser is pinned by golden_v6.json, computed
 * independently in Python (compute_golden_v6.py) from the formulas of MODEL_REFERENCE.md §26; do not edit expected values by hand.
 * The other tests cover the confidence policy, evidence grounding and agreement, the validation gates on the public records and on
 * synthetic faults, the delta and the extension requests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeFaultRates, deviceFit, SOURCE_CONFIDENCE, groundCard, agreeCards, parseNumberText, parseEvidenceCard,
  validateInputs, validateTopologyRecord, validateFaultRateOverride, validateMechanismSet, validateId, countIssues, hasErrors,
  diffRecords, diffRates, diffSets, flatten, provenanceFor, deltaDocument, kpiRow,
  mechanismProposalRequest, extensionRequestFromError, extensionRequestMarkdown, parseMechanismProposal,
  fieldSpecs, vocabularies, mechanismParameterKeys, classIds, mechanismIds, GEOMETRY_FIELDS, SCALEOUT_FIELDS,
  BUILTIN_TOPOLOGY_RECORDS, DEFAULT_MECHANISM_SET, parseTopologyRecord, parseFaultRateOverride, MECHANISM_LIBRARY, budgetFromRecords,
  type DeviceFitTable, type KoujingMapping, type EvidenceCard, type TopologyRecord, type FaultRateOverride, type MechanismSet,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden', 'golden_v6.json'), 'utf8')) as {
  cases: { id: string; inputs: { devices: DeviceFitTable['rows']; mapping: KoujingMapping['rows'] }; expected: { deviceFit: Record<string, number>; classFit: Record<string, number>; afrFirstOrderFit: Record<string, number> } }[];
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
const a960e = parseTopologyRecord(JSON.parse(readFileSync(join(here, '..', 'data', 'records', 'a960e.json'), 'utf8'))) as TopologyRecord;
const remap = parseFaultRateOverride(JSON.parse(readFileSync(join(here, '..', 'data', 'fault-rates', 'remap-per-card-2026-10-09.json'), 'utf8'))) as FaultRateOverride;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('G7 口径 normaliser against the Python golden', () => {
  for (const c of golden.cases) {
    it(c.id, () => {
      const table: DeviceFitTable = { id: `t-${c.id}`, rows: c.inputs.devices };
      const mapping: KoujingMapping = { id: `m-${c.id}`, rows: c.inputs.mapping };
      const { override, report } = normalizeFaultRates(table, mapping, { id: `o-${c.id}` });
      for (const [cls, fit] of Object.entries(c.expected.classFit)) expect(rel(override.rates[cls].fit, fit)).toBeLessThan(1e-9);
      expect(Object.keys(override.rates).sort()).toEqual(Object.keys(c.expected.classFit).sort());
      for (const r of c.inputs.devices) expect(rel(deviceFit(r), c.expected.deviceFit[r.device])).toBeLessThan(1e-9);
      for (const [dev, fo] of Object.entries(c.expected.afrFirstOrderFit)) { const exact = c.expected.deviceFit[dev]; expect(exact).toBeGreaterThan(fo); expect(rel(exact, fo)).toBeLessThan(0.02); }
      expect(override.basis).toBe('per-unit');
      expect(report.unmappedDevices).toEqual([]);
      for (const e of Object.values(override.rates)) { expect(e.derivation).toMatch(/FIT per [\w-]+-hour, business-impact, class/); expect(e.source).toContain('口径 mapping'); }
    });
  }
  it('confidence policy: pass-through keeps the source type, arithmetic is derived, an assumption makes it assumed', () => {
    const t = golden.cases.find((c) => c.id === 'G7a-pass-through')!;
    const o = normalizeFaultRates({ id: 't', rows: t.inputs.devices }, { id: 'm', rows: t.inputs.mapping }, { id: 'o' }).override;
    expect(o.rates['DDR-hard'].confidence).toBe(SOURCE_CONFIDENCE.vendor);
    const b = golden.cases.find((c) => c.id === 'G7b-two-devices-one-class')!;
    expect(normalizeFaultRates({ id: 't', rows: b.inputs.devices }, { id: 'm', rows: b.inputs.mapping }, { id: 'o' }).override.rates['DDR-hard'].confidence).toBe('assumed');
    const c = golden.cases.find((c) => c.id === 'G7c-afr-and-mtbf')!;
    const oc = normalizeFaultRates({ id: 't', rows: c.inputs.devices }, { id: 'm', rows: c.inputs.mapping }, { id: 'o' }).override;
    expect(oc.rates['SSD-hard'].confidence).toBe('derived');
    expect(oc.rates['POWER-hard'].confidence).toBe('derived');
  });
  it('refuses an unmapped device, an unknown class and a unit mismatch', () => {
    const rows = golden.cases[0].inputs.devices;
    expect(() => normalizeFaultRates({ id: 't', rows }, { id: 'm', rows: [{ device: 'other', unit: 'node', class: 'DDR-hard', devicesPerUnit: 1, impactFactor: 1, impactBasis: 'x', impactConfidence: 'measured' }] }, { id: 'o' })).toThrow(/without a mapping row/);
    expect(() => normalizeFaultRates({ id: 't', rows }, { id: 'm', rows: [{ device: rows[0].device, unit: 'node', class: 'XYZ-hard', devicesPerUnit: 1, impactFactor: 1, impactBasis: 'x', impactConfidence: 'measured' }] }, { id: 'o' })).toThrow(/not in the unit library/);
    expect(() => normalizeFaultRates({ id: 't', rows }, { id: 'm', rows: [{ device: rows[0].device, unit: 'npu', class: 'DDR-hard', devicesPerUnit: 1, impactFactor: 1, impactBasis: 'x', impactConfidence: 'measured' }] }, { id: 'o' })).toThrow(/belongs to unit 'node'/);
    expect(() => normalizeFaultRates({ id: 't', rows: [{ device: 'd', value: 1.2, unit: 'afr', source: 's', sourceType: 'field' }] }, { id: 'm', rows: [{ device: 'd', unit: 'node', class: 'DDR-hard', devicesPerUnit: 1, impactFactor: 1, impactBasis: 'x', impactConfidence: 'measured' }] }, { id: 'o' })).toThrow(/AFR/);
  });
});

describe('evidence cards', () => {
  const chunk = '3.2 节点配置\n每节点配置 8 张卡，2 颗鲲鹏 CPU；每柜 8 个托盘。\nThe pod has 16 compute cabinets and 4 UB cabinets.';
  const card = (over: Partial<EvidenceCard>): EvidenceCard => parseEvidenceCard({ doc: 'd.pdf', loc: 'p.12', field: 'superpod.npusPerNode', value_text: '8', unit_text: '卡', quote: '每节点配置 8 张卡', model_confidence: 'high', ...over });
  it('grounding accepts a verbatim quote containing the value and rejects everything else', () => {
    expect(groundCard(card({}), chunk)).toEqual({ ok: true });
    expect(groundCard(card({ quote: '每节点配置  8 张卡' }), chunk).ok).toBe(true);
    expect(groundCard(card({ quote: 'the pod has 16 COMPUTE cabinets', value_text: '16', field: 'superpod.computeRacks' }), chunk).ok).toBe(true);
    expect(groundCard(card({ quote: '每节点配置 16 张卡', value_text: '16' }), chunk).reason).toBe('quote-not-in-chunk');
    expect(groundCard(card({ value_text: '9' }), chunk).reason).toBe('value-not-in-quote');
    expect(groundCard(card({ quote: 'x'.repeat(401) }), 'x'.repeat(500)).reason).toBe('quote-too-long');
  });
  it('agreement needs both passes to give the same value and unit; the lower confidence survives', () => {
    const a = [card({}), card({ field: 'superpod.cpusPerNode', value_text: '2', quote: '2 颗鲲鹏 CPU', unit_text: '' })];
    const b = [card({ model_confidence: 'low' }), card({ field: 'superpod.cpusPerNode', value_text: '4', quote: '2 颗鲲鹏 CPU', unit_text: '' }), card({ field: 'superpod.computeRacks', value_text: '16', quote: '16 compute cabinets' })];
    const r = agreeCards(a, b);
    expect(r.agreed.map((c) => c.field)).toEqual(['superpod.npusPerNode']);
    expect(r.agreed[0].model_confidence).toBe('low');
    expect(r.disputed.map((d) => [d.key, d.reason])).toEqual([['superpod.cpusPerNode', 'value-differs'], ['superpod.computeRacks', 'only-in-b']]);
  });
  it('parses numbers as written', () => {
    expect(parseNumberText('1,024')).toBe(1024);
    expect(parseNumberText('１０２４')).toBe(1024);
    expect(parseNumberText('1.6 万')).toBe(16000);
    expect(parseNumberText('2k')).toBe(2000);
    expect(parseNumberText('8 张')).toBeNull();
    expect(parseNumberText('95%')).toBeNull();
  });
  it('the card schema is strict', () => {
    expect(() => parseEvidenceCard({ doc: 'd', field: 'f', value_text: '1', quote: '1', extra: 1 })).toThrow(/invalid evidence card/);
  });
});

describe('validation gates', () => {
  const records = { ...BUILTIN_TOPOLOGY_RECORDS, a960e };
  it('the public records, the default set and the ReMAP override pass without errors', () => {
    for (const r of Object.values(records)) expect(validateTopologyRecord(r).filter((i) => i.level === 'error')).toEqual([]);
    expect(validateMechanismSet(DEFAULT_MECHANISM_SET).filter((i) => i.level === 'error')).toEqual([]);
    expect(validateFaultRateOverride(remap).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('every parameter key the library transforms read is declared (parameters, provisional, integrationNeeds, reads)', () => {
    for (const m of MECHANISM_LIBRARY) {
      if (!m.apply) continue;
      const src = m.apply.toString();
      const read = new Set([...src.matchAll(/num\(p,\s*["'](\w+)["']\)/g)].map((x) => x[1]).concat([...src.matchAll(/\bp\.([a-zA-Z_]\w*)/g)].map((x) => x[1])));
      const declared = mechanismParameterKeys(m.id);
      expect([...read].filter((k) => !declared.includes(k)), m.id).toEqual([]);
    }
  });
  it('flags a misspelt parameter key, a layer mismatch, an unknown class, an implausible rate and an id collision', () => {
    const s = clone(DEFAULT_MECHANISM_SET) as MechanismSet;
    s.parameters['R-REPLAY'] = { ...(s.parameters['R-REPLAY'] ?? {}), coverge: 0.9 };
    expect(validateMechanismSet(s).filter((i) => i.code === 'unknown-parameter').map((i) => i.path)).toEqual(['parameters.R-REPLAY.coverge']);
    const r = clone(BUILTIN_TOPOLOGY_RECORDS.native950) as TopologyRecord;
    r.layers.cabinet.npus = 32;
    expect(validateTopologyRecord(r).some((i) => i.code === 'layer-mismatch' && i.path === 'layers.cabinet.npus')).toBe(true);
    const o: FaultRateOverride = { id: 'x', basis: 'per-unit', rates: { 'DDR-hard': { fit: 1e6, source: 's', confidence: 'derived' }, 'NOPE-hard': { fit: 1, source: 's', confidence: 'assumed' } } };
    const issues = validateFaultRateOverride(o);
    expect(issues.find((i) => i.code === 'unknown-class')?.path).toBe('rates.NOPE-hard');
    expect(issues.find((i) => i.code === 'implausible')?.path).toBe('rates.DDR-hard.fit');
    expect(issues.find((i) => i.code === 'derivation-missing')?.path).toBe('rates.DDR-hard');
    expect(validateId('record', 'native950', ['native950']).map((i) => i.code)).toEqual(['id-collision']);
    expect(validateId('record', 'internal-x', ['native950'], ['internal-x']).map((i) => i.code)).toEqual(['id-exists']);
    const all = validateInputs({ record: r, rates: o, set: s }, { publicIds: { records: ['native950'] } });
    expect(hasErrors(all)).toBe(true);
    expect(countIssues(all).error).toBeGreaterThanOrEqual(4);
    expect(all.every((i) => /^(record|override|set)\./.test(i.path))).toBe(true);
  });
  it('field specs and vocabularies come from the schemas', () => {
    const t = fieldSpecs('topology');
    expect(t.find((f) => f.path === 'superpod.npusPerNode')?.type).toBe('int');
    expect(t.find((f) => f.path === 'superpod.podUplinksPerNpu')?.type).toBe('number');
    expect(t.find((f) => f.path === 'superpod.fabric')?.values).toContain('mesh-clos');
    expect(GEOMETRY_FIELDS).toContain('computeRacks');
    expect(SCALEOUT_FIELDS).toEqual(['portsPerNpu', 'planes', 'radix', 'oversubscription', 'transceiversPerLink']);
    expect(classIds()).toHaveLength(60);
    expect(mechanismIds()).toContain('R-LINK-LOCAL');
    expect(vocabularies().confidence).toContain('scan-level');
    expect(fieldSpecs('mechanisms').some((f) => f.path === 'parameters.R-LINK-LOCAL.success')).toBe(true);
  });
});

describe('delta', () => {
  it('diffs records with the new record\'s provenance, rates on one basis, and sets without metadata noise', () => {
    const a = BUILTIN_TOPOLOGY_RECORDS.native950, b = clone(a) as TopologyRecord;
    b.id = 'internal-950'; b.superpod = { ...b.superpod, rackSwitches: 80 }; b.provenance = { ...b.provenance, 'superpod.rackSwitches': { source: 'internal design note', confidence: 'vendor' } };
    const d = diffRecords(a, b);
    const rs = d.find((c) => c.path === 'superpod.rackSwitches');
    expect(rs?.kind).toBe('added'); expect(rs?.source).toBe('internal design note'); expect(rs?.confidence).toBe('vendor');
    const b2 = clone(a) as TopologyRecord; b2.scaleOut = { ...b2.scaleOut, planes: 8 };
    expect(diffRecords(a, b2).find((c) => c.path === 'scaleOut.planes')).toMatchObject({ kind: 'changed', before: a.scaleOut.planes, after: 8, source: a.provenance.scaleOut.source });
    expect(d.some((c) => c.path.startsWith('provenance'))).toBe(false);
    expect(d.find((c) => c.path === 'id')?.after).toBe('internal-950');
    const o2 = clone(remap) as FaultRateOverride; o2.id = 'r2'; o2.rates['DDR-hard'] = { ...o2.rates['DDR-hard'], fit: o2.rates['DDR-hard'].fit * 2, confidence: 'measured', source: 'field' };
    const rd = diffRates(remap, o2);
    expect(rd).toHaveLength(1); expect(rd[0].class).toBe('DDR-hard'); expect(rd[0].ratio).toBeCloseTo(2, 9); expect(rd[0].confidence).toBe('measured');
    const s2 = clone(DEFAULT_MECHANISM_SET) as MechanismSet; s2.id = 's2'; s2.parameters['R-LINK-LOCAL'] = { ...s2.parameters['R-LINK-LOCAL'], success: 0.99 };
    const sd = diffSets(DEFAULT_MECHANISM_SET, s2);
    expect(sd.map((c) => c.path).sort()).toEqual(['id', 'parameters.R-LINK-LOCAL.success']);
    expect(provenanceFor({ superpod: { source: 'g', confidence: 'vendor' }, 'superpod.rackSwitches': { source: 'f', confidence: 'derived' } }, 'superpod.rackSwitches')?.source).toBe('f');
    expect(provenanceFor({ superpod: { source: 'g', confidence: 'vendor' } }, 'superpod.cpusPerNode')?.source).toBe('g');
    expect([...flatten({ a: [1, { b: 2 }], c: {} }).keys()]).toEqual(['a[0]', 'a[1].b', 'c']);
  });
  it('the KPI rows are the engine\'s budget numbers and the delta is their difference', () => {
    const rec = BUILTIN_TOPOLOGY_RECORDS.a3server, set = DEFAULT_MECHANISM_SET;
    const o2 = clone(remap) as FaultRateOverride; o2.id = 'half';
    for (const e of Object.values(o2.rates)) e.fit *= 0.5;
    const doc = deltaDocument({ record: rec, set, rates: remap }, { record: rec, set, rates: o2 }, { scales: [10000], target: 0.985, trials: 40, seed: 1, generated: '2026-10-22' });
    const direct = budgetFromRecords([rec], set, { sizes: [10000], target: 0.985, trials: 40, seed: 1, rates: o2 }).archs[rec.id].sizes['10000'];
    const row = kpiRow(direct, 10000);
    expect(doc.kpi.after[0]).toEqual(row);
    expect(doc.kpi.before![0].aOp).toBeLessThan(doc.kpi.after[0].aOp);
    expect(doc.kpi.delta![0].dAop).toBeCloseTo(doc.kpi.after[0].aOp - doc.kpi.before![0].aOp, 12);
    expect(doc.kpi.delta![0].mtbfRatio).toBeGreaterThan(1.5);
    expect(doc.changes.rates.length).toBe(Object.values(remap.rates).filter((e) => e.fit > 0).length);
    expect(doc.before.rates?.id).toBe(remap.id); expect(doc.after.rates?.id).toBe('half');
    expect(doc.generated).toBe('2026-10-22');
  }, 180_000);
});

describe('extension requests', () => {
  it('a proposal without mapsTo becomes a mechanism request; loader errors become stubs', () => {
    const p = parseMechanismProposal({ id: 'p1', name: { zh: '新机制', en: 'New mechanism' }, kind: 'recover', stage: 'rung', deploy: 'node', acts: ['node', 'npu'], effect: [{ quantity: 'pause', direction: 'down', value: 3, unit: 's', source: 's', confidence: 'vendor' }] });
    const r = mechanismProposalRequest(p, { requestedAt: '2026-10-22', source: 'review' });
    expect(r.kind).toBe('mechanism'); expect(r.id).toBe('mechanism-p1'); expect(r.payload).toMatchObject({ stage: 'rung', deploy: 'node' });
    const md = extensionRequestMarkdown(r, 'en');
    expect(md).toContain('# New mechanism: New mechanism'); expect(md).toContain('MechanismDef');
    const t = extensionRequestFromError("unknown topology template 'a970-ub' (known: a2-roce, …); a new hardware unit kind needs two extension points", { id: 'x', requestedAt: '2026-10-22', source: 'ws' });
    expect(t?.kind).toBe('template'); expect(t?.payload.name).toBe('a970-ub');
    expect(extensionRequestFromError("unknown fault unit 'npo-module' (known: npu, job)", { id: 'x', requestedAt: 'd', source: 's' })?.kind).toBe('unit');
    expect(extensionRequestFromError('some other error', { id: 'x', requestedAt: 'd', source: 's' })).toBeNull();
  });
});
