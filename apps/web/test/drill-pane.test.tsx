// #910 checklist 4–10 and 22: the drill pane on every list. Selecting a row
// shows it beside (or below) the list: what it points at, the counted groups
// that point at it, a group's rows, and its fields read only. Drilling moves
// the pane and grows the path; the list underneath stays as it was.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { tableHref } from 'shared'
import { createUserWithRole, grantRole } from 'server/test/fixtures'
import { test, expect, renderApp } from './pg-test'
import { PLANT, REGION, SITE, seedSites } from './relational-fixture'

configure({ asyncUtilTimeout: 10_000 })

const pane = (name: string | RegExp) => screen.findByRole('complementary', { name })
const listed = () => within(screen.getByTestId('list-rows')).getAllByTestId('row-check').length
const pathSteps = () => within(screen.getByRole('navigation', { name: 'Path' })).getAllByRole('button')

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

test('the pane lists what the row points at, with Go there and Filter', async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  const pointsAt = within(pane).getByRole('heading', { name: 'Points at' }).parentElement!
  await waitFor(() => expect(within(pointsAt).getByRole('button', { name: 'Kerala · KL' })).toBeInTheDocument())
  expect(within(pointsAt).getByRole('button', { name: 'Go there' })).toBeInTheDocument()
  expect(within(pointsAt).getByRole('button', { name: 'Filter' })).toBeInTheDocument()
})

test('the pane counts each group that points at the row, beside Fields', async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  expect(await within(pane).findByRole('button', { name: `${PLANT} 3` })).toBeInTheDocument()
  expect(within(pane).getByRole('button', { name: 'Fields' })).toBeInTheDocument()
})

test("a chosen group lists its rows as a table with the list's columns", async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  fireEvent.click(await within(pane).findByRole('button', { name: `${PLANT} 3` }))
  const table = await within(pane).findByRole('table')
  await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4))
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Plant name', 'Site', 'Format'])
})

test('a group switches to its compact layout', async ({ admin }) => {
  const { pane } = await openEnchakkal(admin)
  fireEvent.click(await within(pane).findByRole('button', { name: `${PLANT} 3` }))
  await within(pane).findByRole('table')
  fireEvent.click(within(pane).getByRole('button', { name: 'Compact' }))
  await waitFor(() => expect(within(pane).queryByRole('table')).not.toBeInTheDocument())
  expect(within(pane).getByRole('button', { name: /Enchakkal Supermarket/ })).toBeInTheDocument()
})

test('clicking a row in the pane drills to it, growing the path and leaving the list', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  const before = pathSteps().length
  fireEvent.click(await within(site).findByRole('button', { name: `${PLANT} 3` }))
  fireEvent.click(await within(await within(site).findByRole('table')).findByRole('cell', { name: /Enchakkal Supermarket/ }))
  const plant = await pane('Enchakkal Supermarket · 1503')
  expect(plant).toHaveTextContent(PLANT)
  expect(pathSteps()).toHaveLength(before + 1)
  expect(listed()).toBe(3)
})

test('Go there opens the linked row in the pane', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('button', { name: 'Go there' }))
  expect(await pane('Kerala · KL')).toHaveTextContent(REGION)
})

test('Filter narrows the list underneath to the same value, as a removable chip', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('button', { name: 'Filter' }))
  await waitFor(() => expect(listed()).toBe(2))
  const chip = screen.getByTestId('filter-chip')
  await waitFor(() => expect(chip).toHaveTextContent('Kerala'))
  expect(within(chip).getByRole('button', { name: 'Remove filter' })).toBeInTheDocument()
  expect(await pane('Enchakkal')).toBeInTheDocument()
})

test("Filter is unavailable when the list underneath has no such column", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(PLANT), admin)
  await select('Enchakkal Supermarket')
  const plant = await pane('Enchakkal Supermarket · 1503')
  fireEvent.click(await within(plant).findByRole('button', { name: 'Go there' }))
  const site = await pane('Enchakkal · ENK')
  // The plants list has no Region column to narrow.
  await waitFor(() => expect(within(site).getByRole('button', { name: 'Filter' })).toBeDisabled())
})

