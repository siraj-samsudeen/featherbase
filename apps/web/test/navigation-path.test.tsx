// #910 checklist 11–14: the path bar on lists and row pages. Every filter and
// every drill is a step in one address parameter, named for whoever is
// looking; browser back and forward walk the same steps; a step can be copied
// as a link; the last ten paths come back after signing in again.
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { encodePath, type NavPath } from '../src/lib/nav-path'
import { PLANT, REGION, SITE, seedSites } from './relational-fixture'
import { recordAction } from '../src/lib/recents'
import { listOf } from '../src/components/RecentSub'
import { pathHref } from '../src/lib/navigation'

configure({ asyncUtilTimeout: 10_000 })

const pathNav = () => screen.getByRole('navigation', { name: 'Path' })
const current = () => within(pathNav()).getByRole('button', { current: 'step' })
const pathParam = (router: { state: unknown }) =>
  new URLSearchParams((router.state as { location: { searchStr: string } }).location.searchStr).get('path')

// A link column's Value is its picker (#1019): the row is picked by its name.
async function chooseRegion(name: string) {
  fireEvent.change(await screen.findByTestId('filter-field'), { target: { value: 'region' } })
  fireEvent.focus(screen.getByTestId('filter-value'))
  const list = await screen.findByTestId('link-options-region')
  fireEvent.mouseDown(await within(list).findByRole('button', { name }))
  await waitFor(() => expect(screen.getByTestId('filter-value')).toHaveValue(name))
  fireEvent.click(screen.getByTestId('filter-add'))
}

async function addRegionFilter() {
  fireEvent.click(await screen.findByTestId('filter-toggle'))
  await chooseRegion('Kerala')
}

// #1013: one step is no path, and would only repeat the page's own heading.
// Someone with no remembered walk has nothing to reopen either.
test('a list with one step shows no path bar', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await screen.findByTestId('filter-toggle')
  await screen.findAllByTestId('row-check')
  expect(screen.queryByRole('navigation', { name: 'Path' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Recent paths' })).not.toBeInTheDocument()
})

test('going back to the first step of a walk keeps the bar, so Forward stays reachable', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(current()).toHaveTextContent(SITE))
  expect(screen.getByRole('button', { name: 'Forward' })).toBeEnabled()
})

test('adding a filter is a new step named by the filter', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  expect(within(pathNav()).getAllByRole('button')).toHaveLength(2)
})

test("the browser's back button returns to the step before", async ({ admin }) => {
  await seedSites(admin)
  const { router } = await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
  ;(router as unknown as { history: { back: () => void } }).history.back()
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(3))
  // That entry's address holds no walk, so it reads as any plain list (#1013).
  expect(screen.queryByRole('navigation', { name: 'Path' })).not.toBeInTheDocument()
})

test("the path's Back is the browser's back, so a new step after it leaves no stray history behind", async ({ admin }) => {
  await seedSites(admin)
  const { router } = await renderApp(tableHref(SITE), admin)
  const history = (router as unknown as { history: { back: () => void; canGoBack: () => boolean } }).history
  await addRegionFilter()
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(3))
  // Back went back through history: there is nothing before the list.
  expect(history.canGoBack()).toBe(false)
  await chooseRegion('Tamil Nadu')
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(1))
  history.back()
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(3))
  expect(current()).toHaveTextContent(SITE)
  // The abandoned Kerala step is not waiting behind it.
  expect(history.canGoBack()).toBe(false)
})

test('choosing an earlier step brings back its filters', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
  fireEvent.click(within(pathNav()).getByRole('button', { name: /Nv Site/ }))
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(3))
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
})

test('the address carries row ids and column names, never names', async ({ admin }) => {
  await seedSites(admin)
  const { router } = await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(pathParam(router)).toContain('"region"'))
  expect(pathParam(router)).not.toContain('Kerala')
})

test("a step on a row the viewer can't read is named neutrally, never by its id", async ({ admin }) => {
  await seedSites(admin)
  const path: NavPath = { steps: [
    { screen: 'list', table: SITE },
    { screen: 'list', table: SITE, pane: { table: PLANT, row: 'no-such-plant-77' } },
  ], at: 1 }
  await renderApp(`${tableHref(SITE)}?path=${encodeURIComponent(encodePath(path))}`, admin)
  await waitFor(() => expect(current()).toHaveTextContent('A row you cannot see'))
  expect(pathNav()).not.toHaveTextContent('no-such-plant-77')
})

test('a filter on several linked rows names each of them', async ({ admin }) => {
  await seedSites(admin)
  const path: NavPath = { steps: [{ screen: 'list', table: SITE }, { screen: 'list', table: SITE, filters: [['region', 'in', ['KL', 'TN']]] }], at: 1 }
  await renderApp(`${tableHref(SITE)}?path=${encodeURIComponent(encodePath(path))}`, admin)
  await waitFor(() => expect(current()).toHaveTextContent('Region in Kerala, Tamil Nadu'))
})

