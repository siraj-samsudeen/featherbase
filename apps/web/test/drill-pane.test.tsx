// #910 checklist 4–10 and 22: the drill pane on every list. Selecting a row
// shows it beside (or below) the list: what it points at, the counted groups
// that point at it, a group's rows, and its fields read only. Drilling moves
// the pane and grows the path; the list underneath stays as it was.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { createUserWithRole, grantRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'
import { PLANT, PROFIT, REGION, SITE, seedPostings, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The pane on the row named `name`, which its code may follow ("Enchakkal · ENK"). */
const pane = (name: string) => screen.findByRole('complementary', { name: new RegExp(`^${escape(name)}( · .+)?$`) })
const listed = () => within(screen.getByTestId('list-rows')).getAllByTestId('row-check').length
// The path's steps, not the walk's ‹ › beside the last one (#1343).
const pathSteps = () => within(screen.getByRole('navigation', { name: 'Path' })).getAllByRole('button').filter((b) => !b.closest('[data-testid="walk"]'))

/** Selects a row of the list by clicking a plain cell of its line. */
async function select(name: string) {
  const link = await screen.findByRole('link', { name })
  const line = link.closest('tr')!
  fireEvent.click(within(line).getAllByRole('cell').at(-1)!)
}

async function openEnchakkal(admin: Parameters<typeof renderApp>[1]) {
  await seedSites(admin)
  const view = await renderApp(tableHref(SITE), admin)
  await select('Enchakkal')
  return { view, pane: await pane('Enchakkal') }
}

test("selecting a row shows it in the pane, named with its table", async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  expect(pane).toHaveTextContent(SITE)
  expect(listed()).toBe(3)
})

test('the pane lists what the row points at: a link to its page, Show here and Filter', async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  const pointsAt = (await within(pane).findByRole('heading', { name: 'Points at' })).parentElement!
  // #1259: the name is a real link to the row's page (a new tab opens it); #1282: a plain click peeks it here.
  await waitFor(() => expect(within(pointsAt).getByRole('link', { name: 'Kerala · KL' })).toHaveAttribute('href', expect.stringContaining('/row/KL')))
  expect(within(pointsAt).getByRole('button', { name: 'Filter' })).toBeInTheDocument()
})

test('the pane counts each group that points at the row, under its fields', async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  expect(await within(pane).findByRole('button', { name: `${PLANT} 3` })).toBeInTheDocument()
  // #1259: the fields always show; the groups sit under them.
  expect(within(pane).getByRole('heading', { name: 'Fields' })).toBeInTheDocument()
})

const lines = (pane: HTMLElement) => within(pane).queryAllByTestId('linked-row')

test('a chosen group lists its rows one per line, each by its name as a link, never as a table', async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  fireEvent.click(await within(pane).findByRole('button', { name: `${PLANT} 3` }))
  await waitFor(() => expect(lines(pane)).toHaveLength(3))
  expect(within(pane).queryByRole('table')).not.toBeInTheDocument()
  // The name alone is the link; its code follows, muted, outside it.
  const link = await within(pane).findByRole('link', { name: 'Enchakkal Supermarket' })
  expect(link).toHaveAttribute('href', expect.stringContaining('/row/1503'))
  expect(link.closest('[data-testid=linked-row]')).toHaveTextContent('Enchakkal Supermarket · 1503')
  // Opened from its chip, the group does not repeat the chip's words.
  expect(within(pane).queryByRole('heading', { name: /^Plant/ })).not.toBeInTheDocument()
  // All 3 show: no Show all, only the quieter way to the list.
  expect(within(pane).queryByRole('link', { name: /^Show all/ })).not.toBeInTheDocument()
  expect(within(pane).getByRole('link', { name: 'Open as list' })).toBeInTheDocument()
})

// #1282 C14: the pane is the peek, so a group there shows its first 4 rows, then + N more.
test('a group in the pane shows its first 4, then + N more', async ({ admin }) => {
  await seedSites(admin, { profitCentres: 12 })
  await renderApp(tableHref(PLANT), admin)
  await select('Enchakkal Supermarket')
  const plant = await pane('Enchakkal Supermarket · 1503')
  fireEvent.click(await within(plant).findByRole('button', { name: `${PROFIT} 12` }))
  await waitFor(() => expect(lines(plant)).toHaveLength(4))
  expect(await within(plant).findByRole('link', { name: '+ 8 more' })).toBeInTheDocument()
})

const lineWith = (pane: HTMLElement, name: string) =>
  waitFor(() => lines(pane).find((l) => within(l).queryByRole('link', { name })) ?? Promise.reject(new Error(`no line ${name}`)))

