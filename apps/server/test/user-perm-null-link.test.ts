import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// PERM-005 regression: a Data Scope narrows lists by every Reference column
// pointing at the restricted Table, but a row whose reference is UNSET must
// still be visible — plain `IN` excludes NULLs, which used to empty out
// lists (and disagreed with the detail-read check, which passes null values).

const DT = 'Upn Ticket'
const ROLE = 'Upn Agent'
const CUST_A = 'upn-cust-a@x.com'
const CUST_B = 'upn-cust-b@x.com'

async function setup(admin: TestClient) {
  for (const u of [CUST_A, CUST_B])
    await sql`insert into "user" ${sql({
      name: u, created_by: 'Administrator', updated_by: 'Administrator', email: u, enabled: true,
    })}`
  await admin.post('/api/doctype', {
    name: DT,
    columns: [
      { column_name: 'subject', column_type: 'Data' },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'User' },
    ],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  await admin.post('/api/save_doc', {
    doctype: 'Permission',
    doc: { ref_table: DT, role: ROLE, can_read: true },
  })
  for (const [subject, customer] of [
    ['for A', CUST_A],
    ['for B', CUST_B],
    ['unlinked', null],
  ] as const)
    await admin.post('/api/save_doc', { doctype: DT, doc: { subject, customer } })
}

describe('PERM-005: NULL links pass Data Scope list narrowing', () => {
  test('the list shows in-scope and unlinked rows, hides out-of-scope rows', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const agent = await createUser({ roles: [ROLE] })
    // Restrict the agent to customer A (User values).
    await admin.post('/api/save_doc', {
      doctype: 'Data Scope',
      doc: { user: agent.user, allow_table: 'User', for_value: CUST_A },
    })
    const body = await agent.get<{ data: { subject: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        JSON.stringify(['name', 'subject']),
      )}`,
    )
    const subjects = body.data.map((d) => d.subject).sort()
    expect(subjects).toEqual(['for A', 'unlinked'])
    expect(body.total).toBe(2)
  })
})
