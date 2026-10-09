import { create } from 'zustand';
import { EXAMPLES, parseScenario, type Scenario } from '@hac-d/core';

export type Page = 'scenario' | 'library' | 'training' | 'inference' | 'spares' | 'allocation' | 'compare' | 'simulate' | 'report';
export type Theme = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'hacd-scenarios-v1';

function ensureId(s: Scenario, existing: Set<string>): Scenario {
  let id = s.meta.id ?? (s.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario');
  let n = 2;
  const base = id;
  while (existing.has(id)) id = `${base}-${n++}`;
  return { ...s, meta: { ...s.meta, id } };
}

function loadPersisted(): Scenario[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as unknown[];
    const out: Scenario[] = [];
    for (const item of arr) {
      try {
        out.push(parseScenario(item));
      } catch {
        /* skip invalid */
      }
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function persist(scenarios: Scenario[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
  } catch {
    /* ignore quota / private mode */
  }
}

function initialScenarios(): Scenario[] {
  const persisted = loadPersisted();
  if (persisted) return persisted;
  const ids = new Set<string>();
  return Object.keys(EXAMPLES).map((k) => {
    const s = ensureId(EXAMPLES[k](), ids);
    ids.add(s.meta.id!);
    return s;
  });
}

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('hacd-theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

interface AppState {
  scenarios: Scenario[];
  activeId: string;
  compareIds: string[];
  page: Page;
  theme: Theme;
  setPage: (p: Page) => void;
  setTheme: (t: Theme) => void;
  setActive: (id: string) => void;
  addScenario: (s: Scenario, activate?: boolean) => string;
  updateActive: (fn: (s: Scenario) => Scenario) => void;
  replaceScenario: (id: string, s: Scenario) => void;
  removeScenario: (id: string) => void;
  duplicateActive: () => void;
  loadExample: (key: string) => void;
  toggleCompare: (id: string) => void;
  resetToExamples: () => void;
}

export const useStore = create<AppState>((set, get) => {
  const scenarios = initialScenarios();
  return {
    scenarios,
    activeId: scenarios[0]?.meta.id ?? '',
    compareIds: scenarios.slice(0, Math.min(3, scenarios.length)).map((s) => s.meta.id!),
    page: 'scenario',
    theme: initialTheme(),
    setPage: (page) => set({ page }),
    setTheme: (theme) => {
      try {
        if (theme === 'auto') {
          localStorage.removeItem('hacd-theme');
          document.documentElement.removeAttribute('data-theme');
        } else {
          localStorage.setItem('hacd-theme', theme);
          document.documentElement.setAttribute('data-theme', theme);
        }
      } catch {
        /* ignore */
      }
      set({ theme });
    },
    setActive: (activeId) => set({ activeId }),
    addScenario: (s, activate = true) => {
      const ids = new Set(get().scenarios.map((x) => x.meta.id!));
      const withId = ensureId(s, ids);
      const next = [...get().scenarios, withId];
      persist(next);
      set({ scenarios: next, ...(activate ? { activeId: withId.meta.id! } : {}) });
      return withId.meta.id!;
    },
    updateActive: (fn) => {
      const { scenarios, activeId } = get();
      const next = scenarios.map((s) => (s.meta.id === activeId ? parseScenario(fn(s)) : s));
      persist(next);
      set({ scenarios: next });
    },
    replaceScenario: (id, s) => {
      const next = get().scenarios.map((x) => (x.meta.id === id ? { ...s, meta: { ...s.meta, id } } : x));
      persist(next);
      set({ scenarios: next });
    },
    removeScenario: (id) => {
      const next = get().scenarios.filter((s) => s.meta.id !== id);
      persist(next);
      set({ scenarios: next, activeId: get().activeId === id ? next[0]?.meta.id ?? '' : get().activeId, compareIds: get().compareIds.filter((x) => x !== id) });
    },
    duplicateActive: () => {
      const s = get().scenarios.find((x) => x.meta.id === get().activeId);
      if (!s) return;
      const copy = JSON.parse(JSON.stringify(s)) as Scenario;
      copy.meta = { ...copy.meta, id: undefined, name: `${copy.meta.name} (copy)` };
      get().addScenario(copy, true);
    },
    loadExample: (key) => {
      const f = EXAMPLES[key];
      if (!f) return;
      get().addScenario(f(), true);
    },
    toggleCompare: (id) => {
      const cur = get().compareIds;
      set({ compareIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-4) });
    },
    resetToExamples: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      const ids = new Set<string>();
      const fresh = Object.keys(EXAMPLES).map((k) => {
        const s = ensureId(EXAMPLES[k](), ids);
        ids.add(s.meta.id!);
        return s;
      });
      set({ scenarios: fresh, activeId: fresh[0].meta.id!, compareIds: fresh.slice(0, 3).map((s) => s.meta.id!) });
    },
  };
});

export function useActiveScenario(): Scenario | undefined {
  return useStore((s) => s.scenarios.find((x) => x.meta.id === s.activeId));
}
