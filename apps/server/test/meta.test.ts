import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { app } from '../src/index'

const DT = 'Meta Test Note'

beforeAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql`insert into tab_doctype (name, module, autoname) values (${DT}, 'Core', 'hash')`
  await sql`insert into tab_docfield (parent, idx, fieldname, label, fieldtype, reqd) values
    (${DT}, 1, 'title', 'Title', 'Data', true),
    (${DT}, 2, 'content', 'Content', 'Text', false)`
})

afterAll(async () => {
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.end()
})

describe('META-001: doctype/docfield storage and Meta loader', () => {
  it('loads a DocType definition inserted as rows into a Meta object', async () => {
    const meta = await getMeta(DT)
    expect(meta.name).toBe(DT)
    expect(meta.istable).toBe(false)
    expect(meta.fields).toHaveLength(2)
    expect(meta.fields[0]).toMatchObject({
      fieldname: 'title',
      fieldtype: 'Data',
      reqd: true,
      idx: 1,
    })
    expect(meta.fields[1].fieldname).toBe('content')
  })

  it('serves meta over HTTP', async () => {
    const res = await app.request(`/api/meta/${encodeURIComponent(DT)}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe(DT)
    expect(body.fields).toHaveLength(2)
  })

  it('404s for an unknown DocType with the error envelope', async () => {
    const res = await app.request('/api/meta/Nope')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.type).toBe('NotFoundError')
  })
})
