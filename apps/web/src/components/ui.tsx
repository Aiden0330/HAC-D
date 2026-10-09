import type { ReactNode } from 'react';

export function Kpi({ label, value, note, tone, hero }: { label: string; value: string; note?: string; tone?: 'bad' | 'warn'; hero?: boolean }) {
  return (
    <div className={`kpi${hero ? ' hero' : ''}`}>
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export function Card({ title, sub, children, actions, formula }: { title?: string; sub?: string; children: ReactNode; actions?: ReactNode; formula?: string }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header>
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
          </div>
          {actions}
        </header>
      )}
      {children}
      {formula && <div className="formula">{formula}</div>}
    </section>
  );
}

export function Badge({ status, children }: { status: string; children: ReactNode }) {
  const icon = status === 'pass' || status === 'measured' ? '✓' : status === 'fail' || status === 'assumed' ? '✕' : status === 'warn' || status === 'vendor' || status === 'scan-level' || status === 'derived' || status === 'paper-reported' ? '!' : '•';
  return (
    <span className={`badge ${status}`}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function NumberInput({ value, onChange, step, min, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      step={step ?? 'any'}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function DataTable({ columns, rows, numericFrom = 1, highlight }: { columns: string[]; rows: (string | number | ReactNode)[][]; numericFrom?: number; highlight?: (row: number) => boolean }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={i >= numericFrom ? 'num' : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={highlight?.(i) ? 'best' : undefined}>
              {r.map((c, j) => (
                <td key={j} className={j >= numericFrom ? 'num' : undefined}>{c as ReactNode}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
