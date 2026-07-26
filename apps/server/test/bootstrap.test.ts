import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { getMeta } from '../src/meta'

describe('META-012: Table and Column are themselves Tables', () => {
  test('getMeta("Table") works and declares a columns child table', async () => {
    const meta = await getMeta('Table')
    expect(meta.id_pattern).toBe('prompt')
    const column = meta.columns.find((f) => f.column_name === 'columns')
    expect(column).toMatchObject({ column_type: 'Sub-table', row_table: 'Column' })
  })

  test('GET /api/resource/Table lists Tables including Table itself', async ({ admin }) => {
    const body = await admin.get<{ data: { name: string; kind: string }[] }>(
      `/api/resource/Table?${new URLSearchParams({
        filters: JSON.stringify([['name', 'in', ['Table', 'Column']]]),
        fields: JSON.stringify(['name', 'kind']),
        order_by: 'name asc',
      })}`,
    )
    expect(body.data).toEqual([
      { name: 'Column', kind: 'sub_table' },
      { name: 'Table', kind: 'table' },
    ])
  })

  test('GET /api/resource/Table/<name> returns a Table doc with its columns as children', async ({
    admin,
  }) => {
    const doc = await admin.get<{ columns: { column_name: string }[] }>(
      '/api/resource/Table/Column',
    )
    expect(doc.columns.map((f) => f.column_name)).toContain('column_type')
  })

  test('generic writes/deletes to Table/Column are refused', async ({ admin }) => {
    await expect(
      admin.post('/api/save_doc', { doctype: 'Table', doc: { module: 'X' } }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.delete('/api/resource/Table/Column')).rejects.toMatchObject({
      status: 417,
    })
  })
})
