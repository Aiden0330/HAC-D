/**
 * Silent data corruption (SDC, 静默错误) delivery model over a finite window (docs/MODEL_REFERENCE.md §20).
 * Follows the audited ai-cluster-reliability semantics: an undetected corruption makes every later
 * checkpoint dirty; it is discovered after a fixed fallback delay D, the job rolls back to the last clean
 * checkpoint, pays a recovery pause and continues; corruption still undiscovered at the end of the window
 * discards the work since the last clean checkpoint (terminal discard). Only the first undetected event of an
 * episode matters (later ones while dirty change nothing). Clean durations are exponential on the wall clock
 * (rate ν), dirty + pause durations deterministic (c = D + R_c): an alternating renewal process whose
 * finite-window expectations are sums over the episode count k of Gamma(k, ν) shifted by (k − 1)c.
 * Times in hours.
 */
import { poissonSf } from '../math/special.js';

export interface SdcDeliveryInput {
  /** window length T (hours) */
  horizonH: number;
  /** rate of undetected, non-cleared corruption episodes while clean, per wall-clock hour */
  nuPerWallHour: number;
  /** fallback (discovery) delay D, hours */
  fallbackDelayH: number;
  /** recovery pause after discovery R_c, hours */
  episodePauseH: number;
  /** useful work per wall hour while clean (performance goodput g) */
  cleanGoodput: number;
  /** work lost before the corruption: compute since the last clean checkpoint, hours (≈ (τ²/2 + τδ)/(τ+δ)) */
  preEpisodeLossH: number;
}

export interface SdcDeliveryResult {
  /** E[correct work]/T: the delivered (正确有效) share of the window */
  delivered: number;
  /** multiplicative factor delivered / g */
  factor: number;
  cleanTimeFraction: number;
  dirtyTimeFraction: number;
  pauseFraction: number;
  /** expected number of episodes started and of episodes discovered inside the window */
  expectedEpisodes: number;
  expectedDiscovered: number;
  /** probability that the job is still dirty at T */
  pDirtyAtEnd: number;
  /** work rolled back at discoveries and work discarded at T, as fractions of T */
  rollbackFraction: number;
  terminalDiscardFraction: number;
  /** reference factors: continuous exposure without any recovery (1 − e^{−νT})/(νT), and P(no episode) */
  cTimeNoRecovery: number;
  pCleanWindow: number;
  /** long-run (stationary) clean fraction 1/(1 + νc) for comparison */
  stationaryCleanFraction: number;
  method: 'exact-renewal-sum' | 'stationary';
  /** episodes enumerated */
  terms: number;
}

/** P(S_k ≤ y) for S_k = Gamma(k, ν) + (k − 1)c: the k-th episode has started by y. */
function pStarted(k: number, y: number, nu: number, c: number): number {
  const z = y - (k - 1) * c;
  if (z <= 0) return 0;
  // P(Gamma(k, ν) ≤ z) = P(Poisson(νz) ≥ k)
  return poissonSf(nu * z, k - 1);
}

/** ∫_a^b P(S_k ≤ T − x) dx by composite Gauss–Legendre (5 nodes per panel); the integrand vanishes for x ≥ T. */
const GL_X = [-0.906179845938664, -0.538469310105683, 0, 0.538469310105683, 0.906179845938664];
const GL_W = [0.236926885056189, 0.478628670499366, 0.568888888888889, 0.478628670499366, 0.236926885056189];
function panelsFor(len: number, nu: number): number {
  return Math.max(8, Math.min(256, Math.ceil(len * nu * 2) + 8));
}
function integral(k: number, a: number, b: number, T: number, nu: number, c: number): number {
  const lo = Math.max(0, a);
  const hi = Math.min(b, T);
  if (hi <= lo) return 0;
  const panels = panelsFor(hi - lo, nu);
  const h = (hi - lo) / panels;
  let s = 0;
  for (let p = 0; p < panels; p++) {
    const start = lo + p * h;
    const mid = start + h / 2;
    for (let i = 0; i < 5; i++) s += GL_W[i] * pStarted(k, T - (mid + (h / 2) * GL_X[i]), nu, c);
  }
  return (s * h) / 2;
}

/** E[min(D, (T − S_k)⁺)] − D·P(S_k ≤ T − D): expected dirty time inside the window of an episode still undiscovered at T. */
function expectedTailDirty(k: number, T: number, D: number, nu: number, c: number): number {
  const lo = Math.max(0, T - D);
  if (T <= lo) return 0;
  const panels = panelsFor(T - lo, nu);
  const h = (T - lo) / panels;
  let s = 0;
  for (let p = 0; p < panels; p++) {
    const a = lo + p * h;
    const mid = a + h / 2;
    for (let i = 0; i < 5; i++) s += GL_W[i] * pStarted(k, mid + (h / 2) * GL_X[i], nu, c);
  }
  return (s * h) / 2 - D * pStarted(k, T - D, nu, c);
}

