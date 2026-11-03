import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, patchDoc, tableRef } from './fixtures'

// #608: a role that may create rows but not edit them keeps what it typed on
// a new row. The create grant reaches the columns of its tier; a restricted
// column still needs a grant at that tier.
const DT = 'Cog Order'
const LINE = 'Cog Order Line'
const orders = tableRef(DT)

describe('#608: a create-only grant saves what was typed', () => {
  test('the new row keeps its columns, and a later edit is refused', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: LINE, kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Data' }] })
    await admin.post('/api/table_def', {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'cost', column_type: 'Currency', tier: 'restricted' },
        { column_name: 'lines', column_type: 'Sub-table', row_table: LINE },
      ],
    })
    const planner = await createUserWithRole(admin, createUser, {
      role: 'Cog Planner',
      table: DT,
      tier: 'basic',
      can_read: true,
      can_create: true,
    })
    const saved = await planner.post<Record<string, any>>('/api/save_row', { table: DT, row: { title: 'Planner order', cost: 99, lines: [{ item: 'Bolts' }] } })
    const stored = await admin.get<Record<string, any>>(orders.rowUrl(saved.row_id))
    expect(stored.title).toBe('Planner order')
    expect(stored.cost ?? null).toBeNull()
    expect(stored.lines.map((l: Record<string, unknown>) => l.item)).toEqual(['Bolts'])
    await expect(patchDoc(planner, orders.rowUrl(saved.row_id), { updated_at: stored.updated_at, title: 'Changed' }))
      .rejects.toMatchObject({ status: 403 })
  })
})
