import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { registerController, unregisterController } from '../src/controllers'

const CHILD = 'Chd Item Row'
const PARENT = 'Chd Order'
const CTABLE = 'chd_item_row'
const PTABLE = 'chd_order'

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
