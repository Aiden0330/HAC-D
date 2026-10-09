import { useState } from 'react';
import { ChartFrame } from './ChartFrame.js';
import { Tooltip, type TooltipState } from './Tooltip.js';
import { linearScale, useMeasure, niceDomain } from './common.js';

/** Histogram of replication outcomes with reference lines (closed form, mean). */
export function Histogram({ title, subtitle, values, bins = 20, format, refs, height = 220 }: { title: string; subtitle?: string; values: number[]; bins?: number; format: (v: number) => string; refs?: { value: number; label: string; color?: string }[]; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  if (values.length === 0) return null;
  const lo0 = Math.min(...values, ...(refs?.map((r) => r.value) ?? []));
  const hi0 = Math.max(...values, ...(refs?.map((r) => r.value) ?? []));
  const [lo, hi] = lo0 === hi0 ? [lo0 - 0.01, hi0 + 0.01] : niceDomain(lo0, hi0);
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]++;
  const m = { l: 40, r: 16, t: 14, b: 32 };
  const x = linearScale([lo, hi], [m.l, width - m.r]);
  const y = linearScale([0, Math.max(1, ...counts)], [height - m.b, m.t]);
  const bw = (width - m.l - m.r) / bins;
  return (
    <ChartFrame title={title} subtitle={subtitle} table={{ columns: ['bin', 'count'], rows: counts.map((c, i) => [`${format(lo + (i * (hi - lo)) / bins)} – ${format(lo + ((i + 1) * (hi - lo)) / bins)}`, c]) }}>
      <div ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g className="grid">
            {y.ticks(4).map((tk) => (
              <line key={tk} x1={m.l} x2={width - m.r} y1={y(tk)} y2={y(tk)} />
            ))}
          </g>
          {counts.map((c, i) => {
            const x0 = x(lo + (i * (hi - lo)) / bins);
            const h = y(0) - y(c);
            return (
              <g key={i} onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: `${format(lo + (i * (hi - lo)) / bins)} – ${format(lo + ((i + 1) * (hi - lo)) / bins)}`, rows: [{ key: 'count', value: String(c) }] })} onPointerLeave={() => setTip(null)}>
                <rect className="bar" x={x0 + 1} y={y(c)} width={Math.max(1, bw - 2)} height={h} rx={h > 4 ? 3 : 0} fill="var(--series-1)" />
              </g>
            );
          })}
          <g className="axis tick">
            <line x1={m.l} x2={width - m.r} y1={height - m.b} y2={height - m.b} />
            {x.ticks(6).map((tk) => (
              <text key={tk} x={x(tk)} y={height - m.b + 16} textAnchor="middle">{format(tk)}</text>
            ))}
            {y.ticks(4).map((tk) => (
              <text key={tk} x={m.l - 6} y={y(tk) + 4} textAnchor="end">{tk}</text>
            ))}
          </g>
          {refs?.map((r) => (
            <g key={r.label}>
              <line x1={x(r.value)} x2={x(r.value)} y1={m.t} y2={height - m.b} stroke={r.color ?? 'var(--accent)'} strokeWidth={2} />
              <text x={x(r.value) + 4} y={m.t + 10} className="meta" style={{ fill: r.color ?? 'var(--accent)' }}>{r.label}</text>
            </g>
          ))}
        </svg>
      </div>
      <Tooltip state={tip} />
    </ChartFrame>
  );
}
