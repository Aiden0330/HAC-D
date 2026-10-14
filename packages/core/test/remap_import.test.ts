/** v3.6: ReMAP / reference catalog importer and the generalized catalog scenario builder. */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importRemapCatalog, remapEventsFrom, referenceCatalog, evaluateScenario, REFERENCE_EVENTS } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const inputsJson = join(here, '..', '..', '..', 'remap', 'remap-main', 'references', 'expert-review-2026-10-09', 'inputs.json');

describe('ReMAP catalog import', () => {
  it('a plain event list becomes a catalog scenario; flags fall back to the built-in catalog by id', () => {
    const r = importRemapCatalog([
      { id: 'CORE-hard', type: '中断', fit: 500 },
      { id: 'NEW-hard', type: 'hard', fit: 100, replay: true },
      { id: 'CORE-slow', type: '亚健康', fit: 20 },
      { id: 'CORE-sdc', type: 'sdc', fit: 40 },
    ], { npus: 10000 });
    expect(r.events).toHaveLength(4);
    expect(r.classFit).toEqual({ hard: 600, slow: 20, sdc: 40 });
    const core = r.events.find((e) => e.id === 'CORE-hard')!;
    const ref = REFERENCE_EVENTS.find((e) => e.id === 'CORE-hard')!;
    expect([core.replay, core.process, core.elastic]).toEqual([ref.replay, ref.process, ref.elastic]);
    const fresh = r.events.find((e) => e.id === 'NEW-hard')!;
    expect([fresh.replay, fresh.process, fresh.elastic]).toEqual([true, false, false]);
    expect(r.warnings).toHaveLength(0);
    const tr = evaluateScenario(r.scenario).training!;
    // the job interruption rate also counts the isolation of detected sub-healthy units; the hardware rate is the class total
    expect(tr.subhealth?.hardwareInterruptionsPerHour ?? tr.interruptionRatePerHour).toBeCloseTo(10000 * 600e-9, 12);
    expect(tr.interruptionRatePerHour).toBeGreaterThan(10000 * 600e-9);
    expect(r.scenario.components).toHaveLength(4);
    expect(r.scenario.meta.id).toBe('remap-catalog-10k');
  });

  it('a hard event without any flags gets a warning and only the global recovery', () => {
    const r = remapEventsFrom({ events: [{ id: 'X-hard', type: 'hard', fit: 10 }] });
    expect(r.warnings).toHaveLength(1);
    expect(r.events[0].replay).toBe(false);
  });

  it('rejects unknown types and bad FITs', () => {
    expect(() => remapEventsFrom([{ id: 'a', type: 'weird', fit: 1 }])).toThrow(/unknown type/);
    expect(() => remapEventsFrom([{ id: 'a', type: 'hard', fit: -1 }])).toThrow(/FIT/);
    expect(() => remapEventsFrom({ nothing: true })).toThrow();
  });

  it('the built-in reference catalog is unchanged by the generalized builder', () => {
    const s = referenceCatalog(100000);
    const tr = evaluateScenario(s).training!;
    expect(s.meta.id).toBe('ref-catalog-100k');
    expect(s.components).toHaveLength(54);
    expect(tr.deliveredGoodput).toBeCloseTo(0.6261, 2);
  });

  const hasDrop = existsSync(inputsJson);
  (hasDrop ? it : it.skip)('the ReMAP reference inputs.json reproduces the built-in catalog example (same totals and flags)', () => {
    const r = importRemapCatalog(JSON.parse(readFileSync(inputsJson, 'utf8')), { npus: 100000 });
    expect(r.events).toHaveLength(54);
    expect(r.warnings).toHaveLength(0);
    const a = evaluateScenario(r.scenario).training!;
    const b = evaluateScenario(referenceCatalog(100000)).training!;
    expect(a.interruptionRatePerHour).toBeCloseTo(b.interruptionRatePerHour, 9);
    expect(a.deliveredGoodput).toBeCloseTo(b.deliveredGoodput, 9);
    expect(a.operationalAvailability).toBeCloseTo(b.operationalAvailability, 9);
  });
});
