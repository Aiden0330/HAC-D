import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type Page, type Theme } from './state/store.js';
import { setLanguage } from './i18n/index.js';
import { useLang } from './hooks.js';
import { TopologyPage } from './pages/TopologyPage.js';
import { ScenarioPage } from './pages/ScenarioPage.js';
import { InferencePage } from './pages/InferencePage.js';
import { AllocationPage } from './pages/AllocationPage.js';
import { LibraryPage } from './pages/LibraryPage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { MechanismsPage } from './pages/MechanismsPage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';

/**
 * v5.2 one place per function, 12 pages → 8. Main flow: projects (list / new / import / compare) → topology & hardware → allocation →
 * mechanism library → fault library → review (checklist / simulation / sensitivity); behind "All pages": the scenario editor and
 * inference & spares (every function also stays in the CLI / MCP). The former Compare, Simulate, Report, Spares and Import pages are
 * tabs or sections now: Projects › Import and › Compare, Review › Checklist, › Simulation and › Sensitivity, Inference & spares.
 */
const PAGES: Page[] = ['projects', 'topology', 'allocation', 'mechanisms', 'library', 'review', 'scenario', 'inference'];
const MINIMAL_HIDDEN: Page[] = ['scenario', 'inference'];
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
  const activeName = useStore((s) => s.scenarios.find((x) => x.meta.id === s.activeId)?.meta.name ?? '');
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
  // switching to Minimal leaves a hidden page; a link to a hidden page (the scenario editor from the Topology page) still opens it
  useEffect(() => {
    if (!visiblePages.includes(page)) setPage('projects');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMode]);

  return (
    <div className="app">
      <div className="chrome">
        <header className="topbar">
          <div className="brand">
            <span className="eyebrow">{t('app.eyebrow')}</span>
            <h1>{t('app.title')}</h1>
          </div>
          <button type="button" className="project-link" onClick={() => setPage('projects')} title={t('app.projectHint')} aria-label={`${t('app.projectLabel')}: ${activeName}`}>
            <span className="muted">{t('app.projectLabel')}</span>
            <span className="project-name">{activeName}</span>
            <span aria-hidden="true">›</span>
          </button>
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
        {page === 'projects' && <ProjectsPage />}
        {page === 'topology' && <TopologyPage />}
        {page === 'scenario' && <ScenarioPage />}
        {page === 'mechanisms' && <MechanismsPage />}
        {page === 'inference' && <InferencePage />}
        {page === 'allocation' && <AllocationPage />}
        {page === 'library' && <LibraryPage />}
        {page === 'review' && <ReviewPage />}
        <footer className="site">{t('app.footer')}</footer>
      </main>
    </div>
  );
}
