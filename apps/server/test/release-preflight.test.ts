// The person release cannot half-apply (review A-M1, #399): the refusals that
// do not need the data run before the first migration, and 0100, 0101, 0101a
// and 0102 run as one transaction.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { config } from '../src/config'
import { migrationBatches } from '../src/migrate'
import { NO_NOTICE_RECIPIENTS_WARNING, preflightRelease } from '../src/release-preflight'
import { makePerson } from './fixtures'

afterEach(() => vi.unstubAllEnvs())

const PASSES = 'no publication blocks updates on a table with stored generated columns'
// publish_generated_columns exists from PostgreSQL 18 (CI also runs 17).
const probe = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const [{ server_version_num }] = await probe`show server_version_num`
await probe.end()
const pg18 = Number(server_version_num) >= 180000

describe('migration batches', () => {
  it('the person migrations share one transaction; every other file stands alone', () => {
    expect(migrationBatches(['0099_delegated_login_settings.ts', '0100_person_identities.ts', '0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts', '0103_later.sql']))
      .toEqual([
        ['0099_delegated_login_settings.ts'],
        ['0100_person_identities.ts', '0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts'],
        ['0103_later.sql'],
      ])
    // A database that already ran 0101 converges with the rest of the group.
    expect(migrationBatches(['0101a_service_account_name_unique.sql', '0102_person_resolution.ts'])).toEqual([
      ['0101a_service_account_name_unique.sql', '0102_person_resolution.ts'],
    ])
  })
})

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
  // not publish (42P10). has_role carries two since 0101 (#399).
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

  // Tonight's case: prod is before 0101, so has_role has no generated columns
  // yet and only the pending-0101 knowledge can catch the publication.
  describe('before 0101', () => {
    async function rewindTo0100() {
      await sql`delete from migration where name = '0101_person_rename.ts'`
      await sql.unsafe(`alter table featherbase.has_role drop column person cascade, drop column service_account cascade`)
      await sql.unsafe(`alter table featherbase.has_role replica identity full`)
    }

    test.skipIf(!pg18)('a publication that does not publish generated columns refuses', async () => {
      await rewindTo0100()
      await sql.unsafe(`create publication fb_test_pre0101_pub for table featherbase.has_role with (publish_generated_columns = none)`)
      await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(
        /publication "fb_test_pre0101_pub" covers featherbase\.has_role[\s\S]*ALTER PUBLICATION "fb_test_pre0101_pub" SET \(publish_generated_columns = stored\)/,
      )
    })

    test.skipIf(!pg18)('a publication that publishes stored generated columns passes', async () => {
      await rewindTo0100()
      await sql.unsafe(`create publication fb_test_pre0101_stored_pub for table featherbase.has_role with (publish_generated_columns = stored)`)
      const lines = await preflightRelease({ environment: 'test' })
      expect(lines).toContain(PASSES)
      expect(lines.find((l) => l.startsWith('pending migrations:'))).toContain('0101_person_rename.ts')
    })
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

// #437: the access configuration a release must never ship with.
describe('release preflight: access configuration', () => {
  const ACCESS_OK = 'no Permission row grants All or Guest on Person or an access-control Table'
  const SIGNUP_OK = 'no sign-in method creates new people for anyone here'
  const DOMAINS_OK = 'no sign-in method creates people from any address or a consumer email domain'

  // These cases run preflight as production; give it the SITE_URL a production
  // server must have (#430), its own JWT_SECRET, and no mock Google provider
  // (which this suite turns on for itself, vitest.config.ts), so they reach the
  // access checks they are about.
  let siteUrlBefore = ''
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'a-production-secret')
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    siteUrlBefore = config.siteUrl
    ;(config as { siteUrl: string }).siteUrl = 'https://featherbase.example.test'
  })
  afterEach(() => {
    ;(config as { siteUrl: string }).siteUrl = siteUrlBefore
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

  // Before 0100 there is no Sign In Method to read, but 0100 copies the
  // legacy allowed_login_domains into a Google method that creates people.
  describe('before 0100', () => {
    async function pending0100(domains: string) {
      vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
      await sql`delete from migration where name = '0100_person_identities.ts'`
      await sql`delete from single_value where table_name = 'System Settings' and field = 'allowed_login_domains'`
      await sql`insert into single_value (table_name, field, value) values ('System Settings', 'allowed_login_domains', ${domains})`
    }

    test('a legacy any-address or consumer domain refuses outside development or test', async () => {
      await pending0100('example.com, *')
      await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/allowed_login_domains holds "\*"/)
      await pending0100('example.com,Gmail.com')
      await expect(preflightRelease({ environment: 'staging' })).rejects.toThrow(/allowed_login_domains holds "gmail.com"/)
    })

    test('company domains pass, and so does test', async () => {
      await pending0100('example.com')
      expect(await preflightRelease({ environment: 'production' })).toContain(DOMAINS_OK)
      await pending0100('*')
      expect(await preflightRelease({ environment: 'test' })).toContain(DOMAINS_OK)
    })
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

// #437 (a) before the schema move: a production-era database keeps its
// platform tables in `public`, and preflight runs before 0094 moves them.
it('a legacy everyone-reads-User grant in public refuses BEFORE migrating', async () => {
  const name = `featherbase_preflight_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database "${name}"`)
  created.push(name)
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
  try {
    await db.unsafe(`create schema featherbase;
      create table featherbase.internal_metadata (key text primary key, value text not null, updated_at timestamptz not null default now());
      insert into featherbase.internal_metadata (key, value) values ('environment', 'test');
      create table public.permission (row_id text primary key, ref_table text, role text, tier text default 'basic', can_read boolean default false, can_write boolean default false);
      insert into public.permission (row_id, ref_table, role, can_read) values ('legacy-grant', 'User', 'All', true)`)
    let output = ''
    let failed = false
    try {
      execFileSync(process.execPath, [tsx, 'src/release.ts'], {
        cwd: server, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DATABASE_URL: url.toString(), FEATHERBASE_ENV: 'test', NODE_ENV: 'test', ADMIN_PASSWORD: '', DELEGATED_LOGIN_TEST_MODE: '' },
      })
    } catch (error) {
      failed = true
      const e = error as { stdout?: string; stderr?: string }
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(failed).toBe(true)
    expect(output).toMatch(/Permission legacy-grant grants role "All" on "User" \(read\)/)
    expect(output).not.toMatch(/applied 0001/)
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
    vi.stubEnv('SITE_URL', 'https://featherbase.example.test')
    vi.stubEnv('JWT_SECRET', 'a-production-secret')
    vi.stubEnv('FILE_STORAGE_DIR', '/data/files')
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
  })

  test('a complete production environment passes and says so', async () => {
    const lines = await preflightRelease({ environment: 'production' })
    expect(lines).toEqual(expect.arrayContaining(['JWT_SECRET set', 'SITE_URL set', 'FILE_STORAGE_DIR set']))
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

  test('before 0100, a legacy google_client_id counts as Google sign-in enabled', async () => {
    await sql`delete from migration where name = '0100_person_identities.ts'`
    await sql.unsafe(`alter table featherbase.sign_in_method rename to sign_in_method_moved_aside`)
    await sql`delete from single_value where table_name = 'System Settings' and field = 'google_client_id'`
    await sql`insert into single_value (table_name, field, value) values ('System Settings', 'google_client_id', 'legacy.apps.googleusercontent.com')`
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/GOOGLE_CLIENT_SECRET is not set/)
  })

  test("a data source's url_env is required while the source exists", async () => {
    await sql`insert into data_source (row_id, engine, url_env) values ('fb_test_warehouse', 'postgres', 'FB_TEST_WAREHOUSE_URL')`
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(
      /FB_TEST_WAREHOUSE_URL is not set on a "production" server \(the url_env of data source fb_test_warehouse\)/)
    // In development it warns: a checkout need not reach every source.
    expect(await preflightRelease({ environment: 'development' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^WARNING: FB_TEST_WAREHOUSE_URL is not set/)]))
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
    SITE_URL: 'https://featherbase.example.com', JWT_SECRET: '', ALLOW_MOCK_OAUTH: '', ADMIN_PASSWORD: '',
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
  }, 180_000)
})
