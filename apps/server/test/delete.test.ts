import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

const CUSTOMER = 'Del Customer'
const INVOICE = 'Del Invoice'
const ROW = 'Del Line Row'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: CUSTOMER,
    autoname: 'prompt',
    fields: [{ fieldname: 'city', fieldtype: 'Data' }],
  })
  await admin.post('/api/doctype', {
    name: ROW,
    istable: true,
    fields: [{ fieldname: 'supplier', fieldtype: 'Link', options: CUSTOMER }],
  })
  await admin.post('/api/doctype', {
    name: INVOICE,
    fields: [
      { fieldname: 'customer', fieldtype: 'Link', options: CUSTOMER },
      { fieldname: 'lines', fieldtype: 'Table', options: ROW },
    ],
  })
  for (const n of ['Acme', 'Globex', 'Initech', 'Umbrella'])
    await admin.post('/api/save_doc', { doctype: CUSTOMER, doc: { name: n } })
}

const docPath = (dt: string, name: string) =>
  `/api/doc/${encodeURIComponent(dt)}/${encodeURIComponent(name)}`

describe('DOC-006: delete with referential integrity', () => {
  test('blocks deleting a doc linked from a parent field, naming the holder', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post('/api/save_doc', { doctype: INVOICE, doc: { customer: 'Acme' } })
    await expect(admin.delete(docPath(CUSTOMER, 'Acme'))).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining(INVOICE),
    })
  })

  test('blocks deleting a doc linked from a CHILD row, naming the parent doc', async ({
    admin,
  }) => {
    await setup(admin)
    const inv = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: INVOICE,
      doc: { lines: [{ supplier: 'Globex' }] },
    })
    await expect(admin.delete(docPath(CUSTOMER, 'Globex'))).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining(String(inv.name)),
    })
  })

  test('deletes an unlinked doc, and its own child rows with it', async ({ admin }) => {
    await setup(admin)
    await admin.delete(docPath(CUSTOMER, 'Initech'))
    const inv = await admin.post<Record<string, unknown>>('/api/save_doc', {
      doctype: INVOICE,
      doc: { lines: [{ supplier: 'Umbrella' }] },
    })
    // Unlink first by deleting the invoice, then the customer is deletable.
    await admin.delete(docPath(INVOICE, String(inv.name)))
    const [{ count }] = await sql.unsafe(
      `select count(*)::int as count from tab_del_line_row where parent='${inv.name}'`,
    )
    expect(count).toBe(0)
    await admin.delete(docPath(CUSTOMER, 'Umbrella'))
  })

  test('404s deleting a nonexistent doc; blocks direct child-row deletion', async ({
    admin,
  }) => {
    await setup(admin)
    await expect(admin.delete(docPath(CUSTOMER, 'Ghost'))).rejects.toMatchObject({
      status: 404,
    })
    await expect(admin.delete(docPath(ROW, 'whatever'))).rejects.toMatchObject({
      status: 417,
    })
  })
})
