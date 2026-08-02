// PR #103 review regressions, findings 1 + 2 + 3 + 4: authorization parity
// and secret hygiene on the bound-source path, real optimistic locking, and
// schema-ambiguous reflection.
//
// The foreign schema lives outside the sandbox transaction (a CLI owns it);
// everything control-side rolls back per test.
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { test, patchDoc } from './pg-test'
import { config } from '../src/config'
import { invalidateSources } from '../src/sources/registry'

const EXT_URL_ENV = 'SEC_FIXTURE_URL'
process.env[EXT_URL_ENV] = config.databaseUrl

let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(config.databaseUrl, { max: 2 })
  await cli.unsafe(`drop schema if exists sec_fixture cascade`)
  await cli.unsafe(`drop schema if exists sec_archive cascade`)
  await cli.unsafe(`create schema sec_fixture`)
  await cli.unsafe(`create schema sec_archive`)
  // A foreign table with BOTH a credential-named column and a modified column.
  await cli.unsafe(`
    create table sec_fixture.account (
      id text primary key,
      label text,
      region text,
      api_key text,
      updated_at timestamptz not null default now()
    )`)
  // Same-named table in a second schema (finding 4).
  await cli.unsafe(`create table sec_archive.account (id text primary key, label text)`)
})

beforeEach(async () => {
  await cli.unsafe(`truncate sec_fixture.account`)
  await cli.unsafe(`
    insert into sec_fixture.account (id, label, region, api_key) values
      ('ACC-A', 'Alpha', 'north', 'sk-alpha-secret'),
      ('ACC-B', 'Beta',  'south', 'sk-beta-secret')`)
  await cli.unsafe(`truncate sec_archive.account`)
  await cli.unsafe(`insert into sec_archive.account (id, label) values ('OLD-1', 'Archived')`)
})

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists sec_fixture cascade`)
  await cli.unsafe(`drop schema if exists sec_archive cascade`)
  await cli.end({ timeout: 2 })
})

const BOUND = 'Sec Account'

// Registers the source and reflects sec_fixture.account as `Sec Account`.
async function bindAccount(admin: TestClient, access = 'read_write'): Promise<void> {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    name: 'sec-fixture',
    engine: 'postgres',
    url_env: EXT_URL_ENV,
    default_schema: 'sec_fixture',
    access,
  })
  const res = await admin.post<{ created: { name: string }[]; skipped: { reason: string }[] }>(
    '/api/table/Data%20Source/sec-fixture:reflect',
    { schema: 'sec_fixture', tables: ['account'], prefix: 'Sec' },
  )
  expect(res.skipped).toEqual([])
  expect(res.created[0].name).toBe(BOUND)
}

// A role granted the given Permission flags, plus a user holding it.
async function userWith(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
  perm: Record<string, unknown>,
): Promise<TestClient> {
  const role = 'Sec Role'
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: role } })
  await admin.post('/api/save_doc', {
    doctype: 'Permission',
    doc: { ref_table: BOUND, role, ...perm },
  })
  return createUser({ roles: [role] })
}

describe('finding 1: bound tables honor own-rows and Data Scope rules', () => {
  test('an own-rows read grant is rejected, not silently treated as all-rows', async ({
    admin,
    createUser,
  }) => {
    await bindAccount(admin)
    const user = await userWith(admin, createUser, { can_read: true, own_rows_only: true })
    await expect(user.get(`/api/table/${encodeURIComponent(BOUND)}`)).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      user.get(`/api/table/${encodeURIComponent(BOUND)}/ACC-A`),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      user.get(`/api/table/${encodeURIComponent(BOUND)}:count`),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('an own-rows WRITE grant cannot mutate an arbitrary external pk', async ({
    admin,
    createUser,
  }) => {
    await bindAccount(admin)
    const user = await userWith(admin, createUser, {
      can_read: true,
      can_write: true,
      can_delete: true,
      own_rows_only: true,
    })
    const loaded = (await admin.get(`/api/table/${encodeURIComponent(BOUND)}/ACC-A`)) as Record<
      string,
      unknown
    >
    await expect(
      patchDoc(user, `/api/table/${encodeURIComponent(BOUND)}/ACC-A`, {
        label: 'hijacked',
        updated_at: loaded.updated_at,
      }),
    ).rejects.toMatchObject({ status: 403 })
    const del = await user.fetch(`/api/table/${encodeURIComponent(BOUND)}/ACC-A`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(403)
    // Untouched on the source.
    const [row] = await cli`select label from sec_fixture.account where id = 'ACC-A'`
    expect(row.label).toBe('Alpha')
  })

  test('Data Scopes narrow bound lists, counts and detail reads', async ({ admin, createUser }) => {
    await bindAccount(admin)
    const user = await userWith(admin, createUser, { can_read: true })
    // Restrict the user to ACC-A of the bound Table itself.
    await admin.post('/api/save_doc', {
      doctype: 'Data Scope',
      doc: { user: user.user, allow_table: BOUND, for_value: 'ACC-A' },
    })
    const list = (await user.get(
      `/api/table/${encodeURIComponent(BOUND)}?fields=${encodeURIComponent('["name","label"]')}`,
    )) as { data: { name: string }[]; total: number }
    expect(list.total).toBe(1)
    expect(list.data[0].name).toBe('ACC-A')

    const count = (await user.get(`/api/table/${encodeURIComponent(BOUND)}:count`)) as {
      count: number
    }
    expect(count.count).toBe(1)

    // The excluded row is not fetchable directly either.
    await expect(
      user.get(`/api/table/${encodeURIComponent(BOUND)}/ACC-B`),
    ).rejects.toMatchObject({ status: 403 })
    // The permitted one still is.
    const ok = (await user.get(`/api/table/${encodeURIComponent(BOUND)}/ACC-A`)) as Record<
      string,
      unknown
    >
    expect(ok.label).toBe('Alpha')
  })
})

describe('finding 2: credential-named source columns never surface', () => {
  test('api_key is not reflected, not listable, not readable, not filterable', async ({
    admin,
  }) => {
    await bindAccount(admin)
    const meta = (await admin.get(`/api/table/${encodeURIComponent(BOUND)}:meta`)) as {
      columns: { column_name: string }[]
    }
    expect(meta.columns.map((c) => c.column_name)).not.toContain('api_key')

    const list = (await admin.get(
      `/api/table/${encodeURIComponent(BOUND)}?fields=${encodeURIComponent('["name","label"]')}`,
    )) as { data: Record<string, unknown>[] }
    expect(JSON.stringify(list)).not.toContain('sk-alpha-secret')

    const doc = (await admin.get(`/api/table/${encodeURIComponent(BOUND)}/ACC-A`)) as Record<
      string,
      unknown
    >
    expect(doc.api_key).toBeUndefined()
    expect(JSON.stringify(doc)).not.toContain('sk-alpha-secret')

    // Selecting, filtering or sorting by it is rejected, never queried.
    await expect(
      admin.get(`/api/table/${encodeURIComponent(BOUND)}?fields=${encodeURIComponent('["api_key"]')}`),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.get(
        `/api/table/${encodeURIComponent(BOUND)}?filters=${encodeURIComponent('[["api_key","like","sk-%"]]')}`,
      ),
    ).rejects.toMatchObject({ status: 417 })
  })
})

describe('finding 3: optimistic locking advances the revision', () => {
  test('two Desk clients: the second stale save conflicts', async ({ admin }) => {
    await bindAccount(admin)
    const path = `/api/table/${encodeURIComponent(BOUND)}/ACC-A`
    // Both editors load the same revision.
    const a = (await admin.get(path)) as Record<string, unknown>
    const b = (await admin.get(path)) as Record<string, unknown>
    expect(a.updated_at).toEqual(b.updated_at)

    const savedA = await patchDoc<Record<string, unknown>>(admin, path, {
      label: 'A wins',
      updated_at: a.updated_at,
    })
    // The revision must have moved on — otherwise B's stale save matches.
    expect(savedA.updated_at).not.toEqual(a.updated_at)

    await expect(
      patchDoc(admin, path, { label: 'B overwrites', updated_at: b.updated_at }),
    ).rejects.toMatchObject({ status: 409 })

    const [row] = await cli`select label from sec_fixture.account where id = 'ACC-A'`
    expect(row.label).toBe('A wins')
  })

  test('a stale delete conflicts instead of removing a changed row', async ({ admin }) => {
    await bindAccount(admin)
    const path = `/api/table/${encodeURIComponent(BOUND)}/ACC-B`
    const loaded = (await admin.get(path)) as Record<string, unknown>
    await cli`update sec_fixture.account set label = 'moved on', updated_at = now() where id = 'ACC-B'`
    const res = await admin.fetch(
      `${path}?updated_at=${encodeURIComponent(String(loaded.updated_at))}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(409)
    const rows = await cli`select 1 from sec_fixture.account where id = 'ACC-B'`
    expect(rows).toHaveLength(1)
  })
})

