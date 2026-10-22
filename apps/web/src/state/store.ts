import { create } from 'zustand';
import { EXAMPLES, GPU_EXAMPLES, RETIRED_EXAMPLES, parseScenario, type Scenario } from '@hac-d/core';
import { defaultProjectSettings, normalizeSettings, applySettingsPatch, type ProjectSettings, type SettingsPatch } from './settings.js';

export type { ProjectSettings, SettingsPatch } from './settings.js';
export { defaultProjectSettings } from './settings.js';

/**
 * v5.1 pages: Projects (load / save / switch) first, then the main flow topology → allocation → mechanism library → fault library;
 * `scenario` is the advanced editor
 */
export type Page = 'projects' | 'topology' | 'mechanisms' | 'allocation' | 'library' | 'scenario' | 'inference' | 'spares' | 'compare' | 'simulate' | 'report' | 'import';
export type Theme = 'auto' | 'light' | 'dark';

/** v5.1 a project = a scenario + its page settings; the list, the active id and the built-ins already offered are stored under one key */
const STORAGE_KEY = 'hacd-projects-v1';
/** the v4 / v5 list of bare scenarios, migrated once into projects with default settings */
const LEGACY_KEY = 'hacd-scenarios-v1';
const STORE_VERSION = 'hacd-projects-1';
export const BUNDLE_VERSION = 'hacd-project-1';

export interface ProjectMeta {
  /** epoch ms of the last edit of the scenario or the settings; undefined for a pristine built-in or a migrated scenario */
  modified?: number;
}

/** an exported project: the scenario and the page settings (import also accepts a bare scenario JSON) */
export interface ProjectBundle {
  version: typeof BUNDLE_VERSION;
  scenario: Scenario;
  settings: ProjectSettings;
}

interface StoredProject { scenario: unknown; settings?: unknown; modified?: unknown }
interface StoredProjects { version: string; activeId?: string; builtIns?: string[]; projects: StoredProject[] }

