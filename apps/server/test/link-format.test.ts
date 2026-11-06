// #1020: a Table's choice of how links to it read.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makeTable } from './fixtures'

const url = (table: string) => `/api/table_def/${encodeURIComponent(table)}`
const meta = (admin: Parameters<typeof makeTable>[0], table: string) =>
  admin.get<{ link_format: string; title_column: string | null }>(`/api/table/${encodeURIComponent(table)}:meta`)

describe('link_format on a Table definition', () => {
  test('a Table that says nothing reads Name (code)', async ({ admin }) => {
    await makeTable(admin, { name: 'Lf Plain', columns: ['title'] })
    expect((await meta(admin, 'Lf Plain')).link_format).toBe('name_code')
  })

  test('POST and PUT take a format, and a PUT that leaves it out keeps it', async ({ admin }) => {
    await makeTable(admin, { name: 'Lf Cluster', link_format: 'code', columns: ['title'] } as never)
    expect((await meta(admin, 'Lf Cluster')).link_format).toBe('code')

    const columns = [{ column_name: 'title', column_type: 'Data' }]
    await admin.put(url('Lf Cluster'), { name: 'Lf Cluster', link_format: 'code_name', columns })
    expect((await meta(admin, 'Lf Cluster')).link_format).toBe('code_name')

    await admin.put(url('Lf Cluster'), { name: 'Lf Cluster', columns })
    expect((await meta(admin, 'Lf Cluster')).link_format).toBe('code_name')
  })

  test('an unknown format is refused', async ({ admin }) => {
    await expect(admin.post('/api/table_def', { name: 'Lf Bad', link_format: 'dotted', columns: [{ column_name: 'title', column_type: 'Data' }] }))
      .rejects.toMatchObject({ status: 400 })
  })
})

describe('PUT /api/table_def/:name/link_format', () => {
  test('changes the format and the name column without touching the columns', async ({ admin }) => {
    await makeTable(admin, { name: 'Lf Narrow', columns: ['code', 'label'] })
    const before = await sql`select column_name from column_def where parent = 'Lf Narrow' order by position`

    await admin.put(`${url('Lf Narrow')}/link_format`, { link_format: 'name', title_column: 'label' })
    expect(await meta(admin, 'Lf Narrow')).toMatchObject({ link_format: 'name', title_column: 'label' })
    expect(await sql`select column_name from column_def where parent = 'Lf Narrow' order by position`).toEqual(before)

    await admin.put(`${url('Lf Narrow')}/link_format`, { link_format: 'code' })
    expect(await meta(admin, 'Lf Narrow')).toMatchObject({ link_format: 'code', title_column: 'label' })
  })

  test('refuses an unknown format and a name column the Table does not have', async ({ admin }) => {
    await makeTable(admin, { name: 'Lf Refuse', columns: ['label'] })
    await expect(admin.put(`${url('Lf Refuse')}/link_format`, { link_format: 'dotted' })).rejects.toMatchObject({ status: 400 })
    await expect(admin.put(`${url('Lf Refuse')}/link_format`, { link_format: 'name', title_column: 'nope' })).rejects.toMatchObject({ status: 400 })
    expect((await meta(admin, 'Lf Refuse')).link_format).toBe('name_code')
  })

  test('only a System Manager may change it', async ({ admin, createUser }) => {
    await makeTable(admin, { name: 'Lf Guarded', columns: ['label'] })
    const person = await createUser({ roles: [] })
    await expect(person.put(`${url('Lf Guarded')}/link_format`, { link_format: 'name' })).rejects.toMatchObject({ status: 403 })
  })
})
