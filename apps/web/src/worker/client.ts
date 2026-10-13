import * as Comlink from 'comlink';
import type { ComputeApi } from './compute.worker.js';

let worker: Worker | null = null;
let remote: Comlink.Remote<ComputeApi> | null = null;
// rejecters of the calls in flight: a cancel terminates the worker, which would otherwise leave their promises pending forever
const pending = new Set<(e: Error) => void>();

function ensure(): Comlink.Remote<ComputeApi> {
  if (!remote) {
    worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<ComputeApi>(worker);
  }
  return remote;
}

/** Raised in the caller of every call that was in flight (running or queued) when `cancelCompute()` was used. */
export class ComputeCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'ComputeCancelled';
  }
}

/** The compute worker (one job at a time, calls queue in order); every call is tracked so that it can be cancelled. */
export function compute(): Comlink.Remote<ComputeApi> {
  return new Proxy({} as Comlink.Remote<ComputeApi>, {
    get: (_target, name: string) => (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        pending.add(reject);
        const api = ensure() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        api[name](...args).then(
          (v) => {
            pending.delete(reject);
            resolve(v);
          },
          (e) => {
            pending.delete(reject);
            reject(e);
          },
        );
      }),
  });
}

/** Terminate the worker: the running job and the queued ones stop, their calls reject with ComputeCancelled, and the next call starts a fresh worker. */
export function cancelCompute(): void {
  worker?.terminate();
  worker = null;
  remote = null;
  for (const reject of pending) reject(new ComputeCancelled());
  pending.clear();
}

/** Wrap a progress callback so that the worker can call it (done, total[, phase]). */
export function progressCallback<A extends [done: number, total: number, ...rest: unknown[]]>(fn: (...args: A) => void): ((...args: A) => void) & Comlink.ProxyMarked {
  return Comlink.proxy(fn);
}