test("a filter on rows the viewer can't read names them neutrally, never by their ids", async ({ admin }) => {
  await seedSites(admin)
  const path: NavPath = { steps: [{ screen: 'list', table: SITE }, { screen: 'list', table: SITE, filters: [['region', 'not in', ['no-such-77']]] }], at: 1 }
  await renderApp(`${tableHref(SITE)}?path=${encodeURIComponent(encodePath(path))}`, admin)
  await waitFor(() => expect(current()).toHaveTextContent('Region not in A row you cannot see'))
  expect(pathNav()).not.toHaveTextContent('no-such-77')
})

test('a filter on the row id names the row', async ({ admin }) => {
  await seedSites(admin)
  const path: NavPath = { steps: [{ screen: 'list', table: SITE }, { screen: 'list', table: SITE, filters: [['row_id', '=', 'ENK']] }], at: 1 }
  await renderApp(`${tableHref(SITE)}?path=${encodeURIComponent(encodePath(path))}`, admin)
  await waitFor(() => expect(current()).toHaveTextContent('Row ID: Enchakkal'))
})

test('Copy link copies the address of this step', async ({ admin }) => {
  await seedSites(admin)
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const { router } = await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(pathParam(router)).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
  const copied = new URL(writeText.mock.calls[0][0] as string)
  expect(copied.searchParams.get('path')).toBe(pathParam(router))
})

// #1111: the path bar says Copied only once the browser has copied, so the
// person never believes a link is on their clipboard when it is not.
test('Copy link the browser refuses to copy does not say Copied', async ({ admin }) => {
  await seedSites(admin)
  const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
  await new Promise((r) => setTimeout(r, 50))
  expect(within(screen.getByRole('button', { name: 'Copy link' }).parentElement!).getByRole('status')).not.toHaveTextContent('Copied')
})

test('Copy link in a browser with no clipboard does not say Copied', async ({ admin }) => {
  await seedSites(admin)
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
  await new Promise((r) => setTimeout(r, 50))
  expect(within(screen.getByRole('button', { name: 'Copy link' }).parentElement!).getByRole('status')).not.toHaveTextContent('Copied')
})