describe('finding 4: same-named tables in two schemas', () => {
  test('a bare name is refused as ambiguous; qualified names bind the right relation', async ({
    admin,
  }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      name: 'sec-fixture',
      engine: 'postgres',
      url_env: EXT_URL_ENV,
      access: 'read_only',
    })
    // No schema filter → both sec_fixture.account and sec_archive.account.
    const ambiguous = await admin.post<{ created: unknown[]; skipped: { reason: string }[] }>(
      '/api/table/Data%20Source/sec-fixture:reflect',
      { tables: ['account'], prefix: 'Amb' },
    )
    expect(ambiguous.created).toEqual([])
    expect(ambiguous.skipped[0].reason).toMatch(/Ambiguous/)

    const qualified = await admin.post<{ created: { name: string }[] }>(
      '/api/table/Data%20Source/sec-fixture:reflect',
      { tables: ['sec_archive.account'], prefix: 'Arch' },
    )
    expect(qualified.created).toHaveLength(1)
    const name = qualified.created[0].name
    const meta = (await admin.get(`/api/table/${encodeURIComponent(name)}:meta`)) as Record<
      string,
      unknown
    >
    expect(meta.external_schema).toBe('sec_archive')
    const list = (await admin.get(
      `/api/table/${encodeURIComponent(name)}?fields=${encodeURIComponent('["name"]')}`,
    )) as { data: { name: string }[]; total: number }
    expect(list.total).toBe(1)
    expect(list.data[0].name).toBe('OLD-1')
  })

  test('a same-named PK constraint on another table does not corrupt pk detection', async ({
    admin,
  }) => {
    // Both schemas' tables were created with implicit names, so add an
    // explicit collision: same constraint NAME, different tables.
    await cli.unsafe(`create table sec_fixture.dup_a (k text constraint shared_pk_name primary key)`)
    await cli.unsafe(`create table sec_archive.dup_b (k text constraint shared_pk_name primary key)`)
    try {
      invalidateSources()
      await admin.post('/api/table/Data%20Source', {
        name: 'sec-fixture',
        engine: 'postgres',
        url_env: EXT_URL_ENV,
        access: 'read_only',
      })
      const res = (await admin.get(
        '/api/table/Data%20Source/sec-fixture:introspect?schema=sec_fixture',
      )) as { tables: { table: string; pk: string | null; bindable: boolean }[] }
      const dup = res.tables.find((t) => t.table === 'dup_a')!
      // A single-column PK must still read as single-column.
      expect(dup.pk).toBe('k')
    } finally {
      await cli.unsafe(`drop table if exists sec_fixture.dup_a`)
      await cli.unsafe(`drop table if exists sec_archive.dup_b`)
    }
  })
})
