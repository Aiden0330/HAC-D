/** Seeded PRNG (xoshiro128**) with common variate generators. Deterministic across platforms. */

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spareNormal: number | null = null;

  constructor(seed: number | string = 1) {
    let h = typeof seed === 'string' ? Rng.hashString(seed) : seed >>> 0;
    // splitmix32 to fill state
    const next = () => {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  static hashString(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  /** 32 random bits. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1) with 53 bits. */
  uniform(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform in (0, 1]. */
  uniformOpen(): number {
    return 1 - this.uniform();
  }

  exponential(rate: number): number {
    if (!(rate > 0)) return Infinity;
    return -Math.log(this.uniformOpen()) / rate;
  }

  weibull(shape: number, scale: number): number {
    return scale * Math.pow(-Math.log(this.uniformOpen()), 1 / shape);
  }

  normal(): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal;
      this.spareNormal = null;
      return v;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = 2 * this.uniform() - 1;
      v = 2 * this.uniform() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spareNormal = v * m;
    return u * m;
  }

  lognormal(mu: number, sigma: number): number {
    return Math.exp(mu + sigma * this.normal());
  }

  /** Bernoulli trial. */
  bernoulli(p: number): boolean {
    return this.uniform() < p;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.uniform() * n);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
