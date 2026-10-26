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
  await renderApp(`/featherbase/admin/map/${enc('Rm Order')}/ord-1`, admin)
  // order -> its customer
  fireEvent.click(await screen.findByTestId('map-forward-Rm Customer'))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
  // customer -> another of the customer's orders, picked from the opened collection
  fireEvent.click(await screen.findByTestId('map-group-Rm Order'))
  const rows = await screen.findAllByTestId('map-row')
  fireEvent.click(rows.find((r) => r.textContent?.includes('Second order'))!)
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Second order'))
}

test('clicking a related row re-centres the map on it, and the trail names where the user came from', async ({ admin }) => {
  await hopOrderToCustomerToOtherOrder(admin)
  const trail = screen.getByTestId('map-trail')
  expect(within(trail).getByTestId('map-trail-0')).toHaveTextContent('ord-1')
  expect(within(trail).getByTestId('map-trail-1')).toHaveTextContent('cust-1')
})

// SPEC: The relationship map remembers the trail — suspected defect, see report.
// RelationMap.hop() records [target table, current row] in the trail because its `table`
// parameter shadows the map's own `table`, so clicking an earlier stop opens that row name in
// the wrong table ("Cannot load Rm Customer ord-1").
test.fails('the trail leads back to the original order in one click', async ({ admin }) => {
  await hopOrderToCustomerToOtherOrder(admin)
  fireEvent.click(within(screen.getByTestId('map-trail')).getByTestId('map-trail-0'))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('First order'), { timeout: 3000 })
})
