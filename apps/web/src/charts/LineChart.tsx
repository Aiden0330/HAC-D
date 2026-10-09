import { useState } from 'react';
import { ChartFrame, Legend } from './ChartFrame.js';
import { Tooltip, type TooltipState } from './Tooltip.js';
import { linearScale, logScale, niceDomain, useMeasure, SERIES, fmtTick } from './common.js';

export interface Series {
  label: string;
  points: { x: number; y: number; flag?: 'ok' | 'caution' | 'invalid' }[];
  color?: string;
  muted?: boolean;
}

export interface Marker {
  x: number;
  label: string;
}

export interface Band {
  from: number;
  to: number;
  label: string;
}

/** Multi-series line chart (≤ 4 series), log or linear x, crosshair tooltip listing every series, end labels. */
export function LineChart({ title, subtitle, series, xLabel, yLabel, xLog, yDomain, formatX, formatY, markers, bands, height = 260 }: {
  title: string; subtitle?: string; series: Series[]; xLabel?: string; yLabel?: string; xLog?: boolean; yDomain?: [number, number];
  formatX: (v: number) => string; formatY: (v: number) => string; markers?: Marker[]; bands?: Band[]; height?: number;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const m = { l: 56, r: 90, t: 12, b: 36 };
  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter(Number.isFinite);
  if (allX.length === 0) return null;
  const xd: [number, number] = [Math.min(...allX), Math.max(...allX)];
  const yd = yDomain ?? niceDomain(Math.min(...allY), Math.max(...allY));
  const x = xLog ? logScale([Math.max(1e-9, xd[0]), xd[1]], [m.l, width - m.r]) : linearScale(xd, [m.l, width - m.r]);
  const y = linearScale(yd, [height - m.b, m.t]);
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? (s.muted ? 'var(--series-muted)' : SERIES[i % SERIES.length]) }));
  const xs = Array.from(new Set(allX)).sort((a, b) => a - b);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const xv = x.invert(px);
    let best = xs[0];
    for (const v of xs) if (Math.abs(x(v) - x(xv)) < Math.abs(x(best) - x(xv))) best = v;
    setHoverX(best);
    setTip({
      x: e.clientX,
      y: e.clientY,
      title: `${xLabel ?? 'x'} = ${formatX(best)}`,
      rows: colored.map((s) => {
        const p = s.points.find((q) => q.x === best);
        return { key: s.label, value: p ? `${formatY(p.y)}${p.flag && p.flag !== 'ok' ? ` (${p.flag})` : ''}` : '—', color: s.color };
      }),
    });
  };
  const table = { columns: [xLabel ?? 'x', ...series.map((s) => s.label)], rows: xs.map((v) => [formatX(v), ...series.map((s) => { const p = s.points.find((q) => q.x === v); return p ? formatY(p.y) : '—'; })]) };
  return (
    <ChartFrame title={title} subtitle={subtitle} legend={<Legend items={colored.map((s) => ({ label: s.label, color: s.color }))} line />} table={table}>
      <div ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => { setTip(null); setHoverX(null); }}>
          {bands?.map((b) => (
            <g key={b.label}>
              <rect x={x(Math.max(b.from, x.domain[0]))} y={m.t} width={Math.max(0, x(Math.min(b.to, x.domain[1])) - x(Math.max(b.from, x.domain[0])))} height={height - m.t - m.b} fill="var(--brass-soft)" opacity={0.6} />
              <text x={x(Math.max(b.from, x.domain[0])) + 4} y={m.t + 12} className="meta" style={{ fill: 'var(--brass)' }}>{b.label}</text>
            </g>
          ))}
          <g className="grid">
            {y.ticks(5).map((tk) => (
              <line key={tk} x1={m.l} x2={width - m.r} y1={y(tk)} y2={y(tk)} />
            ))}
          </g>
          <g className="axis tick">
            <line x1={m.l} x2={width - m.r} y1={height - m.b} y2={height - m.b} />
            {x.ticks(6).map((tk) => (
              <text key={tk} x={x(tk)} y={height - m.b + 16} textAnchor="middle">{formatX(tk)}</text>
            ))}
            {y.ticks(5).map((tk) => (
              <text key={tk} x={m.l - 8} y={y(tk) + 4} textAnchor="end">{formatY(tk)}</text>
            ))}
            {xLabel && <text x={(m.l + width - m.r) / 2} y={height - 4} textAnchor="middle">{xLabel}</text>}
            {yLabel && <text transform={`translate(12 ${(m.t + height - m.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>}
          </g>
          {markers?.map((mk) => (
            <g key={mk.label}>
              <line x1={x(mk.x)} x2={x(mk.x)} y1={m.t} y2={height - m.b} stroke="var(--accent)" strokeWidth={1} />
              <text x={x(mk.x) + 4} y={m.t + 10} className="meta" style={{ fill: 'var(--accent)' }}>{mk.label}</text>
            </g>
          ))}
          {colored.map((s) => {
            const pts = s.points.filter((p) => Number.isFinite(p.y));
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x).toFixed(1)},${y(Math.max(yd[0], Math.min(yd[1], p.y))).toFixed(1)}`).join(' ');
            const last = pts[pts.length - 1];
            return (
              <g key={s.label}>
                <path className="line" d={d} stroke={s.color} />
                {pts.map((p) => (
                  <circle key={p.x} className="marker" cx={x(p.x)} cy={y(Math.max(yd[0], Math.min(yd[1], p.y)))} r={p.flag === 'invalid' ? 3 : 4} fill={p.flag === 'invalid' ? 'var(--chart-surface)' : s.color} stroke={p.flag === 'invalid' ? s.color : 'var(--chart-surface)'} />
                ))}
                {last && colored.length <= 4 && (
                  <text className="label" x={x(last.x) + 8} y={y(Math.max(yd[0], Math.min(yd[1], last.y))) + 4}>{formatY(last.y)}</text>
                )}
              </g>
            );
          })}
          {hoverX !== null && <line className="crosshair" x1={x(hoverX)} x2={x(hoverX)} y1={m.t} y2={height - m.b} />}
        </svg>
      </div>
      <Tooltip state={tip} />
    </ChartFrame>
  );
}
