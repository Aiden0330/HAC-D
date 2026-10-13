/**
 * v3 golden-vector harness. Expected values in test/golden/golden_v3.json were computed independently in
 * Python (compute_golden_v3.py: mpmath quadrature, recursive chain enumeration, renewal equations on a grid)
 * from docs/MODEL_REFERENCE.md §19–§20 without reading the engine. Do not edit expected values by hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renewalGoodputMixed } from '../src/checkpoint/index.js';
import { chainOutcome, type ChainParams, type Applicability } from '../src/mechanisms/chain.js';
import { sdcDelivery, pClearedBeforePersist } from '../src/sdc/index.js';

interface GoldenCase {
  id: string;
  group: string;
  inputs: Record<string, unknown>;
  expected: Record<string, number>;
  tolerance?: { rel?: number; abs?: number };
}
const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden', 'golden_v3.json'), 'utf8')) as { cases: GoldenCase[] };

function compute(c: GoldenCase): Record<string, number> {
  const i = c.inputs as Record<string, number>;
  switch (c.group) {
    case 'mixed': {
      const r = renewalGoodputMixed({ tauS: i.tauS, deltaS: i.deltaS, rollbackRatePerS: i.rollbackRatePerHour / 3600, rollbackPauseS: i.rollbackPauseS, pauseRatePerS: i.pauseRatePerHour / 3600, pauseS: i.pauseS });
      return { goodput: r.goodput, runningFraction: r.runningFraction, saveFraction: r.saveFraction, rollbackFraction: r.rollbackFraction, rollbackPauseFraction: r.rollbackPauseFraction, pauseOnlyFraction: r.pauseOnlyFraction };
    }
    case 'chain': {
      const o = chainOutcome(i.detectS, i.globalS, c.inputs.params as ChainParams, c.inputs.applicable as Applicability, c.inputs.order as string[] | undefined);
      return { pPredict: o.pPredict, pNetfail: o.pNetfail, pReplay: o.pReplay, pHotswap: o.pHotswap, pElastic: o.pElastic, pProcess: o.pProcess, pGlobal: o.pGlobal, pRollback: o.pRollback, meanPauseS: o.meanPauseS, pauseRollbackS: o.pauseRollbackS, pauseNoRollbackS: o.pauseNoRollbackS, localLossS: o.localLossS };
    }
    case 'sdc': {
      const d = sdcDelivery({ horizonH: i.horizonH, nuPerWallHour: i.nuPerWallHour, fallbackDelayH: i.fallbackDelayH, episodePauseH: i.episodePauseH, cleanGoodput: i.cleanGoodput, preEpisodeLossH: i.preEpisodeLossH });
      return { delivered: d.delivered, cleanTimeFraction: d.cleanTimeFraction, expectedEpisodes: d.expectedEpisodes, expectedDiscovered: d.expectedDiscovered, deliveredDiscardAll: d.deliveredDiscardAll, pUnresolvedAtEnd: d.pUnresolvedAtEnd };
    }
    case 'pclear':
      return { p: pClearedBeforePersist(i.rollbackRatePerHour, i.periodH) };
    default:
      throw new Error(`no handler for group ${c.group}`);
  }
}

describe('v3 golden vectors (independent Python)', () => {
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
