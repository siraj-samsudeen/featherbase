// Drop and recreate the e2e database, then migrate it.
//
// Why a whole database rather than deleting rows: the e2e specs create real
// Tables, which is DDL. `truncate` cannot remove a generated table, and the
// running server caches Table metadata in-process — so a reset that changes
// the schema underneath a live server leaves it serving stale metadata. Doing
// it as drop-and-recreate BEFORE the server boots sidesteps both problems.
//
// This replaces the cleanup blocks the specs used to hand-roll. Those were
// invisible when they broke: nothing asserts on a `beforeAll` delete, so when
// #132 renamed the field they deleted by, three specs silently deleted
// nothing and leaked rows into every later run (fixed in #183). A reset the
// suite does not have to remember is not merely less code — it removes a
// class of failure that cannot announce itself.
//
// SAFETY. This drops a database, so it refuses to run unless the target is
// one it should be allowed to destroy: the name must end in `_e2e`, and if
// the database already exists it must be stamped for the test environment
// (src/db-environment.ts). That stamp is exactly what makes an automated drop
// safe to ship — without it a mistyped DATABASE_URL points this at a
// developer's own data.
import postgres from 'postgres'
import { config } from '../src/config'

const SUFFIX = '_e2e'

export function e2eDatabaseUrl(base = config.databaseUrl): string {
  const url = new URL(base)
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!name) throw new Error(`DATABASE_URL names no database: ${url.host}`)
  url.pathname = `/${name.endsWith(SUFFIX) ? name : name + SUFFIX}`
  return url.toString()
}

function adminUrlFor(target: string): string {
  // `drop database` cannot run from a connection to the database being
  // dropped, so administer from the server's default `postgres` database.
  const url = new URL(target)
  url.pathname = '/postgres'
  return url.toString()
}

function databaseNameOf(target: string): string {
  return decodeURIComponent(new URL(target).pathname.slice(1))
}

export async function resetE2eDatabase(target = e2eDatabaseUrl()): Promise<string> {
  const name = databaseNameOf(target)
  if (!name.endsWith(SUFFIX))
    throw new Error(`Refusing to drop "${name}": an e2e database name must end in "${SUFFIX}".`)

  // If it already exists, it must be ours to destroy. A database with no
  // stamp has never been migrated and holds nothing to protect.
  const existing = postgres(target, { onnotice: () => {}, prepare: false, max: 1 })
  try {
    const [present] = await existing`select to_regclass('internal_metadata') as reg`
    if (present?.reg) {
      const [row] = await existing`select value from internal_metadata where key = 'environment'`
      const stamp = row ? String(row.value) : null
      if (stamp !== null && stamp !== 'test')
        throw new Error(
          `Refusing to drop "${name}": it is stamped for the '${stamp}' environment, not 'test'.`,
        )
    }
  } catch (err) {
    // "database does not exist" is the happy path — there is nothing to check
    // and nothing to lose. Anything else is a real problem.
    const message = err instanceof Error ? err.message : String(err)
    if (!/does not exist/i.test(message)) throw err
  } finally {
    await existing.end({ timeout: 5 }).catch(() => {})
  }

  const admin = postgres(adminUrlFor(target), { onnotice: () => {}, prepare: false, max: 1 })
  try {
    // FORCE terminates leftover connections (a killed run, a stray psql);
    // without it a single idle session makes the drop fail. Postgres 13+.
    await admin.unsafe(`drop database if exists "${name}" with (force)`)
    await admin.unsafe(`create database "${name}"`)
  } finally {
    await admin.end({ timeout: 5 })
  }
  return target
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  resetE2eDatabase()
    .then((target) => {
      console.log(`reset ${databaseNameOf(target)}`)
      process.exit(0)
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
