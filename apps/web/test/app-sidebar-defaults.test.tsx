// #1385 (slice 2): the platform's sidebar defaults on every page. An app's page
// (Dash, Tasker, Tickets) shows the notification bell at the top of its sidebar,
// and Recently Opened, Frequent and Saved Views below the app's own rows, drawn
// by the platform, not by the app. They list Admin destinations, so someone who
// cannot use the Admin gets none of them, and the page asks for none of them.
// Mounted the way an app's served document mounts the bar and its sidebar
// (app-command-bar.test.tsx).
import { resolve } from 'node:path'
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'
import { tableHref } from 'shared'
import { discoverPackages } from 'server/src/runtime-packages'
import type { TestClient } from 'feather-testing-postgres'
import { setSession } from '../src/lib/api'
import { mountBar } from '../src/bar/mount'
import { FeatherbaseSidebar } from '../src/bar/sidebar'
import { test, expect } from './pg-test'
import { bridgeRealtime } from './realtime-bridge'

if (!customElements.get('featherbase-sidebar')) customElements.define('featherbase-sidebar', FeatherbaseSidebar)

const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const WAIT = { timeout: 10_000 }
const DT = 'Asd DT'
const live = () => JSON.parse(document.documentElement.dataset.realtimeChannels ?? '[]') as string[]

let mounted: { unmount: () => void } | undefined
let bridge: ReturnType<typeof bridgeRealtime> | undefined
beforeEach(() => {
  localStorage.clear()
  // Realtime from the in-process server, for every page here (the bell listens on each).
  bridge = bridgeRealtime()
})
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = undefined
  // Signed out first: a socket closed while a token is stored schedules a reconnect (#1135).
  localStorage.clear()
  bridge?.()
  bridge = undefined
  document.body.replaceChildren()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

async function installBarProof(admin: TestClient) {
  expect(await discoverPackages([BAR_PROOF])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
}

/** bar-proof's page, signed in as `as`: the bar first, then the app's sidebar with one row of its own. */
function openAppPage(as: TestClient, leave: (href: string) => void = () => {}) {
  window.history.replaceState(null, '', '/barproof/')
  setSession(as.token!, { row_id: as.user!, email: null, full_name: null })
  const host = document.createElement('featherbase-bar')
  host.dataset.app = 'barproof'
  host.dataset.title = 'Bar proof'
  document.body.prepend(host)
  mounted = mountBar(host, { leave })
  const sidebar = document.createElement('featherbase-sidebar')
  sidebar.setAttribute('aria-label', 'Bar proof views')
  sidebar.innerHTML = '<a href="/barproof/" aria-current="page">Notes</a>'
  document.body.append(sidebar)
  return { sidebar, inside: within(sidebar.shadowRoot as unknown as HTMLElement) }
}

test("someone who can use the Admin sees the bell at the top of an app's sidebar", async ({ admin }) => {
  await installBarProof(admin)
  const { inside } = openAppPage(admin)
  const top = await inside.findByTestId('sidebar-top', {}, WAIT)
  expect(await within(top).findByTestId('notif-bell', {}, WAIT)).toHaveTextContent('Notifications')
})

test("an @mention shows the unread count on an app page's bell with no reload", async ({ admin, createUser }) => {
  await installBarProof(admin)
  await admin.post('/api/table_def', { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/table/Metadata%20Override', { row_id: `asd-${DT}-discussion`, table_name: DT, property: 'enable_discussion', value: 'true' })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Asd Admin Reader' } })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Asd Admin Reader', operation: 'read' } })
  const other = await createUser({ email: 'asd-user@x.com', roles: ['Asd Admin Reader'] })
  const person = await admin.get<Record<string, unknown>>(`/api/table/Person/${other.user}`)
  await admin.post('/api/save_row', { table: 'Person', row: { ...person, username: 'asd.user' } })
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'asd-mention', title: 'discuss' })

  const { inside } = openAppPage(other)
  await inside.findByTestId('notif-bell', {}, WAIT)
  await waitFor(() => expect(live()).toContain(`user:${other.user}`), WAIT)
  expect(inside.queryByTestId('unread-count')).not.toBeInTheDocument()

  await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: DT, ref_name: 'asd-mention', content: 'ping @asd.user ' } })
  expect((await inside.findByTestId('unread-count', {}, WAIT)).textContent).toMatch(/[1-9]/)
})

