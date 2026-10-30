// The release's preflight (person-resolution review A-M1): every refusal that
// does not depend on the data runs BEFORE the first migration, so a release
// that would stop part-way stops before it starts. A database the migrator
// would refuse (not empty, with no ledger) is refused here.
import { sql } from './db'
import { config, environmentDeclared } from './config'
import { assertDatabaseEnvironment, storedEnvironment } from './db-environment'
import { delegatedTestMode } from './delegated-login'
import { checkVariables, currentEnvironment, readVariable, TEST_MODE_ENVIRONMENTS, type CheckVariablesOptions, type SettingsCondition } from './env'
import { verifyPassword } from './auth'
import { BASELINE, pendingMigrations } from './migrate'
import { SECURITY_TABLES } from './security-tables'
import { platformRelation } from './platform-schema'
import { validateInstanceAddresses } from './instance-addresses'
import { parseDomainList } from './identities'
import { appSetupState } from './app-settings'
import { shippedUpgrades, unshippedApps, upgradeLossWarning, whyUnshipped } from './runtime-packages'
import { followsAppFiles, unshippedRefusal } from './deploy-instance'

interface PreflightOptions {
  /** The environment the new server will run as (default: this process's). */
  environment?: string
  /** This release is the pre-deploy of a client instance (FEATHERBASE_INSTANCE,
   *  #703): an app that isn't shipped gets the reason, and on a dev instance
   *  changed files pass, because the deploy step re-pins them at its end. */
  instanceDeploy?: boolean
}

interface BtreeGistStatus { installed: boolean; available: boolean; can_create: boolean }

/** The baseline needs btree_gist: installed, or installable by this role. */
export function assertBtreeGist(ext: BtreeGistStatus): void {
  if (!ext.installed && !ext.available)
    throw new Error('The baseline needs the btree_gist extension, which this Postgres server does not ship. Install the contrib package first.')
  if (!ext.installed && !ext.can_create)
    throw new Error('The baseline creates the btree_gist extension, but this role may not create extensions in this database. Create it as the owner first: create extension btree_gist;')
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
  const variables = checkVariables({ environment, ...(await settingsRequirements()) })
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

  // 3. The baseline creates btree_gist (person_identifier's history constraint).
  if (pending.includes(BASELINE)) {
    const [ext] = await sql`
      select exists (select 1 from pg_extension where extname = 'btree_gist') as installed,
             exists (select 1 from pg_available_extensions where name = 'btree_gist') as available,
             has_database_privilege(current_database(), 'CREATE') as can_create`
    assertBtreeGist(ext as unknown as BtreeGistStatus)
    passed.push('btree_gist available for the baseline')
  }
  passed.push(await assertPublicationsPublishGeneratedColumns())
  passed.push(...(await assertAccessConfiguration(environment)))
  passed.push(await assertOneScopeProvider())
  passed.push(await assertInstalledAppsShipped(opts.instanceDeploy ? { followFiles: followsAppFiles(environment, await storedEnvironment()) } : undefined))
  passed.push(await assertNoOpenAppRoleBinding())
  passed.push(...(await appsSetUp()))
  passed.push(...(await appUpgradeLosses()))
  passed.push(await noticeRecipients())
  passed.push(await administratorPasswordMatches())
  passed.push(`pending migrations: ${pending.length ? pending.join(', ') : 'none'}`)
  return passed
}

/** 2. What the stored settings make required (D7). Preflight runs before
 *  the migrations, so on a new database there are no settings yet, and
 *  nothing to require. */
export async function settingsRequirements(): Promise<Pick<CheckVariablesOptions, 'conditions' | 'named'>> {
  const conditions = new Set<SettingsCondition>()
  const named: { name: string; reason: string }[] = []
  if (!(await installed())) return { conditions, named }
  const [google] = await sql`
    select 1 from sign_in_method
    where kind = 'google' and enabled and coalesce(trim(client_id), '') <> '' limit 1`
  if (google) conditions.add('google-sign-in-enabled')
  // A Data Source reads its connection from the variable its url_env names,
  // so that variable is required while the source exists.
  const rows = await sql`
    select url_env, string_agg(row_id, ', ' order by row_id) as sources
    from data_source where coalesce(trim(url_env), '') <> ''
    group by url_env order by url_env`
  for (const r of rows) named.push({ name: String(r.url_env).trim(), reason: `the url_env of data source ${String(r.sources)}` })
  return { conditions, named }
}

