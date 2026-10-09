import { useState } from 'react';
import { ChartFrame } from './ChartFrame.js';
import { Tooltip, type TooltipState } from './Tooltip.js';
import { useMeasure } from './common.js';

const RAMP = ['var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)'];

/** Sequential heat map (one hue, light → dark) with in-cell labels and a table twin. */
export function Heatmap({ title, subtitle, xs, ys, values, formatX, formatY, formatV, xLabel, yLabel }: {
  title: string; subtitle?: string; xs: number[]; ys: number[]; values: number[][]; formatX: (v: number) => string; formatY: (v: number) => string; formatV: (v: number) => string; xLabel?: string; yLabel?: string;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const flat = values.flat().filter(Number.isFinite);
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const left = 80;
  const cellW = (width - left - 12) / xs.length;
  const cellH = 26;
  const height = ys.length * cellH + 44;
  const color = (v: number) => RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.floor(((v - lo) / Math.max(1e-12, hi - lo)) * (RAMP.length - 0.001))))];
  const inkFor = (v: number) => ((v - lo) / Math.max(1e-12, hi - lo) > 0.55 ? '#fff' : 'var(--ink)');
  return (
    <ChartFrame title={title} subtitle={subtitle} table={{ columns: [yLabel ?? '', ...xs.map(formatX)], rows: ys.map((yv, i) => [formatY(yv), ...values[i].map(formatV)]) }}>
      <div ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {ys.map((yv, i) =>
            xs.map((xv, j) => {
              const v = values[i][j];
              return (
                <g key={`${i}-${j}`} onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: `${yLabel ?? 'y'} ${formatY(yv)} · ${xLabel ?? 'x'} ${formatX(xv)}`, rows: [{ key: title, value: formatV(v) }] })} onPointerLeave={() => setTip(null)}>
                  <rect x={left + j * cellW + 1} y={20 + i * cellH + 1} width={Math.max(0, cellW - 2)} height={cellH - 2} rx={3} fill={color(v)} />
                  {cellW > 36 && (
                    <text x={left + j * cellW + cellW / 2} y={20 + i * cellH + cellH / 2 + 4} textAnchor="middle" style={{ fill: inkFor(v), fontVariantNumeric: 'tabular-nums' }}>
                      {formatV(v)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          <g className="tick">
            {xs.map((xv, j) => (
              <text key={j} x={left + j * cellW + cellW / 2} y={12} textAnchor="middle">{formatX(xv)}</text>
            ))}
            {ys.map((yv, i) => (
              <text key={i} x={left - 8} y={20 + i * cellH + cellH / 2 + 4} textAnchor="end">{formatY(yv)}</text>
            ))}
            {xLabel && <text x={left + (cellW * xs.length) / 2} y={height - 6} textAnchor="middle">{xLabel}</text>}
          </g>
        </svg>
      </div>
      <Tooltip state={tip} />
    </ChartFrame>
  );
}
