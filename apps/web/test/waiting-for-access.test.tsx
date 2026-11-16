// #429, #835, #955: System Managers see who is waiting for access, per app,
// from a nav item with a count, as the standard Access Request list. Someone
// who opens Featherbase without access is told an admin has been told.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { requestAccess } from 'server/src/waiting-for-access'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

afterEach(() => vi.restoreAllMocks())

async function waitingPerson(name: string, email: string, app = 'featherbase') {
  const { saveDoc } = await import('server/src/document')
  const id = String((await saveDoc('Person', { full_name: name, email, enabled: true }, 'Administrator', 'insert')).row_id)
  await requestAccess(id, app)
  return id
}

test('a System Manager sees the count and the list, with the App, and opens a request', async ({ admin }) => {
  await waitingPerson('Waiting Person', 'waiting.person@staff.example.com')
  await waitingPerson('Second Person', 'second.person@staff.example.com', 'dash')
  await renderApp('/featherbase/admin/waiting-for-access', admin)

  const link = await screen.findByTestId('waiting-for-access-link')
  await waitFor(() => expect(within(link).getByTestId('waiting-for-access-count')).toHaveTextContent('2'))

  const page = await screen.findByTestId('waiting-for-access')
  // The standard list, under the page's own name, with the full address and the App.
  expect(await within(page).findByTestId('list-view')).toBeInTheDocument()
  expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Waiting for access')
  await waitFor(() => expect(within(page).getByTestId('list-total')).toHaveTextContent('2 total'))
  expect(page).toHaveTextContent('waiting.person@staff.example.com')
  await waitFor(() => expect(page).toHaveTextContent('Waiting Person'))
  expect(page).toHaveTextContent('Dash')
  expect(page).toHaveTextContent('Featherbase')
  expect(page.textContent).not.toMatch(/psn_[a-z2-7]{20}/)
  // A list's own tools: filters and column choice.
  expect(within(page).getByTestId('list-columns')).toBeInTheDocument()
  // #1173: the name opens the request in a drawer beside the list.
  await userEvent.click(await within(page).findByRole('link', { name: 'Waiting Person' }))
  const drawer = await screen.findByTestId('access-request-drawer', {}, { timeout: 5000 })
  await waitFor(() => expect(drawer).toHaveTextContent('Asked for Featherbase'))
  expect(screen.getByTestId('waiting-for-access')).toBeInTheDocument()
})

test('Tree of all on Waiting for access lists each request as a line', async ({ admin }) => {
  await waitingPerson('Waiting Person', 'waiting.person@staff.example.com')
  await waitingPerson('Second Person', 'second.person@staff.example.com', 'dash')
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const page = await screen.findByTestId('waiting-for-access')
  await waitFor(() => expect(within(page).getByTestId('list-total')).toHaveTextContent('2 total'))
  await userEvent.click(within(page).getByRole('button', { name: 'Tree of all' }))
  const tree = await within(page).findByRole('tree')
  await waitFor(() => expect(within(tree).getAllByRole('treeitem').filter((i) => i.getAttribute('aria-level') === '1')).toHaveLength(2))
})

test('a filter on Waiting for access is kept in the address', async ({ admin }) => {
  await waitingPerson('Waiting Person', 'waiting.person@staff.example.com')
  await waitingPerson('Second Person', 'second.person@staff.example.com', 'dash')
  const app = await renderApp('/featherbase/admin/waiting-for-access', admin)
  const page = await screen.findByTestId('waiting-for-access')
  await waitFor(() => expect(within(page).getByTestId('list-total')).toHaveTextContent('2 total'))
  await userEvent.click(within(page).getByTestId('filter-toggle'))
  await userEvent.selectOptions(within(page).getByTestId('filter-field'), 'app')
  await userEvent.type(within(page).getByTestId('filter-value'), 'dash')
  await userEvent.click(within(page).getByTestId('filter-add'))
  await waitFor(() => expect(within(page).getByTestId('filter-chip')).toHaveTextContent('dash'))
  const search = (app.router.state as { location: { search: { filters?: string } } }).location.search
  expect(JSON.parse(search.filters!)).toEqual([['app', expect.any(String), expect.stringContaining('dash')]])
})