/** 4. On PostgreSQL 18, a published table whose replica identity is FULL and
 *  that holds stored generated columns refuses EVERY update and delete (42P10
 *  "Replica identity must not contain unpublished generated columns") unless
 *  the publication publishes them: through its column list when it has one
 *  (the list wins), else through publish_generated_columns = stored.
 *  has_role has two such columns, and the warehouse CDC publishes has_role
 *  (#399), so refuse before migrating. Insert-only publications are harmless. */
async function assertPublicationsPublishGeneratedColumns(): Promise<string> {
  const [{ version }] = await sql`select current_setting('server_version_num')::int as version`
  if (version < 180000) return 'publication generated-column check skipped (PostgreSQL before 18)'
  const blocking = await sql`
    with published as (
      select p.pubname, p.pubgencols, pt.schemaname, pt.tablename, c.oid as relid,
             pr.prattrs::int2[] as column_list
      from pg_publication_tables pt
      join pg_publication p on p.pubname = pt.pubname
      join pg_namespace n on n.nspname = pt.schemaname
      join pg_class c on c.relnamespace = n.oid and c.relname = pt.tablename
      left join pg_publication_rel pr on pr.prpubid = p.oid and pr.prrelid = c.oid
      where c.relreplident = 'f' and (p.pubupdate or p.pubdelete))
    select pubname, schemaname, tablename, column_list is not null as has_column_list
    from published
    where case
      when column_list is not null then exists (
        select 1 from pg_attribute a
        where a.attrelid = relid and a.attnum > 0 and not a.attisdropped and a.attgenerated = 's'
          and not a.attnum = any(column_list))
      else pubgencols <> 's' and exists (
        select 1 from pg_attribute a
        where a.attrelid = relid and a.attnum > 0 and not a.attisdropped and a.attgenerated = 's')
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
      ? `  publication "${b.pubname}" lists columns for ${b.schemaname}.${b.tablename}: drop the column list (ALTER PUBLICATION ${quote(String(b.pubname))} SET TABLE … without one), or include every stored generated column;`
      : `  ALTER PUBLICATION ${quote(String(b.pubname))} SET (publish_generated_columns = stored);`))]
  return `${blocking.map((b) => `publication "${b.pubname}" covers ${b.schemaname}.${b.tablename}${b.has_column_list ? ' with a column list' : ''}`).join('; ')}: that table has stored generated columns and REPLICA IDENTITY FULL, so on PostgreSQL 18 every update to it fails unless the publication publishes them. Fix it first:\n${fixes.join('\n')}`
}

/** #559: exactly one enabled app may provide people's scope. Install and
 *  enable refuse a second one; this catches an instance that got there any
 *  other way. At run time two providers already mean no scope for anyone. */
async function assertOneScopeProvider(): Promise<string> {
  if (!(await installed())) return 'scope provider check skipped (no installed apps yet)'
  const providers = (await sql`
    select name from installed_app where enabled and manifest ? 'scopeProvider' order by name`).map((r) => String(r.name))
  if (providers.length > 1)
    throw new Error(`More than one enabled app provides people's scope: ${providers.join(', ')}. Disable all but one before releasing; until then no one has a scope.`)
  return providers.length ? `one app provides people's scope: ${providers[0]}` : 'no app provides people\'s scope'
}

/** 5b. #642 (E7): an installed, enabled app whose exact version and
 *  fingerprint this release does not ship refuses the release (and the
 *  server's start, outside development), so the running release keeps serving
 *  it. A disabled app serves nobody and never blocks. A row with no recorded
 *  version is mid-recovery, which no image can serve. */