/** #1273: someone who reads postings but may not change them sees the group as rows, not ticks. */
const postingReader = (admin: Parameters<typeof renderApp>[1], createUser: Parameters<typeof createUserWithRole>[1]) =>
  createUserWithRole(admin, createUser, { role: 'Nv Posting Reader', table: [SITE, REGION, PLANT, 'Nv Posting'], can_read: true })

test("a group's rows read by what they point to, with at most two of their own facts", async ({ admin, createUser }) => {
  await seedSites(admin)
  await seedPostings(admin)
  await renderApp(tableHref(SITE), await postingReader(admin, createUser))
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  fireEvent.click(await within(site).findByRole('button', { name: 'Nv Posting 2' }))
  const supermarket = await lineWith(site, 'Enchakkal Supermarket')
  expect(within(supermarket).getByTestId('linked-row-facts')).toHaveTextContent(/^01-Apr-2026 · Active$/)
  const textiles = await lineWith(site, 'Enchakkal Textiles')
  expect(within(textiles).queryByTestId('linked-row-facts')).not.toBeInTheDocument()
  // Never the region, which is the site's own.
  for (const line of lines(site)) expect(line).not.toHaveTextContent('Kerala')
})

// Verifier round 2: from the region, a posting has two far sides left, its site
// and its plant: each its own link, joined by ›, with no code and no posting id.
test('a row with two far sides reads by both, each its own link', async ({ admin, createUser }) => {
  await seedSites(admin)
  await seedPostings(admin)
  await renderApp(tableHref(REGION), await postingReader(admin, createUser))
  await select('Kerala')
  const region = await pane('Kerala')
  fireEvent.click(await within(region).findByRole('button', { name: 'Nv Posting 2' }))
  const line = await lineWith(region, 'Enchakkal Supermarket')
  expect(within(line).getByRole('link', { name: 'Enchakkal' })).toHaveAttribute('href', expect.stringContaining('/row/ENK'))
  expect(line).toHaveTextContent(/^Enchakkal › Enchakkal Supermarket/)
  expect(line).not.toHaveTextContent('1503')
  expect(region).not.toHaveTextContent('ENK-1503')
})

test('a far side the viewer may not open is plain words, never a link', async ({ admin, createUser }) => {
  await seedSites(admin)
  await seedPostings(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Posting Viewer', table: [SITE, REGION, 'Nv Posting'], can_read: true })
  await renderApp(tableHref(SITE), viewer)
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  fireEvent.click(await within(site).findByRole('button', { name: 'Nv Posting 2' }))
  await waitFor(() => expect(lines(site)).toHaveLength(2))
  await waitFor(() => { for (const line of lines(site)) expect(line).toHaveTextContent('A row you cannot see') })
  for (const line of lines(site)) expect(within(line).queryByRole('link')).not.toBeInTheDocument()
  expect(site).not.toHaveTextContent('1503')
})

test('clicking a row in the pane drills to it, growing the path and leaving the list', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  const before = pathSteps().length
  fireEvent.click(await within(site).findByRole('button', { name: `${PLANT} 3` }))
  fireEvent.click((await within(site).findAllByRole('link', { name: 'Enchakkal Supermarket' }))[0]!)
  const plant = await pane('Enchakkal Supermarket · 1503')
  expect(plant).toHaveTextContent(PLANT)
  expect(pathSteps()).toHaveLength(before + 1)
  expect(listed()).toBe(3)
})

test("a linked row's name opens it in the pane, one level deeper (#1282 C14)", async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('link', { name: 'Kerala · KL' }))
  expect(await pane('Kerala · KL')).toHaveTextContent(REGION)
})

// #1289: the list has a Region box, so the box shows the filter (with its own ✕) and no chip repeats it.
test('Filter narrows the list underneath to the same value, shown in its Region box with a ✕', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('button', { name: 'Filter' }))
  await waitFor(() => expect(listed()).toBe(2))
  await waitFor(() => expect(screen.getByTestId('std-filter-region')).toHaveValue('Kerala'))
  expect(screen.queryAllByTestId('filter-chip')).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'Clear the Region filter' })).toBeInTheDocument()
  expect(await pane('Enchakkal')).toBeInTheDocument()
})

test("Filter is unavailable when the list underneath has no such column", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(PLANT), admin)
  await select('Enchakkal Supermarket')
  const plant = await pane('Enchakkal Supermarket · 1503')
  fireEvent.click(await within(plant).findByRole('link', { name: 'Enchakkal · ENK' }))
  const site = await pane('Enchakkal · ENK')
  // The plants list has no Region column to narrow.
  await waitFor(() => expect(within(site).getByRole('button', { name: 'Filter' })).toBeDisabled())
})

