import { defineConfig } from 'vitest/config';
/**
 * The goldens are fast, but three tests run the engine at scale (the v5 reproduction of results.json at 500k, the v6 KPI delta with
 * 40 ledger windows): 8–26 s on a 2024 laptop, several times that on a slow or shared machine. The 300 s timeout keeps them from
 * failing for speed alone; a test that hangs still fails. Per-test timeouts written in the files stay in force.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
    testTimeout: 300_000,
    hookTimeout: 300_000,
  }
});
