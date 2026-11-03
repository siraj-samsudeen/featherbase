// Generic metadata-driven browsing: defaults are initial navigation, never
// hidden scope. An explicit URL (including []) remains the person's choice.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const table = 'Browse Venue'
const enc = encodeURIComponent

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: table,
    id_pattern: 'field:code',
    title_column: 'title',
    browse_presentation: { default_filters: [['active', '=', true]] },
    columns: [
      { column_name: 'code', column_type: 'Data', unique: true },
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'active', column_type: 'Check', label: 'Active', in_list_view: true },
    ],
  })
  for (const [code, title, active] of [['LIVE', 'Current venue', true], ['OLD', 'Retired venue', false]])
    await admin.post('/api/save_row', { table, row: { code, title, active } })
}

const titles = () => [...screen.getByTestId('list-rows').querySelectorAll('[data-testid="cell-title"]')].map((e) => e.textContent)

test('opening the table uses its visible defaults, with the filtered total and rows', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(table)}`, admin)
  await waitFor(() => expect(titles()).toEqual(['Current venue']))
  expect(screen.getByTestId('list-total')).toHaveTextContent('1 total')
  expect(screen.getByTestId('filter-chips')).toHaveTextContent('Active = true')
})

test('an explicit empty filter URL opens all rows instead of reapplying the default', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(table)}?filters=${enc('[]')}`, admin)
  await waitFor(() => expect(titles()).toHaveLength(2))
  expect(screen.getByTestId('list-total')).toHaveTextContent('2 total')
  expect(screen.queryByTestId('filter-chips')).not.toBeInTheDocument()
})

test('a different explicit filter wins over the table default', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(table)}?filters=${enc(JSON.stringify([['active', '=', false]]))}`, admin)
  await waitFor(() => expect(titles()).toEqual(['Retired venue']))
  expect(screen.getByTestId('filter-chips')).toHaveTextContent('Active = false')
})

test('removing the default filter keeps an explicit all-rows view', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/${enc(table)}`, admin)
  await screen.findByTestId('filter-chips')
  fireEvent.click(within(screen.getByTestId('filter-chips')).getByRole('button', { name: 'Remove filter' }))
  await waitFor(() => expect(titles()).toHaveLength(2))
  expect(screen.queryByTestId('filter-chips')).not.toBeInTheDocument()
})

test('a preferred related list opens inline and shows its target row titles', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Browse Counter', label: 'Brands at venue', id_pattern: 'field:code', title_column: 'title',
    columns: [
      { column_name: 'code', column_type: 'Data', unique: true },
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'venue', column_type: 'Reference', reference_table: table },
    ],
  })
  const meta = await admin.get<Record<string, unknown>>(`/api/table/${enc(table)}:meta`)
  await admin.put(`/api/table_def/${enc(table)}`, {
    ...meta,
    browse_presentation: { default_filters: [['active', '=', true]], preferred_related: { table: 'Browse Counter', column: 'venue' } },
  })
  for (const [code, title, venue] of [['A', 'First brand', 'LIVE'], ['B', 'Second brand', 'LIVE'], ['C', 'Other site brand', 'OLD']])
    await admin.post('/api/save_row', { table: 'Browse Counter', row: { code, title, venue } })
  await renderApp(`/featherbase/admin/${enc(table)}/LIVE`, admin)
  const embedded = await screen.findByTestId('embedded-list')
  await waitFor(() => expect(embedded.querySelectorAll('tbody a')).toHaveLength(2))
  await waitFor(() => expect(within(embedded).getByText('First brand')).toBeInTheDocument())
  expect(within(embedded).getByText('Second brand')).toBeInTheDocument()
  expect(within(embedded).queryByText('Other site brand')).not.toBeInTheDocument()
  const tab = screen.getByTestId('related-tab-Browse Counter')
  expect(tab).toHaveAttribute('aria-expanded', 'true')
  expect(tab).toHaveTextContent('Brands at venue')
  fireEvent.click(tab)
  expect(screen.queryByTestId('embedded-list')).not.toBeInTheDocument()
})

test('a display label changes list and form headings, while row and breadcrumb URLs keep canonical table names', async ({ admin }) => {
  await seed(admin)
  const meta = await admin.get<Record<string, unknown>>(`/api/table/${enc(table)}:meta`)
  await admin.put(`/api/table_def/${enc(table)}`, { ...meta, label: 'Venue Register' })
  await renderApp(`/featherbase/admin/${enc(table)}`, admin)
  expect(await screen.findByRole('heading', { name: 'Venue Register' })).toBeInTheDocument()
  await waitFor(() => expect(titles()).toEqual(['Current venue']))
  const rowLink = within(screen.getByTestId('list-rows')).getByRole('link', { name: 'LIVE' })
  expect(decodeURIComponent(rowLink.getAttribute('href')!)).toBe(`/featherbase/admin/${table}/LIVE`)
  fireEvent.click(rowLink)
  expect(await screen.findByRole('heading', { name: 'Venue Register: Current venue' })).toBeInTheDocument()
  const breadcrumb = within(screen.getByTestId('breadcrumbs')).getByRole('link', { name: 'Venue Register' })
  expect(decodeURIComponent(breadcrumb.getAttribute('href')!)).toBe(`/featherbase/admin/${table}`)
})

test('the manager table navigator displays labels without changing destinations', async ({ admin }) => {
  await seed(admin)
  const meta = await admin.get<Record<string, unknown>>(`/api/table/${enc(table)}:meta`)
  await admin.put(`/api/table_def/${enc(table)}`, { ...meta, label: 'Venue Register' })
  await renderApp('/featherbase/admin/all-tables', admin)
  const link = await within(await screen.findByTestId('table-nav')).findByRole('link', { name: 'Venue Register' })
  expect(decodeURIComponent(link.getAttribute('href')!)).toBe(`/featherbase/admin/${table}`)
})
