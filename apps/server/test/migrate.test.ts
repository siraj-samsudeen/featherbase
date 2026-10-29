// The migrator run in this process through `main(argv, io)` (ADR 0012).
//
// A database is either empty (a fresh install) or one the migrator has
// migrated (it has the ledger); a database with no ledger that is not empty
// is refused. Each case needs a database of its own; the migrator's
// connection is fixed when `src/db` is first loaded, so each loads a fresh
// copy of the module graph pointed at a disposable database, then drops it.
// The rest run on the shared test database inside a rolled-back sandbox.
import { readdirSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { _getUnqualifiedSql, sql, withTransaction } from '../src/db'
import { applyMigrationFile, pendingMigrations } from '../src/migrate'
import { runMain } from './command-io'
import { test } from './pg-test'
import { dropScratchDatabases, scratchDatabase, scratchInstalled } from './scratch-database'

afterAll(dropScratchDatabases, 60_000)

type Scratch = Awaited<ReturnType<typeof scratchDatabase>>

/** Every migration file on disk, in the order they apply. */
function allMigrations(): string[] {
  return readdirSync(new URL('../migrations', import.meta.url)).filter((f) => f.endsWith('.sql') || f.endsWith('.ts')).sort()
}

const ledger = async (s: Scratch) => (await s.db`select name from featherbase.migration order by name collate "C"`).map((r) => String(r.name))

// First: a .ts migration's module, once loaded against a scratch database
// below, keeps that database's (closed) connection.
describe('migrate: one file', () => {
  test('a pending file reported, applied and recorded', async () => {
    await sql`delete from migration where name = '0003_mock_google_sign_in.ts'`
    await sql`update sign_in_method set enabled = false where row_id = 'google'`
    expect(await pendingMigrations()).toEqual(['0003_mock_google_sign_in.ts'])
    await withTransaction(() => applyMigrationFile('0003_mock_google_sign_in.ts'))
    expect(await pendingMigrations()).toEqual([])
    expect(await sql`select enabled from sign_in_method where row_id = 'google'`).toEqual([{ enabled: true }])
  })

  test('the unqualified client the .sql files run on exists only inside a transaction', async () => {
    expect(() => _getUnqualifiedSql()).toThrow('_getUnqualifiedSql needs a transaction (withTransaction)')
    // Unqualified: `migration` resolves by search_path, not to featherbase.migration.
    await expect(withTransaction(async () => {
      await _getUnqualifiedSql().unsafe('set local search_path = pg_catalog')
      await _getUnqualifiedSql().unsafe('select 1 from migration')
    })).rejects.toThrow('relation "migration" does not exist')
  })
})

describe('migrate: a new database', () => {
  it('runs the baseline and the files after it, stamps the database, and a second run applies nothing', async () => {
    const scratch = await scratchDatabase()
    try {
      const first = await runMain(scratch.migrate.main, [])
      expect(first).toMatchObject({ code: 0, stderr: '' })
      expect(first.stdout).toBe(`${allMigrations().map((f) => `applied ${f}\n`).join('')}migrations up to date (${allMigrations().length} total)\n`)
      expect(await ledger(scratch)).toEqual(allMigrations())
      expect(await scratch.db`select value from featherbase.internal_metadata where key = 'environment'`).toEqual([{ value: 'test' }])
      // The steps after the baseline ran: a test run's Administrator gets the
      // default password, and the suite's mock Google provider is enabled.
      expect(await scratch.db`select password_hash is not null as set from featherbase.person where row_id = 'Administrator'`).toEqual([{ set: true }])
      expect(await scratch.db`select enabled from featherbase.sign_in_method where row_id = 'google'`).toEqual([{ enabled: true }])
      expect(await scratch.migrate.pendingMigrations()).toEqual([])
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stdout: `migrations up to date (${allMigrations().length} total)\n` })
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('a database with no ledger that already holds a table is refused, before changing anything', async () => {
    const scratch = await scratchDatabase('create table public.someone_elses (id int primary key)')
    try {
      const relations = () => scratch.db`select relname from pg_class where relnamespace = 'public'::regnamespace order by 1`
      const before = await relations()
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Refusing to migrate: this database is not empty and has no Featherbase ledger (it holds table public.someone_elses); use a new database.')
      expect(await scratch.db`select to_regnamespace('featherbase') as r`).toEqual([{ r: null }])
      expect(await relations()).toEqual(before)
      await expect(scratch.migrate.pendingMigrations()).rejects.toThrow('use a new database')
    } finally {
      await scratch.close()
    }
  }, 60_000)

  it('an empty ledger beside platform tables is refused the same way', async () => {
    const scratch = await scratchDatabase(`create schema featherbase; create table featherbase.person (row_id text primary key);
      create table featherbase.migration (name text primary key, applied_at timestamptz not null default now())`)
    try {
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('this database is not empty and has no Featherbase ledger (it holds table featherbase.person)')
      expect(await ledger(scratch)).toEqual([])
      expect(await scratch.db`select to_regclass('featherbase.internal_metadata') as r`).toEqual([{ r: null }])
    } finally {
      await scratch.close()
    }
  }, 60_000)

})

// Empty means no object in any user schema: not only tables, and not only in
// featherbase and public. Each refusal leaves no ledger and no platform schema.
describe('migrate: what counts as not empty', () => {
  const refused = async (setup: string, holds: string, featherbaseExisted = false) => {
    const scratch = await scratchDatabase(setup)
    try {
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain(`this database is not empty and has no Featherbase ledger (it holds ${holds}); use a new database.`)
      expect(await scratch.db`select to_regclass('featherbase.migration') as m, to_regclass('featherbase.internal_metadata') as s`).toEqual([{ m: null, s: null }])
      expect(await scratch.db`select to_regnamespace('featherbase') is not null as present`).toEqual([{ present: featherbaseExisted }])
    } finally {
      await scratch.close()
    }
  }

  it('a table in a schema of its own, with public empty', () =>
    refused('create schema business; create table business.orders (id int primary key)', 'schema business'), 60_000)

  it('an enum in public', () =>
    refused("create type public.order_state as enum ('open', 'closed')", 'type public.order_state'), 60_000)

  it('a function in featherbase, which the baseline would collide with', () =>
    refused('create schema featherbase; create function featherbase.fc_cancel_email_invites() returns int language sql as $$ select 1 $$',
      'function featherbase.fc_cancel_email_invites', true), 60_000)

  it('a database holding only an extension still counts as empty, and installs', async () => {
    const scratch = await scratchDatabase('create extension btree_gist')
    try {
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
      expect(await ledger(scratch)).toEqual(allMigrations())
    } finally {
      await scratch.close()
    }
  }, 120_000)
})

describe('migrate: an installed database', () => {
  it('gets only the migrations its ledger does not record', async () => {
    const scratch = await scratchInstalled()
    try {
      await scratch.db`delete from featherbase.migration where name = '0003_mock_google_sign_in.ts'`
      expect(await scratch.migrate.pendingMigrations()).toEqual(['0003_mock_google_sign_in.ts'])
      const r = await runMain(scratch.migrate.main, [])
      expect(r).toMatchObject({ code: 0, stderr: '' })
      expect(r.stdout).toBe(`applied 0003_mock_google_sign_in.ts\nmigrations up to date (${allMigrations().length} total)\n`)
      expect(await ledger(scratch)).toEqual(allMigrations())
    } finally {
      await scratch.close()
    }
  }, 120_000)
})
