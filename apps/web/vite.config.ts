import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const core = (p: string) => fileURLToPath(new URL(`../../packages/core/${p}`, import.meta.url));
const importers = fileURLToPath(new URL('../../packages/importers/src/index.ts', import.meta.url));
const reports = (p: string) => fileURLToPath(new URL(`../../packages/reports/src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
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
