// #1282 C14, the peek stack (UI owner's decision A, 18-Nov-2026): the drill pane is
// the peek. Its header reads "← · Level N of N · Open Full Page · ✕": each drill in
// the pane is a level, ← steps back one, ✕ and Esc close the whole pane, and each
// group shows its first 4 rows, then "+ N more". A linked name on the record page's
// Links tab opens the same pane, at Level 1 of 1.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

type Client = Parameters<typeof renderApp>[1]

async function seed(admin: Client) {
  await admin.post('/api/table_def', {
    name: 'Pk Rep', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/save_row', { table: 'Pk Rep', row: { row_id: 'r1', title: 'Anu Rep' } })
  await admin.post('/api/table_def', {
    name: 'Pk Customer', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Pk Order', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Pk Customer', in_list_view: true },
      { column_name: 'rep', column_type: 'Reference', reference_table: 'Pk Rep', in_list_view: true },
    ],
  })
  await admin.post('/api/save_row', { table: 'Pk Customer', row: { row_id: 'c1', title: 'Asha Stores' } })
  await admin.post('/api/save_row', { table: 'Pk Customer', row: { row_id: 'c2', title: 'Bala Traders' } })
  for (let i = 1; i <= 6; i++)
    await admin.post('/api/save_row', { table: 'Pk Order', row: { row_id: `o${i}`, title: `Order ${i}`, customer: 'c1', rep: 'r1' } })
  await admin.post('/api/save_row', { table: 'Pk Order', row: { row_id: 'b1', title: 'Bala order', customer: 'c2', rep: 'r1' } })
}

const panel = () => screen.getByTestId('record-panel')
const level = () => within(panel()).getByTestId('peek-level').textContent

/** Asha's page, Links tab: a plain click on an order opens it in the pane, at Level 1 of 1. */
async function peekFromLinks(admin: Client) {
  await renderApp(`${tableHref('Pk Customer')}/row/c1`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))
  fireEvent.click(await screen.findByRole('link', { name: 'Order 1' }))
  await screen.findByRole('complementary', { name: /Order 1/ })
}

test('a linked name on the Links tab peeks in the pane at Level 1 of 1, with Open Full Page and no step back', async ({ admin }) => {
  await seed(admin)
  await peekFromLinks(admin)
  expect(level()).toBe('Level 1 of 1')
  expect(within(panel()).getByRole('button', { name: 'Back one level' })).toBeDisabled()
  expect(within(panel()).getByRole('link', { name: 'Open Full Page' })).toHaveAttribute('href', expect.stringContaining(`${tableHref('Pk Order')}/row/o1`))
  // The page underneath is still Asha's.
  expect(screen.getAllByRole('heading', { level: 1 })[0]).toHaveTextContent('Asha Stores')
})

test('each drill in the pane is a level: three deep, ← steps back one, ✕ closes the whole pane', async ({ admin }) => {
  await seed(admin)
  await peekFromLinks(admin)
  // Level 2: the order's rep. Level 3: one of the rep's other orders.
  fireEvent.click(await within(panel()).findByRole('link', { name: /Anu Rep/ }))
  await screen.findByRole('complementary', { name: /Anu Rep/ })
  await waitFor(() => expect(level()).toBe('Level 2 of 2'))
  fireEvent.click(await within(panel()).findByRole('button', { name: /^Pk Order/ }))
  fireEvent.click(await within(panel()).findByRole('link', { name: 'Order 3' }))
  await screen.findByRole('complementary', { name: /Order 3/ })
  await waitFor(() => expect(level()).toBe('Level 3 of 3'))
  fireEvent.click(within(panel()).getByRole('button', { name: 'Back one level' }))
  await screen.findByRole('complementary', { name: /Anu Rep/ })
  await waitFor(() => expect(level()).toBe('Level 2 of 3'))
  fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument())
  expect(screen.getAllByRole('heading', { level: 1 })[0]).toHaveTextContent('Asha Stores')
})

test('Esc closes the whole pane, whatever level it is at', async ({ admin }) => {
  await seed(admin)
  await peekFromLinks(admin)
  fireEvent.click(await within(panel()).findByRole('link', { name: /Anu Rep/ }))
  await waitFor(() => expect(level()).toBe('Level 2 of 2'))
  fireEvent.keyDown(panel(), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument())
})

test('a group in the pane shows its first 4 rows, then + N more', async ({ admin }) => {
  await seed(admin)
  await peekFromLinks(admin)
  fireEvent.click(await within(panel()).findByRole('link', { name: /Anu Rep/ }))
  await screen.findByRole('complementary', { name: /Anu Rep/ })
  fireEvent.click(await within(panel()).findByRole('button', { name: /^Pk Order/ }))
  await waitFor(() => expect(within(panel()).getAllByTestId('linked-row')).toHaveLength(4))
  expect(within(panel()).getByRole('link', { name: '+ 3 more' })).toHaveAttribute('href', expect.stringContaining(tableHref('Pk Order')))
})