export async function assertInstalledAppsShipped(instanceDeploy?: { followFiles: boolean }): Promise<string> {
  const found = await installedNotShipped()
  if (!found) return 'shipped app check skipped (no app versions recorded yet)'
  const { installed, missing } = found
  if (missing.length && instanceDeploy) {
    const paths = JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[]
    const refusals: string[] = []
    const followed: string[] = []
    for (const row of found.missingRows) {
      const reason = await whyUnshipped(row, paths)
      if (reason === 'files' && instanceDeploy.followFiles) followed.push(String(row.name))
      else refusals.push(unshippedRefusal(String(row.name), String(row.package_version), reason))
    }
    if (refusals.length) throw new Error(refusals.join('\n'))
    return `every installed, enabled app ships in this release; the deploy step re-pins ${followed.join(', ')}, whose files changed`
  }
  if (missing.length)
    throw new Error(missing.map(({ name, version }) =>
      `App ${name} version ${version} is installed and enabled, but this release does not ship it. Ship ${name} ${version} in the image (FEATHERBASE_APP_PATHS), or disable the app, before releasing.`).join('\n'))
  return installed.length
    ? `every installed, enabled app ships in this release: ${installed.map(({ name, version }) => `${name} ${version}`).join(', ')}`
    : 'no installed, enabled app to find in this release'
}

/** The same check at the server's start: a refusal, except on a developer's
 *  server. There init.sh runs apps from their source folders, so editing an
 *  app or switching branches changes its fingerprint; the server starts with
 *  the app unavailable, as before #642, and each line says how to bring it
 *  back. Answers those warning lines. */
export async function installedAppsAtStart(environment = currentEnvironment()): Promise<string[]> {
  if (environment !== 'development') {
    await assertInstalledAppsShipped()
    return []
  }
  return ((await installedNotShipped())?.missing ?? []).map(({ name, version }) =>
    `WARNING: App ${name} version ${version} is installed and enabled, but this server does not have it, so it is unavailable. On a developer machine, add the folder holding ${name} ${version} to FEATHERBASE_APP_PATHS (init.sh sets it), or disable the app in Admin. A release refuses until it ships.`)
}

/** The installed, enabled apps with a recorded version, and those of them no
 *  app on FEATHERBASE_APP_PATHS ships; null on a new database. */
async function installedNotShipped() {
  if (!(await installed())) return null
  const rows = await sql`select name, package_version, artifact_digest, manifest from installed_app
    where runtime_package and enabled and package_version is not null order by name`
  const named = (row: Record<string, unknown>) => ({ name: String(row.name), version: String(row.package_version) })
  const missing = await unshippedApps(rows, JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[])
  return { installed: rows.map(named), missing: missing.map(named), missingRows: missing }
}

/** 5e. #651: a warning, never a refusal (the step's destructive: true is the
 *  author's own declaration). For each installed app this release ships a
 *  newer version of, what upgrading to it would remove here, counted per
 *  instance before anything runs. Counts only: no value is ever printed. */
async function appUpgradeLosses(): Promise<string[]> {
  if (!(await installed())) return ['app upgrade loss check skipped (no app versions recorded yet)']
  const apps = await sql`select name, package_version, migration_ledger from installed_app
    where runtime_package and package_version is not null order by name`
  const warnings: string[] = []
  for (const upgrade of await shippedUpgrades(apps, JSON.parse(readVariable('FEATHERBASE_APP_PATHS') ?? '[]') as string[])) {
    const warning = await upgradeLossWarning(upgrade)
    if (warning) warnings.push(warning)
  }
  return warnings.length ? warnings : ['no app upgrade this release ships removes data here']
}

/** 5c. #620 (E2): a warning, never a refusal. An installed, enabled app that
 *  lacks a required setting or one of its secrets answers "not set up yet"
 *  until it gets them. Names only: no value is ever printed. */
async function appsSetUp(): Promise<string[]> {
  if (!(await installed())) return ['app setup check skipped (no installed apps yet)']
  const warnings = (await appSetupState())
    .flatMap(({ app, missing, optional }) => [
      ...(missing.length ? [`WARNING: app ${app} is not set up yet: missing ${missing.join(', ')}. Set the setting in the instance settings file and the secret as a deployment variable.`] : []),
      // #666: a missing optional secret holds up only what needs it.
      ...(optional.length ? [`WARNING: app ${app} lacks ${optional.join(', ')}. Only those answer "not set up yet"; the rest of the app works. Set the secret as a deployment variable to turn them on.`] : []),
    ])
  return warnings.length ? warnings : ['every enabled app has its required settings and secrets']
}

