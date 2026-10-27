// The release's preflight (person-resolution review A-M1): every refusal that
// does not depend on the data runs BEFORE the first migration, so a release
// that would stop part-way stops before it starts. The data-dependent checks
// inside 0100–0102 are covered differently: 0100, 0101, 0101a and 0102 run as
// one transaction (migrate.ts ONE_TRANSACTION), so any of them failing leaves
// the database as it was.
import { sql } from './db'
import { config, environmentDeclared } from './config'
import { assertDatabaseEnvironment, storedEnvironment } from './db-environment'
import { delegatedTestMode } from './delegated-login'
import { checkVariables, readVariable, TEST_MODE_ENVIRONMENTS, type CheckVariablesOptions, type SettingsCondition } from './env'
import { verifyPassword } from './auth'
import { pendingMigrations } from './migrate'
import { SECURITY_TABLES } from './security-tables'
import { platformRelation } from './platform-schema'
import { validateInstanceAddresses } from './instance-addresses'
import { appSetupState } from './app-settings'

interface PreflightOptions {
  /** The environment the new server will run as (default: this process's). */
  environment?: string
}

interface BtreeGistStatus { installed: boolean; available: boolean; can_create: boolean }

/** 0102 needs btree_gist: installed, or installable by this role. */
export function assertBtreeGist(ext: BtreeGistStatus): void {
  if (!ext.installed && !ext.available)
    throw new Error('0102 needs the btree_gist extension, which this Postgres server does not ship. Install the contrib package first.')
  if (!ext.installed && !ext.can_create)
    throw new Error('0102 creates the btree_gist extension, but this role may not create extensions in this database. Create it as the owner first: create extension btree_gist;')
}

/** Throws, naming the problem, if the release must not start. Returns one
 *  line per check that passed. */
export async function preflightRelease(opts: PreflightOptions = {}): Promise<string[]> {
  // 0. A release declares what it is. Unset, the environment defaults to
  //    development, which would wave through every production-only check
  //    below (INSTANCE_ADDRESSES among them). A local dev server never runs this.
  if (!opts.environment && !environmentDeclared())
    throw new Error(
      'Neither FEATHERBASE_ENV nor NODE_ENV is set. A release must declare its environment (FEATHERBASE_ENV=production, staging, …) rather than default to development (docs/DEPLOY.md, "Configuration").',
    )
  const environment = opts.environment ?? config.environment
  const passed: string[] = []

  // 1. Is this database ours to migrate? (runMigrations repeats it.)
  await assertDatabaseEnvironment(environment)
  passed.push(`database environment matches "${environment}"`)

  // 2. Deployment variables (instance-settings D7): refuse on a missing
  //    required one or a switch production must never have (test mode among
  //    them, D5), warn on a missing recommended one. This is the server's own
  //    start-up check plus the variables the stored settings make required,
  //    refused now, before any migration. The database's own label counts
  //    too: a database stamped production never runs with test mode, even
  //    with DISABLE_DATABASE_ENVIRONMENT_CHECK set.
  const pending = await pendingMigrations()
  const variables = checkVariables({ environment, ...(await settingsRequirements(pending)) })
  if (variables.forbidden.length) throw new Error(variables.forbidden.join('\n'))
  if (delegatedTestMode()) {
    const stamped = await storedEnvironment()
    if (stamped !== null && !(TEST_MODE_ENVIRONMENTS as readonly string[]).includes(stamped))
      throw new Error(
        `DELEGATED_LOGIN_TEST_MODE is set, but this database is labelled "${stamped}". Test mode runs only on a development, test or staging database. Unset it, or re-stamp a trial database as staging first (docs/DEPLOY.md, "Environments and the database stamp").`,
      )
  }
  passed.push(`test mode ${delegatedTestMode() ? 'on, allowed here' : 'off'}`)
  if (variables.refusals.length) throw new Error(variables.refusals.join('\n'))
  passed.push(...variables.warnings, ...variables.passed)

  // 2b. #488: the registry above refuses a missing INSTANCE_ADDRESSES outside
  //     development and test. A list that is set was validated at boot for
  //     this process's environment; it is checked again for the release's own.
  const addresses = config.instanceAddresses
  if (addresses) {
    validateInstanceAddresses(addresses, environment)
    passed.push(`INSTANCE_ADDRESSES: ${addresses.map((a) => `${a.address} opens ${a.opens}${a.emails ? ' (emails)' : ''}`).join(', ')}`)
  }

  // 3. 0102 creates btree_gist (person_identifier's history constraint).
  if (pending.includes('0102_person_resolution.ts')) {
    const [ext] = await sql`
      select exists (select 1 from pg_extension where extname = 'btree_gist') as installed,
             exists (select 1 from pg_available_extensions where name = 'btree_gist') as available,
             has_database_privilege(current_database(), 'CREATE') as can_create`
    assertBtreeGist(ext as unknown as BtreeGistStatus)
    passed.push('btree_gist available for 0102')
  }
  passed.push(await assertPublicationsPublishGeneratedColumns(pending))
  passed.push(...(await assertAccessConfiguration(environment, pending)))
  passed.push(await assertOneScopeProvider())
  passed.push(await assertNoOpenAppRoleBinding())
  passed.push(...(await appsSetUp()))
  passed.push(await noticeRecipients())
  passed.push(await administratorPasswordMatches())
  passed.push(`pending migrations: ${pending.length ? pending.join(', ') : 'none'}`)
  return passed
}

