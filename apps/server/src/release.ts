// #57: the production release step — run once per deploy, BEFORE new code
// serves traffic (`pnpm --filter server release`). Applies migrations then
// patches under one Postgres advisory lock, so N instances booting at once
// serialize instead of racing: the first does the work, the rest block on the
// lock and then find nothing left to apply.
import { sql } from './db'
import { runMigrations } from './migrate'
import { runPatches } from './patches'
import { patches } from '../patches/index'

try {
  await sql.begin(async (tx) => {
    // The transaction exists only to hold the lock for the whole run; the
    // migrations and patches manage their own transactions on the pool.
    await tx`select pg_advisory_xact_lock(hashtext('featherbase-release'))`
    await runMigrations()
    const newly = await runPatches(patches)
    for (const n of newly) console.log(`applied patch ${n}`)
    console.log(`patches up to date (${patches.length} total)`)
  })
  await sql.end()
} catch (err) {
  console.error('release failed — aborting:', err instanceof Error ? err.message : err)
  await sql.end().catch(() => {})
  process.exit(1)
}
