// #1242 (admin-lists 10-14): All tables names each Table as people read it, has
// a "Find a table" search focused on open, and sentence-case groups.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = { timeout: 10_000 }

async function seed(admin: Admin) {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Atp Site', module: 'Store Layout', description: 'Every store and warehouse',
    columns: [{ column_name: 'site_name', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Atp Floor', module: 'Store Layout', columns: [{ column_name: 'floor', column_type: 'Data', in_list_view: true }] })
  await admin.post('/api/table_def', { name: 'atp stores raw', label: 'Stores only', kind: 'view', view_of: 'Atp Site', view_filters: [['site_name', '!=', '']] })
}

test('each Table is a link by its label, with its one line; groups are sentence case', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin/all-tables', admin)
  const nav = await screen.findByTestId('table-nav', {}, T)
  const site = await within(nav).findByRole('link', { name: /^Atp Site/ }, T)
  expect(site).toHaveTextContent('Every store and warehouse')
  // A view reads by its label, never its internal name.
  expect(await within(nav).findByRole('link', { name: /^Stores only/ }, T)).toBeInTheDocument()
  expect(within(nav).queryByText('atp stores raw')).toBeNull()
  expect(within(nav).getByRole('heading', { name: 'Store layout' })).not.toHaveClass('uppercase')
})

test('Find a table has the focus on open and narrows by what people read', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin/all-tables', admin)
  const find = await screen.findByRole('searchbox', { name: 'Find a table' }, T)
  expect(find).toHaveFocus()
  const nav = screen.getByTestId('table-nav')
  await within(nav).findByRole('link', { name: /^Atp Floor/ }, T)
  // The view's label is read once the page is up, as a person sees it before typing.
  await within(nav).findByRole('link', { name: /^Stores only/ }, T)
  await userEvent.type(find, 'stores only')
  await waitFor(() => expect(within(nav).queryByRole('link', { name: /^Atp Floor/ })).toBeNull())
  expect(within(nav).getByRole('link', { name: /^Stores only/ })).toBeInTheDocument()
  await userEvent.clear(find)
  await userEvent.type(find, 'nothing like this')
  expect(await screen.findByTestId('all-tables-none')).toHaveTextContent('No table matches "nothing like this".')
})

// admin-lists 11: how many rows, muted on the right of each Table.
test('each Table says how many rows it holds', async ({ admin }) => {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' }, name: 'Atp Counted', columns: [{ column_name: 'note', column_type: 'Data' }] })
  for (const note of ['a', 'b', 'c']) await admin.post('/api/save_row', { table: 'Atp Counted', row: { note } })
  await renderApp('/featherbase/admin/all-tables', admin)
  const link = await screen.findByRole('link', { name: /Atp Counted/ }, { timeout: 10_000 })
  await waitFor(() => expect(within(link).getByTestId('all-tables-count')).toHaveTextContent('3'), { timeout: 10_000 })
})
