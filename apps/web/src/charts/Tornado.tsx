import { useState } from 'react';
import { ChartFrame, Legend } from './ChartFrame.js';
import { Tooltip, type TooltipState } from './Tooltip.js';
import { linearScale, useMeasure } from './common.js';

export interface TornadoItem {
  name: string;
  low: number;
  high: number;
  lowLabel?: string;
  highLabel?: string;
}

/** Tornado: for each parameter, the metric at its low and high setting as two shades of one hue around the base value. */
export function Tornado({ title, subtitle, base, items, format, metricLabel, legendLow, legendHigh }: { title: string; subtitle?: string; base: number; items: TornadoItem[]; format: (v: number) => string; metricLabel: string; legendLow?: string; legendHigh?: string }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const labelW = Math.min(260, Math.max(100, ...items.map((d) => d.name.length * 6.2)));
  const barH = 16;
  const gap = 10;
  const height = items.length * (barH + gap) + 34;
  const vals = items.flatMap((d) => [d.low, d.high]).concat(base).filter(Number.isFinite);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 0.01;
  const x = linearScale([lo - pad, hi + pad], [labelW + 8, width - 16]);
  const lowColor = 'var(--seq-300)';
  const highColor = 'var(--seq-600)';
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={<Legend items={[{ label: legendLow ?? `${metricLabel} @ low (×½)`, color: lowColor }, { label: legendHigh ?? `${metricLabel} @ high (×2)`, color: highColor }]} />}
      table={{ columns: ['', 'low', 'high', 'swing'], rows: items.map((d) => [d.name, format(d.low), format(d.high), format(Math.abs(d.high - d.low))]) }}
    >
      <div ref={ref}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <line x1={x(base)} x2={x(base)} y1={4} y2={height - 26} stroke="var(--ink-3)" strokeWidth={1} />
          <text x={x(base)} y={height - 12} textAnchor="middle" className="tick">{`base ${format(base)}`}</text>
          {items.map((d, i) => {
            const y = 6 + i * (barH + gap);
            const seg = (v: number, color: string, lbl: string | undefined) => {
              const a = Math.min(x(base), x(v));
              const w = Math.abs(x(v) - x(base));
              return (
                <g key={lbl} onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: d.name, rows: [{ key: lbl ?? '', value: format(v), color }, { key: 'base', value: format(base) }] })} onPointerLeave={() => setTip(null)}>
                  <rect className="bar" x={a} y={y} width={Math.max(2, w)} height={barH} rx={3} fill={color} />
                </g>
              );
            };
            return (
              <g key={d.name}>
                <text className="label" x={labelW} y={y + barH / 2 + 4} textAnchor="end">{d.name.length > 40 ? `${d.name.slice(0, 39)}…` : d.name}</text>
                {seg(d.low, lowColor, d.lowLabel ?? 'low')}
                {seg(d.high, highColor, d.highLabel ?? 'high')}
              </g>
            );
          })}
        </svg>
      </div>
      <Tooltip state={tip} />
    </ChartFrame>
  );
}
