// The Admin shell's paths the merged web coverage report (ADR 0012) showed no
// test taking: the command bar sending a name that matches nothing, its New
// Table command, picking a Table it suggests, the phone drawer's backdrop,
// the Frequent group a searcher's sidebar falls back to, handing the last
// events to a beacon as the page goes away, and a whoami the server failed to
// answer. Navigations jsdom cannot perform (reload, another address) are read
// from jsdom's own "not implemented" report; navigator.sendBeacon, which jsdom
// lacks, is a spy. The whoami failure is a real server error.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { sql } from 'server/src/db'
import { resolve } from 'node:path'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error jsdom has no sendBeacon; the test that needs one installs it
  delete navigator.sendBeacon
})

async function openBar(admin: Parameters<typeof renderApp>[1]) {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('all-tables-link', {}, { timeout: 8000 })
  const bar = screen.getByLabelText('Search or type a command')
  fireEvent.focus(bar)
  return { app, bar }
}

/** jsdom reports a navigation it cannot perform on the console. */
function navigationReports() {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => errors.mock.calls.filter((c) => /Not implemented: navigation/.test(String(c[0]?.message ?? c[0])))
}

test('Enter on a name that matches nothing opens that address, which says the page is not found', async ({ admin }) => {
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Ase Nothing Here' } })
  fireEvent.submit(screen.getByTestId('awesomebar'))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/Ase Nothing Here'))
  expect(await screen.findByTestId('page-not-found')).toBeInTheDocument()
})

test('the New Table command opens the Table builder', async ({ admin }) => {
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'New Table' } })
  fireEvent.click(await screen.findByTestId('awesomebar-cmd-new-table'))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/new-table'))
})

test('picking a suggested Table opens its list and empties the bar', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ase Gadget', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] })
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Ase Gad' } })
  const [hit] = await screen.findAllByTestId('awesomebar-table')
  fireEvent.click(hit)
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/Ase Gadget'))
  expect(bar).toHaveValue('')
})

test('on a phone, the drawer closes when its backdrop is tapped', async ({ admin }) => {
  await renderApp('/featherbase/admin', admin)
  const toggle = await screen.findByTestId('sidebar-toggle', {}, { timeout: 8000 })
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(screen.getByTestId('sidebar-backdrop'))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument()
})

test('someone whose recent actions are all searches finds their frequent list under Frequent, and it opens', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Ase Stock', columns: [{ column_name: 'sku', column_type: 'Data', in_list_view: true }] })
  const now = Date.now()
  for (const back of [90, 80, 70])
    recordAction('Administrator', { kind: 'list', key: 'list:Ase Stock?', label: 'Ase Stock', path: '/featherbase/admin/Ase Stock' }, now - back * 60_000)
  for (let i = 0; i < 20; i++)
    recordAction('Administrator', { kind: 'search', key: `search:ase-${i}`, label: `ase-${i}`, path: '' }, now - i * 1000)
  const app = await renderApp('/featherbase/admin', admin)
  const frequent = await screen.findByTestId('sidebar-frequent', {}, { timeout: 8000 })
  expect(frequent).toHaveTextContent('Ase Stock')
  await userEvent.click(frequent)
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/Ase Stock'))
})

test('leaving the page hands the unsent events to a beacon', async ({ admin }) => {
  const beacon = vi.fn(() => true)
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
  await renderApp('/featherbase/admin', admin)
  await screen.findByTestId('admin-sidebar', {}, { timeout: 8000 })
  recordAction('Administrator', { kind: 'list', key: 'list:Ase Beacon?', label: 'Ase Beacon', path: '/featherbase/admin/Ase Beacon' })
  window.dispatchEvent(new Event('pagehide'))
  expect(beacon).toHaveBeenCalledTimes(1)
  const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob]
  expect(url).toBe('/api/events')
  const body = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
  expect(JSON.parse(body).events).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'list:Ase Beacon?', label: 'Ase Beacon' })]))
})

test('when the server cannot say what the person may use, the Admin says so and Try again reloads', async ({ admin }) => {
  // whoami reads the person's theme; a column that is not there fails it.
  await sql.unsafe('alter table featherbase.person rename column theme to theme_gone')
  const reports = navigationReports()
  await renderApp('/featherbase/admin', admin)
  expect(await screen.findByText(/We could not check what you have access to/, {}, { timeout: 8000 })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(reports()).toHaveLength(1)
})

test('choosing another application in the switcher goes to its address', async ({ admin }) => {
  expect(await discoverPackages([resolve('../..', 'runtime-apps/tasker')])).toEqual([])
  if (await isInstalled('tasker')) await uninstallApp('tasker')
  await installApp('tasker')
  const reports = navigationReports()
  await renderApp('/featherbase/admin', admin)
  const switcher = (await screen.findByRole('combobox', { name: 'Switch application' }, { timeout: 8000 })) as HTMLSelectElement
  const tasker = await within(switcher).findByRole('option', { name: /task/i })
  fireEvent.change(switcher, { target: { value: tasker.getAttribute('value') } })
  expect(reports()).toHaveLength(1)
})
