// A release cannot stop part-way through for a reason it could have known
// (review A-M1, #399): the refusals that do not need the data run before the
// first migration.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { ADMIN_PASSWORD_MISMATCH_WARNING, NO_NOTICE_RECIPIENTS_WARNING, preflightRelease } from '../src/release-preflight'
import { hashPassword } from '../src/auth'
import { makePerson } from './fixtures'
import { withNamedVariable } from '../src/env'
import { createTable } from '../src/table-engine'
import { artifactDigest } from '../src/runtime-packages'
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'

afterEach(() => vi.unstubAllEnvs())

const PASSES = 'no publication blocks updates on a table with stored generated columns'
// publish_generated_columns exists from PostgreSQL 18 (CI also runs 17).
const probe = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const [{ server_version_num }] = await probe`show server_version_num`
await probe.end()
const pg18 = Number(server_version_num) >= 180000

describe('release preflight', () => {
  test('warns, without refusing, when no System Manager but the built-in Administrator has an email address (#463)', async () => {
    await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
    await sql`update person set email = 'admin.builtin@example.com' where row_id = 'Administrator'`
    expect(await preflightRelease({ environment: 'test' })).toContain(NO_NOTICE_RECIPIENTS_WARNING)
    await makePerson({ full_name: 'Manager', email: 'notice.manager@example.com', roles: [{ role: 'System Manager' }] })
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).not.toContain(NO_NOTICE_RECIPIENTS_WARNING)
    expect(lines).toContain('a System Manager with an email address receives system alerts')
  })

  test('a release that does not declare its environment refuses (#430)', async () => {
    vi.stubEnv('FEATHERBASE_ENV', '')
    vi.stubEnv('NODE_ENV', '')
    await expect(preflightRelease()).rejects.toThrow(/Neither FEATHERBASE_ENV nor NODE_ENV is set/)
  })

  test('test mode on a production server refuses', async () => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/DELEGATED_LOGIN_TEST_MODE is set on a "production" server/)
  })

  test('test mode against a database labelled production refuses, even for a staging process', async () => {
    // A hosted staging trial never runs the mock Google provider this suite turns on (env.ts).
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    await sql`update internal_metadata set value = 'production' where key = 'environment'`
    await expect(preflightRelease({ environment: 'staging' })).rejects.toThrow(/this database is labelled "production"/)
  })

  // PostgreSQL 18 refuses every UPDATE on a published table whose replica
  // identity is FULL and holds stored generated columns the publication does
  // not publish (42P10). has_role carries two (#399).
  test.skipIf(!pg18)('a publication that would block has_role updates refuses, naming the fix', async () => {
    await sql.unsafe(`alter table featherbase.has_role replica identity full`)
    await sql.unsafe(`create publication fb_test_blocking_pub for table featherbase.has_role with (publish_generated_columns = none)`)
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(
      /publication "fb_test_blocking_pub".*featherbase\.has_role[\s\S]*ALTER PUBLICATION "fb_test_blocking_pub" SET \(publish_generated_columns = stored\)/,
    )
  })

  test.skipIf(!pg18)('a publication that publishes stored generated columns passes', async () => {
    await sql.unsafe(`alter table featherbase.has_role replica identity full`)
    await sql.unsafe(`create publication fb_test_stored_pub for table featherbase.has_role with (publish_generated_columns = stored)`)
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).toContain(PASSES)
  })

  test.skipIf(!pg18)('an insert-only publication never blocks updates, so it passes', async () => {
    await sql.unsafe(`alter table featherbase.has_role replica identity full`)
    await sql.unsafe(`create publication fb_test_insert_pub for table featherbase.has_role with (publish = 'insert', publish_generated_columns = none)`)
    expect(await preflightRelease({ environment: 'test' })).toContain(PASSES)
  })

  // A column list wins over publish_generated_columns (PG 18 docs), so
  // `stored` does not help a list that leaves the generated columns out.
  test.skipIf(!pg18)('a column list that leaves out the generated columns refuses, even with stored', async () => {
    await sql.unsafe(`alter table featherbase.has_role replica identity full`)
    await sql.unsafe(`create publication fb_test_list_pub for table featherbase.has_role (row_id, parent, parenttype, role) with (publish_generated_columns = stored)`)
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/publication "fb_test_list_pub".*column list/)
  })

  test.skipIf(pg18)('before PostgreSQL 18 the publication check is skipped and says so', async () => {
    expect(await preflightRelease({ environment: 'test' })).toContain('publication generated-column check skipped (PostgreSQL before 18)')
  })

  test('where test mode is allowed, every check passes and says so', async () => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).toContain('test mode on, allowed here')
    expect(lines.some((l) => l.startsWith('pending migrations:'))).toBe(true)
  })
})

