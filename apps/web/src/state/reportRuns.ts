import { create } from 'zustand';
import type { ReportRun } from '../worker/compute.worker.js';

/**
 * v6.4 the report runs of Allocation › Report, kept outside the panel: a run belongs to a project (keyed by its id) and goes on
 * in the worker while the user switches tabs or pages; the panel re-attaches to the live progress or the finished result when it
 * is shown again. In memory only (a reload drops a run; a saved report lives in IndexedDB, lib/reportStore.ts). `scenarioKey` is
 * the scenario's JSON at the start of the run: a result whose key differs from the project's current scenario is shown as stale.
 */
export interface ReportRunSettings { sizes: number[]; trials: number; permutations: number; target: number }
export interface ReportRunState {
  projectId: string;
  projectName: string;
  scenarioKey: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  progress: string[];
  result?: ReportRun;
  error?: string;
  settings: ReportRunSettings;
}
interface ReportRunsState {
  runs: Record<string, ReportRunState>;
  start: (projectId: string, projectName: string, scenarioKey: string, settings: ReportRunSettings) => void;
  progress: (projectId: string, line: string) => void;
  finish: (projectId: string, result: ReportRun) => void;
  fail: (projectId: string, error: string, cancelled: boolean) => void;
  clear: (projectId: string) => void;
}

export const useReportRuns = create<ReportRunsState>((set) => ({
  runs: {},
  start: (projectId, projectName, scenarioKey, settings) => set((st) => ({ runs: { ...st.runs, [projectId]: { projectId, projectName, scenarioKey, status: 'running', startedAt: Date.now(), progress: [], settings } } })),
  progress: (projectId, line) => set((st) => { const r = st.runs[projectId]; return r && r.status === 'running' ? { runs: { ...st.runs, [projectId]: { ...r, progress: [...r.progress, line] } } } : {}; }),
  finish: (projectId, result) => set((st) => { const r = st.runs[projectId]; return r ? { runs: { ...st.runs, [projectId]: { ...r, status: 'done', finishedAt: Date.now(), result } } } : {}; }),
  fail: (projectId, error, cancelled) => set((st) => { const r = st.runs[projectId]; return r ? { runs: { ...st.runs, [projectId]: { ...r, status: cancelled ? 'cancelled' : 'error', finishedAt: Date.now(), error } } } : {}; }),
  clear: (projectId) => set((st) => { const runs = { ...st.runs }; delete runs[projectId]; return { runs }; }),
}));
