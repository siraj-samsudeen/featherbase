// #429, #835: System Managers see who signed in without a role, from a nav
// item with a count, as the standard Person list, and open the Person form
// from a row.
import { afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sql } from 'server/src/db'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

afterEach(() => vi.restoreAllMocks())

/** Nobody but this test's people is waiting. */
async function clearWaiting() {
  await sql`
    update person p set enabled = false
    where p.enabled and not coalesce(p.built_in, false) and p.replaced_by is null
      and not exists (select 1 from has_role r where r.parent = p.row_id and r.parenttype = 'Person' and r.role not in ('All', 'Guest'))`
}

async function waitingPerson(name: string, email: string) {
  const { saveDoc } = await import('server/src/document')
  return String((await saveDoc('Person', { full_name: name, email, enabled: true }, 'Administrator', 'insert')).row_id)
}

test('a System Manager sees the count, the list and opens the Person form', async ({ admin }) => {
  await clearWaiting()
  await waitingPerson('Waiting Person', 'waiting.person@staff.example.com')
  await waitingPerson('Second Person', 'second.person@staff.example.com')
  await renderApp('/featherbase/admin/waiting-for-access', admin)

  const link = await screen.findByTestId('waiting-for-access-link')
  await waitFor(() => expect(within(link).getByTestId('waiting-for-access-count')).toHaveTextContent('2'))

  const page = await screen.findByTestId('waiting-for-access')
  // The standard list, under the page's own name, with the full address.
  expect(within(page).getByRole('heading', { level: 1 })).toHaveTextContent('Waiting for access')
  expect(within(page).getByTestId('list-view')).toBeInTheDocument()
  await waitFor(() => expect(within(page).getByTestId('list-total')).toHaveTextContent('2 total'))
  expect(page).toHaveTextContent('waiting.person@staff.example.com')
  expect(page).toHaveTextContent('Waiting Person')
  // A list's own tools: filters and column choice.
  expect(within(page).getByTestId('list-columns')).toBeInTheDocument()
  const row = await within(page).findByRole('link', { name: 'Waiting Person' })
  await userEvent.click(row)
  // The Person form, where roles are given, for that person.
  expect(await screen.findByTestId('user-sign-in-methods', {}, { timeout: 5000 })).toBeInTheDocument()
  expect(screen.queryByTestId('waiting-for-access')).not.toBeInTheDocument()
})

test('nobody waiting: an empty state and no badge', async ({ admin }) => {
  await clearWaiting()
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  expect(await screen.findByTestId('waiting-empty')).toHaveTextContent('Nobody is waiting.')
  expect(screen.getByTestId('waiting-for-access-link')).toBeInTheDocument()
  expect(screen.queryByTestId('waiting-for-access-count')).not.toBeInTheDocument()
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
  expect(urls.filter((u) => u.includes('waiting_for_access'))).toEqual([])
})

test('saving a Person refreshes the count, so someone given a role leaves the badge', async ({ admin }) => {
  await clearWaiting()
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

test('#835: a person with no name is still identifiable by their address', async ({ admin }) => {
  await clearWaiting()
  const { saveDoc } = await import('server/src/document')
  await saveDoc('Person', { email: 'no.name@staff.example.com', enabled: true }, 'Administrator', 'insert')
  await renderApp('/featherbase/admin/waiting-for-access', admin)
  const page = await screen.findByTestId('waiting-for-access')
  await waitFor(() => expect(page).toHaveTextContent('no.name@staff.example.com'))
  expect(page.textContent).not.toMatch(/psn_[a-z2-7]{20}/)
})
