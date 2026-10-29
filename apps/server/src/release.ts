// #57: the production release step — run once per deploy, BEFORE new code
// serves traffic (`pnpm --filter server release`). Applies migrations under
// one Postgres advisory lock, so N instances booting at once
// serialize instead of racing: the first does the work, the rest block on the
// lock and then find nothing left to apply.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { sql } from './db'
import { processIO, type CommandIO } from './command-io'
import { runMigrations } from './migrate'
import { diagnoseAdminBootstrap } from './admin-bootstrap'
import { preflightRelease } from './release-preflight'
import { formatHealthReport, runHealthChecks } from './instance-health'

/** The release; resolves to the process's exit code (1 when it stopped). The
 *  caller owns the database connection: the entry point below ends it. */
export async function main(_argv: string[] = [], io: CommandIO = processIO): Promise<number> {
  try {
    await sql.begin(async (tx) => {
      // The transaction exists only to hold the lock for the whole run; the
      // migrations manage their own transactions on the pool.
      await tx`select pg_advisory_xact_lock(hashtext('featherbase-release'))`
      // Every refusal that does not need the data, before the first migration
      // (the server's own boot refusals included): a release that would stop
      // part-way stops before it starts.
      for (const line of await preflightRelease()) io.out(`preflight: ${line}`)
      await runMigrations((line) => io.out(line))
      await diagnoseAdminBootstrap()
      // Instance health (#465 D8): every check, failing ones as warnings. It
      // never stops a release: the health page and banner carry them from here.
      try {
        for (const line of formatHealthReport(await runHealthChecks()))
          (line.failing ? io.err : io.out)(line.text)
      } catch (err) {
        io.err(`health: the checks could not run: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
    return 0
  } catch (err) {
    io.err(format('release failed — aborting:', err instanceof Error ? err.message : err))
    return 1
  }
}

// Run as a process (`tsx src/release.ts`), not when imported by a test.
/* v8 ignore next 6 -- entry-point guard; proven by the subprocess tests in test/release-preflight.test.ts */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv.slice(2))
  await sql.end().catch(() => {})
  process.exitCode = code
  if (code !== 0) process.exit(code)
}
