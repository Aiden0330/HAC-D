import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface TableSpec {
  columns: string[];
  rows: (string | number)[][];
}

/** Figure wrapper: title, optional legend, chart/table toggle (the accessibility twin of every chart). */
export function ChartFrame({ title, subtitle, legend, table, children, actions }: { title: string; subtitle?: string; legend?: ReactNode; table: TableSpec; children: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption>
        <div>
          <div className="title">{title}</div>
          {subtitle && <div className="muted" style={{ fontSize: 12 }}>{subtitle}</div>}
        </div>
        <div className="btn-row">
          {actions}
          <button type="button" className="btn small" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? t('common.chart') : t('common.table')}
          </button>
        </div>
      </figcaption>
      {legend}
      {showTable ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={i} className={i > 0 ? 'num' : undefined}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j > 0 ? 'num' : undefined}>{String(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </figure>
  );
}

export function Legend({ items, line }: { items: { label: string; color: string }[]; line?: boolean }) {
  if (items.length < 2) return null;
  return (
    <div className="legend" role="list">
      {items.map((it) => (
        <span className="key" role="listitem" key={it.label}>
          <span className={line ? 'linekey' : 'swatch'} style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
