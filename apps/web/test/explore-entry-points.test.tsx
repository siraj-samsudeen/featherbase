// Moved from e2e/explore.spec.ts (#1080): the ways into Explore — a
// root+chain+select address (#100 pattern 4), the list's Explore split button
// (option B), and the row Map tab's "Open in Explore" (option C).
//
// Fixture graph (backlinks sort by Table name, so 'Xe Accident' is always the
// first dependent of 'Xe Vehicle'):
//   Xe Vehicle ← Xe Accident.vehicle ← Xe Claim.accident
//   Xe Vehicle ← Xe Service.vehicle
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'

configure({ asyncUtilTimeout: 10_000 })
type Admin = Parameters<typeof renderApp>[1]
const enc = encodeURIComponent

const VEHICLE = 'Xe Vehicle'
const ACCIDENT = 'Xe Accident'
const SERVICE = 'Xe Service'
const CLAIM = 'Xe Claim'

async function seed(admin: Admin) {
  const title = { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true }
  const ref = (column_name: string, reference_table: string) =>
    ({ column_name, column_type: 'Reference', label: column_name, reference_table, in_list_view: true })
  await admin.post('/api/table_def', { name: VEHICLE, columns: [title] })
  await admin.post('/api/table_def', { name: ACCIDENT, columns: [title, ref('vehicle', VEHICLE)] })
  await admin.post('/api/table_def', { name: SERVICE, columns: [title, ref('vehicle', VEHICLE)] })
  await admin.post('/api/table_def', { name: CLAIM, columns: [title, ref('accident', ACCIDENT)] })
  const insert = async (table: string, row: Record<string, unknown>) =>
    (await admin.post<{ row_id: string }>('/api/save_row', { table, row })).row_id
  const v1 = await insert(VEHICLE, { title: 'Truck 1' })
  const v2 = await insert(VEHICLE, { title: 'Truck 2' })
  const a1 = await insert(ACCIDENT, { title: 'Rear bump', vehicle: v1 })
  await insert(ACCIDENT, { title: 'Side scrape', vehicle: v1 })
  await insert(ACCIDENT, { title: 'Windshield', vehicle: v2 })
  await insert(SERVICE, { title: 'Oil change', vehicle: v1 })
  await insert(CLAIM, { title: 'Claim rear bump', accident: a1 })
  return { v1 }
}

/** A pane's count, exactly: "2" must not pass for "12". */
const countOf = (pane: string) => screen.getByTestId(`explore-${pane}-count`).textContent
const pathOf = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string; searchStr: string } } }).state.location

const twoHops = enc(JSON.stringify([
  { mode: 'backlink', table: ACCIDENT, column: 'vehicle' },
  { mode: 'backlink', table: CLAIM, column: 'accident' },
]))

test('a root+chain+select address opens three panes, the first preselected and the rest narrowed to it', async ({ admin }) => {
  const { v1 } = await seed(admin)
  await renderApp(`/featherbase/admin/explore?root=${enc(VEHICLE)}&chain=${twoHops}&select=${enc(JSON.stringify([v1]))}`, admin)
  await waitFor(() => expect(countOf('pane1')).toBe('2'))
  expect(screen.getByTestId('explore-chip')).toHaveTextContent(`${VEHICLE}: ${v1}`)
  const selected = screen.getByTestId('explore-pane1').querySelectorAll('[data-testid=explore-row][data-selected]')
  expect([...selected].map((row) => row.textContent)).toEqual([expect.stringContaining('Truck 1')])

  await waitFor(() => expect(countOf('pane2')).toBe('2'))
  expect(screen.getByTestId('explore-pane2')).toHaveTextContent('Rear bump')
  expect(screen.getByTestId('explore-pane2')).not.toHaveTextContent('Windshield')
  await waitFor(() => expect(countOf('pane3')).toBe('1'))
  expect(screen.getByTestId('explore-pane3')).toHaveTextContent('Claim rear bump')
})

test.for([
  ['malformed', 'not-json'],
  ['stale', enc(JSON.stringify([
    { mode: 'backlink', table: 'Xe Ghost', column: 'vehicle' },
    { mode: 'backlink', table: CLAIM, column: 'accident' },
  ]))],
])('a %s chain degrades to the plain root pane, never a blank page', async ([, chain], { admin }) => {
  await seed(admin)
  await renderApp(`/featherbase/admin/explore?root=${enc(VEHICLE)}&chain=${chain}`, admin)
  await waitFor(() => expect(countOf('pane1')).toBe('2'))
  expect(screen.queryByTestId('explore-pane2')).not.toBeInTheDocument()
})

test("the list's split button offers the dependents; two siblings ticked open one hop, since the second cannot follow the first", async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  const r = await renderApp(`/featherbase/admin/table/${tableSlug(VEHICLE)}`, admin)
  await user.click(await screen.findByTestId('explore-split-toggle'))
  const panel = await screen.findByTestId('explore-split-panel')
  for (const dependent of [`${ACCIDENT} · vehicle`, `${SERVICE} · vehicle`])
    await user.click(await within(panel).findByRole('checkbox', { name: dependent }))
  await user.click(within(panel).getByTestId('explore-split-open'))

  await waitFor(() => expect(pathOf(r).pathname).toBe('/featherbase/admin/explore'))
  expect(new URLSearchParams(pathOf(r).searchStr).get('chain')).toEqual(expect.any(String))
  await waitFor(() => expect(countOf('pane1')).toBe('2'))
  await waitFor(() => expect(countOf('pane2')).toBe('3'))
  expect(screen.queryByTestId('explore-pane3')).not.toBeInTheDocument()
})

test("the row page's Map tab opens Explore narrowed to that row", async ({ admin }) => {
  const user = userEvent.setup()
  const { v1 } = await seed(admin)
  const r = await renderApp(`/featherbase/admin/table/${tableSlug(VEHICLE)}/row/${enc(v1)}`, admin)
  await user.click(await screen.findByRole('tab', { name: 'Map' }))
  // The link carries both hops once the map has read the row's dependents.
  const open = await screen.findByTestId('map-open-explore')
  const chainOf = () => new URL(open.getAttribute('href') ?? '', 'http://x').searchParams.get('chain') ?? ''
  await waitFor(() => expect(chainOf()).toContain(CLAIM))
  await user.click(open)

  await waitFor(() => expect(pathOf(r).pathname).toBe('/featherbase/admin/explore'))
  await waitFor(() => expect(screen.getByTestId('explore-chip')).toHaveTextContent(`${VEHICLE}: ${v1}`))
  await waitFor(() => expect(countOf('pane2')).toBe('2'))
  await waitFor(() => expect(countOf('pane3')).toBe('1'))
})
