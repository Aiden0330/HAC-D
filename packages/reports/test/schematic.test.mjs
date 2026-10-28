/**
 * v6.3 the topology schematic (src/schematic.mjs): drawn from a scenario's topology and from the record's resolved geometry alike
 * (same SVG), for every built-in record and the A2 template, in both languages, with the engine's counts in the labels and no
 * NaN / undefined; the web variant is a bare svg.topo-pic without an embedded style.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_TOPOLOGY_RECORDS, recordSuperpod, scenarioFromRecord } from '../../core/src/records/topologyRecord.ts';
import { computeCounts } from '../../core/src/scenario/build.ts';
import { topologyScenario } from '../../core/src/topology/index.ts';
import { topologySchematicSvg, SCHEMATIC_WIDTH, TOPO_STYLE } from '../src/schematic.mjs';

const fmt = (n) => n.toLocaleString('en-US');
const bad = (svg) => svg.replace(/<style>[\s\S]*?<\/style>/, '').match(/NaN|undefined|null/);

describe('topologySchematicSvg', () => {
  for (const [id, rec] of Object.entries(BUILTIN_TOPOLOGY_RECORDS)) {
    for (const lang of ['zh', 'en']) {
      it(`${id} (${lang}): scenario topology and record geometry draw the same figure with the engine's counts`, () => {
        const s = scenarioFromRecord(rec, 100000);
        const counts = computeCounts(s);
        const a = topologySchematicSvg(s.topology, counts, lang);
        const b = topologySchematicSvg({ template: rec.template, superpod: recordSuperpod(rec), scaleOut: rec.scaleOut }, counts, lang);
        expect(a.svg).toBe(b.svg);
        expect(a.width).toBe(SCHEMATIC_WIDTH);
        expect(a.height).toBeGreaterThan(300);
        expect(a.svg.startsWith('<svg class="viz topo"')).toBe(true);
        expect(a.svg).toContain(`viewBox="0 0 ${SCHEMATIC_WIDTH} ${a.height}"`);
        expect(a.svg).toContain(TOPO_STYLE);
        expect(a.svg).toContain(lang === 'zh' ? `超节点 × ${fmt(counts.supernodes)}` : `SuperPoDs × ${fmt(counts.supernodes)}`);
        expect(a.svg).toContain(`${fmt(counts.gpus)} NPU`);
        expect(a.svg).toContain(lang === 'zh' ? `${fmt(counts.opticalLinks)} 条 UB 光链路` : `${fmt(counts.opticalLinks)} UB optical links`);
        if (s.topology.scaleOut) expect(a.svg).toContain(`${fmt(counts.scaleOutPorts)} ${lang === 'zh' ? '口' : 'ports'}`);
        expect(bad(a.svg)).toBeNull();
      });
    }
  }
  it('the Atlas 800T A3 server record (no communication cabinets) says where the UB switching is', () => {
    const s = scenarioFromRecord(BUILTIN_TOPOLOGY_RECORDS.a3server, 10000);
    const { svg } = topologySchematicSvg(s.topology, computeCounts(s), 'en');
    expect(svg).toContain('no communication cabinets: UB switching inside the node (7 L1 chips per node)');
    expect(svg).not.toContain('0 communication cabinets (L2)');
  });
  it('the A2 (RoCE) template draws cabinets of servers and the parameter plane', () => {
    const s = topologyScenario('a2-roce', 10000);
    const counts = computeCounts(s);
    const { svg, height } = topologySchematicSvg(s.topology, counts, 'zh');
    expect(svg).toContain(`计算机柜 × ${fmt(counts.racks)}`);
    expect(svg).toContain('RoCE 参数面');
    expect(svg).toContain(`${fmt(counts.scaleOutSwitches)} 台 RoCE 交换机`);
    expect(height).toBeGreaterThan(200);
    expect(bad(svg)).toBeNull();
  });
  it('the web variant is a bare svg.topo-pic without an embedded style', () => {
    const s = scenarioFromRecord(BUILTIN_TOPOLOGY_RECORDS.native950, 10000);
    const { svg } = topologySchematicSvg(s.topology, computeCounts(s), 'en', { embedStyle: false });
    expect(svg.startsWith('<svg class="topo-pic"')).toBe(true);
    expect(svg).not.toContain('<style>');
    expect(svg).toContain('class="tp-pod"');
  });
  it('refuses counts without the scale-out tiers', () => {
    expect(() => topologySchematicSvg({}, {}, 'en')).toThrow(/scaleOutPerTier/);
  });
});
