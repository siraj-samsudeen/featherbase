// #1029: a row named after its own column. A rename moves the column with the
// id, in the same transaction, and the column's rules apply to the new value.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { expectRefused } from './fixtures'

const rowUrl = (table: string, id: string) => `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`
const rename = (admin: TestClient, table: string, from: string, to: string) =>
  admin.post<Record<string, unknown>>(`${rowUrl(table, from)}:rename`, { new_name: to })
const save = (admin: TestClient, table: string, row: Record<string, unknown>) =>
  admin.post<Record<string, unknown>>('/api/save_row', { table, row })

async function cluster(admin: TestClient, extra: { column?: Record<string, unknown>; id_pattern?: string } = {}) {
  await admin.post('/api/table_def', {
    name: 'Rs Cluster',
    id_pattern: extra.id_pattern ?? 'field:code',
    title_column: 'code',
    columns: [
      { column_name: 'code', column_type: 'Data', reqd: true, ...extra.column },
      { column_name: 'note', column_type: 'Data' },
    ],
  })
}

describe('renaming a row named after its own column', () => {
  test('moves the column too, and links follow', async ({ admin }) => {
    await cluster(admin)
    await save(admin, 'Rs Cluster', { code: 'VLM', note: 'kept' })
    await admin.post('/api/table_def', { name: 'Rs Store', columns: [{ column_name: 'cluster', column_type: 'Reference', reference_table: 'Rs Cluster' }] })
    const store = await save(admin, 'Rs Store', { cluster: 'VLM' })

    const renamed = await rename(admin, 'Rs Cluster', 'VLM', 'TVM')
    expect(renamed).toMatchObject({ row_id: 'TVM', code: 'TVM', note: 'kept' })
    expect(await admin.get(rowUrl('Rs Cluster', 'TVM'))).toMatchObject({ code: 'TVM' })
    expect(await admin.get(rowUrl('Rs Store', String(store.row_id)))).toMatchObject({ cluster: 'TVM' })
  })

  test('takes the prefix off for a prefixed id, and refuses an id without it', async ({ admin }) => {
    await cluster(admin, { id_pattern: 'CL-{code}' })
    await save(admin, 'Rs Cluster', { code: 'VLM' })
    expect(await rename(admin, 'Rs Cluster', 'CL-VLM', 'CL-TVM')).toMatchObject({ row_id: 'CL-TVM', code: 'TVM' })
    await expectRefused(rename(admin, 'Rs Cluster', 'CL-TVM', 'TVM'), 417)
    await expectRefused(rename(admin, 'Rs Cluster', 'CL-TVM', 'CL-'), 417)
    expect(await admin.get(rowUrl('Rs Cluster', 'CL-TVM'))).toMatchObject({ code: 'TVM' })
  })

  test("refuses a value the column's type refuses, and leaves the row", async ({ admin }) => {
    await cluster(admin, { column: { column_type: 'Int' } })
    await save(admin, 'Rs Cluster', { code: 12 })
    await expectRefused(rename(admin, 'Rs Cluster', '12', 'twelve'), 417)
    expect(await rename(admin, 'Rs Cluster', '12', '13')).toMatchObject({ row_id: '13', code: 13 })
  })

  test('refuses a value a Choice column does not offer', async ({ admin }) => {
    await cluster(admin, { column: { column_type: 'Choice', choices: 'VLM\nTVM' } })
    await save(admin, 'Rs Cluster', { code: 'VLM' })
    await expectRefused(rename(admin, 'Rs Cluster', 'VLM', 'KOC'), 417)
  })

  test('refuses a value another row holds in a unique column, and leaves the row', async ({ admin }) => {
    await cluster(admin, { column: { unique: true } })
    const first = await save(admin, 'Rs Cluster', { code: 'VLM' })
    const second = await save(admin, 'Rs Cluster', { code: 'KOC' })
    // The two get out of step when a save changes the column and keeps the id.
    await save(admin, 'Rs Cluster', { ...second, code: 'TVM' })
    await expectRefused(rename(admin, 'Rs Cluster', String(first.row_id), 'TVM'), 417)
    expect(await admin.get(rowUrl('Rs Cluster', 'VLM'))).toMatchObject({ row_id: 'VLM', code: 'VLM' })
  })

  test('a link column that names the row must point at a row', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Rs Plant', id_pattern: 'prompt', columns: [{ column_name: 'label', column_type: 'Data' }] })
    await save(admin, 'Rs Plant', { row_id: 'P1', label: 'One' })
    await cluster(admin, { column: { column_type: 'Reference', reference_table: 'Rs Plant' } })
    await save(admin, 'Rs Cluster', { code: 'P1' })
    await expectRefused(rename(admin, 'Rs Cluster', 'P1', 'P2'), 417)
  })

  test('a read-only column is not moved by a rename', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Rs Fixed', id_pattern: 'field:code', columns: [{ column_name: 'code', column_type: 'Data', read_only: true, default_value: 'VLM' }] })
    const row = await save(admin, 'Rs Fixed', { code: 'VLM' })
    await expectRefused(rename(admin, 'Rs Fixed', String(row.row_id), 'TVM'), 417)
  })

  test('a Table with another naming rule is unchanged', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Rs Prompt', id_pattern: 'prompt', columns: [{ column_name: 'code', column_type: 'Data' }] })
    await save(admin, 'Rs Prompt', { row_id: 'A', code: 'kept' })
    expect(await rename(admin, 'Rs Prompt', 'A', 'B')).toMatchObject({ row_id: 'B', code: 'kept' })
  })
})