/** 2. What the stored settings make required (D7). Preflight runs before
 *  the migrations, so each table or column may not exist yet: a database
 *  without them has nothing to require. Before 0100 there is no Sign In
 *  Method yet, but 0100 turns a legacy `google_client_id` setting into an
 *  enabled Google method, so that setting counts. */
export async function settingsRequirements(pending: string[] = []): Promise<Pick<CheckVariablesOptions, 'conditions' | 'named'>> {
  const conditions = new Set<SettingsCondition>()
  const method = await locate('sign_in_method')
  if (method && ['kind', 'enabled', 'client_id'].every((c) => method.columns.has(c))) {
    const [google] = await sql`
      select 1 from ${sql(method.relation)}
      where kind = 'google' and enabled and coalesce(trim(client_id), '') <> '' limit 1`
    if (google) conditions.add('google-sign-in-enabled')
  } else if (pending.includes('0100_person_identities.ts')) {
    const settings = await locate('single_value')
    if (settings) {
      const [legacy] = await sql`
        select 1 from ${sql(settings.relation)}
        where table_name = 'System Settings' and field = 'google_client_id' and coalesce(trim(value), '') <> '' limit 1`
      if (legacy) conditions.add('google-sign-in-enabled')
    }
  }
  // A Data Source reads its connection from the variable its url_env names,
  // so that variable is required while the source exists.
  const named: { name: string; reason: string }[] = []
  const source = await locate('data_source')
  if (source && source.columns.has('url_env')) {
    const rows = await sql`
      select url_env, string_agg(row_id, ', ' order by row_id) as sources
      from ${sql(source.relation)} where coalesce(trim(url_env), '') <> ''
      group by url_env order by url_env`
    for (const r of rows) named.push({ name: String(r.url_env).trim(), reason: `the url_env of data source ${String(r.sources)}` })
  }
  return { conditions, named }
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
  if (blocking.length) throw new Error(publicationRefusal(blocking as unknown as BlockingPublication[]))
  return 'no publication blocks updates on a table with stored generated columns'
}

interface BlockingPublication { pubname: string; schemaname: string; tablename: string; has_column_list: boolean }

/** The refusal text for publications that would make updates fail, with the fix for each. */
export function publicationRefusal(blocking: BlockingPublication[]): string {
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
  const fixes = [...new Set(blocking.map((b) =>
    b.has_column_list
      ? `  publication "${b.pubname}" lists columns for ${b.schemaname}.${b.tablename}: drop the column list (ALTER PUBLICATION ${quote(String(b.pubname))} SET TABLE … without one), or include every stored generated column after 0101;`
      : `  ALTER PUBLICATION ${quote(String(b.pubname))} SET (publish_generated_columns = stored);`))]
  return `${blocking.map((b) => `publication "${b.pubname}" covers ${b.schemaname}.${b.tablename}${b.has_column_list ? ' with a column list' : ''}`).join('; ')}: that table has (or after 0101 will have) stored generated columns and REPLICA IDENTITY FULL, so on PostgreSQL 18 every update to it fails unless the publication publishes them. Fix it first:\n${fixes.join('\n')}`
}

/** #559: exactly one enabled app may provide people's scope. Install and
 *  enable refuse a second one; this catches an instance that got there any
 *  other way. At run time two providers already mean no scope for anyone. */
async function assertOneScopeProvider(): Promise<string> {
  const apps = await locate('installed_app')
  if (!apps || !['manifest', 'enabled'].every((c) => apps.columns.has(c))) return 'scope provider check skipped (no installed apps yet)'
  const providers = (await sql`
    select name from ${sql(apps.relation)} where enabled and manifest ? 'scopeProvider' order by name`).map((r) => String(r.name))
  if (providers.length > 1)
    throw new Error(`More than one enabled app provides people's scope: ${providers.join(', ')}. Disable all but one before releasing; until then no one has a scope.`)
  return providers.length ? `one app provides people's scope: ${providers[0]}` : 'no app provides people\'s scope'
}

/** 5c. #620 (E2): a warning, never a refusal. An installed, enabled app that
 *  lacks a required setting or one of its secrets answers "not set up yet"
 *  until it gets them. Names only: no value is ever printed. */
