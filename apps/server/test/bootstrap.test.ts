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

  test('GET /api/table/Table lists Tables including Table itself', async ({ admin }) => {
    const body = await admin.get<{ data: { row_id: string; kind: string }[] }>(
      `/api/table/Table?${new URLSearchParams({
        filters: JSON.stringify([['row_id', 'in', ['Table', 'Column']]]),
        fields: JSON.stringify(['row_id', 'kind']),
        order_by: 'row_id asc',
      })}`,
    )
    expect(body.data).toEqual([
      { row_id: 'Column', kind: 'sub_table' },
      { row_id: 'Table', kind: 'table' },
    ])
  })

  test('GET /api/table/Table/<name> returns a Table doc with its columns as children', async ({
    admin,
  }) => {
    const doc = await admin.get<{ columns: { column_name: string }[] }>(
      '/api/table/Table/Column',
    )
    expect(doc.columns.map((f) => f.column_name)).toContain('column_type')
  })

  test('generic writes/deletes to Table/Column are refused', async ({ admin }) => {
    await expect(
      admin.post('/api/save_row', { table: 'Table', row: { module: 'X' } }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.delete('/api/table/Table/Column')).rejects.toMatchObject({
      status: 417,
    })
  })
})
