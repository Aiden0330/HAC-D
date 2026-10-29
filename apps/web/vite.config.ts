import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const core = (p: string) => fileURLToPath(new URL(`../../packages/core/${p}`, import.meta.url));
const importers = fileURLToPath(new URL('../../packages/importers/src/index.ts', import.meta.url));
const reports = (p: string) => fileURLToPath(new URL(`../../packages/reports/src/${p}`, import.meta.url));
/**
 * v5.8 the build's commit for the provenance of the web reports, as `hacd` records it (short hash, `-dirty` when tracked files were
 * modified; method & code review 2026-10-29: the browser recorded only CORE_VERSION, which does not tell the model revisions apart)
 */
function buildCommit(): string {
  try {
    const git = (a: string[]) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return `${git(['rev-parse', '--short', 'HEAD'])}${git(['status', '--porcelain', '--untracked-files=no']) ? '-dirty' : ''}`;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __HACD_COMMIT__: JSON.stringify(buildCommit()) },
  resolve: {
    alias: [
      { find: '@hac-d/core/library.json', replacement: core('data/library.json') },
      { find: /^@hac-d\/core$/, replacement: core('src/index.ts') },
      { find: /^@hac-d\/importers$/, replacement: importers },
      // v6.3 the report kit for the browser (no node: imports) and the topology schematic alone
      { find: /^@hac-d\/reports\/browser$/, replacement: reports('browser.mjs') },
      { find: /^@hac-d\/reports\/schematic$/, replacement: reports('schematic.mjs') },
    ],
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
});
