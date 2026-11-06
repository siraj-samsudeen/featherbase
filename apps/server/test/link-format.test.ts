// #1020: a Table's choice of how links to it read.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makeTable } from './fixtures'

const url = (table: string) => `/api/table_def/${encodeURIComponent(table)}`
const meta = (admin: Parameters<typeof makeTable>[0], table: string) =>
  admin.get<{ link_format: string; title_column: string | null; description: string | null }>(`/api/table/${encodeURIComponent(table)}:meta`)

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
      .rejects.toMatchObject({ status: 417 })
  })
})

describe('a link as the name of a row', () => {
  const columns = [
    { column_name: 'label', column_type: 'Data' },
    { column_name: 'cluster', column_type: 'Reference', reference_table: 'Role' },
    { column_name: 'owner', column_type: 'Reference', reference_table: 'Person' },
  ]

  test('a link to a row is refused: its value is a code', async ({ admin }) => {
    await expect(admin.post('/api/table_def', { name: 'Lf LinkTitle', title_column: 'cluster', columns }))
      .rejects.toMatchObject({ status: 417 })
    await admin.post('/api/table_def', { name: 'Lf LinkTitle', title_column: 'label', columns })
    await expect(admin.put(url('Lf LinkTitle'), { title_column: 'cluster' })).rejects.toMatchObject({ status: 417 })
    expect((await meta(admin, 'Lf LinkTitle')).title_column).toBe('label')
  })

  test('a link to a person is allowed: people read the name', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Lf PersonTitle', title_column: 'owner', columns })
    expect((await meta(admin, 'Lf PersonTitle')).title_column).toBe('owner')
  })
})

describe('a PUT that names only the format', () => {
  test('changes the format and leaves everything else', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Lf Narrow',
      title_column: 'label',
      description: 'Kept',
      columns: [{ column_name: 'label', column_type: 'Data' }],
    })
    const before = await sql`select column_name from column_def where parent = 'Lf Narrow' order by position`
    await admin.put(url('Lf Narrow'), { link_format: 'name' })
    expect(await meta(admin, 'Lf Narrow')).toMatchObject({ link_format: 'name', title_column: 'label', description: 'Kept' })
    expect(await sql`select column_name from column_def where parent = 'Lf Narrow' order by position`).toEqual(before)
  })

  test('only a System Manager may change it', async ({ admin, createUser }) => {
    await makeTable(admin, { name: 'Lf Guarded', columns: ['label'] })
    const person = await createUser({ roles: [] })
    await expect(person.put(url('Lf Guarded'), { link_format: 'name' })).rejects.toMatchObject({ status: 403 })
  })
})
