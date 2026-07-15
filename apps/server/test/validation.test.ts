import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'

const DT = 'Val Test Ticket'
const TABLE = 'tab_val_test_ticket'

async function save(doc: Record<string, unknown>) {
  return app.request('/api/save_doc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ doctype: DT, doc }),
  })
}

beforeAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await app.request('/api/doctype', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', reqd: true },
        { fieldname: 'qty', fieldtype: 'Int' },
        { fieldname: 'severity', fieldtype: 'Select', options: 'Low\nHigh' },
        { fieldname: 'due', fieldtype: 'Date' },
      ],
    }),
  })
})

afterAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await sql.end()
})

describe('DOC-011: field-wise validation errors', () => {
  it('returns BOTH errors keyed by fieldname for a doubly-invalid payload', async () => {
    const res = await save({ qty: 'not-a-number', due: '15-07-2026' })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.type).toBe('ValidationError')
    expect(Object.keys(body.error.fields).sort()).toEqual(['due', 'qty', 'title'])
    expect(body.error.fields.due).toMatch(/YYYY-MM-DD/)
  })

  it('missing required field errors by fieldname; valid doc saves with coercion', async () => {
    expect((await (await save({ qty: 2 })).json()).error.fields.title).toBeTruthy()
    const ok = (await (
      await save({ title: 'works', qty: '7', severity: 'High', due: '2026-08-01' })
    ).json()) as Record<string, unknown>
    expect(ok.qty).toBe('7')
    const [row] = await sql.unsafe(`select qty from ${TABLE} where name='${ok.name}'`)
    expect(Number(row.qty)).toBe(7)
  })
})

describe('META-009: Select validates against options', () => {
  it('rejects a value not in options, accepts a valid one, allows empty', async () => {
    const bad = await save({ title: 't', severity: 'Critical' })
    expect(bad.status).toBe(417)
    expect((await bad.json()).error.fields.severity).toBeTruthy()
    expect((await save({ title: 't', severity: 'Low' })).status).toBe(201)
    expect((await save({ title: 't' })).status).toBe(201)
  })

  it('validates on the update path too, partially', async () => {
    const doc = (await (await save({ title: 'u' })).json()) as Record<string, unknown>
    const bad = await save({ name: doc.name, modified: doc.modified, severity: 'Nope' })
    expect(bad.status).toBe(417)
    const ok = await save({ name: doc.name, modified: doc.modified, severity: 'High' })
    expect(ok.status).toBe(201)
    // update must not demand reqd fields it isn't changing
    const updated = (await ok.json()) as Record<string, unknown>
    expect(updated.title).toBe('u')
  })
})
