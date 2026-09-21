import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // One mongod is booted in globalSetup and shared by every test file; each
    // file talks to its own database inside that single server instance.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    reporters: ['default'],
  },
});
