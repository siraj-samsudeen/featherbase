// person-rename (#275) in the web app: a person's id is opaque (`psn_…`), so
// every screen shows names; Data Scope and Share pick a Person or a Service
// account; service accounts are listed by name; and a session that ended
// (as it does for everyone at the upgrade) says so on the sign-in page.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { pickerFor } from '../src/lib/pickers'
import { isOpaqueId, principalLabel } from '../src/lib/people'
import { recordAction } from '../src/lib/recents'

const anonymous = { user: null, token: null } as never

test('the sign-in page says a session has ended when it was sent there by one', async () => {
  window.history.replaceState({}, '', '/featherbase/login?ended=1')
  await renderApp('/featherbase/login?ended=1', anonymous)
  expect(await screen.findByTestId('session-ended')).toHaveTextContent('Your session has ended. Please sign in again.')
  window.history.replaceState({}, '', '/featherbase/login')
})

test('pickers: Person searches the people directory and never offers built-ins or replaced records; Service Account shows its name', () => {
  expect(pickerFor('Person')).toMatchObject({ peopleSearch: true, filters: [['built_in', '=', false], ['replaced_by', '=', null]] })
  expect(pickerFor('Service Account')).toMatchObject({ searchField: 'label', labelField: 'label' })
  expect(pickerFor('Store')).toEqual({ searchField: 'row_id', labelField: null, filters: [] })
  expect(isOpaqueId('psn_abcdefghijklmnopqrst')).toBe(true)
  expect(isOpaqueId('Administrator')).toBe(false)
  // An opaque id is never shown: a name, else a neutral placeholder.
  expect(principalLabel('psn_abcdefghijklmnopqrst', null, false)).toBe('Unnamed person')
  expect(principalLabel('psn_abcdefghijklmnopqrst', 'Asha', false)).toBe('Asha')
})

test('a Data Scope row picks a Person or a Service account; the Person picker shows name and handle', async ({ admin }) => {
  await admin.post('/api/save_row', { table: 'Person', row: { full_name: 'Asha Kumar', username: 'asha.k' } })
  await admin.post('/api/save_row', { table: 'Person', row: { email: 'no.name@example.com' } })
  await renderApp('/featherbase/admin/Data%20Scope/new', admin)
  const person = await screen.findByPlaceholderText('Reference: Person')
  expect(screen.getByPlaceholderText('Reference: Service Account')).toBeInTheDocument()
  await userEvent.type(person, 'asha')
  const options = await screen.findAllByTestId('link-option')
  expect(options.map((o) => o.textContent)).toContain('Asha Kumar · @asha.k')
  // A person with no name is still found — by their address.
  await userEvent.clear(person)
  await userEvent.type(person, 'no.name')
  await waitFor(() => expect(screen.getAllByTestId('link-option').map((o) => o.textContent)).toContain('no.name@example.com'))
  expect(screen.getAllByTestId('link-option').some((o) => /psn_/.test(o.textContent ?? ''))).toBe(false)
})

test('the Share form offers the same two pickers', async ({ admin }) => {
  await renderApp('/featherbase/admin/Share/new', admin)
  expect(await screen.findByPlaceholderText('Reference: Person')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Reference: Service Account')).toBeInTheDocument()
})

test('service accounts are listed by name, never by their svc_ id', async ({ admin }) => {
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-web-list' })
  await renderApp('/featherbase/admin/access-tokens', admin)
  const row = await screen.findByTestId(`sa-${account.row_id}`)
  expect(row).toHaveTextContent('svc-web-list')
  expect(row.textContent).not.toContain(account.row_id)
})

test('names, not ids: a comment by a person shows their name and initials', async ({ admin, createUser }) => {
  const asha = await createUser({ email: 'asha.names@example.com', fullName: 'Asha Kumar' })
  await admin.post('/api/table_def', { name: 'Names Row', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Names Row', role: 'All', can_read: true } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Comment', role: 'All', can_read: true, can_create: true, can_write: true } })
  const doc = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Names Row', row: { title: 'discuss' } })
  await asha.post('/api/save_row', { table: 'Comment', row: { ref_table: 'Names Row', ref_name: doc.row_id, content: 'looks right, mail sm.atk@jeyarama.com' } })
  await renderApp(`/featherbase/admin/Names%20Row/${doc.row_id}`, admin)
  const author = await screen.findByTestId('comment-author')
  await waitFor(() => expect(author).toHaveTextContent('Asha Kumar'))
  expect(screen.getByTestId('comment-initials')).toHaveTextContent('AK')
  // An address is not highlighted as a mention.
  const highlighted = [...screen.getByTestId('comment-list').querySelectorAll('span[class*="text-action"]')]
  expect(highlighted.some((e) => e.textContent?.includes('@'))).toBe(false)
  expect(screen.getByTestId('comment-list')).toHaveTextContent('sm.atk@jeyarama.com')
  expect(screen.getByTestId('comment-list').textContent).not.toContain(asha.user!)
})

