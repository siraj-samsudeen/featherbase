// #1282 I1, the sideways step (UI owner's decision A, 19-Nov-2026): a quiet "▾"
// beside the path bar's last step lists the other rows of the list or group that
// step came from: the list's own rows (its filters), or the rows that point at the
// previous step's record by the same link (a group row, a Map group row). It says
// where the current row sits ("3 of 6 · Pk Order"), marks it, starts around it
// when there are more than 20, and a search reaches the rest. A plain click
// replaces the step; a new-tab click opens the row's page.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]

async function seed(admin: Client, orders = 6) {
  await admin.post('/api/table_def', {
    name: 'Sw Customer', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Sw Order', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Sw Customer', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Sw Customer', row: { row_id: 'c1', title: 'Asha Stores' } })
  await admin.post('/api/save_row', { table: 'Sw Customer', row: { row_id: 'c2', title: 'Bala Traders' } })
  for (let i = 1; i <= orders; i++)
    await admin.post('/api/save_row', { table: 'Sw Order', row: { row_id: `o${String(i).padStart(2, '0')}`, title: `Order ${String(i).padStart(2, '0')}`, customer: 'c1' } })
  await admin.post('/api/save_row', { table: 'Sw Order', row: { row_id: 'b1', title: 'Bala order', customer: 'c2' } })
}

const bar = () => screen.getByRole('navigation', { name: 'Path' }).closest('[data-testid="path-bar"]') as HTMLElement
const sideways = () => within(bar()).findByRole('button', { name: 'Other rows in this list' })
const menu = () => screen.findByRole('menu', { name: 'Other rows in this list' })

/** Asha's orders as a list (filtered), with one of them open in the pane. */
async function fromFilteredList(admin: Client, order: string) {
  const view = await renderApp(`${tableHref('Sw Order')}?filters=${encodeURIComponent(JSON.stringify([['customer', '=', 'c1']]))}`, admin)
  const link = await screen.findByRole('link', { name: order })
  fireEvent.click(within(link.closest('tr')!).getAllByRole('cell').at(-1)!)
  await screen.findByRole('complementary', { name: new RegExp(order) })
  return view
}

test("from a filtered list, ▾ lists that list's rows, marks the current one and says where it sits", async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  fireEvent.click(await sideways())
  const list = await menu()
  await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(6))
  // Only Asha's orders: the list's own filter, not the whole Table.
  expect(within(list).queryByRole('link', { name: 'Bala order' })).not.toBeInTheDocument()
  // In the list's own order, newest first: Order 03 is the 4th of Asha's 6.
  expect(within(list).getByTestId('sideways-position')).toHaveTextContent('4 of 6 · Sw Order')
  expect(within(list).getByRole('link', { name: 'Order 03' }).closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
})

test('choosing a row replaces the step: the same place on the path, another row', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  const steps = () => within(screen.getByRole('navigation', { name: 'Path' })).getAllByRole('button').length
  const before = steps()
  fireEvent.click(await sideways())
  fireEvent.click(await within(await menu()).findByRole('link', { name: 'Order 05' }))
  await screen.findByRole('complementary', { name: /Order 05/ })
  expect(steps()).toBe(before)
  expect(screen.queryByRole('menu', { name: 'Other rows in this list' })).not.toBeInTheDocument()
})

test("a name in the menu is its row's page, for a new tab", async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  fireEvent.click(await sideways())
  expect(await within(await menu()).findByRole('link', { name: 'Order 05' })).toHaveAttribute('href', expect.stringContaining('o05'))
})

test('from a Map group row, ▾ lists the rows that point at the record it came from, by the same link', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Sw Customer')}/row/c1`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  const box = await screen.findByTestId('map-group-Sw Order')
  fireEvent.click(await within(box).findByRole('button', { name: 'Focus on Order 02' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Order 02'))
  fireEvent.click(await sideways())
  const list = await menu()
  await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(6))
  expect(within(list).getByTestId('sideways-position')).toHaveTextContent('2 of 6 · Sw Order')
  fireEvent.click(within(list).getByRole('link', { name: 'Order 04' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Order 04'))
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
})

test('past 20 rows the menu starts around the current row, and its search reaches the rest', async ({ admin }) => {
  await seed(admin, 30)
  await fromFilteredList(admin, 'Order 25')
  fireEvent.click(await sideways())
  const list = await menu()
  await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(20))
  expect(within(list).getByRole('link', { name: 'Order 25' })).toBeInTheDocument()
  expect(within(list).queryByRole('link', { name: 'Order 01' })).not.toBeInTheDocument()
  // Newest first, Order 25 is the 6th of 30.
  expect(within(list).getByTestId('sideways-position')).toHaveTextContent('6 of 30 · Sw Order')
  fireEvent.change(within(list).getByRole('searchbox', { name: 'Search these rows' }), { target: { value: 'Order 01' } })
  expect(await within(list).findByRole('link', { name: 'Order 01' })).toBeInTheDocument()
})

test('Escape closes the menu', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  fireEvent.click(await sideways())
  fireEvent.keyDown(await menu(), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Other rows in this list' })).not.toBeInTheDocument())
})

test('no ▾ where the step came from no list or group: an order walked up to its customer', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Sw Order')}/row/o02`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  fireEvent.click(await within(await screen.findByTestId('map-forward-Sw Customer')).findByRole('link', { name: 'Asha Stores' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
  await new Promise((r) => setTimeout(r, 300))
  expect(within(bar()).queryByRole('button', { name: 'Other rows in this list' })).not.toBeInTheDocument()
})

test('a click outside closes the menu', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  fireEvent.click(await sideways())
  await menu()
  fireEvent.mouseDown(document.body)
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Other rows in this list' })).not.toBeInTheDocument())
})