// #559: exactly one enabled app may provide people's scope.
describe('release preflight: the scope provider', () => {
  async function installed(name: string, provides: boolean, enabled = true) {
    const manifest = { name, ...(provides ? { scopeProvider: { name: 'positions', tables: [`${name}.position`] } } : {}) }
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values (${name}, ${sql.json(manifest)}, ${enabled}, true)`
  }

  test('one enabled provider passes and says which app it is', async () => {
    await installed('rostera', true)
    await installed('rosterb', true, false)
    await installed('consumer', false)
    expect(await preflightRelease({ environment: 'test' })).toContain('one app provides people\'s scope: rostera')
  })

  test('two enabled providers refuse, naming both', async () => {
    await installed('rostera', true)
    await installed('rosterb', true)
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/rostera, rosterb/)
  })
})

// #620 (E2): an installed, enabled app that lacks a required setting or
// secret is "not set up yet". The release warns, naming the app and what is
// missing (names only), and still goes ahead.
describe('release preflight: app settings and secrets', () => {
  const manifest = { name: 'setupcheck', settings: [{ name: 'report_id', required: true }, { name: 'theme', required: false }], secrets: ['SETUPCHECK_TOKEN'] }
  const install = (enabled = true) =>
    sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('setupcheck', ${sql.json(manifest)}, ${enabled}, true)`

  test('an enabled app missing a required setting and its secret warns, naming both', async () => {
    await install()
    expect(await withNamedVariable('SETUPCHECK_TOKEN', undefined, () => preflightRelease({ environment: 'test' })))
      .toContain('WARNING: app setupcheck is not set up yet: missing setting report_id, secret SETUPCHECK_TOKEN. Set the setting in the instance settings file and the secret as a deployment variable.')
  })

  test('an app whose required setting and secret are set passes without printing either value', async () => {
    await install()
    await sql`insert into app_setting (row_id, app, setting, value) values ('setupcheck.report_id', 'setupcheck', 'report_id', 'R-77')`
    const lines = await withNamedVariable('SETUPCHECK_TOKEN', 'token-value-620', () => preflightRelease({ environment: 'test' }))
    expect(lines).toContain('every enabled app has its required settings and secrets')
    expect(lines.join('\n')).not.toMatch(/R-77|token-value-620/)
  })

  // #666: an optional secret holds up only the reads and actions that need it.
  test('an enabled app missing only an optional secret warns, naming the secret and the reads that need it', async () => {
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('setupoptional', ${sql.json({ name: 'setupoptional',
      secrets: ['SETUPOPT_TOKEN', { name: 'SETUPOPT_EMBED', optional: true }], reads: { operations: { quick_view: {}, embed: { needs: ['SETUPOPT_EMBED'] } } } })}, true, true)`
    const lines = await withNamedVariable('SETUPOPT_TOKEN', 'token-opt-666', () => withNamedVariable('SETUPOPT_EMBED', undefined, () => preflightRelease({ environment: 'test' })))
    expect(lines).toContain('WARNING: app setupoptional lacks optional secret SETUPOPT_EMBED (needed by read embed). Only those answer "not set up yet"; the rest of the app works. Set the secret as a deployment variable to turn them on.')
  })

  // #660: a scope provider's declared identifier system the instance lacks.
  test('an enabled scope provider declaring an identifier system the instance lacks warns, naming it', async () => {
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('setupprovider',
      ${sql.json({ name: 'setupprovider', scopeProvider: { name: 'positions', tables: ['x'], identifiers: ['setup-missing-code'] } })}, true, true)`
    expect(await preflightRelease({ environment: 'test' }))
      .toContain('WARNING: app setupprovider is not set up yet: missing identifier system setup-missing-code. Set the setting in the instance settings file and the secret as a deployment variable.')
  })

  test('an enabled scope provider declaring a turned-off identifier system warns, naming it', async () => {
    await sql`insert into identifier_system (row_id, label, kind, enabled) values ('setup-off-code', 'Setup off code', 'employee-record', false)`
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('setupprovider',
      ${sql.json({ name: 'setupprovider', scopeProvider: { name: 'positions', tables: ['x'], identifiers: ['setup-off-code'] } })}, true, true)`
    expect((await preflightRelease({ environment: 'test' })).join('\n')).toContain('missing identifier system setup-off-code is turned off.')
  })

  test('an enabled scope provider declaring a Secret identifier system warns, naming it', async () => {
    await sql`insert into identifier_system (row_id, label, kind, sensitivity, match) values ('setup-secret-code', 'Setup secret code', 'national-id', 'Secret', 'Off')`
    await sql`insert into installed_app (name, manifest, enabled, runtime_package) values ('setupprovider',
      ${sql.json({ name: 'setupprovider', scopeProvider: { name: 'positions', tables: ['x'], identifiers: ['setup-secret-code'] } })}, true, true)`
    expect((await preflightRelease({ environment: 'test' })).join('\n')).toContain("missing identifier system setup-secret-code is secret and can't be given to an app.")
  })

  test('a disabled app is not checked', async () => {
    await install(false)
    expect(await withNamedVariable('SETUPCHECK_TOKEN', undefined, () => preflightRelease({ environment: 'test' })))
      .toContain('every enabled app has its required settings and secrets')
  })
})

// #620 (D4): All and Guest are held by every signed-in person or by anyone,
// so binding an app role to either opens the app to everyone.
describe('release preflight: app role bindings', () => {
  test.for(['All', 'Guest'])('a binding to %s refuses the release', async (role) => {
    await sql`insert into app_role_binding (row_id, app, app_role, bound_role) values ('b-1', 'someapp', 'Some Reader', ${role})`
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(`An app role binding gives someapp's role Some Reader to ${role}`)
  })
})

// #642 (E7): a release that lacks the exact version of an installed, enabled
// app refuses, so a deploy never silently takes the app away.
describe('release preflight: installed apps ship in the release', () => {
  const OTHER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../test-apps/other')
  const install = (version: string, digest: string, enabled = true) =>
    sql`insert into installed_app (name, manifest, enabled, runtime_package, package_version, artifact_digest)
      values ('other', ${sql.json({ name: 'other' })}, ${enabled}, true, ${version}, ${digest})`

  test('an enabled app whose installed version is not shipped refuses, naming the app and version', async () => {
    vi.stubEnv('FEATHERBASE_APP_PATHS', '[]')
    await install('0.0.1', 'a-fingerprint-this-release-lacks')
    await expect(preflightRelease({ environment: 'test' })).rejects
      .toThrow('App other version 0.0.1 is installed and enabled, but this release does not ship it. Ship other 0.0.1 in the image (FEATHERBASE_APP_PATHS), or disable the app, before releasing.')
  })

  test('an enabled app whose exact version and fingerprint are shipped passes, naming it', async () => {
    vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([OTHER]))
    await install('0.0.1', await artifactDigest(await realpath(OTHER)))
    expect(await preflightRelease({ environment: 'test' })).toContain('every installed, enabled app ships in this release: other 0.0.1')
  })

  test('the same version with other files refuses', async () => {
    vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([OTHER]))
    await install('0.0.1', 'the-fingerprint-of-different-files')
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow('App other version 0.0.1 is installed and enabled, but this release does not ship it.')
  })

  // Codex round 1 on #643: boot drops a version shipped twice with different
  // files, so it is not shipped, even when one copy matches.
  test('two different artifacts for the installed version refuse, though one of them matches', async () => {
    const conflicting = await mkdtemp(resolve(dirname(fileURLToPath(import.meta.url)), '.b5-642-conflict-'))
    try {
      await cp(OTHER, conflicting, { recursive: true })
      await writeFile(resolve(conflicting, 'client', 'extra.txt'), 'different files, same version')
      vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([OTHER, conflicting]))
      await install('0.0.1', await artifactDigest(await realpath(OTHER)))
      await expect(preflightRelease({ environment: 'test' })).rejects.toThrow('App other version 0.0.1 is installed and enabled, but this release does not ship it.')
    } finally {
      await rm(conflicting, { recursive: true, force: true })
    }
  })

  test('a disabled app that is not shipped does not block the release', async () => {
    vi.stubEnv('FEATHERBASE_APP_PATHS', '[]')
    await install('0.0.1', 'a-fingerprint-this-release-lacks', false)
    expect(await preflightRelease({ environment: 'test' })).toContain('no installed, enabled app to find in this release')
  })
})