async function appsSetUp(): Promise<string[]> {
  const apps = await locate('installed_app')
  if (!apps || !['manifest', 'enabled'].every((c) => apps.columns.has(c))) return ['app setup check skipped (no installed apps yet)']
  const settings = await locate('app_setting')
  const sources = await locate('data_source')
  const warnings = (await appSetupState({ installed: apps.relation, settings: settings?.relation ?? null, sources: sources?.relation ?? null }))
    .filter(({ missing }) => missing.length)
    .map(({ app, missing }) => `WARNING: app ${app} is not set up yet: missing ${missing.join(', ')}. Set the setting in the instance settings file and the secret as a deployment variable.`)
  return warnings.length ? warnings : ['every enabled app has its required settings and secrets']
}

/** 5d. #620 (D4): All is every signed-in person and Guest is anyone, so an
 *  app role bound to either is open to everyone. The App Role Binding save
 *  refuses it; this catches a row that got there any other way. */
async function assertNoOpenAppRoleBinding(): Promise<string> {
  const bindings = await locate('app_role_binding')
  if (!bindings) return 'app role binding check skipped (no bindings yet)'
  const open = await sql`select app, app_role, bound_role from ${sql(bindings.relation)}
    where bound_role in ('All', 'Guest') order by app, app_role, bound_role`
  if (open.length)
    throw new Error(open.map((r) => `An app role binding gives ${String(r.app)}'s role ${String(r.app_role)} to ${String(r.bound_role)}, which opens it to everyone. Delete the binding in Admin before releasing.`).join('\n'))
  return 'no app role is bound to All or Guest'
}

/** 6. #463: a warning, never a refusal (a new instance, dev and test start
 *  with only the built-in Administrator, which has no address). System
 *  notices go to enabled System Managers with an email address; with none
 *  besides the Administrator, they reach nobody. */
export const NO_NOTICE_RECIPIENTS_WARNING =
  'WARNING: no enabled System Manager other than the built-in Administrator has an email address, so system alerts (the leaver-check summary, waiting-for-access alerts) will reach nobody. Give a System Manager an email address on their Person page.'

async function noticeRecipients(): Promise<string> {
  const person = await locate('person')
  const role = await locate('has_role')
  if (!person || !role || !['email', 'enabled'].every((c) => person.columns.has(c)))
    return 'notice recipient check skipped (no Person table yet)'
  const current = person.columns.has('replaced_by') ? sql`and p.replaced_by is null` : sql``
  const [found] = await sql`
    select 1 from ${sql(person.relation)} p
    join ${sql(role.relation)} r on r.parent = p.row_id and r.role = 'System Manager'
    where p.row_id <> 'Administrator' and p.enabled ${current} and coalesce(trim(p.email), '') <> ''
    limit 1`
  return found ? 'a System Manager with an email address receives system alerts' : NO_NOTICE_RECIPIENTS_WARNING
}

/** 7. #467: a warning, never a refusal. ADMIN_PASSWORD only provisions a
 *  null hash (admin-bootstrap.ts), so changing it rotates nothing; a set
 *  value that is not the live password is a half-done rotation. Neither
 *  value is ever printed. */
export const ADMIN_PASSWORD_MISMATCH_WARNING =
  "WARNING: ADMIN_PASSWORD is set but is not the Administrator's live password. Changing the variable does not rotate it. Run cli set-password Administrator --stdin (docs/DEPLOY.md, \"Rotating credentials\")."

async function administratorPasswordMatches(): Promise<string> {
  const configured = readVariable('ADMIN_PASSWORD')
  if (!configured?.trim()) return 'ADMIN_PASSWORD is not set, so there is no Administrator password to compare'
  // Before 0101 the table is still `user`.
  const person = (await locate('person')) ?? (await locate('user'))
  if (!person?.columns.has('password_hash')) return 'Administrator password check skipped (no Person table yet)'
  const [admin] = await sql`select password_hash from ${sql(person.relation)} where row_id = 'Administrator'`
  if (!admin?.password_hash) return 'the Administrator has no password yet; cli seed sets it from ADMIN_PASSWORD'
  return verifyPassword(configured, String(admin.password_hash))
    ? "ADMIN_PASSWORD is the Administrator's live password"
    : ADMIN_PASSWORD_MISMATCH_WARNING
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
    // #559: a Table marked as deciding scope is a security Table too (0131 on).
    const definitions = await locate('table_def')
    const marked = definitions?.columns.has('decides_scope')
      ? (await sql`select name from ${sql(definitions.relation)} where decides_scope`).map((r) => String(r.name))
      : []
    const rows = await sql`
      select row_id, role, ref_table, ${sql(flags.map((a) => `can_${a}`))}
      from ${sql(found.relation)}
      where role in ('All', 'Guest') and ref_table in ${sql(['Person', 'User', ...SECURITY_TABLES, ...marked])}
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
