import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, tableRef } from './fixtures'

// #608: a role that may create rows but not edit them keeps what it typed on
// a new row. The create grant reaches the columns of its tier; a restricted
// column still needs a grant at that tier.
const DT = 'Cog Order'
const LINE = 'Cog Order Line'
const orders = tableRef(DT)

describe('#608: a create-only grant saves what was typed', () => {
  test('the new row keeps its sub-table lines, and a restricted column is refused', async ({ admin, createUser }) => {
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
    await expect(planner.post('/api/save_row', { table: DT, row: { title: 'Forbidden order', cost: 99, lines: [{ item: 'Bolts' }] } }))
      .rejects.toMatchObject({ status: 403 })
    expect(await admin.get(orders.listUrl({}))).toMatchObject({ data: [], total: 0 })
    // The title kept, and a later change refused, is the scenario "Create without edit" (permissions-and-roles).
    const saved = await planner.post<Record<string, any>>('/api/save_row', { table: DT, row: { title: 'Planner order', lines: [{ item: 'Bolts' }] } })
    const stored = await admin.get<Record<string, any>>(orders.rowUrl(saved.row_id))
    expect(stored.cost ?? null).toBeNull()
    expect(stored.lines.map((l: Record<string, unknown>) => l.item)).toEqual(['Bolts'])
  })
})
