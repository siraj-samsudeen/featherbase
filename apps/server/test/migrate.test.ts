// The migrator run in this process through `main(argv, io)` (ADR 0012).
//
// A database is either empty (a fresh install) or one the migrator has
// migrated (it has the ledger); a database with no ledger that is not empty
// is refused. Each case needs a database of its own; the migrator's
// connection is fixed when `src/db` is first loaded, so each loads a fresh
// copy of the module graph pointed at a disposable database, then drops it.
// The rest run on the shared test database inside a rolled-back sandbox.
import { readdirSync } from 'node:fs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { _getUnqualifiedSql, sql, withTransaction } from '../src/db'
import { applyMigrationFile, pendingMigrations } from '../src/migrate'
import { runMain } from './command-io'
import { test } from './pg-test'
import { dropScratchDatabases, scratchDatabase, scratchInstalled } from './scratch-database'
import { expectStatus } from './fixtures'

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
  it('a process that never booted the server reads the app library from the checkout', async () => {
    const scratch = await scratchInstalled()
    try {
      const { appLibraryPaths } = await import('../src/app-library')
      expect(await appLibraryPaths(['/configured/app'])).toEqual(['/configured/app'])
    } finally {
      await scratch.close()
    }
  })

  it('a release onto an empty database skips the Administrator password check', async () => {
    const scratch = await scratchDatabase()
    try {
      vi.stubEnv('ADMIN_PASSWORD', 'first-admin-password')
      vi.stubEnv('FEATHERBASE_APP_PATHS', '[]')
      const { preflightRelease } = await import('../src/release-preflight')
      const lines = await preflightRelease({ environment: 'test' })
      expect(lines).toContain('Administrator password check skipped (no Person table yet)')
    } finally {
      vi.unstubAllEnvs()
      await scratch.close()
    }
  })

  it('legacy creator grants retain their dependent Column reach after migration', async () => {
    const scratch = await scratchDatabase()
    try {
      const db = await import('../src/db')
      await scratch.migrate.ensureLedger()
      for (const file of allMigrations().filter((file) => file < '0150'))
        await db.withTransaction(() => scratch.migrate.applyMigrationFile(file))
      const { createTable, tableRelation } = await import('../src/table-engine')
      await createTable({ name: 'Legacy Contact Note', kind: 'sub_table', columns: [
        { column_name: 'note', column_type: 'Data' },
        { column_name: 'private_note', column_type: 'Data', tier: 'restricted' },
      ] })
      await createTable({ name: 'Legacy Contact', columns: [
        { column_name: 'name', column_type: 'Data' },
        { column_name: 'phone', column_type: 'Data', tier: 'restricted' },
        { column_name: 'notes', column_type: 'Sub-table', row_table: 'Legacy Contact Note' },
      ] })
      await db.sql`insert into role (row_id) values ('Legacy Reader'), ('Legacy Detail')`
      await db.sql`insert into person (row_id, full_name, enabled) values ('psn_legacy', 'Legacy Person', true)`
      await db.sql`insert into has_role (row_id, parent, parenttype, parentfield, role)
        values ('legacy-held-1', 'psn_legacy', 'Person', 'roles', 'Legacy Reader'),
          ('legacy-held-2', 'psn_legacy', 'Person', 'roles', 'Legacy Detail')`
      await db.sql`insert into permission (row_id, ref_table, role, tier, own_rows_only, can_read, can_create)
        values ('legacy-base', 'Legacy Contact', 'Legacy Reader', 'basic', true, true, true)`
      await db.sql`insert into permission (row_id, ref_table, role, tier, can_read, can_write)
        values ('legacy-detail', 'Legacy Contact', 'Legacy Detail', 'restricted', true, true)`
      // A restricted grant on the line items alone, reached through the parent.
      await db.sql`insert into role (row_id) values ('Legacy Note Detail')`
      await db.sql`insert into person (row_id, full_name, enabled) values ('psn_lines', 'Lines Person', true)`
      await db.sql`insert into has_role (row_id, parent, parenttype, parentfield, role)
        values ('legacy-held-3', 'psn_lines', 'Person', 'roles', 'Legacy Reader'),
          ('legacy-held-4', 'psn_lines', 'Person', 'roles', 'Legacy Note Detail')`
      await db.sql`insert into permission (row_id, ref_table, role, tier, can_read)
        values ('legacy-note-detail', 'Legacy Contact Note', 'Legacy Note Detail', 'restricted', true)`
      // A restricted create flag on line items alone reached nothing, and must not after.
      await db.sql`insert into role (row_id) values ('Legacy Note Creator')`
      await db.sql`insert into person (row_id, full_name, enabled) values ('psn_note_creator', 'Note Creator', true)`
      await db.sql`insert into has_role (row_id, parent, parenttype, parentfield, role)
        values ('legacy-held-5', 'psn_note_creator', 'Person', 'roles', 'Legacy Reader'),
          ('legacy-held-6', 'psn_note_creator', 'Person', 'roles', 'Legacy Note Creator')`
      await db.sql`insert into permission (row_id, ref_table, role, tier, can_create)
        values ('legacy-note-create', 'Legacy Contact Note', 'Legacy Note Creator', 'restricted', true)`
      // A row whose level was cleared granted nothing, and must not start to.
      await db.sql`insert into role (row_id) values ('Legacy No Level')`
      await db.sql`insert into permission (row_id, ref_table, role, tier, can_read) values ('legacy-no-level', 'Legacy Contact', 'Legacy No Level', null, true)`
      const relation = await tableRelation('Legacy Contact')
      await db.sql`insert into ${db.sql(relation)} (row_id, created_by, name, phone)
        values ('mine', 'psn_legacy', 'Mine', 'my-phone'), ('other', 'Administrator', 'Other', 'hidden-phone')`
      await db.sql`insert into ${db.sql(relation)} (row_id, created_by, name, phone)
        values ('lines-own', 'psn_lines', 'Lines', 'lines-phone')`
      await db.sql`insert into ${db.sql(await tableRelation('Legacy Contact Note'))}
        (row_id, parent, parenttype, parentfield, note, private_note)
        values ('legacy-note', 'mine', 'Legacy Contact', 'notes', 'visible', 'inherited'),
          ('lines-note', 'lines-own', 'Legacy Contact', 'notes', 'shown', 'line-detail')`
      // Preflight reads the flag form before the migration runs.
      await db.sql`insert into permission (row_id, ref_table, role, tier, can_read) values ('legacy-open', 'Person', 'All', 'basic', true)`
      const { preflightRelease } = await import('../src/release-preflight')
      await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/grants role "All" on "Person" \(read\)/)
      await db.sql`delete from permission where row_id = 'legacy-open'`
      // A row with nothing ticked would lose its restriction in the conversion.
      await db.sql`insert into permission (row_id, ref_table, role, tier, own_rows_only) values ('legacy-dormant', 'Legacy Contact', 'Legacy Reader', 'basic', true)`
      await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/legacy-dormant.*grants nothing but carries a creator restriction/)
      await db.sql`delete from permission where row_id = 'legacy-dormant'`
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
      await db.sql`insert into permission (row_id, ref_table, role, operation, scope_mode, column_rule) values ('now-open', 'Person', 'All', 'read', 'all', 'basic')`
      await expect(preflightRelease({ environment: 'test' })).rejects.toThrow(/grants role "All" on "Person" \(read\)/)
      await db.sql`delete from permission where row_id = 'now-open'`
      const { app } = await import('../src/index')
      const { issueSession } = await import('../src/auth')
      const { token } = await issueSession('psn_legacy')
      const headers = { Authorization: `Bearer ${token}` }
      const list = await app.request('/api/table/Legacy%20Contact?fields=%5B%22name%22,%22phone%22%5D', { headers })
      await expectStatus(list, 200)
      expect(await list.json()).toMatchObject({ total: 1, data: [{ name: 'Mine', phone: 'my-phone' }] })
      await expectStatus(await app.request('/api/table/Legacy%20Contact/other', { headers }), 403)
      const own = await (await app.request('/api/table/Legacy%20Contact/mine', { headers })).json() as { updated_at: string }
      expect(own).toMatchObject({ notes: [{ note: 'visible', private_note: 'inherited' }] })
      const update = await app.request('/api/save_row', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'Legacy Contact', row: { row_id: 'mine', updated_at: own.updated_at, phone: 'not-an-update-grant' } }) })
      await expectStatus(update, 403)
      const create = await app.request('/api/save_row', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: 'Legacy Contact', row: { name: 'New', phone: 'legacy-create-reach',
          notes: [{ note: 'new', private_note: 'inherited-create' }] } }) })
      await expectStatus(create, 201)
      expect(await create.json()).toMatchObject({ phone: 'legacy-create-reach', notes: [{ private_note: 'inherited-create' }] })
      const lines = { Authorization: `Bearer ${(await issueSession('psn_lines')).token}` }
      const linesRow = await (await app.request('/api/table/Legacy%20Contact/lines-own', { headers: lines })).json()
      expect(linesRow).toMatchObject({ name: 'Lines', notes: [{ note: 'shown', private_note: 'line-detail' }] })
      expect(linesRow).not.toHaveProperty('phone')
      expect(await db.sql`select 1 from permission where role = 'Legacy Note Creator'`).toEqual([])
      expect(await db.sql`select 1 from permission where role = 'Legacy No Level'`).toEqual([])
      const creator = { Authorization: `Bearer ${(await issueSession('psn_note_creator')).token}`, 'Content-Type': 'application/json' }
      const refused = await app.request('/api/save_row', { method: 'POST', headers: creator,
        body: JSON.stringify({ table: 'Legacy Contact', row: { name: 'Mine too', notes: [{ private_note: 'never' }] } }) })
      await expectStatus(refused, 403)
    } finally {
      await scratch.close()
    }
  }, 120_000)

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

  // Only the system's pg_toast*/pg_temp* schemas are skipped: a name that merely
  // looks like one (an underscore is a LIKE wildcard) still counts.
  it('a table in a schema whose name only resembles a system one', () =>
    refused('create schema pgxtemp_business; create table pgxtemp_business.orders (id int primary key)', 'schema pgxtemp_business'), 60_000)

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

  // #693: a database installed from 0001–0004 has no hosted_domain column;
  // 0005 adds it and keeps the links it already holds.
  it('installed before 0005: 0005 adds sign_in_identity.hosted_domain and keeps its rows', async () => {
    const scratch = await scratchInstalled()
    try {
      await scratch.db`alter table featherbase.sign_in_identity drop column hosted_domain`
      await scratch.db`delete from featherbase.migration where name = '0005_sign_in_identity_hosted_domain.sql'`
      await scratch.db`insert into featherbase.sign_in_identity (id, person_id, method, subject, email, linked_by)
        values ('uid_before_0005', 'Administrator', 'google', 'g-before-0005', 'admin@example.com', 'self')`
      expect(await scratch.migrate.pendingMigrations()).toEqual(['0005_sign_in_identity_hosted_domain.sql'])
      expect(await runMain(scratch.migrate.main, [])).toMatchObject({ code: 0, stderr: '' })
      expect(await scratch.db`select id, subject, email, linked_by, hosted_domain from featherbase.sign_in_identity where id = 'uid_before_0005'`).toEqual([
        { id: 'uid_before_0005', subject: 'g-before-0005', email: 'admin@example.com', linked_by: 'self', hosted_domain: null },
      ])
      expect(await ledger(scratch)).toEqual(allMigrations())
    } finally {
      await scratch.close()
    }
  }, 120_000)
})
