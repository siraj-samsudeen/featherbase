// The migrator run in this process through `main(argv, io)` (ADR 0012).
//
// Most cases need a database of their own: a fresh one, or one with a ledger
// shaped as no migrated database is. The migrator's connection is fixed when
// `src/db` is first loaded, so each of those cases loads a fresh copy of the
// module graph pointed at its own disposable database, then drops it. The
// rest run on the shared test database inside a rolled-back sandbox.
import { readdirSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { _getUnqualifiedSql, sql, withTransaction } from '../src/db'
import { applyMigrationFile, pendingMigrations } from '../src/migrate'
import { runMain } from './command-io'
import { test } from './pg-test'
import { dropScratchDatabases, scratchDatabase } from './scratch-database'

afterAll(dropScratchDatabases, 60_000)

/** Every migration file name, in the order they apply. Read from disk, not
 *  from the shared test database's ledger, which can also name a retired file
 *  (0124_script_api_featherbase.sql, replaced in #556). */
async function allMigrations(): Promise<string[]> {
  return readdirSync(new URL('../migrations', import.meta.url)).filter((f) => f.endsWith('.sql') || f.endsWith('.ts')).sort()
}

describe('migrate: a database of its own', () => {
  it('migrates a fresh database to the current schema, stamps it, and a second run applies nothing', async () => {
    const scratch = await scratchDatabase()
    try {
      const first = await runMain(scratch.migrate.main, [])
      expect(first).toMatchObject({ code: 0, stderr: '' })
      const ledger = (await scratch.db`select name from featherbase.migration`).map((r) => String(r.name)).sort()
      expect(ledger).toEqual(await allMigrations())
      expect(await scratch.db`select value from featherbase.internal_metadata where key = 'environment'`).toEqual([{ value: 'test' }])
      expect(await scratch.migrate.pendingMigrations()).toEqual([])
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
      expect(await scratch.db`select count(*)::int as n from featherbase.migration`).toEqual([{ n: ledger.length }])
    } finally {
      await scratch.close()
    }
  }, 240_000)

  it('refuses a database with both a public and a featherbase ledger, before changing anything', async () => {
    const scratch = await scratchDatabase(`create table public.migration (name text primary key);
      create schema featherbase; create table featherbase.migration (name text primary key)`)
    try {
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Refusing to run: both public and featherbase migration ledgers exist')
      await expect(scratch.migrate.pendingMigrations()).rejects.toThrow('Refusing to run: both public and featherbase migration ledgers exist')
      expect(await scratch.db`select count(*)::int as n from featherbase.migration`).toEqual([{ n: 0 }])
    } finally {
      await scratch.close()
    }
  }, 60_000)

  it('refuses a legacy database that has not reached 0087, naming what it lacks', async () => {
    const scratch = await scratchDatabase(`create table public.migration (name text primary key, applied_at timestamptz not null default now());
      insert into public.migration (name) values ('0001_init.sql')`)
    try {
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Legacy database requires an intermediate historical upgrade through 0087; missing migrations:\n0002_')
      expect(r.stderr).not.toContain('0001_init.sql\n')
      expect(await scratch.db`select to_regclass('featherbase.migration') as m`).toEqual([{ m: null }])
    } finally {
      await scratch.close()
    }
  }, 60_000)

  it('applies a missing pre-0094 file to a legacy database in public storage, and records it in the legacy ledger', async () => {
    const recorded = (await allMigrations()).filter((f) => f !== '0089_app_enablement.sql')
    const scratch = await scratchDatabase(`create table public.migration (name text primary key, applied_at timestamptz not null default now());
      create table public.installed_app (name text primary key)`)
    try {
      await scratch.db`insert into public.migration ${scratch.db(recorded.map((name) => ({ name })))}`
      expect(await scratch.migrate.pendingMigrations()).toEqual(['0089_app_enablement.sql'])
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
      expect(await scratch.db`select 1 from public.migration where name = '0089_app_enablement.sql'`).toHaveLength(1)
      expect((await scratch.db`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'installed_app' order by column_name`).map((r) => r.column_name))
        .toEqual(['enabled', 'name', 'runtime_package'])
    } finally {
      await scratch.close()
    }
  }, 60_000)
})

// running-an-instance "The person-record changes stand or fall together":
// 0100, 0101, 0101a and 0102 apply as one transaction. A database stopped at
// 0099 (later files recorded so they stay out of the way) gets a stray
// `person_identifier` that only 0102 trips over — the last member fails, and
// none of the four may be left applied. With the obstacle gone, the next run
// applies the four once.
describe('migrate: the person-record changes', () => {
  const GROUP = ['0100_person_identities.ts', '0101_person_rename.ts', '0101a_service_account_name_unique.sql', '0102_person_resolution.ts']

  it('one failing person change leaves none of them applied, and the next run applies them once', async () => {
    const later = (await allMigrations()).filter((f) => f >= '0100')
    expect(later).toEqual(expect.arrayContaining(GROUP))
    const scratch = await scratchDatabase(`create schema featherbase;
      create table featherbase.migration (name text primary key, applied_at timestamptz not null default now())`)
    try {
      await scratch.db`insert into featherbase.migration ${scratch.db(later.map((name) => ({ name })))}`
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
      await scratch.db`delete from featherbase.migration where name in ${scratch.db(GROUP)}`
      await scratch.db`insert into featherbase."user" (row_id, email, full_name, enabled, created_at, updated_at)
        values ('staff-0701', 'staff.0701@store.example', 'Staff 0701', true, now(), now())`
      await scratch.db.unsafe('create table featherbase.person_identifier (stray int)')

      const failed = await runMain(scratch.migrate.main, [])
      expect(failed.code).toBe(1)
      // The failure is 0102's — the last member — adding person_identifier's
      // foreign key to person (nothing earlier in the group touches that table).
      expect(failed.stderr).toContain('column "person_id" referenced in foreign key constraint does not exist')
      const relation = async (name: string) => (await scratch.db`select to_regclass(${name})::text as r`)[0].r
      // 0100's identities, 0101's rename and re-id, 0101a's index: none remains.
      expect(await relation('featherbase.user_identity')).toBeNull()
      expect(await relation('featherbase.sign_in_identity')).toBeNull()
      expect(await relation('featherbase.sign_in_method')).toBeNull()
      expect(await relation('featherbase.person')).toBeNull()
      expect(await relation('featherbase.service_account_label_lower_uq')).toBeNull()
      expect(await relation('featherbase.identifier_system')).toBeNull()
      expect(await scratch.db`select row_id from featherbase."user" where email = 'staff.0701@store.example'`).toEqual([{ row_id: 'staff-0701' }])
      expect(await scratch.db`select name from featherbase.migration where name in ${scratch.db(GROUP)}`).toEqual([])

      await scratch.db.unsafe('drop table featherbase.person_identifier')
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0 })
      expect((await scratch.db`select name from featherbase.migration where name in ${scratch.db(GROUP)} order by name collate "C"`).map((r) => r.name)).toEqual(GROUP)
      expect(await relation('featherbase.person')).toBe('featherbase.person')
      expect(await scratch.db`select row_id from featherbase.person where email = 'staff.0701@store.example'`).toEqual([{ row_id: expect.stringMatching(/^psn_/) }])
    } finally {
      await scratch.close()
    }
  }, 240_000)
})

