import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { registerController, unregisterController } from '../src/controllers'
import { grantRole, tableRef } from './fixtures'

const CHILD = 'Chd Item Row'
const PARENT = 'Chd Order'
const CTABLE = 'featherbase.chd_item_row'
const PTABLE = 'featherbase.chd_order'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: CHILD,
    kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', reqd: true },
      { column_name: 'qty', column_type: 'Int', default_value: '1' },
    ],
  })
  await admin.post('/api/table_def', {
    name: PARENT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'items', column_type: 'Sub-table', row_table: CHILD },
    ],
  })
}

const save = (admin: TestClient, row: Record<string, unknown>) =>
  admin.post<Record<string, any>>('/api/save_row', { table: PARENT, row })

describe('META-007: child table linkage', () => {
  test('rejects a Sub-table column pointing at a non-child Table', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/table_def', {
        name: 'Chd Bad Parent',
        columns: [{ column_name: 'rows', column_type: 'Sub-table', row_table: PARENT }],
      }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { rows: expect.stringMatching(/not a sub_table Table/) },
    })
  })

  test('saves child rows with parent linkage and position ordering', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, {
      title: 'order1',
      items: [{ item: 'apple', qty: 2 }, { item: 'pear' }, { item: 'fig', qty: 7 }],
    })
    expect(doc.items).toHaveLength(3)
    const rows = await sql.unsafe(
      `select item, qty, parent, parenttype, parentfield, position from ${CTABLE}
       where parent = '${doc.row_id}' order by position`,
    )
    expect(rows.map((r) => [r.item, Number(r.qty), r.position])).toEqual([
      ['apple', 2, 1],
      ['pear', 1, 2],
      ['fig', 7, 3],
    ])
    expect(rows[0].parenttype).toBe(PARENT)
    expect(rows[0].parentfield).toBe('items')
  })

  test('cannot save a child Table directly', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/save_row', { table: CHILD, row: { item: 'x' } }),
    ).rejects.toMatchObject({
      status: 417,
      message: expect.stringMatching(/through its parent/),
    })
  })

  test('a shared child list unions its parent read scopes within the caller filter', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const ownParent = 'Chd Own Order'
    await admin.post('/api/table_def', {
      name: ownParent,
      columns: [{ column_name: 'items', column_type: 'Sub-table', row_table: CHILD }],
    })
    const role = 'Chd Scoped Reader'
    await grantRole(admin, { role, table: [CHILD, PARENT], can_read: true })
    await grantRole(admin, {
      role, table: ownParent, can_read: true, can_create: true, own_rows_only: true,
    })
    const user = await createUser({ roles: [role] })
    type ChildRow = { row_id: string; item: string; qty: number }
    type ParentRow = { row_id: string; created_by: string; items: ChildRow[] }
    // Both readable branches have a row excluded by the caller filter. That
    // detects an unparenthesized OR regardless of metadata iteration order.
    const all = await admin.post<ParentRow>('/api/save_row', {
      table: PARENT,
      row: { items: [{ item: 'all-match', qty: 2 }, { item: 'all-filtered', qty: 1 }] },
    })
    const own = await user.post<ParentRow>('/api/save_row', {
      table: ownParent,
      row: { items: [{ item: 'own-match', qty: 3 }, { item: 'own-filtered', qty: 1 }] },
    })
    const denied = await admin.post<ParentRow>('/api/save_row', {
      table: ownParent,
      row: { items: [{ item: 'other-owner', qty: 4 }] },
    })
    expect(own.created_by).toBe(user.user)
    expect(all.created_by).not.toBe(user.user)
    expect(denied.created_by).not.toBe(user.user)

    const child = tableRef(CHILD)
    const query = {
      fields: ['row_id', 'item', 'qty'],
      filters: [['qty', '>=', 2]],
      order_by: 'item asc',
    }
    // The denied child genuinely exists and satisfies the caller filter.
    // Only its parent's own-rows scope should remove it from the user's list.
    const control = await admin.get<{ data: ChildRow[]; total: number }>(child.listUrl(query))
    expect({ data: control.data, total: control.total }).toEqual({
      data: [
        { row_id: all.items[0].row_id, item: 'all-match', qty: 2 },
        { row_id: denied.items[0].row_id, item: 'other-owner', qty: 4 },
        { row_id: own.items[0].row_id, item: 'own-match', qty: 3 },
      ],
      total: 3,
    })
    const result = await user.get<{ data: ChildRow[]; total: number }>(child.listUrl(query))
    expect({ data: result.data, total: result.total }).toEqual({
      data: [
        { row_id: all.items[0].row_id, item: 'all-match', qty: 2 },
        { row_id: own.items[0].row_id, item: 'own-match', qty: 3 },
      ],
      total: 2,
    })
  })
})

