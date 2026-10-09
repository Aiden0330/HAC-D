/** Generic sensitivity tools: one-at-a-time tornado, 1-D and 2-D sweeps, finite-difference elasticities. */

export interface TornadoParam<T> {
  id: string;
  name?: string;
  low: (base: T) => T;
  high: (base: T) => T;
  lowLabel?: string;
  highLabel?: string;
}

export interface TornadoRow {
  id: string;
  name: string;
  base: number;
  low: number;
  high: number;
  swing: number;
  lowLabel?: string;
  highLabel?: string;
}

/** Evaluate `metric` at each parameter's low and high variants; rows sorted by swing. */
export function tornado<T>(base: T, params: TornadoParam<T>[], metric: (x: T) => number): TornadoRow[] {
  const b = metric(base);
  return params
    .map((p) => {
      const lo = metric(p.low(base));
      const hi = metric(p.high(base));
      return { id: p.id, name: p.name ?? p.id, base: b, low: lo, high: hi, swing: Math.abs(hi - lo), lowLabel: p.lowLabel, highLabel: p.highLabel };
    })
    .sort((x, y) => y.swing - x.swing);
}

export interface SweepPoint {
  x: number;
  value: number;
}

export function sweep1D<T>(base: T, xs: number[], apply: (base: T, x: number) => T, metric: (x: T) => number): SweepPoint[] {
  return xs.map((x) => ({ x, value: metric(apply(base, x)) }));
}

export interface Grid2D {
  xs: number[];
  ys: number[];
  /** values[iy][ix] */
  values: number[][];
}

export function sweep2D<T>(base: T, xs: number[], ys: number[], apply: (base: T, x: number, y: number) => T, metric: (x: T) => number): Grid2D {
  const values = ys.map((y) => xs.map((x) => metric(apply(base, x, y))));
  return { xs, ys, values };
}

/** Relative elasticity ∂ln(metric)/∂ln(param) by central finite difference. */
export function elasticity<T>(base: T, apply: (base: T, factor: number) => T, metric: (x: T) => number, h = 0.01): number {
  const up = metric(apply(base, 1 + h));
  const dn = metric(apply(base, 1 - h));
  const m = metric(base);
  if (!(m > 0)) return NaN;
  return (Math.log(up) - Math.log(dn)) / (Math.log(1 + h) - Math.log(1 - h));
}

/** Geometric grid helper. */
export function logspace(from: number, to: number, n: number): number[] {
  const out: number[] = [];
  const a = Math.log(from);
  const b = Math.log(to);
  for (let i = 0; i < n; i++) out.push(Math.exp(a + ((b - a) * i) / (n - 1)));
  return out;
}

export function linspace(from: number, to: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}
