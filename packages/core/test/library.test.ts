import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { filterLibrary, recordToFailureRate, recordToSeconds, type Library } from '../src/library/index.js';
import { toPerHour } from '../src/units/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const lib = JSON.parse(readFileSync(join(here, '..', 'data', 'library.json'), 'utf8')) as Library;

describe('parameter library', () => {
  it('loads 500+ records with provenance and 口径 on every record', () => {
    expect(lib.records.length).toBeGreaterThan(500);
    for (const r of lib.records) {
      expect(r.provenance.confidence).toBeTruthy();
      expect(r.koujing.event).toBeTruthy();
    }
  });
  it('converts the Llama 3 and RSC rates to per-hour correctly', () => {
    const llama = lib.records.find((r) => r.id === 'gpu.interruption_rate.llama3_h100')!;
    const fr = recordToFailureRate(llama)!;
    expect(toPerHour(fr.value, fr.unit)).toBeCloseTo(1 / 50680, 8);
    const rsc = lib.records.find((r) => r.id === 'node.failure_rate.rsc1')!;
    const fr2 = recordToFailureRate(rsc)!;
    expect(toPerHour(fr2.value, fr2.unit)).toBeCloseTo(6.5 / 1000 / 24, 12);
  });
  it('filters by class, confidence and query; stage records convert to seconds', () => {
    const gpus = filterLibrary(lib, { class: 'gpu', ratesOnly: true });
    expect(gpus.length).toBeGreaterThan(3);
    const assumed = filterLibrary(lib, { confidence: 'assumed' });
    expect(assumed.length).toBe(9);
    const detect = filterLibrary(lib, { class: 'recovery_stage', stage: 'detect' });
    expect(detect.length).toBeGreaterThan(3);
    expect(detect.every((r) => recordToSeconds(r) !== null || r.value === null)).toBe(true);
    expect(filterLibrary(lib, { query: 'trainmover' }).length).toBeGreaterThan(0);
  });
});
