import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type Page, type Theme } from './state/store.js';
import { setLanguage } from './i18n/index.js';
import { useLang } from './hooks.js';
import { TopologyPage } from './pages/TopologyPage.js';
import { ScenarioPage } from './pages/ScenarioPage.js';
import { InferencePage } from './pages/InferencePage.js';
import { SparesPage } from './pages/SparesPage.js';
import { AllocationPage } from './pages/AllocationPage.js';
import { ComparePage } from './pages/ComparePage.js';
import { SimulatePage } from './pages/SimulatePage.js';
import { ReportPage } from './pages/ReportPage.js';
import { LibraryPage } from './pages/LibraryPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { MechanismsPage } from './pages/MechanismsPage.js';

/** v4 main flow: topology & hardware → mechanisms → allocation → fault library; the rest is behind "All pages" (and in the CLI / MCP) */
const PAGES: Page[] = ['topology', 'mechanisms', 'allocation', 'library', 'scenario', 'compare', 'simulate', 'report', 'inference', 'spares', 'import'];
const MINIMAL_HIDDEN: Page[] = ['scenario', 'compare', 'simulate', 'report', 'inference', 'spares', 'import'];
type UiMode = 'minimal' | 'full';
const UI_MODE_KEY = 'hacd-ui-mode';
function readUiMode(): UiMode {
  try {
    return localStorage.getItem(UI_MODE_KEY) === 'full' ? 'full' : 'minimal';
  } catch {
    return 'minimal';
  }
}

export function App() {
  const { t } = useTranslation();
  const lang = useLang();
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const scenarios = useStore((s) => s.scenarios);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const [uiMode, setUiModeState] = useState<UiMode>(readUiMode);
  const setUiMode = (m: UiMode) => {
    setUiModeState(m);
    try {
      localStorage.setItem(UI_MODE_KEY, m);
    } catch {
      /* private mode: the choice lasts for the session */
    }
  };
  const visiblePages = uiMode === 'minimal' ? PAGES.filter((p) => !MINIMAL_HIDDEN.includes(p)) : PAGES;
  useEffect(() => {
    if (!visiblePages.includes(page)) setPage('topology');
  }, [uiMode, page, visiblePages, setPage]);

  return (
    <div className="app">
      <div className="chrome">
        <header className="topbar">
          <div className="brand">
            <span className="eyebrow">{t('app.eyebrow')}</span>
            <h1>{t('app.title')}</h1>
          </div>
          <div className="field scenario-select" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label htmlFor="scenario-select" className="muted">{t('app.scenarioLabel')}</label>
            <select id="scenario-select" value={activeId} onChange={(e) => setActive(e.target.value)}>
              {scenarios.map((s) => (
                <option key={s.meta.id} value={s.meta.id}>{scenarios.filter((x) => x.meta.name === s.meta.name).length > 1 ? `${s.meta.name} [${s.meta.id}]` : s.meta.name}</option>
              ))}
            </select>
          </div>
          <div className="spacer" />
          <div className="btn-row" role="group" aria-label="theme">
            {(['auto', 'light', 'dark'] as Theme[]).map((th) => (
              <button key={th} type="button" className="btn small" aria-pressed={theme === th} onClick={() => setTheme(th)}>{t(`theme.${th}`)}</button>
            ))}
          </div>
          <div className="btn-row" role="group" aria-label="pages shown" title={t('ui.hint')}>
            <button type="button" className="btn small" aria-pressed={uiMode === 'minimal'} onClick={() => setUiMode('minimal')}>{t('ui.minimal')}</button>
            <button type="button" className="btn small" aria-pressed={uiMode === 'full'} onClick={() => setUiMode('full')}>{t('ui.full')}</button>
          </div>
          <div className="btn-row" role="group" aria-label="language">
            <button type="button" className="btn small" aria-pressed={lang === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
            <button type="button" className="btn small" aria-pressed={lang === 'en'} onClick={() => setLanguage('en')}>EN</button>
          </div>
        </header>
        <nav className="nav" aria-label="pages">
          {visiblePages.map((p) => (
            <button key={p} type="button" aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>{t(`nav.${p}`)}</button>
          ))}
        </nav>
      </div>
      <main>
        {page === 'topology' && <TopologyPage />}
        {page === 'scenario' && <ScenarioPage />}
        {page === 'mechanisms' && <MechanismsPage />}
        {page === 'inference' && <InferencePage />}
        {page === 'spares' && <SparesPage />}
        {page === 'allocation' && <AllocationPage />}
        {page === 'compare' && <ComparePage />}
        {page === 'simulate' && <SimulatePage />}
        {page === 'report' && <ReportPage />}
        {page === 'library' && <LibraryPage />}
        {page === 'import' && <ImportPage />}
        <footer className="site">{t('app.footer')}</footer>
      </main>
    </div>
  );
}
