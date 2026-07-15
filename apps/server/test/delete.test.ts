import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'

const CUSTOMER = 'Del Customer'
const INVOICE = 'Del Invoice'
const ROW = 'Del Line Row'

async function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const del = (dt: string, name: string) =>
  app.request(`/api/doc/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`, { method: 'DELETE' })

async function cleanup() {
  await sql`delete from tab_doctype where name in (${CUSTOMER}, ${INVOICE}, ${ROW})`
  await sql.unsafe('drop table if exists tab_del_invoice')
  await sql.unsafe('drop table if exists tab_del_line_row')
  await sql.unsafe('drop table if exists tab_del_customer')
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
    fields: [{ fieldname: 'supplier', fieldtype: 'Link', options: CUSTOMER }],
  })
  await post('/api/doctype', {
    name: INVOICE,
    fields: [
      { fieldname: 'customer', fieldtype: 'Link', options: CUSTOMER },
      { fieldname: 'lines', fieldtype: 'Table', options: ROW },
    ],
  })
  for (const n of ['Acme', 'Globex', 'Initech', 'Umbrella'])
    await post('/api/save_doc', { doctype: CUSTOMER, doc: { name: n } })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('DOC-006: delete with referential integrity', () => {
  it('blocks deleting a doc linked from a parent field, naming the holder', async () => {
    await post('/api/save_doc', { doctype: INVOICE, doc: { customer: 'Acme' } })
    const res = await del(CUSTOMER, 'Acme')
    expect(res.status).toBe(417)
    expect((await res.json()).error.message).toContain(INVOICE)
  })

  it('blocks deleting a doc linked from a CHILD row, naming the parent doc', async () => {
    const inv = (await (
      await post('/api/save_doc', {
        doctype: INVOICE,
        doc: { lines: [{ supplier: 'Globex' }] },
      })
    ).json()) as Record<string, unknown>
    const res = await del(CUSTOMER, 'Globex')
    expect(res.status).toBe(417)
    expect((await res.json()).error.message).toContain(String(inv.name))
  })

  it('deletes an unlinked doc, and its own child rows with it', async () => {
    expect((await del(CUSTOMER, 'Initech')).status).toBe(200)
    const inv = (await (
      await post('/api/save_doc', {
        doctype: INVOICE,
        doc: { lines: [{ supplier: 'Umbrella' }] },
      })
    ).json()) as Record<string, unknown>
    // Unlink first by deleting the invoice, then the customer is deletable.
    expect((await del(INVOICE, String(inv.name))).status).toBe(200)
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from tab_del_line_row where parent='${inv.name}'`,
    )
    expect(count).toBe(0)
    expect((await del(CUSTOMER, 'Umbrella')).status).toBe(200)
  })

  it('404s deleting a nonexistent doc; blocks direct child-row deletion', async () => {
    expect((await del(CUSTOMER, 'Ghost')).status).toBe(404)
    expect((await del(ROW, 'whatever')).status).toBe(417)
  })
})
