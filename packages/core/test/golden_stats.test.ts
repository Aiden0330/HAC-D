/**
 * v3.5 statistics golden harness. Expected values in test/golden/golden_stats.json were computed independently with
 * SciPy (compute_golden_stats.py). Do not edit expected values by hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { studentTQuantile, chiSquareQuantile, regularizedGammaP, regularizedGammaQ, regularizedBeta, wilsonInterval } from '../src/math/special.js';
import { rateFromCounts } from '../src/fit/incidents.js';

interface GoldenCase {
  id: string;
  group: string;
  inputs: Record<string, number>;
  expected: Record<string, number>;
  tolerance?: { rel?: number; abs?: number };
}
const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden', 'golden_stats.json'), 'utf8')) as { cases: GoldenCase[] };

function compute(c: GoldenCase): Record<string, number> {
  const i = c.inputs;
  switch (c.group) {
    case 'tq':
      return { q: studentTQuantile(i.p, i.df) };
    case 'chi2q':
      return { q: chiSquareQuantile(i.p, i.df) };
    case 'gammainc':
      return { p: regularizedGammaP(i.a, i.x), q: regularizedGammaQ(i.a, i.x) };
    case 'betainc':
      return { i: regularizedBeta(i.x, i.a, i.b) };
    case 'wilson': {
      const w = wilsonInterval(i.k, i.n, i.confidence);
      return { low: w.low, high: w.high };
    }
    case 'garwood': {
      const r = rateFromCounts(i.events, i.exposureHours, i.confidence);
      return { fit: r.fit, lowerFit: r.lower.fit, upperFit: r.upper.fit };
    }
    default:
      throw new Error(`no handler for group ${c.group}`);
  }
}

describe('v3.5 statistics golden vectors (independent SciPy)', () => {
  for (const c of golden.cases) {
    it(c.id, () => {
      const got = compute(c);
      const rel = c.tolerance?.rel ?? 1e-9;
      const abs = c.tolerance?.abs ?? 0;
      for (const [k, want] of Object.entries(c.expected)) {
        const v = got[k];
        expect(v, `${c.id}.${k}`).toBeDefined();
        const tol = Math.max(abs, rel * Math.abs(want));
        expect(Math.abs(v - want), `${c.id}.${k}: got ${v}, want ${want}`).toBeLessThanOrEqual(tol);
      }
    });
  }
});
