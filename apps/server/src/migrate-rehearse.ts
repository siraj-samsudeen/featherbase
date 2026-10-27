// `cli migrate:rehearse`: run every pending migration inside ONE transaction
// that is always rolled back, and print which migrations ran and what each
// reported (whatever its up() logs). Nothing is committed.
//
//   migrate:rehearse                          against this database
//   migrate:rehearse --database-url <dsn>     against another one (a restored
//                                             snapshot, docs/DEPLOY.md)
//
// Run as its own process so DATABASE_URL can point at the rehearsal target
// before the connection pool is created.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { sql, withTransaction } from './db'
import { assertDatabaseEnvironment } from './db-environment'
import { applyMigrationFile, pendingMigrations } from './migrate'
import { invalidateMeta } from './meta'

/** Where the rehearsal's report goes: the terminal, or a test's buffer. */
type RehearsalOutput = (line: string) => void

const ROLLBACK = new Error('migrate:rehearse rollback')

/** Apply one file, with what its up() logs sent to `out`. */
async function applyReporting(file: string, out: RehearsalOutput) {
  const log = console.log
  console.log = (...args: unknown[]) => out(format(...args))
  try {
    await sql.begin(() => applyMigrationFile(file))
  } finally {
    console.log = log
  }
  out(`applied ${file}`)
}

/** The rehearsal: one transaction, always rolled back. Every query in it,
 *  the migrations' own included, runs on that transaction (`withTransaction`
 *  scopes the platform's `sql` to it). */
export async function rehearse(out: RehearsalOutput = console.log): Promise<void> {
  await assertDatabaseEnvironment()
  const pending = await pendingMigrations()
  out(`migrate:rehearse — in a rolled-back transaction; pending: ${pending.length ? pending.join(', ') : 'none'}`)
  try {
    await withTransaction(async () => {
      try {
        for (const file of pending) await applyReporting(file, out)
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

/** The database to rehearse against: another one by URL, or null for this one. */
export function parseRehearseOptions(argv: string[]): { databaseUrl: string | null } {
  let databaseUrl: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--database-url') databaseUrl = argv[++i] ?? ''
    else throw new Error(`migrate:rehearse: unknown argument ${a}`)
  }
  if (databaseUrl === '') throw new Error('--database-url needs a database URL')
  return { databaseUrl }
}

// Entry point when spawned by `cli migrate:rehearse` (which has already set
// DATABASE_URL from --database-url).
/* v8 ignore next 10 -- entry-point guard; it runs only as its own process (cli migrate:rehearse spawns it), which in-process coverage cannot see */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rehearse()
    .then(() => sql.end())
    .catch(async (err) => {
      console.error('error:', err instanceof Error ? err.message : err)
      await sql.end().catch(() => {})
      process.exit(1)
    })
}
