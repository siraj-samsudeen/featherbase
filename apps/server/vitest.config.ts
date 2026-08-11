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
  },
})
