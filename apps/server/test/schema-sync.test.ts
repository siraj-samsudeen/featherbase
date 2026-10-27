import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Sync Task'
const TABLE = 'sync_task'

async function columns(): Promise<string[]> {
  const rows = await sql`
    select column_name from information_schema.columns
    where table_schema = 'featherbase' and table_name = ${TABLE}`
  return rows.map((r) => r.column_name as string)
}

const baseColumns = [
  { column_name: 'title', column_type: 'Data', label: 'Title' },
  { column_name: 'points', column_type: 'Int' },
]

// The legacy suite mutated ONE Table across sequential tests; under the
// sandbox each test rebuilds the state it needs, then rolls back.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', { name: DT, columns: baseColumns })
  for (const t of ['a', 'b'])
    await admin.post('/api/save_row', { table: DT, row: { title: t, points: 1 } })
}

async function addSeverity(admin: TestClient) {
  return admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
    method: 'PUT',
    body: JSON.stringify({
      columns: [...baseColumns, { column_name: 'severity', column_type: 'Choice', choices: 'Low\nHigh' }],
    }),
  })
}

describe('META-004: schema sync', () => {
  test('adding a field creates the column; existing data untouched', async ({ admin }) => {
    await setup(admin)
    const res = await addSeverity(admin)
    expect(res.status).toBe(200)
    expect(await columns()).toContain('severity')
    const rows = await sql.unsafe(`select title, points from featherbase.${TABLE} order by title`)
    expect(rows.map((r) => [r.title, Number(r.points)])).toEqual([['a', 1], ['b', 1]])
    // new field usable immediately
    const save = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row: { title: 'c', severity: 'High' } }),
    })
    expect(save.status).toBe(201)
  })

  test('property edits (label, reqd) apply without touching the table', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        columns: [
          { column_name: 'title', column_type: 'Data', label: 'Headline', reqd: true },
          { column_name: 'points', column_type: 'Int' },
          { column_name: 'severity', column_type: 'Choice', choices: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = await admin.get<{
      columns: { column_name: string; label: string; reqd: boolean }[]
    }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    const title = meta.columns.find((f) => f.column_name === 'title')!
    expect(title.label).toBe('Headline')
    expect(title.reqd).toBe(true)
    // reqd now enforced
    const bad = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row: { points: 5 } }),
    })
    expect(bad.status).toBe(417)
  })

  test('removing a column drops the column_def but NEVER the physical column without the flag', async ({
    admin,
  }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        remove_columns: ['points'],
        columns: [
          { column_name: 'title', column_type: 'Data', label: 'Headline', reqd: true },
          { column_name: 'severity', column_type: 'Choice', choices: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = await admin.get<{ columns: { column_name: string }[] }>(
      `/api/table/${encodeURIComponent(DT)}:meta`,
    )
    expect(meta.columns.map((f) => f.column_name)).not.toContain('points')
    expect(await columns()).toContain('points') // data retained
    const rows = await sql.unsafe(`select points from featherbase.${TABLE} where title='a'`)
    expect(Number(rows[0].points)).toBe(1)
  })

  test('drop_columns flag really drops; column_type changes are rejected', async ({ admin }) => {
    await setup(admin)
    expect((await addSeverity(admin)).status).toBe(200)
    const drop = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        drop_columns: true,
        remove_columns: ['points', 'severity'],
        columns: [{ column_name: 'title', column_type: 'Data', label: 'Headline', reqd: true }],
      }),
    })
    expect(drop.status).toBe(200)
    expect(await columns()).not.toContain('severity')

    const badType = await admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        columns: [{ column_name: 'title', column_type: 'Int' }],
      }),
    })
    expect(badType.status).toBe(417)
    expect((await badType.json()).error.fields.title).toMatch(/column_type cannot change/)
  })
})

