import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// PERM-005 regression: a User Permission narrows lists by every Link field
// pointing at the restricted DocType, but a row whose link is UNSET must still
// be visible — plain `IN` excludes NULLs, which used to empty out lists (and
// disagreed with the detail-read check, which passes null values).

const DT = 'Upn Ticket'
const ROLE = 'Upn Agent'
const CUST_A = 'upn-cust-a@x.com'
const CUST_B = 'upn-cust-b@x.com'

async function setup(admin: TestClient) {
  for (const u of [CUST_A, CUST_B])
    await sql`insert into tab_user ${sql({
      name: u, owner: 'Administrator', modified_by: 'Administrator', email: u, enabled: true,
    })}`
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'subject', fieldtype: 'Data' },
      { fieldname: 'customer', fieldtype: 'Link', options: 'User' },
    ],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: DT, role: ROLE, can_read: true },
  })
  for (const [subject, customer] of [
    ['for A', CUST_A],
    ['for B', CUST_B],
    ['unlinked', null],
  ] as const)
    await admin.post('/api/save_doc', { doctype: DT, doc: { subject, customer } })
}

describe('PERM-005: NULL links pass user-permission list narrowing', () => {
  test('the list shows in-scope and unlinked rows, hides out-of-scope rows', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const agent = await createUser({ roles: [ROLE] })
    // Restrict the agent to customer A (User values).
    await admin.post('/api/save_doc', {
      doctype: 'User Permission',
      doc: { user: agent.user, allow: 'User', for_value: CUST_A },
    })
    const body = await agent.get<{ data: { subject: string }[]; total: number }>(
      `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        JSON.stringify(['name', 'subject']),
      )}`,
    )
    const subjects = body.data.map((d) => d.subject).sort()
    expect(subjects).toEqual(['for A', 'unlinked'])
    expect(body.total).toBe(2)
  })
})
