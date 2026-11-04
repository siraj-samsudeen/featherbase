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

async function addRegionFilter() {
  fireEvent.change(await screen.findByTestId('filter-field'), { target: { value: 'region' } })
  fireEvent.change(screen.getByTestId('filter-value'), { target: { value: 'KL' } })
  fireEvent.click(screen.getByTestId('filter-add'))
}

test('a list shows a path bar whose one step names the list', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await waitFor(() => expect(current()).toHaveTextContent(SITE))
})

test('adding a filter is a new step named by the filter', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await screen.findByRole('navigation', { name: 'Path' })
  await addRegionFilter()
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  expect(within(pathNav()).getAllByRole('button')).toHaveLength(2)
})

test("the browser's back button returns to the step before", async ({ admin }) => {
  await seedSites(admin)
  const { router } = await renderApp(tableHref(SITE), admin)
  await screen.findByRole('navigation', { name: 'Path' })
  await addRegionFilter()
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
  ;(router as unknown as { history: { back: () => void } }).history.back()
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(3))
  expect(current()).toHaveTextContent(SITE)
})

test('choosing an earlier step brings back its filters', async ({ admin }) => {
  await seedSites(admin)
  await renderApp(tableHref(SITE), admin)
  await screen.findByRole('navigation', { name: 'Path' })
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
  await screen.findByRole('navigation', { name: 'Path' })
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

test('Copy link copies the address of this step', async ({ admin }) => {
  await seedSites(admin)
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const { router } = await renderApp(tableHref(SITE), admin)
  await screen.findByRole('navigation', { name: 'Path' })
  await addRegionFilter()
  await waitFor(() => expect(pathParam(router)).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
  const copied = new URL(writeText.mock.calls[0][0] as string)
  expect(copied.searchParams.get('path')).toBe(pathParam(router))
})

test('a walk is listed under Recent paths by its names after signing in again', async ({ admin }) => {
  await seedSites(admin)
  const first = await renderApp(tableHref(SITE), admin)
  await screen.findByRole('navigation', { name: 'Path' })
  await addRegionFilter()
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  // The walk is saved to the person's settings before the next sign-in.
  await waitFor(async () => {
    const { settings } = await admin.get<{ settings: { recentPaths?: unknown[] } | null }>('/api/user_settings/__navigation')
    expect(settings?.recentPaths).toHaveLength(1)
  })
  first.unmount()

  await renderApp(tableHref(REGION), admin)
  fireEvent.click(await screen.findByRole('button', { name: 'Recent paths' }))
  const item = await screen.findByRole('menuitem', { name: `${SITE} › Region: Kerala · KL` })
  fireEvent.click(item)
  await waitFor(() => expect(current()).toHaveTextContent('Region: Kerala'))
  await waitFor(() => expect(screen.getAllByTestId('row-check')).toHaveLength(2))
})

test("a row page's path bar names the row", async ({ admin }) => {
  await seedSites(admin)
  await renderApp(`${tableHref(PLANT)}/row/1503`, admin)
  await waitFor(() => expect(current()).toHaveTextContent('Enchakkal Supermarket · 1503'))
})
