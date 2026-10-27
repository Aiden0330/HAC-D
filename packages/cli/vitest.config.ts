import { defineConfig } from 'vitest/config';
/** The CLI tests spawn the CLI itself (`node --import tsx src/main.ts`) and run the engine at 10,000 NPUs with 40 windows: ~1 min; the timeout leaves room for a slow machine. */
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 600_000, hookTimeout: 600_000 } });
