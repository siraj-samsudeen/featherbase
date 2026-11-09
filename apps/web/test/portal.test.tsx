// WEB-003: the customer portal. A website user whose role reads only the rows
// they created sees only their own tickets, and another person's ticket is
// refused. The API scoping itself is apps/server/test/webform-owner.test.ts.
import { tableSlug } from 'shared'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
type CreateUser = (o: { email?: string; roles?: string[] }) => Promise<Admin>
const DT = 'Portal Ticket'
const ROLE = 'Portal User'
const ALICE = 'portal-alice@x.com'
const base = `/featherbase/portal/${encodeURIComponent(tableSlug(DT))}`

async function seed(admin: Admin, createUser: CreateUser) {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'subject', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  for (const operation of ['read', 'update', 'create'])
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation, scope_mode: 'creator' } })
  const alice = await createUser({ email: ALICE, roles: [ROLE] })
  const bob = await createUser({ email: 'portal-bob@x.com', roles: [ROLE] })
  await alice.post(`/api/table/${encodeURIComponent(DT)}`, { subject: 'Alice cannot log in' })
  const bobs = await bob.post<{ row_id: string }>(`/api/table/${encodeURIComponent(DT)}`, { subject: 'Bob billing question' })
  return { alice, bob, bobDoc: bobs.row_id }
}

test('WEB-003: a portal user sees only their own tickets', async ({ admin, createUser }) => {
  const { alice } = await seed(admin, createUser)
  // The stored profile a password sign-in leaves.
  await renderApp(base, alice, { user: { row_id: alice.user!, email: ALICE } })
  expect(await screen.findByTestId('portal-title', {}, { timeout: 8000 })).toHaveTextContent(DT)
  const list = await screen.findByTestId('portal-list')
  await within(list).findByText('Alice cannot log in')
  expect(list).not.toHaveTextContent('Bob billing question')
  expect(screen.getAllByTestId('portal-row')).toHaveLength(1)
  // #489: who is signed in is in the top bar's Account menu.
  await userEvent.click(screen.getByTestId('session-user'))
  expect(await screen.findByTestId('account-identity')).toHaveTextContent(ALICE)
})

test("WEB-003: opening another user's ticket is refused", async ({ admin, createUser }) => {
  const { alice, bobDoc } = await seed(admin, createUser)
  await renderApp(`${base}/${encodeURIComponent(bobDoc)}`, alice)
  expect(await screen.findByTestId('portal-forbidden', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('portal-doc')).not.toBeInTheDocument()
})

test('WEB-003: the owner opens their own ticket', async ({ admin, createUser }) => {
  const { bob, bobDoc } = await seed(admin, createUser)
  await renderApp(`${base}/${encodeURIComponent(bobDoc)}`, bob)
  expect(await screen.findByTestId('portal-doc', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(await screen.findByTestId('portal-field-subject')).toHaveTextContent('Bob billing question')
})
