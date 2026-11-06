// Explore (spec: search-and-explore), the parts the merged web coverage report
// (ADR 0012) showed untaken: building a chain by hand from the pickers, a
// sub-table step, a step through a sub-table's reference ("via"), choosing a
// row from the keyboard, and releasing selections from their chips.
// explore-page.test.tsx covers a deep-linked one-step chain.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })
type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Ec Supplier', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Ec Item', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Ec Line', kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Reference', reference_table: 'Ec Item', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', in_list_view: true },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Ec Purchase', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'supplier', column_type: 'Reference', reference_table: 'Ec Supplier', in_list_view: true },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Ec Line', label: 'Lines' },
    ],
  })
  for (const [id, title] of [['sup-a', 'Acme'], ['sup-b', 'Bolt Co']])
    await admin.post('/api/save_row', { table: 'Ec Supplier', row: { row_id: id, title } })
  for (const [id, title] of [['it-bolt', 'Bolt'], ['it-nut', 'Nut']])
    await admin.post('/api/save_row', { table: 'Ec Item', row: { row_id: id, title } })
  const po = (row_id: string, supplier: string, lines: [string, number][]) =>
    admin.post('/api/save_row', {
      table: 'Ec Purchase',
      row: { row_id, title: row_id, supplier, lines: lines.map(([item, qty]) => ({ item, qty })) },
    })
  await po('po-1', 'sup-a', [['it-bolt', 5], ['it-nut', 7]])
  await po('po-2', 'sup-a', [['it-nut', 1]])
  await po('po-3', 'sup-b', [['it-bolt', 2]])
}

/** Pick the option whose words include `text`. */
async function pick(select: HTMLElement, text: string) {
  const option = await waitFor(() => {
    const hit = within(select).getAllByRole<HTMLOptionElement>('option').find((o) => o.textContent?.includes(text))
    if (!hit) throw new Error(`no option with “${text}”`)
    return hit
  })
  fireEvent.change(select, { target: { value: option.value } })
}

const count = (pane: string) => screen.getByTestId(`explore-${pane}-count`)

test('a chain built from the pickers: supplier → its purchases → their lines, narrowed and released', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp('/featherbase/admin/explore', admin)
  expect(await screen.findByTestId('explore-empty')).toBeInTheDocument()

  await pick(screen.getByTestId('explore-root'), 'Ec Supplier')
  await pick(await screen.findByTestId('explore-step2'), 'Ec Purchase · supplier')
  await pick(await screen.findByTestId('explore-step3'), 'Ec Line (Lines)')
  // Nothing selected: every purchase, and every line of them.
  await waitFor(() => expect(count('pane2')).toHaveTextContent('3'))
  await waitFor(() => expect(count('pane3')).toHaveTextContent('4'))
  expect(screen.getByTestId('explore-chips')).toHaveTextContent('No selection')

  // Choose Acme from the keyboard: its two purchases, and their three lines.
  const acme = within(screen.getByTestId('explore-pane1')).getByText('Acme').closest('[data-testid="explore-row"]') as HTMLElement
  acme.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(count('pane2')).toHaveTextContent('2'))
  await waitFor(() => expect(count('pane3')).toHaveTextContent('3'))

  // Then one purchase: only its lines.
  fireEvent.click(within(screen.getByTestId('explore-pane2')).getAllByText('po-2')[0])
  await waitFor(() => expect(count('pane3')).toHaveTextContent('1'))
  const chips = screen.getByTestId('explore-chips')
  await waitFor(() => expect(within(chips).getAllByTestId('explore-chip').map((c) => c.textContent)).toEqual([
    'Ec Supplier: Acme (sup-a)×',
    'Ec Purchase: po-2×',
  ]))

  // Release the purchase from its chip, then the supplier.
  await user.click(within(chips).getByRole('button', { name: 'Release po-2' }))
  await waitFor(() => expect(count('pane3')).toHaveTextContent('3'))
  await user.click(within(chips).getByRole('button', { name: 'Release Acme (sup-a)' }))
  await waitFor(() => expect(count('pane2')).toHaveTextContent('3'))
  expect(screen.getByTestId('explore-chips')).toHaveTextContent('No selection')

  // Changing the second step drops the third; changing the start drops both.
  await pick(screen.getByTestId('explore-step2'), '—')
  expect(screen.queryByTestId('explore-step3')).not.toBeInTheDocument()
  expect(screen.queryByTestId('explore-pane2')).not.toBeInTheDocument()
  await pick(screen.getByTestId('explore-root'), 'Ec Item')
  await waitFor(() => expect(within(screen.getByTestId('explore-pane1')).getByText('Nut')).toBeInTheDocument())
})