test('the Person list shows each person’s name in its first column', async ({ admin, createUser }) => {
  const ravi = await createUser({ email: 'ravi.list@example.com', fullName: 'Ravi Menon' })
  await renderApp('/featherbase/admin/Person', admin)
  await waitFor(() => expect(screen.getAllByTestId('principal-name').some((n) => n.textContent === 'Ravi Menon')).toBe(true))
  const table = screen.getAllByTestId('principal-name')[0].closest('table') as HTMLElement
  expect(within(table).queryByText(ravi.user!)).toBeNull()
})

test('a name the viewer may not read is "Unnamed person", never a stuck "…" or the id', async ({ admin, createUser }) => {
  const author = await createUser({ email: 'hidden.author@example.com', fullName: 'Hidden Author' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Hidden Row Reader' } })
  const reader = await createUser({ email: 'no.person.read@example.com', roles: ['Hidden Row Reader'] })
  await admin.post('/api/table_def', { name: 'Hidden Row', columns: [{ column_name: 'title', column_type: 'Data' }] })
  // A grant of their own earns the Admin (#410); grants to the implicit All role alone do not.
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Hidden Row', role: 'Hidden Row Reader', can_read: true } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Comment', role: 'All', can_read: true, can_create: true, can_write: true } })
  const doc = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Hidden Row', row: { title: 'x' } })
  await author.post('/api/save_row', { table: 'Comment', row: { ref_table: 'Hidden Row', ref_name: doc.row_id, content: 'hello' } })
  await renderApp(`/featherbase/admin/Hidden%20Row/${doc.row_id}`, reader)
  const name = await screen.findByTestId('comment-author')
  await waitFor(() => expect(name).toHaveTextContent('Unnamed person'))
  expect(name.textContent).not.toContain(author.user!)
})

// #414: the Person form, its breadcrumb and the sidebar's Recent list name the
// person; a Person's id is permanent, so Rename is not offered.
test('a Person form is headed by the name, never the id, offers no Rename, and Recent remembers the name', async ({ admin, createUser }) => {
  const asha = await createUser({ email: 'asha.form@example.com', fullName: 'Asha Form' })
  localStorage.clear()
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(asha.user!)}`, admin)
  const form = await screen.findByTestId('form-view')
  const heading = within(form).getByRole('heading', { level: 1 })
  await waitFor(() => expect(heading).toHaveTextContent('Person: Asha Form'))
  expect(heading.textContent).not.toContain(asha.user!)
  expect(within(form).getByTestId('breadcrumbs').textContent).not.toContain(asha.user!)
  expect(within(form).queryByRole('button', { name: 'Rename' })).toBeNull()
  const recent = await screen.findAllByTestId('sidebar-recent')
  const row = recent.find((r) => r.textContent?.includes('Person'))!
  await waitFor(() => expect(row).toHaveTextContent('Asha Form'))
  expect(row.textContent).not.toContain(asha.user!)
  expect(row.getAttribute('title') ?? '').not.toContain(asha.user!)
})

// #414 review (Codex P2): renaming the person on their form updates the name
// the heading, breadcrumb and Recent read — it is cached per id.
test('saving a new full name on the Person form shows the new name at once', async ({ admin, createUser }) => {
  const p = await createUser({ email: 'renamed.form@example.com', fullName: 'Old Name' })
  localStorage.clear()
  await renderApp(`/featherbase/admin/Person/${encodeURIComponent(p.user!)}`, admin)
  const form = await screen.findByTestId('form-view')
  const heading = within(form).getByRole('heading', { level: 1 })
  await waitFor(() => expect(heading).toHaveTextContent('Person: Old Name'))
  const field = form.querySelector('[data-field=full_name]') as HTMLInputElement
  await userEvent.clear(field)
  await userEvent.type(field, 'New Name')
  await userEvent.click(within(form).getByTestId('form-save'))
  await waitFor(() => expect(heading).toHaveTextContent('Person: New Name'))
  expect(within(form).getByTestId('breadcrumbs')).toHaveTextContent('New Name')
})

// A remembered row with no table caption still shows the name, and its
// tooltip never falls back to the id.
test('a Recent row for a person with no caption shows the name and no id tooltip', async ({ admin, createUser }) => {
  const p = await createUser({ email: 'nosub.recent@example.com', fullName: 'Nosub Person' })
  localStorage.clear()
  recordAction(admin.user!, { kind: 'row', key: `row:Person/${p.user!}`, label: p.user!, path: `/featherbase/admin/Person/${p.user!}` })
  await renderApp('/featherbase/admin/all-tables', admin)
  const rows = await screen.findAllByTestId('sidebar-recent')
  const row = rows.find((r) => r.getAttribute('href')?.includes(p.user!))!
  await waitFor(() => expect(row).toHaveTextContent('Nosub Person'))
  expect(row.textContent).not.toContain(p.user!)
  expect(row.getAttribute('title') ?? '').not.toContain(p.user!)
})
