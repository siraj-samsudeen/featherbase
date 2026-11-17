// #1241: the record Map, the Tree and Recently Opened name a Table by its
// label ("Client"), never its internal name ("Tl Customer").
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { Sql } from 'postgres'
import { tableHref } from 'shared'
import { invalidateMeta } from 'server/src/meta'
import { test, expect, renderApp } from './pg-test'
import { actionForLocation, recordAction } from '../src/lib/recents'

configure({ asyncUtilTimeout: 10_000 })
type Admin = Parameters<typeof renderApp>[1]

/** Two Tables whose labels differ from their names, as an app's Tables do
 *  ("tickets.ticket" reads "Ticket"); a Table made here stores no label of its own. */
async function seed(admin: Admin, db: unknown) {
  await admin.post('/api/table_def', {
    name: 'Tl Customer', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Tl Order', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Tl Customer', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Tl Customer', row: { row_id: 'cust-1', title: 'Asha Stores' } })
  await admin.post('/api/save_row', { table: 'Tl Order', row: { row_id: 'ord-1', title: 'First order', customer: 'cust-1' } })
  await (db as Sql)`update table_def set label = case name when 'Tl Customer' then 'Client' else 'Purchase' end where name in ('Tl Customer', 'Tl Order')`
  invalidateMeta()
}

async function openMap(admin: Admin, table: string, row: string) {
  const view = await renderApp(`${tableHref(table)}/row/${row}`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  return { view, map: await screen.findByTestId('relation-map') }
}

test('the Map names the row, its links and what points back by Table labels', async ({ admin, db }) => {
  await seed(admin, db)
  const order = await openMap(admin, 'Tl Order', 'ord-1')
  await waitFor(() => expect(screen.getByTestId('map-forward-Tl Customer')).toHaveTextContent('Customer · Client'))
  await waitFor(() => expect(order.map).toHaveTextContent('Purchase'))
  expect(order.map).not.toHaveTextContent('Tl Order')
  order.view.unmount()

  const customer = await openMap(admin, 'Tl Customer', 'cust-1')
  await waitFor(() => expect(screen.getByTestId('map-group-Tl Order')).toHaveTextContent('Purchase'))
  expect(customer.map).not.toHaveTextContent('Tl ')
})

test("Tree of all is headed and tagged by the Table's label", async ({ admin, db }) => {
  await seed(admin, db)
  await renderApp(tableHref('Tl Customer'), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Tree of all' }))
  const tree = await screen.findByRole('tree', { name: 'Every Client row' })
  await waitFor(() => expect(within(tree).getAllByRole('treeitem')[0]).toHaveTextContent('Client'))
  expect(tree).not.toHaveTextContent('Tl Customer')
})

test('Recently Opened names a list by its label', async ({ admin, db }) => {
  await seed(admin, db)
  recordAction('Administrator', actionForLocation(tableHref('Tl Customer'), {}, 'Tl Customer')!, Date.now())
  await renderApp('/featherbase/admin/all-tables', admin)
  const recents = await screen.findByTestId('sidebar-recents')
  const row = await waitFor(() => within(recents).getByTestId('sidebar-recent'))
  await waitFor(() => expect(row).toHaveTextContent('Client'))
  expect(row).not.toHaveTextContent('Tl Customer')
  expect(row.getAttribute('title')).toContain('Client')
})
