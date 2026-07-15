import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'

const DT = 'Doc Test Note'

beforeAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_doc_test_note')
  const res = await app.request('/api/doctype', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'qty', fieldtype: 'Int' },
      ],
    }),
  })
  if (res.status !== 201) throw new Error('setup failed')
})

afterAll(async () => {
  await sql`delete from doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_doc_test_note')
  await sql.end()
})

async function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('DOC-001: save_doc inserts through the Document engine', () => {
  it('inserts, auto-populates standard fields, and is readable back', async () => {
    const res = await post('/api/save_doc', {
      doctype: DT,
      doc: { title: 'hello', qty: 3 },
    })
    expect(res.status).toBe(201)
    const doc = (await res.json()) as Record<string, unknown>
    expect(doc.name).toBeTruthy()
    expect(doc.owner).toBe('Administrator')
    expect(doc.creation).toBeTruthy()
    expect(doc.modified).toBeTruthy()
    expect(doc.docstatus).toBe(0)
    expect(doc.title).toBe('hello')
    expect(doc.qty).toBe('3')

    const read = await app.request(`/api/doc/${encodeURIComponent(DT)}/${doc.name}`)
    expect(read.status).toBe(200)
    expect(((await read.json()) as Record<string, unknown>).title).toBe('hello')
  })

  it('rejects unknown fields with a field-wise error', async () => {
    const res = await post('/api/save_doc', {
      doctype: DT,
      doc: { title: 'x', nope: 1 },
    })
    expect(res.status).toBe(417)
    const body = await res.json()
    expect(body.error.fields.nope).toMatch(/Unknown field/)
  })

  it('404s for unknown doctype and unknown doc', async () => {
    expect((await post('/api/save_doc', { doctype: 'Missing DT', doc: {} })).status).toBe(404)
    expect((await app.request(`/api/doc/${encodeURIComponent(DT)}/zzz`)).status).toBe(404)
  })

  it('rejects malformed envelope', async () => {
    expect((await post('/api/save_doc', { doc: { a: 1 } })).status).toBe(417)
  })
})
