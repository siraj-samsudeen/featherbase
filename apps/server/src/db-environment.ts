// Which environment a DATABASE belongs to, recorded in the database itself.
//
// Naming the test database differently (config.ts) stops the accident of
// OMITTING DATABASE_URL. It cannot stop a wrong one: an exported
// DATABASE_URL left over from another task, a typo, a copied command. Only
// the database can settle that, because only the database knows what it is.
//
// This is Rails' `ar_internal_metadata` — it stamps each database with the
// environment its migrations were run in and refuses destructive work on a
// mismatch (`ActiveRecord::EnvironmentMismatchError`). The stamp is what
// makes an automated "reset the database" safe to ship at all: without it, a
// mistyped variable points the reset at a developer's own data.
import { sql } from './db'
import { config, environment } from './config'

export const ENVIRONMENT_KEY = 'environment'

// Set by an operator who genuinely means it — the same escape hatch Rails
// offers as DISABLE_DATABASE_ENVIRONMENT_CHECK. Deliberately awkward to
// reach for, and it must never be set in CI.
const OVERRIDE = 'DISABLE_DATABASE_ENVIRONMENT_CHECK'

export async function ensureInternalMetadata(): Promise<void> {
  await sql`create table if not exists internal_metadata (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
  )`
}

/** Record which environment this database belongs to. Called by the migrator,
 *  so the stamp lands the first time a database is migrated and follows it
 *  forever after. */
export async function stampEnvironment(env: string = environment): Promise<void> {
  await ensureInternalMetadata()
  await sql`
    insert into internal_metadata (key, value) values (${ENVIRONMENT_KEY}, ${env})
    on conflict (key) do update set value = excluded.value, updated_at = now()`
}

/** The environment this database is stamped with, or null if it has never
 *  been migrated (a brand-new database is nobody's yet, so it is not a
 *  mismatch — the migrator is about to claim it). */
export async function storedEnvironment(): Promise<string | null> {
  const [present] = await sql`select to_regclass('internal_metadata') as reg`
  if (!present?.reg) return null
  const [row] = await sql`select value from internal_metadata where key = ${ENVIRONMENT_KEY}`
  return row ? String(row.value) : null
}

/**
 * Refuse to continue unless the connected database belongs to `expected`.
 *
 * Throws with the two names in the message, because the useful question is
 * never "did it fail" but "which database did I actually reach". An unstamped
 * database passes: it has no owner to contradict.
 */
export async function assertDatabaseEnvironment(expected: string = environment): Promise<void> {
  if (process.env[OVERRIDE] === '1') return
  const stored = await storedEnvironment()
  if (stored === null || stored === expected) return
  throw new Error(
    `Refusing to run: this database belongs to the '${stored}' environment, ` +
      `but this process is '${expected}'.\n` +
      `Connected to: ${redactUrl()}\n` +
      `Set DATABASE_URL to a '${expected}' database, or ${OVERRIDE}=1 if you truly mean it.`,
  )
}

// The URL carries a password. Show enough to identify the target, never the
// credential — this message is printed on the failure path, where it is most
// likely to be pasted into an issue.
function redactUrl(): string {
  try {
    const u = new URL(config.databaseUrl)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}
