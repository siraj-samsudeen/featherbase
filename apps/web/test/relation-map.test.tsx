// The relationship map (spec: search-and-explore). A row's neighbourhood: what it points to,
// what points back with a count, re-centring on a related row, and the trail back.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })
const enc = encodeURIComponent

async function seed(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: 'Rm Customer', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Rm Order', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Rm Customer', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Rm Customer', row: { row_id: 'cust-1', title: 'Asha Stores' } })
  await admin.post('/api/save_row', { table: 'Rm Order', row: { row_id: 'ord-1', title: 'First order', customer: 'cust-1' } })
  await admin.post('/api/save_row', { table: 'Rm Order', row: { row_id: 'ord-2', title: 'Second order', customer: 'cust-1' } })
}

test('the map shows what a row points to and what points back, with a count', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/map/${enc('Rm Order')}/ord-1`, admin)
  await screen.findByTestId('relation-map')
  expect(await screen.findByTestId('map-forward-Rm Customer')).toHaveTextContent('cust-1')
  // Nothing points back at an order, so no collection is drawn for it.
  expect(screen.queryByTestId('map-group-Rm Order')).not.toBeInTheDocument()

  await renderApp(`/featherbase/admin/map/${enc('Rm Customer')}/cust-1`, admin)
  const back = await screen.findByTestId('map-group-Rm Order')
  expect(back).toHaveTextContent('2')
})

async function hopOrderToCustomerToOtherOrder(admin: Parameters<typeof renderApp>[1]) {
  await seed(admin)
  const view = await renderApp(`/featherbase/admin/map/${enc('Rm Order')}/ord-1`, admin)
  // order -> its customer
  fireEvent.click(await screen.findByTestId('map-forward-Rm Customer'))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
  // customer -> another of the customer's orders, picked from the opened collection
  fireEvent.click(await screen.findByTestId('map-group-Rm Order'))
  const rows = await screen.findAllByTestId('map-row')
  fireEvent.click(rows.find((r) => r.textContent?.includes('Second order'))!)
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Second order'))
  return view
}

test('clicking a related row re-centres the map on it, and the trail names where the user came from', async ({ admin }) => {
  const { router } = await hopOrderToCustomerToOtherOrder(admin)
  const trail = screen.getByTestId('map-trail')
  await waitFor(() => expect(within(trail).getByTestId('map-trail-0')).toHaveTextContent('First order'))
  await waitFor(() => expect(within(trail).getByTestId('map-trail-1')).toHaveTextContent('Asha Stores'))
  await waitFor(() => expect(trail).toHaveTextContent('Second order'))
  const { location } = router.state as { location: { searchStr: string } }
  expect(JSON.parse(new URLSearchParams(location.searchStr).get('trail')!)).toEqual([
    ['Rm Order', 'ord-1'], ['Rm Customer', 'cust-1'],
  ])
})

// SPEC: The relationship map remembers the trail. Each stop on the trail is
// the row the user stood on, in its own Table (#513), so an earlier stop
// opens that row again.
test('the trail leads back to the original order in one click', async ({ admin }) => {
  await hopOrderToCustomerToOtherOrder(admin)
  fireEvent.click(within(screen.getByTestId('map-trail')).getByTestId('map-trail-0'))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('First order'), { timeout: 3000 })
  expect(screen.getByTestId('map-forward-Rm Customer')).toHaveTextContent('cust-1')
})

test('a copied single-encoded trail restores titles and a removed stop safely falls back to its id', async ({ admin }) => {
  await seed(admin)
  const trail = JSON.stringify([['Rm Order', 'removed-order'], ['Rm Customer', 'cust-1']])
  const { router } = await renderApp(`/featherbase/admin/map/${enc('Rm Order')}/ord-2?trail=${enc(trail)}`, admin)
  await waitFor(() => expect(screen.getByTestId('map-trail-1')).toHaveTextContent('Asha Stores'))
  const { location } = router.state as { location: { searchStr: string } }
  expect(JSON.parse(new URLSearchParams(location.searchStr).get('trail')!)).toEqual(JSON.parse(trail))
  expect(screen.getByTestId('map-trail-0')).toHaveTextContent('removed-order')
  fireEvent.click(screen.getByTestId('map-trail-1'))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
  expect(screen.getByTestId('map-trail-0')).toHaveTextContent('removed-order')
})

test('the narrow layout exposes every backlink count and its rows through buttons', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Rm Note', id_pattern: 'prompt',
    columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Rm Customer' }],
  })
  await admin.post('/api/save_row', { table: 'Rm Note', row: { row_id: 'note-1', customer: 'cust-1' } })
  await renderApp(`/featherbase/admin/map/${enc('Rm Customer')}/cust-1`, admin)
  const narrow = within(await screen.findByTestId('map-narrow'))
  const orders = await narrow.findByTestId('map-narrow-group-Rm Order')
  expect(orders).toHaveTextContent('2')
  expect(await narrow.findByTestId('map-narrow-group-Rm Note')).toHaveTextContent('1')
  fireEvent.click(orders)
  expect(orders).toHaveAttribute('aria-expanded', 'true')
  expect(await screen.findAllByTestId('map-row')).toHaveLength(2)
  fireEvent.click(orders)
  expect(orders).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('map-group-rows')).not.toBeInTheDocument()
})

test('the narrow layout keeps a single link walkable and an empty map understandable', async ({ admin }) => {
  await seed(admin)
  const linked = await renderApp(`/featherbase/admin/map/${enc('Rm Order')}/ord-1`, admin)
  fireEvent.click(await screen.findByTestId('map-narrow-forward-Rm Customer'))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
  linked.unmount()
  await admin.post('/api/table_def', { name: 'Rm Alone', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Rm Alone', row: { row_id: 'alone-1', title: 'Unconnected row' } })
  await renderApp(`/featherbase/admin/map/${enc('Rm Alone')}/alone-1`, admin)
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('alone-1'))
  expect(within(screen.getByTestId('map-narrow')).getByText('No related rows')).toBeInTheDocument()
  expect(screen.getByTestId('map-open-form')).toBeInTheDocument()
})

// A sub-table on the map (ADR 0012 merged coverage showed it untaken): its
// rows are a collection on the parent, one of them re-centres the map, and
// from there the row points back up at its parent.
test('a sub-table shows as a collection of its rows, and a row of it points back at its parent', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Rm Line', kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Rm Invoice', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Rm Line', label: 'Lines' },
    ],
  })
  await admin.post('/api/save_row', {
    table: 'Rm Invoice',
    row: { row_id: 'inv-1', title: 'March invoice', lines: [{ item: 'Saree', qty: 2 }, { item: 'Shawl', qty: 1 }] },
  })
  await renderApp(`/featherbase/admin/map/${enc('Rm Invoice')}/inv-1`, admin)
  const lines = await screen.findByTestId('map-group-Rm Line')
  expect(lines).toHaveTextContent('2')
  fireEvent.click(lines)
  const rows = await within(await screen.findByTestId('map-group-rows')).findAllByTestId('map-row')
  expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Saree'), expect.stringContaining('Shawl')])
  fireEvent.click(rows[0])
  // Re-centred on the line: it points up at its invoice.
  const parent = await screen.findByTestId('map-forward-Rm Invoice')
  expect(parent).toHaveTextContent('inv-1')
  expect(screen.queryByTestId('map-group-Rm Line')).not.toBeInTheDocument()
})
