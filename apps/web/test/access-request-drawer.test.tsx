// #1173: a System Manager acts on a waiting request from a drawer beside the
// Waiting for access list: approve with roles, decline with a reason, or
// dismiss. Made-up people only.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { requestAccess } from 'server/src/waiting-for-access'
import { test, expect, renderApp } from './pg-test'

async function waitingPerson(name: string, email: string, roles: string[] = []) {
  const { saveDoc } = await import('server/src/document')
  for (const role of roles) {
    const [have] = await sql`select 1 from role where row_id = ${role}`
    if (!have) await saveDoc('Role', { row_id: role }, 'Administrator')
  }
  const id = String((await saveDoc('Person', { full_name: name, email, enabled: true, roles: roles.map((role) => ({ role })) }, 'Administrator', 'insert')).row_id)
  await requestAccess(id, 'featherbase')
  return id
}

async function openDrawer(name: string) {
  const page = await screen.findByTestId('waiting-for-access')
  await waitFor(() => expect(page).toHaveTextContent(name))
  // The name opens the drawer, in place of the row's own page.
  await userEvent.click(within(page).getByRole('link', { name }))
  const drawer = await screen.findByTestId('access-request-drawer')
  await waitFor(() => expect(within(drawer).getByTestId('request-roles')).toBeInTheDocument())
  return drawer
}

test('a click on a line opens the drawer with who it is, what they asked for and the roles; the list stays', async ({ admin }) => {
  await waitingPerson('Asha Made-up', 'asha.made-up@staff.example.com', ['Tasker Member'])
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const drawer = await openDrawer('Asha Made-up')
  expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('Asha Made-up')
  expect(within(drawer).getByTestId('request-who')).toHaveTextContent('asha.made-up@staff.example.com')
  expect(within(drawer).getByTestId('request-asked')).toHaveTextContent(/Asked for Featherbase on \d{2}-[A-Z][a-z]{2}-\d{4}/)
  const tasker = within(drawer).getByRole('checkbox', { name: /Tasker Member/ })
  expect(tasker).toBeChecked()
  expect(tasker).toBeDisabled()
  expect(within(drawer).queryByRole('checkbox', { name: /^All$/ })).not.toBeInTheDocument()
  expect(within(drawer).getByTestId('request-approve')).toBeDisabled()
  expect(screen.getByTestId('list-view')).toBeInTheDocument()
  await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByTestId('access-request-drawer')).not.toBeInTheDocument())
})

test('a click on the line beside the name opens the drawer too, and a role everyone has reads so', async ({ admin }) => {
  await sql`insert into role (row_id, created_by, updated_by) values ('Dash Reader', 'Administrator', 'Administrator') on conflict do nothing`
  await admin.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: 'Dash Reader' } })
  await waitingPerson('Nila Made-up', 'nila.made-up@staff.example.com')
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const page = await screen.findByTestId('waiting-for-access')
  await waitFor(() => expect(page).toHaveTextContent('Nila Made-up'))
  await userEvent.click(within(page).getByText('nila.made-up@staff.example.com'))
  const drawer = await screen.findByTestId('access-request-drawer')
  const reader = await within(drawer).findByRole('checkbox', { name: /Dash Reader/ })
  expect(reader).toBeChecked()
  expect(reader).toBeDisabled()
  expect(reader.closest('label')).toHaveTextContent('Everyone has it')
})

test('approving with System Manager warns, asks to confirm, then gives it and the request leaves the list', async ({ admin }) => {
  const id = await waitingPerson('Ravi Made-up', 'ravi.made-up@staff.example.com')
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const drawer = await openDrawer('Ravi Made-up')
  await userEvent.click(within(drawer).getByRole('checkbox', { name: /System Manager/ }))
  expect(within(drawer).getByTestId('full-admin-warning')).toHaveTextContent('Gives full admin access')
  await userEvent.click(within(drawer).getByTestId('request-approve'))
  expect(within(drawer).getByTestId('full-admin-confirm')).toBeInTheDocument()
  expect(await sql`select 1 from has_role where parent = ${id}`).toHaveLength(0)
  await userEvent.click(within(drawer).getByRole('button', { name: 'Confirm and approve' }))
  expect(await screen.findByTestId('waiting-done')).toHaveTextContent('Access given to Ravi Made-up: System Manager')
  expect(screen.queryByTestId('access-request-drawer')).not.toBeInTheDocument()
  expect(await screen.findByTestId('waiting-empty')).toBeInTheDocument()
  expect((await sql`select role from has_role where parent = ${id}`).map((r) => r.role)).toEqual(['System Manager'])
})

