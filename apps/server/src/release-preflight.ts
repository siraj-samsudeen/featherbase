// The release's preflight (person-resolution review A-M1): every refusal that
// does not depend on the data runs BEFORE the first migration, so a release
// that would stop part-way stops before it starts. The data-dependent checks
// inside 0101 and 0102 are covered differently: those two (with 0101a) run as
// one transaction (migrate.ts ONE_TRANSACTION), so any of them failing leaves
// the database as it was.
import { sql } from './db'
import { config } from './config'
import { assertDatabaseEnvironment, storedEnvironment } from './db-environment'
import { assertTestModeAllowed, delegatedTestMode, TEST_MODE_ENVIRONMENTS } from './delegated-login'
import { pendingMigrations } from './migrate'

export interface PreflightOptions {
  /** The environment the new server will run as (default: this process's). */
  environment?: string
}

/** Throws, naming the problem, if the release must not start. Returns one
 *  line per check that passed. */
export async function preflightRelease(opts: PreflightOptions = {}): Promise<string[]> {
  const environment = opts.environment ?? config.environment
  const passed: string[] = []

  // 1. Is this database ours to migrate? (runMigrations repeats it.)
  await assertDatabaseEnvironment(environment)
  passed.push(`database environment matches "${environment}"`)

  // 2. The server would refuse to start with test mode here — refuse now,
  //    before any migration, not after (D5). The database's own label counts
  //    too: a database stamped production never runs with test mode, even
  //    with DISABLE_DATABASE_ENVIRONMENT_CHECK set.
  assertTestModeAllowed(environment)
  if (delegatedTestMode()) {
    const stamped = await storedEnvironment()
    if (stamped !== null && !(TEST_MODE_ENVIRONMENTS as readonly string[]).includes(stamped))
      throw new Error(
        `DELEGATED_LOGIN_TEST_MODE is set, but this database is labelled "${stamped}". Test mode runs only on a development, test or staging database. Unset it, or re-stamp a trial database as staging first (docs/DEPLOY.md, "The person release").`,
      )
  }
  passed.push(`test mode ${delegatedTestMode() ? 'on, allowed here' : 'off'}`)

  // 3. 0102 creates btree_gist (person_identifier's history constraint).
  const pending = await pendingMigrations()
  if (pending.includes('0102_person_resolution.ts')) {
    const [ext] = await sql`
      select exists (select 1 from pg_extension where extname = 'btree_gist') as installed,
             exists (select 1 from pg_available_extensions where name = 'btree_gist') as available,
             has_database_privilege(current_database(), 'CREATE') as can_create`
    if (!ext.installed && !ext.available)
      throw new Error('0102 needs the btree_gist extension, which this Postgres server does not ship. Install the contrib package first.')
    if (!ext.installed && !ext.can_create)
      throw new Error('0102 creates the btree_gist extension, but this role may not create extensions in this database. Create it as the owner first: create extension btree_gist;')
    passed.push('btree_gist available for 0102')
  }
  passed.push(`pending migrations: ${pending.length ? pending.join(', ') : 'none'}`)
  return passed
}
