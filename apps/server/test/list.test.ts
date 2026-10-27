import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, grantRole, expectApiError } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'List Test Item'

// The Table's own two-value field is named `stage` (not `status`) — `status`
// is now the reserved draft/submitted/cancelled lifecycle column.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed' },
      { column_name: 'qty', column_type: 'Int' },
    ],
  })
  for (const [title, stage, qty] of [
    ['alpha', 'Open', 1],
    ['beta', 'Open', 5],
    ['gamma', 'Closed', 3],
    ['delta', 'Closed', 9],
  ]) {
    await admin.post('/api/save_row', { table: DT, row: { title, stage, qty } })
  }
}

const listPath = (params: Record<string, string>) =>
  `/api/table/${encodeURIComponent(DT)}?${new URLSearchParams(params).toString()}`

describe('DOC-010: get_list with filters, fields, order_by, pagination', () => {
  test('filters by equality', async ({ admin }) => {
    await setup(admin)
    const body = await admin.get<{ total: number; data: { title: string }[] }>(
      listPath({
        filters: JSON.stringify([['stage', '=', 'Open']]),
        fields: JSON.stringify(['row_id', 'title', 'qty']),
      }),
    )
    expect(body.total).toBe(2)
    expect(body.data.map((r: { title: string }) => r.title).sort()).toEqual(['alpha', 'beta'])
  })

  test('combines filters, supports like/in/>=', async ({ admin }) => {
    await setup(admin)
    const body = await admin.get<{ data: { title: string }[] }>(
      listPath({
        filters: JSON.stringify([
          ['stage', 'in', ['Open', 'Closed']],
          ['qty', '>=', 3],
          ['title', 'like', '%a%'],
        ]),
        fields: JSON.stringify(['title']),
        order_by: 'qty desc',
      }),
    )
    expect(body.data.map((r: { title: string }) => r.title)).toEqual(['delta', 'beta', 'gamma'])
  })

  test('paginates with stable ordering and reports total', async ({ admin }) => {
    await setup(admin)
    const page1 = await admin.get<{ total: number; data: { title: string }[] }>(
      listPath({ order_by: 'qty asc', fields: JSON.stringify(['title']), limit_page_length: '2' }),
    )
    const page2 = await admin.get<{ total: number; data: { title: string }[] }>(
      listPath({
        order_by: 'qty asc',
        fields: JSON.stringify(['title']),
        limit_page_length: '2',
        limit_start: '2',
      }),
    )
    expect(page1.total).toBe(4)
    expect(page1.data.map((r: { title: string }) => r.title)).toEqual(['alpha', 'gamma'])
    expect(page2.data.map((r: { title: string }) => r.title)).toEqual(['beta', 'delta'])
  })

  test('errors cleanly on unknown filter/select/order fields and bad operators', async ({
    admin,
  }) => {
    await setup(admin)
    await expect(
      admin.get(listPath({ filters: JSON.stringify([['nope', '=', 1]]) })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.get(listPath({ fields: JSON.stringify(['nope']) })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.get(listPath({ order_by: 'nope desc' }))).rejects.toMatchObject({
      status: 417,
    })
    await expect(
      admin.get(listPath({ order_by: 'qty; drop table table' })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.get(listPath({ filters: JSON.stringify([['qty', '~', 1]]) })),
    ).rejects.toMatchObject({ status: 417 })
    await expect(admin.get(listPath({ filters: 'not-json' }))).rejects.toMatchObject({
      status: 417,
    })
  })
})

describe('Browse a table\'s rows: child rows and counts follow what the caller may see', () => {
  const LINE = 'Lst Line'
  const ORDER = 'Lst Order'

  async function orders(admin: TestClient) {
    await admin.post('/api/table_def', {
      name: LINE,
      kind: 'sub_table',
      columns: [{ column_name: 'item', column_type: 'Data' }],
    })
    await admin.post('/api/table_def', {
      name: ORDER,
      columns: [
        { column_name: 'customer', column_type: 'Data' },
        { column_name: 'lines', column_type: 'Sub-table', row_table: LINE },
      ],
    })
  }

  test('a nested-row list shows only rows hanging off orders the caller may read', async ({ admin, createUser }) => {
    await orders(admin)
    // Alice may read only the orders she created, and every line.
    const alice = await createUserWithRole(admin, createUser, {
      role: 'Lst Seller',
      table: ORDER,
      own_rows_only: true,
      can_read: true,
      can_create: true,
    })
    await grantRole(admin, { role: 'Lst Seller', table: LINE, can_read: true })
    await alice.post('/api/save_row', { table: ORDER, row: { customer: 'mine', lines: [{ item: 'bolt' }] } })
    await admin.post('/api/save_row', { table: ORDER, row: { customer: 'theirs', lines: [{ item: 'nut' }] } })

    const seen = await alice.get<{ data: { item: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(LINE)}?fields=${encodeURIComponent(JSON.stringify(['item']))}`,
    )
    expect(seen.data.map((r) => r.item)).toEqual(['bolt'])
    expect(seen.total).toBe(1)
    const all = await admin.get<{ total: number }>(`/api/table/${encodeURIComponent(LINE)}`)
    expect(all.total).toBe(2)
  })

  test('a nested-row list shows every row for a caller who may read every owning row', async ({ admin, createUser }) => {
    await orders(admin)
    const auditor = await createUserWithRole(admin, createUser, { role: 'Lst Auditor', table: ORDER, can_read: true })
    await grantRole(admin, { role: 'Lst Auditor', table: LINE, can_read: true })
    await admin.post('/api/save_row', { table: ORDER, row: { customer: 'one', lines: [{ item: 'bolt' }] } })
    await admin.post('/api/save_row', { table: ORDER, row: { customer: 'two', lines: [{ item: 'nut' }] } })
    const seen = await auditor.get<{ data: { item: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(LINE)}?fields=${encodeURIComponent(JSON.stringify(['item']))}`,
    )
    expect(seen.data.map((r) => r.item).sort()).toEqual(['bolt', 'nut'])
    expect(seen.total).toBe(2)
  })

  test('a nested-row list shows nothing when the caller cannot read the owning Table', async ({ admin, createUser }) => {
    await orders(admin)
    const clerk = await createUserWithRole(admin, createUser, { role: 'Lst Line Clerk', table: LINE, can_read: true })
    await admin.post('/api/save_row', { table: ORDER, row: { customer: 'x', lines: [{ item: 'bolt' }] } })
    const seen = await clerk.get<{ total: number }>(`/api/table/${encodeURIComponent(LINE)}`)
    expect(seen.total).toBe(0)
  })

  test('an aggregate whose filters are not JSON is refused', async ({ admin }) => {
    await setup(admin)
    await expectApiError(admin.get(`/api/table/${encodeURIComponent(DT)}:aggregate?filters=not-json`), {
      status: 400, type: 'BadRequestError', message: expect.stringContaining('filters must be valid JSON'),
    })
  })

  test('a count without a sum reports just the number of matching rows', async ({ admin }) => {
    await setup(admin)
    const res = await admin.get<{ count: number; sum: unknown }>(
      `/api/table/${encodeURIComponent(DT)}:aggregate?filters=${encodeURIComponent(JSON.stringify([['stage', '=', 'Open']]))}`,
    )
    expect(res.count).toBe(2)
    expect(res.sum).toBeNull()
  })

  test('a parent filter is refused on a Table that is not nested rows', async ({ admin }) => {
    await setup(admin)
    await orders(admin)
    await expectApiError(
      admin.get(listPath({ filters: JSON.stringify([['parent', 'related', { table: ORDER }]]) })),
      { status: 417 },
    )
    // And on nested rows, the named owner must actually hold them.
    await expectApiError(
      admin.get(
        `/api/table/${encodeURIComponent(LINE)}?filters=${encodeURIComponent(JSON.stringify([['parent', 'related', { table: DT }]]))}`,
      ),
      { status: 417 },
    )
  })
})
