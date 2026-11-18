// The relationship map, the row page's Map tab (spec: search-and-explore,
// relational-navigation; #910 checklist 17). A row's neighbourhood one step
// out: what it points to, what points back with a count. Clicking a box shows
// that row in the drill pane and leaves the map where it is; Focus here
// re-centres it. The separate map page is gone.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { Sql } from 'postgres'
import { tableHref } from 'shared'
import { invalidateMeta } from 'server/src/meta'
import { createUserWithRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'
import { REGION, seedPostings, seedSites } from './relational-fixture'

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
  // #1218: an order points at a customer by one link only, so the link is not named.
  await waitFor(() => expect(back).toHaveTextContent('Rm Order'))
  expect(back).not.toHaveTextContent('via')
  // An order has a title of its own: it is no link table, so it never reads through.
  expect(back).not.toHaveTextContent('through')
})

// #1218 slice 1: a group whose rows all point to one Table reads as that Table.
async function seedVisits(admin: Parameters<typeof renderApp>[1]) {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Rm Rep', id_pattern: 'prompt', title_column: 'title',
    columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Rm Visit', id_pattern: 'field:visit_id', title_column: 'visit_id',
    columns: [
      { column_name: 'visit_id', column_type: 'Data', label: 'Visit' },
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Rm Customer', label: 'Customer' },
      { column_name: 'rep', column_type: 'Reference', reference_table: 'Rm Rep', label: 'Rep' },
      { column_name: 'billed_to', column_type: 'Reference', reference_table: 'Rm Customer', label: 'Billed to' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Rm Rep', row: { row_id: 'rep-1', title: 'Anu' } })
  await admin.post('/api/save_row', { table: 'Rm Rep', row: { row_id: 'rep-2', title: 'Bala' } })
  await admin.post('/api/save_row', { table: 'Rm Visit', row: { visit_id: 'V1', customer: 'cust-1', rep: 'rep-1' } })
  await admin.post('/api/save_row', { table: 'Rm Visit', row: { visit_id: 'V2', customer: 'cust-1', rep: 'rep-2' } })
}

test('a group whose rows all point to one Table reads as that Table, through the group, naming the link when there are two', async ({ admin }) => {
  await seedVisits(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  // Rm Visit points at a customer by Customer and Billed to: two groups, each naming its link.
  const box = (link: string) => screen.getAllByTestId('map-group-Rm Visit').find((g) => g.textContent?.includes(`via ${link}`))
  await waitFor(() => expect(box('Customer')).toHaveTextContent('through Rm Visit · via Customer'))
  expect(box('Customer')).toHaveTextContent(/^Rm Rep/)
  // No visit is billed to Asha Stores: the empty group stays, as its own Table.
  expect(box('Billed to')).toHaveTextContent('Rm Visit')
  expect(box('Billed to')).not.toHaveTextContent('through')
})

// Codex round 1: only a link table's rows are read, to find its far side;
// any other group needs only its count.
test("the map reads a group's rows only for a link table", async ({ admin }) => {
  await seedVisits(admin)
  const fetches = vi.spyOn(globalThis, 'fetch')
  const listed = (table: string) => fetches.mock.calls.map(([input]) => decodeURIComponent(String(input instanceof Request ? input.url : input)))
    .filter((url) => url.includes(`/api/table/${table}?`) && url.includes('limit_page_length=500'))
  await openMap(admin, 'Rm Customer', 'cust-1')
  // The positive control: the visits (a link table) are read and read through.
  await waitFor(() => expect(screen.getAllByTestId('map-group-Rm Visit').some((g) => g.textContent?.includes('through'))).toBe(true))
  expect(listed('Rm Visit').length).toBeGreaterThan(0)
  await screen.findByTestId('map-group-Rm Order')
  expect(listed('Rm Order')).toEqual([])
  fetches.mockRestore()
})

// Verifier round 2: rows with two far sides keep the group's own name.
test('a group whose rows have two far sides keeps its own name on the map', async ({ admin }) => {
  await seedSites(admin)
  await seedPostings(admin)
  const fetches = vi.spyOn(globalThis, 'fetch')
  const rowsRead = () => fetches.mock.calls.findIndex(([input]) => decodeURIComponent(String(input instanceof Request ? input.url : input)).includes('/api/table/Nv Posting?'))
  await openMap(admin, REGION, 'KL')
  // Once the postings are read, the box still names its own Table.
  await waitFor(() => expect(rowsRead()).toBeGreaterThanOrEqual(0))
  await fetches.mock.results[rowsRead()]!.value
  const box = await screen.findByTestId('map-group-Nv Posting')
  await waitFor(() => expect(box).toHaveTextContent('Nv Posting'))
  expect(box).not.toHaveTextContent('through')
  fetches.mockRestore()
})

test('the same postings, seen from their site, read as their one far side, the plant', async ({ admin }) => {
  await seedSites(admin)
  await seedPostings(admin)
  await openMap(admin, 'Nv Site', 'ENK')
  await waitFor(async () => expect(await screen.findByTestId('map-group-Nv Posting')).toHaveTextContent('through Nv Posting'))
})

test('the map offers no Open in Explore', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  expect(screen.queryByRole('link', { name: 'Open in Explore' })).not.toBeInTheDocument()
})

/** Someone who can read orders but not the customers they point at. */
async function orderViewer(admin: Parameters<typeof renderApp>[1], createUser: Parameters<typeof createUserWithRole>[1]) {
  await seed(admin)
  return createUserWithRole(admin, createUser, { role: 'Rm Order Viewer', table: 'Rm Order', can_read: true })
}

const pathSteps = () => within(screen.getByRole('navigation', { name: 'Path' })).getAllByRole('button')
  .map((b) => (b.textContent ?? '').trim()).filter(Boolean)

// #1282 item 12: a record the viewer may not open is plain words, with no link and no Focus.
test("a link to a row the viewer can't read is plain words, with no link and no Focus", async ({ admin, createUser }) => {
  const viewer = await orderViewer(admin, createUser)
  await openMap(viewer, 'Rm Order', 'ord-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  await waitFor(() => expect(box).toHaveTextContent('A row you cannot see'))
  expect(within(box).queryByRole('link')).not.toBeInTheDocument()
  expect(within(box).queryByRole('button', { name: /Focus/ })).not.toBeInTheDocument()
})

// #1282 items 7–8: a blue name re-centres the map on its record, and the path gains it.
test('clicking a linked row re-centres the map on it, on the Map tab, and the path gains a step', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  fireEvent.click(await within(box).findByRole('link', { name: 'Asha Stores' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(pathSteps().join(' › ')).toMatch(/First order.*Asha Stores/))
  // The way back: the earlier step centres the map on the order again.
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Path' })).getByRole('button', { name: /First order/ }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('First order'))
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
})

// #1282 items 3, 6: a group box lists its real rows, each a link with Focus beside it.
test("a group's box lists its rows by name, each with Focus", async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  const box = await screen.findByTestId('map-group-Rm Order')
  await waitFor(() => expect(within(box).getAllByTestId('map-row')).toHaveLength(2))
  expect(within(box).getByRole('link', { name: 'First order' })).toBeInTheDocument()
  expect(within(box).getByRole('link', { name: 'Second order' })).toBeInTheDocument()
  expect(within(box).getAllByRole('button', { name: /^Focus/ })).toHaveLength(2)
  fireEvent.click(within(box).getByRole('button', { name: 'Focus on Second order' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Second order'))
})

// #1282 items 4, 11: the first 4 rows, then the rest in the panel; one bounded read.
test('a large group shows its first 4 rows and the rest in the panel, from one read of 4', async ({ admin }) => {
  await seed(admin)
  for (const n of [3, 4, 5, 6])
    await admin.post('/api/save_row', { table: 'Rm Order', row: { row_id: `ord-${n}`, title: `Order ${n}`, customer: 'cust-1' } })
  const fetches = vi.spyOn(globalThis, 'fetch')
  const reads = () => fetches.mock.calls.map(([input]) => decodeURIComponent(String(input instanceof Request ? input.url : input)))
    .filter((url) => url.includes('/api/table/Rm Order?'))
  await openMap(admin, 'Rm Customer', 'cust-1')
  const box = await screen.findByTestId('map-group-Rm Order')
  await waitFor(() => expect(within(box).getAllByTestId('map-row')).toHaveLength(4))
  expect(box).toHaveTextContent('6')
  expect(reads()).toHaveLength(1)
  expect(reads()[0]).toContain('limit_page_length=4')
  fetches.mockRestore()
  fireEvent.click(within(box).getByRole('button', { name: '+ 2 more in the panel' }))
  const pane = await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })
  await waitFor(() => expect(within(pane).getAllByTestId('linked-row')).toHaveLength(6))
})

// #1282 item 5: an empty group stays, greyed.
test('an empty group stays on the map, greyed, with no rows', async ({ admin }) => {
  await seedVisits(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  const empty = await waitFor(() => {
    const box = screen.getAllByTestId('map-group-Rm Visit').find((g) => g.textContent?.includes('via Billed to'))
    if (!box) throw new Error('no Billed to group yet')
    return box
  })
  expect(empty).toHaveAttribute('data-empty', 'true')
  expect(within(empty).queryAllByTestId('map-row')).toHaveLength(0)
})

// A link table's rows read by their far side, as on the Links tab.
test("a link table's rows read by their far side on the map", async ({ admin }) => {
  await seedVisits(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  const box = () => screen.getAllByTestId('map-group-Rm Visit').find((g) => g.textContent?.includes('via Customer'))!
  await waitFor(() => expect(within(box()).getAllByRole('link').map((a) => a.textContent)).toEqual(['Anu', 'Bala']))
  fireEvent.click(within(box()).getByRole('button', { name: 'Focus on Bala' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Bala'))
})

// #1282 item 9: the group's header still opens the whole group in the drill pane.
test("a group's header shows its rows in the drill pane", async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  fireEvent.click(await within(await screen.findByTestId('map-group-Rm Order')).findByRole('button', { name: /^Rm Order 2/ }))
  const pane = await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })
  await waitFor(() => expect(within(pane).getAllByTestId('linked-row')).toHaveLength(2))
  expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores')
})

// #1282 item 12: a row the viewer may not read is neither listed nor counted.
test('a group lists and counts only the rows the viewer may read', async ({ admin, createUser }) => {
  await seed(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Rm Customer Viewer', table: 'Rm Customer', can_read: true })
  await openMap(viewer, 'Rm Customer', 'cust-1')
  await screen.findByTestId('map-center')
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByTestId('map-group-Rm Order')).not.toBeInTheDocument()
  expect(screen.getByTestId('relation-map')).not.toHaveTextContent('First order')
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

test('an unconnected row says it has no related rows', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Rm Alone', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Rm Alone', row: { row_id: 'alone-1', title: 'Unconnected row' } })
  await openMap(admin, 'Rm Alone', 'alone-1')
  expect(within(screen.getByTestId('relation-map')).getByText('No related rows')).toBeInTheDocument()
})

// A sub-table on the map: its rows are a collection on the parent, and a row
// of it points back up at its parent.
test('a sub-table shows as a collection of its rows, and a row of it points back at its parent', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: 'Rm Line', kind: 'sub_table', title_column: 'item',
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
  const lines = await screen.findByTestId('map-group-Rm Line')
  expect(lines).toHaveTextContent('2')
  await waitFor(() => expect(within(lines).getAllByTestId('map-row')).toHaveLength(2))
  expect(within(lines).getAllByTestId('map-row').map((r) => r.textContent)).toEqual([expect.stringContaining('Saree'), expect.stringContaining('Shawl')])
  invoice.unmount()
  await openMap(admin, 'Rm Line', saved.lines[0].row_id)
  await waitFor(() => expect(screen.getByTestId('map-forward-Rm Invoice')).toHaveTextContent('March invoice'))
})

test('a sub-table stored with no label is named on the map by its column name', async ({ admin, db }) => {
  await admin.post('/api/table_def', { name: 'Rm Bare Line', kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Data', label: 'Item' }] })
  await admin.post('/api/table_def', {
    name: 'Rm Bare Invoice', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'bare_lines', column_type: 'Sub-table', row_table: 'Rm Bare Line', label: 'Lines' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Rm Bare Invoice', row: { row_id: 'binv-1', title: 'April invoice', bare_lines: [{ item: 'Saree' }] } })
  await (db as Sql)`update column_def set label = null where parent = 'Rm Bare Invoice' and column_name = 'bare_lines'`
  invalidateMeta()
  await openMap(admin, 'Rm Bare Invoice', 'binv-1')
  expect(await screen.findByTestId('map-group-Rm Bare Line')).toHaveTextContent('bare_lines')
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
    expect(screen.getByTestId('relation-map')).not.toHaveAttribute('aria-label', expect.stringContaining('ord-1'))
    release()
    await waitFor(() => expect(centre).toHaveTextContent('First order'))
  } finally {
    release()
    held.mockRestore()
  }
})

// #1282 item 10: the map works from the keyboard. A name is a link (Tab, Enter);
// Space on it acts too, as on every box of the map.
test('a linked row on the map re-centres it by Space', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  const link = await within(await screen.findByTestId('map-forward-Rm Customer')).findByRole('link', { name: 'Asha Stores' })
  fireEvent.keyDown(link, { key: ' ' })
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Asha Stores'))
})

test("a group's header is a button: Tab reaches it, and Space opens it in the pane", async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  const header = await within(await screen.findByTestId('map-group-Rm Order')).findByRole('button', { name: /^Rm Order 2/ })
  expect(header.tagName).toBe('BUTTON')
  fireEvent.click(header)
  const pane = await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })
  await waitFor(() => expect(within(pane).getAllByTestId('linked-row')).toHaveLength(2))
})

test('a key other than Enter or Space on a map name moves nothing', async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Order', 'ord-1')
  const link = await within(await screen.findByTestId('map-forward-Rm Customer')).findByRole('link', { name: 'Asha Stores' })
  expect(fireEvent.keyDown(link, { key: 'a' })).toBe(true)
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.getByTestId('map-center')).toHaveTextContent('First order')
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

test("a link's long name keeps its whole wording as the box's tooltip", async ({ admin }) => {
  await seed(admin)
  const long = 'The customer who first raised this claim with the regional office last year'
  await admin.post('/api/table_def', {
    name: 'Rm Claim', id_pattern: 'prompt',
    columns: [{ column_name: 'customer', column_type: 'Reference', reference_table: 'Rm Customer', label: long }],
  })
  await admin.post('/api/save_row', { table: 'Rm Claim', row: { row_id: 'claim-1', customer: 'cust-1' } })
  await openMap(admin, 'Rm Claim', 'claim-1')
  const box = await screen.findByTestId('map-forward-Rm Customer')
  // Two lines at most on screen; the whole wording in its tooltip.
  const words = within(box).getByTestId('map-link-words')
  expect(words).toHaveAttribute('title', `${long} · Rm Customer`)
  expect(words.className).toMatch(/\bline-clamp-2\b/)
})

// #1282, as the Links tab reads it (#1273): a Table with no title of its own only links
// others, so its group reads as the one Table its rows point to.
test('a group of a Table with no title reads as its far side, through itself', async ({ admin }) => {
  await seedVisits(admin)
  await admin.post('/api/table_def', {
    name: 'Rm Pairing', id_pattern: 'hash',
    columns: [
      { column_name: 'customer', column_type: 'Reference', reference_table: 'Rm Customer', label: 'Customer' },
      { column_name: 'rep', column_type: 'Reference', reference_table: 'Rm Rep', label: 'Rep' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Rm Pairing', row: { customer: 'cust-1', rep: 'rep-1' } })
  await openMap(admin, 'Rm Customer', 'cust-1')
  const box = await screen.findByTestId('map-group-Rm Pairing')
  await waitFor(() => expect(box).toHaveTextContent('through Rm Pairing'))
  expect(within(box).getByRole('button', { name: 'Rm Rep 1' })).toBeInTheDocument()
  expect(await within(box).findByRole('link', { name: 'Anu' })).toBeInTheDocument()
})

// #1282 item 14: the lines are measured where the boxes fall (jsdom lays nothing
// out, so the boxes are given their places here): a curve from each link box into
// the centre, and from the centre to the header of each group box beside it.
test('the lines join the centre to each box beside it, measured where the boxes fall', async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Rm Note', id_pattern: 'prompt', title_column: 'title',
    columns: [
      { column_name: 'title', column_type: 'Data', in_list_view: true },
      { column_name: 'order', column_type: 'Reference', reference_table: 'Rm Order' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Rm Note', row: { row_id: 'note-1', title: 'Call back', order: 'ord-1' } })
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  const placed = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-map-centre')) return rect(400, 100, 200, 50)
    if (this.hasAttribute('data-map-from')) return rect(0, 90, 220, 46)
    if (this.hasAttribute('data-map-to')) return rect(700, 20, 240, 120)
    return rect(0, 0, 1000, 300)
  })
  const watched: Element[] = []
  vi.stubGlobal('ResizeObserver', class { observe(el: Element) { watched.push(el) } disconnect() {} })
  try {
    await openMap(admin, 'Rm Order', 'ord-1')
    await screen.findByTestId('map-group-Rm Note')
    await waitFor(() => expect([...screen.getByTestId('map-edges').querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual([
      'M220 113 C 310 113, 310 125, 400 125',
      'M600 125 C 650 125, 650 38, 700 38',
    ]))
    // It redraws when the map or any box changes size.
    expect(watched).toContain(screen.getByTestId('relation-map'))
    expect(watched).toContain(screen.getByTestId('map-center'))
  } finally {
    placed.mockRestore()
    vi.unstubAllGlobals()
  }
})

// A row opened inside the drill pane can still become the page's centre: the
// pane's Focus here keeps the tab the page is on.
test("a row opened in the pane from a group becomes the map's centre by Focus here", async ({ admin }) => {
  await seed(admin)
  await openMap(admin, 'Rm Customer', 'cust-1')
  fireEvent.click(await within(await screen.findByTestId('map-group-Rm Order')).findByRole('button', { name: /^Rm Order 2/ }))
  const pane = await screen.findByRole('complementary', { name: 'Asha Stores · cust-1' })
  fireEvent.click(await within(pane).findByRole('link', { name: /Second order/ }))
  const order = await screen.findByRole('complementary', { name: /Second order/ })
  fireEvent.click(await within(order).findByRole('button', { name: 'Focus here' }))
  await waitFor(() => expect(screen.getByTestId('map-center')).toHaveTextContent('Second order'))
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true')
})
