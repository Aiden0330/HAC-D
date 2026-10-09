import * as Comlink from 'comlink';
import type { ComputeApi } from './compute.worker.js';

let remote: Comlink.Remote<ComputeApi> | null = null;

export function compute(): Comlink.Remote<ComputeApi> {
  if (!remote) {
    const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<ComputeApi>(worker);
  }
  return remote;
}

export const progressCallback = (fn: (done: number, total: number) => void) => Comlink.proxy(fn);
