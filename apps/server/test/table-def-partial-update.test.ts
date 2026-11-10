// #1025: a PUT changes what it names. A setting left out stays as it was, and
// only an explicit empty value clears it.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectRefused, makeTable } from './fixtures'

const url = (table: string) => `/api/table_def/${encodeURIComponent(table)}`
type Meta = { title_column: string | null; description: string | null; module: string; id_pattern: string; columns: { column_name: string; label: string }[] }
const meta = (admin: Parameters<typeof makeTable>[0], table: string) => admin.get<Meta>(`/api/table/${encodeURIComponent(table)}:meta`)

async function plant(admin: Parameters<typeof makeTable>[0], name = 'Pu Plant') {
  await admin.post('/api/table_def', {
    name,
    module: 'Pu Module',
    id_pattern: 'prompt',
    title_column: 'plant_name',
    description: 'Every plant we run',
    reading_presentation: { title: 'plant_name', headers: [], body: 'note', attachment_names: 'note', notice: 'Read only' },
    columns: [
      { column_name: 'plant_name', column_type: 'Data' },
      { column_name: 'note', column_type: 'Text' },
    ],
  })
  const [before] = await sql`select * from table_def where name = ${name}`
  return before
}

const settings = (row: Record<string, unknown>) => {
  const { updated_at: _, ...rest } = row
  return rest
}

describe('PUT /api/table_def/:name', () => {
  test('with only columns, every Table setting stays as it was', async ({ admin }) => {
    const before = await plant(admin)
    await admin.put(url('Pu Plant'), {
      columns: [
        { column_name: 'plant_name', column_type: 'Data', label: 'Name' },
        { column_name: 'note', column_type: 'Text' },
      ],
    })
    const [after] = await sql`select * from table_def where name = 'Pu Plant'`
    expect(settings(after)).toEqual(settings(before))
    expect((await meta(admin, 'Pu Plant')).columns.find((c) => c.column_name === 'plant_name')?.label).toBe('Name')
  })

  test('with only a setting, the columns and the other settings stay', async ({ admin }) => {
    const before = await plant(admin)
    const columns = await sql`select * from column_def where parent = 'Pu Plant' order by position`
    await admin.put(url('Pu Plant'), { description: 'Every plant we still run' })
    const [after] = await sql`select * from table_def where name = 'Pu Plant'`
    expect(settings(after)).toEqual({ ...settings(before), description: 'Every plant we still run' })
    expect((await sql`select * from column_def where parent = 'Pu Plant' order by position`).map(settings)).toEqual(columns.map(settings))
  })

  test.for([null, ''])('sending %j clears a setting', async (empty, { admin }) => {
    await plant(admin)
    await admin.put(url('Pu Plant'), { title_column: empty, description: empty })
    expect(await meta(admin, 'Pu Plant')).toMatchObject({ title_column: null, description: null, module: 'Pu Module' })
  })

  test('a sub-table and a settings Table can be updated without naming their kind', async ({ admin }) => {
    await makeTable(admin, { name: 'Pu Line', kind: 'sub_table', columns: ['item'] } as never)
    await admin.put(url('Pu Line'), { description: 'One line' })
    expect((await meta(admin, 'Pu Line')).description).toBe('One line')
    await makeTable(admin, { name: 'Pu Settings', kind: 'settings', columns: ['limit_value'] } as never)
    await admin.put(url('Pu Settings'), { description: 'Limits' })
    expect((await meta(admin, 'Pu Settings')).description).toBe('Limits')
  })

  test('removing the title column clears the title', async ({ admin }) => {
    await plant(admin)
    await admin.put(url('Pu Plant'), { reading_presentation: null })
    await admin.put(url('Pu Plant'), { columns: [{ column_name: 'note', column_type: 'Text' }], remove_columns: ['plant_name'] })
    expect((await meta(admin, 'Pu Plant')).title_column).toBeNull()
  })

  test('a title column the Table does not have is refused', async ({ admin }) => {
    await plant(admin)
    await expectRefused(admin.put(url('Pu Plant'), { title_column: 'nope' }), 417)
    expect((await meta(admin, 'Pu Plant')).title_column).toBe('plant_name')
  })

  test('another value column can become the title, but a layout column cannot', async ({ admin }) => {
    await plant(admin)
    const columns = [
      { column_name: 'plant_name', column_type: 'Data' },
      { column_name: 'note', column_type: 'Text' },
      { column_name: 'details', column_type: 'Section Break' },
    ]
    await expectRefused(admin.put(url('Pu Plant'), { columns, title_column: 'details' }), 417, 'has no column details to name its rows')
    await admin.put(url('Pu Plant'), { columns, title_column: 'note' })
    expect((await meta(admin, 'Pu Plant')).title_column).toBe('note')
  })
})