test("Open as list opens the group's table narrowed to the row", async ({ admin }) => {
  const { pane: site, view } = await openEnchakkal(admin)
  fireEvent.click(await within(site).findByRole('button', { name: `${PLANT} 3` }))
  fireEvent.click(await within(site).findByRole('link', { name: 'Open as list' }))
  await waitFor(() => expect(view.router.state.location.pathname).toBe(tableHref(PLANT)))
  await waitFor(() => expect(listed()).toBe(3))
})

test('Open row page and Edit are separate ways to the row', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  expect(within(site).getByRole('link', { name: 'Open row page' })).toHaveAttribute('href', expect.stringContaining(`${tableHref(SITE)}/row/ENK`))
  expect(within(site).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', expect.stringContaining(`${tableHref(SITE)}/row/ENK`))
})

test('the fields read formatted: dates, rupees, links by name', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(within(site).getByRole('button', { name: 'Fields' }))
  await waitFor(() => expect(site).toHaveTextContent('05-Feb-2019'))
  expect(site).toHaveTextContent('₹12,45,000.00')
  expect(within(site).getAllByRole('button', { name: 'Kerala · KL' }).length).toBeGreaterThan(0)
})

test('empty fields fold under a count and a long note offers Show more', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(within(site).getByRole('button', { name: 'Fields' }))
  expect(await within(site).findByText('2 empty fields')).toBeInTheDocument()
  expect(within(site).getByRole('button', { name: 'Show more' })).toBeInTheDocument()
})

test("the pane's place is the person's choice, kept in their settings", async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.click(within(screen.getByRole('group', { name: 'Pane place' })).getByRole('button', { name: 'Right' }))
  await waitFor(() => expect(site).toHaveAttribute('data-place', 'right'))
  await waitFor(async () => {
    const { settings } = await admin.get<{ settings: { panePlace?: string } | null }>('/api/user_settings/__navigation')
    expect(settings?.panePlace).toBe('right')
  })
})

test('Escape closes the pane and the list stays', async ({ admin }) => {
  const { pane: site } = await openEnchakkal(admin)
  fireEvent.keyDown(site, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Enchakkal' })).not.toBeInTheDocument())
  expect(listed()).toBe(3)
})

// Checklist 22: the same rule as #839's picker check.
test("a viewer who can't read one plant sees a count of 2 and its name nowhere", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Viewer', table: [SITE, REGION], can_read: true })
  await grantRole(admin, { role: 'Nv Viewer', table: PLANT, can_read: true, can_create: true, own_rows_only: true })
  for (const [row_id, plant_name] of [['1701', 'Enchakkal Bakery'], ['1702', 'Enchakkal Pharmacy']])
    await viewer.post('/api/save_row', { table: PLANT, row: { row_id, plant_name, site: 'ENK' } })
  await admin.post('/api/save_row', { table: PLANT, row: { row_id: '1505', plant_name: 'Enchakkal Jewellery', site: 'MDU' } })
  await admin.post('/api/save_row', { table: PLANT, row: { row_id: '1504', plant_name: 'Enchakkal Textiles', site: 'MDU' } })
  await renderApp(tableHref(SITE), viewer)
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  fireEvent.click(await within(site).findByRole('button', { name: `${PLANT} 2` }))
  await waitFor(() => expect(within(within(site).getByRole('table')).getAllByRole('row')).toHaveLength(3))
  expect(document.body).not.toHaveTextContent('Enchakkal Supermarket')
  expect(document.body).not.toHaveTextContent('1503')
})

test("a link to a row the viewer can't read shows no name, no id and no action", async ({ admin, createUser }) => {
  await seedSites(admin)
  const viewer = await createUserWithRole(admin, createUser, { role: 'Nv Site Viewer', table: SITE, can_read: true })
  await renderApp(tableHref(SITE), viewer)
  await select('Enchakkal')
  const site = await pane('Enchakkal')
  const pointsAt = within(site).getByRole('heading', { name: 'Points at' }).parentElement!
  expect(await within(pointsAt).findByText('Not visible to you')).toBeInTheDocument()
  expect(pointsAt).not.toHaveTextContent('Kerala')
  expect(pointsAt).not.toHaveTextContent('KL')
  expect(within(pointsAt).queryByRole('button', { name: 'Go there' })).not.toBeInTheDocument()
})