test("Open as list opens the group's table narrowed to the row", async ({ admin }) => {
  const { pane: site, view } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('button', { name: `${PLANT} 3` }))
  fireEvent.click(await within(site).findByRole('link', { name: 'Open as list' }))
  await waitFor(() => expect((view.router.state as { location: { pathname: string } }).location.pathname).toBe(tableHref(PLANT)))
  await waitFor(() => expect(listed()).toBe(3))
})

// A group linked through a sub-table (visits whose lines name the site)
// opens as a list narrowed by a relationship filter, not by a plain value.
async function seedVisits(admin: Parameters<typeof renderApp>[1]) {
  await admin.post('/api/table_def', {
    name: 'Nv Visit Line', kind: 'sub_table',
    columns: [{ column_name: 'site', column_type: 'Reference', reference_table: SITE, label: 'Site', in_list_view: true }],
  })
  await admin.post('/api/table_def', {
    name: 'Nv Visit', id_pattern: 'prompt', title_column: 'visit_name',
    columns: [
      { column_name: 'visit_name', column_type: 'Data', label: 'Visit name', in_list_view: true },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Nv Visit Line', label: 'Lines' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Nv Visit', row: { row_id: 'v1', visit_name: 'March audit', lines: [{ site: 'ENK' }] } })
  await admin.post('/api/save_row', { table: 'Nv Visit', row: { row_id: 'v2', visit_name: 'April audit', lines: [{ site: 'TCR' }] } })
}

test('Open as list on a group linked through a sub-table shows only the related rows', async ({ admin }) => {
  await seedSites(admin)
  await seedVisits(admin)
  const view = await renderApp(tableHref(SITE), admin)
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  fireEvent.click(await within(site).findByRole('button', { name: 'Nv Visit 1' }))
  fireEvent.click(await within(site).findByRole('link', { name: 'Open as list' }))
  await waitFor(() => expect((view.router.state as { location: { pathname: string } }).location.pathname).toBe(tableHref('Nv Visit')))
  await screen.findByRole('link', { name: 'March audit' })
  expect(listed()).toBe(1)
})

// #1282 C14 (UI owner, 18-Nov-2026): the peek's header reads "← · Level N of N · Open Full Page · ✕",
// so the one way to the row's page is Open Full Page, where #1259 had Edit.
test("Open Full Page is the one way to the row's page, its editable form", async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  // The way to the row shows once the row is known to be readable.
  expect(await within(site).findByRole('link', { name: 'Open Full Page' })).toHaveAttribute('href', expect.stringContaining(`${tableHref(SITE)}/row/ENK`))
  expect(within(site).queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
})

test('the fields read formatted: dates, rupees, links by name', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  await waitFor(() => expect(site).toHaveTextContent('05-Feb-2019'))
  expect(site).toHaveTextContent('₹12,45,000.00')
  expect(within(site).getAllByRole('button', { name: 'Kerala · KL' }).length).toBeGreaterThan(0)
})

test('empty fields fold under a count and a long note offers Show more', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  expect(await within(site).findByText('2 empty fields')).toBeInTheDocument()
  expect(within(site).getByRole('button', { name: 'Show more' })).toBeInTheDocument()
})

test('Escape closes the pane and the list stays', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.keyDown(site, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('complementary', { name: /^Enchakkal/ })).not.toBeInTheDocument())
  expect(listed()).toBe(3)
})

// Checklist 22: the same rule as #839's picker check.
test("a viewer who can't read Enchakkal's other plants sees a count of 2 and their names nowhere", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Viewer', table: [SITE, REGION], can_read: true })
  await grantRole(admin, { role: 'Nv Viewer', table: PLANT, can_read: true, can_create: true, own_rows_only: true })
  for (const [row_id, plant_name] of [['1701', 'Enchakkal Bakery'], ['1702', 'Enchakkal Pharmacy']])
    await viewer.post('/api/save_row', { table: PLANT, row: { row_id, plant_name, site: 'ENK' } })
  await renderApp(tableHref(SITE), viewer)
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  fireEvent.click(await within(site).findByRole('button', { name: `${PLANT} 2` }))
  await waitFor(() => expect(lines(site)).toHaveLength(2))
  for (const unseen of ['Enchakkal Supermarket', 'Enchakkal Textiles', 'Enchakkal Jewellery', '1503', '1504', '1505'])
    expect(document.body).not.toHaveTextContent(unseen)
})

