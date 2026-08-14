import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// WEB-002/003: a logged-in web-form submitter becomes the document's
// created_by — closing the portal loop (their own_rows_only portal now shows
// what they filed). Anonymous submissions still create as Administrator.

const DT = 'Wf Owner Req'
const ROLE = 'Wf Owner Customer'
const ROUTE = 'wfown-request'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'subject', column_type: 'Data', reqd: true }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  // The customer role holds NO create Permission — the web form is the only door.
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: DT, role: ROLE, own_rows_only: true, can_read: true },
  })
  await admin.post('/api/save_row', {
    table: 'Web Form',
    row: {
      row_id: 'WfOwn Request Form',
      title: 'Request',
      route: ROUTE,
      ref_table: DT,
      published: true,
      web_fields: JSON.stringify(['subject']),
    },
  })
}

describe('WEB-002/003: web-form owner attribution', () => {
  test('an anonymous submit creates as Administrator', async ({ admin, api }) => {
    await setup(admin)
    const res = await api.post<{ row_id: string }>(`/api/web_form/${ROUTE}`, {
      values: { subject: 'anon' },
    })
    const [row] = await sql`select created_by from wf_owner_req where row_id = ${res.row_id}`
    expect(row.created_by).toBe('Administrator')
  })

  test('a logged-in submit is owned by the session user and visible in their portal list', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const cust = await createUser({ roles: [ROLE] })
    const res = await cust.post<{ row_id: string }>(`/api/web_form/${ROUTE}`, {
      values: { subject: 'mine' },
    })
    const [row] = await sql`select created_by from wf_owner_req where row_id = ${res.row_id}`
    expect(row.created_by).toBe(cust.user)

    // The own_rows_only read grant now surfaces exactly this document.
    const list = await cust.get<{ data: { row_id: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(DT)}`,
    )
    expect(list.total).toBe(1)
    expect(list.data[0].row_id).toBe(res.row_id)
  })
})
