// `cli migrate:rehearse`: run every pending migration inside ONE transaction
// that is always rolled back, and print which migrations ran and what each
// reported (whatever its up() logs). Nothing is committed.
//
//   migrate:rehearse                          against this database
//   migrate:rehearse --database-url <dsn>     against another one (a restored
//                                             snapshot, docs/DEPLOY.md)
//   migrate:rehearse --allow-live             even though other sessions are
//                                             connected (refused otherwise)
//
// Run as its own process so DATABASE_URL can point at the rehearsal target
// before the connection pool is created.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { sql, withTransaction } from './db'
import { assertDatabaseEnvironment } from './db-environment'
import { applyBatch, ensureLedger, planMigrations } from './migrate'
import { invalidateMeta } from './meta'

/** Where the rehearsal's report goes: the terminal, or a test's buffer. */
type RehearsalOutput = (line: string) => void

const ROLLBACK = new Error('migrate:rehearse rollback')

// #558: a change that would wait this long for a lock fails instead of
// queueing, and no one statement runs longer than this. A restored copy has
// nobody to wait for; the limits matter only when the target is not one.
const LOCK_TIMEOUT = '2s'
const STATEMENT_TIMEOUT = '5min'

/** Refuse a database other sessions are connected to. A restored copy has
 *  none; a live instance always has its server's. A copy of production is
 *  stamped production, so the environment check alone can't tell them apart,
 *  and the rehearsal holds every change's locks until it rolls back. This is
 *  a heuristic: a live server whose pool has gone idle shows no sessions.
 *  Other roles' sessions show no backend type to a role that may not read
 *  their details, so a session with a role and no type counts as a client. */
export async function assertNotLive(client: typeof sql = sql): Promise<void> {
  const [{ n }] = await client`
    select count(*)::int as n from pg_stat_activity
     where datname = current_database() and pid <> pg_backend_pid()
       and (backend_type = 'client backend' or (backend_type is null and usesysid is not null))`
  if (n === 0) return
  throw new Error(
    `Refusing to rehearse: ${n} other session${n === 1 ? ' is' : 's are'} connected to this database, ` +
      'so it looks like a live instance, not a restored copy. The rehearsal holds each change\'s locks ' +
      'until it ends, which would block everyone using it.\n' +
      'Point --database-url at a restored copy (docs/DEPLOY.md), or pass --allow-live if you truly mean it.',
  )
}

/** Apply one batch the way the migrator does, with what its up() logs sent
 *  to `out`. A savepoint of its own, as the migrator gives it a transaction. */
async function applyReporting(batch: string[], legacy: boolean, out: RehearsalOutput) {
  const log = console.log
  console.log = (...args: unknown[]) => out(format(...args))
  try {
    await withTransaction(() => applyBatch(batch, legacy, (file) => out(`applied ${file}`)))
  } catch (err) {
    // 55P03 lock_not_available: say which change could not get its lock.
    if ((err as { code?: string }).code === '55P03')
      throw new Error(`${batch.join(', ')} waited more than ${LOCK_TIMEOUT} for a lock another session holds, so the rehearsal stopped: ${(err as Error).message}`)
    throw err
  } finally {
    console.log = log
  }
}

/** The rehearsal: one transaction, always rolled back. Every query in it,
 *  the migrations' own included, runs on that transaction (`withTransaction`
 *  scopes the platform's `sql` to it). */
export async function rehearse(
  out: RehearsalOutput = console.log,
  { allowLive = false }: { allowLive?: boolean } = {},
): Promise<void> {
  if (!allowLive) await assertNotLive()
  await assertDatabaseEnvironment()
  const { legacy, batches } = await planMigrations()
  const pending = batches.flat()
  out(`migrate:rehearse — in a rolled-back transaction; pending: ${pending.length ? pending.join(', ') : 'none'}`)
  try {
    await withTransaction(async () => {
      try {
        await sql.unsafe(`set local lock_timeout = '${LOCK_TIMEOUT}'; set local statement_timeout = '${STATEMENT_TIMEOUT}'`)
        await ensureLedger(legacy)
        for (const batch of batches) await applyReporting(batch, legacy, out)
      } finally {
        invalidateMeta()
      }
      throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  }
  out('migrate:rehearse — rolled back; nothing was changed')
}

/** The database to rehearse against (another one by URL, or null for this
 *  one), and whether it may be one other sessions are connected to. */
export function parseRehearseOptions(argv: string[]): { databaseUrl: string | null; allowLive: boolean } {
  let databaseUrl: string | null = null
  let allowLive = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--database-url') databaseUrl = argv[++i] ?? ''
    else if (a === '--allow-live') allowLive = true
    else throw new Error(`migrate:rehearse: unknown argument ${a}`)
  }
  if (databaseUrl === '') throw new Error('--database-url needs a database URL')
  return { databaseUrl, allowLive }
}

// Entry point when spawned by `cli migrate:rehearse` (which has already set
// DATABASE_URL from --database-url, and passes --allow-live on).
/* v8 ignore next 10 -- entry-point guard; it runs only as its own process (cli migrate:rehearse spawns it), which in-process coverage cannot see */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rehearse(console.log, { allowLive: parseRehearseOptions(process.argv.slice(2)).allowLive })
    .then(() => sql.end())
    .catch(async (err) => {
      console.error('error:', err instanceof Error ? err.message : err)
      await sql.end().catch(() => {})
      process.exit(1)
    })
}
