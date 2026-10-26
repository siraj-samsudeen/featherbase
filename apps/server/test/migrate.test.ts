// The migrator run in this process through `main(argv, io)` (ADR 0012).
//
// Most cases need a database of their own: a fresh one, or one with a ledger
// shaped as no migrated database is. The migrator's connection is fixed when
// `src/db` is first loaded, so each of those cases loads a fresh copy of the
// module graph pointed at its own disposable database, then drops it. The
// rest run on the shared test database inside a rolled-back sandbox.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config'
import { sql } from '../src/db'
import { applyMigrationFile, pendingMigrations } from '../src/migrate'
import { runMain } from './command-io'
import { test } from './pg-test'

const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} })
const created: string[] = []
afterAll(async () => {
  for (const name of created) await admin.unsafe(`drop database if exists "${name}" with (force)`)
  await admin.end()
}, 60_000)

/** A disposable database, a connection to it for the test's own checks, and
 *  the migrate module loaded against it. */
async function scratchDatabase(setup = '') {
  const name = `featherbase_migrate_${randomUUID().replaceAll('-', '')}`
  await admin.unsafe(`create database "${name}"`)
  created.push(name)
  const url = new URL(config.databaseUrl)
  url.pathname = `/${name}`
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
  if (setup) await db.unsafe(setup)
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', url.toString())
  const migrate = await import('../src/migrate')
  const { sql: appSql } = await import('../src/db')
  vi.unstubAllEnvs()
  return {
    db,
    migrate,
    async close() {
      await appSql.end({ timeout: 5 })
      await db.end({ timeout: 5 })
    },
  }
}

/** Every migration file name, from the shared (fully migrated) test database. */
async function allMigrations(): Promise<string[]> {
  return (await sql`select name from migration order by name`).map((r) => String(r.name))
}

describe('migrate: a database of its own', () => {
  it('migrates a fresh database to the current schema, stamps it, and a second run applies nothing', async () => {
    const scratch = await scratchDatabase()
    try {
      const first = await runMain(scratch.migrate.main, [])
      expect(first).toMatchObject({ code: 0, stderr: '' })
      const ledger = (await scratch.db`select name from featherbase.migration order by name`).map((r) => String(r.name))
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

describe('migrate: one file', () => {
  test('a migration that leaves two platform ledgers behind is refused', async () => {
    await sql`delete from migration where name = '0124_script_api_featherbase.sql'`
    await sql.unsafe('create table public.migration (name text primary key)')
    await expect(sql.begin(() => applyMigrationFile('0124_script_api_featherbase.sql')))
      .rejects.toThrow('Migration must leave exactly one platform migration ledger')
  })

  test('a pending file reported, applied and recorded', async () => {
    await sql`delete from migration where name = '0124_script_api_featherbase.sql'`
    expect(await pendingMigrations()).toEqual(['0124_script_api_featherbase.sql'])
    await sql.begin(() => applyMigrationFile('0124_script_api_featherbase.sql'))
    expect(await pendingMigrations()).toEqual([])
  })
})
