import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

const CUSTOMER = 'Lnk Customer'
const TICKET = 'Lnk Ticket'
const ROW = 'Lnk Alloc Row'

async function post(path: string, body: unknown) {
  return areq(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function cleanup() {
  await sql`delete from tab_doctype where name in (${CUSTOMER}, ${TICKET}, ${ROW})`
  await sql.unsafe('drop table if exists tab_lnk_ticket')
  await sql.unsafe('drop table if exists tab_lnk_alloc_row')
  await sql.unsafe('drop table if exists tab_lnk_customer')
}

beforeAll(async () => {
  await cleanup()
  await post('/api/doctype', {
    name: CUSTOMER,
    autoname: 'prompt',
    fields: [{ fieldname: 'city', fieldtype: 'Data' }],
  })
  await post('/api/doctype', {
    name: ROW,
    istable: true,
    fields: [{ fieldname: 'customer', fieldtype: 'Link', options: CUSTOMER }],
  })
  await post('/api/doctype', {
    name: TICKET,
    fields: [
      { fieldname: 'customer', fieldtype: 'Link', options: CUSTOMER },
      { fieldname: 'allocs', fieldtype: 'Table', options: ROW },
    ],
  })
  await post('/api/save_doc', { doctype: CUSTOMER, doc: { name: 'Acme', city: 'Pune' } })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('META-008: Link integrity', () => {
  it('rejects a bogus link with a field-level error; accepts a valid one', async () => {
    const bad = await post('/api/save_doc', {
      doctype: TICKET,
      doc: { customer: 'Ghost Corp' },
    })
    expect(bad.status).toBe(417)
    expect((await bad.json()).error.fields.customer).toMatch(/does not exist/)

    const ok = await post('/api/save_doc', { doctype: TICKET, doc: { customer: 'Acme' } })
    expect(ok.status).toBe(201)
  })

  it('validates links on update and inside child rows', async () => {
    const doc = (await (
      await post('/api/save_doc', { doctype: TICKET, doc: { customer: 'Acme' } })
    ).json()) as Record<string, any>

    const badUpd = await post('/api/save_doc', {
      doctype: TICKET,
      doc: { name: doc.name, modified: doc.modified, customer: 'Nobody' },
    })
    expect(badUpd.status).toBe(417)

    const badChild = await post('/api/save_doc', {
      doctype: TICKET,
      doc: {
        name: doc.name,
        modified: doc.modified,
        allocs: [{ customer: 'Acme' }, { customer: 'Ghost' }],
      },
    })
    expect(badChild.status).toBe(417)
    expect((await badChild.json()).error.fields['allocs.1.customer']).toMatch(/does not exist/)

    const okChild = await post('/api/save_doc', {
      doctype: TICKET,
      doc: { name: doc.name, modified: doc.modified, allocs: [{ customer: 'Acme' }] },
    })
    expect(okChild.status).toBe(201)
  })

  it('allows empty link values', async () => {
    expect((await post('/api/save_doc', { doctype: TICKET, doc: {} })).status).toBe(201)
  })
})