test('nobody waiting: an empty state and no badge', async ({ admin }) => {
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  expect(await screen.findByTestId('waiting-empty')).toHaveTextContent('Nobody is waiting.')
  expect(screen.getByTestId('waiting-for-access-link')).toBeInTheDocument()
  expect(screen.queryByTestId('waiting-for-access-count')).not.toBeInTheDocument()
})

test('a request whose person got access since never shows, even from an earlier visit', async ({ admin }) => {
  const id = await waitingPerson('Soon Given', 'soon.given@staff.example.com')
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const page = await screen.findByTestId('waiting-for-access')
  await waitFor(() => expect(page).toHaveTextContent('Soon Given'))

  await sql`insert into has_role (row_id, parent, parenttype, parentfield, role, created_by, updated_by)
    values ('hr_wfa_web_1', ${id}, 'Person', 'roles', 'System Manager', 'Administrator', 'Administrator')`
  // Away and back within the app: the list it had cached must not come back.
  await userEvent.click(within(page).getByRole('link', { name: 'Home' }))
  await waitFor(() => expect(screen.queryByTestId('waiting-for-access')).not.toBeInTheDocument())
  await userEvent.click(screen.getByTestId('waiting-for-access-link'))
  expect(await screen.findByTestId('waiting-empty')).toBeInTheDocument()
  expect(screen.queryByText('Soon Given')).not.toBeInTheDocument()
})

test('someone who is not a System Manager gets no link, no count call and no page', async ({ admin, createUser }) => {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Shelf Note', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
  await grantRole(admin, { table: 'Shelf Note', role: 'Shelf Clerk', can_read: true })
  const clerk = await createUser({ email: 'clerk.wfa@example.com', roles: ['Shelf Clerk'] })
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.pathname : (input as Request).url)
    return real(input, init)
  })
  await renderApp('/featherbase/admin/waiting-for-access', clerk)
  await screen.findByTestId('all-tables-link')
  expect(screen.queryByTestId('waiting-for-access')).not.toBeInTheDocument()
  expect(screen.queryByTestId('waiting-for-access-link')).not.toBeInTheDocument()
  expect(urls.filter((u) => u.includes('waiting_for_access') || u.includes('access_request'))).toEqual([])
})

test('saving a Person refreshes the count, so someone given a role leaves the badge', async ({ admin }) => {
  const a = await waitingPerson('First Waiting', 'first.waiting@staff.example.com')
  const b = await waitingPerson('Second Waiting', 'second.waiting@staff.example.com')
  await renderApp(`/featherbase/admin/table/person/row/${encodeURIComponent(a)}`, admin)
  const link = await screen.findByTestId('waiting-for-access-link')
  await waitFor(() => expect(within(link).getByTestId('waiting-for-access-count')).toHaveTextContent('2'))

  // Someone else gives the second person a role; this form's save asks again.
  await sql`insert into has_role (row_id, parent, parenttype, parentfield, role, created_by, updated_by)
    values ('hr_wfa_web', ${b}, 'Person', 'roles', 'System Manager', 'Administrator', 'Administrator')`
  const form = await screen.findByTestId('form-view')
  const field = form.querySelector('[data-field=full_name]') as HTMLInputElement
  await userEvent.clear(field)
  await userEvent.type(field, 'First Renamed')
  await userEvent.click(within(form).getByTestId('form-save'))
  await waitFor(() => expect(within(link).getByTestId('waiting-for-access-count')).toHaveTextContent('1'))
})

test('opening Featherbase with no access tells them an admin has been told, and lists them', async ({ admin, createUser }) => {
  const priya = await createUser({ email: 'priya.web@example.com', fullName: 'Priya Web', roles: [] })
  await renderApp('/featherbase/admin', priya)
  const page = await screen.findByTestId('no-access')
  await waitFor(() => expect(page).toHaveTextContent("You don't have access to Featherbase yet"))
  expect(page).toHaveTextContent('An admin has been told')
  const [row] = await sql`select app from access_request where person = ${priya.user}`
  expect(row).toEqual({ app: 'Featherbase' })
  expect(((await (await admin.fetch('/api/people/waiting_for_access/count')).json()) as { count: number }).count).toBe(1)
})