test("a link to a row the viewer can't read shows no name, no id and no action", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Site Viewer', table: SITE, can_read: true })
  await renderApp(tableHref(SITE), viewer)
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  const pointsAt = (await within(site).findByRole('heading', { name: 'Points at' })).parentElement!
  expect(await within(pointsAt).findByText('Not visible to you')).toBeInTheDocument()
  expect(pointsAt).not.toHaveTextContent('Kerala')
  expect(pointsAt).not.toHaveTextContent('KL')
  expect(within(pointsAt).queryByRole('button', { name: /^Show .* here$/ })).not.toBeInTheDocument()
})

test('two links from the same table stay separate groups, each with its own count', async ({ admin }) => {
  await seedSites(admin)
  const meta = await admin.get<{ columns: Record<string, unknown>[] }>(`/api/table/${encodeURIComponent(PLANT)}:meta`)
  await admin.put(`/api/table_def/${encodeURIComponent(PLANT)}`, {
    ...meta, columns: [...meta.columns, { column_name: 'backup_site', column_type: 'Reference', reference_table: SITE, label: 'Backup site' }],
  })
  await renderApp(tableHref(SITE), admin)
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  expect(await within(site).findByRole('button', { name: `${PLANT} · Site 3` })).toBeInTheDocument()
  // A group with no rows waits behind Show N empty (#1282, as on the record page), and is still there.
  expect(within(site).queryByRole('button', { name: `${PLANT} · Backup site 0` })).not.toBeInTheDocument()
  fireEvent.click(within(site).getByRole('button', { name: /^\+ \d+ tables? with none$/ }))
  expect(within(site).getByRole('button', { name: `${PLANT} · Backup site 0` })).toBeInTheDocument()
})

test('a new row from a group opened as a list starts linked to the row', async ({ admin }) => {
  const { pane: site, view } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('button', { name: `${PLANT} 3` }))
  fireEvent.click(await within(site).findByRole('link', { name: 'Open as list' }))
  await waitFor(() => expect((view.router.state as { location: { pathname: string } }).location.pathname).toBe(tableHref(PLANT)))
  // The router writes a JSON string param quoted, once more.
  const prefill = () => {
    const raw: unknown = JSON.parse(new URL(screen.getByTestId('list-new').getAttribute('href')!, 'http://x').searchParams.get('prefill') ?? 'null')
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }
  await waitFor(() => expect(prefill()).toEqual({ site: 'ENK' }))
})

test('a pane on a row that is gone says so, without its id', async ({ admin }) => {
  await seedSites(admin)
  const path = { steps: [{ screen: 'list', table: SITE, pane: { table: PLANT, row: 'gone-1901' } }], at: 0 }
  await renderApp(`${tableHref(SITE)}?path=${encodeURIComponent(JSON.stringify(path))}`, admin)
  const gone = await screen.findByRole('complementary', { name: 'A row you cannot see' })
  expect(await within(gone).findByText("You can't see this row.")).toBeInTheDocument()
  expect(gone).not.toHaveTextContent('gone-1901')
})

test('a pane on a row the viewer cannot read offers no way to the row', async ({ admin }) => {
  await seedSites(admin)
  const path = { steps: [{ screen: 'list', table: SITE, pane: { table: PLANT, row: 'gone-1901' } }], at: 0 }
  await renderApp(`${tableHref(SITE)}?path=${encodeURIComponent(JSON.stringify(path))}`, admin)
  const gone = await screen.findByRole('complementary', { name: 'A row you cannot see' })
  await within(gone).findByText("You can't see this row.")
  expect(within(gone).queryAllByRole('link').map((l) => l.textContent)).toEqual([])
})

// The spec's "Back to the site from its supermarket": the step named after
// the row keeps the filter, as if the list was narrowed first.
test('Filter from the pane puts the filter on the path before the row it was read from', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('button', { name: 'Filter' }))
  await waitFor(() => expect(pathSteps().map((s) => s.textContent)).toEqual([SITE, 'Region: Kerala', 'Enchakkal · ENK']))
})

// Checklist 21: a list line goes to the pane from the keyboard.
test('a list line is reached by Tab and shown in the pane by Enter', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  const line = (await screen.findByRole('link', { name: 'Enchakkal' })).closest('tr')!
  expect(line).toHaveAttribute('tabindex', '0')
  fireEvent.keyDown(line, { key: 'Enter' })
  expect(await pane('Enchakkal')).toBeInTheDocument()
})

