// #57: the production release step — run once per deploy, BEFORE new code
// serves traffic (`pnpm --filter server release`). Applies migrations then
// patches under one Postgres advisory lock, so N instances booting at once
// serialize instead of racing: the first does the work, the rest block on the
// lock and then find nothing left to apply.
import { sql } from './db'
import { runMigrations } from './migrate'
import { runPatches } from './patches'
import { patches } from '../patches/index'
import { diagnoseAdminBootstrap } from './admin-bootstrap'
import { preflightRelease } from './release-preflight'
import { formatHealthReport, runHealthChecks } from './instance-health'

try {
  await sql.begin(async (tx) => {
    // The transaction exists only to hold the lock for the whole run; the
    // migrations and patches manage their own transactions on the pool.
    await tx`select pg_advisory_xact_lock(hashtext('featherbase-release'))`
    // Every refusal that does not need the data, before the first migration
    // (the server's own boot refusals included): a release that would stop
    // part-way stops before it starts.
    for (const line of await preflightRelease()) console.log(`preflight: ${line}`)
    await runMigrations()
    const newly = await runPatches(patches)
    for (const n of newly) console.log(`applied patch ${n}`)
    console.log(`patches up to date (${patches.length} total)`)
    await diagnoseAdminBootstrap()
    // Instance health (#465 D8): every check, failing ones as warnings. It
    // never stops a release: the health page and banner carry them from here.
    try {
      for (const line of formatHealthReport(await runHealthChecks()))
        (line.failing ? console.warn : console.log)(line.text)
    } catch (err) {
      console.warn(`health: the checks could not run: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
  await sql.end()
} catch (err) {
  console.error('release failed — aborting:', err instanceof Error ? err.message : err)
  await sql.end().catch(() => {})
  process.exit(1)
}
