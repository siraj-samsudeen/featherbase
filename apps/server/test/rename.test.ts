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
  await admin.post('/api/table_def', {
    name: CUST,
    id_pattern: 'prompt',
    columns: [{ column_name: 'city', column_type: 'Data' }],
  })
  await admin.post('/api/table_def', {
    name: ITEM,
    kind: 'sub_table',
    columns: [{ column_name: 'supplier', column_type: 'Reference', reference_table: CUST }],
  })
  await admin.post('/api/table_def', {
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
      row_id: 'Acme',
      city: 'NYC',
    })
    await admin.post('/api/save_row', {
      table: ORDER,
      row: {
        row_id: 'ORD-1',
        customer: 'Acme',
        lines: [{ supplier: 'Acme' }],
      },
    })

    const renamed = await admin.post<{ row_id: string }>(
      `/api/table/${encodeURIComponent(CUST)}/Acme:rename`,
      { new_name: 'Acme Corp' },
    )
    expect(renamed.row_id).toBe('Acme Corp')

    // Old name is gone, new name exists.
    expect(await sql`select 1 from featherbase.rn_customer where row_id = 'Acme'`).toHaveLength(0)
    expect(await sql`select 1 from featherbase.rn_customer where row_id = 'Acme Corp'`).toHaveLength(1)

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
      row_id: 'Acme Corp',
      city: 'NYC',
    })
    await admin.post('/api/table/' + encodeURIComponent(CUST), {
      row_id: 'Globex',
      city: 'LA',
    })
    await expect(
      admin.post(`/api/table/${encodeURIComponent(CUST)}/Globex:rename`, { new_name: 'Acme Corp' }),
    ).rejects.toMatchObject({ status: 409, type: 'ConflictError' })
    // Globex is untouched.
    expect(await sql`select 1 from featherbase.rn_customer where row_id = 'Globex'`).toHaveLength(1)
  })

  test('404s renaming a document that does not exist', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post(`/api/table/${encodeURIComponent(CUST)}/Nope:rename`, { new_name: 'Whatever' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('Rename a row and every link follows', () => {
  test("the row keeps its own values and nested rows under the new id", async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/table/' + encodeURIComponent(CUST), { row_id: 'Acme', city: 'NYC' })
    await admin.post('/api/save_row', {
      table: ORDER,
      row: { row_id: 'ORD-9', customer: 'Acme', lines: [{ supplier: 'Acme' }, { supplier: 'Acme' }] },
    })
    await admin.post(`/api/table/${encodeURIComponent(ORDER)}/ORD-9:rename`, { new_name: 'ORD-10' })
    const order = await admin.get<{ customer: string; lines: unknown[] }>(
      `/api/table/${encodeURIComponent(ORDER)}/ORD-10`,
    )
    expect(order.customer).toBe('Acme')
    expect(order.lines).toHaveLength(2)
    await expect(admin.get(`/api/table/${encodeURIComponent(ORDER)}/ORD-9`)).rejects.toMatchObject({ status: 404 })
  })

  // SPEC: See a row's whole history in order (comments-and-history) — suspected
  // defect, see report. Comments, change history, attachments and shares name
  // their row by id in plain text, and the rename cascade only follows link
  // columns, so a renamed row loses its own timeline.
  test.fails("a renamed row's comments and change history come with it", async ({ admin }) => {
    await setup(admin)
    const created = await admin.post<{ updated_at: string }>('/api/table/' + encodeURIComponent(CUST), {
      row_id: 'Acme',
      city: 'NYC',
    })
    await admin.post('/api/save_row', {
      table: CUST,
      row: { row_id: 'Acme', updated_at: created.updated_at, city: 'Boston' },
    })
    await admin.post('/api/save_row', {
      table: 'Comment',
      row: { ref_table: CUST, ref_name: 'Acme', content: 'called them today' },
    })
    const before = await admin.get<{ comments: unknown[]; versions: unknown[] }>(
      `/api/activity/${encodeURIComponent(CUST)}/Acme`,
    )
    expect(before.comments).toHaveLength(1)
    expect(before.versions).toHaveLength(1)

    await admin.post(`/api/table/${encodeURIComponent(CUST)}/Acme:rename`, { new_name: 'Acme Corp' })
    const after = await admin.get<{ comments: unknown[]; versions: unknown[] }>(
      `/api/activity/${encodeURIComponent(CUST)}/${encodeURIComponent('Acme Corp')}`,
    )
    expect(after.comments).toHaveLength(1)
    expect(after.versions).toHaveLength(1)
  })
})