// #467: ADMIN_PASSWORD only provisions a null hash, so changing it rotates
// nothing. A release that finds the variable set but not live says so,
// without ever printing either value, and still goes ahead.
describe('release preflight: the configured Administrator password', () => {
  const live = 'the-live-password-467'
  const setLive = async (password: string | null) =>
    sql`update person set password_hash = ${password === null ? null : hashPassword(password)} where row_id = 'Administrator'`

  test('a set ADMIN_PASSWORD that is not the live password warns, and the release goes ahead', async () => {
    await setLive(live)
    vi.stubEnv('ADMIN_PASSWORD', 'a-rotated-password-467')
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).toContain(ADMIN_PASSWORD_MISMATCH_WARNING)
    expect(ADMIN_PASSWORD_MISMATCH_WARNING).toMatch(/^WARNING: .*cli set-password Administrator --stdin/)
    for (const line of lines) {
      expect(line).not.toContain('a-rotated-password-467')
      expect(line).not.toContain(live)
    }
  })

  test('a set ADMIN_PASSWORD that is the live password passes and says so', async () => {
    await setLive(live)
    vi.stubEnv('ADMIN_PASSWORD', live)
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).not.toContain(ADMIN_PASSWORD_MISMATCH_WARNING)
    expect(lines).toContain("ADMIN_PASSWORD is the Administrator's live password")
  })

  test('an unset or blank ADMIN_PASSWORD has nothing to compare', async () => {
    await setLive(live)
    for (const unset of ['', '   ']) {
      vi.stubEnv('ADMIN_PASSWORD', unset)
      const lines = await preflightRelease({ environment: 'test' })
      expect(lines).not.toContain(ADMIN_PASSWORD_MISMATCH_WARNING)
      expect(lines).toContain('ADMIN_PASSWORD is not set, so there is no Administrator password to compare')
    }
  })

  test('a set ADMIN_PASSWORD while the Administrator has no password yet does not warn of a mismatch', async () => {
    await setLive(null)
    vi.stubEnv('ADMIN_PASSWORD', 'a-first-password-467')
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).not.toContain(ADMIN_PASSWORD_MISMATCH_WARNING)
    expect(lines).toContain('the Administrator has no password yet; cli seed sets it from ADMIN_PASSWORD')
  })
})

