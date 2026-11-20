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

// #1349 item 3 (board 4b): the pane's Pointed At By shows only groups with rows; the empty ones fold behind one
// muted "+ N tables with none".
test("the pane's empty groups fold behind + N tables with none", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Pk Note', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data' }, { column_name: 'rep', column_type: 'Reference', reference_table: 'Pk Rep' }],
  })
  await peekFromLinks(admin)
  fireEvent.click(await within(panel()).findByRole('link', { name: /Anu Rep/ }))
  await screen.findByRole('complementary', { name: /Anu Rep/ })
  expect(await within(panel()).findByRole('button', { name: /^Pk Order/ })).toBeInTheDocument()
  expect(within(panel()).queryByRole('button', { name: /^Pk Note/ })).not.toBeInTheDocument()
  fireEvent.click(within(panel()).getByRole('button', { name: '+ 1 table with none' }))
  expect(within(panel()).getByRole('button', { name: /^Pk Note/ })).toBeInTheDocument()
  fireEvent.click(within(panel()).getByRole('button', { name: 'Hide 1 table with none' }))
  expect(within(panel()).queryByRole('button', { name: /^Pk Note/ })).not.toBeInTheDocument()
})

test('a record nothing points at says so, with the empty tables folded beside the words', async ({ admin }) => {
  await seed(admin)
  // Nothing links to an order.
  await peekFromLinks(admin)
  const pointed = within(panel()).getByRole('heading', { name: 'Pointed At By' }).parentElement!
  await waitFor(() => expect(pointed).toHaveTextContent('Nothing points at this pk order yet.'))
})

// #1348 board 4: the pane draws a record's values as the list does: a status chip under the name (and not in
// the kicker), the source as the shared tag, a code small mono grey, a run time as time, a yes/no muted.
test("the pane draws a record's values in the calmer look", async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Pk Shop', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Pk Visit', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'shop', column_type: 'Reference', reference_table: 'Pk Shop', in_list_view: true },
      { column_name: 'status', column_type: 'Choice', choices: 'Open\nClosed' },
      { column_name: 'source_system', column_type: 'Choice', choices: 'SAP\nOther' },
      { column_name: 'visit_code', column_type: 'Data' },
      { column_name: 'last_duration_ms', column_type: 'Int' },
      { column_name: 'done', column_type: 'Check' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Pk Shop', row: { row_id: 's1', title: 'Bayside Shop' } })
  await admin.post('/api/save_row', { table: 'Pk Visit', row: {
    row_id: 'v1', title: 'Morning visit', shop: 's1', status: 'Open', source_system: 'SAP', visit_code: 'MV-1', last_duration_ms: 65000, done: true,
  } })
  await renderApp(`${tableHref('Pk Shop')}/row/s1`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Links' }))
  fireEvent.click(await screen.findByRole('link', { name: 'Morning visit' }))
  await screen.findByRole('complementary', { name: /Morning visit/ })
  await waitFor(() => expect(within(panel()).getByTestId('record-status-chips')).toHaveTextContent('Open'))
  expect(within(panel()).getByTestId('record-panel-kind').textContent).not.toContain('Open')
  const block = await within(panel()).findByTestId('field-block')
  expect(within(block).getByText('SAP').className).toMatch(/\bbg-tag\b/)
  expect(within(block).getByText('MV-1').className).toMatch(/\bfont-mono\b/)
  expect(within(block).getByText('1 min 5 s')).toBeInTheDocument()
  expect(within(block).getByText('Yes').className).toMatch(/\btext-ink-subtle\b/)
})
