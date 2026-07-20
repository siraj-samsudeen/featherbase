import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// WEB-002/003: a logged-in web-form submitter becomes the document's owner —
// closing the portal loop (their if_owner portal now shows what they filed).
// Anonymous submissions still create as Administrator.

const DT = 'Wf Owner Req'
const ROLE = 'Wf Owner Customer'
const ROUTE = 'wfown-request'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 'subject', fieldtype: 'Data', reqd: true }],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  // The customer role holds NO create DocPerm — the web form is the only door.
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: DT, role: ROLE, if_owner: true, can_read: true },
  })
  await admin.post('/api/save_doc', {
    doctype: 'Web Form',
    doc: {
      name: 'WfOwn Request Form',
      title: 'Request',
      route: ROUTE,
      document_type: DT,
      published: true,
      web_fields: JSON.stringify(['subject']),
    },
  })
}

describe('WEB-002/003: web-form owner attribution', () => {
  test('an anonymous submit creates as Administrator', async ({ admin, api }) => {
    await setup(admin)
    const res = await api.post<{ name: string }>(`/api/web_form/${ROUTE}`, {
      values: { subject: 'anon' },
    })
    const [row] = await sql`select owner from tab_wf_owner_req where name = ${res.name}`
    expect(row.owner).toBe('Administrator')
  })

  test('a logged-in submit is owned by the session user and visible in their portal list', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const cust = await createUser({ roles: [ROLE] })
    const res = await cust.post<{ name: string }>(`/api/web_form/${ROUTE}`, {
      values: { subject: 'mine' },
    })
    const [row] = await sql`select owner from tab_wf_owner_req where name = ${res.name}`
    expect(row.owner).toBe(cust.user)

    // The if_owner read grant now surfaces exactly this document.
    const list = await cust.get<{ data: { name: string }[]; total: number }>(
      `/api/resource/${encodeURIComponent(DT)}`,
    )
    expect(list.total).toBe(1)
    expect(list.data[0].name).toBe(res.name)
  })
})
