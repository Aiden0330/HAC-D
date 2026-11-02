import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dateOf } from '../src/kit.mjs';

// The page date is the stamp's first ten characters, never the renderer's zone (the second CI run of v5.9, 2026-11-01, printed
// 2026-10-30 on the UTC runner for the run of the evening of 2026-10-29 in US Eastern time).
describe('dateOf — the page date comes from the stamp, not from the renderer\'s zone', () => {
  it('reads the author\'s day from an offset stamp and the UTC day from an earlier Z stamp', () => {
    expect(dateOf('2026-10-29T22:16:59.781-04:00')).toBe('2026-10-29');
    expect(dateOf('2026-10-30T02:16:59.781Z')).toBe('2026-10-30');
    expect(dateOf('2026-10-27')).toBe('2026-10-27');
    expect(dateOf(undefined)).toBe('—');
    expect(dateOf('n/a')).toBe('—');
  });
  it('the committed report set carries an offset stamp, so its pages reproduce in every zone', () => {
    const R = JSON.parse(readFileSync(new URL('../../../docs/backup/ascend-allocation/results.json', import.meta.url), 'utf8'));
    expect(R.generated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(dateOf(R.generated)).toBe(R.generated.slice(0, 10));
  });
});
