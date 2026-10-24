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
import { SECURITY_TABLES } from './security-tables'
import { platformRelation } from './platform-schema'

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
  passed.push(...(await assertAccessConfiguration(environment, pending)))
  passed.push(`pending migrations: ${pending.length ? pending.join(', ') : 'none'}`)
  return passed
}

/** 4. On PostgreSQL 18, a published table whose replica identity is FULL and
 *  that holds stored generated columns refuses EVERY update and delete (42P10
 *  "Replica identity must not contain unpublished generated columns") unless
 *  the publication publishes them: through its column list when it has one
 *  (the list wins), else through publish_generated_columns = stored. 0101
 *  gives has_role two such columns, and the warehouse CDC publishes has_role
 *  (#399), so refuse before migrating. Insert-only publications are harmless. */
async function assertPublicationsPublishGeneratedColumns(pending: string[]): Promise<string> {
  const [{ version }] = await sql`select current_setting('server_version_num')::int as version`
  if (version < 180000) return 'publication generated-column check skipped (PostgreSQL before 18)'
  const gainsGenerated = pending.includes('0101_person_rename.ts')
  const blocking = await sql`
    with published as (
      select p.pubname, p.pubgencols, pt.schemaname, pt.tablename, c.oid as relid,
             pr.prattrs::int2[] as column_list,
             ${gainsGenerated}::boolean and pt.schemaname = 'featherbase' and pt.tablename = 'has_role' as gains_generated
      from pg_publication_tables pt
      join pg_publication p on p.pubname = pt.pubname
      join pg_namespace n on n.nspname = pt.schemaname
      join pg_class c on c.relnamespace = n.oid and c.relname = pt.tablename
      left join pg_publication_rel pr on pr.prpubid = p.oid and pr.prrelid = c.oid
      where c.relreplident = 'f' and (p.pubupdate or p.pubdelete))
    select pubname, schemaname, tablename, column_list is not null as has_column_list
    from published
    where case
      -- A list cannot name columns 0101 has not added yet.
      when column_list is not null then gains_generated or exists (
        select 1 from pg_attribute a
        where a.attrelid = relid and a.attnum > 0 and not a.attisdropped and a.attgenerated = 's'
          and not a.attnum = any(column_list))
      else pubgencols <> 's' and (gains_generated or exists (
        select 1 from pg_attribute a
        where a.attrelid = relid and a.attnum > 0 and not a.attisdropped and a.attgenerated = 's'))
    end
    order by 1, 2, 3`
  if (blocking.length) {
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
    const fixes = [...new Set(blocking.map((b) =>
      b.has_column_list
        ? `  publication "${b.pubname}" lists columns for ${b.schemaname}.${b.tablename}: drop the column list (ALTER PUBLICATION ${quote(String(b.pubname))} SET TABLE … without one), or include every stored generated column after 0101;`
        : `  ALTER PUBLICATION ${quote(String(b.pubname))} SET (publish_generated_columns = stored);`))]
    throw new Error(
      `${blocking.map((b) => `publication "${b.pubname}" covers ${b.schemaname}.${b.tablename}${b.has_column_list ? ' with a column list' : ''}`).join('; ')}: that table has (or after 0101 will have) stored generated columns and REPLICA IDENTITY FULL, so on PostgreSQL 18 every update to it fails unless the publication publishes them. Fix it first:\n${fixes.join('\n')}`,
    )
  }
  return 'no publication blocks updates on a table with stored generated columns'
}

/** Addresses anyone can register: admitting them creates a person for any
 *  member of the public. */
const CONSUMER_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'mail.com', 'zoho.com', 'yandex.com', 'rediffmail.com',
])
const SIGN_UP_ENVIRONMENTS = ['development', 'test']
const ACTION_FLAGS = ['read', 'write', 'create', 'delete', 'submit', 'cancel', 'amend'] as const

/** Where a platform table lives right now, and its columns: `featherbase`
 *  after 0094, `public` before it — preflight runs before the migrations. */
