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
// Person ids live in the `psn_` namespace (person-rename).
const CUST_A = 'psn_upncusta'
const CUST_B = 'psn_upncustb'

async function setup(admin: TestClient) {
  for (const u of [CUST_A, CUST_B])
    await sql`insert into person ${sql({
      row_id: u, created_by: 'Administrator', updated_by: 'Administrator', email: `${u.slice(4)}@x.com`, enabled: true,
    })}`
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'subject', column_type: 'Data' },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Person' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: DT, role: ROLE, can_read: true },
  })
  for (const [subject, customer] of [
    ['for A', CUST_A],
    ['for B', CUST_B],
    ['unlinked', null],
  ] as const)
    await admin.post('/api/save_row', { table: DT, row: { subject, customer } })
}

describe('PERM-005: NULL links pass Data Scope list narrowing', () => {
  test('the list shows in-scope and unlinked rows, hides out-of-scope rows', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const agent = await createUser({ roles: [ROLE] })
    // Restrict the agent to customer A (User values).
    await admin.post('/api/save_row', {
      table: 'Data Scope',
      row: { person: agent.user, allow_table: 'Person', for_value: CUST_A },
    })
    const body = await agent.get<{ data: { subject: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        JSON.stringify(['row_id', 'subject']),
      )}`,
    )
    const subjects = body.data.map((d) => d.subject).sort()
    expect(subjects).toEqual(['for A', 'unlinked'])
    expect(body.total).toBe(2)
  })
})
