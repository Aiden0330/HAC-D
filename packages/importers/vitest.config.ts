import { defineConfig } from 'vitest/config';

/** The worksheet round trips evaluate scenarios through the engine; the same generous timeout as packages/core keeps a slow machine from failing them for speed alone. */
export default defineConfig({ test: { testTimeout: 300_000, hookTimeout: 300_000 } });
