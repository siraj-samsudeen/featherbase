// Keyboard shortcuts of the Admin shell (openspec/specs/admin-ui-feedback,
// "The Admin has keyboard shortcuts for the common moves"). Real Admin in
// jsdom against the in-process server.

import { screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'


type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent
const press = (init: KeyboardEventInit, target: Element | Document = document) =>
  fireEvent.keyDown(target, init)
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

async function seedDoc(admin: Admin, table: string) {
  await admin.post('/api/table_def', {
    name: table,
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }],
  })
  return admin.post<{ row_id: string }>('/api/save_row', { table, row: { title: 'orig' } })
}

test('Keyboard shortcuts: Ctrl+K puts the cursor in the search bar', async ({ admin }) => {
  await seedDoc(admin, 'Kb Search')
  await renderApp(`/featherbase/admin/${enc('Kb Search')}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  const bar = screen.getByLabelText('Search or type a command')
  expect(bar).not.toHaveFocus()
  press({ key: 'k', ctrlKey: true })
  expect(bar).toHaveFocus()
})

test('Keyboard shortcuts: Ctrl+S saves the form that is open', async ({ admin }) => {
  const row = await seedDoc(admin, 'Kb Save')
  await renderApp(`/featherbase/admin/${enc('Kb Save')}/${row.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  const title = () => document.querySelector<HTMLInputElement>('[data-field=title]') as HTMLInputElement
  await waitFor(() => expect(title()).toHaveValue('orig'))

  fireEvent.change(title(), { target: { value: 'saved by keyboard' } })
  press({ key: 's', ctrlKey: true })

  await waitFor(() => expect(screen.getByTestId('form-banner')).toHaveTextContent('Saved'))
  const stored = await admin.get<{ title: string }>(`/api/table/${enc('Kb Save')}/${row.row_id}`)
  expect(stored.title).toBe('saved by keyboard')
})

test('Keyboard shortcuts: g then d goes to the Admin home, but not while typing in a field', async ({ admin }) => {
  const row = await seedDoc(admin, 'Kb Home')
  const app = await renderApp(`/featherbase/admin/${enc('Kb Home')}/${row.row_id}`, admin)
  await screen.findByTestId('form-view', {}, { timeout: 8000 })
  const title = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('[data-field=title]')
    expect(el).toHaveValue('orig')
    return el as HTMLInputElement
  })

  // Typing "gd" inside a field is just typing.
  press({ key: 'g' }, title)
  press({ key: 'd' }, title)
  expect(here(app)).toContain('Kb Home')

  press({ key: 'g' }, document.body)
  press({ key: 'd' }, document.body)
  await waitFor(() => expect(here(app)).not.toContain('Kb Home'))
})

test('Keyboard shortcuts: Ctrl+B starts a new row of the Table being looked at', async ({ admin }) => {
  await seedDoc(admin, 'Kb New')
  const app = await renderApp(`/featherbase/admin/${enc('Kb New')}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 8000 })
  press({ key: 'b', ctrlKey: true })
  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/Kb New/new'))
})

// #515: Ctrl+B on an Admin page that is not a Table (here the list of all
// tables) used to read "all-tables" as a Table name and land on a "Page not
// found" screen.
test('Keyboard shortcuts: Ctrl+B on a page that is not a Table leaves the page as it is', async ({ admin }) => {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('all-tables-link', {}, { timeout: 8000 })
  press({ key: 'b', ctrlKey: true })
  await new Promise((r) => setTimeout(r, 500))
  expect(here(app)).toBe('/featherbase/admin/all-tables')
})

test('Keyboard shortcuts: Ctrl+B on the Jobs page leaves the page as it is', async ({ admin }) => {
  const app = await renderApp('/featherbase/admin/jobs', admin)
  await screen.findByRole('heading', { name: 'Jobs', level: 1 }, { timeout: 8000 })
  press({ key: 'b', ctrlKey: true })
  await new Promise((r) => setTimeout(r, 500))
  expect(here(app)).toBe('/featherbase/admin/jobs')
})