/** 5d. #620 (D4): All is every signed-in person and Guest is anyone, so an
 *  app role bound to either is open to everyone. The App Role Binding save
 *  refuses it; this catches a row that got there any other way. */
async function assertNoOpenAppRoleBinding(): Promise<string> {
  if (!(await installed())) return 'app role binding check skipped (no bindings yet)'
  const open = await sql`select app, app_role, bound_role from app_role_binding
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
  if (!(await installed())) return 'notice recipient check skipped (no Person table yet)'
  const [found] = await sql`
    select 1 from person p
    join has_role r on r.parent = p.row_id and r.role = 'System Manager'
    where p.row_id <> 'Administrator' and p.enabled and p.replaced_by is null and coalesce(trim(p.email), '') <> ''
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
  if (!(await installed())) return 'Administrator password check skipped (no Person table yet)'
  const [admin] = await sql`select password_hash from person where row_id = 'Administrator'`
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

/** Whether the platform is installed here. Preflight runs before the
 *  migrations, and the migrator accepts only an empty database or one it has
 *  migrated from the baseline, so a database has every platform table or none. */
async function installed(): Promise<boolean> {
  const [found] = await sql`select to_regclass(${platformRelation('table_def')}) is not null as installed`
  return Boolean(found?.installed)
}

/** 5. #437: access configuration a release must never carry.
 *  (a) the implicit roles All (every signed-in principal) and Guest never
 *      hold a grant on Person or on an access-control Table;
 *  (b) password sign-in creates new people only in development or test;
 *  (c) a method that creates people never admits any address (`*`) or a
 *      consumer email domain.
 *  A new database has nothing to check yet. */
async function assertAccessConfiguration(environment: string): Promise<string[]> {
  const problems: string[] = []
  if (await installed()) {
    // #559: a Table marked as deciding scope is a security Table too.
    const marked = (await sql`select name from table_def where decides_scope`).map((r) => String(r.name))
    const grants = await sql`
      select row_id, role, ref_table, ${sql(ACTION_FLAGS.map((a) => `can_${a}`))}
      from permission
      where role in ('All', 'Guest') and ref_table in ${sql(['Person', ...SECURITY_TABLES, ...marked])}
      order by role, ref_table, row_id`
    for (const r of grants) {
      const granted = ACTION_FLAGS.filter((a) => r[`can_${a}`] === true)
      if (granted.length)
        problems.push(`Permission ${String(r.row_id)} grants role "${String(r.role)}" on "${String(r.ref_table)}" (${granted.join(', ')}): give these Tables to named roles only, and delete the row`)
    }
    const rows = await sql`
      select row_id, kind, new_person, allowed_email_domains as domains
      from sign_in_method order by row_id`
    for (const r of rows) {
      const creates = String(r.new_person ?? 'refuse') !== 'refuse'
      // `create` ignores allowed_email_domains (sign-in.ts): password admits
      // anyone who signs up, Google any Google account.
      if (String(r.new_person) === 'create' && !SIGN_UP_ENVIRONMENTS.includes(environment))
        problems.push(`the ${String(r.kind)} sign-in method "${String(r.row_id)}" creates a new person for anyone it admits, on a "${environment}" server: set its new_person to refuse${String(r.kind) === 'password' ? '' : ' or create_if_email_domain_allowed with company domains'}`)
      if (!creates) continue
      const open = parseDomainList(r.domains as string | null)
        .filter((d) => d === '*' || CONSUMER_EMAIL_DOMAINS.has(d))
      for (const d of open)
        problems.push(`sign-in method "${String(r.row_id)}" creates new people from "${d}": list company domains only, or set its new_person to refuse`)
    }
  }
  if (problems.length) throw new Error(`Access configuration is unsafe to release:\n  ${problems.join('\n  ')}`)
  return [
    'no Permission row grants All or Guest on Person or an access-control Table',
    'no sign-in method creates new people for anyone here',
    'no sign-in method creates people from any address or a consumer email domain',
  ]
}
