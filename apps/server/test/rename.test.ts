import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// DOC-012: rename a Customer; documents that linked to the old name now
// point at the new name — parent Link fields and child-table Link fields.

const CUST = 'Rn Customer'
const ORDER = 'Rn Order'
const ITEM = 'Rn Order Item'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: CUST,
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data' }],
  })
  await admin.post('/api/doctype', {
    name: ITEM,
    kind: 'sub_table',
    columns: [{ column_name: 'supplier', column_type: 'Reference', reference_table: CUST }],
  })
  await admin.post('/api/doctype', {
    name: ORDER,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'customer', column_type: 'Reference', reference_table: CUST },
      { column_name: 'lines', column_type: 'Sub-table', row_table: ITEM },
    ],
  })
}

describe('DOC-012: rename document + cascade Link references', () => {
  test('updates the primary key and every Link that referenced the old name', async ({
    admin,
  }) => {
    await setup(admin)
    await admin.post('/api/table/' + encodeURIComponent(CUST), {
      name: 'Acme',
      city: 'NYC',
    })
    await admin.post('/api/save_doc', {
      doctype: ORDER,
      doc: {
        name: 'ORD-1',
        customer: 'Acme',
        lines: [{ supplier: 'Acme' }],
      },
    })

    const renamed = await admin.post<{ row_id: string }>(
      `/api/table/${encodeURIComponent(CUST)}/Acme:rename`,
      { new_name: 'Acme Corp' },
    )
    expect(renamed.name).toBe('Acme Corp')

    // Old name is gone, new name exists.
    expect(await sql`select 1 from rn_customer where name = 'Acme'`).toHaveLength(0)
    expect(await sql`select 1 from rn_customer where name = 'Acme Corp'`).toHaveLength(1)

    // Parent Link field updated.
    const order = await admin.get<{ customer: string; lines: { supplier: string }[] }>(
      `/api/table/${encodeURIComponent(ORDER)}/ORD-1`,
    )
    expect(order.customer).toBe('Acme Corp')
    // Child-table Link field updated.
    expect(order.lines[0].supplier).toBe('Acme Corp')
  })

  test('rejects a rename that collides with an existing name', async ({ admin }) => {
    await setup(admin)
    // The colliding target must exist in THIS test's transaction.
    await admin.post('/api/table/' + encodeURIComponent(CUST), {
      name: 'Acme Corp',
      city: 'NYC',
    })
    await admin.post('/api/table/' + encodeURIComponent(CUST), {
      name: 'Globex',
      city: 'LA',
    })
    await expect(
      admin.post(`/api/table/${encodeURIComponent(CUST)}/Globex:rename`, { new_name: 'Acme Corp' }),
    ).rejects.toMatchObject({ status: 409, type: 'ConflictError' })
    // Globex is untouched.
    expect(await sql`select 1 from rn_customer where name = 'Globex'`).toHaveLength(1)
  })

  test('404s renaming a document that does not exist', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post(`/api/table/${encodeURIComponent(CUST)}/Nope:rename`, { new_name: 'Whatever' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