/** What the Admin records when someone opens a Table's list (lib/recents). */
const openedTable = (table: string, at = Date.now()) => ({ kind: 'list', key: `list:${table}?`, label: table, path: tableHref(table), at })

test("an app's sidebar lists a Table the person opened under Recently Opened, below the app's own rows", async ({ admin }) => {
  await installBarProof(admin)
  await admin.post('/api/events', { events: [openedTable('Person')] })
  const { inside } = openAppPage(admin)
  const recents = await inside.findByTestId('sidebar-recents', {}, WAIT)
  expect(within(recents).getByTestId('sidebar-recents-heading')).toHaveTextContent('Recently Opened')
  expect(await within(recents).findByRole('link', { name: /Person/ }, WAIT)).toHaveAttribute('href', tableHref('Person'))
  // The platform's groups follow the app's own rows (its <slot>).
  const rows = (recents.getRootNode() as ShadowRoot).querySelector('slot')!
  expect(rows.compareDocumentPosition(recents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('a Recently Opened Table on an app page opens with a full page load', async ({ admin }) => {
  await installBarProof(admin)
  await admin.post('/api/events', { events: [openedTable('Person')] })
  const leave = vi.fn()
  const { inside } = openAppPage(admin, leave)
  fireEvent.click(await within(await inside.findByTestId('sidebar-recents', {}, WAIT)).findByRole('link', { name: /Person/ }, WAIT))
  expect(leave).toHaveBeenCalledWith(tableHref('Person'))
})

test("a saved view is in an app's sidebar and opens its list with a full page load", async ({ admin }) => {
  await installBarProof(admin)
  const filters = [['email', 'like', '%@example.com']]
  await admin.post('/api/saved_views', { table: 'Person', label: 'Example People', filters })
  const leave = vi.fn()
  const { inside } = openAppPage(admin, leave)
  const view = await within(await inside.findByTestId('sidebar-saved-views', {}, WAIT)).findByRole('link', { name: /Example People/ }, WAIT)
  fireEvent.click(view)
  expect(leave).toHaveBeenCalledWith(`${tableHref('Person')}?filters=${encodeURIComponent(JSON.stringify(filters))}`)
})

/** Every URL the page asks the server for, from now on. */
function recordCalls(): string[] {
  const urls: string[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : (input as Request).url)
    return real(input, init)
  })
  return urls
}

test("someone who cannot use the Admin gets no bell, recall or saved views on an app's page", async ({ admin, createUser }) => {
  await installBarProof(admin)
  const reader = await createUser({ roles: ['Bar Reader'] })
  await reader.post('/api/events', { events: [openedTable('barproof.note')] })
  const { inside } = openAppPage(reader)
  // The page is drawn: its Search or Command field is there.
  await inside.findByTestId('command-field', {}, WAIT)
  await new Promise((done) => setTimeout(done, 300))
  for (const id of ['notif-bell', 'sidebar-recents', 'sidebar-saved-views']) expect(inside.queryByTestId(id)).not.toBeInTheDocument()
})

test("an app's page asks nothing for the defaults of someone who cannot use the Admin", async ({ admin, createUser }) => {
  await installBarProof(admin)
  const reader = await createUser({ roles: ['Bar Reader'] })
  const urls = recordCalls()
  const { inside } = openAppPage(reader)
  await inside.findByTestId('command-field', {}, WAIT)
  await new Promise((done) => setTimeout(done, 300))
  expect(urls.filter((u) => /\/api\/(saved_views\/sidebar|events\/summary|unread_count)/.test(u))).toEqual([])
})

// On an app's own address the Admin is another address (app-command-bar.test.tsx): a sidebar row opens through
// the sign-in hand-off, which carries the page chosen.
test("on an app's own address, a Recently Opened Table opens through the hand-off, carrying the page chosen", async ({ admin }) => {
  await installBarProof(admin)
  await admin.post('/api/events', { events: [openedTable('Person')] })
  const bridge = globalThis.fetch
  const asked: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/api/brand')) {
      const brand = await (await bridge(input, init)).json()
      return new Response(JSON.stringify({ ...brand, opens: 'barproof' }), { headers: { 'content-type': 'application/json' } })
    }
    if (url.endsWith('/api/open_admin')) {
      asked.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ landing: '/featherbase/admin/table/person' }), { headers: { 'content-type': 'application/json' } })
    }
    return bridge(input, init)
  })
  const leave = vi.fn()
  const { inside } = openAppPage(admin, leave)
  fireEvent.click(await within(await inside.findByTestId('sidebar-recents', {}, WAIT)).findByRole('link', { name: /Person/ }, WAIT))
  await waitFor(() => expect(leave).toHaveBeenCalledWith('/featherbase/admin/table/person'), WAIT)
  expect(asked).toEqual([{ next: tableHref('Person') }])
})

