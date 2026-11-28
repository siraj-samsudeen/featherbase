// #1343 items 8–9 and #1349 item 4, the walk: "‹ 3 of 12 ›" beside the path bar's last step moves to the previous
// or next row of the list or group that step came from, replacing the step as the sideways ▾ does; ↑/↓ do the same
// when focus isn't in an input. The order is the one the rows were seen in, and the ends don't wrap. Made-up names.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { encodePath, type NavPath } from '../src/lib/nav-path'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]

async function seed(admin: Client, orders = 6) {
  await admin.post('/api/table_def', { row_rule: { kind: 'all' },
    name: 'Wk Customer', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', { row_rule: { kind: 'all' },
    name: 'Wk Order', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Wk Customer', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Wk Customer', row: { row_id: 'c1', title: 'Asha Stores' } })
  await admin.post('/api/save_row', { table: 'Wk Customer', row: { row_id: 'c2', title: 'Bala Traders' } })
  for (let i = 1; i <= orders; i++)
    await admin.post('/api/save_row', { table: 'Wk Order', row: { row_id: `o${String(i).padStart(2, '0')}`, title: `Order ${String(i).padStart(2, '0')}`, customer: 'c1' } })
  await admin.post('/api/save_row', { table: 'Wk Order', row: { row_id: 'b1', title: 'Bala order', customer: 'c2' } })
}

const ASHA = encodeURIComponent(JSON.stringify([['customer', '=', 'c1']]))
const bar = () => screen.getByRole('navigation', { name: 'Path' }).closest('[data-testid="path-bar"]') as HTMLElement
const position = () => within(bar()).findByTestId('walk-position')
const previous = () => within(bar()).getByRole('button', { name: 'Previous row' })
const next = () => within(bar()).getByRole('button', { name: 'Next row' })
const pathSteps = () => within(screen.getByRole('navigation', { name: 'Path' })).getAllByRole('button').length
const peeked = (name: string) => screen.findByRole('complementary', { name: new RegExp(name) })

/** Asha's orders as a list (filtered), with one of them open in the pane. */
async function fromFilteredList(admin: Client, order: string) {
  await renderApp(`${tableHref('Wk Order')}?filters=${ASHA}`, admin)
  const link = await screen.findByRole('link', { name: order })
  fireEvent.click(within(link.closest('tr')!).getAllByRole('cell').at(-1)!)
  await peeked(order)
}

test("‹ › beside the last step say where the row sits in its list, and › moves to the next one in place", async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  // The list's own order, newest first: Order 03 is the 4th of Asha's 6, never Bala's.
  await waitFor(async () => expect(await position()).toHaveTextContent('4 of 6'))
  const before = pathSteps()
  fireEvent.click(next())
  await peeked('Order 02')
  await waitFor(async () => expect(await position()).toHaveTextContent('5 of 6'))
  expect(pathSteps()).toBe(before)
  fireEvent.click(previous())
  await peeked('Order 03')
})

test('the ends are disabled, not wrapped', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 06')
  await waitFor(async () => expect(await position()).toHaveTextContent('1 of 6'))
  expect(previous()).toBeDisabled()
  expect(next()).toBeEnabled()
  fireEvent.click(next())
  await peeked('Order 05')
  await waitFor(() => expect(previous()).toBeEnabled())
})

test("the walk follows the list's order as the person sorted it", async ({ admin }) => {
  await seed(admin)
  await admin.put(`/api/user_settings/${encodeURIComponent('Wk Order')}`, { sort: { field: 'title', dir: 'asc' } })
  await fromFilteredList(admin, 'Order 03')
  await waitFor(async () => expect(await position()).toHaveTextContent('3 of 6'))
  fireEvent.click(next())
  await peeked('Order 04')
})

test('↓ and ↑ walk the list, but not from inside an input or with a modifier held', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  await waitFor(async () => expect(await position()).toHaveTextContent('4 of 6'))
  fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true })
  fireEvent.keyDown(screen.getAllByRole('searchbox')[0], { key: 'ArrowDown' })
  await new Promise((r) => setTimeout(r, 200))
  expect(await position()).toHaveTextContent('4 of 6')
  fireEvent.keyDown(document.body, { key: 'ArrowDown' })
  await peeked('Order 02')
  // One key, one row: the list's own handler no longer moves it a second time.
  await waitFor(async () => expect(await position()).toHaveTextContent('5 of 6'))
  fireEvent.keyDown(document.body, { key: 'ArrowUp' })
  await peeked('Order 03')
})

test('↓ does not walk while the ▾ menu is open', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  await waitFor(async () => expect(await position()).toHaveTextContent('4 of 6'))
  const trigger = within(bar()).getByRole('button', { name: 'Other rows in this list' })
  fireEvent.click(trigger)
  await screen.findByRole('menu', { name: 'Other rows in this list' })
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  await new Promise((r) => setTimeout(r, 200))
  expect(await position()).toHaveTextContent('4 of 6')
})

test('from a record page reached from the list, › opens the next row page', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 03')
  fireEvent.click(within(await peeked('Order 03')).getByRole('link', { name: 'Open Full Page' }))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: /Order 03/ })).not.toBeInTheDocument())
  await waitFor(async () => expect(await position()).toHaveTextContent('4 of 6'))
  // One walk on screen (UI owner, W5): the page's own ‹ N of M › gives way to the path bar's.
  expect(screen.queryByTestId('record-nav')).not.toBeInTheDocument()
  fireEvent.click(next())
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Order 02'))
})

test('from a Map group row, the walk goes through the rows of that group', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Wk Customer')}/row/c1`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  const box = await screen.findByTestId('map-group-Wk Order')
  fireEvent.click(await within(box).findByRole('button', { name: 'Focus on Order 02' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Order 02'))
  await waitFor(async () => expect(await position()).toHaveTextContent('2 of 6'))
  fireEvent.click(next())
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Order 03'))
})

test('no ‹ › where the step came from no list or group', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Wk Order')}/row/o02`, admin)
  await screen.findByRole('heading', { level: 1 })
  expect(screen.queryByTestId('walk-position')).not.toBeInTheDocument()
})

test('↓ at the last row and other keys move nothing', async ({ admin }) => {
  await seed(admin)
  await fromFilteredList(admin, 'Order 01')
  await waitFor(async () => expect(await position()).toHaveTextContent('6 of 6'))
  fireEvent.keyDown(document.body, { key: 'ArrowDown' })
  fireEvent.keyDown(document.body, { key: 'j' })
  await new Promise((r) => setTimeout(r, 200))
  expect(await position()).toHaveTextContent('6 of 6')
  expect(await peeked('Order 01')).toBeInTheDocument()
})

test("a row its list's filter leaves out has no place to walk from", async ({ admin }) => {
  await seed(admin)
  // An address that opens Bala's order over the list of Asha's.
  const path: NavPath = { steps: [
    { screen: 'list', table: 'Wk Order' },
    { screen: 'list', table: 'Wk Order', filters: [['customer', '=', 'c1']], pane: { table: 'Wk Order', row: 'b1' } },
  ], at: 1 }
  await renderApp(`${tableHref('Wk Order')}?path=${encodeURIComponent(encodePath(path))}`, admin)
  await peeked('Bala order')
  // The ▾ reads the same rows: once they are in, it counts Asha's 6 with no place for Bala's order.
  fireEvent.click(await within(bar()).findByRole('button', { name: 'Other rows in this list' }))
  await waitFor(() => expect(screen.getByTestId('sideways-position')).toHaveTextContent(/^6 · Wk Order$/))
  expect(screen.queryByTestId('walk-position')).not.toBeInTheDocument()
})
