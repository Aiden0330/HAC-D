/**
 * Worksheet templates (`hacd ingest template <kind>`): a complete example of each kind that parses as it is — built from public
 * records and synthetic values, never from internal data — followed by a notes section with the closed vocabularies. People edit the
 * example; a third-party model is given the same text as the shape of what it must produce.
 */
import { BUILTIN_TOPOLOGY_RECORDS, DEFAULT_MECHANISM_SET, vocabularies, fieldSpecs, WORKSHEET_VERSION, type WorksheetKind, type TopologyRecord, type MechanismSet, type DeviceFitTable, type KoujingMapping, type MechanismProposal, type FaultRateOverride } from '@hac-d/core';
import { topologyRecordToWorksheet } from './topology.js';
import { faultRateOverrideToWorksheet, deviceTableToWorksheet, mappingToWorksheet } from './faultRates.js';
import { mechanismSetToWorksheet, proposalToWorksheet } from './mechanisms.js';

const notes = (kind: WorksheetKind, extra: string[] = []): string => {
  const v = vocabularies();
  const lines = ['## notes', '', `Worksheet profile ${WORKSHEET_VERSION}. The parser is strict: fixed table headers, one value per cell, \`\\|\` for a literal pipe; a blank value cell means "not stated". Closed vocabularies:`, ''];
  const list = (name: string, xs: readonly string[]) => lines.push(`- ${name}: ${xs.join(', ')}`);
  list('confidence', v.confidence);
  if (kind === 'topology') { list('template', v.template); list('preset (geometry base)', v.preset); list('fabric', v.fabric); list('count rows', v.countRow); lines.push(`- geometry fields: ${fieldSpecs('topology').filter((f) => f.path.startsWith('superpod.') && f.path !== 'superpod.base').map((f) => f.path.slice(9)).join(', ')}`); }
  if (kind === 'fault-rates' || kind === 'koujing-mapping') { list('fault unit', v.faultUnit); lines.push(`- class ids (${v.classId.length}): ${v.classId.join(', ')}`); }
  if (kind === 'device-fit') { list('unit', v.deviceRateUnit); list('sourceType', v.sourceType); }
  if (kind === 'koujing-mapping') list('impactConfidence', v.impactConfidence);
  if (kind === 'mechanisms' || kind === 'mechanism-proposal') { list('verdict', v.verdict); list('layer', v.layer); list('stage', v.stage); list('mechanism kind', v.mechanismKind); lines.push(`- mechanism ids: ${v.mechanismId.join(', ')}`); }
  lines.push(...extra.map((e) => `- ${e}`), '');
  return lines.join('\n');
};

