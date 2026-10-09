import { useMemo, useState } from 'react';
import type { Block, BlockResult } from '@hac-d/core';
import { Tooltip, type TooltipState } from '../charts/Tooltip.js';
import { fmtPct, fmtRatePerMillion, fmtHours, type Lang } from '../lib/format.js';

interface Laid {
  w: number;
  h: number;
  render: (x: number, y: number) => React.ReactNode[];
}

const BW = 150;
const BH = 54;
const GAP = 22;
const VGAP = 10;

/** Auto-laid-out reliability block diagram: series = horizontal chain, parallel/k-of-n/standby = stacked boxes with a badge, repeat = box with ×N. */
export function RbdDiagram({ root, result, lang, weakestId }: { root: Block; result: BlockResult; lang: Lang; weakestId?: string }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const byId = useMemo(() => {
    const m = new Map<string, BlockResult>();
    const walk = (r: BlockResult) => {
      m.set(r.id, r);
      r.children.forEach(walk);
    };
    walk(result);
    return m;
  }, [result]);

  const box = (b: Block, cls: string, badge?: string): Laid => ({
    w: BW,
    h: BH,
    render: (x, y) => {
      const r = byId.get(b.id);
      const name = b.name ?? b.id;
      const weak = b.id === weakestId;
      return [
        <g
          key={b.id}
          onPointerMove={(e) =>
            setTip({
              x: e.clientX,
              y: e.clientY,
              title: name,
              rows: r
                ? [
                    { key: 'A', value: fmtPct(r.availability, 4) },
                    { key: 'λ_eq', value: `${fmtRatePerMillion(r.equivalentFailureRate)} /1e6 h` },
                    { key: 'MTTF (new)', value: fmtHours(r.mttfFromNew, lang) },
                    { key: 'MTTR_eq', value: fmtHours(r.equivalentMttr, lang) },
                    ...(r.capacity < r.availability - 1e-9 ? [{ key: 'capacity', value: fmtPct(r.capacity, 4) }] : []),
                  ]
                : [],
            })
          }
          onPointerLeave={() => setTip(null)}
        >
          <rect className={`block ${cls}${weak ? ' weak' : ''}`} x={x} y={y} width={BW} height={BH} rx={6} />
          <text x={x + 8} y={y + 18} style={{ fontWeight: 600 }}>{name.length > 22 ? `${name.slice(0, 21)}…` : name}</text>
          {badge && <text className="meta" x={x + BW - 8} y={y + 18} textAnchor="end" style={{ fill: 'var(--accent)' }}>{badge}</text>}
          {r && <text className="meta" x={x + 8} y={y + 34}>{`A ${fmtPct(r.availability, 3)}`}</text>}
          {r && <text className="meta" x={x + 8} y={y + 47}>{`λ ${fmtRatePerMillion(r.equivalentFailureRate)} /1e6 h`}</text>}
        </g>,
      ];
    },
  });

  const layout = (b: Block): Laid => {
    switch (b.kind) {
      case 'leaf':
        return box(b, 'leaf', b.count && b.count > 1 ? `×${b.count}` : undefined);
      case 'repeat': {
        const inner = layout(b.unit);
        const label = `×${b.count} ${(b.name ?? b.id).replace(/\s*\(.*\)\s*$/, '')}`;
        const lab = label.length > 30 ? `${label.slice(0, 29)}…` : label;
        const fw = Math.max(inner.w + 24, lab.length * 6.2 + 16);
        return {
          w: fw,
          h: inner.h + 26,
          render: (x, y) => [
            <rect key={`${b.id}-frame`} className="block" x={x} y={y} width={fw} height={inner.h + 26} rx={8} style={{ fill: 'none', strokeDasharray: '3 3' }} />,
            <text key={`${b.id}-t`} className="meta" x={x + 8} y={y + 14}>{lab}</text>,
            ...inner.render(x + (fw - inner.w) / 2, y + 20),
          ],
        };
      }
      case 'series': {
        const parts = b.children.map(layout);
        const w = parts.reduce((a, p) => a + p.w, 0) + GAP * Math.max(0, parts.length - 1);
        const h = Math.max(...parts.map((p) => p.h), BH);
        return {
          w,
          h,
          render: (x, y) => {
            const out: React.ReactNode[] = [];
            let cx = x;
            parts.forEach((p, i) => {
              const py = y + (h - p.h) / 2;
              out.push(...p.render(cx, py));
              if (i < parts.length - 1) out.push(<line key={`${b.id}-w${i}`} className="wire" x1={cx + p.w} x2={cx + p.w + GAP} y1={y + h / 2} y2={y + h / 2} />);
              cx += p.w + GAP;
            });
            return out;
          },
        };
      }
      case 'parallel':
      case 'kofn':
      case 'standby': {
        const children = b.kind === 'parallel' ? b.children.map(layout) : [layout(b.unit)];
        const badge = b.kind === 'parallel' ? `1-of-${b.children.length}` : b.kind === 'kofn' ? `${b.k}-of-${b.n}` : `standby ×${b.n}`;
        const rHead = byId.get(b.id);
        const shortName = (b.name ?? b.id).replace(/\s*\(.*\)\s*$/, '');
        const title = `${shortName.length > 26 ? `${shortName.slice(0, 25)}…` : shortName} · ${badge}${rHead ? ` · A ${fmtPct(rHead.availability, 3)}` : ''}`;
        const w = Math.max(Math.max(...children.map((c) => c.w)) + 40, title.length * 6.2 + 16);
        const stackH = children.reduce((a, c) => a + c.h, 0) + VGAP * Math.max(0, children.length - 1);
        const h = stackH + 26;
        return {
          w,
          h,
          render: (x, y) => {
            const out: React.ReactNode[] = [
              <rect key={`${b.id}-frame`} className={`block kofn${b.id === weakestId ? ' weak' : ''}`} x={x} y={y} width={w} height={h} rx={8} style={{ fill: 'none' }} />,
              <text key={`${b.id}-badge`} className="meta" x={x + 8} y={y + 14} style={{ fill: 'var(--accent)', fontWeight: 600 }}>{title}</text>,
            ];
            let cy = y + 20;
            const inner = Math.max(...children.map((c) => c.w));
            const left = x + (w - inner) / 2;
            children.forEach((c, i) => {
              out.push(<line key={`${b.id}-l${i}`} className="wire" x1={x} x2={left} y1={cy + c.h / 2} y2={cy + c.h / 2} />);
              out.push(<line key={`${b.id}-r${i}`} className="wire" x1={left + c.w} x2={x + w} y1={cy + c.h / 2} y2={cy + c.h / 2} />);
              out.push(...c.render(left, cy));
              cy += c.h + VGAP;
            });
            return out;
          },
        };
      }
    }
  };

  const laid = useMemo(() => layout(root), [root, result, weakestId, lang]);
  const pad = 12;
  return (
    <div className="rbd" style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${laid.w + 2 * pad} ${laid.h + 2 * pad}`} width={Math.max(600, laid.w + 2 * pad)} height={laid.h + 2 * pad} role="img" aria-label="reliability block diagram">
        {laid.render(pad, pad)}
      </svg>
      <Tooltip state={tip} />
    </div>
  );
}
