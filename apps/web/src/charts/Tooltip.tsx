import { createPortal } from 'react-dom';

export interface TooltipRow {
  key: string;
  value: string;
  color?: string;
}

export interface TooltipState {
  x: number;
  y: number;
  title?: string;
  rows: TooltipRow[];
}

export function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  const vw = window.innerWidth;
  const left = state.x + 240 > vw ? state.x - 250 : state.x + 12;
  return createPortal(
    <div className="tooltip" role="status" style={{ left, top: state.y + 12 }}>
      {state.title && <div className="t-title">{state.title}</div>}
      {state.rows.map((r, i) => (
        <div className="t-row" key={i}>
          <span className="k">
            {r.color && <span className="linekey" style={{ background: r.color, width: 14, height: 2, display: 'inline-block' }} />}
            {r.key}
          </span>
          <span className="v">{r.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
