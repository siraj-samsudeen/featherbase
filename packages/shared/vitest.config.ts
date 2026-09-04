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
      // Measured 2026-08-28 at lines/statements 21.30%, functions 85.71% —
      // a number the config itself blamed on `src/import.ts` being driven
      // only from the server and web suites, which coverage cannot credit
      // across packages. #197 closed that gap by moving those pure tests
      // into this suite, where docs/TESTING.md's decision tree puts
      // I/O-free code: re-measured 2026-08-28 at lines/statements 99.10%,
      // functions 97.14%, rounded DOWN to the whole percent.
      thresholds: {
        lines: 99,
        statements: 99,
        functions: 97,
      },
    },
  },
})