async function locate(name: string): Promise<{ relation: string; columns: Set<string> } | null> {
  for (const relation of [platformRelation(name), `public.${name}`]) {
    const [rel] = await sql`select to_regclass(${relation})::oid as oid`
    if (!rel?.oid) continue
    const cols = await sql`
      select attname from pg_attribute
      where attrelid = ${rel.oid} and attnum > 0 and not attisdropped`
    return { relation, columns: new Set(cols.map((c) => String(c.attname))) }
  }
  return null
}

/** 5. #437: access configuration a release must never carry.
 *  (a) the implicit roles All (every signed-in principal) and Guest never
 *      hold a grant on Person or on an access-control Table;
 *  (b) password sign-in creates new people only in development or test;
 *  (c) a method that creates people never admits any address (`*`) or a
 *      consumer email domain.
 *  Before 0100 there is no Sign In Method yet, but 0100 will create a Google
 *  method that creates people from the legacy `allowed_login_domains`
 *  setting, so (c) is applied to that setting instead (outside development
 *  and test). Otherwise a database before the tables or columns exist has
 *  nothing to check. */
async function assertAccessConfiguration(environment: string, pending: string[] = []): Promise<string[]> {
  const problems: string[] = []
  const found = await locate('permission')
  if (found) {
    const permission = found.columns
    const flags = ACTION_FLAGS.filter((a) => permission.has(`can_${a}`))
    const rows = await sql`
      select row_id, role, ref_table, ${sql(flags.map((a) => `can_${a}`))}
      from ${sql(found.relation)}
      where role in ('All', 'Guest') and ref_table in ${sql(['Person', 'User', ...SECURITY_TABLES])}
      order by role, ref_table, row_id`
    for (const r of rows) {
      const granted = flags.filter((a) => r[`can_${a}`] === true)
      if (granted.length)
        problems.push(`Permission ${String(r.row_id)} grants role "${String(r.role)}" on "${String(r.ref_table)}" (${granted.join(', ')}): give these Tables to named roles only, and delete the row`)
    }
  }
  const method = await locate('sign_in_method')
  const methods = method?.columns
  if (method && methods?.has('new_person')) {
    const hasDomains = methods.has('allowed_email_domains')
    const rows = await sql`
      select row_id, kind, new_person, ${hasDomains ? sql`allowed_email_domains` : sql`null::text`} as domains
      from ${sql(method.relation)} order by row_id`
    for (const r of rows) {
      const creates = String(r.new_person ?? 'refuse') !== 'refuse'
      // `create` ignores allowed_email_domains (sign-in.ts): password admits
      // anyone who signs up, Google any Google account.
      if (String(r.new_person) === 'create' && !SIGN_UP_ENVIRONMENTS.includes(environment))
        problems.push(`the ${String(r.kind)} sign-in method "${String(r.row_id)}" creates a new person for anyone it admits, on a "${environment}" server: set its new_person to refuse${String(r.kind) === 'password' ? '' : ' or create_if_email_domain_allowed with company domains'}`)
      if (!creates) continue
      const open = String(r.domains ?? '').split(',').map((d) => d.trim().toLowerCase())
        .filter((d) => d === '*' || CONSUMER_EMAIL_DOMAINS.has(d))
      for (const d of open)
        problems.push(`sign-in method "${String(r.row_id)}" creates new people from "${d}": list company domains only, or set its new_person to refuse`)
    }
  }
  if (pending.includes('0100_person_identities.ts') && !SIGN_UP_ENVIRONMENTS.includes(environment)) {
    const settings = await locate('single_value')
    if (settings) {
      const [legacy] = await sql`
        select value from ${sql(settings.relation)}
        where table_name = 'System Settings' and field = 'allowed_login_domains'`
      const open = String(legacy?.value ?? '').split(',').map((d) => d.trim().toLowerCase())
        .filter((d) => d === '*' || CONSUMER_EMAIL_DOMAINS.has(d))
      for (const d of open)
        problems.push(`the System Settings allowed_login_domains holds "${d}", and 0100 copies it into a Google sign-in method that creates new people: list company domains only, or clear the setting, before releasing`)
    }
  }
  if (problems.length) throw new Error(`Access configuration is unsafe to release:\n  ${problems.join('\n  ')}`)
  return [
    'no Permission row grants All or Guest on Person or an access-control Table',
    'no sign-in method creates new people for anyone here',
    'no sign-in method creates people from any address or a consumer email domain',
  ]
}
