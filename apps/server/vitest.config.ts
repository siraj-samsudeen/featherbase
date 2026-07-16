import { defineConfig } from 'vitest/config'

// All test files share ONE Postgres database, including the single
// `tab_background_job` queue. `drainJobs()` drains every queued job, so when
// job-dependent tests (email, jobs, webhooks) run in parallel across files they
// steal each other's jobs and flake. Run files sequentially so each file drains
// only its own jobs. Tests within a file already run in order.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
})