describe('DOC-005: child saves are atomic and payload-authoritative', () => {
  test('resave matches payload exactly: update kept row, drop others, add new', async ({
    admin,
  }) => {
    await setup(admin)
    const doc = await save(admin, {
      title: 'o2',
      items: [{ item: 'a' }, { item: 'b' }, { item: 'c' }],
    })
    const [rowA, , rowC] = doc.items
    const updated = await save(admin, {
      row_id: doc.row_id,
      updated_at: doc.updated_at,
      items: [
        { row_id: rowC.row_id, item: 'c-edited', qty: 9 },
        { item: 'd' },
      ],
    })
    expect(updated.items.map((r: any) => [r.item, r.position])).toEqual([
      ['c-edited', 1],
      ['d', 2],
    ])
    expect(updated.items[0].row_id).toBe(rowC.row_id)
    expect(updated.items.some((r: any) => r.row_id === rowA.row_id)).toBe(false)
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from ${CTABLE} where parent='${doc.row_id}'`,
    )
    expect(count).toBe(2)
  })

  test('a child validation error rolls back the parent too', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, { title: 'before', items: [{ item: 'ok' }] })
    await expect(
      save(admin, {
        row_id: doc.row_id,
        updated_at: doc.updated_at,
        title: 'after',
        items: [{ item: 'ok' }, { qty: 'boom' }],
      }),
    ).rejects.toMatchObject({
      status: 417,
      fields: {
        'items.1.item': expect.anything(),
        'items.1.qty': expect.anything(),
      },
    })
    const [row] = await sql.unsafe(`select title from ${PTABLE} where row_id='${doc.row_id}'`)
    expect(row.title).toBe('before')
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from ${CTABLE} where parent='${doc.row_id}'`,
    )
    expect(count).toBe(1)
  })

  test('getDoc returns children ordered by position', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, { title: 'o3', items: [{ item: 'z' }, { item: 'y' }] })
    const read = await admin.get<Record<string, any>>(
      `/api/table/${encodeURIComponent(PARENT)}/${doc.row_id}`,
    )
    expect(read.items.map((r: any) => r.item)).toEqual(['z', 'y'])
  })

  test('a hook may add or replace child rows; what it leaves on ctx.row is what saves', async ({
    admin,
  }) => {
    await setup(admin)
    // An app-style controller that seeds child rows on insert when the
    // payload brought none — the checklists app's template-snapshot shape.
    const controller = {
      table: PARENT,
      hooks: {
        before_validate: ({ row, isNew }: { row: Record<string, unknown>; isNew: boolean }) => {
          if (isNew && !(Array.isArray(row.items) && row.items.length))
            row.items = [{ item: 'seeded-1' }, { item: 'seeded-2', qty: 5 }]
        },
      },
    }
    registerController(controller)
    try {
      const doc = await save(admin, { title: 'hooked' })
      expect(doc.items.map((r: any) => [r.item, Number(r.qty)])).toEqual([
        ['seeded-1', 1],
        ['seeded-2', 5],
      ])
      // The update path re-picks from the hooked row too — but an absent key
      // still means "children untouched".
      const updated = await save(admin, {
        row_id: doc.row_id,
        updated_at: doc.updated_at,
        title: 'hooked-2',
      })
      expect(updated.items).toHaveLength(2)
    } finally {
      unregisterController(controller)
    }
  })
})

