import { describe, expect } from 'vitest'
import { test } from './pg-test'

// #1259: a list can be read in three views. A saved view keeps the view it was
// saved in, and a Table can be marked as a queue (its lists open on cards).

const FILTERS = [['status', '=', 'Open'] as [string, string, unknown]]

describe('#1259: a saved view keeps its view', () => {
  test('a view saved with a layout returns it, in the bar and in the sidebar', async ({ admin }) => {
    const created = await admin.post<{ row_id: string; layout?: string }>('/api/saved_views', {
      table: 'Customer', label: 'Queue', filters: FILTERS, layout: 'split',
    })
    expect(created.layout).toBe('split')
    const bar = await admin.get<{ views: Array<{ row_id: string; layout?: string }> }>('/api/saved_views?table=Customer')
    expect(bar.views.find((v) => v.row_id === created.row_id)?.layout).toBe('split')
    const sidebar = await admin.get<{ views: Array<{ row_id: string; layout?: string }> }>('/api/saved_views/sidebar')
    expect(sidebar.views.find((v) => v.row_id === created.row_id)?.layout).toBe('split')
  })

  test('a view saved without one has none, and an unknown layout is refused', async ({ admin }) => {
    const plain = await admin.post<{ row_id: string; layout?: string | null }>('/api/saved_views', {
      table: 'Customer', label: 'Plain', filters: FILTERS,
    })
    expect(plain.layout ?? null).toBeNull()
    await expect(admin.post('/api/saved_views', { table: 'Customer', label: 'Odd', filters: FILTERS, layout: 'grid' }))
      .rejects.toMatchObject({ status: 417 })
  })
})

describe('#1259: a Table can be marked as a queue', () => {
  test('a new Table is not a queue; marking one keeps it, and a later update that leaves it out keeps it too', async ({ admin }) => {
    await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Lv Queue', columns: [{ column_name: 'title', column_type: 'Data' }] })
    const before = await admin.get<{ queue?: boolean }>('/api/table/Lv%20Queue:meta')
    expect(before.queue ?? false).toBe(false)
    await admin.put('/api/table_def/Lv%20Queue', { queue: true, columns: [{ column_name: 'title', column_type: 'Data' }] })
    expect((await admin.get<{ queue?: boolean }>('/api/table/Lv%20Queue:meta')).queue).toBe(true)
    await admin.put('/api/table_def/Lv%20Queue', { columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
    expect((await admin.get<{ queue?: boolean }>('/api/table/Lv%20Queue:meta')).queue).toBe(true)
  })

  test('a Table made as a queue is one from the start', async ({ admin }) => {
    await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Lv Born Queue', queue: true, columns: [{ column_name: 'title', column_type: 'Data' }] })
    expect((await admin.get<{ queue?: boolean }>('/api/table/Lv%20Born%20Queue:meta')).queue).toBe(true)
  })
})