describe('Removing a column keeps its values', () => {
  test('a column taken out and later put back brings its old values with it', async ({ admin }) => {
    await setup(admin)
    await admin.put(`/api/table_def/${encodeURIComponent(DT)}`, { columns: [baseColumns[0]], remove_columns: ['points'] })
    const hidden = await admin.get<{ data: Record<string, unknown>[] }>(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(JSON.stringify(['title']))}`,
    )
    expect(hidden.data).toHaveLength(2)
    await admin.put(`/api/table_def/${encodeURIComponent(DT)}`, { columns: baseColumns })
    const back = await admin.get<{ data: { title: string; points: number }[] }>(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(JSON.stringify(['title', 'points']))}&order_by=title%20asc`,
    )
    expect(back.data.map((r) => [r.title, Number(r.points)])).toEqual([['a', 1], ['b', 1]])
  })
})

describe('Removing a column is asked for, never inferred (#251)', () => {
  const put = (admin: TestClient, body: Record<string, unknown>) =>
    admin.fetch(`/api/table_def/${encodeURIComponent(DT)}`, { method: 'PUT', body: JSON.stringify(body) })

  test('a definition that leaves out a column is refused, naming it and the rows that hold values', async ({ admin }) => {
    await setup(admin)
    const before = await admin.get(`/api/table/${encodeURIComponent(DT)}:meta`)
    const res = await put(admin, { columns: [baseColumns[0]] })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.points).toMatch(/2 rows/)
    expect(body.error.fields.points).toMatch(/remove_columns/)
    // Nothing moved: the definition and the values are as they were.
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}:meta`)).toEqual(before)
    const rows = await sql.unsafe(`select points from featherbase.${TABLE} order by title`)
    expect(rows.map((r) => Number(r.points))).toEqual([1, 1])
  })

  test('a column named in remove_columns is taken out and its values kept', async ({ admin }) => {
    await setup(admin)
    expect((await put(admin, { columns: [baseColumns[0]], remove_columns: ['points'] })).status).toBe(200)
    const meta = await admin.get<{ columns: { column_name: string }[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    expect(meta.columns.map((f) => f.column_name)).toEqual(['title'])
    expect(await columns()).toContain('points')
  })

  test('remove_columns may name only a column the Table has and the definition leaves out', async ({ admin }) => {
    await setup(admin)
    const kept = await put(admin, { columns: baseColumns, remove_columns: ['points'] })
    expect(kept.status).toBe(417)
    expect((await kept.json()).error.fields.points).toMatch(/still in the definition/)
    const unknown = await put(admin, { columns: baseColumns, remove_columns: ['nope'] })
    expect(unknown.status).toBe(417)
    expect((await unknown.json()).error.fields.nope).toMatch(/not a column/)
  })

  test('Amended From cannot be removed while the Table stays submittable, and says why', async ({ admin }) => {
    await setup(admin)
    expect((await put(admin, { columns: baseColumns, is_submittable: true })).status).toBe(200)
    const res = await put(admin, { columns: baseColumns, remove_columns: ['amended_from'] })
    expect(res.status).toBe(417)
    expect((await res.json()).error.fields.amended_from).toMatch(/turn is_submittable off/)
  })

  test('leaving out is_submittable keeps a submittable Table\'s Amended From column', async ({ admin }) => {
    await setup(admin)
    expect((await put(admin, { columns: baseColumns, is_submittable: true })).status).toBe(200)
    expect((await put(admin, { columns: baseColumns })).status).toBe(200)
    const meta = await admin.get<{ columns: { column_name: string }[] }>(`/api/table/${encodeURIComponent(DT)}:meta`)
    expect(meta.columns.map((f) => f.column_name)).toContain('amended_from')
  })
})

describe('Changing a Table definition', () => {
  const put = (admin: TestClient, name: string, body: Record<string, unknown>) =>
    admin.fetch(`/api/table_def/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) })

  test('a definition that is not valid is refused naming each problem', async ({ admin }) => {
    await setup(admin)
    const res = await put(admin, DT, { columns: [{ column_name: 'Bad Name', column_type: 'Data' }] })
    expect(res.status).toBe(417)
    expect(await res.json()).toMatchObject({ error: { message: 'Invalid Table definition', fields: { 'columns.0.column_name': expect.any(String) } } })
  })

  test('an existing Table cannot be bound to a data source', async ({ admin }) => {
    await setup(admin)
    const res = await put(admin, DT, { columns: baseColumns, data_source: 'some-source', external_table: 'x' })
    expect(res.status).toBe(417)
    expect(await res.json()).toMatchObject({ error: { message: 'An existing Table cannot be bound to a data source' } })
  })

  test('making a Table submittable adds its hidden Amended From column', async ({ admin }) => {
    await setup(admin)
    expect((await put(admin, DT, { columns: baseColumns, is_submittable: true })).status).toBe(200)
    const meta = await admin.get<{ columns: { column_name: string; column_type: string; reference_table?: string; hidden?: boolean }[] }>(
      `/api/table/${encodeURIComponent(DT)}:meta`,
    )
    expect(meta.columns.find((c) => c.column_name === 'amended_from')).toMatchObject({ column_type: 'Reference', reference_table: DT, hidden: true })
    expect(await columns()).toContain('amended_from')
  })

  test('a new unique column refuses repeats, and turning unique off allows them again', async ({ admin }) => {
    await setup(admin)
    const withCode = [...baseColumns, { column_name: 'code', column_type: 'Data', unique: true }]
    expect((await put(admin, DT, { columns: withCode })).status).toBe(200)
    await admin.post('/api/save_row', { table: DT, row: { title: 'c', code: 'X1' } })
    await expect(admin.post('/api/save_row', { table: DT, row: { title: 'd', code: 'X1' } })).rejects.toMatchObject({
      status: 417, fields: { code: 'code must be unique' },
    })
    expect((await put(admin, DT, { columns: [...baseColumns, { column_name: 'code', column_type: 'Data', unique: false }] })).status).toBe(200)
    await admin.post('/api/save_row', { table: DT, row: { title: 'd', code: 'X1' } })
    expect(await sql.unsafe(`select count(*)::int as n from featherbase.${TABLE} where code = 'X1'`)).toEqual([{ n: 2 }])
  })

  test('a Sub-table column must point at a Table that exists', async ({ admin }) => {
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sync Holder', columns: [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'No Such Lines' }] }),
    })
    expect(res.status).toBe(417)
    expect(await res.json()).toMatchObject({ error: { fields: { lines: 'Sub-table target No Such Lines does not exist' } } })
  })

  test('a link column must point at a Table that exists (#511)', async ({ admin }) => {
    const created = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sync Linker', columns: [{ column_name: 'other', column_type: 'Reference', reference_table: 'NoSuchTable' }] }),
    })
    expect(created.status).toBe(417)
    expect(await created.json()).toMatchObject({ error: { fields: { other: 'Link target NoSuchTable does not exist' } } })
    const [stored] = await sql`select 1 from table_def where name = 'Sync Linker'`
    expect(stored).toBeUndefined()

    await setup(admin)
    const added = await put(admin, DT, { columns: [...baseColumns, { column_name: 'other', column_type: 'Reference', reference_table: 'NoSuchTable' }] })
    expect(added.status).toBe(417)
    expect(await added.json()).toMatchObject({ error: { fields: { other: 'Link target NoSuchTable does not exist' } } })
    expect(await columns()).not.toContain('other')
  })

  test('a link column may point at its own Table or at one that exists', async ({ admin }) => {
    await setup(admin)
    const self = [...baseColumns, { column_name: 'parent_task', column_type: 'Reference', reference_table: DT }]
    expect((await put(admin, DT, { columns: self })).status).toBe(200)
    const created = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sync Linker', columns: [
        { column_name: 'task', column_type: 'Reference', reference_table: DT },
        { column_name: 'next', column_type: 'Reference', reference_table: 'Sync Linker' },
      ] }),
    })
    expect(created.status).toBe(201)
  })
})