test('from an item, the purchases that carry it through their lines', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin/explore', admin)
  await pick(await screen.findByTestId('explore-root'), 'Ec Item')
  await pick(await screen.findByTestId('explore-step2'), 'Ec Purchase · via')
  await waitFor(() => expect(count('pane2')).toHaveTextContent('3'))
  fireEvent.click(within(screen.getByTestId('explore-pane1')).getByText('Bolt'))
  await waitFor(() => expect(count('pane2')).toHaveTextContent('2'))
  const pane2 = screen.getByTestId('explore-pane2')
  expect(pane2).toHaveTextContent('po-1')
  expect(pane2).toHaveTextContent('po-3')
  expect(pane2).not.toHaveTextContent('po-2')
})

// The final pane opens details rather than making a selection (#546).
test('a row in the third pane opens the drill pane without changing either upstream selection', async ({ admin }) => {
  await seed(admin)
  await renderApp('/featherbase/admin/explore', admin)
  await pick(await screen.findByTestId('explore-root'), 'Ec Supplier')
  await pick(await screen.findByTestId('explore-step2'), 'Ec Purchase · supplier')
  await pick(await screen.findByTestId('explore-step3'), 'Ec Line (Lines)')
  await waitFor(() => expect(count('pane3')).toHaveTextContent('4'))
  fireEvent.click(within(screen.getByTestId('explore-pane1')).getByText('Acme'))
  await waitFor(() => expect(count('pane2')).toHaveTextContent('2'))
  fireEvent.click(within(screen.getByTestId('explore-pane2')).getAllByText('po-2')[0])
  await waitFor(() => expect(count('pane3')).toHaveTextContent('1'))
  await waitFor(() => expect(screen.getByTestId('explore-chips')).not.toHaveTextContent('…'))
  const chips = screen.getByTestId('explore-chips').textContent
  const [line] = within(screen.getByTestId('explore-pane3')).getAllByTestId('explore-row')
  fireEvent.click(line)
  expect(line).not.toHaveAttribute('data-selected')
  // The drill pane shows that very line, po-2's only one: named exactly as
  // that row is, and pointing at po-2 (po-1 has a line of the same name).
  const lines = await admin.get<{ data: { row_id: string }[] }>(
    `/api/table/Ec%20Line?fields=${encodeURIComponent(JSON.stringify(['row_id']))}&filters=${encodeURIComponent(JSON.stringify([['parent', '=', 'po-2']]))}`,
  )
  expect(lines.data).toHaveLength(1)
  const { titles: [expected] } = await admin.post<{ titles: { title: string }[] }>('/api/row_titles', {
    rows: [{ table: 'Ec Line', row_id: lines.data[0].row_id }],
  })
  const panel = await screen.findByRole('complementary', { name: expected.title })
  expect(panel).toHaveTextContent('Ec Line')
  const pointsAt = (await within(panel).findByRole('heading', { name: 'Points at' })).parentElement!
  await waitFor(() => expect(pointsAt).toHaveTextContent('po-2'))
  fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(panel).not.toBeInTheDocument())
  expect(screen.getByTestId('explore-chips').textContent).toBe(chips)
  expect(count('pane2')).toHaveTextContent('2')
  expect(count('pane3')).toHaveTextContent('1')
})

test("the list's Explore button opens a chain of the dependents ticked under it", async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  const { router } = await renderApp(`/featherbase/admin/table/ec-supplier`, admin)
  await user.click(await screen.findByTestId('explore-split-toggle'))
  const [option] = await within(await screen.findByTestId('explore-split-panel')).findAllByTestId('explore-split-option')
  await user.click(option)
  expect(option).toBeChecked()
  await user.click(option)
  expect(option).not.toBeChecked()
  await user.click(option)
  await user.click(screen.getByTestId('explore-split-open'))
  await waitFor(() => expect((router.state as { location: { pathname: string } }).location.pathname).toBe('/featherbase/admin/explore'))
  await waitFor(() => expect(screen.getByTestId('explore-pane2')).toBeInTheDocument())
})

test('typing narrows the Start-from list, Enter starts from the first match, and links read as titles', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp('/featherbase/admin/explore', admin)
  const root = await screen.findByTestId('explore-root')
  await waitFor(() => expect(within(root).getAllByRole('option').map((o) => o.textContent)).toContain('Ec Purchase'))

  await user.type(screen.getByTestId('explore-root-search'), 'ec purch')
  const shown = within(root).getAllByRole('option').map((o) => o.textContent)
  expect(shown).toEqual(['1 matching table', 'Ec Purchase'])

  await user.keyboard('{Enter}')
  // Picking a root moves the page address, which renders the picker afresh.
  await waitFor(() => expect(screen.getByTestId('explore-root')).toHaveValue('Ec Purchase'))
  // A purchase's supplier shows the supplier's title, never its id.
  const pane1 = await screen.findByTestId('explore-pane1')
  await waitFor(() => expect(pane1).toHaveTextContent('Acme (sup-a)'))
})