test('a role that does not open what they asked for is given, and the drawer says so', async ({ admin }) => {
  await waitingPerson('Meena Made-up', 'meena.made-up@staff.example.com')
  await sql`insert into role (row_id, created_by, updated_by) values ('Master Data Editor', 'Administrator', 'Administrator') on conflict do nothing`
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const drawer = await openDrawer('Meena Made-up')
  await userEvent.click(within(drawer).getByRole('checkbox', { name: /Master Data Editor/ }))
  await userEvent.click(within(drawer).getByTestId('request-approve'))
  expect(await within(drawer).findByTestId('request-partly')).toHaveTextContent("Given: Master Data Editor. Given, but this doesn't open Featherbase yet.")
  await waitFor(() => expect(within(drawer).getByRole('checkbox', { name: /Master Data Editor/ })).toBeDisabled())
})

test('declining needs a reason, then the request moves to the Declined view with it', async ({ admin }) => {
  await waitingPerson('Kiran Made-up', 'kiran.made-up@staff.example.com')
  const app = await renderApp('/featherbase/admin/waiting-for-access', admin)
  const drawer = await openDrawer('Kiran Made-up')
  await userEvent.click(within(drawer).getByTestId('request-decline'))
  expect(within(drawer).getByTestId('decline-confirm')).toBeDisabled()
  await userEvent.type(within(drawer).getByTestId('decline-reason'), 'Not in head office')
  await userEvent.click(within(drawer).getByTestId('decline-confirm'))
  expect(await screen.findByTestId('waiting-done')).toHaveTextContent("Declined Kiran Made-up's request")
  expect(await screen.findByTestId('waiting-empty')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Declined' }))
  const page = screen.getByTestId('waiting-for-access')
  await waitFor(() => expect(page).toHaveTextContent('Kiran Made-up'))
  expect(page).toHaveTextContent('Not in head office')
  expect((app.router.state as { location: { search: { view?: string } } }).location.search.view).toBe('declined')
  const again = await openDrawer('Kiran Made-up')
  expect(within(again).getByTestId('request-declined')).toHaveTextContent('Not in head office')
  expect(within(again).queryByTestId('request-decline')).not.toBeInTheDocument()
})

test('dismissing removes the request', async ({ admin }) => {
  const id = await waitingPerson('Leela Made-up', 'leela.made-up@staff.example.com')
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const drawer = await openDrawer('Leela Made-up')
  await userEvent.click(within(drawer).getByTestId('request-dismiss'))
  expect(await sql`select 1 from access_request where person = ${id}`).toHaveLength(1)
  await userEvent.click(within(drawer).getByTestId('dismiss-confirm'))
  expect(await screen.findByTestId('waiting-done')).toHaveTextContent("Dismissed Leela Made-up's request")
  expect(await screen.findByTestId('waiting-empty')).toBeInTheDocument()
  expect(await sql`select 1 from access_request where person = ${id}`).toHaveLength(0)
})

test('someone declined is told so, without the reason', async ({ admin, createUser }) => {
  const priya = await createUser({ email: 'priya.declined@example.com', fullName: 'Priya Declined', roles: [] })
  await requestAccess(priya.user!, 'featherbase')
  const [row] = await sql`select row_id from access_request where person = ${priya.user!}`
  await admin.post(`/api/access_request/${row.row_id}/decline`, { reason: 'Secret reason' })
  await renderApp('/featherbase/admin', priya)
  const page = await screen.findByTestId('no-access')
  await waitFor(() => expect(page).toHaveTextContent('An admin declined your request. Ask your manager if you need it.'))
  expect(page).not.toHaveTextContent('Secret reason')
})
