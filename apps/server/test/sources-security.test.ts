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
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
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
  // A relation whose PRIMARY KEY is credential-named (finding 7).
  await cli.unsafe(`create table sec_fixture.keyring (api_key text primary key, note text)`)
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
  await cli.unsafe(`truncate sec_fixture.keyring`)
  await cli.unsafe(`insert into sec_fixture.keyring values ('sk-live-1', 'prod')`)
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

describe('re-review findings', () => {
  test('finding 2: an update cannot move a row OUT of the caller\'s Data Scope', async ({
    admin,
    createUser,
  }) => {
    await bindAccount(admin)
    // A Reference column the Data Scope restricts: region → Sec Region.
    await admin.post('/api/doctype', {
      name: 'Sec Region',
      id_pattern: 'prompt',
      columns: [{ column_name: 'label', column_type: 'Data' }],
    })
    for (const r of ['north', 'south'])
      await admin.post('/api/save_doc', { doctype: 'Sec Region', doc: { name: r } })
    // Re-point the bound Table's region column at it.
    const meta = (await admin.get(`/api/table/${encodeURIComponent(BOUND)}:meta`)) as {
      columns: { column_name: string; column_type: string; source_column: string | null }[]
    }
    await sql`
      update column_def set column_type = 'Reference', reference_table = 'Sec Region'
      where parent = ${BOUND} and column_name = 'region'`
    invalidateMeta()

    const user = await userWith(admin, createUser, {
      can_read: true,
      can_write: true,
    })
    await admin.post('/api/save_doc', {
      doctype: 'Data Scope',
      doc: { user: user.user, allow_table: 'Sec Region', for_value: 'north' },
    })
    expect(meta.columns.some((c) => c.column_name === 'region')).toBe(true)

    const loaded = (await user.get(`/api/table/${encodeURIComponent(BOUND)}/ACC-A`)) as Record<
      string,
      unknown
    >
    expect(loaded.region).toBe('north')
    // Moving it to a region outside the caller's scope must be refused.
    await expect(
      patchDoc(user, `/api/table/${encodeURIComponent(BOUND)}/ACC-A`, {
        region: 'south',
        updated_at: loaded.updated_at,
      }),
    ).rejects.toMatchObject({ status: 403 })
    const [row] = await cli`select region from sec_fixture.account where id = 'ACC-A'`
    expect(row.region).toBe('north')
  })

  test('finding 3: a restricted-tier column cannot be selected, filtered or grouped', async ({
    admin,
    createUser,
  }) => {
    await bindAccount(admin)
    await sql`
      update column_def set tier = 'restricted'
      where parent = ${BOUND} and column_name = 'region'`
    invalidateMeta()
    const user = await userWith(admin, createUser, { can_read: true, tier: 'basic' })
    const enc = encodeURIComponent(BOUND)

    await expect(
      user.get(`/api/table/${enc}?fields=${encodeURIComponent('["name","region"]')}`),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      user.get(`/api/table/${enc}?filters=${encodeURIComponent('[["region","=","north"]]')}`),
    ).rejects.toMatchObject({ status: 417 })
    await expect(user.get(`/api/table/${enc}?order_by=region asc`)).rejects.toMatchObject({
      status: 417,
    })
    // The detail read agrees: the value is absent, not merely unselectable.
    const doc = (await user.get(`/api/table/${enc}/ACC-A`)) as Record<string, unknown>
    expect('region' in doc).toBe(false)
    // An admin still sees it.
    const adminDoc = (await admin.get(`/api/table/${enc}/ACC-A`)) as Record<string, unknown>
    expect(adminDoc.region).toBe('north')
  })

  test('finding 7: a credential-named PRIMARY KEY makes the table unbindable', async ({
    admin,
  }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      name: 'sec-fixture',
      engine: 'postgres',
      url_env: EXT_URL_ENV,
      default_schema: 'sec_fixture',
      access: 'read_only',
    })
    const res = (await admin.get(
      '/api/table/Data%20Source/sec-fixture:introspect?schema=sec_fixture',
    )) as { tables: { table: string; bindable: boolean; reason?: string }[] }
    const keyring = res.tables.find((t) => t.table === 'keyring')!
    expect(keyring.bindable).toBe(false)
    expect(keyring.reason).toMatch(/credential column name/)
    const attempt = await admin.post<{ created: unknown[]; skipped: { reason: string }[] }>(
      '/api/table/Data%20Source/sec-fixture:reflect',
      { schema: 'sec_fixture', tables: ['keyring'], prefix: 'Leak' },
    )
    expect(attempt.created).toEqual([])
  })

  test('finding 9: Data Source administration is System Manager-only', async ({
    admin,
    createUser,
  }) => {
    const role = 'Sec Src Role'
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: role } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: {
        ref_table: 'Data Source',
        role,
        can_read: true,
        can_write: true,
        can_create: true,
        can_delete: true,
      },
    })
    const user = await createUser({ roles: [role] })
    await expect(
      user.post('/api/table/Data%20Source', {
        name: 'rogue-source',
        engine: 'postgres',
        url_env: EXT_URL_ENV,
        access: 'read_write',
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('round 3: a credential-named external_modified cannot map updated_at', async ({
    admin,
  }) => {
    await bindAccount(admin)
    // Creation-time: the hand-written binding is refused outright.
    await expect(
      admin.post('/api/doctype', {
        name: 'Sec Modleak',
        data_source: 'sec-fixture',
        external_schema: 'sec_fixture',
        external_table: 'account',
        external_pk: 'id',
        external_modified: 'api_key',
        columns: [{ column_name: 'label', column_type: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 417 })
    // Runtime backstop: a binding edited behind the API refuses to query
    // rather than serializing the secret as every row's updated_at.
    await sql`update table_def set external_modified = 'api_key' where name = ${BOUND}`
    invalidateMeta()
    const enc = encodeURIComponent(BOUND)
    await expect(admin.get(`/api/table/${enc}/ACC-A`)).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.get(`/api/table/${enc}?fields=${encodeURIComponent('["name","label"]')}`),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('round 3: bulk import refuses bound Tables — real run and dry run agree', async ({
    admin,
  }) => {
    await bindAccount(admin)
    const res = await admin.fetch(`/api/table/${encodeURIComponent(BOUND)}:import`, {
      method: 'POST',
      body: JSON.stringify({ rows: [{ label: 'smuggled' }] }),
    })
    expect(res.status).toBe(417)
    const dry = await admin.fetch(`/api/table/${encodeURIComponent(BOUND)}:import`, {
      method: 'POST',
      body: JSON.stringify({ dry_run: true, rows: [{ label: 'smuggled' }] }),
    })
    expect(dry.status).toBe(417)
    // Nothing landed on the source.
    const [{ n }] = await cli`select count(*)::int as n from sec_fixture.account`
    expect(Number(n)).toBe(2)
  })

  test('finding 10: a hand-written binding is validated against the source', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      name: 'sec-fixture',
      engine: 'postgres',
      url_env: EXT_URL_ENV,
      default_schema: 'sec_fixture',
      access: 'read_only',
    })
    // A column that does not exist on the relation.
    await expect(
      admin.post('/api/doctype', {
        name: 'Sec Handwritten',
        data_source: 'sec-fixture',
        external_schema: 'sec_fixture',
        external_table: 'account',
        external_pk: 'id',
        columns: [{ column_name: 'nonexistent', column_type: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 417 })
    // A relation that does not exist at all.
    await expect(
      admin.post('/api/doctype', {
        name: 'Sec Ghost',
        data_source: 'sec-fixture',
        external_schema: 'sec_fixture',
        external_table: 'no_such_table',
        external_pk: 'id',
        columns: [{ column_name: 'label', column_type: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 417 })
    // An unknown data source.
    await expect(
      admin.post('/api/doctype', {
        name: 'Sec Nosource',
        data_source: 'does-not-exist',
        external_table: 'account',
        external_pk: 'id',
        columns: [{ column_name: 'label', column_type: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('round 3: global search survives bound Tables', () => {
  test('search does not 500 when a bound Table exists, and skips its rows', async ({ admin }) => {
    await bindAccount(admin)
    // Before the fix this threw 42P01 (no physical table) and the whole
    // typeahead died the moment any Table was reflected.
    const res = (await admin.get('/api/search?q=Alpha')) as {
      results: { doctype: string }[]
    }
    expect(Array.isArray(res.results)).toBe(true)
    expect(res.results.every((r) => r.doctype !== BOUND)).toBe(true)
  })
})

describe('main-merge interactions: related filters and :aggregate vs bound Tables', () => {
  test('a related filter targeting a bound Table is rejected cleanly, not a 500', async ({
    admin,
  }) => {
    await bindAccount(admin)
    // A native table whose Reference points at the bound one.
    await admin.post('/api/doctype', {
      name: 'Sec Native Ref',
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'account', column_type: 'Reference', reference_table: BOUND },
      ],
    })
    const related = encodeURIComponent(
      JSON.stringify([['account', 'related', { table: BOUND, filters: [['label', '=', 'Alpha']] }]]),
    )
    await expect(
      admin.get(`/api/table/Sec%20Native%20Ref?filters=${related}`),
    ).rejects.toMatchObject({ status: 417 })
  })

  test(':aggregate counts bound rows and rejects sums instead of 500ing', async ({ admin }) => {
    await bindAccount(admin)
    const enc = encodeURIComponent(BOUND)
    const agg = (await admin.get(`/api/table/${enc}:aggregate`)) as {
      count: number
      sum: string | null
    }
    expect(agg.count).toBe(2)
    expect(agg.sum).toBeNull()
    await expect(admin.get(`/api/table/${enc}:aggregate?sum=label`)).rejects.toMatchObject({
      status: 417,
    })
  })
})
