import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const core = (p: string) => fileURLToPath(new URL(`../../packages/core/${p}`, import.meta.url));
const importers = fileURLToPath(new URL('../../packages/importers/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@hac-d/core/library.json', replacement: core('data/library.json') },
      { find: /^@hac-d\/core$/, replacement: core('src/index.ts') },
      { find: /^@hac-d\/importers$/, replacement: importers },
    ],
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
});