// #437: the access configuration a release must never ship with.
describe('release preflight: access configuration', () => {
  const ACCESS_OK = 'no Permission row grants All or Guest on Person or an access-control Table'
  const SIGNUP_OK = 'no sign-in method creates new people for anyone here'
  const DOMAINS_OK = 'no sign-in method creates people from any address or a consumer email domain'

  // These cases run preflight as production; give it the INSTANCE_ADDRESSES a
  // production server must have (#430, #488), its own JWT_SECRET, and no mock
  // Google provider (which this suite turns on for itself, vitest.config.ts),
  // so they reach the access checks they are about.
  let addressesBefore: typeof config.instanceAddresses = null
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'a-production-secret')
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    addressesBefore = config.instanceAddresses
    config.instanceAddresses = parseInstanceAddresses('[{"address":"https://featherbase.example.test","opens":"admin","emails":true}]', 'production')
  })
  afterEach(() => {
    config.instanceAddresses = addressesBefore
  })

  async function grant(role: string, refTable: string, flags: Record<string, boolean>) {
    await sql`insert into permission ${sql({ row_id: `p437-${role}-${refTable}`.replaceAll(' ', '-'), ref_table: refTable, role, tier: 'basic', created_by: 'Administrator', updated_by: 'Administrator', ...flags })}`
  }

  test('a clean instance passes all three and says so', async () => {
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).toEqual(expect.arrayContaining([ACCESS_OK, SIGNUP_OK, DOMAINS_OK]))
  })

  test('(a) All reading Person refuses, naming the row', async () => {
    await grant('All', 'Person', { can_read: true })
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/role "All" on "Person" \(read\)/)
  })

  test('(a) Guest writing a security Table refuses', async () => {
    await grant('Guest', 'Data Scope', { can_create: true })
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/role "Guest" on "Data Scope" \(create\)/)
  })

  test('(a) All writing a Table marked as deciding scope refuses (#559)', async () => {
    await createTable({ name: 'Shift Roster 559', decides_scope: true, columns: [{ column_name: 'place', column_type: 'Data' }] })
    await grant('All', 'Shift Roster 559', { can_write: true })
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/role "All" on "Shift Roster 559" \(write\)/)
  })

  test('(a) a grant with every action off, or to another role, passes', async () => {
    await grant('All', 'Share', {})
    await grant('Sales Target Viewer', 'Person', { can_read: true })
    expect(await preflightRelease({ environment: 'test' })).toContain(ACCESS_OK)
  })

  test('(b) password sign-up outside development or test refuses; in test it passes', async () => {
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    await sql`update sign_in_method set new_person = 'create' where kind = 'password'`
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/password sign-in method "password" creates a new person/)
    await expect(preflightRelease({ environment: 'staging' })).rejects.toThrow(/password sign-in method "password" creates a new person/)
    expect(await preflightRelease({ environment: 'test' })).toContain(SIGNUP_OK)
    expect(await preflightRelease({ environment: 'development' })).toContain(SIGNUP_OK)
  })

  test('(b) a Google method that creates anyone it admits refuses outside development or test', async () => {
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    await sql`update sign_in_method set new_person = 'create', allowed_email_domains = 'example.com' where kind = 'google'`
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/google sign-in method "google" creates a new person/)
    expect(await preflightRelease({ environment: 'test' })).toContain(SIGNUP_OK)
  })

  test('(c) any-address or consumer domains while creating people refuse', async () => {
    await sql`update sign_in_method set new_person = 'create_if_email_domain_allowed', allowed_email_domains = 'example.com, *' where kind = 'password'`
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/"password".*"\*"/)
    await sql`update sign_in_method set allowed_email_domains = 'example.com,Gmail.com' where kind = 'password'`
    await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/"password".*"gmail\.com"/)
  })

  test('(c) a company domain while creating, or a consumer domain while refusing, passes', async () => {
    await sql`update sign_in_method set new_person = 'create_if_email_domain_allowed', allowed_email_domains = 'example.com' where kind = 'password'`
    expect(await preflightRelease({ environment: 'test' })).toContain(DOMAINS_OK)
    await sql`update sign_in_method set new_person = 'refuse', allowed_email_domains = 'gmail.com,*' where kind = 'password'`
    expect(await preflightRelease({ environment: 'test' })).toContain(DOMAINS_OK)
  })
})

