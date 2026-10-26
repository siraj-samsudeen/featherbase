// Relational navigation (#100): from a record's Connections, peek at the rows
// that point at it, step into one of them (its fields, its sub-table, its own
// connections), and close the stack again; and the related tabs above the
// form, which open a short embedded list of the same rows. These are the
// paths the merged web coverage report (ADR 0012) showed no test taking —
// core-forms.test.tsx covers peeking along a Reference field only.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Saved = { row_id: string }
const enc = encodeURIComponent

async function seed(admin: { post: <T>(p: string, b: unknown) => Promise<T> }) {
  await admin.post('/api/table_def', {
    name: 'Pc Customer',
    columns: [{ column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Pc Product',
    columns: [{ column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Pc Line',
    kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item' },
      { column_name: 'qty', column_type: 'Int', label: 'Qty' },
      { column_name: 'product', column_type: 'Reference', label: 'Product', reference_table: 'Pc Product' },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Pc Order',
    columns: [
      { column_name: 'label', column_type: 'Data', label: 'Label', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', label: 'Customer', reference_table: 'Pc Customer' },
      { column_name: 'paid', column_type: 'Check', label: 'Paid' },
      { column_name: 'stage', column_type: 'Choice', label: 'Stage', choices: 'Open\nShipped' },
      { column_name: 'note', column_type: 'Data', label: 'Note' },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Pc Line' },
    ],
  })
  const asha = await admin.post<Saved>('/api/save_row', { table: 'Pc Customer', row: { label: 'Asha' } })
  const saree = await admin.post<Saved>('/api/save_row', { table: 'Pc Product', row: { label: 'Silk saree' } })
  const order = await admin.post<Saved>('/api/save_row', {
    table: 'Pc Order',
    row: {
      label: 'First order',
      customer: asha.row_id,
      paid: true,
      stage: 'Shipped',
      lines: [
        { item: 'Saree', qty: 2, product: saree.row_id },
        { item: 'Shawl', qty: 1 },
      ],
    },
  })
  await admin.post('/api/save_row', { table: 'Pc Order', row: { label: 'Second order', customer: asha.row_id } })
  return { asha, saree, order }
}

test('peek at a connection: its rows, then one row with its lines, a deeper link, and back out', async ({ admin }) => {
  const { asha, saree, order } = await seed(admin)
  await renderApp(`/featherbase/admin/${enc('Pc Customer')}/${asha.row_id}`, admin)
  await screen.findByTestId('connections-panel', {}, { timeout: 10_000 })
  expect(await screen.findByTestId('connection-count-Pc Order')).toHaveTextContent('2')

  // The connection's rows, read-only, in a panel over the form.
  fireEvent.click(screen.getByTestId('connection-peek-Pc Order'))
  const list = await screen.findByTestId('peek-panel-0')
  const rows = await within(list).findAllByTestId('peek-list-row')
  expect(rows).toHaveLength(2)
  expect(within(list).getByText('First order')).toBeInTheDocument()

  // One row: its fields as values, its sub-table as a grid, its connections.
  fireEvent.click(rows.find((r) => r.textContent?.includes('First order'))!)
  const record = await screen.findByTestId('peek-panel-1')
  expect(within(record).getByTestId('peek-title')).toHaveTextContent(order.row_id)
  expect(within(record).getByText('level 2 of 2', { exact: false })).toBeInTheDocument()
  const fields = await within(record).findByTestId('peek-record')
  expect(within(fields).getByText('✓')).toBeInTheDocument() // Paid
  expect(within(fields).getByText('Shipped')).toBeInTheDocument()
  expect(within(fields).getByTestId('peek-ref-customer')).toHaveTextContent(asha.row_id)
  expect(await within(fields).findByText('Lines (2)')).toBeInTheDocument()
  expect(within(fields).getByText('Saree')).toBeInTheDocument()
  expect(within(fields).getAllByText('—').length).toBeGreaterThan(0) // the empty Note, the line with no product

  // A Reference inside a sub-table row peeks one level deeper.
  fireEvent.click(within(fields).getByRole('button', { name: saree.row_id }))
  const deeper = await screen.findByTestId('peek-panel-2')
  expect(await within(deeper).findByText('Silk saree')).toBeInTheDocument()

  // Esc closes the whole stack; the form is still there.
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByTestId('peek-panel-0')).not.toBeInTheDocument())
  expect(screen.getByTestId('connections-panel')).toBeInTheDocument()

  // The scrim closes it too.
  fireEvent.click(screen.getByTestId('connection-peek-Pc Order'))
  await screen.findByTestId('peek-panel-0')
  fireEvent.click(screen.getByTestId('peek-scrim'))
  await waitFor(() => expect(screen.queryByTestId('peek-panel-0')).not.toBeInTheDocument())
})

test("a peeked record's own connections open as a list, and ↗ on a list opens the filtered list itself", async ({ admin }) => {
  const { asha } = await seed(admin)
  await renderApp(`/featherbase/admin/${enc('Pc Customer')}/${asha.row_id}`, admin)
  await screen.findByTestId('connections-panel', {}, { timeout: 10_000 })
  fireEvent.click(screen.getByTestId('connection-peek-Pc Order'))
  const list = await screen.findByTestId('peek-panel-0')
  fireEvent.click((await within(list).findAllByTestId('peek-list-row'))[0])
  const record = await screen.findByTestId('peek-panel-1')
  fireEvent.click(await within(record).findByTestId('peek-ref-customer'))
  const customer = await screen.findByTestId('peek-panel-2')
  // The customer's connections, inside the peek: Orders, with their count.
  const orders = await within(customer).findByTestId('peek-connection-Pc Order')
  expect(orders).toHaveTextContent('2')
  fireEvent.click(orders)
  const again = await screen.findByTestId('peek-panel-3')
  expect(await within(again).findAllByTestId('peek-list-row')).toHaveLength(2)

  fireEvent.click(within(again).getByTestId('peek-open-full'))
  await waitFor(() => expect(screen.queryByTestId('peek-panel-0')).not.toBeInTheDocument())
  // The filtered list itself: both of this customer's orders, as a real page.
  const page = await screen.findByTestId('list-view')
  await waitFor(() => expect(within(page).getByText('First order')).toBeInTheDocument())
  expect(within(page).getByText('Second order')).toBeInTheDocument()
  expect(screen.queryByTestId('form-view')).not.toBeInTheDocument()
})

test('related tabs open a short list of the rows that point here, with ways on to the full list and a new row', async ({ admin }) => {
  const user = userEvent.setup()
  const { asha, order } = await seed(admin)
  await renderApp(`/featherbase/admin/${enc('Pc Customer')}/${asha.row_id}`, admin)
  const tab = await screen.findByTestId('related-tab-Pc Order', {}, { timeout: 10_000 })
  expect(within(tab).getByTestId('related-count-Pc Order')).toHaveTextContent('2')
  await user.click(tab)
  expect(tab).toHaveAttribute('aria-expanded', 'true')
  const embedded = await screen.findByTestId('embedded-list')
  await waitFor(() =>
    expect(embedded.querySelectorAll('tbody a')).toHaveLength(2),
  )
  expect(embedded.querySelector(`a[href$="/${enc('Pc Order')}/${order.row_id}"]`)).not.toBeNull()
  expect(within(embedded).getByTestId('embedded-open-list')).toHaveAttribute(
    'href',
    expect.stringContaining(`/featherbase/admin/${enc('Pc Order')}`),
  )
  const create = within(embedded).getByTestId('embedded-new')
  expect(create).toHaveTextContent('+ New Pc Order')
  // The router writes the search value as JSON, so the prefill string is quoted once more.
  const prefill = new URL(create.getAttribute('href')!, 'http://x').searchParams.get('prefill')!
  expect(JSON.parse(JSON.parse(prefill) as string)).toEqual({ customer: asha.row_id })

  // Pressing the tab again folds the list away.
  await user.click(tab)
  expect(tab).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('embedded-list')).not.toBeInTheDocument()
})
