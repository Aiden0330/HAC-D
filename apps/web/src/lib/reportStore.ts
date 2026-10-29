/**
 * v6.4 saved findings: the generated report of a project kept in the browser (IndexedDB, database hacd-reports, one record per
 * project id) so that it survives reloads — the Findings and Methodology pages, the sidecar bundle, the settings and the KPI
 * preview. Browser storage only: it stays on this device and never reaches another viewer; the downloads are the way to move it.
 * Every call rejects with a readable message when IndexedDB is unavailable (private mode, blocked site data).
 */
export interface SavedReportKpi { scale: number; todayAop: number; todayAopDerated: number; /** v5.6 derated effective / delivered goodput and feasibility (absent in reports saved before) */ todayEffectiveDerated?: number; todayDeliveredDerated?: number; recommendedAopDerated: number; recommendedEffectiveDerated?: number; recommendedDeliveredDerated?: number; feasible?: boolean; mechanisms: string[]; k: number }
export interface SavedReport {
  projectId: string;
  projectName: string;
  savedAt: number;
  /** the scenario JSON the report was computed from (a differing current scenario means the saved report is stale) */
  scenarioKey: string;
  settings: { sizes: number[]; trials: number; permutations: number; target: number; seed: number };
  files: { findings: string; methodology: string; data: string };
  html: { findings: string; methodology: string };
  /** the sidecar bundle JSON text (hacd findings --data re-renders it) */
  bundle: string;
  kpi: SavedReportKpi[];
}

const DB = 'hacd-reports', STORE = 'reports', VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available in this browser')); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB, VERSION); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'projectId' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('cannot open the report store'));
    req.onblocked = () => reject(new Error('the report store is blocked by another tab'));
  });
}
function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('report store request failed'));
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('report store transaction aborted')); };
  }));
}

export const saveReport = (r: SavedReport): Promise<void> => run('readwrite', (s) => s.put(r)).then(() => undefined);
export const loadReport = (projectId: string): Promise<SavedReport | undefined> => run<SavedReport | undefined>('readonly', (s) => s.get(projectId) as IDBRequest<SavedReport | undefined>);
export const deleteReport = (projectId: string): Promise<void> => run('readwrite', (s) => s.delete(projectId)).then(() => undefined);
export const listReports = (): Promise<{ projectId: string; projectName: string; savedAt: number }[]> => run<SavedReport[]>('readonly', (s) => s.getAll() as IDBRequest<SavedReport[]>).then((rs) => rs.map((r) => ({ projectId: r.projectId, projectName: r.projectName, savedAt: r.savedAt })));

/** open an HTML page in a new browser tab from its text (a user click; the object URL is released once the tab has loaded it) */
export function openHtml(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return !!w;
}
