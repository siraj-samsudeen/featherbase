// The command bar (#101) and its pages: Enter on nothing, Enter on a page's
// name, arrows with nothing to walk, a Ctrl-click on a page, an app's page
// loading in full, and the Frequent group under Recently opened.
import { resolve } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { installApp, isInstalled, uninstallApp } from 'server/src/apps'
import { discoverPackages } from 'server/src/runtime-packages'
import { admitTasker } from '../../server/test/tasker-client'
import { flushPendingEvents, recordAction } from '../src/lib/recents'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = { timeout: 8000 }
const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

afterEach(() => vi.restoreAllMocks())

async function openBar(admin: Admin) {
  const app = await renderApp('/featherbase/admin/all-tables', admin)
  await screen.findByTestId('all-tables-link', {}, T)
  const bar = screen.getByLabelText('Search or type a command')
  fireEvent.focus(bar)
  return { app, bar }
}

test('Enter on an empty command bar stays where it is', async ({ admin }) => {
  const { app } = await openBar(admin)
  fireEvent.submit(screen.getByTestId('awesomebar'))
  await new Promise((r) => setTimeout(r, 200))
  expect(pathOf(app)).toBe('/featherbase/admin/all-tables')
})

test("Enter on a page's name opens that page", async ({ admin }) => {
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Instance health' } })
  await screen.findByTestId('awesomebar-page', {}, T)
  fireEvent.submit(screen.getByTestId('awesomebar'))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/instance-health'))
})

/** A Table with one findable row, so a search has a record to offer. */
async function aRecord(admin: Admin, rowId: string) {
  const table = 'Cbp Probe'
  await admin.post('/api/table_def', { name: table, id_pattern: 'prompt', columns: [{ column_name: 'note', column_type: 'Data' }] }).catch(() => {})
  await admin.post(`/api/table/${encodeURIComponent(table)}`, { row_id: rowId, note: 'probe' })
}

// #1325 (audit F39): with nothing chosen, Enter opens what the list shows first: a page before a record.
test('Enter with no exact name opens the first result shown, a page before a record', async ({ admin }) => {
  await aRecord(admin, 'cbp-health-probe')
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'health' } })
  await screen.findByTestId('awesomebar-doc', {}, T)
  expect(screen.getAllByTestId('awesomebar-page')[0]).toHaveTextContent('Instance Health')
  fireEvent.submit(screen.getByTestId('awesomebar'))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/instance-health'))
})

test('Enter pressed before the results arrive waits for them and opens the first one', async ({ admin }) => {
  await aRecord(admin, 'cbp-qzx-only')
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'qzx-only' } })
  // Nothing is listed yet: the records are still on their way.
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  fireEvent.submit(screen.getByTestId('awesomebar'))
  await waitFor(() => expect(pathOf(app)).toMatch(/\/row\/cbp-qzx-only$/), T)
})

test('an early Enter is dropped when the search is changed before its results arrive', async ({ admin }) => {
  await aRecord(admin, 'cbp-drop-me')
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'drop-me' } })
  fireEvent.submit(screen.getByTestId('awesomebar'))
  // Typed over before anything was listed: the waiting Enter belongs to the old words.
  fireEvent.change(bar, { target: { value: 'Cbp nothing matches this' } })
  expect(await screen.findByTestId('search-no-match', {}, T)).toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 300))
  expect(pathOf(app)).toBe('/featherbase/admin/all-tables')
})

test('"What you can see" opens your own access page', async ({ admin }) => {
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'What you can see' } })
  await screen.findByTestId('awesomebar-page', {}, T)
  fireEvent.submit(screen.getByTestId('awesomebar'))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/account/access/Administrator'))
})

test('"Service accounts" opens Access tokens on its Service accounts tab', async ({ admin }) => {
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Service accounts' } })
  await screen.findByTestId('awesomebar-page', {}, T)
  fireEvent.submit(screen.getByTestId('awesomebar'))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/admin/access-tokens'))
  expect(await screen.findByRole('tab', { name: 'Service accounts', selected: true }, T)).toBeInTheDocument()
})

