// #651: app upgrades evolve their schema. The fixture app `evolve` ships three
// versions that together exercise every operation: 0.2.0 adds Tables (one a
// Sub-table), adds link, Sub-table and required Choice columns, renames a
// column and two Tables, and changes types; 0.3.0 drops a column and a Table
// and narrows choices (destructive), makes a column required with a backfill
// and changes another type.
import { describe, expect, vi } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { loadInstalledApps } from '../src/apps'
import { sql, withTransaction } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { preflightRelease } from '../src/release-preflight'
import { rehearse } from '../src/migrate-rehearse'

type Client = { post: <T = unknown>(path: string, body: unknown) => Promise<T> }
const fixture = (v: number) => resolve('../..', `runtime-apps/fixtures/evolve-v${v}`)
const versions = [fixture(1), fixture(2), fixture(3)]

async function upgrade(admin: Client, version: string) {
  const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'evolve', version })
  await admin.post('/api/upgrade_app', { name: 'evolve', version, planId: plan.planId })
  await admin.post('/api/activate_app_upgrade', { name: 'evolve', version })
  return plan
}

// 0.1.0 installed, every version shipped (an uninstalled app is offered at
// its newest version, so 0.1.0 is discovered alone first).
async function install(admin: Client) {
  await discoverPackages([fixture(1)])
  await admin.post('/api/install_app', { name: 'evolve' })
  await discoverPackages(versions)
  await loadInstalledApps()
}

// Rows written through the API while 0.1.0 is installed.
async function seed(admin: Client) {
  const save = (table: string, row: Record<string, unknown>) => admin.post('/api/save_row', { table, row })
  await save('evolve.item', { row_id: 'i1', title: 'Pallet jack', qty: 3, grade: 'C', legacy_code: 'LEG-0001', on_hold: true })
  await save('evolve.item', { row_id: 'i2', qty: 7, grade: 'A', legacy_code: 'LEG-0002', on_hold: false })
  await save('evolve.note', { row_id: 'n1', body: 'Count again on Monday' })
  await save('evolve.note', { row_id: 'n2', body: 'Shelf 4 is damaged' })
  await save('evolve.zone', { row_id: 'z1', zone_name: 'North' })
  await save('Comment', { ref_table: 'evolve.note', ref_name: 'n1', content: 'Confirmed by the night shift' })
}