function ensureId(s: Scenario, existing: Set<string>): Scenario {
  let id = s.meta.id ?? (s.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario');
  let n = 2;
  const base = id;
  while (existing.has(id)) id = `${base}-${n++}`;
  return { ...s, meta: { ...s.meta, id } };
}

/** v4 the GPU examples of v3.7 leave the NPU tool (the GPU tool is forked at tag v3.7-gpu): saved copies under their ids are dropped once */
const GPU_IDS = new Set(Object.keys(GPU_EXAMPLES));
/** v4.1 the built-in examples are the topology templates (scale is a parameter): saved copies of the retired examples are dropped while unchanged, edited ones stay as user scenarios */
function isUnchangedRetired(s: Scenario): boolean {
  const make = s.meta.id ? RETIRED_EXAMPLES[s.meta.id] : undefined;
  if (!make) return false;
  try {
    return JSON.stringify(parseScenario(make())) === JSON.stringify(s);
  } catch {
    return false;
  }
}

/**
 * v4.2 the Atlas 950 template follows the 1,024-NPU SuperPoD of the product page: a saved v4.1 copy (the 8,192-NPU two-level CloudMatrix384
 * estimate, preset 'atlas950') is kept as a user scenario under its own id and name, no longer bound to the template, and the new
 * built-in is appended
 */
function migrateV41Atlas950(s: Scenario): Scenario {
  const sp = s.topology.superpod;
  if (s.topology.template !== 'a950-ub2' || sp?.preset !== 'atlas950' || sp.fabric !== 'two-level') return s;
  const id = s.meta.id === 'topology-a950-ub2' ? 'topology-a950-ub2-v41' : s.meta.id;
  const name = s.meta.name.replace(/( — [\d,]+ NPUs)?$/, ' (v4.1 two-level estimate)$1');
  return { ...s, meta: { ...s.meta, id, name }, topology: { ...s.topology, template: undefined } };
}

/** a saved scenario through the version filters (GPU ids, unchanged retired examples, the v4.1 Atlas 950); undefined = dropped */
function loadScenario(item: unknown): Scenario | undefined {
  try {
    const s = parseScenario(item);
    if (s.meta.id && GPU_IDS.has(s.meta.id)) return undefined;
    if (isUnchangedRetired(s)) return undefined;
    return migrateV41Atlas950(s);
  } catch {
    return undefined;
  }
}

interface ProjectsState {
  scenarios: Scenario[];
  settings: Record<string, ProjectSettings>;
  projectMeta: Record<string, ProjectMeta>;
  activeId: string;
  /** ids of the built-in examples already offered: a built-in the user deleted is not re-added, one added by a newer version is */
  builtIns: string[];
}

function builtInScenarios(): Scenario[] {
  const ids = new Set<string>();
  return Object.keys(EXAMPLES).map((k) => {
    const s = ensureId(EXAMPLES[k](), ids);
    ids.add(s.meta.id!);
    return s;
  });
}

function freshState(): ProjectsState {
  const scenarios = builtInScenarios();
  return { scenarios, settings: Object.fromEntries(scenarios.map((s) => [s.meta.id!, defaultProjectSettings()])), projectMeta: {}, activeId: scenarios[0]?.meta.id ?? '', builtIns: scenarios.map((s) => s.meta.id!) };
}

function readKey(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** the stored projects (new key), or the legacy scenario list migrated (default settings, no modified time); undefined when neither exists */
function loadStored(): (ProjectsState & { migrated: boolean }) | undefined {
  const cur = readKey(STORAGE_KEY) as StoredProjects | undefined;
  const ids = new Set<string>();
  const scenarios: Scenario[] = [];
  const settings: Record<string, ProjectSettings> = {};
  const projectMeta: Record<string, ProjectMeta> = {};
  const push = (raw: unknown, set: unknown, modified: unknown) => {
    const s0 = loadScenario(raw);
    if (!s0) return;
    const s = ensureId(s0, ids);
    ids.add(s.meta.id!);
    scenarios.push(s);
    settings[s.meta.id!] = normalizeSettings(set);
    projectMeta[s.meta.id!] = typeof modified === 'number' && Number.isFinite(modified) ? { modified } : {};
  };
  if (cur && typeof cur === 'object' && Array.isArray(cur.projects)) {
    for (const p of cur.projects) if (p && typeof p === 'object') push(p.scenario, p.settings, p.modified);
    if (!scenarios.length) return undefined;
    const activeId = typeof cur.activeId === 'string' && ids.has(cur.activeId) ? cur.activeId : scenarios[0].meta.id!;
    const builtIns = Array.isArray(cur.builtIns) ? cur.builtIns.filter((x): x is string => typeof x === 'string') : [];
    return { scenarios, settings, projectMeta, activeId, builtIns, migrated: false };
  }
  const legacy = readKey(LEGACY_KEY);
  if (!Array.isArray(legacy)) return undefined;
  for (const item of legacy) push(item, undefined, undefined);
  if (!scenarios.length) return undefined;
  // the legacy list never recorded which built-ins were offered: every missing built-in is appended once, as before
  return { scenarios, settings, projectMeta, activeId: scenarios[0].meta.id!, builtIns: [], migrated: true };
}

function persist(st: ProjectsState): void {
  const data: StoredProjects = {
    version: STORE_VERSION,
    activeId: st.activeId,
    builtIns: st.builtIns,
    projects: st.scenarios.map((s) => ({ scenario: s, settings: st.settings[s.meta.id!] ?? defaultProjectSettings(), ...(st.projectMeta[s.meta.id!]?.modified ? { modified: st.projectMeta[s.meta.id!].modified } : {}) })),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Stored projects are kept; built-in examples never offered before (added by a newer version) are appended; the legacy list is migrated once. */
function initialProjects(): ProjectsState {
  const stored = loadStored();
  if (!stored) {
    const fresh = freshState();
    persist(fresh);
    return fresh;
  }
  const { migrated, ...st } = stored;
  const builtIns = builtInScenarios();
  const have = new Set(st.scenarios.map((s) => s.meta.id));
  const offered = new Set(st.builtIns);
  const missing = builtIns.filter((s) => !have.has(s.meta.id) && !offered.has(s.meta.id!));
  let next: ProjectsState = { ...st, builtIns: [...new Set([...st.builtIns, ...builtIns.map((s) => s.meta.id!)])] };
  if (missing.length) {
    // v4 topology scenarios go first so that the first page opens on one of them
    const topo = missing.filter((s) => s.topology.template);
    const scenarios = [...topo, ...st.scenarios, ...missing.filter((s) => !s.topology.template)];
    const settings = { ...st.settings };
    for (const s of missing) settings[s.meta.id!] = defaultProjectSettings();
    next = { ...next, scenarios, settings, activeId: migrated ? scenarios[0].meta.id! : st.activeId };
  }
  persist(next);
  if (migrated) {
    // moved into the projects key (written above): the legacy key goes so that a later reset does not bring the old list back
    try {
      if (localStorage.getItem(STORAGE_KEY)) localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
  }
  return next;
}

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('hacd-theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

/** a deep copy through JSON (scenarios and settings are plain data) */
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** the bundle of a project, or a bare scenario, read from JSON text (throws on an invalid scenario) */
export function parseProjectJson(text: string): { scenario: Scenario; settings: ProjectSettings } {
  const obj = JSON.parse(text) as unknown;
  if (obj && typeof obj === 'object' && (obj as { version?: unknown }).version === BUNDLE_VERSION && 'scenario' in obj) {
    const b = obj as { scenario: unknown; settings?: unknown };
    return { scenario: parseScenario(b.scenario), settings: normalizeSettings(b.settings) };
  }
  return { scenario: parseScenario(obj), settings: defaultProjectSettings() };
}

interface AppState extends ProjectsState {
  page: Page;
  theme: Theme;
  setPage: (p: Page) => void;
  setTheme: (t: Theme) => void;
  setActive: (id: string) => void;
  /** add a project (default settings unless given); returns its id */
  addScenario: (s: Scenario, activate?: boolean, settings?: ProjectSettings) => string;
  updateActive: (fn: (s: Scenario) => Scenario) => void;
  replaceScenario: (id: string, s: Scenario) => void;
  removeScenario: (id: string) => void;
  duplicateActive: () => void;
  /** copy a project (scenario and settings) and activate the copy; returns its id */
  duplicateProject: (id: string) => string | undefined;
  renameProject: (id: string, name: string) => void;
  /** select the built-in example if it is already in the list, otherwise add it */
  loadExample: (key: string) => void;
  /** overwrite the project that carries the example's id with the pristine built-in definition (default settings) and activate it */
  restoreExample: (key: string) => void;
  /** the built-in project back to its template definition and default settings (the active project stays) */
  resetProject: (id: string) => void;
  updateActiveSettings: (patch: SettingsPatch | ((s: ProjectSettings) => ProjectSettings)) => void;
  /** Compare page: add or remove a project from the active project's comparison set (at most four) */
  toggleCompare: (id: string) => void;
  /** import a project bundle or a bare scenario JSON as a new project (activated); throws on invalid input */
  importProject: (text: string) => string;
  exportProject: (id: string) => ProjectBundle | undefined;
  resetToExamples: () => void;
}

/** the comparison set of a project: its stored ids that still exist, or the first three projects */
export function compareIdsOf(st: Pick<ProjectsState, 'scenarios'>, settings: ProjectSettings): string[] {
  const all = st.scenarios.map((s) => s.meta.id!);
  return settings.compare.ids ? settings.compare.ids.filter((id) => all.includes(id)) : all.slice(0, Math.min(3, all.length));
}

export const useStore = create<AppState>((set, get) => {
  const initial = initialProjects();
  const commit = (patch: Partial<ProjectsState>) => {
    const st = get();
    const next: ProjectsState = { scenarios: st.scenarios, settings: st.settings, projectMeta: st.projectMeta, activeId: st.activeId, builtIns: st.builtIns, ...patch };
    persist(next);
    set(patch);
  };
  const touched = (ids: string[]) => {
    const meta = { ...get().projectMeta };
    const now = Date.now();
    for (const id of ids) meta[id] = { ...(meta[id] ?? {}), modified: now };
    return meta;
  };
  return {
    ...initial,
    page: 'projects',
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
    setActive: (activeId) => {
      if (get().scenarios.some((s) => s.meta.id === activeId)) commit({ activeId });
    },
    addScenario: (s, activate = true, settings) => {
      const ids = new Set(get().scenarios.map((x) => x.meta.id!));
      const withId = ensureId(s, ids);
      const id = withId.meta.id!;
      commit({ scenarios: [...get().scenarios, withId], settings: { ...get().settings, [id]: settings ?? defaultProjectSettings() }, projectMeta: touched([id]), ...(activate ? { activeId: id } : {}) });
      return id;
    },
    updateActive: (fn) => {
      const { scenarios, activeId } = get();
      commit({ scenarios: scenarios.map((s) => (s.meta.id === activeId ? parseScenario(fn(s)) : s)), projectMeta: touched([activeId]) });
    },
    replaceScenario: (id, s) => {
      commit({ scenarios: get().scenarios.map((x) => (x.meta.id === id ? { ...s, meta: { ...s.meta, id } } : x)), projectMeta: touched([id]) });
    },
    removeScenario: (id) => {
      const { scenarios, activeId } = get();
      if (scenarios.length <= 1) return;
      const next = scenarios.filter((s) => s.meta.id !== id);
      const settings = { ...get().settings };
      delete settings[id];
      for (const [k, v] of Object.entries(settings)) if (v.compare.ids?.includes(id)) settings[k] = { ...v, compare: { ...v.compare, ids: v.compare.ids.filter((x) => x !== id) } };
      const projectMeta = { ...get().projectMeta };
      delete projectMeta[id];
      commit({ scenarios: next, settings, projectMeta, activeId: activeId === id ? next[0]?.meta.id ?? '' : activeId });
    },
    duplicateProject: (id) => {
      const s = get().scenarios.find((x) => x.meta.id === id);
      if (!s) return undefined;
      const copy = clone(s);
      copy.meta = { ...copy.meta, id: undefined, name: `${copy.meta.name} (copy)` };
      return get().addScenario(copy, true, clone(get().settings[id] ?? defaultProjectSettings()));
    },
    duplicateActive: () => {
      get().duplicateProject(get().activeId);
    },
    renameProject: (id, name) => {
      const n = name.trim();
      if (!n) return;
      commit({ scenarios: get().scenarios.map((s) => (s.meta.id === id ? { ...s, meta: { ...s.meta, name: n } } : s)), projectMeta: touched([id]) });
    },
    loadExample: (key) => {
      const f = EXAMPLES[key];
      if (!f) return;
      const fresh = f();
      const existing = get().scenarios.find((s) => s.meta.id === fresh.meta.id);
      if (existing) {
        get().setActive(existing.meta.id!);
        return;
      }
      get().addScenario(fresh, true);
    },
    resetProject: (id) => {
      const f = EXAMPLES[id];
      if (!f || !get().scenarios.some((s) => s.meta.id === id)) return;
      const fresh = f();
      const projectMeta = { ...get().projectMeta };
      delete projectMeta[id];
      commit({ scenarios: get().scenarios.map((s) => (s.meta.id === id ? fresh : s)), settings: { ...get().settings, [id]: defaultProjectSettings() }, projectMeta });
    },
    restoreExample: (key) => {
      const f = EXAMPLES[key];
      if (!f) return;
      const id = f().meta.id!;
      if (!get().scenarios.some((s) => s.meta.id === id)) {
        get().addScenario(f(), true);
        return;
      }
      get().resetProject(id);
      get().setActive(id);
    },
    updateActiveSettings: (patch) => {
      const { activeId, settings } = get();
      const cur = settings[activeId] ?? defaultProjectSettings();
      const next = typeof patch === 'function' ? patch(cur) : applySettingsPatch(cur, patch);
      commit({ settings: { ...settings, [activeId]: next }, projectMeta: touched([activeId]) });
    },
    toggleCompare: (id) => {
      get().updateActiveSettings((s) => {
        const cur = compareIdsOf(get(), s);
        return { ...s, compare: { ...s.compare, ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-4) } };
      });
    },
    importProject: (text) => {
      const { scenario, settings } = parseProjectJson(text);
      return get().addScenario(scenario, true, settings);
    },
    exportProject: (id) => {
      const s = get().scenarios.find((x) => x.meta.id === id);
      if (!s) return undefined;
      return { version: BUNDLE_VERSION, scenario: clone(s), settings: clone(get().settings[id] ?? defaultProjectSettings()) };
    },
    resetToExamples: () => {
      const fresh = freshState();
      persist(fresh);
      set(fresh);
    },
  };
});

export function useActiveScenario(): Scenario | undefined {
  return useStore((s) => s.scenarios.find((x) => x.meta.id === s.activeId));
}

const FALLBACK_SETTINGS = defaultProjectSettings();
/** the active project's page settings (stable reference while unchanged) */
export function useActiveSettings(): ProjectSettings {
  return useStore((s) => s.settings[s.activeId] ?? FALLBACK_SETTINGS);
}
