import { useState } from 'react';
import { ChartFrame } from './ChartFrame.js';
import { Tooltip, type TooltipState } from './Tooltip.js';
import { linearScale, useMeasure, fmtTick } from './common.js';

export interface BarDatum {
  label: string;
  value: number;
  /** optional secondary text shown in the tooltip */
  note?: string;
  color?: string;
}

/** Horizontal single-series bar chart: thin bars, rounded data end, value at the tip, hover tooltip, table twin. */
export function BarChart({ title, subtitle, data, format, unitLabel, maxBars = 14 }: { title: string; subtitle?: string; data: BarDatum[]; format: (v: number) => string; unitLabel?: string; maxBars?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const rows = data.slice(0, maxBars);
  const labelW = Math.min(220, Math.max(80, ...rows.map((d) => d.label.length * 6.5)));
  const barH = 18;
  const gap = 10;
  const height = rows.length * (barH + gap) + 30;
  const max = Math.max(1e-12, ...rows.map((d) => d.value));
  const x = linearScale([0, max * 1.15], [labelW + 8, width - 16]);
  const ticks = x.ticks(4);
  return (
    <ChartFrame title={title} subtitle={subtitle} table={{ columns: ['', unitLabel ?? title], rows: data.map((d) => [d.label, format(d.value)]) }}>
      <div ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <g className="grid">
            {ticks.map((tk) => (
              <line key={tk} x1={x(tk)} x2={x(tk)} y1={4} y2={height - 24} />
            ))}
          </g>
          {rows.map((d, i) => {
            const y = 6 + i * (barH + gap);
            const w = Math.max(0, x(d.value) - x(0));
            const color = d.color ?? 'var(--series-1)';
            const r = Math.min(4, w / 2);
            const path = `M${x(0)},${y} h${Math.max(0, w - r)} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-Math.max(0, w - r)} z`;
            return (
              <g
                key={d.label}
                onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: d.label, rows: [{ key: unitLabel ?? '', value: format(d.value), color }, ...(d.note ? [{ key: '', value: d.note }] : [])] })}
                onPointerLeave={() => setTip(null)}
              >
                <rect className="hit" x={0} y={y - gap / 2} width={width} height={barH + gap} fill="transparent" />
                <text className="label" x={labelW} y={y + barH / 2 + 4} textAnchor="end">
                  {d.label.length > 32 ? `${d.label.slice(0, 31)}…` : d.label}
                </text>
                <path className="bar" d={path} fill={color} />
                <text className="label" x={x(d.value) + 6} y={y + barH / 2 + 4}>
                  {format(d.value)}
                </text>
              </g>
            );
          })}
          <g className="axis tick">
            <line x1={x(0)} x2={width - 16} y1={height - 24} y2={height - 24} />
            {ticks.map((tk) => (
              <text key={tk} x={x(tk)} y={height - 10} textAnchor="middle">
                {fmtTick(tk)}
              </text>
            ))}
          </g>
        </svg>
      </div>
      <Tooltip state={tip} />
    </ChartFrame>
  );
}