// Everything that makes up the app's schema: definitions, stored columns
// (by name: Postgres cannot reorder stored columns, so their order is not
// part of the schema), indexes, constraints, read policies and grants.
async function schema() {
  return {
    tables: await sql`select to_jsonb(t) - 'created_at' - 'updated_at' as definition from table_def t where name like 'evolve.%' order by name`,
    columns: await sql`select to_jsonb(c) - 'row_id' - 'created_at' - 'updated_at' as definition
      from column_def c where parent like 'evolve.%' order by parent, position`,
    stored: await sql`select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
      from information_schema.columns where table_schema = 'evolve' order by table_name, column_name`,
    indexes: await sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'evolve' order by indexname`,
    constraints: await sql`select conrelid::regclass::text as relation, conname, pg_get_constraintdef(oid) as definition
      from pg_constraint where connamespace = 'evolve'::regnamespace order by conname`,
    policies: await sql`select tablename, policyname, qual from pg_policies where schemaname = 'evolve' order by tablename`,
    grants: await sql`select ref_table, role, tier, can_read, can_write, can_create, owner_app from permission
      where owner_app = 'evolve' order by ref_table, role`,
    registered: (await sql`select tables from installed_app where name = 'evolve'`).map(r => [...(r.tables as string[])].sort()),
  }
}

describe('app schema evolution', () => {
  test('every version of the fixture app replays its history', async () => {
    expect(await discoverPackages(versions)).toEqual([])
  })

  test('installing 0.3.0 directly and upgrading 0.1.0 to 0.2.0 to 0.3.0 give an identical schema', async ({ admin }) => {
    let fresh: Awaited<ReturnType<typeof schema>> | undefined
    const rollback = new Error('fresh install measured')
    await expect(withTransaction(async () => {
      await discoverPackages([fixture(3)])
      await admin.post('/api/install_app', { name: 'evolve' })
      fresh = await schema()
      throw rollback
    })).rejects.toBe(rollback)
    invalidateMeta()
    await install(admin)
    await upgrade(admin, '0.2.0')
    await upgrade(admin, '0.3.0')
    expect(await schema()).toEqual(fresh)
  })

  test('rows survive renames and type changes', async ({ admin }) => {
    await install(admin)
    await seed(admin)
    await upgrade(admin, '0.2.0')
    expect(await sql`select row_id, title, quantity, on_hold, grade, priority from evolve.item order by row_id`).toEqual([
      { row_id: 'i1', title: 'Pallet jack', quantity: 3, on_hold: '1', grade: 'C', priority: 'Low' },
      { row_id: 'i2', title: null, quantity: 7, on_hold: '0', grade: 'A', priority: 'Low' },
    ])
    expect(await sql`select row_id, body from evolve.memo order by row_id`).toEqual([
      { row_id: 'n1', body: 'Count again on Monday' }, { row_id: 'n2', body: 'Shelf 4 is damaged' },
    ])
    expect(await sql`select zone_name from evolve.region`).toEqual([{ zone_name: 'North' }])
  })

  test('history and grants follow a renamed Table', async ({ admin }) => {
    await install(admin)
    await seed(admin)
    await upgrade(admin, '0.2.0')
    expect(await sql`select ref_table from comment where ref_name = 'n1' and content = 'Confirmed by the night shift'`).toEqual([{ ref_table: 'evolve.memo' }])
    expect(await sql`select ref_table, can_read from permission where owner_app = 'evolve' and ref_table like 'evolve.%' order by ref_table`).toEqual([
      { ref_table: 'evolve.item', can_read: true }, { ref_table: 'evolve.memo', can_read: true }, { ref_table: 'evolve.supplier', can_read: true },
    ])
  })

  test('a new Table arrives with the grant its version declares, shown in the preview', async ({ admin }) => {
    await install(admin)
    const plan = await admin.post<{ permissions: unknown[] }>('/api/preview_app_upgrade', { name: 'evolve', version: '0.2.0' })
    expect(plan.permissions).toEqual([{ grant: { table: 'evolve.supplier', role: 'Evolve Clerk', can_read: true } }])
  })

  test('a renamed Table keeps its scope mark and the security guard', async ({ admin, createUser }) => {
    await install(admin)
    await upgrade(admin, '0.2.0')
    await sql`insert into permission (row_id, ref_table, role, can_read, can_write, can_create) values ('p651', 'evolve.region', 'Evolve Clerk', true, true, true)`
    const clerk = await createUser({ email: 'evolve-clerk@example.com', roles: ['Evolve Clerk'] })
    const response = await clerk.fetch('/api/save_row', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Featherbase-App-Version': 'evolve@0.2.0',
    }, body: JSON.stringify({ table: 'evolve.region', row: { row_id: 'z2', zone_name: 'South' } }) })
    expect(response.status).toBe(403)
    expect(await sql`select decides_scope from table_def where name = 'evolve.region'`).toEqual([{ decides_scope: true }])
  })

  test('destructive steps report what they would remove before anything runs', async ({ admin }) => {
    await install(admin)
    await seed(admin)
    await upgrade(admin, '0.2.0')
    const plan = await admin.post<{ destructive: boolean; losses: string[] }>('/api/preview_app_upgrade', { name: 'evolve', version: '0.3.0' })
    expect(plan).toMatchObject({ destructive: true, losses: [
      'prune #1 dropColumn evolve.item.legacy_code: 2 values',
      'prune #2 dropTable evolve.memo: 2 rows',
      'prune #3 alterColumn evolve.item.grade: 1 value',
    ] })
    expect(await sql`select count(legacy_code)::int as n from evolve.item`).toEqual([{ n: 2 }])
  })

  test('the destructive upgrade removes what the preview reported, and no more', async ({ admin }) => {
    await install(admin)
    await seed(admin)
    await upgrade(admin, '0.2.0')
    await upgrade(admin, '0.3.0')
    expect(await sql`select row_id, title, grade, quantity from evolve.item order by row_id`).toEqual([
      { row_id: 'i1', title: 'Pallet jack', grade: null, quantity: 3 },
      { row_id: 'i2', title: 'Untitled', grade: 'A', quantity: 7 },
    ])
    expect(await sql`select column_name from information_schema.columns where table_schema = 'evolve' and column_name = 'legacy_code'`).toEqual([])
    expect(await sql`select to_regclass('evolve.memo') as relation`).toEqual([{ relation: null }])
    expect(await sql`select ref_table from permission where owner_app = 'evolve' order by ref_table`).toEqual([{ ref_table: 'evolve.item' }, { ref_table: 'evolve.supplier' }])
  })

  test('on a database without rows every destructive step reports nothing to lose', async ({ admin }) => {
    await install(admin)
    await upgrade(admin, '0.2.0')
    const plan = await admin.post<{ losses: string[] }>('/api/preview_app_upgrade', { name: 'evolve', version: '0.3.0' })
    expect(plan.losses).toEqual([
      'prune #1 dropColumn evolve.item.legacy_code: 0 values',
      'prune #2 dropTable evolve.memo: 0 rows',
      'prune #3 alterColumn evolve.item.grade: 0 values',
    ])
  })
})

describe('refusals', () => {
  async function variant(version: number, edit: (manifest: Record<string, any>) => void) {
    const directory = await mkdtemp(resolve('test/.evolve-'))
    await cp(fixture(version), directory, { recursive: true })
    const manifest = JSON.parse(await readFile(resolve(directory, 'featherbase.json'), 'utf8'))
    edit(manifest)
    await writeFile(resolve(directory, 'featherbase.json'), JSON.stringify(manifest))
    return directory
  }

  test('a narrowing that rows still use, not marked destructive, is refused before anything runs', async ({ admin }) => {
    const narrowed = await variant(2, (m) => {
      const grade = m.migrations[0].operations.find((op: { column?: string }) => op.column === 'grade')
      grade.to.choices = 'A\nB'
      m.tables.find((t: { name: string }) => t.name === 'evolve.item').columns.find((c: { column_name: string }) => c.column_name === 'grade').choices = 'A\nB'
    })
    try {
      await install(admin)
      await seed(admin)
      await discoverPackages([fixture(1), narrowed])
      await expect(admin.post('/api/preview_app_upgrade', { name: 'evolve', version: '0.2.0' }))
        .rejects.toMatchObject({ status: 417, message: expect.stringContaining('outside its new choices; mark the operation destructive: true') })
    } finally { await rm(narrowed, { recursive: true, force: true }) }
  })

  test('a wider grant on a Table the app already had is still refused', async ({ admin }) => {
    const wider = await variant(2, (m) => { m.permissions[1].can_write = true })
    try {
      await install(admin)
      await discoverPackages([fixture(1), wider])
      await expect(admin.post('/api/preview_app_upgrade', { name: 'evolve', version: '0.2.0' })).rejects.toMatchObject({ status: 417 })
    } finally { await rm(wider, { recursive: true, force: true }) }
  })

  test('a step that fails rolls back every step before it', async ({ admin }) => {
    const unfilled = await variant(3, (m) => { delete m.migrations[1].operations[3].backfill })
    try {
      await install(admin)
      await seed(admin)
      await upgrade(admin, '0.2.0')
      await discoverPackages([fixture(2), unfilled])
      await loadInstalledApps()
      const plan = await admin.post<{ planId: string }>('/api/preview_app_upgrade', { name: 'evolve', version: '0.3.0' })
      await expect(admin.post('/api/upgrade_app', { name: 'evolve', version: '0.3.0', planId: plan.planId }))
        .rejects.toMatchObject({ status: 417, message: expect.stringContaining('1 row holds no value') })
      expect(await sql`select count(legacy_code)::int as n from evolve.item`).toEqual([{ n: 2 }])
      expect(await sql`select count(*)::int as n from evolve.memo`).toEqual([{ n: 2 }])
      expect(await sql`select package_version from installed_app where name = 'evolve'`).toEqual([{ package_version: '0.2.0' }])
    } finally { await rm(unfilled, { recursive: true, force: true }) }
  })

  test('a destructive step without destructive: true keeps the version from loading', async () => {
    const unmarked = await variant(3, (m) => { delete m.migrations[1].operations[0].destructive })
    try {
      const failures = await discoverPackages([unmarked])
      expect(failures).toEqual([{ path: unmarked, error: expect.stringContaining('mark the operation destructive: true') }])
    } finally { await rm(unmarked, { recursive: true, force: true }) }
  })
})

describe('the release guard and the rehearsal report losses per instance', () => {
  test('the release guard counts what the shipped upgrade would remove, never the values', async ({ admin }) => {
    await install(admin)
    await seed(admin)
    await upgrade(admin, '0.2.0')
    vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([fixture(2), fixture(3)]))
    try {
      const lines = await preflightRelease({ environment: 'test' })
      expect(lines).toContain('WARNING: upgrading app evolve from 0.2.0 to 0.3.0 removes data here: prune #1 dropColumn evolve.item.legacy_code: 2 values; prune #2 dropTable evolve.memo: 2 rows; prune #3 alterColumn evolve.item.grade: 1 value')
      expect(lines.join('\n')).not.toContain('LEG-0001')
    } finally { vi.unstubAllEnvs() }
  })

  test('the rehearsal runs the shipped upgrade, reports what it removed, then rolls it back', async ({ admin }) => {
    await install(admin)
    await seed(admin)
    await upgrade(admin, '0.2.0')
    vi.stubEnv('FEATHERBASE_APP_PATHS', JSON.stringify([fixture(2), fixture(3)]))
    const lines: string[] = []
    try {
      await rehearse((line) => lines.push(line))
    } finally { vi.unstubAllEnvs() }
    expect(lines).toContain('app evolve 0.2.0 to 0.3.0: rehearsed; it removes prune #1 dropColumn evolve.item.legacy_code: 2 values; prune #2 dropTable evolve.memo: 2 rows; prune #3 alterColumn evolve.item.grade: 1 value')
    expect(lines.join('\n')).not.toContain('Shelf 4')
    expect(await sql`select count(legacy_code)::int as n from evolve.item`).toEqual([{ n: 2 }])
    expect(await sql`select package_version from installed_app where name = 'evolve'`).toEqual([{ package_version: '0.2.0' }])
  })
})
