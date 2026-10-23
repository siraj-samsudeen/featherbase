// The release's preflight (person-resolution review A-M1): every refusal that
// does not depend on the data runs BEFORE the first migration, so a release
// that would stop part-way stops before it starts. The data-dependent checks
// inside 0100–0102 are covered differently: 0100, 0101, 0101a and 0102 run as
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
  passed.push(await assertPublicationsPublishGeneratedColumns(pending))
  passed.push(`pending migrations: ${pending.length ? pending.join(', ') : 'none'}`)
  return passed
}

/** 4. On PostgreSQL 18, a published table whose replica identity is FULL and
 *  that holds stored generated columns refuses EVERY update (42P10 "Replica
 *  identity must not contain unpublished generated columns") unless the
 *  publication publishes them. 0101 gives has_role two such columns, and the
 *  warehouse CDC publishes has_role (#399), so refuse before migrating. */
async function assertPublicationsPublishGeneratedColumns(pending: string[]): Promise<string> {
  const [{ version }] = await sql`select current_setting('server_version_num')::int as version`
  if (version < 180000) return 'publication generated-column check skipped (PostgreSQL before 18)'
  const gainsGenerated = pending.includes('0101_person_rename.ts')
  const blocking = await sql`
    select pt.pubname, pt.schemaname, pt.tablename
    from pg_publication_tables pt
    join pg_publication p on p.pubname = pt.pubname
    join pg_namespace n on n.nspname = pt.schemaname
    join pg_class c on c.relnamespace = n.oid and c.relname = pt.tablename
    where p.pubgencols <> 's' and c.relreplident = 'f'
      and (exists (select 1 from pg_attribute a
                   where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = 's')
           or (${gainsGenerated} and pt.schemaname = 'featherbase' and pt.tablename = 'has_role'))
    order by 1, 2, 3`
  if (blocking.length) {
    const pubs = [...new Set(blocking.map((b) => String(b.pubname)))]
    throw new Error(
      `${blocking.map((b) => `publication "${b.pubname}" covers ${b.schemaname}.${b.tablename}`).join('; ')}: that table has (or after 0101 will have) stored generated columns and REPLICA IDENTITY FULL, so on PostgreSQL 18 every update to it fails unless the publication publishes them. Fix it first:\n${pubs
        .map((name) => `  ALTER PUBLICATION ${/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`} SET (publish_generated_columns = stored);`)
        .join('\n')}`,
    )
  }
  return 'no publication blocks updates on a table with stored generated columns'
}
