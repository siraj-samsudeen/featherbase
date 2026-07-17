import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

const CHILD = 'Chd Item Row'
const PARENT = 'Chd Order'
const CTABLE = 'tab_chd_item_row'
const PTABLE = 'tab_chd_order'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: CHILD,
    istable: true,
    fields: [
      { fieldname: 'item', fieldtype: 'Data', reqd: true },
      { fieldname: 'qty', fieldtype: 'Int', default_value: '1' },
    ],
  })
  await admin.post('/api/doctype', {
    name: PARENT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'items', fieldtype: 'Table', options: CHILD },
    ],
  })
}

const save = (admin: TestClient, doc: Record<string, unknown>) =>
  admin.post<Record<string, any>>('/api/save_doc', { doctype: PARENT, doc })

describe('META-007: child table linkage', () => {
  test('rejects a Table field pointing at a non-child DocType', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/doctype', {
        name: 'Chd Bad Parent',
        fields: [{ fieldname: 'rows', fieldtype: 'Table', options: PARENT }],
      }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { rows: expect.stringMatching(/not a child DocType/) },
    })
  })

  test('saves child rows with parent linkage and idx ordering', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, {
      title: 'order1',
      items: [{ item: 'apple', qty: 2 }, { item: 'pear' }, { item: 'fig', qty: 7 }],
    })
    expect(doc.items).toHaveLength(3)
    const rows = await sql.unsafe(
      `select item, qty, parent, parenttype, parentfield, idx from ${CTABLE}
       where parent = '${doc.name}' order by idx`,
    )
    expect(rows.map((r) => [r.item, Number(r.qty), r.idx])).toEqual([
      ['apple', 2, 1],
      ['pear', 1, 2],
      ['fig', 7, 3],
    ])
    expect(rows[0].parenttype).toBe(PARENT)
    expect(rows[0].parentfield).toBe('items')
  })

  test('cannot save a child DocType directly', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/save_doc', { doctype: CHILD, doc: { item: 'x' } }),
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
      name: doc.name,
      modified: doc.modified,
      items: [
        { name: rowC.name, item: 'c-edited', qty: 9 },
        { item: 'd' },
      ],
    })
    expect(updated.items.map((r: any) => [r.item, r.idx])).toEqual([
      ['c-edited', 1],
      ['d', 2],
    ])
    expect(updated.items[0].name).toBe(rowC.name)
    expect(updated.items.some((r: any) => r.name === rowA.name)).toBe(false)
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from ${CTABLE} where parent='${doc.name}'`,
    )
    expect(count).toBe(2)
  })

  test('a child validation error rolls back the parent too', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, { title: 'before', items: [{ item: 'ok' }] })
    await expect(
      save(admin, {
        name: doc.name,
        modified: doc.modified,
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
    const [row] = await sql.unsafe(`select title from ${PTABLE} where name='${doc.name}'`)
    expect(row.title).toBe('before')
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from ${CTABLE} where parent='${doc.name}'`,
    )
    expect(count).toBe(1)
  })

  test('getDoc returns children ordered by idx', async ({ admin }) => {
    await setup(admin)
    const doc = await save(admin, { title: 'o3', items: [{ item: 'z' }, { item: 'y' }] })
    const read = await admin.get<Record<string, any>>(
      `/api/doc/${encodeURIComponent(PARENT)}/${doc.name}`,
    )
    expect(read.items.map((r: any) => r.item)).toEqual(['z', 'y'])
  })
})
