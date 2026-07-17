import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'

// DOC-012: rename a Customer; documents that linked to the old name now
// point at the new name — parent Link fields and child-table Link fields.

const CUST = 'Rn Customer'
const ORDER = 'Rn Order'
const ITEM = 'Rn Order Item'

async function cleanup() {
  for (const dt of [CUST, ORDER, ITEM])
    await sql`delete from tab_docfield where parent = ${dt}`
  await sql`delete from tab_doctype where name in (${CUST}, ${ORDER}, ${ITEM})`
  await sql.unsafe('drop table if exists tab_rn_customer, tab_rn_order, tab_rn_order_item')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: CUST,
      autoname: 'prompt',
      fields: [{ fieldname: 'city', fieldtype: 'Data' }],
    }),
  })
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: ITEM,
      istable: true,
      fields: [{ fieldname: 'supplier', fieldtype: 'Link', options: CUST }],
    }),
  })
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: ORDER,
      autoname: 'prompt',
      fields: [
        { fieldname: 'customer', fieldtype: 'Link', options: CUST },
        { fieldname: 'lines', fieldtype: 'Table', options: ITEM },
      ],
    }),
  })
})

afterAll(cleanup)

describe('DOC-012: rename document + cascade Link references', () => {
  it('updates the primary key and every Link that referenced the old name', async () => {
    await areq('/api/resource/' + encodeURIComponent(CUST), {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme', city: 'NYC' }),
    })
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: ORDER,
        doc: {
          name: 'ORD-1',
          customer: 'Acme',
          lines: [{ supplier: 'Acme' }],
        },
      }),
    })

    const res = await areq('/api/rename_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: CUST, name: 'Acme', new_name: 'Acme Corp' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { name: string }).name).toBe('Acme Corp')

    // Old name is gone, new name exists.
    expect(await sql`select 1 from tab_rn_customer where name = 'Acme'`).toHaveLength(0)
    expect(await sql`select 1 from tab_rn_customer where name = 'Acme Corp'`).toHaveLength(1)

    // Parent Link field updated.
    const order = (await (await areq(`/api/resource/${encodeURIComponent(ORDER)}/ORD-1`)).json()) as {
      customer: string
      lines: { supplier: string }[]
    }
    expect(order.customer).toBe('Acme Corp')
    // Child-table Link field updated.
    expect(order.lines[0].supplier).toBe('Acme Corp')
  })

  it('rejects a rename that collides with an existing name', async () => {
    await areq('/api/resource/' + encodeURIComponent(CUST), {
      method: 'POST',
      body: JSON.stringify({ name: 'Globex', city: 'LA' }),
    })
    const res = await areq('/api/rename_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: CUST, name: 'Globex', new_name: 'Acme Corp' }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe('ConflictError')
    // Globex is untouched.
    expect(await sql`select 1 from tab_rn_customer where name = 'Globex'`).toHaveLength(1)
  })

  it('404s renaming a document that does not exist', async () => {
    const res = await areq('/api/rename_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: CUST, name: 'Nope', new_name: 'Whatever' }),
    })
    expect(res.status).toBe(404)
  })
})
