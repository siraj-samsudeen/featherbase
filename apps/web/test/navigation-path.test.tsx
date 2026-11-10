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
  await waitFor(() => expect(current()).toHaveTextContent('Region in Kerala · KL, Tamil Nadu · TN'))
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
  await waitFor(() => expect(current()).toHaveTextContent('Row ID: Enchakkal · ENK'))
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

test('a walk is listed under Recent paths by its names after signing in again', async ({ admin }) => {
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

  // #1013: a plain list shows no bar, only the way back to remembered walks.
  await renderApp(tableHref(SITE), admin)
  const recent = await screen.findByRole('button', { name: 'Recent paths' })
  expect(screen.queryByRole('navigation', { name: 'Path' })).not.toBeInTheDocument()
  fireEvent.click(recent)
  const item = await screen.findByRole('menuitem', { name: `${SITE} › Region: Kerala · KL` })
  fireEvent.click(item)
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
})

test("a row page's path bar names the row", async ({ admin }) => {
  await seedSites(admin)
  const path: NavPath = { steps: [{ screen: 'list', table: PLANT }, { screen: 'row', table: PLANT, row: '1503' }], at: 1 }
  await renderApp(`${tableHref(PLANT)}/row/1503?path=${encodeURIComponent(encodePath(path))}`, admin)
  await waitFor(() => expect(current()).toHaveTextContent('Enchakkal Supermarket · 1503'))
})