export const EXAMPLE_DEVICE_TABLE: DeviceFitTable = {
  id: 'example-device-fit', source: 'synthetic example (no internal data)',
  rows: [
    { device: 'DDR5 DIMM 64G', value: 30, unit: 'FIT', source: 'FIT-DB', loc: 'tbl_mem row 17', sourceType: 'vendor' },
    { device: 'VRM', value: 0.02, unit: 'per_1e6_h', source: 'FIT-DB', loc: 'tbl_power row 3', sourceType: 'prediction' },
    { device: 'PSU 3kW', value: 2000000, unit: 'mtbf_h', source: 'PSU datasheet', sourceType: 'vendor' },
    { device: 'NVMe SSD', value: 0.0144, unit: 'afr', source: 'field returns 2025H2', sourceType: 'field' },
  ],
};
export const EXAMPLE_MAPPING: KoujingMapping = {
  id: 'example-koujing-mapping', version: '2026-10-22', source: 'synthetic example (no internal data)',
  rows: [
    { device: 'DDR5 DIMM 64G', unit: 'node', class: 'DDR-hard', devicesPerUnit: 8, impactFactor: 0.5, impactBasis: 'ECC-corrected share from field 2025H1', impactConfidence: 'derived' },
    { device: 'VRM', unit: 'node', class: 'DDR-hard', devicesPerUnit: 2, impactFactor: 0.25, impactBasis: 'FMEA', impactConfidence: 'assumed' },
    { device: 'PSU 3kW', unit: 'cabinet', class: 'POWER-hard', devicesPerUnit: 2, impactFactor: 0.1, impactBasis: 'N+1 redundancy, double fault', impactConfidence: 'derived' },
    { device: 'NVMe SSD', unit: 'node', class: 'SSD-hard', devicesPerUnit: 2, impactFactor: 0.9, impactBasis: 'field ratio', impactConfidence: 'measured' },
  ],
};
export const EXAMPLE_PROPOSAL: MechanismProposal = {
  id: 'example-proposal', name: { zh: '链路级快速重传', en: 'Link-level fast retransmission' }, kind: 'recover', stage: 'rung', deploy: 'superpod', acts: ['superpod', 'npu'], mapsTo: 'R-LINK-LOCAL',
  effect: [{ quantity: 'transient link fault pause', direction: 'down', value: 2, unit: 's', source: 'design review DR-2026-031 §3.2', confidence: 'vendor' }],
  parameters: [{ parameter: 'successSeconds', value: 2, source: 'DR-2026-031 §3.2', confidence: 'vendor' }, { parameter: 'success', value: 0.95, source: 'DR-2026-031 table 4', confidence: 'assumed', note: 'target, not measured' }],
  prerequisites: [{ zh: '通信事务幂等；有界重试', en: 'idempotent communication transactions; bounded retries' }],
  failureModes: [{ zh: '重试失败回落到既有链', en: 'a failed retry falls back to the existing chain' }],
  evidence: [{ doc: 'DR-2026-031.pdf', loc: 'p.12 §3.2', field: 'parameters.R-LINK-LOCAL.successSeconds', value_text: '2', unit_text: 's', quote: 'link recovery completes within 2 s without rollback', model_confidence: 'high' }],
  source: 'synthetic example (no internal data)',
};
const exampleRecord = (): TopologyRecord => ({ ...BUILTIN_TOPOLOGY_RECORDS.native950, id: 'internal-example-950', scenarioId: 'internal-example-950', name: { zh: '内部示例拓扑', en: 'Internal example topology' }, short: { zh: '示例', en: 'example' } });
const exampleRates = (): FaultRateOverride => ({
  id: 'example-fault-rates', basis: 'per-unit', source: 'synthetic example (no internal data)',
  rates: {
    'DDR-hard': { unit: 'node', fit: 130, source: 'FIT-DB tbl_mem row 17; 口径 mapping example', confidence: 'assumed', derivation: 'DDR5 DIMM 30 FIT × 8 per node × 0.5 + VRM 20 FIT × 2 × 0.25 = 130 FIT per node-hour' },
    'POWER-hard': { unit: 'cabinet', fit: 100, source: 'PSU datasheet; 口径 mapping example', confidence: 'derived', derivation: '10⁹ / 2,000,000 h = 500 FIT × 2 per cabinet × 0.1 = 100 FIT per cabinet-hour' },
  },
});
const exampleDelta = (): MechanismSet => {
  const s = JSON.parse(JSON.stringify(DEFAULT_MECHANISM_SET)) as MechanismSet;
  s.id = 'example-mechanisms-delta';
  s.parameters['R-LINK-LOCAL'] = { ...s.parameters['R-LINK-LOCAL'], successSeconds: 2, success: 0.95 };
  s.provenance = { ...s.provenance, 'parameters.R-LINK-LOCAL.success': { source: 'DR-2026-031 table 4', confidence: 'assumed', note: 'target, not measured' } };
  return s;
};

/** the example worksheet of a kind, with the vocabularies appended */
export function worksheetTemplate(kind: WorksheetKind): string {
  switch (kind) {
    case 'topology': return topologyRecordToWorksheet(exampleRecord(), 'Topology worksheet — example (edit every value; blank value = not stated)') + notes(kind, ['the example is the public Atlas 950 record under an internal id: replace the id, names, geometry and provenance with yours']);
    case 'fault-rates': return faultRateOverrideToWorksheet(exampleRates(), 'Fault-rate worksheet — example') + notes(kind, ['fit is business-impact FIT per unit-hour (basis per-unit) or per card-hour (per-card), never device FIT: use device-fit + koujing-mapping and `hacd ingest normalize` to get here from device rates']);
    case 'mechanisms': return mechanismSetToWorksheet(exampleDelta(), DEFAULT_MECHANISM_SET, 'Mechanism set delta — example over the default set') + notes(kind, ['a delta lists only what changes; parameter keys must be ones the mechanism reads (hacd ingest validate checks)']);
    case 'mechanism-proposal': return proposalToWorksheet(EXAMPLE_PROPOSAL, 'Mechanism proposal — example') + notes(kind, ['with mapsTo the proposal becomes a set delta; without it an extension request for the HAC-D side']);
    case 'device-fit': return deviceTableToWorksheet(EXAMPLE_DEVICE_TABLE, 'Device table — example') + notes(kind, ['values stay as written; the normaliser converts (FIT, per 10⁶ h, per h, MTBF h, AFR)']);
    case 'koujing-mapping': return mappingToWorksheet(EXAMPLE_MAPPING, '口径 mapping — example') + notes(kind, ['one row per device × class; impactFactor = share of the device\'s failures that become a business-impact event of the class after the existing protection']);
  }
}
