import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { makeTable } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

const CUSTOMER = 'Lnk Customer'
const TICKET = 'Lnk Ticket'
const ROW = 'Lnk Alloc Row'

async function setup(admin: TestClient) {
  await makeTable(admin, { name: CUSTOMER, id_pattern: 'prompt', columns: ['city'] })
  await makeTable(admin, {
    name: ROW,
    kind: 'sub_table',
    columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: CUSTOMER }],
  })
  await makeTable(admin, {
    name: TICKET,
    columns: [
      { column_name: 'customer', column_type: 'Reference', reference_table: CUSTOMER },
      { column_name: 'allocs', column_type: 'Sub-table', row_table: ROW },
    ],
  })
  await admin.post('/api/save_row', { table: CUSTOMER, row: { row_id: 'Acme', city: 'Pune' } })
}

describe('META-008: Link integrity', () => {
  test('rejects a bogus link with a field-level error; accepts a valid one', async ({
    admin,
  }) => {
    await setup(admin)
    await expect(
      admin.post('/api/save_row', { table: TICKET, row: { customer: 'Ghost Corp' } }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { customer: expect.stringMatching(/does not exist/) },
    })

    await admin.post('/api/save_row', { table: TICKET, row: { customer: 'Acme' } })
  })

  test('validates links on update and inside child rows', async ({ admin }) => {
    await setup(admin)
    const doc = await admin.post<Record<string, any>>('/api/save_row', {
      table: TICKET,
      row: { customer: 'Acme' },
    })

    await expect(
      admin.post('/api/save_row', {
        table: TICKET,
        row: { row_id: doc.row_id, updated_at: doc.updated_at, customer: 'Nobody' },
      }),
    ).rejects.toMatchObject({ status: 417 })

    await expect(
      admin.post('/api/save_row', {
        table: TICKET,
        row: {
          row_id: doc.row_id,
          updated_at: doc.updated_at,
          allocs: [{ customer: 'Acme' }, { customer: 'Ghost' }],
        },
      }),
    ).rejects.toMatchObject({
      status: 417,
      fields: { 'allocs.1.customer': expect.stringMatching(/does not exist/) },
    })

    await admin.post('/api/save_row', {
      table: TICKET,
      row: { row_id: doc.row_id, updated_at: doc.updated_at, allocs: [{ customer: 'Acme' }] },
    })
  })

  test('allows empty link values', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: TICKET, row: {} })
  })
})
