// The migrator run in this process through `main(argv, io)` (ADR 0012).
//
// A database is new, installed before the baseline (its ledger holds every
// migration the baseline replaced), or neither (#692). Each case needs a
// database of its own; the migrator's connection is fixed when `src/db` is
// first loaded, so each loads a fresh copy of the module graph pointed at a
// disposable database, then drops it. The rest run on the shared test
// database inside a rolled-back sandbox.
import { readdirSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { _getUnqualifiedSql, sql, withTransaction } from '../src/db'
import { ADOPTED_WITH_BASELINE, BASELINE, applyMigrationFile, pendingMigrations, replacedByBaseline } from '../src/migrate'
import { runMain } from './command-io'
import { test } from './pg-test'
import { schemaShape } from './schema-shape'
import { dropScratchDatabases, scratchDatabase, scratchInstalledBeforeBaseline as installedBeforeBaseline } from './scratch-database'

afterAll(dropScratchDatabases, 60_000)

type Scratch = Awaited<ReturnType<typeof scratchDatabase>>

/** Every migration file on disk, in the order they apply. */
function allMigrations(): string[] {
  return readdirSync(new URL('../migrations', import.meta.url)).filter((f) => f.endsWith('.sql') || f.endsWith('.ts')).sort()
}

const ledger = async (s: Scratch) => (await s.db`select name from featherbase.migration order by name collate "C"`).map((r) => String(r.name))

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
      expect(await scratch.db`select to_regclass('featherbase.patch_log') as r`).toEqual([{ r: null }])
      expect(await scratch.migrate.pendingMigrations()).toEqual([])
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stdout: `migrations up to date (${allMigrations().length} total)\n` })
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('a database whose ledger is empty but which holds platform tables is refused, before changing anything', async () => {
    const scratch = await scratchDatabase(`create schema featherbase; create table featherbase.person (row_id text primary key);
      create table featherbase.migration (name text primary key, applied_at timestamptz not null default now())`)
    try {
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Refusing to migrate: this database holds platform tables (person) but records no migration.')
      expect(await ledger(scratch)).toEqual([])
      expect(await scratch.db`select to_regclass('featherbase.internal_metadata') as r`).toEqual([{ r: null }])
    } finally {
      await scratch.close()
    }
  }, 60_000)

  it('a pre-0094 platform restored without its ledger is refused, before changing anything', async () => {
    const scratch = await scratchDatabase('create table public.table_def (name text primary key)')
    try {
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Refusing to migrate: this database holds platform tables (public.table_def) but records no migration.')
      expect(await scratch.db`select to_regnamespace('featherbase') as r`).toEqual([{ r: null }])
    } finally {
      await scratch.close()
    }
  }, 60_000)
})

describe('migrate: a database installed before the baseline', () => {
  it('gets the retired patch\'s index if the patch runner never ran there', async () => {
    const scratch = await installedBeforeBaseline()
    try {
      await scratch.db`drop index featherbase.file_ref_idx`
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0 })
      expect(await scratch.db`select to_regclass('featherbase.file_ref_idx') is not null as present`).toEqual([{ present: true }])
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('is adopted: the baseline is recorded without running, and only patch_log goes', async () => {
    const scratch = await installedBeforeBaseline()
    try {
      // An instance with its own Administrator password and Google choice keeps both.
      await scratch.db`update featherbase.person set password_hash = null where row_id = 'Administrator'`
      await scratch.db`update featherbase.sign_in_method set enabled = false where row_id = 'google'`
      const before = await schemaShape(scratch.db)
      expect(await scratch.migrate.pendingMigrations()).toEqual(allMigrations().filter((f) => !ADOPTED_WITH_BASELINE.includes(f)))

      const r = await runMain(scratch.migrate.main, [])
      expect(r).toMatchObject({ code: 0, stderr: '' })
      expect(r.stdout).toContain(`adopted the baseline: recorded ${ADOPTED_WITH_BASELINE.join(', ')} without running them`)
      expect(r.stdout).toContain('applied 0143_drop_patch_log.sql\n')
      expect(r.stdout).not.toContain(`applied ${BASELINE}`)

      expect(await schemaShape(scratch.db)).toEqual(before.filter((line) => !line.includes('patch_log')))
      expect(before.some((line) => line.includes('patch_log'))).toBe(true)
      expect(await ledger(scratch)).toEqual([...replacedByBaseline(), ...allMigrations()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      expect(await scratch.db`select password_hash from featherbase.person where row_id = 'Administrator'`).toEqual([{ password_hash: null }])
      expect(await scratch.db`select enabled from featherbase.sign_in_method where row_id = 'google'`).toEqual([{ enabled: false }])
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stdout: `migrations up to date (${allMigrations().length} total)\n` })
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('one that lacks a replaced migration is refused before anything is written, naming the release that can upgrade it', async () => {
    const scratch = await installedBeforeBaseline()
    try {
      await scratch.db`delete from featherbase.migration where name = '0139_import_conflicts.ts'`
      await scratch.db`update featherbase.internal_metadata set updated_at = '2026-01-01'`
      const before = { ledger: await ledger(scratch), shape: await schemaShape(scratch.db) }
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain(`Refusing to migrate: this database has ${replacedByBaseline().length - 1} of the ${replacedByBaseline().length} migrations the baseline replaces; it lacks 0139_import_conflicts.ts.`)
      expect(r.stderr).toContain('Upgrade this database first with the last platform release before the baseline (commit e562331d)')
      expect(await ledger(scratch)).toEqual(before.ledger)
      expect(await schemaShape(scratch.db)).toEqual(before.shape)
      expect(await scratch.db`select updated_at::date::text as d from featherbase.internal_metadata`).toEqual([{ d: '2026-01-01' }])
      await expect(scratch.migrate.pendingMigrations()).rejects.toThrow('it lacks 0139_import_conflicts.ts')
    } finally {
      await scratch.close()
    }
  }, 120_000)

  it('one that still records its migrations in public is refused before anything is written', async () => {
    const scratch = await scratchDatabase(`create table public.migration (name text primary key, applied_at timestamptz not null default now());
      insert into public.migration (name) values ('0001_init.sql')`)
    try {
      const r = await runMain(scratch.migrate.main, [])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('Refusing to migrate: this database records its migrations in public.migration')
      expect(r.stderr).toContain('(commit e562331d)')
      expect(await scratch.db`select to_regnamespace('featherbase') as s`).toEqual([{ s: null }])
    } finally {
      await scratch.close()
    }
  }, 60_000)
})

describe('migrate: one file', () => {
  test('a pending file reported, applied and recorded', async () => {
    await sql`delete from migration where name = '0143_drop_patch_log.sql'`
    await sql.unsafe('create table featherbase.patch_log (patch text primary key)')
    expect(await pendingMigrations()).toEqual(['0143_drop_patch_log.sql'])
    await withTransaction(() => applyMigrationFile('0143_drop_patch_log.sql'))
    expect(await pendingMigrations()).toEqual([])
    expect(await sql`select to_regclass('featherbase.patch_log') as r`).toEqual([{ r: null }])
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
