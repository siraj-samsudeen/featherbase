import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

const DT = 'Flag Test Asset'
const TABLE = 'tab_flag_test_asset'

async function save(doc: Record<string, unknown>) {
  return areq('/api/save_doc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ doctype: DT, doc }),
  })
}

beforeAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await areq('/api/doctype', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', reqd: true },
        { fieldname: 'code', fieldtype: 'Data', unique: true },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed', default_value: 'Open' },
        { fieldname: 'grade', fieldtype: 'Data', read_only: true, default_value: 'system' },
        { fieldname: 'count_val', fieldtype: 'Int' },
      ],
    }),
  })
})

afterAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe(`drop table if exists ${TABLE}`)
  await sql.end()
})

describe('META-010: field flags', () => {
  it('applies defaults on insert (including read_only defaults)', async () => {
    const doc = (await (await save({ title: 'a' })).json()) as Record<string, unknown>
    expect(doc.status).toBe('Open')
    expect(doc.grade).toBe('system')
  })

  it('ignores client-sent values for read_only fields on insert and update', async () => {
    const doc = (await (
      await save({ title: 'b', grade: 'hacked' })
    ).json()) as Record<string, unknown>
    expect(doc.grade).toBe('system')

    const upd = (await (
      await save({ name: doc.name, modified: doc.modified, grade: 'hacked again', title: 'b2' })
    ).json()) as Record<string, unknown>
    expect(upd.title).toBe('b2')
    expect(upd.grade).toBe('system')
  })

  it('maps unique violations to field-wise 417s, not 500s', async () => {
    expect((await save({ title: 'c1', code: 'DUP' })).status).toBe(201)
    const res = await save({ title: 'c2', code: 'DUP' })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.code).toMatch(/unique/)
  })

  it('missing reqd still fails; explicit default override works', async () => {
    expect((await save({ code: 'x' })).status).toBe(417)
    const doc = (await (
      await save({ title: 'd', status: 'Closed' })
    ).json()) as Record<string, unknown>
    expect(doc.status).toBe('Closed')
  })

  it('evaluator regression: out-of-range Int returns 417, not 500', async () => {
    const res = await save({ title: 'e', count_val: 99999999999999999999 })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.count_val).toMatch(/out of range/)
  })
})