describe('#231: a reqd Sub-table column must hold at least one row', () => {
  // Owner ruling on the #231 investigation (defect, not accepted semantics):
  // `reqd: true` on a Sub-table column means the same thing it means on a
  // scalar column — a row cannot be created without it. tableSchemaToZod
  // still drops Sub-table columns from its shape (NO_VALUE_TYPES), and
  // pickFieldValues strips them before validateValues ever runs, so the rule
  // is enforced in document.ts's children handling (assertRequiredChildren),
  // where the child arrays actually are. The error is field-keyed under the
  // column name with the same `Required` message and the same envelope a
  // missing reqd scalar produces, so FormView renders it under the grid with
  // no client change.
  const REQ_PARENT = 'Rq231 Order'

  async function setupRequired(admin: TestClient) {
    await admin.post('/api/table_def', {
      name: 'Rq231 Item',
      kind: 'sub_table',
      columns: [{ column_name: 'item', column_type: 'Data', reqd: true }],
    })
    await admin.post('/api/table_def', {
      name: REQ_PARENT,
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'items', column_type: 'Sub-table', row_table: 'Rq231 Item', reqd: true },
      ],
    })
  }

  const saveReq = (admin: TestClient, row: Record<string, unknown>) =>
    admin.post<Record<string, any>>('/api/save_row', { table: REQ_PARENT, row })

  test('create is rejected when the reqd Sub-table is absent from the payload', async ({
    admin,
  }) => {
    await setupRequired(admin)
    await expect(saveReq(admin, { title: 'no items key at all' })).rejects.toMatchObject({
      status: 417,
      fields: { items: 'Required' },
    })
    const [{ count }] = await sql.unsafe(`select count(*)::int as count from featherbase.rq231_order`)
    expect(count).toBe(0)
  })

  test('create is rejected when the reqd Sub-table is present but empty', async ({ admin }) => {
    await setupRequired(admin)
    await expect(saveReq(admin, { title: 'empty items', items: [] })).rejects.toMatchObject({
      status: 417,
      fields: { items: 'Required' },
    })
    const [{ count }] = await sql.unsafe(`select count(*)::int as count from featherbase.rq231_order`)
    expect(count).toBe(0)
  })

  test('create succeeds with at least one row', async ({ admin }) => {
    await setupRequired(admin)
    const doc = await saveReq(admin, { title: 'ok', items: [{ item: 'apple' }] })
    expect(doc.row_id).toMatch(/^[1-9][0-9]*$/) // #855: new Tables number rows 1, 2, 3
    expect(doc.items.map((r: any) => r.item)).toEqual(['apple'])
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from featherbase.rq231_item where parent = '${doc.row_id}'`,
    )
    expect(count).toBe(1)
  })

  test('update with the key absent leaves the children untouched (mirrors scalar reqd)', async ({
    admin,
  }) => {
    await setupRequired(admin)
    const doc = await saveReq(admin, { title: 'ok', items: [{ item: 'apple' }] })
    const updated = await saveReq(admin, {
      row_id: doc.row_id,
      updated_at: doc.updated_at,
      title: 'retitled',
    })
    expect(updated.title).toBe('retitled')
    expect(updated.items.map((r: any) => r.item)).toEqual(['apple'])
  })

  test('update is rejected when the key is present but empty', async ({ admin }) => {
    await setupRequired(admin)
    const doc = await saveReq(admin, { title: 'ok', items: [{ item: 'apple' }] })
    await expect(
      saveReq(admin, {
        row_id: doc.row_id,
        updated_at: doc.updated_at,
        title: 'clearing the grid',
        items: [],
      }),
    ).rejects.toMatchObject({ status: 417, fields: { items: 'Required' } })
    // the whole save rolls back: title unchanged, the child row survives
    const [row] = await sql.unsafe(`select title from featherbase.rq231_order where row_id='${doc.row_id}'`)
    expect(row.title).toBe('ok')
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from featherbase.rq231_item where parent = '${doc.row_id}'`,
    )
    expect(count).toBe(1)
  })

  test('a non-reqd Sub-table still saves empty', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, { title: 'no lines', items: [] })
    expect(doc.items).toEqual([])
  })
})
