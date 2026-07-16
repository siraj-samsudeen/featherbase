import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

const DT = 'Sync Task'
const TABLE = 'tab_sync_task'

async function columns(): Promise<string[]> {
  const rows = await sql`
    select column_name from information_schema.columns where table_name = ${TABLE}`
  return rows.map((r) => r.column_name as string)
}

const baseFields = [
  { fieldname: 'title', fieldtype: 'Data', label: 'Title' },
  { fieldname: 'points', fieldtype: 'Int' },
]

beforeAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: baseFields }),
  })
  for (const t of ['a', 'b'])
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { title: t, points: 1 } }),
    })
})

afterAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await sql.end()
})

describe('META-004: schema sync', () => {
  it('adding a field creates the column; existing data untouched', async () => {
    const res = await areq(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [...baseFields, { fieldname: 'severity', fieldtype: 'Select', options: 'Low\nHigh' }],
      }),
    })
    expect(res.status).toBe(200)
    expect(await columns()).toContain('severity')
    const rows = await sql.unsafe(`select title, points from ${TABLE} order by title`)
    expect(rows.map((r) => [r.title, Number(r.points)])).toEqual([['a', 1], ['b', 1]])
    // new field usable immediately
    const save = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { title: 'c', severity: 'High' } }),
    })
    expect(save.status).toBe(201)
  })

  it('property edits (label, reqd) apply without touching the table', async () => {
    const res = await areq(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [
          { fieldname: 'title', fieldtype: 'Data', label: 'Headline', reqd: true },
          { fieldname: 'points', fieldtype: 'Int' },
          { fieldname: 'severity', fieldtype: 'Select', options: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = (await (await areq(`/api/meta/${encodeURIComponent(DT)}`)).json()) as {
      fields: { fieldname: string; label: string; reqd: boolean }[]
    }
    const title = meta.fields.find((f) => f.fieldname === 'title')!
    expect(title.label).toBe('Headline')
    expect(title.reqd).toBe(true)
    // reqd now enforced
    const bad = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { points: 5 } }),
    })
    expect(bad.status).toBe(417)
  })

  it('removing a field drops the docfield but NEVER the column without the flag', async () => {
    const res = await areq(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [
          { fieldname: 'title', fieldtype: 'Data', label: 'Headline', reqd: true },
          { fieldname: 'severity', fieldtype: 'Select', options: 'Low\nHigh' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const meta = (await (await areq(`/api/meta/${encodeURIComponent(DT)}`)).json()) as {
      fields: { fieldname: string }[]
    }
    expect(meta.fields.map((f) => f.fieldname)).not.toContain('points')
    expect(await columns()).toContain('points') // data retained
    const rows = await sql.unsafe(`select points from ${TABLE} where title='a'`)
    expect(Number(rows[0].points)).toBe(1)
  })

  it('drop_columns flag really drops; fieldtype changes are rejected', async () => {
    const drop = await areq(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        drop_columns: true,
        fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Headline', reqd: true }],
      }),
    })
    expect(drop.status).toBe(200)
    expect(await columns()).not.toContain('severity')

    const badType = await areq(`/api/doctype/${encodeURIComponent(DT)}`, {
      method: 'PUT',
      body: JSON.stringify({
        fields: [{ fieldname: 'title', fieldtype: 'Int' }],
      }),
    })
    expect(badType.status).toBe(417)
    expect((await badType.json()).error.fields.title).toMatch(/fieldtype cannot change/)
  })
})