test("a record in an app's Recently Opened is a RecordLink", async ({ admin }) => {
  await installBarProof(admin)
  const path = `/featherbase/admin/table/person/row/${encodeURIComponent(admin.user!)}`
  await admin.post('/api/events', { events: [{ kind: 'row', key: `row:Person/${admin.user}`, label: admin.user, sub: 'Person', path, at: Date.now() }] })
  const { inside } = openAppPage(admin)
  const row = await within(await inside.findByTestId('sidebar-recents', {}, WAIT)).findByTestId('sidebar-recent', {}, WAIT)
  expect(row).toHaveAttribute('href', path)
  const record = row.querySelector('[data-record-link]')
  expect(record).toHaveAttribute('data-table', 'Person')
  expect(record).toHaveAttribute('data-row', admin.user)
  expect(record).toHaveTextContent('Administrator')
})

// #1248: collapsed, the platform's groups take the Admin's rail forms: one icon each, whose menu lists them.
// The menu is drawn in the sidebar's own shadow root, where the platform's styles are.
async function railedAppPage(admin: TestClient, leave: (href: string) => void = () => {}) {
  await installBarProof(admin)
  await admin.post('/api/events', { events: [openedTable('Person')] })
  const page = openAppPage(admin, leave)
  await page.inside.findByTestId('sidebar-recents', {}, WAIT)
  await userEvent.click(page.inside.getByTestId('sidebar-collapse'))
  return { ...page, fold: await page.inside.findByRole('button', { name: 'Recently Opened' }, WAIT) }
}

test("collapsed, an app's sidebar folds Recently Opened into one icon whose menu opens the Table with a full page load", async ({ admin }) => {
  const leave = vi.fn()
  const { inside, fold } = await railedAppPage(admin, leave)
  expect(fold).toHaveAttribute('aria-haspopup', 'menu')
  await userEvent.click(fold)
  const menu = inside.getByRole('menu', { name: 'Recently Opened' })
  await userEvent.click(await within(menu).findByRole('menuitem', { name: /Person/ }, WAIT))
  expect(leave).toHaveBeenCalledWith(tableHref('Person'))
  expect(inside.queryByRole('menu')).not.toBeInTheDocument()
})

test("a rail group's icon on an app's page closes its own open menu", async ({ admin }) => {
  const { inside, fold } = await railedAppPage(admin)
  await userEvent.click(fold)
  expect(inside.getByRole('menu', { name: 'Recently Opened' })).toBeInTheDocument()
  await userEvent.click(fold)
  expect(inside.queryByRole('menu')).not.toBeInTheDocument()
})

test("the arrow keys move through a rail menu's items on an app's page", async ({ admin }) => {
  await admin.post('/api/events', { events: [openedTable('Role', Date.now() - 1000)] })
  const { inside, fold } = await railedAppPage(admin)
  await userEvent.click(fold)
  const menu = inside.getByRole('menu', { name: 'Recently Opened' })
  const [first, second] = await waitFor(() => {
    const all = within(menu).getAllByRole('menuitem')
    expect(all).toHaveLength(2)
    return all
  }, WAIT)
  const shadow = fold.getRootNode() as ShadowRoot
  await waitFor(() => expect(shadow.activeElement).toBe(first))
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(shadow.activeElement).toBe(second)
})
