// #332: the list's bulk edit and bulk delete. On a platform Table the change is
// all-or-nothing — one transaction, so a row that fails leaves every selected
// row as it was, and the refusal names that row and why. A connected Table's
// store can't join that transaction, so there every row is tried and the
// answer names the rows that failed.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { createUserWithRole, expectApiError } from './fixtures'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { invalidateSources } from '../src/sources/registry'

const T = 'Bulk Order'
const enc = encodeURIComponent
const row = (name: string) => `/api/table/${enc(T)}/${enc(name)}`
const edit = (client: TestClient, rows: string[], values: Record<string, unknown>) =>
  client.post(`/api/table/${enc(T)}:bulk-edit`, { rows, values })
const remove = (client: TestClient, rows: string[]) =>
  client.post(`/api/table/${enc(T)}:bulk-delete`, { rows })

async function seed(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: T,
    id_pattern: 'prompt',
    is_submittable: true,
    columns: [
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nClosed' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
    ],
  })
  for (const id of ['r1', 'r2', 'r3'])
    await admin.post('/api/save_row', { table: T, row: { row_id: id, stage: 'Open', qty: 1 } })
}

const stageOf = async (admin: TestClient, name: string) =>
  ((await admin.get(row(name))) as { stage: string }).stage

describe('bulk edit', () => {
  test('changes the field on every selected row', async ({ admin }) => {
    await seed(admin)
    expect(await edit(admin, ['r1', 'r2', 'r3'], { stage: 'Closed' })).toEqual({ changed: 3 })
    for (const id of ['r1', 'r2', 'r3']) expect(await stageOf(admin, id)).toBe('Closed')
  })

  test('a row that cannot be changed leaves every row as it was, and is named', async ({ admin }) => {
    await seed(admin)
    await admin.post(`${row('r2')}:submit`)
    await expectApiError(edit(admin, ['r1', 'r2', 'r3'], { stage: 'Closed' }), {
      status: 417,
      message: expect.stringMatching(/No rows were changed\. r2: .*submitted/),
    })
    for (const id of ['r1', 'r2', 'r3']) expect(await stageOf(admin, id)).toBe('Open')
  })

  test('a refused value keeps the field and the reason (#540)', async ({ admin }) => {
    await seed(admin)
    await expectApiError(edit(admin, ['r1', 'r2'], { qty: 'many' }), {
      status: 417,
      fields: { qty: expect.any(String) },
    })
  })

  test('a person who may not change the rows changes none of them', async ({ admin, createUser }) => {
    await seed(admin)
    const reader = await createUserWithRole(admin, createUser, { role: 'Bulk Reader', table: T, can_read: true })
    await expectApiError(edit(reader, ['r1', 'r2'], { stage: 'Closed' }), { status: 403 })
    for (const id of ['r1', 'r2']) expect(await stageOf(admin, id)).toBe('Open')
  })

  test('asks for the rows and the values', async ({ admin }) => {
    await seed(admin)
    await expectApiError(edit(admin, [], { stage: 'Closed' }), { status: 417 })
    await expectApiError(edit(admin, ['r1'], {}), { status: 417 })
    for (const key of ['row_id', 'updated_at'])
      await expectApiError(edit(admin, ['r1'], { stage: 'Closed', [key]: 'x' }), { status: 417 })
  })

  test('a row named twice is changed once', async ({ admin }) => {
    await seed(admin)
    expect(await edit(admin, ['r1', 'r1'], { stage: 'Closed' })).toEqual({ changed: 1 })
  })
})

describe('bulk delete', () => {
  test('deletes every selected row', async ({ admin }) => {
    await seed(admin)
    expect(await remove(admin, ['r1', 'r3'])).toEqual({ deleted: 2 })
    const left = (await admin.get(`/api/table/${enc(T)}`)) as { data: { row_id: string }[] }
    expect(left.data.map((r) => r.row_id)).toEqual(['r2'])
  })

  test('a row that cannot be deleted keeps every row, and is named', async ({ admin }) => {
    await seed(admin)
    await admin.post(`${row('r2')}:submit`)
    await expectApiError(remove(admin, ['r1', 'r2', 'r3']), {
      status: 417,
      message: expect.stringContaining(
        'No rows were deleted. r2: Bulk Order r2 is submitted and cannot be deleted (cancel it first)',
      ),
    })
    const left = (await admin.get(`/api/table/${enc(T)}`)) as { data: unknown[] }
    expect(left.data).toHaveLength(3)
  })

  test('caps one request at 500 rows', async ({ admin }) => {
    await seed(admin)
    await expectApiError(remove(admin, Array.from({ length: 501 }, (_, i) => `r${i}`)), { status: 417 })
  })
})

describe('on a connected Table', () => {
  const ENV = 'BULK_FIXTURE_URL'
  process.env[ENV] = EXTERNAL_DATABASE_URL
  const BOUND = 'Bulk Shelf'
  let cli: ReturnType<typeof postgres>
  beforeAll(async () => {
    cli = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
    await cli.unsafe('drop schema if exists bulk_fixture cascade')
    await cli.unsafe('create schema bulk_fixture')
    await cli.unsafe(`create table bulk_fixture.shelf (
      id integer primary key, label text, updated_at timestamptz not null default now())`)
  })
  afterAll(async () => {
    invalidateSources()
    await cli.unsafe('drop schema if exists bulk_fixture cascade')
    await cli.end({ timeout: 2 })
  })

  async function bind(admin: TestClient) {
    await cli.unsafe(`delete from bulk_fixture.shelf; insert into bulk_fixture.shelf (id, label) values (1, 'A1'), (2, 'A2'), (3, 'A3')`)
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'bulk-src', engine: 'postgres', url_env: ENV, default_schema: 'bulk_fixture', access: 'read_write',
    })
    await admin.post('/api/table_def', {
      name: BOUND,
      data_source: 'bulk-src',
      external_schema: 'bulk_fixture',
      external_table: 'shelf',
      external_pk: 'id',
      external_modified: 'updated_at',
      columns: [{ column_name: 'label', column_type: 'Data' }],
    })
  }

  test('every row is tried, and the ones that failed are named', async ({ admin }) => {
    await bind(admin)
    const result = await admin.post(`/api/table/${enc(BOUND)}:bulk-delete`, { rows: ['1', '9', '3'] })
    expect(result).toMatchObject({ deleted: 2, failed: [{ row_id: '9', message: expect.stringContaining('not found') }] })
    expect(await cli`select id from bulk_fixture.shelf order by id`).toEqual([{ id: 2 }])
  })

  test('a bulk edit changes the rows it can, and names the one it could not', async ({ admin }) => {
    await bind(admin)
    expect(await admin.post(`/api/table/${enc(BOUND)}:bulk-edit`, { rows: ['1', '9'], values: { label: 'Z' } }))
      .toMatchObject({ changed: 1, failed: [{ row_id: '9', message: expect.stringContaining('not found') }] })
    expect(await cli`select label from bulk_fixture.shelf order by id`).toEqual([
      { label: 'Z' }, { label: 'A2' }, { label: 'A3' },
    ])
  })

  test('a bulk edit changes the rows in the source', async ({ admin }) => {
    await bind(admin)
    expect(await admin.post(`/api/table/${enc(BOUND)}:bulk-edit`, { rows: ['1', '2'], values: { label: 'Z' } }))
      .toEqual({ changed: 2, failed: [] })
    expect(await cli`select label from bulk_fixture.shelf order by id`).toEqual([
      { label: 'Z' }, { label: 'Z' }, { label: 'A3' },
    ])
  })
})
