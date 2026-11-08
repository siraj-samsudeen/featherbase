// What the search bar shows a row-limited person whose Table's title column is
// restricted: the one row they may see, labelled by its ID, never its title.
// The search rules themselves are apps/server/test/global-search-permissions.test.ts.
import { fireEvent, screen, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

const TABLE = 'Gs Browser Customer'
const ROLE = 'Gs Browser Customer Role'
const ALICE_ID = 'gs-browser-visible-id'
const ALICE_SECRET = 'gs-browser-alice-secret'
const BOB_ID = 'bob-customer-id'

test('search shows only an allowed row ID and never its sensitive title', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', {
    name: TABLE,
    id_pattern: 'prompt',
    title_column: 'secret_name',
    columns: [{ column_name: 'secret_name', column_type: 'Data', tier: 'restricted' }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  const grant = (row: Record<string, unknown>) =>
    admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: TABLE, role: ROLE, ...row } })
  await grant({ operation: 'read', scope_mode: 'creator' })
  const basicCreate = await grant({ operation: 'create', scope_mode: 'creator' })
  // They can supply the sensitive title but cannot read it.
  await grant({ operation: 'create', column_rule: 'every', requires_permission: basicCreate.row_id })
  const alice = await createUser({ email: 'gs-browser-alice@example.com', roles: [ROLE] })
  const bob = await createUser({ email: 'gs-browser-bob@example.com', roles: [ROLE] })
  await alice.post(`/api/table/${encodeURIComponent(TABLE)}`, { row_id: ALICE_ID, secret_name: ALICE_SECRET })
  // Bob's title is Alice's ID: a title match she must not be shown.
  await bob.post(`/api/table/${encodeURIComponent(TABLE)}`, { row_id: BOB_ID, secret_name: ALICE_ID })

  await renderApp('/featherbase/admin', alice)
  const bar = await screen.findByLabelText('Search or type a command', {}, { timeout: 8000 })
  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: ALICE_ID } })
  const hit = await screen.findByTestId('awesomebar-doc')
  expect(screen.getAllByTestId('awesomebar-doc')).toHaveLength(1)
  expect(hit.textContent).toBe(`${ALICE_ID}row in ${TABLE}`)
  expect(within(hit).queryByText(new RegExp(ALICE_SECRET))).toBeNull()
  expect(hit.textContent).not.toContain(BOB_ID)
})
