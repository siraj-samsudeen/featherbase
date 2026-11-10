// Explore (spec: search-and-explore): chain tables, narrow by clicking with exact counts and
// sums, and open a row in the drill pane without leaving Explore (#910).
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
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

/** The drill pane, on the purchase named `name` (its code may follow). */
const pane = (name: RegExp) => screen.findByRole('complementary', { name })
const noPane = () => expect(screen.queryByRole('complementary', { name: /^po-/ })).not.toBeInTheDocument()

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

test('opening a row from Explore shows it in the drill pane and leaves Explore as it was', async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Supplier')}&chain=${chain}`, admin)
  const pane1 = await screen.findByTestId('explore-pane1')
  await waitFor(() => expect(within(pane1).getAllByTestId('explore-row')).toHaveLength(2))
  fireEvent.click(within(pane1).getAllByTitle('Show in the pane')[0], { bubbles: true })
  const panel = await screen.findByRole('complementary', { name: /Acme|Bolt Co/ })
  expect(panel).toHaveTextContent('Ex Supplier')
  // Explore is still on the page, and nothing was selected by opening the row.
  expect(screen.getByTestId('explore-view')).toBeInTheDocument()
  expect(pane1.querySelector('[data-selected]')).toBeNull()
  fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: /Acme|Bolt Co/ })).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('explore-pane2-count')).toHaveTextContent('3'))
})

for (const activation of ['click', 'Enter', ' '] as const) {
  test(`last-pane ${activation} opens the drill pane and preserves the upstream selection after closing`, async ({ admin }) => {
    await seed(admin)
    await renderApp(`/featherbase/admin/explore?root=${enc('Ex Supplier')}&chain=${chain}`, admin)
    const pane1 = await screen.findByTestId('explore-pane1')
    fireEvent.click(within(pane1).getByText('Acme'))
    await waitFor(() => expect(screen.getByTestId('explore-pane2-count')).toHaveTextContent('2'))
    await waitFor(() => expect(screen.getByTestId('explore-pane2-sum')).toHaveTextContent('150'))
    const row = within(screen.getByTestId('explore-pane2')).getAllByTestId('explore-row')[0]
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    noPane()
    if (activation === 'click') fireEvent.click(row)
    else fireEvent.keyDown(row, { key: activation })
    const panel = await pane(/^po-/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    await waitFor(noPane)
    expect(pane1.querySelector('[data-selected]')).not.toBeNull()
    expect(screen.getByTestId('explore-pane2-count')).toHaveTextContent('2')
    expect(screen.getByTestId('explore-pane2-sum')).toHaveTextContent('150')
    expect(screen.getAllByTestId('explore-chip')).toHaveLength(1)
  })
}

test("Explore's drill pane offers no Filter, since no list sits under it", async ({ admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Purchase')}`, admin)
  const pane1 = await screen.findByTestId('explore-pane1')
  await waitFor(() => expect(within(pane1).getAllByTestId('explore-row')).toHaveLength(3))
  fireEvent.click(within(pane1).getAllByTitle('Show in the pane')[0], { bubbles: true })
  const panel = await pane(/^po-/)
  expect(await within(panel).findByRole('button', { name: 'Go there' })).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument()
})

test('a supplier with no purchases leaves the purchases pane reading No rows', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Ex Supplier', row: { row_id: 'sup-c', title: 'Calm Ltd' } })
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Supplier')}&chain=${chain}`, admin)
  fireEvent.click(within(await screen.findByTestId('explore-pane1')).getByText('Calm Ltd'))
  await waitFor(() => expect(screen.getByTestId('explore-pane2')).toHaveTextContent('No rows'))
})

test('a purchase with no title reads by its id, and its empty amount as a dash', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/save_row', { table: 'Ex Purchase', row: { row_id: 'po-blank', supplier: 'sup-b' } })
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Purchase')}`, admin)
  const pane1 = await screen.findByTestId('explore-pane1')
  await waitFor(() => expect(within(pane1).getAllByTestId('explore-row')).toHaveLength(4))
  const blank = within(pane1).getAllByTestId('explore-row').find((row) => row.textContent?.startsWith('po-blank'))!
  await waitFor(() => expect(blank).toHaveTextContent(/^po-blank◎Bolt Co—$/))
})

test('a table with more rows than a pane holds says how many it shows', async ({ admin }) => {
  await seed(admin)
  for (let i = 0; i < 98; i++)
    await admin.post('/api/save_row', { table: 'Ex Purchase', row: { row_id: `po-x${i}`, title: `po-x${i}`, supplier: 'sup-b', amount: 1 } })
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Purchase')}`, admin)
  const pane1 = await screen.findByTestId('explore-pane1')
  await waitFor(() => expect(pane1).toHaveTextContent('101 rows · showing 100'))
})

test('a table whose rows the network drops says it cannot be loaded', async ({ admin }) => {
  await seed(admin)
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return url.startsWith('/api/table/Ex%20Purchase?') ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
  await renderApp(`/featherbase/admin/explore?root=${enc('Ex Purchase')}`, admin)
  expect(await screen.findByText('Cannot load Ex Purchase')).toBeInTheDocument()
})
