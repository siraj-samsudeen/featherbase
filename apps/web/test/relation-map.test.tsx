// The relationship map, the row page's Map tab (spec: search-and-explore,
// relational-navigation; #910 checklist 17). A row's neighbourhood one step
// out: what it points to, what points back with a count. Clicking a box shows
// that row in the drill pane and leaves the map where it is; Focus here
// re-centres it. The separate map page is gone.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { createUserWithRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })

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

/** The row page of `row`, on its Map tab. */
async function openMap(admin: Parameters<typeof renderApp>[1], table: string, row: string) {
  const view = await renderApp(`${tableHref(table)}/row/${row}`, admin)
  fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
  await screen.findByTestId('relation-map')
  return view
}

test('the map shows what a row points to and what points back, with a count', async ({ admin }) => {
  await seed(admin)
  const order = await openMap(admin, 'Rm Order', 'ord-1')
  // The box names the link in words, beside the Table it leads to (#794).
  expect(await screen.findByTestId('map-forward-Rm Customer')).toHaveTextContent('Customer · Rm Customer')
  // Nothing points back at an order, so no collection is drawn for it.
  expect(screen.queryByTestId('map-group-Rm Order')).not.toBeInTheDocument()
  order.unmount()

  await openMap(admin, 'Rm Customer', 'cust-1')
  const back = await screen.findByTestId('map-group-Rm Order')
  expect(back).toHaveTextContent('2')
  await waitFor(() => expect(back).toHaveTextContent('via Customer'))
})

/** Someone who can read orders but not the customers they point at. */
async function orderViewer(admin: Parameters<typeof renderApp>[1], createUser: Parameters<typeof createUserWithRole>[1]) {
  await seed(admin)
  return createUserWithRole(admin, createUser, { role: 'Rm Order Viewer', table: 'Rm Order', can_read: true })
}

test("a link to a row the viewer can't read is no button in the narrow map", async ({ admin, createUser }) => {
  const viewer = await orderViewer(admin, createUser)
  await openMap(viewer, 'Rm Order', 'ord-1')
  const link = () => screen.getByTestId('map-narrow-forward-Rm Customer')
  await waitFor(() => expect(link()).toHaveTextContent('A row you cannot see'))
  expect(link().closest('button')).toBeNull()
})

test("clicking a link to a row the viewer can't read opens no pane", async ({ admin, createUser }) => {
  const viewer = await orderViewer(admin, createUser)
  await openMap(viewer, 'Rm Order', 'ord-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  await waitFor(() => expect(box).toHaveTextContent('Not visible to you'))
  fireEvent.click(box)
  // Let a pane that would open have the time to.
  await new Promise((r) => setTimeout(r, 500))
  expect(screen.queryByRole('complementary', { name: 'A row you cannot see' })).not.toBeInTheDocument()
})

test('clicking a linked row shows it in the drill pane; the map stays centred', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  fireEvent.click(await screen.findByTestId('map-forward-Rm Customer'))
  expect(await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })).toBeInTheDocument()
  expect(screen.getByTestId('map-center')).toHaveTextContent('First order')
})

test('clicking a collection shows its rows in the drill pane', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  fireEvent.click(await screen.findByTestId('map-group-Rm Order'))
  const pane = await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })
  await waitFor(() => expect(within(within(pane).getByRole('table')).getAllByRole('row')).toHaveLength(3))
  expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores')
})

test('Focus here re-centres the map on the row in the pane', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  fireEvent.click(await screen.findByTestId('map-forward-Rm Customer'))
  const pane = await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })
  fireEvent.click(await within(pane).findByRole('button', { name: 'Focus here' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
  expect(await screen.findByTestId('map-group-Rm Order')).toHaveTextContent('2')
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
})

// #907: a row known by a code reads by its name on the map.
test('a code-keyed row reads by its name in its box', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Rm State', id_pattern: 'prompt', title_column: 'state_name',
    columns: [{ column_name: 'state_name', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Rm Depot', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'state', column_type: 'Reference', reference_table: 'Rm State', label: 'State' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Rm State', row: { row_id: '32', state_name: 'Kerala' } })
  await admin.post('/api/save_row', { table: 'Rm Depot', row: { row_id: 'd-1', title: 'Kochi depot', state: '32' } })
  await openMap(admin, 'Rm Depot', 'd-1')
  const box = await screen.findByTestId('map-forward-Rm State')
  await waitFor(() => expect(box).toHaveTextContent('Kerala'))
  expect(box).not.toHaveTextContent(/\b32\b/)
})

test('the narrow layout exposes every backlink count through buttons', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Rm Note', id_pattern: 'prompt',
    columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Rm Customer' }],
  })
  await admin.post('/api/save_row', { table: 'Rm Note', row: { row_id: 'note-1', customer: 'cust-1' } })
  await openMap(admin, 'Rm Customer', 'cust-1')
  const narrow = within(await screen.findByTestId('map-narrow'))
  expect(await narrow.findByTestId('map-narrow-group-Rm Order')).toHaveTextContent('2')
  expect(await narrow.findByTestId('map-narrow-group-Rm Note')).toHaveTextContent('1')
  fireEvent.click(narrow.getByTestId('map-narrow-group-Rm Order'))
  expect(await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })).toBeInTheDocument()
})

