import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The admin render suites import the whole /admin page on their first test.
    // Cold, under a full parallel run, that import alone can pass 5 s, and a
    // timed-out first render then bleeds into the next test's assertions.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