// End to end: the real release command against a fresh database labelled
// production, with test mode set. It must stop before creating anything.
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsx = resolve(server, 'node_modules/tsx/dist/cli.mjs')
const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const created: string[] = []
afterAll(async () => {
  for (const name of created) await admin.unsafe(`drop database "${name}" with (force)`)
  await admin.end()
})

it('a production-labelled database with test mode set refuses BEFORE migrating', async () => {
  const name = `featherbase_preflight_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database "${name}"`)
  created.push(name)
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
  try {
    await db.unsafe(`create schema featherbase;
      create table featherbase.internal_metadata (key text primary key, value text not null, updated_at timestamptz not null default now());
      insert into featherbase.internal_metadata (key, value) values ('environment', 'production')`)
    let output = ''
    let failed = false
    try {
      execFileSync(process.execPath, [tsx, 'src/release.ts'], {
        cwd: server, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: 'production', NODE_ENV: 'production', ADMIN_PASSWORD: '', DELEGATED_LOGIN_TEST_MODE: 'trust-any-password' },
      })
    } catch (error) {
      failed = true
      const e = error as { stdout?: string; stderr?: string }
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(failed).toBe(true)
    expect(output).toMatch(/release failed — aborting: DELEGATED_LOGIN_TEST_MODE is set on a "production" server/)
    expect(output).not.toMatch(/applied 0001/)
    const [ledger] = await db`select to_regclass('featherbase.migration') as m, to_regclass('public.migration') as p`
    expect(ledger).toEqual({ m: null, p: null })
  } finally {
    await db.end()
  }
}, 90_000)

// #642 (E7): the refusal comes before the first migration, so the database the
// running release serves is left exactly as it was.
it('a release that does not ship an installed, enabled app refuses BEFORE migrating', async () => {
  const name = `featherbase_preflight_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database "${name}"`)
  created.push(name)
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
  try {
    // An installed instance, one migration behind, carrying an app this release lacks.
    execFileSync(process.execPath, [tsx, 'src/migrate.ts'], {
      cwd: server, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: 'test', NODE_ENV: 'test' },
    })
    await db`delete from featherbase.migration where name = '0003_mock_google_sign_in.ts'`
    await db.unsafe(`insert into featherbase.installed_app (name, manifest, runtime_package, package_version, artifact_digest)
      values ('acme_board', '{"name": "acme_board"}', true, '1.2.0', 'fingerprint-of-1.2.0')`)
    const before = await db`select * from featherbase.installed_app`
    let output = ''
    let failed = false
    try {
      execFileSync(process.execPath, [tsx, 'src/release.ts'], {
        cwd: server, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: 'test', NODE_ENV: 'test', ADMIN_PASSWORD: '', DELEGATED_LOGIN_TEST_MODE: '', FEATHERBASE_APP_PATHS: '[]' },
      })
    } catch (error) {
      failed = true
      const e = error as { stdout?: string; stderr?: string }
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(failed).toBe(true)
    expect(output).toMatch(/release failed — aborting: App acme_board version 1\.2\.0 is installed and enabled, but this release does not ship it/)
    expect(await db`select name from featherbase.migration where name = '0003_mock_google_sign_in.ts'`).toEqual([])
    expect(await db`select * from featherbase.installed_app`).toEqual(before)
  } finally {
    await db.end()
  }
}, 90_000)

