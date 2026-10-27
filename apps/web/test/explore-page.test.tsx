// Explore (spec: search-and-explore): chain tables, narrow by clicking with exact counts and
// sums, and open a row in the peek panel without leaving Explore.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })
const enc = encodeURIComponent
type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Ex Supplier', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Ex Purchase', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'supplier', column_type: 'Reference', reference_table: 'Ex Supplier', in_list_view: true },
      { column_name: 'amount', column_type: 'Int', in_list_view: true },
    ],
  })
  for (const [id, title] of [['sup-a', 'Acme'], ['sup-b', 'Bolt Co']])
    await admin.post('/api/save_row', { table: 'Ex Supplier', row: { row_id: id, title } })
  for (const [id, sup, amount] of [['po-1', 'sup-a', 100], ['po-2', 'sup-a', 50], ['po-3', 'sup-b', 7]])
    await admin.post('/api/save_row', { table: 'Ex Purchase', row: { row_id: id, title: id, supplier: sup, amount } })
}

const chain = enc(JSON.stringify([{ mode: 'backlink', table: 'Ex Purchase', column: 'supplier' }]))

test('clicking a supplier narrows the purchases to that supplier\'s, with an exact count and sum', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Supplier')}&chain=${chain}`, admin)
  // With nothing selected the second table follows everything related to what is above it.
  await waitFor(() => expect(screen.getByTestId('explore-pane2-count')).toHaveTextContent('3'))
  await waitFor(() => expect(screen.getByTestId('explore-pane2-sum')).toHaveTextContent('157'))

  const pane1 = screen.getByTestId('explore-pane1')
  fireEvent.click(within(pane1).getByText('Acme'))
  await waitFor(() => expect(screen.getByTestId('explore-pane2-count')).toHaveTextContent('2'))
  await waitFor(() => expect(screen.getByTestId('explore-pane2-sum')).toHaveTextContent('150'))
  expect(screen.getByTestId('explore-pane2')).not.toHaveTextContent('po-3')
})

test('opening a row from Explore opens it in the peek panel and leaves Explore as it was', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Supplier')}&chain=${chain}`, admin)
  const pane1 = await screen.findByTestId('explore-pane1')
  await waitFor(() => expect(within(pane1).getAllByTestId('explore-row')).toHaveLength(2))
  fireEvent.click(within(pane1).getAllByTitle('Peek')[0], { bubbles: true })
  const panel = await screen.findByTestId('peek-panel-0')
  expect(within(panel).getByTestId('peek-title')).toBeInTheDocument()
  // Explore is still on the page, and nothing was selected by opening the row.
  expect(screen.getByTestId('explore-view')).toBeInTheDocument()
  expect(pane1.querySelector('[data-selected]')).toBeNull()
  fireEvent.click(within(panel).getByTestId('peek-close'))
  await waitFor(() => expect(screen.queryByTestId('peek-panel-0')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('explore-pane2-count')).toHaveTextContent('3'))
})
