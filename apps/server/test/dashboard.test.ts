import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { countDocs, groupCount } from '../src/query'
import { grantRole, makeTable } from './fixtures'

// UI-026: dashboard aggregates (countDocs / groupCount) count and group live
// data with the same permission scoping as the list query.

const DT = 'Dash Srv Task'
const STAGES = ['Open', 'Open', 'Open', 'Closed', 'Closed', 'Pending']

// Each test rebuilds the Table + rows inside its own rolled-back tx.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed\nPending' },
    ],
  })
  for (const stage of STAGES)
    await admin.post('/api/save_row', { table: DT, row: { title: 't', stage } })
}

describe('UI-026: dashboard aggregates', () => {
  test('countDocs counts all and filtered documents', async ({ admin }) => {
    await setup(admin)
    expect(await countDocs(DT, [], 'Administrator')).toBe(6)
    expect(await countDocs(DT, [['stage', '=', 'Open']], 'Administrator')).toBe(3)
    expect(await countDocs(DT, [['stage', '=', 'Closed']], 'Administrator')).toBe(2)
  })

  test('groupCount groups by a field, ordered by descending count', async ({ admin }) => {
    await setup(admin)
    const rows = await groupCount(DT, 'stage', [], 'Administrator')
    expect(rows).toEqual([
      { label: 'Open', value: 3 },
      { label: 'Closed', value: 2 },
      { label: 'Pending', value: 1 },
    ])
  })

  test('respects filters in grouped counts', async ({ admin }) => {
    await setup(admin)
    const rows = await groupCount(DT, 'stage', [['stage', '!=', 'Pending']], 'Administrator')
    expect(rows).toEqual([
      { label: 'Open', value: 3 },
      { label: 'Closed', value: 2 },
    ])
  })

  test('enforces read permission (a user without read cannot count)', async ({ admin }) => {
    await setup(admin)
    await expect(countDocs(DT, [], 'Guest')).rejects.toMatchObject({ type: 'PermissionError' })
    await expect(groupCount(DT, 'stage', [], 'Guest')).rejects.toMatchObject({
      type: 'PermissionError',
    })
  })
})

describe('A dashboard\'s numbers and charts stay live, scoped to the viewer', () => {
  const ROLE = 'Dash Srv Viewer'
  test('a card and a chart count only the orders a restricted viewer could read themselves', async ({ admin, createUser }) => {
    const orders = await makeTable(admin, { name: 'Dash Srv Order', id_pattern: 'prompt', columns: ['phase'] })
    await grantRole(admin, { role: ROLE, table: 'Dash Srv Order', own_rows_only: true, can_read: true, can_write: true, can_create: true })
    const alice = await createUser({ roles: [ROLE] })
    const bob = await createUser({ roles: [ROLE] })
    await alice.post(orders.url, { row_id: 'o-a1', phase: 'Open' })
    await bob.post(orders.url, { row_id: 'o-b1', phase: 'Open' })
    await bob.post(orders.url, { row_id: 'o-b2', phase: 'Paid' })

    const everyone = await admin.post<{ count: number }>('/api/dashboard/count', { table: 'Dash Srv Order' })
    expect(everyone.count).toBe(3)
    expect((await alice.post<{ count: number }>('/api/dashboard/count', { table: 'Dash Srv Order' })).count).toBe(1)
    expect((await bob.post<{ count: number }>('/api/dashboard/count', { table: 'Dash Srv Order' })).count).toBe(2)
    const chart = await alice.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', { table: 'Dash Srv Order', group_by: 'phase' })
    expect(chart.data).toEqual([{ label: 'Open', value: 1 }])
  })

  test('the numbers are computed fresh on every request, so a new row shows at once', async ({ admin }) => {
    await setup(admin)
    expect((await admin.post<{ count: number }>('/api/dashboard/count', { table: DT })).count).toBe(6)
    await admin.post('/api/save_row', { table: DT, row: { title: 't', stage: 'Open' } })
    expect((await admin.post<{ count: number }>('/api/dashboard/count', { table: DT })).count).toBe(7)
    const open = await admin.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', { table: DT, group_by: 'stage' })
    expect(open.data[0]).toEqual({ label: 'Open', value: 4 })
  })
})