// instance-settings-as-code D7 (#465): the deployment-variable registry runs
// in the release, with the variables the stored settings make required.
describe('release preflight: deployment variables', () => {
  // A complete production environment; each case takes one thing away.
  beforeEach(() => {
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    vi.stubEnv('INSTANCE_ADDRESSES', '[{"address":"https://featherbase.example.test","opens":"admin","emails":true}]')
    vi.stubEnv('JWT_SECRET', 'a-production-secret')
    vi.stubEnv('FILE_STORAGE_DIR', '/data/files')
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
  })

  test('a complete production environment passes and says so', async () => {
    const lines = await preflightRelease({ environment: 'production' })
    expect(lines).toEqual(expect.arrayContaining(['JWT_SECRET set', 'INSTANCE_ADDRESSES set', 'FILE_STORAGE_DIR set']))
  })

  test('a missing JWT_SECRET refuses before migrating, naming it', async () => {
    vi.stubEnv('JWT_SECRET', '')
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/JWT_SECRET is not set on a "production" server/)
  })

  test('a missing FILE_STORAGE_DIR warns and the release goes ahead', async () => {
    vi.stubEnv('FILE_STORAGE_DIR', ' ')
    expect(await preflightRelease({ environment: 'production' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^WARNING: FILE_STORAGE_DIR is not set on a "production" server/)]))
  })

  test('the mock Google provider refuses a production release', async () => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '1')
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/^ALLOW_MOCK_OAUTH is set on a "production" server/)
  })

  test('an enabled Google method with a client id needs GOOGLE_CLIENT_SECRET', async () => {
    // Without a client id the method is not a real Google client: nothing to require.
    await sql`update sign_in_method set enabled = true, client_id = null where kind = 'google'`
    expect(await preflightRelease({ environment: 'production' })).not.toContain('GOOGLE_CLIENT_SECRET set')
    await sql`update sign_in_method set enabled = true, client_id = 'client.apps.googleusercontent.com' where kind = 'google'`
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(
      /GOOGLE_CLIENT_SECRET is not set on a "production" server\. \(required while a Google sign-in method is enabled with a client id\)/)
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'the-google-secret')
    expect(await preflightRelease({ environment: 'production' })).toContain('GOOGLE_CLIENT_SECRET set')
    // Disabled again: not required.
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    await sql`update sign_in_method set enabled = false where kind = 'google'`
    expect(await preflightRelease({ environment: 'production' })).not.toContain('GOOGLE_CLIENT_SECRET set')
  })

  // A missing source URL makes only that source unusable, so the release warns
  // and goes ahead; the refusal is at the point of use (#482 decision).
  test("a data source's missing url_env warns at release, and the source refuses its queries", async () => {
    await sql`insert into data_source (row_id, engine, url_env) values ('fb_test_warehouse', 'postgres', 'FB_TEST_WAREHOUSE_URL')`
    for (const environment of ['production', 'development'])
      expect(await preflightRelease({ environment })).toEqual(expect.arrayContaining([
        expect.stringMatching(new RegExp(`^WARNING: FB_TEST_WAREHOUSE_URL is not set on a "${environment}" server \\(the url_env of data source fb_test_warehouse\\)`))]))
    vi.stubEnv('FB_TEST_WAREHOUSE_URL', '  ')
    const { resolveUrl } = await import('../src/sources/registry')
    expect(() => resolveUrl({ name: 'fb_test_warehouse', engine: 'postgres', url_env: 'FB_TEST_WAREHOUSE_URL' } as Parameters<typeof resolveUrl>[0]))
      .toThrow('Environment variable FB_TEST_WAREHOUSE_URL is not set (required by data source fb_test_warehouse)')
    vi.stubEnv('FB_TEST_WAREHOUSE_URL', 'postgres://warehouse.example.test/db')
    expect(await preflightRelease({ environment: 'production' })).toContain('FB_TEST_WAREHOUSE_URL set (the url_env of data source fb_test_warehouse)')
  })
})

