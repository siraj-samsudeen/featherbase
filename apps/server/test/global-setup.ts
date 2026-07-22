// Vitest globalSetup: empty the shared background-job queue once before the
// run.
//
// `tab_background_job` is the one piece of state that survives a test run.
// Every test body is transaction-isolated by the feather-testing-postgres
// sandbox and rolls back on its own, but a run that dies partway through
// (Ctrl-C, crash, restart) commits nothing and yet leaves `queued` rows behind
// — jobs are enqueued by tests that DID complete, and the worker never got to
// drain them. The next run then sees them: `drainJobs()` returns a higher
// count than the test expected, and JOB-003 fails with `expected 2 to be 1`.
// Nothing in that failure points at stale state, so it reads as a real bug in
// the recurring-job code or as flake.
//
// This runs in the main Vitest process, OUTSIDE any sandbox transaction, so
// the delete really commits and every run starts from a known-empty queue.
// It is deliberately global rather than per-file: the queue is shared across
// files, which is also why both suites set `fileParallelism: false`. This
// closes the same hole at run scope.

import postgres from 'postgres'
import { config } from '../src/config'

export async function setup() {
  const sql = postgres(config.databaseUrl, { onnotice: () => {}, prepare: false })
  try {
    // A fresh checkout may not have migrated yet. Truncating a table that does
    // not exist would fail the whole run with an error that hides the real
    // cause, so treat an absent queue as an already-empty one.
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      select to_regclass('public.tab_background_job') is not null as exists`
    if (exists) await sql`delete from tab_background_job`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
