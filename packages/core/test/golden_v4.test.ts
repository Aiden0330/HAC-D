/**
 * v4 golden-vector harness. Expected values in test/golden/golden_v4.json were computed independently in Python
 * (compute_golden_v4.py: folded-Clos counts, template hardware counts with the port-count fill of the last SuperPoD, per-unit
 * FIT under the CloudMatrix384 geometry) from docs/PLAN_V4_NPU_TOPOLOGY_FIRST.md §2 without reading the engine. Do not edit
 * expected values by hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { closCounts } from '../src/scenario/build.js';
import { topologyScenario, topologyBom, unitFaultLibrary, type TopologyTemplate } from '../src/topology/index.js';

interface GoldenCase {
  id: string;
  group: string;
  inputs: Record<string, unknown>;
  expected: Record<string, number>;
  tolerance?: { rel?: number; abs?: number };
}
const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden', 'golden_v4.json'), 'utf8')) as { cases: GoldenCase[] };
const library = unitFaultLibrary();

function compute(c: GoldenCase): Record<string, number> {
  const i = c.inputs as Record<string, number | string>;
  switch (c.group) {
    case 'clos': {
      const r = closCounts(i.ports as number, i.radix as number, i.oversubscription as number, i.transceiversPerLink as number);
      return { tiers: r.tiers, switches: r.switches, links: r.links, transceivers: r.transceivers, ...Object.fromEntries(r.perTier.map((n, k) => [`tier${k + 1}`, n])) };
    }
    case 'template': {
      const s = topologyScenario(i.template as TopologyTemplate, i.npus as number, { topology: { fabricFill: i.fabricFill as 'proportional' | 'full-pod' }, mechanisms: [] });
      const b = topologyBom(s);
      const k = b.counts;
      const out: Record<string, number> = { npus: k.gpus, nodes: k.nodes, cpus: k.cpus, cabinets: k.racks, hardFitPerNpuTotal: b.hardFitPerNpuTotal, hardPerHour: b.hardPerHour };
      if (s.topology.superpod) Object.assign(out, { pods: k.supernodes, commCabinets: k.commRacks, l1: k.l1Switches, l2: k.l2Switches, ubLinks: k.opticalLinks, ubTransceivers: k.transceivers });
      if (s.topology.scaleOut) Object.assign(out, { roPorts: k.scaleOutPorts, roTiers: k.scaleOutTiers, roSwitches: k.scaleOutSwitches, roLinks: k.scaleOutLinks, ...Object.fromEntries(k.scaleOutPerTier.map((n, j) => [`roTier${j + 1}`, n])) });
      for (const [u, v] of Object.entries(b.hardFitPerNpu)) out[`hardFitPerNpu.${u}`] = v!;
      return out;
    }
    case 'calibration': {
      const b = topologyBom(topologyScenario('a3-ub384', i.npus as number, { scaleOut: false, mechanisms: [] }));
      return { hardPerHour: b.hardPerHour, catalogHardPerHour: b.hardPerHour };
    }
    case 'fit': {
      const f = library.find((x) => x.id === i.id);
      if (!f) throw new Error(`no library entry ${i.id}`);
      return { fitPerUnit: f.fitPerUnit, cardsPerUnit: f.cardsPerUnit };
    }
    default:
      throw new Error(`no handler for group ${c.group}`);
  }
}

describe('v4 golden vectors (independent Python)', () => {
  for (const c of golden.cases) {
    it(c.id, () => {
      const got = compute(c);
      const rel = c.tolerance?.rel ?? 1e-9;
      const abs = c.tolerance?.abs ?? 1e-9;
      for (const [k, v] of Object.entries(c.expected)) {
        expect(got[k], `${c.id}.${k}`).toBeDefined();
        expect(Math.abs(got[k] - v), `${c.id}.${k}: got ${got[k]}, expected ${v}`).toBeLessThanOrEqual(Math.max(abs, rel * Math.abs(v)));
      }
    });
  }
});
