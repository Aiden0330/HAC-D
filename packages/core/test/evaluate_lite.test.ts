import { describe, it, expect } from 'vitest';
import { EXAMPLES, evaluateScenario, mechanismReport, planToTarget } from '../src/index.js';

describe('evaluateScenario without the block structure (value functions of the attribution and the planner)', () => {
  for (const [id, make] of Object.entries(EXAMPLES)) {
    it(`${id}: training / inference / spares / components / checklist equal the full evaluation`, () => {
      const s = make();
      const full = evaluateScenario(s);
      const lite = evaluateScenario(s, { structure: false });
      expect(lite.training).toEqual(full.training);
      expect(lite.inference).toEqual(full.inference);
      expect(lite.spares).toEqual(full.spares);
      expect(lite.components).toEqual(full.components);
      expect(lite.checklist).toEqual(full.checklist);
      expect('system' in lite).toBe(false);
      expect('importance' in lite).toBe(false);
    });
  }

  it('the hot-spare pool blocking probability survives without the full structure (survey example 3)', () => {
    const s = EXAMPLES['survey-ex3']();
    const full = evaluateScenario(s);
    const lite = evaluateScenario(s, { structure: false });
    expect(full.training!.blockedProbability).toBeGreaterThan(0);
    expect(lite.training!.blockedProbability).toBe(full.training!.blockedProbability);
  });

  it('the attribution reports its progress up to the coalition count', () => {
    const s = EXAMPLES['ref-three-classes-100k']();
    const seen: Array<[number, number]> = [];
    const r = mechanismReport(s, ['D-SDC', 'R-SDC', 'R-REPLAY', 'C-FAST'], { onProgress: (d, t) => seen.push([d, t]) });
    expect(r.coalitions).toBe(16);
    expect(seen.at(-1)).toEqual([16, 16]);
    expect(seen.every(([d, t]) => d <= t && t === 16)).toBe(true);
    expect(seen.map(([d]) => d)).toEqual([...seen.map(([d]) => d)].sort((a, b) => a - b));
  });

  it('the planner reports the coalition, scan and verification phases', () => {
    const s = EXAMPLES['ref-three-classes-100k']();
    const phases = new Map<string, [number, number]>();
    const p = planToTarget(s, { target: 0.9, players: ['D-SDC', 'R-SDC', 'C-FAST'], scan: true, verify: { trials: 40 }, onProgress: (d, t, phase) => phases.set(phase, [d, t]) });
    expect(phases.get('coalitions')).toEqual([8, 8]);
    expect(phases.get('scan')).toEqual([25, 25]);
    expect(p.verification?.trials).toBe(40);
    expect(phases.get('verify')).toEqual([40, 40]);
  });
});
