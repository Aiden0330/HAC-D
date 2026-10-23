import { useTranslation } from 'react-i18next';
import { useStore, useActiveSettings } from '../state/store.js';
import type { ReviewTab } from '../state/settings.js';
import { ChecklistPanel } from '../panels/ChecklistPanel.js';
import { SimulatePanel } from '../panels/SimulatePanel.js';
import { TornadoPanel } from '../panels/TornadoPanel.js';

type Tab = ReviewTab;

/**
 * v5.2 design review of the active project, in one place: the 11-item checklist with original vs compensated, the block diagram,
 * importance and cut sets and the exports (formerly the Report page); the Monte Carlo verification against the closed form
 * (formerly the Simulate page); the one-at-a-time sensitivity (formerly the tornado of the Compare page). The tab is a page setting
 * of the project (`review.tab`).
 */
export function ReviewPage() {
  const { t } = useTranslation();
  const tab = useActiveSettings().review.tab;
  const updateSettings = useStore((s) => s.updateActiveSettings);
  const setTab = (k: Tab) => updateSettings({ review: { tab: k } });
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="page-title">
        <h1>{t('review.title')}</h1>
        <span className="sub">{t('review.sub')}</span>
      </div>
      <div className="tabs" role="tablist">
        {(['checklist', 'simulation', 'sensitivity'] as Tab[]).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`review.tab_${k}`)}</button>)}
      </div>
      {tab === 'checklist' && <ChecklistPanel />}
      {tab === 'simulation' && (
        <>
          <div className="muted" style={{ fontSize: 12 }}>{t('simulate.sub')}</div>
          <SimulatePanel />
        </>
      )}
      {tab === 'sensitivity' && <TornadoPanel />}
    </div>
  );
}