test('Enter on a link inside a list line still follows the link, not the line', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  const line = (await screen.findByRole('link', { name: 'Enchakkal' })).closest('tr')!
  fireEvent.keyDown(await within(line).findByRole('link', { name: 'Kerala · KL' }), { key: 'Enter' })
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByRole('complementary', { name: /^Enchakkal/ })).not.toBeInTheDocument()
})

// Checklist 13: Filter from the pane is one browser history entry, and the
// browser's back button lands on the step before it on the path.
test("after Filter from the pane, the browser's back button lands on the filter's step", async ({ admin }) => {
  const { pane: site, view } = await openEnchakkal(admin)
  const history = (view.router as unknown as { history: { length: number; back: () => void } }).history
  const before = history.length
  fireEvent.click(await within(site).findByRole('button', { name: 'Filter' }))
  await waitFor(() => expect(pathSteps().map((s) => s.textContent)).toEqual([SITE, 'Region: Kerala', 'Enchakkal · ENK']))
  expect(history.length).toBe(before + 1)
  history.back()
  await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Path' })).getByRole('button', { current: 'step' })).toHaveTextContent('Region: Kerala'))
  expect(pathSteps().map((s) => s.textContent)).toEqual([SITE, 'Region: Kerala', 'Enchakkal · ENK'])
})

test('a filter added while a row is in the pane is named on the path by the filter', async ({ admin }) => {
  await openEnchakkal(admin)
  const before = pathSteps().length
  fireEvent.focus(screen.getByTestId('std-filter-region'))
  const options = await screen.findByTestId('link-options-region')
  fireEvent.mouseDown((await within(options).findAllByTestId('link-option')).find((o) => o.textContent === 'Kerala')!)
  await waitFor(() => expect(pathSteps()).toHaveLength(before + 1))
  expect(within(screen.getByRole('navigation', { name: 'Path' })).getByRole('button', { current: 'step' })).toHaveTextContent('Region: Kerala')
  expect(await pane('Enchakkal')).toBeInTheDocument()
})

// #1349 item 1 (boards 3 and 4b): under the record's title, one row of count chips: one per group with rows, the
// number first ("3 Nv Plants"), a hop through a sub-table saying so; a click opens the linked list already filtered.
const countRow = (scope: HTMLElement | Document = document) => within(scope as HTMLElement).findByTestId('count-row')

test("the record page leads with a count row: a chip per group with rows, opening that group's list filtered", async ({ admin }) => {
  await seedSites(admin)
  await seedVisits(admin)
  const view = await renderApp(`${tableHref(SITE)}/row/ENK`, admin)
  const row = await screen.findByTestId('count-row')
  expect(await within(row).findByRole('link', { name: '1 Nv Visit through Nv Visit Line' })).toBeInTheDocument()
  const plants = await within(row).findByRole('link', { name: '3 Nv Plants' })
  fireEvent.click(plants)
  await waitFor(() => expect((view.router.state as { location: { pathname: string } }).location.pathname).toBe(tableHref(PLANT)))
  await waitFor(() => expect(listed()).toBe(3))
})

test('a group with no rows gets no chip in the count row', async ({ admin }) => {
  await seedSites(admin)
  await seedVisits(admin)
  await renderApp(`${tableHref(SITE)}/row/MDU`, admin)
  await screen.findByRole('heading', { level: 1, name: /Madurai/ })
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  expect(screen.queryByRole('link', { name: /Nv Plant/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Nv Visit/ })).not.toBeInTheDocument()
})

test('the pane carries the same count row under its title', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  expect(await within(await countRow(site)).findByRole('link', { name: '3 Nv Plants' })).toHaveAttribute('href', expect.stringContaining(tableHref(PLANT)))
})

test('the count row counts only the rows the viewer may read, and names no Table they cannot open', async ({ admin, createUser }) => {
  await seedSites(admin)
  await seedVisits(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Count Viewer', table: [SITE, REGION], can_read: true })
  await grantRole(admin, { role: 'Nv Count Viewer', table: PLANT, can_read: true, can_create: true, own_rows_only: true })
  await viewer.post('/api/save_row', { table: PLANT, row: { row_id: '1701', plant_name: 'Enchakkal Bakery', site: 'ENK' } })
  await renderApp(`${tableHref(SITE)}/row/ENK`, viewer)
  const row = await screen.findByTestId('count-row')
  expect(await within(row).findByRole('link', { name: '1 Nv Plant' })).toBeInTheDocument()
  expect(within(row).queryByRole('link', { name: /Nv Visit/ })).not.toBeInTheDocument()
})
