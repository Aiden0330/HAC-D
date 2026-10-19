import { create } from 'zustand';
import { EXAMPLES, GPU_EXAMPLES, RETIRED_EXAMPLES, parseScenario, type Scenario } from '@hac-d/core';

/** v4 pages: the topology page replaces Scenario + Training as the first page; the audit moved into Mechanisms and Allocation; `scenario` is the advanced editor */
export type Page = 'topology' | 'mechanisms' | 'allocation' | 'library' | 'scenario' | 'inference' | 'spares' | 'compare' | 'simulate' | 'report' | 'import';
export type Theme = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'hacd-scenarios-v1';

function ensureId(s: Scenario, existing: Set<string>): Scenario {
  let id = s.meta.id ?? (s.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario');
  let n = 2;
  const base = id;
  while (existing.has(id)) id = `${base}-${n++}`;
  return { ...s, meta: { ...s.meta, id } };
}

/** v4 the GPU examples of v3.7 leave the NPU tool (the GPU tool is forked at tag v3.7-gpu): saved copies under their ids are dropped once */
const GPU_IDS = new Set(Object.keys(GPU_EXAMPLES));
/** v4.1 the built-in examples are the three topology templates (scale is a parameter): saved copies of the retired examples are dropped while unchanged, edited ones stay as user scenarios */
function isUnchangedRetired(s: Scenario): boolean {
  const make = s.meta.id ? RETIRED_EXAMPLES[s.meta.id] : undefined;
  if (!make) return false;
  try {
    return JSON.stringify(parseScenario(make())) === JSON.stringify(s);
  } catch {
    return false;
  }
}

function loadPersisted(): Scenario[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as unknown[];
    const out: Scenario[] = [];
    for (const item of arr) {
      try {
        const s = parseScenario(item);
        if (s.meta.id && GPU_IDS.has(s.meta.id)) continue;
        if (isUnchangedRetired(s)) continue;
        out.push(s);
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

function builtInScenarios(): Scenario[] {
  const ids = new Set<string>();
  return Object.keys(EXAMPLES).map((k) => {
    const s = ensureId(EXAMPLES[k](), ids);
    ids.add(s.meta.id!);
    return s;
  });
}

/** Persisted scenarios are kept; built-in examples that are missing from them (added by a newer version) are appended. */
function initialScenarios(): Scenario[] {
  const builtIns = builtInScenarios();
  const persisted = loadPersisted();
  if (!persisted) return builtIns;
  const have = new Set(persisted.map((s) => s.meta.id));
  const missing = builtIns.filter((s) => !have.has(s.meta.id));
  if (missing.length) {
    // v4 topology scenarios go first so that the first page opens on one of them
    const topo = missing.filter((s) => s.topology.template);
    const next = [...topo, ...persisted, ...missing.filter((s) => !s.topology.template)];
    persist(next);
    return next;
  }
  return persisted;
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
  /** select the built-in example if it is already in the list, otherwise add it */
  loadExample: (key: string) => void;
  /** overwrite the scenario that carries the example's id with the pristine built-in definition */
  restoreExample: (key: string) => void;
  toggleCompare: (id: string) => void;
  resetToExamples: () => void;
}

export const useStore = create<AppState>((set, get) => {
  const scenarios = initialScenarios();
  return {
    scenarios,
    activeId: scenarios[0]?.meta.id ?? '',
    compareIds: scenarios.slice(0, Math.min(3, scenarios.length)).map((s) => s.meta.id!),
    page: 'topology',
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
      const fresh = f();
      const existing = get().scenarios.find((s) => s.meta.id === fresh.meta.id);
      if (existing) {
        set({ activeId: existing.meta.id! });
        return;
      }
      get().addScenario(fresh, true);
    },
    restoreExample: (key) => {
      const f = EXAMPLES[key];
      if (!f) return;
      const fresh = f();
      const existing = get().scenarios.find((s) => s.meta.id === fresh.meta.id);
      if (!existing) {
        get().addScenario(fresh, true);
        return;
      }
      const next = get().scenarios.map((s) => (s.meta.id === fresh.meta.id ? fresh : s));
      persist(next);
      set({ scenarios: next, activeId: fresh.meta.id! });
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
      const fresh = builtInScenarios();
      set({ scenarios: fresh, activeId: fresh[0].meta.id!, compareIds: fresh.slice(0, 3).map((s) => s.meta.id!) });
    },
  };
});

export function useActiveScenario(): Scenario | undefined {
  return useStore((s) => s.scenarios.find((x) => x.meta.id === s.activeId));
}
