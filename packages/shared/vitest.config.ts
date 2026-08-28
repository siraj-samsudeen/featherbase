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
      // Ratchet toward 100% (#226 ruling): only raise, never lower.
      // Measured 2026-08-28: lines/statements 21.30%, functions 85.71%,
      // rounded DOWN to the whole percent. The gap is almost entirely
      // `src/import.ts`, which today is only driven from the server and web
      // suites — coverage is per-package, so those runs cannot credit it here.
      thresholds: {
        lines: 21,
        statements: 21,
        functions: 85,
      },
    },
  },
})