// #1288: a remembered walk is an entry in the sidebar's Recently Opened, not a lone Recent paths button.
test("a walk is listed in the sidebar's Recently Opened by its names after signing in again, and opens whole", async ({ admin }) => {
  await seedSites(admin)
  const first = await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  // The walk is saved to the person's settings before the next sign-in.
  await waitFor(async () => {
    const { settings } = await admin.get<{ settings: { recentPaths?: unknown[] } | null }>('/api/user_settings/__navigation')
    expect(settings?.recentPaths).toHaveLength(1)
  })
  first.unmount()

  // #1013, #1288: a plain list shows no bar and no Recent paths button; the walk is in Recently Opened.
  await renderApp(tableHref(SITE), admin)
  await screen.findAllByTestId('row-check')
  expect(screen.queryByRole('navigation', { name: 'Path' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Recent paths' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('sidebar-walk')).toHaveTextContent(`${SITE} › Region: Kerala`), { timeout: 10_000 })
  expect(within(screen.getByTestId('sidebar-walk')).getByTestId('walk-tile')).toBeInTheDocument()
  // A modified click (new tab, new window) is the browser's: the page stays.
  expect(fireEvent.click(screen.getByTestId('sidebar-walk'), { ctrlKey: true })).toBe(true)
  expect(screen.queryByRole('navigation', { name: 'Path' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByTestId('sidebar-walk'))
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  // The whole walk comes back: the bar names both steps.
  expect(screen.getByRole('navigation', { name: 'Path' })).toHaveTextContent(SITE)
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
})

test("a row page's path bar names the row", async ({ admin }) => {
  await seedSites(admin)
  const path: NavPath = { steps: [{ screen: 'list', table: PLANT }, { screen: 'row', table: PLANT, row: '1503' }], at: 1 }
  await renderApp(`${tableHref(PLANT)}/row/1503?path=${encodeURIComponent(encodePath(path))}`, admin)
  await waitFor(() => expect(current()).toHaveTextContent('Enchakkal Supermarket · 1503'))
})

// #1288: a walk is one entry among recent pages and records, in time order; in the rail it is in the same menu.
test('a walk sits among the recents by when it was taken, and the rail opens it too', async ({ admin }) => {
  await seedSites(admin)
  const first = await renderApp(tableHref(SITE), admin)
  await addRegionFilter()
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  await waitFor(async () => {
    const { settings } = await admin.get<{ settings: { recentPathTimes?: Record<string, number> } | null }>('/api/user_settings/__navigation')
    expect(Object.values(settings?.recentPathTimes ?? {})).toHaveLength(1)
  })
  first.unmount()
  // A record opened after the walk, and a page opened long before it.
  recordAction('Administrator', { kind: 'row', key: 'row:Later Row/L-1', label: 'Later Row', path: '/featherbase/admin/table/later-row/row/L-1' }, Date.now() + 60_000)
  recordAction('Administrator', { kind: 'page', key: 'page:all-tables', label: 'All tables', path: '/featherbase/admin/all-tables' }, Date.now() - 3_600_000)

  const { router } = await renderApp('/featherbase/admin/all-tables', admin)
  const recents = await screen.findByTestId('sidebar-recents')
  await waitFor(() => expect(within(recents).getByTestId('sidebar-walk')).toHaveTextContent(`${SITE} › Region: Kerala`))
  // Newest first: the later record, the walk, and the page opened an hour before (the Site list the walk began on is its own entry too).
  const order = [...recents.querySelectorAll('[data-testid="sidebar-recent"], [data-testid="sidebar-walk"]')].map((r) => r.getAttribute('data-testid') === 'sidebar-walk' ? 'walk' : r.textContent ?? '')
  expect(order[0]).toContain('Later Row')
  expect(order.indexOf('walk')).toBeGreaterThan(0)
  expect(order.indexOf('walk')).toBeLessThan(order.findIndex((r) => r.includes('All tables')))

  fireEvent.click(screen.getByTestId('sidebar-collapse'))
  fireEvent.click(screen.getByRole('button', { name: 'Recently Opened' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Recently Opened' })).getByRole('menuitem', { name: `${SITE} › Region: Kerala` }))
  await waitFor(() => expect(pathParam(router as never)).toBeTruthy())
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
})

// #1288: a filtered recent reads as its list's chips do, never "like %a%" or a row id.
test("two recents of one list say what sets them apart in the chips' words", async ({ admin }) => {
  await seedSites(admin)
  for (const [filters, at] of [[[['site_name', 'like', '%a%']], 2], [[['region', '=', 'KL']], 1]] as const) {
    const json = JSON.stringify(filters)
    recordAction('Administrator', { kind: 'list', key: `list:${SITE}?${json}`, label: SITE, sub: 'stored words', path: `${tableHref(SITE)}?filters=${encodeURIComponent(json)}` }, Date.now() - at * 1000)
  }
  await renderApp('/featherbase/admin/all-tables', admin)
  await waitFor(() => expect(screen.getAllByTestId('recent-differs').map((d) => d.textContent)).toEqual(['Region: Kerala', 'Site name contains a']))
})

test("a recent whose key is not a filtered list keeps its stored words", () => {
  expect(listOf({ key: 'list:Site?not json' })).toBeNull()
  expect(listOf({ key: 'row:Site/S-1' })).toBeNull()
  expect(listOf({ key: 'list:Site/kanban?[]' })).toEqual({ table: 'Site', view: 'kanban', filters: [] })
})

// #1288 (UI owner): the sidebar names a walk briefly: a record by its name without its code, and each
// further step only for what it adds. The path bar keeps its fuller words.
test('a walk that starts on a record reads by names alone in Recently Opened, saying nothing twice', async ({ admin }) => {
  await seedSites(admin)
  const walk: NavPath = { at: 2, steps: [
    { screen: 'row', table: SITE, row: 'ENK' },
    { screen: 'list', table: PLANT, filters: [['site', '=', 'ENK']] },
    { screen: 'list', table: PLANT, filters: [['site', '=', 'ENK'], ['plant_name', 'like', '%Super%']] },
  ] }
  const key = encodePath(walk)
  await admin.put('/api/user_settings/__navigation', { recentPaths: [key], recentPathTimes: { [key]: Date.now() } })
  recordAction('Administrator', { kind: 'page', key: 'page:all-tables', label: 'All tables', path: '/featherbase/admin/all-tables' }, Date.now() - 60_000)
  await renderApp('/featherbase/admin/all-tables', admin)
  // The whole walk is the tooltip; the line keeps where it starts and where it ends (#1282, UI owner).
  await waitFor(() => expect(screen.getByTestId('sidebar-walk')).toHaveAttribute('title', expect.stringMatching(new RegExp(`^Enchakkal › ${PLANT} › Plant name: Super`))))
  expect(screen.getByTestId('sidebar-walk')).toHaveTextContent(/^Enchakkal › … › Plant name: Super/)
  expect(screen.getByTestId('sidebar-walk')).not.toHaveTextContent('ENK')
  // Opened, the path bar still names each step in full.
  fireEvent.click(screen.getByTestId('sidebar-walk'))
  await waitFor(() => expect(pathNav()).toHaveTextContent('Enchakkal · ENK'))
})

// #910 / #1288: on a page with a path, the bar's own Recent paths still opens another remembered walk.
test("the path bar's Recent paths opens another remembered walk", async ({ admin }) => {
  await seedSites(admin)
  const walk = (region: string): NavPath => ({ at: 1, steps: [
    { screen: 'list', table: SITE },
    { screen: 'list', table: SITE, filters: [['region', '=', region]] },
  ] })
  const keys = [encodePath(walk('KL')), encodePath(walk('TN'))]
  await admin.put('/api/user_settings/__navigation', { recentPaths: keys, recentPathTimes: { [keys[0]]: Date.now(), [keys[1]]: Date.now() - 1000 } })
  await renderApp(pathHref(walk('TN')), admin)
  await waitFor(() => expect(current()).toHaveTextContent('Region: Tamil Nadu'))
  fireEvent.click(screen.getByRole('button', { name: 'Recent paths' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: `${SITE} › Region: Kerala` }))
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
})
