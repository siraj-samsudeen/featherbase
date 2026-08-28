import { defineConfig } from 'vitest/config'

// All test files share ONE Postgres database, including the single
// `background_job` queue. `drainJobs()` drains every queued job, so when
// job-dependent tests (email, jobs, webhooks) run in parallel across files they
// steal each other's jobs and flake. Run files sequentially so each file drains
// only its own jobs. Tests within a file already run in order.
export default defineConfig({
  test: {
    fileParallelism: false,
    // The mock OAuth provider is opt-in (it mints a session for any typed
    // email). The suite drives it deliberately, so it opts in here; the
    // fail-closed test deletes this var for the length of one test.
    env: { ALLOW_MOCK_OAUTH: '1' },
    // Empties the tables that outlive a run — `background_job` (rows orphaned
    // by an interrupted run) and `user_event` (rows the app itself commits
    // outside any sandbox) — so neither can fail the next one. See the file.
    globalSetup: ['./test/global-setup.ts'],
    server: {
      deps: {
        // feather-testing-postgres ships raw TypeScript (`main: src/index.ts`,
        // no build step). Vitest does not transform node_modules by default,
        // so it must be inlined to be compiled like source.
        inline: ['feather-testing-postgres'],
      },
    },
    // Collected only by `pnpm test:coverage` (vitest run --coverage), never by
    // the default `pnpm test` — day-to-day runs stay fast.
    //
    // Scope is `src/` and nothing else. `migrations/` and `patches/` sit
    // outside it by construction: they are applied once by a separate `tsx
    // src/migrate.ts` process before the suite starts, so no test process ever
    // loads them and they would report a permanent, unfixable 0%. They are
    // also append-only history — a shipped migration is never edited — so
    // "cover it with a test" is not a thing one can do to them.
    //
    // The e2e suite is out of scope too: it drives a live stack over HTTP from
    // a separate Playwright process, so nothing it exercises is attributable
    // here. Coverage numbers below therefore describe the unit suite alone.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      // Without this a single failing test suppresses the report entirely
      // (v8's default), which hides the numbers exactly when they are most
      // useful for diagnosing what a broken run stopped exercising.
      reportOnFailure: true,
      // Ratchet toward 100% (#226 ruling): only raise, never lower.
      //
      // Measured 2026-08-28 on a developer checkout: lines/statements 86.64%,
      // functions 91.18%, then rounded DOWN to the whole percent. That local
      // run is a FLOOR, not the true figure — `sources-mysql.test.ts` skips
      // itself without MYSQL_TEST_URL, leaving `src/sources/mysql-driver.ts`
      // (359 lines) at 6%, and CI does set that variable. Raise these to the
      // number the first green CI run reports.
      thresholds: {
        lines: 86,
        statements: 86,
        functions: 91,
      },
    },
  },
})
