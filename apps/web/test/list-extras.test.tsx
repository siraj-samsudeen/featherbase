// ListView paths the merged web coverage report (ADR 0012) showed untaken:
// a text filter applied by Enter and by leaving the box; a filter-bar value
// added with Enter; an expanded row's money column totalled; a bulk edit the
// server refuses; and the Explore button. Each asserts the rows shown or the
// page reached.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const T = 'Lx Order'
const ENC = encodeURIComponent(T)

async function seed(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: 'Lx Line', kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item' },
      { column_name: 'price', column_type: 'Currency', label: 'Price' },
    ],
  })
  await admin.post('/api/table_def', {
    name: T, id_pattern: 'prompt',
    columns: [
      { column_name: 'customer', column_type: 'Data', label: 'Customer', in_list_view: true, reqd: true },
      { column_name: 'lines', column_type: 'Sub-table', label: 'Lines', row_table: 'Lx Line' },
    ],
  })
  for (const [row_id, customer] of [['o-1', 'Asha'], ['o-2', 'Ravi'], ['o-3', 'Ashok']])
    await admin.post('/api/save_row', {
      table: T,
      row: { row_id, customer, lines: [{ item: 'Saree', price: 1200 }, { item: 'Shawl', price: 300.5 }] },
    })
}

const listedIds = () => within(screen.getByTestId('list-rows')).queryAllByTestId('row-check').length

test('a text filter applies on Enter and on leaving the box; the filter bar adds on Enter', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${ENC}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 10_000 })
  await waitFor(() => expect(listedIds()).toBe(3))

  const box = screen.getByTestId('std-filter-customer')
  await user.type(box, 'Ash{Enter}')
  await waitFor(() => expect(listedIds()).toBe(2))
  await user.clear(box)
  fireEvent.blur(box)
  await waitFor(() => expect(listedIds()).toBe(3))

  await user.selectOptions(screen.getByTestId('filter-field'), 'customer')
  await user.type(screen.getByTestId('filter-value'), 'Ravi{Enter}')
  await waitFor(() => expect(listedIds()).toBe(1))
})

test("an expanded row totals its money column", async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${ENC}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 10_000 })
  await user.click((await screen.findAllByTestId('row-expand'))[0])
  const lines = await screen.findByTestId('inline-children-lines')
  await waitFor(() => expect(lines).toHaveTextContent('Σ Price: '))
  expect(lines.textContent).toMatch(/Σ Price: ₹\s?1,500\.50/)
})

test('a bulk edit the server refuses says why, and leaves the rows as they were', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${ENC}`, admin)
  await screen.findByTestId('list-view', {}, { timeout: 10_000 })
  await waitFor(() => expect(listedIds()).toBe(3))
  await user.click(within(screen.getByTestId('list-rows')).getAllByTestId('row-check')[0])
  await user.selectOptions(await screen.findByTestId('bulk-edit-field'), 'customer')
  // Customer is required: clearing it is refused.
  await user.click(screen.getByTestId('bulk-edit-apply'))
  expect(await screen.findByTestId('bulk-error')).toHaveTextContent('Invalid values for Lx Order')
  const rows = (await admin.get(`/api/table/${ENC}?fields=${encodeURIComponent('["customer"]')}`)) as { data: { customer: string }[] }
  expect(rows.data.map((r) => r.customer).sort()).toEqual(['Asha', 'Ashok', 'Ravi'])
})

test('Explore opens the explorer starting from this table', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/${ENC}`, admin)
  await user.click(await screen.findByTestId('open-explore', {}, { timeout: 10_000 }))
  expect(await screen.findByTestId('explore-view')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('explore-root')).toHaveValue(T))
  expect(await screen.findByTestId('explore-pane1')).toHaveTextContent('Asha')
})
