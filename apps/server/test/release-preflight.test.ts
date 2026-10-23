// The person release cannot half-apply (review A-M1, #399): the refusals that
// do not need the data run before the first migration, and 0100, 0101, 0101a
// and 0102 run as one transaction.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { config } from '../src/config'
import { migrationBatches } from '../src/migrate'
import { preflightRelease } from '../src/release-preflight'

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
  test('test mode on a production server refuses', async () => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    vi.stubEnv('DISABLE_DATABASE_ENVIRONMENT_CHECK', '1')
    await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/DELEGATED_LOGIN_TEST_MODE is set on a "production" server/)
  })

  test('test mode against a database labelled production refuses, even for a staging process', async () => {
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
