import { defineConfig } from 'vitest/config'

if (process.env.SECURITY_COMMIT_PROOF === '1') {
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null
  if (!url || url.hostname !== '127.0.0.1' || url.port !== '5432'
    || url.pathname !== '/featherbase_security_concurrency_commit_e2e'
    || (process.env.FEATHERBASE_ENV && process.env.FEATHERBASE_ENV !== 'test'))
    throw new Error('Security committed proof requires its disposable local test database')
}

if (process.env.WORKFLOW_COMMIT_PROOF === '1') {
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null
  if (!url || url.hostname !== '127.0.0.1' || url.port !== '5432'
    || !/^\/featherbase_[a-z0-9_]+_workflow_commit_e2e$/.test(url.pathname)
    || (process.env.FEATHERBASE_ENV && process.env.FEATHERBASE_ENV !== 'test'))
    throw new Error('Workflow committed proof requires a local test DATABASE_URL naming featherbase_<worker>_workflow_commit_e2e on 127.0.0.1:5432')
}

if (process.env.APP_ACCESS_COMMIT_PROOF === '1') {
  const url = process.env.DATABASE_URL
  if (!url || new URL(url).pathname !== '/featherbase_issue279_access_commit_e2e')
    throw new Error('App access committed proof requires its explicit disposable database')
}

if (process.env.SETTINGS_LOCK_COMMIT_PROOF === '1') {
  const url = process.env.DATABASE_URL
  const name = url ? decodeURIComponent(new URL(url).pathname.slice(1)) : ''
  if (!/^featherbase_[a-z0-9_]+_settings_commit_e2e$/.test(name))
    throw new Error('Settings lock committed proof requires explicit DATABASE_URL naming featherbase_<worker>_settings_commit_e2e')
}

// Opt-in committed writes must reject shared/default databases before global
// setup migrates or clears test telemetry. Each reviewer chooses their own DB.
if (process.env.TASKER_UPGRADE_ACTION_PROOF === '1') {
  const url = process.env.DATABASE_URL
  const name = url ? decodeURIComponent(new URL(url).pathname.slice(1)) : ''
  if (!/^featherbase_[a-z0-9_]+_actions_commit_e2e$/.test(name))
    throw new Error('Tasker committed proof requires explicit DATABASE_URL naming featherbase_<worker>_actions_commit_e2e')
}

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
      // The MySQL driver is exercised only where a MySQL server is reachable
      // (CI sets MYSQL_TEST_URL; a laptop usually does not). Measuring it
      // without one would report a permanent gap that says nothing about the
      // code, so it is counted exactly when its tests can run.
      exclude: process.env.MYSQL_TEST_URL ? [] : ['src/sources/mysql-driver.ts'],
      reporter: ['text', 'json-summary'],
      // Without this a single failing test suppresses the report entirely
      // (v8's default), which hides the numbers exactly when they are most
      // useful for diagnosing what a broken run stopped exercising.
      reportOnFailure: true,
      // ADR 0012 (26-Oct-2026): every line and function a real caller can
      // reach is tested. Functions are gated at 100. Lines and statements sit
      // just below it only for release-preflight's PostgreSQL 18 checks, which
      // run in CI's separate pg18 job rather than in these shards. Branches are
      // reported, not chased: the floor is the measured figure, rounded down,
      // and only rises.
      thresholds: {
        lines: 99.5,
        statements: 99.5,
        functions: 100,
        branches: 90,
      },
    },
  },
})