test('an unconnected row says it has no related rows', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Rm Alone', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Rm Alone', row: { row_id: 'alone-1', title: 'Unconnected row' } })
  await openMap(admin, 'Rm Alone', 'alone-1')
  expect(within(screen.getByTestId('map-narrow')).getByText('No related rows')).toBeInTheDocument()
})

// A sub-table on the map: its rows are a collection on the parent, and a row
// of it points back up at its parent.
test('a sub-table shows as a collection of its rows, and a row of it points back at its parent', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Rm Line', kind: 'sub_table',
    columns: [
      { column_name: 'item', column_type: 'Data', label: 'Item', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  await admin.post('/api/table_def', {
    name: 'Rm Invoice', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Rm Line', label: 'Lines' },
    ],
  })
  const saved = await admin.post<{ lines: { row_id: string }[] }>('/api/save_row', {
    table: 'Rm Invoice',
    row: { row_id: 'inv-1', title: 'March invoice', lines: [{ item: 'Saree', qty: 2 }, { item: 'Shawl', qty: 1 }] },
  })
  const invoice = await openMap(admin, 'Rm Invoice', 'inv-1')
  expect(await screen.findByTestId('map-group-Rm Line')).toHaveTextContent('2')
  invoice.unmount()
  await openMap(admin, 'Rm Line', saved.lines[0].row_id)
  await waitFor(() => expect(screen.getByTestId('map-forward-Rm Invoice')).toHaveTextContent('March invoice'))
})

test('the separate map page is gone', async ({ admin }) => {
  await seed(admin)
  await renderApp(`${tableHref('Rm Order')}/row/ord-1/map`, admin)
  expect(await screen.findByTestId('page-not-found')).toBeInTheDocument()
})

test("the map's centre box never shows the row's id while its name is on its way", async ({ admin }) => {
  await seed(admin)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const real = globalThis.fetch
  const held = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('/api/row_titles')) await gate
    return real(input, init)
  })
  try {
    await openMap(admin, 'Rm Order', 'ord-1')
    const centre = await screen.findByTestId('map-center')
    expect(centre).not.toHaveTextContent('ord-1')
    expect(screen.getByTestId('map-svg')).not.toHaveAttribute('aria-label', expect.stringContaining('ord-1'))
    release()
    await waitFor(() => expect(centre).toHaveTextContent('First order'))
  } finally {
    release()
    held.mockRestore()
  }
})

// Checklist 21: the map works from the keyboard.
test('a linked row on the map is reached by Tab and shown in the pane by Enter', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  expect(box).toHaveAttribute('tabindex', '0')
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })).toBeInTheDocument()
})

test('a collection on the map is reached by Tab and shown in the pane by Space', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  const box = await screen.findByTestId('map-group-Rm Order')
  expect(box).toHaveAttribute('tabindex', '0')
  fireEvent.keyDown(box, { key: ' ' })
  const pane = await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })
  await waitFor(() => expect(within(within(pane).getByRole('table')).getAllByRole('row')).toHaveLength(3))
})

test("a link to a row the viewer can't read is not in the tab order", async ({ admin, createUser }) => {
  const viewer = await orderViewer(admin, createUser)
  await openMap(viewer, 'Rm Order', 'ord-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  await waitFor(() => expect(box).toHaveTextContent('Not visible to you'))
  expect(box).not.toHaveAttribute('tabindex')
})

// Beside the pane the map keeps its drawing at its full size, so its text
// never shrinks below legible; a narrow frame scrolls it sideways instead.
test('the map drawing never shrinks below its own size; a narrow frame scrolls it', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  const svg = screen.getByTestId('map-svg')
  expect(svg.getAttribute('class')).toMatch(/\bmin-w-\[56rem\]/)
  expect(svg.parentElement!.className).toMatch(/\boverflow-x-auto\b/)
})

test('a link to a row of any Table shows the row it points at (#881)', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Rm Decision', id_pattern: 'prompt',
    columns: [
      { column_name: 'about_table', label: 'About Table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'about', label: 'About', column_type: 'Reference', table_column: 'about_table', choices: 'Rm Customer' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Rm Decision', row: { row_id: 'dec-1', about_table: 'Rm Customer', about: 'cust-1' } })
  await openMap(admin, 'Rm Decision', 'dec-1')
  expect(await screen.findByTestId('map-forward-Rm Customer')).toHaveTextContent('About · Rm Customer')
})

test('a linked row in the narrow map shows it in the drill pane', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  const narrow = within(await screen.findByTestId('map-narrow'))
  fireEvent.click(await narrow.findByTestId('map-narrow-forward-Rm Customer'))
  expect(await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })).toBeInTheDocument()
})

test('a key other than Enter or Space on a map box opens nothing', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  expect(fireEvent.keyDown(box, { key: 'a' })).toBe(true)
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByRole('complementary', { name: 'Asha Stores · cust-1' })).not.toBeInTheDocument()
})

test("a link's long name is cut to two lines on its map box, ending in …", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Rm Claim', id_pattern: 'prompt',
    columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Rm Customer',
      label: 'The customer who first raised this claim with the regional office last year' }],
  })
  await admin.post('/api/save_row', { table: 'Rm Claim', row: { row_id: 'claim-1', customer: 'cust-1' } })
  await openMap(admin, 'Rm Claim', 'claim-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  // Its full name stays the box's tooltip; the box draws two lines.
  const drawn = [...box.querySelectorAll('tspan')].map((t) => t.textContent)
  expect(drawn).toEqual(['The customer who first raised', 'this claim with the regional…'])
})