// Break-glass (#465 design constraint): only the HTTP server start and the
// release refuse. A CLI command over `railway ssh` still runs while a required
// variable is missing.
describe('where a missing variable refuses', () => {
  const productionMissingJwt = (url: string) => ({
    ...process.env, DATABASE_URL: url, FEATHERBASE_ENV: 'production', NODE_ENV: 'production',
    INSTANCE_ADDRESSES: '[{"address":"https://featherbase.example.com","opens":"admin","emails":true}]', JWT_SECRET: '', ALLOW_MOCK_OAUTH: '', ADMIN_PASSWORD: '',
    DISABLE_DATABASE_ENVIRONMENT_CHECK: '1', PORT: '0',
  })
  function runTsx(args: string[], env: NodeJS.ProcessEnv, input?: string): { ok: boolean; output: string } {
    try {
      const out = execFileSync(process.execPath, [tsx, ...args], { cwd: server, encoding: 'utf8', timeout: 60_000, env, input, stdio: ['pipe', 'pipe', 'pipe'] })
      return { ok: true, output: out }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string }
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }

  it('the server refuses to start; cli settings:set and create-person still run', async () => {
    const name = `featherbase_breakglass_${randomUUID().replaceAll('-', '')}`
    await admin.unsafe(`create database "${name}"`)
    created.push(name)
    const url = new URL(config.databaseUrl)
    url.pathname = `/${name}`
    const env = productionMissingJwt(url.toString())
    expect(runTsx(['src/migrate.ts'], env).ok).toBe(true)

    const boot = runTsx(['src/index.ts'], env)
    expect(boot.ok).toBe(false)
    expect(boot.output).toMatch(/JWT_SECRET is not set on a "production" server/)
    expect(boot.output).not.toMatch(/server listening/)

    const set = runTsx(['src/cli.ts', 'settings:set', 'app_name', '--stdin'], env, 'Break Glass')
    expect(set.output).toMatch(/System Settings app_name set/)
    const person = runTsx(['src/cli.ts', 'create-person', 'breakglass@example.com', 'A-long-break-glass-password-1', '--full-name', 'Break Glass'], env)
    expect(person.output).not.toMatch(/JWT_SECRET/)
    expect(person.ok, person.output).toBe(true)

    const release = runTsx(['src/release.ts'], env)
    expect(release.ok).toBe(false)
    expect(release.output).toMatch(/release failed — aborting: JWT_SECRET is not set on a "production" server/)

    // The start reads the stored settings too: an enabled Google method with
    // a client id needs its secret at boot. A Data Source's url_env only warns.
    const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
    try {
      await db`update featherbase.sign_in_method set enabled = true, client_id = 'client.apps.googleusercontent.com' where kind = 'google'`
      await db`insert into featherbase.data_source (row_id, engine, url_env) values ('fb_boot_warehouse', 'postgres', 'FB_BOOT_WAREHOUSE_URL')`
    } finally {
      await db.end()
    }
    const withJwt = { ...env, JWT_SECRET: 'a-production-secret', GOOGLE_CLIENT_SECRET: '', FB_BOOT_WAREHOUSE_URL: '' }
    const settingsBoot = runTsx(['src/index.ts'], withJwt)
    expect(settingsBoot.ok).toBe(false)
    expect(settingsBoot.output).toMatch(/GOOGLE_CLIENT_SECRET is not set on a "production" server/)
    expect(settingsBoot.output).not.toMatch(/FB_BOOT_WAREHOUSE_URL/)
    expect(settingsBoot.output).not.toMatch(/server listening/)
    expect(runTsx(['src/cli.ts', 'list-tokens', 'Administrator'], withJwt).ok).toBe(true)
  }, 180_000)
})