describe('migrate: one file', () => {
  test('a migration that leaves two platform ledgers behind is refused', async () => {
    await sql`delete from migration where name = '0123_instance_health.sql'`
    await sql.unsafe('create table public.migration (name text primary key)')
    await expect(sql.begin(() => applyMigrationFile('0123_instance_health.sql')))
      .rejects.toThrow('Migration must leave exactly one platform migration ledger')
  })

  test('a pending file reported, applied and recorded', async () => {
    await sql`delete from migration where name = '0123_instance_health.sql'`
    expect(await pendingMigrations()).toEqual(['0123_instance_health.sql'])
    await sql.begin(() => applyMigrationFile('0123_instance_health.sql'))
    expect(await pendingMigrations()).toEqual([])
  })

  test('the unqualified client the legacy files run on exists only inside a transaction', async () => {
    expect(() => _getUnqualifiedSql()).toThrow('_getUnqualifiedSql needs a transaction (withTransaction)')
    // Unqualified: `migration` resolves by search_path, not to featherbase.migration.
    await expect(withTransaction(async () => {
      await _getUnqualifiedSql().unsafe('set local search_path = pg_catalog')
      await _getUnqualifiedSql().unsafe('select 1 from migration')
    })).rejects.toThrow('relation "migration" does not exist')
  })
})
