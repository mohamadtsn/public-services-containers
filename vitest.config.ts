import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // The integration suites share one sandbox stack (fixed compose project,
    // network, container names and port block). Running files in parallel would
    // make them tear down each other's containers, so files run one at a time.
    // The whole suite is ~40s, which is not worth per-instance name generation.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
