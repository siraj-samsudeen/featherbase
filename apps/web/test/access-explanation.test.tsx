// #628: "What can this person see, and why". The page lists a person's roles,
// the Tables they reach, the Data Scope rows that limit them and the rows
// shared with them, each with its reason, and never the data itself. It opens
// from the account menu and from a Person's row.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { rowHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 10_000 }
const pageOf = (person: string) => `/featherbase/account/access/${encodeURIComponent(person)}`

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { name: 'Ax Site', title_column: 'site_name', columns: [{ column_name: 'site_name', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Ax Site Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Ax Site', role: 'Ax Site Reader', can_read: true } })
  const north = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent('Ax Site')}`, { site_name: 'North' })
  return { north }
}

test('#628 a System Manager sees a person\'s roles, Tables, limits and shares, each with its reason', async ({ admin, createUser }) => {
  const { north } = await seed(admin)
  const person = await createUser({ roles: ['Ax Site Reader'], fullName: 'Ax Person' })
  await admin.post('/api/save_row', { table: 'Data Scope', row: { person: person.user, allow_table: 'Ax Site', for_value: north.row_id } })
  await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Ax Site', share_name: north.row_id, person: person.user, read: true, write: true } })

  await renderApp(pageOf(person.user!), admin)
  await waitFor(() => expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent('What Ax Person can see'), WAIT)
  const role = await screen.findByTestId('access-role', {}, WAIT)
  expect(role).toHaveTextContent(/Ax Site Reader — given by Administrator, /)
  expect(within(screen.getByTestId('access-read')).getAllByTestId('access-read-item').map((li) => li.textContent))
    .toContainEqual('Ax Site — through Ax Site Reader')
  expect(screen.getByTestId('access-limit')).toHaveTextContent(/Ax Site: North — set by Administrator, /)
  expect(screen.getByTestId('access-share')).toHaveTextContent(/Ax Site: North \(can change\) — shared by Administrator, /)
})

test('#628 the account menu opens your own page; an empty section says so', async ({ createUser }) => {
  const me = await createUser({ roles: [] })
  await renderApp('/featherbase/account/sign-in-methods', me)
  await userEvent.click(await screen.findByTestId('session-user', {}, WAIT))
  await userEvent.click(within(await screen.findByTestId('account-menu')).getByRole('menuitem', { name: 'What can I see?' }))
  await waitFor(() => expect(screen.getByTestId('access-explanation-heading')).toHaveTextContent('What you can see'), WAIT)
  expect(await screen.findByTestId('access-shares-empty', {}, WAIT)).toHaveTextContent('No rows are shared directly with them.')
  expect(screen.getByTestId('access-roles-empty')).toHaveTextContent('No roles of their own')
})

test('#628 a person limited to a row they cannot read sees its id, not its title', async ({ admin, createUser }) => {
  const { north } = await seed(admin)
  const me = await createUser({ roles: [] })
  await admin.post('/api/save_row', { table: 'Data Scope', row: { person: me.user, allow_table: 'Ax Site', for_value: north.row_id } })
  await renderApp(pageOf(me.user!), me)
  expect(await screen.findByTestId('access-limit', {}, WAIT)).toHaveTextContent(`Ax Site: ${north.row_id} — set by`)
  expect(screen.getByTestId('access-explanation')).not.toHaveTextContent('North')
})

test('#628 a colleague\'s page is refused', async ({ createUser }) => {
  const person = await createUser({ roles: [] })
  const colleague = await createUser({ roles: [] })
  await renderApp(pageOf(person.user!), colleague)
  expect(await screen.findByTestId('access-explanation-refused', {}, WAIT)).toHaveTextContent("You can't open this page")
  expect(screen.queryByTestId('access-roles')).not.toBeInTheDocument()
})

test('#628 a Person\'s row links to what they can see', async ({ admin, createUser }) => {
  const person = await createUser({ roles: [] })
  await renderApp(rowHref('Person', person.user!), admin)
  const link = await screen.findByRole('link', { name: 'What they can see' }, WAIT)
  expect(link).toHaveAttribute('href', pageOf(person.user!))
})