// Running an Instance / Two releases at once do not collide: a release that
// starts while another holds the release lock waits, applies nothing, and
// then finds the work done.
describe('two releases at once', () => {
  it('a second release waits for the first, then applies nothing', async () => {
    const { spawn } = await import('node:child_process')
    const name = `featherbase_lock_${randomUUID().replaceAll('-', '')}`
    await admin.unsafe(`create database "${name}"`)
    created.push(name)
    const url = new URL(config.databaseUrl)
    url.pathname = `/${name}`
    const env = {
      ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: 'test', NODE_ENV: 'test',
      ADMIN_PASSWORD: '', DELEGATED_LOGIN_TEST_MODE: '', ALLOW_MOCK_OAUTH: '',
    }
    const holder = postgres(url.toString(), { max: 1, onnotice: () => {} })
    let output = ''
    let exited: number | null = null
    let child: ReturnType<typeof spawn> | undefined
    try {
      let release!: () => void
      const held = new Promise<void>((resolveHeld) => {
        void holder.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(hashtext('featherbase-release'))`
          resolveHeld()
          await new Promise<void>((resolveRelease) => (release = resolveRelease))
        })
      })
      await held
      child = spawn(process.execPath, [tsx, 'src/release.ts'], { cwd: server, env, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout!.on('data', (d) => (output += d))
      child.stderr!.on('data', (d) => (output += d))
      child.on('exit', (code) => (exited = code ?? 1))
      // While the lock is held the release applies nothing and does not finish.
      await new Promise((resolveWait) => setTimeout(resolveWait, 6_000))
      expect(exited).toBeNull()
      expect(output).not.toMatch(/applied /)
      release()
      const deadline = Date.now() + 80_000
      while (exited === null && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
      expect(exited, output).toBe(0)
      expect(output).toMatch(/migrations up to date/)
    } finally {
      child?.kill()
      await holder.end({ timeout: 1 })
    }
  }, 120_000)
})

describe('release preflight: the btree_gist extension the baseline creates', () => {
  it('a release to a new database checks the extension and says it is available, then installs', async () => {
    const name = `featherbase_preflight_${randomUUID().replaceAll('-', '')}`
    await admin.unsafe(`create database "${name}"`)
    created.push(name)
    const url = new URL(config.databaseUrl)
    url.pathname = `/${name}`
    const output = execFileSync(process.execPath, [tsx, 'src/release.ts'], {
      cwd: server, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: 'test', NODE_ENV: 'test', ADMIN_PASSWORD: '', DELEGATED_LOGIN_TEST_MODE: '', FEATHERBASE_APP_PATHS: '[]' },
    })
    expect(output).toContain('preflight: btree_gist available for the baseline\n')
    expect(output).toContain('preflight: pending migrations: 0001_baseline.sql, ')
    expect(output).toContain('applied 0001_baseline.sql\n')
  }, 90_000)

  test('on an installed database the check is not repeated', async () => {
    expect(await preflightRelease({ environment: 'test' })).not.toContain('btree_gist available for the baseline')
  })

  test('before the first installation the preflight reports the baseline and its extension prerequisite', async () => {
    // The sandbox rolls this schema removal back; the normal release's
    // subprocess proof above verifies the actual subsequent installation.
    await sql`drop schema featherbase cascade`
    await sql`drop schema public cascade`
    const lines = await preflightRelease({ environment: 'test' })
    expect(lines).toContain('btree_gist available for the baseline')
    expect(lines).toContainEqual(expect.stringMatching(/^pending migrations: 0001_baseline.sql,/))
  })

  test('a server that does not ship the extension, or a role that may not create it, is refused with the fix', async () => {
    const { assertBtreeGist } = await import('../src/release-preflight')
    expect(() => assertBtreeGist({ installed: true, available: false, can_create: false })).not.toThrow()
    expect(() => assertBtreeGist({ installed: false, available: true, can_create: true })).not.toThrow()
    expect(() => assertBtreeGist({ installed: false, available: false, can_create: true })).toThrow(/does not ship\. Install the contrib package first/)
    expect(() => assertBtreeGist({ installed: false, available: true, can_create: false })).toThrow(/may not create extensions.*create extension btree_gist;/)
  })
})

describe('the refusal for a publication that would make updates fail', () => {
  test('each publication is named once with its fix, quoting names that need it', async () => {
    const { publicationRefusal } = await import('../src/release-preflight')
    const text = publicationRefusal([
      { pubname: 'warehouse_cdc', schemaname: 'featherbase', tablename: 'has_role', has_column_list: false },
      { pubname: 'weird "name"', schemaname: 'featherbase', tablename: 'has_role', has_column_list: true },
      { pubname: 'warehouse_cdc', schemaname: 'featherbase', tablename: 'person', has_column_list: false },
    ])
    expect(text).toContain('publication "warehouse_cdc" covers featherbase.has_role; publication "weird "name"" covers featherbase.has_role with a column list; publication "warehouse_cdc" covers featherbase.person: ')
    const fixes = text.split('Fix it first:\n')[1].split('\n')
    expect(fixes).toEqual([
      '  ALTER PUBLICATION "warehouse_cdc" SET (publish_generated_columns = stored);',
      '  publication "weird "name"" lists columns for featherbase.has_role: drop the column list (ALTER PUBLICATION "weird ""name""" SET TABLE … without one), or include every stored generated column;',
    ])
  })
})
