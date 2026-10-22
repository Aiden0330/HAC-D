/**
 * v5 overlay schematic of a topology record: topoGeomFromRecord reproduces the built-in TOPO_GEOM entries from the four records
 * (superpod resolved over the preset, scale-out tiers from the 500k counts of the v4.4 data), falls back to generic labels without
 * a `schematic` block, and refuses an unresolved superpod.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILTIN_TOPOLOGY_RECORDS, recordSuperpod, parseTopologyRecord } from '../../core/src/records/topologyRecord.ts';
import { TOPO_GEOM, topoGeomFromRecord, drawLayer } from '../src/index.mjs';

const R = JSON.parse(readFileSync(new URL('../../../docs/backup/ascend-allocation/results.json', import.meta.url), 'utf8'));
const resolved = (r) => ({ ...r, superpod: recordSuperpod(r) });

describe('topoGeomFromRecord', () => {
  for (const [id, rec] of Object.entries(BUILTIN_TOPOLOGY_RECORDS)) {
    it(`${id} equals TOPO_GEOM.${id}`, () => {
      expect(topoGeomFromRecord(resolved(rec), R.archs[id].sizes[String(R.main)].counts)).toEqual(TOPO_GEOM[id]);
    });
  }
  it('draws the same schematic from the geometry object as from the id', () => {
    const g = topoGeomFromRecord(resolved(BUILTIN_TOPOLOGY_RECORDS.cm384), R.archs.cm384.sizes['500000'].counts);
    const T = (zh, en) => en;
    for (const l of ['cluster', 'scaleout', 'superpod', 'cabinet', 'node', 'npu']) expect(drawLayer(g, l, 0, 0, 150, 110, T)).toEqual(drawLayer('cm384', l, 0, 0, 150, 110, T));
  });
  it('a record without schematic labels gets the generic ones; the a960e data record resolves', () => {
    const a = parseTopologyRecord(JSON.parse(readFileSync(new URL('../../core/data/records/a960e.json', import.meta.url), 'utf8')));
    const { schematic: _s, ...bare } = a;
    const g = topoGeomFromRecord(resolved(bare), { scaleOutTiers: 2 });
    expect(g).toMatchObject({ podCabinets: 56, commCabinets: 14, nodesPerCabinet: 9, npusPerNode: 8, cpusPerNode: 2, fabric: 'blade-clos', soTiers: 2 });
    expect(g.ubLabel).toEqual({ zh: 'UB 交换 + 光链路', en: 'UB switching + optics' });
    expect(g.podLabel).toEqual({ zh: '960E 超节点 4,032 NPU', en: '960E SuperPoD 4,032 NPUs' });
    expect(topoGeomFromRecord(resolved(a), { scaleOutTiers: 2 }).podLabel).toEqual(a.schematic.podLabel);
  });
  it('refuses an unresolved superpod', () => {
    expect(() => topoGeomFromRecord(BUILTIN_TOPOLOGY_RECORDS.native950, { scaleOutTiers: 2 })).toThrow(/not resolved/);
  });
});
