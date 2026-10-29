import { defineConfig } from 'vitest/config'

// Pure functions, no I/O: no database, no globalSetup, no fileParallelism
// restriction — this is the one suite that's free to run fully parallel.
export default defineConfig({
  test: {
    environment: 'node',
    // Collected only by `pnpm test:coverage`, never by the default `pnpm test`.
    // Everything here is a pure function reachable from a unit test, so this is
    // the one package where 100% is a near-term expectation rather than a
    // distant target.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      // Without this a single failing test suppresses the report entirely
      // (v8's default), which hides the numbers exactly when they are most
      // useful for diagnosing what a broken run stopped exercising.
      reportOnFailure: true,
      // Every executable line and function is exercised by this package's
      // own public-contract tests (#702); keep new source in the denominator.
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 99,
      },
    },
  },
})
