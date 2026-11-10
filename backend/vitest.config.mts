import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Every test file boots its own in-memory PostgreSQL (PGlite).
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