export function sdcDelivery(input: SdcDeliveryInput): SdcDeliveryResult {
  const T = input.horizonH;
  const nu = Math.max(0, input.nuPerWallHour);
  const D = Math.max(0, input.fallbackDelayH);
  const Rc = Math.max(0, input.episodePauseH);
  const g = Math.max(0, input.cleanGoodput);
  const U = Math.max(0, input.preEpisodeLossH);
  const c = D + Rc;
  const cTime = nu * T > 1e-9 ? -Math.expm1(-nu * T) / (nu * T) : 1;
  const pCleanWindow = Math.exp(-nu * T);
  const stationaryClean = 1 / (1 + nu * c);
  if (!(T > 0) || nu <= 0 || g <= 0) {
    return { delivered: g, factor: 1, cleanTimeFraction: 1, dirtyTimeFraction: 0, pauseFraction: 0, expectedEpisodes: 0, expectedDiscovered: 0, pDirtyAtEnd: 0, rollbackFraction: 0, terminalDiscardFraction: 0, cTimeNoRecovery: cTime, pCleanWindow, stationaryCleanFraction: stationaryClean, method: 'exact-renewal-sum', terms: 0 };
  }
  // number of episodes with non-negligible probability
  const mu = nu * T;
  const kByCycles = c > 0 ? Math.floor(T / c) + 2 : Infinity;
  const kByRate = Math.ceil(mu + 10 * Math.sqrt(mu) + 20);
  const K = Math.min(kByCycles, kByRate);
  if (K > 4000 || c <= 0) {
    // too many short cycles for the exact sum: stationary alternating-renewal fractions
    const clean = stationaryClean;
    const episodesPerHour = clean * nu;
    const expectedEpisodes = episodesPerHour * T;
    const dirty = episodesPerHour * D;
    const pause = episodesPerHour * Rc;
    const delivered = Math.max(0, g * clean - U * episodesPerHour);
    // rollback at discoveries = compute while dirty + the pre-episode loss of every episode, so that delivered + rollback = g·(1 − pause)
    return { delivered, factor: g > 0 ? delivered / g : 1, cleanTimeFraction: clean, dirtyTimeFraction: dirty, pauseFraction: pause, expectedEpisodes, expectedDiscovered: expectedEpisodes, pDirtyAtEnd: dirty, rollbackFraction: g * dirty + U * episodesPerHour, terminalDiscardFraction: 0, cTimeNoRecovery: cTime, pCleanWindow, stationaryCleanFraction: stationaryClean, method: 'stationary', terms: 0 };
  }
  let expectedEpisodes = 0;
  let expectedDiscovered = 0;
  let dirtyH = 0;
  let pauseH = 0;
  let tailDirtyH = 0;
  let pDirtyAtEnd = 0;
  for (let k = 1; k <= K; k++) {
    const pk = pStarted(k, T, nu, c);
    if (pk < 1e-14 && k > 1) break;
    expectedEpisodes += pk;
    const pDisc = pStarted(k, T - D, nu, c);
    expectedDiscovered += pDisc;
    pDirtyAtEnd += pk - pDisc; // started but not discovered by T
    dirtyH += integral(k, 0, D, T, nu, c);
    pauseH += integral(k, D, c, T, nu, c);
    tailDirtyH += expectedTailDirty(k, T, D, nu, c);
  }
  const cleanH = Math.max(0, T - dirtyH - pauseH);
  const delivered = Math.max(0, (g * cleanH - U * expectedEpisodes) / T);
  const rollbackH = g * (dirtyH - tailDirtyH) + U * expectedDiscovered;
  const terminalH = g * tailDirtyH + U * pDirtyAtEnd;
  return {
    delivered,
    factor: g > 0 ? delivered / g : 1,
    cleanTimeFraction: cleanH / T,
    dirtyTimeFraction: dirtyH / T,
    pauseFraction: pauseH / T,
    expectedEpisodes,
    expectedDiscovered,
    pDirtyAtEnd: Math.min(1, Math.max(0, pDirtyAtEnd)),
    rollbackFraction: rollbackH / T,
    terminalDiscardFraction: terminalH / T,
    cTimeNoRecovery: cTime,
    pCleanWindow,
    stationaryCleanFraction: stationaryClean,
    method: 'exact-renewal-sum',
    terms: K,
  };
}

/**
 * Probability that a corruption is cleared before it is persisted: a rollback event (rate λ_rb per running
 * hour) arrives before the next checkpoint write, the phase being uniform over the period L (hours).
 * P = 1 − (1 − e^{−λL})/(λL).
 */
export function pClearedBeforePersist(rollbackRatePerHour: number, periodH: number): number {
  const x = rollbackRatePerHour * periodH;
  if (x <= 1e-9) return x / 2;
  return 1 + Math.expm1(-x) / x;
}
