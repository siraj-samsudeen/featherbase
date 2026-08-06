// Vitest globalSetup: empty the tables that outlive a test run, once, before
// the run starts.
//
// Every test body is transaction-isolated by the feather-testing-postgres
// sandbox and rolls back on its own. Two tables still carry committed rows
// into the next run, and in both cases the resulting failure points anywhere
// but at stale state:
//
//   background_job — a run that dies partway through (Ctrl-C, crash, restart)
//     commits nothing and yet leaves `queued` rows behind: jobs enqueued by
//     tests that DID complete, which the worker never got to drain. The next
//     run sees them, `drainJobs()` returns a higher count than the test
//     expected, and JOB-003 fails with `expected 2 to be 1` — reading as a
//     real bug in the recurring-job code, or as flake.
//
//   user_event — the read-side trail (#101) is written by the app itself, so
//     `./init.sh`, the Playwright e2e suite, and any manual click-through all
//     commit rows as Administrator, outside any sandbox. `eventSummary` scans
//     only the newest 800 rows per user, so once a few hundred of those pile
//     up, an event a test deliberately backdates sinks below the scan window
//     and is simply absent from the summary. The clamp test then dies on
//     `Cannot read properties of undefined (reading 'visits')`, which reads as
//     a broken endpoint rather than a crowded table. Losing the trail costs
//     nothing: it is telemetry, the client keeps its own warm mirror, and
//     nothing user-visible depends on old rows.
//
// This runs in the main Vitest process, OUTSIDE any sandbox transaction, so
// the deletes really commit and every run starts from known-empty state. It is
// deliberately global rather than per-file: both tables are shared across
// files, which is also why both suites set `fileParallelism: false`. This
// closes the same hole at run scope.

import postgres from 'postgres'
import { config } from '../src/config'

const SHARED_TABLES = ['background_job', 'user_event']

export async function setup() {
  const sql = postgres(config.databaseUrl, { onnotice: () => {}, prepare: false })
  try {
    for (const table of SHARED_TABLES) {
      // A fresh checkout may not have migrated yet. Emptying a table that does
      // not exist would fail the whole run with an error that hides the real
      // cause, so treat an absent table as an already-empty one.
      const [{ exists }] = await sql<{ exists: boolean }[]>`
        select to_regclass(${'public.' + table}) is not null as exists`
      if (exists) await sql`delete from ${sql(table)}`
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
