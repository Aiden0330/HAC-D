import { useState } from 'react';
import { ChartFrame, Legend } from './ChartFrame.js';
import { Tooltip, type TooltipState } from './Tooltip.js';
import { useMeasure, SERIES } from './common.js';

export interface Segment {
  label: string;
  value: number;
}

/** One horizontal part-to-whole bar (e.g. loss decomposition) with 2px surface gaps and a legend. */
export function StackedBar({ title, subtitle, segments, total, format }: { title: string; subtitle?: string; segments: Segment[]; total?: number; format: (v: number) => string }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0);
  const h = 26;
  const pad = 4;
  let xAcc = pad;
  const inner = width - 2 * pad;
  const items = segments.map((s, i) => ({ ...s, color: SERIES[i % SERIES.length] }));
  return (
    <ChartFrame title={title} subtitle={subtitle} legend={<Legend items={items.map((s) => ({ label: s.label, color: s.color }))} />} table={{ columns: ['', title], rows: segments.map((s) => [s.label, format(s.value)]) }}>
      <div ref={ref}>
        <svg viewBox={`0 0 ${width} ${h + 24}`} role="img" aria-label={title}>
          {items.map((s, i) => {
            const w = sum > 0 ? (s.value / sum) * inner : 0;
            const x0 = xAcc;
            xAcc += w;
            const gapW = Math.max(0, w - (i < items.length - 1 ? 2 : 0));
            const r = 4;
            const first = i === 0;
            const last = i === items.length - 1;
            const path = `M${x0 + (first ? r : 0)},${pad} h${Math.max(0, gapW - (first ? r : 0) - (last ? r : 0))} ${last ? `a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 ${-r},${r}` : `v${h}`} h${-Math.max(0, gapW - (first ? r : 0) - (last ? r : 0))} ${first ? `a${r},${r} 0 0 1 ${-r},${-r} v${-(h - 2 * r)} a${r},${r} 0 0 1 ${r},${-r}` : `v${-h}`} z`;
            const labelFits = gapW > 64;
            return (
              <g key={s.label} onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: s.label, rows: [{ key: title, value: format(s.value), color: s.color }, { key: '%', value: `${sum > 0 ? ((100 * s.value) / sum).toFixed(1) : '0'} %` }] })} onPointerLeave={() => setTip(null)}>
                <path className="bar" d={path} fill={s.color} />
                {labelFits && (
                  <text x={x0 + gapW / 2} y={pad + h / 2 + 4} textAnchor="middle" style={{ fill: '#fff', fontWeight: 600 }}>
                    {format(s.value)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <Tooltip state={tip} />
    </ChartFrame>
  );
}
