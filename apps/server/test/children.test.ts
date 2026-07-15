import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'

const CHILD = 'Chd Item Row'
const PARENT = 'Chd Order'
const CTABLE = 'tab_chd_item_row'
const PTABLE = 'tab_chd_order'

async function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const save = (doc: Record<string, unknown>) => post('/api/save_doc', { doctype: PARENT, doc })

beforeAll(async () => {
  await sql`delete from doctype where name in (${PARENT}, ${CHILD})`
  await sql.unsafe(`drop table if exists ${PTABLE}`)
  await sql.unsafe(`drop table if exists ${CTABLE}`)
  const c = await post('/api/doctype', {
    name: CHILD,
    istable: true,
    fields: [
      { fieldname: 'item', fieldtype: 'Data', reqd: true },
      { fieldname: 'qty', fieldtype: 'Int', default_value: '1' },
    ],
  })
  const p = await post('/api/doctype', {
    name: PARENT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'items', fieldtype: 'Table', options: CHILD },
    ],
  })
  if (c.status !== 201 || p.status !== 201) throw new Error('setup failed')
})

afterAll(async () => {
  await sql`delete from doctype where name in (${PARENT}, ${CHILD})`
  await sql.unsafe(`drop table if exists ${PTABLE}`)
  await sql.unsafe(`drop table if exists ${CTABLE}`)
  await sql.end()
})

describe('META-007: child table linkage', () => {
  it('rejects a Table field pointing at a non-child DocType', async () => {
    const res = await post('/api/doctype', {
      name: 'Chd Bad Parent',
      fields: [{ fieldname: 'rows', fieldtype: 'Table', options: PARENT }],
    })
    expect(res.status).toBe(417)
    expect((await res.json()).error.fields.rows).toMatch(/not a child DocType/)
  })

  it('saves child rows with parent linkage and idx ordering', async () => {
    const doc = (await (
      await save({
        title: 'order1',
        items: [{ item: 'apple', qty: 2 }, { item: 'pear' }, { item: 'fig', qty: 7 }],
      })
    ).json()) as Record<string, any>
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

  it('cannot save a child DocType directly', async () => {
    const res = await post('/api/save_doc', { doctype: CHILD, doc: { item: 'x' } })
    expect(res.status).toBe(417)
    expect((await res.json()).error.message).toMatch(/through its parent/)
  })
})

describe('DOC-005: child saves are atomic and payload-authoritative', () => {
  it('resave matches payload exactly: update kept row, drop others, add new', async () => {
    const doc = (await (
      await save({ title: 'o2', items: [{ item: 'a' }, { item: 'b' }, { item: 'c' }] })
    ).json()) as Record<string, any>
    const [rowA, , rowC] = doc.items
    const updated = (await (
      await save({
        name: doc.name,
        modified: doc.modified,
        items: [
          { name: rowC.name, item: 'c-edited', qty: 9 },
          { item: 'd' },
        ],
      })
    ).json()) as Record<string, any>
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

  it('a child validation error rolls back the parent too', async () => {
    const doc = (await (
      await save({ title: 'before', items: [{ item: 'ok' }] })
    ).json()) as Record<string, any>
    const res = await save({
      name: doc.name,
      modified: doc.modified,
      title: 'after',
      items: [{ item: 'ok' }, { qty: 'boom' }],
    })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields['items.1.item']).toBeTruthy()
    expect(body.error.fields['items.1.qty']).toBeTruthy()
    const [row] = await sql.unsafe(`select title from ${PTABLE} where name='${doc.name}'`)
    expect(row.title).toBe('before')
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from ${CTABLE} where parent='${doc.name}'`,
    )
    expect(count).toBe(1)
  })

  it('getDoc returns children ordered by idx', async () => {
    const doc = (await (
      await save({ title: 'o3', items: [{ item: 'z' }, { item: 'y' }] })
    ).json()) as Record<string, any>
    const read = (await (
      await app.request(`/api/doc/${encodeURIComponent(PARENT)}/${doc.name}`)
    ).json()) as Record<string, any>
    expect(read.items.map((r: any) => r.item)).toEqual(['z', 'y'])
  })
})
