/** Scales, ticks and a measure hook shared by the chart primitives. */
import { useEffect, useRef, useState } from 'react';

export interface Scale {
  (x: number): number;
  invert(y: number): number;
  ticks(count?: number): number[];
  domain: [number, number];
  range: [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((x: number) => r0 + (x - d0) * k) as Scale;
  f.invert = (y) => (k === 0 ? d0 : d0 + (y - r0) / k);
  f.ticks = (count = 5) => niceTicks(d0, d1, count);
  f.domain = domain;
  f.range = range;
  return f;
}

export function logScale(domain: [number, number], range: [number, number]): Scale {
  const l0 = Math.log10(domain[0]);
  const l1 = Math.log10(domain[1]);
  const [r0, r1] = range;
  const k = l1 === l0 ? 0 : (r1 - r0) / (l1 - l0);
  const f = ((x: number) => r0 + (Math.log10(x) - l0) * k) as Scale;
  f.invert = (y) => Math.pow(10, k === 0 ? l0 : l0 + (y - r0) / k);
  f.ticks = () => logTicks(domain[0], domain[1]);
  f.domain = domain;
  f.range = range;
  return f;
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  for (let e = e0; e <= e1; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  }
  return out;
}

export function niceDomain(lo: number, hi: number): [number, number] {
  if (!(hi > lo)) return [lo, lo + 1];
  const t = niceTicks(lo, hi, 5);
  const step = t.length > 1 ? t[1] - t[0] : (hi - lo) / 5;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(200, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    setW(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  if (a >= 1) return `${Number(v.toFixed(2))}`;
  return `${Number(v.toPrecision(3))}`;
}
