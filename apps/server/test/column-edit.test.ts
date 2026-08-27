import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// #209 (issue #197): changing a Table's columns AFTER the rows are in it.
//
// "Suppose I imported two things and then I realized... in one of the things
// floor was spelled with a G, Glor" — and "after importing I want to add a
// certain column but today it is not possible".
//
// Adding is what PUT /api/table_def/:name already did. Renaming is not: that
// route matches columns by column_name, so a changed name reads as
// delete-plus-add — the old physical column is orphaned with its data and the
// new one arrives empty. That silent loss is why the rename is its own thing.

const DT = 'Column Edit Zones'

interface Meta {
  name: string
  title_column?: string | null
  id_pattern?: string | null
  columns: { column_name: string; label: string; column_type: string }[]
}

async function setup(admin: TestClient, extra: Record<string, unknown> = {}) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'glor', label: 'Glor', column_type: 'Data' },
      { column_name: 'pop', column_type: 'Int' },
    ],
    ...extra,
  })
  await admin.post('/api/save_row', { table: DT, row: { glor: 'Ground', pop: 12 } })
  await admin.post('/api/save_row', { table: DT, row: { glor: 'Mezzanine', pop: 7 } })
}

const meta = (admin: TestClient) => admin.get<Meta>(`/api/table/${encodeURIComponent(DT)}:meta`)

async function rows(admin: TestClient, fields = ['row_id', 'glor', 'pop']) {
  const list = await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
      JSON.stringify(fields),
    )}&limit_page_length=50&order_by=${encodeURIComponent('pop asc')}`,
  )
  return list.data
}

const rename = (admin: TestClient, from: string, to: string) =>
  admin.post<Meta>(`/api/table_def/${encodeURIComponent(DT)}/rename_column`, { from, to })

describe('#209: renaming a column keeps its rows', () => {
  test('the values move with the name', async ({ admin }) => {
    await setup(admin)
    const after = await rename(admin, 'glor', 'floor')
    expect(after.columns.map((c) => c.column_name)).toContain('floor')
    expect(after.columns.map((c) => c.column_name)).not.toContain('glor')
    // The whole point: the data was already right.
    expect((await rows(admin, ['floor', 'pop'])).map((r) => r.floor)).toEqual([
      'Mezzanine',
      'Ground',
    ])
  })

  test('a Table still names its own column afterwards', async ({ admin }) => {
    // Left stale, the id pattern stops resolving and the list loses its
    // title — both silently, both a Table naming a column that is gone.
    await setup(admin, { title_column: 'glor', id_pattern: 'field:glor' })
    const after = await rename(admin, 'glor', 'floor')
    expect(after.title_column).toBe('floor')
    expect(after.id_pattern).toBe('field:floor')
  })

  test('a name already taken is refused, and nothing moves', async ({ admin }) => {
    await setup(admin)
    await expect(rename(admin, 'glor', 'pop')).rejects.toMatchObject({ status: 417 })
    expect((await meta(admin)).columns.map((c) => c.column_name)).toEqual(['glor', 'pop'])
    expect((await rows(admin)).map((r) => r.glor)).toEqual(['Mezzanine', 'Ground'])
  })

  test('a standard column cannot be renamed away', async ({ admin }) => {
    await setup(admin)
    await expect(rename(admin, 'created_at', 'made_at')).rejects.toMatchObject({ status: 417 })
  })

  test('a name that is not snake_case is refused', async ({ admin }) => {
    await setup(admin)
    for (const bad of ['Floor', 'floor name', '1floor', '']) {
      await expect(rename(admin, 'glor', bad)).rejects.toMatchObject({ status: 417 })
    }
  })

  test('renaming a column that is not there says so', async ({ admin }) => {
    await setup(admin)
    await expect(rename(admin, 'nope', 'floor')).rejects.toMatchObject({ status: 404 })
  })

  test('renaming to the same name is a no-op, not an error', async ({ admin }) => {
    await setup(admin)
    const after = await rename(admin, 'glor', 'glor')
    expect(after.columns.map((c) => c.column_name)).toEqual(['glor', 'pop'])
  })

  test('a unique column keeps its constraint under the new name', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: DT,
      columns: [{ column_name: 'glor', column_type: 'Data', unique: true }],
    })
    await admin.post('/api/save_row', { table: DT, row: { glor: 'Ground' } })
    await rename(admin, 'glor', 'floor')
    // Still unique — a rename must not quietly drop the guarantee.
    await expect(
      admin.post('/api/save_row', { table: DT, row: { floor: 'Ground' } }),
    ).rejects.toBeDefined()
  })

  test('a non-System-Manager cannot rename a column', async ({ admin, createUser }) => {
    await setup(admin)
    const user = await createUser({ roles: [] })
    await expect(
      user.post(`/api/table_def/${encodeURIComponent(DT)}/rename_column`, {
        from: 'glor',
        to: 'floor',
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect((await meta(admin)).columns.map((c) => c.column_name)).toContain('glor')
  })
})

describe('#209: adding a column after the rows are in', () => {
  test('a new column appears empty, and the existing rows survive', async ({ admin }) => {
    await setup(admin)
    const before = await meta(admin)
    await admin.put(`/api/table_def/${encodeURIComponent(DT)}`, {
      ...before,
      columns: [...before.columns, { column_name: 'aisle', label: 'Aisle', column_type: 'Data' }],
    })
    const after = await meta(admin)
    expect(after.columns.map((c) => c.column_name)).toContain('aisle')
    const data = await rows(admin, ['row_id', 'glor', 'pop', 'aisle', 'updated_at'])
    expect(data).toHaveLength(2)
    expect(data[0].aisle ?? null).toBeNull()
    // And it takes a value like any other column.
    await admin.post('/api/save_row', {
      table: DT,
      row: { row_id: data[0].row_id, updated_at: data[0].updated_at, aisle: 'A3' },
    })
    expect((await rows(admin, ['pop', 'aisle']))[0].aisle).toBe('A3')
  })

  test('a label can be changed without touching the data', async ({ admin }) => {
    await setup(admin)
    const before = await meta(admin)
    await admin.put(`/api/table_def/${encodeURIComponent(DT)}`, {
      ...before,
      columns: before.columns.map((c) => (c.column_name === 'glor' ? { ...c, label: 'Floor' } : c)),
    })
    const after = await meta(admin)
    expect(after.columns.find((c) => c.column_name === 'glor')?.label).toBe('Floor')
    expect((await rows(admin)).map((r) => r.glor)).toEqual(['Mezzanine', 'Ground'])
  })
})
