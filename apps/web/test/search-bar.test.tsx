// The search bar of the Admin (openspec/specs/admin-ui-feedback, "The search
// bar opens what it finds"). Real Admin in jsdom against the in-process server.

import { configure, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 5000 })

const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

async function seed(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: 'Sb Gadget',
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Sb Home',
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }],
  })
  const row = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Sb Gadget',
    row: { row_id: 'Zebrafinch-widget', title: 'Zebrafinch widget' },
  })
  return row.row_id
}

async function openBar(admin: Parameters<typeof renderApp>[1]) {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('all-tables-link', {}, { timeout: 8000 })
  const bar = screen.getByLabelText('Search or type a command')
  return { app, bar }
}

test('The search bar opens what it finds: picking a matching record opens its form', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Zebrafinch' } })
  const hit = await screen.findByTestId('awesomebar-doc')
  expect(hit).toHaveTextContent('Zebrafinch-widget')
  fireEvent.click(hit)

  await waitFor(() => expect(field('title')).toHaveValue('Zebrafinch widget'))
  expect(here(app)).toContain('Sb Gadget')
})

test('The search bar opens what it finds: a matching Table offers its list and a way to start a new row', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Gadget' } })
  const create = await screen.findByTestId('awesomebar-new')
  expect(create).toHaveTextContent('New Sb Gadget row')
  expect(await screen.findAllByTestId('awesomebar-table')).not.toHaveLength(0)
  fireEvent.click(create)

  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/Sb Gadget/new'))
  await waitFor(() => expect(field('title')).toHaveValue(''))
})

test('The search bar opens what it finds: Enter on an exact Table name opens that Table\'s list', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'Sb Home' } })
  await screen.findAllByTestId('awesomebar-table')
  fireEvent.submit(bar.closest('form') as HTMLFormElement)

  await waitFor(() => expect(here(app)).toBe('/featherbase/admin/Sb Home'))
  expect(await screen.findByTestId('list-view')).toBeInTheDocument()
})

test('The search bar opens what it finds: results are grouped under headings, and a command can be run from it', async ({ admin }) => {
  await seed(admin)
  const { app, bar } = await openBar(admin)

  fireEvent.focus(bar)
  fireEvent.change(bar, { target: { value: 'go to' } })
  const heading = await screen.findByTestId('awesomebar-commands-heading')
  expect(heading).toHaveTextContent('Commands')
  const results = screen.getByTestId('awesomebar-results')
  fireEvent.click(within(results).getByTestId('awesomebar-cmd-home'))
  await waitFor(() => expect(here(app).startsWith('/featherbase/admin')).toBe(true))
  await waitFor(() => expect(here(app)).not.toContain('all-tables'))
})
