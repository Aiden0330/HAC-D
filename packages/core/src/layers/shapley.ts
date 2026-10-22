/**
 * v5 exact Shapley attribution per layer (previously `shapleyByLevel` of scripts/a950-level-allocation.ts, generalised to the
 * six layers): for ≤ 8 appliable players every coalition (2^n, each one evaluation of the closed forms) is valued by A_op and by
 * the pause each layer carries (C_ℓ + iso_ℓ + sdc_ℓ, seconds per hour); a player's Shapley value on a layer is the pause it
 * removes there, so that Σ_ℓ (removed pause) is its total pause removal and the A_op value is its exact Shapley share of
 * A_op(all) − A_op(none). A player whose `requires` are absent from a coalition contributes nothing there (R-SDC needs D-SDC).
 * 口径: seconds of pause per job hour removed, by layer; A_op in fractions.
 */
import type { Scenario } from '../scenario/schema.js';
import { applyMechanisms, mechanismById } from '../mechanisms/index.js';
import { byLayer, DEFAULT_LAYERS, type LayerDef, type LayerId } from './index.js';

export interface LayerShapleyOptions {
  parameters?: Record<string, Record<string, number>>;
  layers?: LayerDef[];
}
export interface LayerShapleyGain { aOp: number; delivered: number; byLayer: Record<LayerId, number> }
export interface LayerShapley {
  players: string[];
  gains: Record<string, LayerShapleyGain>;
  none: { pause: Record<LayerId, number>; aOp: number; delivered: number };
  all: { pause: Record<LayerId, number>; aOp: number; delivered: number };
  coalitions: number;
}

/** exact Shapley values of the players on the bare scenario, with the pause removed per layer */
export function shapleyByLayer(bare: Scenario, players: string[], opts: LayerShapleyOptions = {}): LayerShapley {
  const layers = opts.layers ?? DEFAULT_LAYERS;
  const ids = players.filter((id) => !!mechanismById(id).apply);
  const m = ids.length;
  if (m > 8) throw new Error(`shapleyByLayer: at most 8 players (${m} given); the sampled study attribution covers more`);
  const cache = new Map<number, { pause: Record<LayerId, number>; aOp: number; delivered: number }>();
  const pauseVec = (x: ReturnType<typeof byLayer>) => Object.fromEntries(layers.map((l) => [l.id, x.levels[l.id].c + x.levels[l.id].iso + x.levels[l.id].sdc])) as Record<LayerId, number>;
  const val = (mask: number) => {
    let v = cache.get(mask);
    if (!v) {
      const inMask = ids.filter((_, i) => mask & (1 << i));
      const sel = inMask.filter((id) => (mechanismById(id).requires ?? []).every((r) => inMask.includes(r)));
      const sc = sel.length ? applyMechanisms(bare, sel, opts.parameters ?? {}) : bare;
      const x = byLayer(sc, undefined, layers);
      v = { pause: pauseVec(x), aOp: x.k.aOp, delivered: x.k.delivered };
      cache.set(mask, v);
    }
    return v;
  };
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
  const gains: Record<string, LayerShapleyGain> = {};
  ids.forEach((id, i) => {
    let aOp = 0, delivered = 0;
    const by = Object.fromEntries(layers.map((l) => [l.id, 0])) as Record<LayerId, number>;
    for (let mask = 0; mask < 1 << m; mask++) {
      if (mask & (1 << i)) continue;
      const s = mask.toString(2).split('').filter((ch) => ch === '1').length;
      const w = (fact(s) * fact(m - s - 1)) / fact(m);
      const a = val(mask), b = val(mask | (1 << i));
      aOp += w * (b.aOp - a.aOp);
      delivered += w * (b.delivered - a.delivered);
      for (const l of layers) by[l.id] += w * (a.pause[l.id] - b.pause[l.id]); // pause removed (s/h)
    }
    gains[id] = { aOp, delivered, byLayer: by };
  });
  const none = val(0), all = val((1 << m) - 1);
  return { players: ids, gains, none, all, coalitions: 1 << m };
}