test('"Log out" is a command that signs out', async ({ admin }) => {
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Log out' } })
  fireEvent.click(await screen.findByTestId('awesomebar-cmd-logout', {}, T))
  await waitFor(() => expect(pathOf(app)).toBe('/featherbase/login'), T)
})

test('an arrow key with nothing in the bar to walk is left to the box', async ({ admin }) => {
  const { bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Cbp nothing matches this' } })
  // fireEvent answers true when no handler took the key (preventDefault).
  expect(fireEvent.keyDown(bar, { key: 'ArrowDown' })).toBe(true)
})

test("Ctrl-click on a page in the command bar is left to the browser, a new tab", async ({ admin }) => {
  const { app, bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Instance health' } })
  const page = await screen.findByTestId('awesomebar-page', {}, T)
  expect(fireEvent.click(page, { ctrlKey: true })).toBe(true)
  expect(pathOf(app)).toBe('/featherbase/admin/all-tables')
})

test("an app's page chosen in the command bar loads in full", async ({ admin }) => {
  expect(await discoverPackages([resolve('../..', 'example-apps/tasker')])).toEqual([])
  if (await isInstalled('tasker')) await uninstallApp('tasker')
  await installApp('tasker')
  await admitTasker(admin)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { bar } = await openBar(admin)
  fireEvent.change(bar, { target: { value: 'Tasker' } })
  const pages = await screen.findAllByTestId('awesomebar-page', {}, T)
  fireEvent.click(pages[0])
  // jsdom cannot load another document; it reports the attempt instead.
  await waitFor(() => expect(errors.mock.calls.some((c) => /Not implemented: navigation/.test(String((c[0] as Error)?.message ?? c[0])))).toBe(true))
})

test('g then n on the address of a Table that is not there opens no new row', async ({ admin }) => {
  const app = await renderApp('/featherbase/admin/table/cbp-nowhere', admin)
  await screen.findByText('Page not found', {}, T)
  fireEvent.keyDown(document.body, { key: 'g' })
  fireEvent.keyDown(document.body, { key: 'n' })
  await new Promise((r) => setTimeout(r, 200))
  expect(pathOf(app)).toBe('/featherbase/admin/table/cbp-nowhere')
})

test('visits the server could not record leave the history as it was', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Cbp Bin', columns: [{ column_name: 'sku', column_type: 'Data', in_list_view: true }] })
  await renderApp('/featherbase/admin/table/cbp-bin', admin)
  await screen.findByTestId('list-view', {}, T)
  // The network drops as the visit is sent.
  const real = globalThis.fetch
  let sent!: () => void
  const asked = new Promise<void>((resolve) => { sent = resolve })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (path === '/api/events' && init?.method === 'POST') { sent(); throw new TypeError('Failed to fetch') }
    return real(input, init)
  })
  const updated = vi.fn()
  window.addEventListener('navigation-history-updated', updated)
  try {
    act(() => flushPendingEvents())
    await asked
    await new Promise((r) => setTimeout(r, 50))
    expect(updated).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('navigation-history-updated', updated)
  }
})

test('the command bar offers rows opened often but not lately under Frequent', async ({ admin }) => {
  const now = Date.now()
  for (let t = 1; t <= 8; t++) {
    const name = `Cbp Shelf ${t}`
    await admin.post('/api/table_def', { name, columns: [{ column_name: 'sku', column_type: 'Data', in_list_view: true }] })
    const entry = { kind: 'list' as const, key: `list:${name}?`, label: name, path: `/featherbase/admin/table/cbp-shelf-${t}` }
    // The first two were opened many times, but longest ago.
    for (let visit = 0; visit < (t <= 2 ? 6 : 1); visit++) recordAction('Administrator', entry, now - (100 - t) * 60_000 - visit * 1000)
  }
  await openBar(admin)
  const recents = await screen.findByTestId('awesomebar-recents', {}, T)
  await waitFor(() => expect(recents).toHaveTextContent('Frequent'))
  expect(within(recents).getAllByTestId('awesomebar-recent').map((r) => r.textContent).join(' ')).toMatch(/Cbp Shelf 1/)
  // A press inside the list keeps the bar's focus until the click lands.
  expect(fireEvent.mouseDown(recents)).toBe(false)
})
