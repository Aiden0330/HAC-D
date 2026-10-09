/**
 * Special functions used across the core: log-gamma, binomial and Poisson
 * tails in log space, Lambert W (principal branch), normal CDF / quantile.
 * All functions are pure and allocation-free where possible.
 */

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of Γ(x) for x > 0 (Lanczos, |rel err| ≲ 1e-15). */
export function lgamma(x: number): number {
  if (!(x > 0)) {
    if (x === 0) return Infinity;
    throw new RangeError(`lgamma: x must be > 0, got ${x}`);
  }
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS_C[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_C.length; i++) a += LANCZOS_C[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Γ(x) for moderate x (via exp(lgamma)). */
export function gammaFn(x: number): number {
  if (Number.isInteger(x) && x > 0 && x < 171) {
    let r = 1;
    for (let i = 2; i < x; i++) r *= i;
    return r;
  }
  return Math.exp(lgamma(x));
}

/** log C(n, k) for real n ≥ k ≥ 0. */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

/** C(n, k) (may overflow to Infinity for large n). */
export function choose(n: number, k: number): number {
  return Math.exp(logChoose(n, k));
}

/** log of the binomial pmf P(X = k), X ~ Bin(n, p). */
export function binomLogPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (p <= 0) return k === 0 ? 0 : -Infinity;
  if (p >= 1) return k === n ? 0 : -Infinity;
  return logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p);
}

/** P(X ≤ k) for X ~ Bin(n, p), summed in log space from the smaller tail. */
export function binomCdf(n: number, k: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  // Sum the shorter tail for accuracy.
  if (k <= n / 2) {
    let s = 0;
    let lp = n * Math.log1p(-p); // log P(X=0)
    const lr = Math.log(p) - Math.log1p(-p);
    s = Math.exp(lp);
    for (let i = 0; i < k; i++) {
      lp += Math.log((n - i) / (i + 1)) + lr;
      s += Math.exp(lp);
    }
    return Math.min(1, s);
  }
  // 1 − P(X ≥ k+1), summing from the top (k+1 .. n).
  let s = 0;
  for (let i = n; i >= k + 1; i--) s += Math.exp(binomLogPmf(n, i, p));
  return Math.max(0, 1 - s);
}

/** P(X ≥ k) for X ~ Bin(n, p). */
export function binomSf(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  return 1 - binomCdf(n, k - 1, p);
}

/** Smallest k with P(X ≤ k) ≥ q, X ~ Bin(n, p). */
export function binomQuantile(n: number, p: number, q: number): number {
  if (q <= 0) return 0;
  if (q >= 1) return n;
  if (p <= 0) return 0;
  if (p >= 1) return n;
  let lp = n * Math.log1p(-p);
  const lr = Math.log(p) - Math.log1p(-p);
  let s = Math.exp(lp);
  let k = 0;
  while (s < q && k < n) {
    lp += Math.log((n - k) / (k + 1)) + lr;
    s += Math.exp(lp);
    k++;
  }
  return k;
}

/** P(X ≤ k) for X ~ Poisson(mu). */
export function poissonCdf(mu: number, k: number): number {
  if (k < 0) return 0;
  if (mu <= 0) return 1;
  let lp = -mu;
  let s = Math.exp(lp);
  for (let i = 0; i < k; i++) {
    lp += Math.log(mu / (i + 1));
    s += Math.exp(lp);
  }
  return Math.min(1, s);
}

/** P(X > k) for X ~ Poisson(mu), summed directly over the upper tail (accurate for tiny tails). */
export function poissonSf(mu: number, k: number): number {
  if (mu <= 0) return 0;
  if (k < 0) return 1;
  if (k < mu) return Math.max(0, 1 - poissonCdf(mu, k));
  let lp = -mu + (k + 1) * Math.log(mu) - lgamma(k + 2); // log pmf at k+1
  let term = Math.exp(lp);
  let s = term;
  let i = k + 1;
  while (term > s * 1e-18 && i < k + 100000) {
    i++;
    term *= mu / i;
    s += term;
  }
  return Math.min(1, s);
}

/** Smallest k with P(X ≤ k) ≥ q, X ~ Poisson(mu). */
export function poissonQuantile(mu: number, q: number): number {
  if (mu <= 0 || q <= 0) return 0;
  if (q >= 1) return Infinity;
  let lp = -mu;
  let s = Math.exp(lp);
  let k = 0;
  while (s < q && k < 10_000_000) {
    k++;
    lp += Math.log(mu / k);
    s += Math.exp(lp);
  }
  return k;
}

/**
 * Lambert W, principal branch W0(z), for z ≥ −1/e.
 * Uses the branch-point series near −1/e and Halley iteration elsewhere.
 */
export function lambertW0(z: number): number {
  const minZ = -1 / Math.E;
  if (z < minZ - 1e-15) throw new RangeError(`lambertW0: z must be ≥ −1/e, got ${z}`);
  if (z <= minZ) return -1;
  if (z === 0) return 0;
  let w: number;
  const ez1 = Math.E * z + 1;
  if (ez1 < 0.3) {
    // series around the branch point, p = sqrt(2(ez+1))
    const p = Math.sqrt(2 * ez1);
    w = -1 + p - p * p / 3 + (11 / 72) * p ** 3 - (43 / 540) * p ** 4 + (769 / 17280) * p ** 5;
  } else if (z < 0) {
    w = z * (1 - z); // −1/e < z < 0: W ≈ z − z²
  } else if (z <= Math.E) {
    w = Math.log1p(z); // good starting point on [0, e]
  } else {
    const l1 = Math.log(z);
    const l2 = Math.log(l1);
    w = l1 - l2 + l2 / l1;
  }
  for (let i = 0; i < 60; i++) {
    const ew = Math.exp(w);
    const f = w * ew - z;
    const wp1 = w + 1;
    if (wp1 === 0) break;
    const denom = ew * wp1 - ((w + 2) * f) / (2 * wp1);
    const dw = f / denom;
    w -= dw;
    if (Math.abs(dw) <= 1e-15 * (1 + Math.abs(w))) break;
  }
  return w;
}

/** erfc(x) with relative accuracy ≈ 1e-15 (Chebyshev fit, Numerical Recipes erfccheb). */
export function erfc(x: number): number {
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3,
    -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5,
    -1.624290004647e-6, 1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
    5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11, 2.394038e-12, -6.886027e-12,
    8.94487e-13, 3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15, -1.523e-15, -9.4e-17, 1.21e-16, -2.8e-17,
  ];
  const t = 2 / (2 + Math.abs(x));
  const ty = 4 * t - 2;
  let d = 0;
  let dd = 0;
  for (let j = cof.length - 1; j > 0; j--) {
    const tmp = d;
    d = ty * d - dd + cof[j];
    dd = tmp;
  }
  const r = t * Math.exp(-x * x + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? r : 2 - r;
}

export function erf(x: number): number {
  return 1 - erfc(x);
}

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Standard normal quantile (Acklam's algorithm + one Newton refinement). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Newton refinement
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x -= u / (1 + (x * u) / 2);
  return x;
}
